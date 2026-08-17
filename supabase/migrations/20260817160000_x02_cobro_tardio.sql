-- ============================================================================
-- Enséñame Ya — X-02: se podía cobrar por una clase que ya no existía
-- (RN-26 / RN-27 / RN-34 · regla de oro 2)
--
-- EL AGUJERO, con tres piezas que POR SEPARADO están bien:
--
--   1. `expire_stale_bookings` (20260709190000, pg_cron cada 5 min) cancela la
--      reserva que lleva 20 minutos sin pagar, libera el horario y deja el
--      pago en 'failed'.
--   2. La Checkout Session se creaba SIN `expires_at`, así que vivía el default
--      de Stripe: 24 HORAS. La reserva moría a los 20 minutos y el formulario
--      de pago seguía vivo un día entero.
--   3. `confirm_payment` es idempotente contra 'paid', 'refunded' y
--      'partially_refunded'... pero 'failed' NO estaba en esa lista.
--
-- Juntas: dejas el checkout abierto 21 minutos, pagas, y el webhook pisa el
-- 'failed' con un 'paid'. El pago queda cobrado y la reserva sigue 'cancelled'
-- —el `update` de bookings tiene `and status = 'pending_payment'`, así que ni
-- siquiera revive—, el horario ya se le dio a otro y nadie se entera. Sin
-- clase, sin aviso y sin reembolso. No hace falta mala fe: basta con ir a por
-- un café a mitad del checkout.
--
-- SE ARREGLA EN TRES SITIOS, Y ESTA MIGRACIÓN ES DOS DE ELLOS:
--   (a) `expires_at` en la Session (src/app/api/pagos/checkout) — acorta la
--       ventana de 24 h al mínimo que Stripe permite. Reduce el caso, no lo
--       cierra: Stripe no acepta menos de 30 minutos.
--   (b) el webhook comprueba la reserva antes de confirmar y, si ya no espera
--       cobro, REEMBOLSA de verdad (src/app/api/webhooks/stripe) — esa es la
--       red de seguridad real, y necesita la tabla de abajo.
--   (c) esta migración: que la propia función se niegue a acreditar un pago ya
--       resuelto, venga de donde venga el evento.
--
-- Por qué (c) aunque (b) ya lo tape: (b) es código de Stripe. DLocal entra
-- mañana por otro Route Handler y llamará a la misma RPC; el día que se
-- escriba, la barrera tiene que estar en la base de datos y no en el criterio
-- de quien lo escriba. Es la misma lógica que el `and status = 'pending_payment'`
-- que ya lleva el update de bookings desde EP-06.
-- ============================================================================

-- ── 1) Constancia de los cobros que hubo que devolver ───────────────────────
--
-- POR QUÉ UNA TABLA NUEVA Y NO `payments`. Ese cobro NO pertenece a la reserva:
-- llegó cuando ya estaba cancelada (o cuando ya se había pagado por otra
-- Session). Marcar `payments.status = 'refunded'` contaría en la contabilidad
-- de la reserva un dinero que nunca fue suyo, y en el caso del cobro duplicado
-- pisaría el estado del cobro bueno. El pago de la reserva se queda como está
-- ('failed' o 'paid') y el dinero que entró y salió se anota aquí.
--
-- OJO — esto NO es el reembolso de la plataforma (RN-37, X-01). Aquellos hoy
-- solo escriben `payments.status='refunded'` en Postgres sin mover un céntimo.
-- Los de esta tabla SÍ movieron dinero: son `refunds.create` contra Stripe,
-- porque son cobros que no debieron ocurrir.
create table public.late_payment_refunds (
  id                  uuid        primary key default gen_random_uuid(),

  -- La reserva que el cobro decía pagar. `cascade` como el resto de tablas
  -- colgadas de bookings: si se borra la persona y con ella su reserva, esto
  -- deja de tener a qué referirse.
  booking_id          uuid        not null references public.bookings (id) on delete cascade,

  -- Agnóstico de PSP como el resto del dinero (S-16): hoy solo escribe Stripe,
  -- pero DLocal entra por la misma puerta.
  provider            text        not null default 'stripe',

  -- ⚠️ ESTA ES LA IDEMPOTENCIA. El webhook de Stripe reentrega el mismo evento
  -- durante tres días; sin el `unique` un reintento reembolsaría dos veces. El
  -- handler consulta esta columna ANTES de llamar a la API, y además manda su
  -- propia `idempotencyKey` a Stripe por si dos entregas corren a la vez.
  provider_payment_id text        not null unique,     -- pi_…
  provider_refund_id  text,                            -- re_…; null si Stripe dijo que ya estaba devuelto

  -- Qué evento lo disparó, para poder seguirlo en el panel de Stripe.
  event_id            text,

  -- Unidades menores, igual que `payments.gross_amount`. Sale del objeto de
  -- reembolso y no de nuestra tabla: lo que importa es lo que se movió de
  -- verdad, no lo que creíamos que valía.
  amount              bigint      not null,
  currency            char(3)     not null,

  -- El estado que tenía la reserva cuando entró el cobro. Es el «por qué» de
  -- este reembolso: 'cancelled' = el cron liberó el horario; 'pending_acceptance'
  -- o 'confirmed' = ya estaba pagada y esto era un cobro duplicado.
  booking_status      public.booking_status not null,
  reason              text        not null,

  created_at          timestamptz not null default now()
);

