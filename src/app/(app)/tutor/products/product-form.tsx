"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { InfoIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/database.types";
import { PanelCard } from "@/components/layout/panel-shell";
import { MaterialsUpload } from "@/components/onboarding/materials-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PricingModel = Database["public"]["Enums"]["pricing_model"];

// ponytail: MVP en una sola moneda (USD). Multi-moneda por geografía llega con
// C-13 / EP-07 (routing de cobro); cuando exista, sale de aquí a config del tutor.
const CURRENCY = "USD";

/** Campo del panel (192:46): 45 px, r8, label 12/400 gris. */
const FIELD = "h-[45px] rounded-[8px] px-3.5 text-sm placeholder:text-[#8c8c8c]";
const LABEL = "text-xs font-normal text-[#6b6b6b]";

const PRICING: { id: PricingModel; label: string }[] = [
  { id: "per_session", label: "Por sesión" },
  { id: "per_hour", label: "Por hora" },
  { id: "per_package", label: "Paquete" },
];

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
  imagePath: string | null;
};

/**
 * US-401 (SCR-TU04) — alta/edición de mentoría con el layout del Figma:
 * tarjetas "Detalles" y "Precio y formato", chips para modelo y categorías,
 * la nota de política única (193:30) y doble acción Publicar/Guardar borrador.
 *
 * El Figma pide además "Calendario de la clase" (fechas por producto) y
 * "Material de apoyo" (archivos por producto): el modelo no tiene ninguna de
 * las dos — la agenda sale de la disponibilidad general del tutor y
 * `tutor_materials` es por tutor. Quedan como huecos de EP-23, no se fingen.
 */
