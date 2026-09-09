# DOC 25 — Correcciones móviles del correo de Verónica (3-sep-2026)

> **Qué es esto.** Verónica revisó la versión móvil de `dev` en un iPhone (viewport 390x844) y
> mandó el 3-sep-2026 «Correcciones Versión Mobile - Enséñame Ya»: 33 capturas y 45 puntos en 10
> pantallas. Este documento es la **trazabilidad punto a punto**: qué pidió (literal), cómo se leyó,
> qué se hizo y con qué evidencia. Es el mismo formato que `docs/22-LISTA-VERONICA-21AGO.md`, y por
> lo mismo: una lista suya se cruza con el código antes de convertirla en trabajo
> ([[listas-veronica-son-consolidadas]]).

| Campo | Valor |
| :-- | :-- |
| **Documento** | 25 — Correcciones móviles (correo de Verónica del 3-sep) |
| **Fecha** | 2026-09-08 |
| **Fuente** | Correo «Correcciones Versión Mobile - Enséñame Ya», Verónica Pérez → Jose y Emilio, 3-sep-2026 19:55 (VET) |
| **Referencia de diseño** | Figma «Mobile y Tablet» (`e2Av6H2GHVvz6g9mCKPwVV`), frames a 390 — renderizados por secciones con la REST API (procedimiento en `docs/24-RESPONSIVE-FIGMA.md` §24.8) |
| **Reglas que mandan** | Doc 24 §24.2: R1 escritorio intacto · R2 no borrar funcionalidad · R3 los comentarios ganan al Figma · R4 «mentoría» |
| **Verificación** | Panel del navegador a 375 / 390 / 768 / 1280, midiendo (`getBoundingClientRect`, `scrollWidth`, líneas). ⚠️ Chrome headless **no vale** por debajo de ~500 px: impone un ancho mínimo de ventana y recorta un layout más ancho (medido) |

---

## 25.0 · La conclusión, en cinco frases

1. **De 45 puntos, 43 son de maquetación y se resuelven con cuatro primitivas**, no con 45 parches:
   CTA a ancho completo, buscador con el botón debajo, tira de chips con scroll (`scroll-strip`) y
   filtros como píldoras desplegables (`FilterPills`). Verónica describe la misma cosa con palabras
   distintas en cada pantalla («alargar y centrar», «bajar el buscar», «slider», «estilo Shein»).
2. **Dos puntos no eran fallos.** «No hay selector de página» en Explorar tutores y en Categoría: el
   `Pager` existe y funciona; con 8 tutores y 2 productos y `PAGE_SIZE = 12` hay una sola página y no
   se pinta. No se inventan páginas para que se vea un «1».
3. **Cuatro son bugs de verdad**, no de diseño: el salto al principio de la página al elegir
   categoría, pestaña o página; el `<select>` de documentos con placeholder elegible; la cabecera del
   paso 2 rota palabra por palabra; y el switch Aprender/Enseñar que marcaba «Aprender» en /account.
4. **Lo que Verónica veía en /account lo explica su estado**, no un fallo del rol: completó el
   onboarding, así que tiene `tutor_profiles` pero **no el rol `tutor`**, que solo se concede al
   aprobar (US-1101). Por eso «Quiero enseñar» seguía saliendo. Ahora la tarjeta distingue tres
   estados (sin perfil / en revisión / aprobado).
5. **La píldora «stripe ›» del checkout es el ayudante de modo prueba de stripe.js** (claves
   `pk_test`): no sale en producción con claves live. Se le dio aire al botón de pagar de todas formas.

---

## 25.1 · Punto a punto

Leyenda de estado: ✅ hecho y medido · ➖ no era un fallo (explicado) · ⏳ pendiente.
La columna «Evidencia» se rellena con lo medido en el navegador al cerrar cada pantalla.

### Home (P01)

