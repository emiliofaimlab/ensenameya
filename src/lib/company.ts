/**
 * Identidad legal de la sociedad que opera la plataforma.
 *
 * Fuente: **«DLocal Legal Requirements» (Néstor, 17-ago-2026)**, §39 del
 * contrato — idéntico en la versión inglesa y en la española. Son los mismos
 * datos que se dieron de alta en dLocal Go.
 *
 * ⚠️ **dLocal valida el sitio a mano y comprueba que estos datos coincidan
 * exactamente con los de su panel.** No se tocan aquí sin tocarlos allí.
 *
 * ⚠️ La razón social va **sin acentos** —`Ensename Ya, LLC`— porque así está
 * registrada en Florida. La marca sí los lleva: «Enséñame Ya». Son dos cosas
 * distintas y no hay que unificarlas.
 *
 * Vive aquí, y no repetido en cada pantalla, por la regla de oro 8: los datos
 * que vienen de fuera se consumen como configuración desde un solo sitio.
 */
export const COMPANY = {
  /** Razón social registrada. Sin acentos, a propósito. */
  legalName: "Ensename Ya, LLC",
  /** Marca comercial. */
  brand: "Enséñame Ya",
  /** Employer Identification Number — el identificador fiscal en EE. UU. */
  taxIdLabel: "EIN",
  taxId: "42-2277169",
  address: {
    street: "815 Bayside Lane",
    city: "Weston",
    region: "Florida",
    postalCode: "33326",
    country: "Estados Unidos",
  },
  /**
   * Buzón oficial. El contrato (§18 y §39) dice que las disputas y las
   * notificaciones legales se abren aquí, así que tiene que estar atendido.
   */
  email: "Info@ensenameya.com",
  /** Jurisdicción y ley aplicable — §33 del contrato. */
  jurisdiction: "Estado de Florida, Estados Unidos",
} as const;

/** La dirección en una línea, que es como se pinta en el pie. */
export const COMPANY_ADDRESS_LINE = [
  COMPANY.address.street,
  COMPANY.address.city,
  `${COMPANY.address.region} ${COMPANY.address.postalCode}`,
  COMPANY.address.country,
].join(", ");

/**
 * Perfiles de redes sociales de la EMPRESA (no los del tutor, que son otra cosa
 * y viven en `lib/socials.ts`).
 *
 * ⚠️ **Vacío a propósito, 17-ago-2026.** Hasta hoy el pie enlazaba a
 * `instagram.com/ensenameya`, `linkedin.com/company/ensenameya` y
 * `x.com/ensenameya`, tres URLs que se dedujeron del nombre de la marca al
 * integrar el Figma (`95aacc6`) sin comprobar que existieran. Al menos LinkedIn
 * y X dan 404, y llevan así también en producción.
 *
 * dLocal Go es explícito en sus requisitos de validación: los iconos tienen que
 * llevar a perfiles reales, y **si no hay perfiles es mejor no poner iconos**
 * que poner enlaces muertos. Un revisor que pulse y reciba un 404 es un motivo
 * de rechazo evitable.
 *
 * **Para restaurarlas:** pedir al cliente las URL reales y añadirlas aquí. El
 * pie las pinta solo si el array tiene algo, así que no hay nada más que tocar.
 */
export const COMPANY_SOCIALS: ReadonlyArray<{ href: string; label: string }> =
  [];
