// Relativo y no `@/`: así `email-templates.check.ts` puede ejecutarse con node
// a pelo, sin resolver el alias de tsconfig. Mismo estilo que `src/lib/auth/*`.
import { formatMoney } from "./catalog/format.ts";
// El destino del enlace lo decide la campana (US-1203): una sola función para
// el correo y el aviso in-app, y vive allí porque allí no arrastra nada.
import { rutaFor } from "./notifications.ts";

/**
 * Doc 7 · el texto de cada correo transaccional.
 *
 * DELIBERADAMENTE ESCUETOS. Cada correo dice el hecho y lleva a la pantalla
 * donde está el detalle, en vez de reproducir la reserva entera. Dos razones:
 * un correo es un canal que no controlamos —se reenvía, se queda en bandejas
 * ajenas, se indexa— y meter ahí el detalle de una clase es filtrar dato
 * personal sin necesidad; y evitarlo ahorra una consulta por notificación, que
 * con la cola creciendo sería un N+1 contra la base.
 *
 * El `payload` que dejan los triggers ya trae lo justo: el id para el enlace y,
 * cuando toca, el importe. Nada más hace falta.
 *
 * La campana (US-1203, `lib/notifications.ts`) tiene su propio mapa a propósito:
 * el mismo evento se dice distinto en un aviso de una línea y en un correo.
 */
type Plantilla = {
  asunto: string;
  /** Una frase. Lo que la persona necesita saber sin abrir nada. */
  cuerpo: string;
  /** Texto del botón. Si no hay, el correo va sin enlace. */
  cta?: string;
};

function importe(payload: Payload, campo: string): string {
  const valor = payload?.[campo];
  const moneda = payload?.currency;
  if (typeof valor !== "number" || typeof moneda !== "string") return "";
  return formatMoney(valor, moneda);
}

type Payload = Record<string, unknown> | null;

