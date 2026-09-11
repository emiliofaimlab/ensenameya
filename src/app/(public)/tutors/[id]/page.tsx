import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheckIcon,
  BarChart3Icon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  GlobeIcon,
  StarIcon,
} from "lucide-react";

import { getSessionContext, getViewerTimezone } from "@/lib/auth/server";
import { ContactTutor } from "@/components/chat/contact-tutor";
import { tutorResponseTime } from "@/components/chat/conversations";
import { responseTimeLabel } from "@/components/chat/types";
import { Container } from "@/components/layout/container";
import { BookingPanel } from "@/components/catalog/booking-panel";
import { ProductCard } from "@/components/catalog/product-card";
import { ShareButton } from "@/components/catalog/share-button";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import { LANGUAGES, LEVELS } from "@/components/catalog/product-filters";
import { RegistrarVisita } from "@/components/catalog/registrar-visita";
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";
import { getTutorDetail, listTutorReviews } from "@/lib/catalog/queries";
import type { CategoryTag, ProductCardData } from "@/lib/catalog/queries";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import { PrecioEnLinea } from "@/components/precio/precio";

/**
 * "básico e intermedio" — la «y» se vuelve «e» delante de palabra que empieza
 * por i-/hi-, y `intermedio` es justo una de ellas. Sin esto la tira de
 * estadísticas dice «básico y intermedio», que en español está mal escrito.
 * (La excepción de «hie-» —«agua y hielo»— no se contempla: ningún nivel ni
 * idioma del catálogo empieza así.)
 */
function listaEs(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  const ultimo = items[items.length - 1]!;
  const conjuncion = /^(i|hi)/i.test(ultimo) ? "e" : "y";
  return `${items.slice(0, -1).join(", ")} ${conjuncion} ${ultimo}`;
}

/** "Marzo 2026" en la zona del visitante (RN-02); `null` si no hay fecha. */
function mesYAnio(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return null;
  const mes = f.toLocaleDateString("es", { month: "long", timeZone });
  const anio = f.toLocaleDateString("es", { year: "numeric", timeZone });
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${anio}`;
}

/**
 * §5.10 · el hero pinta DOS líneas —título y meta— y en la base solo hay un
 * campo, `headline`. Se parte por el PRIMER « · »: lo de delante es el título
 * (17 px semibold) y lo de detrás la meta (14 px). Sin separador todo es
 * título y no hay meta, que es lo que le pasa hoy a la mayoría de los perfiles.
 *
 * ⚠️ `split(" · ", 2)` NO vale: JavaScript descarta el resto en vez de
 * devolverlo, así que «A · B · C» perdería « · C». Se corta por el índice.
 */
function partirHeadline(headline: string | null): {
  titulo: string | null;
  meta: string | null;
} {
  if (!headline) return { titulo: null, meta: null };
  const i = headline.indexOf(" · ");
  if (i === -1) return { titulo: headline, meta: null };
  return {
    titulo: headline.slice(0, i),
    meta: headline.slice(i + 3) || null,
  };
}

/** Un dato de la tira de «Sobre mí»: icono, cifra, apoyo y su explicación. */
type Estadistica = {
  key: string;
  Icon: LucideIcon;
  valor: string;
  apoyo: string;
  title: string;
};

/** Cuántas columnas tiene la tira de estadísticas en escritorio. Las clases van
 *  literales para que Tailwind las vea: `lg:grid-cols-${n}` no se compila. */
const COLUMNAS_ESTADISTICAS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // ⚠️ El tipo de vuelta se anota a propósito. Sin él, `type: "profile"` se
  // infiere como `string` y deja de encajar en la unión de `openGraph.type`,
  // que es un fallo que solo aparece en el `typecheck`, no aquí.
  const { id } = await params;
  const data = await getTutorDetail(id);
  const t = data?.tutor;
  if (!t) return { title: "Tutor" };

  const name = t.displayName ?? t.headline ?? "Tutor";
  const avatar = storageUrl("avatars", t.avatarPath);
  // §5.6 · lo que se lee en Google y en la vista previa de WhatsApp. El
  // `headline` es lo que el propio tutor escribió sobre sí mismo; sin él se cae
  // a una frase de plataforma en vez de inventarle una descripción.
  const description =
    t.headline ?? `Reserva mentorías 1:1 en vivo con ${name} en Enséñame Ya.`;
  const url = `/tutors/${id}`;

  return {
    title: `${name} · Enséñame Ya`,
    description,
    // ⚠️ RELATIVO a propósito: `metadataBase` vive en `src/app/layout.tsx` y
    // todavía no está puesto (§5.6). Hasta que lo esté, Next resuelve esto
    // contra `http://localhost:3000` y avisa por consola en el build.
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      title: `${name} · Enséñame Ya`,
      description,
      url,
      // La URL del avatar ya es absoluta (bucket público de Storage), así que
      // esta parte funciona sin `metadataBase`.
      images: avatar ? [{ url: avatar }] : undefined,
    },
  };
}

