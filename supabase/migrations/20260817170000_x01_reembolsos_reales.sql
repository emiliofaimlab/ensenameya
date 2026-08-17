-- ============================================================================
-- Enséñame Ya — X-01: NINGÚN REEMBOLSO MOVÍA DINERO
-- (RN-37 · RN-38 · US-704 · regla de oro 2 · §13 de los Términos publicados hoy)
--
-- EL AGUJERO. Los tres caminos de reembolso de la plataforma escribían
-- `payments.status = 'refunded'` (o 'partially_refunded') y `refunded_amount`
-- en Postgres Y AHÍ SE ACABABA:
--
--   1. `cancel_booking` (20260709180000 → 20260729140000): RN-37, ≥24 h el 100 %,
--      <24 h el 50 %, cancela el tutor el 100 %.
--   2. `refund_payment` (20260716160000): la corrección manual del admin.
--   3. la rama de aceptación vencida de `expire_stale_bookings` (20260709190000):
--      RN-38, el tutor no respondió en 24 h → 100 %.
--
-- Ninguno hablaba con el PSP. Mientras `payment_routing_rules` ruteaba a
-- 'simulated' daba exactamente igual: no había dinero que devolver. Con Stripe
-- cobrando en *test mode* y a un `UPDATE` de fila de cobrar de verdad, esto pasa
-- a ser la plataforma anotándose reembolsos que el alumno nunca recibe — y
-- avisándole por correo de ello, porque NTF-10 ya se dispara con el cambio de
-- estado de `payments` (20260716170000). Peor que no devolver: decir que sí.
--
-- Y DESDE HOY ES ADEMÁS UNA PROMESA CONTRACTUAL. Los Términos del cliente
-- (src/components/legal/terms-content.ts, §13) dicen que los reembolsos se
-- devuelven «al método de pago original». El único sitio del proyecto que ha
-- movido dinero de vuelta hasta ahora es el webhook de X-02, y ese devuelve
-- cobros que no debieron ocurrir, no reembolsos de política.
--
-- ── POR QUÉ NO VALE «LLAMAR A STRIPE DESDE EL ROUTE HANDLER Y YA» ───────────
--
-- Porque de los tres caminos, uno NO TIENE PETICIÓN HTTP donde colgar la
-- llamada: `expire_stale_bookings` la dispara **pg_cron dentro de la base**
-- cada 5 minutos. Y Postgres no puede llamar a la API de Stripe — el proyecto
-- ya se topó con esto en `20260717120000` (Daily) y en `20260806150000`
-- (Resend), y las dos veces resolvió igual:
--
--        LA BASE ENCOLA · UN JOB HTTP EJECUTA
--
-- Este archivo es la mitad de la BD. La otra mitad es
-- `src/app/api/cron/refunds-process/route.ts`, que lee lo pendiente, llama a
-- `refunds.create` y marca el resultado.
--
-- ⚠️ 'pending' SIGNIFICA «TODAVÍA NO», NUNCA «FALLÓ». Igual que en
-- notificaciones: si el job no corre, o Stripe está caído, o la clave no está
-- puesta, la fila se queda pendiente y sale en la siguiente pasada. Una cola
-- que crece es un problema visible; una que se marca sola como resuelta es el
-- stub de `process_notifications()` otra vez, y ese fallo fue invisible durante
-- semanas precisamente porque no dejaba rastro.
-- ============================================================================


-- ── 1) La cola ──────────────────────────────────────────────────────────────
--
-- POR QUÉ UNA TABLA APARTE Y NO UNAS COLUMNAS EN `payments`. `payments` es 1:1
-- con la reserva y guarda el ACUMULADO (`refunded_amount`), pero un pago puede
-- reembolsarse en varios tramos: el admin devuelve 500 hoy y 1500 mañana, o
-- devuelve un parcial y luego el alumno cancela. Cada tramo es una llamada
-- distinta al PSP, con su propio `re_…` y su propio resultado. Eso es una lista,
-- no dos columnas.
--
-- Y NO ES `late_payment_refunds` (X-02, 20260817160000), aunque se parezcan.
-- Aquella anota cobros que NO DEBIERON OCURRIR y que el webhook devuelve enteros
-- en el acto; el pago de la reserva ni se toca. Esta es el reembolso DE LA
-- POLÍTICA sobre un cobro legítimo, puede ser parcial y se ejecuta en diferido.
-- Mezclarlas obligaría a que una misma fila signifique dos cosas contables
-- distintas.
create type public.refund_request_status as enum (
  'pending',   -- encolado, aún no se ha hablado con el PSP (se reintenta)
  'refunded',  -- el PSP aceptó la devolución (o confirmó que ya estaba hecha)
  'skipped',   -- no había nada que mandar: el cobro fue simulado
  'failed'     -- error PERMANENTE del PSP; necesita una persona, no un reintento
);

