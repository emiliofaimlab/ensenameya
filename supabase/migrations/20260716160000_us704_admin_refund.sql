-- ============================================================================
-- Enséñame Ya — US-704 (SCR-AD08): reembolso manual del admin (M6, DP-03).
--
-- Distinto de `cancel_booking` (reembolso por política RN-37 al cancelar): esto
-- es una corrección financiera del admin sobre un pago ya cobrado, total o
-- parcial. Server-side y solo admin (S-15/RN-26).
--
-- S-29 / M4: un reembolso TOTAL antes de liquidar excluye el `payout_item` del
-- payout no pagado (y lo revierte). Si el payout ya está `paid`, el tutor ya
-- cobró → se marca **clawback manual** (no se automatiza en el MVP); el
-- reembolso al alumno igual procede.
-- ============================================================================

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

  -- NTF-10 (stub, EP-12): avisar al alumno del reembolso.
  return jsonb_build_object(
    'refunded_amount', v_amount,
    'total_refunded',  v_new_total,
    'status',          v_new_status::text,
    'clawback_needed', v_clawback
  );
end;
$$;

grant execute on function public.refund_payment(uuid, bigint) to authenticated;
