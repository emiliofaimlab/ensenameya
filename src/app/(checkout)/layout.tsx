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
 * ⚠️ LA GUARDA DE SESIÓN LA PONE CADA PÁGINA, Y NO TODAS PIDEN LO MISMO. Este
 * layout no guarda nada, así que hay que mirar página por página:
 *
 *   · `reservas/[id]/pagar` y `pedidos/[id]/pagar` empiezan por `requireUser()`
 *     —cobran algo que YA existe y es de alguien—, y esa llamada es además
 *     quien obliga a completar el onboarding (RN-44) y quien arma el `?next=`
 *     del login con la query incluida (M-10);
 *   · `reservar/[productId]/checkout` **admite anónimos a propósito**: es el
 *     checkout de invitado, donde la cuenta se crea DENTRO del formulario de
 *     pago para que nadie tenga que pasar por `/signup` ni por el onboarding en
 *     mitad de una compra. Ahí `requireUser()` se llama solo cuando hay sesión,
 *     que es como se conserva el onboarding obligatorio para quien ya tiene
 *     cuenta sin cerrarle la puerta a quien no la tiene. El porqué completo
 *     está en esa página y en `api/checkout/invitado/route.ts`.
 *
 * Una pantalla nueva aquí empieza por `requireUser()` salvo que tenga un motivo
 * escrito para no hacerlo, como lo tiene el checkout de invitado.
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
        {/*
          Verónica 3-sep (móvil): «el botón de stripe sale encima del botón de
          pago». Esa píldora negra «stripe ›» NO es nuestra ni del formulario:
          es el distintivo de MODO PRUEBA que stripe.js inyecta cuando la clave
          publicable es `pk_test_…` — un iframe `elements-inner-easel` fijo en
          la esquina inferior derecha (medido: 123×72 px, `z-index: 99999`). Con
          claves *live* no existe, así que en producción no se verá. Pero en
          las previews sí, y tapaba el extremo del botón «Pagar» del iframe de
          Stripe cuando la página está al final: quedaban 48 px entre el pie
          del formulario y el pie de la página, y el recuadro de la píldora
          ocupa 72 → 24 px de solape sobre el botón (medido a 390 y 375).

          El pie del contenedor pasa de 32 a 80 px (`pb-20`): con la página al
          final, el iframe del formulario termina en 747 y el recuadro de la
          píldora empieza en 772 — 25 px de aire, medido a 390 y a 375. Con los
          32 px de antes terminaba en 795 y se cruzaban 23 px en vertical (90
          en horizontal a 390): la esquina de la píldora sobre el extremo del
          botón, que es justo la captura de Verónica.

          Llega hasta `lg` y no solo hasta `sm` porque a 768 pasaba lo mismo
          —medido: 11 px de solape horizontal y los mismos 23 en vertical— y
          una tableta es tan móvil como un teléfono para esto. Desde `lg` se
          restituye el `py-8` de siempre y el escritorio no se toca (R1).
          ⚠️ A 1024 justos la píldora SÍ sigue pisando la esquina del botón (82
          × 23 px): a ese ancho la columna del formulario llega casi al borde
          derecho y la píldora cae encima. No se arregla aquí a propósito —sería
          cambiar el escritorio, que Verónica no pidió—; a 1280 ya no se cruzan
          (−33 px en horizontal). Si algún día se quiere, es cambiar `lg:` por
          `xl:` en esta misma línea.

          Va en el layout y no en la pantalla porque el mismo formulario —y la
          misma píldora— se monta también en `/reservas/[id]/pagar` y
          `/pedidos/[id]/pagar`.
        */}
        <div className="mx-auto w-full max-w-[1120px] flex-1 px-4 pt-8 pb-20 sm:px-6 lg:pb-8">
          {children}
        </div>
      </main>
    </div>
  );
}
