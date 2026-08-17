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

---

## 19.0 · PLAN DE HOY — lunes 17 de agosto

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

| # | Tarea | Tiempo | Quién |
| :-- | :-- | :-- | :-- |
| **H-0** | **Encender Google en Supabase Auth** (dev + prod) y meter la URL de callback en la allow-list | 20 min | **Jose (panel)** |
| **H-1** | `adaptive_pricing: { enabled: false }` — se acaba el cobro en PAB con 4 % de recargo | **5 min** | Jose |
| **H-2** | **Footer:** fuera LinkedIn y X (404) · bloque legal con razón social, EIN y domicilio · `Info@ensenameya.com` como `mailto:` · enlace «Contacto» | 30 min | Jose |
| **H-3** | **`/contacto`**: formulario nombre + correo + mensaje → `POST /api/contacto` → correo real **+ fila en BD** para que nada se pierda si el correo falla · bloque de identidad legal · honeypot | 2–3 h | Jose |
| **H-4** | **Términos de Néstor, EN + ES.** `legal-doc.tsx` pasa a mapa por idioma · `/terms` (ES) y `/terms/en` (EN, **gobernante**) · exportar `TERMS_VERSION = "2026-08-17"` | 2–3 h | Jose |
| **H-5** | **Aceptación en el registro:** migración `terms_acceptances` · el dato viaja en el metadata de `signUp` y lo persiste `handle_new_user` · **cerrar el bypass de Google** · la casilla enlaza a la versión **inglesa** | 2 h | Jose |
| **H-6** | **Variables:** `RESEND_API_KEY` en Vercel · `CRON_SECRET` en Vercel **y** GitHub (mismo valor) · `APP_BASE_URL` en GitHub | 20 min | **Jose (paneles)** |
| **H-7** | **Merge `dev` → `main`** y verificar que las tres legales, `/contacto` y el footer están vivos en producción | 1 h | Jose |
| **H-8** | Avisar a dLocal | 5 min | Verónica |

### Cuatro avisos de ejecución, para no tropezar

1. **H-6 antes que H-3 se dé por buena.** Un formulario que encola en silencio **no cumple DL-01**:
   dLocal prueba enviando y esperando respuesta. Y ⚠️ **poner `RESEND_API_KEY` dispara toda la cola
   de notificaciones acumulada** — mirar qué hay encolado antes de pulsar.
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

**4. Hay tres cosas que no salieron en ninguna reunión y pesan más que media lista.** Están en
§19.3. La peor: **ningún reembolso mueve dinero de verdad.**

---

## 19.2 Correcciones al Doc 18 (verificadas contra el código)

Cuatro puntos del Doc 18 cambian de diagnóstico. No de prioridad: de **causa**. Ir a arreglarlos por
donde dice el Doc 18 sería trabajo perdido.

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

### 🟠 N-34 · La cancelación sin confirmar: no reproduce del lado alumno

El flujo del alumno **sí tiene** pantalla de confirmación propia con el importe y el efecto del
reembolso. Lo que no la tiene es **el lado tutor**: es un `window.confirm()` nativo, fácil de
aceptar por inercia. Y las «muchas notificaciones» tienen explicación mecánica y correcta: una por
reserva abandonada, por dos destinatarios.

**Sigue habiendo trabajo, pero es otro** (diálogo propio del lado tutor) y **no es bloqueante.**
Antes de nada conviene confirmar con Verónica sobre qué build vio el síntoma: puede ser de un
despliegue anterior.

### 🟡 N-22 · El chat que crece sin límite: tampoco reproduce

El hilo ya tiene alto acotado con scroll propio, en `dev` y en `main`. Lo que sí falta es
`wrap-anywhere`: una URL larga mete barra horizontal dentro del hilo. Es una clase de Tailwind.

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

### 🟠 X-03 · El alta con Google se salta la casilla de términos

`<GoogleButton>` se renderiza **antes** del `<form>` y su `onClick` nunca lee el estado `accepted`.
Quien pulsa «Registrarme con Google» crea cuenta **sin haber marcado nada**. Y como el alta entera
ocurre en el navegador (`supabase.auth.signUp` desde el cliente, sin Route Handler propio), la
aceptación **no deja rastro en ninguna parte**.

Hoy, ante dLocal, **no hay forma de demostrar que un usuario concreto aceptó un texto concreto.**
Es justo lo que pide Néstor. Ver §19.5.

---

## 19.4 Ruta crítica dLocal Go — los siete requisitos, uno por uno

Estado real hoy. **Ninguno completo.**

