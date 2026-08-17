import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACEPTACION,
  ACEPTACION_DEFECTO,
  PAGO,
  PAGO_DEFECTO,
  preset,
  type Preset,
} from "./cutoffs";

/**
 * RV-20 · disparar `expire_stale_bookings` a mano, solo el admin.
 *
 * EL PROBLEMA QUE RESUELVE. El camino "el tutor no responde en 24 h → se cancela
 * y se devuelve el 100 %" (RN-38) es de los que más importa verificar y de los
 * que no se pueden verificar: hay que esperar un día. La función SÍ está
 * preparada —recibe los dos cutoffs como parámetros con default, precisamente
 * "para poder verificar el timeout sin esperar"—; lo que no había era forma de
 * llamarla. `20260715150000` le quitó el `execute` a `authenticated` por una
 * vulnerabilidad muy real: cualquier autenticado podía pasar `0 seconds` y
 * vencer —y "reembolsar"— las reservas pendientes de TODA la plataforma. Desde
 * X-01 eso además encolaría reembolsos de verdad contra Stripe.
 *
 * ⚠️ ESE GRANT NO SE REABRE. La función sigue siendo de `service_role` y punto.
 * Lo que hace este handler es ponerle delante una puerta con dos cerraduras:
 *   1. la sesión del usuario, leída en el SERVIDOR, tiene que traer rol admin;
 *   2. la llamada se hace con el cliente `service_role`, que nunca sale de aquí.
 * Ni la clave ni la capacidad llegan al navegador: el navegador solo puede
 * pedirle a esta ruta que lo haga.
 *
 * POR QUÉ GET Y POST SEPARADOS, y no un único endpoint con un flag:
 *   · GET = vista previa. Solo lee, con la sesión del admin y su RLS. Dice qué
 *     reservas caerían y cuánto dinero se encolaría.
 *   · POST = ejecutar. Es lo único destructivo, y al ser POST no se puede
 *     disparar navegando a una URL, ni desde un `<img>`, ni desde un enlace que
 *     alguien pegue en un chat. (Las cookies de sesión de Supabase son
 *     `SameSite=Lax`, así que un POST desde otro origen tampoco las lleva.)
 */

/** Cuántas reservas se enseñan en la vista previa. El total va aparte y es exacto. */
const MUESTRA = 50;

type Guard =
  | { ok: true; userId: string }
  | { ok: false; res: NextResponse };

/**
 * Guarda de rol en servidor.
 *
 * No se usa `requireRole('admin')` a propósito: esa función hace `redirect()`,
 * que en un Route Handler acaba en una respuesta 307 hacia HTML. Un `fetch()`
 * la seguiría y le llegaría la página de login como si fuera la respuesta de la
 * API — un fallo silencioso disfrazado de éxito. Aquí se contesta con códigos.
 */
