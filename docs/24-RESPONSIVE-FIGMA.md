# DOC 24 — El responsive de Diana, aplicado

> **Qué es esto.** El archivo Figma **«Mobile y Tablet»** (`e2Av6H2GHVvz6g9mCKPwVV`):
> **115 frames = 57 pantallas × 2 anchos** (390 y 768). US-1601 está **aplicada** y lo que queda
> vivo de este documento es lo que ninguna pantalla trae escrito: el **registro de divergencias
> conscientes** (dónde NO se sigue el Figma y por qué), el **sistema de facto** que sale de contar
> sus nodos, y **cómo se verifica el móvil sin engañarse**. Sin esto, cada agente que toque una
> pantalla vuelve a abrir las mismas discusiones.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 24 — Aplicación del Figma responsive (US-1601) |
| **Fuente de diseño** | Figma «Mobile y Tablet» `e2Av6H2GHVvz6g9mCKPwVV`, mod. 2026-08-11 |
| **Estado** | Aplicada en `ffe900f` (27-ago-2026), en `dev` y en `main`. Las peticiones móviles de Verónica del 3-sep se trazan en `docs/25-CORRECCIONES-MOBILE-VERONICA-3SEP.md` |
| **Auditoría de partida** | **10 agentes** sobre los 115 frames y las rutas del repo, **medida en navegador** a 390/768/1024/1280/1440 — no leída de la documentación. 92 fichas de pantalla, 564 hallazgos, 162 conflictos |
| **Lo que citan otros** | §24.2 (las cuatro reglas) y §24.8 (cómo se regenera el Figma y cómo se mide) |

---

## 24.0 · La conclusión, en cinco frases

1. **El cromo son tres ficheros, no 57 pantallas.** `site-header.tsx`, `panel-shell.tsx` y
   `app-sidebar.tsx` gobiernan casi todo: la cadena de layouts cuelga `SiteHeader` de las **61
   pantallas** de `(public)` + `(app)`, `SiteFooter` de 43 y `AdminFooter` de las 18 de admin.
   Tocando el cromo se mueve media aplicación; tocando una pantalla, una.
2. **La banda de tablet es `md:`, y hoy está poblada**: **148 apariciones** en `src/**/*.tsx` frente a
   326 de `sm:` y 383 de `lg:`. Es el ancho que define este Figma (768), y el que un repo
   mobile-first se salta si solo usa `sm:` y `lg:`.
3. **El sistema ya estaba bien.** Poppins con sus cuatro pesos cubre el 100 % de los nodos de texto y
   `--radius: 0.5rem` acierta con el radio dominante (735 de 1.500 nodos con esquina). La auditoría
   no encontró **ni un token de color nuevo** que inventar.
4. **El Figma desconoce el producto.** Cero apariciones de la campana de avisos, del badge del
   carrito y del menú del avatar abierto en los 115 frames; cero frames del cajón móvil; cero de los
   desplegables. Todo lo que vive detrás de un «▾» hay que inventarlo, y el riesgo real es que
   alguien «limpie» el header para parecerse al Figma y se lleve por delante funcionalidad (R2).
5. **Y hay un menú incompleto, que no es un problema de maquetación:** `/admin/notificaciones`,
   `/admin/operaciones` y `/admin/reembolsos` **no están en `ADMIN_ITEMS`**. Existen y se llega a
   ellas, pero solo desde las tarjetas del dashboard (`(app)/admin/page.tsx`), no desde el menú.

---

## 24.1 · Las dos decisiones tomadas antes de escribir código

| # | Decisión | Cómo quedó |
| :-- | :-- | :-- |
| **D-1** | **El solape del header se arregla entero, escritorio incluido.** La causa era una sola clase (`max-w-[558px] shrink-0` con `flex-1` a los lados), y el propio Figma del área de tutor ya la resuelve: allí el buscador es `w:fill grow`. Con los 558 px fijos, entre **768 y ~1370 px** el buscador **tapaba «Explorar» y «Nosotros» y los hacía inpulsables** (`document.elementFromPoint(190,36)` devolvía el `<input>`), escritorio a 1024 y 1280 incluidos | **Aplicada**: buscador flexible con tope (`lg:max-w-[558px] lg:grow-[3] lg:basis-0`, `site-header.tsx:466`) y fila entera por debajo de 1024. El escritorio **cambió a propósito**: el buscador ya no mide 558 px fijos |
| **D-2** | **El widget de soporte del Figma no se construye.** Los 74 frames con burbujón dibujan, al abrirlo, un chat de **soporte** («Soporte Enséñame Ya · En línea», un agente contestando sobre reembolsos). No es lo construido —bandeja alumno↔tutor estilo LinkedIn, decisión 15 / R24-21— ni lo decidido para soporte (`/contacto`, DL-01, con aviso expreso en `support-card.tsx` de no abrir un segundo canal) | No se implementa. Del Figma de chat se aprovecha **solo** el hilo a pantalla completa a 390 px, que sí es un arreglo real |

