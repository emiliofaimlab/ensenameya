-- ============================================================================
-- Enséñame Ya — AUD-01 · un riel que RECHAZA baja al siguiente candidato
--
-- ── EL FALLO ───────────────────────────────────────────────────────────────
--
-- `payouts-process` marcaba la orden 'failed' en cuanto un proveedor la
-- rechazaba, sin preguntar a los que venían detrás. Un 422 de Wise
-- («error.route.not.supported») dejaba sin cobrar a un tutor al que Stripe sí
-- podía pagar.
--
-- Y duele más desde el dictado: el tutor ve UNA tarjeta, «Banco», detrás de la
-- cual compiten Wise, dLocal y Stripe. Se le promete la vía más barata que
-- llegue a su país; morir en la primera es romper esa promesa sin decírselo, y
-- encima mandándole la incidencia NTF-16 como si no hubiera nada que hacer.
--
-- ⚠️ `docs/DICTADO-PAGOS.md` afirmaba que «ese descenso ya existe en el código y
-- no hay que escribirlo». Existía el descenso PREVIO —`rielSirveParaEsteTutor`
-- descarta a quien no tiene los datos del tutor ANTES de elegir— pero no el
-- posterior. Un riel elegido que luego rechazaba no tenía a dónde caer.
--
-- ── LO QUE ARREGLA ESTA MIGRACIÓN ──────────────────────────────────────────
--
-- El descenso en sí es código (`riel-viable.ts` y el caso `rechazado` del job).
-- Aquí solo hace falta una cosa, y sin ella el arreglo introduce un atasco mudo
-- peor que el fallo original:
--
-- El job apunta en `provider_metadata.c2.rieles_rechazados` los rieles que ya
-- dijeron que no, para no volver a preguntarles — es lo que hace que el
-- descenso TERMINE. Cuando se agotan todos, la orden acaba en 'failed' con esa
-- lista llena. Y hay DOS botones del panel que la devuelven a la cola sin
-- vaciarla:
--
--   · `retry`, que limpiaba proveedor e identificador pero no la lista;
--   · `release`, al que se llega en dos clics porque `hold` acepta una orden
--     'failed': Retener y luego Liberar.
--
-- Por cualquiera de los dos, el resolvedor no encontraría ni un candidato y la
-- orden se quedaría en 'scheduled' para siempre: sin fila roja, sin
-- notificación y sin que nadie se entere. El mismo atasco silencioso que el
-- descenso existe para evitar.
--
-- Las dos acciones son una persona diciendo «inténtalo otra vez». Así que se
-- empieza de cero: los rechazos no se pierden —quedan en `intentos_muertos` y
-- en el log— pero dejan de vetar rieles.
--
-- ⚠️ La firma NO cambia, así que `create or replace` es correcto aquí (la regla
-- de oro 12 habla de AÑADIR argumentos, que es lo que crea una sobrecarga). La
-- definición de abajo se extrajo con `pg_get_functiondef` de la BD viva y se
-- parcheó SOLO la rama de `retry`: 13 líneas añadidas, ninguna quitada. Se hace
-- así a propósito — reescribir a mano una función de 336 líneas es cómo se
-- pierde en silencio un guardarraíl, y en esta misma función ya casi pasa una
-- vez con el manejador que impide que un identificador de pago acabe en los logs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.manage_payout(p_payout_id uuid, p_action text, p_referencia text DEFAULT NULL::text, p_canal text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- 🔴 Y SE OLVIDA QUIÉN RECHAZÓ (AUD-01). El job apunta en `rieles_rechazados`
    -- los rieles que dijeron que no, para bajar al siguiente en vez de matar la
    -- orden. Cuando se agotan todos, la orden acaba en 'failed' con la lista
    -- llena — y si un `retry` la devolviera a la cola SIN vaciarla, el resolvedor
    -- no encontraría ni un candidato y la orden se quedaría en 'scheduled' para
    -- siempre, sin fila roja y sin que nadie se entere. Es exactamente el
    -- atasco mudo que el descenso existe para evitar.
    --
    -- Un `retry` es una persona diciendo «inténtalo otra vez desde cero», así
    -- que se empieza de cero: los rechazos anteriores no se pierden —quedan en
    -- `intentos_muertos` y en el log— pero dejan de vetar rieles.
    v_c2 := v_c2 - 'rieles_rechazados';

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
    -- 🔴 Y AQUÍ TAMBIÉN SE OLVIDA QUIÉN RECHAZÓ (AUD-01), por el mismo motivo
    -- que en `retry` y con un camino aún más corto para llegar: `hold` acepta
    -- una orden 'failed', así que Retener + Liberar la devuelve a la cola en dos
    -- clics. Si conservara los vetos y ya estuvieran todos, el resolvedor no
    -- encontraría ni un candidato y la orden se quedaría en 'scheduled' para
    -- siempre: sin fila roja, sin notificación y sin que nadie se entere.
    update public.payouts
       set status        = 'scheduled'::public.payout_status,
           scheduled_for = now(),
           provider_metadata = jsonb_set(
                                 coalesce(v_meta, '{}'::jsonb), '{c2}',
                                 coalesce(v_c2, '{}'::jsonb) - 'rieles_rechazados')
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
$function$

;

-- ── Los grants, que no se tocan pero se declaran ───────────────────────────
--
-- `create or replace` los conserva; se repiten porque son baratos, idempotentes
-- y porque una RPC sin `grant execute` es una pantalla de admin que deja de
-- funcionar en tiempo de ejecución (regla de oro 9 con otro disfraz).

revoke execute on function public.manage_payout(uuid, text, text, text) from public;
revoke execute on function public.manage_payout(uuid, text, text, text) from anon;
grant  execute on function public.manage_payout(uuid, text, text, text) to authenticated;

-- ── Autocomprobación ───────────────────────────────────────────────────────
--
-- Afirma lo único que esta migración cambia: que un `retry` deja la orden sin
-- rieles vetados. Si alguien reescribe la función y se lleva por delante esa
-- línea, esto lo para en el despliegue en vez de dejar que lo descubra un tutor
-- que no cobra.

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'manage_payout';

  if v_def is null then
    raise exception 'manage_payout no existe tras la migración';
  end if;

  -- Las DOS ramas que devuelven una orden a la cola tienen que vaciar los vetos.
  -- Se cuentan las apariciones en vez de mirar si aparece alguna: con una sola
  -- rama parcheada el atasco sigue abierto por la otra, y esa fue exactamente la
  -- primera versión de esta migración.
  if (length(v_def) - length(replace(v_def, 'rieles_rechazados', ''))) / length('rieles_rechazados') < 2 then
    raise exception
      'manage_payout no vacía rieles_rechazados en sus DOS caminos de vuelta a la cola (retry y release): la orden volvería sin ningún riel candidato y se quedaría en scheduled para siempre, muda (AUD-01)';
  end if;

  -- Y que sigue siendo UNA función: añadirle un argumento con `create or
  -- replace` crearía una sobrecarga y PostgREST respondería PGRST203, que es
  -- exactamente lo que rompió el formulario bancario el 10-sep.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'manage_payout') <> 1 then
    raise exception 'hay más de una versión de manage_payout: PostgREST no podría elegir';
  end if;
end $$;
