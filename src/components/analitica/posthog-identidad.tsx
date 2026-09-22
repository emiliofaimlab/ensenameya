"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Le pone nombre a la sesión anónima que PostHog ya venía grabando. Sin esto
 * los embudos existen pero no se pueden cruzar con nada: "alguien miró tres
 * fichas y no reservó" vale mucho menos que "este alumno lo hizo", que es la
 * pregunta de un marketplace.
 *
 * ⚠️ Va el `id` y los roles, NO el correo ni el nombre. PostHog es un tercero y
 * el identificador de Supabase ya es todo lo que hace falta para cruzarlo con
 * la base cuando alguien pregunte quién es.
 *
 * Se monta en el layout de `(app)`, que es el único sitio donde hay sesión
 * garantizada (`requireUser()`), y no vuelve a llamar en cada navegación: el
 * efecto depende del id y de los roles ya aplanados a texto.
 */
export function PostHogIdentidad({
  uid,
  roles,
}: {
  uid: string;
  roles: string[];
}) {
  const etiqueta = roles.join(",");

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    posthog.identify(uid, { roles: etiqueta });
  }, [uid, etiqueta]);

  return null;
}
