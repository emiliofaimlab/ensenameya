"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * N-23 · Los mensajes sin leer, fuera del hilo.
 *
 * Hasta ahora el Realtime del chat vivía DENTRO de `ChatThread`: si no tenías
 * el hilo abierto, no existía. Este módulo es la otra mitad — un almacén
 * pequeño, compartido por toda la pestaña, que sabe cuántos mensajes te deben
 * en cada conversación y se entera de los nuevos aunque la burbuja esté cerrada.
 *
 * POR QUÉ UN ALMACÉN DE MÓDULO Y NO CONTEXTO DE REACT. Los dos que lo usan no
 * se ven entre sí en el árbol: la burbuja la monta el layout y el hilo puede
 * estar montado dentro de una página cualquiera (`/reservas/[id]`). Un provider
 * que abrazara a ambos tendría que envolver la app entera solo para que el hilo
 * pudiera decirle a la burbuja "esto ya está leído". Con `useSyncExternalStore`
 * el estado vive fuera de React y cada uno se suscribe desde donde esté.
 */

/** Lo que la bandeja necesita saber de UNA conversación. */
export type ConversationUnread = {
  /** Mensajes del OTRO participante posteriores a mi marca de lectura. */
  unread: number;
  /**
   * Cuándo se movió por última vez, en milisegundos locales. Solo sirve para
   * ORDENAR la bandeja, así que no es la hora exacta del mensaje: los que
   * llegan por Realtime se sellan con `Date.now()` al recibirlos.
   *
   * ⚠️ Y es a propósito. Realtime entrega el `created_at` tal y como lo escribe
   * Postgres (`2026-08-17 19:00:00.123+00`) mientras que PostgREST lo devuelve
   * en ISO (`2026-08-17T19:00:00.123+00:00`): comparar las dos cadenas tal cual
   * da SIEMPRE que la de Realtime es menor —el espacio va antes que la `T`—, y
   * eso descartaría en silencio todos los mensajes nuevos. Guardando un número
   * el problema no existe.
   */
  activityAt: number;
};

export type ChatUnreadState = Readonly<Record<string, ConversationUnread>>;

/**
 * ⚠️ `database.types.ts` todavía no conoce las dos RPC de la migración
 * `20260817190000`: los tipos se regeneran con `npm run db:types` DESPUÉS de
 * aplicarla y el archivo no se toca a mano (regla de oro 6). Hasta entonces
 * `supabase.rpc("mark_messages_read")` ni compila —el nombre está tipado contra
 * la unión de funciones conocidas—, así que se llama por esta puerta estrecha,
 * declarada a mano y en un solo sitio. Cuando los tipos se regeneren, esto se
 * borra y se llama directo.
 */
type RpcCaller = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function rpcClient(): RpcCaller {
  return createClient() as unknown as RpcCaller;
}

/** Fila de `unread_message_counts()`. */
type UnreadRow = {
  booking_id: string;
  unread: number;
  last_message_at: string | null;
};

// ── El almacén ───────────────────────────────────────────────────────────────
// `VACIO` es una constante y no un `{}` recién hecho a propósito:
// `useSyncExternalStore` compara la instantánea por identidad, y devolver un
// objeto distinto en cada lectura es un bucle de renders infinito.
const VACIO: ChatUnreadState = {};

let estado: ChatUnreadState = VACIO;
const oyentes = new Set<() => void>();

function avisar() {
  for (const f of oyentes) f();
}

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

function leer(): ChatUnreadState {
  return estado;
}

/**
 * En el servidor no hay nada leído ni sin leer: el HTML sale sin insignias y el
 * navegador las añade al hidratar. Devolver `estado` aquí sería peor que
 * inútil: el módulo es global al proceso durante el SSR y le enseñaría a un
 * usuario los contadores de otro.
 */
function leerEnServidor(): ChatUnreadState {
  return VACIO;
}

