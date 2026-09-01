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
import { WithdrawButton } from "./withdraw-button";
import { PayoutCountryForm } from "./payout-country-form";
import { PayoutAccountForm } from "./payout-account-form";
import {
  estadoDeLaCuenta,
  type BancoDePais,
  type CuentaEnmascarada,
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

/** Estados que el Figma lista como "Próximos payouts" (204:2). */
const UPCOMING = new Set(["scheduled", "processing", "pending"]);

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
      .select("payout_country")
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
  const paisesOfrecidos = (
    paisDeCobro && !servibles.includes(paisDeCobro)
      ? [...servibles, paisDeCobro]
      : servibles
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
  const fallaLaCuenta = Boolean(errorCuenta ?? errorReglas);

  // La regla del país DECLARADO. Si el tutor no ha declarado ninguno no hay
  // formulario que pintar: el país decide qué campos existen.
  const regla =
    (paisDeCobro
      ? ((reglas ?? []) as ReglaDePais[]).find((r) => r.country === paisDeCobro)
      : undefined) ?? null;

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

  const estadoCuenta = estadoDeLaCuenta({
    paisDeclarado: paisDeCobro,
    paisServible: Boolean(regla),
    cuenta,
    nombreDelBanco:
      bancos.find((b) => b.bank_code === cuenta?.bank_code)?.name ?? null,
    nombreDePais: nombrePais,
  });

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
            <dt className="text-xs text-[#6b6b6b]">Cuenta de cobro</dt>
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
          <p className="mt-1 max-w-[620px] text-[13px] text-[#6b6b6b]">
            De esto depende quién te paga, así que conviene tenerlo puesto antes
            de la primera liquidación. La lista son los países a los que hoy
            podemos transferir. Si el tuyo no está —Venezuela y Colombia, entre
            otros— déjalo sin declarar: sigues vendiendo igual y tu saldo se
            sigue acumulando.
          </p>
          <PayoutCountryForm
            userId={userId}
            current={paisDeCobro}
            options={paisesOfrecidos}
          />
        </div>

        {/* B1 · los datos bancarios. Van DEBAJO del país y en este orden porque
            el país no es un campo más: es el que decide qué campos existen y
            cómo se validan. Sin país declarado, este bloque no ofrece un
            formulario que no se podría rellenar — lo explica. */}
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
              CLABE, en Brasil hacen falta también la agência… así que hasta que
              lo declares no hay un formulario que tenga sentido enseñarte.
              {/* Si ya tenía datos guardados, se le dice que siguen ahí. Mismo
                  criterio que `paisesOfrecidos`: nada se borra por un cambio de
                  configuración que él no hizo. */}
              {cuenta
                ? ` Los datos de ${nombrePais(cuenta.country)} que registraste siguen guardados.`
                : ""}
            </p>
          ) : !regla ? (
            <p className="mt-2 max-w-[620px] text-[13px] text-[#6b6b6b]">
              Todavía no podemos transferir a {nombrePais(paisDeCobro)}, así que
              no te pedimos datos bancarios que no íbamos a poder usar. Tu saldo
              se sigue acumulando y te avisaremos en cuanto se abra.
              {cuenta
                ? ` Los datos de ${nombrePais(cuenta.country)} que registraste siguen guardados.`
                : ""}
            </p>
          ) : (
            <>
              <p className="mt-1 max-w-[620px] text-[13px] text-[#6b6b6b]">
                Tienen que ser los de una cuenta a tu nombre en{" "}
                {nombrePais(regla.country)}: el titular y el documento se
                comprueban contra el banco, y si no coinciden la transferencia
                se rechaza. Los guardamos porque nuestro proveedor de pagos no
                guarda beneficiarios: hay que mandárselos en cada pago.
              </p>
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
          )}
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
