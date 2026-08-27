import { TermsPage } from "@/components/legal/terms-page";
import { TERMS } from "@/components/legal/terms-content";

/**
 * `/terms` sirve la versión **inglesa**, que es la gobernante (§38) y la que el
 * cliente pidió que los usuarios acepten. El español vive en `/terms/es` y se
 * llega con un clic desde el aviso de arriba.
 *
 * Es una decisión deliberada y discutible para un público de LatAm: si se
 * prefiere que la ruta por defecto sea la española, basta con intercambiar los
 * dos `locale` de estas dos páginas y `TERMS_GOVERNING_LOCALE` seguirá
 * gobernando igual. Lo que NO puede cambiar sin hablarlo con el cliente es a
 * cuál apunta la casilla del registro.
 */
export const metadata = {
  title: `${TERMS.en.title} · Enséñame Ya`,
  description: TERMS.en.intro[0] as string,
  alternates: {
    languages: {
      en: "/terms",
      es: "/terms/es",
    },
  },
};

export default function TermsRoute() {
  return <TermsPage locale="en" />;
}
