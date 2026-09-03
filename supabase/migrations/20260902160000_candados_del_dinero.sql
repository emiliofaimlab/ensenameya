-- ============================================================================
-- Enséñame Ya — C2 · LOS CANDADOS DEL DINERO.
--
-- Cinco defectos de las tres migraciones de ayer, todos en funciones que mueven
-- dinero de verdad y ninguno visible desde el typecheck, el lint ni el build.
-- Cuatro de los cinco terminan en **un pago duplicado o un tutor al que se le
-- dice que cobró sin haber cobrado**; el quinto revienta en runtime el día que
-- se pague a tres tutores con un solo envío, que es la operativa normal del riel
-- manual de Venezuela.
--
-- Esta migración NO añade funcionalidad. Reescribe `manage_payout` y
-- `refund_payment` con las mismas firmas y las mismas acciones, poniéndoles
-- candados.
--
-- ── DEFECTO 1 · TOCTOU EN `manage_payout` (20260902120000:160) ──────────────
--
-- La función lee el estado con un `select … into v_status` **sin `for update`**,
-- y ninguno de sus seis `update` repite la condición: todos son
-- `where id = p_payout_id` a secas. Entre la lectura y la escritura cabe el
-- ejecutor entero.
--
-- El entrelazado no es teórico, es el caso normal de un lunes por la mañana:
--
--   T1 (admin, «Marcar pagado»)      T2 (/api/cron/payouts-process)
--   ─────────────────────────────    ───────────────────────────────────────
--   select status → 'scheduled'
--   (guarda OK: scheduled vale)
--                                    update … set status='processing'
--                                      where id=? and status='scheduled'  ✔ gana
--                                    POST /v1/payouts → dLocal crea el pago
--   update … set status='paid'
--     where id=?                     ← pisa 'processing'
--
-- Resultado: dLocal está ejecutando un payout que el panel da por cerrado a
-- mano, con `provider_payout_id` sobrescrito por la referencia del admin. La
-- fila deja de estar en la cola en vuelo (el job solo lee 'processing'), así que
-- **nadie vuelve a mirarla nunca** y el pago de dLocal llega además del manual.
-- Se paga dos veces, y `payouts_backlog()` no lo enseña porque la fila está
-- 'paid'.
--
-- Ojo a la dirección: el candado del job (`.eq("status","scheduled")`) es
-- correcto y está bien pensado — protege al job de sí mismo. Lo que no existía
-- era el candado en el otro sentido, el que protege al job del panel.
--
-- Arreglo: `for update` al leer —que en READ COMMITTED hace que la segunda
-- transacción espere y **relea la versión nueva**, así que la guarda de estado
-- pasa a evaluarse sobre el estado real— y, además, `and status = v_status` en
-- los seis `update`, con `check_violation` si no toca ninguna fila. Lo segundo
-- es redundante mientras el `for update` esté puesto, y va igualmente: es lo que
-- convierte «alguien quitó el lock en un refactor» en un error ruidoso en vez de
-- en un pago duplicado silencioso.
--
-- ── DEFECTO 2 · EL MISMO TOCTOU EN `refund_payment` (20260902130000:176) ────
--
-- La guarda contra 'processing' que se añadió ayer —la que impide que un
-- reembolso borre una orden que el proveedor está ejecutando— lee el estado del
-- payout **sin bloquearlo** y borra después. La ventana es la misma y el daño es
-- el que aquella cabecera describe entero: se borra el `payout_item`, se le resta
-- el importe a la orden que el proveedor ya está pagando y, si era el único item,
-- se borra la fila con su `provider_payout_id` dentro. El dinero sale igual —el
-- proveedor no se entera de nuestros DELETE— y aquí no queda ni la fila para
-- conciliarlo.
--
-- Arreglo: `for update of po, pi` al leer el item y su payout, y volver a
-- comprobar el estado DESPUÉS de tener el candado. A partir de ahí todo el
-- bloque S-29 razona sobre el estado releído, no sobre el que se vio antes.
--
-- ── DEFECTO 3 · `anotar` DECÍA «TE PAGAMOS» SIN SABERLO ─────────────────────
--
-- `anotar` cerraba la orden en 'paid' con dos únicas guardas: que la fila esté
-- en 'processing' y que la referencia no venga vacía. Y 'paid' dispara
-- `notify_payout()` → NTF-12 «Se pagó tu liquidación», que con el job de correo
-- vivo desde el 30-ago SALE.
--
-- El problema es la premisa. El formulario le pide al admin «busca
-- EY-<id>-<intento> en el panel del proveedor; si existe, pega el identificador»
-- — y **existir no es haber pagado**. dLocal Go tiene ocho estados y
-- `estadoNuestro()` (`src/lib/payments/dlocal-provider.ts`) mapea
-- PENDING/PROCESSING a 'processing' y REJECTED/CANCELLED/FAILED a 'failed'. Un
-- admin que encuentra la orden en PENDING —que es como NACEN todos los payouts
-- de dLocal— y la anota le manda al tutor el correo de que cobró sobre dinero
-- que no se ha movido. Que es exactamente el fallo que C1 (`20260901120000`)
-- existió para eliminar, reintroducido por la puerta de al lado.
--
-- Arreglo: `anotar` **solo escribe el identificador y deja la fila en
-- 'processing'**. No decide el desenlace porque no puede saberlo.
--
-- Y no hace falta que lo decida, verificado leyendo el ejecutor antes de tocar
-- nada: una fila 'processing' CON identificador es el «camino 1 · SEGUIR» del
-- adaptador (`dlocal-provider.ts:862`, `input.providerPayoutId` con
-- `reanudar`) — se le pregunta a `GET /v1/payouts/{id}` por ese id y se traduce
-- su estado. Es literalmente «el camino que acaba disparando NTF-12», y lo hace
-- solo cuando el proveedor dice DELIVERED o COMPLETED. La cola en vuelo del job
-- (`route.ts:231`) selecciona por `status='processing'` a secas, así que la fila
-- entra en la pasada siguiente sin que nadie la empuje.
--
-- O sea que `anotar` deja de ser «cerrar el payout» y pasa a ser lo que su
-- nombre dice: **darle al sistema el dato que le faltaba** para que la única
-- fuente honesta del estado —el proveedor— lo cierre. NTF-12 sigue saliendo,
-- pero cuando el dinero se ha movido.
--
--   ⚠️ Esto cambia el valor que devuelve `anotar`: 'processing', no 'paid'. El
--   panel ignora el retorno (`payout-actions.tsx` solo mira `error`), pero queda
--   dicho.
--
--   ⚠️ Y corrige el `comment on` de `20260902120000`, que dice «mark_paid y
--   anotar disparan NTF-12». Desde aquí, solo `mark_paid`.
--
-- ── DEFECTO 4 · `devolver` ACEPTABA ÓRDENES QUE YA TENÍAN IDENTIFICADOR ─────
--
-- La contraseña `COMPROBADO-SIN-RASTRO` afirma una cosa muy concreta: «he
-- buscado la marca en el panel del proveedor y no existe nada». Pero la función
-- **no exigía que `provider_payout_id` fuese null** — al contrario, tenía un
-- bloque entero para el caso de que lo tuviera, archivándolo y subiendo el
-- intento.
--
-- Una fila en 'processing' CON identificador es una en la que el sistema **ya
-- sabe que el payout existe**: ese id no lo tecleó nadie, lo escribió el propio
-- ejecutor al recibirlo del proveedor (`route.ts:578` y `:617`). La premisa de
-- la contraseña es falsa por construcción, y devolver esa orden a la cola es
-- ordenar un segundo pago sobre uno que consta creado.
--
-- Arreglo: `devolver` rechaza con `check_violation` cuando hay identificador, y
-- el mensaje dice qué hacer en su lugar. El candado de la contraseña solo tiene
-- sentido sobre las filas SIN identificador, que son las únicas de las que de
-- verdad no se sabe nada — las que `payouts_backlog()` cuenta en
-- `sin_identificar`. Con eso, el bloque de archivado de `devolver` se vuelve
-- código muerto y se borra.
--
-- ── DEFECTO 5 · LA REFERENCIA MANUAL CHOCABA CON EL ÍNDICE ÚNICO ────────────
--
-- `mark_paid` escribía `provider_payout_id = <la referencia que teclea el
-- admin>`, y `20260902130000` creó un índice único parcial sobre esa columna.
-- El caso que lo rompe es el normal del riel manual, no un caso raro: el admin
-- paga a tres tutores venezolanos con **un solo envío por lote** y usa el mismo
-- justificante para las tres órdenes. La primera cierra; la segunda y la tercera
-- revientan con un `duplicate key` crudo de Postgres, y las órdenes se quedan
-- abiertas con el dinero ya enviado.
--
-- Arreglo, y el razonamiento importa más que el cambio: **`provider_payout_id`
-- es el identificador que dio un proveedor**. En un pago manual no hay proveedor
-- que dé ninguno — hay un comprobante de una transferencia que hicimos nosotros.
-- Meter el uno donde va el otro es lo que puso en conflicto dos cosas que nunca
-- fueron la misma: el índice único existe para que dos órdenes no se adjudiquen
-- el mismo pago DEL PSP, y un justificante compartido por un pago en lote no es
-- eso.
--
-- Así que `mark_paid` deja `provider_payout_id` a NULL y guarda la referencia en
-- `provider_metadata`, junto al rastro que C2 ya escribe ahí. El índice conserva
-- su significado y el pago en lote deja de ser un error.
--
--   🔑 RUTA EXACTA, porque otro agente está tocando la pantalla del admin:
--        provider_metadata -> 'manual' -> 'referencia'   (texto)
--        provider_metadata -> 'manual' -> 'canal'        (texto: 'zelle', 'manual'…)
--        provider_metadata -> 'manual' -> 'pagado_en'    (timestamptz ISO)
--      Clave `manual` de primer nivel, HERMANA de `c2` y no dentro: `c2` es el
--      rastro del ejecutor y el job lo reescribe entero en cada `marca()`. Aquí
--      no lo pisa nadie (una fila 'paid' no vuelve a las colas del job, que solo
--      leen 'processing' y 'scheduled'), pero mezclarlas invitaría a que un día
--      sí.
--
-- Y de todas formas se atrapa `unique_violation` en la única rama que sigue
-- escribiendo `provider_payout_id` —`anotar`— y se traduce a un mensaje que
-- NOMBRA el payout que ya usa ese identificador, como ya hace
-- `upsert_manual_destination` (`20260902110000:503-516`). Sin eso, dos órdenes
-- que se disputan el mismo pago del PSP le devuelven al admin un 23505 crudo.
--
-- ── DEFECTO 6 (menor) · `mark_paid` desde 'failed' pisaba un id muerto ──────
--
-- `retry` y `devolver` archivan el `provider_payout_id` del payout rechazado en
-- `c2.intentos_muertos` antes de soltarlo, porque es la única traza que queda
-- para conciliar ese rechazo contra el panel del proveedor. `mark_paid` desde
-- 'failed' lo sobrescribía sin más. Se reutiliza el mismo archivado — **sin
-- subir `intento`**: eso solo tiene sentido cuando la orden vuelve a la cola y va
-- a salir con una marca nueva, y aquí la orden se cierra.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · `manage_payout` v3 — las seis acciones, bajo candado
-- ════════════════════════════════════════════════════════════════════════════
--
-- Misma firma de cuatro argumentos que `20260902120000`, así que `create or
-- replace` la sustituye de verdad y NO hay que repetir el `drop` de la vieja de
-- dos (ya no existe). Si un día hiciera falta cambiar la firma, léase la trampa
-- que documenta aquella migración en su sección 1 antes de tocar nada.
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

