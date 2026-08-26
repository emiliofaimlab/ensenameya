"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaperclipIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ATTACHMENT_TYPES,
  attachmentUrl,
  humanSize,
  uploadAttachment,
  type Attachment,
} from "@/lib/chat/attachments";
import {
  MESSAGE_COLUMNS,
  toChatMessage,
  type ChatMessage,
  type MessageRow,
} from "@/lib/chat/messages";
import { asRpc } from "./rpc";
import { ReportConversation } from "./report-conversation";
import { markConversationRead, useOpenThread } from "./unread";

export type { ChatMessage } from "@/lib/chat/messages";

/** Adjunto: el bucket es privado, así que la URL se firma al hacer clic. */
function AttachmentLink({ a, mine }: { a: Attachment; mine: boolean }) {
  const [busy, setBusy] = useState(false);

  async function open() {
    // El bucket es privado, así que hay que firmar la URL y eso es asíncrono.
    // Para cuando llega, el clic ya no cuenta como gesto del usuario y el
    // navegador bloquea la pestaña. Se abre YA, en blanco, y se le pone la URL
    // al volver. (`noopener` no vale aquí: hace que window.open devuelva null,
    // así que el aislamiento se consigue anulando `opener` a mano.)
    const w = window.open("", "_blank");
    if (w) w.opener = null;

    setBusy(true);
    const url = await attachmentUrl(a.path);
    setBusy(false);

    if (!url) {
      w?.close();
      toast.error("No se pudo abrir el archivo.");
      return;
    }
    if (w) w.location.replace(url);
    else window.location.href = url; // pestañas bloqueadas: mismo destino
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-opacity hover:opacity-80",
        mine ? "bg-background/15" : "bg-background",
      )}
    >
      <PaperclipIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{a.name}</span>
        <span className="block text-[11px] opacity-70">
          {busy ? "Abriendo…" : humanSize(a.size)}
        </span>
      </span>
    </button>
  );
}

/**
 * El hilo 1:1 — el mismo componente para los cinco sitios donde vive (la
 * bandeja, `/chat/[id]`, la sala, la ficha de la reserva del alumno y la del
 * tutor).
 *
 * ── M-12 · QUÉ CAMBIÓ ───────────────────────────────────────────────────────
 * El hilo ya no es "el chat de una reserva" sino la conversación entre dos
 * personas, exista reserva o no. En consecuencia:
 *
 *  · **Se acabó la ventana de RN-41** (2 días antes de la 1ª sesión). No es que
 *    se haya quitado: es que dejó de poder existir. Si el alumno puede escribir
 *    desde la ficha pública del tutor, un candado que solo mira reservas no
 *    cierra nada — solo lograría que el mismo hilo acepte mensajes en un sitio
 *    y los rechace en otro. Por eso ya no se pinta el cartel de "el chat se abre
 *    2 días antes".
 *  · **`firstSessionAt` sigue en las props y ya no se usa.** Lo pasan cuatro
 *    páginas que no son de este carril (`/reservas/[id]`, `/tutor/reservas/[id]`
 *    y la sala); quitarlo de la firma las rompería sin que lo viera ningún
 *    typecheck. Se acepta y se ignora, hasta que esas páginas se limpien.
 *  · **`bookingId` pasó de identidad a contexto.** Si viene, el mensaje se
 *    etiqueta con esa reserva (retención de 30 días por mensaje, adjuntos
 *    permitidos, carpeta de Storage). Si no viene, es una consulta previa a la
 *    compra: sin adjuntos y con topes, los dos impuestos en el servidor.
 *
 * ── MN-06 · Y AHORA EL HILO PUEDE SER DE SOLO LECTURA ───────────────────────
 * El cliente cerró el chat previo a la compra (P-1, 20-ago). Los hilos que ya
 * existían NO se borran: se quedan visibles y sin cuadro de texto. Eso obliga a
 * distinguir tres estados donde antes había dos, y la diferencia entre dos de
 * ellos NO se puede deducir aquí:
 *
 *   · `hasBooking` true                  → hilo de cliente: adjuntos, sin topes.
 *   · `hasBooking` false + `canChat` true → checkout en curso (la reserva vive
 *     en `pending_payment` unos 7 min). Se escribe, sin adjuntos y con topes.
 *   · `canChat` false                    → solo lectura: hilo previo a MN-06, o
 *     par cuya única reserva se canceló.
 *
 * Los dos últimos llegan con el MISMO `hasBooking` y con `bookingId` puesto, así
 * que `canChat` lo dice el servidor (`pair_can_chat`, la misma función que
 * rechaza el envío). Un cuadro de texto que traga lo escrito para devolver un
 * error rojo es peor que uno que no está.
 */
