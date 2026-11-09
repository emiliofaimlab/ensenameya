-- ============================================================================
-- Enséñame Ya — EY-248 · «Descargables» del tutor: hasta 4 PDFs en su perfil
-- público que se descargan a cambio de nombre + email (un lead magnet).
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Pedido de Néstor (portal de soporte, 5-nov): el tutor publica ofertas,
-- portfolio o whitepapers y, para bajarlos, el visitante deja nombre y correo
-- SIN crear cuenta. Los leads los ve el tutor (los suyos) y el admin (todos);
-- decidido con Jose el 9-nov.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `/tutor/recursos` ya es EY-222 (material de redes que sube el ADMIN,
--   `20261013140000`). Esto es otra cosa y se llama «descargables».
-- · Tope de 4 activos por tutor: lo impone el trigger, no la pantalla.
-- · Los leads los escribe SOLO `POST /api/descargables/[id]` con service_role
--   (patrón DL-01, `20260817120000`): sin política de insert, a propósito —un
--   insert abierto a `anon` es un formulario de spam con pasos de más—.
--   Validación, honeypot y límite por IP viven en el handler.
-- · Bucket PRIVADO `tutor-downloads`: nadie descarga directo; el handler firma
--   la URL después de guardar el lead. Si fuera público, el lead se saltaría
--   copiando el enlace. Espejo de formatos en `src/components/tutor/upload-formats.ts`
--   (`DOWNLOAD_*`).
-- · `tutor_download_leads.tutor_id` apunta a `profiles`, NO a `tutor_profiles`:
--   con FK a las dos puntas (tutor_downloads y tutor_profiles) la tabla sería
--   PUENTE entre dos tablas que ya tienen FK directa y PostgREST empezaría a
--   responder PGRST201 al embeber una desde la otra (regla de oro 10).
-- ============================================================================


