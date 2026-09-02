import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  DlocalGoError,
  aUnidadMayor,
  aUnidadMenor,
  crearPayout,
  dlocalgoFetch,
  esCredencialInvalida,
  esLimiteDiario,
  esSaldoInsuficiente,
  fechaDePayout,
  firmaCuadra,
  firmaDeCabecera,
  firmarNotificacion,
  isDlocalGoConfigured,
  listarPayouts,
  recuperarPago,
  recuperarPayout,
  type NuevoPayoutDlocalGo,
  type PagoDlocalGo,
  type PayoutDlocalGo,
  type ReembolsoDlocalGo,
} from "@/lib/dlocalgo";
import type {
  ChargeInput,
  ChargeResult,
  CobroRef,
  PayoutInput,
  PayoutResult,
  PspProvider,
  RefundInput,
  RefundResult,
  WebhookInput,
  WebhookVerificacion,
} from "./port";

/**
 * EL ADAPTADOR DE dLOCAL GO — el segundo PSP, y el que demuestra que el puerto
 * servía para algo.
 *
 * Todo lo escrito aquí está comprobado **contra el sandbox real**
 * (`api-sbx.dlocalgo.com`, cuenta propia, 1-sep-2026), no contra la
 * documentación. Donde la doc y la API se contradicen, manda la API y queda
 * anotado. Esa distinción no es pedantería: la tabla oficial de parámetros de
 * payouts y lo que el endpoint acepta de verdad NO coinciden, y creerle a la
 * tabla habría costado un pago rechazado por tutor.
 *
 * ── LOS CINCO DESAJUSTES CON EL PUERTO, Y CÓMO SE RESUELVE CADA UNO ─────────
 *
 * 1. FORMA DEL COBRO → `redirect_url`, no `client_secret`. El puerto ensanchó
 *    `ChargeResult` con `modo: 'redireccion'`. SmartFields (que sería embebido)
 *    NO está disponible: `"direct": true` se ignora en silencio y vuelve
 *    `"direct": false`. Ver `ChargeRedirigido` en `port.ts`.
 *
 * 2. EL WEBHOOK NO TRAE EVENTO, TRAE UN PING (`{"payment_id":"DP-283"}`). La
 *    deduplicación se sintetiza como `dlocalgo:<id>:<status>` releyendo el
 *    estado de la API. Ver `verifyWebhook` abajo y `WebhookEvent.id` en el
 *    puerto.
 *
 * 3. UNIDADES → dLocal usa unidad mayor (`500.00`), el puerto usa `amountMinor`.
 *    La división vive en `lib/dlocalgo.ts` (`aUnidadMayor`) y en ningún sitio
 *    antes, con el cuidado de que CLP y PYG NO tienen céntimos.
 *
 * 4. IDEMPOTENCIA → no hay cabecera; el sustituto es `order_id` único, y
 *    repetirlo es un 400 (`5009`), no la respuesta cacheada. Se EMULA. Es lo
 *    más delicado del archivo y tiene su propio bloque en `charge`.
 *
 * 5. CADUCIDAD → relativa (`expiration_type` + `expiration_value`), no época
 *    Unix. Se convierte en `charge`. El enum real es [HOURS, DAYS, MINUTES] y
 *    el valor mínimo es 1 (comprobado: `-5` devuelve «must be greater than or
 *    equal to 1»).
 *
 * ── LO QUE ESTE ARCHIVO NO HACE ────────────────────────────────────────────
 * No decide políticas: ni la caducidad (la calcula `api/pagos/checkout`, porque
 * entra en la clave de idempotencia), ni el importe (sale de
 * `payments.gross_amount`, regla de oro 2), ni si una reserva merece cobro.
 * Recibe y ejecuta. Igual que el de Stripe.
 *
 * ── LO QUE FALTA POR EJERCITAR, DICHO CLARO ────────────────────────────────
 * Un cobro COMPLETADO. Todo lo de arriba se probó creando cobros, leyéndolos y
 * provocando sus errores, pero pagar uno exige rellenar el formulario alojado
 * de dLocal con una tarjeta de prueba en un navegador. Hasta que eso pase, NO
 * están verificados de punta a punta: la firma real de una notificación (el
 * algoritmo sí está implementado según su doc, pero nadie ha visto llegar una),
 * el `POST /v1/refunds` sobre un cobro pagado (hoy devuelve «Transaction not
 * found» porque no hay ninguno) y la transición PENDING→PAID. Es exactamente el
 * mismo estado en el que estuvo Stripe antes de PAC-03, y se cierra igual: con
 * un cobro de prueba de punta a punta.
 */

/** Mismo criterio y mismo formato que en Stripe: solo el pedido lleva prefijo. */
const PREFIJO_PEDIDO = "order_";

/**
 * `order_id` es lo único que viaja a dLocal con nuestro sujeto dentro, así que
 * lleva las dos cosas: la clave de idempotencia (que es lo que le da unicidad y
 * determinismo) y, dentro de ella, el sujeto del cobro. `api/pagos/checkout` la
 * compone como `booking-<uuid>-c<epoch>-v5` / `order-<uuid>-c<epoch>-v5`.
 *
 * ⚠️ NO se inventa aquí un formato propio: si esta función y la clave del
 * checkout divergieran, el `order_id` dejaría de ser determinista por reserva y
 * cada recarga abriría un cobro nuevo.
 */
function ordenExterna(input: ChargeInput): string {
  return input.idempotencyKey;
}

/** Lo que se manda como `description`: legible en su panel, sin PII. */
function descripcionDe(input: ChargeInput): string {
  const primera = input.lineas[0]?.concepto ?? "Mentoría";
  return input.lineas.length > 1
    ? `${primera} (+${input.lineas.length - 1})`
    : primera;
}

/**
 * De `order_id` de vuelta a nuestro sujeto.
 *
 * El formato de la clave del checkout es `<tipo>-<uuid>-c<epoch>-v<n>`, así que
 * el uuid es lo que va entre el primer guion y `-c`. Se saca con una expresión
 * anclada en el uuid y no partiendo por guiones, porque el uuid LLEVA guiones
 * dentro y `split('-')` lo destroza.
 */
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const RE_ORDEN = new RegExp(`^(booking|order)-(${UUID})`);

export function refDeOrdenExterna(orderId: string | null | undefined): CobroRef | null {
  if (!orderId) return null;
  const m = RE_ORDEN.exec(orderId);
  if (m) {
    return { tipo: m[1] === "order" ? "order" : "booking", id: m[2]! };
  }
  // Compatibilidad con el otro formato posible: `order_<uuid>` pelado, el mismo
  // que usa `client_reference_id` en Stripe. No lo produce este adaptador, pero
  // reconocerlo es gratis y evita que un cobro creado a mano quede huérfano.
  if (orderId.startsWith(PREFIJO_PEDIDO)) {
    const id = orderId.slice(PREFIJO_PEDIDO.length);
    return new RegExp(`^${UUID}$`).test(id) ? { tipo: "order", id } : null;
  }
  return new RegExp(`^${UUID}$`).test(orderId) ? { tipo: "booking", id: orderId } : null;
}

/**
 * DESAJUSTE 5 · de época Unix a caducidad relativa.
 *
 * El puerto trae `expiresAt` en segundos Unix porque Stripe lo quiere así y
 * porque el valor entra en la clave de idempotencia (X-02). dLocal lo quiere en
 * unidades relativas desde AHORA.
 *
 * ⚠️ LA CONVERSIÓN NO ES DETERMINISTA Y NO PUEDE SERLO: depende de `Date.now()`,
 * así que dos llamadas para la misma reserva producen valores distintos. Con
 * Stripe eso sería un error de idempotencia; aquí no importa, porque la
 * idempotencia la resuelve el `order_id` y la emulación de `charge` — el cobro
 * repetido ni siquiera llega a crearse. Es justo el motivo de que la emulación
 * NO pueda basarse en "mandar los mismos parámetros".
 *
 * Suelo de 1 minuto: es el mínimo que acepta la API. Si la reserva ya venció
 * mientras se abría el checkout, se manda 1 y que el cobro nazca casi muerto —
 * mejor eso que un 400 que deja al alumno sin pantalla. La red de seguridad
 * real es X-02 en el webhook, como siempre.
 */
function caducidadRelativa(expiresAt: number): { expiration_type: "MINUTES"; expiration_value: number } {
  const minutos = Math.ceil((expiresAt - Date.now() / 1000) / 60);
  return { expiration_type: "MINUTES", expiration_value: Math.max(1, minutos) };
}