/** Suscribe un componente a los contadores. */
export function useChatUnread(): ChatUnreadState {
  return useSyncExternalStore(suscribir, leer, leerEnServidor);
}

/** Total sin leer, contando SOLO las conversaciones que la bandeja lista. */
export function totalUnread(
  state: ChatUnreadState,
  bookingIds: string[],
): number {
  return bookingIds.reduce((n, id) => n + (state[id]?.unread ?? 0), 0);
}

// ── Hilos abiertos ───────────────────────────────────────────────────────────
// Un mensaje que llega a un hilo que tienes DELANTE no está sin leer: lo estás
// viendo. Sin esto, en `/reservas/[id]` —donde el hilo y la burbuja conviven—
// los dos canales reciben el mismo INSERT y el orden entre ellos no está
// garantizado: cuando el de la burbuja llegaba después del "marcar leído" del
// hilo, la insignia se encendía sobre la conversación abierta.
//
// Es un contador y no un `Set` porque en desarrollo React monta, desmonta y
// vuelve a montar cada efecto (StrictMode): con un `Set`, la baja del primer
// montaje borraría el alta del segundo.
const hilosAbiertos = new Map<string, number>();

/**
 * Declara que este componente está enseñando el hilo de `bookingId`, y de paso
 * lo marca como leído. Lo usa `ChatThread`, así que vale igual para el hilo de
 * la burbuja, el de `/chat/[id]`, el de la sala y el de la ficha de reserva.
 */
export function useOpenThread(bookingId: string) {
  useEffect(() => {
    hilosAbiertos.set(bookingId, (hilosAbiertos.get(bookingId) ?? 0) + 1);
    void markConversationRead(bookingId);

    return () => {
      const n = (hilosAbiertos.get(bookingId) ?? 1) - 1;
      if (n > 0) hilosAbiertos.set(bookingId, n);
      else hilosAbiertos.delete(bookingId);
    };
  }, [bookingId]);
}

// ── Mutaciones ───────────────────────────────────────────────────────────────

/**
 * Cuándo se marcó localmente cada conversación como leída (reloj del navegador,
 * solo para comparar con `fetchUnread`). Ver `applyUnreadSnapshot`.
 */
const marcadoEn = new Map<string, number>();

/** Ids de mensajes ya contados por Realtime, para no contar dos veces. */
const vistos = new Set<string>();

/**
 * Aplica la instantánea del servidor (`unread_message_counts`).
 *
 * ⚠️ No es un reemplazo a secas, y las dos salvedades son reales:
 *
 *  1. Entre que la consulta sale y vuelve pueden entrar mensajes por Realtime.
 *     Pisarlos con un recuento que no los incluía apagaría una insignia
 *     legítima → se conserva el número mayor de los dos.
 *  2. Si en esa misma ventana el usuario ABRIÓ la conversación, la instantánea
 *     puede haberse tomado antes de que la marca llegara a la base, y el
 *     "mayor" del punto 1 resucitaría el contador de algo que acaba de leer.
 *     Por eso lo marcado después de arrancar la consulta manda: cero y punto.
 *
 * `iniciada` es el `Date.now()` de cuando se lanzó la consulta. Los dos valores
 * que se comparan salen del MISMO reloj (el del navegador), así que aquí no hay
 * problema de zonas ni de formatos.
 */
function applyUnreadSnapshot(rows: UnreadRow[], iniciada: number) {
  const siguiente: Record<string, ConversationUnread> = {};

  for (const r of rows) {
    const vivo = estado[r.booking_id];
    // O se marcó después de lanzar la consulta, o la marca sigue en vuelo: en
    // los dos casos la instantánea puede ser anterior a la lectura y no vale
    // para esta conversación.
    const leidoDespues =
      (marcadoEn.get(r.booking_id) ?? 0) >= iniciada || marcando.has(r.booking_id);
    const cuando = r.last_message_at ? Date.parse(r.last_message_at) : NaN;

    siguiente[r.booking_id] = {
      unread: leidoDespues ? 0 : Math.max(r.unread, vivo?.unread ?? 0),
      activityAt: Math.max(
        Number.isNaN(cuando) ? 0 : cuando,
        vivo?.activityAt ?? 0,
      ),
    };
  }

  // Conversaciones que solo conoce el estado vivo (llegaron por Realtime
  // después de que la consulta hiciera su foto): se conservan tal cual.
  for (const [id, vivo] of Object.entries(estado)) {
    if (!siguiente[id]) siguiente[id] = vivo;
  }

  estado = siguiente;
  avisar();
}

