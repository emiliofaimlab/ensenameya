"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetDatosDeSesion } from "@/lib/session-reset";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * EY-192 · B5.9 — confirmación de baja de cuenta.
 *
 * Controlado desde fuera igual que `SignOutDialog`, y por el mismo motivo.
 *
 * ── LAS TRES COSAS QUE ESTE DIÁLOGO TIENE QUE HACER BIEN ────────────────────
 *
 * 1 · DECIR LA VERDAD DE QUÉ PASA. La palabra «eliminar» promete algo que no
 *     ocurre: las reservas y los pagos SE CONSERVAN, por plazo fiscal. Si la
 *     pantalla no lo dice, la persona descubre después que su historial de
 *     compras sigue existiendo. Por eso hay una lista de «qué se borra» y otra
 *     de «qué se queda», no un párrafo vago.
 *
 * 2 · NO OFRECER UN BOTÓN QUE VA A FALLAR. Los bloqueos se consultan al ABRIR
 *     el diálogo, no al pulsar. Un tutor con clases vendidas ve por qué no
 *     puede y qué le falta, en vez de un error después de teclear su correo.
 *
 * 3 · NO PODERSE PULSAR SIN QUERER. Hay que escribir el correo de la cuenta.
 *     ⚠️ Esta comprobación de aquí es SOLO comodidad: la de verdad la hace el
 *     servidor contra la sesión (`/api/cuenta/eliminar`). Nada de lo que se
 *     valide en el navegador cuenta como confirmación.
 */

type Bloqueos = {
  clases_futuras_como_tutor?: number;
  clases_futuras_como_alumno?: number;
  saldo_sin_liquidar?: number;
  payouts_en_curso?: number;
  reembolsos_pendientes?: number;
};

/**
 * Cada bloqueo se explica con lo que la persona tiene que HACER, no con el
 * nombre del campo. La asimetría entre tutor y alumno es deliberada y está
 * razonada en la migración: el alumno puede cancelar y salir; el tutor no,
 * porque son clases vendidas a terceros y dinero suyo aún sin cobrar.
 */
function explicar(b: Bloqueos): string[] {
  const fuera: string[] = [];

  if (b.clases_futuras_como_tutor) {
    fuera.push(
      `Tienes ${b.clases_futuras_como_tutor} clase(s) ya vendidas y sin impartir. ` +
        "Son compromisos con tus alumnos: hay que darlas (o que ellos las cancelen) antes de poder darte de baja.",
    );
  }
  if (b.saldo_sin_liquidar) {
    fuera.push(
      `Te quedan ${b.saldo_sin_liquidar} por cobrar. Solicita el pago desde «Mis ingresos» y espera a recibirlo.`,
    );
  }
  if (b.payouts_en_curso) {
    fuera.push(
      `Tienes ${b.payouts_en_curso} pago(s) en curso. Espera a que se completen.`,
    );
  }
  if (b.clases_futuras_como_alumno) {
    fuera.push(
      `Tienes ${b.clases_futuras_como_alumno} clase(s) reservadas y sin dar. ` +
        "Cancélalas primero desde «Mis reservas»: así se te aplica la política de reembolso que corresponda.",
    );
  }
  if (b.reembolsos_pendientes) {
    fuera.push(
      `Tienes ${b.reembolsos_pendientes} reembolso(s) en curso. Espera a que se te abonen.`,
    );
  }
  return fuera;
}

/**
 * El contenido vive en su propio componente y solo se monta con el diálogo
 * abierto. No es un capricho de organización: así el estado (los bloqueos, lo
 * tecleado, el `busy`) nace limpio en cada apertura sin tener que resetearlo a
 * mano dentro del efecto — que además es lo que prohíbe la regla
 * `react-hooks/set-state-in-effect` de React 19.
 */
