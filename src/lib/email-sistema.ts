// Relativo y con extensión, no `@/`: `email-templates.check.ts` se corre con
// node a pelo (`npm run check:email`) y node no resuelve el alias de tsconfig.
// Mismo motivo que en `email-templates.ts` y `catalog/format.ts`.

/**
 * Doc 33 · El SISTEMA VISUAL de los correos. Layout y componentes.
 *
 * El texto de cada correo vive en `email-templates.ts`; quien los junta es
 * `renderEmail`, allí mismo. Este fichero es el puerto de `sistema.py` del
 * pliego (Doc 33 §3), función por función.
 *
 * ─── Las cuatro restricciones que explican TODO lo raro de aquí abajo ───────
 *
 * 1. TABLAS, no flex ni grid: Outlook renderiza con el motor de Word. Todas
 *    llevan `role="presentation"` para que un lector de pantalla no las cante
 *    como tablas de datos (WCAG 1.3.1).
 * 2. TODO EL CSS EN LÍNEA. El `<style>` del head lo descartan varios clientes.
 *    El que hay (`STYLE`) es SOLO mejora progresiva: si se cae, el correo se ve
 *    igual.
 * 3. `bgcolor` **y** `background` en cada celda con color: Outlook ignora el CSS
 *    de fondo en algunas versiones y solo respeta el atributo.
 * 4. LA IMAGEN ES OPCIONAL, NUNCA PORTADORA DE INFORMACIÓN. El logotipo va como
 *    `<img alt="">` **al lado** del nombre en texto: si el cliente bloquea
 *    imágenes —que es lo que hacen por defecto— se lee «Enséñame Ya» en azul y
 *    no falta nada.
 *
 * ⚠️ CONTRASTE, medido: blanco sobre el naranja de marca (#fe6a00) da **2,89:1**
 * y falla el AA de WCAG incluso para texto grande, que pide 3:1; `#14141a` sobre
 * ese mismo naranja da **6,36:1**. Por eso el botón es naranja con texto tinta,
 * y por eso el botón es IDÉNTICO en los 36 correos: un solo color de acción son
 * cero decisiones de contraste por plantilla. El color de familia solo tiñe el
 * filete de 4 px, el epígrafe y las cajas.
 *
 * El botón mide 48 px de alto (15+15 de relleno + 18 de línea) para cumplir el
 * objetivo táctil de 44 px de WCAG 2.5.5: un correo se abre en el móvil.
 */

// ── Paleta (Doc 33 §3.2) ────────────────────────────────────────────────────
export const TINTA = "#14141a";
export const GRIS = "#5b6270"; // texto secundario
export const GRIS_2 = "#8b93a3"; // pie
export const BORDE = "#e6e8ee";
export const FONDO = "#eef1f6";
export const BLANCO = "#ffffff";

export const AZUL = "#0080ff"; // marca — solo el logotipo (WCAG 1.4.3 exime logotipos)
export const AZUL_FG = "#036fda"; // enlaces — 4,90:1 sobre blanco
export const AZUL_BG = "#eaf4ff";

export const NARANJA = "#fe6a00"; // marca — fondo del botón, y solo eso
export const NARANJA_FG = "#b34900"; // naranja legible sobre blanco — 6,05:1
export const NARANJA_BG = "#fff3ea";

export const ROJO = "#c8362b";
export const ROJO_BG = "#fdeceb";
export const VERDE = "#1a7f4b";
export const VERDE_BG = "#e9f7ef";

/**
 * Poppins va PRIMERA aunque casi nadie la tenga instalada: si está, el correo se
 * ve con la tipografía de la marca; si no, cae a la del sistema. No cuesta nada
 * y no puede fallar.
 */
export const FUENTE =
  "Poppins,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type Familia = "clase" | "compra" | "cuenta" | "alerta" | "ok";

