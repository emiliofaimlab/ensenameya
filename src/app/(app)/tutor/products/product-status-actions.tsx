"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontalIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
// De `panel-controls` y NO del reexport de `panel-shell`: esto es cliente y
// `panel-shell` arrastraría el armazón entero del panel al bundle (mismo
// motivo que `chat-button.tsx`).
import { PanelIconButton } from "@/components/layout/panel-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Status = Database["public"]["Enums"]["product_status"];

type Action = {
  label: string;
  to: Status;
  /** Lo que se dice al terminar. Nombrar la acción evita el «Producto
   *  actualizado» genérico, que obliga a volver a mirar la tarjeta. */
  done: string;
  needsApproval?: boolean;
  confirm?: string;
};

// M3 (Doc 2 §2.6) — transiciones válidas por estado. `archived` es terminal
// (no se reactiva; se clona para reusar → «Duplicar», que es lo que hace ese
// clonado posible sin volver a escribir la mentoría entera). Publicar/Reanudar
// exigen tutor `approved` (RN-23), lo respalda el trigger
// `products_publish_guard` en BD.
// ponytail: la matriz vive en la UI; el único guard con dientes (RN-23) está en
// BD. Un guard de matriz completo en BD se añade si aparece escritura no-UI.
const ACTIONS: Record<Status, Action[]> = {
  draft: [
    {
      label: "Publicar",
      to: "active",
      done: "Mentoría publicada.",
      needsApproval: true,
    },
    {
      label: "Descartar",
      to: "archived",
      done: "Borrador descartado.",
      confirm: "¿Descartar este borrador? Es definitivo.",
    },
  ],
  active: [
    { label: "Pausar", to: "paused", done: "Mentoría pausada." },
    {
      label: "Archivar",
      to: "archived",
      done: "Mentoría archivada.",
      confirm: "¿Archivar? Es definitivo, no se reactiva.",
    },
  ],
  paused: [
    {
      label: "Reanudar",
      to: "active",
      done: "Mentoría reanudada.",
      needsApproval: true,
    },
    {
      label: "Archivar",
      to: "archived",
      done: "Mentoría archivada.",
      confirm: "¿Archivar? Es definitivo, no se reactiva.",
    },
  ],
  archived: [],
};

/**
 * Columnas que viaja una copia. Lista EXPLÍCITA y no un `select("*")`: la tabla
 * tiene `search_vector` (generada, el insert la rechaza), `slug` y `created_at`,
 * y copiar a ciegas rompería el día que alguien añada otra columna calculada.
 *
 * Lo que a propósito NO se copia:
 *   · `status` → la copia nace SIEMPRE como borrador, aunque el original esté
 *     publicado. Duplicar no puede ser una forma de publicar sin revisar.
 *   · los materiales (`tutor_materials`) → son ficheros de un bucket privado,
 *     no filas; copiarlos sería duplicarlos en Storage.
 *   · `image_path` SÍ se copia, y las dos mentorías comparten el objeto del
 *     bucket. Es seguro hoy porque nada borra una portada al reemplazarla
 *     (`product-form.tsx` solo llama a `remove()` para deshacer una subida que
 *     acaba de fallar). Si algún día se borra la vieja al cambiarla, esto tiene
 *     que pasar a copiar el fichero.
 */
const COPIABLES =
  "title, tutor_id, description, outcome, pricing_model, price_amount, currency, session_duration_min, start_time_increment_min, package_num_sessions, level, language, faqs, requirements, auto_accept_bookings, cancellation_policy, image_path";

/**
 * §2.3 · Las acciones de la tarjeta dejan de ser botones de texto y se meten
 * en un «···» de 36 px, el tercero de los tres iconos.
 *
 * ⚠️ El disparador tiene que ser un `<button>` —con un `<a>` el teclado no abre
 * el menú y no hay `aria-expanded`—, así que va `PanelIconButton asChild` sobre
 * el `DropdownMenuTrigger` de Radix: el elemento correcto lo pone Radix y las
 * clases siguen viviendo en un solo fichero. Estuvieron COPIADAS aquí hasta que
 * `PanelIconButton` aceptó `asChild`, y esa copia es justo lo que dejaba al
 * «···» distinto de sus dos hermanos el día que cambiara el borde o el radio.
 */