-- ── 1 · Los documentos ──────────────────────────────────────────────────────
create table if not exists public.tutor_downloads (
  id          uuid primary key default gen_random_uuid(),
  tutor_id    uuid not null references public.tutor_profiles(profile_id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  description text check (description is null or char_length(description) <= 200),
  file_path   text not null,
  file_name   text not null,
  size_bytes  bigint not null check (size_bytes > 0),
  sort_order  smallint not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.tutor_downloads is
  'EY-248 · PDFs que el tutor ofrece en su perfil público a cambio de nombre + email. Máx. 4 vivos por tutor (trigger).';
comment on column public.tutor_downloads.file_path is
  'Ruta en el bucket privado tutor-downloads (<tutor_id>/<uuid>.pdf). Nunca una URL: se descarga por URL firmada que emite el handler tras guardar el lead.';
comment on column public.tutor_downloads.deleted_at is
  'Baja lógica: deja de salir en el perfil, pero sus leads se conservan.';

create index if not exists tutor_downloads_tutor_idx
  on public.tutor_downloads (tutor_id, sort_order, created_at)
  where deleted_at is null;

drop trigger if exists tutor_downloads_set_updated_at on public.tutor_downloads;
create trigger tutor_downloads_set_updated_at
  before update on public.tutor_downloads
  for each row execute function public.set_updated_at();

-- Tope de 4 vivos. También al «resucitar» uno (deleted_at → null).
create or replace function public.tutor_downloads_tope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    -- ponytail: lock por tutor para que dos subidas a la vez no pasen las dos del 4.
    perform pg_advisory_xact_lock(hashtext('tutor_downloads:' || new.tutor_id::text));
    if (select count(*) from public.tutor_downloads
         where tutor_id = new.tutor_id and deleted_at is null and id <> new.id) >= 4 then
      raise exception 'Puedes tener como máximo 4 descargables publicados.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tutor_downloads_tope on public.tutor_downloads;
create trigger tutor_downloads_tope
  before insert or update of deleted_at on public.tutor_downloads
  for each row execute function public.tutor_downloads_tope();

alter table public.tutor_downloads enable row level security;

-- Público: vivos y de tutores aprobados (mismo criterio que el catálogo).
drop policy if exists "tutor_downloads_select_public" on public.tutor_downloads;
create policy "tutor_downloads_select_public"
  on public.tutor_downloads for select to anon, authenticated
  using (
    deleted_at is null
    and exists (select 1 from public.tutor_profiles tp
                 where tp.profile_id = tutor_downloads.tutor_id
                   and tp.approval_status = 'approved')
  );

drop policy if exists "tutor_downloads_select_own" on public.tutor_downloads;
create policy "tutor_downloads_select_own"
  on public.tutor_downloads for select to authenticated
  using ( (select auth.uid()) = tutor_id or public.has_role('admin') );

drop policy if exists "tutor_downloads_insert_own" on public.tutor_downloads;
create policy "tutor_downloads_insert_own"
  on public.tutor_downloads for insert to authenticated
  with check (
    (select auth.uid()) = tutor_id
    and file_path like tutor_id::text || '/%'
  );

drop policy if exists "tutor_downloads_update_own" on public.tutor_downloads;
create policy "tutor_downloads_update_own"
  on public.tutor_downloads for update to authenticated
  using ( (select auth.uid()) = tutor_id )
  with check ( (select auth.uid()) = tutor_id and file_path like tutor_id::text || '/%' );

grant select on public.tutor_downloads to anon;
grant select, insert, update on public.tutor_downloads to authenticated;
grant select, insert, update, delete on public.tutor_downloads to service_role;


-- ── 2 · Los leads ───────────────────────────────────────────────────────────
create table if not exists public.tutor_download_leads (
  id          uuid primary key default gen_random_uuid(),
  download_id uuid not null references public.tutor_downloads(id) on delete cascade,
  tutor_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(btrim(name))  between 1 and 120),
  email       text not null check (char_length(btrim(email)) between 3 and 254),
  consent_at  timestamptz not null default now(),
  -- Solo para el límite por origen del handler, como en contact_messages.
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

comment on table public.tutor_download_leads is
  'EY-248 · Quién descargó qué. La escribe solo el Route Handler con service_role; la leen el tutor dueño y el admin.';
comment on column public.tutor_download_leads.tutor_id is
  'Desnormalizado de tutor_downloads para que la RLS no tenga que hacer join. FK a profiles y NO a tutor_profiles: evita PGRST201 (regla de oro 10).';
comment on column public.tutor_download_leads.consent_at is
  'Momento en que marcó «comparto mis datos con el tutor y Enséñame Ya». Sin esa casilla el handler no inserta.';

create index if not exists tutor_download_leads_tutor_idx
  on public.tutor_download_leads (tutor_id, created_at desc);
create index if not exists tutor_download_leads_ip_idx
  on public.tutor_download_leads (ip, created_at desc);

alter table public.tutor_download_leads enable row level security;

drop policy if exists "tutor_download_leads_select" on public.tutor_download_leads;
create policy "tutor_download_leads_select"
  on public.tutor_download_leads for select to authenticated
  using ( (select auth.uid()) = tutor_id or public.has_role('admin') );

grant select on public.tutor_download_leads to authenticated;
grant select, insert, delete on public.tutor_download_leads to service_role;


-- ── 3 · El bucket: privado, solo PDF, 10 MB ─────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tutor-downloads', 'tutor-downloads', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

do $$
declare
  v_limit  bigint;
  v_public boolean;
begin
  select b.file_size_limit, b.public into v_limit, v_public
    from storage.buckets b where b.id = 'tutor-downloads';
  if v_limit is distinct from 10485760 then
    raise exception 'EY-248: tutor-downloads quedó en % bytes, se esperaban 10485760', v_limit;
  end if;
  if v_public is distinct from false then
    raise exception 'EY-248: tutor-downloads quedó PÚBLICO: el lead se saltaría copiando el enlace';
  end if;
end $$;

-- El tutor sube, ve y borra solo en su carpeta (<su uid>/…).
drop policy if exists "tutor_downloads_files_insert_own" on storage.objects;
create policy "tutor_downloads_files_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tutor-downloads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.tutor_profiles tp where tp.profile_id = (select auth.uid()))
  );

drop policy if exists "tutor_downloads_files_select_own" on storage.objects;
create policy "tutor_downloads_files_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tutor-downloads'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.has_role('admin'))
  );

drop policy if exists "tutor_downloads_files_delete_own" on storage.objects;
create policy "tutor_downloads_files_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tutor-downloads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
