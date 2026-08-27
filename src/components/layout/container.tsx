import { cn } from "@/lib/utils";

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // Rejilla del Figma: a 1280px el gutter de 64 deja 1152 de contenido,
      // idéntico al diseño. En pantallas más anchas el contenido crece hasta
      // 1536 (cap 1664 − 128 de gutter) y luego se centra, para que no se vea
      // "encajonado" en monitores grandes (R24-01, fluido hasta 1536).
      //
      // US-1601 · el Figma «Mobile y Tablet» fija por primera vez los dos anchos
      // de abajo, y los dos estaban mal: pedía 20px a 390 (dábamos 16) y 32px a
      // 768 (dábamos 24). No son los números de una pantalla suelta, salen de
      // contar los 115 frames: 2.053 nodos apoyados en x=20 a 390 y 716 en x=32
      // a 768, con anchos de contenido de 350 (=390−40) y 704 (=768−64) que se
      // repiten en 635 y 260 frames — los dos más frecuentes de cada archivo.
      // De ahí `px-5` (20) y `md:px-8` (32): md: es 768 clavado, que es el ancho
      // que Diana diseñó.
      //
      // ⚠️ `sm:px-6` se queda a propósito, aunque el Figma no lo pida. Cubre
      // 640-767, la banda de la que NO hay ni un frame en el archivo: dejarla en
      // los 24px de hoy es no mover lo que nadie ha diseñado. Y `lg:px-16` sigue
      // mandando desde 1024, así que el escritorio publicado en EP-22 (IV-01…06,
      // en producción desde el 2026-07-22) no se mueve ni un píxel.
      className={cn(
        "mx-auto w-full max-w-[1664px] px-5 sm:px-6 md:px-8 lg:px-16",
        className,
      )}
      {...props}
    />
  );
}
