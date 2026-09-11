// Relativo y con extensión, no `@/`: esto se corre con
// `node --experimental-strip-types` y node no resuelve el alias de tsconfig.
// Mismo motivo que en `src/lib/*.check.ts`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderEmail } from "../src/lib/email-templates.ts";

/**
 * Doc 33 · escribe las TRES plantillas de correo que este código NO manda.
 *
 * `npm run build:correos-auth` → `supabase/templates/*.html`.
 *
 * ─── Por qué existe este script ─────────────────────────────────────────────
 *
 * De los 34 correos del pliego, 31 los envía nuestro job (`/api/cron/
 * notifications-send` → Resend). Los otros tres —confirmar registro, recuperar
 * contraseña y confirmar el correo nuevo— los manda **GoTrue**, el servicio de
 * Auth de Supabase, desde su propio proceso. Nunca pasan por `renderEmail` en
 * ejecución, así que la única forma de que se vean como los otros 31 es
 * renderizarlos AQUÍ, en tiempo de construcción, y darle a Supabase el HTML ya
 * hecho.
 *
 * ⚠️ Esto escribe ficheros, no despliega nada. `supabase/config.toml` **NO se
 * aplica a la nube** (este proyecto no tiene stack local y el CI solo corre
 * `supabase db push`): el HTML hay que pegarlo a mano en
 * Dashboard → Authentication → Emails, proyecto por proyecto. El runbook está
 * en `docs/PROPUESTAS/33-correos/README.md`.
 */

// ── Por qué el dominio va aquí a pelo y no es un descuido ───────────────────
//
// El job de correo saca su `baseUrl` del origen de la petición, porque lo sirve
// nuestro despliegue y así preview y producción enlazan cada una a lo suyo.
// Aquí NO HAY PETICIÓN: estos ficheros los sirve GoTrue, que no sabe nada de
// Vercel, y el HTML se pega una vez y se queda. Así que la constante es la
// respuesta correcta, no el atajo.
//
// Y tiene que ser el dominio **oficial**, el que la app sirve desde el
// 10-sep-2026, por dos motivos independientes:
//
//   1. El logotipo va como `<img src>` ABSOLUTA. Una ruta relativa en un correo
//      no apunta a ninguna parte, y `ensenameya.vercel.app` es un 308 que el
//      cliente de correo puede no seguir. `www.ensenameya.com` también redirige:
//      se usa el apex, que es el que sirve de verdad.
//   2. El dominio del ENLACE debe coincidir con el del remitente, o los filtros
//      lo puntúan como phishing. Ver el README: el SMTP de Resend en Auth es la
//      otra mitad de esa frase.
const BASE = "https://ensenameya.com";

/**
 * Los tres correos, con los DOS nombres de cada uno:
 *
 *   · `fichero` — cómo se llama el HTML en `supabase/templates/`.
 *   · `clave`   — cómo lo llama Supabase, que no es como lo llamamos nosotros.
 *     `confirmation` (no `signup`), `recovery` (no `reset_password`) y
 *     `email_change` (no `change_email`). Son los nombres de la tabla de
 *     `[auth.email.template.<clave>]` y los rótulos del Dashboard; inventarse
 *     uno deja la sección sin efecto y sin error.
 */
const CORREOS = [
  { id: "auth_confirm_signup", fichero: "confirm_signup.html", clave: "confirmation" },
  { id: "auth_reset_password", fichero: "reset_password.html", clave: "recovery" },
  { id: "auth_change_email", fichero: "change_email.html", clave: "email_change" },
] as const;

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SALIDA = join(RAIZ, "supabase", "templates");

/**
 * Un literal de Go bien formado: `{{ .ConfirmationURL }}`.
 *
 * ⚠️ ES LA COMPROBACIÓN QUE JUSTIFICA EL SCRIPT. Los enlaces de estos tres
 * correos no son URLs, son marcadores que GoTrue sustituye al enviar. Si
 * alguien mete uno por un componente que escapa —`esc()` convierte `&` en
 * `&amp;` y `"` en `&quot;`— el marcador deja de ser reconocible, GoTrue lo
 * copia tal cual y el correo sale con un botón que lleva a `{{ .ConfirmationURL
 * }}` literal. No falla nada: se envía, se entrega y nadie puede confirmar su
 * cuenta. Por eso se mira el HTML YA GENERADO y no el código que lo genera.
 */
