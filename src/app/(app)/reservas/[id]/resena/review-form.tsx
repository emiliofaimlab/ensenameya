"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendIcon, StarIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Etiqueta de la puntuación, como en AL08 ("4 de 5 — Muy buena"). */
const RATING_LABEL = ["", "Muy mala", "Mala", "Regular", "Muy buena", "Excelente"];

/**
 * US-901 (SCR-AL08) — dejar/editar reseña, como página (antes era un diálogo).
 * `submit_review` hace upsert (RN-17), así que sirve para crear y para editar.
 */
export function ReviewForm({
  bookingId,
  existing,
  suggestedName,
}: {
  bookingId: string;
  existing?: {
    rating: number;
    comment: string | null;
    authorDisplay?: string | null;
  } | null;
  /** Cómo se vería su firma ("Marina G."), para que sepa qué está aceptando. */
  suggestedName: string | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(existing?.comment ?? "");
  // Decisión 18: anónima salvo que consienta firmar. Por defecto, no.
  const [sign, setSign] = useState(Boolean(existing?.authorDisplay));
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
      p_sign: sign,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo guardar la reseña.");
      return;
    }
    toast.success(existing ? "Reseña actualizada." : "¡Gracias por tu reseña!");
    router.push(`/reservas/${bookingId}`);
    router.refresh();
  }

  return (
    <>
      <div>
        <p className="text-base font-semibold text-[#19191f]">Tu calificación</p>
        <div
          className="mt-2 flex gap-1.5"
          role="radiogroup"
          aria-label="Puntuación"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setRating(n)}
            >
              <StarIcon
                className={cn(
                  "size-[30px] transition-colors",
                  // Naranja #fe6a00 (177:57): en nuestros tokens es `primary`
                  // — `brand` es el azul.
                  n <= shown ? "fill-primary text-primary" : "text-[#d9d9d9]",
                )}
              />
            </button>
          ))}
        </div>
        {/* Alto fijo: sin él, la etiqueta empuja el textarea al pasar el ratón. */}
        <p className="mt-2 h-4 text-xs text-[#6b6b6b]">
          {shown > 0 ? `${shown} de 5 — ${RATING_LABEL[shown]}` : null}
        </p>
      </div>

      <div className="mt-2">
        <p className="text-base font-semibold text-[#19191f]">
          Comentario (opcional)
        </p>
        <Textarea
          className="mt-2 min-h-24 rounded-[12px] border-[#e0e0e0] bg-muted"
          placeholder="Cuéntanos qué te ayudó más de la mentoría…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      {/* Decisión 18: el nombre solo se publica si lo consiente, y se enseña
          antes cómo va a quedar. Sin marcar, la reseña sale como "Alumno". */}
      <label className="mt-4 flex items-start gap-2.5 text-[13px] text-[#4d4d4d]">
        <input
          type="checkbox"
          checked={sign}
          onChange={(e) => setSign(e.target.checked)}
          disabled={!suggestedName}
          className="mt-0.5 size-[18px] shrink-0 rounded-[5px] border-input accent-primary"
        />
        <span>
          {suggestedName ? (
            <>
              Firmar como <strong className="font-semibold">{suggestedName}</strong>.
              Si no la marcas, tu reseña se publica como <em>Alumno</em>.
            </>
          ) : (
            <>
              Añade tu nombre en tu cuenta si quieres firmar la reseña. Mientras
              tanto se publica como <em>Alumno</em>.
            </>
          )}
        </span>
      </label>

      {/* El Figma dice "podrás editarla durante 24 h", pero `submit_review` hace
          upsert sin ventana: se puede editar siempre. Se cuenta lo que hace el
          sistema de verdad. */}
      <p className="mt-3.5 text-xs text-[#6b6b6b]">
        Podrás editar tu reseña más adelante si cambias de opinión.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          className="h-[49px] rounded-[10px] px-6 font-semibold"
          disabled={busy}
          onClick={submit}
        >
          <SendIcon className="size-4" />
          {busy ? "Guardando…" : existing ? "Guardar cambios" : "Publicar reseña"}
        </Button>
        <Button
          variant="outline"
          className="h-[49px] rounded-[10px] px-6"
          disabled={busy}
          onClick={() => router.push(`/reservas/${bookingId}`)}
        >
          Ahora no
        </Button>
      </div>
    </>
  );
}
