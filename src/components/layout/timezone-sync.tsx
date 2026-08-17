"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import { TZ_COOKIE } from "@/lib/tz";

/**
 * Mismo criterio que `zonaConfigurada()` en `lib/auth/server.ts` (RV-03):
 * `'UTC'` no significa «vive en UTC», significa «nadie la fijó» — es el default
 * de `profiles.timezone` y el valor al que cae el servidor cuando no encuentra
 * nada. Hace falta repetirlo aquí para poder contestar la única pregunta que
 * justifica un refresco: ¿el servidor va a pintar algo DISTINTO de lo que ya
 * pintó?
 *
 * Y sí, un navegador de verdad puede devolver `'UTC'`: cualquier Linux con
 * `TZ=UTC`, los runners de CI y los rastreadores. Para ésos el servidor ya está
 * renderizando en UTC, así que refrescar es un ida y vuelta RSC entero para
 * repintar exactamente lo mismo.
 */
function zonaEfectiva(tz: string | null | undefined): string | null {
  const v = tz?.trim();
  return v && v !== "UTC" ? v : null;
}

/** Lo que hay hoy en la cookie `ey-tz`, ya decodificado (o `null`). */
function leerCookie(): string | null {
  // Se parte por ";" y se recorta cada trozo, NO por "; ": el espacio tras el
  // punto y coma es lo que escriben los navegadores por convención, no parte
  // del formato. Cualquier cookie escrita sin él dejaba a `ey-tz` pegada al
  // valor anterior y la comparación de abajo no volvía a coincidir nunca.
  for (const trozo of document.cookie.split(";")) {
    const c = trozo.trim();
    if (!c.startsWith(`${TZ_COOKIE}=`)) continue;
    const crudo = c.slice(TZ_COOKIE.length + 1);
    try {
      return decodeURIComponent(crudo);
    } catch {
      // Un `%` suelto (cookie tocada a mano) hace que `decodeURIComponent`
      // lance. Se lee cruda: mejor un valor raro que un efecto que revienta y
      // deja de escribir la cookie para siempre.
      return crudo;
    }
  }
  return null;
}

/**
 * Rutas donde se escribe la cookie pero NO se refresca.
 *
 * `/auth/callback` es un spinner: no pinta ni una hora, así que el refresco no
 * arregla nada ahí. Lo que sí hace es meter una navegación de servidor en
 * paralelo al `exchangeCodeForSession` + `router.replace()` que ese mismo
 * momento está corriendo en `CallbackStatus` — sobre un `code` de un solo uso.
 * La cookie sí se escribe, que es lo único que importa: el destino al que
 * redirige ya se renderiza con la zona buena, sin refresco de por medio.
 */
const SIN_REFRESCO = ["/auth/callback"];

/**
 * R24-22 — deja la zona horaria del navegador en una cookie para que el
 * servidor pueda renderizar los horarios en la hora del visitante **aunque no
 * tenga sesión** (decisión 13: vía `Intl`, sin permiso de ubicación ni geo-IP).
 *
 * Vive en el layout RAÍZ desde RV-03, así que corre en todas las pantallas:
 * públicas, panel, checkout, sala y asistentes. Por eso el refresco tiene que
 * ser caro de disparar y barato de omitir, no al revés.
 *
 * `Intl` se lee dentro del efecto, nunca en el cuerpo: en el cuerpo devolvería
 * la zona del SERVIDOR durante el SSR y la del navegador al hidratar, que es
 * justo el desajuste de hidratación que se está persiguiendo (RV-18).
 */
export function TimezoneSync() {
  const router = useRouter();
  const pathname = usePathname();

  /**
   * Tope duro: como mucho UN refresco por montaje, pase lo que pase con la
   * cookie.
   *
   * Sin esto, la garantía de «no hay bucle» depende de dos cosas que no se ven
   * desde este archivo: que el objeto de `useRouter()` sea estable (en Next 16
   * lo es, es un singleton de módulo) y que este componente no se remonte nunca
   * (hoy tampoco, vive en el layout raíz). Si la cookie no llega a guardarse
   * —cookies bloqueadas, o una `ey-tz` duplicada en una ruta más específica que
   * tapa la lectura— la comparación de abajo no da «igual» jamás, y sin este
   * tope cada pasada pediría otro refresco. Un `global-error` con su botón de
   * reintentar sí desmonta el layout raíz, que es el camino corto a descubrirlo
   * en producción.
   */
  const refrescado = useRef(false);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;

    const previa = leerCookie();
    if (previa !== tz) {
      document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; SameSite=Lax`;
    }

    // El refresco solo se justifica si cambia lo que el SERVIDOR va a usar. No
    // basta con que cambie la cookie: pasar de «sin cookie» a `UTC`, o de `UTC`
    // a nada, deja al servidor exactamente igual porque `zonaConfigurada()`
    // descarta las dos por igual.
    if (zonaEfectiva(previa) === zonaEfectiva(tz)) return;
    if (refrescado.current) return;
    if (SIN_REFRESCO.some((ruta) => pathname.startsWith(ruta))) return;

    refrescado.current = true;
    // Vuelve a pedir el árbol de servidor, ya con la zona correcta. Va en un
    // efecto (post-hidratación) a propósito y `router.refresh()` conserva el
    // estado de los componentes de cliente y la posición del scroll, así que un
    // formulario a medio rellenar sobrevive. Ocurre una vez por navegador: la
    // cookie dura un año.
    router.refresh();
  }, [router, pathname]);

  return null;
}
