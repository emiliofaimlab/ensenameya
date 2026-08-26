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

/** Lo que devuelve `anonymize_account`. */
export type AnonymizeResult =
  | { status: "ok"; ficheros_borrados: number; roles: string[] }
  | { status: "ya_anonimizada"; deleted_at: string };