export function ProductStatusActions({
  productId,
  title,
  status,
  isApproved,
}: {
  productId: string;
  /** Solo para la etiqueta: con cuatro tarjetas hay cuatro «Más acciones». */
  title: string;
  status: Status;
  isApproved: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const actions = ACTIONS[status];

  async function run(a: Action) {
    if (a.needsApproval && !isApproved) {
      toast.error("Tu perfil de tutor debe estar aprobado para publicar.");
      return;
    }
    if (a.confirm && !window.confirm(a.confirm)) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("products")
      .update({ status: a.to })
      .eq("id", productId);
    setBusy(false);

    if (error) {
      // El guard RN-23 (BD) rechaza publicar sin aprobación aunque se fuerce.
      toast.error(error.message || "No se pudo actualizar la mentoría.");
      return;
    }
    toast.success(a.done);
    router.refresh();
  }

  /**
   * Duplicar: la copia nace como BORRADOR y se abre su edición.
   *
   * Son cuatro escrituras seguidas y no una transacción —no hay transacciones
   * de cliente—, así que el orden importa: primero la mentoría (si falla, no ha
   * pasado nada) y después categorías y franjas, cuyo fallo se nombra por su
   * EFECTO y no por su tabla, porque es lo que el tutor va a ver al abrir la
   * copia. La copia existe igualmente: se abre y se corrige a mano, que es
   * mejor que dejarla a medias sin decirlo.
   */
  async function duplicar() {
    setBusy(true);
    const supabase = createClient();

    const { data: orig, error: leerErr } = await supabase
      .from("products")
      .select(COPIABLES)
      .eq("id", productId)
      .single();
    if (leerErr || !orig) {
      setBusy(false);
      toast.error(leerErr?.message || "No pudimos leer la mentoría original.");
      return;
    }

    const { title, ...resto } = orig;
    const { data: copia, error: insErr } = await supabase
      .from("products")
      .insert({ ...resto, title: `${title} (copia)`, status: "draft" })
      .select("id")
      .single();
    if (insErr || !copia) {
      setBusy(false);
      toast.error(insErr?.message || "No se pudo duplicar la mentoría.");
      return;
    }

    const [{ data: cats }, { data: franjas }] = await Promise.all([
      supabase
        .from("product_categories")
        .select("category_id")
        .eq("product_id", productId),
      supabase
        .from("product_availability_rules")
        .select("rule_id")
        .eq("product_id", productId),
    ]);

    const aMedias: string[] = [];
    if (cats?.length) {
      const { error } = await supabase.from("product_categories").insert(
        cats.map((c) => ({ product_id: copia.id, category_id: c.category_id })),
      );
      if (error) aMedias.push("las categorías");
    }
    if (franjas?.length) {
      const { error } = await supabase.from("product_availability_rules").insert(
        franjas.map((r) => ({ product_id: copia.id, rule_id: r.rule_id })),
      );
      // Igual que en el formulario: se nombra lo que el tutor verá, no la tabla.
      if (error)
        aMedias.push("los horarios elegidos (queda en toda tu disponibilidad)");
    }

    setBusy(false);
    toast.success(
      aMedias.length
        ? `Copia creada como borrador, pero no pudimos traer ${aMedias.join(" ni ")}.`
        : "Copia creada como borrador.",
    );
    router.push(`/tutor/products/${copia.id}/edit`);
  }

  return (
    <DropdownMenu>
      {/* El título va en la etiqueta: los tres iconos se repiten tarjeta a
          tarjeta y es lo único que los distingue (2.4.4). */}
      <PanelIconButton asChild label={`Más acciones: ${title}`}>
        <DropdownMenuTrigger disabled={busy} className="disabled:opacity-50">
          <MoreHorizontalIcon aria-hidden className="size-4" />
        </DropdownMenuTrigger>
      </PanelIconButton>
      {/* ⚠️ `w-56` no es cosmético: `DropdownMenuContent` nace con
          `w-(--radix-dropdown-menu-trigger-width)`, o sea que sin esto el menú
          mediría los 36 px del disparador y las etiquetas saldrían partidas. */}
      <DropdownMenuContent align="end" className="w-56">
        {actions.map((a) => {
          const blocked = a.needsApproval && !isApproved;
          return (
            <DropdownMenuItem
              key={a.label}
              disabled={busy || blocked}
              // Archivar y descartar son definitivos: van en rojo para que no
              // se pulsen por inercia al buscar «Pausar».
              variant={a.to === "archived" ? "destructive" : "default"}
              onSelect={() => void run(a)}
            >
              {a.label}
              {blocked ? " (requiere perfil aprobado)" : ""}
            </DropdownMenuItem>
          );
        })}
        {actions.length ? <DropdownMenuSeparator /> : null}
        {/* Duplicar existe en los CUATRO estados, archivada incluida: es la
            única salida de un estado terminal (Doc 2 §2.6). */}
        <DropdownMenuItem disabled={busy} onSelect={() => void duplicar()}>
          Duplicar
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
