"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rpcNueva } from "./rpc";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/** La contraseña literal que exige `manage_payout('devolver')`. */
const PALABRA_DEVOLVER = "COMPROBADO-SIN-RASTRO";

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
  marca,
  canales,
  identificado,
}: {
  payoutId: string;
  status: PayoutStatus;
  /** ¿esta orden no tiene ejecutor automático? Solo cambia los textos. */
  manual: boolean;
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
  const [canal, setCanal] = useState(canales.length === 1 ? canales[0] : "");

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
                placeholder="id de la transferencia, del envío de Zelle/Zinli…"
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
                placeholder="manual"
                value={canal}
                onChange={(e) => setCanal(e.target.value)}
              />
              {/* Sugerencias, no lista cerrada: `payouts.provider` es texto
                  libre y el canal por el que se acaba pagando no siempre es uno
                  de los que el tutor registró. */}
              <datalist id={`${idBase}-canales`}>
                {canales.map((c) => (
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
