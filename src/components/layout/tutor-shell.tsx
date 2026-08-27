import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import {
  PanelShell,
  type PanelShellProps,
} from "@/components/layout/panel-shell";

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
 */
export function TutorShell(props: Omit<PanelShellProps, "items">) {
  return <PanelShell items={TUTOR_ITEMS} {...props} />;
}
