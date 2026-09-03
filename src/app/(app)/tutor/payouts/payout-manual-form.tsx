"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  normalizaIdentificador,
  normalizaTitular,
  validarDestinoManual,
  type CanalManual,
  type DestinoManualEnmascarado,
  type ResumenDeDestino,
  type ValoresDeDestino,
} from "@/lib/payout-account";
import { rpcNueva } from "./rpc";

/** Mismo alto y borde que el desplegable de país y que el formulario bancario. */
const CAMPO =
  "h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm text-[#333333] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * El valor de `busy` mientras se guarda. NO es la cadena "guardar" a secas: el
 * mismo estado lleva el `channel` que se está retirando, y un canal puede
 * llamarse cualquier cosa que case con `^[a-z][a-z0-9_]{1,30}$` — «guardar»
 * incluido. Los guiones bajos de delante no pasan esa regex, así que este
 * centinela no puede colisionar con ningún canal, ni hoy ni cuando alguien
 * siembre uno nuevo.
 */
const GUARDANDO = "__guardar__";

/** Regla de oro 4: en la BD va UTC, en pantalla la hora local del que mira. */
const fmtFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * C2m · A dónde cobra el tutor cuando su país NO tiene riel bancario.
 *
 * ── POR QUÉ ES OTRO FORMULARIO Y NO UN CAMPO MÁS DEL DE AL LADO ─────────────
 *
 * Porque no son variantes del mismo dato. `PayoutAccountForm` pide titular +
 * documento fiscal + banco de una lista cerrada + número de cuenta con el
 * formato de su país, y todo eso lo valida `payout_country_rules` contra las
 * ocho filas de dLocal. Venezuela no tiene fila ahí, ni banco en el catálogo, ni
 * documento que dLocal quiera: lo que tiene es un correo de PayPal o un teléfono
 * de Zelle. Meterlo en aquella tabla habría exigido aflojar sus cuatro `check`
 * —el que rechaza la `@`, el `bank_code` NOT NULL con FK, el documento
 * obligatorio y la PK por tutor— **para los ocho países que sí la usan**.
 * `20260902110000` hace lo contrario: tabla aparte, y aquella se queda igual de
 * dura que ayer.
 *
 * ── Y POR QUÉ LOS CANALES LLEGAN POR PROPS ──────────────────────────────────
 *
 * `canales` son filas de `payout_manual_channels`: la etiqueta que se lee, la
 * ayuda, cómo se llama el identificador en ese canal y la expresión regular que
 * lo valida salen de la base de datos y no de este fichero. Es el mismo
 * compromiso que hace que el formulario bancario pida una CLABE en México sin un
 * solo `if (pais === …)` aquí dentro, y lo que garantiza que lo que valida el
 * navegador es exactamente lo que valida el servidor. Abrir un canal nuevo o
 * apagar uno que Legal ya no admite es un `UPDATE`, no un despliegue.
 *
 * ── LA ESCRITURA VA POR RPC, COMO EN B1 ─────────────────────────────────────
 *
 * `tutor_manual_payout_destinations` no tiene `grant insert`, `update` ni
 * `delete` para ningún rol, ni política que los permita. `upsert_manual_
 * destination` y `delete_manual_destination` no son «la forma recomendada»: son
 * la única. Y la lectura vuelve enmascarada porque `handle` tampoco tiene
 * `grant select` para `authenticated` — pedirlo devuelve 42501.
 */
