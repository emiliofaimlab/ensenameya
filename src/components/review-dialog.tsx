"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { StarIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** US-901 (SCR-AL08) — dejar/editar reseña de una reserva completada (RN-17). */
export function ReviewDialog({
  bookingId,
  productTitle,
  existing,
}: {
  bookingId: string;
  productTitle: string;
  existing?: { rating: number; comment: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (rating < 1) {
      toast.error("Elige una puntuación de 1 a 5 estrellas.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_review", {
      p_booking_id: bookingId,
      p_rating: rating,
      p_comment: comment.trim() || undefined,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo guardar la reseña.");
      return;
    }
    toast.success(existing ? "Reseña actualizada." : "¡Gracias por tu reseña!");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={existing ? "outline" : "default"}>
          {existing ? "Editar reseña" : "Dejar reseña"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tu reseña</DialogTitle>
          <DialogDescription>{productTitle}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Estrellas clicables (objetivos táctiles grandes también en móvil). */}
          <div className="flex gap-1" role="radiogroup" aria-label="Puntuación">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
                aria-checked={rating === n}
                role="radio"
                className="p-1"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
              >
                <StarIcon
                  className={cn(
                    "size-8 transition-colors",
                    n <= (hover || rating)
                      ? "fill-current text-amber-500"
                      : "text-muted-foreground/30",
                  )}
                />
              </button>
            ))}
          </div>

          <Textarea
            placeholder="Cuenta cómo fue la clase (opcional)."
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button disabled={busy} onClick={submit}>
            {busy ? "Guardando…" : existing ? "Guardar cambios" : "Publicar reseña"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
