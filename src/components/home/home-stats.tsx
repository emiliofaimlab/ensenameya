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
 * Banda de cifras de P01. El Figma escribe "+1.200 tutores · 25k+ clases ·
 * 4.9★ · 30+ países": números de maqueta. Aquí salen de `home_stats()`, así que
 * son los reales de la plataforma. Los países se derivan de la zona horaria del
 * tutor (ver la migración `home_stats_paises`) porque el país de cobro sigue
 * pendiente de C-13. Si el cliente quiere cifras de marketing, entran como
 * configuración, no como código (regla de oro 8).
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
    { icon: UsersIcon, value: compactCount(stats.tutors), label: "Tutores verificados" },
    {
      icon: MonitorPlayIcon,
      value: compactCount(stats.sessions),
      label: "Clases impartidas",
    },
    {
      icon: StarIcon,
      value: stats.ratingAvg === null ? "—" : `${stats.ratingAvg}★`,
      label: "Valoración media",
    },
    { icon: MapPinIcon, value: compactCount(stats.countries), label: "Países" },
  ];

  return (
    <Container
      className={overlap ? "relative z-10 -mt-[99px] mb-14" : "mb-14"}
    >
      <ul className="grid h-[199px] content-center gap-8 rounded-[20px] border border-[#ebebeb] bg-card px-8 shadow-[0_16px_36px_-8px_rgb(0_0_0/0.14)] max-lg:h-auto max-lg:py-10 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-[#ebebeb]">
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
