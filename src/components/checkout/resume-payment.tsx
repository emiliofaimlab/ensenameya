"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";
import { DlocalEmbed } from "@/components/checkout/dlocal-embed";
import { HoldCountdown } from "@/components/checkout/hold-countdown";
import {
  SelectorDeCredito,
  type CambioDeCredito,
} from "@/components/checkout/selector-de-credito";
import {
  ConfirmarConCredito,
  hayQueElegirCredito,
} from "@/components/checkout/confirmar-con-credito";
import {
  interpretar,
  irAPagar,
  type DlocalTransparente,
  type RespuestaDeCobro,
} from "@/components/checkout/respuesta-de-cobro";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Igual que en el checkout: primero se abre el cobro, luego se pinta. */
type Apertura =
  | { fase: "abriendo" }
  /**
   * El alumno tiene crédito que aplicar (o quitar) y el cobro TODAVÍA NO SE HA
   * ABIERTO. Es la única ventana en la que se puede tocar: ver el porqué en
   * `hayQueElegirCredito`.
   */
  | { fase: "eligiendo" }
  | { fase: "error"; mensaje: string }
  | { fase: "simulado"; retencionHasta: string | null }
  | { fase: "lista"; retencionHasta: string | null; embed: Embed }
  /** dLocal transparente: sus campos de tarjeta, dentro de esta pantalla. */
  | {
      fase: "transparente";
      retencionHasta: string | null;
      transparente: DlocalTransparente;
    }
  /** El crédito cubre el total: no hay pasarela, hay un botón de confirmar. */
  | { fase: "credito"; retencionHasta: string | null; creditoTotal: number };

/**
 * "Pagar ahora" de una reserva que se quedó a medias.
 *
 * Antes solo se podía pagar en el mismo viaje en que se creaba la reserva: si
 * alguien cerraba la pestaña o volvía atrás en el checkout, la reserva quedaba
 * en `pending_payment` reteniendo el horario y la única acción ofrecida era
 * cancelarla. Detectado usando la app el 12-ago.
 *
 * N-37 · desde el 17-ago NO se monta dentro del detalle de la reserva: vive en
 * `/reservas/<id>/pagar`, dentro del grupo `(checkout)`, sin cabecera ni menú
 * ni chat, igual que el checkout de una reserva nueva. Dos pantallas de cobro
 * con dos aspectos distintos era peor que no aislar ninguna.
 *
 * D-2/D-3 (§20.14) · y desde hoy tampoco hay puerta: ni casilla de «guardar
 * tarjeta» —la pinta Stripe dentro de su formulario— ni botón «Pagar ahora»
 * que la abra. El formulario se monta al llegar, como en el checkout. Aquí el
 * cambio es barato y por eso va junto: **la reserva YA existe**, así que montar
 * al llegar no retiene ningún horario que no estuviera retenido. Lo caro de D-2
 * —crear la reserva por visita— es problema de la otra pantalla, no de esta.
 * Van las dos o el producto se queda con dos formularios de pago distintos.
 *
 * NO crea nada: reutiliza la reserva que ya existe. `create_booking` no se
 * llama aquí —eso es lo que la duplicaría—; el Route Handler acepta el
 * `bookingId` y él mismo rechaza con 409 si ya no está en `pending_payment`
 * (pagada por otra pestaña, cancelada o expirada), así que dos pestañas
 * abiertas no pueden cobrar dos veces.
 *
 * ⚠️ 💳 Y DESDE HOY «AL LLEGAR» TIENE UNA EXCEPCIÓN: si el alumno tiene crédito
 * para esta reserva, el formulario espera. No es una pausa de cortesía —es que
 * abrir el cobro sella `payments.checkout_amount` y a partir de ahí ni se puede
 * aplicar un crédito ni quitar el que hubiera (los dos cerrojos de
 * `20260912110000` §8). Quien no tiene ningún crédito, que son casi todos, no
 * nota nada: el selector no se pinta y el cobro se abre igual que siempre.
 */
