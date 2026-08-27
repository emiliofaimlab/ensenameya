"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { InfoIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { bookingTotal } from "@/lib/booking";
import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FIELD_CLASS } from "./wizard";

type PricingModel = Database["public"]["Enums"]["pricing_model"];

// Misma moneda única que `ProductForm` hasta C-13 (routing de cobro).
const CURRENCY = "USD";

const PRICING: { id: PricingModel; label: string }[] = [
  { id: "per_session", label: "Por sesión" },
  { id: "per_hour", label: "Por hora" },
  { id: "per_package", label: "Paquete" },
];

/**
 * N-03 · La primera oferta, creada DENTRO del asistente.
 *
 * Antes "Crear mi primera oferta" era un `<Link>` a `/tutor/products/new`: el
 * tutor salía del asistente, aterrizaba en el panel y —dicho por la sesión de
 * pruebas— no volvía. El formulario completo de la mentoría sigue viviendo en
 * `/tutor/products` (no es de este carril y hace `router.push` al guardar, que
 * es justo lo que aquí no se puede hacer); esto es su versión mínima: lo
 * imprescindible para que exista una oferta. Portada, materiales, FAQ, nivel e
 * idioma se añaden luego editándola, y se dice en pantalla.
 *
 * ⚠️ No publica. Publicar exige tutor `approved` y lo fuerza un trigger en BD
 * (RN-23, `20260709120000`); el tutor que está en el asistente es `pending` por
 * definición. Se guarda como borrador y la UI lo dice, en vez de intentar un
 * `status='active'` que la base rechazaría.
 */
