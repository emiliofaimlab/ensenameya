"use client";

import { useEffect, useState } from "react";
import { ClockIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * D-2 (§20.14) · CUÁNTO LE QUEDA AL HORARIO RETENIDO.
 *
 * Desde que el formulario de pago se monta al llegar al checkout, la reserva se
 * crea al llegar también: el horario del tutor se retiene POR VISITA y no por
 * intención. El cliente aceptó ese coste con una condición explícita —«el
 * contador visible deja de ser deseable y pasa a ser obligatorio»—, y este
 * componente es esa condición. Sin él, quien abra el checkout y se lo piense
 * bloquea el hueco de otro sin enterarse, y quien tarde demasiado se encuentra
 * la reserva cancelada sin que nada se lo hubiera advertido.
 *
 * ⚠️ EL INSTANTE LO CALCULA EL SERVIDOR, no esta pantalla. Llega en
 * `retencionHasta` desde `/api/pagos/checkout`, que lo saca de
 * `bookings.created_at` + la ventana de `expire_stale_bookings`. Reconstruirlo
 * aquí a partir de «ahora» daría un contador que se reinicia en cada recarga —
 * o sea, un contador que miente justo en el caso que vino a cubrir.
 *
 * ⚠️ Y QUIEN CANCELA ES EL CRON, NO ESTE RELOJ. Llegar a 00:00 no cancela nada:
 * lo hace `expire_stale_bookings` dentro de Postgres, cada 5 minutos. Por eso
 * al agotarse no se dice «se canceló» —sería mentira durante hasta cinco
 * minutos, y el pago seguiría funcionando— sino que puede liberarse en
 * cualquier momento.
 */
export function HoldCountdown({
  hasta,
  className,
}: {
  /** ISO del instante en que el horario deja de estar prometido. */
  hasta: string | null;
  className?: string;
}) {
  /**
   * Arranca en `null` A PROPÓSITO y no en `Date.now()`: este componente se
   * renderiza también en el servidor y de `now` sale QUÉ rama se pinta
   * (contando / agotado). Si el SSR cae a un lado del umbral y la hidratación
   * al otro, no cambia un texto: cambia el marcado, que es el React #418. Con
   * `null` el servidor y el primer render del cliente pintan lo mismo y el
   * reloj entra en el efecto de montaje. Mismo patrón que la sala en vivo.
   */
  const [ahora, setAhora] = useState<number | null>(null);

  useEffect(() => {
    // La primera puesta en hora va en un `setTimeout(…, 0)` en vez de un
    // `setNow` directo dentro del efecto: así el contador aparece sin esperar
    // el primer segundo y sin el render en cascada que `react-hooks` marca.
    const enHora = () => setAhora(Date.now());
    const primera = setTimeout(enHora, 0);
    const id = setInterval(enHora, 1000);
    return () => {
      clearTimeout(primera);
      clearInterval(id);
    };
  }, []);

  const limite = hasta ? Date.parse(hasta) : Number.NaN;
  // Sin instante legible no se pinta NADA. Un contador es una promesa con un
  // número dentro: sin el dato del servidor, la promesa sería inventada.
  if (!Number.isFinite(limite)) return null;

  const restante = ahora === null ? null : limite - ahora;
  const agotado = restante !== null && restante <= 0;
  // Cinco minutos: es la periodicidad del cron que cancela, o sea el primer
  // tramo en el que perder el horario deja de ser teórico.
  const urgente = restante !== null && restante > 0 && restante <= 5 * 60_000;

  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-[12.5px]",
        agotado || urgente
          ? "bg-warning-muted text-warning"
          : "bg-muted text-[#4b4b4b]",
        className,
      )}
      // `aria-live` y no `role="timer"`: lo que importa que se anuncie es el
      // cambio de estado (queda poco / se agotó), no cada segundo. `polite`
      // deja que el lector termine lo que estuviera diciendo.
      aria-live="polite"
    >
      <ClockIcon className="mt-px size-3.5 shrink-0" />
      {agotado ? (
        <span>
          Se acabó el tiempo de espera: este horario puede quedar libre en
          cualquier momento. Completa el pago cuanto antes.
        </span>
      ) : (
        <span>
          Te guardamos este horario{" "}
          {/* El texto del reloj sí cambia entre servidor y cliente —el
              servidor no sabe qué hora es donde está el alumno— y ese caso sí
              lo cubre `suppressHydrationWarning`, que silencia el texto de
              ESTE nodo y de ningún otro. */}
          <strong className="font-semibold" suppressHydrationWarning>
            {restante === null ? "unos minutos" : reloj(restante)}
          </strong>{" "}
          mientras terminas el pago.
        </span>
      )}
    </p>
  );
}

/** ms → "09:41". Nunca más de 20 minutos, así que no hace falta tramo de horas. */
function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
