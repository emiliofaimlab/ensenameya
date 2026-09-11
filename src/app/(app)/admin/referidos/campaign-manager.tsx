"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GraduationCapIcon, UsersIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { exponenteDe, formatEnMoneda } from "@/lib/dinero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/layout/panel-shell";

export type CampaignRow = {
  rfCampaignId: number;
  rfName: string;
  rfStatus: string;
  rfLang: string | null;
  rfUrl: string;
  title: string;
  rewardText: string;
  audience: Audiencia;
  visible: boolean;
  sortOrder: number;
  /** Qué entrega la campaña. `'ninguna'` = no entrega nada. */
  rewardKind: Recompensa;
  /** El tope (o el importe), en unidades MÍNIMAS de `rewardCurrency`. */
  rewardAmount: number | null;
  rewardCurrency: string | null;
  rewardExpiresDays: number;
};

type Audiencia = "alumnos" | "tutores";

/** Los tres de `referral_campaigns_reward_kind_check` (`20260912110000`). */
type Recompensa = "ninguna" | "mentoria" | "saldo";

const RECOMPENSAS: { valor: Recompensa; etiqueta: string }[] = [
  { valor: "ninguna", etiqueta: "No entrega nada" },
  { valor: "mentoria", etiqueta: "Una mentoría gratis (con tope)" },
  { valor: "saldo", etiqueta: "Dinero" },
];

/**
 * Las clases del `<select>` nativo, que estaban a pelo en el de la audiencia y
 * ahora las comparten los tres. No hay `components/ui/select.tsx` en el repo y
 * no se crea uno para esto: el navegador ya trae el control, con su semántica y
 * su foco de teclado (mismo criterio que el `<input type="checkbox">` de abajo).
 */
const SELECT =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

/**
 * Unidades mínimas → lo que se teclea.
 *
 * ⚠️ El factor no es 100 siempre (`exponenteDe`, src/lib/dinero.ts): cinco mil
 * pesos chilenos son `5000` y dividirlos enseñaría «50,00 CLP».
 */
function aUnidadesMayores(minimas: number, currency: string): string {
  const exp = exponenteDe(currency);
  // Con coma: el panel está en español y el campo la acepta (y el servidor
  // también). Un «15.00» en un formulario en español se teclea mal la primera
  // vez que alguien lo reescribe.
  return exp === 0 ? String(minimas) : (minimas / 100).toFixed(2).replace(".", ",");
}

/**
 * La VISTA PREVIA de lo que se va a guardar. No es la cuenta que manda: esa la
 * hace el servidor con la cadena tal cual se escribió (regla de oro 2, ver
 * `aUnidadesMinimas` en `api/admin/referidos/[id]/route.ts`). Aquí solo sirve
 * para que el admin vea «15» convertido en «15,00 US$» mientras escribe, y si
 * la cifra no se entiende se devuelve `null` en vez de inventarse un número.
 */
function previaEnMoneda(mayor: string, currency: string): string | null {
  // Las mismas tres reglas que el servidor, y en el mismo orden: si aquí se
  // aceptara algo que allí se rechaza, la previa enseñaría una cifra que el
  // «Guardar» va a negarse a guardar, que es peor que no enseñar ninguna.
  const texto = mayor.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(texto) || !currency) return null;
  const exp = exponenteDe(currency);
  const decimal = texto.split(".")[1] ?? "";
  if (exp === 0 && decimal.replace(/0+$/, "") !== "") return null;
  const minimas = Math.round(Number(texto) * 10 ** exp);
  return minimas > 0 ? formatEnMoneda(minimas, currency) : null;
}

/** Lo que devuelve `GET rewards` de RF (`lib/referral-factory.ts`). */
type Reward = {
  id: number;
  campaign_id: number;
  name: string;
  reward_for: string | null;
  type: string | null;
  value: string | number | null;
  when_referral: string | null;
};

/** Lo que se edita de una fila mientras no se ha guardado. */
type Draft = {
  title: string;
  rewardText: string;
  audience: Audiencia;
  visible: boolean;
  /** String y no number: es el valor crudo de un `<input type="number">`, que
   *  puede estar vacío mientras el admin lo reescribe. */
  sortOrder: string;
  rewardKind: Recompensa;
  /**
   * El importe EN LA MONEDA, tal como se teclea («15», «15,50»), no en unidades
   * mínimas. Viaja así hasta el servidor: ver `previaEnMoneda`.
   */
  rewardAmount: string;
  rewardCurrency: string;
  rewardExpiresDays: string;
};

