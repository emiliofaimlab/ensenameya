"use client";

import type { Dispatch, SetStateAction } from "react";

import { MAX_REQUIREMENTS, MAX_REQUIREMENT_LEN } from "@/lib/product-requirements";
import { cn } from "@/lib/utils";
import { PanelCard } from "@/components/layout/panel-shell";
import {
  MaterialsPicker,
  stage,
  type SavedMaterial,
  type StagedFile,
} from "@/components/tutor/product-uploads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AcceptanceMode } from "../acceptance-mode";
import { CARD_TITLE, FIELD } from "./estilos";

/** Píldora «Opcional»: el paso entero se puede saltar y tiene que verse. */
function Opcional() {
  return (
    <span className="rounded-full bg-[#f5f5f5] px-2 py-0.5 text-[11px] font-medium text-[#6b6b6b]">
      Opcional
    </span>
  );
}

/**
 * Paso «Extras» del asistente: materiales, requerimientos, FAQ y cómo se
 * confirman las reservas. Nada de esto impide publicar —la confirmación ya
 * llega con su valor por defecto—, por eso va junto y al final, marcado.
 */
export function PasoExtras({
  grupal,
  loading,
  savedMaterials,
  stagedMaterials,
  setStagedMaterials,
  onRemoveSavedMaterial,
  requirements,
  setRequirements,
  faqs,
  setFaqs,
  autoAccept,
  setAutoAccept,
}: {
  grupal: boolean;
  loading: boolean;
  savedMaterials: SavedMaterial[];
  stagedMaterials: StagedFile[];
  setStagedMaterials: Dispatch<SetStateAction<StagedFile[]>>;
  onRemoveSavedMaterial: (id: string) => void;
  requirements: string[];
  setRequirements: Dispatch<SetStateAction<string[]>>;
  faqs: { q: string; a: string }[];
  setFaqs: Dispatch<SetStateAction<{ q: string; a: string }[]>>;
  autoAccept: boolean;
  setAutoAccept: (v: boolean) => void;
}) {
  return (
    <>
      {/* Materiales de clase de ESTA oferta (R24-16): se movieron aquí desde el
          onboarding. N-05 — ya no hace falta guardar y volver a entrar: se
          eligen ahora y suben con el resto del formulario. */}
      <PanelCard className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className={CARD_TITLE}>Materiales de la mentoría</h3>
          <Opcional />
        </div>
        <p className="text-[13px] text-[#6b6b6b]">
          Guías, plantillas o ejercicios que tus alumnos usarán en clase. Se
          suben al guardar la mentoría.
        </p>
        <MaterialsPicker
          saved={savedMaterials}
          staged={stagedMaterials}
          onAdd={(files) =>
            setStagedMaterials((prev) => [...prev, ...files.map(stage)])
          }
          onRemoveStaged={(key) =>
            setStagedMaterials((prev) => prev.filter((s) => s.key !== key))
          }
          onRemoveSaved={onRemoveSavedMaterial}
          disabled={loading}
        />
      </PanelCard>

      {/* Requerimientos de sesión — lo que el ALUMNO tiene que traer.

          Va pegada a los materiales a propósito: las dos tarjetas hablan de con
          qué se llega a la sala y son las dos caras de lo mismo — arriba lo que
          pone el tutor, aquí lo que pone el alumno. Ponerla en «Contenido» la
          habría mezclado con lo que se VENDE (título, resultado, precio), y
          esto no vende: avisa.

          Misma mecánica que las FAQ de abajo, con una fila por requisito. */}
      <PanelCard className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className={CARD_TITLE}>Requerimientos de sesión</h3>
          <Opcional />
        </div>
        <p className="text-[13px] text-[#6b6b6b]">
          Lo que tu alumno necesita tener listo ANTES de la clase: una
          computadora, buena conexión, un cuaderno, un ventilador… Se lo
          enseñamos en la ficha —antes de que reserve— y en su reserva. Si lo
          dejas vacío no se muestra nada.
        </p>

        {requirements.map((r, i) => (
          // La clave lleva el índice porque el contenido lo está escribiendo el
          // tutor: dos filas vacías tendrían la misma `key` y React tiraría una.
          <div key={i} className="flex items-center gap-2">
            <Input
              value={r}
              onChange={(e) =>
                setRequirements((p) =>
                  p.map((x, j) => (j === i ? e.target.value : x)),
                )
              }
              maxLength={MAX_REQUIREMENT_LEN}
              placeholder="Ej: una computadora con cámara y micrófono"
              aria-label={`Requisito ${i + 1}`}
              className={cn(FIELD, "min-w-0 flex-1")}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setRequirements((p) => p.filter((_, j) => j !== i))
              }
              aria-label={`Quitar el requisito ${i + 1}`}
              className="h-11 shrink-0 rounded-[8px] px-3 text-[13px] text-[#bf3333]"
            >
              Quitar
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={() => setRequirements((p) => [...p, ""])}
          disabled={requirements.length >= MAX_REQUIREMENTS}
          className="h-11 self-start rounded-[8px] px-4 text-[13px]"
        >
          + Agregar requisito
        </Button>
        {requirements.length >= MAX_REQUIREMENTS ? (
          <p className="text-xs text-[#6b6b6b]">
            Máximo {MAX_REQUIREMENTS}. Una lista más larga deja de leerse justo
            donde importa, que es antes de reservar.
          </p>
        ) : null}
      </PanelCard>

      {/* FAQ de ESTA mentoría (R24-17). Las del PERFIL del tutor (EY-194) se
          siguen pintando debajo en la ficha pública, pero su editor está
          OCULTO desde el 28-ago: aquí ya no se enlaza. Las genéricas de
          plataforma solo salen si no hay ni unas ni otras. */}
      <PanelCard className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className={CARD_TITLE}>Preguntas frecuentes</h3>
          <Opcional />
        </div>
        <p className="text-[13px] text-[#6b6b6b]">
          Responde lo que suelen preguntarte sobre esta mentoría (nivel previo,
          materiales, formato…). Si la dejas vacía se muestran las generales.
        </p>

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
              placeholder="¿Necesito conocimientos previos?"
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
              aria-label={`Quitar la pregunta ${i + 1}`}
              className="h-11 self-start rounded-[8px] px-3 text-[13px] text-[#bf3333]"
            >
              Quitar
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={() => setFaqs((p) => [...p, { q: "", a: "" }])}
          className="h-11 self-start rounded-[8px] px-4 text-[13px]"
        >
          + Agregar pregunta
        </Button>
      </PanelCard>

      {/* M-02 · va al final de los extras, justo antes de «Revisar»: habla de
          lo que pasa DESPUÉS de que el alumno pague y es lo único de eso que el
          tutor decide. RG-07: en una grupal no hay elección (siempre sola). */}
      {grupal ? null : (
        <PanelCard className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h3 className={CARD_TITLE}>Cómo se confirman las reservas</h3>
            <Opcional />
          </div>
          <p className="text-[13px] text-[#6b6b6b]">
            Se decide en cada mentoría: puedes filtrar a mano quién entra en una
            y dejar que otra se confirme sola.
          </p>
          <AcceptanceMode
            value={autoAccept}
            onChange={setAutoAccept}
            disabled={loading}
          />
        </PanelCard>
      )}
    </>
  );
}
