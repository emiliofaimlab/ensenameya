import {
  SUPPORT_DOC_HINT,
  SUPPORT_DOC_TYPES,
  SUPPORT_MAX_BYTES,
  SUPPORT_SHOT_HINT,
  SUPPORT_SHOT_TYPES,
} from "@/components/tutor/upload-formats";

/**
 * DL-01 · los tipos de solicitud del formulario de contacto, en UN sitio.
 *
 * Petición del cliente (28-ago): «habilitar tipos de solicitud (mensaje, subida
 * de documentos o capturas)». El tipo no es decoración: decide **si el
 * formulario enseña el selector de ficheros y qué acepta**, y esa decisión la
 * toman tres sitios —el `<select>`, el `accept` del input y la validación del
 * Route Handler—. Con la tabla escrita tres veces, el día que se añada un tipo
 * el servidor rechazaría lo que el formulario ofrece; por eso vive aquí y la
 * importan los tres.
 *
 * Vive en `lib/` y no en `components/contact/` justamente por eso: lo consume
 * también `src/app/api/contacto/`, que es servidor. No tiene `server-only` ni
 * `use client` a propósito — es una tabla de constantes que valen en los dos
 * lados.
 *
 * ⚠️ El enum de la BD (`public.contact_request_kind`, `20260828161500`) tiene
 * exactamente estos tres valores. Añadir uno aquí sin la migración hace que el
 * insert reviente en ejecución con `invalid input value for enum`.
 */
export const CONTACT_KINDS = ["mensaje", "documentos", "capturas"] as const;

export type ContactKind = (typeof CONTACT_KINDS)[number];

export type ContactKindSpec = {
  /** Lo que se lee en el `<option>`. */
  label: string;
  /** Una línea bajo el selector, para que se entienda qué cambia al elegirlo. */
  help: string;
  /**
   * MIME admitidos, o `null` si este tipo no lleva ficheros. Es la lista que
   * usan el `accept` del input **y** el servidor antes de firmar la subida.
   */
  types: string[] | null;
  /** La frase que repite la regla completa cuando algo no vale. */
  hint: string | null;
};

/**
 * ⚠️ `mensaje` es el DEFAULT, y también el valor con el que quedaron las filas
 * que ya existían en `contact_messages`. Sin ficheros: el comportamiento del
 * formulario de siempre, que es el que dLocal validó a mano.
 */
export const CONTACT_KIND_SPECS: Record<ContactKind, ContactKindSpec> = {
  mensaje: {
    label: "Mensaje",
    help: "Cuéntanos qué ha pasado y te respondemos por correo.",
    types: null,
    hint: null,
  },
  documentos: {
    label: "Subir documentos",
    help: "Para facturas, comprobantes o cualquier documento que necesitemos ver.",
    types: SUPPORT_DOC_TYPES,
    hint: SUPPORT_DOC_HINT,
  },
  capturas: {
    label: "Capturas de pantalla",
    help: "Para enseñarnos el error tal y como te aparece a ti.",
    types: SUPPORT_SHOT_TYPES,
    hint: SUPPORT_SHOT_HINT,
  },
};

/**
 * Cuántos ficheros admite una solicitud. Tope bajo a propósito: quien reporta
 * un error manda dos o tres capturas, y el número es también el único freno
 * real que tiene el endpoint de subida (ver `api/contacto/adjuntos`).
 */
export const MAX_ADJUNTOS = 5;

/** Tope por fichero, re-exportado para no arrastrar dos imports en cada sitio. */
export { SUPPORT_MAX_BYTES };

/** Estrecha un valor que viene del navegador a uno de los tres tipos. */
export function esContactKind(v: unknown): v is ContactKind {
  return typeof v === "string" && (CONTACT_KINDS as readonly string[]).includes(v);
}

/** El bucket de los adjuntos de soporte. Escrito una vez, leído en tres. */
export const SUPPORT_BUCKET = "support-attachments";
