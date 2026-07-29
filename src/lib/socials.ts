/**
 * R29-02 — redes y portafolio del tutor, en UN solo sitio (el módulo de
 * verificación). Antes se pedían en dos pasos distintos del onboarding y como
 * documento suelto; ahora viven todos en `tutor_profiles.socials`.
 *
 * ponytail: `socials` ya era `jsonb` con sus grants, así que la lista cabe sin
 * migración. Lo que sí hace falta es leer la forma VIEJA — `{instagram, linkedin}`
 * de los perfiles ya creados — sin romperlos ni migrarlos a mano.
 */

/** Plataformas del selector. "portfolio"/"other" es lo que abre la puerta a
 *  cualquier enlace externo (webs propias, Behance, Notion, un PDF…). */
export const SOCIAL_PLATFORMS = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "x", label: "X (Twitter)" },
  { id: "facebook", label: "Facebook" },
  { id: "portfolio", label: "Sitio web / Portafolio" },
  { id: "other", label: "Otro" },
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]["id"];

export type SocialLink = { platform: string; url: string };

/** Máximo acordado con el cliente (29-jul): 1 obligatoria + 4 opcionales. */
export const MAX_SOCIALS = 5;

export function socialLabel(platform: string): string {
  return (
    SOCIAL_PLATFORMS.find((p) => p.id === platform)?.label ?? "Enlace"
  );
}

/**
 * Lee `tutor_profiles.socials` en cualquiera de sus dos formas:
 *   · nueva  → `[{ platform, url }]`
 *   · vieja  → `{ instagram: "…", linkedin: "…" }` (clave = plataforma)
 * Descarta entradas sin URL para que un `{instagram: ""}` no pinte una fila vacía.
 */
export function parseSocials(value: unknown): SocialLink[] {
  if (Array.isArray(value)) {
    return value.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const { platform, url } = row as Record<string, unknown>;
      if (typeof url !== "string" || !url.trim()) return [];
      return [
        {
          platform: typeof platform === "string" && platform ? platform : "other",
          url: url.trim(),
        },
      ];
    });
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([platform, url]) =>
        typeof url === "string" && url.trim()
          ? [{ platform, url: url.trim() }]
          : [],
    );
  }
  return [];
}
