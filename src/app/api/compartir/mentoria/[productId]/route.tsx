import { ImageResponse } from "next/og";

import { getProductDetail } from "@/lib/catalog/queries";
import { storageUrl } from "@/lib/catalog/format";

/**
 * La imagen para presumir una reserva (reunión del 25-sep, referencia de
 * GoFundMe): tarjeta central sobre fondo plano de marca, con la portada, el
 * nombre de la mentoría y el tutor. Sin fecha ni hora, a propósito: publicar
 * cuándo vas a estar en clase es un dato que no todos quieren mostrar.
 *
 * Pública y sin sesión: todo lo que pinta ya es público en la ficha de la
 * mentoría. `?formato=cuadrada` (1080×1080, WhatsApp/feed); por defecto,
 * historia (1080×1920). Es el MISMO molde: solo cambian el lienzo y el alto de
 * la portada.
 */

const AZUL = "#0080ff";
const NARANJA = "#fe6a00";
const TINTA = "#19191f";
const GRIS = "#6b6b6b";

/**
 * Poppins desde Google Fonts, recortada a los caracteres que se van a pintar
 * (receta de la documentación de `next/og`). Sin `text`, la familia entera pesa
 * cientos de KB; con él, unos pocos.
 */
async function poppins(peso: 600 | 700, texto: string): Promise<ArrayBuffer> {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=Poppins:wght@${peso}&text=${encodeURIComponent(texto)}`,
    )
  ).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("No se pudo cargar Poppins");
  return (await fetch(url)).arrayBuffer();
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { productId } = await params;
  const p = await getProductDetail(productId);
  if (!p) return new Response("No encontrada", { status: 404 });

  const origin = new URL(req.url).origin;
  const cuadrada = new URL(req.url).searchParams.get("formato") === "cuadrada";
  const ancho = 1080;
  const alto = cuadrada ? 1080 : 1920;
  const altoPortada = cuadrada ? 330 : 495;
  const tamTitulo = p.title.length > 60 ? (cuadrada ? 40 : 50) : cuadrada ? 48 : 60;

  // ponytail: el renderizador de `next/og` no lee WebP; esas portadas caen al
  // respaldo de marca. Si algún día abundan, convertirlas al subirlas.
  const portada = /\.(png|jpe?g)$/i.test(p.imagePath ?? "")
    ? storageUrl("product-images", p.imagePath)
    : null;

  const sello = "¡Ya reservé mi mentoría!";
  const dominio = new URL(origin).host;
  const texto = `${p.title}con${p.tutor.displayName}${sello}${dominio}Enséñame ya`;
  const [semi, negrita] = await Promise.all([poppins(600, texto), poppins(700, texto)]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: AZUL,
          fontFamily: "Poppins",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: cuadrada ? 40 : 52,
            fontWeight: 700,
            color: "#fff",
            marginBottom: cuadrada ? 36 : 56,
          }}
        >
          Enséñame ya
        </div>

        <div style={{ display: "flex", position: "relative", width: 880 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              background: "#fff",
              borderRadius: 40,
              overflow: "hidden",
            }}
          >
            {portada ? (
              // El `overflow: hidden` de la tarjeta no recorta un <img> en `next/og`:
              // el redondeo va en la propia imagen.
              // eslint-disable-next-line @next/next/no-img-element -- `next/og` solo entiende <img>
              <img
                src={portada}
                width={880}
                height={altoPortada}
                style={{ objectFit: "cover", borderRadius: "40px 40px 0 0" }}
                alt=""
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: altoPortada,
                  background: `linear-gradient(135deg, ${NARANJA}, #ffb27a)`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- ídem */}
                <img src={`${origin}/img/logo-ya.svg`} width={180} height={196} alt="" />
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                padding: cuadrada ? "36px 48px 76px" : "48px 56px 104px",
              }}
            >
              <div style={{ display: "flex", fontSize: tamTitulo, fontWeight: 700, color: TINTA, lineHeight: 1.2 }}>
                {p.title}
              </div>
              <div style={{ display: "flex", fontSize: cuadrada ? 26 : 32, fontWeight: 600, color: GRIS, marginTop: 28 }}>
                con
              </div>
              <div style={{ display: "flex", fontSize: cuadrada ? 34 : 42, fontWeight: 700, color: TINTA }}>
                {p.tutor.displayName}
              </div>
            </div>
          </div>

          {/* Los dos «stickers» que asoman por el borde, como los de GoFundMe. */}
          <div
            style={{
              display: "flex",
              position: "absolute",
              left: -24,
              bottom: -34,
              padding: "14px 30px",
              borderRadius: 999,
              background: NARANJA,
              color: "#fff",
              fontSize: cuadrada ? 32 : 40,
              fontWeight: 700,
              transform: "rotate(-4deg)",
            }}
          >
            {sello}
          </div>
          <div
            style={{
              display: "flex",
              position: "absolute",
              right: -16,
              bottom: cuadrada ? -84 : -100,
              padding: "10px 26px",
              borderRadius: 999,
              background: "#fff",
              color: AZUL,
              fontSize: cuadrada ? 26 : 30,
              fontWeight: 600,
              transform: "rotate(3deg)",
            }}
          >
            {dominio}
          </div>
        </div>
      </div>
    ),
    {
      width: ancho,
      height: alto,
      fonts: [
        { name: "Poppins", data: semi, weight: 600, style: "normal" },
        { name: "Poppins", data: negrita, weight: 700, style: "normal" },
      ],
      // La mentoría cambia poco; una hora en el CDN evita regenerar por cada toque.
      headers: { "cache-control": "public, max-age=0, s-maxage=3600" },
    },
  );
}