const LITERAL_OK = /^\{\{ \.[A-Za-z][A-Za-z0-9.]* \}\}$/;

/** Lo que cada plantilla TIENE que llevar, en su sitio exacto del HTML. */
const EXIGE: Record<string, string[]> = {
  // El marcador dentro del `href`, con las comillas intactas alrededor: si
  // hubiera salido escapado, esta cadena no aparecería.
  auth_confirm_signup: ['href="{{ .ConfirmationURL }}"', ">{{ .Token }}<"],
  auth_reset_password: ['href="{{ .ConfirmationURL }}"'],
  auth_change_email: ['href="{{ .ConfirmationURL }}"'],
};

mkdirSync(SALIDA, { recursive: true });

/** Para el aviso de abajo: el asunto vive en dos sitios y no pueden divergir. */
const toml = readFileSync(join(RAIZ, "supabase", "config.toml"), "utf8");
const desincronizados: string[] = [];

for (const { id, fichero, clave } of CORREOS) {
  const correo = renderEmail({
    template: id,
    payload: null,
    // GoTrue no sabe cómo se llama el destinatario. Tiene `{{ .Email }}`, pero
    // «Hola lucia.f@ejemplo.com,» se lee peor que «Hola,» — y `{{ .Data
    // .full_name }}` sale VACÍO en recuperar contraseña, que deja un «Hola ,»
    // con la coma huérfana. Sin nombre, `renderEmail` saluda «Hola,» y ya está.
    nombre: "",
    baseUrl: BASE,
    // Estas tres no pintan ni fechas ni importes: sin contexto y sin huso no
    // pierden nada. `ahora` se fija igualmente para que dos corridas del script
    // den ficheros byte a byte idénticos y el `git diff` signifique algo.
    contexto: null,
    timezone: null,
    ahora: new Date("2026-09-11T00:00:00Z"),
  });

  if (!correo) {
    throw new Error(
      `La plantilla "${id}" no existe en PLANTILLAS (src/lib/email-templates.ts).`,
    );
  }

  for (const exigido of EXIGE[id] ?? []) {
    if (!correo.html.includes(exigido)) {
      throw new Error(
        `"${id}" no lleva ${exigido} intacto: GoTrue no lo sustituiría y el ` +
          `correo saldría con el marcador a la vista.`,
      );
    }
  }

  // Y al revés: que no se haya colado NINGÚN marcador a medio escapar. Se miran
  // todos los `{{ … }}` del fichero, no solo los que se esperaban.
  for (const encontrado of correo.html.match(/\{\{[\s\S]*?\}\}/g) ?? []) {
    if (!LITERAL_OK.test(encontrado)) {
      throw new Error(`"${id}" tiene un literal de Go malformado: ${encontrado}`);
    }
  }

  // El logotipo se sirve del sitio. Si esto dejara de ser absoluto, el correo
  // saldría sin logotipo en todos los clientes (y no romperse es peor: nadie
  // lo nota).
  if (!correo.html.includes(`src="${BASE}/img/correo/logo-ya.png"`)) {
    throw new Error(`"${id}" no apunta el logotipo a ${BASE} — sin URL absoluta no se ve.`);
  }

  // El asunto lo teclea Supabase, no este HTML: vive en `config.toml` y en el
  // Dashboard. Si alguien cambia el `asunto` de la plantilla y no lo replica,
  // el correo sale con el rediseño y el asunto viejo. Aquí solo se avisa —el
  // que manda de verdad es el Dashboard, y este script no puede tocarlo.
  if (!toml.includes(`subject = "${correo.subject}"`)) {
    desincronizados.push(
      `  [auth.email.template.${clave}]\n  subject = "${correo.subject}"`,
    );
  }

  writeFileSync(join(SALIDA, fichero), correo.html, "utf8");
  console.log(`✓ supabase/templates/${fichero}  ·  ${clave}  ·  «${correo.subject}»`);
}

if (desincronizados.length) {
  console.log(
    `\n⚠️  El asunto de ${desincronizados.length} plantilla(s) no está en ` +
      `supabase/config.toml. Debería decir:\n\n${desincronizados.join("\n\n")}\n`,
  );
}

console.log(
  "\n⚠️  Escrito, NO desplegado: config.toml no se aplica a la nube. " +
    "Pega cada HTML en Dashboard → Authentication → Emails, en dev Y en prod.\n" +
    "    Runbook: docs/PROPUESTAS/33-correos/README.md",
);