function CuerpoDelDialogo({
  onOpenChange,
  email,
}: {
  onOpenChange: (open: boolean) => void;
  email: string;
}) {
  const [busy, setBusy] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [motivos, setMotivos] = useState<string[]>([]);
  const [texto, setTexto] = useState("");

  // Los bloqueos se piden al abrir, no al cargar la página: pedirlos siempre
  // sería una llamada de más para todo el mundo que no piensa darse de baja.
  useEffect(() => {
    let vigente = true;

    fetch("/api/cuenta/eliminar")
      .then((r) => r.json())
      .then((d: { bloqueos?: Bloqueos; error?: string }) => {
        if (!vigente) return;
        if (d.error) {
          toast.error(d.error);
          onOpenChange(false);
          return;
        }
        setMotivos(explicar(d.bloqueos ?? {}));
      })
      .catch(() => {
        if (!vigente) return;
        toast.error("No se pudieron comprobar los datos de tu cuenta.");
        onOpenChange(false);
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });

    return () => {
      vigente = false;
    };
  }, [onOpenChange]);

  const puede = !cargando && motivos.length === 0;
  const confirmado = texto.trim().toLowerCase() === email.trim().toLowerCase();

  async function eliminar() {
    setBusy(true);
    try {
      const res = await fetch("/api/cuenta/eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacion: texto }),
      });
      const d = (await res.json()) as { error?: string; bloqueos?: Bloqueos };

      if (!res.ok) {
        // 409 con bloqueos: algo cambió entre abrir el diálogo y confirmar
        // (una compra en otra pestaña). Se repinta la lista en vez de soltar
        // un error suelto que no dice qué hacer.
        if (d.bloqueos) setMotivos(explicar(d.bloqueos));
        toast.error(d.error ?? "No se pudo eliminar la cuenta.");
        setBusy(false);
        return;
      }
    } catch {
      toast.error("No se pudo eliminar la cuenta. Inténtalo de nuevo.");
      setBusy(false);
      return;
    }

    // Y el rastro que `signOut` no se lleva: el carrito, el paso del asistente,
    // el panel y los contadores del chat. Es la MISMA limpieza que al cerrar
    // sesión, compartida a propósito — aquí importa todavía más, porque la
    // cuenta ya no existe y ese carrito no puede volver a ser de nadie.
    resetDatosDeSesion();

    // Recarga completa, igual que al cerrar sesión y por el mismo motivo: hay
    // que tirar TODO el estado de cliente y las cachés RSC de las rutas ya
    // visitadas, que siguen teniendo el nombre y la foto de la cuenta recién
    // anonimizada.
    window.location.assign("/");
  }

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Eliminar mi cuenta</DialogTitle>
        <DialogDescription>
          Esta acción es irreversible y no se puede deshacer.
        </DialogDescription>
      </DialogHeader>

      {cargando ? (
        <p className="text-[13px] text-[#6b6b6b]">Comprobando tu cuenta…</p>
      ) : motivos.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[13px] font-medium text-[#bf3333]">
            Todavía no puedes darte de baja:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-[13px] text-[#6b6b6b]">
            {motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-[#1a1a1a]">Se borra:</p>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
              <li>Tu nombre, tu foto y tus datos de contacto.</li>
              <li>Tus documentos de verificación de identidad.</li>
              <li>Tu acceso: no podrás volver a entrar, tampoco con Google.</li>
            </ul>
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-[#1a1a1a]">
              Se conserva:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
              <li>
                Tus reservas, pagos y facturas. Son registros contables y hay
                que guardarlos por el plazo que marca la ley.
              </li>
              <li>Tus reseñas, que quedan publicadas sin tu nombre.</li>
            </ul>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmar-baja" className="text-[13px]">
              Para confirmar, escribe <strong>{email}</strong>
            </Label>
            <Input
              id="confirmar-baja"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoComplete="off"
              placeholder={email}
              disabled={busy}
            />
          </div>
        </div>
      )}

      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={busy}
        >
          {puede ? "Cancelar" : "Entendido"}
        </Button>
        {puede && (
          <Button
            variant="destructive"
            onClick={eliminar}
            disabled={busy || !confirmado}
          >
            {busy ? "Eliminando…" : "Eliminar mi cuenta"}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

export function DeleteAccountDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Montado solo mientras está abierto: cada apertura arranca con estado
          limpio y con los bloqueos recién consultados. Reabrir el diálogo tras
          comprar una clase en otra pestaña tiene que volver a preguntar. */}
      {open && <CuerpoDelDialogo onOpenChange={onOpenChange} email={email} />}
    </Dialog>
  );
}
