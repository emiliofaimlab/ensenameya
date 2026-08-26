"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * EY-186 (capa 2) · «TUTORES VISTOS»: la única señal de las tres que pidió el
 * responsable que no existía en ninguna parte del proyecto.
 *
 * Se monta en la ficha del tutor (`/tutors/[id]`, `origen="tutor"`) y en la de
 * la mentoría (`/products/[id]`, `origen="clase"` — es la mitad «visitas a
 * clases», la que no deja rastro en `bookings` porque no hubo compra). No pinta
 * nada.
 *
 * ── LAS TRES CONDICIONES, Y DÓNDE ESTÁ CADA UNA ─────────────────────────────
 *
 * **1 · Solo con sesión.** Está puesta en TRES capas, y no por exceso de celo:
 *   · aquí, `getSession()` antes de tocar la red;
 *   · en el permiso: `record_tutor_view` está revocada para `anon`;
 *   · dentro de la función: sin `auth.uid()` devuelve `false`.
 * La de aquí es la que evita el gasto (una petición por visitante anónimo en
 * las dos páginas más visitadas del sitio); las otras dos son las que hacen que
 * la regla siga siendo verdad si alguien cambia esta.
 *
 * ⚠️ `getSession()` y NO `getUser()`: la primera lee la sesión que ya está en
 * la cookie, sin salir a la red; la segunda la valida contra el servidor de
 * Auth, que es un viaje entero para decidir si merece la pena hacer otro. Para
 * *autorizar* algo `getSession()` no valdría —se puede falsear—, pero aquí solo
 * decide si vale la pena llamar: quien manda es la RPC, que mira `auth.uid()`
 * del JWT verificado.
 *
 * **2 · Retención.** No vive aquí: son 90 días, los aplica `purge_tutor_views`
 * por `pg_cron`. Ver la cabecera de `20260827140000`.
 *
 * **3 · Es la escritura más frecuente de la plataforma.** Tres frenos, de más
 * barato a más caro:
 *   · el `Set` de módulo de aquí abajo — dentro de la misma pestaña, volver a
 *     una ficha ya visitada no genera ni una petición;
 *   · el antirrebote de 30 minutos dentro de la RPC — recargar la página sí
 *     manda la petición, pero no escribe;
 *   · el modelo: UNA fila por (usuario, tutor) con contadores, no un log. La
 *     tabla deja de crecer tras la primera visita de ese par.
 */

/**
 * Fichas ya registradas EN ESTA PESTAÑA. Un `Set` de módulo y no
 * `sessionStorage`: sobrevive a la navegación de la SPA (que es donde ocurre el
 * ir y volver de verdad: catálogo → tutor → catálogo → tutor), se pierde al
 * recargar —que es justo cuando el antirrebote del servidor toma el relevo— y
 * no toca ninguna API de almacenamiento que haya que envolver en `try/catch`
 * por si el navegador la bloquea.
 */
const yaEnviadas = new Set<string>();

export function RegistrarVisita({
  tutorId,
  origen,
}: {
  tutorId: string;
  /** `tutor` = su ficha · `clase` = una mentoría suya. */
  origen: "tutor" | "clase";
}) {
  useEffect(() => {
    const clave = `${origen}:${tutorId}`;
    if (yaEnviadas.has(clave)) return;

    let vivo = true;
    const supabase = createClient();

    // El segundo `then` vacío no es adorno: `getSession()` resuelve con
    // `{ data, error }` en el camino normal, pero si el almacén de la sesión
    // está bloqueado por el navegador la promesa rechaza — y una promesa
    // rechazada sin dueño mancha la consola de una página pública.
    /** Se traga el resultado A PROPÓSITO, incluido el error. */
    const callar = () => {};

    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      // Sin sesión no se registra nada (condición 1). Y verse a uno mismo no es
      // interés por nadie: pasa de verdad, el tutor abre su ficha para ver cómo
      // ha quedado. La RPC lo rechaza igual; esto ahorra el viaje.
      if (!vivo || !uid || uid === tutorId) return;

      yaEnviadas.add(clave);
      supabase
        .rpc("record_tutor_view", { p_tutor_id: tutorId, p_origen: origen })
        // Esto es telemetría de producto en una página pública: que no se pueda
        // anotar una visita —red caída, migración sin aplicar todavía— no puede
        // manchar la consola del alumno ni, mucho menos, romperle la ficha.
        .then(callar, callar);
    }, callar);

    return () => {
      vivo = false;
    };
  }, [tutorId, origen]);

  return null;
}
