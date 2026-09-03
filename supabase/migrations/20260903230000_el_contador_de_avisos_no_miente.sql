-- ============================================================================
-- Enséñame Ya — el contador de avisos contaba candidatos, no avisos.
--
-- `avisar_payouts_sin_reclamar` (20260903220000) sumaba una vuelta de bucle por
-- cada payout que cumplía la condición, y `enqueue_notification` descarta el
-- duplicado por `idempotency_key`. O sea que a partir del día 7 el job iba a
-- reportar `avisadosSinReclamar: 1` en CADA pasada, para siempre, habiendo
-- mandado un solo correo. Medido en dev nada más escribirlo: dos llamadas
-- seguidas devolvieron 1 y 1.
--
-- Un contador así no es un detalle cosmético: es la cifra por la que alguien
-- decidiría que hay un problema con los pagos de PayPal —«todos los días hay
-- tutores sin cobrar»— cuando lo que hay es el mismo tutor contado 200 veces.
--
-- El arreglo no es contar inserciones: es no mirar los que ya tienen aviso. Sale
-- más barato (el bucle se queda vacío en cuanto todos están avisados) y el
-- número pasa a significar lo que dice: tutores que se enteran HOY.
-- ============================================================================

create or replace function public.avisar_payouts_sin_reclamar(p_dias int default 7)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila   record;
  v_avisos int := 0;
begin
  if p_dias < 1 then
    raise exception 'el umbral de días tiene que ser al menos 1, y llegó %', p_dias
      using errcode = 'check_violation';
  end if;

  for v_fila in
    select p.id, p.tutor_id, p.amount, p.currency
      from public.payouts p
     where p.status = 'processing'::public.payout_status
       and (p.provider_metadata -> 'c2' ->> 'reclamado_en') is not null
       and (p.provider_metadata -> 'c2' ->> 'reclamado_en')::timestamptz
             < now() - make_interval(days => p_dias)
       -- 🔑 LOS QUE YA TIENEN AVISO NO SE VUELVEN A MIRAR. Es lo que hace que el
       -- número devuelto signifique «tutores avisados en esta pasada» y no
       -- «tutores que cumplen la condición», que a los tres días son lo mismo y
       -- a los treinta no se parecen en nada.
       and not exists (
         select 1 from public.notifications n
          where n.idempotency_key = 'NTF-23:payout:' || p.id
       )
  loop
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-23', 'email', 'payout_unclaimed',
      jsonb_build_object(
        'payout_id', v_fila.id,
        'amount',    v_fila.amount,
        'currency',  v_fila.currency,
        'dias',      p_dias
      ),
      'NTF-23:payout:' || v_fila.id
    );
    v_avisos := v_avisos + 1;
  end loop;

  return v_avisos;
end $$;

comment on function public.avisar_payouts_sin_reclamar(int) is
  'Encola NTF-23 para cada payout que lleva N días reclamado y sin cerrar, y devuelve CUÁNTOS SE AVISARON EN ESTA PASADA — descarta en el propio select los que ya tienen la notificación, porque contar candidatos hacía que el job reportara el mismo tutor en cada corrida para siempre. Existe por el UNCLAIMED de PayPal: retiene 30 días un pago cuyo destinatario no lo reclama y luego lo devuelve, y mientras tanto el panel del tutor dice «enviado» y el dinero no está. Cuenta desde provider_metadata.c2.reclamado_en y NO desde updated_at, que cada pasada de seguimiento reescribe.';

do $$
declare n int;
begin
  select public.avisar_payouts_sin_reclamar(3650) into n;
  if n <> 0 then
    raise exception 'con umbral de 10 años salieron % avisos', n;
  end if;
  raise notice 'el contador ya cuenta avisos, no candidatos.';
end $$;
