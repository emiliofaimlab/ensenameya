# DOC 20 — Plan de acción sobre la minuta del 17 de agosto

> **Qué es esto.** Los **14 puntos** de la minuta de Verónica (reunión con el cliente del lunes
> 17-ago, correo del 19-ago), **contrastados uno a uno contra el código de `dev`** y reordenados en
> **lotes ejecutables por agentes**. No es una lista de deseos traducida a tickets: la mitad de los
> puntos choca con algo que ya existe, y eso hay que decirlo antes de programar.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 20 — Plan de acción sobre la minuta del 17-ago |
| **Fecha** | 2026-08-20 |
| **Autor** | Jose Mora (desarrollo) |
| **Base** | `docs/19-PLAN-DE-EJECUCION.md` (17-ago, al cierre) |
| **Fuente nueva** | Minuta `[MINUTA ENSÉÑAME YA] DESARROLLO`, Verónica, 19-ago — 14 puntos en 6 módulos |
| **Verificación** | Auditoría sobre `dev` @ `2c55ef0`: 6 agentes por módulo + 3 pasadas de contraste (conflictos · viabilidad · esquema/RLS). **Todo estado de este documento está comprobado contra el código, no contra la documentación** — que en dos puntos se ha demostrado falsa (§20.6) |
| **Fecha objetivo del equipo** | 28–29 de agosto de 2026 |

---

## 20.0 · La conclusión, en cinco frases

1. **El problema de fondo de esta minuta no es técnico: es que el cliente está mirando `main`.**
   `main` sigue en el commit del **29-jul**, con **94 commits y ~30 migraciones** de retraso. Varios
   puntos piden cosas que ya están hechas en `dev` desde el 17-ago y que nadie ha podido ver.
2. **Tres puntos deshacen trabajo entregado hace tres días** — el chat post-reserva revierte M-12,
   la dirección del pie deshace DL-03, y el Typeform delante del dominio es exactamente lo que ya
   tumbó el alta de dLocal.
3. **Dos puntos son XL disfrazados de ajuste**: la llamada tipo Google Meet (la UI de vídeo **no es
   nuestra**, vive en un iframe de Daily) y dLocal como respaldo (**no hay cuenta**, y la dependencia
   va al revés de lo que asume la minuta).
4. **Un punto ya está hecho** (el límite de subida: 10 MB impuestos por el bucket, server-side) y lo
   único que falta es que el cliente diga si quiere **otro número**.
5. **Nada de pagos se puede enseñar ni validar hoy fuera de local**: falta `STRIPE_PUBLISHABLE_KEY`
   en Vercel y el endpoint devuelve **503** sin ella.

> **El único trabajo que desbloquea a la vez la minuta y a dLocal es el mismo que lleva tres días
> pendiente: el merge `dev` → `main`.** Va primero, con su ventana propia. Todo lo demás va detrás.

---

## 20.1 · Los seis bloqueantes — leer antes de abrir un solo ticket

| # | Bloqueante | Evidencia | Qué hacer |
| :-- | :-- | :-- | :-- |
| **B-1** | **La minuta describe producción, no el producto.** Ya están hechos y sin desplegar: identidad legal y redes muertas fuera del pie (`1fca00f`), `/contacto` (`dc89ddd`), los Términos EN+ES (`d2fa263`), reembolsos reales (`f49b88e`), cobro tardío (`dd559b0`), el 4 % de recargo apagado (`3b6fb88`), las horas (`acd3f3f`), el precio anunciado ≠ cobrado (`56523eb`), chat pre-compra (`9305c1c`), disponibilidad por mentoría (`949926f`), «mentoría» al 100 % (`2c55ef0`) | `git rev-list --count main..dev` → **94** | Merge `dev`→`main` **y re-validar la minuta contra producción** antes de planificar |
| **B-2** | **MN-06 revierte M-12**, mergeado el 17-ago a las 19:28 — el mismo día de la reunión. M-12 son 1.154 líneas de migración, 16 ficheros y un renombrado de rutas. Y **no está en producción**, o sea que el cliente no ha podido ver lo que pide deshacer | `9305c1c`, `20260817210000_conversaciones_previas.sql` | Preguntar si es marcha atrás consciente **antes de tocar nada** |
| **B-3** | **MN-10 deshace DL-03.** La dirección del pie no es decoración: es el requisito de validación de dLocal, metido el 17-ago con esa justificación explícita. `lib/company.ts` avisa: «dLocal valida el sitio a mano y comprueba que estos datos coincidan exactamente con los de su panel» | `1fca00f`, `src/lib/company.ts`, `19-PLAN §19.4` | Preguntar si la molestia es **visual** o es **no publicar el domicilio**. Son dos respuestas distintas |
| **B-4** | **MN-13 (Typeform delante del dominio) es la vía rápida a un segundo rechazo de dLocal.** Su requisito DL-07 es literalmente «sitio completo, sin información faltante». Un gate delante esconde el flujo de compra, `/contacto`, el pie legal y las tres páginas legales — DL-01, DL-02, DL-03 y DL-05 de una vez | `19-PLAN §19.4`, CLAUDE.md (dos dominios sin conectar) | **No ejecutarlo antes de la aprobación.** Y pedir por fin el dato: ¿qué URL exacta se presentó a dLocal? |
| **B-5** | **MN-03 va al revés.** No hay ni una línea de dLocal en el repo y no la va a haber: dLocal Go espera a que **el sitio** pase su revisión, que depende del merge. dLocal no es el respaldo de Stripe; dLocal es **quien está bloqueado por nosotros** | `grep -ri dlocal src/` → solo comentarios | Orden real: merge → revisión → credenciales de sandbox → adaptador |
| **B-6** | **Ningún punto de pagos se puede ver fuera de local.** `/api/pagos/checkout` devuelve **503** sin `STRIPE_PUBLISHABLE_KEY`, y esa clave solo está en `.env.local`. `docs/ENTORNOS.md:83` afirma lo contrario y **es falso** | `src/app/api/pagos/checkout/route.ts:146-156`, `docs/ENTORNOS.md:75` | Dar de alta la variable en Vercel **antes** de comprometer fecha para MN-01 y MN-02 |

