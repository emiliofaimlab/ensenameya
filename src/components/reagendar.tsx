"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { formatSessionTime } from "@/lib/booking";
import type { FormatoHora } from "@/lib/hora";
import { Button } from "@/components/ui/button";

type Papel = "student" | "tutor";

export type ReagendaPendiente = {
  id: string;
  new_start_at: string;
  proposed_by: string;
};

/** Cuántos días hacia delante se ofrecen huecos para la hora nueva. */
const DIAS = 60;

/**
 * §14 de los Términos · reagendar una sesión, para el alumno y para el tutor
 * (misma pieza en `/reservas/[id]` y `/tutor/reservas/[id]`). Las reglas —24 h,
 * hueco disponible, quién responde— las pone `proponer_reagenda` /
 * `responder_reagenda` (`20260925120000`); aquí solo se decide qué enseñar, y
 * los errores de la BD se muestran tal cual porque ya vienen en español.
 */
export function Reagendar({
  sessionId,
  productId,
  soy,
  puedeProponer,
  pendiente,
  tz,
  formato,
}: {
  sessionId: string;
  productId: string;
  soy: Papel;
  /** Sesión agendada, reserva viva y más de 24 h por delante. */
  puedeProponer: boolean;
  pendiente: ReagendaPendiente | null;
  tz: string;
  formato: FormatoHora;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [huecos, setHuecos] = useState<string[] | null>(null);
  const [elegido, setElegido] = useState("");

  const hora = (iso: string) => formatSessionTime(iso, tz, formato);
  const delOtro = pendiente && pendiente.proposed_by !== soy;

  async function llamar(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo completar.");
      return;
    }
    toast.success(ok);
    setHuecos(null);
    router.refresh();
  }

  async function abrir() {
    setBusy(true);
    const hasta = new Date(Date.now() + DIAS * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await createClient().rpc("get_available_slots", {
      p_product_id: productId,
      p_to: hasta,
    });
    setBusy(false);
    if (error) {
      toast.error("No se pudieron cargar los horarios.");
      return;
    }
    const lista = (data ?? []).map((h) => h.slot_start);
    setHuecos(lista);
    setElegido(lista[0] ?? "");
  }

  if (delOtro) {
    return (
      <div className="basis-full rounded-[10px] border border-[#cfe3ff] bg-[#f0f7ff] p-3 text-[13px] text-[#19191f]">
        <p>
          {soy === "tutor" ? "El alumno" : "El tutor"} propone moverla al{" "}
          <strong className="first-letter:uppercase">{hora(pendiente.new_start_at)}</strong>.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            className="h-9 rounded-[8px] px-4 text-[13px] font-semibold"
            disabled={busy}
            onClick={() =>
              llamar(
                () => createClient().rpc("responder_reagenda", { p_id: pendiente.id, p_acepta: true }),
                "Listo: la sesión cambió de hora.",
              )
            }
          >
            Aceptar
          </Button>
          <Button
            variant="outline"
            className="h-9 rounded-[8px] px-4 text-[13px]"
            disabled={busy}
            onClick={() =>
              llamar(
                () => createClient().rpc("responder_reagenda", { p_id: pendiente.id, p_acepta: false }),
                "Rechazaste el cambio. La sesión sigue en su hora.",
              )
            }
          >
            Rechazar
          </Button>
        </div>
      </div>
    );
  }

  if (!puedeProponer && !pendiente) return null;

  return (
    <div className="basis-full text-[13px]">
      {pendiente ? (
        <p className="text-[#6b6b6b]">
          Propusiste moverla al{" "}
          <span className="font-medium text-[#19191f]">{hora(pendiente.new_start_at)}</span>.
          Esperando respuesta.
        </p>
      ) : null}

      {!puedeProponer ? null : huecos === null ? (
        <Button
          variant="outline"
          className="mt-2 h-9 rounded-[8px] px-4 text-[13px]"
          disabled={busy}
          onClick={abrir}
        >
          {pendiente ? "Proponer otra hora" : "Reagendar"}
        </Button>
      ) : huecos.length === 0 ? (
        <p className="mt-2 text-[#6b6b6b]">
          No hay horarios libres en los próximos {DIAS} días. Escríbanse por el chat.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`reagendar-${sessionId}`}>
            Nueva hora
          </label>
          <select
            id={`reagendar-${sessionId}`}
            value={elegido}
            onChange={(e) => setElegido(e.target.value)}
            className="h-9 w-full rounded-[8px] border border-[#e0e0e0] bg-muted px-2.5 text-[13px]"
          >
            {huecos.map((h) => (
              <option key={h} value={h}>
                {hora(h)}
              </option>
            ))}
          </select>
          <Button
            className="h-9 rounded-[8px] px-4 text-[13px] font-semibold"
            disabled={busy || !elegido}
            onClick={() =>
              llamar(
                () =>
                  createClient().rpc("proponer_reagenda", {
                    p_session_id: sessionId,
                    p_new_start: elegido,
                  }),
                "Propuesta enviada. Te avisaremos cuando respondan.",
              )
            }
          >
            Proponer
          </Button>
          <Button
            variant="ghost"
            className="h-9 rounded-[8px] px-3 text-[13px]"
            disabled={busy}
            onClick={() => setHuecos(null)}
          >
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}
