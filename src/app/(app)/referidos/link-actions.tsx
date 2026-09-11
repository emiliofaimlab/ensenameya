"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon, QrCodeIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShareButton } from "@/components/referral/share-button";

/**
 * El enlace de una campaña y las tres cosas que se pueden hacer con él.
 *
 * Es lo ÚNICO de la tarjeta que necesita cliente: el portapapeles, la hoja de
 * compartir y el QR no existen en el servidor. El resto de la tarjeta (icono,
 * título, recompensa, contadores) se pinta en `page.tsx` y no viaja al bundle.
 */
export function LinkActions({
  enlace,
  titulo,
}: {
  enlace: string;
  /** El título de la campaña: lo que verá quien reciba la hoja de compartir. */
  titulo: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  const mensaje = `Aprende o enseña en Enséñame Ya con mi invitación: ${enlace}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      toast.success("Enlace copiado");
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS) no se puede copiar por
      // código. El enlace está a la vista y se puede seleccionar a mano.
      toast.error("Copia el enlace a mano: está en el recuadro de arriba.");
    }
  }

  async function abrirQR() {
    setAbierto(true);
    if (qr) return;
    try {
      /**
       * ⚠️ IMPORT DINÁMICO, y no es micro-optimización: `qrcode` son ~50 KB de
       * JS que solo necesita quien pulsa este botón. Estático, entraría en el
       * bundle de `/referidos` entero —la pantalla la abre todo el mundo, el
       * QR lo usa casi nadie— y se pagaría en la primera carga.
       *
       * ⚠️ Y EL QR ES DE NUESTRO ENLACE, no el `qr_url` que devuelve RF: ese
       * apunta a la landing de Referral Factory, que no redirige de vuelta a la
       * app y por tanto no deja `?ref=` en la cookie. Escanearlo perdería la
       * atribución sin que se note (ver `referral_memberships.qr_url` en
       * `20260911120000`).
       */
      const { toDataURL } = await import("qrcode");
      setQr(await toDataURL(enlace, { width: 512, margin: 1 }));
    } catch {
      setAbierto(false);
      toast.error("No se pudo generar el código QR.");
    }
  }

  return (
    <>
      {/* ⚠️ `truncate` Y NO UN `flex` CENTRADO. La url completa mide más que la
          tarjeta en móvil, y sin recortarla empuja la columna del panel: así es
          como aparece la barra horizontal en el DOCUMENTO (ver la nota de
          `PanelShell`). `text-overflow` solo actúa sobre un contenedor de
          BLOQUE, así que en un `flex` la elipsis no sale y el texto se
          desborda igual; el centrado vertical lo hace `leading-[42px]` (44 de
          alto menos el borde). El `title` deja la url entera al alcance del
          ratón. */}
      <p
        title={enlace}
        className="mt-3 h-11 truncate rounded-[10px] border border-[#e0e0e0] bg-muted px-3 font-mono text-[12px] leading-[42px] text-[#4d4d4d]"
      >
        {enlace}
      </p>

      {/* §5.0 · objetivos táctiles de 44 px: Copiar y Compartir a mitad y
          mitad, el QR cuadrado en su propia pista. La rejilla es la que manda
          el tamaño del botón-icono, así que no puede descuadrarse. */}
      <div className="mt-2 grid grid-cols-[1fr_1fr_44px] gap-2">
        <Button type="button" className="h-11" onClick={copiar}>
          <CopyIcon className="size-4" />
          Copiar
        </Button>

        <ShareButton url={enlace} mensaje={mensaje} titulo={titulo} />

        {/* `aria-label` Y `title` con el mismo texto: el icono no tiene nombre
            accesible por sí solo y quien mira con el ratón merece el mismo. */}
        <Button
          type="button"
          variant="outline"
          aria-label="Ver código QR"
          title="Ver código QR"
          className="size-11 p-0"
          onClick={abrirQR}
        >
          <QrCodeIcon className="size-4" />
        </Button>
      </div>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Código QR</DialogTitle>
            <DialogDescription className="break-all font-mono text-[11.5px]">
              {enlace}
            </DialogDescription>
          </DialogHeader>
          {qr ? (
            // Es un `data:` generado en el navegador: no hay nada que
            // `next/image` pueda optimizar de una imagen que no existe en
            // ningún servidor. (El `disable` va pegado al `<img>`: con el
            // comentario largo en medio, "next-line" apunta al comentario.)
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt={`Código QR de ${titulo}`}
              className="mx-auto aspect-square w-full max-w-[256px] rounded-[10px]"
            />
          ) : (
            <p className="py-10 text-center text-[13px] text-[#6b6b6b]">
              Generando…
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * §5.3 · «Sin membership todavía → "Preparando tu enlace…" y `revalidate` en 10 s».
 *
 * ⚠️ `export const revalidate = 10` NO SIRVE AQUÍ y por eso esto es un
 * componente y no una línea en `page.tsx`: la pantalla usa `headers()`, cookies
 * y sesión, o sea que es dinámica siempre y no hay caché que revalidar. Lo que
 * el §5.3 pide de verdad es volver a pedirla, y eso se hace en el cliente.
 *
 * Un solo disparo, no un bucle: si a los 10 s RF sigue sin responder, insistir
 * cada 10 s le pega una llamada a un tercero por cada usuario que deje la
 * pestaña abierta. La visita siguiente lo reintenta igual.
 */
export function RefrescarCuandoLlegueElEnlace() {
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.refresh(), 10_000);
    return () => clearTimeout(t);
  }, [router]);
  return null;
}
