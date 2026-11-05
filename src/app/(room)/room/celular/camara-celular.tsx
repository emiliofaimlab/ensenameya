"use client";

import { useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";

import { Button } from "@/components/ui/button";

type Estado =
  | { tipo: "listo" }
  | { tipo: "conectando" }
  | { tipo: "en-vivo" }
  | { tipo: "fuera"; motivo: string };

/**
 * Segunda cámara · lo que ve el celular del tutor tras escanear el QR.
 *
 * Entra a la sala de la clase solo con video (el token ya lo limita a eso,
 * `api/room/[sessionId]/celular`): cámara trasera, sin micro, para que no haya
 * eco. Pide que la pantalla no se apague (Wake Lock) y lo vuelve a pedir al
 * volver a la pestaña, porque el navegador lo suelta al ocultarla.
 *
 * La sala y el token llegan en el fragmento (`#r=…&t=…`), que no viaja a
 * ningún servidor. No hace falta sesión iniciada en el celular.
 */
export function CamaraCelular() {
  const [estado, setEstado] = useState<Estado>({ tipo: "listo" });
  const callRef = useRef<DailyCall | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // La pantalla encendida mientras dure la clase.
  useEffect(() => {
    if (estado.tipo !== "en-vivo" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const pedir = () => {
      if (document.visibilityState === "visible") {
        navigator.wakeLock.request("screen").then((l) => (lock = l), () => {});
      }
    };
    pedir();
    document.addEventListener("visibilitychange", pedir);
    return () => {
      document.removeEventListener("visibilitychange", pedir);
      void lock?.release();
    };
  }, [estado.tipo]);

  useEffect(() => () => void callRef.current?.destroy(), []);

  async function empezar() {
    // Se lee al pulsar (y no en un efecto): el fragmento solo existe en el
    // navegador, y el botón es el gesto que iOS exige para abrir la cámara.
    const h = new URLSearchParams(window.location.hash.slice(1));
    const destino = { url: h.get("r"), token: h.get("t") };
    if (!destino.url || !destino.token) {
      setEstado({ tipo: "fuera", motivo: "Este enlace no es válido. Vuelve a escanear el QR de la sala." });
      return;
    }
    setEstado({ tipo: "conectando" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const [pista] = stream.getVideoTracks();
      if (videoRef.current) videoRef.current.srcObject = stream;

      const Daily = (await import("@daily-co/daily-js")).default;
      const call = Daily.createCallObject({ videoSource: pista, audioSource: false });
      callRef.current = call;
      call.on("left-meeting", () =>
        setEstado({ tipo: "fuera", motivo: "El celular salió de la clase." }),
      );
      call.on("error", (e) =>
        setEstado({ tipo: "fuera", motivo: e?.errorMsg ?? "Se cortó la conexión con la sala." }),
      );
      await call.join({ url: destino.url, token: destino.token });
      setEstado({ tipo: "en-vivo" });
    } catch (e) {
      const permiso = e instanceof DOMException && e.name === "NotAllowedError";
      setEstado({
        tipo: "fuera",
        motivo: permiso
          ? "El celular no dio permiso para usar la cámara. Actívalo en los ajustes del navegador y vuelve a escanear."
          : "No pudimos conectar el celular. Vuelve a escanear el QR de la sala.",
      });
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-black text-white">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="min-h-0 w-full flex-1 object-contain"
      />
      <div className="flex flex-col gap-3 p-4 text-center">
        {estado.tipo === "listo" ? (
          <>
            <p className="text-sm text-white/80">
              Apunta la cámara trasera a tu hoja. El alumno la verá en grande; el
              celular no manda sonido.
            </p>
            <Button size="lg" onClick={() => void empezar()}>
              Conectar cámara
            </Button>
          </>
        ) : null}
        {estado.tipo === "conectando" ? <p className="text-sm">Conectando…</p> : null}
        {estado.tipo === "en-vivo" ? (
          <>
            <p className="text-sm">
              <span className="mr-1.5 inline-block size-2 rounded-full bg-red-500" aria-hidden />
              En la clase. Deja esta pantalla abierta.
            </p>
            <Button variant="secondary" onClick={() => void callRef.current?.leave()}>
              Desconectar
            </Button>
          </>
        ) : null}
        {estado.tipo === "fuera" ? <p className="text-sm text-white/80">{estado.motivo}</p> : null}
      </div>
    </div>
  );
}
