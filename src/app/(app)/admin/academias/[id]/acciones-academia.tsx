"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  id: string;
  status: string;
  administrador: string | null;
  invitado: string | null;
};

const legible = (code?: string) => code === "23514" || code === "P0002";

/** A2 · permisos: administrador (RA-02), suspender o reactivar y eliminar (RA-20). */
export function AccionesAcademia({ id, status, administrador, invitado }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function nombrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/admin/academias/administrador", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ academyId: id, email }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; resultado?: string; correo?: string };
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "No se pudo nombrar al administrador.");
      return;
    }
    const aviso =
      body.correo === "enviado" ? " Le enviamos el correo."
      : body.correo === "fallo" ? " ⚠️ El correo no salió: avísale tú."
      : " (Sin correo configurado en este entorno.)";
    toast.success(
      (body.resultado === "vinculado" ? "Administrador vinculado." : "Invitación creada: la academia queda en borrador hasta que la acepte.") + aviso,
    );
    setEmail("");
    router.refresh();
  }

  async function estado(nuevo: "active" | "suspended") {
    setBusy(true);
    const { error } = await createClient().rpc("admin_cambiar_estado_academia", { p_academy: id, p_estado: nuevo });
    setBusy(false);
    if (error) return toast.error(legible(error.code) ? error.message : "No se pudo cambiar el estado.");
    toast.success(nuevo === "suspended" ? "Academia suspendida." : "Academia activa.");
    router.refresh();
  }

  async function eliminar() {
    if (!window.confirm("¿Eliminar la academia? No se puede deshacer.")) return;
    setBusy(true);
    const { error } = await createClient().rpc("admin_eliminar_academia", { p_academy: id });
    setBusy(false);
    if (error) return toast.error(legible(error.code) ? error.message : "No se pudo eliminar.");
    toast.success("Academia eliminada.");
    router.push("/admin/academias");
  }

  return (
    <div className="space-y-5 text-[13px]">
      <form onSubmit={nombrar} className="space-y-2">
        <p>
          Administrador: <strong>{administrador ?? "sin administrador"}</strong>
          {invitado ? <span className="text-[#6b6b6b]"> · invitación pendiente a {invitado}</span> : null}
        </p>
        <Label htmlFor="admin-email">{administrador || invitado ? "Cambiar de administrador" : "Nombrar administrador"}</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="admin-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@academia.com"
            className="max-w-xs"
          />
          <Button type="submit" disabled={busy}>
            Guardar
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        {status === "suspended" ? (
          <Button variant="outline" disabled={busy} onClick={() => estado("active")}>
            Reactivar
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => estado("suspended")}>
            Suspender
          </Button>
        )}
        <Button variant="destructive" disabled={busy} onClick={eliminar}>
          Eliminar
        </Button>
      </div>
      <p className="text-[#6b6b6b]">Solo se elimina sin reservas, ofertas ni tutores; si no, se suspende.</p>
    </div>
  );
}
