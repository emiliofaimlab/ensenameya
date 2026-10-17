"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Lo que devuelve `horarios_libres_del_tutor` (ISO UTC, cada 30 min). */
type Slot = { slot_start: string; slot_end: string };

/** Días con horarios que se ven antes de pulsar «Ver más días». */
const DIAS_VISIBLES = 7;

/**
 * Un instante como lo escriben los `<input type="date|time">`, en la zona del
 * tutor. Mismo patrón que `minimoReagenda` en `clases-grupales/[id]/acciones.tsx`.
 */
function aPared(iso: string, timezone: string): { fecha: string; hora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/**
 * M18 · publicar una grupal ya no es a ciegas: sobre los inputs de fecha se
 * pintan los horarios libres del tutor —su disponibilidad, sin los días
 * bloqueados ni las clases ya vendidas—, que salen de la MISMA lógica que
 * `get_available_slots`, pero sin producto. Tocar uno rellena una fila; los
 * inputs manuales se quedan para lo que no esté en la agenda.
 *
 * `publicar_clase_grupal` sigue siendo quien manda: esto orienta, no reserva.
 */
export function HorariosLibres({
  duracion,
  timezone,
  elegidas,
  onElegir,
  lleno,
}: {
  duracion: number;
  timezone: string;
  /** ISO UTC de las fechas ya tecleadas */
  elegidas: string[];
  onElegir: (f: { fecha: string; hora: string }) => void;
  /** ya hay MAX_FECHAS */
  lleno: boolean;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState(false);
  const [todos, setTodos] = useState(false);
  // El selector cubre clases de 30 min a 4 h (el tope de la RPC): fuera de ahí
  // se dice, en vez de enseñar un «no pudimos cargar» que no es verdad.
  const valida = Number.isInteger(duracion) && duracion >= 30 && duracion <= 240;
  const larga = Number.isInteger(duracion) && duracion > 240;

  useEffect(() => {
    // Con el campo a medio escribir («9») no se pregunta: la RPC lo rechazaría.
    if (!valida) return;
    let vivo = true;
    // Cast acotado a ESTA RPC: su tipo llega con `db:types` tras la migración
    // del lote 9. Cuando esté, sobra.
    const supabase = createClient() as unknown as {
      rpc: (
        fn: "horarios_libres_del_tutor",
        args: { p_duracion: number },
      ) => PromiseLike<{ data: Slot[] | null; error: { message: string } | null }>;
    };
    supabase
      .rpc("horarios_libres_del_tutor", { p_duracion: duracion })
      .then(({ data, error }) => {
        if (!vivo) return;
        // Regla 10 · el fallo NO se convierte en «no tienes horarios».
        setError(!!error);
        setSlots(error ? null : (data ?? []));
      });
    return () => {
      vivo = false;
    };
  }, [duracion, valida]);

  if (larga)
    return (
      <p className="text-xs text-[#6b6b6b]">
        El selector muestra clases de hasta 4 horas. Escribe las fechas abajo.
      </p>
    );
  if (!valida) return null;

  if (error)
    return (
      <p className="text-xs text-[#bf3333]">
        No pudimos cargar tus horarios libres. Puedes escribir las fechas a mano.
      </p>
    );

  if (!slots)
    return <p className="text-xs text-[#6b6b6b]">Cargando tus horarios libres…</p>;

  if (slots.length === 0)
    return (
      <p className="text-xs text-[#6b6b6b]">
        No tienes horarios libres en las próximas 6 semanas.{" "}
        <Link
          href="/tutor/availability"
          className="font-medium text-brand underline underline-offset-2"
        >
          Revisa tu disponibilidad
        </Link>
      </p>
    );

  // Agrupados por día EN LA ZONA DEL TUTOR, no en UTC: una clase a las 21:00
  // de Lima es del mismo día aunque en UTC ya sea mañana.
  const dias = new Map<string, Slot[]>();
  for (const s of slots) {
    const clave = new Date(s.slot_start).toLocaleDateString("en-CA", {
      timeZone: timezone,
    });
    dias.set(clave, [...(dias.get(clave) ?? []), s]);
  }
  const lista = [...dias.values()];
  const visibles = todos ? lista : lista.slice(0, DIAS_VISIBLES);

  const ms = duracion * 60_000;
  const elegidasMs = elegidas.map((iso) => new Date(iso).getTime());
  /** Solapa una fecha ya elegida: [inicio, inicio + duración). */
  const ocupado = (iso: string) => {
    const t = new Date(iso).getTime();
    return elegidasMs.some((e) => t < e + ms && e < t + ms);
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs text-[#6b6b6b]">
        Tus horarios libres, ya sin los días bloqueados ni las clases vendidas.
        Toca uno para agregarlo, o escribe la fecha abajo.
      </p>
      <div className="grid gap-2">
        {visibles.map((ss) => (
          <div
            key={ss[0].slot_start}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="w-24 shrink-0 text-xs font-medium text-[#333333] first-letter:uppercase">
              {new Date(ss[0].slot_start).toLocaleDateString("es", {
                weekday: "short",
                day: "numeric",
                month: "short",
                timeZone: timezone,
              })}
            </span>
            {ss.map((s) => {
              const marcado = ocupado(s.slot_start);
              return (
                <Button
                  key={s.slot_start}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={marcado || lleno}
                  aria-pressed={marcado}
                  onClick={() => onElegir(aPared(s.slot_start, timezone))}
                  className={cn(
                    "h-8 rounded-[8px] px-2.5 text-[13px]",
                    marcado && "border-brand bg-brand text-white disabled:opacity-100",
                  )}
                >
                  {aPared(s.slot_start, timezone).hora}
                </Button>
              );
            })}
          </div>
        ))}
      </div>
      {!todos && lista.length > DIAS_VISIBLES ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setTodos(true)}
          className="h-8 self-start rounded-[8px] px-2.5 text-[13px] text-brand"
        >
          Ver más días
        </Button>
      ) : null}
    </div>
  );
}