| # | Lo que pide (literal) | Lectura | Estado | Evidencia (medida a 390) |
| :-- | :-- | :-- | :-- | :-- |
| H1 | «Hero tratar de que no pase a 4 líneas (reducir tamaño)» | A 390 el h1 iba a 30px/36 y 147 px de alto = 4 líneas. Se elige el mayor tamaño con el que TODAS las palabras rotatorias caben en 3 líneas a 375 y a 390 | ✅ | 20 px/30, alto 92 = **3 líneas**. Es el máximo posible con las ocho palabras: a 22 px «emprendimiento» ya son 4 (ver la decisión de contenido más abajo) |
| H2 | «Eliminar 2 líneas en categorías - en su lugar hacerlo slider si es necesario» | Chips de icono del hero en una sola fila con scroll horizontal (Figma P01) | ✅ | Una fila: los 10 chips de 44 px comparten borde superior, empiezan en `x20` y la tira mide 552 de ancho para 390 de hueco, así que el último asoma cortado |
| H3 | «Alargar y centrar botón» (Explorar tutores YA) | CTA a ancho completo, 46 px, por debajo de `sm` | ✅ | `{x:20, w:350, h:46}` |
| H4 | «En diseño está como slider» (Tutores destacados) | Carrusel horizontal con anclaje, tarjeta de 220 px, la siguiente asoma (Figma P01) | ✅ | 4 tarjetas de 220 px desde `x20`; tira de 962 para 390 de hueco |
| H5 | «Slider también» (Mentorías destacadas) | Ídem con tarjeta de 240 px; y «Ver todos →» deja de partirse en tres líneas | ✅ | 4 tarjetas de 240 px desde `x20`; tira de 1042. La cabecera cabe en una línea con el enlace al lado |
| H6 | «Disminuir tamaño de título para que cubra 2 líneas» (¿Eres un crack…?) | Título de bloque feature a ≈22 px en móvil (Figma) | ✅ | 22 px/1,35 → 2 líneas a 375 y a 390 |
| H7 | «Botón centrado y alargado» (Quiero enseñar YA) | CTA a ancho completo | ✅ | `{x:20, w:350, h:46}`, etiqueta centrada |
| H+ | — | El Figma del hero pone «Buscar» debajo del input; en su captura el placeholder salía cortado. Se aplica el mismo patrón que pide en las otras cuatro páginas | ✅ | Input y botón apilados dentro de la tarjeta blanca; el desplegable de sugerencias sigue midiéndose en vivo y cae bajo la caja |

### ¿Cómo funciona? (P03) — «Sobre nosotros: no comentarios, todo excelente»

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| C1 | «Estos espacios en las imágenes, favor corregir» | Las franjas venían dentro del propio JPG | ✅ | Recortado: `how-alumno.jpg` a 474×480. En móvil la caja pasa a apaisada 350×220, como el Figma. ⚠️ Ver el aviso de la caché de imágenes de dev más abajo |
| C2 | «Mismo comentario» | Ídem, foto de la tutora | ✅ | Recortado: `how-tutor.jpg` a 480×460, misma caja apaisada |
| C3 | «En cuadro señalado falta información que está en diseño y botón de quiero enseñar (ambos botones centrados y alargados)» | El botón suelto «Regístrate YA» se sustituye en móvil por el bloque del Figma: «Empieza hoy: aprende o enseña» + párrafo + «Crear cuenta gratis» / «Quiero enseñar» a ancho completo. En escritorio no cambia nada (R1) | ✅ | Los dos botones a `{x:20, w:350, h:46}` apilados con 12 px entre ellos; a 375 miden 335. El bloque solo se monta por debajo de `lg` |

### Explorar tutores (P04)

