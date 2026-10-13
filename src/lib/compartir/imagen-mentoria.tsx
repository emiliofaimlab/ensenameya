import { ImageResponse } from "next/og";

import { initialsFrom, priceLabel, storageUrl } from "@/lib/catalog/format";
import type { ProductDetail } from "@/lib/catalog/queries";
import { siteUrl } from "@/lib/site-url";
import { logoYaDataUri } from "@/lib/compartir/logo";

/**
 * EY-223 · la tarjeta con la que el TUTOR promociona su mentoría en redes.
 *
 * Un solo molde y tres lienzos, porque cada red se traga uno distinto:
 *   · `banner` 1200×630 (1.91:1) — la vista previa de un ENLACE en Facebook,
 *     LinkedIn, X y WhatsApp. Es también la imagen Open Graph de la ficha
 *     (`(public)/mentorias/[id]/opengraph-image.tsx`), así que compartir el
 *     enlace a pelo ya enseña la tarjeta.
 *   · `post` 1080×1080 (1:1) — feed de Instagram, o la imagen suelta en WhatsApp.
 *   · `story` 1080×1920 (9:16) — historia de Instagram (y estados de WhatsApp).
 *
 * ⚠️ SOLO DATOS PÚBLICOS: todo lo que se pinta ya está en la ficha de la
 * mentoría (`getProductDetail`, que exige `status = 'active'` y tutor
 * aprobado). Nada de correo, país ni datos de cobro del tutor.
 *
 * No se reutiliza `api/compartir/mentoria/[productId]` (la de «Compartir mi
 * reserva»): esa habla en primera persona del ALUMNO («¡Ya reservé…!») y esta
 * es el anuncio del tutor, con precio y valoración.
 */

export const FORMATOS = {
  banner: { width: 1200, height: 630 },
  post: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
} as const;

export type FormatoImagen = keyof typeof FORMATOS;

export function esFormato(v: string | null | undefined): v is FormatoImagen {
  return v === "banner" || v === "post" || v === "story";
}

const AZUL = "#0080ff";
const NARANJA = "#fe6a00";
const TINTA = "#19191f";
const GRIS = "#6b6b6b";
const AZUL_CLARO = "#e6f2ff";

type Fuente = {
  name: string;
  data: ArrayBuffer;
  weight: 500 | 600 | 700;
  style: "normal";
};

/**
 * Poppins entera (no recortada a un `text=`), una vez por instancia y pesada en
 * memoria: es un TTF por peso de ~150 KB y así la segunda imagen no vuelve a
 * Google. La versión recortada de `compartir/mentoria` es más ligera por
 * petición pero viaja a Google en TODAS.
 *
 * Si Google falla no se rompe la imagen: se pinta con la sans de `next/og`, y
 * la memoria se vacía para reintentar en la próxima.
 */
let fuentes: Promise<Fuente[]> | null = null;

async function cargarPeso(peso: 500 | 600 | 700): Promise<Fuente> {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=Poppins:wght@${peso}`,
      {
        signal: AbortSignal.timeout(5000),
      },
    )
  ).text();
  const url = css.match(
    /src: url\((.+?)\) format\('(opentype|truetype)'\)/,
  )?.[1];
  if (!url) throw new Error("Poppins sin TTF");
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Poppins ${res.status}`);
  return {
    name: "Poppins",
    data: await res.arrayBuffer(),
    weight: peso,
    style: "normal",
  };
}

function poppins(): Promise<Fuente[]> {
  fuentes ??= Promise.all([
    cargarPeso(500),
    cargarPeso(600),
    cargarPeso(700),
  ]).catch(() => {
    fuentes = null;
    return [];
  });
  return fuentes;
}

/**
 * Una imagen de Storage como data URI, o `null`.
 *
 * Se baja AQUÍ y no se deja la URL en el `<img>`: si el renderizador de
 * `next/og` no puede leerla (404, WebP, timeout) revienta la imagen ENTERA con
 * un 500, y una portada rota no debe dejar al tutor sin tarjeta. El renderizador
 * solo entiende PNG y JPEG; lo demás cae al relleno de marca.
 */
async function comoDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const tipo = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (tipo !== "image/png" && tipo !== "image/jpeg" && tipo !== "image/jpg")
      return null;
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    return `data:${tipo};base64,${b64}`;
  } catch {
    return null;
  }
}

function recortar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;
}

/** Estrella dibujada: Poppins no trae «★» y el respaldo no es de fiar. */
function Estrella({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2.5l2.94 5.96 6.56.95-4.75 4.63 1.12 6.54L12 17.5l-5.87 3.08 1.12-6.54L2.5 9.41l6.56-.95z"
        fill="#ffb400"
      />
    </svg>
  );
}

type Datos = {
  titulo: string;
  tutor: string;
  iniciales: string;
  avatar: string | null;
  portada: string | null;
  precio: string;
  valoracion: string | null;
  categoria: string | null;
  duracion: string | null;
  dominio: string;
};

