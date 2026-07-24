import { cn } from "@/lib/utils";

export function Section({ className, ...props }: React.ComponentProps<"section">) {
  // 64px de aire arriba/abajo en desktop, como las secciones del Figma.
  return <section className={cn("py-10 sm:py-16", className)} {...props} />;
}
