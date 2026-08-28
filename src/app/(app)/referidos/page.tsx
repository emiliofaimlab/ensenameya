import Link from "next/link";
import { notFound } from "next/navigation";
import { GiftIcon } from "lucide-react";

import { requireUser } from "@/lib/auth/server";
import { panelItems } from "@/lib/auth/panel-items";
import { referralEmbedUrl, referralUrl } from "@/lib/referral";
import { Button } from "@/components/ui/button";
import {
  PanelShell,
  PanelCard,
  PanelCardTitle,
} from "@/components/layout/panel-shell";

export const metadata = { title: "Invita y gana · Enséñame Ya" };

/**
 * US-1301 · «Invita y gana» DENTRO de la app (petición del cliente, 28-ago).
 *
 * Hasta hoy la tarjeta del panel abría la campaña de Referral Factory en una
 * pestaña nueva y el usuario se salía de Enséñame Ya. Esta ruta es el mismo
 * programa en el cromo del panel: mismo menú, misma cabecera, misma marca.
 * **Sigue sin haber lógica nuestra de referidos (RN-21)**: el widget es de RF de
 * punta a punta y aquí solo se le hace sitio.
 *
 * ⚠️ NO SE ROMPE SIN LA VARIABLE DE EMBED. Mientras el cliente no entregue el
 * `src` del iframe que da RF, `referralEmbedUrl` devuelve `null` y la pantalla
 * cae al comportamiento de siempre —el enlace externo— con un aviso discreto.
 * Un recuadro en blanco dentro del panel sería peor que la pestaña nueva que
 * veníamos evitando, así que el iframe solo se monta cuando hay a dónde apuntar.
 *
 * Y si no hay ni embed ni enlace, la pantalla no existe: `notFound()`. Es la
 * otra mitad de «la URL es el interruptor» — sin campaña configurada tampoco se
 * pinta la tarjeta que lleva aquí, y quien entre a pelo por la barra de
 * direcciones no se encuentra un «Invita y gana» que no lleva a ninguna parte.
 */
export default async function ReferidosPage() {
  const { user, roles } = await requireUser();

  // El menú sigue al panel del que vienes, no al rol (ver `panelItems`).
  const items = await panelItems(user.id, roles);

  /**
   * ⚠️ B1.11 · EL PROGRAMA LO DECIDE EL PANEL, NO EL ROL, y no es un atajo: es
   * la regla que `/app` ya aplicaba («esta pantalla es el panel del ALUMNO, así
   * que su programa es el de alumnos siempre»). Un tutor que además compra
   * entra por el panel de alumno, y ahí actúa como alumno.
   *
   * Decidirlo con `roles.includes("tutor")` rompería justo ese caso: la tarjeta
   * de `/app` se pinta con el programa del alumno y este destino resolvería el
   * del tutor, que hoy no existe → un botón que acaba en 404.
   *
   * El panel se lee del menú que acaba de resolverse, que es el mismo idiom que
   * ya usa `PanelShell` para esto (`items?.[0]?.href === "/admin"`). Admin
   * cuenta como alumno: no hay campaña de administradores.
   *
   * Queda un hueco conocido, y se deja abierto a propósito: `/account` sí pinta
   * su tarjeta por ROL, así que si algún día existiera la campaña del tutor y NO
   * la del alumno, un tutor con panel de alumno vería el botón y aquí se
   * encontraría un 404. Cerrarlo sería caer a la otra campaña, que es
   * justamente lo prohibido (B1.11). Esa combinación no existe hoy —solo hay
   * campaña de alumnos—; el día que se cree la segunda, lo que hay que cambiar
   * es que `/account` pase el panel en vez del rol.
   */
  const isTutor = items?.[0]?.href === "/tutor";

  const embed = referralEmbedUrl(isTutor);
  const externa = referralUrl(isTutor);
  if (!embed && !externa) notFound();

  return (
    <PanelShell
      items={items}
      eyebrow="Cuenta"
      title="Invita y gana"
      description={
        isTutor
          ? "Tu programa de invitaciones como tutor, sin salir de Enséñame Ya."
          : "Comparte tu enlace y sigue tus invitaciones sin salir de Enséñame Ya."
      }
    >
      {embed ? (
        <>
          {/* `p-0` + `overflow-hidden`: el widget trae su propio aire y su
              propio fondo, así que la tarjeta solo pone el borde y el r16 del
              Figma. Con los 20 de padding se veía un marco doble. */}
          <PanelCard className="overflow-hidden p-0">
            {/* ⚠️ El alto lo pone el viewport, no el contenido: un iframe entre
                dominios no puede medir a su hijo, y hasta que no llegue el
                snippet no sabemos si RF publica un `postMessage` de
                redimensionado al que engancharse. `70svh` con mínimo de 560 deja
                el widget usable en móvil —`svh` ya descuenta la barra del
                navegador— sin abrir un socavón en escritorio.

                `loading="lazy"` porque la tarjeta puede quedar por debajo del
                pliegue y no hay motivo para pagar la carga de un tercero antes
                de que se vea. */}
            <iframe
              src={embed}
              title="Programa de invitaciones de Enséñame Ya"
              loading="lazy"
              className="block h-[70svh] min-h-[560px] w-full border-0"
            />
          </PanelCard>
          {externa ? (
            /* Salida de emergencia, y no es adorno: si RF cambia sus cabeceras
               o el navegador bloquea el marco (cookies de terceros), el iframe
               se queda en blanco y esto es lo único que sigue funcionando. */
            <p className="text-xs text-[#6b6b6b]">
              ¿Prefieres verlo en su propia ventana?{" "}
              <a
                href={externa}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Abrir la campaña en una pestaña nueva
              </a>
            </p>
          ) : null}
        </>
      ) : externa ? (
        <PanelCard className="max-w-[560px]">
          <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
            <GiftIcon className="size-5" />
          </span>
          <PanelCardTitle className="mt-4 text-xl">
            Tu enlace de invitación
          </PanelCardTitle>
          <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
            El programa vive en la plataforma de la campaña: ahí está tu enlace,
            quién ha entrado con él y lo que llevas ganado.
          </p>
          <Button asChild className="mt-4 h-10">
            {/* `noreferrer` además de `noopener`: la campaña no necesita saber
                desde qué pantalla del panel se abrió. */}
            <Link href={externa} target="_blank" rel="noopener noreferrer">
              Ver mi enlace de invitación
            </Link>
          </Button>
          {/* El aviso discreto: se avisa de que se abre fuera en vez de dejar
              que sorprenda. Desaparece solo el día que haya embed. */}
          <p className="mt-3 text-xs text-[#6b6b6b]">
            Todavía no está integrado aquí dentro, así que se abre en una pestaña
            nueva.
          </p>
        </PanelCard>
      ) : null}
    </PanelShell>
  );
}
