"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * EY-189 · Las acciones de triaje. Son de CUATRO naturalezas distintas, y la
 * diferencia no es de estilo: cada una entra por el único camino que la RLS de
 * su tabla deja abierto.
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
 * ── 3 · DESACTIVAR A UNA PERSONA — por RPC, por lo MISMO ────────────────────
 * `set_account_suspended` (`20260828120000`). Toca `auth.users`, `user_roles` y
 * `tutor_profiles.approval_status`, tres sitios donde el admin no tiene lectura
 * y donde por tanto un update por RLS volvería a no hacer nada en silencio. Es
 * REVERSIBLE y no cancela ni una reserva: suspender es cerrar la puerta, no
 * liquidar. Si además hay que devolver dinero, se devuelve por `cancel_booking`
 * y RN-37 en otro clic (regla de oro 2).
 *
 * ── 4 · CONTACTAR — ni RLS ni canal nuevo: la cola de EP-12 ─────────────────
 * `admin_contact_user` encola un NTF-22 en `notifications`, igual que cualquier
 * trigger del proyecto. Sale por Resend con los mismos reintentos, aparece en la
 * campana del destinatario y queda listado en /admin/notificaciones. No se
 * inventa un buzón: el que hay ya sabe enviar, reintentar y dejar rastro.
 *
 * ⚠️ LAS CUATRO SON INDEPENDIENTES A PROPÓSITO. Un reporte se puede cerrar sin
 * bloquear (no había caso), un hilo se puede bloquear dejando el reporte abierto
 * (hace falta seguir mirando), y desactivar a alguien no cierra su reporte:
 * encadenarlas obligaría a elegir un desenlace antes de haberlo decidido.
 *
 * ⚠️ Y NINGÚN DIÁLOGO CUELGA DE UN `DropdownMenuItem`. Al elegir la opción el
 * menú se desmonta y se llevaría el diálogo por delante — es literalmente el
 * tropiezo que ya documenta `SignOutDialog`. Por eso los dos diálogos viven
 * fuera del menú y este solo cambia un estado.
 */

/** Una de las dos personas del reporte, con su estado de cuenta. */
export type ReportParty = {
  id: string;
  name: string | null;
  /** `true` = su cuenta está desactivada ahora mismo. */
  suspended: boolean;
};

/** Qué pide cada diálogo. `null` = ninguno abierto. */
type Pendiente =
  | { tipo: "bloquear" }
  | { tipo: "desactivar"; parte: ReportParty; rol: "tutor" | "alumno" }
  | { tipo: "contactar"; parte: ReportParty; rol: "tutor" | "alumno" }
  | null;

