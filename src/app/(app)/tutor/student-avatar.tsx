import Image from "next/image";

import { cn } from "@/lib/utils";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import { studentName, type StudentIdentity } from "./students";

/**
 * Foto del alumno, con iniciales de respaldo (el mismo patrón que la ficha
 * pública del tutor). El bucket `avatars` ya era público desde
 * `20260722160000`, así que aquí no se abre nada nuevo: lo que la RPC
 * `tutor_students` añade es saber CUÁL es la ruta del alumno.
 *
 * `unoptimized` como en el resto del catálogo: el optimizador de Next no
 * aporta sobre un objeto de Storage que ya viene dimensionado.
 */
export function StudentAvatar({
  student,
  size = 44,
  className,
}: {
  student?: StudentIdentity | null;
  size?: number;
  className?: string;
}) {
  const name = studentName(student);
  const url = storageUrl("avatars", student?.avatarPath);

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#e5f2ff] text-sm font-semibold text-brand",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {url ? (
        <Image
          src={url}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
          unoptimized
        />
      ) : (
        initialsFrom(name)
      )}
    </span>
  );
}
