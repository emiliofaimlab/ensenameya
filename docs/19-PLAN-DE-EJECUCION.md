# DOC 19 — Plan de ejecución (agosto–septiembre 2026)

> **Qué es esto.** La continuación ejecutable del **Doc 18**. Coge todo lo que se pidió la semana
> pasada —los requisitos de dLocal Go, el correo de Néstor sobre los términos, la lista de Verónica
> del lado tutor y el Word de contenido de Ennis— lo **contrasta contra el código de `dev`** y lo
> ordena por lo único que hoy manda: **el camino crítico de dLocal Go**.

| Campo | Valor |
| :-- | :-- |
| **Documento** | 19 — Plan de ejecución |
| **Fecha** | 2026-08-17 |
| **Autor** | Jose Mora (desarrollo) |
| **Base** | `docs/18-PLAN-CONSOLIDADO-DE-MEJORAS.md` v2 (Emilio, 16-ago) |
| **Fuentes nuevas** | Requisitos de validación de dLocal Go · **`DLocal Legal Requirements.pdf` (Néstor, 17-ago) — T&C de 39 secciones en inglés y español** · Correo de Verónica 17-ago (lado tutor) · Word de Ennis 12-ago (contenido, 18 capturas) |
| **Verificación** | Auditoría de código sobre `dev` @ `32f2281`, 8 áreas + pasada adversarial. **Todo estado de este documento está comprobado contra el código, no contra la documentación.** |
| **Fecha objetivo del equipo** | 28–29 de agosto de 2026 |
| **Actualizado** | **2026-08-17, al cierre** — `dev` @ `e28572e`. Estado por bloque revisado contra los 19 commits del día; el recuento y **lo que sigue sin verificar** están en **§19.10** |

---

## 19.0 · PLAN DE HOY — lunes 17 de agosto

> ### 🟢 Cierre del día — leer §19.10 antes que nada
>
> Este apartado se escribió por la mañana y se ha quedado corto por arriba: se hizo el paquete de
> dLocal **y** buena parte de §19.7, incluidos **X-01 y X-02**, que el plan mandaba a mañana. El
> recuento honesto —qué se cerró, con qué commit, y sobre todo **qué NO está verificado**— está en
> **§19.10**. Se conserva el texto original de abajo, con su estado añadido, porque la diferencia
> entre lo que se planeó y lo que salió es información.
>
> **Lo único que no se movió ni un milímetro es lo que más pesaba: `main` sigue en el commit del
> 29 de julio.** Todo lo de hoy está en `dev`.

> **Alcance de hoy = el paquete de validación de dLocal Go, entero.** Con el PDF de Néstor
> (`DLocal Legal Requirements`, 17-ago) ya no queda nada bloqueado por terceros en esta ruta: trae
> **razón social, EIN, domicilio, correo, ley aplicable e idioma gobernante**. Se puede cerrar hoy.
>
> **Y no cabe nada más.** Lo de §19.7 en adelante no entra hoy y no se va a fingir que sí.

### Los datos que desbloquea el PDF — copiar literal, sin acentos en la razón social

```
Ensename Ya, LLC
EIN: 42-2277169
815 Bayside Lane
Weston, Florida 33326
Estados Unidos
Info@ensenameya.com
```

| Dato | Valor | Cierra |
| :-- | :-- | :-- |
| Forma jurídica | **Persona jurídica (PJ)** — LLC de Florida | **DL-03** |
| Ley aplicable y foro | Estado de Florida, EE. UU. (§33) | **DL-05** |
| Idioma gobernante | **Inglés** (§38); el español es traducción de cortesía | T-02 |
| Reembolsos | §13: ≥24 h **100 %** · <24 h **50 %** · §15 tutor cancela **100 %** | **DL-06** |
| No-show del alumno | §17: **sin reembolso**, el tutor cobra igual | Cierra **C-05** (DP) |
| Payouts | §12: entre **7 y 14 días** tras la clase | Coincide con el código |
| Proveedor de pago | §11: «podrá incluir **dLocal Go** y otros» — redacción abierta, correcta | — |
| Canal de disputas | §18: el alumno abre disputa escribiendo a Enséñame Ya | Lo cubre `/contacto` |

> ✅ **Los porcentajes del contrato coinciden con `lib/policy.ts` al dígito.** No hay que reconciliar
> nada ni tocar la política. Comprobado contra §13 y §15.

### El día, por orden de dependencia

| # | Tarea | Tiempo | Quién | Estado al cierre |
| :-- | :-- | :-- | :-- | :-- |
| **H-0** | **Encender Google en Supabase Auth** (dev + prod) y meter la URL de callback en la allow-list | 20 min | **Jose (panel)** | 🟢 **hecho en dev** y login probado de punta a punta. **Prod no** — necesita sus propias credenciales |
| **H-1** | `adaptive_pricing: { enabled: false }` — se acaba el cobro en PAB con 4 % de recargo | **5 min** | Jose | 🟢 `3b6fb88`. ⚠️ Sin comprobar contra un checkout real |
| **H-2** | **Footer:** fuera LinkedIn y X (404) · bloque legal con razón social, EIN y domicilio · `Info@ensenameya.com` como `mailto:` · enlace «Contacto» | 30 min | Jose | 🟢 `1fca00f` — y se fue también Instagram, que tampoco se había comprobado |
| **H-3** | **`/contacto`**: formulario nombre + correo + mensaje → `POST /api/contacto` → correo real **+ fila en BD** para que nada se pierda si el correo falla · bloque de identidad legal · honeypot | 2–3 h | Jose | 🟠 `dc89ddd` — construido y probado contra el handler. **Nadie ha visto llegar el correo** |
| **H-4** | **Términos de Néstor, EN + ES.** `legal-doc.tsx` pasa a mapa por idioma · `/terms` (ES) y `/terms/en` (EN, **gobernante**) · exportar `TERMS_VERSION = "2026-08-17"` | 2–3 h | Jose | 🟢 `d2fa263`, con las rutas al revés de lo previsto: `/terms` sirve el **inglés** (es el que gobierna y el que se acepta) y `/terms/es` el español |
| **H-5** | **Aceptación en el registro:** migración `terms_acceptances` · el dato viaja en el metadata de `signUp` y lo persiste `handle_new_user` · **cerrar el bypass de Google** · la casilla enlaza a la versión **inglesa** | 2 h | Jose | 🟢 `bfc9a13`, los cinco casos verificados contra dev. ⚠️ Las cuentas anteriores a hoy **no tienen fila** |
| **H-6** | **Variables:** `RESEND_API_KEY` en Vercel · `CRON_SECRET` en Vercel **y** GitHub (mismo valor) · `APP_BASE_URL` en GitHub | 20 min | **Jose (paneles)** | 🟢 **CERRADA el 30-ago.** Al 17-ago quedó a medias y a propósito (§19.10). Lo que faltaba resultó ser **solo el lado GitHub**: `CRON_SECRET` ya estaba en Vercel. Las dos variables entraron el 30 y los dos workflows pasaron a verde. ⚠️ **Costó 30 corridas en rojo** (27→30-ago) |
| **H-7** | **Merge `dev` → `main`** y verificar que las tres legales, `/contacto` y el footer están vivos en producción | 1 h | Jose | 🟢 **Hecho el 26-ago** (`3fca8b2`). De rebote es lo que dio reloj a los crons — y lo que destapó H-6, porque a partir del 27 empezaron a fallar en rojo cada pocas horas |
| **H-8** | Avisar a dLocal | 5 min | Verónica | 🔴 Depende de H-7 |

### Cuatro avisos de ejecución, para no tropezar

1. **H-6 antes que H-3 se dé por buena.** Un formulario que encola en silencio **no cumple DL-01**:
   dLocal prueba enviando y esperando respuesta. Y ⚠️ **poner `RESEND_API_KEY` dispara toda la cola
   de notificaciones acumulada** — mirar qué hay encolado antes de pulsar.
   > 🔵 **Corrección del cierre: este aviso estaba mal, y por suerte del lado seguro.** La clave
   > **no** dispara nada por sí sola: desde `20260806150000` quien envía es el job
   > `/api/cron/notifications-send`, así que hacen falta **la clave y un reloj**. Por eso hoy se puso
   > la clave (H-3 la necesitaba) y **no** se dieron de alta `CRON_SECRET` ni `APP_BASE_URL`: el
   > gatillo es el cron, y detrás hay **126 correos de prueba** esperando, ~89 de ellos a buzones que
   > no existen. Procedimiento para vaciarlos: `docs/QA-LANZAMIENTO.md` §4.6.
   > 🔵 **Epílogo del 30-ago.** El cron se encendió **sin** vaciar la cola, y no pasó nada: la
   > variable `APP_BASE_URL` apunta a **producción**, y esos correos están en **dev**. Fue suerte, no
   > diseño. Y la cola ha crecido: hoy son **336**, no 126.
