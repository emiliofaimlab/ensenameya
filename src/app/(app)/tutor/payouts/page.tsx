import { CheckIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/catalog/format";
import { payoutCountries } from "@/lib/payments";
import { PAYOUT_BADGE, nombrePais, type TutorBalance } from "@/lib/payouts";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { avisoDeImporteAproximado } from "@/lib/payments/dlocal-provider";
import { WithdrawButton } from "./withdraw-button";
import { PayoutCountryForm } from "./payout-country-form";
import { PayoutAccountForm } from "./payout-account-form";
import { ConnectAlta } from "./connect-alta";
import { PaypalConectar } from "./paypal-conectar";
import { PayoutManualForm } from "./payout-manual-form";
import { leerCanalesManuales, leerDestinosManuales } from "./rpc";
import {
  estadoDeLaCuenta,
  type BancoDePais,
  type CanalManual,
  type CuentaEnmascarada,
  type DestinoManualEnmascarado,
  type ReglaDePais,
  type RielDeCobro,
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

/** Estados que el Figma lista como "Próximos payouts" (204:2). */
const UPCOMING = new Set(["scheduled", "processing", "pending"]);

/**
 * La moneda en la que llevamos el saldo del tutor y en la que se crean los
 * `payouts`. Es una constante y no una lectura porque hoy `payouts.currency` es
 * USD en las diez filas de ruteo, y porque el adaptador de dLocal Go reserva su
 * estado `sin-decidir` justamente para el día que deje de serlo (solo publica
 * pares DESDE dólar en `/v1/currency-exchanges`). Vive aquí para que el aviso de
 * cambio de abajo no la escriba dos veces.
 */
const MONEDA_DEL_SALDO = "USD";

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
 * US-1001 (SCR-TU09) — payouts del tutor: cifras, próximos y el historial,
 * con el layout del Figma. `tutor_balance` agrega disponible / retención /
 * pagado. US-1004: retiro self-service (RN-40).
 *
 * ── LA CUENTA DE COBRO, QUE AQUÍ SE DIJO DOS VECES Y LAS DOS MAL ────────────
 *
 * Primero se dio por hecho que «el tutor la registrará en el onboarding del
 * proveedor, así que no hay columna ni la va a haber»: premisa de Stripe
 * Connect, donde el beneficiario vive en el proveedor. Con dLocal Go —que es
 * quien de verdad puede pagar en LATAM— NO: `POST /v1/payouts` no guarda
 * beneficiarios y los datos bancarios viajan enteros en CADA llamada.
 *
 * Después (A0) se dijo que eso llegaría «cuando el proveedor de pagos quede
 * activo». Es B1 y llega ahora, porque el sandbox de dLocal Go es de alta libre:
 * lo que bloqueaba no era la cuenta, era no tener dónde guardar los datos.
 *
 * Viven en `tutor_payout_accounts` (`20260901160000`), tabla propia y no una
 * columna en `tutor_profiles` — que tiene `grant select` a `anon` y publica la
 * fila entera de cualquier tutor aprobado. La pantalla NO enseña el número de
 * cuenta al volver: enseña `····1234`, porque las columnas sensibles no tienen
 * `grant select` para ningún rol y PostgREST no puede devolverlas.
 *
 * El orden de los dos bloques de abajo no es estético: el país decide QUÉ
 * CAMPOS existen y cómo se validan (AR pide CBU, MX pide CLABE), así que sin
 * `payout_country` declarado el formulario bancario no se abre. R29-03b sigue en
 * pie: se dice en qué estado está el cobro, sin pintar un "Banco BBVA ····1234"
 * que no existe.
 */
export default async function TutorPayoutsPage() {
  // Mismo guard que el resto del panel: fila en `tutor_profiles`. Con
  // `requireRole("tutor")` un tutor aprobado sin el rol concedido (o uno
  // pendiente, al que el menú ya le ofrece Payouts) rebotaba a /app. La RPC
  // `tutor_balance` y la RLS de `payouts` ya limitan a lo propio.
  const { userId } = await requireTutorProfile();

  const supabase = await createClient();
  const [
    { data: balanceData },
    { data: payouts },
    tier,
    { data: perfil },
    servibles,
    { data: reglas, error: errorReglas },
    { data: cuentaData, error: errorCuenta },
    { data: canalesData, error: errorCanales },
    { data: destinosData, error: errorDestinos },
  ] = await Promise.all([
    supabase.rpc("tutor_balance"),
    supabase
      .from("payouts")
      .select("id, status, currency, amount, scheduled_for, paid_at, created_at")
      .order("created_at", { ascending: false }),
    // N-16: aquí es donde el tutor viene a mirar cuánto cobra, así que aquí es
    // donde tiene que estar el reparto que produjo esas cifras.
    tutorTier(supabase, userId),
    // A0 · dónde cobra (`null` = no lo ha declarado). Con el cliente del
    // propio tutor: `tutor_profiles_select_own` ya le deja ver su fila y
    // `service_role` no tiene grant sobre esta tabla (regla de oro 9).
    supabase
      .from("tutor_profiles")
      .select("payout_country, stripe_connect_account_id")
      .eq("profile_id", userId)
      .maybeSingle(),
    // Y a dónde podemos transferir de verdad, según `payment_routing_rules`.
    payoutCountries(),
    // B1 · qué exige dLocal Go en cada país. Se traen las 8 filas de golpe y
    // se elige aquí, en vez de filtrar por el país del tutor: son 8 filas y
    // filtrar obligaría a esperar a la consulta del perfil para lanzar esta.
    // No es PII —es documentación de dLocal— y por eso `authenticated` la lee.
    supabase
      .from("payout_country_rules")
      .select(
        "country, currency, account_label, account_help, account_types, account_patterns, document_patterns, requires_branch, branch_pattern",
      ),
    // B1 · lo que el tutor tiene guardado, ENMASCARADO. Las columnas se nombran
    // una a una y no por `*` a propósito: `bank_account` y
    // `beneficiary_document` no tienen `grant select` para ningún rol, así que
    // un `select=*` aquí devolvería 42501. Que la lista sea explícita es lo que
    // hace visible dónde está la frontera.
    supabase
      .from("tutor_payout_accounts")
      .select(
        "country, beneficiary_first_name, beneficiary_last_name, beneficiary_document_type, bank_code, bank_account_last4, bank_account_type, bank_branch, updated_at",
      )
      .eq("tutor_id", userId)
      .maybeSingle(),
    // C2m · el riel MANUAL, que es el otro sitio donde puede vivir «a dónde
    // cobra este tutor». Se piden las dos cosas siempre y no solo cuando el país
    // declarado es de riel manual, por lo mismo que arriba: sin ellas no se
    // podría decir «los datos que registraste siguen guardados» a quien cambió
    // de país después de meterlos. Son cinco filas de catálogo y como mucho
    // cinco de destinos.
    leerCanalesManuales(supabase),
    leerDestinosManuales(supabase, userId),
  ]);

  const balance = balanceData as unknown as TutorBalance;
  const hasAvailable = balance.available.length > 0;
  const upcoming = (payouts ?? []).filter((p) => UPCOMING.has(p.status));
  const history = (payouts ?? []).filter((p) => !UPCOMING.has(p.status));

  const paisDeCobro = perfil?.payout_country ?? null;
  /**
   * Lo que ofrece el desplegable. Si el tutor tiene declarado un país que hoy ya
   * no es servible —porque alguien desactivó su regla—, se conserva en la lista:
   * quitarlo dejaría el `<select>` en blanco y le diría «no has declarado nada»
   * a quien sí declaró. Que siga viéndolo es también la única pista de que sus
   * mentorías han dejado de poder venderse.
   */
  const codigosServibles = servibles.map((p) => p.code);
  const paisesOfrecidos = (
    paisDeCobro && !codigosServibles.includes(paisDeCobro)
      ? [...codigosServibles, paisDeCobro]
      : codigosServibles
  ).map((code) => ({ code, label: nombrePais(code) }));

  /**
   * B1 · el bloque de datos bancarios.
   *
   * ⚠️ Se miran los `error`, no solo los `data` (regla de oro 10). Un
   * `const { data } = …` convierte un fallo de permisos en `null`, y `null`
   * aquí significa «no has registrado nada» — que es una mentira creíble y
   * exactamente la que dejó la cola de aprobación del admin enseñando «(0)»
   * con 11 tutores dentro. Si esta consulta falla, el tutor tiene que ver que
   * falló, no un formulario vacío que sobrescribiría lo que sí tiene guardado.
   */
  const cuenta = (cuentaData ?? null) as CuentaEnmascarada | null;
  const canales = canalesData as CanalManual[];
  const destinos = destinosData as DestinoManualEnmascarado[];
  const fallaLaCuenta = Boolean(
    errorCuenta ?? errorReglas ?? errorCanales ?? errorDestinos,
  );

  /**
   * C2m · LA CLASE DE RIEL DEL PAÍS DECLARADO — quién le paga y, por tanto, qué
   * formulario se pinta.
   *
   * Sale de `payoutCountries()`, que lo deriva de
   * `payment_routing_rules.payout_provider`, y NO de una lista de países aquí:
   * ese es el mismo compromiso que hace que el formulario bancario no tenga un
   * solo `if (pais === 'MX')`. Venezuela es «manual» porque su fila lo dice
   * (`20260902150000`), y el día que se abra otro país sin banco lo será sin
   * tocar este fichero.
   *
   * ⚠️ `null` no significa «no tiene riel»: significa que hoy no podemos pagar
   * allí de ninguna manera —regla desactivada, o un valor que el enrutador no
   * reconoce— y entonces no se pide ningún dato, porque no se iba a poder usar.
   */
  const rielDeclarado: RielDeCobro | null = paisDeCobro
    ? (servibles.find((p) => p.code === paisDeCobro)?.dato ?? null)
    : null;

  // La regla del país DECLARADO. Si el tutor no ha declarado ninguno no hay
  // formulario que pintar: el país decide qué campos existen. Solo tiene sentido
  // buscarla para el riel bancario: `payout_country_rules` son las ocho filas de
  // dLocal, y Venezuela no está ni va a estar.
  const regla =
    (rielDeclarado === "banco" && paisDeCobro
      ? ((reglas ?? []) as ReglaDePais[]).find((r) => r.country === paisDeCobro)
      : undefined) ?? null;

  /**
   * El riel EFECTIVO. Un país marcado como bancario en la tabla de ruteo pero
   * sin fila en `payout_country_rules` es una incoherencia de datos, no un
   * formulario: no sabemos qué campos pedirle ni con qué validarlos, así que se
   * trata como «todavía no podemos pagar allí» en vez de enseñar un desplegable
   * de bancos vacío. El riel manual no depende de esa tabla y por eso pasa tal
   * cual.
   */
  const riel: RielDeCobro | null =
    rielDeclarado === "banco" && !regla ? null : rielDeclarado;

  // El catálogo de bancos, solo del país que toca. Va en una segunda vuelta
  // porque depende del país, y son hasta 213 filas (Ecuador): traer los 612 de
  // los ocho países para enseñar uno sería mandar el catálogo entero al
  // navegador en cada visita.
  const { data: bancosData } = regla
    ? await supabase
        .from("payout_banks")
        .select("bank_code, name, rejects_cpf")
        .eq("country", regla.country)
        .order("name")
    : { data: null };
  const bancos = (bancosData ?? []) as BancoDePais[];

  /** `channel` → `label`. Incluye los canales apagados, a propósito: un destino
      registrado en uno que Legal cerró ayer tiene que seguir teniendo nombre. */
  const etiquetaDeCanal = (channel: string) =>
    canales.find((c) => c.channel === channel)?.label ?? channel;

  const estadoCuenta = estadoDeLaCuenta({
    paisDeclarado: paisDeCobro,
    riel,
    cuenta,
    nombreDelBanco:
      bancos.find((b) => b.bank_code === cuenta?.bank_code)?.name ?? null,
    destinos,
    etiquetaDeCanal,
    nombreDePais: nombrePais,
  });

  /**
   * ⚠️ EL DIFERENCIAL DE CAMBIO LO ASUME EL TUTOR (decisión del cliente,
   * 2-sep-2026), y por eso esto se dice en la pantalla y no en un anexo.
   *
   * `POST /v1/payouts` de dLocal Go no tiene moneda de origen: el importe va
   * SIEMPRE en la moneda de destino, así que hay que fijar o lo que recibe el
   * tutor o lo que sale de nuestro balance, nunca las dos. Se fija lo segundo —
   * `payouts.amount` en dólares— y la cantidad en moneda local la determina el
   * tipo de cambio del día que dLocal ejecuta. O sea que el número que el tutor
   * ve aquí es aproximado, y merece decírselo antes de que registre nada.
   *
   * El texto sale del DATO (`payout_country_rules.currency`) y no de un `if` por
   * país: en Ecuador esa columna es 'USD', no hay conversión y
   * `avisoDeImporteAproximado` devuelve `null` sin que nadie lo nombre.
   */
  const avisoDeCambio = regla
    ? avisoDeImporteAproximado(MONEDA_DEL_SALDO, regla.currency)
    : null;

  return (
    <TutorShell
      title="Payouts"
      description="Tus cobros se pagan en lote semanal. Retención de 7 días antes de liberar el saldo."
    >
      {/* Cifras (203:42). */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PanelCard className="flex items-start justify-between gap-2 p-5">
          <div className="min-w-0">
            <p className="text-xs text-[#6b6b6b]">Saldo disponible (liberado)</p>
            <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
              {moneyLine(balance.available)}
            </p>
          </div>
          <span className="grid size-9 shrink-0 place-items-center self-end rounded-full bg-brand text-white">
            <CheckIcon className="size-4" />
          </span>
        </PanelCard>
        <PanelCard className="p-5">
          <p className="text-xs text-[#6b6b6b]">En retención (7 días)</p>
          <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
            {moneyLine(balance.in_retention)}
          </p>
        </PanelCard>
        <PanelCard className="p-5">
          <p className="text-xs text-[#6b6b6b]">Ya pagado</p>
          <p className="mt-1.5 truncate text-2xl font-bold text-[#19191f] tabular-nums">
            {moneyLine(balance.paid_out)}
          </p>
        </PanelCard>
      </div>

      {/* Retiro self-service (US-1004, RN-40). */}
      <PanelCard className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[560px] text-[13px] text-[#6b6b6b]">
          El retiro adelanta la liquidación de tu saldo disponible (tras el
          período de retención). Si no, se liquida solo en el lote semanal.
        </p>
        <WithdrawButton disabled={!hasAvailable} />
      </PanelCard>

      {/* Información de pago (204:54) — R29-03b. */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Información de pago
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[#6b6b6b]">Cómo se te paga</dt>
            <dd className="mt-1 text-sm text-[#19191f]">
              Lote semanal, los lunes
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[#6b6b6b]">Retención</dt>
            <dd className="mt-1 text-sm text-[#19191f]">
              7 días desde que la mentoría se completa
            </dd>
          </div>
          {/* A0 · el dato que decide quién paga. Va junto a los otros dos
              porque es de la misma naturaleza: condiciones del cobro, no una
              acción. El control para cambiarlo está debajo. */}
          <div>
            <dt className="text-xs text-[#6b6b6b]">País de cobro</dt>
            <dd className="mt-1 flex items-center gap-2 text-sm text-[#19191f]">
              {paisDeCobro ? (
                nombrePais(paisDeCobro)
              ) : (
                <StatusPill tone="amber">Sin declarar</StatusPill>
              )}
            </dd>
          </div>
          {/* B1 · estado DERIVADO de `tutor_payout_accounts`, no un literal.
              Son cinco situaciones distintas —sin país, país no servible, sin
              datos, datos de otro país, registrada— y el tutor tiene que poder
              distinguirlas: la cuarta es la única que nadie ve venir. */}
          <div>
            {/* La etiqueta sigue al riel, no al país: donde no hay banco no hay
                «cuenta», hay un correo o un teléfono, y llamarlo cuenta es
                pedirle al tutor un número que no tiene. */}
            <dt className="text-xs text-[#6b6b6b]">
              {riel === "identificador" ? "Forma de cobro" : "Cuenta de cobro"}
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#19191f]">
              <StatusPill tone={estadoCuenta.tone}>
                {estadoCuenta.pill}
              </StatusPill>
              {estadoCuenta.detalle ? (
                <span className="tabular-nums">{estadoCuenta.detalle}</span>
              ) : null}
            </dd>
          </div>
          {/* N-16 — el tutor no veía su comisión por ningún lado, y estas
              cifras ya son NETAS de ella: sin el reparto, los importes no
              cuadran con lo que cobró el alumno. Etiqueta, no control: el nivel
              lo asigna el admin (`assign_tutor_tier`) y el tutor no tiene grant
              sobre `tier_id`. */}
          {tier ? (
            <div>
              <dt className="text-xs text-[#6b6b6b]">Tu nivel</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[#19191f]">
                <StatusPill tone="blue">{tier.name}</StatusPill>
                Te quedas con el {formatPct(tier.splitPct)} · comisión{" "}
                {formatPct(tier.commissionPct)}
              </dd>
            </div>
          ) : null}
        </dl>
        {/* A0 · el país, que va PRIMERO porque es el que decide qué le pide
            después el formulario bancario de B1 (justo debajo). */}
        <div className="mt-4 border-t border-[#e0e0e0] pt-4">
          <h3 className="text-sm font-semibold text-[#19191f]">
            ¿En qué país cobras?
          </h3>
          {/* ⚠️ Aquí ponía «Si el tuyo no está —Venezuela y Colombia, entre
              otros—», y desde `20260902150000` Venezuela SÍ está: tiene riel
              manual. Nombrar países en el texto es exactamente lo que la lista
              evita haciéndose desde `payment_routing_rules`, así que ya no se
              nombra ninguno. */}
          <p className="mt-1 max-w-[620px] text-[13px] text-[#6b6b6b]">
            De esto depende quién te paga, así que conviene tenerlo puesto antes
            de la primera liquidación. La lista son los países en los que hoy
            podemos hacerte llegar el dinero. Si el tuyo no está, déjalo sin
            declarar: sigues vendiendo igual y tu saldo se sigue acumulando.
          </p>
          <PayoutCountryForm
            userId={userId}
            current={paisDeCobro}
            options={paisesOfrecidos}
          />
        </div>

        {/* Los datos de cobro. Van DEBAJO del país y en este orden porque el
            país no es un campo más: es el que decide QUÉ RIEL le toca y, por
            tanto, qué campos existen y cómo se validan. Sin país declarado, este
            bloque no ofrece un formulario que no se podría rellenar — lo
            explica.

            C2m · y desde el 2-sep hay DOS formularios, no uno con campos
            opcionales: el bancario de B1 (ocho países de dLocal) y el manual
            (hoy Venezuela). Cuál se pinta lo decide `riel`, que viene del dato.
            No hay un solo código de país escrito aquí abajo. */}
        <div className="mt-4 border-t border-[#e0e0e0] pt-4">
          <h3 className="text-sm font-semibold text-[#19191f]">
            Tus datos de cobro
          </h3>

          {fallaLaCuenta ? (
            <p className="mt-2 max-w-[620px] text-[13px] font-medium text-[#bf3333]">
              No hemos podido leer tus datos de cobro ahora mismo. Vuelve a
              cargar la página; si sigue igual, escríbenos antes de volver a
              rellenarlos — lo que tengas guardado sigue estando.
            </p>
          ) : !paisDeCobro ? (
            <p className="mt-2 max-w-[620px] text-[13px] text-[#6b6b6b]">
              Primero dinos en qué país cobras, ahí arriba. Los datos que te
              pidamos dependen de él: en Argentina es un CBU, en México una
              CLABE, en Brasil hacen falta también la agência, y donde no llega
              ninguna transferencia te preguntamos por un correo o un teléfono…
              así que hasta que lo declares no hay un formulario que tenga
              sentido enseñarte.
              {/* Si ya tenía datos guardados, se le dice que siguen ahí. Mismo
                  criterio que `paisesOfrecidos`: nada se borra por un cambio de
                  configuración que él no hizo. */}
              {cuenta
                ? ` Los datos de ${nombrePais(cuenta.country)} que registraste siguen guardados.`
                : ""}
              {destinos.length > 0
                ? ` Las formas de cobro que registraste (${destinos.map((d) => etiquetaDeCanal(d.channel)).join(", ")}) siguen guardadas.`
                : ""}
            </p>
          ) : !riel ? (
            <p className="mt-2 max-w-[620px] text-[13px] text-[#6b6b6b]">
              Todavía no podemos hacerte llegar el dinero a{" "}
              {nombrePais(paisDeCobro)}, así que no te pedimos datos que no
              íbamos a poder usar. Tu saldo se sigue acumulando y te avisaremos
              en cuanto se abra.
              {cuenta
                ? ` Los datos de ${nombrePais(cuenta.country)} que registraste siguen guardados.`
                : ""}
              {destinos.length > 0
                ? ` Las formas de cobro que registraste (${destinos.map((d) => etiquetaDeCanal(d.channel)).join(", ")}) siguen guardadas.`
                : ""}
            </p>
          ) : riel === "conectada" ? (
            /* Connect. No hay formulario: el alta es en Stripe. */
            <ConnectAlta yaTieneCuenta={Boolean(perfil?.stripe_connect_account_id)} />
          ) : riel === "identificador" ? (
            <>
              {/* Va PRIMERO, antes del formulario: es el camino que entrega.
                  Solo cuando PayPal está entre los canales del país — en los
                  otros (Zelle, Zinli) no hay nada que conectar. */}
              {canales.some((c) => c.channel === "paypal") ? (
                <PaypalConectar
                  conectada={destinos.some(
                    (d) => d.channel === "paypal" && Boolean(d.verified_account_id),
                  )}
                />
              ) : null}
              {/* El tutor que cambió de un país de banco a uno manual: sus datos
                  bancarios siguen ahí, pero no sirven para pagarle aquí. Mismo
                  criterio que el mensaje simétrico del formulario bancario. */}
              {cuenta ? (
                <p className="mt-2 max-w-[620px] text-[13px] text-[#6b6b6b]">
                  Los datos bancarios de {nombrePais(cuenta.country)} que
                  registraste no se borran, pero a {nombrePais(paisDeCobro)} no
                  llega esa transferencia: dinos aquí abajo a dónde te pagamos.
                </p>
              ) : null}
              <PayoutManualForm
                // Mismo `key` por país y por el mismo motivo que abajo: el
                // formulario guarda su estado en `useState` y no se
                // reinicializa cuando cambian las props.
                key={paisDeCobro}
                canales={canales}
                destinos={destinos}
                etiquetaPais={nombrePais(paisDeCobro)}
              />
            </>
          ) : regla ? (
            <>
              <p className="mt-1 max-w-[620px] text-[13px] text-[#6b6b6b]">
                Tienen que ser los de una cuenta a tu nombre en{" "}
                {nombrePais(regla.country)}: el titular y el documento se
                comprueban contra el banco, y si no coinciden la transferencia
                se rechaza. Los guardamos porque nuestro proveedor de pagos no
                guarda beneficiarios: hay que mandárselos en cada pago.
              </p>

              {/* ⚠️ El diferencial de cambio. NO es letra pequeña y no va en un
                  `<span>` de 12px al pie de un campo: es una condición del
                  cobro, y el tutor tiene que leerla ANTES de registrar nada.
                  Sale de `regla.currency`, así que en Ecuador —que cobra en
                  dólares— `avisoDeCambio` es `null` y este bloque no existe,
                  sin que nadie escriba «si el país es EC». */}
              {avisoDeCambio ? (
                <p className="mt-3 max-w-[620px] rounded-[8px] border border-[#e8d5a8] bg-[#fdf7e6] p-3 text-[13px] text-[#19191f]">
                  {avisoDeCambio}
                </p>
              ) : null}

              <PayoutAccountForm
                // ⚠️ `key` por país, y no es decorativo: el formulario guarda su
                // estado en `useState`, que NO se reinicializa cuando cambian
                // las props. Sin esto, cambiar el país arriba dejaría dentro el
                // banco del país anterior — un código que ya no está en la
                // lista, con el desplegable en blanco y un error al guardar.
                key={paisDeCobro}
                regla={regla}
                bancos={bancos}
                cuenta={cuenta}
                paisDeclarado={paisDeCobro}
                // Los nombres se resuelven aquí, en el servidor: `nombrePais`
                // arrastra el locale de países entero y el formulario es un
                // componente de cliente.
                etiquetaPais={nombrePais(paisDeCobro)}
                etiquetaPaisGuardado={
                  cuenta ? nombrePais(cuenta.country) : null
                }
              />
            </>
          ) : /* Inalcanzable: `riel` ya vale null cuando es «banco» sin fila en
                `payout_country_rules`. Está para que TypeScript pueda estrechar
                `regla`, no porque haya un caso que pintar. */
          null}
        </div>
      </PanelCard>

      {/* Próximos payouts (204:2). */}
      {upcoming.length > 0 ? (
        <PanelCard>
          <h2 className="text-base font-semibold text-[#19191f]">
            Próximos payouts
          </h2>
          <ul className="mt-2 divide-y divide-[#e0e0e0]">
            {upcoming.map((p) => {
              const b = PAYOUT_BADGE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#19191f] tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                    </p>
                    <p className="text-xs text-[#6b6b6b]">
                      {p.scheduled_for
                        ? `Programado para ${fmtDate(p.scheduled_for)}`
                        : `Creado ${fmtDate(p.created_at)}`}
                    </p>
                  </div>
                  <StatusPill
                    tone={PAYOUT_PILL[p.status] ?? "neutral"}
                    className="h-7"
                  >
                    {b.label}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        </PanelCard>
      ) : null}

      {/* Historial (204:23). */}
      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">Historial</h2>
        {history.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#6b6b6b]">
            Aún no tienes liquidaciones pagadas.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[#e0e0e0]">
            {history.map((p) => {
              const b = PAYOUT_BADGE[p.status];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#19191f] tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                      {p.paid_at ? ` · ${fmtDate(p.paid_at)}` : ""}
                    </p>
                    {/* El "Transferencia bancaria · DLocal" del Figma llega
                        con el PSP real (EP-20). */}
                  </div>
                  <StatusPill
                    tone={PAYOUT_PILL[p.status] ?? "neutral"}
                    className="h-7"
                  >
                    {b.label}
                  </StatusPill>
                </li>
              );
            })}
          </ul>
        )}
      </PanelCard>
    </TutorShell>
  );
}
