"use client";

import { useEffect, useState } from "react";
import { CalendarCheckIcon, CalendarPlusIcon } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { bookingTotal, formatSessionTime } from "@/lib/booking";
import { opcionesDeHora, type FormatoHora } from "@/lib/hora";
import { Button } from "@/components/ui/button";
import { Precio } from "@/components/precio/precio";
import { asRpc } from "./rpc";

/**
 * Clasificados fase 1 · la PROPUESTA DE CLASE en el chat.
 *
 * Las reglas —quién propone, qué ofertas, qué horas, cuántas— las pone
 * `proponer_clase` (`20261124140000`); aquí solo se ofrece lo que pasaría y se
 * enseña el error de la BD tal cual, que ya viene en español. «Pagar» es un
 * `<a>` al checkout de siempre: el precio lo congela `create_booking` en el
 * servidor, nunca esta tarjeta.
 */

/** Los mismos 30 días que valida `create_booking_line`. */
const DIAS = 30;

type Oferta = {
  id: string;
  title: string;
  pricing_model: string;
  price_amount: number;
  currency: string;
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

/** Botón y formulario del TUTOR. */
export function ProponerClase({
  conversationId,
  tutorId,
  timeZone,
  formato,
}: {
  conversationId: string;
  tutorId: string;
  timeZone?: string;
  formato: FormatoHora;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ofertas, setOfertas] = useState<Oferta[] | null>(null);
  const [ofertaId, setOfertaId] = useState("");
  const [huecos, setHuecos] = useState<string[] | null>(null);
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");

  async function cargarHuecos(productId: string) {
    setHuecos(null);
    setDia("");
    setHora("");
    if (!productId) return;
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
    const lista = (data ?? []).map((h) => h.slot_start);
    setHuecos(lista);
    const primero = lista[0];
    if (primero) {
      setDia(diaDe(primero, timeZone));
      setHora(primero);
    }
  }

  async function abrir() {
    setAbierto(true);
    if (ofertas) return;
    setBusy(true);
    // Las mismas condiciones que exige `proponer_clase`: lo que no pasaría,
    // no se ofrece.
    const { data, error } = await createClient()
      .from("products")
      .select("id, title, pricing_model, price_amount, currency, session_duration_min")
      .eq("tutor_id", tutorId)
      .eq("status", "active")
      .eq("visibility", "public")
      .in("pricing_model", ["per_session", "per_hour"])
      .is("academy_id", null)
      .is("group_template_id", null)
      .order("title");
    setBusy(false);
    if (error) {
      toast.error("No se pudieron cargar tus mentorías.");
      setAbierto(false);
      return;
    }
    const lista = (data ?? []) as Oferta[];
    setOfertas(lista);
    if (lista[0]) {
      setOfertaId(lista[0].id);
      void cargarHuecos(lista[0].id);
    }
  }

  async function enviar() {
    if (!ofertaId || !hora) return;
    setBusy(true);
    const { error } = await asRpc(createClient()).rpc("proponer_clase", {
      p_conversation_id: conversationId,
      p_product_id: ofertaId,
      p_start: hora,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo enviar la propuesta.");
      return;
    }
    toast.success("Propuesta enviada. El alumno la verá en el chat con su botón de pago.");
    setAbierto(false);
    // El mensaje llega por Realtime (o por el sondeo del hilo).
  }

  if (!abierto) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-9 w-fit rounded-[8px] px-3.5 text-[13px]"
        onClick={abrir}
      >
        <CalendarPlusIcon aria-hidden />
        Proponer clase
      </Button>
    );
  }

  const dias = huecos ? [...new Set(huecos.map((h) => diaDe(h, timeZone)))] : [];
  const horasDelDia = huecos ? huecos.filter((h) => diaDe(h, timeZone) === dia) : [];
  const select =
    "h-9 w-full rounded-[8px] border border-[#e0e0e0] bg-muted px-2.5 text-[13px] first-letter:uppercase";

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border p-3 text-[13px]">
      <p className="font-semibold">Proponer una clase</p>
      {ofertas === null ? (
        <p className="text-muted-foreground">Cargando tus mentorías…</p>
      ) : ofertas.length === 0 ? (
        <p className="text-muted-foreground">
          No tienes mentorías 1:1 de una sesión activas y públicas para proponer.
        </p>
      ) : (
        <>
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
            <p className="text-muted-foreground">
              Esta mentoría no tiene horarios libres en los próximos {DIAS} días. Revisa tu
              disponibilidad.
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
                <span className="text-muted-foreground">Hora</span>
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
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-9 rounded-[8px] px-4 text-[13px] font-semibold"
          disabled={busy || !ofertaId || !hora}
          onClick={enviar}
        >
          Enviar propuesta
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

type Propuesta = {
  id: string;
  status: string;
  start_at: string;
  product_id: string;
  booking_id: string | null;
  products: Oferta | null;
  /** Calculado al leer (no en el render, que tiene que ser puro). */
  pasada?: boolean;
};

/** La tarjeta que viaja en el hilo. La ven los dos; solo el alumno paga. */
export function TarjetaDePropuesta({
  proposalId,
  soyAlumno,
  esLaUltima,
  timeZone,
  formato,
}: {
  proposalId: string;
  soyAlumno: boolean;
  /** Si llegó otra después, esta ya se retiró aunque lo leído diga `pending`. */
  esLaUltima: boolean;
  timeZone?: string;
  formato: FormatoHora;
}) {
  // `undefined` = cargando; `null` = no legible (oferta pausada o borrada).
  const [p, setP] = useState<Propuesta | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    async function leer() {
      const { data } = await createClient()
        .from("class_proposals")
        .select(
          "id, status, start_at, product_id, booking_id, products(id, title, pricing_model, price_amount, currency, session_duration_min)",
        )
        .eq("id", proposalId)
        .maybeSingle();
      const fila = data as Propuesta | null;
      if (vivo)
        setP(fila ? { ...fila, pasada: new Date(fila.start_at).getTime() <= Date.now() } : null);
    }
    void leer();
    // Al volver del checkout (u otra pestaña) se relee: así pasa a «Reservada».
    const alVolver = () => {
      if (!document.hidden) void leer();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [proposalId]);

  const marco = "flex w-full max-w-[320px] flex-col gap-1.5 rounded-2xl border bg-background p-3 text-sm";

  if (p === undefined) {
    return <div className={marco}>Cargando la propuesta…</div>;
  }
  if (p === null || !p.products) {
    return (
      <div className={marco}>
        <p className="text-muted-foreground">Esta propuesta de clase ya no está disponible.</p>
      </div>
    );
  }

  const o = p.products;
  const pasada = Boolean(p.pasada);
  const estado =
    p.status === "paid"
      ? "pagada"
      : p.status === "withdrawn" || !esLaUltima
        ? "reemplazada"
        : pasada
          ? "pasada"
          : "viva";
  const checkout = `/reservar/${p.product_id}/checkout?slots=${encodeURIComponent(
    new Date(p.start_at).toISOString(),
  )}`;
  const reserva = p.booking_id
    ? soyAlumno
      ? `/reservas/${p.booking_id}`
      : `/tutor/reservas/${p.booking_id}`
    : null;

  return (
    <div className={marco}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-brand uppercase">
        <CalendarCheckIcon className="size-3.5" aria-hidden />
        Propuesta de clase
      </p>
      <p className="font-semibold">{o.title}</p>
      <p className="text-[13px] first-letter:uppercase">
        {formatSessionTime(p.start_at, timeZone, formato)}
        {o.session_duration_min ? ` · ${o.session_duration_min} min` : null}
      </p>
      <Precio
        amountMinor={bookingTotal({
          pricingModel: o.pricing_model,
          priceAmount: o.price_amount,
          sessionDurationMin: o.session_duration_min,
        })}
        currency={o.currency}
        className="font-semibold"
        ceroEsGratis
      />
      {estado === "pagada" ? (
        <p className="text-[13px] font-semibold text-emerald-700">
          ✓ Reservada{" "}
          {reserva ? (
            // `<a>` y no `<Link>`: recarga completa (regla de oro 13).
            <a href={reserva} className="font-normal text-brand underline">
              Ver la reserva
            </a>
          ) : null}
        </p>
      ) : estado === "reemplazada" ? (
        <p className="text-[13px] text-muted-foreground">Reemplazada por una propuesta nueva.</p>
      ) : estado === "pasada" ? (
        <p className="text-[13px] text-muted-foreground">Este horario ya pasó.</p>
      ) : soyAlumno ? (
        <Button asChild className="mt-1 h-9 rounded-[8px] text-[13px] font-semibold">
          {/* `<a>`: el checkout cuelga de otro grupo de rutas (regla de oro 13). */}
          <a href={checkout}>Pagar y reservar</a>
        </Button>
      ) : (
        <p className="text-[13px] text-muted-foreground">Esperando el pago del alumno.</p>
      )}
    </div>
  );
}