| # | Lo que pide | Lectura | Estado | Evidencia (medida a 390 salvo nota) |
| :-- | :-- | :-- | :-- | :-- |
| T1 | «Bajar botón de buscar» | Botón debajo del input, ancho completo (Figma P04) | ✅ | Input `x20 y452 350×46 r10`; botón `x20 y512 350×47 r10`, 15 px/600, 14 px bajo el input (Figma: input 46, hueco 14, botón 47). A 375 el botón mide 335. A 1280 idéntico a producción al decimal |
| T2 | «Sustituir iconos por nombres de las categorías y hacerlo slider» | Chips de texto (píldora blanca) en una fila con scroll | ✅ | `<ul>` 390×48 con sangrado −20/+20, `scrollWidth` 1122, 9 píldoras en UNA fila de 40 px; «Ciencias» asoma cortada de 378 a 390; página sin scroll horizontal. Antes: 96 px en dos filas de iconos |
| T3 | «…dropdowns en slider uno al lado del otro y al seleccionar se abre categoría, inversión por sesión, valoración, disponibilidad, idiomas - estilo shein» | `FilterPills` en móvil; el panel lateral se queda para escritorio | ✅ | Panel lateral `display:none`; tira 390×48 (`scrollWidth` 807) con las cinco píldoras de 40 px; abrir «Categoría» despliega 10 filas de 44 px debajo, elegir navega y cierra. «Limpiar» sale el primero para que se vea sin desplazar |
| T4 | «No hay opción para cambio de página» | ➖ El `Pager` existe; hay 8 tutores y `PAGE_SIZE = 12` → una página. Queda listo con ancla a la sección para cuando haya más | ➖ | `Pager` devuelve `null` a propósito (`page <= 1 && !hasMore`). El mecanismo se probó en `/classes`, que sí tiene 2 páginas |

### Explorar mentorías (P05)

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| M1 | «Bajar botón y centrar y alargar» | Como T1 | ✅ | Input `x20 y429,8 350×46`; botón `x20 y489,8 350×47`, hueco 14. A 1280 idéntico a producción |
| M2 | «Mismo comentario que en explorar tutores (…ocupa demasiado espacio)» | Como T3 | ✅ | Panel lateral oculto; tira de seis píldoras (`scrollWidth` 749): Categoría · Tipo de mentoría · Nivel · Idioma · Precio · Duración |
| M3 | «Bien selector de página pero al oprimir te lleva al inicio de toda la página en lugar del inicio de la sección» | `Pager` con ancla `#resultados` y `scroll-mt` bajo la cabecera sticky | ✅ | Tocar «2» desde el pie: `scrollY` 5603 → 552 y el borde superior de los resultados queda en 175,8 px, justo debajo de la cabecera sticky de 173. Volver a «1»: 1998,5 → 552 |

### Categoría (P06)

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| K1 | «Me gusta donde está ubicado el buscar (en diseño va abajo centrado - se puede ajustar así para que vaya acorde a otras páginas)» | Botón debajo, ancho completo | ✅ | Input `{x:20, w:350, h:46}` e inmediatamente debajo el botón `{x:20, w:350, h:46}` |
| K2 | «Eliminar 2 líneas, hacer slider categorías» | Chips de icono en una fila con scroll (aquí se quedan los iconos: no pidió texto) | ✅ | Una sola fila, con desplazamiento horizontal |
| K3 | «La pantalla brinca cuando se elige una categoría» | `scroll={false}` en los chips | ✅ | Con la página a 900 px de scroll, tocar «Idiomas» navega a esa categoría y la página **se queda en 900** |
| K4 | «Subir: ordenar» | «Ordenar» en la misma fila que Productos/Tutores, a la derecha (Figma P06); en móvil el rótulo se acorta para caber a 375 | ✅ | Pestañas y «Ordenar» comparten fila. El valor sigue anunciándose a los lectores de pantalla aunque no se vea |
| K5 | «Opciones solo una línea en slider y dropdown» | `FilterPills` en móvil con los mismos datos; la fila de `<details>` se queda para escritorio | ✅ | Seis píldoras en una sola fila desplazable |
| K6 | «No hay selector de página» | ➖ Como T4: Matemáticas tiene 2 productos → una página | ➖ | |

