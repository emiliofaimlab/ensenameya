/**
 * EY-221 · Qué material se puede PRESENTAR en la sala.
 *
 * Decidido con el cliente: por ahora, solo PDF. Los Word/PowerPoint/Excel que
 * acepta `tutor-materials` (`MATERIAL_TYPES` en `components/tutor/upload-formats.ts`)
 * salen en la lista pero deshabilitados, con `MOTIVO_NO_PRESENTABLE`.
 *
 * ⚠️ PUNTO DE EXTENSIÓN. Si un día se convierten Office → PDF (al subir, o al
 * vuelo en un Route Handler), el cambio es aquí y en
 * `app/api/room/[sessionId]/materiales/[materialId]/route.ts`, que hoy firma el
 * fichero tal cual: que devuelva la URL del PDF convertido y que esta función
 * diga `true` para esas extensiones. El visor no sabe ni le importa de dónde
 * sale el PDF.
 *
 * Se decide por EXTENSIÓN porque `tutor_materials` no guarda el MIME, y el
 * bucket ya filtró por MIME al subir (`allowed_mime_types`). No es una barrera:
 * si alguien renombrara un .docx a .pdf, `pdfjs` fallaría al abrirlo y el visor
 * lo dice.
 */
const PRESENTABLES = [".pdf"];

export function esPresentable(nombre: string): boolean {
  const n = nombre.toLowerCase();
  return PRESENTABLES.some((ext) => n.endsWith(ext));
}

export const MOTIVO_NO_PRESENTABLE = "Para presentarlo, súbelo en PDF";