create table public.refund_requests (
  id                  uuid        primary key default gen_random_uuid(),

  -- `cascade` como el resto de lo que cuelga del dinero: si desaparece la
  -- persona y con ella su reserva, esto no tiene a qué referirse. La constancia
  -- de lo que se movió de verdad vive en el PSP, que es quien manda en eso.
  payment_id          uuid        not null references public.payments (id) on delete cascade,
  booking_id          uuid        not null references public.bookings (id) on delete cascade,

  -- ⚠️ IDEMPOTENCIA, CAMINO 1 DE 2 — que no se ENCOLE dos veces.
  -- Determinista y con el ACUMULADO dentro: 'X01:payment:<uuid>:<total_tras_esta>'.
  -- Misma idea que la clave de NTF-10 (20260716170000), y por el mismo motivo:
  -- un parcial y el total posterior son dos claves distintas (dos reembolsos
  -- reales), pero dos caminos que dejan el pago en el MISMO total acumulado son
  -- el mismo dinero y encolan una sola vez. `refunded_amount` solo sube (ver el
  -- `greatest` de `cancel_booking` más abajo), así que la clave no se repite
  -- nunca por accidente.
  idempotency_key     text        not null unique,

  -- Agnóstico de PSP (S-16), como el resto del dinero: hoy solo ejecuta Stripe,
  -- DLocal entrará por la misma cola con otra rama en el job. Se copian del pago
  -- en el momento de encolar y no se leen en vivo a propósito: lo que se debe
  -- devolver es lo que se decidió al cancelar, no lo que diga la fila mañana.
  provider            text        not null,
  provider_payment_id text,                       -- pi_…  (null en los simulados)
  provider_refund_id  text,                       -- re_…  lo devuelve el PSP

  -- Unidades menores, igual que `payments.gross_amount`. ES EL TRAMO, NO EL
  -- ACUMULADO: si el alumno cancela tarde con RN-37 al 50 %, aquí van 50, y si
  -- ya se le había devuelto algo antes, aquí va solo la diferencia. El importe
  -- sale SIEMPRE de la BD (regla de oro 2) — ni del navegador, ni de un cálculo
  -- nuevo en el job.
  amount              bigint      not null check (amount > 0),
  currency            char(3)     not null,

  -- Por qué se debe este dinero, en cristiano. Se lee en el panel admin y en el
  -- log del job; es lo primero que mira quien concilia.
  reason              text        not null,

  status              public.refund_request_status not null default 'pending',
  -- Lo último que dijo el PSP cuando dijo que no. Se conserva aunque después se
  -- resuelva: un reembolso que costó tres intentos es información.
  last_error          text,
  last_attempt_at     timestamptz,
  processed_at        timestamptz,
  created_at          timestamptz not null default now()
);

comment on table public.refund_requests is
  'X-01: cola de reembolsos de política (RN-37/RN-38/US-704) pendientes de ejecutar contra el PSP. La BD encola, /api/cron/refunds-process ejecuta. `pending` = todavía no, nunca = falló.';
comment on column public.refund_requests.amount is
  'Tramo a devolver en esta operación, en unidades menores. No es el acumulado de payments.refunded_amount.';

-- Sin trigger de `updated_at`: la fila la escribe el job una sola vez, al
-- resolverla, y `last_attempt_at` ya dice cuándo se tocó por última vez.

-- El índice que usa el job en cada pasada. Parcial porque lo pendiente es una
-- minoría diminuta frente al histórico: la cola vive vacía y solo se llena
-- cuando hay algo roto o algo recién cancelado.
create index refund_requests_pending_idx
  on public.refund_requests (created_at)
  where status = 'pending';
