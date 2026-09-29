"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckIcon, CopyIcon, DownloadIcon, Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Mismo truco que `CalendarFeedCard`: el origen, leído sin efecto y sin desajuste de hidratación. */
const nuncaCambia = () => () => {};
const leerOrigin = () => window.location.origin;
const leerOriginEnServidor = () => "";

type Formato = "historia" | "cuadrada";

const PASOS = [
  "Toca el ícono de stickers.",
  "Elige el sticker «Enlace».",
  "Pega tu enlace y colócalo sobre la imagen.",
];

/**
 * «Compartir mi reserva» (reunión del 25-sep, referencia de GoFundMe): una
 * imagen de marca para WhatsApp o una historia de Instagram, más el enlace a la
 * mentoría con el código de invitación de quien comparte.
 *
 * ⚠️ El enlace va APARTE de la imagen, siempre. Una imagen no es clicable, y
 * desde una web Instagram no deja pegarle el enlace como hace Spotify (eso es
 * una integración solo para apps nativas). Por eso, en historia, se copia el
 * enlace antes de abrir la hoja de compartir y se enseñan los pasos del sticker.
 */
export function CompartirReserva({
  productId,
  titulo,
  tutor,
  codigoRef,
  className,
}: {
  productId: string;
  titulo: string;
  tutor: string;
  /** `null` = nunca abrió «Invita y gana»: el enlace sale sin referido. */
  codigoRef: string | null;
  className?: string;
}) {
  const [formato, setFormato] = useState<Formato>("historia");
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const origin = useSyncExternalStore(nuncaCambia, leerOrigin, leerOriginEnServidor);

  const enlace = `${origin}/products/${productId}${codigoRef ? `?ref=${encodeURIComponent(codigoRef)}` : ""}`;
  const imagen = `/api/compartir/mentoria/${productId}?formato=${formato}`;
  const texto = `¡Ya reservé mi mentoría «${titulo}» con ${tutor} en Enséñame Ya!`;

  async function copiar(avisar = true) {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      if (avisar) toast.success("Enlace copiado.");
      return true;
    } catch {
      if (avisar) toast.error("Copia el enlace a mano: está en el recuadro.");
      return false;
    }
  }

  async function archivo() {
    const res = await fetch(imagen);
    if (!res.ok) throw new Error(String(res.status));
    return new File([await res.blob()], `ensenameya-${formato}.png`, { type: "image/png" });
  }

  function descargar(f: File) {
    const url = URL.createObjectURL(f);
    const a = Object.assign(document.createElement("a"), { href: url, download: f.name });
    a.click();
    URL.revokeObjectURL(url);
  }

  async function compartir() {
    setOcupado(true);
    try {
      const f = await archivo();
      if (navigator.canShare?.({ files: [f] })) {
        // En historia el enlace va por el sticker: se deja en el portapapeles
        // ANTES de que la hoja de compartir se lleve el foco.
        if (formato === "historia" && (await copiar(false))) {
          toast.success("Enlace copiado: pégalo en el sticker de enlace.");
        }
        await navigator.share({ files: [f], text: `${texto}\n${enlace}` });
      } else {
        // Escritorio y navegadores sin compartir archivos: se descarga.
        descargar(f);
        toast.success("Imagen descargada. Compártela junto con tu enlace.");
      }
    } catch (e) {
      // Cerrar la hoja de compartir no es un fallo (mismo criterio que `ShareButton`).
      if ((e as { name?: string } | null)?.name !== "AbortError") {
        toast.error("No se pudo preparar la imagen. Intenta de nuevo.");
      }
    } finally {
      setOcupado(false);
    }
  }

  async function soloDescargar() {
    setOcupado(true);
    try {
      descargar(await archivo());
    } catch {
      toast.error("No se pudo descargar la imagen. Intenta de nuevo.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className={cn("h-[49px] gap-2 rounded-[10px] px-6", className)}>
          <Share2Icon aria-hidden className="size-4" />
          Compartir mi reserva
        </Button>
      </DialogTrigger>

      {/* `[&>*]:min-w-0`: `DialogContent` es una rejilla, y sin esto la URL del
          enlace ensancha la ventana más allá de la pantalla en móvil. */}
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[440px] [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Comparte tu reserva</DialogTitle>
          <DialogDescription>Cuéntale a tus amigos qué vas a aprender.</DialogDescription>
        </DialogHeader>

        {/* Historia (Instagram) o cuadrada (WhatsApp y feed): mismo molde. */}
        <div role="group" aria-label="Formato de la imagen" className="grid grid-cols-2 gap-1 rounded-[10px] bg-muted p-1">
          {(["historia", "cuadrada"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={formato === f}
              onClick={() => setFormato(f)}
              className={cn(
                "h-9 cursor-pointer rounded-[8px] text-[13px] font-medium transition-colors",
                formato === f ? "bg-card text-[#19191f] shadow-sm" : "text-[#6b6b6b]",
              )}
            >
              {f === "historia" ? "Historia de Instagram" : "WhatsApp y feed"}
            </button>
          ))}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element -- PNG generado por nuestra ruta, sin optimizar */}
        <img
          src={imagen}
          alt={`Vista previa: ${titulo}, con ${tutor}`}
          className={cn(
            "mx-auto rounded-[12px] bg-muted object-contain shadow-sm",
            formato === "historia" ? "aspect-[9/16] h-[300px]" : "aspect-square h-[240px]",
          )}
        />

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button className="h-11 gap-2 font-semibold" onClick={compartir} disabled={ocupado}>
            <Share2Icon aria-hidden className="size-4" />
            {ocupado ? "Preparando…" : "Compartir"}
          </Button>
          <Button
            variant="outline"
            className="h-11 px-3.5"
            onClick={soloDescargar}
            disabled={ocupado}
            aria-label="Descargar imagen"
            title="Descargar imagen"
          >
            <DownloadIcon aria-hidden className="size-4" />
          </Button>
        </div>

        {formato === "historia" ? (
          <div>
            <p className="text-[13.5px] font-semibold text-[#19191f]">Para agregar tu enlace en la historia:</p>
            <ol className="mt-2 grid gap-1.5">
              {PASOS.map((p, i) => (
                <li key={p} className="flex items-center gap-2.5 text-[13px] text-[#404040]">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary">
                    {i + 1}
                  </span>
                  {p}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[12px] text-[#6b6b6b]">
              Al pulsar «Compartir» copiamos tu enlace, así solo tienes que pegarlo.
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-[10px] border border-[#e0e0e0] p-1.5 pl-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[#6b6b6b]">Tu enlace</p>
            <p className="truncate text-[13px] text-[#19191f]">{enlace}</p>
          </div>
          <Button variant="outline" className="h-9 shrink-0 gap-1.5" onClick={() => copiar()}>
            {copiado ? <CheckIcon aria-hidden className="size-4" /> : <CopyIcon aria-hidden className="size-4" />}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>

        {codigoRef ? null : (
          <p className="text-[12px] text-[#6b6b6b]">
            ¿Quieres ganar cuando alguien se registre con tu enlace?{" "}
            <Link href="/referidos" className="font-medium text-primary underline underline-offset-2">
              Activa tus invitaciones
            </Link>
            .
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
