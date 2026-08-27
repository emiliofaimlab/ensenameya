"use client";

/**
 * «Abre este hilo en la burbuja» — el canal entre quien PIDE y quien ABRE.
 *
 * ⚠️ ESTE FICHERO ES UN MÍNIMO ESCRITO POR EL CARRIL DE LAS ENTRADAS. El módulo
 * de verdad lo escribe el carril del núcleo (el que además enseña a la burbuja a
 * atender la petición). Se escribe aquí porque sin él las entradas no compilan y
 * "compila" es lo mínimo que se puede prometer de un carril que no puede
 * ejecutar la app. Si al mezclar aparece la versión del núcleo, **manda esa**:
 * la firma es la misma a propósito, así que sustituir el fichero entero no
 * obliga a tocar ni uno de sus llamantes.
 *
 * ── POR QUÉ UN ALMACÉN DE MÓDULO Y NO UN CONTEXTO ───────────────────────────
 * El mismo motivo que ya documenta `./unread.ts`, y aquí es todavía más claro:
 * quien pide («Escribir a Marta» en la ficha pública, el botón «Chat» del panel
 * del tutor, la campana del header) y quien atiende (la burbuja, que la monta el
 * LAYOUT) no comparten árbol de React. Un proveedor que abrazara a los dos
 * tendría que envolver la app entera para pasar una función; con
 * `useSyncExternalStore` el estado vive fuera de React y cada uno se engancha
 * desde donde esté. Y no hay ni un `createContext` en `src/`: eso es una
 * decisión, no un descuido.
 */

/** Qué hilo hay que abrir. Los dos identificadores que corren por la app. */
export type PeticionDeHilo =
  | { conversationId: string }
  | { bookingId: string };

/**
 * ⚠️ La petición pendiente vive en una variable de módulo y se devuelve TAL
 * CUAL, sin copiar: `useSyncExternalStore` compara la instantánea con
 * `Object.is`, así que devolver un objeto recién construido en cada lectura es
 * un bucle de renders infinito. Misma trampa que `VACIO` en `./unread.ts` y que
 * `cartCountSnapshot()` en `lib/cart/cookie.ts`.
 */
let pendiente: PeticionDeHilo | null = null;

const oyentes = new Set<() => void>();

function avisar() {
  for (const f of oyentes) f();
}

/**
 * Pide a la burbuja que se abra en ese hilo. Lo llama cualquier componente del
 * árbol que sea, incluso uno que no comparta árbol con la burbuja.
 *
 * Una petición nueva PISA a la anterior: si el usuario pulsa dos entradas
 * seguidas, lo que quiere ver es la segunda. Quien esté esperando a que se
 * atienda la suya lo detecta comparando la referencia (ver `peticionSnapshot`).
 */
export function pedirAbrirHilo(p: PeticionDeHilo): void {
  pendiente = p;
  avisar();
}

/** Suscripción para `useSyncExternalStore`. */
export function subscribePeticion(cb: () => void): () => void {
  oyentes.add(cb);
  return () => {
    oyentes.delete(cb);
  };
}

/**
 * La petición pendiente, o `null`. DEVUELVE LA MISMA REFERENCIA mientras no
 * cambie (ver el aviso de arriba).
 */
export function peticionSnapshot(): PeticionDeHilo | null {
  return pendiente;
}

/** La burbuja la llama cuando ya la ha atendido. */
export function consumirPeticion(): void {
  if (pendiente === null) return;
  pendiente = null;
  avisar();
}
