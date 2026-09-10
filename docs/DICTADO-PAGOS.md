# Dictado de pagos — cómo queda el cobro y el payout

> **Fecha del dictado: 9 de septiembre de 2026.** Palabra final del cliente sobre cómo se cobra al
> alumno y cómo se le paga al tutor. **Implementado y en producción.**
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

⚠️ **Se congela al crear la reserva**, en `bookings.payer_country` y `payments.payer_country`, no se
recalcula al pagar. Cambiar de zona horaria después no reescribe nada ya vendido.

⚠️ **Un alumno de viaje o con VPN rutea por otro corredor.** Se acepta: es el mismo compromiso que
ya se aceptó para el tutor, y la fila por defecto (`{stripe}`) hace que cualquier país del mundo
pueda comprar.

### La forma del checkout

Los dos proveedores montan su formulario **dentro de nuestra pantalla**. Ninguno redirige.

| | Cómo se monta |
| :-- | :-- |
| **Stripe** | `ui_mode: 'form'` + `client_secret` |
| **dLocal** | `allow_transparent` en el `POST /v1/payments` + campos de tarjeta en iframes de dLocal |

El orden de las llamadas de dLocal es obligatorio: `POST /v1/payments` con `allow_transparent` →
`GET /v1/checkout/{token}` → `POST /v1/checkout/prepare-confirm` → `POST /v1/checkout/confirm`.
Saltarse la primera da un 500; saltarse la segunda, un 406.

⚠️ **La tarjeta nunca toca nuestro servidor.** Los campos viven en iframes de dLocal, igual que los
de Stripe. Mismo perfil PCI que hoy (SAQ A).

⚠️ **La clave del tokenizador no es nuestra**: está hardcodeada en el SDK de dLocal Go, y
`DLOCALGO_SMARTFIELDS_KEY` no sirve para tokenizar.

⚠️ **Dos excepciones inevitables al «siempre dentro»**, ninguna evitable por código:

- **El 3DS del banco emisor** saca al alumno de la página. Lo impone su banco. La vuelta aterriza en
  **nuestra** pantalla de confirmación.
- **Los medios locales** (PIX, boleto, OXXO, efectivo) solo existen en el formulario alojado de
  dLocal. El transparente hace **solo tarjeta**. → decisión abierta D-3.

### Lo que el checkout le pide al alumno

**Nombre, apellido, tipo de documento y número**, además del correo. Los exige dLocal para cobrar
fuera de su formulario, y el **país del pagador** también: sin él responde
`400 5000 «Empty country not allowed»`.

- **El tipo de documento es obligatorio.** Sin `clientDocumentType`, dLocal responde
  `400 {"errorCode":908,"causeMessage":"Missing field: clientDocumentType"}`.
- **Son tres campos solo en Ecuador**, que tiene un único tipo (`CI`) y se rellena solo. En
  Argentina (DNI/CUIT/CUIL), Brasil (CPF/CNPJ), Chile (RUN/RUT/CI) y México (CURP/RFC/IFE) hay que
  pintar un desplegable, o sea **cuatro campos**.

🔑 **Y no hace falta ni una regex nuestra.** `GET /v1/checkout/payment_method/{id}` devuelve los
tipos válidos de cada país **y sus expresiones de validación**, así que el formulario las lee de
dLocal en vez de copiarlas. `payout_country_rules.document_patterns` no interviene: es del payout y
va indexada por otro juego de tipos.

---

## 3 · Cómo queda el PAYOUT

### Lo que ve el tutor

| Tarjeta | Quién la ve | Qué hace |
| :-- | :-- | :-- |
| **PayPal** | todos | Conecta su cuenta con un botón. **No cambia nada.** |
| **Banco** | todo país con fila en `payout_country_rules` — 55 hoy | Un solo formulario. Nunca dice quién ejecuta. |
| **Zinli · Zelle · Binance** | **solo Venezuela** | Lo cierra una persona desde el panel admin. |

