"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon, PlusIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const WEEKDAYS = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
]; // 0=domingo (Doc 1 §1.4.8)

/** Orden de lectura del Figma (194:48): Lunes…Domingo. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ENTRE_SEMANA = [1, 2, 3, 4, 5];

export type Rule = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

const hhmm = (t: string) => t.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'

/** Minutos de una franja, para poder decir cuántas horas suma la semana. */
function minutos(r: Rule): number {
  const [h1, m1] = hhmm(r.start_time).split(":").map(Number);
  const [h2, m2] = hhmm(r.end_time).split(":").map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
}

function horasSemana(rules: Rule[]): string {
  const total = rules.reduce((n, r) => n + minutos(r), 0);
  if (total === 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * US-501 (SCR-TU05) — horario semanal del tutor.
 *
 * Rehecho el 7-ago porque era difícil de entender, y por tres motivos
 * concretos, no por gusto:
 *
 * 1. Había DOS acciones con casi la misma palabra: «+ Añadir» abría el
 *    formulario y «Agregar» lo enviaba. Ahora el disparador es un icono «+»
 *    (con su etiqueta accesible) y solo queda UNA palabra visible: «Añadir
 *    franja», en el botón que de verdad añade.
 * 2. Cada día llevaba su propio `<details>`, así que se podían quedar SIETE
 *    formularios idénticos abiertos a la vez y la pantalla dejaba de leerse.
 *    Ahora es un acordeón: como mucho un día abierto.
 * 3. Faltaba lo primero que quiere hacer cualquier tutor —«de lunes a viernes,
 *    lo mismo»— y había que repetir la franja cinco veces a mano. Un día con
 *    horario ya puesto ofrece copiarlo, saltándose los duplicados.
 *
 * N-04 · desde que la disponibilidad se elige por mentoría, una franja puede
 * tener mentorías colgando. Borrarla ya no es una operación local: ver
 * `pedirBorrado`.
 */
export function AvailabilityManager({
  userId,
  rules,
  usedBy = {},
}: {
  userId: string;
  rules: Rule[];
  /** N-04 · rule_id → títulos de las mentorías que usan esa franja. */
  usedBy?: Record<string, string[]>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Un solo día abierto: es lo que impide que vuelvan los siete formularios.
  const [abierto, setAbierto] = useState<number | null>(null);
  const [copiando, setCopiando] = useState<number | null>(null);
  // Franja pendiente de confirmar borrado (solo las que usa alguna mentoría).
  const [borrando, setBorrando] = useState<Rule | null>(null);

  const byDay = new Map<number, Rule[]>();
  for (const r of rules) {
    const list = byDay.get(r.weekday);
    if (list) list.push(r);
    else byDay.set(r.weekday, [r]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  async function addRule(weekday: number, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const start = String(data.get("start") ?? "");
    const end = String(data.get("end") ?? "");
    if (!start || !end || end <= start) {
      return toast.error("La hora de fin debe ser mayor a la de inicio.");
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert({
      tutor_id: userId,
      weekday,
      start_time: start,
      end_time: end,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "No se pudo guardar el horario.");
    toast.success(`Franja añadida el ${WEEKDAYS[weekday].toLowerCase()}.`);
    form.reset();
    setAbierto(null);
    router.refresh();
  }

  /**
   * N-04 · el aspa ya no borra siempre a la primera.
   *
   * Si de esta franja cuelga alguna mentoría, borrarla arrastra el enlace (FK
   * `on delete cascade`) y, si era el único de esa mentoría, la mentoría pasa a
   * ofrecerse en TODA la disponibilidad del tutor. Es decir: quitar un horario
   * puede ABRIR una oferta en lugar de cerrarla, y no hay forma de deducirlo
   * mirando esta pantalla. Sin mentorías detrás, el borrado sigue siendo
   * inmediato como siempre — confirmar lo que no tiene consecuencias solo
   * enseña a pulsar «sí» sin leer.
   */
  function pedirBorrado(rule: Rule) {
    if ((usedBy[rule.id] ?? []).length > 0) setBorrando(rule);
    else removeRule(rule.id);
  }

  async function removeRule(id: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").delete().eq("id", id);
    setBusy(false);
    if (error) return toast.error("No se pudo eliminar.");
    setBorrando(null);
    router.refresh();
  }

  /**
   * Copia el horario de un día a otros. Salta los que ya tengan esa misma
   * franja: repetir «lunes a viernes» dos veces no debe duplicar nada, y es
   * justo lo que alguien hace cuando no está seguro de si ya pulsó.
   */
  async function copiar(desde: number, hacia: number[]) {
    const origen = byDay.get(desde) ?? [];
    if (origen.length === 0) return;

    const nuevas = hacia.flatMap((day) => {
      const yaTiene = byDay.get(day) ?? [];
      return origen
        .filter(
          (r) =>
            !yaTiene.some(
              (e) => e.start_time === r.start_time && e.end_time === r.end_time,
            ),
        )
        .map((r) => ({
          tutor_id: userId,
          weekday: day,
          start_time: r.start_time,
          end_time: r.end_time,
        }));
    });

    if (nuevas.length === 0) {
      setCopiando(null);
      return toast.info("Esos días ya tenían este horario.");
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert(nuevas);
    setBusy(false);
    setCopiando(null);
    if (error) return toast.error(error.message || "No se pudo copiar el horario.");
    toast.success(`Horario copiado a ${hacia.length} días.`);
    router.refresh();
  }

  const total = horasSemana(rules);

  return (
    <div>
      {total ? (
        <p className="mb-3 text-[13px] text-[#6b6b6b]">
          Abres <strong className="font-semibold text-[#333333]">{total}</strong> a
          la semana.
        </p>
      ) : (
        <p className="mb-3 text-[13px] text-[#6b6b6b]">
          Todavía no tienes horarios. Añade al menos uno para que puedan
          reservarte.
        </p>
      )}

      <div className="divide-y divide-[#e0e0e0]">
        {DISPLAY_ORDER.map((day) => {
          const list = byDay.get(day) ?? [];
          const vacio = list.length === 0;
          const estaAbierto = abierto === day;
          const otros = DISPLAY_ORDER.filter((d) => d !== day);

          return (
            <div key={day} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span
                  className={`w-24 shrink-0 text-sm font-medium ${
                    vacio ? "text-[#9c9c9c]" : "text-[#333333]"
                  }`}
                >
                  {WEEKDAYS[day]}
                </span>

                {vacio ? (
                  <span className="text-[13px] text-[#9c9c9c]">Cerrado</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {list.map((r) => {
                      const usada = usedBy[r.id] ?? [];
                      return (
                        <span
                          key={r.id}
                          className={`group/chip inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${
                            r.is_active
                              ? "bg-brand/10 text-[#0b4f96]"
                              : "bg-muted text-[#9c9c9c] line-through"
                          }`}
                        >
                          {hhmm(r.start_time)}–{hhmm(r.end_time)}
                          {/* N-04 · quién depende de esta franja. El detalle va
                              en `title` para no llenar la línea de títulos de
                              mentoría, pero el número se ve sin pasar el ratón:
                              es lo que distingue una franja suelta de una que
                              sostiene una oferta. */}
                          {usada.length > 0 ? (
                            <span
                              className="text-[#4d7fb0]"
                              title={`La usan: ${usada.join(", ")}`}
                            >
                              · {usada.length}{" "}
                              {usada.length === 1 ? "mentoría" : "mentorías"}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Quitar la franja de ${hhmm(r.start_time)} a ${hhmm(r.end_time)} del ${WEEKDAYS[r.weekday].toLowerCase()}`}
                            disabled={busy}
                            onClick={() => pedirBorrado(r)}
                            className="text-[#7aa8d6] transition-colors hover:text-destructive"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </span>
                )}

                <span className="ml-auto flex items-center gap-1">
                  {/* Copiar solo aparece si hay algo que copiar. */}
                  {!vacio ? (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Copiar el horario del ${WEEKDAYS[day].toLowerCase()} a otros días`}
                      aria-expanded={copiando === day}
                      onClick={() => {
                        setCopiando(copiando === day ? null : day);
                        setAbierto(null);
                      }}
                      className="grid size-8 place-items-center rounded-full text-[#6b6b6b] transition-colors hover:bg-muted hover:text-brand"
                    >
                      <CopyIcon className="size-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Añadir una franja el ${WEEKDAYS[day].toLowerCase()}`}
                    aria-expanded={estaAbierto}
                    onClick={() => {
                      setAbierto(estaAbierto ? null : day);
                      setCopiando(null);
                    }}
                    className={`grid size-8 place-items-center rounded-full transition-colors ${
                      estaAbierto
                        ? "bg-brand text-white"
                        : "text-[#6b6b6b] hover:bg-muted hover:text-brand"
                    }`}
                  >
                    <PlusIcon className="size-4" />
                  </button>
                </span>
              </div>

              {estaAbierto ? (
                <form
                  onSubmit={(e) => addRule(day, e)}
                  className="mt-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-muted p-3"
                >
                  <label className="text-[13px] text-[#6b6b6b]">
                    De{" "}
                    <input
                      name="start"
                      type="time"
                      defaultValue="09:00"
                      required
                      className="h-9 rounded-[8px] border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring"
                    />
                  </label>
                  <label className="text-[13px] text-[#6b6b6b]">
                    a{" "}
                    <input
                      name="end"
                      type="time"
                      defaultValue="10:00"
                      required
                      className="h-9 rounded-[8px] border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring"
                    />
                  </label>
                  {/* La ÚNICA palabra visible para esta acción. */}
                  <Button
                    type="submit"
                    disabled={busy}
                    className="ml-auto h-9 rounded-[8px] px-4 text-[13px]"
                  >
                    Añadir franja
                  </Button>
                </form>
              ) : null}

              {copiando === day ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[12px] bg-muted p-3">
                  <span className="text-[13px] text-[#6b6b6b]">
                    Copiar este horario a
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => copiar(day, ENTRE_SEMANA.filter((d) => d !== day))}
                    className="h-8 rounded-full bg-card px-3 text-[13px]"
                  >
                    Lunes a viernes
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => copiar(day, otros)}
                    className="h-8 rounded-full bg-card px-3 text-[13px]"
                  >
                    Toda la semana
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* N-04 · confirmación en un diálogo de la app y no en `window.confirm()`,
          por lo mismo que se explica en `tutor/reservas/booking-actions.tsx`:
          tras varios nativos seguidos el navegador ofrece bloquearlos y desde
          ahí `confirm()` devuelve false sin preguntar. */}
      <Dialog
        open={!!borrando}
        onOpenChange={busy ? undefined : (open) => !open && setBorrando(null)}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>¿Quitar esta franja?</DialogTitle>
            <DialogDescription>
              {borrando ? (
                <>
                  La usan{" "}
                  <strong className="font-semibold">
                    {(usedBy[borrando.id] ?? []).join(", ")}
                  </strong>
                  . Si es el único horario de alguna de ellas, esa mentoría
                  volverá a ofrecerse en toda tu disponibilidad. Las clases ya
                  reservadas no se tocan.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setBorrando(null)}
            >
              No, volver
            </Button>
            <Button
              disabled={busy}
              onClick={() => borrando && removeRule(borrando.id)}
              className="bg-[#bf3333] font-semibold text-white hover:bg-[#a82c2c]"
            >
              {busy ? "Quitando…" : "Sí, quitar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
