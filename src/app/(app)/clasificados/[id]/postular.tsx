"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { enFranjas, franjasLabel, zonaLabel, type Franja } from "@/lib/clasificados";
import { opcionesDeHora, type FormatoHora } from "@/lib/hora";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Clasificados · el formulario de POSTULACIÓN del tutor.
 *
 * Mismo patrón de día + hora que `components/chat/propuesta-de-clase.tsx`, con
 * un filtro más: solo se ofrecen los huecos que caben ENTEROS en las franjas
 * del alumno (`enFranjas`, réplica de `clasificado_admite`) y antes de que el
 * clasificado venza. Quien decide es `postular_a_clasificado`; su error se
 * enseña tal cual, que ya viene en español.
 */

/** Los mismos 30 días que valida `create_booking_line`. */
const DIAS = 30;
const MAX_NOTA = 200;

export type OfertaElegible = {
  id: string;
  title: string;
  session_duration_min: number | null;
};

const diaDe = (iso: string, tz?: string) =>
  new Date(iso).toLocaleDateString("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  });

const horaDe = (iso: string, formato: FormatoHora, tz?: string) =>
  new Date(iso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    ...opcionesDeHora(formato),
    timeZone: tz,
  });

export function Postular({
  requestId,
  ofertas,
  franjas,
  zonaAlumno,
  expiresAt,
  timeZone,
  formato,
  actual,
}: {
  requestId: string;
  ofertas: OfertaElegible[];
  franjas: Franja[];
  /** Zona IANA del alumno: en ella viven las franjas. */
  zonaAlumno: string;
  expiresAt: string;
  /** Zona de quien mira: en ella se pintan los huecos. */
  timeZone: string;
  formato: FormatoHora;
  /** La postulación viva, si la hay: el formulario la sustituye. */
  actual: { productId: string; note: string } | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ofertaId, setOfertaId] = useState(
    actual && ofertas.some((o) => o.id === actual.productId) ? actual.productId : (ofertas[0]?.id ?? ""),
  );
  const [huecos, setHuecos] = useState<string[] | null>(null);
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");
  const [nota, setNota] = useState(actual?.note ?? "");

  async function cargarHuecos(productId: string) {
    setHuecos(null);
    setDia("");
    setHora("");
    if (!productId) return;
    const duracion = ofertas.find((o) => o.id === productId)?.session_duration_min ?? 60;
    const hasta = new Date(Date.now() + DIAS * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await createClient().rpc("get_available_slots", {
      p_product_id: productId,
      p_to: hasta,
    });
    if (error) {
      toast.error("No se pudieron cargar tus horarios.");
      setHuecos([]);
      return;
    }
    const vence = Date.parse(expiresAt);
    const lista = (data ?? [])
      .map((h) => h.slot_start)
      .filter((h) => Date.parse(h) < vence && enFranjas(h, franjas, zonaAlumno, duracion));
    setHuecos(lista);
    const primero = lista[0];
    if (primero) {
      setDia(diaDe(primero, timeZone));
      setHora(primero);
    }
  }

  function abrir() {
    setAbierto(true);
    void cargarHuecos(ofertaId);
  }

  async function enviar() {
    const texto = nota.trim();
    if (!ofertaId || !hora || !texto) return;
    setBusy(true);
    const { error } = await createClient().rpc("postular_a_clasificado", {
      p_request: requestId,
      p_product: ofertaId,
      p_start: hora,
      p_note: texto,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo enviar la postulación.");
      return;
    }
    toast.success(
      actual
        ? "Postulación actualizada. El alumno verá la nueva propuesta en el chat."
        : "Postulación enviada. El alumno la verá en el chat con su botón de pago.",
    );
    setAbierto(false);
    router.refresh();
  }

  if (!abierto) {
    return (
      <Button type="button" className="w-fit" variant={actual ? "outline" : "default"} onClick={abrir}>
        <SendIcon aria-hidden />
        {actual ? "Cambiar mi postulación" : "Postular a este clasificado"}
      </Button>
    );
  }

  const dias = huecos ? [...new Set(huecos.map((h) => diaDe(h, timeZone)))] : [];
  const horasDelDia = huecos ? huecos.filter((h) => diaDe(h, timeZone) === dia) : [];
  const select =
    "h-9 w-full rounded-[8px] border border-[#e0e0e0] bg-muted px-2.5 text-[13px] first-letter:uppercase";

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-[15px] font-semibold">
        {actual ? "Cambiar mi postulación" : "Postular a este clasificado"}
      </p>
      {actual ? (
        <p className="text-muted-foreground">
          La nueva propuesta sustituye a la anterior en el chat.
        </p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Mentoría</span>
        <select
          className={select}
          value={ofertaId}
          onChange={(e) => {
            setOfertaId(e.target.value);
            void cargarHuecos(e.target.value);
          }}
        >
          {ofertas.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </label>

      {huecos === null ? (
        <p className="text-muted-foreground">Cargando tus horarios…</p>
      ) : huecos.length === 0 ? (
        <p className="rounded-[8px] bg-muted p-3 text-muted-foreground">
          Ninguno de tus horarios libres de los próximos {DIAS} días cae dentro de las franjas del
          alumno ({franjasLabel(franjas)}, {zonaLabel(zonaAlumno)}). Amplía tu disponibilidad en
          esos días y horas para poder postular.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Día</span>
            <select
              className={select}
              value={dia}
              onChange={(e) => {
                setDia(e.target.value);
                setHora(huecos.find((h) => diaDe(h, timeZone) === e.target.value) ?? "");
              }}
            >
              {dias.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Hora (la tuya)</span>
            <select className={select} value={hora} onChange={(e) => setHora(e.target.value)}>
              {horasDelDia.map((h) => (
                <option key={h} value={h}>
                  {horaDe(h, formato, timeZone)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Mensaje para el alumno</span>
        <Textarea
          value={nota}
          maxLength={MAX_NOTA}
          rows={3}
          placeholder="Cuéntale en dos líneas cómo lo ayudarías."
          onChange={(e) => setNota(e.target.value)}
        />
        <span className="flex justify-between gap-2 text-[12px] text-muted-foreground">
          <span>Sin teléfonos ni correos: el contacto va por el chat de la plataforma.</span>
          <span className="shrink-0 tabular-nums">
            {nota.length}/{MAX_NOTA}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-9 rounded-[8px] px-4 text-[13px] font-semibold"
          disabled={busy || !ofertaId || !hora || !nota.trim()}
          onClick={enviar}
        >
          {actual ? "Enviar la nueva postulación" : "Enviar postulación"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 rounded-[8px] px-3 text-[13px]"
          disabled={busy}
          onClick={() => setAbierto(false)}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
