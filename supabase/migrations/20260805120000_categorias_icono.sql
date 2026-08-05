-- ============================================================================
-- Icono elegible por categoría (US-1102)
--
-- El icono vivía en un mapa `slug → icono` dentro del código
-- (`category-icons.ts`), sembrado con las 10 categorías iniciales. Pero el
-- panel de admin deja crear categorías a quien no toca código, así que toda
-- categoría nueva caía al icono genérico y arreglarlo exigía un despliegue.
-- El dato pasa a la BD y el admin lo elige al crearla.
--
-- Texto y no enum: la paleta la mueve diseño y un enum obliga a migración por
-- cada icono nuevo. **La lista blanca vive en el frontend**: se pinta el icono
-- sólo si la clave está en la paleta, así que un valor inventado en esta
-- columna no puede inyectar nada — cae al genérico.
-- ============================================================================

alter table public.categories
  add column if not exists icon text;

comment on column public.categories.icon is
  'Clave del icono en la paleta del frontend (category-icons.ts). Nulo o desconocido = icono genérico.';

-- Backfill con el mapa que hasta ahora estaba en el código, para que las 10 del
-- seed conserven el suyo y el frontend se quede con UNA sola fuente en vez de
-- un mapa por slug + una columna.
update public.categories set icon = case slug
  when 'idiomas'                   then 'languages'
  when 'matematicas'               then 'sigma'
  when 'programacion'              then 'code'
  when 'ciencias'                  then 'flask'
  when 'musica'                    then 'music'
  when 'arte-y-diseno'             then 'palette'
  when 'negocios'                  then 'briefcase'
  when 'preparacion-examenes'      then 'graduation-cap'
  when 'vida-y-creatividad'        then 'heart'
  when 'habilidades-profesionales' then 'award'
  else icon
end
where icon is null;

-- El admin ya tiene `categories_update_admin`/`insert_admin`; con auto-expose
-- OFF hay que declarar el grant de la columna nueva igual que el resto.
grant insert (icon) on public.categories to authenticated;
grant update (icon) on public.categories to authenticated;
