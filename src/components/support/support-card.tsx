import Link from "next/link";
import { LifeBuoyIcon } from "lucide-react";

import { COMPANY } from "@/lib/company";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";

/**
 * SUP-01 (`EY-153`) · «Contactar soporte técnico», en el panel del alumno y en
 * el del tutor.
 *
 * ⚠️ ESTO NO ABRE UN CANAL NUEVO, Y ESA ES LA DECISIÓN. El buzón de soporte ya
 * existe: `/contacto` (DL-01), cuyo formulario escribe en `contact_messages`
 * desde `POST /api/contacto` y avisa por correo a `COMPANY.email`. Montar aquí
 * un segundo formulario —o un `mailto:` a otra dirección— daría dos bandejas
 * con dos backlogs, y la que no está en `contact_messages` no la ve nadie.
 * Además `/contacto` es una de las tres páginas que **dLocal valida a mano**
 * (DL-01/02/03): duplicarla es exactamente lo que no conviene tocar.
 *
 * Por eso hay dos salidas y solo dos, las dos hacia el mismo sitio:
 *   · el botón, que lleva al formulario;
 *   · el buzón oficial, para quien prefiera escribir desde su propio correo.
 *
 * ⚠️ La dirección sale de `lib/company.ts` y NO se teclea aquí. Es la del §39
 * del contrato y la que está dada de alta en dLocal: tecleada en dos sitios,
 * cambiarla en uno deja al otro mandando correo a un buzón muerto.
 *
 * 🐛 Lo que este botón NO arregla y conviene saber: `/contacto` es público y su
 * formulario **no sabe quién eres aunque tengas sesión** — el alumno vuelve a
 * teclear su nombre y su correo, y el mensaje llega sin decir de qué reserva
 * habla. Precargarlo es trabajo del formulario (hoy `ContactForm` no acepta
 * valores iniciales), no de este enlace.
 */
export function SupportCard({ className }: { className?: string }) {
  return (
    <PanelCard className={className}>
      <span className="grid size-10 place-items-center rounded-full bg-brand-muted text-brand">
        <LifeBuoyIcon className="size-5" />
      </span>
      <PanelCardTitle className="mt-4 text-xl">
        ¿Algo no funciona?
      </PanelCardTitle>
      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
        Cuéntanos qué ha pasado —una reserva, un pago, la sala— y te
        respondemos en menos de 24 horas laborables.
      </p>
      <Button asChild className="mt-4 h-10">
        <Link href="/contacto">Contactar soporte técnico</Link>
      </Button>
      <p className="mt-3 text-[12.5px] text-[#6b6b6b]">
        O escríbenos a{" "}
        <a
          href={`mailto:${COMPANY.email}`}
          className="font-medium text-brand hover:underline"
        >
          {COMPANY.email}
        </a>
        .
      </p>
    </PanelCard>
  );
}
