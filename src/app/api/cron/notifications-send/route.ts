import { NextResponse } from "next/server";

import { construirIcs } from "@/lib/calendar/ics";
import type { EventoFeed } from "@/lib/calendar/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailConfigured, sendEmail, type Adjunto } from "@/lib/email";
import { renderEmail, type Contexto } from "@/lib/email-templates";

/**
 * US-1201 · vacía la cola de notificaciones por correo y las envía de verdad.
 *
 * Sustituye al stub `process_notifications()`, que marcaba todo como enviado
 * sin enviar nada (ver `20260806150000`). Esa función sigue existiendo pero ya
 * solo informa: si las pendientes crecen sin parar, es que este job no corre.
 *
 * Lo dispara GitHub Actions y NO Vercel Cron, aunque la purga de grabaciones sí
 * use Vercel: el plan Hobby limita los crons a una vez al día, y un aviso de
 * "tienes 24 h para aceptar esta reserva" que llega mañana no sirve de nada.
 * Actions da logs y reejecución manual, y sale mucho más a menudo que una vez
 * al día. ⚠️ Lo que NO da es la cadencia que pone en el `.yml`: está pedido cada
 * 5 minutos y, medido sobre corridas reales, entrega **una cada 2-6 horas**.
 * Es aceptable para un aviso y no lo sería para un cobro; lo que no vale es
 * planificar con «5 minutos».
 *
 * Desde el Doc 33 este job hace tres cosas más que enviar: pasa el huso y el
 * contexto que la RPC resuelve (para que la hora salga en la del destinatario,
 * RN-35), propaga la marca `baja` a la cabecera `List-Unsubscribe`, y adjunta el
 * `.ics` de la clase en la confirmación de reserva.
 */

/**
 * Por pasada. El tope de la RPC son 200; 50 es lo que cabe cómodamente en el
 * tiempo de una función de Vercel enviando un correo por fila. Si la cola
 * creciera más rápido de lo que este lote la vacía, se sube aquí — no se baja
 * el intervalo, que no lo decidimos nosotros.
 */
const LOTE = 50;

/**
 * ⚠️ PUERTA ESTRECHA, y con fecha de caducidad.
 *
 * `20260911170000` le añadió a `pending_email_notifications` dos columnas
 * —`timezone` y `contexto`— y `src/lib/database.types.ts` todavía no las
 * conoce: los tipos se regeneran con `npm run db:types` DESPUÉS de aplicar la
 * migración y ese fichero no se toca a mano (regla de oro 6). Hasta entonces se
 * declaran aquí SOLO las dos nuevas y se intersectan con la fila generada, que
 * sigue mandando en las otras seis. Nada de `any`: si mañana la RPC devuelve una
 * tercera columna, hay que venir a escribirla.
 *
 * Es la misma puerta que ya abrieron `src/app/(app)/tutor/payouts/rpc.ts`,
 * `src/components/chat/rpc.ts` y `src/app/api/cuenta/eliminar/rpc.ts`. Va aquí
 * dentro y no en un `rpc.ts` aparte porque tiene UN solo consumidor —este
 * fichero— y un módulo entero para dos campos es más fácil de olvidar que de
 * borrar. El día que se regeneren los tipos: fuera este bloque y fuera el `as`
 * de abajo, y ya está.
 */
type ColumnasDelDoc33 = {
  /** `coalesce(nullif(profiles.timezone,''),'UTC')`: nunca vacío (RN-35). */
  timezone: string | null;
  /**
   * Lo que la RPC resuelve para las plantillas. Todas sus claves son
   * opcionales: la que no se pudo resolver DESAPARECE (`jsonb_strip_nulls`),
   * nunca llega `null` ni cadena vacía.
   */
  contexto: Contexto | null;
};

/** La plantilla —y la única— que lleva el evento adjunto. */
const PLANTILLA_CON_ICS = "booking_confirmed_student";

