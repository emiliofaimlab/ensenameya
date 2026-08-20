"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  // ⚠️ RENOMBRADO A PROPÓSITO. Stripe llama `CheckoutForm` a su elemento y en
  // este mismo directorio vivimos nosotros con `checkout-form.tsx`, que exporta
  // OTRO `CheckoutForm` — la pantalla entera del checkout. Dejar los dos con el
  // mismo nombre convierte cualquier búsqueda en una trampa.
  CheckoutForm as FormularioDeStripe,
  CheckoutFormProvider,
  useCheckoutForm,
} from "@stripe/react-stripe-js/checkout";

/** Lo que devuelve `/api/pagos/checkout` para montar el formulario. */
export type Embed = { clientSecret: string; publishableKey: string };

/**
 * MN-01 · SOLO LOS CAMPOS DE LA TARJETA, Y POR QUÉ HUBO QUE CAMBIAR DE MODO.
 *
 * Hasta hoy esto era el **Embedded Checkout** (`ui_mode: 'embedded_page'` +
 * `<EmbeddedCheckoutProvider>/<EmbeddedCheckout>`). Dentro de aquel iframe
 * Stripe pintaba su propia pantalla entera: su resumen del pedido, su importe,
 * su marca. Como nosotros ya pintamos nuestro «Resumen del pedido» al lado,
 * el alumno veía el mismo total dos veces con dos tipografías distintas. Eso es
 * lo que el cliente señaló con una captura: «solo queremos los inputs de la
 * tarjeta, normal, y no todo ese contenido de Stripe».
 *
 * Ese interior NO se podía reestilizar: en `embedded_page` los tipos del SDK no
 * exponen ni `appearance` ni `layout`. La salida soportada es
 * **`ui_mode: 'form'`**, donde Stripe pinta ÚNICAMENTE el formulario de pago
 * (métodos guardados, campos de tarjeta, el titular de MN-02 y el botón de
 * pagar) y sí acepta `appearance`.
 *
 * ⚠️ ES LA MISMA CHECKOUT SESSION. Cambia el modo de presentación, no el objeto:
 * el `client_secret` sigue siendo el de siempre, el importe sigue saliendo de
 * `payments.gross_amount` (regla de oro 2) y el cobro lo sigue confirmando el
 * **webhook**, no esta pantalla. Webhook, idempotencia, X-02, los reembolsos y
 * las tarjetas guardadas no cambian de contrato. Lo que se toca de verdad está
 * en `lib/payments/stripe-provider.ts` (el cobro) y en `lib/stripe.ts` (el alta
 * de tarjeta), que es donde se decide el `ui_mode`.
 *
 * ⚠️ SIGUE SIENDO PCI-DSS SAQ A. El formulario es un Element de Stripe y los
 * Elements viven en un iframe suyo: el PAN no toca nuestro DOM. Que el recuadro
 * parezca ahora parte de la página no significa que los campos sean nuestros —
 * dibujarlos nosotros metería el proyecto en SAQ D, que es la razón declarada
 * por la que aquí nunca ha habido un `<input>` de tarjeta.
 *
 * Lo usan los TRES sitios donde se abre un formulario de pago: el checkout de
 * una reserva nueva, el «Pagar ahora» de una reserva a medias y el «Añadir
 * tarjeta» de Métodos de pago (`mode: 'setup'`). Van juntos a propósito: dejar
 * uno atrás deja dos formularios de pago distintos en el mismo producto.
 */

/**
 * Los colores de marca, leídos de los tokens de `globals.css` en vez de
 * copiados a mano.
 *
 * El formulario vive en un iframe de Stripe, así que NO hereda nuestro CSS: hay
 * que pasarle valores concretos por `appearance`. Leerlos del `:root` en tiempo
 * de montaje es lo que evita que este archivo se quede con un naranja viejo el
 * día que el token cambie — que es justo lo que pasa con los hex sueltos.
 *
 * El respaldo existe porque `getComputedStyle` no existe en el servidor y
 * porque un token renombrado devuelve cadena vacía: en ese caso vale más un
 * naranja correcto de hace un mes que un formulario con el azul de Stripe.
 */
function token(nombre: string, respaldo: string): string {
  if (typeof window === "undefined") return respaldo;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(nombre)
    .trim();
  return v || respaldo;
}

// ⚠️ A PROPÓSITO NO SE FUERZA LA TIPOGRAFÍA. Poppins entra por `next/font`, que
// la auto-aloja con un nombre de familia generado: el iframe de Stripe no puede
// resolverlo. Meterla de verdad exige `fonts: [{ cssSrc: … }]` apuntando a
// Google Fonts, o sea una petición a un tercero MÁS en mitad de la pantalla de
// pago. Es una decisión de producto (privacidad y una dependencia de red en el
// peor sitio para tenerla), no un olvido: si se quiere, se añade ahí.
function apariencia() {
  return {
    variables: {
      // `--primary` es el naranja del CTA (#fe6a00): el botón de pagar de
      // Stripe es un CTA, no un enlace. El azul `--brand` es marca y enlace en
      // este diseño, y ponerlo aquí haría que el botón de pagar no se pareciera
      // a ningún otro botón de pagar del sitio.
      colorPrimary: token("--primary", "#fe6a00"),
      colorText: token("--foreground", "#14141a"),
      colorTextSecondary: token("--muted-foreground", "#4d4d4d"),
      colorDanger: token("--destructive", "#e51a1a"),
      colorBackground: token("--card", "#ffffff"),
      borderRadius: token("--radius", "0.5rem"),
    },
  };
}

