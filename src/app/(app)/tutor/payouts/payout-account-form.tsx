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
  normalizaTelefono,
  validarCuenta,
  type BancoDePais,
  type CuentaEnmascarada,
  type ReglaDePais,
  type ValoresDeCuenta,
} from "@/lib/payout-account";

/**
 * El resumen ENMASCARADO que devuelve `upsert_payout_account`. La función
 * devuelve más campos (`document_type`, `holder`, `bank_account_type`…); aquí
 * solo se declaran los que se pintan, para que quede claro qué se usa.
 *
 * ⚠️ `last4` es lo ÚNICO del número de cuenta que sale de la base de datos: es
 * la columna generada `bank_account_last4`, y `bank_account` no tiene
 * `grant select` para ningún rol. La dirección y el teléfono, en cambio, vuelven
 * enteros: los cuatro están en el `grant select` de `authenticated`
 * (`20260907120000`) porque el tutor tiene que poder releerlos y corregirlos.
 */
type ResumenDeCuenta = {
  country: string;
  bank_code: string;
  bank_name: string | null;
  last4: string;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  phone: string | null;
  /**
   * El estado o provincia, que solo se pide donde el corredor lo exige
   * (`20260910150000`). Vuelve de la RPC porque el tutor NO lo puede releer en la
   * primera carga: la consulta de `page.tsx` no trae esa columna, así que sin
   * esto el campo quedaría vacío para siempre después de guardar.
   */
  state: string | null;
  /**
   * El veredicto del SERVIDOR sobre si a este tutor se le puede pagar por
   * transferencia internacional: `wise_puede_pagar_a()`, que mira cuatro cosas
   * más que la dirección (banco traducido, tipo de cuenta en AR, tipo de
   * documento en UY) y cuyo `execute` es solo de `service_role`.
   *
   * `null` = la RPC todavía no ha contestado en esta sesión. Es el estado de la
   * primera carga, donde lo único que hay son columnas leídas de la tabla, y por
   * eso no se puede prometer nada todavía.
   */
  wise_listo: boolean | null;
};

/** Mismo alto y borde que el desplegable de país, que está justo encima. */
const CAMPO =
  "h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm text-[#333333] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * CÓMO SE LLAMA EL SEGUNDO NÚMERO DEL BANCO, según el formato del país.
 *
 * `bank_branch` era la agência de Brasil y la sucursal de Uruguay; desde
 * `20260910150000` es también el sort code británico, el número de ruta ACH
 * estadounidense, el BSB australiano, el IFSC indio y el BIC de los países que
 * Wise solo alcanza por SWIFT. Llamarlo «Sucursal / agência» a un tutor de
 * Londres es pedirle un dato que no existe.
 *
 * ⚠️ ESTO ES ROTULACIÓN, NO VALIDACIÓN. El formato sigue saliendo de
 * `regla.branch_pattern`, que vive en la base de datos: aquí no hay una sola
 * expresión regular, y no debe haberla. La clave es `wise_account_type`, que
 * llega en la fila de reglas y ya la selecciona `page.tsx`.
 *
 * ⚠️ Y vive en el TSX y no en la tabla porque `payout_country_rules` no tiene
 * columna de rótulo para este campo, y añadírsela habría obligado a tocar la
 * consulta de `page.tsx` y el tipo `ReglaDePais`. Es el sitio menos malo, no el
 * ideal: si algún día se añade `branch_label`, esto se borra.
 */
/**
 * ⚠️ AQUÍ VIVÍA UN `Record<>` CON EL RÓTULO DE CADA FORMATO —sort code, ABA,
 * BSB, IFSC, BIC— y se fue a `payout_country_rules.branch_label`/`branch_help`
 * (`20260910170000`). El motivo es el mismo por el que `account_label` ya
 * estaba allí: si el texto que lee el tutor y la regla que valida su cuenta
 * (`branch_pattern`) viven en ficheros distintos, se desincronizan y el que se
 * entera es él, tres semanas después. Y de paso abrir un país vuelve a ser UNA
 * FILA, también en lo que se lee en pantalla.
 */

