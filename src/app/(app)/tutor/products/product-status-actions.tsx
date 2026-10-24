"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeIcon, MoreHorizontalIcon, Share2Icon } from "lucide-react";

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
import { CompartirMentoriaDialog } from "./compartir-mentoria";

type Status = Database["public"]["Enums"]["product_status"];
type PricingModel = Database["public"]["Enums"]["pricing_model"];

type Action = {
  label: string;
  to: Status;
  /** Lo que se dice al terminar. Nombrar la acción evita el «Producto
   *  actualizado» genérico, que obliga a volver a mirar la tarjeta. */
  done: string;
  needsApproval?: boolean;
  confirm?: string;
  /** Va en rojo (lo definitivo). Archivar lo es siempre. */
  destructive?: boolean;
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
 * RG-01 (24-oct) · la grupal que aparece aquí es la PLANTILLA: no tiene fechas
 * ni inscritos propios (los tienen las clases que nacen cuando un alumno elige
 * hora), así que se publica, pausa y archiva como cualquier mentoría. Pausarla
 * o archivarla solo impide que se abran clases NUEVAS: las ya nacidas siguen y
 * se gestionan (cancelar, mover, sacar a alguien) en su ficha,
 * `/tutor/clases-grupales/<clase>`. El menú propio de M16 (publicar con
 * fechas, «Cancelar la clase») se retiró con `publicar_clase_grupal`.
 */
const DONE_GRUPAL: Partial<Record<Status, string>> = {
  paused: "Clase pausada. Las clases ya programadas siguen en pie.",
  archived: "Clase archivada. Las clases ya programadas siguen en pie.",
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
// M16 · `capacity` y `min_seats` también: sin ellos la copia de una grupal
// violaba el check del cupo y «Duplicar» fallaba. En una 1:1 van nulos.
const COPIABLES =
  "title, tutor_id, description, outcome, pricing_model, price_amount, currency, session_duration_min, start_time_increment_min, package_num_sessions, level, language, faqs, requirements, auto_accept_bookings, cancellation_policy, image_path, capacity, min_seats";

/**
 * §2.3 · Las acciones de la tarjeta dejan de ser botones de texto y se meten
 * en un «···» de 36 px, el último de los iconos de la fila.
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
  pricingModel,
  isApproved,
  rutaCompartir,
}: {
  productId: string;
  /** Solo para la etiqueta: con cuatro tarjetas hay cuatro «Más acciones». */
  title: string;
  status: Status;
  /** RG-01 · en una grupal el aviso dice que las clases ya nacidas siguen. */
  pricingModel: PricingModel;
  isApproved: boolean;
  /**
   * EY-225 · `/mentorias/<id>` con el `?ref=` del tutor, resuelto en servidor
   * (`codigoParaCompartir`). Solo se usa con la mentoría activa.
   */
  rutaCompartir: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // EY-223 · el diálogo de compartir vive FUERA del menú (ver su cabecera).
  const [compartir, setCompartir] = useState(false);
  const actions = ACTIONS[status].map((a) =>
    pricingModel === "group" && DONE_GRUPAL[a.to] ? { ...a, done: DONE_GRUPAL[a.to]! } : a,
  );

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
    <>
      <DropdownMenu>
        {/* El título va en la etiqueta: los iconos se repiten tarjeta a
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
          {/* EY-225 · «Ver como alumno» vivía como un ojo suelto en la fila; ahora
            abre el menú, con «Compartir» al lado, que es lo que se hace con la
            ficha pública una vez vista.

            La ficha solo existe para las ACTIVAS (`getProductDetail` filtra por
            `status = 'active'`, también para su dueño): enlazarla en otro
            estado sería un 404. Fuera de `active` el ítem se queda, apagado y
            con la razón escrita.

            ⚠️ `aria-disabled` y NO `disabled`: Radix SALTA los ítems
            `disabled` al moverse con las flechas, y entonces el lector de
            pantalla nunca llega a oír por qué está apagado (4.1.2). Es el mismo
            criterio que tenía el ojo de la fila. `preventDefault` deja el menú
            abierto y sin hacer nada. */}
          {status === "active" ? (
            <>
              <DropdownMenuItem asChild>
                {/* `<Link>` y no `<a>`: un `<a href>` a pelo recarga la app
                  entera. Cruza de `(app)` a `(public)`, pero la ficha no tiene
                  guarda ni `redirect()` de servidor (regla 13). */}
                <Link href={`/mentorias/${productId}`}>
                  <EyeIcon aria-hidden />
                  Ver como alumno
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy}
                onSelect={() => setCompartir(true)}
              >
                <Share2Icon aria-hidden />
                Compartir mi mentoría
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              aria-disabled="true"
              onSelect={(e) => e.preventDefault()}
              className="cursor-not-allowed opacity-50 focus:bg-transparent"
            >
              <EyeIcon aria-hidden />
              <span>
                Ver como alumno
                <span className="block text-xs text-muted-foreground">
                  Disponible cuando la mentoría esté activa
                </span>
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {actions.map((a) => {
            const blocked = a.needsApproval && !isApproved;
            return (
              <DropdownMenuItem
                key={a.label}
                disabled={busy || blocked}
                // Archivar y descartar son definitivos: van en rojo para que no
                // se pulsen por inercia al buscar «Pausar».
                variant={a.to === "archived" || a.destructive ? "destructive" : "default"}
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
      {status === "active" ? (
        <CompartirMentoriaDialog
          open={compartir}
          onOpenChange={setCompartir}
          productId={productId}
          ruta={rutaCompartir}
          titulo={title}
        />
      ) : null}
    </>
  );
}
