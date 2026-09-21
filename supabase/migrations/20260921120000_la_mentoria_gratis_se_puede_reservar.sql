-- ============================================================================
-- Enséñame Ya — la mentoría GRATIS se puede reservar.
--
-- ── EL REPORTE ──────────────────────────────────────────────────────────────
--
-- 21-sep-2026, el cliente: «me llegó reporte de una persona tratando de hacer
-- checkout a esa tutoría gratis de onboarding y la plataforma tiene un bug que
-- no permitió que se bookeara la clase». Y de paso: «necesito que las tutorías
-- GRATIS no requieran información de tarjeta de crédito».
--
-- Lo segundo YA se cumplía y no se toca: `/api/pagos/checkout` corta en
-- `aPagar <= 0` antes de resolver la cadena de cobro, así que un producto a 0
-- nunca monta un formulario de tarjeta ni da de alta a nadie en Stripe. Lo que
-- estaba roto es lo primero, y es una línea.
--
-- ── LA CAUSA ────────────────────────────────────────────────────────────────
--
-- Un producto a 0 es legal desde el primer día (`price_amount >= 0`,
-- `20260706120000:71`), así que `create_booking_line` congela `gross_amount =
-- 0`, `platform_fee = 0` y `tutor_net = 0` sin quejarse. La reserva nace. El
-- checkout ve `gross − credit = 0` y devuelve `modo: 'credito'`. El alumno
-- pulsa «Confirmar reserva» → `POST /api/pagos/credito` → y aquí se cae:
--
--   if not exists (select 1 from public.credits c
--                   where c.id = v_p.credit_id and c.status in ('active','consumed'))
--     raise exception 'el crédito de esta reserva no está vivo';
--
-- En una mentoría gratis `credit_id` es **null** —no hay crédito porque no hace
-- falta ninguno—, ese `not exists` es cierto y la RPC aborta. El alumno lee
-- «No pudimos confirmar esta reserva con tu crédito», la reserva se queda en
-- `pending_payment` con el horario retenido y `expire_stale_bookings` se la
-- lleva a los 7 minutos. Desde fuera: «la plataforma no me deja reservar».
--
-- ⚠️ El cerrojo de cobertura de justo encima —`credit_amount is distinct from
-- gross_amount`— SÍ deja pasar el caso gratis, porque 0 = 0. O sea que la
-- función ya estaba a un paso de servir; lo único que no contemplaba es que
-- «cubierto al 100 %» puede significar «no había nada que cubrir».
--
-- `confirm_credit_order` (el pedido multi-línea) NO tiene ese `not exists` y
-- por eso nunca sufrió el fallo: comprueba la cobertura línea a línea y delega.
-- Se queda tal cual.
--
-- ── LO QUE SE HACE ──────────────────────────────────────────────────────────
--
-- Una salida explícita para `gross_amount = 0`, antes de preguntar por un
-- crédito que no existe. No se relaja el cerrojo del crédito para todos los
-- demás: sigue igual de estricto donde hay dinero de por medio.
--
-- ⚠️ Y NO ES EL AGUJERO DE `confirm_simulated_payment` (ver `20260901140000`).
-- Aquel dejaba al usuario ELEGIR el camino barato: bastaba con poner su
-- `payout_country` en «sin declarar» para que su reserva congelara
-- `provider = 'simulated'` y confirmarla sin mover un céntimo. Aquí no hay nada
-- que elegir desde el navegador: `gross_amount` lo congela
-- `create_booking_line` leyendo `products.price_amount`, que solo escribe el
-- TUTOR dueño de la mentoría (`products_write_own`), y lo que se confirma es
-- exactamente lo que ese precio dice. Un tutor puede regalar sus propias
-- mentorías; eso no es un fraude, es el caso de uso que pidió el cliente. Y no
-- hay payout que inflar: con `gross = 0`, `tutor_net` es 0.
--
-- `create or replace` y no `drop` + `create`: misma firma, mismo número de
-- argumentos, así que no hay sobrecarga posible (regla de oro 12) y los
-- `grant execute` se conservan.
-- ============================================================================

create or replace function public.confirm_credit_booking(p_booking_id uuid, p_student uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_p record;
begin
  if p_student is null then
    raise exception 'falta el alumno' using errcode = '28000';
  end if;

  if not exists (select 1 from public.bookings b
                  where b.id = p_booking_id and b.student_id = p_student) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  select p.id, p.gross_amount, coalesce(p.credit_amount, 0) as credit_amount, p.credit_id
    into v_p
  from public.payments p where p.booking_id = p_booking_id;

  if v_p.id is null then
    raise exception 'esta reserva no tiene cobro' using errcode = 'no_data_found';
  end if;

  -- Se reverifica DENTRO, no se confía en el Route Handler.
  if v_p.credit_amount is distinct from v_p.gross_amount then
    raise exception 'este cobro no está cubierto al 100 %% por un crédito (% de %)',
      v_p.credit_amount, v_p.gross_amount using errcode = 'check_violation';
  end if;

  -- 🎁 LA MENTORÍA GRATIS. No hay crédito que mirar porque no hay nada que
  -- financiar: el precio del producto ya era 0 cuando `create_booking_line`
  -- congeló el snapshot. Se sale por aquí ANTES del cerrojo del crédito, que
  -- con `credit_id` null se negaría siempre — que es exactamente el bug que
  -- dejaba al alumno sin poder reservar la mentoría de onboarding.
  --
  -- El `p_event_id` no es decorativo: sin él `confirm_payment` se salta su
  -- deduplicación por evento. Lleva el id de la reserva, que es único y estable,
  -- así que dos pulsaciones seguidas dan un no-op en vez de dos caminos.
  if v_p.gross_amount = 0 then
    return public.confirm_payment(p_booking_id, true, 'gratis:' || p_booking_id, 0::bigint);
  end if;

  if not exists (select 1 from public.credits c
                  where c.id = v_p.credit_id and c.status in ('active','consumed')) then
    raise exception 'el crédito de esta reserva no está vivo' using errcode = 'check_violation';
  end if;

  -- El cuarto argumento es 0 y es verdad: por la pasarela no entró nada. La
  -- conciliación de confirm_payment lo comprueba contra gross - credit.
  return public.confirm_payment(p_booking_id, true, 'credit:' || v_p.id, 0::bigint);
end;
$fn$;

comment on function public.confirm_credit_booking(uuid, uuid) is
  'Marca pagada una reserva que no tiene nada que cobrar: o la cubre un crédito al 100 %, o la mentoría es gratis (gross_amount = 0, sin crédito de por medio). En los dos casos abrir un cargo de 0 en Stripe es un 400. Reverifica la cobertura y la propiedad de la reserva dentro, porque corre con service_role y no tiene auth.uid().';
