import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { BAJA_TIENE_DESTINO } from "./email-sistema.ts";
import { PLANTILLAS_IDS, renderEmail } from "./email-templates.ts";
import { rutaFor, toNotice } from "./notifications.ts";

/**
 * Comprobación mínima del renderizado de los correos. Sin framework: se corre
 * con `npm run check:email` y falla con un exit code si algo se rompe.
 *
 * Existe porque el job trata "no se pudo renderizar" y "el proveedor rechazó"
 * como el mismo fallo permanente, así que desde fuera no se distinguen. Sin
 * esto, una plantilla mal escrita se vería exactamente igual que una API key
 * caducada — y el aviso se marcaría `failed` sin que nadie supiera por qué.
 */
// El dominio oficial desde el 10-sep. Era `ensenameya.vercel.app`, que a partir
// de hoy es un 308 hacia aquí: un fixture que apunta al host viejo sigue pasando
// las aserciones —solo comprueban que la base aparezca— pero deja escrito en el
// contrato un dominio que ya no es el de la app.
const BASE = "https://ensenameya.com";

/**
 * El «hoy» de las plantillas que miran el reloj: `booking_reminder_24h` dice
 * «hoy» o «mañana» según cuánto falte, y `payout_account_changed` fecha el
 * cambio. Se fija, porque una comprobación cuyo resultado depende del día en que
 * se corre no comprueba nada — y la que falla un martes de madrugada se arregla
 * volviendo a lanzarla, que es la peor forma de arreglar algo.
 */
const AHORA = new Date("2026-09-14T09:00:00Z");

// ── EL CONTRATO ────────────────────────────────────────────────────────────
//
// Toda plantilla que alguna migración encole TIENE que existir en `PLANTILLAS`.
// Si no existe, `renderEmail` devuelve null, el job lo trata como fallo
// PERMANENTE (`mark_notification(p_ok = false)`) y el correo se pierde para
// siempre — sin error en el build, sin error en el typecheck, sin nada que
// mirar. Es el fallo que este fichero existe para cazar.
//
// ⚠️ La lista NO se escribe a mano. Hasta el Doc 33 eran catorce nombres
// copiados aquí, y una lista copiada se queda atrás el día que alguien añade un
// `enqueue_notification` y no se acuerda de venir — que es exactamente el
// descuido que esto tenía que impedir. Ahora se LEE de las migraciones, que son
// la fuente de verdad del esquema (regla de oro 5): lo que se encola es lo que
// hay escrito ahí, y esto lo comprueba contra el mapa de plantillas.
const MIGRACIONES = "supabase/migrations";

/** Los `template` de cada `enqueue_notification(...)` de las migraciones. */
function plantillasQueSeEncolan(): Set<string> {
  const encontradas = new Set<string>();
  // `enqueue_notification(<destinatario>, '<tipo>', '<canal>', '<plantilla>'`.
  // El destinatario puede ser una expresión con comas dentro (`coalesce(a, b)`),
  // así que se ancla en los TRES literales seguidos y no se cuentan argumentos.
  const patron = /'(?:NTF-[\w-]+|[A-Z][\w-]*)'\s*,\s*'(?:email|in_app)'\s*,\s*'([a-z_]+)'/g;
  for (const f of readdirSync(MIGRACIONES)) {
    if (!f.endsWith(".sql")) continue;
    const sql = readFileSync(`${MIGRACIONES}/${f}`, "utf8");
    for (const m of sql.matchAll(patron)) encontradas.add(m[1]);
  }
  return encontradas;
}

const encoladas = plantillasQueSeEncolan();

// Si esto sale vacío, el patrón dejó de casar y el contrato estaría pasando en
// verde sin comprobar nada. Un check que no comprueba es peor que ninguno.
assert.ok(
  encoladas.size >= 14,
  `solo se encontraron ${encoladas.size} plantillas en las migraciones: el patrón dejó de casar`,
);

for (const template of encoladas) {
  assert.ok(
    PLANTILLAS_IDS.includes(template),
    `alguna migración encola "${template}" y esa plantilla NO existe en email-templates.ts: ese correo se marcaría failed para siempre`,
  );
}

// Y al revés, las que este código sabe pintar tienen que pintarse de verdad.
//
// Tres grupos, porque no todas cumplen lo mismo y meterlas en un bucle único
// obligaría a aflojar la aserción para todas:
//   · las de Auth las manda Supabase y sus enlaces son literales Go
//     (`{{ .ConfirmationURL }}`), no URL de este sitio;
//   · las internas (`contact_internal`, `admin_alert`) no van a una persona y
//     por eso no saludan por el nombre;
//   · el resto sí.
const AUTH = ["auth_confirm_signup", "auth_reset_password", "auth_change_email"];
const INTERNAS = ["contact_internal", "admin_alert"];

