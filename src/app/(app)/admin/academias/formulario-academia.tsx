"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Lo que edita el formulario, en texto: vacío = NULL en la RPC. */
export type DatosAcademia = {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  website: string;
  brand_color: string;
  policies_url: string;
  payout_country: string;
  allow_public_offers: boolean;
  commission_pct: string;
  /** En unidades de la moneda (dólares), no en mínimas: se convierte al guardar. */
  fixed_fee: string;
  fixed_fee_currency: string;
  fixed_fee_period: string;
  included_free_classes: string;
  agreement_starts_on: string;
  agreement_notes: string;
};

export const VACIA: DatosAcademia = {
  name: "", slug: "", tagline: "", description: "", website: "", brand_color: "",
  policies_url: "", payout_country: "", allow_public_offers: true, commission_pct: "",
  fixed_fee: "", fixed_fee_currency: "USD", fixed_fee_period: "", included_free_classes: "",
  agreement_starts_on: "", agreement_notes: "",
};

const slugDe = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** A2 · crear / editar: perfil, país de cobro y el bloque «Acuerdo» (RA-21). */
export function FormularioAcademia({ id, inicial }: { id: string | null; inicial: DatosAcademia }) {
  const router = useRouter();
  const [d, setD] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof DatosAcademia) => (e: { target: { value: string } }) =>
    setD((x) => ({ ...x, [k]: e.target.value }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const { fixed_fee, ...resto } = d;
    const cuota = fixed_fee.trim() === "" ? "" : String(Math.round(Number(fixed_fee) * 100));
    if (cuota !== "" && !(Number(cuota) >= 0)) {
      toast.error("La cuota fija tiene que ser un número.");
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().rpc("admin_guardar_academia", {
      // El tipo generado no admite null en `p_id`, pero la RPC lo espera para crear.
      p_id: id as string,
      p_datos: { ...resto, slug: resto.slug || slugDe(resto.name), fixed_fee_amount: cuota },
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.code === "23505" ? "Ese slug ya lo usa otra academia."
        : error.code === "23514" ? "Revisa los campos: slug (minúsculas y guiones), color #rrggbb, país de 2 letras y comisión entre 0 y 100."
        : error.code === "22P02" || error.code === "22007" ? "Hay un número o una fecha mal escritos."
        : "No se pudo guardar.",
      );
      return;
    }
    toast.success("Academia guardada.");
    if (id) router.refresh();
    else router.push(`/admin/academias/${data}`);
  }

  const campo = (k: keyof DatosAcademia, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} value={String(d[k])} onChange={set(k)} {...props} />
    </div>
  );

  return (
    <form onSubmit={guardar} className="space-y-6 text-[13px]">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[15px] font-semibold">Perfil</legend>
        {campo("name", "Nombre", { required: true, maxLength: 120 })}
        {campo("slug", "Slug (URL /academias/…)", { placeholder: slugDe(d.name) || "mi-academia", maxLength: 60 })}
        {campo("tagline", "Lema", { maxLength: 160 })}
        {campo("website", "Web", { type: "url" })}
        {campo("brand_color", "Color de marca", { placeholder: "#0080ff" })}
        {campo("policies_url", "Enlace a sus políticas", { type: "url" })}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="description">Descripción</Label>
          <Textarea id="description" rows={4} value={d.description} onChange={set("description")} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[15px] font-semibold">Cobro y permisos</legend>
        {campo("payout_country", "País de cobro (ISO, 2 letras)", { maxLength: 2, placeholder: "MX" })}
        <label className="flex items-center gap-2 self-end pb-2">
          <input
            type="checkbox"
            checked={d.allow_public_offers}
            onChange={(e) => setD((x) => ({ ...x, allow_public_offers: e.target.checked }))}
          />
          Puede publicar ofertas públicas
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-[15px] font-semibold">Acuerdo</legend>
        {d.commission_pct.trim() === "" ? (
          <p className="rounded-lg bg-[#faedcc] px-3 py-2 text-[#805710] sm:col-span-2">
            Sin acuerdo: solo ofertas gratuitas.
          </p>
        ) : null}
        {campo("commission_pct", "% que se queda la academia por clase de pago", { inputMode: "decimal" })}
        {campo("agreement_starts_on", "Fecha de inicio", { type: "date" })}
        {campo("fixed_fee", "Cuota fija (se factura fuera)", { inputMode: "decimal" })}
        {campo("fixed_fee_currency", "Moneda de la cuota", { maxLength: 3 })}
        {campo("fixed_fee_period", "Periodicidad de la cuota", { placeholder: "mensual" })}
        {campo("included_free_classes", "Clases gratis incluidas")}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="agreement_notes">Notas del acuerdo (solo las ve EY)</Label>
          <Textarea id="agreement_notes" rows={3} value={d.agreement_notes} onChange={set("agreement_notes")} />
        </div>
      </fieldset>

      <Button type="submit" disabled={busy}>
        {id ? "Guardar cambios" : "Crear academia"}
      </Button>
    </form>
  );
}
