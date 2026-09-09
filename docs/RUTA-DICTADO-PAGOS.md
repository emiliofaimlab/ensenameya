# Ruta de implementación del dictado de pagos

> Checklist vivo. Se marca a medida que se va cerrando. La verdad de QUÉ hay que hacer está en
> `docs/DICTADO-PAGOS.md`; esto es solo el control de avance.
>
> Arranque: 9-sep-2026 · rama `dev`

## Fase 0 · Purga de la documentación vieja

- [x] Borrar las memorias de pagos que contradicen el dictado (8 ficheros)
- [x] `CLAUDE.md`: reescribir la sección de pagos y la tabla de integraciones
- [x] `docs/PAGOS-Y-PAYOUTS.md`: marcar qué queda derogado (sigue mandando en COSTES)
- [ ] `docs/BACKLOG.md` y `docs/PLAN-DESARROLLO.md`: marcar historias obsoletas

## Fase 1 · El cobro lo decide el país del ALUMNO

- [x] Migración: `create_booking_line` deduce y congela `payer_country`, y rutea el cobro por él
- [x] Migración: `set_charge_provider` valida contra la ruta del PAGADOR
- [x] Migración: zonas heredadas de Argentina en `timezone_countries`
- [x] Migración: autocomprobación (EC→dlocal, ES→stripe, sin zona→stripe)
- [x] `src/lib/payments.ts`: `chargeProvidersFor(payerCountry)`
- [x] `src/app/api/pagos/checkout/route.ts`: `payerCountry` único, borrar `ruteoComun()`
- [x] Pantalla de checkout: leer `payments.payer_country`
- [~] Carrito: **no aplica** — no existe tal advertencia en la interfaz; la comprobación SQL de `create_order` se queda como cinturón (ya inalcanzable)
- [x] Semillas de dev con alumnos de tres corredores
- [x] `npm run db:push` + `npm run db:types`

## Fase 2 · Banco único y Stripe fuera de la vista

- [x] Borrar `connect-alta.tsx` y `api/tutor/stripe-connect/`
- [x] Borrar `connect-mapeo.ts` + `.check.ts` + script `check:connect`
- [x] Borrar la familia `'conectada'`: 4 declaraciones y 5 ramas, **en el mismo commit**
- [x] Borrar `estadoDeLaCuenta()` y el alias `RielDeCobro`
- [x] `stripeProvider.payout()` → «sin ejecutor»
- [x] Historial del tutor: `VIA.stripe` → «Transferencia bancaria»
- [x] Migración: `array_remove(payout_providers,'stripe')` + limpiar la preferencia `stripe`
- [x] Migración: guard de Venezuela en `upsert_manual_destination` + borrar la fila de MX
- [x] Botón de retirar deshabilitado si no hay ninguna tarjeta lista
- [x] Perú: `beneficiary_address_street` y `beneficiary_city` al POST de dLocal

## Fase 3 · Abrir el formulario bancario al mundo

- [x] Medir en Wise los campos por moneda (`account-requirements`) de los formatos a abrir
- [x] Migración: formato **IBAN** (zona euro) en `payout_country_rules`
- [x] Migración: formato **ABA** (Estados Unidos)
- [x] Migración: Panamá, El Salvador, Costa Rica, Guatemala, Bolivia — ⚠️ **Rep. Dominicana NO**: Wise la rechaza (`422 «we dont support payments to this country»`). Solo la cubre Stripe → depende de D-1
- [x] Migración: el resto de países que cubra alguno de los tres rieles
- [x] `wise-mapeo.ts`: tipos de cuenta `iban` / `aba` / `sort_code`
- [x] `payout-account-form.tsx`: campos condicionales por formato
- [x] `npm run check:wise` en verde

### Rematado sobre lo que trajo la fase 3

- [x] `beneficiary_state` (lo exigen `aba` y `australian`) leído en la pantalla y en el tipo
- [x] `branch_label` / `branch_help` en `payout_country_rules`: el mensaje de error deja de decir
      «Falta la sucursal» a un británico al que le falta su sort code. Muere el `Record<>` del TSX
