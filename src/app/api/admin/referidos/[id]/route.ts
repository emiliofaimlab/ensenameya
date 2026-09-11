import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exponenteDe, formatEnMoneda } from "@/lib/dinero";

/**
 * Guardar una fila de `/admin/referidos`: título, texto de la recompensa,
 * QUÉ SE REPARTE DE VERDAD, audiencia, visibilidad y orden (§7 de
 * INSTRUCCIONES-DESARROLLO + el diagrama del 11-sep).
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
 *
 * 🔴 Y DESDE EL 12-SEP AQUÍ SE DECIDE DINERO. `reward_kind`, `reward_amount`,
 * `reward_currency` y `reward_expires_days` son lo que
 * `emitir_credito_de_referido` copia dentro de `credits` sin volver a
 * preguntar: el importe que se guarde aquí es el que la plataforma acabará
 * fondeando. Por eso el importe llega en unidades MAYORES y lo convierte el
 * servidor (regla de oro 2, y `aUnidadesMinimas` de más abajo), y por eso se
 * comprueba también lo que ningún `check` puede comprobar: que la moneda sea
 * una que el catálogo cobre de verdad.
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
 * Los tres valores de `referral_campaigns_reward_kind_check`
 * (`20260912110000`). Lista cerrada aquí también, y no por desconfianza del
 * `check`: un `23514` de Postgres sube como 500 y esta pantalla la usa el
 * cliente, no un desarrollador.
 */
const RECOMPENSAS = ["ninguna", "mentoria", "saldo"] as const;
type Recompensa = (typeof RECOMPENSAS)[number];

/** `referral_campaigns_reward_dias_check`: `between 1 and 365`, y `smallint`. */
const DIAS_MIN = 1;
const DIAS_MAX = 365;

/**
 * Techo del tope, en unidades MAYORES.
 *
 * No lo exige ningún `check` —`reward_amount` es `bigint` y aguanta cualquier
 * cosa—, pero este dinero LO PONE LA CASA (`credits.source = 'referral'`, que
 * hay que fondear antes del ciclo de payouts) y una recompensa de siete cifras
 * no es una campaña, es un cero de más. Va en unidades mayores a propósito: un
 * techo fijo en unidades mínimas sería ridículo en una moneda y asfixiante en
 * otra (1.000.000 son 10.000 US$ y unos 250 US$ en COP).
 */
const TOPE_MAX_MAYOR = 1_000_000;

/**
 * Unidades MAYORES (lo que teclea una persona) → unidades mínimas (lo que
 * guarda la columna).
 *
 * 🔴 LA CUENTA LA HACE EL SERVIDOR, no el navegador (regla de oro 2). La
 * pantalla manda la cifra TAL CUAL se escribió —«45», «45,50»— y aquí se
 * decide qué son en unidades mínimas. Si convirtiera el cliente, un `4500` y un
 * `45` llegarían indistinguibles y no habría forma de saber cuál de los dos
 * quería decir 45,00 US$.
 *
 * ⚠️ El factor NO es 100 siempre: `exponenteDe` (src/lib/dinero.ts) ya sabe que
 * cinco mil pesos chilenos son `5000`. Multiplicar por 100 a ciegas guardaría
 * un tope cien veces mayor del que el cliente escribió, en la dirección que
 * nadie reporta.
 *
 * Se hace con aritmética de enteros sobre las dos mitades de la cadena y no con
 * `Number(x) * 100`: `45.67 * 100` es `4566.9999999999995` y aquí no hay ningún
 * `round` que salve nada si el importe crece.
 */