### Perfil de tutor (P07) — «Página de mentoría y carrito: sin comentario, excelente»

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| P1 | «Subir texto tutor verificado al lado del nombre» | Nombre e insignia en la misma línea; en móvil la insignia dice «Verificado» (Figma P07) | ✅ | 390: `h1` en `x96 y240` e insignia en `x254` centradas en la misma línea. 375: la fila acaba en 352 de 355 disponibles con 23 px de holgura tras quitar el icono por debajo de `sm`, como el Figma. Avatar 64 px en `x20` |
| P2 | «Información de tutor que salga desde la izquierda (espacio desaprovechado)» | Valoración/nivel/mentorías/respuesta a ancho completo desde x=20, fuera de la columna del avatar; sin «•» huérfanos | ✅ | Metadatos `{x:20, w:350}` a 390, `{x:20, w:335}` a 375, `{x:32, w:689}` a 768. Los dos puntos separadores caen a mitad de línea (`x135` y `x255`); el de la línea de respuesta no se pinta en móvil |
| P3 | «Mover botón escribir a tutor a izquierda también» | «Escribir a X» alineado al borde izquierdo, debajo | ✅ | 390: `{x:20, w:350, h:52}`; 375: `{x:20, w:335}`. Desde `sm` vuelve al botón de hoy (181×32) |
| P4 | «Subir calendario antes de reseñas, debajo de descripción, lo qué aprenderás y mentorías» | Orden móvil: Sobre mí → Lo que enseño → Mentorías → Reserva → Política → Reseñas (escritorio a dos columnas, intacto) | ✅ | Valentina a 390: Sobre mí 471 → Lo que enseño 674 → Mentorías 936 → panel de reserva → Política 2926 → Reseñas 3151. El `#reservar` del carrito sigue aterrizando en el panel |
| P5 | «Finalizar página con reseñas» | Reseñas es lo último | ✅ | Reseñas es el último bloque en 375, 390 y 768. A 1280 la columna izquierda conserva el orden publicado |

### Checkout (AL05) — «Excelente; único comentario»

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| X1 | «el botón de stripe sale encima del botón de pago (confunde un poco)» | Identificada: es el distintivo de **modo prueba** de stripe.js. Aire inferior en móvil para que no tape «Pagar» | ✅ | Es un iframe fijo de stripe.js (`elements-inner-easel`), 123×72 px anclado abajo a la derecha con `z-index: 99999`, y **solo aparece con claves `pk_test_`**: en producción con claves live no existe. No hay opción documentada para moverlo, así que lo que se hizo es dejar aire bajo el formulario para que el botón de pagar quede libre |

### Onboarding de tutor (TU01/TU02) — «Bien todo el proceso, fácil registrarse»

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| O1 | «Ajustar texto para que no se divida así texto de documento de identidad y formación» | Cabecera del paso 2: la insignia «Empezado, sin enviar» baja debajo del subtítulo en móvil; el título recupera el ancho | ✅ | Antes a 390: la columna de texto medía 70 px, el título caía en **5 líneas** y el resumen en 6, con la cabecera en 292 px de alto. Después: columna de 232 px, título en 2 líneas y la insignia en su propia fila |
| O2 | «De este selector primera opción no debería poder elegirse» | `<option value="" disabled>` como placeholder del `<select>` de documentos | ✅ | `options[0].disabled === true` y sigue siendo la opción mostrada (`selectedIndex 0`), tanto al abrir el paso como al volver a él tras añadir un archivo. Mismo patrón en «Plataforma…» del portafolio |
| O3 | «Me apareció 2 veces el tu perfil está listo y en revisión» | Reproducido con una cuenta nueva recorriendo los cinco pasos | ✅ | **No era un envío duplicado ni una pantalla gemela**: es el botón «atrás» del navegador. Tras «Ir a mi panel», volver atrás devolvía al asistente en el paso 5 con «Finalizar» otra vez, por la caché del router. Se corrige ahí; la pantalla de cierre se pinta una sola vez y la RPC se ejecuta una sola vez |

