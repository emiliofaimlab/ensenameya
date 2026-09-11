import { headers } from "next/headers";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import {
  canalesServibles,
  metodosDelPais,
  preferenciaVigente,
  rielesDelPais,
} from "@/lib/payments";
import { PAYOUT_BADGE, nombrePais, type TutorBalance } from "@/lib/payouts";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { tasaParaPintar, tasasParaPintar } from "@/lib/dlocalgo";
import { WithdrawButton } from "./withdraw-button";
import { PayoutAccountForm } from "./payout-account-form";
import { PaypalConectar } from "./paypal-conectar";
import { PayoutManualForm } from "./payout-manual-form";
import { MetodosDeCobro, type TarjetaMetodo } from "./metodos-de-cobro";
import { LOGOS } from "./logos";
import { leerCanalesManuales, leerDestinosManuales } from "./rpc";
import {
  type BancoDePais,
  type CanalManual,
  type CuentaEnmascarada,
  type DestinoManualEnmascarado,
  type ReglaDePais,
} from "@/lib/payout-account";
import { formatPct, tutorTier } from "../tier";

export const metadata = { title: "Mis pagos · Enséñame Ya" };

/** Píldoras del Figma (204:9/19/30): color por estado del payout. */
const PAYOUT_PILL: Record<string, PillTone> = {
  paid: "green",
  processing: "blue",
  scheduled: "blue",
  pending: "amber",
  failed: "red",
  on_hold: "red",
};

/** Los estados que todavía no han pagado: van arriba de «Movimientos». */
const UPCOMING = new Set(["scheduled", "processing", "pending"]);

/**
 * La moneda en la que llevamos el saldo del tutor y en la que se crean los
 * `payouts`. Es una constante y no una lectura porque hoy `payouts.currency` es
 * USD en las diez filas de ruteo, y porque el adaptador de dLocal Go reserva su
 * estado `sin-decidir` justamente para el día que deje de serlo (solo publica
 * pares DESDE dólar en `/v1/currency-exchanges`).
 */
const MONEDA_DEL_SALDO = "USD";

/**
 * `payouts.provider` → cómo se llama esa vía para el tutor.
 *
 * 🔑 LOS TRES RIELES DE BANCO DICEN LO MISMO, y no es una omisión: dLocal, Wise
 * y Stripe le ingresan en su cuenta bancaria, y qué corresponsal usamos
 * nosotros no es información suya. Es la misma decisión que hace que la lista
 * de arriba tenga UNA tarjeta de banco y no tres, y es literalmente lo que
 * pide el dictado: «el tutor JAMÁS se enterará» de quién ejecutó.
 *
 * Cierra el hueco que el Figma pedía (204:23, «Transferencia bancaria · DLocal»)
 * y que este fichero llevaba marcado como «llega con el PSP real (EP-20)»:
 * `payouts.provider` tiene `grant select` para `authenticated` desde que existe.
 */
const VIA: Record<string, string> = {
  stripe: "Transferencia bancaria",
  dlocal: "Transferencia bancaria",
  wise: "Transferencia bancaria",
  paypal: "PayPal",
  manual: "Envío a mano",
  "banco-manual": "Transferencia a mano",
  simulated: "Simulado",
};

function moneyLine(list: { currency: string; amount: number }[]): string {
  if (list.length === 0) return "—";
  return list.map((m) => formatMoney(m.amount, m.currency)).join(" · ");
}

/**
 * ⚠️ EL AÑO SOLO CUANDO NO ES EL DE HOY. «4 sept 2026» en todas las filas
 * ensancha la primera columna de una tabla que ya pide 680 px para no romperse
 * en móvil, y lo hace para repetir el dato que se da por supuesto. Se pinta
 * cuando de verdad distingue —una liquidación del año pasado— y no antes.
 */
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: d.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
  });
};

/**
 * §5.1 · EL DÍA DEL PRÓXIMO LOTE, CALCULADO Y NO ESCRITO.
 *
 * El aviso de arriba nombra un día concreto («el pago del lunes 14»), así que
 * una fecha en el texto se quedaría mintiendo a la semana siguiente. Sale del
 * único sitio donde ese día existe de verdad: el `cron.schedule` de
 * `run-payout-batch`, `0 3 * * 1` desde `20260716140000` — lunes a las 03:00.
 *
 * ⚠️ Se cuenta en UTC, que es la hora del cron. Es la única excepción sensata a
 * la regla de oro 4 en esta frase: el día del lote lo fija el servidor, no la
 * zona del tutor, y traducirlo a su hora local haría que a un colombiano le
 * pusiera «domingo» en el aviso de un lote que la plataforma llama «los lunes».
 */
function diaDelProximoLote(hoy = new Date()): number {
  const d = new Date(hoy);
  // 0 domingo … 1 lunes. Un lunes antes de las 03:00 UTC el lote es HOY; a
  // partir de esa hora ya corrió y el siguiente es el de dentro de siete días.
  const esHoy = d.getUTCDay() === 1 && d.getUTCHours() < 3;
  const dias = esHoy ? 0 : (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + dias);
  return d.getUTCDate();
}

/**
 * Dos letras para el cuadradito de cada tarjeta. NO es el logo de la marca: el
 * Figma no trae logos de terceros y meter el azul de PayPal, el morado de
 * Stripe y el amarillo de Binance rompería la paleta justo en la única pantalla
 * donde conviven cinco.
 */
const monograma = (nombre: string) => {
  // Las mayúsculas internas cuando las hay ("PayPal" → PP), y si no las dos
  // primeras letras ("Zinli" → ZI). Cortar a ciegas dejaba "PA", que en una
  // lista donde también está "Pago manual" no distingue nada.
  const mayusculas = nombre.replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
  return (mayusculas.length >= 2 ? mayusculas.slice(0, 2) : nombre.slice(0, 2)).toUpperCase();
};

