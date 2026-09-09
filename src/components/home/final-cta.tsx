import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { SignupDialog } from "@/components/auth/signup-dialog";
import { getVisitorState } from "@/components/auth/visitor-state";
import { cn } from "@/lib/utils";

/**
 * El bloque es el mismo en P01, P02 y P03; solo cambian los textos.
 *
 * Es `async` desde N-01: los dos botones dependen de quién esté mirando y eso
 * hay que preguntárselo al servidor. Las tres páginas que lo usan ya son
 * Server Components, así que renderizarlo sigue siendo `<FinalCta />`.
 *
 * ── MÓVIL (correo de Verónica, 3-sep-2026) ──────────────────────────────────
 * «Los dos botones centrados y alargados». Por debajo de `sm:` van APILADOS y a
 * ancho completo; desde `sm:` se restituye el escritorio tal cual (R1).
 * Medidas del Figma móvil `P03 · cta-final` (PNG a escala 2, ÷2): botón de
 * 45–46 px de alto y radio 8, 12 px entre los dos, etiqueta 15 px semibold;
 * título 24 px con paso de línea 30,5; cuerpo 15/20; 48 px de padding
 * vertical y ~16 px entre título, texto y botones. El Figma pinta la etiqueta
 * de los botones pegada a la izquierda: es un artefacto del auto-layout y
 * Verónica pidió «centrados», así que va centrada.
 *
 * ponytail: el Figma da a este bloque 24 px de margen lateral (botón de 342)
 * en vez de los 20 del resto del sistema (Doc 24 §24.3). Se queda el
 * `Container` (350): un padding propio para un solo bloque no se paga.
 *
 * `tone`: el MISMO bloque existe en claro en `P03 · cta-mid` (fondo blanco,
 * título oscuro, secundario azul). Es una variante de color, no otro
 * componente.
 */
export async function FinalCta({
  title = "Da el siguiente paso: empieza a aprender o a enseñar",
  text = "Crea tu cuenta sin costo en segundos y asegura tu primera sesión, o conviértete en tutor y empieza a facturar con orgullo por lo que sabes.",
  primaryLabel = "Crear cuenta gratis",
  secondaryLabel = "Quiero enseñar",
  tone = "brand",
  className,
}: {
  title?: string;
  text?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  /** `brand` = fondo azul (P01/P02/P03 final); `light` = fondo blanco (P03 cta-mid). */
  tone?: "brand" | "light";
  /** Para que la página lo esconda donde no toca (p. ej. `lg:hidden`). */
  className?: string;
}) {
  const visitante = await getVisitorState();
  const claro = tone === "light";

  // Base (<sm): 46 px, ancho completo, semibold. `sm:` devuelve el botón de
  // hoy: 48 px, ancho de contenido, medium. El radio ya es 8 (`--radius`).
  const comun =
    "h-[46px] w-full px-6 text-[15px] font-semibold sm:h-12 sm:w-auto sm:font-medium";
  const primaria = comun;
  const secundaria = cn(
    comun,
    claro
      ? // `text-brand-foreground` (#036fda) y no `text-brand` (#0080ff): la
        // etiqueta va a 15 px semibold sobre blanco, que no es «texto grande»,
        // así que AA le pide 4,5:1 y el azul de marca se queda en 3,8. El
        // borde sí puede seguir en `brand` (3:1 basta para un componente).
        "border-brand bg-transparent text-brand-foreground hover:bg-brand-muted hover:text-brand-foreground"
      : "border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white",
  );

  return (
    <div
      className={cn(
        claro ? "bg-background text-foreground" : "bg-brand text-white",
        className,
      )}
    >
      <Container className="flex flex-col items-center gap-4 py-12 text-center sm:gap-6 sm:py-14">
        {/* `text-2xl/[30px]`: 24 px con el paso de línea medido (30,5). El
            `/` fija `line-height` sin tocar `--tw-leading`, así que
            `sm:text-3xl` vuelve a sus 36 px de siempre. */}
        <h2 className="text-2xl/[30px] font-semibold text-balance sm:text-3xl">
          {title}
        </h2>
        <p
          className={cn(
            "max-w-2xl text-pretty text-[15px]/5 sm:text-lg",
            claro ? "text-muted-foreground" : "text-white/90",
          )}
        >
          {text}
        </p>
        {/* Apilados y a ancho completo en móvil; en fila y centrados desde
            `sm:` (lo de hoy). Las dos ramas —anónimo y con sesión— comparten
            este contenedor y las mismas clases de botón, así que apilan igual. */}
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-center">
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
