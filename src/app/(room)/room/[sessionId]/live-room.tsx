"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlagIcon, XIcon } from "lucide-react";
import type {
  DailyCall,
  DailyCustomTrayButtons,
  DailyThemeConfig,
} from "@daily-co/daily-js";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { ReportConversation } from "@/components/chat/report-conversation";
import { RecordingConsent } from "@/components/room/recording-consent";
import { SessionRef } from "@/components/room/session-ref";

type SessionStatus = Database["public"]["Enums"]["session_status"];
type BookingStatus = Database["public"]["Enums"]["booking_status"];

// MN-05 · La ventana de acceso ya NO se calcula aquí. Llega por props desde
// `page.tsx`, que la lee de `sessions.access_opens_at` / `access_closes_at` —
// las columnas que la migración `20260820190000` despertó. Antes esto era
// `const WINDOW_MIN = 10` y era una de las cinco copias del número.
//
// B-2 la devolvió a 10 minutos, así que el valor vuelve a ser el de entonces —
// pero no vuelve la constante: el problema nunca fue el número, era tenerlo
// escrito en cinco sitios. Sigue viniendo de la fila.
//
// Lo que sigue siendo cierto: el server es la barrera real (`join_session`),
// aquí solo se pinta el estado.

/**
 * MN-04 · La paleta de la sala, en UN solo sitio.
 *
 * ⚠️ De dónde salen los hex. `globals.css` **no tiene paleta oscura**: el
 * layout raíz fuerza el tema claro (`forcedTheme="light"`) porque el Figma no
 * dibujó modo oscuro. Así que la sala no puede "leer" tokens oscuros — no
 * existen. Lo que se hace es:
 *   · `accent` / `accentText` → `--primary` (#fe6a00) y `--primary-foreground`
 *     (#ffffff) tal cual: es la naranja de marca y aquí manda igual que fuera.
 *   · `background` → `--foreground` (#14141a), la tinta del Figma usada
 *     INVERTIDA como superficie. No es un color nuevo, es el mismo del otro lado.
 *   · el resto (`mainAreaBg`, `backgroundAccent`, `border`, `supportiveText`)
 *     son escalones derivados de ese #14141a, decididos AQUÍ por falta de
 *     tokens oscuros. Si algún día Diana entrega paleta oscura, este objeto es
 *     el único sitio que hay que cambiar.
 *
 * Se usa dos veces y por eso vive en un objeto: como `theme` de Daily —que
 * exige hex en JS, no variables CSS— y como variables CSS del marco nuestro
 * (`VARS_SALA`), para que el iframe y el panel de chat no puedan desafinar.
 */
const SALA = {
  /** `--primary` de globals.css. */
  accent: "#fe6a00",
  /** `--primary-foreground`. */
  accentText: "#ffffff",
  /** `--foreground` (#14141a) invertido: la barra de controles y el marco. */
  background: "#14141a",
  /** Un escalón por encima del fondo: botones y superficies secundarias. */
  backgroundAccent: "#26262f",
  baseText: "#ffffff",
  border: "#3a3a45",
  /** El área de vídeo, un punto MÁS oscura que la barra (como Meet). */
  mainAreaBg: "#0f0f14",
  /** Tesela de participante con la cámara apagada. */
  mainAreaBgAccent: "#26262f",
  mainAreaText: "#ffffff",
  /** Texto secundario sobre oscuro: contraste 7,4:1 sobre #14141a. */
  supportiveText: "#a3a3ad",
} as const;

/**
 * El mismo objeto en el formato que espera Daily. Se pasa como `DailyTheme`
 * suelto (no como `{ light, dark }`) a propósito: la sala es oscura siempre,
 * pase lo que pase con el modo del navegador o el del propio Prebuilt.
 */
const TEMA_DAILY: DailyThemeConfig = { colors: { ...SALA } };

/**
 * Y el mismo objeto como variables CSS, para el marco que sí es nuestro (barra
 * de sesión y panel de chat). Sin esto los hex estarían escritos dos veces —una
 * para Daily y otra en clases de Tailwind— y el día que cambie uno, el iframe y
 * el panel de al lado dejarían de ser el mismo color.
 */
const VARS_SALA = {
  "--sala-bg": SALA.background,
  "--sala-surface": SALA.backgroundAccent,
  "--sala-video": SALA.mainAreaBg,
  "--sala-text": SALA.baseText,
  "--sala-supportive": SALA.supportiveText,
  "--sala-border": SALA.border,
} as React.CSSProperties;

/**
 * V-2 · **El chat, en el gris de Daily.** Y esto no es `bg-gris` en un div: es
 * redefinir los tokens del sistema PARA ESE SUBÁRBOL.
 *
 * El panel monta `ChatThread`, que es el MISMO componente de `/chat/[id]`, de la
 * bandeja y de las dos pantallas de reserva. Sus burbujas, su composer, su clip
 * y sus botones están escritos contra `bg-background`, `bg-muted`, `border`…:
 * repintarlos «para la sala» se los cambiaría a las cinco pantallas. Hasta hoy
 * eso se esquivaba dándole una isla BLANCA sobre el marco oscuro — que funciona,
 * pero es exactamente el recuadro claro pegado al vídeo del que se quejó el
 * cliente.
 *
 * Redefiniendo las variables aquí, el mismo componente sin tocar una línea
 * resuelve sus colores en oscuro dentro de este `aside` y en claro en todas las
 * demás. Los valores salen de `SALA`, así que el panel y el iframe siguen siendo
 * literalmente el mismo gris: los dos leen del mismo objeto.
 *
 * ⚠️ Ojo con `--foreground`: la burbuja propia es `bg-foreground text-background`
 * (invertida a propósito), así que aquí sale BLANCA con texto oscuro sobre el
 * gris — que es justo el contraste que se quiere para «lo mío». Si algún día se
 * toca, comprobar las dos burbujas, no solo una.
 */
const VARS_CHAT_SALA = {
  "--background": SALA.background,
  "--foreground": SALA.baseText,
  "--card": SALA.backgroundAccent,
  "--card-foreground": SALA.baseText,
  "--popover": SALA.backgroundAccent,
  "--popover-foreground": SALA.baseText,
  /** La burbuja del OTRO y los fondos suaves. */
  "--muted": SALA.backgroundAccent,
  "--muted-foreground": SALA.supportiveText,
  "--secondary": SALA.backgroundAccent,
  "--secondary-foreground": SALA.baseText,
  "--accent": SALA.backgroundAccent,
  "--accent-foreground": SALA.baseText,
  "--border": SALA.border,
  "--input": SALA.border,
} as React.CSSProperties;

