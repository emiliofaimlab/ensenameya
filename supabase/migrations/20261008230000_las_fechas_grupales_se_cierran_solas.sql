-- ============================================================================
-- Enséñame Ya — close_expired_sessions también cierra las fechas grupales
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2. Lo grupal ya lo hacía casi todo
-- solo, porque esta función trabaja SESIÓN A SESIÓN y cada inscrito tiene la
-- suya: completed quien entró, no_show quien faltó, y la reserva pasa a
-- completed cuando no le queda ninguna viva (las fechas que canceló el tutor
-- ya están 'cancelled' y no la frenan). De ese completed cuelga el payout.
-- Faltaba cerrar la propia `group_class`.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · REEMPLAZA a la versión VIVA de dev (`pg_get_functiondef`, 8-oct; última
--   migración `20260828183000:68`). Un solo bloque nuevo, marcado «G ·».
-- · ⚠️ Regla de oro 11: es la función que acumuló 12.446 fallos seguidos por
--   un cast. El `case … ::public.session_status` se copia tal cual. Tras
--   aplicar, se mira la corrida real de `close-expired-sessions`.
-- · El `jsonb` de vuelta gana `group_classes_closed`; la clave de siempre no
--   cambia.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.close_expired_sessions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_closed  int;
  v_booking_ids uuid[];
  v_grupales int;
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

  -- G · la fecha grupal se cierra con la misma ventana que sus sesiones,
  -- tenga inscritos o no. Sus sesiones ya las resolvió el `update` de arriba,
  -- una por alumno: completed quien entró, no_show quien no (DP-08: pagó).
  update public.group_classes g
     set status = 'completed'
   where g.status = 'scheduled'
     and now() > upper(public.session_live_window(g.start_at, g.end_at));
  get diagnostics v_grupales = row_count;

  return jsonb_build_object('sessions_closed', coalesce(v_closed, 0),
                            'group_classes_closed', v_grupales);
end;
$function$;
