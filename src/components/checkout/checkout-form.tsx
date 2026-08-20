"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightIcon } from "lucide-react";
import {
  StripeEmbed,
  type CambioDelFormulario,
  type Embed,
} from "@/components/checkout/stripe-embed";
import { HoldCountdown } from "@/components/checkout/hold-countdown";
import { ChangeSlotLink } from "@/components/checkout/change-slot-link";
import { PaymentPolicy } from "@/components/checkout/payment-policy";

import { createClient } from "@/lib/supabase/client";
import {
  buscarReservaDelAlumno,
  esCarreraDeHorario,
  holdsQueSolapan,
  liberarHolds,
  mensajeDeApertura,
} from "@/lib/checkout/hold";
import type { SavedCard } from "@/lib/stripe";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime } from "@/lib/booking";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Hora de fin de una sesión, derivada con LA MISMA FÓRMULA QUE EL SERVIDOR.
 *
 * `create_booking` agenda `end_at = start_at + make_interval(mins => …)` sobre
 * un `timestamptz`, o sea una suma de tiempo ABSOLUTO. Sumar milisegundos a un
 * `Date` es exactamente eso, así que los dos coinciden incluso cuando el tramo
 * cruza un cambio de hora — ahí el reloj local salta y la duración no, que es
 * lo que de verdad pasa. No se inventa nada: sin duración declarada
 * (`products.session_duration_min` es NULLABLE) no hay hora de fin y no se
 * pinta ninguna.
 */
function horaFin(iso: string, minutos: number | null, timeZone: string): string | null {
  if (!minutos) return null;
  return new Date(new Date(iso).getTime() + minutos * 60_000).toLocaleTimeString(
    "es",
    { hour: "2-digit", minute: "2-digit", timeZone },
  );
}

/** En qué punto está el formulario de Stripe, para la tarjeta ilustrada. */
type EstadoTarjeta = "vacia" | "escribiendo" | "completa";

/** Lo que hace falta para pagar, una vez resuelta la reserva. */
type Apertura =
  | { fase: "abriendo" }
  | { fase: "error"; mensaje: string }
  /**
   * Estos horarios YA están comprados: existe una reserva de este alumno que
   * pasó de `pending_payment`. No se abre ningún cobro y se le lleva a su
   * reserva. Es el caso del «atrás» del navegador después de pagar, y sin esta
   * rama acababa en un error que acusaba de «horario no disponible» a la
   * reserva que se acababa de pagar.
   */
  | { fase: "ya_pagada"; bookingId: string }
  | {
      fase: "lista";
      bookingId: string;
      /** ISO hasta el que se promete el horario, o null si no se pudo saber. */
      retencionHasta: string | null;
      /** null = el cobro está ruteado al proveedor simulado: no hay formulario. */
      embed: Embed | null;
    };

