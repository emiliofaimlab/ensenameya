import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheckIcon } from "lucide-react";

import { getSessionContext, getViewerTimezone } from "@/lib/auth/server";
import { ContactTutor } from "@/components/chat/contact-tutor";
import { tutorResponseTime } from "@/components/chat/conversations";
import { responseTimeLabel } from "@/components/chat/types";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { BookingPanel } from "@/components/catalog/booking-panel";
import { ProductCard } from "@/components/catalog/product-card";
import { CancellationPolicy } from "@/components/catalog/cancellation-policy";
import {
  ReviewsSummary,
  TutorReviews,
} from "@/components/catalog/tutor-reviews";
import { getTutorDetail, listTutorReviews } from "@/lib/catalog/queries";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";

const LEVELS: Record<string, string> = {
  basico: "Básico",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getTutorDetail(id);
  const t = data?.tutor;
  return {
    title: t
      ? `${t.displayName ?? t.headline ?? "Tutor"} · Enséñame Ya`
      : "Tutor",
  };
}

export default async function TutorProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ p?: string; d?: string; h?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // M-12 · el tiempo de respuesta se pide en paralelo con lo demás: alimenta el
  // mismo bloque del hero y no depende de nada. `tutorResponseTime` devuelve
  // `null` mucho más a menudo de lo que parece (tutor nuevo, o que no
  // contesta), y `null` significa NO PINTAR NADA.
  //
  // ⚠️ EY-194 · la sesión vuelve al `Promise.all`, y con ella el botón
  // «Escribir a …». La quitó MN-06 el 20-ago; el 26-ago el cliente pidió
  // reabrir la consulta previa. Va en paralelo con lo demás porque no depende
  // de nada: solo decide si el botón escribe o abre el alta.
  const [data, reviews, respuestaMin, { user }] = await Promise.all([
    getTutorDetail(id),
    listTutorReviews(id),
    tutorResponseTime(id),
    getSessionContext(),
  ]);
  if (!data) notFound();
  const { tutor, products } = data;

  const respuesta = responseTimeLabel(respuestaMin);
  // Escribirse a uno mismo no es una conversación (la RPC lo rechaza igual;
  // esto es para no enseñar un botón que solo puede fallar).
  const esMiFicha = user?.id === tutor.id;

  const name = tutor.displayName ?? tutor.headline ?? "Tutor";
  const avatar = storageUrl("avatars", tutor.avatarPath);
  const level = tutor.teachingLevel ? LEVELS[tutor.teachingLevel] : null;

  // "Lo que enseño" sale de las categorías de sus productos activos.
  const topics = [
    ...new Map(
      products.flatMap((p) => p.categories.map((c) => [c.slug, c])),
    ).values(),
  ];

  /**
   * El estado del panel de reserva vive ENTERO en la query: clase (`p`), día
   * (`d`) y —desde MN-16— hora (`h`). Nada de estado de cliente: la ficha es un
   * server component y así la elección se puede compartir, recargar y deshacer
   * con el botón atrás.
   *
   * ⚠️ `URLSearchParams` no es adorno: la hora es un ISO con `:` y, según el
   * huso, un `+` en el offset. Concatenarla a mano dejaría ese `+` crudo en la
   * query, donde significa "espacio" — la hora llegaría destrozada al otro lado
   * y el panel la descartaría por no casar con ningún hueco.
   *
   * El `#reservar` mantiene la vista en el panel: sin él, elegir una hora
   * rebotaría al principio de la ficha en cada pulsación.
   */
  const hrefFor = (next: { p?: string; d?: string; h?: string }) => {
    const q = new URLSearchParams();
    if (next.p) q.set("p", next.p);
    if (next.d) q.set("d", next.d);
    if (next.h) q.set("h", next.h);
    const s = q.toString();
    return s ? `/tutors/${id}?${s}#reservar` : `/tutors/${id}#reservar`;
  };

  return (
    <>
      {/* Hero sobre el degradado azul del Figma (el mismo asset que P01). */}
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-9">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/90">
            <Link href="/" className="hover:underline">
              Inicio
            </Link>
            {" / "}
            <Link href="/tutors" className="hover:underline">
              Tutores
            </Link>
            {" / "}
            <span>{name}</span>
          </nav>

          <div className="mt-4 flex flex-wrap items-start gap-6">
            <span className="grid size-[100px] shrink-0 place-items-center overflow-hidden rounded-full bg-white/15 text-2xl font-semibold">
              {avatar ? (
                <Image
                  src={avatar}
                  alt=""
                  width={100}
                  height={100}
                  className="size-[100px] object-cover"
                  unoptimized
                />
              ) : (
                initialsFrom(name)
              )}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold sm:text-[28px]">{name}</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1.5 text-xs font-semibold">
                  <BadgeCheckIcon className="size-3.5" />
                  Tutor verificado
                </span>
              </div>

              {tutor.headline ? (
                <p className="mt-2 max-w-[700px] text-pretty text-base font-medium">
                  {tutor.headline}
                </p>
              ) : null}

              {/* El Figma pedía aquí años de experiencia, tiempo de respuesta e
                  idiomas. El tiempo de respuesta YA EXISTE desde M-12: se
                  calcula (mediana de lo que tarda en contestar, 90 días,
                  mínimo 5 observaciones) y si no da un número honesto no sale
                  nada — ver `tutor_response_time`. Los otros dos siguen sin
                  estar en ninguna tabla (idioma es DD-03). */}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                {reviews.length > 0 && tutor.ratingAvg ? (
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold">
                      ★ {tutor.ratingAvg.toFixed(1)}
                    </span>
                    <span className="text-[13px] text-white/90">
                      {reviews.length}{" "}
                      {reviews.length === 1 ? "reseña" : "reseñas"}
                    </span>
                  </span>
                ) : null}
                {level ? (
                  <>
                    <span
                      aria-hidden
                      className="size-1 rounded-full bg-white"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold">Nivel</span>
                      <span className="text-[13px] text-white/90">{level}</span>
                    </span>
                  </>
                ) : null}
                {products.length > 0 ? (
                  <>
                    <span
                      aria-hidden
                      className="size-1 rounded-full bg-white"
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold">{products.length}</span>
                      <span className="text-[13px] text-white/90">
                        {products.length === 1 ? "mentoría" : "mentorías"}
                      </span>
                    </span>
                  </>
                ) : null}
                {/* Sin dato suficiente no hay chip. Un "responde en 2 horas" de
                    adorno es una promesa que la plataforma no puede cumplir y
                    que el alumno usa para decidir la compra. */}
                {respuesta ? (
                  <>
                    <span aria-hidden className="size-1 rounded-full bg-white" />
                    <span className="text-[13px] text-white/90">{respuesta}</span>
                  </>
                ) : null}
              </div>

              {/* M-12 · preguntar ANTES de pagar. Va aquí, junto al nombre y a
                  la altura del panel de reserva, porque es el mismo momento: se
                  está decidiendo si comprarle a esta persona.

                  ⚠️ EY-194 · estuvo retirado del 20 al 26 de agosto por la
                  respuesta del cliente a P-1. Vuelve porque el 26 pidió lo
                  contrario. Si algún día se cierra otra vez, la puerta está en
                  `pair_can_chat` (una migración), no aquí. */}
              {esMiFicha ? null : (
                <div className="mt-5">
                  <ContactTutor
                    tutorId={tutor.id}
                    tutorName={name}
                    anonimo={!user}
                  />
                </div>
              )}
            </div>
          </div>
        </Container>
      </div>

      <Container>
        <Section className="grid items-start gap-10 lg:grid-cols-[1fr_348px]">
          <div className="flex flex-col gap-11">
            <div>
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">Sobre mí</h2>
              <p className="mt-3.5 text-pretty text-[15px] text-[#525252]">
                {tutor.bio ?? "Este tutor aún no escribió su biografía."}
              </p>
            </div>

            {topics.length > 0 ? (
              <div>
                <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                  Lo que enseño
                </h2>
                {/* Lista con separadores, como el Figma. El chip de la derecha
                    es el nivel del TUTOR (IV-02): no hay nivel por materia. */}
                <ul className="mt-3.5 divide-y divide-[#ebebeb] border-b border-[#ebebeb]">
                  {topics.map((c) => (
                    <li
                      key={c.slug}
                      className="flex items-center justify-between gap-4 py-4"
                    >
                      <Link
                        href={`/categories/${c.slug}`}
                        className="text-[15px] font-medium text-[#2e2e2e] hover:underline"
                      >
                        {c.name}
                      </Link>
                      {level ? (
                        <span className="rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium text-[#5c5c5c]">
                          {level}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">
                Mentorías de {name.split(" ")[0]}
              </h2>
              {products.length === 0 ? (
                <p className="mt-3.5 text-sm text-muted-foreground">
                  Este tutor aún no publicó mentorías.
                </p>
              ) : (
                <div className="mt-4 grid gap-5 sm:grid-cols-2">
                  {products.map((p) => (
                    <ProductCard key={p.id} product={p} action="ver" />
                  ))}
                </div>
              )}
            </div>

            <div>
              {/* El contador sale de las reseñas QUE SE MUESTRAN, no de
                  `rating_count`: si no, un rating sembrado (o reseñas purgadas)
                  anuncia "Reseñas (37)" sobre una lista vacía. */}
              <h2 className="text-[22px] font-bold text-[#1f1f1f]">Reseñas</h2>
              <div className="mt-5">
                <ReviewsSummary reviews={reviews} />
              </div>
              {reviews.length > 0 ? (
                <hr className="my-5 border-[#ebebeb]" />
              ) : null}
              <TutorReviews reviews={reviews} />
            </div>

            <CancellationPolicy />
          </div>

          <div id="reservar">
            <BookingPanel
              products={products}
              selectedId={sp.p}
              selectedDay={sp.d}
              selectedTime={sp.h}
              timeZone={await getViewerTimezone()}
              hrefFor={hrefFor}
            />
          </div>
        </Section>
      </Container>
    </>
  );
}
