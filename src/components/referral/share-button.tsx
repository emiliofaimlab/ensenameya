"use client";

import { useSyncExternalStore } from "react";
import { Share2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Doc 31 §G-07 · «Compartir», una sola vez y para todo el producto.
 *
 * Dos caras según lo que el navegador sepa hacer:
 *   · con Web Share API (todo móvil moderno) abre la hoja del sistema, que es
 *     donde el usuario ya tiene sus contactos y sus apps;
 *   · sin ella (escritorio, casi siempre) un menú con las cinco redes.
 *
 * ⚠️ SIEMPRE CON NUESTRO ENLACE, nunca con la landing de Referral Factory. El
 * `?ref=` solo deja rastro si el clic aterriza en NUESTRO dominio: es el proxy
 * quien lo guarda en la cookie `ey-ref` (`src/lib/supabase/middleware.ts`).
 * Repartir la url de RF es exactamente el agujero que tenía la v1 —la landing
 * de RF no redirige de vuelta, así que nadie llegaba nunca con código— y se
 * vería idéntico de bien.
 */

/**
 * ¿Hay Web Share API? Leído SIN efecto, con el mismo patrón que
 * `calendar-feed-card.tsx`: este componente también se renderiza en el
 * servidor, donde `navigator` no existe, y decidir la cara en el render a secas
 * es un desajuste de hidratación garantizado. `useSyncExternalStore` da
 * instantánea de cliente e instantánea de servidor por separado, y la
 * suscripción va vacía porque esto no cambia nunca en la vida de la pestaña.
 * Las tres funciones viven a nivel de módulo para que su identidad sea estable.
 */
const nuncaCambia = () => () => {};
const hayWebShare = () => typeof navigator.share === "function";
// `false` en servidor y en el primer render: el menú de redes funciona en
// cualquier navegador, así que es la cara segura con la que hidratar.
const noEnServidor = () => false;

/**
 * ⚠️ CADA RED SE TRAGA UNA COSA DISTINTA, y por eso esto no es un solo patrón
 * con el nombre cambiado:
 *   · WhatsApp, Telegram y X llevan el MENSAJE entero (con el enlace dentro);
 *   · Facebook `sharer` IGNORA cualquier texto que se le pase —lo ha ido
 *     quitando desde 2017— así que solo viaja la url y el mensaje lo escribe el
 *     usuario en su propio cuadro;
 *   · el correo necesita asunto aparte o llega sin él.
 */
const REDES: { nombre: string; href: (url: string, mensaje: string) => string }[] = [
  {
    nombre: "WhatsApp",
    href: (_url, mensaje) => `https://wa.me/?text=${encodeURIComponent(mensaje)}`,
  },
  {
    nombre: "Correo",
    href: (_url, mensaje) =>
      `mailto:?subject=${encodeURIComponent("Enséñame Ya")}&body=${encodeURIComponent(mensaje)}`,
  },
  {
    nombre: "Telegram",
    href: (url, mensaje) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(mensaje)}`,
  },
  {
    nombre: "Facebook",
    href: (url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    nombre: "X",
    href: (_url, mensaje) =>
      `https://x.com/intent/post?text=${encodeURIComponent(mensaje)}`,
  },
];

export function ShareButton({
  url,
  mensaje,
  titulo,
  className,
}: {
  /** El enlace que se reparte. NUESTRO, ver la cabecera. */
  url: string;
  /** El texto completo, con el enlace dentro (lo que leerá quien lo reciba). */
  mensaje: string;
  /** Título para la hoja del sistema. */
  titulo: string;
  className?: string;
}) {
  const webShare = useSyncExternalStore(nuncaCambia, hayWebShare, noEnServidor);

  if (webShare) {
    return (
      <Button
        type="button"
        variant="outline"
        className={cn("h-11", className)}
        onClick={() => {
          // Cancelar la hoja rechaza con `AbortError`. No es un fallo del que
          // haya que avisar: el usuario acaba de decir que no.
          void navigator.share({ title: titulo, text: mensaje, url }).catch(() => {});
        }}
      >
        <Share2Icon className="size-4" />
        Compartir
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className={cn("h-11", className)}>
          <Share2Icon className="size-4" />
          Compartir
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {REDES.map((r) => (
          <DropdownMenuItem key={r.nombre} asChild>
            {/* `noreferrer` además de `noopener`: la red no necesita saber
                desde qué pantalla del panel se abrió. */}
            <a href={r.href(url, mensaje)} target="_blank" rel="noopener noreferrer">
              {r.nombre}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
