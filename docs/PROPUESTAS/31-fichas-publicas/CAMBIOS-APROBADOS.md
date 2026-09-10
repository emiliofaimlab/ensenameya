# Fichas públicas v2 — Cambios aprobados (10-sep-2026)

> Lista cerrada de ajustes aprobados por Emilio Faim sobre las dos fichas públicas de Enséñame Ya —**perfil del tutor** y **ficha de mentoría**, en escritorio y móvil— para que desarrollo (Jose Mora) los aplique con un agente de Claude y el resultado quede igual a la referencia visual. Manda sobre cualquier documento anterior donde difiera.

| Campo | Valor |
| :-- | :-- |
| **Referencia visual** | Artifact https://claude.ai/code/artifact/8880fd09-5ee7-436b-8993-819c2ca63368 (enlace directo: `?pantalla=<id>&vista=propuesta`) · copia local `revision-fichas-publicas.html` · páginas sueltas **`ficha-tutor-propuesta.html`** y **`ficha-mentoria-propuesta.html`** (escritorio ≥ 1024 px, móvil por debajo; se abren en un teléfono) |
| **Base de código** | `main` al 9-sep-2026 (166 migraciones). Las vistas «Hoy» del artifact y las capturas `-hoy.png` reproducen ese estado |
| **Origen** | Revisión con Emilio del 9 y 10 de septiembre: 46 comentarios sobre el artifact, todos aplicados (artifact v47) |
| **Alcance** | Frontend de `src/app/(public)/tutors/[id]/page.tsx` y `src/app/(public)/products/[id]/page.tsx` y los componentes de `src/components/catalog/` que usan. Cambios de consulta en `src/lib/catalog/queries.ts`. **Sin migraciones** salvo lo marcado en §8 como DECISIÓN PENDIENTE |
| **Ids de pantalla** | `tutor` · `tutor-movil` · `producto` · `movil` (mentoría móvil) |
| **Datos de ejemplo** | Tutora **Valentina Ríos**; mentoría **«Cálculo I sin miedo: aprueba tu parcial»**, US$ 18 por sesión de 60 min, nivel intermedio, español, confirmación inmediata |

---

## 0 · Reglas globales (aplican a las dos fichas)

**G-01 · Valoración sin caja.** Las estrellas van siempre como línea de texto bajo el nombre o el título: `★★★★★ 4.9 · 23 reseñas` (estrellas `#ffc531` sobre azul o `#f59e0b` sobre blanco, nota en negrita). Nunca dentro de un chip ni de una tarjeta de datos. En la ficha de mentoría la nota es **de esa mentoría** (§5.3) y el texto no dice de qué es: solo estrellas, nota y número.

