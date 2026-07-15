"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Filtros de SCR-AD06/07 y AD09. Escriben en la query string y dejan que el
 * Server Component vuelva a consultar: sin estado propio, la URL es la fuente
 * — así un filtro se puede compartir o guardar en marcadores.
 */
export type FilterField = {
  name: string;
  label: string;
  type: "select" | "date";
  options?: { value: string; label: string }[];
};

export function AdminFilters({ fields, basePath }: { fields: FilterField[]; basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function set(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page"); // cambiar de filtro vuelve a la página 1
    const q = next.toString();
    router.push(q ? `${basePath}?${q}` : basePath);
  }

  const hasAny = fields.some((f) => params.get(f.name));

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      {fields.map((f) => (
        <div key={f.name} className="flex flex-col gap-1.5">
          <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
          {f.type === "select" ? (
            <select
              id={`f-${f.name}`}
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={params.get(f.name) ?? ""}
              onChange={(e) => set(f.name, e.target.value)}
            >
              <option value="">Todos</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`f-${f.name}`}
              type="date"
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              value={params.get(f.name) ?? ""}
              onChange={(e) => set(f.name, e.target.value)}
            />
          )}
        </div>
      ))}

      {hasAny ? (
        <Button variant="outline" size="sm" onClick={() => router.push(basePath)}>
          Limpiar
        </Button>
      ) : null}
    </div>
  );
}
