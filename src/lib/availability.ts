/**
 * Disponibilidad del tutor: las piezas que ahora necesitan DOS pantallas —el
 * panel (`/tutor/availability`) y el paso 4 del asistente de onboarding
 * (EY-183)— y que hasta hoy vivían sueltas dentro del gestor.
 *
 * ⚠️ Módulo NEUTRO (sin `"use client"`) a propósito, y no es un detalle de
 * estilo: `buildUsedBy` la llaman dos páginas de SERVIDOR. Exportada desde el
 * fichero `"use client"` del gestor, cada una recibiría una *referencia de
 * cliente* en vez de la función y la llamada reventaría en tiempo de ejecución
 * —no en el typecheck—. Es el mismo tropiezo que ya documentan
 * `components/onboarding/wizard-step.ts` y `lib/tz.ts`.
 */

/** Una franja recurrente de `availability_rules`. 0=domingo (Doc 1 §1.4.8). */
export type Rule = {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

const hhmm = (t: string) => t.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'

/** 'HH:MM(:SS)' → minutos desde medianoche. Hora de pared, no UTC. */
function minutoDelDia(t: string): number {
  const [h, m] = hhmm(t).split(":").map(Number);
  return h * 60 + m;
}

/** Minutos de una franja, para poder decir cuántas horas suma la semana. */
function minutos(r: Rule): number {
  return minutoDelDia(r.end_time) - minutoDelDia(r.start_time);
}

/**
 * Minutos que el tutor tiene ABIERTOS de verdad.
 *
 * ⚠️ No es la suma de las franjas, y la diferencia no es cosmética: hasta hoy
 * esto sumaba en crudo, así que un jueves con 07:00–22:00 y además 07:00–11:00
 * —literalmente lo que hay en la base de dev— anunciaba 19 h cuando el alumno
 * ve 15. `get_available_slots` hace `union` de los inicios: los huecos
 * repetidos se ofrecen UNA vez, así que contarlos dos veces era prometer horas
 * que la reserva no da. Se fusionan los tramos por día, igual que ese `union`.
 *
 * Y se descartan las PAUSADAS (`is_active = false`): una franja pausada no se
 * ofrece a nadie, y el chip ya la pinta tachada — sumarla en el total decía lo
 * contrario que el propio chip, en la misma fila.
 *
 * Se agrupa por `weekday` para que la función dé lo mismo con las franjas de un
 * solo día (la fila) que con las de la semana entera (la cabecera): dos
 * cálculos distintos para el mismo número es cómo acaban sin cuadrar.
 */
function minutosAbiertos(rules: Rule[]): number {
  const porDia = new Map<number, Rule[]>();
  for (const r of rules) {
    if (!r.is_active) continue;
    const list = porDia.get(r.weekday);
    if (list) list.push(r);
    else porDia.set(r.weekday, [r]);
  }

  let total = 0;
  for (const list of porDia.values()) {
    const tramos = list
      .map((r) => [minutoDelDia(r.start_time), minutoDelDia(r.end_time)] as const)
      .filter(([a, b]) => b > a) // una franja invertida o de cero no abre nada
      .sort((x, y) => x[0] - y[0]);

    let ini: number | null = null;
    let fin = 0;
    for (const [a, b] of tramos) {
      if (ini === null) {
        ini = a;
        fin = b;
      } else if (a <= fin) {
        fin = Math.max(fin, b); // pisa o encadena con el tramo abierto
      } else {
        total += fin - ini;
        ini = a;
        fin = b;
      }
    }
    if (ini !== null) total += fin - ini;
  }
  return total;
}

/**
 * «Abres 12 h a la semana», o cadena vacía si no hay nada abierto. Cadena y no
 * número porque el único uso es texto, y el redondeo («8 h 30 min», no «8.5 h»)
 * es parte de la respuesta.
 */
export function horasSemana(rules: Rule[]): string {
  const total = minutosAbiertos(rules);
  if (total === 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * CUÁNTAS CLASES CABEN EN UNA FRANJA. Espejo exacto del `generate_series` de
 * `get_available_slots` (`20260831190000`), y por eso vive aquí solo: dos sitios
 * calculando esto por su cuenta es cómo el panel acaba prometiendo un número que
 * el calendario no da.
 *
 * La regla —la misma de Calendly— es que el hueco solo cuenta si la clase cabe
 * ENTERA: se quieren los `n` con `inicio + paso·n + duración ≤ fin`, o sea
 * `n ≤ ((fin − inicio) − duración) / paso`, y el total es ese tope más uno.
 * Franja más corta que la clase → tope negativo → cero huecos.
 */
export function huecosDeFranja(
  rule: Pick<Rule, "start_time" | "end_time">,
  durationMin: number | null,
  stepMin: number | null,
): number {
  const dur = durationMin ?? 0;
  if (dur <= 0) return 0;
  // El `||` cubre el paso nulo (la columna sin configurar) y también un 0 que
  // no debería existir: con paso 0 la división no significaría nada.
  const step = stepMin || dur;
  const largo = minutos(rule as Rule);
  const tope = Math.floor((largo - dur) / step);
  return tope >= 0 ? tope + 1 : 0;
}

/** ¿dos franjas del mismo día se pisan? Intervalos medio abiertos, igual que el
 *  `tstzrange &&` del SQL: pegado no es solapado (08:00–12:00 y 12:00–16:00 son
 *  dos franjas seguidas, no un solape).
 *
 *  ⚠️ El gestor de horarios la usa EN CLIENTE para RECHAZAR un solape antes de
 *  escribirlo: `get_available_slots` hace `union` de los inicios de las franjas
 *  que se pisan, así que dos franjas solapadas ofrecen menos huecos de los que
 *  el tutor cree tener. Se avisaba con un «se solapa» en el chip y no bastaba:
 *  el tutor lo leía y lo dejaba igual. */
export function seSolapan(
  a: Pick<Rule, "start_time" | "end_time">,
  b: Pick<Rule, "start_time" | "end_time">,
): boolean {
  return (
    minutoDelDia(a.start_time) < minutoDelDia(b.end_time) &&
    minutoDelDia(b.start_time) < minutoDelDia(a.end_time)
  );
}

/**
 * N-04 · `rule_id` → títulos de las mentorías que cuelgan de esa franja.
 *
 * Alimenta la confirmación de borrado del gestor: quitar una franja arrastra su
 * enlace (FK `on delete cascade`) y, si era el único de esa mentoría, la
 * mentoría pasa a ofrecerse en TODA la disponibilidad del tutor. Sin este mapa
 * el aspa borra en silencio y borrar un horario acaba ABRIENDO una oferta.
 */
export function buildUsedBy(
  products: { id: string; title: string }[],
  links: { rule_id: string; product_id: string }[],
): Record<string, string[]> {
  const titleById = new Map(products.map((p) => [p.id, p.title]));
  const usedBy: Record<string, string[]> = {};
  for (const l of links) {
    const title = titleById.get(l.product_id);
    if (!title) continue; // producto de otro tutor: imposible por RLS, pero no se asume
    (usedBy[l.rule_id] ??= []).push(title);
  }
  return usedBy;
}
