-- ============================================================================
-- Enséñame Ya — la baja PROGRAMADA también manda su despedida (Doc 33, NTF-29)
--
-- ── EL AGUJERO ─────────────────────────────────────────────────────────────
--
-- `20260911190000` y el handler de `/api/cuenta/eliminar` cubren la baja
-- INMEDIATA: la ruta tiene la dirección en la mano y manda `account_deletion_done`
-- por `sendEmail` antes de que nada se anonimice.
--
-- La baja PROGRAMADA no pasa por ninguna ruta. La completa
-- `process_pending_account_deletions()` desde `pg_cron`, de madrugada, dentro
-- de Postgres y sin ninguna petición HTTP delante. Resultado: quien tenía dinero
-- en vuelo recibía «tu cuenta queda desactivada»… y después NADA, NUNCA. O sea
-- que justo las personas que esperaron —las que más derecho tienen a un cierre—
-- eran las únicas que no se enteraban de que se cerró.
--
-- ── POR QUÉ ESTO SÍ PUEDE IR POR LA COLA (y la baja inmediata no) ──────────
--
-- Aquí no hay alternativa: no existe un servidor al que colgarle un envío
-- directo. Y funciona porque se hacen las dos cosas en el orden correcto:
--
--   1. la dirección REAL se lee ANTES de anonimizar, y viaja en el payload.
--      `anonymize_account` reescribe `auth.users.email` a
--      `cuenta-eliminada+<uuid>@ensenameya.invalid`, así que después no queda a
--      dónde escribir. `pending_email_notifications` prefiere
--      `payload->>'email'` sobre el join a `auth.users` justamente para este
--      caso — se hizo en `20260911170000` pensando en esta función;
--   2. se encola DESPUÉS de anonimizar, porque `anonymize_account` hace
--      `delete from public.notifications where recipient_id = …`: una fila
--      encolada antes se iría con ellas, en la misma transacción y sin ruido.
--
-- ⚠️ Sí, eso deja la dirección de alguien que acaba de pedir que lo borremos
-- dentro de un `payload` hasta que el job de correo pase. Es el precio de que se
-- entere, se paga a sabiendas, y lo acota la propia cola: al enviarse la fila
-- queda `sent` y la purga de `notifications` se la lleva como a cualquier otra.
-- La alternativa —no avisarle— es peor: la persona se queda sin saber si su
-- cuenta se borró, y no le queda ninguna forma de preguntarlo desde dentro.
--
-- ── Regla de oro 12: aquí NO aplica ────────────────────────────────────────
-- La firma y el `returns jsonb` no cambian, así que `create or replace` es
-- correcto y conserva el `grant execute … to service_role` de `20260831160000`
-- y el `cron.schedule('complete-pending-account-deletions', '0 5 * * *', …)`.
--
-- ── Regla de oro 11: cómo se comprueba que esto corre ──────────────────────
-- Es un job DIARIO, así que se cae de la ventana de las últimas filas: hay que
-- filtrar POR `jobname`, nunca mirar las diez últimas de `cron.job_run_details`.
--
--   select j.jobname, d.status, d.return_message, d.start_time
--     from cron.job_run_details d join cron.job j using (jobid)
--    where j.jobname = 'complete-pending-account-deletions'
--    order by d.start_time desc limit 5;
--
-- Y «arreglado» significa arreglado en SU ambiente: esta migración en dev no
-- arregla nada en producción hasta que el CI la lleve allí.
-- ============================================================================

