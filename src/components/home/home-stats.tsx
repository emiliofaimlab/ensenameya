import {
  MapPinIcon,
  MonitorPlayIcon,
  StarIcon,
  UsersIcon,
} from "lucide-react";

import { Container } from "@/components/layout/container";
import { compactCount } from "@/lib/catalog/format";
import type { HomeStats as HomeStatsData } from "@/lib/catalog/queries";

/**
 * RV-15 · por debajo de esto, la cifra no se pinta.
 *
 * El día del lanzamiento la portada publicaba "24 clases impartidas": un dato
 * verdadero que RESTA — dice en voz alta que aquí todavía no ha pasado nada.
 * Callar no es mentir; la banda enseña las cifras que ya sostienen la promesa
 * y el resto entra solo cuando llega. No se toca el dato, solo si se enseña.
 *
 * Los mínimos son de presentación, no de negocio: si el cliente los quiere
 * otros, se cambian aquí (y si algún día quiere cifras de marketing, entran
 * como configuración, no como código — regla de oro 8).
 */
const MINIMO_PARA_ENSENAR = {
  /** El inventario: con uno ya hay a quién reservar, y es lo que se promete. */
  tutores: 1,
  /** Tracción. Dos dígitos no impresionan a nadie; se espera a tres. */
  clases: 100,
  /** "1 país" no es un dato de alcance, es una confesión. */
  paises: 2,
} as const;

/** Nº de columnas de la banda según cuántas cifras sobrevivan al umbral. Van
 *  literales porque Tailwind compila las clases que encuentra escritas. */
const COLUMNAS: Record<number, string> = {
  1: "",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * Banda de cifras de P01. El Figma escribe "+1.200 tutores · 25k+ clases ·
 * 4.9★ · 30+ países": números de maqueta. Aquí salen de `home_stats()`, así que
 * son los reales de la plataforma. Los países se derivan de la zona horaria del
 * tutor (ver la migración `home_stats_paises`) porque el país de cobro sigue
 * pendiente de C-13. Si el cliente quiere cifras de marketing, entran como
 * configuración, no como código (regla de oro 8).
 *
 * Lo que no llega al umbral de `MINIMO_PARA_ENSENAR` no se pinta (RV-15).
 */
export function HomeStats({
  stats,
  overlap = false,
}: {
  stats: HomeStatsData | null;
  /** En el Figma la tarjeta cabalga el borde de "Tutorías destacadas": justo
   *  media tarjeta (99 de 199px) queda sobre el gris. Sin esa sección delante
   *  no hay borde que cabalgar, así que el tirón se pide desde fuera. */
  overlap?: boolean;
}) {
  if (!stats) return null;

  const items = [
    {
      icon: UsersIcon,
      value: compactCount(stats.tutors),
      label: "Tutores verificados",
      show: stats.tutors >= MINIMO_PARA_ENSENAR.tutores,
    },
    {
      icon: MonitorPlayIcon,
      value: compactCount(stats.sessions),
      label: "Mentorías impartidas",
      show: stats.sessions >= MINIMO_PARA_ENSENAR.clases,
    },
    {
      icon: StarIcon,
      value: `${stats.ratingAvg}★`,
      label: "Valoración media",
      // El "—" de antes ocupaba una columna entera para decir que no hay dato.
      show: stats.ratingAvg !== null,
    },
    {
      icon: MapPinIcon,
      value: compactCount(stats.countries),
      label: "Países",
      show: stats.countries >= MINIMO_PARA_ENSENAR.paises,
    },
  ].filter((i) => i.show);

  // Ojo: aquí NO se devuelve `null` por quedarse en una sola cifra, por
  // tentador que sea. "Tutorías destacadas" reserva 164px de hueco para que
  // esta tarjeta lo cabalgue (ver FeaturedProducts), y si desaparece el hueco
  // se queda abierto. Con productos publicados siempre hay ≥1 tutor aprobado,
  // así que siempre queda al menos una cifra que enseñar.
  if (items.length === 0) return null;

  return (
    <Container
      className={overlap ? "relative z-10 -mt-[99px] mb-14" : "mb-14"}
    >
      <ul
        className={`grid h-[199px] content-center gap-8 rounded-[20px] border border-[#ebebeb] bg-card px-8 shadow-[0_16px_36px_-8px_rgb(0_0_0/0.14)] max-lg:h-auto max-lg:py-10 lg:divide-x lg:divide-[#ebebeb] ${COLUMNAS[items.length]}`}
      >
        {items.map(({ icon: Icon, value, label }) => (
          <li key={label} className="lg:px-5">
            <div className="flex items-center gap-3">
              <Icon className="size-7 shrink-0 text-primary" strokeWidth={2.4} />
              <span className="text-[38px] leading-none font-bold text-brand">
                {value}
              </span>
            </div>
            <p className="mt-2 text-xl">{label}</p>
          </li>
        ))}
      </ul>
    </Container>
  );
}
