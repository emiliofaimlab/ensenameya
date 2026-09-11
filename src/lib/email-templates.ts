// Relativo y no `@/`: así `email-templates.check.ts` puede ejecutarse con node
// a pelo, sin resolver el alias de tsconfig. Mismo estilo que `src/lib/auth/*`.
import { formatMoney } from "./catalog/format.ts";
// El destino del enlace lo decide la campana (US-1203): una sola función para
// el correo y el aviso in-app, y vive allí porque allí no arrastra nada.
import { rutaFor } from "./notifications.ts";
import {
  aTextoPlano,
  boton,
  caja,
  cita,
  codigo,
  enlaceSecundario,
  esc,
  estrellas,
  ficha,
  importeGrande,
  nota,
  NARANJA_FG,
  parrafo,
  pasos,
  persona,
  render,
  ROJO,
  STYLE,
  tablaPedido,
  tarjetaClase,
  TINTA,
  VERDE,
  type Bloque,
  type Familia,
  type LineaPedido,
} from "./email-sistema.ts";

/**
 * Doc 33 · el texto y la estructura de cada correo de la plataforma.
 *
 * ⚠️ ESTO DEROGA LA REGLA VIEJA DE «CORREOS DELIBERADAMENTE ESCUETOS», y solo
 * en parte. Hasta el 10-sep-2026 cada correo decía el hecho y llevaba a la
 * pantalla, sin reproducir la reserva. El pliego del Doc 33 rompe eso **en la
 * familia de compra y reserva**: un recibo sin qué compraste no es un recibo, y
 * un «tu clase es mañana» sin la hora obliga a entrar para saber a qué hora.
 *
 * FUERA de esa familia —chat, moderación, KYC, payouts— la regla sigue intacta
 * y por el mismo motivo de siempre: un correo es un canal que no controlamos
 * (se reenvía, se queda en bandejas ajenas, se indexa) y el chat tiene purga a
 * 30 días DENTRO de la app y ninguna fuera.
 *
 * ─── De dónde salen los datos ───────────────────────────────────────────────
 *
 * De dos sitios, y la diferencia importa:
 *
 *   · `payload` — lo que dejó el trigger. Ids e importes. Es lo que había.
 *   · `contexto` — lo que resuelve `pending_email_notifications` en la MISMA
 *     consulta que saca el lote (título de la clase, tutor, hora, desglose del
 *     payout…). Se resolvió ahí y no en seis triggers distintos por dos motivos:
 *     una sola consulta para todo el lote en vez de un N+1 por notificación, y
 *     las filas YA ENCOLADAS antes de este cambio también salen completas.
 *
 * TODO BLOQUE QUE DEPENDA DEL CONTEXTO SE CAE SOLO SI EL DATO NO VINO. Un
 * correo al que le falta la ficha sigue siendo un correo correcto; uno que pinta
 * «Cuándo: undefined» no. Por eso los componentes devuelven `null` y `render`
 * filtra.
 *
 * Los `id` de plantilla NO CAMBIAN respecto de lo que había: ninguna migración,
 * ningún trigger y ninguna fila ya encolada se entera del rediseño.
 */

export type Payload = Record<string, unknown> | null;

/** Una línea del desglose de un pedido o de una liquidación. */
type LineaCruda = { titulo?: unknown; sub?: unknown; importe?: unknown; moneda?: unknown };

/**
 * Lo que la BD resuelve para el correo. Todo opcional: una notificación encolada
 * antes de este cambio, o cuya reserva ya no existe, llega sin nada.
 */
export type Contexto = {
  clase?: string;
  tutor?: string;
  alumno?: string;
  /** ISO 8601 en UTC. Se pinta en el huso del DESTINATARIO (RN-35). */
  inicio?: string;
  duracion_min?: number;
  /** Unidades mínimas, con su moneda al lado. Nunca un float (convención). */
  importe?: number;
  moneda?: string;
  /**
   * Lo que se lleva el TUTOR por esta reserva (`payments.tutor_net_amount`).
   * Va aparte de `importe` porque en los correos del tutor enseñar el precio
   * que pagó el alumno sería enseñarle la comisión al revés.
   */
  neto_tutor?: number;
  /** Fin del plazo de las 24 h de aceptación (RN-38), ISO en UTC. */
  limite?: string;
  sesion_id?: string;
  tutor_id?: string;
  product_id?: string;
  /** Quién canceló: 'tutor' | 'student' | 'system'. */
  cancelado_por?: string;
  reembolso?: number;
  /** «Visa ···· 4242», ya montado por la BD. */
  metodo?: string;
  /** Los cuatro últimos de la cuenta de cobro del tutor. */
  cuenta?: string;
  /** El motivo del rechazo de KYC (`tutor_profiles.approval_notes`). */
  motivo?: string;
  /** Días que lleva un payout sin llegar (NTF-23). */
  dias?: number;
  payout?: {
    ref?: string;
    bruto?: number;
    comision?: number;
    neto?: number;
    moneda?: string;
    sesiones?: number;
    desde?: string;
    hasta?: string;
  };
  pedido?: {
    ref?: string;
    total?: number;
    moneda?: string;
    lineas?: LineaCruda[];
    /** Cuántas de las líneas esperan aún al tutor. */
    pendientes?: number;
  };
  resena?: { rating?: number; comment?: string; autor?: string; media?: number; total?: number };
  /** El mensaje del formulario de contacto y su ficha. */
  contacto?: {
    nombre?: string;
    correo?: string;
    tipo?: string;
    sesion?: string;
    mensaje?: string;
    recibido?: string;
    adjuntos?: { nombre?: string; tamano?: string }[];
  };
  /** El resumen horario de incidencias (NTF-13). */
  alertas?: { lineas?: LineaCruda[]; total?: number; moneda?: string; desde?: string; hasta?: string };
};

// ── Formato ─────────────────────────────────────────────────────────────────

function dinero(monto: unknown, moneda: unknown): string | null {
  if (typeof monto !== "number" || typeof moneda !== "string" || !moneda) return null;
  return formatMoney(monto, moneda);
}

/**
 * ⚠️ RN-35 · la hora se pinta SIEMPRE en el huso del destinatario, que es lo que
 * `pending_email_notifications` devuelve desde `profiles.timezone`. Un
 * recordatorio que dice «18:00» en la hora del servidor es un no-show.
 *
 * Si el huso o la fecha no valen, devuelve `null` y el bloque que la pedía se
 * cae: mejor una ficha con una línea menos que una hora mentirosa.
 */
function fmt(iso: unknown, tz: string, opciones: Intl.DateTimeFormatOptions): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("es", { timeZone: tz, ...opciones }).format(d);
  } catch {
    // Huso desconocido: se reintenta en UTC antes que quedarse sin fecha.
    try {
      return new Intl.DateTimeFormat("es", { timeZone: "UTC", ...opciones }).format(d);
    } catch {
      return null;
    }
  }
}

const may = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

/** «Martes 15 de septiembre, 18:00 (GMT-5)» */
function cuando(iso: unknown, tz: string): string | null {
  const f = fmt(iso, tz, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  });
  return may(f?.replace(",", "") ?? null);
}

/** «15 sep, 18:00» — para asuntos, donde el espacio es el recurso escaso. */
function cuandoCorto(iso: unknown, tz: string): string | null {
  return fmt(iso, tz, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })?.replace(".", "") ?? null;
}

