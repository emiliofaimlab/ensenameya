import { AwardIcon, BadgeCheckIcon, CheckIcon } from "lucide-react";

/**
 * EY-231 · las insignias del tutor (`tutor_profiles.badges`), que asigna el
 * admin y que un tutor puede tener a la vez. Fundador va en negro y Verificado
 * en el naranja de siempre (lo pidió el cliente). El orden es fijo: Fundador
 * primero.
 *
 * `undefined` (la consulta no bajó la columna) = la de siempre, «verificado»:
 * así un listado que todavía no la pide no pierde la insignia que ya tenía.
 */
export const BADGES = {
  fundador: {
    label: "Tutor fundador",
    title: "De los primeros 100 tutores aprobados en Enséñame Ya",
    bg: "bg-[#19191f]",
    fg: "text-[#19191f]",
    Icon: AwardIcon,
  },
  verificado: {
    label: "Tutor verificado",
    title: "Identidad y titulación revisadas por Enséñame Ya",
    bg: "bg-primary",
    fg: "text-brand",
    Icon: BadgeCheckIcon,
  },
} as const;

export type BadgeKey = keyof typeof BADGES;
export const BADGE_KEYS = Object.keys(BADGES) as BadgeKey[];

export function badgesOf(badges: readonly string[] | null | undefined): BadgeKey[] {
  const set = new Set(badges ?? ["verificado"]);
  return BADGE_KEYS.filter((k) => set.has(k));
}

/**
 * - `line`: icono + texto pequeño (tarjeta de listado).
 * - `pill`: círculo con check en móvil y píldora con texto desde lg (perfil).
 * - `check`: solo el círculo, con la etiqueta en `aria-label` (detalle de mentoría).
 */
export function TutorBadges({
  badges,
  variant,
  className = "",
  verifiedTitle,
}: {
  badges: readonly string[] | null | undefined;
  variant: "line" | "pill" | "check";
  className?: string;
  /** El perfil le añade la fecha de aprobación al tooltip de Verificado. */
  verifiedTitle?: string;
}) {
  const keys = badgesOf(badges);
  if (keys.length === 0) return null;

  return keys.map((k) => {
    const b = BADGES[k];
    const title = k === "verificado" && verifiedTitle ? verifiedTitle : b.title;

    if (variant === "line") {
      return (
        <span key={k} title={title} className={`flex items-center gap-1 ${className}`}>
          <b.Icon className={`size-3 ${b.fg}`} aria-hidden />
          {b.label}
        </span>
      );
    }

    if (variant === "check") {
      return (
        <span
          key={k}
          role="img"
          title={title}
          aria-label={b.label}
          className={`grid size-[22px] shrink-0 place-items-center rounded-full text-white ${b.bg} ${className}`}
        >
          {k === "verificado" ? (
            <CheckIcon className="size-3" strokeWidth={3.2} />
          ) : (
            <b.Icon className="size-3" strokeWidth={2.6} />
          )}
        </span>
      );
    }

    return (
      <span
        key={k}
        title={title}
        className={`inline-grid size-[22px] shrink-0 place-items-center rounded-full text-white lg:inline-flex lg:size-auto lg:h-[26px] lg:gap-1.5 lg:px-2.5 lg:text-xs lg:font-semibold ${b.bg} ${className}`}
      >
        {k === "verificado" ? (
          <CheckIcon className="size-3 lg:hidden" aria-hidden />
        ) : (
          <b.Icon className="size-3 lg:hidden" aria-hidden />
        )}
        <b.Icon className="size-3.5 max-lg:hidden" aria-hidden />
        <span className="max-lg:sr-only">{b.label}</span>
      </span>
    );
  });
}
