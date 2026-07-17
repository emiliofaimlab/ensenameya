-- Demo: reparte en el tiempo las clases completadas del tutor de demo.
--
-- Problema: sus reservas completadas se crearon todas HOY (son fixtures de
-- payouts), y eso rompe dos cosas a la vez:
--   1. El panel las muestra como la misma fila repetida (mismo producto, mismo
--      importe, misma fecha).
--   2. `tutor_balance` retiene 7 días desde `completed_at`: al estar todas
--      completadas hoy, caen enteras en "En retención" y "Disponible para
--      retirar" sale vacío → no se puede demostrar el retiro (US-1001/RN-40).
--
-- NO BORRA NADA. Pagos, reseñas, mensajes y sesiones siguen colgando de estas
-- reservas (todas son `on delete cascade`: borrarlas se llevaría por delante
-- los saldos, las reseñas del tutor y el chat). Esto solo mueve fechas de datos
-- de demo fabricados.
--
-- Reparte a 2, 11, 20, 29, 38 días atrás: la primera sigue dentro de la
-- retención de 7 días (mantiene "En retención" con saldo, que también hay que
-- enseñar) y el resto vence y pasa a "Disponible para retirar".
--
-- Ejecutar en el SQL Editor de Supabase (dev). Reejecutable: ordena por `id`,
-- que no cambia, así que repartir dos veces da el mismo resultado.

with ordenadas as (
  -- `::int` porque row_number() es bigint y make_interval solo acepta int.
  select b.id, (row_number() over (order by b.id))::int as n
    from public.bookings b
   where b.status = 'completed'
     -- El tutor se identifica por una reserva suya conocida, no por nombre.
     and b.tutor_id = (
       select tutor_id from public.bookings
        where id = 'a2307575-ee95-4b43-8cbc-6cb05b4a0e83'
     )
     -- Las ya liquidadas quedan fuera del reparto: `tutor_balance` las excluye
     -- de "Disponible" y "En retención" (cuentan como "Ya pagado"), así que si
     -- una cae en el hueco reciente, ese hueco no lo llena nadie y "En
     -- retención" sale vacío. Mover su fecha tampoco significaría nada: su
     -- payout ya está cerrado.
     and not exists (
       select 1
         from public.payout_items pi
         join public.payments p on p.id = pi.payment_id
        where p.booking_id = b.id
     )
),
fechas as (
  -- 2, 11, 20, 29, 38 días atrás: la primera cae dentro de la retención de 7
  -- días y el resto vence. Así los tres contadores del panel tienen número.
  select id, date_trunc('hour', now() - make_interval(days => (n - 1) * 9 + 2)) as inicio
    from ordenadas
),
-- CTE que escribe: Postgres la ejecuta entera aunque la consulta final no la
-- lea, y ambas ven el mismo `fechas` (calculado antes de tocar nada).
mueve_reservas as (
  update public.bookings b
     set created_at   = f.inicio,
         completed_at = f.inicio + interval '1 hour'
    from fechas f
   where b.id = f.id
  returning 1
)
-- La clase se dio cuando se reservó: si no, quedan reservas de hace semanas con
-- la sesión hoy, y eso se ve al entrar en "Reservas".
update public.sessions s
   set start_at = f.inicio,
       end_at   = f.inicio + interval '1 hour'
  from fechas f
 where s.booking_id = f.id;
