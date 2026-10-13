-- ============================================================================
-- Enséñame Ya — EY-222 · «Recursos y plantillas para redes sociales» del tutor.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- El cliente quiere darle al tutor material para promocionarse (posts, stories,
-- banners, guías, plantillas de Canva) y decidir A QUIÉN se lo da. Es un módulo
-- ADMINISTRADO: lo sube el admin en `/admin/recursos` y el tutor lo ve en
-- `/tutor/recursos` (`src/app/(app)/tutor/recursos/page.tsx`).
--
-- Cuatro audiencias por recurso, decididas con el cliente:
--   all       → todos los tutores (con perfil de tutor y no rechazados/suspendidos)
--   approved  → solo los aprobados
--   tiers     → los aprobados cuyo `tutor_profiles.tier_id` esté en `tier_ids`
--   tutors    → una lista de tutores concretos (`tutor_ids`)
--
-- 🔑 LA VISIBILIDAD LA APLICA LA BASE, NO LA PANTALLA. Un tutor al que no le
-- toca un recurso no puede leer su fila (`social_resources_select_tutor`) NI
-- firmar/descargar su fichero (`social_resources_files_select`, que mira la
-- fila CON la RLS del que pide: si la fila no se ve, el fichero tampoco).
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `tier_ids` / `tutor_ids` son ARRAYS y no tablas puente, a propósito:
--   (1) el admin guarda el recurso entero en UNA escritura —con tablas puente
--   serían tres no atómicas desde el navegador—, y (2) una tabla puente entre
--   `tutor_profiles` y algo nuevo es exactamente lo que vuelve ambiguos los
--   embeds (regla de oro 10, `PGRST201`). El precio es que un tier o un tutor
--   borrado deja un id colgando: no casa con nadie, que es lo correcto.
-- · Rechazados y suspendidos NO ven nada, ni en «todos» ni en una lista
--   concreta: un tutor suspendido no debería estar promocionándose.
-- · Sin política de `delete`: la baja es lógica (`deleted_at`). El fichero se
--   queda en Storage; deja de ser legible para el tutor porque su fila deja de
--   serlo.
-- · Bucket nuevo y PRIVADO `social-resources`: el tutor descarga por URL
--   firmada emitida en servidor, como los comprobantes (`20260916110000`).
--   Formatos y tope tienen su espejo en `src/components/tutor/upload-formats.ts`
--   (`SOCIAL_RESOURCE_*`): si se toca uno, se toca el otro (y con un `update`,
--   no con este `insert … on conflict do nothing`, ver la cabecera de ese fichero).
-- ============================================================================


-- ── 1 · La audiencia ────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'social_resource_audience') then
    create type public.social_resource_audience as enum ('all', 'approved', 'tiers', 'tutors');
  end if;
end $$;


-- ── 2 · La tabla ────────────────────────────────────────────────────────────
create table if not exists public.social_resources (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  description   text check (description is null or char_length(description) <= 500),
  category      text check (category is null or char_length(btrim(category)) between 1 and 40),
  kind          text not null check (kind in ('file', 'link')),
  file_path     text,
  file_name     text,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  external_url  text check (external_url is null or external_url ~* '^https://[^[:space:]]+$'),
  audience      public.social_resource_audience not null default 'approved',
  tier_ids      uuid[] not null default '{}',
  tutor_ids     uuid[] not null default '{}',
  is_published  boolean not null default false,
  sort_order    integer not null default 0,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Un recurso es un fichero O un enlace, nunca las dos cosas ni ninguna.
  constraint social_resources_kind_shape check (
    (kind = 'file' and file_path is not null and external_url is null)
    or (kind = 'link' and external_url is not null and file_path is null)
  ),
  -- Una audiencia por lista vacía no la vería nadie, y el admin no se enteraría.
  constraint social_resources_audience_shape check (
    (audience <> 'tiers'  or cardinality(tier_ids)  > 0)
    and (audience <> 'tutors' or cardinality(tutor_ids) > 0)
  )
);

comment on table public.social_resources is
  'EY-222 · Recursos y plantillas para redes que el ADMIN publica para los tutores. La visibilidad por recurso la impone la RLS (ver 20261013140000).';
