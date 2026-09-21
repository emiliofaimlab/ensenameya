"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelCard } from "@/components/layout/panel-shell";

export type AdminRow = {
  user_id: string;
  email: string;
  nombre: string | null;
  desde: string;
};

/**
 * La lista de administradores y las dos acciones.
 *
 * ⚠️ DAR ACCESO PIDE CONFIRMACIÓN Y QUITARLO NO, que es al revés de lo que
 * parece. Quitar es reversible en un clic desde esta misma pantalla y su peor
 * caso es que alguien tenga que pedir que se lo devuelvan. Dar es lo que no se
 * deshace del todo: entre el clic y el «me equivoqué» esa persona ya pudo ver
 * los pagos de todos y las fichas de los alumnos.
 */
export function GestorDeAdmins({
  admins,
  yo,
}: {
  admins: AdminRow[];
  /** El uid de quien mira. La base rechaza que se quite el acceso a sí mismo,
   *  así que su fila no lleva botón: ofrecerlo sería prometer algo que no pasa. */
  yo: string;
}) {
  const router = useRouter();
  const [correo, setCorreo] = useState("");
  const [dando, setDando] = useState(false);
  const [quitando, setQuitando] = useState<string | null>(null);

  async function dar(e: React.FormEvent) {
    e.preventDefault();
    const limpio = correo.trim();
    if (!limpio) return;

    if (
      !window.confirm(
        `Vas a dar acceso de administrador a ${limpio}.\n\nVerá los pagos de todos los tutores, las fichas de los alumnos y podrá aprobar verificaciones de identidad.\n\n¿Seguimos?`,
      )
    ) {
      return;
    }

    setDando(true);
    try {
      const res = await fetch("/api/admin/administradores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: limpio }),
      });
      const salida = (await res.json().catch(() => ({}))) as {
        error?: string;
        ya_era?: boolean;
      };
      if (!res.ok) {
        toast.error(salida.error ?? "No se pudo dar el acceso.");
        return;
      }
      toast.success(
        salida.ya_era
          ? `${limpio} ya tenía acceso de admin.`
          : `${limpio} ya puede entrar al panel.`,
      );
      setCorreo("");
      router.refresh();
    } catch {
      toast.error("No pudimos guardar el cambio. Revisa tu conexión.");
    } finally {
      setDando(false);
    }
  }

  async function quitar(fila: AdminRow) {
    setQuitando(fila.user_id);
    try {
      const res = await fetch("/api/admin/administradores", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: fila.user_id }),
      });
      const salida = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(salida.error ?? "No se pudo quitar el acceso.");
        return;
      }
      toast.success(`${fila.email} ya no tiene acceso al panel.`);
      router.refresh();
    } catch {
      toast.error("No pudimos guardar el cambio. Revisa tu conexión.");
    } finally {
      setQuitando(null);
    }
  }

  return (
    <>
      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Con acceso al panel ({admins.length})
        </h2>

        <ul className="flex flex-col gap-2">
          {admins.map((a) => {
            const soyYo = a.user_id === yo;
            return (
              <li
                key={a.user_id}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[8px] border border-[#e0e0e0] p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#19191f]">
                    {a.nombre || a.email}
                    {soyYo ? (
                      <span className="ms-2 rounded-full bg-brand-muted px-2 py-0.5 text-[11.5px] font-medium text-brand">
                        Tú
                      </span>
                    ) : null}
                  </p>
                  {a.nombre ? (
                    <p className="truncate text-[12.5px] text-[#6b6b6b]">
                      {a.email}
                    </p>
                  ) : null}
                </div>

                {soyYo ? (
                  <span className="text-[12.5px] text-[#6b6b6b]">
                    No puedes quitarte el acceso
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    className="h-9 shrink-0 rounded-[8px]"
                    disabled={quitando === a.user_id}
                    onClick={() => quitar(a)}
                  >
                    {quitando === a.user_id ? "Quitando…" : "Quitar acceso"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </PanelCard>

      <PanelCard className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">
          Dar acceso a alguien
        </h2>
        <form onSubmit={dar} className="flex flex-wrap items-center gap-3">
          <Input
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="correo@ejemplo.com"
            className="h-10 w-full max-w-[340px]"
            aria-label="Correo de la cuenta"
          />
          <Button type="submit" className="h-10 rounded-[8px]" disabled={dando}>
            {dando ? "Dando acceso…" : "Dar acceso de admin"}
          </Button>
        </form>
        <p className="text-[12.5px] text-[#6b6b6b]">
          Tiene que ser el correo con el que esa persona ya entra a Enséñame Ya.
        </p>
      </PanelCard>
    </>
  );
}
