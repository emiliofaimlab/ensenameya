/**
 * Siembra las imágenes que faltaban en el catálogo de DEV: un avatar por tutor
 * (bucket `avatars`) y una portada por clase (bucket `product-images`).
 *
 * Las imágenes se GENERAN aquí, no se descargan: ilustración plana determinista
 * a partir del nombre / del id, renderizada con `sharp` (SVG → PNG). Así no
 * metemos fotos de personas reales en fichas de tutores que no lo son, ni
 * dependemos de un CDN externo. Volver a ejecutarlo reproduce exactamente las
 * mismas imágenes (mismo hash → mismo dibujo) y sobrescribe con `upsert`.
 *
 * Escribe con la sesión de CADA tutor, no con `service_role`: las tablas del
 * catálogo no le tienen `grant` (regla de oro 9) y, además, así el seed pasa por
 * las mismas políticas de RLS que la app. La sesión se abre con un magic link
 * emitido por la Admin API, para no depender de contraseñas.
 *
 *   node supabase/seed/dev-imagenes.mjs            # solo los que están vacíos
 *   node supabase/seed/dev-imagenes.mjs --force    # regenera todo
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const FORCE = process.argv.includes("--force");

// ── env ──────────────────────────────────────────────────────────────────────
for (const line of readFileSync(
  new URL("../../.env.local", import.meta.url),
  "utf8",
).split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("✗ faltan NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE_KEY");
  process.exit(1);
}

// ── utilidades deterministas ─────────────────────────────────────────────────
/** FNV-1a: mismo texto → mismo entero, sin dependencias. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
/** Secuencia estable de enteros a partir de una semilla. */
function picker(seed) {
  let s = hash(seed);
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

// ── avatares ─────────────────────────────────────────────────────────────────
const FONDOS = [
  ["#ffd9b8", "#fe6a00"],
  ["#cfe4ff", "#0080ff"],
  ["#ffd6e4", "#e8437f"],
  ["#d3f2ee", "#12b3a8"],
  ["#e3dcff", "#7c5cff"],
  ["#ffe8b5", "#f0a500"],
  ["#d8f0d9", "#1f9d55"],
  ["#ffe0d2", "#ff6a3d"],
];
const TONOS_PIEL = ["#f7d7bd", "#efc39c", "#dda57b", "#c5875e", "#a2653f"];
const PELOS = ["#2f2a26", "#4a3427", "#6b4326", "#8d5524", "#1c1a18", "#7d6a58"];
const ROPAS = ["#2b3a55", "#fe6a00", "#0080ff", "#3f4a5a", "#12b3a8", "#e8437f"];

/** Ilustración plana de una persona. Legible incluso recortada a 44 px. */
function svgAvatar(seed) {
  const p = picker(`avatar:${seed}`);
  const [bg1, bg2] = FONDOS[p(FONDOS.length)];
  const piel = TONOS_PIEL[p(TONOS_PIEL.length)];
  const pelo = PELOS[p(PELOS.length)];
  const ropa = ROPAS[p(ROPAS.length)];
  const peinado = p(5);
  const sombra = mezclar(piel, "#000000", 0.12);

  // Melena por detrás de la cara (solo en los peinados largos).
  const detras =
    peinado === 1
      ? `<path d="M150 250 C150 120 362 120 362 250 L372 400 C330 360 182 360 140 400 Z" fill="${pelo}"/>`
      : peinado === 2
        ? `<circle cx="256" cy="112" r="46" fill="${pelo}"/>`
        : "";

  // Flequillo / parte superior.
  const arriba = [
    // 0 · corto clásico
    `<path d="M158 236 C158 128 354 128 354 236 C354 196 330 178 256 178 C196 178 172 196 158 236 Z" fill="${pelo}"/>`,
    // 1 · largo con raya
    `<path d="M156 240 C156 130 356 130 356 240 C336 200 300 186 262 200 C228 186 182 194 156 240 Z" fill="${pelo}"/>`,
    // 2 · recogido
    `<path d="M160 234 C160 132 352 132 352 234 C340 194 300 180 256 180 C212 180 174 196 160 234 Z" fill="${pelo}"/>`,
    // 3 · rizado
    `<g fill="${pelo}"><circle cx="180" cy="196" r="42"/><circle cx="228" cy="164" r="46"/><circle cx="284" cy="164" r="46"/><circle cx="332" cy="198" r="42"/></g>`,
    // 4 · muy corto
    `<path d="M164 238 C164 146 348 146 348 238 C332 210 300 196 256 196 C212 196 180 210 164 238 Z" fill="${pelo}"/>`,
  ][peinado];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="${86 + p(60)}" cy="${96 + p(60)}" r="${46 + p(34)}" fill="#ffffff" opacity="0.14"/>
  <circle cx="${400 - p(50)}" cy="${140 + p(50)}" r="${28 + p(26)}" fill="#ffffff" opacity="0.10"/>
  ${detras}
  <!-- hombros -->
  <path d="M78 512 C78 404 158 348 256 348 C354 348 434 404 434 512 Z" fill="${ropa}"/>
  <path d="M232 320 h48 v72 h-48 Z" fill="${sombra}"/>
  <!-- cara -->
  <ellipse cx="180" cy="248" rx="16" ry="24" fill="${piel}"/>
  <ellipse cx="332" cy="248" rx="16" ry="24" fill="${piel}"/>
  <ellipse cx="256" cy="238" rx="98" ry="112" fill="${piel}"/>
  ${arriba}
  <g fill="#2b2b2b">
    <ellipse cx="222" cy="248" rx="9" ry="11"/>
    <ellipse cx="290" cy="248" rx="9" ry="11"/>
  </g>
  <g stroke="${mezclar(pelo, "#000000", 0.15)}" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M206 224 q16 -12 32 -2"/><path d="M274 222 q16 -10 32 2"/>
  </g>
  <path d="M226 292 q30 26 60 0" stroke="#a8543f" stroke-width="8" stroke-linecap="round" fill="none"/>
</svg>`;
}

/** Mezcla dos colores hex — para sombras coherentes con el tono base. */
function mezclar(a, b, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = n(a);
  const [br, bg, bb] = n(b);
  const mix = (x, y) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${mix(ar, br)}${mix(ag, bg)}${mix(ab, bb)}`;
}

// ── portadas de clase ────────────────────────────────────────────────────────
const PALETA = {
  programacion: ["#2f9bff", "#0b3aa8"],
  matematicas: ["#ff8a2b", "#c23b00"],
  ciencias: ["#2ad0c3", "#06746f"],
  idiomas: ["#9b83ff", "#4527c9"],
  musica: ["#ff6fa3", "#b3145a"],
  "arte-y-diseno": ["#ffa14d", "#e0355f"],
  negocios: ["#38c479", "#0d5c33"],
  "preparacion-examenes": ["#ffc02e", "#b46a00"],
  "habilidades-profesionales": ["#ff8a63", "#b52d5b"],
  "vida-y-creatividad": ["#33ccf0", "#0a6c8f"],
};
const PALETA_DEFECTO = ["#ff9a3d", "#0080ff"];

/** Icono de línea, centrado en (0,0) dentro de una caja de ~200. */
const MOTIVOS = {
  programacion: `<polyline points="-70,-40 -118,0 -70,40"/><polyline points="70,-40 118,0 70,40"/><line x1="26" y1="-52" x2="-26" y2="52"/>`,
  matematicas: `<line x1="-96" y1="-34" x2="-24" y2="-34"/><line x1="-60" y1="-70" x2="-60" y2="2"/>
     <line x1="30" y1="-64" x2="94" y2="0"/><line x1="94" y1="-64" x2="30" y2="0"/>
     <line x1="-96" y1="52" x2="-24" y2="52"/><line x1="-96" y1="86" x2="-24" y2="86"/>
     <circle cx="62" cy="52" r="9"/><circle cx="62" cy="86" r="9"/>`,
  ciencias: `<circle cx="0" cy="0" r="20"/><ellipse cx="0" cy="0" rx="106" ry="42"/>
     <ellipse cx="0" cy="0" rx="106" ry="42" transform="rotate(60)"/>
     <ellipse cx="0" cy="0" rx="106" ry="42" transform="rotate(120)"/>`,
  idiomas: `<path d="M-112 -66 h122 a18 18 0 0 1 18 18 v56 a18 18 0 0 1 -18 18 h-72 l-34 30 v-30 h-16 a18 18 0 0 1 -18 -18 v-56 a18 18 0 0 1 18 -18 z"/>
     <path d="M40 -10 h72 a18 18 0 0 1 18 18 v50 a18 18 0 0 1 -18 18 h-30 l-30 26 v-26 h-12 a18 18 0 0 1 -18 -18 v-50 a18 18 0 0 1 18 -18 z"/>`,
  musica: `<ellipse cx="-62" cy="56" rx="30" ry="22" transform="rotate(-18 -62 56)"/>
     <ellipse cx="66" cy="34" rx="30" ry="22" transform="rotate(-18 66 34)"/>
     <line x1="-34" y1="48" x2="-22" y2="-64"/><line x1="94" y1="26" x2="94" y2="-86"/>
     <path d="M-22 -64 L94 -86 L94 -46 L-22 -24 Z"/>`,
  "arte-y-diseno": `<circle cx="-64" cy="-30" r="40"/><rect x="20" y="-70" width="80" height="80" rx="10"/>
     <polygon points="-10,86 -66,86 -38,34"/><path d="M26 46 q34 -30 74 -6"/>`,
  negocios: `<line x1="-104" y1="76" x2="104" y2="76"/>
     <rect x="-86" y="6" width="44" height="70"/><rect x="-18" y="-34" width="44" height="110"/><rect x="50" y="-74" width="44" height="150"/>
     <polyline points="-86,-40 -18,-72 50,-108"/>`,
  "preparacion-examenes": `<rect x="-94" y="-90" width="150" height="180" rx="14"/>
     <line x1="-62" y1="-44" x2="24" y2="-44"/><line x1="-62" y1="-4" x2="24" y2="-4"/>
     <polyline points="-4,52 34,90 106,4"/>`,
  "habilidades-profesionales": `<rect x="-26" y="-100" width="52" height="104" rx="26"/>
     <path d="M-64 -22 a64 64 0 0 0 128 0"/><line x1="0" y1="42" x2="0" y2="86"/><line x1="-44" y1="86" x2="44" y2="86"/>`,
  "vida-y-creatividad": `<path d="M-96 78 l22 -66 l88 -88 l44 44 l-88 88 z"/><line x1="-74" y1="12" x2="-30" y2="56"/>
     <path d="M64 -84 l10 -26 l10 26 l26 10 l-26 10 l-10 26 l-10 -26 l-26 -10 z"/>`,
};
const MOTIVO_DEFECTO = `<circle cx="0" cy="0" r="60"/><path d="M-96 60 q96 -110 192 0"/>`;

function svgPortada(seed, slug) {
  const p = picker(`cover:${seed}`);
  const [c1, c2] = PALETA[slug] ?? PALETA_DEFECTO;
  const motivo = MOTIVOS[slug] ?? MOTIVO_DEFECTO;
  const giro = [0, 25, 45, 70][p(4)];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="828" height="420" viewBox="0 0 828 420">
  <defs>
    <linearGradient id="g" gradientTransform="rotate(${giro} 0.5 0.5)">
      <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="828" height="420" fill="url(#g)"/>
  <g fill="#ffffff">
    <circle cx="${60 + p(160)}" cy="${40 + p(80)}" r="${90 + p(70)}" opacity="0.10"/>
    <circle cx="${640 + p(160)}" cy="${300 + p(90)}" r="${80 + p(90)}" opacity="0.12"/>
    <circle cx="${300 + p(300)}" cy="${p(60)}" r="${50 + p(50)}" opacity="0.07"/>
  </g>
  <g transform="translate(414 210) scale(0.86)" fill="none" stroke="#ffffff" stroke-opacity="0.92"
     stroke-width="13" stroke-linecap="round" stroke-linejoin="round">
    ${motivo}
  </g>
</svg>`;
}

const png = (svg) =>
  sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

// ── siembra ──────────────────────────────────────────────────────────────────
const admin = createClient(URL_, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(URL_, ANON, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Sesión de un usuario sin su contraseña: magic link emitido por la Admin API. */
async function sesionDe(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const cli = createClient(URL_, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const v = await cli.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (v.error) throw new Error(`verifyOtp(${email}): ${v.error.message}`);
  return cli;
}

const { data: tutores, error: eT } = await anon
  .from("tutors_public")
  .select("profile_id, display_name, headline, avatar_path");
if (eT) throw new Error(`tutors_public: ${eT.message}`);

const { data: productos, error: eP } = await anon
  .from("products")
  .select("id, title, tutor_id, image_path, product_categories(categories(slug))");
if (eP) throw new Error(`products: ${eP.message}`);

const { data: usuarios } = await admin.auth.admin.listUsers({ perPage: 200 });
const emailDe = new Map(usuarios.users.map((u) => [u.id, u.email]));

// Los productos se agrupan por tutor: una sola sesión por tutor.
const porTutor = new Map();
for (const t of tutores) porTutor.set(t.profile_id, { tutor: t, productos: [] });
for (const pr of productos) {
  if (!porTutor.has(pr.tutor_id))
    porTutor.set(pr.tutor_id, { tutor: null, productos: [] });
  porTutor.get(pr.tutor_id).productos.push(pr);
}

let avatares = 0;
let portadas = 0;
const fallos = [];

for (const [uid, { tutor, productos: suyos }] of porTutor) {
  const email = emailDe.get(uid);
  if (!email) {
    fallos.push(`sin cuenta auth: ${uid}`);
    continue;
  }
  let cli;
  try {
    cli = await sesionDe(email);
  } catch (e) {
    fallos.push(e.message);
    continue;
  }

  // ── avatar del tutor ──
  if (tutor && (FORCE || !tutor.avatar_path)) {
    const nombre = tutor.display_name ?? tutor.headline ?? email;
    const ruta = `${uid}/avatar.png`;
    const buf = await png(svgAvatar(nombre));
    const up = await cli.storage
      .from("avatars")
      .upload(ruta, buf, { contentType: "image/png", upsert: true });
    if (up.error) fallos.push(`avatar ${nombre}: ${up.error.message}`);
    else {
      const a = await cli
        .from("tutor_profiles")
        .update({ avatar_path: ruta })
        .eq("profile_id", uid);
      // El header de la app lee `profiles.avatar_path`; que no quede desfasado.
      const b = await cli
        .from("profiles")
        .update({ avatar_path: ruta })
        .eq("id", uid);
      if (a.error || b.error)
        fallos.push(
          `avatar ${nombre}: ${(a.error ?? b.error).message}`,
        );
      else {
        avatares++;
        console.log(`  ✓ avatar · ${nombre}`);
      }
    }
  }

  // ── portadas de sus clases ──
  for (const pr of suyos) {
    if (!FORCE && pr.image_path) continue;
    const slug = pr.product_categories?.[0]?.categories?.slug ?? null;
    const ruta = `${uid}/${pr.id}.png`;
    const buf = await png(svgPortada(pr.id, slug));
    const up = await cli.storage
      .from("product-images")
      .upload(ruta, buf, { contentType: "image/png", upsert: true });
    if (up.error) {
      fallos.push(`portada ${pr.title}: ${up.error.message}`);
      continue;
    }
    const { error } = await cli
      .from("products")
      .update({ image_path: ruta })
      .eq("id", pr.id);
    if (error) fallos.push(`portada ${pr.title}: ${error.message}`);
    else {
      portadas++;
      console.log(`  ✓ portada · ${pr.title}`);
    }
  }

  await cli.auth.signOut();
}

console.log(`\n${avatares} avatares · ${portadas} portadas`);
if (fallos.length) {
  console.error(`\n✗ ${fallos.length} fallo(s):`);
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
