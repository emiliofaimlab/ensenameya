/**
 * N-07 · Formatos y topes de los archivos del formulario de mentoría, en UN
 * sitio: el `accept` del input y la frase que lee el tutor salen de aquí.
 *
 * Estaban separados —la lista en el `accept`, el texto escrito a mano al lado—
 * y pasó lo que tenía que pasar: se tocó uno sin el otro y el formulario
 * prometía formatos que el bucket rechazaba. Si añades un tipo, añádelo a la
 * lista y la frase se actualiza sola.
 *
 * ⚠️ Quien manda de verdad es el bucket: Storage devuelve 400 si el MIME no
 * está en su `allowed_mime_types` o si el archivo pasa de `file_size_limit`.
 * Esto es la copia CLIENTE de lo que declaran las migraciones
 * `20260723120000` (product-images: 5 MB · png/jpeg/webp) y `20260722160000`
 * (tutor-materials: 10 MB · PDF + Office). Cambiar una sin la otra devuelve el
 * error a su forma original: solo se descubre fallando.
 *
 * ponytail: fuera de este carril quedan más copias de listas parecidas
 * (`lib/chat/attachments.ts`, `components/onboarding/avatar-upload.tsx` y
 * `.../materials-upload.tsx`, `tutor/verification/verification-form.tsx`). Son
 * otros buckets, pero piden el mismo tratamiento cuando se toquen.
 */

/** Portada de la mentoría → bucket público `product-images`. */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const PRODUCT_IMAGE_HINT = "JPG, PNG o WebP · máx. 5 MB";

/** Materiales de la mentoría → bucket privado `tutor-materials`. */
export const MATERIAL_MAX_BYTES = 10 * 1024 * 1024;
export const MATERIAL_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/msword",
  "application/vnd.ms-excel",
];
export const MATERIAL_HINT =
  "PDF, Word, PowerPoint o Excel · máx. 10 MB por archivo";

/** Tamaño legible. Mismo formato que los adjuntos del chat. */
export const humanSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

/**
 * Motivo por el que un archivo NO vale, o `null` si vale. Se comprueba al
 * elegirlo, no al guardar: descubrir el tope después de rellenar el formulario
 * entero es exactamente lo que reporta N-07.
 *
 * El mensaje repite la regla completa en vez de decir "formato no admitido":
 * quien acaba de equivocarse necesita saber qué SÍ puede subir.
 */
export function fileProblem(
  file: File,
  spec: { types: string[]; maxBytes: number; hint: string },
): string | null {
  if (!spec.types.includes(file.type)) {
    return `«${file.name}»: ese formato no se admite. Acepta ${spec.hint}.`;
  }
  if (file.size > spec.maxBytes) {
    return `«${file.name}» pesa ${humanSize(file.size)}. El máximo es ${humanSize(spec.maxBytes)}.`;
  }
  return null;
}
