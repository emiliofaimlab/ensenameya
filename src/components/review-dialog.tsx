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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Etiqueta de la puntuación, como en AL08 ("4 de 5 — Muy buena"). */
const RATING_LABEL = [
  "",
  "Muy mala",
  "Mala",
  "Regular",
  "Muy buena",
  "Excelente",
];

/** US-901 (SCR-AL08) — dejar/editar reseña de una reserva completada (RN-17). */
export function ReviewDialog({
  bookingId,
  productTitle,
  completedAt,
  existing,
}: {
  bookingId: string;
  productTitle: string;
  /** Fecha de la sesión, para dar contexto de qué se está reseñando. */
  completedAt?: string | null;
  existing?: { rating: number; comment: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [busy, setBusy] = useState(false);

  const shown = hover || rating;

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
          <DialogTitle>Deja tu reseña</DialogTitle>
          <DialogDescription>
            Tu opinión ayuda a otros estudiantes a elegir.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted p-4">
          <p className="font-semibold">{productTitle}</p>
          {completedAt ? (
            <p className="text-[13px] text-muted-foreground">
              Sesión completada el{" "}
              {new Date(completedAt).toLocaleDateString("es", {
                day: "numeric",
                month: "long",
              })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm font-semibold">Tu calificación</p>
            {/* Estrellas clicables (objetivos táctiles grandes también en móvil). */}
            <div
              className="mt-2 flex gap-1"
              role="radiogroup"
              aria-label="Puntuación"
            >
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
                      n <= shown
                        ? "fill-current text-amber-500"
                        : "text-muted-foreground/30",
                    )}
                  />
                </button>
              ))}
            </div>
            {/* Alto fijo: sin él, la etiqueta empuja el textarea al pasar el ratón. */}
            <p className="mt-1 h-4 text-xs text-muted-foreground">
              {shown > 0 ? `${shown} de 5 — ${RATING_LABEL[shown]}` : null}
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold">Comentario (opcional)</p>
            <Textarea
              className="mt-2"
              placeholder="Cuéntanos qué te ayudó más de la clase…"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {/* El Figma dice "podrás editarla durante 24 h", pero `submit_review`
              hace upsert sin ventana: se puede editar siempre. Se cuenta lo que
              el sistema hace de verdad. */}
          <p className="text-xs text-muted-foreground">
            Podrás editar tu reseña más adelante si cambias de opinión.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Ahora no</Button>
          </DialogClose>
          <Button disabled={busy} onClick={submit}>
            {busy
              ? "Guardando…"
              : existing
                ? "Guardar cambios"
                : "Publicar reseña"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
