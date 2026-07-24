import { cn } from "@/lib/utils";

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      // Rejilla del Figma: a 1280px el gutter de 64 deja 1152 de contenido,
      // idéntico al diseño. En pantallas más anchas el contenido crece hasta
      // 1536 (cap 1664 − 128 de gutter) y luego se centra, para que no se vea
      // "encajonado" en monitores grandes (R24-01, fluido hasta 1536).
      className={cn("mx-auto w-full max-w-[1664px] px-4 sm:px-6 lg:px-16", className)}
      {...props}
    />
  );
}
