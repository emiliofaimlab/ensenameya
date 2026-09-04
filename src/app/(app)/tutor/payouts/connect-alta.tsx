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
export function ConnectAlta({ yaTieneCuenta }: { yaTieneCuenta: boolean }) {
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

  return (
    <div className="mt-3 max-w-[620px]">
      <p className="text-[13px] text-[#6b6b6b]">
        Tu dinero sale por Stripe. Para recibirlo tienes que darte de alta en
        ellos una vez: te pedirán tus datos y tu cuenta bancaria{" "}
        <strong className="font-semibold text-[#19191f]">
          directamente a ti
        </strong>
        , y nosotros no llegamos a verlos.
      </p>
      <Button className="mt-3" onClick={abrir} disabled={cargando}>
        {cargando
          ? "Abriendo…"
          : yaTieneCuenta
            ? "Continuar el alta en Stripe"
            : "Darme de alta en Stripe"}
      </Button>
    </div>
  );
}
