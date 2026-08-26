import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AnonymizeResult,
  BucketDeLaBaja,
  DeletionBlockers,
  FicherosPorBucket,
} from "./rpc";

/**
 * EY-192 · B5.9 — baja de cuenta con anonimización.
 *
 * GET  → los motivos por los que HOY no puedes darte de baja (o `{}` si puedes).
 * POST → ejecuta la baja. Irreversible.
 *
 * ── POR QUÉ ESTO ES UN ROUTE HANDLER Y NO UNA RPC LLAMADA DESDE EL NAVEGADOR ─
 * Regla de oro 7: es una operación destructiva sobre datos reales que además
 * toca el esquema `auth`. `anonymize_account` está concedida ÚNICAMENTE a
 * `service_role`, así que desde el cliente no se puede invocar ni con el uid
 * propio ni con el de otro. La función recibe el uid por parámetro porque
 * `service_role` no tiene `auth.uid()`; **quién puede dar de baja a quién se
 * decide AQUÍ**, y la respuesta es siempre «solo a uno mismo»: el uid que se
 * pasa sale de la cookie de sesión, nunca del cuerpo de la petición.
 *
 * ⚠️ Si alguna vez se añade un «dar de baja a este usuario» para el admin, NO
 * se hace aceptando un uid por el body de esta ruta. Se hace en una ruta
 * aparte, bajo `requireRole('admin')` y con su propio registro.
 *
 * ── LA CONFIRMACIÓN ─────────────────────────────────────────────────────────
 * No basta un botón. Hay que escribir el correo de la cuenta, y se comprueba
 * EN EL SERVIDOR contra el de la sesión: una comprobación solo en el cliente
 * no es una confirmación, es una sugerencia. Se eligió el correo y no un
 * «ELIMINAR» genérico porque es imposible de teclear por accidente y porque
 * obliga a mirar de QUÉ cuenta se está hablando — que con varias sesiones
 * abiertas no es evidente.
 *
 * ── ⚠️ EL BORRADO DE FICHEROS VIVE AQUÍ, NO EN EL SQL ───────────────────────
 * `anonymize_account` lo intentaba y la baja devolvía 500: Supabase prohíbe
 * `delete from storage.objects` («Direct deletion from storage tables is not
 * allowed. Use the Storage API instead.», 42501). Desde `20260827100000` la
 * función solo RECOLECTA las rutas y las devuelve; barrerlas es cosa de este
 * handler, que con `service_role` sí puede llamar a la Storage API.
 *
 * El detalle completo —por qué el orden importa y por qué un fallo del barrido
 * NO deshace la baja— está en la cabecera de esa migración y en
 * `barrerFicheros()` de más abajo.
 */

const noAutenticado = () =>
  NextResponse.json({ error: "no autenticado" }, { status: 401 });

async function quienLlama() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { user, supabase, admin: createAdminClient() };
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * `remove()` manda las rutas en el cuerpo de una sola petición. Un tutor con
 * cientos de materiales la haría enorme y se comería un 413 —que además
 * contaría como fallo de TODO el bucket—, así que se trocea.
 */
const TAMANO_LOTE = 100;

/**
 * Barre de Storage los ficheros que `anonymize_account` recolectó.
 *
 * ⚠️ SE LLAMA CON LA ANONIMIZACIÓN YA CONFIRMADA EN BASE DE DATOS, y de ahí
 * salen las dos reglas de esta función:
 *
 *  1 · NO LANZA. Un fallo aquí no puede convertirse en un 500. La identidad ya
 *      está borrada y la cuenta cerrada, que es lo que la persona pidió y lo
 *      que hay que cumplir; un fichero huérfano es un problema menor y, sobre
 *      todo, recuperable a mano. Devolver «no se pudo eliminar tu cuenta»
 *      cuando SÍ se eliminó sería mentir sobre lo único que le importa, y la
 *      empujaría a reintentar o a escribir a soporte por algo ya hecho.
 *  2 · PERO NO SE CALLA. El fallo se registra con las RUTAS CONCRETAS, que es
 *      lo que hace falta para barrerlas desde el panel de Storage, y lo que
 *      quede pendiente se devuelve para anotarlo en el rastro.
 *
 * Un `remove()` sobre una ruta que ya no existe no es error —Storage lo da por
 * bueno—, así que reintentar es seguro y no hay que llevar la cuenta de cuáles
 * se borraron en un intento anterior.
 */
