"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenIcon,
  GraduationCapIcon,
  SearchIcon,
  TagIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Suggestions = {
  tutors: { id: string; name: string; headline: string | null }[];
  products: { id: string; title: string }[];
  categories: { slug: string; name: string }[];
};

const EMPTY: Suggestions = { tutors: [], products: [], categories: [] };

type GroupKey = "tutors" | "products" | "categories";

/** El orden de grupos empieza por la sección en la que estás (acuerdo 24-jul). */
function groupOrder(pathname: string): GroupKey[] {
  if (pathname.startsWith("/tutors")) return ["tutors", "products", "categories"];
  if (pathname.startsWith("/classes") || pathname.startsWith("/products"))
    return ["products", "tutors", "categories"];
  if (pathname.startsWith("/categories")) return ["categories", "tutors", "products"];
  return ["tutors", "products", "categories"];
}

/**
 * Buscador global con sugerencias desplegables (R24-05). Es un `<form>` GET a
 * `/search` (Enter y "Ver todos" siguen funcionando sin JS); encima, al teclear
 * ≥2 caracteres, pide `/api/search/suggest` y muestra un desplegable agrupado en
 * **Tutores / Clases / Categorías**, empezando por la sección actual.
 */
export function SearchAutocomplete({
  placeholder = "Buscar tutores, mentorías o categorías",
  className,
  inputClassName,
  formClassName,
  submitLabel,
  autoFocusOnMount = false,
}: {
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** Estilos de la caja (el hero de P01 la pinta blanca con padding). */
  formClassName?: string;
  /** Si se pasa, se dibuja el botón de enviar dentro de la caja (hero). */
  submitLabel?: string;
  autoFocusOnMount?: boolean;
}) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ term: string; sug: Suggestions }>({
    term: "",
    sug: EMPTY,
  });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Posición del panel en coordenadas de viewport: se dibuja en un PORTAL sobre
  // el body, no dentro del formulario. Si no, el hero de P01 lo mata — tiene
  // `isolate` (crea contexto de apilamiento, así que ningún z-index interno
  // supera a la banda azul de garantías) y `overflow-hidden` (lo recortaría).
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  const term = q.trim();

  function measure() {
    const r = formRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.bottom + 6, width: r.width });
  }

  // Pide sugerencias con debounce; aborta la petición anterior si sigues tecleando.
  useEffect(() => {
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        if (r.ok) setResult({ term, sug: await r.json() });
      } catch {
        /* abortada o red: se ignora, el form GET sigue de fallback */
      }
    }, 200);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [term]);

  // Solo mostramos las sugerencias del término vigente (sin parpadeo de resultados viejos).
  const sug = result.term === term ? result.sug : EMPTY;

  // Cerrar al clicar fuera o con Escape. El panel vive en un portal, así que
  // "fuera" tiene que contemplarlo aparte del formulario.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Al hacer scroll o cambiar el tamaño, el panel sigue a su caja. Solo se
  // registran listeners: medir aquí de forma síncrona rompería la regla de
  // pureza de react-hooks (se mide desde los handlers).
  useEffect(() => {
    if (!open) return;
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const groups: Record<
    GroupKey,
    { label: string; icon: typeof TagIcon; items: { href: string; primary: string; secondary: string | null }[] }
  > = {
    tutors: {
      label: "Tutores",
      icon: GraduationCapIcon,
      items: sug.tutors.map((t) => ({ href: `/tutors/${t.id}`, primary: t.name, secondary: t.headline })),
    },
    products: {
      label: "Mentorías",
      icon: BookOpenIcon,
      items: sug.products.map((p) => ({ href: `/products/${p.id}`, primary: p.title, secondary: null })),
    },
    categories: {
      label: "Categorías",
      icon: TagIcon,
      items: sug.categories.map((c) => ({ href: `/categories/${c.slug}`, primary: c.name, secondary: null })),
    },
  };

  const hasResults =
    sug.tutors.length + sug.products.length + sug.categories.length > 0;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <form
        ref={formRef}
        action="/search"
        className={cn("relative flex items-center", formClassName)}
      >
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            measure();
          }}
          onFocus={() => {
            setOpen(true);
            measure();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          autoFocus={autoFocusOnMount}
          className={cn(
            // Placeholder en #595959, que es el del Figma para esta barra (el
            // token `muted-foreground` es #4d4d4d, un punto más oscuro).
            "h-11 w-full rounded-lg border border-border bg-secondary pr-3 pl-9 text-[13px] text-foreground placeholder:text-[#595959] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            inputClassName,
          )}
        />
        {submitLabel ? (
          <Button type="submit" className="h-10 shrink-0 px-6">
            {submitLabel}
          </Button>
        ) : null}
      </form>

      {open && term.length >= 2 && rect && typeof document !== "undefined"
        ? createPortal(
        <div
          ref={panelRef}
          style={{ left: rect.left, top: rect.top, width: rect.width }}
          className="fixed z-[60] overflow-hidden rounded-lg border border-border bg-card text-left shadow-lg"
        >
          {hasResults ? (
            <ul className="max-h-[65vh] overflow-auto py-1.5">
              {groupOrder(pathname).map((key) => {
                const g = groups[key];
                if (g.items.length === 0) return null;
                const Icon = g.icon;
                return (
                  <li key={key}>
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {g.label}
                    </p>
                    <ul>
                      {g.items.map((it) => (
                        <li key={it.href}>
                          <Link
                            href={it.href}
                            onClick={() => setOpen(false)}
                            className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted"
                          >
                            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                              <Icon className="size-3.5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {it.primary}
                              </span>
                              {it.secondary ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {it.secondary}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Sin sugerencias para «{term}».
            </p>
          )}
          <Link
            href={`/search?q=${encodeURIComponent(term)}`}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-[13px] font-medium text-brand hover:bg-muted"
          >
            <SearchIcon className="size-3.5" />
            Ver todos los resultados de «{term}»
          </Link>
        </div>,
        document.body,
          )
        : null}
    </div>
  );
}
