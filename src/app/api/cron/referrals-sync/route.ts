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
 * Factory que alguien cumplió, y desde el 12-sep también el único que EMITE la
 * recompensa que la campaña prometió.
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
 * Y con la conversión ya firme, `emitir_credito_de_referido(profile_id)`
 * (`20260912110000`) le acuña al REFERIDOR lo que prometa SU campaña —una
 * mentoría con tope o saldo— y decide ella sola si el crédito sale por el cobro
 * (alumno: saldo/vale) o por el próximo payout (tutor: «le llega solo»). Esto
 * es lo que cierra el diagrama aprobado: la recompensa es automática y nadie
 * reclama nada.
 *
 * ⚠️ EL ORDEN ES LOAD-BEARING, NO ESTILO. La RPC exige por dentro
 * `referral_converted_at is not null` —esa invariante vive DENTRO de la función
 * a propósito: una función de dinero cuya regla solo vive en quien la llama es
 * exactamente la forma del agujero de `confirm_simulated_payment`—, así que la
 * llamada va DESPUÉS del `update` de `profiles`. Subirla «por limpieza», o
 * agrupar las emisiones al final del bucle antes de marcar, la convierte en un
 * `return null` mudo para todas las filas.
 *
 * ⚠️ Y `null` NO ES UN ERROR. La RPC devuelve `null` cuando la campaña no
 * reparte (`reward_kind = 'ninguna'`, que es el default), cuando ya había
 * emitido (es idempotente por el índice parcial `credits_recompensa_unica`) o
 * cuando la regla de la audiencia no se cumple. Eso se cuenta como
 * `sinRecompensa`; `recompensasFallidas` es otra cosa y otra columna.
 *
 * ── EL RESCATE, Y POR QUÉ EXISTE ───────────────────────────────────────────
 * Un fallo AL EMITIR no deshace la conversión: RF ya la tiene apuntada y
 * `referral_converted_at` ya está escrito; volver atrás haría que la pasada
 * siguiente se la mandara a RF otra vez. Pero eso abre un agujero mudo de los
 * de la regla de oro 11: con la marca puesta, `referral_conversions_pending` ya
 * NO devuelve esa fila, así que nadie reintentaría la emisión jamás.
 *
 * Y el fallo realista aquí no es un blip de red, es sistémico y afecta a TODAS
 * las filas a la vez: que `20260912110000` todavía no esté aplicada en ESE
 * ambiente (precedente literal de CLAUDE.md: el mismo fallo siguió cayendo en
 * producción dos días después de existir la migración en `dev`), o que falte el
 * `grant execute`. Se arregla solo y de golpe —y sin nadie que vuelva a por los
 * que se quedaron sin premio, el dinero prometido se pierde en silencio.
 *
 * Por eso cada pasada empieza por un RESCATE (`rescatarRecompensas`): los
 * convertidos de los últimos `DIAS_DE_RESCATE` días a los que les falta su
 * crédito vuelven a pasar por la RPC, que es idempotente. En régimen normal son
 * tres consultas baratas y CERO llamadas, y un `rescatadas > 0` en la respuesta
 * es la señal de que algo estuvo roto y se acaba de reparar solo.
 *
 * Para lo que caiga fuera de la ventana —o si esto se quedara sin correr—, el
 * rescate a mano es esta consulta, que no inventa nada: es el mismo conjunto
 * que calcula `rescatarRecompensas`, sin límite ni ventana.
 *
 *   select p.id as referido, m.profile_id as referidor, m.rf_campaign_id
 *     from public.profiles p
 *     join public.referral_memberships m on m.code = p.referral_code
 *     join public.referral_campaigns   c on c.rf_campaign_id = m.rf_campaign_id
 *    where p.referral_converted_at is not null
 *      and c.reward_kind <> 'ninguna'
 *      and m.profile_id <> p.id
 *      and not exists (select 1 from public.credits cr
 *                       where cr.source = 'referral'
 *                         and cr.referred_profile_id = p.id
 *                         and cr.beneficiary_id = m.profile_id
 *                         and cr.referral_campaign_id = m.rf_campaign_id);
 *   -- y por cada fila: select public.emitir_credito_de_referido('<referido>');
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
 * Cuánto mira atrás el rescate. 30 días es el mismo horizonte que la caducidad
 * por defecto de la recompensa (`reward_expires_days`), y sobra para que un
 * despliegue que faltaba llegue a su ambiente. No marca un límite duro: lo más
 * viejo se rescata con la consulta de la cabecera.
 */
const DIAS_DE_RESCATE = 30;

/**
 * Candidatos que mira el rescate por pasada. No son llamadas: de estos solo
 * llegan a la RPC los que de verdad no tienen crédito, que en régimen normal
 * son cero. Se miran los más ANTIGUOS primero —son los que están a punto de
 * salirse de la ventana— y el conjunto se vacía, porque lo que no puede
 * premiarse nunca (campaña que no reparte, autorreferencia, código huérfano) se
 * descarta aquí sin llamar.
 *
 * ⚠️ Y no es 1000 por un motivo tonto pero real: estos ids viajan en un
 * `.in(...)` de PostgREST, o sea en la QUERY STRING. Cien uuids son ~4 KB de
 * URL; mil serían un 414 que nadie espera.
 */
