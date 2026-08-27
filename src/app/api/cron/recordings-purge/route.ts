import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  RECORDING_DAYS,
  deleteRecording,
  isDailyConfigured,
  listRecordings,
} from "@/lib/daily";

/**
 * RN-42 · borrado real de las grabaciones al cumplirse la retención.
 *
 * Cierra el hueco que la política de privacidad declara en voz alta: hasta hoy
 * los 30 días se aplicaban "al servir" —410 al pedir el enlace— pero el fichero
 * seguía en Daily para siempre. Un dato personal que no caduca.
 *
 * POR QUÉ AQUÍ Y NO EN UNA EDGE FUNCTION. El proyecto ya resolvió esto una vez:
 * `20260717120000_us801_daily_real.sql` dice que Postgres no puede llamar a la
 * API de Daily y que eso lo hace un endpoint server-side. Una función de Deno
 * necesitaría su PROPIO cliente de Daily, su propia copia de la API key y un
 * pipeline de despliegue que hoy no existe — tres sitios más donde quedar
 * desfasado, para un job de una vez al día. Aquí se reutiliza `lib/daily.ts`
 * tal cual.
 *
 * Lo dispara Vercel Cron (ver `vercel.json`), que manda
 * `Authorization: Bearer $CRON_SECRET`.
 */

/** Tope por pasada: si un día se acumula trabajo, se reparte en varios días. */
const LOTE = 200;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // FALLA CERRADO, a propósito. Sin secreto configurado esta ruta NO corre:
  // es un endpoint que borra datos de usuarios y sin él sería público. Que la
  // purga no se ejecute es un problema; que la pueda disparar cualquiera es
  // otro mucho peor.
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET no configurada" },
      { status: 503 },
    );
  }
  // ponytail: comparación directa, como documenta Vercel. Un ataque de timing
  // sobre HTTPS contra un secreto de 256 bits no es la amenaza realista aquí;
  // la realista es que el secreto no esté puesto, y eso lo cubre el 503.
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  /*
   * ⚠️ EL BARRIDO DE STORAGE VA AQUÍ, ANTES DE LA PUERTA DE DAILY, Y NO ES
   * CASUALIDAD: hoy Daily NO está configurado, así que la línea de abajo se
   * lleva por delante todo lo que venga después. Puesto detrás, este barrido no
   * correría ni un solo día.
   *
   * Qué hace: retira de Storage los ficheros que `purge_expired_messages`
   * apuntó en la cola. Existe esa cola porque Supabase prohíbe
   * `delete from storage.objects` desde SQL (42501) y esa función corre en
   * pg_cron, dentro de Postgres, sin llamante HTTP a quien devolverle las rutas
   * (ver `20260827190000`).
   *
   * POR QUÉ AQUÍ Y NO EN UN CRON PROPIO. Vercel Hobby limita los crons a uno al
   * día y esa única plaza ya está ocupada por esta ruta. Añadir un endpoint
   * nuevo significaría moverlo a GitHub Actions y configurar allí otro
   * `CRON_SECRET` — un sitio más donde quedarse a medias. Los dos trabajos son
   * lo mismo: borrar ficheros que cumplieron su retención.
   */
  const barrido = await barrerFicheros(createAdminClient());

  // Sin credenciales de Daily no hay nada que borrar en ninguna parte. No se
  // marca nada como purgado: sería mentir en la columna que sirve de prueba.
  if (!isDailyConfigured()) {
    return NextResponse.json({ status: "sin-daily", purgadas: 0, ...barrido });
  }

  const supabase = createAdminClient();
  const corte = new Date(Date.now() - RECORDING_DAYS * 86_400_000).toISOString();

  // service_role a propósito: la RLS de `sessions` solo deja ver las tuyas, y
  // este trabajo es justamente recorrer las de todo el mundo.
  const { data: vencidas, error } = await supabase
    .from("sessions")
    .select("id, daily_room_name")
    .lt("end_at", corte)
    .not("daily_room_name", "is", null)
    .is("recordings_purged_at", null)
    .limit(LOTE);

  if (error) {
    return NextResponse.json({ error: error.message, ...barrido }, { status: 500 });
  }

  let borradas = 0;
  const fallidas: string[] = [];

  for (const s of vencidas ?? []) {
    const grabaciones = await listRecordings(s.daily_room_name!);

    // Todo o nada por sesión: si una sola no se pudo borrar, la sesión NO se
    // marca y el job vuelve mañana. Marcarla dejaría el fichero vivo con un
    // sello que dice que ya no está, que es peor que no tener sello.
    const resultados = await Promise.all(grabaciones.map((r) => deleteRecording(r.id)));
    if (resultados.some((ok) => !ok)) {
      fallidas.push(s.id);
      continue;
    }

    // Se marcan también las que no tenían ninguna grabación: la clase no se
    // grabó, no hay nada que borrar, y no hay razón para volver a mirarla cada
    // día durante el resto de la vida del proyecto.
    const { error: marcaErr } = await supabase
      .from("sessions")
      .update({ recordings_purged_at: new Date().toISOString() })
      .eq("id", s.id);

    if (marcaErr) {
      fallidas.push(s.id);
      continue;
    }
    borradas += resultados.length;
  }

  return NextResponse.json({
    status: "ok",
    sesionesRevisadas: vencidas?.length ?? 0,
    grabacionesBorradas: borradas,
    sesionesFallidas: fallidas.length,
    // Si viene lleno, hay más esperando: el cron de mañana sigue por ahí.
    lote: LOTE,
    ...barrido,
  });
}

