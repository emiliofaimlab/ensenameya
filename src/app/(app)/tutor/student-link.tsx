import Link from "next/link";

import { cn } from "@/lib/utils";
import { studentName, type StudentIdentity } from "./students";

/**
 * Nombre del alumno, enlazado a su ficha (N-14).
 *
 * El enlace se pinta SOLO si el alumno viene en el mapa de `studentsOfTutor`:
 * si no viene, el tutor tampoco podría abrir la ficha (la RPC le devolvería
 * vacío y la página respondería 404) y un enlace a un 404 es peor que texto
 * plano. Pasa de verdad: una reserva cancelada sigue en el listado pero ya no
 * da acceso al perfil.
 */
export function StudentLink({
  student,
  className,
}: {
  student?: StudentIdentity | null;
  className?: string;
}) {
  const name = studentName(student);
  if (!student) return <span className={className}>{name}</span>;

  return (
    <Link
      href={`/tutor/alumnos/${student.id}`}
      className={cn("transition-colors hover:text-brand hover:underline", className)}
    >
      {name}
    </Link>
  );
}
