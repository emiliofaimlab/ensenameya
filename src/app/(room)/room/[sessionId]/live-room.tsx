"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlagIcon, XIcon } from "lucide-react";
import type { DailyCall } from "@daily-co/daily-js";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { opcionesDeHora, type FormatoHora } from "@/lib/hora";
import { RESENA_MIN_ANTES_DEL_FIN } from "@/lib/resena";
import { Button } from "@/components/ui/button";
import { AddToCalendar } from "@/components/calendar/add-to-calendar";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import type { GrupalChat } from "@/components/chat/grupo";
import { ReportConversation } from "@/components/chat/report-conversation";
import { RecordingConsent } from "@/components/room/recording-consent";
import { SessionRef } from "@/components/room/session-ref";
// EY-221 · herramientas de la clase en vivo (ver `components/sala/`).
import { AvisoMano, BarraControles } from "@/components/sala/barra-herramientas";
import { canalDaily, canalSimulado, type CanalSala } from "@/components/sala/canal-sala";
import { ContadorClase } from "@/components/sala/contador-clase";
import { actualizarOrden, ordenados } from "@/components/sala/escenario";
import { EscenarioSala } from "@/components/sala/escenario-sala";
import { PanelMateriales } from "@/components/sala/presentacion/panel-materiales";
import { usePresentacion } from "@/components/sala/presentacion/use-presentacion";
import { VisorPresentacion } from "@/components/sala/presentacion/visor-presentacion";
import { AudiosRemotos } from "@/components/sala/tesela";
import { useManoLevantada } from "@/components/sala/use-mano-levantada";
import { usePantallaCompleta } from "@/components/sala/use-pantalla-completa";
import { useParticipantes } from "@/components/sala/use-participante-remoto";
import { useVentanaFlotante, VentanaFlotante } from "@/components/sala/ventana-flotante";
import { VistaPrevia } from "@/components/sala/vista-previa";

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
 * Vive en un objeto porque se reparte en DOS juegos de variables CSS: los de
 * la sala (`VARS_SALA`) y los del chat (`VARS_CHAT_SALA`). Antes había un
 * tercer consumidor, el `theme` del iframe de Daily Prebuilt; desde que la
 * sala es nuestra (`createCallObject`, correcciones del 16-oct) ya no.
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

/** El mismo objeto como variables CSS, para toda la sala. */
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
 * El `destroy()` de la última llamada, si sigue en curso. Daily solo admite UNA
 * instancia viva por página y `destroy()` es asíncrono: crear la siguiente
 * antes de que termine lanza «Duplicate DailyIframe instances» y la sala se
 * queda sin llamada (pasaba al recrearla, y pasa con el doble montaje del modo
 * estricto en desarrollo).
 */
let destruyendo: Promise<void> = Promise.resolve();

type Joined = {
  roomUrl: string;
  token: string | null;
  endsAt: string;
  /** Sin credenciales de Daily la sala va simulada (ver `lib/daily.ts`). */
  simulated: boolean;
};

/** M6 · Daily rechaza la entrada porque la sala llegó a su cupo. */
const SALA_LLENA =
  "La sala está llena. Si la tienes abierta en otra pestaña, ciérrala y vuelve a entrar.";

