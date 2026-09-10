import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BarChart3Icon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  EyeIcon,
  GlobeIcon,
  StarIcon,
  VideoIcon,
  ZapIcon,
} from "lucide-react";

import { getSessionContext, getViewerTimezone } from "@/lib/auth/server";
import { ContactTutor } from "@/components/chat/contact-tutor";
import { tutorResponseTime } from "@/components/chat/conversations";
import { responseTimeLabel } from "@/components/chat/types";
import { Container } from "@/components/layout/container";
import { BookingPanel } from "@/components/catalog/booking-panel";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { ProductCard } from "@/components/catalog/product-card";
import { ProductCover } from "@/components/catalog/product-cover";
import { RegistrarVisita } from "@/components/catalog/registrar-visita";
import { ShareButton } from "@/components/catalog/share-button";
import { LEVELS, LANGUAGES } from "@/components/catalog/product-filters";
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";
import {
  getProductDetail,
  listProductReviews,
  listTutorProducts,
  listTutorReviews,
} from "@/lib/catalog/queries";
import { initialsFrom, priceDisplay, storageUrl } from "@/lib/catalog/format";
import type { Faq } from "@/lib/tutor-faqs";

/**
 * FAQ **de plataforma**: las que contesta Enséñame Ya, no el tutor. Respuestas
 * verificadas: RN-37 (reembolsos), RN-38 (24 h), US-801 (sala).
 *
 * §3.7 · ya NO son un último recurso que solo sale cuando el tutor no escribió
 * las suyas: son un GRUPO PROPIO, con su rótulo, debajo del grupo del tutor.
 * Eso cierra de paso el aviso del Doc 22 (G1) —que la ficha enseñaba cuatro
 * preguntas nuestras firmadas visualmente como suyas— sin tocar la base.
 *
 * Se retira la de la política de cancelación: está a dos centímetros, dentro
 * del panel de reserva y plegada (§5.13), y repetirla aquí era la tercera vez
 * que la misma página cuenta lo mismo.
 */
const PRODUCT_FAQ = [
  {
    q: "¿Qué pasa si necesito reprogramar una sesión?",
    a: "Puedes reagendar con al menos 24 horas de anticipación sin coste. Con menos de 24 horas de aviso se aplica la política de cancelación de la plataforma.",
  },
  {
    q: "¿Necesito conocimientos previos para tomar esta mentoría?",
    // El cierre manda a preguntar ANTES de pagar, y dice DÓNDE está el botón:
    // «escríbele» sin señalar el sitio deja al alumno buscándolo (§7).
    a: "Depende de lo que el tutor indique en la descripción. Si tienes dudas, escríbele antes de reservar: el botón está en «Tu tutor».",
  },
  {
    q: "¿Cómo se imparten las mentorías en vivo?",
    a: "Son sesiones 1 a 1 en una sala de video privada integrada en la plataforma. Entras desde tu panel a la hora de la sesión; no necesitas instalar nada.",
  },
];

type BloqueDescripcion =
  { tipo: "parrafo"; texto: string } | { tipo: "lista"; items: string[] };

/**
 * §5.9 · «Qué vas a conquistar» sale de un texto libre (`products.description`)
 * y puede traer las dos cosas: párrafos y viñetas.
 *
 * ⚠️ LO QUE ESTABA MAL. `toBullets` trataba como ítem CUALQUIER línea no vacía
 * en cuanto hubiera más de una, así que una descripción de dos párrafos —lo más
 * normal que escribe un tutor— salía como dos ticks verdes, o sea prometiendo
 * como resultados lo que era prosa de presentación. Y al revés: un texto mixto
 * tenía que elegir, porque la función devolvía o lista o nada.
 *
 * Ahora es **ítem solo lo que el tutor marcó como ítem** (`-`, `•` o `*`) y el
 * resto es prosa, en el ORDEN en que lo escribió: un texto mixto pinta párrafo,
 * lista y párrafo si así viene. Las líneas en blanco separan bloques.
 */
