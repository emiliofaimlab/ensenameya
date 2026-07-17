-- ============================================================================
-- Enséñame Ya — EP-12: notificaciones. US-1201 (emails) + US-1202 (idempotente).
--
-- DP-05/C-11: la herramienta de email (SendGrid u otra) queda DETRÁS de una
-- interfaz. Aquí el "puerto" es la tabla `notifications` (canal + plantilla +
-- payload) y el "stub" es `process_notifications` que las marca enviadas. El
-- proveedor real será una Edge Function que lea las `pending` y envíe; nada del
-- negocio cambia.
--
-- Diseño: las notificaciones se disparan por TRIGGERS sobre las transiciones de
-- estado (Doc 7 §reactivas), NO desde las RPC de negocio. Así se desacopla el
-- envío del dinero y no hay que recrear funciones de pago/booking (que es donde
-- se rompen cosas). Cada evento tiene una `idempotency_key` determinista →
-- `on conflict do nothing` (US-1202): el mismo evento no se encola dos veces.
-- ============================================================================

create type public.notification_status as enum ('pending', 'sent', 'failed');

create table public.notifications (
  id              uuid        primary key default gen_random_uuid(),
  recipient_id    uuid        not null references public.profiles (id) on delete cascade,
  type            text        not null,                 -- código NTF (Doc 7)
  channel         text        not null default 'email', -- email | in_app
  template        text        not null,                 -- plantilla (Doc 7 col. "Plantilla")
  payload         jsonb       not null default '{}',
  idempotency_key text        not null unique,          -- US-1202: un evento = un envío
  status          public.notification_status not null default 'pending',
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id);
create index notifications_status_idx    on public.notifications (status);

-- ── RLS: el destinatario lee lo suyo; admin todo; escritura server-side ─────
alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  using ( (select auth.uid()) = recipient_id );
create policy "notifications_select_admin"
  on public.notifications for select
  using ( public.has_role('admin') );

grant select on public.notifications to authenticated;