- [x] Comentarios que decían «nueve filas» y «solo CO, AR, MX, CL y UY»
- [x] `docs/DICTADO-PAGOS.md` §3: corregido — Wise **no** llega a Honduras ni a Rep. Dominicana,
      y **sí** a Panamá (estaba descartado por medir USD→PAB en vez de USD→USD)
- [ ] ⚠️ **PII de más**: 38 filas piden `TAX`/`PASS` porque `document_patterns` no admite vacío,
      aunque su corredor no manda el documento a nadie. Pendiente de decidir

## Fase 4 · dLocal embebido

- [x] `port.ts`: variante `ChargeTransparente` conservando `redirectUrl` de respaldo
- [x] `dlocalgo.ts`: `merchant_checkout_token` y `smartFieldsKey()`
- [x] `dlocal-provider.ts`: `allow_transparent` y los tres retornos; 929 cae al alojado
- [x] `api/pagos/confirmar-dlocal/route.ts` (nuevo, no escribe en `payments`)
- [x] `components/checkout/dlocal-embed.tsx` (nuevo)
- [x] Los TRES puntos de montaje ganan la rama `transparente`, en el mismo commit
- [x] Formulario del pagador: nombre, apellido, **tipo** de documento y número — ⚠️ el tipo SÍ hace falta (`400 908`), y son **cuatro** campos en AR/BR/CL/MX; tres solo en Ecuador
- [x] `.env.example` corregido

## Fase 5 · Stripe como tercer riel del banco

**D-1 aprobada por el cliente el 10-sep-2026.**

- [x] Medir qué pide Stripe país por país (`requirements.currently_due`)
- [x] Migración: `beneficiary_dob`, `stripe_tos_accepted_at`, `stripe_tos_ip` + grants
- [x] Migración: `payout_beneficiary_stripe()`, gemela de las de dLocal y Wise
- [x] Migración: `stripe` vuelve a `payout_providers`, **detrás de Wise**, en 17 países + defecto
- [x] Migración: `upsert_payout_account` acepta `p_dob` y `p_tos_ip`; la hora la sella el servidor
- [x] Formulario: fecha de nacimiento + casilla de autorización, las dos opcionales
- [x] La IP se resuelve en el servidor y baja por props (el navegador no puede decir la suya)
- [x] Adaptador `stripeProvider.payout()` + mapeo puro con su check
- [x] `puedePagar` deja de ser `false`
- [x] Colombia y Chile: `account_type` a la RPC y al mapeo — sin él Stripe los rechazaba
- [x] `banco_stripe` en `datos_de_cobro_del_tutor` + su rama en `riel-viable` + casos en el check
- [x] Comprobación visual del formulario: hecha el 10-sep con el panel visible

## Prueba de punta a punta en el navegador (10-sep-2026)

Servidor de **producción** (`npm run build` + `npm start`), no `next dev`. Cuentas reales de dev.

- [x] **Alumno de Bogotá → dLocal.** Formulario transparente DENTRO del sitio, con los tipos de
      documento de Colombia que sirve la API de dLocal. Pagado con tarjeta de prueba →
      `DP-257014` con **`status: PAID` y `direct: True`** → webhook firmado → `payments.paid` →
      reserva `confirmed`. Congelado: `payer_country=CO`, `payee_country=VE`, `provider=dlocal`.
      🔑 Cierra el hueco que el repo declaraba abierto desde el 1-sep: nadie había visto nunca una
      transición `PENDING→PAID` de dLocal.
- [x] **Alumna de Madrid → Stripe.** Formulario de Stripe embebido en la misma pantalla.
      Congelado: `payer_country=ES`, `provider=stripe`. **Mismo tutor venezolano que el caso
      anterior** — que es la tesis del dictado en dos filas de base de datos.
- [~] El *submit* de Stripe no se pudo pulsar desde el arnés: monta el formulario entero en un
      iframe de origen cruzado y ni el puntero ni el tabulador llegan al botón. El ruteo sí está
      verificado; el cobro por Stripe es funcionalidad previa ya documentada como probada.
- [x] **Formulario bancario de una tutora española**: pide **IBAN** (no sucursal ni banco de
      lista) más los dos campos nuevos. Guardado → `beneficiary_dob`, `stripe_tos_accepted_at` y
      `stripe_tos_ip` en la base, y `banco_stripe: true`.
