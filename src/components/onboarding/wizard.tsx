"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { forgetStep, type WizardId } from "./wizard-step";

/**
 * Armazón del asistente de onboarding (AL01 / TU01). El Figma reparte la
 * columna de 600 px en cuatro bloques separados por 24 px: progreso, título,
 * tarjeta (SOLO los campos) y botonera. La tarjeta no envuelve la pantalla.
 *
 * El BOTÓN "Guardar y salir" vive en el header (`SiteHeader onboarding`), no
 * aquí; el GUARDADO que promete sí es de aquí (`useSaveOnExit`).
 *
 * ⚠️ Esta botonera —«Atrás» / «Continuar»— es la ÚNICA del paso. Los módulos
 * del panel que se reusan dentro (verificación, disponibilidad) apagan sus
 * propios botones de guardar y dejan que «Continuar» los dispare: cuatro
 * controles en la misma pantalla y ninguno diciendo cuál avanza fue justo la
 * queja que trajo esto. Lo que sí puede convivir es un botón que CREA algo
 * («Añadir franja», «Crear mi primera mentoría»): no compite con avanzar.
 *
 * ⚠️ El paso se espeja en la URL (`?paso=N`) para que el botón "atrás" del
 * navegador y una recarga a media edición no tiren al principio. Lo que NO
 * hace es recordarte entre visitas: desde el 28-ago-2026 entrar al asistente
 * empieza siempre por el paso 1 (`useWizardStep`, ver `wizard-step.ts`).
 */

/** Alto y forma de los controles del asistente: 45 px, r8 (AL01 180:1297). */
export const FIELD_CLASS =
  "h-[45px] rounded-[8px] px-3.5 text-sm placeholder:text-[#8c8c8c]";

/**
 * Paso del asistente, espejado en la URL. `initial` lo resuelve la PÁGINA
 * (`resolveStep`), así que el primer HTML ya viene con el paso bueno y no hay
 * parpadeo de "Paso 1" al hidratar.
 *
 * El espejo se hace con `history.replaceState` y NO con `router.replace`:
 * cambiar el query con el router vuelve a pedir el RSC de la página entera —y
 * con él el `redirect` de `onboarding_complete`— solo para mover un número.
 * Next integra la History API nativa desde la 14.1, así que `useSearchParams`
 * sigue viendo el valor. `replace` y no `push` a propósito: el asistente ya
 * tiene su botón "Atrás" y no queremos que salir del onboarding cueste cinco
 * pulsaciones del botón del navegador.
 */
export function useWizardStep(wizard: WizardId, initial: number) {
  const [step, setStep] = useState(initial);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("paso") === String(step)) return;
    url.searchParams.set("paso", String(step));
    window.history.replaceState(null, "", url);
  }, [step]);

  // 28-ago-2026 · La cookie de M-03 ya no decide dónde aterrizas, pero la que se
  // escribió antes dura un año. Se borra al montar para no dejarla rondando.
  useEffect(() => {
    forgetStep(wizard);
  }, [wizard]);

  /**
   * El asistente terminó: el `?paso=` sale de la URL. Si se quedara, compartir
   * o recargar la pantalla de cierre reabriría el asistente por el último paso
   * —y encima con el `redirect` de `onboarding_complete` esperando detrás.
   */
  const finish = () => {
    forgetStep(wizard);
    const url = new URL(window.location.href);
    if (!url.searchParams.has("paso")) return;
    url.searchParams.delete("paso");
    window.history.replaceState(null, "", url);
  };

  return { step, setStep, finish };
}

/**
 * M-03 · "Guardar y salir" que guarda de verdad.
 *
 * El enlace vive en `SiteHeader` (modo onboarding) y es un `<Link href="/">`
 * pelado: prometía un guardado que no ocurría. Ese header es de otra pantalla y
 * duplicar el botón aquí dejaría dos "Guardar y salir" en la misma barra, así
 * que el asistente guarda **al desmontarse**: salir por ese enlace, por el
 * botón atrás del navegador o por cualquier otro sitio pasa por aquí, porque
 * Next navega en cliente y el desmontaje ocurre antes de que la pantalla
 * cambie. La petición a Supabase sale y termina aunque ya no se vea nada.
 *
 * `save` debe ser tolerante: se llama con el paso a medio rellenar, así que
 * escribe lo que sea válido y calla lo que no (un teléfono a medias rompería
 * el CHECK E.164 de `profiles`).
 */
export function useSaveOnExit(save: () => void | Promise<void>) {
  // La cleanup se cierra sobre el `save` del PRIMER render y guardaría un
  // formulario vacío; el ref lo mantiene apuntando a los valores actuales.
  // Se actualiza en un efecto, no en el cuerpo: escribir un ref durante el
  // render es justo lo que prohíbe `react-hooks/refs`.
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  });
  useEffect(() => () => void latest.current(), []);
}

