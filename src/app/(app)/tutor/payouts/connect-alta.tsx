"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * EL ALTA DE LA CUENTA CONECTADA DE STRIPE, en un botón.
 *
 * ── POR QUÉ ESTA TARJETA NO ES UN FORMULARIO ────────────────────────────────
 *
 * Las otras dos familias piden datos y los guardan: el CBU de dLocal, el correo
 * de Zelle. Esta no pide nada, y no por simplificar — es que con Connect las
 * coordenadas bancarias se las da el tutor A STRIPE, en su alta, y nosotros no
 * las vemos ni las guardamos nunca. Lo único que vuelve de ahí es un
 * identificador de cuenta que escribe el servidor.
 *
 * Consecuencia práctica y buscada: este componente no tiene estado que validar,
 * ni país, ni banco, ni máscara. Tiene un botón.
 *
 * ⚠️ EL ENLACE ES DE UN SOLO USO Y CADUCA EN MINUTOS, así que se pide en el
 * momento de pulsar y no al pintar la página. Un enlace traído en el render
 * estaría muerto para cuando alguien lo mirase.
 */
export function ConnectAlta({
  yaTieneCuenta,
  lista,
  esLaUnicaVia,
  compacto = false,
}: {
  yaTieneCuenta: boolean;
  lista: boolean;
  /**
   * Mismo motivo que en `PaypalConectar`: en la lista de métodos la tarjeta ya
   * dice qué es el alta de Stripe y que los datos bancarios se los queda ellos,
   * así que aquí sobra el párrafo y se queda el botón. Con Connect NO hay
   * formulario que ofrecer —el tutor le da sus coordenadas a Stripe, no a
   * nosotros—, así que esta es literalmente la única acción de esa tarjeta.
   */
  compacto?: boolean;
  /**
   * ⚠️ ¿ES STRIPE LO ÚNICO POR LO QUE SE LE PUEDE PAGAR EN SU PAÍS?
   *
   * El texto de abajo decía «Tu dinero sale por Stripe» en absoluto, y hasta el
   * 7-sep-2026 eso era verdad siempre que este bloque se pintaba: solo aparecía
   * en los países cuya única familia era 'conectada'. Desde que la pantalla
   * pinta varias familias, esta tarjeta le sale también a Argentina, Chile,
   * Ecuador, México, Perú, Paraguay y Uruguay, **donde el primer riel de su fila
   * es dLocal y no Stripe** (`payment_routing_rules`: `dlocal>stripe>paypal>
   * wise`), y a Colombia, donde Stripe es uno de tres. Prometerle a un
   * ecuatoriano que su dinero sale por Stripe es decirle por dónde cobra
   * equivocándose de riel.
   */
  esLaUnicaVia: boolean;
}) {
  const [cargando, setCargando] = useState(false);
  const router = useRouter();

  async function abrir() {
    setCargando(true);
    try {
      const res = await fetch("/api/tutor/stripe-connect", { method: "POST" });
      const datos = (await res.json()) as {
        error?: string;
        lista?: boolean;
        url?: string;
        pendiente?: string;
      };
      if (!res.ok) {
        toast.error(datos.error ?? "No se pudo abrir el alta");
        return;
      }
      if (datos.lista) {
        toast.success("Tu cuenta ya está lista para recibir pagos");
        router.refresh();
        return;
      }
      if (datos.url) {
        // Misma pestaña: el alta de Stripe vuelve a /tutor/payouts al terminar,
        // y una pestaña nueva dejaría la vieja mintiendo hasta que se recargue.
        window.location.href = datos.url;
        return;
      }
      toast.error(datos.pendiente ?? "Stripe no devolvió un enlace de alta");
    } catch {
      toast.error("No se pudo contactar con Stripe");
    } finally {
      setCargando(false);
    }
  }

  if (compacto) {
    return (
      <Button
        className="h-11 rounded-[8px] px-4"
        onClick={abrir}
        disabled={cargando}
        variant={lista ? "outline" : "default"}
      >
        {/* §5.4 del paquete v2 fija el vocabulario de la fila: «Editar» cuando
            la cuenta ya está, «Configurar» cuando está a medias y «Conectar con
            Stripe» —literal de la captura— cuando no hay nada. Los rótulos
            anteriores («Ver en Stripe» / «Continuar alta» / «Empezar alta»)
            decían lo mismo con tres palabras distintas de las que usan las
            demás filas de métodos, que es justo lo que el paquete unifica.
            Solo cambia el MODO COMPACTO: la tarjeta grande de abajo tiene sitio
            para su propio texto y no compite con nada. */}
        {cargando
          ? "Abriendo…"
          : lista
            ? "Editar"
            : yaTieneCuenta
              ? "Configurar"
              : "Conectar con Stripe"}
      </Button>
    );
  }

  return (
    <div className="mt-3 max-w-[620px]">
      <p className="text-[13px] text-[#6b6b6b]">
        {lista ? (
          <>
            Tu cuenta de Stripe está lista y puede recibir pagos.{" "}
            {/* Mismo motivo que abajo: «tu dinero irá ahí» solo es cierto
                cuando Stripe es la única vía de su país. Donde hay varias, cuál
                se usa lo decide el enrutador al liquidar. */}
            {esLaUnicaVia
              ? "Tu dinero irá ahí en cuanto se liquide tu saldo."
              : "Es una de las vías por las que podemos pagarte."}
          </>
        ) : (
          <>
            {esLaUnicaVia
              ? "Tu dinero sale por Stripe."
              : "Por esta vía el dinero sale por Stripe."}{" "}
            Para recibirlo tienes que darte de alta en ellos una vez: te pedirán
            tus datos y tu cuenta bancaria{" "}
            <strong className="font-semibold text-[#19191f]">
              directamente a ti
            </strong>
            , y nosotros no llegamos a verlos.
          </>
        )}
      </p>
      <Button
        className="mt-3"
        onClick={abrir}
        disabled={cargando}
        variant={lista ? "outline" : "default"}
      >
        {cargando
          ? "Abriendo…"
          : lista
            ? "Ver o cambiar mi cuenta de Stripe"
            : yaTieneCuenta
              ? "Continuar el alta en Stripe"
              : "Darme de alta en Stripe"}
      </Button>
    </div>
  );
}
