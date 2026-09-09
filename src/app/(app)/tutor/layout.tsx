import { getSessionContext } from "@/lib/auth/server";
import { tutorSidebarBadges } from "@/lib/tutor/sidebar-badges";

/**
 * Este layout no pinta nada: **adelanta los contadores del menú**.
 *
 * `TutorShell` los pide (`await tutorSidebarBadges`) desde dentro del árbol que
 * devuelve la pantalla, así que React no llega a esa línea hasta que la
 * pantalla ha terminado TODOS sus `await`. Medido en `/account`: sus siete
 * consultas arrancaban en el ms 845 de un render de 1.122 ms y sumaban un
 * peldaño entero de ~200 ms al final, en las diez pantallas del tutor.
 *
 * Un layout sí corre antes que su pantalla, así que aquí la promesa se lanza
 * SIN `await`: `tutorSidebarBadges` está memoizada con `cache()` de React, de
 * modo que cuando `TutorShell` la pida encontrará la misma promesa ya en vuelo
 * —o resuelta— en vez de empezar de cero. Es la precarga que documenta Next.
 *
 * ponytail: sin `await` a propósito. Ponerlo convertiría la precarga en el
 * mismo peldaño que viene a quitar, solo que al principio.
 */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gratis: el layout de `(app)` ya la resolvió y `cache()` la comparte.
  const { user } = await getSessionContext();
  // El `.catch` es obligatorio en una promesa sin dueño: sin él, un fallo de
  // red aquí tumbaría el proceso con un rechazo no capturado. El error real lo
  // sigue viendo quien haga `await` de la promesa memoizada.
  if (user) void tutorSidebarBadges(user.id).catch(() => {});
  return children;
}
