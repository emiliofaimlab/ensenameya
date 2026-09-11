import Link from "next/link";

/**
 * El aviso que sustituye a la casilla en el camino de Google: «al continuar
 * aceptas…».
 *
 * ⚠️ Vive aparte porque lo enseñan DOS pantallas. En `/signup` siempre fue el
 * sustituto de la casilla (28-ago-2026). En `/login` lo enseña desde el
 * 11-sep-2026, y la razón es que su botón de Google **también da de alta**:
 * hasta esa fecha las cuentas que nacían por ahí se quedaban con cero filas en
 * `terms_acceptances`, para siempre y sin nada que lo reparase después. Medido
 * en dev: 7 de las 8 cuentas de Google no tenían ninguna.
 *
 * Compartirlo no es aseo: una frase legal copiada en dos sitios es una frase
 * legal que acaba diciendo cosas distintas en cada uno. El texto es del
 * cliente; aquí solo se mueve de sitio.
 */
export function GoogleTermsNote({ enModal = false }: { enModal?: boolean }) {
  // Dentro del modal los legales se abren aparte: seguir el enlace en la misma
  // pestaña cierra el diálogo y tira lo que llevaras escrito. Fuera navegan
  // como siempre — es una pantalla entera, no hay nada que perder.
  const aparte = enModal
    ? ({ target: "_blank", rel: "noopener noreferrer" } as const)
    : {};

  return (
    <p className="-mt-2 text-[12.5px] leading-snug text-muted-foreground">
      Al continuar con Google aceptas los{" "}
      <Link href="/terms" className="text-brand hover:underline" {...aparte}>
        Términos y Condiciones
      </Link>{" "}
      (
      <Link href="/terms/es" className="hover:underline" {...aparte}>
        versión en español
      </Link>
      ) y la{" "}
      <Link href="/privacy" className="text-brand hover:underline" {...aparte}>
        Política de privacidad
      </Link>
      .
    </p>
  );
}