export function ProductForm({
  userId,
  categories,
  product,
  materials = [],
  isApproved = false,
}: {
  userId: string;
  categories: { id: string; name: string }[];
  product?: ProductFormValues;
  /** Materiales de ESTA oferta (R24-16); solo se adjuntan al editar. */
  materials?: { id: string; file_name: string; size_bytes: number }[];
  /** Habilita "Publicar" al guardar (RN-23: solo tutor aprobado). */
  isApproved?: boolean;
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
  // El submit del form guarda; este flag decide si además publica (US-402).
  const [publishAfter, setPublishAfter] = useState(false);

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

    // Imagen del producto (DD-02). Solo se sube si el tutor eligió una nueva;
    // al editar sin tocarla, se conserva la que ya estaba.
    let imagePath = product?.imagePath ?? null;
    const file = form.get("image");
    if (file instanceof File && file.size > 0) {
      if (file.size > 5 * 1024 * 1024) return fail("La imagen supera los 5 MB.");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // La RLS de Storage exige que el primer segmento sea el uid del tutor.
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, file, { contentType: file.type });
      if (error) return fail("No se pudo subir la imagen.");
      imagePath = path;
    }

    const row = {
      title,
      image_path: imagePath,
      description: String(form.get("description") ?? "").trim() || null,
      outcome: String(form.get("outcome") ?? "").trim() || null,
      pricing_model: pricingModel,
      price_amount: priceAmount,
      currency: CURRENCY,
      session_duration_min: duration,
      package_num_sessions: packageNum,
      // `status` NO se toca en el insert: alta → 'draft' (default). Publicar es
      // un UPDATE aparte tras guardar; el guard RN-23 de BD sigue mandando.
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

    if (publishAfter) {
      const { error: pubErr } = await supabase
        .from("products")
        .update({ status: "active" })
        .eq("id", productId!);
      if (pubErr) {
        // Guardado sí, publicado no (p. ej. el guard RN-23): se dice tal cual.
        toast.error("Se guardó como borrador, pero no se pudo publicar.");
        router.push("/tutor/products");
        router.refresh();
        return;
      }
    }

    toast.success(
      publishAfter
        ? "Mentoría publicada."
        : isEdit
          ? "Mentoría actualizada."
          : "Mentoría guardada como borrador.",
    );
    router.push("/tutor/products");
    router.refresh();

    function fail(msg?: string) {
      toast.error(msg ?? "No se pudo guardar. Intenta de nuevo.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <PanelCard className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-[#19191f]">
          Detalles de la mentoría
        </h2>

        <div className="grid gap-1.5">
          <Label htmlFor="title" className={LABEL}>
            Título
          </Label>
          <Input
            id="title"
            name="title"
            defaultValue={product?.title}
            required
            maxLength={120}
            placeholder="Ej: Inglés para entrevistas tech"
            className={FIELD}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="outcome" className={LABEL}>
            Resultado (outcome)
          </Label>
          <Input
            id="outcome"
            name="outcome"
            defaultValue={product?.outcome}
            maxLength={160}
            placeholder="Ej: apruebas tu entrevista técnica en inglés"
            className={FIELD}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="description" className={LABEL}>
            Descripción
          </Label>
          <Textarea
            id="description"
            name="description"
            defaultValue={product?.description}
            rows={4}
            placeholder="Explica la metodología y qué incluye la clase…"
            className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="image" className={LABEL}>
            Imagen de portada (opcional)
          </Label>
          <Input
            id="image"
            name="image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="h-[45px] rounded-[8px] pt-2.5"
          />
          <p className="text-xs text-[#6b6b6b]">
            Es la miniatura de la tarjeta en el catálogo. JPG, PNG o WebP · máx 5 MB.
            {product?.imagePath ? " Ya tienes una: sube otra para reemplazarla." : ""}
          </p>
        </div>

        <fieldset className="grid gap-2">
          <legend className={LABEL}>Categorías (elige al menos 1)</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.map((c) => {
              const on = selected.has(c.id);
              return (
                <label
                  key={c.id}
                  className={cn(
                    "inline-flex h-9 cursor-pointer items-center rounded-full border px-4 text-[13px] transition-colors",
                    on
                      ? "border-brand bg-brand font-semibold text-white"
                      : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => toggleCategory(c.id)}
                  />
                  {c.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      </PanelCard>

      <PanelCard className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-[#19191f]">
          Precio y formato
        </h2>

        {/* Modelo de precio como chips (192:75), no como select. */}
        <div className="grid gap-2">
          <p className={LABEL}>Modelo de precio</p>
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
                    "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
                    on
                      ? "border-brand bg-brand font-semibold text-white"
                      : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
                  )}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="price" className={LABEL}>
              Precio
            </Label>
            <Input
              id="price"
              name="price"
              type="number"
              min={0}
              step="0.01"
              required
              defaultValue={product ? product.priceAmount / 100 : ""}
              placeholder="40"
              className={FIELD}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className={LABEL}>Moneda</Label>
            {/* USD fijo hasta C-13; se muestra, no se edita. */}
            <Input value={CURRENCY} disabled readOnly className={FIELD} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="session_duration_min" className={LABEL}>
              Duración de la sesión (min)
            </Label>
            <Input
              id="session_duration_min"
              name="session_duration_min"
              type="number"
              min={30}
              step={5}
              required
              defaultValue={product?.sessionDurationMin ?? 60}
              className={FIELD}
            />
          </div>
          {pricingModel === "per_package" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="package_num_sessions" className={LABEL}>
                Nº de sesiones del paquete
              </Label>
              <Input
                id="package_num_sessions"
                name="package_num_sessions"
                type="number"
                min={1}
                step={1}
                required
                defaultValue={product?.packageNumSessions ?? 4}
                className={FIELD}
              />
            </div>
          ) : null}
        </div>
      </PanelCard>

      {/* Materiales de clase de ESTA oferta (R24-16): se movieron aquí desde el
          onboarding. Solo al editar (el producto ya existe y tiene id). */}
      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Materiales de clase
        </h2>
        {isEdit && product ? (
          <MaterialsUpload
            userId={userId}
            productId={product.id}
            initial={materials}
          />
        ) : (
          <p className="text-[13px] text-[#6b6b6b]">
            Guarda la oferta primero y podrás adjuntar sus materiales al editarla.
          </p>
        )}
      </PanelCard>

      {/* 193:30 — la política es única de plataforma, no se configura aquí. */}
      <div className="flex gap-3 rounded-[16px] border border-[#b2d9ff] bg-[#e5f2ff] p-5">
        <InfoIcon className="mt-0.5 size-5 shrink-0 text-brand" />
        <div>
          <p className="text-[15px] font-semibold text-[#19191f]">
            Política de cancelación
          </p>
          <p className="mt-1 text-[12.5px] text-[#405980]">
            La política es única de plataforma (RN-37): reembolso{" "}
            {P.refundPct.studentEarly} % si se cancela con ≥{P.cutoffHours} h de
            antelación, {P.refundPct.studentLate} % si es con menos. No se
            configura por mentoría.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        {isApproved ? (
          <Button
            type="submit"
            disabled={loading}
            onClick={() => setPublishAfter(true)}
            className="h-[47px] rounded-[8px] px-6 font-semibold"
          >
            {loading && publishAfter ? "Publicando…" : "Publicar"}
          </Button>
        ) : null}
        <Button
          type="submit"
          variant={isApproved ? "outline" : "default"}
          disabled={loading}
          onClick={() => setPublishAfter(false)}
          className="h-[47px] rounded-[8px] px-6 font-medium"
        >
          {loading && !publishAfter
            ? "Guardando…"
            : isEdit
              ? "Guardar cambios"
              : "Guardar borrador"}
        </Button>
      </div>
    </form>
  );
}
