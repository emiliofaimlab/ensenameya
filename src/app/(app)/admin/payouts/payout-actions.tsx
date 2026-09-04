"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rpcNueva, type FamiliaDeDato } from "./rpc";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/** La contraseña literal que exige `manage_payout('devolver')`. */
const PALABRA_DEVOLVER = "COMPROBADO-SIN-RASTRO";

/**
 * Qué se le pide de referencia según lo que se acaba de hacer con el dinero.
 *
 * ⚠️ El texto ANTERIOR era uno solo y decía «id de la transferencia, del envío
 * de Zelle/Zinli…»: los tres canales de `payout_manual_channels` son de
 * Venezuela, y a quien acaba de hacer una transferencia bancaria colombiana
 * ese ejemplo no le dice nada. `mark_paid` no cambia —guarda lo que se le dé en
 * `provider_metadata->'manual'->>'referencia'`—; lo que cambia es el ejemplo.
 */
const AYUDA_DE_REFERENCIA: Record<FamiliaDeDato, string> = {
  banco: "número de comprobante de la transferencia",
  identificador: "id del envío de Zelle/Zinli/Binance…",
  // ⚠️ 'conectada' no debería llegar aquí —un payout por Connect lo ejecuta
  // Stripe, no una persona— pero el `Record` la exige y poner un texto es más
  // barato que un tipo parcial. Si aparece en pantalla, lo que hay que mirar no
  // es este texto: es por qué un riel automático acabó en el formulario de
  // marcar a mano.
  conectada: "id de la transferencia de Stripe (tr_…)",
};

/**
 * Sugerencias de canal, que NO son una lista cerrada: `payouts.provider` es
 * texto libre y el canal por el que se acaba pagando no siempre es el que el
 * tutor registró. En la familia bancaria no hay canal que registrar —lo que hay
 * es una transferencia— así que la sugerencia sale de aquí y no de la BD.
 */
const CANALES_DE_BANCO = ["transferencia"];

type Accion = {
  action: string;
  label: string;
  /** ¿pide datos antes de ejecutarse? Si no, se manda al pulsar. */
  formulario: boolean;
  peligrosa?: boolean;
};

/**
 * Acciones válidas por estado (M7). La BD las vuelve a validar en
 * `manage_payout`, que es quien manda: esto es solo qué botón se enseña.
 *
 * ⚠️ `processing` YA NO ESTÁ VACÍO, y ese hueco era el peor de la pantalla: la
 * fila más peligrosa del sistema —una orden reclamada de la que no se sabe si el
 * proveedor llegó a crear el payout— no la podía tocar nadie desde aquí. Se
 * cierra con las dos acciones de `20260902120000`: `anotar` si el pago aparece
 * en el panel del proveedor y `devolver` si se ha comprobado que no existe.
 *
 * `paid` sigue vacío a propósito: un payout pagado es un hecho, no un estado que
 * se corrija con un botón.
 */
const ACTIONS: Record<PayoutStatus, Accion[]> = {
  pending: [{ action: "hold", label: "Retener", formulario: false }],
  scheduled: [
    { action: "mark_paid", label: "Marcar pagado", formulario: true },
    { action: "hold", label: "Retener", formulario: false },
  ],
  failed: [
    { action: "retry", label: "Reintentar", formulario: false },
    { action: "mark_paid", label: "Marcar pagado", formulario: true },
    { action: "hold", label: "Retener", formulario: false },
  ],
  on_hold: [
    { action: "release", label: "Liberar", formulario: false },
    { action: "mark_paid", label: "Marcar pagado", formulario: true },
  ],
  processing: [
    { action: "anotar", label: "Anotar el pago", formulario: true },
    {
      action: "devolver",
      label: "Devolver a la cola",
      formulario: true,
      peligrosa: true,
    },
  ],
  paid: [],
};

