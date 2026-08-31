"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangleIcon, XIcon } from "lucide-react";

import { removeCartLines } from "@/lib/cart/cookie";
import { Button } from "@/components/ui/button";
import { DatosInvitado } from "@/components/checkout/datos-invitado";
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
 * Una línea del pedido, **tal y como la va a nombrar el error**.
 *
 * ⚠️ `cuando` llega YA FORMATEADO desde el servidor, con `formatSessionTime` y
 * la zona de `getViewerTimezone()`. No se formatea aquí: en el navegador la zona
 * sería la del navegador, que casi siempre coincide con la del perfil pero no
 * tiene por qué (RN-01/RN-02), y el carrito ya pinta las horas de sus tarjetas
 * con la del perfil. Dos husos en la misma pantalla es peor que ninguno.
 */
export type LineaDelPedido = {
  /** `cartLineKey`: identifica la tarjeta que hay que señalar en la lista. */
  key: string;
  productId: string;
  titulo: string;
  cuando: string;
};

/**
 * EY-176 · «Ir al pago» cuando hay VARIAS mentorías: crea el pedido y navega.
 *
 * ⚠️ NO MANDA LAS LÍNEAS. El cuerpo de la petición va vacío a propósito: el
 * Route Handler relee la cookie `ey-cart` en servidor, la valida y comprueba
 * hueco por hueco contra `get_available_slots` antes de crear nada. Mandar la
 * lista desde aquí sería dejar que el navegador eligiera qué mentorías y qué
 * horarios entran en un cobro, y la cookie se edita desde la consola en diez
 * segundos. `lineas` es **solo para escribir el error**: nada de lo que hay
 * dentro viaja a la petición.
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
export function PagarPedido({ lineas }: { lineas: LineaDelPedido[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{
    mensaje: string;
    linea: LineaDelPedido | null;
  } | null>(null);
  /**
   * CHECKOUT DE INVITADO · el 401 deja de ser un callejón.
   *
   * El carrito se puede llenar sin cuenta a propósito, pero `/api/pedidos`
   * responde 401 porque `create_order` resuelve al alumno con `auth.uid()`. Ese
   * 401 se pintaba CRUDO —el recuadro rojo decía literalmente «no autenticado»,
   * que es texto de servidor y no un mensaje para nadie—. Ahora abre el mismo
   * alta que el checkout suelto y reintenta el POST al terminar.
   */
  const [pideCuenta, setPideCuenta] = useState(false);
  /** Reintentos ya gastados. UNO y no más: dos 401 seguidos no son un despiste. */
  const reintentos = useRef(0);
  const cuantas = lineas.length;

  /**
   * ⚠️ CUÁL MENTORÍA FALLÓ — y por qué no basta con el índice.
   *
   * El servidor numera la línea culpable (`detail`, 1-based) y además manda su
   * mentoría (`hint`), y las dos cosas se refieren a la lista que ÉL releyó de
   * la cookie. Esa lista se calculó con el mismo criterio que `lineas`, así que
   * en el uso normal el índice casa. Pero entre el render de esta pantalla y el
   * POST puede haber pasado algo —otra pestaña quitando una línea, el
   * autolimpiado de lo ya pagado— y entonces el índice apunta a otra mentoría.
   * Señalar la equivocada es peor que no señalar ninguna: manda a cambiar un
   * horario que estaba perfectamente.
   *
   * Así que el índice solo vale si la mentoría CONCUERDA. Si no concuerda, se
   * intenta por mentoría, y solo cuando identifica una sola línea (con dos
   * horarios de la misma clase en el carrito no se puede saber cuál fue). Si
   * nada casa, se devuelve `null` y el error se queda en la frase genérica —
   * que es exactamente lo que se enseñaba antes de esto.
   */
  function culpable(indice: unknown, productId: unknown): LineaDelPedido | null {
    // El `hint` solo se toma en serio si nombra una mentoría que está en esta
    // pantalla: PostgREST también usa ese campo para sugerencias suyas, y un
    // texto que no es un id nuestro no debe descartar un índice que sí sirve.
    const mentoria =
      typeof productId === "string" &&
      lineas.some((l) => l.productId === productId)
        ? productId
        : null;

    const porIndice =
      typeof indice === "number" && Number.isSafeInteger(indice) && indice > 0
        ? (lineas[indice - 1] ?? null)
        : null;

    if (porIndice && (mentoria === null || porIndice.productId === mentoria)) {
      return porIndice;
    }
    if (mentoria === null) return null;
    const candidatas = lineas.filter((l) => l.productId === mentoria);
    return candidatas.length === 1 ? candidatas[0]! : null;
  }

  async function crear() {
    setEnviando(true);
    setError(null);
    // ⚠️ `fetch` RECHAZA —no devuelve `!res.ok`— si se cae la red a media
    // petición, que es el caso normal comprando desde el móvil. Sin este `try`
    // la promesa quedaba sin capturar y `setEnviando(false)` no se ejecutaba
    // nunca: botón «Preparando tu pedido…» deshabilitado para siempre. Y desde
    // el checkout de invitado esto se llama JUSTO DESPUÉS de crear la cuenta,
    // así que el comprador se quedaría encerrado con una cuenta recién hecha.
    let res: Response;
    try {
      res = await fetch("/api/pedidos", { method: "POST" });
    } catch {
      setError({
        mensaje: "No pudimos conectar. Revisa tu conexión e inténtalo otra vez.",
        linea: null,
      });
      setEnviando(false);
      return;
    }
    const salida = (await res.json().catch(() => ({}))) as {
      orderId?: string;
      error?: string;
      linea?: number | null;
      productId?: string | null;
    };

    /*
     * ⚠️ EL 401 SE ATIENDE ANTES QUE NADA, y no por orden estético.
     *
     * Ese cuerpo no trae `linea` ni `productId` —el handler sale antes de leer
     * el carrito—, así que colándose por el bloque de abajo `culpable()`
     * devolvería `null` y el `router.replace` + `refresh` serían un viaje
     * inútil que además REPINTA la pantalla: desmontaría el formulario de datos
     * que acabamos de decidir enseñar.
     */
    if (res.status === 401) {
      if (reintentos.current > 0) {
        // Segundo 401 con la cuenta ya creada: algo va mal de verdad (la sesión
        // no llegó a cuajar). Mensaje nuestro y se para; reintentar en bucle
        // sería pedirle a alguien que mire cómo no pasa nada.
        setError({
          mensaje:
            "No pudimos abrir tu sesión para completar el pedido. Recarga la página e inténtalo otra vez.",
          linea: null,
        });
        setEnviando(false);
        return;
      }
      setPideCuenta(true);
      setEnviando(false);
      return;
    }

    if (!res.ok || !salida.orderId) {
      // ⚠️ El mensaje ya viene traducido por `mensajeDeApertura`: NUNCA es el
      // texto crudo de Postgres, que puede traer dentro el nombre de un índice
      // único o un fallo de configuración nuestro contado como culpa de quien
      // iba a pagar. Lo que se añade aquí es QUÉ mentoría y A QUÉ HORA.
      const linea = culpable(salida.linea, salida.productId);
      setError({
        mensaje: salida.error ?? "No se pudo crear el pedido.",
        linea,
      });
      setEnviando(false);

      /*
       * ⚠️ DOS NAVEGACIONES Y NINGUNA SOBRA.
       *
       * `replace` deja la línea culpable en la query (`?falla=<clave>`) para que
       * el SERVIDOR pueda marcar su tarjeta en la lista: esta pantalla es un
       * Server Component y el resumen vive en otra columna, así que no hay
       * estado de cliente que pueda cruzar de una a otra. Es el mismo criterio
       * que el panel de reserva —«el estado es la query»— y de paso el aviso
       * sobrevive a la recarga. `scroll:false` porque el mensaje que se acaba de
       * escribir está justo aquí y saltar arriba lo escondería.
       *
       * `refresh` es para los DATOS: el carrito cambió por debajo (un hueco que
       * se fue) y hay que repintarlo con la verdad. Y hace falta aparte porque
       * si el mismo fallo se repite dos veces la URL no cambia, así que el
       * `replace` sería un no-op y la lista se quedaría con los datos viejos.
       */
      router.replace(
        linea ? `${pathname}?falla=${encodeURIComponent(linea.key)}` : pathname,
        { scroll: false },
      );
      router.refresh();
      return;
    }

    router.push(`/pedidos/${salida.orderId}/pagar`);
  }

  return (
    <>
      {pideCuenta ? (
        /*
         * El alta, aquí mismo y con el carrito delante. Es EL MISMO componente
         * que el checkout suelto (`components/checkout/datos-invitado.tsx`): si
         * cada pantalla escribiera el suyo, la constancia de términos que se
         * guarda por un camino y por el otro acabaría divergiendo.
         *
         * ⚠️ El reintento vuelve a llamar a `crear()` ENTERO y no reusa nada de
         * la llamada anterior. Con sesión, `resolveCart()` ya no corta antes de
         * mirar los holds propios y alguna línea puede pasar a `pagando`: el
         * conjunto comprable cambia de forma legítima, así que hay que
         * preguntárselo otra vez al servidor.
         */
        <DatosInvitado
          className="mt-4"
          etiqueta={`Crear cuenta y pagar ${cuantas} mentorías`}
          onCuentaLista={() => {
            reintentos.current += 1;
            setPideCuenta(false);
            void crear();
          }}
        />
      ) : (
        <Button className="mt-4 h-[49px] w-full text-[15px]" disabled={enviando} onClick={crear}>
          {enviando ? "Preparando tu pedido…" : `Pagar ${cuantas} mentorías juntas`}
        </Button>
      )}
      {error ? (
        /*
          ⚠️ QUÉ MENTORÍA Y A QUÉ HORA — la pregunta literal del responsable era
          «¿cuál horario se ocupó? ¿qué clase? dame más detalles».

          Antes esto decía «(mentoría 2 de 3)», que obliga a contar tarjetas
          hacia abajo para averiguar de cuál habla — y en móvil el resumen está
          DEBAJO de la lista, así que hay que contar hacia arriba y de memoria.
          Un número ordinal no es un dato: es un acertijo con la respuesta en
          otra parte de la pantalla.

          El título y la hora van PRIMERO y el qué-ha-pasado después, porque la
          pregunta que trae quien lee esto es «¿cuál?». Y es un enlace al ancla
          de su tarjeta: nombrarla y que además se pueda saltar a ella cierra el
          asunto en un gesto.
        */
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-[10px] bg-destructive/[0.07] p-3 text-xs leading-relaxed text-destructive"
        >
          <AlertTriangleIcon className="mt-px size-4 shrink-0" />
          <div className="min-w-0">
            {error.linea ? (
              <a
                href={`#linea-${error.linea.key}`}
                className="block font-semibold underline decoration-destructive/40 underline-offset-2"
              >
                «{error.linea.titulo}» · {error.linea.cuando}
              </a>
            ) : null}
            <p className={error.linea ? "mt-1" : undefined}>{error.mensaje}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
