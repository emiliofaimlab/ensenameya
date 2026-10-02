-- ════════════════════════════════════════════════════════════════════════════
-- /mentorias/guitarra-para-principiantes en vez de /products/<uuid> (pedido de
-- Néstor, 2-oct). Mismo patrón que `20260922120000_slug_del_tutor`.
--
-- El slug sale del título la PRIMERA vez y no se mueve al renombrar: el enlace
-- ya circula. La ficha sigue aceptando el uuid, así que nada de lo anterior se
-- rompe. Choques → -2, -3 (dos tutores con «Clases de inglés» es lo normal).
--
-- ⚠️ A diferencia de `tutor_profiles`, aquí `authenticated` tiene `update` de
-- TABLA (`20260709120000`): sin más, un tutor podría escribir el slug de su
-- mentoría a mano. Por eso el trigger IGNORA lo que llegue: en el alta lo
-- calcula siempre y en un update conserva el que había. Cambiar un slug es una
-- migración que desactive el trigger, no un `update`.
--
-- La COLUMNA no es nueva: está desde `20260706120000_ep03_catalog.sql` («para
-- luego»), vacía en las 41 filas de dev y sin nada que la escriba. Lo nuevo es
-- el índice único y el trigger que la rellena. Legible por anon/authenticated
-- con el `grant select` de tabla de esa misma migración.
-- ════════════════════════════════════════════════════════════════════════════

create unique index products_slug_key on public.products (slug);

comment on column public.products.slug is
  'Segmento de /mentorias/<slug>. Lo pone products_slug() a partir del título y no se recalcula al renombrar: el enlace ya circula. La ficha acepta también el uuid.';

create function public.products_slug()
returns trigger
language plpgsql
-- DEFINER por el `exists`: con la RLS del tutor no ve los borradores de otros,
-- y un choque invisible acabaría en un 23505 al guardar su mentoría.
security definer
set search_path = ''
as $$
declare
  base text;
  n int := 1;
begin
  if tg_op = 'UPDATE' and old.slug is not null then
    new.slug := old.slug;
    return new;
  end if;
  new.slug := null;
  base := public.slugificar(new.title);
  if base is null then
    return new;  -- sin título todavía: se reintenta en el próximo update
  end if;
  new.slug := base;
  while exists (select 1 from public.products
                 where slug = new.slug and id <> new.id) loop
    n := n + 1;
    new.slug := base || '-' || n;
  end loop;
  return new;
end;
$$;

create trigger products_slug
  before insert or update on public.products
  for each row execute function public.products_slug();

-- Relleno: el trigger hace el trabajo. Las publicadas primero y por antigüedad,
-- para que la primera en llegar se quede el slug sin sufijo.
--
-- Con dos triggers apagados mientras tanto: `products_publish_guard` ABORTARÍA
-- la migración entera si queda una mentoría activa de un tutor ya no aprobado,
-- y `set_updated_at` le cambiaría la fecha a todo el catálogo — que es el
-- `lastmod` del sitemap.
alter table public.products disable trigger products_publish_guard;
alter table public.products disable trigger products_set_updated_at;

do $$
declare r record;
begin
  for r in select id from public.products
            order by (status = 'active') desc, created_at loop
    update public.products set slug = null where id = r.id;
  end loop;
end $$;

alter table public.products enable trigger products_publish_guard;
alter table public.products enable trigger products_set_updated_at;

revoke execute on function public.products_slug() from public, anon, authenticated;
