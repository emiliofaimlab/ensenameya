"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * CONECTAR LA CUENTA DE PAYPAL, en un botón.
 *
 * ── POR QUÉ ESTO VA ENCIMA DEL FORMULARIO Y NO DEBAJO ───────────────────────
 *
 * Porque es el camino que funciona, y el de teclear el correo es el que puede
 * fallar en silencio. Medido el 4-sep-2026: cuatro payouts a un correo, cuatro
 * `UNCLAIMED`; el mismo pago al id de la cuenta, `SUCCESS` al instante. Un
 * correo solo entrega si está confirmado en PayPal, y eso no se puede
 * comprobar cuando el tutor lo escribe — se descubre semanas después, cuando el
 * dinero vuelve.
 *
 * ⚠️ Y DESDE EL 8-SEP-2026 NO HAY FORMULARIO DEBAJO. Aquí ponía que «se deja
 * el formulario igualmente: quien no quiera conectar su cuenta tiene que poder
 * cobrar», y esa frase describía una salida que no salía a ningún sitio: el
 * pago al correo tecleado se queda `UNCLAIMED` y vuelve a los 30 días. Ofrecer
 * las dos vías no era dar una alternativa, era dejar elegir la que no entrega.
 * La tarjeta de PayPal es ahora este botón y nada más.
 */
export function PaypalConectar({
  conectada,
  compacto = false,
}: {
  conectada: boolean;
  /**
   * En la lista de métodos la tarjeta ya explica qué es PayPal y en qué moneda
   * se cobra, así que aquí sobra el recuadro con su párrafo: se queda el botón,
   * que es la acción. Sin este modo el mismo texto salía dos veces seguidas.
   */
  compacto?: boolean;
}) {
  const [cargando, setCargando] = useState(false);

  async function conectar() {
    setCargando(true);
    try {
      const res = await fetch("/api/tutor/paypal-connect", { method: "POST" });
      const datos = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !datos.url) {
        toast.error(datos.error ?? "No se pudo abrir PayPal");
        return;
      }
      // Misma pestaña: PayPal vuelve a /tutor/payouts al terminar, y una
      // pestaña nueva dejaría esta mintiendo hasta que se recargue.
      window.location.href = datos.url;
    } catch {
      toast.error("No se pudo contactar con PayPal");
    } finally {
      setCargando(false);
    }
  }

  if (compacto) {
    return (
      <Button
        className="h-11 rounded-[8px] px-4"
        onClick={conectar}
        disabled={cargando}
        variant={conectada ? "outline" : "default"}
      >
        {cargando ? "Abriendo…" : conectada ? "Cambiar cuenta" : "Conectar"}
      </Button>
    );
  }

  return (
    <div className="mt-3 max-w-[620px] rounded-[10px] border border-[#d8e4f5] bg-[#f4f8ff] p-4">
      <p className="text-[13.5px] font-semibold text-[#19191f]">
        {conectada ? "Tu cuenta de PayPal está conectada" : "Conecta tu cuenta de PayPal"}
      </p>
      <p className="mt-1 text-[13px] text-[#6b6b6b]">
        {conectada
          ? "Te pagamos directamente a esa cuenta. Si quieres cobrar en otra, vuelve a conectarla."
          : "Entras en PayPal una vez y nos dices que sí. Es la forma segura: si escribes el correo a mano y no coincide con el de tu cuenta, el pago se queda esperando y vuelve a los 30 días sin que llegue."}
      </p>
      <Button className="mt-3" onClick={conectar} disabled={cargando} variant={conectada ? "outline" : "default"}>
        {cargando ? "Abriendo PayPal…" : conectada ? "Conectar otra cuenta" : "Conectar con PayPal"}
      </Button>
    </div>
  );
}
