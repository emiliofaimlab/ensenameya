import Link from "next/link";
import { GiftIcon } from "lucide-react";

import { PrecioEnLinea } from "@/components/precio/precio";
import {
  PanelCard,
  PanelCardTitle,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";

/**
 * ── EL REGALO, VISTO POR QUIEN LO RECIBE ───────────────────────────────────
 *
 * El cliente lo pidió con estas palabras: «al destinatario le aparece en *Mis
 * reservas* como un regalo pendiente de agendar y él elige día y hora». Un
 * regalo sin agendar **no es una reserva todavía** —no hay fila en `bookings`,
 * ni sesión, ni hueco bloqueado en la agenda del tutor (lo dice
 * `comprar_regalo` en su propio comentario)—, así que no puede entrar en la
 * lista de reservas: entra como tarjeta aparte, arriba, porque es lo único de
 * esa pantalla que pide algo de quien la mira.
 *
 * ⚠️ **AQUÍ NO EMPIEZA NINGÚN AGENDADO PARALELO, Y ESO ES TODO EL DISEÑO.** El
 * crédito de regalo está atado a su `product_id` (`credits_forma_por_origen`),
 * así que el destinatario reserva por el camino de siempre —`/reservar/<id>` →
 * elegir horario → checkout— y allí el selector de crédito le ofrece ESE regalo
 * y el total baja a cero. El botón de esta tarjeta es un enlace al camino
 * normal; lo único que añade la tarjeta es que ese viaje sea evidente y que
 * nadie llegue al checkout temiendo que le cobren.
 *
 * ⚠️ **DE QUIÉN VIENE NO SE PUEDE DECIR, Y NO ES UN OLVIDO.** `mis_creditos`
 * —la vista por la que el destinatario lee sus créditos— **no expone
 * `purchased_by`** (`20260912110000:473-495`), y aunque lo expusiera sería un
 * uuid: `profiles` solo tiene `profiles_select_own` y `profiles_select_admin`,
 * así que no hay nombre que leer para nadie que no seas tú. El único rastro de
 * quien regala es la DEDICATORIA que escribió (`gift_message`), y ahí es donde
 * la gente firma. Por eso la tarjeta se titula «Un regalo para ti» y la
 * dedicatoria se pinta entera y entrecomillada en vez de quedar en una línea
 * gris al final: es lo más parecido a un remitente que esta pantalla tiene.
 */
export type RegaloRecibido = {
  id: string;
  status: string;
  /** Unidades mínimas CONGELADAS al comprarlo (regla de oro 2: lo fijó el servidor). */
  amount: number;
  currency: string;
  productId: string | null;
  giftMessage: string | null;
  /** UTC. Hasta cuándo puede agendarlo; `gift_expiry_days()` lo pone al cobrar. */
  expiresAt: string | null;
  consumedAt: string | null;
  /**
   * La mentoría regalada, si el destinatario TODAVÍA puede leerla.
   *
   * ⚠️ `null` es un caso real, no un hueco defensivo: `products_select_public`
   * exige `status = 'active'` **y** tutor aprobado, así que una mentoría
   * archivada o un tutor al que le retiraron la aprobación dejan al regalo sin
   * ficha —y a `/reservar/<id>` devolviendo un 404, porque `getProductDetail`
   * aplica el mismo filtro—. Alguien pagó por esto: se pinta igual, con la
   * salida a soporte en lugar del botón. Es el mismo criterio de `tutorCards`
   * con el tutor desaprobado.
   */
  producto: {
    titulo: string;
    formato: string;
    /** Nombre del tutor; `undefined` si su ficha ya no es legible. */
    tutor?: string;
    tutorHref?: string;
    /**
     * Lo que la mentoría cuesta HOY, con la misma aritmética que congeló
     * `comprar_regalo`. `null` cuando no se ha podido leer.
     */
    totalHoy: number | null;
  } | null;
};

/** ¿sigue vivo y en fecha? `expires_at` en UTC contra el reloj (RN-01/02). */
export function regaloPorAgendar(r: RegaloRecibido): boolean {
  return (
    r.status === "active" &&
    (r.expiresAt === null || Date.parse(r.expiresAt) > Date.now())
  );
}

/**
 * El día de calendario de un instante EN LA ZONA DE QUIEN MIRA (RN-01/02).
 *
 * `en-CA` da `2026-09-11` y es la forma más corta de sacar el día local sin
 * dependencias. Devuelve ese día como marca UTC para poder restar dos sin que
 * el huso vuelva a meterse.
 */
function diaLocal(d: Date, tz: string): number {
  const [a, m, dia] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .split("-")
    .map(Number);
  return Date.UTC(a, m - 1, dia);
}

/** Días de CALENDARIO que faltan, en la zona del usuario. `null` si la fecha no
 *  se puede leer — nunca 0, que aquí significaría «caduca hoy». */
function diasHasta(iso: string, tz: string): number | null {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return null;
  // El reloj se lee en una función de módulo y no dentro del render: misma
  // razón que `isUpcoming()` en `lib/booking` (pureza de react-hooks).
  return Math.round(
    (diaLocal(cuando, tz) - diaLocal(new Date(), tz)) / 86_400_000,
  );
}

/** «10 dic», y «10 ene 2027» cuando el año no es el de hoy. El plazo del regalo
 *  son 90 días (`gift_expiry_days()`), así que cruza el fin de año a menudo y
 *  sin el año un «10 ene» no dice si quedan días o casi un año. */
function fechaLocal(iso: string, tz: string): string {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return "—";
  const año = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(
      d,
    );
  return cuando.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    timeZone: tz,
    ...(año(cuando) === año(new Date()) ? {} : { year: "numeric" }),
  });
}

