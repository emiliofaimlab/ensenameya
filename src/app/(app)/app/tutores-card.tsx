import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { ScrollCarousel } from "@/components/ui/scroll-carousel";
import { TutorSummary } from "@/components/tutor-summary";
import type { PanelTutores } from "./tutores";

/**
 * EY-186 · B5.3 — el carrusel de tutores del panel del alumno (AL02).
 *
 * ⚠️ **NO DICE «FAVORITOS» EN NINGÚN SITIO, Y ES DELIBERADO.** El cliente usó
 * esa palabra («algoritmo de tutores favoritos») y describe bien la INTENCIÓN,
 * pero en una interfaz «favoritos» significa una cosa muy concreta: que tú los
 * guardaste y puedes quitarlos. Aquí no hay nada que guardar ni que quitar —la
 * lista se deduce sola—, así que ese título generaría la pregunta «¿cómo saco a
 * este de favoritos?» y no habría respuesta. Se dice lo que es.
 *
 * Y por eso cada tarjeta lleva su motivo. Una lista ordenada por un algoritmo
 * que no enseña su criterio se lee como publicidad; con «Diste 3 clases con
 * él» debajo del nombre, el orden se explica solo. Es el mismo razonamiento del
 * subtítulo de `SugerenciasCard` (N-30).
 *
 * Se reutiliza `TutorSummary` en su variante compacta —la de A-6 en el checkout
 * y la que ya usaba el bloque al que esto sustituye— para no estrenar una
 * quinta forma de pintar un tutor.
 */
export function TutoresCard({ data }: { data: PanelTutores }) {
  const deSuHistorial = data.source === "afinidad";

  return (
    <PanelCard>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <PanelCardTitle className="text-[22px]">
            {deSuHistorial ? "Tus tutores" : "Tutores para empezar"}
          </PanelCardTitle>
          <p className="mt-1 text-[13px] text-[#6b6b6b]">
            {deSuHistorial
              ? "Ordenados por lo que has reservado, visto y estudiado. Vuelve con quien ya conoces."
              : // Se dice el motivo del vacío en vez de dejar creer que el
                // sistema piensa que estos son «los suyos». Al principio este
                // es el caso normal, no la excepción.
                "Todavía no tienes historial con nadie: estos son los mejor valorados de la plataforma."}
          </p>
        </div>
        <Link
          href="/tutors"
          className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-brand hover:underline"
        >
          Ver todos
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>

      <ScrollCarousel
        label={deSuHistorial ? "Tus tutores" : "Tutores destacados"}
        className="mt-4"
      >
        {data.tutores.map(({ tutor, motivo }) => (
          <li
            key={tutor.id}
            // Ancho fijo: es lo que crea el recorrido del carrusel. 224 px es
            // lo que ocupa la variante `inline` de `TutorSummary` sin que el
            // nombre se recorte en los habituales de dos palabras.
            className="w-[224px] shrink-0 snap-start"
          >
            <article className="flex h-full flex-col gap-3 rounded-[12px] border border-[#ebebeb] bg-card p-4">
              <TutorSummary tutor={tutor} variant="inline" />

              {/* La valoración PÚBLICA del tutor, no la del alumno: son cosas
                  distintas y la del alumno ya sale, cuando la hay, en el
                  motivo. Sin reseñas no se pinta «★ —»: un cero decorado es
                  peor señal que ninguna. */}
              {tutor.ratingCount > 0 ? (
                <p className="text-[12.5px] font-medium text-[#4d4d4d]">
                  ★ {tutor.ratingAvg?.toFixed(1) ?? "—"} ·{" "}
                  {tutor.ratingCount === 1
                    ? "1 reseña"
                    : `${tutor.ratingCount} reseñas`}
                </p>
              ) : null}

              {motivo ? (
                <p className="mt-auto rounded-[8px] bg-brand-muted px-2.5 py-1.5 text-[12px] font-medium text-brand">
                  {motivo}
                </p>
              ) : null}
            </article>
          </li>
        ))}
      </ScrollCarousel>
    </PanelCard>
  );
}
