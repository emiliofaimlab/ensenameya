import { NextResponse } from "next/server";

import {
  ReferralFactoryError,
  createUser,
  isReferralFactoryConfigured,
  qualifyUser,
} from "@/lib/referral-factory";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * §6 · LA CONVERSIÓN DEL REFERIDO — el único sitio donde se le dice a Referral
 * Factory que alguien cumplió.
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────
 * `referral_conversions_pending()` (migración `20260911120000`) devuelve los
 * invitados que ya cumplieron la regla de SU campaña —alumnos: primer pago;
 * tutores: primera sesión completada (DP-32.2)— y todavía no se han mandado.
 * Por cada uno: `POST users` con `referrer_code` (nace colgando del referidor,
 * que es la ÚNICA forma de atribuir en RF: no existe ninguna llamada para
 * emparejar a dos usuarios que ya existen) y `PUT users/{id} {qualified:true}`.
 * Solo después se escribe `profiles.referral_converted_at`, que es el ancla de
 * idempotencia: lo que no se marca, vuelve en la pasada siguiente.
 *
 * ── POR QUÉ HORARIO Y NO CADA 5 MINUTOS ────────────────────────────────────
 * Porque aquí no espera nadie. La recompensa la CONTABILIZA RF según sus
 * reglas (RN-21) y el usuario no ve el cambio hasta que abre `/referidos`: una
 * conversión que se apunta dos horas tarde no rompe nada, al revés que un aviso
 * de "te quedan 24 h" o que un reembolso. Y RF tiene picos de más de 25 s
 * (3 de 40 llamadas, medido el 10-sep-2026): llamarlo doce veces por hora para
 * encontrar la cola vacía sería pagar ese peaje por nada.
 *
 * ⚠️ LA CADENCIA DE GITHUB ES UNA FICCIÓN MEDIDA. `referrals-cron.yml` pide
 * `0 * * * *`, pero sobre corridas reales GitHub entrega **una cada 2-6 horas**
 * (CLAUDE.md y `docs/ENTORNOS.md` §"tres peajes"). No se puede planificar con
 * "cada hora", y da igual: ver el párrafo de arriba. Para forzar una pasada
 * —criterio de aceptación 4— está el `workflow_dispatch` del workflow.
 *
 * ⚠️ Y GitHub solo programa los workflows de `main`: mientras esto viva solo en
 * `dev`, este reloj no existe.
 */

/** Node, no edge: por debajo hay `fetch` con `AbortController` contra RF. */
export const runtime = "nodejs";

/**
 * Por pasada. Con una cadencia real de horas, 50 conversiones por vuelta sobran
 * de largo: lo que sobre sale en la siguiente, porque nada se marca hasta que
 * RF lo acepta.
 */
const LOTE = 50;

/**
 * RF EXIGE `first_name` en el `POST users`, y `profiles.full_name` es opcional
 * en el alta por Google (llega vacío más veces de las que parece). El respaldo
 * es literal a propósito: ese nombre solo lo ve el cliente en el panel de RF,
 * no el usuario, así que vale más un marcador reconocible que un 422 evitable.
 */
