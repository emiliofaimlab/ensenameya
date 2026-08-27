"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { MAX_TUTOR_FAQS, type Faq } from "@/lib/tutor-faqs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** Campo del panel (192:46): 45 px, r8, placeholder gris. Igual que TU04. */
const FIELD = "h-[45px] rounded-[8px] px-3.5 text-sm placeholder:text-[#8c8c8c]";

/**
 * EY-194 · editor de las FAQ del PERFIL del tutor.
 *
 * Es el MISMO patrón que el bloque "Preguntas frecuentes" de `product-form.tsx`
 * (pregunta en un `Input`, respuesta en un `Textarea`, "Quitar" por fila,
 * "+ Añadir pregunta" al final) y eso es deliberado: el tutor va a ver los dos
 * editores el mismo día y no tiene por qué aprender dos formas de escribir lo
 * mismo. Si alguien retoca uno, que retoque el otro.
 *
 * Lo que sí cambia es el guardado: allí las FAQ viajan dentro del `submit` de
 * la mentoría; aquí son el único contenido de la pantalla y tienen su botón.
 */
export function TutorFaqsForm({
  userId,
  initial,
}: {
  userId: string;
  initial: Faq[];
}) {
  const router = useRouter();
  const [faqs, setFaqs] = useState<Faq[]>(initial);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    // Se descartan las filas a medio escribir en vez de bloquear el guardado:
    // el tutor que añadió una fila y se lo pensó mejor no tiene que buscar cuál
    // era para poder guardar el resto. Mismo criterio que la mentoría.
    const limpias = faqs
      .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
      .filter((f) => f.q && f.a);

    setSaving(true);
    const { error } = await createClient()
      .from("tutor_profiles")
      .update({ faqs: limpias })
      .eq("profile_id", userId);
    setSaving(false);

    if (error) {
      // El mensaje crudo de Postgres suele ser el útil aquí: un
      // `permission denied for column faqs` significa que la migración no está
      // aplicada, y esconderlo tras un "no se pudo guardar" cuesta media tarde.
      return toast.error(error.message || "No se pudieron guardar tus preguntas.");
    }

    // Lo guardado es lo limpio: si no se refleja, el tutor cree que sus filas a
    // medias siguen ahí y al recargar descubre que no.
    setFaqs(limpias);
    toast.success("Preguntas guardadas.");
    // La ficha pública es un Server Component y se cachea por ruta: sin esto,
    // el tutor puede ir a verla y encontrarse lo de antes.
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {faqs.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-[#e0e0e0] px-4 py-6 text-center text-[13px] text-[#6b6b6b]">
          Todavía no has escrito ninguna. Mientras tanto, tus mentorías muestran
          las suyas propias o las preguntas generales de la plataforma.
        </p>
      ) : null}

      {faqs.map((f, i) => (
        <div
          key={i}
          className="grid gap-2 rounded-[12px] border border-[#e0e0e0] p-3.5"
        >
          <Input
            value={f.q}
            onChange={(e) =>
              setFaqs((p) =>
                p.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)),
              )
            }
            placeholder="¿Cómo son tus clases?"
            aria-label={`Pregunta ${i + 1}`}
            className={FIELD}
          />
          <Textarea
            value={f.a}
            onChange={(e) =>
              setFaqs((p) =>
                p.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)),
              )
            }
            rows={2}
            placeholder="Tu respuesta…"
            aria-label={`Respuesta ${i + 1}`}
            className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => setFaqs((p) => p.filter((_, j) => j !== i))}
            className="h-9 self-start rounded-[8px] px-3 text-[13px] text-[#bf3333]"
          >
            Quitar
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={faqs.length >= MAX_TUTOR_FAQS}
          onClick={() => setFaqs((p) => [...p, { q: "", a: "" }])}
          className="h-10 rounded-[8px] px-4 text-[13px]"
        >
          + Añadir pregunta
        </Button>

        <Button
          type="button"
          onClick={guardar}
          disabled={saving}
          className="h-10 rounded-[8px] px-5 text-[13px]"
        >
          {saving ? "Guardando…" : "Guardar"}
        </Button>

        {/* El tope no está en la BD (ver la migración): si algún día hace falta
            de verdad, se pone allí; aquí solo evita la lista infinita. */}
        {faqs.length >= MAX_TUTOR_FAQS ? (
          <span className="text-[12.5px] text-[#6b6b6b]">
            Máximo {MAX_TUTOR_FAQS} preguntas.
          </span>
        ) : null}
      </div>
    </div>
  );
}
