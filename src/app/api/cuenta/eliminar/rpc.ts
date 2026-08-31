/**
 * Las formas que devuelven las RPC de la baja de cuenta.
 *
 * ⚠️ Los tipos generados dan `Returns: Json` para todas, así que la forma
 * concreta vive aquí a mano: si la migración cambia lo que construyen, el
 * typecheck NO se entera. Este fichero es el contrato.
 */
/**
 * Lo que devuelve `account_deletion_blockers`: un objeto con SOLO las claves
 * que aplican, así que `{}` significa «vía libre». Los importes van en la
 * moneda del pago; hoy siempre USD.
 *
 * ⚠️ Desde `20260831160000` ninguna pantalla lee esto: la pantalla necesita
 * saber QUÉ TIPO de bloqueo es (ver `Accionables` / `EnEspera` más abajo) y
 * usa `account_deletion_state`. Esta forma es la del mapa PLANO que sigue
 * exigiendo `anonymize_account` por dentro —los dos grupos juntos y sin las
 * claves descriptivas—, y se conserva escrita porque ese contrato sigue vivo:
 * es lo que decide si una baja programada se puede completar.
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

// ══════════════════════════════════════════════════════════════════════════
// Baja PROGRAMADA (dinero en vuelo) — migración 20260831160000
// ══════════════════════════════════════════════════════════════════════════

/**
 * Los motivos que la persona tiene que resolver ELLA. Impiden pedir la baja:
 * nadie más los va a cerrar, y desactivar la cuenta esperándolos sería un
 * interbloqueo (un tutor no puede impartir las clases que le quedan si le
 * cerramos la puerta). Ver la cabecera de la migración.
 */
export type Accionables = {
  clases_futuras_como_tutor?: number;
  clases_futuras_como_alumno?: number;
};

/**
 * El dinero en vuelo. Esto NO impide la baja: la DESACTIVA y la programa, y
 * un job la completa cuando esta lista se queda vacía.
 *
 * ⚠️ `saldo_moneda` y `saldo_liquidable_desde` son DESCRIPTIVOS, no motivos:
 * solo existen para que la pantalla pueda decir cuánto y desde cuándo. La
 * función que decide (`account_deletion_blockers`) los quita del mapa a
 * propósito, para que un dato de pantalla no pueda bloquear una baja.
 */
export type EnEspera = {
  /** Unidades menores, como `payments.gross_amount`. */
  saldo_sin_liquidar?: number;
  /** Solo cuando todo el saldo va en una moneda; con varias no se suma (RN-13). */
  saldo_moneda?: string;
  /** ISO. Fin de la retención de 7 días del último pago liquidable (DP-02). */
  saldo_liquidable_desde?: string;
  payouts_en_curso?: number;
  reembolsos_pendientes?: number;
};

/** Lo que devuelve `my_account_deletion_state()`. */
export type EstadoBaja = {
  accionables: Accionables;
  en_espera: EnEspera;
  /** La baja pendiente, si la cuenta está desactivada esperando. */
  baja_programada: {
    requested_at: string;
    last_check_at: string | null;
    /** Último error del job. Casi siempre null; si no, hay algo que mirar. */
    last_error: string | null;
  } | null;
};

/** Lo que devuelve `request_account_deletion`. */
export type ResultadoPeticion =
  | { status: "ya_anonimizada" }
  /** Hay `accionables`: no se programa nada y se explica qué falta. */
  | { status: "bloqueada"; accionables: Accionables; en_espera: EnEspera }
  /** Nada en vuelo: la borra el handler AHORA, como siempre. */
  | { status: "sin_espera" }
  /** Cuenta desactivada y baja programada. */
  | { status: "programada"; en_espera: EnEspera }
  /** Ya lo estaba (doble clic, reintento por timeout). */
  | { status: "ya_programada"; en_espera: EnEspera };

/** Una fila de `account_deletions_pendientes_de_barrido()`. */
export type PendienteDeBarrido = {
  user_id: string;
  ficheros: FicherosPorBucket;
  ficheros_recolectados: number;
};

/**
 * Puerta estrecha a las RPC que `database.types.ts` todavía no conoce.
 *
 * ⚠️ Los tipos generados se regeneran con `npm run db:types` DESPUÉS de aplicar
 * la migración, y ese archivo no se toca a mano (regla de oro 6). Hasta
 * entonces `supabase.rpc("request_account_deletion")` NI COMPILA: el nombre
 * está tipado contra la unión de funciones conocidas, así que una función nueva
 * es un error de TIPOS, no de ejecución.
 *
 * Es la misma puerta que `src/components/chat/rpc.ts` abrió para M-12, y por el
 * mismo motivo se declara en UN solo sitio por carpeta: el día que se regeneren
 * los tipos hay que borrar dos bloques, no doce `as unknown as` sueltos.
 */
type LlamadorRpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

/** Envuelve cualquier cliente de Supabase para llamar a las RPC nuevas. */
export async function rpcNueva<T>(
  cliente: unknown,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string; code?: string } | null }> {
  const { data, error } = await (cliente as LlamadorRpc).rpc(fn, args);
  return { data: (data ?? null) as T | null, error };
}
