"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";

/** Lo que devuelve `/api/pagos/checkout` para montar el formulario. */
export type Embed = { clientSecret: string; publishableKey: string };

/**
 * El formulario de Stripe, embebido. Lo usan los dos sitios donde se cobra: el
 * checkout de una reserva nueva y el "Pagar ahora" de una que quedó pendiente.
 *
 * La promesa de `loadStripe` se crea UNA vez (inicializador perezoso del
 * estado): rehacerla en cada render remonta el iframe y se pierde lo escrito.
 */
export function StripeEmbed({ clientSecret, publishableKey }: Embed) {
  const [stripe] = useState(() => loadStripe(publishableKey));

  return (
    // `key` con el secreto: si se abriera una Session nueva, React desmonta el
    // iframe anterior en vez de reusarlo con un secreto que ya no le toca.
    <EmbeddedCheckoutProvider
      key={clientSecret}
      stripe={stripe}
      options={{ clientSecret }}
    >
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
