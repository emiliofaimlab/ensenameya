import Link from "next/link";
import { ChevronDownIcon, StarIcon } from "lucide-react";

import type { TutorReview } from "@/lib/catalog/queries";

/**
 * Estrellas llenas/vacías para una puntuación 1–5.
 *
 * G-01 · el amarillo es `#f59e0b` explícito y no `text-amber-500`: Tailwind v4
 * define sus colores en OKLCH y el ámbar 500 ya no es exactamente ese hex, así
 * que las estrellas de la ficha y las de la referencia visual no eran el mismo
 * amarillo. Sobre azul (el hero de las páginas) manda `#ffc531`, que lo pone
 * quien pinta el hero por `className`.
 */
function Stars({
  rating,
  className = "size-4",
}: {
  rating: number;
  className?: string;
}) {
  return (
    <span className="flex gap-0.5" aria-label={`${rating} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          className={
            n <= rating
              ? `${className} fill-current text-[#f59e0b]`
              : `${className} text-muted-foreground/30`
          }
        />
      ))}
    </span>
  );
}

/** "Hace 2 semanas" — el Figma fecha las reseñas en relativo. */
function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Hoy";
  if (days < 7) return `Hace ${days} ${days === 1 ? "día" : "días"}`;
  if (days < 30) {
    const w = Math.round(days / 7);
    return `Hace ${w} ${w === 1 ? "semana" : "semanas"}`;
  }
  const m = Math.round(days / 30);
  if (m < 12) return `Hace ${m} ${m === 1 ? "mes" : "meses"}`;
  const y = Math.round(m / 12);
  return `Hace ${y} ${y === 1 ? "año" : "años"}`;
}

/**
 * Resumen de reseñas de P07: nota grande, estrellas y el histograma por
 * estrellas.
 *
 * §5.5 · `avg` y `count` MANDAN sobre lo que se calcularía con la lista: son
 * los de la tabla (`tutor_profiles.rating_count`, o el `count` exacto de
 * `listProductReviews`) y cubren todas las reseñas, no solo las 50 que se
 * cargan. Sin ellos se sigue calculando con la lista, que es lo que hacía
 * hasta hoy.
 *
 * El HISTOGRAMA, en cambio, se dibuja siempre sobre las reseñas cargadas: no
 * hay recuento por estrella en la BD y repartir `count` a ojo sería inventar
 * barras. Es el supuesto asumido en §8 de la revisión del 10-sep.
 */
