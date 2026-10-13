/**
 * EY-222 · Recursos y plantillas para redes — lo que comparten la pantalla del
 * admin (`/admin/recursos`) y la del tutor (`/tutor/recursos`).
 *
 * La VISIBILIDAD no vive aquí: la impone la RLS de `social_resources` y del
 * bucket `social-resources` (`20261013140000`). Lo de este fichero es solo
 * vocabulario para pintar.
 */
import type { Database } from "@/lib/database.types";

export const BUCKET_RECURSOS = "social-resources";

export type Audiencia = Database["public"]["Enums"]["social_resource_audience"];

/** Cómo se le cuenta al admin cada audiencia. */
export const AUDIENCIAS: { value: Audiencia; label: string; hint: string }[] = [
  {
    value: "all",
    label: "Todos los tutores",
    hint: "También los que aún esperan aprobación. Nunca rechazados ni suspendidos.",
  },
  { value: "approved", label: "Solo tutores aprobados", hint: "Los que ya pueden publicar mentorías." },
  { value: "tiers", label: "Por nivel", hint: "Tutores aprobados de los niveles que marques." },
  { value: "tutors", label: "Tutores concretos", hint: "Solo los tutores que elijas de la lista." },
];

/** Sugerencias de categoría; el campo es libre (`social_resources.category`). */
export const CATEGORIAS_SUGERIDAS = ["Post", "Story", "Banner", "Guía", "Plantilla"];

/** TTL de las URL firmadas que llegan al navegador. */
export const TTL_RECURSO_SEGUNDOS = 600;

export const esImagen = (mime: string | null | undefined) =>
  Boolean(mime && mime.startsWith("image/"));

/**
 * El nombre del fichero reducido a lo que un `key` de Storage acepta. Delante
 * va un uuid, así que no tiene que ser único: solo legible. Misma receta que
 * `admin/payouts/payout-actions.tsx`.
 */
export function nombreSeguro(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+/, "")
      .slice(-60) || "recurso"
  );
}
