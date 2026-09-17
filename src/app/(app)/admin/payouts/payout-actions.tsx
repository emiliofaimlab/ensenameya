"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAYOUT_PROOF_HINT,
  PAYOUT_PROOF_MAX_BYTES,
  PAYOUT_PROOF_MAX_FILES,
  PAYOUT_PROOF_TYPES,
  fileProblem,
  humanSize,
} from "@/components/tutor/upload-formats";
import { rpcNueva, type FamiliaDeDato } from "./rpc";

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

/** La contraseña literal que exige `manage_payout('devolver')`. */
const PALABRA_DEVOLVER = "COMPROBADO-SIN-RASTRO";

/** El bucket privado del punto 3 (`20260916110000`). */
const BUCKET_COMPROBANTES = "payout-proofs";

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
  // ⚠️ Aquí había una tercera clave, 'conectada', para el payout por Stripe
  // Connect. Se fue con la familia entera en el dictado del 9-sep-2026: el
  // tutor ya no da de alta ninguna cuenta conectada, así que ese caso no puede
  // llegar a este formulario.
};

/**
 * Sugerencias de canal, que NO son una lista cerrada: `payouts.provider` es
 * texto libre y el canal por el que se acaba pagando no siempre es el que el
 * tutor registró. En la familia bancaria no hay canal que registrar —lo que hay
 * es una transferencia— así que la sugerencia sale de aquí y no de la BD.
 */
const CANALES_DE_BANCO = ["transferencia"];

/**
 * El nombre del fichero, reducido a lo que un `key` de Storage acepta sin
 * discutir. NO se usa como identificador —delante va un uuid— así que puede
 * chocar con otro: solo sirve para que la lista del admin y la del tutor digan
 * «transferencia-nestor.pdf» y no treinta y seis caracteres de hexadecimal.
 */
function nombreSeguro(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // tildes fuera, que Storage no las quiere
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+/, "")
      .slice(-60) || "comprobante"
  );
}

