import "server-only";

import { isEmailConfigured, sendEmail } from "@/lib/email";
import { renderEmail } from "@/lib/email-templates";
import { siteUrl } from "@/lib/site-url";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * 🎁 NTF-35 A UNA BANDEJA SIN CUENTA — el correo que no salía.
 *
 * `confirm_gift_payment` encola dos notificaciones al activar el regalo: el
 * recibo al comprador y el aviso al destinatario. La segunda va por
 * `enqueue_notification(v_dest, …)`, y `v_dest` es null cuando el correo del
 * destinatario todavía no tiene cuenta (o la tiene sin confirmar). Con
 * `recipient_id` null `enqueue_notification` **devuelve sin hacer nada**
 * (`20260716170000:62`): ni encola ni falla ni lo dice. O sea que el caso más
 * probable de un regalo —regalas a alguien que aún no está en la plataforma—
 * era justo el que nunca se enteraba. El comprador recibía su recibo, el dinero
 * se movía, el regalo quedaba activo esperando en `credits`, y al otro lado no
 * pasaba nada nunca. Lo dice la propia migración en su comentario: «lo tiene que
 * mandar el Route Handler con Resend». Esto es ese Route Handler.
 *
 * Directo por `sendEmail` y no por la cola, por el mismo motivo que
 * `guest_account_created` en `api/checkout/invitado`: la cola la vacía un cron
 * que en producción pasa cada 2-6 horas (CLAUDE.md), y además **no hay fila que
 * encolar** —`notifications` cuelga de un `recipient_id` que aquí no existe—.
 *
 * ⚠️ NO ESCRIBE EN `credits`. `service_role` tiene `grant select` sobre esa
 * tabla y nada más (`20260912110000:462`), a propósito: el dinero lo mueven las
 * RPC. Así que este módulo no puede dejar un «aviso_enviado_at» ni nada
 * parecido, y de ahí que la idempotencia la ponga quien llama — ver el bloque
 * de abajo.
 *
 * ── 🔴 POR QUÉ ESTE MÓDULO NO SE PUEDE LLAMAR A LO BRUTO ───────────────────
 *
 * `confirm_gift_payment` es idempotente POR ESTADO y devuelve `'active'` tanto
 * en la transición buena como en cada reentrega. Stripe reintenta tres días y
 * dLocal cada 10 minutos durante treinta, así que colgar el envío de ese
 * `'active'` a secas sería mandar el mismo correo decenas de veces. Y este
 * envío NO pasa por `notifications`, o sea que tampoco hereda su
 * `idempotency_key`.
 *
 * El cerrojo que hay, y que vive en los dos webhooks porque es lo único que
 * distingue una transición de una reentrega sin tocar la RPC (regla de oro 12):
 * **la lectura del regalo que el webhook ya hizo ANTES de confirmar**. Si
 * entonces decía `pending_payment` y `confirm_gift_payment` devolvió `'active'`,
 * esta entrega es la que lo activó. Si decía otra cosa, es una reentrega.
 *
 * El `beneficiary_id` de aquí abajo es la otra mitad del cerrojo y es la que no
 * se puede leer antes: lo resuelve la propia RPC. Si quedó escrito, el
 * destinatario tenía cuenta confirmada y NTF-35 ya está en la cola; este correo
 * sería el segundo.
 */
export async function avisarRegaloSinCuenta(
  admin: ReturnType<typeof createAdminClient>,
  creditId: string,
): Promise<void> {
  // La credencial es el interruptor, como en todo el proyecto.
  if (!isEmailConfigured()) return;

  // ⚠️ REGLA DE ORO 10: se mira el `error`. Un `const { data } = …` que falle
  // daría `beneficiary_id` undefined —falsy— y este módulo mandaría el correo a
  // alguien que SÍ tiene cuenta y ya lo tiene en la cola. La mentira creíble de
  // siempre, y aquí además puede morder en tiempo de ejecución por la regla de
  // oro 9: si algún día falta el grant, esto lo dice en vez de duplicar correos.
  const { data: regalo, error } = await admin
    .from("credits")
    .select("beneficiary_id, beneficiary_email, product_id, gift_message")
    .eq("id", creditId)
    .maybeSingle();

  if (error || !regalo) {
    console.error("[regalo] no se pudo leer el regalo para avisar al destinatario", {
      creditId,
      error: error?.message ?? "no existe la fila",
    });
    return;
  }

  // Tiene cuenta: `confirm_gift_payment` ya encoló NTF-35 con la clave
  // `GIFT:recv:<id>`. Nada que hacer aquí.
  if (regalo.beneficiary_id) return;

  // Sin cuenta Y sin correo no hay a quién avisar. No debería existir —el check
  // `credits_tiene_dueno` exige uno de los dos— pero un `!` aquí sería fe.
  if (!regalo.beneficiary_email) {
    console.error("[regalo] regalo sin cuenta y sin correo: nadie se entera", { creditId });
    return;
  }

  const correo = renderEmail({
    template: "gift_received",
    // El mismo payload que encola la RPC, para que el correo sea idéntico se
    // mande por donde se mande.
    payload: {
      credit_id: creditId,
      product_id: regalo.product_id,
      gift_message: regalo.gift_message,
    },
    // VACÍO a propósito: no hay cuenta, no hay `full_name`, y el nombre que
    // tecleó quien regaló no es el de quien lee. Saluda con un «Hola,» a secas.
    nombre: "",
    // De `siteUrl()` y no del `req` del webhook: quien entra por este enlace es
    // una persona, y tiene que aterrizar en el sitio público, no en la URL por
    // la que resultara que llamó la pasarela.
    baseUrl: siteUrl(),
  });
  if (!correo) {
    console.error("[regalo] falta la plantilla gift_received");
    return;
  }

  // 🔴 SI FALLA, SE REGISTRA Y SE SIGUE. El dinero ya se movió y el regalo ya
  // está activo: devolver un 500 al webhook para que la pasarela reintente no
  // arregla un correo, y sí volvería a ejecutar todo lo de arriba. El regalo no
  // se pierde aunque este correo no salga —sigue atado al correo y aparece solo
  // en cuanto esa persona se registre—, solo tarda más en enterarse.
  const enviado = await sendEmail({ to: regalo.beneficiary_email, ...correo });
  if (!enviado.ok) {
    console.error("[regalo] el aviso al destinatario no salió:", {
      creditId,
      error: enviado.error,
    });
  }
}
