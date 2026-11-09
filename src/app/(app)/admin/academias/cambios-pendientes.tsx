"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Json } from "@/lib/database.types";

const CAMPOS: Record<string, string> = {
  name: "Nombre",
  tagline: "Lema",
  description: "Descripción",
  logo_path: "Logo",
  cover_path: "Portada",
  brand_color: "Color",
  website: "Web",
  policies_url: "Políticas",
};

type Props = {
  academia: {
    id: string;
    name: string;
    pending_changes: Json | null;
    // El «antes»: lo que hoy se ve en /academias/<slug>.
    [campo: string]: unknown;
  };
};

/** A2 · RA-06 · antes y después de un cambio de perfil, con aprobar o rechazar. */
export function CambiosPendientes({ academia }: Props) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const cambios = (academia.pending_changes ?? {}) as Record<string, unknown>;
  const filas = Object.keys(CAMPOS).filter((k) => k in cambios);

  async function resolver(aprobar: boolean) {
    setBusy(true);
    const { error } = await createClient().rpc("admin_resolver_cambios_academia", {
      p_academy: academia.id,
      p_aprobar: aprobar,
      p_motivo: motivo,
    });
    setBusy(false);
    if (error) {
      toast.error(error.code === "23514" || error.code === "P0002" ? error.message : "No se pudo guardar.");
      return;
    }
    toast.success(aprobar ? "Cambios aprobados y publicados." : "Cambios rechazados.");
    router.refresh();
  }

  return (
    <div className="rounded-[12px] border border-[#e0e0e0] p-4 text-[13px]">
      <p className="font-semibold">{academia.name}</p>
      <table className="mt-2 w-full text-left">
        <thead className="text-xs text-[#6b6b6b]">
          <tr>
            <th className="py-1 pr-3 font-medium">Campo</th>
            <th className="py-1 pr-3 font-medium">Antes</th>
            <th className="py-1 font-medium">Después</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((k) => (
            <tr key={k} className="align-top">
              <td className="py-1 pr-3 text-[#6b6b6b]">{CAMPOS[k]}</td>
              <td className="py-1 pr-3 whitespace-pre-line">{String(academia[k] ?? "—")}</td>
              <td className="py-1 whitespace-pre-line">{String(cambios[k] ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => resolver(true)}>
          Aprobar
        </Button>
        <Input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo del rechazo"
          aria-label="Motivo del rechazo"
          className="h-8 max-w-xs"
        />
        <Button size="sm" variant="outline" disabled={busy || !motivo.trim()} onClick={() => resolver(false)}>
          Rechazar
        </Button>
      </div>
    </div>
  );
}