2. **El remitente sigue siendo `onboarding@resend.dev`** porque el dominio propio no está verificado.
   Funciona, pero un correo de contacto que no llega desde `@ensenameya.com` es lo que un revisor
   marca. **Verificar el dominio en Resend hoy si se puede; si no, queda anotado.**
3. **H-5 tiene una trampa que ya mordió con `referral_code`:** con la confirmación por correo activa
   **no hay sesión después de `signUp`**, así que un `insert` desde el cliente falla en silencio. El
   dato tiene que ir en el metadata y persistirlo el trigger. **No hay atajo.**
4. **H-7 no es un merge de trámite:** arrastra 20 migraciones a producción, más Stripe, correo y
   purga de grabaciones. Va al final del día, con la cabeza fresca y revisando el resultado.

### Lo que NO entra hoy, dicho claro

Los reembolsos que sí devuelven dinero (**X-01**), el agujero del cobro tardío (**X-02**), las horas
mal (**RV-03**), el lado tutor de Verónica, el contenido de Ennis y todo el bloque 6. Están
ordenados de §19.7 en adelante y **empiezan mañana**.

> 🔴 **Con una excepción que hay que mirar hoy aunque no se arregle hoy:** el §13 del contrato que
> vamos a publicar promete que los reembolsos se devuelven **al medio de pago original**. Hoy el
> código **solo los anota en la base de datos** (X-01). Publicar ese texto convierte un fallo
> técnico en **una promesa contractual incumplida**. No bloquea la validación de dLocal, pero
> **X-01 pasa a ser lo primero de mañana**, no lo tercero.

> 🟢 **Se adelantó casi todo.** X-01, X-02, RV-03 y el lado tutor de Verónica entraron hoy mismo
> (§19.10). Lo que sigue sin empezar de esta lista es **el contenido de Ennis** y **el bloque 6**
> entero, que sigue sin caber. La excepción de arriba se cerró el mismo día en que se creó: los
> Términos se publicaron por la mañana y por la tarde los reembolsos ya encolaban contra Stripe — con
> el matiz importante de que **encolar no es haber devuelto**: falta que alguien programe el job y
> que un pago real recorra el camino entero.

---

## 19.1 La lectura de conjunto, en cuatro frases

**1. dLocal Go es la ruta crítica de todo, y casi no es desarrollo.** De los siete requisitos que
pide dLocal para validar el sitio, **cero están completos**. Pero solo **uno** es código de verdad
(el formulario de contacto). Dos son **datos que solo puede dar el cliente** (identidad fiscal y
redes sociales reales), uno es **un merge** y tres son **texto y despliegue**.

**2. Y dLocal bloquea el lado tutor entero.** Verónica pide «conectar payouts al sandbox» (N-09).
No hay sandbox que conectar: **no existe ningún adaptador de pagos al tutor** —ni dLocal, ni Stripe
Connect— y dLocal Go está esperando a que el sitio pase la revisión. El bucle es literal:
*sitio web → aprobación de dLocal → payouts → poder verificar el dinero del tutor*. Todo lo demás
del lado tutor se puede hacer en paralelo; esto no.

**3. `main` va 66 commits por detrás de `dev`, y eso hace que el trabajo ya hecho no cuente.**
`/terms`, `/privacy` y `/cookies` **no existen en producción** y el footer de producción **las
enlaza igual**: hoy, un revisor de dLocal que abra el sitio ve tres 404 legales, dos redes sociales
muertas y ninguna página de contacto. Los textos legales están escritos y están bien escritos —
pero no están publicados.

> 🔴 **Al cierre del 17-ago esta frase es más cierta, no menos: son 85 commits y 30 migraciones.**
> Todo lo de hoy —legales del cliente, `/contacto`, identidad fiscal, reembolsos reales, cobro
> tardío, horas correctas— se sumó a la pila. **El día que más se produjo es el día que más creció la
> distancia con lo que un revisor puede ver.**

**4. Hay tres cosas que no salieron en ninguna reunión y pesan más que media lista.** Están en
§19.3. La peor: **ningún reembolso mueve dinero de verdad.**

> 🟠 **Las tres se atacaron el mismo día** (§19.3). Pero la peor sigue teniendo un asterisco que hay
> que leer: los reembolsos **ya se encolan** contra Stripe y **todavía no se ha movido un euro**,
> porque el job que los ejecuta no lo llama nadie. Escrito ≠ ejecutado.

---

## 19.2 Correcciones al Doc 18 (verificadas contra el código)

Cuatro puntos del Doc 18 cambian de diagnóstico. No de prioridad: de **causa**. Ir a arreglarlos por
donde dice el Doc 18 sería trabajo perdido.

> 🟢 **Los cuatro se cerraron el 17-ago**, y los cuatro por la causa de este apartado y no por la del
> Doc 18 — que es justo lo que este apartado servía para evitar. Estado por punto al final de cada
> uno; el recuento con commits, en §19.10.

### 🔴 M-08 · El acceso con Google no es un bug: el proveedor está apagado

La captura de Ennis (Word, imagen 9) lo cierra sin margen de duda:

