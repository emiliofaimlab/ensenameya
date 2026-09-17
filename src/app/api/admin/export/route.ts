import { getSessionContext } from "@/lib/auth/server";
import {
  studentLearningRecord,
  tutorTeachingRecord,
} from "@/lib/admin/queries";
import { aCsv, fechaCsv, importeCsv } from "@/lib/admin/csv";

/**
 * Descargar el panel en CSV — alumnos y tutores por la misma puerta.
 *
 * `GET` y no `POST` a propósito, al revés que sus vecinos de `/api/admin/`: esto
 * no ejecuta nada, solo lee, y tiene que poder ser un `<a href>` normal para que
 * el navegador se encargue de la descarga. Un `POST` obligaría a montar el
 * fichero con JavaScript en el cliente y a pasar los datos dos veces.
 *
 * SALE DE LA MISMA FUNCIÓN QUE LA PANTALLA, no de una consulta propia. Es la
 * regla que evita el fallo clásico de los exportadores: que el CSV y lo que se
 * ve en pantalla se separen y nadie se entere hasta que el cliente cuadra dos
 * cifras que no cuadran.
 *
 * ⚠️ CON UNA DIFERENCIA A PROPÓSITO: el PERÍODO se respeta, pero el «ver
 * también los que no han reservado nunca» NO. El fichero trae SIEMPRE a todo el
 * mundo. Quien descarga un CSV se lo lleva a una hoja de cálculo para filtrarlo
 * allí, y un export que ya viene recortado —sin decirlo— es el que hace contar
 * de menos. Filtrar sobra en el destino; el dato que no vino no se recupera.
 *
 * ⚠️ El CSV lleva TODO lo que trae la ficha, no lo que se ve en la lista. Ese
 * era el encargo: la lista se redujo a nombre y correo y el detalle se fue al
 * modal, pero en el fichero tiene que estar el expediente completo.
 *
 * La barrera de verdad sigue estando DENTRO de las RPC (`has_role('admin')`):
 * la comprobación de abajo está para contestar con un código claro en vez de
 * dejar que reviente con un 500.
 */

/**
 * Guarda de rol. No se usa `requireRole('admin')` a propósito: hace `redirect()`
 * y aquí conviene un código, no un 307 hacia el HTML del login. Es la misma
 * decisión —y casi el mismo código— que `/api/admin/notificaciones/enviar`.
 */
async function soloAdmin(): Promise<Response | null> {
  const { user, roles } = await getSessionContext();
  if (!user) return new Response("Sin sesión.", { status: 401 });
  if (!roles.includes("admin")) return new Response("No autorizado.", { status: 403 });
  return null;
}

/** Los mismos presets de las dos pantallas. Lo que no encaje se ignora. */
const DIAS: Record<string, number> = { "30": 30, "90": 90, "180": 180, "365": 365 };

function desdeHace(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * `[{currency, importe}]` → «941.00 USD · 12.00 EUR», en una sola celda.
 *
 * Una celda por moneda sería una columna de ancho variable, que en un CSV es
 * peor que un texto: con el MVP en una sola moneda esto es siempre un valor y
 * sigue siendo legible el día que sean dos.
 */
function dineroCsv(filas: { currency: string; importe: number }[]): string {
  return filas.map((f) => `${importeCsv(f.importe)} ${f.currency}`).join(" · ");
}

export async function GET(req: Request) {
  const noPasa = await soloAdmin();
  if (noPasa) return noPasa;

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") === "tutores" ? "tutores" : "alumnos";
  const dias = DIAS[url.searchParams.get("p") ?? ""];
  const from = dias ? desdeHace(dias) : undefined;

  // El nombre del fichero lleva el período dentro: quien acumule tres
  // descargas en la carpeta tiene que poder distinguirlas sin abrirlas. La
  // fecha se saca de `from` cuando lo hay, y del día de hoy cuando no.
  const hoy = new Date().toISOString().slice(0, 10);
  const sufijo = dias ? `ultimos-${dias}-dias` : "historico";
  const nombre = `ensenameya-${tipo}-${sufijo}-${hoy}.csv`;

  const csv =
    tipo === "tutores" ? await csvTutores(from) : await csvAlumnos(from);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
      // Son datos personales: que no se queden en ninguna caché intermedia.
      "cache-control": "no-store",
    },
  });
}

async function csvAlumnos(from?: string): Promise<string> {
  const filas = await studentLearningRecord({ from });
  return aCsv(
    [
      "Nombre",
      "Correo",
      "Teléfono",
      "Zona horaria",
      "Registro",
      "Registro completo",
      "Objetivo",
      "Intereses",
      "Estado",
      "Motivo de suspensión",
      "Reservas pagadas",
      "Reservas por estado",
      "Mentorías tomadas",
      "No abrió nadie",
      "Canceladas",
      "Tutores distintos",
      "Con quién estudió más",
      "Primera mentoría",
      "Última mentoría",
      "Próxima mentoría",
      "Gastado",
      "Devuelto",
      "Pagos",
      "Medios de pago",
      "Crédito sin gastar",
      "Reseñas",
      "Nota media que pone",
      "Vino por invitación",
      "Su código de invitación",
      "Términos aceptados",
    ],
    filas.map((a) => [
      a.nombre,
      a.correo,
      a.telefono,
      a.zonaHoraria,
      fechaCsv(a.alta),
      a.onboardingCompleto ? "sí" : "no",
      a.objetivo,
      a.intereses.join(" · "),
      a.suspendido ? "suspendido" : a.baja ? `baja ${a.baja.estado}` : "activo",
      a.suspension?.motivo ?? "",
      a.reservas,
      a.reservasDetalle.map((r) => `${r.estado}: ${r.n}`).join(" · "),
      a.tomadas,
      a.noShows,
      a.canceladas,
      a.tutoresDistintos,
      a.tutores.map((t) => `${t.nombre} (${t.mentorias})`).join(" · "),
      fechaCsv(a.primeraClase),
      fechaCsv(a.ultimaClase),
      fechaCsv(a.proximaClase),
      dineroCsv(a.gastado.map((g) => ({ ...g, importe: g.gastado }))),
      dineroCsv(
        a.gastado
          .filter((g) => g.devuelto > 0)
          .map((g) => ({ ...g, importe: g.devuelto })),
      ),
      a.pagos,
      a.mediosDePago.join(" · "),
      dineroCsv(a.creditoDisponible.map((c) => ({ ...c, importe: c.saldo }))),
      a.resenas,
      a.notaMedia,
      a.vinoReferido ? "sí" : "no",
      a.codigoReferido,
      a.terminos ? `${a.terminos.version} (${fechaCsv(a.terminos.aceptados)})` : "",
    ]),
  );
}

async function csvTutores(from?: string): Promise<string> {
  const filas = await tutorTeachingRecord({ from });
  return aCsv(
    [
      "Nombre",
      "Correo",
      "Teléfono",
      "Aprobado",
      "Mentorías impartidas",
      "No abrió nadie",
      "Alumnos distintos",
      "Primera mentoría",
      "Última mentoría",
    ],
    filas.map((t) => [
      t.nombre,
      t.correo,
      t.telefono,
      t.aprobado ? "sí" : "no",
      t.impartidas,
      t.noShows,
      t.alumnosDistintos,
      fechaCsv(t.primeraClase),
      fechaCsv(t.ultimaClase),
    ]),
  );
}