create index refund_requests_payment_idx on public.refund_requests (payment_id);
create index refund_requests_booking_idx on public.refund_requests (booking_id);

-- ── RLS: default-deny (regla de oro 1) ──────────────────────────────────────
alter table public.refund_requests enable row level security;

-- Solo admin. El alumno no necesita esta tabla: ya recibe NTF-10 cuando el
-- reembolso se acuerda, y el movimiento le aparece en su extracto bancario.
-- ponytail: NTF-10 sale al ACORDAR el reembolso, no al ejecutarlo. Mientras el
-- job no corra, el correo dice «reembolso procesado» y el dinero sigue aquí.
-- Ajustar el texto de la plantilla (o encolar el aviso desde el job) es un
-- frente aparte — no se toca `lib/email-templates.ts` desde aquí.
create policy "refund_requests_select_admin"
  on public.refund_requests for select
  using ( public.has_role('admin') );

-- Sin política de insert/update/delete: se encola por `enqueue_refund` (que
-- corre como owner) y se marca con `service_role`, que se salta la RLS.

-- ── Grants (auto-expose OFF) ────────────────────────────────────────────────
grant select on public.refund_requests to authenticated;   -- lo acota la política de arriba

-- ⚠️ REGLA DE ORO 9, la que ya mordió CINCO veces. `service_role` se salta la
-- RLS pero NO los grants de tabla, y sin estas dos líneas el job come
-- `permission denied` **en tiempo de ejecución** —no en el build, no en el
-- typecheck— justo en el camino que existe para devolver dinero.
grant select on public.refund_requests to service_role;

-- UPDATE POR COLUMNAS, no de tabla entera (mismo patrón que
-- `20260806170000` con `payments.provider_payment_id`). El job tiene que poder
-- anotar CÓMO fue, y nada más: con un grant de tabla podría reescribir
-- `amount` y devolver una cifra distinta de la que se acordó al cancelar. Aquí
-- el importe es intocable por diseño, y Postgres lo hace cumplir.
grant update (status, provider_refund_id, last_error, last_attempt_at, processed_at)
  on public.refund_requests to service_role;
-- Sin `insert` ni `delete`: la cola es append-only y solo la llena la función
-- de abajo. Un job que pueda encolar reembolsos por su cuenta es un job que
-- puede inventarse dinero.