/**
 * Los dos formatos que exigen estado o provincia, medido y no documentado:
 * `POST /v1/accounts` de tipo `aba` y `australian` devuelve
 * `422 address.state = "Please enter a state."` sin él (`20260910150000`).
 * En el resto de países no se pregunta, porque en el resto no se manda.
 */
const PIDEN_ESTADO = new Set(["aba", "australian"]);

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
  ipDelTutor,
  bancos,
  cuenta,
  paisDeclarado,
  etiquetaPais,
  etiquetaPaisGuardado,
}: {
  regla: ReglaDePais;
  /**
   * 🔑 LA IP DESDE LA QUE SE ACEPTA, resuelta EN EL SERVIDOR. Stripe la exige
   * junto con la fecha (`tos_acceptance.ip`) y el navegador no puede saber la
   * suya: lo que él dijera sería lo que él quisiera decir. La lee `page.tsx` de
   * la cabecera de la petición. `null` cuando no se pudo resolver, y entonces
   * la casilla no sella nada — mejor no pagar por esa vía que guardar un
   * consentimiento sin poder probar de dónde vino.
   */
  ipDelTutor: string | null;
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
   * ¿HAY BANCO QUE ELEGIR, O LO IDENTIFICA EL PROPIO NÚMERO DE CUENTA?
   *
   * En un país de IBAN no hay lista de bancos: el IBAN lleva el banco dentro, y
   * lo mismo pasa con el número de ruta, el sort code, el BSB, el IFSC y el BIC.
   * Pero `tutor_payout_accounts.bank_code` es `not null` y tiene FK contra
   * `payout_banks`, así que `20260910150000` siembra UNA fila centinela por país.
   *
   * Un desplegable con una sola opción es una pregunta que no lo es, así que
   * cuando el catálogo trae un solo banco se elige solo y no se pinta. La señal
   * es el tamaño del catálogo y no una lista de países aquí dentro: el día que
   * uno de estos países reciba bancos de verdad, el desplegable vuelve solo.
   */
  const bancoUnico = bancos.length === 1 ? bancos[0] : null;
  const hayCatalogo = bancos.length > 1;

  /** El rótulo del segundo número del banco, según el formato del país. */
  // El rótulo y la ayuda salen de la fila del país. `?? 'Sucursal'` es la red
  // para un país que pida segundo dato y no tenga rótulo: la migración lo
  // impide con una autocomprobación, así que esto no debería alcanzarse nunca.
  const segundoNumero = {
    etiqueta: regla.branch_label ?? "Sucursal",
    ayuda: regla.branch_help ?? "",
  };

  const pideEstado = PIDEN_ESTADO.has(regla.wise_account_type ?? "");

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
          address_line: cuenta.beneficiary_address_line,
          city: cuenta.beneficiary_city,
          postcode: cuenta.beneficiary_postcode,
          phone: cuenta.beneficiary_phone,
          // Desde el 10-sep la consulta de `page.tsx` SÍ trae
          // `beneficiary_state`, así que en la primera carga ya se sabe si hay
          // uno guardado y el campo arranca relleno. Antes esto era `null` con
          // un comentario que decía que no se podía saber.
          state: cuenta.beneficiary_state,
          // ⚠️ `null` y no `false`. Con `false` la pantalla le diría a un tutor
          // que ya tiene los cuatro campos rellenos que no podemos pagarle por
          // esa vía, cuando lo cierto es que nadie se lo ha preguntado todavía:
          // quien lo sabe es `wise_puede_pagar_a()`, que es `service_role` y no
          // se puede llamar desde aquí. Lo contesta la RPC al guardar.
          wise_listo: null,
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
    // Si el país tiene un solo banco, se elige aquí: el desplegable no se pinta y
    // sin esto `validarCuenta` diría «Elige tu banco» sin banco que elegir.
    bankCode:
      (mismoPaisAlCargar ? cuenta?.bank_code : null) ??
      bancoUnico?.bank_code ??
      "",
    tipoCuenta: (mismoPaisAlCargar ? cuenta?.bank_account_type : "") ?? "",
    cuenta: "",
    sucursal: (mismoPaisAlCargar ? cuenta?.bank_branch : "") ?? "",
    // ⚠️ ESTOS CUATRO SÍ SE PRERRELLENAN, al revés que `documento` y `cuenta`.
    // No es una excepción a la máscara: aquellos vuelven de la base como
    // `····1234` porque sus columnas no tienen `grant select` para nadie, así
    // que no hay nada que poner en el campo. La dirección y el teléfono vuelven
    // enteros, y dejarlos en blanco obligaría a reteclearlos cada vez que el
    // tutor corrige una letra de su apellido.
    //
    // Y siguen la misma regla de país que el resto: una dirección de Argentina
    // no es la dirección de nadie en México, así que si el tutor cambió de país
    // después de registrarla, se teclea de nuevo.
    direccion: (mismoPaisAlCargar ? cuenta?.beneficiary_address_line : "") ?? "",
    ciudad: (mismoPaisAlCargar ? cuenta?.beneficiary_city : "") ?? "",
    codigoPostal: (mismoPaisAlCargar ? cuenta?.beneficiary_postcode : "") ?? "",
    telefono: (mismoPaisAlCargar ? cuenta?.beneficiary_phone : "") ?? "",
  });
  /**
   * El estado va APARTE de `v` y no dentro de `ValoresDeCuenta`, que es un tipo
   * de `src/lib/payout-account.ts`: ese módulo es el espejo de
   * `payout_account_check`, y el estado no pasa por esa validación —la base lo
   * deja nullable y la RPC no lo exige— así que meterlo ahí habría obligado a
   * tocar `validarCuenta` para que lo ignorase. Lo que sí se valida es su forma,
   * unas líneas más abajo, antes de llamar a la RPC.
   */
  const [estado, setEstado] = useState(
    (mismoPaisAlCargar ? cuenta?.beneficiary_state : "") ?? "",
  );
  /**
   * 🔑 LOS DOS DATOS QUE PIDE STRIPE (dictado, decisión D-1). Van aparte de `v`
   * por lo mismo que `estado`: `ValoresDeCuenta` es el espejo de
   * `payout_account_check`, y estos dos no pasan por esa validación —la base los
   * deja nullable y ningún otro riel los usa—, así que meterlos ahí obligaría a
   * tocar `validarCuenta` para que los ignorase.
   *
   * ⚠️ LA FECHA NO SE RELEE. `beneficiary_dob` no tiene `grant select` para
   * `authenticated` a propósito: es un dato personal y ninguna pantalla necesita
   * devolvérselo al navegador. El campo arranca en blanco también para quien ya
   * la dio, y en blanco significa «conserva la guardada» — lo hace el `coalesce`
   * de la RPC, igual que con el documento y el número de cuenta.
   */
  const [nacimiento, setNacimiento] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof ValoresDeCuenta) => (valor: string) => {
    setV((prev) => ({ ...prev, [k]: valor }));
    setError(null);
  };

  const tiposDocumento = Object.keys(regla.document_patterns);

  async function guardar() {
    // ── El segundo número del banco, ANTES de `validarCuenta` ───────────────
    //
    // `validarCuenta` ya comprueba este campo contra `regla.branch_pattern`, y
    // eso no se duplica aquí. Lo que se adelanta es el MENSAJE: el suyo dice
    // «Falta la sucursal, que en este país es obligatoria», que es correcto en
    // Brasil y desconcertante en Londres, donde el campo es el sort code. Vive
    // en `src/lib/payout-account.ts`, que no se puede rotular por país porque no
    // sabe cuál es el rótulo. Así que el error específico se da aquí y el suyo
    // queda como red.
    if (regla.requires_branch) {
      const suc = v.sucursal.trim();
      if (!suc) {
        setError(`Falta el ${segundoNumero.etiqueta}. ${segundoNumero.ayuda}`);
        return;
      }
      if (regla.branch_pattern && !new RegExp(regla.branch_pattern).test(suc)) {
        setError(
          `El ${segundoNumero.etiqueta} no tiene el formato correcto. ${segundoNumero.ayuda}`,
        );
        return;
      }
    }

    // ── El estado, donde el corredor lo exige ───────────────────────────────
    //
    // El `check` de la columna es `^[A-Za-z]{2,3}$` y la RPC lo pasa a mayúsculas.
    // Se valida aquí porque el mensaje de la RPC no puede decir qué campo mirar:
    // su bloque `exception` existe para NO publicar la fila en el log.
    //
    // Y no se exige cuando ya hay una fila guardada de este mismo país: en blanco
    // significa «deja el que ya está», igual que el documento y la cuenta. Es la
    // única forma de que funcione, porque la pantalla no puede releerlo.
    if (pideEstado) {
      const est = estado.trim();
      if (!est && !mismoPais) {
        setError(
          "Falta el estado o provincia: sin él no se puede hacer la transferencia en tu país.",
        );
        return;
      }
      if (est && !/^[A-Za-z]{2,3}$/.test(est)) {
        setError(
          "El estado va en su código corto, de dos o tres letras (FL, CA, NSW).",
        );
        return;
      }
    }

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
      // 🔑 Los dos de la ruta extra (decisión D-1). En blanco = «conserva lo
      // guardado», igual que el documento: el `coalesce` de la RPC lo respeta,
      // así que editar la cuenta sin volver a marcar la casilla NO borra una
      // aceptación ya dada.
      p_dob: nacimiento || undefined,
      // ⚠️ Solo viaja si la casilla está marcada. La RPC sella la hora con
      // `now()` únicamente cuando recibe IP, así que sin marcar no se guarda
      // ninguna aceptación — que es el fallo correcto.
      p_tos_ip: acepta && ipDelTutor ? ipDelTutor : undefined,
      // Los cuatro de la dirección van con el MISMO sufijo `|| undefined`, y por
      // el mismo motivo: en blanco significan «deja el que ya está». Aquí es
      // menos evidente que en el documento porque estos campos vienen
      // prerrellenados —lo normal es que lleguen con algo—, pero el tutor puede
      // borrarlos, y borrarlos no es pedir que se anulen: para eso está el
      // `coalesce` de la RPC, que los conserva.
      //
      // ⚠️ Sin `|| undefined` esto mandaría `""`, que en la RPC pasa por
      // `nullif(btrim(…), '')` → null → `coalesce` con lo anterior. Llegaría al
      // mismo sitio por casualidad; se escribe explícito porque lo que hace
      // correcta la llamada es la intención, no que dos normalizaciones
      // coincidan.
      p_address_line: v.direccion.trim() || undefined,
      p_city: v.ciudad.trim() || undefined,
      p_postcode: v.codigoPostal.trim() || undefined,
      p_phone: normalizaTelefono(v.telefono) || undefined,
      // El estado, con el mismo `|| undefined` y el mismo significado: en blanco
      // es «deja el que ya está». Aquí es la regla la que hace que el formulario
      // funcione, no una comodidad: la pantalla no puede releer esta columna en la
      // primera carga, así que llega vacía casi siempre y sin el `coalesce` de la
      // RPC cada guardado borraría el estado del tutor de EE. UU. — y con él, su
      // riel de cobro.
      p_state: estado.trim() || undefined,
    });
    setBusy(false);

    if (err) {
      /**
       * ⚠️ NO TODO ERROR DE LA RPC ESTÁ ESCRITO PARA EL TUTOR, y darlo por hecho
       * costó una pantalla rota el 10-sep-2026.
       *
       * Los `raise exception` de `upsert_payout_account` sí lo están («El CBU no
       * tiene el formato que pide AR…») y esos se enseñan tal cual: dicen qué
       * campo corregir mejor de lo que lo diría un texto genérico.
       *
       * Lo que NO se puede enseñar es lo que viene de la infraestructura. Un
       * `PGRST203` —dos funciones con el mismo nombre y PostgREST sin poder
       * elegir— pintaba 600 caracteres en inglés con los nombres de los
       * parámetros SQL dentro, encima de la pantalla del dinero del tutor. Y era
       * un fallo NUESTRO, no un dato mal escrito por él.
       *
       * La regla: los `check_violation` (23514) y los que levanta la propia
       * función son suyos; el resto es nuestro y va al log.
       */
      const esNuestro =
        !err.code || err.code.startsWith("PGRST") || !err.code.startsWith("23");
      if (esNuestro) {
        console.error("[payouts] la RPC de datos de cobro falló:", err);
        setError(
          "No pudimos guardar tus datos de cobro ahora mismo. Vuelve a intentarlo; si sigue igual, escríbenos.",
        );
      } else {
        setError(err.message || "No se pudieron guardar tus datos de cobro.");
      }
      return;
    }

    // AQUÍ ESTÁ EL USO DEL VALOR DE RETORNO. `data` viene tipado como `Json`
    // porque `database.types.ts` no sabe qué devuelve una `returns jsonb`, así
    // que el cast es inevitable; lo que no era inevitable es tirarlo.
    const resumen = data as unknown as ResumenDeCuenta | null;
    if (resumen) setGuardado(resumen);

    // `documento` y `cuenta` se vacían porque lo guardado ya no se puede volver
    // a leer: lo que queda de ellos es `····1234`. La dirección y el teléfono
    // hacen lo contrario y se REPINTAN con lo que devolvió la RPC — que puede no
    // ser lo que hay en el campo: si el tutor lo dejó en blanco, lo que quedó
    // guardado es lo anterior, y enseñarle el hueco sería enseñarle un borrado
    // que no ha ocurrido. Es el mismo motivo por el que este formulario dejó de
    // tirar el valor de retorno.
    setV((prev) => ({
      ...prev,
      documento: "",
      cuenta: "",
      direccion: resumen?.address_line ?? prev.direccion,
      ciudad: resumen?.city ?? prev.ciudad,
      codigoPostal: resumen?.postcode ?? prev.codigoPostal,
      telefono: resumen?.phone ?? prev.telefono,
    }));
    // Y el estado, igual que la dirección: se repinta con lo que quedó GUARDADO,
    // que puede no ser lo que hay en el campo. Es además el único momento en el
    // que la pantalla llega a saberlo.
    if (resumen?.state) setEstado(resumen.state);
    /**
     * 🔴 SI LA AUTORIZACIÓN NO SE PUDO SELLAR, SE DICE. No se guarda callando.
     *
     * `p_tos_ip` solo viaja si hay IP, y la IP puede faltar (sin
     * `x-forwarded-for` ni `x-real-ip` — el caso de `npm run dev`, o un proxy
     * que no la ponga). Es la decisión correcta: mejor no guardar un
     * consentimiento que no podemos probar de dónde vino. Lo que estaba mal era
     * el silencio: el tutor marcaba la casilla, leía «Datos de cobro guardados»
     * y se iba creyendo abierta una ruta de cobro que no lo estaba.
     */
    if (acepta && !ipDelTutor) {
      toast.warning(
        "Guardamos tus datos, pero no pudimos registrar tu autorización. Vuelve a marcarla en un momento para abrir esa vía de cobro.",
      );
    } else {
      toast.success("Datos de cobro guardados.");
    }
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
              </span>
              {/* El nombre del banco solo cuando el tutor lo eligió. Donde el
                  catálogo es una sola fila centinela, ese nombre no es
                  información: es el mismo texto para todos. */}
              {hayCatalogo
                ? ` · ${
                    guardado.bank_name ??
                    bancos.find((b) => b.bank_code === guardado.bank_code)
                      ?.name ??
                    guardado.bank_code
                  }`
                : ""}
              {/* Las dos frases que seguían aquí —«solo enseñamos los cuatro
                  últimos», «si los dejas en blanco se quedan como están»— las
                  dice ya el placeholder de cada uno de los dos campos
                  enmascarados, y las dice EN el campo, que es donde hacen
                  falta. */}
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

        {/* El desplegable solo donde hay bancos entre los que elegir. Donde el
            número de cuenta identifica al banco —IBAN, número de ruta, sort code,
            BSB, IFSC, BIC— el catálogo es una sola fila centinela
            (`20260910150000`) y preguntar por ella es pedirle al tutor que
            confirme lo único que puede contestar. Se elige en el estado inicial
            del formulario y no se pinta nada. */}
        {hayCatalogo ? (
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
        ) : null}

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
            aria-describedby="ayuda-cuenta"
            onChange={(e) => set("cuenta")(e.target.value)}
          />
          <span
            id="ayuda-cuenta"
            className="mt-1 block text-[12px] text-[#6b6b6b]"
          >
            {regla.account_help}
          </span>
        </label>

        {/* EL SEGUNDO NÚMERO DEL BANCO. Era «la sucursal» cuando solo lo pedían
            Brasil y Uruguay; desde `20260910150000` es también el sort code, el
            número de ruta, el BSB, el IFSC y el BIC. Qué es en cada país lo dice
            `wise_account_type`; el formato, `branch_pattern`. Los países cuyo
            número de cuenta lleva el banco dentro (CBU, CLABE, CCI, IBAN) no lo
            piden y aquí no se pinta. */}
        {regla.requires_branch ? (
          <label className="block">
            <span className="text-xs text-[#6b6b6b]">
              {segundoNumero.etiqueta}
            </span>
            <input
              className={`mt-1 ${CAMPO}`}
              value={v.sucursal}
              disabled={busy}
              autoComplete="off"
              aria-describedby={
                segundoNumero.ayuda ? "ayuda-segundo-numero" : undefined
              }
              onChange={(e) => set("sucursal")(e.target.value)}
            />
            {segundoNumero.ayuda ? (
              <span
                id="ayuda-segundo-numero"
                className="mt-1 block text-[12px] text-[#6b6b6b]"
              >
                {segundoNumero.ayuda}
              </span>
            ) : null}
          </label>
        ) : null}

        {/* EL ESTADO O PROVINCIA. Solo dos corredores lo exigen —Estados Unidos y
            Australia— y ninguno lo documenta: lo dice el 422 de
            `POST /v1/accounts`. Donde no se pide, no se pregunta: un campo
            «Estado» en el formulario de un tutor de Madrid es un campo que se
            queda vacío y se lleva la atención del que sí importa. */}
        {pideEstado ? (
          <label className="block">
            <span className="text-xs text-[#6b6b6b]">
              Estado o provincia
              {mismoPais ? " (guardado)" : ""}
            </span>
            <input
              className={`mt-1 ${CAMPO}`}
              value={estado}
              disabled={busy}
              autoComplete="address-level1"
              maxLength={3}
              placeholder={
                mismoPais ? "Déjalo en blanco para no cambiarlo" : "FL"
              }
              aria-describedby="ayuda-estado"
              onChange={(e) => {
                setEstado(e.target.value);
                setError(null);
              }}
            />
            <span
              id="ayuda-estado"
              className="mt-1 block text-[12px] text-[#6b6b6b]"
            >
              El código corto, de dos o tres letras. Tu banco no acepta la
              transferencia sin él.
            </span>
          </label>
        ) : null}

        {/* ── LOS CAMPOS QUE ANTES ERAN «EXTRAS» ──────────────────────────────

            🔑 SE PIDEN SIEMPRE Y A TODO EL MUNDO, los use el riel de ese país o
            no (decisión del cliente, 11-sep-2026). Hasta hoy la fecha de
            nacimiento vivía bajo un encabezado —«Para abrirte más rutas de
            pago»— y la dirección bajo otro con un «(opcional)» y un párrafo que
            explicaba qué se ganaba rellenándola. Dos secciones y tres párrafos
            para decir que unos campos cuentan menos que otros, y el resultado
            medido de decirlo era que se quedaban en blanco.

            Ahora son campos del formulario, con el mismo aspecto que el resto.

            ⚠️ LO QUE NO CAMBIA ES LA VALIDACIÓN: la base los deja nullable a
            conciencia (`20260907120000`) y `validarCuenta` no los exige.
            Pedirlos a todos no es bloquear a nadie — exigirlos aquí le cortaría
            el guardado a los países que hoy cobran sin ellos, que es peor que un
            campo vacío. */}
        <label className="block">
          <span className="text-xs text-[#6b6b6b]">
            Fecha de nacimiento{guardado ? " (guardada)" : ""}
          </span>
          <input
            type="date"
            className={`mt-1 ${CAMPO}`}
            value={nacimiento}
            disabled={busy}
            autoComplete="bday"
            aria-describedby={guardado ? "ayuda-nacimiento" : undefined}
            onChange={(e) => {
              setNacimiento(e.target.value);
              setError(null);
            }}
          />
          {/* ⚠️ LA ÚNICA AYUDA QUE SOBREVIVIÓ A LA PODA, y solo para quien ya
              guardó. `beneficiary_dob` no tiene `grant select` para
              `authenticated`, así que este campo arranca VACÍO también para él:
              sin esta línea vería «(guardada)» encima de un hueco. Los otros dos
              campos que se conservan en blanco lo dicen en su `placeholder`, y
              un `<input type="date">` no tiene placeholder que valga. */}
          {guardado ? (
            <span
              id="ayuda-nacimiento"
              className="mt-1 block text-[12px] text-[#6b6b6b]"
            >
              Déjala en blanco para no cambiarla.
            </span>
          ) : null}
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs text-[#6b6b6b]">Calle y número</span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.direccion}
            disabled={busy}
            autoComplete="off"
            maxLength={255}
            placeholder="Calle 12 #4-56, apto 301"
            onChange={(e) => set("direccion")(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Ciudad</span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.ciudad}
            disabled={busy}
            autoComplete="off"
            maxLength={255}
            onChange={(e) => set("ciudad")(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Código postal</span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.codigoPostal}
            disabled={busy}
            autoComplete="off"
            maxLength={32}
            onChange={(e) => set("codigoPostal")(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Teléfono</span>
          {/* ⚠️ ESTE ES EL ÚNICO DE LOS CUATRO SIN `maxLength`, Y NO ES UN
              DESCUIDO: `normalizaTelefono` quita los puntos DESPUÉS de teclear,
              así que un tope de 20 aquí cortaría «+57 (300) 123.456.789» —21
              caracteres con puntos, 18 sin ellos— por el final y le comería un
              dígito al número sin decir nada. Un teléfono truncado en silencio
              es peor que un mensaje de error: `validarCuenta` ya rechaza el que
              se pase de 20 ya normalizado, y ahí sí se ve por qué. */}
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.telefono}
            disabled={busy}
            autoComplete="off"
            inputMode="tel"
            placeholder="+57 300 123 4567"
            onChange={(e) => set("telefono")(e.target.value)}
          />
        </label>

        {/* 🔑 LA AUTORIZACIÓN NO ES UN CAMPO Y POR ESO SIGUE APARTE, al final y
            en toda la anchura. Es lo que sella `tos_acceptance` (dictado del
            9-sep, decisión D-1) y lo único de este formulario que no se puede
            acortar quitándole palabras: dice a qué se está autorizando.

            NO nombra a Stripe a propósito — es la misma promesa que el resto de
            la pantalla, que el tutor «jamás se enterará» de quién ejecutó. */}
        <label className="flex cursor-pointer items-start gap-2 sm:col-span-2">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
            checked={acepta}
            disabled={busy}
            onChange={(e) => {
              setAcepta(e.target.checked);
              setError(null);
            }}
          />
          <span className="text-[12px] leading-relaxed text-[#6b6b6b]">
            Autorizo a Enséñame Ya a crear a mi nombre las cuentas de cobro
            necesarias en las plataformas de pago con las que trabaja, y acepto
            sus condiciones de uso para recibir mis pagos.
          </span>
        </label>
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
