# DOC 24 — El responsive de Diana, aplicado

> **Qué es esto.** El archivo Figma **«Mobile y Tablet»** (`e2Av6H2GHVvz6g9mCKPwVV`) llegó por fin:
> **115 frames = 57 pantallas × 2 anchos** (390 y 768). Esto **desbloquea la US-1601**, que llevaba
> meses parada «esperando diseños de Diana» (Doc 22, punto G4). Este documento es el plan de
> ejecución y, sobre todo, el **registro de divergencias conscientes**: dónde NO se sigue el Figma
> y por qué. Sin él, cada agente que toque una pantalla vuelve a abrir las mismas discusiones.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 24 — Aplicación del Figma responsive (US-1601) |
| **Fecha** | 2026-08-27 |
| **Autor** | Jose Mora (desarrollo) |
| **Rama** | `feat/responsive-figma`, sacada de `dev` @ `c4ce969` |
| **Fuente de diseño** | Figma «Mobile y Tablet» `e2Av6H2GHVvz6g9mCKPwVV`, mod. 2026-08-11 |
| **Verificación** | Auditoría de **10 agentes** sobre los 115 frames y las 68 rutas, **medida en navegador** a 390/768/1024/1280/1440 — no leída de la documentación. 92 fichas de pantalla, 564 hallazgos, 162 conflictos |

---

## 24.0 · La conclusión, en seis frases

1. **El problema no está en las 57 pantallas: está en tres ficheros.** `site-header.tsx` (65 rutas),
   `panel-shell.tsx` y `app-sidebar.tsx` (44 rutas) concentran la mayor parte del daño. Arreglados
   esos, media aplicación queda bien sin tocarla.
2. **Hay un bug vivo hoy en producción que no lo trae este encargo**: entre **768 y ~1370 px** el
   buscador del header **tapa «Explorar» y «Nosotros» y los hace inpulsables**
   (`document.elementFromPoint(190,36)` devuelve el `<input>`). Eso incluye escritorio a 1024 y 1280.
3. **Al repo le falta la banda de tablet.** 144 prefijos `sm:` contra 34 `md:`: salta de 640 a 1024
   y se salta justo el ancho que define este Figma (768 = donde entra `md:`).
4. **El sistema ya estaba bien.** Poppins con sus cuatro pesos cubre el 100 % de los 7.226 nodos de
   texto, `--radius: 0.5rem` acierta con el radio dominante y **19 de los 20 tokens de color** de
   `globals.css` aparecen en el archivo nuevo. No hay tokens nuevos que inventar.
5. **El Figma desconoce el producto.** Cero apariciones de la campana de avisos, del badge del
   carrito y del menú del avatar abierto en los 115 frames; cero frames del cajón móvil; cero de los
   desplegables. Todo lo que vive detrás de un «▾» hay que inventarlo, y el riesgo real es que
   alguien «limpie» el header para parecerse al Figma y se lleve por delante funcionalidad.
6. **Y hay dos cosas rotas hoy que no son de diseño**: por debajo de 768 px un usuario con sesión
   **no tiene ningún acceso a sus avisos** (la campana vive dentro de un `hidden md:flex` y no está
   en el cajón), y `/admin/notificaciones`, `/admin/operaciones` y `/admin/reembolsos` **no están en
   `ADMIN_ITEMS`**, así que no se llega a ellas desde ningún menú.

---

## 24.1 · Las dos decisiones tomadas antes de escribir código