export function ReviewsSummary({
  reviews,
  avg,
  count,
}: {
  reviews: TutorReview[];
  avg?: number;
  count?: number;
}) {
  if (reviews.length === 0) return null;

  const nota = avg ?? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
  const total = count ?? reviews.length;
  const buckets = [5, 4, 3, 2, 1].map((n) => ({
    n,
    count: reviews.filter((r) => r.rating === n).length,
  }));

  return (
    <div className="flex flex-wrap items-start gap-12">
      <div>
        <p className="text-[44px] leading-none font-bold text-[#1f1f1f]">
          {nota.toFixed(1)}
        </p>
        <div className="mt-2">
          <Stars rating={Math.round(nota)} />
        </div>
        <p className="mt-1 text-[13px] text-[#666666]">
          {total} {total === 1 ? "reseña" : "reseñas"}
        </p>
      </div>

      <ul className="min-w-[198px] flex-1 space-y-1.5">
        {buckets.map(({ n, count }) => (
          <li key={n} className="flex items-center gap-2.5">
            <span className="w-2 text-xs text-[#666666]">{n}</span>
            <span
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e6e6e6]"
              role="img"
              aria-label={`${count} de ${reviews.length} con ${n} estrellas`}
            >
              <span
                className="block h-full rounded-full bg-[#4d4d4d]"
                style={{ width: `${(count / reviews.length) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Una reseña: autor (enmascarado), fecha, estrellas, contexto y comentario. */
function ReviewItem({
  review: r,
  withContext,
}: {
  review: TutorReview;
  /** §5.4 · la línea con el título de la mentoría reseñada. */
  withContext: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 py-5 first:pt-0">
      <div className="flex items-center gap-2.5">
        {/* El nombre sale de la copia enmascarada que el alumno consintió
            publicar; `profiles` sigue cerrado (decisión 18). */}
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-[#666666]">
          {r.author ? r.author.slice(0, 1) : null}
        </span>
        <div>
          <p className="text-sm font-bold text-[#242424]">
            {r.author ?? "Alumno"}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-[#666666]">
            {/* UTC → hora local del que mira (RN-02). */}
            <time dateTime={r.createdAt}>{relativeDate(r.createdAt)}</time>·
            <Stars rating={r.rating} className="size-3" />
          </p>
        </div>
      </div>

      {/* §5.4 · de QUÉ mentoría habla la reseña. El azul es `#0b4f96` y no el
          `brand`: a 12px sobre blanco el #0080ff se queda en 3:1 de contraste
          y esto es texto, no un botón (WCAG AA pide 4.5:1). */}
      {withContext && r.productTitle && r.productId ? (
        <Link
          href={`/products/${r.productId}`}
          className="-mt-1 text-xs font-medium text-[#0b4f96] hover:underline"
        >
          {r.productTitle}
        </Link>
      ) : null}

      {r.comment ? (
        <p className="text-sm text-pretty text-[#525252]">{r.comment}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Sin comentario.</p>
      )}
    </li>
  );
}

/**
 * US-902 — reseñas del perfil del tutor. Firmadas solo con consentimiento
 * (decisión 18); el resto salen como "Alumno".
 *
 * §5.5 · se pintan `visible` reseñas y el resto van dentro de un `<details>`
 * nativo, el mismo patrón sin JS que ya usan las FAQ: esto es un Server
 * Component y un "Ver más" con estado obligaría a marcarlo `"use client"` para
 * un botón que el navegador ya sabe hacer solo.
 *
 * ⚠️ El número del rótulo llega por `moreLabel` porque sale de `rating_count`,
 * no de la lista cargada (que se corta en 50): calcularlo aquí enseñaría
 * "Ver las 50 reseñas" a un tutor con 120.
 */
export function TutorReviews({
  reviews,
  visible,
  moreLabel,
  withContext = false,
}: {
  reviews: TutorReview[];
  /** 3 en el perfil del tutor, 2 en la ficha de mentoría. Sin valor, todas. */
  visible?: number;
  /** Rótulo del desplegable; por defecto, las reseñas cargadas. */
  moreLabel?: string;
  /**
   * §5.4 · ¿cada reseña dice de qué mentoría es? Lo decide QUIEN LLAMA, no los
   * datos:
   *
   *  · perfil del tutor → `true` (§1.4 la pide siempre, tenga el tutor una
   *    mentoría o cinco);
   *  · reseñas DE una mentoría → `false`: todas son de la misma y repetir su
   *    título bajo cada autor, enlazando a la página en la que ya estás, no
   *    dice nada;
   *  · en la mentoría SIN reseñas propias, que cae a las del tutor con el
   *    rótulo «Reseñas del tutor» → `true`: ahí sí son de mentorías distintas.
   *
   * Deducirlo de `new Set(productId).size > 1` parecía equivalente y no lo es:
   * apagaría la línea en el perfil de un tutor con una sola mentoría, que es
   * justo un caso que §1.4 no exceptúa.
   */
  withContext?: boolean;
}) {
  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este tutor aún no tiene reseñas.
      </p>
    );
  }

  const alaVista = visible === undefined ? reviews : reviews.slice(0, visible);
  const resto = visible === undefined ? [] : reviews.slice(visible);

  return (
    <>
      <ul className="divide-y divide-[#ebebeb]">
        {alaVista.map((r) => (
          <ReviewItem key={r.id} review={r} withContext={withContext} />
        ))}
      </ul>

      {resto.length > 0 ? (
        <details className="group">
          <summary className="mt-4 inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d6d6d6] px-4 text-[13.5px] font-semibold text-[#333333] marker:hidden hover:bg-muted">
            <span className="group-open:hidden">
              {moreLabel ??
                `Ver las ${reviews.length} ${reviews.length === 1 ? "reseña" : "reseñas"}`}
            </span>
            <span className="hidden group-open:inline">Ver menos</span>
            <ChevronDownIcon
              className="size-4 shrink-0 text-brand transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          {/* `pt-5` en la lista y no en el ítem: `ReviewItem` lleva `first:pt-0`
              para no despegar la primera reseña de su título, y aquí la primera
              cuelga del botón, así que necesita ese aire de vuelta. */}
          <ul className="divide-y divide-[#ebebeb] border-t border-[#ebebeb] pt-5">
            {resto.map((r) => (
              <ReviewItem key={r.id} review={r} withContext={withContext} />
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
