"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { paredAUtc } from "@/lib/availability";
import { PanelCard } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FIELD = "h-10 rounded-[8px] px-3 text-sm";

/**
 * M15 · el primer día y la primera hora que acepta una reagenda (ahora + 24 h),
 * como los escriben los `<input type="date|time">`, en la zona del tutor. Se
 * calcula al abrir el formulario, no al pintar la página: así no se queda viejo
 * y no hay desajuste de hidratación.
 */
function minimoReagenda(timezone: string): { fecha: string; hora: string } {
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
      .formatToParts(new Date(Date.now() + 24 * 3_600_000))
      .map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/**
 * Las acciones de una fecha: reagendarla (RG-11) y, en un ciclo, cancelarla
 * mientras no haya empezado, aunque sea la última que queda (RG-16, A10). Cada una abre su propio paso de
 * confirmación en la página: `confirm()` no existe en todos los navegadores
 * donde se abre esto.
 */
export function FechaAcciones({
  groupClassId,
  reagendable,
  timezone,
  inscritos,
  puedeCancelar,
}: {
  groupClassId: string;
  /** RG-11 · faltan 24 h o más para la hora PROGRAMADA (lo vuelve a mirar la RPC). */
  reagendable: boolean;
  timezone: string;
  /** M15 · reservas vivas de la clase: a quién avisa la reagenda. */
  inscritos: number;
  puedeCancelar: boolean;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"nada" | "reagendar" | "cancelar">("nada");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [minimo, setMinimo] = useState({ fecha: "", hora: "" });

  async function reagendar() {
    if (!fecha || !hora) return toast.error("Elige el día y la hora nuevos.");
    const nuevo = paredAUtc(fecha, hora, timezone);
    // Aviso temprano; la regla la vuelve a mirar la RPC con el mismo texto.
    if (new Date(nuevo).getTime() < Date.now() + 24 * 3_600_000)
      return toast.error("La hora nueva tiene que estar al menos a 24 horas.");
    setEnviando(true);
    const { error } = await createClient().rpc("reagendar_clase_grupal", {
      p_group_class: groupClassId,
      p_nuevo_inicio: nuevo,
    });
    setEnviando(false);
    if (error) return toast.error(error.message);
    toast.success("Fecha movida. Los inscritos pueden darse de baja con el 100 % si no les sirve.");
    setModo("nada");
    router.refresh();
  }

  async function cancelar() {
    setEnviando(true);
    const { error } = await createClient().rpc("cancelar_fecha_grupal", {
      p_group_class: groupClassId,
    });
    setEnviando(false);
    if (error) return toast.error(error.message);
    toast.success("Fecha cancelada. Cada inscrito recupera lo que costaba esa fecha.");
    setModo("nada");
    router.refresh();
  }

  if (modo === "reagendar")
    return (
      <div className="flex w-full flex-col gap-1.5 sm:w-auto">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" min={minimo.fecha} value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Día nuevo" className={FIELD} />
          {/* La hora solo tiene tope si el día es el primero posible. */}
          <Input
            type="time"
            step={300}
            min={fecha === minimo.fecha ? minimo.hora : undefined}
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            aria-label="Hora nueva"
            className={`${FIELD} w-28`}
          />
          <Button type="button" onClick={reagendar} disabled={enviando} className="h-10">
            {enviando ? "Moviendo…" : "Mover fecha"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setModo("nada")} className="h-10">
            Volver
          </Button>
        </div>
        <p className="text-xs text-[#6b6b6b]">
          {inscritos > 0
            ? `Se avisará a ${inscritos} ${inscritos === 1 ? "inscrito" : "inscritos"}.`
            : "Todavía no hay inscritos a quien avisar."}{" "}
          La hora nueva tiene que estar al menos a 24 horas.
        </p>
      </div>
    );

  if (modo === "cancelar")
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] text-[#a82929]">Se reembolsa esta fecha a cada inscrito.</p>
        <Button type="button" variant="destructive" onClick={cancelar} disabled={enviando} className="h-10">
          {enviando ? "Cancelando…" : "Sí, cancelar la fecha"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setModo("nada")} className="h-10">
          Volver
        </Button>
      </div>
    );

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={!reagendable}
        title={reagendable ? undefined : "Solo se reagenda con 24 horas de anticipación."}
        onClick={() => {
          setMinimo(minimoReagenda(timezone));
          setModo("reagendar");
        }}
        className="h-9"
      >
        Reagendar
      </Button>
      {puedeCancelar ? (
        <Button type="button" variant="ghost" onClick={() => setModo("cancelar")} className="h-9 text-[#bf3333]">
          Cancelar fecha
        </Button>
      ) : null}
    </div>
  );
}

/** RG-10 · cancelar la clase entera, antes de que empiece: 100 % a todos. */
export function CancelarClase({ productId, inscritos }: { productId: string; inscritos: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function cancelar() {
    setEnviando(true);
    const { error } = await createClient().rpc("cancelar_clase_grupal", {
      p_product: productId,
      p_motivo: motivo.trim() || undefined,
    });
    setEnviando(false);
    if (error) return toast.error(error.message);
    toast.success("Clase cancelada. Los inscritos recuperan el 100 %.");
    router.push("/tutor/products");
    router.refresh();
  }

  return (
    <PanelCard className="flex flex-col gap-3 border-[#f2c9c9]">
      <h2 className="text-base font-semibold text-[#19191f]">Cancelar la clase</h2>
      <p className="text-[13px] text-[#6b6b6b]">
        {inscritos > 0
          ? `${inscritos === 1 ? "El inscrito recupera" : `Los ${inscritos} inscritos recuperan`} el 100 % de lo que pagó${inscritos === 1 ? "" : "n"}. La clase deja de publicarse.`
          : "Todavía no hay inscritos. La clase deja de publicarse."}
      </p>
      {abierto ? (
        <div className="flex flex-col gap-2">
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            placeholder="Motivo (opcional): se guarda con la cancelación"
            aria-label="Motivo de la cancelación"
            className={FIELD}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={cancelar} disabled={enviando} className="h-10">
              {enviando ? "Cancelando…" : "Sí, cancelar la clase"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAbierto(false)} className="h-10">
              Volver
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={() => setAbierto(true)} className="h-10 self-start text-[#bf3333]">
          Cancelar la clase
        </Button>
      )}
    </PanelCard>
  );
}
