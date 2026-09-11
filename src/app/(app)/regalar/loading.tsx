import { PanelShell } from "@/components/layout/panel-shell";
import { PageLoading } from "@/components/layout/page-loading";

/**
 * La carga de las cuatro pantallas de la sección: `/regalar`,
 * `/regalar/mentoria/<productId>`, `/regalar/mis-regalos` y
 * `/regalar/<creditId>/confirmacion`.
 *
 * Sin un `loading.tsx` el App Router no tiene dónde suspender y el navegador se
 * queda CONGELADO en la pantalla anterior hasta que el servidor termina (medido
 * en este repo: ~700 ms contra 60). Las tres pantallas de esta sección leen del
 * catálogo, así que la espera es real.
 *
 * ⚠️ **SIN MENÚ, IGUAL QUE EL DE `(app)` Y POR EL MISMO MOTIVO.** Este elemento
 * se construye UNA vez al entrar en el segmento y se queda cacheado en el
 * `CacheNode` del cliente, y `/regalar` es una pantalla COMPARTIDA: su menú lo
 * decide la cookie `ey-panel` vía `panelMenu()`, no la ruta. Adivinarlo aquí
 * —pintar `STUDENT_ITEMS` porque es lo más probable— le dejaría a un tutor el
 * menú de alumno fijado para el resto de la navegación. Es exactamente la
 * trampa que ya está escrita en `src/app/(app)/loading.tsx` por `/account` y
 * `/pagos`. Con `sidebar={false}` el contenedor no se toca: mismo `max-w`,
 * mismo padding, una sola columna.
 *
 * Tampoco se adelanta el título: el mismo fallback sirve a las tres pantallas y
 * dos de ellas no se llaman «Regalar una mentoría». Un título que se corrige a
 * la vista es peor que ninguno.
 */
export default function RegalarLoading() {
  return (
    <PanelShell sidebar={false}>
      <PageLoading />
    </PanelShell>
  );
}