comment on table public.late_payment_refunds is
  'X-02: cobros que llegaron cuando la reserva ya no esperaba pago y se devolvieron de verdad contra el PSP. Append-only.';

create index late_payment_refunds_booking_idx on public.late_payment_refunds (booking_id);
create index late_payment_refunds_created_idx on public.late_payment_refunds (created_at desc);

-- Sin trigger de `updated_at` a propósito: la fila se escribe una vez, después
-- de que el dinero ya se haya movido, y no se toca nunca más. Un reembolso
-- editable sería un registro contable que no vale para nada.

-- ── RLS: default-deny (regla de oro 1) ──────────────────────────────────────
alter table public.late_payment_refunds enable row level security;

-- Solo admin lee. El alumno no necesita esta tabla para enterarse: el dinero le
-- vuelve a la tarjeta y la reserva ya le avisó de su cancelación (NTF-09).
-- ponytail: falta el aviso explícito «te devolvimos este cobro», que necesita
-- plantilla nueva en `lib/email-templates.ts` (NTF pendiente).
create policy "late_payment_refunds_select_admin"
  on public.late_payment_refunds for select
  using ( public.has_role('admin') );

-- Sin política de insert/update/delete: el único camino de escritura es el
-- webhook con `service_role`, que se salta la RLS.

-- ── Grants (auto-expose OFF) ────────────────────────────────────────────────
-- `authenticated` para que el admin la lea desde el panel; la política de
-- arriba es la que acota a quién.
grant select on public.late_payment_refunds to authenticated;

-- ⚠️ REGLA DE ORO 9, la que ya mordió cuatro veces. `service_role` se salta la
-- RLS pero NO los grants de tabla, y esto es OFF por defecto en el proyecto:
-- sin estas dos líneas el webhook come `permission denied` en TIEMPO DE
-- EJECUCIÓN —no en el build, no en el typecheck— justo en el camino que existe
-- para devolver dinero. `select` para la comprobación de idempotencia, `insert`
-- para dejar constancia. Nada de update ni delete: la tabla es append-only.
grant select, insert on public.late_payment_refunds to service_role;

-- ── Y EL GRANT QUE FALTABA, MISMO MOTIVO ────────────────────────────────────
-- El webhook ahora LEE `bookings` para saber si la reserva sigue esperando el
-- cobro, y `service_role` no tenía ni un grant sobre esa tabla (se los repartió
-- `20260806170000` a `payments` y `profiles`, y `20260806140000` a `sessions`,
-- pero bookings se quedó fuera porque hasta hoy solo se tocaba desde la RPC).
-- Solo lectura: la reserva sigue moviéndose únicamente por funciones
-- controladas (regla de oro 7).
--
-- Puede que `20260817140000` (mismo día, otro frente) ya lo haya concedido: un
-- `grant` repetido en Postgres es un no-op, y se deja aquí para que esta
-- migración se sostenga sola si aquella cambia.
grant select on public.bookings to service_role;

