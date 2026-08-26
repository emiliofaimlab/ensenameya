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

/** Minutos de una franja, para poder decir cuántas horas suma la semana. */
function minutos(r: Rule): number {
  const [h1, m1] = hhmm(r.start_time).split(":").map(Number);
  const [h2, m2] = hhmm(r.end_time).split(":").map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1);
}

/**
 * «Abres 12 h a la semana», o cadena vacía si no hay nada abierto. Cadena y no
 * número porque el único uso es texto, y el redondeo («8 h 30 min», no «8.5 h»)
 * es parte de la respuesta.
 */
export function horasSemana(rules: Rule[]): string {
  const total = rules.reduce((n, r) => n + minutos(r), 0);
  if (total === 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
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
