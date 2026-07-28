"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

/**
 * Confirmación de cerrar sesión. Vive en un componente porque el botón está en
 * tres sitios (menú de cuenta, menú lateral y "Mi cuenta") y cada uno tenía su
 * propia copia del cierre de sesión.
 *
 * Controlado desde fuera: en el menú de cuenta el diálogo NO puede colgar del
 * `DropdownMenuItem` — al elegir la opción el menú se desmonta y se llevaría el
 * diálogo por delante.
 */
export function SignOutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>¿Cerrar sesión?</DialogTitle>
          <DialogDescription>
            Tendrás que volver a entrar con tu correo y tu contraseña.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            No
          </Button>
          <Button onClick={signOut} disabled={busy}>
            {busy ? "Cerrando…" : "Sí, cerrar sesión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