comment on column public.social_resources.kind is
  '''file'' = fichero en el bucket privado social-resources (file_path); ''link'' = enlace externo https (p. ej. una plantilla de Canva).';
comment on column public.social_resources.file_path is
  'Ruta del objeto en el bucket social-resources (<id>/<uuid>-<nombre>). Nunca una URL: el tutor descarga por URL firmada emitida en servidor.';
comment on column public.social_resources.category is
  'Etiqueta libre y opcional (Post, Story, Banner, Guía…). Texto y no enum: es editorial, la decide el admin.';
comment on column public.social_resources.audience is
  'Quién lo ve: all (tutores no rechazados/suspendidos), approved, tiers (tier_ids) o tutors (tutor_ids).';
comment on column public.social_resources.tier_ids is
  'Solo cuenta con audience = tiers. Array y no tabla puente: una sola escritura y sin embeds ambiguos (regla de oro 10). Un id de tier borrado no casa con nadie.';
comment on column public.social_resources.tutor_ids is
  'Solo cuenta con audience = tutors. profile_id de los tutores elegidos. Mismo razonamiento que tier_ids.';
comment on column public.social_resources.sort_order is
  'Orden en la galería del tutor, ascendente; a igualdad, el más reciente primero.';
comment on column public.social_resources.deleted_at is
  'Baja lógica. Con valor, el recurso deja de existir para el tutor (y su fichero deja de poder firmarse).';

create index if not exists social_resources_listado_idx
  on public.social_resources (sort_order, created_at desc)
  where deleted_at is null;

drop trigger if exists social_resources_set_updated_at on public.social_resources;
create trigger social_resources_set_updated_at
  before update on public.social_resources
  for each row execute function public.set_updated_at();

alter table public.social_resources enable row level security;


-- ── 3 · Políticas de la tabla ───────────────────────────────────────────────

-- El admin ve todo (también ocultos y dados de baja) y es el único que escribe.
drop policy if exists "social_resources_select_admin" on public.social_resources;
create policy "social_resources_select_admin"
  on public.social_resources for select to authenticated
  using ( public.has_role('admin') );

drop policy if exists "social_resources_insert_admin" on public.social_resources;
create policy "social_resources_insert_admin"
  on public.social_resources for insert to authenticated
  with check ( public.has_role('admin') );

drop policy if exists "social_resources_update_admin" on public.social_resources;
create policy "social_resources_update_admin"
  on public.social_resources for update to authenticated
  using ( public.has_role('admin') )
  with check ( public.has_role('admin') );

-- 🔑 El tutor: solo lo publicado, vivo, y de su audiencia. La subconsulta a
-- `tutor_profiles` corre con SU RLS, y `tutor_profiles_select_own`
-- (`20260706120000`) le deja leer su propia fila —estado y tier—, así que no
-- hace falta ninguna función `security definer`.
drop policy if exists "social_resources_select_tutor" on public.social_resources;
create policy "social_resources_select_tutor"
  on public.social_resources for select to authenticated
  using (
    is_published
    and deleted_at is null
    and exists (
      select 1
        from public.tutor_profiles tp
       where tp.profile_id = (select auth.uid())
         and tp.approval_status not in ('rejected', 'suspended')
         and (
              audience = 'all'
           or (audience = 'approved' and tp.approval_status = 'approved')
           or (audience = 'tiers'    and tp.approval_status = 'approved'
                                     and tp.tier_id = any (tier_ids))
           or (audience = 'tutors'   and tp.profile_id = any (tutor_ids))
         )
    )
  );

-- Sin `delete` para nadie del cliente: baja lógica.
grant select, insert, update on public.social_resources to authenticated;
-- Regla de oro 9: ningún job la toca hoy, pero el grant va aquí para que el día
-- que uno lo haga no coma `permission denied` en ejecución.
grant select, insert, update, delete on public.social_resources to service_role;


-- ── 4 · El bucket: privado ──────────────────────────────────────────────────
-- 25 MB: un PDF de guía o un PNG de story caben de sobra, y queda por debajo
-- del techo global de 50 MB del proyecto (ver upload-formats.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'social-resources', 'social-resources', false,
  26214400,  -- 25 MB
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- La red de MN-11b: `on conflict do nothing` sobre un bucket que ya existía es
-- un no-op silencioso. Se comprueba lo que quedó.
do $$
declare
  v_limit  bigint;
  v_public boolean;
begin
  select b.file_size_limit, b.public into v_limit, v_public
    from storage.buckets b where b.id = 'social-resources';

  if v_limit is distinct from 26214400 then
    raise exception 'EY-222: social-resources quedó en % bytes, se esperaban 26214400 (¿existía ya el bucket?)', v_limit;
  end if;
  if v_public is distinct from false then
    raise exception 'EY-222: social-resources quedó PÚBLICO: la visibilidad por audiencia dejaría de valer';
  end if;
end $$;


-- ── 5 · Políticas de los ficheros ───────────────────────────────────────────

drop policy if exists "social_resources_files_insert_admin" on storage.objects;
create policy "social_resources_files_insert_admin"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'social-resources' and public.has_role('admin') );

-- El admin puede quitar el fichero viejo al sustituirlo por otro (por la API de
-- Storage; desde SQL Storage no deja borrar).
drop policy if exists "social_resources_files_delete_admin" on storage.objects;
create policy "social_resources_files_delete_admin"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'social-resources' and public.has_role('admin') );

-- 🔑 Leer (y por tanto firmar) un fichero = poder leer la FILA que lo apunta.
-- La subconsulta a `social_resources` corre con la RLS del que pide, así que
-- hereda entera la regla de audiencia de arriba: no hay una segunda copia de la
-- regla que pueda divergir. El admin entra por `social_resources_select_admin`.
drop policy if exists "social_resources_files_select" on storage.objects;
create policy "social_resources_files_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'social-resources'
    and (
      public.has_role('admin')
      or exists (
        select 1
          from public.social_resources r
         where r.file_path = objects.name
      )
    )
  );
