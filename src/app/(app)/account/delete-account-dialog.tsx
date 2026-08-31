"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  explicarAccionables,
  explicarEnEspera,
  hayDineroEnVuelo,
  mientrasDesactivada,
  type Accionables,
  type EnEspera,
  type EstadoBaja,
} from "./baja";

/**
 * EY-192 · B5.9 — confirmación de baja de cuenta.
 *
 * Controlado desde fuera igual que `SignOutDialog`, y por el mismo motivo.
 *
 * ── LAS CUATRO COSAS QUE ESTE DIÁLOGO TIENE QUE HACER BIEN ──────────────────
 *
 * 1 · DECIR LA VERDAD DE QUÉ PASA. La palabra «eliminar» promete algo que no
 *     ocurre: las reservas y los pagos SE CONSERVAN, por plazo fiscal. Si la
 *     pantalla no lo dice, la persona descubre después que su historial de
 *     compras sigue existiendo. Por eso hay una lista de «qué se borra» y otra
 *     de «qué se queda», no un párrafo vago.
 *
 * 2 · DECIR **CUÁNDO** PASA, que es lo nuevo. Desde `20260831160000` la baja no
 *     siempre es inmediata: con dinero en vuelo (saldo por cobrar, un retiro en
 *     curso, un reembolso sin abonar) la cuenta se DESACTIVA y se borra sola
 *     después. Eso hay que decirlo ANTES de pulsar, y con la lista concreta de
 *     lo que falta — no un «puede tardar». El botón cambia de texto para que la
 *     diferencia no dependa de que alguien haya leído el párrafo.
 *
 * 3 · NO OFRECER UN BOTÓN QUE VA A FALLAR. Los bloqueos se consultan al ABRIR
 *     el diálogo, no al pulsar. Un tutor con clases vendidas ve por qué no
 *     puede y qué le falta, en vez de un error después de teclear su correo.
 *
 * 4 · NO PODERSE PULSAR SIN QUERER. Hay que escribir el correo de la cuenta.
 *     ⚠️ Esta comprobación de aquí es SOLO comodidad: la de verdad la hace el
 *     servidor contra la sesión (`/api/cuenta/eliminar`). Nada de lo que se
 *     valide en el navegador cuenta como confirmación.
 *     ⚠️ Y se pide también para la baja programada, aunque esa se pueda
 *     deshacer: lo que se está pidiendo es empezar el borrado, y el final es
 *     el mismo.
 */

const ESTADO_VACIO: EstadoBaja = {
  accionables: {},
  en_espera: {},
  baja_programada: null,
};

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
  isTutor,
}: {
  onOpenChange: (open: boolean) => void;
  email: string;
  isTutor: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState<EstadoBaja>(ESTADO_VACIO);
  const [texto, setTexto] = useState("");

  // El estado se pide al abrir, no al cargar la página: pedirlo siempre sería
  // una llamada de más para todo el mundo que no piensa darse de baja. (La
  // tarjeta de «cuenta desactivada» sí lo lee en el servidor en cada carga,
  // porque esa pregunta es otra: ver `page.tsx`.)
  useEffect(() => {
    let vigente = true;

    fetch("/api/cuenta/eliminar")
      .then((r) => r.json())
      .then((d: { estado?: EstadoBaja; error?: string }) => {
        if (!vigente) return;
        if (d.error) {
          toast.error(d.error);
          onOpenChange(false);
          return;
        }
        setEstado(d.estado ?? ESTADO_VACIO);
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

  const motivos = explicarAccionables(estado.accionables);
  const enVuelo = hayDineroEnVuelo(estado.en_espera);
  const espera = explicarEnEspera(estado.en_espera);
  const puede = !cargando && motivos.length === 0;
  const confirmado = texto.trim().toLowerCase() === email.trim().toLowerCase();

  async function eliminar() {
    setBusy(true);
    let programada = false;

    try {
      const res = await fetch("/api/cuenta/eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacion: texto }),
      });
      const d = (await res.json()) as {
        error?: string;
        status?: string;
        accionables?: Accionables;
        en_espera?: EnEspera;
      };

      if (!res.ok) {
        // 409 con `accionables`: algo cambió entre abrir el diálogo y confirmar
        // (una compra en otra pestaña). Se repinta la lista en vez de soltar
        // un error suelto que no dice qué hacer.
        if (d.accionables) {
          setEstado((e) => ({
            ...e,
            accionables: d.accionables ?? {},
            en_espera: d.en_espera ?? e.en_espera,
          }));
        }
        toast.error(d.error ?? "No se pudo eliminar la cuenta.");
        setBusy(false);
        return;
      }

      programada = d.status === "programada";
    } catch {
      toast.error("No se pudo eliminar la cuenta. Inténtalo de nuevo.");
      setBusy(false);
      return;
    }

    // ── Baja PROGRAMADA: la cuenta sigue viva y la sesión también ───────────
    // Nada de `signOut` ni de vaciar el estado local: la persona se queda
    // dentro, y lo hace a propósito (necesita ver llegar su dinero y poder
    // arrepentirse). Solo se repinta el árbol del servidor para que la tarjeta
    // de «Mi cuenta» cambie de cara.
    if (programada) {
      onOpenChange(false);
      toast.success(
        "Tu cuenta queda desactivada. La borraremos en cuanto se complete el dinero pendiente.",
      );
      router.refresh();
      return;
    }

    // ── Baja consumada ─────────────────────────────────────────────────────
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

  const { puedes, noPuedes } = mientrasDesactivada(isTutor);

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Eliminar mi cuenta</DialogTitle>
        <DialogDescription>
          {enVuelo
            ? "Tu cuenta se desactiva ahora y se elimina cuando termine el dinero pendiente."
            : "Esta acción es irreversible y no se puede deshacer."}
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
          {/* El bloque que explica la espera. Va ARRIBA del todo, antes de «se
              borra / se conserva»: es lo que cambia el significado del botón,
              y leerlo después de haber decidido no sirve de nada. */}
          {enVuelo && (
            <div className="space-y-3 rounded-[8px] border border-destructive/30 bg-destructive/[0.03] p-4">
              <p className="text-[13px] font-medium text-[#1a1a1a]">
                Tu cuenta no se borrará hoy
              </p>
              <p className="text-[13px] text-[#6b6b6b]">
                Queda dinero tuyo en movimiento, así que primero la desactivamos
                y la eliminamos sola en cuanto termine. No tendrás que volver a
                hacer nada.
              </p>
              <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
                {espera.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <div className="space-y-1">
                <p className="text-[13px] text-[#6b6b6b]">Mientras tanto podrás:</p>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
                  {puedes.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <p className="pt-1 text-[13px] text-[#6b6b6b]">No podrás:</p>
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
                  {noPuedes.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

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
            {busy
              ? enVuelo
                ? "Desactivando…"
                : "Eliminando…"
              : enVuelo
                ? "Desactivar y programar la baja"
                : "Eliminar mi cuenta"}
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
  isTutor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  isTutor: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Montado solo mientras está abierto: cada apertura arranca con estado
          limpio y con los bloqueos recién consultados. Reabrir el diálogo tras
          comprar una clase en otra pestaña tiene que volver a preguntar. */}
      {open && (
        <CuerpoDelDialogo
          onOpenChange={onOpenChange}
          email={email}
          isTutor={isTutor}
        />
      )}
    </Dialog>
  );
}
