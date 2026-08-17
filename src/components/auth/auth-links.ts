/**
 * M-05 · Los enlaces entre las dos pantallas de auth, en un solo sitio.
 *
 * Existe por una razón concreta: desde hoy `/login` **rebota a `/signup`**
 * cuando llega con `?next=` (ver `(auth)/login/page.tsx`). Ese rebote y el
 * enlace "¿Ya tienes cuenta?" de `/signup` apuntan el uno al otro, así que sin
 * un marcador explícito se redirigirían en bucle. El marcador vive aquí para
 * que nadie lo escriba a mano en un `href` y se olvide del otro lado.
 *
 * Sin `next` no se pone nada: es ruido en la barra de direcciones y el bucle
 * solo puede darse cuando hay destino que conservar.
 */

/** "Vengo a entrar, no a registrarme": apaga el rebote de `/login` a `/signup`. */
export const PARAM_YA_TENGO_CUENTA = "entrar";

export type SignupIntent = "alumno" | "tutor";

/** `/login`, conservando el destino previo y sin caer en el rebote. */
export function hrefLogin(next?: string | null): string {
  if (!next) return "/login";
  const params = new URLSearchParams({ next });
  params.set(PARAM_YA_TENGO_CUENTA, "1");
  return `/login?${params.toString()}`;
}

/**
 * `/signup`, con el destino previo y —si se sabe— con qué venía a hacer.
 * `intent=tutor` deja preseleccionado "Quiero enseñar" en el alta, que es lo
 * que espera quien viene de pulsar justo ese botón (N-01).
 */
export function hrefSignup(
  next?: string | null,
  intent?: SignupIntent | null,
): string {
  const params = new URLSearchParams();
  if (next) params.set("next", next);
  // El default del formulario ya es "alumno": pasarlo sería ensuciar la URL.
  if (intent === "tutor") params.set("intent", intent);
  const query = params.toString();
  return query ? `/signup?${query}` : "/signup";
}
