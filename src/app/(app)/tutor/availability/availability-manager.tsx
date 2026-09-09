"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  horasSemana,
  type PreviewDeFranja,
  type Rule,
} from "@/lib/availability";
import { Button } from "@/components/ui/button";
import { PanelCardTitle } from "@/components/layout/panel-shell";
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

/**
 * Día bajo el que se abre el formulario cuando se pulsa «+ Añadir franja» en la
 * cabecera. Lunes porque es la primera fila de `DISPLAY_ORDER`: el formulario
 * aparece a la vista, no a media lista, y desde su propio selector se mueve al
 * día que toque.
 */
const DIA_POR_DEFECTO = 1;

/**
 * Horas con las que arranca el formulario. Son también a las que VUELVE tras
 * dar de alta una franja: antes de §3.2 los `<input>` no eran controlados y el
 * `form.reset()` los devolvía aquí, así que el formulario siempre se abría
 * limpio. Al pasarlos a estado ese reinicio se perdió sin que nadie lo pidiera
 * y la siguiente franja arrancaba con lo último escrito.
 */
const DESDE_POR_DEFECTO = "09:00";
const HASTA_POR_DEFECTO = "10:00";

/**
 * `id` del formulario de alta. Es único en la pantalla —solo hay un día
 * abierto a la vez— y no cambia al moverse de fila, que es justo lo que
 * necesita el `aria-controls` del botón de la cabecera para seguir apuntando a
 * él.
 */
const ID_FORMULARIO = "form-franja";

// EY-183 · `Rule` y `horasSemana` se mudaron a `lib/availability.ts` sin tocar
// una coma de lo que hacen: el asistente de onboarding las necesita y no puede
// importarlas de aquí (ver la cabecera de ese módulo). Se reexporta el tipo
// para que nada de fuera tenga que enterarse de la mudanza.
export type { Rule };

const hhmm = (t: string) => t.slice(0, 5); // 'HH:MM:SS' → 'HH:MM'

/**
 * US-501 (SCR-TU05) — horario semanal del tutor.
 *
 * Rehecho el 7-ago porque era difícil de entender, y por tres motivos
 * concretos, no por gusto:
 *
 * 1. Había DOS acciones con casi la misma palabra: «+ Añadir» abría el
 *    formulario y «Agregar» lo enviaba. Solo queda UNA palabra visible para
 *    cada cosa.
 * 2. Cada día llevaba su propio `<details>`, así que se podían quedar SIETE
 *    formularios idénticos abiertos a la vez y la pantalla dejaba de leerse.
 *    Como mucho hay un día abierto.
 * 3. Faltaba lo primero que quiere hacer cualquier tutor —«de lunes a viernes,
 *    lo mismo»— y había que repetir la franja cinco veces a mano. Un día con
 *    horario ya puesto ofrece copiarlo, saltándose los duplicados.
 *
 * §3.2 (paquete v2, 8-sep-2026) · el disparador del formulario deja de ser un
 * «+» POR FILA y pasa a ser un único botón en la cabecera de la tarjeta, y las
 * filas se quedan solo con lo que informa: día, horas abiertas y franjas. El
 * formulario sigue apareciendo BAJO EL DÍA ELEGIDO —el selector «Día» lo
 * mueve— porque es lo que dice dónde va a caer lo que estás escribiendo; un
 * formulario al pie de la lista no lo dice.
 *
 * N-04 · desde que la disponibilidad se elige por mentoría, una franja puede
 * tener mentorías colgando. Borrarla ya no es una operación local: ver
 * `pedirBorrado`.
 */