---

## 20.2 · Los 14 puntos, traducidos

Códigos **MN-xx** = punto de minuta. La columna «Veredicto» dice lo único que importa: si es código
nuevo, código que ya existe, o algo que no es código.

### Pagos e Integraciones

| | Punto | Veredicto | Esfuerzo |
| :-- | :-- | :-- | :-- |
| **MN-01** | Rediseño de UI de Stripe (quitar «lo alargado») | 🟠 **Son dos peticiones distintas y hoy se presupuestan como una.** El checkout es **Embedded Checkout** (`ui_mode:"embedded_page"`): el interior del recuadro es cromo de Stripe y **no se puede reestilizar** — los tipos del SDK no exponen `appearance` ni `layout`. Si «lo alargado» es **nuestro** contenedor (rejilla 360\|resto a ~650px, `max-w-[1120px]`), es CSS: **XS**. Si es **el resumen del pedido que Stripe pinta dentro del iframe** —que además duplica nuestro «Resumen del pedido»— obliga a cambiar de `ui_mode` a `'form'`: **M/L** | XS **o** M/L |
| **MN-02** | Campo «Nombre en la tarjeta» | 🟠 **Sí, pero dentro del recuadro de Stripe.** `name_collection: { individual: { enabled: true } }` existe en la versión de API fijada (`2026-07-29.dahlia`). ⚠️ La **etiqueta la escribe Stripe** (con `locale:'es'` será «Nombre», no el literal pedido). ⚠️ Dibujarlo nosotros **saca el proyecto de PCI-DSS SAQ A y lo mete en SAQ D** — se descartó a propósito, y está razonado en el código, en el backlog y en el Doc 2 | S |
| **MN-03** | DLocal como pasarela de respaldo | 🔴 **Bloqueado y mal planteado.** Mezcla dos cosas de coste muy distinto: **enrutado por geografía** (el dato ya lo soporta: `payments.provider` es `text` y existe `payment_routing_rules` → S/M **cuando haya cuenta**) y **failover en caliente** (no existe, no está diseñado, y hoy es **imposible sin migración**: `service_role` no puede reetiquetar `payments.provider`) | XL |

### Videollamadas y Clases

| | Punto | Veredicto | Esfuerzo |
| :-- | :-- | :-- | :-- |
| **MN-04** | Rediseño de la llamada tipo Google Meet | 🔴 **«Reutilizando el código existente» aplica al backend, no a la interfaz. La interfaz de vídeo no es nuestra.** Único punto de montaje: `DailyIframe.createFrame` (`live-room.tsx:168`) — **Daily Prebuilt**. Tiles, barra de micro/cámara/compartir, selector de dispositivos, indicador de red y **la reconexión automática que es el criterio de aceptación de US-803** viven dentro de un iframe cross-origin. Rediseñar = reescribir la capa de vídeo con `createCallObject` y reimplementar todo eso a mano. Ya diagnosticado como **N-25, XL, fuera de ventana**. Y **no hay pantalla en Figma**: el diseño hay que producirlo antes | XL |
| **MN-05** | Ventana de acceso de días (antes/después) | 🟠 **Implementable, pero no es cambiar una constante — y choca con el contrato firmado.** La ventana (10 min/10 min) está duplicada en **cinco sitios**, y el que manda no es `session_access_window()` sino **`close_expired_sessions()`**, con el umbral escrito a mano, que pasa la reserva a `completed` y fija `completed_at` — **el reloj del que cuelga el dinero del tutor**. Ampliarla sin desacoplar retrasa **todos los payouts**, contra el §12 del contrato (7–14 días). Y abre un agujero: el alumno podría cancelar **después** de la clase y cobrar el 50 % que el §17 le niega. 🟢 Dato bueno: `sessions.access_opens_at` / `access_closes_at` **ya existen en el esquema y están muertas** — el hueco estaba previsto | L |

### Chat y Reservas

| | Punto | Veredicto | Esfuerzo |
| :-- | :-- | :-- | :-- |
| **MN-06** | Chat solo tras reserva completada | 🔴 **Revierte M-12 (B-2).** ⚠️ Y un dato técnico que ahorra trabajo muerto: **ninguna política RLS puede imponer esto.** `conversations` no tiene política de INSERT para nadie y los dos caminos de creación son `SECURITY DEFINER`, que se saltan la RLS. La barrera va **dentro de `open_conversation`**, donde ya viven los otros tres frenos anti-spam | M |
| **MN-07** | Enlace de reserva enviable desde el chat | 🟠 **Viable, y recomendado como enlace estructurado** (el tutor elige una de sus mentorías y se envía como tarjeta con `messages.product_id`), no como URL en texto libre. ⚠️ **Tira en dirección contraria a MN-06**: el valor de mandar el enlace es máximo justo en la conversación **pre-compra** que MN-06 quiere cerrar | M |
| **MN-08** | Contador de mentorías por conversación | 🟢 **Sí, y sin columna nueva**: se amplía `my_conversations()`, que ya cruza conversación y reservas. ⚠️ **«Mentoría» admite tres cuentas incompatibles** (títulos distintos / reservas / clases) y las tres dan números distintos. El filtro de estado debe ser **exactamente** el de `pair_has_booking`, o el mismo par dirá dos cosas en dos pantallas | S |

