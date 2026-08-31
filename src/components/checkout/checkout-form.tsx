"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightIcon } from "lucide-react";
import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";
import { HoldCountdown } from "@/components/checkout/hold-countdown";
import { ChangeSlotLink } from "@/components/checkout/change-slot-link";
import { PaymentPolicy } from "@/components/checkout/payment-policy";
import { DatosInvitado } from "@/components/checkout/datos-invitado";

import { createClient } from "@/lib/supabase/client";
import {
  buscarReservaDelAlumno,
  esCarreraDeHorario,
  holdsQueSolapan,
  liberarHolds,
  mensajeDeApertura,
} from "@/lib/checkout/hold";
import { formatMoney } from "@/lib/catalog/format";
import { formatSessionTime, type TutorCardData } from "@/lib/booking";
import { TutorSummary } from "@/components/tutor-summary";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";

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
 * checkout alojado.
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
  tutor,
  packageLabel,
  incluye,
  precioPorSesion,
  durationMin,
  timeZone,
  simulado,
  aceptaSola,
}: {
  productId: string;
  /**
   * El alumno, resuelto en servidor. Se usa para acotar la búsqueda de la
   * reserva en curso, y NO es decorativo: `bookings_select_tutor` deja que un
   * tutor lea las reservas de sus propias mentorías, así que sin este filtro un
   * tutor que abriera el checkout de su propia clase podría «reutilizar» la
   * reserva a medias de un alumno suyo.
   *
   * ⚠️ `null` = CHECKOUT DE INVITADO: quien mira esta pantalla no tiene cuenta.
   * Entonces no se abre nada —ni reserva ni cobro— y en su lugar se pinta
   * «Tus datos» (`DatosInvitado`). Cuando esa alta termina, la pantalla se
   * RECARGA y este mismo prop llega ya con el id desde el servidor; solo
   * entonces arranca el camino de siempre. Esa espera es todo el cambio: sin
   * ella `create_booking` contestaría «auth requerido» antes de que el
   * comprador teclee una letra.
   */
  studentId: string | null;
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
  /**
   * V-6 · El tutor con lo justo para reconocerle y llegar a su ficha. Viene de
   * `getProductDetail`, o sea de la misma consulta que ya trae `tutorName` —
   * esta prop NO añade un viaje, solo deja de tirar lo que ya venía.
   *
   * Opcional por firma, pero en esta pantalla siempre llega: `getProductDetail`
   * devuelve `null` si el tutor no es legible y la página responde 404 antes.
   */
  tutor?: TutorCardData;
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

  /**
   * QUIÉN COMPRA — SIEMPRE el de la sesión de SERVIDOR, nunca un id que este
   * componente se haya guardado por su cuenta.
   *
   * ⚠️ Era estado de cliente (`useState(studentId)`) que `DatosInvitado`
   * rellenaba al terminar el alta, y esa media verdad se notaba en dos sitios a
   * la vez: la página seguía pintada como se pintó —ANÓNIMA—, así que
   * `ChangeSlotLink` conservaba `studentId={null}` y «Cambiar horario» dejaba de
   * soltar el hold (se iba como enlace pelado y el hueco propio no aparecía en
   * el selector hasta que lo expirara el cron), y la guarda de servidor no
   * volvía a correr, así que quien se autenticaba aquí con una cuenta vieja se
   * saltaba el onboarding obligatorio (RN-44) y aterrizaba en el asistente
   * DESPUÉS de pagar. Por eso el alta recarga la página entera (ver abajo) en
   * vez de continuar en cliente: el id vuelve por donde tiene que volver.
   */
  const alumnoId = studentId;

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
    /*
     * ⚠️ SIN CUENTA NO SE ABRE NADA, Y ESTE `return` VA EL PRIMERO.
     *
     * Dos motivos, los dos de fallo silencioso:
     *   · `create_booking` resuelve al alumno con `auth.uid()` y contesta «auth
     *     requerido» si es null: un invitado vería un error de sesión antes de
     *     teclear una letra, en una pantalla que le está pidiendo los datos.
     *   · Y va ANTES de `abiertoPara.current = clave` a propósito. Puesto
     *     después, la clave quedaría marcada como «ya abierta» y cuando llegara
     *     la sesión el efecto saldría por el `return` de la línea siguiente: el
     *     pago no se abriría NUNCA. Eso no lo ve el typecheck.
     */
    if (!alumnoId) return;
    if (abiertoPara.current === clave) return;
    abiertoPara.current = clave;

    // `alumnoId` entra por parámetro y no por cierre: `abrir` es una
    // declaración de función y se iza, así que el estrechamiento del `return`
    // de arriba no le llega y `studentId` seguiría siendo `string | null`.
    async function abrir(alumnoId: string) {
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
        studentId: alumnoId,
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
          studentId: alumnoId,
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
                studentId: alumnoId,
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
    // reserva la libera `expire_stale_bookings` a los 7 minutos, no el
    // navegador. Y sin abortar la petición a medias: si el desmontaje llegara
    // entre `create_booking` y el checkout, cortar dejaría la reserva creada y
    // sin cobro abierto, que es peor que terminar y no pintar nada.
    void abrir(alumnoId);
  }, [clave, productId, slots, alumnoId, tutorId, durationMin, router]);

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

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
      {/* Columna izquierda del Figma: el resumen del pedido. */}
      <div className="flex flex-col gap-5">
        {/*
          B3.6 · el resumen, agrandado. No es «más letra por gusto»: con
          `ui_mode:'form'` Stripe pinta SOLO los campos de pago (MN-01), así que
          esta tarjeta es **lo único** que dice qué se está comprando. Estaba
          escrita a 12-13 px, más pequeña que el propio formulario de al lado,
          que es al revés de lo que importa.

          Sube en tres sitios y ninguno es cosmético: el título de la mentoría
          (que es el QUÉ), la lista de horarios (que es el CUÁNDO, y es el dato
          que el alumno vuelve a mirar antes de pagar) y el total. La política
          de cancelación y el «con Fulanito» se quedan como estaban: son
          contexto, y subirlos todos a la vez es no subir ninguno.

          El aire de la tarjeta pasa a 24 px en pantallas ≥ 640 (`sm:p-6`); por
          debajo se queda en los 20 de `PanelCard`, que en un móvil ya son los
          que hacen falta.
        */}
        <PanelCard className="sm:p-6">
          <PanelCardTitle className="text-[17px]">
            Resumen del pedido
          </PanelCardTitle>
          <div className="mt-4">
            <p className="text-base font-semibold text-balance text-[#19191f]">
              {productTitle}
            </p>
            <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
              con {tutorName} · {packageLabel}
              {incluye ? ` · ${incluye}` : ""}
            </p>
          </div>

          {/* V-6 · La salida hacia la ficha del tutor, que aquí no existía: se
              compraba a nombre de alguien del que solo se leía el nombre. En
              variante `inline` porque esta pantalla se recortó a propósito
              (MN-01, «solo los inputs de la tarjeta») y una ficha entera sería
              deshacerlo. */}
          {tutor ? (
            <div className="mt-4 border-t border-[#e0e0e0] pt-4">
              <TutorSummary tutor={tutor} variant="inline" />
            </div>
          ) : null}

          {/* 🐛 RN-01/RN-02 · con la zona del alumno, no con la del servidor ni
              con la del navegador. Sin `timeZone` esta lista podía enseñar una
              hora distinta de la que se eligió en el calendario, que sí usa la
              del perfil. Es el mismo helper que la pantalla hermana: la lógica
              de zona horaria vive en UN sitio a propósito — duplicarla es como
              se rompió la última vez. */}
          <ul className="mt-4 flex flex-col gap-2 border-t border-[#e0e0e0] pt-4 text-[13px] text-[#333333]">
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

          <div className="mt-4 flex items-center justify-between border-t border-[#e0e0e0] pt-4 text-sm">
            <span className="text-[#6b6b6b]">Subtotal</span>
            <span className="text-[#333333]">{formatMoney(total, currency)}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-base font-semibold text-[#19191f]">Total</span>
            <span className="text-[26px] leading-none font-bold text-brand">
              {formatMoney(total, currency)}
            </span>
          </div>
          {/* Solo en paquetes: en una sesión suelta el precio por sesión ES el
              total y repetirlo sería ruido. */}
          {precioPorSesion ? (
            <p className="mt-1.5 text-right text-xs text-[#6b6b6b]">
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
            className="mt-4 border-t border-[#e0e0e0] pt-4"
          />
        </PanelCard>
      </div>

      {/* Columna derecha: el formulario de Stripe, embebido (sin PAN nuestro). */}
      <PanelCard>
        <PanelCardTitle className="text-[15px]">
          {alumnoId ? "Método de pago" : "Tus datos"}
        </PanelCardTitle>

        {/* CHECKOUT DE INVITADO · el alta ocupa el sitio del formulario de pago
            hasta que la cuenta existe, y va en ESTA columna y no en otra: la de
            la izquierda es lo ÚNICO que dice qué se está comprando (MN-01) y no
            se toca.

            Nada de lo de abajo se pinta mientras tanto —ni el contador ni el
            «Preparando tu pago seguro…»— porque sería mentira: no hay reserva,
            no hay horario retenido y no hay ningún cobro preparándose. Todo eso
            arranca tras la recarga, ya con el alumno resuelto en servidor. */}
        {!alumnoId ? (
          <DatosInvitado
            onCuentaLista={() => {
              /*
               * ⚠️ RECARGA ENTERA, y no `setAlumnoId` ni `router.refresh()`.
               *
               * La sesión ya está en las cookies, pero ESTA página se renderizó
               * en servidor cuando aún no había ninguna: se pintó sin pasar por
               * `requireUser()` y con `studentId={null}` por todas partes. Al
               * recargar, el render de servidor vuelve a ocurrir CON sesión y
               * eso arregla las dos cosas de golpe: corre la guarda de siempre
               * —onboarding obligatorio (RN-44), rama de tutor y `?next=` con la
               * query, sin reescribir aquí ninguna de las tres— y
               * `ChangeSlotLink` recibe el alumno de verdad, así que «Cambiar
               * horario» vuelve a soltar el hold.
               *
               * `router.refresh()` NO vale: no reinicia el estado de cliente, y
               * era justo ese estado el que mentía.
               */
              window.location.reload();
            }}
            className="mt-3.5"
          />
        ) : null}

        {/* D-2 · el contador. Va arriba del formulario y no escondido en el
            resumen: es la contrapartida de que el horario se retenga por
            visita, y una advertencia que no se ve no advierte. */}
        {apertura.fase === "lista" ? (
          <HoldCountdown hasta={apertura.retencionHasta} className="mt-3.5" />
        ) : null}

        {alumnoId && apertura.fase === "abriendo" ? (
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
                falta justo su hueco.

                ⚠️ En el checkout de invitado esta rama es MÁS probable que
                antes: la reserva se pide al terminar el alta, no al llegar, así
                que entre medias alguien puede haberse llevado el horario y el
                comprador se queda con una cuenta que no venía a crear. El
                mensaje ya lo dice (`mensajeDeApertura`) y aquí `alumnoId` sí
                existe, que es lo que hace que se pueda soltar el hold. */}
            <ChangeSlotLink
              productId={productId}
              studentId={alumnoId}
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
            <StripeEmbed {...apertura.embed} />
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
