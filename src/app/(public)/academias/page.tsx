import Link from "next/link";
import { BuildingIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { AcademyCard } from "@/components/catalog/academy-card";
import { listAcademies } from "@/lib/catalog/queries";

export const metadata = {
  title: "Academias aliadas · Enséñame Ya",
  description:
    "Academias con marca y método propios que imparten sus mentorías en Enséñame Ya.",
};

/**
 * P-ACA-01 · listado de academias aliadas.
 *
 * ponytail: sin filtros, sin buscador y sin paginación. `/tutores` los tiene
 * porque ordena decenas de perfiles; aquí hay dos academias y un panel de
 * filtros sobre dos tarjetas es mueble, no herramienta. Cuando el listado no
 * quepa en una pantalla se copia el de `/tutores`, que ya resuelve todo eso.
 */
export default async function AcademiasPage() {
  const academies = await listAcademies();

  return (
    <>
      <div className="bg-brand bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-10 sm:py-14">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/90">
            <Link href="/" className="inline-block py-3 -my-3 hover:underline">
              Inicio
            </Link>
            {" / "}
            <span>Academias</span>
          </nav>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold sm:text-3xl">Academias aliadas</h1>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-semibold">
              <BuildingIcon className="size-3.5" />
              {academies.length === 1
                ? "1 academia"
                : `${academies.length} academias`}
            </span>
          </div>

          <p className="mt-4 max-w-3xl text-pretty text-[15px] text-white/90">
            Escuelas con marca y método propios que imparten sus mentorías aquí.
            Reservas igual que con cualquier tutor: eliges a la persona, la hora
            y pagas en la plataforma.
          </p>
        </Container>
      </div>

      <Container>
        <Section>
          {academies.length === 0 ? (
            <p className="rounded-[16px] border border-[#ebebeb] bg-card p-8 text-center text-[15px] text-[#525252]">
              Todavía no hay academias publicadas.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {academies.map((a) => (
                <AcademyCard key={a.id} academy={a} />
              ))}
            </div>
          )}

          {/* El motivo por el que esta pantalla existe hoy: enseñar el modelo
              B2B. El alta todavía es manual (no hay rol de academia ni panel),
              así que el CTA lleva al formulario de contacto de siempre en vez
              de a un registro que no existe. */}
          <div className="mt-10 rounded-[16px] border border-[#ebebeb] bg-muted/40 p-6 text-center sm:p-8">
            <h2 className="text-[18px] font-bold text-[#212121]">
              ¿Diriges una academia?
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-[14.5px] text-[#525252]">
              Tú pones el método y los profesores; nosotros la plataforma:
              agenda, videollamada, cobros internacionales y pagos a tus tutores.
            </p>
            <Button asChild className="mt-5">
              <Link href="/contacto">Hablemos</Link>
            </Button>
          </div>
        </Section>
      </Container>
    </>
  );
}