/**
 * §7 · la tabla de campañas de `/admin/referidos`.
 *
 * ⚠️ LAS RECOMPENSAS DE RF SE PINTAN SOLO DESPUÉS DE «TRAER CAMPAÑAS», y es una
 * decisión, no un olvido. La pantalla NO puede llamar a RF al renderizar (picos
 * de >25 s) y `referral_campaigns` no tiene columna donde guardarlas, así que
 * hay exactamente tres salidas:
 *   (a) que el handler de sync las devuelva en su JSON y se pinten en memoria
 *       —lo que hace esto—: cero esquema, cero red al cargar, y la columna sale
 *       vacía con un aviso hasta que el admin pulsa el botón que iba a pulsar
 *       igual;
 *   (b) una columna `rf_reward jsonb` en la tabla: sobreviviría a la recarga,
 *       pero cuesta una migración y deja en nuestra base un espejo de un dato
 *       que manda RF y que nadie vuelve a mirar;
 *   (c) no pintarlas: entonces el admin edita `reward_text` a ciegas, sin ver
 *       qué paga de verdad la campaña, que es justo lo que la columna resuelve.
 * (a) es la más barata y la única que no añade esquema. Si un día molesta
 * perderlas al recargar, la alternativa es (b) y son ~20 líneas de migración.
 *
 * ⚠️ Y RF DEVUELVE DOS RECOMPENSAS POR CAMPAÑA —«Referrer Reward» y «Lead
 * Reward»— con `value` que puede venir `null`. Se pintan las dos diciendo de
 * quién es cada una: una sola, o dos sin sujeto, se leen como si la campaña
 * pagara dos veces a la misma persona.
 *
 * 🔴 EN LA MISMA FILA HAY DOS RECOMPENSAS Y SOLO UNA PAGA. La de RF es un dato
 * que se enseña; la que se entrega de verdad es «Qué se entrega»
 * (`reward_kind`/`reward_amount`/`reward_currency`/`reward_expires_days`), que
 * es lo que `emitir_credito_de_referido` copia dentro de `credits`. Por eso la
 * de RF va rotulada «(informativo)» y por eso la nuestra lleva debajo del texto
 * que la promete una línea diciendo qué se entrega: el `comment on column
 * reward_text` avisa de que nadie puede comprobar que la frase y el importe
 * digan lo mismo, así que lo único que queda es ponerlos uno al lado del otro.
 */