for (const template of PLANTILLAS_IDS) {
  const r = renderEmail({ template, payload: {}, nombre: "Lucía Fernández", baseUrl: BASE });
  assert.ok(r, `la plantilla "${template}" no renderiza`);
  assert.ok(r.subject.length > 0, `"${template}" sin asunto`);

  if (AUTH.includes(template)) {
    // El literal tiene que llegar INTACTO y sin escapar: si `{`, `.` o los
    // espacios se hubieran tocado, GoTrue no sustituiría nada y el correo
    // saldría con un botón que no lleva a ninguna parte.
    assert.ok(
      r.html.includes("{{ .ConfirmationURL }}"),
      `"${template}" perdió el literal de Supabase`,
    );
    // Y no basta con que esté: tiene que estar SIN ESCAPAR y como href. El día
    // que alguien meta ese enlace por `esc()` o por un constructor de URL —cosa
    // razonable, porque en las otras 31 el enlace sí sale de nuestro sitio—,
    // GoTrue no sustituye nada y el botón de confirmar la cuenta lleva a
    // `%7B%7B`. El correo renderiza perfecto y no deja entrar a nadie.
    assert.ok(
      r.html.includes(`href="{{ .ConfirmationURL }}"`),
      `"${template}" ya no usa el literal Go como href`,
    );
    assert.ok(
      !/&#123;|&lbrace;|%7B/i.test(r.html),
      `"${template}" escapó el literal Go: Supabase ya no puede interpolarlo`,
    );
    // Y sobrevive a la rama de texto plano, que reescribe los enlaces a
    // «texto: url» con su propia expresión regular.
    assert.ok(
      r.text.includes("{{ .ConfirmationURL }}"),
      `"${template}" perdió el enlace al derivar el texto plano`,
    );
    continue;
  }

  assert.ok(r.html.includes(BASE), `"${template}" sin enlace a la app`);
  if (!INTERNAS.includes(template)) {
    assert.ok(r.text.includes("Lucía"), `"${template}" no saluda por el nombre`);
  }
  // `rutaFor` la comparte la campana (US-1203): una plantilla sin destino se
  // pinta como aviso in-app que no se puede clicar.
  assert.ok(rutaFor(template, {}).startsWith("/"), `"${template}" sin destino`);
}

// Una plantilla que no existe devuelve null, que es lo que el job lee para
// marcar fallo permanente en vez de reintentar cada 5 minutos para siempre.
assert.equal(
  renderEmail({ template: "no_existe", payload: {}, nombre: "", baseUrl: BASE }),
  null,
);

// ── LO TRANSVERSAL · lo que el rediseño puede romper en las 34 a la vez ─────
//
// Estas cuatro cosas no son de ninguna plantilla en concreto: son acuerdos del
// sistema visual (Doc 33 §3) que se cumplen o no se cumplen en bloque. Por eso
// se comprueban en bucle y no con un caso de ejemplo: un acuerdo que solo se
// verifica en una plantilla deja de ser un acuerdo en cuanto alguien escribe la
// siguiente.

/**
 * ⚠️ EL CONTEXTO PUEDE NO VENIR, Y NO ES UN CASO RARO. Lo resuelve
 * `pending_email_notifications` en la misma consulta que saca el lote, así que
 * llega vacío en dos situaciones normales: una fila encolada antes de que esa
 * vista existiera, y una reserva que ya no está. Cada bloque que depende de un
 * dato devuelve `null` y `render` lo filtra — pero basta con que UNA plantilla
 * interpole el dato a pelo para que el correo diga «Cuándo: undefined» y se
 * envíe igual, porque nada de eso es un error.
 */
for (const template of PLANTILLAS_IDS) {
  const r = renderEmail({
    template,
    payload: {},
    nombre: "Lucía Fernández",
    baseUrl: BASE,
    contexto: {},
    ahora: AHORA,
  })!;
  assert.ok(
    !/\bundefined\b|\bNaN\b|\bnull\b/.test(`${r.subject} ${r.text}`),
    `"${template}" coló un undefined/null/NaN con el contexto vacío`,
  );
}

/**
 * ⚠️ EL BOTÓN ES IDÉNTICO EN LAS 34, y no por estética: blanco sobre el naranja
 * de marca (#fe6a00) da **2,89:1** y falla el AA de WCAG incluso para texto
 * grande, que pide 3:1; la tinta (#14141a) sobre ese mismo naranja da 6,36:1.
 * Un solo color de acción son cero decisiones de contraste por plantilla, y
 * esta comprobación es lo que impide que la número 35 estrene la suya — que es
 * como se pierden estos acuerdos: de uno en uno y con buena intención.
 */
const SIN_BOTON: string[] = [];
for (const template of PLANTILLAS_IDS) {
  const r = renderEmail({ template, payload: {}, nombre: "Lucía", baseUrl: BASE, contexto: {}, ahora: AHORA })!;
  if (!r.html.includes(`bgcolor="#fe6a00"`)) {
    SIN_BOTON.push(template);
    continue;
  }
  assert.ok(
    /bgcolor="#fe6a00"[\s\S]{0,400}?color:#14141a/.test(r.html),
    `"${template}" no pone tinta sobre el naranja del botón (el blanco da 2,89:1 y falla el AA)`,
  );
  assert.ok(
    !/bgcolor="#fe6a00"[\s\S]{0,400}?color:#(?:fff|ffffff)\b/i.test(r.html),
    `"${template}" puso texto blanco sobre el naranja del botón`,
  );
}
// `contact_ack` es el único correo sin llamada a la acción, y a propósito: dice
// «lo recibimos, te contestamos» y no hay nada que la persona tenga que hacer.
// Se comprueba como lista EXACTA y no como «alguno puede no tenerlo» para que el
// día que otra plantilla pierda el botón en una refactorización se entere
// alguien: un correo sin botón no falla, solo no lleva a ninguna parte.
assert.equal(SIN_BOTON.join(","), "contact_ack", "cambió el conjunto de correos sin botón");