-- ── 2) Encolar ──────────────────────────────────────────────────────────────
--
-- La llaman las tres funciones de negocio, que ya corren SECURITY DEFINER: el
-- privilegio EXECUTE se comprueba contra el DUEÑO cuando se invoca desde
-- dentro de otra SECURITY DEFINER, así que no hace falta concederlo a nadie
-- (ver los `revoke` del final de esta sección).
--
-- Es deliberadamente TONTA: no decide importes ni porcentajes. Quien sabe
-- cuánto se debe es RN-37 / RN-38 / el admin; esto solo lo apunta. Si algún día
-- el cálculo cambia, cambia allí y esta función ni se entera.
create or replace function public.enqueue_refund(
  p_payment_id uuid,
  p_amount     bigint,   -- el TRAMO a devolver, ya calculado por quien llama
  p_reason     text,
  p_key        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay      record;
  v_provider text;
  v_status   public.refund_request_status;
begin
  -- Sin importe no hay reembolso que encolar. Pasa constantemente y no es un
  -- error: cancelar una reserva que nunca se cobró, o un segundo camino que
  -- llega cuando ya se devolvió todo, dan delta 0.
  if p_amount is null or p_amount <= 0 then
    return;
  end if;

  select p.id, p.booking_id, p.currency, p.gross_amount, p.provider, p.provider_payment_id
    into v_pay
  from public.payments p
  where p.id = p_payment_id;

  if v_pay.id is null then
    raise exception 'pago % no encontrado al encolar el reembolso', p_payment_id
      using errcode = 'no_data_found';
  end if;

  -- Tope duro. Este parámetro lo calcula el llamador y un error suyo aquí sería
  -- devolver más de lo cobrado — la clase de fallo que no se descubre hasta que
  -- lo dice el PSP. Que reviente la transacción entera y no se cancele nada es
  -- infinitamente mejor.
  if p_amount > v_pay.gross_amount then
    raise exception 'reembolso de % sobre un cobro de % (pago %)',
      p_amount, v_pay.gross_amount, p_payment_id using errcode = 'check_violation';
  end if;

  v_provider := coalesce(v_pay.provider, 'simulated');

  -- ⚠️ LOS COBROS SIMULADOS NO EXISTEN EN NINGÚN PSP. Se encolan igual —la cola
  -- es el registro completo de todo lo que se prometió devolver— pero nacen
  -- resueltos. Si se dejaran 'pending', el job los reintentaría contra Stripe
  -- para siempre, fallando en cada pasada por un `pi_…` que nunca existió, y
  -- ese ruido acabaría tapando un reembolso de verdad atascado. Toda la base
  -- de dev está llena de estos.
  if v_provider = 'simulated' then
    v_status := 'skipped';
  else
    v_status := 'pending';
  end if;

  insert into public.refund_requests (
    payment_id, booking_id, idempotency_key, provider, provider_payment_id,
    amount, currency, reason, status, processed_at
  )
  values (
    v_pay.id, v_pay.booking_id, p_key, v_provider, v_pay.provider_payment_id,
    p_amount, v_pay.currency, p_reason, v_status,
    case when v_status = 'skipped' then now() end
  )
  on conflict (idempotency_key) do nothing;   -- camino 1 de la idempotencia
end;
$$;

comment on function public.enqueue_refund(uuid, bigint, text, text) is
  'X-01: apunta un reembolso pendiente de ejecutar contra el PSP. No decide importes; los calcula quien llama (RN-37/RN-38/US-704).';

-- Gotcha de Postgres que este repo ya ha pagado dos veces (20260715150000,
-- 20260806120000): EXECUTE nace concedido a PUBLIC. Sin este `revoke`, un
-- `authenticated` cualquiera podría encolarse reembolsos a sí mismo — no se le
-- concede a NADIE, ni siquiera a `service_role`: los únicos que encolan son las
-- tres funciones de negocio de abajo, y lo hacen como dueñas.
revoke execute on function public.enqueue_refund(uuid, bigint, text, text) from public;
revoke execute on function public.enqueue_refund(uuid, bigint, text, text) from anon;
revoke execute on function public.enqueue_refund(uuid, bigint, text, text) from authenticated;


-- ── 3) cancel_booking v3 — RN-37 (camino 1 de 3) ────────────────────────────
--
-- Cuerpo ÍNTEGRO de `20260729140000` (que a su vez venía de `20260709180000`)
-- con dos cambios. Se reescribe entera porque en Postgres una función no se
-- parchea.
--
-- LO QUE SE CONSERVA, PORQUE ES LO FÁCIL DE PERDER AL REESCRIBIR:
--   · el filtro de propiedad `student_id = uid or tutor_id = uid` y los tres
--     estados cancelables — es lo único que impide cancelar reservas ajenas;
--   · RN-37 sobre la sesión agendada MÁS PRÓXIMA (`min(start_at)`), no sobre la
--     primera del paquete;
--   · la rama 'pending' → el pago pasa a 'failed' sin reembolso (nunca se
--     cobró). X-02 depende de que siga siendo así: 'failed' es lo que impide
--     que un cobro tardío se acredite sobre la reserva muerta;
--   · `cancel_reason` acotado a 500 (decisión 23 del cliente);
--   · la cancelación de las `sessions` en 'scheduled' (libera el horario);
--   · el jsonb de vuelta {refund_pct, refund_amount}, que es lo que pinta
--     `reservas/[id]/cancelar/cancel-form.tsx`.
--
-- CAMBIO 1 — se encola el reembolso real.
-- CAMBIO 2 — `refunded_amount` YA NO PUEDE BAJAR. El cuerpo viejo lo ASIGNABA
--   (`= v_refund`) en vez de acumular, así que un pago con 1 500 ya devueltos
--   por el admin que luego se cancelara tarde (50 % = 1 000) se quedaba
--   registrando 1 000 reembolsados: 500 desaparecían del acumulado y un
--   reembolso posterior del admin los habría devuelto POR SEGUNDA VEZ, porque
--   `refund_payment` calcula lo que queda como `gross_amount - refunded_amount`.
--   Con dinero de mentira era una fila rara; con dinero de verdad es pagar dos
--   veces. El `greatest` de abajo lo cierra, y de paso hace que la clave de
--   idempotencia (que lleva el acumulado dentro) sea monótona.
create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_bk       record;
  v_is_tutor boolean;
  v_earliest timestamptz;
  v_pay      record;
  v_pct      int;
  v_refund   bigint := 0;   -- acumulado tras esta cancelación
  v_prev     bigint := 0;   -- lo que ya se había devuelto antes
  v_delta    bigint := 0;   -- lo que hay que mover DE VERDAD ahora
