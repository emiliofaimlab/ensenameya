-- ============================================================================
-- Enséñame Ya — Doc 33 · el correo sabe de qué habla
-- (`pending_email_notifications` saca el lote CON el contexto ya resuelto)
--
-- QUÉ PASABA. Las plantillas del Doc 33 pintan la reserva —qué clase, con quién,
-- a qué hora, cuánto, hasta cuándo—, pero en la cola solo hay ids. Y es a
-- propósito: `enqueue_notification` no es más que un `insert … on conflict do
-- nothing` sobre una tabla sin triggers ni FK hacia nada que pueda faltar,
-- porque corre DENTRO de la transacción que cobra o que confirma una reserva.
-- Cualquier cosa más lista ahí dentro convertiría un fallo de correo en un
-- fallo de cobro. Resultado: el trigger deja `{"booking_id": …}` y el correo no
-- puede decir a qué hora es la clase.
--
-- POR QUÉ SE RESUELVE AQUÍ Y NO EN SEIS TRIGGERS. Tres motivos, y el tercero es
-- el que decide:
--
--   1. UNA consulta por lote en vez de un N+1 por notificación. El job manda de
--      50 en 50; resolver la reserva desde el route handler serían 50 viajes
--      más a la BD por pasada, y las pasadas de GitHub Actions ya llegan de dos
--      en dos horas (la cadencia de 5 minutos es una ficción medida).
--   2. Las filas YA ENCOLADAS salen completas. Si el contexto lo escribiera el
--      trigger, todo lo pendiente de antes de hoy se enviaría pelado y haría
--      falta un backfill que adivinara el pasado.
--   3. 🔴 EL CONTEXTO SE LEE AL ENVIAR, NO AL ENCOLAR. Entre que se encola y que
--      sale el correo pasan horas: el tutor puede haber cambiado el nombre que
--      muestra, el alumno su nombre, y la reserva su importe tras un reembolso
--      parcial. Lo que se manda es lo que es verdad cuando se manda.
--
-- 🔴 CAMBIAR EL `returns table` ES `drop` + `create`, JAMÁS `create or replace`
-- (regla de oro 12): PostgreSQL no deja cambiar el tipo de retorno en un
-- replace, y con un argumento distinto lo que haría sería una SOBRECARGA, que
-- es como `20260910190000` rompió el formulario bancario del tutor con un
-- PGRST203. Y el `drop` SE LLEVA LOS CUATRO PRIVILEGIOS: se reponen abajo los
-- tres `revoke` y el `grant` a `service_role`. Sin ese grant el job no come un
-- fallo de build ni de typecheck: come `permission denied` en TIEMPO DE
-- EJECUCIÓN, y la cola se queda quieta sin que nadie se entere.
--
-- LO QUE ESTA MIGRACIÓN NO INVENTA. Hay cuatro claves del contrato del contexto
-- que el esquema de hoy NO puede responder, y se omiten en vez de rellenarse
-- con algo parecido: un correo con un dato inventado es peor que un correo con
-- una línea menos. Cada una lleva su porqué en el sitio donde se omite:
-- `metodo` (nadie guarda la marca ni los 4 últimos de la tarjeta con la que se
-- cobró), `cancelado_por` (`bookings.cancel_reason` es el texto libre que
-- escribió quien canceló, no un quién) y las dos referencias legibles
-- `payout.ref` y `pedido.ref` (`bookings` tiene `booking_ref`; `payouts` y
-- `orders` no tienen nada equivalente).
--
-- `dias` (NTF-23) tampoco se resuelve aquí, y esa sí está resuelta: la pone
-- `avisar_payouts_sin_reclamar` en el payload, que es de donde la lee primero la
-- plantilla. Duplicarla en el contexto solo abriría la puerta a que discreparan.
-- ============================================================================

-- ── 0) Dos ayudas puras: que un payload raro no tumbe el lote entero ────────

