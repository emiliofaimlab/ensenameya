import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { SignupDialog } from "@/components/auth/signup-dialog";
import { getVisitorState } from "@/components/auth/visitor-state";

/**
 * El bloque es el mismo en P01, P02 y P03; solo cambian los textos.
 *
 * Es `async` desde N-01: los dos botones dependen de quién esté mirando y eso
 * hay que preguntárselo al servidor. Las tres páginas que lo usan ya son
 * Server Components, así que renderizarlo sigue siendo `<FinalCta />`.
 */
export async function FinalCta({
  title = "Da el siguiente paso: empieza a aprender o a enseñar",
  text = "Crea tu cuenta sin costo en segundos y asegura tu primera sesión, o conviértete en tutor y empieza a facturar con orgullo por lo que sabes.",
  primaryLabel = "Crear cuenta gratis",
  secondaryLabel = "Quiero enseñar",
}: {
  title?: string;
  text?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
}) {
  const visitante = await getVisitorState();

  const primaria = "h-12 px-6 text-[15px]";
  const secundaria =
    "h-12 border-white/70 bg-transparent px-6 text-[15px] text-white hover:bg-white/10 hover:text-white";

  return (
    <div className="bg-brand text-white">
      <Container className="flex flex-col items-center gap-6 py-14 text-center">
        <h2 className="text-2xl font-semibold text-balance sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-pretty text-white/90 sm:text-lg">{text}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {visitante.anonimo ? (
            <>
              {/* M-05 · El alta se abre ENCIMA de la página. Quien está al pie
                  de la portada estaba leyendo la portada: llevárselo a /signup
                  y devolverlo aquí es perder el hilo por el camino. */}
              <SignupDialog>
                <Button className={primaria}>{primaryLabel}</Button>
              </SignupDialog>
              <SignupDialog
                intent="tutor"
                titulo="Crea tu cuenta de tutor"
                descripcion="Publica tus mentorías y cobra por lo que ya sabes"
              >
                <Button variant="outline" className={secundaria}>
                  {secondaryLabel}
                </Button>
              </SignupDialog>
            </>
          ) : (
            <>
              {/*
                Con sesión no se ofrece "crear cuenta": ya la tiene. El botón se
                queda con el sitio y el peso visual, pero apuntando a su panel
                — el rótulo se impone aquí a propósito, porque el que llega por
                prop ("Crear cuenta gratis", "Regístrate YA") es de las tres
                páginas públicas y solo tiene sentido para un anónimo.
              */}
              <Button asChild className={primaria}>
                <Link href={visitante.homeHref ?? "/app"}>Ir a mi panel</Link>
              </Button>
              {/* N-01 · Y "Quiero enseñar" va al sitio que le toca a este
                  usuario, sin pasar por la pantalla de conversión ni por el
                  rebote del guarda de invitados. */}
              <Button asChild variant="outline" className={secundaria}>
                <Link href={visitante.teachHref ?? "/tutor"}>
                  {secondaryLabel}
                </Link>
              </Button>
            </>
          )}
        </div>
      </Container>
    </div>
  );
}
