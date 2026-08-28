-- ============================================================================
-- Enséñame Ya — EY-189 (2ª tanda) · el abanico de acciones sobre los USUARIOS
-- de un reporte: desactivar y contactar.
--
-- QUÉ FALTABA. La bandeja de moderación sabía cerrar el reporte y bloquear el
-- hilo (M-12 + `20260826200000`), o sea las dos cosas que se hacen sobre la
-- CONVERSACIÓN. Sobre las personas no había ninguna: el admin leía un caso de
-- acoso y lo único que podía hacer era impedir que se siguieran escribiendo.
--
-- ── POR QUÉ LAS DOS NUEVAS SON RPC `SECURITY DEFINER` ───────────────────────
-- Por la MISMA razón que `set_conversation_blocked`, escrita en
-- `20260817210000:165-170`, y conviene repetirla porque es contraintuitiva:
-- un `update … where id = $1` tiene que LEER la fila para encontrarla, así que
-- Postgres aplica también las políticas de SELECT. El admin no tiene política
-- de lectura sobre `user_roles` ni sobre `auth.users`, de modo que el update
-- **no fallaría — no haría nada**, que es lo peor que puede pasar en una acción
-- disciplinaria: el admin ve el toast verde y el tutor sigue dando clases.
--
-- ── POR QUÉ UNA TABLA APARTE Y NO `profiles.suspended_at` ───────────────────
-- Literalmente la trampa que ya documentó EY-192 (`20260826230000`, bloque
-- «POR QUÉ NO HAY COLUMNA `profiles.deleted_at`»): `20260703120000:16` hace
-- `grant select, update on public.profiles to authenticated` sobre LA TABLA
-- ENTERA, así que una columna nueva ahí nace escribible por el propio usuario
-- vía PostgREST y `profiles_update_own` la deja pasar — cualquiera podría
-- levantarse su propia suspensión. Y un `revoke update (col)` NO lo arregla:
-- con el privilegio a nivel de tabla presente, el revoke por columna es un
-- no-op. Tabla aparte, default-deny, y encima queda mejor rastro.
--
-- ── QUÉ ES «DESACTIVAR» EXACTAMENTE ─────────────────────────────────────────
-- **Reversible**, y esa es toda la diferencia con la baja de EY-192, que es
-- irreversible y borra la identidad. Aquí no se borra nada:
--   · `auth.users.banned_until` — es lo que mira GoTrue al emitir sesión — y se
--     matan las sesiones vivas, porque si no el JWT que ya tiene en el
--     navegador le sirve otra hora larga (mismo detalle que EY-192:3.7).
--   · si es tutor: `approval_status = 'suspended'` (valor del enum que existía
--     desde M1 y que NO escribía nadie: `review_tutor` solo pone approved o
--     rejected) y se le retira el rol `tutor`, que es lo que saca sus mentorías
--     del catálogo (RN-23/RN-24). Al reactivar se restaura lo que tenía, que
--     por eso se guarda en la fila de la suspensión.
--
-- ⚠️ NO se cancelan sus reservas ni se mueve un céntimo. Suspender es cerrar la
-- puerta, no liquidar: el dinero sigue viajando por `cancel_booking` y RN-37
-- como siempre (regla de oro 2). Si además hay que devolver, se devuelve por su
-- camino auditado y en otro clic.
-- ============================================================================

-- ── 1 · El rastro (y a la vez el estado) ────────────────────────────────────
-- Una fila por cuenta suspendida ALGUNA VEZ; `lifted_at is null` = suspendida
-- ahora mismo. No es un log de eventos: la última suspensión pisa a la
-- anterior. Si algún día hace falta el historial completo, esto pasa a tener
-- `id` propio y la consulta de estado se convierte en un `order by ... limit 1`
-- — pero hoy la pregunta que hace el panel es «¿está activa?», y para eso una
-- fila por persona es la respuesta más barata y la que no se puede desincronizar.
create table if not exists public.account_suspensions (
  user_id      uuid        primary key references public.profiles (id) on delete cascade,
  suspended_at timestamptz not null default now(),
  suspended_by uuid        references public.profiles (id) on delete set null,
  reason       text,
  -- De qué reporte salió, cuando salió de uno. `set null` y no `cascade`: la
  -- purga de hilos sin compra se lleva el reporte a los 30 días
  -- (`20260826200000`) y una suspensión no puede evaporarse con él.
  report_id    uuid        references public.conversation_reports (id) on delete set null,
  -- Lo que hay que devolverle al reactivar. Se guarda AL SUSPENDER porque
  -- después ya no se puede saber: el estado se ha pisado con 'suspended' y el
  -- rol se ha borrado.
  prev_approval public.tutor_approval_status,
  had_tutor_role boolean   not null default false,
  lifted_at    timestamptz,
  lifted_by    uuid        references public.profiles (id) on delete set null
);

