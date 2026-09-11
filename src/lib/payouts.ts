import { cache } from "react";
import es from "react-phone-number-input/locale/es.json";

// ⚠️ La puerta a las dos tablas que `database.types.ts` todavía no conoce
// (`payout_manual_channels` y `tutor_manual_payout_destinations`). Vivía en la
// carpeta de la pantalla y bajó a `lib` el 11-sep-2026, cuando este módulo
// empezó a necesitarla: una librería que importa de `app/` invierte la
// dependencia y se ata a una ruta que mañana se mueve. Sigue siendo UN fichero
// que borrar el día que se regeneren los tipos, no doce `as unknown as`.
import {
  leerCanalesManuales,
  leerDestinosManuales,
} from "@/lib/payout-manual";
import { leerPerfilDeTutor } from "@/lib/auth/tutor";
import type { Database } from "@/lib/database.types";
import { tasaParaPintar, tasasParaPintar } from "@/lib/dlocalgo";
import {
  canalesServibles,
  metodosDelPais,
  preferenciaVigente,
  rielesDelPais,
} from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/**
 * A0 · ISO-3166-1 alpha-2 → nombre en castellano ("MX" → "México").
 *
 * Los nombres NO se escriben a mano: salen del locale que ya trae
 * `react-phone-number-input`, la misma fuente que usa el selector de país del
 * teléfono. Así, el día que la tabla de ruteo abra un país nuevo, el
 * desplegable del tutor lo nombra solo — que es justo lo que `payoutCountries()`
 * intenta conseguir sacando la lista del dato y no del TSX.
 *
 * El `Record` es un ensanche del tipo del locale, cuyas claves son una unión
 * cerrada de códigos: aquí el código llega como `string` (viene de la BD) y lo
 * que interesa es que un código desconocido devuelva algo legible en vez de
 * romper el tipo. Se cae al propio código, nunca a "undefined" en pantalla.
 */
export function nombrePais(code: string): string {
  return (es as Record<string, string | undefined>)[code] ?? code;
}

/** M7 — etiquetas y color de badge por estado de payout. */
export const PAYOUT_BADGE: Record<
  PayoutStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  paid: { label: "Pagado", variant: "default" },
  processing: { label: "Procesando", variant: "secondary" },
  scheduled: { label: "Programado", variant: "secondary" },
  pending: { label: "En retención", variant: "outline" },
  failed: { label: "Fallido", variant: "destructive" },
  on_hold: { label: "Retenido", variant: "destructive" },
};

export type MoneyByCurrency = { currency: string; amount: number };

/** El balance del tutor viene de `tutor_balance` como jsonb por moneda. */
export type TutorBalance = {
  available: MoneyByCurrency[];
  in_retention: MoneyByCurrency[];
  paid_out: MoneyByCurrency[];
};

/**
 * La moneda en la que llevamos el saldo del tutor y en la que se crean los
 * `payouts`. Es una constante y no una lectura porque hoy `payouts.currency` es
 * USD en las diez filas de ruteo, y porque el adaptador de dLocal Go reserva su
 * estado `sin-decidir` justamente para el día que deje de serlo (solo publica
 * pares DESDE dólar en `/v1/currency-exchanges`).
 */
export const MONEDA_DEL_SALDO = "USD";

/**
 * Lo único que queda del párrafo que explicaba por qué esta cifra no se puede
 * prometer (el largo está en `monedaDeCobroDelTutor`). Está donde lo encuentra
 * quien se lo pregunte, y no delante de quien no.
 */
export const APROXIMADO =
  "Aproximado: el cambio lo fija quien ejecute la transferencia el día que la haga.";

/** La moneda en la que el tutor va a cobrar de verdad, y la tasa de hoy. */
export type MonedaDeCobro = { moneda: string; tasa: number };

