import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { TutorBalance } from "@/lib/payouts";

/**
 * G-02 · Los contadores del menú del tutor (paquete «Panel del tutor v2»,
 * aprobado el 8-sep-2026).
 *
 * Están indexados por el `href` del SUBNIVEL, no por el de la categoría: el
 * menú suma los de cada categoría él solo (`AppSidebar`), de modo que aquí no
 * hay ningún total que pueda contradecir a sus partes.
 *
 * ── LAS TRES REGLAS, HEREDADAS DEL MENÚ DEL ADMIN ───────────────────────────
 * 1 · **Pendiente, nunca total.** Un contador es trabajo que espera al tutor.
 *     «Mis mentorías 12» sería el tamaño de su catálogo, no una bandeja, y un
 *     número que nunca baja enseña a ignorar todos los demás.
 * 2 · **El criterio lo pone la pantalla.** Cada número sale de la misma
 *     condición que usa la pantalla para su propia lista; si divergen, el menú
 *     dice 3 y la pantalla enseña 5.
 * 3 · **Cero no pinta.** Lo resuelve `PanelCounter`; aquí se devuelven igual
 *     para que el mapa sea legible al depurar.
 *
 * ⚠️ «Activas / Pausadas / Borradores» son un caso aparte y a propósito: NO son
 * trabajo pendiente, son el reparto del catálogo. Van porque el documento
 * aprobado los pide explícitamente en el menú (y en los chips de filtro), y
 * porque ahí el número sí es la respuesta a la pregunta que se hace el tutor
 * («¿cuántas tengo publicadas?»). Es la única excepción a la regla 1.
 *
 * ⚠️ **DP-1 · «Por atender» está incompleto y se sabe.** El documento deja sin
 * decidir qué entra además de las reservas por aceptar (mensajes sin leer,
 * clases vencidas sin cerrar, documentos rechazados) y de qué consulta sale
 * cada uno. Aquí se cuenta SOLO lo decidido —las reservas—, que es lo que la
 * pantalla puede enseñar hoy sin inventarse una bandeja. Cuando DP-1 se cierre,
 * el sitio donde sumarlo es esta función y ninguno más.
 */
export type TutorSidebarBadges = Record<string, number>;

export const tutorSidebarBadges = cache(
  async (userId: string): Promise<TutorSidebarBadges> => {
    const supabase = await createClient();

    const [
      { count: porAceptar },
      { count: activas },
      { count: pausadas },
      { count: borradores },
      { data: preferencia },
      { count: rechazados },
      { data: saldo },
    ] = await Promise.all([
      // Misma condición que la lista de «Por aceptar» de /tutor/reservas.
      supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", userId)
        .eq("status", "pending_acceptance"),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", userId)
        .eq("status", "active"),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", userId)
        .eq("status", "paused"),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", userId)
        .eq("status", "draft"),
      // «Mis cuentas» pide acción cuando hay dinero esperando y el tutor no
      // ha elegido método: es lo que deja el pago del lunes «por decidir»
      // (H-01). El porqué del saldo, más abajo.
      supabase
        .from("tutor_payout_preferences")
        .select("method")
        .eq("tutor_id", userId)
        .maybeSingle(),
      // «Verificación» pide acción con cualquier documento rechazado: es lo
      // único del expediente que exige que el tutor vuelva.
      supabase
        .from("verification_documents")
        .select("doc_type", { count: "exact", head: true })
        .eq("tutor_id", userId)
        .eq("status", "rejected"),
      // El saldo, SOLO para saber si «Mis cuentas» pide acción. Ver abajo.
      supabase.rpc("tutor_balance"),
    ]);

    /**
     * ⚠️ EL CONTADOR DE «MIS CUENTAS» LLEVA EL SALDO, y no basta con «no ha
     * elegido método». Medido con val.rios el 9-sep-2026: el menú decía «Mis
     * pagos, 1 pendiente» —naranja, que por G-02 significa «esto pide acción»—
     * y la pantalla renderizaba **cero estrellas**, porque la estrella solo se
     * puede pulsar en una cuenta completa y ella no tiene ninguna. Un tutor de
     * un país sin cobertura no lo podría bajar NUNCA, que es justo lo que la
     * regla 1 de este fichero prohíbe.
     *
     * La condición es la del propio aviso H-01 («solo si hay saldo disponible y
     * ningún método preferido», §5.1 del documento aprobado), y esa es la regla
     * 2: el criterio lo pone la pantalla. Así el número dice exactamente lo que
     * el tutor va a leer al llegar, y desaparece en cuanto elige.
     *
     * Lo que se pierde —el empujón al tutor que aún no ha conectado nada— no se
     * pierde: vive en la caja ámbar «Configura tu cuenta de cobro» del
     * dashboard, que lo dice con palabras y enlaza al sitio.
     */
    // Mismo `as unknown as` que en `tutor/payouts/page.tsx`: la RPC está
    // tipada como `Json` y el tipo generado no expresa su forma.
    const hayDisponible = (
      (saldo as unknown as TutorBalance | null)?.available ?? []
    ).some((m) => m.amount > 0);

    return {
      // Dashboard · ver DP-1: solo las reservas, que es lo decidido.
      "/tutor#por-atender": porAceptar ?? 0,
      // Mis mentorías · el reparto del catálogo (excepción a la regla 1).
      "/tutor/products?f=activas": activas ?? 0,
      "/tutor/products?f=pausadas": pausadas ?? 0,
      "/tutor/products?f=borradores": borradores ?? 0,
      // Reservas · lo mismo que arriba, visto desde su propia pantalla.
      "/tutor/reservas?f=por-aceptar": porAceptar ?? 0,
      // Mis pagos · 1 = «tienes dinero listo y falta decir por dónde cobras».
      "/tutor/payouts#mis-cuentas":
        hayDisponible && !preferencia?.method ? 1 : 0,
      // Mi cuenta · documentos que el equipo devolvió.
      "/tutor/verification": rechazados ?? 0,
    };
  },
);