/**
 * ⚠️ MIENTRAS `BAJA_TIENE_DESTINO` SEA false, NINGÚN CORREO PUEDE ENSEÑAR EL
 * ENLACE DE BAJA. Su destino (`/account#avisos`) no existe: S-49 sigue sin
 * construirse y es una decisión de PRODUCTO abierta, no algo que se invente aquí
 * (regla de oro 8). El pliego lo deja escrito —«mandarlos con un enlace que no
 * lleva a ningún sitio es peor que no ponerlo»— y en su lugar va la cabecera
 * `List-Unsubscribe`, que no necesita pantalla. El día que S-49 exista, esa
 * constante pasa a true y este bucle se apaga solo.
 */
if (!BAJA_TIENE_DESTINO) {
  for (const template of PLANTILLAS_IDS) {
    const r = renderEmail({ template, payload: {}, nombre: "Lucía", baseUrl: BASE, ahora: AHORA })!;
    assert.ok(
      !r.html.includes("/account#avisos"),
      `"${template}" enseña el enlace de baja y esa pantalla todavía no existe`,
    );
  }
}

// Y los SIETE no esenciales siguen marcándose como tales: es de `baja` de donde
// `email.ts` saca a quién le pone `List-Unsubscribe`. Lista exacta y no un
// recuento, porque «siete» no dice nada si son otros siete.
assert.equal(
  PLANTILLAS_IDS.filter(
    (t) => renderEmail({ template: t, payload: {}, nombre: "", baseUrl: BASE, ahora: AHORA })!.baja,
  )
    .sort()
    .join(","),
  [
    "booking_reminder_24h",
    "materials_ready",
    "new_message",
    "review_received_tutor",
    "review_request",
    "welcome_student",
    "welcome_tutor",
  ].join(","),
  "cambió qué correos son no esenciales (los que llevan List-Unsubscribe)",
);

/**
 * El texto plano no puede llevar etiquetas. No se escribe a mano: se DERIVA del
 * HTML (`aTextoPlano`), y esa derivación es una lista de reemplazos, no un
 * parser. Una etiqueta nueva que no esté en la lista —o un `&lt;` que
 * `desescapar` devuelve a `<` DESPUÉS de haber quitado las etiquetas— sale tal
 * cual a la bandeja de quien lee en modo texto, que es también quien lee en un
 * reloj. La excepción es el cuerpo de `admin_message`, que es libre a propósito
 * y se comprueba más abajo con su `<b>` dentro.
 */
for (const template of PLANTILLAS_IDS) {
  const r = renderEmail({ template, payload: {}, nombre: "Lucía", baseUrl: BASE, contexto: {}, ahora: AHORA })!;
  const etiquetas = r.text.match(/<[a-zA-Z][^>]*>/g);
  assert.ok(!etiquetas, `"${template}" coló HTML en el texto plano: ${etiquetas?.slice(0, 3).join(" ")}`);
}

