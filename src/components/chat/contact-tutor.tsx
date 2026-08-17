"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageCircleIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { SignupDialog } from "@/components/auth/signup-dialog";
import { asRpc } from "./rpc";

/**
 * M-12 · «Escribir al tutor» desde su ficha pública.
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // El nombre de pila basta y cabe mejor. Si viene vacío, "al tutor".
  const nombreCorto = tutorName.trim().split(/\s+/)[0] || "al tutor";

  if (anonimo) {
    return (
      <SignupDialog
        titulo="Crea tu cuenta para escribirle"
        descripcion={`Pregúntale a ${nombreCorto} lo que necesites antes de reservar`}
      >
        <Button variant="outline" className="gap-2">
          <MessageCircleIcon className="size-4" />
          Escribir a {nombreCorto}
        </Button>
      </SignupDialog>
    );
  }

  async function escribir() {
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
    router.push(`/chat/${data}`);
  }

  return (
    <Button
      variant="outline"
      className="gap-2"
      disabled={busy}
      onClick={() => void escribir()}
    >
      <MessageCircleIcon className="size-4" />
      {busy ? "Abriendo…" : `Escribir a ${nombreCorto}`}
    </Button>
  );
}