export function CampaignManager({
  filas,
  sincronizado,
  monedas,
}: {
  filas: CampaignRow[];
  sincronizado: string | null;
  /**
   * En qué monedas cobra el catálogo hoy, más las que ya estén guardadas. El
   * canje NO convierte (`credito_aplicable` → «tu saldo está en otra moneda»),
   * así que una recompensa en una moneda que nadie cobra nace muerta. Por eso
   * es una lista cerrada y no un campo de texto.
   */
  monedas: string[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [sincronizando, setSincronizando] = useState(false);
  const [guardando, setGuardando] = useState<number | null>(null);
  /** `null` = todavía no se ha traído nada de RF en esta visita. */
  const [rewards, setRewards] = useState<Reward[] | null>(null);

  /** El borrador vive solo mientras la fila está tocada: así un
   *  `router.refresh()` (o una campaña nueva traída de RF) se pinta sin tener
   *  que reconciliar props con estado. */
  const draft = (f: CampaignRow): Draft =>
    drafts[f.rfCampaignId] ?? {
      title: f.title,
      rewardText: f.rewardText,
      audience: f.audience,
      visible: f.visible,
      sortOrder: String(f.sortOrder),
      rewardKind: f.rewardKind,
      // Una campaña sin premio todavía no tiene moneda: se arranca con la
      // primera del catálogo para que el desplegable no abra en blanco, pero
      // hasta que el admin elija un tipo de premio no se guarda nada de esto
      // (el `PATCH` escribe NULL cuando `reward_kind = 'ninguna'`).
      rewardCurrency: f.rewardCurrency ?? monedas[0] ?? "",
      rewardAmount:
        f.rewardAmount === null
          ? ""
          : aUnidadesMayores(f.rewardAmount, f.rewardCurrency ?? monedas[0] ?? "USD"),
      rewardExpiresDays: String(f.rewardExpiresDays),
    };

  const cambiar = (f: CampaignRow, parcial: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [f.rfCampaignId]: { ...draft(f), ...parcial } }));

  async function sincronizar() {
    setSincronizando(true);
    try {
      const res = await fetch("/api/admin/referidos/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo traer las campañas.");
        return;
      }
      setRewards(data.rewards ?? []);
      toast.success(
        data.nuevas > 0
          ? `${data.campañas} campañas traídas. ${data.nuevas} nueva(s): entran apagadas hasta que las revises.`
          : `${data.campañas} campañas actualizadas.`,
      );
      // Lo que se acaba de escribir en la base lo repinta el servidor. Los
      // borradores sin guardar NO se tiran: el sync solo toca los campos `rf_*`.
      router.refresh();
    } catch {
      toast.error("No se pudo hablar con el servidor.");
    } finally {
      setSincronizando(false);
    }
  }

  async function guardar(f: CampaignRow) {
    const d = draft(f);
    setGuardando(f.rfCampaignId);
    try {
      const res = await fetch(`/api/admin/referidos/${f.rfCampaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: d.title,
          reward_text: d.rewardText,
          visible: d.visible,
          audience: d.audience,
          // Un campo vacío da `NaN`, que `JSON.stringify` convierte en `null`;
          // el handler lo rechaza con un 400 que dice qué pasa. No se valida
          // dos veces: el servidor es el que manda y ya tiene el mensaje.
          sort_order: Number(d.sortOrder),
          reward_kind: d.rewardKind,
          reward_expires_days: Number(d.rewardExpiresDays),
          // 🔴 EL IMPORTE VIAJA EN LA MONEDA, NO EN UNIDADES MÍNIMAS, y la
          // conversión la hace el servidor (regla de oro 2). Si convirtiera
          // aquí, un `4500` y un `45` llegarían indistinguibles y el servidor
          // no tendría forma de saber cuál de los dos quería decir 45,00 US$.
          // Con `reward_kind = 'ninguna'` el handler los ignora y escribe NULL.
          reward_amount_major: d.rewardAmount.trim(),
          reward_currency: d.rewardCurrency,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo guardar.");
        return;
      }
      toast.success("Campaña guardada.");
      // Se tira el borrador: a partir de aquí la fila la manda el servidor otra
      // vez, y mantener los dos en pie es cómo una pantalla empieza a enseñar
      // lo que el usuario escribió en vez de lo que se guardó.
      setDrafts((x) => {
        const resto = { ...x };
        delete resto[f.rfCampaignId];
        return resto;
      });
      router.refresh();
    } catch {
      toast.error("No se pudo hablar con el servidor.");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ponytail: el botón va aquí y no en el `actions` de `AdminShell`
          (arriba a la derecha, como el artifact) porque tiene que compartir
          estado con la tabla: las recompensas que trae el sync se pintan en las
          filas. Cruzar ese estado entre dos slots distintos del shell pedía un
          contexto o un bus de eventos; una fila de cabecera propia, alineada a
          la derecha igual, cuesta cero. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[#6b6b6b]">
          {filas.length} {filas.length === 1 ? "campaña" : "campañas"}
          {sincronizado ? ` · última sincronización ${sincronizado}` : ""}
        </p>
        <Button
          variant="outline"
          disabled={sincronizando}
          onClick={sincronizar}
          className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
        >
          {/* §8 «Textos exactos»: «Traer campañas», no la frase larga del §7. */}
          {sincronizando ? "Trayendo…" : "Traer campañas"}
        </Button>
      </div>

      <div className="rounded-[16px] border border-[#e0e0e0] bg-card px-5 py-2">
        {filas.length === 0 ? (
          <p className="py-6 text-[13px] text-[#6b6b6b]">
            Todavía no hay campañas. Pulsa «Traer campañas».
          </p>
        ) : (
          <ul className="divide-y divide-[#e0e0e0]">
            {filas.map((f) => {
              const d = draft(f);
              const tocada = drafts[f.rfCampaignId] !== undefined;
              const Icono = d.audience === "tutores" ? UsersIcon : GraduationCapIcon;
              const suyas = rewards?.filter((r) => r.campaign_id === f.rfCampaignId);
              const previa = previaEnMoneda(d.rewardAmount, d.rewardCurrency);

              return (
                <li key={f.rfCampaignId} className="flex flex-col gap-4 py-5">
                  {/* ══ EL AVISO QUE MÁS IMPORTA ═══════════════════════════
                      Una campaña visible que no entrega nada está prometiendo
                      su `reward_text` a todo el que abra «Invita y gana» y no
                      va a entregar nada: `emitir_credito_de_referido` sale por
                      `if v_c.reward_kind = 'ninguna' then return null`, sin
                      error, sin cola y sin que nadie se entere.

                      ⚠️ MIRA LA FILA GUARDADA (`f`), NO EL BORRADOR (`d`). El
                      aviso habla de lo que la gente está viendo AHORA MISMO;
                      elegir un premio en el desplegable y no guardarlo no ha
                      cambiado nada para nadie. */}
                  {f.rewardKind === "ninguna" ? (
                    f.visible ? (
                      <p className="rounded-[10px] border border-[#e5b4b4] bg-[#fdf0f0] px-3.5 py-2.5 text-[12.5px] text-[#a82929]">
                        <span className="font-semibold">
                          Esta campaña está a la vista y no entrega nada.
                        </span>{" "}
                        Quien lea «{f.rewardText}» en «Invita y gana» no va a
                        recibir ninguna recompensa: mientras «Qué se entrega»
                        diga «No entrega nada», no se emite nada y no falla
                        nada. Elige el premio o quita «Visible».
                      </p>
                    ) : (
                      <p className="rounded-[10px] border border-[#f0c987] bg-[#fdf6e7] px-3.5 py-2.5 text-[12.5px] text-[#8a5a12]">
                        Apagada y sin premio: no promete nada a nadie todavía.
                        Elige qué entrega antes de hacerla visible.
                      </p>
                    )
                  ) : null}

                  <div className="grid gap-5 lg:grid-cols-[minmax(0,230px)_minmax(0,1fr)_minmax(0,260px)]">
                    {/* ── Quién es, en RF ───────────────────────────────── */}
                    <div className="flex min-w-0 gap-3">
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-full",
                          d.audience === "tutores"
                            ? "bg-[#dbedff] text-[#0063c4]"
                            : "bg-[#fff0e3] text-[#c25100]",
                        )}
                      >
                        <Icono className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                          {f.rfName}
                        </p>
                        <p className="text-xs text-[#6b6b6b]">
                          {f.rfCampaignId} · {f.rfStatus}
                          {f.rfLang ? ` · ${f.rfLang}` : ""}
                        </p>
                        {/* La landing de RF. No es lo que se comparte —eso es
                            APP_BASE_URL/?ref=<code>—, pero es cómo el admin
                            reconoce la campaña en el panel de RF. */}
                        <a
                          href={f.rfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={f.rfUrl}
                          className="mt-0.5 block truncate text-xs text-brand hover:underline"
                        >
                          {f.rfUrl}
                        </a>
                      </div>
                    </div>

                    {/* ── Lo que decide esta casa ───────────────────────── */}
                    <div className="flex min-w-0 flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`titulo-${f.rfCampaignId}`} className="text-xs text-[#6b6b6b]">
                          Título en la app
                        </Label>
                        <Input
                          id={`titulo-${f.rfCampaignId}`}
                          value={d.title}
                          onChange={(e) => cambiar(f, { title: e.target.value })}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`recompensa-${f.rfCampaignId}`} className="text-xs text-[#6b6b6b]">
                          Recompensa
                        </Label>
                        <Input
                          id={`recompensa-${f.rfCampaignId}`}
                          value={d.rewardText}
                          onChange={(e) => cambiar(f, { rewardText: e.target.value })}
                        />
                        {/* ⚠️ ESTA LÍNEA VA PEGADA AL TEXTO QUE PROMETE, y no
                            abajo con los campos, a propósito: el `comment on
                            column reward_text` avisa de que nadie puede
                            comprobar que la frase («ganas 10 US$») y el importe
                            (1500) digan lo mismo — no hay constraint que valga
                            para eso. Lo único que se puede hacer es enseñar las
                            dos cosas a la vez y que la incoherencia se vea. */}
                        <p className="text-[12px] text-[#6b6b6b]">
                          {d.rewardKind === "ninguna"
                            ? "Se entrega: nada."
                            : previa === null
                              ? "Se entrega: falta el importe."
                              : d.rewardKind === "mentoria"
                                ? `Se entrega: una mentoría de hasta ${previa} · ${d.rewardExpiresDays || "—"} días para agendarla.`
                                : `Se entrega: ${previa} · a un alumno como saldo, con ${d.rewardExpiresDays || "—"} días; a un tutor, sumado a su próximo cobro y sin caducar.`}
                        </p>
                      </div>

                      {/* ── Qué se entrega de verdad ────────────────────── */}
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`premio-${f.rfCampaignId}`} className="text-xs text-[#6b6b6b]">
                          Qué se entrega
                        </Label>
                        {/* Lista cerrada, no texto libre: son los tres valores de
                            `referral_campaigns_reward_kind_check`. */}
                        <select
                          id={`premio-${f.rfCampaignId}`}
                          value={d.rewardKind}
                          onChange={(e) =>
                            cambiar(f, { rewardKind: e.target.value as Recompensa })
                          }
                          className={SELECT}
                        >
                          {RECOMPENSAS.map((r) => (
                            <option key={r.valor} value={r.valor}>
                              {r.etiqueta}
                            </option>
                          ))}
                        </select>

                        {d.rewardKind !== "ninguna" ? (
                          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_92px_96px] gap-3">
                            <div className="flex flex-col gap-1.5">
                              <Label
                                htmlFor={`tope-${f.rfCampaignId}`}
                                className="text-xs text-[#6b6b6b]"
                              >
                                {d.rewardKind === "mentoria" ? "Tope" : "Importe"}
                              </Label>
                              {/* ⚠️ SE ESCRIBE EN LA MONEDA, no en unidades
                                  mínimas: nadie teclea «4500» queriendo decir
                                  45,00 US$. La conversión la hace el servidor.
                                  `type="text"` y no `type="number"`: el `number`
                                  de Chrome se come la coma decimal del teclado
                                  español y deja «15,50» en «1550». */}
                              <Input
                                id={`tope-${f.rfCampaignId}`}
                                inputMode="decimal"
                                placeholder="15,00"
                                value={d.rewardAmount}
                                onChange={(e) => cambiar(f, { rewardAmount: e.target.value })}
                              />
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <Label
                                htmlFor={`moneda-${f.rfCampaignId}`}
                                className="text-xs text-[#6b6b6b]"
                              >
                                Moneda
                              </Label>
                              <select
                                id={`moneda-${f.rfCampaignId}`}
                                value={d.rewardCurrency}
                                disabled={monedas.length === 0}
                                onChange={(e) => cambiar(f, { rewardCurrency: e.target.value })}
                                className={SELECT}
                              >
                                {monedas.length === 0 ? <option value="">—</option> : null}
                                {monedas.map((m) => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <Label
                                htmlFor={`dias-${f.rfCampaignId}`}
                                className="text-xs text-[#6b6b6b]"
                              >
                                Días
                              </Label>
                              {/* `referral_campaigns_reward_dias_check`: 1..365.
                                  Los límites se repiten aquí solo para que el
                                  navegador ayude; quien manda es el servidor. */}
                              <Input
                                id={`dias-${f.rfCampaignId}`}
                                type="number"
                                step="1"
                                min={1}
                                max={365}
                                value={d.rewardExpiresDays}
                                onChange={(e) =>
                                  cambiar(f, { rewardExpiresDays: e.target.value })
                                }
                              />
                            </div>
                          </div>
                        ) : null}

                        {monedas.length === 0 && d.rewardKind !== "ninguna" ? (
                          <p className="text-[12px] text-[#a82929]">
                            No hay ninguna mentoría publicada, así que no hay
                            moneda en la que dar la recompensa: un crédito en una
                            moneda que nadie cobra no se puede canjear.
                          </p>
                        ) : null}

                        {/* La letra pequeña que el cliente necesita para elegir, y
                            que sale de `credito_aplicable` (`20260912110000`), no
                            de una promesa comercial. */}
                        <p className="text-[12px] leading-snug text-[#6b6b6b]">
                          {d.rewardKind === "mentoria"
                            ? "Vale por UNA mentoría y es todo o nada: si la que elige cuesta más que el tope, no se puede usar ahí —no se prorratea— y lo que sobre no se devuelve. En un paquete de varias sesiones cubre una sola, y el alumno paga el resto. Si no la agenda dentro del plazo, caduca."
                            : d.rewardKind === "saldo"
                              ? "Dinero. A un alumno le queda como saldo y paga solo la diferencia; a un tutor se le suma a su próximo cobro y le llega solo, sin caducar. Lo decide el rol de quien invita, no la audiencia de la campaña."
                              : "La campaña sigue repartiendo enlaces y contando conversiones, pero no emite ninguna recompensa."}
                        </p>
                      </div>

                      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`audiencia-${f.rfCampaignId}`} className="text-xs text-[#6b6b6b]">
                            Audiencia
                          </Label>
                          {/* La audiencia no es una etiqueta: decide la REGLA DE
                              CONVERSIÓN que aplica `referral_conversions_pending`
                              y el icono de la tarjeta. Cambiarla cambia a quién
                              se le cuenta la recompensa. */}
                          <select
                            id={`audiencia-${f.rfCampaignId}`}
                            value={d.audience}
                            onChange={(e) =>
                              cambiar(f, { audience: e.target.value as Audiencia })
                            }
                            className={SELECT}
                          >
                            <option value="alumnos">Alumnos</option>
                            <option value="tutores">Tutores</option>
                          </select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`orden-${f.rfCampaignId}`} className="text-xs text-[#6b6b6b]">
                            Orden
                          </Label>
                          <Input
                            id={`orden-${f.rfCampaignId}`}
                            type="number"
                            step="1"
                            value={d.sortOrder}
                            onChange={(e) => cambiar(f, { sortOrder: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── Lo que dice RF, y los interruptores ───────────── */}
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        {/* ⚠️ INFORMATIVO, Y AHORA HAY QUE DECIRLO. Antes esto
                            era «lo que paga la campaña»; desde el 11-sep quien
                            paga es «Qué se entrega» de la columna de al lado, y
                            dos recompensas en la misma fila sin decir cuál manda
                            es cómo se configura la equivocada. */}
                        <p className="text-xs text-[#6b6b6b]">
                          Recompensa en Referral Factory{" "}
                          <span className="text-[#8a8a8a]">(informativo)</span>
                        </p>
                        {suyas === undefined ? (
                          <p className="text-[12.5px] text-[#8a8a8a]">
                            Pulsa «Traer campañas» para verla.
                          </p>
                        ) : suyas.length === 0 ? (
                          <p className="text-[12.5px] text-[#8a8a8a]">
                            Esta campaña no tiene recompensas en RF.
                          </p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {suyas.map((r) => (
                              <li key={r.id} className="text-[12.5px] text-[#404040]">
                                <span className="font-semibold">{paraQuien(r)}:</span>{" "}
                                {r.name}
                                {/* `value` viene `null` a menudo (medido contra
                                    la API real): «—» y no un hueco, para que se
                                    vea que RF no lo tiene puesto. */}
                                {` · ${r.value ?? "—"}`}
                                {r.when_referral ? ` · ${r.when_referral}` : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <StatusPill tone="blue" className="w-fit">
                        {d.audience === "tutores"
                          ? "convierte: primera clase dada"
                          : "convierte: primera clase pagada"}
                      </StatusPill>

                      {/* ⚠️ No hay `components/ui/switch.tsx` en el repo y no se
                          crea uno para esto: el navegador ya trae un control de
                          dos estados, con su semántica y su foco de teclado
                          gratis. Mismo patrón que `tier-manager.tsx`. */}
                      <label className="flex items-center gap-2 text-sm text-[#404040]">
                        <input
                          type="checkbox"
                          className="size-4 accent-foreground"
                          checked={d.visible}
                          onChange={(e) => cambiar(f, { visible: e.target.checked })}
                        />
                        Visible
                      </label>

                      <Button
                        disabled={!tocada || guardando === f.rfCampaignId}
                        onClick={() => guardar(f)}
                        className="h-9 w-fit rounded-[8px] px-4 text-[13px]"
                      >
                        {guardando === f.rfCampaignId ? "Guardando…" : "Guardar"}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * De quién es la recompensa. RF manda «Referrer Reward» y «Lead Reward» en el
 * mismo formato y `reward_for` no siempre viene: sin traducir esto, las dos
 * líneas se leen como dos pagos a la misma persona.
 */
function paraQuien(r: Reward): string {
  const texto = `${r.reward_for ?? ""} ${r.name}`.toLowerCase();
  if (texto.includes("referrer")) return "Quien invita";
  if (texto.includes("lead") || texto.includes("friend")) return "El invitado";
  return "Sin destinatario";
}