export function AvailabilityManager({
  userId,
  rules,
  usedBy = {},
  slotPreview = {},
  titulo,
}: {
  userId: string;
  rules: Rule[];
  /** N-04 · rule_id → títulos de las mentorías que usan esa franja. */
  usedBy?: Record<string, string[]>;
  /**
   * `rule_id` → si esta franja pisa a otra del mismo día. Lo calcula
   * `buildSlotPreview` en servidor, con la misma aritmética que
   * `get_available_slots`.
   *
   * ⚠️ §3.2 · de este objeto ya solo se pinta `solapa`. El «→ 9 clases de 60
   * min» que iba en el chip se retira por el paquete v2 («el chip lleva solo la
   * franja»), pero el cálculo se conserva entero: el aviso de solape sale de él
   * y es la única pantalla donde el tutor se entera de que tiene horarios
   * repetidos.
   *
   * Opcional y con default vacío porque el paso 4 del asistente de onboarding
   * (EY-183) monta este mismo gestor y ahí todavía no hay mentorías creadas.
   */
  slotPreview?: Record<string, PreviewDeFranja>;
  /**
   * §3.2 · título de la tarjeta. Lo pinta ESTE componente y no la página porque
   * el paquete pone «+ Añadir franja» en la misma fila que el título, y el
   * botón abre un formulario cuyo estado vive aquí dentro. Sin título —el paso
   * 4 del asistente, que ya trae el suyo— sale solo el botón.
   */
  titulo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Día bajo el que está abierto el formulario, o `null` si está cerrado. Un
  // solo día: es lo que impide que vuelvan los siete formularios.
  const [abierto, setAbierto] = useState<number | null>(null);
  // ⚠️ Las horas son ESTADO y no campos sueltos del `<form>`: al cambiar de día
  // el formulario se desmonta de una fila y se monta en otra, y unos `<input>`
  // no controlados perderían por el camino lo que el tutor acababa de escribir.
  const [desde, setDesde] = useState(DESDE_POR_DEFECTO);
  const [hasta, setHasta] = useState(HASTA_POR_DEFECTO);
  const [copiando, setCopiando] = useState(false);
  // Franja pendiente de confirmar borrado (solo las que usa alguna mentoría).
  const [borrando, setBorrando] = useState<Rule | null>(null);

  /**
   * ⚠️ Mover el formulario de fila DESMONTA su `<select>` y monta otro: el
   * navegador se queda sin elemento enfocado y el foco cae al `<body>`. Quien
   * navega con teclado o lector de pantalla cambiaba de día y aparecía al
   * principio del documento, con todo el menú y cinco filas por delante para
   * volver a donde estaba (2.4.3 y 3.2.2).
   *
   * Se devuelve a mano al selector recién montado, y SOLO cuando el salto lo
   * provocó ese cambio de día: abrir el formulario con el botón de la cabecera
   * no debe robarle el foco a nadie.
   */
  const selectDiaRef = useRef<HTMLSelectElement>(null);
  const moviendoDia = useRef(false);
  useEffect(() => {
    if (!moviendoDia.current) return;
    moviendoDia.current = false;
    selectDiaRef.current?.focus();
  }, [abierto]);

  const byDay = new Map<number, Rule[]>();
  for (const r of rules) {
    const list = byDay.get(r.weekday);
    if (list) list.push(r);
    else byDay.set(r.weekday, [r]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  function alternarFormulario() {
    setAbierto(abierto === null ? DIA_POR_DEFECTO : null);
    setCopiando(false);
  }

  async function addRule(weekday: number, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!desde || !hasta || hasta <= desde) {
      return toast.error("La hora de fin debe ser mayor a la de inicio.");
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert({
      tutor_id: userId,
      weekday,
      start_time: desde,
      end_time: hasta,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "No se pudo guardar el horario.");
    toast.success(`Franja añadida el ${WEEKDAYS[weekday].toLowerCase()}.`);
    setAbierto(null);
    setCopiando(false);
    // Vuelta a las horas de partida: el formulario se cierra al guardar, así
    // que la próxima vez que se abra tiene que estar limpio y no con lo que se
    // escribió hace dos franjas.
    setDesde(DESDE_POR_DEFECTO);
    setHasta(HASTA_POR_DEFECTO);
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
   *
   * ⚠️ Y desde §3.2 este diálogo es el ÚNICO sitio donde se dice: el chip ya no
   * lleva el «· 2 mentorías» que lo adelantaba de un vistazo.
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
  async function copiar(desdeDia: number, hacia: number[]) {
    const origen = byDay.get(desdeDia) ?? [];
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
      setCopiando(false);
      return toast.info("Esos días ya tenían este horario.");
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert(nuevas);
    setBusy(false);
    setCopiando(false);
    if (error) return toast.error(error.message || "No se pudo copiar el horario.");
    toast.success(`Horario copiado a ${hacia.length} días.`);
    router.refresh();
  }

  return (
    <div>
      {/* §3.2 · cabecera de la tarjeta: el título y el ÚNICO disparador del
          formulario. El título se pinta aquí, y no en la página, porque el
          botón comparte fila con él y su estado vive en este componente. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {titulo ? (
          <PanelCardTitle className="min-w-0 truncate">{titulo}</PanelCardTitle>
        ) : null}
        {/* ⚠️ `aria-controls` y no solo `aria-expanded`: el formulario que abre
            este botón NO está a su lado en el DOM —vive dentro de la fila del
            día—, así que sin la referencia el lector de pantalla anuncia
            «expandido» y deja al usuario sin forma de saltar a lo que se
            expandió. Y `aria-expanded:bg-primary/80` porque la variante naranja
            no trae estado abierto (la `outline` sí, ver `button.tsx`): abierto
            y cerrado se pintaban igual. */}
        <Button
          type="button"
          size="lg"
          disabled={busy}
          aria-expanded={abierto !== null}
          aria-controls={ID_FORMULARIO}
          onClick={alternarFormulario}
          className="ml-auto rounded-[10px] px-4 text-[13px] aria-expanded:bg-primary/80"
        >
          + Añadir franja
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="mb-3 text-[13px] text-[#6b6b6b]">
          Todavía no tienes horarios. Añade al menos uno para que puedan
          reservarte.
        </p>
      ) : null}

      {/* ⚠️ `<ul>` y no siete `<div>`: desde §3.2 cada fila son tres datos
          relacionados (día → horas abiertas → franjas), y sin lista el lector
          de pantalla los lee de corrido —«Lunes 8 h 09:00–13:00 Martes…»— sin
          decir cuántos días hay ni dónde acaba uno (1.3.1). La tarjeta de
          excepciones, al lado, ya usa `<ul>`. Las clases no cambian. */}
      <ul className="divide-y divide-[#e0e0e0]">
        {DISPLAY_ORDER.map((day) => {
          const list = byDay.get(day) ?? [];
          const vacio = list.length === 0;
          const estaAbierto = abierto === day;
          const otros = DISPLAY_ORDER.filter((d) => d !== day);
          // §3.2 · horas abiertas del día, a la izquierda de los chips. Misma
          // función que suma la semana entera: si el total y las filas se
          // calcularan por separado acabarían sin cuadrar.
          const horasDelDia = horasSemana(list);

          return (
            <li key={day} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                {/* ⚠️ El gris del día cerrado era `#9c9c9c`: 2,75:1 sobre
                    blanco a 13-14 px, muy por debajo del 4,5:1 de 1.4.3. Con
                    `#6b6b6b` —el gris secundario del panel, 5,32:1— sigue
                    leyéndose más apagado que el día abierto (`#333333`), que es
                    lo único que ese tono tenía que decir. */}
                <span
                  className={`w-24 shrink-0 text-sm font-medium ${
                    vacio ? "text-[#6b6b6b]" : "text-[#333333]"
                  }`}
                >
                  {WEEKDAYS[day]}
                </span>

                {/* ⚠️ 72 px y no los ~44 que sugiere la maqueta: ahí solo se ven
                    valores de una cifra («5 h»), pero cualquier día con media
                    hora suelta imprime «9 h 30 min», que mide 68 px y se salía
                    de la columna hasta pegarse a los chips. */}
                <span
                  className={`w-[72px] shrink-0 text-[13px] whitespace-nowrap ${
                    vacio ? "text-[#6b6b6b]" : "text-[#595959]"
                  }`}
                >
                  {horasDelDia || "—"}
                </span>

                {vacio ? (
                  <span className="text-[13px] text-[#6b6b6b]">Cerrado</span>
                ) : (
                  /* ⚠️ `flex-1` + `basis` y no un simple `flex-wrap`: con los
                     chips como bloque de tamaño natural, un día de dos franjas
                     con aviso de solape se pasaba del ancho y caía ENTERO a la
                     línea de abajo, alineado con el nombre del día en vez de
                     con los chips del resto de filas. Con base 220 px el bloque
                     se queda en su columna mientras quepa —y son los chips los
                     que envuelven dentro— y solo baja de línea cuando de verdad
                     no cabe, que es lo que hace falta a 390. */
                  <span className="flex min-w-0 flex-1 basis-[220px] flex-wrap items-center gap-1.5">
                    {list.map((r) => {
                      const vista = slotPreview[r.id];
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
                          {/* ⚠️ EL AVISO DE SOLAPE SE QUEDA (§3.2 lo dice con
                              esas palabras), aunque el «→ 9 clases» que iba a su
                              lado se haya ido. No es adorno: cuando dos franjas
                              del mismo día se pisan, `get_available_slots` une
                              los inicios y los huecos repetidos se ofrecen UNA
                              vez, así que el tutor cree tener el doble de lo que
                              tiene y esta es la única pantalla que se lo dice. */}
                          {vista?.solapa ? (
                            /* ⚠️ `#8a5f10` y no el `#a67314` del calendario:
                               sobre el fondo del chip (azul al 10 %, o sea
                               #e6f2ff) ese ámbar se queda en 3,64:1 y no llega
                               al 4,5:1 de 1.4.3. En el calendario sí pasa
                               porque el fondo de ahí es otro. */
                            <span
                              className="text-[#8a5f10]"
                              title="Esta franja se solapa con otra del mismo día. Los horarios repetidos se ofrecen una sola vez."
                            >
                              se solapa
                            </span>
                          ) : null}
                          {/* ⚠️ El aspa era el icono a pelo: 14×14 px de área
                              pulsable. Desde §3.2 es el ÚNICO control del chip
                              —se fueron «→ N clases» y «· N mentorías»— y la
                              puerta al diálogo que avisa de qué mentorías
                              cuelgan de la franja, o sea el objetivo más
                              pequeño de la pantalla con la consecuencia más
                              grande. La caja de 24 px cumple el mínimo de
                              2.5.8 sin tocar el dibujo ni la altura del chip
                              (28 px). Y `#4d7fb0` en vez de `#7aa8d6`, que
                              sobre el chip daba 2,20:1 contra el 3:1 que pide
                              1.4.11 para un icono. */}
                          <button
                            type="button"
                            aria-label={`Quitar la franja de ${hhmm(r.start_time)} a ${hhmm(r.end_time)} del ${WEEKDAYS[r.weekday].toLowerCase()}`}
                            disabled={busy}
                            onClick={() => pedirBorrado(r)}
                            className="-mr-1.5 grid size-6 shrink-0 place-items-center rounded-full text-[#4d7fb0] transition-colors hover:text-destructive"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </span>
                      );
                    })}
                  </span>
                )}
              </div>

              {estaAbierto ? (
                <form
                  id={ID_FORMULARIO}
                  onSubmit={(e) => addRule(day, e)}
                  className="mt-3 rounded-[12px] bg-muted p-3"
                >
                  {/* ⚠️ `htmlFor`/`id` en los tres campos y no solo el `<label>`
                      envolvente: así el nombre accesible no depende de dónde
                      esté anidado el control, y el `for` sigue funcionando si
                      mañana el formulario se reordena. */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* El selector de día MUEVE el formulario a la fila de ese
                        día: es la forma de que «bajo qué día estoy escribiendo»
                        no haya que recordarlo. */}
                    <label htmlFor="franja-dia" className="text-[13px] text-[#6b6b6b]">
                      Día{" "}
                      <select
                        id="franja-dia"
                        ref={selectDiaRef}
                        value={day}
                        disabled={busy}
                        onChange={(e) => {
                          // Marca ANTES de mover: el efecto de arriba devuelve
                          // el foco al selector que se monte en la otra fila.
                          moviendoDia.current = true;
                          setAbierto(Number(e.target.value));
                          setCopiando(false);
                        }}
                        className="h-9 rounded-[8px] border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {DISPLAY_ORDER.map((d) => (
                          <option key={d} value={d}>
                            {WEEKDAYS[d]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* «Desde»/«Hasta» y no «De»/«a», que es lo que había: el
                        campo de fin se anunciaba literalmente como «a», que no
                        es una etiqueta. Son además las palabras que usa §3.2 y
                        las que ya lleva el formulario de excepciones de esta
                        misma pantalla. */}
                    <label htmlFor="franja-desde" className="text-[13px] text-[#6b6b6b]">
                      Desde{" "}
                      <input
                        id="franja-desde"
                        type="time"
                        value={desde}
                        onChange={(e) => setDesde(e.target.value)}
                        required
                        className="h-9 rounded-[8px] border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </label>
                    <label htmlFor="franja-hasta" className="text-[13px] text-[#6b6b6b]">
                      Hasta{" "}
                      <input
                        id="franja-hasta"
                        type="time"
                        value={hasta}
                        onChange={(e) => setHasta(e.target.value)}
                        required
                        className="h-9 rounded-[8px] border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </label>
                    {/* §3.2 · «Copiar a otros días» sigue en el formulario.
                        Solo si hay algo que copiar: en un día cerrado copiaría
                        la nada. ⚠️ `type="button"`: ahora está DENTRO del
                        `<form>` y sin eso enviaría el alta. */}
                    {!vacio ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        disabled={busy}
                        aria-expanded={copiando}
                        onClick={() => setCopiando(!copiando)}
                        className="rounded-[8px] px-3 text-[13px]"
                      >
                        Copiar a otros días
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      disabled={busy}
                      size="lg"
                      className="ml-auto rounded-[8px] px-4 text-[13px]"
                    >
                      Añadir franja
                    </Button>
                  </div>

                  {copiando ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e0e0e0] pt-3">
                      <span className="text-[13px] text-[#6b6b6b]">
                        Copiar el horario del {WEEKDAYS[day].toLowerCase()} a
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        disabled={busy}
                        onClick={() =>
                          copiar(day, ENTRE_SEMANA.filter((d) => d !== day))
                        }
                        className="rounded-full bg-card px-3 text-[13px]"
                      >
                        Lunes a viernes
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        disabled={busy}
                        onClick={() => copiar(day, otros)}
                        className="rounded-full bg-card px-3 text-[13px]"
                      >
                        Toda la semana
                      </Button>
                    </div>
                  ) : null}
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>

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
                  volverá a ofrecerse en toda tu disponibilidad. Las sesiones ya
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
