-- ============================================================================
-- Enséñame Ya — EY-194: FAQ del TUTOR, heredadas por todas sus mentorías
-- (petición del cliente del 26-ago · «su sección de FAQs» · ver G1 del Doc 22)
--
-- ⚠️ OJO CON EL NÚMERO: `20260826140000` también se llama `ey194` y es OTRA
-- cosa (reabrir la consulta previa a la compra). El mensaje del cliente del
-- 26-ago traía las dos peticiones y en Jira colgaron del mismo ticket. No es
-- un duplicado ni una migración a medias: una toca `pair_can_chat`, esta toca
-- `tutor_profiles`. Si alguien viene a "limpiar migraciones repetidas", que lea
-- esto antes.
--
-- ── QUÉ FALTABA ─────────────────────────────────────────────────────────────
-- Las FAQ ya existían, pero POR MENTORÍA (`products.faqs`, R24-17,
-- `20260724180000`). Un tutor con cinco mentorías tenía que repetir cinco veces
-- «¿necesito conocimientos previos?». Lo que pidió el cliente es lo de su
-- PERFIL: se escribe una vez y sale en todas.
--
-- Se resuelve con una columna hermana en `tutor_profiles` y NO con una tabla
-- `tutor_faqs`, por el mismo motivo que R24-17 no la creó: son un bloque de
-- texto ordenado que se guarda y se pinta entero, nunca se consulta por
-- pregunta, no se referencia desde ningún sitio y no tiene ciclo de vida
-- propio. Una tabla aquí serían dos consultas, un orden que mantener a mano y
-- una política de RLS más para no ganar nada. La fusión con las de la mentoría
-- se hace al pintar la ficha (ver `products/[id]/page.tsx`), no en la BD: son
-- dos orígenes distintos y el orden importa (primero lo de ESTA mentoría).
--
-- ⚠️ NO SE DEDUPLICA, y es decisión, no olvido. Si el tutor repite la misma
-- pregunta en su perfil y en la mentoría, la ficha enseña las dos. Deduplicar
-- exigiría comparar textos escritos a mano ("¿Necesito conocimientos previos?"
-- vs "necesito conocimientos previos") y cualquier criterio que se invente
-- borraría de la pantalla algo que el tutor escribió a propósito — que es peor
-- que una repetición que él mismo ve y arregla.
--
-- ── LA RLS NO SE TOCA, LOS GRANTS SÍ ────────────────────────────────────────
-- `tutor_profiles` ya tiene todo lo que hace falta: `tutor_profiles_select_own`
-- (el tutor ve su fila), `tutor_profiles_select_public` (cualquiera ve la de un
-- tutor `approved`, que es justo el alcance de la ficha pública) y
-- `tutor_profiles_update_own` (edita SOLO su fila). Lo que sí hay que declarar
-- es el grant DE COLUMNA: desde US-1403 la escritura del cliente sobre esta
-- tabla está acotada columna a columna —`approval_status`, `tier_id` y
-- `rating_*` quedan fuera a propósito—, así que una columna nueva sin `grant`
-- no la puede escribir nadie por muy dueño de la fila que sea. Mismo renglón
-- que `display_name`/`avatar_path` (`20260723120000`) y `teaching_level`
-- (`20260722160000`).
-- ============================================================================

alter table public.tutor_profiles
  add column if not exists faqs jsonb not null default '[]'::jsonb;

comment on column public.tutor_profiles.faqs is
  'EY-194: preguntas frecuentes DEL TUTOR — [{q,a},…]. Se heredan en todas sus mentorías: la ficha pinta primero las de `products.faqs` y luego estas, sin deduplicar.';

-- El SELECT ya era de tabla (catálogo, `20260706120000`); aquí solo la
-- escritura. `insert` además de `update` porque la fila se crea desde el
-- asistente de tutor y un día podría nacer con FAQ ya puestas.
grant insert (faqs) on public.tutor_profiles to authenticated;
grant update (faqs) on public.tutor_profiles to authenticated;

-- Esto lo escribe el NAVEGADOR (es catálogo, no dinero: regla de oro 2 no
-- aplica), así que la forma no está garantizada por ninguna función de por
-- medio: un cliente manipulado puede mandar `faqs = '"lo que sea"'`. Quien lee
-- ya filtra por forma —`parseFaqs` descarta lo que no sea `{q,a}` de texto—,
-- pero el check impide que la columna guarde algo que no es una lista y que
-- reviente al primer `jsonb_array_length` que alguien escriba mañana.
--
-- ⚠️ Solo se comprueba el TIPO, no el tamaño. Un `jsonb_array_length(…) <= N`
-- en el mismo check obligaría a evaluar dos expresiones en un orden que
-- Postgres no garantiza, y sobre un valor que no es lista esa función no
-- devuelve null: lanza. El tope de preguntas lo pone el formulario (y el de
-- bytes, el propio Postgres). Si alguna vez hace falta en la BD, va como un
-- check aparte con su `case when jsonb_typeof(...)`.
alter table public.tutor_profiles
  drop constraint if exists tutor_profiles_faqs_es_lista;
alter table public.tutor_profiles
  add constraint tutor_profiles_faqs_es_lista
  check ( jsonb_typeof(faqs) = 'array' );