begin
  select id, student_id, tutor_id, status
    into v_bk
  from public.bookings
  where id = p_booking_id
    and (student_id = v_uid or tutor_id = v_uid)
    and status in ('pending_payment', 'pending_acceptance', 'confirmed');
  if v_bk.id is null then
    raise exception 'reserva no cancelable o inexistente' using errcode = 'check_violation';
  end if;

  v_is_tutor := (v_uid = v_bk.tutor_id);

  -- RN-37 sobre la sesión más próxima aún agendada.
  select min(start_at) into v_earliest
  from public.sessions
  where booking_id = p_booking_id and status = 'scheduled';

  if v_is_tutor then
    v_pct := 100;
  elsif v_earliest is null or v_earliest - now() >= interval '24 hours' then
    v_pct := 100;
  else
    v_pct := 50;
  end if;

  -- Reembolso solo si el pago fue capturado.
  select id, status, gross_amount, refunded_amount
    into v_pay
  from public.payments where booking_id = p_booking_id;

  if v_pay.status in ('paid', 'partially_refunded') then
    v_prev   := coalesce(v_pay.refunded_amount, 0);
    v_refund := round(v_pay.gross_amount * v_pct / 100.0);
    -- Ver CAMBIO 2 en la cabecera: el acumulado no retrocede jamás.
    v_refund := greatest(v_refund, v_prev);
    v_delta  := v_refund - v_prev;

    update public.payments
      set status = (case when v_pct >= 100 then 'refunded' else 'partially_refunded' end)::public.payment_status,
          refunded_amount = v_refund
      where booking_id = p_booking_id;

    -- Y AQUÍ ES DONDE ANTES SE ACABABA TODO. Se encola el tramo, no el
    -- acumulado: si el admin ya había devuelto una parte, esa parte ya viajó.
    perform public.enqueue_refund(
      v_pay.id,
      v_delta,
      'RN-37 · cancela ' || (case when v_is_tutor then 'el tutor' else 'el alumno' end)
        || ' (' || v_pct || ' %)',
      'X01:payment:' || v_pay.id || ':' || v_refund
    );

  elsif v_pay.status = 'pending' then
    -- Nunca se cobró (pending_payment): sin reembolso. Este 'failed' es además
    -- el que hace que X-02 rechace un cobro que llegue tarde por esta reserva.
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    v_refund := 0;
  end if;

  update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        -- El texto llega ya compuesto de la pantalla ("motivo — detalle").
        cancel_reason = nullif(left(trim(coalesce(p_reason, '')), 500), '')
    where id = p_booking_id;
  update public.sessions set status = 'cancelled', cancelled_at = now()
    where booking_id = p_booking_id and status = 'scheduled';

  -- `refund_amount` sigue siendo el ACUMULADO, que es lo que la pantalla enseña
  -- como "se te devolverá X". No se cambia la forma: la consume cancel-form.tsx.
  return jsonb_build_object('refund_pct', v_pct, 'refund_amount', v_refund);
end;
$$;

-- `create or replace` conserva privilegios, pero se repiten por si esta
-- migración cae sobre una base donde la función no existiera. Y de paso se
-- salda el `revoke from public` que le faltaba desde el principio: la función
-- se apoya en `auth.uid()` para todo, así que `anon` no podía hacer nada con
-- ella, pero una SECURITY DEFINER ejecutable por PUBLIC es la trampa de
-- US-605 esperando a que alguien le añada un parámetro.
revoke execute on function public.cancel_booking(uuid, text) from public;
revoke execute on function public.cancel_booking(uuid, text) from anon;
grant  execute on function public.cancel_booking(uuid, text) to authenticated;


