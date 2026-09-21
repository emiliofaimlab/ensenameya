-- ============================================================================
-- Enséñame Ya — dar y quitar el rol de admin desde el panel.
--
-- ── POR QUÉ NO EXISTÍA ──────────────────────────────────────────────────────
--
-- A propósito. `user_roles` no tiene NI UNA política de escritura —ni para
-- `authenticated` ni para nadie— desde `20260606121500`, y `20260714120000`
-- dejó escrito el porqué: es la tabla que decide quién manda. RN-31/S-31: «el
-- alta de admin va fuera del cliente».
--
-- Eso sigue siendo verdad y esta migración NO lo cambia: no se abre ninguna
-- política, `authenticated` sigue sin poder escribir una fila, y el navegador
-- nunca toca la tabla. Lo que se añade son dos funciones con nombre y reglas
-- propias, que es la diferencia entre «hay una puerta» y «no hay pared».
--
-- ── POR QUÉ DOS FUNCIONES Y NO UN `grant insert` A `service_role` ───────────
--
-- Porque un `grant insert, delete on user_roles to service_role` no concede
-- «dar admin»: concede **acuñar cualquier rol a cualquiera**, para siempre y
-- para cualquier Route Handler que se escriba en los próximos meses. Un bug de
-- validación en un handler cualquiera pasaría a ser una escalada de
-- privilegios. Con estas dos, lo único que `service_role` puede hacer con esa
-- tabla es exactamente lo que dicen sus nombres, con las reglas dentro.
--
-- ⚠️ LLEVAN EL ACTOR EN LA FIRMA, como `confirm_credit_booking`. Corren con
-- `service_role`, o sea **sin `auth.uid()`**: por dentro no hay forma de saber
-- quién llama. El Route Handler resuelve el rol con la sesión y pasa el uid;
-- aquí se REVERIFICA, no se confía.
--
-- ── LAS DOS REGLAS QUE VIVEN AQUÍ Y NO EN LA PANTALLA ───────────────────────
--
-- 1. **Nadie se quita el admin a sí mismo.** No es paternalismo: es lo que
--    impide quedarse fuera del panel con un clic, y es lo que garantiza que
--    SIEMPRE quede al menos un admin — el que ejecuta la acción. Sin esta
--    regla, dos personas pueden quitarse la una a la otra y dejar la
--    plataforma sin nadie que apruebe un tutor, y recuperarlo pide entrar a la
--    base, que es justo de lo que esta pantalla nos saca.
--
-- 2. **Solo cuentas que ya existen.** `conceder_admin` busca por correo y falla
--    si no hay nadie: un correo mal tecleado no crea nada ni deja un rol
--    huérfano esperando a que alguien se registre con esa dirección. Es además
--    la red contra el error más probable de la pantalla, que es una errata.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · Dar admin
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.conceder_admin(p_email text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_email text := lower(btrim(p_email));
  v_user  uuid;
  v_nuevo boolean;
begin
  if p_actor is null then
    raise exception 'falta el actor' using errcode = '28000';
  end if;
  if not exists (select 1 from public.user_roles r
                  where r.user_id = p_actor and r.role = 'admin') then
    raise exception 'solo un admin puede dar admin' using errcode = '42501';
  end if;

  -- El correo se compara normalizado: `auth.users.email` lo guarda en
  -- minúsculas, pero lo que llega de un formulario puede venir con mayúsculas
  -- o con espacios pegados al copiar y pegar.
  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if v_user is null then
    raise exception 'no hay ninguna cuenta con el correo %', v_email
      using errcode = 'no_data_found';
  end if;

  insert into public.user_roles (user_id, role)
  values (v_user, 'admin')
  on conflict (user_id, role) do nothing;
  v_nuevo := found;

  -- `ya_era` no es un detalle: la pantalla dice cosas distintas según eso, y
  -- sin el dato tendría que adivinar o volver a preguntar.
  return jsonb_build_object('user_id', v_user, 'email', v_email, 'ya_era', not v_nuevo);
end;
$fn$;

comment on function public.conceder_admin(text, uuid) is
  'Añade el rol admin a una cuenta QUE YA EXISTE, buscada por correo. No crea usuarios y no toca los demás roles de esa persona. Reverifica que el actor sea admin porque corre con service_role y no tiene auth.uid(). RN-31/S-31: user_roles no tiene políticas de escritura y esta función no abre ninguna.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Quitar admin
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.revocar_admin(p_user uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_habia boolean;
begin
  if p_actor is null then
    raise exception 'falta el actor' using errcode = '28000';
  end if;
  if not exists (select 1 from public.user_roles r
                  where r.user_id = p_actor and r.role = 'admin') then
    raise exception 'solo un admin puede quitar admin' using errcode = '42501';
  end if;

  -- 🔴 La regla 1 de la cabecera. Vive AQUÍ y no solo en la pantalla porque es
  -- la que sostiene el invariante «siempre queda un admin»: quien ejecuta esto
  -- es admin y no puede ser el afectado, así que después de cualquier revocada
  -- queda al menos él.
  if p_user = p_actor then
    raise exception 'no puedes quitarte a ti mismo el acceso de admin'
      using errcode = 'check_violation',
            hint = 'Pídeselo a otra persona con acceso de admin.';
  end if;

  delete from public.user_roles where user_id = p_user and role = 'admin';
  v_habia := found;

  return jsonb_build_object('user_id', p_user, 'tenia', v_habia);
end;
$fn$;

comment on function public.revocar_admin(uuid, uuid) is
  'Quita el rol admin de una cuenta y deja intactos sus demás roles. Se niega si el actor intenta quitárselo a sí mismo: eso es lo que impide quedarse fuera del panel y lo que garantiza que siempre quede al menos un admin.';


-- ── Privilegios ─────────────────────────────────────────────────────────────
-- En PostgreSQL el `execute` nace concedido a PUBLIC, así que los `revoke` no
-- son adorno: sin ellos cualquiera con sesión podría llamarlas. Solo
-- `service_role`, o sea solo desde un Route Handler del servidor.
revoke execute on function public.conceder_admin(text, uuid) from public;
revoke execute on function public.conceder_admin(text, uuid) from anon;
revoke execute on function public.conceder_admin(text, uuid) from authenticated;
grant  execute on function public.conceder_admin(text, uuid) to service_role;

revoke execute on function public.revocar_admin(uuid, uuid) from public;
revoke execute on function public.revocar_admin(uuid, uuid) from anon;
revoke execute on function public.revocar_admin(uuid, uuid) from authenticated;
grant  execute on function public.revocar_admin(uuid, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · La lista que pinta la pantalla
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hace falta una función porque el correo vive en `auth.users` y ahí no llega
-- ni el cliente de sesión (el esquema no está expuesto en la API) ni
-- `service_role` por PostgREST. Es el mismo motivo por el que los informes de
-- `/admin/alumnos` y `/admin/tutores` traen el contacto por RPC.
--
-- ⚠️ ESTA SÍ ES PARA `authenticated`, al revés que las dos de arriba, y por eso
-- comprueba el rol con `has_role('admin')` —que usa `auth.uid()`— en vez de
-- recibir el actor. La llama la pantalla con la sesión del admin; las otras dos
-- las llama el Route Handler con `service_role`, que no tiene `auth.uid()`.
-- Devolver la lista de administradores a quien no es admin sería regalar el
-- mapa de a quién hay que atacar.
create or replace function public.listar_admins()
returns table (user_id uuid, email text, nombre text, desde timestamptz)
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.user_id,
         u.email::text,
         p.full_name,
         r.created_at
    from public.user_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = r.user_id
   where r.role = 'admin'
     and public.has_role('admin')
   order by r.created_at;
$fn$;

comment on function public.listar_admins() is
  'Quién tiene acceso de admin, con su correo (que vive en auth.users y no se puede leer desde la API). Solo contesta si quien pregunta es admin: la lista de administradores es el mapa de a quién atacar.';

revoke execute on function public.listar_admins() from public;
revoke execute on function public.listar_admins() from anon;
grant  execute on function public.listar_admins() to authenticated;