> **Sobre D-2, el dato que la sostiene:** el burbujón aparece en 74 de 115 frames con **tamaño**
> (50/56/60), **color** (44 naranjas / 20 azules), **radio**, **sombra**, **badge** (a veces sí, a
> veces no; rojo o azul) y hasta **posición** distintos — en `AD14`/`AD15` está abajo a la
> **izquierda**, y en los 16 frames de Tutor cuelga dentro del contenido a `y=76`. Es decoración de
> maqueta copiada y pegada, no un componente del layout.

---

## 24.2 · Las cuatro reglas que gobiernan toda la maquetación

**R1 · Escritorio (≥1024 px) no se toca**, salvo D-1. El trabajo es **mobile-first aditivo**: se
ajusta la clase base (390) y `md:` (768–1023), y si cambia la base hay que **restituir** el
escritorio con `lg:`.

**R2 · No se borra funcionalidad.** Lo que el Figma no dibuja pero el producto tiene —campana,
carrito, switch de panel, modo onboarding, modo admin— **no se quita: se reubica** siguiendo el
idioma del propio diseño.

**R3 · Los comentarios del código llevan decisiones del cliente y ganan al Figma.** Ver §24.4.

**R4 · Vocabulario: «mentoría» al 100 %.** El Figma alterna «clases», «tutorías» y «mentorías» —a
veces en el mismo pie—; gana «mentorías». «sesión» y «tutor» no se tocan.

---

## 24.3 · El sistema de facto, contado sobre los 115 frames

No es una estimación: sale de contar los nodos, no de mirar las pantallas.

| Qué | A 390 | A 768 |
| :-- | :-- | :-- |
| Padding horizontal de página | **20 px** (2.053 nodos en `x=20`) | **32 px** (716 nodos en `x=32`) |
| Ancho de contenido | **350** (635 frames exactos) | **704** (260 frames exactos) |
| Cuerpo de texto | 13px/400/lh20 · con 11–14px se cubre el **79 %** | ídem · **74 %** |
| Menú de panel | chips que envuelven (`row wrap gap8`) — **no se hace así**, ver §24.4 | columna real: **168 px** alumno, **196 px** admin (`panel-shell.tsx`) |
| Header público | **3 filas**, 164–173 px | **2 filas**, 146 px |
| Pie | 1 columna apilada | 3 columnas en fila |

**El 71,8 % de los nodos no cambia de tamaño entre mobile y tablet**, y cuando cambia el salto
dominante es **+1 px** (13→14, 290 casos). O sea: el archivo **no trae escala tipográfica nueva**.
Lo que cambia de verdad es la **rejilla**.

⚠️ **Tres dialectos de gris** repartidos por página de Figma: `home` usa `#242424`/`#666666`,
`alumno`+`admin` usan `#19191f`/`#6b6b6b`, y `tutor` usa los grises por defecto de Tailwind
(`#1f2937`/`#6b7280`/`#e5e7eb`). **Ninguno** es el par del escritorio (`#14141a` + `#4d4d4d`). El
archivo no arbitra: **manda el par del escritorio**, que ya es token.

---

## 24.4 · Registro de divergencias conscientes (R3) — no reabrir

Esto es lo que **el Figma pide y no se hace**, con la decisión que lo respalda. Cualquier agente que
se encuentre uno de estos casos lo cita y sigue; no lo «arregla».

