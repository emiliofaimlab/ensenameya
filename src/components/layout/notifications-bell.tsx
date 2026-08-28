"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  NOTICES_LIMIT,
  toNotice,
  type AppNotice,
  type NotificationRow,
} from "@/lib/notifications";
import {
  consumirPeticion,
  pedirAbrirHilo,
  peticionSnapshot,
} from "@/components/chat/open-thread";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * US-1203 · Avisos in-app. La campana del header: las últimas novedades del
 * usuario, con las no leídas contadas.
 *
 * La lista inicial llega del servidor (el layout ya consulta al usuario), así
 * que el contador sale pintado en el primer render y no hay ida y vuelta al
 * cargar cada página. Al abrir la campana se recarga por si hay algo nuevo.
 *
 * ponytail: sin Realtime. Los avisos los encolan triggers de negocio, no llegan
 * al segundo; se refrescan al cargar la página y al abrir la campana. Si algún
 * día hace falta al instante, `messages` ya enseñó cómo (EP-17).
 */

/**
 * Cuánto se espera a que la burbuja atienda antes de irse a la página.
 *
 * No es un "tiempo de carga": la burbuja ya está montada o no lo está, y
 * atenderla es un render. 400 ms es holgura para ese render (incluido el caso en
 * que la burbuja tenga que traducir una reserva a conversación con una consulta
 * corta) sin que la espera se note delante de una navegación, que cuesta más que
 * eso ella sola. Mientras tanto el desplegable ya se ha cerrado, así que el clic
 * no se queda mudo.
 */
const ESPERA_BURBUJA_MS = 400;

