"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import {
  explicarEnEspera,
  fechaLegible,
  mientrasDesactivada,
  type EstadoBaja,
} from "./baja";

/**
 * La cara que pone «Mi cuenta» cuando la baja está PEDIDA pero no hecha.
 *
 * ── QUÉ TIENE QUE HACER BIEN ESTA TARJETA ───────────────────────────────────
 *
 * 1 · DECIR QUÉ FALTA, CON NOMBRE Y NÚMERO. «Tu cuenta se eliminará
 *     próximamente» no vale: la persona no sabe si son horas o meses, ni por
 *     qué. Se enumera cada cosa que queda en vuelo —el saldo, el retiro, el
 *     reembolso— con su importe y, cuando se puede saber, su fecha.
 *
 * 2 · DECIR QUÉ PUEDE HACER MIENTRAS TANTO. Es lo que la gente pregunta a
 *     soporte cuando no está escrito. Las dos listas son cortas a propósito.
 *
 * 3 · OFRECER LA VUELTA ATRÁS, y sin fricción. Confirmar por correo tiene
 *     sentido para lo irreversible; ponerle trabas a «quiero conservar mi
 *     cuenta» solo consigue que quien ya se arrepintió no llegue a tiempo.
 *
 * ⚠️ Los datos se recalculan en el servidor en cada carga (`page.tsx`), no se
 * guardan del momento en que se pidió la baja: el dinero se mueve, y una lista
 * congelada seguiría enseñando un reembolso que ya se abonó.
 */
export function DeactivatedCard({
  estado,
  isTutor,
}: {
  estado: EstadoBaja;
  isTutor: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const pendientes = explicarEnEspera(estado.en_espera);
  const desde = fechaLegible(estado.baja_programada?.requested_at);
  const { puedes, noPuedes } = mientrasDesactivada(isTutor);

  async function reactivar() {
    setBusy(true);
    try {
      const res = await fetch("/api/cuenta/eliminar", { method: "DELETE" });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(d.error ?? "No se pudo reactivar tu cuenta.");
        setBusy(false);
        return;
      }
    } catch {
      toast.error("No se pudo reactivar tu cuenta. Inténtalo de nuevo.");
      setBusy(false);
      return;
    }

    toast.success("Tu cuenta vuelve a estar activa.");
    // `refresh()` y no `assign()`: la sesión es la misma y no hay nada que
    // tirar (a diferencia de la baja consumada, que sí recarga entera). Esto
    // solo repinta el árbol del servidor para que la tarjeta cambie de cara y
    // el tutor recupere sus mentorías en el panel.
    router.refresh();
  }

  return (
    <PanelCard className="border-destructive/30 bg-destructive/[0.03] md:col-span-2 md:mt-1">
      <div className="flex flex-col gap-5">
        <div>
          <PanelCardTitle>Tu cuenta está desactivada</PanelCardTitle>
          <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
            {desde
              ? `Pediste darte de baja el ${desde}. `
              : "Pediste darte de baja. "}
            Todavía no podemos borrarla porque hay dinero tuyo en movimiento.
            En cuanto termine de moverse, tu cuenta se elimina sola: no tienes
            que volver a hacer nada.
          </p>
        </div>

        {pendientes.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-[#1a1a1a]">
              Estamos esperando a:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
              {pendientes.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-[#1a1a1a]">
              Mientras tanto puedes:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
              {puedes.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-[#1a1a1a]">No puedes:</p>
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
              {noPuedes.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* El error del job. Casi siempre no hay ninguno; cuando lo hay, la
            persona lleva días esperando sin saber por qué y merece al menos
            saber a dónde escribir. No se enseña el texto técnico: no le dice
            nada a quien lo lee y sí filtra detalles internos. */}
        {estado.baja_programada?.last_error && (
          <p className="text-[13px] text-[#bf3333]">
            Algo está bloqueando el último paso. Escríbenos a
            info@ensenameya.com y lo miramos.
          </p>
        )}

        <div>
          <Button
            variant="outline"
            onClick={reactivar}
            disabled={busy}
            className="h-[45px] rounded-[8px] px-5"
          >
            {busy ? "Reactivando…" : "Conservar mi cuenta"}
          </Button>
        </div>
      </div>
    </PanelCard>
  );
}