/**
 * US-1001 (SCR-TU09) — payouts del tutor: cifras, dónde cobra y el historial.
 * US-1004: retiro self-service (RN-40).
 *
 * ── LO QUE CAMBIÓ EL 8-SEP-2026, Y POR QUÉ ──────────────────────────────────
 *
 * 1 · **El tutor elige por dónde cobra.** Antes esta pantalla le pedía datos y
 *     el enrutador decidía solo; ahora lo marca con una estrella (§5.4, que se
 *     llevó por delante el radiogroup del 8-sep) y su elección vive en
 *     `tutor_payout_preferences`. `payoutProviderFor` la usa para REORDENAR
 *     candidatos y después aplica sus tres filtros de siempre, así que elegir
 *     algo sin terminar no atasca ninguna orden — se cae al siguiente riel. La
 *     frase de debajo del grupo lo dice con todas las letras.
 *
 * 2 · **El país ya no se elige: sale de la zona horaria** (`20260908130000`).
 *     Se fue el `<select>` y con él `PayoutCountryForm`. El escape para quien
 *     cobre en otro sitio es cambiar su zona horaria en `/account`, que es la
 *     misma con la que publica sus horarios — o sea, un dato que ya mantiene.
 *
 * 3 · **La pantalla pregunta al ENRUTADOR, no a la tabla.** Antes llamaba a
 *     `payoutCountries()`, que leía `payment_routing_rules` a mano y se dejaba
 *     fuera la fila POR DEFECTO: a un tutor español le decía «todavía no
 *     podemos pagarte en tu país» mientras el job le habría pagado por Stripe.
 *     Ahora es `rielesDelPais()`, que va por `ruta_de_pago()` — la misma
 *     función que usa `payoutProviderFor`, así que las dos no pueden discrepar.
 *
 * 4 · **Una tarjeta por MÉTODO, no por familia de dato.** dLocal, Wise y Stripe
 *     leen la misma fila de `tutor_payout_accounts` y le ingresan en la misma
 *     cuenta: son una sola tarjeta. Los canales manuales, en cambio, son uno por
 *     tarjeta, porque para el tutor Zinli y Zelle son dos sitios distintos.
 *
 * ── Y LO QUE CAMBIÓ EL 9/10-SEP-2026 CON EL DICTADO ────────────────────────
 *
 * 5 · **Se fue la tarjeta de «Cuenta bancaria vía Stripe»** y con ella la
 *     familia 'conectada' entera. El tutor ve DOS tarjetas automáticas —PayPal
 *     y Banco— y detrás de Banco compiten los tres rieles sin que él lo sepa.
 *     `docs/DICTADO-PAGOS.md` §3.
 *
 * 6 · **El banco alcanza a 55 países, no a 9.** `payout_country_rules` se abrió
 *     por FORMATO —`iban` cubre 31 de golpe— en vez de país a país, así que un
 *     tutor español, estadounidense o panameño ya ve su formulario.
 */