export function PayoutActions({
  payoutId,
  status,
  manual,
  familia,
  marca,
  canales,
  identificado,
}: {
  payoutId: string;
  status: PayoutStatus;
  /** ¿esta orden no tiene ejecutor automático? Solo cambia los textos. */
  manual: boolean;
  /**
   * Qué clase de destino tiene este riel, para que el formulario hable de lo
   * que quien paga acaba de hacer. `null` = no se sabe (no hay riel resuelto).
   *
   * ⚠️ Se decide con la FAMILIA DE DATO del riel, nunca por país ni por la
   * clave del proveedor: son cuatro rieles hoy y mañana más, y «lo que pide el
   * tutor» es la única pregunta que este formulario necesita responder. Una
   * transferencia bancaria y un envío por Zelle se justifican con referencias
   * distintas y salen por canales distintos.
   */
  familia: FamiliaDeDato | null;
  /** `EY-<payout>-<intento>`: lo que hay que buscar en el panel del proveedor. */
  marca: string;
  /** Canales que el tutor tiene registrados, para sugerirlos sin obligar. */
  canales: string[];
  /**
   * ¿la orden arrastra ya un `provider_payout_id`? Decide si se ofrece
   * «Devolver a la cola», y NO es un detalle de presentación: ver abajo.
   */
  identificado: boolean;
}) {
  const router = useRouter();
  const idBase = useId();
  const [busy, setBusy] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [referencia, setReferencia] = useState("");
  // En la familia bancaria `canales` llega vacío (el tutor no registra canales,
  // registra una cuenta), así que la sugerencia sale de la constante. Con una
  // sola sugerencia se prerrellena: es lo que va a ser en el 100 % de los casos
  // y sigue siendo editable.
  const sugerencias = familia === "banco" ? CANALES_DE_BANCO : canales;
  const [canal, setCanal] = useState(
    sugerencias.length === 1 ? sugerencias[0] : "",
  );

  // 🔴 «Devolver a la cola» se ofrece SOLO sobre órdenes sin identificar, y no
  // por limpieza visual: la contraseña que pide («he buscado la marca en el
  // panel del proveedor y no existe nada») es FALSA POR CONSTRUCCIÓN cuando la
  // orden ya tiene `provider_payout_id`, porque ese identificador lo escribió el
  // propio job con lo que le respondió el proveedor. La RPC lo rechaza desde
  // `20260902160000`, así que dejar el botón puesto es ofrecer un trabajo —leer
  // el aviso rojo, ir al panel, teclear la contraseña— que termina en un error
  // de 400 caracteres. Para esas hay «Anotar el pago», que es lo correcto.
  const actions = ACTIONS[status].filter(
    (a) => a.action !== "devolver" || !identificado,
  );
  if (actions.length === 0) return null;

  function cerrar() {
    setAbierta(null);
    setReferencia("");
  }

  async function run(action: string, ref?: string, canalUsado?: string) {
    setBusy(true);
    // ⚠️ `rpcNueva` y no `supabase.rpc(...)` directo: `database.types.ts` todavía
    // tiene la firma vieja de dos argumentos y `p_referencia` no compilaría.
    // Ver `./rpc.ts`.
    const { error } = await rpcNueva<string>(createClient(), "manage_payout", {
      p_payout_id: payoutId,
      p_action: action,
      p_referencia: ref ?? null,
      p_canal: canalUsado?.trim() ? canalUsado.trim() : null,
    });
    setBusy(false);
    if (error) {
      // Los mensajes de `manage_payout` están escritos para leerse tal cual
      // (dicen qué falta y qué hacer): se enseñan enteros, sin resumir.
      toast.error(error.message || "No se pudo actualizar el payout.");
      return;
    }
    toast.success("Payout actualizado.");
    cerrar();
    router.refresh();
  }

  const refLimpia = referencia.trim();
  const puedeEnviar =
    abierta === "devolver" ? refLimpia === PALABRA_DEVOLVER : refLimpia.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.action}
            size="sm"
            variant={a.peligrosa ? "destructive" : "outline"}
            disabled={busy}
            aria-expanded={a.formulario ? abierta === a.action : undefined}
            onClick={() => {
              if (!a.formulario) {
                void run(a.action);
                return;
              }
              if (abierta === a.action) cerrar();
              else {
                setAbierta(a.action);
                setReferencia("");
              }
            }}
          >
            {a.label}
          </Button>
        ))}
      </div>

      {/* ── Cerrar el ciclo a mano ───────────────────────────────────────── */}
      {abierta === "mark_paid" ? (
        <form
          className="flex flex-col gap-2 rounded-[10px] border border-[#e0e0e0] bg-[#f7f7f9] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (puedeEnviar) void run("mark_paid", refLimpia, canal);
          }}
        >
          <p className="text-[13px] font-semibold text-[#19191f]">
            El pago ya está hecho por fuera
          </p>
          {/* La única línea que justifica el campo obligatorio. */}
          <p className="text-xs text-[#6b6b6b]">
            La referencia es obligatoria porque es lo único que permitirá
            reconciliar este payout con el extracto: sin ella queda una fila que
            dice «pagado» y nada con lo que demostrarlo.
            {manual
              ? " Esta orden no tiene ejecutor automático, así que este botón es la única forma de cerrarla."
              : ""}
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <Label htmlFor={`${idBase}-ref`}>
                Referencia del movimiento
              </Label>
              <Input
                id={`${idBase}-ref`}
                required
                autoComplete="off"
                placeholder={
                  familia
                    ? AYUDA_DE_REFERENCIA[familia]
                    : "id del movimiento"
                }
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            </div>
            <div className="flex min-w-[160px] flex-col gap-1.5">
              <Label htmlFor={`${idBase}-canal`}>Canal (opcional)</Label>
              <Input
                id={`${idBase}-canal`}
                list={`${idBase}-canales`}
                autoComplete="off"
                placeholder={familia === "banco" ? "transferencia" : "manual"}
                value={canal}
                onChange={(e) => setCanal(e.target.value)}
              />
              {/* Sugerencias, no lista cerrada: ver `CANALES_DE_BANCO`. */}
              <datalist id={`${idBase}-canales`}>
                {sugerencias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <p className="text-xs text-[#6b6b6b]">
            Al confirmar, el tutor recibe el aviso de que su liquidación está
            pagada (NTF-12). Aquí eso es correcto: el dinero se movió de verdad.
          </p>
          <Botones busy={busy} puedeEnviar={puedeEnviar} onCancel={cerrar} />
        </form>
      ) : null}

      {/* ── El pago SÍ aparece en el panel del proveedor ─────────────────── */}
      {abierta === "anotar" ? (
        <form
          className="flex flex-col gap-2 rounded-[10px] border border-[#e0e0e0] bg-[#f7f7f9] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (puedeEnviar) void run("anotar", refLimpia, canal);
          }}
        >
          <p className="text-[13px] font-semibold text-[#19191f]">
            Encontrado en el panel del proveedor
          </p>
          <p className="text-xs text-[#6b6b6b]">
            Busca{" "}
            <code className="font-mono select-all">{marca}</code> en el panel del
            proveedor. Si existe, pega aquí el identificador que él le dio al
            payout: es la marca con la que se buscó, y sin ella no se está
            anotando nada, se está adivinando.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-anotar`}>
              Identificador del proveedor
            </Label>
            <Input
              id={`${idBase}-anotar`}
              required
              autoComplete="off"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
          <Botones busy={busy} puedeEnviar={puedeEnviar} onCancel={cerrar} />
        </form>
      ) : null}

      {/* ── El pago NO existe: se devuelve a la cola ─────────────────────── */}
      {abierta === "devolver" ? (
        <form
          className="flex flex-col gap-2 rounded-[10px] border border-[#e8b4b4] bg-[#fdf0f0] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (puedeEnviar) void run("devolver", refLimpia);
          }}
        >
          <p className="text-[13px] font-semibold text-[#8f2b2b]">
            Devolver a la cola es elegir pagar dos veces si el proveedor sí lo
            creó
          </p>
          <p className="text-xs text-[#8f2b2b]">
            No hay deshacer: el dinero sale del balance del proveedor y el
            segundo envío es tan real como el primero. Hazlo <strong>solo</strong>{" "}
            después de buscar{" "}
            <code className="font-mono select-all">{marca}</code> en su panel y
            comprobar que <strong>no existe nada</strong> con esa marca. Si la
            búsqueda no es concluyente, lo correcto es no hacer nada y dejarla en
            «Procesando»: ahí la sigue contando el aviso rojo de arriba, que es
            incómodo a propósito.
          </p>
          <div className="flex flex-col gap-1.5">
            {/* Se escribe la palabra, no se marca una casilla: un booleano se
                pone a true sin leer nada. Es la misma confirmación que exige la
                propia RPC, no una capa de UI encima. */}
            <Label htmlFor={`${idBase}-devolver`}>
              Escribe {PALABRA_DEVOLVER} para confirmar
            </Label>
            <Input
              id={`${idBase}-devolver`}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={PALABRA_DEVOLVER}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
          <Botones
            busy={busy}
            puedeEnviar={puedeEnviar}
            onCancel={cerrar}
            etiqueta="Devolver a la cola"
            peligrosa
          />
        </form>
      ) : null}
    </div>
  );
}

function Botones({
  busy,
  puedeEnviar,
  onCancel,
  etiqueta = "Confirmar",
  peligrosa = false,
}: {
  busy: boolean;
  puedeEnviar: boolean;
  onCancel: () => void;
  etiqueta?: string;
  peligrosa?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {/* Sin el dato obligatorio el botón NO envía: la BD lo rechazaría igual,
          pero enterarse por un toast rojo después de pulsar es peor. */}
      <Button
        type="submit"
        size="sm"
        variant={peligrosa ? "destructive" : "default"}
        disabled={busy || !puedeEnviar}
      >
        {etiqueta}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={onCancel}
      >
        Cancelar
      </Button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * EL DATO QUE HAY QUE TECLEAR EN LA WEB DE UN BANCO
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Parte un número largo en bloques de cuatro **sin tocar el texto**.
 *
 * Solo agrupa lo que es todo dígitos y pasa de ocho: una cuenta brasileña
 * («12345-6») o uruguaya lleva guiones y ceros de delante que son parte del
 * formato del banco, y trocear eso es convertir un dato correcto en un dato
 * ilegible.
 */
function bloquesDeCuatro(valor: string): string[] {
  if (!/^[0-9]{9,}$/.test(valor)) return [valor];
  return valor.match(/.{1,4}/g) ?? [valor];
}

/**
 * 🔴 UN NÚMERO DE CUENTA QUE SE COPIA MAL ES UNA TRANSFERENCIA A OTRA PERSONA.
 *
 * Quien mira esta pantalla está a punto de teclear once dígitos en la web de su
 * banco, y ahí no hay «deshacer»: el dinero sale, y el error no lo paga quien
 * lo comete. Los dos modos de equivocarse son leerlo mal y teclearlo mal, y se
 * cierran los dos:
 *
 *   · **Leerlo mal** → se pinta en monoespaciada, con cifras de ancho fijo
 *     (`tabular-nums`) y agrupado en bloques de cuatro, que es la convención
 *     con la que se leen los IBAN y las tarjetas. ⚠️ Y la agrupación es CSS,
 *     NO caracteres: son `<span>` con margen, sin un solo espacio metido en el
 *     texto. Por eso seleccionar y copiar a mano devuelve los dígitos exactos —
 *     meter espacios de verdad habría sido regalarle al admin un número que
 *     algunos bancos rechazan y otros aceptan silenciosamente truncado.
 *   · **Teclearlo mal** → un botón que copia la cadena EXACTA al portapapeles,
 *     y que dice que lo ha hecho. Si el navegador lo deniega (portapapeles
 *     bloqueado, contexto no seguro) no se finge que fue bien: se avisa y se
 *     recuerda que el dato está seleccionable entero.
 *
 * ⚠️ Vive en este fichero, que es el único `"use client"` de la carpeta, porque
 * escribir en el portapapeles es del navegador y la pantalla es un componente
 * de servidor. El dato en claro llega ya resuelto desde el servidor (regla de
 * oro 3): esto no consulta nada.
 */
export function DatoCopiable({
  valor,
  etiqueta,
}: {
  valor: string;
  /** Cómo se llama el dato en el aviso y en el `aria-label` («la cuenta»). */
  etiqueta: string;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(
        `No se pudo copiar ${etiqueta}: este navegador no da acceso al portapapeles. Pulsa sobre el número —se selecciona entero— y cópialo con el teclado.`,
      );
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono text-[13.5px] font-semibold text-[#19191f] tabular-nums select-all">
        {bloquesDeCuatro(valor).map((b, i) => (
          <span key={i} className={i > 0 ? "ml-[0.45em]" : undefined}>
            {b}
          </span>
        ))}
      </span>
      <button
        type="button"
        onClick={() => void copiar()}
        aria-label={`Copiar ${etiqueta}`}
        className="rounded-[6px] border border-[#d4d4d8] bg-white px-2 py-0.5 text-[11px] text-[#404040] hover:bg-[#f0f0f2]"
      >
        {copiado ? "copiado ✓" : "copiar"}
      </button>
    </span>
  );
}