| Lo que pide el Figma | Por qué no se hace | Dónde está escrito |
| :-- | :-- | :-- |
| Buscador «Buscar en el panel…» en **las 26 pantallas de admin** | No existe la búsqueda global del panel que alimentaría ese input. Por debajo de 1024 el cajón de admin sí trae uno, y busca el **sitio público** | `site-header.tsx:276` (`conBuscador`) y `:668` |
| **Header + pie completos** en el checkout (AL05) y en la sala en vivo (LV01) | El cliente pidió aislarlas, **por escrito y dos veces** | `(checkout)/layout.tsx` (N-37) · `(room)/layout.tsx` (MN-04) |
| **Domicilio y EIN** en el pie / redes sociales | Domicilio (P-2) y EIN (V-8) retirados por decisión expresa del cliente; `COMPANY_SOCIALS` vacío porque los tres perfiles **no existen** | `site-footer.tsx:96-124` y `:218-224` |
| Chips de menú «Pagos, Mensajes, Reseñas, Ayuda…» | Solo se listan destinos que **existen**: un menú que lleva a 404 es peor que un menú corto | `app-sidebar.tsx` → `STUDENT_ITEMS` · `TUTOR_ITEMS` · `ADMIN_ITEMS` |
| Menú de panel a 390 como fila que **envuelve** (`sidebar-nav · row wrap gap8`) | Con los destinos reales son dos filas en alumno y tres en admin: 150 px de menú antes del saludo, y lo primero que se ve al abrir el panel es el menú. Desde el 9-sep es una **tira de una línea con scroll** y la sección activa traída a la vista: 48 px fijos y sigue a un toque | `app-sidebar.tsx:362-399` |
| Buscador y hamburguesa **durante el onboarding** | El área autenticada está cerrada por `requireUser` hasta terminar: serían enlaces a ninguna parte. Solo queda «Guardar y salir» | `site-header.tsx:276` y `:470-481` |
| Primera tarjeta de garantías **fija en naranja** | Es un `hover`, no un estado fijo — acuerdo del 24-jul (R24-02) | `home/trust.tsx:92` |
| FAB de chat **naranja y siempre visible** | El código lo pinta azul (`bg-brand`) y **solo con sesión** (decisión 15 / R24-21). Y ver **D-2** | `chat-launcher.tsx:6` · `chat-bubble.tsx:656` |
| Quitar la **hamburguesa** en el área de tutor a 390 | Es el único acceso a Explorar / Sobre nosotros / Cómo funciona en móvil; se esconde a partir de 1024 (`lg:hidden`), no antes | `site-header.tsx:646` |
| «clases» / «tutorías» | **R4**: mentoría al 100 % | acuerdo del 17-ago |

---

## 24.5 · Huecos del propio Figma

No todo lo que falta es culpa del código.

- **`P01 — Home — Mobile` está sin acabar**: termina en «Resultados reales» y **no trae FAQ, CTA
  final ni pie**, que la versión tablet sí tiene. `P02` y `P03` móvil sí los llevan, así que las
  medidas de móvil salen de `P03`.
- **No hay ni un frame del cajón/hamburguesa abierto**, pese a que el ☰ sale en más de 40 frames.
  Tampoco de los desplegables ni del menú del avatar. Se conserva el `Sheet` actual.
- **Ocho variantes estructurales de header** con 11 alturas distintas a 390 y 9 a 768, sin
  componente maestro. Canon adoptado: `AU01`/`AL02` para público y alumno, `TU06` para tutor,
  `AD02` para admin; el resto se anota como variación no implementada.
- **Los 26 frames de admin no están en auto-layout en la raíz**: `content` arranca en `[0,0]`, la
  misma coordenada que el header, así que el PNG del frame completo muestra el contenido **tapando**
  la cabecera. Hay que leer el orden, no las coordenadas.
- El **buscador del header de tutor sale recortado en el propio Figma** («🔍 Buscar tutores, clases
  o cate…»): el ancho que le da Diana no admite su propio placeholder.
- La **divisoria del pie** es `#fe6a00` en unos frames y `#e0e0e0` en otros. El Figma se contradice
  consigo mismo; se queda el naranja, que es lo que ya hay.
- **Dos radios para el mismo chip**: `r8` en alumno, `r14` en tutor y admin.

---

## 24.6 · Piezas que ya casan, y no se rehacen

- **El pie a 768** ya se arregló en US-1601 (`site-footer.tsx`): columnas en `x=300..729` dentro de
  753, sin scroll.
- **Las rejillas de tarjetas** casan con el Figma: 1 columna a 390 y 2 a 768 en P04, P05, P06, P07 y
  P09 — los 342–350 px que pide Diana.
- **El selector de horarios de AL04** (`(app)/reservar/[productId]/slot-picker.tsx`) es la pieza mejor
  resuelta del repo: corte `md:` calculado y comentado, barra `sticky` inferior con hueco para el FAB.
- **TU04 y el colapso de TU05/TU06/TU08** son exactamente el Figma.
- **Los listados del admin no tienen ni una `<table>`**: son `<ul>` de tarjetas, que es la familia de
  la que sale el patrón del diseño, y los detalles apilan a una columna bajo 1024. La **única
  `<table>` del sitio** es la de movimientos de `/tutor/payouts`, y vive dentro de un
  `overflow-x-auto` con `min-w-[680px]`.
- **La píldora negra «Admin»** del header coincide **exactamente** con el Figma (58×25, r999,
  pad 4/10, 600 11/16). No tocar.