/**
 * El `.ics` de la clase, para adjuntarlo a la confirmación (Doc 33 §5.2).
 *
 * ── POR QUÉ SE ARMA CON EL CONTEXTO Y NO SE CONSULTA LA SESIÓN ──────────────
 * La tentación es pedirle la fila a `sessions` con el cliente admin y tener
 * `end_at`, `session_ref` y el «Sesión 2 de 4» de verdad. No se hace, por tres
 * motivos en este orden:
 *
 *   1. La columna `contexto` EXISTE para no volver a consultar por fila. La
 *      cabecera de `20260911170000` lo dice con todas las letras: se resuelve
 *      por lote «en vez de un N+1». Meter aquí una consulta por correo
 *      reintroduce justo lo que esa migración vino a quitar.
 *   2. Regla de oro 9. `service_role` se salta la RLS pero no los `grant`:
 *      `sessions` los tiene (`20260806140000`), pero el embed que haría falta
 *      para `session_ref`/`num_sessions` pasa por `bookings` y `products`, y un
 *      `permission denied` ahí no rompe el build ni el typecheck — se come el
 *      adjunto en silencio, que es el fallo más caro de encontrar.
 *   3. Lo que se pierde es cosmético: `CREATED`/`LAST-MODIFIED` y la línea del
 *      número de sesión. Lo que sostiene el evento —`DTSTART`, `DTEND`,
 *      `SUMMARY`, el `UID` y el enlace a la sala— sale entero del contexto.
 *
 * ⚠️ SALE IDÉNTICO AL DE `/api/calendario/sesion/[sessionId]`, y tiene que
 * seguir saliendo así: los dos son `suelto: true` sobre la misma sesión, o sea
 * el MISMO `UID` (`<id>-suelto@ensenameya.com`). Quien adjunte este y además
 * pulse «Añadir al calendario» en el cuerpo del correo importa dos veces el
 * mismo evento; con la misma forma eso es una actualización inocua, con formas
 * distintas es una clase que cambia de nombre sola. Por eso `secuencia: 0` y
 * `con: null` se copian de allí en vez de mejorarse aquí.
 *
 * Devuelve `undefined` —no lanza— ante cualquier duda: un `.ics` roto no puede
 * costar la confirmación de una reserva.
 */
