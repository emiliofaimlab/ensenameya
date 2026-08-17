import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { PanelCard } from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { AvailabilityManager } from "./availability-manager";
import { ExceptionsManager } from "./exceptions-manager";

export const metadata = { title: "Mi disponibilidad · Enséñame Ya" };

const WEEKDAY_HEAD = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * US-501/502 (SCR-TU05) — disponibilidad del tutor con el layout del Figma:
 * reglas semanales agrupadas por día (izquierda) y, a la derecha, un
 * calendario del mes que pinta en azul los días con regla activa y en ámbar
 * los que tienen excepción (194:107), más las excepciones puntuales.
 */
export default async function TutorAvailabilityPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  const [{ data: rules }, { data: exceptions }, { data: products }, { data: links }] =
    await Promise.all([
      supabase
        .from("availability_rules")
        .select("id, weekday, start_time, end_time, is_active")
        .eq("tutor_id", userId)
        .order("weekday")
        .order("start_time"),
      supabase
        .from("availability_exceptions")
        .select("id, date, type, start_time, end_time, reason")
        .eq("tutor_id", userId)
        .gte("date", new Date().toISOString().slice(0, 10))
        .order("date"),
      // N-04 · qué mentorías cuelgan de cada franja. Hace falta para avisar
      // ANTES de borrar: al desaparecer la franja desaparece su enlace (FK on
      // delete cascade), y si era el único de esa mentoría, la mentoría vuelve
      // a ofrecerse en TODA la disponibilidad del tutor. Borrar un horario
      // puede abrir una oferta en vez de cerrarla, y eso no se adivina.
      supabase.from("products").select("id, title").eq("tutor_id", userId),
      // Sin `.eq()`: la RLS de `product_availability_rules` ya lo acota a los
      // productos del propio tutor (política `..._write_own`, que al ser `for
      // all` cubre también el select).
      supabase.from("product_availability_rules").select("rule_id, product_id"),
    ]);

  // rule_id → títulos de las mentorías que la usan.
  const titleById = new Map((products ?? []).map((p) => [p.id, p.title]));
  const usedBy: Record<string, string[]> = {};
  for (const l of links ?? []) {
    const title = titleById.get(l.product_id);
    if (!title) continue; // producto de otro tutor: imposible por RLS, pero no se asume
    (usedBy[l.rule_id] ??= []).push(title);
  }

  // Calendario del mes ACTUAL: azul = weekday con regla activa; ámbar = fecha
  // con excepción. Server-render puro: pinta el estado, no navega meses.
  const activeWeekdays = new Set(
    (rules ?? []).filter((r) => r.is_active).map((r) => r.weekday),
  );
  const exceptionDates = new Set((exceptions ?? []).map((x) => x.date));

  const now = new Date();
  const monthLabel = now.toLocaleDateString("es", {
    month: "long",
    year: "numeric",
  });
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // rejilla que empieza en lunes
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from(
      { length: total },
      (_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1),
    ),
  ];
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <TutorShell
      title="Disponibilidad"
      description="Tus horarios se muestran en tu zona horaria. Los cambios se guardan al momento."
    >
      {approvalStatus !== "approved" ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Tus horarios serán visibles para los alumnos cuando tu perfil de
            tutor esté aprobado.
          </p>
        </PanelCard>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_364px]">
        <PanelCard>
          <h2 className="text-base font-semibold text-[#19191f]">
            Reglas recurrentes
          </h2>
          <p className="mt-1 text-xs text-[#6b6b6b]">
            Define aquí tus franjas; al crear cada mentoría eliges cuáles usa.
          </p>
          <div className="mt-4">
            <AvailabilityManager
              userId={userId}
              rules={rules ?? []}
              usedBy={usedBy}
            />
          </div>
        </PanelCard>

        <div className="flex flex-col gap-5">
          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f] first-letter:uppercase">
              Calendario · {monthLabel}
            </h2>
            <div className="mt-4 grid grid-cols-7 gap-1.5 text-center">
              {WEEKDAY_HEAD.map((d, i) => (
                <span key={i} className="text-xs text-[#6b6b6b]">
                  {d}
                </span>
              ))}
              {cells.map((d, i) => {
                if (!d) return <span key={`x${i}`} />;
                const hasRule = activeWeekdays.has(d.getDay());
                const hasExc = exceptionDates.has(iso(d));
                return (
                  <span
                    key={iso(d)}
                    className={cn(
                      "grid h-9 place-items-center rounded-[8px] border border-[#e0e0e0] text-xs font-medium",
                      hasExc
                        ? "bg-[#faedcc] text-[#a67314]"
                        : hasRule
                          ? "bg-[#dbedff] text-brand"
                          : "bg-card text-[#595959]",
                    )}
                  >
                    {d.getDate()}
                  </span>
                );
              })}
            </div>
            <div className="mt-4 flex gap-4 text-xs text-[#6b6b6b]">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-brand" />
                Disponible
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#a67314]" />
                Excepción
              </span>
            </div>
          </PanelCard>

          <PanelCard>
            <h2 className="text-base font-semibold text-[#19191f]">
              Excepciones puntuales
            </h2>
            <p className="mt-1 text-xs text-[#6b6b6b]">
              Sobrescriben tu horario semanal en una fecha concreta.
            </p>
            <div className="mt-4">
              <ExceptionsManager userId={userId} exceptions={exceptions ?? []} />
            </div>
          </PanelCard>
        </div>
      </div>
    </TutorShell>
  );
}