- **La campana vive en el grupo único de acciones** (`site-header.tsx:512`), que se pinta a los tres
  anchos: a 390 un usuario con sesión llega a sus avisos. ⚠️ No devolverla a un `hidden md:flex`: sin
  copia en el cajón, por debajo de 768 **no hay ningún acceso** a los avisos.
- **`dialog`, `sheet` y `chat-bubble`** son seguros a 390: no hay que tocar los primitivos.
- `(public)/carrito`, `(checkout)/pedidos/[id]/confirmacion`, `(checkout)/reservas/[id]/pagar`,
  `/admin/reportes`, `/tutor/faqs` y `/tutor/reservas/[id]/cancelar` **funcionan a 390 sin tocar nada**.

⚠️ **La pantalla de cobros del tutor ya no responde a este Figma.** El dictado de pagos
(`docs/DICTADO-PAGOS.md`, 9-sep-2026) la rehízo: hoy son **dos tarjetas automáticas —PayPal y
Banco—** (detrás de Banco compiten Wise, dLocal y Stripe sin que el tutor vea cuál ejecutó) y los
canales manuales son **solo Venezuela**. La cuenta bancaria por onboarding de Stripe Connect **salió
del producto y del código** (`src/app/api/tutor/stripe-connect/` y `connect-alta.tsx` ya no existen),
así que cualquier medida de «TU09 Payouts» contra el Figma es de otra pantalla. El paquete vigente de
ese panel es `docs/27-PANEL-TUTOR-V2-CAMBIOS-APROBADOS.md`.

---

## 24.7 · Cómo se ejecutó, para el próximo lote

El cromo va **primero y se congela** —`panel-shell`, `app-sidebar`, los shells de tutor y admin, los
pies, `container`, `section`, `globals.css`, y después el header con D-1—, y solo entonces las
pantallas por área con propiedad de ficheros asignada. Sin ese orden hay conflicto de merge en los
tres ficheros más largos del área, porque son los que querría editar cualquier agente de pantalla.

**Cuellos de botella medidos:** de 114 componentes, solo **23 son exclusivos** de una ruta, 28 son de
área y **61 (54 %) son globales** — no por acoplamiento malo, sino por la cadena de layouts (§24.0).
Cada fase cierra con build, typecheck, lint y **medición** a 390/768/1024/1280/1440.

---

## 24.8 · Cómo se verifica el móvil, y las tres trampas

**Los artefactos del Figma** (115 specs de texto con la geometría exacta de cada nodo y 574 PNG por
secciones) se regeneran con la REST API en unos minutos, con el `FIGMA_API_KEY` de `.env.local`. Dos
trampas anotadas: el **429 si se pide en paralelo**, y que un frame de 5.955 px **no se puede leer
entero** — hay que renderizar por secciones.

**Y tres trampas al medir, las tres verificadas el 8/9-sep-2026. Ninguna avisa: todas devuelven una
pantalla que parece correcta.**

1. **Chrome headless NO sirve por debajo de ~500 px.** Con `--headless=new` y con el viejo,
   `--window-size=390,844` da un PNG de 390 px pero con el layout calculado a un viewport más ancho:
   el header sale recortado y el hero cortado. Chrome impone un ancho mínimo de ventana. La emulación
   del panel del navegador (`resize_window {width:390,height:844}`) sí es real: `innerWidth` 390 y UA
   de Android. **Headless solo de 768 para arriba.**
2. **La app no hidrata en `127.0.0.1` ni en `[::1]`** — Next 16 solo permite desarrollo desde
   `localhost`. El síntoma engaña: la página se pinta entera pero React nunca engancha, ningún botón
   responde y el formulario de login se envía como GET nativo (`/login?email=&password=`). Para una
   sesión aislada, **subdominios: `http://qa.localhost:3000`** — Chrome los resuelve solo, cada uno
   tiene su propio tarro de cookies (así `localhost` sigue anónimo para las páginas públicas) y Next
   los acepta sin tocar `allowedDevOrigins`.
3. **Con el panel del navegador OCULTO la página no se pinta.** Las capturas salen en blanco o
   caducan, los clics y el scroll de puntero agotan el tiempo, y —la peor— las transiciones CSS se
   congelan: leer un color a medio `transition` da un valor que no es ni el de antes ni el de después
   (para medir color, inyectar antes `* { transition: none }`). Con el panel oculto sí funcionan medir
   por DOM (`getBoundingClientRect`, `getComputedStyle`, `scrollWidth`), `find`, `read_page`,
   `get_page_text`, escribir y navegar.

> El cliente revisa en un iPhone (390×844). Una captura «a 390» que en realidad es a 500 manda a
> arreglar lo que no falla y esconde lo que sí.
