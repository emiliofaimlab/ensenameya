# Dictado de pagos — cómo queda el cobro y el payout

> **Fecha del dictado: 9 de septiembre de 2026.** Palabra final del cliente sobre cómo se cobra al
> alumno y cómo se le paga al tutor.
>
> **Manda sobre todo lo demás.** Donde este documento y `docs/PAGOS-Y-PAYOUTS.md`, `CLAUDE.md`, los
> Docs 0–9 o los comentarios del código se contradigan, **gana este**. En particular deroga la
> premisa de que el cobro se rutea por el país del tutor y la de que el tutor elige entre cuatro
> tipos de método de cobro.
>
> Lo que este documento **no** cambia: `docs/PAGOS-Y-PAYOUTS.md` sigue mandando en los **costes**
> de cada tramo y en quién asume cada comisión.

---

## 1 · Las cuatro instrucciones, tal cual

1. **La pasarela de cobro la decide el país del ALUMNO**, por fees. Alumno de Ecuador → dLocal.
   Alumno de España → Stripe. Vía final.
2. **El checkout vive SIEMPRE dentro de Enséñame Ya**, como el de Stripe. La redirección de dLocal
   se elimina: dLocal pasa a checkout transparente.
3. **La página de payouts ofrece solo dos opciones automáticas** —PayPal (como está) y BANCO— y el
   sistema elige tras bambalinas entre Wise, Stripe y dLocal según los fees del país del TUTOR. Se
   elimina por completo la opción «cuenta bancaria vía Stripe». El tutor nunca sabe quién ejecutó.
4. **Los métodos manuales (Binance, Zinli, Zelle) se mantienen solo para Venezuela.** Es el único
   país con pago manual.

### Aclaración del cliente (9-sep, posterior al dictado)

> **El formulario bancario se le ofrece a todo tutor cuyo país cubra Wise, dLocal _o_ Stripe.** No
> se limita a los países que hoy tenemos mapeados.
>
> **El saldo de las cuentas es una tarea de operaciones, no un límite del diseño.** Alguien de
> administración fondea las cuentas todos los días antes del ciclo de cobro. Un saldo a cero es una
> tarea pendiente de ese día, no un motivo para no ofrecer un riel.

---

## 2 · Cómo queda el COBRO

### La regla

| Pregunta | Clave | Dónde vive |
| :-- | :-- | :-- |
| ¿Quién cobra? | **país del ALUMNO** | `ruta_de_pago(payer_country).charge_providers` |
| ¿Quién paga al tutor? | **país del TUTOR** | `ruta_de_pago(payee_country).payout_providers` |

La misma fila de `payment_routing_rules` responde a las dos preguntas; lo que cambia es con qué
clave se busca. **No hay tabla nueva.** Las listas ya existentes son el orden por fees que pide el
punto 1 — medido: `ruta_de_pago('EC').charge_providers` = `{dlocal, stripe}`, y `('ES')` y `(null)`
= `{stripe}`.

### Quién cobra, país por país

| Grupo | Países | Cobra |
| :-- | :-- | :-- |
| dLocal cobra ahí | AR · BO · BR · CL · CO · CR · DO · EC · GT · ID · KE · MX · MY · NG · PA · PE · PY · UY | **dLocal**, con Stripe de respaldo |
| Venezuela | VE | **Stripe** (dLocal no cobra allí) |
| Todo el resto del mundo | ~176 países | **Stripe** (fila por defecto) |

### De dónde sale el país del alumno

De su **zona horaria**, con el mapa de 418 zonas IANA que ya está en la base
(`timezone_countries`, `pais_de_cobro_por_zona()`, desde el 8-sep-2026). Es la misma fuente con la
que ya se deduce el país de cobro del tutor.

⚠️ **Se congela al crear la reserva**, en `bookings.payer_country` y `payments.payer_country` —dos
columnas que ya existen y hoy están vacías—, no se recalcula al pagar. Cambiar de zona horaria
después no reescribe nada ya vendido.

⚠️ **Un alumno de viaje o con VPN rutea por otro corredor.** Se acepta: es el mismo compromiso que
ya se aceptó para el tutor, y la fila por defecto (`{stripe}`) hace que cualquier país del mundo
pueda comprar.

### La forma del checkout

Los dos proveedores montan su formulario **dentro de nuestra pantalla**. Ninguno redirige.

