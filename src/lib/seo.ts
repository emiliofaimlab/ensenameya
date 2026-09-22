/**
 * Lo que Google puede ver y lo que no. Vive aquí, y no dentro de `robots.ts`,
 * porque `npm run check:seo` lo cruza contra las carpetas reales de `src/app/`
 * sin arrancar Next: una carpeta nueva con guarda que nadie añada a esta lista
 * es un fallo MUDO —la ruta se indexa, Google la rastrea, redirige al login y
 * el sitio acumula páginas basura— exactamente del tipo que describe la regla
 * de oro 11.
 */

/**
 * Prefijos que NO se rastrean. Son las rutas con guarda de sesión (`(app)`,
 * `(auth)`, `(checkout)`, `(recovery)`, `(room)`), la API, y las dos públicas
 * que no tiene sentido indexar: el carrito (estado del navegador) y el buscador
 * (parámetros infinitos → crawl budget tirado).
 *
 * ⚠️ El match de robots.txt es por PREFIJO DE CADENA, no por segmento de ruta.
 * `Disallow: /tutor` bloquea también `/tutors/<id>`, o sea justo el catálogo
 * que queremos indexar. Por eso el panel del tutor se declara en dos patrones
 * —`/tutor$` (la página índice) y `/tutor/` (lo que cuelga)— y no como `/tutor`
 * a secas. El check de abajo es lo que impide que vuelva a pasar.
 */
export const RUTAS_PRIVADAS = [
  "/api/",
  "/account",
  "/admin",
  "/agendar",
  "/app",
  "/chat",
  "/onboarding",
  "/pagos",
  "/pedidos",
  "/referidos",
  "/regalar",
  "/reservar",
  "/reservas",
  "/tutor$",
  "/tutor/",
  "/login",
  "/signup",
  "/reset",
  "/room",
  "/carrito",
  "/search",
] as const;

/**
 * Las públicas sin parámetro. Las de `[slug]`/`[id]` —tutores, mentorías,
 * categorías y academias— las pone `sitemap.ts` leyendo la base: son las que
 * cambian, y las que de verdad traen tráfico.
 */
export const RUTAS_FIJAS = [
  "/",
  "/tutors",
  "/classes",
  "/categories",
  "/academias",
  "/about",
  "/how-it-works",
  "/contacto",
  "/terms",
  "/terms/es",
  "/privacy",
  "/cookies",
] as const;

/**
 * El match de un patrón de `Disallow` contra una ruta, como lo hace Google:
 * prefijo de cadena, con `$` para anclar el final. No contempla `*` porque
 * ningún patrón de `RUTAS_PRIVADAS` lo usa — si algún día lo usa, esto tiene
 * que crecer y el check dirá que no cuadra.
 */
export function bloqueaA(patron: string, ruta: string): boolean {
  return patron.endsWith("$")
    ? ruta === patron.slice(0, -1)
    : ruta.startsWith(patron);
}

/** ¿Esta ruta cae bajo algún `Disallow`? */
export function estaBloqueada(ruta: string): boolean {
  return RUTAS_PRIVADAS.some((p) => bloqueaA(p, ruta));
}
