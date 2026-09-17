import Link from "next/link";

import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { studentLearningRecord } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import { PanelCard, StatusPill } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button } from "@/components/ui/button";
import { FichaAlumno } from "./ficha-alumno";

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
 * LA LISTA ES DELIBERADAMENTE POBRE: nombre, correo y un botón. La primera
 * versión traía seis columnas de cifras y el cliente pidió justo lo contrario —
 * «listar solamente el nombre y correo» y todo lo demás en el detalle—, que
 * además arregla de paso el problema que tenía: con seis columnas la fila
 * envolvía a 1280 y había que ir quitando datos para que cupiera. En el modal
 * no compite nada con nada.
 *
 * DELIBERADAMENTE FUERA, por si alguien lo busca:
 *  · **Acciones sobre el alumno.** La ficha es de solo lectura. Suspender o
 *    escribir a alguien vive en `/admin/reportes`, que es donde hay un motivo
 *    para hacerlo y donde queda registrado contra qué reporte se hizo.
 *  · **Búsqueda por nombre y paginación.** No existe búsqueda libre en todo el
 *    panel, y con 19 alumnos en dev y 3 cuentas en producción una lista entera
 *    se lee de un vistazo. Cuando estorbe: `ilike` sobre `profiles.full_name`
 *    por RLS y el `Pager` de `/admin/bookings`, que ya están escritos.
 *
 * ⚠️ INTERNA, igual que su gemela, y desde el 17-sep con DATO PERSONAL dentro:
 * es la ÚNICA superficie del panel que enseña correos y teléfonos. Cuánto
 * estudia alguien, con quién, cuánto se gasta y cómo se le localiza no se
 * publica en ninguna superficie pública, y la barrera está dentro de la RPC.
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

  // ⚠️ SI NADIE TIENE ACTIVIDAD, SE ENSEÑAN TODOS. Sin esta línea la pantalla
  // dice «ningún alumno tuvo actividad» teniendo veinte filas a mano y los
  // esconde detrás de un enlace — que es justo lo que pasó el día que esto se
  // estrenó en producción, donde todavía nadie ha reservado: el cliente lo leyó
  // como «no hay alumnos» y dio la pantalla por rota. Una lista vacía es una
  // mentira creíble (regla de oro 10), y aquí no hacía falta ni una consulta
  // fallida para contarla.
  const hayActividad = conActividad.length > 0;
  const visibles = todos || !hayActividad ? filas : conActividad;

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



  return (
    <AdminShell
      title="Alumnos"
      description="Quién estudia en la plataforma y cómo localizarlo. El detalle completo de cada quien está detrás de «Ver detalle». Uso interno: nada de esto se publica en ningún perfil."
      // Un enlace, no un botón: así descarga el navegador y no hay que montar
      // el fichero en JavaScript. Arrastra el período puesto, para que el CSV
      // y la pantalla nunca digan cosas distintas.
      actions={
        <Button
          asChild
          variant="outline"
          className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
        >
          <a href={`/api/admin/export?tipo=alumnos${sp.p ? `&p=${sp.p}` : ""}`}>
            Descargar CSV
          </a>
        </Button>
      }
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

        {/* El enlace solo tiene sentido si hay algo que esconder: cuando nadie
            tiene actividad ya están todos a la vista. */}
        {hayActividad ? (
          <Link
            href={href({ ver: todos ? undefined : "todos" })}
            className="ml-auto text-[13px] text-brand hover:underline"
          >
            {todos
              ? "Ocultar a los que no han reservado nunca"
              : `Ver también los que no han reservado nunca (${filas.length - conActividad.length})`}
          </Link>
        ) : null}
      </div>

      {/* ⚠️ Mismo aviso que en el registro de tutores: el período recorta la fila
          ENTERA, no solo el contador. Con un preset puesto, «gastado» es lo
          gastado DENTRO de la ventana. */}
      {preset ? (
        <PanelCard className="border-[#cfe3f7] bg-[#f2f8ff] py-3">
          <p className="text-[13px] text-[#2a5b8a]">
            Todas las cifras están acotadas a los últimos {preset.days} días,
            incluidos <strong>reservas</strong>, <strong>gastado</strong> y{" "}
            <strong>última mentoría</strong>. La fecha de registro no: esa es
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

      {!hayActividad && filas.length > 0 ? (
        <PanelCard className="border-[#cfe3f7] bg-[#f2f8ff] py-3">
          <p className="text-[13px] text-[#2a5b8a]">
            Están los <strong>{filas.length}</strong> registrados.{" "}
            {preset
              ? "Ninguno tuvo actividad en este período, así que no se esconde a nadie."
              : "Ninguno ha reservado todavía, así que no se esconde a nadie."}
          </p>
        </PanelCard>
      ) : null}

      {visibles.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Todavía no hay ningún alumno registrado.
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {visibles.map((f) => (
              <li
                key={f.studentId}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                    {f.nombre}
                  </p>
                  {/* `select-all` para poder copiarlo de un clic: es el dato por
                      el que se pidió esta columna. */}
                  <p className="truncate select-all text-xs text-[#6b6b6b]">
                    {f.correo ?? "Sin correo"}
                  </p>
                </div>

                {f.suspendido ? (
                  <StatusPill tone="red">Suspendido</StatusPill>
                ) : null}
                {f.baja ? <StatusPill tone="amber">Baja</StatusPill> : null}

                {/* Todo lo demás vive aquí dentro. La fila ya viene con la ficha
                    completa, así que abrir esto no pide nada al servidor. */}
                <FichaAlumno alumno={f} tz={tz} />
              </li>
            ))}
          </ul>
        </PanelCard>
      )}

      {/* ⚠️ Este bloque explica lo que hay en LA FICHA y en el CSV, no lo que
          se ve en la lista: al reducir la lista a nombre y correo se quedó
          describiendo columnas que ya no existían. Se queda en la pantalla y no
          dentro del modal porque son definiciones que se consultan una vez y se
          recuerdan, y repetirlas en cada ficha sería ruido en las diecinueve. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Cómo leer la ficha y el CSV
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
            <strong>«Sin teléfono» no es un dato que falte.</strong> El registro
            normal lo pide en su último paso y no deja terminar sin él. Quien
            aparece sin teléfono creó la cuenta <strong>al pagar como
            invitado</strong>, que omite el asistente a propósito para no romper
            el cobro. El correo, en cambio, lo tienen todos: sin él no hay
            cuenta.
          </li>
          <li>
            <strong>Tomadas</strong> son sesiones que terminaron en{" "}
            <code className="font-mono text-xs">completed</code>. Van{" "}
            <strong>aparte</strong> de «no abrió nadie», que son las que
            vencieron sin que entrara ninguna de las dos partes: la plataforma no
            registra quién faltó, así que ese número no reparte culpas y no se
            suma al otro (decisión pendiente DP-08).
          </li>
          <li>
            <strong>Gastado</strong> es lo que salió del bolsillo de esa persona
            — el bruto menos lo que cubrieran créditos o regalos, e incluido el
            cargo por servicio del 5 %. No es el GMV de{" "}
            <Link href="/admin/stats" className="text-brand hover:underline">
              Estadísticas
            </Link>
            , que sí cuenta los créditos, así que las dos cifras no tienen por
            qué cuadrar.
          </li>
          <li>
            <strong>El período recorta casi todo</strong>, pero no el registro,
            ni el crédito sin gastar, ni la próxima mentoría: esos tres son
            estados de hoy, no del período.
          </li>
          <li>
            <strong>El CSV trae siempre a todos</strong>, incluidos los que nunca
            han reservado, y con las treinta columnas de la ficha. Lo único que
            respeta es el período. Se abre en Excel con los acentos puestos.
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