| | Cómo se monta | Estado |
| :-- | :-- | :-- |
| **Stripe** | `ui_mode: 'form'` + `client_secret` | ✅ ya es así |
| **dLocal** | `allow_transparent` + campos de tarjeta en iframes de dLocal | ✅ hecho el 10-sep |

⚠️ **El código dice hoy que el transparente de dLocal «NO ESTÁ DISPONIBLE» y es falso.** Esa frase
—`port.ts:66`, `dlocal-provider.ts:60`, `api/pagos/checkout/route.ts:854`— viene de una prueba del
1-sep que miraba el parámetro equivocado (`direct`, que es de solo lectura). Medido el 9-sep-2026
contra el sandbox: la cuenta lo tiene habilitado, el tokenizador devuelve un token real, y los
errores que quedan son de **campo**, no de permiso.

⚠️ **La tarjeta nunca toca nuestro servidor.** Los campos viven en iframes de dLocal, igual que los
de Stripe. Mismo perfil PCI que hoy.

⚠️ **Dos excepciones inevitables al «siempre dentro»**, ninguna evitable por código:

- **El 3DS del banco emisor** saca al alumno de la página. Lo impone su banco. La vuelta aterriza en
  **nuestra** pantalla de confirmación.
- **Los medios locales** (PIX, boleto, OXXO, efectivo) solo existen en el formulario alojado de
  dLocal. El transparente hace **solo tarjeta**. → decisión abierta D-3.

### Lo que el checkout pasa a pedirle al alumno

**Nombre, apellido, tipo de documento y número.** Los exige dLocal para cobrar fuera de su
formulario; hoy solo pedimos correo.

⚠️ **CORRECCIÓN DEL 10-SEP.** Aquí ponía «tres campos» y «el **tipo** de documento no hace falta
(medido)». Las dos frases eran falsas y la medida estaba mal hecha:

- Sin `clientDocumentType`, dLocal responde `400 {"errorCode":908,"causeMessage":"Missing field:
  clientDocumentType"}`. **El tipo es obligatorio.**
- **Son tres campos solo en Ecuador**, que tiene un único tipo (`CI`) y se rellena solo. En
  Argentina (DNI/CUIT/CUIL), Brasil (CPF/CNPJ), Chile (RUN/RUT/CI) y México (CURP/RFC/IFE) hay que
  pintar un desplegable, o sea **cuatro campos**.

🔑 **Y no hace falta ni una regex nuestra.** `GET /v1/checkout/payment_method/{id}` devuelve los
tipos válidos de cada país **y sus expresiones de validación**, así que el formulario las lee de
dLocal en vez de copiarlas. Tampoco hizo falta `payout_country_rules.document_patterns`, que es lo
que este documento proponía usar.

---

## 3 · Cómo queda el PAYOUT

### Lo que ve el tutor

| Tarjeta | Quién la ve | Qué hace |
| :-- | :-- | :-- |
| **PayPal** | todos | Conecta su cuenta con un botón. **No cambia nada.** |
| **Banco** | **todo país que cubra Wise, dLocal o Stripe** — o sea, casi el mundo entero | Un solo formulario. Nunca dice quién ejecuta. |
| **Zinli · Zelle · Binance** | **solo Venezuela** | Lo cierra una persona desde el panel admin. |

**Desaparece la tarjeta «Cuenta bancaria vía Stripe»** y con ella todo el alta de Stripe Connect.

🔑 **Y Stripe vuelve, pero por dentro (D-1, aprobada el 10-sep).** La cuenta la creamos **nosotros**
con los datos que el tutor teclea en nuestro formulario; él no ve el nombre de Stripe en ningún
sitio y su historial dice «Transferencia bancaria», igual que con dLocal y Wise. Lo que Stripe pide
lo dice él mismo en `requirements.currently_due` y **no es igual en todos los países** —España y
México nada más; Colombia y Chile el documento; Panamá la dirección y la ciudad—, así que el
adaptador manda todo lo que tenemos y no lleva ningún mapa por país.

De todo eso solo faltaban **dos datos**: la fecha de nacimiento y la aceptación de condiciones. Los
dos son **opcionales** en el formulario: sin ellos el tutor sigue cobrando por dLocal, Wise o
PayPal — lo único que pierde es una ruta.

### Dónde llega cada riel — medido el 9-sep-2026

