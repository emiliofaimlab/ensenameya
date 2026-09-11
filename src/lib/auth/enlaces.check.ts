/**
 * Comprobación: NINGUNA superficie pública o compartida enlaza a pelo a una
 * ruta con guarda.
 *
 * ## Por qué existe
 *
 * Dos pantallas en blanco en producción, el 11-sep-2026, con la misma forma.
 * Un enlace de cliente que cruza de grupo de rutas —de `(public)` a `(app)`— y
 * se encuentra un `redirect()` de SERVIDOR deja al router de Next con el árbol
 * vacío: pantalla en blanco y el RSC pedido en bucle (medido: 1367 peticiones
 * en 5 segundos al pulsar «Mi cuenta»). El mismo redirect DENTRO de `(app)`
 * renderiza bien, que es por qué el fallo parecía caprichoso y por qué se
 * escapó dos veces.
 *
 * La regla que sale de ahí: **desde fuera de `(app)` no se enlaza a una ruta
 * con guarda escribiéndola a mano**. El destino se resuelve en servidor —
 * `toHeaderUser`, `getVisitorState`, `destinoDeUsuario`— y se pinta ya
 * resuelto, que además es lo que el guarda haría de todas formas.
 *
 * Esto NO sustituye a la red de ejecución (`red-anti-blanco.tsx`): la estática
 * solo ve literales, y un `href` calculado se le escapa. Son dos redes con
 * agujeros de distinto tamaño, a propósito.
 *
 *   npm run check:enlaces
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Primer segmento de cada ruta que vive bajo un layout con guarda. */
const GUARDADAS = [
  "account", "admin", "agendar", "app", "chat", "onboarding",
  "pagos", "pedidos", "referidos", "reservar", "reservas", "room", "tutor",
];

/**
 * Dónde se aplica: lo que puede pintarse FUERA de `(app)`. Dentro de `(app)`
 * el usuario ya pasó el guarda, y está medido que ahí el rebote no rompe.
 */
const SUPERFICIES = [
  "src/app/(public)",
  "src/components/layout",
  "src/components/home",
  "src/components/auth",
  "src/components/catalog",
];

/**
 * Excepciones, cada una con su motivo. Una línea aquí es una decisión, no un
 * descuido: si algo entra, que se lea por qué.
 */
const PERMITIDOS: { fichero: string; ruta: string; motivo: string }[] = [];

const raiz = process.cwd();
// `/tutor` sí, `/tutors` no: el plural es la lista PÚBLICA de tutores.
const RE = new RegExp(
  `(?:href|action)\\s*=\\s*["'\`](/(?:${GUARDADAS.join("|")}))(?![A-Za-z0-9-])`,
  "g",
);
// `router.push("/app")` y compañía cuentan igual: también son navegación de
// cliente hacia el guarda.
const RE_ROUTER = new RegExp(
  `router\\.(?:push|replace)\\(\\s*["'\`](/(?:${GUARDADAS.join("|")}))(?![A-Za-z0-9-])`,
  "g",
);

function ficheros(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(ficheros(p));
    else if (/\.tsx?$/.test(p) && !/\.check\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const hallazgos: string[] = [];
for (const sup of SUPERFICIES) {
  let lista: string[];
  try {
    lista = ficheros(join(raiz, sup));
  } catch {
    continue; // la carpeta puede no existir; no es asunto de este check
  }
  for (const f of lista) {
    const rel = relative(raiz, f);
    const texto = readFileSync(f, "utf8");
    const lineas = texto.split("\n");
    for (const re of [RE, RE_ROUTER]) {
      for (const m of texto.matchAll(re)) {
        const ruta = m[1];
        if (PERMITIDOS.some((p) => rel.includes(p.fichero) && p.ruta === ruta)) {
          continue;
        }
        const linea =
          texto.slice(0, m.index).split("\n").length;
        hallazgos.push(
          `${rel}:${linea}  →  ${ruta}\n      ${lineas[linea - 1]?.trim().slice(0, 100)}`,
        );
      }
    }
  }
}

if (hallazgos.length) {
  console.error(
    `\n✗ ${hallazgos.length} enlace(s) a pelo hacia rutas con guarda, desde fuera de (app):\n`,
  );
  for (const h of hallazgos) console.error("  " + h + "\n");
  console.error(
    "  El destino se resuelve en servidor y se pinta ya resuelto\n" +
      "  (`toHeaderUser`, `getVisitorState`, `destinoDeUsuario`). Si el enlace\n" +
      "  es correcto tal cual, añádelo a PERMITIDOS con su motivo.\n",
  );
}
assert.equal(hallazgos.length, 0, "enlaces a pelo hacia rutas con guarda");

console.log(
  `✓ enlaces: ninguna superficie pública o compartida enlaza a pelo a las ${GUARDADAS.length} rutas con guarda`,
);