-- ⚠️ UN CAST DIRECTO `(payload->>'booking_id')::uuid` TUMBA LA CONSULTA ENTERA
-- —o sea, TODO el correo de la pasada— si una sola fila trae algo que no es un
-- uuid. Pasa con payloads de pruebas y con cualquier encolador futuro que se
-- equivoque de clave. Esto devuelve null y esa notificación sale sin ficha,
-- que es exactamente lo que tiene que pasar: una menos, no todas.
create or replace function public.uuid_o_nulo(p_texto text)
returns uuid
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
           when p_texto ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             then p_texto::uuid
         end;
$$;

comment on function public.uuid_o_nulo(text) is
  'Castea a uuid lo que lo parezca y devuelve null en vez de reventar. Existe porque los ids del correo salen de notifications.payload, que es jsonb libre: un solo valor mal formado haría fallar la consulta que saca TODO el lote pendiente.';

-- ⚠️ Y las fechas van en ISO-8601 UTC EXPLÍCITO, no por `to_jsonb`: ese usa el
-- GUC `TimeZone` de la sesión, así que el mismo dato saldría con un offset u
-- otro según quién llame. El correo las pinta luego en el huso del destinatario
-- (RN-35) y para eso necesita un instante sin ambigüedad (regla de oro 4).
create or replace function public.iso_utc(p_momento timestamptz)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_char(p_momento at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

comment on function public.iso_utc(timestamptz) is
  'Un timestamptz como ISO-8601 en UTC, sin depender del GUC TimeZone de la sesión (que es lo que sí hace to_jsonb). Lo consume el correo, que reformatea en el huso del destinatario (RN-35).';

revoke execute on function public.uuid_o_nulo(text) from public;
revoke execute on function public.uuid_o_nulo(text) from anon;
revoke execute on function public.uuid_o_nulo(text) from authenticated;
revoke execute on function public.iso_utc(timestamptz) from public;
revoke execute on function public.iso_utc(timestamptz) from anon;
revoke execute on function public.iso_utc(timestamptz) from authenticated;
-- Sin grant a `service_role` a propósito: las llama `pending_email_notifications`,
-- que es SECURITY DEFINER y corre como su dueño. Nadie más tiene por qué.

-- ── 1) El lote pendiente, con correo, huso y contexto ───────────────────────
drop function if exists public.pending_email_notifications(int);

