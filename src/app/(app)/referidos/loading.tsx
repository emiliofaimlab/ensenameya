import { PanelShell } from "@/components/layout/panel-shell";
import { PageLoading } from "@/components/layout/page-loading";

/**
 * La espera de `/referidos`, que no es corta: además de cuatro consultas a la
 * base, la PRIMERA visita da de alta al referidor en Referral Factory, y RF
 * tiene picos de más de 25 s (por eso el cliente corta a los 8). Sin este
 * límite el navegador se queda congelado en la pantalla anterior todo ese rato,
 * sin ninguna señal de que el clic haya hecho algo.
 *
 * El `loading.tsx` de `(app)` ya cubría esta ruta; lo que añade este es la
 * CABECERA de verdad —los mismos `eyebrow`/`title`/`description` que pinta la
 * página— para que la espera diga a dónde vas en vez de enseñar solo el
 * isotipo. El resto se deja a `PageLoading`, que es el mismo de todo el panel.
 *
 * ⚠️ SIN MENÚ, por el mismo motivo que el de `(app)`: esta pantalla es
 * compartida y su menú depende de la cookie `ey-panel` (`panelItems`).
 * Adivinarlo aquí le enseñaría a un tutor el menú de alumno —este elemento se
 * cachea en el `CacheNode` del cliente— y con `sidebar={false}` el contenedor
 * no cambia: mismo ancho, mismo aire, una sola columna.
 */
export default function ReferidosLoading() {
  return (
    <PanelShell
      sidebar={false}
      eyebrow="Cuenta"
      title="Invita y gana"
      description="Invita alumnos y tutores con tus enlaces. Aquí ves quién entró y qué ganaste."
    >
      <PageLoading />
    </PanelShell>
  );
}
