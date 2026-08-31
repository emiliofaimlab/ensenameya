import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { BucketDeLaBaja, FicherosPorBucket } from "./rpc";

/**
 * El barrido de Storage de la baja de cuenta, en un módulo aparte porque lo
 * comparten DOS rutas:
 *
 *   · `POST /api/cuenta/eliminar`          — la baja inmediata, que barre lo
 *     suyo justo después de anonimizar;
 *   · `POST /api/cuenta/eliminar/barrido`  — el repaso, que recoge lo que dejó
 *     pendiente la baja PROGRAMADA (la completa un pg_cron, y dentro de la base
 *     de datos no hay forma de llamar a la Storage API).
 *
 * ⚠️ Vive fuera de `route.ts` por una razón de Next, no de gusto: un fichero de
 * ruta solo puede exportar los verbos HTTP y la configuración del segmento.
 * Exportar helpers desde ahí no es un error de ejecución — el build falla.
 *
 * ── POR QUÉ EL SQL NO HACE ESTO ────────────────────────────────────────────
 * Supabase prohíbe `delete from storage.objects` («Direct deletion from storage
 * tables is not allowed. Use the Storage API instead.», 42501), así que
 * `anonymize_account` solo RECOLECTA las rutas y las devuelve. Todo el porqué
 * está en la cabecera de `20260827100000`.
 */

type Admin = ReturnType<typeof createAdminClient>;

/**
 * `remove()` manda las rutas en el cuerpo de una sola petición. Un tutor con
 * cientos de materiales la haría enorme y se comería un 413 —que además
 * contaría como fallo de TODO el bucket—, así que se trocea.
 */
const TAMANO_LOTE = 100;

/**
 * Barre de Storage los ficheros que `anonymize_account` recolectó.
 *
 * ⚠️ SE LLAMA CON LA ANONIMIZACIÓN YA CONFIRMADA EN BASE DE DATOS, y de ahí
 * salen las dos reglas de esta función:
 *
 *  1 · NO LANZA. Un fallo aquí no puede convertirse en un 500. La identidad ya
 *      está borrada y la cuenta cerrada, que es lo que la persona pidió y lo
 *      que hay que cumplir; un fichero huérfano es un problema menor y, sobre
 *      todo, recuperable a mano. Devolver «no se pudo eliminar tu cuenta»
 *      cuando SÍ se eliminó sería mentir sobre lo único que le importa, y la
 *      empujaría a reintentar o a escribir a soporte por algo ya hecho.
 *  2 · PERO NO SE CALLA. El fallo se registra con las RUTAS CONCRETAS, que es
 *      lo que hace falta para barrerlas desde el panel de Storage, y lo que
 *      quede pendiente se devuelve para anotarlo en el rastro.
 *
 * Un `remove()` sobre una ruta que ya no existe no es error —Storage lo da por
 * bueno—, así que reintentar es seguro y no hay que llevar la cuenta de cuáles
 * se borraron en un intento anterior.
 */
export async function barrerFicheros(
  admin: Admin,
  userId: string,
  ficheros: FicherosPorBucket,
): Promise<{ barridos: number; pendientes: FicherosPorBucket }> {
  const pendientes: FicherosPorBucket = {};
  let barridos = 0;

  for (const [bucket, rutas] of Object.entries(ficheros) as [
    BucketDeLaBaja,
    string[] | undefined,
  ][]) {
    if (!rutas?.length) continue;
    const fallidas: string[] = [];

    for (let i = 0; i < rutas.length; i += TAMANO_LOTE) {
      const lote = rutas.slice(i, i + TAMANO_LOTE);
      // El try/catch es por la red: `remove()` devuelve `error` en los fallos
      // de la API, pero un fetch caído sí lanza. Los dos acaban igual.
      try {
        const { error } = await admin.storage.from(bucket).remove(lote);
        if (error) throw error;
        barridos += lote.length;
      } catch (e) {
        fallidas.push(...lote);
        console.error(
          "[EY-192] la cuenta SÍ se anonimizó, pero estos ficheros siguen en Storage:",
          e instanceof Error ? e.message : e,
          { user_id: userId, bucket, rutas: lote },
        );
      }
    }

    if (fallidas.length > 0) pendientes[bucket] = fallidas;
  }

  return { barridos, pendientes };
}

/**
 * Deja en el rastro qué se barrió y qué no.
 *
 * ⚠️ Solo puede escribir `summary`: el grant de `20260827100000` es por columna
 * (`grant update (summary) … to service_role`) justamente para que `deleted_at`
 * y `roles` —que son EL rastro— no se puedan reescribir desde aquí.
 *
 * `ficheros_recolectados` se reenvía tal cual, sin recalcularlo: es el número
 * de auditoría del momento de la baja y no se toca nunca.
 *
 * ⚠️ Y por eso `ficheros_barridos` se deriva de él y NO del contador del bucle.
 * En un reintento el bucle solo ve lo que quedaba pendiente, así que su cuenta
 * sería la de ESTA pasada; lo que hay que dejar escrito es el acumulado.
 */
export async function anotarBarrido(
  admin: Admin,
  userId: string,
  recolectados: number,
  pendientes: FicherosPorBucket,
) {
  const quedan = Object.values(pendientes).flat().length;

  const { error } = await admin
    .from("account_deletions")
    .update({
      summary: {
        ficheros: pendientes,
        ficheros_recolectados: recolectados,
        ficheros_barridos: Math.max(0, recolectados - quedan),
      },
    })
    .eq("user_id", userId);

  if (error) {
    // Tampoco es motivo de 500: como mucho el rastro se queda diciendo que hay
    // pendientes que ya no lo están, y un reintento los volvería a barrer sin
    // consecuencias. El log de `barrerFicheros` sigue siendo la vía buena.
    console.error("[EY-192] no se pudo anotar el barrido en el rastro:", error.message, {
      user_id: userId,
      code: error.code,
    });
  }
}
