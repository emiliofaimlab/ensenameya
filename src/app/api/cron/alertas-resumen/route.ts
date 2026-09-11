import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { PAYOUT_PROBLEMA } from "@/lib/admin/alertas";

/**
 * NTF-13 (Doc 33 §7.3) · el resumen de incidencias para los administradores.
 *
 * ⚠️ AGRUPADO POR FUERZA, y ése es el ticket entero. Una incidencia por correo
 * convierte un mal día del PSP en cien correos, y cien correos no los lee
 * nadie: el aviso se vuelve ruido justo el día que hacía falta. Aquí se manda
 * UN resumen por administrador y por hora con lo acumulado, o no se manda nada.
 *
 * Las alertas NO son una tabla: se derivan de pagos fallidos, payouts en
 * problema y cancelaciones (SCR-AD14, `lib/admin/alertas.ts`). Este endpoint
 * repite ese criterio con el cliente `service_role` porque `countUnackedAlerts`
 * va por ANON+RLS y necesita la sesión de un admin, que un job no tiene.
 *
 * ⚠️ LA VENTANA NO ES UNA HORA, son seis. La cadencia real de GitHub Actions,
 * medida sobre corridas reales, es una pasada cada 2-6 horas (CLAUDE.md), así
 * que una ventana de una hora se dejaría fuera todo lo ocurrido entre pasadas.
 * Con seis horas hay SOLAPE —una incidencia puede salir en dos resúmenes— y eso
 * es exactamente lo que se prefiere: un resumen que repite es legible, uno con
 * agujeros es mentira. Lo que impide el correo repetido es la clave de
 * idempotencia, que lleva la hora dentro: como mucho uno por admin y por hora.
 *
 * ⚠️ Si en la ventana no hubo nada, NO SE ENCOLA. Un «0 incidencias» cada hora
 * es la forma más rápida de que el aviso se filtre a una carpeta y ahí se quede
 * el día que traiga tres.
 */
const VENTANA_HORAS = 6;

/** Cuántas líneas caben en un resumen que se pueda leer de un vistazo. */
const MAX_LINEAS = 12;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // Falla cerrado, igual que sus hermanas: sin secreto esto sería un endpoint
  // público que lee el estado financiero de la plataforma.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const desde = new Date(Date.now() - VENTANA_HORAS * 3_600_000).toISOString();
  const hasta = new Date().toISOString();

  // ⚠️ REGLA DE ORO 9: `user_roles` y `alert_acks` no tenían grant a
  // `service_role` — se lo da `20260911210000`. Sin él esto come
  // `permission denied` EN EJECUCIÓN, no en el build ni en el typecheck.
  const [{ data: pagos }, { data: payouts }, { data: cancel }, { data: admins, error: errAdmins }] =
    await Promise.all([
      admin
        .from("payments")
        .select("id, gross_amount, currency, failed_at")
        .eq("status", "failed")
        .gte("failed_at", desde)
        .order("failed_at", { ascending: false })
        .limit(MAX_LINEAS),
      admin
        .from("payouts")
        .select("id, amount, currency, status, provider, failure_reason, updated_at")
        .in("status", PAYOUT_PROBLEMA)
        .gte("updated_at", desde)
        .order("updated_at", { ascending: false })
        .limit(MAX_LINEAS),
      admin
        .from("bookings")
        .select("id, total_amount, currency, cancelled_at")
        .eq("status", "cancelled")
        .gte("cancelled_at", desde)
        .order("cancelled_at", { ascending: false })
        .limit(MAX_LINEAS),
      admin.from("user_roles").select("user_id").eq("role", "admin"),
    ]);

  // ⚠️ Aquí SÍ se mira el error, y no por costumbre: sin esto un
  // `permission denied` sobre `user_roles` se leería como «no hay
  // administradores» y el job diría `ok` para siempre sin mandar un solo
  // correo. Es el fallo de la regla de oro 10 con otro traje.
  if (errAdmins) {
    return NextResponse.json({ error: errAdmins.message }, { status: 500 });
  }

  const lineas = [
    ...(pagos ?? []).map((p) => ({
      titulo: "Cobro rechazado",
      sub: `Pago ${p.id.slice(0, 8)}`,
      importe: p.gross_amount,
      moneda: p.currency,
    })),
    ...(payouts ?? []).map((p) => ({
      titulo: `Liquidación ${p.status === "on_hold" ? "retenida" : "rechazada"}${p.provider ? ` · ${p.provider}` : ""}`,
      // El motivo del proveedor, recortado: en un resumen cabe la pista, no el
      // volcado. El detalle está en el panel, a un clic.
      sub: p.failure_reason?.slice(0, 80) ?? `Liquidación ${p.id.slice(0, 8)}`,
      importe: p.amount,
      moneda: p.currency,
    })),
    ...(cancel ?? []).map((b) => ({
      titulo: "Reserva cancelada",
      sub: `Reserva ${b.id.slice(0, 8)}`,
      importe: b.total_amount,
      moneda: b.currency,
    })),
  ];

  if (lineas.length === 0) {
    return NextResponse.json({ status: "sin-incidencias", ventanaHoras: VENTANA_HORAS });
  }

  // El total solo tiene sentido si todo va en la misma moneda. Con monedas
  // mezcladas se omite: sumar pesos y dólares y llamarlo «importe afectado»
  // sería inventarse una cifra, y la plantilla se degrada sola sin ella.
  const monedas = new Set(lineas.map((l) => l.moneda));
  const moneda = monedas.size === 1 ? [...monedas][0] : null;
  const total = moneda ? lineas.reduce((s, l) => s + (l.importe ?? 0), 0) : null;

  // La hora dentro de la clave es lo que hace que sea UN resumen por hora: dos
  // pasadas en la misma hora encolan la misma clave y la segunda se descarta
  // sola (`enqueue_notification` hace `on conflict do nothing`).
  const bucket = hasta.slice(0, 13).replace(/[-T:]/g, "");

  const payload = {
    alertas: { lineas, total, moneda, desde, hasta },
  };

  let encoladas = 0;
  for (const a of admins ?? []) {
    const { error } = await admin.rpc("enqueue_notification", {
      p_recipient: a.user_id,
      p_type: "NTF-13",
      p_channel: "email",
      p_template: "admin_alert",
      p_payload: payload,
      p_key: `NTF-13:${a.user_id}:${bucket}`,
    });
    if (error) {
      console.error("[alertas-resumen] no se pudo encolar", a.user_id, error.message);
      continue;
    }
    encoladas++;
  }

  return NextResponse.json({
    status: "ok",
    ventanaHoras: VENTANA_HORAS,
    incidencias: lineas.length,
    administradores: admins?.length ?? 0,
    encoladas,
  });
}