export function ResumePayment({ bookingId }: { bookingId: string }) {
  const [apertura, setApertura] = useState<Apertura>({ fase: "abriendo" });
  /**
   * Lo último que ha dicho el selector. `null` = todavía no ha dicho nada, o
   * sea que aún está leyendo: de eso depende que «Continuar al pago» esté
   * apagado, para que nadie abra el cobro un segundo antes de ver su crédito.
   */
  const [credito, setCredito] = useState<CambioDeCredito | null>(null);
  // Qué reserva se abrió ya. Con la clave dentro y no un booleano, StrictMode
  // no abre dos veces y una navegación a OTRA reserva sí vuelve a abrir.
  const abiertoPara = useRef<string | null>(null);
  /**
   * Ya se tomó la decisión inicial (abrir de una, o esperar al alumno). Existe
   * por una carrera concreta: el selector puede avisar de que el crédito cubre
   * el total ANTES de que termine la consulta de abajo, y entonces la respuesta
   * tardía de esa consulta no debe devolver la pantalla a la elección.
   */
  const decidido = useRef(false);
  /**
   * Ya se abrió el cobro por el camino sin pasarela. Aquí el selector no se
   * desmonta al pasar a la fase "credito" —así que no se relee y no vuelve a
   * avisar—, pero el candado va igual: es lo único que separa «el crédito cubre
   * el total» de un bucle de POST a `/api/pagos/checkout` si un día alguien
   * cambia la condición con la que se monta.
   */
  const sinPasarela = useRef(false);

  /**
   * Abre el cobro y traduce la respuesta. Se llama desde dos sitios —al llegar,
   * cuando no hay nada que elegir, y al pulsar «Continuar al pago»— y por eso
   * está fuera del efecto.
   */
  const abrirCobro = useCallback(async (id: string) => {
    setApertura({ fase: "abriendo" });
    const res = await fetch("/api/pagos/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: id }),
    });
    const salida = (await res.json().catch(() => ({}))) as RespuestaDeCobro;

    if (!res.ok) {
      setApertura({
        fase: "error",
        mensaje: salida.error ?? "No se pudo abrir el pago.",
      });
      return;
    }

    // A2 · qué hacer con la respuesta lo decide `interpretar`, una vez y para
    // las tres pantallas. Antes esto era un `if (clientSecret) … else
    // simulado`, y ese `else` convertía un cobro por redirección en la
    // pantalla de pruebas.
    const accion = interpretar(salida);
    const retencionHasta = salida.retencionHasta ?? null;

    if (accion.tipo === "redireccion") {
      // No se toca el estado: la pestaña se va. Dejarlo en "abriendo" es lo
      // honesto mientras el navegador navega.
      irAPagar(accion.url);
      return;
    }
    if (accion.tipo === "embebido") {
      setApertura({ fase: "lista", retencionHasta, embed: accion.embed });
      return;
    }
    // dLocal, dentro de la pantalla. Va en el MISMO commit que las otras dos
    // pantallas de cobro: dejar una atrás deja dos formularios distintos para
    // el mismo producto.
    if (accion.tipo === "transparente") {
      setApertura({ fase: "transparente", retencionHasta, transparente: accion.transparente });
      return;
    }
    // 💳 No hay a quién pagar: el crédito cubre el total. Sin esta rama la
    // respuesta caía al `default` de abajo y la mentoría gratis era incanjeable.
    if (accion.tipo === "credito") {
      setApertura({ fase: "credito", retencionHasta, creditoTotal: accion.creditoTotal });
      return;
    }
    if (accion.tipo === "simulado") {
      setApertura({ fase: "simulado", retencionHasta });
      return;
    }
    setApertura({ fase: "error", mensaje: accion.mensaje });
  }, []);

  /**
   * Lo que dice el selector cada vez que cambia algo (y una primera vez al
   * terminar su lectura, también cuando no hay ningún crédito).
   *
   * ⚠️ EL COBRO SOLO SE ABRE EN UN CASO: cuando el crédito cubre el total.
   * Ese camino de `/api/pagos/checkout` devuelve `modo: 'credito'` y **no llama
   * a `marcar_cobro_abierto`** (está escrito en su propio comentario, y es a
   * propósito): no queda ningún cobro sellado, así que el alumno puede seguir
   * quitando el crédito si se equivocó. Con un crédito PARCIAL no se abre nada
   * hasta que él lo pida, porque ahí el marcador sí se sella y quitarlo después
   * ya no se podría.
   */
  const alCambiarElCredito = useCallback(
    (cambio: CambioDeCredito) => {
      setCredito(cambio);
      if (cambio.tipo === "aplicado" && cambio.aPagar === 0) {
        if (sinPasarela.current) return;
        sinPasarela.current = true;
        decidido.current = true;
        void abrirCobro(bookingId);
        return;
      }
      // Volvió a haber algo que cobrar (quitó el crédito, o aplicó uno parcial):
      // el candado se suelta para que el siguiente «cubre el total» sí abra.
      sinPasarela.current = false;
      // Quitó el crédito estando ya en el bloque de confirmar: vuelta a elegir.
      setApertura((previo) =>
        previo.fase === "credito" ? { fase: "eligiendo" } : previo,
      );
    },
    [abrirCobro, bookingId],
  );

  useEffect(() => {
    if (abiertoPara.current === bookingId) return;
    abiertoPara.current = bookingId;

    void (async () => {
      const preguntar = await hayQueElegirCredito(createClient(), bookingId);
      // El selector ya decidió por su cuenta mientras esto viajaba.
      if (decidido.current) return;
      decidido.current = true;
      if (preguntar) {
        setApertura({ fase: "eligiendo" });
        return;
      }
      await abrirCobro(bookingId);
    })();
  }, [bookingId, abrirCobro]);

  /**
   * El selector se monta desde el primer render y NO solo en la fase de elegir:
   * así su lectura viaja en paralelo con la de `hayQueElegirCredito` en vez de
   * detrás, que serían dos idas antes del formulario en lugar de una.
   *
   * Y desaparece en cuanto hay pasarela montada, que es lo contrario de un
   * descuido: con el cobro abierto, sus dos botones solo saben fallar contra el
   * cerrojo. Lo que queda en su lugar es la línea de «tu crédito ya está
   * aplicado», que informa sin prometer nada.
   */
  const eligiendoTodavia =
    apertura.fase === "abriendo" ||
    apertura.fase === "eligiendo" ||
    apertura.fase === "credito";

  const creditoAplicado = credito?.tipo === "aplicado" ? credito.cubre : 0;

  return (
    <>
      {apertura.fase !== "abriendo" &&
      apertura.fase !== "eligiendo" &&
      apertura.fase !== "error" ? (
        <HoldCountdown hasta={apertura.retencionHasta} className="mt-3.5" />
      ) : null}

      {eligiendoTodavia ? (
        <SelectorDeCredito
          bookingId={bookingId}
          onCambio={alCambiarElCredito}
          className="mt-3.5"
        />
      ) : null}

      {apertura.fase === "abriendo" ? (
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]" aria-live="polite">
          Abriendo tu pago seguro…
        </p>
      ) : null}

      {/* La puerta que el crédito obliga a poner. Apagada mientras el selector
          no haya hablado: pulsar antes abriría el cobro —y lo sellaría— justo
          antes de que apareciera el crédito que se podía aplicar. */}
      {apertura.fase === "eligiendo" ? (
        <div className="mt-4">
          {/* El selector no pinta nada mientras lee, así que sin esta línea
              aquí habría un botón apagado y ninguna explicación. */}
          {credito === null ? (
            <p className="mb-3 text-[13px] text-[#6b6b6b]" aria-live="polite">
              Comprobando tus créditos…
            </p>
          ) : null}
          <Button
            type="button"
            className="h-[49px] w-full rounded-[10px] px-6 font-semibold sm:w-auto"
            disabled={credito === null}
            onClick={() => void abrirCobro(bookingId)}
          >
            Continuar al pago
          </Button>
          <p className="mt-2 text-[12.5px] text-[#6b6b6b]">
            Tu horario sigue retenido mientras eliges. Después de continuar ya
            no podrás cambiar el crédito de esta reserva.
          </p>
        </div>
      ) : null}

      {apertura.fase === "error" ? (
        <p role="alert" className="mt-3.5 text-[13px] text-destructive">
          {apertura.mensaje}
        </p>
      ) : null}

      {/* Ruteo simulado (`payment_routing_rules` en 'simulated'): no hay Session
          que abrir. Aquí NO se llama a `confirm_simulated_payment` a propósito —
          sería un segundo camino de dinero escrito para un proveedor de mentira—,
          así que se dice lo que va a pasar de verdad: la reserva caduca sola y se
          vuelve a reservar. Va como texto y ya no como `toast`: el aviso salía
          al pulsar un botón que ya no existe, y un toast que aparece solo al
          cargar la pantalla se lo pierde quien mire un segundo tarde. */}
      {apertura.fase === "simulado" ? (
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]">
          Este cobro está ruteado al proveedor simulado y no se puede retomar. La
          reserva se libera sola y podrás volver a reservar el horario.
        </p>
      ) : null}

      {/* 💳 El crédito lo paga todo. El botón es de aquí y no del selector: lo
          que hace es COMPRAR, y esa decisión no puede colgar de la misma llamada
          que se dispara al entrar en la pantalla.

          Sin `importe`: esta pantalla no maneja precios —no recibe ni el total
          ni la moneda— y una cifra inventada aquí sería peor que ninguna. */}
      {apertura.fase === "credito" ? (
        <ConfirmarConCredito
          sujeto={{ tipo: "booking", id: bookingId }}
          destino={`/reservas/${bookingId}/confirmacion`}
          etiqueta="Confirmar reserva"
          className="mt-3.5"
        />
      ) : null}

      {/* Con la pasarela ya montada el selector se fue, así que lo que se cobra
          ahí abajo NO es el total de la reserva y en esta pantalla no hay ningún
          sitio donde se vea. Esta línea es ese sitio.

          Sin cifra, por lo mismo que el bloque de arriba: aquí no hay moneda con
          la que formatear. Quien quiera el desglose lo tiene en el detalle de la
          reserva. */}
      {!eligiendoTodavia && creditoAplicado > 0 ? (
        <p className="mt-3.5 text-[13px] text-[#4b4b4b]">
          Tu crédito ya está aplicado a esta reserva: abajo solo se cobra la
          diferencia.
        </p>
      ) : null}

      {apertura.fase === "lista" ? (
        <div className="mt-3.5">
          <StripeEmbed {...apertura.embed} />
        </div>
      ) : null}

      {apertura.fase === "transparente" ? (
        <div className="mt-3.5">
          <DlocalEmbed
            sujeto={{ tipo: "booking", id: bookingId }}
            {...apertura.transparente}
            returnUrl={`/reservas/${bookingId}/confirmacion`}
          />
        </div>
      ) : null}
    </>
  );
}
