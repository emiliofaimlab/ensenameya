"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckIcon, ShoppingCartIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CART_MAX_LINEAS,
  addCartLine,
  cartHasKeySnapshot,
  cartLineKey,
  subscribeCart,
} from "@/lib/cart/cookie";

/**
 * EY-177 · B3.2 · PASO 1 DE 3 — el botón de la ficha. Uno, y luego dos.
 *
 * Petición del cliente, literal: «cuando ya seleccione el día y la fecha, sale
 * **1 botón que es agregar al carrito**. Si le doy, se oculta ese y se muestran
 * **dos botones** ahora: el primero de agregar al carrito / seguir comprando y
 * el segundo de ir al carrito. Esto porque si un tutor tiene dos clases, yo
 * seleccioné la primera, día y fecha, agregué al carrito, quiero repetir lo
 * mismo con su segunda clase […] **sin salirme de esa visual**».
 *
 * «Sin salirme de esa visual» es el requisito de verdad, y es el que decide la
 * forma de este componente: añadir **no navega**. Escribe la cookie, llama a
 * `router.refresh()` para que el contador de la cabecera —que se pinta en
 * servidor— se entere, y cambia el par de botones en el sitio. «Seguir
 * comprando» sí navega, pero a la MISMA pantalla con la selección en blanco
 * (`seguirHref` = la URL de hoy sin `p` ni `h`), que es lo que el cliente
 * describe: elegir la segunda clase del mismo tutor sin irse a ningún lado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ ESTO ES UNA MARCHA ATRÁS SOBRE **N-33**, Y HAY QUE SABERLO.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El 17-ago se QUITÓ una pantalla del camino de la sesión suelta porque el
 * cliente se quejó de lo contrario: «estás seleccionando dos veces algo», «me
 * mareó un poco que el calendario salga dos veces». Desde entonces el botón de
 * este panel iba DERECHO al checkout con la hora en la URL. Ahora vuelve a
 * haber una pantalla en medio (la revisión), o sea una más que ayer.
 *
 * Lo que sí se conserva —y era la queja real, no el número de pantallas— es que
 * **no se vuelve a preguntar lo mismo**: la revisión no repinta ningún
 * calendario, solo enseña lo que ya se eligió. La pantalla intermedia que N-33
 * mató era otro selector; ésta es un resumen. Si el cliente vuelve a quejarse
 * de pasos, la salida barata es un atajo «Comprar solo esta» aquí al lado — no
 * quitar la revisión, que es donde el carrito de varias líneas cobra sentido.
 *
 * ⚠️ LOS PAQUETES NO PASAN POR AQUÍ. Una línea del carrito es una mentoría con
 * TODOS sus horarios, y un `per_package` de N sesiones necesita N horarios que
 * no caben en este panel lateral (RN-12). Ese caso sigue yendo al selector
 * múltiple de `/reservar/<id>`, que es donde se completa la línea y donde está
 * su propio «Agregar al carrito». `booking-panel.tsx` decide cuál de los dos
 * pinta; aquí solo llegan líneas completas.
 */
