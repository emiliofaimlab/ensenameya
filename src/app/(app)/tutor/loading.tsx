import { PanelShell } from "@/components/layout/panel-shell";
import { TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { PageLoading } from "@/components/layout/page-loading";

/**
 * La carga de las pantallas del tutor, CON su menú.
 *
 * El `loading.tsx` de `(app)` sustituye el segmento entero, y como el armazón
 * lo pinta cada pantalla (no el layout), durante la espera desaparecían el menú
 * lateral y la cabecera: la pantalla se quedaba en blanco de lado a lado. Se
 * sentía mucho más lento de lo que era — es lo que reportó el cliente.
 *
 * `TUTOR_ITEMS` es la MISMA constante que usa `TutorShell`, así que esto no
 * duplica el menú: lo adelanta.
 *
 * Sin `badges` a propósito: los contadores salen de la base y aquí todavía no
 * han llegado. Pintar ceros sería mentir y luego corregirse a la vista.
 *
 * ⚠️ Y CON EL ACORDEÓN YA EN SU SITIO, sin pasarle nada. Desde el 11-sep-2026
 * los subniveles del tutor se pliegan (G-01 reabierta), y qué grupo sale
 * abierto lo decide `AppSidebar` a partir del `pathname` EN EL PRIMER RENDER
 * —no de un efecto—, así que este esqueleto y la pantalla de verdad calculan lo
 * mismo y el menú no brinca al hidratar. Si algún día ese estado pasara a
 * calcularse después de montar, este fichero es el que lo delata.
 */
export default function TutorLoading() {
  return (
    <PanelShell items={TUTOR_ITEMS}>
      <PageLoading />
    </PanelShell>
  );
}