// EY-221 · AQUÍ VIVÍA `clock()`, el formato del cronómetro de la cabecera. El
// cronómetro bajó a ser el contador superpuesto sobre el vídeo y su formato se
// fue con él: `reloj()` en `components/sala/contador-clase.tsx`.

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
  endAt: endAtInicial,
  opensAt,
  closesAt: closesAtInicial,
  extendida: extendidaInicial,
  sessionStatus,
  bookingStatus,
  productTitle,
  sessionRef,
  timeZone,
  formato,
  isTutor,
  currentUserId,
  firstSessionAt,
  initialMessages,
  entendido: entendidoInicial,
  grupal,
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
  /** EY-232 · `sessions.extended_at` no nulo: el tutor ya usó sus 5 min. */
  extendida: boolean;
  sessionStatus: SessionStatus;
  bookingStatus: BookingStatus;
  productTitle: string;
  /** N-27 · "N.º de sesión" visible. Null en reservas viejas (ver migración). */
  sessionRef: string | null;
  /** RV-18/RN-01 · la resuelve la página en servidor; sin ella el SSR
   *  formatea en UTC y la hora no coincide con la del navegador. */
  timeZone: string;
  /** 12 h o 24 h (`ey-h12`): viaja con `timeZone`, que es la otra mitad. */
  formato: FormatoHora;
  isTutor: boolean;
  currentUserId: string;
  firstSessionAt: string | null;
  initialMessages: ChatMessage[];
  /**
   * ¿este usuario ya marcó el «Entiendo» de la grabación?
   *
   * Antes eran DOS booleanos (`consent: {mine, other}`): la grabación se pedía
   * y hacía falta el sí de los dos, así que había que poder decir «falta que el
   * tutor acepte». Desde el 28-ago la mentoría se graba siempre y esto solo
   * informa, así que el estado del otro dejó de significar nada. Ver
   * `RecordingConsent`.
   */
  entendido: boolean;
  /**
   * G3 · sala COMPARTIDA de una fecha grupal (RG-12). Cambia el endpoint
   * (`join_group_class`), la rejilla (cupo + 1), el chat (el del grupo, con el
   * nombre de cada uno) y a dónde se vuelve. `sessionId` sigue siendo la
   * sesión del alumno —o una de la fecha, para el tutor—: de ella cuelgan el
   * «Entiendo» de la grabación y el canal de cierre.
   */
  grupal?: {
    groupClassId: string;
    capacity: number;
    chatConversationId: string | null;
    /** Quién es quién en el hilo del grupo: nombre, foto y si es el tutor. */
    chat: GrupalChat;
    /**
     * P45 · alguna lectura del hilo falló (o no hay hilo). La sala lo dice en
     * vez de quedarse en «Abriendo la conversación…» para siempre.
     */
    chatNoDisponible?: boolean;
    volverHref: string;
  };
}) {
  const router = useRouter();
  // P43 · UN sustantivo en toda la sala: antes una grupal decía «Clase
  // grupal» arriba y «Esta mentoría se graba» o «abre 10 minutos antes de la
  // mentoría» abajo. Llega por props a los componentes que lo escriben.
  const sustantivo = grupal ? "clase" : "mentoría";
  const esGrupal = Boolean(grupal);
  // G3 · en una grupal se vuelve a la clase (tutor) o a la inscripción
  // (alumno), no a la lista de reservas; ver `grupal.volverHref`.
  const volver = grupal
    ? { href: grupal.volverHref, label: isTutor ? "Volver a la clase" : "Volver a mi inscripción" }
    : { href: isTutor ? "/tutor/reservas" : "/reservas", label: "Volver a mis reservas" };
  const endpointSala = grupal
    ? `/api/room/grupal/${grupal.groupClassId}`
    : `/api/room/${sessionId}`;
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
  // EY-232 · el fin y el cierre de la sala se mueven si el tutor extiende la
  // clase: llegan por Realtime (a los dos) o por la respuesta (a quien pulsa).
  const [endAt, setEndAt] = useState(endAtInicial);
  const [closesAt, setClosesAt] = useState(closesAtInicial);
  const [extendida, setExtendida] = useState(extendidaInicial);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  /**
   * El «Entiendo» de la grabación, que ahora es OBLIGATORIO para entrar.
   *
   * Vive aquí y no dentro de `RecordingConsent` porque quien tiene que
   * reaccionar a la casilla es el botón de entrar, que está fuera de ella. El
   * valor inicial lo resuelve la página en servidor (¿hay fila suya?); a partir
   * de ahí lo mueve el propio componente al escribir en la base.
   */
  const [entendido, setEntendido] = useState(entendidoInicial);
  /**
   * M5 · con qué se entra a una grupal, elegido en la vista previa de la
   * antesala. El alumno llega con el micro APAGADO (en un grupo, todos con el
   * micro abierto es ruido desde el primer segundo); el tutor, abierto. Se
   * copia a un ref en `join()` para que el efecto de Daily lo lea sin
   * depender de él (cambiarlo no debe rehacer la llamada). En 1:1 no se usa.
   */
  const [previa, setPrevia] = useState({ micro: isTutor, camara: true });
  const previaRef = useRef(previa);
  /**
   * A dónde se va uno al salir de la sala: SU detalle de la reserva.
   *
   * ⚠️ Antes salir era `setJoined(null)`, o sea volver a esta misma pantalla en
   * su rama de «todavía no has entrado» — con el aviso de grabación y el botón
   * de entrar otra vez. El cliente lo describió tal cual: «cuando le damos al
   * botón de salir nos manda a la pantalla del check de que la mentoría será
   * grabada. No debe ocurrir más». Salir de una clase es terminar, no volver a
   * la puerta.
   *
   * Tutor y alumno tienen detalles distintos (`/tutor/reservas/<id>` y
   * `/reservas/<id>`) y cada uno solo puede leer el suyo: mandar al alumno al
   * del tutor sería un 404 por RLS.
   */
  const detalleDeLaReserva = grupal
    ? grupal.volverHref
    : isTutor
      ? `/tutor/reservas/${bookingId}`
      : `/reservas/${bookingId}`;
  /**
   * Una sola salida, aunque la empujen tres cosas a la vez.
   *
   * Se sale por cuatro caminos —el «Salir» de la barra de controles (en
   * real o simulada), «Marcar completada» y el cierre que llega por Realtime— y varios
   * se encadenan: `leave()` dispara `left-meeting`, y navegar desmonta el
   * componente, cuyo `destroy()` puede disparar otro. Sin este pestillo, la
   * misma salida haría dos o tres `router.push` seguidos.
   */
  const saliendo = useRef(false);
  // ⚠️ El fin va por ref y NO en las dependencias de `salirDeLaSala`: de ella
  // cuelga el efecto que crea la llamada, y extender la clase (que mueve
  // `endAt`) destruía y rehacía la llamada entera a mitad de clase.
  const endAtRef = useRef(endAt);
  useEffect(() => {
    endAtRef.current = endAt;
  }, [endAt]);
  /** M2 · el tutor me sacó (`ejected`): al salir no se pide reseña. */
  const expulsado = useRef(false);
  const salirDeLaSala = useCallback(() => {
    if (saliendo.current) return;
    saliendo.current = true;
    // EY-220 · el ALUMNO que cuelga en los últimos 10 min de la clase, o ya
    // pasada la hora de fin, aterriza con `?resena=1` y el detalle le abre el
    // pop-up de reseña. Aquí solo se PIDE: el detalle decide en servidor si de
    // verdad toca (última sesión del paquete, sin reseña previa, reseñable).
    // El tutor no lo ve nunca. Misma navegación de siempre (regla 13).
    const pedirResena =
      !isTutor &&
      !expulsado.current &&
      Date.now() >= Date.parse(endAtRef.current) - RESENA_MIN_ANTES_DEL_FIN * 60_000;
    router.push(
      pedirResena ? `${detalleDeLaReserva}?resena=1` : detalleDeLaReserva,
    );
  }, [router, detalleDeLaReserva, isTutor]);
  // Micro y cámara de la sala simulada (con Daily, el estado es el de la llamada).
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
   * botón de chat de la barra de controles, fuera del componente de chat.
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
  const callRef = useRef<DailyCall | null>(null);
  // MN-05 · cuándo se pidió entrada. Solo se usa para saber si fue ANTES de que
  // la mentoría empezara; ver el efecto de re-autorización más abajo.
  const joinedAt = useRef<number | null>(null);
  const cicloPedido = useRef(false);

  // ── EY-221 · herramientas de la clase en vivo ─────────────────────────────
  //
  // `call` y `canal` son ESTADO (y no solo `callRef`) porque los hooks de
  // abajo tienen que enterarse de cuándo nacen: se crean dentro del efecto de
  // Daily, después del `import()` dinámico. En la sala simulada el canal es un
  // `BroadcastChannel` entre pestañas (ver `canal-sala.ts`) y nace en `join()`.
  const [call, setCall] = useState<DailyCall | null>(null);
  const [canal, setCanal] = useState<(CanalSala & { cerrar(): void }) | null>(
    null,
  );
  useEffect(() => () => canal?.cerrar(), [canal]);

  const { lista: participantes, yo, remoto, grabando } = useParticipantes(call);
  const mano = useManoLevantada({
    canal,
    nombreOtro: isTutor ? (grupal ? "Un alumno" : "El alumno") : "El tutor",
    otroPresente: remoto.presente,
    // B8 · en grupo la tutora lleva una cola con nombre y cada alumno solo ve
    // la suya. Los ids son los `session_id` de Daily, los mismos que da
    // `fromId` en el canal.
    grupal: grupal
      ? {
          soyTutor: isTutor,
          miId: yo?.id ?? (canal && "miId" in canal ? String(canal.miId) : null),
          nombreDe: (id) => participantes.find((p) => p.id === id)?.nombre ?? "Un alumno",
          presentes: participantes.map((p) => p.id),
        }
      : undefined,
  });
  const pres = usePresentacion({ canal, isTutor });
  // UN `sync-request` por canal, y DESPUÉS de que los dos hooks de arriba
  // estén escuchando (los efectos corren en orden de declaración): quien ya
  // estaba en la sala contesta con su mano y su presentación.
  useEffect(() => {
    canal?.enviar({ k: "sync-request" });
  }, [canal]);

  // A5 · en una grupal la grabación empieza A LA HORA DE INICIO: quien entra
  // antes recibe el token sin `start_cloud_recording` (`api/room/grupal`).
  // Llegada la hora, el cliente del tutor (owner, el único con permiso) la
  // arranca si aún no graba. Una sola vez: si ya la arrancó el token de un
  // alumno que entró en hora, Daily lo rechaza con un error no fatal
  // (`recording-error`), que no rompe nada. La 1:1 no pasa por aquí. El ref
  // guarda la LLAMADA a la que ya se le pidió: si se reentra, se pide otra vez.
  const grabacionPedida = useRef<DailyCall | null>(null);
  useEffect(() => {
    if (!esGrupal || !isTutor || !call || !joined || joined.simulated) return;
    if (grabando || grabacionPedida.current === call) return;
    if (now === null || now < Date.parse(startAt)) return;
    // `joined` llega con la respuesta del API, ANTES de `call.join`: si la hora
    // cae a mitad del join, el pedido se perdía. El tic de `now` reintenta.
    if (call.meetingState() !== "joined-meeting") return;
    grabacionPedida.current = call;
    try {
      call.startRecording();
    } catch (e) {
      console.warn("[daily] no se pudo arrancar la grabación:", e);
    }
  }, [esGrupal, isTutor, call, joined, grabando, now, startAt]);

  /** El contenedor que va a pantalla completa: vídeo + presentación + chat. */
  const salaRef = useRef<HTMLDivElement>(null);
  const pantalla = usePantallaCompleta(salaRef);
  const [panelMateriales, setPanelMateriales] = useState(false);

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

  // La llamada de Daily: se crea al unirse y se destruye al salir/desmontar.
  //
  // ⚠️ Correcciones de Emilio (16-oct) · ya NO es Daily Prebuilt
  // (`createFrame`), es `createCallObject`: Daily lleva el transporte —y con
  // él la reconexión ante caída de red (US-803) y la grabación que arranca el
  // token (`start_cloud_recording`)— y la interfaz ENTERA es nuestra. Era la
  // única forma de tener la barra a todo el ancho, el «Compartir» con
  // desplegable, las cámaras en franja al compartir y el turno entre pantalla
  // y documento: todo eso vivía dentro del iframe de daily.co.
  //
  // Lo que se reconstruyó a cambio: teselas (`tesela.tsx`), sonido de los demás
  // (`AudiosRemotos`), selector de micro/cámara, aviso de grabación y, en
  // grupales, silenciar/sacar (antes la lista de participantes de Prebuilt).
  useEffect(() => {
    if (!live || !joined || joined.simulated || callRef.current) return;

    let cancelled = false;
    void (async () => {
      const Daily = (await import("@daily-co/daily-js")).default;
      await destruyendo;
      if (cancelled) return;

      const call = Daily.createCallObject({ subscribeToTracksAutomatically: true });
      callRef.current = call;
      // EY-221 · el canal de la sala (mano, presentación) y la llamada como
      // estado, para los hooks. El canal se crea ANTES del `join`: encola lo
      // que se le pida hasta `joined-meeting`.
      setCanal(canalDaily(call));
      setCall(call);

      // Colgar (nuestro «Salir»), ser expulsado o que la sala caduque: al
      // detalle de la reserva. Ver `salirDeLaSala`.
      //
      // ⚠️ EL `cancelled` NO SOBRA. La limpieza de este efecto llama a
      // `destroy()`, que cuelga la llamada y puede emitir `left-meeting` él
      // solo. Sin esta guarda, salir de la sala por CUALQUIER otro camino —un
      // enlace de la cabecera, con su confirmación de `GuardaDeSalida` ya
      // aceptada— desmontaría el componente, el `destroy()` dispararía este
      // manejador y un `router.push` al detalle pisaría la navegación que el
      // usuario acababa de pedir.
      call.on("left-meeting", () => {
        if (cancelled) return;
        salirDeLaSala();
      });
      call.on("error", (e) => {
        // M6 · sala llena (otra pestaña abierta, o una reconexión que aún
        // ocupa su lugar): se dice qué hacer. Mismo id que el `catch` del
        // `join`, que suele saltar a la vez, para no duplicar el aviso.
        //
        // M2 · y se distingue por qué se cae: antes el expulsado leía «Se
        // perdió la conexión» y volvía a entrar con un clic. Los literales son
        // los de `DailyFatalErrorType` (daily-js 0.91).
        const tipo = e?.error?.type;
        if (tipo === "meeting-full") {
          toast.error(SALA_LLENA, { id: "sala-join" });
        } else if (tipo === "ejected") {
          // Antes de `left-meeting`, que es el que navega: así
          // `salirDeLaSala` ya sabe que no toca pedir reseña.
          expulsado.current = true;
          toast.error("El tutor te sacó de la sala.", { id: "sala-join" });
        } else if (tipo === "exp-room") {
          toast("La sala se cerró.");
        } else {
          toast.error("Se perdió la conexión con la sala.");
        }
        console.error("[daily] error:", JSON.stringify(e));
      });
      call.on("camera-error", (e) => {
        toast.error(
          e?.error?.type === "permissions"
            ? "El navegador no deja usar la cámara o el micrófono. Revisa los permisos del sitio."
            : "No pudimos encender la cámara o el micrófono.",
        );
      });
      call.on("network-connection", (e) => {
        if (e?.event === "interrupted") {
          toast.warning("Conexión inestable. Reconectando…", { id: "sala-red" });
        } else if (e?.event === "connected") {
          toast.dismiss("sala-red");
        }
      });

      try {
        await call.join({
          url: joined.roomUrl,
          token: joined.token ?? undefined,
          // M5 · en grupal, lo elegido en la vista previa; en 1:1, todo abierto.
          startVideoOff: esGrupal ? !previaRef.current.camara : false,
          startAudioOff: esGrupal ? !previaRef.current.micro : false,
        });
      } catch (e) {
        console.error("[daily] join falló:", JSON.stringify(e));
        // M6 · el `join` rechaza con el evento de error de Daily (o, según la
        // versión, con su texto): se miran las dos formas.
        const err = e as { error?: { type?: string }; errorMsg?: string } | null;
        const llena =
          err?.error?.type === "meeting-full" ||
          String(err?.errorMsg ?? e).toLowerCase().includes("full");
        toast.error(llena ? SALA_LLENA : "No pudimos conectar con la sala de video.", {
          id: "sala-join",
        });
        // Sin esto la pantalla se quedaba en «Conectando con la sala…» para
        // siempre: se vuelve al botón de entrar, y la limpieza del efecto
        // destruye la llamada fallida.
        if (!cancelled) setJoined(null);
      }
    })();

    return () => {
      cancelled = true;
      if (callRef.current) {
        destruyendo = callRef.current.destroy().catch(() => {});
        callRef.current = null;
      }
      setCall(null);
      setCanal(null);
    };
    // `salirDeLaSala` es estable (`useCallback` sobre el router y una cadena),
    // así que entra en la lista sin recrear la llamada en cada render. Si algún
    // día deja de serlo, este efecto empezaría a destruir y rehacer la llamada:
    // comprobarlo antes de tocarla.
    // `esGrupal` es un booleano: la prop `grupal` es un objeto nuevo en cada
    // refresco del servidor y, en la lista, destruiría la llamada.
  }, [live, joined, salirDeLaSala, esGrupal]);

  // La ventana flotante se abre sola al irse de la pestaña (corrección 5).
  const flotante = useVentanaFlotante(live);

  // Corrección 10 · lo compartido se turna: el último va al escenario.
  const clavesCompartidas = [
    ...participantes.filter((p) => p.pantalla).map((p) => `pantalla:${p.id}`),
    ...(pres.estado ? ["doc"] : []),
  ];
  const [orden, setOrden] = useState({});
  const ordenNuevo = actualizarOrden(orden, clavesCompartidas, now ?? 0);
  // Ajuste de estado durante el render (el patrón de React para estado
  // derivado de props): `actualizarOrden` devuelve el mismo objeto si no hay
  // cambios, así que esto no hace bucle.
  if (ordenNuevo !== orden) setOrden(ordenNuevo);
  const compartidos = ordenados(ordenNuevo);

  /**
   * ⚠️ SACAR AL OTRO CUANDO LA SESIÓN SE CIERRA.
   *
   * Hasta hoy «Marcar completada» cerraba la sesión y sacaba solo a quien
   * pulsaba —el tutor—; el alumno se quedaba dentro de la videollamada, en una
   * clase que para la base ya había terminado. El cliente pidió las dos cosas:
   * que se le saque y que se le bloquee el acceso.
   *
   * El bloqueo es de servidor y ya está puesto: `join_session` vuelve a
   * rechazar `completed`/`no_show` (`20260828120000`). Esto es la otra mitad —
   * enterarse—, y va por Realtime sobre la fila de `sessions` y no por un
   * mensaje de Daily por un motivo concreto: el tutor puede cerrar la sesión
   * **desde fuera de la sala**, en `/tutor/reservas/<id>`
   * (`CompleteSessionButton`), y desde ahí no hay llamada por la que mandarle
   * nada a nadie. La fila cambia en los dos caminos.
   *
   * Mismo patrón que el canal de `chat-thread.tsx`, incluido el `setAuth`: para
   * tablas con RLS hay que autenticar el websocket con el JWT o los cambios no
   * llegan. La RLS de `sessions_select_participant` ya limita cada fila a su
   * alumno y su tutor; el filtro solo la estrecha a ésta.
   *
   * Vale para los dos roles a propósito: si el cron cierra la sesión mientras
   * el tutor sigue dentro, también se le lleva a su detalle. Al que acaba de
   * pulsar «Marcar completada» no le afecta — ya va de camino y `saliendo` está
   * echado.
   */
  useEffect(() => {
    // M29 · la sesión que lleva la tutora de una grupal es la de UN alumno
    // (no tiene propia): su baja o su cierre no deben sacarla de la sala. A la
    // fecha la cierra la ventana de Daily (`eject_at_room_exp`).
    if (!joined || (grupal && isTutor)) return;

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelado = false;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelado) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`sesion:${sessionId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "sessions",
            filter: `id=eq.${sessionId}`,
          },
          (payload) => {
            const fila = payload.new as {
              status?: SessionStatus;
              end_at?: string;
              access_closes_at?: string | null;
              extended_at?: string | null;
            };
            // EY-232 · el tutor extendió la clase: nuevo fin para los dos.
            if (fila.end_at) setEndAt(fila.end_at);
            if (fila.access_closes_at) setClosesAt(fila.access_closes_at);
            if (fila.extended_at) setExtendida(true);
            const estado = fila.status;
            // `in_progress` también llega por aquí (lo pone `join_session`) y
            // no es un cierre: solo cuentan los tres estados que cierran la
            // puerta, los mismos que rechaza la RPC.
            if (
              estado !== "completed" &&
              estado !== "no_show" &&
              estado !== "cancelled"
            ) {
              return;
            }
            if (saliendo.current) return;
            toast(
              // P43 · una grupal no se «marca como completada»: termina.
              estado === "cancelled"
                ? grupal
                  ? "Tu cupo en esta clase se canceló."
                  : "La sesión se canceló."
                : grupal
                  ? "La clase terminó."
                  : "La mentoría se marcó como completada.",
            );
            // Colgar antes de navegar: el desmontaje ya llama a `destroy()`,
            // pero eso ocurre después del render y deja la cámara encendida
            // ese rato. `void` porque devuelve promesa y no hay nada que
            // esperar — la navegación no depende de que Daily termine.
            void callRef.current?.leave();
            salirDeLaSala();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelado = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [joined, sessionId, salirDeLaSala, grupal, isTutor]);

  async function join() {
    previaRef.current = previa;
    setBusy(true);
    // El endpoint autoriza vía `join_session` (ventana, participante, ciclo) y
    // firma el token contra Daily con la API key (server-only).
    const res = await fetch(endpointSala, { method: "POST" });
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
    // EY-221 · sin Daily, el canal de la sala va entre pestañas del navegador
    // (prueba local de la sincronización). Con Daily nace en su efecto.
    if (body.simulated && !canal) setCanal(canalSimulado(sessionId));
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
    void fetch(endpointSala, { method: "POST" });
  }, [joined, now, liveOpens, liveCloses, endpointSala]);

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
    // La confirmación es la del botón, en línea («¿Cerrar la sala para los
    // dos?», laboratorio de Emilio): un `window.confirm` no se ve en pantalla
    // completa y saca a todo el mundo del vídeo.
    setConfirmando(false);
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("complete_session", { p_session_id: sessionId });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo completar la sesión.");
      return;
    }
    // Antes: `setJoined(null)` + `router.refresh()`, que dejaba al tutor en la
    // antesala de la sala —con el aviso de grabación y el botón de volver a
    // entrar— de una clase que él mismo acababa de cerrar. Ahora sale al
    // detalle, igual que por cualquier otra puerta.
    //
    // Al ALUMNO lo saca el canal de Realtime de arriba: este `complete_session`
    // escribe la fila de `sessions` y su navegador la está mirando.
    toast.success("Sesión completada.");
    void callRef.current?.leave();
    salirDeLaSala();
  }

  // ── Estado en vivo (unido) ────────────────────────────────────────────────
  if (live && joined && now !== null) {
    const presentando = pres.estado !== null;
    // Compartir pantalla no existe en los navegadores móviles: ahí el botón
    // «Compartir» solo ofrece documentos (o no sale, para el alumno).
    // M5 · en una grupal, el alumno solo si el tutor se lo concedió.
    const puedeCompartirPantalla =
      !joined.simulated &&
      typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
      (!grupal || isTutor || Boolean(yo?.puedePantalla));
    const miMicro = joined.simulated ? !muted : (yo?.micro ?? false);
    const miCamara = joined.simulated ? !camOff : (yo?.camara ?? false);
    // B8 · en grupo, a la tutora le avisa la PRIMERA mano de su cola (con su
    // nombre); el alumno no ve manos ajenas. Fuera de grupal, como siempre.
    const colaManos = grupal && isTutor ? mano.cola : [];
    const manoAjena = grupal ? colaManos.length > 0 : mano.delOtro;
    const quienMano = grupal
      ? (colaManos[0]?.nombre ?? "Un alumno")
      : isTutor
        ? "El alumno"
        : "El tutor";
    const pendientesMano = colaManos.length > 1 ? colaManos.length - 1 : undefined;
    const bajarManoAjena = grupal
      ? () => {
          if (colaManos[0]) mano.bajar(colaManos[0].id);
        }
      : mano.bajarLaDelOtro;
    // La tutora de una grupal no levanta la mano: sin botón.
    const miManoDisponible = !(grupal && isTutor);
    // G3 · en una grupal el tutor (owner) silencia o saca a alguien (RG-12):
    // lo que antes daba la lista de participantes de Prebuilt.
    const accionesTutor =
      isTutor && grupal && call
        ? (p: (typeof participantes)[number]) =>
            p.local
              ? undefined
              : {
                  silenciar: () => call.updateParticipant(p.id, { setAudio: false }),
                  // M2 · primero se PERSISTE la expulsión de esta fecha
                  // (`join_group_class` la rechaza luego) y solo entonces se
                  // expulsa: si la RPC falla, no se saca a medias. `userId`
                  // es el `auth.uid()` que firmó su token.
                  sacar: async (motivo: string | null) => {
                    if (!p.userId) {
                      toast.error("No se pudo sacar al alumno.");
                      return;
                    }
                    const { error } = await createClient().rpc("expulsar_de_clase_grupal", {
                      p_group_class: grupal.groupClassId,
                      p_student: p.userId,
                      p_motivo: motivo ?? undefined,
                    });
                    if (error) {
                      toast.error(error.message || "No se pudo sacar al alumno.");
                      return;
                    }
                    // Todas sus conexiones (la sala admite cupo + 4 justo
                    // para la segunda pestaña), no solo la tesela pulsada.
                    const suyas = Object.values(call.participants()).filter(
                      (x) => !x.local && x.user_id === p.userId,
                    );
                    if (suyas.length === 0) call.updateParticipant(p.id, { eject: true });
                    for (const x of suyas) call.updateParticipant(x.session_id, { eject: true });
                  },
                  // M5 · conceder o quitar la pantalla (el token del alumno
                  // nace sin `screenVideo`, ver `api/room/grupal`).
                  pantalla: {
                    permitida: p.puedePantalla,
                    alternar: () =>
                      call.updateParticipant(p.id, {
                        updatePermissions: {
                          canSend: p.puedePantalla
                            ? ["video", "audio"]
                            : ["video", "audio", "screenVideo", "screenAudio"],
                        },
                      }),
                  },
                }
        : undefined;
    const tarjetaDoc = pres.estado
      ? { nombre: pres.estado.nombre, pagina: pres.estado.pagina }
      : null;
    // 1:1 · la tesela del otro está aunque no haya llegado (laboratorio).
    const ausente =
      grupal || remoto.presente
        ? null
        : remoto.seFue
          ? `${isTutor ? "El alumno" : "El tutor"} se fue de la sala`
          : `Esperando ${isTutor ? "al alumno" : "al tutor"}…`;

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
            con la cabecera y hace de borde superior del área de vídeo.

            Micro, cámara, compartir, mano, chat, dispositivos y «Salir» viven
            en la barra de controles, abajo (`BarraControles`). */}
        <header className="flex shrink-0 items-center gap-4 border-b bg-background px-3 py-2 text-foreground sm:px-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-bold">{productTitle}</h1>
            {/* V-2 · vuelve a su `text-muted-foreground` de siempre: llevaba
                el gris claro de la sala porque el fondo era #14141a, y ahora es
                blanco. Sobre blanco, ese gris no se lee. */}
            <SessionRef nro={sessionRef} />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {/* Corrección 1 · AQUÍ VIVÍA «Mostrar chat». Existía porque la barra
                de Daily vivía dentro de su iframe —sin teclado ni lector de
                pantalla— y aparecía y desaparecía con el ratón. La barra de
                controles ya es nuestra y fija: su botón de chat lleva el
                contador de no leídos y es alcanzable, así que este sobraba. */}

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
                grupal={Boolean(grupal)}
                trigger={
                  <button
                    type="button"
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

            {/* EY-221 · AQUÍ VIVÍA EL CRONÓMETRO («12:34 / 60:00» + «Termina
                en…»). Bajó a `ContadorClase`, superpuesto sobre el vídeo: así
                lo ven los dos sin levantar la vista, sigue visible en pantalla
                completa (donde esta cabecera no está) y avisa a 5 minutos. */}

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
            {/* G3 · una fecha grupal la cierra el cron, no el tutor: su
                `complete_session` es por sesión y cerraría solo la de un alumno. */}
            {isTutor &&
            !grupal &&
            (sessionStatus === "scheduled" || sessionStatus === "in_progress") &&
            now >= liveOpens &&
            now <= liveCloses ? (
              confirmando ? (
                <div
                  role="alertdialog"
                  aria-label="Confirmar el cierre de la sesión"
                  className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs"
                >
                  <span>¿Cerrar la sala para los dos?</span>
                  <Button size="sm" disabled={busy} onClick={complete}>
                    Completar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmando(false)}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button size="sm" disabled={busy} onClick={() => setConfirmando(true)}>
                  Marcar completada
                </Button>
              )
            ) : null}
          </div>
        </header>

        {/* EY-221 · EL contenedor que va a pantalla completa (`salaRef`):
            escenario, chat Y barra de controles. Lleva fondo propio porque en
            pantalla completa no hay nada detrás.

            Corrección 7 · la barra va FUERA de la fila escenario + chat, a
            todo el ancho y siempre abajo; lo compartido se adapta al espacio
            que queda encima. */}
        <div
          ref={salaRef}
          className="relative flex min-h-0 flex-1 flex-col bg-[color:var(--sala-bg)]"
        >
        {/* Escenario + chat. `relative` porque en móvil el panel se SUPERPONE a
            esta zona (ver el `aside`), no se pone al lado: a 375px dos
            columnas no caben, y partir el alto dejaría el vídeo en un sello.
            P49 · desde `md` (tableta) ya va al lado. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col bg-[color:var(--sala-video)]">
            <div className="relative min-h-0 flex-1">
              <EscenarioSala
                participantes={participantes}
                compartidos={compartidos}
                // M30 · solo el visor principal publica el documento como pista
                // (`call`); el mini de la franja, no.
                documento={
                  <VisorPresentacion pres={pres} sessionId={sessionId} isTutor={isTutor} call={call} />
                }
                tarjetaDoc={tarjetaDoc}
                ausente={ausente}
                acciones={accionesTutor}
                // Con algo compartido, pantalla completa va aquí y no en la barra.
                pantallaCompleta={
                  pantalla.soportada
                    ? { activa: pantalla.activa, alternar: () => void pantalla.alternar() }
                    : undefined
                }
                vacio={
                  joined.simulated ? (
                    // Sin credenciales de Daily: la sala, el token y la ventana
                    // ya funcionan; falta solo el transporte de video.
                    <div className="flex size-full items-center justify-center text-[color:var(--sala-supportive)]">
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
                    <div className="flex size-full items-center justify-center text-sm text-[color:var(--sala-supportive)]">
                      Conectando con la sala…
                    </div>
                  )
                }
              />
            </div>

            {/* Corrección 6 · el reloj, flotando arriba a la izquierda.
                P18 · y el aviso de la mano en el MISMO contenedor, detrás de
                él: antes iba centrado y suelto (`absolute left-1/2`) y en
                móvil tapaba el contador. Ahora en ancho queda al lado y en
                móvil baja debajo (`flex-wrap`). */}
            <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start gap-2">
              <ContadorClase
                sustantivo={sustantivo}
                now={now}
                startAt={startAt}
                endAt={endAt}
                closesAt={closesAt}
                extendida={extendida}
                extender={
                  // G3 · una grupal no se extiende (`extend_session` lo rechaza).
                  isTutor && !extendida && !grupal
                    ? {
                        sessionId,
                        onExtendida: (e, c) => {
                          setEndAt(e);
                          setClosesAt(c);
                          setExtendida(true);
                        },
                      }
                    : undefined
                }
              />
              {/* EY-221 · «levantó la mano», bien visible y dentro del contenedor
                  de pantalla completa (el toast, que va al `body`, ahí no se ve). */}
              {manoAjena ? (
                <AvisoMano
                  className="pointer-events-auto max-w-full"
                  quien={quienMano}
                  pendientes={pendientesMano}
                  onBajar={bajarManoAjena}
                />
              ) : null}
            </div>

            {isTutor && panelMateriales ? (
              <PanelMateriales
                sessionId={sessionId}
                docActual={pres.estado?.docId ?? null}
                onCerrar={() => setPanelMateriales(false)}
                sustantivo={sustantivo}
                onElegir={(m) => {
                  pres.presentar(m.id, m.nombre);
                  setPanelMateriales(false);
                }}
              />
            ) : null}

            {flotante.contenedor ? (
              <VentanaFlotante
                contenedor={flotante.contenedor}
                escenario={
                  <EscenarioSala
                    compacto
                    participantes={participantes}
                    compartidos={compartidos}
                    // En la flotante el documento principal va entero (sin
                    // controles), no como tarjeta.
                    documento={
                      <VisorPresentacion pres={pres} sessionId={sessionId} isTutor={isTutor} mini />
                    }
                    tarjetaDoc={tarjetaDoc}
                    ausente={ausente}
                  />
                }
                now={now}
                startAt={startAt}
                endAt={endAt}
                closesAt={closesAt}
                extendida={extendida}
                manoDelOtro={manoAjena}
                quienMano={quienMano}
                pendientes={pendientesMano}
                miMano={mano.mia}
                onBajarManoDelOtro={bajarManoAjena}
                onAlternarMiMano={miManoDisponible ? mano.alternar : undefined}
                micro={
                  call ? { activo: miMicro, alternar: () => call.setLocalAudio(!miMicro) } : null
                }
                onVolver={() => {
                  window.focus();
                  flotante.cerrar();
                }}
              />
            ) : null}
          </div>

          {/* El hilo es el MISMO de EP-17 (`/chat/<reserva>`), no una copia:
              mismos mensajes, misma RLS, mismo Realtime.

              ⚠️ Se monta SIEMPRE y se esconde con `hidden`, en vez de sacarlo
              del árbol cuando está cerrado. Desmontarlo cerraría el canal de
              Realtime del hilo: quien pliegue el chat para ver el vídeo grande
              se perdería los mensajes de ese rato. Es además el comportamiento
              que ya tenía la sala, donde el panel estaba siempre montado.

              Móvil: `absolute inset-0` sobre la zona de vídeo. Desde `md:`
              vuelve al flujo como columna a la derecha (300px; 360px desde
              `lg:`), que es el "chat incrustado a la derecha" que pidió el
              cliente. P49 · antes eso era solo desde `lg:`, y en una tableta
              el chat tapaba entero el vídeo. El escenario se estrecha solo: la
              franja la decide su container query, no la pantalla. */}
          <aside
            id="panel-chat-sala"
            aria-label={`Chat de la ${sustantivo}`}
            className={
              chatAbierto
                ? "absolute inset-0 z-20 flex flex-col border-[color:var(--sala-border)] bg-[color:var(--sala-bg)] md:relative md:inset-auto md:z-auto md:w-[300px] md:shrink-0 md:border-l lg:w-[360px]"
                : "hidden"
            }
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[color:var(--sala-border)] px-4 py-3">
              <h2 className="font-semibold">Chat</h2>
              <div className="flex items-center gap-2">
                {/* El aspa es el gesto esperado para cerrar un panel; el botón
                    de chat de la barra hace lo mismo. */}
                <button
                  type="button"
                  onClick={() => {
                    plegarChat();
                    // El `aside` pasa a `display:none` con el foco DENTRO: sin
                    // esto el navegador lo devuelve al `body` y quien navega con
                    // teclado tiene que tabular desde el principio de la página.
                    document.getElementById("boton-chat-sala")?.focus();
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
              {grupal && (grupal.chatNoDisponible || !grupal.chatConversationId) ? (
                // P45 · sin hilo no se monta el chat: se quedaría en «Abriendo
                // la conversación…» sin salir nunca de ahí.
                <p className="py-6 text-center text-[13px] text-muted-foreground">
                  El chat no está disponible.
                </p>
              ) : (
              <ChatThread
                formato={formato}
                timeZone={timeZone}
                fill
                // El aviso de retención ocupa media columna en un panel de
                // 360px y ya se lee entero en la ficha de la reserva.
                sinAvisoDeRetencion
                {...(grupal
                  ? { conversationId: grupal.chatConversationId ?? undefined, grupal: grupal.chat }
                  : { bookingId })}
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
              )}
            </div>
          </aside>
        </div>

        <BarraControles
          grabando={grabando}
          micro={{
            activo: miMicro,
            alternar: joined.simulated
              ? () => setMuted((m) => !m)
              : () => call?.setLocalAudio(!miMicro),
          }}
          camara={{
            activo: miCamara,
            alternar: joined.simulated
              ? () => setCamOff((c) => !c)
              : () => call?.setLocalVideo(!miCamara),
          }}
          compartir={{
            pantalla: puedeCompartirPantalla
              ? {
                  activa: Boolean(yo?.pantalla),
                  alternar: () =>
                    yo?.pantalla
                      ? call?.stopScreenShare()
                      : call?.startScreenShare({
                          // Sin la propia pestaña de la sala en la lista: compartirla
                          // es un espejo infinito.
                          displayMediaOptions: {
                            selfBrowserSurface: "exclude",
                            surfaceSwitching: "include",
                          },
                        }),
                }
              : undefined,
            documentos: isTutor
              ? {
                  presentando,
                  elegir: () => setPanelMateriales(true),
                  dejar: pres.dejarDePresentar,
                }
              : undefined,
          }}
          mano={miManoDisponible ? { arriba: mano.mia, alternar: mano.alternar } : undefined}
          chat={{ abierto: chatAbierto, sinLeer, alternar: alternarChat }}
          pantalla={{
            soportada: pantalla.soportada,
            activa: pantalla.activa,
            alternar: () => void pantalla.alternar(),
            // Lo mismo que decide `EscenarioSala`: con algo compartido el
            // botón vive sobre el escenario.
            enEscenario: compartidos.length > 0,
          }}
          call={call}
          sustantivo={sustantivo}
          // M5 · el tutor de una grupal silencia a todos de un golpe (`*` no
          // incluye al local). Con ella su botón de micro despliega «Yo» /
          // «Sala» en vez de haber dos botones de silenciar.
          silenciarTodos={
            isTutor && grupal && call
              ? () => call.updateParticipants({ "*": { setAudio: false } })
              : undefined
          }
          onSalir={() => {
            // Con Daily, `leave()` dispara `left-meeting`, que es quien sale.
            if (call && !joined.simulated) void call.leave();
            else salirDeLaSala();
          }}
        />
        <AudiosRemotos lista={participantes} />
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
          <p className="text-sm text-muted-foreground">{grupal ? "Clase grupal" : "Mentoría"}</p>
          <h1 className="text-xl font-semibold">{productTitle}</h1>
          {/* También antes de entrar y después de salir: la consulta a soporte
              suele ser justo cuando la sala NO deja pasar. */}
          <SessionRef nro={sessionRef} />
          {/* Regla de oro 13: de (room) a una ruta con guarda de (app), <a> y no <Link>. */}
          <a
            href={volver.href}
            className="mt-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            {volver.label}
          </a>
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
        ) : !bookingAllowsRoom || sessionCancelled || sessionEnded ? (
          /*
           * ⚠️ `sessionEnded` ENTRA AQUÍ, y es marcha atrás sobre MN-05.
           *
           * Con la sala de 7 días, una sesión `completed` seguía teniendo sala
           * y esta pantalla lo contaba («ya terminó, pero su sala sigue abierta
           * X más»). Con la ventana de B-2 (10 min) el cierre del cron cae justo
           * cuando la ventana expira, así que el único cierre que ocurre con la
           * sala abierta es el anticipado del tutor — y el cliente pidió que ése
           * bloquee el acceso. `join_session` ya lo rechaza
           * (`20260828120000`); si esta rama no lo recogiera, el botón seguiría
           * ofreciéndose para que el servidor dijera que no.
           */
          <>
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {sessionCancelled
                ? "Esta sesión se canceló, así que su sala no se abre."
                : sessionEnded
                  ? `Esta ${sustantivo} ya se dio por terminada, así que su sala está cerrada.`
                  : "Esta reserva no está activa, así que la sala no está disponible."}
            </p>
            <Button asChild variant="outline">
              <a href={volver.href}>{volver.label}</a>
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
                {`La sala abre 10 minutos antes de la ${sustantivo} y sigue abierta 10 minutos después.`}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {new Date(startAt).toLocaleString("es", {
                timeZone,
                dateStyle: "full",
                timeStyle: "short",
                ...opcionesDeHora(formato),
              })}
            </p>
            {/* Solo en esta rama: quien llega con la sala ya abierta viene a
                entrar, y apuntar en la agenda una clase que empieza en diez
                minutos no le sirve de nada. Sin props nuevas — `sessionId`,
                `productTitle`, `startAt` y `endAt` ya estaban aquí. */}
            <AddToCalendar
              sessionId={sessionId}
              titulo={productTitle}
              inicio={startAt}
              fin={endAt}
            />
            {/* El «Entiendo» se puede marcar mientras esperas: lo que se pide
                es que esté leído ANTES de entrar, no que la sala ya abra. */}
            <RecordingConsent
              sessionId={sessionId}
              userId={currentUserId}
              marcado={entendido}
              onChange={setEntendido}
              grupal={Boolean(grupal)}
              sustantivo={sustantivo}
            />
          </>
        ) : afterWindow ? (
          <>
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              La ventana de acceso de esta sesión ya cerró.
            </p>
            <Button asChild variant="outline">
              <a href={volver.href}>{volver.label}</a>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" suppressHydrationWarning>
              {/* La rama de «la sesión ya se cerró» se fue arriba, con las
                  canceladas: desde `20260828120000` una sesión cerrada no tiene
                  sala, así que aquí ya solo se llega con clase viva. */}
              {`La sala está abierta. Cierra en ${human(closes - now)}.`}
            </p>
            {/* M5 · en una grupal, la vista previa: te ves y eliges con qué
                entras. Se desmonta al entrar (cambia la rama) y suelta la
                cámara antes del `join` de Daily. */}
            {grupal ? (
              <VistaPrevia
                micro={previa.micro}
                camara={previa.camara}
                onCambio={(micro, camara) => setPrevia({ micro, camara })}
              />
            ) : null}
            {/* El aviso se lee ANTES de entrar, no a mitad de clase. */}
            <RecordingConsent
              sessionId={sessionId}
              userId={currentUserId}
              marcado={entendido}
              onChange={setEntendido}
              grupal={Boolean(grupal)}
              sustantivo={sustantivo}
            />
            {/* ⚠️ `!entendido` deshabilita: la casilla es obligatoria desde que
                el aviso dejó de ser un permiso y pasó a ser un «Entiendo» de
                términos. El porqué se explica junto a la casilla, no aquí: un
                botón deshabilitado no puede contar por qué lo está. */}
            <Button
              size="lg"
              disabled={busy || !entendido}
              onClick={join}
              className="min-w-40"
            >
              {busy ? "Entrando…" : "Entrar a la sala"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