/** Familia → [color del filete y del epígrafe, fondo de sus cajas]. */
export const FAMILIAS: Record<Familia, [string, string]> = {
  clase: [AZUL_FG, AZUL_BG],
  compra: [NARANJA_FG, NARANJA_BG],
  cuenta: [TINTA, "#f3f4f7"],
  alerta: [ROJO, ROJO_BG],
  ok: [VERDE, VERDE_BG],
};

/**
 * ⚠️ URL ABSOLUTA, siempre (Doc 33 §4). En un correo no valen ni las rutas
 * relativas ni las imágenes en `data:` URI —Gmail las descarta—, así que el
 * logotipo se sirve del sitio.
 *
 * Vive en `public/img/correo/` y no junto al SVG a propósito: es un asset de
 * correo, y el día que alguien optimice o convierta las imágenes del sitio, este
 * no puede cambiar de nombre ni de formato sin romper correos YA ENVIADOS. El
 * SVG de `public/img/logo-ya.svg` no sirve aquí: Gmail, Outlook y Yahoo lo
 * descartan.
 *
 * Se pinta a 26×28 CSS px; el fichero es 78×83, o sea 3× para pantallas retina.
 */
export function logoUrl(base: string): string {
  return `${base}/img/correo/logo-ya.png`;
}

/**
 * Escapa lo que se interpola dentro del HTML.
 *
 * No es teatro: el saludo sale de `profiles.full_name` y el cuerpo de
 * `admin_message` lo escribe el administrador. Escapar siempre cuesta nada y
 * evita el olvido que no se ve hasta que alguien pega un `<script>`.
 */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Un bloque del cuerpo: HTML ya montado, una fila `<tr>` de la tabla de la
 * tarjeta. Los `null` se caen solos, para que una plantilla pueda pedir un
 * bloque que solo existe si el payload trae el dato.
 */
export type Bloque = string | null;

// ── Componentes (Doc 33 §3.4) ───────────────────────────────────────────────

export function parrafo(
  texto: string,
  opts: { color?: string; size?: number; top?: number } = {},
): string {
  const { color = GRIS, size = 15, top = 12 } = opts;
  return `<tr><td style="padding:${top}px 32px 0;font-family:${FUENTE};font-size:${size}px;line-height:1.65;color:${color}">${texto}</td></tr>`;
}

/**
 * Caja con un título y pares etiqueta/valor. La pieza más usada del sistema: la
 * ficha de la clase, la del mensaje de contacto, la del pedido.
 *
 * ⚠️ Es lo que ROMPE la regla vieja de «el correo no lleva datos de la reserva»
 * (la que documentaba la cabecera de este módulo hasta el Doc 33). Se rompe a
 * propósito y SOLO en la familia de compra y reserva —decisión del 10-sep-2026—:
 * un recibo sin qué compraste no es un recibo. Fuera de esa familia (chat,
 * moderación, KYC, payouts) los correos siguen escuetos, por el mismo motivo de
 * siempre: un correo se reenvía y se queda en bandejas ajenas.
 *
 * Las filas con valor vacío se caen: una ficha con «Cuándo: —» es peor que una
 * ficha con una línea menos.
 */
