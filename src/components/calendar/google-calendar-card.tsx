"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { LOGOS_CALENDARIO } from "@/components/calendar/logos";

/**
 * Google Calendar por API (reunión del 25-sep), encima del feed suscribible:
 * el feed tarda lo que Google quiera (8-24 h); esto escribe el evento al momento.
 * Conectar es una navegación completa a un Route Handler que redirige a Google,
 * por eso es un `<a>` y no un `<Link>`.
 */
export function GoogleCalendarCard({
  email,
  conectado,
  aviso,
}: {
  email: string | null;
  conectado: boolean;
  /** `?google=` con el que vuelve el callback. */
  aviso: "ok" | "error" | null;
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
      <span
        aria-hidden="true"
        className="block size-8"
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
      <PanelCardTitle className="mt-4 text-xl">Google Calendar al instante</PanelCardTitle>

      {conectado ? (
        <>
          <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
            Conectado{email ? <> como <strong className="text-[#19191f]">{email}</strong></> : null}.
            Tus mentorías aparecen en tu calendario en cuanto se agendan, y se
            mueven o se borran solas si cambian.
          </p>
          <div className="mt-4">
            <Button variant="outline" className="h-10" onClick={desconectar} disabled={ocupado}>
              {ocupado ? "Desconectando…" : "Desconectar"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
            Conecta tu cuenta de Google y cada mentoría aparece en tu calendario
            en el momento en que se agenda. Si cambia de hora o se cancela, el
            evento se actualiza solo.
          </p>
          {aviso === "error" ? (
            <p role="alert" className="mt-3 text-[12.5px] text-destructive">
              No se pudo conectar con Google. Intenta de nuevo.
            </p>
          ) : null}
          <div className="mt-4">
            {/* Route Handler que redirige a Google: navegación COMPLETA. Un
                <Link> pediría su RSC por fetch (regla de oro 13). */}
            <Button asChild className="h-10">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/api/calendario/google/conectar">Conectar Google Calendar</a>
            </Button>
          </div>
        </>
      )}
    </PanelCard>
  );
}
