import Link from "next/link";

import type { CategoryTag } from "@/lib/catalog/queries";
import { SESION_INDIVIDUAL } from "@/lib/booking";

export type ProductFilterState = {
  cat?: string;
  model?: string;
  price?: string;
  sessions?: string;
  /** DD-03 — nivel e idioma DE LA MENTORÍA. */
  level?: string;
  lang?: string;
};

/** Rangos en unidades menores (céntimos), como `products.price_amount`. */
export const PRICE_RANGES = [
  { id: "lt50", label: "Menos de $50", max: 5000 },
  { id: "50-120", label: "$50 – $120", min: 5000, max: 12000 },
  { id: "120-250", label: "$120 – $250", min: 12000, max: 25000 },
  { id: "gt250", label: "Más de $250", min: 25000 },
];

export const SESSION_RANGES = [
  { id: "1-3", label: "1 – 3 sesiones", min: 1, max: 3 },
  { id: "4-8", label: "4 – 8 sesiones", min: 4, max: 8 },
  { id: "9+", label: "9 o más", min: 9 },
];

export const MODELS = [
  { id: "per_package", label: "Paquete" },
  { id: "per_session", label: SESION_INDIVIDUAL },
  { id: "per_hour", label: "Por hora" },
];

/** DD-03 · etiquetas del Figma (386:1196). El valor es el de la columna. */
export const LEVELS = [
  { id: "basico", label: "Básico" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

export const LANGUAGES = [
  { id: "es", label: "Español" },
  { id: "en", label: "Inglés" },
  { id: "pt", label: "Portugués" },
];

/**
 * Filtros de P05. Todo va por URL (sin JS) y todo se filtra en la BD: precio,
 * sesiones, nivel e idioma son columnas de `products`.
 *
 * Nivel e idioma son los de LA MENTORÍA (DD-03), no los del tutor: un tutor de
 * nivel avanzado (`tutor_profiles.teaching_level`, IV-02) puede publicar una
 * clase básica.
 */
export function ProductFilters({
  categories,
  active,
  hrefFor,
}: {
  categories: CategoryTag[];
  active: ProductFilterState;
  hrefFor: (next: ProductFilterState) => string;
}) {
  const groups = [
    {
      title: "Categoría",
      key: "cat" as const,
      options: categories.map((c) => ({ id: c.slug, label: c.name })),
    },
    { title: "Tipo de mentoría", key: "model" as const, options: MODELS },
    { title: "Nivel", key: "level" as const, options: LEVELS },
    { title: "Idioma", key: "lang" as const, options: LANGUAGES },
    { title: "Precio", key: "price" as const, options: PRICE_RANGES },
    { title: "Duración", key: "sessions" as const, options: SESSION_RANGES },
  ];

  const anyActive = Object.values(active).some(Boolean);

  return (
    <aside className="h-fit rounded-[16px] border border-[#dbdbdb] bg-card p-[22px] lg:sticky lg:top-24">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold">Filtros</h2>
        {anyActive ? (
          <Link
            href={hrefFor({})}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Limpiar
          </Link>
        ) : null}
      </div>

      {groups.map((g) => (
        <div key={g.key}>
          <p className="mt-5 text-sm font-bold text-[#242424]">{g.title}</p>
          <ul className="mt-2 space-y-1.5">
            {g.options.map((o) => {
              const on = active[g.key] === o.id;
              return (
                <li key={o.id}>
                  <Link
                    href={hrefFor({ ...active, [g.key]: on ? undefined : o.id })}
                    aria-current={on ? "true" : undefined}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <span
                      className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border text-[11px] ${
                        on ? "border-brand bg-brand text-white" : "bg-card"
                      }`}
                    >
                      {on ? "✓" : null}
                    </span>
                    {o.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}