/**
 * ── EL PLAZO, COMO PIEZA ────────────────────────────────────────────────────
 *
 * ⚠️ **SIN HORA, Y NO ES UN DESCUIDO.** Sobre un plazo de 90 días, «jue, 10 dic,
 * 17:32» es ruido con una trampa dentro: invita a leer que a las 17:33 el regalo
 * se pierde. El día basta; cuando de verdad queda poco, lo dice el TONO.
 *
 * ⚠️ **El criterio de urgencia es el de `/referidos`** —rojo si caduca hoy o
 * mañana, ámbar a ≤7 días, gris el resto (`recompensaDe`, en
 * `src/app/(app)/referidos/page.tsx`)— para que las dos pantallas donde alguien
 * mira un crédito con fecha se lean igual. Está copiado, no importado, porque
 * ese criterio vive hoy en funciones privadas de esa página; el sitio donde
 * debería vivir es `lib/`, y sacarlo de ahí toca un fichero que no es este.
 *
 * Se cuentan días de CALENDARIO en la zona de quien mira y no horas: algo que
 * vence esta noche tiene que decir «hoy» en Madrid y en Caracas, y restar
 * milisegundos lo contaría como «mañana» para media Europa.
 */
function plazo(
  expiresAt: string | null,
  tz: string,
): { texto: string; tono: PillTone } {
  const dias = expiresAt ? diasHasta(expiresAt, tz) : null;
  // Sin fecha el regalo no vence, y decirlo es responder a la pregunta del
  // cliente («¿hasta cuándo puedes agendarlo?») también en ese caso. Una fecha
  // ilegible no llega aquí: `regaloPorAgendar` compara ese mismo instante y un
  // `NaN` la deja en false, así que ese regalo se pinta ya como cerrado.
  if (expiresAt === null || dias === null)
    return { texto: "Sin fecha límite", tono: "gray" };
  if (dias <= 0) return { texto: "Caduca hoy", tono: "red" };
  if (dias === 1) return { texto: "Caduca mañana", tono: "red" };
  if (dias <= 7) return { texto: `Caduca en ${dias} días`, tono: "amber" };
  return { texto: `Caduca el ${fechaLocal(expiresAt, tz)}`, tono: "gray" };
}

