"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";

import { removeCartLines } from "@/lib/cart/cookie";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * EY-177 · las dos escrituras del carrito que hace la pantalla de revisión.
 *
 * La pantalla es un Server Component (lee la cookie con `cookies()` y resuelve
 * precios contra la base), así que lo único que baja al navegador es esto: un
 * botón que quita y un efecto que limpia. Ninguno de los dos sabe nada de
 * dinero — le dicen a la cookie qué líneas ya no están, y `router.refresh()`
 * hace que el servidor vuelva a pintar la verdad.
 */

/** Quitar una línea del carrito. */
export function RemoveLine({
  lineKey,
  etiqueta,
  className,
}: {
  lineKey: string;
  /** Para el lector de pantalla: «Quitar Álgebra del carrito». */
  etiqueta: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={`Quitar ${etiqueta} del carrito`}
      onClick={() => {
        removeCartLines([lineKey]);
        router.refresh();
      }}
      className={cn(
        "inline-flex items-center gap-1 text-[13px] text-[#6b6b6b] transition-colors hover:text-destructive",
        className,
      )}
    >
      <XIcon className="size-3.5" />
      Quitar
    </button>
  );
}

/** Vaciar el carrito entero. */
export function ClearCart({ keys }: { keys: string[] }) {
  const router = useRouter();
  if (keys.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        removeCartLines(keys);
        router.refresh();
      }}
      className="text-[13px] text-[#6b6b6b] transition-colors hover:text-destructive"
    >
      Vaciar carrito
    </button>
  );
}

/**
 * ⚠️ EL AUTOLIMPIADO DE LO YA COMPRADO. Sin esto el carrito miente.
 *
 * Al volver de pagar, las líneas compradas siguen en la cookie: la compra no las
 * borra, porque el checkout no sabe que existe un carrito —y no debe saberlo: es
 * el mismo checkout de una reserva suelta de siempre—. Vale igual para la compra
 * de una línea y para el pedido entero de EY-176; la de pedido además se limpia
 * desde `/pedidos/<id>/confirmacion`, que sí sabe qué líneas se acaban de pagar.
 *
 * Así que la limpieza se hace al volver a la revisión, y la decide el SERVIDOR:
 * `resolveCart()` busca reservas vivas del alumno que casen exactamente con
 * cada línea y, si alguna ya pasó de `pending_payment`, la da por comprada y la
 * saca de la lista visible. Este componente solo ejecuta esa decisión sobre la
 * cookie, que es lo único que no puede hacer el servidor desde un render.
 *
 * ⚠️ Sin `router.refresh()` a propósito. El servidor YA pintó la página sin
 * esas líneas —vienen aparte, en `compradas`—, así que refrescar sería un viaje
 * de ida y vuelta para pintar exactamente lo mismo. Lo que sí hace falta es que
 * el contador de la cabecera se entere, y de eso ya se encarga el `CART_EVENT`
 * que dispara la escritura de la cookie.
 *
 * El `ref` evita repetir la escritura si React remonta el efecto (StrictMode en
 * desarrollo monta, desmonta y vuelve a montar).
 */
export function PruneBought({ keys }: { keys: string[] }) {
  const hecho = useRef(false);
  useEffect(() => {
    if (hecho.current || keys.length === 0) return;
    hecho.current = true;
    removeCartLines(keys);
  }, [keys]);
  return null;
}

/**
 * EY-176 · «Ir al pago» cuando hay VARIAS mentorías: crea el pedido y navega.
 *
 * ⚠️ NO MANDA LAS LÍNEAS. El cuerpo de la petición va vacío a propósito: el
 * Route Handler relee la cookie `ey-cart` en servidor, la valida y comprueba
 * hueco por hueco contra `get_available_slots` antes de crear nada. Mandar la
 * lista desde aquí sería dejar que el navegador eligiera qué mentorías y qué
 * horarios entran en un cobro, y la cookie se edita desde la consola en diez
 * segundos.
 *
 * Es un botón y no un `<Link>` porque crear el pedido es una ESCRITURA —N
 * reservas, N pagos y una cabecera, en una transacción—, y eso no puede colgar
 * de una navegación que el navegador pueda precargar o repetir con el «atrás».
 *
 * ⚠️ El doble clic está cubierto en las dos orillas: aquí con `enviando`, y en
 * la base con `find_open_order`, que devuelve el pedido abierto del mismo
 * carrito en vez de crear un segundo que se bloquearía a sí mismo (sus propias
 * reservas retienen esos huecos). La segunda es la que de verdad protege —
 * esta solo ahorra la petición.
 */
export function PagarPedido({ cuantas }: { cuantas: number }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    setEnviando(true);
    setError(null);
    const res = await fetch("/api/pedidos", { method: "POST" });
    const salida = (await res.json().catch(() => ({}))) as {
      orderId?: string;
      error?: string;
      linea?: number | null;
    };

    if (!res.ok || !salida.orderId) {
      // El mensaje ya viene traducido por `mensajeDeApertura`: nunca es el
      // texto crudo de Postgres, que puede traer dentro el nombre de un índice
      // único o un fallo de configuración nuestro contado como culpa de quien
      // iba a pagar. Lo que se añade aquí es CUÁL línea falló — el servidor la
      // numera (P-1) y esto la cuenta.
      setError(
        salida.linea
          ? `${salida.error ?? "No se pudo crear el pedido."} (mentoría ${salida.linea} de ${cuantas})`
          : (salida.error ?? "No se pudo crear el pedido."),
      );
      setEnviando(false);
      // El carrito cambió por debajo (un hueco que se fue): que el servidor lo
      // vuelva a pintar con la verdad en vez de dejar la lista de antes.
      router.refresh();
      return;
    }

    router.push(`/pedidos/${salida.orderId}/pagar`);
  }

  return (
    <>
      <Button className="mt-4 h-[49px] w-full text-[15px]" disabled={enviando} onClick={crear}>
        {enviando ? "Preparando tu pedido…" : `Pagar ${cuantas} mentorías juntas`}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