| Riel | Cobertura | Cómo se midió |
| :-- | :-- | :-- |
| **dLocal** | **8 países**: AR · BR · CL · EC · MX · PE · PY · UY | `POST /v1/payouts` contra su sandbox |
| **Wise** | **103 monedas destino** desde USD, pero la moneda no basta: lo que manda es si acepta el destinatario. Medido con `POST /v1/accounts` sobre ~50 candidatos → **51 países abiertos** en `payout_country_rules` | `GET /v1/currency-pairs` + `account-requirements` + alta real de destinatarios (creados y borrados) |
| **Stripe Connect** | **54 de 60 países probados**, con acuerdo `recipient` | `POST /v1/accounts` uno a uno, en *test mode* |

**Los tres se complementan casi perfectamente.** Donde falla uno llega otro:

| País | dLocal | Wise | Stripe | Resultado |
| :-- | :--: | :--: | :--: | :-- |
| México, Argentina, Chile, Ecuador, Perú, Paraguay, Uruguay | ✅ | ✅ | ✅ | Banco |
| Brasil | ✅ | ✅ | ❌ | Banco |
| Colombia | ❌ | ✅ | ✅ | Banco |
| España, zona euro, Reino Unido, Canadá, Japón, India… | ❌ | ✅ | ✅ | Banco |
| Estados Unidos | ❌ | ✅ | ❌ | Banco |
| Panamá, El Salvador, Costa Rica, Guatemala, Bolivia | ❌ | ✅ | ✅ | Banco |
| Nicaragua, Ucrania | ❌ | ✅ | ❌ | Banco |
| **Honduras** | ❌ | ❌ | ✅ | Banco (solo Stripe → depende de D-1) |
| **Rep. Dominicana** | ❌ | ❌ | ✅ | Banco (solo Stripe → depende de D-1) |
| **Venezuela** | ❌ | ❌ | ❌ | **Manual** |
| Cuba, Rusia, Irán | ❌ | ❌ | ❌ | No operable |

⚠️ **Estados Unidos y Brasil fallan en Stripe por el mismo motivo y no es el país**: nuestra cuenta
de plataforma es de EE. UU., y el acuerdo `recipient` no vale «para plataformas en US creando
cuentas en US/BR» (mensaje literal de la API). Los dos los cubre Wise.

⚠️ **CORRECCIÓN DEL 10-SEP: Wise NO llega a Honduras ni a República Dominicana.** Esta tabla decía
que sí, deducido de que sus monedas (HNL, DOP) están entre las 103. Al dar de alta destinatarios de
verdad, Wise los rechaza: Honduras con `422 legalType = "Recipient type is not valid"` y Rep.
Dominicana con `422 swiftCode = "Sorry, we dont support payments to this country"`. **Que una moneda
cotice no significa que acepte al destinatario**, y la lista de 103 monedas no es la lista de países
pagables.

🔑 **Y AL REVÉS, PANAMÁ SÍ SE PUEDE PAGAR POR WISE.** Estaba descartado desde el 7-sep por una
medida mal hecha: se probó USD→**PAB**, y el balboa no está entre las 103 monedas. Panamá cobra en
**dólares**, y USD→USD con un BIC panameño devuelve **200**. Son 3 de los 24 tutores, el segundo
país con más gente después de Venezuela.

### 🔑 Por qué Venezuela es manual, dicho con datos

**No es una decisión de producto: es el único país del mundo que ninguno de los tres alcanza.**
dLocal no paga allí, Wise no cotiza el bolívar (no está entre las 103 monedas) y Stripe no admite
cuentas venezolanas. El punto 4 del dictado —«manual solo Venezuela»— es exactamente lo que sale de
medir la cobertura. No hay ningún otro país que necesite pago manual.

### Cómo se elige el riel

**Por fee, entre los que cubren el país del tutor.** El orden vive en
`payment_routing_rules.payout_providers`, una lista ordenada por país — y **tocarlo es una
migración**, nunca un `UPDATE` a mano (regla de oro 5).

⚠️ **El saldo NO es el criterio de orden, es una red de seguridad.** dLocal y Stripe solo pueden
pagar con el dinero que ellos mismos cobraron; Wise y PayPal se fondean desde nuestro banco. Como
operaciones fondea las cuentas a diario, el orden lo manda el fee y el saldo solo actúa como
**respaldo**: si el riel elegido no tiene con qué, la orden baja al siguiente candidato en vez de
quedarse esperando. Ese descenso ya existe en el código y no hay que escribirlo.

### La tarea diaria de operaciones

