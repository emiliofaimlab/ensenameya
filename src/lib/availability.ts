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
 * Una mentoría del tutor, en lo que hace falta para saber en qué convierte una
 * franja. `stepMin` nulo = el paso es la duración (columna `NULL`).
 */
export type MentoriaDeFranja = {
  id: string;
  title: string;
  durationMin: number | null;
  stepMin: number | null;
};

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

/**
 * Lo que se pinta al lado de una franja.
 *
 * `solapa` gana sobre `clases` y no es un detalle de presentación: ver el aviso
 * de `buildSlotPreview`.
 */
export type PreviewDeFranja = {
  /** «9 clases de 60 min», o `null` si no hay nada honesto que decir. */
  clases: string | null;
  /** Esta franja pisa a otra del mismo día. */
  solapa: boolean;
};

/** ¿dos franjas del mismo día se pisan? Intervalos medio abiertos, igual que el
 *  `tstzrange &&` del SQL: pegado no es solapado (08:00–12:00 y 12:00–16:00 son
 *  dos franjas seguidas, no un solape). */
function seSolapan(a: Rule, b: Rule): boolean {
  const m = (t: string) => {
    const [h, mm] = hhmm(t).split(":").map(Number);
    return h * 60 + mm;
  };
  return m(a.start_time) < m(b.end_time) && m(b.start_time) < m(a.end_time);
}

/**
 * «9 clases de 60 min» — en qué convierte cada franja lo que el tutor acaba de
 * escribir.
 *
 * ⚠️ ESTA ES LA PREGUNTA DEL CLIENTE, hecha pantalla. El panel enseñaba
 * «08:00–17:00» y nada más, y de ahí salía la duda de si eso era UNA clase de
 * nueve horas. Nunca lo fue —la función de huecos parte por la duración desde
 * US-601—, pero la pantalla no lo decía en ninguna parte y no hay forma de
 * deducirlo mirándola.
 *
 * ⚠️⚠️ Y POR ESO MISMO, UNA FRANJA QUE SE PISA CON OTRA NO ENSEÑA NÚMERO.
 * `get_available_slots` hace `union` de los inicios de todas las franjas que
 * aplican, así que los huecos repetidos se cuentan UNA vez. Un jueves con
 * 07:00–22:00 y además 07:00–11:00, 13:00–17:00 y 16:00–20:00 —que es
 * literalmente lo que hay en la base de dev— daría chips de «15 · 4 · 4 · 4»
 * para un día que ofrece 15 horarios, no 27. Cada número sería cierto por
 * separado y la suma, que es lo que el ojo hace, sería falsa. Se prefiere decir
 * que hay un solape —que además es un problema real que hoy no se ve en ninguna
 * pantalla y es la condición que hace falta para que un paquete se pise a sí
 * mismo— antes que publicar una cifra que invita a sumarse mal.
 *
 * Se agrupa por (duración, paso) y no por mentoría a propósito: cinco mentorías
 * de 60 min producen la MISMA rejilla, y listarlas cinco veces convierte la
 * respuesta en ruido. Lo que cambia el número es el par, así que el par es la
 * unidad.
 *
 * QUÉ MENTORÍAS USAN UNA FRANJA (N-04, y no es obvio): las que la tienen
 * enlazada MÁS las que no tienen ningún enlace, porque «sin bloques» significa
 * «toda la disponibilidad del tutor». Es la misma condición que el `or not
 * v_has_blocks` del SQL, y omitir la segunda mitad dejaría sin aviso justo a las
 * mentorías que hoy son mayoría.
 *
 * ⚠️ LO QUE ESTA FUNCIÓN **NO** SABE, y por eso el número es «cuántas caben» y
 * no «cuántas verá el alumno»: las excepciones puntuales (`block`/`open`) y las
 * clases ya reservadas. Las dos son por FECHA y esto es una plantilla semanal,
 * así que no tienen sitio aquí. Rehacer `get_available_slots` en TypeScript para
 * afinarlo sería tener dos verdades sobre lo mismo, que es exactamente lo que la
 * cabecera de `huecosDeFranja` existe para evitar.
 */
export function buildSlotPreview(
  rules: Rule[],
  products: MentoriaDeFranja[],
  links: { rule_id: string; product_id: string }[],
): Record<string, PreviewDeFranja> {
  const conEnlace = new Set(links.map((l) => l.product_id));
  const sinBloques = products.filter((p) => !conEnlace.has(p.id));
  const porRegla = new Map<string, Set<string>>();
  for (const l of links) {
    let s = porRegla.get(l.rule_id);
    if (!s) porRegla.set(l.rule_id, (s = new Set()));
    s.add(l.product_id);
  }

  const activas = rules.filter((r) => r.is_active);

  const out: Record<string, PreviewDeFranja> = {};
  for (const r of rules) {
    const solapa = activas.some(
      (o) => o.id !== r.id && o.weekday === r.weekday && seSolapan(r, o),
    );
    if (solapa) {
      out[r.id] = { clases: null, solapa: true };
      continue;
    }

    const ids = porRegla.get(r.id);
    const usan = [...products.filter((p) => ids?.has(p.id)), ...sinBloques];

    // Un par (duración, paso) → una rejilla. `Map` y no `Set` para conservar el
    // orden de aparición: el tutor lee sus mentorías en el orden en que las
    // creó, no ordenadas por duración.
    const combos = new Map<string, { n: number; dur: number }>();
    for (const p of usan) {
      if (!p.durationMin) continue; // sin duración no hay rejilla que anunciar
      const clave = `${p.durationMin}/${p.stepMin ?? p.durationMin}`;
      if (combos.has(clave)) continue;
      combos.set(clave, {
        n: huecosDeFranja(r, p.durationMin, p.stepMin),
        dur: p.durationMin,
      });
    }

    const vivos = [...combos.values()].filter((c) => c.n > 0);
    // ⚠️ TOPE DE DOS, y no es estética. Un tutor con ocho mentorías de ocho
    // duraciones distintas pondría ocho cifras dentro de un chip de una línea, y
    // la respuesta («no es una clase de nueve horas») se perdería dentro de su
    // propia explicación. Con dos ejemplos ya se ve que la franja se parte, que
    // es lo único que hay que entender aquí.
    const trozos = vivos
      .slice(0, 2)
      .map((c) => `${c.n} ${c.n === 1 ? "clase" : "clases"} de ${c.dur} min`);
    if (vivos.length > trozos.length)
      trozos.push(`+${vivos.length - trozos.length}`);
    out[r.id] = { clases: trozos.length > 0 ? trozos.join(" · ") : null, solapa: false };
  }
  return out;
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