comment on function public.manage_payout(uuid, text, text, text) is
  'C2 v3 (2026-09-02, candados del dinero): la ÚNICA puerta del producto a los estados de un payout. Seis acciones: hold/release, retry (failed→scheduled limpiando y archivando el id muerto con intento+1), mark_paid (scheduled|failed|on_hold→paid; riel MANUAL de Venezuela y de todo lo que no tiene adaptador — exige referencia, que se guarda en provider_metadata->''manual''->>''referencia'' y NO en provider_payout_id, porque en un pago manual no hay proveedor que dé identificador y el índice único de esa columna hace imposible un pago en lote con un solo justificante), anotar (processing→processing: escribe el provider_payout_id y NADA MÁS — quien cierra la orden es el proveedor a través del job, porque encontrarla en su panel no es que esté pagada: dLocal las crea en PENDING) y devolver (processing→scheduled, SOLO si provider_payout_id es null, con la contraseña COMPROBADO-SIN-RASTRO). Lee la fila con for update y repite la condición de estado en cada update: sin eso, el admin marcando pagado pisaba el reclamo del cron y se pagaba dos veces. ⚠️ Solo mark_paid dispara NTF-12 «Se pagó tu liquidación», y eso es correcto: ahí una persona vio el movimiento. Desde anotar lo dispara el job cuando el proveedor confirma DELIVERED/COMPLETED.';