comment on table public.account_suspensions is
  'EY-189: cuentas desactivadas por moderación. `lifted_at is null` = suspendida ahora mismo. Reversible y sin borrar nada (la baja irreversible es `anonymize_account`, EY-192). Guarda el estado previo del tutor porque suspender lo pisa y sin esto no habría cómo devolvérselo.';

comment on column public.account_suspensions.prev_approval is
  'El `approval_status` que tenía el tutor justo antes de suspenderlo. Nulo si la cuenta no es de tutor.';

-- Estado vivo: es la consulta que hace el panel en cada pantalla de reportes.
create index if not exists account_suspensions_activas_idx
  on public.account_suspensions (user_id)
  where lifted_at is null;

-- Regla de oro 1: default-deny. Nace con RLS y sin una sola política para
-- `anon`; solo el admin lee. El propio suspendido NO la ve — y no por
-- ocultismo, sino porque no puede: está baneado y no hay sesión que consulte.
alter table public.account_suspensions enable row level security;

drop policy if exists "account_suspensions_select_admin" on public.account_suspensions;
create policy "account_suspensions_select_admin"
  on public.account_suspensions for select
  using ( public.has_role('admin') );

-- Sin políticas de escritura para NADIE: se entra por la RPC de abajo, que es
-- DEFINER y por tanto no las necesita.
--
-- Regla de oro 9: `service_role` se salta la RLS pero NO los grants de tabla, y
-- este proyecto tiene "auto-expose new tables" OFF. Mordió tres veces el 6-ago;
-- el renglón sale más barato que la mordida.
grant select on public.account_suspensions to authenticated;
grant select, insert, update, delete on public.account_suspensions to service_role;

