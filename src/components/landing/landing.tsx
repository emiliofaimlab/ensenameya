import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { SignupDialog } from "@/components/auth/signup-dialog";
import { getVisitorState } from "@/components/auth/visitor-state";
import { cn } from "@/lib/utils";

/**
 * EY-236 · Piezas de las landings de campaña `/ensena` y `/aprende`. Sin Figma:
 * siguen el lenguaje de la home y de `/como-funciona` (hero claro con la foto
 * redondeada de `FeatureSplit`, banda azul de `FinalCta`). El copy es el del
 * documento de Néstor (20-oct) y lo redacta el cliente.
 */
export type Publico = "tutor" | "alumno";

/**
 * «Regístrate YA». Al anónimo le abre el alta encima de la página, como
 * `FinalCta`: así no sale de la landing y la cookie `ey-ref` que dejó el
 * `?ref=` sigue ahí. Con sesión no se ofrece crear cuenta: el tutor va a donde
 * le toca (`teachHref`, resuelto en servidor por la regla 13) y el alumno, a
 * buscar tutor.
 */
export async function RegistroYa({
  para,
  claro = false,
  className,
}: {
  para: Publico;
  /** Sobre la banda azul: botón blanco. */
  claro?: boolean;
  className?: string;
}) {
  const visitante = await getVisitorState();
  const clases = cn(
    "h-[46px] w-full px-7 text-[15px] font-semibold sm:h-12 sm:w-auto",
    claro
      ? "bg-white text-brand-foreground hover:bg-white/90"
      : "bg-brand hover:bg-brand-foreground",
    className,
  );

  if (visitante.anonimo) {
    return para === "tutor" ? (
      <SignupDialog
        intent="tutor"
        titulo="Crea tu cuenta de tutor"
        descripcion="Publica tus mentorías y cobra por lo que ya sabes"
      >
        <Button className={clases}>Regístrate YA</Button>
      </SignupDialog>
    ) : (
      <SignupDialog>
        <Button className={clases}>Regístrate YA</Button>
      </SignupDialog>
    );
  }

  return (
    <Button asChild className={clases}>
      {para === "tutor" ? (
        <Link href={visitante.teachHref ?? "/tutor"}>Quiero enseñar YA</Link>
      ) : (
        <Link href="/tutores">Explorar tutores YA</Link>
      )}
    </Button>
  );
}

export function LandingHero({
  para,
  title,
  text,
  image,
}: {
  para: Publico;
  title: string;
  text: string;
  image: { src: string; alt: string };
}) {
  return (
    <div className="bg-[#f9fafc]">
      <Container>
        <Section className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h1 className="text-3xl font-bold text-balance text-brand sm:text-[46px] sm:leading-[1.18]">
              {title}
            </h1>
            <p className="mt-6 text-pretty text-[17px] text-[#525252] sm:text-[18.6px]">
              {text}
            </p>
            <div className="mt-8">
              <RegistroYa para={para} />
            </div>
          </div>
          <div className="relative aspect-[592/420] overflow-hidden rounded-[24px] shadow-[0_2px_4px_rgb(0_0_0/0.31)]">
            <Image
              src={image.src}
              alt={image.alt}
              fill
              priority
              sizes="(min-width: 1024px) 592px, 100vw"
              className="object-cover"
            />
          </div>
        </Section>
      </Container>
    </div>
  );
}

/** Bloque de texto centrado: título, párrafos y, si toca, el botón. */
export function LandingTexto({
  title,
  paragraphs,
  para,
  nota,
  className,
}: {
  title?: string;
  paragraphs?: string[];
  /** Con `para`, cierra con «Regístrate YA». */
  para?: Publico;
  /** La línea bajo el botón («Empieza creando tu cuenta de tutor.»). */
  nota?: string;
  className?: string;
}) {
  return (
    <Container className={className}>
      <Section className="mx-auto max-w-3xl text-center">
        {title ? (
          <h2 className="text-2xl font-semibold text-balance sm:text-[32px]">
            {title}
          </h2>
        ) : null}
        {paragraphs?.map((p) => (
          <p
            key={p}
            className="mt-4 text-[15px] text-pretty text-muted-foreground sm:text-[17px]"
          >
            {p}
          </p>
        ))}
        {para ? (
          <div className={cn("flex flex-col items-center gap-3", title && "mt-8")}>
            <RegistroYa para={para} />
            {nota ? <p className="text-sm text-muted-foreground">{nota}</p> : null}
          </div>
        ) : null}
      </Section>
    </Container>
  );
}

/** El cierre en la banda azul de `FinalCta`, con un solo botón. */
export function LandingCierre({
  para,
  title,
  text,
  nota,
}: {
  para: Publico;
  title: string;
  text: string;
  nota: string;
}) {
  return (
    <div className="bg-brand text-white">
      <Container className="flex flex-col items-center gap-4 py-12 text-center sm:gap-6 sm:py-14">
        <h2 className="text-2xl/[30px] font-semibold text-balance sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-pretty text-[15px]/5 text-white/90 sm:text-lg">
          {text}
        </p>
        <div className="flex w-full flex-col items-center gap-3">
          <RegistroYa para={para} claro />
          <p className="text-sm text-white/80">{nota}</p>
        </div>
      </Container>
    </div>
  );
}
