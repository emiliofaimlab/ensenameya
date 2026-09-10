"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Share2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * G-07 · Compartir una ficha pública (perfil del tutor o mentoría).
 *
 * Es un botón-icono sin texto porque va pegado al nombre, al precio o al final
 * de una fila de chips: cualquier etiqueta visible le robaría el sitio a lo que
 * de verdad se está comparando. Por eso `label` es obligatorio y va a la vez a
 * `aria-label` y a `title`: sin él, quien navega con lector de pantalla —o quien
 * simplemente pasa el ratón— se encuentra un botón mudo.
 *
 * ── POR QUÉ ES CLIENTE Y NO UN ENLACE ───────────────────────────────────────
 * `navigator.share` abre la hoja nativa del sistema (WhatsApp, Telegram, correo),
 * que es como se comparte de verdad en el móvil, y solo existe en el navegador.
 * En escritorio casi nunca está, así que el destino real ahí es el portapapeles.
 * Ninguna de las dos vías necesita servidor: la URL es la de la propia página.
 *
 * ⚠️ CERRAR LA HOJA DE COMPARTIR NO ES UN FALLO. `navigator.share` rechaza con
 * `AbortError` cuando el usuario se arrepiente y la cierra; tratarlo como error
 * hace lo contrario de lo que pidió —copia el enlace y saca un «Enlace copiado»
 * que nadie pidió—. Solo los demás rechazos caen al portapapeles.
 *
 * ⚠️ `navigator.clipboard` SOLO EXISTE EN CONTEXTO SEGURO (https o localhost).
 * En un preview servido por IP, o en un navegador que lo bloquea, la promesa ni
 * siquiera llega a crearse. Ahí se avisa con el enlace a la vista para poder
 * copiarlo a mano, en vez de morir en silencio dejando creer que se copió.
 *
 * ── TAMAÑO Y COLOR LOS PONE QUIEN LLAMA ─────────────────────────────────────
 * El mismo botón sale a 46 px con borde blanco sobre el hero azul, a 30 px al
 * final de los chips de la mentoría y a 22 px en círculo junto al nombre en
 * móvil. Aquí vive solo la FORMA (G-09: caja cuadrada, radio 8, foco visible,
 * etiqueta accesible); el resto entra por `className` y `cn` lo compone, así que
 * `size-*`, `rounded-*`, colores e incluso el tamaño del icono
 * (`[&_svg]:size-3`) se pueden pisar desde fuera.
 */
export function ShareButton({
  label,
  title,
  text,
  className,
}: {
  /** Va a `aria-label` Y a `title`: «Compartir perfil» / «Compartir mentoría». */
  label: string;
  /** Título que verá la hoja nativa de compartir (no se pinta en la página). */
  title?: string;
  /** Texto de acompañamiento de la hoja nativa. */
  text?: string;
  className?: string;
}) {
  /**
   * La hoja nativa es modal pero el botón sigue debajo, y `navigator.share`
   * rechaza con `InvalidStateError` si ya hay una compartición en curso. Sin
   * este cerrojo, un segundo clic mientras la hoja está abierta se leería como
   * «falló, copia al portapapeles» y sacaría un toast por encima de la hoja.
   */
  const [compartiendo, setCompartiendo] = useState(false);

  async function copiarEnlace(url: string) {
    if (typeof navigator.clipboard?.writeText !== "function") {
      toast.error(`No se pudo copiar. Enlace: ${url}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Enlace copiado");
    } catch {
      // Permiso denegado o portapapeles ocupado: el enlace a la vista es lo
      // único que deja al usuario terminar la tarea por su cuenta.
      toast.error(`No se pudo copiar. Enlace: ${url}`);
    }
  }

  async function compartir() {
    if (compartiendo) return;

    // La URL canónica de esta ficha es la que el usuario está mirando; no se
    // reconstruye desde props para no compartir jamás algo distinto de lo que
    // hay en la barra de direcciones (filtros y anclas incluidos).
    const url = window.location.href;

    if (typeof navigator.share === "function") {
      setCompartiendo(true);
      try {
        await navigator.share({ title, text, url });
        // Compartido: ni portapapeles ni aviso. El sistema ya dio su respuesta.
        return;
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        // Cualquier otro rechazo (sin permiso, esquema no soportado) sí es un
        // fallo real y merece el plan B.
      } finally {
        setCompartiendo(false);
      }
    }

    await copiarEnlace(url);
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={compartiendo}
      onClick={() => void compartir()}
      className={cn(
        "inline-grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors outline-none",
        // El anillo de foco del tema es el azul de marca, y este botón vive
        // tanto sobre blanco como sobre el hero azul, donde ese anillo no se ve
        // (misma lección que `contact-tutor.tsx`). `ring-current` hereda el
        // color del icono, que por definición contrasta con su propio fondo.
        "focus-visible:ring-2 focus-visible:ring-current",
        "disabled:pointer-events-none disabled:opacity-60",
        "[&_svg]:size-[15px]",
        className,
      )}
    >
      <Share2Icon aria-hidden />
    </button>
  );
}
