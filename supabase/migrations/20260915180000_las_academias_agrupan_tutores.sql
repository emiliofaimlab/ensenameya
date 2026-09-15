-- ============================================================================
-- Enséñame Ya — las academias agrupan tutores (vista pública)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Una academia con marca y método propios trae sus profesores y usa la
-- plataforma como motor («powered by»). El estudio de viabilidad está en
-- `docs/B2B-ACADEMIAS.md`, y de sus dos caminos esta migración construye
-- SOLO el barato:
--
--   · la academia AGRUPA tutores que ya existen; no crea mentorías propias
--     (`products.tutor_id` no se toca), no cobra y no recibe payouts;
--   · el dinero sigue yendo alumno → tutor → plataforma, exactamente igual.
--     **El motor de pagos no se toca**, y es una decisión del cliente, no un
--     descuido: quien reserva desde la ficha de una academia crea el mismo
--     `booking` contra el mismo tutor que si hubiera entrado por `/tutors`.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · **Un tutor pertenece como mucho a UNA academia**, y por eso esto es una
--   columna en `tutor_profiles` y NO una tabla puente. Es deliberado: una
--   tabla puente entre `profiles` y `tutor_profiles` volvería ambiguos los
--   embeds de PostgREST y tiraría consultas ya escritas con `PGRST201` — lo
--   que hizo `tutor_views` (`20260827140000`) con la cola del admin. Si algún
--   día un tutor tiene que estar en varias, ese día se paga ese precio.
-- · **No hay políticas de escritura para el cliente.** Todavía no existe el
--   rol de academia ni su panel (decisión del 15-sep: primero se enseña la
--   pantalla al cliente). Las academias las siembra `service_role` o el admin;
--   `supabase/seed/dev-academias.sql` puebla dev.
-- · **El logo vive en el bucket `avatars`**, que ya es público y ya tiene sus
--   políticas. ponytail: un bucket `academy-logos` sería más bonito y no
--   compraría nada mientras nadie pueda subir un fichero desde una pantalla.
-- · La ficha pública lee `academies_public`, no la tabla: la vista trae ya
--   agregados el recuento de tutores, la nota media ponderada y el precio de
--   entrada, que de otro modo serían tres consultas más por pantalla.
-- ============================================================================

-- ── El estado, como en `products` ───────────────────────────────────────────
-- Dos valores a propósito. `suspended` llegará el día que haya a quién
-- suspender; hoy sería un valor que ninguna línea de código sabe pintar.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'academy_status') then
    create type public.academy_status as enum ('draft', 'active');
  end if;
end $$;

create table if not exists public.academies (
  id           uuid primary key default gen_random_uuid(),

  -- La URL pública es `/academias/<slug>`, no `/academias/<uuid>`: el enlace
  -- lo va a pegar la propia academia en sus redes. Minúsculas, números y
  -- guiones; el check es la red, quien lo normaliza es quien inserta.
  slug         text not null unique
               check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 60),

  name         text not null check (btrim(name) <> '' and length(name) <= 120),

  -- Una línea bajo el nombre («Inglés de negocios con método propio»). Es lo
  -- que se lee en la tarjeta del listado, donde la descripción no cabe.
  tagline      text check (tagline is null or length(tagline) <= 160),
  description  text,

  -- Ruta DENTRO del bucket público `avatars` (ver cabecera). `null` = la ficha
  -- pinta las iniciales del nombre, igual que hace un tutor sin foto.
  logo_path    text,

  -- Color de marca en hexadecimal (`#rrggbb`). `null` = se usa el azul de
  -- Enséñame Ya. Es lo único que distingue visualmente a una academia de otra
  -- mientras no haya portadas subidas.
  brand_color  text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),

  website      text,

  status       public.academy_status not null default 'draft',

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.academies is
  'Academias aliadas: agrupan tutores ya existentes bajo una marca. NO cobran ni reciben payouts (docs/B2B-ACADEMIAS.md).';
comment on column public.academies.slug is
  'Identificador de la URL pública /academias/<slug>. Único, minúsculas y guiones.';
comment on column public.academies.logo_path is
  'Ruta dentro del bucket público `avatars`. null = la pantalla pinta iniciales.';
comment on column public.academies.brand_color is
  'Hex #rrggbb del color de marca. null = azul de Enséñame Ya.';
