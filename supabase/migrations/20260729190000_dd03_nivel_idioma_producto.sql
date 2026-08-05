-- ============================================================================
-- DD-03 · Nivel e idioma DE LA MENTORÍA (decisión 25 del cliente, 24-jul)
--
-- Ojo con `tutor_profiles.teaching_level` (IV-02): ese es el nivel que enseña
-- EL TUTOR. El Figma filtra por el de la clase (P05 386:1196) y lo pinta en su
-- ficha (P08), que no es lo mismo: un tutor de nivel avanzado puede publicar
-- una mentoría básica.
--
-- El nivel reutiliza el enum que ya existe (`teaching_level`): mismo
-- vocabulario que el Figma usa en el filtro —Básico/Intermedio/Avanzado— y un
-- tipo menos que mantener.
--
-- El idioma va como texto con check en vez de enum: la lista la mueve producto
-- (hoy son los tres del diseño) y un enum obliga a migración por cada alta.
-- Se guarda el código ISO; la etiqueta vive en el frontend.
--
-- Las dos columnas son opcionales: hay mentorías publicadas desde antes y no se
-- les puede inventar el dato.
-- ============================================================================

alter table public.products
  add column if not exists level    public.teaching_level,
  add column if not exists language text check (language is null or language in ('es', 'en', 'pt'));

comment on column public.products.level is
  'Nivel de la mentoría (DD-03). Distinto de tutor_profiles.teaching_level, que es el del tutor.';
comment on column public.products.language is
  'Idioma en que se imparte, ISO 639-1 (DD-03). La etiqueta visible vive en el frontend.';

-- El tutor edita SUS productos: la política de update ya limita la fila, y los
-- grants van por columna como el resto del catálogo (US-1403).
grant insert (level, language) on public.products to authenticated;
grant update (level, language) on public.products to authenticated;

-- Los filtros de P05/P06 cruzan idioma y nivel con estado y categoría.
create index if not exists products_level_idx    on public.products (level)    where level is not null;
create index if not exists products_language_idx on public.products (language) where language is not null;
