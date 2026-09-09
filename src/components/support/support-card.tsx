import Link from "next/link";
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
/**
 * ⚠️ Paquete «Panel del tutor v2» (§1.4, 8-sep-2026): la tarjeta pierde el
 * icono, acorta el texto y su botón pasa a SECUNDARIO con el rótulo «Escribir a
 * soporte». El porqué del botón no es estético: en un panel el botón naranja es
 * la acción principal de la pantalla, y aquí la acción principal es cobrar o
 * dar clase, no escribir a soporte. Dos botones naranjas en la misma columna se
 * disputan la mirada y ninguno gana.
 *
 * Se cambia para los DOS paneles y no solo para el del tutor: es la misma
 * tarjeta, y el rótulo nuevo («Escribir a soporte») es más corto y empieza por
 * verbo, que es lo que quiere cualquiera de los dos.
 *
 * ⚠️ Lo que NO se quita, aunque la captura no lo dibuje: el buzón de correo de
 * abajo. La captura recorta ahí, la lista aprobada no lo menciona, y la regla
 * es que lo que no está en la lista se conserva (G-07). Además es la salida
 * para quien prefiere escribir desde su propio correo, que es justo quien no
 * puede o no quiere usar el formulario.
 */
export function SupportCard({ className }: { className?: string }) {
  return (
    <PanelCard className={className}>
      <PanelCardTitle className="text-xl">¿Algo no funciona?</PanelCardTitle>
      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
        Cuéntanos qué pasó y te respondemos en menos de 24 horas laborables.
      </p>
      <Button asChild variant="outline" className="mt-4 h-10">
        <Link href="/contacto">Escribir a soporte</Link>
      </Button>
      <p className="mt-3 text-[12.5px] text-[#6b6b6b]">
        O escríbenos a{" "}
        <a
          href={`mailto:${COMPANY.email}`}
          /* `text-brand-foreground` (#036fda, 4,9:1 sobre blanco) y no
             `text-brand` (#0080ff, 3,80:1): es texto de 12,5 px, o sea texto
             normal para WCAG 1.4.3. El token ya existía en `globals.css` para
             exactamente esto. El resto del sitio sigue con `text-brand` —168
             usos, no todos texto— y ese barrido es aparte. */
          className="font-medium text-brand-foreground hover:underline"
        >
          {COMPANY.email}
        </a>
        .
      </p>
    </PanelCard>
  );
}