-- `create or replace` conserva privilegios (la firma no cambia), pero se
-- repiten: en Postgres el EXECUTE de una función NUEVA se concede a PUBLIC por
-- defecto, y con PostgREST eso es `POST /rest/v1/rpc/manage_payout` abierto a
-- `anon`. Si esta migración cayera sobre una base donde la función no existe,
-- estas tres líneas son lo único que lo impide.
revoke execute on function public.manage_payout(uuid, text, text, text) from public;
revoke execute on function public.manage_payout(uuid, text, text, text) from anon;
grant  execute on function public.manage_payout(uuid, text, text, text) to authenticated;

-- ponytail: TECHO HEREDADO Y NO CERRADO — esta función sigue sin registrar QUIÉN
-- pulsó. No hay tabla de auditoría de acciones de admin en el proyecto y no se
-- crea una aquí. La traza que queda es la referencia tecleada, el canal,
-- `paid_at` y el `updated_at` del trigger. Con `anotar` cambiando de significado,
-- la pregunta «¿quién anotó este id?» se vuelve algo más probable que ayer; el
-- sitio sigue siendo una `admin_actions` que sirva también a `20260828130000`.
--
-- ponytail: SEGUNDO TECHO — `anotar` deja la fila en 'processing' y confía en que
-- el job la cierre. Si el job está parado (sin `CRON_SECRET`, sin credencial de
-- dLocal, o el reloj de Actions entregando cada 2-6 horas en vez de cada 5
-- minutos), la orden se queda en vuelo y el tutor sin su NTF-12 aunque el dinero
-- haya salido. Es lo correcto igualmente —el retraso es visible en
-- `payouts_backlog()`, la mentira no lo era— pero conviene saberlo antes de
-- buscar el fallo en otro sitio.


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · `refund_payment` v4 — la orden en vuelo se lee BAJO CANDADO
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cuerpo íntegro de `20260902130000` (en Postgres una función no se parchea, se
-- reescribe entera) con DOS cambios, los dos en el mismo sitio:
--
--   1. el `select` del `payout_item` y su payout lleva `for update of po, pi`;
--   2. después de tener el candado se RELEE el estado del payout, y todo el
--      bloque S-29 razona sobre ese estado releído (`v_estado_payout`) y no
--      sobre el que se vio antes de bloquear.
--
-- Lo demás se conserva tal cual, y es lo fácil de perder al copiar:
--   · `has_role('admin')` como primera línea (S-15/RN-26);
--   · solo se reembolsa lo cobrado ('paid' / 'partially_refunded');
--   · el importe acotado a `gross_amount - refunded_amount`, y el acumulado que
--     nunca retrocede;
--   · `enqueue_refund` con su clave de idempotencia `X01:payment:<id>:<total>`;
--   · el bloque S-29 entero, el paso de la reserva a 'refunded' (M4) y el jsonb
--     de vuelta {refunded_amount, total_refunded, status, clawback_needed}, que
--     es lo que consume `admin/payments/[id]/refund-form.tsx`.
create or replace function public.refund_payment(
  p_payment_id uuid,
  p_amount     bigint default null   -- null = reembolsar todo lo que quede
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay            record;
  v_remaining      bigint;
  v_amount         bigint;
  v_new_total      bigint;
  v_full           boolean;
  v_new_status     public.payment_status;
  v_clawback       boolean := false;
  v_item           record;
  -- El estado del payout releído DESPUÉS de bloquearlo. Es el que manda.
  v_estado_payout  public.payout_status;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin reembolsa' using errcode = 'insufficient_privilege';
  end if;

  select id, booking_id, status, gross_amount, refunded_amount
    into v_pay
  from public.payments where id = p_payment_id;
  if v_pay.id is null then
    raise exception 'pago no encontrado' using errcode = 'no_data_found';
  end if;

  -- Solo se reembolsa lo que se cobró.
  if v_pay.status not in ('paid', 'partially_refunded') then
    raise exception 'el pago no está cobrado (está: %)', v_pay.status using errcode = 'check_violation';
  end if;

  v_remaining := v_pay.gross_amount - v_pay.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);   -- por defecto, el resto
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe inválido: entre 1 y % (queda por reembolsar)', v_remaining
      using errcode = 'check_violation';
  end if;

  v_new_total := v_pay.refunded_amount + v_amount;
  v_full := v_new_total >= v_pay.gross_amount;
  v_new_status := case when v_full then 'refunded' else 'partially_refunded' end;

  -- El item del payout se busca UNA vez y arriba, porque de él depende si este
  -- reembolso puede siquiera empezar. `payout_items.payment_id` es único
  -- (`20260716140000:48`), así que esto devuelve como mucho una fila.
  if v_full then
    -- 🔴 EL CANDADO (defecto 2). `for update of po, pi` bloquea la orden de pago
    -- y su línea hasta el final de esta transacción. Sin él, entre este `select`
    -- y los `delete` de más abajo cabe entero el reclamo del ejecutor: leeríamos
    -- 'scheduled', el job pondría 'processing' y crearía el payout en el
    -- proveedor, y este reembolso borraría después la fila con su
    -- `provider_payout_id` dentro. El dinero saldría igual y no quedaría ni la
    -- fila para conciliarlo.
    --
    -- Y bloquea también `pi` porque es la fila que se borra: bloquear solo el
    -- padre dejaría la línea a merced de otra transacción.
    select pi.id as item_id, pi.amount as item_amount, po.id as payout_id, po.status as payout_status
      into v_item
    from public.payout_items pi
    join public.payouts po on po.id = pi.payout_id
    where pi.payment_id = p_payment_id
    for update of po, pi;

    -- La relectura explícita. Con el `for update` puesto, `v_item.payout_status`
    -- ya viene de la versión bloqueada, así que esto es cinturón sobre tirantes;
    -- va igualmente porque es lo que hace que el invariante siga leyéndose en el
    -- código el día que alguien reordene el `select`.
    if v_item.payout_id is not null then
      select po.status into v_estado_payout
        from public.payouts po
       where po.id = v_item.payout_id;
    end if;

    -- 🔴 EL GUARDIÁN (de `20260902130000`, intacto salvo que ahora mira el
    -- estado releído). 'processing' es una orden que el proveedor tiene entre
    -- manos. Ni se le quita el item ni se le resta el importe ni —lo
    -- irreversible— se borra la fila con su identificador.
    if v_estado_payout = 'processing'::public.payout_status then
      raise exception
        'hay una orden de pago en ejecución para este importe (payout %): espera a que el proveedor la confirme —el job la deja en pagada o rechazada, y entonces este reembolso ya sabe qué hacer— y repite. Si lleva más de un día parada, mírala desde el panel o con select * from public.payouts_backlog().',
        v_item.payout_id
        using errcode = 'check_violation';
    end if;
  end if;

  update public.payments
     set status = v_new_status, refunded_amount = v_new_total
   where id = p_payment_id;

  -- X-01 · el dinero, no solo el estado.
  perform public.enqueue_refund(
    v_pay.id,
    v_amount,
    'US-704 · reembolso manual desde el panel admin',
    'X01:payment:' || v_pay.id || ':' || v_new_total
  );

  -- S-29: solo en reembolso TOTAL se toca el payout (el prorrateo parcial del
  -- neto es DP-03, manual). El item ya está leído y bloqueado arriba.
  if v_full then
    if v_item.item_id is not null then
      if v_estado_payout = 'paid'::public.payout_status then
        -- Ya se pagó al tutor → clawback manual (no automatizado, MVP/S-29).
        v_clawback := true;
      else
        -- 'pending', 'scheduled', 'on_hold' o 'failed': nadie está pagando esto.
        -- ('processing' no llega aquí: lo cortó el guardián de arriba.)
        -- Se excluye el item y se ajusta/limpia el payout.
        delete from public.payout_items where id = v_item.item_id;
        update public.payouts
           set amount = amount - v_item.item_amount
         where id = v_item.payout_id;
        -- Si el payout se quedó sin items, se elimina (no estaba pagado).
        delete from public.payouts po
         where po.id = v_item.payout_id
           and not exists (select 1 from public.payout_items x where x.payout_id = po.id);
      end if;
    end if;

    -- M4: reembolso total → la reserva pasa a refunded (cierre financiero).
    update public.bookings set status = 'refunded'
     where id = v_pay.booking_id and status <> 'refunded';
  end if;

  -- NTF-10 lo dispara el trigger de `payments` (20260716170000), no esta
  -- función. Ojo: avisa al ACORDAR el reembolso; el dinero sale cuando el job
  -- vacíe la cola.
  return jsonb_build_object(
    'refunded_amount', v_amount,
    'total_refunded',  v_new_total,
    'status',          v_new_status::text,
    'clawback_needed', v_clawback
  );