const PLANTILLAS: Record<string, (p: Payload) => Plantilla> = {
  booking_confirmed_student: () => ({
    asunto: "Tu reserva está confirmada",
    cuerpo:
      "El tutor aceptó tu reserva. Puedes ver el horario y entrar a la sala desde tu panel cuando llegue el momento.",
    cta: "Ver la reserva",
  }),
  booking_new_tutor: () => ({
    asunto: "Tienes una reserva nueva por aceptar",
    cuerpo:
      "Un alumno reservó y ya pagó. Tienes 24 horas para aceptarla; si se pasa el plazo se cancela sola y se le reembolsa el importe completo.",
    cta: "Responder a la reserva",
  }),
  cancellation: () => ({
    asunto: "Se canceló una reserva",
    cuerpo:
      "La reserva quedó cancelada y el horario volvió a estar libre. Si había un reembolso, se aplicó según la política de cancelación.",
    cta: "Ver el detalle",
  }),
  // NTF-14 · el correo de cierre de clase. Lo pidió el cliente con la grabación
  // dentro (acta del 29-ago, ítem 12), y el enlace YA llevaba al sitio correcto:
  // su `cta` resuelve a `/reservas/{id}` (ver `rutaFor`), que es justo la
  // pantalla donde vive el control de grabación. Lo que faltaba era decirlo.
  //
  // ⚠️ ESTE COMENTARIO DECÍA LO CONTRARIO HACE UNA HORA, y estaba mal. Decía
  // que la frase iba en condicional porque RN-42 exigía el sí de las dos partes
  // y «lo normal es que una clase no tenga vídeo». La regla del cliente es la
  // contraria —grabación obligatoria y notificada— y por eso la casilla de la
  // sala es un «Entiendo». Ahora la frase es afirmativa porque la grabación
  // existe siempre que haya habido clase.
  review_request: () => ({
    asunto: "¿Cómo te fue la mentoría?",
    cuerpo:
      "Tu mentoría terminó. Dejar una reseña ayuda a otros alumnos a elegir, y solo lleva un minuto. " +
      "Y ahí mismo tienes la grabación de la clase, disponible durante 30 días.",
    cta: "Ver mi clase y dejar reseña",
  }),
  payment_receipt: (p) => ({
    asunto: "Recibimos tu pago",
    cuerpo: `Tu pago${importe(p, "amount") && ` de ${importe(p, "amount")}`} quedó registrado. Puedes consultar el detalle en tu historial.`,
    cta: "Ver mis pagos",
  }),
  refund_processed: (p) => ({
    asunto: "Tu reembolso está procesado",
    cuerpo: `Se procesó un reembolso${importe(p, "refunded") && ` de ${importe(p, "refunded")}`} por el mismo medio de pago que usaste. Según tu banco puede tardar unos días en aparecer.`,
    cta: "Ver mis pagos",
  }),
  // El asunto dice las DOS cosas a propósito. «Un pago no se pudo completar» era
  // pasivo y ambiguo —¿de quién, y qué pasó con mi clase?— y obligaba a abrir el
  // correo para enterarse de lo que de verdad importa: que la reserva ya no
  // existe. En la bandeja, el asunto es lo único que se lee.
  payment_failed: () => ({
    asunto: "Tu pago no se completó y la reserva se canceló",
    cuerpo:
      "No pudimos cobrar el pago de tu reserva, así que se canceló y el horario volvió a quedar libre. No se te ha cobrado nada.",
    cta: "Ver mis pagos",
  }),
  // ⚠️ EL ASUNTO RAMIFICA IGUAL QUE EL CUERPO. Antes era uno solo —«Tu solicitud
  // para enseñar tiene respuesta»— y eso obligaba a quien había sido APROBADO a
  // abrir el correo para saber si la noticia era buena. Un asunto que oculta
  // deliberadamente el resultado se lee como malas noticias, y aquí la mitad de
  // las veces no lo son. El cuerpo ya ramificaba; el asunto no tenía por qué no.
  tutor_review_result: (p) => ({
    asunto:
      p?.status === "approved"
        ? "Tu perfil de tutor está aprobado"
        : "Revisamos tu solicitud para enseñar",
    cuerpo:
      p?.status === "approved"
        ? "Tu perfil quedó aprobado. Ya puedes publicar mentorías y recibir reservas."
        : "Revisamos tu solicitud y de momento no podemos aprobarla. En tu panel están los detalles y lo que puedes corregir.",
    cta: "Ir a mi panel de tutor",
  }),
  identity_in_review: () => ({
    asunto: "Recibimos tus documentos",
    cuerpo:
      "Tus documentos de verificación están en revisión. Te avisamos en cuanto haya respuesta; no tienes que hacer nada más.",
    cta: "Ver el estado",
  }),
  payout_paid: (p) => ({
    asunto: "Se pagó tu liquidación",
    cuerpo: `Tu liquidación${importe(p, "amount") && ` de ${importe(p, "amount")}`} se marcó como pagada. El detalle está en tu panel de cobros.`,
    cta: "Ver mis cobros",
  }),
  // NTF-23 · el aviso de que el dinero salió y NO ha llegado.
  //
  // ⚠️ POR QUÉ EXISTE: PayPal deja un payout en `UNCLAIMED` cuando el correo del
  // destinatario no es el de una cuenta suya confirmada. Lo retiene **30 días** y
  // después lo devuelve. Medido el 3-sep-2026 contra su sandbox: mismo importe,
  // misma cuenta, misma API — por correo sin confirmar queda `UNCLAIMED`, por id
  // de cuenta entra con `SUCCESS`.
  //
  // Sin este correo el tutor no se entera de nada: en su panel el cobro figura
  // como enviado —que es verdad— y el dinero no aparece. Se entera el día 30,
  // cuando vuelve.
  //
  // No se le dice «tu correo está mal», porque no lo sabemos: `UNCLAIMED`
  // también sale si simplemente aún no ha entrado a aceptarlo. Se le dice el
  // hecho y qué comprobar.
  //
  // 🔴 Y POR QUÉ RAMIFICA POR PROVEEDOR (7-sep-2026). Hasta hoy este cuerpo era
  // uno solo y estaba escrito ENTERO para PayPal, mientras el barrido que lo
  // encola (`avisar_payouts_sin_reclamar`) no filtra por riel a propósito: su
  // migración dice «si mañana otro riel deja un pago colgado igual, este aviso
  // ya lo cubre» (`20260903220000:34-36`). Ese mañana llegó con Wise
  // (`20260907120000`): su transferencia se crea y se queda en `processing`
  // hasta que se fondea, o sea indefinidamente con el saldo a cero. Al día 7 un
  // tutor colombiano al que le pagamos POR TRANSFERENCIA BANCARIA recibía un
  // correo diciéndole que revisara el correo de su cuenta de PayPal, que no
  // tiene, por un dinero que en su riel nadie tiene que reclamar.
  //
  // ⚠️ Y LA PRIMERA FRASE ERA FALSA AHÍ. Decía «Enviamos tu liquidación»: en
  // PayPal es verdad (el lote sale en `SUCCESS` y el pago queda `UNCLAIMED`),
  // pero en Wise la transferencia está creada y el dinero NO ha salido. La
  // frase de arranque se comparte y por eso dice lo único cierto en los dos
  // rieles: que lleva N días en curso y no ha llegado.
  //
  // ⚠️ SIN `provider` SE TRATA COMO «NO ES PAYPAL», y es lo correcto: el cuerpo
  // neutro es cierto en cualquier riel —incluido PayPal— y el de PayPal solo lo
  // es en PayPal. `payouts.provider` es nullable (riel manual, reintento del
  // admin), y avisos viejos con el payload antiguo no hay: medido en dev el
  // 7-sep, `notifications` con `type = 'NTF-23'` devuelve 0 filas.
  payout_unclaimed: (p) => {
    // A variables antes de mirarlas: el payload es `Record<string, unknown>` y
    // el estrechamiento no sobrevive de otra forma (mismo motivo que en
    // `admin_message`).
    const riel = p?.provider;
    const dias = p?.dias;
    const cuanto = importe(p, "amount") ? ` de ${importe(p, "amount")}` : "";
    const tiempo = typeof dias === "number" ? `más de ${dias} días` : "varios días";
    // La frase que abre los dos cuerpos. Cierta con el pago enviado y sin
    // reclamar, y cierta con la transferencia creada y sin fondear.
    const enCurso = `Tu liquidación${cuanto} lleva ${tiempo} en curso y todavía no ha llegado a tu cuenta`;

    if (riel === "paypal") {
      return {
        asunto: "Tu liquidación está esperando a que la reclames",
        cuerpo: `${enCurso} de PayPal. Suele pasar cuando el correo que nos diste no es el de tu cuenta de PayPal, o cuando aún no has entrado a aceptar el pago. Comprueba el correo que tienes registrado con nosotros. Si nadie lo reclama, PayPal nos lo devuelve a los 30 días y tendremos que pagártelo de otra forma.`,
        cta: "Revisar mis datos de cobro",
      };
    }

    // El resto de rieles: banco (Wise, dLocal), cuenta conectada de Stripe,
    // riel manual. En ninguno hay nada que reclamar ni datos que revisar —los
    // que dio ya sirvieron para emitir la orden—, así que pedírselo sería
    // mandarlo a arreglar algo que no está roto. Lo único que le toca saber es
    // que su dinero está señalado y que lo estamos siguiendo.
    return {
      asunto: "Tu liquidación está tardando más de lo normal",
      cuerpo: `${enCurso}. La orden está emitida y la estamos siguiendo; no tienes que hacer nada por tu parte. Te avisamos en cuanto se cierre, y si sigue sin aparecer escríbenos a info@ensenameya.com y la revisamos.`,
      cta: "Ver mis cobros",
    };
  },

  // NTF-21 (EY-151). ⚠️ NI EL MENSAJE NI QUIÉN LO ESCRIBE: el payload que deja
  // el trigger trae solo el id del hilo, a propósito (ver la migración
  // `20260826160000`). Un correo se reenvía y se queda en bandejas ajenas; el
  // chat tiene purga a 30 días dentro de la app y ninguna fuera de ella.
  new_message: () => ({
    asunto: "Tienes un mensaje nuevo",
    cuerpo:
      "Alguien te escribió por el chat de Enséñame Ya. Puedes leerlo y responder desde la plataforma.",
    cta: "Abrir la conversación",
  }),
  recording_ready: () => ({
    asunto: "La grabación de tu mentoría ya está disponible",
    cuerpo:
      "Puedes verla y descargarla desde la reserva. Estará disponible durante 30 días desde que terminó la mentoría; después se borra.",
    cta: "Ver la grabación",
  }),
  // NTF-22 (EY-189) · ⚠️ LA ÚNICA PLANTILLA CON CUERPO LIBRE. Las doce
  // anteriores son literales de este fichero; esta la escribe el administrador
  // desde la bandeja de moderación y viaja en el payload
  // (`admin_contact_user`). Por eso `renderEmail` escapa el cuerpo antes de
  // meterlo en el HTML — ver el comentario de allí.
  //
  // Se cae a una frase neutra si el payload viniera sin texto: un correo con el
  // cuerpo vacío es peor que uno que dice poco, y la RPC ya rechaza el mensaje
  // en blanco, así que esto es solo el cinturón.
  admin_message: (p) => {
    // A una variable antes de mirarla: el payload es `Record<string, unknown>`
    // y solo así el estrechamiento a `string` sobrevive al ternario.
    const m = p?.mensaje;
    return {
      asunto: "Un mensaje del equipo de Enséñame Ya",
      cuerpo:
        typeof m === "string" && m.trim()
          ? m.trim()
          : "El equipo de Enséñame Ya quiere hablar contigo sobre tu cuenta.",
      cta: "Entrar a mi cuenta",
    };
  },
};