### Perfil de estudiante / cuenta / cabecera (AL02, G03)

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| E1 | «Slider y sustituir por textos en lugar de iconos» («O elige un tema») | Chips de texto en una fila con scroll en `SugerenciasCard` | ✅ | Antes: 9 círculos de 44 px en **2 filas**, 96 px de alto. Después: una fila de 48 px con píldoras de texto de 40, tira de 1122 px dentro de 356 → la última asoma cortada por el borde de la tarjeta |
| E2 | «Si ya soy tutor no debería salir que quiero ser tutor - en dado caso que sea como ver perfil de tutor» | La tarjeta de /account distingue sin perfil / en revisión / aprobado. **Verónica está «en revisión»**: tiene perfil de tutor y todavía no el rol | ✅ | Con una cuenta en su mismo estado: antes «Enseñar en Enséñame Ya · Conviértete en tutor… · Quiero enseñar». Ahora «Tu perfil de tutor · Está en revisión. Te avisamos por correo cuando lo aprobemos. · Ir a mi panel de tutor». La promesa del correo se comprobó contra la notificación que la encola, no se inventó |
| E3 | «Esta barra no existe en diseño - me gusta pero no sé si lo mejor es que sean 2 botones… sin que estén unidos» | Campana y píldora de usuario como dos controles separados a 390; desde 768 nada cambia | ✅ | Fila de 350 px **sin borde**; campana de 42×42 con su borde a la izquierda y píldora de avatar con el suyo a la derecha. De regalo, un fallo que ella no llegó a ver: con un nombre largo la píldora medía 403 px y sacaba la página a 470 de ancho; ahora el nombre se recorta |
| E4 | «Estoy como tutor y, al ir a mi cuenta en el menú de las 3 rayas, me cambia a alumno» | El switch marcaba «Aprender» fuera de un panel; ahora lee la cookie `ey-panel`, la misma que ya decidía el menú lateral de esa pantalla | ✅ | Antes, en Mi cuenta viniendo del panel de tutor: chips de tutor en el lateral y «Aprender» marcado en el cajón. Ahora: viniendo de tutor marca «Enseñar», viniendo del panel de alumno marca «Aprender», y sin cookie sigue el valor por defecto de julio |

### Búsqueda (P09)

| # | Lo que pide | Lectura | Estado | Evidencia |
| :-- | :-- | :-- | :-- | :-- |
| B1 | «Buscar moverlo abajo, alargar botón y centrar» | Botón debajo, ancho completo (Figma P09) | ✅ | Input y botón de `350×52` apilados |
| B2 | «Búsqueda frecuente centrar» | Rótulo centrado en su línea; chips debajo | ✅ | El rótulo va centrado y los chips en su propia línea |
| B3 | «Categorías solo una línea y slider» | Chips en una fila con scroll | ✅ | Las cinco búsquedas frecuentes comparten una sola línea y la fila se desplaza |
| B4 | «Brinca al elegir opción» (pestañas Todo/Tutores/Mentorías/Categorías) | `scroll={false}` en las pestañas; pestañas en una fila con scroll | ✅ | Con la página a 700 px de scroll, tocar «Tutores» filtra y la página **se queda en 700**. Las cuatro pestañas van en una fila desplazable |
| B5 | «En diseño se divide en cuadros pequeños (me gusta más…)» | «Explorar por categoría» en rejilla de 2 columnas con tarjetas compactas (Figma P09); escritorio a 6 columnas intacto | ✅ | Rejilla de dos columnas de 167 px |

---

## 25.1 bis · Las cuatro primitivas, y por qué existen

Las 45 observaciones se resuelven con cuatro piezas compartidas, no con 45 parches. Quien toque una
pantalla móvil nueva debería usar estas antes de inventar otra cosa.

