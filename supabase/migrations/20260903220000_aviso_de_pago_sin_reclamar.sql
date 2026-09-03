-- ============================================================================
-- Enséñame Ya — avisar al tutor cuando su pago salió y NO ha llegado.
--
-- ── EL AGUJERO ─────────────────────────────────────────────────────────────
--
-- PayPal deja un payout en `UNCLAIMED` cuando el correo del destinatario no es
-- el de una cuenta suya confirmada. Lo retiene **30 días** y después lo
-- devuelve. Medido contra su sandbox el 3-sep-2026: mismo importe, misma
-- cuenta, misma API — por correo sin confirmar sale `UNCLAIMED`, por id de
-- cuenta entra con `SUCCESS`.
--
-- Lo que ve el tutor mientras tanto: en su panel el cobro figura como enviado
-- —que es verdad, el lote está en `SUCCESS`— y el dinero no aparece. **Nadie le
-- dice nada.** Se entera el día 30, cuando vuelve.
--
-- Y no es un caso raro: el correo de PayPal de un tutor y el que escribe en
-- nuestro formulario son dos datos distintos que él tiene que hacer coincidir a
-- mano.
--
-- ── POR QUÉ 7 DÍAS, Y POR QUÉ ES UN ARGUMENTO ──────────────────────────────
--
-- PayPal devuelve a los 30. Avisar el día 7 deja 23 para arreglarlo, que es
-- tiempo de sobra para cambiar un correo y que salga el siguiente lote semanal.
-- Avisar antes sería ruido —un pago recién enviado tarda en llegar de todas
-- formas— y avisar más tarde recorta el margen sin ganar nada.
--
-- Va como argumento con defecto y no como constante: subirlo o bajarlo es una
-- llamada distinta, no un despliegue.
--
-- ── LO QUE ESTA FUNCIÓN NO HACE ────────────────────────────────────────────
--
-- No mira si PayPal dijo `UNCLAIMED`. Mira que la orden lleve N días RECLAMADA
-- y sin cerrar, que es lo mismo desde el punto de vista del tutor y no obliga a
-- guardar el vocabulario de un proveedor en la base. Si mañana otro riel deja
-- un pago colgado igual, este aviso ya lo cubre.
--
-- ponytail: no hay tabla de estado ni columna nueva. `enqueue_notification` ya
-- es idempotente por `idempotency_key`, así que «avisar una sola vez» sale
-- gratis: la clave lleva el id del payout y el segundo intento no inserta nada.
-- El techo es que si alguien quiere un SEGUNDO recordatorio a los 20 días, hará
-- falta meter el día en la clave. Hoy no hace falta y no se escribe.
-- ============================================================================

create or replace function public.avisar_payouts_sin_reclamar(p_dias int default 7)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila  record;
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
       -- El instante en que el job reclamó la orden, que lo sella él mismo en
       -- `provider_metadata.c2.reclamado_en`. NO se usa `updated_at`: cada
       -- pasada de seguimiento la toca, así que con ella la orden parecería
       -- recién creada para siempre y este aviso no saldría nunca.
       and (p.provider_metadata -> 'c2' ->> 'reclamado_en') is not null
       and (p.provider_metadata -> 'c2' ->> 'reclamado_en')::timestamptz
             < now() - make_interval(days => p_dias)
  loop
    perform public.enqueue_notification(
      v_fila.tutor_id,
      'NTF-23',
      'email',
      'payout_unclaimed',
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
  'Encola NTF-23 para cada payout que lleva N días reclamado y sin cerrar. Existe por el UNCLAIMED de PayPal —retiene 30 días un pago cuyo correo no es el de una cuenta confirmada y luego lo devuelve— durante los cuales el panel del tutor dice «enviado» y el dinero no está. Cuenta desde provider_metadata.c2.reclamado_en y NO desde updated_at, que cada pasada de seguimiento reescribe. Avisa UNA vez por payout: la idempotencia la da la clave de enqueue_notification, no una columna. La llama el job de payouts, no un cron propio.';

revoke execute on function public.avisar_payouts_sin_reclamar(int) from public;
revoke execute on function public.avisar_payouts_sin_reclamar(int) from anon;
revoke execute on function public.avisar_payouts_sin_reclamar(int) from authenticated;
grant  execute on function public.avisar_payouts_sin_reclamar(int) to service_role;

-- ── Autocomprobación ───────────────────────────────────────────────────────
do $$
declare n int;
begin
  -- Corre sin caerse y no avisa de nada que no lleve el tiempo puesto. Con un
  -- umbral absurdo no debe salir ni una fila, aunque haya órdenes en vuelo.
  select public.avisar_payouts_sin_reclamar(3650) into n;
  if n <> 0 then
    raise exception 'con umbral de 10 años salieron % avisos', n;
  end if;

  -- Y el umbral inválido se para en vez de avisar de todo.
  begin
    perform public.avisar_payouts_sin_reclamar(0);
    raise exception 'un umbral de 0 días tenía que fallar y no falló';
  exception when check_violation then
    null;
  end;

  if has_function_privilege('authenticated',
       'public.avisar_payouts_sin_reclamar(int)', 'execute') then
    raise exception 'avisar_payouts_sin_reclamar es ejecutable por authenticated';
  end if;

  raise notice 'NTF-23 listo: avisa una vez por payout a los N días.';
end $$;
