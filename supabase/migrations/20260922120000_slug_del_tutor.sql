-- ════════════════════════════════════════════════════════════════════════════
-- /tutores/nestor-valderrama en vez de /tutors/<uuid> (pedido de Néstor, 22-sep).
--
-- El slug se fija UNA vez —la primera vez que el tutor tiene nombre— y no se
-- mueve solo aunque cambie `display_name`: es un enlace que ya se compartió por
-- WhatsApp. La ficha sigue aceptando el uuid, así que nada de lo anterior se
-- rompe; si hay que cambiar un slug, es un `update` explícito.
--
-- Grants: `tutor_profiles` tiene `grant select` de TABLA a anon/authenticated
-- (`20260706120000`), así que la columna nueva ya es legible. Nadie tiene
-- `grant update (slug)`: lo escribe el trigger, que no pasa por los grants.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.tutor_profiles add column slug text;

create unique index tutor_profiles_slug_key on public.tutor_profiles (slug);

comment on column public.tutor_profiles.slug is
  'Segmento de /tutores/<slug>. Lo pone tutor_profiles_slug() la primera vez que hay display_name y no se recalcula al renombrar: el enlace ya circula. La ficha acepta también el uuid.';

-- «Néstor Valderrama» → «nestor-valderrama». Sin `unaccent` para no depender de
-- una extensión: `translate` cubre el español y el portugués del catálogo.
create function public.slugificar(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(trim(both '-' from regexp_replace(
    translate(lower(coalesce(p, '')),
              'áàäâãåéèëêíìïîóòöôõúùüûñçý',
              'aaaaaaeeeeiiiiooooouuuuncy'),
    '[^a-z0-9]+', '-', 'g')), '')
$$;

create function public.tutor_profiles_slug()
returns trigger
language plpgsql
-- DEFINER por el `exists`: con la RLS del tutor no ve los perfiles sin aprobar
-- de otros, y un choque invisible acabaría en un 23505 al guardar su ficha.
security definer
set search_path = ''
as $$
declare
  base text;
  n int := 1;
begin
  if new.slug is not null then
    return new;
  end if;
  base := public.slugificar(new.display_name);
  if base is null then
    return new;  -- sin nombre todavía: se reintenta en el próximo update
  end if;
  new.slug := base;
  while exists (select 1 from public.tutor_profiles
                 where slug = new.slug and profile_id <> new.profile_id) loop
    n := n + 1;
    new.slug := base || '-' || n;
  end loop;
  return new;
end;
$$;

create trigger tutor_profiles_slug
  before insert or update on public.tutor_profiles
  for each row execute function public.tutor_profiles_slug();

-- Relleno: el trigger hace el trabajo. Por orden de aprobación, para que el
-- primero en llegar se quede el slug sin sufijo.
do $$
declare r record;
begin
  for r in select profile_id from public.tutor_profiles
            order by approved_at nulls last, created_at loop
    update public.tutor_profiles set slug = null where profile_id = r.profile_id;
  end loop;
end $$;

revoke execute on function public.tutor_profiles_slug() from public, anon, authenticated;