| Pieza | Dónde | Qué hace |
| :-- | :-- | :-- |
| `scroll-strip` | `src/app/globals.css` (`@utility`) | La «tira»: fila sin envolver con scroll horizontal, sin barra, con anclaje por elemento y sin el gesto de «atrás» al llegar al final. Sin JS. El sangrado hasta el borde lo pone el consumidor con los `px` del `Container` (−20 / −24 / −32), que es lo que hace que el último elemento asome cortado |
| `CategoryIconChips` con `layout="strip"` · `variant="text"` · `scroll` | `src/components/catalog/category-icon-chips.tsx` | Los chips de categoría en una fila; en texto donde Verónica lo pidió y en icono donde no. `scroll={false}` es lo que quita el salto al elegir |
| `Pager` con `targetId` | `src/components/catalog/pager.tsx` | El paginador aterriza en la sección de resultados y no al principio de la página. No hizo falta JS: el App Router respeta el `#ancla` y el `scroll-margin-top` |
| `FilterPills` | `src/components/catalog/filter-pills.tsx` (nuevo) | Los filtros «estilo Shein»: píldoras desplegables en fila con el panel **debajo, en flujo**. En absoluto no vale: una fila con scroll recorta cualquier panel que se salga de ella |

### Lo que se remató al integrar (hallazgos que no tenían dueño)

Los correctores solo podían tocar sus propios ficheros, así que estos hallazgos de los revisores
quedaron sin aplicar y se cerraron en la integración:

| Qué | Dónde | Por qué |
| :-- | :-- | :-- |
| `scroll={false}` en las opciones y en «Limpiar» | `filter-pills.tsx` | **Era el mismo salto que denunció Verónica**, ahora en los filtros: elegir uno devolvía la página al principio. Verificado: `scrollY` 1200 → 1200 |
| «Limpiar» al principio de la tira | `filter-pills.tsx` | Al final empezaba en `x≈795`, 400 px fuera de pantalla: quien marcaba dos filtros no tenía forma de deshacerlos |
| Clave de React por etiqueta y no por URL | `filter-pills.tsx` | Dos opciones del mismo grupo pueden compartir destino («Cualquiera» y la valoración activa) y React avisaba por consola |
| `aria-label` con el par filtro + valor | `filter-pills.tsx` | Con un valor elegido el lector oía «Hoy, botón» sin saber que eso era Disponibilidad |
| Azul `--brand-foreground` en textos pequeños | `filter-pills.tsx`, `category-icon-chips.tsx` | #0080ff a 13 px sobre blanco da 3,8:1 y AA pide 4,5. El token #036fda da 4,9:1 y a ojo es el mismo azul. Solo por debajo de `lg` |
| Números del paginador a 40 px | `pager.tsx` | Eran de 38 mientras sus propias flechas medían 40. Desde `lg` se quedan en los 38 del Figma |
| Conmutador de intención y «Mostrar» | `auth/signup-form.tsx` | 34 y 18 px de alto en el diálogo que abre «Crear cuenta gratis». El área crece hacia dentro: el texto no se mueve |
| Cierre del diálogo a 40 px | `ui/dialog.tsx` | Medía 27×27 y es el único modo de cerrar el alta con el pulgar. Los 6 px de margen negativo dejan la X exactamente donde estaba |
| **El panel de reserva saltaba 179 px** | `catalog/booking-panel.tsx` | Elegir mentoría en el selector movía la página: Chrome anclaba el scroll a la barra fija de abajo y el calendario acababa tapado por la cabecera. Es el «brinca» de Verónica en su tercera forma |
| Días del calendario a 40 px | `catalog/booking-panel.tsx` | Eran de 38 y son el control más tocado de la ficha |
| Chips centrados en tablet | `catalog/category-icon-chips.tsx` + `home/home-hero.tsx` | Forzar el inicio a la izquierda descentraba las diez categorías a 768, donde sí caben. Ahora se centran si caben y arrancan desde el borde si no |
| Área táctil de «Ver detalle →» | `home/featured-products.tsx` | 19 px de alto, y en la tira móvil es el único control de la tarjeta |
| Contraste del CTA claro y de los pasos | `home/final-cta.tsx`, `home/steps-block.tsx` | Azul de marca a 15 px sobre blanco (3,8:1) y los antetítulos y números de paso por debajo del mínimo. Con los tokens oscuros pasan a 4,7-7,5:1 |
| «clases» → «mentorías» | `calendar/calendar-feed-card.tsx` | R4, y la tarjeta sale en la misma captura de Verónica |

