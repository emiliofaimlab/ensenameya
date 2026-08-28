import Link from "next/link";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { historialDelAlumno } from "../app/historial";
import { HistorialCard } from "../app/historial-card";
import { suggestedForStudent } from "../app/sugerencias";
import { SugerenciasCard } from "../app/sugerencias-card";
import { tutoresParaElAlumno } from "../app/tutores";
import { TutoresCard } from "../app/tutores-card";

export const metadata = { title: "Agendar · Enséñame Ya" };

/**
 * «Agendar» del menú del alumno, para quien YA tiene sesión.
 *
 * ⚠️ **POR QUÉ EXISTE ESTA RUTA.** Hasta hoy la entrada «Agendar» del menú
 * lateral apuntaba a `/tutors`, que es el buscador **público**: el alumno salía
 * de su panel —otra cabecera, otro ancho, sin menú— y aterrizaba en la misma
 * pantalla que ve cualquiera sin cuenta. El cliente lo señaló con esas
 * palabras: «como estudiante cuando le das a agendar te manda a la página de
 * explorar pública y esto está mal y confunde».
 *
 * Lo que se pidió a cambio son las tres tarjetas del panel: los tutores que ya
 * conoce, lo que se le recomienda y su historial. Son los tres caminos que
 * llevan a reservar otra vez, ordenados de más corto a más largo — volver con
 * alguien conocido, aceptar una sugerencia, repetir algo que ya hizo.
 *
 * ⚠️ **Ni una consulta nueva.** Las tres tarjetas son las MISMAS que monta
 * `/app`, con sus mismos módulos: importarlas desde `../app/` es exactamente lo
 * que ya hacía `/reservas` con `categoriesWithOffer`. Duplicarlas aquí sería
 * garantizar que dentro de un mes las dos pantallas dijeran cosas distintas.
 *
 * `/tutors` no desaparece: sigue siendo la puerta pública y sigue siendo el
 * destino del «Ver todos» de la tarjeta de tutores, que es donde un buscador
 * completo sí tiene sentido.
 */
export default async function AgendarPage() {
  const { user } = await requireUser();
  const tz = await getUserTimezone();

  // Las tres van juntas: son independientes entre sí y encadenarlas sumaría
  // tres viajes a la latencia de la pantalla para nada. Mismo criterio que el
  // `Promise.all` de `/app`.
  const [misTutores, sugerencias, historial] = await Promise.all([
    tutoresParaElAlumno(),
    suggestedForStudent(user.id),
    historialDelAlumno(user.id),
  ]);

  // Cada tarjeta devuelve `null` cuando no tiene nada honesto que enseñar. Que
  // las tres lo hagan a la vez solo pasa con el catálogo vacío (no hay tutores
  // aprobados ni mentorías publicadas): entonces la pantalla lo dice, en vez de
  // quedarse en un título suelto.
  const vacia = !misTutores && !sugerencias && !historial;

  return (
    <PanelShell>
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Agendar
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Tus tutores, lo que te recomendamos y lo que ya reservaste.
        </p>
      </div>

      {/* El mismo orden que en `/app`, y por el mismo motivo: volver con un
          tutor conocido es el camino más corto a una reserva, descubrir uno
          nuevo el siguiente, y repetir del historial el que exige recordar. */}
      {misTutores ? <TutoresCard data={misTutores} /> : null}
      {sugerencias ? <SugerenciasCard data={sugerencias} /> : null}
      {historial ? <HistorialCard data={historial} timeZone={tz} /> : null}

      {vacia ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">
            Todavía no hay nada que agendar
          </PanelCardTitle>
          <p className="mt-2 text-[13px] text-[#6b6b6b]">
            Aún no hay mentorías publicadas. Vuelve en unos días o echa un
            vistazo al directorio de tutores.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild className="h-10">
              <Link href="/tutors">Explorar tutores</Link>
            </Button>
            <Button asChild variant="outline" className="h-10">
              <Link href="/classes">Ver mentorías</Link>
            </Button>
          </div>
        </PanelCard>
      ) : null}
    </PanelShell>
  );
}
