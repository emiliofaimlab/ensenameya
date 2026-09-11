import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Guardar una fila de `/admin/referidos`: título, recompensa, audiencia,
 * visibilidad y orden (§7 de INSTRUCCIONES-DESARROLLO).
 *
 * Mismas dos cerraduras que el hermano `sync/route.ts`: rol admin leído en el
 * SERVIDOR y escritura con `service_role`, porque `referral_campaigns` no tiene
 * políticas de escritura para `authenticated` (migración `20260911120000`).
 *
 * ⚠️ LO QUE LLEGA AQUÍ LO MANDA UN NAVEGADOR, así que esto es un límite de
 * confianza y no un formulario. El `check (audience in ('alumnos','tutores'))`
 * de la tabla cubriría el caso, pero un `23514` de Postgres subiendo como 500
 * no es una respuesta: es un error de servidor por un dato del cliente. Y el
 * resto no lo cubre nadie —`title` y `reward_text` no tienen longitud máxima en
 * el esquema, y `sort_order` es `smallint`, que desborda con un `22003`—, así
 * que se valida aquí.
 */

/** Caben de sobra «Invita alumnos» y «Ganas 1 clase gratis cuando…» (§8), y
 *  cortan el pegote de 40 KB que dejaría la fila ilegible en la pantalla. */
const TITULO_MAX = 80;
const RECOMPENSA_MAX = 200;

/** El rango real de `sort_order smallint`. Fuera de aquí Postgres da `22003`. */
const SORT_MIN = -32768;
const SORT_MAX = 32767;

const AUDIENCIAS = ["alumnos", "tutores"] as const;

/**
 * Guarda de rol en servidor. `requireRole('admin')` haría `redirect()`, o sea
 * un 307 hacia el HTML del login que un `fetch()` se tragaría como si fuera la
 * respuesta de la API.
 *
 * // ponytail: copiada de `../sync/route.ts`. Un `route.ts` no puede exportar
 * nada que no sea un método HTTP sin romper el typecheck de Next, y el sitio
 * compartido sería un fichero nuevo para diez líneas.
 */
async function soloAdmin(): Promise<NextResponse | null> {
  const { user, roles } = await getSessionContext();
  if (!user) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  if (!roles.includes("admin")) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  return null;
}

const mal = (motivo: string) =>
  NextResponse.json({ error: motivo }, { status: 400 });

export async function PATCH(
  req: Request,
  // Next 16: `params` es una promesa.
  { params }: { params: Promise<{ id: string }> },
) {
  const noPasa = await soloAdmin();
  if (noPasa) return noPasa;

  const { id } = await params;
  const rfCampaignId = Number(id);
  // ⚠️ `Number.isInteger(1e20)` es `true`. Con solo esa comprobación,
  // `/api/admin/referidos/1e20` llegaba a Postgres y volvía como un 500 con el
  // `22003` crudo — justo el «un 500 de Postgres no es una respuesta» que este
  // fichero dice estar evitando, y que con `sort_order` sí se hizo bien.
  // `rf_campaign_id` es `integer`: ese es el rango que hay que exigir.
  if (
    !Number.isSafeInteger(rfCampaignId) ||
    rfCampaignId < 1 ||
    rfCampaignId > 2_147_483_647
  ) {
    return mal("id de campaña no válido");
  }

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return mal("el cuerpo no es JSON");
  }

  const { title, reward_text, visible, audience, sort_order } = (cuerpo ??
    {}) as Record<string, unknown>;

  const titulo = typeof title === "string" ? title.trim() : "";
  if (!titulo) return mal("El título no puede estar vacío.");
  if (titulo.length > TITULO_MAX) {
    return mal(`El título no puede pasar de ${TITULO_MAX} caracteres.`);
  }

  const recompensa = typeof reward_text === "string" ? reward_text.trim() : "";
  if (!recompensa) return mal("El texto de la recompensa no puede estar vacío.");
  if (recompensa.length > RECOMPENSA_MAX) {
    return mal(`La recompensa no puede pasar de ${RECOMPENSA_MAX} caracteres.`);
  }

  if (typeof visible !== "boolean") return mal("«Visible» tiene que ser un booleano.");

  if (typeof audience !== "string" || !AUDIENCIAS.includes(audience as (typeof AUDIENCIAS)[number])) {
    return mal("La audiencia solo puede ser «alumnos» o «tutores».");
  }

  // `sort_order` viaja como número desde la pantalla, pero un `<input
  // type="number">` vacío manda `NaN` si se convierte sin mirar.
  if (
    typeof sort_order !== "number" ||
    !Number.isInteger(sort_order) ||
    sort_order < SORT_MIN ||
    sort_order > SORT_MAX
  ) {
    return mal(`El orden tiene que ser un entero entre ${SORT_MIN} y ${SORT_MAX}.`);
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

  // `synced_at` NO se toca: dice cuándo se habló con RF por última vez, y esto
  // no habla con RF. `updated_at` lo pone el trigger de la migración.
  const { data, error } = await admin
    .from("referral_campaigns")
    .update({
      title: titulo,
      reward_text: recompensa,
      visible,
      audience,
      sort_order,
    })
    .eq("rf_campaign_id", rfCampaignId)
    .select("rf_campaign_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Un `update` que no encuentra la fila NO es un error en PostgREST: devuelve
  // una lista vacía y un 200. Sin esto, borrar una campaña de la base dejaría a
  // la pantalla diciendo «Guardado» para siempre (regla de oro 10, otra vez).
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Esa campaña ya no existe." }, { status: 404 });
  }

  return NextResponse.json({ status: "ok" });
}
