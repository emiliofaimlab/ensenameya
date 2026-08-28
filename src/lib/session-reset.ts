"use client";

import { clearCart } from "@/lib/cart/cookie";
import { PANEL_COOKIE } from "@/lib/panel";
import { forgetStep } from "@/components/onboarding/wizard-step";
import { resetChatUnread } from "@/components/chat/unread";
import { consumirPeticion } from "@/components/chat/open-thread";

/**
 * Todo lo del usuario que NO se va con `signOut()`, borrado a mano.
 *
 * Nace del reporte del cliente del 28-ago —«cuando cierras la sesión, limpiar
 * el módulo de notificaciones por completo, porque al iniciar sesión como admin
 * veía notificaciones de mi usuario anterior»—. La causa de ESE síntoma resultó
 * ser otra y está arreglada en su sitio (`lib/notifications-server.ts`: la
 * campana consultaba `notifications` sin filtrar por destinatario y la RLS le
 * abre la tabla entera a un admin). Pero la pregunta que traía detrás —«¿qué
 * más sobrevive al cierre de sesión?»— sí tenía respuesta, y es esto.
 *
 * ── EL INVENTARIO, QUE ES LO QUE COSTÓ ──────────────────────────────────────
 * `auth.signOut()` limpia la sesión y sus cookies, y nada más. Lo que queda
 * detrás, buscado uno por uno (`grep -rn "localStorage\|sessionStorage" src`
 * no devuelve un solo uso, así que por ahí no hay nada):
 *
 *  · **Cookies nuestras.** `ey-cart` (el carrito: es del NAVEGADOR a propósito,
 *    para que un anónimo pueda apuntar mentorías y registrarse después),
 *    `ey-onb-alumno` / `ey-onb-tutor` (por qué paso iba el asistente) y
 *    `ey-panel` (de qué panel venías, que es lo que decide el menú de `/pagos`
 *    y `/account`). Las tres sobreviven de verdad al cierre de sesión y las
 *    tres describen a la persona que se acaba de ir.
 *  · **Almacenes de módulo.** `unread.ts` (mensajes sin leer por conversación)
 *    y `open-thread.ts` (la petición «ábreme este hilo», que se guarda a
 *    propósito hasta que haya una burbuja que la atienda). Viven en la PESTAÑA,
 *    no en un componente, así que ningún desmontaje se los lleva.
 *
 * ⚠️ **`ey-tz` y `ey-ref` NO se tocan, y es deliberado.** La zona horaria es del
 * navegador, no de la cuenta: borrarla haría que la siguiente sesión pintara las
 * horas en UTC hasta que `TimezoneSync` volviera a escribirla, que es
 * exactamente el fallo RV-03. Y `ey-ref` es la atribución de la campaña de
 * referidos que trajo a ese navegador hasta aquí: borrarla en un cierre de
 * sesión rompería el alta que viene después.
 *
 * ⚠️ Los dos almacenes de módulo mueren igualmente con la recarga completa que
 * hacen los dos llamantes. Se limpian igual porque el día que esa recarga se
 * convierta en una navegación de cliente —que es el cambio que uno hace sin
 * pensarlo— la fuga vuelve, y no en forma de error sino de datos de otra
 * persona en pantalla.
 *
 * ── QUIÉN LLAMA A ESTO ──────────────────────────────────────────────────────
 * Solo los dos finales EXPLÍCITOS de una sesión: cerrar sesión (`SignOutDialog`)
 * y darse de baja (`DeleteAccountDialog`). Que la sesión caduque sola, o
 * navegar sin ella, NO vacía nada: ahí el carrito y el paso del asistente
 * siguen siendo de quien está delante, y perdérselos sería el otro fallo.
 */
export function resetDatosDeSesion() {
  if (typeof document === "undefined") return;

  clearCart();
  forgetStep("alumno");
  forgetStep("tutor");
  // `ey-panel` la repone el proxy en la primera navegación a un panel
  // (`lib/supabase/middleware.ts`), así que esto no la deja rota: solo evita
  // que entre medias le pinte a nadie el menú de admin del anterior.
  document.cookie = `${PANEL_COOKIE}=; path=/; max-age=0; SameSite=Lax`;

  resetChatUnread();
  consumirPeticion();
}
