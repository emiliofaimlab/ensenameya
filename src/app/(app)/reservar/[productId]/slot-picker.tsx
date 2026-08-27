"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ShoppingCartIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/catalog/format";
import { HOLD_POLICY } from "@/lib/policy";
import {
  PanelCard,
  PanelCardTitle,
  StatusPill,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { GoToCart } from "@/components/cart/go-to-cart";
import {
  CART_MAX_LINEAS,
  addCartLine,
  cartHasKeySnapshot,
  cartLineKey,
} from "@/lib/cart/cookie";

export type Slot = { slot_start: string; slot_end: string };

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * ⚠️ N-32 · ESTE CALENDARIO Y EL DE LA FICHA PÚBLICA (`BookingPanel`) TIENEN
 * QUE CONTAR LO MISMO, y hasta hoy no lo hacían. Agrupaban los huecos por
 * criterios distintos:
 *
 *   · `BookingPanel` usa `Intl` con la zona del visitante EXPLÍCITA;
 *   · este usaba `Date` local del navegador (`getFullYear`/`getMonth`/`getDate`).
 *
 * Se unifica en el primero, que es el bueno por dos motivos, no uno:
 *
 *   1. Este componente es de cliente pero TAMBIÉN se renderiza en el servidor
 *      (SSR de la primera carga). Allí `new Date(iso).getDate()` da el día en la
 *      zona del SERVIDOR —UTC en Vercel—, así que el HTML llegaba con una
 *      rejilla y el navegador la repintaba con otra. Es el bug R24-12/RV-03 otra
 *      vez, y en un calendario se ve como un hueco que salta de día.
 *   2. La zona del usuario NO es siempre la del navegador: `getUserTimezone()`
 *      prefiere `profiles.timezone`. Quien tenga guardado Lima y esté de viaje
 *      en Madrid veía la ficha en Lima y esta pantalla en Madrid.
 *
 * Regla para quien toque esto: aquí NO se usa `new Date(...).getDate()`,
 * `getMonth()` ni `getDay()` sobre un instante. Los días se calculan como texto
 * con `timeZone` explícita, y la rejilla del mes con aritmética UTC sobre
 * números, que no depende de ninguna zona.
 */
const dayKey = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** "(GMT-5) America/Lima" — el offset sale del propio Intl, sin tabla fija. */
function tzLabel(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("es", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date());
  const off = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  return off ? `(${off}) ${timeZone}` : timeZone;
}

const timeLabel = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

const chipLabel = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

/**
 * Semana empezando en DOMINGO, como `BookingPanel`. Empezaba en lunes y era la
 * otra mitad de «el calendario salta en otra forma»: la misma fecha caía en una
 * columna distinta en cada pantalla. Manda la de la ficha pública porque es la
 * que se ve primero y la que sobrevive al flujo nuevo (N-33).
 */
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/** "YYYY-MM" ± n meses, con aritmética UTC (sin zonas de por medio). */
function moverMes(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * US-601 (SCR-AL04) — selección de horario. Los `slot_start` llegan en UTC desde
 * get_available_slots (ya descontadas reglas/excepciones/ocupados) y se pintan en
 * la hora local del alumno. Para paquetes se eligen N horarios (RN-12).
 *
 * ⚠️ N-33 · desde el 17-ago esta pantalla YA NO está en el camino normal de una
 * sesión suelta: la página la salta cuando llega una hora válida y solo hay una
 * que elegir. Lo que queda aquí es la selección MÚLTIPLE de los paquetes —que no
 * cabe en el panel lateral de la ficha— y el respaldo de quien llega sin hora.
 * Por eso no se borró: borrarla dejaba los paquetes sin forma de reservarse.
 *
 * ponytail: calendario a mano — react-day-picker (lo que usa el calendar de
 * shadcn) sería una dependencia nueva para pintar una rejilla de 42 celdas y
 * marcar los días con hueco.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LA DISPOSICIÓN, Y POR QUÉ ES ÉSTA. («no me gusta nada cómo se ve»)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Lo que había eran **tres cajas para una sola tarea**: el calendario arriba a
 * la izquierda, los horarios del día **debajo** del calendario, y «Tu selección»
 * a la derecha. Elegir una sesión obligaba a bajar la vista (día → hora) y a
 * volver a subirla (hora → cuenta), y en un paquete eso se repite N veces. El
 * contador —lo único que explica por qué el botón está bloqueado— vivía en la
 * tercera caja, que es justo donde no se está mirando mientras se elige.
 *
 * Ahora son **dos zonas, en una fila**:
 *
 *   1. **Elegir** (una tarjeta): el calendario y los horarios del día abierto
 *      LADO A LADO. Son un solo gesto —día y hora—, así que van en la misma
 *      caja y separados solo por una línea. El contador de progreso se pinta en
 *      la cabecera de la columna de horas, o sea **encima de los botones que se
 *      están pulsando**, que es la petición literal.
 *   2. **Confirmar** (la tarjeta de la derecha): lo elegido, el total y los
 *      botones. Sigue siendo `sticky`, así que no se mueve mientras se elige.
 *
 * Los horarios NO se han convertido en un `<select>` como en `booking-panel`
 * (B3.4), y es la diferencia que manda entre las dos pantallas: allí se elige
 * UNA hora y un desplegable la resuelve en un gesto; aquí hay que elegir N y
 * **verlas todas a la vez** para no repetir ni dejar huecos. Un `<select>` que
 * hay que abrir seis veces, y que tapa el calendario cada vez, es peor que una
 * rejilla de chips. Lo que sí se le copia es el ancho fijo de la columna: el
 * salto de altura que B3.4 arregló allí aquí no ocurre porque los chips ya no
 * están debajo del calendario, sino al lado.
 *
 * ⚠️ El menú lateral del panel se quita en la PÁGINA, no aquí (`page.tsx`
 * pasa `sidebar={false}`). Ese es el ancho que hace que quepan las dos zonas.
 */
export function SlotPicker({
  productId,
  productTitle,
  tutorName,
  slots,
  preselected = null,
  required,
  total,
  currency,
  durationMin,
  timeZone,
  enCarrito: enCarritoInicial,
}: {
  productId: string;
  productTitle: string;
  tutorName?: string;
  slots: Slot[];
  /**
   * M-10 · Horario que el alumno ya eligió en la ficha (`?slot=`), validado
   * contra los huecos reales por la página. Llega marcado y con su día abierto:
   * repetir la elección era justo lo que se sentía como "se perdió".
   */
  preselected?: string | null;
  required: number;
  /** Total de la reserva (fijo): paquete completo o sesión suelta. */
  total: number;
  currency: string;
  durationMin: number | null;
  /**
   * Zona del alumno (`getUserTimezone`), resuelta en el servidor. Obligatoria:
   * ver la nota de `dayKey`. Sin ella el SSR agrupa por la zona del servidor.
   */
  timeZone: string;
  /**
   * Líneas que ya hay en el carrito, leídas de la cookie en SERVIDOR. Es el
   * `initial` de `cart-badge.tsx` y está por lo mismo: sin él «Ir al carrito»
   * no existiría en el HTML y aparecería de golpe al hidratar.
   */
  enCarrito: number;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(preselected ? [preselected] : []),
  );

  // Slots por día del alumno. El orden dentro de cada día ya viene por slot_start.
  const byDay = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const s of slots) {
      const key = dayKey(s.slot_start, timeZone);
      const bucket = groups.get(key);
      if (bucket) bucket.push(s.slot_start);
      else groups.set(key, [s.slot_start]);
    }
    return groups;
  }, [slots, timeZone]);

  // El calendario arranca donde está el horario que traía el alumno; si no
  // trae ninguno, en el primer hueco libre, como siempre.
  const primerDia = preselected
    ? dayKey(preselected, timeZone)
    : slots.length > 0
      ? dayKey(slots[0]!.slot_start, timeZone)
      : dayKey(new Date().toISOString(), timeZone);

  const [ym, setYm] = useState(() => primerDia.slice(0, 7));
  const [openDay, setOpenDay] = useState<string | null>(
    preselected || slots.length > 0 ? primerDia : null,
  );

  // Rejilla del mes. Números de calendario y claves de texto, sin objetos `Date`
  // locales: así no se desplaza por la zona de quien la renderice (mismo patrón
  // que `BookingPanel`).
  const { year, month, cells } = useMemo(() => {
    const [y, m] = ym.split("-").map(Number) as [number, number];
    const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = domingo
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      year: y,
      month: m,
      cells: [
        ...Array.from({ length: offset }, () => null),
        ...Array.from({ length: total }, (_, i) => i + 1),
      ] as (number | null)[],
    };
  }, [ym]);

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    "es",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  function toggle(iso: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) {
        next.delete(iso);
        return next;
      }
      if (required === 1) return new Set([iso]); // sesión única: reemplaza
      if (next.size >= required) {
        toast.error(`Elige exactamente ${required} horarios.`);
        return prev;
      }
      next.add(iso);
      return next;
    });
  }

  /*
   * EY-178 · el acuse de recibo, reusando `.animate-cart-bump` de `globals.css`
   * — la MISMA animación que da la insignia de la cabecera al subir el número.
   * No se inventa otra a propósito: las dos dicen «se ha añadido», y dos formas
   * distintas de decir lo mismo se leen como dos cosas distintas.
   *
   * Aquí hace más falta que en la ficha, porque al añadir **la selección se
   * limpia**: sin una señal, seis horarios que desaparecen de golpe se leen
   * como «se ha perdido», que es lo contrario de lo que ha pasado. Por eso van
   * las tres: el salto del icono (aquí), el `toast` (arriba) y el salto de la
   * insignia (que se dispara solo con el evento de la cookie).
   */
  const [saltos, setSaltos] = useState(0);
  useEffect(() => {
    if (saltos === 0) return;
    const t = setTimeout(() => setSaltos(0), 300);
    return () => clearTimeout(t);
  }, [saltos]);

  const completa = selected.size === required;

  /**
   * B3.2 · añade la línea al carrito y **deja la pantalla lista para otra**.
   *
   * ⚠️ NO NAVEGA, y ese es el encargo: «tras añadir, se limpia la selección y
   * la pantalla queda lista para otra». El sitio al que se iría —el carrito—
   * está en el botón de debajo, que decide él solo si aparece.
   */
  function agregar() {
    // Cinturón: el botón ya está `disabled`, pero un `Enter` sobre un formulario
    // o un futuro atajo de teclado no lo estarían. Añadir un paquete a medias
    // mete en la cookie una línea que `create_booking` rechazaría al pagar
    // («debes elegir N horario(s)»), dos pantallas más tarde y sin pistas.
    if (!completa) return;

    // Instantes, no ISO: la cookie guarda momentos. El porqué —que el mismo
    // instante llega como `Z` de la URL y como `+00:00` de Postgres— está en
    // `lib/cart/cookie.ts`.
    const linea = { productId, slots: [...selected].map((iso) => Date.parse(iso)) };
    // `addCartLine` es idempotente y devuelve `null` tanto si añadió como si la
    // línea ya estaba, así que se pregunta ANTES: decirle «agregada» a quien
    // acaba de recomponer los mismos seis horarios sería mentirle.
    const repetida = cartHasKeySnapshot(cartLineKey(linea));

    const fallo = addCartLine(linea);
    if (fallo === "lleno") {
      toast.error(
        `El carrito admite ${CART_MAX_LINEAS} mentorías. Paga las que tienes o quita alguna.`,
      );
      return;
    }
    if (fallo) {
      toast.error("No se pudo agregar esta mentoría. Vuelve a elegir los horarios.");
      return;
    }

    setSelected(new Set());
    setSaltos((n) => n + 1);
    toast.success(
      repetida
        ? "Esos horarios ya estaban en el carrito."
        : "Mentoría agregada al carrito.",
    );
    // El contador de la cabecera se pinta en SERVIDOR desde la cookie: sin
    // invalidar su render el número no cambiaría hasta la siguiente navegación
    // completa. No lleva a ningún sitio — repinta donde ya estamos.
    router.refresh();
  }

  if (slots.length === 0) {
    return (
      <PanelCard>
        <p className="text-[13px] text-[#6b6b6b]">
          Este tutor no tiene horarios disponibles por ahora. Vuelve a intentarlo
          más tarde.
        </p>
      </PanelCard>
    );
  }

  const openSlots = openDay ? (byDay.get(openDay) ?? []) : [];

  /*
   * B3.5 · el `div` de fuera existe SOLO para que la barra de abajo tenga de
   * quién colgarse.
   *
   * `position: sticky` se mide contra el bloque contenedor, y en una rejilla el
   * bloque contenedor de un hijo es SU CELDA: metida dentro del `grid`, la
   * barra solo podría pegarse a lo alto de su propia fila —o sea, a nada—.
   * Colgando de un bloque normal que envuelve toda la pantalla, el recorrido
   * pegajoso es el alto entero del selector, que es lo que se busca.
   */
  return (
    <div>
      {/* ⚠️ La columna de confirmar mide 320 y no 360, y los 40 px de diferencia
          se los come la de horas EN EL PEOR ANCHO. A 1024 exactos la cuenta es:
          944 de contenido − 24 de hueco − la columna derecha, menos el `p-5` de
          la tarjeta, los 300 del calendario y sus 20+20 de hueco y sangrado.
          Con 360 quedaban 179 px para los chips → DOS por fila; con 320 quedan
          219 → tres, que es el mínimo para que un día de ocho horas no se lea
          como una lista vertical. Arriba de 1280 sobra sitio en las dos
          versiones. 320 sigue siendo el ancho de panel de la casa (el de la
          ficha ronda los 330). */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/*
          ZONA 1 · ELEGIR — el día y la hora, en la MISMA tarjeta y uno al lado
          del otro.

          Antes eran dos tarjetas apiladas, y esa pila era el problema: los
          horarios del día nacían DEBAJO del calendario, así que cada sesión
          costaba bajar la vista y volver a subirla. En un paquete de seis, seis
          veces. Elegir el día y elegir la hora son un solo gesto encadenado —el
          segundo no significa nada sin el primero—, así que van en la misma
          caja, separados por una línea y no por un borde, un margen y una
          sombra.

          ⚠️ EL LADO A LADO ENTRA EN `md` (768 px) Y EL NÚMERO SALE DE UNA CUENTA.
          La rejilla del mes no baja de ~300 px sin que las celdas dejen de ser
          pulsables con el pulgar (7 columnas + 6 huecos de 8 px → 36 px por
          celda, contra los 40 de alto que ya tenían). La columna de horas
          necesita al menos otros ~300 para poner tres chips por fila. Con el
          `p-5` de `PanelCard` y el hueco de 20, eso son 300+20+300+40 = 660 px
          de ventana como suelo: `md` es el primer corte que los da (768 − 48 de
          aire = 720). Por debajo se apilan, que es lo correcto en un teléfono.
        */}
        <PanelCard>
          <div className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
            {/* ── Columna A · el mes ── */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[17px] font-bold text-[#19191f] first-letter:uppercase">
                  {monthLabel}
                </h2>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Mes anterior"
                    onClick={() => setYm(moverMes(ym, -1))}
                  >
                    <ChevronLeftIcon className="size-4 text-[#6b6b6b]" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Mes siguiente"
                    onClick={() => setYm(moverMes(ym, 1))}
                  >
                    <ChevronRightIcon className="size-4 text-[#6b6b6b]" />
                  </Button>
                </div>
              </div>

              {/* El Figma pone la zona horaria aquí, no en el panel lateral. */}
              <p className="mt-2 text-xs text-[#6b6b6b]">
                Hora local: {tzLabel(timeZone)}
              </p>

              <div className="mt-3.5 grid grid-cols-7 gap-2 text-center">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="flex h-10 items-center justify-center text-[13px] font-medium text-[#6b6b6b]"
                  >
                    {d}
                  </div>
                ))}
                {cells.map((d, i) => {
                  if (!d) return <div key={`x${i}`} className="h-10" />;
                  const key = `${year}-${pad(month)}-${pad(d)}`;
                  const has = byDay.has(key);
                  const isOpen = key === openDay;
                  const chosen = (byDay.get(key) ?? []).some((iso) =>
                    selected.has(iso),
                  );
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!has}
                      onClick={() => setOpenDay(key)}
                      aria-pressed={isOpen}
                      className={cn(
                        "h-10 rounded-[10px] text-sm font-medium transition-colors",
                        // Sin huecos: número apagado y sin caja, como el Figma.
                        !has && "text-[#c4c4c4]",
                        has && "border-[1.5px] border-[#e0e0e0] text-[#19191f]",
                        has && !isOpen && !chosen && "hover:border-brand",
                        // Azul sólido = día con sesión elegida (168:8) o día abierto.
                        (chosen || isOpen) &&
                          "border-brand bg-brand text-white hover:border-brand",
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            {/*
              ── Columna B · las horas de ese día ──

              ⚠️ La separación cambia de eje con el breakpoint y no es
              decoración: apilada, lo que separa dos bloques es una línea
              HORIZONTAL arriba; al lado, una VERTICAL a la izquierda. Con una
              sola de las dos, en la otra anchura la línea queda atravesada o no
              hay línea ninguna.
            */}
            <div className="max-md:border-t max-md:border-[#e0e0e0] max-md:pt-5 md:border-s md:border-[#e0e0e0] md:ps-5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <PanelCardTitle className="text-[17px] first-letter:uppercase">
                  {openSlots.length > 0
                    ? new Date(openSlots[0]!).toLocaleDateString("es", {
                        weekday: "long",
                        day: "numeric",
                        month: "short",
                        timeZone,
                      })
                    : "Horarios"}
                </PanelCardTitle>

                {/*
                  ⚠️ EL CONTADOR VIVE AQUÍ, encima de los chips que se están
                  pulsando, y no en la tarjeta de la derecha donde estaba. Es lo
                  ÚNICO que explica por qué el botón está bloqueado («0 de 6»),
                  así que tiene que verse mientras se elige, no al llegar al
                  final. En un paquete es además la cuenta atrás del trabajo que
                  queda.

                  `role="status"` para que el lector de pantalla cante el avance
                  al pulsar cada hora: sin él, un ciego pulsa seis veces sin que
                  nada le diga cuántas lleva. Y `StatusPill` en vez de un `span`
                  a medida porque es la píldora del panel y ya trae los tonos —
                  ⚠️ sin pisarle la altura (N-15).
                */}
                <StatusPill role="status" tone={completa ? "green" : "gray"}>
                  {selected.size} de {required}{" "}
                  {required === 1 ? "elegida" : "elegidas"}
                </StatusPill>
              </div>

              <p className="mt-1 text-xs text-[#6b6b6b]">
                Horarios disponibles
                {durationMin ? ` · ${durationMin} min` : ""}
              </p>

              {openSlots.length > 0 ? (
                <div className="mt-3.5 flex flex-wrap gap-2">
                  {openSlots.map((iso) => {
                    const on = selected.has(iso);
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => toggle(iso)}
                        aria-pressed={on}
                        className={cn(
                          "inline-flex h-9 items-center rounded-full border-[1.5px] px-3.5 text-[13px] font-medium transition-colors",
                          on
                            ? "border-brand bg-brand text-white"
                            : "border-[#e0e0e0] bg-card text-[#19191f] hover:border-brand",
                        )}
                      >
                        {timeLabel(iso, timeZone)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* Con `slots` vacío la pantalla ni llega aquí (hay un retorno
                   antes), así que esto solo se ve si algún día se puede cerrar
                   el día abierto. Se pinta igualmente para que la columna nunca
                   quede hueca: en dos columnas, un lado vacío parece un fallo. */
                <p className="mt-3.5 text-[13px] text-[#6b6b6b]">
                  Elige un día marcado en el calendario para ver sus horarios.
                </p>
              )}

              {/* El Figma pinta además los horarios OCUPADOS en gris.
                  `get_available_slots` solo devuelve los libres —los ocupados no
                  salen de la BD—, así que aquí solo hay huecos reservables. */}
            </div>
          </div>
        </PanelCard>

        {/*
          ZONA 2 · CONFIRMAR — lo elegido, el total y los botones.

          Sigue `sticky` en escritorio: mientras se recorre el calendario, la
          lista de horas que llevas no se mueve del sitio. Aquí `lg:sticky` SÍ
          tiene recorrido (a diferencia del panel de `booking-panel.tsx`, ver su
          nota del 26-ago): esta tarjeta es hija directa de la rejilla y la
          columna de al lado es más alta, así que hay holgura por la que
          despegarse.
        */}
        <PanelCard className="lg:sticky lg:top-24">
          <PanelCardTitle className="text-[17px]">Tu selección</PanelCardTitle>
          <p className="mt-2.5 text-[13px] text-[#6b6b6b]">
            {productTitle}
            {tutorName ? ` · con ${tutorName}` : ""}
          </p>

          <hr className="my-3 border-[#e0e0e0]" />

          {selected.size === 0 ? (
            <p className="text-[13px] text-[#6b6b6b]">
              Elige un día en el calendario y luego su horario.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {[...selected].sort().map((iso) => (
                <li
                  key={iso}
                  className="flex items-center justify-between gap-2 text-[13px] text-[#19191f]"
                >
                  <span className="first-letter:uppercase">
                    {chipLabel(iso, timeZone)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(iso)}
                    aria-label={`Quitar ${chipLabel(iso, timeZone)}`}
                    className="text-[#6b6b6b] transition-colors hover:text-destructive"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <hr className="my-3 border-[#e0e0e0]" />

          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-[#6b6b6b]">Total</span>
            <span className="text-base font-bold text-[#19191f]">
              {formatMoney(total, currency)}
            </span>
          </div>

          {/*
            EY-177 · B3.2 · EL MODELO DE BOTONES, EL MISMO QUE EN LA FICHA.

            «Agregar al carrito» SIEMPRE a la vista, bloqueado hasta tener los N
            horarios; «Ir al carrito» debajo, con una única condición: que el
            carrito tenga algo. Esa condición NO mira lo que se acaba de hacer
            —quien llega con dos mentorías apuntadas de ayer ve el botón sin
            haber pulsado nada— y por eso sale de la cookie y no de un estado.

            ⚠️ AQUÍ SE RETIRA «CONTINUAR AL PAGO», que era el botón principal de
            esta pantalla. El paquete deja de tener un atajo propio al checkout y
            pasa por el carrito como todo lo demás, que es lo que ya hacía la
            sesión suelta desde EY-177: dos caminos al pago en la misma tienda
            era la incoherencia, no el número de pasos. La URL directa
            (`/reservar/<id>/checkout?slots=…`) NO desaparece ni se rompe: la
            sigue usando el desvío de una sola sesión de `page.tsx` (N-33) y el
            paso a pago de una línea suelta del propio carrito.

            ⚠️ Y no se reusa `<AddToCart>` aun siendo el mismo gesto: ese
            componente implementa el modelo VIEJO —un botón que, al pulsarlo, se
            sustituye por «Seguir comprando» + «Ir al carrito»—, que es
            justamente lo que aquí se cambia. Además su «seguir comprando»
            navega, y aquí seguir comprando es quedarse con la selección en
            blanco.

            ⚠️ `max-lg:hidden`: en móvil manda la barra de abajo. Dos «Agregar
            al carrito» a la vez —uno pegado abajo y otro dentro de la tarjeta—
            hacen dudar de si son el mismo. En escritorio no hay barra.
          */}
          <div className="mt-4 flex flex-col gap-2.5 max-lg:hidden">
            <Button
              type="button"
              className="h-[45px] w-full rounded-[10px] text-sm font-semibold"
              disabled={!completa}
              onClick={agregar}
            >
              <ShoppingCartIcon
                className={cn("size-4", saltos > 0 && "animate-cart-bump")}
              />
              Agregar al carrito
            </Button>

            <GoToCart
              initial={enCarritoInicial}
              buttonClassName="h-[45px] w-full rounded-[10px] text-sm font-semibold"
            />

            {/* Por qué está bloqueado, al lado del botón bloqueado. La píldora
                de arriba dice cuánto llevas; esto dice cuánto falta, que es la
                pregunta que se hace quien mira un botón gris. */}
            {!completa ? (
              <p className="text-center text-xs text-[#6b6b6b]">
                {required - selected.size === 1
                  ? "Elige 1 horario más para agregarla."
                  : `Elige ${required - selected.size} horarios más para agregarla.`}
              </p>
            ) : null}
          </div>

          {/*
            ⚠️ ESTA FRASE DECÍA LO CONTRARIO DE LO QUE PASA, DOS VECES YA.

            Primero prometía que «el horario queda reservado al confirmar el
            pago», y dejó de ser cierto con D-2 (§20.14), cuando la reserva pasó
            a crearse AL LLEGAR al checkout. Se corrigió a «al continuar te
            guardamos el horario N minutos»… y hoy vuelve a fallar, porque el
            botón ya no lleva al checkout: **lleva al carrito, y el carrito NO
            retiene nada** (opción A del Doc 23 §23.3.5, escrita en
            `lib/cart/cookie.ts`). Entre agregar y pagar, otro alumno puede
            llevarse el hueco.

            Así que dice las dos mitades, y es la misma redacción que la pantalla
            de revisión (`/carrito`) para que no haya dos versiones del mismo
            trato. El número sigue saliendo de `HOLD_POLICY` —la copia del
            `p_payment_cutoff` de `expire_stale_bookings`—: tecleado a mano en
            tres pantallas es como se llega a que dos mientan.
          */}
          <p className="mt-3 text-xs leading-relaxed text-[#6b6b6b]">
            Agregar no bloquea el horario: hasta que no entras al pago, otro
            alumno puede llevárselo. Al pasar al pago te lo reservamos{" "}
            {HOLD_POLICY.minutes} minutos para que lo completes.
          </p>
        </PanelCard>
      </div>

      {/*
        B3.5 · LA BARRA DE MÓVIL (EY-180). En una columna las tarjetas se apilan
        y el botón acaba a una pantalla del calendario: se elige el día, se elige
        la hora, y no hay ni un indicio de que exista un paso siguiente. Peor en
        un paquete, donde hay que repetir la elección N veces antes de llegar
        abajo. Así que el botón se despega y baja al borde de la ventana, con el
        contador y el total al lado.

        ⚠️ El hueco de la derecha (`pe-[84px]`) es para la burbuja de chat:
        `fixed right-5 bottom-5 z-50` (`chat-bubble.tsx`) se pinta encima de esta
        barra, y sin el hueco el final del botón abre el chat en lugar de
        agregar. Y el número sale de una cuenta, no del ojo: la burbuja es
        `right-5` (20 px) + `size-14` (56 px) = **76 px de huella** desde el
        borde derecho de la VENTANA, que es hasta donde llega esta barra por el
        `-mx-4`. Empezó siendo `pe-[72px]` y se quedaba 4 px corta — justo la
        esquina del botón, que es donde cae el pulgar. 84 deja 8 px de aire. Ojo
        si alguien toca el tamaño de la burbuja: este número va detrás.

        ⚠️ El `-mx-4 sm:-mx-6` la lleva a los bordes de la ventana cancelando el
        aire lateral de `PanelShell`. Son SUS números: si allí cambia el padding,
        aquí también, o la barra deja de encajar. Quitar el menú lateral no los
        toca —el contenedor y su `px` son los mismos con menú y sin él—, y por
        eso el menú se quita con una opción de `PanelShell` y no envolviendo esta
        pantalla en otra cosa.

        ⚠️ SEGUNDA FILA CONDICIONAL. La barra crece un botón cuando el carrito
        tiene algo, y es el precio de que «Ir al carrito» dependa solo de eso
        —también en móvil, que es donde más se compra—. No es alto nuevo neto: a
        cambio desaparece de aquí la línea del plazo de retención, que ocupaba
        dos renglones y que además ya no sería cierta (agregar no retiene; el
        texto completo vive en la tarjeta de arriba).
      */}
      <div className="sticky bottom-0 z-30 mt-5 -mx-4 border-t border-[#e0e0e0] bg-card pt-3 pb-3 ps-4 pe-[84px] sm:-mx-6 sm:ps-6 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="shrink-0 leading-tight">
            <p className="text-[11px] text-[#6b6b6b]">
              {selected.size} de {required}
            </p>
            <p className="text-[13px] font-bold text-[#19191f]">
              {formatMoney(total, currency)}
            </p>
          </div>
          <Button
            type="button"
            className="h-[45px] flex-1 rounded-[10px] text-sm font-semibold"
            disabled={!completa}
            onClick={agregar}
          >
            <ShoppingCartIcon
              className={cn("size-4", saltos > 0 && "animate-cart-bump")}
            />
            Agregar al carrito
          </Button>
        </div>

        <GoToCart
          initial={enCarritoInicial}
          buttonClassName="mt-2 h-[38px] w-full rounded-[10px] text-[13px] font-semibold"
        />
      </div>
    </div>
  );
}