export function NotificationsBell({
  initial,
  userId,
}: {
  initial: AppNotice[];
  /**
   * ⚠️ De quién son estos avisos, y hace falta de verdad. La RLS de
   * `notifications` tiene DOS políticas de lectura y la de admin abre la tabla
   * entera (`20260716170000:38-44`), así que una consulta sin `recipient_id`
   * le devolvía a un administrador los avisos de CUALQUIERA. El razonamiento
   * largo está en `lib/notifications-server.ts`, que es donde se descubrió.
   */
  userId: string;
}) {
  const router = useRouter();
  const [notices, setNotices] = useState<AppNotice[]>(initial);
  // Controlado (antes no lo era) para poder cerrarlo A MANO: cuando el aviso
  // abre la burbuja no hay navegación, y sin cerrar esto el desplegable se
  // quedaba abierto tapando el hilo que el usuario acaba de pedir.
  const [abierta, setAbierta] = useState(false);

  async function load() {
    const { data } = await createClient()
      .from("notifications")
      .select("id, type, template, payload, created_at, read_at")
      // Ver la nota del prop `userId`: sin esto, un admin se traía los avisos
      // de toda la plataforma en cuanto abría la campana.
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(NOTICES_LIMIT);
    setNotices(((data ?? []) as NotificationRow[]).map(toNotice));
  }

  const unread = notices.filter((n) => !n.read).length;

  async function markAllRead() {
    if (unread === 0) return;
    // Optimista: el usuario ya las está viendo, que el punto se apague ya.
    setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
    await createClient()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      // ⚠️ El comentario que había aquí —«la RLS acota a las suyas»— era cierto
      // para la ESCRITURA (`notifications_update_own_read` es `auth.uid() =
      // recipient_id`, y esa política no tiene gemela de admin) pero se apoyaba
      // en ella para no escribir el filtro. Puesto explícito: la barrera sigue
      // siendo la política, y así además el update no recorre la tabla entera
      // en la sesión de un administrador.
      .is("read_at", null);
    router.refresh();
  }

  /**
   * NTF-21 · Un aviso de mensaje nuevo tiene que abrir el hilo EN LA BURBUJA,
   * no llevarse al usuario a otra pantalla. Pero la campana no está siempre
   * donde está la burbuja, así que hace falta un criterio.
   *
   * ── EL CRITERIO: PREGUNTAR POR EL RESULTADO, NO POR LA RUTA ────────────────
   * Se pide la apertura y se mira si ALGUIEN LA HA ATENDIDO. Si a los
   * `ESPERA_BURBUJA_MS` la petición sigue pendiente —misma referencia, que es
   * justo lo que garantiza `peticionSnapshot()`— es que no había burbuja, y
   * entonces se navega a `/chat/<id>` como toda la vida.
   *
   * Lo alternativo era mirar `pathname`, y se descartó por tres motivos:
   *
   *  1. **Sería la CUARTA copia de "dónde hay burbuja".** Hoy eso lo deciden
   *     tres sitios distintos y ninguno es este: los layouts `(app)` y
   *     `(public)` (que son los únicos que montan `ChatLauncher`), `AppChrome`
   *     (la apaga en `/admin/*`) y la propia burbuja (se esconde sola en
   *     `/chat/*` y `/room/*`). Una cuarta copia aquí es una lista que se queda
   *     mintiendo en cuanto alguien mueva una ruta de grupo — y ninguna de las
   *     tres está en un fichero que la campana importe, así que nadie se
   *     enteraría hasta que un usuario se quedara con el clic muerto.
   *  2. **La ruta no es la pregunta.** La pregunta es "¿va a ver este hilo?", y
   *     hay una burbuja perfectamente montada que aun así no puede abrirlo: la
   *     bandeja del servidor viene cortada a 30 conversaciones
   *     (`ChatLauncher`), y un aviso puede señalar a la 31ª. Con el pathname
   *     nos tragaríamos el clic y no pasaría nada. Preguntando por el resultado,
   *     esa apertura fallida cae sola en la página, que sí sabe abrirla.
   *  3. Es la sala la que lo obliga: `/room/[sessionId]` monta este mismo
   *     `SiteHeader` (y por tanto esta campana) y **no** monta la burbuja, por
   *     la decisión MN-04 de no tapar el vídeo. O sea que el caso "campana sin
   *     burbuja" no es teórico, es una pantalla en producción.
   *
   * ⚠️ QUÉ ROMPERÍA ESTO, para que quede escrito: que la burbuja llame a
   * `consumirPeticion()` MÁS TARDE de esos 400 ms (por ejemplo, si algún día
   * espera a tener los mensajes cargados en vez de consumir en cuanto se hace
   * cargo). Entonces navegaríamos igualmente y el usuario vería la página. No es
   * una avería —es el comportamiento de antes de este cambio— pero sí es la
   * primera cosa que mirar si alguien reporta "la campana me saca de la
   * pantalla".
   */
  function abrirHiloEnBurbuja(
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    // Se deja pasar todo lo que NO es un clic izquierdo a secas: ctrl/cmd+clic,
    // "abrir en pestaña nueva", clic central. Ahí el usuario ha pedido una
    // página a propósito, y la página sigue existiendo para dársela. Es también
    // el motivo de que esto siga siendo un `<a>` y no un `<button>`.
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }

    const conversationId = href.slice("/chat/".length);
    if (!conversationId) return;

    e.preventDefault();
    setAbierta(false);
    pedirAbrirHilo({ conversationId });

    // La referencia de ESTA petición. Si dentro de un momento el almacén sigue
    // devolviendo exactamente este objeto, nadie la ha tocado.
    const mia = peticionSnapshot();

    window.setTimeout(() => {
      if (peticionSnapshot() !== mia) return; // atendida (o pisada por otra)
      // Se retira antes de irse: dejarla colgada haría que la burbuja se
      // abriera sola, con este hilo, la próxima vez que el usuario pisara una
      // pantalla que sí la monta — minutos después y sin haberlo pedido.
      consumirPeticion();
      router.push(href);
    }, ESPERA_BURBUJA_MS);
  }

  return (
    <DropdownMenu
      open={abierta}
      onOpenChange={(open) => {
        setAbierta(open);
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={
            unread > 0 ? `Avisos (${unread} sin leer)` : "Avisos"
          }
        >
          <BellIcon className="size-[18px]" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      {/*
        US-1601 · hasta ahora esta campana solo existía por encima de 768 (vivía
        dentro de un `hidden … md:flex` del header y no tenía copia en el cajón),
        así que este desplegable nunca se había abierto en un móvil. Ahora sí, y
        a 390 el disparador está a la IZQUIERDA de la fila del avatar, no pegado
        al borde derecho: con `align="end"` a secas el panel de 320 px se salía
        de la pantalla. `collisionPadding` lo mete dentro dejando aire, y el
        `max-w-` lo acota para pantallas más estrechas que 320+24.
      */}
      <DropdownMenuContent
        align="end"
        collisionPadding={12}
        className="w-80 max-w-[calc(100vw-24px)]"
      >
        <DropdownMenuLabel className="flex items-center justify-between gap-3 font-normal">
          <span className="text-[13.5px] font-semibold">Avisos</span>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAllRead}
              className="text-[12px] font-medium text-brand hover:underline"
            >
              Marcar todo leído
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notices.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            No tienes avisos todavía.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto">
            {notices.map((n) => {
              const inner = (
                <>
                  <span className="flex items-start gap-2">
                    {!n.read ? (
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                      />
                    ) : (
                      <span aria-hidden className="mt-1.5 size-1.5 shrink-0" />
                    )}
                    <span className={n.read ? "text-muted-foreground" : ""}>
                      {n.text}
                    </span>
                  </span>
                  <time
                    dateTime={n.createdAt}
                    className="mt-0.5 block pl-3.5 text-[11px] text-muted-foreground"
                  >
                    {new Date(n.createdAt).toLocaleDateString("es", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </>
              );
              // Solo los avisos de chat cambian de destino. Los demás
              // (`/reservas/<id>`, `/tutor/payouts`…) siguen siendo enlaces y
              // punto: no hay burbuja de reservas.
              const alHilo = n.href?.startsWith("/chat/") ?? false;
              return (
                <li key={n.id} className="px-2 py-2 text-[13px]">
                  {n.href ? (
                    <Link
                      href={n.href}
                      className="block hover:underline"
                      onClick={
                        alHilo
                          ? (e) => abrirHiloEnBurbuja(e, n.href as string)
                          : undefined
                      }
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