/**
 * Escapa lo que va a interpolarse dentro del HTML del correo.
 *
 * ⚠️ Existe desde que hay UNA plantilla con cuerpo libre (`admin_message`,
 * NTF-22). Las demás son literales de este fichero y no contienen ni un `<`, así
 * que escapar siempre no cambia nada de lo que ya se enviaba — y evita tener
 * que acordarse de escapar en la plantilla, que es la clase de olvido que no se
 * ve hasta que alguien pega un `<script>` en el mensaje.
 *
 * Solo se aplica a la rama HTML: en la de texto plano el mensaje va tal cual,
 * porque ahí un `&amp;` se leería literalmente.
 */
function escaparHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailRendered = { subject: string; html: string; text: string };

/**
 * Devuelve `null` si la plantilla no está en el mapa. El job lo trata como
 * error PERMANENTE: reintentar cada 5 minutos una plantilla que no existe no la
 * va a hacer aparecer, y dejarla pendiente para siempre escondería el problema.
 */
export function renderEmail(opts: {
  template: string;
  payload: Payload;
  nombre: string;
  baseUrl: string;
}): EmailRendered | null {
  const plantilla = PLANTILLAS[opts.template]?.(opts.payload);
  if (!plantilla) return null;

  const saludo = opts.nombre ? `Hola ${opts.nombre.split(" ")[0]},` : "Hola,";
  const url = `${opts.baseUrl}${rutaFor(opts.template, opts.payload)}`;

  const text = [
    saludo,
    "",
    plantilla.cuerpo,
    "",
    plantilla.cta ? `${plantilla.cta}: ${url}` : url,
    "",
    "— Enséñame Ya",
    "Recibes este correo porque tienes una cuenta en la plataforma.",
    "¿Dudas? info@ensenameya.com",
  ].join("\n");

  // ─────────────────────────────────────────────────────────────────────────
  // El HTML. Cuatro restricciones que no son estéticas y explican cada
  // decisión rara de aquí abajo:
  //
  // 1. TABLAS, no `div` con flex. Outlook renderiza con el motor de Word y no
  //    soporta flex ni grid. Van con `role="presentation"` para que un lector
  //    de pantalla no las anuncie como tablas de datos (WCAG 1.3.1).
  // 2. TODO EN LÍNEA. Los clientes descartan el `<style>` del head, así que un
  //    `<style>` sería trabajo que se tira. Por eso cada `td` repite su
  //    `font-family` en vez de heredarla.
  // 3. `bgcolor` **Y** `background` en cada celda con color. Outlook ignora el
  //    CSS de fondo en algunas versiones y solo respeta el atributo.
  // 4. CERO IMÁGENES. Los clientes bloquean las remotas por defecto, así que un
  //    logo en `<img>` se ve como un hueco roto la primera vez. El logotipo va
  //    en TEXTO — que además es lo que el Figma escribe a mano cuando el asset
  //    no está («Enséñame ya», 700, azul; ver `site-footer.tsx`), y para un
  //    lector de pantalla es mejor que cualquier `alt`.
  //
  // ⚠️ CONTRASTE: el texto del botón es `#14141a` sobre el naranja de marca, no
  // blanco. Medido: blanco sobre `#fe6a00` da **2.89:1** y falla el AA de WCAG
  // incluso para texto grande (pide 3:1); `#14141a` sobre el mismo naranja da
  // **6.36:1**. Así el naranja de marca se queda intacto y el correo cumple.
  // Los enlaces usan `--brand-foreground` (#036fda, 4.90:1) y no `--brand`
  // (#0080ff, 3.80:1): los dos existen ya en `globals.css`, no se inventó nada.
  // El logotipo sí va en #0080ff — WCAG 1.4.3 exime los logotipos.
  //
  // Poppins va PRIMERA en la pila aunque casi nadie la tenga instalada: si
  // está, el correo se ve con la tipografía de la marca; si no, cae a la del
  // sistema. No cuesta nada y no puede fallar.
  //
  // El botón mide 48 px de alto (15+15 de padding + 18 de línea) para cumplir
  // el objetivo táctil de 44 px de WCAG 2.5.5 — un correo se abre en el móvil.
  //
  // ⚠️ Los dos trozos variables van escapados. El cuerpo por `admin_message`
  // (NTF-22, lo escribe el admin), y el saludo porque sale de
  // `profiles.full_name`, que lo escribe el propio usuario.
  //
  // Los saltos de línea del cuerpo se convierten en `<br>` DESPUÉS de escapar:
  // un mensaje del panel se escribe en varios párrafos y sin esto llegaba todo
  // pegado en una línea.
  const FUENTE =
    "Poppins,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const cuerpoHtml = escaparHtml(plantilla.cuerpo).replace(/\n/g, "<br>");
  // La línea de vista previa de la bandeja. Sin esto, lo que se lee junto al
  // asunto es «Hola Lucía,» — el saludo, que no informa de nada. Va oculta:
  // la ven los clientes en la lista y no se pinta al abrir el correo.
  const preheader = escaparHtml(plantilla.cuerpo.replace(/\s+/g, " ").slice(0, 140));

  const html = `<div lang="es" style="margin:0;padding:0;background:#f5f5f5">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f5" style="background:#f5f5f5;width:100%;border-collapse:collapse">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff;width:100%;max-width:520px;border-collapse:collapse;border-radius:12px">
          <tr>
            <td style="padding:28px 28px 0;font-family:${FUENTE};font-size:18px;font-weight:700;line-height:1.2;color:#0080ff">Enséñame ya</td>
          </tr>
          <tr>
            <td style="padding:20px 28px 0;font-family:${FUENTE};font-size:15px;line-height:1.6;color:#14141a">${escaparHtml(saludo)}</td>
          </tr>
          <tr>
            <td style="padding:10px 28px 0;font-family:${FUENTE};font-size:15px;line-height:1.6;color:#14141a">${cuerpoHtml}</td>
          </tr>
          <tr>
            <td style="padding:24px 28px 0">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
                <tr>
                  <td bgcolor="#fe6a00" align="center" style="background:#fe6a00;border-radius:8px">
                    <a href="${url}" style="display:block;padding:15px 24px;font-family:${FUENTE};font-size:15px;font-weight:700;line-height:18px;color:#14141a;text-decoration:none">${escaparHtml(plantilla.cta ?? "Abrir Enséñame Ya")}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 0">
              <div style="height:1px;background:#e0e0e0;font-size:0;line-height:1px">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 28px;font-family:${FUENTE};font-size:13px;line-height:1.6;color:#4d4d4d">
              <strong style="color:#14141a">Enséñame Ya</strong> · Recibes este correo porque tienes una cuenta en la plataforma.<br>
              ¿Dudas? Escríbenos a <a href="mailto:info@ensenameya.com" style="color:#036fda;text-decoration:underline">info@ensenameya.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;

  return { subject: plantilla.asunto, html, text };
}
