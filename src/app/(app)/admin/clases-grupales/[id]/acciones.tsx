"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FIELD = "h-10 rounded-[8px] px-3 text-sm";

/** «1 inscrito» / «3 inscritos»: el «inscrito(s)» de antes se leía a medias. */
const inscritosTxt = (n: number) => `${n} ${n === 1 ? "inscrito" : "inscritos"}`;

/**
 * P22 · la confirmación en línea que sustituye a los `window.prompt`: el botón
 * abre la consecuencia, el mensaje opcional y «Sí, …» / «Volver». Es el mismo
 * patrón que `CancelarClase` en la ficha del tutor; `prompt()` no existe en
 * todos los navegadores donde se abre esto y no deja leer lo que se escribe.
 * Un mensaje vacío viaja como `undefined`: la RPC pone su motivo por defecto.
 */
function Confirmacion({
  boton,
  consecuencia,
  placeholder,
  confirmar,
  enviando,
  pequeno,
  neutro,
  onConfirmar,
}: {
  boton: string;
  consecuencia: string;
  placeholder: string;
  confirmar: string;
  enviando: boolean;
  /** `size="sm"`, para los que viven dentro de una fila o una tabla. */
  pequeno?: boolean;
  /** El botón de entrada sin el rojo (sacar a uno no es cancelar la clase). */
  neutro?: boolean;
  onConfirmar: (motivo: string | undefined) => Promise<boolean>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");

  if (!abierto)
    return (
      <Button
        type="button"
        size={pequeno ? "sm" : "default"}
        variant="outline"
        className={neutro ? undefined : "text-[#bf3333]"}
        disabled={enviando}
        onClick={() => setAbierto(true)}
      >
        {boton}
      </Button>
    );

  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <p className="text-[12.5px] text-[#a82929]">{consecuencia}</p>
      <Input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        maxLength={300}
        placeholder={placeholder}
        aria-label={placeholder.split(" (opcional)")[0]}
        className={FIELD}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={enviando}
          onClick={async () => {
            if (await onConfirmar(motivo.trim() || undefined)) setAbierto(false);
          }}
          className="h-10"
        >
          {enviando ? "Un momento…" : confirmar}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)} className="h-10">
          Volver
        </Button>
      </div>
    </div>
  );
}

/** RG-10 · el admin cancela la clase entera: 100 % a todos (`cancelar_clase_grupal`). */
export function CancelarClaseAdmin({ productId, inscritos }: { productId: string; inscritos: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function cancelar(motivo: string | undefined) {
    setBusy(true);
    const { error } = await createClient().rpc("cancelar_clase_grupal", {
      p_product: productId,
      p_motivo: motivo,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo cancelar la clase.");
      return false;
    }
    toast.success("Clase cancelada. Los reembolsos quedaron en cola.");
    router.refresh();
    return true;
  }
  return (
    <Confirmacion
      boton="Cancelar la clase entera"
      consecuencia={
        inscritos > 0
          ? `Se cancela la clase entera y se devuelve el 100 % a ${inscritosTxt(inscritos)}.`
          : "Se cancela la clase entera. Todavía no hay inscritos."
      }
      placeholder="Mensaje para los inscritos (opcional): lo verán en el correo"
      confirmar="Sí, cancelar la clase"
      enviando={busy}
      onConfirmar={cancelar}
    />
  );
}

/**
 * G4 · saca a UN alumno (`admin_sacar_de_clase_grupal`). M1: antes de que
 * empiece el ciclo, el 100 %; con el ciclo empezado, solo la parte de las
 * fechas que faltan, y la reserva se completa en vez de cancelarse (el tutor
 * cobra lo que sí dio). `empezada` solo cambia el texto: decide la BD.
 */
export function SacarAlumno({
  bookingId,
  nombre,
  empezada,
}: {
  bookingId: string;
  nombre: string;
  empezada: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function sacar(motivo: string | undefined) {
    setBusy(true);
    const { error } = await createClient().rpc("admin_sacar_de_clase_grupal", {
      p_booking: bookingId,
      p_motivo: motivo,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo sacar al alumno.");
      return false;
    }
    toast.success(
      empezada
        ? "Alumno fuera de las fechas que faltan. Su reembolso quedó en cola."
        : "Cupo cancelado con el 100 %.",
    );
    router.refresh();
    return true;
  }
  return (
    <Confirmacion
      boton="Sacar"
      pequeno
      neutro
      consecuencia={
        empezada
          ? `El ciclo ya empezó: ${nombre} deja de estar en las fechas que faltan y recupera solo lo que costaban esas fechas.`
          : `Se cancela el cupo de ${nombre} con el 100 % de reembolso.`
      }
      placeholder="Mensaje para el alumno (opcional): lo verá en el correo"
      confirmar="Sí, sacarlo de la clase"
      enviando={busy}
      onConfirmar={sacar}
    />
  );
}

/**
 * A10 · el admin cancela UNA fecha (`cancelar_fecha_grupal`, que le deja pasar
 * por `has_role('admin')`): cada inscrito recupera lo que costaba esa fecha. Si
 * es la única que queda de una clase sin empezar, la RPC cancela la clase
 * entera con el 100 %.
 */
export function CancelarFechaAdmin({ groupClassId, inscritos }: { groupClassId: string; inscritos: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function cancelar(motivo: string | undefined) {
    setBusy(true);
    const { error } = await createClient().rpc("cancelar_fecha_grupal", {
      p_group_class: groupClassId,
      p_motivo: motivo,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo cancelar la fecha.");
      return false;
    }
    toast.success("Fecha cancelada. Los reembolsos quedaron en cola.");
    router.refresh();
    return true;
  }
  return (
    <Confirmacion
      boton="Cancelar fecha"
      pequeno
      consecuencia={
        inscritos === 0
          ? "Se cancela esta fecha. Todavía no hay inscritos."
          : inscritos === 1
            ? "Se cancela esta fecha y el inscrito recupera lo que costaba."
            : `Se cancela esta fecha y cada uno de los ${inscritosTxt(inscritos)} recupera lo que costaba.`
      }
      placeholder="Mensaje para los inscritos (opcional): lo verán en el correo"
      confirmar="Sí, cancelar la fecha"
      enviando={busy}
      onConfirmar={cancelar}
    />
  );
}
