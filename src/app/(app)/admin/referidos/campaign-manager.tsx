"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GraduationCapIcon, UsersIcon } from "lucide-react";

import { cn } from "@/lib/utils";
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
};

type Audiencia = "alumnos" | "tutores";

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
 */
export function CampaignManager({
  filas,
  sincronizado,
}: {
  filas: CampaignRow[];
  sincronizado: string | null;
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

              return (
                <li
                  key={f.rfCampaignId}
                  className="grid gap-5 py-5 lg:grid-cols-[minmax(0,230px)_minmax(0,1fr)_minmax(0,260px)]"
                >
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
                          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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

                  {/* ── Lo que manda RF, y los interruptores ──────────── */}
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <p className="text-xs text-[#6b6b6b]">Recompensa en Referral Factory</p>
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