-- ── 4) refund_payment v2 — US-704, el admin (camino 2 de 3) ─────────────────
--
-- Cuerpo íntegro de `20260716160000` con una línea nueva: encolar. Se conserva
-- entero el bloque S-29 de payouts, que es lo delicado de este archivo:
--   · reembolso TOTAL con el payout aún sin pagar → se saca el `payout_item`,
--     se ajusta el importe del payout y se borra el payout si se quedó vacío;
--   · si el payout YA estaba 'paid' → `clawback_needed = true` (manual, MVP);
--   · reembolso total → la reserva pasa a 'refunded' (cierre financiero M4).
-- El parcial NO toca payouts a propósito (prorrateo manual, DP-03).
--
-- Aquí el importe ya viene acotado por la propia función (`v_remaining`), así
-- que el tramo a mover es exactamente `v_amount`: no hay delta que calcular.
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
  v_pay        record;
  v_remaining  bigint;
  v_amount     bigint;
  v_new_total  bigint;
  v_full       boolean;
  v_new_status public.payment_status;
  v_clawback   boolean := false;
  v_item       record;
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

  update public.payments
     set status = v_new_status, refunded_amount = v_new_total
   where id = p_payment_id;

  -- X-01 · el dinero, no solo el estado. Va DESPUÉS del update por coherencia
  -- con el resto (todo esto es una sola transacción: si algo revienta más
  -- abajo, no queda ni el reembolso encolado ni el estado cambiado).
  perform public.enqueue_refund(
    v_pay.id,
    v_amount,
    'US-704 · reembolso manual desde el panel admin',
    'X01:payment:' || v_pay.id || ':' || v_new_total
  );

  -- S-29: solo en reembolso TOTAL se toca el payout (el prorrateo parcial del
  -- neto es DP-03, manual). Busca el item de este pago.
  if v_full then
    select pi.id as item_id, pi.amount as item_amount, po.id as payout_id, po.status as payout_status
      into v_item
    from public.payout_items pi
    join public.payouts po on po.id = pi.payout_id
    where pi.payment_id = p_payment_id;

    if v_item.item_id is not null then
      if v_item.payout_status = 'paid' then
        -- Ya se pagó al tutor → clawback manual (no automatizado, MVP/S-29).
        v_clawback := true;
      else
        -- Aún no liquidado: excluye el item y ajusta/limpia el payout.
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

-- Mismo saldo de deuda que arriba: era ejecutable por PUBLIC. No era explotable
-- —lo primero que hace es `has_role('admin')`— pero la barrera no debe ser solo
-- la primera línea del cuerpo.
revoke execute on function public.refund_payment(uuid, bigint) from public;
revoke execute on function public.refund_payment(uuid, bigint) from anon;
grant  execute on function public.refund_payment(uuid, bigint) to authenticated;


