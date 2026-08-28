/**
 * MN-11a · Formatos y topes de subida del CLIENTE, en UN sitio: los seis
 * buckets que toca el navegador declaran aquí qué aceptan, cuánto pesa como
 * máximo y con qué frase se le cuenta al usuario.
 *
 * Nació para el formulario de mentoría (N-07) —de ahí que viva en
 * `components/tutor/`—: la lista estaba en el `accept` del input y el texto
 * escrito a mano al lado, se tocó uno sin el otro y el formulario prometía
 * formatos que el bucket rechazaba. Las demás pantallas repetían el mismo
 * patrón por su cuenta: seis declaraciones del tope y siete literales del
 * tope escritos a mano. Ahora todas importan de aquí, y las frases se
 * generan del número en vez de escribirse. Añadir un tipo o cambiar un
 * tope es una línea de este fichero.
 *
 * ⚠️ Quien manda de verdad es el bucket. La subida va del navegador a Storage
 * con la clave anon, sin pasar por nuestro servidor, así que Storage es el
 * ÚNICO sitio donde el límite se aplica: 400 si el MIME no está en
 * `allowed_mime_types`, 413 si pasa de `file_size_limit`. Lo de aquí es la
 * copia cliente, y solo sirve para dar un mensaje decente en vez de un error
 * crudo. Nunca es la barrera.
 *
 * (La excepción es `support-attachments`: ahí la subida va con una URL firmada
 * que emite `POST /api/contacto/adjuntos`, así que el servidor SÍ valida antes.
 * El bucket sigue siendo el último filtro, y estas constantes siguen siendo la
 * copia — solo que allí la comparte el handler.)
 *
 * ⚠️⚠️ SI VIENES A CAMBIAR UN NÚMERO, LEE ESTO ANTES.
 * Tocar solo la constante hace que la UI mienta al revés: promete el tope
 * nuevo y Storage sigue cortando por el viejo, con un error que ya no
 * explicamos. El cambio de verdad es una migración NUEVA con
 *     update storage.buckets set file_size_limit = … where id = '<bucket>';
 * y **NO** el patrón de las migraciones que crearon los buckets: todos son
 * `insert into storage.buckets … on conflict (id) do nothing`, y sobre un
 * bucket que ya existe eso es un NO-OP SILENCIOSO — `db:push` en verde,
 * `typecheck` en verde, y el bucket exactamente igual que estaba. Solo se
 * descubre subiendo un archivo grande.
 *
 * Eso ya tiene precedente que copiar: `20260820170000_chat_attachments_25mb.sql`
 * (MN-11b / P-8, el 10 → 25 MB del chat), que además cierra el `update` con un
 * `do $$ … raise exception` verificando el valor, para que el no-op no pueda
 * volver a pasar callado.
 *
 * ⚠️ Y hay un techo por encima del bucket: el límite GLOBAL del proyecto
 * (panel de Supabase → Storage → Settings) acota a cualquier bucket, no se ve
 * desde el repo y no se toca con SQL. Si algún tope de aquí lo supera, la
 * migración pasa en verde y las subidas siguen fallando. El 20-ago aceptaba
 * 24,5 MB sin rechistar, así que hasta 25 MB hay sitio; por encima, mirar el
 * panel ANTES de escribir la migración.
 *
 * Espejo de lo que declaran las migraciones, para contrastar sin salir de aquí:
 *   `avatars`           5 MB · `20260722160000`
 *   `product-images`    5 MB · `20260723120000`
 *   `tutor-materials`  10 MB · `20260722160000`
 *   `chat-attachments` 25 MB · `20260722180000` → `20260820170000` (MN-11b)
 *   `kyc-documents`    10 MB · `20260706150000`
 *   `support-attachments` 25 MB · `20260828161500` (DL-01, adjuntos de contacto)
 */

const MB = 1024 * 1024;

/** PDF, que lo aceptan cinco de los seis buckets. */
const PDF = "application/pdf";

/**
 * Imágenes. Hoy los tres buckets que las admiten declaran la misma lista
 * (`avatars`, `product-images` y —con PDF al lado— `kyc-documents`), así que
 * comparten esta. Si mañana uno diverge, se separa aquí y ya.
 */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Word, PowerPoint y Excel: los de ahora y los de antes de 2007. Los repiten
 * igual `tutor-materials` y `chat-attachments`.
 */
const OFFICE_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.ms-excel",
];

/** Tamaño legible de un archivo concreto: «3.4 MB», «812 KB». */
export const humanSize = (b: number) =>
  b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

/**
 * El tope, tal y como se escribe en una frase: «máx. 10 MB». Va aparte de
 * `humanSize` porque los topes son megas redondos y «máx. 10.0 MB» se lee a
 * trompicones; si algún día el tope es 7.5 MB, el decimal vuelve solo.
 */
