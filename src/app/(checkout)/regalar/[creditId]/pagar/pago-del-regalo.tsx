"use client";

import { useEffect, useRef, useState } from "react";

import { StripeEmbed, type Embed } from "@/components/checkout/stripe-embed";
import {
  interpretar,
  irAPagar,
  type RespuestaDeCobro,
} from "@/components/checkout/respuesta-de-cobro";
import { PrecioEnLinea } from "@/components/precio/precio";
import { COMPANY } from "@/lib/company";

/** Igual que en las otras tres pantallas de pago: primero se abre, luego se pinta. */
type Apertura =
  | { fase: "abriendo" }
  | { fase: "error"; mensaje: string }
  | { fase: "lista"; embed: Embed };

/**
 * US-REG · ABRE EL COBRO DE UN REGALO Y MONTA EL FORMULARIO.
 *
 * ⚠️ **NO ES OTRO CHECKOUT.** La respuesta de `/api/pagos/checkout` la traduce
 * `interpretar()` —la misma función que usan `checkout-form`, `resume-payment`
 * y `order-payment`—, y por el mismo motivo que se escribió: con dos
 * proveedores, el `else` de «si no hay `clientSecret`, camino simulado» pinta el
 * botón de «simular pago» **encima de un cobro real**. El caso por defecto aquí
 * es ERROR VISIBLE, nunca un checkout de mentira (ver `respuesta-de-cobro.ts`).
 *
 * ⚠️ **EL IMPORTE NO SALE DE AQUÍ.** `total` es solo lo que se pinta; lo que se
 * cobra lo compone el Route Handler leyendo `credits.amount`, que congeló
 * `comprar_regalo` (regla de oro 2). Este componente no suma nada y no manda
 * ninguna cifra.
 *
 * ── EL SUJETO DEL COBRO, Y LO QUE TODAVÍA NO LLEGA ─────────────────────────
 *
 * `/api/pagos/checkout` acepta TRES sujetos excluyentes: `bookingId`, `orderId`
 * y `regaloId` (un `credits.id`), y admite `creditId` como alias de este último
 * —es el nombre que usa la RPC, `p_credit_id`—. Se manda `creditId` por eso; si
 * algún día sobra el alias, se quita allí y esta es la única línea que habría
 * que tocar aquí. Lo que ese handler hace por dentro son las RPC del regalo:
 * `marcar_cobro_regalo_abierto` (el sello del cerrojo, hermano de
 * `marcar_cobro_abierto` para un sujeto sin reserva), `marcar_cobro_regalo` (la
 * referencia del PSP, que dLocal necesita ANTES de redirigir) y, desde el
 * webhook, `confirm_gift_payment`.
 *
 * ⚠️ **dLOCAL TRANSPARENTE: HOY SALE AL CHECKOUT ALOJADO.** `DlocalEmbed` tipa
 * su `sujeto` como `{ tipo: "booking" | "order" }` y `/api/pagos/confirmar-dlocal`
 * resuelve exactamente esos dos; un regalo no es ninguno de los dos, así que
 * montarlo aquí sería pintar un formulario cuya confirmación no existe. Mientras
 * ese sujeto no llegue a esos dos ficheros, un `modo: 'transparente'` se va por
 * su `redirectUrl` —que la propia respuesta declara como salida de respaldo— y
 * el regalo se paga fuera del sitio. Se pierde el dictado §2 para este caso
 * concreto; no se pierde el cobro, que es lo que se estaría perdiendo con la
 * otra decisión.
 *
 * ⚠️ **SIN CAMINO SIMULADO, A PROPÓSITO.** No existe ningún
 * `confirm_simulated_gift_payment`, y no es un olvido: `confirm_simulated_payment`
 * «está muerta en toda la plataforma» y no se reabre (`20260912110000` §8.4 —
 * es el agujero que documenta `20260901140000`). Si el ruteo devolviera
 * `modo: 'simulado'` para un regalo, esta pantalla lo dice en vez de pintar un
 * botón que no puede confirmar nada.
 */
