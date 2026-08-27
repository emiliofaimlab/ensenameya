"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      /*
       * ⚠️ EL SUELO SE SUBE A 84 px PARA NO PISAR LA BURBUJA DE CHAT.
       *
       * Sonner no declara `position`, así que pinta abajo a la derecha — que es
       * justo donde vive la burbuja (`fixed right-5 bottom-5 z-50` en
       * `chat-bubble.tsx`). Y no es un empate que gane el que llegue después:
       * sonner se pone `z-index:999999999` en su propio CSS, o sea que el aviso
       * SIEMPRE queda por encima del `z-50` de la burbuja y además se lleva el
       * clic. Medido en el navegador antes de tocar nada, a 1280×900 y con la
       * burbuja cerrada: el toast ocupaba 885–1241 × 803–876 y el botón
       * 1189–1245 × 824–880, y `elementFromPoint` sobre el CENTRO del botón
       * devolvía el toast. Con el chat como única superficie de mensajería, el
       * aviso de «no se pudo enviar» tapaba el sitio donde hay que reintentar.
       *
       * El número sale de una cuenta, no del ojo: la burbuja es `bottom-5`
       * (20 px) + `size-14` (56 px) = **76 px de huella** desde el borde
       * inferior de la ventana. 84 deja 8 px de aire. Es el mismo 84 que ya
       * usan `slot-picker.tsx` y `carrito/page.tsx` para esquivar esta misma
       * burbuja, y va detrás de ella: si alguien cambia `bottom-5` o `size-14`,
       * este número cambia.
       *
       * Se mueve SOLO el borde inferior, y a propósito. `offset` y
       * `mobileOffset` admiten objeto parcial: sonner rellena los lados que no
       * se pasan con su defecto (24 px en escritorio, 16 px en móvil), así que
       * el eje horizontal y la posición se quedan como estaban. Mover la
       * posición entera habría movido los ~168 avisos del producto, y el único
       * que necesitaba otro sitio ya lo tiene resuelto donde toca
       * (`add-to-cart.tsx`, que se pide `top-center` porque compite con una
       * barra fija de 134 px, no con la burbuja). Ese sigue haciendo falta:
       * comprobado que a 84 px el aviso todavía cae sobre esa barra.
       *
       * ⚠️ HACE FALTA EN MÓVIL TAMBIÉN, y por eso hay dos props. Por debajo de
       * 600 px sonner deja de ser una tarjeta a la derecha y pasa a franja de
       * ancho completo pegada abajo, con su propio juego de variables
       * (`--mobile-offset-*`): sin `mobileOffset` el arreglo se queda solo en
       * escritorio y en el teléfono la franja tapa la burbuja entera.
       *
       * ⚠️ LO QUE ESTO **NO** ARREGLA: la burbuja ABIERTA. El panel llega hasta
       * 88 px del borde inferior (medido), así que un toast a 84 px le sigue
       * comiendo la franja de abajo — donde está el redactor del hilo. Taparlo
       * exigiría un suelo de ~630 px, que en el resto del producto es absurdo.
       * Aquí se cierra el caso de la burbuja CERRADA, que es el que dejaba el
       * botón sin recibir el clic; el del panel abierto se arregla en el panel
       * (moverlo/encogerlo cuando hay aviso), no en esta constante.
       */
      offset={{ bottom: 84 }}
      mobileOffset={{ bottom: 84 }}
      {...props}
    />
  )
}

export { Toaster }