export function AddToCart({
  productId,
  slots,
  seguirHref,
  ctaLabel = "Agregar al carrito",
  className,
  buttonClassName = "h-[51px] w-full text-[15px]",
}: {
  productId: string;
  /**
   * Los horarios de la línea, en **instantes** (ms). Ya validados en servidor
   * contra los huecos reales: `booking-panel` solo pasa el ISO canónico que
   * casó por `Date.parse`, nunca el texto crudo de la URL. Ver `lib/cart/cookie.ts`
   * para por qué se guardan como número y no como ISO.
   */
  slots: number[];
  /** Misma pantalla, selección en blanco: el «seguir comprando» del cliente. */
  seguirHref: string;
  ctaLabel?: string;
  /** Del contenedor, no de los botones: los tres miden lo mismo a propósito. */
  className?: string;
  /**
   * La medida de los botones. Por defecto la del panel de la ficha (51 px de
   * B3.5); el selector de paquetes pasa la suya (45 px) porque allí este botón
   * convive con «Continuar al pago» y dos alturas distintas en la misma tarjeta
   * se leen como dos importancias distintas.
   */
  buttonClassName?: string;
}) {
  const router = useRouter();
  const line = { productId, slots };
  const key = cartLineKey(line);

  /*
   * ¿ESTÁ ESTA LÍNEA EN EL CARRITO? Se le PREGUNTA A LA COOKIE, no se recuerda
   * haber pulsado. Son cosas distintas: quien recarga la ficha, vuelve con el
   * botón atrás o abre un enlace compartido de un horario que ya tenía apuntado
   * tiene que ver los dos botones sin haber pulsado nada en esta vida del
   * componente.
   *
   * ⚠️ `useSyncExternalStore` Y NO `useState` + `useEffect`, por tres razones y
   * las tres muerden:
   *
   *   1. La cookie ES un almacén externo. Con estado propio habría dos copias de
   *      la verdad y la de React se quedaría vieja en cuanto otra pestaña —o la
   *      pantalla de revisión, que limpia lo ya comprado— tocara el carrito.
   *   2. Resuelve el SSR sin parpadeo ni desajuste de hidratación:
   *      `getServerSnapshot` devuelve `false` (en el servidor no hay
   *      `document.cookie`) y React vuelve a preguntar ya en el navegador. Un
   *      `setState` dentro de un efecto para lo mismo es justo lo que prohíbe la
   *      regla `react-hooks/set-state-in-effect`, y con razón: son renders en
   *      cascada.
   *   3. Cambiar de línea no necesita ningún reinicio manual. Al pulsar «Seguir
   *      comprando» la pantalla no se desmonta —misma ruta, otra query—, así que
   *      con estado propio React reutilizaría este componente y `dentro` se
   *      quedaría en `true` sobre una línea nueva (el tropiezo que
   *      `booking-select.tsx` resolvió con su `previo`). Aquí la respuesta
   *      depende solo de `key`, y `key` ya cambió.
   */
  const dentro = useSyncExternalStore(
    subscribeCart,
    useCallback(() => cartHasKeySnapshot(key), [key]),
    () => false,
  );

  function agregar() {
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
    // El botón se convierte en los dos botones SOLO: `addCartLine` dispara
    // `CART_EVENT` al escribir y la suscripción de arriba lo recoge. No hay
    // `setState` que sincronizar.
    //
    // El `refresh()` sí hace falta, y es por el SERVIDOR: el contador de la
    // cabecera se pinta desde la cookie en el layout, y sin invalidar su render
    // el número no cambiaría hasta la siguiente navegación completa. No navega
    // a ningún sitio — repinta en el mismo, que es el «sin salirme de esa
    // visual» del encargo.
    router.refresh();
  }

  if (!dentro) {
    return (
      <div className={className}>
        <Button onClick={agregar} className={buttonClassName}>
          <ShoppingCartIcon className="size-4" />
          {ctaLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* El orden es el que pidió el cliente: primero seguir comprando,
          después ir al carrito. Y el de ir al carrito es el que va relleno —
          es el que cierra la compra; el otro es quedarse.

          ⚠️ EN UNA FILA Y NO APILADOS, y no es gusto: en la ficha esta zona es
          la barra `sticky bottom-0` de B3.5, que en móvil flota sobre el panel.
          Dos botones apilados la subían de ~85 a ~150 px y agravaban el solape
          transitorio que esa barra ya documenta como coste aceptado. En una
          fila mide lo mismo que el botón único al que sustituye.

          Y por eso las etiquetas son cortas —«Seguir comprando» es literal del
          cliente—: con «Agregar otra mentoría» el texto se parte en dos líneas
          dentro de un panel lateral de 330 px. */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          asChild
          className={cn(buttonClassName, "px-2 text-[13.5px]")}
        >
          <Link href={seguirHref}>Seguir comprando</Link>
        </Button>
        <Button asChild className={cn(buttonClassName, "px-2 text-[13.5px]")}>
          <Link href="/carrito">Ir al carrito</Link>
        </Button>
      </div>
      {/* Confirmación en texto, no solo en el cambio de botones: sin ella, en
          móvil el pulgar tapa la zona justo al pulsar y el único indicio de que
          pasó algo es que el botón cambió de sitio debajo del dedo. */}
      <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[#4b4b4b]">
        <CheckIcon className="size-3.5 text-brand" />
        Añadida al carrito
      </p>
    </div>
  );
}
