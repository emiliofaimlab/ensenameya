"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PanelCard } from "@/components/layout/panel-shell";

export type MetodoRow = {
  channel: string;
  label: string;
  help: string;
  is_active: boolean;
  sort_order: number;
};

/**
 * Una casilla por método. Nada más.
 *
 * ⚠️ SE GUARDA AL PULSAR, sin botón «Guardar». Es un único booleano y el efecto
 * es reversible con la misma casilla: un botón de guardar solo añadiría un
 * estado intermedio en el que la pantalla dice una cosa y la base otra. El
 * criterio contrario —el de `/admin/referidos`— es correcto ALLÍ porque allí se
 * teclean importes y textos, donde sí hace falta poder arrepentirse antes de
 * enviar.
 *
 * `<input type="checkbox">` nativo, como el resto del panel: trae su semántica
 * y su foco de teclado hechos, y no hay `components/ui/switch.tsx` que crear
 * para esto.
 */
export function Interruptores({ metodos }: { metodos: MetodoRow[] }) {
  const router = useRouter();
  /** El estado que pinta la pantalla: optimista, con vuelta atrás si falla. */
  const [estado, setEstado] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(metodos.map((m) => [m.channel, m.is_active])),
  );
  const [guardando, setGuardando] = useState<string | null>(null);

  async function cambiar(m: MetodoRow, activo: boolean) {
    const antes = estado[m.channel];
    setEstado((e) => ({ ...e, [m.channel]: activo }));
    setGuardando(m.channel);

    try {
      const res = await fetch(`/api/admin/metodos-de-cobro/${m.channel}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: activo }),
      });
      const salida = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        // Vuelta atrás: dejar la casilla como la pulsó el admin sería enseñarle
        // un estado que la base no tiene, y esta pantalla existe justo para que
        // no haya que ir a mirarla.
        setEstado((e) => ({ ...e, [m.channel]: antes }));
        toast.error(salida.error ?? "No se pudo guardar el cambio.");
        return;
      }
      toast.success(
        activo
          ? `${m.label} vuelve a ofrecerse a los tutores.`
          : `${m.label} deja de ofrecerse. Lo guardado no se toca.`,
      );
      // La pantalla del tutor la pintan Server Components: sin esto, el panel
      // quedaría al día y cualquier otra vista del admin con el mismo dato, no.
      router.refresh();
    } catch {
      setEstado((e) => ({ ...e, [m.channel]: antes }));
      toast.error("No pudimos guardar el cambio. Revisa tu conexión.");
    } finally {
      setGuardando(null);
    }
  }

  if (metodos.length === 0) {
    return (
      <PanelCard>
        <p className="text-[13px] text-[#6b6b6b]">
          No hay métodos en el catálogo.
        </p>
      </PanelCard>
    );
  }

  return (
    <PanelCard className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {metodos.map((m) => {
          const activo = estado[m.channel];
          return (
            <li
              key={m.channel}
              className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 rounded-[8px] border border-[#e0e0e0] p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#19191f]">
                  {m.label}
                  {!activo ? (
                    <span className="ms-2 rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[11.5px] font-medium text-[#5c5c5c]">
                      Oculto
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 max-w-[70ch] text-[12.5px] leading-[1.55] text-[#6b6b6b]">
                  {m.help}
                </p>
              </div>

              <label className="flex shrink-0 items-center gap-2 text-sm text-[#404040]">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={activo}
                  disabled={guardando === m.channel}
                  onChange={(e) => cambiar(m, e.target.checked)}
                />
                Se ofrece
              </label>
            </li>
          );
        })}
      </ul>
    </PanelCard>
  );
}
