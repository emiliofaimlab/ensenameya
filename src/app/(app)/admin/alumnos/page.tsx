import Link from "next/link";

import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { studentLearningRecord } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import { PanelCard, StatusPill } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { esperaDesde } from "../tiempo";

export const metadata = { title: "Alumnos · Enséñame Ya" };

/** Mismos chips que `/admin/tutores/actividad` y `/admin/stats` (Figma 228:51). */
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
 * El reporte de alumnos — el espejo de «Mentorías impartidas» por el otro lado
 * de la sesión.
 *
 * POR QUÉ EXISTE. El panel tenía catorce secciones y ninguna respondía «¿quién
 * está estudiando aquí?»: el nombre del alumno solo aparecía reserva a reserva
 * en `/admin/bookings`, sin una sola agregación, y no había ni una cifra de
 * alumnos en `/admin/stats` (`admin_stats` agrega `active_tutors` y nada del
 * otro lado). Lo pidió el cliente el 17-sep-2026 y no estaba en el alcance
 * aprobado —el mapa de pantallas llega hasta SCR-AD15 y ninguna es de alumnos—,
 * así que esto es alcance nuevo, no algo que estuviera pendiente.
 *
 * ⚠️ NO CONFUNDIR CON `/admin/reportes`, que es la bandeja de MODERACIÓN. El
 * parecido de los nombres es exactamente lo que hizo preguntar al cliente dónde
 * estaba «el reporte de estudiantes».
 *
 * DELIBERADAMENTE FUERA, por si alguien lo busca:
 *  · **Ficha por alumno.** Esto es una lista, no un CRM. La acción que hoy se
 *    puede tomar sobre un alumno —suspenderlo, escribirle— vive en
 *    `/admin/reportes`, que es donde hay un motivo para tomarla.
 *  · **El correo.** No es una omisión de diseño: `profiles` NO tiene columna
 *    `email` y `auth.users` no lo lee ningún rol de la API. Enseñarlo obliga a
 *    bajar al `service_role` y a la Auth Admin API desde la pantalla, y hoy
 *    NINGUNA pantalla del panel enseña el correo de nadie. Si el cliente lo
 *    pide, es su propia decisión y su propio carril.
 *  · **Búsqueda por nombre y paginación.** No existe búsqueda libre en todo el
 *    panel, y con 19 alumnos en dev y 3 cuentas en producción una lista entera
 *    se lee de un vistazo. Cuando estorbe: `ilike` sobre `profiles.full_name`
 *    por RLS y el `Pager` de `/admin/bookings`, que ya están escritos.
 *
 * ⚠️ INTERNA, igual que su gemela: cuánto estudia alguien, con quién y cuánto se
 * ha gastado no se publica en ninguna superficie pública.
 */