-- ── Encolar (idempotente) ───────────────────────────────────────────────────
create or replace function public.enqueue_notification(
  p_recipient uuid,
  p_type      text,
  p_channel   text,
  p_template  text,
  p_payload   jsonb,
  p_key       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then return; end if;   -- sin destinatario, no se encola
  insert into public.notifications (recipient_id, type, channel, template, payload, idempotency_key)
  values (p_recipient, p_type, p_channel, p_template, p_payload, p_key)
  on conflict (idempotency_key) do nothing;      -- US-1202
end;
$$;

-- ── Triggers reactivos por transición (Doc 7) ───────────────────────────────

-- Bookings: confirmada (alumno+tutor), cancelada, completada (pedir reseña).
create or replace function public.notify_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'confirmed' then
      perform public.enqueue_notification(new.student_id, 'NTF-05', 'email', 'booking_confirmed_student',
        jsonb_build_object('booking_id', new.id), 'NTF-05:booking:' || new.id);
      perform public.enqueue_notification(new.tutor_id, 'NTF-07', 'email', 'booking_new_tutor',
        jsonb_build_object('booking_id', new.id), 'NTF-07:booking:' || new.id);
    elsif new.status = 'cancelled' then
      perform public.enqueue_notification(new.student_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id), 'NTF-09:booking:' || new.id || ':student');
      perform public.enqueue_notification(new.tutor_id, 'NTF-09', 'email', 'cancellation',
        jsonb_build_object('booking_id', new.id), 'NTF-09:booking:' || new.id || ':tutor');
    elsif new.status = 'completed' then
      -- NTF-14: al completar, invita a reseñar (RN-28).
      perform public.enqueue_notification(new.student_id, 'NTF-14', 'email', 'review_request',
        jsonb_build_object('booking_id', new.id), 'NTF-14:booking:' || new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger notifications_on_booking
  after update on public.bookings
  for each row execute function public.notify_booking();

-- Payments: recibo (paid), reembolso (refunded/partial), fallido.
create or replace function public.notify_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
begin
  if new.status is distinct from old.status
     or new.refunded_amount is distinct from old.refunded_amount then
    select student_id into v_student from public.bookings where id = new.booking_id;

    if new.status = 'paid' and old.status <> 'paid' then
      perform public.enqueue_notification(v_student, 'NTF-04', 'email', 'payment_receipt',
        jsonb_build_object('payment_id', new.id, 'amount', new.gross_amount, 'currency', new.currency),
        'NTF-04:payment:' || new.id);
    elsif new.status in ('refunded', 'partially_refunded') then
      -- Clave incluye el acumulado reembolsado → parcial y total avisan una vez cada uno.
      perform public.enqueue_notification(v_student, 'NTF-10', 'email', 'refund_processed',
        jsonb_build_object('payment_id', new.id, 'refunded', new.refunded_amount, 'currency', new.currency),
        'NTF-10:payment:' || new.id || ':' || new.refunded_amount);
    elsif new.status = 'failed' then
      perform public.enqueue_notification(v_student, 'NTF-15', 'email', 'payment_failed',
        jsonb_build_object('payment_id', new.id), 'NTF-15:payment:' || new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger notifications_on_payment
  after update on public.payments
  for each row execute function public.notify_payment();

-- Tutor: resultado de aprobación (NTF-03) e identidad recibida (NTF-06).
create or replace function public.notify_tutor_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.approval_status is distinct from old.approval_status
     and new.approval_status in ('approved', 'rejected', 'suspended') then
    perform public.enqueue_notification(new.profile_id, 'NTF-03', 'email', 'tutor_review_result',
      jsonb_build_object('status', new.approval_status, 'notes', new.approval_notes),
      'NTF-03:tutor:' || new.profile_id || ':' || new.approval_status);
  end if;

  if new.identity_verification_status is distinct from old.identity_verification_status
     and new.identity_verification_status = 'pending' then
    perform public.enqueue_notification(new.profile_id, 'NTF-06', 'email', 'identity_in_review',
      jsonb_build_object('tutor_id', new.profile_id),
      'NTF-06:tutor:' || new.profile_id);
  end if;
  return new;
end;
$$;

create trigger notifications_on_tutor_profile
  after update on public.tutor_profiles
  for each row execute function public.notify_tutor_profile();

-- Payout: pagado (NTF-12) o incidencia (NTF-16).
create or replace function public.notify_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'paid' then
      perform public.enqueue_notification(new.tutor_id, 'NTF-12', 'email', 'payout_paid',
        jsonb_build_object('payout_id', new.id, 'amount', new.amount, 'currency', new.currency),
        'NTF-12:payout:' || new.id);
    elsif new.status in ('on_hold', 'failed') then
      perform public.enqueue_notification(new.tutor_id, 'NTF-16', 'in_app', 'payout_issue',
        jsonb_build_object('payout_id', new.id, 'status', new.status),
        'NTF-16:payout:' || new.id || ':' || new.status);
    end if;
  end if;
  return new;
end;
$$;

create trigger notifications_on_payout
  after update on public.payouts
  for each row execute function public.notify_payout();

-- ── US-1201: el "stub" del EmailProvider — procesa las pendientes ───────────
-- Simulado: marca enviadas. El proveedor real (SendGrid u otro, DP-05) será una
-- Edge Function que lea las 'pending', envíe y marque 'sent'/'failed'.
create or replace function public.process_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent int;
begin
  with done as (
    update public.notifications
       set status = 'sent', sent_at = now()
     where status = 'pending'
    returning id
  )
  select count(*) into v_sent from done;
  return jsonb_build_object('notifications_sent', v_sent);
end;
$$;

-- Gotcha US-605: EXECUTE es PUBLIC. Solo el cron/service_role procesa.
revoke execute on function public.process_notifications() from public;
revoke execute on function public.process_notifications() from anon;
revoke execute on function public.process_notifications() from authenticated;
grant  execute on function public.process_notifications() to service_role;

select cron.unschedule('process-notifications') where exists (select 1 from cron.job where jobname = 'process-notifications');
select cron.schedule('process-notifications', '*/2 * * * *', $cron$ select public.process_notifications(); $cron$);
