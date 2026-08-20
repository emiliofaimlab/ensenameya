/**
 * MN-04 · El armazón de la SALA, y de ninguna otra pantalla.
 *
 * Petición del cliente (minuta del 17-ago, reformulada el 20): «un embed de
 * Daily prácticamente a pantalla completa, y el chat incrustado a la derecha.
 * Todo el fondo o toda la pantalla es de Daily». Hasta hoy la sala colgaba de
 * `(app)`, así que arrastraba la cabecera del sitio —buscador, campana, switch
 * de panel, menú de cuenta—, el pie y la burbuja de chat flotante. Con eso
 * encima el vídeo se quedaba en una franja de 34rem como mucho.
 *
 * ⚠️ POR QUÉ UN GRUPO DE RUTAS EN LA RAÍZ Y NO UN `layout.tsx` ANIDADO. En el
 * App Router los layouts se ANIDAN: un `layout.tsx` dentro de
 * `(app)/room/[sessionId]/` se pintaría DENTRO del de `(app)`, cabecera y pie
 * incluidos. La única forma de no heredarlos es colgar la ruta de otro grupo
 * hermano. Los grupos no aparecen en la URL, así que `/room/<sesión>` sigue
 * siendo exactamente la misma dirección y no hay ni un enlace que tocar
 * (`/app`, `/reservas/[id]`, `/tutor` y `/tutor/reservas/[id]` la enlazan).
 * Es el mismo patrón —y por el mismo motivo— que `(checkout)`.
 *
 * ⚠️ LA GUARDA DE SESIÓN NO SE PIERDE POR SALIR DE `(app)`. Allí la ponía el
 * layout con su `requireUser()`; aquí la pone `page.tsx`, que ya empezaba por
 * ahí antes de la mudanza —y `requireUser()` es además quien obliga a completar
 * el onboarding (RN-44) y quien arma el `?next=` del login—. Si algún día se
 * añade una segunda pantalla a este grupo, tiene que empezar por `requireUser()`.
 *
 * Lo que SÍ se hereda es el layout raíz: fuentes, `TimezoneSync` (de donde sale
 * la cookie `ey-tz` que la página lee para pintar la hora local, RN-01), el
 * `Toaster` de sonner —del que dependen todos los `toast.error` de la sala— y
 * el proveedor de tooltips. Todo eso vive en `src/app/layout.tsx`, no en `(app)`.
 *
 * Este contenedor no pinta nada: solo garantiza el alto del viewport para que
 * la sala pueda repartirlo. El fondo lo pone cada estado —oscuro tipo Meet
 * cuando estás dentro, el del sitio cuando aún no ha abierto—, así que aquí no
 * se fija ninguno: fijarlo obligaría a deshacerlo en la mitad de los casos.
 */
export default function RoomLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="flex min-h-svh flex-col">{children}</main>;
}