-- ── 5) expire_stale_bookings v2 — RN-38 (camino 3 de 3) ─────────────────────
--
-- Cuerpo íntegro de `20260709190000`. ESTE es el camino que obliga a que la
-- arquitectura sea una cola: lo dispara pg_cron DENTRO de Postgres cada 5
-- minutos (`select public.expire_stale_bookings()`), sin ninguna petición HTTP
-- por medio y sin forma de llamar a Stripe.
--
-- LO QUE SE CONSERVA:
--   · rama 1, `pending_payment` vencida a los 20 min → pago 'failed', reserva
--     'cancelled', horario liberado. SIN reembolso: no se llegó a cobrar;
--   · rama 2, `pending_acceptance` sin respuesta del tutor en 24 h → 100 % y
--     cancelación (RN-38);
--   · los cutoffs como parámetros, que es lo que permite probarlo sin esperar.
--
-- NO se vuelve a programar el cron: `create or replace function` no toca el
-- `cron.job`, que sigue apuntando al mismo nombre. Y NO se reabre el grant a
-- `authenticated` — `20260715150000` lo cerró porque cualquiera podía vencer
-- con `0 seconds` las reservas de toda la plataforma; hoy eso ADEMÁS
-- dispararía reembolsos reales.
create or replace function public.expire_stale_bookings(
  p_payment_cutoff    interval default interval '20 minutes',
  p_acceptance_cutoff interval default interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_ids uuid[];
  v_acc_ids uuid[];
  v_r       record;
  v_encolados int := 0;
begin
  -- 1) pending_payment vencidas (nunca se cobró) → cancelled, sin reembolso.
  select array_agg(id) into v_pay_ids
  from public.bookings
  where status = 'pending_payment'
    and created_at < now() - p_payment_cutoff;

  if v_pay_ids is not null then
    update public.payments set status = 'failed', failed_at = now()
      where booking_id = any(v_pay_ids) and status = 'pending';
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = any(v_pay_ids);
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = any(v_pay_ids) and status = 'scheduled';
  end if;

  -- 2) pending_acceptance vencidas (tutor no respondió) → cancelled + 100%.
  select array_agg(b.id) into v_acc_ids
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.status = 'pending_acceptance'
    and p.paid_at < now() - p_acceptance_cutoff;

  if v_acc_ids is not null then
    -- ⚠️ ANTES DEL UPDATE, y no después. El tramo a devolver es
    -- `gross_amount - refunded_amount` LEÍDO AHORA; en cuanto el update ponga
    -- el acumulado al máximo, esa resta da cero y no se encolaría nada. Un
    -- `returning` no salva: devuelve los valores NUEVOS.
    for v_r in
      select p.id, p.gross_amount, p.gross_amount - p.refunded_amount as delta
        from public.payments p
       where p.booking_id = any(v_acc_ids)
         and p.gross_amount > p.refunded_amount
    loop
      perform public.enqueue_refund(
        v_r.id,
        v_r.delta,
        'RN-38 · el tutor no respondió en 24 h (100 %)',
        'X01:payment:' || v_r.id || ':' || v_r.gross_amount
      );
      v_encolados := v_encolados + 1;
    end loop;

    update public.payments set status = 'refunded', refunded_amount = gross_amount
      where booking_id = any(v_acc_ids);
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = any(v_acc_ids);
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = any(v_acc_ids) and status = 'scheduled';
  end if;

  return jsonb_build_object(
    'payment_expired',    coalesce(array_length(v_pay_ids, 1), 0),
    'acceptance_expired', coalesce(array_length(v_acc_ids, 1), 0),
    -- Nuevo: cuántos reembolsos dejó pedidos esta pasada. Si esto sube y la
    -- cola no baja, el que no corre es el job.
    'refunds_enqueued',   v_encolados
  );
end;
$$;

revoke execute on function public.expire_stale_bookings(interval, interval) from public;
revoke execute on function public.expire_stale_bookings(interval, interval) from anon;
revoke execute on function public.expire_stale_bookings(interval, interval) from authenticated;
grant  execute on function public.expire_stale_bookings(interval, interval) to service_role;


-- ── 6) El termómetro ────────────────────────────────────────────────────────
--
-- Mismo papel que `process_notifications()` tras `20260806150000`: un sitio al
-- que asomarse desde el SQL editor sin montar nada. `select
-- public.refunds_backlog();` responde cuánto dinero se ha prometido y no se ha
-- movido. Si `pendiente_importe` no baja, el job no está corriendo — y ese es
-- exactamente el fallo que no se puede ver desde la app.
create or replace function public.refunds_backlog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ejecuta',           '/api/cron/refunds-process (Stripe)',
    'pendientes',        count(*) filter (where status = 'pending'),
    'pendiente_importe', coalesce(sum(amount) filter (where status = 'pending'), 0),
    'mas_antiguo',       min(created_at) filter (where status = 'pending'),
    'fallidos',          count(*) filter (where status = 'failed'),
    'devueltos',         count(*) filter (where status = 'refunded'),
    'simulados',         count(*) filter (where status = 'skipped')
  )
  from public.refund_requests;
$$;

revoke execute on function public.refunds_backlog() from public;
revoke execute on function public.refunds_backlog() from anon;
revoke execute on function public.refunds_backlog() from authenticated;
grant  execute on function public.refunds_backlog() to service_role;