/** Un mensaje nuevo, visto por Realtime. */
function noteIncoming(messageId: string, bookingId: string, mine: boolean) {
  // El mismo INSERT puede entrar dos veces (una reconexión del websocket, o dos
  // canales en la misma pestaña). Por id, que es lo único que no depende de
  // cómo cada capa serialice la fecha.
  if (vistos.has(messageId)) return;
  vistos.add(messageId);
  // Un tope tonto para que el `Set` no crezca sin fin en una pestaña que lleve
  // días abierta. Vaciarlo entero es aceptable: lo que puede pasar es contar
  // dos veces un mensaje de hace horas, y eso no llega a ocurrir.
  if (vistos.size > 500) vistos.clear();

  const actual = estado[bookingId];
  // Lo propio y lo que llega al hilo abierto no suman, pero sí suben la
  // conversación al principio de la bandeja.
  const suma = mine || hilosAbiertos.has(bookingId) ? 0 : 1;

  estado = {
    ...estado,
    [bookingId]: {
      unread: (actual?.unread ?? 0) + suma,
      activityAt: Date.now(),
    },
  };
  avisar();
}

/**
 * Reservas con un "marcar leído" en vuelo. El valor dice si mientras tanto ha
 * entrado otra petición para la misma: montar el hilo y recibir tres mensajes
 * seguidos no debe disparar cuatro llamadas idénticas, pero tampoco vale
 * descartar las de más y quedarse con una marca anterior al último mensaje
 * —esos mensajes volverían a salir como no leídos en la siguiente visita—.
 * Se colapsan en una sola repetición al final.
 */
const marcando = new Map<string, boolean>();

/**
 * Marca el hilo como leído: pone el contador a cero al instante y lo persiste.
 *
 * El cero optimista es lo que apaga la insignia nada más abrir la conversación,
 * sin esperar a la red. Si la RPC falla se calla: no poder guardar la marca no
 * le estropea nada al usuario (su hilo se ve igual) y un aviso de error por
 * abrir un chat sería ruido. La próxima instantánea lo recalcula.
 */
export async function markConversationRead(bookingId: string): Promise<void> {
  marcadoEn.set(bookingId, Date.now());

  const actual = estado[bookingId];
  if (actual && actual.unread > 0) {
    estado = { ...estado, [bookingId]: { ...actual, unread: 0 } };
    avisar();
  }

  if (marcando.has(bookingId)) {
    marcando.set(bookingId, true); // que la que está en vuelo repita al acabar
    return;
  }

  marcando.set(bookingId, false);
  try {
    for (;;) {
      // La hora de la marca la pone `now()` en el servidor, no el navegador
      // (ver la migración `20260817190000`): un reloj adelantado marcaría como
      // leídos mensajes que aún no han llegado.
      await rpcClient().rpc("mark_messages_read", { p_booking_id: bookingId });
      if (!marcando.get(bookingId)) break;
      marcando.set(bookingId, false);
    }
  } catch {
    // Se traga el fallo a propósito (ver arriba). El `catch` está aunque
    // supabase-js devuelva los errores en `{ error }` en vez de lanzarlos:
    // estas llamadas se hacen con `void`, y una promesa rechazada sin dueño
    // acaba en la consola del usuario como si algo se hubiera roto.
  } finally {
    marcando.delete(bookingId);
  }
}

