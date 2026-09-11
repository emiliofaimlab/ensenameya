import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isReferralFactoryConfigured,
  listCampaigns,
  listRewards,
  ReferralFactoryError,
  type RfReward,
} from "@/lib/referral-factory";

/**
 * «Traer campañas de Referral Factory» (§7 de INSTRUCCIONES-DESARROLLO).
 *
 * LA PUERTA DE DOS CERRADURAS, igual que `/api/admin/expirar-reservas`:
 *   1. la sesión se lee en el SERVIDOR y tiene que traer rol admin;
 *   2. la escritura va con `service_role`, que nunca sale de este fichero.
 * `referral_campaigns` no tiene políticas de escritura para `authenticated`
 * a propósito (migración `20260911120000`): el navegador solo puede PEDIR que
 * se sincronice, no escribir la tabla.
 *
 * ⚠️ POR QUÉ NO ES UN `upsert` DE UNA LÍNEA, que es lo que pedía la
 * especificación. Un `upsert` PISA con sus defaults toda columna que no vaya en
 * el payload: `visible` volvería a `false` y `audience` a `'alumnos'` en cada
 * pasada, y `title`/`reward_text` son NOT NULL sin default, así que ni siquiera
 * se pueden omitir — habría que mandarlos, y mandarlos desde RF significa
 * escribir encima el nombre inglés de RF sobre el texto en español que el admin
 * acaba de teclear. El fallo no avisa: el admin pulsa «Traer campañas», la
 * respuesta dice `ok`, y los textos y los interruptores se han perdido. Por eso
 * se leen primero las filas que ya existen y se separan las dos operaciones:
 * a las conocidas solo se les refrescan los campos `rf_*` y `synced_at`.
 *
 * ⚠️ NO BORRA. Una campaña que desaparezca de RF se queda aquí: quien ya tenga
 * su `referral_memberships` sigue teniendo un enlace vivo, y borrar la fila se
 * llevaría por delante la FK. Para dejar de ofrecerla está `visible`.
 */

/** El texto de arranque de una campaña nueva. `reward_text` es NOT NULL, así
 *  que algo tiene que entrar; que se note que falta editarlo (DP-32.1). */
const REWARD_TEXT_ARRANQUE = "Recompensa por definir.";

/**
 * Guarda de rol en servidor.
 *
 * No se usa `requireRole('admin')` a propósito: esa función hace `redirect()`,
 * que en un Route Handler acaba en un 307 hacia el HTML del login — un `fetch()`
 * lo seguiría y se comería la página de login como si fuera la respuesta de la
 * API. Aquí se contesta con códigos.
 *
 * // ponytail: copiada tal cual en `../[id]/route.ts`. Son diez líneas y el
 * sitio compartido tendría que ser un fichero nuevo; un `route.ts` no puede
 * exportar nada que no sea un método HTTP sin romper el typecheck de Next.
 */
async function soloAdmin(): Promise<NextResponse | null> {
  const { user, roles } = await getSessionContext();
  if (!user) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  if (!roles.includes("admin")) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  return null;
}

export async function POST() {
  const noPasa = await soloAdmin();
  if (noPasa) return noPasa;

  // La credencial es el interruptor (CLAUDE.md): sin ella esto no es un error
  // del programa, es un entorno sin configurar. 503 y un mensaje que diga qué
  // falta, no un 500 con una traza.
  if (!isReferralFactoryConfigured()) {
    return NextResponse.json(
      {
        error:
          "REFERRAL_FACTORY_API_KEY no está configurada en este entorno. Ponla en Vercel y vuelve a pulsar.",
      },
      { status: 503 },
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno" },
      { status: 503 },
    );
  }

  // `allSettled` y no `all`: las recompensas son DECORACIÓN (solo lectura, para
  // que el admin vea qué paga RF), las campañas son el trabajo. Con `all`, uno
  // de los picos de >25 s de RF cayendo sobre `rewards` tiraría también la
  // sincronización de campañas, que es justo lo que el admin vino a hacer.
  const [resCampanas, resRewards] = await Promise.allSettled([
    listCampaigns(),
    listRewards(),
  ]);

  if (resCampanas.status === "rejected") {
    const e = resCampanas.reason;
    const rf = e instanceof ReferralFactoryError ? e : null;
    return NextResponse.json(
      { error: rf ? rf.message : `Referral Factory no respondió: ${String(e)}` },
      // Reintentable → 503 («vuelve a pulsar»); permanente → 502 («algo pasa
      // con la cuenta o la clave»). El admin necesita saber cuál de las dos es.
      { status: rf?.retriable ? 503 : 502 },
    );
  }

  const campanas = resCampanas.value.data ?? [];
  const rewards: RfReward[] =
    resRewards.status === "fulfilled" ? (resRewards.value.data ?? []) : [];

  // Qué filas existen ya. Se lee con `service_role` porque es el mismo cliente
  // que va a escribir: si la RLS del admin y la del escritor no coinciden, se
  // acaba actualizando una fila que la lectura decía que no existía.
  const { data: existentes, error: errorLectura } = await admin
    .from("referral_campaigns")
    .select("rf_campaign_id");

  // Regla de oro 10: `const { data } = …` convertiría este fallo en «no había
  // ninguna fila», y entonces TODAS las campañas se tratarían como nuevas y el
  // insert chocaría contra la PK. El fallo tiene que salir a la pantalla.
  if (errorLectura) {
    return NextResponse.json({ error: errorLectura.message }, { status: 500 });
  }

  const conocidas = new Set((existentes ?? []).map((c) => c.rf_campaign_id));
  const ahora = new Date().toISOString();

  // Solo los campos que MANDA RF. Lo demás (title, reward_text, visible,
  // audience, sort_order) es de esta casa y no se toca.
  const camposRf = (c: (typeof campanas)[number]) => ({
    rf_name: c.name,
    rf_code: c.code,
    rf_url: c.url,
    rf_status: c.status,
    rf_lang: c.lang,
    synced_at: ahora,
  });

  for (const c of campanas.filter((c) => conocidas.has(c.id))) {
    const { error } = await admin
      .from("referral_campaigns")
      .update(camposRf(c))
      .eq("rf_campaign_id", c.id);
    if (error) {
      // Se corta en el primer fallo en vez de seguir y contar: la operación es
      // idempotente, así que la respuesta correcta es «vuelve a pulsar», y un
      // resumen con «2 de 3» obligaría a adivinar cuál faltó.
      return NextResponse.json(
        { error: `No se pudo actualizar la campaña ${c.id}: ${error.message}` },
        { status: 500 },
      );
    }
  }

  const nuevas = campanas.filter((c) => !conocidas.has(c.id));
  if (nuevas.length > 0) {
    const { error } = await admin.from("referral_campaigns").insert(
      nuevas.map((c) => ({
        rf_campaign_id: c.id,
        ...camposRf(c),
        // Apagada, en español provisional y como campaña de alumnos: los tres
        // valores que el admin va a revisar de todas formas. `visible: false`
        // es lo importante — una campaña nueva de RF no se publica sola.
        visible: false,
        audience: "alumnos",
        title: c.name,
        reward_text: REWARD_TEXT_ARRANQUE,
      })),
    );
    if (error) {
      return NextResponse.json(
        { error: `No se pudieron crear las campañas nuevas: ${error.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    status: "ok",
    campañas: campanas.length,
    nuevas: nuevas.length,
    // Van en la respuesta porque `referral_campaigns` NO tiene columna donde
    // guardarlas y la pantalla no puede llamar a RF al renderizar. Ver el
    // comentario de `campaign-manager.tsx`.
    rewards,
  });
}