async function barrerFicheros(
  admin: Admin,
  userId: string,
  ficheros: FicherosPorBucket,
): Promise<{ barridos: number; pendientes: FicherosPorBucket }> {
  const pendientes: FicherosPorBucket = {};
  let barridos = 0;

  for (const [bucket, rutas] of Object.entries(ficheros) as [
    BucketDeLaBaja,
    string[] | undefined,
  ][]) {
    if (!rutas?.length) continue;
    const fallidas: string[] = [];

    for (let i = 0; i < rutas.length; i += TAMANO_LOTE) {
      const lote = rutas.slice(i, i + TAMANO_LOTE);
      // El try/catch es por la red: `remove()` devuelve `error` en los fallos
      // de la API, pero un fetch caído sí lanza. Los dos acaban igual.
      try {
        const { error } = await admin.storage.from(bucket).remove(lote);
        if (error) throw error;
        barridos += lote.length;
      } catch (e) {
        fallidas.push(...lote);
        console.error(
          "[EY-192] la cuenta SÍ se anonimizó, pero estos ficheros siguen en Storage:",
          e instanceof Error ? e.message : e,
          { user_id: userId, bucket, rutas: lote },
        );
      }
    }

    if (fallidas.length > 0) pendientes[bucket] = fallidas;
  }

  return { barridos, pendientes };
}

/**
 * Deja en el rastro qué se barrió y qué no.
 *
 * ⚠️ Solo puede escribir `summary`: el grant de `20260827100000` es por columna
 * (`grant update (summary) … to service_role`) justamente para que `deleted_at`
 * y `roles` —que son EL rastro— no se puedan reescribir desde aquí.
 *
 * `ficheros_recolectados` se reenvía tal cual, sin recalcularlo: es el número
 * de auditoría del momento de la baja y no se toca nunca.
 *
 * ⚠️ Y por eso `ficheros_barridos` se deriva de él y NO del contador del bucle.
 * En un reintento el bucle solo ve lo que quedaba pendiente, así que su cuenta
 * sería la de ESTA pasada; lo que hay que dejar escrito es el acumulado.
 */
async function anotarBarrido(
  admin: Admin,
  userId: string,
  recolectados: number,
  pendientes: FicherosPorBucket,
) {
  const quedan = Object.values(pendientes).flat().length;

  const { error } = await admin
    .from("account_deletions")
    .update({
      summary: {
        ficheros: pendientes,
        ficheros_recolectados: recolectados,
        ficheros_barridos: Math.max(0, recolectados - quedan),
      },
    })
    .eq("user_id", userId);

  if (error) {
    // Tampoco es motivo de 500: como mucho el rastro se queda diciendo que hay
    // pendientes que ya no lo están, y un reintento los volvería a barrer sin
    // consecuencias. El log de `barrerFicheros` sigue siendo la vía buena.
    console.error("[EY-192] no se pudo anotar el barrido en el rastro:", error.message, {
      user_id: userId,
      code: error.code,
    });
  }
}

