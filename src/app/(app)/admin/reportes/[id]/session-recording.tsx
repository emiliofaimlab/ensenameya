"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * EY-189 · «Ver la grabación» de una clase, desde la ficha del reporte.
 *
 * ── LO PRIMERO, PORQUE CAMBIA CÓMO SE LEE TODO LO DEMÁS ─────────────────────
 * La grabación de Daily **existe de verdad** y esta pantalla la sirve: el add-on
 * está activo en la cuenta (comprobado el 31-ago contra `GET /recordings`, dos
 * ficheros grabados el 14-ago) y `/api/recordings/[sessionId]` devuelve un
 * enlace firmado a un admin, porque `sessions_select_admin` existe desde EP-06.
 * Si algún comentario del repo dice que «el add-on no está contratado y hoy no
 * hay nada que borrar», está desactualizado.
 *
 * ── PERO CASI SIEMPRE NO HABRÁ NADA, Y ESE ES EL PUNTO DEL COMPONENTE ───────
 * ⚠️ CAMBIÓ LA REGLA (2-sep): TODAS las clases se graban. Antes era el sí de
 * los dos (RN-42); ahora `recording_allowed` devuelve true siempre y la
 * casilla de la sala es un «Entiendo», no un permiso. Así que llegar aquí sin
 * grabación ya no habla de consentimiento, sino de que no hubo sesión. Y
 * sin ese consentimiento la sala ni ofrece el botón. O sea: lo normal es que la
 * respuesta sea «esta clase no se grabó», y además hay tres formas distintas de
 * no tener vídeo —nadie entró a la sala, nadie consintió, o caducaron los 30
 * días— que el admin necesita distinguir para saber si el rastro se perdió o
 * nunca existió.
 *
 * Por eso NO se pinta un enlace directo. Un `<a href>` que casi siempre lleva a
 * un 404 es peor que no tener botón: enseña a desconfiar de la pantalla. Aquí se
 * pregunta al pulsar y se contesta con la verdad concreta de este caso.
 *
 * ⚠️ Y el enlace no se guarda en ningún sitio. Daily lo firma con caducidad
 * corta —mismo criterio que los meeting-tokens y que las URLs de Storage—, así
 * que cachearlo entre renders solo serviría para servir un enlace muerto.
 */

/** Lo que sabemos ahora mismo de la grabación de ESTA sesión. */
type Estado =
  | { tipo: "sin-preguntar" }
  | { tipo: "buscando" }
  | { tipo: "lista"; url: string; duracionSegs: number | null }
  | { tipo: "nada"; texto: string };

/** Segundos → «3 min 12 s», que es como se lee la duración de una clase. */
function duracion(segs: number): string {
  const min = Math.floor(segs / 60);
  const resto = segs % 60;
  return min > 0 ? `${min} min ${resto} s` : `${resto} s`;
}

export function SessionRecording({
  sessionId,
  /** `false` = nadie llegó a abrir la sala; ver `ReportSession.hasRoom`. */
  hasRoom,
  /** RN-42: si la purga ya pasó por esta sesión, no hay nada que pedir. */
  purgedAt,
}: {
  sessionId: string;
  hasRoom: boolean;
  purgedAt: string | null;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "sin-preguntar" });

  // Los dos casos que se saben SIN llamar a nadie. Se resuelven aquí y no en el
  // servidor de la ruta porque ahorran un viaje entero y, sobre todo, porque
  // así el admin lee el porqué en lugar de un botón que no hace nada.
  if (purgedAt) {
    return (
      <span className="text-xs text-[#6b6b6b]">
        Grabación borrada (retención de 30 días).
      </span>
    );
  }
  if (!hasRoom) {
    return (
      <span className="text-xs text-[#6b6b6b]">
        Nadie abrió la sala: no hay grabación.
      </span>
    );
  }

  async function buscar() {
    setEstado({ tipo: "buscando" });
    try {
      const res = await fetch(`/api/recordings/${sessionId}`);
      // 410 y 404 traen cuerpo JSON igualmente; el `catch` es por si un proxy
      // se cuela con HTML delante (pasa con la protección de despliegue).
      const body = (await res.json().catch(() => null)) as {
        status?: string;
        url?: string;
        durationSecs?: number;
        simulated?: boolean;
      } | null;

      if (res.status === 404) {
        setEstado({
          tipo: "nada",
          texto: "La sesión ya no existe o no es visible.",
        });
        return;
      }
      if (res.status === 410 || body?.status === "expired") {
        setEstado({
          tipo: "nada",
          texto:
            "La grabación caducó: se sirven 30 días desde que termina la clase (RN-42).",
        });
        return;
      }
      if (body?.status === "ready" && body.url) {
        setEstado({
          tipo: "lista",
          url: body.url,
          duracionSegs: body.durationSecs ?? null,
        });
        return;
      }
      if (body?.status === "none") {
        setEstado({
          tipo: "nada",
          // El motivo importa: no es un fallo, es que la clase no se grabó. Y
          // se dice por qué, porque «no hay grabación» a secas suena a error.
          texto:
            // Desde el 2-sep todas las clases se graban, así que llegar aquí ya
            // no significa «no consintieron»: significa que no hubo clase que
            // grabar —nadie llegó a entrar en la sala— o que Daily no la
            // guardó. Decir «no consintieron» mandaría a buscar un permiso que
            // ya no existe.
            "Esta clase no tiene grabación: no llegó a haber sesión en la sala.",
        });
        return;
      }
      if (body?.simulated) {
        setEstado({
          tipo: "nada",
          texto:
            "Este entorno no tiene proveedor de vídeo configurado: la sala va simulada y no graba.",
        });
        return;
      }
      setEstado({
        tipo: "nada",
        texto: "El proveedor no devolvió el enlace. Vuelve a intentarlo.",
      });
    } catch {
      // Un fallo de red no se disfraza de «no hay grabación»: son cosas
      // distintas y solo una de las dos se arregla reintentando.
      setEstado({
        tipo: "nada",
        texto: "No se pudo consultar al proveedor. Vuelve a intentarlo.",
      });
    }
  }

  if (estado.tipo === "lista") {
    return (
      <a
        href={estado.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-semibold text-brand hover:underline"
      >
        Abrir la grabación
        {estado.duracionSegs ? ` (${duracion(estado.duracionSegs)})` : ""} ↗
      </a>
    );
  }

  if (estado.tipo === "nada") {
    return <span className="text-xs text-[#6b6b6b]">{estado.texto}</span>;
  }

  return (
    <Button
      variant="outline"
      className="h-8 rounded-[8px] px-3 text-xs text-[#595959]"
      disabled={estado.tipo === "buscando"}
      onClick={() => void buscar()}
    >
      {estado.tipo === "buscando" ? "Buscando…" : "Ver la grabación"}
    </Button>
  );
}