Es parte del diseño y hay que escribirla en el manual de operación, no en el código:

> **Todos los días, antes del ciclo de payouts:** revisar el saldo de Wise y de PayPal y fondearlos
> desde la cuenta de la empresa. El dinero para hacerlo sale de retirar los saldos de dLocal y de
> Stripe, que es donde entra el dinero de los alumnos.

### Manual = Venezuela, también al escribir

Hoy el ruteo y la pantalla ya lo cumplen: la única fila que nombra el riel `manual` es `VE`. Falta
cerrar la **escritura**: `upsert_manual_destination` no mira el país del tutor, así que uno de
México podría guardarse un Zelle por la puerta de atrás. Se cierra con un guard y se borra la fila
que ya existe.

---

## 4 · La deuda que esto destapa

✅ **RESUELTA EL 10-SEP-2026: la tabla pasó de 9 filas a 55**, 51 de ellas con riel de Wise. Se
abrieron por formato y no país a país: `iban` cubre 31 de golpe (los 20 del euro más Suiza, los
nórdicos, Polonia, Chequia, Hungría, Rumanía, Ucrania, Pakistán y Egipto), `swift_code` otros 7, y
`sort_code`, `aba`, `australian`, `indian` y `costa_rica` uno cada uno.

⚠️ **Lo que queda fuera, y por qué** (medido, no supuesto): Venezuela, Cuba, Rusia e Irán no están
ni en la lista de países de Wise; Honduras y Rep. Dominicana los rechaza al dar de alta al
destinatario; y unos 17 países más —Canadá, Japón, Nigeria, Kenia, Indonesia, Malasia, Filipinas,
Tailandia, Sudáfrica, Singapur, Corea…— piden un **código de banco de una lista cerrada que sirve
Wise**, así que abrirlos no es una fila: es importar esos catálogos a `payout_banks`.

**Con la aclaración del cliente, cada país sin fila es un tutor que no puede cobrar aunque los tres
proveedores lleguen a su país.** Es el trabajo real que el dictado añade, y no estaba en el plan
anterior.

La buena noticia es que **son datos y un formato de cuenta, no un proveedor nuevo**. Wise dice qué
campos pide por moneda con una llamada, y el adaptador está escrito desde el 7-sep. Medido:

```
EUR → iban          GBP → sort_code, iban        USD → aba
```

**Orden sugerido para abrirlos**, por dónde están los tutores de verdad:

1. **Zona euro por IBAN** (un formato para 20 países) — cubre España, donde ya hay 1 tutor.
2. **Estados Unidos por ABA** — cubre US, que Stripe no puede.
3. **Panamá, El Salvador, Costa Rica, Guatemala, Rep. Dominicana, Bolivia** — 3 tutores en Panamá,
   1 en El Salvador; es el segundo grupo con más gente.
4. El resto, bajo demanda: abrir un país es una fila.

---

## 5 · Lo que el dictado provoca y no dice

### Los saldos dejan de seguir al tutor

Hoy el país del tutor decide las dos puntas, así que el dinero entra y sale por el mismo sitio. Con
el punto 1 eso se acaba: un mismo tutor recibirá cobros de alumnos de LATAM (saldo dLocal) y de
Europa (saldo Stripe).

Consecuencias que ya son ciertas y pasan a ser frecuentes:

- **Un tutor con cobros de dos corredores recibe dos órdenes de retiro**, una por saldo de origen
  (`payouts.funding_provider`). El código ya lo hace así.
- **La tesorería diaria deja de ser opcional.** Es la tarea de operaciones de §3.

### Guardar la tarjeta

El formulario embebido de dLocal **no tiene bóveda**: los alumnos que pasen a cobrar por dLocal no
podrán guardar su tarjeta. La página de privacidad promete conservar marca y últimos cuatro «si
eliges guardar un medio de pago». → decisión abierta D-6.

### PayPal no recibe en todos los países

Hoy el sistema ofrece PayPal en los 195 países sin comprobarlo. Nigeria, por ejemplo, no puede
**recibir** pagos de PayPal. No está medido. Con el formulario bancario abierto de verdad esto deja
de ser grave —siempre quedaría el banco— pero conviene medirlo antes de prometerlo.

---

## 6 · Lo que NO cambia (para que no se reabra)

- **PayPal.** Funciona de punta a punta desde el 4-sep. Se paga al identificador de la cuenta
  **conectada**, no al correo. El dictado no lo toca.
