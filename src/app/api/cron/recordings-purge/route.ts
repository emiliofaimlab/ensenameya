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

  // Sin credenciales de Daily no hay nada que borrar en ninguna parte. No se
  // marca nada como purgado: sería mentir en la columna que sirve de prueba.
  if (!isDailyConfigured()) {
    return NextResponse.json({ status: "sin-daily", purgadas: 0 });
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
    return NextResponse.json({ error: error.message }, { status: 500 });
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
  });
}
