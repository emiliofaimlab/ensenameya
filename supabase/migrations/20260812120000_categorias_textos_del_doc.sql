-- ============================================================================
-- Subtextos de categoría, del documento de contenido §06 (CONTENIDO WEB FINAL,
-- Ennis) — repaso de contenido del 2026-08-12.
--
-- HASTA HOY `categories.description` ESTABA NULL EN LAS 10. Lo que se veía en
-- /categories/<slug> era un texto de reserva del código, idéntico para todas
-- (`category-explorer.tsx`): "Asegura los resultados que deseas de la mano de
-- mentores validados…". No era copy escrito, era un relleno.
--
-- ⚠️ LA TAXONOMÍA DEL DOC NO ES LA DE LA APP, y esta migración NO la cambia.
-- El doc propone 8 categorías; la app tiene 10 y solo 3 coinciden exactamente:
--
--   doc §06                      app
--   ───────────────────────────  ─────────────────────────────────────────────
--   1 Materias académicas        (reparte en Matemáticas + Ciencias +
--                                 Preparación de exámenes)
--   2 Cocina y repostería        NO EXISTE  → se crea aquí, desactivada
--   3 Deportes                   NO EXISTE  → se crea aquí, desactivada
--   4 Juegos y estrategias       NO EXISTE  → se crea aquí, desactivada
--   5 Idiomas                    Idiomas                     ← coincide
--   6 Música y Arte              (reparte en Música + Arte y Diseño)
--   7 Vida y creatividad         Vida y creatividad          ← coincide
--   8 Habilidades profesionales  Habilidades profesionales   ← coincide
--   —                            Programación, Negocios (el doc los mete
--                                 dentro de Habilidades profesionales)
--
-- Solo se escribe el subtexto donde el mapeo es 1 a 1. Repartir el de
-- "Materias académicas" entre tres categorías —o el de "Música y Arte" entre
-- dos— dejaría varias con copy idéntico, que es justo el problema que esto
-- viene a arreglar. Esas 7 se quedan sin subtexto propio (siguen mostrando el
-- de reserva) hasta que Vero/Ennis decidan una de las dos cosas:
--   a) unificar la taxonomía con la del doc  → migración aparte, y hay que
--      reasignar los tutores de `tutor_categories` y arreglar las URLs; o
--   b) escribir 7 subtextos nuevos, uno por categoría existente.
--
-- Las tres nuevas nacen `is_active = false` A PROPÓSITO: sin tutores asignados
-- su página saldría vacía, y `listActiveCategories()` filtra por ese flag.
-- Activarlas es un UPDATE de una línea cuando haya tutores.
--
-- Las "Ideas de Subcategorías (Tags)" del doc no caben todavía: la tabla no
-- tiene columna para ellas y S-13 fija las categorías como PLANAS (sin
-- jerarquía). Eso sería un cambio de modelo, no de contenido.
--
-- Sin cambios de RLS ni de grants: `categories` ya es de lectura pública desde
-- EP-03. `updated_at` lo pone el trigger `categories_set_updated_at`.
-- Idempotente: los UPDATE son por `slug` y el INSERT lleva `on conflict`.
-- ============================================================================

-- ── Las 3 que coinciden 1 a 1 con el doc ────────────────────────────────────

update public.categories set description =
  'Conquista un nuevo idioma y habla con total fluidez. Exprésate con absoluta seguridad en cualquier rincón del mundo. Gana confianza para tu próxima entrevista de trabajo, aprueba certificaciones internacionales con éxito y disfruta de conversar sin barreras.'
where slug = 'idiomas';

update public.categories set description =
  'Expande tu estilo de vida y potencia tu bienestar. Transforma tus hábitos diarios y encuentra nuevas pasiones que te motiven. Construye una rutina más saludable, gestiona proyectos de diseño personal y eleva tu mentalidad con guías certificados.'
where slug = 'vida-y-creatividad';

update public.categories set description =
  'Impulsa tu carrera y domina las habilidades del futuro. Adquiere los conocimientos técnicos y prácticos más demandados por el mercado internacional. Aprende a programar software desde cero, gestiona finanzas de negocio o domina herramientas clave para destacar profesionalmente.'
where slug = 'habilidades-profesionales';

-- ── Las 3 del doc que no existían ───────────────────────────────────────────
-- `sort_order` 110/120/130: detrás de las 10 actuales (la última va en 100).

insert into public.categories (name, slug, description, is_active, sort_order) values
  ('Cocina y repostería', 'cocina-y-reposteria',
   'Domina el arte culinario y crea recetas espectaculares. Saca la versión más pro que llevas dentro. Perfecciona tus técnicas en la cocina, prepara platos emblemáticos desde cero y sorprende a todos con postres únicos en sesiones interactivas 1 a 1.',
   false, 110),
  ('Deportes', 'deportes',
   'Potencia tu rendimiento físico con entrenadores de élite. Es el momento de elevar tu nivel y alcanzar tus metas corporales. Aprende tácticas avanzadas de juego, consolida rutinas efectivas y supera tus propios límites junto a preparadores calificados.',
   false, 120),
  ('Juegos y estrategias', 'juegos-y-estrategias',
   'Desarrolla tu mente y lidera en cada partida. Domina el tablero y la pantalla con jugadas maestras. Perfecciona tus aperturas en ajedrez, analiza mecánicas competitivas y ejecuta estrategias ganadoras junto a los mejores especialistas de la comunidad.',
   false, 130)
on conflict (slug) do nothing;