### Frontend y UX

| | Punto | Veredicto | Esfuerzo |
| :-- | :-- | :-- | :-- |
| **MN-09** | Placeholder de imágenes | 🟢 **Sí.** Hoy hay **tres conductas distintas** y ninguna usa un asset: dos bandas grises y un `null`. 🟢 **Sin depender de Diana**: reutilizar el **icono de categoría** que ya existe en BD (`20260805120000`) sobre fondo de marca — cero arte nueva | S |
| **MN-10** | Quitar la dirección del pie | 🔴 **Deshace DL-03 (B-3).** Matiz útil para negociar: el domicilio **no desaparece del sitio** si se quita del pie — sigue en `/contacto` y en el §39 de los Términos. ⚠️ **No tocar `lib/company.ts`**: arrastraría el §39 de los Términos en los dos idiomas | XS |
| **MN-11** | Límite de subida en el chat | 🟢 **Ya está hecho: 10 MB, impuestos por el bucket, server-side.** Las subidas van directas navegador→Storage, así que el bucket es el único punto de aplicación real. Falta **el número que quiere el cliente**. ⚠️ **Trampa verificada:** los cinco buckets se crearon con `on conflict (id) do nothing` y **no hay ni un `update storage.buckets` en el repo** — copiar ese patrón para cambiar el tope es un **no-op silencioso** que pasa el `db:push` en verde | S |

### Infraestructura, Dominios y Referidos

| | Punto | Veredicto | Esfuerzo |
| :-- | :-- | :-- | :-- |
| **MN-12** | Referral Factory por embed | 🟠 **Nada nuestro lo bloquea** (`next.config.ts` está vacío, no hay CSP). Lo bloquea **RF**: si sirve la campaña con `X-Frame-Options: DENY`, no hay implementación posible. **Comprobación de 5 minutos que decide el punto entero.** Si la sirve, es **XS**: sustituir un `<Link target="_blank">` por un `<iframe>` | XS **o** imposible |
| **MN-13** | Typeform en el dominio + app a subdominio | 🔴 **El gate: no (B-4).** 🟢 **El subdominio: casi gratis** — `NEXT_PUBLIC_SITE_URL` en Vercel y ya. Lo caro no es el código: es reconfigurar OAuth de Google, allow-list de Supabase, webhook de Stripe y los enlaces de los correos | S (subdominio) / XL (gate) |

### Estrategia

| | Punto | Veredicto | Esfuerzo |
| :-- | :-- | :-- | :-- |
| **MN-14** | Campaña de tutores con beneficios bilaterales | 🔴 **No existe NADA de promociones**: ni tabla, ni columna, ni función, en 35 tablas. Y no es «un descuento en el checkout»: entra en **`create_booking`, el snapshot financiero congelado** (regla de oro 2). Antes de escribir SQL hay que responder **quién paga el descuento** —plataforma o tutor—, porque es lo que decide si `tutor_net_amount` cambia. 🟢 **La mitad barata sí se entrega ya**: el «registro de las últimas clases impartidas» es una RPC de segmentación (**S**) y sirve aunque la campaña no se apruebe. ⚠️ Y la campaña **exige** tocar la privacidad publicada y añadir consentimiento de marketing: sin eso es una infracción de un texto vivo | XL (+ S aprovechable) |

---

## 20.3 · Las nueve preguntas al cliente — un solo mensaje, listo para enviar

Sin estas respuestas, siete de los catorce puntos no se pueden empezar. Van con la consecuencia
puesta, no en abstracto.

| # | Pregunta | Bloquea |
| :-- | :-- | :-- |
| **P-1** | **¿La minuta se escribió sabiendo que el chat pre-compra entró el 17-ago a las 19:28?** La reunión y el commit son del mismo día. Si es marcha atrás consciente, se hace; si no, quizá ya está resuelto | MN-06, MN-07 |
| **P-2** | **La dirección del pie: ¿molesta cómo se ve, o no queréis publicar el domicilio?** Si es lo primero se resuelve maquetando. Si es lo segundo, avisamos por escrito de que debilita el requisito que dLocal revisa a mano, justo antes de la revisión | MN-10 |
| **P-3** | **¿Qué URL exacta se presentó a dLocal Go, y cuál se va a presentar ahora?** Lleva sin respuesta desde el 17-ago y es el único punto que ningún merge arregla | MN-13, MN-03 |
| **P-4** | **La captura de «el diseño alargado» del checkout.** Si es nuestro contenedor son minutos; si es el resumen que pinta Stripe dentro de su recuadro, es cambiar de modo de checkout. Son dos presupuestos distintos | MN-01 |
| **P-5** | **El campo del titular: ¿obligatorio u opcional? ¿También al guardar una tarjeta desde el perfil?** (Si no, las tarjetas guardadas seguirán sin nombre.) Y: la etiqueta la escribe Stripe en español — ¿se acepta «Nombre»? | MN-02 |
| **P-6** | **La sala abierta: ¿cuántos días antes y cuántos después?** Y la que de verdad importa: **¿aceptáis que el tutor cobre esos mismos días más tarde**, o desacoplamos «puedo entrar» de «la clase terminó»? Recomendamos desacoplar. *(Y una previa: si es para coordinarse antes de la clase, eso ya es el chat.)* | MN-05 |
| **P-7** | **El contador: «3 mentorías» ¿son tres títulos distintos, tres compras o tres clases?** Los tres números son distintos sobre las mismas filas | MN-08 |
| **P-8** | **El límite de subida: ¿qué número?** Hoy son 10 MB y funcionan. Para referencia: portadas 5 MB, materiales 10 MB, KYC 10 MB | MN-11 |
| **P-9** | **La campaña: ¿quién absorbe el descuento, la plataforma o el tutor?** Sin esa respuesta el esquema no se puede escribir. Y ¿es un caso de Referral Factory —que ya está contratado— o un motor propio? | MN-14 |

