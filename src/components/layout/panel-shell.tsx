import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { AppSidebar, type SidebarItem } from "@/components/layout/app-sidebar";

/**
 * Armazón del área con sesión (AL02…AL08, y el mismo en TU/AD). El Figma lo
 * repite en las siete pantallas del alumno: fondo `#f9fafc`, 40 px de aire
 * lateral (contenido de 1200), menú de 232 y 24 de separación.
 *
 * `Container` no sirve aquí: las públicas usan 64 px de aire (contenido 1152).
 */
export type PanelShellProps = {
  items?: SidebarItem[];
  /** "← Volver al panel" del Figma, encima de la rejilla (159:17). */
  back?: { href: string; label: string };
  /** Cabecera de pantalla: antetítulo + título 24/700 + subtítulo + acción a
   *  la derecha (191:39, 214:45). Sin `title` no se pinta nada. */
  title?: React.ReactNode;
  /** "Reservas / Detalle" (214:45): miga de pan sobre el título. */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export function PanelShell({
  items,
  back,
  title,
  eyebrow,
  description,
  actions,
  children,
}: PanelShellProps) {
  return (
    <div className="flex-1 bg-muted py-8">
      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-10">
        {back ? (
          <Link
            href={back.href}
            className="mb-4 flex w-fit items-center gap-1.5 text-sm text-[#6b6b6b] transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-4" />
            {back.label}
          </Link>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[232px_1fr]">
          <AppSidebar items={items} />
          {/* ⚠️ `min-w-0` NO es decoración, y quitarlo rompe la página entera.
              Un hijo de grid nace con `min-width: auto`, o sea que se niega a
              encogerse por debajo del ancho INTRÍNSECO de su contenido. En
              cuanto esta columna contiene algo naturalmente ancho —un carrusel
              con scroll propio, una tabla, un bloque de código— la columna
              crece en vez de dejar que ese hijo haga su scroll, y la barra
              horizontal aparece en el DOCUMENTO: el panel entero se ve estirado
              y desplazado.
              Pasó el 26-ago al añadir el carrusel de tutores del alumno
              (EY-186). Se arregla aquí y no en el carrusel porque el problema es
              de la COLUMNA: cualquier contenido ancho que se añada mañana lo
              reproduciría igual. */}
          <div className="flex min-w-0 flex-col gap-5">
            {title ? (
              <div className="flex flex-wrap items-start gap-3">
                <div>
                  {eyebrow ? (
                    <p className="text-xs text-[#6b6b6b]">{eyebrow}</p>
                  ) : null}
                  <h1
                    className={cn(
                      "text-[24px] font-bold tracking-tight text-[#19191f]",
                      eyebrow && "mt-1",
                    )}
                  >
                    {title}
                  </h1>
                  {description ? (
                    <p className="mt-1 text-[13px] text-[#6b6b6b]">
                      {description}
                    </p>
                  ) : null}
                </div>
                {actions ? <div className="ml-auto">{actions}</div> : null}
              </div>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Tarjeta del panel: r16, borde `#e0e0e0` y 20 de padding en todo el Figma. */
export function PanelCard({
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-[16px] border border-[#e0e0e0] bg-card p-5",
        className,
      )}
      {...props}
    />
  );
}

/** Título de tarjeta (157:3 · 22/700; 160:4 · 18/700 en las secundarias). */
export function PanelCardTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-[18px] font-bold text-[#19191f]", className)}
      {...props}
    />
  );
}

/**
 * Píldora de estado del Figma. La gris (157:11) es la del panel del alumno;
 * el panel del tutor colorea por estado (190:23, 191:60, 196:34…): verde
 * aprobado/activo, azul en revisión, ámbar pausado, rojo rechazado.
 *
 * ⚠️ N-15 · LA ALTURA LA DECIDE ESTE COMPONENTE, no quien lo llama.
 *
 * Hasta el 17-ago dieciocho llamadas la pisaban con `h-7` (28 px) mientras el
 * componente declaraba 26, así que las mismas etiquetas salían de dos tamaños
 * según la pantalla — y en una tarjeta con varias juntas se notaba. Como `cn()`
 * fusiona con tailwind-merge, la clase del llamador GANA siempre: el descuadre
 * no se veía en el componente, se veía en producción.
 *
 * Si hace falta otro tamaño, se añade una variante aquí. Pasarle una clase de
 * altura por `className` vuelve a romper la consistencia en silencio.
 */
const PILL_TONE = {
  gray: "bg-[#f0f0f0] text-[#595959]",
  green: "bg-[#d9f0de] font-semibold text-[#298c52]",
  blue: "bg-[#dbedff] font-semibold text-brand",
  amber: "bg-[#faedcc] font-semibold text-[#a67314]",
  red: "bg-[#f7dede] font-semibold text-[#bf3333]",
  neutral: "bg-[#ebebeb] font-semibold text-[#6b6b6b]",
} as const;

export type PillTone = keyof typeof PILL_TONE;

export function StatusPill({
  tone = "gray",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center rounded-full px-2.5 text-xs font-medium",
        PILL_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Fila `etiqueta … valor` de los resúmenes de pago (160:42, 174:62). */
export function PanelRow({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-[#6b6b6b]">{label}</dt>
      <dd className="text-[13px] font-medium text-[#333333]">{value}</dd>
    </div>
  );
}