## 25.2 · Lo que se decidió y no conviene reabrir

- **Escritorio intacto (R1).** Todo es mobile-first aditivo: base = 390, `md:` = 768, `lg:`
  restituye lo publicado. Donde una corrección exigía un componente distinto en móvil (píldoras de
  filtro, chips de texto, CTA intermedio de P03), el de escritorio sigue montado y el nuevo va
  `lg:hidden` — un solo DOM, clases responsive, nada renderizado dos veces.
- **Iconos o texto en los chips: pantalla por pantalla.** Verónica lo pidió así: texto en Explorar
  tutores y en el panel del alumno; iconos en Home y Categoría (donde solo pidió «slider»).
- **Las etiquetas de los CTA van centradas** aunque el Figma de los bloques CTA las pinte pegadas a
  la izquierda: es un artefacto de auto-layout, y ella pidió «centrados».
- **`FilterPills` abre el panel DEBAJO de la fila, en flujo.** Una fila con `overflow-x: auto`
  recorta cualquier panel absoluto de un `<details>`; por eso en móvil los desplegables no pueden
  ser los mismos `<details>` de escritorio.
- **Nada de páginas inventadas.** El paginador aparece cuando hay más de 12 resultados.

## 25.2 bis · Cómo se verificó, y qué NO se pudo verificar

Todo lo de arriba está **medido en el navegador**, no leído del código: posición y tamaño de cada
caja (`getBoundingClientRect`), estilos aplicados (`getComputedStyle`), número de líneas (alto
dividido por el interlineado), scroll de página (`scrollWidth` contra `innerWidth`) y la posición de
la página antes y después de cada toque (`scrollY`). Los anchos: **375, 390, 768 y 1280**, y 320 y
360 en los casos límite.

Tres avisos para quien repita el barrido:

- ⚠️ **Chrome sin ventana (`--headless`) no vale por debajo de ~500 px.** Impone un ancho mínimo de
  ventana: la captura sale de 390 px pero el layout de dentro está calculado para uno más ancho.
  Medido con Chrome 152 en los dos modos. La emulación del panel del navegador sí es real.
- ⚠️ **Con el panel del navegador oculto no hay capturas** (se quedan en blanco o caducan) **y las
  transiciones CSS se congelan**: leer un color a medio `transition` da un valor que no es ni el de
  antes ni el de después. Por eso todas las medidas de color se tomaron inyectando
  `* { transition: none }`. Lo que hay en este documento son números del DOM, **no un pase visual**:
  eso lo tiene que hacer alguien mirando la pantalla.
- ⚠️ **La app NO hidrata en `http://127.0.0.1:3000` ni en `http://[::1]:3000`.** Next 16 bloquea el
  desarrollo desde orígenes que no sean `localhost`, y el síntoma es engañoso: la página se pinta
  entera, pero React nunca engancha, así que ningún botón responde y los formularios se envían como
  GET nativo (el login acaba en `/login?email=&password=`). Para verificar con sesión sin tocar la
  del navegador principal, la vía que funciona son los subdominios: **`http://qa.localhost:3000`**,
  que Chrome resuelve solo, tiene su propio tarro de cookies y Next acepta sin configurar nada.