comment on column public.academies.status is
  'draft = no visible en el catálogo público; active = visible.';

drop trigger if exists academies_set_updated_at on public.academies;
create trigger academies_set_updated_at
  before update on public.academies
  for each row execute function public.set_updated_at();

alter table public.academies enable row level security;

-- Catálogo público (RN-24): cualquiera ve las activas, incluido `anon`.
drop policy if exists "academies_select_active" on public.academies;
create policy "academies_select_active"
  on public.academies for select
  using ( status = 'active' );

-- El admin ve también los borradores, que es como se prepara una antes de
-- publicarla.
drop policy if exists "academies_select_admin" on public.academies;
create policy "academies_select_admin"
  on public.academies for select
  using ( public.has_role('admin') );

-- Sin políticas de insert/update/delete a propósito (ver cabecera).

-- Grants para la Data API: auto-expose está OFF, así que sin esto el rol ni
-- llega a la RLS. `service_role` incluido — regla de oro 9: se salta la RLS,
-- no los grants, y es quien siembra.
grant select on public.academies to anon, authenticated;
grant select, insert, update, delete on public.academies to service_role;

-- ── El vínculo: una columna, no una tabla puente ────────────────────────────
alter table public.tutor_profiles
  add column if not exists academy_id uuid
    references public.academies (id) on delete set null;

comment on column public.tutor_profiles.academy_id is
  'Academia a la que pertenece el tutor; null = tutor independiente (la mayoría). ON DELETE SET NULL: borrar una academia no borra a sus tutores ni su historial.';

create index if not exists tutor_profiles_academy_id_idx
  on public.tutor_profiles (academy_id)
  where academy_id is not null;

-- ── La vista que lee la pantalla ────────────────────────────────────────────
-- Columnas explícitas y `security_invoker`: hereda la RLS de `academies`,
-- `tutor_profiles` y `products`, así que un borrador solo lo ve el admin y un
-- tutor no aprobado no suma en el recuento de nadie.
create or replace view public.academies_public
with (security_invoker = true) as
select
  a.id,
  a.slug,
  a.name,
  a.tagline,
  a.description,
  a.logo_path,
  a.brand_color,
  a.website,
  a.created_at,

  coalesce(t.tutor_count, 0)   as tutor_count,
  -- Nota media PONDERADA por el número de reseñas de cada tutor: la media de
  -- las medias le daría el mismo peso al tutor con 40 reseñas que al que
  -- tiene 1. `null` = la academia aún no tiene ninguna reseña, que no es lo
  -- mismo que un 0 (cinco estrellas vacías donde no hay dato).
  t.rating_avg,
  coalesce(t.rating_count, 0)  as rating_count,

  coalesce(p.product_count, 0) as product_count,
  -- Precio de entrada: la mentoría activa más barata de sus tutores. Mismo
  -- criterio que `tutors_public` (`20260804120000`) — en un paquete compite su
  -- precio TOTAL, no el equivalente por sesión.
  barata.price_amount          as price_from,
  barata.currency              as price_currency
from public.academies a
left join lateral (
  select
    count(*)::int                         as tutor_count,
    sum(tp.rating_count)::int             as rating_count,
    case when sum(tp.rating_count) > 0
         then round(
                sum(coalesce(tp.rating_avg, 0) * tp.rating_count)
                / sum(tp.rating_count),
                2)
    end                                   as rating_avg
  from public.tutor_profiles tp
  where tp.academy_id = a.id
    and tp.approval_status = 'approved'
) t on true
left join lateral (
  select count(*)::int as product_count
  from public.products pr
  join public.tutor_profiles tp on tp.profile_id = pr.tutor_id
  where tp.academy_id = a.id
    and tp.approval_status = 'approved'
    and pr.status = 'active'
) p on true
left join lateral (
  select pr.price_amount, pr.currency
  from public.products pr
  join public.tutor_profiles tp on tp.profile_id = pr.tutor_id
  where tp.academy_id = a.id
    and tp.approval_status = 'approved'
    and pr.status = 'active'
  order by pr.price_amount asc
  limit 1
) barata on true;

comment on view public.academies_public is
  'Academias con sus cifras ya agregadas (tutores, nota ponderada, mentorías, precio de entrada). security_invoker: hereda la RLS de academies, tutor_profiles y products.';

grant select on public.academies_public to anon, authenticated;
