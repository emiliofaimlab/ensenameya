import { ClockIcon } from "lucide-react";

import { cn } from "@/lib/utils";
/* ─────────────────────────────────────────────────────────────────────────────
   PIEZAS COMPARTIDAS DEL PANEL DEL TUTOR · paquete «v2» aprobado el 8-sep-2026

   Las cuatro reglas globales del documento (G-02 a G-05) se resuelven aquí y
   NO en cada pantalla: el encargo lo pide explícitamente («hazlos componentes
   reutilizables, no copias por pantalla»), y son justo el tipo de detalle
   —tamaños de círculo, colores de un estado, un tooltip— que diverge en cuanto
   vive en siete sitios.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * G-02 · Contador del menú lateral, y G-03 · contador de los chips de filtro.
 *
 * ⚠️ Los dígitos van centrados con `leading-none` + `text-center` y NO con
 * `place-items-center`: Poppins tiene la mayoría de su altura por encima de la
 * línea base, así que centrando la CAJA el número queda visiblemente bajo
 * dentro del círculo. Lo dice el propio documento aprobado, y se nota a 11 px.
 *
 * Tonos, por orden de atención:
 *   · `naranja` — categoría del menú y «Por aceptar»: lo único que pide acción.
 *   · `gris`    — subnivel del menú y resto de chips: informa, no reclama.
 *   · `activo`  — dentro de un chip seleccionado (fondo azul): blanco translúcido.
 */
const CONTADOR_TONO = {
  naranja: "bg-primary text-white",
  gris: "bg-[#ebebeb] text-[#6b6b6b]",
  suave: "bg-[#e6edf5] text-[#4d4d4d]",
  activo: "bg-white/28 text-white",
} as const;

export function PanelCounter({
  value,
  tone = "gris",
  size = 20,
  className,
}: {
  value: number;
  tone?: keyof typeof CONTADOR_TONO;
  /** 20 px para categorías y chips; 18 para los subniveles del menú. */
  size?: 18 | 20;
  className?: string;
}) {
  // Cero no pinta contador: la misma regla que el menú del admin. Un badge a 0
  // no informa y enseña a no mirarlos.
  if (!value) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0 rounded-full text-center font-bold tabular-nums",
        size === 20 ? "min-w-5 px-1 text-[11px] leading-5" : "min-w-[18px] px-1 text-[10.5px] leading-[18px] font-semibold",
        CONTADOR_TONO[tone],
        className,
      )}
      style={{ height: size }}
    >
      {value > 99 ? "99+" : value}
    </span>
  );
}

/**
 * G-04 · Botón-icono de las filas de sesión y reserva (chat, ver, entrar).
 *
 * Sustituye a los botones de texto («Ver», «Ir a la sala»): en una fila que ya
 * lleva título, alumno, fecha e importe, dos botones de texto se comen el
 * ancho y hacen que la fila envuelva. 36 px es el tamaño del paquete y el
 * mínimo táctil del proyecto.
 *
 * ⚠️ `aria-label` es OBLIGATORIO —el icono no tiene texto y sin él el botón se
 * anuncia como «botón» a secas— y `title` lleva lo mismo, para quien lo ve con
 * el ratón. Por eso son un solo prop: no pueden divergir.
 */
export function PanelIconButton({
  label,
  tone = "outline",
  className,
  children,
  ...props
}: React.ComponentProps<"a"> & {
  label: string;
  /** `primary` = naranja relleno, solo para «Entrar a la sala». */
  tone?: "outline" | "primary";
}) {
  return (
    <a
      aria-label={label}
      title={label}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-[10px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        tone === "primary"
          ? "bg-primary text-white hover:bg-primary/90"
          : "border border-[#e0e0e0] bg-card text-[#4d4d4d] hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

/**
 * G-05 · Cuenta atrás para aceptar una reserva (RN-38).
 *
 * Solo el reloj y el tiempo, sin «Vence en»: en una fila estrecha esas dos
 * palabras eran la diferencia entre caber y envolver, y el reloj ya dice que
 * es tiempo. Negra por defecto y ROJA por debajo de 12 h, que es cuando deja
 * de ser información y pasa a ser urgencia.
 *
 * La explicación completa va en `title`, no a la vista: es la misma frase para
 * todas las filas y repetirla en cada una es ruido. El texto lo fija el
 * documento aprobado, así que no se reescribe aquí.
 */
export function AcceptCountdown({
  label,
  urgent,
  className,
}: {
  label: string;
  urgent: boolean;
  className?: string;
}) {
  return (
    <span
      title="Tiempo que te queda para aceptar o rechazar. Si vence, la reserva se cancela y el alumno recibe el 100 %."
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap text-white",
        urgent ? "bg-[#bf3333]" : "bg-[#19191f]",
        className,
      )}
    >
      <ClockIcon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
