-- Los avisos de dinero llevaban a «Métodos de pago», no a la reserva.
--
-- NTF-04 (recibo), NTF-10 (reembolso) y NTF-15 (pago fallido) son las tres
-- únicas plantillas cuyo payload trae `payment_id` y NO `booking_id`. El
-- destino del enlace —tanto del correo como del aviso in-app— se deriva del
-- payload (`src/lib/notifications.ts`, `rutaFor`), así que sin `booking_id`
-- caen a `/pagos`, que es la lista de tarjetas guardadas de Stripe (US-607) y
-- no un historial de pagos: esa pantalla no existe. El detalle del pago vive
-- en `/reservas/[id]`.
--
-- `new.booking_id` ya estaba en el cuerpo de la función (lo usa para sacar
-- `v_student`): esto solo lo mete también en el payload. No cambia ninguna
-- `idempotency_key`, no toca el esquema, no hace falta `db:types`.
--
-- `create or replace` conserva el trigger `notifications_on_payment`; no se
-- vuelve a crear. Y como recuerda la regla de oro 11, esto valida la sintaxis
-- pero no ejecuta el cuerpo: se comprueba provocando un cambio de estado en
-- `payments`, no leyendo el diff.

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
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'amount', new.gross_amount, 'currency', new.currency),
        'NTF-04:payment:' || new.id);
    elsif new.status in ('refunded', 'partially_refunded') then
      -- Clave incluye el acumulado reembolsado → parcial y total avisan una vez cada uno.
      perform public.enqueue_notification(v_student, 'NTF-10', 'email', 'refund_processed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id,
                           'refunded', new.refunded_amount, 'currency', new.currency),
        'NTF-10:payment:' || new.id || ':' || new.refunded_amount);
    elsif new.status = 'failed' then
      perform public.enqueue_notification(v_student, 'NTF-15', 'email', 'payment_failed',
        jsonb_build_object('payment_id', new.id, 'booking_id', new.booking_id),
        'NTF-15:payment:' || new.id);
    end if;
  end if;
  return new;
end;
$$;

-- Las filas ya encoladas también ganan su enlace: sin esto los NTF-04/10/15
-- históricos se quedarían apuntando a las tarjetas. Idempotente por el
-- `not (payload ? 'booking_id')`, así que volver a correrlo no escribe nada.
update public.notifications n
   set payload = n.payload || jsonb_build_object('booking_id', p.booking_id)
  from public.payments p
 where n.payload->>'payment_id' = p.id::text
   and not (n.payload ? 'booking_id');
