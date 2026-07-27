"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TierRow = {
  id: string;
  name: string;
  splitPct: number;
  isDefault: boolean;
  description: string | null;
  tutorCount: number;
};

type Draft = {
  id: string | null;
  name: string;
  splitPct: string;
  description: string;
  isDefault: boolean;
};

const EMPTY: Draft = { id: null, name: "", splitPct: "", description: "", isDefault: false };

/** Reparto de 100 US$ con este split — el número abstracto en dinero real. */
function ejemplo(splitPct: number): string {
  const tutor = (100 * splitPct) / 100;
  return `de 100 US$: ${tutor.toFixed(2)} para el tutor · ${(100 - tutor).toFixed(2)} de comisión`;
}

export function TierManager({ tiers }: { tiers: TierRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  // Crear/editar viven en un modal (24-jul): el botón "Nuevo tier" y cada
  // "Editar" lo abren; el formulario ya no ocupa sitio fijo en la pantalla.
  const [open, setOpen] = useState(false);

  const editing = draft.id !== null;

  function openNew() {
    setDraft(EMPTY);
    setOpen(true);
  }
  function openEdit(t: TierRow) {
    setDraft({
      id: t.id,
      name: t.name,
      splitPct: String(t.splitPct),
      description: t.description ?? "",
      isDefault: t.isDefault,
    });
    setOpen(true);
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      toast.error("El tier necesita un nombre.");
      return;
    }
    const split = Number(draft.splitPct);
    if (!Number.isFinite(split) || split < 0 || split > 100) {
      toast.error("El split debe ser un número entre 0 y 100.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const values = {
      name,
      split_pct: split,
      description: draft.description.trim() || null,
      is_default: draft.isDefault,
    };

    const { error } = editing
      ? await supabase.from("tutor_tiers").update(values).eq("id", draft.id!)
      : await supabase.from("tutor_tiers").insert(values);
    setBusy(false);

    if (error) {
      // 23505 = el índice parcial de "un solo default" (tutor_tiers_one_default_idx).
      toast.error(
        error.code === "23505"
          ? "Ya hay un tier por defecto. Quítaselo a ese antes de marcar este."
          : error.message || "No se pudo guardar el tier.",
      );
      return;
    }
    toast.success(editing ? "Tier actualizado." : "Tier creado.");
    setOpen(false);
    setDraft(EMPTY);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* S-08 es la duda que siempre surge al tocar comisiones: se responde aquí. */}
      <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
        Los cambios solo afectan a <strong>reservas nuevas</strong>. Las ya creadas
        conservan el split que tenían al reservarse.
      </p>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-[#6b6b6b]">
          {tiers.length} {tiers.length === 1 ? "tier configurado" : "tiers configurados"}
        </p>
        <Button onClick={openNew} className="gap-1.5">
          <PlusIcon className="size-4" />
          Nuevo tier
        </Button>
      </div>

      {/* Filas del Figma (226:59): nombre + comisión, split 20/700, tutores. */}
      <div className="rounded-[16px] border border-[#e0e0e0] bg-card px-5 py-2">
        <ul className="divide-y divide-[#e0e0e0]">
          {tiers.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div className="min-w-0 sm:w-64">
                <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                  {t.name}
                </p>
                <p className="truncate text-xs text-[#6b6b6b]">
                  Comisión plataforma: {Math.round((100 - t.splitPct) * 100) / 100}%
                  {t.description ? ` · ${t.description}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6b6b6b]">Split tutor</p>
                <p className="text-xl font-bold text-[#19191f]">{t.splitPct}%</p>
              </div>
              <div>
                <p className="text-xs text-[#6b6b6b]">Tutores</p>
                <p className="text-xl font-bold text-[#19191f]">{t.tutorCount}</p>
              </div>
              <div className="flex items-center gap-2.5">
                {t.isDefault ? (
                  <span className="inline-flex h-7 items-center rounded-full bg-[#dbedff] px-2.5 text-xs font-semibold text-brand">
                    Por defecto
                  </span>
                ) : null}
                <Button
                  variant="outline"
                  disabled={busy}
                  className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                  onClick={() => openEdit(t)}
                >
                  Editar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Modal de crear / editar. */}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setDraft(EMPTY);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Editar "${draft.name || "tier"}"` : "Nuevo tier"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tier-name">Nombre</Label>
              <Input
                id="tier-name"
                value={draft.name}
                placeholder="Tier 4"
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tier-split">Split del tutor (%)</Label>
              <Input
                id="tier-split"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={draft.splitPct}
                placeholder="75"
                onChange={(e) => setDraft((d) => ({ ...d, splitPct: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                {Number.isFinite(Number(draft.splitPct)) && draft.splitPct !== ""
                  ? ejemplo(Number(draft.splitPct))
                  : "Lo que se lleva el tutor; el resto es comisión."}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tier-desc">Descripción (opcional)</Label>
            <Textarea
              id="tier-desc"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-foreground"
              checked={draft.isDefault}
              onChange={(e) => setDraft((d) => ({ ...d, isDefault: e.target.checked }))}
            />
            Asignar este tier a los tutores al aprobarlos
          </label>

          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={busy} onClick={save}>
              {editing ? "Guardar cambios" : "Crear tier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
