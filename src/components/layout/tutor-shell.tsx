import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelShell,
  type PanelShellProps,
} from "@/components/layout/panel-shell";
import { tutorSidebarBadges } from "@/lib/tutor/sidebar-badges";

/**
 * Shell de las pantallas del tutor (TU02…TU09): `PanelShell` con su menú.
 *
 * US-1601 · AL TUTOR SE LE DA COLUMNA A 768, aunque su Figma pida chips.
 *
 * «TU06 — Dashboard Tutor» es el único de los tres paneles que dibuja
 * `nav-chips` en LOS DOS anchos (350x176 a 390 y 704x84 a 768); alumno y admin
 * pasan a barra lateral en tablet. Gana la coherencia por dos razones:
 *
 *  1. La página «Tutor» del Figma es otra sesión de trabajo, no otro criterio.
 *     Es la única con `pad-x 28` en vez de 32 y la única pintada con los grises
 *     por defecto de Tailwind (#1f2937, #6b7280, #e5e7eb: 0 apariciones fuera
 *     de ella). Su cabecera tampoco se parece a las otras dos.
 *  2. A partir de 1024 el tutor YA tiene barra lateral, y eso está en
 *     producción desde EP-22. Copiar los chips a 768 le dejaría tres estados
 *     (chips → chips → columna) frente a los dos de alumno y admin.
 *
 * G-02 (paquete v2, 8-sep-2026) · el shell resuelve los CONTADORES del menú y
 * los pasa a `PanelShell`, igual que hace `AdminShell` con los suyos. Va aquí y
 * no en cada pantalla por lo de siempre: siete pantallas pidiéndolos por su
 * cuenta serían siete criterios que acaban discrepando, y además el menú los
 * pinta en todas — una pantalla que se olvidara dejaría el menú sin números
 * justo donde el tutor lo está mirando.
 *
 * Es `async` y por tanto un Server Component: `PanelShell` no lo es (lo usan
 * pantallas de cliente), así que la consulta se queda de este lado.
 * `tutorSidebarBadges` está memoizada por petición, y de eso vive el ADELANTO:
 * `requireTutorProfile()` —la primera línea de las pantallas— la lanza sin
 * `await`, así que este `await` encuentra la misma promesa ya en vuelo en vez
 * de empezar de cero al final del render. Ver `lib/auth/tutor.ts`.
 */
export async function TutorShell({
  userId,
  ...props
}: Omit<PanelShellProps, "items" | "badges"> & {
  /**
   * El tutor cuyos contadores se cuentan. Lo pasa la pantalla, que ya lo tiene
   * de `requireTutorProfile()`: pedirlo otra vez aquí sería un viaje a Auth por
   * pantalla. Sin él, el menú se pinta sin números (es lo que hacen las
   * pantallas que todavía no lo pasan).
   */
  userId?: string;
}) {
  const badges = userId ? await tutorSidebarBadges(userId) : undefined;
  return <PanelShell items={TUTOR_ITEMS} badges={badges} {...props} />;
}
