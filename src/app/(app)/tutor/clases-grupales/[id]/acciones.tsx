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
 * Las acciones de una fecha: reagendarla (RG-11) y, en un ciclo con más de una
 * fecha pendiente, cancelarla (RG-16). Cada una abre su propio paso de
 * confirmación en la página: `confirm()` no existe en todos los navegadores
 * donde se abre esto.
 */
export function FechaAcciones({
  groupClassId,
  reagendable,
  timezone,
  puedeCancelar,
}: {
  groupClassId: string;
  /** RG-11 · faltan 24 h o más para la hora PROGRAMADA (lo vuelve a mirar la RPC). */
  reagendable: boolean;
  timezone: string;
  puedeCancelar: boolean;
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"nada" | "reagendar" | "cancelar">("nada");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function reagendar() {
    if (!fecha || !hora) return toast.error("Elige el día y la hora nuevos.");
    setEnviando(true);
    const { error } = await createClient().rpc("reagendar_clase_grupal", {
      p_group_class: groupClassId,
      p_nuevo_inicio: paredAUtc(fecha, hora, timezone),
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
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Día nuevo" className={FIELD} />
        <Input type="time" step={300} value={hora} onChange={(e) => setHora(e.target.value)} aria-label="Hora nueva" className={`${FIELD} w-28`} />
        <Button type="button" onClick={reagendar} disabled={enviando} className="h-10">
          {enviando ? "Moviendo…" : "Mover fecha"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setModo("nada")} className="h-10">
          Volver
        </Button>
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
        onClick={() => setModo("reagendar")}
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
