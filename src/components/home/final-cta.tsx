import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";

/** El bloque es el mismo en P01, P02 y P03; solo cambian los textos. */
export function FinalCta({
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
  return (
    <div className="bg-brand text-white">
      <Container className="flex flex-col items-center gap-6 py-14 text-center">
        <h2 className="text-2xl font-semibold text-balance sm:text-3xl">
          {title}
        </h2>
        <p className="max-w-2xl text-pretty text-white/90 sm:text-lg">{text}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild className="h-12 px-6 text-[15px]">
            <Link href="/signup">{primaryLabel}</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-12 border-white/70 bg-transparent px-6 text-[15px] text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/signup">{secondaryLabel}</Link>
          </Button>
        </div>
      </Container>
    </div>
  );
}
