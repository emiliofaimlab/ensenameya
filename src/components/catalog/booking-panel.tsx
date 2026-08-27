import type { ReactNode } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BookingSelect } from "@/components/catalog/booking-select";
import { AddToCart } from "@/components/cart/add-to-cart";
import { GoToCart } from "@/components/cart/go-to-cart";
import { cartCount } from "@/lib/cart/resolve";
import { perSessionLabel, priceDisplay } from "@/lib/catalog/format";
import { listProductSlots } from "@/lib/catalog/queries";
import type { ProductCardData } from "@/lib/catalog/queries";

const WEEKDAYS = ["D", "L", "M", "M", "J", "V", "S"];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Clave de día "YYYY-MM-DD" **en la zona del visitante** (R24-22): un hueco de
 * las 23:00 en México es del día siguiente en Madrid, y el calendario tiene que
 * agruparlo donde el visitante lo vive — no donde está el servidor.
 * `en-CA` da exactamente ese formato.
 */
const slotDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

/** Hora del hueco en la zona del visitante. */
const slotTime = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });

/** Horarios que hay que elegir para reservar esta mentoría (RN-12). */
const sesionesPorReserva = (p: ProductCardData) =>
  p.pricingModel === "per_package" ? (p.packageNumSessions ?? 1) : 1;

/**
 * N-33 + N-32 · a dónde lleva CONFIRMAR una hora. Del calendario al pago, sin
 * volver a preguntar lo mismo.
 *
 * El cliente lo dijo con estas palabras: «estás seleccionando dos veces algo»
 * y «me mareó un poco que el calendario salga dos veces […] yo selecciono el 14
 * a las 8 de la mañana y después me salta, y como salta en otra forma, yo digo
 * "ya estoy reservando, ¿a qué hora es que yo reservé?"». Elegir la hora AQUÍ
 * ya es elegir; `/reservar/<id>` repintaba otro calendario —con otra forma y
 * otro día de inicio de semana— para preguntar exactamente lo mismo.
 *
 * ⚠️ POR QUÉ LA PANTALLA INTERMEDIA NO SE BORRA. Parece vacía y no lo está: es
 * la única que resuelve la selección MÚLTIPLE de los paquetes (`per_package`
 * con N sesiones exige elegir N horarios, RN-12) y no hay sitio en este panel
 * lateral para eso. Así que:
 *
 *   · sesión suelta  → derecho al checkout, con el horario ya en la URL;
 *   · paquete        → a `/reservar/<id>?slot=…`, que preselecciona esa primera
 *                      hora (M-10) y pide las que faltan.
 *
 * Y `/reservar/<id>` sigue existiendo además como respaldo para quien llega sin
 * hora elegida: un enlace guardado, un marcador, un hueco que se ocupó entre
 * medias. Ya NO se llega ahí desde el botón grande de este panel — ver la nota
 * del CTA.
 */
const destinoDeLaHora = (p: ProductCardData, iso: string) =>
  sesionesPorReserva(p) > 1
    ? `/reservar/${p.id}?slot=${encodeURIComponent(iso)}`
    : `/reservar/${p.id}/checkout?slots=${encodeURIComponent(iso)}`;

/**
 * Panel de reserva de P07/P08 — flujo **día → clase → horario** (R24-13).
 *
 * El calendario es GLOBAL del tutor: pinta los días con hueco de cualquiera de
 * sus mentorías. Al elegir día aparece el selector de clase (solo las que
 * tienen hueco ese día) y, al elegir clase, sus horarios. Así una reserva
 * siempre deja claro QUÉ clase se está pagando, que era el problema cuando el
 * tutor dicta varias.
 *
 * El **precio es dinámico** (R24-14): no se muestra un importe fijo por
 * adelantado; aparece cuando ya hay clase elegida (en P08 la clase viene dada,
 * así que se ve desde el principio).
 *
 * ponytail: todo por URL y renderizado en servidor — sin estado de cliente ni
 * calendario de librería. Los huecos salen de `get_available_slots`, la misma
 * función que usa el flujo de reserva, así que no hay dos verdades.
 */
