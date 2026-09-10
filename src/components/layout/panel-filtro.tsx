"use client";

import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { PanelCounter } from "@/components/layout/panel-controls";

/* ─────────────────────────────────────────────────────────────────────────────
   G-03 · LOS CHIPS DE FILTRO, SIN IR AL SERVIDOR

   ⚠️ Antes cada chip era un `<Link href="?f=…">`. Suena inocente y no lo es:
   `?f=` forma parte de la CLAVE del segmento de página en el App Router, así
   que cambiarlo re-ejecuta la pantalla ENTERA en el servidor. En
   `/tutor/reservas` eso eran **once consultas a Supabase en cuatro olas
   seriales** —`session_bootstrap`, `tutor_profiles`, `bookings` + `tutor_students`,
   y las siete de los contadores del menú— para correr un `Array.filter` sobre
   datos que el navegador ya tenía delante. Ninguna de las once puede cambiar
   con el filtro: la consulta no lleva `.in("status", …)` a propósito (los chips
   necesitan contar lo que esconden).

   Y encima el borde de Suspense más cercano es `(app)/tutor/loading.tsx`, así
   que durante esas cuatro olas el panel entero se sustituía por el esqueleto:
   un filtro que solo esconde filas provocaba un fundido a logo de toda la
   pantalla. Eso es el «muy muy lento» que se reportó.

   ── CÓMO FUNCIONA AHORA ────────────────────────────────────────────────────
   La pantalla sigue siendo un Server Component y sigue pintando TODAS las
   filas. Cada trozo declara bajo qué filtros se ve (`data-f="todas proximas"`,
   ver `filtrosDe()` en cada pantalla) y este componente pone el filtro activo
   en el contenedor (`data-filtro`). Esconder es una regla de CSS.

   Por qué así y no moviendo la lista a un componente de cliente: la lista de
   reservas arrastra `salaDeLaReserva`, `studentName` y media pantalla de JSX
   al bundle, y obliga a serializar cada reserva DOS veces (HTML + props). Aquí
   no cruza el límite RSC nada más que el filtro activo, que es una cadena.

   ⚠️ La URL se sincroniza con `history.pushState`, NO con `router.push`: el App
   Router no tiene shallow routing, así que `router.push("?f=x")` volvería a
   pagar las once consultas y este componente no habría arreglado nada. Next
   parchea `pushState` (`app-router.js`, `applyUrlFromHistoryPushReplace`) para
   que `useSearchParams()` refleje el valor nuevo SIN pedir nada al servidor —
   por eso el filtro se lee de ahí y no de un `useState`, y por eso atrás y
   adelante del navegador funcionan solos.
   ────────────────────────────────────────────────────────────────────────── */

export type ChipDeFiltro = {
  id: string;
  label: string;
  /** Cuenta sobre TODAS las filas, no sobre las visibles: no cambia al filtrar. */
  total: number;
  /** El único chip que reclama acción va en naranja (G-03); el resto informan. */
  naranja?: boolean;
  /** `true` = no se pinta salvo que sea el activo (un `?f=` al que solo lleva el menú). */
  oculto?: boolean;
};

export function PanelFiltro({
  base,
  chips,
  sufijo,
  etiqueta,
  children,
}: {
  /** Ruta sin query, para reconstruir la URL: `/tutor/reservas`. */
  base: string;
  /** El PRIMERO es el de por defecto (el que no lleva `?f=`). */
  chips: ChipDeFiltro[];
  /**
   * Cola del texto que solo oye un lector de pantalla: «, 3 reservas».
   * Misma forma que el `contadorSufijo` del menú (`app-sidebar.tsx`), y por el
   * mismo motivo: «, 1 reservas» se oye mal y era lo que decía Reservas.
   */
  sufijo: { uno: string; varios: string };
  /** Si se pasa, la fila de chips es un `<nav>` con este `aria-label`. */
  etiqueta?: string;
  children: React.ReactNode;
}) {
  const buscados = useSearchParams().get("f");
  const activo = chips.some((x) => x.id === buscados) ? buscados! : chips[0].id;

  // `<nav>` cuando la fila tiene nombre; si no, un `<div>`: un `<nav>` sin
  // `aria-label` es una región anónima más en el índice del lector.
  const Fila = etiqueta ? "nav" : "div";

  // Una regla por filtro. Se generan de `chips` para que añadir uno no obligue
  // a acordarse de tocar el CSS — que es justo el fallo que un `globals.css`
  // con las reglas a mano tendría dentro de tres meses.
  const css = chips
    .map(
      (x) =>
        `[data-filtro="${x.id}"] [data-f]:not([data-f~="${x.id}"]){display:none}`,
    )
    .join("");

  return (
    <div data-filtro={activo} className="contents">
      {/* React 19 deduplica por `href` y lo sube al `<head>`: aunque dos
          pantallas monten el componente, la hoja se escribe una vez. */}
      <style href="panel-filtro" precedence="default">
        {css}
      </style>

      <Fila aria-label={etiqueta} className="flex flex-wrap gap-2">
        {chips
          .filter((x) => !x.oculto || x.id === activo)
          .map((x) => {
            const on = x.id === activo;
            return (
              <button
                key={x.id}
                type="button"
                // `aria-pressed` y no `aria-current="page"`: esto ya no navega
                // a ninguna página, es un interruptor.
                aria-pressed={on}
                onClick={() =>
                  history.pushState(
                    null,
                    "",
                    x.id === chips[0].id ? base : `${base}?f=${x.id}`,
                  )
                }
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[13px] transition-colors",
                  on
                    ? // `brand-foreground` (#036fda) y no `brand` (#0080ff):
                      // blanco sobre el azul de marca da 3,8:1 y AA pide 4,5.
                      // A ojo son el mismo azul. Era ya el criterio de
                      // `/tutor/products` y de `filter-pills.tsx`; Reservas se
                      // había quedado con el otro.
                      "border-brand-foreground bg-brand-foreground font-semibold text-white"
                    : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
                )}
              >
                {x.label}
                <PanelCounter
                  value={x.total}
                  tone={on ? "activo" : x.naranja ? "naranja" : "gris"}
                />
                {/* El círculo va `aria-hidden` para no ensuciar el nombre del
                    control con un número suelto, pero entonces la cifra se
                    pierde entera. Aquí vuelve, ya dicha. */}
                {x.total > 0 ? (
                  <span className="sr-only">
                    , {x.total} {x.total === 1 ? sufijo.uno : sufijo.varios}
                  </span>
                ) : null}
              </button>
            );
          })}
      </Fila>

      {children}
    </div>
  );
}
