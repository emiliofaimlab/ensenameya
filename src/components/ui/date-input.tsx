"use client";

import { useRef, useState } from "react";
import { CalendarIcon } from "lucide-react";

import { Input } from "@/components/ui/input";

/**
 * EY-240 · fecha en DD/MM/AAAA siempre. El `<input type="date">` nativo pinta
 * el formato del IDIOMA DEL NAVEGADOR, no el de la página: con Chrome en inglés
 * salía MM/DD/YYYY aunque el sitio esté en español. Aquí se teclea DD/MM/AAAA y
 * el botón abre el calendario nativo (oculto) para no perderlo.
 *
 * `value` / `onChange` hablan `YYYY-MM-DD` (o ""), igual que el nativo.
 */
const toDMY = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
};

function toISO(dmy: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  if (!m) return "";
  const [, d, mo, y] = m;
  // Descarta 31/02 y compañía: Date normaliza y deja de coincidir.
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  return dt.getUTCDate() === +d && dt.getUTCMonth() === +mo - 1
    ? `${y}-${mo}-${d}`
    : "";
}

// Teclear «25102026» deja «25/10/2026».
const mask = (s: string) => {
  const n = s.replace(/\D/g, "").slice(0, 8);
  return [n.slice(0, 2), n.slice(2, 4), n.slice(4)].filter(Boolean).join("/");
};

export function DateInput({
  id,
  value,
  onChange,
  min,
  required,
}: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  required?: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(toDMY(value));
  // Si el padre cambia el valor (p. ej. lo vacía tras guardar), se resincroniza.
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    if (value !== toISO(text)) setText(toDMY(value));
  }

  const iso = toISO(text);
  const invalid = text.length === 10 && (!iso || (!!min && iso < min));

  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        placeholder="DD/MM/AAAA"
        value={text}
        required={required}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const t = mask(e.target.value);
          setText(t);
          const next = toISO(t);
          onChange(next && (!min || next >= min) ? next : "");
        }}
        className="pr-9"
      />
      <button
        type="button"
        aria-label="Abrir calendario"
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        onClick={() => picker.current?.showPicker?.()}
      >
        <CalendarIcon className="size-4" />
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        value={iso}
        onChange={(e) => {
          setText(toDMY(e.target.value));
          onChange(e.target.value);
        }}
        className="pointer-events-none absolute right-0 bottom-0 size-0 opacity-0"
      />
    </div>
  );
}