/**
 * La tarjeta accionable: un regalo cobrado, sin agendar y en fecha.
 *
 * ── EL ORDEN ES LA PANTALLA ────────────────────────────────────────────────
 *
 * Se ordena por lo que quien mira tiene que HACER, no por lo bonito:
 *
 *   1. **De qué es** — el título de la mentoría, su formato y su tutor.
 *   2. **Que no paga** — la duda con la que se llega al checkout.
 *   3. **Hasta cuándo** — lo único que caduca aquí.
 *   4. **La dedicatoria** — un detalle cálido, no un dato.
 *   5. **El botón.**
 *
 * ⚠️ **2 y 3 SON PIEZAS, NO FRASES**, y ese es el arreglo de fondo (Emilio,
 * 11-sep: «la información puede pulirse y resaltar elementos en específico»).
 * Escritas en prosa pesaban menos que la dedicatoria —que es lo más bonito y lo
 * menos accionable—, así que todo pesaba parecido y no destacaba nada. Como
 * `StatusPill` con su tono, se leen de un vistazo y sin leerlas.
 *
 * Mobile-first a propósito (US-1601, correo de Verónica del 3-sep): en 390 px
 * es una sola columna, el botón ocupa el ancho y mide 44 px de alto, y los dos
 * chips caben en una fila (y envuelven si no).
 *
 * ⚠️ **Y la tarjeta ENCOGE con este cambio, no crece**, que es la condición
 * para que «Activas» siga por encima del pliegue: los dos chips ocupan 26 px
 * donde antes había dos párrafos —el del precio y el del plazo— de unos 70, y
 * en el caso normal la línea del precio ya ni se pinta. Medido a ojo sobre la
 * suma de alturas declaradas: ~290 px con dedicatoria de cuatro líneas, frente
 * a ~330 antes. El día que alguien añada una pieza aquí, esta es la cuenta que
 * hay que rehacer.
 */
