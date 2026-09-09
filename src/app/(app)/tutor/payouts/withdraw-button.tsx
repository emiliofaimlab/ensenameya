"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * US-1004 (RN-40) — retiro self-service del saldo disponible.
 *
 * ── POR QUÉ AHORA ES UN CÍRCULO Y NO UN BOTÓN CON TEXTO ─────────────────────
 *
 * §5.2 del paquete aprobado deja los tiles con «solo rótulo y monto», y un
 * botón de 180 px con «Retirar saldo disponible» dentro de un tile de tres
 * obligaba a partirlo en dos líneas y empujaba la cifra hacia arriba. El retiro
 * pasa a ser el círculo azul con flecha AL LADO del monto: es la acción de ese
 * número y ahora se lee como tal.
 *
 * ⚠️ SIN TEXTO, EL `aria-label` ES EL BOTÓN. Va junto con `title` —el mismo
 * texto— para quien lo ve con el ratón: son un solo prop en `PanelIconButton`
 * por este motivo, y aquí se replica a mano porque aquel es un `<a>` y esto
 * tiene que ser un `<button>` con `onClick`.
 *
 * 36 px y no los 32 del artifact: es el mínimo táctil del proyecto (G-04) y la
 * diferencia no se ve, pero un objetivo de 32 px en móvil sí se falla.
 *
 * La confirmación se queda: RN-40 adelanta dinero que iba a salir en el lote
 * del lunes, y un clic accidental en un icono sin texto es más fácil que en un
 * botón que dice lo que hace.
 */
export function WithdrawButton({
  disabled,
  /**
   * 🔑 SE RECIBEN LOS DOS MOTIVOS POR SEPARADO, no un solo `disabled`. El botón
   * se apaga por dos razones distintas —sin saldo, o con saldo y sin cuenta de
   * cobro— y el tutor necesita saber cuál es la suya: la primera se arregla
   * dando clases y la segunda rellenando un formulario.
   */
  hasBalance,
}: {
  disabled: boolean;
  hasBalance: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    if (!window.confirm("¿Retirar tu saldo disponible? Se programará la liquidación.")) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("request_withdrawal", {});
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudo procesar el retiro.");
      return;
    }
    toast.success("Retiro solicitado. La liquidación quedó programada.");
    router.refresh();
  }

  const inactivo = disabled || busy;
  // Apagado el botón se queda, y el `title` dice por qué: quitarlo dejaría el
  // tile sin ninguna pista de que ese número se puede retirar.
  //
  // ⚠️ SON DOS MOTIVOS DISTINTOS Y EL TEXTO TIENE QUE DISTINGUIRLOS. Aquí decía
  // «No tienes saldo disponible para retirar» en los dos casos, y desde que el
  // botón también se apaga sin cuenta de cobro (dictado del 9-sep) esa frase le
  // mentía a un tutor con saldo: le decía que no tenía dinero cuando lo que no
  // tenía era dónde recibirlo. Visto en pantalla el 10-sep con 137,25 US$
  // disponibles.
  const etiqueta = !hasBalance
    ? "No tienes saldo disponible para retirar"
    : disabled
      ? "Añade una cuenta de cobro para poder retirar"
      : "Retirar ahora";

  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      disabled={inactivo}
      onClick={withdraw}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        disabled
          ? "cursor-not-allowed bg-[#ebebeb] text-[#949494]"
          : "bg-brand text-white hover:bg-[#0068d0]",
      )}
    >
      {busy ? (
        <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
      ) : (
        <ArrowRightIcon aria-hidden className="size-[18px]" strokeWidth={2.4} />
      )}
    </button>
  );
}
