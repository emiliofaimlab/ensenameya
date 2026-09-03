-- ============================================================================
-- Enséñame Ya — `anotar` deja de borrar el rastro de un identificador anterior,
-- y dos comentarios dejan de describir el mundo de antes de ayer.
--
-- ── EL DEFECTO ──────────────────────────────────────────────────────────────
--
-- De las cuatro acciones de `manage_payout` que tocan `provider_payout_id`,
-- TRES lo tratan con cuidado y una lo pisaba en silencio:
--
--   mark_paid  → lo archiva en `c2.intentos_muertos` (20260902160000, defecto 6)
--   retry      → lo archiva y sube `intento`
--   devolver   → se NIEGA si hay uno (20260902160000, defecto 4)
--   anotar     → lo sobrescribía sin más  ← esto
--
-- Y no es un caso de esquina, que es lo que lo hace caro. dLocal Go **no
-- deduplica por `description`**, así que un reintento tras un fallo de red puede
-- dejar DOS payouts con la misma marca `EY-<payout>-<intento>` — está
-- documentado en `src/lib/payments/dlocal-provider.ts`, es el motivo de que
-- exista el barrido. El camino real:
--
--   1. el job crea la orden, recibe PENDING y escribe provider_payout_id = 'X'
--      dejando la fila en 'processing';
--   2. días después el admin busca la marca en el panel de dLocal y encuentra
--      DOS pagos con ella: 'X' y 'Y';
--   3. anota 'Y', que es el que consta pagado.
--
-- Hasta aquí, 'X' desaparecía de la fila. Y 'X' es un payout que sigue vivo en
-- el proveedor y que puede haber cobrado también: es exactamente el número que
-- hace falta para reclamarlo, y el único sitio donde estaba escrito era esa
-- columna.
--
-- ── LO QUE HACE ESTA MIGRACIÓN ──────────────────────────────────────────────
--
-- `create or replace` de `manage_payout` con la MISMA firma —no hay overload que
-- crear ni que tirar, la de dos argumentos ya la eliminó `20260902120000`— y un
-- solo cambio: la rama 'anotar' archiva el identificador anterior en
-- `c2.intentos_muertos` antes de pisarlo, con el mismo bloque que ya usan
-- `mark_paid` y `retry`. Sin subir `intento`: la orden sigue en vuelo con la
-- misma marca, y subirlo haría que el ejecutor buscara una que nunca se mandó.
--
-- El resto del cuerpo es literalmente el de `20260902160000`, incluidos el
-- `for update`, las guardas de estado repetidas en los seis `update` y el
-- `exception when unique_violation` de esta misma rama.
--
-- ⚠️ NO se tocan los `grant`: la firma no cambia, así que los de
-- `20260902160000:517-519` siguen vigentes. `create or replace` conserva los
-- privilegios; solo un `drop` los tira.
-- ============================================================================

