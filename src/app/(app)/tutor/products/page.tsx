import Image from "next/image";
import Link from "next/link";
import { EyeIcon, PencilIcon, TriangleAlertIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { initialsFrom, priceLabel, storageUrl } from "@/lib/catalog/format";
import {
  PanelCard,
  PanelIconButton,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { PanelFiltro } from "@/components/layout/panel-filtro";
import { Button } from "@/components/ui/button";
import { ProductStatusActions } from "./product-status-actions";
import type { Database } from "@/lib/database.types";

export const metadata = { title: "Mis mentorías · Enséñame Ya" };

type Status = Database["public"]["Enums"]["product_status"];

/** Píldoras del Figma (191:60/78/96): color por estado del producto. */
const STATUS_PILL: Record<string, { label: string; tone: PillTone }> = {
  active: { label: "Activo", tone: "green" },
  draft: { label: "Borrador", tone: "neutral" },
  paused: { label: "Pausado", tone: "amber" },
  archived: { label: "Archivado", tone: "neutral" },
};

/**
 * §2.2 · Chips de filtro con el estado en la URL (`?f=`), igual que Reservas.
 *
 * ⚠️ Los `id` NO son libres: son exactamente los que apuntan los subniveles de
 * «Mis mentorías» en `TUTOR_ITEMS` (`?f=activas`, `?f=pausadas`,
 * `?f=borradores`). Renombrar uno aquí deja tres entradas del menú cayendo al
 * filtro por defecto, o sea enseñando la lista entera y sin encender su chip.
 *
 * `archived` no tiene chip —el documento fija cuatro— y sigue saliendo en
 * «Todas», que es donde está hoy: es un estado terminal que el tutor consulta,
 * no una bandeja que trabaje.
 */
const FILTROS: {
  id: string;
  label: string;
  /** Cola de «No tienes mentorías …» cuando el filtro se queda sin nada. */
  vacio: string;
  match: (s: Status) => boolean;
}[] = [
  { id: "todas", label: "Todas", vacio: "que enseñar aquí", match: () => true },
  {
    id: "activas",
    label: "Activas",
    vacio: "activas",
    match: (s) => s === "active",
  },
  {
    id: "pausadas",
    label: "Pausadas",
    vacio: "pausadas",
    match: (s) => s === "paused",
  },
  {
    id: "borradores",
    label: "Borradores",
    vacio: "en borrador",
    match: (s) => s === "draft",
  },
];

/**
 * §2.1 · «4 mentorías · 2 se venden ahora mismo», con el singular y el plural
 * de verdad. «Se venden ahora mismo» = `status = 'active'`: es lo único que un
 * alumno puede encontrar y reservar hoy.
 */
function subtitulo(total: number, activas: number): string {
  const cuenta = `${total} ${total === 1 ? "mentoría" : "mentorías"}`;
  if (activas === 0) return `${cuenta} · ninguna se vende ahora mismo`;
  return `${cuenta} · ${activas} se ${activas === 1 ? "vende" : "venden"} ahora mismo`;
}

/**
 * US-401 (SCR-TU03) — Catálogo del tutor, en la forma que aprobó el cliente el
 * 8-sep-2026 (paquete «Panel del tutor v2», §2).
 *
 * Lo que cambió respecto a TU03: la cabecera cuenta (§2.1), aparecen los chips
 * de filtro (§2.2) y, dentro de la tarjeta —que se conserva con su aire—, las
 * cuatro líneas de texto se condensan en una línea de chips y las tres
 * acciones de texto pasan a tres botones-icono (§2.3).
 */
export default async function TutorProductsPage() {
  const { userId, approvalStatus } = await requireTutorProfile();
  // ⚠️ Ya no se lee `searchParams`: el filtro vive en el cliente
  // (`PanelFiltro`), igual que en Reservas. Un clic de chip ya no vuelve al
  // servidor a repetir estas tres consultas y las siete del menú para correr
  // un `Array.filter` sobre lo que el navegador ya tiene.

  const supabase = await createClient();
  const [
    { data: products, error },
    { data: rules, error: errorRules },
    { data: links, error: errorLinks },
  ] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, title, status, outcome, image_path, pricing_model, price_amount, currency, package_num_sessions, session_duration_min, auto_accept_bookings, product_categories(categories(name))",
      )
      .eq("tutor_id", userId)
      .order("created_at", { ascending: false }),
    // §2.3 · el aviso ámbar necesita saber qué franjas del tutor están VIVAS,
    // no solo cuáles existen: una franja desactivada no genera ni un horario,
    // así que una mentoría colgada solo de ella está tan huérfana como una
    // que no tenga ninguna.
    supabase
      .from("availability_rules")
      .select("id, is_active")
      .eq("tutor_id", userId),
    // Sin `.eq()`: la RLS de `product_availability_rules` ya lo acota a los
    // productos del propio tutor (misma llamada que en /tutor/availability).
    supabase.from("product_availability_rules").select("rule_id, product_id"),
  ]);

  // Regla de oro 10 · con `const { data }` a secas un fallo de la consulta se
  // convierte en lista vacía, que aquí sería una mentira creíble: el tutor
  // leería «aún no tienes mentorías» teniendo cinco publicadas.
  //
  // ⚠️ Y la misma regla vale para las OTRAS dos consultas, aunque no pinten
  // ninguna lista: si fallan, `rules` llega `null`, `franjasVivas` se queda
  // vacío y la cuenta de abajo declara huérfana a toda mentoría en «toda mi
  // disponibilidad» —que son las tres de dev— teniendo el tutor seis franjas
  // vivas. El resultado no sería un hueco: sería el aviso ámbar mintiendo en
  // todas las tarjetas. Un aviso que no se puede sostener con datos no se
  // pinta.
  const horariosIlegibles = Boolean(errorRules || errorLinks);
  const todas = products ?? [];
  const activas = todas.filter((p) => p.status === "active").length;

  /** Bajo qué chips se ve una mentoría. Ver `filtrosDe` en Reservas. */
  const filtrosDe = (s: Status) =>
    FILTROS.filter((x) => x.match(s))
      .map((x) => x.id)
      .join(" ");

  /**
   * §2.3 · ¿esta mentoría tiene alguna franja que la sirva?
   *
   * ⚠️ NO es «tiene filas en `product_availability_rules`», y confundirlo pinta
   * el aviso en tarjetas que están perfectamente: CERO filas es el modo «toda
   * mi disponibilidad» (`availability-blocks.tsx`), el más común —los tres
   * productos de dev están así— y significa que la mentoría se ofrece en TODAS
   * las franjas del tutor. Sin este matiz, el ámbar saldría en las tres.
   *
   * Huérfana de verdad hay dos formas: colgar solo de franjas desactivadas, o
   * estar en «toda mi disponibilidad» cuando esa disponibilidad está vacía. En
   * las dos el resultado es el mismo y es el que importa: cero horarios que
   * reservar.
   */
  const franjasVivas = new Set(
    (rules ?? []).filter((r) => r.is_active).map((r) => r.id),
  );
  const franjasDe: Record<string, string[]> = {};
  for (const l of links ?? []) (franjasDe[l.product_id] ??= []).push(l.rule_id);
  const sinHorario = (id: string) => {
    if (horariosIlegibles) return false;
    const suyas = franjasDe[id];
    if (!suyas?.length) return franjasVivas.size === 0;
    return !suyas.some((r) => franjasVivas.has(r));
  };

  return (
    <TutorShell
      userId={userId}
      title="Mis mentorías"
      // Con la lista vacía el recuento no informa de nada («0 mentorías ·
      // ninguna se vende ahora mismo» es la tarjeta de abajo dicha dos veces),
      // así que ahí se conserva la frase de siempre, que sí orienta.
      description={
        todas.length
          ? subtitulo(todas.length, activas)
          : "Crea y gestiona las mentorías que ofreces."
      }
      actions={
        <Button asChild className="h-[45px] rounded-[8px] px-5 font-semibold">
          <Link href="/tutor/products/new">Crear mentoría</Link>
        </Button>
      }
    >
      {approvalStatus !== "approved" ? (
        <PanelCard className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              Tu cuenta está en revisión
            </p>
            {/* Sin «(RN-23)»: es un código interno del repo y esto es lo único
                que el tutor va a leer con atención mientras espera. La
                trazabilidad vive en el comentario, no en la pantalla. */}
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
              Podrás publicar tus mentorías cuando aprobemos tu perfil. Mientras
              tanto puedes dejarlas guardadas como borrador.
            </p>
          </div>
          <StatusPill tone="blue">En revisión</StatusPill>
        </PanelCard>
      ) : null}

      {/* §2.2 + G-03 · chips con contador. El contador se cuenta sobre la lista
          ENTERA, no sobre la filtrada: un contador que solo sabe de lo que ya
          se ve no sirve para decidir a qué chip ir. Server-render puro.

          ⚠️ Se pintan SIEMPRE, también con el catálogo vacío. Aquí había un
          `{todas.length ? …}` que los escondía, y no estaba escrito en ninguna
          parte por qué: §2.2 no lo pide y manda mirar a Reservas («estado en la
          URL como en Reservas»), que los pinta sin condición. Con cero
          mentorías no se ve un «0 0 0 0» —`PanelCounter` no pinta el cero— sino
          las cuatro etiquetas, que es lo mismo que ve un tutor sin reservas en
          la otra pantalla. */}
      <PanelFiltro
        base="/tutor/products"
        etiqueta="Filtrar mentorías"
        sufijo={{ uno: "mentoría", varios: "mentorías" }}
        chips={FILTROS.map((x) => ({
          id: x.id,
          label: x.label,
          total: todas.filter((p) => x.match(p.status)).length,
          // G-03 · aquí NINGÚN chip va en naranja: el naranja está reservado a
          // lo que pide acción del tutor («Por aceptar» en Reservas), y un
          // catálogo no pide nada.
        }))}
      >
        {error ? (
          <PanelCard className="border-[#f0bfbf] bg-[#fdf5f5]">
            <p className="text-[13px] text-[#bf3333]">
              No pudimos cargar tus mentorías. Vuelve a intentarlo en un
              momento.
            </p>
          </PanelCard>
        ) : null}

        {!error && !todas.length ? (
          <PanelCard>
            <p className="text-[13px] text-[#6b6b6b]">
              Aún no tienes mentorías. Crea la primera para empezar a enseñar.
            </p>
            <Button asChild className="mt-4 h-10 rounded-[8px] font-semibold">
              <Link href="/tutor/products/new">Crear mi primera mentoría</Link>
            </Button>
          </PanelCard>
        ) : null}

        {/* «en este filtro» obliga a mirar arriba para saber de qué habla, y la
          etiqueta ya está aquí: se interpola. Uno por filtro vacío, porque el
          texto cambia con él y el servidor ya no sabe cuál está puesto — el
          `data-f` deja visible solo el que toca, y ninguno si el filtro tiene
          mentorías. */}
        {!error && todas.length > 0
          ? FILTROS.filter((x) => !todas.some((p) => x.match(p.status))).map(
              (x) => (
                <PanelCard key={x.id} data-f={x.id}>
                  <p className="text-[13px] text-[#6b6b6b]">
                    No tienes mentorías {x.vacio}.
                  </p>
                </PanelCard>
              ),
            )
          : null}

        {todas.length > 0 ? (
          <ul className="flex flex-col gap-4">
            {todas.map((p) => {
              const cats = (p.product_categories ?? [])
                .map((pc) => pc.categories?.name)
                .filter(Boolean);
              const thumb = storageUrl("product-images", p.image_path);
              const pill = STATUS_PILL[p.status] ?? {
                label: p.status,
                tone: "neutral" as const,
              };
              const huerfana = sinHorario(p.id);
              return (
                <li key={p.id} data-f={filtrosDe(p.status)}>
                  <PanelCard>
                    {/* N-12 · `flex-1` además de `min-w-0`: sin él el bloque
                      mide lo que mida el título y las acciones se salían de la
                      tarjeta con nombres largos. El mínimo es para el otro
                      extremo: por debajo de 200+124 px los tres iconos bajan de
                      línea en vez de estrujar el texto (el Figma no tiene
                      diseño móvil, decisión 24, así que esto es criterio
                      nuestro). */}
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                      <div className="flex min-w-[200px] flex-1 items-start gap-3.5">
                        {/* Miniatura 56×56 r12 (§2.3); iniciales si no hay. */}
                        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-brand-muted font-semibold text-brand">
                          {thumb ? (
                            <Image
                              src={thumb}
                              alt=""
                              width={56}
                              height={56}
                              className="size-14 object-cover"
                              unoptimized
                            />
                          ) : (
                            initialsFrom(p.title)
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14.5px] font-semibold text-[#19191f]">
                            {p.title}
                          </p>
                          {p.outcome ? (
                            <p className="mt-0.5 line-clamp-1 text-[12.5px] text-[#595959]">
                              Resultado: {p.outcome}
                            </p>
                          ) : null}
                          <p className="mt-0.5 text-xs text-[#6b6b6b]">
                            {priceLabel({
                              pricingModel: p.pricing_model,
                              priceAmount: p.price_amount,
                              currency: p.currency,
                              packageNumSessions: p.package_num_sessions,
                            })}
                            {p.session_duration_min
                              ? ` · ${p.session_duration_min} min`
                              : ""}
                            {cats.length ? ` · ${cats.join(", ")}` : ""}
                          </p>

                          {/* §2.3 · la línea de chips. Sustituye a las dos líneas
                            de texto que había (el modo de aceptación suelto y
                            la píldora de estado arriba a la derecha): dicen lo
                            mismo en un renglón y a la misma altura, que es
                            donde se comparan entre tarjetas.
                            M-02 · el modo de aceptación se decide mentoría a
                            mentoría desde que se retiró el interruptor global,
                            así que sigue a la vista —también en los borradores:
                            es justo antes de publicar cuando conviene mirarlo. */}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StatusPill tone="gray">
                              {p.auto_accept_bookings
                                ? "Automática"
                                : "Aceptación manual"}
                            </StatusPill>
                            {/* N-15 · la píldora decide su altura: nada de `h-*`. */}
                            <StatusPill tone={pill.tone}>
                              {pill.label}
                            </StatusPill>
                            {/* TODO · DP-2 — aquí va «N reservas en 30 días», y
                              falta decidir la ventana (30 días o total) y si se
                              enseña además la valoración media por mentoría.
                              El documento aprobado lo deja abierto en §8, así
                              que no se pinta un periodo inventado: en un panel
                              donde el tutor decide qué pausar, un número con la
                              ventana equivocada es peor que ningún número. */}
                          </div>

                          {/* §2.3 · aviso ámbar de la mentoría sin horario. Va
                            DENTRO de la tarjeta y no en un banner arriba
                            porque el problema es de esta mentoría concreta y
                            la acción también. */}
                          {/* El ámbar es `#8f6110` y no el `#a67314` del Figma:
                            ese daba 4,13:1 sobre el blanco de la tarjeta a
                            12,5 px y AA pide 4,5 (este da 5,41). Es la única
                            alerta de la pantalla; leerla no puede depender de
                            la luz que tenga el tutor encima. */}
                          {huerfana ? (
                            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[#8f6110]">
                              <TriangleAlertIcon
                                aria-hidden
                                className="size-3.5 shrink-0"
                              />
                              Sin franja de horario asignada ·{" "}
                              <Link
                                // Si el tutor no tiene NINGUNA franja viva, el
                                // paso de horarios de la mentoría no tiene nada
                                // que ofrecerle: lo que hay que arreglar está una
                                // pantalla más atrás. Mandarlo al formulario
                                // sería enseñarle una lista vacía y un aviso.
                                href={
                                  franjasVivas.size === 0
                                    ? "/tutor/availability"
                                    : `/tutor/products/${p.id}/edit#horarios`
                                }
                                className="font-semibold underline underline-offset-2"
                              >
                                Asignar
                              </Link>
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {/* §2.3 · tres botones-icono, sin separador ni botones de
                        texto. El orden es el del documento: ver · editar · más.

                        ⚠️ El título va DENTRO de la etiqueta de los tres: con
                        cuatro mentorías había doce botones que se llamaban
                        «Ver como alumno», «Editar mentoría» y «Más acciones»,
                        sin nada que dijera de cuál. Antes no dolía porque eran
                        botones de texto pegados al título; ahora están al otro
                        extremo de la fila (2.4.4). */}
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        {p.status === "active" ? (
                          /* `asChild` + `<Link>`: un `<a href>` a pelo recarga la
                           página entera, y es lo que hace el botón de al lado.
                           Lo advierte el propio `PanelIconButton`. */
                          <PanelIconButton
                            asChild
                            label={`Ver como alumno: ${p.title}`}
                          >
                            <Link href={`/products/${p.id}`}>
                              <EyeIcon aria-hidden className="size-4" />
                            </Link>
                          </PanelIconButton>
                        ) : (
                          /* La ficha pública solo existe para las activas
                           (`getProductDetail` filtra por `status = 'active'`,
                           también para su dueño): un ojo enlazado aquí llevaría
                           al 404. Se deja el hueco ocupado y apagado para que
                           los tres iconos no bailen entre tarjetas.

                           ⚠️ Y apagado es un `<button>`, no un `<a>` sin
                           `href`: a ese no llega el teclado y, al no tener rol,
                           el lector de pantalla se come el `aria-label` que
                           explica por qué está así (4.1.2). `aria-disabled` en
                           vez de `disabled` justo para que siga alcanzándose y
                           se pueda oír la razón. */
                          <PanelIconButton
                            asChild
                            label={`Ver como alumno: ${p.title} (disponible cuando la mentoría esté activa)`}
                            className="cursor-not-allowed opacity-45"
                          >
                            <button type="button" aria-disabled="true">
                              <EyeIcon aria-hidden className="size-4" />
                            </button>
                          </PanelIconButton>
                        )}
                        <PanelIconButton
                          asChild
                          label={`Editar mentoría: ${p.title}`}
                        >
                          <Link href={`/tutor/products/${p.id}/edit`}>
                            <PencilIcon aria-hidden className="size-4" />
                          </Link>
                        </PanelIconButton>
                        <ProductStatusActions
                          productId={p.id}
                          title={p.title}
                          status={p.status}
                          isApproved={approvalStatus === "approved"}
                        />
                      </div>
                    </div>
                  </PanelCard>
                </li>
              );
            })}
          </ul>
        ) : null}
      </PanelFiltro>
    </TutorShell>
  );
}
