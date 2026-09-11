"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon, PencilIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  horasSemana,
  seSolapan,
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
 * `id` del formulario. Sigue siendo único en la pantalla —solo hay un día
 * abierto a la vez, y editar reusa ESE MISMO formulario en vez de montar otro—
 * y no cambia al moverse de fila, que es justo lo que necesita el
 * `aria-controls` del botón de la cabecera para seguir apuntando a él.
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
 * ── Paquete de edición (11-sep-2026) ────────────────────────────────────────
 *
 * ⚠️ **EDITAR una franja es un `update`, NUNCA un borrar + crear.** Es la razón
 * de que hasta hoy no se pudiera editar y se resolviera "quitando y volviendo a
 * poner": eso arrastra los enlaces a mentorías por la FK `on delete cascade`
 * (`20260817200000`) y, si era el único de alguna, esa mentoría pasa a
 * ofrecerse en TODA la disponibilidad. O sea que corregir «09:00» por «09:30»
 * podía ABRIR una oferta, en silencio. La RLS ya daba `update` desde
 * `20260709130000`; lo que faltaba era la pantalla.
 *
 * ⚠️ **Copiar deja de estar escondido.** Estaba dentro del formulario de alta,
 * solo si el día ya tenía franjas, y había que desplegarlo para ver DOS
 * destinos fijos. Ahora es una acción de la fila del día —al lado de sus
 * franjas, que es de lo que habla— y los destinos se eligen uno a uno. «Lunes a
 * viernes» y «toda la semana» siguen ahí, pero como preselección, no como los
 * únicos destinos posibles.
 *
 * N-04 · desde que la disponibilidad se elige por mentoría, una franja puede
 * tener mentorías colgando. Borrarla ya no es una operación local: ver
 * `pedirBorrado`.
 */
