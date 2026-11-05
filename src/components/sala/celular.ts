import type { Participante } from "./use-participante-remoto";

/**
 * Segunda cámara · el celular del tutor entra a la sala con `user_id` =
 * `<tutor>` + este sufijo (lo firma `api/room/[sessionId]/celular`).
 */
export const SUFIJO_CELULAR = "-cam";

/**
 * El celular NO es un participante más: su cámara se pinta como la «pantalla»
 * de su tutor. Así el escenario de la sala —la hoja en grande y las caras en
 * la franja, igual que al compartir pantalla— sale gratis, y nada que cuente
 * participantes (el «otro» de la 1:1, la mano, el cupo) ve un tercero.
 *
 * Si el tutor ya está compartiendo pantalla, gana la pantalla. Un celular sin
 * su tutor dentro no se pinta.
 */
export function fusionarCelulares(lista: Participante[]): Participante[] {
  const personas = lista.filter((p) => !p.userId?.endsWith(SUFIJO_CELULAR));
  for (const cel of lista) {
    if (!cel.userId?.endsWith(SUFIJO_CELULAR) || !cel.video) continue;
    const dueno = cel.userId.slice(0, -SUFIJO_CELULAR.length);
    const i = personas.findIndex((p) => p.userId === dueno);
    if (i >= 0 && !personas[i].pantalla) {
      personas[i] = { ...personas[i], pantalla: cel.video, celular: true };
    }
  }
  return personas;
}
