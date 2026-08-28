"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftIcon, MessageCircleIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import { ChatThread } from "./chat-thread";
import {
  conversationSubtitle,
  counterpartFallback,
  toConversation,
  type Conversation,
} from "./types";
import { asRpc, type ConversationRow } from "./rpc";
import {
  consumirPeticion,
  peticionSnapshot,
  subscribePeticion,
  type PeticionDeHilo,
} from "./open-thread";
import {
  totalUnread,
  useChatUnread,
  useChatUnreadWatcher,
} from "./unread";
import {
  MESSAGE_COLUMNS,
  toChatMessage,
  type ChatMessage,
  type MessageRow,
} from "@/lib/chat/messages";

export type { Conversation } from "./types";

/** Con quién hablas, o el respaldo por rol. Nunca un "Alumno" de relleno. */
function nombreDe(c: Conversation): string {
  return c.counterpart ?? counterpartFallback(c.counterpartRole);
}

/**
 * En el servidor NUNCA hay petición pendiente.
 *
 * Vive a nivel de módulo porque `useSyncExternalStore` la llama en cada render
 * de hidratación y una closure nueva no cambiaría nada, pero sí ensucia; y
 * devuelve `null` —no `peticionSnapshot()`— por lo mismo que `leerEnServidor`
 * en `unread.ts`: el almacén es global al proceso durante el SSR y leerlo allí
 * sería enseñarle a un usuario el recado de otro.
 */
const sinPeticionEnServidor = () => null;

/**
 * Cuánto ocupa la burbuja POR ENCIMA del cuerpo del panel, en píxeles:
 * 20 del `bottom-5` + 56 del botón (`size-14`) + 12 del `gap-3` + 64 de la
 * cabecera con su subtítulo (medido) + 16 de margen para no pegarse al borde.
 *
 * ── ⚠️ ESTO ARREGLA UN DESBORDE REAL, Y ESTÁ MEDIDO ─────────────────────────
 * Con la altura fija de antes (`h-[min(70vh,520px)]`) el panel crecía hacia
 * ARRIBA sin mirar si cabía. Medido en el navegador, a 375 px de ancho:
 *
 *   · ventana de 600 px de alto → el panel empieza en **+28 px**. Aguanta.
 *   · ventana de 480 px de alto → empieza en **−7 px**: ya se sale.
 *   · ventana de 400 px de alto → el «volver» y el «cerrar» están en **−8 px**,
 *     o sea FUERA de la pantalla. El hilo solo se podía cerrar con Escape.
 *
 * (Un informe previo situaba el corte en ~573 px. No es ahí: la cuenta real es
 * `0,3·H − 152 < 0`, o sea **por debajo de ~507 px** el panel se sale y por
 * debajo de ~430 px se va la cabecera entera. Se deja escrito porque el número
 * de aquí depende de esa cuenta.)
 *
 * Y no es un caso de laboratorio: un móvil en horizontal, o uno en vertical con
 * el teclado abierto, están ahí. Con el `clamp` de abajo, a 400 px el panel
 * empieza en +17 px y la cabecera en +40.
 *
 * En `dvh` y no en `vh` a propósito: en móvil `vh` mide la ventana como si la
 * barra del navegador no estuviera, que es justo la altura que NO tienes
 * mientras la barra está a la vista.
 */
const ALTO_FUERA_DEL_CUERPO = "168px";

/**
 * Burbuja flotante de chat (R24-21, decisión 15): una **bandeja** al estilo
 * LinkedIn — abre la lista de conversaciones y el hilo **dentro de la propia
 * burbuja**, sin sacar a nadie de la página en la que está (reunión 7-ago).
 *
 * `/chat/[id]` sigue existiendo para enlaces directos; esto es la vía rápida,
 * no su sustituto. Solo se monta con sesión (lo decide `ChatLauncher`).
 *
 * N-23 · y además SE ENTERA: los no leídos salen de `./unread`, que mantiene su
 * propio canal de Realtime a nivel de burbuja.
 *
 * M-12 · y ahora la bandeja es de PERSONAS, no de reservas. Una fila por cada
 * tutor (o alumno) con el que hablas, tenga o no reserva de por medio, y ahí
 * dentro está todo lo hablado con esa persona — incluido lo de antes de
 * comprar. Era lo que la decisión 15 ya pedía al llamarla "bandeja tipo
 * LinkedIn": en una bandeja se habla con gente, no con facturas.
 *
 * ── Y AHORA TAMBIÉN SE ABRE POR ID (`./open-thread`) ────────────────────────
 * Hasta hoy solo sabía abrir un hilo que YA estuviera en la lista del servidor:
 * `setAbierta(c)` sobre un objeto que tenía delante. Eso dejaba fuera
 * exactamente el hilo que más falta hace — el que «Escribir a X» acaba de crear
 * desde la ficha pública del tutor, que no tiene ni mensajes ni reserva —.
 * Ahora escucha el buzón de `open-thread.ts` y resuelve el id ella misma, con
 * la lista del servidor primero y `my_conversations()` después.
 */