- [x] **Retiro y payout.** La orden se creó con el botón de la pantalla. El job eligió **Wise**
      (descartó Stripe por atadura de balance y dLocal por país) — el ruteo funciona. Con una
      tutora sin teléfono, donde Wise no puede, eligió **Stripe** y **pagó**:
      `tr_1UDtukHLJB7CRIwf…`, 137,25 US$, cuenta `acct_1UDtud…` creada por nosotros, país ES,
      `transfers: active`, IBAN ····1332.
- [x] 🔑 **Y ella no ve Stripe.** Su historial dice `Transferencia bancaria · ····1332`, y la
      palabra «Stripe» no aparece en ninguna parte de la pantalla. Punto 3b, literal.

### Lo que la prueba destapó y se arregló

- [x] El botón de retirar decía «No tienes saldo disponible» a una tutora con 137,25 US$: lo que
      le faltaba era la cuenta, no el dinero. Ahora distingue los dos motivos.

### Lo que la prueba destapó y NO se tocó

- [ ] ⚠️ **Un `rechazado` de un riel NO baja al siguiente.** El 422 de Wise («cannot accept
      payments to this recipient») dejó la orden en `failed` sin probar Stripe, que sí podía
      pagarle. Es diseño previo —el job lo marca «requiere revisión»— y cambiarlo es una decisión
      de producto, no un bug de esta tanda.
- [ ] El retiro pide confirmación con un `confirm()` nativo del navegador. Funciona, pero para una
      acción de dinero conviene un diálogo propio.
- [ ] Los ejemplos de dirección y teléfono del formulario son colombianos (`Calle 12 #4-56`,
      `+57 300…`) también para una tutora española.

## Cierre

- [x] `npm run lint` y `npm run typecheck` en verde
- [x] `npm run check:*` todos en verde
- [~] Verificación funcional: fases 1, 2 y 3 verificadas contra la BD. **Fase 4 pendiente de una
      persona**: el panel del navegador no puede teclear dentro de los iframes de dLocal, así que el
      cobro `PAID` de punta a punta hay que hacerlo a mano con la tarjeta de prueba
- [ ] Avisar al cliente de que `/cookies` y `/privacy` quedan desactualizados: la pantalla de pago
      carga ahora dos terceros de dLocal, uno de ellos un recolector antifraude
- [ ] Revisar las pantallas de confirmación: con dLocal se llega con la reserva aún en
      `pending_payment` unos segundos, hasta que entra el webhook

---

## Estado al cerrar la sesión del 10-sep-2026

**Fases 1, 2, 3 y 4 escritas y aplicadas a `dev`.** `typecheck`, `lint` y los cuatro `check:*`
en verde. Seis migraciones nuevas, 35 ficheros tocados, 4 borrados.

**Verificado de verdad, no con el typecheck:**

- Fase 1 · tres reservas reales con el mismo tutor colombiano: alumno EC → dLocal, ES → Stripe,
  sin zona → Stripe.
- Fase 2 · ninguna fila de ruteo nombra ya a `stripe` en `payout_providers`; Venezuela conserva
  su riel manual y ningún otro país lo tiene.
- Fase 3 · en pantalla, la tutora española ve **PayPal y Transferencia bancaria**, y ninguna
  tarjeta de Stripe. La de banco no existía para España hasta hoy.

**Lo único sin verificar de punta a punta: un cobro `PAID` por dLocal embebido.** El panel del
navegador no puede teclear dentro de los iframes de dLocal —es justo lo que nos mantiene en PCI
SAQ A—, así que hace falta una persona rellenando la tarjeta de prueba en
`/reservar/…/checkout` con un alumno cuya zona horaria sea `America/Guayaquil`.

**Sin decidir, esperando al cliente:** D-1 (Stripe como tercer riel del banco), D-3 (ahora con
más peso: en Ecuador la cuenta sí ofrece 12 métodos de efectivo que el embebido pierde), D-6, y
la PII de más de las 38 filas que piden documento sin mandarlo a nadie.
