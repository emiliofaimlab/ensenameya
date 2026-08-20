import { cn } from "@/lib/utils";

/**
 * El rótulo, en UN solo sitio. Lo usan la sala, el botón de grabación y la
 * cabecera del .txt del chat, y tienen que decir exactamente lo mismo: el
 * número solo sirve si quien llama por teléfono y quien atiende lo llaman
 * igual. Ojo con "abreviarlo" a algo como RN-xx o US-xx: esos son códigos
 * NUESTROS y no significan nada para un alumno.
 */
export const NRO_SESION_LABEL = "N.º de sesión";

/**
 * N-27 · el "N.º de sesión" visible (`7K3M9Q-2`).
 *
 * Lo pidió el cliente para «hacerle seguimiento a las transacciones»: la mitad
 * izquierda es la referencia de la reserva —y por tanto la del cobro, porque
 * `payments` es 1:1 con `bookings`— y el sufijo es la clase dentro del paquete.
 *
 * Sin `"use client"` a propósito: esto no tiene estado ni eventos y lo pintan
 * tanto Server Components (las pantallas de reserva) como componentes de
 * cliente (la sala). Marcarlo de cliente obligaría a los primeros a arrastrar
 * un bundle para escribir seis caracteres.
 *
 * Devuelve `null` si no hay número: las reservas anteriores a la migración
 * `20260817140000` pueden no tenerlo, y la pantalla ya rotula "Sesión 1 · 2 ·
 * 3" por su cuenta.
 */
export function SessionRef({
  nro,
  className,
}: {
  nro: string | null | undefined;
  className?: string;
}) {
  if (!nro) return null;

  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 text-[11px] text-muted-foreground",
        className,
      )}
      title="Ten este número a mano para cualquier consulta sobre esta sesión o su pago."
    >
      {NRO_SESION_LABEL}
      {/* `select-all`: un clic selecciona los seis caracteres enteros. Se copia
          para pegarlo en un correo o en una hoja de cálculo, y a mano se falla
          justo en el guion. */}
      {/* ⚠️ `whitespace-nowrap`: el número lleva un guion, y sin esto el
          navegador lo trata como punto de corte válido. En la cabecera de la
          sala a 375px se partía en dos líneas —"YKGF43-" arriba y "1" abajo—,
          que es exactamente el sitio donde alguien lo está leyendo en voz alta
          por teléfono a soporte. */}
      <code className="select-all whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-foreground">
        {nro}
      </code>
    </span>
  );
}
