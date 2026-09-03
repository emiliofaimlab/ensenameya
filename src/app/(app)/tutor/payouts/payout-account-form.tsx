"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  enmascarar,
  normalizaCuenta,
  normalizaDocumento,
  validarCuenta,
  type BancoDePais,
  type CuentaEnmascarada,
  type ReglaDePais,
  type ValoresDeCuenta,
} from "@/lib/payout-account";

/**
 * El resumen ENMASCARADO que devuelve `upsert_payout_account`. La función
 * devuelve más campos (`document_type`, `holder`, `bank_account_type`…); aquí
 * solo se declaran los cuatro que se pintan, para que quede claro qué se usa.
 *
 * ⚠️ `last4` es lo ÚNICO del número de cuenta que sale de la base de datos: es
 * la columna generada `bank_account_last4`, y `bank_account` no tiene
 * `grant select` para ningún rol.
 */
type ResumenDeCuenta = {
  country: string;
  bank_code: string;
  bank_name: string | null;
  last4: string;
};

/** Mismo alto y borde que el desplegable de país, que está justo encima. */
const CAMPO =
  "h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm text-[#333333] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * B1 · Los datos con los que se le paga al tutor.
 *
 * ── POR QUÉ ESTE FORMULARIO NO ESCRIBE COMO EL DE AL LADO ───────────────────
 *
 * `PayoutCountryForm` escribe `tutor_profiles.payout_country` con un
 * `.from().update()` desde el navegador, y su comentario lo justifica: «no es
 * dinero, es la CLAVE con la que el dinero se rutea». Ese razonamiento NO se
 * extiende aquí, y no porque esto sí sea dinero —tampoco lo es—, sino porque lo
 * que se escribe **solo es válido en función de otra columna**: el CBU de 22
 * dígitos de Argentina no vale en México, donde son 18 de CLABE, y el
 * `bank_code` tiene que estar en una lista cerrada de dLocal que el navegador no
 * puede comprobar. Un `grant update` columna a columna deja escribir cualquier
 * cosa; lo que se rompe entonces no es un formulario, es un payout rechazado
 * tres semanas después.
 *
 * Por eso esto llama a `upsert_payout_account`, que es RPC `security definer`,
 * lee `auth.uid()` dentro y revalida contra `payout_country_rules` — la misma
 * diferencia que ya existe entre esta pantalla y la de verificación, que escribe
 * por `submit_document` y no por PATCH.
 *
 * ── Y POR QUÉ LAS REGLAS LLEGAN POR PROPS ───────────────────────────────────
 *
 * `regla` es una fila de `payout_country_rules`, leída de la base de datos: las
 * etiquetas, la ayuda, qué campos existen y las expresiones regulares salen de
 * ahí y no de este fichero. Es lo que hace que el formulario de México pida una
 * CLABE y el de Brasil una agência sin un solo `if (pais === …)` aquí dentro, y
 * lo que garantiza que lo que valida el navegador es exactamente lo que valida
 * el servidor.
 */
