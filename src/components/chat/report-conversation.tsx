"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FlagIcon } from "lucide-react";

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
  DialogTrigger,
} from "@/components/ui/dialog";
import { asRpc } from "./rpc";

/**
 * M-12 (decisión e) · La puerta de moderación, por el lado del usuario.
 *
 * Abrir un canal alumno→tutor sin compra trae dos cosas conocidas: spam y
 * desintermediación —llevarse la clase fuera de la plataforma, que el §21 de
 * los Términos publicados hoy prohíbe expresamente—. Los topes de
 * `send_conversation_message` frenan lo primero; lo segundo no lo puede detectar
 * una regla, lo denuncia la persona que lo recibe.
 *
 * ⚠️ MN-06 · el canal sin compra se cerró el 20-ago, así que el spam de
 * desconocidos casi desaparece — pero esto NO se retira, por dos razones: la
 * desintermediación se propone sobre todo DENTRO de una mentoría ya pagada, que
 * es donde hay algo que llevarse fuera; y el botón sigue apareciendo en los
 * hilos que quedaron en solo lectura, donde lo que hay que denunciar ya está
 * escrito y no se puede borrar respondiendo.
 *
 * ⚠️ Y ESE PÁRRAFO YA NO DESCRIBE EL MUNDO: el 26-ago EY-194
 * (`20260826140000`) dio marcha atrás y **el canal sin compra volvió a abrirse**
 * a petición del cliente. Se deja escrito en vez de borrarlo porque la
 * conclusión no cambió —el botón se quedó— y porque el argumento de entonces es
 * el que sigue mandando: con el canal abierto, el spam de desconocidos vuelve a
 * ser posible y hace todavía más falta.
 *
 * Esto es la puerta, no la sala: guarda el reporte en `conversation_reports`
 * con el motivo. Revisarlos y bloquear la conversación (`blocked_at`, que ya
 * corta el envío en las dos RPC) es trabajo del panel de admin, que es de otro
 * carril.
 */
export function ReportConversation({
  conversationId,
  trigger,
}: {
  conversationId: string;
  /**
   * EY-189 · El botón que abre el diálogo, si el de por defecto no sirve.
   *
   * Existe porque la sala lo necesita con otra piel: allí el enlace gris de
   * `text-muted-foreground` se pinta sobre la barra BLANCA de sesión, entre
   * «Mostrar chat» y el cronómetro, y tiene que parecerse a sus vecinos. Lo que
   * NO se duplica es el diálogo: el texto, el tope de 2000 caracteres y la
   * llamada a `report_conversation` viven aquí y en un solo sitio, que es lo
   * que hace que cambiar el copy de moderación sea un cambio y no tres.
   *
   * ⚠️ El diálogo se pinta por un PORTAL (Radix lo cuelga de `document.body`),
   * así que se escapa del subárbol de la sala y de sus tokens redefinidos
   * (`VARS_CHAT_SALA`): sale en claro, con `text-popover-foreground` explícito,
   * venga de donde venga el disparador. El único que hereda colores del sitio
   * donde se monta es este `trigger` — y por eso lo elige quien lo monta.
   *
   * `ReactElement` y no `ReactNode`: `DialogTrigger asChild` clona su hijo para
   * inyectarle el `onClick` y los ARIA del diálogo, así que una cadena o una
   * lista reventarían en ejecución. Con este tipo lo dice el compilador.
   */
  trigger?: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  async function enviar() {
    const texto = motivo.trim();
    if (!texto) return;
    setBusy(true);
    const { error } = await asRpc(createClient()).rpc("report_conversation", {
      p_conversation_id: conversationId,
      p_reason: texto,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo enviar el reporte.");
      return;
    }
    setMotivo("");
    setOpen(false);
    toast.success("Gracias. Lo revisaremos.");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            <FlagIcon className="size-3" />
            Reportar
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Reportar esta conversación</DialogTitle>
          <DialogDescription>
            Cuéntanos qué ha pasado. Lo revisa una persona del equipo; mientras
            tanto la conversación sigue como está.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Por ejemplo: me pide pagar por fuera de la plataforma, o me está escribiendo cosas que no vienen a cuento."
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={() => void enviar()} disabled={busy || !motivo.trim()}>
            Enviar reporte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
