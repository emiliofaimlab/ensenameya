"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShoppingCartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CART_MAX_LINEAS,
  addCartLine,
  cartHasKeySnapshot,
  cartLineKey,
} from "@/lib/cart/cookie";

/**
 * EY-177 · B3.6 · EL BOTÓN PRINCIPAL. **UNO, Y SIEMPRE EL MISMO.**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ ESTO SUSTITUYE AL MODELO «UNO Y LUEGO DOS». NO LO REPONGAS.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Hasta hoy, pulsar «Agregar al carrito» OCULTABA el botón y lo cambiaba por
 * «Seguir comprando» + «Ir al carrito». Se hizo así porque el cliente lo pidió
 * con esas palabras, y el fallo se vio en cuanto estuvo en pantalla: al añadir
 * desaparecía **la acción principal**, así que para apuntar una segunda mentoría
 * había que deducir que «Seguir comprando» era lo que devolvía el botón. Un
 * control que se esconde justo después de que aprendas a usarlo.
 *
 * El modelo nuevo, acordado con el responsable, separa las dos preguntas que el
 * anterior mezclaba:
 *
 *   · **«Agregar al carrito» SIEMPRE está**, y depende de la SELECCIÓN:
 *     bloqueado mientras no haya mentoría y hora, activo en cuanto las hay.
 *   · **«Ir al carrito»** (`go-to-cart.tsx`, un componente aparte) depende del
 *     CARRITO: sale si dentro hay algo, sin importar lo que acabes de hacer.
 *
 * Tras añadir, este botón **no cambia de forma**: se limpia la selección —o sea
 * se navega a `limpiarHref`, ver abajo— y el propio botón vuelve solo a
 * bloqueado, con la pantalla lista para la siguiente mentoría. Eso es lo que
 * pedía el cliente («repetir lo mismo con su segunda clase sin salirme de esa
 * visual») sin el efecto secundario de esconderle el botón.
 *
 * ⚠️ Y LA CONFIRMACIÓN ES UN AVISO QUE SE DESVANECE, no un cambio de estado.
 * Antes, «Añadida al carrito» era un texto permanente bajo los dos botones: se
 * quedaba ahí, y a los diez segundos ya no se sabía si hablaba de lo que
 * acababas de hacer o de algo de hace un rato. Un `toast` dice «acaba de pasar»
 * por el hecho de aparecer, y se va solo. El acuse persistente lo da el número
 * del «Ir al carrito», que es un hecho, no un recuerdo.
 *
 * ⚠️ LOS PAQUETES NO PASAN POR AQUÍ. Una línea del carrito es una mentoría con
 * TODOS sus horarios, y un `per_package` de N sesiones necesita N horarios que
 * no caben en el panel lateral de la ficha (RN-12). Ese caso sigue yendo al
 * selector múltiple de `/reservar/<id>`, que es donde se completa la línea y
 * donde está su propio «Agregar al carrito». `booking-panel.tsx` decide cuál de
 * los dos pinta; aquí solo llegan líneas completas.
 */
