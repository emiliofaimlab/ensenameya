import { unstable_rethrow } from "next/navigation";
import Link from "next/link";

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
    return await listarClasificados(6);
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
 */
export function ClasificadosHome({ items }: { items: ClasificadoPublico[] }) {
  if (items.length === 0) return null;

  return (
    <Container>
      <Section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="min-w-0 text-xl font-semibold sm:text-2xl">
            Lo que están buscando los alumnos
          </h2>
          <Link
            href="/clasificados"
            className="-my-3 shrink-0 py-3 text-[13px] font-medium whitespace-nowrap text-brand hover:underline sm:text-sm"
          >
            Ver todos →
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-[14.5px] text-[#525252]">
          Alumnos que publicaron qué quieren lograr. Si sabes enseñarlo, postúlate con tu mentoría.
        </p>

        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.slice(0, 6).map((c) => (
            <li key={c.id}>
              <ClasificadoCard c={c} compacta />
            </li>
          ))}
        </ul>
      </Section>
    </Container>
  );
}
