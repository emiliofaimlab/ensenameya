import { TermsPage } from "@/components/legal/terms-page";
import { TERMS } from "@/components/legal/terms-content";

/**
 * Traducción al español. Disponible por comodidad; la que rige es la inglesa de
 * `/terms` (§38 del propio contrato), y el aviso de la cabecera lo dice.
 */
export const metadata = {
  title: `${TERMS.es.title} · Enséñame Ya`,
  description: TERMS.es.intro[0] as string,
  alternates: {
    languages: {
      en: "/terms",
      es: "/terms/es",
    },
  },
};

export default function TermsEsRoute() {
  return <TermsPage locale="es" />;
}
