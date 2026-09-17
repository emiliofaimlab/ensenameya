"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PanelCard } from "@/components/layout/panel-shell";

/**
 * «Enviar los correos pendientes ahora» — el botón de la pasada manual.
 *
 * ESTE BOTÓN NO ENVÍA NADA POR SÍ MISMO, igual que `ExpireForm` no vence nada:
 * le pide a `/api/admin/notificaciones/enviar` que llame al job, y ese Route
 * Handler revalida el rol en el servidor y pone el `CRON_SECRET`, que nunca
 * llega al navegador. Quien abra la consola y llame al endpoint a mano se
 * encuentra la misma puerta.
 *
 * POR QUÉ HAY CONFIRMACIÓN para algo que «solo manda correo»: porque manda
 * correo. En producción son personas reales leyendo su bandeja en el instante en
 * que alguien pulsa, y un correo enviado no se retira. Es menos grave que vencer
 * reservas, pero es igual de irreversible.
 *
 * POR QUÉ ESTÁ EN LOS DOS ENTORNOS y no escondido tras una variable «solo dev»:
 * una rama que solo se prueba en un entorno es exactamente como se rompen las
 * cosas en este repo. Y en prod también sirve — el reloj de GitHub es igual de
 * lento ahí.
 */

/** Lo que devuelve `/api/cron/notifications-send`, tal cual. Todo opcional
 *  porque la respuesta `sin-proveedor` (falta `RESEND_API_KEY`) solo trae
 *  `status` y `enviadas`. */
type Resultado = {
  status?: string;
  revisadas?: number;
  enviadas?: number;
  fallosPermanentes?: number;
  pendientesDeReintento?: number;
};

/** El tope por pasada del job (`LOTE` en `notifications-send`). Aquí solo se
 *  usa para no mentirle al admin sobre cuánto sale de una pulsada; el número
 *  que manda es el de allí. */
const LOTE = 50;

export function EnviarCorreos({ pendientes }: { pendientes: number | null }) {
  const router = useRouter();

  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function enviar() {
    setEnviando(true);
    try {
      const res = await fetch("/api/admin/notificaciones/enviar", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo hacer la pasada.");
        return;
      }
      const r = data as Resultado;
      setResultado(r);
      setConfirmando(false);
      if (r.status === "sin-proveedor") {
        toast.error("No hay RESEND_API_KEY en este entorno: la cola no se tocó.");
      } else {
        toast.success(`${r.enviadas ?? 0} correos enviados.`);
      }
      // Refresca el contador de pendientes que pinta el Server Component.
      router.refresh();
    } catch {
      toast.error("No se pudo hacer la pasada. ¿Sigue viva la sesión?");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PanelCard className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={enviando}
            onClick={() => setConfirmando(true)}
            className="h-[43px] rounded-[8px] px-6 font-semibold"
          >
            Enviar los correos pendientes ahora
          </Button>
          <span className="text-[13px] text-[#6b6b6b]">
            {pendientes === null
              ? "No se pudo contar la cola."
              : pendientes === 0
                ? "La cola está vacía ahora mismo."
                : `${pendientes} ${pendientes === 1 ? "correo espera" : "correos esperan"} en la cola.`}
          </span>
        </div>

        <p className="rounded-[8px] bg-[#fdf0e6] px-3 py-2 text-[13px] text-[#8a4b16]">
          Los correos salen <strong>en ese momento</strong> y a las{" "}
          <strong>bandejas de entrada de verdad</strong> de esas personas. No hay
          deshacer: un correo enviado no se retira.
        </p>

        <p className="text-xs text-[#6b6b6b]">
          Cada clic saca como mucho {LOTE} correos, que es el lote del job. Si
          quedan más, se vuelve a presionar. No se marca nada como enviado sin
          enviarlo: lo que el proveedor rechace por un mal minuto se queda
          pendiente para la pasada siguiente.
        </p>
      </PanelCard>

      {resultado ? (
        resultado.status === "sin-proveedor" ? (
          <PanelCard className="border-[#e8b4b4] bg-[#fdf0f0]">
            <p className="text-[13px] font-semibold text-[#8f2b2b]">
              No se envió nada.
            </p>
            <p className="mt-1.5 text-[13px] text-[#8f2b2b]">
              Este entorno no tiene <code className="font-mono text-xs">RESEND_API_KEY</code>,
              así que la cola ni se tocó: sigue entera y en{" "}
              <code className="font-mono text-xs">pending</code>. El día que se
              ponga la clave sale todo lo acumulado en la primera pasada.
            </p>
          </PanelCard>
        ) : (
          <PanelCard className="border-[#a8d8b9] bg-[#f0faf3]">
            <p className="text-[13px] font-semibold text-[#1f6b40]">Pasada hecha.</p>
            <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[#1f6b40]">
              <li>{resultado.revisadas ?? 0} de la cola revisadas.</li>
              <li>
                <strong>{resultado.enviadas ?? 0}</strong> enviadas de verdad.
              </li>
              <li>
                {resultado.fallosPermanentes ?? 0} con fallo en firme (sin
                dirección o sin plantilla): esas no se reintentan nunca más.
              </li>
              {resultado.pendientesDeReintento ? (
                <li>
                  {resultado.pendientesDeReintento} quedaron pendientes por
                  un fallo transitorio del proveedor. Vuelve a intentarlo dentro de un
                  rato; si no bajan, el problema es de Resend y no de la cola.
                </li>
              ) : null}
            </ul>
          </PanelCard>
        )
      ) : null}

      {/* Confirmación en diálogo de la app y no en `window.confirm()`, por lo
          mismo que en `ExpireForm`: tras varios seguidos el navegador ofrece
          bloquearlos y desde ahí `confirm()` devuelve false sin preguntar, o
          sea, creer que se envió y que no pasó nada. */}
      <Dialog
        open={confirmando}
        onOpenChange={enviando ? undefined : setConfirmando}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            {/* El número es el de cuando se pintó la pantalla, así que solo se
                pone cuando dice algo: con 0 —o sin contar— la pregunta se hace
                sin cifra en vez de prometer «0 correos» y mandar los tres que
                acaban de entrar. */}
            <DialogTitle>
              {pendientes
                ? `¿Enviar ${Math.min(pendientes, LOTE)} correos ahora?`
                : "¿Enviar los correos pendientes ahora?"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-2 text-left">
                <p className="font-semibold text-[#8f2b2b]">
                  Salen ya, a bandejas de entrada reales de otras personas. No se
                  puede deshacer.
                </p>
                <p>
                  Es exactamente la misma pasada que hace el reloj de GitHub; lo
                  único que cambia es que no hay que esperarlo.
                </p>
                <p>
                  Si acabas de sembrar datos de prueba, mira antes a quién van:
                  las direcciones del seed son de un dominio sin MX y solo pueden
                  rebotar, y la cuenta de Resend es la misma que la de producción.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={enviando}
              onClick={() => setConfirmando(false)}
            >
              No, volver
            </Button>
            <Button disabled={enviando} onClick={enviar} className="font-semibold">
              {enviando ? "Enviando…" : "Sí, enviar ahora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
