"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { InfoIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { bookingTotal } from "@/lib/booking";
import { formatMoney, storageUrl } from "@/lib/catalog/format";
import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/database.types";
import { PanelCard } from "@/components/layout/panel-shell";
import {
  AvailabilityBlocks,
  type AvailabilityRule,
  type AvailabilityScope,
} from "./availability-blocks";
import { AcceptanceMode } from "./acceptance-mode";
import {
  CoverImagePicker,
  MaterialsPicker,
  stage,
  type SavedMaterial,
  type StagedFile,
} from "@/components/tutor/product-uploads";
import { PRODUCT_IMAGE_HINT } from "@/components/tutor/upload-formats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PricingModel = Database["public"]["Enums"]["pricing_model"];
type TeachingLevel = Database["public"]["Enums"]["teaching_level"];

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

/**
 * N-07 · topes de los campos de texto. El `maxLength` del input corta sin
 * avisar —el tutor escribe y las letras dejan de aparecer—, así que el número
 * sale del mismo sitio que el atributo y se escribe debajo del campo.
 */
const MAX_TITULO = 120;
const MAX_OUTCOME = 160;

/** "las categorías y los materiales" — enumeración con «y» al final. */
function enumerar(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

/** DD-03 — mismas etiquetas que el filtro del Figma (386:1196). */
export const PRODUCT_LEVELS = [
  { value: "basico", label: "Básico" },
  { value: "intermedio", label: "Intermedio" },
  { value: "avanzado", label: "Avanzado" },
];

export const PRODUCT_LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
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
  /** DD-03 — nivel e idioma de ESTA mentoría, no del tutor. */
  level: TeachingLevel | null;
  language: string | null;
  categoryIds: string[];
  imagePath: string | null;
  /** FAQ propias de la mentoría (R24-17). */
  faqs: { q: string; a: string }[];
  /**
   * M-02 · `products.auto_accept_bookings` — si las reservas pagadas de ESTA
   * mentoría se confirman solas. No es una preferencia de estilo: decide si la
   * reserva pasa o no por `pending_acceptance`, y con ella la ventana de 24 h
   * de RN-38. Ver `acceptance-mode.tsx`.
   */
  autoAccept: boolean;
  /**
   * N-04 · franjas de disponibilidad a las que pertenece ESTA mentoría.
   * Lista vacía = «toda mi disponibilidad», que es literalmente lo que
   * significa no tener filas en `product_availability_rules`.
   */
  availabilityRuleIds: string[];
};

/**
 * US-401 (SCR-TU04) — alta/edición de mentoría con el layout del Figma:
 * tarjetas "Detalles" y "Precio y formato", chips para modelo y categorías,
 * la nota de política única (193:30) y doble acción Publicar/Guardar borrador.
 *
 * El Figma pide además "Calendario de la clase" (fechas por producto): el
 * modelo no lo tiene — la agenda sale de la disponibilidad general del tutor.
 * Queda como hueco de EP-23, no se finge.
 *
 * N-05/N-06 · portada y materiales se eligen aquí y suben al pulsar guardar.
 * No es una preferencia de estilo: en el ALTA todavía no hay `product_id` al
 * que colgar los archivos, así que o se difiere la subida o se obliga a
 * guardar y volver a entrar (que es justo lo que se reportó).
 *
 * N-04 · el hueco del "Calendario de la clase" ya no está del todo vacío: la
 * mentoría elige a QUÉ franjas de la disponibilidad del tutor pertenece. No son
 * fechas propias del producto (eso sigue sin existir en el modelo), sino un
 * subconjunto del horario semanal del tutor.
 */