// El importe se formatea cuando viene, y no rompe cuando no.
const conImporte = renderEmail({
  template: "payment_receipt",
  payload: { amount: 2500, currency: "USD" },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(conImporte!.text.includes("25"), "no formateó el importe");

const sinImporte = renderEmail({
  template: "payment_receipt",
  payload: {},
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(!sinImporte!.text.includes("undefined"), "coló un undefined sin importe");

/**
 * Doc 33 · LA FICHA DE LA CLASE. Es lo que el pliego cambió respecto de la regla
 * vieja de «correos deliberadamente escuetos», y solo en la familia de compra y
 * reserva: un «tu clase está confirmada» que no dice cuál ni cuándo obliga a
 * entrar en la app para enterarse de lo único que importa. Si el contexto trae
 * el dato, el dato sale.
 */
const CLASE = {
  clase: "Cálculo I",
  tutor: "Marta Ruiz",
  inicio: "2026-09-15T18:00:00Z",
  duracion_min: 60,
};
const conFicha = renderEmail({
  template: "booking_confirmed_student",
  payload: { booking_id: "bk-7" },
  nombre: "Ana",
  baseUrl: BASE,
  contexto: CLASE,
  timezone: "America/Bogota",
  ahora: AHORA,
})!;
assert.ok(conFicha.html.includes("Cálculo I"), "la ficha de la clase no lleva el título");
assert.ok(conFicha.html.includes("Marta Ruiz"), "la ficha de la clase no dice con quién");
assert.ok(conFicha.html.includes("60 minutos"), "la ficha de la clase no dice cuánto dura");

/**
 * 🔴 RN-35 · LA HORA SE PINTA EN EL HUSO DEL DESTINATARIO, Y ESTA ES LA ÚNICA
 * ASERCIÓN QUE CAZA QUE SE IGNORE. El mismo `inicio` —18:00 UTC— son las 13:00
 * en Bogotá y las 20:00 en Madrid. Un `timezone` que se queda por el camino no
 * rompe nada: el correo sale, renderiza perfecto y dice una hora impecablemente
 * formateada a la que no se presenta nadie. Eso no es un error, es un no-show, y
 * el tutor cobra igual mientras el alumno cree que le fallaron.
 */
const madrid = renderEmail({
  template: "booking_confirmed_student",
  payload: { booking_id: "bk-7" },
  nombre: "Ana",
  baseUrl: BASE,
  contexto: CLASE,
  timezone: "Europe/Madrid",
  ahora: AHORA,
})!;
assert.ok(conFicha.html.includes("13:00"), "RN-35: la hora de Bogotá no es la de Bogotá");
assert.ok(madrid.html.includes("20:00"), "RN-35: la hora de Madrid no es la de Madrid");
assert.ok(!conFicha.html.includes("20:00"), "RN-35: el correo de Bogotá pinta la hora de Madrid");
assert.notEqual(
  conFicha.html,
  madrid.html,
  "RN-35: el mismo instante renderiza idéntico en dos husos, o sea que el huso se ignora",
);

// El enlace sale del payload que dejan los triggers, no de la plantilla.
const aReserva = renderEmail({
  template: "cancellation",
  payload: { booking_id: "abc-123" },
  nombre: "",
  baseUrl: BASE,
});
assert.ok(aReserva!.text.includes("/reservas/abc-123"), "el enlace no apunta a la reserva");

// Con reserva manda la reserva. Es lo que hace que los avisos de dinero
// (NTF-04/10/15, con `booking_id` en el payload desde `20260831120000`) lleven
// al detalle del pago y no a «Métodos de pago», que son las tarjetas guardadas.
assert.equal(
  rutaFor("refund_processed", { payment_id: "pay-1", booking_id: "bk-2" }),
  "/reservas/bk-2",
);

// ── EL AVISO DEL TUTOR NO PUEDE LLEVAR A LA PANTALLA DEL ALUMNO ────────────
//
// 🔴 EL FALLO, que estaba vivo hasta el Doc 33: `rutaFor` miraba el payload
// antes que la plantilla, así que TODA fila con `booking_id` caía en
// `/reservas/{id}` — SCR-AL03, la pantalla del ALUMNO, con sus acciones (pagar,
// cancelar, reseñar). `booking_new_tutor` es NTF-07 y va al TUTOR: salía así
// desde siempre. Y la RLS no lo tapaba, porque el tutor SÍ puede leer esa fila:
// la pantalla no daba un 403, renderizaba entera y equivocada.
assert.equal(rutaFor("booking_new_tutor", { booking_id: "bk-7" }), "/tutor/reservas/bk-7");
assert.equal(rutaFor("booking_expiring_tutor", { booking_id: "bk-7" }), "/tutor/reservas/bk-7");
assert.equal(
  toNotice({
    id: "n-7", type: "NTF-07", template: "booking_new_tutor",
    payload: { booking_id: "bk-7" },
    created_at: "2026-09-11T10:00:00Z", read_at: null,
  }).href,
  "/tutor/reservas/bk-7",
  "la campana sigue mandando al tutor a la pantalla del alumno",
);
// Y el correo va al mismo sitio. ⚠️ Se aserta la AUSENCIA de la ruta del alumno
// y no solo la presencia de la del tutor, porque `.../tutor/reservas/bk-7`
// contiene `/reservas/bk-7`: un `includes` a secas pasaría en verde con el
// enlace equivocado dentro.
const alTutor = renderEmail({
  template: "booking_new_tutor",
  payload: { booking_id: "bk-7" },
  nombre: "Camilo",
  baseUrl: BASE,
})!;
assert.ok(alTutor.text.includes(`${BASE}/tutor/reservas/bk-7`), "NTF-07 no lleva a la reserva del tutor");
assert.ok(!alTutor.text.includes(`${BASE}/reservas/bk-7`), "NTF-07 lleva al tutor a la pantalla del alumno");

// El alumno, en cambio, se queda exactamente donde estaba.
assert.equal(rutaFor("booking_confirmed_student", { booking_id: "bk-7" }), "/reservas/bk-7");

// NTF-08 · a la SALA, que es lo que hay que abrir cuando la clase empieza; el
// `session_id` lo trae el payload. Sin él se cae a la reserva, que es un destino
// honesto —la sala se alcanza desde ahí— en vez de una URL inventada.
assert.equal(rutaFor("session_starting", { booking_id: "bk-7", session_id: "se-3" }), "/room/se-3");
assert.equal(rutaFor("session_starting", { booking_id: "bk-7" }), "/reservas/bk-7");

/**
 * ⚠️ NTF-11 ES EL ÚNICO CASO QUE ESTE MECANISMO NO RESUELVE, y esta aserción lo
 * deja escrito en vez de aparentar que está arreglado: `avisar_clases_de_manana`
 * encola DOS filas —una al alumno y otra al tutor— con la MISMA plantilla y el
 * MISMO payload, así que decidir por plantilla es imposible por construcción. Se
 * queda en la pantalla del alumno, que es la equivocada la mitad de las veces.
 * Arreglarlo de verdad pide el papel del destinatario en la fila, o dos
 * plantillas: una migración, no un `if` en `rutaFor`.
 */
assert.equal(rutaFor("booking_reminder_24h", { booking_id: "bk-7", session_id: "se-3" }), "/reservas/bk-7");

// El resto de destinos propios del Doc 33. Todos se deciden ANTES de mirar el
// payload, que es lo que hace que un `booking_id` dentro no los arrastre a
// `/reservas/{id}`.
// NTF-04b · al pedido con su id, y NUNCA al detalle de una de sus líneas aunque
// el payload traiga un `booking_id`: un recibo de tres clases que abre una sola
// es peor que una lista.
assert.equal(
  rutaFor("order_receipt", { order_id: "or-9" }),
  "/pedidos/or-9/confirmacion",
);
assert.equal(rutaFor("order_receipt", { booking_id: "bk-7" }), "/reservas");
assert.equal(rutaFor("review_received_tutor", { booking_id: "bk-7" }), "/tutor");
assert.equal(rutaFor("payout_account_changed", {}), "/tutor/payouts");
assert.equal(rutaFor("welcome_student", {}), "/app");
assert.equal(rutaFor("welcome_tutor", {}), "/tutor");
assert.equal(rutaFor("account_deletion_requested", {}), "/account");
assert.equal(rutaFor("account_deletion_done", {}), "/account");
assert.equal(rutaFor("admin_alert", {}), "/admin/alertas");

// Y la campana dice algo para cada plantilla que alguna migración encola: sin
// su línea en `TEXT`, el aviso in-app sale como «Novedad en tu cuenta (NTF-24)»,
// que es texto que no informa de nada y ocupa el sitio del que sí lo haría.
for (const template of encoladas) {
  const t = toNotice({
    id: "n-x", type: "NTF-XX", template,
    payload: {}, created_at: "2026-09-11T10:00:00Z", read_at: null,
  }).text;
  assert.ok(!t.startsWith("Novedad en tu cuenta"), `"${template}" no tiene texto de campana en notifications.ts`);
}

// ── NTF-23 · UN CORREO DE PAYPAL A QUIEN COBRA POR TRANSFERENCIA ────────────
//
// 🔴 EL FALLO QUE ESTE BLOQUE EXISTE PARA CAZAR, y que estuvo vivo el 7-sep-2026:
// `avisar_payouts_sin_reclamar` barre TODA orden en `processing` sin mirar el
// riel —a propósito, lo dice su migración— y la plantilla estaba escrita entera
// para PayPal. En cuanto Wise empezó a pagar (`20260907120000`), un tutor
// colombiano con cuenta bancaria recibía «no ha llegado a tu cuenta de PayPal» y
// «comprueba el correo que nos diste», por un dinero que en su riel nadie tiene
// que reclamar.
//
// Es exactamente la clase de fallo que no rompe nada: renderiza, se envía, y el
// único que se entera es el tutor que lee una instrucción imposible.
const wiseSinLlegar = renderEmail({
  template: "payout_unclaimed",
  payload: { payout_id: "po-1", amount: 15000, currency: "COP", dias: 7, provider: "wise" },
  nombre: "Camilo",
  baseUrl: BASE,
});
assert.ok(
  !/paypal/i.test(wiseSinLlegar!.text),
  "NTF-23 le habla de PayPal a un tutor que cobra por Wise",
);
assert.ok(
  !/paypal/i.test(wiseSinLlegar!.subject),
  "el asunto de NTF-23 nombra PayPal en un riel bancario",
);
// Y tampoco le manda a arreglar sus datos ni a reclamar nada: en una
// transferencia no hay nada que reclamar y los datos que dio ya sirvieron para
// emitir la orden.
assert.ok(
  !/reclam/i.test(wiseSinLlegar!.text),
  "NTF-23 le pide reclamar un pago a quien cobra por transferencia",
);

// El riel manual y el reintento del admin dejan `payouts.provider` a null, así
// que un payload sin proveedor tiene que caer al cuerpo neutro — nunca al de
// PayPal, que es el que dice cosas que solo valen allí.
const sinRiel = renderEmail({
  template: "payout_unclaimed",
  payload: { payout_id: "po-2", amount: 15000, currency: "COP", dias: 7 },
  nombre: "Camilo",
  baseUrl: BASE,
});
assert.ok(!/paypal/i.test(sinRiel!.text), "NTF-23 sin proveedor cayó en el cuerpo de PayPal");

// …y con PayPal SÍ se dice lo de PayPal: la rama neutra no puede haberse comido
// el único aviso que salva un pago antes de que se devuelva a los 30 días.
const paypalSinReclamar = renderEmail({
  template: "payout_unclaimed",
  payload: { payout_id: "po-3", amount: 15000, currency: "USD", dias: 7, provider: "paypal" },
  nombre: "Camilo",
  baseUrl: BASE,
});
assert.ok(
  paypalSinReclamar!.text.includes("PayPal"),
  "NTF-23 dejó de contar lo de PayPal en el riel de PayPal",
);
assert.ok(
  paypalSinReclamar!.text.includes("30 días"),
  "NTF-23 ya no avisa del plazo en que PayPal devuelve el pago",
);

// ⚠️ Y LA PRIMERA FRASE NO PUEDE DECIR QUE SE ENVIÓ EL DINERO. En Wise la
// transferencia se crea y se fondea después: al día 7 está creada y el dinero
// NO ha salido, así que «Enviamos tu liquidación» —lo que decía este correo
// hasta el 7-sep— era falso justo en el riel que lo destapó.
for (const r of [wiseSinLlegar!, sinRiel!, paypalSinReclamar!]) {
  assert.ok(!/^Hola[^]*Enviamos tu liquidación/.test(r.text), "NTF-23 afirma un envío que puede no haber ocurrido");
}

// La campana pinta la MISMA fila que manda el correo —sin mirar el canal, ver
// el comentario de `new_message` en `notifications.ts`—, así que el texto corto
// arrastraba el mismo fallo. Se comprueba aquí porque el `rutaFor` de ese módulo
// ya vive en este fichero.
const campanaWise = toNotice({
  id: "n-1", type: "NTF-23", template: "payout_unclaimed",
  payload: { payout_id: "po-1", provider: "wise" },
  created_at: "2026-09-07T10:00:00Z", read_at: null,
});
assert.ok(!/reclam/i.test(campanaWise.text), "la campana le pide reclamar a un tutor de Wise");
assert.equal(campanaWise.href, "/tutor/payouts", "el aviso de payout no lleva a los cobros");
const campanaPaypal = toNotice({
  id: "n-2", type: "NTF-23", template: "payout_unclaimed",
  payload: { payout_id: "po-3", provider: "paypal" },
  created_at: "2026-09-07T10:00:00Z", read_at: null,
});
assert.ok(/reclames/.test(campanaPaypal.text), "la campana perdió el aviso de PayPal");

// NTF-21 · el correo del mensaje nuevo lleva al HILO, no al panel.
const aHilo = renderEmail({
  template: "new_message",
  payload: { conversation_id: "conv-9" },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(aHilo!.text.includes("/chat/conv-9"), "el aviso de mensaje no lleva al hilo");

// …y NO lleva el contenido del mensaje ni quién lo escribió, pase lo que pase
// en el payload. Es la razón de ser de la plantilla: un correo se reenvía.
const fisgon = renderEmail({
  template: "new_message",
  payload: { conversation_id: "conv-9", body: "mi IBAN es ES12", from: "Marcos" },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(!fisgon!.text.includes("IBAN"), "el correo coló el cuerpo del mensaje");
assert.ok(!fisgon!.text.includes("Marcos"), "el correo coló el nombre del remitente");

// ⚠️ Y TAMPOCO POR EL CONTEXTO, que es la vía NUEVA del Doc 33 y por donde entra
// hoy todo lo demás: la clase, el tutor, la cita de la reseña, el mensaje del
// formulario de contacto. Enganchar `contacto.mensaje` o `tutor` a una plantilla
// es lo correcto en casi todas, y por eso mismo es tan fácil hacerlo aquí — que
// es justo lo que `20260826160000` decidió que no pasara: el chat se purga a los
// 30 días DENTRO de la app y no se purga nunca en una bandeja ajena.
const fisgonCtx = renderEmail({
  template: "new_message",
  payload: { conversation_id: "conv-9" },
  nombre: "Ana",
  baseUrl: BASE,
  contexto: {
    tutor: "Marcos Díaz",
    alumno: "Marcos Díaz",
    contacto: { nombre: "Marcos Díaz", correo: "marcos@ejemplo.com", mensaje: "mi IBAN es ES12" },
  },
});
assert.ok(!fisgonCtx!.text.includes("IBAN"), "el contexto coló el cuerpo del mensaje en el correo del chat");
assert.ok(!fisgonCtx!.text.includes("Marcos"), "el contexto coló el nombre del remitente en el correo del chat");
assert.ok(!fisgonCtx!.html.includes("marcos@ejemplo.com"), "el contexto coló el correo del remitente");

// Sin nombre, saluda igual: `full_name` puede venir vacío de profiles.
//
// ⚠️ Ya no es `startsWith`: con el layout del Doc 33 el texto abre con la marca,
// el epígrafe y el titular, y el saludo va después. Lo que se comprueba sigue
// siendo lo mismo —que el saludo existe y no queda cojo—, pero el «Hola ,» con
// el hueco del nombre delante de la coma es justo el defecto que se busca, así
// que se aserta también su ausencia.
const anonimo = renderEmail({ template: "review_request", payload: {}, nombre: "", baseUrl: BASE });
assert.ok(anonimo!.text.includes("Hola,"), "el saludo sin nombre queda roto");
assert.ok(!anonimo!.text.includes("Hola ,"), "el saludo sin nombre dejó el hueco del nombre");
// Y con nombre, saluda por el nombre de PILA y no por el apellido entero.
const conNombre = renderEmail({
  template: "review_request",
  payload: {},
  nombre: "Lucía Fernández",
  baseUrl: BASE,
});
assert.ok(conNombre!.text.includes("Hola Lucía,"), "el saludo no usa el nombre de pila");

// NTF-22 · el mensaje del admin SÍ viaja en el correo (es su razón de ser), y
// llega escapado. Es la única plantilla con cuerpo libre del proyecto.
const delAdmin = renderEmail({
  template: "admin_message",
  payload: { mensaje: "Hola:\nrevisa <b>esto</b> & responde." },
  nombre: "Ana",
  baseUrl: BASE,
});
assert.ok(delAdmin!.text.includes("revisa <b>esto</b>"), "el texto plano no lleva el mensaje");
assert.ok(delAdmin!.html.includes("&lt;b&gt;esto&lt;/b&gt;"), "el HTML no escapó el mensaje");
assert.ok(!delAdmin!.html.includes("<b>esto</b>"), "coló HTML del admin sin escapar");
assert.ok(delAdmin!.html.includes("&amp;"), "no escapó el ampersand");
assert.ok(delAdmin!.html.includes("<br>"), "los saltos de línea no llegaron al HTML");
assert.ok(delAdmin!.text.includes("/account"), "el enlace del admin no va a /account");

// El nombre también sale de datos del usuario y también se escapa.
const nombreRaro = renderEmail({
  template: "review_request",
  payload: {},
  nombre: "<script>x</script> Pérez",
  baseUrl: BASE,
});
assert.ok(!nombreRaro!.html.includes("<script>"), "coló un script por el nombre");

// ── NTF-31..37 · CRÉDITOS Y REGALOS (`20260912110000`) ─────────────────────
//
// Lo que se comprueba aquí no es que rendericen —de eso ya se encarga el bucle
// del contrato, y el «no existe la plantilla» lo caza la lista leída de las
// migraciones—, sino las tres cosas que estos siete correos pueden decir MAL
// sin que nada se rompa: prometer dinero que la plataforma no entrega, enseñar
// una cifra que no significa lo que parece, y hablarle a la persona
// equivocada. Las tres se envían perfectamente formateadas.

const regalos = (template: string, payload: Record<string, unknown>) =>
  renderEmail({ template, payload, nombre: "Lucía Fernández", baseUrl: BASE, ahora: AHORA })!;

/**
 * 🔴 EL TOPE NO ES UN PRECIO. Con `kind = 'mentoria'` el `amount` es un MÁXIMO:
 * `credito_aplicable` rechaza la mentoría que lo supere («esta mentoría supera
 * el tope de tu recompensa») y el sobrante de una más barata es de la
 * plataforma. Un correo que pinte esos 24 dólares como si fueran saldo promete
 * una mentoría gratis que el checkout va a rechazar — que es la peor forma de
 * enterarse, y la misma que `/referidos` evita con la frase de al lado.
 */
const mentoriaGratis = regalos("reward_earned", {
  credit_id: "cr-1", kind: "mentoria", amount: 2400, currency: "USD", destino: "cobro",
});
assert.ok(/de hasta/.test(mentoriaGratis.text), "NTF-31 enseña el tope de la mentoría gratis como si fuera un precio");
assert.ok(
  /no se puede aplicar a una que cueste más/.test(mentoriaGratis.text),
  "NTF-31 promete una mentoría gratis sin decir que tiene tope",
);

/**
 * 🔴 AL TUTOR NO SE LE PIDE NADA. Con `destino = 'payout'` el crédito se suma
 * solo a su liquidación y no caduca (`credits_payout_no_caduca` prohíbe
 * ponerle fecha): mandarlo a `/agendar` a canjear algo es mandarlo a arreglar
 * lo que no está roto, exactamente el mismo fallo que NTF-23 tuvo con Wise.
 */
const premioDeTutor = regalos("reward_earned", {
  credit_id: "cr-1", kind: "saldo", amount: 5000, currency: "USD", destino: "payout",
});
assert.ok(premioDeTutor.text.includes("/tutor/payouts"), "NTF-31 no lleva al tutor a sus cobros");
assert.ok(!premioDeTutor.text.includes("/agendar"), "NTF-31 manda al tutor a canjear algo que se le paga solo");
assert.ok(
  premioDeTutor.text.includes("No tienes que hacer nada"),
  "NTF-31 dejó de decirle al tutor que su recompensa le llega sola",
);

/**
 * 🔴 NTF-33 NO PUEDE DECIR EL IMPORTE, y esta aserción es lo único que lo
 * sostiene. Su payload trae `amount` y `currency` pero NO `kind`, y sin `kind`
 * la cifra significa dos cosas distintas: dinero gastable con `saldo`, un tope
 * que nunca fue de nadie con `mentoria`. Pintarla es mentir en la mitad de los
 * casos. El día que el barrido encole `kind`, esto se cambia a propósito.
 */
const recompensaCaducada = regalos("reward_expired", {
  credit_id: "cr-1", amount: 987654, currency: "USD",
});
assert.ok(
  !recompensaCaducada.text.includes("876"),
  "NTF-33 pinta un importe que sin `kind` no significa lo mismo (tope vs saldo)",
);

/**
 * 🔴 NTF-36 NO SABE A QUIÉN LE HABLA: `avisar_creditos_por_expirar` lo encola a
 * `coalesce(beneficiary_id, purchased_by)`, o sea al destinatario si ya reclamó
 * el regalo y a quien lo pagó mientras no. Mismos payload y plantilla para los
 * dos, así que el cuerpo tiene que decir las dos cosas — igual que
 * `booking_reminder_24h`, y por el mismo motivo estructural.
 */
const regaloCaduca = regalos("gift_expiring", {
  credit_id: "cr-2", product_id: "p-1", expires_at: "2026-09-20T12:00:00Z", dias: 7,
});
assert.ok(/Si el regalo es para ti/.test(regaloCaduca.text), "NTF-36 dejó de hablarle a quien lo recibe");
assert.ok(/Si lo regalaste tú/.test(regaloCaduca.text), "NTF-36 dejó de hablarle a quien lo pagó");

/**
 * 🔴 EL `dias` DEL PAYLOAD ES UN TRAMO, NO UN NÚMERO DE DÍAS, y pintarlo tal
 * cual produce dos frases que se contradicen con la fecha que va tres líneas
 * más abajo. `avisar_creditos_por_expirar` lo calcula con un `case`: 1 si el
 * crédito vence dentro de 24 horas y 7 en cualquier otro punto de la ventana —
 * está ahí para que la clave de idempotencia distinga los dos avisos, no para
 * leerlo. Los dos casos de abajo son reales y se miden en el huso de Bogotá:
 *
 *   · tramo 1 con vencimiento a las 22:17 de HOY  → «caduca mañana», falso.
 *   · tramo 7 con vencimiento dentro de 6 días    → «en 7 días» encima de
 *     «Caduca el 20 de septiembre», que es el tipo de incoherencia que manda a
 *     la gente a soporte a preguntar cuál de las dos vale.
 *
 * Manda `expires_at` leído en el huso del destinatario (RN-35); el tramo solo
 * cubre la fecha ilegible.
 */
const caducaHoyEnBogota = renderEmail({
  template: "gift_expiring",
  payload: { credit_id: "cr-2", product_id: "p-1", expires_at: "2026-09-15T03:17:00Z", dias: 1 },
  nombre: "Lucía Fernández",
  baseUrl: BASE,
  timezone: "America/Bogota",
  ahora: AHORA,
})!;
assert.ok(
  /caduca hoy/i.test(caducaHoyEnBogota.subject),
  "NTF-36 no cuenta el plazo en el huso de quien lee",
);
assert.ok(
  !/mañana/.test(caducaHoyEnBogota.text),
  "NTF-36 dice «mañana» por el tramo del payload cuando en el huso de quien lee vence hoy",
);

const tramoDeSieteQueSonSeis = renderEmail({
  template: "reward_expiring",
  payload: {
    credit_id: "cr-1", kind: "saldo", restante: 1800, currency: "USD",
    expires_at: "2026-09-21T03:17:00Z", dias: 7,
  },
  nombre: "Lucía Fernández",
  baseUrl: BASE,
  timezone: "America/Bogota",
  ahora: AHORA,
})!;
assert.ok(
  tramoDeSieteQueSonSeis.text.includes("20 de septiembre"),
  "NTF-32 no fecha la caducidad en el huso de quien lee",
);
assert.ok(
  !/en 7 días/.test(tramoDeSieteQueSonSeis.text),
  "NTF-32 dice «en 7 días» encima de una fecha que está a seis: el `dias` del payload es un tramo",
);

/**
 * 🔴 NTF-37 SE ENCOLA DOS VECES Y LO ÚNICO QUE DISTINGUE LAS COPIAS ES
 * `amount`: la de quien compró lo lleva, la de quien recibió no —a propósito,
 * lo que alguien pagó por ti no es asunto tuyo—. La rama mira si es un NÚMERO y
 * no si el importe se pudo formatear, porque con la moneda ausente `dinero()`
 * devuelve null y el comprador acabaría leyendo el correo del destinatario.
 */
const compradorCaducado = regalos("gift_expired", {
  credit_id: "cr-2", product_id: "p-1", amount: 4200, currency: "USD",
});
const destinatarioCaducado = regalos("gift_expired", { credit_id: "cr-2", product_id: "p-1" });
assert.ok(compradorCaducado.text.includes("42"), "NTF-37 no le dice al comprador cuánto costó el regalo");
assert.ok(/regalaste/.test(compradorCaducado.text), "NTF-37 no le habla al comprador como tal");
assert.ok(
  !/regalaste|compraste/.test(destinatarioCaducado.text),
  "NTF-37 le habla al destinatario como si hubiera pagado el regalo",
);
const sinMoneda = regalos("gift_expired", { credit_id: "cr-2", product_id: "p-1", amount: 4200 });
assert.ok(
  /regalaste/.test(sinMoneda.text),
  "NTF-37 manda al comprador el correo del destinatario en cuanto falta la moneda",
);

// Y ninguna de las dos promete devolver el dinero: el cargo ya se liquidó y
// `credits` no tiene camino automático de vuelta. Devolverlo es política
// comercial —se hace a mano con `status = 'refunded'`— y comprometerla desde
// una plantilla es comprometer a operaciones sin que operaciones se entere.
assert.ok(
  !/reembols|te lo devolvemos|se te devuelve/i.test(compradorCaducado.text + destinatarioCaducado.text),
  "NTF-37 promete un reembolso que no existe automáticamente",
);

/**
 * 🔴 NTF-35 ES LA ÚNICA PLANTILLA QUE PUEDE LLEGARLE A ALGUIEN SIN CUENTA, y
 * las dos aserciones de abajo son lo que impide que ese caso se pierda.
 *
 * El botón va a `/reservas` —que tiene guarda, y está bien: un enlace de correo
 * es una carga de documento, no una navegación de cliente, así que la regla de
 * oro 13 no aplica y la cadena `/reservas` → `/login?next=` → `/signup?next=`
 * acaba en la misma pantalla, que además reclama el regalo al pintarse—. Pero
 * ese rebote NO puede decirle a nadie lo único que de verdad importa: que el
 * alta tiene que ir con ESA dirección, porque `reclamar_regalos_por_correo` ata
 * por `lower(btrim(email))` y un alta con otro correo deja el regalo huérfano.
 * Por eso la instrucción y el enlace público van escritos en el cuerpo.
 */
const regaloRecibido = regalos("gift_received", {
  credit_id: "cr-2", product_id: "p-1", gift_message: "¡Felicidades! <3 & a por el siguiente",
});
assert.ok(
  regaloRecibido.html.includes(`${BASE}/signup?next=/reservas`),
  "NTF-35 no ofrece una puerta sin guarda a quien todavía no tiene cuenta",
);
assert.ok(
  /misma dirección de correo/i.test(regaloRecibido.text),
  "NTF-35 dejó de decir que hay que registrarse con ESE correo, que es lo que ata el regalo",
);
// La dedicatoria la escribe un desconocido: llega entera y llega escapada.
assert.ok(regaloRecibido.text.includes("¡Felicidades!"), "la dedicatoria del regalo no llegó al correo");
assert.ok(!regaloRecibido.html.includes("<3 &"), "la dedicatoria entró en el HTML sin escapar");

/**
 * ⚠️ EL RECUENTO SE CUENTA, NO SE ESCRIBE. El «31 casos borde» que había aquí
 * fue cierto el día que alguien lo tecleó y dejó de serlo en el correo
 * siguiente; un número a mano en una línea de éxito miente con el mismo aplomo
 * con el que informaba, y encima lo hace en verde. Sale de contar las
 * aserciones del propio fichero — que son las ESCRITAS, no las ejecutadas: los
 * bucles de arriba corren cada una 34 veces.
 */
const aserciones = readFileSync(new URL(import.meta.url), "utf8").match(/\bassert\.\w+\(/g)!.length;

console.log(
  `OK · ${PLANTILLAS_IDS.length} plantillas · ${encoladas.size} encoladas por migraciones` +
    ` · ${aserciones} aserciones`,
);