create or replace function public.process_pending_account_deletions(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row          record;
  v_res          jsonb;
  v_correo       text;
  v_completadas  int := 0;
  v_esperando    int := 0;
  v_estancadas   int := 0;
  v_errores      int := 0;
  v_ficheros     int := 0;
begin
  for v_row in
    select r.user_id, r.requested_at
      from public.account_deletion_requests r
     where r.status = 'pending'::public.account_deletion_request_status
     order by r.requested_at          -- la más vieja primero: nadie se queda atrás
     limit greatest(1, coalesce(p_limit, 50))
  loop
    begin
      -- ⚠️ `if/else` y no un `continue` que salte fuera del bloque. Este
      -- `begin` lleva `exception`, o sea que es una SUBTRANSACCIÓN, y saltar
      -- fuera de una desde dentro es justo el tipo de detalle que `create or
      -- replace` no valida y que solo se descubre con el job en producción.
      if public.account_deletion_blockers(v_row.user_id) <> '{}'::jsonb then
        v_esperando := v_esperando + 1;
        -- Estancada: lleva más de 30 días esperando. Casi siempre significa un
        -- payout en 'failed' o en 'on_hold' que necesita un `admin_payout_action`
        -- — o sea, dinero parado que nadie está mirando. Se cuenta aquí porque
        -- es el único sitio del sistema que lo mira todas las noches.
        if v_row.requested_at < now() - interval '30 days' then
          v_estancadas := v_estancadas + 1;
        end if;
        update public.account_deletion_requests
           set last_check_at = now(), last_error = null
         where user_id = v_row.user_id;
      else
        -- ⚠️ ANTES de anonimizar: esta es la última línea del sistema en la que
        -- la dirección de esta persona todavía existe.
        select u.email::text into v_correo
          from auth.users u
         where u.id = v_row.user_id;

        v_res := public.anonymize_account(v_row.user_id);
        v_ficheros := v_ficheros + coalesce((v_res ->> 'ficheros_recolectados')::int, 0);

        update public.account_deletion_requests
           set status        = 'completed'::public.account_deletion_request_status,
               completed_at  = now(),
               last_check_at = now(),
               last_error    = null
         where user_id = v_row.user_id
           and status = 'pending'::public.account_deletion_request_status;

        -- ⚠️ Y DESPUÉS de anonimizar, nunca antes: `anonymize_account` borra las
        -- notificaciones de esta persona y se llevaría ésta por delante en la
        -- misma transacción.
        --
        -- Se salta si la dirección ya no era legible —una fila de `auth.users`
        -- borrada a mano, una baja rehecha— porque un correo sin destinatario
        -- es una fila que el job marcará `failed` y nada más. La baja ya está
        -- hecha: no avisar es una pena, fallar aquí sería revertirla.
        if v_correo is not null
           and v_correo not like 'cuenta-eliminada+%@ensenameya.invalid' then
          perform public.enqueue_notification(
            v_row.user_id, 'NTF-29', 'email', 'account_deletion_done',
            jsonb_build_object('email', v_correo),
            'NTF-29:baja:' || v_row.user_id
          );
        end if;

        v_completadas := v_completadas + 1;
      end if;
    exception when others then
      -- La cuenta se queda tal cual estaba (la subtransacción se deshizo) y el
      -- motivo queda ESCRITO en su fila: `cron.job_run_details` no guarda
      -- suficientes corridas de un job diario como para encontrarlo allí.
      v_errores := v_errores + 1;
      update public.account_deletion_requests
         set last_check_at = now(),
             last_error    = left(coalesce(sqlerrm, 'error sin mensaje'), 500)
       where user_id = v_row.user_id;
    end;
  end loop;

  return jsonb_build_object(
    'completadas', v_completadas,
    'esperando',   v_esperando,
    'estancadas',  v_estancadas,   -- > 30 días: hay dinero parado, mirar payouts
    'errores',     v_errores,
    'ficheros',    v_ficheros
  );
end;
$$;

comment on function public.process_pending_account_deletions(int) is
  'Completa las bajas programadas cuyo dinero en vuelo ya se resolvió (20260831160000) y, desde el Doc 33, manda la despedida NTF-29. La dirección se lee ANTES de anonimizar —después auth.users.email ya es cuenta-eliminada+<uuid>@ensenameya.invalid— y viaja en el payload, que es la vía que pending_email_notifications prefiere sobre el join a auth justamente para este caso. El enqueue va DESPUÉS de anonymize_account porque esa función borra las notificaciones del destinatario y se llevaría ésta por delante. La baja inmediata NO pasa por aquí: la manda directa /api/cuenta/eliminar, que todavía tiene la sesión y la dirección en la mano.';