---

## 20.4 · Los lotes ejecutables

Cada **ficha** está escrita para que un agente la ejecute sin más contexto que el repo. Dentro de un
lote las fichas son **independientes y paralelizables**; entre lotes hay **barrera**.

### 🔴 Lote 0 · Desbloqueo — va primero y no es negociable

No es paralelo con nada: es la barrera de todo lo demás.

| Ficha | Qué | Quién | Agente |
| :-- | :-- | :-- | :-- |
| **L0-1** | **Merge `dev` → `main`** con ventana propia. Antes: Google en prod (credenciales propias) y decidir qué se hace con la fila de `payment_routing_rules` de producción, que hoy convive con una `STRIPE_API_KEY` de *test mode*. Arrastra ~30 migraciones de una tacada | Jose | ❌ humano |
| **L0-2** | `STRIPE_PUBLISHABLE_KEY` en Vercel (Preview **y** Production). Sin ella el checkout es 503 fuera de local | Jose (panel) | ❌ humano |
| **L0-3** | `NEXT_PUBLIC_REFERRAL_URL` en Vercel. Sin ella el bloque de referidos ni se pinta | Jose (panel) | ❌ humano |
| **L0-4** | Cargar la URL de la campaña de RF dentro de un `<iframe>` y mirar `X-Frame-Options` / `frame-ancestors`. **5 minutos que deciden MN-12 entero** | Jose | ✅ sí |
| **L0-5** | Leer en el panel de Supabase (dev **y** prod) el `file_size_limit` vigente de los cinco buckets. Si alguno se creó desde el dashboard, **el repo no es fuente de verdad** ahí | Jose | ❌ humano |
| **L0-6** | Enviar las nueve preguntas de §20.3 | Verónica | ❌ humano |
| **L0-7** | **Corregir la documentación que miente** (§20.6). Dos correcciones, con `grep` de respaldo en el commit | — | ✅ sí |

---

### 🟢 Lote 1 · Sin decisión de cliente — se puede lanzar en paralelo hoy

Seis fichas independientes. Ninguna espera respuesta de nadie.

**L1-1 · MN-09 · Placeholder de portada de mentoría** · `S` · sin migración
> **Objetivo:** que una mentoría sin foto deje de dejar un hueco. Hoy hay **tres** conductas
> distintas: banda gris en `product-card.tsx`, banda gris en `featured-products.tsx` y `null` en la
> ficha de detalle.
> **Cómo:** reutilizar el **icono de categoría** que ya existe (`categories.icon`, migración
> `20260805120000`, mapa en `src/components/catalog/category-icons.ts`) sobre un fondo de marca, y
> unificar las tres conductas en un único componente. **Cero arte nueva → no bloquea con Diana.**
> **Ficheros:** `src/components/catalog/product-card.tsx`, `src/components/home/featured-products.tsx`,
> `src/app/(public)/products/[id]/page.tsx`, `src/lib/catalog/format.ts`, `src/lib/catalog/queries.ts`
> (añadir `icon` a los selects).
> **Trampa:** `unoptimized` hoy es incondicional porque las URLs de Supabase no están en
> `next.config.ts`. Un asset local **sí** debe optimizarse.
> **Aceptación:** las tres superficies pintan lo mismo; una mentoría sin `image_path` no deja hueco
> en portada, catálogo ni ficha.

**L1-2 · MN-08 · Contador de mentorías por conversación** · `S` · **con migración**
> **Objetivo:** que la conversación sepa cuántas mentorías hay detrás. Hoy `my_conversations()`
> devuelve `has_booking boolean` y el último título — un sí/no, nunca un recuento.
> **Cómo:** **no** una columna materializada. `create or replace function public.my_conversations()`
> añadiendo al `returns table` **dos** enteros: `product_count` (`count(distinct b.product_id)`, la
> lectura literal de «mentorías») **y** `session_count`. Entregar los dos **elimina la dependencia de
> P-7**: el cliente solo decide cuál se pinta.
> ⚠️ **El filtro de estado debe ser exactamente el de `pair_has_booking`.** La migración de M-12 ya
> dice por qué: «dos definiciones distintas de "es mi alumno" acabarían discrepando». Si es viable,
> extraer `pair_booking_stats(student, tutor)` y que `pair_has_booking` lea de él.
> **Orden obligatorio:** `db:push` → `db:types` → desplegar frontend. Cambia la **firma** de la RPC;
> si el front llega antes, lee una columna que no existe.
> **Aceptación:** la bandeja pinta el número; `npm run typecheck` pasa con los tipos regenerados.