- ⚠️ **El optimizador de imágenes de Next cachea en `dev` durante 4 h.** Las fotos de «¿Cómo
  funciona?» se recortaron conservando el nombre del fichero, así que en la máquina donde ya se
  habían servido siguen saliendo con el filo. Se arregla borrando `.next/dev/cache/images` (Next lo
  recrea) o renombrando los ficheros; en Vercel no ocurre porque cada despliegue construye limpio.

## 25.3 · Lo que queda fuera (para Diana / Emilio)

- **Las fotos de «¿Cómo funciona?» son demasiado pequeñas.** Las franjas blancas que señaló Verónica
  venían en los propios JPG y se recortaron (`how-alumno.jpg` 474×480, `how-tutor.jpg` 480×460), pero
  a ese tamaño una caja de 350 px en un teléfono con densidad 2 pide el doble de píxeles de los que
  hay: se ven blandas. No se arregla con código — hacen falta los originales de Diana a 800 px o más.
- El Figma móvil de P09 pinta «Explorar por categoría» sobre fondo blanco; el escritorio publicado lo
  pinta sobre `#14141a`. Verónica no lo pidió: se conserva el oscuro y se cambia solo la rejilla.
- La barra campana + usuario de la cabecera con sesión «no existe en diseño» (lo dice ella): el
  Figma no dibuja la campana en ninguno de sus 115 frames (Doc 24 §24.5). Se hizo lo que propone.

### Una decisión de contenido que hay que tomar: el titular del hero

Verónica pide que el titular «no pase a 4 líneas (reducir tamaño)». La palabra que rota al final
manda sobre el tamaño, y la medición no deja margen de interpretación (Poppins 600, medido en el
navegador con el contenedor real: 350 px a 390 y 335 a 375):

| Con estas palabras | Tamaño máximo que cabe en 3 líneas |
| :-- | :-- |
| Las ocho de hoy, con **«emprendimiento»** | **20 px** (a 22 ya son 4 líneas) |
| Las siete restantes, sin «emprendimiento» | **26 px** — que es justo lo que pinta el Figma |

O sea: el titular es pequeño **por una sola palabra**. Se ha dejado en 20 px y con las ocho
palabras, porque el texto es del cliente y quitar una es una decisión suya, no de maquetación
(misma regla que el resto del contenido). Si Ennis o Verónica prefieren el titular grande, quitar
«emprendimiento» de `rotating-word.tsx` lo sube a 26 px sin tocar nada más.

### Deuda de accesibilidad que es decisión de marca, no de maquetación

Los revisores la midieron y la dejan escrita en vez de arreglarla por su cuenta, porque cambiarla
toca la identidad y no solo el móvil:

| Qué | Medido | Dónde aparece |
| :-- | :-- | :-- |
| Texto blanco sobre el naranja `--primary` (#fe6a00) | **2,9:1** — AA pide 4,5 para texto normal y 3 para texto grande | Todos los botones naranjas del sitio y la insignia «Verificado» del perfil |
| Texto blanco sobre el degradado azul del hero | Entre **2,9:1 y 5,2:1** según la posición: falla en la mitad derecha, que es más clara | Los heros de P01, P04, P05, P07 y P09, en móvil y en escritorio |
| Eyebrows «ESTUDIANTE» / «TUTOR» | 2,55:1 y 3,64:1 | «¿Cómo funciona?» |

Las tres son **anteriores a este trabajo** y afectan igual al escritorio publicado. Las salidas
posibles, si el cliente quiere cerrarlas: un naranja de botón más oscuro (≈#c24e00 da 4,5:1 con
blanco) o etiqueta en negro sobre el naranja; y paradas más oscuras del degradado solo en móvil,
donde el texto cruza todo el ancho. Lo que sí se hizo aquí es no empeorarlas: los textos pequeños
nuevos usan `--brand-foreground` (#036fda, 4,9:1) en vez del azul de marca.