function bloquesDeDescripcion(text: string): BloqueDescripcion[] {
  const bloques: BloqueDescripcion[] = [];
  for (const cruda of text.split("\n")) {
    const linea = cruda.trim();
    if (!linea) continue;
    const item = /^[-•*]\s*/.test(linea);
    const ultimo = bloques[bloques.length - 1];
    if (item) {
      const texto = linea.replace(/^[-•*]\s*/, "").trim();
      if (!texto) continue;
      // Viñetas consecutivas = una sola lista; una viñeta después de un párrafo
      // abre lista nueva.
      if (ultimo?.tipo === "lista") ultimo.items.push(texto);
      else bloques.push({ tipo: "lista", items: [texto] });
    } else {
      // Dos líneas seguidas SIN viñeta son dos párrafos, no uno partido: el
      // tutor pulsó Intro a propósito y unirlas cambiaría lo que escribió.
      bloques.push({ tipo: "parrafo", texto: linea });
    }
  }
  return bloques;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductDetail(id);
  if (!product) return { title: "Mentoría" };

  const portada = storageUrl("product-images", product.imagePath);
  // §5.6 · la descripción de Google y de la vista previa de WhatsApp es el
  // `outcome` —la promesa que escribió el tutor—, no el título repetido. Sin
  // `outcome` se cae a una frase de plataforma en vez de inventarle una.
  const description =
    product.outcome ??
    `Mentoría 1:1 en vivo con ${product.tutor.displayName ?? "tu tutor"} en Enséñame Ya.`;
  const url = `/products/${id}`;

  return {
    title: `${product.title} · Enséñame Ya`,
    description,
    // Relativas: las resuelve el `metadataBase` del layout raíz (§5.6).
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title: `${product.title} · Enséñame Ya`,
      description,
      url,
      // Sin foto no se manda imagen: el relleno de `ProductCover` es un SVG en
      // línea, no un asset con URL que una vista previa pueda cargar.
      images: portada ? [{ url: portada }] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ d?: string; h?: string; m?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  /**
   * §5.8 · UNA sola tanda para todo lo que depende solo del id. Hasta hoy eran
   * tres `await` en cascada —y uno de ellos, la zona horaria, escondido DENTRO
   * del JSX (`timeZone={await getViewerTimezone()}`), que es la peor de las
   * cascadas porque no se ve al leer la función—.
   *
   * ⚠️ La sesión entra aquí, y es NUEVO en esta página: hasta hoy la ficha de la
   * mentoría no consultaba Auth. La necesita `ContactTutor` para saber si el
   * botón escribe o abre el alta (§3.4). Va por `getSessionContext()`, que es
   * `getClaims()` + `cache()`, no `auth.getUser()`.
   */
  const [product, resenas, timeZone, { user }] = await Promise.all([
    getProductDetail(id),
    listProductReviews(id),
    getViewerTimezone(),
    getSessionContext(),
  ]);
  if (!product) notFound();

  /**
   * Segunda tanda: lo que necesita el id del TUTOR, que solo se sabe después de
   * la primera. Son dos niveles de cascada y no cuatro — las tres van juntas.
   *
   * Las reseñas del tutor solo se piden cuando la mentoría no tiene ninguna
   * propia (§3.5: ahí se enseñan las suyas con otro rótulo). Con reseñas
   * propias la promesa ya resuelta no viaja a la base.
   */
  const hayResenasPropias = resenas.reviews.length > 0;
  const [otrasMentorias, respuestaMin, resenasTutor] = await Promise.all([
    listTutorProducts(product.tutor.id, product.id, 2),
    tutorResponseTime(product.tutor.id),
    hayResenasPropias
      ? Promise.resolve<Awaited<ReturnType<typeof listTutorReviews>>>([])
      : listTutorReviews(product.tutor.id),
  ]);

  const tutorName =
    product.tutor.displayName ?? product.tutor.headline ?? "Tutor";
  // El nombre de pila es el que va en los títulos («Otras mentorías de
  // Valentina»): el apellido no aporta y rompe las líneas.
  const nombreCorto = tutorName.trim().split(/\s+/)[0] || tutorName;
  const tutorAvatar = storageUrl("avatars", product.tutor.avatarPath);
  const portada = storageUrl("product-images", product.imagePath);
  const respuesta = responseTimeLabel(respuestaMin);
  // Escribirse a uno mismo no es una conversación (la RPC lo rechaza igual;
  // esto es para no enseñar un botón que solo puede fallar).
  const esMiMentoria = user?.id === product.tutor.id;

  const bloques = product.description
    ? bloquesDeDescripcion(product.description)
    : [];

  /** §5.3 · la valoración del hero es la de ESTA mentoría, no la del tutor. */
  const notaMentoria = resenas.avg;
  const totalMentoria = resenas.count;
  const hayValoracion = notaMentoria !== null && totalMentoria > 0;

  /** Las que se pintan en «Reseñas»: propias si las hay, si no las del tutor. */
  const listaResenas = hayResenasPropias ? resenas.reviews : resenasTutor;
  const notaLista = hayResenasPropias ? notaMentoria : product.tutor.ratingAvg;
  const totalLista = hayResenasPropias
    ? totalMentoria
    : product.tutor.ratingCount;

  const nivel = LEVELS.find((l) => l.id === product.level)?.label ?? null;
  const idioma =
    LANGUAGES.find((l) => l.id === product.language)?.label ?? null;
  const categoria = product.categories[0] ?? null;

  // RV-08 · manda el total de la reserva, no la tarifa (ver `priceDisplay`).
  const precio = priceDisplay(product);
  // La duración es la de UNA sesión, también en paquetes: cuántas hay ya lo
  // dice la nota del precio («paquete · 4 sesiones»).
  const duracion = product.sessionDurationMin
    ? `${product.sessionDurationMin} min`
    : null;

  /**
   * §3.7 · dos grupos con rótulo. El del tutor primero: lo específico contesta
   * antes que lo general, y quien está mirando ESTA mentoría pregunta primero
   * por ella. Un grupo sin preguntas no pinta ni su rótulo.
   *
   * ⚠️ NO SE DEDUPLICA, ni dentro de un grupo ni entre los dos. Cualquier
   * criterio de igualdad sobre texto escrito a mano (¿mayúsculas?, ¿tildes?,
   * ¿signos?) acabaría borrando de la pantalla algo que el tutor puso a
   * propósito. Falso positivo caro, duplicado barato — y ahora, además, cada
   * pregunta lleva encima de quién es, así que un duplicado se lee como lo que
   * es en vez de como un error.
   *
   * ⚠️ 28-ago: las FAQ de PERFIL siguen fuera (su editor responde 404 y
   * `getProductDetail` ya ni baja la columna). Cuando vuelva, es un tercer
   * grupo aquí, no una concatenación con las de la mentoría.
   */
  const gruposFaq: { titulo: string; faqs: readonly Faq[] }[] = [
    { titulo: `De ${nombreCorto}, sobre esta mentoría`, faqs: product.faqs },
    { titulo: "Sobre la plataforma", faqs: PRODUCT_FAQ },
  ].filter((g) => g.faqs.length > 0);

  /**
   * §5.6 · JSON-LD de la mentoría. `JSON.stringify` + `dangerouslySetInnerHTML`:
   * concatenar a mano rompería el script en cuanto un título llevara comillas.
   *
   * Sin `url`: haría falta absoluta y la base del sitio vive en `metadataBase`,
   * que no se puede leer desde aquí. Un JSON-LD sin `url` es válido; uno con
   * `url: "/products/…"` es basura que el validador rechaza.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: product.title,
    ...(product.outcome ? { description: product.outcome } : {}),
    ...(portada ? { image: portada } : {}),
    provider: { "@type": "Organization", name: "Enséñame Ya" },
    ...(product.tutor.displayName
      ? { instructor: { "@type": "Person", name: product.tutor.displayName } }
      : {}),
    offers: {
      "@type": "Offer",
      // El precio va en unidades MAYORES y como cadena: schema.org lo pide así
      // y `price_amount` está en las menores (céntimos).
      price: (product.priceAmount / 100).toFixed(2),
      priceCurrency: product.currency,
      availability: "https://schema.org/InStock",
    },
    ...(product.sessionDurationMin
      ? {
          hasCourseInstance: {
            "@type": "CourseInstance",
            courseMode: "Online",
            // ISO-8601: 60 min → "PT60M".
            courseWorkload: `PT${product.sessionDurationMin}M`,
          },
        }
      : {}),
    ...(hayValoracion
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: notaMentoria,
            reviewCount: totalMentoria,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  /**
   * El estado del panel vive ENTERO en la query: día (`d`), hora (`h`) y —desde
   * §5.11— mes de la rejilla (`m`). Aquí no hay `p`: la ficha ya es de UNA
   * mentoría y `BookingPanel` la da por elegida.
   *
   * ⚠️ `URLSearchParams` no es adorno: la hora es un ISO con `:` y, según el
   * huso, un `+` en el offset. Concatenarla a mano dejaría ese `+` crudo en la
   * query, donde significa "espacio", y el panel la descartaría por no casar
   * con ningún hueco.
   */
  const hrefFor = (next: {
    p?: string;
    d?: string;
    h?: string;
    m?: string;
  }) => {
    const q = new URLSearchParams();
    if (next.d) q.set("d", next.d);
    if (next.h) q.set("h", next.h);
    if (next.m) q.set("m", next.m);
    const s = q.toString();
    return s ? `/products/${id}?${s}#reservar` : `/products/${id}#reservar`;
  };

  /**
   * §4 · el hero de móvil llega a los BORDES DE LA PANTALLA, y el contenido de
   * esta página vive dentro de `Container` (20/24/32 px de gutter). Los mismos
   * valores en negativo y otra vez en positivo: el fondo azul se sale, el texto
   * se queda donde estaba. Desde `lg` no hace falta —el azul lo pinta la banda
   * de la rejilla— y se anula.
   */
  const sangrado =
    "-mx-5 px-5 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8 lg:mx-0 lg:px-0";

  const chip =
    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[#d9d9d9] bg-card px-[9px] text-[11.5px] font-medium whitespace-nowrap text-[#4d4d4d] lg:h-[30px] lg:gap-1.5 lg:px-2.5 lg:text-[12.5px]";
  const iconoChip = "size-3 text-[#0072ff] lg:size-3.5";
  const h2 = "text-[18px] font-bold text-[#1f1f1f] lg:text-[22px]";

  const estrellas = (nota: number, sobreAzul: boolean) => (
    <span
      aria-hidden
      className={`flex gap-0.5 ${sobreAzul ? "text-[#ffc531]" : "text-[#f59e0b]"}`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          className={
            n <= Math.round(nota)
              ? "size-[14px] fill-current"
              : `size-[14px] ${sobreAzul ? "text-white/40" : "text-muted-foreground/30"}`
          }
        />
      ))}
    </span>
  );

  return (
    <>
      {/* EY-186 · la mitad «visitas a clases» de la señal: abrir la ficha de una
          mentoría se anota al TUTOR que la imparte, con más peso que aterrizar
          en su perfil. No pinta nada y la sesión la comprueba él con
          `getSession()` (lectura local), así que no le pasamos la de arriba. */}
      <RegistrarVisita tutorId={product.tutor.id} origen="clase" />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/*
        G-05 · HERO Y CUERPO SON **UNA SOLA REJILLA**, y esto es estructural.

        Hasta hoy el hero era un `div` azul a ancho completo y el cuerpo otra
        rejilla debajo: el panel de reserva no podía subir a la altura del
        título porque, sencillamente, no estaba en la misma rejilla que el hero.
        Ahora hay una: `minmax(0,1fr) 348px` con 40 px de hueco. Tres filas en la
        columna izquierda —hero (fila 1), primeras secciones (fila 2), resto
        (fila 3)— y el panel ocupando la columna derecha de LAS TRES.

        ⚠️ Las tres filas no son decorativas: la fila 2 termina justo donde
        empieza el panel en móvil, y eso es lo que permite que la franja de
        precio se suelte ahí (§5.15) sin duplicar un solo nodo. Por eso el orden
        del DOM ya ES el de móvil y no hace falta ni un `order`.

        ⚠️ El azul NO es el fondo del hero: es una capa propia (`col-span-full`,
        fila 1) que se estira sola a la altura de esa fila. Si fuera el fondo del
        hero, terminaría en el borde de la columna izquierda y la portada y el
        panel quedarían recortados sobre blanco.

        ⚠️ Y ese azul tiene que llegar de borde a borde de la VENTANA, no del
        `Container`. De ahí `mx-[calc(50%-50vw)]`, que es exactamente 100vw. Los
        pocos píxeles que 100vw se pasa cuando hay barra de scroll clásica se los
        come el `overflow-x-clip` de fuera — **clip y no hidden** (§5.15):
        `hidden` convertiría ese div en contenedor de scroll y dejaría sin
        viewport al que pegarse a los dos `sticky` de esta página.
      */}
      <div className="overflow-x-clip">
        <Container>
          {/* `lg:relative` es el ancla de la portada (ver su comentario). Va en
              este div y no en `Container` a propósito: `Container` lleva 64 px
              de padding en lg y un `right-0` contra su caja de relleno dejaría
              la portada 64 px fuera de la columna. Este div no tiene padding,
              así que su borde derecho ES el de la columna del panel. */}
          {/* `grid-rows-[auto_auto_1fr]` no es adorno: el panel ocupa las tres
              filas, y en una mentoría muy corta (sin descripción, sin reseñas,
              sin otras mentorías) podría ser MÁS ALTO que las tres juntas. Con
              las tres en `auto`, la rejilla reparte ese sobrante entre ellas —y
              la fila 1 es la banda azul, o sea que el hero crecería sin motivo—.
              Dejando la última flexible, el sobrante cae ahí. */}
          <div className="grid grid-cols-[minmax(0,1fr)] pb-8 sm:pb-16 md:max-lg:pb-10 lg:relative lg:grid-cols-[minmax(0,1fr)_348px] lg:grid-rows-[auto_auto_1fr] lg:gap-x-10">
            {/* La banda azul del hero, solo en escritorio: en móvil el azul lo
                pintan el bloque del hero y la franja de precio, que son dos
                cajas distintas (y tienen que serlo, ver la franja). Desde lg
                lleva el degradado del Figma, el mismo asset que P01. */}
            <div
              aria-hidden
              className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% max-lg:hidden lg:col-span-full lg:row-start-1 lg:mx-[calc(50%-50vw)]"
            />

            {/*
              §5.15 · LA ZONA DE LA FRANJA FIJA. En móvil este div es el bloque
              contenedor de la franja de precio: la franja se queda pegada
              arriba mientras se recorre el hero y las tres primeras secciones, y
              **se suelta justo antes del panel de reserva**, que es donde el
              alumno ya está mirando el calendario y la franja sobra.

              Desde lg es `display: contents` y desaparece: sus dos hijos pasan a
              ser celdas de la rejilla (fila 1 y fila 2). Un `sticky` necesita
              recorrido dentro de su bloque contenedor, y este es el único nodo
              que puede darle exactamente ese —ni menos, que no despegaría, ni
              más, que lo dejaría fijo hasta el pie—.
            */}
            <div className="lg:contents">
              {/* En móvil es `contents` para que la franja de precio sea hija
                  DIRECTA de la zona de arriba; desde lg vuelve a ser una caja y
                  es la celda del hero. */}
              <div className="max-lg:contents lg:col-start-1 lg:row-start-1 lg:pt-[34px] lg:pb-9">
                <div
                  className={`${sangrado} bg-brand pt-5 text-center text-white lg:bg-transparent lg:pt-0 lg:text-start`}
                >
                  {/* G-08 · la miga incluye la categoría (la PRIMERA de la
                      mentoría). Una línea con elipsis: el título completo está
                      tres centímetros más abajo, en el H1, así que repetirlo
                      entero aquí solo gastaba dos líneas de pantalla. Los dos
                      primeros niveles llevan `shrink-0` para que lo que ceda sea
                      siempre el nombre de la mentoría. */}
                  <nav
                    aria-label="Miga de pan"
                    className="flex items-center gap-1.5 truncate text-start text-[11px] text-white/80 lg:text-[13px] lg:text-white/90"
                  >
                    <Link href="/" className="shrink-0 hover:underline">
                      Inicio
                    </Link>
                    <span className="shrink-0">/</span>
                    <Link href="/classes" className="shrink-0 hover:underline">
                      Mentorías
                    </Link>
                    {categoria ? (
                      <>
                        <span className="shrink-0">/</span>
                        <Link
                          href={`/categories/${categoria.slug}`}
                          className="shrink-0 hover:underline"
                        >
                          {categoria.name}
                        </Link>
                      </>
                    ) : null}
                    <span className="shrink-0">/</span>
                    <span className="min-w-0 truncate" title={product.title}>
                      {product.title}
                    </span>
                  </nav>

                  {/*
                    §3 / §4 · LA PORTADA CAMBIA DE COLUMNA, NO DE NODO.

                    En móvil abre el hero (220 × 124, centrada sobre el título);
                    en escritorio vive en la columna derecha, encima del panel, y
                    **se va con el scroll** mientras el panel se queda. Son dos
                    sitios de la página que no comparten padre, así que desde lg
                    se saca del flujo y se posiciona contra la rejilla
                    (`lg:relative` arriba): 69 px por debajo del borde del hero
                    —la altura del título— y pegada al borde derecho, que es el
                    de la columna de 348.

                    El hueco que deja al salirse del flujo lo reserva un espaciador
                    dentro de la columna del panel: mismo ancho (el de la columna)
                    y mismo `aspect-video`, así que mide exactamente lo mismo sin
                    que nadie teclee su altura. Cambiar aquí el aspecto obliga a
                    cambiarlo allí, y por eso están comentados uno contra otro.

                    ⚠️ NINGÚN ancestro suyo puede llevar `relative` desde lg, o el
                    `absolute` se anclaría a él en vez de a la rejilla.
                    220 × 124 y 348 × 195,75 son el mismo 16:9, así que el
                    `aspect-video` sirve para las dos y solo cambia el ancho.
                  */}
                  <ProductCover
                    product={product}
                    width={348}
                    height={196}
                    className="mx-auto mt-3.5 aspect-video max-w-[220px] rounded-[14px] shadow-[0_10px_28px_rgb(0_30_80/0.25)] lg:absolute lg:top-[69px] lg:right-0 lg:mt-0 lg:w-[348px] lg:max-w-none lg:rounded-[16px] lg:shadow-none"
                    priority
                  />

                  <h1 className="mt-3.5 text-[22px] font-bold text-balance lg:max-w-[760px] lg:text-[30px] lg:leading-[1.2]">
                    {product.title}
                  </h1>

                  {/*
                    Valoración, compartir, promesa y chips en UN solo flex que
                    envuelve, y no en cuatro bloques apilados. Es lo que permite
                    que el botón de compartir esté al lado de las estrellas en
                    móvil (G-07) y al final de la fila de chips en escritorio
                    **sin duplicarlo**: `lg:order-last` lo manda al final del
                    contenedor y la promesa, que ocupa línea entera, empuja los
                    chips a una línea nueva que el botón cierra.
                  */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2.5 max-lg:justify-center lg:mt-1.5">
                    {/* G-01 · la valoración es una LÍNEA DE TEXTO, nunca un chip.
                        Es la de ESTA mentoría (§5.3) y el texto no dice de qué
                        es: quien está en la ficha ya lo sabe. Estrellas a
                        #ffc531 porque el fondo es azul; el #f59e0b de las
                        reseñas sobre blanco se apaga aquí. La estrella es
                        adorno: al lector se le dice «Valoración 4.8». */}
                    {notaMentoria !== null && totalMentoria > 0 ? (
                      <p
                        title={`Media de ${totalMentoria} ${totalMentoria === 1 ? "reseña" : "reseñas"} de alumnos que terminaron esta mentoría`}
                        className="flex items-center gap-1.5 text-[13px] lg:basis-full lg:text-sm"
                      >
                        {estrellas(notaMentoria, true)}
                        <span className="font-bold">
                          <span className="sr-only">Valoración </span>
                          {notaMentoria.toFixed(1)}
                        </span>
                        <span className="text-white/90">
                          · {totalMentoria}{" "}
                          {totalMentoria === 1 ? "reseña" : "reseñas"}
                        </span>
                      </p>
                    ) : null}

                    <ShareButton
                      label="Compartir mentoría"
                      title={product.title}
                      text={product.outcome ?? undefined}
                      className="size-[22px] rounded-full border border-white/70 text-white [&_svg]:size-3 lg:order-last lg:size-[30px] lg:rounded-lg lg:border-[#d9d9d9] lg:bg-card lg:text-[#4d4d4d] lg:[&_svg]:size-[13px]"
                    />

                    {/*
                      §4 · la promesa a DOS líneas en móvil, y se abre TOCANDO EL
                      PROPIO TEXTO —sin botón «Ver más», que en la referencia no
                      existe—.

                      Es un `<details>` nativo y no un componente cliente: esta
                      página es un Server Component, `summary` ya es enfocable y
                      abre con Enter y con Espacio, y el lector de pantalla
                      anuncia el estado sin que haya que escribir `aria-expanded`
                      a mano. El recorte se quita al abrir (`group-open`).

                      Desde lg no hay recorte ni nada que abrir: el texto sale
                      entero y el puntero vuelve a ser el normal.
                    */}
                    {product.outcome ? (
                      <details className="group mx-auto basis-full max-lg:max-w-[330px] lg:mx-0 lg:mt-1">
                        <summary className="line-clamp-2 cursor-pointer list-none text-[13px] text-white/95 marker:hidden group-open:line-clamp-none lg:line-clamp-none lg:cursor-auto lg:text-[14.5px] [&::-webkit-details-marker]:hidden">
                          {product.outcome}
                        </summary>
                      </details>
                    ) : null}

                    {/*
                      §3.5 · chips en UNA línea, sin envolver. Fuera «1 × 60 min»,
                      «En vivo 1 a 1» y «60 min por sesión»: los tres decían lo
                      que ahora dice la línea de precio, a dos centímetros.

                      El idioma no cabe en móvil (§4) y es lo primero que sobra:
                      el nivel y la confirmación deciden la compra, el idioma casi
                      nunca —el catálogo es de habla hispana—.
                    */}
                    <ul className="mt-0.5 flex flex-nowrap items-center gap-1.5 max-lg:justify-center">
                      {nivel ? (
                        <li className={chip}>
                          <BarChart3Icon className={iconoChip} aria-hidden />
                          <span className="lg:hidden">{nivel}</span>
                          <span className="max-lg:hidden">Nivel {nivel}</span>
                        </li>
                      ) : null}
                      {idioma ? (
                        <li className={`${chip} max-lg:hidden`}>
                          <GlobeIcon className={iconoChip} aria-hidden />
                          {idioma}
                        </li>
                      ) : null}
                      {/* G-03 · la confirmación es POR MENTORÍA
                          (`products.auto_accept_bookings`), nunca del perfil. El
                          naranja oscuro no es el `primary` de marca: a 12 px
                          sobre blanco el #fe6a00 se queda en 2,4:1 y esto es
                          texto, no un botón. */}
                      {product.autoAccept ? (
                        <li
                          className={`${chip} border-[#ffd7bd] bg-[#fff4ec] font-semibold text-[#c4470a]`}
                        >
                          <ZapIcon
                            className="size-3 lg:size-3.5"
                            aria-hidden
                            fill="currentColor"
                          />
                          Confirmación inmediata
                        </li>
                      ) : null}
                    </ul>
                  </div>
                </div>

                {/*
                  §3.6 / §4 · LA LÍNEA DE PRECIO, que en móvil es además LA
                  FRANJA FIJA. Un solo marcado para las dos: en escritorio es una
                  línea de base común («US$ 18,00 por sesión · 60 min · 1 a 1»);
                  en móvil el importe sube, la unidad y los datos bajan a una
                  segunda línea y a la derecha aparecen los dos botones que en
                  escritorio no hacen falta —el panel ya está a la vista—.

                  ⚠️ `top-44` y no `top-0` como la referencia: la referencia es
                  una maqueta suelta y esta página vive bajo la cabecera del
                  sitio, que es `sticky top-0` y mide 173 px a 390 y 147 a 768
                  (medidas del propio `site-header.tsx`). Con `top-0` la franja
                  se quedaría fija DEBAJO de la cabecera, o sea invisible. Los
                  dos tramos van con variantes DISJUNTAS (`max-md` y
                  `md:max-lg`) y no con `max-lg` + `md:max-lg`, que se solapan y
                  dejan el desempate en manos del orden del CSS.
                */}
                <div
                  className={`${sangrado} flex items-center justify-between gap-3 pt-2.5 pb-3 text-white max-md:top-44 max-lg:sticky max-lg:z-20 max-lg:bg-brand max-lg:shadow-[0_8px_20px_rgb(0_40_90/0.18)] md:max-lg:top-[150px] lg:mt-4 lg:justify-start lg:pt-0 lg:pb-0`}
                >
                  <div className="min-w-0 text-start lg:flex lg:items-baseline lg:gap-2.5">
                    <p className="text-[22px] leading-tight font-bold lg:text-[26px]">
                      {precio.amount}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-white/90 lg:mt-0 lg:gap-3.5 lg:text-sm">
                      <span className="whitespace-nowrap">{precio.note}</span>
                      {duracion ? (
                        <span
                          title="Duración de la sesión"
                          className="inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <ClockIcon
                            className="size-3.5 shrink-0 lg:size-4"
                            aria-hidden
                          />
                          {duracion}
                        </span>
                      ) : null}
                      <span
                        title="Clase en vivo, 1 a 1"
                        className="inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <VideoIcon
                          className="size-3.5 shrink-0 lg:size-4"
                          aria-hidden
                        />
                        1 a 1
                      </span>
                    </p>
                  </div>

                  {/* G-09 · los dos botones de la franja. Existen SOLO en móvil
                      —en escritorio el panel está al lado y un botón que hace
                      scroll hacia algo que se ve no es un botón—, así que esto
                      no es marcado duplicado: es marcado que allí no hay. */}
                  <div className="flex shrink-0 items-center gap-2 lg:hidden">
                    <a
                      href="#reservar"
                      aria-label="Reservar mentoría"
                      title="Reservar mentoría"
                      className="grid size-[46px] place-items-center rounded-[10px] bg-primary text-white shadow-[0_6px_18px_rgb(0_0_0/0.18)]"
                    >
                      <CalendarIcon className="size-5" aria-hidden />
                    </a>
                    {esMiMentoria ? null : (
                      <ContactTutor
                        tutorId={product.tutor.id}
                        tutorName={tutorName}
                        anonimo={!user}
                        iconOnly
                        className="size-[46px] rounded-[10px] border-[1.5px] border-white bg-transparent text-white shadow-none hover:bg-white/15"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Fila 2 · lo que se lee ANTES de reservar. En móvil son las tres
                  secciones que quedan dentro de la zona de la franja fija. */}
              <div className="flex flex-col gap-8 pt-6 lg:col-start-1 lg:row-start-2 lg:gap-10 lg:pt-10">
                {bloques.length > 0 ? (
                  <section>
                    <h2 className={h2}>Qué vas a conquistar</h2>
                    {/* La clave lleva el índice porque los bloques salen de un
                        texto libre: dos párrafos iguales compartirían clave y
                        React tiraría uno. Mismo criterio que los requisitos. */}
                    {bloques.map((b, i) =>
                      b.tipo === "lista" ? (
                        <ul
                          key={`b${i}`}
                          className="mt-3.5 flex flex-col gap-3"
                        >
                          {b.items.map((item, j) => (
                            <li
                              key={`${j}-${item}`}
                              className="flex items-start gap-3"
                            >
                              <span className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full bg-[#e0f0ff] text-brand">
                                <CheckIcon
                                  className="size-3.5"
                                  strokeWidth={3}
                                />
                              </span>
                              <span className="text-[14px] text-[#4d4d4d] lg:text-[15px]">
                                {item}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p
                          key={`b${i}`}
                          className="mt-3.5 text-[14px] text-pretty text-[#4d4d4d] lg:text-[15px]"
                        >
                          {b.texto}
                        </p>
                      ),
                    )}
                  </section>
                ) : null}

                {/* Requerimientos de sesión — lo que el alumno tiene que TRAER.

                    Va justo detrás de «Qué vas a conquistar» y por delante de
                    «Cómo funciona»: las dos primeras responden a «¿esto es para
                    mí?», y esta es la mitad que puede contestar que NO —quien no
                    tiene portátil necesita saberlo aquí, no a los diez minutos
                    de pagar—.

                    Sin requisitos NO se pinta nada: no hay lista genérica de
                    plataforma a la que caer (a diferencia de las FAQ). Anunciar
                    condiciones que el tutor no puso sería peor que callar. */}
                {product.requirements.length > 0 ? (
                  <section>
                    <h2 className={h2}>Qué necesitas para la sesión</h2>
                    <p className="mt-1.5 text-[13px] text-[#6b6b6b]">
                      Tenlo listo antes de tu primera clase.
                    </p>
                    <ul className="mt-3.5 flex flex-col gap-3">
                      {product.requirements.map((r, i) => (
                        // La clave lleva el índice porque los requisitos no se
                        // deduplican: dos iguales compartirían `key` y React
                        // tiraría uno.
                        <li
                          key={`${i}-${r}`}
                          className="flex items-start gap-3"
                        >
                          {/* Viñeta y no el check de «Qué vas a conquistar»:
                              allí el tick significa «esto te llevas», y aquí
                              leería como «esto ya lo tienes», que es justo lo
                              contrario de lo que la lista está pidiendo. */}
                          <span className="mt-0.5 grid size-[22px] shrink-0 place-items-center rounded-full bg-brand-muted">
                            <span className="size-1.5 rounded-full bg-brand" />
                          </span>
                          <span className="text-[14px] text-[#4d4d4d] lg:text-[15px]">
                            {r}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/*
                  §3.3 · «Cómo funciona» son TRES TARJETAS CON TÍTULO, y se acabó
                  el párrafo. El texto que había (`HOW_IT_WORKS`) contaba en 45
                  palabras lo que estas tres líneas dicen de un vistazo, y encima
                  prometía «el tutor confirma en menos de 24 horas» también en las
                  mentorías que confirman al instante — que es exactamente lo que
                  G-03 vino a arreglar. El paso 2 lee ahora el dato de la
                  mentoría, como el chip del hero y la línea del panel.
                */}
                <section>
                  <h2 className={h2}>Cómo funciona</h2>
                  <div className="mt-4 flex flex-col gap-2 lg:grid lg:grid-cols-3 lg:gap-3.5">
                    {[
                      { k: "1", titulo: "Eliges día y hora", zap: false },
                      product.autoAccept
                        ? {
                            k: "2",
                            titulo: "Se confirma al instante",
                            zap: true,
                          }
                        : {
                            k: "2",
                            titulo: "El tutor confirma en 24 h",
                            zap: false,
                          },
                      { k: "3", titulo: "Entras desde tu panel", zap: false },
                    ].map((paso) => (
                      <div
                        key={paso.k}
                        className="flex items-center gap-3 rounded-[14px] border border-[#e6e6e6] px-3.5 py-3 lg:gap-3.5 lg:px-4 lg:py-[18px]"
                      >
                        <span
                          className={`grid size-[38px] shrink-0 place-items-center rounded-full text-[17px] font-bold lg:size-11 lg:text-[20px] ${
                            paso.zap
                              ? "bg-[#fff4ec] text-primary"
                              : "bg-[#e0f0ff] text-brand"
                          }`}
                        >
                          {paso.zap ? (
                            <ZapIcon
                              className="size-[18px] lg:size-[22px]"
                              aria-hidden
                              fill="currentColor"
                            />
                          ) : (
                            paso.k
                          )}
                        </span>
                        <p className="text-[14px] font-semibold text-[#262626] lg:text-[15px]">
                          {paso.titulo}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            {/*
              G-05 · la columna del panel ocupa LAS TRES FILAS y arranca 69 px
              bajo el borde del hero, o sea a la altura del título.

              ⚠️ `row-span-3` no es cosmético: es lo que le da RECORRIDO al
              `sticky` del propio panel. `booking-panel.tsx` documenta que su
              `lg:sticky` nunca llegó a despegarse porque el hijo de la rejilla
              —este div— medía exactamente lo mismo que el `aside`, así que había
              0 px que recorrer. Al estirarlo a la altura de la columna entera, el
              `aside` sí tiene por dónde deslizarse. Y solo él: la portada de
              arriba se va con el scroll, que es lo que pide G-05.

              `scroll-mt-44` por debajo de lg: la cabecera pública es sticky y
              mide 173 px a 390 (147 a 768), así que llegar por el ancla —los
              enlaces del carrito, y el botón de la franja fija— dejaba el título
              del panel debajo de ella.
            */}
            <div
              id="reservar"
              className="mt-8 max-lg:scroll-mt-44 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:mt-[69px]"
            >
              {/* El hueco de la portada, que desde lg está fuera del flujo (ver
                  su comentario). Mismo ancho —el de la columna— y mismo
                  `aspect-video`, así que mide lo mismo sin teclear su altura;
                  `mb-3.5` es la separación con el panel. */}
              <div aria-hidden className="mb-3.5 aspect-video max-lg:hidden" />

              <BookingPanel
                products={[product]}
                selectedDay={sp.d}
                selectedTime={sp.h}
                month={sp.m}
                /* §4 · la única barra fija de esta ficha en móvil es la franja de
                   precio del hero. Ver `ctaFijo` en `booking-panel.tsx`. */
                ctaFijo={false}
                timeZone={timeZone}
                details
                compact
                // G-03 · «⚡ Se confirma al instante al pagar» / «El tutor
                // confirma en 24 h», según lo que prometa ESTA mentoría.
                autoAcceptLine
                title="Reserva esta mentoría"
                ctaLabel={
                  product.pricingModel === "per_package"
                    ? "Reservar paquete YA"
                    : "Reservar mentoría YA"
                }
                note="Pago protegido · Cancela con 24 h y recibe el 100 %"
                hrefFor={hrefFor}
                // §5.13 · plegada: la tarjeta de tres reglas se comía ella sola
                // el hueco que el panel compacto necesita para el CTA, y esto
                // tiene que leerse antes de pagar, no tres pantallas más abajo.
                footer={
                  <CancellationPolicy variant="folded" className="mt-3" />
                }
              />
            </div>

            {/* Fila 3 · lo que se lee DESPUÉS de decidir. En móvil va detrás del
                panel, que es donde termina la zona de la franja fija. */}
            <div className="mt-8 flex flex-col gap-8 lg:col-start-1 lg:row-start-3 lg:mt-0 lg:gap-10 lg:pt-10">
              {/*
                §3.4 · «Tu tutor» es una REJILLA, no una fila de cajas, y por eso
                el mismo marcado da las dos composiciones sin duplicar nada:
                en escritorio el tiempo de respuesta y los botones se van a una
                tercera columna a la derecha; en móvil el tiempo de respuesta cae
                bajo las estrellas y los botones bajan a una fila propia al 50 %.

                Fuera el titular del tutor y sus estadísticas: esta tarjeta
                responde «¿quién me la da y se le puede preguntar?», y su perfil
                —a un clic— responde el resto.
              */}
              <section>
                <h2 className={h2}>Tu tutor</h2>
                <div className="mt-3.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 rounded-[16px] border border-[#e6e6e6] p-[18px] lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-x-4 lg:gap-y-1.5">
                  <span className="row-span-2 grid size-11 shrink-0 place-items-center self-center overflow-hidden rounded-full bg-brand-muted font-semibold text-brand lg:size-14">
                    {tutorAvatar ? (
                      <Image
                        src={tutorAvatar}
                        alt=""
                        width={56}
                        height={56}
                        className="size-11 object-cover lg:size-14"
                        unoptimized
                      />
                    ) : (
                      initialsFrom(tutorName)
                    )}
                  </span>

                  <div className="col-start-2 row-start-1 min-w-0 lg:row-span-2">
                    {/* TODO (DP-31.4) · el check sale hoy de `approval_status =
                        approved`, que es lo único que esta ficha consulta —y
                        aprobar NO exige hoy `identity_verification_status`: son
                        dos columnas independientes—. Si se decide condicionar la
                        insignia a la verificación de identidad, la columna
                        existe y habría que bajarla en el `select` de
                        `getProductDetail`. Sin «· Tutor verificado» en texto: la
                        píldora la lleva su perfil, aquí es el check y su
                        `title`. */}
                    <p className="flex items-center gap-2 text-[15px] font-bold text-[#262626] lg:text-base">
                      <span className="truncate">{tutorName}</span>
                      <span
                        // `role="img"` porque un `aria-label` en un `span`
                        // genérico lo ignoran la mitad de los lectores: sin rol
                        // no hay a qué colgar la etiqueta y el check se queda
                        // mudo, que es justo lo contrario de lo que hace falta
                        // cuando la insignia sustituye a un texto.
                        role="img"
                        title="Identidad y titulación revisadas por Enséñame Ya"
                        aria-label="Tutor verificado"
                        className="grid size-[22px] shrink-0 place-items-center rounded-full bg-primary text-white"
                      >
                        <CheckIcon className="size-3" strokeWidth={3.2} />
                      </span>
                    </p>
                    {product.tutor.ratingAvg &&
                    product.tutor.ratingCount > 0 ? (
                      <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#595959]">
                        {estrellas(product.tutor.ratingAvg, false)}
                        <span className="font-bold text-[#19191f]">
                          <span className="sr-only">Valoración </span>
                          {product.tutor.ratingAvg.toFixed(1)}
                        </span>
                        <span>
                          · {product.tutor.ratingCount}{" "}
                          {product.tutor.ratingCount === 1
                            ? "reseña"
                            : "reseñas"}
                        </span>
                      </p>
                    ) : null}
                  </div>

                  {/* G-06 · sin dato suficiente NO hay línea. Un «responde en 2
                      horas» de adorno es una promesa que la plataforma no puede
                      cumplir y que el alumno usa para decidir la compra. */}
                  {respuesta ? (
                    <p
                      title="Mediana de lo que tarda en contestar un mensaje (últimos 90 días)"
                      className="col-start-2 row-start-2 text-[12px] text-[#6b6b6b] lg:col-start-3 lg:row-start-2 lg:justify-self-end lg:text-end"
                    >
                      {respuesta}
                    </p>
                  ) : null}

                  <div className="col-span-2 row-start-3 flex items-center gap-2.5 lg:col-span-1 lg:col-start-3 lg:row-start-1 lg:justify-self-end lg:gap-2">
                    {/*
                      ⚠️ DOS `ContactTutor` y no uno con clases: lo que cambia
                      entre móvil y escritorio no es el aspecto, es la PROP
                      (`iconOnly`), y una prop no tiene variante `lg:`. En móvil
                      es un botón al 50 % con su texto; en escritorio, el
                      botón-icono de 40 px de G-09. Solo uno se pinta a la vez.
                    */}
                    {esMiMentoria ? null : (
                      <>
                        <ContactTutor
                          tutorId={product.tutor.id}
                          tutorName={tutorName}
                          anonimo={!user}
                          label="Pregúntale"
                          className="h-[46px] min-w-0 flex-1 text-[13.5px] lg:hidden"
                        />
                        <ContactTutor
                          tutorId={product.tutor.id}
                          tutorName={tutorName}
                          anonimo={!user}
                          iconOnly
                          className="max-lg:hidden"
                        />
                      </>
                    )}
                    {/* El de «Ver perfil» sí es UN solo nodo: aquí lo que cambia
                        es el tamaño y si se ve el texto, y eso son clases. */}
                    <Link
                      href={`/tutors/${product.tutor.id}`}
                      title="Ver perfil"
                      aria-label="Ver perfil"
                      className="inline-flex h-[46px] min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border-[1.5px] border-[#d6d6d6] text-[13.5px] font-semibold text-[#404040] transition-colors hover:bg-muted lg:size-10 lg:h-10 lg:flex-none lg:gap-0 lg:border"
                    >
                      <EyeIcon className="size-[18px] shrink-0" aria-hidden />
                      <span className="lg:hidden">Ver perfil</span>
                    </Link>
                  </div>
                </div>
              </section>

              {/*
                §3.5 · las reseñas de ESTA mentoría (`reviews.product_id`, EP-09).
                Mientras no tenga ninguna se enseñan las del TUTOR y el rótulo lo
                dice: son de él, no de esta clase. Es la única forma honesta de
                que una mentoría recién publicada no aparente cero valoraciones
                teniendo detrás a alguien con veintitrés.
              */}
              {listaResenas.length > 0 ? (
                <section>
                  <h2 className={h2}>
                    {hayResenasPropias
                      ? "Reseñas de esta mentoría"
                      : "Reseñas del tutor"}
                  </h2>
                  <div className="mt-4 lg:mt-5">
                    <ReviewsSummary
                      reviews={listaResenas}
                      avg={notaLista ?? undefined}
                      // §5.5 · el conteo es el de la BD, no el de la lista: se
                      // cargan como mucho 50 y el botón diría «Ver las 50» a
                      // una mentoría con 120.
                      count={totalLista}
                    />
                  </div>
                  <hr className="my-5 border-[#ebebeb]" />
                  <TutorReviews
                    reviews={listaResenas}
                    /* §5.4 · con reseñas propias todas son de esta mentoría y
                       repetir su título bajo cada autor no dice nada; cuando se
                       cae a las del tutor, sí son de mentorías distintas y la
                       línea de contexto es lo que lo explica. */
                    withContext={!hayResenasPropias}
                    visible={2}
                    moreLabel={`Ver las ${totalLista} ${totalLista === 1 ? "reseña" : "reseñas"}`}
                  />
                  {/* El puente al perfil: ahí están TODAS las del tutor, con su
                      histograma. Solo cuando hay alguna que ver. */}
                  {product.tutor.ratingCount > 0 ? (
                    <p className="mt-4">
                      <Link
                        href={`/tutors/${product.tutor.id}`}
                        className="text-[13px] font-semibold text-[#0b4f96] hover:underline"
                      >
                        Ver las {product.tutor.ratingCount} reseñas de{" "}
                        {nombreCorto} en su perfil →
                      </Link>
                    </p>
                  ) : null}
                </section>
              ) : null}

              {/* §3.6 · va DESPUÉS de las reseñas y ANTES de las FAQ: quien ya se
                  fio del tutor es quien puede querer otra clase suya; quien
                  todavía tiene dudas sigue bajando a las preguntas.
                  En móvil, fila desplazable —dos tarjetas al ancho de un
                  teléfono no caben— y en escritorio, dos columnas. */}
              {otrasMentorias.length > 0 ? (
                <section>
                  <h2 className={h2}>Otras mentorías de {nombreCorto}</h2>
                  <div className="mt-4 flex gap-3 overflow-x-auto pb-1 [&>*]:w-[190px] [&>*]:shrink-0 lg:grid lg:grid-cols-2 lg:gap-5 lg:overflow-x-visible lg:[&>*]:w-auto">
                    {otrasMentorias.map((p) => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        action="ver"
                        compact
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <h2 className={h2}>Preguntas frecuentes</h2>
                {gruposFaq.map((grupo, gi) => (
                  <div key={grupo.titulo}>
                    <p className="pt-[18px] pb-1 text-[12px] font-semibold tracking-[0.08em] text-[#6b6b6b] uppercase">
                      {grupo.titulo}
                    </p>
                    {/* `<details>` nativo: abre y cierra sin una línea de JS y
                        el buscador ve la respuesta aunque esté cerrada.
                        ⚠️ Solo la PRIMERA de la primera lista viene abierta.
                        Con todas abiertas —lo de hasta hoy— la sección medía
                        pantalla y media y dejaba de ser un índice de dudas para
                        ser un muro de texto. */}
                    <div className="divide-y divide-[#e6e6e6] border-b border-[#e6e6e6]">
                      {grupo.faqs.map(({ q, a }, i) => (
                        // ⚠️ La clave lleva el índice porque las listas NO se
                        // deduplican: si el tutor repite una pregunta que ya
                        // contesta la plataforma, `key={q}` sería la misma clave
                        // dos veces y React tira una de las dos.
                        <details
                          key={`${i}-${q}`}
                          open={gi === 0 && i === 0}
                          className="group py-4"
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14.5px] font-semibold text-[#292929] marker:hidden lg:text-base">
                            {q}
                            <ChevronDownIcon className="size-4 shrink-0 text-brand transition-transform group-open:rotate-180" />
                          </summary>
                          <p className="mt-1.5 pr-8 text-[13.5px] text-[#666666] lg:text-sm">
                            {a}
                          </p>
                        </details>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </Container>
      </div>
    </>
  );
}
