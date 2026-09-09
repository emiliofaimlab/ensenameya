"use client";

import { useState } from "react";
import { toast } from "sonner";
import { MessageCircleIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { SignupDialog } from "@/components/auth/signup-dialog";
import { pedirAbrirHilo } from "./open-thread";
import { asRpc } from "./rpc";

/**
 * M-12 · «Escribir al tutor» desde su ficha pública.
 *
 * ⚠️ EY-194 · ESTE FICHERO ESTUVO BORRADO SEIS DÍAS. Lo retiró MN-06 (`b786e38`,
 * 20-ago) cuando el cliente contestó a P-1 que el chat solo existía tras
 * reservar; vuelve tal cual del histórico porque el 26-ago pidió lo contrario:
 * consultas privadas y directas antes de comprar. No se ha reescrito nada — es
 * el mismo componente, y la puerta que lo desactivaba estaba en la base de datos
 * (`pair_can_chat`), no aquí.
 *
 * Es la entrada del carril: hasta hoy, para preguntarle algo a un tutor había
 * que comprarle primero (el chat vivía dentro de una reserva pagada y encima se
 * abría dos días antes de la clase). Preguntar "¿esto cubre lo que necesito?"
 * es parte de decidir la compra, no una consecuencia de haberla hecho.
 *
 * ── SIN SESIÓN, EL DESTINO ES CREAR CUENTA ──────────────────────────────────
 * Y en modal, no en `/signup`: desde M-05 el alta se abre SOBRE la página en la
 * que estás ("regístrate y seguimos"). Mandar a `/signup` a quien está mirando
 * un perfil y volverlo a soltar en la portada es perder el hilo por el camino.
 * El `SignupDialog` guarda solo la ruta actual en su `?next=`, así que al
 * terminar el alta se vuelve aquí y el botón ya funciona.
 *
 * No se intenta "abrir la conversación y luego pedir cuenta": la conversación
 * necesita un alumno con id, y fingir que se puede escribir antes de tenerlo
 * solo sirve para perder lo escrito.
 *
 * ── CON SESIÓN, EL DESTINO YA NO ES UNA PÁGINA (27-ago) ─────────────────────
 * Hasta hoy esto hacía `router.push('/chat/<id>')` y **te sacaba de la ficha
 * del tutor**: quien estaba comparando precio, horarios y reseñas perdía de
 * vista todo eso justo en el momento de preguntar, y volver era el botón atrás.
 * Es exactamente lo que el cliente pidió quitar («no debe abrir una página
 * nueva, que abra directo en la burbuja de chat»). Ahora se le pide a la burbuja
 * —que en `(public)` ya está montada, ver `ChatLauncher`— que se abra en ese
 * hilo, y la ficha se queda debajo, intacta.
 *
 * ⚠️ La conversación que devuelve `open_conversation` desde aquí puede ser **un
 * hilo sin mensajes y sin reserva**, y ese es justo el que `ChatLauncher` filtra
 * fuera de la bandeja (`lastMessageAt !== null || hasBooking`). O sea: la
 * burbuja tiene que saber abrir un hilo que NO está en su lista. Eso es trabajo
 * de la burbuja, no de aquí, pero si algún día «Escribir a X» deja de abrir
 * nada, ese filtro es el primer sitio donde mirar.
 *
 * ── POR QUÉ SE RECUERDA EL ID EN VEZ DE VOLVER A PREGUNTAR ──────────────────
 * Sin navegación, el botón se queda donde está y se puede volver a pulsar. La
 * duda razonable es si cada intento gasta uno de los 10 hilos nuevos por alumno
 * y día de `open_conversation`. **No los gasta**, y conviene dejarlo escrito
 * porque es contraintuitivo: en `20260820180000` la función devuelve el hilo
 * existente ANTES de contar los creados en 24 h, así que reintentar con el mismo
 * tutor no incrementa nada; el tope solo puede saltar la primerísima vez, y
 * entonces salta con su mensaje redactado.
 *
 * Aun así se guarda el id: el reintento es entonces **instantáneo y sin red**,
 * que es lo que hace falta cuando alguien pulsa porque "no ha pasado nada". La
 * protección de verdad sigue estando en SQL — este `useState` es comodidad, no
 * un candado, y se pierde al recargar como debe ser.
 */
export function ContactTutor({
  tutorId,
  tutorName,
  anonimo,
}: {
  tutorId: string;
  /** Solo para el texto del botón y del modal. */
  tutorName: string;
  /** Lo decide el servidor: sin sesión, el botón abre el alta. */
  anonimo: boolean;
}) {
  const [busy, setBusy] = useState(false);
  /** El hilo con este tutor, una vez que la RPC nos lo ha dicho. */
  const [conversationId, setConversationId] = useState<string | null>(null);

  // El nombre de pila basta y cabe mejor. Si viene vacío, "al tutor".
  const nombreCorto = tutorName.trim().split(/\s+/)[0] || "al tutor";

  /**
   * Verónica 3-sep (P07): en móvil el botón baja al borde izquierdo, bajo los
   * metadatos, y por debajo de sm toma la forma del botón secundario del Figma
   * P07 («Enviar mensaje», el mismo gesto dentro del panel de reserva a 390):
   * ancho completo, 52 px de alto, radio 8 y etiqueta de 15 px semibold
   * centrada (medido sobre el PNG a escala 2: caja 314x52, borde #ebebeb). Aquí
   * queda en el hero y no en el panel por EY-194 (ver cabecera): mover el botón
   * de sitio es una decisión del cliente, no de maquetación.
   *
   * Entre sm y lg (tablets, que también son táctiles) no vuelve el botón de
   * 32 px: se queda a ancho de contenido pero con 44 px de alto (`h-11`), más
   * padding y la misma etiqueta de 15 px. Desde lg es el botón de siempre (R1).
   * Las dos ramas (con y sin sesión) comparten las clases.
   *
   * El foco: el anillo del `Button` es el azul de marca al 50 %, y sobre el
   * hero azul de la ficha no se ve (1,05:1 medido). Como este botón vive
   * SIEMPRE sobre ese hero, el anillo y el borde de foco pasan al gris de
   * primer plano, que contrasta contra el azul (≥ 4,3:1) y contra el relleno
   * blanco del botón. Es solo el estado de foco: en reposo no cambia nada.
   */
  const claseMovil =
    "gap-2 max-sm:h-[52px] max-sm:w-full sm:max-lg:h-11 sm:max-lg:px-6 max-lg:text-[15px] max-lg:font-semibold focus-visible:border-foreground focus-visible:ring-foreground/60";

  if (anonimo) {
    return (
      <SignupDialog
        titulo="Crea tu cuenta para escribirle"
        descripcion={`Pregúntale a ${nombreCorto} lo que necesites antes de reservar`}
      >
        <Button variant="outline" className={claseMovil}>
          <MessageCircleIcon className="size-4" />
          Escribir a {nombreCorto}
        </Button>
      </SignupDialog>
    );
  }

  async function escribir() {
    // Ya sabemos cuál es el hilo: se vuelve a pedir la apertura y se acabó.
    if (conversationId) {
      pedirAbrirHilo({ conversationId });
      return;
    }

    setBusy(true);
    // `open_conversation` devuelve SIEMPRE la misma conversación con este tutor
    // —la crea la primera vez y la recupera las demás—, así que volver a pulsar
    // el botón meses después lleva al hilo de siempre, con lo hablado antes de
    // comprar todavía arriba. Eso es el histórico continuo.
    const { data, error } = await asRpc(createClient()).rpc(
      "open_conversation",
      { p_tutor_id: tutorId },
    );
    setBusy(false);

    if (error || typeof data !== "string") {
      // Los mensajes de la RPC vienen redactados para el usuario (el tope de
      // conversaciones nuevas por día, el tutor no disponible).
      toast.error(error?.message || "No se pudo abrir la conversación.");
      return;
    }
    setConversationId(data);
    pedirAbrirHilo({ conversationId: data });
  }

  return (
    <Button
      variant="outline"
      className={claseMovil}
      disabled={busy}
      onClick={() => void escribir()}
    >
      <MessageCircleIcon className="size-4" />
      {busy ? "Abriendo…" : `Escribir a ${nombreCorto}`}
    </Button>
  );
}
