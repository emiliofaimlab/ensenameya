"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** RG-10 · el admin cancela la clase entera: 100 % a todos (`cancelar_clase_grupal`). */
export function CancelarClaseAdmin({ productId, inscritos }: { productId: string; inscritos: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function cancelar() {
    const motivo = window.prompt(
      `Se cancela la clase entera y se devuelve el 100 % a ${inscritos} inscrito(s). Motivo para los alumnos:`,
    );
    if (motivo === null) return;
    setBusy(true);
    const { error } = await createClient().rpc("cancelar_clase_grupal", {
      p_product: productId,
      p_motivo: motivo,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo cancelar la clase.");
      return;
    }
    toast.success("Clase cancelada. Los reembolsos quedaron en cola.");
    router.refresh();
  }
  return (
    <Button variant="outline" className="text-[#bf3333]" disabled={busy} onClick={cancelar}>
      Cancelar la clase entera
    </Button>
  );
}

/**
 * G4 · saca a UN alumno (`admin_sacar_de_clase_grupal`). M1: antes de que
 * empiece el ciclo, el 100 %; con el ciclo empezado, solo la parte de las
 * fechas que faltan, y la reserva se completa en vez de cancelarse (el tutor
 * cobra lo que sí dio). `empezada` solo cambia el texto: decide la BD.
 */
export function SacarAlumno({
  bookingId,
  nombre,
  empezada,
}: {
  bookingId: string;
  nombre: string;
  empezada: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function sacar() {
    const motivo = window.prompt(
      empezada
        ? `El ciclo ya empezó: ${nombre} deja de estar en las fechas que faltan y recupera solo lo que costaban esas fechas. Motivo para el alumno:`
        : `Se cancela el cupo de ${nombre} con el 100 % de reembolso. Motivo para el alumno:`,
    );
    if (motivo === null) return;
    setBusy(true);
    const { error } = await createClient().rpc("admin_sacar_de_clase_grupal", {
      p_booking: bookingId,
      p_motivo: motivo,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo sacar al alumno.");
      return;
    }
    toast.success(
      empezada
        ? "Alumno fuera de las fechas que faltan. Su reembolso quedó en cola."
        : "Cupo cancelado con el 100 %.",
    );
    router.refresh();
  }
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={sacar}>
      Sacar
    </Button>
  );
}

/**
 * A10 · el admin cancela UNA fecha (`cancelar_fecha_grupal`, que le deja pasar
 * por `has_role('admin')`): cada inscrito recupera lo que costaba esa fecha. Si
 * es la única que queda de una clase sin empezar, la RPC cancela la clase
 * entera con el 100 %.
 */
export function CancelarFechaAdmin({ groupClassId, inscritos }: { groupClassId: string; inscritos: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function cancelar() {
    const motivo = window.prompt(
      `Se cancela esta fecha y cada uno de los ${inscritos} inscrito(s) recupera lo que costaba. Motivo para los alumnos:`,
    );
    if (motivo === null) return;
    setBusy(true);
    const { error } = await createClient().rpc("cancelar_fecha_grupal", {
      p_group_class: groupClassId,
      p_motivo: motivo,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo cancelar la fecha.");
      return;
    }
    toast.success("Fecha cancelada. Los reembolsos quedaron en cola.");
    router.refresh();
  }
  return (
    <Button size="sm" variant="outline" className="text-[#bf3333]" disabled={busy} onClick={cancelar}>
      Cancelar fecha
    </Button>
  );
}
