import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { rpcNueva, type PendienteDeBarrido } from "../rpc";
import { anotarBarrido, barrerFicheros } from "../storage";

/**
 * Repaso de los ficheros que quedaron huérfanos tras una baja de cuenta.
 *
 * ── POR QUÉ HACE FALTA ESTA RUTA ────────────────────────────────────────────
 * `anonymize_account` NO borra ficheros: Supabase prohíbe escribir en
 * `storage.objects` desde SQL («Direct deletion from storage tables is not
 * allowed. Use the Storage API instead.», 42501). Lo que hace es RECOLECTAR
 * las rutas y dejarlas en `account_deletions.summary.ficheros` para que las
 * barra quien pueda hablar con la Storage API — o sea, un Route Handler con
 * `service_role`. Todo el razonamiento está en `20260827100000`.
 *
 * Con la baja INMEDIATA eso ya estaba resuelto: barre el propio
 * `POST /api/cuenta/eliminar` justo después de anonimizar. Con la baja
 * PROGRAMADA (migración `20260831160000`) no hay nadie delante: la completa
 * `process_pending_account_deletions` desde pg_cron, dentro de la base de
 * datos, sin ninguna petición HTTP donde colgar un `remove()`. Sus ficheros se
 * quedarían en `summary` para siempre — y entre ellos están los `kyc-documents`,
 * que son documentos de identidad. Esta ruta es quien los recoge.
 *
 * Sirve también de red para el otro camino: si el barrido de la baja inmediata
 * falló (Storage caído, 413, timeout), sus rutas siguen en `summary` y esta
 * pasada las reintenta. Reintentar es seguro — un `remove()` sobre algo que ya
 * no existe Storage lo da por bueno.
 *
 * ── ⚠️ HOY NO LA LLAMA NADIE, Y ESO HAY QUE ARREGLARLO CON UNA LÍNEA ────────
 * Le falta reloj. Va en GitHub Actions y no en Vercel Cron por el motivo de
 * siempre: el plan Hobby permite UN cron al día y ese hueco lo gasta
 * `vercel.json` con la purga de grabaciones. Una entrada nueva en
 * `.github/workflows/` (misma forma que `refunds-cron.yml`: `APP_BASE_URL` +
 * el secret `CRON_SECRET`), diaria y después de las 05:00 UTC, que es cuando
 * corre el pg_cron que completa las bajas.
 *
 * Mientras tanto NO SE PIERDE NADA, solo se retrasa: las rutas siguen escritas
 * en `account_deletions.summary.ficheros`, que el admin puede leer, y este
 * mismo endpoint se puede disparar a mano con el secreto. El termómetro es
 * `ficheros_por_barrer` en el `select public.process_pending_account_deletions();`
 * de cada noche: si sube y no baja, es que nadie está pasando por aquí.
 *
 * ── EL ENSAYO ───────────────────────────────────────────────────────────────
 * `?simulacro=1` dice cuántos ficheros barrería y de qué buckets, sin borrar
 * nada. Es la única forma de mirar por dentro de un job que borra documentos de
 * identidad antes de dejarlo suelto. Va detrás del mismo secreto porque enseña
 * el volumen y los buckets de cuentas ya dadas de baja.
 */

/** Node, no edge: por debajo está el SDK de Storage, como el resto de jobs. */
export const runtime = "nodejs";

/**
 * Cuentas por pasada. Bajo a propósito: cada una puede arrastrar cientos de
 * ficheros (un tutor con material de clase) y cada lote es una llamada a la
 * Storage API. Lo que sobre sale mañana — las rutas no se van a ningún lado.
 */
const LOTE = 25;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;

  // FALLA CERRADO, igual que los otros tres jobs. Sin secreto esto sería un
  // endpoint público capaz de borrar ficheros de Storage. Que no corra es un
  // problema; que lo dispare cualquiera es otro mucho peor.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const simulacro = new URL(req.url).searchParams.get("simulacro") === "1";
  const admin = createAdminClient();

  // El filtro («`summary->'ficheros'` no vacío») vive en SQL a propósito: ver
  // el comentario de `account_deletions_pendientes_de_barrido` en la migración.
  // Regla de oro 9 — la función es `security definer` y está concedida a
  // `service_role`, así que no depende de los grants de `account_deletions`.
  const { data, error } = await rpcNueva<PendienteDeBarrido[]>(
    admin,
    "account_deletions_pendientes_de_barrido",
    { p_limit: LOTE },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pendientes = data ?? [];

  if (simulacro) {
    return NextResponse.json({
      status: "simulacro",
      cuentas: pendientes.length,
      // Sin las rutas: en un ensayo no hace falta sacar nombres de fichero al
      // log de nadie (los de `tutor-materials` llevan el nombre original).
      barreria: pendientes.map((p) => ({
        user_id: p.user_id,
        ficheros: Object.values(p.ficheros).flat().length,
        buckets: Object.keys(p.ficheros),
      })),
    });
  }

  let barridos = 0;
  let quedan = 0;

  for (const fila of pendientes) {
    const resultado = await barrerFicheros(admin, fila.user_id, fila.ficheros ?? {});
    const restantes = Object.values(resultado.pendientes).flat().length;

    // Se anota SIEMPRE, incluso cuando no se barrió nada: es lo que vacía
    // `summary.ficheros` en el caso bueno, y lo que deja el resto exacto en el
    // malo para que la pasada siguiente reintente solo eso.
    await anotarBarrido(
      admin,
      fila.user_id,
      fila.ficheros_recolectados,
      resultado.pendientes,
    );

    barridos += resultado.barridos;
    quedan += restantes;
  }

  // 200 siempre: un fallo de Storage no es un fallo de este job. Las rutas que
  // no se pudieron borrar siguen en `summary` y salen en la pasada siguiente,
  // y las concretas ya están en el log de `barrerFicheros`. Devolver 500 solo
  // conseguiría que Actions pintara rojo por algo que se arregla solo mañana.
  return NextResponse.json({
    status: "ok",
    cuentas: pendientes.length,
    ficheros_barridos: barridos,
    ficheros_pendientes: quedan,
  });
}