export const maxLabel = (b: number) => `${+(b / MB).toFixed(1)} MB`;

/* ── Foto de perfil → bucket público `avatars` ────────────────────────────── */
export const AVATAR_MAX_BYTES = 5 * MB;
export const AVATAR_TYPES = IMAGE_TYPES;
export const AVATAR_HINT = `JPG, PNG o WebP · máx. ${maxLabel(AVATAR_MAX_BYTES)}`;

/* ── Portada de la mentoría → bucket público `product-images` ─────────────── */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * MB;
export const PRODUCT_IMAGE_TYPES = IMAGE_TYPES;
export const PRODUCT_IMAGE_HINT =
  `JPG, PNG o WebP · máx. ${maxLabel(PRODUCT_IMAGE_MAX_BYTES)}`;

/* ── Materiales de la mentoría → bucket privado `tutor-materials` ─────────── */
export const MATERIAL_MAX_BYTES = 10 * MB;
export const MATERIAL_TYPES = [PDF, ...OFFICE_TYPES];
export const MATERIAL_HINT =
  `PDF, Word, PowerPoint o Excel · máx. ${maxLabel(MATERIAL_MAX_BYTES)} por archivo`;

/* ── Adjuntos del chat → bucket privado `chat-attachments` ────────────────── */
export const ATTACHMENT_MAX_BYTES = 25 * MB;
export const ATTACHMENT_TYPES = [PDF, ...IMAGE_TYPES, ...OFFICE_TYPES];
export const ATTACHMENT_HINT =
  `PDF, imagen o documento de Office · máx. ${maxLabel(ATTACHMENT_MAX_BYTES)}`;

/* ── Adjuntos de soporte → bucket privado `support-attachments` (DL-01) ───── */
/**
 * El formulario de `/contacto` acepta documentos o capturas según el tipo de
 * solicitud, así que aquí hay DOS listas y no una: el `accept` del input y la
 * validación del servidor cambian con el tipo elegido, y ofrecer un .docx a
 * quien ha dicho «capturas de pantalla» es prometer algo que luego se rechaza.
 * La correspondencia tipo → lista vive en `src/lib/contact/request-kinds.ts`.
 *
 * El tope es el del chat —25 MB, MN-11b— y por la misma razón: es el mismo
 * material (un PDF, una captura) subido por la misma gente y con la misma
 * línea. Lo declara `20260828161500`, y ahí es donde hay que tocarlo.
 *
 * ⚠️ `SUPPORT_TYPES` tiene que ser exactamente lo que el bucket lista en
 * `allowed_mime_types`: es lo que el servidor usa como último filtro antes de
 * firmar la subida, y si aquí sobra un tipo el rechazo llega de Storage con un
 * 400 crudo en vez de con una frase.
 */
export const SUPPORT_MAX_BYTES = 25 * MB;
export const SUPPORT_DOC_TYPES = [PDF, ...OFFICE_TYPES];
export const SUPPORT_SHOT_TYPES = IMAGE_TYPES;
export const SUPPORT_TYPES = [...SUPPORT_DOC_TYPES, ...SUPPORT_SHOT_TYPES];
export const SUPPORT_DOC_HINT =
  `PDF, Word, PowerPoint o Excel · máx. ${maxLabel(SUPPORT_MAX_BYTES)} por archivo`;
export const SUPPORT_SHOT_HINT =
  `PNG, JPG o WebP · máx. ${maxLabel(SUPPORT_MAX_BYTES)} por captura`;

/* ── Documentos de verificación → bucket privado `kyc-documents` (S-42) ───── */
export const KYC_MAX_BYTES = 10 * MB;
export const KYC_TYPES = [...IMAGE_TYPES, PDF];
export const KYC_HINT = `PNG, JPG, WebP o PDF · máx. ${maxLabel(KYC_MAX_BYTES)}`;

/**
 * Motivo por el que un archivo NO vale, o `null` si vale. Se comprueba al
 * elegirlo, no al guardar: descubrir el tope después de rellenar el formulario
 * entero es exactamente lo que reporta N-07.
 *
 * El mensaje repite la regla completa en vez de decir "formato no admitido":
 * quien acaba de equivocarse necesita saber qué SÍ puede subir. Y el tope sale
 * del `spec`, nunca escrito en el texto: es la mitad de MN-11a.
 */
export function fileProblem(
  file: File,
  spec: { types: string[]; maxBytes: number; hint: string },
): string | null {
  if (!spec.types.includes(file.type)) {
    return `«${file.name}»: ese formato no se admite. Acepta ${spec.hint}.`;
  }
  if (file.size > spec.maxBytes) {
    return `«${file.name}» pesa ${humanSize(file.size)}. El máximo es ${maxLabel(spec.maxBytes)}.`;
  }
  return null;
}