export function ficha(
  titulo: string,
  filas: [string, string | null | undefined][],
  acento = AZUL_FG,
  fondo = AZUL_BG,
): string | null {
  const vivas = filas.filter((f): f is [string, string] => Boolean(f[1]));
  if (vivas.length === 0) return null;

  const cuerpo = vivas
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="padding:4px 0;font-family:${FUENTE};font-size:13px;line-height:1.5;color:${GRIS};vertical-align:top;width:88px">${esc(k)}</td>` +
        `<td style="padding:4px 0;font-family:${FUENTE};font-size:14px;line-height:1.5;color:${TINTA};font-weight:600">${esc(v)}</td>` +
        `</tr>`,
    )
    .join("");

  return `<tr><td style="padding:22px 32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${fondo}" style="background:${fondo};width:100%;border-collapse:collapse;border-radius:12px">
    <tr><td style="padding:18px 20px;border-left:3px solid ${acento};border-radius:12px">
      <div style="font-family:${FUENTE};font-size:16px;font-weight:700;line-height:1.35;color:${TINTA};padding-bottom:10px">${esc(titulo)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${cuerpo}</table>
    </td></tr>
  </table>
</td></tr>`;
}

/**
 * La ficha de una clase, con las etiquetas de siempre.
 *
 * Devuelve `null` si no hay ni título ni nada que poner: las plantillas la piden
 * siempre y el contexto puede venir vacío (una notificación ya encolada antes de
 * que el job resolviera el contexto, o una reserva borrada).
 */
export function tarjetaClase(opts: {
  titulo?: string | null;
  tutor?: string | null;
  cuando?: string | null;
  duracion?: string | null;
  importe?: string | null;
  acento?: string;
  fondo?: string;
}): string | null {
  const { acento = AZUL_FG, fondo = AZUL_BG } = opts;
  if (!opts.titulo) return null;
  return ficha(
    opts.titulo,
    [
      ["Con", opts.tutor],
      ["Cuándo", opts.cuando],
      ["Duración", opts.duracion],
      ["Importe", opts.importe],
    ],
    acento,
    fondo,
  );
}

export type LineaPedido = { titulo: string; sub: string; importe: string };

/**
 * El resumen del pedido. Existe porque HOY un carrito de tres clases dispara
 * tres recibos sueltos (`confirm_order_payment` pasa línea por línea por
 * `confirm_payment`) y ninguno dice cuánto se cobró en total.
 */
export function tablaPedido(
  lineas: LineaPedido[],
  total: string,
  opts: { nota?: string | null; etiqueta?: string } = {},
): string | null {
  if (lineas.length === 0) return null;
  const { nota: pie, etiqueta = "Total pagado" } = opts;

  const filas = lineas
    .map((l, i) => {
      const borde = i ? `border-top:1px solid ${BORDE};` : "";
      return `<tr>
      <td style="${borde}padding:12px 0;font-family:${FUENTE};font-size:14px;line-height:1.45;color:${TINTA};font-weight:600">${esc(l.titulo)}
        <div style="font-size:13px;font-weight:400;color:${GRIS};padding-top:2px">${esc(l.sub)}</div></td>
      <td align="right" style="${borde}padding:12px 0 12px 12px;font-family:${FUENTE};font-size:14px;line-height:1.45;color:${TINTA};font-weight:600;white-space:nowrap;vertical-align:top">${esc(l.importe)}</td>
    </tr>`;
    })
    .join("");

  const pieNota = pie
    ? `<div style="font-family:${FUENTE};font-size:12px;color:${GRIS};padding-top:8px">${esc(pie)}</div>`
    : "";

  return `<tr><td style="padding:22px 32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid ${BORDE};border-radius:12px">
    <tr><td style="padding:6px 20px 18px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${filas}
        <tr>
          <td style="border-top:2px solid ${TINTA};padding:14px 0 0;font-family:${FUENTE};font-size:15px;font-weight:700;color:${TINTA}">${esc(etiqueta)}</td>
          <td align="right" style="border-top:2px solid ${TINTA};padding:14px 0 0;font-family:${FUENTE};font-size:18px;font-weight:700;color:${TINTA};white-space:nowrap">${esc(total)}</td>
        </tr>
      </table>${pieNota}
    </td></tr>
  </table>
</td></tr>`;
}

/**
 * Las cinco estrellas del correo de reseña. Cada una enlaza a
 * `…/resena?rating=N`, y el formulario prellena la puntuación desde ese
 * parámetro (`review-form.tsx`). Sin eso los enlaces seguirían funcionando
 * —llevan a la pantalla— pero no ahorrarían el clic, que es todo el punto.
 *
 * El numeral debajo de cada estrella no es decoración: cinco estrellas naranjas
 * seguidas se leen como «ya tienes 5», y el número deshace eso y dice «elige
 * una».
 */
export function estrellas(urlBase: string): string {
  const celdas = [1, 2, 3, 4, 5]
    .map(
      (n) => `<td align="center" style="padding:0 6px">
      <a href="${urlBase}?rating=${n}" style="text-decoration:none;display:block">
        <span style="font-family:${FUENTE};font-size:34px;line-height:38px;color:${NARANJA};text-decoration:none">&#9733;</span>
        <span style="display:block;font-family:${FUENTE};font-size:11px;line-height:16px;color:${GRIS_2};text-decoration:none">${n}</span>
      </a></td>`,
    )
    .join("");

  return `<tr><td align="center" style="padding:24px 32px 0">
  <div style="font-family:${FUENTE};font-size:13px;color:${GRIS};padding-bottom:10px">Pulsa una estrella para puntuar</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${celdas}</tr></table>
</td></tr>`;
}

export function importeGrande(
  etiqueta: string,
  monto: string | null | undefined,
  opts: { sub?: string | null; color?: string } = {},
): string | null {
  if (!monto) return null;
  const { sub, color = TINTA } = opts;
  const subHtml = sub
    ? `<div style="font-family:${FUENTE};font-size:13px;color:${GRIS};padding-top:6px">${esc(sub)}</div>`
    : "";
  return `<tr><td align="center" style="padding:24px 32px 0">
  <div style="font-family:${FUENTE};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${GRIS_2}">${esc(etiqueta)}</div>
  <div style="font-family:${FUENTE};font-size:34px;font-weight:700;line-height:1.2;color:${color};padding-top:4px">${esc(monto)}</div>${subHtml}
</td></tr>`;
}

/**
 * Aviso enmarcado. Para lo que no se puede leer por encima: un pago que falló,
 * un plazo que corre, un dinero que no llegó.
 *
 * ⚠️ `texto` es HTML (lleva `<strong>` en casi todas las llamadas), así que lo
 * que venga de fuera del fichero se escapa ANTES de llegar aquí.
 */
export function caja(
  texto: string,
  familia: Familia = "clase",
  titulo?: string | null,
): string {
  const [acento, fondo] = FAMILIAS[familia];
  const tit = titulo
    ? `<div style="font-family:${FUENTE};font-size:14px;font-weight:700;color:${acento};padding-bottom:4px">${esc(titulo)}</div>`
    : "";
  return `<tr><td style="padding:20px 32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${fondo}" style="background:${fondo};width:100%;border-collapse:collapse;border-radius:10px">
    <tr><td style="padding:14px 18px;border-left:3px solid ${acento};border-radius:10px;font-family:${FUENTE};font-size:14px;line-height:1.6;color:${TINTA}">${tit}${texto}</td></tr>
  </table>
</td></tr>`;
}

/**
 * Lista numerada para los correos de bienvenida. Los números van en una celda
 * propia con fondo, no en un `<ol>`: la numeración de lista es de lo poco que
 * Outlook desmaqueta sin avisar.
 */
export function pasos(items: [string, string][]): string {
  const filas = items
    .map(
      ([titulo, texto], i) => `<tr>
      <td width="30" valign="top" style="padding:0 12px 16px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
          <td width="26" height="26" align="center" bgcolor="${AZUL_BG}" style="background:${AZUL_BG};width:26px;height:26px;border-radius:13px;font-family:${FUENTE};font-size:13px;font-weight:700;color:${AZUL_FG}">${i + 1}</td>
        </tr></table>
      </td>
      <td valign="top" style="padding:0 0 16px;font-family:${FUENTE}">
        <div style="font-size:14px;font-weight:700;color:${TINTA};line-height:1.4">${esc(titulo)}</div>
        <div style="font-size:14px;color:${GRIS};line-height:1.6;padding-top:2px">${esc(texto)}</div>
      </td></tr>`,
    )
    .join("");

  return `<tr><td style="padding:22px 32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${filas}</table>
</td></tr>`;
}

/**
 * El código de un solo uso de los correos de Auth. Va ADEMÁS del enlace, no en
 * su lugar: el enlace se rompe en clientes que reescriben URLs.
 */
export function codigo(valor: string): string {
  return `<tr><td align="center" style="padding:22px 32px 0">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    <tr><td bgcolor="#f3f4f7" align="center" style="background:#f3f4f7;border-radius:10px;padding:14px 28px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:26px;font-weight:700;letter-spacing:.22em;color:${TINTA}">${valor}</td></tr>
  </table>
</td></tr>`;
}

/**
 * Avatar de iniciales + nombre. El círculo lo cuadra Outlook y da igual: sigue
 * leyéndose.
 */
export function persona(nombre: string | null | undefined, papel: string): string | null {
  if (!nombre) return null;
  const ini =
    nombre
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "?";
  return `<tr><td style="padding:20px 32px 0">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
    <td width="44" height="44" align="center" bgcolor="${AZUL_BG}" style="background:${AZUL_BG};width:44px;height:44px;border-radius:22px;font-family:${FUENTE};font-size:15px;font-weight:700;color:${AZUL_FG}">${esc(ini)}</td>
    <td style="padding-left:12px;font-family:${FUENTE}">
      <div style="font-size:15px;font-weight:700;color:${TINTA};line-height:1.3">${esc(nombre)}</div>
      <div style="font-size:13px;color:${GRIS};line-height:1.4">${esc(papel)}</div>
    </td>
  </tr></table>
</td></tr>`;
}

/**
 * Texto citado: la reseña que dejó el alumno, el mensaje del formulario de
 * contacto. Lo escribe un desconocido, así que se escapa aquí dentro y los
 * saltos de línea se convierten en `<br>` DESPUÉS de escapar.
 */
export function cita(texto: string | null | undefined, autor: string): string | null {
  if (!texto || !texto.trim()) return null;
  const cuerpo = esc(texto.trim()).replace(/\n/g, "<br>");
  return `<tr><td style="padding:20px 32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">
    <tr><td style="padding:2px 0 0 16px;border-left:3px solid ${BORDE};font-family:${FUENTE};font-size:15px;line-height:1.65;color:${TINTA};font-style:italic">&ldquo;${cuerpo}&rdquo;
      <div style="font-size:13px;font-style:normal;color:${GRIS};padding-top:8px">&mdash; ${esc(autor)}</div></td></tr>
  </table>
</td></tr>`;
}

/**
 * El botón. IDÉNTICO en los 36 correos: naranja de marca con texto tinta.
 * 48 px de alto (15+15 de relleno + 18 de línea) para el objetivo táctil de
 * 44 px de WCAG 2.5.5.
 */
export function boton(texto: string, url: string): string {
  return `<tr><td style="padding:26px 32px 0">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
    <tr><td bgcolor="${NARANJA}" align="center" style="background:${NARANJA};border-radius:10px">
      <a href="${url}" style="display:block;padding:15px 26px;font-family:${FUENTE};font-size:15px;font-weight:700;line-height:18px;color:${TINTA};text-decoration:none">${esc(texto)}</a>
    </td></tr>
  </table>
</td></tr>`;
}

export function enlaceSecundario(texto: string, url: string): string {
  return `<tr><td style="padding:14px 32px 0;font-family:${FUENTE};font-size:14px;line-height:1.6;color:${GRIS}"><a href="${url}" style="color:${AZUL_FG};text-decoration:underline">${esc(texto)}</a></td></tr>`;
}

/** Nota secundaria del pie de la tarjeta. `texto` es HTML. */
export function nota(texto: string): string {
  return `<tr><td style="padding:16px 32px 0;font-family:${FUENTE};font-size:13px;line-height:1.6;color:${GRIS_2}">${texto}</td></tr>`;
}

// ── Layout (Doc 33 §3.3) ────────────────────────────────────────────────────

/**
 * El `<style>` es MEJORA PROGRESIVA y nada más: Gmail y Apple Mail lo aplican,
 * Outlook lo tira, y si lo tira el correo se ve IGUAL, porque todo lo que
 * importa ya va en línea. Lo único que hace es pedirle al cliente que no invente
 * su propio modo oscuro: varios invierten los colores por su cuenta y dejan el
 * naranja del botón ilegible.
 *
 * No hay media query de móvil a propósito: con 600 px de ancho máximo y 32 px de
 * relleno, en una pantalla de 375 quedan 287 px de contenido, suficiente para la
 * tabla de pedido —la pieza más ancha— sin desbordar. Una regla `!important`
 * sobre `td` habría alcanzado también al filete y a las cajas anidadas.
 */
export const STYLE = `<style>
  :root { color-scheme: light; supported-color-schemes: light; }
</style>`;

/**
 * La dirección fiscal del pie. Se repite en los 36 correos porque la CAN-SPAM la
 * exige en todo correo comercial, y porque un correo sin remitente físico puntúa
 * peor en los filtros.
 *
 * ⚠️ No sale de `lib/company.ts` a propósito: ese módulo importa cosas que este
 * fichero —que se corre con node a pelo en `npm run check:email`— no puede
 * arrastrar. Si algún día divergen, manda `company.ts`.
 */
const DIRECCION =
  "Ensename Ya, LLC · 815 Bayside Lane, Weston, Florida 33326, Estados Unidos";

const SOPORTE = "info@ensenameya.com";

/**
 * ⚠️ EL ENLACE DE BAJA ESTÁ APAGADO A PROPÓSITO (Doc 33 §9).
 *
 * Siete de los 36 correos son no esenciales y deberían llevar «dejar de recibir
 * estos avisos». Su destino, `/account#avisos`, **no existe**: S-49 (la
 * preferencia de opt-out) sigue sin construirse, y es una decisión de PRODUCTO
 * abierta —la nº 3 del pliego—, no algo que se invente aquí (regla de oro 8).
 *
 * El pliego lo deja escrito: «mandarlos con un enlace que no lleva a ningún
 * sitio es peor que no ponerlo». Así que el enlace no sale y en su lugar va la
 * cabecera `List-Unsubscribe` en forma de `mailto:`, que es válida, la respetan
 * Gmail y Outlook, y no necesita ninguna pantalla (ver `email.ts`).
 *
 * El día que S-49 exista: esto a `true` y ya está. La marca `baja` de cada
 * plantilla ya está puesta correo por correo.
 */
export const BAJA_TIENE_DESTINO = false;

/**
 * Arma el correo entero. `cuerpo` son los componentes ya en HTML; los `null` se
 * caen (un bloque que depende de un dato que no vino no deja un hueco).
 */
export function render(opts: {
  base: string;
  familia: Familia;
  epigrafe: string;
  titulo: string;
  saludo?: string | null;
  cuerpo: Bloque[];
  motivo: string;
  baja?: boolean;
  preheader?: string | null;
  /** Solo las pruebas lo cambian (a `cid:logo`). En producción, la URL del sitio. */
  logo?: string;
}): string {
  const [acento] = FAMILIAS[opts.familia];
  const pre = esc(opts.preheader || opts.titulo);
  const logo = opts.logo ?? logoUrl(opts.base);

  const saludoHtml = opts.saludo
    ? `<tr><td style="padding:26px 32px 0;font-family:${FUENTE};font-size:15px;line-height:1.6;color:${TINTA}">${esc(opts.saludo)}</td></tr>`
    : "";

  const bajaHtml =
    opts.baja && BAJA_TIENE_DESTINO
      ? `<br><a href="${opts.base}/account#avisos" style="color:${GRIS_2};text-decoration:underline">Dejar de recibir estos avisos</a>`
      : "";

  return `<div lang="es" style="margin:0;padding:0;background:${FONDO}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background:${FONDO};width:100%;border-collapse:collapse">
  <tr><td align="center" style="padding:28px 12px 36px">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse">

      <tr><td style="padding:0 4px 14px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
          <td style="padding-right:9px"><img src="${logo}" width="26" height="28" alt="" style="display:block;width:26px;height:28px;border:0"></td>
          <td style="font-family:${FUENTE};font-size:17px;font-weight:700;line-height:28px;color:${AZUL}">Enséñame Ya</td>
        </tr></table>
      </td></tr>

      <tr><td bgcolor="${BLANCO}" style="background:${BLANCO};border-radius:16px;border:1px solid ${BORDE}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">
          <tr><td height="4" bgcolor="${acento}" style="background:${acento};height:4px;line-height:4px;font-size:0;border-radius:16px 16px 0 0">&nbsp;</td></tr>
          <tr><td style="padding:26px 32px 0;font-family:${FUENTE};font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${acento}">${esc(opts.epigrafe)}</td></tr>
          <tr><td style="padding:8px 32px 0;font-family:${FUENTE};font-size:23px;font-weight:700;line-height:1.3;color:${TINTA}">${esc(opts.titulo)}</td></tr>
          ${saludoHtml}
          ${opts.cuerpo.filter(Boolean).join("")}
          <tr><td style="padding:32px 32px 30px"><div style="height:1px;background:${BORDE};font-size:0;line-height:1px">&nbsp;</div></td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:18px 8px 0;font-family:${FUENTE};font-size:12px;line-height:1.7;color:${GRIS_2}">
        <strong style="color:${GRIS}">Enséñame Ya</strong> · Mentorías 1 a 1 en vivo<br>
        ${esc(opts.motivo)} ¿Dudas? <a href="mailto:${SOPORTE}" style="color:${AZUL_FG};text-decoration:underline">${SOPORTE}</a>${bajaHtml}<br>
        <span style="color:#a8aebb">${DIRECCION}</span>
      </td></tr>

    </table>
  </td></tr>
</table>
</div>`;
}

/**
 * La versión de TEXTO PLANO, derivada del HTML.
 *
 * No es un extra: un correo que solo lleva HTML puntúa peor en los filtros de
 * spam y no se lee en un reloj ni en un cliente en modo texto.
 *
 * Se DERIVA del HTML en vez de escribirse a mano por correo, y eso es
 * deliberado: son 36 plantillas, y una segunda redacción paralela son 36
 * oportunidades de que las dos versiones digan cosas distintas. Es el mismo
 * `texto_de` que usa el `build.py` del pliego.
 */
export function aTextoPlano(html: string): string {
  let t = html;
  t = t.replace(/<style>[\s\S]*?<\/style>/g, "");
  // El preheader: lo lee la bandeja, no la persona. Fuera.
  t = t.replace(/<div style="display:none[\s\S]*?<\/div>/, "");
  // Un `mailto:` en texto plano no aporta nada: la dirección ya está escrita.
  t = t.replace(/<a[^>]*href="mailto:[^"]*"[^>]*>([\s\S]*?)<\/a>/g, "$1");
  t = t.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, "$2: $1");
  t = t.replace(/<br\s*\/?>/g, "\n");
  t = t.replace(/<\/(td|tr|div|p|h1|h2)>/g, "\n");
  t = t.replace(/<[^>]+>/g, "");
  t = desescapar(t);
  t = t
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Deshace el escapado del HTML para la rama de texto: ahí un `&amp;` se leería
 * literalmente. Solo las entidades que este sistema produce — no es un parser de
 * HTML y no pretende serlo.
 */
function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&mdash;/g, "—")
    .replace(/&#9733;/g, "★")
    .replace(/&amp;/g, "&"); // el último, o desharía los de arriba
}