export default async function AdminAlumnosPage({
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
    studentLearningRecord({ from: preset ? desdeHace(preset.days) : undefined }),
  ]);

  // Tres conjuntos distintos a propósito. «Con actividad» incluye a quien pagó
  // y todavía no ha dado su primera clase: sus mentorías están en el futuro y
  // dejarlo fuera lo pintaría como una cuenta muerta justo cuando acaba de
  // comprar. «Ha estudiado» solo cuenta a quien llegó a dar clase: llamar
  // «alumno activo» a un no-show sería resolver DP-08 de tapadillo, y en el
  // lado optimista.
  const conActividad = filas.filter(
    (f) => f.tomadas + f.noShows + f.reservas > 0,
  );
  const hanEstudiado = filas.filter((f) => f.tomadas > 0);
  const visibles = todos ? filas : conActividad;

  const totalTomadas = filas.reduce((s, f) => s + f.tomadas, 0);

  // Por moneda (RN-13): sumar monedas distintas da un número sin sentido. Hoy
  // el MVP es de una sola, así que esto normalmente devuelve un elemento.
  const gastadoTotal = new Map<string, number>();
  for (const f of filas)
    for (const g of f.gastado)
      gastadoTotal.set(g.currency, (gastadoTotal.get(g.currency) ?? 0) + g.gastado);

  /** Conserva el resto de la query string al cambiar uno de los dos filtros. */
  const href = (cambio: { p?: string; ver?: string }) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ p: sp.p, ver: sp.ver, ...cambio }))
      if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/admin/alumnos?${s}` : "/admin/alumnos";
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

  const dinero = (g: { currency: string; gastado: number }[]) =>
    g.length === 0
      ? "—"
      : g.map((x) => formatMoney(x.gastado, x.currency)).join(" · ");

  return (
    <AdminShell
      title="Alumnos"
      description="Quién estudia en la plataforma, cuánto y con cuántos tutores. Uso interno: no se publica en ningún perfil."
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
            ? "Ocultar a los que no han reservado nunca"
            : `Ver también los que no han reservado nunca (${filas.length - conActividad.length})`}
        </Link>
      </div>

      {/* ⚠️ Mismo aviso que en el registro de tutores: el período recorta la fila
          ENTERA, no solo el contador. Con un preset puesto, «gastado» es lo
          gastado DENTRO de la ventana. */}
      {preset ? (
        <PanelCard className="border-[#cfe3f7] bg-[#f2f8ff] py-3">
          <p className="text-[13px] text-[#2a5b8a]">
            Todas las cifras están acotadas a los últimos {preset.days} días,
            incluidos <strong>reservas</strong>, <strong>gastado</strong> y{" "}
            <strong>última mentoría</strong>. El alta de la cuenta no: esa es
            siempre la real. Para el historial completo, «Todo el histórico».
          </p>
        </PanelCard>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Alumnos registrados" value={String(filas.length)} />
        <Stat label="Alumnos que han estudiado" value={String(hanEstudiado.length)} />
        <Stat label="Mentorías tomadas" value={String(totalTomadas)} />
        <Stat
          label="Gastado por los alumnos"
          value={
            gastadoTotal.size === 0
              ? "—"
              : [...gastadoTotal]
                  .map(([c, v]) => formatMoney(v, c))
                  .join(" · ")
          }
        />
      </div>

      {visibles.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            {todos
              ? "Todavía no hay ningún alumno registrado."
              : "Ningún alumno tuvo actividad en este período. Los que nunca han reservado están detrás del enlace de arriba."}
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {visibles.map((f) => (
              <li
                key={f.studentId}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4"
              >
                {/* El alta va AQUÍ y no en su propia columna, y no es estética:
                    con seis columnas la fila mide ~900 px y envuelve justo en
                    1280 —medido—, dejando «Alta» colgando debajo de «Tomadas»
                    como si fuera otra cosa. Juntas se leen mejor de todos
                    modos: las dos son fechas y la pregunta que responden es la
                    misma, «¿cuánto lleva y cuándo fue la última vez?». */}
                <div className="min-w-0 sm:w-64">
                  <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                    {f.nombre}
                  </p>
                  <p className="truncate text-xs text-[#6b6b6b]">
                    Alta {fecha(f.alta)} ·{" "}
                    {f.ultimaClase
                      ? `última ${esperaDesde(f.ultimaClase)}`
                      : "sin mentorías"}
                  </p>
                </div>

                <Dato label="Tomadas" value={String(f.tomadas)} />
                {/* En su propia columna y NO sumada a la anterior: si un no-show
                    cuenta como clase es DP-08, sin responder. Y aquí «no-show»
                    significa que no entró NADIE — la base de datos no sabe quién
                    faltó (ver `20260716120000`). */}
                <Dato
                  label="Nadie entró"
                  value={String(f.noShows)}
                  tenue={f.noShows === 0}
                />
                <Dato label="Tutores" value={String(f.tutoresDistintos)} />
                <Dato label="Reservas" value={String(f.reservas)} />

                <div className="w-32">
                  <p className="text-[11.5px] text-[#6b6b6b]">Gastado</p>
                  <p className="truncate text-[13px] font-medium tabular-nums text-[#404040]">
                    {dinero(f.gastado)}
                  </p>
                </div>

                {f.suspendido ? (
                  <StatusPill tone="red" className="ml-auto">
                    Suspendido
                  </StatusPill>
                ) : null}
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
            <strong>Quién sale en esta lista.</strong> Todo el que se registra
            recibe el rol de alumno, incluidos los tutores, así que el corte no
            es el rol: aquí está quien <strong>no</strong> aparece en{" "}
            <Link href="/admin/tutores" className="text-brand hover:underline">
              Tutores
            </Link>
            . Las dos listas son complementarias — cada cuenta sale en una y solo
            en una.
          </li>
          <li>
            <strong>Tomadas</strong> son sesiones que terminaron en{" "}
            <code className="font-mono text-xs">completed</code>: alguien abrió
            la sala, o el tutor la cerró a mano.
          </li>
          <li>
            <strong>Nadie entró</strong> son sesiones que vencieron sin que
            ninguna de las dos partes abriera la sala. La plataforma{" "}
            <strong>no registra quién faltó</strong>, así que este número no
            reparte culpas — y por eso va aparte, sin sumarse a las tomadas
            (decisión pendiente DP-08).
          </li>
          <li>
            <strong>Reservas</strong> son las que llegaron a pagarse. Un alumno
            con reservas y cero tomadas no es una cuenta muerta: tiene sus
            mentorías por delante.
          </li>
          <li>
            <strong>Gastado</strong> es lo que salió del bolsillo de esa persona
            — el bruto <strong>menos</strong> lo que cubrieran créditos o
            regalos, e <strong>incluido</strong> el cargo por servicio del 5 %,
            que también lo paga el alumno. No es el GMV de{" "}
            <Link href="/admin/stats" className="text-brand hover:underline">
              Estadísticas
            </Link>
            , que sí cuenta los créditos y no tiene por qué cuadrar con la suma
            de esta columna. Lo devuelto no se resta aquí.
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