**La tarjeta «Cuenta bancaria vía Stripe» no existe, y el alta de Stripe Connect tampoco.** No hay
pantalla ni ruta que dé de alta al tutor **en** Stripe: `tutor/payouts/connect-alta.tsx`,
`api/tutor/stripe-connect/` y `payments/connect-mapeo.ts` se borraron, y `destino_connect()` quedó
sin usar. **Eso no vuelve**, y es doctrina, no estado: el tutor no le entrega sus coordenadas a un
tercero ni ve su marca.

🔑 **Stripe sí paga, pero por dentro (D-1, aprobada el 10-sep).** La cuenta la creamos **nosotros**
con los datos que el tutor teclea en nuestro formulario; él no ve el nombre de Stripe en ningún
sitio y su historial dice «Transferencia bancaria», igual que con dLocal y Wise. El identificador de
esa cuenta se guarda en `tutor_profiles.stripe_connect_account_id`, que es la columna del alta vieja
reutilizada para otra cosa. Lo que Stripe pide lo dice él mismo en `requirements.currently_due` y
**no es igual en todos los países** —España y México nada más; Colombia y Chile el documento; Panamá
la dirección y la ciudad—, así que el adaptador manda todo lo que tenemos y no lleva ningún mapa por
país.

De todo eso, los **dos** datos que el formulario no pedía —fecha de nacimiento y aceptación de
condiciones— son **opcionales**: sin ellos el tutor sigue cobrando por dLocal, Wise o PayPal, y lo
único que pierde es una ruta.

### Dónde llega cada riel — medido el 9-sep-2026

| Riel | Cobertura | Cómo se midió |
| :-- | :-- | :-- |
| **dLocal** | **8 países**: AR · BR · CL · EC · MX · PE · PY · UY | `POST /v1/payouts` contra su sandbox |
| **Wise** | **103 monedas destino** desde USD, pero la moneda no basta: lo que manda es si acepta el destinatario. **51 filas de `payout_country_rules` con `wise_account_type`** | `GET /v1/currency-pairs` + `account-requirements` + alta real de destinatarios (creados y borrados) |
| **Stripe** | **54 de 60 países probados**, con acuerdo `recipient` | `POST /v1/accounts` uno a uno, en *test mode* |

⚠️ **Que una moneda cotice en Wise no significa que acepte al destinatario.** Honduras y República
Dominicana tienen su moneda entre las 103 y aun así los rechaza al dar de alta: HN con
`422 legalType = "Recipient type is not valid"`, DO con
`422 swiftCode = "Sorry, we dont support payments to this country"`.

⚠️ **Estados Unidos y Brasil fallan en Stripe por el mismo motivo y no es el país**: nuestra cuenta
de plataforma es de EE. UU., y el acuerdo `recipient` no vale «para plataformas en US creando
cuentas en US/BR» (mensaje literal de la API). Los dos los cubre Wise.

🔑 **Panamá sí se paga por Wise**, en dólares: `USD→USD` con un BIC panameño devuelve **200**. El
balboa (`PAB`) no está entre las 103 monedas, así que preguntar por él da un falso negativo. Son 3
de los 24 tutores, el segundo país con más gente después de Venezuela.

### Qué recibe de verdad un tutor, país por país

**Lo que decide si hay tarjeta de banco es tener fila en `payout_country_rules`**, no que los tres
proveedores lleguen al país: la FK de `tutor_payout_accounts.country` apunta ahí, así que sin fila no
hay etiquetas, ni bancos que ofrecer, ni guardado que pueda terminar
(`tutor/payouts/page.tsx`, filtro de familias).

| País o grupo | Fila de banco | Quién puede pagarle hoy | Resultado |
| :-- | :--: | :-- | :-- |
| AR · CL · MX · UY | ✅ | dLocal · Wise · Stripe | Banco |
| EC · PE · PY | ✅ | dLocal · Stripe (su fila no tiene `wise_account_type`) | Banco |
| BR | ✅ | dLocal (Stripe no admite BR; su fila no tiene formato de Wise) | Banco |
| CO | ✅ | Wise · Stripe | Banco |
| Zona euro · GB · CH · nórdicos · PL · CZ · HU · RO · RS · UA · TR · IL · AE · EG · PK · IN · AU | ✅ | Wise · Stripe | Banco |
| **US** | ✅ | Wise (Stripe no puede crear la cuenta) | Banco |
| PA · SV · CR · GT · BO · NI | ✅ | Wise · Stripe | Banco |
| **VE** | ❌ a propósito | ninguno de los tres | **Manual** (Zinli · Zelle · Binance) |
| 🔴 **HN · DO · CA · JP · NG · KE · ID · MY y el resto del mundo** | **❌** | **solo PayPal** | ⚠️ **hueco — ver abajo** |
| CU · RU · IR | ❌ | ninguno | No operable |

