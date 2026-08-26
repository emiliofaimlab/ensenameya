"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * EY-189 · Las dos acciones de triaje, y son de naturaleza distinta.
 *
 * ── 1 · CERRAR EL REPORTE — por RLS, sin RPC ────────────────────────────────
 * `update conversation_reports set handled_at, handled_by`. No hace falta
 * función: M-12 dejó la política (`conversation_reports_update_admin`) y, sobre
 * todo, dejó el grant ACOTADO POR COLUMNAS —`grant update (handled_at,
 * handled_by) … to authenticated`— precisamente para esto. Ese grant es lo que
 * impide que un admin reescriba el `reason` de un reporte ajeno, que es la
 * garantía que hace creíble la cola. Llevaba nueve días sin nadie que lo usara.
 * Mismo criterio que `AckButton` de AD14: no se mueve dinero ni roles.
 *
 * ── 2 · BLOQUEAR EL HILO — por RPC, obligatoriamente ────────────────────────
 * `set_conversation_blocked` es SECURITY DEFINER y comprueba el rol POR DENTRO,
 * y eso no es una preferencia de estilo: `conversations` no tiene política de
 * `select` para el admin, así que un `update … where id = $1` no encontraría la
 * fila y **no fallaría — no haría nada**, que es peor. Está razonado en la
 * migración de M-12; aquí solo se respeta.
 *
 * ⚠️ Bloquear y cerrar son INDEPENDIENTES a propósito. Un reporte se puede
 * cerrar sin bloquear (no había caso) y un hilo se puede bloquear dejando el
 * reporte abierto (hace falta seguir mirando). Encadenarlos obligaría a elegir
 * un desenlace antes de haberlo decidido.
 */
export function ReportActions({
  reportId,
  conversationId,
  handled,
  blocked,
}: {
  reportId: string;
  conversationId: string;
  handled: boolean;
  blocked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [abrirBloqueo, setAbrirBloqueo] = useState(false);
  const [motivo, setMotivo] = useState("");

  async function alternarAtendido() {
    setBusy(true);
    const supabase = createClient();
    const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
    const { error } = await supabase
      .from("conversation_reports")
      .update(
        handled
          ? // Reabrir es vaciar las dos columnas: el reporte vuelve a la cola y
            // al índice parcial de pendientes. No se guarda quién lo reabrió —
            // la tabla no tiene dónde, y no se inventa una columna para eso.
            { handled_at: null, handled_by: null }
          : // RN-01 · el instante en UTC. Sale del reloj del navegador, que es
            // lo que permite el grant por columnas; la alternativa sería una
            // RPC solo para leer `now()`, y no compensa por un sello de
            // auditoría interna que nadie concilia contra dinero.
            { handled_at: new Date().toISOString(), handled_by: uid },
      )
      .eq("id", reportId);

    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo actualizar el reporte.");
      return;
    }
    toast.success(handled ? "Reporte reabierto." : "Reporte cerrado.");
    router.refresh();
  }

  async function alternarBloqueo(bloquear: boolean) {
    setBusy(true);
    const { error } = await createClient().rpc("set_conversation_blocked", {
      p_conversation_id: conversationId,
      p_blocked: bloquear,
      // Al desbloquear la RPC limpia el motivo sola; mandarlo sería ruido.
      p_reason: bloquear ? motivo.trim() || undefined : undefined,
    });

    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo cambiar el bloqueo.");
      return;
    }
    setAbrirBloqueo(false);
    setMotivo("");
    toast.success(
      bloquear
        ? "Conversación bloqueada. Los dos pueden seguir leyéndola."
        : "Conversación reabierta.",
    );
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
          disabled={busy}
          onClick={() =>
            blocked ? void alternarBloqueo(false) : setAbrirBloqueo(true)
          }
        >
          {blocked ? "Desbloquear" : "Bloquear chat"}
        </Button>
        <Button
          variant="outline"
          className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
          disabled={busy}
          onClick={() => void alternarAtendido()}
        >
          {handled ? "Reabrir" : "Marcar atendido"}
        </Button>
      </div>

      <Dialog open={abrirBloqueo} onOpenChange={setAbrirBloqueo}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Bloquear esta conversación</DialogTitle>
            <DialogDescription>
              {/* Decir exactamente qué hace, porque no es lo que suena.
                  `blocked_at` corta las DOS funciones de envío, pero deja la
                  lectura y la descarga intactas — que es justo lo que hace
                  falta si alguien reclama después. */}
              Los dos dejarán de poder escribir. La conversación sigue visible
              para ambos y se puede descargar: no se borra nada.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Motivo interno (opcional). Por ejemplo: intento de pago fuera de la plataforma, §21."
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAbrirBloqueo(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void alternarBloqueo(true)}
            >
              Bloquear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