end;
$$;

comment on function public.refund_payment(uuid, bigint) is
  'US-704 · reembolso manual del admin (total o parcial), server-side y solo admin. S-29: un reembolso TOTAL saca el payout_item del payout no liquidado y lo ajusta o borra; si el payout ya está ''paid'' devuelve clawback_needed=true (manual, MVP). ⚠️ Un payout en ''processing'' NO se toca (20260902130000): la orden está en manos del proveedor y borrarla perdería su provider_payout_id, que es lo único que la concilia. ⚠️ Desde 20260902160000 esa comprobación se hace BAJO CANDADO (for update of po, pi) y releyendo el estado: sin el candado, el reclamo del ejecutor cabía entre la lectura y el delete y el reembolso borraba una orden que el proveedor acababa de crear.';

revoke execute on function public.refund_payment(uuid, bigint) from public;
revoke execute on function public.refund_payment(uuid, bigint) from anon;
grant  execute on function public.refund_payment(uuid, bigint) to authenticated;

-- ponytail: TECHO ACEPTADO — `public.payments` se sigue leyendo SIN `for
-- update`, así que dos reembolsos totales simultáneos del mismo pago siguen
-- pudiendo solaparse. No se toca aquí por dos motivos: no es el defecto que se
-- vino a arreglar, y ya está mitigado donde importa —`enqueue_refund` lleva la
-- clave de idempotencia `X01:payment:<id>:<total>`, y dos pasadas concurrentes
-- calculan el MISMO total, así que la segunda choca contra esa clave y el dinero
-- no sale dos veces—. Lo que sí puede quedar mal es `refunded_amount`. El día
-- que se cierre, ojo al orden de bloqueo: aquí sería payments → payouts, y
-- `manage_payout` bloquea solo payouts, así que no hay ciclo hoy.


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · LO QUE HAY QUE MIRAR EL DÍA QUE ESTO SE APLIQUE (regla de oro 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ NO APLICADA. Se escribió sin `db:push` (el encargo lo prohibía), así que
-- `create or replace` ni siquiera ha validado su sintaxis contra el servidor. Y
-- validar la sintaxis no es ejecutar el cuerpo: el fallo de
-- `close_expired_sessions()` sobrevivió a una reescritura entera de la función.
--
-- a) Que sigue habiendo UNA sola firma de `manage_payout`. Si salen dos, el
--    `drop` de `20260902120000` no llegó a aplicarse y el panel puede estar
--    llamando a la vieja de dos argumentos:
--
--      select p.oid::regprocedure
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'manage_payout';
--
-- b) Que el cuerpo corre. Con la sesión de un admin, buscando el error de guarda
--    y no el éxito (esto NO mueve dinero):
--
--      select public.manage_payout(
--               (select id from public.payouts where status = 'scheduled' limit 1),
--               'mark_paid');
--      -- esperado: «mark_paid exige una referencia del movimiento real…»
--
-- c) Que `mark_paid` deja `provider_payout_id` a null y la referencia en el
--    jsonb — que es el cambio que otro código tiene que aprender:
--
--      select id, status, provider, provider_payout_id,
--             provider_metadata -> 'manual' as manual
--        from public.payouts
--       where provider_metadata ? 'manual'
--       order by paid_at desc limit 5;
--
-- d) Que los pg_cron de payouts no se han roto por el camino. Ninguno cuelga de
--    estas dos funciones, pero comparten tabla y esta migración cambia qué
--    columnas se escriben. **Agregando por jobname**, que leer las diez últimas
--    filas de `cron.job_run_details` solo enseña los jobs frecuentes y
--    `run-payout-batch` corre una vez por semana — puede llevar semanas roto sin
--    aparecer:
--
--      select j.jobname, d.status, count(*) as veces,
--             max(d.start_time) as ultima, max(d.return_message) as ultimo_mensaje
--        from cron.job_run_details d
--        join cron.job j using (jobid)
--       group by 1, 2
--       order by 1, 2;
--
-- e) Que la cifra que nunca puede quedarse arriba se mueve como debe. Con
--    `anotar` dejando la fila en vuelo, `sin_identificar` baja al anotar (la
--    orden pasa a tener id) pero `en_vuelo` NO baja hasta que el job la cierre:
--
--      select public.payouts_backlog();