export function PayoutAccountForm({
  regla,
  bancos,
  cuenta,
  paisDeclarado,
  etiquetaPais,
  etiquetaPaisGuardado,
}: {
  regla: ReglaDePais;
  bancos: BancoDePais[];
  /** Lo guardado, enmascarado. `null` = todavía nada. */
  cuenta: CuentaEnmascarada | null;
  /** `tutor_profiles.payout_country` — puede no coincidir con `cuenta.country`. */
  paisDeclarado: string;
  /** Nombres ya resueltos en el servidor: aquí no se importa `nombrePais`, que
      arrastraría el locale entero de países al bundle del navegador. */
  etiquetaPais: string;
  etiquetaPaisGuardado: string | null;
}) {
  const router = useRouter();

  // ⚠️ «Del mismo país» manda en todo lo de abajo. Si el tutor declaró otro país
  // después de registrar la cuenta, lo guardado son coordenadas de un sitio al
  // que ya no cobra: no se prerrellena, no se conserva y hay que teclearlo otra
  // vez. Lo que sí se conserva son el nombre y los apellidos, que no cambian al
  // cruzar una frontera.
  //
  // Esta primera versión es la de la CARGA y solo sirve para inicializar los
  // campos; la que manda después es `mismoPais`, calculada sobre `guardado`.
  const mismoPaisAlCargar = cuenta?.country === paisDeclarado;

  /**
   * ⚠️ LO GUARDADO ES ESTADO, y arreglarlo es media historia.
   *
   * `upsert_payout_account` devuelve un resumen ENMASCARADO —`last4`, banco,
   * país, fecha— y su comentario en `20260901160000` dice para qué: «así el
   * formulario repinta sin volver a consultar». Este formulario lo TIRABA
   * (`const { error: err } = await …`) y pedía la página entera otra vez para
   * volver a leer exactamente lo que la RPC acababa de darle. Resultado: entre
   * el `Guardando…` y el repintado, la línea de arriba seguía enseñando el
   * `····1234` viejo, que es justo el dato que el tutor acaba de cambiar y el
   * único que estaba mirando.
   */
  const [guardado, setGuardado] = useState<ResumenDeCuenta | null>(
    cuenta
      ? {
          country: cuenta.country,
          bank_code: cuenta.bank_code,
          bank_name:
            bancos.find((b) => b.bank_code === cuenta.bank_code)?.name ?? null,
          last4: cuenta.bank_account_last4,
        }
      : null,
  );

  // Y por eso este también es derivado: tras el primer guardado el país de lo
  // guardado ya coincide con el declarado, así que las pistas de «(guardado) ·
  // déjalo en blanco para no cambiarlo» aparecen solas, sin recargar.
  const mismoPais = guardado?.country === paisDeclarado;

  const [v, setV] = useState<ValoresDeCuenta>({
    nombre: cuenta?.beneficiary_first_name ?? "",
    apellidos: cuenta?.beneficiary_last_name ?? "",
    tipoDocumento:
      (mismoPaisAlCargar ? cuenta?.beneficiary_document_type : "") ?? "",
    documento: "",
    bankCode: (mismoPaisAlCargar ? cuenta?.bank_code : "") ?? "",
    tipoCuenta: (mismoPaisAlCargar ? cuenta?.bank_account_type : "") ?? "",
    cuenta: "",
    sucursal: (mismoPaisAlCargar ? cuenta?.bank_branch : "") ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof ValoresDeCuenta) => (valor: string) => {
    setV((prev) => ({ ...prev, [k]: valor }));
    setError(null);
  };

  const tiposDocumento = Object.keys(regla.document_patterns);

  async function guardar() {
    const fallo = validarCuenta(regla, bancos, v, mismoPais, etiquetaPais);
    if (fallo) {
      setError(fallo);
      return;
    }

    setBusy(true);
    const supabase = createClient();
    // Los dos campos sensibles van como `null` cuando el tutor los deja en
    // blanco, y eso en la RPC significa «deja el que ya está». Es la
    // contrapartida de que la lectura vaya enmascarada: sin esto, cambiar una
    // letra del apellido obligaría a reteclear el número de cuenta — y reteclear
    // datos bancarios es exactamente como se introducen erratas.
    const { data, error: err } = await supabase.rpc("upsert_payout_account", {
      p_first_name: v.nombre.trim(),
      p_last_name: v.apellidos.trim(),
      p_document_type: v.tipoDocumento,
      p_bank_code: v.bankCode,
      p_document: normalizaDocumento(v.documento) || undefined,
      p_account: normalizaCuenta(v.cuenta) || undefined,
      p_account_type: v.tipoCuenta || undefined,
      p_branch: v.sucursal.trim() || undefined,
    });
    setBusy(false);

    if (err) {
      // El mensaje de la RPC ya está escrito para el tutor («El CBU no tiene el
      // formato que pide AR…»), así que se enseña tal cual en vez de traducirlo.
      setError(err.message || "No se pudieron guardar tus datos de cobro.");
      return;
    }

    // AQUÍ ESTÁ EL USO DEL VALOR DE RETORNO. `data` viene tipado como `Json`
    // porque `database.types.ts` no sabe qué devuelve una `returns jsonb`, así
    // que el cast es inevitable; lo que no era inevitable es tirarlo.
    const resumen = data as unknown as ResumenDeCuenta | null;
    if (resumen) setGuardado(resumen);

    setV((prev) => ({ ...prev, documento: "", cuenta: "" }));
    toast.success("Datos de cobro guardados.");
    // El `refresh` ya NO es lo que hace correcto este formulario: es lo que pone
    // al día la píldora «Cuenta de cobro» del bloque de arriba, que la pinta el
    // servidor. Si tardara o fallara, lo que el tutor ve aquí ya es lo bueno.
    router.refresh();
  }

  return (
    <div className="mt-3">
      {guardado ? (
        <p className="mb-3 text-[13px] text-[#6b6b6b]">
          {mismoPais ? (
            <>
              Guardado:{" "}
              <span className="font-semibold text-[#19191f] tabular-nums">
                {enmascarar(guardado.last4)}
              </span>{" "}
              ·{" "}
              {guardado.bank_name ??
                bancos.find((b) => b.bank_code === guardado.bank_code)?.name ??
                guardado.bank_code}
              . Solo enseñamos los cuatro últimos caracteres; para cambiar la
              cuenta o el documento, escríbelos de nuevo. Si los dejas en blanco,
              se quedan como están.
            </>
          ) : (
            <>
              Los datos que tienes guardados son de{" "}
              {etiquetaPaisGuardado ?? guardado.country} y ahora cobras en{" "}
              {etiquetaPais}. No se borran, pero no sirven para pagarte allí:
              rellena los de {etiquetaPais}.
            </>
          )}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Nombre del titular</span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.nombre}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => set("nombre")(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Apellidos del titular</span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.apellidos}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => set("apellidos")(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Tipo de documento</span>
          <select
            className={`mt-1 ${CAMPO}`}
            value={v.tipoDocumento}
            disabled={busy}
            onChange={(e) => set("tipoDocumento")(e.target.value)}
          >
            <option value="">Elige…</option>
            {tiposDocumento.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-[#6b6b6b]">
            Número de documento
            {mismoPais ? " (guardado)" : ""}
          </span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.documento}
            disabled={busy}
            autoComplete="off"
            inputMode="text"
            placeholder={
              mismoPais
                ? "Déjalo en blanco para no cambiarlo"
                : "Sin puntos ni guiones"
            }
            onChange={(e) => set("documento")(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Banco</span>
          <select
            className={`mt-1 ${CAMPO}`}
            value={v.bankCode}
            disabled={busy}
            onChange={(e) => set("bankCode")(e.target.value)}
          >
            <option value="">Elige tu banco…</option>
            {bancos.map((b) => (
              <option key={b.bank_code} value={b.bank_code}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        {/* Solo los países cuyo subconjunto de `bank_account_type` documenta
            dLocal. Donde no lo documenta (`account_types` vacío) no se pregunta
            y no se manda: inventar un valor es un payout retenido. */}
        {regla.account_types.length > 0 ? (
          <label className="block">
            <span className="text-xs text-[#6b6b6b]">Tipo de cuenta</span>
            <select
              className={`mt-1 ${CAMPO}`}
              value={v.tipoCuenta}
              disabled={busy}
              onChange={(e) => set("tipoCuenta")(e.target.value)}
            >
              <option value="">Elige…</option>
              {regla.account_types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block sm:col-span-2">
          <span className="text-xs text-[#6b6b6b]">
            {regla.account_label}
            {mismoPais ? " (guardada)" : ""}
          </span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.cuenta}
            disabled={busy}
            autoComplete="off"
            inputMode="text"
            placeholder={
              mismoPais
                ? "Déjalo en blanco para no cambiarla"
                : regla.account_label
            }
            onChange={(e) => set("cuenta")(e.target.value)}
          />
          <span className="mt-1 block text-[12px] text-[#6b6b6b]">
            {regla.account_help}
          </span>
        </label>

        {/* Solo Brasil y Uruguay lo documentan. Ver `requires_branch` en la
            migración: el resto de países no manda sucursal porque su número de
            cuenta ya la lleva dentro, y eso está pendiente de probar en el
            sandbox de dLocal. */}
        {regla.requires_branch ? (
          <label className="block">
            <span className="text-xs text-[#6b6b6b]">
              Sucursal / agência
            </span>
            <input
              className={`mt-1 ${CAMPO}`}
              value={v.sucursal}
              disabled={busy}
              autoComplete="off"
              onChange={(e) => set("sucursal")(e.target.value)}
            />
          </label>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 max-w-[620px] text-[13px] font-medium text-[#bf3333]"
        >
          {error}
        </p>
      ) : null}

      <Button
        className="mt-4 h-[45px] rounded-[8px] px-4"
        disabled={busy}
        onClick={guardar}
      >
        {busy ? "Guardando…" : "Guardar datos de cobro"}
      </Button>
    </div>
  );
}
