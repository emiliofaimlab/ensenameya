import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";

/**
 * US-1302 · El código de referido que viaja en `?ref=` (S-18, RN-21).
 *
 * El proxy lo guarda aquí (30 días, `src/lib/supabase/middleware.ts`) para que
 * siga vivo cuando el visitante decida registrarse, aunque haya navegado por
 * medio; el alta lo aterriza en `profiles.referral_code` (trigger
 * `handle_new_user`, y `callback-status.tsx` para Google).
 *
 * ⚠️ YA NO ES «SOLO ATRIBUCIÓN», y el matiz importa. Hasta el 11-sep el `?ref=`
 * no llegaba nunca —la landing de Referral Factory no redirige de vuelta a la
 * app—, así que la columna se quedaba null siempre y quién trajo a quién no lo
 * sabía nadie: ni nosotros ni RF, que tampoco tenía dado de alta a ningún
 * referidor. Desde `20260911120000` el enlace lo emitimos NOSOTROS
 * (`<origen>/?ref=<code>`) y ese `code` es el del referidor en RF: de él cuelga
 * la conversión que el cron manda a RF, y como cada código pertenece a UNA
 * campaña, identifica también el programa. La cookie dejó de ser un rastro
 * decorativo y es el único eslabón entre el clic y la recompensa.
 *
 * Las reglas, los montos y el pago siguen viviendo enteros en RF (RN-21).
 *
 * ⚠️ Módulo neutro —ni `server-only` ni `"use client"`— a propósito: lo importan
 * el proxy, un Route Handler y `signup-form.tsx`, que es de cliente.
 */
export const REFERRAL_COOKIE = "ey-ref";

/**
 * El código con el que ESTE usuario invita a otros alumnos, para el enlace de
 * «Compartir mi reserva» (25-sep). `null` si nunca abrió «Invita y gana», que es
 * donde se le da de alta en RF.
 *
 * ponytail: sin código el enlace sale sin `?ref=` en vez de darlo de alta aquí;
 * esa alta pasa por RF, que tiene picos de más de 25 s, y el botón de compartir
 * no puede esperarlos. Si falta a menudo, darlo de alta en segundo plano.
 */
export async function codigoParaCompartir(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("referral_memberships")
    .select("code, referral_campaigns(audience, visible)")
    .eq("profile_id", userId);
  const filas = data ?? [];
  const deAlumnos = filas.find(
    (f) => f.referral_campaigns?.audience === "alumnos" && f.referral_campaigns.visible,
  );
  return (deAlumnos ?? filas[0])?.code ?? null;
}