-- ── 2 · Desactivar / reactivar ──────────────────────────────────────────────
create or replace function public.set_account_suspended(
  p_user_id   uuid,
  p_suspended boolean,
  p_reason    text default null,
  p_report_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Sin el `(select …)` que llevan las políticas: ese envoltorio es una ayuda
  -- al planner dentro de una RLS, y aquí no hay política que planificar.
  v_admin        uuid := auth.uid();
  v_prev         public.tutor_approval_status;
  v_tutor        boolean;
  -- ⚠️ `true` = suspendida ahora mismo · `false` = tuvo suspensión y se levantó
  -- · `null` = nunca la tuvo. Los tres casos se responden distinto más abajo,
  -- así que un booleano nulable dice lo justo y una fecha no valdría.
  v_ya           boolean;
  v_restaurado   public.tutor_approval_status;
begin
  -- `has_role` mira `auth.uid()` por dentro; sin sesión devuelve false, así que
  -- esta línea cubre también la llamada sin autenticar.
  if not public.has_role('admin') then
    raise exception 'solo un administrador puede desactivar cuentas'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'falta el usuario' using errcode = '22004';
  end if;

  -- Dos guardas de escalada. La primera es de sentido común (dejarse fuera de
  -- su propio panel no tiene deshacer: nadie podría reactivarte salvo otro
  -- admin). La segunda es de verdad importante: sin ella, un admin puede
  -- desactivar a los demás administradores desde una pantalla de moderación
  -- que existe para tratar con alumnos y tutores.
  if p_user_id = v_admin then
    raise exception 'no puedes desactivar tu propia cuenta' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.user_roles ur
     where ur.user_id = p_user_id and ur.role = 'admin'
  ) then
    raise exception 'una cuenta de administrador no se desactiva desde aquí'
      using errcode = 'P0001';
  end if;

  -- ⚠️ Una cuenta ya anonimizada (EY-192) NO se toca. Su `banned_until` es el
  -- baneo de cien años de la baja, así que «reactivar» aquí le abriría la
  -- puerta a una cuenta cuya identidad ya se borró.
  if exists (select 1 from public.account_deletions ad where ad.user_id = p_user_id) then
    raise exception 'esa cuenta está dada de baja: la baja no se revierte'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'la cuenta no existe' using errcode = 'P0002';
  end if;

  select s.lifted_at is null into v_ya
    from public.account_suspensions s where s.user_id = p_user_id;

  if p_suspended then
    -- Idempotencia: volver a suspender a quien ya está suspendido no debe
    -- pisar `prev_approval` con el 'suspended' que acabamos de escribir — eso
    -- le dejaría suspendido para siempre aunque se reactivara.
    if coalesce(v_ya, false) then
      return jsonb_build_object('status', 'ya_suspendida');
    end if;

    select tp.approval_status into v_prev
      from public.tutor_profiles tp where tp.profile_id = p_user_id;

    v_tutor := exists (
      select 1 from public.user_roles ur
       where ur.user_id = p_user_id and ur.role = 'tutor'
    );

    insert into public.account_suspensions (
      user_id, suspended_at, suspended_by, reason, report_id,
      prev_approval, had_tutor_role, lifted_at, lifted_by
    )
    values (
      p_user_id, now(), v_admin,
      nullif(btrim(coalesce(p_reason, '')), ''), p_report_id,
      v_prev, coalesce(v_tutor, false), null, null
    )
    on conflict (user_id) do update
      set suspended_at   = now(),
          suspended_by   = excluded.suspended_by,
          reason         = excluded.reason,
          report_id      = excluded.report_id,
          prev_approval  = excluded.prev_approval,
          had_tutor_role = excluded.had_tutor_role,
          -- Se limpian a propósito: la fila vuelve a significar «suspendida».
          lifted_at      = null,
          lifted_by      = null;

    -- Si es tutor, además desaparece del catálogo. `approval_status` está fuera
    -- de los column-grants del cliente (US-1403), de ahí que esto tenga que
    -- vivir en una DEFINER y no en el navegador.
    if v_prev is not null then
      update public.tutor_profiles
         set approval_status = 'suspended'
       where profile_id = p_user_id;
    end if;

    -- RN-23/RN-24: sin rol `tutor` sus mentorías no son publicables ni salen en
    -- el catálogo. Es el mismo gesto que hace `review_tutor` al rechazar.
    delete from public.user_roles
     where user_id = p_user_id and role = 'tutor';

    -- ── Cerrar la puerta ────────────────────────────────────────────────────
    -- Un siglo en vez de 'infinity' por lo mismo que EY-192: el `infinity` de
    -- Postgres no siempre sobrevive al parseo de tiempos de GoTrue.
    update auth.users
       set banned_until = now() + interval '100 years'
     where id = p_user_id;

    -- Y se le echa AHORA. Sin esto sigue navegando con el JWT que ya tiene
    -- hasta que caduque (~1 h): baneado y dentro.
    -- ⚠️ `auth.refresh_tokens.user_id` es `varchar`, no `uuid` — de ahí el cast.
    delete from auth.sessions       where user_id = p_user_id;
    delete from auth.refresh_tokens where user_id = p_user_id::text;

    return jsonb_build_object('status', 'suspendida', 'era_tutor', v_prev is not null);
  end if;

  -- ── Reactivar ─────────────────────────────────────────────────────────────
  if v_ya is null then
    return jsonb_build_object('status', 'nunca_suspendida');
  end if;
  if not v_ya then
    return jsonb_build_object('status', 'ya_activa');
  end if;

  select s.prev_approval, s.had_tutor_role into v_restaurado, v_tutor
    from public.account_suspensions s where s.user_id = p_user_id;

  update public.account_suspensions
     set lifted_at = now(),
         lifted_by = v_admin
   where user_id = p_user_id;

  if v_restaurado is not null then
    update public.tutor_profiles
       set approval_status = v_restaurado
     where profile_id = p_user_id;
  end if;

  -- El rol vuelve solo si LO TENÍA, que es lo que se guardó al suspender. No se
  -- deduce de `prev_approval`: reactivar tiene que devolver lo que había, no
  -- conceder lo que la aprobación concede (US-1101). Un tutor suspendido
  -- mientras estaba `pending` sale de la suspensión igual de `pending`, y sin
  -- rol.
  if coalesce(v_tutor, false) then
    insert into public.user_roles (user_id, role)
    values (p_user_id, 'tutor')
    on conflict do nothing;
  end if;

  update auth.users set banned_until = null where id = p_user_id;

  return jsonb_build_object(
    'status', 'reactivada',
    'approval_status', v_restaurado
  );
end;
$$;

comment on function public.set_account_suspended(uuid, boolean, text, uuid) is
  'EY-189: desactiva (o reactiva) la cuenta de un alumno o un tutor desde la bandeja de moderación. Banea en `auth.users`, mata las sesiones vivas y, si es tutor, lo saca del catálogo (`approval_status = suspended` + retirada del rol). Reversible: el estado previo se guarda en `account_suspensions`. NO cancela reservas ni mueve dinero. SECURITY DEFINER porque el admin no tiene lectura sobre `user_roles` ni `auth.users` y un update por RLS no fallaría: no haría nada.';

revoke execute on function public.set_account_suspended(uuid, boolean, text, uuid) from public;
revoke execute on function public.set_account_suspended(uuid, boolean, text, uuid) from anon;
grant  execute on function public.set_account_suspended(uuid, boolean, text, uuid) to authenticated;

