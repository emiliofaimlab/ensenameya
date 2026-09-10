import { PanelShell } from "@/components/layout/panel-shell";
import { PageLoading } from "@/components/layout/page-loading";

/**
 * La carga del resto de `(app)`: /app, /reservas, /agendar, /account, /pagos,
 * /referidos. Mismo motivo que `tutor/loading.tsx` y `admin/loading.tsx` — el
 * armazón lo pinta cada pantalla, no el layout, así que este fallback sustituye
 * al segmento ENTERO: sin `PanelShell` la espera se quedaba en blanco de lado a
 * lado, perdiendo fondo, ancho y aire del panel, y se sentía mucho más lenta de
 * lo que era (es justo lo que reportó el usuario).
 *
 * ⚠️ SIN MENÚ a propósito, y no por falta de ganas: este elemento se construye
 * UNA vez al entrar en `(app)` y se queda cacheado en el `CacheNode` del
 * cliente. Como `/account` y `/pagos` cambian de menú en caliente según el panel
 * del que vengas (`panelItems`, `src/lib/auth/panel-items.ts`), adivinarlo aquí
 * —por cookie o por lo que sea— le enseñaría a un tutor que cambió de panel el
 * menú de alumno para siempre. Con `sidebar={false}` el contenedor no se toca:
 * mismo `max-w`, mismo padding, una sola columna.
 */
export default function AppLoading() {
  return (
    <PanelShell sidebar={false}>
      <PageLoading />
    </PanelShell>
  );
}
