import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

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
      // «Mis cuentas» pide acción cuando el tutor no ha elegido método
      // preferido: es lo que deja el pago del lunes «por decidir» (H-01).
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
    ]);

    return {
      // Dashboard · ver DP-1: solo las reservas, que es lo decidido.
      "/tutor#por-atender": porAceptar ?? 0,
      // Mis mentorías · el reparto del catálogo (excepción a la regla 1).
      "/tutor/products?f=activas": activas ?? 0,
      "/tutor/products?f=pausadas": pausadas ?? 0,
      "/tutor/products?f=borradores": borradores ?? 0,
      // Reservas · lo mismo que arriba, visto desde su propia pantalla.
      "/tutor/reservas?f=por-aceptar": porAceptar ?? 0,
      // Mis pagos · 1 = «te falta elegir por dónde cobras».
      "/tutor/payouts#mis-cuentas": preferencia?.method ? 0 : 1,
      // Mi cuenta · documentos que el equipo devolvió.
      "/tutor/verification": rechazados ?? 0,
    };
  },
);