create or replace function public.manage_payout(
  p_payout_id  uuid,
  p_action     text,
  p_referencia text default null,   -- id/comprobante del movimiento real
  p_canal      text default null    -- 'zelle', 'zinli', 'binance', 'wise'…
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  public.payout_status;
  v_prov    text;
  v_old_id  text;
  v_meta    jsonb;
  v_c2      jsonb;
  v_intento int;
  v_dueno   uuid;
  -- La referencia se normaliza UNA vez: '   ' es tan vacío como null, y un
  -- espacio de más al pegar desde el panel del banco no puede ser la diferencia
  -- entre cerrar un payout y no cerrarlo.
  v_ref     text := nullif(btrim(coalesce(p_referencia, '')), '');
  v_canal   text := nullif(btrim(coalesce(p_canal, '')), '');
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin gestiona payouts' using errcode = 'insufficient_privilege';
  end if;

  -- 🔴 EL CANDADO (defecto 1). `for update` bloquea la fila hasta el final de
  -- ESTA transacción. Si el ejecutor la está reclamando ahora mismo, aquí se
  -- espera y se relee la versión nueva, así que las guardas de estado de abajo
  -- deciden sobre el estado REAL y no sobre uno que caducó hace tres
  -- milisegundos. Y si el que llega tarde es el job, su
  -- `update … where status='scheduled'` toca cero filas y cuenta `noReclamados`
  -- sin haber mirado al proveedor, que es exactamente lo que tiene que pasar.
  select p.status, p.provider, p.provider_payout_id, coalesce(p.provider_metadata, '{}'::jsonb)
    into v_status, v_prov, v_old_id, v_meta
    from public.payouts p
   where p.id = p_payout_id
     for update;

  if v_status is null then
    raise exception 'payout no encontrado' using errcode = 'no_data_found';
  end if;

  -- El rastro que deja el ejecutor (`route.ts` → `Rastro`). Se lee con
  -- `coalesce` en cada salto porque una fila creada por el lote no lo tiene.
  v_c2      := coalesce(v_meta -> 'c2', '{}'::jsonb);
  v_intento := coalesce(nullif(v_c2 ->> 'intento', '')::int, 1);

  -- ── 'mark_paid' · el ciclo se cierra a mano ───────────────────────────────
  --
  -- Es la acción de la fase 1 del plan de pagos: Venezuela entera y cualquier
  -- riel sin adaptador. El admin paga por fuera, vuelve y lo anota. Desde
  -- 'on_hold' y desde 'failed' también (un payout retenido por una duda que se
  -- aclaró pagando, o uno que el PSP rechazó y se acabó pagando por otro canal:
  -- los dos casos reales de soporte). 'processing' sigue fuera — para eso está
  -- 'anotar', que es otra conversación.
  --
  -- ⚠️ SÍ DISPARA NTF-12, y es lo correcto: quien pulsa esto es una persona que
  -- acaba de ver el movimiento en el panel del banco. El dinero se movió de
  -- verdad. No se silencie — se le estaría quitando el aviso a los únicos
  -- tutores a los que hoy se les paga.
  if p_action = 'mark_paid' then
    if v_status not in ('scheduled'::public.payout_status,
                        'failed'::public.payout_status,
                        'on_hold'::public.payout_status) then
      raise exception 'mark_paid no es válido desde el estado %: solo desde scheduled, failed u on_hold', v_status
        using errcode = 'check_violation';
    end if;
    if v_ref is null then
      raise exception 'mark_paid exige una referencia del movimiento real (id de la transferencia, del envío de Zelle/Zinli o del comprobante del lote): es lo único que permitirá reconciliar este payout con el extracto'
        using errcode = 'check_violation';
    end if;

    -- Defecto 6: si venía de 'failed' arrastrando el id del payout rechazado, se
    -- archiva en vez de pisarlo. Sin subir `intento`: esta orden no vuelve a la
    -- cola, así que no va a salir ninguna marca nueva que haya que distinguir.
    if v_old_id is not null then
      v_meta := jsonb_set(
                  v_meta, '{c2}',
                  jsonb_set(v_c2, '{intentos_muertos}',
                            coalesce(v_c2 -> 'intentos_muertos', '[]'::jsonb) || to_jsonb(v_old_id))
                );
    end if;

    -- Defecto 5: la referencia NO va a `provider_payout_id`. Ver la cabecera.
    v_meta := jsonb_set(
                v_meta, '{manual}',
                jsonb_build_object(
                  'referencia', to_jsonb(v_ref),
                  'canal',      to_jsonb(coalesce(v_canal, 'manual')),
                  'pagado_en',  to_jsonb(now())
                )
              );

    update public.payouts
       set status             = 'paid'::public.payout_status,
           provider           = coalesce(v_canal, 'manual'),
           provider_payout_id = null,
           provider_metadata  = v_meta,
           paid_at            = now(),
           -- El cadáver del intento anterior se limpia: esta orden ya no está
           -- fallida, y dejar `failure_reason` puesto sobre una fila 'paid' es
           -- pedir que alguien la lea mal dentro de seis meses.
           failed_at          = null,
           failure_reason     = null
     where id = p_payout_id
       and status = v_status;
    if not found then
      raise exception 'el payout % cambió de estado mientras se marcaba pagado: vuelve a mirarlo antes de repetir (no se ha escrito nada)', p_payout_id
        using errcode = 'check_violation';
    end if;
    return 'paid';

  -- ── 'anotar' · le da al sistema el id que le faltaba. NO cierra nada ──────
  --
  -- 🔴 DEFECTO 3, y es el cambio de fondo de esta migración: esta acción YA NO
  -- pone la fila en 'paid'. Encontrar la orden en el panel del proveedor no es
  -- que esté pagada —dLocal Go las crea en PENDING— y cerrar aquí sería mandar
  -- NTF-12 «Se pagó tu liquidación» sobre dinero quieto.
  --
  -- Lo que hace es escribir el identificador y dejar la fila en 'processing'.
  -- Con eso la orden entra en el «camino 1 · SEGUIR» del adaptador en la pasada
  -- siguiente del job: se le pregunta al proveedor por ese id y es ÉL quien la
  -- deja en 'paid' (DELIVERED/COMPLETED) o en 'failed'. Esa es la única fuente
  -- honesta del estado, y de ahí cuelga NTF-12.
  --
  -- `provider` NO se toca, y `p_canal` se IGNORA aquí a propósito: para una
  -- orden en vuelo, `payouts.provider` es lo que el job usa para elegir quién la
  -- sigue (`route.ts` → `claveEjecutor`). Cambiarlo a un canal manual la dejaría
  -- sin ejecutor —contada en `sinEjecutor`— y atascada en 'processing' para
  -- siempre. El formulario del panel comparte el estado del canal entre los tres
  -- diálogos, así que puede llegar relleno sin que nadie lo haya querido.
  elsif p_action = 'anotar' then
    if v_status <> 'processing'::public.payout_status then
      raise exception 'anotar solo es válido desde processing (una orden en vuelo), y este payout está %', v_status
        using errcode = 'check_violation';
    end if;
    if v_ref is null then
      raise exception 'anotar exige el identificador que el proveedor da al payout: es la marca con la que se buscó y sin ella no se está anotando nada, se está adivinando'
        using errcode = 'check_violation';
    end if;
    -- Sin `provider` no hay a quién preguntarle por ese id, así que anotarlo
    -- dejaría la fila esperando a un ejecutor que no existe. No debería pasar
    -- —el reclamo del job escribe siempre `provider`— y por eso es un error y no
    -- un apaño.
    if v_prov is null then
      raise exception 'este payout está en processing sin proveedor anotado: anotar un identificador aquí lo dejaría en vuelo sin nadie que lo siga. Revísalo con select * from public.payouts_backlog() antes de tocarlo'
        using errcode = 'check_violation';
    end if;

    -- ⚠️ SI YA HABÍA UN IDENTIFICADOR, SE ARCHIVA ANTES DE PISARLO — y este no es
    -- un caso de esquina. dLocal NO deduplica por `description`, así que un
    -- reintento tras un fallo de red puede dejar DOS payouts con la misma marca
    -- `EY-<id>-<intento>`; el admin abre el panel, ve los dos, y anota el que de
    -- verdad pagó. Sin este bloque, el identificador del otro —el que sigue vivo
    -- en el proveedor y que quizá también cobró— desaparece de la fila y no
    -- queda rastro de que existió.
    -- `mark_paid` (defecto 6), `retry` y `devolver` ya archivaban; `anotar` era
    -- la única de las cuatro que pisaba en silencio.
    -- Sin subir `intento`: la orden sigue en vuelo con la misma marca, y subirlo
    -- haría que el ejecutor buscara una marca que nunca se mandó.
    if v_old_id is not null and v_old_id is distinct from v_ref then
      v_meta := jsonb_set(
                  v_meta, '{c2}',
                  jsonb_set(v_c2, '{intentos_muertos}',
                            coalesce(v_c2 -> 'intentos_muertos', '[]'::jsonb) || to_jsonb(v_old_id))
                );
      v_c2 := v_meta -> 'c2';
    end if;

    begin
      update public.payouts
         set provider_payout_id = v_ref,
             provider_metadata  = jsonb_set(
                                    v_meta, '{c2}',
                                    v_c2 || jsonb_build_object(
                                      'ultimo_estado',     'anotado-por-admin',
                                      'ultimo_intento_en', to_jsonb(now())
                                    )
                                  )
       where id = p_payout_id
         and status = v_status;
      if not found then
        raise exception 'el payout % dejó de estar en vuelo mientras se anotaba: vuelve a mirarlo (no se ha escrito nada)', p_payout_id
          using errcode = 'check_violation';
      end if;
    exception
      -- Defecto 5, segunda mitad. `payouts_provider_payout_id_uidx`
      -- (`20260902130000`) impide que dos órdenes se adjudiquen el mismo pago
      -- del PSP. Cuando salta, el admin tiene que saber CUÁL es la otra: un
      -- 23505 crudo trae el valor de la clave y ni una pista de a quién
      -- pertenece.
      when unique_violation then
        select p.id into v_dueno
          from public.payouts p
         where p.provider_payout_id = v_ref;
        raise exception 'el identificador % ya está anotado en el payout %: dos órdenes no pueden ser el mismo pago del proveedor. Comprueba en su panel cuál de las dos corresponde a esa marca antes de seguir', v_ref, v_dueno
          using errcode = 'check_violation';
    end;
    -- 'processing', no 'paid'. Quien cierra es el proveedor.
    return 'processing';

  -- ── 'devolver' · processing SIN identificador → scheduled ─────────────────
  --
  -- 🔴 LA ACCIÓN MÁS PELIGROSA DE TODO EL SISTEMA: devolver a la cola algo que
  -- quizá se pagó es elegir pagar dos veces. No hay deshacer.
  --
  -- 🔴 DEFECTO 4. Ahora exige además que la orden NO tenga identificador. La
  -- contraseña afirma «he buscado la marca y no existe nada», y sobre una fila
  -- con `provider_payout_id` esa afirmación es falsa por construcción: ese id lo
  -- escribió el ejecutor porque el proveedor se lo dio. La versión de ayer no
  -- solo lo aceptaba, tenía un bloque para archivarlo — o sea que contemplaba a
  -- propósito el caso que nunca debió pasar.
  --
  -- Lo que queda es el caso legítimo y único: `status='processing' AND
  -- provider_payout_id IS NULL`, la fila que `payouts_backlog()` cuenta en
  -- `sin_identificar` y llama «la cifra que nunca puede quedarse arriba». De esa
  -- sí que no se sabe nada, y la marca `EY-<id>-<intento>` viaja en el
  -- `description` de cada `POST /v1/payouts` justamente para que buscarla sea un
  -- sí o un no. Si la búsqueda no es concluyente, la respuesta correcta es **no
  -- hacer nada** y dejarla en 'processing': ahí sigue contada, que es incómodo a
  -- propósito.
  --
  -- Y como ya no puede haber id, no hay nada que archivar ni ningún intento que
  -- subir: la orden vuelve a salir con la misma marca, que es lo correcto porque
  -- se ha comprobado que esa marca no llegó a existir en el proveedor.
  --
  -- La confirmación va en la firma y no en un `p_confirmo boolean` porque un
  -- booleano se pone a true sin leer nada.
  elsif p_action = 'devolver' then
    if v_status <> 'processing'::public.payout_status then
      raise exception 'devolver solo es válido desde processing, y este payout está %', v_status
        using errcode = 'check_violation';
    end if;
    if v_old_id is not null then
      raise exception 'este payout ya tiene identificador del proveedor (%): NO se puede devolver a la cola, porque devolver significa "he comprobado que el pago no existe" y ese id dice que sí existe — lo escribió el ejecutor con lo que respondió el proveedor. Si en su panel consta pagado, usa anotar con ese mismo identificador; si no, no hagas nada: el job ya sigue esta orden solo y la cerrará como pagada o rechazada', v_old_id
        using errcode = 'check_violation';
    end if;
    if v_ref is distinct from 'COMPROBADO-SIN-RASTRO' then
      raise exception 'devolver un payout a la cola es elegir pagar dos veces si el proveedor sí lo creó. Busca la marca EY-%-% en el panel del proveedor y, SOLO si no existe nada con esa marca, vuelve a llamar con p_referencia => ''COMPROBADO-SIN-RASTRO''', p_payout_id, v_intento
        using errcode = 'check_violation';
    end if;

    update public.payouts
       set status         = 'scheduled'::public.payout_status,
           provider       = null,          -- nadie la sacó: vuelve a la cola
           scheduled_for  = now(),
           failed_at      = null,
           failure_reason = null
     where id = p_payout_id
       and status = v_status;
    if not found then
      raise exception 'el payout % dejó de estar en vuelo mientras se devolvía a la cola: vuelve a mirarlo (no se ha escrito nada)', p_payout_id
        using errcode = 'check_violation';
    end if;
    return 'scheduled';

  -- ── 'retry' · failed → scheduled, PERO LIMPIA ─────────────────────────────
  --
  -- Igual que en `20260902120000` (ver allí el bucle silencioso que arregló) más
  -- el candado. Se limpian `provider_payout_id`, `failed_at` y `failure_reason`,
  -- y el id muerto se archiva subiendo el intento en vez de borrarse: es la
  -- única traza para conciliar ese rechazo, y subir el intento garantiza que la
  -- orden nueva salga con una marca distinta de la del cadáver.
  elsif p_action = 'retry' then
    if v_status <> 'failed'::public.payout_status then
      raise exception 'retry solo es válido desde failed, y este payout está %', v_status
        using errcode = 'check_violation';
    end if;

    if v_old_id is not null then
      v_c2 := jsonb_set(
                jsonb_set(v_c2, '{intento}', to_jsonb(v_intento + 1)),
                '{intentos_muertos}',
                coalesce(v_c2 -> 'intentos_muertos', '[]'::jsonb) || to_jsonb(v_old_id)
              );
    end if;

    update public.payouts
       set status             = 'scheduled'::public.payout_status,
           provider           = null,
           provider_payout_id = null,
           provider_metadata  = jsonb_set(v_meta, '{c2}', v_c2),
           scheduled_for      = now(),
           failed_at          = null,
           failure_reason     = null
     where id = p_payout_id
       and status = v_status;
    if not found then
      raise exception 'el payout % dejó de estar en failed mientras se reintentaba: vuelve a mirarlo (no se ha escrito nada)', p_payout_id
        using errcode = 'check_violation';
    end if;
    return 'scheduled';

  -- ── 'hold' y 'release' · sin cambios salvo el candado ─────────────────────
  --
  -- 'processing' sigue fuera de 'hold' a propósito: una orden en vuelo no se
  -- retiene retocando una fila nuestra —el proveedor no se entera—, se resuelve
  -- con 'anotar' o con 'devolver' según lo que diga su panel.
  elsif p_action = 'hold' then
    if v_status not in ('pending'::public.payout_status,
                        'scheduled'::public.payout_status,
                        'failed'::public.payout_status) then
      raise exception 'hold no es válido desde el estado %', v_status
        using errcode = 'check_violation';
    end if;
    update public.payouts
       set status = 'on_hold'::public.payout_status
     where id = p_payout_id
       and status = v_status;
    if not found then
      raise exception 'el payout % cambió de estado mientras se retenía: vuelve a mirarlo (no se ha escrito nada)', p_payout_id
        using errcode = 'check_violation';
    end if;
    return 'on_hold';

  elsif p_action = 'release' then
    if v_status <> 'on_hold'::public.payout_status then
      raise exception 'release solo es válido desde on_hold, y este payout está %', v_status
        using errcode = 'check_violation';
    end if;
    update public.payouts
       set status        = 'scheduled'::public.payout_status,
           scheduled_for = now()
     where id = p_payout_id
       and status = v_status;
    if not found then
      raise exception 'el payout % dejó de estar retenido mientras se liberaba: vuelve a mirarlo (no se ha escrito nada)', p_payout_id
        using errcode = 'check_violation';
    end if;
    return 'scheduled';

  else
    raise exception 'acción "%" desconocida: hold, release, retry, mark_paid, anotar o devolver', p_action
      using errcode = 'check_violation';
  end if;
end;
$$;

-- ── DOS COMENTARIOS QUE SE QUEDARON DESCRIBIENDO EL MUNDO ANTERIOR ─────────
--
-- Regla de oro 5: no se edita una migración aplicada. Se corrigen aquí, que es
-- lo que un `grep` va a encontrar después de leer la mentira.
--
-- 1 · `20260902170000` (el cuerpo de `payouts_backlog()`, en el comentario del
--     contador `sin_identificar`) dice que una orden pagada a mano «la cierra en
--     'paid' en el mismo momento, con la referencia de la transferencia como
--     provider_payout_id». **Es falso desde `20260902160000`**: `mark_paid` deja
--     `provider_payout_id` a NULL y la referencia va a
--     `provider_metadata -> 'manual' ->> 'referencia'`. El contador en sí está
--     bien —cuenta 'processing' sin identificador, y un pago manual no pasa por
--     'processing'—; lo que está mal es el porqué que da.
--
-- 2 · `20260902140000` (columna `notas` de la fila de EC en
--     `payout_country_rules`) describe el freno del tipo de cambio como si
--     siguiera puesto. Se quitó el 2-sep-2026 al decidirse que **el diferencial
--     lo asume el tutor**: el adaptador convierte con la tasa publicada
--     corregida por `DLOCALGO_FX_SPREAD`. Ecuador sigue siendo el único de los
--     ocho sin conversión, pero ya no es el único que puede cobrar.
--
-- Ninguno de los dos cambia comportamiento. Se dejan escritos y no se “arreglan”
-- con un update sobre `notas`, porque el de EC es un dato de negocio y
-- reescribirlo desde aquí lo desincronizaría con lo que diga el sandbox.

comment on function public.manage_payout(uuid, text, text, text) is
  'Acciones del admin sobre un payout: hold, release, retry, mark_paid, anotar y devolver. Lee la fila con `for update` y repite la guarda de estado en cada update (20260902160000), así que no puede pisar el reclamo del cron. mark_paid cierra en paid dejando provider_payout_id a NULL y la referencia del comprobante en provider_metadata->''manual''->>''referencia'' (el índice único de esa columna es para identificadores de proveedor, y un pago en lote comparte justificante). anotar NO cierra: escribe el identificador, archiva el anterior si lo había (20260902180000) y deja la fila en processing para que la cierre el proveedor. devolver se niega si ya hay identificador. Las cuatro que tocan provider_payout_id archivan el anterior en provider_metadata->''c2''->''intentos_muertos'' o se niegan; ninguna lo pisa en silencio.';

-- ── COMPROBACIÓN, regla de oro 11 ──────────────────────────────────────────
-- Esta función no corre por cron, pero de ella cuelga el cierre de los payouts
-- que sí. Tras aplicar:
--
--   select j.jobname, d.status, count(*)
--     from cron.job_run_details d join cron.job j using (jobid)
--    group by 1, 2 order by 1, 2;
--
-- Y el rastro que este cambio protege:
--
--   select id, status, provider, provider_payout_id,
--          provider_metadata -> 'c2' -> 'intentos_muertos' as muertos,
--          provider_metadata -> 'manual' ->> 'referencia'  as referencia
--     from public.payouts
--    where provider_metadata ? 'manual'
--       or provider_metadata -> 'c2' ? 'intentos_muertos';
