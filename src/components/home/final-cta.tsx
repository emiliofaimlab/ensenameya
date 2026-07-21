import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";

export function FinalCta() {
  return (
    <div className="bg-brand text-white">
      <Container className="flex flex-col items-center gap-6 py-14 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Empieza hoy: aprende o enseña
        </h2>
        <p className="max-w-2xl text-pretty text-white/90 sm:text-lg">
          Crea tu cuenta gratis y reserva tu primera clase, o conviértete en
          tutor y empieza a cobrar por tus resultados.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild className="h-12 px-6 text-[15px]">
            <Link href="/signup">Crear cuenta gratis</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-12 border-white/70 bg-transparent px-6 text-[15px] text-white hover:bg-white/10 hover:text-white"
          >
            <Link href="/signup">Quiero enseñar</Link>
          </Button>
        </div>
      </Container>
    </div>
  );
}