/**
 * US-602 (SCR-AL05) — checkout. El cobro lo mueven siempre las RPC y el webhook
 * server-side; esta pantalla no toca dinero.
 *
 * N-37 · vive fuera del layout de `(app)`: esta pantalla no tiene cabecera, ni
 * menú, ni pie, ni chat flotante. Petición del cliente —«el checkout tiene que
 * estar lo más aislado posible […] no debe tener más nada esa página»— y
 * también la práctica normal de cualquier pasarela: cada enlace de escape en
 * una pantalla de pago es una compra que no se termina.
 *
 * ⚠️ SIN campos de tarjeta NUESTROS, a propósito. El Figma dibuja aquí número
 * de tarjeta, titular, vencimiento y CVC en campos propios; capturar el PAN en
 * nuestro formulario metería el proyecto en PCI-DSS SAQ D (alcance completo).
 * Lo que hay en su lugar es el formulario de pago de Stripe (reunión 7-ago): se
 * ve dentro de esta pantalla, pero vive en un iframe del proveedor, así que los
 * datos de la tarjeta no tocan nuestro DOM y seguimos en SAQ A igual que con el
 * checkout alojado. La tarjeta ilustrada de la izquierda es decorativa (no
 * captura nada).
 *
 * MN-01 · desde el 20-ago ese formulario es `ui_mode: 'form'` y NO el Embedded
 * Checkout: Stripe pinta solo los campos de pago, así que el «Resumen del
 * pedido» de la izquierda pasó de ser el segundo a ser **el único**. Si alguien
 * lo quita, el alumno pagará sin ver qué está comprando.
 *
 * ⚠️⚠️ D-2 (§20.14) · LA RESERVA SE CREA AL LLEGAR, NO AL PULSAR.
 *
 * Hasta hoy había una puerta —casilla de guardar tarjeta + «Continuar al
 * pago»— y `create_booking` se llamaba al pulsarla. El cliente pidió el
 * formulario montado desde el principio, y montarlo exige un `client_secret`,
 * que exige una Session, que exige una reserva con su `payments.gross_amount`
 * congelado (regla de oro 2: el importe no lo pone el navegador). O sea que el
 * formulario al llegar ARRASTRA la reserva al llegar, y con ella dos cosas que
 * no son opcionales:
 *
 *   1. El horario del tutor se retiene POR VISITA y no por intención. De ahí
 *      `HoldCountdown`: el contador dejó de ser deseable y pasó a ser
 *      obligatorio, porque quien no sabe que hay un reloj no puede correr.
 *   2. Recargar la pantalla NO puede crear una segunda reserva. `create_booking`
 *      revalida que cada hueco siga libre y **tu propia reserva de hace diez
 *      segundos te lo bloquea a ti mismo**: sin reutilizarla, recargar el
 *      checkout devolvería «algún horario ya no está disponible» sobre un
 *      horario que es tuyo. Eso lo resuelve `buscarReservaDelAlumno()`, y es el
 *      fallo más probable de todo este cambio porque el typecheck no lo ve.
 *
 * ⚠️ Y ESE MISMO CANDADO MUERDE EN OTROS TRES SITIOS, todos resueltos aquí y en
 * `lib/checkout/hold.ts` (que es donde está el porqué completo):
 *
 *   · salir por «Cambiar horario» llevaba al selector SIN el propio hueco, que
 *     el alumno acababa de retener al llegar → `ChangeSlotLink` lo suelta antes
 *     de irse, porque cambiar de horario es una decisión, no un abandono;
 *   · pedir OTRO conjunto de horarios que solape con el hold propio hacía que
 *     el alumno se bloqueara a sí mismo → se sueltan los solapados ANTES de
 *     llamar a `create_booking`;
 *   · volver atrás DESPUÉS de pagar remontaba este formulario y volvía a pedir
 *     la reserva → la búsqueda ya no se limita a `pending_payment` y esa rama
 *     lleva a la reserva en vez de a un error.
 *
 * Lo que sigue sin resolver, y conviene tenerlo escrito: quien cierre la
 * pestaña o se vaya a otro sitio deja el horario retenido hasta que lo suelte
 * `expire_stale_bookings`. Ese es el coste que el cliente aceptó con D-2; lo
 * que se arregla arriba son las salidas en las que la persona DICE que ya no
 * quiere ese hueco.
 */
