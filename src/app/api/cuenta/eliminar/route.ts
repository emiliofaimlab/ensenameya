import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  rpcNueva,
  type AnonymizeResult,
  type EstadoBaja,
  type ResultadoPeticion,
} from "./rpc";
import { anotarBarrido, barrerFicheros } from "./storage";

/**
 * EY-192 · B5.9 — baja de cuenta con anonimización.
 *
 * GET    → el estado de baja de la cuenta: qué falta y si ya está programada.
 * POST   → pide la baja. Puede acabar en anonimización inmediata o en
 *          «cuenta desactivada, baja programada».
 * DELETE → se arrepiente: reactiva la cuenta y cancela la baja programada.
 *
 * ── LA BAJA YA NO ES SIEMPRE INMEDIATA (migración `20260831160000`) ─────────
 * El cliente lo pidió así: «si tengo saldo, o espero un reembolso, o un retiro
 * pendiente, desactivad la cuenta hasta que se haga ese pago, y LUEGO la
 * borráis». Antes esos tres casos simplemente no dejaban darse de baja, y la
 * persona tenía que volver dentro de dos semanas a repetir la operación.
 *
 * Así que este handler tiene ahora DOS desenlaces, y la diferencia la decide
 * `request_account_deletion` mirando el esquema, no este archivo:
 *
 *   · `sin_espera` → nada en vuelo: se anonimiza AQUÍ Y AHORA, exactamente
 *     como antes. Todo el camino de abajo (barrido de ficheros, `signOut`) es
 *     el de siempre y no ha cambiado una línea.
 *   · `programada` → hay dinero en vuelo: la cuenta queda DESACTIVADA y la
 *     anonimización la hará `process_pending_account_deletions` por pg_cron
 *     cuando el dinero termine de moverse. No se cierra la sesión: la persona
 *     sigue entrando para ver su reembolso llegar y para poder arrepentirse.
 *   · `bloqueada` → quedan cosas que solo puede resolver ella (clases futuras
 *     suyas o ya vendidas). 409 con la lista, como antes.
 *
 * ── POR QUÉ ESTO ES UN ROUTE HANDLER Y NO UNA RPC LLAMADA DESDE EL NAVEGADOR ─
 * Regla de oro 7: es una operación destructiva sobre datos reales que además
 * toca el esquema `auth`. `anonymize_account` está concedida ÚNICAMENTE a
 * `service_role`, así que desde el cliente no se puede invocar ni con el uid
 * propio ni con el de otro. Las funciones reciben el uid por parámetro porque
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
 * ⚠️ Se pide TAMBIÉN para la baja programada, aunque esa sea reversible. Lo
 * que se pide no es «borra esto ya», es «empieza el proceso de borrarlo»: el
 * final es el mismo y el DELETE de más abajo es una ventana, no una promesa.
 *
 * ── ⚠️ EL BORRADO DE FICHEROS VIVE AQUÍ, NO EN EL SQL ───────────────────────
 * `anonymize_account` lo intentaba y la baja devolvía 500: Supabase prohíbe
 * `delete from storage.objects` («Direct deletion from storage tables is not
 * allowed. Use the Storage API instead.», 42501). Desde `20260827100000` la
 * función solo RECOLECTA las rutas y las devuelve; barrerlas es cosa de este
 * handler, que con `service_role` sí puede llamar a la Storage API.
 *
 * ⚠️ Y por eso la baja PROGRAMADA deja ficheros pendientes: cuando la completa
 * el pg_cron no hay ningún handler delante que pueda barrerlos, así que se
 * quedan recolectados en `account_deletions.summary.ficheros` —el mismo estado
 * recuperable de siempre— hasta que pase `POST /api/cuenta/eliminar/barrido`.
 *
 * El detalle completo —por qué el orden importa y por qué un fallo del barrido
 * NO deshace la baja— está en la cabecera de esa migración y en `storage.ts`,
 * que es donde vive el barrido compartido por las dos rutas.
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

export async function GET() {
  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  // ⚠️ Con el cliente de la SESIÓN, no con `admin`: `my_account_deletion_state`
  // no acepta uid y lo saca de `auth.uid()`, así que por construcción no puede
  // devolver el estado de otra persona. Es la misma función que lee «Mi
  // cuenta», para que el diálogo y la tarjeta no puedan contar cosas distintas.
  const { data, error } = await rpcNueva<EstadoBaja>(
    ctx.supabase,
    "my_account_deletion_state",
  );
  if (error) {
    // ⚠️ Se registra en el servidor ADEMÁS de devolverlo. Es una operación
    // irreversible y con una sola oportunidad: si falla, el motivo tiene que
    // quedar en algún sitio que se pueda leer después. Devolverlo solo al
    // navegador significa que quien lo diagnostique dependa de que la persona
    // afectada haya copiado el mensaje, y no lo va a hacer.
    console.error("[EY-192] my_account_deletion_state falló:", error.message, {
      code: error.code,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    email: ctx.user.email ?? null,
    estado: data ?? { accionables: {}, en_espera: {}, baja_programada: null },
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

  // Aquí se decide TODO: si hay bloqueos que solo puede resolver la persona, si
  // hay dinero en vuelo (y entonces se desactiva la cuenta y se programa), o si
  // hay vía libre para borrar ya. La decisión vive en SQL y no aquí porque es
  // la misma que `anonymize_account` vuelve a comprobar por dentro: dos
  // definiciones de «no puedes» divergirían el primer día.
  const { data: peticion, error: errPeticion } = await rpcNueva<ResultadoPeticion>(
    ctx.admin,
    "request_account_deletion",
    { p_user_id: ctx.user.id },
  );
  if (errPeticion || !peticion) {
    console.error("[EY-192] request_account_deletion falló:", errPeticion?.message, {
      code: errPeticion?.code,
    });
    return NextResponse.json(
      { error: errPeticion?.message ?? "no se pudo procesar la baja" },
      { status: 500 },
    );
  }

  if (peticion.status === "bloqueada") {
    return NextResponse.json(
      {
        error: "la cuenta todavía no puede darse de baja",
        accionables: peticion.accionables,
        en_espera: peticion.en_espera,
      },
      { status: 409 },
    );
  }

  // Cuenta desactivada y baja en cola. **No se cierra la sesión a propósito**:
  // lo que está esperando es dinero suyo, y necesita poder entrar a verlo
  // llegar —y a arrepentirse—. Ver la cabecera de la migración.
  if (peticion.status === "programada" || peticion.status === "ya_programada") {
    return NextResponse.json({
      status: "programada",
      en_espera: peticion.en_espera,
    });
  }

  // No debería llegar (la sesión de una cuenta anonimizada está muerta y
  // `quienLlama` habría devuelto 401), pero contestar 409 es mejor que caer al
  // camino de abajo y volver a anonimizar lo ya anonimizado.
  if (peticion.status === "ya_anonimizada") {
    return NextResponse.json(
      { error: "esta cuenta ya está dada de baja" },
      { status: 409 },
    );
  }

  // ── `sin_espera`: nada en vuelo → se borra ahora, como toda la vida ───────
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
  // el barrido falla de verdad, lo recoge `POST /api/cuenta/eliminar/barrido`.
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

/**
 * Se arrepintió. Reactiva la cuenta y cancela la baja programada.
 *
 * ⚠️ NO pide confirmación por correo, a diferencia del POST, y no es una
 * incoherencia: lo que se confirma es lo irreversible. Ponerle fricción a
 * «quiero conservar mi cuenta» solo consigue que alguien que ya se arrepintió
 * no llegue a tiempo.
 *
 * Solo funciona mientras la baja siga `pending`; una vez completada, la sesión
 * está muerta y esta ruta devuelve 401 antes de llegar a nada.
 */
export async function DELETE() {
  const ctx = await quienLlama();
  if (!ctx) return noAutenticado();

  const { data, error } = await rpcNueva<{ status: "cancelada" | "sin_baja" }>(
    ctx.admin,
    "cancel_account_deletion",
    { p_user_id: ctx.user.id },
  );
  if (error) {
    console.error("[EY-192] cancel_account_deletion falló:", error.message, {
      code: error.code,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // `sin_baja` no es un error: es el doble clic, o la pestaña vieja que aún
  // creía que había una baja en curso. La cuenta está activa, que es lo que se
  // pedía, así que 200.
  return NextResponse.json({ status: data?.status ?? "sin_baja" });
}