const NOMBRE_DE_RESPALDO = "Invitado";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // Falla cerrado, igual que sus tres hermanos. Sin secreto esto sería un
  // endpoint público capaz de dar de alta usuarios en la cuenta de RF del
  // cliente, que tiene un tope de 20.000 en el plan Basic.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // La credencial es el interruptor (CLAUDE.md). Sin clave no se toca nada: las
  // filas se quedan con `referral_converted_at` a null, que es la verdad, y el
  // día que se ponga la variable sale todo lo acumulado en la primera pasada.
  // 200 y no 5xx: no hay nada roto, hay algo sin configurar.
  if (!isReferralFactoryConfigured()) {
    return NextResponse.json({ status: "sin-credencial", convertidos: 0 });
  }

  const supabase = createAdminClient();

  // `security definer` porque lee el correo de `auth.users`; grant execute solo
  // a `service_role`. El join con `referral_memberships` VALIDA el código: un
  // `?ref=` inventado no llega hasta aquí (criterio de aceptación 5).
  const { data: lote, error } = await supabase.rpc("referral_conversions_pending", {
    p_limit: LOTE,
  });
  if (error) {
    // Regla de oro 10: sin mirar el `error`, un fallo de permisos se leería
    // como "no había nadie que convertir" y el job saldría verde para siempre.
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let convertidos = 0;
  let fallidos = 0;
  let reintentables = 0;

  for (const fila of lote ?? []) {
    try {
      const { data: creado } = await createUser({
        campaign_id: fila.rf_campaign_id,
        first_name: fila.first_name?.trim() || NOMBRE_DE_RESPALDO,
        email: fila.email,
        referrer_code: fila.referral_code,
      });

      await qualifyUser(creado.id, fila.rf_campaign_id);

      // ✅ TODO EL BUCLE ES IDEMPOTENTE, y no por diseño nuestro: MEDIDO contra
      // la API real el 11-sep-2026. `POST users` con un correo que YA existe en
      // esa campaña NO da 422 — devuelve el MISMO usuario, con su mismo `id` y
      // su mismo `code` (probado: dos altas seguidas de `qa-s322-…@ensenameya.com`
      // en la 50785 devolvieron las dos `id 10563358` / `code uq9yPL0v`; el mismo
      // correo en la 50784 sí creó uno nuevo, o sea que la unicidad es por
      // CAMPAÑA). Y `PUT {qualified:true}` sobre alguien ya cualificado es un
      // no-op.
      //
      // Consecuencia práctica: si este `update` falla, o si `qualifyUser` se
      // come un timeout, la pasada siguiente repite las dos llamadas, recupera
      // el mismo `id` y termina el trabajo. No hay ningún estado a medias que
      // haya que reparar a mano.
      //
      // ⚠️ Eso DEROGA el supuesto S-32.2 del §10 de la especificación, que daba
      // por hecho el 422 y pedía marcar la conversión sin `rf_user_id` para no
      // reintentar eternamente. Esa rama existía aquí y se ha quitado: marcaba
      // como convertido a quien RF nunca llegó a cualificar, y la pantalla del
      // referidor lo pintaba en verde igual. No se repone sin volver a medir.
      const { error: errorUpdate } = await supabase
        .from("profiles")
        .update({
          referral_converted_at: new Date().toISOString(), // UTC, regla de oro 4
          referral_rf_user_id: creado.id,
        })
        .eq("id", fila.profile_id);

      if (errorUpdate) {
        console.warn(
          `[referrals-sync] RF aceptó a ${fila.profile_id} (rf_user_id ${creado.id}) pero no se pudo marcar: ${errorUpdate.message}`,
        );
        fallidos++;
        continue;
      }

      convertidos++;
    } catch (e) {
      if (!(e instanceof ReferralFactoryError)) {
        console.warn(`[referrals-sync] fallo inesperado con ${fila.profile_id}: ${String(e)}`);
        fallidos++;
        continue;
      }

      // Timeout, 429 o 5xx: mal minuto de RF, no un problema de esta fila. NO
      // se marca nada y la pasada siguiente la recoge. Marcarla aquí perdería
      // la conversión para siempre por un pico de latencia de RF.
      if (e.retriable) {
        reintentables++;
        continue;
      }

      // 4xx permanentes: la petición está mal (código de referidor que RF no
      // conoce, campaña pausada o borrada en RF, correo que RF considera
      // inválido — rechaza dominios sin MX, p. ej. `.dev`). No se marca nada
      // —no ha convertido en RF— y se grita, porque reintentarlo no lo arregla.
      //
      // El 422 de «correo repetido» NO cae aquí: no existe (ver arriba).
      console.warn(`[referrals-sync] RF rechaza a ${fila.profile_id}: ${e.message}`);
      fallidos++;
    }
  }

  return NextResponse.json({
    status: "ok",
    revisados: lote?.length ?? 0,
    convertidos,
    fallidos,
    // Si esto no baja entre pasadas, el que va mal es RF, no la cola.
    reintentables,
  });
}
