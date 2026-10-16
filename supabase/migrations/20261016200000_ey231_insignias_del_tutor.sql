-- ============================================================================
-- Enséñame Ya — EY-231: insignias del tutor («Tutor Fundador», «Tutor
-- Verificado»), que asigna el admin y que un tutor puede tener a la vez
-- (portal de soporte, Néstor, 16-oct)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Hasta hoy «Tutor verificado» era texto fijo en la tarjeta, la ficha y el
-- detalle de mentoría, que salía de `approval_status = 'approved'`. Los
-- primeros 100 tutores aprobados son «Fundadores», y el cliente quiere
-- ponerlo y quitarlo él, igual que el tier (`assign_tutor_tier`,
-- `20260715170000`).
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Columna `text[]` con un `check` y no una tabla `tutor_badges`: hoy hay DOS
--   insignias fijas y ninguna tiene datos propios. El día que el admin tenga que
--   CREAR tipos nuevos (nombre, color), se pasa a tabla.
-- · Default `{verificado}`: todo tutor que existe y todo el que llegue lleva la
--   de siempre, así que no cambia nada que no se toque a mano.
-- · Se lee sola: `tutor_profiles` tiene `grant select` de TABLA a anon y
--   authenticated (`20260706120000:171`). Se escribe SOLO por la RPC: el tutor
--   tiene `update` por columna y esta no entra, así que no puede ponerse
--   «Fundador» a sí mismo. La política `tutor_profiles_update_admin`
--   (`20261005120000`) tampoco le abre la columna al admin, por el mismo grant.
-- · `tutors_public` se recrea con la columna AL FINAL: `create or replace
--   view` solo deja añadir columnas por detrás.
-- ============================================================================

alter table public.tutor_profiles
  add column if not exists badges text[] not null default '{verificado}'
  constraint tutor_profiles_badges_validas
    check (badges <@ array['fundador', 'verificado']::text[]);

comment on column public.tutor_profiles.badges is
  'EY-231: insignias públicas del tutor; puede tener varias. Valores: fundador (negra), verificado (naranja). Solo las pinta el catálogo de tutores aprobados. Se escriben con set_tutor_badges (admin).';

create or replace view public.tutors_public
with (security_invoker = true) as
select
  tp.profile_id,
  tp.display_name,
  tp.avatar_path,
  tp.headline,
  tp.bio,
  tp.rating_avg,
  tp.rating_count,
  tp.approval_status,
  barata.price_amount as price_from,
  barata.currency     as price_currency,
  tp.badges
from public.tutor_profiles tp
left join lateral (
  select pr.price_amount, pr.currency
  from public.products pr
  where pr.tutor_id = tp.profile_id
    and pr.status = 'active'
  order by pr.price_amount asc
  limit 1
) barata on true;

grant select on public.tutors_public to anon, authenticated;

create or replace function public.set_tutor_badges(
  p_tutor_id uuid,
  p_badges   text[]
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badges text[];
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin asigna insignias'
      using errcode = 'insufficient_privilege';
  end if;

  -- Sin duplicados ni orden del cliente: el check valida los valores.
  select coalesce(array_agg(distinct b order by b), '{}')
    into v_badges
    from unnest(coalesce(p_badges, '{}')) b;

  update public.tutor_profiles
     set badges = v_badges
   where profile_id = p_tutor_id;

  if not found then
    raise exception 'tutor no encontrado' using errcode = 'no_data_found';
  end if;

  return v_badges;
end;
$$;

comment on function public.set_tutor_badges(uuid, text[]) is
  'EY-231: el admin fija las insignias de un tutor (fundador, verificado). Pisa la lista entera; vacía = sin insignias.';

revoke execute on function public.set_tutor_badges(uuid, text[]) from public, anon;
grant execute on function public.set_tutor_badges(uuid, text[]) to authenticated;