/**
 * El icono del botón de chat de la barra de Daily, **incrustado como `data:`
 * URI y no servido desde `/public`**.
 *
 * ⚠️ ANTES ERA `/img/room-chat.svg` Y SALÍA ROTO. Quien pide ese fichero no
 * somos nosotros: es el IFRAME DE DAILY, que vive en `https://*.daily.co`. Se
 * le pasaba la URL absoluta con `window.location.origin`, y en desarrollo eso
 * es `http://localhost:3000` → **contenido mixto**, que el navegador bloquea
 * sin decir nada visible: el bloqueo ocurre dentro del iframe ajeno, así que en
 * nuestra consola no aparece. Solo se ve el icono roto en la barra.
 *
 * En producción, con la app en https, la petición sí habría salido. Pero
 * arreglarlo con «pues ya funcionará en prod» deja el botón roto en local y en
 * cualquier preview por http, que es donde se prueba. Con un `data:` URI **no
 * hay petición**: ni cross-origin, ni mixed content, ni dependencia del
 * protocolo. Se ve igual en los tres sitios.
 *
 * Y de paso desaparece la razón por la que `botonesTray()` solo se podía llamar
 * desde efectos: ya no lee `window`.
 *
 * Sigue siendo blanco a mano y no `currentColor`: Daily lo pinta como IMAGEN,
 * no lo inserta en su DOM, así que no hereda color. La barra es oscura siempre
 * porque el `theme` que le pasamos fija `background`. 36×36 es lo que espera
 * la barra de Prebuilt.
 */