- **El manual ya era solo Venezuela.** No es trabajo nuevo; solo falta cerrar la escritura.
- **El dinero sigue siendo server-side.** `payments.provider` lo congela `create_booking_line`, el
  importe sale de `payments.gross_amount`, y acreditar un cobro sigue siendo **exclusivo del
  webhook**. La ruta nueva de confirmación de dLocal **no escribe en `payments`**.
- **El país del tutor sigue decidiendo el payout**, deducido de su zona horaria.
- **Los legales son del cliente.** Con el punto 2 la página de pago carga terceros de dLocal y
  `/cookies` y `/privacy` quedan desactualizados. Se avisa una vez; no los redactamos.

---

## 7 · Decisiones abiertas

| # | Pregunta | Recomendación |
| :-- | :-- | :-- |
| **D-1** | ~~¿Entra Stripe como tercer riel del banco?~~ | ✅ **APROBADA por el cliente el 10-sep-2026.** Stripe entra **detrás de Wise** en 17 países con fila propia y en la fila por defecto (o sea, España, Alemania, Japón y el resto del mundo). Fuera: Brasil, Venezuela y EE. UU., donde no puede crear la cuenta. El coste real resultó **menor de lo previsto**: no son tres campos nuevos sino **dos** —fecha de nacimiento y aceptación de condiciones—, porque la dirección, la provincia y el documento ya se pedían desde las fases 2 y 3. |
| **D-2** | ~~¿Qué pasa con los tutores de ES, PA y SV?~~ | **Resuelta por la aclaración del cliente**: se les abre el formulario bancario. Es la deuda de §4. |
| **D-3** | Al embeber se pierden PIX, boleto y OXXO. ¿Solo-tarjeta, o híbrido con enlace a «otros medios de pago»? | **Híbrido, y ahora sí urge.** ⚠️ Aquí ponía que este comercio no los tiene habilitados (404 «not available for Merchant») y **era falso**: medido el 10-sep, en Ecuador la cuenta ofrece **12 métodos de efectivo** (`EF`, `EF_BA`, `EF_WU`…). Al embeber se pierden **de verdad**. El respaldo cuesta un enlace, porque la URL del checkout alojado se sigue devolviendo con el parámetro puesto. |
| **D-4** | ¿Se aceptan los tres campos nuevos (nombre, apellido, documento) antes de pagar? | Sí. Es el coste real del punto 2 y dLocal los exige. |
| **D-5** | ~~¿Manda el fee o manda la caja?~~ | **Resuelta por la aclaración del cliente**: manda el **fee**. El saldo queda como respaldo, no como criterio de orden, porque operaciones fondea a diario. |
| **D-6** | ¿Se acepta perder la tarjeta guardada donde cobre dLocal? | Condicionar la pantalla de «Métodos de pago» al país. Y dejar de crear ficha de cliente en Stripe para alumnos que van a pagar por dLocal. |

### Bloqueantes que no son de código

| Quién | Qué |
| :-- | :-- |
| **Cliente** | D-1 y D-3. |
| **dLocal** | Clave de SmartFields de **producción** y repetir la medida contra la API en vivo. Todo lo medido es sandbox, y no hay prefijo en la clave que distinga los ambientes. |
| **Operaciones** | Montar la rutina diaria de fondeo y decidir quién la ejecuta. |

---

## 8 · Orden de ejecución

Cada fase se mergea sola y deja el sitio funcionando — importa porque el CI aplica migraciones a
producción al mergear a `main`.

| # | Qué | Por qué ahí | Verificación |
| :-- | :-- | :-- | :-- |
| **1** | El cobro lo decide el país del alumno | Es la raíz: el proveedor se congela al crear la reserva, y el país del alumno que dLocal necesita en la fase 4 sale de aquí | Reservar con un alumno en `America/Guayaquil` → `EC / dlocal`. Con Madrid → `ES / stripe`. **El typecheck no vale**: decide el snapshot |
| **2** | Banco único y Stripe fuera de la vista | No depende de las otras y es la más barata: 0 de 24 tutores usaron Connect | `npm run check:metodo` y `check:riel` en verde. En **producción**, tras el merge: ninguna fila de ruteo nombra `stripe` |
| **3** | **Abrir el formulario bancario al mundo** | Es lo que la aclaración del cliente convierte en obligatorio. Sin esto, «Banco» sigue siendo 9 países | Un tutor de España guarda su IBAN y `wise_puede_pagar_a()` devuelve verdadero. Repetir con US (ABA) y Panamá |
| **4** | dLocal embebido | Necesita el país del alumno de la fase 1, y es la única que espera una clave de producción | Un cobro `PAID` de punta a punta: formulario dentro del sitio → confirmación → webhook firmado → `payments` en `paid` |
| **5** | Stripe como tercer riel del banco | ✅ D-1 aprobada el 10-sep | Una cuenta de destinatario que llega a `transfers: active` y `payouts_enabled: true` con solo los datos del formulario. Verificado en España de punta a punta contra la API |