export function PayoutManualForm({
  canales,
  destinos,
  etiquetaPais,
}: {
  /** El catálogo ENTERO, apagados incluidos: hacen falta para nombrar lo guardado. */
  canales: CanalManual[];
  /** Lo que el tutor tiene hoy, enmascarado. */
  destinos: DestinoManualEnmascarado[];
  /** Nombre del país ya resuelto en el servidor (aquí no se importa `nombrePais`). */
  etiquetaPais: string;
}) {
  const router = useRouter();

  /**
   * ⚠️ LA LISTA ES ESTADO, y esa es la corrección de fondo respecto al
   * formulario bancario. Aquel llamaba a la RPC, TIRABA el resumen enmascarado
   * que devuelve —el valor de retorno que su propio comentario justifica— y
   * pedía la página entera otra vez para volver a leer lo que la RPC acababa de
   * darle. Aquí el resumen se usa: se mezcla en esta lista y la pantalla ya está
   * bien antes de que ninguna respuesta del servidor vuelva.
   */
  const [lista, setLista] = useState<DestinoManualEnmascarado[]>(destinos);

  // ponytail: sin `useMemo`. El catálogo son CINCO filas y la lista del tutor
  // como mucho otras cinco; memorizar eso cuesta más líneas de las que ahorra, y
  // además `canales` llega serializado desde el servidor, así que cambia de
  // identidad en cada render y la memoria no se aprovecharía igual.
  const activos = canales.filter((c) => c.is_active);
  const porClave = new Map<string, CanalManual>(
    canales.map((c) => [c.channel, c]),
  );

  // El orden del catálogo (`sort_order`) es el MISMO con el que
  // `manual_destination()` le sirve la lista a quien paga, así que «la de
  // arriba» significa lo mismo en las dos pantallas. Un canal que ya no esté en
  // el catálogo cae al final en vez de desordenar el resto.
  const posicion = (channel: string) => {
    const i = canales.findIndex((c) => c.channel === channel);
    return i === -1 ? canales.length : i;
  };
  const ordenada = [...lista].sort(
    (a, b) => posicion(a.channel) - posicion(b.channel),
  );

  const [v, setV] = useState<ValoresDeDestino>({
    canal: activos[0]?.channel ?? "",
    // El titular no cambia de un canal a otro, así que se arrastra el que ya
    // haya: es un dato que el tutor no tiene por qué volver a teclear.
    titular: destinos[0]?.holder_name ?? "",
    identificador: "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canal = porClave.get(v.canal) ?? null;
  const yaRegistrado = lista.find((d) => d.channel === v.canal) ?? null;

  function elegirCanal(clave: string) {
    setError(null);
    setV((prev) => {
      const existente = lista.find((d) => d.channel === clave);
      return {
        canal: clave,
        // Si ya tiene ese canal, se prerrellena el titular guardado. El
        // identificador NO: la BD solo devuelve `····1234` y prerrellenar una
        // máscara es ofrecerle al tutor guardarla como si fuera su correo.
        titular: existente?.holder_name ?? prev.titular,
        identificador: "",
      };
    });
  }

  async function guardar() {
    const fallo = validarDestinoManual(canal, v);
    if (fallo) {
      setError(fallo);
      return;
    }

    setBusy(GUARDANDO);
    const { data, error: err } = await rpcNueva<ResumenDeDestino>(
      createClient(),
      "upsert_manual_destination",
      {
        p_channel: v.canal,
        // Se manda ya normalizado, aunque la RPC vuelva a normalizarlo: así lo
        // que el tutor confirma en pantalla es lo mismo que se guarda. La RPC
        // no confía en esto y hace su propia pasada, que es lo correcto — el
        // navegador no es una fuente de verdad.
        p_holder_name: normalizaTitular(v.titular),
        p_handle: normalizaIdentificador(v.identificador),
      },
    );
    setBusy(null);

    if (err || !data) {
      // El mensaje de la RPC ya está escrito para el tutor y NO lleva el
      // identificador dentro (`20260901170000`), así que se enseña tal cual.
      setError(err?.message || "No se pudo guardar tu forma de cobro.");
      return;
    }

    // Aquí está el uso del valor de retorno: la fila se repinta con lo que la
    // BD acaba de guardar —enmascarado por ella, no por nosotros— sin volver a
    // consultar.
    setLista((prev) => [
      ...prev.filter((d) => d.channel !== data.channel),
      {
        channel: data.channel,
        holder_name: data.holder_name,
        handle_masked: data.handle_masked,
        updated_at: data.updated_at,
      },
    ]);
    setV((prev) => ({ ...prev, titular: data.holder_name, identificador: "" }));
    toast.success(`Guardado. Te pagaremos por ${data.label}.`);
    // El `refresh` ya NO es lo que hace correcto este formulario: es lo que pone
    // al día la píldora «Cuenta de cobro» del bloque de arriba, que la pinta el
    // servidor. Si tardara o fallara, lo que el tutor ve aquí ya es lo bueno.
    router.refresh();
  }

  async function quitar(clave: string) {
    setError(null);
    setBusy(clave);
    const { error: err } = await rpcNueva<{ channel: string; deleted: boolean }>(
      createClient(),
      "delete_manual_destination",
      { p_channel: clave },
    );
    setBusy(null);

    if (err) {
      setError(err.message || "No se pudo retirar esa forma de cobro.");
      return;
    }

    setLista((prev) => prev.filter((d) => d.channel !== clave));
    toast.success("Retirado. Ya no te pagaremos por ahí.");
    router.refresh();
  }

  // Sin catálogo no se pinta un desplegable vacío: se dice por qué. Pasa si
  // alguien apaga las cinco filas, y entonces lo que hay que mirar es
  // `payout_manual_channels`, no esta pantalla.
  if (activos.length === 0) {
    return (
      <p className="mt-2 max-w-[620px] text-[13px] text-[#6b6b6b]">
        Ahora mismo no hay ninguna forma de cobro disponible para{" "}
        {etiquetaPais}. Tu saldo se sigue acumulando y te avisaremos en cuanto se
        abra alguna.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="max-w-[620px] text-[13px] text-[#6b6b6b]">
        A {etiquetaPais} no llega ninguna transferencia bancaria internacional,
        así que tus cobros los envía una persona de nuestro equipo a la cuenta
        que nos digas. Tiene que estar <strong>a tu nombre</strong>: no podemos
        pagar a la cuenta de otra persona.
      </p>

      {ordenada.length > 0 ? (
        <ul className="mt-3 divide-y divide-[#e0e0e0] rounded-[8px] border border-[#e0e0e0]">
          {ordenada.map((d) => {
            const c = porClave.get(d.channel);
            return (
              <li
                key={d.channel}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#19191f]">
                    {c?.label ?? d.channel}{" "}
                    <span className="font-normal tabular-nums text-[#595959]">
                      {d.handle_masked}
                    </span>
                  </p>
                  <p className="text-xs text-[#6b6b6b]">
                    {d.holder_name} · guardado el {fmtFecha(d.updated_at)}
                    {/* Un canal apagado no desaparece de la lista: el tutor
                        sigue esperando su dinero y hay que decírselo, no
                        borrarle el dato sin explicación. */}
                    {c && !c.is_active
                      ? " · ya no está disponible, elige otra forma de cobro"
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => quitar(d.channel)}
                  className="h-[34px] shrink-0 rounded-[8px] border border-[#e8b4b4] px-3 text-[13px] font-medium text-[#bf3333] transition-colors hover:bg-[#fdf0f0] disabled:opacity-50"
                >
                  {busy === d.channel ? "Retirando…" : "Retirar"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Se permiten VARIOS a propósito: la PK es `(tutor_id, channel)` y quien
          paga es una persona, que necesita poder tirar de un segundo canal si el
          primero no confirma. Pero entonces hay que decir quién elige, porque el
          tutor no puede adivinarlo mirando esta lista. */}
      {ordenada.length > 1 ? (
        <p className="mt-2 max-w-[620px] text-[13px] text-[#6b6b6b]">
          Tienes {ordenada.length} formas de cobro registradas. Usamos una sola
          por pago y la elige quien te lo envía, empezando por la de arriba; si
          no llega, prueba con la siguiente. Si prefieres que sea siempre la
          misma, retira las demás.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-[#6b6b6b]">
            {ordenada.length > 0 ? "Añadir o cambiar" : "¿Por dónde cobras?"}
          </span>
          <select
            className={`mt-1 ${CAMPO}`}
            value={v.canal}
            disabled={busy !== null}
            onChange={(e) => elegirCanal(e.target.value)}
          >
            {activos.map((c) => (
              <option key={c.channel} value={c.channel}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-[#6b6b6b]">Nombre del titular</span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.titular}
            disabled={busy !== null}
            autoComplete="off"
            placeholder="Tu nombre, tal y como está en la cuenta"
            onChange={(e) => {
              setError(null);
              setV((prev) => ({ ...prev, titular: e.target.value }));
            }}
          />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-xs text-[#6b6b6b]">
            {canal?.handle_label ?? "Identificador"}
            {yaRegistrado ? " (guardado)" : ""}
          </span>
          <input
            className={`mt-1 ${CAMPO}`}
            value={v.identificador}
            disabled={busy !== null}
            autoComplete="off"
            inputMode="text"
            placeholder={
              yaRegistrado
                ? `Escríbelo de nuevo para cambiarlo (ahora: ${yaRegistrado.handle_masked})`
                : (canal?.handle_label ?? "")
            }
            onChange={(e) => {
              setError(null);
              setV((prev) => ({ ...prev, identificador: e.target.value }));
            }}
          />
          {canal ? (
            <span className="mt-1 block text-[12px] text-[#6b6b6b]">
              {canal.help}
            </span>
          ) : null}
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
        disabled={busy !== null}
        onClick={guardar}
      >
        {busy === GUARDANDO
          ? "Guardando…"
          : yaRegistrado
            ? "Cambiar esta forma de cobro"
            : "Guardar forma de cobro"}
      </Button>
    </div>
  );
}
