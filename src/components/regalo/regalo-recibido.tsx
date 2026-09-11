import Link from "next/link";
import { GiftIcon } from "lucide-react";

import { formatSessionTime } from "@/lib/booking";
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

/** Días completos que quedan, o `null` si no caduca o ya venció. */
function diasRestantes(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - Date.now();
  return ms > 0 ? Math.floor(ms / 86_400_000) : null;
}

/**
 * La tarjeta accionable: un regalo cobrado, sin agendar y en fecha.
 *
 * Mobile-first a propósito (US-1601, correo de Verónica del 3-sep): en 390 px
 * es una sola columna, el botón ocupa el ancho y mide 44 px de alto, y la
 * tarjeta entera se queda en unos 230 px para NO empujar las reservas de
 * verdad por debajo del pliegue — que es justo lo que haría un bloque
 * decorativo grande puesto encima de una lista.
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
  const dias = diasRestantes(regalo.expiresAt);
  // «Quedan pocos días» es información, no decoración: a los 90 días de plazo
  // (`gift_expiry_days()`) el aviso solo tiene sentido cuando aprieta.
  const urge = dias !== null && dias <= 14;

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

      {/* La dedicatoria, entera y entrecomillada: es el único remitente que hay
          (ver la cabecera). `line-clamp-4` porque `comprar_regalo` la corta en
          500 caracteres y a pantalla completa eso son ocho líneas que empujarían
          la lista de reservas fuera del pliegue en un móvil. */}
      {regalo.giftMessage ? (
        <blockquote className="mt-3 border-l-2 border-[#b3d7ff] pl-3 text-[13px] leading-relaxed text-[#333333] italic">
          <p className="line-clamp-4 break-words">{regalo.giftMessage}</p>
        </blockquote>
      ) : null}

      {/* ⚠️ QUÉ SE PROMETE Y QUÉ NO. El regalo congeló el precio del día en que
          se compró; lo que cubre al canjearlo es `least(amount, gross)`
          (`credito_aplicable`, `20260912110000:1461`), así que si el tutor
          subió el precio entretanto el destinatario PAGA LA DIFERENCIA. Decir
          «no pagarás nada» sin mirar el precio de hoy sería exactamente la
          mentira creíble de la regla de oro 10, con el agravante de que se
          descubre en la pantalla de pagar. */}
      <p className="mt-3 text-[13px] text-[#333333]">
        {totalHoy === null ? (
          <>
            Está pagada por{" "}
            <PrecioEnLinea
              amountMinor={regalo.amount}
              currency={regalo.currency}
              className="font-semibold"
            />
            .
          </>
        ) : regalo.amount >= totalHoy ? (
          <>
            <span className="font-semibold">Ya está pagada:</span> al agendarla
            no pagarás nada.
          </>
        ) : (
          <>
            Cubre{" "}
            <PrecioEnLinea
              amountMinor={regalo.amount}
              currency={regalo.currency}
              className="font-semibold"
            />{" "}
            de los{" "}
            <PrecioEnLinea amountMinor={totalHoy} currency={regalo.currency} />{" "}
            que cuesta hoy: la diferencia la pagas tú al agendarla.
          </>
        )}
      </p>

      {/* Regla de oro 4 · el instante vive en UTC y se pinta en la hora local
          de quien mira. `timeZone` es OBLIGATORIO aquí: esto es un componente
          de servidor y sin él saldría la hora de Vercel (UTC), que es el bug
          R24-12. */}
      {regalo.expiresAt ? (
        <p className="mt-1.5 text-xs text-[#6b6b6b]">
          {`Puedes agendarla hasta el ${formatSessionTime(regalo.expiresAt, timeZone)} · tu hora local`}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
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

        {urge ? (
          <StatusPill tone="amber">
            {dias === 0 ? "Caduca hoy" : `Quedan ${dias} días`}
          </StatusPill>
        ) : null}
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
                {fecha ? (
                  <p className="text-xs text-[#6b6b6b]">
                    {`${verbo} ${formatSessionTime(fecha, timeZone)} · tu hora local`}
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