function aUnidadesMinimas(
  mayor: string,
  currency: string,
): { ok: true; minimas: number } | { ok: false; motivo: string } {
  // La coma decimal es la del panel (está en español); el punto también se
  // acepta porque es lo que produce un teclado numérico.
  const texto = mayor.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(texto)) {
    return {
      ok: false,
      motivo:
        "El importe tiene que ser un número positivo con dos decimales como mucho (por ejemplo 15 o 15,50).",
    };
  }

  const [entera, decimal = ""] = texto.split(".");
  const exp = exponenteDe(currency);

  // «5000,50 CLP» no existe. Se rechaza en vez de redondear en silencio: el
  // redondeo sería una decisión sobre el dinero de otro.
  if (exp === 0 && decimal.replace(/0+$/, "") !== "") {
    return {
      ok: false,
      motivo: `El ${currency} no tiene decimales: escribe el importe en unidades enteras.`,
    };
  }

  const minimas =
    exp === 0
      ? Number(entera)
      : Number(entera) * 100 + Number((decimal + "00").slice(0, 2));

  // `referral_campaigns_reward_amount_check`: `reward_amount > 0`.
  if (minimas <= 0) {
    return { ok: false, motivo: "El importe de la recompensa tiene que ser mayor que cero." };
  }
  const techo = TOPE_MAX_MAYOR * 10 ** exp;
  if (minimas > techo) {
    return {
      ok: false,
      motivo: `El importe no puede pasar de ${formatEnMoneda(techo, currency)}.`,
    };
  }

  return { ok: true, minimas };
}

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

  const {
    title,
    reward_text,
    visible,
    audience,
    sort_order,
    reward_kind,
    // ⚠️ Llega en unidades MAYORES y como CADENA: ver `aUnidadesMinimas`.
    reward_amount_major,
    reward_currency,
    reward_expires_days,
  } = (cuerpo ?? {}) as Record<string, unknown>;

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

  // ── QUÉ REPARTE LA CAMPAÑA ────────────────────────────────────────────────
  // Las cuatro columnas del diagrama del 11-sep. Lo que se escriba aquí es lo
  // que `emitir_credito_de_referido` copia dentro de `credits`, o sea dinero:
  // el `check` de la base es la última red, no la primera.
  if (
    typeof reward_kind !== "string" ||
    !RECOMPENSAS.includes(reward_kind as Recompensa)
  ) {
    return mal("La recompensa solo puede ser «ninguna», «mentoria» o «saldo».");
  }
  const kind = reward_kind as Recompensa;

  // `reward_expires_days` es NOT NULL con default 30: se exige siempre, aunque
  // con `kind = 'ninguna'` no lo lea nadie. Así la columna nunca depende de que
  // el cliente se acuerde de mandarla.
  if (
    typeof reward_expires_days !== "number" ||
    !Number.isInteger(reward_expires_days) ||
    reward_expires_days < DIAS_MIN ||
    reward_expires_days > DIAS_MAX
  ) {
    return mal(
      `Los días para agendar tienen que ser un entero entre ${DIAS_MIN} y ${DIAS_MAX}.`,
    );
  }

  // La coherencia que `referral_campaigns_premio_completo` NO puede cerrar por
  // los dos lados: la base exige importe y moneda cuando el premio reparte,
  // pero deja pasar un importe con `kind = 'ninguna'` — un número que nadie
  // lee y que dentro de tres meses se leerá como si valiera.
  let importe: number | null = null;
  let moneda: string | null = null;

  if (kind !== "ninguna") {
    const cruda =
      typeof reward_currency === "string" ? reward_currency.trim().toUpperCase() : "";
    // `char(3)` no comprueba que sean letras: «1 2» cabe igual de bien.
    if (!/^[A-Z]{3}$/.test(cruda)) {
      return mal("La moneda tiene que ser un código ISO-4217 de tres letras (USD, EUR…).");
    }
    moneda = cruda;

    if (typeof reward_amount_major !== "string" && typeof reward_amount_major !== "number") {
      return mal("Falta el importe de la recompensa.");
    }
    const conv = aUnidadesMinimas(String(reward_amount_major), moneda);
    if (!conv.ok) return mal(conv.motivo);
    importe = conv.minimas;
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

  // ── UNA MONEDA QUE NADIE COBRA ES UN PREMIO QUE NO SE PUEDE CANJEAR ───────
  //
  // `credito_aplicable` (`20260912110000`) NO convierte nada: si la moneda del
  // crédito no es la de la reserva devuelve «tu saldo está en otra moneda» y el
  // premio se queda mirando hasta que caduca. Lo pide por escrito el
  // `comment on column referral_campaigns.reward_currency`.
  //
  // ⚠️ SOLO SE COMPRUEBA LO QUE CAMBIA. Si la moneda guardada deja de usarse
  // (el último producto en ella se pausa), editar el TÍTULO de esa campaña
  // seguiría funcionando: bloquear un guardado por un campo que nadie tocó es
  // cómo una validación correcta se convierte en una pantalla rota.
  //
  // ⚠️ Y sin catálogo activo no se rechaza nada: en un entorno recién montado
  // no hay ninguna moneda «buena», y negarlas todas dejaría la campaña sin
  // poder configurarse nunca.
  //
  // ⚠️ El techo de 1000 filas de PostgREST también vale aquí: con un catálogo
  // mayor, una moneda buena que quedara fuera de las mil primeras se
  // rechazaría. Hoy son 18 productos y todos en USD; el día que deje de serlo,
  // la salida es una vista `monedas_del_catalogo` con su `distinct`.
  if (moneda) {
    const actual = await admin
      .from("referral_campaigns")
      .select("reward_currency")
      .eq("rf_campaign_id", rfCampaignId)
      .maybeSingle();
    // Regla de oro 10: sin mirar el `error`, un fallo de lectura se leería como
    // «no tenía moneda guardada» y la comprobación de abajo se dispararía sobre
    // una campaña que no había cambiado nada.
    if (actual.error) {
      return NextResponse.json({ error: actual.error.message }, { status: 500 });
    }
    const guardada = actual.data?.reward_currency?.trim().toUpperCase() ?? null;

    if (moneda !== guardada) {
      const prods = await admin
        .from("products")
        .select("currency")
        .eq("status", "active");
      if (prods.error) {
        return NextResponse.json({ error: prods.error.message }, { status: 500 });
      }
      const monedas = new Set(
        (prods.data ?? []).map((p) => p.currency.trim().toUpperCase()),
      );
      if (monedas.size > 0 && !monedas.has(moneda)) {
        return mal(
          `Ninguna mentoría publicada cobra en ${moneda}, así que esa recompensa no se podría canjear: el canje no convierte monedas. Hoy el catálogo cobra en ${[...monedas].sort().join(", ")}.`,
        );
      }
    }
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
      reward_kind: kind,
      // Con `kind = 'ninguna'` se escriben NULL aunque el navegador haya
      // mandado algo: lo que no reparte, sobra. Dejar el importe puesto haría
      // que la pantalla enseñara un tope que `emitir_credito_de_referido` no
      // mira —sale por `if v_c.reward_kind = 'ninguna' then return null`—, o
      // sea un número creíble y falso.
      reward_amount: importe,
      reward_currency: moneda,
      reward_expires_days,
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
