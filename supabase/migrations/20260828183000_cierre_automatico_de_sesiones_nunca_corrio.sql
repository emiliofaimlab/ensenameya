-- ============================================================================
-- 🐞 `close_expired_sessions()` llevaba 12.446 fallos seguidos y CERO éxitos.
--
-- Reportado por el cliente el 28-ago: una mentoría que terminó hace dos horas
-- seguía diciendo «En curso» en «Mis reservas», y la sala ya no dejaba entrar.
-- Lo segundo es correcto (B-2: la sala vive ±10 min). Lo primero es este bug:
-- la sesión nunca salió de `in_progress` porque **el cron que la cierra no ha
-- funcionado ni una sola vez desde que existe**.
--
--     jobname                 status   veces   desde                 hasta
--     close-expired-sessions  failed   12446   2026-07-16 13:40 UTC  2026-08-28 18:45 UTC
--
-- ── EL ERROR, Y POR QUÉ NO LO VIO NADIE ────────────────────────────────────
--
--     ERROR: column "status" is of type public.session_status
--            but expression is of type text
--     LINE 3:  set status = case when s.status = 'in_progress' then …
--     HINT:  You will need to rewrite or cast the expression.
--
-- En `case when … then 'completed' else 'no_show' end` los dos literales son
-- de tipo `unknown`. Cuando TODAS las ramas de un `case` son `unknown`,
-- Postgres resuelve el resultado como `text` (§10.5), y de `text` a un enum
-- **no hay cast de asignación**: el `update` revienta. Un literal suelto
-- (`set status = 'completed'`, como en `complete_session`) sí se resuelve
-- contra el tipo de la columna, y por eso el cierre MANUAL del tutor siempre
-- funcionó — lo que tapó el agujero durante seis semanas.
--
-- El resto del repo ya lo hacía bien y ninguna de esas líneas falla:
--   · `20260715120000:126` → `end::public.document_status`
--   · `20260806150000:117` → `end::public.notification_status`
--   · `20260817180000:191` → `end::public.booking_status`
-- Esta era la única sin cast. Se copió tal cual de `20260716120000` a la v2 de
-- MN-05 (`20260820190000`), así que el fallo sobrevivió a una reescritura
-- entera de la función: nadie la ejecutó, solo se leyó.
--
-- **Y no lo vio nadie porque un job de pg_cron que falla no se le queja a
-- nadie.** No hay build en rojo, no hay 500 en Vercel, no hay fila en
-- `notifications`: el error se queda en `cron.job_run_details`, que es una
-- tabla que hay que ir a mirar. La lección operativa está en la regla de oro
-- 11 de CLAUDE.md.
--
-- ── LO QUE COSTABA ─────────────────────────────────────────────────────────
-- No era cosmético. De `close_expired_sessions` cuelga toda la cola de la
-- mentoría terminada:
--   · `sessions` se quedan en `scheduled`/`in_progress` para siempre — hoy hay
--     17 vencidas, la más vieja del 17-ago. `no_show` no existe en la base: no
--     hay ni una fila, porque el único que lo escribe es este job.
--   · `bookings` nunca llegan a `completed`, así que **`completed_at` es null y
--     el payout del tutor no se programa jamás** (§12 del contrato). El dinero
--     entra y no sale.
--   · Sin reserva `completed` no hay reseña posible (`20260729150000` la exige)
--     ni NTF-19 de grabación (`20260729230000`).
--   · Y el panel del alumno dice «En curso» de una clase de la semana pasada,
--     que es por donde entró el reporte.
--
-- ── QUÉ SE TOCA ────────────────────────────────────────────────────────────
-- El cast, y solo el cast. Mismo umbral (`upper(session_live_window(…))` =
-- `end_at + 10 min`), misma semántica de `no_show`, mismos grants. El reloj de
-- la contabilidad no se mueve ni un segundo: ver la cabecera de
-- `20260820190000`.
--
-- **Sin puesta al día explícita**: el `where` no mira la antigüedad, así que el
-- primer tick del cron después de esta migración (≤5 min) cierra de golpe todo
-- lo atrasado. Llamarla aquí solo adelantaría eso mismo unos minutos y haría
-- que el efecto pareciera de la migración y no del job.
-- ============================================================================

create or replace function public.close_expired_sessions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed  int;
  v_booking_ids uuid[];
begin
  -- Cierra las sesiones vencidas y recuerda sus reservas para revisarlas.
  with expired as (
    update public.sessions s
       -- ⚠️ EL `::public.session_status` ES EL ARREGLO. Sin él las dos ramas
       -- del `case` son `unknown`, el `case` entero resuelve a `text` y el
       -- `update` falla en EJECUCIÓN — nunca al crear la función. Si algún día
       -- se reescribe esta línea, el cast se va con ella.
       set status = case when s.status = 'in_progress'
                         then 'completed'::public.session_status
                         else 'no_show'::public.session_status
                    end,
           completed_at = case when s.status = 'in_progress' then now() else completed_at end
     where s.status in ('scheduled', 'in_progress')
       and now() > upper(public.session_live_window(s.start_at, s.end_at))
    returning s.booking_id
  )
  select count(*), array_agg(distinct booking_id) into v_closed, v_booking_ids from expired;

  -- Reservas cuyas sesiones ya están todas resueltas → completed.
  if v_booking_ids is not null then
    update public.bookings b
       set status = 'completed', completed_at = now()
     where b.id = any(v_booking_ids)
       and b.status in ('confirmed', 'in_progress')
       and not exists (
         select 1 from public.sessions s
         where s.booking_id = b.id and s.status in ('scheduled', 'in_progress')
       );
  end if;

  return jsonb_build_object('sessions_closed', coalesce(v_closed, 0));
end;
$$;

comment on function public.close_expired_sessions() is
  'US-802 · cierre automático de la sesión vencida (pg_cron cada 5 min). Umbral: upper(session_live_window()) = end_at + 10 min. ⚠️ 28-ago: estuvo fallando 12.446 veces seguidas desde el 16-jul por un case sin ::session_status — el enum necesita el cast explícito, y de esta función cuelga bookings.completed_at y con él el payout del tutor.';

-- Gotcha de US-605: `execute` es de PUBLIC por defecto. Se repite el candado
-- por si la función no existiera en la base donde caiga esta migración.
revoke execute on function public.close_expired_sessions() from public;
revoke execute on function public.close_expired_sessions() from anon;
revoke execute on function public.close_expired_sessions() from authenticated;
grant  execute on function public.close_expired_sessions() to service_role;

-- El `cron.schedule` de `20260716120000` sigue en pie y apunta a esta función
-- por nombre: `create or replace` no lo altera. Reprogramarlo aquí solo daría
-- ocasión de duplicarlo.
