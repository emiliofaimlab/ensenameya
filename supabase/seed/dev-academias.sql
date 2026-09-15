-- ============================================================================
-- Enséñame Ya — academias de DEV (B2B, 15-sep-2026)
--
-- Puebla dos academias y las ata a tutores que ya existen en dev. No crea
-- tutores ni mentorías: una academia AGRUPA lo que ya hay (ver la cabecera de
-- `20260915180000_las_academias_agrupan_tutores.sql`).
--
-- Se aplica a **dev**, nunca a prod:
--   npx supabase db query --linked -f supabase/seed/dev-academias.sql
--
-- Idempotente: se puede volver a correr. Los tutores se atan por
-- `display_name` porque sus uuid son los del sembrado `dev-poblar.sql`, y
-- atarlos por nombre sobrevive a un resembrado que los regenere.
-- ============================================================================

insert into public.academies (slug, name, tagline, description, brand_color, website, status)
values
  (
    'project-blue',
    'Project Blue',
    'Inglés con método propio: de la conversación al examen',
    'Project Blue lleva ocho años enseñando inglés con un método propio que ' ||
    'empieza por la conversación y termina en el examen internacional. Sus ' ||
    'profesores son certificados y cada plan se arma sobre una prueba de ' ||
    'nivel inicial, así que nadie repite lo que ya sabe. En Enséñame Ya ' ||
    'encontrarás a su equipo completo, con la misma metodología y la reserva ' ||
    'de siempre.',
    '#1d4ed8',
    'https://projectblue.example.com',
    'active'
  ),
  (
    'academia-nexo',
    'Academia Nexo',
    'Producto digital, diseño y negocio en un mismo sitio',
    'Nexo nació de un estudio de producto que acabó enseñando más de lo que ' ||
    'facturaba. Hoy reúne a profesionales en activo —desarrollo, diseño y ' ||
    'finanzas— que dan mentorías de lo que hacen cada día, no de lo que ' ||
    'leyeron. Sesiones 1 a 1, sin grabaciones genéricas y sin temario ' ||
    'enlatado.',
    '#7c3aed',
    null,
    'active'
  ),
  (
    'taller-borrador',
    'Taller Borrador',
    'Academia en preparación (no debe salir en el catálogo)',
    'Existe solo para comprobar que una academia en `draft` NO aparece en ' ||
    '/academias ni responde en su URL pública para un visitante anónimo, y ' ||
    'que sí la ve un admin.',
    null,
    null,
    'draft'
  )
on conflict (slug) do update
  set name        = excluded.name,
      tagline     = excluded.tagline,
      description = excluded.description,
      brand_color = excluded.brand_color,
      website     = excluded.website,
      status      = excluded.status;

-- ── Los tutores ─────────────────────────────────────────────────────────────
-- Idiomas y exámenes → Project Blue.
update public.tutor_profiles tp
   set academy_id = (select id from public.academies where slug = 'project-blue')
 where tp.display_name in ('Camila Duarte', 'Andrés Peña');

-- Producto digital, diseño y negocio → Nexo.
update public.tutor_profiles tp
   set academy_id = (select id from public.academies where slug = 'academia-nexo')
 where tp.display_name in ('Mateo Herrera', 'Sofía Marín', 'Tomás Aguilar');

-- El resto se queda independiente A PROPÓSITO: el catálogo tiene que enseñar
-- las dos cosas a la vez, o la pantalla de tutores mentiría sobre el modelo.

select a.slug,
       a.status,
       count(tp.profile_id) filter (where tp.approval_status = 'approved') as tutores
  from public.academies a
  left join public.tutor_profiles tp on tp.academy_id = a.id
 group by a.slug, a.status
 order by a.slug;
