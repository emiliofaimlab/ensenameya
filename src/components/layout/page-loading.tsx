import Image from "next/image";

/**
 * Lo que se ve MIENTRAS el servidor arma la pantalla.
 *
 * No es decoración: sin un `loading.tsx` en la ruta, el App Router no tiene
 * dónde suspender y el navegador se queda CONGELADO en la pantalla anterior
 * hasta que el servidor termina, sin ninguna señal de que el clic haya hecho
 * algo. Y hay un segundo efecto, menos visible: Next solo prefetchea el
 * contenido de una ruta dinámica si existe este límite.
 *
 * ⚠️ Aquí había un esqueleto de barras grises. Se cambió por el isotipo el
 * 9-sep-2026 a petición del cliente: un esqueleto genérico promete una forma
 * que casi nunca era la de la pantalla que venía, así que el contenido «saltaba»
 * al llegar. El logo no promete nada.
 *
 * Es el MISMO `logo-ya.svg` del pie, no una copia: si la marca cambia, cambia
 * en los dos sitios a la vez.
 */
export function PageLoading() {
  return (
    <div
      role="status"
      /* ⚠️ `min-h-svh` Y `flex-1`, las dos, y ninguna es de adorno.
         `flex-1` estira hasta el pie cuando hay hueco. `min-h-svh` es la que
         arregla el salto que reportó el cliente: con una altura menor, el pie
         se pintaba VISIBLE durante la carga y se iba al fondo en cuanto llegaba
         el contenido —que casi siempre es más alto que la pantalla—. Ocupando
         una pantalla entera, el pie queda fuera de vista durante la espera, que
         es justo donde estará después: no se mueve nada.
         Y hace de red donde no hay padre flexible del que estirarse: `(auth)` y
         `(recovery)` no tienen `<main>` propio. */
      className="flex min-h-svh flex-1 flex-col items-center justify-center"
    >
      <Image
        src="/img/logo-ya.svg"
        // Decorativo: quien no ve la pantalla ya recibe el «Cargando…» de abajo,
        // y un `alt` con la marca lo diría dos veces.
        alt=""
        width={56}
        height={61}
        // `priority`: es lo primero que se pinta de la navegación. Sin esto Next
        // lo trata como imagen diferida y el hueco se queda vacío justo el rato
        // que esto viene a cubrir.
        priority
        className="h-14 w-auto animate-latido-carga motion-reduce:animate-none"
      />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
