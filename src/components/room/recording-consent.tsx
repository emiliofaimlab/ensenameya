"use client";

import { useState } from "react";
import { toast } from "sonner";
import { VideoIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/**
 * El aviso de grabación, ANTES de entrar a la sala.
 *
 * ⚠️ **CAMBIÓ DE NATURALEZA, Y EL NOMBRE DEL FICHERO SE QUEDÓ VIEJO.** Hasta el
 * 28-ago esto era el consentimiento de RN-42/US-1801: se PEDÍA permiso, hacía
 * falta el sí de los dos y sin él no se grababa; de ahí venían el estado del
 * otro participante y el «falta que el tutor acepte». El cliente decidió lo
 * contrario: la mentoría **se graba siempre**, no se pregunta — se informa. Así
 * que la casilla ya no es un permiso sino un «Entiendo» de términos y
 * condiciones, y es OBLIGATORIA: mientras no esté marcada, el botón de entrar a
 * la sala queda deshabilitado (ver `live-room.tsx`).
 *
 * Lo que NO cambia es dónde se guarda: sigue siendo `session_recording_consents`,
 * una fila por participante. Reusar la tabla en vez de estrenar esquema no es
 * pereza — el rastro de haber informado vale MÁS ahora que cuando era un
 * permiso, y esa tabla ya tiene su RLS ajustada («cada uno marca por sí mismo»,
 * `20260729220000`), que es exactamente la garantía que hace falta para que el
 * rastro signifique algo.
 *
 * La fila SIGUE SIENDO el registro: marcar inserta, desmarcar borra. Sin
 * booleano intermedio. Y como no se puede entrar sin la casilla puesta, todo el
 * que llegó a la sala dejó su fila.
 *
 * ⚠️ Lo que esta casilla ya NO decide es si Daily graba: eso lo sigue mirando
 * `recording_allowed()` desde `/api/room/[sessionId]`, que exige las dos filas.
 * No se ha tocado a propósito — el add-on de grabación de Daily no está
 * contratado y encenderlo a ciegas haría fallar la creación de la sala, o sea
 * dejar a todo el mundo fuera por un texto. Cuando se contrate, ése es el sitio.
 */
export function RecordingConsent({
  sessionId,
  userId,
  marcado,
  onChange,
}: {
  sessionId: string;
  userId: string;
  /** ¿ya hay fila suya? Lo resuelve la página en servidor. */
  marcado: boolean;
  /** Avisa al padre, que es quien habilita el botón de entrar. */
  onChange: (marcado: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    const supabase = createClient();
    const { error } = next
      ? await supabase
          .from("session_recording_consents")
          .insert({ session_id: sessionId, user_id: userId })
      : await supabase
          .from("session_recording_consents")
          .delete()
          .eq("session_id", sessionId)
          .eq("user_id", userId);
    setBusy(false);

    if (error) {
      toast.error("No se pudo guardar tu respuesta.");
      return;
    }
    onChange(next);
  }

  return (
    <div className="rounded-lg border p-4 text-left">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <VideoIcon className="size-4 text-muted-foreground" />
        Esta mentoría se graba
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        La sesión queda grabada de principio a fin. La grabación está disponible
        para ti y para la otra persona durante 30 días, y después se borra.
      </p>
      <label className="mt-3 flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={marcado}
          disabled={busy}
          onChange={(e) => toggle(e.target.checked)}
          className="mt-0.5 size-[18px] shrink-0 rounded-[5px] border-input accent-primary"
        />
        {/* El texto de la casilla es lo que se acepta, así que dice
            exactamente eso y no «acepto que se grabe»: no hay nada que
            aceptar, la grabación no depende de esta casilla. */}
        <span>
          Entiendo que esta mentoría será grabada y acepto los{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-2"
          >
            términos del servicio
          </a>
          .
        </span>
      </label>
      {!marcado ? (
        // El «por qué no puedo entrar» pegado a la casilla y no junto al botón:
        // el botón está deshabilitado, así que no puede explicarse solo.
        <p className="mt-2 text-xs text-muted-foreground">
          Marca la casilla para poder entrar a la sala.
        </p>
      ) : null}
    </div>
  );
}
