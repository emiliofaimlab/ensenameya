import { cn } from "@/lib/utils";

export function Section({ className, ...props }: React.ComponentProps<"section">) {
  // 64px de aire arriba/abajo en desktop, como las secciones del Figma.
  //
  // US-1601 · en móvil sobraba aire. Las bandas de contenido del Figma nuevo
  // llevan 28-32 a 390 (en «P01 — Home — Mobile» hay siete bandas a pad28 y
  // tres a pad32) y 32-48 a 768 (en «P01 — Home — Tablet», seis a 32, tres a 40
  // y dos a 48). Así que la base baja a 32 (`py-8`) y la banda de tablet se
  // queda en 40 (`py-10`), que es el segundo valor más repetido a 768.
  //
  // ⚠️ El tramo de tablet va como `md:max-lg:` a propósito, y NO como el par
  // habitual `md:py-10 lg:py-16`. `cn()` es tailwind-merge, y hay páginas que
  // pasan su propio ritmo: `carrito/page.tsx` y `pedidos/[id]/confirmacion`
  // mandan `py-8 sm:py-10`. Ese `sm:py-10` se lleva por delante nuestro
  // `sm:py-16`… pero un `lg:py-16` nuestro sobreviviría al merge y les subiría
  // el escritorio de 40 a 64 sin que lo cante el typecheck ni el lint. Acotando
  // la regla a 768-1023 no queda NADA nuestro por encima de 1024: a partir de
  // ahí manda `sm:py-16` exactamente igual que antes de tocar este fichero.
  //
  // 640-767 se queda también como estaba (64): es la banda sin ningún frame en
  // el archivo, y lo que no está diseñado no se mueve.
  return (
    <section
      className={cn("py-8 sm:py-16 md:max-lg:py-10", className)}
      {...props}
    />
  );
}