/**
 * Vacía `storage_purge_queue` con la Storage API, que es el ÚNICO camino que
 * Supabase admite para retirar un fichero.
 *
 * ⚠️ La fila se borra SOLO si el `remove()` fue bien. Ese es todo el valor de
 * la cola frente al `delete` que había antes: un fallo de red deja la fila viva
 * y mañana se reintenta sola. Antes, un fallo dejaba el fichero huérfano y
 * nadie se enteraba nunca.
 *
 * ⚠️ Y NO se aborta el lote entero si una ruta falla. Un fichero que ya no
 * existe, o un bucket mal escrito, bloquearían la cola para siempre: se anota
 * el error en su fila, sube su contador de intentos y el índice
 * (`attempts, enqueued_at`) manda al final de la fila a los que fallan mucho,
 * para que no ahoguen a los que sí se pueden borrar.
 */
const LOTE_FICHEROS = 500;

async function barrerFicheros(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ ficherosBorrados: number; ficherosPendientes: number }> {
  const { data: cola } = await admin
    .from("storage_purge_queue")
    .select("id, bucket_id, path")
    .order("attempts", { ascending: true })
    .order("enqueued_at", { ascending: true })
    .limit(LOTE_FICHEROS);

  if (!cola || cola.length === 0) {
    return { ficherosBorrados: 0, ficherosPendientes: 0 };
  }

  // Agrupadas por bucket: `remove()` acepta una lista, así que son tantas
  // llamadas como buckets y no como ficheros.
  const porBucket = new Map<string, { id: string; path: string }[]>();
  for (const f of cola) {
    const ya = porBucket.get(f.bucket_id);
    if (ya) ya.push({ id: f.id, path: f.path });
    else porBucket.set(f.bucket_id, [{ id: f.id, path: f.path }]);
  }

  let borrados = 0;
  let pendientes = 0;

  for (const [bucket, filas] of porBucket) {
    const { error } = await admin.storage
      .from(bucket)
      .remove(filas.map((f) => f.path));

    if (error) {
      pendientes += filas.length;
      console.error("[purga-storage] no se pudo vaciar", bucket, error.message);
      // Se marca el intento para que el índice (`attempts, enqueued_at`) los
      // mande al final y no bloqueen a los demás en la siguiente pasada.
      // ⚠️ El contador se lee y se reescribe desde aquí en vez de con un
      // `attempts + 1` en SQL porque el cliente de PostgREST no expresa un
      // incremento atómico. No importa: este job corre una vez al día y en un
      // solo proceso, así que no hay dos escritores compitiendo.
      for (const f of filas) {
        const { data: fila } = await admin
          .from("storage_purge_queue")
          .select("attempts")
          .eq("id", f.id)
          .maybeSingle();
        await admin
          .from("storage_purge_queue")
          .update({
            attempts: (fila?.attempts ?? 0) + 1,
            last_error: error.message.slice(0, 500),
          })
          .eq("id", f.id);
      }
      continue;
    }

    const { error: errBorrar } = await admin
      .from("storage_purge_queue")
      .delete()
      .in(
        "id",
        filas.map((f) => f.id),
      );

    // Si el fichero se fue pero la fila no, mañana se reintenta un `remove()`
    // sobre algo que ya no existe. Es idempotente y barato; el orden inverso
    // —borrar la fila primero— sí perdería el fichero para siempre.
    if (errBorrar) {
      pendientes += filas.length;
      console.error("[purga-storage] fichero borrado pero la fila sigue:", errBorrar.message);
      continue;
    }
    borrados += filas.length;
  }

  return { ficherosBorrados: borrados, ficherosPendientes: pendientes };
}