const LOTE_RESCATE = 100;

/**
 * RF EXIGE `first_name` en el `POST users`, y `profiles.full_name` es opcional
 * en el alta por Google (llega vacío más veces de las que parece). El respaldo
 * es literal a propósito: ese nombre solo lo ve el cliente en el panel de RF,
 * no el usuario, así que vale más un marcador reconocible que un 422 evitable.
 */
const NOMBRE_DE_RESPALDO = "Invitado";

type ClienteAdmin = ReturnType<typeof createAdminClient>;

/** Lo que puede pasar al emitir. `sin-recompensa` es un desenlace normal. */
type ResultadoRecompensa = "emitida" | "sin-recompensa" | "fallo";

/**
 * La única puerta a `emitir_credito_de_referido`. No lanza nunca: el fallo al
 * premiar no puede tumbar una conversión que RF ya dio por buena.
 *
 * ⚠️ Solo tiene sentido llamarla con `profiles.referral_converted_at` ya
 * escrito: la RPC lo exige por dentro y sin eso devuelve `null` sin ruido.
 */
async function emitirRecompensa(
  supabase: ClienteAdmin,
  profileId: string,
): Promise<ResultadoRecompensa> {
  try {
    const { data: creditoId, error } = await supabase.rpc("emitir_credito_de_referido", {
      p_referido: profileId,
    });

    // Regla de oro 10: sin mirar el `error`, un `permission denied` sobre la
    // RPC —o una migración que no ha llegado a este ambiente— se leería como
    // "esta campaña no reparte" y el job saldría verde para siempre.
    if (error) {
      console.error("[referrals-sync] 🔴 conversión marcada pero SIN recompensa emitida", {
        profile_id: profileId,
        error: error.message,
        // Lo importante para quien lea el log: esto no se reintenta solo en la
        // pasada siguiente por la vía normal. Lo recoge el rescate de arriba.
        rescate: "rescatarRecompensas lo reintenta durante los próximos 30 días",
      });
      return "fallo";
    }

    // `null` = la campaña no reparte, o ya estaba emitida, o la regla no se
    // cumple. Los tres son desenlaces normales, no fallos. (El tipo generado
    // dice `string` porque el generador no modela el null de una RPC escalar.)
    return creditoId ? "emitida" : "sin-recompensa";
  } catch (e) {
    console.error("[referrals-sync] 🔴 excepción al emitir la recompensa", {
      profile_id: profileId,
      error: String(e),
    });
    return "fallo";
  }
}

/**
 * El rescate. Ver la cabecera para el porqué; aquí solo el cómo.
 *
 * Tres consultas acotadas y ninguna llamada cuando no hay nada que reparar.
 * Todo lo que filtra es exactamente lo que la RPC volvería a comprobar por
 * dentro: aquí se filtra para no gastar viajes, no para decidir nada.
 */