-- ── 3 · Contactar ───────────────────────────────────────────────────────────
-- NO abre un canal nuevo. Encola una fila en `notifications` igual que
-- cualquier trigger de EP-12, así que:
--   · el correo sale por `/api/cron/notifications-send` (Resend) con los mismos
--     reintentos y el mismo `mark_notification` que el resto;
--   · sin `RESEND_API_KEY` la fila se queda `pending` y no se pierde — la
--     credencial es el interruptor, igual que en todo lo demás;
--   · el aviso aparece **también** en la campana del destinatario, porque
--     `NotificationsBell` pinta todas las filas sin mirar el canal (lo mismo
--     que ya pasa con NTF-21);
--   · y queda rastro en `/admin/notificaciones` sin inventar tabla.
--
-- ⚠️ El texto lo escribe el admin y viaja en el `payload`. Es el PRIMER correo
-- de la plataforma con cuerpo libre: hasta hoy las doce plantillas eran
-- literales del repo. `renderEmail` interpola `cuerpo` dentro del HTML, así que
-- ese fichero escapa el cuerpo — ver el comentario en `lib/email-templates.ts`.
create or replace function public.admin_contact_user(
  p_user_id   uuid,
  p_message   text,
  p_report_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := btrim(coalesce(p_message, ''));
  v_key   text;
  v_id    uuid;
begin
  if not public.has_role('admin') then
    raise exception 'solo un administrador escribe desde el panel'
      using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'falta el destinatario' using errcode = '22004';
  end if;

  if v_texto = '' then
    raise exception 'el mensaje no puede estar vacío' using errcode = 'P0001';
  end if;

  -- Tope de 2000 para que un pegado accidental no acabe en un correo de un
  -- megabyte. Se corta en vez de rechazar: perder el final de un mensaje es
  -- menos malo que perderlo entero por un límite que nadie anunció.
  v_texto := left(v_texto, 2000);

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'la cuenta no existe' using errcode = 'P0002';
  end if;

  -- La clave de idempotencia de EP-12 es única por EVENTO, y aquí cada envío es
  -- un evento distinto a propósito: el admin puede escribir dos veces al mismo
  -- usuario por el mismo reporte y las dos tienen que salir.
  v_key := 'NTF-22:admin:' || gen_random_uuid()::text;

  perform public.enqueue_notification(
    p_user_id,
    'NTF-22',
    'email',
    'admin_message',
    jsonb_build_object('mensaje', v_texto, 'report_id', p_report_id),
    v_key
  );

  -- Se encola por el único escritor que tiene la tabla y luego se recupera el
  -- id, en vez de duplicar aquí el `insert`: una sola definición de «encolar».
  select n.id into v_id
    from public.notifications n where n.idempotency_key = v_key;

  return v_id;
end;
$$;

comment on function public.admin_contact_user(uuid, text, uuid) is
  'EY-189: el admin escribe a un alumno o a un tutor desde la bandeja de moderación. No es un canal nuevo — encola un NTF-22 en `notifications` (plantilla `admin_message`), así que sale por el remitente de siempre, aparece en la campana del destinatario y deja rastro en /admin/notificaciones.';

revoke execute on function public.admin_contact_user(uuid, text, uuid) from public;
revoke execute on function public.admin_contact_user(uuid, text, uuid) from anon;
grant  execute on function public.admin_contact_user(uuid, text, uuid) to authenticated;

-- ── 4 · ⚠️ ¿Puede el dueño de la función tocar `auth`? ──────────────────────
-- Mismo aviso que dejó EY-192 (`20260826230000:498-543`) y por el mismo motivo:
-- escribir en `auth.users` es un privilegio que este repo solo necesita en dos
-- sitios, y si falta NO se ve ni en el build ni en el typecheck — revienta en
-- ejecución con `permission denied for table users`.
--
-- 🟢 Igual que allí, el fallo es TOTAL y no a medias: la función corre dentro de
-- la transacción de quien la llama, así que si el baneo revienta se deshace
-- también la fila de `account_suspensions` y el cambio de rol. Nunca queda un
-- tutor «suspendido» que sigue pudiendo entrar.
--
-- WARNING y no EXCEPTION: la tabla, las políticas y `admin_contact_user` valen
-- igualmente, y abortar el despliegue entero por esto sería peor.
do $$
declare
  v_falta text[] := '{}';
begin
  if not has_table_privilege('auth.users', 'UPDATE')    then v_falta := v_falta || 'UPDATE auth.users';    end if;
  if not has_table_privilege('auth.sessions', 'DELETE') then v_falta := v_falta || 'DELETE auth.sessions'; end if;

  if array_length(v_falta, 1) > 0 then
    raise warning
      'EY-189: al dueño de `set_account_suspended` le faltan privilegios sobre `auth`: %. Desactivar una cuenta fallará ENTERA (no a medias) hasta que se concedan.',
      array_to_string(v_falta, ', ');
  end if;
end;
$$;
