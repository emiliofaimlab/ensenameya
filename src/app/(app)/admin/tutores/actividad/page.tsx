import Link from "next/link";

import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { tutorTeachingRecord } from "@/lib/admin/queries";
import { cn } from "@/lib/utils";
import { PanelCard, StatusPill } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import { esperaDesde } from "../../tiempo";

export const metadata = { title: "Mentorías impartidas · Enséñame Ya" };

/**
 * Mismos chips que `/admin/stats` (Figma 228:51). No se extraen a un componente
 * compartido todavía: son tres pantallas con tres juegos de presets distintos y
 * el día que se unifiquen hay que decidir también quién manda en el default.
 */
const PRESETS = [
  { id: "30", label: "30 días", days: 30 },
  { id: "90", label: "90 días", days: 90 },
  { id: "180", label: "6 meses", days: 180 },
  { id: "365", label: "Año", days: 365 },
] as const;

function desdeHace(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * MN-14a (L3-3) — el registro de clases impartidas por tutor.
 *
 * PARA QUÉ ESTÁ ESTO AQUÍ. La minuta del 17-ago pide una campaña con beneficios
 * bilaterales «considerando el registro de las últimas clases impartidas». La
 * campaña en sí está bloqueada por P-9 —quién absorbe el descuento, plataforma
 * o tutor—, pero la lista de a quién se le ofrecería no depende de esa
 * respuesta y sirve igual si la campaña no llega nunca: es la única pantalla
 * del panel que responde «¿quién está dando clase de verdad?».
 *
 * ⚠️ INTERNA. Estos números NO están en el perfil público del tutor y no deben
 * estarlo sin una decisión de producto: cuánto trabaja alguien y con cuánta
 * gente es información suya. Si algún día se publica, va por `tutors_public`,
 * no abriendo la RPC (razonado en `20260820160000`).
 */
export default async function AdminActividadTutoresPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; ver?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const preset = PRESETS.find((x) => x.id === sp.p);
  const todos = sp.ver === "todos";

  const [tz, filas] = await Promise.all([
    getUserTimezone(),
    tutorTeachingRecord({ from: preset ? desdeHace(preset.days) : undefined }),
  ]);

  // Dos conjuntos distintos a propósito: en la lista entra cualquiera que
  // tenga rastro en el período (una clase que no abrió nadie también es
  // actividad y hay que poder verla), pero el titular de arriba solo cuenta a
  // quien de verdad dio clase. Llamar «dieron clase» a un no-show sería
  // resolver DP-08 de tapadillo, y en el lado optimista.
  const conActividad = filas.filter((f) => f.impartidas + f.noShows > 0);
  const dieronClase = filas.filter((f) => f.impartidas > 0);
  const visibles = todos ? filas : conActividad;

  const totalImpartidas = filas.reduce((s, f) => s + f.impartidas, 0);
  const totalNoShows = filas.reduce((s, f) => s + f.noShows, 0);

  /** Conserva el resto de la query string al cambiar uno de los dos filtros. */
  const href = (cambio: { p?: string; ver?: string }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ p: sp.p, ver: sp.ver, ...cambio }))
      if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/admin/tutores/actividad?${s}` : "/admin/tutores/actividad";
  };

  // Regla de oro 4: la BD guarda UTC, se pinta en la hora del admin.
  const fecha = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("es", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: tz,
        })
      : "—";

  return (
    <AdminShell
      back={{ href: "/admin/tutores", label: "Volver a tutores" }}
      eyebrow="Tutores / Actividad"
      title="Mentorías impartidas"
      description="Quién está dando mentorías, a cuánta gente y desde cuándo (MN-14a). Uso interno: no se publica en el perfil del tutor."
    >
      {/* Período. Sin chip activo = histórico completo. */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((x) => (
          <Link
            key={x.id}
            href={href({ p: x.id })}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
              sp.p === x.id
                ? "border-brand bg-brand font-semibold text-white"
                : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
            )}
          >
            {x.label}
          </Link>
        ))}
        <Link
          href={href({ p: undefined })}
          className={cn(
            "inline-flex h-9 items-center rounded-full border px-4 text-[13px] transition-colors",
            !preset
              ? "border-brand bg-brand font-semibold text-white"
              : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
          )}
        >
          Todo el histórico
        </Link>

        <Link
          href={href({ ver: todos ? undefined : "todos" })}
          className="ml-auto text-[13px] text-brand hover:underline"
        >
          {todos
            ? "Ocultar a los que no han dado ninguna"
            : `Ver también los que no han dado ninguna (${filas.length - conActividad.length})`}
        </Link>
      </div>

      {/* ⚠️ El período recorta la fila ENTERA, no solo el contador: con un
          preset puesto, "última mentoría" es la última DENTRO de la ventana. Si no
          se dice, el número engaña a quien mire por encima. */}
      {preset ? (
        <PanelCard className="border-[#cfe3f7] bg-[#f2f8ff] py-3">
          <p className="text-[13px] text-[#2a5b8a]">
            Todas las cifras están acotadas a los últimos {preset.days} días,
            incluidas <strong>primera</strong> y <strong>última mentoría</strong>.
            Para el historial completo de cada tutor, «Todo el histórico».
          </p>
        </PanelCard>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Tutores con mentorías dadas" value={String(dieronClase.length)} />
        <Stat label="Mentorías impartidas" value={String(totalImpartidas)} />
        <Stat label="Mentorías que no abrió nadie" value={String(totalNoShows)} />
      </div>

      {visibles.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            {todos
              ? "Todavía no hay ningún tutor dado de alta."
              : "Ningún tutor tuvo actividad en este período. Los que nunca han dado una mentoría están detrás del enlace de arriba."}
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {visibles.map((f) => (
              <li
                key={f.tutorId}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4"
              >
                <div className="min-w-0 sm:w-56">
                  <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                    {f.nombre}
                  </p>
                  <p className="truncate text-xs text-[#6b6b6b]">
                    {f.ultimaClase
                      ? `Última mentoría ${esperaDesde(f.ultimaClase)}`
                      : "Sin mentorías en el período"}
                  </p>
                </div>

                <Dato label="Impartidas" value={String(f.impartidas)} />
                {/* Deliberadamente en su propia columna y NO sumada a la
                    anterior: si un no-show cuenta como clase dada es DP-08, sin
                    responder. Y «no-show» aquí significa que no entró NADIE —la
                    base de datos no sabe quién faltó (ver `20260716120000`). */}
                <Dato
                  label="Nadie entró"
                  value={String(f.noShows)}
                  tenue={f.noShows === 0}
                />
                <Dato label="Alumnos" value={String(f.alumnosDistintos)} />

                <div className="w-32">
                  <p className="text-[11.5px] text-[#6b6b6b]">Primera · última</p>
                  <p className="text-[13px] font-medium text-[#404040]">
                    {fecha(f.primeraClase)}
                  </p>
                  <p className="text-[13px] font-medium text-[#404040]">
                    {fecha(f.ultimaClase)}
                  </p>
                </div>

                <div className="ml-auto flex items-center gap-3">
                  {f.aprobado ? null : (
                    <StatusPill tone="amber">Sin aprobar</StatusPill>
                  )}
                  <Button
                    asChild
                    variant="outline"
                    className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                  >
                    <Link href={`/admin/tutores/${f.tutorId}`}>Ver</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </PanelCard>
      )}

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Cómo leer estos números
        </h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[13px] text-[#6b6b6b]">
          <li>
            <strong>Impartidas</strong> son sesiones que terminaron en{" "}
            <code className="font-mono text-xs">completed</code>: alguien abrió
            la sala, o el tutor la cerró a mano.
          </li>
          <li>
            <strong>Nadie entró</strong> son sesiones que vencieron sin que
            ninguna de las dos partes abriera la sala. La plataforma{" "}
            <strong>no registra quién faltó</strong>, así que este número no
            reparte culpas — y por eso va aparte, sin sumarse a las impartidas
            (decisión pendiente DP-08).
          </li>
          <li>
            <strong>Alumnos</strong> son personas distintas a las que se les
            llegó a dar una mentoría en el período; el mismo alumno cuenta una vez por
            muchas mentorías que haya tomado.
          </li>
        </ul>
      </PanelCard>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <PanelCard className="p-5">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p className="mt-1.5 truncate text-[22px] font-bold text-[#19191f] tabular-nums">
        {value}
      </p>
    </PanelCard>
  );
}

function Dato({
  label,
  value,
  tenue = false,
}: {
  label: string;
  value: string;
  tenue?: boolean;
}) {
  return (
    <div className="w-20">
      <p className="text-[11.5px] text-[#6b6b6b]">{label}</p>
      <p
        className={cn(
          "text-[18px] font-bold tabular-nums",
          tenue ? "text-[#b0b0b0]" : "text-[#19191f]",
        )}
      >
        {value}
      </p>
    </div>
  );
}
