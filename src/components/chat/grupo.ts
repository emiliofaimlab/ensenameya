/**
 * Lote 3 (M31) · Quién está dentro del chat de una clase grupal, en la forma
 * que pintan el hilo, la burbuja, `/chat/[id]` y la descarga.
 *
 * Módulo NEUTRO, igual que `types.ts`: sin `server-only` y sin imports, porque
 * lo llaman tanto la página (servidor) como la burbuja (cliente) con la misma
 * fila de `inscritos_de_clase`. Traducirla en dos sitios es lo que dejó a la
 * tutora firmando «Participante» en uno y con nombre en otro.
 */

/** Un miembro del grupo: el tutor o un inscrito con reserva pagada. */
export type MiembroGrupo = {
  userId: string;
  nombre: string;
  avatarPath: string | null;
  esTutor: boolean;
};

/** Lo que `ChatThread` necesita para firmar cada mensaje en modo grupal. */
export type GrupalChat = {
  /** `user_id` → nombre. Quien no está aquí ya no es miembro del grupo. */
  nombres: Record<string, string>;
  miembros: MiembroGrupo[];
};

/**
 * Filas de `inscritos_de_clase` → `GrupalChat`.
 *
 * Nombre vacío → «Participante»: `full_name` es nulo en un alta con Google que
 * nunca lo completó, y una firma en blanco se lee como un fallo.
 */
export function grupalDe(
  rows:
    | {
        user_id: string;
        nombre: string | null;
        avatar_path: string | null;
        es_tutor: boolean;
      }[]
    | null
    | undefined,
): GrupalChat {
  const miembros: MiembroGrupo[] = (rows ?? []).map((r) => ({
    userId: r.user_id,
    nombre: r.nombre?.trim() || "Participante",
    avatarPath: r.avatar_path,
    esTutor: r.es_tutor,
  }));
  return {
    nombres: Object.fromEntries(miembros.map((m) => [m.userId, m.nombre])),
    miembros,
  };
}