**L1-3 · MN-05a · Desacoplar el `exp` del token del `exp` de la sala** · `XS`
> **Objetivo:** cerrar el **único riesgo de seguridad real** de MN-05, sin esperar a P-6.
> Hoy el `exp` del *meeting token* se hereda del de la sala. Si mañana la ventana pasa a días, se
> estarían firmando credenciales válidas **durante días**, contra el criterio declarado de que el
> token es efímero.
> **Cómo:** firmar el token corto (duración de la sesión + margen) aunque la sala viva más.
> **Ficheros:** `src/app/api/room/[sessionId]/route.ts:62`, `src/lib/daily.ts:54-57` y `:115`.
> **Refutación útil que va en el commit:** Daily **no factura por sala abierta**, sino por
> minuto-participante. El coste **no** es un argumento contra MN-05; el token sí lo era.

**L1-4 · Purga de hilos vacíos inmortales** · `XS` · **con migración**
> **Objetivo:** tapar una fuga que existe **hoy**, independientemente de MN-06. La purga de 30 días
> mira `last_message_at`, que es `null` en un hilo sin mensajes: esos hilos **no se purgan nunca**.
> **Cómo:** `coalesce(c.last_message_at, c.created_at) < now() - interval '30 days'`. Una línea.
> **Aceptación:** un hilo abierto y nunca usado desaparece a los 30 días.

**L1-5 · MN-11a · Una sola fuente de verdad para los topes de subida** · `S`
> **Objetivo:** dejar el terreno listo para P-8 y quitar una trampa conocida. El número está
> duplicado en **seis** sitios de cliente (`ATTACHMENT_MAX_BYTES`, dos en `upload-formats.ts`, y
> `MAX_BYTES` en `avatar-upload`, `materials-upload` y `verification-form`), más los literales
> «máx 10 MB» escritos a mano en siete líneas del formulario de verificación.
> **Cómo:** que todos importen de `src/components/tutor/upload-formats.ts` —que ya lo pide en su
> propia nota— y que los literales se generen del valor, no se escriban.
> ⚠️ **No cambiar todavía ningún número**: eso es P-8, y cuando llegue va como
> `update storage.buckets set file_size_limit = …`, **nunca** como un `insert … on conflict do
> nothing` — el repo no tiene ni un `update storage.buckets` y copiar el patrón existente sería un
> no-op silencioso.
> **Aceptación:** cambiar el valor en un sitio cambia todos los mensajes de la UI.

**L1-6 · Cierre de C-01 y N-18** · `XS`
> Dos renglones sueltos que llevan pendientes desde la semana pasada y no dependen de nadie:
> · `site-footer.tsx:72` dice **«tutorías en vivo 1 - 1»** — se escapó del barrido de vocabulario del
> 18-ago (`2c55ef0`). Es cadena nuestra, y se cambia. *(El contrato dice «clase» 23 veces: eso **no
> se toca**, es el documento del cliente — ver §20.6.)*
> · **N-18**: `enable_prejoin_ui: false` en las propiedades de sala (`src/lib/daily.ts`), que quedó
> fuera del bloque 0 del Doc 19. ⚠️ **Si MN-04 se aprueba, esto queda absorbido** por el prejoin
> propio y no debe hacerse dos veces.

---

### 🟠 Lote 2 · Una respuesta → un ticket

Cada ficha se lanza **en cuanto llegue su respuesta**, no cuando lleguen todas. No hay barrera entre
ellas.