function adjuntoIcs(
  template: string,
  c: Contexto | null,
  origin: string,
): Adjunto[] | undefined {
  if (template !== PLANTILLA_CON_ICS) return undefined;
  // Sin estos cuatro no hay evento que valga. `duracion_min` entra en la lista
  // aunque el pliego solo pida tres: sin ella habría que inventarse el `DTEND`,
  // y un evento que ocupa la hora equivocada en la agenda del alumno es peor
  // que no tener evento. El enlace «Añadir al calendario» del cuerpo sigue ahí
  // para ese caso, y ese sí sabe la duración real.
  if (!c?.sesion_id || !c.inicio || !c.clase || !c.duracion_min) return undefined;

  try {
    const inicio = new Date(c.inicio);
    // `new Date("cualquier cosa")` no lanza: devuelve `Invalid Date`, y de ahí
    // sale un `.ics` con `DTSTART:Invalid`. Se comprueba a mano.
    if (Number.isNaN(inicio.getTime())) return undefined;

    const fin = new Date(inicio.getTime() + c.duracion_min * 60_000);
    const cuando = inicio.toISOString();

    const evento: EventoFeed = {
      session_id: c.sesion_id,
      start_at: cuando,
      end_at: fin.toISOString(),
      // `CREATED` y `LAST-MODIFIED` no los trae el contexto. Se usa el inicio
      // de la clase: con `SEQUENCE` fijo en 0 ningún cliente los mira para
      // decidir qué versión gana, así que su único trabajo es ser fechas
      // válidas y coherentes entre sí.
      created_at: cuando,
      updated_at: cuando,
      // Este correo es, literalmente, el de «el tutor aceptó tu reserva».
      estado: "confirmada",
      // ⚠️ `0` es deliberado, igual que en la descarga suelta: el feed calcula
      // el SEQUENCE como segundos entre el alta y el último cambio, así que
      // siempre gana él. Si no, el `.ics` del correo competiría con el del
      // calendario suscrito y ganaría el congelado.
      secuencia: 0,
      titulo: c.clase,
      // El contexto trae el nombre ENTERO del tutor y el feed lo enmascara
      // («María G.»). No se pone por lo de arriba: mismo UID, misma forma.
      con: null,
      session_ref: null,
      sequence_no: null,
      num_sessions: 1,
    };

    const ics = construirIcs({
      eventos: [evento],
      // Las fechas van en UTC con `Z`, así que la zona solo sería una pista de
      // presentación y en un evento suelto no pinta nada. El huso del
      // destinatario ya manda en el CUERPO del correo, que es donde se lee.
      timezone: "UTC",
      origin,
      suelto: true,
    });

    return [
      {
        // Genérico a propósito: el nombre del fichero lo ve el alumno en el
        // adjunto y `session_ref` no le dice nada.
        filename: "mentoria.ics",
        content: Buffer.from(ics, "utf8").toString("base64"),
        contentType: "text/calendar; charset=utf-8",
      },
    ];
  } catch {
    // Cualquier sorpresa (una fecha imposible, un contexto con formas raras) se
    // traga aquí: el correo sale igual, sin adjunto.
    return undefined;
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // Falla cerrado, igual que la purga: sin secreto esto sería un endpoint
  // público capaz de disparar correos a los usuarios.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // Sin proveedor no se toca la cola: quedan `pending`, no `failed`. El día que
  // se ponga la clave sale todo lo acumulado en la primera pasada.
  if (!isEmailConfigured()) {
    return NextResponse.json({ status: "sin-proveedor", enviadas: 0 });
  }

  const supabase = createAdminClient();

  // El origen sale de la propia petición: en Vercel siempre es el despliegue
  // que la atiende, así que los enlaces nunca apuntan al entorno equivocado y
  // no hay una variable más que mantener. Lo comparten los enlaces del correo y
  // el `LOCATION`/`URL` del `.ics`.
  const origen = new URL(req.url).origin;

  // El correo del destinatario vive en `auth.users`. La RPC lo resuelve dentro
  // (SECURITY DEFINER) para no exponer auth ni hacer una llamada por persona, y
  // desde `20260911170000` resuelve también el huso y el contexto del mismo
  // viaje: una consulta por LOTE, no una por correo.
  const { data: lote, error } = await supabase.rpc("pending_email_notifications", {
    p_limit: LOTE,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let enviadas = 0;
  let permanentes = 0;
  let reintentables = 0;

  for (const fila of lote ?? []) {
    // La puerta estrecha de arriba, en su único uso.
    const n = fila as typeof fila & ColumnasDelDoc33;

    const render = n.email
      ? renderEmail({
          template: n.template,
          payload: n.payload as Record<string, unknown> | null,
          nombre: n.nombre ?? "",
          baseUrl: origen,
          contexto: n.contexto,
          timezone: n.timezone,
        })
      : null;

    // Sin dirección o sin plantilla no hay reintento que valga: son errores
    // permanentes y reintentarlos cada pasada solo llenaría el log.
    if (!render) {
      await supabase.rpc("mark_notification", { p_id: n.id, p_ok: false });
      permanentes++;
      continue;
    }

    // `render` trae `subject`, `html`, `text` y `baja`; ese último viaja en el
    // spread hasta la cabecera `List-Unsubscribe` sin que este job tenga que
    // saber qué correos son no esenciales — lo sabe la plantilla.
    const res = await sendEmail({
      to: n.email!,
      ...render,
      adjuntos: adjuntoIcs(n.template, n.contexto, origen),
    });

    if (res.ok) {
      await supabase.rpc("mark_notification", { p_id: n.id, p_ok: true });
      enviadas++;
      continue;
    }

    // Transitorio (429 o 5xx del proveedor, red caída): se deja `pending` a
    // propósito y lo coge la pasada siguiente. Marcarlo `failed` perdería el
    // aviso para siempre por un mal minuto de Resend.
    if (res.retriable) {
      reintentables++;
      continue;
    }

    await supabase.rpc("mark_notification", { p_id: n.id, p_ok: false });
    permanentes++;
  }

  return NextResponse.json({
    status: "ok",
    revisadas: lote?.length ?? 0,
    enviadas,
    fallosPermanentes: permanentes,
    // Si esto no baja entre pasadas, el problema es del proveedor, no de la cola.
    pendientesDeReintento: reintentables,
  });
}
