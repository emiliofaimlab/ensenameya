"use client";

import { useEffect } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { COMPANY } from "@/lib/company";

/**
 * Error boundary de toda la aplicación.
 *
 * ⚠️ **Por qué existe:** hasta el 17-ago el proyecto no tenía NINGUNO —ni
 * `error.tsx`, ni `global-error.tsx`, ni `not-found.tsx`—, y eso convertía
 * cualquier error de cliente en **una pantalla en blanco**. Sin traza, sin
 * mensaje y sin salida: el usuario se queda mirando el fondo y nosotros nos
 * enteramos solo si alguien nos manda una captura.
 *
 * Es justo lo que pasó al encender el acceso con Google: la sesión se creaba
 * bien y `/onboarding` se quedaba en blanco. El error existía desde antes; lo
 * que faltaba era algo que lo enseñara. Con esto, el mismo fallo se ve como un
 * mensaje con un botón de reintentar y el `digest` que permite encontrarlo en
 * los logs de Vercel.
 *
 * No sustituye a arreglar la causa (M-03 / RV-18): es la red que hace que la
 * próxima causa se pueda diagnosticar en un minuto en vez de en una tarde.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // En producción el mensaje llega minificado (React #418, #423…) y el `digest`
    // es lo único que casa esta pantalla con la traza completa del servidor.
    console.error("[error boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center gap-5 py-16 text-center">
      <div className="max-w-[520px]">
        <h1 className="text-[26px] font-semibold sm:text-[32px]">
          Algo se rompió por nuestra parte
        </h1>
        <p className="mt-3 text-[15px] text-muted-foreground">
          No es culpa tuya y no hemos perdido nada de lo que tengas guardado.
          Puedes reintentar; si vuelve a pasar, escríbenos y lo miramos.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={reset}>Reintentar</Button>
          <Button variant="outline" asChild>
            <Link href="/">Ir al inicio</Link>
          </Button>
        </div>

        <p className="mt-6 text-[13px] text-muted-foreground">
          <a
            href={`mailto:${COMPANY.email}`}
            className="font-medium text-foreground transition-colors hover:text-brand"
          >
            {COMPANY.email}
          </a>
          {error.digest ? (
            <>
              {" · "}
              <span className="font-mono text-[12px]">
                ref. {error.digest}
              </span>
            </>
          ) : null}
        </p>
      </div>
    </Container>
  );
}
