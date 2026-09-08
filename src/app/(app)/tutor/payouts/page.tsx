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
import { avisoDeImporteAproximado } from "@/lib/payments/dlocal-provider";
import { WithdrawButton } from "./withdraw-button";
import { PayoutAccountForm } from "./payout-account-form";
import { cuentaConectadaLista } from "@/lib/stripe";
import { ConnectAlta } from "./connect-alta";
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

export const metadata = { title: "Payouts · Enséñame Ya" };

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
 * ⚠️ dLocal y Wise dicen lo MISMO, y no es una omisión: los dos le ingresan en
 * su cuenta bancaria y qué corresponsal usamos nosotros no es información suya.
 * Es la misma decisión que hace que la lista de arriba tenga UNA tarjeta de
 * banco y no dos.
 *
 * Cierra el hueco que el Figma pedía (204:23, «Transferencia bancaria · DLocal»)
 * y que este fichero llevaba marcado como «llega con el PSP real (EP-20)»:
 * `payouts.provider` tiene `grant select` para `authenticated` desde que existe.
 */
const VIA: Record<string, string> = {
  stripe: "Cuenta bancaria vía Stripe",
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

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

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
 *     el enrutador decidía solo; ahora hay un radiogroup y su elección vive en
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
 * 4 · **Una tarjeta por MÉTODO, no por familia de dato.** dLocal y Wise leen la
 *     misma fila de `tutor_payout_accounts` y le ingresan en la misma cuenta:
 *     son una sola tarjeta. Los canales manuales, en cambio, son uno por
 *     tarjeta, porque para el tutor Zinli y Zelle son dos sitios distintos.
 */
export default async function TutorPayoutsPage() {
  // Mismo guard que el resto del panel: fila en `tutor_profiles`. Con
  // `requireRole("tutor")` un tutor aprobado sin el rol concedido (o uno
  // pendiente, al que el menú ya le ofrece Payouts) rebotaba a /app.
  const { userId } = await requireTutorProfile();

  const supabase = await createClient();
  const [
    { data: balanceData },
    { data: payouts },
    tier,
    { data: perfil },
    { data: reglas, error: errorReglas },
    { data: cuentaData, error: errorCuenta },
    { data: canalesData, error: errorCanales },
    { data: destinosData, error: errorDestinos },
    { data: prefData, error: errorPref },
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
      .from("tutor_profiles")
      .select("payout_country, stripe_connect_account_id")
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("payout_country_rules")
      .select(
        "country, currency, account_label, account_help, account_types, account_patterns, document_patterns, requires_branch, branch_pattern, wise_account_type",
      ),
    supabase
      .from("tutor_payout_accounts")
      .select(
        "country, beneficiary_first_name, beneficiary_last_name, beneficiary_document_type, bank_code, bank_account_last4, bank_account_type, bank_branch, updated_at, beneficiary_address_line, beneficiary_city, beneficiary_postcode, beneficiary_phone",
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
  ]);

  const balance = balanceData as unknown as TutorBalance;
  const hasAvailable = balance.available.length > 0;

  const paisDeCobro = perfil?.payout_country ?? null;

  // 🔑 Lo que se puede hacer por ESTE país, preguntándoselo al enrutador. Va en
  // segunda vuelta porque depende de `payout_country`, que sale de la consulta
  // de arriba.
  const { rieles, familias: familiasDelPais } = await rielesDelPais(paisDeCobro);

  /**
   * ¿Puede la cuenta conectada del tutor recibir YA?
   *
   * ⚠️ NO SE DEDUCE DE TENER UN `acct_…` GUARDADO: un tutor con el alta
   * TERMINADA veía «Alta en Stripe» y un botón que le ofrecía «continuar» algo
   * que ya había acabado. Quien lo sabe es Stripe, así que se le pregunta — una
   * llamada, y solo si hay cuenta que preguntar.
   */
  const cuentaConectada = perfil?.stripe_connect_account_id ?? null;
  const connectLista = cuentaConectada
    ? (await cuentaConectadaLista(cuentaConectada)).lista
    : false;

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

  // La regla del país. Son las nueve filas de `payout_country_rules`
  // (AR BR CL CO EC MX PE PY UY); Venezuela no está ni va a estar, y España
  // todavía no —el día que tenga una con `wise_account_type='iban'`, la tarjeta
  // de banco aparece sola sin tocar este fichero.
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
  const pideBanco = familias.includes("banco");

  // El catálogo de bancos, solo del país que toca y solo si hace falta: son
  // hasta 213 filas (Ecuador), y traer los 612 de los ocho países para enseñar
  // uno sería mandar el catálogo entero al navegador en cada visita.
  const { data: bancosData } =
    pideBanco && regla
      ? await supabase
          .from("payout_banks")
          .select("bank_code, name, rejects_cpf")
          .eq("country", regla.country)
          .order("name")
      : { data: null };
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

  /**
   * ⚠️ EL DIFERENCIAL DE CAMBIO LO ASUME EL TUTOR (decisión del cliente,
   * 2-sep-2026), y por eso esto se dice en la tarjeta y no en un anexo.
   *
   * `POST /v1/payouts` de dLocal Go no tiene moneda de origen: el importe va
   * SIEMPRE en la de destino, así que hay que fijar o lo que recibe el tutor o
   * lo que sale de nuestro balance, nunca las dos. Se fija lo segundo, y la
   * cantidad en moneda local la determina el cambio del día. El texto sale del
   * DATO (`payout_country_rules.currency`): en Ecuador esa columna es 'USD' y
   * `avisoDeImporteAproximado` devuelve `null` sin que nadie escriba «si es EC».
   */
  const avisoDeCambio =
    pideBanco && regla
      ? avisoDeImporteAproximado(MONEDA_DEL_SALDO, regla.currency)
      : null;

  const cuentaDeEstePais = cuenta !== null && cuenta.country === paisDeCobro;
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
        descripcion: `A tu cuenta en ${nombrePais(paisDeCobro!)}, en ${regla?.currency ?? MONEDA_DEL_SALDO}${avisoDeCambio ? " (importe aproximado)" : ""}.`,
        automatico: m.automatico,
        listo: cuentaDeEstePais,
        detalle: cuentaDeEstePais
          ? `${nombreDelBanco ?? cuenta!.bank_code} · ····${cuenta!.bank_account_last4}`
          : cuenta
            ? `Tienes datos de ${nombrePais(cuenta.country)} guardados, pero a ${nombrePais(paisDeCobro!)} no llega esa transferencia.`
            : null,
        // El aviso del cambio se va al formulario: es una condición que hay que
        // leer ANTES de registrar nada, y abrir el formulario ES antes. En la
        // tarjeta se queda el «(importe aproximado)» de la línea de arriba, que
        // es lo que hace falta para comparar métodos.
        aviso: null,
        subtarea: faltaDireccion
          ? "Con tu dirección y tu teléfono se abre una segunda ruta a esta misma cuenta, que nos sale más barata. Sin ellos te seguimos pagando igual."
          : null,
        conectar: false,
      };
    }

    if (m.clave === "stripe") {
      return {
        clave: "stripe",
        nombre: "Cuenta bancaria vía Stripe",
        logo: LOGOS.stripe ?? null,
        monograma: "ST",
        descripcion: "Te das de alta en Stripe y ellos te ingresan en tu banco.",
        automatico: m.automatico,
        listo: connectLista,
        detalle: connectLista
          ? "Alta terminada · tu cuenta puede recibir pagos"
          : cuentaConectada
            ? "Alta empezada · te falta terminarla en Stripe"
            : null,
        aviso: null,
        subtarea: null,
        // Con Connect no hay formulario que pintar: el tutor le da sus
        // coordenadas a Stripe, no a nosotros.
        conectar: true,
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
   * `children`. El radiogroup es de cliente y no puede construirlos: necesitan
   * el catálogo de bancos, las reglas del país y los nombres resueltos.
   */
  const formularios: Record<string, React.ReactNode> = {};
  /** La acción de los que se conectan: su botón, sin recuadro ni párrafo. */
  const acciones: Record<string, React.ReactNode> = {};
  for (const m of metodos) {
    if (m.clave === "banco" && regla && paisDeCobro) {
      formularios.banco = (
        <>
          <p className="mt-3 max-w-[62ch] text-[12.5px] leading-[1.55] text-[#4d4d4d]">
            Tienen que ser los de una cuenta a tu nombre en{" "}
            {nombrePais(paisDeCobro)}: el titular y el documento se comprueban
            contra el banco, y si no coinciden la transferencia se rechaza.
          </p>
          {/* La condición del cambio, aquí y no en la tarjeta: es lo que hay
              que leer antes de registrar coordenadas, y este es el momento. */}
          {avisoDeCambio ? (
            <p className="mt-2 max-w-[62ch] rounded-[8px] border border-[#e8d5a8] bg-[#fdf7e6] p-3 text-[12.5px] leading-[1.55] text-[#19191f]">
              {avisoDeCambio}
            </p>
          ) : null}
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
          etiquetaPais={nombrePais(paisDeCobro)}
            etiquetaPaisGuardado={cuenta ? nombrePais(cuenta.country) : null}
          />
        </>
      );
    } else if (m.clave === "stripe") {
      acciones.stripe = (
        <ConnectAlta
          yaTieneCuenta={Boolean(cuentaConectada)}
          lista={connectLista}
          esLaUnicaVia={metodos.length === 1}
          compacto
        />
      );
    } else if (m.clave === "paypal") {
      // ⚠️ NI UN CAMPO DE CORREO. Aquí se pintaba `PayoutManualForm` debajo del
      // botón «por si no quiere conectar», y eso era ofrecerle la vía que NO
      // entrega: cuatro pagos a un correo tecleado, cuatro `UNCLAIMED`
      // (medido el 4-sep-2026). La tarjeta de PayPal es un botón.
      acciones.paypal = (
        <PaypalConectar
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

  return (
    <TutorShell
      title="Payouts"
      description="Lo que ganas se libera 7 días después de cada mentoría y se paga en el lote de los lunes. También puedes retirarlo antes."
    >
      {/* Cifras (203:42). El retiro va DENTRO de la tarjeta del saldo: es la
          acción de ese número, y tenerlo en un panel aparte lo separaba de lo
          único que lo explica. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PanelCard className="border-brand p-5">
          <p className="text-xs text-[#6b6b6b]">Disponible para retirar</p>
          <p className="mt-1.5 truncate text-2xl font-bold tabular-nums text-[#19191f]">
            {moneyLine(balance.available)}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-[#6b6b6b]">
              {hasAvailable ? "Ya liberado" : "Nada liberado todavía"}
            </span>
            <WithdrawButton disabled={!hasAvailable} />
          </div>
        </PanelCard>
        <PanelCard className="p-5">
          <p className="text-xs text-[#6b6b6b]">En retención</p>
          <p className="mt-1.5 truncate text-2xl font-bold tabular-nums text-[#19191f]">
            {moneyLine(balance.in_retention)}
          </p>
          <p className="mt-1.5 text-xs text-[#6b6b6b]">
            7 días desde que la mentoría se completa
          </p>
        </PanelCard>
        <PanelCard className="p-5">
          <p className="text-xs text-[#6b6b6b]">Ya cobrado</p>
          <p className="mt-1.5 truncate text-2xl font-bold tabular-nums text-[#19191f]">
            {moneyLine(balance.paid_out)}
          </p>
          <p className="mt-1.5 text-xs text-[#6b6b6b]">
            Suma de todas tus liquidaciones pagadas
          </p>
        </PanelCard>
      </div>

      {/* Cómo cobras (204:54) — R29-03b. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">Cómo cobras</h2>
        <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
          <div>
            <dt className="text-xs text-[#6b6b6b]">País de cobro</dt>
            <dd className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[#19191f]">
              {paisDeCobro ? (
                <>
                  {nombrePais(paisDeCobro)}
                  {familias.length === 0 ? (
                    <>
                      {" "}
                      <StatusPill tone="amber">Sin cobertura</StatusPill>
                    </>
                  ) : null}
                </>
              ) : (
                <StatusPill tone="amber">Sin determinar</StatusPill>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Cuándo</dt>
            <dd className="mt-1.5 text-sm text-[#19191f]">
              Lote semanal, los lunes
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Forma preferida</dt>
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
              sobre `tier_id`. */}
          {tier ? (
            <div>
              <dt className="text-xs text-[#6b6b6b]">Tu nivel</dt>
              <dd className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#19191f]">
                <StatusPill tone="blue">{tier.name}</StatusPill>
                <span>Te quedas con el {formatPct(tier.splitPct)}</span>
              </dd>
            </div>
          ) : null}
        </dl>

        {/* A0 · EL PAÍS YA NO SE ELIGE AQUÍ, y decir de dónde sale no es un
            detalle de cortesía: es lo que convierte un dato que el tutor no
            puede tocar en uno que sí, porque le enseña dónde se toca.

            ⚠️ El `border-t` va en el DIV, no en el `<p>`. Estaba en el párrafo,
            que lleva `max-w-[70ch]`: la línea medía lo que medía el texto y se
            cortaba a dos tercios de la tarjeta, como si el bloque estuviera
            roto. El ancho máximo es para LEER; el separador separa la tarjeta
            entera. */}
        <div className="mt-4 border-t border-[#e0e0e0] pt-4">
        <p className="max-w-[70ch] text-[13px] leading-[1.6] text-[#4d4d4d]">
          Tu país de cobro sale de la zona horaria de tu perfil, la misma con la
          que publicas tus horarios, así que no hay nada que rellenar aquí.{" "}
          <a
            href="/account"
            className="font-semibold text-[#0068d0] underline underline-offset-2"
          >
            Si no es donde cobras, cámbiala en tu cuenta
          </a>
          .
        </p>
        </div>
      </PanelCard>

      {/* 🔑 El radiogroup. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Cómo quieres cobrar
        </h2>

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
            <p className="mt-2 max-w-[72ch] text-[13px] leading-[1.6] text-[#4d4d4d]">
              Elige por dónde quieres que te paguemos y rellena sus datos.{" "}
              <strong className="font-semibold text-[#19191f]">
                Con una basta
              </strong>
              ; si dejas más de una completa, nos queda alternativa el día que la
              primera no sirva. Puedes cambiar de opinión cuando quieras.
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

      {/* Movimientos (204:2 + 204:23, en una sola tabla). */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">Movimientos</h2>
        {movimientos.length === 0 ? (
          <p className="mt-3 text-[13px] text-[#6b6b6b]">
            Aquí verás cada liquidación con la vía por la que salió. Todavía no
            tienes ninguna.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  {["Fecha", "Vía", "Estado", "Importe"].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={`border-b border-[#e0e0e0] pb-2.5 pr-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6b6b6b] ${
                        i === 3 ? "pr-0 text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movimientos.map((p) => {
                  const b = PAYOUT_BADGE[p.status];
                  const programado = UPCOMING.has(p.status);
                  return (
                    <tr key={p.id}>
                      <td className="border-b border-[#efefef] py-3.5 pr-3 text-[13px] text-[#19191f] last:border-b-0">
                        {fmtDate(p.paid_at ?? p.scheduled_for ?? p.created_at)}
                        {programado ? (
                          <span className="mt-0.5 block text-[11.5px] text-[#6b6b6b]">
                            {p.scheduled_for ? "Programado" : "En cola"}
                          </span>
                        ) : null}
                      </td>
                      <td className="border-b border-[#efefef] py-3.5 pr-3 text-[13px] text-[#4d4d4d]">
                        {/* Un `provider` a null es una orden que todavía no ha
                            elegido riel: se dice, no se inventa una vía. */}
                        {p.provider ? (VIA[p.provider] ?? p.provider) : "Por decidir"}
                      </td>
                      <td className="border-b border-[#efefef] py-3.5 pr-3">
                        <StatusPill tone={PAYOUT_PILL[p.status] ?? "neutral"}>
                          {b.label}
                        </StatusPill>
                      </td>
                      <td className="border-b border-[#efefef] py-3.5 text-right text-[13px] font-semibold tabular-nums text-[#19191f]">
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