🔴 **El hueco, y es real: un riel que llegue al país no sirve si no hay formulario donde teclear la
cuenta.** República Dominicana tiene fila de ruteo con `{paypal, wise, stripe}` y Honduras cae en la
fila por defecto con lo mismo, pero **ninguno de los dos tiene fila en `payout_country_rules`**, así
que su tutor no ve tarjeta de banco: le queda PayPal y nada más. Y PayPal **no recibe en todos los
países** (§5), así que ahí puede quedarse sin ninguna vía. Lo mismo pasa con Canadá, Japón, Nigeria,
Kenia, Indonesia, Malasia y el resto de los que piden un código de banco de lista cerrada (§4).
Hoy no hay ningún tutor en esos países —los 24 están en VE, PA, MX, SV, ES, CO, EC y CL—, pero el
primero que se registre no puede cobrar.

### 🔑 Por qué Venezuela es manual, dicho con datos

**No es una decisión de producto: es el único país del mundo que ninguno de los tres alcanza.**
dLocal no paga allí, Wise no cotiza el bolívar (no está entre las 103 monedas) y Stripe no admite
cuentas venezolanas. El punto 4 del dictado —«manual solo Venezuela»— es exactamente lo que sale de
medir la cobertura. No hay ningún otro país que necesite pago manual.

### Cómo se elige el riel

**Por fee, entre los que cubren el país del tutor.** El orden vive en
`payment_routing_rules.payout_providers`, una lista ordenada por país — y **tocarlo es una
migración**, nunca un `UPDATE` a mano (regla de oro 5).

⚠️ **El saldo no es el criterio de orden.** dLocal y Stripe solo pueden pagar con el dinero que ellos
mismos cobraron; Wise y PayPal se fondean desde nuestro banco. Como operaciones fondea las cuentas a
diario, el orden lo manda el fee.

🔴 **El descenso entre rieles existe ANTES de elegir, no después — y esto hay que leerlo entero.**

- **Lo que sí hay:** `payoutProviderFor` recorre los candidatos del país en orden y descarta a los
  que no sirven, con dos filtros. Uno es la atadura de balance (`ataduraDeBalance`), y el otro es
  `rielSirveParaEsteTutor` (`src/lib/payments/riel-viable.ts`), que mira si **esa persona** tiene
  registrado lo que **ese riel** pide: dLocal se conforma con la cuenta, Wise necesita además
  dirección, teléfono, país cubierto y un banco de su lista, y Stripe la fecha de nacimiento y la
  aceptación de condiciones. Un riel sin los datos de ese tutor **nunca se elige**.
- **Lo que NO hay:** una vez elegido, no hay segundo intento. El desenlace `rechazado` de
  `payouts-process` (`src/app/api/cron/payouts-process/route.ts:734`) escribe `status: 'failed'`,
  encola la incidencia NTF-16 y termina la fila. La cola solo lee `scheduled` y `processing`, así que
  la pasada siguiente ya no la mira. Los desenlaces no terminales —`sin-datos`, `sin-fondos`,
  `transitorio`, `en-duda`— sí devuelven la orden a la cola y se reintentan; **el rechazo del
  proveedor, no.**

**Pendiente ABIERTO, y es el que más duele con tres rieles escondidos detrás de una sola tarjeta:**
un 422 de Wise deja al tutor sin cobrar aunque Stripe pudiera pagarle, y él no puede hacer nada
porque no sabe ni qué riel lo intentó. Hoy la orden queda «requiere revisión» y la cierra una
persona desde `/admin/payouts`. Bajar al siguiente candidato tras un rechazo es trabajo por escribir.

### La tarea diaria de operaciones

Es parte del diseño y hay que escribirla en el manual de operación, no en el código:

