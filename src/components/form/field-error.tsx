import { cn } from "@/lib/utils";

/**
 * RV-14 · Mensaje de error de un campo, en español y atado al campo.
 *
 * Va con `role="alert"` para que el lector de pantalla lo anuncie en cuanto
 * aparece, y con un `id` que el input referencia desde `aria-describedby`
 * (helper `describedBy` en `./validation`) para que también se lea al volver a
 * enfocar el campo. Sin el `id` atado, el error se ve pero no se oye.
 *
 * No se renderiza nada cuando no hay error: un contenedor vacío permanente
 * dejaría hueco en blanco y algunos lectores lo anuncian igual.
 */
export function FieldError({
  id,
  message,
  className,
}: {
  id: string;
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className={cn("text-[13px] font-medium text-destructive", className)}
    >
      {message}
    </p>
  );
}