type Accion = {
  action: string;
  label: string;
  /** ¿pide datos antes de ejecutarse? Si no, se manda al pulsar. */
  formulario: boolean;
  peligrosa?: boolean;
  /**
   * ¿es LA acción de esta fila? Solo una por estado, y se pinta sólida. El
   * resto van de contorno: hasta ahora los tres botones pesaban lo mismo y
   * elegir entre «Marcar pagado», «Retener» y «Reintentar» era leerse los tres.
   */
  principal?: boolean;
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
    { action: "mark_paid", label: "Marcar pagado", formulario: true, principal: true },
    { action: "hold", label: "Retener", formulario: false },
  ],
  // ⚠️ El ORDEN de estas dos listas es el de siempre a propósito: sobre una
  // orden fallida lo primero que hay que considerar sigue siendo «Reintentar»
  // (el riel vuelve a intentarlo solo), y sobre una retenida, «Liberar». Lo
  // único que cambia es el PESO visual, no la secuencia.
  failed: [
    { action: "retry", label: "Reintentar", formulario: false },
    { action: "mark_paid", label: "Marcar pagado", formulario: true, principal: true },
    { action: "hold", label: "Retener", formulario: false },
  ],
  on_hold: [
    { action: "release", label: "Liberar", formulario: false },
    { action: "mark_paid", label: "Marcar pagado", formulario: true, principal: true },
  ],
  processing: [
    { action: "anotar", label: "Anotar el pago", formulario: true, principal: true },
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
   * clave del proveedor: son tres rieles automáticos hoy —dLocal, Wise y PayPal— y mañana más, y «lo que pide el
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
  const idForm = `${idBase}-form`;
  const [busy, setBusy] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [referencia, setReferencia] = useState("");
  // En la familia bancaria `canales` llega vacío (el tutor no registra canales,
  // registra una cuenta), así que la sugerencia sale de la constante. Con una
  // sola sugerencia se prerrellena: es lo que va a ser en el 100 % de los casos
  // y sigue siendo editable.
  const sugerencias = familia === "banco" ? CANALES_DE_BANCO : canales;
  const canalPorDefecto = sugerencias.length === 1 ? sugerencias[0] : "";
  const [canal, setCanal] = useState(canalPorDefecto);
  /** Punto 3: el papel del pago. OPCIONAL — ver el formulario. */
  const [comprobantes, setComprobantes] = useState<File[]>([]);
  /**
   * 🔑 EL ERROR, EN LÍNEA Y NO SOLO EN UN TOAST. Los mensajes de
   * `manage_payout` están escritos para leerse despacio —dicen qué falta, por
   * qué y qué hacer, y alguno pasa de 300 caracteres— y hasta hoy se iban solos
   * a los pocos segundos. Se quedan aquí, con `role="alert"`, hasta que se
   * corrige lo que sea. El toast se mantiene porque avisa aunque el formulario
   * esté fuera de la pantalla.
   */
  const [error, setError] = useState<string | null>(null);
  /** Qué está pasando ahora mismo: subir tres ficheros no es instantáneo. */
  const [paso, setPaso] = useState<string | null>(null);

  /**
   * Accesibilidad: al abrir un formulario, el foco va a su primer campo. Sin
   * esto el foco se queda en el botón que lo abrió y quien navega con teclado
   * no tiene ni forma de saber que han aparecido campos debajo.
   */
  const primerCampo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (abierta) primerCampo.current?.focus();
  }, [abierta]);

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

  /** Cierra el formulario y deja el estado como estaba antes de abrirlo. */
  function cerrar() {
    setAbierta(null);
    setReferencia("");
    // ⚠️ `canal` NO se limpiaba, y es un dato que se manda a la BD: quien abría
    // «Marcar pagado», escribía «zelle» y cancelaba para abrir «Anotar» seguía
    // arrastrando ese canal en el estado. Hoy `anotar` lo ignora a propósito
    // (`20260910230000`), o sea que el fallo está tapado por la RPC — que es la
    // peor forma de estar arreglado.
    setCanal(canalPorDefecto);
    setComprobantes([]);
    setError(null);
    setPaso(null);
  }

  /** Un fallo que hay que poder releer: en línea y en el toast. */
  function fallo(mensaje: string) {
    setError(mensaje);
    toast.error(mensaje);
  }

  function elegirFicheros(e: ChangeEvent<HTMLInputElement>) {
    const elegidos = Array.from(e.target.files ?? []);
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (elegidos.length === 0) return;

    const hueco = PAYOUT_PROOF_MAX_FILES - comprobantes.length;
    if (elegidos.length > hueco) {
      fallo(
        `Caben ${PAYOUT_PROOF_MAX_FILES} comprobantes por pago y ya has elegido ${comprobantes.length}. Quita alguno si necesitas cambiarlo.`,
      );
      return;
    }
    // Se comprueban TODOS antes de quedarse con ninguno: aceptar dos y rechazar
    // el tercero deja una lista a medias que nadie pidió.
    for (const f of elegidos) {
      const problema = fileProblem(f, {
        types: PAYOUT_PROOF_TYPES,
        maxBytes: PAYOUT_PROOF_MAX_BYTES,
        hint: PAYOUT_PROOF_HINT,
      });
      if (problema) {
        fallo(problema);
        return;
      }
    }
    setError(null);
    setComprobantes((prev) => [...prev, ...elegidos]);
  }

  async function run(action: string, ref?: string, canalUsado?: string) {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // ── 1 · El papel, a Storage ───────────────────────────────────────────────
    //
    // Sube ANTES de tocar la BD porque un fichero que Storage rechaza (un MIME
    // que no está en el bucket, 10 MB y pico) es mejor descubrirlo antes de
    // mandarle a un tutor el aviso de que ya cobró. El precio es un objeto
    // huérfano si la fila falla después: es un fichero suelto en un bucket
    // privado, no un dato mal escrito, y no hay forma de limpiarlo desde aquí
    // (Storage prohíbe `delete from storage.objects` desde SQL y la cola de
    // purga solo la escribe `service_role`).
    const subidos: { path: string; nombre: string }[] = [];
    if (action === "mark_paid" && comprobantes.length > 0) {
      for (const [i, f] of comprobantes.entries()) {
        setPaso(`Subiendo ${i + 1} de ${comprobantes.length}…`);
        // La CARPETA es el payout: es lo que mira la política que deja al tutor
        // ver el suyo, y lo que exige la RPC. El uuid de delante evita que dos
        // «IMG_0042.jpg» se pisen.
        const path = `${payoutId}/${crypto.randomUUID()}-${nombreSeguro(f.name)}`;
        const { error: errSubida } = await supabase.storage
          .from(BUCKET_COMPROBANTES)
          .upload(path, f, { contentType: f.type });
        if (errSubida) {
          setBusy(false);
          setPaso(null);
          fallo(
            `No se pudo subir «${f.name}»: ${errSubida.message}. No se marcó nada como pagado y el tutor no recibió ningún aviso.`,
          );
          return;
        }
        subidos.push({ path, nombre: f.name });
      }
    }

    // ── 2 · La fila ───────────────────────────────────────────────────────────
    setPaso(action === "mark_paid" ? "Marcando el pago…" : null);
    // ⚠️ `rpcNueva` y no `supabase.rpc(...)` directo: `database.types.ts` todavía
    // tiene la firma vieja de dos argumentos y `p_referencia` no compilaría.
    // Ver `./rpc.ts`.
    const { error: errAccion } = await rpcNueva<string>(supabase, "manage_payout", {
      p_payout_id: payoutId,
      p_action: action,
      p_referencia: ref ?? null,
      p_canal: canalUsado?.trim() ? canalUsado.trim() : null,
    });
    if (errAccion) {
      setBusy(false);
      setPaso(null);
      // Los mensajes de `manage_payout` están escritos para leerse tal cual
      // (dicen qué falta y qué hacer): se enseñan enteros, sin resumir.
      fallo(errAccion.message || "No se pudo actualizar el payout.");
      return;
    }

    // ── 3 · Y el papel se anota en la fila, DESPUÉS ───────────────────────────
    //
    // 🔴 ESTE ORDEN NO ES NEGOCIABLE, aunque leído parezca al revés. La rama
    // 'mark_paid' de `manage_payout` no añade a `provider_metadata->'manual'`:
    // lo **reescribe entero** con `jsonb_set(v_meta, '{manual}',
    // jsonb_build_object('referencia', …))` (`20260910230000`). Anotar el
    // comprobante antes lo borraría ahí mismo, sin error y sin rastro: fichero
    // subido, fila «Pagado», y el papel no está.
    for (const c of subidos) {
      setPaso("Adjuntando el comprobante…");
      const { error: errAdj } = await rpcNueva<null>(
        supabase,
        "adjuntar_comprobante_payout",
        { p_payout_id: payoutId, p_path: c.path, p_nombre: c.nombre },
      );
      if (errAdj) {
        setBusy(false);
        setPaso(null);
        // El pago YA está marcado y el aviso YA ha salido: decirlo entero, y no
        // cerrar el formulario ni refrescar, para que este texto se pueda leer.
        fallo(
          `El pago quedó marcado como pagado y el tutor ya recibió el aviso, pero «${c.nombre}» no se pudo adjuntar: ${errAdj.message}. La referencia sí está guardada. Recarga la pantalla para ver la fila al día.`,
        );
        return;
      }
    }

    setBusy(false);
    setPaso(null);
    toast.success(
      subidos.length > 0
        ? `Payout actualizado con ${subidos.length === 1 ? "su comprobante" : `${subidos.length} comprobantes`}.`
        : "Payout actualizado.",
    );
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
            // Jerarquía: una sola sólida por fila, la peligrosa en rojo y el
            // resto de contorno.
            variant={
              a.peligrosa ? "destructive" : a.principal ? "default" : "outline"
            }
            disabled={busy}
            aria-expanded={a.formulario ? abierta === a.action : undefined}
            aria-controls={a.formulario ? idForm : undefined}
            onClick={() => {
              if (!a.formulario) {
                void run(a.action);
                return;
              }
              if (abierta === a.action) cerrar();
              else {
                // Se abre limpio: lo que se tecleó en otro diálogo no vale en
                // este (ver `cerrar()`).
                cerrar();
                setAbierta(a.action);
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
          id={idForm}
          className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-muted p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (puedeEnviar) void run("mark_paid", refLimpia, canal);
          }}
        >
          <p className="text-[13px] font-semibold text-foreground">
            El pago ya está hecho por fuera
          </p>
          {/* ⚠️ El texto va en `--muted-foreground` (#4d4d4d) y no en el
              `--muted-foreground-weak` (#6b6b6b) de antes: sobre el gris de esta
              caja, #6b6b6b da 4,98:1 —pasa el AA por cuatro centésimas— y
              #4d4d4d da 7,9:1. Es texto de 12 px que explica una acción
              irreversible; no es sitio para ir justo. */}
          <p className="text-xs text-muted-foreground">
            {manual
              ? "Esta orden no tiene ejecutor automático, así que este botón es la única forma de cerrarla. "
              : ""}
            Al confirmar, el payout queda <strong>pagado</strong> y{" "}
            <strong>el tutor recibe el aviso en ese momento</strong>: «Se pagó tu
            liquidación». Aquí eso es correcto — el dinero se movió de verdad.
          </p>

          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <Label htmlFor={`${idBase}-ref`}>
                Referencia del movimiento
              </Label>
              <Input
                id={`${idBase}-ref`}
                ref={primerCampo}
                required
                autoComplete="off"
                aria-describedby={`${idBase}-ayuda-ref`}
                placeholder={
                  familia
                    ? AYUDA_DE_REFERENCIA[familia]
                    : "id del movimiento"
                }
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
              {/* La única línea que justifica el campo obligatorio. */}
              <p id={`${idBase}-ayuda-ref`} className="text-xs text-muted-foreground">
                Obligatoria: es lo único que permite reconciliar este payout con
                el extracto. Sin ella queda una fila que dice «pagado» y nada con
                lo que demostrarlo.
              </p>
            </div>
            <div className="flex min-w-[160px] flex-col gap-1.5">
              <Label htmlFor={`${idBase}-canal`}>Canal (opcional)</Label>
              <Input
                id={`${idBase}-canal`}
                list={`${idBase}-canales`}
                autoComplete="off"
                aria-describedby={`${idBase}-ayuda-canal`}
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
              <p id={`${idBase}-ayuda-canal`} className="text-xs text-muted-foreground">
                Por dónde salió de verdad. Queda como el proveedor de la orden.
              </p>
            </div>
          </div>

          {/* ── Punto 3 · el papel ──────────────────────────────────────────
              OPCIONAL, y esa es la decisión: la referencia es el dato que hace
              falta para conciliar, y exigir además un fichero bloquearía cierres
              legítimos —un Zinli hecho desde el móvil, un lote con un único
              justificante para tres tutores—. Además, obligar de verdad sería
              validarlo dentro de `manage_payout`, que es la función que la
              regla de oro 12 dice que no se toca. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-comprobante`}>
              Comprobante (opcional)
            </Label>
            <Input
              id={`${idBase}-comprobante`}
              type="file"
              multiple
              accept={PAYOUT_PROOF_TYPES.join(",")}
              aria-describedby={`${idBase}-ayuda-comprobante`}
              disabled={busy || comprobantes.length >= PAYOUT_PROOF_MAX_FILES}
              onChange={elegirFicheros}
              className="h-auto py-1.5"
            />
            <p
              id={`${idBase}-ayuda-comprobante`}
              className="text-xs text-muted-foreground"
            >
              La captura del envío o el PDF del banco. {PAYOUT_PROOF_HINT} · hasta{" "}
              {PAYOUT_PROOF_MAX_FILES} archivos. <strong>Lo verá el tutor</strong>{" "}
              en sus Movimientos, así que sirve como respuesta a «¿me pagaste?».
            </p>
            {comprobantes.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {comprobantes.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-[8px] bg-card px-2 py-1 text-xs text-muted-foreground"
                  >
                    <span className="truncate">
                      {f.name}{" "}
                      <span className="tabular-nums">({humanSize(f.size)})</span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setComprobantes((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-xs text-[#8f2b2b] hover:bg-destructive-muted disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <Aviso mensaje={error} />
          <Botones
            busy={busy}
            puedeEnviar={puedeEnviar}
            onCancel={cerrar}
            etiqueta="Marcar pagado"
            paso={paso}
          />
        </form>
      ) : null}

      {/* ── El pago SÍ aparece en el panel del proveedor ─────────────────── */}
      {abierta === "anotar" ? (
        <form
          id={idForm}
          className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-muted p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (puedeEnviar) void run("anotar", refLimpia, canal);
          }}
        >
          <p className="text-[13px] font-semibold text-foreground">
            Encontrado en el panel del proveedor
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idBase}-anotar`}>
              Identificador del proveedor
            </Label>
            <Input
              id={`${idBase}-anotar`}
              ref={primerCampo}
              required
              autoComplete="off"
              aria-describedby={`${idBase}-ayuda-anotar`}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
            <p id={`${idBase}-ayuda-anotar`} className="text-xs text-muted-foreground">
              Busca <code className="font-mono select-all">{marca}</code> en el
              panel del proveedor. Si existe, pega aquí el identificador que él le
              dio al payout: es la marca con la que se buscó, y sin ella no se
              está anotando nada, se está adivinando.
            </p>
          </div>
          <Aviso mensaje={error} />
          <Botones
            busy={busy}
            puedeEnviar={puedeEnviar}
            onCancel={cerrar}
            etiqueta="Anotar el pago"
            paso={paso}
          />
        </form>
      ) : null}

      {/* ── El pago NO existe: se devuelve a la cola ─────────────────────── */}
      {abierta === "devolver" ? (
        <form
          id={idForm}
          // Los rojos de esta caja siguen siendo literales y no los tokens del
          // sistema: `--destructive` (#e51a1a) sobre `--destructive-muted`
          // (#ffe5e5) no llega al 4,5:1 para texto pequeño, y este es justo el
          // párrafo que no se puede leer a medias.
          className="flex flex-col gap-2.5 rounded-[10px] border border-[#e8b4b4] bg-[#fdf0f0] p-3"
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
              ref={primerCampo}
              required
              autoComplete="off"
              spellCheck={false}
              placeholder={PALABRA_DEVOLVER}
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>
          <Aviso mensaje={error} />
          <Botones
            busy={busy}
            puedeEnviar={puedeEnviar}
            onCancel={cerrar}
            etiqueta="Devolver a la cola"
            peligrosa
            paso={paso}
          />
        </form>
      ) : null}
    </div>
  );
}

/**
 * El error de la última acción, EN LÍNEA. `role="alert"` para que un lector de
 * pantalla lo anuncie sin que nadie lo busque, y sin desaparecer solo: los
 * mensajes de `manage_payout` están escritos para leerse despacio.
 */
function Aviso({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return (
    <p
      role="alert"
      className="rounded-[8px] border border-[#e8b4b4] bg-[#fdf0f0] px-2.5 py-2 text-xs text-[#8f2b2b]"
    >
      {mensaje}
    </p>
  );
}

function Botones({
  busy,
  puedeEnviar,
  onCancel,
  etiqueta = "Confirmar",
  peligrosa = false,
  paso,
}: {
  busy: boolean;
  puedeEnviar: boolean;
  onCancel: () => void;
  etiqueta?: string;
  peligrosa?: boolean;
  /** Qué se está haciendo ahora: subir tres ficheros no es instantáneo. */
  paso?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
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
      {paso ? (
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {paso}
        </span>
      ) : null}
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
        `No se pudo copiar ${etiqueta}: este navegador no da acceso al portapapeles. Haz clic sobre el número —se selecciona entero— y cópialo con el teclado.`,
      );
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-mono text-[13.5px] font-semibold text-foreground tabular-nums select-all">
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
        className="rounded-[6px] border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
      >
        {copiado ? "copiado ✓" : "copiar"}
      </button>
    </span>
  );
}
