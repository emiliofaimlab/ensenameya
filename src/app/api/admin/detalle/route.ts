import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { getBookingDetail, getPaymentDetail } from "@/lib/admin/queries";

/**
 * El detalle de UNA reserva o UN pago, en JSON, para los modales del panel.
 *
 * POR QUÉ ESTE PIDE Y LOS DE ALUMNOS/TUTORES NO. Allí la pantalla trae la ficha
 * completa de todo el mundo por adelantado y el modal no habla con el servidor:
 * son 19 alumnos y 32 tutores, y cabe. Aquí no cabe — hay 260 reservas y 180
 * pagos en dev, las dos tablas crecen sin techo y las dos listas PAGINAN de 20
 * en 20. Precargar el detalle de todo sería deshacer la paginación por detrás.
 *
 * NO TIENE LÓGICA DE DATOS PROPIA: llama a `getBookingDetail` y
 * `getPaymentDetail`, que son las MISMAS funciones que pintan
 * `/admin/bookings/[id]` y `/admin/payments/[id]`. Eso es lo que garantiza que
 * el modal y la pantalla de detalle no puedan decir cosas distintas — y si
 * mañana una de las dos funciones trae un campo más, sale en los dos sitios sin
 * tocar este fichero.
 *
 * La barrera de verdad sigue siendo la RLS (`bookings_select_admin`,
 * `payments_select_admin`): sin rol admin, esas consultas devuelven vacío y
 * esto contesta 404. La comprobación de abajo está para dar un código claro.
 */

/** Misma decisión que en `/api/admin/export`: códigos, no `redirect()`. */
async function soloAdmin(): Promise<NextResponse | null> {
  const { user, roles } = await getSessionContext();
  if (!user) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  if (!roles.includes("admin")) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  return null;
}

/** Los ids son uuid. Lo que no lo sea ni llega a la consulta. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const noPasa = await soloAdmin();
  if (noPasa) return noPasa;

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo");
  const id = url.searchParams.get("id") ?? "";

  if (!UUID.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const detalle =
    tipo === "reserva"
      ? await getBookingDetail(id)
      : tipo === "pago"
        ? await getPaymentDetail(id)
        : undefined;

  if (detalle === undefined) {
    return NextResponse.json({ error: "tipo desconocido" }, { status: 400 });
  }
  if (detalle === null) {
    return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  }

  // Son datos personales y financieros: que no se queden en ninguna caché.
  return NextResponse.json(detalle, {
    headers: { "cache-control": "no-store" },
  });
}
