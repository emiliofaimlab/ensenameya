"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PricingModel = Database["public"]["Enums"]["pricing_model"];

// ponytail: MVP en una sola moneda (USD). Multi-moneda por geografía llega con
// C-13 / EP-07 (routing de cobro); cuando exista, sale de aquí a config del tutor.
const CURRENCY = "USD";

const selectClasses =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export type ProductFormValues = {
  id: string;
  title: string;
  description: string;
  outcome: string;
  pricingModel: PricingModel;
  priceAmount: number; // unidades menores
  sessionDurationMin: number | null;
  packageNumSessions: number | null;
  categoryIds: string[];
};

export function ProductForm({
  userId,
  categories,
  product,
}: {
  userId: string;
  categories: { id: string; name: string }[];
  product?: ProductFormValues;
}) {
  const router = useRouter();
  const isEdit = !!product;
  const [loading, setLoading] = useState(false);
  const [pricingModel, setPricingModel] = useState<PricingModel>(
    product?.pricingModel ?? "per_session",
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(product?.categoryIds ?? []),
  );

  function toggleCategory(id: string) {
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

    // Precio en unidades mayores → menores (USD, 2 decimales).
    const priceMajor = Number(form.get("price"));
    if (!Number.isFinite(priceMajor) || priceMajor < 0)
      return toast.error("Indica un precio válido.");
    const priceAmount = Math.round(priceMajor * 100);

    // Duración ≥ 30 min (RN-03).
    const duration = Number(form.get("session_duration_min"));
    if (!Number.isFinite(duration) || duration < 30)
      return toast.error("La duración mínima es 30 minutos.");

    // Paquete ≥ 1 sesión, solo per_package (RN-22).
    let packageNum: number | null = null;
    if (pricingModel === "per_package") {
      packageNum = Number(form.get("package_num_sessions"));
      if (!Number.isInteger(packageNum) || packageNum < 1)
        return toast.error("El paquete debe tener al menos 1 sesión.");
    }

    if (selected.size === 0)
      return toast.error("Elige al menos una categoría.");

    setLoading(true);
    const supabase = createClient();
    const row = {
      title,
      description: String(form.get("description") ?? "").trim() || null,
      outcome: String(form.get("outcome") ?? "").trim() || null,
      pricing_model: pricingModel,
      price_amount: priceAmount,
      currency: CURRENCY,
      session_duration_min: duration,
      package_num_sessions: packageNum,
      // `status` NO se toca aquí: alta → 'draft' (default); publicar/pausar es US-402.
    };

    // ponytail: catálogo, no dinero → escritura directa bajo RLS (regla 2 aplica a
    // payments/bookings). Producto + categorías van en 2 pasos no atómicos; si el
    // 2º falla queda un borrador sin categorías y el tutor reintenta al editar.
    let productId = product?.id;
    if (isEdit) {
      const { error } = await supabase
        .from("products")
        .update(row)
        .eq("id", productId!);
      if (error) return fail(error.message);
      // Reconciliar categorías: borrar todas y reinsertar las elegidas.
      await supabase
        .from("product_categories")
        .delete()
        .eq("product_id", productId!);
    } else {
      const { data, error } = await supabase
        .from("products")
        .insert({ tutor_id: userId, ...row })
        .select("id")
        .single();
      if (error || !data) return fail(error?.message);
      productId = data.id;
    }

    const { error: catErr } = await supabase
      .from("product_categories")
      .insert([...selected].map((category_id) => ({ product_id: productId!, category_id })));
    if (catErr) return fail(catErr.message);

    toast.success(isEdit ? "Producto actualizado." : "Producto guardado como borrador.");
    router.push("/tutor/products");
    router.refresh();

    function fail(msg?: string) {
      toast.error(msg ?? "No se pudo guardar. Intenta de nuevo.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" defaultValue={product?.title} required maxLength={120} placeholder="Ej. Cálculo diferencial desde cero" />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="outcome">¿Qué logra el alumno? (opcional)</Label>
        <Input id="outcome" name="outcome" defaultValue={product?.outcome} maxLength={160} placeholder="Ej. Aprobar tu examen de admisión" />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Descripción</Label>
        <Textarea id="description" name="description" defaultValue={product?.description} rows={4} placeholder="Qué incluye, para quién es, cómo trabajas." />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pricing_model">Modelo de precio</Label>
        <select id="pricing_model" name="pricing_model" className={selectClasses} value={pricingModel} onChange={(e) => setPricingModel(e.target.value as PricingModel)}>
          <option value="per_session">Por sesión</option>
          <option value="per_hour">Por hora</option>
          <option value="per_package">Paquete de sesiones</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="price">Precio (USD)</Label>
          <Input id="price" name="price" type="number" min={0} step="0.01" required defaultValue={product ? product.priceAmount / 100 : ""} placeholder="0.00" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="session_duration_min">Duración (min)</Label>
          <Input id="session_duration_min" name="session_duration_min" type="number" min={30} step={5} required defaultValue={product?.sessionDurationMin ?? 60} />
        </div>
      </div>

      {pricingModel === "per_package" ? (
        <div className="grid gap-2">
          <Label htmlFor="package_num_sessions">Sesiones del paquete</Label>
          <Input id="package_num_sessions" name="package_num_sessions" type="number" min={1} step={1} required defaultValue={product?.packageNumSessions ?? 4} />
        </div>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Categorías</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = selected.has(c.id);
            return (
              <label key={c.id} className={`cursor-pointer rounded-full border px-3 py-1 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-accent"}`}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleCategory(c.id)} />
                {c.name}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar borrador"}
      </Button>
    </form>
  );
}
