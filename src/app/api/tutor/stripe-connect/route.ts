import { NextResponse } from "next/server";

import {
  crearCuentaConectada,
  cuentaConectadaLista,
  enlaceDeAltaConectada,
  isStripeConfigured,
  siteUrl,
} from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * EL ALTA DE LA CUENTA CONECTADA — la mitad del riel de Stripe que no es código
 * de payout.
 *
 * `stripeProvider.payout()` necesita UN dato del tutor: su `acct_…`. Esta ruta
 * es de donde sale. Hace lo mínimo y en este orden:
 *
 *   1. si el tutor no tiene cuenta, la crea en Stripe y la anota;
 *   2. pide un enlace de alta y lo devuelve para que el navegador lo abra.
 *
 * ⚠️ NO ES UN GET Y NO ES IDEMPOTENTE POR ACCIDENTE: crea una cuenta en un
 * proveedor. Por eso va por POST —un prefetch del router no puede dispararlo— y
 * por eso la creación se hace SOLO si la columna está vacía. La segunda parte,
 * el enlace, sí se repite cada vez: caduca en minutos y es de un solo uso.
 *
 * ⚠️ EL PAÍS SALE DE `payout_country`, DECLARADO POR EL TUTOR, y Stripe lo
 * congela para siempre en la cuenta. No se deduce de la IP ni de la zona
 * horaria: equivocarse aquí obliga a crear otra cuenta y a que el tutor repita
 * el alta entera.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "falta STRIPE_API_KEY" }, { status: 503 });
  }

  // Con el cliente del propio tutor: su política de fila propia ya lo limita a
  // lo suyo, así que no hace falta `service_role` para LEER.
  const { data: perfil, error } = await supabase
    .from("tutor_profiles")
    .select("payout_country, stripe_connect_account_id")
    .eq("profile_id", user.id)
    .maybeSingle();
  // Se mira el error (regla de oro 10): sin esto, una consulta rota se leería
  // como «no es tutor» y devolvería un 403 que nadie sabría explicar.
  if (error) {
    return NextResponse.json({ error: `no se pudo leer el perfil: ${error.message}` }, { status: 500 });
  }
  if (!perfil) {
    return NextResponse.json({ error: "solo los tutores tienen cuenta de cobro" }, { status: 403 });
  }
  if (!perfil.payout_country) {
    return NextResponse.json(
      { error: "declara primero tu país de cobro: Stripe lo congela en la cuenta y no se puede cambiar" },
      { status: 400 },
    );
  }

  try {
    let cuenta = perfil.stripe_connect_account_id;

    if (!cuenta) {
      cuenta = await crearCuentaConectada({
        country: perfil.payout_country,
        email: user.email ?? null,
      });
      // 🔴 SE ANOTA ANTES DE DEVOLVER NADA. Si esta escritura falla y la
      // respuesta saliera igual, la próxima llamada crearía una SEGUNDA cuenta
      // conectada en Stripe para la misma persona — y la primera se quedaría
      // huérfana, sin nadie que sepa que existe.
      const { error: errorAnotar } = await createAdminClient()
        .from("tutor_profiles")
        .update({ stripe_connect_account_id: cuenta })
        .eq("profile_id", user.id);
      if (errorAnotar) {
        return NextResponse.json(
          { error: `la cuenta ${cuenta} se creó en Stripe pero no se pudo anotar: ${errorAnotar.message}` },
          { status: 500 },
        );
      }
    }

    const estado = await cuentaConectadaLista(cuenta);
    if (estado.lista) {
      return NextResponse.json({ lista: true, cuenta });
    }

    return NextResponse.json({
      lista: false,
      cuenta,
      pendiente: estado.pendiente,
      url: await enlaceDeAltaConectada({
        account: cuenta,
        returnUrl: `${siteUrl()}/tutor/payouts`,
      }),
    });
  } catch (e) {
    const err = e as { message?: string };
    console.error("[tutor/stripe-connect] Stripe falló:", e);
    return NextResponse.json(
      { error: `Stripe: ${err.message ?? "error desconocido"}` },
      { status: 502 },
    );
  }
}
