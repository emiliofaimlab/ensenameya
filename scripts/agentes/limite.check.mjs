/** npm run check:agentes — falla si el límite de los subagentes se afloja. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { revisar, MAX_PALABRAS } from "./limite.mjs";

const n = (k) => Array(k).fill("palabra").join(" ");

assert.deepEqual(revisar("Hecho: `src/lib/auth/academia.ts:18`."), []);
assert.deepEqual(revisar(n(MAX_PALABRAS)), []);
assert.equal(revisar(n(MAX_PALABRAS + 1)).length, 1);
assert.ok(revisar("¡Claro! Listo.")[0].startsWith("relleno"));
assert.ok(revisar("Done. I hope this helps")[0].startsWith("relleno"));
// El código no cuenta como prosa.
assert.deepEqual(revisar("Arreglo:\n```ts\n" + n(500) + "\n```"), []);
// El límite no se afloja sin que esto falle.
assert.ok(MAX_PALABRAS <= 200, "MAX_PALABRAS subió de 200");

// El hook de verdad: exit 2 al pasarse, 0 dentro del límite y en el reintento.
const hook = (input) => {
  try {
    execFileSync("node", ["scripts/agentes/limite.mjs"], { input: JSON.stringify(input), stdio: "pipe" });
    return 0;
  } catch (e) { return e.status; }
};
assert.equal(hook({ last_assistant_message: n(MAX_PALABRAS + 50) }), 2);
assert.equal(hook({ last_assistant_message: "Hecho." }), 0);
assert.equal(hook({ last_assistant_message: n(999), stop_hook_active: true }), 0);

// Y el hook está conectado: si alguien lo quita de settings, esto falla.
const settings = JSON.parse((await import("node:fs")).readFileSync(".claude/settings.json", "utf8"));
assert.ok(
  JSON.stringify(settings.hooks?.SubagentStop ?? []).includes("scripts/agentes/limite.mjs"),
  "SubagentStop no ejecuta scripts/agentes/limite.mjs",
);
console.log("check:agentes OK");
