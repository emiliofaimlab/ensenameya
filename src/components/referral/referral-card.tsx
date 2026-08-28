import Link from "next/link";
import { GiftIcon } from "lucide-react";

import { hasReferralProgram } from "@/lib/referral";
import { Button } from "@/components/ui/button";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";

/**
 * US-1301 (FL-04) · punto de integración de referidos en AL02 y G03.
 *
 * **Cero lógica interna (RN-21).** El programa entero —reglas, montos,
 * conversión válida, pagos— vive en Referral Factory; aquí solo está la puerta.
 * No se calcula ni se muestra ningún saldo: lo que el alumno gana lo dice su
 * panel de la plataforma externa, no el nuestro.
 *
 * ⚠️ EL BOTÓN YA NO SALE DE LA APP (petición del cliente, 28-ago). Antes abría
 * la campaña en una pestaña nueva —y el comentario de aquí defendía esa
 * elección: si la cabecera del tercero prohíbe el embebido, un iframe deja un
 * recuadro en blanco dentro del panel y un enlace no falla nunca—. Ese riesgo no
 * ha desaparecido, ha cambiado de sitio: ahora se lleva a `/referidos`, que es
 * NUESTRA pantalla, y es ella la que decide si monta el widget o repite el
 * enlace de siempre según haya URL de embed configurada. Aquí no hay nada que
 * pueda quedarse en blanco.
 *
 * Sin campaña configurada —ni embed ni enlace— no se pinta nada, y así el botón
 * no puede llevar a un `notFound()` (ver `hasReferralProgram`).
 *
 * ⚠️ B1.11 · CADA ROL VE SU PROGRAMA. Son dos campañas distintas en Referral
 * Factory, con sus propias reglas y recompensas, así que cambia el texto — y el
 * destino lo resuelve `/referidos`, que aplica el mismo criterio por panel.
 * Antes se repartía el mismo enlace a todos y un tutor acababa dado de alta
 * como alumno.
 *
 * El texto no promete de quién es la recompensa ni cuánto: eso lo decide la
 * campaña, no nosotros (RN-21). Lo único que dice es a qué programa entra.
 */
export function ReferralCard({ isTutor = false }: { isTutor?: boolean }) {
  if (!hasReferralProgram(isTutor)) return null;

  return (
    <PanelCard>
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <GiftIcon className="size-5" />
      </span>
      <PanelCardTitle className="mt-4 text-xl">Invita y gana</PanelCardTitle>
      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
        {isTutor
          ? "Comparte tu enlace de tutor: es el programa de invitaciones para quienes enseñan, distinto al de los alumnos."
          : "Comparte tu enlace: cuando alguien aprende contigo de por medio, ganas tú también."}
      </p>
      <Button asChild className="mt-4 h-10">
        {/* Navegación interna: ni `target` ni `rel`, que el usuario se queda
            dentro de la app. */}
        <Link href="/referidos">Ver mi enlace de invitación</Link>
      </Button>
    </PanelCard>
  );
}
