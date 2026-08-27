-- ============================================================================
-- Enséñame Ya — B-1: el hold a 7 MINUTOS, y la carrera que hay que cerrar con él
-- (V-3 y V-10 de la lista del 21-ago · Doc 22 §22.9 · RN-26 · regla de oro 2)
--
-- Dos cosas en un solo fichero, y van juntas porque la primera empeora la
-- segunda.
--
-- ── 1) EL PLAZO: de 20 minutos a 7 ──────────────────────────────────────────
--
-- El cliente lo pidió así, literal: «7 minutos. Fin.» (V-3, 24-ago). Es marcha
-- atrás sobre D-2, donde el hold de 20 min se anunció a propósito con contador
-- visible. Aquí se ejecuta.
--
-- ⚠️ SERÁN 7-8, NO 7, Y CONVIENE DECIRLO. Este corte no lo aplica un reloj por
-- reserva: lo aplica pg_cron cuando pasa. Con el job cada 5 minutos, «7» era en
-- realidad «entre 7 y 12» — por eso más abajo se reprograma a CADA MINUTO. Con
-- eso el error máximo baja a un minuto, que es lo más fino que da cron sin
-- inventarse otra arquitectura.
--
-- Y el número que se le ENSEÑA al alumno sigue siendo el corto (7), a sabiendas:
-- que el horario aguante un poco más de lo prometido es la dirección buena del
-- error. Ver `HOLD_POLICY` en `src/lib/policy.ts`, que es la copia que se pinta.
--
-- ── 2) LA CARRERA: cobrado, cancelado y sin reembolso posible ───────────────
--
-- 🔴 Esto YA existía; bajar el corte solo lo hace más probable. La rama 1 leía
-- las candidatas y luego las cancelaba SIN MIRAR SI SEGUÍAN PENDIENTES:
--
--     select array_agg(id) into v_pay_ids            -- foto
--       from public.bookings
--      where status = 'pending_payment' and created_at < now() - cutoff;
--     ...
--     update public.bookings set status = 'cancelled'
--      where id = any(v_pay_ids);                    -- ← sin guarda de estado
--
-- Si el webhook de Stripe confirmaba ENTRE la foto y el update, el resultado
-- era: `payments.status = 'paid'`, `bookings.status = 'cancelled'` y **ningún
-- reembolso encolado** — la rama 1 no encola nada porque da por hecho que no se
-- llegó a cobrar, y su update de `payments` lleva `and status = 'pending'`, así
-- que ni siquiera marca el pago. Dinero cobrado, clase cancelada, y nada en la
-- cola de X-01 que lo devuelva. El peor de los tres estados posibles.
--
-- La ventana era de 5 minutos de cron; con el corte a 7 min y el job cada
-- minuto, la reserva vence justo cuando la gente está terminando de pagar. O
-- sea: la carrera pasa de rara a esperable.
--
-- ⚠️ EL ARREGLO SON DOS LÍNEAS, Y EL ORDEN DE LAS TRES TABLAS NO SE TOCA.
-- Es tentador cancelar primero la reserva y derivar de ahí el resto, pero eso
-- INVIERTE EL ORDEN DE BLOQUEO respecto a `confirm_payment` (20260817180000),
-- que toma primero `payments` y luego `bookings`. Dos transacciones que cogen
-- los mismos dos registros en orden contrario es la definición de un deadlock,
-- y aquí una de las dos es el webhook del dinero.
--
-- Con `payments` primero se conserva el orden y además se gana la valla: en
-- cuanto este job bloquea la fila del pago, el webhook NO PUEDE confirmar hasta
-- que esta transacción termine. Así solo queda un caso, el de que el webhook
-- hubiera confirmado ANTES de la foto — y ése lo corta la guarda de estado del
-- update de `bookings`, que en READ COMMITTED reevalúa el predicado contra la
-- última versión confirmada de la fila.
--
-- Lo que el webhook haga después ya estaba resuelto: `confirm_payment` sale
-- por su idempotencia de estado al ver el pago en 'failed', y el cobro tardío
-- lo devuelve X-02 (20260817160000).
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
-- El cuerpo sale de **X-01** (`20260817170000`), no del original
-- `20260709190000`: la rama 2 encola reembolsos reales por RN-38, y copiar el
-- cuerpo viejo los revertiría sin que nada avisara. La rama 2 se queda letra
-- por letra. Y NO se reabre el `execute` a `authenticated` — `20260715150000`
-- lo cerró porque cualquiera podía vencer con `0 seconds` las reservas de toda
-- la plataforma; hoy eso ADEMÁS dispararía reembolsos reales.
-- ============================================================================