export function ChatThread({
  conversationId: conversationIdProp,
  bookingId,
  currentUserId,
  initialMessages,
  fill,
  hasBooking,
  canChat,
  reservarHref,
  blocked,
  visible = true,
  onIncoming,
}: {
  /** El hilo. Lo pasan las pantallas nuevas (bandeja, `/chat/[id]`). */
  conversationId?: string;
  /**
   * La reserva desde la que se escribe, si la hay. Las pantallas viejas solo
   * pasan esto: la conversación se resuelve aquí dentro.
   */
  bookingId?: string;
  currentUserId: string;
  /**
   * ⚠️ Aceptado por compatibilidad y sin efecto: ver la nota de arriba sobre
   * RN-41. No se destructura para que no parezca que se usa.
   */
  firstSessionAt?: string | null;
  initialMessages: ChatMessage[];
  /** En la sala (LV01) el hilo ocupa el alto de su columna; suelto, no. */
  fill?: boolean;
  /** ¿El par ya compró? Decide los adjuntos y el aviso de los topes. */
  hasBooking?: boolean;
  /**
   * MN-06 · ¿se puede escribir? Lo pasan las pantallas que pueden toparse con
   * un hilo cerrado: la bandeja y `/chat/[id]`.
   *
   * ⚠️ `undefined` significa «sí», y no es pereza. Las otras tres pantallas
   * (`/reservas/[id]`, `/tutor/reservas/[id]` y la sala) solo montan el chat
   * para reservas `confirmed | in_progress | completed`, que están todas dentro
   * de `pair_has_booking` — desde ahí es IMPOSIBLE llegar a un hilo cerrado. Son
   * ficheros de otros carriles y añadirles una prop obligatoria las rompería sin
   * que lo viera ningún typecheck.
   */
  canChat?: boolean;
  /**
   * A dónde mandar a quien no puede escribir todavía. Solo tiene sentido cuando
   * el otro es el TUTOR (el alumno no vende nada): las pantallas que lo saben lo
   * pasan, las demás no, y entonces el aviso se queda sin enlace.
   */
  reservarHref?: string;
  /** Bloqueada por moderación: se lee, no se escribe. */
  blocked?: boolean;
  /**
   * V-2 · ¿el hilo se está VIENDO ahora mismo? Solo lo pasa la sala, que monta
   * el chat siempre y lo esconde con `display:none` al plegar el panel — sin
   * esto, «montado» y «delante» son lo mismo y todo lo que entra con el panel
   * plegado se marca como leído sin que nadie lo lea.
   *
   * Las otras cuatro pantallas no lo pasan porque allí montar el hilo ES
   * enseñarlo, y `true` por defecto conserva su comportamiento exacto.
   */
  visible?: boolean;
  /**
   * V-2 · Aviso de mensaje ajeno que llega **con el hilo escondido**. Es lo que
   * permite a la sala encender su insignia; con `visible` en `true` no se llama
   * nunca, porque entonces el mensaje se está viendo.
   */
  onIncoming?: () => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // La conversación resuelta a partir de `bookingId`, para las pantallas que
  // solo pasan la reserva. Se guarda APARTE de la prop y se combina abajo: un
  // estado inicializado desde la prop tendría que resincronizarse en un efecto
  // —copiar props a estado— y eso son renders en cascada (y un error de
  // `react-hooks/set-state-in-effect`, que aquí avisa con razón).
  const [resuelta, setResuelta] = useState<string | null>(null);
  // `null` mientras se resuelve. Con `null` no se puede ni suscribir ni marcar
  // leído, así que todo lo de abajo espera.
  const conversationId = conversationIdProp ?? resuelta;

  /** La caja con scroll del hilo. Ver el autoscroll, más abajo. */
  const listaRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Con reserva se manda por `send_message` (etiqueta el mensaje, permite
  // adjunto); sin ella, por `send_conversation_message`.
  //
  // Esconder el clip NO es la barrera —esconder un botón no impide nada—: la
  // barrera está en el servidor, y por partida triple (la RPC de consulta no
  // tiene parámetro de adjunto, la RLS de Storage exige carpeta de reserva y un
  // `check` de la tabla ata adjunto y reserva). Esto solo evita ofrecer un
  // botón que únicamente puede terminar en error.
  //
  // ⚠️ `hasBooking === false` con `bookingId` puesto SÍ pasa: es un checkout a
  // medias (la reserva nace en `pending_payment`). Eso no es una compra, así
  // que ni adjuntos ni trato de cliente — el servidor lo reenvía por la vía de
  // consulta aunque se le mande el `booking_id`.
  const puedeAdjuntar = Boolean(bookingId) && hasBooking !== false;
  // «Todavía no ha pagado nadie». Desde MN-06 esto solo puede ser el checkout en
  // curso o un hilo cerrado; la diferencia la marca `soloLectura`, y de ella
  // dependen los textos de abajo.
  const esConsulta = hasBooking === false || (!bookingId && hasBooking === undefined);
  // MN-06 · el hilo está cerrado. `=== false` y no `!canChat`: `undefined` es
  // «no me lo han dicho», y ahí manda el comportamiento de siempre (ver la nota
  // de la prop).
  const soloLectura = canChat === false;

  // N-23 · tener el hilo delante ES leerlo: se marca al abrirlo y, mientras
  // siga DELANTE, la burbuja no cuenta como pendiente lo que entra aquí.
  //
  // V-2 · "delante" y "montado" dejaron de ser lo mismo el día que la sala pasó
  // a arrancar con el chat plegado: allí el hilo vive escondido para no cerrar
  // su Realtime. Ver la nota de `visible`.
  useOpenThread(conversationId, visible);

  // El aviso se recrea en cada render del padre; en un ref para que el canal de
  // Realtime no se caiga y se levante por eso. Mismo motivo —y misma forma— que
  // `onMessageRef` en `useChatUnreadWatcher`: la copia va en un efecto porque
  // escribir en un ref durante el render está prohibido.
  const visibleRef = useRef(visible);
  const onIncomingRef = useRef(onIncoming);
  useEffect(() => {
    visibleRef.current = visible;
    onIncomingRef.current = onIncoming;
  }, [visible, onIncoming]);

  // ── Resolver la conversación desde la reserva (pantallas viejas) ───────────
  useEffect(() => {
    if (conversationIdProp || !bookingId) return;
    let cancelado = false;

    void (async () => {
      const { data } = await asRpc(createClient()).rpc(
        "conversation_of_booking",
        { p_booking_id: bookingId },
      );
      if (!cancelado && typeof data === "string") setResuelta(data);
    })();

    return () => {
      cancelado = true;
    };
  }, [conversationIdProp, bookingId]);

  // ── Histórico completo ─────────────────────────────────────────────────────
  // Quien entra por `bookingId` trae los mensajes DE ESA RESERVA, que ya no son
  // toda la conversación: lo hablado antes de comprar no lleva `booking_id`.
  // Sin este recargado, el histórico continuo se vería en la bandeja y no en la
  // ficha de la reserva — o sea, la mitad de la promesa. Cuando la conversación
  // llega por props, quien pinta ya cargó el hilo entero y esto no se ejecuta.
  useEffect(() => {
    if (conversationIdProp || !conversationId) return;
    let cancelado = false;

    void (async () => {
      const { data } = await createClient()
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .order("created_at");
      if (cancelado || !data) return;
      // Reemplazo y no mezcla: esta consulta es un superconjunto de lo que se
      // pintó al montar. Los que hayan entrado por Realtime entretanto los
      // vuelve a poner el dedup del canal.
      setMessages(data.map((m) => toChatMessage(m as MessageRow)));
    })();

    return () => {
      cancelado = true;
    };
  }, [conversationIdProp, conversationId]);

  // ── Realtime ───────────────────────────────────────────────────────────────
  // Cada INSERT en messages de ESTA conversación. Para tablas con RLS hay que
  // autenticar el websocket con el JWT del usuario (`setAuth`) o los cambios no
  // llegan; la RLS de SELECT limita a sus conversaciones y el filtro la
  // estrecha a esta.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`messages:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const m = payload.new as MessageRow;
            // setMessages directo (y no `append`): el efecto no debe depender
            // de una función que se recrea en cada render.
            setMessages((prev) =>
              prev.some((x) => x.id === m.id)
                ? prev
                : [...prev, toChatMessage(m)],
            );
            // N-23 · lo que llega con el hilo DELANTE se lee al llegar. Sin
            // esto la marca se quedaría en el momento de abrir y esos mensajes
            // volverían a contarse como pendientes en la siguiente visita.
            //
            // V-2 · y lo que llega con el hilo escondido, no. Ahí se avisa al
            // padre para que encienda su insignia: es la sala con el panel
            // plegado, donde el hilo sigue montado precisamente para no perder
            // estos mensajes.
            if (m.sender_id !== currentUserId) {
              if (visibleRef.current) void markConversationRead(conversationId);
              else onIncomingRef.current?.();
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
    // `currentUserId` no cambia en la vida del componente (viene del servidor):
    // está en la lista por la regla de dependencias, no porque se espere que
    // rehaga el canal.
  }, [conversationId, currentUserId]);

  /**
   * V-2 · Autoscroll al último mensaje. Tres cosas, y las tres salieron de que
   * el hilo abría en el mensaje MÁS VIEJO.
   *
   * ⚠️ 1 · SE MUEVE LA CAJA, NO SE «TRAE» UN NODO. Antes era un
   * `scrollIntoView()` sobre un centinela al final, y eso desplaza TODOS los
   * ancestros con scroll — incluida la página. En la sala daba igual (no hay
   * scroll de página), pero en `/reservas/[id]` y en la bandeja el hilo vive a
   * media pantalla: la pantalla cargaba ya desplazada hasta el chat, saltándose
   * la mitad de la ficha. Tocando `scrollTop` de su propia caja, el hilo se
   * coloca solo y la página se queda donde el usuario la dejó.
   *
   * ⚠️ 2 · LA PRIMERA VEZ, INSTANTÁNEA. Con `smooth` desde el montaje el hilo
   * arranca arriba y se desliza; en un hilo largo son varios segundos leyendo lo
   * de hace un mes, y si el navegador respeta «reducir movimiento» el
   * deslizamiento no ocurre y te quedas arriba del todo. A partir de ahí sí se
   * desliza, que es donde el movimiento informa: te enseña que ha llegado algo.
   *
   * ⚠️ 3 · ESCONDIDO NO SE HACE NADA. Una caja en `display:none` no tiene
   * scroll que mover: la llamada no falla, simplemente no hace nada, y el panel
   * de la sala volvía a abrirse en el mensaje más viejo por otro motivo.
   * `visible` está en las dependencias para recolocarlo al desplegar.
   */
  const yaColocado = useRef(false);
  useEffect(() => {
    const caja = listaRef.current;
    if (!visible || !caja) return;
    caja.scrollTo({
      top: caja.scrollHeight,
      behavior: yaColocado.current ? "smooth" : "auto",
    });
    yaColocado.current = true;
  }, [messages, visible]);

  /** Append con dedup por id: Realtime hace eco del propio INSERT. */
  function append(m: ChatMessage) {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);

    const supabase = createClient();
    // Con reserva, la vía de siempre: etiqueta el mensaje con ella, que es lo
    // que le da su retención de 30 días y su carpeta de adjuntos.
    const { data, error } = bookingId
      ? await asRpc(supabase).rpc("send_message", {
          p_booking_id: bookingId,
          p_body: body,
        })
      : await asRpc(supabase).rpc("send_conversation_message", {
          p_conversation_id: conversationId,
          p_body: body,
        });

    setBusy(false);
    if (error) {
      // Los mensajes de las RPC ya vienen redactados para el usuario (el tope
      // de mensajes, el bloqueo de moderación): se enseñan tal cual.
      toast.error(error.message || "No se pudo enviar el mensaje.");
      // ⚠️ B-1 · Y ADEMÁS SE VUELVE A PREGUNTAR AL SERVIDOR, que es la parte que
      // importa. `canChat` se calcula al pintar la pantalla, así que un hilo que
      // se cierra MIENTRAS lo tienes abierto deja un cuadro de texto que ya no
      // sirve: escribes, sale un error rojo, y a escribir otra vez.
      //
      // Con el hold en 7 minutos eso pasa de rareza a caso normal — el checkout
      // abandonado habilita el chat exactamente lo que dura el checkout
      // (`pair_can_chat`, MN-06), y ahora eso son 7 minutos. Refrescando, el
      // servidor recalcula `canChat` y el hilo se convierte solo en la versión
      // de SOLO LECTURA con su enlace a reservar, que ya existe unas líneas más
      // abajo. No hay que adivinar POR QUÉ falló ni leerle el mensaje al SQL:
      // se le pregunta a quien lo sabe.
      router.refresh();
      return;
    }
    setDraft("");
    // El emisor lo ve al instante, sin depender del eco de Realtime (que el
    // dedup por id absorbe si llega). Realtime lo entrega al OTRO participante.
    append({
      id: data as string,
      senderId: currentUserId,
      body,
      createdAt: new Date().toISOString(),
      attachment: null,
    });
  }

  async function attach(file: File) {
    if (!bookingId) return; // sin reserva no hay dónde subirlo (ni RPC que lo acepte)
    setBusy(true);
    const res = await uploadAttachment(bookingId, file);
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    append({
      id: res.id,
      senderId: currentUserId,
      body: "",
      createdAt: new Date().toISOString(),
      attachment: res.attachment,
    });
    toast.success("Documento compartido.");
  }

  const listo = conversationId !== null;

  return (
    <div className={cn("flex flex-col gap-3", fill && "h-full min-h-0")}>
      {/* El aviso de retención dice la verdad de CADA hilo, que no es la misma.
          · Con reserva: el reloj corre por MENSAJE (`expires_at` = now() + 30
            días en cada insert), así que la conversación se erosiona por
            arriba. Eso es AB-01 y sigue sin decidirse; el cartel al menos ya no
            promete un plazo único.
          · Consulta previa: el reloj corre por CONVERSACIÓN y solo si no se
            llega a reservar (decisión b de M-12). No se erosiona: o está el
            hilo entero o no está. */}
      {messages.length > 0 && listo ? (
        <p className="text-[11px] text-muted-foreground">
          {esConsulta
            ? "Si no llegas a reservar, esta conversación se borra a los 30 días del último mensaje."
            : "Los mensajes se borran a los 30 días de escribirse."}{" "}
          <a
            href={`/api/chat/${conversationId}/download`}
            download
            className="font-semibold text-brand hover:underline"
          >
            Descargar la conversación
          </a>
          {esConsulta ? (
            "."
          ) : (
            <>
              . Los archivos adjuntos no van dentro: ábrelos y guárdalos desde
              aquí antes de que el hilo se borre.
            </>
          )}
        </p>
      ) : null}

      <div
        ref={listaRef}
        className={cn(
          "flex flex-col gap-2 overflow-y-auto rounded-lg border p-4",
          fill ? "min-h-0 flex-1" : "max-h-[60vh] min-h-64",
        )}
      >
        {messages.length === 0 ? (
          <p className="m-auto max-w-[42ch] text-center text-sm text-muted-foreground">
            {soloLectura
              ? "En esta conversación no llegó a escribirse nada."
              : esConsulta
                ? // Checkout en curso: quien mira ya está reservando, así que
                  // el texto de M-12 («pregúntale antes de reservar») ya no
                  // describe dónde está. Sin «le» ni «terminas»: el hilo lo
                  // puede abrir cualquiera de los dos.
                  "Aún no hay mensajes. Puedes escribir mientras se completa la reserva."
                : "Aún no hay mensajes. Escribe el primero."}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === currentUserId;
            return (
              <div
                key={m.id}
                className={cn("flex flex-col", mine ? "items-end" : "items-start")}
              >
                {/* N-22 · `wrap-anywhere` + `min-w-0`: una URL larga es una
                    sola "palabra" y sin esto empujaba la burbuja más allá del
                    80 %, metía barra horizontal en el hilo y estrujaba el resto
                    de los mensajes. `wrap-anywhere` (y no `break-words`) porque
                    además de partir la palabra reduce el ancho mínimo del
                    contenido, que es lo que el flex mira para repartir sitio.
                    ⚠️ Nada de `overflow-hidden` aquí: eso no parte la URL, la
                    recorta — el mensaje llegaría cortado y sin manera de leerlo
                    entero. */}
                <div
                  className={cn(
                    "flex max-w-[80%] min-w-0 flex-col gap-1.5 rounded-2xl px-3 py-2 text-sm wrap-anywhere",
                    mine ? "bg-foreground text-background" : "bg-muted",
                  )}
                >
                  {m.attachment ? <AttachmentLink a={m.attachment} mine={mine} /> : null}
                  {m.body ? <span>{m.body}</span> : null}
                </div>
                <time className="mt-0.5 text-[11px] text-muted-foreground" dateTime={m.createdAt}>
                  {new Date(m.createdAt).toLocaleTimeString("es", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            );
          })
        )}
      </div>

      {blocked ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-[13px] text-muted-foreground">
          Esta conversación está bloqueada por moderación. Puedes leerla y
          descargarla, pero no escribir.
        </p>
      ) : soloLectura ? (
        // MN-06 · el cierre se explica y, si se puede, se ofrece la salida. Un
        // cuadro de texto deshabilitado y a secas deja al usuario preguntándose
        // si es un fallo; el enlace convierte el final de camino en el paso que
        // el cliente quería que se diera (reservar).
        //
        // La redacción vale para los DOS lados: el tutor también puede acabar
        // aquí —los hilos previos a MN-06 se cerraron para ambos— y a él no le
        // dice nada un «reserva una mentoría».
        <div className="rounded-lg border border-dashed p-4 text-center text-[13px] text-muted-foreground">
          <p>
            Esta conversación es de solo lectura: no hay ninguna mentoría
            reservada entre los dos.
            {/* Solo se promete descargar cuando hay algo que descargar: el
                enlace de arriba únicamente se pinta con mensajes. */}
            {messages.length > 0 ? " Puedes leerla y descargarla." : null}
          </p>
          {reservarHref ? (
            <Link
              href={reservarHref}
              className="mt-2 inline-block font-semibold text-brand hover:underline"
            >
              Ver sus mentorías
            </Link>
          ) : null}
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {puedeAdjuntar ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept={ATTACHMENT_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void attach(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={busy}
                aria-label="Adjuntar documento"
                onClick={() => fileRef.current?.click()}
              >
                <PaperclipIcon className="size-4" />
              </Button>
            </>
          ) : null}
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              listo ? "Escribe un mensaje…" : "Abriendo la conversación…"
            }
            maxLength={2000}
            disabled={!listo}
          />
          <Button type="submit" disabled={busy || !listo || !draft.trim()}>
            Enviar
          </Button>
        </form>
      )}

      {/* ⚠️ EY-189 · ESTA FRANJA YA NO CUELGA DE `esConsulta`, y ese era el bug.
          Hasta hoy la condición era `esConsulta && listo`, así que el botón de
          reportar SOLO existía en un hilo que nunca llegó a compra. En el chat
          de una reserva pagada —y en el panel de la sala, que monta este mismo
          componente con `hasBooking` en true— no aparecía.
          Es justo del revés de lo que el propio `report-conversation.tsx` dice
          defender: la desintermediación (§21 de los Términos) se propone sobre
          todo DENTRO de una mentoría ya pagada, que es donde hay algo que
          llevarse fuera. Y el acoso no espera a que se cierre el checkout.
          Ahora la franja se pinta en cuanto hay conversación resuelta; lo que
          sigue dependiendo de `esConsulta` es el aviso de los topes, que es el
          único texto que de verdad solo aplica antes de pagar. */}
      {listo ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          {/* Decir el límite ANTES de chocar con él. El servidor es quien lo
              impone (5 seguidos sin respuesta, 20 en total): esto solo evita
              que el alumno se entere por un error rojo.
              En un hilo cerrado no hay límite del que avisar —no se escribe—, y
              el recuadro de arriba ya lo explica. En uno de reserva tampoco:
              ahí no hay topes. `<span>` vacío y no `null` para que el
              `justify-between` siga empujando el botón a la derecha. */}
          <span>
            {esConsulta && !soloLectura
              ? "Hasta que el pago esté confirmado no se pueden enviar archivos y el número de mensajes es limitado."
              : ""}
          </span>
          {/* ⚠️ Reportar sigue disponible en un hilo cerrado, y es deliberado:
              lo que hay que denunciar ya está escrito. */}
          <ReportConversation conversationId={conversationId} />
        </div>
      ) : null}
    </div>
  );
}