// ── El vigía ─────────────────────────────────────────────────────────────────

/** Fila de `messages` tal y como la entrega Realtime. */
type IncomingRow = {
  id: string;
  booking_id: string;
  sender_id: string;
};

/**
 * Mantiene los contadores al día mientras el componente esté montado: pide la
 * instantánea y escucha los INSERT de `messages` de TODAS las conversaciones.
 *
 * Lo usa la burbuja, una sola vez por pestaña. El hilo NO lo usa: él ya tiene
 * su canal filtrado por reserva.
 */
export function useChatUnreadWatcher({
  enabled,
  currentUserId,
  reloadKey,
  onMessage,
}: {
  /**
   * La burbuja no se pinta en `/chat/*` ni en `/room/*`. Ahí no hay contador
   * que mantener —el hilo está delante— así que ni se pide el recuento ni se
   * abre el canal.
   */
  enabled: boolean;
  currentUserId: string;
  /** Al cambiar, vuelve a pedir la instantánea (la burbuja, al abrirse). */
  reloadKey?: unknown;
  /** Aviso de mensaje nuevo, con la reserva a la que llegó. */
  onMessage?: (bookingId: string) => void;
}) {
  // El callback se recrea en cada render del padre. En un `ref` para que el
  // canal no se caiga y se levante por eso: reabrir un websocket en cada render
  // es la manera más fácil de perder mensajes.
  //
  // La copia va en un efecto y no en el cuerpo del hook porque escribir en un
  // ref DURANTE el render está prohibido (regla `react-hooks/refs`): con el
  // render concurrente ese render puede descartarse y dejar el ref apuntando a
  // una closure que nunca llegó a la pantalla.
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  // ── Instantánea ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelado = false;
    const iniciada = Date.now();

    void (async () => {
      const { data, error } = await rpcClient().rpc("unread_message_counts");
      if (cancelado || error) return;
      applyUnreadSnapshot((data ?? []) as UnreadRow[], iniciada);
    })();

    return () => {
      cancelado = true;
    };
  }, [enabled, reloadKey]);

  // ── Canal ──────────────────────────────────────────────────────────────────
  // Efecto aparte del de arriba a propósito: `reloadKey` cambia cada vez que se
  // abre la bandeja, y por eso no hay que rehacer el websocket.
  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;

    void (async () => {
      // ⚠️ Con RLS activa hay que autenticar el websocket con el JWT del
      // usuario o NO LLEGA NADA (el mismo paso que hace `ChatThread`). A partir
      // de ahí supabase-js vuelve a llamar a `setAuth` solo en cada
      // `TOKEN_REFRESHED`, así que un canal que viva más de una hora sobrevive
      // a la renovación del token.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelado) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      // ⚠️ SIN `filter`. El de `postgres_changes` es de UNA columna con UN
      // valor (`booking_id=eq.<uuid>`), y aquí hay que escuchar N reservas a la
      // vez. Las dos salidas eran abrir N suscripciones —que crecen con cada
      // reserva y hay que rehacer cada vez que la lista cambia— o suscribirse a
      // la tabla y dejar que la RLS acote. Se elige la segunda: la política
      // `messages_select_participant` es la MISMA barrera que ya decide qué
      // mensajes ve cada quien, y Realtime la aplica fila a fila antes de
      // entregar (por eso EP-17 pudo meter la tabla en la publicación). O sea:
      // por el canal solo bajan mensajes de MIS reservas — el descarte que se
      // hace abajo en el cliente es de comodidad, no de seguridad.
      channel = supabase
        .channel("messages:unread")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            const m = payload.new as IncomingRow;
            noteIncoming(m.id, m.booking_id, m.sender_id === currentUserId);
            onMessageRef.current?.(m.booking_id);
          },
        )
        .subscribe();
    })();

    return () => {
      cancelado = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [enabled, currentUserId]);
}