| # | Requisito de dLocal | Estado | Quién | Esfuerzo |
| :-- | :-- | :-- | :-- | :-- |
| **DL-01** | Formulario de contacto funcional (nombre, correo, mensaje) que **envíe de verdad** | 🔴 **NO EXISTE** — no hay ruta `/contacto` ni handler | Jose | **M** |
| **DL-02** | Datos de contacto visibles con canales reales | 🟠 A medias — `info@ensenameya.com` existe pero **enterrado en §11 de los términos** y como texto plano, sin `mailto:`. Sin teléfono | Jose + **cliente** | S |
| **DL-03** | Identidad legal del negocio (PJ: razón social + ID fiscal · PF: administrador + documento) | 🟢 **DESBLOQUEADO 17-ago** — `Ensename Ya, LLC` · EIN 42-2277169 · Weston, FL. No hay ni un dato fiscal **todavía en el repo**: es trabajo de hoy (H-2, H-3) | Jose | S |
| **DL-04** | Redes sociales que lleven a perfiles reales, o ninguna | 🟠 **Dos de las tres están rotas.** LinkedIn 404 confirmado, X 404 probable. Se metieron a ojo en el commit del Figma | **Cliente** → Jose | **XS** |
| **DL-05** | T&C propios que expliquen cómo se contrata, condiciones de uso y el proceso | 🟢 **DESBLOQUEADO 17-ago** — Néstor entregó las 39 secciones en EN + ES, con identidad del prestador (§39), ley aplicable (§33) e idioma gobernante (§38). Falta **publicarlas** (H-4) | Jose | S |
| **DL-06** | Política de devoluciones explicada | 🟠 Está escrita y ligada al código. Faltan el **plazo** («se reembolsa en X días hábiles») y **a quién reclamar**. Y ⚠️ **X-01: no se ejecuta** | Jose | XS + X-01 |
| **DL-07** | Sitio completo, sin enlaces rotos ni información faltante | 🔴 **Producción sirve tres 404 legales** | Jose | Merge |

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

### Bloque 0 · Hoy (2 h) — todo desbloqueo, nada de riesgo

| Punto | Qué |
| :-- | :-- |
| **DL-04** | Borrar LinkedIn y X del footer |
| **DL-02** | `info@ensenameya.com` al footer, como `mailto:` |
| **M-08a** | Encender Google en Supabase Auth (dev + prod) |
| **M-01** | `adaptive_pricing: { enabled: false }` en la creación de la Session — **una línea** y se acaba el cobro en PAB con 4 % de recargo. En código, no en el panel: si se apaga solo en el panel, vuelve el día que se cree otra cuenta |
| **N-18** | `enable_prejoin_ui: false` en las properties de la sala |
| **N-08, N-11** | Quitar «Acceso rápido», añadir «Ver todas» a reservas recientes |

### Bloque 1 · La ruta crítica de dLocal (2–3 días)

`/contacto` con formulario que envía (**DL-01**) · identidad legal cuando llegue (**DL-03**) ·
plazo y vía de reclamación en reembolsos (**DL-06**) · jurisdicción y ley aplicable (**DL-05**) ·
**merge `dev` → `main`** (**DL-07**) · `RESEND_API_KEY` + `CRON_SECRET` + `APP_BASE_URL`
(**RV-04** — es solo configuración, el código está entero).

> ⚠️ Poner `RESEND_API_KEY` **dispara toda la cola de notificaciones acumulada**. Revisar qué hay
> encolado antes de pulsar.

### Bloque 2 · El dinero, que es donde duele (3–4 días)

| Punto | Qué |
| :-- | :-- |
| **X-01** | Reembolsos reales contra la API de Stripe en los tres caminos (cancelación RN-37, admin, vencimiento 24 h) |
| **X-02** | `expires_at` en la Session + `failed` en la lista de idempotencia de `confirm_payment` + que el webhook rechace y reembolse pagos de reservas que ya no están pendientes |
| **M-11** | Contador visible desde la selección del horario (el `created_at` de la reserva ya sirve) y corregir el texto de `slot-picker` que **hoy afirma lo contrario de lo que pasa** |
| **RV-03b/c/d** | Arreglar la fuente de zona horaria + autodetección en el onboarding de tutor + sanear las filas en `'UTC'` |
| **M-08b** | El doble canje PKCE del callback |

### Bloque 3 · Registro, términos y contenido (2–3 días)

**T&C:** versión exportada → migración de aceptaciones → cerrar el bypass de Google (**X-03**) →
enlazar la versión inglesa cuando llegue.
**M-05:** alta de dos campos en modal + nombre al paso 1 del onboarding de tutor.
⚠️ Quien elige «tutor» en el alta salta **directo** a `/tutor/onboarding`: si el nombre solo se pide
en el asistente de alumno, **los tutores se quedan sin nombre**.
**M-03:** persistir el paso del onboarding y pantalla de cierre en los dos.
**M-09:** buscador en los selectores largos y autodetección en el de tutor.
**RV-12:** contraseña a 8 — ⚠️ **también en el dashboard de Supabase**, o el navegador rechaza y la
API sigue aceptando 6.
**Contenido (Ennis):** §19.8.

### Bloque 4 · Lado tutor — lo de Verónica (3–4 días)

**N-13 + N-14 + N-28 de una sola vez.** Los tres chocan con lo mismo: `profiles` es *own-only* y el
tutor no puede leer ni el nombre del alumno. **Una sola migración** —vista con
`security_invoker = true` y columnas explícitas, patrón `tutors_public`— resuelve los tres. Hacerlos
por separado deja tres superficies distintas exponiendo `profiles`.

**N-16** (nivel y split visibles): dos lecturas y dos etiquetas, **sin tocar esquema ni RLS**. Que
quede en el panel privado: la insignia de tier se dejó fuera del catálogo a propósito.
**N-10** (verificación como checklist) · **N-12/N-15** (títulos y etiquetas) · **N-05/N-06/N-07**
(subidas del formulario de mentoría, los tres en la misma pasada) · **N-01** (el CTA reconoce el rol)
· **N-03** (la primera oferta sin salir del asistente).

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

---

*Faim Lab · Doc 19 · Plan de ejecución · 17 de agosto de 2026*
