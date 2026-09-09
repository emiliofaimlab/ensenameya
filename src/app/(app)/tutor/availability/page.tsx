import Link from "next/link";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { getUserTimezone } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { buildSlotPreview, buildUsedBy, horasSemana } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { AvailabilityManager } from "./availability-manager";
import { ExceptionsManager } from "./exceptions-manager";

export const metadata = { title: "Mi disponibilidad · Enséñame Ya" };

const WEEKDAY_HEAD = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * §3.1 (paquete v2) · «America/Bogotá (GMT−5) · ahora son las 14:32».
 *
 * ⚠️ Se traga los errores a propósito: `profiles.timezone` es texto libre —el
 * select del onboarding manda, pero no hay CHECK—, así que una zona inválida
 * haría reventar el render entero con un `RangeError`. Mismo criterio que
 * `horaLocalDelAlumno` en la ficha del alumno. Sin zona válida, la cabecera
 * dice lo que sabe y calla lo que no.
 *
 * El signo del offset se cambia por el menos tipográfico (−, U+2212): `Intl`
 * devuelve el guion de teclado y a 13 px se lee como un separador.
 */
function relojDeLaZona(timeZone: string): { hora: string; gmt: string } | null {
  try {
    const ahora = new Date();
    const hora = ahora.toLocaleTimeString("es", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });
    const gmt =
      new Intl.DateTimeFormat("es", { timeZone, timeZoneName: "shortOffset" })
        .formatToParts(ahora)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    return { hora, gmt: gmt.replace("-", "−") };
  } catch {
    return null;
  }
}

/**
 * US-501/502 (SCR-TU05) — disponibilidad del tutor con el layout del Figma:
 * reglas semanales agrupadas por día (izquierda) y, a la derecha, un
 * calendario del mes que pinta en azul los días con regla activa y en ámbar
 * los que tienen excepción (194:107), más las excepciones puntuales.
 *
 * §3 (paquete v2, 8-sep-2026) — es la pantalla que menos cambia. El calendario
 * se conserva TAL CUAL (solo disponibilidad y excepciones: ni agenda del día ni
 * clases reservadas). Lo que se mueve son las dos tarjetas de gestión: el
 * resumen de la semana sube a la cabecera y los formularios dejan de estar
 * siempre desplegados.
 */
export default async function TutorAvailabilityPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  const [{ data: rules }, { data: exceptions }, { data: products }, { data: links }, tz] =
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
      // Y también en qué convierte cada franja: la duración y el paso son lo que
      // decide si «08:00–17:00» son 9 clases de 60 o 18 de 30. Ver
      // `buildSlotPreview`.
      supabase
        .from("products")
        .select("id, title, session_duration_min, start_time_increment_min")
        .eq("tutor_id", userId),
      // Sin `.eq()`: la RLS de `product_availability_rules` ya lo acota a los
      // productos del propio tutor (política `..._write_own`, que al ser `for
      // all` cubre también el select).
      supabase.from("product_availability_rules").select("rule_id, product_id"),
      // §3.1 · la cabecera dice en QUÉ zona abre el tutor y qué hora es ahí
      // ahora. `getUserTimezone` prefiere `profiles.timezone` sobre la cookie
      // del navegador, que es lo correcto aquí: los horarios se guardan e
      // interpretan en la zona del PERFIL (`get_available_slots`), no en la del
      // sitio desde el que el tutor se haya conectado hoy.
      getUserTimezone(),
    ]);

  // rule_id → títulos de las mentorías que la usan. El paso 4 del asistente
  // monta el mismo gestor y necesita el mismo mapa, así que vive en `lib`.
  const usedBy = buildUsedBy(products ?? [], links ?? []);

  // rule_id → «9 clases de 60 min» y si la franja pisa a otra. Desde §3.2 el
  // chip solo pinta el solape, pero el cálculo entero sigue saliendo de aquí.
  const slotPreview = buildSlotPreview(
    rules ?? [],
    (products ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      durationMin: p.session_duration_min,
      stepMin: p.start_time_increment_min,
    })),
    links ?? [],
  );

  // §3.1 · el resumen de la semana sale del MISMO cálculo que las horas de cada
  // fila (`horasSemana`), y por eso no puede descuadrar con ellas. Sin ninguna
  // franja se dice «0 h», que es la verdad: no es un hueco, es que no abres.
  const abre = horasSemana(rules ?? []) || "0 h";
  const reloj = relojDeLaZona(tz);

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
      userId={userId}
      title="Disponibilidad"
      /* §3.1 · la cabecera sustituye a «Tus horarios se muestran en tu zona
         horaria»: dice lo mismo pero CON el dato —cuánto abres, en qué zona y
         qué hora es ahí ahora—, y ofrece el único sitio donde se cambia. */
      description={
        <>
          Abres{" "}
          <strong className="font-semibold text-[#333333]">{abre}</strong> a la
          semana en{" "}
          <strong className="font-semibold text-[#333333]">
            {tz}
            {reloj?.gmt ? ` (${reloj.gmt})` : ""}
          </strong>
          {reloj ? ` · ahora son las ${reloj.hora}` : ""} ·{" "}
          {/* ⚠️ Dos arreglos en una línea, y hacen falta los dos:
              · `brand-foreground` (#036fda) en vez de `brand` (#0080ff), que a
                13 px sobre el fondo del panel se queda en 3,64:1 contra el
                4,5:1 de 1.4.3;
              · subrayado FIJO, no solo al pasar el ratón: dentro de un párrafo
                gris el color era lo único que decía que esto es un enlace, y
                entre los dos hay 1,40:1 (1.4.1 pide 3:1 si el color va solo). */}
          <Link
            href="/account#informacion-personal"
            className="text-brand-foreground underline underline-offset-2"
          >
            cambiar zona
          </Link>
        </>
      }
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
        {/* G-01 · los tres `id` son las anclas a las que apuntan los subniveles
            del menú. `scroll-mt-24` deja el aire de la cabecera sticky: sin él
            el salto deja el título justo debajo de la barra. */}
        <PanelCard id="horario-semanal" className="scroll-mt-24">
          {/* §3.2 · el título y «+ Añadir franja» los pinta el gestor: comparten
              fila y el botón abre un formulario cuyo estado vive allí. */}
          <AvailabilityManager
            titulo="Horario semanal"
            userId={userId}
            rules={rules ?? []}
            usedBy={usedBy}
            slotPreview={slotPreview}
          />
        </PanelCard>

        <div className="flex flex-col gap-5">
          <PanelCard id="calendario" className="scroll-mt-24">
            <PanelCardTitle className="first-letter:uppercase">
              Calendario · {monthLabel}
            </PanelCardTitle>
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

          <PanelCard id="excepciones" className="scroll-mt-24">
            {/* §3.4 · «Excepciones» (el nombre del subnivel del menú), lista
                primero y «+ Añadir» en la cabecera. Título y botón los pinta el
                gestor, por lo mismo que en el horario semanal. */}
            <ExceptionsManager
              titulo="Excepciones"
              userId={userId}
              exceptions={exceptions ?? []}
            />
          </PanelCard>
        </div>
      </div>
    </TutorShell>
  );
}