**G-02 · Iconografía (lucide, 14–18 px, color `brand` #0072ff sobre blanco / blanco sobre azul).** Un icono por tipo de dato, el mismo en todas las pantallas:

| Dato | Icono lucide | Dónde |
| :-- | :-- | :-- |
| Duración de la sesión | `Clock` | chips, tarjetas, línea de precio |
| Clase en vivo 1 a 1 | `Video` | chips, tarjetas, línea de precio |
| Nivel | `BarChart3` (barras) | chips, tarjetas, estadísticas |
| Idioma | `Globe` | chips, estadísticas |
| Confirmación inmediata | `Zap` (rayo) | chips, tarjetas, paso 2 de «Cómo funciona», línea bajo el CTA |
| Sesiones impartidas | `GraduationCap` | estadísticas del tutor |
| Tutor desde | `Calendar` | estadísticas del tutor |
| Preguntar al tutor | `MessageCircle` | botón «Pregúntale a…» y botón-icono |
| Ver perfil | `Eye` | botón-icono en «Tu tutor» |
| Reservar (móvil) | `Calendar` | botón-icono de la franja fija |
| Compartir | `Share2` | icono junto a nombre/precio |
| Verificado | check dentro de círculo `#fe6a00` | junto al nombre |

**G-03 · Confirmación inmediata es POR MENTORÍA.** Sale de `products.auto_accept_bookings` (migración `20260817180000`), nunca del perfil. Se enseña en: chip del hero de la mentoría, distintivo en cada tarjeta de mentoría («⚡ Confirmación inmediata» o «✓ El tutor confirma en 24 h»), paso 2 de «Cómo funciona» y línea bajo el CTA del panel («⚡ Se confirma al instante al pagar»). En el perfil del tutor **no hay** chip en el hero; en su panel la línea aparece solo cuando se elige una mentoría y dice lo que corresponde a esa.

**G-04 · Calendario del panel de reserva** (`booking-panel.tsx`):
- Cabeceras de **dos letras**: `Do Lu Ma Mi Ju Vi Sá` (hoy `D L M M J V S`, con «M M» ambiguo). La semana sigue empezando en domingo.
- **Flechas de mes** `‹ septiembre de 2026 ›` centradas sobre la rejilla; cargan los huecos del mes elegido (hoy solo se pinta un mes y no se puede agendar el siguiente). Los huecos ya se consultan por rango.
- Celdas de 27 px en escritorio dentro del panel compacto (§G-05); 30 px en móvil.
- **Próximo horario en una línea** sobre el calendario: `📅 Próximo: jue 11 · 10:00   Elegir →` (fondo `#eaf3ff`, borde `#cfe4ff`). Al pulsar «Elegir» deja día y hora marcados. No se repite en ningún otro sitio de la página.

**G-05 · Panel de reserva fijo y compacto (escritorio).** Hero y cuerpo comparten una rejilla `minmax(0,1fr) 348px` con hueco de 40 px; el panel ocupa la columna derecha **desde la primera fila**, arranca 69 px bajo el borde superior del hero (a la altura del nombre / título) y **solo el cuadro `aside` es `position: sticky; top: 16px`** durante todo el recorrido. En la mentoría, la portada va encima del panel y **se va con el scroll**; solo el cuadro queda fijo. Compacto para verse entero en 800 px de alto: sin línea de ayuda bajo el título, calendario de 27 px, campos de 36 px, márgenes de 10–12 px, botón de 46 px. La política de cancelación dentro del panel es un `<details>` **cerrado** de una línea («Política de cancelación ⌄»). El hero limita su texto a la columna izquierda.

**G-06 · Preguntar al tutor.** Texto **«Pregúntale a {nombre}»** (antes «Escribir a…»), botón primario naranja `#fe6a00` con icono `MessageCircle`. A su lado, el tiempo de respuesta como línea de apoyo: **«Suele responder en unas horas · Sin compromiso»** (el texto es el que ya devuelve `responseTimeLabel`; sin dato, «Resuelve tus dudas antes de reservar»). Mismo componente `ContactTutor`: para anónimos sigue abriendo el alta. Variante **solo icono** (40 px) en la tarjeta «Tu tutor» y en la franja móvil, con `aria-label` y `title`.

**G-07 · Compartir.** Icono `Share2` sin texto, con `aria-label` «Compartir perfil» / «Compartir mentoría». Cliente: `navigator.share({title, text, url})` y, si no existe, copiar el enlace al portapapeles con toast «Enlace copiado». Posición: junto al botón de preguntar (tutor escritorio), junto al check del nombre (tutor móvil), al final de la fila de chips (mentoría escritorio), junto a las estrellas (mentoría móvil). Va acompañado de **metadatos** para que el enlace tenga vista previa (§5.6).

**G-08 · Miga de pan.** Incluye la categoría: `Inicio / Tutores / Matemáticas / Valentina Ríos` y `Inicio / Mentorías / Matemáticas / Cálculo I…` (categoría principal = la de más mentorías del tutor; en la mentoría, su primera categoría). En móvil, 11 px al 80 % de blanco, una línea con elipsis.

**G-09 · Botones-icono** (40–46 px, radio 8–10 px) siempre con `aria-label` y `title`; naranja para la acción principal (preguntar en la tarjeta del tutor, reservar en la franja móvil), borde 1–1.5 px para la secundaria.

**G-10 · Nada envuelve donde se dice «una línea».** Título y meta del tutor, títulos y textos de apoyo de las estadísticas, chips y línea de precio llevan `white-space: nowrap` + `text-overflow: ellipsis`. Consecuencia para el editor del perfil: **limitar la meta del tutor a unos 40 caracteres** y avisar al tutor si se pasa.

**G-11 · Vistas «Hoy»** del artifact y capturas `-hoy.png` reflejan `main`; no son objetivo. Lo que no aparece en esta lista se conserva como está.

---

## 1 · Perfil del tutor · escritorio — `src/app/(public)/tutors/[id]/page.tsx`

**Hero (azul de marca, texto blanco), columna izquierda:**
1. Miga (G-08).
2. Avatar **120 px** (iniciales si no hay foto) a la izquierda; a la derecha:
   - Nombre 28 px bold + píldora naranja **«Tutor verificado»** con `BadgeCheck` y `title` «Identidad y titulación revisadas por Enséñame Ya · {mes año}» (ver DP-31.4).
   - **`★★★★★ 4.9 · 23 reseñas`** (G-01), 14 px, tooltip «Media de N reseñas de alumnos que terminaron una mentoría».
   - **Título** 17 px semibold y **meta** 14 px en dos líneas separadas, una línea cada una (G-10). Salen del único campo `headline` partiéndolo por el primer « · »; sin separador, todo es título y no hay meta.
   - Fila: botón **«Pregúntale a Valentina»** (naranja, 46 px) · icono compartir 46 × 46 (borde blanco al 45 %) · **«Suele responder en unas horas · Sin compromiso»** (G-06).
3. **Se eliminan** del hero: la lista de metadatos («Nivel Intermedio · 3 mentorías»), cualquier chip, el vídeo (descartado) y los enlaces del tutor.

**Columna izquierda del cuerpo (en este orden):**
1. **Sobre mí** → tira de **cuatro estadísticas** (rejilla de 4 columnas iguales, 24 px de hueco, filetes arriba y abajo, sin cajas), cada una de **exactamente tres líneas**: icono en círculo `#eaf3ff` de 30 px · título 13.5 px bold · apoyo 12 px gris `#6b6b6b`, con `title` explicativo:

   | Icono | Título | Apoyo | Fuente |
   | :-- | :-- | :-- | :-- |
   | `GraduationCap` | `148` | sesiones impartidas | **DP-31.1** |
   | `Globe` | `Español · Inglés` | idiomas | `products.language` de sus mentorías activas, únicos |
   | `BarChart3` | `2 niveles` | básico e intermedio | `products.level` de sus mentorías activas, únicos |
   | `Calendar` | `Marzo 2026` | tutor desde | `tutor_profiles.approved_at` (ya existe; añadir al `select`) |

   Debajo, la bio completa (15 px). **Sin bio, la sección no se pinta** (fuera el «aún no escribió su biografía»). **Sin enlaces** del tutor: `socials` es para verificación.
2. **Lo que enseño** → cada categoría con subtítulo `2 mentorías · desde US$ 15` (mínimo `price_amount` de esa categoría) y a la derecha chips grises con los **niveles e idiomas de las mentorías de esa categoría** (ya no el nivel del tutor repetido).
3. **Mentorías de Valentina** → `ProductCard` con la nueva fila de datos (§6 · `product-card.tsx`): `⏱ 60 min · 📹 En vivo 1 a 1 · 📶 Intermedio` con icono, sin idioma; debajo, categoría a la izquierda y **tipo de confirmación** a la derecha (G-03). Nota de paquete: **`4 sesiones · US$ 15 c/u`** (sustituye a «Equivale a US$ 15,00 por sesión · 4 sesiones»).
4. **Reseñas** → título «Reseñas» con apoyo «de alumnos que terminaron una mentoría con Valentina»; resumen (nota 44 px, estrellas, histograma); **3 reseñas visibles**, cada una con una línea de contexto azul con el **título de la mentoría** (§5.4); botón **«Ver las 23 reseñas»** (el número sale de `rating_count`, no de la lista cargada) que despliega el resto.
5. Tarjeta de **Política de cancelación** (como hoy).

**Columna derecha: panel** (G-04, G-05): título **«Reserva con Valentina»** (sustituye a «Reserva estas mentorías»; V-5 queda anulado en esta página), sin línea de ayuda; línea «Próximo…»; flechas de mes; selects «Elige la mentoría» / «Horarios disponibles»; «Precio —»; CTA «Agregar al carrito»; nota «Pago protegido · Cancela con 24 h y recibe el 100 %». Con mentoría elegida, la línea de confirmación según G-03.

---

## 2 · Perfil del tutor · móvil (< 1024 px)

Orden de secciones **igual que hoy** (fijado por Verónica el 3-sep): Sobre mí → Lo que enseño → Mentorías → Reserva → Política → Reseñas. Cambia el hero y el contenido de cada bloque:

**Hero tipo perfil social, todo centrado:**
- Miga 11 px (G-08).
- Avatar **88 px** centrado; nombre 22 px con **check naranja de 22 px** (sin la píldora de texto) y, a su derecha, **compartir** en círculo de 22 px con borde blanco.
- `★★★★★ 4.9 · 23 reseñas` centrado.
- Título 15 px semibold; meta 13 px **a dos líneas** (`-webkit-line-clamp: 2`), máx. 300 px de ancho.
- Fila de dos botones a **50 %** cada uno: **«Reserva con Valentina»** (naranja, icono `Calendar`, ancla a `#reservar`) · **«Pregúntale»** (borde blanco 1.5 px, icono `MessageCircle`). Debajo, centrado, «Suele responder en unas horas · Sin compromiso».

**Cuerpo:** estadísticas en **rejilla de 2 columnas** dentro de «Sobre mí» (mismas cuatro, tres líneas); bio completa; «Lo que enseño» con subtítulos y chips; mentorías en **fila horizontal desplazable** (tarjetas de 190 px con precio y tipo de confirmación); panel «Reserva con Valentina» con calendario completo, flechas de mes y línea «Próximo…»; política; reseñas con resumen, 3 visibles y «Ver las 23 reseñas».

---

## 3 · Ficha de mentoría · escritorio — `src/app/(public)/products/[id]/page.tsx`

**Hero (columna izquierda de la rejilla, G-05):**
1. Miga con categoría (G-08).
2. H1 30 px.
3. **`★★★★★ 4.8 · 12 reseñas`** de esta mentoría (§5.3), sin decir de qué son.
4. `outcome` 14.5 px.
5. **Chips en UNA línea** (30 px, 12.5 px, sin envolver): `📶 Nivel intermedio` · `🌐 Español` · `⚡ Confirmación inmediata` (solo si `auto_accept_bookings`; chip naranja claro `#fff4ec`/`#c4470a`) · icono **compartir** 30 px al final. **Fuera** los chips «1 × 60 min», «En vivo 1 a 1» y «60 min por sesión» (redundantes).
6. **Línea de precio:** `US$ 18,00` 26 px bold · `por sesión` · `⏱ 60 min` · `📹 1 a 1` (icono + dato, sin frase). En paquetes: `US$ 60,00 · paquete de 4 sesiones · ⏱ 60 min · 📹 1 a 1`. **Sin** «Próximo horario» aquí (vive solo en el panel).

**Columna derecha:** **portada** 16:9 (radio 16) encima del panel, se va con el scroll; **panel** «Reserva esta mentoría» (título se conserva), línea «Próximo…», flechas de mes, «Horarios disponibles», «Total de la sesión», CTA «Reservar mentoría YA» / «Reservar paquete YA», línea «⚡ Se confirma al instante al pagar» (G-03), nota «Pago protegido · Cancela con 24 h y recibe el 100 %», **política plegada** (G-05).

**Columna izquierda del cuerpo (orden):**
1. **Qué vas a conquistar** → párrafos como párrafos y viñetas como ticks: `toBullets` solo trata como ítem las líneas que empiezan por `-`, `•` o `*`; el resto es prosa (hoy dos párrafos salen como dos ticks). **La portada ya no abre esta columna.**
2. **Qué necesitas para la sesión** (igual que hoy).
3. **Cómo funciona** → tres tarjetas **solo con título** y número grande (círculo 44 px, cifra 20 px) a la izquierda: `1 Eliges día y hora` · `⚡ Se confirma al instante` (o `2 El tutor confirma en 24 h` si no auto-acepta) · `3 Entras desde tu panel`. Sin el párrafo `HOW_IT_WORKS`.
4. **Tu tutor** → foto 56 px, nombre 16 px + **check naranja** (sin «· Tutor verificado» en texto), `★★★★★ 4.9 · 23 reseñas` del tutor; **sin** titular ni estadísticas. A la derecha, dos **botones-icono** de 40 px: `MessageCircle` naranja (= «Pregúntale a Valentina», abre `ContactTutor`) y `Eye` con borde (= «Ver perfil»); debajo, «Suele responder en unas horas».
5. **Reseñas de esta mentoría** → resumen + 2 visibles + **«Ver las 12 reseñas»** + enlace **«Ver las 23 reseñas de Valentina en su perfil →»**. Sin reseñas propias todavía: se muestran las del tutor con el rótulo «Reseñas del tutor».
6. **Otras mentorías de Valentina** → dos `ProductCard` compactas (misma fila de datos con icono y tipo de confirmación). Va **después de las reseñas y antes de las FAQ**.
7. **Preguntas frecuentes** → dos grupos con rótulo en mayúsculas pequeñas: **«De Valentina, sobre esta mentoría»** (`products.faqs`) y **«Sobre la plataforma»** (genéricas). De las genéricas **se retira la cuarta** («política de cancelación», ya está en el panel) y la de conocimientos previos termina en «Si tienes dudas, escríbele antes de reservar: el botón está en “Tu tutor”».

---

## 4 · Ficha de mentoría · móvil (< 1024 px)

**Hero centrado:**
- Miga 11 px.
- **Portada 220 × 124** (radio 14, sombra) centrada encima del título.
- H1 22 px; **`★★★★★ 4.8 · 12 reseñas` + compartir** justo debajo del título.
- `outcome` a **dos líneas** con elipsis; **se expande al tocar el propio texto** (sin botón «Ver más»; `role="button"`, `aria-expanded`).
- Chips en una línea: `📶 Intermedio` · `⚡ Confirmación inmediata` (**sin idioma** en móvil: no cabe).
- **Franja fija** de una fila, sobre azul: izquierda `US$ 18,00` (22 px) y debajo `por sesión · ⏱ 60 min · 📹 1 a 1`; derecha dos **botones-icono 46 px**: `Calendar` naranja (= reservar, ancla `#reservar`) y `MessageCircle` con borde (= preguntar). Es `position: sticky; top: 0` dentro de una zona que abarca desde el hero hasta justo antes del panel, con sombra `0 8px 20px rgba(0,40,90,.18)`; **se suelta al llegar al calendario**. No hay ninguna otra barra fija.

**Orden del cuerpo:** Qué vas a conquistar → Qué necesitas → **Cómo funciona** (tres filas, número 38 px) → **Panel de reserva** (calendario completo, flechas, política plegada) → **Tu tutor** (foto a la izquierda; nombre con check, estrellas y tiempo de respuesta a la derecha; debajo dos botones al 50 %: «Pregúntale» naranja y «Ver perfil» con ojo) → **Reseñas de esta mentoría** → **Otras mentorías de Valentina** (fila desplazable) → **Preguntas frecuentes** (grupos; solo la primera abierta).

Se implementa con `max-lg:order-*` sobre la misma rejilla, sin duplicar DOM, como ya hace el perfil del tutor.

---

## 5 · Cambios funcionales y de consulta (`src/lib/catalog/queries.ts` y afines)

| # | Qué | Cómo | Datos |
| :-- | :-- | :-- | :-- |
| 5.1 | **Confirmación por mentoría** | `getTutorDetail` y `getProductDetail` seleccionan `products.auto_accept_bookings`; `ProductCardData` gana `autoAccept: boolean` | columna existente |
| 5.2 | **Estadísticas del tutor** | `getTutorDetail` añade `approved_at`; niveles e idiomas se derivan de sus productos activos (`level`, `language`, ya en el `select` de productos). Sesiones impartidas: **DP-31.1** | `approved_at` existe |
| 5.3 | **Reseñas por mentoría** | Nueva `listProductReviews(productId)` = mismo `select` que `listTutorReviews` con `.eq("product_id", id)`; media y conteo calculados en la consulta (`count: "exact"`, límite 50 para la lista). `reviews.product_id` existe e indexado desde EP-09 | sin cambios |
| 5.4 | **Contexto de cada reseña** | `listTutorReviews` embebe `products(title)` por `product_id` para la línea «Cálculo I sin miedo…» bajo el autor | sin cambios |
| 5.5 | **«Ver las N reseñas»** | El contador usa `tutor_profiles.rating_count` (o el `count` de 5.3); la lista muestra 3 (tutor) / 2 (mentoría) y el botón despliega el resto (estado de cliente o `?reseñas=todas`) | sin cambios |
| 5.6 | **Metadatos** | `generateMetadata` en ambas páginas: `description` (`headline` del tutor / `outcome` de la mentoría), `openGraph` con `images` (avatar / portada) y `type`, `alternates.canonical`; `metadataBase` en `src/app/layout.tsx`; JSON-LD `Person` (tutor, con `aggregateRating`) y `Course`/`Product` (mentoría) en un `<script type="application/ld+json">` | sin cambios |
| 5.7 | **Compartir** | Componente cliente `ShareButton` (G-07) | sin cambios |
| 5.8 | **Consultas en paralelo** | `products/[id]/page.tsx`: `getProductDetail`, reseñas y `getViewerTimezone` en un `Promise.all`, como ya hace el perfil (Doc 30) | sin cambios |
| 5.9 | **`toBullets`** | Solo líneas con guion/viñeta son ítems; párrafos sueltos se pintan como `<p>` | sin cambios |
| 5.10 | **Título y meta del tutor** | `headline.split(" · ", 2)`; hoy es un solo campo. Límite recomendado de la meta: 40 caracteres, validado en el editor del perfil | sin cambios |
| 5.11 | **Meses en el calendario** | `BookingPanel` acepta `month` (query `m=YYYY-MM`) y las flechas navegan con `scroll: false`; los huecos se piden para ese mes | sin cambios |
| 5.12 | **Panel compacto y fijo** | `BookingPanel` gana `compact` y el título por prop (`title="Reserva con Valentina"`); la rejilla hero+cuerpo y el `sticky` del `aside` viven en las páginas | sin cambios |
| 5.13 | **Política plegada** | `CancellationPolicy` gana `variant="folded"` (`<details>`) para el panel de la mentoría | sin cambios |
| 5.14 | **Nota de paquete** | `perSessionLabel` devuelve `4 sesiones · US$ 15 c/u` | sin cambios |
| 5.15 | **Franja fija móvil** | Zona `relative` que envuelve hero-precio + secciones hasta el panel; la franja es `sticky top-0` dentro de ella (sin `overflow: hidden` en ningún ancestro; usar `overflow: clip` si hace falta recortar) | sin cambios |

---

## 6 · Archivos que se tocan

| Archivo | Cambio |
| :-- | :-- |
| `src/app/(public)/tutors/[id]/page.tsx` | §1 y §2: hero, estadísticas, Lo que enseño, reseñas, rejilla hero+cuerpo, `sticky`, metadatos |
| `src/app/(public)/products/[id]/page.tsx` | §3 y §4: hero con chips y precio, portada sobre el panel, pasos, Tu tutor, reseñas por mentoría, orden, FAQ, franja móvil, metadatos, `Promise.all`, `toBullets` |
| `src/components/catalog/booking-panel.tsx` | G-04 (cabeceras, flechas de mes, línea «Próximo…»), G-05 (`compact`, `title`), línea de confirmación por mentoría |
| `src/components/catalog/product-card.tsx` | fila de datos con icono (duración · en vivo · nivel, sin idioma) + tipo de confirmación; nota de paquete |
| `src/components/catalog/tutor-reviews.tsx` | contexto (título de la mentoría), «Ver las N reseñas», variante compacta para móvil |
| `src/components/catalog/cancellation-policy.tsx` | `variant="folded"` |
| `src/components/chat/contact-tutor.tsx` | texto «Pregúntale a {nombre}», variante `iconOnly`, línea de tiempo de respuesta al lado |
| `src/components/catalog/share-button.tsx` (nuevo) | G-07 |
| `src/lib/catalog/queries.ts` | §5.1–5.5 |
| `src/lib/catalog/format.ts` | §5.14 |
| `src/app/layout.tsx` | `metadataBase` |
| Editor del perfil del tutor | límite de 40 caracteres en la meta (§5.10) |

---

## 7 · Textos exactos

| Dónde | Texto |
| :-- | :-- |
| Botón de preguntar | `Pregúntale a Valentina` (móvil, en fila: `Pregúntale`) |
| Línea de apoyo | `Suele responder en unas horas · Sin compromiso` (sin dato: `Resuelve tus dudas antes de reservar`) |
| Botón de reserva del hero móvil (tutor) | `Reserva con Valentina` |
| Botón de reserva del hero móvil (mentoría) | `Reservar mentoría` (icono en la franja fija) |
| Título del panel (tutor) | `Reserva con Valentina` |
| Título del panel (mentoría) | `Reserva esta mentoría` |
| Línea de próximo horario | `Próximo: jue 11 · 10:00` + `Elegir →` |
| Confirmación (mentoría con auto-aceptación) | chip `Confirmación inmediata` · paso `Se confirma al instante` · bajo el CTA `⚡ Se confirma al instante al pagar` |
| Confirmación (sin auto-aceptación) | tarjeta `El tutor confirma en 24 h` · paso `El tutor confirma en 24 h` |
| Estadísticas | `148 / sesiones impartidas` · `Español · Inglés / idiomas` · `2 niveles / básico e intermedio` · `Marzo 2026 / tutor desde` |
| Lo que enseño | `2 mentorías · desde US$ 15` · `1 mentoría · paquete de 4 sesiones` |
| Nota de paquete | `4 sesiones · US$ 15 c/u` |
| Línea de precio (mentoría) | `US$ 18,00` · `por sesión` · `60 min` · `1 a 1` |
| Reseñas (tutor) | `Reseñas` + `de alumnos que terminaron una mentoría con Valentina` · `Ver las 23 reseñas` |
| Reseñas (mentoría) | `Reseñas de esta mentoría` · `Ver las 12 reseñas` · `Ver las 23 reseñas de Valentina en su perfil →` |
| Cómo funciona | `Eliges día y hora` · `Se confirma al instante` / `El tutor confirma en 24 h` · `Entras desde tu panel` |
| Grupos de FAQ | `De Valentina, sobre esta mentoría` · `Sobre la plataforma` |
| FAQ conocimientos previos | `…Si tienes dudas, escríbele antes de reservar: el botón está en «Tu tutor».` |
| Nota del panel | `Pago protegido · Cancela con 24 h y recibe el 100 %` |
| Compartir | `aria-label` `Compartir perfil` / `Compartir mentoría`; toast `Enlace copiado` |

---

## 8 · Decisiones pendientes (no implementar sin respuesta)

| ID | Pregunta | Afecta |
| :-- | :-- | :-- |
| **DP-31.1** | **Sesiones impartidas.** De dónde sale la cifra: `count(sessions where tutor_id = X and status = 'completed')` (SUPUESTO; el enum real de `session_status` manda) expuesto como columna en la vista `tutors_public` o como RPC pública. Mientras no exista, la estadística no se pinta y la tira queda con tres | Perfil del tutor (estadísticas) · «Tu tutor» |
| **DP-31.4** | **Insignia «Tutor verificado».** Hoy sale de `approval_status = approved`. ¿La aprobación exige `identity_verification_status = verified`? Si no, la insignia debe condicionarse a ese estado y el tooltip a su fecha | Ambas fichas |

Cerradas durante la revisión: **DP-31.2** (vídeo de presentación: **descartado**) y **DP-31.3** (título de la mentoría en cada reseña: resuelto con `reviews.product_id`).

**Supuestos que el desarrollador debe confirmar:** el tutor tiene una única categoría «principal» para la miga (la de más mentorías); el histograma de reseñas se calcula sobre las cargadas (50) y el conteo sobre `rating_count`; los tiempos de respuesta siguen las franjas de `responseTimeLabel`.

---

## 9 · Cómo entregar

Un PR por bloque, en este orden, cada uno con captura en dev junto a la de `capturas/` para comparar:

1. **Componentes compartidos:** `booking-panel.tsx` (G-04, G-05), `product-card.tsx`, `contact-tutor.tsx`, `cancellation-policy.tsx`, `share-button.tsx`, `format.ts`, `queries.ts` (§5).
2. **Perfil del tutor** escritorio + móvil (§1, §2).
3. **Ficha de mentoría** escritorio + móvil (§3, §4).
4. **Metadatos y JSON-LD** (§5.6) en las dos páginas.

Comprobar en cada PR: tutor con y sin bio, con una y con varias mentorías, mentoría con y sin auto-aceptación, con y sin reseñas propias, paquete y sesión suelta; anchos 390, 768 y 1440; que **solo** el cuadro de reserva queda fijo en escritorio y **solo** la franja de precio en móvil; que nada envuelve donde se dice «una línea».
