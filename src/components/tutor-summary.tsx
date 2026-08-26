import Image from "next/image";
import Link from "next/link";
import { BadgeCheckIcon, MessageSquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import type { TutorCardData } from "@/lib/booking";

/**
 * V-6 · Quién te va a dar la clase, en las pantallas del alumno.
 *
 * La queja del cliente era literal: **tras reservar no hay forma de llegar al
 * tutor.** Su ficha pública existe y está enlazada por todo el catálogo, pero en
 * cuanto se compra —panel, lista, detalle, pago— el tutor se quedaba en un «con
 * Fulanito» de 12px sin enlace. Esto es esa vuelta.
 *
 * NO es `catalog/tutor-card.tsx`, y la diferencia importa: aquella pinta un
 * RESULTADO DE BÚSQUEDA (categorías, «desde X US$», CTA de conversión) y pide un
 * `FeaturedTutor`, que sale de la vista `tutors_public` con su join de precios.
 * Aquí el alumno ya compró: el precio no pinta nada, y lo que necesita es
 * reconocerle, ver su ficha y escribirle. Reutilizar aquella habría sido
 * arrastrar una consulta de catálogo a cinco pantallas que no la necesitan.
 *
 * ⚠️ **`tutor` PUEDE SER `undefined`, Y ESE ES EL CASO QUE HAY QUE MIRAR.**
 * `tutor_profiles` solo es legible con `approval_status = 'approved'`: si a un
 * tutor le retiran la aprobación, el alumno deja de poder leer su fila. Sin
 * tratarlo, esta ficha enlazaría a `/tutors/<id>` y su propio panel le daría un
 * **404 por una mentoría que pagó**. Con `undefined` se pinta la ficha sin
 * enlace, se dice lo que pasa, y —esto es lo importante— **el chat se queda**:
 * la conversación va por reserva y participante, no por la aprobación del tutor,
 * así que quien pagó sigue teniendo por dónde reclamar. Ver `tutorCards`.
 */
export function TutorSummary({
  tutor,
  chatHref,
  perfilHref,
  variant = "card",
}: {
  /** `undefined` = no legible: al tutor le retiraron la aprobación. */
  tutor?: TutorCardData;
  /** Hilo con el tutor. Acepta el id de la reserva: ver `/chat/[threadId]`. */
  chatHref?: string;
  /** Se calcula solo; solo se pasa para forzar otro destino. */
  perfilHref?: string;
  /** `inline` para el checkout y el pago, donde una ficha entera estorba. */
  variant?: "card" | "inline";
}) {
  const nombre = tutor?.displayName ?? tutor?.headline ?? null;
  const avatar = storageUrl("avatars", tutor?.avatarPath);
  const href = tutor ? (perfilHref ?? `/tutors/${tutor.id}`) : null;

  const retrato = (
    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold">
      {avatar ? (
        <Image
          src={avatar}
          alt=""
          width={44}
          height={44}
          className="size-11 object-cover"
          unoptimized
        />
      ) : (
        // Sin nombre no hay iniciales que sacar: el guion es más honesto que
        // una letra inventada.
        (nombre ? initialsFrom(nombre) : "—")
      )}
    </span>
  );

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-3">
        {retrato}
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold">
            {nombre ?? "Tutor no disponible"}
          </p>
          {href ? (
            <Link
              href={href}
              className="text-xs font-medium text-brand hover:underline"
            >
              Ver perfil
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">
              Su perfil ya no está publicado
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-sm font-semibold text-muted-foreground">Tu tutor</h2>

      <div className="mt-3 flex items-start gap-3">
        {retrato}
        <div className="min-w-0">
          <p className="truncate font-bold">{nombre ?? "Tutor no disponible"}</p>
          {tutor ? (
            <>
              <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                <BadgeCheckIcon className="size-3 text-brand" />
                Tutor verificado
              </p>
              {tutor.ratingCount > 0 ? (
                <p className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">
                  ★ {tutor.ratingAvg?.toFixed(1) ?? "—"} ·{" "}
                  {tutor.ratingCount === 1
                    ? "1 reseña"
                    : `${tutor.ratingCount} reseñas`}
                </p>
              ) : null}
            </>
          ) : (
            /* Se dice lo que pasa y lo que NO pasa. Quien lee esto ya pagó: la
               duda inmediata es si su clase sigue en pie, y la respuesta es que
               sí — lo que se ha retirado es la ficha pública, no la reserva. */
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Su perfil público ya no está disponible. Tu reserva y este chat no
              cambian.
            </p>
          )}
        </div>
      </div>

      {tutor?.headline ? (
        <p className="mt-3 line-clamp-2 text-[13px] text-muted-foreground">
          {tutor.headline}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {href ? (
          <Button asChild variant="outline" size="sm">
            <Link href={href}>Ver perfil</Link>
          </Button>
        ) : null}
        {chatHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={chatHref}>
              <MessageSquareIcon className="size-4" />
              Escribirle
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
