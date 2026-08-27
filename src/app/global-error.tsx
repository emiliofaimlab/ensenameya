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
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9fafc",
          color: "#101828",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
            Enséñame Ya no ha podido cargar
          </h1>
          <p style={{ marginTop: 12, fontSize: 15, color: "#475467" }}>
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
              padding: "10px 20px",
              fontSize: 15,
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