create or replace function public.expire_stale_bookings(
  -- V-3 · 20 minutes → 7 minutes. El otro corte (RN-38) no se toca.
  p_payment_cutoff    interval default interval '7 minutes',
  p_acceptance_cutoff interval default interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Las candidatas que vio la foto…
  v_pay_ids  uuid[];
  -- …y las que de verdad se cancelaron. NO tienen por qué coincidir: esa
  -- diferencia es la carrera, y por eso se cuenta abajo en vez de esconderse.
  v_pay_done uuid[];
  v_acc_ids  uuid[];
  v_r        record;
  v_encolados int := 0;
begin
  -- 1) pending_payment vencidas (nunca se cobró) → cancelled, sin reembolso.
  select array_agg(id) into v_pay_ids
  from public.bookings
  where status = 'pending_payment'
    and created_at < now() - p_payment_cutoff;

  if v_pay_ids is not null then
    -- ⚠️ `payments` PRIMERO, y no por costumbre: fija el mismo orden de bloqueo
    -- que `confirm_payment` (evita el deadlock) y de paso valla al webhook
    -- mientras dura esta transacción. Ver la cabecera.
    update public.payments set status = 'failed', failed_at = now()
      where booking_id = any(v_pay_ids) and status = 'pending';

    -- ⚠️ AQUÍ ESTÁ LA GUARDA. `and status = 'pending_payment'` es lo que impide
    -- cancelar una reserva que el webhook confirmó entre la foto y este update;
    -- el `returning` es lo que permite que las sesiones se cancelen SOLO de las
    -- reservas que de verdad se cancelaron, y no de las que se salvaron.
    with canceladas as (
      update public.bookings
         set status = 'cancelled', cancelled_at = now()
       where id = any(v_pay_ids)
         and status = 'pending_payment'
      returning id
    )
    select array_agg(id) into v_pay_done from canceladas;

    if v_pay_done is not null then
      update public.sessions set status = 'cancelled', cancelled_at = now()
        where booking_id = any(v_pay_done) and status = 'scheduled';
    end if;
  end if;

  -- 2) pending_acceptance vencidas (tutor no respondió) → cancelled + 100%.
  --    Íntegra de X-01. No se toca.
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
    -- Ahora cuenta las que SE CANCELARON, no las que se leyeron. Antes eran lo
    -- mismo por construcción; con la guarda puesta ya no, y el número honesto
    -- es este.
    'payment_expired',    coalesce(array_length(v_pay_done, 1), 0),
    -- 🔎 EL TERMÓMETRO DE LA CARRERA. Candidatas que la guarda salvó porque
    -- dejaron de estar pendientes entre la foto y el update: reservas que se
    -- pagaron justo a tiempo. Si esto sube de cero con regularidad, el corte de
    -- 7 min está mordiendo a gente que está pagando de verdad, y ese es el dato
    -- con el que se vuelve al cliente — no una impresión.
    'payment_raced',      coalesce(array_length(v_pay_ids, 1), 0)
                          - coalesce(array_length(v_pay_done, 1), 0),
    'acceptance_expired', coalesce(array_length(v_acc_ids, 1), 0),
    'refunds_enqueued',   v_encolados
  );
end;
$$;

comment on function public.expire_stale_bookings(interval, interval) is
  'V-3 · vence checkouts a los 7 min (antes 20) y aceptaciones a las 24 h (RN-38, con reembolso por la cola de X-01). La rama de pago lleva guarda de estado: no cancela una reserva que el webhook confirmó entre la lectura y el update. `payment_raced` cuenta cuántas veces pasó.';

-- `create or replace` conserva privilegios, pero se repiten por si esta
-- migración se aplica sobre una base donde la función no existiera: en Postgres
-- el `execute` nace concedido a PUBLIC. Mismo gotcha que 20260715150000,
-- 20260806120000, 20260817160000 y X-01.
revoke execute on function public.expire_stale_bookings(interval, interval) from public;
revoke execute on function public.expire_stale_bookings(interval, interval) from anon;
revoke execute on function public.expire_stale_bookings(interval, interval) from authenticated;
grant  execute on function public.expire_stale_bookings(interval, interval) to service_role;


-- ── El cron, a cada minuto ──────────────────────────────────────────────────
--
-- ⚠️ ESTO NO ES AFINADO, ES LA MITAD DE LA FICHA. Con el job cada 5 minutos,
-- un corte de 7 significa «entre 7 y 12»: el propio plazo que se le promete al
-- alumno sería mentira casi la mitad de las veces. A cada minuto, el error
-- máximo es de un minuto.
--
-- `unschedule` + `schedule` y no un update a `cron.job`: es el patrón que ya
-- usan `20260716140000`, `20260716170000`, `20260716180000` y `20260716120000`,
-- y el `where exists` lo hace idempotente sobre una base que no lo tuviera.
--
-- El coste es despreciable: la pasada es dos `select` indexados y, casi
-- siempre, cero updates. `bookings` tiene índice por `status`
-- (20260709140000) y esto no escanea nada más.
select cron.unschedule('expire-stale-bookings')
 where exists (select 1 from cron.job where jobname = 'expire-stale-bookings');

select cron.schedule(
  'expire-stale-bookings',
  '* * * * *',
  $cron$ select public.expire_stale_bookings() $cron$
);
