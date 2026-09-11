import Link from "next/link";
import { dosCifras } from "@/lib/dinero";

import type { CategoryTag } from "@/lib/catalog/queries";
import { SESION_INDIVIDUAL } from "@/lib/booking";
import { cn } from "@/lib/utils";

export type ProductFilterState = {
  cat?: string;
  model?: string;
  price?: string;
  sessions?: string;
  /** DD-03 — nivel e idioma DE LA MENTORÍA. */
  level?: string;
  lang?: string;
};

/**
 * Rangos en unidades menores (céntimos), como `products.price_amount`.
 *
 * `label` es la etiqueta EN DÓLARES y es el respaldo: la que se lee de verdad
 * la monta `etiquetaDeTramo()` con la moneda del visitante. El filtro sigue
 * operando en USD por debajo (`?price=lt50` y las columnas de `products` no se
 * tocan): lo único que cambia es lo que se LEE.
 *
 * ⚠️ Y SE CONVIERTEN, aunque un tramo sea una consulta y no una oferta
 * (11-sep-2026). El motivo no es purismo: si las tarjetas dicen «≈ 47.000 CLP»
 * y el filtro de al lado dice «Menos de $50», el visitante no tiene forma de
 * saber si ese $50 es su moneda o la nuestra, y el filtro deja de ser usable —
 * que es justo la queja que abrió este lote.
 */
export const PRICE_RANGES = [
  { id: "lt50", label: "Menos de $50", max: 5000 },
  { id: "50-120", label: "$50 – $120", min: 5000, max: 12000 },
  { id: "120-250", label: "$120 – $250", min: 12000, max: 25000 },
  { id: "gt250", label: "Más de $250", min: 25000 },
];

/**
 * «Menos de ≈ 47.000 CLP» — el mismo tramo, en la moneda de quien mira.
 *
 * El «≈» se queda aunque sea un filtro: el límite REAL es el de dólares, y el
 * número convertido puede quedar a una unidad de una tarjeta que sí entra en el
 * tramo. Sin el «≈» eso se lee como un fallo del filtro en vez de como lo que
 * es, un redondeo.
 */
export function etiquetaDeTramo(
  tramo: { label: string; min?: number; max?: number },
  fx?: { moneda: string; tasa: number } | null,
): string {
  if (!fx) return tramo.label;
  const conv = (minor: number) => dosCifras(minor, "USD", fx).local;
  const desde = tramo.min === undefined ? null : conv(tramo.min);
  const hasta = tramo.max === undefined ? null : conv(tramo.max);
  // Si la conversión no está disponible para alguno de los dos límites, manda
  // el dólar entero: media etiqueta convertida sería ilegible.
  if (tramo.min !== undefined && !desde) return tramo.label;
  if (tramo.max !== undefined && !hasta) return tramo.label;
  if (desde && hasta) return `${desde} – ${hasta}`;
  if (hasta) return `Menos de ${hasta}`;
  return `Más de ${desde}`;
}

/** `PRICE_RANGES` con las etiquetas ya en la moneda del visitante. */
export function tramosDePrecio(fx?: { moneda: string; tasa: number } | null) {
  return PRICE_RANGES.map((r) => ({ ...r, label: etiquetaDeTramo(r, fx) }));
}

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
 * Los seis grupos del panel, en el orden del Figma. Viven fuera del componente
 * porque los pintan DOS superficies: este panel lateral desde `lg` y las
 * píldoras desplegables de `FilterPills` por debajo (Verónica, 3-sep-2026).
 * Una sola lista = un solo sitio donde añadir un filtro mañana.
 */
export function productFilterGroups(
  categories: CategoryTag[],
  /**
   * La moneda del visitante, de `monedaDelVisitante()`. Va como ARGUMENTO y no
   * se pide aquí dentro para que esta función siga siendo SÍNCRONA: volverla
   * `async` obligaría a awaitarla en las tres superficies que la consumen y a
   * arrastrar el `await` hasta dentro de un `.map()` de JSX. Omitirla deja las
   * etiquetas en dólares, que es el respaldo correcto.
   */
  fx?: { moneda: string; tasa: number } | null,
): {
  title: string;
  key: keyof ProductFilterState;
  options: { id: string; label: string }[];
}[] {
  return [
    {
      title: "Categoría",
      key: "cat",
      options: categories.map((c) => ({ id: c.slug, label: c.name })),
    },
    { title: "Tipo de mentoría", key: "model", options: MODELS },
    { title: "Nivel", key: "level", options: LEVELS },
    { title: "Idioma", key: "lang", options: LANGUAGES },
    { title: "Precio", key: "price", options: tramosDePrecio(fx) },
    { title: "Duración", key: "sessions", options: SESSION_RANGES },
  ];
}

/**
 * Filtros de P05. Todo va por URL (sin JS) y todo se filtra en la BD: precio,
 * sesiones, nivel e idioma son columnas de `products`.
 *
 * Nivel e idioma son los de LA MENTORÍA (DD-03), no los del tutor: un tutor de
 * nivel avanzado (`tutor_profiles.teaching_level`, IV-02) puede publicar una
 * clase básica.
 *
 * `className`: la página lo esconde por debajo de `lg` (`hidden lg:block`) y
 * monta en su lugar las píldoras de `FilterPills` — a 390 px las 22 casillas
 * ocupaban más de una pantalla antes de la primera mentoría (correo de
 * Verónica, 3-sep-2026, IMG_4116). Desde 1024 no cambia nada (R1).
 */
export function ProductFilters({
  categories,
  active,
  hrefFor,
  className,
  fx,
}: {
  categories: CategoryTag[];
  active: ProductFilterState;
  hrefFor: (next: ProductFilterState) => string;
  className?: string;
  /**
   * La moneda del visitante, para los tramos de precio. Llega por PROP y no se
   * pide aquí: este módulo exporta también `LEVELS` y `PRICE_RANGES`, que los
   * importa media docena de ficheros, y meterle un import `server-only` los
   * envenenaría a todos el día que alguno sea de cliente.
   */
  fx?: { moneda: string; tasa: number } | null;
}) {
  const groups = productFilterGroups(categories, fx);

  const anyActive = Object.values(active).some(Boolean);

  return (
    <aside
      className={cn(
        "h-fit rounded-[16px] border border-[#dbdbdb] bg-card p-[22px] lg:sticky lg:top-24",
        className,
      )}
    >
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
