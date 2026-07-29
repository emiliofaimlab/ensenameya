import Link from "next/link";
import { GiftIcon } from "lucide-react";

import { referralUrl } from "@/lib/referral";
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
 * Se abre en pestaña nueva en vez de embeberse en un iframe: la campaña es un
 * sitio de terceros y si su cabecera prohíbe el embebido nos quedaríamos con un
 * recuadro en blanco dentro del panel. Un enlace no falla nunca. Si más adelante
 * se quiere el embebido, es cambiar el botón por el iframe.
 *
 * Sin campaña configurada no se pinta nada (ver `referralUrl`).
 */
export function ReferralCard() {
  const url = referralUrl();
  if (!url) return null;

  return (
    <PanelCard>
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <GiftIcon className="size-5" />
      </span>
      <PanelCardTitle className="mt-4 text-xl">Invita y gana</PanelCardTitle>
      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
        Comparte tu enlace: cuando alguien aprende contigo de por medio, ganas
        tú también.
      </p>
      <Button asChild className="mt-4 h-10">
        {/* `noreferrer` además de `noopener`: la campaña no necesita saber desde
            qué pantalla del panel se abrió. */}
        <Link href={url} target="_blank" rel="noopener noreferrer">
          Ver mi enlace de invitación
        </Link>
      </Button>
    </PanelCard>
  );
}
