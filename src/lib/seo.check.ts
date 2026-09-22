/**
 * `npm run check:seo` — que el robots.txt no desindexe lo que vende, y que no
 * se deje abierto lo que pide sesión. Sin red y sin arrancar Next.
 *
 * Los dos fallos que persigue no dan error en ningún sitio:
 *   · un `Disallow: /tutor` que se come `/tutores/<id>` — el catálogo entero
 *     fuera de Google, y el build en verde;
 *   · una carpeta nueva bajo `(app)`/`(auth)`/`(checkout)` que nadie añade a
 *     `RUTAS_PRIVADAS` — Googlebot rastreando pantallas que redirigen al login.
 *
 * El segundo se comprueba contra el disco, no contra una lista escrita a mano:
 * es la única forma de que una ruta que aún no existe quede cubierta.
 */
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { RUTAS_FIJAS, RUTAS_PRIVADAS, bloqueaA, estaBloqueada } from "./seo.ts";

/** Grupos de rutas cuyo contenido SIEMPRE exige sesión (o no es indexable). */
const GRUPOS_CON_GUARDA = [
  "(app)",
  "(auth)",
  "(checkout)",
  "(recovery)",
  "(room)",
];

/** Rutas de ejemplo con parámetro: lo que `sitemap.ts` emite de verdad. */
const DINAMICAS_PUBLICAS = [
  "/tutores/8f1c2d3e-0000-4000-8000-000000000001",
  "/products/8f1c2d3e-0000-4000-8000-000000000002",
  "/categories/matematicas",
  "/academias/academia-ejemplo",
];

const casos: [string, () => void][] = [
  [
    "ninguna ruta del sitemap está bloqueada por el robots",
    () => {
      for (const ruta of [...RUTAS_FIJAS, ...DINAMICAS_PUBLICAS]) {
        const culpable = RUTAS_PRIVADAS.find((p) => bloqueaA(p, ruta));
        assert.equal(
          culpable,
          undefined,
          `«${ruta}» se anuncia en el sitemap pero «Disallow: ${culpable}» la bloquea`,
        );
      }
    },
  ],
  [
    "el panel del tutor está cerrado sin llevarse el catálogo por delante",
    () => {
      assert.ok(estaBloqueada("/tutor"), "/tutor debería estar bloqueada");
      assert.ok(estaBloqueada("/tutor/perfil"), "/tutor/perfil debería estarlo");
      assert.ok(!estaBloqueada("/tutores"), "/tutores NO debe bloquearse");
      assert.ok(
        !estaBloqueada("/tutores/abc"),
        "la ficha pública del tutor NO debe bloquearse",
      );
    },
  ],
  [
    "toda carpeta con guarda que existe en disco está en RUTAS_PRIVADAS",
    () => {
      for (const grupo of GRUPOS_CON_GUARDA) {
        const carpetas = readdirSync(`src/app/${grupo}`, {
          withFileTypes: true,
        })
          .filter((e) => e.isDirectory() && !e.name.startsWith("("))
          .map((e) => e.name);
        assert.ok(
          carpetas.length > 0,
          `${grupo} no tiene carpetas: ¿cambió la estructura?`,
        );
        for (const carpeta of carpetas) {
          assert.ok(
            estaBloqueada(`/${carpeta}`) && estaBloqueada(`/${carpeta}/x`),
            `/${carpeta} vive en ${grupo} (pide sesión) pero el robots.txt la deja abierta — añádela a RUTAS_PRIVADAS`,
          );
        }
      }
    },
  ],
  [
    "las públicas que no se indexan a propósito siguen cerradas",
    () => {
      // El carrito es estado del navegador y el buscador son parámetros
      // infinitos: ninguno de los dos es una página que Google deba tener.
      assert.ok(estaBloqueada("/carrito"));
      assert.ok(estaBloqueada("/search"));
      assert.ok(estaBloqueada("/api/cron/payouts-process"));
    },
  ],
];

let fallos = 0;
for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`  ✓ ${nombre}`);
  } catch (e) {
    fallos++;
    console.error(`  ✗ ${nombre}\n    ${(e as Error).message}`);
  }
}
console.log(
  fallos === 0
    ? `\n✓ check:seo — ${casos.length} comprobaciones`
    : `\n✗ check:seo — ${fallos} fallo(s)`,
);
process.exit(fallos === 0 ? 0 : 1);