async function soloAdmin(): Promise<Guard> {
  const { user, roles } = await getSessionContext();
  if (!user) {
    return {
      ok: false,
      res: NextResponse.json({ error: "sin sesión" }, { status: 401 }),
    };
  }
  if (!roles.includes("admin")) {
    return {
      ok: false,
      res: NextResponse.json({ error: "no autorizado" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

/** Los dos plazos pedidos, validados contra la lista cerrada de `cutoffs.ts`. */
function plazos(params: URLSearchParams):
  | { ok: true; aceptacion: Preset; pago: Preset }
  | { ok: false; res: NextResponse } {
  const aceptacion = preset(
    ACEPTACION,
    params.get("aceptacion"),
    ACEPTACION_DEFECTO,
  );
  const pago = preset(PAGO, params.get("pago"), PAGO_DEFECTO);
  if (!aceptacion || !pago) {
    return {
      ok: false,
      res: NextResponse.json({ error: "plazo no válido" }, { status: 400 }),
    };
  }
  return { ok: true, aceptacion, pago };
}

/**
 * Suma por moneda. Sumar monedas distintas no significa nada (RN-13), y aquí
 * menos que en ningún sitio: es dinero que se va a devolver.
 */
function porMoneda(filas: { amount: number; currency: string }[]) {
  const acc = new Map<string, number>();
  for (const f of filas) acc.set(f.currency, (acc.get(f.currency) ?? 0) + f.amount);
  return [...acc].map(([currency, amount]) => ({ currency, amount }));
}

/**
 * GET — vista previa. Qué se vencería AHORA con estos plazos, sin tocar nada.
 *
 * ⚠️ Esto REPLICA los dos `select` de la función, no los ejecuta. Es
 * informativo por definición: entre que se mira y se pulsa, alguien puede pagar
 * o el tutor puede aceptar, y entonces la lista ya no es la misma. Quien manda
 * es la función. Si algún día cambia su criterio, esta vista previa hay que
 * cambiarla también — está anotado aquí y en la pantalla.
 *
 * El corte se calcula en JavaScript (`ahora - ms`) en vez de con `now()` de
 * Postgres: PostgREST no sabe restar intervalos en un filtro. La diferencia de
 * reloj entre la app y la base es de milisegundos y esto solo se enseña.
 */
export async function GET(req: Request) {
  const guard = await soloAdmin();
  if (!guard.ok) return guard.res;

  const url = new URL(req.url);
  const p = plazos(url.searchParams);
  if (!p.ok) return p.res;

  const ahora = Date.now();
  const cortePago = new Date(ahora - p.pago.ms).toISOString();
  const corteAceptacion = new Date(ahora - p.aceptacion.ms).toISOString();

  // Con la sesión del admin y su RLS (`bookings_select_admin`): esto es una
  // lectura de una persona, no trabajo de sistema. `service_role` solo aparece
  // en el POST, que es el que necesita `execute` sobre la función.
  const supabase = await createClient();

  const [sinPagar, sinAceptar] = await Promise.all([
    // Rama 1: se creó, nadie pagó, el horario sigue bloqueado. SIN reembolso.
    supabase
      .from("bookings")
      .select(
        "id, booking_ref, total_amount, currency, created_at, products(title), student:profiles!bookings_student_id_fkey(full_name)",
        { count: "exact" },
      )
      .eq("status", "pending_payment")
      .lt("created_at", cortePago)
      .order("created_at", { ascending: true })
      .limit(MUESTRA),

    // Rama 2: pagada y esperando al tutor. Esta SÍ devuelve el 100 % (RN-38).
    // El `!inner` hace que el filtro sobre `payments.paid_at` acote la reserva,
    // igual que el `join` de la función.
    supabase
      .from("bookings")
      .select(
        "id, booking_ref, currency, created_at, products(title), student:profiles!bookings_student_id_fkey(full_name), tutor:profiles!bookings_tutor_id_fkey(full_name), payments!inner(id, paid_at, gross_amount, refunded_amount)",
        { count: "exact" },
      )
      .eq("status", "pending_acceptance")
      .lt("payments.paid_at", corteAceptacion)
      .order("created_at", { ascending: true })
      .limit(MUESTRA),
  ]);

  // El tramo a devolver es `gross_amount - refunded_amount` leído AHORA, igual
  // que hace la función antes de tocar nada: si ya se había devuelto algo, solo
  // se encola la diferencia, y si no queda nada, no se encola.
  //
  // `b.payments` es UN objeto y no un array porque `payments.booking_id` es
  // `unique` (`20260709140000`): un pago por reserva, y el tipado generado lo
  // sabe.
  const aDevolver = (sinAceptar.data ?? [])
    .map((b) => ({
      amount: b.payments.gross_amount - b.payments.refunded_amount,
      currency: b.currency,
    }))
    .filter((x) => x.amount > 0);

  return NextResponse.json({
    plazos: {
      aceptacion: { sql: p.aceptacion.sql, label: p.aceptacion.label },
      pago: { sql: p.pago.sql, label: p.pago.label },
    },
    // La muestra puede quedarse corta; el total es exacto.
    muestra: MUESTRA,
    sinPagar: {
      total: sinPagar.count ?? 0,
      reservas: (sinPagar.data ?? []).map((b) => ({
        id: b.id,
        ref: b.booking_ref,
        titulo: b.products?.title ?? "Mentoría",
        alumno: b.student?.full_name ?? "—",
        importe: b.total_amount,
        currency: b.currency,
        creada: b.created_at,
      })),
    },
    sinAceptar: {
      total: sinAceptar.count ?? 0,
      // Lo que se encolaría en `refund_requests` si se ejecuta.
      reembolso: porMoneda(aDevolver),
      reservas: (sinAceptar.data ?? []).map((b) => ({
        id: b.id,
        ref: b.booking_ref,
        titulo: b.products?.title ?? "Mentoría",
        alumno: b.student?.full_name ?? "—",
        tutor: b.tutor?.full_name ?? "—",
        importe: b.payments.gross_amount - b.payments.refunded_amount,
        currency: b.currency,
        pagada: b.payments.paid_at,
      })),
    },
  });
}

/**
 * POST — ejecutar de verdad.
 *
 * Cancela reservas, libera sesiones y **encola reembolsos reales** en
 * `refund_requests` para la rama de aceptación. No tiene deshacer.
 */
export async function POST(req: Request) {
  const guard = await soloAdmin();
  if (!guard.ok) return guard.res;

  // Los plazos llegan en el cuerpo y no en la URL: una acción destructiva no
  // debería quedar entera escrita en un historial de navegación ni en un log de
  // accesos. `URLSearchParams` para reutilizar la misma validación.
  let cuerpo: unknown = {};
  try {
    cuerpo = await req.json();
  } catch {
    // Cuerpo vacío o no-JSON → se usan los plazos reales.
  }
  const { aceptacion, pago } = (cuerpo ?? {}) as {
    aceptacion?: string;
    pago?: string;
  };
  const p = plazos(
    new URLSearchParams({
      aceptacion: aceptacion ?? ACEPTACION_DEFECTO,
      pago: pago ?? PAGO_DEFECTO,
    }),
  );
  if (!p.ok) return p.res;

  // Falla cerrado, como los tres jobs: sin la clave no se finge que se hizo.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno" },
      { status: 503 },
    );
  }

  const { data, error } = await admin.rpc("expire_stale_bookings", {
    p_payment_cutoff: p.pago.sql,
    p_acceptance_cutoff: p.aceptacion.sql,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Rastro de quién movió dinero y con qué plazos. Es la misma razón por la que
  // el job de reembolsos deja una línea por cada movimiento: cuando alguien
  // pregunte "¿por qué se canceló esta reserva?", esto es la respuesta.
  console.info(
    `[RV-20] expire_stale_bookings por admin ${guard.userId} · pago=${p.pago.sql} · aceptación=${p.aceptacion.sql} →`,
    data,
  );

  return NextResponse.json({
    ok: true,
    plazos: { aceptacion: p.aceptacion.sql, pago: p.pago.sql },
    resultado: data,
  });
}
