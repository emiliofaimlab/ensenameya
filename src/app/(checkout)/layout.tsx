import Image from "next/image";
import { LockIcon } from "lucide-react";

/**
 * N-37 · el armazón de las pantallas donde se COBRA, y de ninguna más.
 *
 * Petición del cliente, literal: «el checkout tiene que estar lo más aislado
 * posible […] tiene que ser "confirmar pago". No debe tener más nada esa
 * página». Hasta hoy el checkout colgaba del layout de `(app)`, así que
 * arrastraba la cabecera completa —buscador, campana, switch de panel, menú de
 * cuenta—, el menú lateral de `PanelShell`, el pie del sitio y el chat
 * flotante. Ocho o nueve salidas de una pantalla cuyo único trabajo es que la
 * compra termine.
 *
 * ⚠️ POR QUÉ UN GRUPO DE RUTAS EN LA RAÍZ Y NO UN `layout.tsx` ANIDADO. En el
 * App Router los layouts se ANIDAN: un layout dentro de
 * `(app)/reservar/[id]/checkout/` se pinta DENTRO del de `(app)`, con su
 * cabecera y su pie incluidos. La única forma de no heredarlos es colgar la
 * ruta de otro grupo hermano. Los grupos no aparecen en la URL, así que
 * `/reservar/<id>/checkout` sigue siendo exactamente la misma dirección de
 * siempre y no hay enlace que arreglar.
 *
 * ⚠️ LA GUARDA DE SESIÓN NO SE PIERDE POR SALIR DE `(app)`. Allí la ponía el
 * layout con su `requireUser()`, pero las dos páginas de este grupo lo llaman
 * por su cuenta —y `requireUser()` es quien además obliga a completar el
 * onboarding (RN-44) y quien arma el `?next=` del login con la query incluida
 * (M-10), que es lo que hace que el horario elegido sobreviva al registro—.
 * Comprobado una por una: si mañana se añade una tercera pantalla aquí, tiene
 * que empezar por `requireUser()`.
 *
 * Lo que SÍ se hereda es el layout raíz: fuentes, `TimezoneSync`, el `Toaster`
 * de sonner (los `toast.error` del formulario dependen de él) y el proveedor de
 * tooltips. Todo eso vive en `src/app/layout.tsx`, no en `(app)`.
 */
export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-muted">
      {/* Una barra, no una cabecera: la marca para saber dónde estás y el
          candado para saber que esto es un pago. El logo NO es un enlace a
          propósito — en el resto del sitio lo es, y aquí sería la vía de escape
          más fácil de pulsar sin querer. */}
      <div className="border-b border-[#e0e0e0] bg-card">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <Image
            src="/img/logo-ya.svg"
            alt="Enséñame Ya"
            width={38}
            height={40}
            className="h-10 w-auto"
            priority
          />
          <span className="flex items-center gap-1.5 text-xs text-[#6b6b6b]">
            <LockIcon className="size-3.5" />
            Pago seguro
          </span>
        </div>
      </div>

      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 sm:px-6">
          {children}
        </div>
      </main>
    </div>
  );
}