export async function GET() {
  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  const { data, error } = await ctx.admin.rpc("account_deletion_blockers", {
    p_user_id: ctx.user.id,
  });
  if (error) {
    // ⚠️ Se registra en el servidor ADEMÁS de devolverlo. Es una operación
    // irreversible y con una sola oportunidad: si falla, el motivo tiene que
    // quedar en algún sitio que se pueda leer después. Devolverlo solo al
    // navegador significa que quien lo diagnostique dependa de que la persona
    // afectada haya copiado el mensaje, y no lo va a hacer.
    console.error("[EY-192] account_deletion_blockers falló:", error.message, {
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    email: ctx.user.email ?? null,
    bloqueos: (data ?? {}) as DeletionBlockers,
  });
}

export async function POST(req: Request) {
  const { confirmacion } = (await req.json().catch(() => ({}))) as {
    confirmacion?: string;
  };

  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  const email = ctx.user.email?.trim().toLowerCase();
  if (!email) {
    // Sin correo en la sesión no hay nada contra lo que confirmar. Antes de
    // inventarse otra prueba de identidad, se para: es una baja irreversible.
    return NextResponse.json(
      { error: "esta cuenta no tiene correo; escribe a info@ensenameya.com" },
      { status: 409 },
    );
  }

  if ((confirmacion ?? "").trim().toLowerCase() !== email) {
    return NextResponse.json(
      { error: "escribe el correo de tu cuenta tal cual para confirmar" },
      { status: 400 },
    );
  }

  // Se consultan aquí, aunque `anonymize_account` los vuelva a comprobar por
  // dentro, para poder contestar 409 con el motivo en vez de un 500 con el
  // texto de una excepción de Postgres.
  const { data: bloqueos, error: errBloqueos } = await ctx.admin.rpc(
    "account_deletion_blockers",
    { p_user_id: ctx.user.id },
  );
  if (errBloqueos) {
    return NextResponse.json({ error: errBloqueos.message }, { status: 500 });
  }
  const pendientes = (bloqueos ?? {}) as DeletionBlockers;
  if (Object.keys(pendientes).length > 0) {
    return NextResponse.json(
      { error: "la cuenta todavía no puede darse de baja", bloqueos: pendientes },
      { status: 409 },
    );
  }

  const { data, error } = await ctx.admin.rpc("anonymize_account", {
    p_user_id: ctx.user.id,
  });
  if (error) {
    // ⚠️ Se registra en el servidor ADEMÁS de devolverlo. Es una operación
    // irreversible y con una sola oportunidad: si falla, el motivo tiene que
    // quedar en algún sitio que se pueda leer después. Devolverlo solo al
    // navegador significa que quien lo diagnostique dependa de que la persona
    // afectada haya copiado el mensaje, y no lo va a hacer.
    console.error("[EY-192] anonymize_account falló:", error.message, {
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── A PARTIR DE AQUÍ LA BAJA YA ESTÁ HECHA Y NO SE PUEDE DESHACER ─────────
  // Todo lo que sigue es limpieza posterior, y NADA de ello puede acabar en un
  // 500: la transacción de `anonymize_account` ya cerró.
  const resultado = data as AnonymizeResult;

  // ⚠️ El barrido corre también cuando llega `ya_anonimizada`: esa rama trae
  // las rutas que quedaron pendientes y aquí se vuelven a intentar. Por eso las
  // dos ramas tienen la misma forma en `ficheros` — el barrido no distingue.
  //
  // ⚠️ Pero no te fíes de eso como plan de recuperación: a esa rama solo se
  // llega con una petición YA EN VUELO (doble clic, reintento del cliente por
  // timeout). Un reintento posterior ni entra — `anonymize_account` borró la
  // sesión y baneó al usuario, así que `quienLlama()` devuelve 401 arriba. Si
  // el barrido falla de verdad, lo que queda es el log y `summary.ficheros`.
  const barrido = await barrerFicheros(ctx.admin, ctx.user.id, resultado.ficheros ?? {});
  const quedan = Object.values(barrido.pendientes).flat().length;
  if (quedan > 0 || barrido.barridos > 0) {
    await anotarBarrido(
      ctx.admin,
      ctx.user.id,
      // `??` por si la migración `20260827100000` todavía no estuviera aplicada:
      // la versión vieja de la función no devuelve estas claves y entonces no
      // hay nada que barrer ni que anotar (este bloque ni se ejecuta).
      resultado.ficheros_recolectados ?? barrido.barridos + quedan,
      barrido.pendientes,
    );
  }

  // La sesión del navegador ya está muerta —`anonymize_account` borra las filas
  // de `auth.sessions` y `auth.refresh_tokens`—, pero la cookie sigue en el
  // navegador con un JWT que no caduca hasta dentro de ~1 h. El `signOut` de
  // aquí es el que la retira; el cliente además recarga a la portada.
  //
  // ⚠️ Y va envuelto a propósito: la baja YA está confirmada en base de datos
  // cuando se llega aquí. Si `signOut` fallara —y es probable que proteste,
  // porque le está pidiendo a GoTrue que cierre una sesión cuya fila acaba de
  // desaparecer— dejar que la excepción suba convertiría una baja hecha en un
  // «no se pudo eliminar la cuenta» en pantalla. La cookie huérfana ya no
  // autentica nada: su usuario está baneado y sin sesión.
  try {
    await ctx.supabase.auth.signOut();
  } catch {
    // Sin ruido: no hay nada que reintentar ni nada que contarle a la persona.
  }

  // 200 aunque hayan quedado ficheros sin barrer, y es la decisión de la que
  // habla `barrerFicheros`: la baja está hecha. El recuento va en la respuesta
  // porque no cuesta nada y ayuda a diagnosticar desde la pestaña de red; las
  // RUTAS no, que solo hacen falta en el log del servidor.
  return NextResponse.json({
    status: "ok",
    resultado: {
      status: resultado.status,
      ficheros_barridos: barrido.barridos,
      ficheros_pendientes: quedan,
    },
  });
}
