"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * EY-223 · «Compartir mi mentoría» (en EY-225 era un submenú de enlaces).
 *
 * Un DIÁLOGO, no una pantalla: el tutor lo abre desde el «···» de la fila y
 * vuelve a su lista sin navegar. En 375 px cabe con scroll interno
 * (`max-h-[92dvh]`), igual que «Compartir mi reserva».
 *
 * ⚠️ Vive FUERA del `DropdownMenuContent` (lo monta `ProductStatusActions` al
 * lado del menú, con el estado `open` arriba): dentro del menú se desmontaría
 * en cuanto el menú se cierra, que es justo al pulsar el ítem. Mismo patrón que
 * `SignOutDialog` en la cabecera.
 *
 * ── Qué hace cada red ─────────────────────────────────────────────────────
 * La red decide el formato de la imagen (`api/compartir/mentoria/[id]/promo`):
 *   · Facebook, LinkedIn y X solo aceptan un ENLACE desde la web. Se abre su
 *     URL de compartir y la tarjeta la pinta su vista previa, que es la imagen
 *     Open Graph de la ficha (`opengraph-image.tsx`) = el banner que se ve aquí.
 *   · WhatsApp, las dos cosas: el enlace (con su vista previa banner) o la
 *     imagen cuadrada como archivo.
 *   · Instagram NO acepta publicar desde un enlace web (eso es solo para apps
 *     nativas). Se le da el ARCHIVO: en móvil por la hoja del sistema
 *     (`navigator.share({ files })`), donde aparece Instagram; en escritorio se
 *     descarga. El enlace se deja copiado antes, para el sticker de la historia.
 *
 * El enlace es la ficha con el `?ref=` del tutor (EY-225): lo resuelve el
 * servidor (`codigoParaCompartir`) y llega escrito en `ruta`.
 */

type Red = "whatsapp" | "facebook" | "x" | "linkedin" | "instagram";
type Formato = "banner" | "post" | "story";

const nuncaCambia = () => () => {};
const leerOrigin = () => window.location.origin;
const sinOrigin = () => "";
/** ¿La hoja del sistema acepta ARCHIVOS? (iOS/Android sí; casi ningún escritorio). */
const leerArchivos = () => {
  try {
    return (
      typeof navigator.canShare === "function" &&
      navigator.canShare({
        files: [new File([""], "x.png", { type: "image/png" })],
      })
    );
  } catch {
    return false;
  }
};
const noEnServidor = () => false;

const REDES: {
  id: Red;
  nombre: string;
  formatos: Formato[];
  color: string;
}[] = [
  {
    id: "whatsapp",
    nombre: "WhatsApp",
    formatos: ["banner", "post"],
    color: "bg-[#25D366]",
  },
  {
    id: "facebook",
    nombre: "Facebook",
    formatos: ["banner"],
    color: "bg-[#1877F2]",
  },
  { id: "x", nombre: "X", formatos: ["banner"], color: "bg-black" },
  {
    id: "linkedin",
    nombre: "LinkedIn",
    formatos: ["banner"],
    color: "bg-[#0A66C2]",
  },
  {
    id: "instagram",
    nombre: "Instagram",
    formatos: ["post", "story"],
    color:
      "bg-[linear-gradient(45deg,#f09433,#e6683c_25%,#dc2743_50%,#cc2366_75%,#bc1888)]",
  },
];

const NOMBRE_FORMATO: Record<Formato, string> = {
  banner: "Enlace",
  post: "Imagen 1:1",
  story: "Historia 9:16",
};

/** Íconos de marca en SVG propio: `lucide-react` ya no trae logos. */
function IconoRed({ red }: { red: Red }) {
  switch (red) {
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-6 fill-white">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-6 fill-white">
          <path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-5 fill-white">
          <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" aria-hidden className="size-5 fill-white">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452z" />
        </svg>
      );
    case "instagram":
      return (
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className="size-6 fill-none stroke-white"
          strokeWidth={2}
        >
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" className="fill-white" />
        </svg>
      );
  }
}