export async function BookingPanel({
  products,
  selectedId,
  selectedDay,
  selectedTime,
  hrefFor,
  ctaLabel = "Reservar mentoría YA",
  note = "Pago protegido · Cancela con 24h y recibe el 100%.",
  details = false,
  footer,
  timeZone,
}: {
  products: ProductCardData[];
  selectedId?: string;
  selectedDay?: string;
  /**
   * MN-16 · la hora elegida, en ISO, tal cual viaja por la URL. Llega SIN
   * validar: es texto de la barra de direcciones. Se contrasta abajo contra los
   * huecos reales y solo entonces pinta o desbloquea nada.
   */
  selectedTime?: string;
  /** Zona del visitante (`getViewerTimezone`): con sesión, la suya; sin sesión,
   *  la del navegador. Sin ella el SSR pintaría la hora del servidor (R24-22). */
  timeZone: string;
  hrefFor: (next: { p?: string; d?: string; h?: string }) => string;
  ctaLabel?: string;
  note?: string;
  /** P08 añade equivalencia por sesión y duración bajo el precio. */
  details?: boolean;
  /** Contenido extra bajo el botón (P08: política de cancelación). */
  footer?: ReactNode;
}) {
  if (products.length === 0) {
    return (
      <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)]">
        <p className="text-sm text-muted-foreground">
          Este tutor aún no tiene mentorías disponibles para reservar.
        </p>
      </aside>
    );
  }

  /* Cuántas mentorías hay ya apuntadas. Es solo leer la cookie (`cookies()`,
     sin viaje a la base), y estas fichas ya son dinámicas porque resuelven la
     zona horaria del visitante — así que no cambia el modo de render de nadie.
     Sirve para que «Ir al carrito» se pinte YA en el SSR en vez de aparecer un
     instante después de hidratar, moviendo la barra de abajo bajo el dedo. */
  const enCarrito = await cartCount();

  // Huecos de TODAS las mentorías: el calendario es del tutor, no de una clase.
  const slotsByProduct = new Map<string, string[]>(
    await Promise.all(
      products.map(
        async (p) =>
          [p.id, (await listProductSlots(p.id)).map((s) => s.start)] as const,
      ),
    ),
  );

  /** día → ids de las clases que tienen hueco ese día (en la zona del visitante). */
  const productsByDay = new Map<string, Set<string>>();
  for (const [pid, starts] of slotsByProduct) {
    for (const iso of starts) {
      const key = slotDay(iso, timeZone);
      const set = productsByDay.get(key) ?? new Set<string>();
      set.add(pid);
      productsByDay.set(key, set);
    }
  }

  // Con una sola mentoría (P08) la clase viene dada; con varias hay que elegir.
  const single = products.length === 1 ? products[0] : undefined;
  const chosen =
    single ?? products.find((p) => p.id === selectedId) ?? undefined;

  /**
   * MN-16 · la hora elegida, ya contrastada contra los huecos REALES de la clase
   * elegida. Lo que se queda es el ISO **canónico** de la BD, no el de la URL.
   *
   * ⚠️ Se compara por INSTANTE, nunca con `===`. La cadena de la URL la produjo
   * un render anterior y basta con que Postgres devuelva el mismo momento con
   * otro formato (`+00:00` frente a `Z`), o con que un `+` del ISO se lea como
   * espacio al decodificar, para que la igualdad de texto no case jamás — y el
   * síntoma sería "pulso la hora y no se marca", sin error en ningún sitio. Es
   * la misma trampa que ya documenta `/reservar/<id>` al validar su `?slot=`.
   *
   * Si no casa —hueco ocupado entre medias, URL vieja, clase cambiada— vale
   * `undefined` y el panel se comporta como si no hubiera hora: ninguna
   * seleccionada, botón bloqueado. Nunca se hereda una hora que no existe.
   */
  const hora =
    chosen && selectedTime
      ? (slotsByProduct.get(chosen.id) ?? []).find(
          (iso) => Date.parse(iso) === Date.parse(selectedTime),
        )
      : undefined;

  const allDays = [...productsByDay.keys()].sort();
  // La hora MANDA sobre el día: si las dos vienen en la URL y se contradicen
  // (enlace editado a mano, marcador viejo), gana la hora, que es la elección
  // concreta y la que va a viajar al pago. Los chips emiten siempre las dos a
  // la vez, así que en el uso normal esto no se nota.
  const day = hora
    ? slotDay(hora, timeZone)
    : selectedDay && productsByDay.has(selectedDay)
      ? selectedDay
      : (allDays[0] ?? slotDay(new Date().toISOString(), timeZone));

  /** Clases con hueco el día elegido (las que ofrece el selector). */
  const dayProducts = products.filter((p) => productsByDay.get(day)?.has(p.id));
  // RV-08 · el precio de la clase elegida, ya resuelto a "lo que se cobra".
  // El rótulo cambia con el modelo: en un paquete el importe es del paquete
  // entero, no de una sesión, y llamarlo igual sería otra media verdad.
  const precio = chosen ? priceDisplay(chosen) : null;
  const totalLabel = !precio?.isTotal
    ? "Precio"
    : chosen?.pricingModel === "per_package"
      ? "Total del paquete"
      : "Total de la sesión";

  /** Horarios de la clase elegida ESE día. */
  const times = chosen
    ? (slotsByProduct.get(chosen.id) ?? []).filter(
        (iso) => slotDay(iso, timeZone) === day,
      )
    : [];

  // Rejilla del mes del día elegido. Se construye con NÚMEROS de calendario y
  // claves de texto, sin objetos Date locales: así la rejilla no se desplaza
  // por la zona del servidor (R24-22).
  const [year, month] = day.split("-").map(Number) as [number, number, number];
  const offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    "es",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  /* Qué falta para poder pulsar. Va como `title` del botón bloqueado, así que
     tiene que nombrar los controles con LAS MISMAS PALABRAS que sus etiquetas:
     el desplegable de arriba dice «Elige la mentoría» desde B3.4, y decir
     «sesión» aquí mandaba a buscar un control que no existe con ese nombre —
     «sesión» además ya significa otra cosa en esta pantalla (el encuentro que
     se agenda). */
  const motivoDelBloqueo = !chosen
    ? "Elige primero una mentoría"
    : allDays.length === 0
      ? "Esta mentoría todavía no tiene horarios publicados"
      : "Elige primero una hora en el calendario";

  /*
   * B3.5 · ⚠️ AQUÍ HUBO UN ARREGLO BASADO EN UNA PREMISA FALSA. NO LO REPONGAS.
   *
   * El 26-ago se añadió `lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto`
   * argumentando que «el panel es sticky top-24, así que con el contenido largo
   * el CTA cae fuera de la ventana y no hay forma de llegar a él». Suena bien y
   * es mentira: **`lg:sticky` no tiene recorrido en este panel**.
   *
   * Un elemento `sticky` solo se despega dentro de su bloque contenedor, y aquí
   * el hijo del grid no es este `<aside>` sino el `<div id="reservar">` que lo
   * envuelve — un div sin clases, que por tanto mide EXACTAMENTE lo mismo que
   * el aside. Recorrido disponible: 0 px. Medido en dev el 26-ago:
   * `parentElement.height - aside.height === 0`. O sea que el panel nunca se ha
   * quedado clavado, siempre ha bajado con la página, y el CTA siempre se ha
   * alcanzado haciendo scroll normal.
   *
   * Lo que sí hacía el arreglo era convertir el aside en contenedor de scroll,
   * y eso rompía la pantalla de verdad: la barra `sticky bottom-0` del final
   * dejaba de anclarse al pie de la VENTANA y pasaba a anclarse al pie del
   * PANEL, opaca y por encima de sus propios chips de hora. Medido: **11 de 15
   * chips dejaban de recibir el clic**, y para destaparlos había que descubrir
   * un scroll anidado que nadie busca.
   *
   * Si algún día se quiere de verdad un panel que acompañe al scroll, lo que
   * hay que tocar es la ESTRUCTURA —que el hijo del grid sea el que tenga la
   * altura de la columna—, no meterle un scroll propio al aside.
   */
  return (
    <aside className="rounded-[18px] border border-[#e0e0e0] bg-card p-6 shadow-[0_12px_32px_rgb(0_0_0/0.08)] lg:sticky lg:top-24">
      {/* R29-01: arriba del calendario va el TÍTULO de la clase; el precio baja
          junto al CTA. Sigue valiendo R24-14 (nada de importe fijo por delante):
          sin clase elegida no hay precio en ninguna de las dos posiciones.
          V-5 · el plural «Reserva estas mentorías» va SOLO en la ficha del
          tutor CON VARIAS mentorías: es el único sitio donde hay varias entre
          las que elegir. En `/products/[id]` llega un único producto, así que
          `single` lo fija y esa rama nunca se pinta. */}
      {/*
        B3.4 · ⚠️ EL ENCABEZADO YA NO DEPENDE DE `chosen`. Petición literal del
        cliente: «Y no cambies el título de arriba cuando selecciones».

        Antes esta rama era `chosen ? … : …`, o sea que en la ficha del TUTOR el
        panel se abría con «Reserva estas mentorías» + su línea de ayuda y, en
        cuanto se elegía una mentoría, el bloque entero se sustituía por el
        título de esa mentoría — de una a cuatro líneas según lo largo que fuera
        («Química Orgánica e Intermedia: Descifra la Ciencia Detrás del Mundo
        Real»). El calendario subía o bajaba con cada selección.

        Ahora la condición es `single`, que **no cambia nunca durante la vida de
        la pantalla**: es una propiedad de cuántos productos recibe el panel, no
        de lo que el visitante haya pulsado. Las tres combinaciones quedan así:

          · `/products/[id]` (P08) → siempre `single` → «Reserva esta mentoría».
            Igual que antes; ahí el título nunca cambió.
          · ficha del tutor con UNA mentoría → `single` la fija → su título,
            estable. Igual que antes.
          · ficha del tutor con VARIAS → el plural, SIEMPRE. Aquí está el
            cambio.

        Y lo que V-5b defendía —«sin el título no se sabría cuál de sus
        mentorías se está reservando»— ya no se pierde: la mentoría elegida se
        lee en el `<select>` de abajo, que la enseña de forma permanente. Antes
        eso lo decía el color de una tarjeta; ahora lo dice el propio control.
      */}
      {single ? (
        <>
          {/* V-5b · En la ficha de la mentoría el título NO se repite. Ahí ya
              es el H1 de la página, a dos dedos de aquí, y volver a escribirlo
              no informa de nada y empuja el calendario hacia abajo.

              `details` es la señal exacta y no hace falta inventar otra: lo
              pasa SOLO `/products/[id]` (P08), que es justamente la pantalla
              donde el título ya está arriba. En la ficha del TUTOR con una
              sola mentoría no llega, y ahí el título sí hace falta: el H1 es el
              nombre del tutor. */}
          <p className="text-[22px] font-bold text-balance text-[#19191f]">
            {details ? "Reserva esta mentoría" : single.title}
          </p>
          {details && single.sessionDurationMin ? (
            <p className="mt-1.5 text-sm text-[#595959]">
              En vivo 1 a 1 · {single.sessionDurationMin} min por sesión
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-[22px] font-bold text-[#19191f]">
            Reserva estas mentorías
          </p>
          <p className="mt-1.5 text-[13px] text-[#6b6b6b]">
            Elige el día y la sesión; el precio depende de la mentoría que
            escojas.
          </p>
        </>
      )}

      <hr className="my-5 border-[#e0e0e0]" />

      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] font-semibold text-[#212121]">{monthLabel}</p>
        <p className="text-xs text-[#808080]">Días disponibles</p>
      </div>

      {allDays.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Sin horarios publicados para las próximas semanas.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-7 text-center text-xs font-medium text-[#808080]">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-1 text-center">
            {cells.map((d, i) => {
              if (!d) return <span key={i} />;
              const key = `${year}-${pad(month)}-${pad(d)}`;
              const free = productsByDay.has(key);
              const isSelected = key === day;
              if (!free) {
                return (
                  <span
                    key={i}
                    className="grid h-[38px] place-items-center text-[13px] text-[#bfbfbf]"
                  >
                    {d}
                  </span>
                );
              }
              return (
                <Link
                  key={i}
                  // Cambiar de día conserva la clase solo si sigue teniendo
                  // hueco; si no, se vuelve a elegir (evita un combo imposible).
                  // La hora NO se conserva —no se pasa `h`— porque pertenece a
                  // un día concreto: arrastrarla al día siguiente sería marcar
                  // como elegido un hueco que el alumno no ha visto.
                  href={hrefFor({
                    p:
                      chosen && productsByDay.get(key)?.has(chosen.id)
                        ? chosen.id
                        : undefined,
                    d: key,
                  })}
                  aria-current={isSelected ? "date" : undefined}
                  className={`grid h-[38px] place-items-center rounded-full text-[13px] transition-colors ${
                    isSelected
                      ? "bg-brand font-bold text-white"
                      : "text-[#212121] hover:bg-muted"
                  }`}
                >
                  {d}
                </Link>
              );
            })}
          </div>

          {/* Paso 2 (R24-13): elegir la clase de ESE día. Con una sola mentoría
              (P08) no hay nada que elegir y se salta.

              B3.4 · era una lista de tarjetas-enlace y ahora es un `<select>`,
              por petición del cliente: «El selector de mentoría son dos
              tarjetas, porque tiene dos mentorías; esto se migra a un selector
              de mentorías, un select normal».

              ⚠️ RV-08 SIGUE VIVO dentro del `<option>`. Aquí se COMPARAN precios
              entre clases —si una se anuncia por hora y otra por sesión, la
              comparación solo es honesta si las dos enseñan el cobro de la
              reserva—, y un `<option>` no admite dos líneas como la tarjeta.
              Así que el precio va en la MISMA línea, detrás del título. Quitarlo
              sería perder la comparación, no simplificar. */}
          {single ? null : (
            <div className="mt-5">
              <BookingSelect
                id="reserva-mentoria"
                /* «Mentoría» y no «sesión»: lo que se elige aquí es CUÁL de
                   las clases del tutor, no cuántas ni a qué hora. La etiqueta
                   decía «sesión» mientras su propio placeholder decía
                   «mentoría», que es además el término que manda en todo el
                   producto desde el acuerdo del 17-ago. Y «sesión» ya
                   significa otra cosa en esta misma pantalla: el encuentro
                   concreto que se agenda abajo. */
                label="Elige la mentoría"
                placeholder="Elige una mentoría"
                value={chosen?.id ?? ""}
                options={dayProducts.map((p) => {
                  const precioClase = priceDisplay(p);
                  return {
                    value: p.id,
                    label: `${p.title} · ${precioClase.amount} · ${precioClase.note}`,
                    // Igual que con el día: cambiar de clase suelta la hora.
                    // Los huecos son de la mentoría, no del tutor. Es EL MISMO
                    // destino que tenía la tarjeta que esto sustituye.
                    href: hrefFor({ p: p.id, d: day }),
                  };
                })}
              />
            </div>
          )}

          {/* Paso 3: horarios de la clase elegida ese día. */}
          {chosen ? (
            <>
              {/* B3.4 · la etiqueta ya no es un `<p>` suelto: viaja dentro de
                  `BookingSelect` como `<label htmlFor>` de verdad, asociada al
                  control. Solo se pinta aquí cuando NO hay horarios, porque
                  entonces no hay control al que asociarla. */}
              {times.length === 0 ? (
                <>
                  <p className="mt-5 text-[13px] font-medium">
                    Horarios disponibles
                  </p>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Esta sesión no tiene horarios ese día. Prueba con otro día.
                  </p>
                </>
              ) : (
                <>
                  {/*
                    B3.4 · ESTO ERAN CHIPS Y AHORA ES UN `<select>`. Palabras del
                    cliente: «ahorita despliegas unos cuadritos con las horas, se
                    va a migrar a un selector y ya». Aplica a las DOS pantallas
                    —ficha del tutor y ficha de mentoría—, y en las dos el
                    destino de cada opción es EXACTAMENTE el mismo `hrefFor` que
                    tenía su chip. No se inventa ninguna ruta nueva.

                    ⚠️ Lo que MN-16 dejó escrito sigue en pie y no se ha tocado:
                    elegir la hora SELECCIONA, no navega al pago. Antes de MN-16
                    cada chip era un enlace al checkout y el primero se pintaba
                    naranja solo (`i === 0`), así que el alumno leía «08:00 ya
                    está elegido» sin haber elegido nada. Hoy la hora vive en la
                    query (`?h=`) y el botón grande de abajo es quien lleva al
                    pago. El `<select>` conserva esa separación tal cual: cambiar
                    de opción solo cambia la URL.

                    ⚠️ Y desaparece de paso la nota de `aria-current` frente a
                    `aria-pressed` que hacía falta con enlaces: un `<option>`
                    seleccionado ya se anuncia solo, sin ARIA que ponerle.

                    De propina, la fuente de salto de altura más grande de
                    §23.4: los chips ocupaban de una a cuatro filas según cuántas
                    horas tuviera el día. El `<select>` mide lo mismo siempre.
                  */}
                  <div className="mt-5">
                    <BookingSelect
                      id="reserva-horario"
                      label="Horarios disponibles"
                      hint="· en tu hora local"
                      placeholder="Elige una hora"
                      /*
                       * ⚠️ `hora`, NO `selectedTime`. `hora` es el ISO CANÓNICO
                       * de la BD, ya contrastado contra los huecos reales por
                       * instante (`Date.parse`), y es la misma cadena exacta que
                       * viaja en `times` — así que el `defaultValue` casa con su
                       * `<option>` por igualdad de texto, que es lo único que
                       * entiende un `<select>`. Con `selectedTime` (el texto
                       * crudo de la URL) no casaría: basta con que Postgres
                       * devuelva `+00:00` donde la URL trae `Z` para que ninguna
                       * opción salga marcada, sin error en ningún sitio. Es la
                       * misma trampa que documenta el cálculo de `hora` arriba.
                       */
                      value={hora ?? ""}
                      options={times.map((iso) => ({
                        value: iso,
                        label: slotTime(iso, timeZone),
                        href: hrefFor({ p: chosen.id, d: day, h: iso }),
                      }))}
                    />
                  </div>
                  {/* N-32 · se dice ANTES de pulsar qué hace pulsar. La queja no
                      era el número de pasos, era no saber en cuál estabas: «ya
                      estoy reservando, ¿a qué hora es que yo reservé?».
                      Baja DEBAJO del selector: encima quedaba entre la etiqueta
                      y su propio control, separando los dos.

                      ⚠️ EY-177 · decía «pasas directo al pago» y desde el modelo
                      nuevo de botones ya no es cierto: el principal añade al
                      carrito y el pago queda a un paso más. Es la MISMA clase de
                      texto que la promesa de retención de `slot-picker`, que
                      también sobrevivió a que le cambiaran el botón de debajo:
                      una frase que describe el destino de un botón envejece cada
                      vez que ese botón cambia, y nadie la relee. */}
                  <p className="mt-2 text-xs text-[#6b6b6b]">
                    {sesionesPorReserva(chosen) > 1
                      ? `Elige aquí la primera; las ${sesionesPorReserva(chosen) - 1} restantes en el siguiente paso.`
                      : "Elige tu hora y agrégala al carrito; pagas cuando termines de elegir."}
                  </p>
                </>
              )}
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted-foreground">
              Elige una sesión para ver sus horarios y su precio.
            </p>
          )}
        </>
      )}

      {/* R29-01 — el precio, al final: lo último antes de decidir, no lo primero
          que tapa el calendario. Sale del `chosen` de la URL, así que cambiar de
          clase lo cambia sin estado de cliente. */}
      {chosen && precio ? (
        <>
          <hr className="mt-5 border-[#e0e0e0]" />
          {/* RV-08 · este es el último número antes del botón de pagar: tiene
              que ser EL que se cobra. Antes ponía la tarifa ("30 US$ / hora")
              y el checkout pedía 45 en una clase de 90 min. Ahora manda el
              total y la tarifa queda debajo, explicando de dónde sale. */}
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[15px] text-[#6b6b6b]">{totalLabel}</span>
            <span className="text-[30px] font-bold text-[#19191f]">
              {precio.amount}
            </span>
          </div>
          {/* De dónde sale la cifra. En P08 el desglose por sesión de un
              paquete dice ya todo lo que diría la nota ("paquete · 6
              sesiones"), así que sustituye — no se apilan las dos. */}
          <p className="text-right text-[13px] text-[#6b6b6b]">
            {(details ? perSessionLabel(chosen) : null) ?? precio.note}
          </p>
        </>
      ) : null}

      {/*
        MN-16 · el botón grande usa EL MISMO destino que la hora elegida
        (`destinoDeLaHora`), que es quien sabe distinguir paquete de sesión
        suelta. Con eso hay un solo calendario en los dos casos: la suelta va
        derecha al pago y el paquete al selector con su primera hora ya marcada.

        Antes iba a `/reservar/<id>` PELADO y ese era el bug entero: sin `?slot=`
        la pantalla intermedia no puede saltarse, así que el alumno veía el
        segundo calendario. Y llegaba ahí creyendo que ya había elegido hora,
        porque el primer chip se pintaba naranja solo.

        Sin hora se queda bloqueado, no se manda a elegirla a otra pantalla:
        elegirla está a dos centímetros, y el `title` dice qué falta. Elegirla
        por él —coger la primera y tirar— es exactamente lo que se está
        arreglando. Quien tenga guardado un `/reservar/<id>` sin hora sigue
        entrando por ahí sin problema; esa puerta no se cierra.
      */}
      {/*
        B3.5 · LA BARRA. El botón se queda a la vista en TODOS los pasos —día,
        mentoría y hora—, sin inventarse un CTA por paso.

        El problema era medible y de móvil: el panel es lo último de la página,
        cada chip navega y aterriza en `#reservar` (el ancla de B2, que existe
        para que la pulsación no devuelva la vista al principio de la ficha), y
        desde ahí el botón cae a ~700 px del borde superior. En un teléfono eso
        es bajo el pliegue en los tres pasos: se elige el día, se elige la hora,
        y la pantalla nunca enseña a dónde lleva eso. Con `sticky bottom-0` el
        botón se despega y queda clavado abajo mientras el panel esté a la
        vista, y vuelve a su sitio al llegar al final.

        ⚠️ Lo que NO se ha hecho, a propósito: un CTA distinto por paso. Eso
        reabre §20.14 —«la queja no era el número de pasos, era no saber en cuál
        estabas»—, que ya se respondió con TEXTO (la línea de «Elige tu hora y
        confirma abajo»). Aquí solo se cambia DÓNDE se ve el mismo botón, que
        sigue bloqueado hasta que hay hora.

        ⚠️ Y el hueco de la derecha en móvil (`max-lg:pe-[72px]`) no es un
        descuido de maquetación: la burbuja de chat es `fixed right-5 bottom-5`
        con `z-50` (`chat-bubble.tsx`), o sea que se pinta ENCIMA de esta barra
        y se come los últimos ~36 px del botón. Sin ese hueco, tocar el final de
        «Reservar mentoría YA» abre el chat en vez de ir al pago. Se aparta el
        botón y no se sube la burbuja porque la burbuja es de todas las
        pantallas y esta barra es de una.

        ⚠️ Y SON 72, NO 84 COMO EN `slot-picker.tsx`. Parecen el mismo problema
        y el mismo número mal copiado —de hecho ya se ha intentado «corregir»
        una vez—, pero las dos barras no empiezan en el mismo sitio y por eso no
        piden lo mismo. Allí el `-mx-4` la lleva al borde de la VENTANA, así que
        tiene que cubrir la huella entera de la burbuja: `right-5` (20) +
        `size-14` (56) = 76, y 84 le da 8 de aire. Aquí la barra vive dentro de
        una tarjeta que el `Container` ya mete hacia dentro (`px-4`, y `px-6`
        desde `sm`) más 1 px de borde del `<aside>`, así que su borde derecho
        NO llega a la ventana: se queda a 17 px en móvil y a 25 px desde `sm`.
        Lo que hay que tapar es solo el resto → 76 − 17 = **59 px** en móvil y
        76 − 25 = 51 px desde `sm`. Con 72 sobran 13 px y 21 px.

        Medido en el navegador, no a ojo, con la barra fijada abajo y solapando
        la burbuja en vertical: a 375 px el botón acaba en x=286 y la burbuja
        empieza en x=299, y `elementFromPoint` sobre la esquina de los dos
        botones (6 puntos) devuelve la barra, nunca la burbuja. Lo que
        invalidaría el número: que cambie `right-5`/`size-14` en la burbuja, el
        `px` del `Container`, o que esta barra deje de estar dentro de la
        tarjeta (un `-mx` que la saque a la ventana la volvería un caso de 84).

        El `-mx-6` la lleva de borde a borde del panel: así el contenido pasa
        por DEBAJO y no se lee a medias detrás del botón. Y el margen superior
        vive aquí y no en cada botón — antes las dos ramas usaban `mt-4` y
        `mt-5`, y el panel daba un salto de 4 px al elegir la hora.

        ⚠️ `lg:static` NO sobra. En escritorio el panel entra entero en pantalla
        y no hay nada que despegar, pero una barra `sticky` opaca sí tiene algo
        que tapar: sus propios chips de hora. Dejarla pegada en `lg` es el fallo
        que se corrigió el 26-ago (ver el comentario del `<aside>`).

        ⚠️ Y en MÓVIL queda un solape TRANSITORIO conocido, medido y aceptado:
        mientras se baja hacia el panel —la banda de unos 200 px anterior a que
        asiente— la barra flota sobre los chips y se come su clic (8 de 8 en el
        peor punto). Se resuelve solo en cuanto se sigue bajando, y quien llega
        pulsando un día aterriza en `#reservar`, donde el solape ya es CERO. Es
        el precio del patrón «barra de compra fija» y se paga a sabiendas: la
        alternativa es devolver el CTA bajo el pliegue, que era la queja.
      */}
      {/*
        EY-177 · B3.2 · ⚠️ AQUÍ CAMBIA EL BOTÓN, Y ES LA MARCHA ATRÁS SOBRE N-33.

        Petición del cliente, literal: «cuando ya seleccione el día y la fecha,
        sale **1 botón que es agregar al carrito**. […] si un tutor tiene dos
        clases, yo seleccioné la primera, día y fecha, agregué al carrito, quiero
        repetir lo mismo con su segunda clase […] **sin salirme de esa visual**».

        O sea que el botón de una SESIÓN SUELTA deja de ir derecho al checkout y
        pasa a añadir al carrito sin navegar. El coste está medido y escrito en
        `add-to-cart.tsx`: vuelve a haber una pantalla en medio (la revisión),
        que es una más que ayer. Lo que se conserva de N-33 —y era la queja de
        verdad, «estás seleccionando dos veces algo»— es que **no se vuelve a
        preguntar nada**: la revisión enseña lo elegido, no lo pide otra vez.

        ⚠️ EL PAQUETE NO PASA POR EL CARRITO DESDE AQUÍ, y no es un olvido. Una
        línea del carrito es una mentoría con TODOS sus horarios, y un
        `per_package` de N sesiones exige elegir N (RN-12) que no caben en este
        panel lateral — es exactamente la razón por la que `/reservar/<id>` no se
        borró (ver la nota de `destinoDeLaHora`). Así que el paquete sigue yendo
        a su selector múltiple con la primera hora ya marcada, y el «Agregar al
        carrito» del paquete vive allí, en `slot-picker.tsx`, que es donde la
        línea está completa. `destinoDeLaHora` se conserva intacto para eso.

        ⚠️ Y el hueco de la derecha en móvil (`max-lg:pe-[72px]`) y el `lg:static`
        siguen siendo los de B3.5: la burbuja de chat se pinta encima de esta
        barra, y una barra `sticky` opaca en escritorio taparía los propios
        selectores del panel. No se tocan.
      */}
      {/*
        B3.6 · ⚠️ EL MODELO DE BOTONES CAMBIÓ, Y ESTE ES EL SITIO DONDE SE VE.
        Decidido con el responsable; no se reabre.

        Antes, la barra pintaba **una sola cosa a la vez** y esa cosa dependía de
        lo que acabaras de hacer: botón bloqueado → botón activo → y, al pulsar,
        el botón DESAPARECÍA y lo sustituían «Seguir comprando» + «Ir al
        carrito». Perder la acción principal justo después de usarla obligaba a
        deducir que «Seguir comprando» era lo que la devolvía.

        Ahora hay dos controles con DOS CONDICIONES INDEPENDIENTES, apilados:

          · arriba, la acción principal, que depende de la SELECCIÓN de esta
            pantalla (mentoría + hora). Siempre visible, bloqueada mientras
            falte algo. Es «Agregar al carrito» salvo en los paquetes, que
            siguen yendo a su selector múltiple.
          · abajo, «Ir al carrito», que depende del CARRITO y de nada más
            (`go-to-cart.tsx`). Por eso sobrevive a la recarga y al botón atrás,
            y por eso se pinta también bajo el CTA del paquete: el hecho «tengo
            mentorías apuntadas» no cambia porque esta mentoría sea un paquete.

        ⚠️ La altura de la barra ya NO depende del estado. Con el modelo viejo
        pasaba de un botón a dos-en-fila y de ahí a un texto de confirmación
        debajo; en móvil esta barra flota sobre el panel (B3.5), así que cada
        cambio de alto movía el contenido bajo el dedo. Ahora solo hay un salto
        posible —que aparezca «Ir al carrito» la primera vez— y encima ocurre
        HACIA ABAJO, sin desplazar al botón principal.
      */}
      <div className="sticky bottom-0 z-20 -mx-6 mt-4 border-t border-[#e0e0e0] bg-card pt-4 pb-4 ps-6 pe-6 max-lg:pe-[72px] lg:static">
        {chosen && sesionesPorReserva(chosen) > 1 ? (
          /* PAQUETE · no pasa por el carrito desde aquí (ver arriba). El botón
             se queda igual que siempre: bloqueado sin hora, y con hora lleva al
             selector múltiple con la primera ya marcada. */
          hora ? (
            <Button asChild className="h-[51px] w-full text-[15px]">
              <Link href={destinoDeLaHora(chosen, hora)}>{ctaLabel}</Link>
            </Button>
          ) : (
            <Button
              disabled
              className="h-[51px] w-full text-[15px]"
              title={motivoDelBloqueo}
            >
              {ctaLabel}
            </Button>
          )
        ) : (
          /*
            SESIÓN SUELTA — y también el estado «todavía no he elegido nada»,
            porque sin mentoría elegida no se sabe si será paquete o suelta.

            ⚠️ EL RÓTULO BLOQUEADO TIENE QUE PROMETER LO MISMO QUE EL
            DESBLOQUEADO, y por eso el botón vacío también es «Agregar al
            carrito» (el rótulo por defecto de `AddToCart`). Antes el panel
            enseñaba «Reservar mentoría YA» en gris y, al elegir la hora, el
            botón se convertía en «Agregar al carrito»: dos promesas distintas
            en el mismo sitio y a un segundo de distancia.
          */
          <AddToCart
            /* `null` mientras no hay mentoría elegida: el botón se pinta igual,
               bloqueado. Es la diferencia con el modelo viejo. */
            productId={chosen?.id ?? null}
            /* ⚠️ `hora`, no `selectedTime`: es el ISO CANÓNICO de la base, ya
               contrastado por instante contra los huecos reales unas líneas más
               arriba. Al carrito nunca llega texto crudo de la URL. */
            slots={hora ? [Date.parse(hora)] : []}
            /*
              ⚠️ QUÉ SE LIMPIA EXACTAMENTE, Y POR QUÉ NO EL DÍA.
              Se sueltan `p` (mentoría) y `h` (hora) y **se conserva `d`**.

              El día no es una elección más: es el primer paso del embudo
              (R24-13 · día → clase → horario), es lo que decide qué opciones
              tiene el selector de mentorías, y es lo único que se elige con el
              dedo sobre una rejilla de 30 casillas en vez de con un desplegable.
              Tirarlo obligaría a volver al calendario y a buscar otra vez el
              mismo número para hacer justo lo que el cliente describe: «otra
              clase del mismo tutor». Además, sin `d` el panel recalcula el día
              por defecto (`allDays[0]`), o sea que no dejaría la pantalla en
              blanco: la dejaría en OTRO día, elegido por nosotros.

              Y como `hrefFor` lleva su `#reservar`, la vista aterriza en el
              panel en vez de volver al principio de la ficha.
            */
            limpiarHref={hrefFor({ d: day })}
            motivo={motivoDelBloqueo}
          />
        )}

        {/* Y debajo, siempre que el carrito tenga algo. `initial` viene del
            servidor para que no aparezca a destiempo. */}
        <GoToCart initial={enCarrito} className="mt-2" />
      </div>

      {footer}

      {/* "Enviar mensaje" del Figma no se implementa: la bandeja alumno ↔ tutor
          es DD-07 (`EY-117`) y hoy el chat solo existe por reserva. */}

      <p className="mt-4 text-center text-xs text-[#6b6b6b]">{note}</p>
    </aside>
  );
}