> **Todos los días, antes del ciclo de payouts:** revisar el saldo de Wise y de PayPal y fondearlos
> desde la cuenta de la empresa. El dinero para hacerlo sale de retirar los saldos de dLocal y de
> Stripe, que es donde entra el dinero de los alumnos.

### Manual = Venezuela, también al escribir

El ruteo, la pantalla y la **escritura** lo cumplen. `upsert_manual_destination` es la única puerta
de escritura de `tutor_manual_payout_destinations` y exige que el país de cobro del tutor tenga el
riel `manual` en su fila de `payment_routing_rules` — hoy solo `VE`. Pregunta a la tabla de ruteo y
no a un literal `'VE'`, para que abrir otro país siga siendo una migración de datos.

---

## 4 · La cobertura del formulario bancario

`payout_country_rules` tiene **55 filas**, 51 de ellas con riel de Wise. Se abrieron por **formato**
y no país a país: `iban` cubre 31 de golpe (los 20 del euro más Suiza, los nórdicos, Polonia,
Chequia, Hungría, Rumanía, Ucrania, Pakistán y Egipto), `swift_code` otros 7, y `sort_code`, `aba`,
`australian`, `indian` y `costa_rica` uno cada uno. Las 4 sin formato de Wise —BR, EC, PE, PY— las
paga dLocal.

⚠️ **Lo que queda fuera, y por qué** (medido, no supuesto): Venezuela, Cuba, Rusia e Irán no están
ni en la lista de países de Wise; Honduras y Rep. Dominicana los rechaza al dar de alta al
destinatario; y unos 17 países más —Canadá, Japón, Nigeria, Kenia, Indonesia, Malasia, Filipinas,
Tailandia, Sudáfrica, Singapur, Corea…— piden un **código de banco de una lista cerrada que sirve
Wise**, así que abrirlos no es una fila: es importar esos catálogos a `payout_banks`.

**Cada país sin fila es un tutor que no puede cobrar aunque los tres proveedores lleguen a su país.**
Es el hueco de §3, y es el trabajo que queda de la aclaración del cliente.

La buena noticia es que **son datos y un formato de cuenta, no un proveedor nuevo**. Wise dice qué
campos pide por moneda con una llamada. Medido:

```
EUR → iban          GBP → sort_code, iban        USD → aba
```

---

## 5 · Lo que el dictado provoca y no dice

### Los saldos dejan de seguir al tutor

Antes el país del tutor decidía las dos puntas, así que el dinero entraba y salía por el mismo sitio.
Con el punto 1 eso se acabó: un mismo tutor recibe cobros de alumnos de LATAM (saldo dLocal) y de
Europa (saldo Stripe).

Consecuencias que ya son ciertas y pasan a ser frecuentes:

- **Un tutor con cobros de dos corredores recibe dos órdenes de retiro**, una por saldo de origen
  (`payouts.funding_provider`). El código ya lo hace así.
- **La tesorería diaria deja de ser opcional.** Es la tarea de operaciones de §3.

### Guardar la tarjeta

El formulario embebido de dLocal **no tiene bóveda**: los alumnos que cobren por dLocal no pueden
guardar su tarjeta. La página de privacidad promete conservar marca y últimos cuatro «si eliges
guardar un medio de pago». → decisión abierta D-6.

### PayPal no recibe en todos los países

El sistema ofrece PayPal en los 195 países sin comprobarlo. Nigeria, por ejemplo, no puede
**recibir** pagos de PayPal. No está medido. Y donde no hay fila de banco, PayPal es la única vía
—ver el hueco de §3—, así que ahí esto pasa de incómodo a bloqueante.

---

## 6 · Lo que NO cambia (para que no se reabra)

- **PayPal.** Funciona de punta a punta desde el 4-sep. Se paga al identificador de la cuenta
  **conectada**, no al correo. El dictado no lo toca.
- **El manual es solo Venezuela**, en la pantalla y en la escritura.
- **El dinero sigue siendo server-side.** `payments.provider` lo congela `create_booking_line`, el
  importe sale de `payments.gross_amount`, y acreditar un cobro sigue siendo **exclusivo del
  webhook**. La ruta de confirmación de dLocal **no escribe en `payments`**.
