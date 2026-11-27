import Image from "next/image";
import Link from "next/link";
import { CalendarIcon, ClockIcon, StarIcon, UsersIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { bookingTotal, formatSessionTime, isUpcoming, tutorCards } from "@/lib/booking";
import { franjasDe, franjasLabel, zonaLabel } from "@/lib/clasificados";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import { listApprovedTutors } from "@/lib/catalog/queries";
import type { FormatoHora } from "@/lib/hora";
import type { Json } from "@/lib/database.types";
import { StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { Precio } from "@/components/precio/precio";
import { TutorCard } from "@/components/catalog/tutor-card";
import { Button } from "@/components/ui/button";
import { AccionesClasificado } from "./acciones";
import { AbrirChatButton } from "@/components/chat/abrir-chat-button";
import { cajaLateral, DatoFicha, FichaClasificado, SeccionFicha } from "./ficha";
import { IrAlAncla } from "./ir-al-ancla";

export type ClasificadoPropio = {
  id: string;
  goal: string;
  detail: string | null;
  slots: Json;
  timezone: string;
  needed_by: string | null;
  status: string;
  expires_at: string;
  created_at: string;
  categories: { name: string; slug: string; icon: string | null } | null;
};

export const ESTADO_CLASIFICADO: Record<string, { label: string; tone: PillTone }> = {
  active: { label: "Activo", tone: "green" },
  reserved: { label: "Reservado", tone: "blue" },
  expired: { label: "Vencido", tone: "amber" },
  closed: { label: "Cerrado", tone: "neutral" },
  removed: { label: "Retirado", tone: "red" },
};

/** `needed_by` es una fecha de calendario, no un instante: se pinta sin zona. */
function fechaCalendario(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** Lo que ve el alumno de SU clasificado: estado, lo que pidió y quién postuló. */
export async function VistaAlumno({
  request: r,
  timeZone,
  formato,
}: {
  request: ClasificadoPropio;
  timeZone: string;
  formato: FormatoHora;
}) {
  const supabase = await createClient();
  const estado = ESTADO_CLASIFICADO[r.status] ?? { label: r.status, tone: "gray" as const };
  const categoria = r.categories;

  const [props, tutores] = await Promise.all([
    supabase
      .from("class_proposals")
      .select(
        "id, status, start_at, product_id, booking_id, conversation_id, note, tutor_id, products(title, pricing_model, price_amount, currency, session_duration_min)",
      )
      .eq("request_id", r.id)
      .in("status", ["pending", "paid"])
      .order("created_at", { ascending: true }),
    categoria
      ? listApprovedTutors({ categorySlug: categoria.slug, page: 1 })
      : Promise.resolve({ tutors: [] }),
  ]);
  // Regla de oro 10: un fallo NO se pinta como «sin postulaciones».
  if (props.error) console.error("[clasificados/id] postulaciones", props.error);
  const postulaciones = props.data ?? [];
  const fichas = await tutorCards(
    supabase,
    postulaciones.map((p) => p.tutor_id),
  );
  const franjas = franjasDe(r.slots);
  const vivo = r.status === "active";

  return (
    <FichaClasificado
      categoria={categoria}
      titulo={r.goal}
      datos={
        <>
          <DatoFicha>
            <CalendarIcon className="size-3.5" aria-hidden />
            {r.needed_by ? `Para el ${fechaCalendario(r.needed_by)}` : "Fecha flexible"}
          </DatoFicha>
          {franjas.length > 0 ? (
            <DatoFicha>
              <ClockIcon className="size-3.5" aria-hidden />
              {franjasLabel(franjas)} ({zonaLabel(r.timezone)})
            </DatoFicha>
          ) : null}
          <DatoFicha>
            <UsersIcon className="size-3.5" aria-hidden />
            {postulaciones.length === 1 ? "1 postulación" : `${postulaciones.length} postulaciones`}
          </DatoFicha>
        </>
      }
      lateral={
        <div className={`${cajaLateral} flex flex-col gap-3`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-[#242424]">Tu clasificado</p>
            <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
          </div>
          {vivo ? (
            <p className="text-[13px] text-muted-foreground first-letter:uppercase">
              Recibe postulaciones hasta el {formatSessionTime(r.expires_at, timeZone, formato)}
            </p>
          ) : r.status === "expired" ? (
            <p className="text-[13px] text-muted-foreground">
              Venció el {formatSessionTime(r.expires_at, timeZone, formato)}. Puedes volver a
              publicarlo.
            </p>
          ) : null}
          <AccionesClasificado
            id={r.id}
            puedeCerrar={r.status === "active" || r.status === "expired"}
            puedeRepublicar={r.status === "expired"}
          />
          <Link href="/clasificados/mios" className="text-[13px] font-medium text-brand hover:underline">
            ← Mis clasificados
          </Link>
        </div>
      }
    >
      {r.detail ? (
        <SeccionFicha titulo="Lo que quieres lograr">
          <p className="text-sm whitespace-pre-line text-[#3d3d3d]">{r.detail}</p>
        </SeccionFicha>
      ) : null}

      <IrAlAncla />
      <SeccionFicha
        titulo={`Postulaciones${postulaciones.length > 0 ? ` (${postulaciones.length})` : ""}`}
      >

        {props.error ? (
          <p className="text-sm text-destructive">
            No pudimos cargar las postulaciones. Recarga la página en un momento.
          </p>
        ) : postulaciones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {vivo
              ? `Todavía nadie postuló. Ya avisamos a los tutores de ${categoria?.name ?? "la categoría"}: cuando uno te proponga una clase, la verás aquí y te llegará un aviso.`
              : "Este clasificado no tiene postulaciones vigentes."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {postulaciones.map((p) => {
              const t = fichas.get(p.tutor_id);
              const o = p.products;
              const nombre = t?.displayName ?? t?.headline ?? "Tutor";
              const avatar = storageUrl("avatars", t?.avatarPath ?? null);
              const checkout = `/reservar/${p.product_id}/checkout?slots=${encodeURIComponent(
                new Date(p.start_at).toISOString(),
              )}`;
              return (
                <li key={p.id} id={`postulacion-${p.id}`} className="flex scroll-mt-24 flex-col gap-3 rounded-[12px] border border-[#ebebeb] p-4 data-destacada:border-brand data-destacada:ring-2 data-destacada:ring-brand/30">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold">
                      {avatar ? (
                        <Image
                          src={avatar}
                          alt=""
                          width={44}
                          height={44}
                          className="size-11 object-cover"
                          unoptimized
                        />
                      ) : (
                        initialsFrom(nombre)
                      )}
                    </span>
                    <div className="min-w-0">
                      {t ? (
                        // `<a>`: la ficha es de otro grupo de rutas (regla de oro 13).
                        <a href={`/tutores/${t.id}`} className="font-semibold hover:underline">
                          {nombre}
                        </a>
                      ) : (
                        <p className="font-semibold">{nombre}</p>
                      )}
                      {t && t.ratingCount > 0 && t.ratingAvg != null ? (
                        <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
                          <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
                          {t.ratingAvg.toFixed(1)} ({t.ratingCount})
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {p.note ? <p className="text-[13px] italic">«{p.note}»</p> : null}

                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{o?.title ?? "Mentoría"}</p>
                      <p className="text-[13px] first-letter:uppercase">
                        {formatSessionTime(p.start_at, timeZone, formato)}
                        {o?.session_duration_min ? ` · ${o.session_duration_min} min` : null}
                      </p>
                    </div>
                    {o ? (
                      <div className="text-right">
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
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {p.status === "paid" ? (
                      <p className="text-[13px] font-semibold text-emerald-700">
                        ✓ Reservada{" "}
                        {p.booking_id ? (
                          <a href={`/reservas/${p.booking_id}`} className="font-normal text-brand underline">
                            Ver la reserva
                          </a>
                        ) : null}
                      </p>
                    ) : !isUpcoming(p.start_at) ? (
                      <p className="text-[13px] text-muted-foreground">
                        Este horario ya pasó: pídele otro por el chat.
                      </p>
                    ) : vivo ? (
                      <Button asChild className="h-9 rounded-[8px] text-[13px] font-semibold">
                        {/* `<a>`: el checkout cuelga de otro grupo de rutas (regla de oro 13). */}
                        <a href={checkout}>Pagar y reservar</a>
                      </Button>
                    ) : null}
                    <AbrirChatButton conversationId={p.conversation_id} variant="outline" className="h-9 rounded-[8px] text-[13px]">
                      Abrir chat
                    </AbrirChatButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SeccionFicha>

      {categoria && tutores.tutors.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[18px] font-bold text-[#19191f]">Tutores de {categoria.name}</h2>
            <a href={`/categorias/${categoria.slug}?tab=tutores`} className="text-[13px] text-brand underline">
              Ver todos
            </a>
          </div>
          <p className="-mt-2 text-[13px] text-muted-foreground">
            Mientras llegan las postulaciones, también puedes escribirles o reservar directamente.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            {tutores.tutors.slice(0, 4).map((t) => (
              <TutorCard key={t.id} tutor={t} />
            ))}
          </div>
        </section>
      ) : null}
    </FichaClasificado>
  );
}
