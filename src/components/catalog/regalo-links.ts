import { hrefSignup } from "@/components/auth/auth-links";
import { destinoDeAsistente } from "@/lib/auth/roles";
import type { SessionUser } from "@/lib/auth/server";

/**
 * A dónde lleva «Regalar esta mentoría» desde una pantalla PÚBLICA.
 *
 * ## Por qué esto no es un `href` escrito a mano
 *
 * `/regalar/mentoria/<id>` cuelga de `(app)` y empieza por `requireUser()`, o
 * sea que para media humanidad ese enlace termina en un `redirect()` de
 * SERVIDOR. Un `<Link>` de cliente que cruza de grupo de rutas y se encuentra
 * ese redirect deja al router de Next con el árbol vacío: pantalla en blanco y
 * el RSC pedido en bucle (medido el 11-sep-2026: 1367 peticiones en 5 segundos,
 * cero caracteres en pantalla). La MISMA URL cargada de cero renderiza
 * perfecta, que es por qué `next dev` lo disfraza y por qué mordió dos veces.
 * Es la regla de oro 13, y esta función es la forma que tiene la casa de
 * cumplirla: **el destino se resuelve en servidor y se pinta ya resuelto**.
 *
 * Las tres ramas son exactamente las tres respuestas que daría `requireUser()`
 * —sin cuenta, con la cuenta a medias, y adelante—; la diferencia es que aquí
 * se contestan ANTES de navegar, así que ninguna es un rebote.
 *
 * ⚠️ Sin cuenta el destino es `/signup` y **no** `/login`: regalar es una
 * compra, y quien regala suele ser justo el que todavía no tiene cuenta (es el
 * mismo argumento que ya está escrito en `checkout/change-slot-link.tsx`).
 * Además `/login?next=` rebota solo a `/signup` salvo que se le ponga el
 * marcador de `auth-links.ts`. El `?next=` conserva el regalo: al terminar el
 * alta se aterriza en la mentoría que se estaba mirando, no en la portada.
 */
export function hrefRegalar(
  productId: string,
  sesion: { user: SessionUser | null; onboardingComplete: boolean },
): string {
  const destino = `/regalar/mentoria/${productId}`;
  if (!sesion.user) return hrefSignup(destino);

  // Cuenta a medias (RN-44). `destinoDeAsistente` distingue al que se registró
  // para ENSEÑAR, que tiene su propio asistente; los dos son pantallas que con
  // esta sesión renderizan sin redirigir, así que se pueden enlazar.
  const asistente = destinoDeAsistente(
    sesion.onboardingComplete,
    sesion.user.user_metadata?.intended_role,
  );
  if (!asistente) return destino;
  // El de alumno sí lee `?next=` (`(app)/onboarding/page.tsx`), así que el
  // regalo sobrevive al asistente. El de tutor no lo lee y ya lleva su `?start=1`.
  return asistente === "/onboarding"
    ? `/onboarding?next=${encodeURIComponent(destino)}`
    : asistente;
}