const ICONO_CHAT = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none">' +
    '<path d="M10 10h16a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-8.7l-5.3 4v-4H10a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Z" ' +
    'stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/></svg>',
)}`;

/**
 * MN-04 · El botón de chat que se inyecta EN LA BARRA DE DAILY.
 *
 * Es lo que hace que esto se sienta una sala y no «un iframe con una columna al
 * lado»: el usuario abre y cierra el panel desde la misma barra donde tiene el
 * micro y la cámara. Daily lo pinta y nos avisa por `custom-button-click`; el
 * panel sigue siendo nuestro.
 *
 * `visualState: 'sidebar-open'` es el estado que Prebuilt usa para sus propios
 * paneles laterales (participantes, red): el botón se queda "encendido"
 * mientras el panel está abierto, igual que los suyos.
 *
 * (Ya NO depende de `window`: el icono es un `data:` URI de módulo. Antes leía
 * `window.location.origin` y por eso solo podía llamarse desde efectos.)
 */
function botonesTray(
  abierto: boolean,
  sinLeer: number,
): DailyCustomTrayButtons {
  return {
    chat: {
      iconPath: ICONO_CHAT,
      // El mismo para los dos modos: nuestro `theme` fija `background` oscuro
      // pase lo que pase, así que el trazo blanco vale siempre. Si un día la
      // sala tuviera modo claro, aquí va la variante oscura.
      iconPathDarkMode: ICONO_CHAT,
      // V-2 · el contador va en el RÓTULO porque es lo único que hay.
      // `DailyCustomTrayButtons` expone `iconPath`, `label`, `tooltip` y
      // `visualState`: no hay insignia, y el icono es un SVG remoto que Daily
      // carga por URL, así que tampoco se puede dibujar el número encima. Un
      // «Chat (3)» en la barra es feo pero se ve, que es de lo que va esto.
      // El botón de nuestra barra de arriba sí lleva punto.
      label: sinLeer > 0 ? `Chat (${sinLeer > 9 ? "9+" : sinLeer})` : "Chat",
      tooltip:
        sinLeer > 0
          ? `${sinLeer === 1 ? "1 mensaje" : `${sinLeer} mensajes`} sin leer`
          : abierto
            ? "Ocultar el chat"
            : "Mostrar el chat",
      visualState: abierto ? "sidebar-open" : "default",
    },
  };
}

type Joined = {
  roomUrl: string;
  token: string | null;
  endsAt: string;
  /** Sin credenciales de Daily la sala va simulada (ver `lib/daily.ts`). */
  simulated: boolean;
};

/** ms → "12:34" para el cronómetro de la sesión (AL/LV01). */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * ms → "6 d 04 h" / "2 h 05 min" / "4 min 12 s" para la cuenta regresiva.
 *
 * El tramo de días entró con MN-05, cuando la sala vivía 7 días y la cuenta
 * atrás llegaba a "167 h 59 min". Con B-2 la ventana vuelve a 10 minutos y ya
 * casi no se alcanza — se queda porque esta función también pinta la espera
 * ANTES de que la sala abra, y eso sí puede ser de días.
 */
function human(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} d ${String(h).padStart(2, "0")} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}

/**
 * V-2 · AQUÍ VIVÍA EL `matchMedia` DEL PANEL, y se retira con el resto de MN-04.
 *
 * Existía para que el chat naciera abierto en escritorio y cerrado en móvil.
 * Desde que nace plegado en los dos, no hay nada que derivar del ancho: un
 * `useState(false)` dice lo mismo, y además no tiene que fingir nada en el SSR.
 * El corte `lg:` sigue existiendo, pero solo en las clases del `aside` — que es
 * donde de verdad decide si el panel se superpone o se pone al lado.
 */

/**
 * V-2 · Lo que se pregunta antes de dejar que un enlace de la cabecera saque a
 * alguien de una clase en curso. Ver `GuardaDeSalida`.
 */
const AVISO_SALIDA =
  "Si sales de esta pantalla se cierra tu conexión con la sala y tendrás que volver a entrar. ¿Salir de todos modos?";

/**
 * V-2 · La cabecera del sitio, con red debajo.
 *
 * ⚠️ **Sin esto, devolver el `SiteHeader` a la sala es poner una fila de
 * botones para caerse de la clase.** Cada enlace es una navegación de Next; la
 * sala se desmonta, su efecto de limpieza llama a `call.destroy()` y la llamada
 * se acaba. No hay confirmación de Daily ni de nadie: pulsas «Explorar» y estás
 * fuera.
 *
 * Se resuelve en captura y sobre el contenedor, no tocando `SiteHeader`: ese
 * componente lo montan además `(app)`, `(public)` y el asistente, y meterle una
 * prop de «pregunta antes de navegar» sería contaminar tres pantallas para
 * arreglar una. Aquí se mira el clic antes de que llegue al ancla y, si no se
 * confirma, no llega.
 *
 * Se cubren también los `submit` porque en la cabecera hay dos formularios que
 * navegan: el buscador y el cierre de sesión.
 *
 * Lo que NO se intercepta, a propósito: clic con Cmd/Ctrl/Shift/Alt, botón
 * central y `target="_blank"`. Todos abren en otra pestaña y dejan la clase
 * donde está, así que preguntar sería ruido.
 */
function GuardaDeSalida({
  activa,
  children,
}: {
  activa: boolean;
  children: React.ReactNode;
}) {
  const alPulsar = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activa || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const ancla = (e.target as HTMLElement).closest?.("a[href]");
    if (!ancla || (ancla as HTMLAnchorElement).target === "_blank") return;
    if (!window.confirm(AVISO_SALIDA)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const alEnviar = (e: React.FormEvent<HTMLDivElement>) => {
    if (!activa || e.defaultPrevented) return;
    if (!window.confirm(AVISO_SALIDA)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    /*
     * ⚠️ ESTAS DOS CLASES SON LAS QUE HACEN QUE LA CABECERA SE VEA, y las dos
     * salieron de mirarla en pantalla, no de leer el código:
     *
     * · `bg-background` — `SiteHeader` se pinta con `bg-background/90`,
     *   translúcido a propósito para que el contenido se intuya al hacer scroll
     *   por debajo. En el resto del sitio lo que hay detrás es blanco y no se
     *   nota; en la sala hay #14141a, así que la cabecera salía GRIS. Esta capa
     *   opaca es el blanco que el header da por supuesto.
     *
     * · `text-foreground` — el contenedor de la sala lleva
     *   `text-[color:var(--sala-text)]`, que es #ffffff, y los iconos del header
     *   pintan con `currentColor`. O sea: la campana, el menú de cuenta y el ☰
     *   estaban ahí, a sus 32×32 y respondiendo al clic, en BLANCO SOBRE BLANCO.
     *   Aquí se corta la herencia.
     */
    <div
      className="shrink-0 bg-background text-foreground"
      onClickCapture={alPulsar}
      onSubmitCapture={alEnviar}
    >
      {children}
    </div>
  );
}

export function LiveRoom({
  header,
  sessionId,
  bookingId,
  conversationId,
  startAt,
  endAt,
  opensAt,
  closesAt,
  sessionStatus,
  bookingStatus,
  productTitle,
  sessionRef,
  timeZone,
  isTutor,
  currentUserId,
  firstSessionAt,
  initialMessages,
  consent,
}: {
  /**
   * V-2 · El `SiteHeader` real, ya renderizado por `page.tsx`. Llega como slot
   * porque necesita usuario, roles y avisos —tres cosas de servidor— y este
   * componente es de cliente. Ver la nota de la página.
   */
  header?: React.ReactNode;
  sessionId: string;
  bookingId: string;
  /**
   * EY-189 · La conversación del par, ya resuelta por la página (ver su nota).
   * Es lo que se reporta: `conversation_reports` cuelga de la CONVERSACIÓN, no
   * de la sesión ni de la reserva, así que «reportar conducta» aquí y
   * «Reportar» en el chat levantan exactamente el mismo caso. `null` solo en el
   * imposible teórico de una reserva sin hilo; entonces no se pinta el botón.
   */
  conversationId: string | null;
  startAt: string;
  endAt: string;
  /** B-2 · `sessions.access_opens_at`: cuándo la sala admite gente (10 min
   *  antes del inicio). NO es cuándo empieza la mentoría — eso es `startAt`. */
  opensAt: string;
  /** B-2 · `sessions.access_closes_at` (10 min tras el fin). Sigue sin ser
   *  cuándo se cierra la contabilidad, aunque desde B-2 caigan en el mismo
   *  instante: eso lo decide `session_live_window()` y no se toca. */
  closesAt: string;
  sessionStatus: SessionStatus;
  bookingStatus: BookingStatus;
  productTitle: string;
  /** N-27 · "N.º de sesión" visible. Null en reservas viejas (ver migración). */
  sessionRef: string | null;
  /** RV-18/RN-01 · la resuelve la página en servidor; sin ella el SSR
   *  formatea en UTC y la hora no coincide con la del navegador. */
  timeZone: string;
  isTutor: boolean;
  currentUserId: string;
  firstSessionAt: string | null;
  initialMessages: ChatMessage[];
  /** US-1801 · quién ha aceptado ya que se grabe (RN-42). */
  consent: { mine: boolean; other: boolean };
}) {
  const router = useRouter();
  /**
   * RV-18 · `now` arranca en `null` A PROPÓSITO, y no en `Date.now()`.
   *
   * Este componente es de cliente pero SE RENDERIZA TAMBIÉN EN EL SERVIDOR, y
   * de `now` salen `beforeWindow` y `afterWindow`, que deciden QUÉ RAMA del
   * árbol se pinta. Si el SSR cae a un lado del umbral y la hidratación al
   * otro, no cambia un texto: cambia la ESTRUCTURA — que es exactamente el
   * React #418 de "marcado distinto", no el #425 de "texto distinto". Y el
   * `suppressHydrationWarning` de la cuenta atrás no cubre nada de esto:
   * silencia el texto de ESE nodo, no la elección de rama.
   *
   * Con `null`, el servidor y el primer render del cliente pintan lo mismo
   * (la sala aún no decidida) y el reloj entra en el efecto de montaje.
   */
  const [now, setNow] = useState<number | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [busy, setBusy] = useState(false);
  // Controles locales de la sala simulada (con Daily real los trae el SDK).
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  /**
   * ¿el panel de chat está desplegado?
   *
   * ⚠️ **V-2 · ARRANCA PLEGADO, SIEMPRE, y es marcha atrás sobre MN-04.** Hasta
   * hoy nacía abierto en escritorio y cerrado en móvil, derivado de un
   * `matchMedia` — el cliente había pedido «el chat incrustado a la derecha» y
   * eso se leyó como «desplegado». El 24-ago pidió lo contrario: entrar a la
   * clase es entrar al vídeo, y el chat se abre cuando hace falta. Ya no hay
   * dos comportamientos por ancho, así que se fue con ello el `useSyncExternalStore`
   * del viewport: un `useState(false)` dice lo mismo y no miente en el SSR.
   *
   * ⚠️ El panel se MONTA siempre, plegado o no; lo que hace este estado es
   * enseñarlo u ocultarlo con CSS. Desmontarlo cortaría la suscripción de
   * Realtime del hilo, así que plegar el chat un minuto haría perder los
   * mensajes de ese minuto hasta recargar. Ver el `aside` de más abajo.
   *
   * Y de ahí sale el problema que arrastra: montado y escondido, el hilo daba
   * por leído todo lo que entraba. Lo resuelve `visible` (ver `chat-thread.tsx`
   * y `unread.ts`), que es lo que hace posible el contador de aquí abajo.
   */
  const [chatAbierto, setChatAbierto] = useState(false);
  /**
   * V-2 · Mensajes que han entrado con el panel plegado. Es lo que convierte
   * «plegado» en algo distinto de «sordo»: sin este contador, plegar el chat
   * —que ahora es el estado por defecto— era perderse la conversación entera
   * sin un solo aviso.
   *
   * Vive aquí y no en el hilo porque quien tiene que enseñarlo es el marco: el
   * botón de la barra de arriba y el de la barra de Daily, los dos fuera del
   * componente de chat.
   */
  const [sinLeer, setSinLeer] = useState(0);
  /**
   * Abrir o plegar, poniendo el contador a cero en los dos sentidos. Al abrir
   * es evidente; al plegar también es correcto: venías de tenerlo delante, así
   * que lo que hubiera ya lo has visto.
   */
  const alternarChat = useCallback(() => {
    setChatAbierto((v) => !v);
    setSinLeer(0);
  }, []);
  const plegarChat = useCallback(() => {
    setChatAbierto(false);
    setSinLeer(0);
  }, []);
  const abrirChat = useCallback(() => {
    setChatAbierto(true);
    setSinLeer(0);
  }, []);
  /**
   * V-2 · El aviso FLOTANTE, que es la otra mitad del «que avise».
   *
   * La insignia sirve si estás mirando la barra; durante una clase estás
   * mirando el vídeo, o una pantalla compartida a pantalla completa, y un punto
   * naranja de 16px arriba a la derecha no lo ve nadie. El toast se cruza por
   * delante y trae el camino de vuelta.
   *
   * ⚠️ `id` fijo a propósito: sonner REEMPLAZA el toast que ya tenga ese id en
   * vez de apilar otro. Tres mensajes seguidos en una conversación animada son
   * tres avisos encima del vídeo, que es justo la clase de ruido que hace que la
   * gente deje de mirarlos.
   *
   * Sin previsualizar el mensaje: esto puede estar proyectado en una pantalla
   * compartida delante de la otra persona.
   */
  const avisarMensaje = useCallback(() => {
    setSinLeer((n) => n + 1);
    toast("Nuevo mensaje en el chat", {
      id: "sala-mensaje-nuevo",
      action: { label: "Abrir", onClick: abrirChat },
    });
  }, [abrirChat]);
  const frameRef = useRef<HTMLDivElement>(null);
  // Para devolver el foco al cerrar el panel desde su aspa: si no, el
  // `display:none` del `aside` deja el foco huérfano y el navegador lo manda
  // al `body`, o sea a tabular desde el principio.
  const toggleChatRef = useRef<HTMLButtonElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  // Espejo de `chatAbierto` y de `sinLeer` para el efecto que crea el iframe:
  // ese efecto NO puede depender del estado del chat (recrearía la llamada
  // entera al abrir el panel), pero sí necesita saber en qué estado nace el
  // botón de la barra. `false` de arranque desde V-2: el panel nace plegado.
  const chatAbiertoRef = useRef(false);
  const sinLeerRef = useRef(0);
  // MN-05 · cuándo se pidió entrada. Solo se usa para saber si fue ANTES de que
  // la mentoría empezara; ver el efecto de re-autorización más abajo.
  const joinedAt = useRef<number | null>(null);
  const cicloPedido = useRef(false);

  const opens = new Date(opensAt).getTime();
  const closes = new Date(closesAt).getTime();
  // La ventana de la CLASE (RN-18/S-45, los 10 min de siempre). Es la que
  // decide si esto es la mentoría o alguien mirando la sala, y la que el server
  // usa para mover el ciclo M5 — de ahí cuelga el cobro del tutor. Se pinta a
  // partir de `startAt`/`endAt` porque es una propiedad de la clase, no una
  // columna: en la BD es `session_live_window()`.
  const liveOpens = new Date(startAt).getTime() - 10 * 60_000;
  const liveCloses = new Date(endAt).getTime() + 10 * 60_000;

  // Reloj de 1 s para la cuenta regresiva y para reaccionar al abrir/cerrar.
  //
  // La primera puesta en hora va en un `setTimeout(…, 0)` y no en una llamada
  // directa a `setNow` dentro del efecto: así el reloj arranca en el primer
  // hueco tras pintar —sin el segundo de espera que costaría dejárselo al
  // intervalo— y sin el `setState` directo en el efecto, que `react-hooks`
  // marca con razón porque fuerza un render extra en cascada.
  useEffect(() => {
    const enHora = () => setNow(Date.now());
    const primera = setTimeout(enHora, 0);
    const id = setInterval(enHora, 1000);
    return () => {
      clearTimeout(primera);
      clearInterval(id);
    };
  }, []);

  // MN-04 · El botón de la barra de Daily tiene que reflejar si el panel está
  // abierto, y el iframe no se entera solo. Este efecto hace las dos cosas:
  // mantiene el espejo para cuando la llamada se cree DESPUÉS, y repinta el
  // botón cuando ya existe. Sin setState: no hay render en cascada.
  useEffect(() => {
    chatAbiertoRef.current = chatAbierto;
    sinLeerRef.current = sinLeer;
    // ⚠️ `updateCustomTrayButtons()` NO es tolerante: en daily-js 0.91 empieza
    // por un guardia de estado y **lanza** `"only supported after join"` si la
    // llamada aún no está en `joined-meeting`. Y la ventana existe de verdad:
    // `callRef.current` se asigna antes del `await call.join(...)`, y entre
    // medias están la carga del iframe desde daily.co y el permiso de cámara.
    // Cerrar el chat en ese hueco tumbaba la sala. Si todavía no se ha unido no
    // pasa nada: el espejo de arriba ya guarda el estado y el listener de
    // `joined-meeting` repinta el botón en cuanto se puede.
    const call = callRef.current;
    if (call && call.meetingState() === "joined-meeting") {
      call.updateCustomTrayButtons(botonesTray(chatAbierto, sinLeer));
    }
  }, [chatAbierto, sinLeer]);


  // ⚠️ MN-04 · AQUÍ VIVÍA EL "MODO TEATRO", y se retira a propósito.
  //
  // Existía (reunión del 7-ago) porque la sala vivía dentro del layout de la
  // app y el vídeo se quedaba en una franja de 34rem; el botón la estiraba a
  // toda la ventana conservando el chat, que es lo que el fullscreen de Daily
  // no sabe hacer. Desde que la ruta cuelga de `(room)` el vídeo YA ocupa el
  // viewport entero: el modo teatro sería un botón para pasar de pantalla
  // completa a pantalla completa. Su otra mitad —"quiero MÁS vídeo"— la cubre
  // ahora el botón de chat de la barra, que es el que repliega el panel.
  //
  // Con él se va su escucha de `Escape`. No se sustituye por "Escape cierra el
  // chat": el foco vive dentro del iframe de Daily casi todo el tiempo, así que
  // sería un atajo que funciona a veces, y eso es peor que no tenerlo.

  // MN-05 · `completed` entra en la lista. En cuanto el cron cierra la última
  // sesión, la reserva pasa a `completed`; sin esta línea la sala se cerraría a
  // los 10 min por la puerta de al lado. Fuera se
  // quedan las que no deben tener sala nunca: `cancelled`/`refunded` porque el
  // dinero volvió, y las dos pendientes porque aún no hay clase que abrir.
  // Misma lista, palabra por palabra, que la guarda de `join_session`: si
  // divergen, el botón aparece y el server dice que no.
  const bookingAllowsRoom =
    bookingStatus === "confirmed" ||
    bookingStatus === "in_progress" ||
    bookingStatus === "completed";

  // ⚠️ MN-05 · Antes esto incluía `completed` y `no_show` y cerraba la sala.
  // Ya no: esos dos son estados de la CONTABILIDAD —dicen que el reloj de la
  // clase venció y que arrancó el del cobro del tutor—, no una orden de cerrar
  // la puerta. La única sesión sin sala es la `cancelled`: esa clase no va a
  // existir y su dinero volvió.
  const sessionCancelled = sessionStatus === "cancelled";
  const sessionEnded =
    sessionStatus === "completed" || sessionStatus === "no_show";
  // Mientras no haya reloj (SSR y primer render del cliente) no se decide nada:
  // ni "todavía no abre" ni "ya cerró". Así las dos pasadas pintan el mismo
  // árbol y la elección de rama ocurre después de hidratar.
  const beforeWindow = now !== null && now < opens;
  const afterWindow = now !== null && now > closes;

  // "En vivo" es un estado DERIVADO: uniste y la ventana sigue abierta.
  const live = joined !== null && !afterWindow;

  // Embed de Daily: se monta al unirse y se destruye al salir/desmontar. El SDK
  // trae los controles (micro, cámara, salir, compartir pantalla) y la
  // reconexión automática ante caída de red (US-803).
  useEffect(() => {
    if (!live || !joined || joined.simulated || !frameRef.current || callRef.current) return;

    let cancelled = false;
    void (async () => {
      const DailyIframe = (await import("@daily-co/daily-js")).default;
      if (cancelled || !frameRef.current) return;

      const call = DailyIframe.createFrame(frameRef.current, {
        // MN-04 · La sala hablaba INGLÉS. Todo lo que se ve dentro del iframe lo
        // escribe Daily —"Waiting for others to join", "People", "Share",
        // "Leave", el permiso de cámara— y por defecto sale en inglés aunque el
        // resto del producto esté en español. `lang` no se estaba pasando: es
        // una línea y es la diferencia entre una sala nuestra y una sala ajena.
        // ⚠️ No se usa `'user'` (el idioma del navegador) a propósito: el
        // producto es en español y no queremos media sala en el idioma del
        // sistema operativo de cada uno.
        lang: "es",
        showLeaveButton: true,
        // SIN el botón de pantalla completa de Daily. Antes (reunión 7-ago) el
        // motivo era que ponía el IFRAME a pantalla completa y se llevaba por
        // delante nuestro chat, que vivía fuera. Desde MN-04 el motivo es otro
        // y más simple: la sala YA ocupa el viewport, así que ese botón solo
        // serviría para tapar el chat y la barra de sesión — y su versión útil
        // ("quiero más vídeo") es el botón de chat de aquí abajo.
        showFullscreenButton: false,
        // MN-04 · Mentorías 1:1: dos teselas caben de sobra en la rejilla, y la
        // tira lateral de participantes de Prebuilt solo restaría ancho al
        // vídeo repitiendo lo que ya se ve. Si algún día hay sesiones de grupo,
        // esta línea es la que hay que quitar.
        showParticipantsBar: false,
        layoutConfig: { grid: { maxTilesPerPage: 2 } },
        // MN-04 · el naranja de marca dentro del iframe. Ver `SALA`.
        theme: TEMA_DAILY,
        // MN-04 · nuestro botón de chat, en SU barra. Nace en el estado que
        // tenga el panel ahora mismo: el efecto de arriba puede haber corrido
        // antes de que terminara el `import()` dinámico.
        customTrayButtons: botonesTray(chatAbiertoRef.current, sinLeerRef.current),
        // El contenedor es `relative` y el iframe se ancla a sus cuatro lados:
        // con `height: 100%` a secas, un contenedor que saca su alto del flex
        // deja el iframe en 0 en algunos navegadores.
        iframeStyle: {
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          border: "0",
        },
      });
      callRef.current = call;

      call.on("left-meeting", () => {
        setJoined(null);
        router.refresh();
      });
      call.on("error", (e) => {
        toast.error("Se perdió la conexión con la sala.");
        console.error("[daily] error:", JSON.stringify(e));
      });
      // MN-04 · el clic llega desde dentro del iframe. `button_id` es la clave
      // del objeto que se le pasó en `customTrayButtons`.
      call.on("custom-button-click", (e) => {
        if (e.button_id !== "chat") return;
        alternarChat();
      });
      // Y aquí se salda la deuda del efecto de arriba: mientras la llamada no
      // estaba unida, `updateCustomTrayButtons()` no se podía llamar (lanza).
      // El espejo guardó el estado real del panel; al unirse se repinta el
      // botón para que no salga apagado con el chat abierto, o al revés.
      call.on("joined-meeting", () => {
        call.updateCustomTrayButtons(
          botonesTray(chatAbiertoRef.current, sinLeerRef.current),
        );
      });

      try {
        await call.join({ url: joined.roomUrl, token: joined.token ?? undefined });
      } catch (e) {
        console.error("[daily] join falló:", JSON.stringify(e));
        toast.error("No pudimos conectar con la sala de video.");
      }
    })();

    return () => {
      cancelled = true;
      if (callRef.current) {
        void callRef.current.destroy();
        callRef.current = null;
      }
    };
  }, [live, joined, router, alternarChat]);

  async function join() {
    setBusy(true);
    // El endpoint autoriza vía `join_session` (ventana, participante, ciclo) y
    // firma el token contra Daily con la API key (server-only).
    const res = await fetch(`/api/room/${sessionId}`, { method: "POST" });
    const body = await res.json();
    setBusy(false);

    if (!res.ok) {
      toast.error(body.error ?? "No se pudo entrar a la sala.");
      router.refresh();
      return;
    }
    joinedAt.current = Date.now();
    setJoined({
      roomUrl: body.roomUrl,
      token: body.token,
      endsAt: body.endsAt,
      simulated: Boolean(body.simulated),
    });
  }

  // ⚠️ MN-05 · Vuelve a pedir entrada cuando empieza la MENTORÍA. Aquí hay
  // dinero, aunque no lo parezca.
  //
  // `join_session` solo mueve el ciclo M5 (sesión → `in_progress`, y con ella la
  // reserva) si el reloj cae dentro de la ventana de la CLASE, no de la de
  // acceso. Es a propósito: abrir la sala el martes para probar la cámara no es
  // empezar la clase del lunes siguiente, y si lo fuera, la reserva saltaría a
  // `in_progress` una semana antes y `cancel_booking` dejaría de aceptarla — el
  // alumno perdería sin enterarse el reembolso del 100 % que le da RN-37 por
  // avisar con 24 h.
  //
  // El precio de esa decisión es este efecto. Quien entró antes de esos 10
  // minutos y se quedó dentro del iframe toda la clase no volvería a pedir
  // entrada jamás: el cron cerraría la sesión como `no_show` y el tutor no
  // cobraría una clase que sí dio. Una llamada más, justo al abrirse la
  // ventana de la clase, lo arregla.
  //
  // Solo para quien entró ANTES: en una entrada normal el ciclo ya se movió en
  // el `join()` de arriba y repetir solo gastaría un token de Daily.
  useEffect(() => {
    if (!joined || now === null || cicloPedido.current) return;
    if (joinedAt.current === null || joinedAt.current >= liveOpens) return;
    if (now < liveOpens || now > liveCloses) return;
    cicloPedido.current = true;
    void fetch(`/api/room/${sessionId}`, { method: "POST" });
  }, [joined, now, liveOpens, liveCloses, sessionId]);

  // N-24 · AQUÍ VIVÍA "Subir documentos", y se quita por feedback del cliente:
  // subir un archivo se ofrecía DOS veces en la misma pantalla —este botón de la
  // barra y el clip del composer del chat, a treinta centímetros— y las dos
  // acababan en el mismo sitio, `uploadAttachment(bookingId, …)`, porque el
  // panel de al lado es el hilo de EP-17, no una copia.
  //
  // Se va este y no el clip porque este era además el peor de los dos: no hacía
  // append optimista, así que quien subía desde la barra no veía su archivo
  // hasta que Realtime devolvía el eco, y con la sala en primer plano eso
  // parecía que no había pasado nada.
  //
  // ⚠️ Venía del Figma (LV01). Si no queda constancia, la próxima pasada de
  // diseño lo devuelve tal cual y volvemos a tener dos botones. Y ojo: con
  // MN-04 la barra de abajo la pinta DAILY, así que devolverlo sería además
  // pelearse con `customTrayButtons`.

  async function complete() {
    if (!window.confirm("¿Marcar la sesión como completada? La sala se cerrará.")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_session", { p_session_id: sessionId });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo completar la sesión.");
      return;
    }
    setJoined(null);
    toast.success("Sesión completada.");
    router.refresh();
  }

  // ── Estado en vivo (unido) ────────────────────────────────────────────────
  if (live && joined && now !== null) {
    const total = new Date(endAt).getTime() - new Date(startAt).getTime();
    // MN-05 · topado al total. Sin esto, entrar a la sala al día siguiente
    // pintaba "4320:00 / 60:00" en la cabecera: la sala vive una semana, la
    // clase sigue durando lo que dura.
    const elapsed = Math.min(now - new Date(startAt).getTime(), total);

    return (
      /*
       * MN-04 · La sala, a pantalla completa y oscura.
       *
       * `h-svh` + `overflow-hidden`: el alto lo reparte esta rejilla y no hay
       * scroll de página. Se usa la unidad `svh` (viewport PEQUEÑO) y no `dvh`
       * a propósito — con `dvh` la barra del navegador móvil al replegarse
       * cambia el alto y la barra de controles de Daily baila.
       */
      <div
        style={VARS_SALA}
        className="flex h-svh w-full flex-col overflow-hidden bg-[color:var(--sala-bg)] text-[color:var(--sala-text)]"
      >
        {/* V-2 · La cabecera de marca, activa y con red debajo. Ver
            `GuardaDeSalida`: sin ella cada enlace de aquí arriba es una forma
            silenciosa de caerse de la clase. */}
        <GuardaDeSalida activa>{header}</GuardaDeSalida>

        {/* Barra de sesión (LV01): qué clase es, con qué número y cuánto lleva.
            El número va aquí y no escondido en un menú porque el caso de uso es
            "estoy en la clase y llamo a soporte": tiene que poder leerse sin
            salir de aquí.

            ⚠️ V-2 · EN BLANCO, no en el oscuro de la sala. Era oscura desde
            MN-04, cuando esta franja era lo único que había por encima del
            vídeo y se quería que no se notara. Con la cabecera de marca justo
            arriba, dos barras oscuras encadenadas separaban el logo del vídeo
            con una zanja negra; el cliente pidió esta en blanco y así engancha
            con la cabecera y hace de borde superior del área de Daily.

            Micro, cámara, compartir pantalla, dispositivos y "salir" siguen
            siendo de Daily y viven en SU barra, abajo. */}
        <header className="flex shrink-0 items-center gap-4 border-b bg-background px-3 py-2 text-foreground sm:px-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-bold">{productTitle}</h1>
            {/* V-2 · vuelve a su `text-muted-foreground` de siempre: llevaba
                el gris claro de la sala porque el fondo era #14141a, y ahora es
                blanco. Sobre blanco, ese gris no se lee. */}
            <SessionRef nro={sessionRef} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {/*
              MN-04 · El interruptor del chat también aquí, y no solo en la barra
              de Daily. Tres razones, y ninguna es de gusto:
              · La barra de Daily **aparece y desaparece con el ratón**, así que
                el único camino de vuelta al chat sería un botón efímero.
              · Vive DENTRO del iframe: para un lector de pantalla o para el
                teclado, nuestro panel se quedaría sin control alcanzable.
              · En móvil el panel tapa la barra entera, incluido ese botón.
              Aquí además puede declarar `aria-expanded`/`aria-controls`, cosa
              que un botón inyectado en un iframe ajeno no puede.
            */}
            {/*
              `<button>` plano y no el componente `Button`: aquí lleva un punto
              de aviso posicionado y dos atributos ARIA propios, y para eso una
              etiqueta suelta es más honesta que pelearse con las variantes.

              ⚠️ V-2 · CON PUNTO DE AVISO, y es la mitad de la petición. Plegar
              el chat por defecto sin esto es dejar sordo al usuario: los
              mensajes entran, el hilo los recibe —sigue montado— y nadie se
              entera. El punto sale de `sinLeer`, que solo se mueve cuando el
              panel está plegado (ver `visible` en `chat-thread.tsx`).
            */}
            <button
              ref={toggleChatRef}
              type="button"
              aria-expanded={chatAbierto}
              aria-controls="panel-chat-sala"
              onClick={alternarChat}
              className="relative rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
            >
              {chatAbierto ? "Ocultar chat" : "Mostrar chat"}
              {sinLeer > 0 ? (
                <span
                  // `aria-hidden` en el punto y el número en texto para el
                  // lector: un círculo naranja no se puede leer en voz alta.
                  aria-hidden
                  // `primary` (#fe6a00) y no `brand` (#0080ff): la naranja es
                  // el acento de la sala — el mismo `SALA.accent` que Daily usa
                  // dentro del iframe para sus botones activos. Con el azul,
                  // dos avisos a diez centímetros hablarían en dos colores.
                  className="absolute -top-1.5 -right-1.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground"
                >
                  {sinLeer > 9 ? "9+" : sinLeer}
                </span>
              ) : null}
              {sinLeer > 0 ? (
                <span className="sr-only">
                  {" "}
                  ({sinLeer === 1 ? "1 mensaje" : `${sinLeer} mensajes`} sin
                  leer)
                </span>
              ) : null}
            </button>

            {/*
              EY-189 · «Reportar conducta», dentro de la clase.

              Va en ESTA barra y no en la de Daily por lo mismo que «Marcar
              completada»: la barra del iframe aparece y desaparece con el
              ratón, vive fuera de nuestro DOM y no admite más que iconos de
              36px sin ARIA propia. Un botón que se usa una vez al año tiene que
              estar donde se pueda encontrar cuando hace falta, no donde haya
              que descubrirlo.

              ⚠️ Y VA AQUÍ ARRIBA, SOBRE BLANCO, A PROPÓSITO. El contenedor de
              la sala lleva `text-[color:var(--sala-text)]`, que es #ffffff;
              esta cabecera es la única franja que reestablece `bg-background` +
              `text-foreground` (misma cura que `GuardaDeSalida` aplica al
              `SiteHeader`, y por el mismo motivo: allí la campana y el menú de
              cuenta estaban en blanco sobre blanco). Un botón sin clase de
              color hereda de la cabecera y se lee. Si algún día se mueve al
              área de vídeo o al panel de chat, hay que darle color explícito
              con los tokens `--sala-*` — y comprobarlo en pantalla, que es como
              se encontraron los dos casos anteriores.

              El diálogo en sí sale por un portal y se pinta en claro pase lo
              que pase; ver la nota del prop `trigger`.
            */}
            {conversationId ? (
              <ReportConversation
                conversationId={conversationId}
                trigger={
                  <button
                    type="button"
                    // Mismas medidas que «Mostrar chat», su vecino: en una
                    // barra de tres controles, dos pesos distintos se leen como
                    // dos jerarquías que aquí no existen.
                    // El rótulo se esconde por debajo de `sm`: a 375px esta
                    // barra ya iba justa con el cronómetro y «Marcar
                    // completada», y una etiqueta más la desbordaba. El icono
                    // se queda, y el nombre accesible lo pone `aria-label` —no
                    // un `sr-only` extra— para que no haya dos textos.
                    aria-label="Reportar conducta"
                    title="Reportar conducta"
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                  >
                    <FlagIcon className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Reportar</span>
                  </button>
                }
              />
            ) : null}

            <div className="text-right">
              <p
                className="font-mono text-sm tabular-nums sm:text-base"
                suppressHydrationWarning
              >
                {clock(elapsed)} / {clock(total)}
              </p>
              {/* Antes vivía en la barra inferior nuestra, que ya no existe:
                  abajo manda Daily. Aquí abajo del cronómetro dice lo mismo. */}
              <p
                className="text-[11px] text-muted-foreground"
                suppressHydrationWarning
              >
                Termina en {human(new Date(joined.endsAt).getTime() - now)}
              </p>
            </div>

            {/*
              ⚠️ Doble puerta, y la segunda es de dinero.

              Hasta MN-05 esta vista solo se alcanzaba dentro de los ±10 min
              de la clase, así que el botón vivía pegado a ella. MN-05 abrió la
              sala 7 días y con ella se venía el botón; B-2 la devolvió a 10
              min, así que hoy vuelven a coincidir. La doble puerta se queda:
              que coincidan es coincidencia, y esta ventana la mueve el cliente
              cada semana mientras que la de la clase es dinero.

              · El ESTADO evita el botón que solo sabe dar error:
                `complete_session` acepta `scheduled`/`in_progress` y nada
                más. Es el mismo criterio que `tutor/reservas/[id]`.
              · La VENTANA DE LA CLASE es la que importa de verdad: una
                mentoría que es dentro de seis días también está `scheduled`,
                así que sin esto el tutor podía entrar el martes, pulsar, y
                `complete_session` ponía `bookings.completed_at = now()` —
                exactamente el reloj que toda la migración de MN-05 existe
                para NO mover, y del que cuelga su payout.

              Y se queda AQUÍ, fuera de `customTrayButtons`: un botón que mueve
              el reloj del cobro no puede ser un icono de 36px sin etiqueta en
              una barra que aparece y desaparece con el ratón.
            */}
            {isTutor &&
            (sessionStatus === "scheduled" || sessionStatus === "in_progress") &&
            now >= liveOpens &&
            now <= liveCloses ? (
              <Button size="sm" disabled={busy} onClick={complete}>
                Marcar completada
              </Button>
            ) : null}
          </div>
        </header>

        {/* Vídeo + chat. `relative` porque en móvil el panel se SUPERPONE a esta
            zona (ver el `aside`), no se pone al lado: a 375px dos columnas no
            caben, y partir el alto dejaría el vídeo en un sello. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col bg-[color:var(--sala-video)]">
            {joined.simulated ? (
              // Sin credenciales de Daily: la sala, el token y la ventana ya
              // funcionan; falta solo el transporte de video.
              <div className="flex min-h-0 flex-1 items-center justify-center text-[color:var(--sala-supportive)]">
                <div className="flex flex-col items-center gap-2 p-6 text-center">
                  <p className="text-sm uppercase tracking-wide">Sala simulada</p>
                  <p className="max-w-sm text-sm">
                    Falta configurar el proveedor de video. La sala, el token y la
                    ventana de acceso ya funcionan.
                  </p>
                  <p className="mt-2 break-all font-mono text-xs opacity-70">
                    {joined.roomUrl}
                  </p>
                </div>
              </div>
            ) : (
              // El iframe prefabricado de Daily: sus teselas, su barra de
              // controles, su selector de dispositivos, su compartir pantalla y
              // su reconexión de red (US-803). Lo nuestro es el marco y el chat
              // — el rediseño de MN-04 se hizo SOBRE Prebuilt, no migrando a
              // `createCallObject`, que habría obligado a reimplementar todo eso.
              <div ref={frameRef} className="relative min-h-0 flex-1" />
            )}

            {/* Barra de controles SOLO en simulado: con Daily real esta franja
                la pinta el iframe (y con ella la reconexión, US-803). Aquí se
                pinta a mano para que la sala siga siendo ejercitable sin
                credenciales — incluido el botón que abre el chat, que en real
                vive en la barra de Daily. */}
            {joined.simulated ? (
              <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] p-3">
                <Button
                  size="sm"
                  variant={muted ? "default" : "outline"}
                  onClick={() => setMuted((m) => !m)}
                >
                  {muted ? "Activar micro" : "Silenciar"}
                </Button>
                <Button
                  size="sm"
                  variant={camOff ? "default" : "outline"}
                  onClick={() => setCamOff((c) => !c)}
                >
                  {camOff ? "Activar cámara" : "Apagar cámara"}
                </Button>
                <Button
                  size="sm"
                  variant={chatAbierto ? "default" : "outline"}
                  aria-pressed={chatAbierto}
                  onClick={alternarChat}
                >
                  {sinLeer > 0 ? `Chat (${sinLeer > 9 ? "9+" : sinLeer})` : "Chat"}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setJoined(null)}>
                  Salir
                </Button>
              </div>
            ) : null}
          </div>

          {/* El hilo es el MISMO de EP-17 (`/chat/<reserva>`), no una copia:
              mismos mensajes, misma RLS, mismo Realtime.

              ⚠️ Se monta SIEMPRE y se esconde con `hidden`, en vez de sacarlo
              del árbol cuando está cerrado. Desmontarlo cerraría el canal de
              Realtime del hilo: quien pliegue el chat para ver el vídeo grande
              se perdería los mensajes de ese rato. Es además el comportamiento
              que ya tenía la sala, donde el panel estaba siempre montado.

              Móvil: `absolute inset-0` sobre la zona de vídeo. Escritorio
              (`lg:`): vuelve al flujo como columna de 360px a la derecha, que
              es el "chat incrustado a la derecha" que pidió el cliente. */}
          <aside
            id="panel-chat-sala"
            aria-label="Chat de la mentoría"
            className={
              chatAbierto
                ? "absolute inset-0 z-20 flex flex-col border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] lg:relative lg:inset-auto lg:z-auto lg:w-[360px] lg:shrink-0 lg:border-l"
                : "hidden"
            }
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--sala-border)] px-4 py-3">
              <h2 className="font-semibold">Chat</h2>
              <div className="flex items-center gap-2">
                {/* ⚠️ ESTE ENLACE A `/chat/<id>` SOBREVIVE A PROPÓSITO — NO LO
                    BORRES CREYENDO QUE SE OLVIDÓ.

                    El 27-ago se retiró la navegación a `/chat/[threadId]` desde
                    DENTRO de la app: el botón de la ficha del tutor, el «Chat»
                    del panel del tutor y los avisos de la campana abren ahora la
                    burbuja sin cambiar de pantalla («que abra directo en la
                    burbuja de chat», cliente, 27-ago). Aquí no, y la razón es
                    que **la sala es el único sitio sin burbuja**: `(room)` no
                    monta `ChatLauncher` y eso es la decisión MN-04 —la burbuja
                    flotante encima del vídeo dejaba el iframe de Daily en 34rem—.
                    Sin burbuja que abrir, pedirle a la burbuja que se abra sería
                    un clic muerto, y la página es la respuesta correcta.

                    Que siga siendo el id de la RESERVA tampoco es un descuido:
                    la página resuelve los dos (conversación, y si no, reserva →
                    conversación vía `conversation_of_booking`). Ver su docblock.

                    Sigue sin `target="_blank"`, como estaba: no se ha tocado
                    aquí nada más que este comentario. */}
                <Link
                  href={`/chat/${bookingId}`}
                  className="text-[11px] text-[color:var(--sala-supportive)] underline-offset-2 hover:underline"
                  title="Ver el hilo completo fuera de la sala"
                >
                  Ver hilo completo
                </Link>
                {/* ⚠️ Este aspa NO es un duplicado del botón de la barra de
                    Daily: en móvil el panel TAPA el iframe, así que ese botón
                    queda debajo y no hay forma de volver al vídeo sin esto. */}
                <button
                  type="button"
                  onClick={() => {
                    plegarChat();
                    // El `aside` pasa a `display:none` con el foco DENTRO: sin
                    // esto el navegador lo devuelve al `body` y quien navega con
                    // teclado tiene que tabular desde el principio de la página.
                    toggleChatRef.current?.focus();
                  }}
                  aria-label="Ocultar el chat"
                  className="rounded-md p-1 text-[color:var(--sala-supportive)] hover:bg-[color:var(--sala-surface)] hover:text-[color:var(--sala-text)]"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            </div>
            {/*
              V-2 · El hilo, en el gris de Daily. Antes esto era una isla BLANCA
              (`bg-background` con los tokens claros de siempre) pegada al vídeo
              — el recuadro del que se quejó el cliente. Ahora `VARS_CHAT_SALA`
              redefine los tokens para este subárbol y el mismo componente se
              pinta oscuro aquí y claro en las otras cuatro pantallas, sin tocar
              una línea suya. Ver la nota de la constante.
            */}
            <div
              style={VARS_CHAT_SALA}
              className="min-h-0 flex-1 bg-background p-3 text-foreground"
            >
              <ChatThread
                fill
                bookingId={bookingId}
                currentUserId={currentUserId}
                firstSessionAt={firstSessionAt}
                initialMessages={initialMessages}
                // V-2 · las dos props que hacen que plegar el chat no sea
                // quedarse sordo: con el panel plegado el hilo sigue montado
                // (para no perder su Realtime) pero deja de marcar leído y
                // avisa aquí, que es quien pinta el contador.
                visible={chatAbierto}
                onIncoming={avisarMensaje}
              />
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // ── Estados previos / posteriores ─────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col">
      {/* V-2 · AQUÍ VIVÍA UNA BARRA MÍNIMA hecha a mano —logo y «Volver a mis
          reservas»— porque la sala dejó de colgar de `(app)` con MN-04 y se
          quedó sin cabecera. Ya no hace falta imitarla: la de verdad llega por
          `header`. Sin guarda en esta rama, y a propósito: aquí no hay llamada
          viva de la que caerse.

          El enlace directo a las reservas no se pierde — baja al cuerpo, donde
          se ve en los cuatro estados y no solo en dos. */}
      {header}

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm text-muted-foreground">Mentoría</p>
          <h1 className="text-xl font-semibold">{productTitle}</h1>
          {/* También antes de entrar y después de salir: la consulta a soporte
              suele ser justo cuando la sala NO deja pasar. */}
          <SessionRef nro={sessionRef} />
          <Link
            href={isTutor ? "/tutor/reservas" : "/reservas"}
            className="mt-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Volver a mis reservas
          </Link>
        </div>

        {now === null ? (
          /*
           * RV-18 · Estado neutro mientras no hay reloj — o sea, en el SSR y en
           * el primer render del cliente.
           *
           * NO se puede caer a ninguna de las ramas de abajo: todas dependen de
           * comparar la hora actual con la ventana de la sala, y si el servidor
           * eligiera una rama y el navegador otra, cambiaría la ESTRUCTURA del
           * árbol — el React #418 que se ve en producción. Un estado propio, que
           * dura lo que tarda el efecto de montaje, es la única forma de que las
           * dos pasadas pinten lo mismo sin mentir sobre el estado de la sala.
           */
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            Comprobando el horario de la sesión…
          </p>
        ) : !bookingAllowsRoom || sessionCancelled ? (
          <>
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {sessionCancelled
                ? "Esta sesión se canceló, así que su sala no se abre."
                : "Esta reserva no está activa, así que la sala no está disponible."}
            </p>
            <Button asChild variant="outline">
              <Link href={isTutor ? "/tutor/reservas" : "/reservas"}>Volver a mis reservas</Link>
            </Button>
          </>
        ) : beforeWindow ? (
          <>
            <div className="rounded-lg border p-6">
              <p className="text-sm text-muted-foreground">La sala abre en</p>
              {/* El reloj del server y el del cliente difieren en segundos: es
                  esperado en una cuenta regresiva, no un fallo de render. */}
              <p className="mt-1 text-3xl font-semibold tabular-nums" suppressHydrationWarning>
                {human(opens - now)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                La sala abre 10 minutos antes de la mentoría y sigue abierta 10
                minutos después.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {new Date(startAt).toLocaleString("es", { timeZone, dateStyle: "full", timeStyle: "short" })}
            </p>
            {/* El permiso se puede dar mientras esperas: RN-42 pide que esté
                decidido ANTES de entrar, no que la sala ya esté abierta. */}
            <RecordingConsent
              sessionId={sessionId}
              userId={currentUserId}
              isTutor={isTutor}
              mine={consent.mine}
              other={consent.other}
            />
          </>
        ) : afterWindow ? (
          <>
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              La ventana de acceso de esta sesión ya cerró.
            </p>
            <Button asChild variant="outline">
              <Link href={isTutor ? "/tutor/reservas" : "/reservas"}>Volver a mis reservas</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
              {/* MN-05 · Con la clase ya cerrada la sala sigue abierta una
                  semana, y decir solo "la sala está abierta" haría pensar que la
                  mentoría no ha ocurrido. El estado de la sesión y el de la sala
                  son cosas distintas y aquí se dicen las dos. */}
              {sessionEnded
                ? `Esta mentoría ya terminó, pero su sala sigue abierta ${human(closes - now)} más.`
                : `La sala está abierta. Cierra en ${human(closes - now)}.`}
            </p>
            {/* RN-42: el permiso se pide ANTES de entrar, no a mitad de clase. */}
            <RecordingConsent
              sessionId={sessionId}
              userId={currentUserId}
              isTutor={isTutor}
              mine={consent.mine}
              other={consent.other}
            />
            <Button size="lg" disabled={busy} onClick={join} className="min-w-40">
              {busy ? "Entrando…" : "Entrar a la sala"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
