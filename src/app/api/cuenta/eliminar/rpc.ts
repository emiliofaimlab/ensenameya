/**
 * Las formas que devuelven las dos RPC de la baja de cuenta.
 *
 * ⚠️ Los tipos generados dan `Returns: Json` para las dos, así que la forma
 * concreta vive aquí a mano: si la migración cambia lo que construyen, el
 * typecheck NO se entera. Este fichero es el contrato.
 */
/**
 * Lo que devuelve `account_deletion_blockers`: un objeto con SOLO las claves
 * que aplican (la función usa `jsonb_strip_nulls`), así que `{}` significa
 * «vía libre». Los importes van en la moneda del pago; hoy siempre USD.
 */
export type DeletionBlockers = {
  clases_futuras_como_tutor?: number;
  clases_futuras_como_alumno?: number;
  saldo_sin_liquidar?: number;
  payouts_en_curso?: number;
  reembolsos_pendientes?: number;
};

/**
 * Los cuatro buckets que la baja purga, en el mismo orden que el `in (…)` de
 * `anonymize_account` §3.1.
 *
 * ⚠️ `chat-attachments` NO está y no es un olvido: va por id de RESERVA, es el
 * hilo compartido con la otra persona y caduca solo a los 30 días. Ver la
 * trampa 5 de `20260826230000`.
 */
export const BUCKETS_DE_LA_BAJA = [
  "avatars",
  "kyc-documents",
  "tutor-materials",
  "product-images",
] as const;

export type BucketDeLaBaja = (typeof BUCKETS_DE_LA_BAJA)[number];

/**
 * Las rutas que quedan por borrar de Storage, agrupadas por bucket. Vienen así
 * —y no como una lista plana de `bucket/ruta`— porque la Storage API es por
 * bucket: cada clave es un `storage.from(<bucket>).remove([...])` directo.
 *
 * Un bucket sin ficheros no aparece como clave (el `jsonb_object_agg` del SQL
 * solo agrupa lo que existe), así que `{}` significa «nada que barrer».
 */
export type FicherosPorBucket = Partial<Record<BucketDeLaBaja, string[]>>;

/**
 * Lo que devuelve `anonymize_account`.
 *
 * ⚠️ `ficheros` es lo que TODAVÍA HAY QUE BORRAR, no lo ya borrado: desde
 * `20260827100000` el SQL no puede tocar `storage.objects` (error 42501) y solo
 * recolecta las rutas. Borrarlas es responsabilidad de quien llama.
 *
 * Las dos ramas llevan `ficheros` y `ficheros_recolectados` a propósito: en
 * `ya_anonimizada` son las que quedaron pendientes de un intento anterior, así
 * que el barrido se puede escribir una sola vez para las dos.
 */
export type AnonymizeResult =
  | {
      status: "ok";
      ficheros: FicherosPorBucket;
      ficheros_recolectados: number;
      roles: string[];
    }
  | {
      status: "ya_anonimizada";
      deleted_at: string;
      ficheros: FicherosPorBucket;
      ficheros_recolectados: number;
    };
