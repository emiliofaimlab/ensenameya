/**
 * `npm run check:bots` — qué se descarta antes de llegar a Sentry, sin red.
 *
 * Existe porque este predicado es el único de todo el repo que decide que un
 * error NO se cuente. Si se pasa de listo, la consecuencia no es un fallo
 * visible: es un error de usuario que nadie ve nunca, que es peor. Los dos
 * casos de abajo son exactamente los que separan una cosa de la otra.
 */
import assert from "node:assert/strict";
import { loEjecutaUnBot, type EventoConTraza } from "./sentry-bot.ts";

/** El evento real del 19-sep-2026 en `/privacy`, recortado a lo que se mira. */
const deUnBot: EventoConTraza = {
  exception: {
    values: [
      {
        stacktrace: {
          frames: [
            { filename: "<script>" },
            { filename: "ext:core/01_core.js" },
          ],
        },
      },
    ],
  },
};

/** El mismo error, pero desde un navegador de verdad. */
const deUnaPersona: EventoConTraza = {
  exception: {
    values: [
      {
        stacktrace: {
          frames: [
            { filename: "app:///_next/static/chunks/44-smpbrkmny5.js" },
            { filename: "app:///_next/static/chunks/main-app.js" },
          ],
        },
      },
    ],
  },
};

const casos: [string, () => void][] = [
  [
    "un marco de Deno (`ext:`) se descarta",
    () => assert.equal(loEjecutaUnBot(deUnBot), true),
  ],
  [
    "el MISMO error desde un navegador SÍ se manda",
    () => assert.equal(loEjecutaUnBot(deUnaPersona), false),
  ],
  [
    "un evento sin traza no se descarta: en la duda, se cuenta",
    () => {
      assert.equal(loEjecutaUnBot({}), false);
      assert.equal(loEjecutaUnBot({ exception: { values: [{}] } }), false);
    },
  ],
];

let fallos = 0;
for (const [nombre, caso] of casos) {
  try {
    caso();
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallos++;
    console.error(`  ✗ ${nombre}\n    ${(e as Error).message}`);
  }
}
console.log(fallos === 0 ? "check:bots OK" : `check:bots — ${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