export function AddToCart({
  productId,
  slots,
  limpiarHref,
  motivo,
  ctaLabel = "Agregar al carrito",
  className,
  buttonClassName = "h-[51px] w-full text-[15px]",
}: {
  /**
   * La mentoría elegida, o `null` mientras no hay ninguna. **Puede ser nulo a
   * propósito**: el botón se pinta igual, bloqueado, porque la promesa de la
   * pantalla no puede aparecer y desaparecer con la selección.
   */
  productId: string | null;
  /**
   * Los horarios de la línea, en **instantes** (ms), o vacío si aún no hay hora.
   * Ya validados en servidor contra los huecos reales: `booking-panel` solo pasa
   * el ISO canónico que casó por `Date.parse`, nunca el texto crudo de la URL.
   * Ver `lib/cart/cookie.ts` para por qué se guardan como número y no como ISO.
   */
  slots: number[];
  /**
   * A dónde navegar TRAS AÑADIR para dejar la pantalla lista para la siguiente
   * mentoría: la misma pantalla con la selección en blanco.
   *
   * ⚠️ ES UNA NAVEGACIÓN Y NO UN `setState`, y ésa es la trampa entera. El panel
   * de reserva es un componente de **servidor** y su estado ES la query string
   * (`?p=…&d=…&h=…`) — está argumentado en `booking-select.tsx`: «la verdad
   * sigue estando en la query». Así que «limpiar los campos» solo puede
   * significar ir a la misma URL sin esos parámetros y dejar que el servidor
   * repinte. Un estado de cliente aquí sería una segunda verdad que la recarga y
   * el botón atrás desmentirían.
   *
   * Sin este `href` no se navega: hay pantallas donde no hay nada que limpiar.
   */
  limpiarHref?: string;
  /** Qué falta para poder añadir. Sale como `title` del botón bloqueado. */
  motivo?: string;
  ctaLabel?: string;
  /** Del contenedor, no del botón. */
  className?: string;
  /**
   * La medida del botón. Por defecto la del panel de la ficha (51 px de B3.5);
   * el selector de paquetes pasa la suya (45 px) porque allí este botón convive
   * con «Continuar al pago» y dos alturas distintas en la misma tarjeta se leen
   * como dos importancias distintas.
   */
  buttonClassName?: string;
  /**
   * @deprecated ⚠️ PUENTE TEMPORAL, BÓRRALO EN CUANTO PUEDAS.
   *
   * Era el destino del botón «Seguir comprando» del modelo viejo. Hoy no se lee.
   * Sigue declarado solo para que `reservar/[productId]/slot-picker.tsx` —que lo
   * pasa y que está siendo rediseñado en paralelo— compile mientras tanto.
   * Ignorarlo en vez de tratarlo como `limpiarHref` es deliberado: allí vale
   * `/tutors/<id>`, y navegar solo a la ficha del tutor tras añadir un paquete
   * se llevaría por delante el «Continuar al pago» que la tarjeta tiene al lado.
   * Cuando esa pantalla pase al modelo nuevo, se quita de los dos sitios.
   */
  seguirHref?: string;
}) {
  const router = useRouter();
  const listo = productId !== null && slots.length > 0;

  function agregar() {
    // La misma condición que `listo`, escrita otra vez para que TypeScript
    // estreche `productId`. El botón ya está bloqueado; esto es el cinturón.
    if (productId === null || slots.length === 0) return;

    const line = { productId, slots };
    /*
     * ⚠️ SE PREGUNTA ANTES DE ESCRIBIR. `addCartLine` es idempotente y devuelve
     * `null` tanto si añadió como si la línea YA estaba (que es lo que pasa con
     * un doble clic, o al volver a un enlace compartido de un horario que ya se
     * apuntó). Sin esta comprobación el aviso diría «Añadida» sin haber añadido
     * nada, y encima el contador no saltaría — dos señales contradictorias.
     */
    const yaEstaba = cartHasKeySnapshot(cartLineKey(line));
    const fallo = addCartLine(line);

    if (fallo === "lleno") {
      toast.error(
        `El carrito admite ${CART_MAX_LINEAS} mentorías. Paga las que tienes o quita alguna.`,
      );
      return;
    }
    if (fallo) {
      toast.error("No se pudo agregar esta mentoría. Vuelve a elegir la hora.");
      return;
    }

    /*
     * ⚠️ ARRIBA, Y NO EN LA ESQUINA DE SIEMPRE. El `Toaster` del layout raíz no
     * declara posición, así que sonner los pinta abajo a la derecha — que es
     * exactamente donde vive la barra `sticky bottom-0` de las dos pantallas que
     * usan este botón (la ficha, B3.5, y el selector de paquetes). El aviso
     * taparía el «Ir al carrito» que acaba de aparecer y su salto: el acuse se
     * comería al acuse. Es el único toast del proyecto que compite con una barra
     * fija, y por eso es el único que mueve su sitio.
     */
    toast.success(
      yaEstaba ? "Ya la tenías en el carrito" : "Añadida al carrito",
      { position: "top-center" },
    );

    /*
     * Limpiar = navegar. Y no hace falta `router.refresh()`: `push` a otra query
     * ya provoca un render nuevo del servidor (estas fichas son dinámicas —leen
     * cookies para la zona horaria—, así que el router no las reutiliza de su
     * caché), y el contador de la cabecera no depende de ese render: vive sobre
     * la cookie y se entera por `CART_EVENT`, que acaba de dispararse solo.
     */
    if (limpiarHref) router.push(limpiarHref, { scroll: false });
  }

  return (
    <div className={className}>
      <Button
        onClick={agregar}
        disabled={!listo}
        /* ⚠️ El `title` NO se ve al pasar el ratón: `Button` trae
           `disabled:pointer-events-none`, así que un botón bloqueado no recibe
           hover. Se conserva porque sí llega al árbol de accesibilidad como
           descripción del control. Quien mira la pantalla se entera por el
           TEXTO del panel («Elige una sesión para ver sus horarios y su
           precio» / «Elige tu hora y confirma abajo»), que es donde tiene que
           estar: la explicación de por qué algo está bloqueado no puede
           depender de descubrir un tooltip. */
        title={listo ? undefined : motivo}
        className={buttonClassName}
      >
        <ShoppingCartIcon className="size-4" />
        {ctaLabel}
      </Button>
    </div>
  );
}
