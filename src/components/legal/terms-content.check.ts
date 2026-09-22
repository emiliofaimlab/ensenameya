import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CANCELLATION_POLICY as P } from "../../lib/policy.ts";
import { TERMS, TERMS_LOCALES, TERMS_VERSION } from "./terms-content.ts";

/**
 * Comprueba que el contrato publicado y el código que ejecuta los reembolsos
 * siguen diciendo lo mismo. Se corre con `npm run check:terms`.
 *
 * POR QUÉ EXISTE. Hasta el 17-ago los términos eran texto nuestro e
 * interpolaban los porcentajes desde `lib/policy.ts`, así que era imposible que
 * divergieran. El contrato de Néstor no se puede interpolar —los números están
 * escritos a mano porque así se firmó— y con eso se perdía esa garantía.
 *
 * Esto la devuelve por el otro lado: en vez de generar el texto desde el
 * código, comprueba que el código sigue coincidiendo con el texto. Si alguien
 * cambia RN-37 en `policy.ts` y no avisa a quien redacta, esto falla y le
 * obliga a mirar el contrato. Es exactamente el escenario que hay que evitar:
 * la plataforma reembolsando un porcentaje distinto del que promete el
 * documento que el usuario aceptó.
 *
 * ⚠️ Si esta comprobación falla, la respuesta NO es cambiar el número del
 * contrato. El contrato lo redacta el cliente; lo que hay que hacer es
 * hablarlo con él y publicar una versión nueva con su `TERMS_VERSION`.
 */

// §13 y §15 del contrato, tal y como están escritos, en los dos idiomas.
const ESPERADO = {
  en: {
    seccion13: "13. Student Cancellations",
    seccion15: "15. Tutor Cancellations",
    early: `refund of ${P.refundPct.studentEarly}%`,
    late: `refund of ${P.refundPct.studentLate}%`,
    tutor: `${P.refundPct.tutorCancels}% refund`,
    cutoff: `${P.cutoffHours} hours`,
  },
  es: {
    seccion13: "13. Cancelaciones por Parte del Alumno",
    seccion15: "15. Cancelaciones por Parte del Tutor",
    early: `reembolso del ${P.refundPct.studentEarly}%`,
    late: `reembolso del ${P.refundPct.studentLate}%`,
    tutor: `reembolso del ${P.refundPct.tutorCancels}%`,
    cutoff: `${P.cutoffHours} horas`,
  },
} as const;

/** Todo el texto de una sección, aplanado, para poder buscar dentro. */
function textoDe(locale: "en" | "es", titulo: string): string {
  const seccion = TERMS[locale].secciones.find((s) => s.titulo === titulo);
  assert.ok(seccion, `[${locale}] falta la sección "${titulo}"`);
  return seccion.bloques
    .flatMap((b) => {
      if (typeof b === "string") return [b];
      if (Array.isArray(b)) return b;
      if ("ol" in b) return b.ol;
      return [b.destacado];
    })
    .join(" ");
}

for (const locale of TERMS_LOCALES) {
  const e = ESPERADO[locale];

  const cancelaAlumno = textoDe(locale, e.seccion13);
  assert.ok(
    cancelaAlumno.includes(e.early),
    `[${locale}] §13 no dice "${e.early}". \`policy.ts\` aplica ${P.refundPct.studentEarly}% al cancelar con antelación: o el contrato o el código está mal.`,
  );
  assert.ok(
    cancelaAlumno.includes(e.late),
    `[${locale}] §13 no dice "${e.late}". \`policy.ts\` aplica ${P.refundPct.studentLate}% al cancelar tarde.`,
  );
  assert.ok(
    cancelaAlumno.includes(e.cutoff),
    `[${locale}] §13 no menciona el umbral de ${P.cutoffHours} h de \`policy.ts\`.`,
  );

  const cancelaTutor = textoDe(locale, e.seccion15);
  assert.ok(
    cancelaTutor.includes(e.tutor),
    `[${locale}] §15 no dice "${e.tutor}". \`policy.ts\` aplica ${P.refundPct.tutorCancels}% cuando cancela el tutor.`,
  );
}

// Las dos versiones tienen que cubrir las mismas secciones: si alguien añade
// una cláusula en un idioma y se olvida del otro, el usuario que lea español
// estaría aceptando algo distinto de lo que dice la versión gobernante.
assert.equal(
  TERMS.en.secciones.length,
  TERMS.es.secciones.length,
  `las dos versiones no tienen el mismo número de secciones (en: ${TERMS.en.secciones.length}, es: ${TERMS.es.secciones.length})`,
);