/**
 * DESAJUSTE 4 · DÓNDE SE RECUERDA EL COBRO ABIERTO.
 *
 * En `payments.provider_payment_id` / `orders.provider_payment_id`, que ya
 * existen y que con Stripe sella el webhook. Aquí hay que sellarlo ANTES, al
 * crear, y el motivo es que no hay otra forma de reencontrar el cobro:
 *
 *   · `GET /v1/payments` NO lista los cobros PENDING (comprobado: seis cobros
 *     creados, `totalElements: 0`);
 *   · el filtro `?order_id=` se ignora y devuelve vacío;
 *   · y `POST` repetido da 400, no el cobro anterior.
 *
 * Así que la memoria es nuestra o no hay memoria. Sin ella, cada recarga del
 * checkout —que desde D-2 (§20.14) monta el cobro al LLEGAR, no al pulsar—
 * abriría un cobro nuevo en dLocal.
 */
async function refGuardada(ref: CobroRef): Promise<string | null> {
  const admin = createAdminClient();
  if (ref.tipo === "order") {
    const { data, error } = await admin
      .from("orders")
      .select("provider_payment_id")
      .eq("id", ref.id)
      .maybeSingle();
    // ⚠️ El error se relanza, no se trata como «no hay». Regla de oro 9: a
    // `service_role` puede faltarle un grant y eso muerde en TIEMPO DE
    // EJECUCIÓN. Confundirlo con «no hay cobro previo» abriría un cobro nuevo
    // en cada recarga sin que nadie se entere.
    if (error) throw new Error(error.message);
    return data?.provider_payment_id ?? null;
  }
  const { data, error } = await admin
    .from("payments")
    .select("provider_payment_id")
    .eq("booking_id", ref.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.provider_payment_id ?? null;
}

/**
 * Sella el `DP-…` en TODAS las filas del sujeto, igual que hace el webhook de
 * Stripe y por la misma razón: `enqueue_refund` (X-01) copia
 * `payments.provider_payment_id` a la cola, y una línea sin sellar se encolaría
 * sin referencia y moriría como «sin provider_payment_id».
 */
async function sellarRef(ref: CobroRef, providerRef: string): Promise<void> {
  const admin = createAdminClient();
  if (ref.tipo === "order") {
    const { data: lineas, error: eLineas } = await admin
      .from("bookings")
      .select("id")
      .eq("order_id", ref.id);
    if (eLineas) throw new Error(eLineas.message);

    const { error } = await admin
      .from("payments")
      .update({ provider_payment_id: providerRef })
      .in("booking_id", (lineas ?? []).map((b) => b.id));
    if (error) throw new Error(error.message);

    const { error: eOrden } = await admin
      .from("orders")
      .update({ provider_payment_id: providerRef })
      .eq("id", ref.id);
    if (eOrden) throw new Error(eOrden.message);
    return;
  }
  const { error } = await admin
    .from("payments")
    .update({ provider_payment_id: providerRef })
    .eq("booking_id", ref.id);
  if (error) throw new Error(error.message);
}

/**
 * ¿Ese cobro sigue sirviendo para pagar **este** sujeto y **este** importe?
 *
 * ⚠️ LAS TRES CONDICIONES SON OBLIGATORIAS, Y LAS DOS ÚLTIMAS SE AÑADIERON
 * PORQUE FALTABAN. La revisión adversarial encontró que mirar solo `PENDING`
 * deja pasar el cobro de OTRO sujeto, y con él otro importe:
 *
 *   · el alumno tiene un pedido O con dos líneas (B1 25 $, B2 50 $) y entra en
 *     `/pedidos/O/pagar` → se abre un cobro de 75 $, que `sellarRef` estampa en
 *     la fila de `payments` de LAS DOS líneas, que es lo correcto para que
 *     `enqueue_refund` encuentre la referencia;
 *   · no paga, y luego abre la reserva B1 suelta desde «Mis reservas» —esa
 *     pantalla no sabe qué es un `order_id`, y no tiene por qué saberlo—;
 *   · `refGuardada` devuelve el mismo `DP-…`, sigue `PENDING`, y se le reabre.
 *     La pantalla dice «25 $» y dLocal cobra **75 $**.
 *
 * Es exactamente lo que prohíbe la regla de oro 2: el importe deja de salir del
 * `payments.gross_amount` del sujeto. Y no es una carrera ni un caso raro — son
 * tres clics en la interfaz que ya existe.
 *
 * Por eso se compara contra el cobro recuperado de la API y no contra lo que
 * creemos haber guardado: `order_id` dice de quién es y `amount` cuánto vale,
 * los dos según dLocal, que es quien va a cobrar.
 */
function reutilizable(pago: PagoDlocalGo, input: ChargeInput): boolean {
  if (pago.status !== "PENDING" || !pago.redirect_url) return false;

  // ¿Es de este sujeto? `order_id` es determinista y codifica la referencia.
  const suyo = refDeOrdenExterna(pago.order_id);
  if (!suyo || suyo.tipo !== input.ref.tipo || suyo.id !== input.ref.id) return false;

  // ¿Por este importe? En unidades menores, que es donde vive la verdad; el
  // cobro viaja en unidad mayor y CLP/PYG no tienen céntimos (ver `SIN_CENTIMOS`).
  const esperado = input.lineas.reduce((s, l) => s + l.amountMinor, 0);
  return aUnidadMenor(pago.amount, pago.currency) === esperado;
}

// ════════════════════════════════════════════════════════════════════════════
// C2 · PAGARLE AL TUTOR — la emulación de idempotencia, que aquí es TODO
// ════════════════════════════════════════════════════════════════════════════
//
// En el cobro la idempotencia se emula con `order_id`, que al menos CHOCA. En el
// payout no hay nada que choque: ni cabecera de idempotencia, ni `external_id`,
// ni un `order_id`. Dos POST idénticos crean dos pagos, y punto.
//
// Y encima **un 400 puede haber creado el payout igual**. Eso no es una
// advertencia de la doc: el 2-sep-2026, el primer POST de esta sesión devolvió
// `400 {"code":7000,"message":"Invalid param: beneficiary.document.id …"}` y
// dejó el payout `86661116764330` en `FAILED`, en el listado, con nuestra marca
// dentro. La cancelación tampoco salva: `POST /v1/payouts/{id}/cancel` devolvió
// `2316 not cancellable` a los ~18 minutos de crearlo pese a estar `PENDING`,
// cuando su doc promete una ventana de ~15. No hay «deshacer».
//
// Con eso, la única forma de no pagar dos veces es NO LLAMAR DOS VECES, y para
// eso hacen falta las TRES piezas de abajo. Ninguna sirve sin las otras:
//
//   1. EL CANDADO, que vive en la base de datos y no aquí: el job reclama la
//      fila con `update payouts set status='processing' where id=? and
//      status='scheduled'`. Es atómico, así que dos pasadas solapadas no pueden
//      ganar la misma orden, y deja escrito en `provider_metadata` el instante
//      del reclamo. Ese instante es `claimedAt`.
//
//   2. 🔑 LA MARCA, que es lo que faltaba: `description` es texto libre, viaja de
//      ida y vuelve intacto, y ahí va `EY-<payouts.id>-<intento>`. Convierte el
//      barrido de «este payout se parece al que busco» en «este payout ES el de
//      esta orden». Ver `marcaDe()`.
//
//   3. EL BARRIDO, que vive aquí: cuando una orden ya reclamada vuelve sin
//      identificador —porque el proceso murió, porque el 400 mintió, porque se
//      cayó la red— **no se reintenta**. Se pasea `GET /v1/payouts` buscando la
//      marca. Si aparece, se adopta. Si se recorre TODA la ventana que podía
//      contenerla y no aparece, la orden vuelve a la cola. Y si no se pudo
//      terminar de mirar, se queda en duda y **no la toca nadie hasta que la
//      mire una persona**.
//
// ⚠️ LO QUE ESTE BLOQUE HACÍA MAL Y AHORA NO, porque son fallos que se pueden
// volver a cometer leyendo la documentación en vez de la API:
//
//   · Leía `p.id`. El campo se llama `payout_id`: ni la respuesta del POST ni la
//     del listado traen `id`, así que TODOS los pagos perdían su identificador.
//   · Cotejaba por `transfer_amount`, `transfer_country`, `beneficiary_document`
//     y `created_date`. **Ninguno de los cuatro existe en la respuesta**, así que
//     su cotejo no podía ni identificar ni descartar un solo payout: todo salía
//     «posible» y toda orden reanudada acababa en duda.
//   · Daba por ausente lo que solo estaba más allá de la última página que miró.
//     Ausencia es lo que autoriza a pagar otra vez.
//   · Cotejaba por parecido, así que podía adoptar el payout de OTRO tutor.
//   · Trataba un 403 de credenciales como una orden dudosa, y con eso atascaba
//     la cola entera por una variable de entorno mal puesta.
//
// La asimetría es deliberada y es el criterio de todo este bloque: un payout que
// se queda parado se arregla; un payout pagado dos veces se reclama a alguien que
// ya cobró. Ante la duda, no se manda.

/**
 * ⚠️ EL MARGEN VA EN LOS DOS SENTIDOS Y AHORA SOLO ENSANCHA LA BÚSQUEDA.
 *
 * `created_at` llega sin zona horaria (`"2026-09-02T16:11:12"`). Medido, es UTC
 * —al crear un payout a las 16:11:11 UTC nuestras, él dijo 16:11:12— y por eso
 * `fechaDePayout()` le pega la `Z` antes de leerlo. Pero eso es una medida de un
 * día, no un contrato: si mañana la API empezara a servir hora local de
 * Montevideo, sus fechas se leerían tres horas en el pasado.
 *
 * Antes ese desfase era peligroso, porque la fecha DECIDÍA la identidad («todo
 * payout posterior al reclamo que cuadre en importe es el nuestro»). Ahora la
 * identidad la da la marca de `description` y la fecha solo dice hasta dónde
 * paginar hacia atrás, así que equivocarse solo cuesta páginas de más. Seis
 * horas cubren con holgura cualquier huso de América y no cuesta nada.
 */
const MARGEN_RELOJ_MS = 6 * 60 * 60 * 1000;

/**
 * Páginas de `GET /v1/payouts` que se pasean como mucho.
 *
 * ⚠️ LA PÁGINA ES DE DIEZ Y NO SE PUEDE CAMBIAR (`TAM_PAGINA_PAYOUTS`): `size`
 * y `page_size` se ignoran, medido. Así que esto son 400 payouts, que es mucho
 * más de lo que esta plataforma crea entre dos pasadas del job — pero es un
 * TOPE, y agotarlo **no** significa «no está»: significa que no se pudo terminar
 * de mirar. Ver `barrer()`.
 */
const PAGINAS_BARRIDO = 40;

/**
 * 🔑 LA MARCA. Es la pieza que faltaba y la que arregla el diseño entero.
 *
 * `POST /v1/payouts` no tiene clave de idempotencia, pero sí tiene
 * `description`: texto libre de hasta 255 caracteres que viaja de ida y **vuelve
 * intacto** en `GET /v1/payouts` (medido el 2-sep-2026). Ahí va nuestro
 * identificador, y con él el barrido deja de preguntarse «¿este payout se
 * parece al que buscaba?» para preguntar «¿lleva mi marca?».
 *
 * La diferencia no es de precisión, es de clase. Cotejar por importe + país +
 * fecha puede adoptar el payout de OTRO tutor —mismo importe, mismo país, mismo
 * minuto— y adoptarlo significa dar por pagada una orden que no lo está, o al
 * revés. Cotejar por marca no puede: la marca la escribimos nosotros.
 *
 * FORMATO: `EY-<payouts.id>-<intento>`. Los tres trozos hacen falta:
 *   · `EY-` distingue nuestros payouts de los que alguien cree a mano en el
 *     panel de dLocal mientras se prueba.
 *   · `payouts.id` es un UUID, o sea único por orden y estable entre pasadas: un
 *     barrido que reanuda busca la misma marca que escribió el intento anterior.
 *   · `intento` es lo que separa el payout muerto de un rechazo anterior del que
 *     se está creando ahora (ver `difunto` en el puerto). Sin él,
 *     `manage_payout('retry')` reencuentra el cadáver y no reintenta nunca.
 *
 * Caben de sobra: 3 + 36 + 1 + dígitos ≈ 42 de 255. Y no lleva PII: ni nombre,
 * ni documento, ni cuenta. Un admin puede pegarla en el buscador del panel de
 * dLocal y encontrar la orden.
 *
 * ⚠️ dLocal NO deduplica por `description`. Medido: dos POST con la misma marca
 * crean DOS payouts. La marca sirve para RECONOCER un pago, no para impedirlo —
 * lo que impide el segundo pago es el candado de la base de datos y el hecho de
 * que una orden reanudada nunca crea nada.
 */
export function marcaDe(payoutId: string, intento: number): string {
  return `EY-${payoutId}-${intento}`;
}

/** Lo que `description` admite. Medido: 289 → `7000 … exceeds max length 255`. */
const MAX_DESCRIPCION = 255;

/**
 * De los ocho estados de dLocal Go a los seis de `public.payout_status`.
 *
 * ⚠️ `ON_HOLD` **no** se traduce a nuestro `on_hold`, y es el error más caro que
 * se puede cometer en esta función. El nuestro significa «un admin retuvo esta
 * orden» y `manage_payout('release')` lo devuelve a 'scheduled', o sea a la cola
 * de envío: traducirlo así haría que una orden que dLocal ya tiene retenida se
 * volviera a mandar. Su `ON_HOLD` es dinero EN VUELO parado por su compliance,
 * y en vuelo, para nosotros, se llama 'processing'.
 *
 * `null` es «no lo conozco». Un estado nuevo NO se interpreta: la orden se queda
 * donde está y se grita. Adivinar aquí es adivinar si el dinero salió.
 */
function estadoNuestro(estado: string): "paid" | "processing" | "failed" | null {
  switch (estado.toUpperCase()) {
    // El dinero llegó al beneficiario. Es lo ÚNICO que puede escribir 'paid', y
    // con ello disparar el correo NTF-12 «Se pagó tu liquidación».
    case "DELIVERED":
    case "COMPLETED":
      return "paid";
    // Aceptado y en camino. dLocal Go nace PENDING de serie: darlo por pagado
    // aquí es exactamente la mentira que C1 quitó.
    case "PENDING":
    case "PROCESSING":
    case "ON_HOLD":
      return "processing";
    // No hubo pago y no lo va a haber por esta orden.
    case "REJECTED":
    case "FAILED":
    case "CANCELLED":
      return "failed";
    default:
      return null;
  }
}

/** Lo que se guarda en `provider_metadata` y se enseña en el log: sin PII. */
function detalleDe(p: PayoutDlocalGo): string {
  return String(p.status ?? "(sin estado)");
}

/**
 * El identificador del payout, o `null`.
 *
 * ⚠️ SE LLAMA `payout_id`. La versión anterior leía `p.id`, que en esta API no
 * existe ni en la respuesta del POST ni en la del listado, así que
 * `provider_payout_id` se guardaba `undefined` y **todos los pagos perdían su
 * identificador**. Esta función existe para que ese fallo no pueda repetirse en
 * silencio: sin id no se devuelve un desenlace normal, se devuelve duda.
 */
function idDe(p: PayoutDlocalGo): string | null {
  const v = p.payout_id;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** ¿Este payout del proveedor lleva NUESTRA marca? Igualdad exacta, sin matices. */
function esNuestro(p: PayoutDlocalGo, marca: string): boolean {
  return typeof p.description === "string" && p.description === marca;
}

type Barrido =
  /** Existe, lleva nuestra marca, y es el que manda. */
  | { tipo: "encontrado"; payout: PayoutDlocalGo }
  /**
   * 🔑 SE RECORRIÓ TODA LA VENTANA QUE PODÍA CONTENERLO Y NO ESTÁ. Es la única
   * prueba de ausencia que existe sin clave de idempotencia.
   */
  | { tipo: "ausente" }
  /** No se puede afirmar ni lo uno ni lo otro. Nadie toca la fila. */
  | { tipo: "ilegible"; motivo: string }
  /** No hay credencial. No es de esta orden: es de todas. */
  | { tipo: "credencial"; motivo: string };

/**
 * Busca nuestra orden entre los payouts del proveedor. Es el sustituto entero de
 * la clave de idempotencia que la API no tiene.
 *
 * ── 🔴 QUEDARSE SIN PÁGINAS NO ES «NO EXISTE» ──────────────────────────────
 * La versión anterior paraba al ver una página incompleta y devolvía «ausente»,
 * que es justo la respuesta que autoriza a pagar otra vez. Con la página fija en
 * diez y sin filtros, «me cansé de paginar» y «no está» se ven idénticos si solo
 * se mira el array. Se distinguen con lo que la envoltura sí dice:
 *
 *   · `page + 1 >= totalPages` → se acabó el listado. Ausencia DEMOSTRADA.
 *   · el último de la página es anterior a `claimedAt - MARGEN` → como el orden
 *     es del más reciente al más antiguo, nuestro payout ya habría salido.
 *     Ausencia DEMOSTRADA.
 *   · se agotó `PAGINAS_BARRIDO` sin ninguna de las dos → **duda**, no ausencia.
 *
 * ── POR QUÉ PAGINAR HACIA DELANTE ES SEGURO AUNQUE ENTREN PAYOUTS NUEVOS ────
 * El listado va del más reciente al más antiguo, así que lo que entra mientras
 * paseamos entra por DELANTE y empuja al resto hacia páginas POSTERIORES — que
 * son las que quedan por mirar. Un elemento puede repetirse entre páginas, nunca
 * saltárselas. Si algún día el orden cambiara, esta garantía se cae y este
 * comentario es lo primero que hay que releer.
 */
async function barrer(input: PayoutInput, marca: string): Promise<Barrido> {
  const coincidencias: PayoutDlocalGo[] = [];
  const reclamo = Date.parse(input.claimedAt);
  // Sin reclamo legible no hay frontera temporal: solo vale agotar `totalPages`.
  const frontera = Number.isFinite(reclamo) ? reclamo - MARGEN_RELOJ_MS : -Infinity;
  let agotado = false;
  let vistas = 0;

  for (let pagina = 0; pagina < PAGINAS_BARRIDO; pagina++) {
    let hoja;
    try {
      hoja = await listarPayouts(pagina);
    } catch (e) {
      if (e instanceof DlocalGoError && esCredencialInvalida(e)) {
        return { tipo: "credencial", motivo: e.message };
      }
      // Que el listado falle NO es que no exista: es que no se sabe. Distinguir
      // las dos cosas es la diferencia entre «vuelve a la cola» y «pagar otra vez».
      return {
        tipo: "ilegible",
        motivo: `no se pudo listar los payouts del proveedor: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    if (hoja === null) {
      return {
        tipo: "ilegible",
        motivo: "la respuesta de GET /v1/payouts no trae la envoltura {data, totalPages, …}",
      };
    }

    vistas += hoja.data.length;
    for (const p of hoja.data) if (esNuestro(p, marca)) coincidencias.push(p);

    // ¿Se acabó el listado? `totalPages` a -1 es «no venía»: no se puede usar
    // para afirmar nada, y desde luego no para dar por agotada la búsqueda.
    if (hoja.totalPages >= 0 && pagina + 1 >= hoja.totalPages) {
      agotado = true;
      break;
    }
    // ¿Ya se pasó de largo la frontera del reclamo? El último de la página es el
    // más antiguo de la página.
    const ultimo = hoja.data[hoja.data.length - 1];
    if (ultimo) {
      const f = fechaDePayout(ultimo);
      if (Number.isFinite(f) && f < frontera) {
        agotado = true;
        break;
      }
    }
    // Una página vacía sin `totalPages` legible no demuestra nada, pero seguir
    // pidiendo páginas vacías tampoco aporta: se sale y se cuenta como duda.
    if (hoja.data.length === 0) break;
  }

  if (coincidencias.length > 0) return elegir(coincidencias, input, marca);

  if (!agotado) {
    return {
      tipo: "ilegible",
      motivo:
        `se miraron ${PAGINAS_BARRIDO} páginas (${vistas} payouts) sin llegar al final del ` +
        `listado ni cruzar la fecha del reclamo: no se puede afirmar que el payout no exista`,
    };
  }
  return { tipo: "ausente" };
}

/**
 * Varios payouts pueden llevar la MISMA marca, y esto no es teórico: pasó a la
 * primera. Un `POST` con un documento inválido devolvió `400 Invalid param:
 * beneficiary.document.id` **y creó el payout igual**, en `FAILED`, con nuestra
 * `description` dentro; el reintento correcto creó el segundo. Dos filas, una
 * marca.
 *
 * Así que la marca identifica la ORDEN, no un payout, y hay que elegir:
 *
 *   · Exactamente uno vivo (o de estado desconocido) → ese manda. Los muertos
 *     que le acompañen son intentos que no pagaron.
 *   · Ninguno vivo y alguno muerto → la orden no pagó. Manda el más reciente,
 *     que es el que hay que anotar para conciliar.
 *   · 🔴 Más de uno vivo → **hay dos pagos en vuelo con la misma marca**. Eso es
 *     el pago doble ocurriendo, y no lo arregla el código: se para y se grita.
 */
function elegir(coincidencias: PayoutDlocalGo[], input: PayoutInput, marca: string): Barrido {
  // Un importe que no cuadra con una marca que sí cuadra no es una coincidencia
  // desafortunada: la marca es única por orden e intento. Es no saber qué pasa.
  const descuadrado = coincidencias.find(
    (p) =>
      typeof p.amount === "number" &&
      aUnidadMenor(p.amount, input.currency) !== input.amountMinor,
  );
  if (descuadrado) {
    return {
      tipo: "ilegible",
      motivo:
        `el payout ${idDe(descuadrado) ?? "(sin id)"} lleva la marca ${marca} pero su importe ` +
        `(${descuadrado.amount} ${descuadrado.currency_to_pay ?? "?"}) no es el de la orden`,
    };
  }

  const vivos = coincidencias.filter((p) => estadoNuestro(String(p.status)) !== "failed");
  if (vivos.length === 1) return { tipo: "encontrado", payout: vivos[0]! };
  if (vivos.length > 1) {
    return {
      tipo: "ilegible",
      motivo:
        `🔴 HAY ${vivos.length} PAYOUTS VIVOS CON LA MARCA ${marca} ` +
        `(${vivos.map((p) => `${idDe(p) ?? "?"}:${p.status}`).join(", ")}): ` +
        `puede ser un pago doble. No se toca nada.`,
    };
  }
  // Todos muertos. El listado va del más reciente al más antiguo, así que el
  // primero de la lista es el último intento.
  return { tipo: "encontrado", payout: coincidencias[0]! };
}

/**
 * El desenlace de un payout que ya tiene identidad, sea recién creado, adoptado
 * por el barrido o consultado por su id.
 *
 * `adoptado` viaja como bandera y no como estado aparte porque lo que decide qué
 * se escribe en la fila es SIEMPRE el estado del proveedor: adoptar es cómo se
 * llegó al payout, no en qué quedó. Un `adoptado: true` en el log no es un
 * incidente, es el mecanismo antidoble funcionando.
 */
function desenlace(p: PayoutDlocalGo, adoptado: boolean): PayoutResult {
  const id = idDe(p);
  const detalle = detalleDe(p);
  if (!id) {
    // Sin identificador no hay nada que anotar, y anotar `undefined` es como se
    // pierde un pago. Duda, que es lo que la pasada siguiente sabe barrer.
    return {
      estado: "en-duda",
      mensaje: `el proveedor devolvió un payout sin payout_id (estado ${detalle})`,
      causa: null,
    };
  }
  const nuestro = estadoNuestro(String(p.status));
  if (nuestro === "paid") {
    return { estado: "pagado", payoutId: id, detalle, adoptado };
  }
  if (nuestro === "failed") {
    // Tiene identidad Y el proveedor dice que no hubo pago. Es permanente, pero
    // con el id anotado: sin él, un `manage_payout('retry')` no podría distinguir
    // esta orden muerta de la que se cree después.
    return {
      estado: "rechazado",
      mensaje: `el proveedor dejó el payout en ${detalle}`,
      causa: null,
      payoutId: id,
      detalle,
    };
  }
  // 'processing' y lo desconocido comparten salida a propósito: los dos
  // significan «no consta que el dinero se haya movido», que es lo único que
  // decide si se puede escribir 'paid'. Los distingue el `detalle`, que va al
  // log y a `provider_metadata`.
  return { estado: "enviado", payoutId: id, detalle, adoptado };
}

export const dlocalProvider: PspProvider = {
  /** El mismo valor que `payments.provider` y `payment_routing_rules`. */
  key: "dlocal",
  opensRemoteCheckout: true,

  /**
   * Las DOS claves, y no hay una pregunta distinta para el cobro y para el
   * reembolso: viajan juntas en la misma cabecera `Authorization`. Por eso
   * `missingChargeConfig` y `canRefund` miran lo mismo, al revés que en Stripe
   * —donde la publicable solo la necesita el navegador—. Ojo: eso NO significa
   * que se puedan fusionar en el puerto; significa que este proveedor contesta
   * lo mismo a las dos preguntas.
   */
  missingChargeConfig() {
    return isDlocalGoConfigured()
      ? null
      : "dLocal Go no configurado (faltan DLOCALGO_API_KEY / DLOCALGO_SECRET_KEY)";
  },

  canRefund: isDlocalGoConfigured,

  /** Las mismas dos claves. Ver `missingChargeConfig`. */
  missingPayoutConfig() {
    return isDlocalGoConfigured()
      ? null
      : "dLocal Go no configurado (faltan DLOCALGO_API_KEY / DLOCALGO_SECRET_KEY)";
  },

  /**
   * 🔴 C2 · PAGAR. Lee el bloque de arriba antes de tocar una línea de aquí.
   *
   * CUATRO caminos, y solo UNO de ellos crea algo. Los distinguen dos datos de
   * la fila —si ya tenía identidad y si ya se había reclamado— y ninguno de los
   * dos se deduce: los aporta el job.
   *
   *   · id + `reanudar` → SEGUIR. La orden está en vuelo; se pregunta por su id
   *     y se traduce el estado. Es el camino que acaba disparando NTF-12.
   *   · id sin `reanudar` → REINTENTO DE ADMIN. La fila volvió a 'scheduled'
   *     desde 'failed' por `manage_payout('retry')` arrastrando el id del payout
   *     rechazado. **No se crea nada todavía**: se pregunta por ese id, y si de
   *     verdad está muerto se devuelve `difunto` para que el job lo archive,
   *     suba el intento y lo devuelva a la cola limpio. Si resulta que NO está
   *     muerto, mejor haberlo preguntado: se sigue como si nada.
   *   · `reanudar` sin id → BARRER por la marca. La fila se reclamó y no se sabe
   *     en qué quedó. **Aquí no se crea nada bajo ningún concepto.**
   *   · ninguno de los dos → CREAR, con la marca dentro.
   *
   * ⚠️ LOS DATOS BANCARIOS NO SALEN DE ESTA FUNCIÓN. Se piden a
   * `payout_beneficiary(payout_id)`, viajan al cuerpo del POST y ahí mueren: no
   * se devuelven, no se registran, no entran en ningún mensaje de error.
   *
   * ⚠️ Y YA NO SE CONSERVA EL DOCUMENTO FISCAL. La versión anterior lo guardaba
   * en memoria para cotejar el barrido; con la marca de `description` no hace
   * falta —y además el listado no devuelve `beneficiary_document`, así que aquel
   * cotejo nunca pudo usarlo—. Un dato de menos que puede acabar en un log.
   */
  async payout(input: PayoutInput): Promise<PayoutResult> {
    const marca = marcaDe(input.payoutId, input.intento);

    // ── Camino 1 · la orden ya tiene identidad en el proveedor ───────────────
    if (input.providerPayoutId) {
      let visto: PayoutDlocalGo;
      try {
        visto = await recuperarPayout(input.providerPayoutId);
      } catch (e) {
        if (!(e instanceof DlocalGoError)) throw e;
        if (esCredencialInvalida(e)) {
          // Consultar no crea. La orden puede volver a la cola si venía de ella.
          return { estado: "sin-credencial", mensaje: e.message, pudoCrear: false };
        }
        // Da igual si es 404, 429 o 500: preguntar por un payout no mueve
        // dinero, así que reintentar es gratis y siempre es mejor que inventar
        // un desenlace. La fila se queda en 'processing' con su id anotado.
        //
        // ⚠️ Y AQUÍ CAE TAMBIÉN LA CREDENCIAL ROTA, porque este endpoint no la
        // reconoce: medido, `GET /v1/payouts/{id}` con un secreto inválido
        // devuelve `500 internal_server_error` mientras el listado devuelve
        // `403 Invalid Credentials`. Está bien que caiga aquí —transitorio no
        // toca la fila y no manda dinero— y NO se debe "arreglar" tratando los
        // 500 como credencial: eso pararía el lote con cualquier caída suya. El
        // barrido, que sí ve el 403, para el lote por su cuenta.
        return {
          estado: "transitorio",
          mensaje: `no se pudo consultar el payout ${input.providerPayoutId}: ${e.message}`,
          causa: e,
        };
      }

      const salida = desenlace(visto, false);

      // ── Camino 1b · REINTENTO DE ADMIN ────────────────────────────────────
      //
      // 🔴 ESTE ES EL BUCLE QUE `manage_payout('retry')` NO PODÍA ROMPER. El
      // botón devolvía la fila de 'failed' a 'scheduled' pero le dejaba dentro el
      // `provider_payout_id` del payout rechazado; el adaptador preguntaba por
      // ese id, el proveedor repetía que estaba muerto, y la orden volvía a
      // 'failed'. El admin pulsaba, el job lo deshacía, y nadie veía por qué.
      //
      // Un rechazo de un payout que YA no está en vuelo (la fila venía de
      // 'scheduled') es exactamente eso: un cadáver que hay que archivar para
      // poder empezar de cero con una marca nueva.
      if (!input.reanudar && salida.estado === "rechazado" && salida.payoutId) {
        return {
          estado: "difunto",
          payoutId: salida.payoutId,
          detalle: salida.detalle ?? "",
          mensaje:
            `el payout ${salida.payoutId} que arrastraba esta orden está ` +
            `${salida.detalle ?? "muerto"} en el proveedor: se archiva y la orden ` +
            `vuelve a la cola con un intento nuevo`,
        };
      }
      return salida;
    }

    // ── El beneficiario, que es lo único que la BD no le da al job ───────────
    //
    // ⚠️ ESTA RPC ES LA ÚNICA PUERTA A UN NÚMERO DE CUENTA ENTERO (B1). Además
    // de devolverlo, comprueba que la orden es ejecutable ('scheduled' o
    // 'processing'), que tiene país, que el país de los datos coincide con el de
    // la orden y que los datos siguen validando HOY — no solo el día que el
    // tutor los guardó. Todo eso vive allí a propósito: un `select` plano no
    // puede hacerlo, y por eso `service_role` no tiene `select` sobre la tabla.
    //
    // ⚠️ REANUDANDO NI SE PIDE. Antes se pedía siempre y se seguía adelante si
    // fallaba, para no perder el barrido; ahora el barrido no necesita ni un
    // dato del beneficiario —le basta la marca— así que pedirlo sería sacar un
    // número de cuenta de la base de datos para no usarlo.
    let b: Record<string, string | null> | null = null;
    if (!input.reanudar) {
      const admin = createAdminClient();
      const { data: beneficiario, error: eBenef } = await admin.rpc("payout_beneficiary", {
        p_payout_id: input.payoutId,
      });

      if (eBenef) {
        // ⚠️ REGLA DE ORO 9 DISFRAZADA DE PROBLEMA DEL TUTOR. Un 42501 aquí no es
        // «este tutor no tiene datos»: es que a `service_role` le falta el
        // `execute` y **ninguna** orden se va a pagar. Confundirlo con `sin-datos`
        // dejaría la cola entera parada con un mensaje que culpa a los tutores.
        const esPermiso =
          (eBenef as { code?: string }).code === "42501" ||
          /permission denied|not allowed/i.test(eBenef.message);
        if (esPermiso) {
          return {
            estado: "transitorio",
            mensaje: `payout_beneficiary no es ejecutable por service_role (regla de oro 9): ${eBenef.message}`,
            causa: eBenef,
          };
        }
        // El resto son las excepciones que la propia función levanta, y todas
        // significan lo mismo: esta orden no se puede construir tal como está.
        // Ninguna lleva el número de cuenta dentro (`20260901170000`).
        return { estado: "sin-datos", mensaje: eBenef.message };
      }
      b = (beneficiario as Record<string, string | null> | null) ?? null;
      if (!b) {
        return { estado: "sin-datos", mensaje: "payout_beneficiary no devolvió beneficiario" };
      }
    }

    // ── Camino 2 · barrer una orden reclamada sin identificador ─────────────
    //
    // ⚠️ VA ANTES DEL FRENO DEL TIPO DE CAMBIO, Y NO ES CASUAL. Una orden
    // reclamada ya salió (o pudo salir) bajo las condiciones de ENTONCES;
    // volver a evaluarlas hoy no cambia lo que el proveedor tenga guardado. Lo
    // único que importa aquí es averiguar si existe, y eso se pregunta siempre.
    if (input.reanudar) {
      const b1 = await barrer(input, marca);
      if (b1.tipo === "encontrado") return desenlace(b1.payout, true);
      if (b1.tipo === "credencial") {
        return { estado: "sin-credencial", mensaje: b1.motivo, pudoCrear: false };
      }
      if (b1.tipo === "ilegible") return { estado: "en-duda", mensaje: b1.motivo, causa: null };
      return {
        estado: "sin-rastro",
        mensaje: `ningún payout del proveedor lleva la marca ${marca}: vuelve a la cola`,
      };
    }

    // A partir de aquí `b` no puede ser null: el único camino que lo permite
    // (reanudar) ya ha vuelto. Se comprueba en vez de afirmarlo, porque lo que
    // hay debajo es la única llamada de este archivo que mueve dinero.
    if (!b) {
      return { estado: "sin-datos", mensaje: "payout_beneficiary no devolvió beneficiario" };
    }
    const monedaDestino = (b.currency_to_pay ?? "").toUpperCase();

    // ── 🔴 EL FRENO DE MANO DEL TIPO DE CAMBIO ──────────────────────────────
    //
    // `payouts.currency` es USD y `currency_to_pay` es la moneda del país del
    // tutor: coinciden en UNO de los ocho países (Ecuador) y en ninguno más.
    // Para los otros siete hay que convertir, y ahí hay una decisión de producto
    // SIN RESPONDER: dLocal convierte a una tasa entre 4,6 % y 4,7 % peor que la
    // que publica su propio `/v1/currency-exchanges`, y se puede fijar lo que
    // RECIBE el tutor (`currency_to_pay` con importe local) o lo que PAGAMOS
    // nosotros (USD), nunca las dos. Quién come ese spread —la plataforma o el
    // tutor— no lo puede decidir este archivo.
    //
    // Así que no se decide: no se manda. La orden se queda en la cola, el job la
    // cuenta y el workflow lo grita. Un payout que sale con una regla inventada
    // es peor que uno que no sale, porque el error se descubre cuando el tutor
    // mira su banco.
    if (monedaDestino !== input.currency.toUpperCase()) {
      return {
        estado: "sin-decidir",
        mensaje:
          `este payout exige convertir ${input.currency.toUpperCase()} → ${monedaDestino} ` +
          `(${input.payeeCountry}) y nadie ha decidido quién asume el spread de dLocal ` +
          `(~4,6-4,7 % peor que su propio /v1/currency-exchanges). No se manda a propósito.`,
      };
    }

    // ── Camino 3 · crear ────────────────────────────────────────────────────
    //
    // 🔴 SIN MARCA NO SE CREA. Si la marca no cupiera en `description`, el payout
    // saldría y **nadie podría volver a reconocerlo**: sería un pago sin llave,
    // que es peor que un pago que no sale. No puede pasar (un UUID más el prefijo
    // son ~42 de 255) y precisamente por eso comprobarlo es gratis.
    if (marca.length > MAX_DESCRIPCION) {
      return {
        estado: "rechazado",
        mensaje: `la marca de idempotencia no cabe en description (${marca.length} > ${MAX_DESCRIPCION})`,
        causa: null,
      };
    }

    // El cuerpo es EXACTAMENTE lo que devolvió la base de datos, más el importe y
    // la marca. Los campos opcionales que vengan a null se OMITEN en vez de
    // mandarse vacíos.
    //
    // ⚠️ Y OJO CON OMITIRLOS DE MÁS: medido el 2-sep-2026, un payout a Ecuador
    // **sin** `bank_account_type` o **sin** `bank_branch` devuelve
    // `400 {"code":5000,"message":"must not be null"}` — un mensaje que no dice
    // qué campo falta— aunque `payout_country_rules` diga para EC
    // `requires_branch = false` y `account_types = '{}'`. Esa fila es de B1 y no
    // se toca desde aquí, pero el desajuste está medido y hay que resolverlo
    // antes de que Ecuador —el único país que hoy no necesita decidir el tipo de
    // cambio— pueda cobrar.
    const cuerpo: NuevoPayoutDlocalGo = {
      transfer_amount: aUnidadMayor(input.amountMinor, monedaDestino),
      transfer_country: b.transfer_country ?? input.payeeCountry,
      currency_to_pay: monedaDestino,
      flow_type: b.flow_type ?? "B2C",
      // Obligatorio y de lista cerrada. Lo fija la BD, no este archivo: un
      // código inválido no es un 400 limpio, es una retención por compliance.
      purpose: b.purpose ?? "OTHER_SERVICES",
      beneficiary_first_name: b.beneficiary_first_name ?? "",
      beneficiary_last_name: b.beneficiary_last_name ?? "",
      beneficiary_document: b.beneficiary_document ?? "",
      beneficiary_document_type: b.beneficiary_document_type ?? "",
      bank_code: b.bank_code ?? "",
      bank_account: b.bank_account ?? "",
      ...(b.bank_account_type ? { bank_account_type: b.bank_account_type } : {}),
      ...(b.bank_branch ? { bank_branch: b.bank_branch } : {}),
      // 🔑 La llave de todo el mecanismo. No lleva PII.
      description: marca,
    };

    try {
      return desenlace(await crearPayout(cuerpo), false);
    } catch (e) {
      if (!(e instanceof DlocalGoError)) {
        // Un fallo de red antes de leer la respuesta es el peor caso posible: la
        // petición pudo llegar. NO se decide nada aquí; se barre.
        const b2 = await barrer(input, marca);
        if (b2.tipo === "encontrado") return desenlace(b2.payout, true);
        // ⚠️ `pudoCrear: true` — el POST ya había salido cuando se cayó la red, y
        // el barrido que iba a comprobarlo se quedó sin credencial. La duda sigue.
        if (b2.tipo === "credencial") {
          return { estado: "sin-credencial", mensaje: b2.motivo, pudoCrear: true };
        }
        if (b2.tipo === "ausente") {
          return {
            estado: "transitorio",
            mensaje: `falló la llamada y el barrido confirma que no se creó nada: ${
              e instanceof Error ? e.message : String(e)
            }`,
            causa: e,
          };
        }
        return {
          estado: "en-duda",
          mensaje: `falló la llamada y el barrido no pudo comprobar si se creó el payout: ${b2.motivo}`,
          causa: e,
        };
      }

      // ── 🔴 UN 401/403 NO ES UNA ORDEN DUDOSA ────────────────────────────────
      //
      // Se corta aquí, ANTES del barrido, por dos motivos: el barrido usa la
      // misma credencial y fallaría igual, y sobre todo porque la respuesta
      // correcta no es sobre esta orden sino sobre el job. Antes esto caía en el
      // saco de «no sé si se creó el payout» y marcaba EN DUDA la cola entera —y
      // una fila en duda solo sale si la mira una persona—: diez incidencias
      // falsas por pasada, por una variable de entorno.
      //
      // Y no puede haber creado nada: sin credencial válida la petición no llega
      // a ejecutarse.
      if (esCredencialInvalida(e)) {
        return { estado: "sin-credencial", mensaje: e.message, pudoCrear: false };
      }

      // 🔴 AQUÍ ESTÁ LA TRAMPA QUE ORDENA TODO EL DISEÑO: **un 400 puede haber
      // creado el payout igual**, y está medido, no supuesto (ver la cabecera de
      // este bloque: `86661116764330`). Así que un código de error NO autoriza a
      // dar por hecho que no pasó nada: se barre SIEMPRE — y también cuando el
      // mensaje dice «insufficient funds» o «daily limit», donde la doc promete
      // que la comprobación va antes de crear nada. «Probablemente» no es el
      // criterio con el que se decide si se puede volver a mandar un pago.
      const b3 = await barrer(input, marca);
      if (b3.tipo === "encontrado") {
        // El error mintió: el payout existe. Se adopta y NO se vuelve a mandar.
        return desenlace(b3.payout, true);
      }
      // ⚠️ `pudoCrear: true` — un 400 puede haber creado el payout (medido), y el
      // barrido que iba a comprobarlo no pudo autenticarse. Nadie toca la fila.
      if (b3.tipo === "credencial") {
        return { estado: "sin-credencial", mensaje: b3.motivo, pudoCrear: true };
      }
      if (b3.tipo === "ilegible") {
        return {
          estado: "en-duda",
          mensaje: `${e.message} — y el barrido no pudo comprobar si se creó el payout: ${b3.motivo}`,
          causa: e,
        };
      }

      // Barrido limpio: no se creó nada. Ahora —y solo ahora— se puede clasificar
      // el error por lo que es.
      //
      // ⚠️ SALDO INSUFICIENTE NO ES UN FALLO PERMANENTE. Es dinero que se debe y
      // que saldrá en cuanto se fondee el balance de dLocal Go; marcarlo 'failed'
      // sería enterrarlo detrás de un `retry` que nadie va a pulsar. Y no dice
      // nada del payload: la comprobación de fondos corre ANTES que la de campos,
      // así que esta orden sigue SIN estar validada por el proveedor.
      if (esSaldoInsuficiente(e)) {
        return {
          estado: "sin-fondos",
          mensaje: `${e.message} (la comprobación de fondos va antes que la de campos: esto no valida el resto del payload)`,
        };
      }

      // ⚠️ EL TOPE DIARIO TAMPOCO. Llega como 400 —o sea que el criterio por HTTP
      // lo daría por permanente— y se arregla solo a medianoche. Marcarlo
      // 'failed' mandaría al tutor la incidencia NTF-16 por una cuota de la
      // cuenta. Medido: `7000 Daily payout limit exceeded. Limit is 5000.00 USD`.
      if (esLimiteDiario(e)) {
        return { estado: "transitorio", mensaje: e.message, causa: e };
      }

      // El resto, con el mismo criterio que los reembolsos: 429/5xx es el
      // momento; 4xx es la orden.
      return e.esTransitorio
        ? { estado: "transitorio", mensaje: e.message, causa: e }
        : { estado: "rechazado", mensaje: e.message, causa: e };
    }
  },

  /**
   * DESAJUSTE 4 · LA EMULACIÓN DE LA IDEMPOTENCIA. Léelo entero antes de tocar.
   *
   * El contrato del puerto dice: «llamar dos veces con la misma
   * `idempotencyKey` da el mismo cobro». Stripe lo cumple solo. dLocal no tiene
   * con qué, así que se cumple aquí, en tres pasos:
   *
   *   1. ¿Hay ya un `DP-…` sellado para este sujeto? Se le pregunta a la API por
   *      él. Si sigue `PENDING`, se devuelve SU `redirect_url` y no se crea
   *      nada. Este es el camino normal de una recarga.
   *   2. Si no hay, se crea con `order_id` = la clave (determinista por
   *      reserva) y se sella ANTES de devolver nada.
   *   3. Si aun así vuelve `5009 Order id is duplicated` —dos pestañas creando
   *      a la vez, o un sello que no llegó a escribirse— se relee el sello y se
   *      reintenta el paso 1. Si tampoco entonces hay nada que reabrir, se falla
   *      en vez de inventarse un `order_id` distinto: crear un segundo cobro
   *      para la misma reserva es justo lo que la clave existe para impedir.
   *
   * ⚠️ EL ORDEN «CREAR → SELLAR → DEVOLVER» NO SE PUEDE ALTERAR. Si se
   * devolviera la URL antes de sellar y el proceso muriera en medio, existiría
   * un cobro abierto en dLocal que esta base de datos no conoce: nadie podría
   * reencontrarlo (no se lista, no se busca por `order_id`) y, si alguien lo
   * pagara, el webhook lo trataría como huérfano. El fallo del sellado tumba el
   * checkout a propósito.
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    // ── 1 · ¿ya hay uno abierto? ─────────────────────────────────────────────
    const guardada = await refGuardada(input.ref);
    if (guardada) {
      try {
        const previo = await recuperarPago(guardada);
        if (reutilizable(previo, input)) {
          return { ok: true, modo: "redireccion", redirectUrl: previo.redirect_url!, providerRef: previo.id };
        }
        // Existe pero ya no sirve (pagado, caducado, rechazado). No se abre otro
        // por las buenas: si estaba PAID, el webhook ya lo habrá acreditado y
        // `api/pagos/checkout` ni siquiera llega aquí (la reserva no estaría en
        // `pending_payment`). Llegar aquí con un cobro muerto significa que el
        // sujeto sigue esperando pago, así que sí toca uno nuevo — y como el
        // `order_id` es determinista, chocará y lo resolverá el paso 3.
      } catch (e) {
        // Un `DP-…` que la API no reconoce (cuenta cambiada, datos de sandbox
        // borrados). Se sigue adelante y se abre uno nuevo, que es lo mismo que
        // hace el rescate del Customer perdido en el checkout de Stripe.
        if (!(e instanceof DlocalGoError) || e.status !== 404) throw e;
      }
    }

    // ── 2 · crear ────────────────────────────────────────────────────────────
    // ⚠️ EL IMPORTE ES LA SUMA DE LAS LÍNEAS Y DE NADA MÁS (regla de oro 2).
    // dLocal Go NO acepta desglose por líneas —no hay `line_items`—, así que el
    // detalle que Stripe conserva en su panel aquí se pierde y solo viaja el
    // total. Es una pérdida real de conciliación y no tiene arreglo por API: lo
    // que la sostiene es que el desglose sigue en `payments`, una fila por
    // mentoría, que es donde manda.
    const totalMenor = input.lineas.reduce((s, l) => s + l.amountMinor, 0);

    const cuerpo = {
      amount: aUnidadMayor(totalMenor, input.currency),
      currency: input.currency.toUpperCase(),
      // Opcional de verdad: sin él su checkout le pregunta el país a la persona.
      ...(input.payerCountry ? { country: input.payerCountry.toUpperCase() } : {}),
      order_id: ordenExterna(input),
      description: descripcionDe(input),
      // Las dos URL de vuelta. `success_url` es a donde va tras pagar;
      // `back_url` es el «volver» de su checkout. Se apuntan las dos al mismo
      // sitio: nuestra pantalla de confirmación ya sabe distinguir pagado de no
      // pagado leyendo la reserva, y mandar el «volver» a otro lado dejaría al
      // alumno en una pantalla que no explica qué pasó con su dinero.
      success_url: input.returnUrl,
      back_url: input.returnUrl,
      notification_url: input.notificationUrl,
      ...caducidadRelativa(input.expiresAt),
    };

    let pago: PagoDlocalGo;
    try {
      pago = await dlocalgoFetch<PagoDlocalGo>("POST", "/v1/payments", cuerpo);
    } catch (e) {
      // ── 3 · el choque ──────────────────────────────────────────────────────
      if (e instanceof DlocalGoError && e.esOrderIdDuplicado) {
        const reintento = await refGuardada(input.ref);
        if (reintento) {
          const previo = await recuperarPago(reintento);
          // Mismo cerrojo que arriba, y aquí importa igual: que el `order_id`
          // haya chocado no prueba que el cobro de dLocal sea de este sujeto y
          // por este importe — solo que la clave se repite.
          if (reutilizable(previo, input)) {
            return { ok: true, modo: "redireccion", redirectUrl: previo.redirect_url!, providerRef: previo.id };
          }
        }
        // Hay un cobro con nuestro `order_id` en dLocal y no sabemos cuál es.
        // NO se inventa una clave nueva: se dice la verdad y que lo mire alguien.
        return {
          ok: false,
          error:
            "dLocal Go dice que este cobro ya existe y no se puede recuperar (order_id duplicado sin referencia guardada)",
        };
      }
      if (e instanceof DlocalGoError) return { ok: false, error: e.message };
      throw e;
    }

    if (!pago.redirect_url) {
      return { ok: false, error: "dLocal Go no devolvió redirect_url" };
    }

    // SELLAR ANTES DE DEVOLVER. Si esto lanza, el checkout falla — a propósito.
    await sellarRef(input.ref, pago.id);

    return { ok: true, modo: "redireccion", redirectUrl: pago.redirect_url, providerRef: pago.id };
  },

  /**
   * `POST /v1/refunds` — `{payment_id, amount?}`. Sin `amount` devuelve el cobro
   * entero, igual que en Stripe y que es lo que pide X-02.
   *
   * ⚠️ SIN CLAVE DE IDEMPOTENCIA, y esto es peor que en el cobro. En el cobro el
   * `order_id` al menos CHOCA; aquí no hay nada: dos llamadas iguales crean dos
   * reembolsos. Lo que impide el doble pago es, entonces, enteramente nuestro:
   *   · X-01 mira `refund_requests.status` y solo procesa `pending`;
   *   · X-02 mira `late_payment_refunds.provider_payment_id`, que es UNIQUE,
   *     ANTES de llamar.
   * Las dos comprobaciones ya existían como cinturón; con dLocal pasan a ser el
   * único tirante. Quien quite una de las dos «porque la clave de idempotencia
   * ya lo cubre» estará quitando lo único que lo cubre.
   *
   * ⚠️ `metadata` NO VIAJA. dLocal Go no tiene campo de metadatos en el
   * reembolso, así que los ids de conciliación que Stripe sí guarda en su panel
   * aquí se quedan solo en nuestro log y en `refund_requests`. No se falsifica
   * metiéndolos en otro campo.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    let reembolso: ReembolsoDlocalGo;
    try {
      reembolso = await dlocalgoFetch<ReembolsoDlocalGo>("POST", "/v1/refunds", {
        payment_id: input.chargeRef,
        ...(input.amountMinor === undefined
          ? {}
          : { amount: aUnidadMayor(input.amountMinor, input.currency ?? "USD") }),
      });
    } catch (e) {
      if (!(e instanceof DlocalGoError)) throw e;
      // dLocal no publica un código para «ya reembolsado». El más cercano es un
      // 400 cuyo mensaje lo dice; se reconoce por texto y NO se asume: si el
      // mensaje cambia, esto cae a `rechazado`, que es el lado seguro (para la
      // cola de X-01 significa «que lo mire una persona», no «reintentar
      // eternamente»).
      if (/already\s+refunded|refunded\s+already/i.test(e.message)) {
        return { estado: "ya-reembolsado" };
      }
      return e.esTransitorio
        ? { estado: "transitorio", mensaje: e.message, causa: e }
        : { estado: "rechazado", mensaje: e.message, causa: e };
    }

    const moneda = (reembolso.currency ?? input.currency ?? "USD").toUpperCase();
    const comun = {
      refundId: reembolso.id,
      amountMinor:
        reembolso.amount !== undefined
          ? aUnidadMenor(reembolso.amount, moneda)
          : (input.amountMinor ?? 0),
      currency: moneda,
    };

    // ⚠️ `PENDING` NO ES «REEMBOLSADO», Y ESTA ES LA DIFERENCIA MÁS CARA CON
    // STRIPE. Stripe crea el reembolso ya en `succeeded` salvo excepción; dLocal
    // Go devuelve `PENDING` de serie y el dinero se mueve después. Darlo por
    // bueno marcaría la fila como `refunded` con el dinero todavía dentro, que
    // es exactamente la mentira que X-01 existe para no repetir (la BD daba por
    // devuelto lo que nadie había devuelto).
    //
    // Se clasifica como `no-completado`, que la cola trata como `failed` +
    // revisión humana. Es DEMASIADO severo para un `PENDING` sano y se sabe: lo
    // correcto sería un estado «en vuelo» que la cola reconsulte, y ese estado
    // no existe hoy en el puerto. Se deja severo a propósito —un reembolso que
    // se revisa de más es recuperable; uno dado por hecho, no— y se anota como
    // lo que es: una ficha pendiente, no un descuido.
    if (reembolso.status === "REJECTED" || reembolso.status === "CANCELLED") {
      return { estado: "no-completado", detalle: reembolso.status, ...comun };
    }
    if (reembolso.status === "PENDING") {
      return { estado: "no-completado", detalle: "PENDING", ...comun };
    }
    return { estado: "reembolsado", ...comun };
  },

  /**
   * DESAJUSTE 2 · EL WEBHOOK.
   *
   * ⚠️ ESTO NO VERIFICA UN EVENTO: VERIFICA UN PING. El cuerpo entero es
   * `{"payment_id":"DP-283"}` — sin tipo, sin id de evento, sin hora, sin
   * estado. Así que aquí solo se puede hacer una cosa honesta: comprobar la
   * firma y decir «me hablan de este cobro». QUÉ le ha pasado al cobro lo tiene
   * que preguntar el Route Handler a la API, porque el cuerpo no lo dice y
   * creérselo sería dejar que el remitente elija el estado.
   *
   * Por eso `verifyWebhook` devuelve `kind: 'otro'` y `ref: null` SIEMPRE, y el
   * evento útil lo compone `eventoDePago()` con la respuesta de
   * `GET /v1/payments/{id}`. Es una firma distinta a la del puerto en espíritu
   * —el de Stripe sale de aquí ya completo— pero la interfaz se respeta: el
   * puerto es síncrono y no puede llamar a la API.
   *
   * ⚠️ LA FIRMA NO CADUCA (no lleva timestamp ni nonce): una notificación
   * capturada se puede reproducir mañana y cuadrará. Lo que hace que eso sea
   * inofensivo es precisamente releer el estado y que `confirm_payment` sea
   * idempotente. No se puede "optimizar" fiándose del cuerpo.
   */
  verifyWebhook(input: WebhookInput): WebhookVerificacion {
    const esperada = firmarNotificacion(input.rawBody);
    if (!esperada) {
      return {
        ok: false,
        motivo: "sin-secreto",
        error: "dLocal Go no configurado (faltan DLOCALGO_API_KEY / DLOCALGO_SECRET_KEY)",
      };
    }
    const recibida = firmaDeCabecera(input.signature);
    if (!recibida) {
      return { ok: false, motivo: "sin-firma", error: "sin firma" };
    }
    if (!firmaCuadra(esperada, recibida)) {
      return { ok: false, motivo: "firma-invalida", error: "firma inválida" };
    }

    // ⚠️ Se parsea DESPUÉS de verificar, y sobre la misma cadena que se firmó.
    let paymentId: string | null = null;
    try {
      const cuerpo = JSON.parse(input.rawBody) as { payment_id?: string };
      paymentId = cuerpo.payment_id ?? null;
    } catch {
      paymentId = null;
    }
    if (!paymentId) {
      return { ok: false, motivo: "firma-invalida", error: "cuerpo sin payment_id" };
    }

    return {
      ok: true,
      evento: {
        // Provisional: identifica el PING, no el hecho. `eventoDePago()` lo
        // reemplaza por `dlocalgo:<id>:<status>` en cuanto se sabe el estado.
        id: `dlocalgo:${paymentId}:sin-consultar`,
        rawType: "notification",
        kind: "otro",
        ref: null,
        chargeRef: paymentId,
        objectRef: paymentId,
        amountMinor: null,
        currency: null,
      },
    };
  },
};

/**
 * La segunda mitad del webhook: preguntar a la API qué le pasó al cobro y
 * traducirlo al vocabulario del puerto.
 *
 * Vive aquí y no en el Route Handler porque es lo único que habla la lengua de
 * dLocal (nombres de estado incluidos), que es el invariante de todo el puerto:
 * para saber qué hay que reimplementar en un tercer PSP basta con abrir dos
 * ficheros.
 */
export async function eventoDePago(paymentId: string): Promise<{
  pago: PagoDlocalGo;
  evento: import("./port").WebhookEvent;
}> {
  const pago = await recuperarPago(paymentId);

  /**
   * ⚠️ LA CLAVE DE DEDUPLICACIÓN, y el porqué de que lleve el estado dentro.
   *
   * `confirm_payment` descarta un `event_id` ya visto para esa reserva. Con
   * Stripe cada entrega trae su `evt_…`. Aquí, si la clave fuese solo el
   * `payment_id`, la PRIMERA notificación del cobro ganaría y todas las demás
   * se descartarían para siempre — incluida la que de verdad importa. Con el
   * estado dentro, una reentrega del mismo hecho se descarta (que es lo que
   * queremos) y una transición real pasa.
   */
  const id = `dlocalgo:${pago.id}:${pago.status}`;

  /**
   * De su taxonomía a la nuestra.
   *
   * ⚠️ `REJECTED` NO ES `cobro-fallido`, y es el mismo criterio que hace que
   * `payment_intent.payment_failed` no lo sea en Stripe: una tarjeta rechazada
   * deja el cobro vivo y la persona reintenta con otra —el propio objeto lo
   * dice, `rejected_reason` se describe como «the reason for the LAST payment
   * attempt's rejection» y convive con `status: PENDING`—. Tratarlo como fallo
   * terminal le liberaría el horario a alguien que está a punto de pagar.
   *
   * Los terminales son `EXPIRED` y `CANCELLED`.
   */
  const kind: import("./port").WebhookEvent["kind"] =
    pago.status === "PAID"
      ? "cobro-confirmado"
      : pago.status === "EXPIRED" || pago.status === "CANCELLED"
        ? "cobro-fallido"
        : pago.status === "PENDING"
          ? "cobro-en-curso"
          : "otro";

  return {
    pago,
    evento: {
      id,
      rawType: `payment.${pago.status.toLowerCase()}`,
      kind,
      ref: refDeOrdenExterna(pago.order_id),
      // En dLocal el cargo y el cobro son EL MISMO objeto: no hay un `pi_`
      // aparte de la Session. `DP-…` es lo que se sella y lo que se reembolsa.
      chargeRef: pago.id,
      objectRef: pago.id,
      amountMinor: aUnidadMenor(pago.amount, pago.currency),
      currency: pago.currency?.toUpperCase() ?? null,
    },
  };
}
