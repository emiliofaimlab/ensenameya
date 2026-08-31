"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { buscarReservaDelAlumno, liberarHold } from "@/lib/checkout/hold";
import { cn } from "@/lib/utils";

/**
 * SALIR DEL CHECKOUT SOLTANDO EL HORARIO (D-2 · §20.14).
 *
 * Desde que la reserva se crea al LLEGAR al checkout, salir de esta pantalla
 * hacia el selector dejaba de funcionar: `get_available_slots` descuenta toda
 * sesión no cancelada sin mirar de quién es, así que el alumno llegaba al
 * calendario y **su propio hueco ya no estaba**. En un paquete era peor —
 * cualquier conjunto distinto de horarios que solapara chocaba contra su propia
 * reserva a medias— y el mensaje decía «algún horario ya no está disponible»
 * sobre un horario retenido por él mismo. Un callejón sin salida.
 *
 * La clave es que «Cambiar horario» NO ES UN ABANDONO: es una declaración de
 * que ese hueco ya no se quiere. Por eso aquí sí se cancela, y no se espera a
 * `expire_stale_bookings`. Cerrar la pestaña o irse a otro sitio siguen siendo
 * abandonos y esos los sigue limpiando el cron a los 7 minutos: la diferencia
 * es la intención, y esta pantalla la conoce.
 *
 * Lo usan las DOS salidas hacia el selector —el enlace de la cabecera y el
 * «Elegir otro horario» de la rama de error del formulario— porque las dos
 * dejan atrás exactamente el mismo hold.
 */
export function ChangeSlotLink({
  productId,
  studentId,
  slots,
  etiqueta,
  className,
}: {
  productId: string;
  /**
   * El alumno, resuelto en servidor: acota la búsqueda a SUS reservas.
   *
   * `null` = checkout de invitado sin cuenta todavía. Ahí no hay NADA que
   * soltar —la reserva se crea al terminar el alta, no al llegar— y esto vuelve
   * a ser el enlace pelado de antes de D-2, pero hacia la ficha pública (ver
   * `destino`). Lo que no se puede es pasar `""`: la consulta saldría con
   * `student_id=eq.` y podría traer la reserva de otro.
   *
   * Y en cuanto la cuenta existe deja de ser `null`: el alta recarga la página,
   * así que este prop se vuelve a calcular en servidor CON sesión. Antes no —se
   * quedaba congelado en `null` y el hold no se soltaba nunca—.
   */
  studentId: string | null;
  /** Los horarios de este checkout. Identifican el hold que se va a soltar. */
  slots: string[];
  etiqueta: string;
  className?: string;
}) {
  const router = useRouter();
  const [soltando, setSoltando] = useState(false);
  /**
   * ⚠️ EL INVITADO NO PUEDE IR AL SELECTOR: `/reservar/<id>` cuelga del grupo
   * `(app)`, y ese layout empieza por `requireUser()`. O sea que la ÚNICA salida
   * de la pantalla de pago —el logo no es enlace y no hay «Iniciar sesión»—
   * llevaba a `/login?next=…` a quien todavía no tiene cuenta: justo la pantalla
   * que el checkout de invitado existe para que nadie vea, y con la compra
   * perdida por el camino. Sin cuenta se vuelve a la ficha pública, que es de
   * donde salió y donde puede elegir otra hora.
   */
  const destino = studentId ? `/reservar/${productId}` : `/products/${productId}`;

  async function salir(e: React.MouseEvent<HTMLAnchorElement>) {
    // Sigue siendo un enlace de verdad: con ctrl/cmd/mayús o el botón central
    // el navegador abre otra pestaña y ESTA pantalla no se abandona. Soltar el
    // horario ahí sería cancelarle la reserva que sigue teniendo delante.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    // Invitado sin cuenta: no hay hold suyo que buscar ni que soltar, así que
    // el enlace navega como cualquier otro. Sin este corte, la búsqueda se
    // haría sin alumno y no hay filtro que la acote.
    if (!studentId) return;
    e.preventDefault();
    if (soltando) return;
    setSoltando(true);

    const supabase = createClient();
    const reserva = await buscarReservaDelAlumno(supabase, {
      studentId,
      productId,
      slots,
    });
    // SOLO lo que está a medias. Si ya se pagó (el webhook la movió a
    // `pending_acceptance` o `confirmed`), esto no es un hold que soltar sino
    // una mentoría comprada, y cancelarla por pulsar «Cambiar horario» sería
    // devolver dinero sin que nadie lo haya pedido.
    if (reserva?.status === "pending_payment") {
      await liberarHold(supabase, reserva.id);
    }

    // `replace` y no `push`: el checkout que se deja atrás ya no retiene nada,
    // y volver a él con el botón «atrás» solo serviría para crear otro hold.
    router.replace(destino);
    // Y `refresh` después, como en el resto del proyecto: invalida la caché del
    // router para que el selector vuelva a pedirle los huecos al servidor. Sin
    // esto el hueco recién liberado podría no aparecer, que es justo el síntoma
    // que este componente viene a quitar.
    router.refresh();
  }

  return (
    <Link
      href={destino}
      onClick={salir}
      aria-busy={soltando}
      className={cn(soltando && "pointer-events-none opacity-70", className)}
    >
      <ArrowLeftIcon className="size-4" />
      {soltando ? "Liberando el horario…" : etiqueta}
    </Link>
  );
}