-- ── 2) confirm_payment v5: un pago 'failed' tampoco se reprocesa ────────────
--
-- Cuerpo íntegro de `20260806120000` (que a su vez venía de R24-19), con UN
-- cambio: 'failed' entra en la lista de idempotencia por estado. Se reescribe
-- entera porque en Postgres una función no se parchea.
--
-- LO QUE SE CONSERVA, PORQUE ES FÁCIL PERDERLO AL REESCRIBIR:
--   · el dedup por `p_event_id` contra `payment_webhook_events` (US-703);
--   · la comprobación de existencia SIN `auth.uid()` — un webhook no tiene
--     usuario, y ese check era justo lo que hacía imposible llamarla desde el
--     webhook (20260806120000);
--   · el auto-aceptar del tutor (R24-19): la reserva pagada salta a 'confirmed'
--     si `tutor_profiles.auto_accept_bookings`, y a 'pending_acceptance' si no.
--     De esa transición cuelga NTF-07 (20260806160000), así que cambiarla
--     apagaría el aviso al tutor;
--   · la rama de fallo: pago 'failed', reserva 'cancelled' y liberación del
--     hold de `sessions`.
--
-- POR QUÉ 'failed' CIERRA EL CASO ENTERO. Los dos únicos caminos que cancelan
-- una reserva sin cobrar dejan el pago en 'failed', comprobado uno a uno:
--   · `expire_stale_bookings` → `update payments set status='failed'` (timeout);
--   · `cancel_booking` → rama `elsif v_pay.status = 'pending'` (cancelación
--     manual del alumno o del tutor durante el checkout).
-- No existe ninguna forma de acabar en 'cancelled' con el pago en 'pending', así
-- que con 'failed' en la lista no queda ventana por la que colar un cobro tardío.
--
-- QUÉ NO ROMPE: el camino simulado. `confirm_simulated_payment` (que es quien
-- llama a esta desde el checkout de hoy) solo llega aquí con el pago en
-- 'pending'; su botón de "simular fallo" deja la reserva cancelada y el
-- siguiente intento crea una reserva NUEVA, no reintenta la muerta.
create or replace function public.confirm_payment(
  p_booking_id uuid,
  p_success    boolean default true,
  p_event_id   text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_status public.payment_status;
  v_new        public.booking_status;
  v_auto       boolean;
begin
  if not exists (select 1 from public.bookings b where b.id = p_booking_id) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- US-703: dedup por event-id (procesar cada evento una sola vez).
  if p_event_id is not null then
    insert into public.payment_webhook_events (event_id, booking_id)
    values (p_event_id, p_booking_id)
    on conflict (event_id) do nothing;
    if not found then
      select status into v_new from public.bookings where id = p_booking_id;
      return v_new::text;  -- evento ya procesado → no-op
    end if;
  end if;

  select status into v_pay_status from public.payments where booking_id = p_booking_id;

  -- Idempotencia por estado: un pago ya RESUELTO no se reprocesa. 'failed' es
  -- tan definitivo como 'paid' (X-02) — significa que el horario ya se liberó,
  -- y acreditarlo ahora cobraría por una clase que no existe.
  if v_pay_status in ('paid', 'refunded', 'partially_refunded', 'failed') then
    select status into v_new from public.bookings where id = p_booking_id;
    return v_new::text;
  end if;

  if p_success then
    update public.payments set status = 'paid', paid_at = now() where booking_id = p_booking_id;

    -- R24-19: ¿el tutor de esta reserva auto-acepta?
    select coalesce(tp.auto_accept_bookings, false) into v_auto
      from public.bookings b
      join public.tutor_profiles tp on tp.profile_id = b.tutor_id
      where b.id = p_booking_id;

    update public.bookings
      set status = case when v_auto then 'confirmed' else 'pending_acceptance' end::public.booking_status
      where id = p_booking_id and status = 'pending_payment'
      returning status into v_new;
  else
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = p_booking_id
      returning status into v_new;
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  return v_new::text;
end;
$$;

-- `create or replace` conserva los privilegios existentes, pero se repiten por
-- si esta migración se aplica sobre una base donde la función no existía: en
-- Postgres el `execute` nace concedido a PUBLIC, así que revocar ANTES de
-- conceder no es ceremonia (mismo gotcha de 20260715150000 y 20260806120000).
-- Sigue siendo del webhook y de nadie más; el cliente entra por
-- `confirm_simulated_payment`.
revoke execute on function public.confirm_payment(uuid, boolean, text) from public;
revoke execute on function public.confirm_payment(uuid, boolean, text) from anon;
revoke execute on function public.confirm_payment(uuid, boolean, text) from authenticated;

grant  execute on function public.confirm_payment(uuid, boolean, text) to service_role;