export default async function TutorPayoutsPage() {
  // Mismo guard que el resto del panel: fila en `tutor_profiles`. Con
  // `requireRole("tutor")` un tutor aprobado sin el rol concedido (o uno
  // pendiente, al que el menú ya le ofrece Payouts) rebotaba a /app.
  //
  // 🔑 EL PAÍS SALE DE AQUÍ, y con eso se aplana la pantalla más lenta del
  // panel. Era el primer eslabón de una cadena de cinco: la guarda leía
  // `tutor_profiles`, y DESPUÉS el `Promise.all` volvía a leer la MISMA FILA
  // solo por `payout_country`; de ese valor colgaba `rielesDelPais()`, y de lo
  // que devolviera, el catálogo de bancos. Cuatro viajes en fila india por un
  // dato que ya venía en la primera consulta — 874 ms de payload RSC contra
  // ~350 ms de `/tutor/reservas`. Trayéndolo en la guarda, los tres peldaños de
  // abajo se convierten en miembros del mismo `Promise.all`.
  const { userId, payoutCountry: paisDeCobro } = await requireTutorProfile();

  const supabase = await createClient();
  const [
    { data: balanceData },
    { data: payouts },
    tier,
    { data: reglas, error: errorReglas },
    { data: cuentaData, error: errorCuenta },
    { data: canalesData, error: errorCanales },
    { data: destinosData, error: errorDestinos },
    { data: prefData, error: errorPref },
    { data: itemsData, error: errorItems },
    { rieles, familias: familiasDelPais },
    { data: bancosData },
    tasas,
  ] = await Promise.all([
    supabase.rpc("tutor_balance"),
    supabase
      .from("payouts")
      // `provider` es la columna que faltaba para poder decir POR DÓNDE salió
      // cada liquidación. Tiene grant para `authenticated`; no pedirla era lo
      // que dejaba la tabla del Figma a medias.
      .select(
        "id, status, currency, amount, scheduled_for, paid_at, created_at, provider",
      )
      .order("created_at", { ascending: false }),
    tutorTier(supabase, userId),
    supabase
      .from("payout_country_rules")
      .select(
        "country, currency, account_label, account_help, account_types, account_patterns, document_patterns, requires_branch, branch_pattern, branch_label, branch_help, wise_account_type",
      ),
    supabase
      .from("tutor_payout_accounts")
      .select(
        "country, beneficiary_first_name, beneficiary_last_name, beneficiary_document_type, bank_code, bank_account_last4, bank_account_type, bank_branch, updated_at, beneficiary_address_line, beneficiary_city, beneficiary_state, beneficiary_postcode, beneficiary_phone",
      )
      .eq("tutor_id", userId)
      .maybeSingle(),
    leerCanalesManuales(supabase),
    leerDestinosManuales(supabase, userId),
    // Por dónde prefiere cobrar. RLS de dueño; sin fila = no ha elegido.
    supabase
      .from("tutor_payout_preferences")
      .select("method")
      .eq("tutor_id", userId)
      .maybeSingle(),
    /**
     * §5.5 (N-27) · DE QUÉ RESERVAS SE COMPONE CADA LIQUIDACIÓN.
     *
     * `payouts.amount` es un agregado y hasta hoy la tabla no decía de dónde
     * salía: el tutor veía «$ 210,00» y no tenía forma de cuadrarlo con sus
     * clases. `payout_items` es exactamente esa descomposición, y la puede leer
     * él —`payout_items_select_own` + `grant select … to authenticated`, los
     * dos desde `20260716140000`—, así que no hace falta ni migración ni RPC.
     *
     * Sin `.eq(tutor_id)`: la política filtra por «el payout es tuyo», que es
     * la misma condición y la aplica el motor. El identificador humano de la
     * reserva (`booking_ref`) vive AQUÍ y en el detalle, no en la lista de
     * Reservas (§4.5).
     */
    supabase
      .from("payout_items")
      .select(
        "payout_id, amount, payments(bookings(booking_ref, products(title)))",
      ),
    // 🔑 `rielesDelPais`: lo que se puede hacer por ESTE país, preguntándoselo
    // al enrutador. Va DENTRO del `Promise.all` desde que el país lo trae la
    // guarda: antes era un `await` suelto que no podía empezar hasta que este
    // bloque entero terminaba, y por dentro hace su propio `rpc(ruta_de_pago)`.
    //
    // ⚠️ AQUÍ HABÍA UNA SEGUNDA LLAMADA, A LA API DE STRIPE, para saber si la
    // cuenta conectada del tutor podía recibir ya. Se fue con la tarjeta: el
    // dictado del 9-sep-2026 elimina el alta de Connect de esta pantalla, así
    // que no hay nada que preguntarle a Stripe.
    rielesDelPais(paisDeCobro),
    // El catálogo de bancos, solo del país que toca: son hasta 213 filas
    // (Ecuador), y traer el catálogo entero para enseñar uno sería mandarlo al
    // navegador en cada visita. ⚠️ La mayoría de los países que se abrieron el
    // 10-sep NO tienen catálogo de bancos: su formato es un IBAN o un BIC que
    // el tutor teclea, así que ahí esto vuelve vacío.
    //
    // ⚠️ SE PIDE SIN SABER TODAVÍA SI HAY TARJETA DE BANCO, y es inocuo por un
    // motivo concreto: `bancos` se lee en dos sitios y los dos están dentro de
    // la rama de banco, que ya exige `regla` (`m.clave === "banco"` solo existe
    // si `familias` conservó "banco", y eso pide `regla !== null`). O sea, una
    // lista vacía nunca se interpreta como «este país no tiene regla»: en el
    // país sin regla nadie mira esta variable. Lo que se gana a cambio es el
    // quinto peldaño de la cascada, que colgaba de lo que devolviera el cuarto.
    paisDeCobro
      ? supabase
          .from("payout_banks")
          .select("bank_code, name, rejects_cpf")
          .eq("country", paisDeCobro)
          .order("name")
      : Promise.resolve({ data: null }),
    // La tabla de tasas, cacheada una hora, para poder decirle al tutor cuánto
    // es eso en su moneda. Va aquí —y por eso `tasasParaPintar` no recibe la
    // moneda— para no añadir un peldaño a la cascada: el par se elige abajo,
    // cuando ya se sabe la regla del país. Sin credencial devuelve `null` y no
    // se pinta nada.
    tasasParaPintar(),
  ]);

  const balance = balanceData as unknown as TutorBalance;
  const hasAvailable = balance.available.length > 0;

  /**
   * 🔑 LA IP DEL TUTOR, para sellar la aceptación de condiciones (decisión D-1).
   *
   * Stripe exige `tos_acceptance.ip` junto con la fecha, y el navegador no puede
   * decir la suya: lo que él mandara sería lo que él quisiera. Se resuelve aquí,
   * en el servidor, de la cabecera que pone el proxy.
   *
   * ⚠️ `x-forwarded-for` puede traer una CADENA de direcciones («cliente, proxy1,
   * proxy2»). La del cliente es la PRIMERA. Quedarse con la cadena entera
   * guardaría una `inet` inválida y la RPC reventaría al castear.
   *
   * `null` si no hay cabecera (en local, por ejemplo). Entonces la casilla no
   * sella nada y el tutor sigue cobrando por sus otras vías: es mejor perder una
   * ruta que guardar un consentimiento sin poder probar de dónde vino.
   */
  const cabeceras = await headers();
  const ipDelTutor =
    cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    cabeceras.get("x-real-ip")?.trim() ||
    null;

  /**
   * ⚠️ Se miran los `error`, no solo los `data` (regla de oro 10). Un
   * `const { data } = …` convierte un fallo de permisos en `null`, y `null` aquí
   * significa «no has registrado nada» — que es una mentira creíble, y
   * exactamente la que dejó la cola del admin enseñando «(0)» con 11 tutores
   * dentro. Si esto falla, el tutor tiene que ver que falló, no un formulario
   * vacío que sobrescribiría lo que sí tiene guardado.
   */
  const cuenta = (cuentaData ?? null) as CuentaEnmascarada | null;
  const canales = canalesData as CanalManual[];
  const destinos = destinosData as DestinoManualEnmascarado[];
  const fallaLaCuenta = Boolean(
    errorCuenta ?? errorReglas ?? errorCanales ?? errorDestinos ?? errorPref,
  );

  // La regla del país. Son las 55 filas de `payout_country_rules` desde el
  // 10-sep-2026 — antes eran nueve y este comentario decía «y España todavía
  // no». Ya sí: se abrieron por FORMATO (`iban` cubre 31 países de una vez), y
  // por eso la tarjeta de banco de un tutor español aparece sin tocar este
  // fichero, que era justo lo que este comentario prometía.
  //
  // Venezuela no está ni va a estar: es el único país que no alcanzan ni Wise,
  // ni dLocal, ni Stripe, y por eso cobra por canal manual.
  const regla =
    (paisDeCobro
      ? ((reglas ?? []) as ReglaDePais[]).find((r) => r.country === paisDeCobro)
      : undefined) ?? null;

  /**
   * ⚠️ El formulario bancario se cae si el país no tiene fila en
   * `payout_country_rules`: la FK de `tutor_payout_accounts.country` apunta ahí,
   * así que sin regla no hay etiquetas que poner, ni bancos que ofrecer, ni
   * guardado que pueda terminar. Es lo que hace que España —que rutea por la
   * fila por defecto, con Wise dentro— vea Stripe y PayPal y no una tarjeta de
   * banco imposible de rellenar.
   */
  const familias = familiasDelPais.filter((f) => f !== "banco" || regla !== null);

  // Se pidió arriba, con el resto. Solo se lee dentro de la rama de banco.
  const bancos = (bancosData ?? []) as BancoDePais[];

  /** `channel` → `label`. Incluye los apagados: un destino registrado en uno
      que Legal cerró ayer tiene que seguir teniendo nombre. */
  const etiquetaDeCanal = (channel: string) =>
    canales.find((c) => c.channel === channel)?.label ?? channel;

  /**
   * 🔴 LOS CANALES QUE ESTE PAÍS PUEDE USAR DE VERDAD.
   *
   * `payout_manual_channels` es catálogo global —no tiene columna de país— así
   * que ofrecer Zinli en Colombia sería dejarle registrar un destino que ningún
   * riel de su país sabe usar: la orden se quedaría en 'scheduled' para siempre,
   * sin pagar y sin fallar. Es el fallo del tutor venezolano con Zinli, un país
   * más tarde.
   */
  const canalesQueSirven = new Set(
    canalesServibles(
      rieles.map((r) => r.clave),
      canales.map((c) => c.channel),
    ),
  );
  const canalesOfrecidos: CanalManual[] = canales.map((c) => ({
    ...c,
    is_active: c.is_active && canalesQueSirven.has(c.channel),
  }));

  // 🔑 Las tarjetas, en el orden de preferencia de la tabla de ruteo.
  const metodos = metodosDelPais({
    rieles,
    familias,
    canalesActivos: canalesOfrecidos
      .filter((c) => c.is_active)
      .map((c) => c.channel),
  });
  const preferida = preferenciaVigente(prefData?.method ?? null, metodos);

  const cuentaDeEstePais = cuenta !== null && cuenta.country === paisDeCobro;

  /**
   * §5.2 · CUÁNTO ES ESO EN SU MONEDA, y por qué lleva un «≈» delante.
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
   * Sin preferencia la condición es tener CUENTA BANCARIA de este país, y no el
   * orden de `metodos`: los rieles de banco van delante de PayPal en todas las
   * filas de ruteo, así que con datos bancarios registrados el que paga es uno
   * de ellos. Sin cuenta no se promete moneda, que es además el estado en el que
   * la pantalla ya le está pidiendo que complete una.
   *
   * `null` en Ecuador (su `currency` es USD), sin credencial de dLocal —el caso
   * de producción hoy— y en las monedas que esa tabla no publica. Entonces no se
   * pinta la línea: es la regla de siempre, la credencial es el interruptor.
   */
  const cobraPorBanco = preferida ? preferida === "banco" : cuentaDeEstePais;
  const monedaLocal = cobraPorBanco && regla ? regla.currency : null;
  const tasaLocal = monedaLocal
    ? tasaParaPintar(tasas, MONEDA_DEL_SALDO, monedaLocal)
    : null;

  /** «≈ 115.343 CLP» a partir de un saldo en dólares, o `null` si no hay con qué. */
  const enMonedaLocal = (
    lista: { currency: string; amount: number }[],
  ): string | null => {
    if (!monedaLocal || !tasaLocal) return null;
    const enDolares = lista.find((m) => m.currency === MONEDA_DEL_SALDO);
    if (!enDolares || enDolares.amount <= 0) return null;
    // `formatMoney` no sirve aquí: divide entre 100 siempre y hay monedas de
    // cero decimales (CLP, PYG). Se convierte a unidad MAYOR primero y se deja
    // que `Intl` ponga los decimales que esa moneda tenga, que son los suyos.
    return `≈ ${new Intl.NumberFormat("es", {
      style: "currency",
      currency: monedaLocal,
    }).format((enDolares.amount / 100) * tasaLocal)}`;
  };

  const destinoDe = (canal: string) =>
    destinos.find((d) => d.channel === canal) ?? null;

  /**
   * 🔑 A WISE LE FALTA ALGO Y HOY ESO NO SE VE POR NINGÚN LADO.
   *
   * dLocal y Wise leen la misma fila, pero no les vale lo mismo: Wise exige
   * además dirección y teléfono (`wise_puede_pagar_a()`). Un tutor mexicano con
   * su CLABE registrada cobra igual, pero por el riel caro, y nadie se lo dice.
   *
   * Se deriva AQUÍ y no de la base a propósito: los cuatro campos de dirección
   * tienen `grant select` para `authenticated` desde `20260907120000`, así que
   * la pantalla ya los tiene. Exponer `wise_puede_pagar_a()` —que es
   * `service_role`— para pintar una frase habría sido abrir una función del
   * ruteo por un aviso.
   */
  const faltaDireccion =
    cuentaDeEstePais &&
    regla?.wise_account_type != null &&
    !(
      cuenta?.beneficiary_address_line &&
      cuenta?.beneficiary_city &&
      cuenta?.beneficiary_postcode &&
      cuenta?.beneficiary_phone
    );

  /**
   * Las tarjetas, ya con su texto resuelto. Se construyen en el servidor porque
   * los nombres de país arrastran el locale entero de
   * `react-phone-number-input` y las descripciones de los canales son filas de
   * `payout_manual_channels`: cero canales y cero países codificados en el TSX.
   */
  const tarjetas: TarjetaMetodo[] = metodos.map((m): TarjetaMetodo => {
    if (m.clave === "banco") {
      const nombreDelBanco =
        bancos.find((b) => b.bank_code === cuenta?.bank_code)?.name ?? null;
      return {
        clave: "banco",
        nombre: "Transferencia bancaria",
        // Sin logo a propósito: no es de ninguna marca. Ver `logos.ts`.
        logo: null,
        monograma: "TR",
        // ⚠️ UNA LÍNEA. Aquí había un párrafo de tres —titular, documento, qué
        // pasa si no coinciden— y multiplicado por cinco tarjetas convertía la
        // pantalla en un muro. Lo que importa AL ELEGIR es dónde y en qué
        // moneda cae el dinero; el resto se lee al rellenar, que es cuando
        // sirve, y por eso baja al bloque del formulario.
        // El «(importe aproximado)» que colgaba aquí se fue con el párrafo del
        // cambio: lo aproximado ahora se ve arriba, con su «≈» y su cifra.
        descripcion: `A tu cuenta en ${nombrePais(paisDeCobro!)}, en ${regla?.currency ?? MONEDA_DEL_SALDO}.`,
        automatico: m.automatico,
        listo: cuentaDeEstePais,
        detalle: cuentaDeEstePais
          ? `${nombreDelBanco ?? cuenta!.bank_code} · ····${cuenta!.bank_account_last4}`
          : cuenta
            ? `Tienes datos de ${nombrePais(cuenta.country)} guardados, pero a ${nombrePais(paisDeCobro!)} no llega esa transferencia.`
            : null,
        aviso: null,
        // Sigue siendo útil —dice que a lo guardado le falta algo— pero ya no
        // explica para qué sirve cada campo: el formulario los pide a todos por
        // igual desde el 11-sep, así que esa explicación describía una
        // distinción que la pantalla dejó de hacer.
        //
        // ⚠️ NO NOMBRA CUÁLES, y no es vaguedad: `faltaDireccion` es verdadero
        // si falta CUALQUIERA de los cuatro, así que «te faltan la dirección y
        // el teléfono» era falso para quien solo tenía el código postal en
        // blanco. Los cuatro campos se prerrellenan al abrir el formulario, de
        // modo que el hueco se ve; lo que hace falta aquí es que mire.
        subtarea: faltaDireccion ? "Te faltan datos del titular." : null,
        conectar: false,
      };
    }

    // ⚠️ LOS CANALES MANUALES NO LLEVAN DESCRIPCIÓN EN LA TARJETA, y no se
    // pierde nada: `payout_manual_channels.help` —que es donde vive la
    // explicación buena, y es DATO— ya se pinta dentro del formulario, justo
    // encima del campo, que es donde el tutor la necesita. Repetirla aquí
    // alargaba la pantalla con el mismo texto dos veces.
    //
    // PayPal es la excepción y por un motivo, no por gusto: su tarjeta no abre
    // ningún formulario (solo conecta), así que si no dice nada aquí no lo dice
    // en ninguna parte. Una línea.
    const canal = canales.find((c) => c.channel === m.canal);
    const destino = destinoDe(m.canal!);
    const conectadaPorOauth = Boolean(destino?.verified_account_id);
    return {
      clave: m.clave,
      nombre: canal?.label ?? m.clave,
      logo: LOGOS[m.clave] ?? null,
      monograma: monograma(canal?.label ?? m.clave),
      descripcion:
        m.clave === "paypal" ? "A tu saldo de PayPal, en dólares." : "",
      automatico: m.automatico,
      listo: destino !== null,
      detalle: destino
        ? `${conectadaPorOauth ? "Cuenta conectada" : "Registrada"} · ${destino.handle_masked}`
        : null,
      // ⚠️ SE FUE EL AVISO DE PAYPAL, y no por recortar: avisaba de un riesgo
      // que la pantalla ya no ofrece. Decía «conecta tu cuenta en vez de
      // escribir el correo a mano» cuando el campo de correo desapareció de
      // esta tarjeta — o sea, advertía de un camino que no existe. Lo que sí
      // sigue vivo es la razón de que no exista, y está escrita donde importa:
      // en la cabecera de `paypal-conectar.tsx`.
      aviso: null,
      subtarea: null,
      // 🔑 PayPal se CONECTA y no se teclea. Los otros canales —Zinli, Binance,
      // Zelle— son al revés: no hay nada que conectar, solo un identificador que
      // el tutor escribe, así que esos sí llevan formulario.
      conectar: m.clave === "paypal",
    };
  });

  /**
   * El formulario de cada tarjeta, renderizado en el servidor y pasado como
   * `children`. La lista es de cliente y no puede construirlos: necesitan
   * el catálogo de bancos, las reglas del país y los nombres resueltos.
   */
  const formularios: Record<string, React.ReactNode> = {};
  /** La acción de los que se conectan: su botón, sin recuadro ni párrafo. */
  const acciones: Record<string, React.ReactNode> = {};
  for (const m of metodos) {
    if (m.clave === "banco" && regla && paisDeCobro) {
      formularios.banco = (
        <>
          {/* ⚠️ AQUÍ HABÍA DOS PÁRRAFOS Y AHORA NO HAY NINGUNO (11-sep-2026).
              Uno decía que la cuenta tiene que estar a nombre del tutor; el otro
              —en recuadro ámbar— explicaba en cuatro líneas que el importe en
              moneda local es aproximado. Los dos se leían ANTES de tocar el
              primer campo, que es cuando nadie lee. Lo que decían no se ha
              perdido: lo del titular lo dice cada rótulo («Nombre del titular»,
              «Apellidos del titular») y lo dice el error de la RPC si no cuadra,
              que llega en el momento en que sirve; y lo del cambio es ahora un
              número con un «≈» delante, arriba, junto al saldo. */}
          <PayoutAccountForm
          // ⚠️ `key` por país, y no es decorativo: el formulario guarda su
          // estado en `useState`, que NO se reinicializa cuando cambian las
          // props. Sin esto, cambiar de país dejaría dentro el banco del
          // anterior — un código que ya no está en la lista.
          key={paisDeCobro}
          regla={regla}
          bancos={bancos}
          cuenta={cuenta}
          paisDeclarado={paisDeCobro}
          ipDelTutor={ipDelTutor}
          etiquetaPais={nombrePais(paisDeCobro)}
            etiquetaPaisGuardado={cuenta ? nombrePais(cuenta.country) : null}
          />
        </>
      );
    } else if (m.clave === "paypal") {
      // ⚠️ NI UN CAMPO DE CORREO. Aquí se pintaba `PayoutManualForm` debajo del
      // botón «por si no quiere conectar», y eso era ofrecerle la vía que NO
      // entrega: cuatro pagos a un correo tecleado, cuatro `UNCLAIMED`
      // (medido el 4-sep-2026). La tarjeta de PayPal es un botón.
      // El `key`, por lo mismo que el de arriba.
      acciones.paypal = (
        <PaypalConectar
          key="paypal"
          conectada={Boolean(destinoDe("paypal")?.verified_account_id)}
          compacto
        />
      );
    } else if (m.canal && paisDeCobro) {
      formularios[m.clave] = (
        <>
          <PayoutManualForm
            key={`${paisDeCobro}-${m.canal}`}
            canales={canalesOfrecidos}
            destinos={destinos}
            etiquetaPais={nombrePais(paisDeCobro)}
            esLaUnicaVia={metodos.length === 1}
            // El canal lo eligió la tarjeta: aquí dentro no hay desplegable.
            canalFijo={m.canal}
          />
        </>
      );
    }
  }

  // Los próximos primero, y después el historial. Una sola tabla en vez de dos
  // listas: son la misma cosa en dos momentos, y la columna «Estado» ya las
  // distingue mejor que dos títulos.
  const movimientos = [
    ...(payouts ?? []).filter((p) => UPCOMING.has(p.status)),
    ...(payouts ?? []).filter((p) => !UPCOMING.has(p.status)),
  ];

  /**
   * §5.5 · Las reservas de cada liquidación, agrupadas por payout.
   *
   * ⚠️ Se mira el `error` (regla de oro 10): con `const { data }` un fallo de
   * permisos llegaría aquí como lista vacía y la tabla diría «0 reservas» en
   * una fila de $ 210,00 — la mentira creíble de siempre, y encima sobre
   * dinero. Si falla, la columna dice «—» y no cuenta nada.
   */
  const reservasPorPayout = new Map<
    string,
    { ref: string; titulo: string; amount: number }[]
  >();
  if (!errorItems) {
    for (const it of itemsData ?? []) {
      const booking = it.payments?.bookings;
      const lista = reservasPorPayout.get(it.payout_id) ?? [];
      lista.push({
        // Sin `booking_ref` (las reservas viejas no lo tienen) se cae al guion:
        // inventar un identificador en una tabla de conciliación es peor que
        // no ponerlo, porque el tutor lo usaría para escribirnos.
        ref: booking?.booking_ref ?? "—",
        titulo: booking?.products?.title ?? "Mentoría",
        amount: it.amount,
      });
      reservasPorPayout.set(it.payout_id, lista);
    }
  }

  /**
   * §5.5 · «Vía · destino»: el riel, y a qué cuenta suya.
   *
   * `payouts` NO guarda el destino —ni una columna, ni nada usable en
   * `provider_metadata`—, así que lo que se puede enseñar es la cuenta que el
   * tutor tiene registrada HOY para ese riel. Se dice así en el `title` de la
   * celda en vez de afirmar que fue esa: si cambió de cuenta después de cobrar,
   * la fila enseñaría la nueva. Con Stripe ni eso — las coordenadas se las dio
   * a ellos y nosotros no las vemos nunca.
   */
  const destinoDelRiel = (provider: string | null): string | null => {
    if (!provider) return null;
    // 🔑 Stripe entra aquí desde el dictado: es un riel de banco más, así que
    // enseña los últimos cuatro de la MISMA cuenta que dLocal y Wise. Antes
    // devolvía null porque el dinero salía por Connect y nosotros no teníamos
    // sus coordenadas — ahora sí, porque las teclea el tutor en nuestro
    // formulario. Sin esto, un pago ejecutado por Stripe aparecía en el
    // historial sin destino, que se lee como «no sabemos a dónde fue».
    if (
      provider === "dlocal" ||
      provider === "wise" ||
      provider === "stripe" ||
      provider === "banco-manual"
    )
      return cuenta ? `····${cuenta.bank_account_last4}` : null;
    if (provider === "simulated") return null;
    return destinoDe(provider)?.handle_masked ?? null;
  };

  /** El nombre de la vía. Los canales manuales lo sacan de su fila de catálogo. */
  const viaDelRiel = (provider: string | null): string =>
    provider ? (VIA[provider] ?? etiquetaDeCanal(provider)) : "Por decidir";

  /**
   * §5.1 (H-01) · EL AVISO DE ARRIBA, Y POR QUÉ TIENE DOS TEXTOS.
   *
   * ⚠️ «No elegiste tu método preferido» solo es verdad si HAY alguno que
   * elegir. Con saldo y ninguna cuenta completa —el estado real de tres de los
   * tutores de dev— el diagnóstico era falso y el botón peor: «Elegir método»
   * anclaba a una lista donde no se pinta ni una estrella, porque la estrella
   * vive en las cuentas completas. Un aviso sobre dinero que nombra una acción
   * inexistente es peor que no ponerlo.
   *
   * Y no se pinta cuando NO HAY NI UNA TARJETA (país sin determinar, o país sin
   * ninguna vía): ahí no hay nada que conectar y la propia sección de «Mis
   * cuentas» ya explica lo único que se puede hacer —la zona horaria, o
   * esperar—. Una caja roja permanente sin acción es ruido.
   */
  const hayAlgunaLista = tarjetas.some((t) => t.listo);
  const avisoDeSaldo =
    hasAvailable && !preferida && tarjetas.length > 0
      ? hayAlgunaLista
        ? {
            /**
             * 🔴 AQUÍ SE AMENAZABA CON ALGO QUE PASA IGUAL SI EL TUTOR OBEDECE.
             *
             * Decía: «El pago del lunes N saldrá «por decidir» hasta que elijas
             * uno». Es falso por partida doble, y las dos están medidas:
             *
             *   · `build_payout_for_tutor` deja `provider` a null A PROPÓSITO
             *     («lo escribe quien ejecute»), así que TODA orden nace sin riel
             *     y la columna dice «Por decidir» haya preferencia o no. Elegir
             *     método no cambia esa celda.
             *   · Sin preferencia el pago NO se bloquea: `ordenaPorPreferencia`
             *     devuelve la lista intacta y el enrutador paga igual, eligiendo
             *     el riel más barato que llegue a su país.
             *
             * Era una caja roja sobre dinero inventando una consecuencia para
             * forzar un clic. Ahora dice lo que de verdad gana el tutor al
             * elegir, y deja de ser una alarma.
             */
            titulo: `Tienes ${moneyLine(balance.available)} listos para cobrar`,
            detalle:
              "Si eliges tu cuenta preferida lo intentaremos por ahí primero; si no, elegimos nosotros la vía más barata que llegue a tu país.",
            boton: "Elegir método",
            urgente: false,
          }
        : {
            // Esta rama SÍ es urgente y su texto sí es cierto: sin ninguna
            // cuenta completa no hay riel que pueda ejecutar, y el dinero se
            // queda esperando de verdad.
            titulo: `Tienes ${moneyLine(balance.available)} listos y todavía no tienes dónde cobrarlos`,
            detalle: `El pago del lunes ${diaDelProximoLote()} no podrá salir hasta que completes una cuenta de cobro.`,
            boton: "Completar una cuenta",
            urgente: true,
          }
      : null;

  return (
    <TutorShell
      userId={userId}
      title="Mis pagos"
      description="Lo que ganas se libera 7 días después de cada mentoría y se paga cada lunes. También puedes retirarlo antes."
    >
      {/* §5.1 (H-01) · EL DINERO QUE NO SE VA A PAGAR, ANUNCIADO ARRIBA.

          Hasta hoy esto era una píldora ámbar en la tercera columna de «Cómo
          cobras»: el tutor tenía saldo listo, no había elegido método, y el
          lote del lunes iba a salir «Por decidir» sin que nada se lo dijera.
          Qué dice exactamente y cuándo se calla, arriba en `avisoDeSaldo`. */}
      {avisoDeSaldo ? (
        <PanelCard
          className={
            // Rojo solo cuando de verdad hay algo parado. La rama de «elige tu
            // preferida» es una sugerencia, no una alarma: pintarla igual que la
            // otra le quita el peso a la que sí importa.
            avisoDeSaldo.urgente
              ? "border-[1.5px] border-[#f0bfbf] bg-[#fff8f8]"
              : "border-[1.5px] border-[#e0e0e0] bg-muted"
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-[#19191f]">
                {avisoDeSaldo.titulo}
              </p>
              <p className="mt-1 text-[13px] leading-[1.55] text-[#4d4d4d]">
                {avisoDeSaldo.detalle}
              </p>
            </div>
            {/* Ancla, no ruta: lo que hay que hacer está en esta misma
                pantalla, sea elegir o sea conectar. */}
            <a
              href="#mis-cuentas"
              className="inline-flex h-11 shrink-0 items-center rounded-[8px] bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary/90"
            >
              {avisoDeSaldo.boton}
            </a>
          </div>
        </PanelCard>
      ) : null}

      {/* Cifras (203:42). El retiro va DENTRO de la tarjeta del saldo: es la
          acción de ese número, y tenerlo en un panel aparte lo separaba de lo
          único que lo explica.

          §5.2 · SIN TEXTO BAJO LOS MONTOS. Cada tile llevaba una línea con su
          regla («7 días desde que la mentoría se completa», «Suma de todas tus
          liquidaciones pagadas»): decía la norma, no el cuándo, y multiplicada
          por tres convertía la fila de cifras en un párrafo. La regla del plazo
          ya está en el subtítulo de la pantalla y la del lote en «Frecuencia».
          El retiro pasa de botón de texto a círculo azul junto al monto.

          ⚠️ Lo único que sí baja del monto es OTRA CIFRA, no una regla: el
          mismo importe en la moneda del tutor. Y solo en los dos que todavía no
          se han pagado — «Ya cobrado» se cambió el día que salió y a otra tasa,
          así que ahí sería un número inventado. Ver `enMonedaLocal`. */}
      <div id="saldo" className="grid scroll-mt-24 gap-4 sm:grid-cols-3">
        <PanelCard className="border-brand p-5">
          {/* ⚠️ `dl`/`dt`/`dd` y no dos `p` sueltos: rótulo y cifra son un par,
              y sin la relación semántica un lector de pantalla lee «Disponible
              para retirar» y «112,50 US$» como dos frases sin vínculo. Es lo
              mismo que ya hace «Cómo cobras» tres bloques más abajo. No cambia
              ni un píxel: el `dd` no trae sangría porque el preflight de
              Tailwind le quita el margen. */}
          <dl>
            <dt className="text-xs text-[#6b6b6b]">Disponible para retirar</dt>
            <dd className="mt-1.5 flex items-center justify-between gap-3">
              {/* El `title` solo cuando hay más de una moneda: es el único caso
                  en que la cifra puede no caber (el círculo se come 36 px del
                  tile) y un importe cortado sin forma de leerlo entero es peor
                  que uno que envuelve. Con una sola moneda sería un tooltip que
                  repite lo que ya se ve. */}
              <span
                className="min-w-0 truncate text-2xl font-bold tabular-nums text-[#19191f]"
                title={
                  balance.available.length > 1
                    ? moneyLine(balance.available)
                    : undefined
                }
              >
                {moneyLine(balance.available)}
              </span>
              {/* 🔑 SE MIRAN LAS DOS COSAS: que haya saldo Y que haya por dónde
                  pagarlo. Antes solo miraba el saldo, y eso creaba órdenes que
                  ningún riel podía ejecutar: se quedaban en 'scheduled' para
                  siempre, sin fallar y sin avisar a nadie. Es el mismo fallo
                  silencioso que documenta `riel-viable.ts`, un piso más arriba.

                  `hayAlgunaLista` ya está calculado unas líneas antes para
                  decidir el texto del aviso; aquí solo se reusa. */}
              <WithdrawButton
                disabled={!hasAvailable || !hayAlgunaLista}
                hasBalance={hasAvailable}
              />
            </dd>
            {/* El `title` es lo único que queda del párrafo que explicaba por
                qué esto no se puede prometer. Está donde lo encuentra quien se
                lo pregunte, y no delante de quien no. */}
            {enMonedaLocal(balance.available) ? (
              <dd
                className="mt-0.5 text-[13px] tabular-nums text-[#6b6b6b]"
                title="Aproximado: el cambio lo fija quien ejecute la transferencia el día que la haga."
              >
                {enMonedaLocal(balance.available)}
              </dd>
            ) : null}
          </dl>
        </PanelCard>
        <PanelCard className="p-5">
          <dl>
            <dt className="text-xs text-[#6b6b6b]">En retención</dt>
            <dd
              className="mt-1.5 truncate text-2xl font-bold tabular-nums text-[#19191f]"
              title={
                balance.in_retention.length > 1
                  ? moneyLine(balance.in_retention)
                  : undefined
              }
            >
              {moneyLine(balance.in_retention)}
            </dd>
            {enMonedaLocal(balance.in_retention) ? (
              <dd
                className="mt-0.5 text-[13px] tabular-nums text-[#6b6b6b]"
                title="Aproximado: el cambio lo fija quien ejecute la transferencia el día que la haga."
              >
                {enMonedaLocal(balance.in_retention)}
              </dd>
            ) : null}
          </dl>
        </PanelCard>
        <PanelCard className="p-5">
          <dl>
            <dt className="text-xs text-[#6b6b6b]">Ya cobrado</dt>
            <dd
              className="mt-1.5 truncate text-2xl font-bold tabular-nums text-[#19191f]"
              title={
                balance.paid_out.length > 1
                  ? moneyLine(balance.paid_out)
                  : undefined
              }
            >
              {moneyLine(balance.paid_out)}
            </dd>
          </dl>
        </PanelCard>
      </div>

      {/* Cómo cobras (204:54) — R29-03b. §5.3 renombra los cuatro rótulos:
          «País de pago · Frecuencia · Método preferido · Tu nivel». Los de
          antes («País de cobro», «Cuándo», «Forma preferida») decían lo mismo
          con palabras distintas de las del menú y del resto del panel. */}
      <PanelCard id="como-cobras" className="scroll-mt-24">
        <h2 className="text-base font-semibold text-[#19191f]">Cómo cobras</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <dt className="text-xs text-[#6b6b6b]">País de pago</dt>
            {/* ⚠️ AQUÍ HABÍA UN PÁRRAFO Y AHORA HAY UN ENLACE. Explicaba que el
                país sale de la zona horaria y que se cambia en la cuenta; tres
                líneas para decir algo que solo importa cuando el país está mal.
                Lo que NO se puede quitar es la salida: desde `20260908130000`
                el tutor no tiene grant sobre `payout_country`, así que sin este
                enlace uno con el país equivocado no tiene por dónde arreglarlo.
                La explicación cabe en el `title`; la acción, en una palabra.

                TODO · DP-6 — «¿se permite un país de pago distinto al de la
                zona horaria?». Hoy `20260908130000` lo DEDUCE de la zona, y por
                eso «Cambiar» lleva a `/account` y no abre un selector aquí. El
                día que la respuesta sea «sí», esto pasa a ser un campo propio y
                el `title` sobra. No se adelanta: un país de pago editable sin
                que la regla lo respalde rutearía el dinero a un riel que no
                llega. */}
            <dd className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-[#19191f]">
              {paisDeCobro ? (
                <>
                  {nombrePais(paisDeCobro)}
                  {familias.length === 0 ? (
                    <StatusPill tone="amber">Sin cobertura</StatusPill>
                  ) : null}
                </>
              ) : (
                <StatusPill tone="amber">Sin determinar</StatusPill>
              )}
              <a
                href="/account"
                title="Tu país de cobro sale de la zona horaria de tu perfil. Cámbiala en tu cuenta."
                className="text-[12px] font-semibold text-[#0068d0] underline underline-offset-2"
              >
                Cambiar
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Frecuencia</dt>
            {/* «Cada lunes» y no «Lote semanal, los lunes»: lo de «lote» es
                vocabulario nuestro, y el rótulo ya dice que es la frecuencia. */}
            <dd className="mt-1.5 text-sm text-[#19191f]">Cada lunes</dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Método preferido</dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[#19191f]">
              {preferida ? (
                <StatusPill tone="blue">
                  {tarjetas.find((t) => t.clave === preferida)?.nombre ?? preferida}
                </StatusPill>
              ) : (
                <StatusPill tone="amber">Sin elegir</StatusPill>
              )}
            </dd>
          </div>
          {/* N-16 — estas cifras ya son NETAS de comisión: sin el reparto, los
              importes no cuadran con lo que pagó el alumno. Etiqueta, no
              control: el nivel lo asigna el admin y el tutor no tiene grant
              sobre `tier_id`.

              ⚠️ Y SE FUE EL «Te quedas con el 75 %» DE AL LADO. §5.3 lo pide
              con todas las letras («el reparto de cada una en `title`; sin
              texto de ayuda») y la captura objetivo no lo tiene. Además estaba
              dicho dos veces en el mismo `dd`: como texto y como tooltip. Esto
              NO depende de AB-06 —el dato es el del propio tutor, y se sigue
              leyendo al posar el ratón sobre la píldora.

              ⚠️ TODO · AB-06 — §5.3 pide el nivel como ESCALERA DE TRES
              píldoras («Nivel 1 › Nivel 2 › Nivel 3», la actual en azul y las
              otras en gris, con el reparto de cada una en `title`). Se queda en
              una sola píldora, la real, y no por pereza: los otros dos escalones
              hoy no se pueden pintar sin inventarlos, por DOS motivos a la vez.

                1 · Los NOMBRES son la propia AB-06, sin respuesta del cliente.
                    El dato real ni siquiera dice «Nivel»: el seed de
                    `20260715170000` los llama «Tier 1/2/3», que es lo que
                    saldría en pantalla.
                2 · Los porcentajes de los otros dos no se pueden leer.
                    `tutor_tiers_select_own` deja al tutor ver SOLO el suyo
                    (`tp.tier_id = tutor_tiers.id`), así que un «85 %» y un
                    «90 %» aquí serían el seed copiado a mano — un número de
                    dinero escrito en el TSX, que es justo lo que la regla de
                    oro 5 impide en el esquema y no tiene por qué valer en la
                    vista. Abrir esa lectura es una migración, y este lote no
                    lleva ninguna.

              Cuando lleguen las dos cosas, la escalera se pinta aquí sin tocar
              nada más: son tres píldoras sobre la lista de `tutor_tiers`. */}
          {tier ? (
            <div>
              <dt className="text-xs text-[#6b6b6b]">Tu nivel</dt>
              <dd className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#19191f]">
                <StatusPill
                  tone="blue"
                  title={`Te quedas con el ${formatPct(tier.splitPct)} de cada reserva.`}
                >
                  {tier.name}
                </StatusPill>
              </dd>
            </div>
          ) : null}
        </dl>

      </PanelCard>

      {/* 🔑 Las cuentas de cobro.

          §5.4 · «Cómo quieres cobrar» → «Mis cuentas», el mismo nombre que su
          subnivel del menú: el tutor buscaba en la pantalla el rótulo que
          acababa de pulsar y no estaba. Y con el radio fuera, el título ya no
          describe una elección sino un sitio, que es lo que es. */}
      <PanelCard id="mis-cuentas" className="scroll-mt-24">
        <h2 className="text-base font-semibold text-[#19191f]">Mis cuentas</h2>

        {fallaLaCuenta ? (
          <p className="mt-2 max-w-[620px] text-[13px] font-medium text-[#bf3333]">
            No hemos podido leer tus datos de cobro ahora mismo. Vuelve a cargar
            la página; si sigue igual, escríbenos antes de volver a rellenarlos —
            lo que tengas guardado sigue estando.
          </p>
        ) : !paisDeCobro ? (
          <p className="mt-2 max-w-[70ch] text-[13px] leading-[1.6] text-[#4d4d4d]">
            Todavía no sabemos desde dónde cobras. Configura tu zona horaria en{" "}
            <a
              href="/account"
              className="font-semibold text-[#0068d0] underline underline-offset-2"
            >
              tu cuenta
            </a>{" "}
            y aquí te enseñaremos las formas de cobro que llegan a tu país. Tu
            saldo se sigue acumulando mientras tanto.
          </p>
        ) : tarjetas.length === 0 ? (
          <p className="mt-2 max-w-[70ch] text-[13px] leading-[1.6] text-[#4d4d4d]">
            Hoy no tenemos ninguna vía para hacerte llegar dinero a{" "}
            {nombrePais(paisDeCobro)}, así que no te pedimos datos que no
            íbamos a poder usar. <strong>Sigues vendiendo igual y tu saldo se
            sigue acumulando</strong>: te avisaremos en cuanto se abra.
            {cuenta
              ? ` Los datos de ${nombrePais(cuenta.country)} que registraste siguen guardados.`
              : ""}
            {destinos.length > 0
              ? ` Las formas de cobro que registraste (${destinos.map((d) => etiquetaDeCanal(d.channel)).join(", ")}) siguen guardadas.`
              : ""}
          </p>
        ) : (
          <>
            {/* ⚠️ UNA LÍNEA, Y SOLO PORQUE LA ESTRELLA NO SE EXPLICA SOLA.
                Aquí hubo un párrafo de tres frases que describía lo que se veía
                («se elige una», «estas están completas»); se fue. Lo que sí
                hace falta ahora es decir qué significa el icono nuevo, porque
                una estrella puede ser un favorito, una valoración o un
                destacado. Es el subtítulo que fija §5.4. */}
            <p className="mt-1 text-[13px] leading-[1.6] text-[#4d4d4d]">
              Conecta las que quieras; la estrella marca la predeterminada.
            </p>
            <MetodosDeCobro
              tarjetas={tarjetas}
              preferida={preferida}
              formularios={formularios}
              acciones={acciones}
            />
          </>
        )}
      </PanelCard>

      {/* Movimientos (204:2 + 204:23, en una sola tabla). §5.5 le añade las dos
          columnas que faltaban para poder CONCILIAR (N-27): a qué cuenta suya
          fue el dinero, y de qué reservas se compone el importe. */}
      <PanelCard id="movimientos" className="scroll-mt-24">
        <h2 className="text-base font-semibold text-[#19191f]">Movimientos</h2>
        {movimientos.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#6b6b6b]">
            Aquí verás cada liquidación con la vía por la que salió y las
            reservas que la componen. Todavía no tienes ninguna.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse">
              <thead>
                <tr>
                  {["Fecha", "Vía · destino", "Reservas", "Estado", "Importe"].map(
                    (h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={`border-b border-[#e0e0e0] pb-2.5 pr-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6b6b6b] ${
                          i === 4 ? "pr-0 text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {movimientos.map((p) => {
                  const b = PAYOUT_BADGE[p.status];
                  const programado = UPCOMING.has(p.status);
                  const destino = destinoDelRiel(p.provider);
                  const reservas = reservasPorPayout.get(p.id) ?? [];
                  return (
                    <tr key={p.id}>
                      <td className="border-b border-[#efefef] py-3.5 pr-3 align-top text-[13px] text-[#19191f]">
                        {fmtDate(p.paid_at ?? p.scheduled_for ?? p.created_at)}
                        {programado ? (
                          <span className="mt-0.5 block text-[11.5px] text-[#6b6b6b]">
                            {p.scheduled_for ? "Programado" : "En cola"}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="border-b border-[#efefef] py-3.5 pr-3 align-top text-[13px] text-[#4d4d4d]"
                        title={
                          destino
                            ? "La cuenta que tienes registrada hoy para esta vía."
                            : undefined
                        }
                      >
                        {/* Un `provider` a null es una orden que todavía no ha
                            elegido riel: se dice, no se inventa una vía. Y el
                            destino solo se pinta cuando lo hay — con Stripe no
                            lo hay nunca, porque esas coordenadas se las quedan
                            ellos. */}
                        {viaDelRiel(p.provider)}
                        {destino ? (
                          <span className="tabular-nums"> · {destino}</span>
                        ) : null}
                      </td>
                      <td className="border-b border-[#efefef] py-3.5 pr-3 align-top text-[13px]">
                        {/* ⚠️ CERO NO ES «CERO RESERVAS». Si la lectura de
                            `payout_items` falló, o si esta orden todavía no
                            tiene líneas, poner «0 reservas» junto a un importe
                            sería la mentira creíble de la regla de oro 10. */}
                        {reservas.length === 0 ? (
                          <span className="text-[#6b6b6b]">—</span>
                        ) : (
                          <details className="group">
                            {/* ⚠️ 40 px DE ALTO SIN MOVER LA FILA. El texto solo
                                mide 19,5 px y era el objetivo táctil más
                                pequeño de la pantalla (los botones de «Mis
                                cuentas» miden 44 y el círculo de retiro 36).
                                Los márgenes negativos devuelven la caja a su
                                sitio, así que crece el área que se puede pulsar
                                y no la altura de la tabla. */}
                            <summary className="-my-2.5 inline-flex min-h-[40px] cursor-pointer list-none items-center font-semibold text-[#0068d0] marker:content-none">
                              {reservas.length}{" "}
                              {reservas.length === 1 ? "reserva" : "reservas"}
                              <span
                                aria-hidden
                                className="ml-1 inline-block transition-transform group-open:rotate-180"
                              >
                                ▾
                              </span>
                            </summary>
                            <ul className="mt-2 grid gap-1.5">
                              {reservas.map((r) => (
                                <li
                                  key={`${p.id}-${r.ref}-${r.amount}`}
                                  className="text-[12.5px] leading-[1.45] text-[#4d4d4d]"
                                >
                                  <span className="font-semibold tabular-nums text-[#19191f]">
                                    {r.ref}
                                  </span>{" "}
                                  · {r.titulo} ·{" "}
                                  <span className="tabular-nums">
                                    {formatMoney(r.amount, p.currency)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="border-b border-[#efefef] py-3.5 pr-3 align-top">
                        <StatusPill tone={PAYOUT_PILL[p.status] ?? "neutral"}>
                          {b.label}
                        </StatusPill>
                      </td>
                      <td className="border-b border-[#efefef] py-3.5 text-right align-top text-[13px] font-semibold tabular-nums text-[#19191f]">
                        {formatMoney(p.amount, p.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </TutorShell>
  );
}
