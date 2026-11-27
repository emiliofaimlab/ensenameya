import { unstable_rethrow } from "next/navigation";
import Link from "next/link";
import { MegaphoneIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import {
  ClasificadoCard,
  listarClasificados,
  type ClasificadoPublico,
} from "@/components/clasificados/clasificado-card";

/**
 * Para el `Promise.all` de la home: un fallo de la RPC NO rompe la portada. Se
 * queda en los logs y la sección no se pinta — aquí sí es mejor callar que
 * tumbar la página entera por un bloque secundario.
 */
export async function listClasificadosHome(): Promise<ClasificadoPublico[]> {
  try {
    return await listarClasificados(3);
  } catch (e) {
    // Los errores de control de Next (render dinámico, redirect…) no son fallos:
    // se devuelven a Next antes de tragarse el resto.
    unstable_rethrow(e);
    console.error("[home] clasificados_publicos", e);
    return [];
  }
}

/**
 * Clasificados · bloque del home. Sin ninguno activo no se pinta, como
 * `HomeAcademies`: una sección vacía es peor que ninguna sección.
 *
 * 27-nov · «pasa desapercibido»: deja de ser una fila más de tarjetas y pasa a
 * un panel melocotón (el mismo `#ffe5cc` de `trust.tsx`) con la llamada a la
 * acción de los DOS lados —publicar (alumno) y postularse (tutor)— a la
 * izquierda y tres clasificados a la derecha.
 */
export function ClasificadosHome({ items }: { items: ClasificadoPublico[] }) {
  if (items.length === 0) return null;

  return (
    <Container>
      <Section>
        <div className="grid gap-8 rounded-[22px] bg-[#ffe5cc] p-6 sm:p-9 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-[12.5px] font-semibold text-[#db5400]">
              <MegaphoneIcon className="size-3.5" aria-hidden />
              Clasificados
            </span>
            <h2 className="mt-4 text-2xl font-bold text-balance text-[#19191f] sm:text-3xl">
              Lo que están buscando los alumnos
            </h2>
            <p className="mt-3 text-[15px] text-pretty text-[#474747]">
              ¿No encuentras la mentoría que necesitas? Publica lo que quieres lograr y los
              tutores te mandan su propuesta. Si enseñas, postúlate con tu mentoría.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <Button asChild className="h-11 px-5">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- regla 13 */}
                <a href="/clasificados/nuevo">Publicar lo que necesito</a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-11 border-brand px-5 text-brand hover:bg-brand-muted hover:text-brand"
              >
                <Link href="/clasificados">Ver clasificados</Link>
              </Button>
            </div>
          </div>

          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {items.slice(0, 3).map((c, i) => (
              <li key={c.id} className={i === 2 ? "sm:hidden xl:block" : undefined}>
                <ClasificadoCard c={c} />
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </Container>
  );
}