export function AvailabilityManager({
  userId,
  rules,
  usedBy = {},
  titulo,
}: {
  userId: string;
  rules: Rule[];
  /** N-04 · rule_id → títulos de las mentorías que usan esa franja. */
  usedBy?: Record<string, string[]>;
  /**
   * ⚠️ DEROGADA por el paquete de edición, y se conserva solo para no romper a
   * quien la pasa. El aviso de solape era lo ÚNICO que quedaba de este objeto
   * —el «→ 9 clases de 60 min» se fue con §3.2— y ahora se calcula aquí con
   * `seSolapan`, porque venir de servidor era exactamente el problema: el paso
   * 4 del asistente monta este mismo gestor SIN esta prop (allí no hay
   * mentorías todavía), así que justo donde el tutor escribe sus franjas por
   * primera vez no se avisaba de nada.
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
  // Franja que el formulario está EDITANDO, o `null` si está dando de alta. Es
  // el mismo formulario: dos formularios idénticos con distinto verbo es lo que
  // §3.2 se dedicó a quitar de esta pantalla.
  const [editando, setEditando] = useState<Rule | null>(null);
  // ⚠️ Las horas son ESTADO y no campos sueltos del `<form>`: al cambiar de día
  // el formulario se desmonta de una fila y se monta en otra, y unos `<input>`
  // no controlados perderían por el camino lo que el tutor acababa de escribir.
  const [desde, setDesde] = useState(DESDE_POR_DEFECTO);
  const [hasta, setHasta] = useState(HASTA_POR_DEFECTO);
  // Día cuyo panel de copia está abierto, y los días marcados como destino.
  const [copiandoDia, setCopiandoDia] = useState<number | null>(null);
  const [destinos, setDestinos] = useState<Set<number>>(new Set());
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

  /**
   * Qué franjas pisan a otra del mismo día. Mismo criterio que `seSolapan` usa
   * en servidor para `buildSlotPreview`: solo entre ACTIVAS —una pausada no se
   * ofrece, así que no pisa nada— e intervalos medio abiertos.
   */
  const solapadas = new Set<string>();
  for (const list of byDay.values()) {
    const activas = list.filter((r) => r.is_active);
    for (const a of activas) {
      if (activas.some((b) => b.id !== a.id && seSolapan(a, b))) solapadas.add(a.id);
    }
  }

  /** Cierra formulario y panel de copia, y devuelve el formulario a su estado limpio. */
  function cerrarTodo() {
    setAbierto(null);
    setEditando(null);
    setCopiandoDia(null);
    setDesde(DESDE_POR_DEFECTO);
    setHasta(HASTA_POR_DEFECTO);
  }

  function alternarFormulario() {
    // Cerrar solo si lo que hay abierto es el ALTA: con una edición abierta el
    // botón dice «+ Añadir franja» y tiene que hacer eso, no cerrar otra cosa.
    if (abierto !== null && !editando) return cerrarTodo();
    cerrarTodo();
    setAbierto(DIA_POR_DEFECTO);
  }

  /**
   * Abre el formulario en modo edición, bajo la fila de la franja y con sus
   * horas ya puestas. El selector «Día» sigue vivo: mover una franja de día es
   * la corrección más obvia después de la hora, y en un `update` sale gratis.
   */
  function editar(rule: Rule) {
    setCopiandoDia(null);
    setEditando(rule);
    setAbierto(rule.weekday);
    setDesde(hhmm(rule.start_time));
    setHasta(hhmm(rule.end_time));
  }

  /**
   * Alta y edición en el mismo sitio: lo único que cambia es la escritura final.
   *
   * ⚠️ El DUPLICADO EXACTO no se inserta y no es un error: se avisa y ya, igual
   * que hace la copia desde siempre. Es validación de cliente a propósito —no
   * hay `unique` ni `exclude` en la tabla y no puede haberlos: hay franjas que
   * se solapan a posta desde antes de esto, y un solape sí sigue estando
   * permitido. Lo que no aporta nada es la MISMA franja dos veces, que es
   * justo lo que hace quien no está seguro de si ya pulsó.
   */
  async function guardarFranja(weekday: number, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!desde || !hasta || hasta <= desde) {
      return toast.error("La hora de fin debe ser mayor a la de inicio.");
    }

    const dia = WEEKDAYS[weekday].toLowerCase();
    const repetida = (byDay.get(weekday) ?? []).some(
      (r) =>
        r.id !== editando?.id &&
        hhmm(r.start_time) === desde &&
        hhmm(r.end_time) === hasta,
    );
    if (repetida) {
      return toast.info(`El ${dia} ya tiene ese horario.`);
    }

    setBusy(true);
    const supabase = createClient();
    // ⚠️ `update` y no borrar + insertar: un `delete` arrastra los enlaces a
    // mentorías (FK `on delete cascade`) y puede acabar abriendo una oferta en
    // toda la disponibilidad del tutor. Editando, los enlaces ni se enteran.
    const { error } = editando
      ? await supabase
          .from("availability_rules")
          .update({ weekday, start_time: desde, end_time: hasta })
          .eq("id", editando.id)
      : await supabase.from("availability_rules").insert({
          tutor_id: userId,
          weekday,
          start_time: desde,
          end_time: hasta,
        });
    setBusy(false);
    if (error) return toast.error(error.message || "No se pudo guardar el horario.");
    toast.success(
      editando ? `Franja del ${dia} actualizada.` : `Franja añadida el ${dia}.`,
    );
    // El formulario se cierra al guardar, así que la próxima vez que se abra
    // tiene que estar limpio y no con lo que se escribió hace dos franjas.
    cerrarTodo();
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
    if (editando?.id === id) cerrarTodo();
    setBorrando(null);
    router.refresh();
  }

  /**
   * Abre (o cierra) el panel de copia de un día. Arranca con «lunes a viernes»
   * ya marcado: era uno de los dos únicos destinos que había antes de este
   * paquete y sigue siendo lo primero que quiere cualquier tutor.
   */
  function alternarCopia(day: number) {
    const abriendo = copiandoDia !== day;
    setAbierto(null);
    setEditando(null);
    setCopiandoDia(abriendo ? day : null);
    setDestinos(new Set(abriendo ? ENTRE_SEMANA.filter((d) => d !== day) : []));
  }

  /**
   * Copia el horario de un día a otros. Salta los que ya tengan esa misma
   * franja: repetir «lunes a viernes» dos veces no debe duplicar nada, y es
   * justo lo que alguien hace cuando no está seguro de si ya pulsó.
   */
  async function copiar(desdeDia: number, hacia: number[]) {
    const origen = byDay.get(desdeDia) ?? [];
    if (origen.length === 0) return;
    if (hacia.length === 0) return toast.info("Marca al menos un día de destino.");

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
      setCopiandoDia(null);
      return toast.info("Esos días ya tenían este horario.");
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("availability_rules").insert(nuevas);
    setBusy(false);
    setCopiandoDia(null);
    if (error) return toast.error(error.message || "No se pudo copiar el horario.");
    toast.success(
      `Horario copiado a ${hacia.length} ${hacia.length === 1 ? "día" : "días"}.`,
    );
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
            y cerrado se pintaban igual.

            `!editando` en el estado: con una edición abierta este botón NO está
            expandido —lleva a otra cosa—, y anunciarlo como tal mandaría al
            lector a un formulario que dice «Guardar cambios». */}
        <Button
          type="button"
          size="lg"
          disabled={busy}
          aria-expanded={abierto !== null && !editando}
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
          const nombreDia = WEEKDAYS[day].toLowerCase();
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
                      const horas = `${hhmm(r.start_time)} a ${hhmm(r.end_time)}`;
                      const enEdicion = editando?.id === r.id;
                      return (
                        <span
                          key={r.id}
                          className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium ${
                            r.is_active
                              ? "bg-brand/10 text-[#0b4f96]"
                              : "bg-muted text-[#9c9c9c] line-through"
                          } ${enEdicion ? "ring-2 ring-brand/50" : ""}`}
                        >
                          {hhmm(r.start_time)}–{hhmm(r.end_time)}
                          {/* ⚠️ EL AVISO DE SOLAPE SE QUEDA (§3.2 lo dice con
                              esas palabras), aunque el «→ 9 clases» que iba a su
                              lado se haya ido. No es adorno: cuando dos franjas
                              del mismo día se pisan, `get_available_slots` une
                              los inicios y los huecos repetidos se ofrecen UNA
                              vez, así que el tutor cree tener el doble de lo que
                              tiene y esta es la única pantalla que se lo dice.
                              Desde el paquete de edición se calcula AQUÍ, no en
                              servidor: así el paso 4 del asistente —donde el
                              tutor escribe sus franjas por primera vez— también
                              lo avisa. */}
                          {solapadas.has(r.id) ? (
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
                          {/* ⚠️ Cajas de 24 px para los dos iconos, que es el
                              mínimo de 2.5.8, sin tocar el dibujo ni la altura
                              del chip (28 px). Y `#4d7fb0` en vez de `#7aa8d6`,
                              que sobre el chip daba 2,20:1 contra el 3:1 que
                              pide 1.4.11 para un icono.

                              ⚠️ El `aria-label` nombra la franja ENTERA —día y
                              horas—: en un día de tres franjas hay tres lápices
                              y tres aspas seguidos, y «Editar» a secas no dice
                              cuál de ellos (2.4.6). */}
                          <button
                            type="button"
                            aria-label={`Editar la franja de ${horas} del ${nombreDia}`}
                            aria-expanded={enEdicion}
                            aria-controls={ID_FORMULARIO}
                            disabled={busy}
                            onClick={() => (enEdicion ? cerrarTodo() : editar(r))}
                            className="ml-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[#4d7fb0] transition-colors hover:text-[#0b4f96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <PencilIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Quitar la franja de ${horas} del ${nombreDia}`}
                            disabled={busy}
                            onClick={() => pedirBorrado(r)}
                            className="-mr-1.5 grid size-6 shrink-0 place-items-center rounded-full text-[#4d7fb0] transition-colors hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </span>
                      );
                    })}

                    {/* ⚠️ COPIAR VIVE AQUÍ, en la fila del día, y no dentro del
                        formulario de alta como hasta hoy: allí había que abrir
                        el formulario, elegir el día en un `<select>` y desplegar
                        un panel para llegar a dos destinos fijos. Es una acción
                        SOBRE las franjas de este día, así que se pone al lado de
                        ellas. No aparece en un día cerrado porque copiaría la
                        nada. */}
                    <button
                      type="button"
                      aria-label={`Copiar el horario del ${nombreDia} a otros días`}
                      aria-expanded={copiandoDia === day}
                      aria-controls={`copia-${day}`}
                      disabled={busy}
                      onClick={() => alternarCopia(day)}
                      className="grid size-6 shrink-0 place-items-center rounded-full text-[#4d7fb0] transition-colors hover:bg-brand/10 hover:text-[#0b4f96] aria-expanded:bg-brand/10 aria-expanded:text-[#0b4f96] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <CopyIcon className="size-3.5" />
                    </button>
                  </span>
                )}
              </div>

              {estaAbierto ? (
                <form
                  id={ID_FORMULARIO}
                  onSubmit={(e) => guardarFranja(day, e)}
                  className="mt-3 rounded-[12px] bg-muted p-3"
                >
                  {/* ⚠️ `htmlFor`/`id` en los tres campos y no solo el `<label>`
                      envolvente: así el nombre accesible no depende de dónde
                      esté anidado el control, y el `for` sigue funcionando si
                      mañana el formulario se reordena. */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* El selector de día MUEVE el formulario a la fila de ese
                        día: es la forma de que «bajo qué día estoy escribiendo»
                        no haya que recordarlo. Editando, además, MUEVE la franja
                        de día — que en un `update` no cuesta nada. */}
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
                    {/* Editar sí necesita salida: el alta se cierra con el mismo
                        botón que la abrió, pero a una edición se entra desde un
                        lápiz que está a media lista. */}
                    {editando ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        disabled={busy}
                        onClick={cerrarTodo}
                        className="rounded-[8px] px-3 text-[13px]"
                      >
                        Cancelar
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      disabled={busy}
                      size="lg"
                      className="ml-auto rounded-[8px] px-4 text-[13px]"
                    >
                      {editando ? "Guardar cambios" : "Añadir franja"}
                    </Button>
                  </div>
                </form>
              ) : null}

              {copiandoDia === day ? (
                <div id={`copia-${day}`} className="mt-3 rounded-[12px] bg-muted p-3">
                  {/* `aria-labelledby` sobre el grupo: sin él, las siete
                      casillas se anuncian como «Martes, casilla» sueltas y no
                      dicen martes ¿para qué? (1.3.1). */}
                  <p
                    id={`copia-${day}-titulo`}
                    className="text-[13px] text-[#6b6b6b]"
                  >
                    Copiar el horario del {nombreDia} a
                  </p>
                  <div
                    role="group"
                    aria-labelledby={`copia-${day}-titulo`}
                    className="mt-2 flex flex-wrap gap-1.5"
                  >
                    {otros.map((d) => {
                      const marcado = destinos.has(d);
                      return (
                        /* Etiqueta de 36 px de alto con la casilla dentro: el
                           objetivo táctil es la etiqueta entera, no el cuadrito
                           de 16 px (2.5.8). El estado NO va solo por color
                           —cambia borde Y fondo, y la casilla marcada se ve—
                           porque el color solo no basta (1.4.1). El foco es el
                           anillo NATIVO de la casilla: por eso no lleva
                           `outline-none`. */
                        <label
                          key={d}
                          className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] transition-colors ${
                            marcado
                              ? "border-brand bg-brand/10 text-[#0b4f96]"
                              : "border-input bg-card text-[#4d4d4d]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={marcado}
                            disabled={busy}
                            onChange={() =>
                              setDestinos((p) => {
                                const next = new Set(p);
                                if (!next.delete(d)) next.add(d);
                                return next;
                              })
                            }
                            className="size-4 accent-brand"
                          />
                          {WEEKDAYS[d]}
                        </label>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e0e0e0] pt-3">
                    {/* Los dos destinos de antes sobreviven como PRESELECCIÓN:
                        siguen siendo lo que el 90 % quiere y ahora se pueden
                        retocar después de pulsarlos. */}
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      disabled={busy}
                      onClick={() =>
                        setDestinos(new Set(ENTRE_SEMANA.filter((d) => d !== day)))
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
                      onClick={() => setDestinos(new Set(otros))}
                      className="rounded-full bg-card px-3 text-[13px]"
                    >
                      Toda la semana
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      disabled={busy}
                      onClick={() => copiar(day, [...destinos])}
                      className="ml-auto rounded-[8px] px-4 text-[13px]"
                    >
                      {destinos.size > 0
                        ? `Copiar a ${destinos.size} ${destinos.size === 1 ? "día" : "días"}`
                        : "Copiar"}
                    </Button>
                  </div>
                </div>
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
                  reservadas no se tocan. Si solo quieres corregir la hora, usa
                  el lápiz: editar no toca los enlaces.
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