export function ChatBubble({
  conversations,
  currentUserId,
  esTutor,
}: {
  conversations: Conversation[];
  currentUserId: string;
  /**
   * Solo para redactar el estado vacío. Es lo único que cambia entre un tutor
   * y un alumno en toda la burbuja, y sin este dato la frase tenía que hablarle
   * a los dos a la vez — que es como se acaba escribiendo algo que no es verdad
   * para ninguno.
   */
  esTutor: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Cuántas veces se ha desplegado la bandeja. Es la señal de "vuelve a pedir el
  // recuento": el momento en que el número importa de verdad es justo cuando el
  // usuario lo mira, y así cualquier desajuste acumulado se corrige solo.
  const [aperturas, setAperturas] = useState(0);
  const [abierta, setAbierta] = useState<Conversation | null>(null);
  /**
   * Los mensajes del hilo, ETIQUETADOS con la conversación de la que salieron.
   *
   * La etiqueta no es adorno: entre que `abierta` cambia y que llega la
   * consulta de los mensajes nuevos hay un render en el que el estado dice
   * «conversación B» y los mensajes siguen siendo los de A. Sin la etiqueta ese
   * render pinta el hilo de B con las frases de A —y como `ChatThread` lleva
   * `key`, se monta con ellas como `initialMessages`—. Comparando el id se
   * enseña «Abriendo…» hasta que lo de dentro corresponde al título.
   */
  const [mensajes, setMensajes] = useState<{
    conversationId: string;
    lista: ChatMessage[];
  } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const ultimoRefresco = useRef(0);

  // En el propio hilo la burbuja sobra (y taparía el composer). El cálculo va
  // aquí arriba, y no como un `return null` antes de tiempo, porque los hooks
  // de abajo tienen que llamarse siempre; lo que hace `visible` es apagarles el
  // trabajo (ni recuento ni websocket) mientras no se pinta nada.
  // ⚠️ Lo de `/room/` es un cinturón, no una condición viva: desde MN-04 la sala
  // cuelga del grupo `(room)`, que NO monta el launcher —solo lo montan `(app)`
  // y `(public)`—, así que esa rama ya no puede darse. Se conserva para que
  // devolver la ruta a `(app)` no reviva la burbuja flotante encima del vídeo.
  const visible =
    !pathname.startsWith("/chat/") && !pathname.startsWith("/room/");

  const unread = useChatUnread();

  /**
   * Conversaciones que la lista del servidor NO trae y esta burbuja ha tenido
   * que resolver por su cuenta (ver `resolverConversacion`).
   *
   * ── POR QUÉ SE AÑADEN A LA LISTA VISIBLE Y NO SOLO SE ABREN ───────────────
   * Porque la bandeja es el sitio al que se VUELVE. El botón «volver» del hilo
   * lleva a la lista, y si la conversación que acabas de leer no está en ella,
   * lo que ves es una bandeja donde no aparece la persona con la que estabas
   * hablando hace dos segundos: se lee como que el mensaje se ha perdido, no
   * como que la lista tiene un filtro. Y hay una segunda razón menos visible:
   * la insignia de no leídos se calcula SOLO sobre las conversaciones listadas
   * (`totalUnread`), así que un hilo abierto pero no listado tendría mensajes
   * sin leer que no cuentan en el contador — un número que miente por defecto.
   *
   * Duran lo que dure la página. Un `router.refresh()` puede traerlas ya en la
   * lista del servidor (y entonces se descartan por id, abajo) o no traerlas
   * —el filtro de `ChatLauncher`, el tope de 30—, y en ese caso se quedan aquí
   * hasta que se recargue de verdad. Es deliberado: lo que has abierto en esta
   * visita sigue a la vista en esta visita.
   */
  const [extras, setExtras] = useState<Conversation[]>([]);

  const todas = useMemo(() => {
    if (extras.length === 0) return conversations;
    const conocidas = new Set(conversations.map((c) => c.id));
    // Las del servidor mandan: si la misma conversación viene por los dos
    // caminos, la suya es la que está al día (`lastMessageAt`, `hasBooking`).
    return [...conversations, ...extras.filter((e) => !conocidas.has(e.id))];
  }, [conversations, extras]);

  // La lista de AHORA, para leerla desde dentro de una promesa sin arrastrarla
  // a las dependencias del efecto: si `todas` fuera dependencia, un
  // `router.refresh()` a mitad de una resolución la cancelaría y volvería a
  // empezar. La copia va en un efecto porque escribir en un ref durante el
  // render está prohibido (regla `react-hooks/refs`), igual que en `unread.ts`.
  const listaRef = useRef(todas);
  useEffect(() => {
    listaRef.current = todas;
  }, [todas]);

  useChatUnreadWatcher({
    enabled: visible,
    currentUserId,
    reloadKey: aperturas,
    onMessage: (conversationId) => {
      // La lista la arma el servidor (`ChatLauncher`), así que una conversación
      // que hoy no está en ella —alguien que acaba de escribirte por primera
      // vez desde tu ficha pública— no aparecería hasta recargar la página. Un
      // mensaje de una conversación desconocida es justo la señal de que la
      // lista se quedó vieja: `router.refresh()` vuelve a ejecutar los
      // componentes de servidor sin tirar el estado del cliente.
      if (listaRef.current.some((c) => c.id === conversationId)) return;
      // Con freno de mano: si tras refrescar la conversación SIGUE sin salir,
      // cada mensaje siguiente pediría otro refresco.
      const ahora = Date.now();
      if (ahora - ultimoRefresco.current < 10_000) return;
      ultimoRefresco.current = ahora;
      router.refresh();
    },
  });

  // Sin leer de las conversaciones que la bandeja SÍ lista: sumar todo lo que
  // hay en el almacén sería enseñar una insignia que no se puede abrir.
  const total = useMemo(
    () => totalUnread(unread, todas.map((c) => c.id)),
    [unread, todas],
  );

  // Quien te acaba de escribir, arriba. `sort` es estable, así que las
  // conversaciones sin actividad conocida conservan el orden del servidor
  // (que ya viene por `last_message_at`).
  const ordenadas = useMemo(
    () =>
      [...todas].sort(
        (a, b) =>
          (unread[b.id]?.activityAt ?? 0) - (unread[a.id]?.activityAt ?? 0),
      ),
    [todas, unread],
  );

  // ── Cerrar al clicar fuera ─────────────────────────────────────────────────
  //
  // ⚠️ ESTO ROMPÍA EL BOTÓN DE DENUNCIAR, y el fallo era de libro. `boxRef` es
  // un nodo del DOM, así que «dentro» significaba «descendiente de ese nodo» —
  // y `ReportConversation` es un `Dialog` de Radix, que se pinta en un PORTAL
  // colgado de `document.body`. O sea FUERA de `boxRef`. El primer `mousedown`
  // dentro del diálogo (el textarea, «Enviar reporte») cerraba el panel, y con
  // el panel se iban el `ChatThread` y el propio diálogo. Denunciar acoso o
  // desintermediación era literalmente imposible desde la burbuja.
  //
  // ── POR QUÉ ASÍ Y NO ENUMERANDO PORTALES ──────────────────────────────────
  // La tentación es un `closest('[data-slot="dialog-content"]')`. Es adivinar:
  // funciona hasta que alguien mete un `Popover`, un `Select` o un
  // `AlertDialog` dentro del hilo, y entonces vuelve a fallar en silencio y
  // hace falta otro selector. Aquí no hace falta adivinar nada, porque **React
  // ya sabe la respuesta**: los eventos de un portal NO burbujean por el DOM
  // hacia el nodo que lo contiene, pero SÍ por el árbol de React, y en el árbol
  // de React el diálogo es descendiente de este `<div>`. Así que un
  // `onMouseDownCapture` en el contenedor ve el clic del textarea portalizado
  // exactamente igual que el de una fila de la lista.
  //
  // ⚠️ EL ORDEN IMPORTA Y ESTÁ GARANTIZADO, no es suerte. React engancha sus
  // listeners delegados en el contenedor raíz, y el de fase de CAPTURA se
  // dispara en el camino de bajada; el nuestro es de fase de burbujeo sobre
  // `document`, que es el último nodo del camino de subida. Cualquier captura
  // en cualquier ancestro va antes que cualquier burbujeo en `document`, así
  // que para cuando `onDoc` mira la marca, ya está puesta. Con
  // `onMouseDown` (sin `Capture`) esto dependería del orden de registro de dos
  // listeners sobre el mismo nodo, que es exactamente la clase de detalle que
  // se rompe al actualizar una librería.
  //
  // Se compara la IDENTIDAD del evento nativo y no un booleano: un booleano
  // habría que apagarlo, y apagarlo tarde deja la burbuja pegada abierta.
  const clicPropio = useRef<Event | null>(null);

  const marcarClicPropio = useCallback((e: React.MouseEvent) => {
    clicPropio.current = e.nativeEvent;
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDoc(e: MouseEvent) {
      const propio = clicPropio.current === e;
      // Guardar el evento mantiene vivo su `target`, o sea un nodo del DOM que
      // puede estar ya desmontado. Se suelta en cuanto se ha usado.
      clicPropio.current = null;
      if (propio) return;
      if (boxRef.current?.contains(e.target as Node)) return;
      // ⚠️ LA ÚNICA CAPA AJENA QUE SE NOMBRA, y va con su porqué: los avisos de
      // sonner. El `Toaster` del layout raíz no declara posición, así que se
      // pintan ABAJO A LA DERECHA — encima del composer de este mismo panel
      // (ver el bloque de `add-to-cart.tsx`, que ya movió su toast por esto) —,
      // y NO cuelgan del árbol de React de la burbuja, así que la regla de
      // arriba no puede verlos. Sin esta línea, el aviso de «no se pudo enviar
      // el mensaje» tapa el cuadro de texto, el usuario pincha para volver a
      // escribir, le da al aviso y pierde el borrador con el panel entero.
      if ((e.target as Element | null)?.closest?.("[data-sonner-toaster]")) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);

  // Los mensajes se piden al abrir la conversación, no al montar la burbuja:
  // cargar de golpe los hilos de veinte conversaciones para una bandeja que
  // puede que nadie despliegue es trabajo tirado. La RLS de participante ya
  // filtra, así que se leen desde el navegador sin endpoint propio.
  useEffect(() => {
    if (!abierta) return;
    let cancelado = false;
    const id = abierta.id;

    void (async () => {
      const { data } = await createClient()
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", id)
        .order("created_at");
      // Sin esto, cambiar de conversación deprisa puede pintar los mensajes de
      // la anterior encima de la nueva.
      if (!cancelado) {
        setMensajes({
          conversationId: id,
          lista: (data ?? []).map((m) => toChatMessage(m as MessageRow)),
        });
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [abierta]);

  // ── Peticiones de «ábreme este hilo» ──────────────────────────────────────
  const peticion = useSyncExternalStore(
    subscribePeticion,
    peticionSnapshot,
    sinPeticionEnServidor,
  );

  /**
   * «Hay una petición y todavía no sé qué conversación es».
   *
   * ⚠️ Se DEDUCE del buzón en vez de guardarse en un `useState`, y no es
   * cosmética: el efecto de abajo consume la petición exactamente cuando
   * termina de resolverla, así que «hay petición pendiente» y «estoy
   * resolviendo» son el mismo hecho contado dos veces. Guardarlo aparte
   * obligaba a un `setResolviendo(true)` en el cuerpo del efecto, que es lo que
   * la regla `react-hooks/set-state-in-effect` prohíbe —con razón: es un render
   * en cascada— y además creaba un segundo sitio donde el estado se puede
   * quedar mal (una resolución abandonada dejaba el panel diciendo «Abriendo…»
   * para siempre). Deducido no puede desincronizarse.
   */
  const resolviendo = peticion !== null && visible;

  useEffect(() => {
    if (!peticion) return;

    // Donde la burbuja no se pinta no puede atender nada, y comérselo en
    // silencio sería el peor de los finales: el usuario pulsa y no pasa NADA.
    // `/chat/[threadId]` resuelve los dos tipos de id (primero conversación,
    // luego reserva), así que se delega en la página tal cual, sin traducir.
    // Pasa de verdad: la campana vive en la cabecera de `(app)` y desde
    // `/chat/otro-hilo` puede pedir abrir uno distinto.
    if (!visible) {
      const id =
        "conversationId" in peticion ? peticion.conversationId : peticion.bookingId;
      consumirPeticion();
      router.push(`/chat/${id}`);
      return;
    }

    let cancelado = false;

    // El panel ya está abierto y diciendo «Abriendo la conversación…» sin que
    // aquí se toque nada: mientras haya petición en el buzón, `resolviendo` es
    // true y el render lo enseña. Lo único que queda es resolver el id.
    void (async () => {
      const c = await resolverConversacion(peticion, listaRef.current);
      // Otra petición ha llegado mientras tanto (o la burbuja se desmontó):
      // manda la nueva, y es ELLA la que consumirá el buzón.
      if (cancelado) return;

      // `open` a mano además del `resolviendo` derivado: en cuanto se consuma
      // la petición, `resolviendo` vuelve a false y sin esto el panel se
      // cerraría en el mismo commit en que acaba de abrir el hilo.
      setOpen(true);
      // Misma señal que desplegar la bandeja a mano: vuelve a pedir el recuento
      // de no leídos, que es justo cuando el número importa.
      setAperturas((n) => n + 1);

      if (c) {
        setExtras((previas) =>
          listaRef.current.some((x) => x.id === c.id) ||
          previas.some((x) => x.id === c.id)
            ? previas
            : [...previas, c],
        );
        setAbierta(c);
      } else {
        // Nunca fallar en silencio dejando el panel abierto y vacío: sin este
        // aviso, lo que el usuario lee es «no tienes conversaciones» cuando lo
        // que ha pasado es que no hemos sabido encontrar la suya. Se queda en
        // la bandeja, que es de donde sí puede abrirla si está.
        setAbierta(null);
        toast.error(
          "No hemos podido abrir esa conversación. Búscala en tu lista de mensajes.",
        );
      }
      // Lo último, y en el mismo turno que los `setState` de arriba para que
      // React lo agrupe todo en un commit: si se consumiera antes, el panel
      // parpadearía —`resolviendo` a false con el hilo todavía sin poner—.
      consumirPeticion();
    })();

    return () => {
      cancelado = true;
    };
    // `visible` entra en las dependencias porque cambia con la ruta y decide
    // cuál de las dos ramas atiende la petición. `router` es estable en Next.
  }, [peticion, visible, router]);

  function volver() {
    setAbierta(null);
    setMensajes(null);
  }

  function alternar() {
    const siguiente = !open;
    setOpen(siguiente);
    if (siguiente) setAperturas((n) => n + 1);
  }

  if (!visible) return null;

  // Una petición abre el panel por sí sola: es la respuesta inmediata al clic,
  // sin esperar a que la red diga qué conversación es.
  const panelAbierto = open || resolviendo;

  // Con un hilo abierto —o a punto de abrirse— la bandeja necesita sitio para
  // el composer. Se mide contra el ancho de la ventana menos los dos márgenes
  // de 20 px (`right-5` y su simétrico) para que en un móvil quede centrado y
  // no pegado al borde izquierdo, que es lo que daba `92vw` con `right-5`.
  const enHilo = abierta !== null || resolviendo;

  // Los mensajes solo valen si son los de la conversación que está en el
  // título (ver el estado `mensajes`).
  const mensajesDeAbierta =
    abierta && mensajes?.conversationId === abierta.id ? mensajes.lista : null;

  return (
    <div
      ref={boxRef}
      onMouseDownCapture={marcarClicPropio}
      className="fixed right-5 bottom-5 z-50 flex flex-col items-end gap-3"
    >
      {panelAbierto ? (
        <div
          className={`overflow-hidden rounded-[16px] border border-[#e0e0e0] bg-card shadow-[0_16px_40px_rgb(0_0_0/0.18)] ${
            enHilo
              ? "w-[min(calc(100vw-2.5rem),400px)]"
              : "w-[min(calc(100vw-2.5rem),320px)]"
          }`}
        >
          <div className="flex items-center gap-2 border-b border-[#e0e0e0] px-4 py-3">
            {abierta ? (
              <button
                type="button"
                aria-label="Volver a mensajes"
                onClick={volver}
                className="text-[#8c8c8c] transition-colors hover:text-foreground"
              >
                <ArrowLeftIcon className="size-4" />
              </button>
            ) : null}
            {/* Con el hilo abierto manda el NOMBRE de la otra persona, y la
                mentoría baja a la línea pequeña: en una bandeja con varias
                conversaciones, saber con quién hablas es lo primero. */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#19191f]">
                {abierta ? nombreDe(abierta) : "Mensajes"}
              </p>
              {abierta ? (
                // MN-08 · «3 mentorías · Álgebra desde cero». El contador va
                // delante porque esto trunca; el porqué, en `types.ts`.
                <p className="truncate text-[11px] text-[#6b6b6b]">
                  {conversationSubtitle(abierta)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Cerrar mensajes"
              onClick={() => setOpen(false)}
              className="text-[#8c8c8c] transition-colors hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          {enHilo ? (
            <div
              className="flex flex-col p-3"
              // La altura, en línea y no en una clase de Tailwind, porque
              // depende de `ALTO_FUERA_DEL_CUERPO`: repetir el número en la
              // clase es la manera segura de que un día dejen de coincidir.
              // El `clamp` es lo que impide que la cabecera se salga por arriba
              // en una ventana baja (ver la constante).
              style={{
                height: `clamp(140px, calc(100dvh - ${ALTO_FUERA_DEL_CUERPO}), 520px)`,
              }}
            >
              {abierta === null || mensajesDeAbierta === null ? (
                <p className="m-auto text-[13px] text-[#6b6b6b]">
                  Abriendo la conversación…
                </p>
              ) : (
                <ChatThread
                  // Sin `key` React reutilizaría el hilo anterior con su estado:
                  // borrador a medio escribir y suscripción de Realtime incluidos.
                  key={abierta.id}
                  conversationId={abierta.id}
                  // La reserva más reciente del par, si la hay: es lo que
                  // etiqueta el mensaje y lo que permite adjuntar.
                  bookingId={abierta.bookingId ?? undefined}
                  hasBooking={abierta.hasBooking}
                  // MN-06 · la bandeja es donde siguen viviendo los hilos que
                  // el cierre del chat previo dejó en solo lectura (P-1b: se
                  // ven, no se escriben).
                  canChat={abierta.canChat}
                  // De qué lado se mira: es lo que permite contar los topes de
                  // la consulta previa, que son solo del alumno.
                  counterpartRole={abierta.counterpartRole}
                  reservarHref={
                    abierta.counterpartRole === "tutor"
                      ? `/tutors/${abierta.counterpartId}`
                      : undefined
                  }
                  blocked={abierta.blocked}
                  currentUserId={currentUserId}
                  initialMessages={mensajesDeAbierta}
                  fill
                />
              )}
            </div>
          ) : todas.length === 0 ? (
            // ⚠️ ESTA FRASE DECÍA «El chat se abre con la primera mentoría
            // reservada» Y ERA MENTIRA. Lo fue durante seis días —MN-06 cerró
            // el canal previo a la compra el 20-ago— y dejó de serlo el 26-ago
            // con EY-194 (`20260826140000`), que lo volvió a abrir a petición
            // del cliente: hoy cualquier alumno puede escribirle a un tutor
            // aprobado sin haber comprado nada. La frase se quedó atrás, y en
            // una burbuja que aspira a ser la ÚNICA superficie de chat es lo
            // PRIMERO que lee alguien que acaba de registrarse.
            //
            // Y se redacta por rol en vez de buscar una frase neutra que valga
            // para los dos, que es lo que se intentó antes: a un tutor no se le
            // puede decir «escríbele a un tutor desde su perfil» y a un alumno
            // no se le puede decir «tus alumnos te escribirán». Al final una de
            // las dos mitades siempre acaba siendo falsa para quien la lee.
            <p className="px-4 py-5 text-[13px] text-[#6b6b6b]">
              {esTutor
                ? "Todavía no tienes conversaciones. Tus alumnos pueden escribirte desde tu perfil público, antes incluso de reservar."
                : "Todavía no tienes conversaciones. Puedes escribirle a cualquier tutor desde su perfil, antes incluso de reservar."}
            </p>
          ) : (
            <ul
              className="divide-y divide-[#f0f0f0] overflow-auto"
              // Mismo motivo que la altura del hilo: la lista tampoco puede
              // empujar la cabecera fuera de la pantalla. Aquí la cabecera es
              // más baja (sin subtítulo), pero se reutiliza el mismo margen
              // antes que mantener dos números.
              style={{
                maxHeight: `min(60dvh, calc(100dvh - ${ALTO_FUERA_DEL_CUERPO}))`,
              }}
            >
              {ordenadas.map((c) => {
                const sinLeer = unread[c.id]?.unread ?? 0;
                const nombre = nombreDe(c);
                const avatar = storageUrl("avatars", c.avatarPath);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setAbierta(c)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
                    >
                      <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[#e0eeff] text-[11px] font-semibold text-brand">
                        {avatar ? (
                          // `img` a secas y no `next/image`: es un avatar de 36
                          // px dentro de una lista que puede tener veinte, y
                          // `unoptimized` haría lo mismo con más ceremonia.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatar}
                            alt=""
                            className="size-9 object-cover"
                          />
                        ) : (
                          initialsFrom(nombre)
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[13.5px] text-[#333333] ${
                            sinLeer > 0 ? "font-bold" : "font-medium"
                          }`}
                        >
                          {nombre}
                        </span>
                        {/* MN-08 · el recuento de mentorías del par, delante
                            del título de la última reserva. */}
                        <span className="block truncate text-xs text-[#6b6b6b]">
                          {conversationSubtitle(c)}
                        </span>
                      </span>
                      {sinLeer > 0 ? (
                        <span
                          className="grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white"
                          aria-label={`${sinLeer} sin leer`}
                        >
                          {sinLeer > 99 ? "99+" : sinLeer}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        aria-label={
          total > 0 ? `Abrir mensajes (${total} sin leer)` : "Abrir mensajes"
        }
        aria-expanded={open}
        onClick={alternar}
        className="relative grid size-14 place-items-center rounded-full bg-brand text-white shadow-[0_8px_24px_rgb(0_0_0/0.22)] transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <MessageCircleIcon className="size-6" />
        {/* La insignia dice MENSAJES SIN LEER, no conversaciones: si no te deben
            nada, no hay número. */}
        {total > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-white">
            {total > 9 ? "9+" : total}
          </span>
        ) : null}
      </button>
    </div>
  );
}

/**
 * De un id —de conversación o de reserva— a la conversación que la bandeja
 * sabe pintar. Tres pasos, y el tercero es el que hace falta de verdad.
 *
 *  a) Si la petición trae una RESERVA, se traduce con `conversation_of_booking`.
 *     Es la misma RPC que usa `/chat/[threadId]` (y `conversations.ts`), y es
 *     SECURITY INVOKER: si la reserva no es tuya, la RLS devuelve `null` y esto
 *     acaba en el aviso de error, no en el hilo de otro.
 *
 *  b) Buscarla en la lista que la burbuja ya tiene del servidor. Es el caso
 *     normal y no cuesta ni un viaje de red.
 *
 *  c) ⚠️ Y SI NO ESTÁ EN LA LISTA, PREGUNTAR. Este paso no es una red de
 *     seguridad, es el que arregla «Escribir a X». El hilo que crea
 *     `open_conversation` desde la ficha pública del tutor no tiene mensajes ni
 *     reserva, así que el filtro de `ChatLauncher` lo deja fuera de la bandeja
 *     del tutor, y además la lista del servidor es una foto del último render:
 *     un hilo creado hace dos segundos no puede estar en ella. Sin este paso, el
 *     hilo recién creado es inalcanzable y el botón no lleva a ninguna parte.
 *
 *     Se llama a `my_conversations()` desde el NAVEGADOR y es seguro: la función
 *     es SECURITY DEFINER pero está acotada por participación
 *     (`auth.uid() in (student_id, tutor_id)`), o sea que solo puede devolver
 *     hilos de quien pregunta. No hay superficie nueva que autorizar — es la
 *     misma llamada que ya hace el servidor en cada render de la bandeja.
 */
async function resolverConversacion(
  p: PeticionDeHilo,
  lista: Conversation[],
): Promise<Conversation | null> {
  const supabase = asRpc(createClient());

  let conversationId: string;
  if ("conversationId" in p) {
    conversationId = p.conversationId;
  } else {
    const { data, error } = await supabase.rpc("conversation_of_booking", {
      p_booking_id: p.bookingId,
    });
    if (error || typeof data !== "string") return null;
    conversationId = data;
  }

  const enLista = lista.find((c) => c.id === conversationId);
  if (enLista) return enLista;

  const { data, error } = await supabase.rpc("my_conversations");
  if (error) return null;
  return (
    ((data ?? []) as ConversationRow[])
      .map(toConversation)
      .find((c) => c.id === conversationId) ?? null
  );
}