/**
 * §5.2 · CUÁNTO ES ESO EN SU MONEDA, y por qué lleva un «≈» delante.
 *
 * 🔑 VIVE AQUÍ Y NO EN UNA PANTALLA porque lo pintan DOS, y hasta el 11-sep-2026
 * solo lo hacía una: `/tutor/payouts` daba la vuelta al par de monedas (local
 * grande, USD pequeño) y el dashboard `/tutor` —que enseña LOS MISMOS DOS
 * IMPORTES— se quedó en dólares. A un clic de distancia el tutor leía
 * «112,50 US$» en un sitio y «≈ 428.500 CLP» en el otro para el mismo dinero,
 * que es exactamente la clase de cosa que abre un ticket.
 *
 * ⚠️ `cache()` de React, o sea UNA resolución por petición: `/tutor/payouts`
 * pide estas mismas filas para otras cosas (el formulario bancario, las
 * tarjetas, el historial) y el dashboard pide dos de ellas para su checklist.
 * Las consultas de aquí son deliberadamente flacas —una columna de una fila en
 * casi todas— y van todas en el mismo `Promise.all`, así que no añaden ni un
 * peldaño a la cascada de ninguna de las dos pantallas, que es lo que se mide
 * (CLAUDE.md: «mira la PROFUNDIDAD de la cascada, no cuántas hay»). Se paga eso
 * a cambio de que las dos pantallas no puedan discrepar: la alternativa era que
 * cada una derivase la moneda con sus propios datos, que es como se llegó aquí.
 *
 * ⚠️ EL DIFERENCIAL DE CAMBIO LO ASUME EL TUTOR (decisión del cliente,
 * 2-sep-2026): `POST /v1/payouts` de dLocal Go no tiene moneda de origen, así
 * que se fija lo que sale de NUESTRO balance (`payouts.amount`, en USD) y la
 * cantidad en moneda local la determina el cambio del día.
 *
 * Hasta hoy eso se contaba en un párrafo de cuatro líneas y el número no
 * aparecía por ninguna parte. Ahora aparece el número —que es lo que el tutor
 * quería— y el párrafo se ha quedado en un «≈».
 *
 * 🔴 SIGUE SIN PODER PROMETERSE, y conviene ser exacto sobre POR QUÉ, porque
 * la versión corta («lleva el mismo factor que aplica el adaptador») es falsa
 * en casi todas partes:
 *   · el factor de liquidación (`DLOCALGO_FX_SPREAD`, 4,7 % medido) es el de
 *     **dLocal**, y dLocal solo PAGA en siete de los 55 países con formulario
 *     bancario: en Colombia y en los 47 de la fila por defecto quien paga es
 *     Wise o Stripe, con su tasa y su comisión. Se aplica igual, y a sabiendas:
 *     es un recorte que tira SIEMPRE hacia abajo, y de los dos errores
 *     posibles el que se puede cometer con el dinero de otro es el de
 *     quedarse corto. Un número por encima del que llega es una reclamación;
 *     uno por debajo es una sorpresa buena.
 *   · quién ejecuta lo decide `payoutProviderFor` el día del lote;
 *   · la tasa es la de HOY y el pago es el lunes.
 * Por eso no se pinta en «Ya cobrado»: ese dinero se cambió el día que salió,
 * a una tasa que ya no es esta, y convertirlo hoy sería inventar un importe
 * que el tutor puede cotejar con su banco.
 *
 * ⚠️ Y NO BASTA CON QUE EL PAÍS TENGA BANCO: manda el MÉTODO, porque PayPal es
 * el único riel que cambia la MONEDA y no solo la tasa. `paypal-provider.ts`
 * manda `currency: input.currency`, o sea USD: a un tutor mexicano que cobra
 * por PayPal, «≈ 3.500,00 MXN» no es una aproximación, es otra moneda.
 *
 * Sin preferencia manda el orden de `payment_routing_rules`, donde los rieles
 * de banco van DELANTE de PayPal en todas las filas. O sea que con preferencia
 * no elegida el banco gana, salvo que el banco no pueda: el único caso es que
 * el tutor no tenga cuenta bancaria y sí tenga conectado un destino que no lo
 * es. Esa es la condición, y no «tiene cuenta bancaria» a secas — que dejaba
 * sin cifra justo al tutor que todavía está decidiendo por dónde cobrar, que
 * es a quien más le sirve verla.
 *
 * `null` en Ecuador (su `currency` es USD), sin credencial de dLocal y en las
 * monedas que esa tabla no publica. Entonces no se pinta la línea: es la regla
 * de siempre, la credencial es el interruptor.
 *
 * ⚠️ Aquí NO se miran los `error` (y en el resto del repo sí, regla de oro 10):
 * un fallo de permisos deja la moneda en `null` y la pantalla vuelve a pintar
 * el USD, que es el dato exacto. Es el único sitio donde degradar es correcto,
 * porque lo que se pierde es una estimación, no un dato del tutor.
 */
