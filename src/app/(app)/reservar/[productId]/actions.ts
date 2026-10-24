"use server";

import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export type AbrirClaseResultado =
  | { ok: true; productId: string }
  | { ok: false; mensaje: string };

/**
 * RG-01 (24-oct) · el alumno eligió un horario LIBRE de una clase grupal: nace
 * la clase (`abrir_clase_grupal`) y se va a pagarla como quien se suma a una ya
 * abierta. Si otro alumno abrió exactamente esas fechas un instante antes, la
 * RPC devuelve ESA clase y los dos terminan en la misma.
 *
 * Va con la sesión del alumno (cliente ANON + su JWT), no con `service_role`:
 * la RPC usa `auth.uid()` para el tope de clases abiertas sin pagar y para que
 * el tutor no se inscriba en la suya.
 *
 * Los mensajes salen traducidos, nunca `error.message` tal cual (mismo criterio
 * que `mensajeDeApertura` en `lib/checkout/hold.ts`).
 */
export async function abrirClaseGrupal(
  productId: string,
  slots: string[],
): Promise<AbrirClaseResultado> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("abrir_clase_grupal", {
    p_product: productId,
    p_slots: slots,
  });
  if (error || !data) {
    const m = (error?.message ?? "").toLowerCase();
    if (m.includes("acaba de ser tomado")) {
      return { ok: false, mensaje: "Ese horario acaba de ocuparse. Elige otro." };
    }
    if (m.includes("clases abiertas sin pagar")) {
      return {
        ok: false,
        mensaje: "Tienes clases abiertas sin pagar. Termina el pago de una antes de abrir otra.",
      };
    }
    if (m.includes("tu propia clase")) {
      return { ok: false, mensaje: "Es tu propia clase: no puedes inscribirte." };
    }
    if (m.includes("debes elegir")) {
      return { ok: false, mensaje: "Elige todos los horarios del ciclo antes de seguir." };
    }
    console.error("[abrirClaseGrupal]", error?.code, error?.message);
    return { ok: false, mensaje: "No se pudo abrir la clase. Vuelve a intentarlo en un momento." };
  }
  return { ok: true, productId: data };
}