create function public.pending_email_notifications(p_limit int default 50)
returns table (
  id       uuid,
  type     text,
  template text,
  payload  jsonb,
  email    text,
  nombre   text,
  timezone text,
  contexto jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  -- El lote se acota ANTES de resolver nada: los laterales de abajo se ejecutan
  -- sobre 50 filas, no sobre la cola entera.
  with lote as (
    select n.id, n.type, n.template, n.payload, n.recipient_id, n.created_at
      from public.notifications n
     where n.status  = 'pending'
       and n.channel = 'email'
     order by n.created_at        -- lo más viejo primero: nadie se queda atrás
     limit greatest(1, least(p_limit, 200))
  )
  select
    l.id,
    l.type,
    l.template,
    l.payload,

    -- ⚠️ EL CORREO DEL PAYLOAD MANDA SOBRE EL DE `auth.users`, y el join a auth
    -- pasa a LEFT por lo mismo. El aviso de baja de cuenta se encola DESPUÉS de
    -- que `anonymize_account` haya reescrito `auth.users.email` a
    -- `cuenta-eliminada+<uuid>@ensenameya.invalid`: leyendo auth mandaríamos el
    -- «tu cuenta está borrada» a una dirección que no existe, que es justo el
    -- único correo que esa persona todavía tiene que recibir. Quien encola una
    -- baja pone la dirección real en el payload; los demás no ponen nada y
    -- siguen saliendo de auth.
    coalesce(nullif(l.payload->>'email', ''), u.email::text),

    coalesce(pf.full_name, ''),

    -- RN-35: la hora se pinta en el huso del DESTINATARIO. Un recordatorio en la
    -- hora del servidor es un no-show.
    coalesce(nullif(pf.timezone, ''), 'UTC'),

    -- ── el contexto ───────────────────────────────────────────────────────
    -- `jsonb_strip_nulls` es el contrato: una clave que no se pudo resolver
    -- DESAPARECE. Nunca null, nunca cadena vacía — las plantillas se apoyan en
    -- eso para caerse bloque a bloque en vez de pintar «Cuándo: undefined».
    jsonb_strip_nulls(jsonb_build_object(
      'clase',        bk.clase,
      'tutor',        bk.tutor,
      'alumno',       bk.alumno,
      'inicio',       bk.inicio,
      'duracion_min', bk.duracion_min,
      'importe',      bk.importe,
      'moneda',       coalesce(bk.moneda, po.moneda, od.moneda),
      'neto_tutor',   bk.neto_tutor,
      'limite',       bk.limite,
      'sesion_id',    bk.sesion_id,
      'tutor_id',     coalesce(bk.tutor_id, rv.tutor_id),
      'product_id',   bk.product_id,
      'reembolso',    bk.reembolso,

      -- Los cuatro últimos de la cuenta de cobro del tutor. Solo tiene sentido
      -- si el destinatario ES el tutor, y lo es en los dos únicos correos que lo
      -- pintan (liquidación pagada y cambio de datos de cobro).
      -- ⚠️ Se calla cuando el payout salió por PayPal: ahí el dinero no fue a
      -- esa cuenta bancaria, y decirle «a tu cuenta ···· 4242» sería mentirle
      -- sobre dónde buscarlo.
      'cuenta',       case when po.provider = 'paypal' then null
                           else cta.bank_account_last4 end,

      -- El motivo del rechazo de KYC. Lo escribe el admin en la cola de
      -- aprobación; vacío = no hubo motivo y la plantilla pinta el cuerpo neutro.
      'motivo',       nullif(tpd.approval_notes, ''),

      'payout', case when po.id is null then null else jsonb_build_object(
        -- `payouts` no tiene referencia legible (sí la tiene `bookings`, y se
        -- llama `booking_ref`). Inventar aquí un «PO-1234» sería inventar algo
        -- que el tutor no puede buscar en ningún sitio, así que la clave no va y
        -- la plantilla se cae sola.
        'bruto',    po.bruto,
        'comision', po.comision,
        'neto',     po.neto,
        'moneda',   po.moneda,
        'sesiones', po.sesiones,
        'desde',    po.desde,
        'hasta',    po.hasta
      ) end,

      'pedido', case when od.total is null then null else jsonb_build_object(
        -- Ídem: `orders` no tiene `order_ref`. Sin clave, el recibo no pinta la
        -- línea «Pedido …» y sigue siendo un recibo correcto.
        'total',      od.total,
        'moneda',     od.moneda,
        'pendientes', od.pendientes,
        'lineas',     od.lineas
      ) end,

      'resena', case when rv.rating is null then null else jsonb_build_object(
        'rating',  rv.rating,
        'comment', nullif(rv.comment, ''),
        -- ⚠️ NULL = reseña anónima, y ahí se OMITE la clave: la plantilla pinta
        -- «Un alumno». Poner el nombre real sería publicar lo que el alumno
        -- decidió no firmar (decisión 18). La firma es un consentimiento.
        'autor',   nullif(rv.author_display, ''),
        'media',   rv.media,
        'total',   rv.total
      ) end

      -- `metodo` («Visa ···· 4242») NO SALE: hoy nadie guarda con qué tarjeta se
      -- cobró. `payments.provider_metadata` solo lleva el rastro del cobrador
      -- (quién cobró y cuándo se anotó), y `payment_methods` —que sí tiene marca
      -- y last4— es la lista de tarjetas guardadas de una persona, sin ningún
      -- vínculo con el pago concreto: elegir «la suya» sería adivinar cuál usó.
      --
      -- `cancelado_por` tampoco: `bookings.cancel_reason` es el texto libre que
      -- escribió quien canceló («motivo — detalle»), no un quién, y en las
      -- cancelaciones por vencimiento o desde admin es null. El dato existe
      -- dentro de `cancel_booking` (sabe si quien cancela es el tutor) pero no
      -- se persiste en ninguna columna.
    ))

  from lote l
  left join auth.users      u  on u.id  = l.recipient_id
  left join public.profiles pf on pf.id = l.recipient_id

  -- Los datos de cobro del destinatario: PK por tutor, una fila como mucho.
  left join public.tutor_payout_accounts cta on cta.tutor_id = l.recipient_id
  -- Y su ficha de tutor, de donde sale el motivo del rechazo de KYC.
  left join public.tutor_profiles        tpd on tpd.profile_id = l.recipient_id

  -- Los ids del payload, casteados UNA vez por notificación.
  cross join lateral (
    select public.uuid_o_nulo(l.payload->>'booking_id') as booking_id,
           public.uuid_o_nulo(l.payload->>'payout_id')  as payout_id,
           public.uuid_o_nulo(l.payload->>'order_id')   as order_id,
           public.uuid_o_nulo(l.payload->>'review_id')  as review_id,
           -- ⚠️ EL HUSO, COMPROBADO CONTRA EL CATÁLOGO. El desglose del pedido
           -- es el único sitio donde la BD tiene que formatear una fecha ella
           -- misma, y `at time zone <columna>` LEVANTA EXCEPCIÓN con un huso
           -- desconocido. `profiles.timezone` es texto libre que llega del
           -- navegador al registrarse: una sola fila con basura tumbaría la
           -- consulta que saca TODO el lote, o sea el correo entero de la
           -- pasada. Se mira solo cuando hay pedido, que es cuando hace falta.
           case
             when nullif(l.payload->>'order_id', '') is null then 'UTC'
             else coalesce((select tn.name
                              from pg_catalog.pg_timezone_names tn
                             where tn.name = pf.timezone),
                           'UTC')
           end as huso
  ) ids

  -- ── la reserva y todo lo que cuelga de ella ─────────────────────────────
  -- Un lateral y no una subconsulta por columna: así la reserva, la clase, las
  -- dos personas, la primera sesión y el pago se resuelven en UNA pasada por
  -- notificación en vez de en ocho.
  left join lateral (
    select pr.title                                as clase,
           pr.id                                   as product_id,
           -- El tutor se presenta como se presenta en su ficha; su nombre legal
           -- solo si no puso otro.
           coalesce(tp.display_name, tu.full_name) as tutor,
           b.tutor_id                              as tutor_id,
           al.full_name                            as alumno,
           b.session_duration_min                  as duracion_min,
           b.total_amount                          as importe,
           b.currency                              as moneda,
           -- Lo que se lleva el tutor por esta reserva. Va aparte de `importe`
           -- porque en sus correos enseñar lo que pagó el alumno sería enseñarle
           -- la comisión al revés.
           pmt.tutor_net_amount                     as neto_tutor,
           ses.id                                  as sesion_id,
           public.iso_utc(ses.start_at)            as inicio,
           -- RN-38: las 24 h de aceptación se cuentan desde que el dinero entró.
           -- Sin `paid_at` no hay plazo que contar y la clave desaparece.
           public.iso_utc(pmt.paid_at + interval '24 hours') as limite,
           -- El 0 se va con el `strip_nulls`: «te devolvimos 0» no es un aviso.
           nullif(pmt.refunded_amount, 0)           as reembolso
      from public.bookings b
      left join public.products       pr on pr.id = b.product_id
      left join public.profiles       tu on tu.id = b.tutor_id
      left join public.tutor_profiles tp on tp.profile_id = b.tutor_id
      left join public.profiles       al on al.id = b.student_id
      -- Un pago por reserva (`payments.booking_id` es único).
      left join public.payments       pmt on pmt.booking_id = b.id
      -- La PRIMERA sesión: es la que el correo anuncia y la que enlaza el .ics.
      left join lateral (
        select s.id, s.start_at
          from public.sessions s
         where s.booking_id = b.id
         order by s.start_at
         limit 1
      ) ses on true
     where b.id = ids.booking_id
  ) bk on true

  -- ── la liquidación ──────────────────────────────────────────────────────
  left join lateral (
    select py.id,
           py.provider,
           py.currency     as moneda,
           -- `payouts.amount` ES el neto: se construye sumando
           -- `payments.tutor_net_amount` (ver `build_payout_for_tutor`).
           py.amount       as neto,
           it.bruto,
           it.comision,
           it.sesiones,
           it.desde,
           it.hasta
      from public.payouts py
      left join lateral (
        -- El desglose sale de los pagos que componen el lote, no de una cuenta
        -- aparte: `gross = platform_fee + tutor_net` por construcción, así que
        -- bruto − comisión cuadra con el neto y el correo no se contradice.
        select count(*)::int                   as sesiones,
               sum(pm.gross_amount)::bigint    as bruto,
               sum(pm.platform_fee_amount)::bigint as comision,
               -- El periodo es el de las clases IMPARTIDAS, no el de los cobros:
               -- el alumno pudo pagar meses antes.
               public.iso_utc(min(bo.completed_at)) as desde,
               public.iso_utc(max(bo.completed_at)) as hasta
          from public.payout_items pi
          join public.payments pm on pm.id = pi.payment_id
          join public.bookings bo on bo.id = pm.booking_id
         where pi.payout_id = py.id
      ) it on true
     where py.id = ids.payout_id
  ) po on true

  -- ── el pedido multi-línea ───────────────────────────────────────────────
  -- No hay tabla de líneas: las líneas SON las reservas con ese `order_id`.
  left join lateral (
    select o.currency                     as moneda,
           sum(b2.total_amount)::bigint   as total,
           (count(*) filter (where b2.status = 'pending_acceptance'))::int as pendientes,
           jsonb_agg(
             jsonb_build_object(
               'titulo',  pr2.title,
               -- «Ana Pérez · 15/09 18:00», ya montado. La fecha va NUMÉRICA a
               -- propósito: `to_char` con mes en letra depende del `lc_time` del
               -- servidor y escribiría «September» en un correo en español.
               'sub',     nullif(concat_ws(' · ',
                            coalesce(tp2.display_name, tu2.full_name),
                            to_char(ses2.start_at at time zone ids.huso, 'DD/MM HH24:MI')
                          ), ''),
               'importe', b2.total_amount,
               'moneda',  b2.currency
             )
             order by ses2.start_at nulls last, b2.created_at
           ) as lineas
      from public.orders o
      join public.bookings b2 on b2.order_id = o.id
      left join public.products       pr2 on pr2.id = b2.product_id
      left join public.profiles       tu2 on tu2.id = b2.tutor_id
      left join public.tutor_profiles tp2 on tp2.profile_id = b2.tutor_id
      left join lateral (
        select s2.start_at
          from public.sessions s2
         where s2.booking_id = b2.id
         order by s2.start_at
         limit 1
      ) ses2 on true
     where o.id = ids.order_id
     group by o.id, o.currency
  ) od on true

  -- ── la reseña ───────────────────────────────────────────────────────────
  left join lateral (
    select r.rating,
           r.comment,
           r.author_display,
           r.tutor_id,
           tpr.rating_avg   as media,
           tpr.rating_count as total
      from public.reviews r
      left join public.tutor_profiles tpr on tpr.profile_id = r.tutor_id
     where r.id = ids.review_id
  ) rv on true

  order by l.created_at;
$$;

comment on function public.pending_email_notifications(int) is
  'Doc 33: el lote de correo pendiente con TODO resuelto —dirección, huso del destinatario (RN-35) y el contexto que pintan las plantillas (clase, tutor, alumno, hora, importe, plazo de RN-38, liquidación, pedido y reseña)—. El contexto se resuelve aquí y no en los triggers por tres motivos: una consulta por lote en vez de un N+1, las filas ya encoladas salen completas sin backfill, y lo que se manda es lo que es verdad al ENVIAR y no al encolar. Las claves que no se pueden resolver desaparecen (jsonb_strip_nulls): la plantilla se cae bloque a bloque en vez de pintar un dato falso. El correo sale del payload antes que de auth.users porque la baja de cuenta se encola con auth.users.email ya anonimizado.';

-- Reponer LOS CUATRO privilegios que se llevó el `drop` (regla de oro 12). Sin
-- el grant, el job no falla en el build: falla en ejecución con
-- `permission denied` y la cola se queda quieta en silencio (regla de oro 9).
revoke execute on function public.pending_email_notifications(int) from public;
revoke execute on function public.pending_email_notifications(int) from anon;
revoke execute on function public.pending_email_notifications(int) from authenticated;
grant  execute on function public.pending_email_notifications(int) to service_role;
