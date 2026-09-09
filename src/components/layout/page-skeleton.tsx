/**
 * El esqueleto que se pinta MIENTRAS el servidor arma la pantalla.
 *
 * No es decoración: sin un `loading.tsx` en la ruta, el App Router no tiene
 * dónde suspender y el navegador se queda CONGELADO en la pantalla anterior
 * hasta que el servidor termina —medido: entre 0,4 y 0,8 s por pantalla del
 * panel—, sin ninguna señal de que el clic haya hecho algo. Ese era el «va
 * lentísimo» que se reportaba.
 *
 * Y hay un segundo efecto, menos visible: Next solo prefetchea el contenido de
 * una ruta dinámica si existe este límite. Sin él, cada navegación empieza de
 * cero al hacer clic.
 *
 * ponytail: uno genérico para todo el panel. Un esqueleto calcado de cada
 * pantalla se vería mejor, pero son 70 y el 95 % de la mejora está en dejar de
 * congelarse.
 */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl animate-pulse px-4 py-8 sm:py-10">
      {/* Título */}
      <div className="h-7 w-1/3 rounded-md bg-black/10" />
      <div className="mt-3 h-4 w-1/2 rounded bg-black/[0.07]" />
      {/* Tres bloques de contenido */}
      <div className="mt-8 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-black/[0.06]" />
        ))}
      </div>
      <span className="sr-only" role="status">
        Cargando…
      </span>
    </div>
  );
}
