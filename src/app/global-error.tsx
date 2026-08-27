"use client";

import { useEffect } from "react";

/**
 * Último recurso: se monta cuando el fallo ocurre en el **layout raíz**, antes
 * de que exista el `<body>` de la app. Por eso —y solo por eso— este archivo
 * repite `<html>` y `<body>`: reemplaza al layout entero, así que no hereda ni
 * las fuentes ni los estilos, y los pocos que necesita van en línea.
 *
 * `error.tsx` cubre el 99 % de los casos y es el que se ve normalmente. Este
 * evita el único hueco que aquel no puede tapar, que es justo el que deja la
 * pantalla completamente en blanco.
 *
 * ⚠️ **Sin `import` nuevos, a propósito.** Es el último recurso: cuanto menos
 * módulo tenga que resolverse para pintarlo, más casos cubre. Por eso el correo
 * está escrito a mano y no sale de `lib/company.ts` como en el resto del sitio.
 *
 * US-1601 · lo que se tocó es solo el tamaño en móvil, con `clamp()` en vez de
 * media queries: aquí no hay hoja de estilos donde ponerlas, y un `clamp` deja
 * los valores de escritorio EXACTAMENTE donde estaban (24 y 15px) mientras baja
 * el titular a los 22px del Figma a 390. El Figma «G01b» dibuja esta pantalla
 * con cabecera, pie y un «500» gigante; nada de eso se monta: si el layout raíz
 * se ha caído, montar componentes es exactamente lo que no se puede hacer.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          // Sin esto los 24px de padding se SUMABAN al 100vh y la pantalla de
          // último recurso salía con scroll vertical en cualquier móvil.
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9fafc",
          color: "#101828",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          // 20px es el aire lateral de página del Figma a 390. Por encima de
          // ~500px el bloque ya está topado a 460 y centrado, así que este
          // número solo se nota en móvil.
          padding: "20px",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          {/* 22px a 390 (Figma) y los 24 de siempre a partir de ~437px. */}
          <h1
            style={{
              fontSize: "clamp(22px, 5.5vw, 24px)",
              fontWeight: 600,
              margin: 0,
            }}
          >
            Enséñame Ya no ha podido cargar
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: "clamp(14px, 3.6vw, 15px)",
              color: "#475467",
            }}
          >
            Ha fallado algo básico de la página. Vuelve a intentarlo; si sigue
            igual, escríbenos a{" "}
            <a href="mailto:Info@ensenameya.com" style={{ color: "#101828" }}>
              Info@ensenameya.com
            </a>
            .
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              // 12/24 + lh21 son el botón del Figma y dejan 45px de alto
              // clavados. Con los 10/20 de antes —y sin `lineHeight`, que un
              // <button> no hereda— salían **37px** medidos: muy por debajo del
              // mínimo táctil de 44 (WCAG 2.5.5), y justo en la pantalla donde
              // el usuario tiene UN solo botón que pulsar.
              padding: "12px 24px",
              fontSize: 15,
              lineHeight: "21px",
              fontWeight: 500,
              color: "#fff",
              background: "#fe6a00",
              border: 0,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
          {error.digest ? (
            <p
              style={{
                marginTop: 20,
                fontSize: 12,
                color: "#667085",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              ref. {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
