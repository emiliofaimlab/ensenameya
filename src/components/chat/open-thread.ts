"use client";

/**
 * «Ábreme ESTE hilo» — el recado que cualquier pantalla le deja a la burbuja.
 *
 * ── QUÉ PROBLEMA RESUELVE ───────────────────────────────────────────────────
 * La burbuja sabe abrir un hilo desde el 12-ago (`435a260`), pero solo uno que
 * YA esté en la lista que le pasó el servidor: la fila de la bandeja hace
 * `setAbierta(c)` sobre un objeto `Conversation` que tiene delante. No sabe
 * abrir «la conversación 8f3…» ni «el hilo de la reserva 21c…», que es
 * exactamente lo que necesita cualquier enlace que hoy lleva a
 * `/chat/[threadId]`: el botón «Escribir a X» de la ficha del tutor, la campana,
 * el panel del tutor, la sala y los correos ya enviados.
 *
 * Este módulo es el buzón entre unos y otra: quien quiere abrir un hilo deja
 * ahí el id, la burbuja se entera y lo atiende.
 *
 * ── POR QUÉ UN ALMACÉN DE MÓDULO Y NO CONTEXTO ──────────────────────────────
 * El mismo argumento, palabra por palabra, que ya escribió `unread.ts` para
 * N-23: los dos extremos NO se ven en el árbol de React. La burbuja la monta el
 * layout `(app)` / `(public)`; quien pide abrir un hilo es una página cualquiera
 * —o un componente de la cabecera, que cuelga de otra rama—. Un proveedor que
 * abrazara a ambos tendría que envolver la aplicación entera para transportar
 * un uuid. Con `useSyncExternalStore` el estado vive fuera de React y cada uno
 * se engancha desde donde esté.
 *
 * Y no hay ni un `createContext` en `src/`: eso es deliberado y viene de lejos
 * (ver el bloque de las tres opciones en `lib/cart/cookie.ts`). Aquí tampoco
 * hace falta librería de estado: son doce líneas y un `Set`.
 *
 * ── POR QUÉ LA PETICIÓN HABLA DOS IDIOMAS ───────────────────────────────────
 * Porque las entradas vivas hablan dos. Tres de las cinco (`/tutor`, la sala y
 * los correos de NTF-21) llevan un id de RESERVA en la URL, y las otras dos un
 * id de CONVERSACIÓN. Los correos ya están en los buzones de la gente y no se
 * pueden reescribir, así que ninguno de los dos formatos se puede retirar.
 *
 * La traducción (`conversation_of_booking`) NO se hace aquí: este módulo es un
 * buzón, no un cliente de red — hacerla al depositar obligaría a que
 * `pedirAbrirHilo` fuese asíncrona y a que cada llamante supiera esperar y
 * tratar el fallo. La hace la burbuja, que es quien ya tiene el `createClient()`
 * y el sitio donde enseñar el error.
 *
 * ── ⚠️ LA PETICIÓN SOBREVIVE A LA NAVEGACIÓN, Y ESO ES A PROPÓSITO ──────────
 * El almacén es de la pestaña, no de la página. Si alguien pide abrir un hilo
 * donde NO hay burbuja —`(room)`, `(checkout)`, `(auth)`, `(recovery)` o
 * `/admin/*`, donde `AppChrome` la apaga— la petición se queda pendiente y la
 * atenderá la primera burbuja que se monte, quizá tras un par de clics.
 *
 * No se le pone caducidad con un temporizador, y la razón es de React, no de
 * producto: `peticionSnapshot` tiene que ser PURA y estable. Una instantánea
 * que se vuelve `null` sola, sin avisar a los oyentes, es justo el
 * desgarro (tearing) contra el que existe `useSyncExternalStore`. Si algún día
 * molesta, la solución es que el llamante no pida donde no hay burbuja — o un
 * `consumirPeticion()` al desmontar la última —, no un `setTimeout` aquí.
 *
 * ── POR QUÉ `"use client"` ──────────────────────────────────────────────────
 * `lib/cart/cookie.ts` es NEUTRO a propósito porque las dos orillas lo leen. Lo
 * de aquí es al revés: el estado es una variable de módulo y en el servidor el
 * módulo es GLOBAL AL PROCESO. Un componente de servidor que llamara a
 * `pedirAbrirHilo` le abriría el hilo a otro usuario —el mismo peligro que
 * `unread.ts` describe en `leerEnServidor`—. Con la directiva, ese import falla
 * en el build en vez de en producción.
 */

/**
 * Lo que se puede pedir: una conversación por su id, o la conversación de una
 * reserva. Unión y no un objeto con dos campos opcionales: `{}` no es una
 * petición válida y el compilador lo sabe decir.
 */
export type PeticionDeHilo =
  | { conversationId: string }
  | { bookingId: string };

// ── El almacén ───────────────────────────────────────────────────────────────
// Una sola ranura, no una cola: pedir dos hilos seguidos significa que el
// usuario cambió de idea, y abrir el primero para taparlo con el segundo sería
// peor que atender solo el último.
let pendiente: PeticionDeHilo | null = null;
const oyentes = new Set<() => void>();

function avisar() {
  for (const f of oyentes) f();
}

/**
 * Pide a la burbuja que se abra en ese hilo. Lo llama cualquier componente del
 * árbol que sea, incluso uno que no comparta árbol con la burbuja.
 *
 * Guarda una copia propia y CONGELADA en vez del objeto del llamante: así la
 * instantánea no puede cambiar por debajo si quien la construyó reutiliza su
 * objeto, y de paso se normaliza (un `{ conversationId: "  " }` no llega a ser
 * una petición). Un id vacío se descarta en silencio — abrir la bandeja para
 * enseñar «no hemos podido abrir esa conversación» sería enseñar un fallo
 * nuestro como si fuera del usuario.
 */
export function pedirAbrirHilo(p: PeticionDeHilo): void {
  const siguiente: PeticionDeHilo | null =
    "conversationId" in p
      ? p.conversationId?.trim()
        ? { conversationId: p.conversationId.trim() }
        : null
      : p.bookingId?.trim()
        ? { bookingId: p.bookingId.trim() }
        : null;

  if (!siguiente) return;
  pendiente = Object.freeze(siguiente);
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
 * La petición pendiente, o `null`.
 *
 * ⚠️ DEVUELVE LA MISMA REFERENCIA MIENTRAS NO CAMBIE, y por eso `pendiente` se
 * construye UNA vez en `pedirAbrirHilo` y aquí solo se devuelve.
 * `useSyncExternalStore` compara con `Object.is` en cada render: un objeto nuevo
 * en cada llamada —un `{ ...pendiente }`, o un `?? {}`— es un bucle infinito de
 * renders. Es la misma trampa que documentan `VACIO` en `unread.ts` y
 * `cartCountSnapshot` en `lib/cart/cookie.ts`.
 */
export function peticionSnapshot(): PeticionDeHilo | null {
  return pendiente;
}

/**
 * La burbuja la llama cuando ya la ha atendido — con el hilo abierto o con el
 * aviso de error dado, que las dos cosas son haberla atendido. Sin esto, la
 * petición seguiría en el buzón y volvería a dispararse en el siguiente montaje.
 *
 * No avisa si ya estaba vacío: un `avisar()` de más es un render de más en cada
 * oyente, y esto se llama al final de cada resolución.
 */
export function consumirPeticion(): void {
  if (pendiente === null) return;
  pendiente = null;
  avisar();
}