export function RegaloPorAgendar({
  regalo,
  timeZone,
}: {
  regalo: RegaloRecibido;
  timeZone: string;
}) {
  const p = regalo.producto;
  // Se saca a una constante y no se lee `p?.totalHoy` dentro del ternario: con
  // la cadena opcional TypeScript no puede estrechar el `number | null` en la
  // rama de abajo, y `<PrecioEnLinea>` pide un número.
  const totalHoy = p?.totalHoy ?? null;
  // ⚠️ Las TRES respuestas posibles a «¿pago algo?», resueltas una vez y antes
  // del JSX porque las necesitan dos sitios (el chip y la línea de debajo).
  // `null` NO es «gratis»: es «no lo sabemos», y se dice distinto.
  const cubreTodo = totalHoy !== null && regalo.amount >= totalHoy;
  const caducidad = plazo(regalo.expiresAt, timeZone);

  return (
    <PanelCard className="border-[1.5px] border-brand/40 bg-[#f5faff]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#dbedff] text-[#0063c4]">
          <GiftIcon className="size-[18px]" aria-hidden />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-[#0063c4] uppercase">
            Un regalo para ti
          </p>
          {/* `break-words` y no `truncate`: el título de una mentoría lo teclea
              el tutor y puede traer una palabra larguísima sin espacios. En 390
              px eso ensancha la tarjeta y saca la barra horizontal en el
              DOCUMENTO — el mismo fallo que documenta el `min-w-0` de
              `PanelShell`. Aquí se parte la palabra; cortar el título con
              puntos suspensivos sería peor, que es lo que el regalo ES. */}
          <PanelCardTitle className="mt-0.5 text-[17px] leading-snug break-words">
            {p?.titulo ?? "Una mentoría"}
          </PanelCardTitle>

          {p ? (
            <p className="mt-0.5 text-xs text-[#6b6b6b]">
              {p.formato}
              {p.tutor ? (
                <>
                  {" · con "}
                  {p.tutorHref ? (
                    <Link
                      href={p.tutorHref}
                      className="font-medium text-brand hover:underline"
                    >
                      {p.tutor}
                    </Link>
                  ) : (
                    p.tutor
                  )}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {/* ── 2 y 3 · LO QUE DECIDE ALGO ───────────────────────────────────────
          Los dos datos accionables, juntos y en la misma fila, justo debajo de
          QUÉ es y por encima de todo lo demás. Van en `flex-wrap`: a 360 px con
          los dos textos largos («Pagas solo la diferencia» + «Caduca el 10 dic
          2027») el segundo chip baja de línea en vez de estirar la tarjeta y
          sacar la barra horizontal del documento.

          ⚠️ Regla de oro 4 · el instante vive en UTC y `plazo()` lo convierte
          con el `timeZone` de quien mira. Es OBLIGATORIO pasarlo: esto es un
          componente de servidor y sin él se contarían los días desde la
          medianoche de Vercel (UTC), que es el bug R24-12. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* ⚠️ QUÉ SE PROMETE Y QUÉ NO. El regalo congeló el precio del día en
            que se compró; lo que cubre al canjearlo es `least(amount, gross)`
            (`credito_aplicable`, `20260912110000:1461`), así que si el tutor
            subió el precio entretanto el destinatario PAGA LA DIFERENCIA.
            Poner «Gratis» sin mirar el precio de hoy sería exactamente la
            mentira creíble de la regla de oro 10, con el agravante de que se
            descubre en la pantalla de pagar. Por eso el chip tiene TRES textos
            y no dos — y el del precio ilegible es AZUL y no verde: dice lo
            único cierto («está pagada») sin prometer que cubre el total.

            `whitespace-nowrap` como en `/referidos`: el chip declara 26 px de
            alto y `shrink-0`, así que si su texto se partiera en dos líneas
            reventaría por dentro. Los cuatro textos caben incluso a 320 px
            (el más largo mide ~170 de los 248 útiles), y lo que no cabe es la
            FILA, que para eso envuelve. */}
        {totalHoy === null ? (
          <StatusPill tone="blue" className="whitespace-nowrap">
            Ya está pagada
          </StatusPill>
        ) : cubreTodo ? (
          <StatusPill tone="green" className="whitespace-nowrap">
            Gratis · ya está pagada
          </StatusPill>
        ) : (
          <StatusPill tone="amber" className="whitespace-nowrap">
            Pagas solo la diferencia
          </StatusPill>
        )}

        <StatusPill tone={caducidad.tono} className="whitespace-nowrap">
          {caducidad.texto}
        </StatusPill>
      </div>

      {/* La cifra, SOLO cuando hay una cifra que decir. En el caso normal —el
          regalo cubre el 100 %— el chip verde ya lo dice entero y una frase
          repitiéndolo es justo el peso de más que aplanaba la tarjeta. Los
          otros dos casos traen números que el chip no puede llevar dentro. */}
      {totalHoy === null ? (
        <p className="mt-2 text-[13px] text-[#333333]">
          Está pagada por{" "}
          <PrecioEnLinea
            amountMinor={regalo.amount}
            currency={regalo.currency}
            className="font-semibold"
          />
          .
        </p>
      ) : cubreTodo ? null : (
        <p className="mt-2 text-[13px] text-[#333333]">
          Cubre{" "}
          <PrecioEnLinea
            amountMinor={regalo.amount}
            currency={regalo.currency}
            className="font-semibold"
          />{" "}
          de los{" "}
          <PrecioEnLinea amountMinor={totalHoy} currency={regalo.currency} /> que
          cuesta hoy: la diferencia la pagas tú al agendarla.
        </p>
      )}

      {/* ── 4 · LA DEDICATORIA ───────────────────────────────────────────────
          Entera y entrecomillada, porque es el único remitente que hay (ver la
          cabecera), pero AHORA POR DEBAJO de lo accionable y en gris: antes iba
          pegada al título y con más contraste que el plazo, así que lo más
          bonito tapaba lo único que hay que decidir. El borde deja de ser azul
          para que el color de la tarjeta se concentre en los dos chips.

          `line-clamp-4` porque `comprar_regalo` la corta en 500 caracteres y a
          pantalla completa eso son ocho líneas que empujarían «Activas» fuera
          del pliegue en un móvil.

          💡 AQUÍ IRÍA EL NOMBRE DE QUIEN REGALA, el día que exista: una línea
          `— Ana` a pie de cita, o «Un regalo de Ana» en el antetítulo si no hay
          dedicatoria. Hoy no se puede y no es un olvido —`mis_creditos` no
          expone `purchased_by` a propósito, ver la cabecera del fichero—, así
          que sacarlo pide una migración, no un cambio de maqueta. El cliente lo
          pidió como «sería bueno, pero no es algo del otro mundo» (11-sep). */}
      {regalo.giftMessage ? (
        <blockquote className="mt-3 border-l-2 border-[#d6d6d6] pl-3 text-[12.5px] leading-relaxed text-[#595959] italic">
          <p className="line-clamp-4 break-words">{regalo.giftMessage}</p>
        </blockquote>
      ) : null}

      {/* ── 5 · EL BOTÓN ─────────────────────────────────────────────────────
          Solo. El chip de urgencia que antes le hacía compañía subió con el
          plazo a su fila: una píldora al lado del botón se lee como parte del
          botón. */}
      <div className="mt-4">
        {p && regalo.productId ? (
          // El camino NORMAL de reserva de esa mentoría: calendario del tutor y
          // después el checkout, donde el selector le ofrece este regalo. Es un
          // enlace dentro de `(app)` —de `/reservas` a `/reservar/<id>`, los dos
          // bajo el mismo layout con guarda—, así que no cruza grupo de rutas y
          // la regla de oro 13 no aplica; lo vigila `npm run check:enlaces`.
          <Button
            asChild
            // 44 px en móvil (objetivo táctil mínimo del correo de Verónica) y
            // los 38 de las demás acciones del panel a partir de `sm`.
            className="h-11 w-full rounded-[8px] px-5 text-[14px] font-semibold sm:h-[38px] sm:w-auto sm:text-[13px]"
          >
            <Link href={`/reservar/${regalo.productId}`}>Elegir día y hora</Link>
          </Button>
        ) : (
          // Sin ficha legible no hay a dónde mandarle: `/reservar/<id>` daría un
          // 404 por el mismo filtro que dejó a `producto` en null. Un botón roto
          // sería peor que no ponerlo, así que se le da la salida que sí existe.
          //
          // ⚠️ La frase NO dice «esta mentoría ya no existe». Aquí caen dos
          // casos que desde el navegador no se distinguen —la mentoría
          // archivada y la consulta que falló— y afirmar el primero cuando pasó
          // el segundo es la mentira creíble de la regla de oro 10. Lo único
          // cierto en ambos es que ahora no se puede enseñar, y que el dinero
          // sigue donde estaba.
          <p className="text-[13px] text-[#805710]">
            No podemos mostrarte esta mentoría ahora mismo.{" "}
            <Link href="/contacto" className="font-medium underline">
              Escríbenos
            </Link>{" "}
            y lo resolvemos contigo: tu regalo sigue pagado.
          </p>
        )}
      </div>
    </PanelCard>
  );
}

/**
 * El rótulo de un regalo que ya no se puede agendar, su tono y su fecha.
 *
 * ⚠️ La fecha va SIEMPRE con su verbo («Agendado el …», «Caducó el …») y no
 * suelta: en una pantalla llena de reservas, una fecha a secas debajo del
 * título de una mentoría se lee como la hora de la clase, que es justo lo que
 * un regalo no tiene.
 */
function cerrado(r: RegaloRecibido): {
  label: string;
  tone: PillTone;
  fecha: string | null;
  verbo: string;
} {
  if (r.status === "consumed")
    return {
      label: "Ya agendado",
      tone: "green",
      fecha: r.consumedAt,
      verbo: "Agendado el",
    };
  if (r.status === "refunded")
    return { label: "Devuelto", tone: "neutral", fecha: null, verbo: "" };
  if (r.status === "revoked")
    return { label: "Anulado", tone: "neutral", fecha: null, verbo: "" };
  // 'expired', y también el `active` cuya fecha ya pasó: `caducar_creditos()`
  // corre una vez al día, así que entre el vencimiento y el barrido hay una
  // ventana en la que la base dice `active` y el calendario dice que no. Manda
  // el calendario — ofrecer «Elegir día y hora» ahí sería mandar al
  // destinatario a un checkout que le cobraría el precio entero.
  return {
    label: "Caducado",
    tone: "neutral",
    fecha: r.expiresAt,
    verbo: "Caducó el",
  };
}

/**
 * Los regalos que ya no piden nada: canjeados, caducados, anulados.
 *
 * Se ven —«sin competir con lo accionable»—, así que van en una tarjeta sobria
 * al final de la pantalla y no arriba: quien entra a agendar el suyo no tiene
 * que leer antes los tres que ya usó.
 */
export function RegalosCerrados({
  regalos,
  timeZone,
}: {
  regalos: RegaloRecibido[];
  timeZone: string;
}) {
  if (regalos.length === 0) return null;

  return (
    <PanelCard>
      <PanelCardTitle>Regalos anteriores</PanelCardTitle>
      <ul className="mt-3 divide-y divide-[#e0e0e0]">
        {regalos.map((r) => {
          const { label, tone, fecha, verbo } = cerrado(r);
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-[#333333]">
                  {r.producto?.titulo ?? "Una mentoría"}
                </p>
                {/* Sin hora, igual que el chip de plazo de la tarjeta viva y
                    que `/referidos`: en un regalo ninguna de estas dos fechas
                    tiene un minuto que importe, y el «· tu hora local» dejaba
                    de tener sentido en cuanto no hay hora que situar. */}
                {fecha ? (
                  <p className="text-xs text-[#6b6b6b]">
                    {`${verbo} ${fechaLocal(fecha, timeZone)}`}
                  </p>
                ) : null}
              </div>
              <StatusPill tone={tone}>{label}</StatusPill>
            </li>
          );
        })}
      </ul>
    </PanelCard>
  );
}