- **El país del tutor sigue decidiendo el payout**, deducido de su zona horaria.
- **Los legales son del cliente.** Con el punto 2 la página de pago carga terceros de dLocal y
  `/cookies` y `/privacy` quedan desactualizados. Se avisa una vez; no los redactamos.

---

## 7 · Decisiones abiertas

| # | Pregunta | Recomendación |
| :-- | :-- | :-- |
| **D-1** | ~~¿Entra Stripe como tercer riel del banco?~~ | ✅ **APROBADA por el cliente el 10-sep-2026.** Stripe entra **detrás de Wise** en 17 países con fila propia y en la fila por defecto (o sea, España, Alemania, Japón y el resto del mundo). Fuera: Brasil, Venezuela y EE. UU., donde no puede crear la cuenta. El coste fueron **dos** campos nuevos —fecha de nacimiento y aceptación de condiciones—, porque la dirección, la provincia y el documento ya se pedían. |
| **D-2** | ~~¿Qué pasa con los tutores de ES, PA y SV?~~ | ✅ **Resuelta por la aclaración del cliente**: se les abre el formulario bancario, y los tres países tienen fila. |
| **D-3** | Al embeber se pierden PIX, boleto y OXXO. ¿Solo-tarjeta, o híbrido con enlace a «otros medios de pago»? | **Híbrido, y urge.** Medido el 10-sep: en Ecuador la cuenta ofrece **12 métodos de efectivo** (`EF`, `EF_BA`, `EF_WU`…), así que al embeber se pierden de verdad. El respaldo cuesta un enlace, porque la URL del checkout alojado se sigue devolviendo. |
| **D-4** | ~~¿Se aceptan los campos nuevos (nombre, apellido, tipo y número de documento) antes de pagar?~~ | ✅ **Sí.** Es el coste del punto 2 y dLocal los exige. Ya están en el formulario. |
| **D-5** | ~~¿Manda el fee o manda la caja?~~ | ✅ **Resuelta por la aclaración del cliente**: manda el **fee**, porque operaciones fondea a diario. |
| **D-6** | ¿Se acepta perder la tarjeta guardada donde cobre dLocal? | Condicionar la pantalla de «Métodos de pago» al país. Y dejar de crear ficha de cliente en Stripe para alumnos que van a pagar por dLocal. |
| **D-7** | **¿Se le pide al tutor un documento que no viaja a ningún sitio?** | **45 de las 55 filas de `payout_country_rules` piden `TAX` o `PASS`** y ese dato no se manda a nadie: los corredores `iban`, `aba`, `sort_code`, `australian`, `indian` y `swift_code` no lo piden. Están ahí porque `document_patterns` tiene un `check … <> '{}'` y no admite vacío (`20260910150000`). Los 7 países que sí lo mandan son AR, BR, CL, CO, CR, MX y PY. **Es PII de más:** la salida es dejar que `beneficiary_document` sea null y relajar el `check`. Sin decidir. |

### Pendientes que no son decisiones

- **Avisar al cliente** de que `/cookies` y `/privacy` quedan desactualizados: la pantalla de pago
  carga dos terceros de dLocal, uno de ellos un recolector antifraude. No los redactamos nosotros
  (§6).
- **Revisar las pantallas de confirmación.** Con dLocal se llega con la reserva aún en
  `pending_payment` unos segundos, hasta que entra el webhook.
- **Bajar al siguiente riel cuando el proveedor rechaza** (§3, «Cómo se elige el riel»).

### Bloqueantes que no son de código

| Quién | Qué |
| :-- | :-- |
| **Cliente** | D-3. |
| **dLocal** | ✅ **Credenciales de producción puestas el 10-sep**, junto a `DLOCALGO_API_BASE` — que conmuta el host **y** la clave de SmartFields, así que la de producción entra sola: no es una variable aparte. ⚠️ Sigue pendiente **repetir la medida contra la API en vivo**: todo lo medido es sandbox, y las claves de dLocal **no traen prefijo** que distinga el ambiente, así que el único indicador es de dónde se copiaron (`dashboard.` = producción). El tell en el primer cobro real: si el formulario carga la clave `b458948f-…`, está en producción. |
| **Operaciones** | Montar la rutina diaria de fondeo y decidir quién la ejecuta. |

