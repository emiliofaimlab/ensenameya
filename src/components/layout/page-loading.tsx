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
      className="flex min-h-[60svh] flex-col items-center justify-center"
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
        className="h-14 w-auto animate-pulse motion-reduce:animate-none"
      />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
