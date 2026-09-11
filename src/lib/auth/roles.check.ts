/**
 * Comprobación de las dos funciones puras que deciden a dónde entra alguien:
 * `safeNext` (filtra el `?next=`) y `pickHome` (reparte por rol).
 *
 * Nace de la matriz de casos del flujo de Google (11-sep-2026): el `?next=`
 * viaja a Google y vuelve, así que es superficie de entrada, y el reparto por
 * rol es lo que decidía mal el destino de los tutores.
 *
 *   npm run check:rutas
 */
import assert from "node:assert/strict";
import { safeNext, pickHome, ROLE_HOME, type AppRole } from "./roles.ts";

/* ── safeNext: lo que NO debe dejar salir del sitio ───────────────────── */

// Rutas internas: pasan tal cual, query incluida (M-10).
assert.equal(safeNext("/app", "/x"), "/app");
assert.equal(safeNext("/reservar/7?slot=abc", "/x"), "/reservar/7?slot=abc");

// Ausencia o vacío: al fallback.
assert.equal(safeNext(null, "/x"), "/x");
assert.equal(safeNext(undefined, "/x"), "/x");
assert.equal(safeNext("", "/x"), "/x");

// Absolutas y protocol-relative: fuera.
assert.equal(safeNext("https://evil.com", "/x"), "/x");
assert.equal(safeNext("//evil.com", "/x"), "/x");
assert.equal(safeNext("javascript:alert(1)", "/x"), "/x");

/*
 * ⚠️ LA REDIRECCIÓN ABIERTA, tapada el 11-sep-2026.
 *
 * `\` no es `/`, así que `"/\\evil.com".startsWith("//")` era false y el filtro
 * viejo lo dejaba pasar. Pero el navegador normaliza `\` a `/` al resolver, así
 * que eso es `//evil.com`: protocol-relative, fuera del sitio.
 *
 * Comprobado EN VIVO antes del arreglo: `/login?entrar=1&next=/\\example.com`
 * + entrar con Google terminaba en `http://example.com/`, ejecutado por el
 * `router.replace()` del callback y sin un clic de más.
 */
assert.equal(safeNext("/\\evil.com", "/x"), "/x");
assert.equal(safeNext("/\\/evil.com", "/x"), "/x");
assert.equal(safeNext("//evil.com", "/x"), "/x");
// Los tabuladores y saltos de línea se borran antes de decidir, porque el
// navegador también los ignora al resolver la URL.
assert.equal(safeNext("/\t/evil.com", "/x"), "/x");
assert.equal(safeNext("/\n\\evil.com", "/x"), "/x");
// Y una ruta interna con un `\` más adentro sigue siendo interna: no se tapa
// de más.
assert.equal(safeNext("/buscar?q=a\\b", "/x"), "/buscar?q=a\\b");

/* ── pickHome: el reparto por rol ─────────────────────────────────────── */

const R = (...r: AppRole[]) => r;

// Sin pistas: manda el rango.
assert.equal(pickHome(R("alumno")), ROLE_HOME.alumno);
assert.equal(pickHome(R("alumno", "tutor")), ROLE_HOME.tutor);
assert.equal(pickHome(R("alumno", "admin")), ROLE_HOME.admin);
assert.equal(pickHome(R("alumno", "tutor", "admin")), ROLE_HOME.admin);

// Tutor EN REVISIÓN: no tiene el rol todavía (solo se concede al aprobar),
// así que sin `esTutor` cae al panel de alumno. Ése era el bug.
assert.equal(pickHome(R("alumno")), ROLE_HOME.alumno);
assert.equal(pickHome(R("alumno"), { esTutor: true }), ROLE_HOME.tutor);

// La cookie del último panel manda sobre el rango, pero solo si el rol lo
// permite: una cookie manipulada no abre nada.
assert.equal(pickHome(R("alumno", "admin"), { panel: "alumno" }), ROLE_HOME.alumno);
assert.equal(pickHome(R("alumno", "tutor", "admin"), { panel: "tutor" }), ROLE_HOME.tutor);
assert.equal(pickHome(R("alumno"), { panel: "admin" }), ROLE_HOME.alumno);
assert.equal(pickHome(R("alumno"), { panel: "tutor" }), ROLE_HOME.alumno);
assert.equal(pickHome(R("alumno"), { panel: "tutor", esTutor: true }), ROLE_HOME.tutor);

/*
 * ⚠️ Lo que hace `requireGuest()`: llama a `pickHome(ctx.roles)` a secas, sin
 * `esTutor` ni `panel`. Estas dos líneas son el precio exacto de esa omisión.
 */
assert.equal(pickHome(R("alumno")), ROLE_HOME.alumno); // tutor pendiente → panel de alumno
assert.equal(pickHome(R("alumno", "admin")), ROLE_HOME.admin); // venías de /tutor y te saca a /admin

console.log("✓ roles: safeNext y pickHome se comportan como dice la matriz");
