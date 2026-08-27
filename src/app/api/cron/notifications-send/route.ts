import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email-templates";

/**
 * US-1201 · vacía la cola de notificaciones por correo y las envía de verdad.
 *
 * Sustituye al stub `process_notifications()`, que marcaba todo como enviado
 * sin enviar nada (ver `20260806150000`). Esa función sigue existiendo pero ya
 * solo informa: si las pendientes crecen sin parar, es que este job no corre.
 *
 * Lo dispara GitHub Actions cada 5 minutos y NO Vercel Cron, aunque la purga de
 * grabaciones sí use Vercel: el plan Hobby limita los crons a una vez al día, y
 * un aviso de "tienes 24 h para aceptar esta reserva" que llega mañana no sirve
 * de nada. Actions da granularidad de 5 minutos, logs y reejecución manual. El
 * precio es que GitHub retrasa los programados cuando va cargado (10-15 min es
 * normal), lo cual es aceptable para esto y no lo sería para un cobro.
 */

/** Por pasada. Con 5 min de cadencia son 600/hora, de sobra para el MVP. */
const LOTE = 50;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // Falla cerrado, igual que la purga: sin secreto esto sería un endpoint
  // público capaz de disparar correos a los usuarios.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // Sin proveedor no se toca la cola: quedan `pending`, no `failed`. El día que
  // se ponga la clave sale todo lo acumulado en la primera pasada.
  if (!isEmailConfigured()) {
    return NextResponse.json({ status: "sin-proveedor", enviadas: 0 });
  }

  const supabase = createAdminClient();

  // El correo del destinatario vive en `auth.users`. La RPC lo resuelve dentro
  // (SECURITY DEFINER) para no exponer auth ni hacer una llamada por persona.
  const { data: lote, error } = await supabase.rpc("pending_email_notifications", {
    p_limit: LOTE,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let enviadas = 0;
  let permanentes = 0;
  let reintentables = 0;

  for (const n of lote ?? []) {
    const render = n.email
      ? renderEmail({
          template: n.template,
          payload: n.payload as Record<string, unknown> | null,
          nombre: n.nombre ?? "",
          // El origen sale de la propia petición: en Vercel siempre es el
          // despliegue que la atiende, así que los enlaces nunca apuntan al
          // entorno equivocado y no hay una variable más que mantener.
          baseUrl: new URL(req.url).origin,
        })
      : null;

    // Sin dirección o sin plantilla no hay reintento que valga: son errores
    // permanentes y reintentarlos cada 5 minutos solo llenaría el log.
    if (!render) {
      await supabase.rpc("mark_notification", { p_id: n.id, p_ok: false });
      permanentes++;
      continue;
    }

    const res = await sendEmail({ to: n.email!, ...render });

    if (res.ok) {
      await supabase.rpc("mark_notification", { p_id: n.id, p_ok: true });
      enviadas++;
      continue;
    }

    // Transitorio (429 o 5xx del proveedor, red caída): se deja `pending` a
    // propósito y lo coge la pasada siguiente. Marcarlo `failed` perdería el
    // aviso para siempre por un mal minuto de Resend.
    if (res.retriable) {
      reintentables++;
      continue;
    }

    await supabase.rpc("mark_notification", { p_id: n.id, p_ok: false });
    permanentes++;
  }

  return NextResponse.json({
    status: "ok",
    revisadas: lote?.length ?? 0,
    enviadas,
    fallosPermanentes: permanentes,
    // Si esto no baja entre pasadas, el problema es del proveedor, no de la cola.
    pendientesDeReintento: reintentables,
  });
}