/**
 * M-03 · Pantalla de cierre del asistente. "Yo nunca terminé, a mí nunca me
 * vino la satisfacción de que terminé el onboarding… directamente me sacó":
 * antes el último paso hacía `router.push` y el usuario aterrizaba en un panel
 * sin saber si había acabado bien.
 *
 * El check es el mismo de "reserva confirmada" (SCR-AL06) —mismo medallón de
 * 120/80 px y mismo trazo— pero en verde, que es como lo pidió Diana. Allí va
 * en naranja de marca; si algún día se unifican, se unifican los dos.
 *
 * ⚠️ Se pinta EN SITIO, sin navegar: la página de alumno redirige fuera cuando
 * `onboarding_complete` es true, así que un `router.refresh()` aquí se comería
 * su propia pantalla de cierre.
 */
export function WizardDone({
  title,
  description,
  href,
  cta = "Ir a mi panel",
  children,
}: {
  title: string;
  description: React.ReactNode;
  href: string;
  cta?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col items-center gap-4">
      <span className="grid size-[120px] place-items-center rounded-full bg-success-muted">
        <span className="grid size-20 place-items-center rounded-full bg-success text-white">
          <CheckIcon className="size-9" strokeWidth={3} />
        </span>
      </span>

      <h1 className="text-center text-[26px] font-bold text-[#19191f]">
        {title}
      </h1>
      <p className="text-center text-sm text-[#6b6b6b]">{description}</p>

      {children}

      <Button
        asChild
        className="mt-2 h-[49px] rounded-[10px] px-6 font-semibold"
      >
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}

/** Lista de "lo que hiciste" de la pantalla de cierre: check verde por línea. */
export function DoneChecklist({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 flex w-full flex-col gap-2 rounded-[16px] border border-[#e0e0e0] bg-card p-5">
      {items.map((t) => (
        <li key={t} className="flex items-center gap-2 text-[13px] text-[#404040]">
          <CheckIcon className="size-3.5 shrink-0 text-success" strokeWidth={3} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Botonera: 45 px de alto y 22 de padding → 116×45 "Continuar", 82×45 "Atrás". */
const BUTTON_CLASS = "h-[45px] rounded-[8px] px-[22px] text-sm";

export function WizardShell({
  step,
  total,
  title,
  description,
  children,
  onBack,
  onNext,
  nextLabel = "Continuar",
  busyLabel = "Guardando…",
  nextDisabled,
  busy,
  bare = false,
  maxWidth = 600,
}: {
  step: number;
  total: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  /** Qué se lee mientras trabaja. El último paso ENVÍA, no guarda. */
  busyLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  /** El contenido trae sus propias tarjetas (p. ej. el módulo de verificación):
   *  sin la tarjeta blanca del asistente para no anidar. */
  bare?: boolean;
  /** Ancho de la columna; algunos pasos (verificación) piden más aire. */
  maxWidth?: number;
}) {
  return (
    <div
      className="mx-auto flex w-full flex-col gap-6"
      style={{ maxWidth }}
    >
      <div className="flex flex-col gap-2">
        <p className="text-xs text-[#6b6b6b]">
          Paso {step} de {total}
        </p>

        {/* Progreso: `progressbar` para que un lector de pantalla lo anuncie. */}
        <div
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Paso ${step} de ${total}`}
          className="flex gap-1.5"
        >
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i < step ? "bg-brand" : "bg-border",
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] leading-[1.5] font-bold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="text-[13px] text-[#6b6b6b]">{description}</p>
        ) : null}
      </div>

      {bare ? (
        <div className="flex flex-col gap-5">{children}</div>
      ) : (
        <div className="rounded-[16px] border border-[#e6e6e6] bg-card p-7">
          <div className="flex flex-col gap-5">{children}</div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {onBack ? (
          <Button
            variant="outline"
            onClick={onBack}
            disabled={busy}
            className={cn(BUTTON_CLASS, "text-[#4d4d4d]")}
          >
            Atrás
          </Button>
        ) : (
          <span />
        )}
        <Button
          onClick={onNext}
          disabled={nextDisabled || busy}
          className={cn(BUTTON_CLASS, "font-semibold")}
        >
          {busy ? busyLabel : nextLabel}
        </Button>
      </div>
    </div>
  );
}

/** Campo del asistente: etiqueta 12.5/400 gris + control, con 6 px de aire. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-[12.5px] font-normal text-[#6b6b6b]"
      >
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-[#6b6b6b]">{hint}</p> : null}
    </div>
  );
}

/** Chips de selección múltiple (categorías / intereses). */
export function ChipGroup({
  options,
  selected,
  onToggle,
  ariaLabel,
}: {
  options: { id: string; label: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = selected.has(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.id)}
            className={cn(
              "inline-flex h-[38px] items-center rounded-full border px-4 text-[13px] transition-colors",
              on
                ? "border-brand bg-brand font-semibold text-white"
                : "bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
