"use client";

import { useState } from "react";
import { DownloadIcon, FileTextIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DescargablePublico = { id: string; title: string; description: string | null };

/**
 * EY-248 · «Recursos de {tutor}» en el perfil público. Cada PDF se baja a
 * cambio de nombre + email: el formulario va a `POST /api/descargables/[id]`,
 * que guarda el lead y devuelve una URL firmada de 5 minutos.
 */
export function Descargables({
  items,
  tutor,
  nombre: nombreInicial = "",
  email: emailInicial = "",
}: {
  items: DescargablePublico[];
  tutor: string;
  /** Prellenado si hay sesión; se puede cambiar. */
  nombre?: string;
  email?: string;
}) {
  const [abierto, setAbierto] = useState<DescargablePublico | null>(null);
  const [nombre, setNombre] = useState(nombreInicial);
  const [email, setEmail] = useState(emailInicial);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!abierto) return;
    setBusy(true);
    const res = await fetch(`/api/descargables/${abierto.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nombre, email, consent, website }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !json) {
      toast.error(json?.error ?? "No pudimos preparar la descarga.");
      return;
    }
    if (json.url) window.location.assign(json.url);
    setAbierto(null);
  }

  return (
    <>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((d) => (
          <li key={d.id} className="flex items-start gap-3 rounded-xl border border-[#ececec] bg-white p-4">
            <FileTextIcon className="mt-0.5 size-6 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[#19191f]">{d.title}</p>
              {d.description ? <p className="mt-0.5 text-[13px] text-[#6b6b6b]">{d.description}</p> : null}
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setAbierto(d)}>
                <DownloadIcon /> Descargar
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={abierto !== null} onOpenChange={(o) => !o && setAbierto(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{abierto?.title}</DialogTitle>
            <DialogDescription>Déjanos tu nombre y correo y la descarga empieza al instante.</DialogDescription>
          </DialogHeader>
          <form onSubmit={enviar} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead-nombre">Nombre</Label>
              <Input id="lead-nombre" value={nombre} maxLength={120} required autoComplete="name" onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-email">Correo</Label>
              <Input id="lead-email" type="email" value={email} maxLength={254} required autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
            </div>
            {/* Honeypot: invisible para personas, los bots lo rellenan. */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
            <label className="flex items-start gap-2 text-[13px] text-[#4a4a4a]">
              <input type="checkbox" className="mt-0.5" checked={consent} required onChange={(e) => setConsent(e.target.checked)} />
              <span>Acepto compartir mi nombre y correo con {tutor} y con Enséñame Ya.</span>
            </label>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Preparando…" : "Descargar"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