⚠️ **Dos trampas medidas:**

1. **Cambiar solo el código de ruteo no cambia quién cobra.** El snapshot congelado gana: la cadena
   pone `payments.provider` por delante del ruteo. La migración de `create_booking_line` va primero.
2. **Borrar la familia `'conectada'` a medias rompe la pantalla del tutor.** Las 4 declaraciones
   están repetidas a mano a propósito, así que la incoherencia **no rompe la compilación**. Si la
   familia sobrevive en `RIELES` sin su rama, la pantalla pinta Zinli y Zelle a quien no debe. Todo
   en el mismo commit.

---

## 9 · Lo que se elimina

| Qué | Tamaño |
| :-- | --: |
| `tutor/payouts/connect-alta.tsx` — el alta de Connect que ve el tutor | 164 líneas |
| `api/tutor/stripe-connect/route.ts` — lo único que crea una cuenta conectada | 111 líneas |
| `payments/connect-mapeo.ts` + su `.check.ts` + el script `check:connect` | 181 líneas |
| El cuerpo de `stripeProvider.payout()`, que queda como «sin ejecutor» | 128 → 3 líneas |
| La familia `'conectada'`: 4 declaraciones repetidas a mano y 5 ramas | ~60 líneas · 8 ficheros |
| `estadoDeLaCuenta()` — ya era código muerto | 84 líneas |
| `ruteoComun()`, que intersecaba los países de N tutores | 24 líneas |
| `'stripe'` en `payout_providers` | 18 de 21 filas |
| | **≈ 750 líneas** |

⚠️ **No se borran, a propósito:** `tutor_profiles.stripe_connect_account_id` y `destino_connect()`.
Quedan inertes y borrarlas costaría una migración con grants por columna que habría que rehacer si
se aprueba D-1.

---

## 10 · Qué se midió para escribir esto

Todo el 9 de septiembre de 2026, contra el código de `dev`, la base de datos real y las APIs de los
proveedores. Nada sale de la documentación del repositorio, que en varios puntos dice lo contrario.

- **dLocal transparente:** `POST /v1/payments` con `direct:true` → `direct:false` (la prueba de
  septiembre miraba la vía equivocada). El tokenizador de `js-sandbox.dlocal.com` montado en
  navegador → `{"token":"CV-…"}`. `POST /v1/cards` con ese token → `201 Invalid document`, error **de
  campo**, no de permiso. `POST /v1/payments/smart-fields/pm/{token}` con `{"brand":"VI"}` → correcto;
  con OXXO, PIX y efectivo → 404 «not available for Merchant».
  ⚠️ La clave del tokenizador **no es la nuestra**: está hardcodeada en el SDK de dLocal Go.
  `DLOCALGO_SMARTFIELDS_KEY` de `.env.local` no sirve para tokenizar.
- **Wise:** `GET /v1/currency-pairs` → **103 monedas destino** desde USD. `account-requirements` por
  moneda → EUR `iban`, GBP `sort_code`/`iban`, USD `aba`. VES no está en la lista.
- **Stripe Connect (`recipient`):** `POST /v1/accounts` país por país en *test mode* →
  **54 de 60 OK**. Fallan US y BR («not supported for platforms in US creating accounts in US/BR») y
  VE, CU, RU, IR.
- **Ruteo:** `ruta_de_pago('EC')` → `{dlocal, stripe}`; `('ES')` y `(null)` → `{stripe}`.
- **Tutores:** 24 — VE 14 · PA 3 · MX 2 · SV 1 · ES 1 · CO 1 · EC 1 · CL 1. **0** con
  `stripe_connect_account_id`.
- **Reglas bancarias:** `payout_country_rules` tiene 9 filas. `wise_account_type` solo en 5.
- **Datos sin país de pagador:** 82 `payments` y 139 `bookings`. No se rellenan hacia atrás.