export function ProductForm({
  userId,
  categories,
  availabilityRules = [],
  product,
  materials = [],
  isApproved = false,
}: {
  userId: string;
  categories: { id: string; name: string }[];
  /** N-04 · franjas semanales del tutor (US-501), para elegir entre ellas. */
  availabilityRules?: AvailabilityRule[];
  product?: ProductFormValues;
  /** Materiales YA guardados de esta oferta (R24-16); solo existen al editar. */
  materials?: SavedMaterial[];
  /** Habilita "Publicar" al guardar (RN-23: solo tutor aprobado). */
  isApproved?: boolean;
}) {
  const router = useRouter();
  const isEdit = !!product;
  const [loading, setLoading] = useState(false);
  const [pricingModel, setPricingModel] = useState<PricingModel>(
    product?.pricingModel ?? "per_session",
  );
  // Controlados solo para poder decir en vivo lo que acabará pagando el alumno.
  const [precio, setPrecio] = useState(
    product ? String(product.priceAmount / 100) : "",
  );
  const [duracion, setDuracion] = useState(
    String(product?.sessionDurationMin ?? 60),
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(product?.categoryIds ?? []),
  );
  // El submit del form guarda; este flag decide si además publica (US-402).
  const [publishAfter, setPublishAfter] = useState(false);
  // FAQ de la mentoría (R24-17): lista editable, se guarda con el producto.
  const [faqs, setFaqs] = useState<{ q: string; a: string }[]>(
    product?.faqs ?? [],
  );
  // N-06: la portada dejó de viajar en el `FormData` y vive aquí. Sigue
  // valiendo la regla de antes — `null` significa "no eligió ninguna nueva",
  // y entonces al editar se conserva la que ya estaba.
  const [cover, setCover] = useState<File | null>(null);
  // N-05: los materiales elegidos esperan en memoria hasta el guardado. Los
  // que ya estaban en la BD se listan aparte porque se borran en el acto.
  const [savedMaterials, setSavedMaterials] =
    useState<SavedMaterial[]>(materials);
  const [stagedMaterials, setStagedMaterials] = useState<StagedFile[]>([]);
  // N-04 · el modo se DEDUCE de lo guardado porque en la BD no hay más que eso:
  // con enlaces, «solo estas franjas»; sin enlaces, «toda mi disponibilidad».
  // Así una mentoría anterior a N-04 abre en el modo que describe lo que hace
  // hoy, en vez de estrenarse en un modo que nadie eligió.
  const [scope, setScope] = useState<AvailabilityScope>(
    product?.availabilityRuleIds.length ? "blocks" : "all",
  );
  const [selectedRules, setSelectedRules] = useState<Set<string>>(
    new Set(product?.availabilityRuleIds ?? []),
  );
  // M-02 · el alta arranca en `true` PORQUE ESE ES EL DEFAULT DE LA COLUMNA
  // (`20260817180000`, petición literal del cliente). No es un descuido: si
  // aquí se pusiera `false`, una mentoría creada desde el formulario y otra
  // creada por SQL nacerían distintas, y además sería revertir por la puerta de
  // atrás una decisión que la migración defiende por escrito. Lo que se hace en
  // vez de cambiarlo es contarlo — ver el aviso de `AcceptanceMode`.
  const [autoAccept, setAutoAccept] = useState(product?.autoAccept ?? true);

  const coverUrl = storageUrl("product-images", product?.imagePath);

  const cobroPorSesion = bookingTotal({
    pricingModel,
    priceAmount: Math.round((Number(precio) || 0) * 100),
    sessionDurationMin: Number(duracion) || 60,
  });

  function toggleRule(id: string) {
    setSelectedRules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

    // N-04 · «solo estas franjas» con ninguna marcada no se puede guardar tal
    // cual: sin filas, la BD lo lee como «toda mi disponibilidad» y el tutor se
    // quedaría convencido de haber limitado la mentoría a nada. Se le pide que
    // elija, o que diga «toda» a propósito.
    if (scope === "blocks" && selectedRules.size === 0)
      return toast.error(
        "Marca al menos una franja, o elige «Toda mi disponibilidad».",
      );

    setLoading(true);
    const supabase = createClient();

    // ── Fase 1 · Storage ─────────────────────────────────────────────────
    // Todo lo que va a disco sube ANTES de tocar la BD, a propósito: si el
    // bucket falla no hay ningún producto a medias que explicar, y lo ya
    // subido se puede retirar. Al revés (producto primero) el fallo dejaría
    // una mentoría publicada prometiendo unos materiales que no existen.
    const subidos: string[] = []; // rutas en `tutor-materials`
    let nuevaPortada: string | null = null;

    /** Retira del bucket lo subido en este intento. Best-effort: si el borrado
     *  falla no hay nada mejor que hacer, el objeto queda huérfano pero no lo
     *  referencia ninguna fila y nadie lo ve. */
    async function retirar() {
      if (nuevaPortada)
        await supabase.storage.from("product-images").remove([nuevaPortada]);
      if (subidos.length)
        await supabase.storage.from("tutor-materials").remove(subidos);
    }

    // Imagen del producto (DD-02). Solo se sube si el tutor eligió una nueva;
    // al editar sin tocarla, se conserva la que ya estaba.
    let imagePath = product?.imagePath ?? null;
    if (cover) {
      const ext = cover.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // La RLS de Storage exige que el primer segmento sea el uid del tutor.
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, cover, { contentType: cover.type });
      if (error)
        return fail(
          "No se pudo subir la imagen de portada, así que no se guardó nada. Tus datos siguen en el formulario: vuelve a intentarlo.",
        );
      nuevaPortada = path;
      imagePath = path;
    }

    // Materiales, uno a uno: Storage no tiene subida en lote. Si uno falla se
    // dice CUÁL y se deshace lo demás — dejarlo a medias sería peor, porque el
    // tutor no tendría forma de saber cuáles repetir.
    for (const { file } of stagedMaterials) {
      // Prefijo aleatorio: dos archivos con el mismo nombre no se pisan.
      const path = `${userId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage
        .from("tutor-materials")
        .upload(path, file, { contentType: file.type });
      if (error) {
        await retirar();
        return fail(
          `No se pudo subir «${file.name}», así que no se guardó nada${subidos.length ? ` (tampoco los ${subidos.length} archivos anteriores)` : ""}. Tus datos siguen en el formulario: vuelve a intentarlo.`,
        );
      }
      subidos.push(path);
    }

    // ── Fase 2 · Base de datos ───────────────────────────────────────────
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
      // DD-03: opcionales — vacío se guarda como nulo, que es lo que espera el
      // check, y las mentorías viejas siguen válidas sin el dato.
      level: (String(form.get("level") ?? "") || null) as TeachingLevel | null,
      language: String(form.get("language") ?? "") || null,
      // FAQ de ESTA mentoría (R24-17). Se descartan las filas a medio escribir.
      faqs: faqs
        .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
        .filter((f) => f.q && f.a),
      // M-02 · viaja en el mismo `row` que todo lo demás: el column-grant de
      // `20260817180000` cubre insert Y update, así que el alta y la edición
      // escriben por el mismo camino. Va explícito también en el insert —y no
      // se deja al default de la columna— para que lo guardado sea lo que el
      // tutor tenía en pantalla, incluso si algún día cambia ese default.
      auto_accept_bookings: autoAccept,
      // `status` NO se toca en el insert: alta → 'draft' (default). Publicar es
      // un UPDATE aparte tras guardar; el guard RN-23 de BD sigue mandando.
    };

    // ponytail: catálogo, no dinero → escritura directa bajo RLS (regla 2 aplica a
    // payments/bookings). Producto, categorías y materiales son escrituras
    // separadas y no atómicas: no hay transacción de cliente. Mientras el
    // producto no exista se puede abortar limpio (se retira lo del bucket);
    // en cuanto existe, ya no — de ahí lo de abajo.
    let productId = product?.id;
    if (isEdit) {
      const { error } = await supabase
        .from("products")
        .update(row)
        .eq("id", productId!);
      if (error) {
        await retirar();
        return fail(error.message);
      }
      // Reconciliar categorías: borrar todas y reinsertar las elegidas.
      await supabase
        .from("product_categories")
        .delete()
        .eq("product_id", productId!);
      // N-04 · mismo criterio con las franjas, y el borrado va SIEMPRE, también
      // al volver a «toda mi disponibilidad»: en ese modo lo correcto es cero
      // filas, así que el borrado no es la primera mitad de una reconciliación
      // sino la operación entera.
      await supabase
        .from("product_availability_rules")
        .delete()
        .eq("product_id", productId!);
    } else {
      const { data, error } = await supabase
        .from("products")
        .insert({ tutor_id: userId, ...row })
        .select("id")
        .single();
      if (error || !data) {
        await retirar();
        return fail(error?.message);
      }
      productId = data.id;
    }

    // A partir de aquí el producto EXISTE, así que ya no se aborta: cada fallo
    // se anota por su nombre y se cuenta al final. Un "no se pudo guardar" a
    // secas dejaba al tutor sin saber si repetir el alta entera o solo volver a
    // adjuntar — que es lo que N-05 pide evitar.
    const aMedias: string[] = [];

    const { error: catErr } = await supabase
      .from("product_categories")
      .insert([...selected].map((category_id) => ({ product_id: productId!, category_id })));
    if (catErr) aMedias.push("las categorías");

    // N-04 · las franjas elegidas. En modo «toda mi disponibilidad» no hay nada
    // que insertar: la ausencia de filas ES el dato.
    if (scope === "blocks" && selectedRules.size > 0) {
      const { error: rulesErr } = await supabase
        .from("product_availability_rules")
        .insert(
          [...selectedRules].map((rule_id) => ({
            product_id: productId!,
            rule_id,
          })),
        );
      // Se nombra el efecto, no la tabla: si esto falla la mentoría queda «en
      // toda tu disponibilidad», que es lo que el tutor va a ver y lo que tiene
      // que poder corregir.
      if (rulesErr)
        aMedias.push("los horarios elegidos (queda en toda tu disponibilidad)");
    }

    if (subidos.length > 0) {
      // Las N filas en UN insert: Postgres lo resuelve en una transacción, así
      // que o quedan todas o ninguna. Con un insert por archivo podía quedar
      // "3 de 5 adjuntos" y ni el tutor ni nosotros sabríamos cuáles.
      const { error: matErr } = await supabase.from("tutor_materials").insert(
        subidos.map((storage_path, i) => ({
          tutor_id: userId,
          product_id: productId!,
          storage_path,
          file_name: stagedMaterials[i].file.name,
          size_bytes: stagedMaterials[i].file.size,
        })),
      );
      if (matErr) {
        // Los archivos están en el bucket pero no los referencia ninguna fila:
        // se retiran para que no cuenten en la cuota ni reaparezcan luego.
        await supabase.storage.from("tutor-materials").remove(subidos);
        aMedias.push(
          subidos.length === 1
            ? "el material adjunto"
            : `los ${subidos.length} materiales`,
        );
      } else {
        // Ya no están pendientes. La lista definitiva la trae el servidor en
        // el `router.refresh()` de más abajo, con los ids reales.
        setStagedMaterials([]);
      }
    }

    if (publishAfter) {
      const { error: pubErr } = await supabase
        .from("products")
        .update({ status: "active" })
        .eq("id", productId!);
      // Guardado sí, publicado no (p. ej. el guard RN-23 de BD): se dice tal cual.
      if (pubErr) aMedias.push("la publicación (sigue como borrador)");
    }

    if (aMedias.length > 0) {
      // Se dice qué quedó guardado y qué no, y se abre la edición de ESTA
      // mentoría: lo que falta se remata ahí sin reescribir el formulario.
      toast.error(
        `La mentoría se guardó, pero faltó ${enumerar(aMedias)}. Complétalo desde aquí.`,
        { duration: 12_000 },
      );
      router.push(`/tutor/products/${productId}/edit`);
      router.refresh();
      return;
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

  /**
   * Quita un material YA guardado. Aquí no se difiere nada: el producto existe
   * y la fila es suya. Se borra primero la fila (es la que ve la ficha) y
   * después el objeto; si lo segundo falla queda un archivo huérfano en un
   * bucket privado, que es preferible a una fila apuntando a un archivo que ya
   * no está.
   */
  async function removeSavedMaterial(id: string) {
    const material = savedMaterials.find((m) => m.id === id);
    if (!material) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("tutor_materials")
      .delete()
      .eq("id", id);
    if (error) return toast.error("No se pudo quitar el material.");
    await supabase.storage
      .from("tutor-materials")
      .remove([material.storage_path]);
    setSavedMaterials((prev) => prev.filter((m) => m.id !== id));
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
            maxLength={MAX_TITULO}
            placeholder="Ej: Inglés para entrevistas tech"
            className={FIELD}
          />
          <p className="text-xs text-[#6b6b6b]">
            Máx. {MAX_TITULO} caracteres.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="outcome" className={LABEL}>
            Resultado (outcome)
          </Label>
          <Input
            id="outcome"
            name="outcome"
            defaultValue={product?.outcome}
            maxLength={MAX_OUTCOME}
            placeholder="Ej: apruebas tu entrevista técnica en inglés"
            className={FIELD}
          />
          <p className="text-xs text-[#6b6b6b]">
            Máx. {MAX_OUTCOME} caracteres. Es la línea que se lee bajo el título
            en el catálogo.
          </p>
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
            placeholder="Explica la metodología y qué incluye la mentoría…"
            className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
          />
        </div>

        <div className="grid gap-1.5">
          <p className={LABEL}>Imagen de portada (opcional)</p>
          <p className="text-xs text-[#6b6b6b]">
            Es la miniatura de la tarjeta en el catálogo. {PRODUCT_IMAGE_HINT}.
          </p>
          <CoverImagePicker
            currentUrl={coverUrl}
            file={cover}
            onPick={setCover}
            onClear={() => setCover(null)}
            disabled={loading}
          />
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
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
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
              value={duracion}
              onChange={(e) => setDuracion(e.target.value)}
              className={FIELD}
            />
            {/* Con «por hora» el precio NO es lo que paga el alumno: el servidor
                multiplica por la duración (RN-10, `create_booking`). Sin decirlo
                aquí, el tutor pone 40 y 90 min y descubre el cobro de 60 cuando
                ya se ha hecho. Mismo cálculo que el servidor: `bookingTotal`. */}
            {/* Con el campo a medio escribir (vacío, o un «9» suelto) la frase
                se leería «cada sesión de min se cobra…». Callarse es mejor. */}
            {pricingModel === "per_hour" &&
            cobroPorSesion > 0 &&
            Number(duracion) >= 30 ? (
              <p className="text-xs text-[#6b6b6b]">
                Cada sesión de {duracion} min se cobra{" "}
                <strong className="font-semibold text-[#333333]">
                  {formatMoney(cobroPorSesion, CURRENCY)}
                </strong>
                .
              </p>
            ) : null}
          </div>
          {/* DD-03 — de la mentoría, no del tutor: un tutor avanzado puede
              publicar una clase básica. Alimentan los filtros de P05/P06. */}
          <div className="grid gap-1.5">
            <Label htmlFor="level" className={LABEL}>
              Nivel de la mentoría (opcional)
            </Label>
            <select
              id="level"
              name="level"
              defaultValue={product?.level ?? ""}
              className={`${FIELD} border bg-transparent`}
            >
              <option value="">Sin especificar</option>
              {PRODUCT_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="language" className={LABEL}>
              Idioma en que la impartes (opcional)
            </Label>
            <select
              id="language"
              name="language"
              defaultValue={product?.language ?? ""}
              className={`${FIELD} border bg-transparent`}
            >
              <option value="">Sin especificar</option>
              {PRODUCT_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
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

      {/* N-04 · a qué franjas de tu disponibilidad pertenece esta mentoría.
          Va después del formato porque depende de la duración: las franjas se
          trocean en huecos del tamaño de la sesión. */}
      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Horarios de esta mentoría
        </h2>
        <p className="text-[13px] text-[#6b6b6b]">
          Tus horarios se definen una vez en{" "}
          <Link
            href="/tutor/availability"
            className="font-medium text-brand underline underline-offset-2"
          >
            Disponibilidad
          </Link>
          . Aquí eliges cuáles usa esta mentoría.
        </p>
        <AvailabilityBlocks
          rules={availabilityRules}
          scope={scope}
          onScopeChange={setScope}
          selected={selectedRules}
          onToggle={toggleRule}
          disabled={loading}
        />
      </PanelCard>

      {/* Materiales de clase de ESTA oferta (R24-16): se movieron aquí desde el
          onboarding. N-05 — ya no hace falta guardar y volver a entrar: se
          eligen ahora y suben con el resto del formulario. */}
      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Materiales de la mentoría
        </h2>
        <p className="text-[13px] text-[#6b6b6b]">
          Guías, plantillas o ejercicios que tus alumnos usarán en clase. Se
          suben al guardar la mentoría.
        </p>
        <MaterialsPicker
          saved={savedMaterials}
          staged={stagedMaterials}
          onAdd={(files) =>
            setStagedMaterials((prev) => [...prev, ...files.map(stage)])
          }
          onRemoveStaged={(key) =>
            setStagedMaterials((prev) => prev.filter((s) => s.key !== key))
          }
          onRemoveSaved={removeSavedMaterial}
          disabled={loading}
        />
      </PanelCard>

      {/* FAQ de ESTA mentoría (R24-17). Las del PERFIL del tutor (EY-194) se
          siguen pintando debajo en la ficha pública, pero su editor está
          OCULTO desde el 28-ago: aquí ya no se enlaza. Las genéricas de
          plataforma solo salen si no hay ni unas ni otras. */}
      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Preguntas frecuentes
        </h2>
        <p className="text-[13px] text-[#6b6b6b]">
          Responde lo que suelen preguntarte sobre esta mentoría (nivel previo,
          materiales, formato…). Si la dejas vacía se muestran las generales.
        </p>

        {faqs.map((f, i) => (
          <div
            key={i}
            className="grid gap-2 rounded-[12px] border border-[#e0e0e0] p-3.5"
          >
            <Input
              value={f.q}
              onChange={(e) =>
                setFaqs((p) =>
                  p.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)),
                )
              }
              placeholder="¿Necesito conocimientos previos?"
              aria-label={`Pregunta ${i + 1}`}
              className={FIELD}
            />
            <Textarea
              value={f.a}
              onChange={(e) =>
                setFaqs((p) =>
                  p.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)),
                )
              }
              rows={2}
              placeholder="Tu respuesta…"
              aria-label={`Respuesta ${i + 1}`}
              className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setFaqs((p) => p.filter((_, j) => j !== i))}
              className="h-9 self-start rounded-[8px] px-3 text-[13px] text-[#bf3333]"
            >
              Quitar
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={() => setFaqs((p) => [...p, { q: "", a: "" }])}
          className="h-10 self-start rounded-[8px] px-4 text-[13px]"
        >
          + Añadir pregunta
        </Button>
      </PanelCard>

      {/* M-02 · va aquí, pegado a la política de cancelación y justo encima de
          los botones: las dos tarjetas hablan de lo que pasa DESPUÉS de que el
          alumno pague, y esta es la única de las dos que el tutor decide. En el
          camino a «Publicar», no escondida entre los campos de contenido. */}
      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Cómo se confirman las reservas
        </h2>
        <p className="text-[13px] text-[#6b6b6b]">
          Se decide en cada mentoría: puedes filtrar a mano quién entra en una y
          dejar que otra se confirme sola.
        </p>
        <AcceptanceMode
          value={autoAccept}
          onChange={setAutoAccept}
          disabled={loading}
        />
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