```
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

Eso lo devuelve `lbtpnszjjsxbeileqsja.supabase.co` —el proyecto de **dev**— antes de tocar una sola
línea nuestra. **Google no está dado de alta como proveedor en Supabase Auth.** No hay nada que
depurar en el frontend: falta crear las credenciales OAuth en Google Cloud, pegarlas en Supabase
(dev **y** prod) y meter la URL de callback en la allow-list. `docs/ENTORNOS.md:130` ya lo tenía
apuntado como pendiente desde el 5-ago y nadie lo cerró.

> **El bloqueante nº 1 del Doc 18 son 30 minutos de panel, no una historia de desarrollo.**

Ahora bien, **hay un segundo fallo real detrás**, y solo se verá cuando el proveedor esté encendido:
`src/app/auth/callback/page.tsx` es una página de cliente (se convirtió de Route Handler a página
para poder enseñar la pantalla de espera del Figma) y **canjea el código PKCE dos veces** — una
automáticamente por `createBrowserClient` y otra explícitamente. El segundo canje falla y manda a
`/login` aunque la sesión ya esté creada. Hay que desactivar `detectSessionInUrl` o quitar el canje
explícito. **Enciende primero, arregla después: el orden importa para no perseguir fantasmas.**

> 🟢 **Cerrado el 17-ago, y el orden dio la razón.** Encendido el proveedor en **dev**, el login
> funciona de punta a punta: la sesión se crea y el callback redirige a `/onboarding?next=/app`. El
> fantasma que se destapó fue **otro**: la pantalla se quedaba **en blanco**, porque el proyecto no
> tenía **ningún** error boundary (`e797fc7` añade `error.tsx` y `global-error.tsx`, con el `digest`
> a la vista, que es lo único que casa un error minificado de producción con su traza en Vercel).
>
> ⚠️ **Queda M-08 en prod:** el proyecto `nrzsyysqanbrcgtslfte` necesita **sus propias** credenciales
> de Google. Las de dev no valen. Si se mergea sin eso, el botón sale roto en producción.

### 🔴 RV-03 · Las horas mal: la hipótesis del Doc 18 está refutada

El Doc 18 dice que `/reservas`, `/reservas/<id>` y `/tutors/<id>` aplican la zona del servidor y que
basta con copiarles la lógica de `/reservar/<id>`. **No es así: las cuatro pantallas ya pasan
`timeZone` explícita**, y nueve más también. Copiar la lógica no cambiaría nada.

La causa real son **dos fuentes de zona horaria que no coinciden**:

| Superficie | De dónde saca la zona |
| :-- | :-- |
| Reserva y checkout (cliente) | La del **navegador** |
| Todo lo renderizado en servidor | `profiles.timezone`, que **nace en `'UTC'`** por defecto de BD |

Y `getUserTimezone()` devuelve ese `'UTC'` tal cual, sin caer a la cookie `ey-tz` que sí existe. El
desfase de +7 h es exactamente la diferencia entre UTC y la zona del que probaba.

**Se remata con esto:** el onboarding de **alumno** autodetecta la zona; el de **tutor** no —guarda
`'UTC'` si no tocas el selector. Son tres líneas de diferencia entre los dos formularios.

> **Comprobación de 10 segundos antes de tocar código:**
> `select id, full_name, timezone from profiles;` — si las cuentas de prueba dicen `'UTC'`, cerrado.

> 🟢 **Cerrado el 17-ago (`acd3f3f`), y la comprobación salió exacta:** de 25 perfiles en dev, **20
> con zona IANA y 5 con el literal `'UTC'`** — ese 20 % veía las horas corridas. Hicieron falta tres
> piezas más de las previstas: `TimezoneSync` estaba montado **solo en el layout público** (quien
> entraba directo a `/app` no dejaba nunca la cookie `ey-tz`, así que no había a qué caer), el
> asistente de tutor no proponía zona, y la detección salía de un `Intl` en el cuerpo del componente
> —zona del servidor en SSR, del navegador al hidratar—, que era el candidato principal del React
> #418 de RV-18.
>
> **Coste asumido y anotado:** si alguien eligiera `'UTC'` a propósito y su navegador dijera otra
> cosa, manda el navegador. La alternativa limpia —columna anulable o marca de "configurada"— toca
> `get_available_slots`, que la usan el catálogo público y el flujo de reserva a la vez.

### 🟠 N-34 · La cancelación sin confirmar: no reproduce del lado alumno

El flujo del alumno **sí tiene** pantalla de confirmación propia con el importe y el efecto del
reembolso. Lo que no la tiene es **el lado tutor**: es un `window.confirm()` nativo, fácil de
aceptar por inercia. Y las «muchas notificaciones» tienen explicación mecánica y correcta: una por
reserva abandonada, por dos destinatarios.

**Sigue habiendo trabajo, pero es otro** (diálogo propio del lado tutor) y **no es bloqueante.**
Antes de nada conviene confirmar con Verónica sobre qué build vio el síntoma: puede ser de un
despliegue anterior.

> 🟢 **Cerrado el 17-ago (`c4399b2`):** el lado tutor tiene pantalla propia, con qué se cancela,
> cuánto se devuelve y a quién se avisa — el mismo nivel que ya tenía el alumno. Y apareció un motivo
> mejor del previsto para quitar el `confirm()` nativo: **algunos navegadores lo suprimen tras varios
> diálogos seguidos y entonces devuelve `false`**, o sea que falla cerrado y sin decirlo.

### 🟡 N-22 · El chat que crece sin límite: tampoco reproduce

El hilo ya tiene alto acotado con scroll propio, en `dev` y en `main`. Lo que sí falta es
`wrap-anywhere`: una URL larga mete barra horizontal dentro del hilo. Es una clase de Tailwind.

> 🟢 **Cerrado el 17-ago (`0c68cd4`)**, y fue exactamente la clase de Tailwind.

---

## 19.3 Tres cosas que no salieron en ninguna reunión y pesan más que media lista

### 🔴 X-01 · Ningún reembolso mueve dinero de verdad

No existe **ninguna** llamada a `stripe().refunds.create` en todo el repo. Ni la cancelación con
RN-37, ni el reembolso del admin, ni el 100 % por vencimiento de las 24 h de aceptación. Los tres
escriben `payments.status = 'refunded'` en Postgres **y ahí se acaba**.

Mientras el ruteo estaba en `'simulated'` daba igual. **Con Stripe cobrando ya en test mode, no:**
la plataforma se anota reembolsos que el alumno nunca recibe. Y los legales publicados prometen
RN-37 con porcentajes exactos, importados de `lib/policy.ts` precisamente para que no puedan
divergir del código.

> Esto convierte la política de reembolsos —que es **requisito de dLocal (DL-06)**— en una promesa
> que el sistema no cumple. No es deuda técnica: es el dinero.

> 🟢 **Atacado el mismo día (`f49b88e`), con el patrón que el proyecto ya usaba para el correo: la BD
> ENCOLA, un job EJECUTA.** No valía "llamar a Stripe desde el Route Handler", porque uno de los tres
> caminos (`expire_stale_bookings`) corre en **pg_cron dentro de la base**, sin ninguna petición HTTP
> donde colgar la llamada, y Postgres no puede hablar con Stripe. Piezas: tabla `refund_requests`
> (`20260817170000`) con clave de idempotencia determinista y el importe **del tramo**, no del
> acumulado; `enqueue_refund` deliberadamente tonta (no calcula porcentajes: eso es RN-37/RN-38/el
> admin) y **sin grant a nadie**; y el job `/api/cron/refunds-process`, con doble idempotencia —el
> `unique` de la cola impide encolar dos veces, la `idempotencyKey` impide ejecutar dos veces— y
> fail-closed sin `CRON_SECRET`.
>
> Y salió un **bug de dinero preexistente que no estaba en ninguna lista**: `cancel_booking`
> **asignaba** `refunded_amount` en vez de acumular, así que un pago con 1500 ya devueltos por el
> admin que luego se cancelara tarde se quedaba registrando solo lo último — y `refund_payment`,
> que calcula lo pendiente como `gross_amount - refunded_amount`, habría devuelto esa diferencia
> **por segunda vez**. Cerrado con `greatest`.
>
> 🔴 **Pero X-01 NO está terminado, y conviene no leerlo como si lo estuviera.** Encolar no es
> devolver. Faltan dos cosas: **(a)** que alguien dé de alta `APP_BASE_URL` y `CRON_SECRET` para que
> el workflow `refunds-cron.yml` (cada 15 min) empiece a correr, y **(b)** que un pago real recorra
> el camino entero contra Stripe. Hay **una solicitud `pending` esperando en dev**, apuntando a un
> PaymentIntent de test mode: es el caso listo para esa primera verificación. Hasta que se haga, lo
> honesto es decir que el dinero **todavía no se ha movido ni una vez**.
>
> 🔵 **Al 30-ago: (a) hecho, (b) NO — y el matiz importa.** El workflow corre y devuelve 200, pero
> apunta a **producción**, donde la cola está vacía. Las solicitudes `pending` —ya son **2**— siguen
> en **dev**, donde no llega ningún reloj. Así que la frase de arriba se mantiene entera: **el dinero
> no se ha movido ni una vez**, y ahora además hay un job en verde que puede hacer creer lo
> contrario.

### 🔴 X-02 · Se puede cobrar por una clase que ya no existe

Tres piezas que por separado están bien y juntas abren un agujero:

1. La reserva sin pagar caduca a los **20 minutos** (job `expire_stale_bookings` en pg_cron) y deja
   el pago en `failed`.
2. La Session de Stripe se crea **sin `expires_at`**, así que vive el default de **24 horas**.
3. `confirm_payment` es idempotente contra `paid` y `refunded`… pero **`failed` no está en esa
   lista**, así que un pago que llega tarde lo pisa a `paid`.

Resultado: dejas el checkout abierto 21 minutos, pagas, y el dinero entra por una reserva que el
cron ya liberó. Sin clase, sin aviso y —por X-01— sin reembolso real. **No hace falta mala fe para
reproducirlo.** Es la mitad (c)+(d) de M-11 y merece ir junta.

> 🟢 **Cerrado el mismo día (`dd559b0`), y con un hallazgo que cambia el planteamiento: los dos
> plazos NO se pueden cuadrar.** Stripe exige que `expires_at` esté entre 30 min y 24 h, y nuestra
> ventana son **20**: no hay valor legal que coincida. Y aunque se subiera la ventana a 30 tampoco,
> porque los dos relojes **no arrancan a la vez** — la reserva nace al elegir horario y la Session
> cuando la persona llega a pagar. Alinearlos es un espejismo.
>
> Se acepta el mínimo de Stripe calculado **desde la reserva** (`created_at + 60`, determinista a
> propósito: la clave de idempotencia de la Session es la reserva, y un `now + 30` que cambia en cada
> recarga rompería el checkout con un error opaco). **La red de seguridad de verdad es el webhook**:
> antes de acreditar comprueba el estado de la reserva y, si ya no está pendiente de pago, llama a
> `refunds.create`. Es la **primera llamada de reembolso real del repo**, anterior incluso a X-01.
>
> ⚠️ **Sin ejercitar.** El camino completo —pagar tarde y ver el reembolso en Stripe— necesita un
> pago de prueba real y **no se ha hecho**.

### 🟠 X-03 · El alta con Google se salta la casilla de términos

`<GoogleButton>` se renderiza **antes** del `<form>` y su `onClick` nunca lee el estado `accepted`.
Quien pulsa «Registrarme con Google» crea cuenta **sin haber marcado nada**. Y como el alta entera
ocurre en el navegador (`supabase.auth.signUp` desde el cliente, sin Route Handler propio), la
aceptación **no deja rastro en ninguna parte**.

Hoy, ante dLocal, **no hay forma de demostrar que un usuario concreto aceptó un texto concreto.**
Es justo lo que pide Néstor. Ver §19.5.

> 🟢 **Cerrado el 17-ago (`bfc9a13`).** Una **tabla** y no una columna, porque el §34 dice que los
> términos van a cambiar y con una columna aceptar la v2 borraría la constancia de la v1 — justo la
> que hay que poder enseñar si alguien discute una compra hecha bajo la v1. Dos caminos de escritura,
> porque hay dos formas de darse de alta: por correo el dato viaja en el metadata de `signUp` y lo
> persiste `handle_new_user` (⚠️ **no se puede escribir desde el cliente después del alta**: con la
> confirmación por correo activa no hay sesión y el insert falla en silencio — el mismo fallo que ya
> documentaba `referral_code`), y por Google la versión viaja en la URL de vuelta y la graba el
> callback. El botón de Google bloquea el clic sin la casilla, con el mismo mensaje que el submit.
>
> Lo que hace que la constancia valga: **el propio interesado no puede crearla ni borrarla** (403 en
> insert y delete). Una constancia editable por el interesado no es una constancia.
>
> ⚠️ **Dos límites conocidos.** (1) Se **registra**, no se **exige** en servidor: `signUp` es el
> endpoint de Supabase y no se puede interceptar sin un Route Handler de alta, que hoy no existe.
> Quien se salte la casilla desde la consola se queda sin constancia — no es un vector contra
> nosotros, pero conviene saberlo. (2) **Las cuentas anteriores a hoy no tienen ninguna fila**:
> aceptaron una casilla que no dejaba rastro y de un texto distinto. O se les pide aceptar la versión
> nueva al entrar —lo contempla el §34— o se da la anterior por buena. Lo segundo es más cómodo y más
> débil. **Es decisión de negocio y hay que preguntarla antes de lanzar.**

---

## 19.4 Ruta crítica dLocal Go — los siete requisitos, uno por uno

Estado real hoy. **Ninguno completo.**

> 🟢 **Al cierre del 17-ago: cinco de siete resueltos en `dev`.** Los dos que faltan son los dos que
> nunca fueron código — **DL-04** (URLs reales, las pide el cliente) y **DL-07** (el merge). Y hay
> una trampa de bulto: **todo lo resuelto está en `dev`, y dLocal mira producción.** Mientras no haya
> merge, un revisor sigue viendo exactamente lo mismo que la semana pasada. La columna de estado de
> abajo dice `dev`; ninguna dice `prod`.

| # | Requisito de dLocal | Estado | Quién | Esfuerzo |
| :-- | :-- | :-- | :-- | :-- |
| **DL-01** | Formulario de contacto funcional (nombre, correo, mensaje) que **envíe de verdad** | 🟠 **Hecho en `dev`** (`dc89ddd`): `/contacto` + `POST /api/contacto`, con el mensaje guardado en `contact_messages` **antes** de intentar el correo, tope de 3 por IP cada 10 min y honeypot. `RESEND_API_KEY` ya puesta. ⚠️ **Nadie ha visto llegar un correo todavía** — hasta entonces no está cumplido | Jose | **M** |
| **DL-02** | Datos de contacto visibles con canales reales | 🟢 **Hecho en `dev`** (`1fca00f`): `Info@ensenameya.com` como `mailto:` en el pie, no enterrado en el §11. Sin teléfono: sigue dependiendo del cliente | Jose + **cliente** | S |
| **DL-03** | Identidad legal del negocio (PJ: razón social + ID fiscal · PF: administrador + documento) | 🟢 **Hecho en `dev`** — `Ensename Ya, LLC` · EIN 42-2277169 · Weston, FL, en el pie y en `/contacto`, desde `lib/company.ts` y no repetido por las pantallas. Razón social **sin acentos**, como está registrada en Florida; la marca sí los lleva | Jose | S |
| **DL-04** | Redes sociales que lleven a perfiles reales, o ninguna | 🟠 **Las tres fuera** (`1fca00f`) — también Instagram, que tampoco se había comprobado. El array queda vacío y el pie no pinta nada; devolverlas es **una línea** cuando el cliente mande URLs reales. **Sigue esperando al cliente** | **Cliente** → Jose | **XS** |
| **DL-05** | T&C propios que expliquen cómo se contrata, condiciones de uso y el proceso | 🟢 **Publicados en `dev`** (`d2fa263`): las 39 secciones de Néstor, transcritas literalmente. `/terms` sirve el **inglés (gobernante, §38)** y `/terms/es` el español, con el aviso de idioma **arriba y visible en las dos** | Jose | S |
| **DL-06** | Política de devoluciones explicada | 🟢 **Cubierto por el contrato** — §13 (100/50 %), §15 (tutor cancela, 100 %), §17 (no-show) y §18 (disputas por escrito a la plataforma, que es la vía de reclamación que faltaba). ⚠️ **Y ya se ejecuta**: X-01 encola contra Stripe. Falta verlo mover dinero una vez | Jose | XS + X-01 |
| **DL-07** | Sitio completo, sin enlaces rotos ni información faltante | 🔴 **SIN TOCAR.** Producción sigue en el commit del **29-jul**: tres 404 legales, sin `/contacto`, sin identidad fiscal y con las redes rotas todavía servidas | Jose | Merge |

### El orden en que hay que hacerlo

**Paso 0 — hoy mismo, sin esperar a nadie (2 horas)**

1. **Borrar los enlaces de LinkedIn y X del footer.** Dos líneas. Elimina dos 404 verificados que
   están **también en producción ahora mismo**. dLocal lo dice explícitamente: mejor ningún icono
   que un icono muerto.
2. **Sacar `info@ensenameya.com` al footer, como `mailto:`.**
3. **Encender Google en Supabase Auth** (dev y prod) — cierra el bloqueante nº 1 del Doc 18.

**Paso 1 — pedir al cliente, en un solo mensaje (Verónica)**
Lo de §19.6. Sin esto, DL-02, DL-03 y DL-04 no se pueden cerrar por mucho que se programe.

**Paso 2 — construir `/contacto` (Jose, ~1 día)**
Página pública con: formulario nombre + correo + mensaje → Route Handler que valida y envía ·
bloque de identidad legal · correo y teléfono visibles · las redes que existan de verdad. Enlace
en el footer y en el `aside` de FAQ de *Cómo Funciona*, que hoy promete respuesta en 24 h y no
ofrece dónde escribir.

> ⚠️ **Trampa:** `sendEmail()` ya está construido, pero **sin `RESEND_API_KEY` no manda nada**.
> Un formulario que encola en silencio **no cumple DL-01**: dLocal prueba enviando y esperando
> respuesta. Y el remitente por defecto es `onboarding@resend.dev` — un correo de contacto que no
> llega desde `@ensenameya.com` es exactamente lo que un revisor marca. Ver RV-04 en §19.7.

**Paso 3 — merge `dev` → `main`**
Resucita DL-05 y DL-06 de golpe. **No es un merge de trámite:** arrastra 20 migraciones a
producción, más Stripe, correo y purga de grabaciones. Necesita su propia ventana y su repaso.

**Paso 4 — avisar a dLocal.**

---

## 19.5 Los términos de Néstor — qué respondemos

> ### ✅ Actualización 17-ago: llegó el documento y está resuelto
>
> `DLocal Legal Requirements.pdf` — **39 secciones, bilingüe** (inglés páginas 1-16, español 17-34).
> Es **solo Términos y Condiciones**: no trae política de privacidad ni de cookies, así que
> **`/privacy` y `/cookies` se quedan como están** (son nuestras y describen el sistema real).
>
> **Lo que queda contestado:**
> - **El tutor NO acepta aparte.** Confirmado por el cliente: basta con la aceptación al registrarse.
>   El §1 del contrato lo respalda («al crear una cuenta… acepta estos Términos»).
> - **La versión abierta ya viene hecha.** El §11 dice «podrá incluir **dLocal Go** y otros
>   proveedores seleccionados en cada momento» — nombra sin atarse. Es exactamente lo que hacía falta.
> - **El inglés gobierna** y el propio texto lo dice en su §38, así que no hay que añadir cláusula.
> - **Ley aplicable y foro:** Florida (§33). Cierra el hueco de DL-05.
>
> **Dos cosas que conviene saber antes de publicarlo:**
> - **El §6 describe el flujo que tenemos hoy** (elegir tutor → revisar → elegir fecha → confirmar →
>   pagar → confirmación). Es decir: **el contrato describe el flujo actual, no el carrito de N-36.**
>   Un argumento más para no precipitar ese cambio — si se hace, hay que tocar el contrato.
> - **El §2.1 abre la puerta a menores** con perfiles dependientes bajo la cuenta de un adulto. Eso
>   **no existe en el producto**. El texto es permisivo («podrá»), así que no miente; pero conviene
>   que Néstor sepa que hoy no hay ninguna funcionalidad de menores.

Néstor pide tres cosas y hace una pregunta. Van una a una — con lo que ya está resuelto marcado.

### «Que aparezcan en el registro y con un click se acepten» → **Sí, y ya hay media pieza**

La casilla existe en `/signup`. Lo que no existe es que **valga legalmente**:

| Hueco | Qué falta |
| :-- | :-- |
| El alta con Google **se la salta** (X-03) | Deshabilitar el botón mientras no esté marcada, o mover la aceptación al callback |
| La validación vive en un `if` del navegador | Puerta en servidor |
| **No se guarda en ninguna parte** | Migración: quién, cuándo, qué documento, qué **versión**, qué **idioma** |
| El documento **no tiene número de versión** | Exportar un `TERMS_VERSION` desde `legal-doc.tsx` — es la pieza que bloquea todo lo demás |

> ⚠️ **Trampa conocida, ya mordió una vez con `referral_code`:** con la confirmación por correo
> activa **no hay sesión después de `signUp`**, así que un `insert` desde el cliente falla en
> silencio. El dato tiene que viajar en el metadata del alta y persistirlo el trigger
> `handle_new_user`, que es como se resolvió aquella vez.

**Orden:** versión → migración de aceptaciones → cerrar el bypass de Google. **Esfuerzo: S + S.**

### «El tutor también» → **Hoy solo acepta una vez, como alumno**

El tutor acepta en el alta general, **antes de saber que va a ser tutor** y antes de conocer las
condiciones de comisión y liquidación del §8. Si dLocal quiere aceptación del tutor **como tutor**,
hace falta un segundo consentimiento en el onboarding de tutor. **Preguntárselo a Néstor.**

### «El inglés es la versión gobernante y los usuarios DEBEN aceptar esa» → **Se puede, con dos avisos**

Se puede hacer y no es caro **si nos limitamos a los documentos legales**: los tres textos están en
un solo archivo con render genérico, así que convertirlo en un mapa por idioma es mecánico. Lo caro
es la traducción jurídica, que es trabajo de redacción, no de código. **Esfuerzo: M.**

> ⚠️ **Aviso 1 — no confundir esto con «la app en inglés».** Traducir los legales es **M**;
> traducir la aplicación son 514 cadenas en 142 archivos, 35 puntos de formato de fecha, el locale
> de Stripe y las plantillas de correo: **XL**. Son dos proyectos de tamaño incomparable.

> ⚠️ **Aviso 2 — el §4 no es texto fijo.** Interpola los porcentajes de RN-37 desde `lib/policy.ts`
> a propósito, para que el texto no pueda mentir sobre lo que hace el código. **La versión inglesa
> tiene que reproducir esas interpolaciones**, no ser una traducción congelada, o los dos idiomas
> divergirán la primera vez que cambie la política.

> 🟠 **Y una cuestión de negocio, no de código:** obligar a un público de LatAm a aceptar un
> contrato en inglés como versión gobernante es una decisión defendible para una empresa de Florida,
> pero conviene que la tome Néstor con los ojos abiertos, no de rebote.

### «¿Redacto una versión abierta que no hable de dLocal sino de las plataformas de pago?» → **Sí, por favor, y es importante**

**Sí, y hay que insistir en ello.** Los términos **no deben nombrar ningún proveedor concreto**:

- Hoy cobramos con **Stripe**; mañana con **dLocal Go**; la arquitectura es agnóstica a propósito.
- Los términos que el cliente ya tiene publicados en **`ensenameya.com`** (GoDaddy, marzo-2026)
  nombran **«Stripe o Mercado Pago»** — que no es lo que usamos. Ese error es exactamente lo que se
  evita no nombrando a nadie.

### ⚠️ Y el problema de fondo: hay **tres** juegos de términos vivos para la misma marca

| Dónde | Qué dice | Problema |
| :-- | :-- | :-- |
| `ensenameya.com` (GoDaddy, marzo-2026) | «Stripe o Mercado Pago»; reembolsos vagos («puede variar según cada caso») | Es la URL que **suena** a oficial y **no enlaza a la app** |
| El repo (`legal-doc.tsx`) | RN-37 con porcentajes exactos, importados del código | **404 en producción** |
| La campaña de Referral Factory | Plantilla sin rellenar | — |

Traducir al inglés sin resolver esto **crea un cuarto texto**. Antes de traducir hay que decidir
**cuál es EL contrato** y que el resto desaparezca o apunte a él. Y esto enlaza con el problema de
los dos dominios que ya bloqueó el alta de dLocal: **ningún merge lo arregla, es DNS y negocio.**

---

## 19.6 Lo que queda por pedir al cliente

**El PDF del 17-ago contestó seis de las diez.** Esto es lo que queda.

### Bloquea todavía la ruta crítica de hoy

| # | Qué pedimos | Bloquea |
| :-- | :-- | :-- |
| 1 | **URLs reales de las redes sociales.** Las que hay son inventadas y dos dan 404. **Hoy las quitamos**; si existen perfiles reales, que los manden y las devolvemos | **DL-04** |
| 2 | **¿`Info@ensenameya.com` recibe y alguien contesta?** Lo publicamos hoy como canal oficial, y el contrato que vamos a firmar dice que las disputas se abren ahí (§18) | **DL-02, DL-01** |
| 3 | **¿Hay teléfono publicable?** Sí o no, en una línea | DL-02 |
| 4 | **¿Qué pasa con `ensenameya.com`?** Sigue sirviendo una landing de GoDaddy con **otros términos**, que nombran «Stripe o Mercado Pago». Ahora que hay un contrato de verdad, esa página vieja **lo contradice** | **DL-05, DL-07 y el PSP** |

> El nº 4 es el único que ningún merge arregla, y el único que puede volver a tumbar la validación:
> si dLocal audita `ensenameya.com` en vez de la app, ve el contrato equivocado.

> **Estado al cierre del 17-ago — las cuatro siguen abiertas, y ninguna se puede cerrar desde el
> código:**
> **(1)** Las tres redes **ya están fuera** del pie, así que DL-04 deja de ser un problema; devolverlas
> el día que lleguen URLs reales es una línea. **(2)** `Info@ensenameya.com` se publicó hoy como canal
> oficial en el pie y en `/contacto`, **sin que nadie haya confirmado que ese buzón recibe y que
> alguien contesta** — y el §18 del contrato dice que las disputas se abren ahí. Es la más urgente de
> las cuatro. **(3)** Sin teléfono, se publicó sin él. **(4)** Los dos dominios siguen sin conectar.

### No bloquea hoy, pero sí la semana

| # | Qué pedimos | Bloquea |
| :-- | :-- | :-- |
| 5 | **Referidos:** porcentajes por referido (**AB-09**) y si hay campaña de estudiantes (**AB-04**) | M-07 |
| 6 | **Nombres de los niveles de tutor** (**AB-06**) — las comisiones ya están fijadas (25/15/10 %) | N-16 |
| 7 | **Grabación de Daily:** add-on de pago **sin contratar**. Sin él, N-19/N-20/N-21 se pueden escribir pero **no se pueden entregar funcionando** | N-19, N-20, N-21 |
| 8 | **Ennis: ¿manda el Word o el documento de contenido?** Se contradicen entre sí (§19.8) | C-01, C-04 |

### Ya contestadas — no volver a preguntarlas

**PF o PJ** → PJ, `Ensename Ya, LLC`, EIN 42-2277169 · **Términos abiertos** → entregados, el §11
los deja abiertos · **Idioma gobernante** → inglés, §38 · **¿El tutor acepta aparte?** → no, basta
el registro · **Ley y foro** → Florida, §33 · **No-show del alumno** → sin reembolso, §17 (con esto
se cierra **C-05**, que llevaba abierta desde junio).

Y dos que se cierran entre Emilio y Jose en una llamada corta: **AB-01** (cuánto dura el chat tras
la clase) y **AB-02** (qué pasa al agotarse el tiempo de sesión).

---

## 19.7 Bloques de desarrollo

### Bloque 0 · Hoy (2 h) — todo desbloqueo, nada de riesgo · 🟢 **hecho salvo N-18**

| Punto | Qué | Estado |
| :-- | :-- | :-- |
| **DL-04** | Borrar LinkedIn y X del footer | 🟢 `1fca00f` (también Instagram) |
| **DL-02** | `info@ensenameya.com` al footer, como `mailto:` | 🟢 `1fca00f` |
| **M-08a** | Encender Google en Supabase Auth (dev + prod) | 🟠 **dev sí, prod no** |
| **M-01** | `adaptive_pricing: { enabled: false }` en la creación de la Session — **una línea** y se acaba el cobro en PAB con 4 % de recargo. En código, no en el panel: si se apaga solo en el panel, vuelve el día que se cree otra cuenta | 🟠 `3b6fb88`. ⚠️ `tsc` pasa pero aquí eso no demuestra nada — `ui_mode: "embedded_page"` también pasaba y devolvía 400 contra la API real. **Falta un checkout de prueba** |
| **N-18** | `enable_prejoin_ui: false` en las properties de la sala | 🔴 **sin hacer** — no está en el repo |
| **N-08, N-11** | Quitar «Acceso rápido», añadir «Ver todas» a reservas recientes | 🟠 N-11 hecho (`681dfce`); **N-08 sin verificar**: no hay ninguna cadena "Acceso rápido" en `src/`, así que o ya no existía o se llama de otra forma. Confirmar con Verónica sobre qué pantalla lo vio |

### Bloque 1 · La ruta crítica de dLocal (2–3 días) · 🟠 **todo menos el merge**

`/contacto` con formulario que envía (**DL-01**) · identidad legal cuando llegue (**DL-03**) ·
plazo y vía de reclamación en reembolsos (**DL-06**) · jurisdicción y ley aplicable (**DL-05**) ·
**merge `dev` → `main`** (**DL-07**) · `RESEND_API_KEY` + `CRON_SECRET` + `APP_BASE_URL`
(**RV-04** — es solo configuración, el código está entero).

> ⚠️ Poner `RESEND_API_KEY` **dispara toda la cola de notificaciones acumulada**. Revisar qué hay
> encolado antes de pulsar.

> 🟢 **DL-01, DL-02, DL-03, DL-05 y DL-06 cerrados en `dev` el 17-ago** (§19.4).
> 🔴 **Queda el merge (DL-07)**, que es el que hace que todo lo anterior exista para quien lo revisa,
> y **DL-04**, que espera al cliente.
> 🟠 **RV-04 a medias:** `RESEND_API_KEY` puesta; `CRON_SECRET` y `APP_BASE_URL` **no**, a propósito —
> ver la corrección del aviso 1 en §19.0 y el procedimiento de `QA-LANZAMIENTO.md` §4.6. Ahora esas
> dos variables mueven **tres** jobs, no dos: se sumó `refunds-cron.yml`.

### Bloque 2 · El dinero, que es donde duele (3–4 días) · 🟠 **escrito en un día; sin ejercitar**

| Punto | Qué | Estado |
| :-- | :-- | :-- |
| **X-01** | Reembolsos reales contra la API de Stripe en los tres caminos (cancelación RN-37, admin, vencimiento 24 h) | 🟠 `f49b88e` — encolan de verdad y hay job. **Falta programarlo y ver salir un euro** |
| **X-02** | `expires_at` en la Session + `failed` en la lista de idempotencia de `confirm_payment` + que el webhook rechace y reembolse pagos de reservas que ya no están pendientes | 🟠 `dd559b0`. **El camino completo no se ha ejercitado con un pago real** |
| **M-11** | Contador visible desde la selección del horario (el `created_at` de la reserva ya sirve) y corregir el texto de `slot-picker` que **hoy afirma lo contrario de lo que pasa** | 🔴 **sin hacer**, y ahora pesa más: ver el aviso de N-38 al final de §19.7 |
| **RV-03b/c/d** | Arreglar la fuente de zona horaria + autodetección en el onboarding de tutor + sanear las filas en `'UTC'` | 🟠 `acd3f3f` cierra b y c. **Las 5 filas en `'UTC'` no se sanearon**: el arreglo las tapa cayendo a la cookie, no las corrige |
| **M-08b** | El doble canje PKCE del callback | 🟢 tocado en `bfc9a13` al reescribir el callback para la aceptación de términos; el login con Google funciona de punta a punta en dev |

### Bloque 3 · Registro, términos y contenido (2–3 días) · 🟢 **todo salvo el contenido**

**T&C:** versión exportada → migración de aceptaciones → cerrar el bypass de Google (**X-03**) →
enlazar la versión inglesa cuando llegue. → 🟢 `d2fa263` + `bfc9a13`.
**M-05:** alta de dos campos en modal + nombre al paso 1 del onboarding de tutor. → 🟢 `fee79f9` +
`e28572e`. El alta ocurre en un **modal** sobre la página; `/signup` sigue existiendo como ruta para
enlaces externos, correos y el `next`.
⚠️ Quien elige «tutor» en el alta salta **directo** a `/tutor/onboarding`: si el nombre solo se pide
en el asistente de alumno, **los tutores se quedan sin nombre**. → contemplado.
**M-03:** persistir el paso del onboarding y pantalla de cierre en los dos. → 🟢 `fee79f9`. Era
bloqueante de verdad: *"yo nunca terminé… directamente me sacó"*.
**M-09:** buscador en los selectores largos y autodetección en el de tutor. → 🟢 `a1373a6`
(~420 zonas horarias y el país del teléfono, buscables por ciudad, región o desfase).
**RV-12:** contraseña a 8 — ⚠️ **también en el dashboard de Supabase**, o el navegador rechaza y la
API sigue aceptando 6. → 🟠 `a1373a6` sube el mínimo en el formulario; **el panel de Auth sigue en 6**,
o sea que la mitad que de verdad protege **está sin hacer**.
**Contenido (Ennis):** §19.8. → 🔴 **sin tocar hoy**, y sigue esperando la respuesta de §19.8.

### Bloque 4 · Lado tutor — lo de Verónica (3–4 días) · 🟢 **la mayor parte, en un día**

**N-13 + N-14 + N-28 de una sola vez.** Los tres chocan con lo mismo: `profiles` es *own-only* y el
tutor no puede leer ni el nombre del alumno. **Una sola migración** —vista con
`security_invoker = true` y columnas explícitas, patrón `tutors_public`— resuelve los tres. Hacerlos
por separado deja tres superficies distintas exponiendo `profiles`.

> 🟢 **Hecho el 17-ago (`681dfce`, `20260817150000`)**, con un cambio sobre el plan: no es una vista,
> es la **RPC `tutor_students`** `security definer`, acotada **por reserva compartida** y con columnas
> explícitas. ⚠️ **Es un cambio de privacidad, no de copy**: la primera excepción a que el tutor no
> vea ningún dato personal del alumno. Por eso nunca `profiles.*` —eso publicaría teléfono y
> objetivo— y por eso los intereses del alumno, que se sembraron privados, **no** se publican.
> Probado como atacante contra dev: un alumno normal no lista alumnos, no pide un perfil ajeno por id
> y sigue sin leer `profiles`; `anon` recibe 401.

**N-16** (nivel y split visibles): dos lecturas y dos etiquetas, **sin tocar esquema ni RLS**. Que
quede en el panel privado: la insignia de tier se dejó fuera del catálogo a propósito. → 🟢 `681dfce`.
**N-10** (verificación como checklist) → 🟢 `fee79f9`, distinguiendo "empezado" de "enviado" — el
`draft` cuenta como trabajo guardado pero deja la verificación **sin enviar**, y confundirlos sería
mentir · **N-12/N-15** (títulos y etiquetas) → 🟠 N-12 parcial (`56523eb`, portada) · **N-05/N-06/N-07**
(subidas del formulario de mentoría, los tres en la misma pasada) → 🟢 `c4399b2` · **N-01** (el CTA
reconoce el rol) → 🟢 `e28572e`, y ⚠️ el síntoma no era el del enunciado: quien caía en la pantalla de
conversión era el tutor que **aún no tiene el rol** (perfil pendiente), no el que ya lo tiene ·
**N-03** (la primera oferta sin salir del asistente) → 🟢 `fee79f9`.

> ⚠️ **Un detalle de N-03 que no es de N-03:** publicar exige tutor aprobado y lo fuerza un trigger,
> y el tutor nuevo está pendiente. La primera oferta **se crea pero no se publica**, y ahora la UI lo
> dice en vez de fingir.

### Bloque 5 · Después de que dLocal apruebe

**N-09 (payouts).** No es «conectar el sandbox»: **no existe adaptador de payouts**. Con dLocal Go
aprobado se construye contra dLocal; con Stripe haría falta Connect entero, que exige KYC. **L, y
empieza cuando dLocal responda.**

> ⚠️ Los jobs de payout son **pg_cron dentro de Postgres**, no crons de Vercel: grepear el repo no
> los encuentra. Un saldo sembrado para la demo **se convierte solo en «Ya pagado»** en el siguiente
> lote de los lunes. Verificar por SQL antes de enseñarlo.

### Bloque 6 · Lo grande, que no cabe antes del 29

Con criterio y en orden, **no en esta ventana**:

| Punto | Por qué no cabe |
| :-- | :-- |
| **N-36** carrito → checkout | **XL.** No son pantallas: el modelo ata un pago a **una** reserva de **un** producto. Un carrito de verdad exige una entidad «orden» por encima de `bookings` y rehacer el webhook. **Antes de escribir nada hay que confirmar que el cliente pide un carrito multi-mentoría de verdad y no simplemente «menos pasos»** — que es lo que resuelven N-32 y N-33 por una fracción del coste |
| **N-04** disponibilidad por mentoría | **XL.** Cambio de esquema + `get_available_slots` cambia de semántica, y esa función la usan el catálogo público y el flujo de reserva a la vez. Sin backfill, las mentorías existentes se quedan sin huecos de golpe |
| **N-25** layout propio de sala | **XL.** Es reescribir EP-08: con `call-object` se pierde gratis la reconexión automática, la gestión de dispositivos y la UI de compartir pantalla. Hay que reimplementar cada una |
| **M-12** inbox pre-compra | **XL**, y el Doc 18 ya lo pone después de pagos. Depende de N-23 (no leídos) |
| **N-17** eliminar cuenta | **L.** ⚠️ **No se puede «sustituir por null»**: `reviews.student_id` y `bookings.student_id/tutor_id` son `not null`. Hay que conservar la fila como lápida y anular solo las columnas de PII. Verónica ya lo marcó como «fase final, a discutir con el cliente» |
| **EX-05** cruce de categorías | **L**, y antes es un cambio de **permisos**, no una alerta: hoy `tutor_categories` **la escribe el propio tutor**, así que le basta con declararse la categoría para esquivar cualquier revisión |

**N-32 y N-33 sí caben**, y dan la mayor parte del beneficio de N-36: que `/reservar/<id>` acepte
`?slot=` y llegue con el horario marcado deja de ser «el mismo calendario otra vez» y pasa a ser
confirmación. Eso además cierra **M-10**.
⚠️ La página intermedia **no está vacía**: es la que resuelve la selección múltiple de los paquetes.
Borrarla sin más deja los paquetes sin forma de elegir sus N sesiones.

**N-37 (checkout aislado)** cabe y es **S**. **N-38 (formulario sin click extra)** cabe pero
⚠️ **choca de frente con M-11**: para que el formulario esté listo al llegar hay que crear la reserva
al **entrar** al checkout, lo que bloquea el horario antes de que la persona decida. Si se hace,
el contador de M-11 deja de ser deseable y pasa a ser obligatorio.

> 🟢 **N-32, N-33, N-37, M-10 y M-02 cerrados el 17-ago** (`fd4fd2a`, `a1373a6`). La página
> intermedia se conserva **solo** para paquetes, que era el motivo por el que no se podía borrar sin
> más. Y salió un bug que estaba escondido en medio: los dos calendarios agrupaban el día con
> criterios distintos —uno con `Intl` y `timeZone` explícita, el otro con `Date` local, que rompe en
> SSR—; ahora es uno solo.
>
> ⚠️ **M-02 cambia comportamiento de negocio, no es cosmético.** El interruptor de auto-aceptación
> baja del tutor a **cada mentoría**, y su default es **activado**: con auto-aceptación la reserva
> pagada salta directa a `confirmed` y **se salta `pending_acceptance`**, que es el estado que
> dispara la ventana de 24 h de RN-38 con su cancelación y su reembolso automáticos. Esa red deja de
> aplicarse a casi todas las reservas. **El cliente lo pidió así**, pero conviene que conste.
>
> 🟢 **La mitad de interfaz de M-02 se cerró el 27-ago.** El 17-ago solo bajó el backend: el ajuste
> no estaba en el formulario de la mentoría y el interruptor de `/tutor/reservas` seguía escribiendo
> `tutor_profiles.auto_accept_bookings`, que ya no lee nadie — un control que no cambiaba nada. Ahora
> el ajuste vive en el alta y la edición de la mentoría (dos opciones, no un switch, con la
> contrapartida del alumno escrita al lado), el interruptor global se retiró y la columna deprecada
> se borra en `20260827200000`. **El default sigue siendo «se confirma sola»**: es la decisión del
> cliente y no se revierte por la puerta de atrás; lo que se hizo fue explicarla. De paso se corrigió
> lo que se le prometía al alumno en un **pedido con varias mentorías**: se cuenta por línea, porque
> el texto único prometía la devolución automática también a las que se confirman solas.
>
> 🔴 **N-38 sigue sin hacer, y su choque con M-11 sigue vivo.** Como M-11 tampoco se hizo, hoy no hay
> contador: si se hace N-38 antes que M-11, se bloquean horarios antes de que la persona decida y sin
> avisarle de cuánto le queda.

---

## 19.8 Contenido — el Word de Ennis

Los commits del 12 y el 14 de agosto cubrieron **más de la mitad**. Estado real:

| | Punto | Estado |
| :-- | :-- | :-- |
| ✅ | **C-02** minúsculas en «aprende»/«enseña» | Hecho (incluida la categoría «Arte y diseño», ya aplicada en la BD de dev) |
| ✅ | **C-03** «Inversión por sesión» | Hecho |
| ✅ | **C-05** subtexto del hero de *Sobre Nosotros* | Hecho — por coincidencia: salió del documento de contenido el 12-ago, antes del Word |
| ✅ | **C-08** título y subtexto de *Cómo Funciona* | Hecho |
| ✅ | **C-09** FAQ de *Cómo Funciona* | Hecho |
| 🟠 | **C-01** «mentoría» en todo lo público | **Parcial y con conflicto** — ver abajo |
| 🟠 | **C-04** «clase» → «sesión» al reservar | Parcial: falta el CTA **«Reservar clase YA»**, que se dejó fuera **a propósito** porque el Figma y el documento de contenido lo piden así. **Decisión de Ennis + Diana, no de desarrollo** |
| 🔴 | **C-06** Bloque 1 de *Sobre Nosotros* | Sin hacer. ⚠️ **Trampa:** ese array lo consume **también la banda azul de la portada**. Cambiarlo cambia las dos pantallas |
| 🟠 | **C-07** otras preguntas de la FAQ | **No se puede cerrar sin las frases literales.** El Word no está en el repo y solo tenemos las capturas. ⚠️ Además, la respuesta nueva que se escribió dice **«clases teóricas interminables»**: el texto que arregló C-07 introduce una infracción de C-01 |
| 🔴 | **C-10** «el nosotros se esconde en el buscador» | Sin hacer, y **no reproduce desde el CSS actual**: el `<h1>`, el `<p>` y el buscador son hermanos en flujo normal, sin `absolute` ni márgenes negativos. La captura muestra el **buscador de la cabecera** tapando el enlace «Nosotros» del menú. Hay que reproducirlo a ese ancho antes de tocar nada |

### ⚠️ C-01 tiene un conflicto que solo puede resolver Ennis

Dentro del **mismo documento** hay dos peticiones que se contradicen:

- **C-01** pide «mentoría» en todo lo que hoy diga clase o tutoría.
- **C-08** —también de Ennis— fija como texto bueno un subtexto que dice **«lanzas tus tutorías»**.

Y hay un tercer frente: el commit `3b205df` cambió el contador de *Explorar mentorías* de
«mentorías disponibles» a **«tutorías listas para reservar»**, siguiendo el **documento de
contenido**. Es decir, el documento de contenido y el Word piden cosas distintas.

> **Sin cerrar esto, cualquier buscar-y-reemplazar rompe algo.** La regla que seguimos hoy es:
> **panel → «mentoría» · público → lo que diga el documento de contenido · «sesión» no se toca.**
> Quedan **16 cadenas con «clase» y 12 con «tutoría»** en la superficie pública, más 18 en los
> legales, que están fuera a propósito.

**Pregunta concreta para Ennis:** ¿manda el Word o manda el documento de contenido? ¿Y los legales
entran o no?

---

## 19.9 Qué cabe antes del 28–29 de agosto

Diez días hábiles. Con honestidad:

**Cabe:** los bloques 0, 1, 2 y 3 completos, y la mayor parte del 4.
**No cabe:** el bloque 6 entero (N-36, N-04, N-25, M-12, N-17, EX-05). Son cinco o seis semanas
de trabajo por sí solos.
**No depende de nosotros:** el bloque 5 (payouts) espera a dLocal, y dLocal espera al bloque 1.

Lo que sí se puede prometer para el 29 es **lo que importa para vender**: el sitio pasa la revisión
de dLocal, se cobra la cantidad correcta en la moneda correcta, los reembolsos devuelven dinero de
verdad, las horas se ven bien, salen los correos, se puede entrar con Google y el tutor ve con quién
tiene clase y cuánto se lleva.

Lo que no va a estar el 29 es el carrito, la disponibilidad por mentoría y la sala propia. **Es
mejor decirlo ahora que el 28.**

> 🟢 **Revisión al cierre del 17-ago:** los bloques 0, 1, 3 y 4 están prácticamente hechos y el 2
> está **escrito**. Diez días hábiles pasaron a nueve y el trabajo pendiente se redujo mucho más que
> un día. Pero el párrafo de arriba sigue siendo una promesa **y ninguna de sus cláusulas está
> demostrada todavía**: se cobra la cantidad correcta *según el código*, los reembolsos devuelven
> dinero *según el código*, y los correos salen *si alguien programa el cron*. La diferencia entre
> "escrito" y "comprobado" es exactamente el contenido de §19.10, y es lo que hay que gastar primero.

---

## 19.10 · Cierre del 17 de agosto — qué quedó hecho y qué NO

**19 commits.** El paquete de dLocal entero, más los bloques 2, 3 y 4 de §19.7, que estaban
planificados para el resto de la semana. Todo en `dev`; **nada en producción**.

### Lo cerrado, por tandas

| Commit | Puntos | Qué quedó |
| :-- | :-- | :-- |
| `4ce22c9` | — | Este documento |
| `3b6fb88` | **M-01** | Se acabó el 4 % de recargo del *adaptive pricing* de Stripe. Apagado **en código**, no en el panel: en el panel se pierde el día que se cree otra cuenta o se pase a live |
| `1fca00f` | **DL-02, DL-03, DL-04** | Identidad legal en el pie desde `lib/company.ts` · `mailto:` de verdad · fuera las **tres** redes inventadas |
| `e797fc7` | — | `error.tsx` y `global-error.tsx`. El proyecto **no tenía ninguno**: un error de cliente dejaba la pantalla en blanco, sin mensaje, sin traza y sin salida |
| `dc89ddd` | **DL-01** | `/contacto` + handler. El mensaje **se guarda antes** de intentar el correo, porque si solo mandara correo se habría perdido en silencio todo lo enviado antes de configurar Resend — y el primero en probarlo va a ser el revisor de dLocal |
| `d2fa263` | **DL-05, T-02** | Los Términos del cliente, EN (gobernante) + ES, transcritos literalmente. `check:terms` comprueba que `lib/policy.ts` sigue coincidiendo con el §13/§15 |
| `bfc9a13` | **X-03** | `terms_acceptances`: quién, cuándo, qué versión, qué idioma. Cerrado el bypass de Google |
| `3a8b7bc` | **EX-07** | La `return_url` de Stripe apuntaba a la URL del **despliegue concreto**, que muere en cada push. Ahora se reparte por `VERCEL_ENV` |
| `acd3f3f` | **RV-03** | Las horas mal. `'UTC'` en `profiles.timezone` era el default, no una elección |
| `dd559b0` | **X-02** | El cobro tardío. Primera llamada de reembolso real del repo |
| `681dfce` | **N-13, N-14, N-16, N-11** | El tutor ve con quién es la clase y cuánto se lleva |
| `0c68cd4` | **N-27, N-26, N-24, N-22** | `session_ref` visible (`3EWERX-1`), alfabeto sin `0/O`, `1/I/L` ni `U` para que nadie la dicte mal por teléfono · descarga del chat en TXT legible |
| `56523eb` | **RV-08, RV-11, RV-15, RV-16, RV-17** | El precio anunciado no era el que se cobraba. ⚠️ Y solo fallaba **a veces** —dos de los tres productos por hora duraban 60 min y coincidían por casualidad—, que es peor que siempre porque nadie lo reproduce |
| `a1373a6` | **M-09, M-10, RV-12, RV-14** | Buscador en los selectores largos · el horario elegido sobrevive al registro · errores de formulario propios y accesibles |
| `fee79f9` | **M-03, N-03, N-10, M-05** | El onboarding **termina** y guarda por el camino |
| `fd4fd2a` | **N-33, N-32, N-37, M-02, M-06** | Del calendario al pago sin elegir el horario dos veces · checkout aislado · auto-aceptación por mentoría |
| `c4399b2` | **N-05, N-06, N-07, N-34** | Materiales al crear la mentoría · cancelar pide confirmación de verdad |
| `e28572e` | **M-05, N-01** | Alta de dos campos en modal, sin sacarte de la página |
| `f49b88e` | **X-01** | Los reembolsos **encolan** contra Stripe. Y un bug de dinero preexistente: `cancel_booking` asignaba `refunded_amount` en vez de acumular |

### 🔴 Lo que NO está hecho, aunque lo parezca

Esta lista es la parte útil del apartado. **Nada de aquí se puede dar por bueno en una demo.**

| # | Qué | Por qué importa |
| :-- | :-- | :-- |
| 1 | ~~**`main` sigue en `57edfa9`.**~~ ✅ **Mergeado el 26-ago** (`3fca8b2`). Hoy `dev` va **52 commits** y **7 migraciones** por delante | Ya no es el bloqueante que era. Las legales, `/contacto` y el pie están vivos en producción; lo que llegó de rebote fueron los relojes de los crons, que empezaron a fallar en rojo el 27 (punto 6) |
| 2 | **X-01 no ha movido un euro.** *(Sigue abierto al 30-ago.)* | `refunds-cron.yml` **ya corre** desde el 30-ago… contra **producción**, donde la cola está vacía. Las **2** solicitudes `pending` sobre PaymentIntents reales de test mode están en **dev**. Un job en verde que no toca nada es más peligroso que uno en rojo: parece cerrado |
| 3 | **X-02 no se ha ejercitado.** Pagar tarde y ver el reembolso en Stripe necesita un pago real | Lo escrito es idempotente por dos caminos y está razonado, pero **razonado no es probado** — y es dinero |
| 4 | **M-01 no se ha comprobado contra la API.** `tsc` pasa | Ya pasó una vez: `ui_mode: "embedded_page"` compilaba y devolvía **400** contra la API real |
| 5 | **Nadie ha visto llegar un correo.** Ni el de contacto, ni uno de la cola | `RESEND_API_KEY` está puesta y el código está entero, pero **DL-01 se cumple cuando el revisor recibe respuesta**, no cuando el handler devuelve 200 |
| 6 | ~~**Los crons siguen sin reloj.**~~ ✅ Los tres corren desde el 30-ago. ⚠️ **La cola de dev sigue sin vaciar**, y ya son **336** avisos (~89 a buzones muertos) | No estalló porque el reloj apunta a prod, no porque se resolviera. Vaciar **antes** de apuntar nada a dev: `QA-LANZAMIENTO.md` §4.6. Y de paso se midió que GitHub entrega **una corrida cada 2-6 h**, no cada 5/15 min |
| 7 | **Google no está en prod**, y necesita sus propias credenciales | Si se mergea sin eso, el botón sale roto en producción el día del estreno |
| 8 | **RV-12 a medias:** el mínimo de 8 está en el formulario, **no en el panel de Auth** | El navegador rechaza 6 y la API los sigue aceptando: la mitad que protege es la que falta |
| 9 | **Las 5 filas con `timezone = 'UTC'` no se sanearon** | RV-03 las tapa cayendo a la cookie `ey-tz`. Si alguien entra sin cookie, vuelve el síntoma |
| 10 | **Las cuentas anteriores al 17-ago no tienen constancia de aceptación** | Decisión de negocio, no de código: o se les vuelve a pedir (§34) o se da por buena la anterior. **Preguntar antes de lanzar** |
| 11 | **N-18** (`enable_prejoin_ui: false`) y **N-08** siguen abiertos | Eran del bloque 0, el de "2 h y sin riesgo". Se quedaron fuera |
| 12 | **El contenido de Ennis (§19.8) sigue igual** | Y sigue bloqueado por la misma pregunta sin responder: ¿manda el Word o el documento de contenido? |

### Lo primero de mañana, en orden

1. ✅ ~~**dar de alta `APP_BASE_URL` + `CRON_SECRET`**~~ — hecho el 30-ago (en Vercel ya estaba).
   ⚠️ **Vaciar la cola de correo de dev sigue pendiente** (`QA-LANZAMIENTO.md` §4.6, 336 avisos), y
   arrancar los jobs **no** arrancó X-01: apuntan a prod y allí no hay cola.
2. **Probar el camino del dinero de punta a punta** con la solicitud que ya está encolada en dev:
   pago real de test mode → reembolso visible en el panel de Stripe. Cierra los puntos 2, 3 y 4.
3. **Merge `dev` → `main`**, con su ventana propia y su repaso. Antes: Google en prod, y decidir qué
   se hace con `payment_routing_rules` de producción ahora que allí ya hay clave de Stripe **de test
   mode**.
4. Y **mandar un correo de verdad** por `/contacto` y verlo llegar, que es lo que cierra DL-01.

---

*Faim Lab · Doc 19 · Plan de ejecución · 17 de agosto de 2026 — actualizado al cierre del día con
§19.10 y con el estado real de cada bloque.*