| Ficha | Punto | Espera | Trabajo, ya diseñado |
| :-- | :-- | :-- | :-- |
| **L2-1** | **MN-01** | P-4 + L0-2 | Si es nuestro contenedor: `max-w-[420..480px] mx-auto` alrededor de `<StripeEmbed/>` y unificar con los **560px** de `/reservas/[id]/pagar` — hoy el mismo iframe se ve con dos anchos según por dónde entres. Si es el resumen de Stripe: `ui_mode:'form'` + `<CheckoutForm/>` de `@stripe/react-stripe-js/checkout`, que **sí acepta `appearance`**, sobre la **misma** Checkout Session — webhook, idempotencia y X-02 no cambian. En los dos casos: `branding_settings` en la Session (naranja #fe6a00) y quitar la duplicación de «Resumen del pedido» |
| **L2-2** | **MN-02** | P-5 + L0-2 | `name_collection: { individual: { enabled: true, optional: … } }` en **los dos** sitios que crean Session (el cobro y el alta de tarjeta). ⚠️ **Versionar la clave de idempotencia**: se compone por reserva, y al desplegar las Sessions ya abiertas chocarían |
| **L2-3** | **MN-06** | **P-1** | `create or replace function public.open_conversation(uuid)` con `if not public.pair_has_booking(...) then raise` **después** de la comprobación de tutor aprobado. **No** escribir políticas RLS: no las evalúa nadie. **No** revertir `9305c1c` ni editar `20260817210000` (regla de oro 5). ⚠️ **No cerrar `send_conversation_message` a secas**: `send_message` delega en ella cuando el par no ha comprado, y cerrarla rompe el chat de un checkout a medias — el alumno vería «no tienes mentoría con este tutor» en la pantalla de su propia reserva. Y decidir por escrito qué pasa con los hilos existentes (§20.6) |
| **L2-4** | **MN-07** | P-1 | Enlace **estructurado**: `messages.product_id` con `on delete set null`, el tutor elige una de sus mentorías, se pinta como tarjeta. La descarga del chat (`.txt`/`.json`) tiene que decir algo del mensaje-enlace: hoy solo vuelca `body` |
| **L2-5** | **MN-05** | **P-6** | Poblar `sessions.access_opens_at` / `access_closes_at` al confirmar la reserva y que `join_session` **lea** esas columnas en vez de recalcular. **Y desacoplar `close_expired_sessions()`**, que hoy comparte el `+10 minutes` por accidente. En la misma pasada: cerrar el agujero de `cancel_booking` al 50 % después de la clase, que contradice el §17 del contrato |
| **L2-6** | **MN-11b** | P-8 + L0-5 | `update storage.buckets set file_size_limit = …` + los espejos que L1-5 dejó unificados. Verificar con **una subida real**, no con `tsc` |
| **L2-7** | **MN-10** | **P-2** | Si se confirma: quitar **solo** la línea del pie (`site-footer.tsx:89-90`). **No tocar `lib/company.ts`** ni `/contacto` ni los Términos. Y **nunca antes del merge**: hoy el revisor sigue viendo el pie viejo, sin identidad y con tres redes muertas |
| **L2-8** | **MN-12** | **L0-4** | Si RF permite el embebido: sustituir el `<Link target="_blank">` por un `<iframe>` en `referral-card.tsx`. Si no: no hay implementación posible y se dice así. ⚠️ El embed **no toca la atribución** en ninguno de los dos casos — ver §20.6 |

---

### 🔵 Lote 3 · Épicas — requieren aprobación de alcance, no un ticket

| Ficha | Punto | Postura |
| :-- | :-- | :-- |
| **L3-1** | **MN-04** (llamada tipo Meet) | **Recomendación: no en esta ventana.** Ofrecer la alternativa barata: quedarse en Prebuilt y pulir **lo que sí es nuestro** — barra de sesión, modo teatro, panel de chat y un prejoin propio **previo** al iframe. Si aun así se aprueba, el alcance **debe** incluir explícitamente: reconexión de red (US-803), selector de dispositivos, compartir pantalla, casos borde de permisos y responsive móvil — y **antes**, diseño de Diana, que no existe. ⚠️ Reescribir el componente resucita dos bugs ya cerrados: el React #418 de RV-18 (`771ab09`, pantalla en blanco **en producción**) y el botón duplicado que se quitó en N-24 |
| **L3-2** | **MN-03** (dLocal) | **Trabajo aprovechable hoy, sin cuenta:** extraer el puerto `PaymentProvider` que el Doc 6 ya especifica, y generalizar el webhook y el job de reembolsos. Quita la mayor parte del coste de después y **no depende de dLocal**. El adaptador, cuando haya sandbox. ⚠️ Antes de nada, preguntar qué significa «falla»: si es «tarjeta rechazada», choca con la decisión ya tomada de **no** cancelar en `payment_intent.payment_failed` — y reintentar un rechazo en otro PSP es reintentar un rechazo |
| **L3-3** | **MN-14a** (registro de clases impartidas) | **Se entrega ya, y sirve aunque la campaña no se apruebe.** RPC `tutor_teaching_record` `SECURITY DEFINER` con `impartidas`, `no_shows`, `ultima_clase`, `alumnos_distintos`, más índice parcial. ⚠️ Decidir si es métrica **interna** o **pública**: si va al perfil, toca `tutors_public` y cambia la superficie expuesta |
| **L3-4** | **MN-14b** (motor de promociones) | **Épica nueva, no ticket.** Bloqueada por **P-9**. Diseño mínimo defendible: `promotions` + `promotion_redemptions` con RLS default-deny, `bookings.discount_amount` (backfill trivial: hoy `subtotal_amount = total_amount` en todas las filas), y `create_booking` validando la promoción **dentro** de la función. ⚠️ **Y no es opcional:** la privacidad publicada declara hoy una finalidad que una campaña promocional infringe — hay que reescribir esa sección y añadir consentimiento de marketing con baja, **y `npm run check:terms` tiene que seguir pasando** |
| **L3-5** | **MN-13** (dominio) | Partir en dos: **el subdominio** es configuración (`NEXT_PUBLIC_SITE_URL` en Vercel; el código ya lo lee) más una lista de reconfiguraciones externas — OAuth de Google, allow-list de Supabase, webhook de Stripe, enlaces de los correos. **El gate de Typeform: después de la aprobación de dLocal, nunca antes**, y viviendo en una ruta propia, no delante de la aplicación |

---

## 20.5 · Lo que NO se va a hacer, y por qué — dicho para poder enseñarlo

- **No se reestiliza el interior del recuadro de Stripe.** No es una decisión de estilo: los tipos
  del SDK instalado no exponen `appearance` ni `layout` en Embedded Checkout. Hay iframe de por medio.
- **No se dibuja el formulario de tarjeta con campos propios.** Saca el proyecto de PCI-DSS **SAQ A**
  y lo mete en **SAQ D**. El Figma lo dibuja; se descartó a propósito y está razonado en tres sitios.
- **No se pone un Typeform delante de la plataforma antes de que dLocal apruebe.** Esconde a la vez
  DL-01, DL-02, DL-03 y DL-05.
- **No se quita la dirección del pie antes del merge.** Hoy el revisor todavía ve el pie viejo: se
  estaría retirando algo que **aún no ha cumplido su función**.
- **No se escriben políticas RLS para MN-06.** No las evaluaría nadie: los dos caminos de creación son
  `SECURITY DEFINER`.
- **No se revierte `9305c1c` ni se edita `20260817210000`.** Migración aplicada = inmutable
  (regla de oro 5). La marcha atrás, si la hay, es una migración **nueva** con `create or replace`.
- **No se escribe el adaptador de dLocal sin sandbox.** Es el patrón que ya produjo
  `process_notifications()` marcando correos como enviados sin enviar ninguno.
- **No se da por bueno ningún cambio de Stripe con `tsc`.** La unión de `ui_mode` acaba en
  `OtherString` y traga cualquier cadena: `embedded_page` vs `embedded` compilaba y devolvía **400**
  contra la API real. Se ejercita contra *test mode* o no está hecho.

---

## 20.6 · Cuatro trampas verificadas — y dos documentos que mienten

**1. `ref_email` no existe.** `CLAUDE.md`, `BACKLOG.md`, `PLAN-DESARROLLO.md` y `QA-LANZAMIENTO.md`
afirman los cuatro que «se activó `ref_email`» y que «la atribución va por email contra su API, no
por la cookie». **`grep -rn ref_email src/ supabase/` devuelve cero.** Lo implementado es exactamente
el mecanismo que esos documentos declaran inviable: cookie `ey-ref` → `profiles.referral_code`.
`REFERRAL_FACTORY_API_KEY` tampoco se lee en ninguna línea de código. → **Consecuencia para la
minuta:** hoy no hay atribución por email que un embed pueda romper. **El embed y la atribución son
dos temas separados**, y el segundo está entero por hacer. *(Ficha L0-7.)*

**2. `docs/ENTORNOS.md:83` dice que `STRIPE_PUBLISHABLE_KEY` «no la lee nadie».** Quedó obsoleto
cuando el checkout pasó a Embedded: la lee `publishableKey()` y su ausencia es un **503**.
*(Ficha L0-7.)*

**3. Los hilos existentes de MN-06 no se quedan huérfanos solos: hay tres poblaciones.**
· **A** — los del *backfill* de M-12, cuyo `group by` **no filtra por estado**: creó un hilo por cada
par con **cualquier** reserva, incluidos los `pending_payment` de un checkout abandonado.
· **B** — los abiertos desde la ficha pública desde el 17-ago. **Solo existen en dev.** Es el
argumento más fuerte de que la marcha atrás es barata: **en producción no hay nada que migrar.**
· **C** — los de pares que sí compraron. No les afecta nada.
A y B seguirían **visibles y escribibles** si solo se cierra `open_conversation`. Hay que decidirlo y
escribirlo en la migración: o solo-lectura hasta que la purga se los lleve, o borrar **únicamente los
vacíos** (`not exists (select 1 from messages …)`). Borrar hilos **con** mensajes destruye datos de
usuario y no se hace en una migración sin decisión escrita del cliente.

**4. El vocabulario diverge a propósito, y conviene cerrarlo.** El contrato publicado el 17-ago dice
«clase» **23 veces** (incluidos dos títulos de sección) mientras el producto pasó a «mentoría» el
18-ago. El barrido dejó fuera el contrato **a conciencia**: es el documento que redactó el cliente y
`check:terms` vigila que sus porcentajes sigan coincidiendo con `lib/policy.ts`. → **Pregunta de una
línea para Néstor:** ¿actualizamos el contrato, o asumimos que el producto dice mentoría y el
contrato clase? **`terms-content.ts` no se toca desde desarrollo bajo ningún concepto.**

---

## 20.7 · Qué cabe antes del 28–29 de agosto

Siete días hábiles, y la mitad de la minuta espera respuesta.

**Cabe:** el Lote 0 entero, el Lote 1 entero, y del Lote 2 lo que llegue con respuesta — MN-01 en su
variante barata, MN-02, MN-11b, MN-10 y MN-12 son todos S o menos.
**Cabe con la respuesta puesta pronto:** MN-05 (L) y MN-06 (M). Los dos arrastran migración.
**No cabe:** MN-04 y MN-14b. Son épicas, y decirlo el 20 vale más que decirlo el 28.
**No depende de nosotros:** MN-03 y MN-13, que esperan a dLocal — **que a su vez espera al merge.**

> Y una advertencia que ya estaba escrita en el Doc 19 y sigue siendo la misma: **lo que no está
> ejercitado no está hecho.** Los reembolsos siguen sin mover un euro, el cobro tardío no se ha
> probado con un pago real y nadie ha visto llegar un correo. Esa lista pesa más que los catorce
> puntos de esta minuta, porque es dinero.

---

## 20.8 · Cierre del Lote 1 — qué quedó hecho y qué NO

Ejecutado el **20-ago** por cuatro agentes en paralelo con ficheros disjuntos (uno solo dueño de la
base de datos, para que no hubiera dos `db:push` a la vez), más tres revisores adversariales sobre el
diff combinado. **`npm run lint`, `npm run typecheck`, `npm run check:terms` y `npm run build`: los
cuatro en verde.** Todo en `dev`, sin desplegar.

### Lo cerrado

| Ficha | Qué quedó |
| :-- | :-- |
| **L1-1 · MN-09** | `ProductCover`: las cuatro superficies públicas pintan lo mismo ante una mentoría sin foto — icono de categoría sobre fondo de marca, cero arte nueva. **Eran cuatro, no tres**: `ProductCard` lo pintan además `/tutors/[id]` y el panel del alumno |
| **L1-2 · MN-08** | `my_conversations()` devuelve `product_count` y `session_count`. Se extrajo `pair_booking_stats`, y `pair_has_booking` **lee de ella**: la lista de estados de «este par compró» existe ahora una sola vez |
| **L1-3 · MN-05a** | El *meeting-token* de Daily dejó de heredar el `exp` de la sala. El parámetro pasó de `expiresAt` a `endsAt` **para que el `exp` de la sala no pueda volver a colarse** |
| **L1-4** | La purga cubre los hilos que se abrieron y nunca se usaron (`coalesce(last_message_at, created_at)`) |
| **L1-5 · MN-11a** | Los seis espejos del tope de subida importan de `upload-formats.ts`, y las frases se generan del número. **Ningún número cambió** — eso es P-8 |
| **L1-6 · N-18** | `enable_prejoin_ui: false`, comentado como propiedad exclusiva de Prebuilt para que el rediseño de MN-04 sepa que la absorbe |
| **L1-6 · C-01** | El pie, el `<h2>` de la portada y cuatro comentarios. **`grep -i tutoría src/` fuera de los legales: 0** |

### 🔴 Lo que encontró la revisión — y no era cosmético

| # | Hallazgo | Estado |
| :-- | :-- | :-- |
| 1 | **`pair_booking_stats` nació con `grant execute … to authenticated`.** Es `SECURITY DEFINER`, recibe el par **por parámetro** y no mira `auth.uid()`: PostgREST la publicaba como RPC y cualquier autenticado podía preguntar por **dos uuid elegidos por él**. El grant además no hacía falta — sus dos consumidores son `DEFINER` y la llaman como su dueña | 🟢 **Cerrado** y **verificado contra dev con una sesión real**: la RPC devuelve `42501 permission denied` y `my_conversations` sigue funcionando |
| 2 | **`npm run lint` en rojo** por `react-hooks/static-components` en el componente nuevo. CI corre lint en cada push: el lote no se podía mergear | 🟢 Resuelto con `createElement` y el porqué escrito al lado |
| 3 | **La purga borraba también los hilos bloqueados.** `blocked_at` vive **solo** en esa fila, así que borrarla desbloqueaba al par en silencio: `open_conversation` devolvía un hilo nuevo, sin bloqueo y con los contadores anti-spam a cero | 🟢 `and c.blocked_at is null` |
| 4 | **La purga se fiaba de un backfill que corre después que ella.** Riesgo real aunque estrecho (el cron es diario a las 04:00), y el borrado arrastra mensajes por cascada | 🟢 Resuelto sin renumerar migraciones aplicadas: una guarda que mira los mensajes de verdad, y que **solo puede impedir borrados, nunca provocarlos** |

Las cuatro correcciones van en `20260820150000_correcciones_revision_lote1.sql`.

### 🔴 Lo que NO está hecho, aunque lo parezca

| # | Qué | Por qué importa |
| :-- | :-- | :-- |
| 1 | **Nadie ha visto el placeholder con los ojos.** Pasa build y typecheck; no se ha arrancado `npm run dev` ni se ha mirado en las cuatro superficies, y el tamaño del icono es el detalle con más miga (px fijo se desmadra en la ficha, % se desmadra en la rejilla) | Es un cambio **visual**: `tsc` no dice nada de si se ve bien |
| 2 | **Salió una migración de más que no estaba en ninguna ficha:** `20260820140000`, un `update` que rellena `last_message_at` en las conversaciones sembradas por M-12. Está justificada —sin ella la purga nueva podía llevarse hilos con mensajes reales— pero es **escritura de DATOS**, no DDL | Va a ejecutarse contra producción en la ventana de L0-1 junto a las ~30 atrasadas. **Quien haga ese merge tiene que saber que ahí dentro hay un `update`**, no solo esquema |
| 3 | **`pair_has_booking` conserva su `grant … to authenticated`** (viene de M-12) y filtra el mismo par en versión booleana | Es un agujero **preexistente y más pequeño**, no lo abrió este lote. Cerrarlo cambia comportamiento existente y **merece su propia ficha**, no ir de polizón en una corrección |
| 4 | **`queries.ts:190` (`withProductFacts`) sigue sin `icon`**, así que las burbujas de categoría de las tarjetas de **tutor** pintan siempre el genérico | Preexistente. Ticket de una línea, pero toca `tutor-card.tsx`, que no era de ninguna ficha |
| 5 | **El panel del tutor sigue con conducta propia** para la portada sin foto (miniatura 64×64 con iniciales) | Queda fuera **a propósito** —no es superficie pública— y está anotado en el componente |

> **Nada de esto cambia la barrera:** el Lote 1 vive en `dev`, y `dev` sigue sin llegar a `main`.
> **L0-1 sigue siendo lo primero.**

---

*Faim Lab · Doc 20 · Plan de acción sobre la minuta del 17-ago · 20 de agosto de 2026.*