export function ReportActions({
  reportId,
  conversationId,
  handled,
  blocked,
  tutor,
  alumno,
}: {
  reportId: string;
  conversationId: string;
  handled: boolean;
  blocked: boolean;
  /** El tutor del hilo (lo sea quien reporta o quien es reportado). */
  tutor: ReportParty;
  /** El alumno del hilo. */
  alumno: ReportParty;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente>(null);
  // Un solo campo de texto para los tres diálogos que lo piden (motivo del
  // bloqueo, motivo de la desactivación, mensaje). Se vacía al abrir cada uno:
  // arrastrar el motivo de un bloqueo al cuerpo de un correo sería el peor
  // copiar y pegar posible.
  const [texto, setTexto] = useState("");

  function abrir(p: Pendiente) {
    setTexto("");
    setPendiente(p);
  }

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
      p_reason: bloquear ? texto.trim() || undefined : undefined,
    });

    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo cambiar el bloqueo.");
      return;
    }
    setPendiente(null);
    setTexto("");
    toast.success(
      bloquear
        ? "Conversación bloqueada. Los dos pueden seguir leyéndola."
        : "Conversación reabierta.",
    );
    router.refresh();
  }

  /**
   * Desactivar y reactivar son la MISMA llamada con el booleano cambiado, igual
   * que el bloqueo. Reactivar no pide confirmación ni motivo: devolver el acceso
   * no rompe nada y hacerlo en un clic es lo que permite rectificar deprisa.
   */
  async function alternarCuenta(parte: ReportParty, desactivar: boolean) {
    setBusy(true);
    const { error } = await createClient().rpc("set_account_suspended", {
      p_user_id: parte.id,
      p_suspended: desactivar,
      p_reason: desactivar ? texto.trim() || undefined : undefined,
      // De qué reporte salió la sanción. Es el rastro que convierte
      // `account_suspensions` en algo auditable y no en un interruptor suelto.
      p_report_id: desactivar ? reportId : undefined,
    });

    setBusy(false);
    if (error) {
      // La RPC rechaza a los admins y a las cuentas ya dadas de baja con un
      // mensaje propio; merece la pena enseñarlo tal cual.
      toast.error(error.message || "No se pudo cambiar el estado de la cuenta.");
      return;
    }
    setPendiente(null);
    setTexto("");
    toast.success(
      desactivar
        ? `${parte.name ?? "La cuenta"} queda desactivada y sin sesión abierta.`
        : `${parte.name ?? "La cuenta"} vuelve a tener acceso.`,
    );
    router.refresh();
  }

  async function contactar(parte: ReportParty) {
    const mensaje = texto.trim();
    if (!mensaje) {
      toast.error("Escribe el mensaje antes de enviarlo.");
      return;
    }
    setBusy(true);
    const { error } = await createClient().rpc("admin_contact_user", {
      p_user_id: parte.id,
      p_message: mensaje,
      p_report_id: reportId,
    });

    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo enviar el mensaje.");
      return;
    }
    setPendiente(null);
    setTexto("");
    // ⚠️ "En cola" y no "enviado", que es la verdad: sin `RESEND_API_KEY` la
    // fila se queda `pending` y sale el día que se ponga la clave. Prometer un
    // envío que puede no haber ocurrido es justo lo que hacía el stub viejo de
    // `process_notifications`.
    toast.success(
      `Mensaje en cola para ${parte.name ?? "la persona"}. También le sale en sus avisos.`,
    );
    router.refresh();
  }

  /** Las dos partes, con la etiqueta que el admin lee en el menú. */
  const partes: { parte: ReportParty; rol: "tutor" | "alumno" }[] = [
    { parte: tutor, rol: "tutor" },
    { parte: alumno, rol: "alumno" },
  ];

  /**
   * «Ana Gómez (tutor)», o «el tutor» a secas si la cuenta no tiene nombre —
   * pasa con las anonimizadas (EY-192) y con las que aún no completaron el
   * perfil. Repetir el papel dos veces («el tutor (tutor)») sonaba a error.
   *
   * ⚠️ Se dice «estudiante» y no «alumno» porque es la palabra que usó el
   * cliente al pedir esto («desactivar estudiante, contactar estudiante»). El
   * código sigue llamándolo `alumno`, que es como se llama en todo el repo.
   */
  const etiqueta = (p: ReportParty, rol: "tutor" | "alumno") => {
    const papel = rol === "tutor" ? "tutor" : "estudiante";
    return p.name ? `${p.name} (${papel})` : `el ${papel}`;
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
              disabled={busy}
            >
              Acciones
              <ChevronDownIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[12px] font-normal text-muted-foreground">
              Sobre las personas del reporte
            </DropdownMenuLabel>
            {partes.map(({ parte, rol }) => (
              <DropdownMenuItem
                key={`baja-${parte.id}`}
                variant={parte.suspended ? "default" : "destructive"}
                onSelect={() =>
                  parte.suspended
                    ? void alternarCuenta(parte, false)
                    : abrir({ tipo: "desactivar", parte, rol })
                }
              >
                {parte.suspended ? "Reactivar a " : "Desactivar a "}
                {etiqueta(parte, rol)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {partes.map(({ parte, rol }) => (
              <DropdownMenuItem
                key={`msg-${parte.id}`}
                onSelect={() => abrir({ tipo: "contactar", parte, rol })}
              >
                Contactar a {etiqueta(parte, rol)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
          disabled={busy}
          onClick={() =>
            blocked ? void alternarBloqueo(false) : abrir({ tipo: "bloquear" })
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

      <Dialog
        open={pendiente?.tipo === "bloquear"}
        onOpenChange={(open) => {
          if (!open) setPendiente(null);
        }}
      >
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
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Motivo interno (opcional). Por ejemplo: intento de pago fuera de la plataforma, §21."
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendiente(null)}
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

      <Dialog
        open={pendiente?.tipo === "desactivar"}
        onOpenChange={(open) => {
          if (!open) setPendiente(null);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              Desactivar la cuenta de{" "}
              {pendiente?.tipo === "desactivar"
                ? (pendiente.parte.name ?? "esta persona")
                : ""}
            </DialogTitle>
            <DialogDescription>
              {/* Igual que en el bloqueo: decir lo que hace de verdad, incluido
                  lo que NO hace. Un admin que crea que esto cancela y devuelve
                  no va a ir a la pantalla de reembolsos. */}
              Pierde el acceso al instante —se le cierran las sesiones abiertas—
              {pendiente?.tipo === "desactivar" && pendiente.rol === "tutor"
                ? " y sus mentorías salen del catálogo"
                : ""}
              . No se borra nada y se puede reactivar desde este mismo menú.{" "}
              <strong>
                Sus reservas y sus pagos no se tocan: si además hay que cancelar
                o devolver, eso va por la ficha de la reserva.
              </strong>
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Motivo interno (opcional). Queda guardado junto al reporte del que sale."
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendiente(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                pendiente?.tipo === "desactivar"
                  ? void alternarCuenta(pendiente.parte, true)
                  : undefined
              }
            >
              Desactivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendiente?.tipo === "contactar"}
        onOpenChange={(open) => {
          if (!open) setPendiente(null);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              Escribir a{" "}
              {pendiente?.tipo === "contactar"
                ? (pendiente.parte.name ?? "esta persona")
                : ""}
            </DialogTitle>
            <DialogDescription>
              Le llega por correo desde la dirección de la plataforma y también
              le aparece en sus avisos. No abre un chat: si responde, contesta al
              correo.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            maxLength={2000}
            placeholder="Hola, escribimos por el reporte que abrimos sobre tu conversación…"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendiente(null)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={busy || !texto.trim()}
              onClick={() =>
                pendiente?.tipo === "contactar"
                  ? void contactar(pendiente.parte)
                  : undefined
              }
            >
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