export function PagoDelRegalo({
  creditId,
  total,
  currency,
}: {
  creditId: string;
  /** Solo para las frases de esta pantalla. El cobro real no lo mira. */
  total: number;
  currency: string;
}) {
  const [apertura, setApertura] = useState<Apertura>({ fase: "abriendo" });
  // Qué regalo se abrió ya. Con la clave dentro y no un booleano, StrictMode no
  // abre dos veces y navegar a OTRO regalo sí vuelve a abrir.
  const abiertoPara = useRef<string | null>(null);

  useEffect(() => {
    if (abiertoPara.current === creditId) return;
    abiertoPara.current = creditId;

    async function abrir() {
      setApertura({ fase: "abriendo" });

      let res: Response;
      try {
        res = await fetch("/api/pagos/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // 🔴 El sujeto del regalo, excluyente con `bookingId` y `orderId`.
          // `creditId` es el alias que ese handler acepta para `regaloId`: ver
          // el bloque de la cabecera antes de renombrarlo.
          body: JSON.stringify({ creditId }),
        });
      } catch {
        // `fetch` RECHAZA —no devuelve `!res.ok`— ante un corte de red o el
        // salto de datos a wifi, que es el caso normal de pagar desde el móvil.
        // Sin este `try` la promesa quedaba sin capturar y la pantalla se
        // quedaba en «Preparando tu pago seguro…» para siempre.
        setApertura({
          fase: "error",
          mensaje: "No pudimos conectar con el pago. Revisa tu conexión y recarga la página.",
        });
        return;
      }

      const salida = (await res.json().catch(() => ({}))) as RespuestaDeCobro;

      if (!res.ok) {
        setApertura({
          fase: "error",
          mensaje: salida.error ?? "No se pudo abrir el pago de este regalo.",
        });
        return;
      }

      const accion = interpretar(salida);

      if (accion.tipo === "redireccion") {
        irAPagar(accion.url);
        return;
      }
      if (accion.tipo === "embebido") {
        setApertura({ fase: "lista", embed: accion.embed });
        return;
      }
      // dLocal transparente → su checkout alojado, mientras el sujeto del
      // regalo no exista en `DlocalEmbed` ni en `/api/pagos/confirmar-dlocal`.
      // Ver el bloque ⚠️ de la cabecera: es la salida de respaldo de la propia
      // respuesta, no un invento de esta pantalla.
      if (accion.tipo === "transparente") {
        irAPagar(accion.transparente.redirectUrl);
        return;
      }
      if (accion.tipo === "credito") {
        // Un regalo no se financia con un crédito: se compra con dinero para
        // CREAR uno. Si el servidor devolviera esto sería un error de ruteo, no
        // un camino que esta pantalla deba seguir.
        setApertura({
          fase: "error",
          mensaje: `No se pudo abrir el pago de este regalo. Escríbenos a ${COMPANY.email} y lo revisamos.`,
        });
        return;
      }
      if (accion.tipo === "simulado") {
        setApertura({
          fase: "error",
          mensaje:
            "En este entorno no hay pasarela para cobrar un regalo. Prueba desde un entorno con las claves de pago configuradas.",
        });
        return;
      }
      setApertura({ fase: "error", mensaje: accion.mensaje });
    }

    void abrir();
  }, [creditId]);

  return (
    <>
      {apertura.fase === "abriendo" ? (
        <p className="mt-3.5 text-[13px] text-[#6b6b6b]" aria-live="polite">
          Preparando tu pago seguro…
        </p>
      ) : null}

      {apertura.fase === "error" ? (
        <p role="alert" className="mt-3.5 text-[13px] text-destructive">
          {apertura.mensaje}
        </p>
      ) : null}

      {apertura.fase === "lista" ? (
        <>
          <p className="mt-3.5 text-[13px] text-[#4b4b4b]">
            Vas a pagar{" "}
            <PrecioEnLinea
              amountMinor={total}
              currency={currency}
              className="font-semibold text-[#19191f]"
            />{" "}
            por este regalo.
          </p>
          <div className="mt-3.5">
            {/* La casilla de «guardar esta tarjeta» la pinta Stripe dentro del
                propio formulario (D-3), igual que en las otras tres pantallas. */}
            <StripeEmbed {...apertura.embed} />
          </div>
        </>
      ) : null}
    </>
  );
}