// Los números de sección tienen que casar uno a uno. Se compara el prefijo
// ("13.", "2.1.") porque el título va traducido pero la numeración no.
for (let i = 0; i < TERMS.en.secciones.length; i++) {
  const num = (t: string) => t.split(" ")[0];
  assert.equal(
    num(TERMS.en.secciones[i].titulo),
    num(TERMS.es.secciones[i].titulo),
    `la sección ${i + 1} está desalineada entre idiomas: "${TERMS.en.secciones[i].titulo}" vs "${TERMS.es.secciones[i].titulo}"`,
  );
}

// La versión es lo que se guarda junto a cada aceptación. Sin formato estable
// no hay forma de saber qué aceptó cada usuario.
assert.match(
  TERMS_VERSION,
  /^\d{4}-\d{2}-\d{2}$/,
  `TERMS_VERSION debe ser una fecha AAAA-MM-DD, y es "${TERMS_VERSION}"`,
);

console.log(
  `✓ términos: ${TERMS.en.secciones.length} secciones en ${TERMS_LOCALES.length} idiomas, v${TERMS_VERSION}, y los reembolsos coinciden con policy.ts (${P.refundPct.studentEarly}/${P.refundPct.studentLate}/${P.refundPct.tutorCancels} con corte a ${P.cutoffHours} h)`,
);


/* ──────────────────────────────────────────────────────────────────────────
 * PARTE 2 · Que la política de cookies siga describiendo lo que el sitio hace
 *
 * POR QUÉ EXISTE. El 22-sep entraron Google Analytics y PostHog, y hasta ese
 * commit el documento afirmaba, con todas las letras, «no usamos cookies de
 * publicidad ni de seguimiento de terceros». Un texto legal que dice lo
 * contrario de lo que el navegador hace no es un texto desactualizado: es uno
 * falso, y el fallo es MUDO —no hay build en rojo, no hay 500, solo una página
 * que miente hasta que alguien la lee—. Exactamente el patrón de la regla de
 * oro 11, pero en prosa.
 *
 * Se comprueba contra el FUENTE como texto y no importando `LEGAL_DOCS` porque
 * ese módulo lleva JSX y `--experimental-strip-types` no lo puede cargar. El
 * efecto es el mismo y de paso caza la frase esté donde esté.
 *
 * ponytail: solo conoce los dos terceros de hoy. Una integración nueva que
 * ponga cookies no la detecta sola — se añade aquí su par (módulo, cookie) en
 * el mismo commit, que es de lo que se acordó nadie la vez anterior.
 * ────────────────────────────────────────────────────────────────────────── */

const legales = readFileSync("src/components/legal/legal-doc.tsx", "utf8");

/** (qué lo enciende, cómo se busca, qué tiene que nombrar el texto). */
const TERCEROS: {
  nombre: string;
  fuente: string;
  marca: string;
  cookie: string;
}[] = [
  {
    nombre: "Google Analytics",
    fuente: "src/components/analitica/google-analytics.tsx",
    marca: "googletagmanager.com",
    cookie: "_ga",
  },
  {
    nombre: "PostHog",
    fuente: "src/instrumentation-client.ts",
    marca: "posthog.init",
    cookie: "posthog",
  },
];

let algunoActivo = false;

for (const t of TERCEROS) {
  let codigo = "";
  try {
    codigo = readFileSync(t.fuente, "utf8");
  } catch {
    continue; // El módulo ya no existe: nada que declarar.
  }
  if (!codigo.includes(t.marca)) continue;

  algunoActivo = true;
  assert.ok(
    legales.includes(t.nombre),
    `el código carga ${t.nombre} (${t.fuente}) pero las páginas legales no lo nombran: hay que declararlo en privacidad §3 y en la política de cookies`,
  );
  assert.ok(
    legales.includes(t.cookie),
    `el código carga ${t.nombre} pero la política de cookies no inventaría su cookie ("${t.cookie}")`,
  );
}

if (algunoActivo) {
  // La frase concreta que se volvió falsa. Se comprueba literal a propósito:
  // reconocer «no rastreamos» en general es un problema abierto, y lo que hay
  // que impedir es que ESTA vuelva.
  assert.ok(
    !legales.includes("no usamos cookies de publicidad ni de seguimiento de terceros"),
    'la política de cookies sigue afirmando «no usamos cookies de publicidad ni de seguimiento de terceros», y el sitio carga analítica de terceros. Es falso, no viejo.',
  );
}

console.log(
  `✓ cookies: ${TERCEROS.filter((t) => legales.includes(t.nombre)).length} tercero(s) de analítica declarados en los legales`,
);