export function CompartirMentoriaDialog({
  open,
  onOpenChange,
  productId,
  ruta,
  titulo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  /** `/mentorias/<id>` con su `?ref=` si el tutor tiene código. */
  ruta: string;
  titulo: string;
}) {
  const [red, setRed] = useState<Red>("whatsapp");
  const [formato, setFormato] = useState<Formato>("banner");
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [cargada, setCargada] = useState<string | null>(null);
  const origin = useSyncExternalStore(nuncaCambia, leerOrigin, sinOrigin);
  const archivos = useSyncExternalStore(
    nuncaCambia,
    leerArchivos,
    noEnServidor,
  );

  const enlace = `${origin}${ruta}`;
  const mensaje = `Te invito a mi mentoría «${titulo}» en Enséñame Ya`;
  const imagen = `/api/compartir/mentoria/${productId}/promo?formato=${formato}`;
  const conRef = ruta.includes("ref=");
  const actual = REDES.find((r) => r.id === red)!;
  const esArchivo = formato !== "banner";

  /**
   * La imagen se baja ANTES del clic y se guarda: Safari de iOS exige que
   * `navigator.share` salga del gesto del usuario, y un `await fetch` de por
   * medio a veces le hace perder ese permiso (`NotAllowedError`). Con el
   * archivo ya en memoria, el clic comparte sin esperar a la red.
   */
  const ficheros = useRef(new Map<Formato, File>());
  useEffect(() => {
    if (!open || formato === "banner" || ficheros.current.has(formato)) return;
    let vivo = true;
    fetch(imagen)
      .then((r) =>
        r.ok ? r.blob() : Promise.reject(new Error(String(r.status))),
      )
      .then((b) => {
        if (vivo)
          ficheros.current.set(
            formato,
            new File([b], `ensenameya-mentoria-${formato}.png`, {
              type: "image/png",
            }),
          );
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [open, formato, imagen]);

  function elegirRed(r: (typeof REDES)[number]) {
    setRed(r.id);
    if (!r.formatos.includes(formato)) setFormato(r.formatos[0]!);
  }

  async function copiar(avisar = true) {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      if (avisar) toast.success("Enlace copiado");
      return true;
    } catch {
      if (avisar)
        toast.error("No se pudo copiar: cópialo a mano del recuadro.");
      return false;
    }
  }

  function abrir(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function descargar() {
    // `?descargar=1` la sirve como adjunto: funciona aunque el navegador
    // ignore el atributo `download`.
    const a = Object.assign(document.createElement("a"), {
      href: `${imagen}&descargar=1`,
      download: `ensenameya-mentoria-${formato}.png`,
    });
    a.click();
  }

  async function compartirArchivo() {
    setOcupado(true);
    try {
      // El enlace al portapapeles PRIMERO: la hoja del sistema se lleva el foco
      // y una imagen no es clicable, así que es lo que el tutor pegará en el
      // sticker de la historia o en el texto del post.
      const copio = await copiar(false);
      let f = ficheros.current.get(formato);
      if (!f) {
        const r = await fetch(imagen);
        if (!r.ok) throw new Error(String(r.status));
        f = new File([await r.blob()], `ensenameya-mentoria-${formato}.png`, {
          type: "image/png",
        });
        ficheros.current.set(formato, f);
      }
      if (archivos && navigator.canShare?.({ files: [f] })) {
        if (copio) toast.success("Enlace copiado: pégalo en tu publicación.");
        await navigator.share({ files: [f], text: `${mensaje}: ${enlace}` });
      } else {
        descargar();
        toast.success(
          red === "instagram"
            ? "Imagen descargada. Súbela a Instagram desde tu teléfono; el enlace quedó copiado."
            : "Imagen descargada. Adjúntala en WhatsApp; el enlace quedó copiado.",
        );
      }
    } catch (e) {
      // Cerrar la hoja de compartir no es un fallo (mismo criterio que `ShareButton`).
      if ((e as { name?: string } | null)?.name !== "AbortError") {
        toast.error("No se pudo preparar la imagen. Prueba con «Descargar».");
      }
    } finally {
      setOcupado(false);
    }
  }

  function accion() {
    if (esArchivo) return void compartirArchivo();
    const u = encodeURIComponent(enlace);
    switch (red) {
      case "whatsapp":
        return abrir(
          `https://wa.me/?text=${encodeURIComponent(`${mensaje}: ${enlace}`)}`,
        );
      case "facebook":
        // `sharer` ignora cualquier texto desde 2017: solo viaja la url.
        return abrir(`https://www.facebook.com/sharer/sharer.php?u=${u}`);
      case "x":
        return abrir(
          `https://x.com/intent/post?text=${encodeURIComponent(mensaje)}&url=${u}`,
        );
      case "linkedin":
        // LinkedIn tampoco acepta texto: el post lo escribe el tutor allí.
        return abrir(
          `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
        );
      case "instagram":
        return void compartirArchivo();
    }
  }

  const etiqueta = esArchivo
    ? archivos
      ? `Compartir en ${actual.nombre}`
      : "Descargar imagen"
    : red === "x"
      ? "Publicar en X"
      : `Abrir ${actual.nombre}`;

  const ayuda =
    red === "instagram"
      ? formato === "story"
        ? "Instagram no deja publicar desde una web: te damos la imagen y copiamos tu enlace. En la historia, agrega el sticker «Enlace» y pégalo."
        : "Instagram no deja publicar desde una web: te damos la imagen y copiamos tu enlace para que lo pongas en el texto o en tu bio."
      : esArchivo
        ? "Compartes la imagen y tu enlace va en el mensaje. Ideal para tu estado."
        : "Se abre la red con tu enlace. La vista previa mostrará esta imagen.";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setCopiado(false);
      }}
    >
      {/* `[&>*]:min-w-0`: `DialogContent` es una rejilla, y sin esto la URL
          ensancha la ventana más allá de la pantalla en móvil. */}
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[480px] [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Compartir mi mentoría</DialogTitle>
          <DialogDescription>
            Elige la red: preparamos la imagen en el formato que usa cada una.
          </DialogDescription>
        </DialogHeader>

        <div
          role="group"
          aria-label="Red social"
          // `-mx-2`: en 375 px cada columna gana 4 px y «WhatsApp» e
          // «Instagram» caben sin recortarse.
          className="-mx-2 grid grid-cols-5"
        >
          {REDES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={red === r.id}
              onClick={() => elegirRed(r)}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col items-center gap-1.5 rounded-[10px] py-2 text-[10.5px] tracking-tight sm:text-[11.5px] font-medium text-[#404040] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
                red === r.id
                  ? "bg-primary/10 text-[#19191f]"
                  : "hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-10 place-items-center rounded-full sm:size-11",
                  r.color,
                  red === r.id && "ring-2 ring-primary ring-offset-1",
                )}
              >
                <IconoRed red={r.id} />
              </span>
              <span className="max-w-full truncate">{r.nombre}</span>
            </button>
          ))}
        </div>

        {actual.formatos.length > 1 ? (
          <div
            role="group"
            aria-label="Formato de la imagen"
            className="grid grid-cols-2 gap-1 rounded-[10px] bg-muted p-1"
          >
            {actual.formatos.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={formato === f}
                onClick={() => setFormato(f)}
                className={cn(
                  "h-9 cursor-pointer rounded-[8px] text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  formato === f
                    ? "bg-card text-[#19191f] shadow-sm"
                    : "text-[#6b6b6b]",
                )}
              >
                {NOMBRE_FORMATO[f]}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG generado por nuestra ruta, sin optimizar */}
          <img
            key={imagen}
            src={imagen}
            onLoad={() => setCargada(imagen)}
            alt={`Vista previa de la imagen para ${actual.nombre}: ${titulo}`}
            className={cn(
              "rounded-[12px] bg-muted object-contain shadow-sm transition-opacity",
              cargada === imagen ? "opacity-100" : "animate-pulse opacity-60",
              formato === "banner" && "aspect-[1200/630] w-full",
              formato === "post" && "aspect-square h-[240px]",
              formato === "story" && "aspect-[9/16] h-[300px]",
            )}
          />
        </div>

        <p className="text-[12.5px] text-[#6b6b6b]">{ayuda}</p>

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Button
            className="h-11 font-semibold"
            onClick={accion}
            disabled={ocupado}
          >
            {ocupado ? "Preparando…" : etiqueta}
          </Button>
          <Button
            variant="outline"
            className="h-11 px-3.5"
            onClick={descargar}
            aria-label={`Descargar imagen (${NOMBRE_FORMATO[formato].toLowerCase()})`}
            title="Descargar imagen"
          >
            <DownloadIcon aria-hidden className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2 rounded-[10px] border border-[#e0e0e0] p-1.5 pl-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[#6b6b6b]">Tu enlace</p>
            <p className="truncate text-[13px] text-[#19191f]">{enlace}</p>
          </div>
          <Button
            variant="outline"
            className="h-9 shrink-0 gap-1.5"
            onClick={() => void copiar()}
          >
            {copiado ? (
              <CheckIcon aria-hidden className="size-4" />
            ) : (
              <CopyIcon aria-hidden className="size-4" />
            )}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>

        {conRef ? null : (
          <p className="text-[12px] text-[#6b6b6b]">
            ¿Quieres ganar cuando alguien se registre con tu enlace?{" "}
            <Link
              href="/referidos"
              className="font-medium text-primary underline underline-offset-2"
            >
              Activa tus invitaciones
            </Link>
            .
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
