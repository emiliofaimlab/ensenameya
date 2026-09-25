"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDaysIcon, CheckCircle2Icon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { LOGOS_CALENDARIO } from "@/components/calendar/logos";

/**
 * «Tus mentorías en tu calendario»: UNA tarjeta con dos caminos, y no dos
 * tarjetas que dicen «Google» cada una (queja de Jose, 25-sep).
 *
 * 1. Google Calendar por API (reunión del 25-sep): el evento se escribe al
 *    momento. Es la opción destacada y lleva el único botón naranja.
 * 2. El feed suscribible de EY-188, plegado debajo para Apple y Outlook: tarda
 *    lo que el calendario quiera (8-24 h), y por eso no compite con la de arriba.
 *
 * Conectar es una navegación completa a un Route Handler que redirige a Google,
 * por eso es un `<a>` y no un `<Link>`.
 */
export function GoogleCalendarCard({
  email,
  conectado,
  aviso,
  feedActivo,
  children,
}: {
  email: string | null;
  conectado: boolean;
  /** `?google=` con el que vuelve el callback. */
  aviso: "ok" | "error" | null;
  /** Si ya usa el enlace de suscripción, el plegable sale abierto. */
  feedActivo: boolean;
  /** `<CalendarFeedCard embebida />`. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const logo = LOGOS_CALENDARIO.google;

  async function desconectar() {
    setOcupado(true);
    const res = await fetch("/api/calendario/google/desconectar", { method: "POST" });
    setOcupado(false);
    if (!res.ok) {
      toast.error("No se pudo desconectar. Intenta de nuevo.");
      return;
    }
    toast.success("Google Calendar desconectado.");
    router.replace("/account");
    router.refresh();
  }

  return (
    <PanelCard>
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <CalendarDaysIcon className="size-5" />
      </span>
      <PanelCardTitle className="mt-4 text-xl">Tus mentorías en tu calendario</PanelCardTitle>
      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
        Elige cómo quieres verlas junto al resto de tu agenda.
      </p>

      {/* ── 1 · Google, al instante ──────────────────────────────────────── */}
      <div className="mt-5 rounded-[12px] border border-[#e0e0e0] p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            aria-hidden="true"
            className="block size-6 shrink-0"
            style={{
              backgroundColor: logo.color,
              maskImage: `url(${logo.src})`,
              WebkitMaskImage: `url(${logo.src})`,
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskSize: "contain",
              WebkitMaskSize: "contain",
            }}
          />
          <h3 className="text-[15px] font-semibold text-[#19191f]">Google Calendar</h3>
          <span className="rounded-full bg-[#e6f2ff] px-2 py-0.5 text-[11px] font-semibold text-[#0063c7]">
            Al instante
          </span>
        </div>

        {conectado ? (
          <>
            <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] text-[#6b6b6b]">
              <CheckCircle2Icon aria-hidden className="mt-px size-4 shrink-0 text-[#1a7f37]" />
              <span>
                Conectado{email ? <> como <strong className="text-[#19191f]">{email}</strong></> : null}.
                Cada mentoría aparece en cuanto se agenda, y se mueve o se borra sola si cambia.
              </span>
            </p>
            <Button variant="outline" className="mt-3 h-10" onClick={desconectar} disabled={ocupado}>
              {ocupado ? "Desconectando…" : "Desconectar"}
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2.5 text-[12.5px] text-[#6b6b6b]">
              Cada mentoría aparece en tu calendario en cuanto se agenda. Si
              cambia de hora o se cancela, el evento se actualiza solo.
            </p>
            {aviso === "error" ? (
              <p role="alert" className="mt-2 text-[12.5px] text-destructive">
                No se pudo conectar con Google. Intenta de nuevo.
              </p>
            ) : null}
            {/* Route Handler que redirige a Google: navegación COMPLETA. Un
                <Link> pediría su RSC por fetch (regla de oro 13). */}
            <Button asChild className="mt-3 h-10">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/calendario/google/conectar">Conectar Google Calendar</a>
            </Button>
          </>
        )}
      </div>

      {/* ── 2 · Apple, Outlook y los demás, por enlace ───────────────────── */}
      {/* `<details>` nativo: abre con teclado y el lector anuncia su estado
          sin `aria-expanded` a mano (mismo recurso que la ficha de mentoría). */}
      <details open={feedActivo} className="group mt-3 rounded-[12px] border border-[#e0e0e0]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-[14px] font-medium text-[#19191f] [&::-webkit-details-marker]:hidden">
          ¿Usas Apple Calendar, Outlook u otro?
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-[#6b6b6b] transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="px-4 pb-4">{children}</div>
      </details>
    </PanelCard>
  );
}
