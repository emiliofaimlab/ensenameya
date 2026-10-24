-- ============================================================================
-- Enséñame Ya — el regalo de un cupo vuelve como saldo si la clase se llena
-- o se cancela (RG-17, anexo B escenario 17)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Un regalo de mentoría es un crédito `kind='mentoria'` atado a su product_id:
-- `credito_aplicable` lo rechaza en cualquier otra («este regalo es para otra
-- mentoría»). En una clase grupal eso deja al destinatario con dinero que no
-- puede usar en ningún sitio si la clase se llena antes de que lo canjee, o si
-- se cancela —por el tutor, por el admin o por no llegar al mínimo—: el
-- comentario de `comprar_regalo` (`20261009190000`) lo daba por bueno («queda
-- como crédito sin gastar»), pero RG-17 dice que vuelve como SALDO.
--
-- ── CÓMO ───────────────────────────────────────────────────────────────────
-- · La conversión es la de NTF-38 (`20260916100000:149`, el tutor que se da de
--   baja): kind 'mentoria' → 'saldo', 30 días de gracia que nunca acortan, y
--   aviso `gift_converted` a quien lo tiene. Aquí se parametriza por producto
--   en una función nueva; la de la baja no se toca.
-- · Dos disparadores, sin reescribir `notify_booking`:
--     1. una reserva grupal pasa a 'confirmed' y ya no quedan cupos;
--     2. el producto grupal pasa a 'archived' (así termina `cancelar_clase_grupal`,
--        que es también el camino del admin y del mínimo).
-- · El regalo que se está canjeando no se convierte: `aplicar_credito` ya le
--   subió `consumed_amount`, y el filtro pide que quede dinero dentro.
-- · ⚠️ Si después se libera un cupo (un hold caduca, alguien se da de baja),
--   el saldo NO vuelve a ser regalo de esa clase: ya vale para cualquiera, que
--   es estrictamente más.
-- ============================================================================

create or replace function public.regalos_de_clase_a_saldo(p_product uuid, p_causa text)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_r record;
  v_n int := 0;
begin
  -- Mismo patrón y mismo filtro que `convertir_regalos_en_bono`: `with … update
  -- … returning` (un FOR de plpgsql no admite una sentencia que escribe).
  for v_r in
    with a_bono as (
      update public.credits c
         set kind = 'saldo',
             expires_at = case
                            when c.expires_at is null then null
                            else greatest(c.expires_at, now() + interval '30 days')
                          end
       where c.source  = 'gift'
         and c.kind    = 'mentoria'
         and c.status  = 'active'
         and c.destino = 'cobro'
         and c.amount  > c.consumed_amount
         and (c.expires_at is null or c.expires_at > now())
         and c.product_id = p_product
      returning c.id, c.beneficiary_id, c.purchased_by, c.product_id,
                c.amount, c.consumed_amount, c.currency, c.expires_at
    )
    select * from a_bono
  loop
    perform public.enqueue_notification(
      coalesce(v_r.beneficiary_id, v_r.purchased_by),
      'NTF-38', 'email', 'gift_converted',
      jsonb_build_object(
        'credit_id',  v_r.id,
        'product_id', v_r.product_id,
        'restante',   v_r.amount - v_r.consumed_amount,
        'currency',   v_r.currency,
        'expires_at', v_r.expires_at,
        'causa',      p_causa),
      'CRED:bono:' || v_r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

comment on function public.regalos_de_clase_a_saldo(uuid, text) is
  'RG-17 · los regalos vivos de una clase grupal pasan a saldo (kind=''saldo'') cuando la clase se llena o se cancela, con 30 días de gracia y aviso NTF-38 (gift_converted, con la causa en el payload). Misma conversión que convertir_regalos_en_bono, por producto.';

revoke execute on function public.regalos_de_clase_a_saldo(uuid, text) from public, anon, authenticated;


-- 1 · la reserva que llena la clase
create or replace function public.regalos_si_la_clase_se_llena()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.pricing_model = 'group' and new.status = 'confirmed'
     and old.status is distinct from 'confirmed'
     and public.cupos_libres(new.product_id) = 0 then
    perform public.regalos_de_clase_a_saldo(new.product_id, 'clase_llena');
  end if;
  return new;
end;
$fn$;

revoke execute on function public.regalos_si_la_clase_se_llena() from public, anon, authenticated;

drop trigger if exists bookings_regalos_clase_llena on public.bookings;
create trigger bookings_regalos_clase_llena
  after update of status on public.bookings
  for each row execute function public.regalos_si_la_clase_se_llena();


-- 2 · la clase que se cancela (cancelar_clase_grupal archiva el producto)
create or replace function public.regalos_si_la_clase_se_cancela()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.pricing_model = 'group' and new.status = 'archived'
     and old.status is distinct from 'archived' then
    perform public.regalos_de_clase_a_saldo(new.id, 'clase_cancelada');
  end if;
  return new;
end;
$fn$;

revoke execute on function public.regalos_si_la_clase_se_cancela() from public, anon, authenticated;

drop trigger if exists products_regalos_clase_cancelada on public.products;
create trigger products_regalos_clase_cancelada
  after update of status on public.products
  for each row execute function public.regalos_si_la_clase_se_cancela();
