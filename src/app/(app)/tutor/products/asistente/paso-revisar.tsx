"use client";

import type { ReactNode } from "react";
import { InfoIcon, PencilIcon } from "lucide-react";

import { CANCELLATION_POLICY as P } from "@/lib/policy";
import { PanelCard } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { CARD_TITLE } from "./estilos";
import type { PasoId } from "./stepper";

export type BloqueResumen = {
  titulo: string;
  /** Paso al que lleva «Editar». */
  paso: PasoId;
  filas: { etiqueta: string; valor: ReactNode }[];
};

/**
 * Paso «Revisar»: todo lo elegido, por bloques, con «Editar» en cada uno. Es
 * presentación pura: el resumen lo arma el formulario, que es quien tiene el
 * estado, y los botones de guardar viven en la barra del asistente.
 */
export function PasoRevisar({
  bloques,
  grupal,
  onEditar,
}: {
  bloques: BloqueResumen[];
  grupal: boolean;
  onEditar: (paso: PasoId) => void;
}) {
  return (
    <>
      {bloques.map((b) => (
        <PanelCard key={b.titulo} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className={CARD_TITLE}>{b.titulo}</h3>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onEditar(b.paso)}
              className="h-11 rounded-[8px] px-3 text-[13px] font-medium text-brand"
            >
              <PencilIcon aria-hidden />
              Editar
              <span className="sr-only"> {b.titulo.toLowerCase()}</span>
            </Button>
          </div>
          <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[minmax(0,180px)_1fr]">
            {b.filas.map((f) => (
              <div key={f.etiqueta} className="contents">
                <dt className="text-xs text-[#6b6b6b] sm:pt-0.5">
                  {f.etiqueta}
                </dt>
                <dd className="-mt-1.5 min-w-0 break-words text-[#19191f] sm:mt-0">
                  {f.valor}
                </dd>
              </div>
            ))}
          </dl>
        </PanelCard>
      ))}

      {/* 193:30 — la política es la misma para todas y no se configura aquí.
          P5 · sin jerga interna, y en una grupal con sus reglas: bajas hasta la
          primera fecha, ninguna con el ciclo empezado, y el 100 % si el tutor
          cancela o mueve. */}
      <div className="flex gap-3 rounded-[16px] border border-[#b2d9ff] bg-[#e5f2ff] p-5">
        <InfoIcon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <div>
          <p className="text-[15px] font-semibold text-[#19191f]">
            Política de cancelación
          </p>
          <p className="mt-1 text-[12.5px] text-[#405980]">
            {grupal
              ? `El alumno puede darse de baja hasta que empiece la primera fecha: con ${P.cutoffHours} horas o más recupera el ${P.refundPct.studentEarly} %; con menos, el ${P.refundPct.studentLate} %. En un ciclo no hay bajas una vez empezado. Si cancelas la clase o una fecha, cada inscrito recupera lo que costaba; si mueves una fecha, quien no pueda ir se va con el 100 %. Es la misma para todas las clases y no se configura aquí.`
              : `Si el alumno cancela con ${P.cutoffHours} horas o más de anticipación recupera el ${P.refundPct.studentEarly} %; con menos, el ${P.refundPct.studentLate} %. Si cancelas tú, recupera el ${P.refundPct.tutorCancels} %. Es la misma para todas las mentorías y no se configura aquí.`}
          </p>
        </div>
      </div>
    </>
  );
}
