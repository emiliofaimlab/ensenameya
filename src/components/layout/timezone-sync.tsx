"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { TZ_COOKIE } from "@/lib/tz";

/**
 * R24-22 — deja la zona horaria del navegador en una cookie para que el
 * servidor pueda renderizar los horarios en la hora del visitante **aunque no
 * tenga sesión** (decisión 13: vía `Intl`, sin permiso de ubicación ni geo-IP).
 *
 * Solo escribe cuando cambia y refresca UNA vez, así que no hay bucle: tras el
 * primer render la cookie ya viaja en la petición.
 */
export function TimezoneSync() {
  const router = useRouter();

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;
    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1);
    if (current === encodeURIComponent(tz)) return;
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; SameSite=Lax`;
    router.refresh(); // el server vuelve a pintar ya con la zona correcta
  }, [router]);

  return null;
}