---

## 8 · Probado con dinero real (10-sep-2026)

Contra el servidor de **producción compilado** (`npm run build` + `npm start`), no `next dev`, con
cuentas reales de dev. Es lo que separa este documento de un plan.

- **Cobro por dLocal embebido.** Alumno de Bogotá → formulario transparente **dentro del sitio**,
  con los tipos de documento de Colombia que sirve la API de dLocal. Pagado con tarjeta de prueba →
  **`DP-257014` con `status: PAID` y `direct: True`** → webhook firmado → `payments` en `paid` →
  reserva `confirmed`. Congelado: `payer_country=CO`, `payee_country=VE`, `provider=dlocal`.
- **Cobro por Stripe, mismo tutor venezolano.** Alumna de Madrid → formulario de Stripe embebido en
  la misma pantalla. Congelado: `payer_country=ES`, `provider=stripe`. **Dos alumnas de dos
  corredores pagando al mismo tutor** es la tesis del dictado en dos filas de base de datos.
  ⚠️ El *submit* de Stripe no se pudo pulsar desde el arnés del navegador: monta el formulario en un
  iframe de origen cruzado. El ruteo sí quedó verificado.
- **Formulario bancario de una tutora española.** Pide **IBAN** —ni sucursal ni banco de lista— más
  los dos campos nuevos. Guardado → `beneficiary_dob`, `stripe_tos_accepted_at` y `stripe_tos_ip` en
  la base, y `banco_stripe: true`.
- **Payout con dinero saliendo.** La orden se creó desde el botón de la pantalla. El job eligió
  **Wise** (descartó Stripe por atadura de balance y dLocal por país). Con una tutora sin teléfono,
  donde Wise no puede, eligió **Stripe** y **pagó**: `tr_1UDtukHLJB7CRIwf…`, **137,25 US$**, cuenta
  `acct_1UDtud…` creada por nosotros, país ES, `transfers: active`, IBAN ····1332.
- 🔑 **Y ella no ve Stripe.** Su historial dice `Transferencia bancaria · ····1332`, y la palabra
  «Stripe» no aparece en ninguna parte de la pantalla. Punto 3 del dictado, literal.

---

## 9 · Qué se midió para escribir esto

Contra el código, la base de datos real y las APIs de los proveedores.

- **dLocal transparente:** la vía es `allow_transparent` en el `POST /v1/payments` y luego
  `GET /v1/checkout/{token}` → `prepare-confirm` → `confirm`, en ese orden. El tokenizador de
  `js-sandbox.dlocal.com` montado en navegador devuelve `{"token":"CV-…"}`; su clave está hardcodeada
  en el SDK de dLocal Go. `POST /v1/payments/smart-fields/pm/{token}` con `{"brand":"VI"}` →
  correcto; con OXXO, PIX y efectivo → 404 «not available for Merchant», pero el catálogo de Ecuador
  sí ofrece 12 métodos de efectivo por el checkout alojado (D-3).
- **Wise:** `GET /v1/currency-pairs` → **103 monedas destino** desde USD. `account-requirements` por
  moneda → EUR `iban`, GBP `sort_code`/`iban`, USD `aba`. VES no está en la lista. Panamá paga en
  USD→USD; HN y DO rechazan el alta del destinatario.
- **Stripe (`recipient`):** `POST /v1/accounts` país por país en *test mode* → **54 de 60 OK**.
  Fallan US y BR («not supported for platforms in US creating accounts in US/BR») y VE, CU, RU, IR.
- **Ruteo:** `ruta_de_pago('EC').charge_providers` → `{dlocal, stripe}`; `('ES')` y `(null)` →
  `{stripe}`. En el lado del payout, 19 filas por país más la de defecto; `stripe` está en 17 de
  ellas y en la de defecto, nunca en BR ni en VE.
- **Tutores:** 24 — VE 14 · PA 3 · MX 2 · SV 1 · ES 1 · CO 1 · EC 1 · CL 1.
- **Reglas bancarias:** `payout_country_rules` tiene **55 filas**; 51 con `wise_account_type`; 45
  con documento solo ceremonial (`TAX`/`PASS`).