async function rescatarRecompensas(supabase: ClienteAdmin) {
  let rescatadas = 0;
  let rescatesFallidos = 0;

  // 1 · ¿Reparte algo alguna campaña? Tres filas. Si ninguna reparte —que es el
  //     estado de salida: `reward_kind` nace en 'ninguna' igual que `visible`
  //     nace en false— no hay nada que rescatar y nos ahorramos el resto.
  const { data: campanas, error: eCampanas } = await supabase
    .from("referral_campaigns")
    .select("rf_campaign_id")
    .neq("reward_kind", "ninguna");

  if (eCampanas) {
    console.error("[referrals-sync] el rescate no pudo leer las campañas", {
      error: eCampanas.message,
    });
    return { rescatadas, rescatesFallidos };
  }
  if (!campanas?.length) {
    return { rescatadas, rescatesFallidos };
  }
  const reparten = new Set(campanas.map((c) => c.rf_campaign_id));

  // 2 · Los convertidos de la ventana. UTC en la base (regla de oro 4): el
  //     corte se calcula en UTC y aquí no se pinta nada, así que no hay
  //     conversión de zona que hacer.
  const desde = new Date(Date.now() - DIAS_DE_RESCATE * 24 * 60 * 60 * 1000).toISOString();

  const { data: convertidos, error: eConvertidos } = await supabase
    .from("profiles")
    .select("id, referral_code")
    .not("referral_converted_at", "is", null)
    .not("referral_code", "is", null)
    .gte("referral_converted_at", desde)
    .order("referral_converted_at", { ascending: true })
    .limit(LOTE_RESCATE);

  if (eConvertidos) {
    console.error("[referrals-sync] el rescate no pudo leer los convertidos", {
      error: eConvertidos.message,
    });
    return { rescatadas, rescatesFallidos };
  }
  if (!convertidos?.length) {
    return { rescatadas, rescatesFallidos };
  }

  // 3 · Quién es el referidor de cada uno y de qué campaña. Es el mismo join por
  //     `code` que hace `referral_conversions_pending`: un `?ref=` inventado no
  //     casa con ninguna membership y se cae aquí. `referral_memberships.code`
  //     es `unique`, así que el mapa no es ambiguo.
  const codigos = convertidos.map((p) => p.referral_code).filter((c): c is string => !!c);
  const { data: membresias, error: eMembresias } = await supabase
    .from("referral_memberships")
    .select("code, profile_id, rf_campaign_id")
    .in("code", codigos);

  if (eMembresias) {
    console.error("[referrals-sync] el rescate no pudo leer las membresías", {
      error: eMembresias.message,
    });
    return { rescatadas, rescatesFallidos };
  }
  const porCodigo = new Map((membresias ?? []).map((m) => [m.code, m] as const));

  const candidatos = convertidos.filter((p) => {
    const m = p.referral_code ? porCodigo.get(p.referral_code) : undefined;
    if (!m) return false; // código huérfano: nunca habrá premio
    if (m.profile_id === p.id) return false; // nadie se refiere a sí mismo
    return reparten.has(m.rf_campaign_id);
  });
  if (!candidatos.length) {
    return { rescatadas, rescatesFallidos };
  }

  // 4 · Y de esos, a quién le FALTA el crédito. `credits` solo deja `select` a
  //     `service_role` (la emisión es una RPC `security definer`), que es justo
  //     lo que hace falta aquí.
  const ids = candidatos.map((p) => p.id);
  const { data: yaEmitidos, error: eCreditos } = await supabase
    .from("credits")
    .select("referred_profile_id")
    .eq("source", "referral")
    .in("referred_profile_id", ids);

  if (eCreditos) {
    console.error("[referrals-sync] el rescate no pudo leer los créditos", {
      error: eCreditos.message,
    });
    return { rescatadas, rescatesFallidos };
  }
  const conCredito = new Set((yaEmitidos ?? []).map((c) => c.referred_profile_id));

  for (const p of candidatos) {
    if (conCredito.has(p.id)) continue;

    const resultado = await emitirRecompensa(supabase, p.id);
    if (resultado === "emitida") rescatadas++;
    else if (resultado === "fallo") rescatesFallidos++;
    // `sin-recompensa` aquí es raro pero posible (la carrera con una campaña
    // que el admin acaba de apagar): ni se cuenta ni se grita.
  }

  if (rescatadas > 0) {
    console.warn(
      `[referrals-sync] rescate: ${rescatadas} recompensa(s) que se habían quedado sin emitir`,
    );
  }

  return { rescatadas, rescatesFallidos };
}

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
  //
  // El rescate también se queda fuera, y es correcto: sin clave no se marca
  // ninguna conversión nueva, así que no puede aparecer ningún hueco nuevo. Los
  // viejos esperan a que vuelva la clave o a la consulta de la cabecera.
  if (!isReferralFactoryConfigured()) {
    return NextResponse.json({ status: "sin-credencial", convertidos: 0 });
  }

  const supabase = createAdminClient();

  // Antes de nada, lo que se quedó a medias en pasadas anteriores. Va primero
  // porque no depende de RF y porque así corre aunque la cola de conversiones
  // venga vacía, que es lo normal.
  const { rescatadas, rescatesFallidos } = await rescatarRecompensas(supabase);

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
  let recompensas = 0;
  let sinRecompensa = 0;
  let recompensasFallidas = 0;

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

      // ⚠️ AQUÍ Y NO ANTES. La RPC exige `referral_converted_at is not null`
      // (ver la cabecera): con el `update` de arriba pendiente devolvería `null`
      // y nadie se llevaría su premio. No se sube ni se saca del bucle.
      //
      // Y un fallo al emitir NO deshace nada de lo de arriba: RF ya tiene la
      // conversión y la marca ya está escrita. Se cuenta aparte, se grita con el
      // `profile_id` dentro de `emitirRecompensa`, y esa fila la recoge el
      // rescate de la pasada siguiente.
      const resultado = await emitirRecompensa(supabase, fila.profile_id);
      if (resultado === "emitida") recompensas++;
      else if (resultado === "sin-recompensa") sinRecompensa++;
      else recompensasFallidas++;
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
    // ── La recompensa ────────────────────────────────────────────────────────
    // Créditos acuñados en esta pasada por conversiones nuevas.
    recompensas,
    // Conversiones cuya campaña no reparte (`reward_kind = 'ninguna'`, el
    // default) o que ya tenían su crédito. Es un desenlace normal: que esto sea
    // igual a `convertidos` significa que el admin no ha configurado el premio
    // en `/admin/referidos`, no que esto esté roto.
    sinRecompensa,
    // 🔴 LO QUE HAY QUE MIRAR. Conversión marcada y premio NO emitido. Si no es
    // cero, o la migración `20260912110000` no está en este ambiente o falta el
    // `grant execute`: lo dice el `console.error` con el `profile_id`.
    recompensasFallidas,
    // Premios de pasadas anteriores que se habían quedado sin emitir y se han
    // recuperado ahora. En régimen normal es 0; un número aquí significa que
    // algo estuvo roto y ya se reparó solo.
    rescatadas,
    // Y los que el rescate tampoco pudo emitir: el fallo sigue vivo.
    rescatesFallidos,
  });
}
