-- ============================================================================
-- Enséñame Ya — Requerimientos de sesión: lo que el ALUMNO tiene que traer
--
-- Petición literal del cliente: «tenemos secciones de qué aprenderás, qué
-- lograrás, etc. necesitamos una nueva de requerimientos, ya que nace la
-- necesidad de que por mentoría yo necesito que tengas una laptop, un
-- ventilador, etc.».
--
-- No es lo mismo que `outcome` ni que `description`: esos dos cuentan A QUÉ se
-- llega, este cuenta CON QUÉ hay que llegar. Y el alumno tiene que leerlo antes
-- de pagar, no al entrar a la sala — de ahí que la columna la lean también la
-- confirmación y el detalle de la reserva, y no solo la ficha pública.
--
-- ── POR QUÉ jsonb Y NO text ─────────────────────────────────────────────────
-- Porque el campo es una LISTA («una laptop», «un ventilador»), y en esta misma
-- tabla, escrita desde este mismo formulario, ya hay una lista guardada así:
-- `products.faqs` (R24-17, `20260724180000`). Un `text` obligaría a inventar un
-- formato —¿una por línea?, ¿con guiones?— y a repartir su parseo entre la
-- ficha pública, la confirmación y el detalle: exactamente lo que hace hoy
-- `toBullets()` con la descripción, que se escribió así porque la columna ya
-- existía, no porque sea lo que se quiere. Se copia el precedente de al lado.
--
-- Array de STRINGS y no de objetos: un requisito es una frase suelta, no un par
-- pregunta/respuesta. `["Una laptop con cámara", "Ventilador o aire"]`.
--
-- Sin tabla ni RLS nuevas: `products` ya tiene la escritura del tutor
-- (`20260709120000:78`, grant de tabla acotado por `products_write_own`) y la
-- lectura pública de EP-03 (`20260706120000:172`), así que la columna nace
-- cubierta por las dos. Nace además con default, así que las mentorías ya
-- publicadas siguen válidas sin el dato.
-- ============================================================================

alter table public.products
  add column if not exists requirements jsonb not null default '[]'::jsonb;

comment on column public.products.requirements is
  'Lo que el alumno debe tener listo ANTES de la clase — ["Una laptop", …]. Lista de textos en el orden que escribió el tutor; lista vacía = no se pinta la sección.';

-- Lo mismo que hizo EY-194 con `tutor_profiles.faqs` (`20260826150000:73`): el
-- contenido no lo puede validar la BD —lo escribe el navegador bajo RLS, esto
-- es catálogo y no dinero— pero la FORMA sí. Sin este check, un cliente
-- manipulado deja `requirements = '"lo que sea"'` y todo el que lo lea tiene
-- que defenderse de un jsonb que ni siquiera es una lista. Con él,
-- `parseRequirements()` solo filtra basura DENTRO de una lista, que es un
-- problema mucho más pequeño.
--
-- `drop` + `add` y no `add … if not exists`: Postgres no admite el `if not
-- exists` en constraints, y así la migración se puede repetir sin romper.
alter table public.products
  drop constraint if exists products_requirements_es_lista;
alter table public.products
  add constraint products_requirements_es_lista
  check ( jsonb_typeof(requirements) = 'array' );

-- Redundantes con el grant de tabla de `20260709120000`, y aun así van: todas
-- las columnas añadidas después declaran el suyo (`image_path` en
-- `20260723120000`, `level`/`language` en `20260729190000`,
-- `auto_accept_bookings` en `20260817180000`). La que no aparezca en ningún
-- `grant` es justo la que se queda fuera el día que ese permiso de tabla se
-- acote por columnas — y eso no lo avisa ni el build ni el typecheck, revienta
-- en ejecución (regla de oro 9). Los grants de columna son aditivos: tener los
-- dos no quita nada.
grant insert (requirements) on public.products to authenticated;
grant update (requirements) on public.products to authenticated;
