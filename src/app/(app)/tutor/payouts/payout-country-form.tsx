"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** Un país elegible, ya con su nombre resuelto en el servidor. */
export type PaisDeCobro = { code: string; label: string };

/**
 * A0 · El tutor declara DÓNDE COBRA.
 *
 * Escribe `tutor_profiles.payout_country` desde el navegador, igual que las
 * redes del asistente de verificación: la RLS limita a la fila propia
 * (`tutor_profiles_update_own`) y el `grant update (payout_country)` de
 * `20260901140000` limita a esta columna. No hace falta Route Handler — no es
 * dinero, es la CLAVE con la que el dinero se rutea, y lo que sí es dinero
 * (`bookings`/`payments`) queda congelado en el momento de la reserva y no se
 * reescribe nunca desde aquí (regla de oro 2).
 *
 * ⚠️ LA LISTA NO SE ESCRIBE AQUÍ. Llega de `payoutCountries()`, que la saca de
 * `payment_routing_rules`: un país sin regla activa deja las mentorías del tutor
 * sin vender (RN-33), así que ofrecer uno que la tabla no conoce sería ofrecerle
 * al tutor que se rompa el checkout él solo.
 *
 * «Sin declarar» es una opción de verdad y no un hueco: vuelve a la fila
 * `payee_country` null, que sigue dejando vender. Es la salida para quien se
 * equivocó de país y no quiere quedarse bloqueado hasta que alguien lo mire.
 */
export function PayoutCountryForm({
  userId,
  current,
  options,
}: {
  userId: string;
  /** Lo declarado hoy (`null` = todavía nada). */
  current: string | null;
  options: PaisDeCobro[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);

  async function guardar() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("tutor_profiles")
      // Cadena vacía = «sin declarar», y eso en la BD es null, no ''. Un ''
      // reventaría contra el `check` de formato de la columna.
      .update({ payout_country: value || null })
      .eq("profile_id", userId);
    setBusy(false);

    if (error) {
      toast.error(error.message || "No se pudo guardar tu país de cobro.");
      return;
    }
    toast.success(
      value
        ? "Guardado. Tus próximos cobros se liquidarán en ese país."
        : "Guardado. Tu país de cobro queda sin declarar.",
    );
    router.refresh();
  }

  // Sin ningún país servible no se pinta un desplegable vacío: se dice por qué.
  // Pasa si alguien desactiva las filas de ruteo, y entonces lo que hay que
  // mirar es `payment_routing_rules`, no esta pantalla.
  if (options.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-[#6b6b6b]">
        Ahora mismo no hay ningún país al que podamos transferir. Tu saldo se
        sigue acumulando y te avisaremos en cuanto se abra el tuyo.
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select
        aria-label="País de cobro"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        className="h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm text-[#333333] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-[260px]"
      >
        <option value="">Sin declarar</option>
        {options.map((p) => (
          <option key={p.code} value={p.code}>
            {p.label}
          </option>
        ))}
      </select>
      <Button
        className="h-[45px] rounded-[8px] px-4"
        disabled={busy || value === (current ?? "")}
        onClick={guardar}
      >
        {busy ? "Guardando…" : "Guardar país"}
      </Button>
    </div>
  );
}