export function CheckoutForm({
  productId,
  studentId,
  tutorId,
  slots,
  total,
  currency,
  productTitle,
  tutorName,
  packageLabel,
  incluye,
  precioPorSesion,
  durationMin,
  timeZone,
  simulado,
  tarjetas,
  hayUltimaUsada,
  aceptaSola,
}: {
  productId: string;
  /**
   * El alumno, resuelto en servidor. Se usa para acotar la búsqueda de la
   * reserva en curso, y NO es decorativo: `bookings_select_tutor` deja que un
   * tutor lea las reservas de sus propias mentorías, así que sin este filtro un
   * tutor que abriera el checkout de su propia clase podría «reutilizar» la
   * reserva a medias de un alumno suyo.
   */
  studentId: string;
  /**
   * El tutor de esta mentoría. Sirve para UNA cosa y es la que cierra el
   * callejón sin salida de los paquetes: encontrar los holds propios que
   * solapan lo que se va a pedir.
   *
   * ⚠️ Y es por TUTOR y no por mentoría a propósito, porque así lo mide el SQL:
   * `get_available_slots` descarta un hueco si solapa una sesión **del tutor**,
   * venga de la mentoría que venga —una persona no da dos clases a la vez—. Con
   * `productId` se escaparía el caso real de alguien tanteando dos mentorías
   * del mismo tutor a la misma hora.
   */
  tutorId: string;
  slots: string[];
  total: number;
  currency: string;
  productTitle: string;
  tutorName: string;
  packageLabel: string;
  /** "4 × 60 min" (`sessionsLabel`). Null si la mentoría no declara duración. */
  incluye: string | null;
  /** "Equivale a 24,00 US$ por sesión · 4 sesiones" (`perSessionLabel`).
   *  Null cuando no es un paquete: ahí el precio por sesión ES el total. */
  precioPorSesion: string | null;
  /** `products.session_duration_min`. NULLABLE: sin él no hay hora de fin. */
  durationMin: number | null;
  /**
   * RN-01/RN-02 · la zona del alumno, resuelta en servidor (`getUserTimezone`).
   *
   * 🐛 Antes no llegaba y las horas se formateaban sin `timeZone`: en el SSR
   * salían en la del servidor (UTC en Vercel) y tras hidratar en la del
   * navegador, que puede no ser la del perfil. La pantalla de al lado
   * (`/reservas/[id]/pagar`) y el selector de horarios sí usan la del perfil,
   * así que el checkout podía enseñar UNA HORA DISTINTA de la que se eligió.
   */
  timeZone: string;
  /** Lo decide `payment_routing_rules`, no el código: con un proveedor real no
   *  hay aviso de pruebas ni botón de simular fallo. */
  simulado: boolean;
  /** Las tarjetas guardadas de verdad. La ilustración refleja la primera y el
   *  texto dice cuántas hay: enseñar una sola cuando hay varias es la misma
   *  mentira que el `4821` inventado, solo que más difícil de ver. */
  tarjetas: SavedCard[];
  /** true si la primera de la lista es de verdad la última usada, no solo la
   *  más reciente. Cambia la etiqueta: sin cobros previos no se puede afirmar. */
  hayUltimaUsada: boolean;
  /**
   * M-02 · `products.auto_accept_bookings`. Cambia lo que se PROMETE aquí, y
   * por eso llega hasta el formulario: con la aceptación automática puesta la
   * reserva pagada salta a `confirmed` sin pasar por `pending_acceptance`, así
   * que no existe la ventana de 24 h ni su reembolso íntegro automático. Anunciar
   * ese reembolso igualmente sería prometer algo que el código ya no hace.
   */
  aceptaSola: boolean;
}) {
  const router = useRouter();
  const [apertura, setApertura] = useState<Apertura>({ fase: "abriendo" });
  const [pagando, setPagando] = useState(false);
  // D-1 · lo único que sabemos de lo que se teclea: en qué punto va el
  // formulario. Ni marca, ni dígitos, ni caducidad — ver `stripe-embed.tsx`.
  const [estadoTarjeta, setEstadoTarjeta] = useState<EstadoTarjeta>("vacia");
  // Cuál de las tarjetas GUARDADAS eligió, cuando eligió una. Es un id nuestro
  // (`pm_…`, el mismo que nos dio el servidor), así que cruzarlo no inventa nada.
  const [tarjetaElegida, setTarjetaElegida] = useState<string | null>(null);

  /**
   * QUÉ RESERVA SE ABRIÓ YA, para no abrir dos.
   *
   * No es un booleano: guarda la mentoría y los horarios concretos. Con un
   * booleano, StrictMode (que monta, desmonta y vuelve a montar en desarrollo)
   * quedaba cubierto, pero una navegación de la propia app a este mismo
   * checkout con OTROS horarios reutilizaría el componente en la misma posición
   * del árbol, el ref seguiría en `true` y la pantalla se quedaría enseñando el
   * cobro del horario anterior. Con la clave dentro, ese caso vuelve a abrir.
   */
  const abiertoPara = useRef<string | null>(null);
  const clave = `${productId}|${[...slots].sort().join(",")}`;

  useEffect(() => {
    if (abiertoPara.current === clave) return;
    abiertoPara.current = clave;

    async function abrir() {
      // Actualización funcional: en el montaje el estado YA es "abriendo" y
      // asignarle un objeto nuevo sería un render de más en cada carga de la
      // pantalla de pago. Solo hace algo cuando se vuelve a abrir con otros
      // horarios, que es justo cuando hay que limpiar lo anterior.
      setApertura((previo) =>
        previo.fase === "abriendo" ? previo : { fase: "abriendo" },
      );
      const supabase = createClient();

      // 1) La reserva: la que ya había (recarga, vuelta atrás) o una nueva.
      //
      // La búsqueda mira CUALQUIER reserva viva del alumno con estos horarios,
      // no solo la que esté a medias de pago: si ya se pagó, lo que toca es
      // llevarlo a su reserva, no volver a pedir un horario que ya es suyo.
      const yaHabia = await buscarReservaDelAlumno(supabase, {
        studentId,
        productId,
        slots,
      });

      if (yaHabia && yaHabia.status !== "pending_payment") {
        setApertura({ fase: "ya_pagada", bookingId: yaHabia.id });
        // `replace` para que el «atrás» que trajo hasta aquí no devuelva otra
        // vez a este checkout muerto: se sustituye la entrada del historial.
        router.replace(`/reservas/${yaHabia.id}`);
        return;
      }

      let bookingId = yaHabia?.id ?? null;

      if (!bookingId) {
        // ⚠️ PRIMERO SE SUELTA LO PROPIO, Y LUEGO SE PIDE. `create_booking`
        // revalida contra `get_available_slots`, que descuenta toda sesión no
        // cancelada del tutor SIN MIRAR DE QUIÉN ES: una reserva a medias de
        // este mismo alumno que solape le contesta «algún horario ya no está
        // disponible» sobre un hueco que retiene él. Es el caso normal de
        // volver atrás y elegir otra hora, y en un paquete basta con que UNA de
        // las N solape para tirar la reserva entera.
        const propios = await holdsQueSolapan(supabase, {
          studentId,
          tutorId,
          slots,
          durationMin,
        });
        if (propios.length > 0) await liberarHolds(supabase, propios);

        const { data, error } = await supabase.rpc("create_booking", {
          p_product_id: productId,
          p_slots: slots,
        });

        if (error || !data) {
          // ⚠️ UNA CARRERA NO ES UN FALLO. Dos pestañas o un doble clic hacen
          // que las dos peticiones llamen a `create_booking` y que la perdedora
          // choque contra el índice único de `sessions`. Si la ganadora era el
          // propio alumno —que es justo lo que pasa con dos pestañas suyas— la
          // reserva buena ya existe: se busca UNA vez más antes de rendirse.
          const rescatada = esCarreraDeHorario(error)
            ? await buscarReservaDelAlumno(supabase, {
                studentId,
                productId,
                slots,
              })
            : null;

          if (rescatada && rescatada.status !== "pending_payment") {
            setApertura({ fase: "ya_pagada", bookingId: rescatada.id });
            router.replace(`/reservas/${rescatada.id}`);
            return;
          }
          if (!rescatada) {
            // Y si tampoco aparece, texto NUESTRO: el mensaje crudo de Postgres
            // puede traer dentro el nombre de un índice o un fallo de
            // configuración nuestro contado como si fuera culpa de quien paga.
            setApertura({ fase: "error", mensaje: mensajeDeApertura(error) });
            return;
          }
          bookingId = rescatada.id;
        } else {
          bookingId = data;
        }
      }

      // 2) El cobro. Quién cobra lo decide el servidor leyendo
      // `payments.provider`, el snapshot que `create_booking` acaba de congelar
      // desde `payment_routing_rules`. El navegador no elige proveedor:
      // pregunta. Y el importe sale de `payments.gross_amount`, nunca de aquí.
      const res = await fetch("/api/pagos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      const salida = (await res.json().catch(() => ({}))) as Partial<Embed> & {
        simulated?: boolean;
        retencionHasta?: string | null;
        error?: string;
      };

      if (!res.ok) {
        setApertura({
          fase: "error",
          mensaje: salida.error ?? "No se pudo abrir el pago.",
        });
        return;
      }

      setApertura({
        fase: "lista",
        bookingId,
        retencionHasta: salida.retencionHasta ?? null,
        embed:
          salida.clientSecret && salida.publishableKey
            ? {
                clientSecret: salida.clientSecret,
                publishableKey: salida.publishableKey,
              }
            : null,
      });
    }

    // ⚠️ SIN LIMPIEZA QUE CANCELE NADA, y es deliberado: desmontar esta pantalla
    // no debe deshacer una reserva que quizá se esté pagando en otra pestaña. La
    // reserva la libera `expire_stale_bookings` a los 20 minutos, no el
    // navegador. Y sin abortar la petición a medias: si el desmontaje llegara
    // entre `create_booking` y el checkout, cortar dejaría la reserva creada y
    // sin cobro abierto, que es peor que terminar y no pintar nada.
    void abrir();
  }, [clave, productId, slots, studentId, tutorId, durationMin, router]);

  /**
   * Camino simulado (`payment_routing_rules` aún en 'simulated'): no hay
   * Session que abrir, lo cierra el propio navegador por RPC.
   *
   * El nombre de la RPC no es cosmético: `confirm_payment` está revocada para el
   * cliente y solo la alcanza el webhook (`20260806120000`). Esta variante exige
   * ser dueño de la reserva **y** que el cobro esté ruteado al proveedor
   * simulado, así que el día que entre un PSP real este botón deja de funcionar
   * solo — que es lo que debe pasar.
   */
  async function confirmarSimulado(exito: boolean) {
    if (apertura.fase !== "lista") return;
    setPagando(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("confirm_simulated_payment", {
      p_booking_id: apertura.bookingId,
      p_success: exito,
    });
    if (error) {
      toast.error(error.message ?? "No se pudo procesar el pago.");
      setPagando(false);
      return;
    }
    if (!exito) {
      toast.error("El pago no se completó. Se liberó el horario.");
      setPagando(false);
      return;
    }
    // AL06 — confirmación como página propia.
    router.push(`/reservas/${apertura.bookingId}/confirmacion`);
  }

  /**
   * D-1 · la tarjeta ilustrada reacciona, y NADA MÁS.
   *
   * Se derivan dos cosas del evento y las dos son honestas: en qué punto va el
   * formulario (`empty`/`complete`) y, si eligió una tarjeta ya guardada, cuál.
   * Lo que NO se hace, y no es un olvido, es pintar los dígitos o la marca de
   * una tarjeta nueva: no llegan hasta aquí y no deben llegar.
   */
  const alCambiar = useCallback(
    (evento: CambioDelFormulario) => {
      setEstadoTarjeta(
        evento.complete ? "completa" : evento.empty ? "vacia" : "escribiendo",
      );
      // Y CUÁL de las guardadas eligió, si eligió una. `payment_method` solo
      // trae id cuando lo seleccionado es un medio de pago YA guardado; con una
      // tarjeta nueva llega vacío, y ESE vacío es justo lo que hace que la
      // ilustración deje de afirmar nada (`tecleandoNueva` más abajo): sin
      // tarjeta elegida y con el formulario tocado, la cara de delante vuelve a
      // genérica en vez de seguir enseñando los dígitos de otra.
      //
      // ⚠️ SIN NAVEGADOR DELANTE NO SE HA PODIDO VER CON QUÉ FRECUENCIA VIENE
      // ESTE CAMPO. Si resultara que aparece y desaparece entre eventos, se
      // vería la cara de delante alternando entre la tarjeta guardada y la
      // genérica; ninguna de las dos versiones miente —el rótulo describe
      // siempre lo que se está enseñando— pero sería ruido. La salida, si
      // molesta, es quedarse solo con el `setEstadoTarjeta` de arriba y borrar
      // estas dos líneas.
      const seccionDePago = evento.value?.payment;
      if (seccionDePago) {
        setTarjetaElegida(seccionDePago.payment_method?.id ?? null);
      }
    },
    [],
  );

  // El wallet: delante la elegida en el formulario, si Stripe nos dijo cuál, y
  // si no la que el servidor puso primera (la última usada).
  const alFrente =
    tarjetas.find((t) => t.id === tarjetaElegida) ?? tarjetas[0] ?? null;
  const esLaElegida = Boolean(alFrente && alFrente.id === tarjetaElegida);
  // La pila de detrás se calcula sobre `alFrente` y NO sobre lo que se acabe
  // pintando: así el mazo no cambia de forma —ni de altura— por empezar a
  // teclear. Lo que cambia es el contenido de la de delante, no el montón.
  const detras = tarjetas.filter((t) => t.id !== alFrente?.id).slice(0, 2);

  /**
   * ⚠️ LA CARA DE DELANTE NO PUEDE AFIRMAR UNA TARJETA QUE NO SE VA A USAR.
   *
   * El anillo reactivo (D-1) se enciende al escribir y se pone verde al
   * completar, y hasta ahí bien. El problema era QUÉ envolvía: los dígitos, el
   * titular y el «VENCE» salían de la tarjeta GUARDADA, porque mientras se
   * teclea una nueva no hay ninguna elegida y se caía a la primera de la lista.
   *
   * El caso malo no es de borde: alumno con exactamente UNA tarjeta guardada.
   * Veía «•••• 4242» con su caducidad y su nombre iluminándose al ritmo de OTRO
   * número — una afirmación falsa sobre el medio de pago, justo en el instante
   * de pagar. Así que en cuanto se escribe algo que no es la tarjeta elegida,
   * la ilustración vuelve a genérica y el rótulo lo dice.
   */
  const tecleandoNueva = estadoTarjeta !== "vacia" && !esLaElegida;
  const tarjeta = tecleandoNueva ? null : alFrente;
  const rotulo = tecleandoNueva
    ? "TARJETA NUEVA"
    : !tarjeta
      ? "SIN TARJETA GUARDADA"
      : esLaElegida
        ? "ELEGIDA PARA ESTE PAGO"
        : tarjetas.length > 1
          ? hayUltimaUsada
            ? "ÚLTIMA USADA · ELIGES AL PAGAR"
            : `1 DE ${tarjetas.length} · ELIGES AL PAGAR`
          : "TITULAR";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* Columna izquierda del Figma: tarjeta ilustrada + resumen. */}
      <div className="flex flex-col gap-5">
        {/* Wallet: la de delante es la que se va a usar; las demás asoman
            detrás y se abren en abanico al pasar el ratón. Es INFORMATIVO, no
            un selector — elegir se elige en el formulario de Stripe, que es
            quien tiene las tarjetas, y un selector aquí sería prometer un
            control que no tenemos.

            El montón NO cambia de forma al teclear: la pila de detrás se
            calcula sobre la guardada que iría delante, no sobre lo que se
            acabe pintando. Lo que cambia al escribir una tarjeta nueva es el
            CONTENIDO de la de delante, que pasa a genérica; si la pila se
            recalculara, con una sola tarjeta guardada aparecería una segunda
            capa y la caja se desbordaría por abajo. */}
        <div
          className="group relative"
          style={{ height: tarjetas.length > 2 ? 286 : tarjetas.length > 1 ? 232 : 178 }}
        >
          {/* Las de detrás, de la más lejana a la más cercana. */}
          {detras.map((t, i) => (
            <div
              key={t.id}
              aria-hidden
              // Transformaciones explícitas y no calculadas: Tailwind necesita la
              // clase entera en el fuente para generarla, y como mucho hay dos.
              className={[
                "absolute inset-x-0 top-0 flex h-[178px] items-end rounded-[20px]",
                "bg-linear-to-br from-[#243043] to-[#0b3a6d] px-6 pb-1.5",
                "text-[11px] text-white/70 shadow-lg",
                "transition-transform duration-500 ease-out",
                // Sin animación para quien la haya desactivado en su sistema.
                "motion-reduce:transition-none motion-reduce:group-hover:transform-none",
                i === 0
                  ? "z-10 translate-y-[26px] scale-[0.955] group-hover:translate-y-[46px] group-hover:-rotate-2"
                  : "z-0 translate-y-[52px] scale-[0.91] group-hover:translate-y-[92px] group-hover:-rotate-4",
              ].join(" ")}
            >
              <span className="capitalize">
                {t.brand} •••• {t.last4}
              </span>
            </div>
          ))}

          {/* La de delante. El anillo es TODO lo que reacciona al formulario
              (D-1): un cerco de marca mientras se escribe y uno verde al
              quedar completa. El desplazamiento se lo queda el `hover` para
              que los dos efectos no se peleen por el mismo `translate`.

              ⚠️ Y lo que el anillo envuelve tiene que ser verdad: mientras se
              teclea una tarjeta que no es la elegida, aquí no hay dígitos, ni
              titular, ni caducidad de ninguna guardada — ver `tecleandoNueva`.
              Un anillo iluminándose alrededor de los últimos cuatro dígitos de
              OTRA tarjeta es una afirmación falsa sobre con qué se paga. */}
          <div
            className={cn(
              "absolute inset-x-0 top-0 z-20 h-[178px] rounded-[20px] bg-linear-to-br from-[#191925] to-[#054a94] p-6 text-white shadow-xl",
              "ring-offset-2 ring-offset-muted transition-[box-shadow,transform] duration-500 ease-out",
              "group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0",
              estadoTarjeta === "completa"
                ? "ring-2 ring-success"
                : estadoTarjeta === "escribiendo"
                  ? "ring-2 ring-brand"
                  : "ring-0 ring-transparent",
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "h-7 w-9 rounded-[6px] bg-[#facc66] transition-opacity duration-500",
                  estadoTarjeta === "vacia" ? "opacity-70" : "opacity-100",
                )}
              />
              <span className="text-xs font-semibold tracking-wide">
                ENSÉÑAME YA
              </span>
            </div>
            <p className="mt-9 text-xl font-medium tracking-[0.15em]">
              •••• •••• •••• {tarjeta ? tarjeta.last4 : "••••"}
            </p>
            <div className="mt-5 flex justify-between text-[13px]">
              <span>
                <span className="block text-[9px] tracking-wide opacity-70">
                  {rotulo}
                </span>
                <span className="font-semibold capitalize">
                  {tarjeta ? (tarjeta.nombre ?? tarjeta.brand) : "—"}
                </span>
              </span>
              <span>
                <span className="block text-[9px] tracking-wide opacity-70">
                  VENCE
                </span>
                <span className="font-semibold">
                  {tarjeta
                    ? `${String(tarjeta.expMonth).padStart(2, "0")}/${String(tarjeta.expYear).slice(-2)}`
                    : "––/––"}
                </span>
              </span>
            </div>
          </div>

          {tarjetas.length > 3 ? (
            <span className="absolute inset-x-0 bottom-0 z-30 text-center text-[11px] text-[#6b6b6b]">
              y {tarjetas.length - 3} más
            </span>
          ) : null}
        </div>

        <PanelCard>
          <PanelCardTitle className="text-[15px]">
            Resumen del pedido
          </PanelCardTitle>
          <div className="mt-3.5">
            <p className="text-sm font-medium text-[#19191f]">{productTitle}</p>
            <p className="text-xs text-[#6b6b6b]">
              con {tutorName} · {packageLabel}
              {incluye ? ` · ${incluye}` : ""}
            </p>
          </div>

          {/* 🐛 RN-01/RN-02 · con la zona del alumno, no con la del servidor ni
              con la del navegador. Sin `timeZone` esta lista podía enseñar una
              hora distinta de la que se eligió en el calendario, que sí usa la
              del perfil. Es el mismo helper que la pantalla hermana: la lógica
              de zona horaria vive en UN sitio a propósito — duplicarla es como
              se rompió la última vez. */}
          <ul className="mt-3.5 flex flex-col gap-1.5 border-t border-[#e0e0e0] pt-3.5 text-xs text-[#6b6b6b]">
            {slots.map((iso) => {
              const fin = horaFin(iso, durationMin, timeZone);
              return (
                <li key={iso} className="first-letter:uppercase">
                  {formatSessionTime(iso, timeZone)}
                  {fin ? ` – ${fin}` : ""}
                </li>
              );
            })}
          </ul>

          <div className="mt-3.5 flex items-center justify-between border-t border-[#e0e0e0] pt-3.5 text-[13px]">
            <span className="text-[#6b6b6b]">Subtotal</span>
            <span className="text-[#333333]">{formatMoney(total, currency)}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-semibold text-[#19191f]">Total</span>
            <span className="text-lg font-bold text-brand">
              {formatMoney(total, currency)}
            </span>
          </div>
          {/* Solo en paquetes: en una sesión suelta el precio por sesión ES el
              total y repetirlo sería ruido. */}
          {precioPorSesion ? (
            <p className="mt-1 text-right text-[11px] text-[#6b6b6b]">
              {precioPorSesion}
            </p>
          ) : null}

          {/* M-06 · aquí ponía "(RN-27/37)". Esos son códigos de NUESTRA
              documentación interna y no significan nada para quien está a punto
              de pagar; el "N.º de sesión" de N-27 sí se enseña, porque ese lo
              pidió el cliente para poder hablar por teléfono de una clase.

              Y NUNCA el reparto con el tutor: cuánto se queda la plataforma es
              información interna, por mucho que `payments` la tenga a mano.

              M-02 · la promesa cambia con la mentoría: si acepta sola, la
              reserva se confirma con el cobro y la ventana de 24 h no llega a
              existir. Prometerla igual sería un reembolso que nadie va a hacer.

              D-4 (§20.14) · y la política se cuenta ENTERA, incluida la mitad
              mala: el 50 % de quien cancela tarde. Callarlo probablemente vende
              algo más, y es exactamente por eso que se cuenta.

              El texto vive en `PaymentPolicy` porque la pantalla hermana
              (`/reservas/[id]/pagar`) tiene que decir LO MISMO: cuando cada una
              escribía su párrafo, D-4 se aplicó solo a esta y allí se quedó
              contando media política. */}
          <PaymentPolicy
            aceptaSola={aceptaSola}
            className="mt-3.5 border-t border-[#e0e0e0] pt-3.5"
          />
        </PanelCard>
      </div>

      {/* Columna derecha: el formulario de Stripe, embebido (sin PAN nuestro). */}
      <PanelCard>
        <PanelCardTitle className="text-[15px]">Método de pago</PanelCardTitle>

        {/* D-2 · el contador. Va arriba del formulario y no escondido en el
            resumen: es la contrapartida de que el horario se retenga por
            visita, y una advertencia que no se ve no advierte. */}
        {apertura.fase === "lista" ? (
          <HoldCountdown hasta={apertura.retencionHasta} className="mt-3.5" />
        ) : null}

        {apertura.fase === "abriendo" ? (
          <p className="mt-3.5 text-[13px] text-[#6b6b6b]" aria-live="polite">
            Preparando tu pago seguro…
          </p>
        ) : null}

        {/* Estos horarios ya están pagados. Se navega a la reserva en el propio
            efecto; esto es lo que se ve mientras llega, y el enlace es el
            respaldo por si la navegación no prosperara. Lo que NO se hace es
            pedirlos otra vez: era el «atrás» después de pagar acusando de
            «horario no disponible» a la reserva recién comprada. */}
        {apertura.fase === "ya_pagada" ? (
          <div className="mt-3.5 rounded-xl border border-dashed border-[#e0e0e0] p-5">
            <p className="text-[13px] text-[#4b4b4b]" aria-live="polite">
              Este horario ya está pagado: tu reserva está hecha. Te llevamos a
              ella.
            </p>
            <Link
              href={`/reservas/${apertura.bookingId}`}
              className="mt-3 flex w-fit items-center gap-1.5 text-[13px] font-semibold text-brand hover:underline"
            >
              Ver mi reserva
              <ArrowRightIcon className="size-4" />
            </Link>
          </div>
        ) : null}

        {apertura.fase === "error" ? (
          <div className="mt-3.5 rounded-xl border border-dashed border-[#e0e0e0] p-5">
            <p role="alert" className="text-[13px] text-destructive">
              {apertura.mensaje}
            </p>
            {/* Sin formulario que rellenar, la única salida útil es volver a
                elegir. Dejarlo sin enlace deja a alguien encerrado en una
                pantalla que ya no puede hacer nada.

                Y suelta el horario al salir, igual que el «Cambiar horario» de
                la cabecera: si el fallo llegó DESPUÉS de crear la reserva —el
                cobro no se pudo abrir— el hold existe, y mandar al alumno al
                selector sin soltarlo lo deja mirando un calendario del que
                falta justo su hueco. */}
            <ChangeSlotLink
              productId={productId}
              studentId={studentId}
              slots={slots}
              etiqueta="Elegir otro horario"
              className="mt-3 flex w-fit items-center gap-1.5 text-[13px] font-semibold text-brand hover:underline"
            />
          </div>
        ) : null}

        {apertura.fase === "lista" && apertura.embed ? (
          <div className="mt-3.5">
            {/* La casilla de «guardar esta tarjeta» ya NO está aquí: la pinta
                Stripe dentro de este formulario (D-3), porque con el formulario
                montado al llegar la Session existe antes de que nadie pueda
                marcarla. Ver `lib/payments/stripe-provider.ts`. */}
            <StripeEmbed {...apertura.embed} onChange={alCambiar} />
          </div>
        ) : null}

        {/* El aviso solo cuando el cobro ES simulado. Dejarlo fijo fue un bug
            real: al encender Stripe, la pantalla seguía diciendo que no se movía
            dinero mientras el botón llevaba a una pasarela de verdad. */}
        {simulado ? (
          <p className="mt-4 rounded-lg bg-warning-muted px-4 py-3 text-[13px] text-warning">
            Entorno de pruebas: el cobro está simulado, no se mueve dinero real.
          </p>
        ) : null}

        {/* Con el proveedor simulado no hay formulario que montar, así que el
            botón se queda. Con Stripe el botón de pagar lo pinta él dentro del
            iframe: uno nuestro aquí abriría un segundo cobro sobre la misma
            reserva. */}
        {apertura.fase === "lista" && !apertura.embed ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              className="h-[49px] rounded-[10px] px-6 font-semibold"
              disabled={pagando}
              onClick={() => confirmarSimulado(true)}
            >
              {pagando
                ? "Procesando…"
                : `Confirmar pago · ${formatMoney(total, currency)}`}
            </Button>
            {/* Simular fallo solo tiene sentido con el proveedor simulado: con
                Stripe el rechazo lo decide la pasarela. */}
            {simulado ? (
              <Button
                variant="outline"
                className="h-[49px] rounded-[10px] px-6"
                disabled={pagando}
                onClick={() => confirmarSimulado(false)}
              >
                Simular fallo
              </Button>
            ) : null}
          </div>
        ) : null}
      </PanelCard>
    </div>
  );
}
