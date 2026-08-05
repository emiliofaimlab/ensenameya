"use client";

import { useState } from "react";
import { toast } from "sonner";

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
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const { error } = await createClient().auth.signOut();

    if (error) {
      // Sin esto el diálogo se quedaba en "Cerrando…" para siempre ante
      // cualquier fallo, sin decir qué pasó ni dejar reintentar.
      toast.error("No se pudo cerrar la sesión. Inténtalo de nuevo.");
      setBusy(false);
      return;
    }

    // Recarga completa en vez de `router.push` + `refresh`: cerrar sesión es el
    // momento de tirar TODO el estado de cliente —la cabecera, y las cachés de
    // RSC de las rutas ya visitadas, que se quedaban con contenido de la sesión
    // anterior—, no solo de navegar. Y de paso el diálogo se va con la página:
    // antes la navegación era de cliente, la cabecera no se desmontaba y el
    // modal se quedaba pegado con su "Cerrando…" hasta que clicabas fuera.
    window.location.assign("/");
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
