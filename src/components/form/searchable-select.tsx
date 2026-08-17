"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { stripAccents } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  label: string;
  /** Texto invisible que TAMBIÉN encuentra la opción (prefijo, código ISO…). */
  search?: string;
  /** Apunte gris a la derecha de la etiqueta (`+58`). */
  hint?: string;
  /** Adorno a la izquierda (bandera emoji del teléfono). */
  icon?: ReactNode;
};

/**
 * M-09 · Desplegable con BUSCADOR.
 *
 * Zona horaria (≈420 opciones) y país del teléfono (≈245) eran `<select>`
 * nativos: "son muchas opciones y se vuelve burda de difícil conseguir". El
 * `<select>` del sistema solo deja saltar escribiendo el PRINCIPIO de la
 * etiqueta, y las nuestras empiezan por el offset —`(GMT-04:00) Caracas`—, así
 * que teclear "caracas" no llevaba a ninguna parte: solo quedaba scroll.
 *
 * Se busca sin tildes (`stripAccents`, el mismo criterio que EY-109 en la BD):
 * "bogota" encuentra "Bogotá".
 *
 * Accesibilidad (RV-14, mismo espíritu): disparador con `aria-expanded` +
 * `aria-haspopup`, caja de búsqueda `role="combobox"` que apunta a la opción
 * activa con `aria-activedescendant`, y lista `role="listbox"` con
 * `aria-selected`. Se maneja entero con el teclado: ↓ ↑ Inicio Fin, Enter
 * elige, Esc cierra y devuelve el foco al disparador.
 */
export function SearchableSelect({
  id,
  name,
  value,
  options,
  onChange,
  ariaLabel,
  describedBy,
  placeholder = "Elegir…",
  searchPlaceholder = "Buscar…",
  emptyLabel = "Sin resultados",
  triggerContent,
  triggerClassName,
  className,
  disabled,
  focusTriggerOnSelect = true,
  onFocus,
  onBlur,
}: {
  /** Va al DISPARADOR: es lo que apunta el `<label htmlFor>`. */
  id?: string;
  /** Si se pasa, se emite un input oculto para que el valor viaje en el submit. */
  name?: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  /**
   * `aria-describedby` del disparador. No hay `aria-invalid`: el rol implícito
   * `button` no lo admite (lo avisa el lint de a11y), así que un campo con
   * error marca el `<label>` y el mensaje, no el control.
   */
  describedBy?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Reemplaza la etiqueta dentro del disparador (el teléfono pinta bandera). */
  triggerContent?: ReactNode;
  triggerClassName?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Al elegir, ¿devolvemos el foco al disparador? El teléfono dice que NO:
   * `react-phone-number-input` manda el foco al número en cuanto cambia el
   * país, y devolverlo aquí se lo robaría (ver `phone-input.tsx`).
   */
  focusTriggerOnSelect?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const uid = useId();
  const listId = `${uid}-lista`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const selected = options.find((o) => o.value === value);

  const q = normaliza(query.trim());
  const visible = q
    ? options.filter((o) =>
        normaliza(`${o.label} ${o.hint ?? ""} ${o.search ?? ""}`).includes(q),
      )
    : options;

  function abrir() {
    if (disabled) return;
    setQuery("");
    // El cursor arranca sobre lo ya elegido: con 420 zonas, empezar siempre
    // por la primera obligaba a recorrer la lista entera con el teclado.
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function cerrar(devolverFoco = true) {
    setOpen(false);
    if (devolverFoco) trigger.current?.focus();
  }

  function elegir(opcion: SearchableOption | undefined) {
    if (!opcion) return;
    setOpen(false);
    onChange(opcion.value);
    if (focusTriggerOnSelect) trigger.current?.focus();
  }

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  // Cierre al pulsar fuera. `pointerdown` y no `click`: si se pulsa sobre otro
  // control, el panel tiene que quitarse de en medio ANTES de que ese control
  // reciba el clic.
  useEffect(() => {
    if (!open) return;
    function fuera(e: PointerEvent) {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [open]);

  // La opción activa, siempre a la vista: navegar 420 zonas con ↓ sin esto
  // mueve el cursor por debajo del borde y parece que no pasa nada.
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>('[data-activa="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function teclas(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) return abrir();
        if (visible.length === 0) return;
        const paso = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i + paso + visible.length) % visible.length);
        return;
      }
      case "Home":
        if (!open) return;
        e.preventDefault();
        setActive(0);
        return;
      case "End":
        if (!open) return;
        e.preventDefault();
        setActive(Math.max(0, visible.length - 1));
        return;
      case "Enter":
        if (!open) return; // El disparador es un <button>: Enter ya lo abre.
        // Sin esto, Enter en la caja de búsqueda ENVÍA el formulario que
        // envuelve al campo (/account, los asistentes).
        e.preventDefault();
        elegir(visible[active]);
        return;
      case "Escape":
        if (!open) return;
        e.preventDefault();
        // Que no llegue a un diálogo de alrededor y lo cierre también.
        e.stopPropagation();
        cerrar();
        return;
      case "Tab":
        // Sin `preventDefault`: el foco sigue al campo siguiente, que es lo que
        // espera quien tabula. El panel se cierra en el mismo gesto.
        if (open) setOpen(false);
        return;
    }
  }

  return (
    <div ref={wrapper} className={cn("relative w-full", className)}>
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <button
        ref={trigger}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onClick={() => (open ? cerrar() : abrir())}
        onKeyDown={teclas}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 text-left transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:opacity-50",
          triggerClassName,
        )}
      >
        {triggerContent ?? (
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              !selected && !value && "text-muted-foreground",
            )}
          >
            {/* Si el valor guardado no está en la lista (una zona IANA que este
                runtime no conoce) se enseña crudo, que es más honesto que
                fingir que no hay nada elegido. */}
            {selected?.label ?? (value || placeholder)}
          </span>
        )}
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          className={cn(
            "absolute z-50 mt-1 w-full min-w-[17rem] max-w-[calc(100vw-2rem)]",
            "overflow-hidden rounded-[10px] border border-input bg-popover shadow-lg",
          )}
        >
          <div className="flex items-center gap-2 border-b border-input px-3">
            <SearchIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={search}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                visible.length > 0 ? optionId(active) : undefined
              }
              aria-label={searchPlaceholder}
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={teclas}
              placeholder={searchPlaceholder}
              className="h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-64 overflow-y-auto py-1"
          >
            {visible.length === 0 ? (
              <li
                role="presentation"
                className="px-3 py-2 text-sm text-muted-foreground"
              >
                {emptyLabel}
              </li>
            ) : (
              visible.map((o, i) => {
                const elegida = o.value === value;
                return (
                  <li
                    key={o.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={elegida}
                    data-activa={i === active}
                    // Sin esto, el `mousedown` saca el foco de la caja de
                    // búsqueda antes de que llegue el clic.
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => elegir(o)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                      i === active && "bg-accent",
                      elegida && "font-medium",
                    )}
                  >
                    {o.icon ? (
                      <span className="w-5 shrink-0 text-center">{o.icon}</span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {o.hint}
                      </span>
                    ) : null}
                    {elegida ? (
                      <CheckIcon
                        className="size-4 shrink-0 text-brand"
                        aria-hidden="true"
                      />
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Mismo criterio que la búsqueda del catálogo: sin tildes y en minúsculas. */
function normaliza(texto: string): string {
  return stripAccents(texto).toLowerCase();
}