export function FirstProductForm({
  userId,
  categories,
  onCreated,
}: {
  userId: string;
  categories: { id: string; name: string }[];
  /** Sube el hecho al asistente: `hasProduct` llegaba del servidor y no se
   *  enteraba de esta creación, así que "Finalizar" seguía bloqueado. */
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pricingModel, setPricingModel] = useState<PricingModel>("per_session");
  const [precio, setPrecio] = useState("");
  const [duracion, setDuracion] = useState("60");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Con «por hora» el precio NO es lo que paga el alumno: el servidor lo
  // multiplica por la duración (RN-10, `create_booking`). Mismo cálculo.
  const cobroPorSesion = bookingTotal({
    pricingModel,
    priceAmount: Math.round((Number(precio) || 0) * 100),
    sessionDurationMin: Number(duracion) || 60,
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    const title = String(form.get("title") ?? "").trim();
    if (!title) return toast.error("Escribe un título.");

    const priceMajor = Number(precio);
    if (!Number.isFinite(priceMajor) || priceMajor <= 0)
      return toast.error("Indica un precio válido.");

    const duration = Number(duracion);
    if (!Number.isFinite(duration) || duration < 30)
      return toast.error("La duración mínima es 30 minutos."); // RN-03

    let packageNum: number | null = null;
    if (pricingModel === "per_package") {
      packageNum = Number(form.get("package_num_sessions"));
      if (!Number.isInteger(packageNum) || packageNum < 1)
        return toast.error("El paquete debe tener al menos 1 sesión."); // RN-22
    }

    if (selected.size === 0)
      return toast.error("Elige al menos una categoría.");

    setBusy(true);
    const supabase = createClient();

    // Catálogo, no dinero → escritura directa bajo RLS (la regla de oro 2 habla
    // de `payments`/`bookings`). Producto y categorías son dos pasos no
    // atómicos: si el segundo falla queda un borrador sin categorías y el tutor
    // lo arregla editándolo, igual que en `ProductForm`.
    const { data, error } = await supabase
      .from("products")
      .insert({
        tutor_id: userId,
        title,
        outcome: String(form.get("outcome") ?? "").trim() || null,
        description: String(form.get("description") ?? "").trim() || null,
        pricing_model: pricingModel,
        price_amount: Math.round(priceMajor * 100),
        currency: CURRENCY,
        session_duration_min: duration,
        package_num_sessions: packageNum,
        // `status` no se toca: alta → 'draft' (default de la columna).
      })
      .select("id")
      .single();

    if (error || !data) {
      setBusy(false);
      return toast.error(error?.message ?? "No se pudo crear la mentoría.");
    }

    const { error: catErr } = await supabase
      .from("product_categories")
      .insert(
        [...selected].map((category_id) => ({ product_id: data.id, category_id })),
      );
    setBusy(false);
    if (catErr) {
      // La oferta existe: `onCreated` igual, o el tutor se quedaría atascado
      // con una mentoría creada y el asistente diciendo que no la tiene.
      toast.error("Se creó la mentoría, pero faltaron sus categorías. Edítala luego.");
      onCreated();
      return;
    }

    toast.success("Mentoría creada como borrador.");
    onCreated();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field label="Título de la mentoría" htmlFor="title">
        <Input
          id="title"
          name="title"
          required
          maxLength={120}
          placeholder="Ej: Inglés para entrevistas tech"
          className={FIELD_CLASS}
        />
      </Field>

      <Field
        label="Resultado (opcional)"
        htmlFor="outcome"
        hint="Lo que el alumno consigue. Es lo primero que se lee en tu tarjeta."
      >
        <Input
          id="outcome"
          name="outcome"
          maxLength={160}
          placeholder="Ej: apruebas tu entrevista técnica en inglés"
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Descripción (opcional)" htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={3}
          placeholder="Explica la metodología y qué incluye la mentoría…"
          className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
        />
      </Field>

      <Field label="Categorías (elige al menos 1)">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Categorías de la mentoría">
          {categories.map((c) => {
            const on = selected.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.id)}
                className={cn(
                  "inline-flex h-[38px] items-center rounded-full border px-4 text-[13px] transition-colors",
                  on
                    ? "border-brand bg-brand font-semibold text-white"
                    : "bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Modelo de precio">
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="Modelo de precio"
        >
          {PRICING.map((m) => {
            const on = pricingModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPricingModel(m.id)}
                className={cn(
                  "inline-flex h-[38px] items-center rounded-full border px-4 text-[13px] transition-colors",
                  on
                    ? "border-brand bg-brand font-semibold text-white"
                    : "bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
                )}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`Precio (${CURRENCY})`} htmlFor="price">
          <Input
            id="price"
            type="number"
            min={0}
            step="0.01"
            required
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="40"
            className={FIELD_CLASS}
          />
        </Field>
        <Field
          label="Duración de la sesión (min)"
          htmlFor="session_duration_min"
          // Sin esto el tutor pone 40 «por hora» y 90 min, y descubre que se
          // cobran 60 cuando ya ha ocurrido.
          hint={
            pricingModel === "per_hour" &&
            cobroPorSesion > 0 &&
            Number(duracion) >= 30
              ? `Cada sesión de ${duracion} min se cobra ${formatMoney(cobroPorSesion, CURRENCY)}.`
              : undefined
          }
        >
          <Input
            id="session_duration_min"
            type="number"
            min={30}
            step={5}
            required
            value={duracion}
            onChange={(e) => setDuracion(e.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        {pricingModel === "per_package" ? (
          <Field label="Nº de sesiones del paquete" htmlFor="package_num_sessions">
            <Input
              id="package_num_sessions"
              name="package_num_sessions"
              type="number"
              min={1}
              step={1}
              required
              defaultValue={4}
              className={FIELD_CLASS}
            />
          </Field>
        ) : null}
      </div>

      {/* RN-23: no fingimos que se publica. */}
      <div className="flex gap-3 rounded-[12px] border border-[#b2d9ff] bg-[#e5f2ff] p-4">
        <InfoIcon className="mt-0.5 size-4.5 shrink-0 text-brand" />
        <p className="text-[12.5px] text-[#405980]">
          Se guarda como <strong className="font-semibold">borrador</strong>: una
          mentoría solo se publica cuando tu perfil está aprobado. Podrás
          publicarla —y añadirle portada, materiales y preguntas frecuentes—
          desde «Mis mentorías» en cuanto te aprobemos.
        </p>
      </div>

      <Button
        type="submit"
        disabled={busy}
        className="h-[45px] w-full rounded-[8px] text-sm font-semibold"
      >
        {busy ? "Creando…" : "Crear mi primera mentoría"}
      </Button>
    </form>
  );
}
