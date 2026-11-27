"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { enFranjas, franjasLabel, zonaLabel, type Franja } from "@/lib/clasificados";
import { opcionesDeHora, type FormatoHora } from "@/lib/hora";
import { BookingSelect } from "@/components/catalog/booking-select";
import { CalendarioMes, MES_VALIDO, mesDe, slotDay } from "@/components/catalog/calendario-mes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Clasificados · el formulario de POSTULACIÓN del tutor.
 *
 * 27-nov · día con el calendario mensual de la reserva (`CalendarioMes`) y hora
 * y mentoría con su desplegable (`BookingSelect`), igual que la ficha de
 * mentoría. Como allí, la elección vive en la URL (`?po=&pd=&ph=&pm=`): es como
 * funcionan esos dos componentes. Los huecos se piden aquí, con un filtro más: solo se ofrecen los huecos que caben ENTEROS en las franjas
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
  const pathname = usePathname();
  const params = useSearchParams();

  // La elección, en la URL. `po` = mentoría, `pd` = día, `ph` = hora, `pm` = mes.
  const poUrl = params.get("po");
  const ofertaId =
    poUrl && ofertas.some((o) => o.id === poUrl)
      ? poUrl
      : actual && ofertas.some((o) => o.id === actual.productId)
        ? actual.productId
        : (ofertas[0]?.id ?? "");
  const [abierto, setAbierto] = useState(params.has("po"));
  const [busy, setBusy] = useState(false);
  const [huecos, setHuecos] = useState<{ para: string; lista: string[] } | null>(null);
  const [nota, setNota] = useState(actual?.note ?? "");

  const href = (q: { po?: string; pd?: string; ph?: string; pm?: string }) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ po: ofertaId, ...q })) if (v) u.set(k, v);
    return `${pathname}?${u.toString()}#postular`;
  };

  // Los huecos de la mentoría elegida. Se piden al abrir y al cambiar de
  // mentoría; la lista sabe de qué mentoría es (`para`) para no pintar la vieja.
  useEffect(() => {
    if (!abierto || !ofertaId) return;
    let cancelado = false;
    const duracion = ofertas.find((o) => o.id === ofertaId)?.session_duration_min ?? 60;
    const hasta = new Date(Date.now() + DIAS * 86_400_000).toISOString().slice(0, 10);
    void createClient()
      .rpc("get_available_slots", { p_product_id: ofertaId, p_to: hasta })
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) toast.error("No se pudieron cargar tus horarios.");
        const vence = Date.parse(expiresAt);
        setHuecos({
          para: ofertaId,
          lista: (data ?? [])
            .map((h) => h.slot_start)
            .filter((h) => Date.parse(h) < vence && enFranjas(h, franjas, zonaAlumno, duracion)),
        });
      });
    return () => {
      cancelado = true;
    };
  }, [abierto, ofertaId, ofertas, expiresAt, franjas, zonaAlumno]);

  const lista = huecos?.para === ofertaId ? huecos.lista : null;
  const dias = new Set((lista ?? []).map((h) => slotDay(h, timeZone)));
  const primerDia = lista?.[0] ? slotDay(lista[0], timeZone) : undefined;
  const pdUrl = params.get("pd");
  const dia = pdUrl && dias.has(pdUrl) ? pdUrl : primerDia;
  const horasDelDia = (lista ?? []).filter((h) => slotDay(h, timeZone) === dia);
  const phUrl = params.get("ph");
  const hora = phUrl && horasDelDia.includes(phUrl) ? phUrl : "";
  const hoy = mesDe(slotDay(new Date().toISOString(), timeZone));
  const ultimo = lista?.length ? mesDe(slotDay(lista[lista.length - 1], timeZone)) : hoy;
  const pmUrl = params.get("pm");
  const mes =
    pmUrl && MES_VALIDO.test(pmUrl) && pmUrl >= hoy && pmUrl <= ultimo
      ? pmUrl
      : dia
        ? mesDe(dia)
        : hoy;

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
    router.replace(`${pathname}#postular`, { scroll: false });
    router.refresh();
  }

  if (!abierto) {
    return (
      <Button
        type="button"
        className="w-fit"
        variant={actual ? "outline" : "default"}
        onClick={() => setAbierto(true)}
      >
        <SendIcon aria-hidden />
        {actual ? "Cambiar mi postulación" : "Postular a este clasificado"}
      </Button>
    );
  }

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

      {ofertas.length > 1 ? (
        <div>
          <BookingSelect
            id="postular-mentoria"
            label="Mentoría"
            placeholder="Elige una mentoría"
            value={ofertaId}
            options={ofertas.map((o) => ({ value: o.id, label: o.title, href: href({ po: o.id }) }))}
          />
        </div>
      ) : (
        <p>
          <span className="text-muted-foreground">Mentoría: </span>
          <strong>{ofertas[0]?.title}</strong>
        </p>
      )}

      {lista === null ? (
        <p className="text-muted-foreground">Cargando tus horarios…</p>
      ) : lista.length === 0 ? (
        <p className="rounded-[8px] bg-muted p-3 text-muted-foreground">
          Ninguno de tus horarios libres de los próximos {DIAS} días cae dentro de las franjas del
          alumno ({franjasLabel(franjas)}, {zonaLabel(zonaAlumno)}). Amplía tu disponibilidad en
          esos días y horas para poder postular.
        </p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 sm:items-start">
          <div className="rounded-[12px] border border-[#e0e0e0] p-3">
            <CalendarioMes
              mes={mes}
              mesMinimo={hoy}
              mesTope={ultimo}
              diasLibres={dias}
              seleccionado={dia}
              hrefDia={(d) => href({ pd: d })}
              hrefMes={(m) => href({ pd: dia, ph: hora, pm: m })}
            />
          </div>
          <div>
            <BookingSelect
              id="postular-hora"
              label="Hora"
              hint="(la tuya)"
              placeholder="Elige una hora"
              value={hora}
              options={horasDelDia.map((h) => ({
                value: h,
                label: horaDe(h, formato, timeZone),
                href: href({ pd: dia, ph: h }),
              }))}
            />
          </div>
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
          onClick={() => {
            setAbierto(false);
            router.replace(`${pathname}#postular`, { scroll: false });
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