/** Portada, o el relleno de marca (degradado naranja + logo) sin ella. */
function Portada({
  d,
  width,
  height,
  radio,
}: {
  d: Datos;
  width: number;
  height: number;
  radio: string;
}) {
  if (d.portada) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- `next/og` solo entiende <img>
      <img
        src={d.portada}
        width={width}
        height={height}
        style={{ objectFit: "cover", borderRadius: radio }}
        alt=""
      />
    );
  }
  const lado = Math.round(Math.min(width, height) * 0.36);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        borderRadius: radio,
        background: `linear-gradient(135deg, ${NARANJA} 0%, #ff9a4d 55%, #ffc89e 100%)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ídem */}
      <img
        src={logoYaDataUri("#ffffff")}
        width={lado}
        height={Math.round((lado * 61) / 56)}
        alt=""
      />
    </div>
  );
}

function Avatar({ d, size }: { d: Datos; size: number }) {
  if (d.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- `next/og` solo entiende <img>
      <img
        src={d.avatar}
        width={size}
        height={size}
        style={{
          objectFit: "cover",
          borderRadius: 999,
          border: "4px solid #fff",
        }}
        alt=""
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        background: AZUL,
        color: "#fff",
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
      }}
    >
      {d.iniciales}
    </div>
  );
}

function Marca({ color, size }: { color: string; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(size * 0.35),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- `next/og` solo entiende <img> */}
      <img
        src={logoYaDataUri(color === "#ffffff" ? "#ffffff" : NARANJA)}
        width={size}
        height={Math.round((size * 61) / 56)}
        alt=""
      />
      <div
        style={{
          display: "flex",
          fontSize: Math.round(size * 0.68),
          fontWeight: 700,
          color,
        }}
      >
        Enséñame Ya
      </div>
    </div>
  );
}

/** Chips de categoría y duración: lo que dice «de qué va» sin leer el título. */
function Chips({ d, size }: { d: Datos; size: number }) {
  const chips = [d.categoria, d.duracion].filter((c): c is string =>
    Boolean(c),
  );
  if (!chips.length) return null;
  return (
    <div style={{ display: "flex", gap: 12 }}>
      {chips.map((c) => (
        <div
          key={c}
          style={{
            display: "flex",
            padding: `${Math.round(size * 0.3)}px ${Math.round(size * 0.75)}px`,
            borderRadius: 999,
            background: AZUL_CLARO,
            color: AZUL,
            fontSize: size,
            fontWeight: 600,
          }}
        >
          {c}
        </div>
      ))}
    </div>
  );
}

function Tutor({
  d,
  avatar,
  nombre,
}: {
  d: Datos;
  avatar: number;
  nombre: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: Math.round(avatar * 0.28),
      }}
    >
      <Avatar d={d} size={avatar} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: Math.round(nombre * 0.78),
            fontWeight: 500,
            color: GRIS,
          }}
        >
          con
        </div>
        <div
          style={{
            display: "flex",
            fontSize: nombre,
            fontWeight: 700,
            color: TINTA,
            lineHeight: 1.15,
          }}
        >
          {d.tutor}
        </div>
        {d.valoracion ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 4,
              fontSize: Math.round(nombre * 0.72),
              fontWeight: 600,
              color: TINTA,
            }}
          >
            <Estrella size={Math.round(nombre * 0.8)} />
            {d.valoracion}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Precio({ d, size }: { d: Datos; size: number }) {
  return (
    <div
      style={{
        display: "flex",
        padding: `${Math.round(size * 0.32)}px ${Math.round(size * 0.8)}px`,
        borderRadius: 999,
        background: NARANJA,
        color: "#fff",
        fontSize: size,
        fontWeight: 700,
      }}
    >
      {d.precio}
    </div>
  );
}

function tamTitulo(titulo: string, base: number): number {
  if (titulo.length > 70) return Math.round(base * 0.72);
  if (titulo.length > 40) return Math.round(base * 0.86);
  return base;
}

function Banner({ d }: { d: Datos }) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#fff",
        fontFamily: "Poppins",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: 660,
          height: "100%",
          padding: "48px 48px 44px 56px",
        }}
      >
        <Marca color={TINTA} size={44} />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <Chips d={d} size={20} />
          <div
            style={{
              display: "block",
              fontSize: tamTitulo(d.titulo, 54),
              fontWeight: 700,
              color: TINTA,
              lineHeight: 1.15,
              lineClamp: 3,
            }}
          >
            {d.titulo}
          </div>
          <Tutor d={d} avatar={72} nombre={26} />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Precio d={d} size={28} />
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 600,
              color: AZUL,
            }}
          >
            {d.dominio}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          position: "relative",
          width: 540,
          height: "100%",
        }}
      >
        <Portada d={d} width={540} height={630} radio="0" />
        {/* Franja de marca en el corte: separa la portada del texto sin marco. */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 0,
            top: 0,
            width: 12,
            height: 630,
            background: NARANJA,
          }}
        />
      </div>
    </div>
  );
}

/** Post y historia comparten tarjeta; solo cambian lienzo, tamaños y el pie. */
function Vertical({ d, story }: { d: Datos; story: boolean }) {
  const anchoTarjeta = story ? 920 : 940;
  const altoPortada = story ? 560 : 360;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: story ? "center" : "space-between",
        width: "100%",
        height: "100%",
        // En historia, ~250 px arriba y abajo los tapa la interfaz de Instagram:
        // ahí no va nada que haya que leer.
        padding: story ? "250px 80px" : "48px 70px 44px",
        background: `linear-gradient(160deg, ${AZUL} 0%, #0066d6 100%)`,
        fontFamily: "Poppins",
        position: "relative",
      }}
    >
      {/* Dos círculos naranjas de fondo: el mismo acento que la home. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          right: -160,
          top: -160,
          width: 420,
          height: 420,
          borderRadius: 999,
          background: NARANJA,
          opacity: 1,
        }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: -120,
          bottom: -140,
          width: 320,
          height: 320,
          borderRadius: 999,
          background: "#ffffff",
          opacity: 0.08,
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: story ? 28 : 0,
        }}
      >
        <Marca color="#ffffff" size={story ? 64 : 52} />
        {story ? (
          <div
            style={{
              display: "flex",
              fontSize: 54,
              fontWeight: 700,
              color: "#fff",
              marginTop: 24,
              marginBottom: 20,
            }}
          >
            ¡Aprende conmigo!
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: anchoTarjeta,
          background: "#fff",
          borderRadius: 40,
          boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
        }}
      >
        <Portada
          d={d}
          width={anchoTarjeta}
          height={altoPortada}
          radio="40px 40px 0 0"
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: story ? 26 : 18,
            padding: story ? "40px 52px 48px" : "30px 44px 34px",
          }}
        >
          <Chips d={d} size={story ? 26 : 22} />
          <div
            style={{
              display: "block",
              fontSize: tamTitulo(d.titulo, story ? 62 : 50),
              fontWeight: 700,
              color: TINTA,
              lineHeight: 1.15,
              lineClamp: story ? 4 : 2,
            }}
          >
            {d.titulo}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 20,
            }}
          >
            <Tutor d={d} avatar={story ? 104 : 80} nombre={story ? 34 : 28} />
          </div>
          <div style={{ display: "flex" }}>
            <Precio d={d} size={story ? 40 : 32} />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          marginTop: story ? 56 : 0,
        }}
      >
        {story ? (
          <div
            style={{
              display: "flex",
              padding: "18px 40px",
              borderRadius: 999,
              background: "#fff",
              color: AZUL,
              fontSize: 36,
              fontWeight: 700,
            }}
          >
            Reserva en el enlace
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            fontSize: story ? 32 : 28,
            fontWeight: 600,
            color: "#fff",
          }}
        >
          {d.dominio}
        </div>
      </div>
    </div>
  );
}

function valoracion(avg: number | null, n: number | null): string | null {
  if (!avg || !n) return null;
  const media = avg.toLocaleString("es", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${media} · ${n} ${n === 1 ? "reseña" : "reseñas"}`;
}

/**
 * La imagen pedida de una mentoría ya leída. Quien llama resuelve la mentoría
 * (y su 404): aquí ya llega activa y pública.
 */
export async function imagenMentoria(
  p: ProductDetail,
  formato: FormatoImagen,
  opciones?: { headers?: Record<string, string> },
): Promise<ImageResponse> {
  const [fonts, portada, avatar] = await Promise.all([
    poppins(),
    comoDataUri(storageUrl("product-images", p.imagePath)),
    comoDataUri(storageUrl("avatars", p.tutor.avatarPath)),
  ]);

  const tutor = p.tutor.displayName?.trim() || "Tu tutor";
  const d: Datos = {
    titulo: recortar(p.title, 110),
    tutor: recortar(tutor, 40),
    iniciales: initialsFrom(tutor),
    avatar,
    portada,
    precio: priceLabel(p),
    valoracion: valoracion(p.tutor.ratingAvg, p.tutor.ratingCount),
    categoria: p.categories[0]?.name ?? null,
    duracion: p.sessionDurationMin ? `${p.sessionDurationMin} min` : null,
    dominio: new URL(siteUrl()).host.replace(/^www\./, ""),
  };

  return new ImageResponse(
    formato === "banner" ? (
      <Banner d={d} />
    ) : (
      <Vertical d={d} story={formato === "story"} />
    ),
    {
      ...FORMATOS[formato],
      fonts: fonts.length ? fonts : undefined,
      headers: opciones?.headers,
    },
  );
}