/** «18:00» */
function hora(iso: unknown, tz: string): string | null {
  return fmt(iso, tz, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** «15 de octubre» */
function dia(iso: unknown, tz: string): string | null {
  return fmt(iso, tz, { day: "numeric", month: "long" });
}

/**
 * Cuántos días naturales faltan, contados EN EL HUSO DEL DESTINATARIO. Sirve
 * para decir «mañana» sin mentirle a quien vive seis husos más allá: a las 23:00
 * de Madrid pueden ser las 17:00 de Bogotá, y «mañana» no es el mismo día.
 */
function diasHasta(iso: unknown, tz: string, ahora: Date): number | null {
  const ymd = (d: Date) => fmt(d.toISOString(), tz, { year: "numeric", month: "2-digit", day: "2-digit" });
  if (typeof iso !== "string") return null;
  const a = ymd(new Date(iso));
  const b = ymd(ahora);
  if (!a || !b) return null;
  // `es` formatea dd/mm/aaaa; se invierte para poder restar como fechas.
  const aFecha = Date.parse(a.split("/").reverse().join("-"));
  const bFecha = Date.parse(b.split("/").reverse().join("-"));
  if (Number.isNaN(aFecha) || Number.isNaN(bFecha)) return null;
  return Math.round((aFecha - bFecha) / 86_400_000);
}

function duracion(min: unknown): string | null {
  return typeof min === "number" && min > 0 ? `${min} minutos` : null;
}

function lineas(crudas: LineaCruda[] | undefined, monedaPorDefecto?: string): LineaPedido[] {
  if (!Array.isArray(crudas)) return [];
  return crudas.flatMap((l) => {
    const importe = dinero(l.importe, l.moneda ?? monedaPorDefecto);
    if (typeof l.titulo !== "string" || !importe) return [];
    return [{ titulo: l.titulo, sub: typeof l.sub === "string" ? l.sub : "", importe }];
  });
}

/** Añade el importe al asunto solo si lo hay: «Recibo de tu mentoría · US$ 24,00». */
const con = (base: string, extra: string | null) => (extra ? `${base} · ${extra}` : base);

// ── El contrato de una plantilla ────────────────────────────────────────────

type Plantilla = {
  asunto: string;
  epigrafe: string;
  titulo: string;
  preheader: string;
  familia: Familia;
  cuerpo: Bloque[];
  motivo: string;
  /**
   * `null` = este correo no saluda por el nombre. Solo los internos
   * (`contact_internal`, `admin_alert`), que no van a una persona concreta.
   */
  saludo?: null;
  /** No esencial: se puede no querer recibir (Doc 33 §9). */
  baja?: boolean;
};

type Ctx = {
  /** Origen del despliegue que atiende la petición. Nunca una constante. */
  base: string;
  /** El destino canónico del correo, ya resuelto por `rutaFor`. */
  url: string;
  /** Nombre de pila del destinatario, o "" si `profiles.full_name` viene vacío. */
  nombre: string;
  p: Payload;
  c: Contexto;
  /** Huso del destinatario (RN-35). */
  tz: string;
  ahora: Date;
};

const SOPORTE = "mailto:info@ensenameya.com";

const PLANTILLAS: Record<string, (x: Ctx) => Plantilla> = {
  // ══ A · Cuenta y acceso ═══════════════════════════════════════════════════
  //
  // ⚠️ LAS TRES DE AUTH NO LAS MANDA ESTE CÓDIGO. Las manda Supabase, y se
  // configuran en Dashboard → Authentication → Emails (o por `content_path` en
  // `supabase/config.toml`). Viven aquí para que haya UNA fuente de verdad del
  // diseño: `npm run build:correos-auth` las escribe a `supabase/templates/`.
  // Por eso sus enlaces son literales Go (`{{ .ConfirmationURL }}`) y no salen
  // de `x.url`.
  auth_confirm_signup: () => ({
    asunto: "Confirma tu correo para entrar a Enséñame Ya",
    familia: "cuenta",
    epigrafe: "Confirma tu cuenta",
    titulo: "Un clic y ya estás dentro",
    preheader: "Confirma tu correo para activar tu cuenta. El enlace caduca en 24 horas.",
    motivo: "Recibes este correo porque alguien usó esta dirección para registrarse en Enséñame Ya.",
    cuerpo: [
      parrafo(
        "Gracias por registrarte. Solo falta que confirmes que esta dirección es tuya para poder reservar mentorías y hablar con los tutores.",
      ),
      boton("Confirmar mi correo", "{{ .ConfirmationURL }}"),
      parrafo("O escribe este código en la pantalla que dejaste abierta:", { size: 14 }),
      codigo("{{ .Token }}"),
      nota(
        "El enlace y el código caducan en 24 horas. Si no fuiste tú quien se registró, ignora este correo: sin confirmar, la cuenta no se activa.",
      ),
    ],
  }),
  auth_reset_password: () => ({
    asunto: "Restablece tu contraseña",
    familia: "cuenta",
    epigrafe: "Seguridad de la cuenta",
    titulo: "Elige una contraseña nueva",
    preheader: "Pediste restablecer tu contraseña. El enlace vale una hora.",
    motivo: "Recibes este correo porque se pidió restablecer la contraseña de esta cuenta.",
    cuerpo: [
      parrafo(
        "Pediste cambiar tu contraseña. Pulsa el botón y elige una nueva; el enlace solo sirve una vez y caduca en una hora.",
      ),
      boton("Elegir contraseña nueva", "{{ .ConfirmationURL }}"),
      caja(
        `<strong>Si no lo pediste tú</strong>, no hagas nada: tu contraseña actual sigue intacta y este enlace caduca solo. Si te preocupa, escríbenos a <a href="${SOPORTE}" style="color:${ROJO}">info@ensenameya.com</a>.`,
        "alerta",
      ),
    ],
  }),
  auth_change_email: () => ({
    asunto: "Confirma tu nueva dirección de correo",
    familia: "cuenta",
    epigrafe: "Cambio de correo",
    titulo: "Confirma esta dirección",
    preheader: "Confirma la nueva dirección para terminar el cambio.",
    motivo: "Recibes este correo porque se pidió usar esta dirección en una cuenta de Enséñame Ya.",
    cuerpo: [
      parrafo(
        "Pediste cambiar el correo de tu cuenta a esta dirección. Confírmalo y a partir de ahí entrarás y recibirás los avisos aquí.",
      ),
      boton("Confirmar la nueva dirección", "{{ .ConfirmationURL }}"),
      nota("Hasta que confirmes, tu cuenta sigue usando la dirección anterior."),
    ],
  }),

  welcome_student: (x) => ({
    asunto: x.nombre ? `Bienvenida a Enséñame Ya, ${x.nombre}` : "Bienvenida a Enséñame Ya",
    familia: "clase",
    epigrafe: "Bienvenida",
    titulo: "Tu primera mentoría, en tres pasos",
    preheader: "Ya tienes cuenta. Así encuentras tutor y reservas tu primera clase.",
    motivo: "Recibes este correo porque acabas de crear tu cuenta.",
    baja: true,
    cuerpo: [
      parrafo(
        "Tu cuenta ya está activa. Enséñame Ya son mentorías <strong>1 a 1 en vivo</strong>: eliges tutor, eliges hora y os veis por videollamada dentro de la plataforma.",
      ),
      pasos([
        [
          "Busca por materia",
          "Filtra por categoría, precio y disponibilidad. Cada tutor tiene su ficha con reseñas reales de otros alumnos.",
        ],
        [
          "Elige un hueco",
          "Ves su agenda en tu propia hora local. Reservas y pagas en el mismo paso.",
        ],
        ["Entra a la sala", "El botón se activa unos minutos antes. No instalas nada."],
      ]),
      boton("Buscar mi tutor", `${x.base}/search`),
      nota("¿Prefieres que te acompañemos? Escríbenos y te ayudamos a elegir."),
    ],
  }),
  welcome_tutor: (x) => ({
    asunto: "Ya casi puedes enseñar: te faltan dos pasos",
    familia: "clase",
    epigrafe: "Bienvenida a tutores",
    titulo: "Dos pasos y tu perfil sale a buscar alumnos",
    preheader: "Verifica tu identidad y publica tu primera mentoría.",
    motivo: "Recibes este correo porque solicitaste enseñar en Enséñame Ya.",
    baja: true,
    cuerpo: [
      parrafo(
        "Tu perfil de tutor está creado. Antes de que aparezca en las búsquedas necesitamos dos cosas, y las dos se hacen desde tu panel.",
      ),
      pasos([
        [
          "Verifica tu identidad",
          "Documento de identidad y los títulos que quieras acreditar. Lo revisamos a mano y solemos responder en 48 horas.",
        ],
        [
          "Publica tu primera mentoría",
          "Título, precio y las horas en las que estás disponible. Puedes cambiarlo cuando quieras.",
        ],
      ]),
      boton("Ir a mi panel de tutor", `${x.base}/tutor`),
      enlaceSecundario("Cómo se calculan tus cobros", `${x.base}/how-it-works`),
    ],
  }),

  /**
   * ⚠️ NO VA POR LA COLA. Lo manda directo `/api/checkout/invitado`: la cola la
   * vacía un cron que en producción pasa cada 2-6 horas, y un aviso de seguridad
   * que llega mañana no avisa.
   *
   * La dirección NO se interpola en el cuerpo: quien lo recibe ya la conoce, y
   * así no hay texto de nadie dentro del HTML.
   */
  guest_account_created: () => ({
    asunto: "Se creó una cuenta con tu correo en Enséñame Ya",
    familia: "alerta",
    epigrafe: "Aviso de seguridad",
    titulo: "Alguien creó una cuenta con esta dirección",
    preheader: "Se creó una cuenta con tu correo desde el formulario de pago.",
    motivo: "Recibes este correo porque alguien usó esta dirección para crear una cuenta.",
    cuerpo: [
      parrafo(
        "Acabamos de crear una cuenta en Enséñame Ya con esta dirección, desde el formulario de pago.",
      ),
      caja(
        "<strong>Si fuiste tú</strong>, no tienes que hacer nada.<br>" +
          "<strong>Si no fuiste tú</strong>, escríbenos: esa cuenta puede entrar con la contraseña que se eligió al crearla, y conviene desactivarla.",
        "alerta",
      ),
      boton("Escribir a soporte", SOPORTE),
    ],
  }),

  // ══ B · Compra ════════════════════════════════════════════════════════════

  /**
   * NTF-04b · el recibo del PEDIDO.
   *
   * ⚠️ Existe porque `confirm_order_payment` pasa línea por línea por
   * `confirm_payment`, y el trigger de NTF-04 encolaba un recibo por cada pago:
   * un carrito de tres clases disparaba tres recibos sueltos y ningún total.
   * Desde `20260911180000` el recibo por línea se silencia cuando la reserva
   * tiene `order_id`, y este lo sustituye.
   */
  order_receipt: (x) => {
    const pedido = x.c.pedido ?? {};
    const total = dinero(pedido.total, pedido.moneda);
    const ls = lineas(pedido.lineas, pedido.moneda);
    const pendientes = typeof pedido.pendientes === "number" ? pedido.pendientes : 0;
    return {
      asunto: con("Recibo de tu pedido", total),
      familia: "compra",
      epigrafe: "Recibo",
      titulo: "Recibimos tu pago",
      preheader: [pedido.ref, ls.length ? `${ls.length} mentorías` : null, total]
        .filter(Boolean)
        .join(" · "),
      motivo: "Recibes este correo porque compraste en Enséñame Ya.",
      cuerpo: [
        parrafo(
          "Tu pago quedó registrado. Este es el detalle de lo que compraste; cada mentoría tiene su propia página con el horario y el acceso a la sala.",
        ),
        total
          ? tablaPedido(ls, total, {
              nota: [
                pedido.ref ? `Pedido ${pedido.ref}` : null,
                x.c.metodo ? `Pagado con ${x.c.metodo}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || null,
            })
          : null,
        pendientes > 0
          ? caja(
              `${pendientes === 1 ? "Una de estas mentorías espera" : `${pendientes} de estas mentorías esperan`} a que el tutor las acepte. Tiene 24 horas para hacerlo; si no responde, se cancela sola y te devolvemos el importe completo.`,
              "compra",
            )
          : null,
        boton("Ver mis reservas", `${x.base}/reservas`),
      ],
    };
  },

  payment_receipt: (x) => {
    const importe = dinero(x.p?.amount ?? x.c.importe, x.p?.currency ?? x.c.moneda);
    return {
      asunto: con("Recibo de tu mentoría", importe),
      familia: "compra",
      epigrafe: "Recibo",
      titulo: "Recibimos tu pago",
      preheader: importe ? `Pago de ${importe} registrado. Aquí está tu recibo.` : "Aquí está tu recibo.",
      motivo: "Recibes este correo porque compraste en Enséñame Ya.",
      cuerpo: [
        // ⚠️ EL IMPORTE VA EN LA FRASE, no solo en la ficha. La ficha depende
        // del contexto y se cae entera si la reserva no se pudo resolver; el
        // importe viene en el payload del trigger y está SIEMPRE. Un recibo que
        // no dice cuánto te cobraron no es un recibo, y ése era justo el estado
        // en que quedaba este correo con el contexto vacío.
        parrafo(
          importe
            ? `Tu pago de <strong>${esc(importe)}</strong> quedó registrado. Este es el recibo de tu mentoría.`
            : "Tu pago quedó registrado. Este es el recibo de tu mentoría.",
        ),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.tutor,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
          importe,
          acento: NARANJA_FG,
          fondo: "#fff3ea",
        }),
        nota(
          [x.c.metodo ? `Pagado con ${esc(x.c.metodo)}` : null, "Ensename Ya, LLC · EIN 42-2277169"]
            .filter(Boolean)
            .join(" · "),
        ),
        boton("Ver la reserva", x.url),
      ],
    };
  },

  /**
   * El asunto dice las DOS cosas a propósito. «Un pago no se pudo completar» era
   * pasivo y ambiguo —¿de quién, y qué pasó con mi clase?— y obligaba a abrir el
   * correo para enterarse de lo que de verdad importa: que la reserva ya no
   * existe. En la bandeja, el asunto es lo único que se lee.
   */
  payment_failed: (x) => ({
    asunto: "Tu pago no se completó y la reserva se canceló",
    familia: "alerta",
    epigrafe: "Pago rechazado",
    titulo: "No pudimos cobrar tu reserva",
    preheader: "El cobro no salió, la reserva se canceló y no se te cobró nada.",
    motivo: "Recibes este correo porque intentaste reservar en Enséñame Ya.",
    cuerpo: [
      parrafo(
        "El cobro de tu reserva no salió adelante, así que la reserva se canceló y el horario volvió a quedar libre.",
      ),
      caja(
        "<strong>No se te ha cobrado nada.</strong> Si ves un cargo retenido en tu banco, es una preautorización y desaparece sola en unos días.",
        "alerta",
      ),
      tarjetaClase({
        titulo: x.c.clase,
        tutor: x.c.tutor,
        cuando: cuando(x.c.inicio, x.tz),
        duracion: duracion(x.c.duracion_min),
        importe: dinero(x.p?.amount ?? x.c.importe, x.p?.currency ?? x.c.moneda),
        acento: ROJO,
        fondo: "#fdeceb",
      }),
      parrafo("El hueco sigue libre ahora mismo. Puedes volver a reservarlo con otro medio de pago.", {
        top: 18,
      }),
      boton(
        "Reservar otra vez",
        x.c.product_id ? `${x.base}/products/${x.c.product_id}` : `${x.base}/search`,
      ),
    ],
  }),

  /**
   * ⚠️ DECISIÓN DE PRODUCTO ABIERTA (la nº 1 del pliego). Este aviso se encola
   * cuando el reembolso se PIDE, no cuando el dinero se mueve: entre las dos
   * cosas está la cola `refund_requests`, que vacía `/api/cron/refunds-process`
   * sin encolar nada. Por eso el texto dice «está en camino» y «puede tardar», y
   * NO dice «ya está en tu cuenta»: es lo único cierto en los dos momentos.
   */
  refund_processed: (x) => {
    const importe = dinero(x.p?.refunded ?? x.c.reembolso, x.p?.currency ?? x.c.moneda);
    return {
      asunto: con("Tu reembolso está en camino", importe),
      familia: "compra",
      epigrafe: "Reembolso",
      titulo: "Devolvemos tu dinero",
      preheader: importe
        ? `Reembolso de ${importe} por el mismo medio de pago.`
        : "Tu reembolso va por el mismo medio de pago.",
      motivo: "Recibes este correo porque se canceló una reserva que habías pagado.",
      cuerpo: [
        importeGrande("Reembolso", importe, {
          sub: x.c.metodo ? `Al mismo medio de pago: ${x.c.metodo}` : "Al mismo medio de pago",
        }),
        parrafo(
          "Lo devolvemos por la misma vía por la que pagaste. Según tu banco puede tardar entre 3 y 10 días hábiles en aparecer en tu extracto.",
          { top: 20 },
        ),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.tutor,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
          importe: dinero(x.c.importe, x.c.moneda),
          acento: NARANJA_FG,
          fondo: "#fff3ea",
        }),
        boton("Ver mis pagos", x.url),
      ],
    };
  },

  // ══ C · Reserva y clase ═══════════════════════════════════════════════════

  /**
   * NTF-17b · el hueco entre pagar y que el tutor acepte.
   *
   * Hasta el Doc 33 el alumno pagaba y solo recibía el recibo: nadie le decía
   * que su clase todavía no estaba cerrada ni hasta cuándo esperaba. NTF-05 se
   * dispara en `confirmed`; en `pending_acceptance` (RN-38) no había nada.
   */
  booking_pending_student: (x) => {
    const limite = cuando(x.c.limite, x.tz);
    return {
      asunto: "Tu reserva espera la respuesta del tutor",
      familia: "clase",
      epigrafe: "Pendiente de aceptación",
      titulo: x.c.tutor
        ? `${primerNombre(x.c.tutor)} tiene 24 horas para confirmar`
        : "El tutor tiene 24 horas para confirmar",
      preheader: "Ya pagaste. Falta que el tutor acepte; tiene 24 horas.",
      motivo: "Recibes este correo porque reservaste una mentoría.",
      cuerpo: [
        parrafo(
          "Tu pago está hecho y el horario reservado a tu nombre. Ahora le toca al tutor confirmar que puede.",
        ),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.tutor,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
          importe: dinero(x.c.importe, x.c.moneda),
        }),
        caja(
          limite
            ? `Si no responde antes de <strong>${esc(limite)}</strong>, la reserva se cancela sola y te devolvemos el importe completo, sin que tengas que pedirlo.`
            : "Si no responde dentro del plazo, la reserva se cancela sola y te devolvemos el importe completo, sin que tengas que pedirlo.",
          "clase",
          "Qué pasa si no contesta",
        ),
        boton("Ver el estado de mi reserva", x.url),
      ],
    };
  },

  booking_new_tutor: (x) => {
    const limite = cuando(x.c.limite, x.tz);
    const corto = cuandoCorto(x.c.inicio, x.tz);
    return {
      asunto: con("Nueva reserva por aceptar", corto),
      familia: "clase",
      epigrafe: "Reserva nueva",
      titulo: "Tienes una reserva por aceptar",
      preheader: x.c.alumno
        ? `${primerNombre(x.c.alumno)} reservó y ya pagó. Tienes 24 horas para aceptar.`
        : "Un alumno reservó y ya pagó. Tienes 24 horas para aceptar.",
      motivo: "Recibes este correo porque eres tutor en Enséñame Ya.",
      cuerpo: [
        parrafo(
          "Una persona reservó una de tus mentorías y <strong>ya pagó</strong>. Solo falta tu confirmación.",
        ),
        persona(x.c.alumno, "Alumno"),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: "Tú",
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
          importe: netoTutor(x),
        }),
        caja(
          limite
            ? `Tienes hasta <strong>${esc(limite)}</strong>. Si se pasa el plazo, la reserva se cancela sola, se le reembolsa al alumno y el hueco vuelve a tu agenda.`
            : "Tienes 24 horas. Si se pasa el plazo, la reserva se cancela sola, se le reembolsa al alumno y el hueco vuelve a tu agenda.",
          "clase",
          "El plazo",
        ),
        boton("Aceptar o rechazar", `${x.base}/tutor/reservas/${x.p?.booking_id ?? ""}`),
      ],
    };
  },

  /**
   * NTF-17 · el aviso de que el plazo se acaba.
   *
   * ⚠️ El texto NO cita una hora exacta de «te quedan N horas» sacada del reloj
   * del job: lo encola `avisar_reservas_por_expirar` desde `pg_cron` (dentro de
   * Postgres, cada 10 minutos), no GitHub Actions, precisamente para poder decir
   * la hora LÍMITE, que es un dato de la reserva y no del momento del envío.
   */
  booking_expiring_tutor: (x) => {
    const limite = cuando(x.c.limite, x.tz);
    const h = hora(x.c.limite, x.tz);
    return {
      asunto: h ? `Te queda poco para responder: la reserva vence a las ${h}` : "El plazo para responder a esta reserva se acaba",
      familia: "alerta",
      epigrafe: "El plazo se acaba",
      titulo: "Esta reserva está a punto de cancelarse",
      preheader: limite
        ? `El plazo para aceptar vence el ${limite}.`
        : "El plazo para aceptar esta reserva está por vencer.",
      motivo: "Recibes este correo porque tienes una reserva sin responder.",
      cuerpo: [
        caja(
          limite
            ? `Si no respondes antes de <strong>${esc(limite)}</strong>, la reserva se cancela sola, se le devuelve el dinero al alumno y el hueco vuelve a tu agenda.`
            : "Si no respondes dentro del plazo, la reserva se cancela sola, se le devuelve el dinero al alumno y el hueco vuelve a tu agenda.",
          "alerta",
          "El plazo está por vencer",
        ),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.alumno ?? null,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
          importe: netoTutor(x),
          acento: ROJO,
          fondo: "#fdeceb",
        }),
        parrafo(
          "Rechazarla también vale: es mejor un no a tiempo que un plazo agotado. Al alumno le devolvemos el importe igual, pero puede buscar otro hueco hoy.",
          { top: 18 },
        ),
        boton("Responder ahora", `${x.base}/tutor/reservas/${x.p?.booking_id ?? ""}`),
      ],
    };
  },

  booking_confirmed_student: (x) => {
    const d = dia(x.c.inicio, x.tz);
    return {
      asunto: d ? `Confirmada: tu mentoría del ${d}` : "Tu reserva está confirmada",
      familia: "ok",
      epigrafe: "Reserva confirmada",
      titulo: x.c.tutor
        ? `${primerNombre(x.c.tutor)} te espera`
        : "Tu mentoría está confirmada",
      preheader: "Tu mentoría está confirmada. Añádela a tu calendario.",
      motivo: "Recibes este correo porque reservaste una mentoría.",
      cuerpo: [
        parrafo("El tutor aceptó tu reserva. Ya está cerrada: solo tienes que entrar."),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.tutor,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
          acento: VERDE,
          fondo: "#e9f7ef",
        }),
        parrafo(
          "El botón para entrar a la sala se activa <strong>10 minutos antes</strong> y lo encuentras en la página de la reserva. No tienes que instalar nada.",
          { top: 18 },
        ),
        boton("Ver mi reserva", x.url),
        // El `.ics` va también como ADJUNTO (`sendEmail` lo soporta desde el Doc
        // 33 §5.2). El enlace se queda para el cliente que descarta adjuntos.
        x.c.sesion_id
          ? enlaceSecundario("Añadir al calendario (.ics)", `${x.base}/api/calendario/sesion/${x.c.sesion_id}`)
          : null,
        nota("La clase se graba y tendrás el vídeo durante 30 días. Te avisamos cuando esté listo."),
      ],
    };
  },

  booking_reminder_24h: (x) => {
    const h = hora(x.c.inicio, x.tz);
    const dias = diasHasta(x.c.inicio, x.tz, x.ahora);
    const cuandoTexto =
      dias === 0 ? "Hoy" : dias === 1 ? "Mañana" : may(dia(x.c.inicio, x.tz)) ?? null;
    const quien = x.c.tutor ? ` con ${primerNombre(x.c.tutor)}` : "";
    return {
      asunto:
        cuandoTexto && h
          ? `${cuandoTexto} a las ${h}: tu mentoría${quien}`
          : `Recordatorio: tu mentoría${quien}`,
      familia: "clase",
      epigrafe: "Recordatorio",
      titulo: dias === 0 ? "Tu mentoría es hoy" : "Tu mentoría es mañana",
      preheader: h ? `${cuandoTexto ?? "Pronto"} a las ${h} (tu hora). Prepara tus dudas.` : "Prepara tus dudas.",
      motivo: "Recibes este correo porque tienes una mentoría reservada.",
      baja: true,
      cuerpo: [
        parrafo("Un recordatorio para que no te pille por sorpresa."),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.tutor,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
        }),
        caja(
          "Llega con las dudas escritas: una hora rinde mucho más cuando el tutor sabe por dónde empezar. Puedes mandárselas por el chat antes de la clase.",
          "clase",
          "Un consejo",
        ),
        boton("Ver la reserva", x.url),
        enlaceSecundario("¿No te viene bien? Consulta la política de cancelación", `${x.base}/terms`),
      ],
    };
  },

  session_starting: (x) => ({
    asunto: "Tu clase empieza en unos minutos",
    familia: "ok",
    epigrafe: "Es la hora",
    titulo: "La sala ya está abierta",
    preheader: "Entra a la sala: tu mentoría está por empezar.",
    motivo: "Recibes este correo porque tu mentoría está por comenzar.",
    cuerpo: [
      parrafo(
        x.c.tutor
          ? `Tu mentoría con ${esc(primerNombre(x.c.tutor))} empieza en unos minutos. La sala está abierta.`
          : "Tu mentoría empieza en unos minutos. La sala está abierta.",
      ),
      boton("Entrar a la sala", x.c.sesion_id ? `${x.base}/room/${x.c.sesion_id}` : x.url),
      tarjetaClase({
        titulo: x.c.clase,
        tutor: x.c.tutor,
        cuando: cuando(x.c.inicio, x.tz),
        duracion: duracion(x.c.duracion_min),
        acento: VERDE,
        fondo: "#e9f7ef",
      }),
      nota(
        "Funciona desde el navegador, sin instalar nada. La clase se graba: tendrás el vídeo disponible 30 días.",
      ),
    ],
  }),

  cancellation: (x) => {
    const d = dia(x.c.inicio, x.tz);
    const quien =
      x.c.cancelado_por === "tutor"
        ? x.c.tutor
          ? `${primerNombre(x.c.tutor)} canceló la mentoría`
          : "El tutor canceló la mentoría"
        : x.c.cancelado_por === "student"
          ? "Se canceló la mentoría"
          : "Se canceló la mentoría";
    const reembolso = dinero(x.c.reembolso, x.c.moneda);
    return {
      asunto: d ? `Se canceló tu mentoría del ${d}` : "Se canceló tu mentoría",
      familia: "alerta",
      epigrafe: "Cancelación",
      titulo: quien,
      preheader: reembolso
        ? `La clase se canceló y te devolvemos ${reembolso}.`
        : "La clase se canceló y el horario volvió a quedar libre.",
      motivo: "Recibes este correo porque tenías una reserva afectada.",
      cuerpo: [
        parrafo(
          "La clase se canceló y el horario volvió a quedar libre. Sentimos el cambio de planes.",
        ),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.tutor,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
          acento: ROJO,
          fondo: "#fdeceb",
        }),
        reembolso
          ? caja(
              `Te devolvemos <strong>${esc(reembolso)}</strong> por el mismo medio de pago. No tienes que pedirlo.`,
              "compra",
              "Tu reembolso",
            )
          : null,
        boton(
          "Buscar otro hueco",
          x.c.tutor_id ? `${x.base}/tutors/${x.c.tutor_id}` : `${x.base}/search`,
        ),
        // El botón lleva a rehacer el plan, que es lo que la persona quiere
        // hacer ahora; pero el detalle de lo que se canceló —y el reembolso—
        // vive en la reserva, y este es el único correo cuyo botón NO apunta
        // ahí. Por eso el enlace secundario.
        enlaceSecundario("Ver el detalle de la reserva cancelada", x.url),
      ],
    };
  },

  materials_ready: (x) => ({
    asunto: x.c.tutor
      ? `${primerNombre(x.c.tutor)} subió material para tu clase`
      : "Tienes material nuevo para tu clase",
    familia: "clase",
    epigrafe: "Material de clase",
    titulo: "Tienes material nuevo",
    preheader: "Tu tutor subió material para tu mentoría.",
    motivo: "Recibes este correo porque tienes una mentoría con este tutor.",
    baja: true,
    cuerpo: [
      persona(x.c.tutor, "Tu tutor"),
      parrafo("Subió material para que lo mires antes de la clase. Está en la página de tu reserva.", {
        top: 16,
      }),
      tarjetaClase({
        titulo: x.c.clase,
        tutor: x.c.tutor,
        cuando: cuando(x.c.inicio, x.tz),
        duracion: duracion(x.c.duracion_min),
      }),
      boton("Ver el material", x.url),
    ],
  }),

  recording_ready: (x) => {
    // 30 días desde la clase (US-1802 / la purga de `recordings-purge`).
    // Con la fecha ilegible se cae la frase, no el correo: `new Date(NaN)`
    // revienta en `toISOString()`, así que se comprueba antes de sumar.
    const t = typeof x.c.inicio === "string" ? new Date(x.c.inicio).getTime() : NaN;
    const borra = Number.isNaN(t)
      ? null
      : dia(new Date(t + 30 * 86_400_000).toISOString(), x.tz);
    return {
      asunto: "Ya puedes ver la grabación de tu mentoría",
      familia: "clase",
      epigrafe: "Grabación lista",
      titulo: "Tu clase, disponible 30 días",
      preheader: "La grabación está lista. Disponible 30 días desde la clase.",
      motivo: "Recibes este correo porque asististe a esta mentoría.",
      cuerpo: [
        parrafo("Ya puedes ver y descargar la grabación desde la página de tu reserva."),
        tarjetaClase({
          titulo: x.c.clase,
          tutor: x.c.tutor,
          cuando: cuando(x.c.inicio, x.tz),
          duracion: duracion(x.c.duracion_min),
        }),
        caja(
          borra
            ? `Se borra el <strong>${esc(borra)}</strong>, 30 días después de la clase. Si la quieres guardar, descárgala antes de esa fecha.`
            : "Se borra 30 días después de la clase. Si la quieres guardar, descárgala antes.",
          "clase",
          borra ? `Tienes hasta el ${borra}` : "Tienes 30 días",
        ),
        boton("Ver la grabación", x.url),
      ],
    };
  },

  // ══ D · Reseñas ═══════════════════════════════════════════════════════════

  /**
   * NTF-14 · el correo de cierre de clase. Lo pidió el cliente con la grabación
   * dentro (acta del 29-ago, ítem 12), y la frase es AFIRMATIVA porque RN-42
   * —reformulada el 2-sep— hace la grabación obligatoria y notificada: existe
   * siempre que haya habido clase.
   */
  review_request: (x) => ({
    asunto: x.c.tutor ? `¿Cómo te fue con ${primerNombre(x.c.tutor)}?` : "¿Cómo te fue la mentoría?",
    familia: "compra",
    epigrafe: "Tu opinión",
    titulo: "Puntúa tu mentoría",
    preheader: "Un minuto: puntúa tu clase y ayuda a otros alumnos a elegir.",
    motivo: "Recibes este correo porque terminaste una mentoría.",
    baja: true,
    cuerpo: [
      parrafo(
        "Tu clase terminó. Tu reseña ayuda a otros alumnos a elegir y al tutor a mejorar. Se tarda un minuto.",
      ),
      estrellas(`${x.url}/resena`),
      tarjetaClase({
        titulo: x.c.clase,
        tutor: x.c.tutor,
        cuando: cuando(x.c.inicio, x.tz),
        duracion: duracion(x.c.duracion_min),
        acento: NARANJA_FG,
        fondo: "#fff3ea",
      }),
      parrafo(
        "Y en esa misma página tienes la <strong>grabación de la clase</strong>, disponible durante 30 días.",
        { top: 18 },
      ),
      boton("Ver mi clase y escribir la reseña", `${x.url}/resena`),
    ],
  }),

  review_received_tutor: (x) => {
    const r = x.c.resena ?? {};
    const n = typeof r.rating === "number" ? Math.max(1, Math.min(5, Math.round(r.rating))) : null;
    const autor = r.autor ?? "Un alumno";
    const media =
      typeof r.media === "number" && typeof r.total === "number"
        ? `Tu media ahora: ${r.media.toFixed(1).replace(".", ",")} sobre ${r.total} reseñas`
        : null;
    return {
      asunto: n ? `${autor} te dejó ${n} ${n === 1 ? "estrella" : "estrellas"}` : "Tienes una reseña nueva",
      familia: "ok",
      epigrafe: "Reseña nueva",
      titulo: "Tienes una reseña nueva",
      preheader: n ? `${autor} te puntuó con ${n} de 5 tras la clase.` : "Un alumno te dejó una reseña.",
      motivo: "Recibes este correo porque eres tutor en Enséñame Ya.",
      baja: true,
      cuerpo: [
        importeGrande("Puntuación", n ? "★".repeat(n) + "☆".repeat(5 - n) : null, {
          sub: media,
          color: NARANJA_FG,
        }),
        cita(r.comment, autor),
        parrafo(
          "Las reseñas salen en tu ficha pública y pesan en el orden de las búsquedas.",
          { top: 18 },
        ),
        boton(
          "Ver mi ficha pública",
          x.c.tutor_id ? `${x.base}/tutors/${x.c.tutor_id}` : `${x.base}/tutor`,
        ),
      ],
    };
  },

  // ══ E · Tutor: verificación y cobros ══════════════════════════════════════

  identity_in_review: (x) => ({
    asunto: "Recibimos tus documentos",
    familia: "cuenta",
    epigrafe: "Verificación",
    titulo: "Tus documentos están en revisión",
    preheader: "Recibimos tus documentos. Los revisamos a mano en unas 48 horas.",
    motivo: "Recibes este correo porque enviaste documentos de verificación.",
    cuerpo: [
      parrafo(
        "Los tenemos. Los revisa una persona, no un robot, y solemos responder <strong>en 48 horas hábiles</strong>.",
      ),
      caja("No tienes que hacer nada más. Te escribimos en cuanto haya respuesta, sea cual sea.", "cuenta"),
      boton("Ver el estado", `${x.base}/tutor/verification`),
    ],
  }),

  /**
   * NTF-03 · ⚠️ EL ASUNTO RAMIFICA IGUAL QUE EL CUERPO. Antes era uno solo
   * —«Tu solicitud para enseñar tiene respuesta»— y eso obligaba a quien había
   * sido APROBADO a abrir el correo para saber si la noticia era buena. Un
   * asunto que oculta deliberadamente el resultado se lee como malas noticias, y
   * aquí la mitad de las veces no lo son.
   *
   * En la galería del Doc 33 son dos fichas (`tutor_review_result_ok` y `_ko`),
   * pero el id de plantilla es UNO: el que ya conocen los triggers.
   */
  tutor_review_result: (x) => {
    if (x.p?.status === "approved") {
      return {
        asunto: "Tu perfil de tutor está aprobado",
        familia: "ok",
        epigrafe: "Solicitud aprobada",
        titulo: "Ya puedes enseñar",
        preheader: "Tu perfil quedó aprobado. Publica tu primera mentoría.",
        motivo: "Recibes este correo porque solicitaste enseñar en Enséñame Ya.",
        cuerpo: [
          parrafo(
            "Revisamos tu documentación y <strong>tu perfil quedó aprobado</strong>. Ya apareces en las búsquedas y puedes recibir reservas.",
          ),
          pasos([
            ["Publica tus mentorías", "Título, precio y duración. Puedes tener varias a la vez."],
            [
              "Abre tu agenda",
              "Marca las horas en las que estás disponible; los alumnos solo ven esas.",
            ],
            ["Configura tu cobro", "PayPal o cuenta bancaria. Sin esto no podemos pagarte."],
          ]),
          boton("Ir a mi panel", `${x.base}/tutor`),
        ],
      };
    }
    return {
      asunto: "Revisamos tu solicitud para enseñar",
      familia: "alerta",
      epigrafe: "Solicitud revisada",
      titulo: "De momento no podemos aprobarla",
      preheader: x.c.motivo
        ? "Hay algo que corregir. Puedes volver a enviarlo."
        : "Revisamos tu solicitud. En tu panel están los detalles.",
      motivo: "Recibes este correo porque solicitaste enseñar en Enséñame Ya.",
      cuerpo: [
        parrafo("Revisamos tu solicitud y todavía no podemos aprobarla."),
        // El motivo lo escribe un administrador: se escapa antes de entrar al
        // HTML, como el cuerpo de `admin_message`.
        caja(
          x.c.motivo
            ? esc(x.c.motivo).replace(/\n/g, "<br>")
            : "En tu panel están los detalles y lo que puedes corregir.",
          "alerta",
          "Qué hay que corregir",
        ),
        parrafo(
          "No es un no definitivo: en cuanto lo subas otra vez lo revisamos de nuevo, normalmente en 48 horas.",
          { top: 18 },
        ),
        boton("Subir el documento otra vez", `${x.base}/tutor/verification`),
      ],
    };
  },

  payout_paid: (x) => {
    const po = x.c.payout ?? {};
    const moneda = po.moneda ?? x.p?.currency ?? x.c.moneda;
    const neto = dinero(po.neto ?? x.p?.amount ?? x.c.importe, moneda);
    const bruto = dinero(po.bruto, moneda);
    const comision = dinero(po.comision, moneda);
    const desglose: LineaPedido[] = [];
    if (bruto) {
      desglose.push({
        titulo:
          typeof po.sesiones === "number"
            ? `${po.sesiones} ${po.sesiones === 1 ? "mentoría impartida" : "mentorías impartidas"}`
            : "Mentorías impartidas",
        // ⚠️ EL PERIODO DE LA LIQUIDACIÓN VA EN UTC, no en el huso del tutor.
        // Es la única fecha del sistema que NO sigue RN-35, y a propósito: son
        // los límites contables del lote, no un momento al que nadie asiste.
        // Pintados en hora local, un lote que abre el 1 de septiembre a las
        // 00:00 UTC se lee «del 31 de agosto» para un tutor en Bogotá.
        sub: rango(po.desde, po.hasta, "UTC") ?? "",
        importe: bruto,
      });
    }
    if (comision) {
      desglose.push({ titulo: "Comisión de la plataforma", sub: "", importe: `− ${comision}` });
    }
    return {
      asunto: neto ? `Te pagamos ${neto}` : "Se pagó tu liquidación",
      familia: "ok",
      epigrafe: "Liquidación pagada",
      titulo: "Tu dinero va en camino",
      preheader: neto ? `Liquidación de ${neto} enviada a tu cuenta.` : "Tu liquidación se marcó como pagada.",
      motivo: "Recibes este correo porque eres tutor en Enséñame Ya.",
      cuerpo: [
        importeGrande("Se pagó", neto, {
          sub: x.c.cuenta ? `A tu cuenta ···· ${x.c.cuenta}` : null,
          color: VERDE,
        }),
        neto && desglose.length > 0
          ? tablaPedido(desglose, neto, {
              etiqueta: "Neto para ti",
              nota: po.ref ? `Liquidación ${po.ref}` : null,
            })
          : null,
        nota("Según el banco, la transferencia suele tardar entre 1 y 3 días hábiles en aparecer."),
        boton("Ver mis cobros", `${x.base}/tutor/payouts`),
      ],
    };
  },

  /**
   * NTF-16 · ⚠️ Hasta el Doc 33 se encolaba con `channel = 'in_app'`: un cobro
   * que falla y solo se dice en una campana no se entera nadie. Desde
   * `20260911190000` va por correo.
   */
  payout_issue: (x) => {
    const importe = dinero(x.p?.amount ?? x.c.payout?.neto ?? x.c.importe, x.p?.currency ?? x.c.payout?.moneda ?? x.c.moneda);
    return {
      asunto: "Tu liquidación no se pudo pagar",
      familia: "alerta",
      epigrafe: "Incidencia de cobro",
      titulo: "Necesitamos revisar tus datos",
      preheader: "No pudimos completar la transferencia. Revisa tus datos de cobro.",
      motivo: "Recibes este correo porque tienes una liquidación pendiente.",
      cuerpo: [
        caja(
          "No pudimos completar la transferencia con los datos de cobro que tenemos. <strong>Tu dinero no se ha perdido</strong>: está retenido y sale en cuanto los revises.",
          "alerta",
          "Qué pasó",
        ),
        importeGrande("Retenido", importe, { sub: x.c.payout?.ref ? `Liquidación ${x.c.payout.ref}` : null }),
        boton("Revisar mis datos de cobro", `${x.base}/tutor/payouts`),
        nota("Si los datos son correctos y sigue fallando, escríbenos y lo miramos contigo."),
      ],
    };
  },

  /**
   * NTF-23 · el aviso de que el dinero salió y NO ha llegado.
   *
   * ⚠️ POR QUÉ EXISTE: PayPal deja un payout en `UNCLAIMED` cuando el correo del
   * destinatario no es el de una cuenta suya confirmada. Lo retiene 30 días y
   * después lo devuelve. Sin este correo el tutor no se entera: en su panel el
   * cobro figura como enviado —que es verdad— y el dinero no aparece.
   *
   * 🔴 Y POR QUÉ RAMIFICA POR PROVEEDOR (7-sep-2026). El barrido que lo encola
   * (`avisar_payouts_sin_reclamar`) no filtra por riel a propósito, y con Wise
   * pagando (`20260907120000`) un tutor colombiano con cuenta bancaria recibía
   * un correo diciéndole que revisara el correo de su cuenta de PayPal, que no
   * tiene, por un dinero que en su riel nadie tiene que reclamar.
   *
   * ⚠️ SIN `provider` SE TRATA COMO «NO ES PAYPAL», y es lo correcto: el cuerpo
   * neutro es cierto en cualquier riel —incluido PayPal— y el de PayPal solo lo
   * es en PayPal. `payouts.provider` es nullable (riel manual, reintento del
   * admin).
   *
   * ⚠️ Y NINGUNO DE LOS DOS AFIRMA QUE EL DINERO SE ENVIÓ: en PayPal el lote
   * sale en `SUCCESS`, pero en Wise la transferencia está creada y el dinero NO
   * ha salido hasta que se fondea.
   */
  payout_unclaimed: (x) => {
    const importe = dinero(x.p?.amount ?? x.c.importe, x.p?.currency ?? x.c.moneda);
    const dias = x.p?.dias ?? x.c.dias;
    const tiempo = typeof dias === "number" ? `Lleva más de ${dias} días en curso` : "Lleva varios días en curso";

    if (x.p?.provider === "paypal") {
      return {
        asunto: "Tu liquidación está esperando a que la reclames",
        familia: "alerta",
        epigrafe: "Pago sin reclamar",
        titulo: "PayPal no ha entregado tu dinero",
        preheader: `Tu liquidación ${tiempo.toLowerCase()} y no ha llegado a tu cuenta de PayPal.`,
        motivo: "Recibes este correo porque tienes una liquidación en curso.",
        cuerpo: [
          importeGrande("Sin reclamar", importe, { sub: tiempo, color: ROJO }),
          parrafo(
            "Suele pasar cuando el correo que nos diste no es el de tu cuenta de PayPal, o cuando aún no has entrado a aceptar el pago.",
            { top: 20 },
          ),
          caja(
            "Si nadie lo reclama, <strong>PayPal nos lo devuelve a los 30 días</strong> y tendremos que pagártelo de otra forma.",
            "alerta",
          ),
          boton("Revisar mis datos de cobro", `${x.base}/tutor/payouts`),
        ],
      };
    }

    // El resto de rieles: banco (Wise, dLocal), cuenta conectada de Stripe, riel
    // manual. En ninguno hay nada que reclamar ni datos que revisar —los que dio
    // ya sirvieron para emitir la orden—, así que pedírselo sería mandarlo a
    // arreglar algo que no está roto.
    return {
      asunto: "Tu liquidación está tardando más de lo normal",
      familia: "alerta",
      epigrafe: "Pago en curso",
      titulo: "Lo estamos siguiendo",
      preheader: `Tu liquidación ${tiempo.toLowerCase()}. No tienes que hacer nada.`,
      motivo: "Recibes este correo porque tienes una liquidación en curso.",
      cuerpo: [
        importeGrande("En curso", importe, { sub: tiempo, color: ROJO }),
        caja(
          "La orden está emitida y la estamos siguiendo. <strong>No tienes que hacer nada por tu parte.</strong> Te avisamos en cuanto se cierre.",
          "alerta",
        ),
        parrafo("Si sigue sin aparecer, escríbenos y la revisamos contigo.", { top: 18 }),
        boton("Ver mis cobros", `${x.base}/tutor/payouts`),
      ],
    };
  },

  /**
   * El hueco de seguridad que el Doc 33 señala como el más claro que quedaba:
   * hasta hoy se podía cambiar la cuenta a la que se manda el dinero sin que el
   * dueño recibiera una sola señal.
   *
   * ⚠️ EL PLIEGO PEDÍA ENVÍO DIRECTO Y ESTO VA POR LA COLA. Es una rebaja
   * consciente, no un descuido. Las tres vías que cambian el destino del dinero
   * —`upsert_payout_account`, `upsert_manual_destination` y
   * `conectar_cuenta_paypal`— las llama el NAVEGADOR contra PostgREST: no hay
   * un punto de servidor donde colgar un `sendEmail` sin reescribir dos
   * formularios, y un envío disparado desde el formulario se puede saltar. Los
   * dos triggers de `20260911190000` cubren las tres y no se pueden saltar.
   *
   * El precio es la cadencia: la cola la vacía un job que en producción entrega
   * cada 2-6 horas. Subirlo a inmediato es acelerar el reloj de
   * `notifications-send`, no cambiar esto.
   *
   * La clave de idempotencia lleva un hash del destino, así que reguardar la
   * misma cuenta NO manda correo y cambiarla SÍ.
   */
  payout_account_changed: (x) => {
    // A una variable antes de mirarla: el payload es `Record<string, unknown>` y
    // el estrechamiento no sobrevive de otra forma (igual que en `admin_message`).
    const d = x.p?.destino;
    const destino = typeof d === "string" && d.trim() ? esc(d.trim()) : "Tu nueva cuenta de cobro";
    const hoy = may(fmt(x.ahora.toISOString(), x.tz, { day: "numeric", month: "long" }));
    return {
    asunto: "Cambiaste tu cuenta de cobro",
    familia: "alerta",
    epigrafe: "Aviso de seguridad",
    titulo: "Tu dinero irá a otra cuenta",
    preheader: "Se cambió la cuenta de cobro de tu perfil de tutor.",
    motivo: "Recibes este correo porque se cambiaron los datos de cobro de tu cuenta.",
    cuerpo: [
      parrafo(
        "Acabamos de registrar un cambio en tus datos de cobro. A partir de la próxima liquidación, tu dinero irá aquí:",
      ),
      caja(
        destino +
          (x.c.cuenta ? ` · cuenta terminada en <strong>${esc(x.c.cuenta)}</strong>` : "") +
          (hoy ? `<br><span style="color:#5b6270">Cambiado el ${esc(hoy)}</span>` : ""),
        "cuenta",
      ),
      caja(
        "<strong>Si no fuiste tú</strong>, escríbenos ahora mismo: podemos congelar los pagos de tu cuenta mientras lo revisamos.",
        "alerta",
      ),
      boton("No fui yo", SOPORTE),
    ],
    };
  },

  // ══ F · Baja de cuenta ════════════════════════════════════════════════════

  /**
   * ⚠️ ESTE TEXTO NO DICE UNA FECHA, Y ES A PROPÓSITO.
   *
   * La galería del Doc 33 lo pintaba como «Tu cuenta se cerrará el 24 de
   * septiembre» y «tienes 14 días para arrepentirte». Ese plazo NO EXISTE en el
   * código: `request_account_deletion` desactiva la cuenta y la deja
   * `programada`, y `process_pending_account_deletions` la completa el día que
   * `account_deletion_blockers` se queda vacío —o sea cuando no quede dinero en
   * vuelo—, no cuando venza un contador (`20260831160000`). Los dos números que
   * aparecen en esa migración son otra cosa: 30 días es cuándo una petición
   * cuenta como «estancada» en el informe, y 7 días es la retención de
   * liquidación de un payout.
   *
   * Prometer una fecha que el barrido no honra sería peor que no dar ninguna:
   * la persona la apuntaría y volvería ese día a una cuenta que sigue ahí. Se
   * dice lo que sí es cierto —queda desactivada YA y se puede deshacer mientras
   * no se complete—, y se nombra la única condición real.
   */
  account_deletion_requested: (x) => ({
    asunto: "Recibimos tu solicitud de baja",
    familia: "cuenta",
    epigrafe: "Baja de cuenta",
    titulo: "Tu cuenta queda desactivada",
    preheader: "Tu cuenta ya está desactivada. Puedes cancelarlo mientras no se complete.",
    motivo: "Recibes este correo porque se pidió dar de baja esta cuenta.",
    cuerpo: [
      parrafo(
        "Recibimos tu solicitud. Tu cuenta queda <strong>desactivada desde ahora</strong>: no aparece en la plataforma y nadie puede reservarte ni escribirte.",
      ),
      caja(
        "El borrado definitivo se hace cuando no quede ningún pago ni liquidación en curso — normalmente unos días. <strong>Hasta entonces puedes echarte atrás y recuperarlo todo.</strong> Después no: los datos se anonimizan y no hay vuelta.",
        "cuenta",
        "Todavía puedes arrepentirte",
      ),
      parrafo(
        "Lo que queda por ley: las facturas y el rastro de los pagos, que no podemos borrar. Todo lo demás desaparece.",
        { top: 18 },
      ),
      boton("Cancelar la baja y volver", `${x.base}/account`),
    ],
  }),

  /**
   * ⚠️ SE MANDA A UNA DIRECCIÓN QUE EL BARRIDO ACABA DE ANONIMIZAR. Hay que
   * capturarla ANTES de llamar a `anonymize_account` y enviarla directo: la fila
   * del perfil ya no sirve para nada, y la cola tampoco (el `recipient_id`
   * seguiría existiendo pero sin correo al que escribir).
   */
  account_deletion_done: (x) => ({
    asunto: "Tu cuenta de Enséñame Ya se cerró",
    familia: "cuenta",
    epigrafe: "Baja completada",
    titulo: "Hasta aquí",
    preheader: "Tu cuenta se cerró y tus datos se anonimizaron.",
    motivo: "Recibes este correo porque tenías una cuenta en Enséñame Ya.",
    cuerpo: [
      parrafo(
        "Tu cuenta se cerró y tus datos personales quedaron anonimizados, como pediste. Este es el último correo que recibirás de nosotros.",
      ),
      parrafo(
        "Se conservan únicamente los registros contables que la ley obliga a guardar: importes y fechas de los pagos, sin tu nombre asociado.",
        { top: 14 },
      ),
      parrafo(
        "Gracias por el tiempo que estuviste. Si algún día vuelves, puedes registrarte de nuevo con este mismo correo.",
        { top: 14 },
      ),
      boton("Volver a Enséñame Ya", x.base),
    ],
  }),

  // ══ G · Mensajes ══════════════════════════════════════════════════════════

  /**
   * NTF-21 · ⚠️ NI EL MENSAJE NI QUIÉN LO ESCRIBE. El payload que deja el
   * trigger trae solo el id del hilo, a propósito (`20260826160000`): un correo
   * se reenvía y se queda en bandejas ajenas, y el chat tiene purga a 30 días
   * dentro de la app y ninguna fuera. El correo nuevo tampoco lo dice — y ahora
   * además lo explica, que es la diferencia entre parecer escueto y ser
   * deliberado.
   */
  new_message: (x) => ({
    asunto: "Tienes un mensaje nuevo",
    familia: "clase",
    epigrafe: "Mensaje",
    titulo: "Te escribieron por el chat",
    preheader: "Tienes un mensaje sin leer en Enséñame Ya.",
    motivo: "Recibes este correo porque tienes una conversación abierta.",
    baja: true,
    cuerpo: [
      parrafo(
        "Alguien te escribió por el chat de Enséñame Ya. Puedes leerlo y responder desde la plataforma.",
      ),
      nota(
        "Por privacidad no reproducimos el mensaje aquí: los correos se reenvían y se quedan en bandejas ajenas.",
      ),
      boton("Abrir la conversación", x.url),
    ],
  }),

  /**
   * NTF-22 · ⚠️ LA ÚNICA PLANTILLA CON CUERPO LIBRE. Las demás son literales de
   * este fichero; esta la escribe el administrador desde la bandeja de
   * moderación y viaja en el payload (`admin_contact_user`). Por eso se escapa
   * aquí antes de entrar en la caja, y los saltos de línea se convierten en
   * `<br>` DESPUÉS de escapar.
   *
   * Se cae a una frase neutra si el payload viniera sin texto: un correo con el
   * cuerpo vacío es peor que uno que dice poco, y la RPC ya rechaza el mensaje
   * en blanco, así que esto es solo el cinturón.
   */
  admin_message: (x) => {
    // A una variable antes de mirarla: el payload es `Record<string, unknown>` y
    // solo así el estrechamiento a `string` sobrevive al ternario.
    const m = x.p?.mensaje;
    const texto =
      typeof m === "string" && m.trim()
        ? esc(m.trim()).replace(/\n/g, "<br>")
        : "El equipo de Enséñame Ya quiere hablar contigo sobre tu cuenta.";
    return {
      asunto: "Un mensaje del equipo de Enséñame Ya",
      familia: "cuenta",
      epigrafe: "Mensaje del equipo",
      titulo: "Queremos hablar contigo",
      preheader: "El equipo de Enséñame Ya te escribió sobre tu cuenta.",
      motivo: "Recibes este correo porque tienes una cuenta en la plataforma.",
      cuerpo: [caja(texto, "cuenta"), boton("Entrar a mi cuenta", x.url)],
    };
  },

  /** Acuse a quien escribe por el formulario. Envío directo, en el mismo `after()`. */
  contact_ack: (x) => {
    const co = x.c.contacto ?? {};
    return {
      asunto: "Recibimos tu mensaje",
      familia: "cuenta",
      epigrafe: "Soporte",
      titulo: "Tu mensaje llegó",
      preheader: "Recibimos tu mensaje. Respondemos en menos de 24 horas hábiles.",
      motivo: "Recibes este correo porque escribiste al formulario de contacto.",
      cuerpo: [
        parrafo(
          "Gracias por escribirnos. Una persona lo lee y te responde a esta misma dirección, normalmente <strong>en menos de 24 horas hábiles</strong>.",
        ),
        cita(co.mensaje, co.recibido ? `Tu mensaje del ${co.recibido}` : "Tu mensaje"),
        nota(
          "Si mientras tanto se resuelve solo, no hace falta que nos avises: cerramos el aviso al responderte.",
        ),
      ],
    };
  },

  /** El correo interno a `info@`. No saluda a nadie: no va a una persona. */
  contact_internal: (x) => {
    const co = x.c.contacto ?? {};
    const adj = co.adjuntos ?? [];
    return {
      asunto: `Contacto web (${(co.tipo ?? "mensaje").toLowerCase()}) — ${co.nombre ?? "sin nombre"}`,
      familia: "cuenta",
      epigrafe: "Bandeja de contacto",
      titulo: "Mensaje nuevo del formulario",
      preheader: [co.tipo, co.nombre, co.sesion].filter(Boolean).join(" · "),
      motivo: "Este correo es interno: lo genera el formulario de contacto del sitio.",
      saludo: null,
      cuerpo: [
        ficha(
          co.nombre ?? "Mensaje del formulario",
          [
            ["Correo", co.correo],
            ["Tipo", co.tipo],
            ["Sesión", co.sesion],
            ["Recibido", co.recibido],
          ],
          TINTA,
          "#f3f4f7",
        ),
        cita(co.mensaje, "Mensaje íntegro"),
        nota(
          (adj.length > 0
            ? `${adj.length} ${adj.length === 1 ? "adjunto" : "adjuntos"}: ` +
              adj
                .map((a) => `<strong>${esc(a.nombre ?? "archivo")}</strong>${a.tamano ? ` (${esc(a.tamano)})` : ""}`)
                .join(" · ") +
              ". Están en el bucket privado, no en este correo.<br>"
            : "") + "Pulsa «Responder» para contestarle directamente.",
        ),
        boton("Abrir en el panel", `${x.base}/admin/reportes`),
      ],
    };
  },

  // ══ H · Admin ═════════════════════════════════════════════════════════════

  /**
   * NTF-13 · ⚠️ AGRUPADO POR FUERZA. Una incidencia por correo convierte un mal
   * día del PSP en cien correos; un resumen por hora con lo acumulado es lo que
   * se puede leer. Lo encola `/api/cron/alertas-resumen`, que es quien sabe qué
   * cuenta como incidencia (el criterio vive en `lib/admin/alertas.ts`), y si en
   * la ventana no hubo nada NO encola: un «0 incidencias» cada hora es la forma
   * más rápida de que el aviso acabe en una carpeta.
   */
  admin_alert: (x) => {
    // ⚠️ Éste es el único que lee sus datos del PAYLOAD y no del contexto, y
    // tiene motivo: una incidencia no es una reserva ni un payout ni un pedido,
    // así que `pending_email_notifications` no tiene por dónde resolverla. El
    // resumen ya viene montado desde `/api/cron/alertas-resumen`, que es quien
    // sabe qué cuenta como alerta (el criterio vive en `lib/admin/alertas.ts`).
    const al = (x.c.alertas ?? (x.p?.alertas as Contexto["alertas"]) ?? {}) as NonNullable<
      Contexto["alertas"]
    >;
    const ls = lineas(al.lineas, al.moneda);
    const total = dinero(al.total, al.moneda);
    const n = ls.length;
    return {
      asunto: n === 1 ? "1 incidencia necesita revisión" : `${n} incidencias necesitan revisión`,
      familia: "alerta",
      epigrafe: "Alerta operativa",
      titulo: "Resumen de incidencias · última hora",
      preheader: `${n} ${n === 1 ? "incidencia detectada" : "incidencias detectadas"} en la última hora.`,
      motivo: "Este correo es interno: lo reciben las cuentas con rol de administrador.",
      saludo: null,
      cuerpo: [
        total
          ? tablaPedido(ls, total, {
              etiqueta: "Importe afectado",
              nota: rango(al.desde, al.hasta, "UTC", { conHora: true }),
            })
          : parrafo(`Hay ${n} ${n === 1 ? "incidencia" : "incidencias"} sin revisar en el panel.`),
        boton("Abrir el panel de alertas", `${x.base}/admin/alertas`),
      ],
    };
  },

  // ══ I · Recompensas y regalos ═════════════════════════════════════════════
  //
  // Las siete que encola `20260912110000`. Son la MISMA fila de `credits` vista
  // desde tres sitios —la recompensa que gana quien invita, el regalo que
  // alguien compra, y la caducidad de cualquiera de los dos—: lo único que
  // cambia entre ellas es QUIÉN PUSO EL DINERO (`source`) y POR DÓNDE SALE
  // (`destino`).
  //
  // ⚠️ NINGUNA DE LAS SIETE PUEDE NOMBRAR LA MENTORÍA, Y NO ES UN OLVIDO. El
  // contexto lo resuelve `pending_email_notifications` colgando de
  // `payload->>'booking_id'` (`20260911170000`, el lateral de la reserva), y un
  // crédito NO TIENE RESERVA todavía — ese es justo el punto del regalo: se
  // agenda después. Lo que el payload trae es `product_id`, que sirve de ENLACE
  // (`/products/<id>` es público) pero NO de texto: un uuid no se le enseña a
  // nadie. Así que estos correos dicen «una mentoría» en genérico, que es lo
  // único cierto. El día que ese lateral aprenda a resolver un `product_id`
  // suelto, aquí ya hay `ficha`/`tarjetaClase` esperando.
  //
  // ⚠️ Y NINGUNA ES «NO ESENCIAL» (`baja`), a diferencia de los siete correos
  // que sí lo son. Estos hablan de dinero y de bienes que YA son de quien los
  // lee —ganó una recompensa, le regalaron una mentoría, algo suyo caduca—, no
  // de promoción. El día que S-49 exista, no son estos los que se apagan.

  /**
   * NTF-31 · la recompensa que la campaña de referidos promete al REFERIDOR.
   *
   * Tres formas y una sola fila, exactamente como las pinta `/referidos`
   * (`recompensaDe`), y con el mismo orden de lectura: **`destino` manda sobre
   * `kind`**, porque se congela al emitir y es lo que decide si esto se gasta o
   * si llega solo. Derivarlo del rol al escribir sería contradecir a la base.
   *
   *   · `destino = 'payout'` → el TUTOR. Se suma a su liquidación y **no tiene
   *     fecha de caducidad** (`credits_payout_no_caduca` prohíbe ponérsela), así
   *     que este correo no le pide nada: pedirle que canjee algo que le llega
   *     solo es mandarlo a arreglar lo que no está roto.
   *   · `kind = 'mentoria'` → una mentoría gratis con TOPE. `amount` es el
   *     MÁXIMO, no un saldo: `credito_aplicable` rechaza la mentoría que lo
   *     supere («esta mentoría supera el tope de tu recompensa») y el sobrante
   *     de una más barata es de la plataforma. Decirlo aquí es lo que evita la
   *     sorpresa en el checkout.
   *   · `kind = 'saldo'` → dinero que se descuenta en el cobro; se paga la
   *     diferencia.
   *
   * ⚠️ EL PAYLOAD NO TRAE `expires_at`, así que este correo NO DICE LA FECHA.
   * Teclear «30 días» aquí sería copiar el `reward_expires_days` de la campaña
   * a un sitio donde nadie lo va a actualizar el día que el cliente lo cambie;
   * la fecha exacta la tiene `/referidos`, y NTF-32 la dice cuando se acerca.
   */
  reward_earned: (x) => {
    const importe = dinero(x.p?.amount, x.p?.currency);

    if (x.p?.destino === "payout") {
      return {
        asunto: con("Ganaste una recompensa por invitar", importe),
        familia: "ok",
        epigrafe: "Invita y gana",
        titulo: "Tu invitación ya cuenta",
        preheader: importe
          ? `${importe} que se suman solos a tu próximo cobro.`
          : "Tu recompensa se suma sola a tu próximo cobro.",
        motivo: "Recibes este correo porque alguien entró en Enséñame Ya con tu invitación.",
        cuerpo: [
          parrafo(
            "La persona que invitaste ya cumplió lo que pedía la campaña, así que la recompensa es tuya.",
          ),
          importeGrande("Tu recompensa", importe, {
            sub: "Se suma a tu próximo cobro",
            color: VERDE,
          }),
          caja(
            "<strong>No tienes que hacer nada.</strong> Se suma sola a tu próxima liquidación: no hay nada que canjear ni que reservar, y no tiene fecha de caducidad.",
            "ok",
          ),
          boton("Ver mis cobros", `${x.base}/tutor/payouts#saldo`),
          enlaceSecundario("Seguir invitando", `${x.base}/referidos`),
        ],
      };
    }

    const mentoria = x.p?.kind === "mentoria";
    const saldo = x.p?.kind === "saldo";
    return {
      asunto: mentoria
        ? "Ganaste una mentoría gratis"
        : con(saldo ? "Ganaste saldo por invitar" : "Ganaste una recompensa por invitar", importe),
      familia: "ok",
      epigrafe: "Invita y gana",
      titulo: "Tu invitación ya cuenta",
      preheader: mentoria
        ? "Tienes una mentoría gratis esperándote."
        : importe
          ? `${importe} para tus próximas mentorías.`
          : "Tienes una recompensa esperándote.",
      motivo: "Recibes este correo porque alguien entró en Enséñame Ya con tu invitación.",
      cuerpo: [
        parrafo(
          "La persona que invitaste ya cumplió lo que pedía la campaña, así que la recompensa es tuya.",
        ),
        // ⚠️ La ETIQUETA cambia con `kind` y no es cosmética: el mismo número es
        // un tope con `mentoria` y dinero gastable con `saldo`. «US$ 24,00» a
        // secas encima de una mentoría gratis se lee como un precio.
        importeGrande(mentoria ? "Vale por una mentoría de hasta" : "Tu recompensa", importe, {
          sub: mentoria ? null : "Para tus próximas mentorías",
          color: VERDE,
        }),
        mentoria
          ? caja(
              "Se canjea <strong>entera y en una sola mentoría</strong>: no se puede aplicar a una que cueste más que ese tope, y si eliges una más barata la diferencia no se guarda. En un paquete de varias sesiones cubre una y pagas el resto.",
              "ok",
            )
          : saldo
            ? caja(
                "Se descuenta al reservar: <strong>pagas solo la diferencia</strong>. Puedes repartirlo entre varias mentorías hasta agotarlo.",
                "ok",
              )
            : null,
        nota(
          "Tu recompensa tiene fecha de caducidad: la ves en «Invita y gana» y te avisamos antes de que venza.",
        ),
        boton(
          mentoria ? "Reservar mi mentoría gratis" : saldo ? "Usar mi saldo" : "Ver mi recompensa",
          mentoria || saldo ? `${x.base}/agendar` : `${x.base}/referidos`,
        ),
        enlaceSecundario("Ver todas mis recompensas", `${x.base}/referidos`),
      ],
    };
  },

  /**
   * NTF-32 · a 7 días y a 1 día. `dias` trae el TRAMO (1 o 7) y es lo que hace
   * que sean dos correos como mucho por crédito, por muchas pasadas que dé el
   * barrido: la clave de idempotencia lo lleva dentro (`CRED:exp7` / `CRED:exp1`).
   *
   * ⚠️ Aquí NUNCA aterriza un tutor con `destino = 'payout'`: ese crédito no
   * tiene `expires_at` y `avisar_creditos_por_expirar` filtra por fecha. Por eso
   * el cuerpo puede hablar de canjear sin condicionarlo — y por eso `destino` no
   * hace falta en este payload.
   */
  reward_expiring: (x) => {
    const importe = dinero(x.p?.restante, x.p?.currency);
    const mentoria = x.p?.kind === "mentoria";
    const saldo = x.p?.kind === "saldo";
    // Dos constantes y no un `may()`: `may` devuelve `string | null` y un null
    // dentro de una plantilla de texto se imprime como «null» — que es justo lo
    // que el check de contexto vacío persigue.
    const Que = mentoria ? "Tu mentoría gratis" : saldo ? "Tu saldo" : "Tu recompensa";
    const tramo = x.p?.dias;
    // ⚠️ `plazo` sale de `expires_at`, NO del `dias` del payload: ver
    // `plazoDeCaducidad`. El tramo es solo el respaldo.
    const plazo = plazoDeCaducidad(
      x.p?.expires_at,
      typeof tramo === "number" ? tramo : null,
      x.tz,
      x.ahora,
    );
    // El día de la caducidad, EN EL HUSO DE QUIEN LEE (RN-35): una fecha que
    // cambia de día seis husos más allá es peor que ninguna.
    const fecha = dia(x.p?.expires_at, x.tz);
    return {
      asunto: plazo ? `${Que} caduca ${plazo}` : `${Que} está a punto de caducar`,
      familia: "alerta",
      epigrafe: "Caduca pronto",
      titulo: plazo === "hoy" ? "Caduca hoy" : plazo === "mañana" ? "Te queda un día" : "Se te acaba el plazo",
      preheader: fecha
        ? `${Que} caduca el ${fecha} y sigue sin usarse.`
        : `${Que} está a punto de caducar y sigue sin usarse.`,
      motivo: "Recibes este correo porque tienes una recompensa a punto de caducar.",
      cuerpo: [
        parrafo(
          `${Que} sigue sin usarse y caduca ${plazo ?? "pronto"}. Cuando venza no se puede recuperar.`,
        ),
        importeGrande(mentoria ? "Vale por una mentoría de hasta" : "Te queda", importe, {
          sub: fecha ? `Caduca el ${fecha}` : null,
          color: ROJO,
        }),
        mentoria
          ? caja(
              "Se canjea entera y en una sola mentoría, así que basta con que reserves una que no pase de ese tope.",
              "alerta",
            )
          : saldo
            ? caja(
                "Se descuenta al reservar: <strong>pagas solo la diferencia</strong>.",
                "alerta",
              )
            : null,
        boton(
          mentoria ? "Reservar mi mentoría gratis" : saldo ? "Usar mi saldo" : "Usar mi recompensa",
          `${x.base}/agendar`,
        ),
        enlaceSecundario("Ver mis recompensas", `${x.base}/referidos`),
      ],
    };
  },

  /**
   * NTF-33 · caducó.
   *
   * ⚠️ NO DICE EL IMPORTE, Y ES DELIBERADO. El payload trae `amount` y
   * `currency` pero **no trae `kind`**, y sin `kind` ese número no significa lo
   * mismo: con `saldo` es dinero que se podía gastar, y con `mentoria` es un
   * TOPE que nunca fue dinero de nadie. «Caducaron US$ 24,00» es falso en la
   * mitad de los casos y suena a deuda en la otra mitad, así que no se pinta. El
   * día que el barrido encole también `kind`, la cifra puede volver: el bloque
   * que la pintaría está escrito ahí arriba, en NTF-32.
   */
  reward_expired: (x) => ({
    asunto: "Tu recompensa caducó sin usarse",
    familia: "cuenta",
    epigrafe: "Recompensa caducada",
    titulo: "Se pasó el plazo",
    preheader: "La recompensa que ganaste por invitar venció sin usarse.",
    motivo: "Recibes este correo porque una recompensa de tu cuenta acaba de caducar.",
    cuerpo: [
      parrafo(
        "La recompensa que ganaste por invitar a alguien venció sin usarse, así que ya no se puede canjear.",
      ),
      caja(
        "Las recompensas cuentan su plazo desde el día en que se ganan, y una vez vencidas no se pueden reactivar.",
        "cuenta",
      ),
      parrafo(
        "Puedes ganar otra: cada persona que entre con tu enlace y cumpla lo que pide la campaña te da una recompensa nueva.",
        { top: 18 },
      ),
      boton("Volver a invitar", `${x.base}/referidos`),
    ],
  }),

  /**
   * NTF-34 · el recibo del regalo, a QUIEN LO PAGÓ.
   *
   * La dirección del destinatario SÍ se pinta, al revés que en el resto de
   * correos: es el dato que el comprador necesita comprobar —una letra de más y
   * el regalo espera en un buzón que no existe— y es su propio dato volviendo a
   * él. Va por `ficha`, que escapa lo que recibe.
   *
   * ⚠️ No dice «le hemos avisado». `confirm_gift_payment` solo encola NTF-35
   * cuando el destinatario YA tiene cuenta con el correo confirmado; en el otro
   * camino lo manda el Route Handler con Resend, y desde aquí no se puede saber
   * cuál de los dos ocurrió. Lo que sí es cierto siempre —y es lo que se
   * escribe— es que el regalo espera atado a esa dirección.
   */
  gift_purchased: (x) => {
    const importe = dinero(x.p?.amount, x.p?.currency);
    // A una variable antes de mirarla: el payload es `Record<string, unknown>` y
    // el estrechamiento no sobrevive de otra forma (igual que `admin_message`).
    const destinatario = x.p?.recipient_email;
    const para =
      typeof destinatario === "string" && destinatario.trim() ? destinatario.trim() : null;
    const producto = x.p?.product_id;
    const idProducto = typeof producto === "string" && producto ? producto : null;
    return {
      asunto: con("Gracias por tu regalo", importe),
      familia: "compra",
      epigrafe: "Recibo del regalo",
      titulo: "Tu regalo ya está activo",
      preheader: para
        ? `${para} ya puede elegir día y hora.`
        : "Quien lo recibe ya puede elegir día y hora.",
      motivo: "Recibes este correo porque regalaste una mentoría en Enséñame Ya.",
      cuerpo: [
        parrafo(
          "Tu pago quedó registrado y el regalo está activo. Quien lo recibe elige el día y la hora que le vengan bien, y tú no tienes que hacer nada más.",
        ),
        ficha(
          "Tu regalo",
          [
            ["Para", para],
            ["Importe", importe],
          ],
          NARANJA_FG,
          "#fff3ea",
        ),
        caja(
          "Si esa dirección todavía no tiene cuenta en Enséñame Ya, el regalo <strong>la espera igualmente</strong>: en cuanto se registre con ese mismo correo, le aparecerá en «Mis reservas».",
          "compra",
        ),
        nota(
          "El regalo tiene fecha de caducidad y la ves en «Mis regalos». Te avisamos antes de que venza.",
        ),
        boton("Ver mis regalos", `${x.base}/regalar/mis-regalos`),
        idProducto
          ? enlaceSecundario("Ver la mentoría que regalaste", `${x.base}/products/${idProducto}`)
          : null,
      ],
    };
  },

  /**
   * NTF-35 · a QUIEN LO RECIBE, y la única plantilla del proyecto que puede
   * aterrizar en una bandeja SIN CUENTA: `confirm_gift_payment` solo la encola
   * cuando el destinatario ya existe con el correo confirmado, y el resto de las
   * veces la manda el Route Handler con Resend —mismo caso y mismo patrón que
   * `guest_account_created`— usando esta misma plantilla.
   *
   * ─── A DÓNDE LLEVA, Y POR QUÉ A `/reservas` AUNQUE TENGA GUARDA ────────────
   *
   * La regla de oro 13 —la pantalla en blanco— es de las navegaciones de
   * CLIENTE que cruzan de grupo de rutas. Un enlace de correo NO es eso: es
   * siempre una carga de documento nueva, así que la guarda se resuelve como lo
   * que es, un redirect del servidor, y la cadena entera termina donde tiene que
   * terminar:
   *
   *   `/reservas` → `requireUser()` → `/login?next=/reservas` →
   *   `redirect(hrefSignup("/reservas"))` → `/signup?next=/reservas` → alta →
   *   `/reservas`
   *
   * —y `/reservas` es justo la pantalla que llama a `reclamar_mis_regalos()` al
   * pintarse, así que el regalo aparece solo. `/login` rebota a `/signup`
   * cuando trae `next` a propósito (M-05): quien llega ahí empujado por una
   * guarda no suele tener cuenta, que es exactamente este caso.
   *
   * ⚠️ Lo que ese rebote NO puede decirle a nadie es la ÚNICA instrucción que
   * de verdad importa —**con ESTA misma dirección**, porque
   * `reclamar_regalos_por_correo` ata por `lower(btrim(email))` y un alta con
   * otro correo deja el regalo huérfano—. Por eso va escrita en el cuerpo, con
   * su propio enlace a `/signup`, que sí es público y no tiene guarda ninguna.
   *
   * ⚠️ DE QUIÉN VIENE NO SE PUEDE DECIR, y no es un olvido: `mis_creditos` no
   * expone `purchased_by`, y aunque lo hiciera sería un uuid sin nombre que
   * leer. El único rastro de quien regala es la DEDICATORIA, y ahí es donde la
   * gente firma — misma decisión y mismo motivo que en
   * `components/regalo/regalo-recibido.tsx`.
   */
  gift_received: (x) => {
    const producto = x.p?.product_id;
    const idProducto = typeof producto === "string" && producto ? producto : null;
    // Texto libre de un desconocido: `cita` lo escapa y convierte los saltos de
    // línea DESPUÉS de escapar. No se toca aquí.
    const dedicatoria = x.p?.gift_message;
    return {
      asunto: "Te han regalado una mentoría",
      familia: "ok",
      epigrafe: "Un regalo para ti",
      titulo: "Alguien te regaló una mentoría",
      preheader: "Ya está pagada: solo tienes que elegir el día y la hora.",
      motivo: "Recibes este correo porque alguien regaló una mentoría a esta dirección.",
      cuerpo: [
        parrafo(
          "Alguien ha pagado por ti una mentoría <strong>1 a 1 en vivo</strong> en Enséñame Ya. Está pagada entera: eliges el día y la hora que te vengan bien y no tienes que pagar nada.",
        ),
        cita(typeof dedicatoria === "string" ? dedicatoria : null, "Quien te lo regala"),
        caja(
          "La verás en <strong>«Mis reservas»</strong> como un regalo pendiente de agendar. Desde ahí eliges horario, y el día de la clase entras a la videollamada por el mismo sitio.",
          "ok",
        ),
        boton("Ver mi regalo", `${x.base}/reservas`),
        caja(
          "¿Es tu primera vez en Enséñame Ya? Crea tu cuenta <strong>con esta misma dirección de correo</strong>: es lo que ata el regalo a tu cuenta, y aparecerá solo.",
          "cuenta",
        ),
        enlaceSecundario("Crear mi cuenta", `${x.base}/signup?next=/reservas`),
        idProducto
          ? enlaceSecundario("Ver la mentoría que te regalaron", `${x.base}/products/${idProducto}`)
          : null,
        nota("El regalo tiene fecha de caducidad: agéndalo con tiempo. Te avisamos antes de que venza."),
      ],
    };
  },

  /**
   * NTF-36 · el regalo caduca, a 7 días y a 1 día.
   *
   * ⚠️ ESTE CORREO NO SABE A QUIÉN LE HABLA, y el texto está escrito con eso
   * delante. `avisar_creditos_por_expirar` lo encola a
   * `coalesce(beneficiary_id, purchased_by)`: al DESTINATARIO si ya reclamó el
   * regalo, y a QUIEN LO PAGÓ mientras siga sin reclamar. Los dos payloads son
   * idénticos, así que distinguirlos aquí es imposible por construcción — el
   * mismo caso que `booking_reminder_24h` (ver su ⚠️ en `rutaFor`). De ahí que
   * el cuerpo diga las dos cosas y cada uno lea la suya: adivinar sería acertar
   * la mitad de las veces y mandar a la otra mitad a una pantalla vacía.
   */
  gift_expiring: (x) => {
    const tramo = x.p?.dias;
    // Mismo criterio que NTF-32: manda `expires_at` en el huso de quien lee, y
    // el tramo del payload solo cubre la fecha ilegible (ver `plazoDeCaducidad`).
    const plazo = plazoDeCaducidad(
      x.p?.expires_at,
      typeof tramo === "number" ? tramo : null,
      x.tz,
      x.ahora,
    );
    const fecha = dia(x.p?.expires_at, x.tz);
    const producto = x.p?.product_id;
    const idProducto = typeof producto === "string" && producto ? producto : null;
    return {
      asunto: plazo
        ? `Un regalo caduca ${plazo} y sigue sin agendar`
        : "Un regalo está a punto de caducar",
      familia: "alerta",
      epigrafe: "Caduca pronto",
      titulo: "La mentoría regalada sigue sin agendar",
      preheader: fecha
        ? `El regalo caduca el ${fecha} y todavía no tiene día ni hora.`
        : "El regalo caduca pronto y todavía no tiene día ni hora.",
      motivo: "Recibes este correo porque hay un regalo de Enséñame Ya a punto de caducar.",
      cuerpo: [
        parrafo(
          fecha
            ? `Hay una mentoría regalada que caduca el <strong>${esc(fecha)}</strong> y todavía no se ha agendado. Cuando venza ya no se podrá usar.`
            : "Hay una mentoría regalada que caduca pronto y todavía no se ha agendado. Cuando venza ya no se podrá usar.",
        ),
        caja(
          "<strong>Si el regalo es para ti:</strong> entra en «Mis reservas», elige día y hora y listo — no pagas nada.<br>" +
            "<strong>Si lo regalaste tú:</strong> avísale a quien lo recibe. Si todavía no tiene cuenta, le basta con registrarse con el correo al que se lo mandaste.",
          "alerta",
        ),
        boton("Ver mis reservas", `${x.base}/reservas`),
        enlaceSecundario("Lo regalé yo: ver mis regalos", `${x.base}/regalar/mis-regalos`),
        idProducto
          ? enlaceSecundario("Ver la mentoría regalada", `${x.base}/products/${idProducto}`)
          : null,
      ],
    };
  },

  /**
   * NTF-37 · caducó. Se encola DOS VECES, con payloads distintos, y esa
   * diferencia es el único modo de saber a quién se le está hablando:
   *
   *   · a quien lo COMPRÓ  → `{credit_id, product_id, amount, currency}`
   *   · a quien lo RECIBIÓ → `{credit_id, product_id}` — sin importe, y a
   *     propósito: lo que alguien pagó por ti no es asunto tuyo.
   *
   * ⚠️ Por eso la rama mira si `amount` ES UN NÚMERO, y no si el importe se pudo
   * formatear: con la moneda ausente `dinero()` devolvería null y el comprador
   * leería el correo del destinatario, que le habla de un regalo que no es suyo.
   *
   * 🔴 Y NINGUNA DE LAS DOS PROMETE UN REEMBOLSO. El cargo ya se liquidó y
   * `credits` no tiene camino automático de vuelta: devolverlo es política
   * comercial —no está en el diagrama— y se hace a mano con `status =
   * 'refunded'`. Escribir «te lo devolvemos» aquí sería comprometer a
   * operaciones desde una plantilla, que es la peor forma de decidir eso.
   */
  gift_expired: (x) => {
    const producto = x.p?.product_id;
    const idProducto = typeof producto === "string" && producto ? producto : null;
    const importeCrudo = x.p?.amount;

    if (typeof importeCrudo === "number") {
      return {
        asunto: "El regalo que compraste caducó sin agendarse",
        familia: "cuenta",
        epigrafe: "Regalo caducado",
        titulo: "Nadie llegó a agendarlo",
        preheader: "La mentoría que regalaste venció sin que se eligiera día ni hora.",
        motivo: "Recibes este correo porque regalaste una mentoría en Enséñame Ya.",
        cuerpo: [
          parrafo(
            "La mentoría que regalaste venció sin que se eligiera día ni hora, así que el regalo ya no se puede usar.",
          ),
          importeGrande("Importe del regalo", dinero(importeCrudo, x.p?.currency), {
            sub: "Caducó sin agendarse",
          }),
          caja(
            "El importe <strong>no vuelve solo</strong>. Si crees que hubo un problema —que el aviso no llegó, por ejemplo— escríbenos y lo miramos contigo.",
            "cuenta",
          ),
          boton("Ver mis regalos", `${x.base}/regalar/mis-regalos`),
          enlaceSecundario("Escribir a soporte", SOPORTE),
        ],
      };
    }

    return {
      asunto: "Tu regalo caducó sin agendarse",
      familia: "cuenta",
      epigrafe: "Regalo caducado",
      titulo: "Se pasó el plazo para agendarlo",
      preheader: "El regalo que tenías pendiente venció sin día ni hora.",
      motivo: "Recibes este correo porque tenías un regalo pendiente de agendar en Enséñame Ya.",
      cuerpo: [
        parrafo(
          "El regalo que tenías pendiente venció sin que llegaras a elegir día y hora, así que ya no se puede agendar.",
        ),
        parrafo(
          "La mentoría sigue estando ahí: si te interesa, puedes reservarla por tu cuenta cuando quieras.",
          { top: 18 },
        ),
        boton(
          idProducto ? "Ver la mentoría" : "Buscar una mentoría",
          idProducto ? `${x.base}/products/${idProducto}` : `${x.base}/search`,
        ),
      ],
    };
  },
};

// ── Ayudas que usan varias plantillas ───────────────────────────────────────

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}

/**
 * Lo que el tutor cobra por esta reserva. Sale del contexto, no de una cuenta
 * hecha aquí: el reparto lo decide `bookings.tier_split_pct` y ya está aplicado
 * cuando la BD resuelve el contexto.
 */
function netoTutor(x: Ctx): string | null {
  const neto = dinero(x.c.neto_tutor ?? x.c.payout?.neto, x.c.moneda ?? x.c.payout?.moneda);
  return neto ? `${neto} para ti` : null;
}

/**
 * «hoy» · «mañana» · «en 5 días» — contados EN EL HUSO DEL DESTINATARIO.
 *
 * ⚠️ EL `dias` DEL PAYLOAD NO ES UN NÚMERO DE DÍAS, ES UN TRAMO. Lo pone
 * `avisar_creditos_por_expirar` con un `case`: **1** si el crédito vence dentro
 * de las próximas 24 horas y **7** en cualquier otro punto de la ventana. Está
 * ahí para que la clave de idempotencia distinga los dos avisos
 * (`CRED:exp1` / `CRED:exp7`), no para pintarlo.
 *
 * Pintarlo tal cual da las dos mentiras que se ven a simple vista en la galería:
 * «caduca mañana» sobre algo que en Bogotá vence esta noche, y «caduca en 7
 * días» justo encima de una fecha que está a seis. Así que manda `expires_at`
 * leído en el huso de quien lee (RN-35) y el tramo solo cubre el caso de que esa
 * fecha no se pueda leer — donde, además, «en menos de un día» es lo único que
 * el tramo 1 garantiza.
 */
function plazoDeCaducidad(
  expiresAt: unknown,
  tramo: number | null,
  tz: string,
  ahora: Date,
): string | null {
  const d = diasHasta(expiresAt, tz, ahora);
  if (d !== null) return d <= 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`;
  if (tramo === null) return null;
  return tramo <= 1 ? "en menos de un día" : `en ${tramo} días`;
}

/** «Del 1 al 10 de septiembre» */
function rango(
  desde: unknown,
  hasta: unknown,
  tz: string,
  opts: { conHora?: boolean } = {},
): string | null {
  const o: Intl.DateTimeFormatOptions = opts.conHora
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { day: "numeric", month: "long" };
  const a = fmt(desde, tz, o);
  const b = fmt(hasta, tz, o);
  if (!a || !b) return null;
  return opts.conHora ? `Detectadas entre las ${a} y las ${b} (UTC)` : `Del ${a} al ${b}`;
}

// ── El render ───────────────────────────────────────────────────────────────

export type EmailRendered = {
  subject: string;
  html: string;
  text: string;
  /** Doc 33 §9: los no esenciales llevan `List-Unsubscribe`. */
  baja: boolean;
};

/** Los ids de plantilla que existen. Lo usa `npm run build:correos-auth`. */
export const PLANTILLAS_IDS = Object.keys(PLANTILLAS);

/**
 * Devuelve `null` si la plantilla no está en el mapa. El job lo trata como error
 * PERMANENTE: reintentar cada 5 minutos una plantilla que no existe no la va a
 * hacer aparecer, y dejarla pendiente para siempre escondería el problema.
 */
export function renderEmail(opts: {
  template: string;
  payload: Payload;
  nombre: string;
  baseUrl: string;
  /** Lo que resolvió `pending_email_notifications`. Opcional: puede no venir. */
  contexto?: Contexto | null;
  /** Huso del destinatario (RN-35). Sin él, UTC. */
  timezone?: string | null;
  /** Solo para las pruebas y la galería: fija el «hoy» y el logotipo. */
  ahora?: Date;
  logo?: string;
}): EmailRendered | null {
  const hacer = PLANTILLAS[opts.template];
  if (!hacer) return null;

  const base = opts.baseUrl.replace(/\/+$/, "");
  const nombre = opts.nombre ? primerNombre(opts.nombre) : "";

  const plantilla = hacer({
    base,
    url: `${base}${rutaFor(opts.template, opts.payload)}`,
    nombre,
    p: opts.payload,
    c: opts.contexto ?? {},
    tz: opts.timezone || "UTC",
    ahora: opts.ahora ?? new Date(),
  });

  // El saludo sale de `profiles.full_name`, que lo escribe el propio usuario:
  // `render` lo escapa. `null` explícito = este correo no saluda.
  const saludo =
    plantilla.saludo === null ? null : nombre ? `Hola ${nombre},` : "Hola,";

  const html =
    STYLE +
    render({
      base,
      familia: plantilla.familia,
      epigrafe: plantilla.epigrafe,
      titulo: plantilla.titulo,
      saludo,
      cuerpo: plantilla.cuerpo,
      motivo: plantilla.motivo,
      baja: plantilla.baja,
      preheader: plantilla.preheader,
      logo: opts.logo,
    });

  return {
    subject: plantilla.asunto,
    html,
    text: aTextoPlano(html),
    baja: Boolean(plantilla.baja),
  };
}
