import type { ReactNode } from "react";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { PortadaCategoria } from "@/components/clasificados/clasificado-card";

/**
 * 27-nov · el armazón del detalle de un clasificado, con la línea gráfica de
 * la ficha de mentoría (`(public)/mentorias/[id]`): banda azul con miga, título
 * y datos; debajo, columna principal + columna de 348 px con la portada de la
 * categoría y la tarjeta de acción (postular / estado y acciones del dueño).
 *
 * ponytail: es la versión llana de aquella ficha — sin la franja de precio fija
 * ni la portada que cambia de columna, que allí existen por el panel de reserva.
 */
export function FichaClasificado({
  categoria,
  titulo,
  datos,
  lateral,
  children,
}: {
  categoria: { name: string; slug: string; icon: string | null } | null;
  titulo: string;
  /** Chips bajo el título (fecha, horarios, estado…). */
  datos: ReactNode;
  /** Tarjeta de la columna derecha, bajo la portada. */
  lateral: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-8 lg:py-10">
          <nav
            aria-label="Miga de pan"
            className="flex items-center gap-1.5 truncate text-[13px] text-white/90"
          >
            <Link href="/" className="shrink-0 hover:underline">
              Inicio
            </Link>
            <span className="shrink-0">/</span>
            <Link href="/clasificados" className="shrink-0 hover:underline">
              Clasificados
            </Link>
            {categoria ? (
              <>
                <span className="shrink-0">/</span>
                <Link
                  href={`/clasificados?categoria=${encodeURIComponent(categoria.slug)}`}
                  className="shrink-0 hover:underline"
                >
                  {categoria.name}
                </Link>
              </>
            ) : null}
          </nav>
          <h1 className="mt-4 max-w-[760px] text-[22px] font-bold text-balance lg:text-[30px] lg:leading-[1.2]">
            {titulo}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">{datos}</div>
        </Container>
      </div>

      <Container>
        <div className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_348px] lg:gap-10 lg:py-10">
          <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1 lg:h-fit">
            {categoria ? (
              <PortadaCategoria
                slug={categoria.slug}
                icon={categoria.icon}
                className="aspect-video rounded-[16px] max-lg:hidden"
              />
            ) : null}
            {lateral}
          </aside>
          <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">{children}</div>
        </div>
      </Container>
    </>
  );
}

/** Chip de dato sobre la banda azul. */
export function DatoFicha({ children }: { children: ReactNode }) {
  return (
    // `block` + `truncate` (no flex): en un flex el texto no se recorta con «…».
    <span className="block max-w-full truncate rounded-full bg-white/15 px-3 py-1.5 text-[12.5px] font-medium [&_svg]:mr-1.5 [&_svg]:inline [&_svg]:align-[-2px]">
      {children}
    </span>
  );
}

/** Sección de la columna principal, como las de la ficha de mentoría. */
export function SeccionFicha({ titulo, children }: { titulo: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[16px] border border-[#ebebeb] bg-card p-6 shadow-[0_8px_22px_rgb(0_0_0/0.04)]">
      <h2 className="text-lg font-bold text-[#242424]">{titulo}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Caja de la columna lateral. */
export const cajaLateral =
  "rounded-[16px] border border-[#dbdbdb] bg-card p-[22px] shadow-[0_8px_22px_rgb(0_0_0/0.06)]";
