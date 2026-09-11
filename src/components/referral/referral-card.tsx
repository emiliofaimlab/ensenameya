import Link from "next/link";
import { GiftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";

/**
 * US-1301 (FL-04) · puerta a «Invita y gana» desde AL02, TU02 y G03.
 *
 * ⚠️ SIN `isTutor` Y SIN `hasReferralProgram` DESDE EL 11-SEP-2026, y las dos
 * desapariciones son la misma: `/referidos` dejó de ser el iframe de una
 * campaña por rol y pasó a ser una pantalla nuestra que pinta TODAS las
 * campañas visibles (`referral_campaigns`, `20260911120000`).
 *
 *   · El rol ya no elige campaña, así que esta tarjeta no tiene nada que
 *     decidir: cualquiera puede invitar alumnos y tutores a la vez. El reparto
 *     por panel que vivía aquí —y la larga nota de B1.11 que lo defendía— ya no
 *     protege de nada, porque no hay dos destinos entre los que equivocarse.
 *   · Y no puede renderizar `null`: quién ve qué lo deciden las filas de
 *     `referral_campaigns`, no cuatro `NEXT_PUBLIC_REFERRAL_*` que ya se
 *     retiraron. Sin campañas visibles la pantalla sigue existiendo y lo dice
 *     ella, que es donde se puede explicar.
 *
 * El texto no promete monto ni recompensa: eso lo fija cada campaña desde
 * `/admin/referidos`, y lo dice la tarjeta de esa campaña (RN-21).
 */
export function ReferralCard() {
  return (
    <PanelCard>
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <GiftIcon className="size-5" />
      </span>
      <PanelCardTitle className="mt-4 text-xl">Invita y gana</PanelCardTitle>
      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
        Invita alumnos y tutores y gana con cada uno.
      </p>
      <Button asChild className="mt-4 h-10">
        {/* Navegación interna: ni `target` ni `rel`, que el usuario se queda
            dentro de la app. */}
        <Link href="/referidos">Ver mis enlaces</Link>
      </Button>
    </PanelCard>
  );
}