export default async function TutorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string; d?: string; h?: string; m?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // M-12 · el tiempo de respuesta se pide en paralelo con lo demás: alimenta el
  // mismo bloque del hero y no depende de nada. `tutorResponseTime` devuelve
  // `null` mucho más a menudo de lo que parece (tutor nuevo, o que no
  // contesta), y `null` significa NO PINTAR EL DATO (queda la frase de apoyo).
  //
  // ⚠️ EY-194 · la sesión vuelve al `Promise.all`, y con ella el botón de
  // preguntar. La quitó MN-06 el 20-ago; el 26-ago el cliente pidió reabrir la
  // consulta previa. Va en paralelo porque no depende de nada: solo decide si
  // el botón escribe o abre el alta.
  //
  // La zona del visitante también entra aquí: la usan el panel de reserva Y la
  // estadística «tutor desde». Estaba resuelta con un `await` dentro del JSX,
  // que la dejaba en serie detrás de todo lo demás.
  const [data, reviews, respuestaMin, { user }, timeZone] = await Promise.all([
    getTutorDetail(id),
    listTutorReviews(id),
    tutorResponseTime(id),
    getSessionContext(),
    getViewerTimezone(),
  ]);
  if (!data) notFound();
  const { tutor, products } = data;

  const respuesta = responseTimeLabel(respuestaMin);
  // Escribirse a uno mismo no es una conversación (la RPC lo rechaza igual;
  // esto es para no enseñar un botón que solo puede fallar).
  const esMiFicha = user?.id === tutor.id;

  const name = tutor.displayName ?? tutor.headline ?? "Tutor";
  // El nombre de pila es el que va en los títulos («Mentorías de Valentina»,
  // «Reserva con Valentina»): el apellido no aporta y rompe las líneas.
  const nombreCorto = name.trim().split(/\s+/)[0] || name;
  const avatar = storageUrl("avatars", tutor.avatarPath);
  const { titulo, meta } = partirHeadline(tutor.headline);

  // G-01 · la valoración se pinta desde `rating_count`, no desde las reseñas
  // cargadas: la lista se corta en 50 y el número del hero tiene que ser el
  // mismo que el del botón «Ver las N reseñas» de abajo.
  const nota = tutor.ratingAvg;
  const totalResenas = tutor.ratingCount;
  const hayValoracion = nota !== null && totalResenas > 0;
  // Fuera del JSX para no depender de que TypeScript arrastre el estrechamiento
  // de `hayValoracion` hasta dentro del `map` de las estrellas.
  const notaTexto = nota === null ? null : nota.toFixed(1);
  const estrellasLlenas = nota === null ? 0 : Math.round(nota);

  const tutorDesde = mesYAnio(tutor.approvedAt, timeZone);

  /**
   * "Lo que enseño" · cada categoría con SUS mentorías al lado, porque de ahí
   * salen ahora las tres cosas que se pintan: cuántas hay, desde cuánto y qué
   * niveles e idiomas cubren. Antes el chip de la derecha era el nivel del
   * TUTOR repetido en todas las filas, que es el mismo dato tres veces.
   *
   * El orden es el de aparición de la categoría recorriendo los productos, que
   * ya vienen por `created_at` descendente: la categoría de lo más reciente
   * abre la lista.
   */
  const porCategoria = new Map<
    string,
    { cat: CategoryTag; items: ProductCardData[] }
  >();
  for (const p of products) {
    for (const c of p.categories) {
      const fila = porCategoria.get(c.slug) ?? { cat: c, items: [] };
      fila.items.push(p);
      porCategoria.set(c.slug, fila);
    }
  }
  const topics = [...porCategoria.values()];

  // G-08 · la categoría de la miga es la que MÁS mentorías tiene. `>` estricto
  // y no `>=`: en un empate gana la primera, que es la de la mentoría más
  // reciente, en vez de cambiar de miga cada vez que se publica una clase.
  const categoriaPrincipal = topics.reduce<(typeof topics)[number] | null>(
    (mejor, t) => (!mejor || t.items.length > mejor.items.length ? t : mejor),
    null,
  );

  /**
   * §1 · la tira de estadísticas de «Sobre mí». Se arma FILTRANDO: lo que no
   * tiene dato no ocupa una columna vacía, y la rejilla se ajusta al número
   * real (de ahí `COLUMNAS_ESTADISTICAS`).
   *
   * TODO(DP-31.1) · falta la primera, `GraduationCap` / «148» / «sesiones
   *   impartidas». No se pinta porque LA CIFRA NO EXISTE: `sessions` no es
   *   legible desde el catálogo público (cliente anónimo + RLS), así que el
   *   recuento tendría que ser columna nueva de la vista `tutors_public` o una
   *   RPC pública — las dos cosas son migración y la decisión sigue abierta.
   *   Pregunta abierta para el cliente: ¿cuenta `status = 'completed'` de todas
   *   sus sesiones, o solo las de mentorías activas? Mientras no haya respuesta
   *   la tira va con tres, nunca con un cero ni con un número inventado.
   */
  const idiomas = [
    ...new Set(
      products
        .map((p) => p.language)
        .filter((l): l is string => l !== null && l !== ""),
    ),
  ].map((codigo) => LANGUAGES.find((l) => l.id === codigo)?.label ?? codigo);
  // En el orden del filtro (básico → intermedio → avanzado) y no en el de los
  // productos: «intermedio y básico» se lee como si fueran dos cosas sueltas.
  const niveles = LEVELS.filter((l) => products.some((p) => p.level === l.id));

  const estadisticas = [
    idiomas.length > 0
      ? {
          key: "idiomas",
          Icon: GlobeIcon,
          valor: idiomas.join(" · "),
          apoyo: idiomas.length === 1 ? "idioma" : "idiomas",
          title: "Idiomas en los que imparte sus mentorías",
        }
      : null,
    niveles.length > 0
      ? {
          key: "niveles",
          Icon: BarChart3Icon,
          valor: `${niveles.length} ${niveles.length === 1 ? "nivel" : "niveles"}`,
          apoyo: listaEs(niveles.map((n) => n.label.toLowerCase())),
          title: "Niveles de sus mentorías activas",
        }
      : null,
    tutorDesde
      ? {
          key: "desde",
          Icon: CalendarIcon,
          valor: tutorDesde,
          apoyo: "tutor desde",
          title: `Perfil aprobado por Enséñame Ya en ${tutorDesde.toLowerCase()}`,
        }
      : null,
  ].filter((s): s is Estadistica => s !== null);

  /**
   * TODO(DP-31.4) · la píldora «Tutor verificado» sale de `approval_status`
   *   (`getTutorDetail` ya filtra `approved`, así que si esta página se pinta
   *   el tutor está aprobado). Verificado contra las migraciones: **aprobar NO
   *   exige `identity_verification_status = 'approved'`**, son dos columnas
   *   independientes. Si se decide condicionar la insignia a la verificación de
   *   identidad, la columna existe y hoy NO se consulta: habría que bajarla en
   *   el `select` de `getTutorDetail`, añadirla a `TutorCardData` y mover
   *   también la fecha del tooltip a la de esa verificación.
   */
  const tituloVerificado = `Identidad y titulación revisadas por Enséñame Ya${
    tutorDesde ? ` · ${tutorDesde.toLowerCase()}` : ""
  }`;

  /**
   * §5.6 · JSON-LD del perfil. `JSON.stringify` y `dangerouslySetInnerHTML`:
   * concatenar el nombre a mano rompería el script en cuanto un tutor tuviera
   * una comilla en su nombre público o en su titular.
   *
   * Sin `url`: aquí haría falta una URL ABSOLUTA y la base del sitio todavía no
   * existe en el proyecto (§5.6 / `metadataBase`). Un JSON-LD sin `url` es
   * válido; uno con `url: "/tutors/…"` es basura que el validador rechaza.
   */
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name,
    ...(tutor.headline ? { description: tutor.headline } : {}),
    ...(avatar ? { image: avatar } : {}),
    ...(hayValoracion
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: nota,
            reviewCount: totalResenas,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };

  /**
   * El estado del panel de reserva vive ENTERO en la query: clase (`p`), día
   * (`d`), hora (`h`) y —desde §5.11— mes de la rejilla (`m`). Nada de estado
   * de cliente: la ficha es un server component y así la elección se puede
   * compartir, recargar y deshacer con el botón atrás.
   *
   * ⚠️ `URLSearchParams` no es adorno: la hora es un ISO con `:` y, según el
   * huso, un `+` en el offset. Concatenarla a mano dejaría ese `+` crudo en la
   * query, donde significa "espacio" — la hora llegaría destrozada al otro lado
   * y el panel la descartaría por no casar con ningún hueco.
   *
   * El `#reservar` es para quien llega de FUERA (los enlaces del carrito):
   * aterriza en el panel y no al principio de la ficha. Dentro del panel el
   * hash es justo lo contrario —hacía que Next realineara la vista bajo la
   * cabecera en cada selección—, y por eso sus controles navegan con
   * `scroll: false`.
   */
  const hrefFor = (next: {
    p?: string;
    d?: string;
    h?: string;
    m?: string;
  }) => {
    const q = new URLSearchParams();
    if (next.p) q.set("p", next.p);
    if (next.d) q.set("d", next.d);
    if (next.h) q.set("h", next.h);
    if (next.m) q.set("m", next.m);
    const s = q.toString();
    return s ? `/tutors/${id}?${s}#reservar` : `/tutors/${id}#reservar`;
  };

  return (
    <>
      {/* EY-186 · «tutores vistos». No pinta nada y no se le pasa la sesión a
          propósito: la comprueba él con `getSession()`, que es lectura local.
          Pasársela desde aquí obligaría a que la ficha de la mentoría —que hoy
          no consulta la sesión— añadiera un viaje a Auth solo para esto. */}
      <RegistrarVisita tutorId={tutor.id} origen="tutor" />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/*
        G-05 · HERO Y CUERPO SON **UNA SOLA REJILLA**, y esto es estructural.

        Hasta hoy el hero era un `div` azul a ancho completo y el cuerpo otra
        rejilla debajo: el panel de reserva no podía subir a la altura del
        nombre porque, sencillamente, no estaba en la misma rejilla que el hero.
        Ahora hay una: `minmax(0,1fr) 348px` con 40 px de hueco, el hero ocupa
        la columna izquierda de la FILA 1, el cuerpo la columna izquierda de la
        FILA 2 y el panel la columna derecha de las DOS.

        ⚠️ El azul NO es el fondo del hero: es una capa propia (`col-span-full`,
        fila 1) que se estira sola a la altura de esa fila. Si fuera el fondo del
        hero, terminaría en el borde de la columna izquierda y el panel quedaría
        recortado sobre blanco.

        ⚠️ Y ese azul tiene que llegar de borde a borde de la VENTANA, no del
        `Container`. De ahí el margen negativo `calc(50% - 50vw)` a cada lado,
        que deja la banda en exactamente 100vw. Los pocos píxeles que 100vw se
        pasa cuando hay barra de scroll clásica se los come el `overflow-x-clip`
        de fuera — **clip y no hidden** (§5.15): `hidden` convertiría ese div en
        contenedor de scroll y dejaría al panel `sticky` sin viewport al que
        pegarse.
      */}
      <div className="overflow-x-clip">
        <Container className="grid grid-cols-[minmax(0,1fr)] gap-y-11 pb-8 sm:pb-16 md:max-lg:pb-10 lg:grid-cols-[minmax(0,1fr)_348px] lg:gap-x-10 lg:gap-y-0">
          {/* La banda azul del hero. Desde lg lleva el degradado del Figma (el
              mismo asset que P01); por debajo, azul de marca PLANO —lo que
              dibuja «P07 — Hero — Perfil» a 390 (#0080ff medido en las cuatro
              esquinas)— que además sube el contraste del texto blanco en el
              extremo derecho, donde el degradado llega a #49a9ff y el blanco se
              queda en 2,5:1, hasta el 3,8:1 del azul de marca. `bg-brand` pinta
              el color en todos los anchos y `max-lg:bg-none` apaga la imagen del
              degradado solo bajo lg (R1). */}
          <div
            aria-hidden
            className="col-span-full row-start-1 mx-[calc(50%_-_50vw)] bg-brand bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% max-lg:bg-none"
          />

          {/* `relative` para que el texto del hero pinte POR ENCIMA de la banda:
              los dos ocupan la misma celda en móvil (una columna) y en la misma
              fila en escritorio. Aire vertical: el Figma P07 a 390 deja ~18
              arriba y ~22 abajo, no los 36 de escritorio; en escritorio la
              referencia pide 34/36. */}
          <div className="relative col-start-1 row-start-1 py-5 text-white md:py-9 lg:pt-[34px] lg:pb-9">
            {/* G-08 · la miga incluye la categoría principal. Los enlaces miden
                18 px de alto: `py-3 -my-3` les da 43,5 px de objetivo táctil sin
                mover un píxel (la caja de margen mide lo mismo que la línea).
                En móvil va a 11 px y a una sola línea con elipsis.

                ⚠️ El `truncate` recorta EN LOS DOS EJES (es `overflow: hidden`),
                y lo que se recorta deja de recibir el dedo. Por eso la propia
                miga lleva `py-2 -my-2` en móvil: agranda la caja de recorte 8 px
                por lado sin mover nada, así el objetivo táctil de los enlaces
                sobrevive en ~32 px en vez de quedarse en la línea de texto. */}
            <nav
              aria-label="Miga de pan"
              className="truncate text-[11px] text-white/80 max-lg:-my-2 max-lg:py-2 lg:text-[13px] lg:text-white/90"
            >
              <Link
                href="/"
                className="inline-block py-3 -my-3 hover:underline"
              >
                Inicio
              </Link>
              {" / "}
              <Link
                href="/tutors"
                className="inline-block py-3 -my-3 hover:underline"
              >
                Tutores
              </Link>
              {categoriaPrincipal ? (
                <>
                  {" / "}
                  <Link
                    href={`/categories/${categoriaPrincipal.cat.slug}`}
                    className="inline-block py-3 -my-3 hover:underline"
                  >
                    {categoriaPrincipal.cat.name}
                  </Link>
                </>
              ) : null}
              {" / "}
              <span>{name}</span>
            </nav>

            {/*
              §1 / §2 · el MISMO marcado da las dos composiciones.

              Escritorio: avatar de 120 a la izquierda y, a su derecha, nombre +
              píldora, estrellas, título, meta y la fila de acciones.

              Móvil (< lg): perfil tipo red social, TODO CENTRADO. La columna de
              texto pasa a ser un flex que envuelve, la fila de acciones es
              `display: contents` —así sus botones se convierten en hermanos de
              las demás líneas— y `max-lg:order-*` los recoloca: el compartir
              sube al lado del nombre y los dos botones bajan a una fila de 50 %
              cada uno. Cero DOM duplicado: lo único que existe solo en móvil es
              el botón «Reserva con …», que en escritorio no está en el diseño.
            */}
            <div className="mt-4 flex flex-col items-center text-center lg:flex-row lg:items-start lg:gap-6 lg:text-start">
              <span className="grid size-[88px] shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 text-[30px] font-semibold lg:size-[120px] lg:text-[34px]">
                {avatar ? (
                  <Image
                    src={avatar}
                    alt=""
                    width={120}
                    height={120}
                    className="size-[88px] object-cover lg:size-[120px]"
                    unoptimized
                  />
                ) : (
                  initialsFrom(name)
                )}
              </span>

              {/* `max-lg:w-full`: sin él este flex es hijo de un `items-center` y su
                  ancho es «lo que ocupe su contenido», que con la fila de botones
                  dentro se pasaba 27 px del `Container` y sacaba el botón naranja
                  fuera del margen. Fijándolo al ancho del padre, el `flex-1` de
                  cada botón reparte sobre la caja correcta. */}
              <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-2 max-lg:mt-3 max-lg:w-full lg:block lg:flex-1">
                {/* En móvil este envoltorio es `contents`, así que el nombre y
                    la insignia se vuelven celdas del flex de arriba y el botón
                    de compartir puede colarse entre ellos con `order`. Desde lg
                    vuelve a ser la fila de siempre. */}
                <div className="max-lg:contents lg:flex lg:flex-wrap lg:items-center lg:gap-3">
                  {/* `break-words` + `min-w-0`: el nombre lo escribe quien se
                      registra y una palabra de 35 letras desbordaba y abría
                      scroll horizontal en toda la página. */}
                  <h1 className="min-w-0 text-[22px] leading-tight font-bold break-words max-lg:order-1 lg:text-[28px]">
                    {name}
                  </h1>

                  {/* La insignia es la misma caja en los dos anchos, cambiando
                      de forma: círculo naranja de 22 px con un check en móvil
                      (§2: sin texto, que no cabe al lado de un nombre de 22 px)
                      y píldora con `BadgeCheck` + «Tutor verificado» desde lg.
                      El texto NO desaparece en móvil, se va a `sr-only`: un
                      check suelto no dice nada a quien usa lector de pantalla.

                      ⚠️ Contraste: blanco sobre el naranja de marca da 2,9:1 (AA
                      pide 4,5). Es el par de TODOS los CTA del sitio y del
                      Figma; cambiarlo es decisión de marca. Si se decide, el par
                      con tokens es `bg-primary-muted
                      text-primary-muted-foreground` (7:1). */}
                  <span
                    title={tituloVerificado}
                    className="inline-grid size-[22px] shrink-0 place-items-center rounded-full bg-primary text-white max-lg:order-2 lg:inline-flex lg:size-auto lg:h-[26px] lg:gap-1.5 lg:px-2.5 lg:text-xs lg:font-semibold"
                  >
                    <CheckIcon className="size-3 lg:hidden" aria-hidden />
                    <BadgeCheckIcon
                      className="size-3.5 max-lg:hidden"
                      aria-hidden
                    />
                    <span className="max-lg:sr-only">Tutor verificado</span>
                  </span>
                </div>

                {/* G-01 · la valoración es una LÍNEA DE TEXTO, nunca un chip ni
                    una tarjeta. Las estrellas van a #ffc531 porque el fondo es
                    azul; el #f59e0b de las reseñas sobre blanco se apaga aquí.
                    La estrella es adorno: al lector de pantalla se le dice
                    «Valoración 4.9» en vez de «estrella negra 4.9». */}
                {hayValoracion ? (
                  <p
                    title={`Media de ${totalResenas} reseñas de alumnos que terminaron una mentoría`}
                    className="mt-1 flex items-center gap-1.5 text-[13px] max-lg:order-4 max-lg:basis-full max-lg:justify-center lg:mt-1.5 lg:text-sm"
                  >
                    <span aria-hidden className="flex gap-0.5 text-[#ffc531]">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <StarIcon
                          key={n}
                          className={
                            n <= estrellasLlenas
                              ? "size-[15px] fill-current"
                              : "size-[15px] text-white/40"
                          }
                        />
                      ))}
                    </span>
                    <span className="font-bold">
                      <span className="sr-only">Valoración </span>
                      {notaTexto}
                    </span>
                    <span className="text-white/90">
                      · {totalResenas}{" "}
                      {totalResenas === 1 ? "reseña" : "reseñas"}
                    </span>
                  </p>
                ) : null}

                {/* G-10 · título y meta NO envuelven en escritorio: una línea
                    cada uno, con elipsis. En móvil la meta sí se permite a dos
                    líneas (`line-clamp-2`) y con 300 px de ancho máximo, que es
                    lo que dibuja la referencia. */}
                {titulo ? (
                  <p className="mt-2.5 text-[15px] font-semibold max-lg:order-5 max-lg:basis-full lg:mt-2 lg:truncate lg:text-[17px]">
                    {titulo}
                  </p>
                ) : null}
                {meta ? (
                  <p className="mt-1 text-[13px] text-white/90 max-lg:order-6 max-lg:line-clamp-2 max-lg:max-w-[300px] max-lg:basis-full lg:mt-0.5 lg:max-w-[640px] lg:truncate lg:text-sm">
                    {meta}
                  </p>
                ) : null}

                {/* G-06 · preguntar ANTES de pagar. Va aquí, junto al nombre y a
                    la altura del panel de reserva, porque es el mismo momento:
                    se está decidiendo si comprarle a esta persona.

                    ⚠️ EY-194 · estuvo retirado del 20 al 26 de agosto por la
                    respuesta del cliente a P-1. Vuelve porque el 26 pidió lo
                    contrario. Si algún día se cierra otra vez, la puerta está en
                    `pair_can_chat` (una migración), no aquí.

                    `max-lg:contents` es lo que permite que en móvil el compartir
                    se vaya arriba (order-3) y los botones bajen a su fila sin
                    duplicar ni un nodo. */}
                <div className="max-lg:contents lg:mt-5 lg:flex lg:flex-wrap lg:items-center lg:gap-3.5">
                  {/*
                    §2 · LA FILA DE DOS BOTONES AL 50 %, y por qué es una caja y
                    no dos hermanos sueltos con `order`.

                    El hero móvil es un flex que envuelve, y cada línea la cierra
                    quien lleva `basis-full`. La meta lleva las dos cosas:
                    `basis-full` **y** `max-w-[300px]` (§2 pide ese tope), así que
                    ocupa 300 de los ~335 disponibles y deja 35 px libres a su
                    derecha — sitio de sobra para que el flex meta ahí al
                    siguiente hermano. Con los botones sueltos, el naranja subía a
                    esa línea aplastado contra el borde («Reserva con Valentina»
                    en 35 px) y «Pregúntale» se quedaba solo abajo a lo ancho.

                    Metiéndolos en su propia caja `basis-full`, la fila es una
                    línea entera y el `flex-1` de cada uno reparte de verdad al
                    50 %. Desde lg la caja es `contents` y desaparece: los dos
                    botones vuelven a ser hijos del flex de escritorio, sin
                    duplicar un solo nodo.
                  */}
                  <div className="max-lg:order-7 max-lg:mt-4 max-lg:flex max-lg:w-full max-lg:basis-full max-lg:gap-3 lg:contents">
                    {/* §2 · solo móvil: en escritorio el panel de reserva ya está
                      a la vista, al lado del nombre, y un botón que hace scroll
                      hacia algo que se ve no es un botón. */}
                    <a
                      href="#reservar"
                      /* `grow-[1.25]` y no un `flex-1` a secas: los dos botones parten
                        de base 0 y reparten, pero sus etiquetas no miden lo mismo
                        —«Reserva con Valentina» es el doble de larga que
                        «Pregúntale»— y al 50 % exacto la primera se cortaba a
                        media palabra. Con esto quedan en ~55/45, que es lo que
                        dibuja la referencia, y ninguna de las dos recorta. */
                      className="inline-flex h-[46px] min-w-0 grow-[1.25] basis-0 items-center justify-center gap-2 overflow-hidden rounded-lg bg-primary px-2.5 text-xs font-semibold whitespace-nowrap text-white shadow-[0_6px_18px_rgb(0_0_0/0.18)] lg:hidden"
                    >
                      <CalendarIcon className="size-4 shrink-0" aria-hidden />
                      Reserva con {nombreCorto}
                    </a>

                    {esMiFicha ? null : (
                      <ContactTutor
                        tutorId={tutor.id}
                        tutorName={name}
                        anonimo={!user}
                        // En móvil es el botón SECUNDARIO (borde blanco de 1,5 px)
                        // porque ahí el primario es reservar; desde lg vuelve a
                        // ser el naranja de siempre, sin tocar nada.
                        //
                        // El texto lo parte el propio componente: «Pregúntale»
                        // por debajo de lg (§2) y «Pregúntale a {nombre}» desde
                        // lg (§1), escondiendo el nombre en un span. Por eso aquí
                        // no hace falta ni `label` ni encoger la tipografía.
                        className="max-lg:min-w-0 max-lg:flex-1 max-lg:border-[1.5px] max-lg:border-white max-lg:bg-transparent max-lg:text-white max-lg:shadow-none max-lg:hover:bg-white/10"
                      />
                    )}
                  </div>

                  {/* G-07 · el mismo botón a 46 px en escritorio y a 22 px en
                      círculo junto al nombre en móvil. La forma la pone quien
                      llama; el componente solo sabe compartir. */}
                  <ShareButton
                    label="Compartir perfil"
                    title={`${name} · Enséñame Ya`}
                    text={titulo ?? `Mira el perfil de ${name} en Enséñame Ya`}
                    className="max-lg:order-3 max-lg:size-[22px] max-lg:rounded-full max-lg:border max-lg:border-white/70 max-lg:[&_svg]:size-3 lg:size-[46px] lg:rounded-lg lg:border lg:border-white/45 lg:hover:bg-white/10"
                  />

                  {/* G-06 · sin dato de respuesta NO se promete un plazo: se
                      cambia la frase por lo único que sigue siendo cierto («sin
                      compromiso, pregunta antes de pagar»). Un "responde en 2
                      horas" de adorno es una promesa que la plataforma no puede
                      cumplir y que el alumno usa para decidir la compra. */}
                  <p
                    title={
                      respuesta
                        ? "Mediana de lo que tarda en contestar un mensaje (últimos 90 días)"
                        : undefined
                    }
                    className="text-xs text-white/95 max-lg:order-9 max-lg:mt-2 max-lg:basis-full lg:text-[13px]"
                  >
                    <ClockIcon
                      className="me-1 inline size-3.5 -translate-y-px"
                      aria-hidden
                    />
                    <span className="font-semibold">
                      {respuesta ?? "Resuelve tus dudas antes de reservar"}
                    </span>
                    {respuesta ? " · Sin compromiso" : null}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/*
            Verónica 3-sep (P07): «subir calendario antes de reseñas, debajo de
            descripción, lo que aprenderás y mentorías» y «finalizar página con
            reseñas». Orden en móvil: Sobre mí → Lo que enseño → Mentorías →
            Reserva → Política de cancelación → Reseñas. Ella misma prefiere las
            mentorías ANTES del calendario, al revés que el Figma: «si no, no se
            entiende de qué es el calendario». Gana Verónica, y §2 lo confirma:
            el orden de secciones NO cambia.

            Sin duplicar DOM: por debajo de lg esta columna es
            `display: contents`, así que sus bloques y `#reservar` pasan a ser
            celdas de la rejilla de arriba y se ordenan con `max-lg:order-*`.
            Desde lg vuelve a ser la columna izquierda de la fila 2. El orden del
            DOM (y el de lectura) sigue siendo el de escritorio: entre reseñas y
            política no hay nada enfocable, así que el tabulador no salta hacia
            atrás. `#reservar` conserva su id: los enlaces del carrito llegan ahí.
          */}
          <div className="max-lg:contents lg:col-start-1 lg:row-start-2 lg:flex lg:flex-col lg:gap-11 lg:pt-10">
            {/* §1 · SIN BIO LA SECCIÓN NO SE PINTA. Antes salía «Este tutor aún
                no escribió su biografía», que es ocupar el sitio de «Sobre mí»
                para decir que no hay nada que contar. */}
            {tutor.bio ? (
              <div className="max-lg:order-1">
                <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                  Sobre mí
                </h2>

                {/* La tira de estadísticas: filetes arriba y abajo, SIN cajas, y
                    cada dato en exactamente tres líneas (icono, cifra, apoyo).
                    Dos columnas en móvil (§2), tantas como datos haya en
                    escritorio. `title` en cada una porque «2 niveles» sin
                    explicación no dice de qué son. */}
                {estadisticas.length > 0 ? (
                  <div
                    className={`mt-4 grid gap-x-6 gap-y-4 border-y border-[#ebebeb] py-[18px] ${
                      estadisticas.length === 1 ? "grid-cols-1" : "grid-cols-2"
                    } ${COLUMNAS_ESTADISTICAS[estadisticas.length] ?? ""}`}
                  >
                    {estadisticas.map(({ key, Icon, valor, apoyo, title }) => (
                      <div key={key} title={title} className="min-w-0">
                        <span className="grid size-[30px] place-items-center rounded-full bg-[#eaf3ff]">
                          <Icon className="size-4 text-[#0072ff]" aria-hidden />
                        </span>
                        {/* G-10 · nada envuelve: si no cabe, elipsis. */}
                        <p className="mt-2 truncate text-[13.5px] leading-tight font-bold text-[#19191f]">
                          {valor}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-[#6b6b6b]">
                          {apoyo}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {/* Bio completa, sin recortar y sin los enlaces del tutor:
                    `socials` es para verificación interna, no para publicarlo. */}
                <p className="mt-3.5 text-[15px] text-pretty text-[#525252]">
                  {tutor.bio}
                </p>
              </div>
            ) : null}

            {topics.length > 0 ? (
              <div className="max-lg:order-2">
                <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                  Lo que enseño
                </h2>
                <ul className="mt-3.5 divide-y divide-[#ebebeb] border-b border-[#ebebeb]">
                  {topics.map(({ cat, items }) => {
                    // El mínimo de la categoría con SU moneda: quedarse con el
                    // producto y no solo con la cifra evita mezclar el importe
                    // de uno con el símbolo de otro el día que haya dos monedas.
                    const barato = items.reduce((a, b) =>
                      b.priceAmount < a.priceAmount ? b : a,
                    );
                    // «1 mentoría · paquete de 4 sesiones»: con una sola clase y
                    // de tipo paquete, «desde US$ 60» sería el precio del
                    // paquete entero disfrazado de precio de entrada.
                    const soloPaquete =
                      items.length === 1 &&
                      barato.pricingModel === "per_package" &&
                      (barato.packageNumSessions ?? 0) > 1;
                    // Niveles primero y idiomas después, únicos y en el orden de
                    // los filtros de P05.
                    const chips = [
                      ...LEVELS.filter((l) =>
                        items.some((p) => p.level === l.id),
                      ).map((l) => l.label),
                      ...LANGUAGES.filter((l) =>
                        items.some((p) => p.language === l.id),
                      ).map((l) => l.label),
                    ];

                    return (
                      <li
                        key={cat.slug}
                        className="flex items-center justify-between gap-4 py-4"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/categories/${cat.slug}`}
                            className="text-[15px] font-medium text-[#2e2e2e] hover:underline"
                          >
                            {cat.name}
                          </Link>
                          {/* El «desde» va con la cifra DENTRO de la frase, así
                              que es la versión de una línea: «desde ≈ 14.200 CLP
                              (15,00 US$)». Antes esto tenía su propio
                              `Intl.NumberFormat` para comerse los céntimos —dos
                              formateadores de dinero en la casa—; ahora lo pinta
                              el mismo componente que las tarjetas de abajo, que
                              es lo que evita que la misma clase salga con dos
                              cifras distintas en la misma pantalla. */}
                          <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
                            {items.length}{" "}
                            {items.length === 1 ? "mentoría" : "mentorías"} ·{" "}
                            {soloPaquete ? (
                              `paquete de ${barato.packageNumSessions} sesiones`
                            ) : (
                              <>
                                desde{" "}
                                <PrecioEnLinea
                                  amountMinor={barato.priceAmount}
                                  currency={barato.currency}
                                />
                              </>
                            )}
                          </p>
                        </div>
                        {chips.length > 0 ? (
                          <span className="flex flex-wrap justify-end gap-1.5">
                            {chips.map((c) => (
                              <span
                                key={c}
                                className="rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium whitespace-nowrap text-[#5c5c5c]"
                              >
                                {c}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="max-lg:order-3">
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                Mentorías de {nombreCorto}
              </h2>
              {products.length === 0 ? (
                <p className="mt-3.5 text-sm text-muted-foreground">
                  Este tutor aún no publicó mentorías.
                </p>
              ) : (
                /* §2 · en móvil las mentorías van en FILA HORIZONTAL
                   DESPLAZABLE de tarjetas de 190 px: apiladas se comían la
                   pantalla entera y empujaban el calendario fuera de la vista.
                   Los márgenes negativos (uno por cada gutter del `Container`)
                   dejan que la fila llegue al borde, que es lo que dice «esto
                   sigue» sin necesidad de una flecha. Desde lg, la rejilla de
                   dos columnas de siempre. */
                <div className="mt-4 max-lg:-mx-5 max-lg:flex max-lg:gap-2.5 max-lg:overflow-x-auto max-lg:px-5 max-lg:pb-1 sm:max-lg:-mx-6 sm:max-lg:px-6 md:max-lg:-mx-8 md:max-lg:px-8 lg:grid lg:grid-cols-2 lg:gap-5">
                  {products.map((p) => (
                    <div
                      key={p.id}
                      className="max-lg:w-[190px] max-lg:shrink-0"
                    >
                      <ProductCard product={p} action="ver" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="max-lg:order-6">
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                Reseñas
                {/* El apoyo dice de QUIÉN son las reseñas y qué hizo falta para
                    escribirlas. En móvil no se pinta: la referencia deja ahí el
                    título a secas y la línea ocuparía dos renglones. */}
                <span className="ms-2.5 text-[13px] font-medium text-[#6b6b6b] max-lg:hidden">
                  de alumnos que terminaron una mentoría con {nombreCorto}
                </span>
              </h2>
              {/* §5.5 · la nota y el recuento salen de `tutor_profiles`, no de
                  la lista: la lista se corta en 50 y este número tiene que ser
                  el mismo que el del hero. El histograma sí se dibuja sobre las
                  cargadas (no hay recuento por estrella en la BD). */}
              <div className="mt-5">
                <ReviewsSummary
                  reviews={reviews}
                  avg={nota ?? undefined}
                  count={totalResenas > 0 ? totalResenas : undefined}
                />
              </div>
              {reviews.length > 0 ? (
                <hr className="my-5 border-[#ebebeb]" />
              ) : null}
              <TutorReviews
                withContext
                reviews={reviews}
                visible={3}
                moreLabel={
                  totalResenas === 1
                    ? "Ver la reseña"
                    : `Ver las ${totalResenas} reseñas`
                }
              />
            </div>

            {/* En móvil, pegada al panel de reserva: es la letra pequeña de lo
                que se acaba de reservar, y así las reseñas cierran la página. */}
            <CancellationPolicy className="max-lg:order-5" />
          </div>

          {/*
            G-05 · la columna del panel ocupa LAS DOS FILAS y arranca 69 px bajo
            el borde del hero, o sea a la altura del nombre.

            ⚠️ Ocupar las dos filas no es cosmético: es lo que le da RECORRIDO al
            `sticky` del propio panel. `booking-panel.tsx` documenta que su
            `lg:sticky` nunca llegó a despegarse porque el hijo de la rejilla
            —este div— medía exactamente lo mismo que el `aside`, así que había
            0 px que recorrer. Al estirarlo a la altura de la columna entera
            (`row-start-1` + `row-end-3`, que se quedan estirados por defecto),
            el `aside` sí tiene por dónde deslizarse.

            ⚠️ `row-start-1 row-end-3` y NO `row-span-2 row-start-1`: lo segundo
            son dos declaraciones, una de ellas la ABREVIADA `grid-row`, y según
            en qué orden las emita Tailwind la abreviada le pisa el inicio a la
            otra. Dos propiedades largas no pueden contradecirse.

            `scroll-mt-44` por debajo de lg: la cabecera pública es sticky y mide
            173 px a 390 (147 a 768), así que llegar por el ancla —los enlaces
            del carrito— dejaba el título del panel debajo de ella.
          */}
          <div
            id="reservar"
            className="max-lg:order-4 max-lg:scroll-mt-44 lg:col-start-2 lg:row-start-1 lg:row-end-3 lg:mt-[69px]"
          >
            <BookingPanel
              products={products}
              selectedId={sp.p}
              selectedDay={sp.d}
              selectedTime={sp.h}
              month={sp.m}
              timeZone={timeZone}
              hrefFor={hrefFor}
              // §5.12 · el título manda por prop: en esta página el panel es
              // «Reserva con Valentina», no «Reserva estas mentorías».
              title={`Reserva con ${nombreCorto}`}
              compact
              // G-03 · la confirmación es POR MENTORÍA: la línea aparece cuando
              // hay una elegida y dice lo que promete ESA.
              autoAcceptLine
            />
          </div>
        </Container>
      </div>
    </>
  );
}