/**
 * El formulario en sí, ya dentro del proveedor.
 *
 * ⚠️ EL BOTÓN DE PAGAR LO PINTA STRIPE, PERO NO CONFIRMA SOLO. Su formulario
 * emite `confirm` cuando la persona autoriza el pago —con el botón o con una
 * cartera tipo Apple Pay— y somos nosotros quienes llamamos a
 * `checkout.confirm()`. Si este `onConfirm` desaparece, el formulario se ve
 * perfecto, el botón responde y NO SE COBRA NADA: es un fallo mudo, así que no
 * se quita "porque parece que no hace nada".
 *
 * No se le pasa `returnUrl` aquí: ya viaja en la Session (`return_url`), que es
 * donde tiene que estar para que el alumno vuelva a la confirmación de SU
 * reserva. Duplicarlo en el navegador sería un segundo sitio donde equivocarse.
 */
function Formulario() {
  const resultado = useCheckoutForm();
  const [error, setError] = useState<string | null>(null);

  // El SDK no pudo arrancar (secreto caducado, Session ya cerrada, red). Sin
  // esto la persona se queda mirando un hueco sin saber que tiene que recargar.
  if (resultado.type === "error") {
    return (
      <p role="alert" className="text-[13px] text-destructive">
        No se pudo abrir el formulario de pago: {resultado.error.message}
      </p>
    );
  }

  return (
    <>
      <FormularioDeStripe
        onConfirm={async (evento) => {
          setError(null);
          // `loading` no se da en la práctica —el botón vive dentro del propio
          // formulario, que no existe hasta que el SDK carga— pero el tipo lo
          // admite y tragárselo en silencio sería el mismo fallo mudo de arriba.
          if (resultado.type !== "success") return;
          // `formConfirmEvent` es lo que le dice a Stripe QUÉ autorizó la
          // persona (el botón, o una cartera). Sin él, confirmar desde una
          // cartera no sabría con qué medio de pago cobrar.
          const r = await resultado.checkout.confirm({ formConfirmEvent: evento });
          // En el camino feliz esto no llega a pintarse: Stripe redirige al
          // `return_url`. Un rechazo de tarjeta, en cambio, deja la Session
          // ABIERTA a propósito para que se reintente con otra — por eso el
          // error se enseña aquí y no se cancela nada.
          if (r.type === "error") setError(r.error.message);
        }}
      />
      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function StripeEmbed({ clientSecret, publishableKey }: Embed) {
  // La promesa de `loadStripe` se crea UNA vez (inicializador perezoso del
  // estado): rehacerla en cada render remonta el formulario y se pierde lo
  // escrito.
  const [stripe] = useState(() => loadStripe(publishableKey));
  // Los tokens se leen UNA vez, no en cada render: `getComputedStyle` fuerza un
  // cálculo de estilo y el proveedor solo mira `appearance` al arrancar el SDK.
  const [appearance] = useState(apariencia);

  return (
    // `key` con el secreto: si se abriera una Session nueva, React desmonta el
    // formulario anterior en vez de reusarlo con un secreto que ya no le toca.
    //
    // OJO con `savedPaymentMethod`: NO se pasa a propósito. La casilla de
    // «guardar tarjeta» de PAC-02 es NUESTRA, se pide en nuestro idioma antes de
    // montar esto y se traduce en `setup_future_usage` en el servidor; la de
    // Stripe la gobierna `saved_payment_method_options.payment_method_save`, que
    // no ponemos, así que no debería aparecer. Si en el navegador saliera una
    // segunda casilla, la palanca es `savedPaymentMethod: { enableSave: 'never' }`
    // — y `enableRedisplay` se queda como está, que es lo que hace que se vean
    // las tarjetas ya guardadas.
    <CheckoutFormProvider
      key={clientSecret}
      stripe={stripe}
      options={{ clientSecret, appearance }}
    >
      {/*
        El tope de ancho vive AQUÍ, en el componente compartido, y no en cada
        pantalla: es lo único que hace que el formulario se vea igual se entre
        por donde se entre. Los tres puntos de montaje dan contenedores muy
        distintos —el checkout ~690px, `/reservas/[id]/pagar` 560, y `/pagos`
        dentro de `PanelShell` casi 900— y con `ui_mode:'form'` lo que se pinta
        son solo los campos de la tarjeta, que se estiran hasta donde les dejen.

        ⚠️ Medido el 20-ago: sin este tope, en `/pagos` el formulario salía a
        **903px**. Una fila de campos de tarjeta a 903px es literalmente «el
        diseño alargado» que MN-01 vino a quitar, reapareciendo en otra
        pantalla. Si alguien quita este `div`, vuelve.
      */}
      <div className="mx-auto w-full max-w-[520px]">
        <Formulario />
      </div>
    </CheckoutFormProvider>
  );
}
