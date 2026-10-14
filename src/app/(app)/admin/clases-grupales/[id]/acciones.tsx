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

/** G4 · saca a UN alumno con el 100 % (`admin_sacar_de_clase_grupal`). */
export function SacarAlumno({ bookingId, nombre }: { bookingId: string; nombre: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function sacar() {
    const motivo = window.prompt(
      `Se cancela el cupo de ${nombre} con el 100 % de reembolso. Motivo para el alumno:`,
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
    toast.success("Cupo cancelado con el 100 %.");
    router.refresh();
  }
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={sacar}>
      Sacar
    </Button>
  );
}
