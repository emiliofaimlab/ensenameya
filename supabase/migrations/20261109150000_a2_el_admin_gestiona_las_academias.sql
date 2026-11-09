-- ============================================================================
-- Enséñame Ya — A2: el admin de EY da de alta y gestiona las academias
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/REQUERIMIENTOS.md` §4 (Fase 2). El esquema existe desde
-- `20261009170100`, pero `academies` no tiene políticas de escritura (a
-- propósito) y sus columnas del acuerdo solo tienen grant por columna para la
-- cara pública: ni el admin de EY las lee por la Data API. Todo pasa por estas
-- RPC `security definer`, y cada una empieza con `has_role('admin')`.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Administrador por correo (RA-02): si el correo tiene cuenta CONFIRMADA, se
--   vincula al momento y la academia en borrador pasa a `active`. Si no, queda
--   una fila `academy_members` (role 'admin', 'invited') y `owner_id` en NULL.
--   La invitación la aterriza `aceptar_invitacion_de_academia()`, que llama la
--   guarda de `/academia` (`src/lib/auth/academia.ts`). ponytail: no se engancha
--   a `notify_email_confirmed()`: con Google o sin confirmación (dev) ese
--   trigger no salta, y el correo NTF-40 ya lleva a `/academia`.
-- · Eliminar (RA-20) solo sin reservas, sin ofertas y sin tutores: con tutores,
--   el `on delete set null` de `tutor_profiles.academy_id` los convertiría en
--   independientes sin que nadie lo decida (RA-03/17).
-- · El motivo del rechazo se guarda para que el portal (A3) lo enseñe y para
--   NTF-44, que llega con los correos de academias.
-- ============================================================================

alter table public.academies
  add column if not exists pending_changes_rejection text;

comment on column public.academies.pending_changes_rejection is
  'RA-06 · motivo con el que EY rechazó los últimos cambios del perfil. NULL = no hay rechazo vigente. Solo lo leen el admin de EY y el dueño, por RPC.';


-- ── 1 · Lectura para el panel ───────────────────────────────────────────────
create or replace function public.admin_academias()
returns table (
  id uuid, slug text, name text, tagline text, description text, website text,
  brand_color text, policies_url text, status public.academy_status,
  allow_public_offers boolean, owner_id uuid, owner_name text, owner_email text,
  invited_email text, commission_pct numeric, fixed_fee_amount bigint,
  fixed_fee_currency text, fixed_fee_period text, included_free_classes text,
  agreement_starts_on date, agreement_notes text, payout_country text,
  pending_changes jsonb, pending_changes_rejection text, created_at timestamptz,
  tutores bigint, alumnos bigint, ofertas bigint, reservas bigint,
  reservas_mes bigint, ingresos_mes bigint, ultima_reserva timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo de Enséñame Ya' using errcode = '42501';
  end if;

  return query
  select a.id, a.slug, a.name, a.tagline, a.description, a.website,
         a.brand_color, a.policies_url, a.status,
         a.allow_public_offers, a.owner_id, p.full_name, u.email::text,
         (select m.email from public.academy_members m
           where m.academy_id = a.id and m.role = 'admin' and m.status = 'invited'
           order by m.invited_at desc limit 1),
         a.commission_pct, a.fixed_fee_amount,
         a.fixed_fee_currency::text, a.fixed_fee_period, a.included_free_classes,
         a.agreement_starts_on, a.agreement_notes, a.payout_country::text,
         a.pending_changes, a.pending_changes_rejection, a.created_at,
         (select count(*) from public.tutor_profiles tp where tp.academy_id = a.id),
         (select count(*) from public.academy_members m
           where m.academy_id = a.id and m.role = 'student' and m.status = 'active'),
         (select count(*) from public.products pr where pr.academy_id = a.id),
         (select count(*) from public.bookings b where b.academy_id = a.id),
         (select count(*) from public.bookings b
           where b.academy_id = a.id and b.created_at >= date_trunc('month', now())),
         -- ponytail: suma sin convertir moneda (todo es USD, decisión del 11-sep).
         (select coalesce(sum(pa.gross_amount), 0)::bigint
            from public.payments pa join public.bookings b on b.id = pa.booking_id
           where b.academy_id = a.id and pa.status = 'paid'
             and pa.paid_at >= date_trunc('month', now())),
         (select max(b.created_at) from public.bookings b where b.academy_id = a.id)
    from public.academies a
    left join public.profiles p on p.id = a.owner_id
    left join auth.users u on u.id = a.owner_id
   order by a.created_at desc;
end;
$$;

comment on function public.admin_academias() is
  'A2 · todas las academias con su acuerdo y sus contadores (tutores, alumnos activos, reservas e ingresos del mes en UTC). Solo has_role(admin).';


-- ── 2 · Crear / editar ──────────────────────────────────────────────────────
-- jsonb y no un argumento por campo: con argumentos opcionales supabase-js omite
-- los `undefined` y PostgREST no encuentra la firma (regla de oro 12). El
-- formulario manda SIEMPRE todos los campos: vacío = NULL.
create or replace function public.admin_guardar_academia(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo de Enséñame Ya' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.academies (slug, name)
    values (lower(btrim(p_datos->>'slug')), btrim(p_datos->>'name'))
    returning id into v_id;
  elsif not exists (select 1 from public.academies a where a.id = v_id) then
    raise exception 'esa academia no existe' using errcode = 'no_data_found';
  end if;

  update public.academies a set
    slug                  = coalesce(nullif(lower(btrim(p_datos->>'slug')), ''), a.slug),
    name                  = coalesce(nullif(btrim(p_datos->>'name'), ''), a.name),
    tagline               = nullif(btrim(p_datos->>'tagline'), ''),
    description           = nullif(btrim(p_datos->>'description'), ''),
    website               = nullif(btrim(p_datos->>'website'), ''),
    brand_color           = nullif(btrim(p_datos->>'brand_color'), ''),
    policies_url          = nullif(btrim(p_datos->>'policies_url'), ''),
    payout_country        = nullif(upper(btrim(p_datos->>'payout_country')), ''),
    commission_pct        = nullif(btrim(p_datos->>'commission_pct'), '')::numeric,
    fixed_fee_amount      = nullif(btrim(p_datos->>'fixed_fee_amount'), '')::bigint,
    fixed_fee_currency    = nullif(upper(btrim(p_datos->>'fixed_fee_currency')), ''),
    fixed_fee_period      = nullif(btrim(p_datos->>'fixed_fee_period'), ''),
    included_free_classes = nullif(btrim(p_datos->>'included_free_classes'), ''),
    agreement_starts_on   = nullif(btrim(p_datos->>'agreement_starts_on'), '')::date,
    agreement_notes       = nullif(btrim(p_datos->>'agreement_notes'), ''),
    allow_public_offers   = coalesce((p_datos->>'allow_public_offers')::boolean, a.allow_public_offers)
  where a.id = v_id;

  return v_id;
end;
$$;

comment on function public.admin_guardar_academia(uuid, jsonb) is
  'A2 · crea (p_id NULL) o edita una academia: perfil, payout_country, allow_public_offers y el acuerdo de RA-21. Vacío = NULL. Nace en draft. Solo has_role(admin).';


-- ── 3 · Administrador por correo (RA-02) ────────────────────────────────────
create or replace function public.admin_asignar_administrador(p_academy uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correo text := lower(btrim(p_email));
  v_uid    uuid;
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo de Enséñame Ya' using errcode = '42501';
  end if;
  if v_correo is null or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'ese correo no es válido' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.academies a where a.id = p_academy) then
    raise exception 'esa academia no existe' using errcode = 'no_data_found';
  end if;

  -- Solo una cuenta con el correo PROBADO: vincular a una dirección sin
  -- confirmar es darle la academia a quien la escriba primero.
  select u.id into v_uid
    from auth.users u
   where lower(u.email) = v_correo
     and u.email_confirmed_at is not null
     and exists (select 1 from public.profiles p where p.id = u.id)
   limit 1;

  -- Un solo administrador: el anterior queda fuera, con rastro.
  update public.academy_members m set status = 'removed'
   where m.academy_id = p_academy and m.role = 'admin'
     and m.status <> 'removed' and m.email <> v_correo;

  insert into public.academy_members (academy_id, email, profile_id, role, status, accepted_at)
  values (p_academy, v_correo, v_uid, 'admin',
          case when v_uid is null then 'invited' else 'active' end,
          case when v_uid is null then null else now() end)
  on conflict (academy_id, email, role) do update
    set profile_id  = excluded.profile_id,
        status      = excluded.status,
        accepted_at = excluded.accepted_at,
        invited_at  = now();

  update public.academies a
     set owner_id = v_uid,
         status   = case when v_uid is not null and a.status = 'draft'
                         then 'active'::public.academy_status else a.status end
   where a.id = p_academy;

  return case when v_uid is null then 'invitado' else 'vinculado' end;
end;
$$;

comment on function public.admin_asignar_administrador(uuid, text) is
  'A2 · RA-02 · nombra o cambia al administrador por correo. Cuenta confirmada → owner_id al momento y draft pasa a active ("vinculado"). Si no → invitación en academy_members y owner_id NULL ("invitado"). El correo NTF-40 lo manda /api/admin/academias/administrador.';


-- ── 4 · La invitación aterriza ──────────────────────────────────────────────
create or replace function public.aceptar_invitacion_de_academia()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_correo text;
  v_n      integer;
begin
  select lower(u.email) into v_correo
    from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_correo is null then
    return 0;
  end if;

  with aceptadas as (
    update public.academy_members m
       set profile_id = v_uid, status = 'active', accepted_at = now()
     where m.email = v_correo and m.role = 'admin' and m.status = 'invited'
    returning m.academy_id
  )
  update public.academies a
     set owner_id = v_uid,
         status   = case when a.status = 'draft'
                         then 'active'::public.academy_status else a.status end
    from aceptadas
   where a.id = aceptadas.academy_id and a.owner_id is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.aceptar_invitacion_de_academia() is
  'A2 · ata al usuario actual (correo confirmado) las academias a las que fue invitado como administrador: owner_id y draft → active. La llama la guarda de /academia. Idempotente.';


-- ── 5 · Suspender / reactivar (RA-20) ───────────────────────────────────────
create or replace function public.admin_cambiar_estado_academia(p_academy uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo de Enséñame Ya' using errcode = '42501';
  end if;
  if p_estado not in ('active', 'suspended') then
    raise exception 'estado no válido' using errcode = 'check_violation';
  end if;
  if p_estado = 'active' and exists (
       select 1 from public.academies a where a.id = p_academy and a.owner_id is null) then
    raise exception 'la academia no tiene administrador todavía' using errcode = 'check_violation';
  end if;

  update public.academies a set status = p_estado::public.academy_status where a.id = p_academy;
  if not found then
    raise exception 'esa academia no existe' using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.admin_cambiar_estado_academia(uuid, text) is
  'A2 · RA-20 · suspende o reactiva. Reactivar exige administrador. Las reservas existentes no se tocan.';


-- ── 6 · Eliminar (RA-20) ────────────────────────────────────────────────────
create or replace function public.admin_eliminar_academia(p_academy uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo de Enséñame Ya' using errcode = '42501';
  end if;
  if exists (select 1 from public.bookings b where b.academy_id = p_academy) then
    raise exception 'tiene reservas: suspéndela en vez de eliminarla' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.products pr where pr.academy_id = p_academy)
     or exists (select 1 from public.tutor_profiles tp where tp.academy_id = p_academy) then
    raise exception 'tiene ofertas o tutores: suspéndela en vez de eliminarla' using errcode = 'check_violation';
  end if;

  delete from public.academies a where a.id = p_academy;
end;
$$;

comment on function public.admin_eliminar_academia(uuid) is
  'A2 · RA-20 · borra una academia sin reservas, ofertas ni tutores (las altas por error). Con cualquiera de las tres, se suspende.';


-- ── 7 · Aprobar o rechazar los cambios del perfil (RA-06) ───────────────────
create or replace function public.admin_resolver_cambios_academia(
  p_academy uuid, p_aprobar boolean, p_motivo text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'solo el equipo de Enséñame Ya' using errcode = '42501';
  end if;

  select a.pending_changes into v_c from public.academies a where a.id = p_academy for update;
  if v_c is null then
    raise exception 'no hay cambios pendientes' using errcode = 'no_data_found';
  end if;

  if p_aprobar then
    -- Solo los campos de RA-06. Una clave ausente deja el valor como estaba.
    update public.academies a set
      name         = case when v_c ? 'name' then coalesce(nullif(btrim(v_c->>'name'), ''), a.name) else a.name end,
      tagline      = case when v_c ? 'tagline'      then nullif(btrim(v_c->>'tagline'), '')      else a.tagline end,
      description  = case when v_c ? 'description'  then nullif(btrim(v_c->>'description'), '')  else a.description end,
      logo_path    = case when v_c ? 'logo_path'    then nullif(btrim(v_c->>'logo_path'), '')    else a.logo_path end,
      cover_path   = case when v_c ? 'cover_path'   then nullif(btrim(v_c->>'cover_path'), '')   else a.cover_path end,
      brand_color  = case when v_c ? 'brand_color'  then nullif(btrim(v_c->>'brand_color'), '')  else a.brand_color end,
      website      = case when v_c ? 'website'      then nullif(btrim(v_c->>'website'), '')      else a.website end,
      policies_url = case when v_c ? 'policies_url' then nullif(btrim(v_c->>'policies_url'), '') else a.policies_url end,
      pending_changes = null,
      pending_changes_rejection = null
    where a.id = p_academy;
  else
    if nullif(btrim(p_motivo), '') is null then
      raise exception 'el rechazo necesita un motivo' using errcode = 'check_violation';
    end if;
    update public.academies a
       set pending_changes = null, pending_changes_rejection = btrim(p_motivo)
     where a.id = p_academy;
  end if;
end;
$$;

comment on function public.admin_resolver_cambios_academia(uuid, boolean, text) is
  'A2 · RA-06 · aprueba (aplica los campos del perfil y vacía pending_changes) o rechaza con motivo obligatorio.';


-- ── Grants ──────────────────────────────────────────────────────────────────
revoke execute on function public.admin_academias() from public, anon;
revoke execute on function public.admin_guardar_academia(uuid, jsonb) from public, anon;
revoke execute on function public.admin_asignar_administrador(uuid, text) from public, anon;
revoke execute on function public.aceptar_invitacion_de_academia() from public, anon;
revoke execute on function public.admin_cambiar_estado_academia(uuid, text) from public, anon;
revoke execute on function public.admin_eliminar_academia(uuid) from public, anon;
revoke execute on function public.admin_resolver_cambios_academia(uuid, boolean, text) from public, anon;

grant execute on function public.admin_academias() to authenticated;
grant execute on function public.admin_guardar_academia(uuid, jsonb) to authenticated;
grant execute on function public.admin_asignar_administrador(uuid, text) to authenticated;
grant execute on function public.aceptar_invitacion_de_academia() to authenticated;
grant execute on function public.admin_cambiar_estado_academia(uuid, text) to authenticated;
grant execute on function public.admin_eliminar_academia(uuid) to authenticated;
grant execute on function public.admin_resolver_cambios_academia(uuid, boolean, text) to authenticated;