export const monedaDeCobroDelTutor = cache(
  async (profileId: string): Promise<MonedaDeCobro | null> => {
    // El país sale de la misma lectura memoizada que ya resolvió la guarda de
    // las dos pantallas (`requireTutorProfile`), así que no cuesta un viaje.
    const perfil = await leerPerfilDeTutor(profileId);
    const pais = perfil?.payout_country ?? null;

    const supabase = await createClient();
    const [
      { data: regla },
      { data: cuenta },
      { data: canalesData },
      { data: destinosData },
      { data: pref },
      { rieles, familias: familiasDelPais },
      tasas,
    ] = await Promise.all([
      // Solo la moneda, y solo la fila de SU país: `/tutor/payouts` se trae las
      // 55 con trece columnas porque tiene que montar el formulario, pero para
      // decidir la moneda sobra todo menos esto.
      pais
        ? supabase
            .from("payout_country_rules")
            .select("currency")
            .eq("country", pais)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("tutor_payout_accounts")
        .select("country")
        .eq("tutor_id", profileId)
        .maybeSingle(),
      leerCanalesManuales(supabase),
      leerDestinosManuales(supabase, profileId),
      supabase
        .from("tutor_payout_preferences")
        .select("method")
        .eq("tutor_id", profileId)
        .maybeSingle(),
      rielesDelPais(pais),
      // La tabla de tasas, cacheada una hora por Next. Va aquí —y por eso
      // `tasasParaPintar` no recibe la moneda— para no añadir un peldaño a la
      // cascada: el par se elige abajo, cuando ya se sabe la regla del país.
      // Sin credencial devuelve `null` y no se pinta nada.
      tasasParaPintar(),
    ]);

    /**
     * ⚠️ El formulario bancario se cae si el país no tiene fila en
     * `payout_country_rules`: sin ella no hay etiquetas que poner, ni bancos que
     * ofrecer, ni guardado que pueda terminar. Es lo que hace que España —que
     * rutea por la fila por defecto, con Wise dentro— vea Stripe y PayPal y no
     * una tarjeta de banco imposible de rellenar. Y es el mismo filtro que
     * aplica la pantalla antes de pintar las tarjetas: si divergiera, la moneda
     * hablaría de una tarjeta que no existe.
     */
    const familias = familiasDelPais.filter(
      (f) => f !== "banco" || regla !== null,
    );

    // Los canales que este país puede usar DE VERDAD. `payout_manual_channels`
    // es catálogo global —no tiene columna de país—, así que sin este filtro un
    // tutor colombiano contaría con una tarjeta de Zinli que ningún riel suyo
    // sabe usar, y eso cambia cuál es su método preferido vigente.
    const canales = canalesData as { channel: string; is_active: boolean }[];
    const canalesQueSirven = new Set(
      canalesServibles(
        rieles.map((r) => r.clave),
        canales.map((c) => c.channel),
      ),
    );
    const preferida = preferenciaVigente(
      pref?.method ?? null,
      metodosDelPais({
        rieles,
        familias,
        canalesActivos: canales
          .filter((c) => c.is_active && canalesQueSirven.has(c.channel))
          .map((c) => c.channel),
      }),
    );

    const cobraPorBanco = preferida
      ? preferida === "banco"
      : familias.includes("banco") &&
        (cuenta?.country === pais || destinosData.length === 0);
    const moneda = cobraPorBanco && regla ? regla.currency : null;
    if (!moneda) return null;

    const tasa = tasaParaPintar(tasas, MONEDA_DEL_SALDO, moneda);
    return tasa === null ? null : { moneda, tasa };
  },
);

/** «≈ 115.343 CLP» a partir de un saldo en dólares, o `null` si no hay con qué. */
export function enMonedaLocal(
  lista: MoneyByCurrency[],
  local: MonedaDeCobro | null,
): string | null {
  if (!local) return null;
  // ⚠️ UN SOLO IMPORTE, Y EN DÓLARES. Esto convierte únicamente la parte en
  // USD de la lista; mientras era la línea pequeña, con dos monedas quedaba
  // ambiguo. Desde que es la cifra GRANDE sería un titular que se deja dinero
  // fuera, así que ahí manda el USD y no hay segunda línea.
  if (lista.length !== 1) return null;
  const enDolares = lista.find((m) => m.currency === MONEDA_DEL_SALDO);
  if (!enDolares || enDolares.amount <= 0) return null;
  // `formatMoney` no sirve aquí: divide entre 100 siempre y hay monedas de
  // cero decimales (CLP, PYG). Se convierte a unidad MAYOR primero y se deja
  // que `Intl` ponga los decimales que esa moneda tenga, que son los suyos.
  return `≈ ${new Intl.NumberFormat("es", {
    style: "currency",
    currency: local.moneda,
  }).format((enDolares.amount / 100) * local.tasa)}`;
}