| # | Decisión | Qué se hace |
| :-- | :-- | :-- |
| **D-1** | **El solape del header se arregla entero, escritorio incluido.** La causa es una sola clase (`max-w-[558px] shrink-0` con `flex-1` a los lados) y el propio Figma del área de tutor ya la resuelve: allí el buscador es `w:fill grow`, o sea **flexible**. Acotar el arreglo a 768–1023 dejaría la navegación inpulsable en la mayoría de portátiles | Buscador flexible en todos los anchos. El escritorio **cambia a propósito**: el buscador deja de medir 558 px fijos |
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
| Menú de panel | chips que envuelven (`row wrap gap8`) | columna real: **168 px** alumno, **196 px** admin |
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
| Buscador «Buscar en el panel…» en **las 26 pantallas de admin** | No existe la búsqueda global del panel que alimentaría ese input | `site-header.tsx:213-215` |
| **Header + pie completos** en el checkout (AL05) y en la sala en vivo (LV01) | El cliente pidió aislarlas, **por escrito y dos veces** | `(checkout)/layout.tsx` (N-37) · `(room)/layout.tsx` (MN-04) |
| **Domicilio y EIN** fuera / redes sociales en el pie | Domicilio (P-2) y EIN (V-8) retirados por decisión expresa del cliente; `COMPANY_SOCIALS` vacío porque los tres perfiles **no existen** | `site-footer.tsx:73-99` y `:151-154` |
| Chips de menú «Pagos, Mensajes, Reseñas, Ayuda…» | Solo se listan destinos que **existen**: un menú que lleva a 404 es peor que un menú corto | `app-sidebar.tsx:44-51` |
| Buscador y hamburguesa **durante el onboarding** | El área autenticada está cerrada por `requireUser` hasta terminar: serían enlaces a ninguna parte | `site-header.tsx:207-211` |
| Primera tarjeta de garantías **fija en naranja** | Es un `hover`, no un estado fijo — acuerdo del 24-jul (R24-02) | `home/trust.tsx:59-63` y `:92` |
| FAB de chat **naranja y siempre visible** | El código lo pinta azul y **solo con sesión** (decisión 15 / R24-21). Y ver **D-2** | `chat-launcher.tsx:6` |
| Quitar la **hamburguesa** en el área de tutor a 390 | Es el único acceso a Explorar / Sobre nosotros / Cómo funciona en móvil | — |
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

## 24.6 · Lo que ya estaba hecho y NO se rehace

Media auditoría es esto, y es la parte que ahorra trabajo:

- **El pie a 768** ya se arregló en US-1601 (`site-footer.tsx:107-111`): columnas en `x=300..729`
  dentro de 753, sin scroll.
- **Las rejillas de tarjetas** ya casan con el Figma: 1 columna a 390 y 2 a 768 en P04, P05, P06,
  P07 y P09 — los 342–350 px que pide Diana.
- **El selector de horarios de AL04** (`slot-picker.tsx`) es la pieza mejor resuelta del repo: corte
  `md:` calculado y comentado, barra `sticky` inferior con hueco para el FAB.
- **TU09 Payouts, TU04 y el colapso de TU05/TU06/TU08** ya son exactamente el Figma.
- **El admin no tiene ni una `<table>`**: los 13 listados ya son `<ul>` de tarjetas, que es la
  familia de la que sale el patrón del diseño. Y los detalles ya apilan a una columna bajo 1024.
- **La píldora negra «Admin»** del header coincide **exactamente** con el Figma (58×25, r999,
  pad 4/10, 600 11/16). No tocar.
- **`dialog`, `sheet` y `chat-bubble`** ya son seguros a 390: no hay que tocar los primitivos.
- `/carrito`, `/pedidos/[id]/confirmacion`, `/reservas/[id]/pagar`, `/admin/reportes`, `/tutor/faqs`
  y `/tutor/reservas/[id]/cancelar` **funcionan a 390 sin tocar nada**.

---

## 24.7 · Orden de ejecución

El cromo va **primero y se congela**: son los ficheros que querría editar cualquier agente de
pantalla, y sin ese orden habría conflicto de merge en los tres ficheros más largos del área.

| Fase | Qué | Ficheros |
| :-- | :-- | :-- |
| **A** | Auditoría (hecha) | — |
| **B** | Cromo compartido | `panel-shell` · `app-sidebar` · `tutor-shell` · `admin-shell` · `site-footer` · `admin-footer` · `auth-shell` · `container` · `section` · `globals.css` · `not-found` (nuevo) · `error` |
| **B2** | El header, con D-1 | `site-header` · `search-autocomplete` · `notifications-bell` |
| **C** | Las 57 pantallas + 22 rutas sin diseño | por área, con propiedad de ficheros asignada |
| **D** | Verificación | build · typecheck · lint · medición a 390/768/1024/1280/1440 |

**Cuellos de botella medidos** (informe `propiedad.md`): de 114 componentes, solo **23 son
exclusivos** de una ruta, 28 son de área y **61 (54 %) son globales** — no por acoplamiento malo,
sino por la cadena de layouts: `(public)/layout.tsx` y `(app)/layout.tsx` cuelgan `SiteHeader` de 65
rutas y `SiteFooter` de 64.

---

## 24.8 · Dónde está el detalle

Los diez informes completos de la auditoría —92 fichas de pantalla con hallazgos, conflictos y
huecos, fichero y línea— están fuera del repo, en el directorio de trabajo de la sesión.
Los artefactos del Figma (115 specs de texto con la geometría exacta de cada nodo y 574 PNG por
secciones) se regeneran con la REST API en unos minutos; el procedimiento y sus trampas
—el 429 en paralelo, y que un frame de 5.955 px no se puede leer entero— están anotados.
