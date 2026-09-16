import { NextResponse } from "next/server";

import { getSessionContext } from "@/lib/auth/server";

/**
 * «Enviar los correos pendientes ahora» — el disparador manual de
 * `/api/cron/notifications-send`, solo para el admin.
 *
 * EL PROBLEMA QUE RESUELVE. La cola de correo la vacía un único disparador:
 * el workflow `notifications-cron.yml`. Pide una pasada cada cinco minutos y,
 * medido sobre corridas reales, GitHub entrega **una cada 2-6 horas** (CLAUDE.md
 * lo dice con todas las letras). En dev eso son 78-134 minutos entre «reservo» y
 * «me llega el correo», que es tanto como no poder verificar el camino: quien prueba no
 * sabe si el correo no ha salido o si simplemente no ha salido TODAVÍA. Este
 * endpoint no cambia la cadencia de nada —no se toca `LOTE`, ni los barridos,
 * ni el `.yml`—: le da al admin el botón que hace la misma pasada, ahora.
 *
 * NO DUPLICA LA LÓGICA DE ENVÍO, la llama. Todo lo que sabe mandar correo
 * —`pending_email_notifications`, el render de plantillas, el `.ics`, la
 * distinción entre fallo permanente y reintentable, `mark_notification`— vive
 * en el job y ahí se queda. Copiar aquí ese bucle sería tener dos caminos que
 * envían correo y que se separan el día que alguien toque uno solo. Por eso
 * esto es un `fetch` al propio job y devuelve su JSON tal cual: si mañana el
 * job cuenta una cosa más, el botón la pinta sin tocar este fichero.
 *
 * LA PUERTA DE DOS CERRADURAS, igual que `/api/admin/expirar-reservas`:
 *   1. la sesión se lee en el SERVIDOR y tiene que traer rol admin;
 *   2. el `CRON_SECRET` se pone aquí y nunca sale de aquí. El navegador solo
 *      puede PEDIR la pasada; no puede disparar el job por su cuenta, que es
 *      justo lo que el secreto impide (el job manda correo a usuarios reales).
 *
 * ES POST, no GET, por lo mismo que el vecino: una acción que manda correo de
 * verdad no debe poder dispararse navegando a una URL, ni desde un `<img>`, ni
 * desde un enlace pegado en un chat.
 */

/**
 * Guarda de rol en servidor.
 *
 * No se usa `requireRole('admin')` a propósito: esa función hace `redirect()`,
 * que en un Route Handler acaba en un 307 hacia el HTML del login — un `fetch()`
 * lo seguiría y se comería la página de login como si fuera la respuesta de la
 * API. Aquí se contesta con códigos.
 *
 * // ponytail: es la misma de `/api/admin/referidos/sync`. Son diez líneas y el
 * sitio compartido tendría que ser un fichero nuevo; un `route.ts` no puede
 * exportar nada que no sea un método HTTP sin romper el typecheck de Next.
 */
async function soloAdmin(): Promise<NextResponse | null> {
  const { user, roles } = await getSessionContext();
  if (!user) return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  if (!roles.includes("admin")) {
    return NextResponse.json({ error: "no autorizado" }, { status: 403 });
  }
  return null;
}

export async function POST(req: Request) {
  const noPasa = await soloAdmin();
  if (noPasa) return noPasa;

  // Falla cerrado, como sus seis hermanas de `/api/cron/`: sin el secreto no se
  // finge que se hizo la pasada. Y se dice QUÉ falta, porque el 100 % de las
  // veces que esto salte es un entorno a medias, no un error del programa.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET no está configurada en este entorno. Sin ella el job no se puede llamar ni desde aquí ni desde GitHub Actions. Ver docs/ENTORNOS.md.",
      },
      { status: 503 },
    );
  }

  // El origen sale de la propia petición, igual que en `notifications-send` y en
  // `/referidos`: así se llama SIEMPRE al job de este mismo despliegue y nunca
  // al del entorno de al lado. Una variable más sería una variable más que
  // acordarse de poner, y ponerla mal aquí significa vaciar la cola de prod
  // desde el panel de dev.
  const origen = new URL(req.url).origin;
  const cookie = req.headers.get("cookie");

  let res: Response;
  try {
    res = await fetch(`${origen}/api/cron/notifications-send`, {
      headers: {
        authorization: `Bearer ${secret}`,
        // ⚠️ SE REENVÍAN LAS COOKIES DEL ADMIN, y es lo que hace que esto
        // funcione en dev. La preview de Vercel está detrás de Deployment
        // Protection (docs/ENTORNOS.md §5) y responde 30x ANTES de tocar
        // nuestro código: esta llamada sale del servidor a la red y vuelve a
        // entrar por el borde, así que se come el muro igual que el curl del
        // workflow. Quien está pulsando el botón ya pasó ese muro —por eso ve
        // la pantalla— y su `_vercel_jwt` viaja aquí. Va al MISMO origen y por
        // HTTPS, y el job no mira ninguna cookie: quien le abre la puerta es el
        // `Bearer` de arriba.
        ...(cookie ? { cookie } : {}),
      },
      cache: "no-store",
      // Sin seguir redirecciones: el job nunca redirige, así que un 30x aquí
      // solo puede ser el muro de la preview. Siguiéndolo acabaríamos con el
      // HTML del login de Vercel y un 200 encima — el error diría «no era JSON»
      // sin decir de dónde venía. Así el código que se enseña es el 302.
      redirect: "manual",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo llamar al job de envío: ${String(e)}` },
      { status: 502 },
    );
  }

  // ⚠️ Se lee como TEXTO y se parsea a mano. Un `res.json()` directo lanzaría
  // ante el HTML del muro de Deployment Protection o de una página de error de
  // Vercel, y el admin vería «no se pudo enviar» sin saber que el problema es de
  // acceso y no de correo. Es el mismo fallo mudo que el `.yml` evita diciendo
  // el 30x con todas las letras.
  const texto = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(texto);
  } catch {
    return NextResponse.json(
      {
        error: `El job respondió HTTP ${res.status} y no era JSON. Suele ser Deployment Protection delante de la preview: ${texto.slice(0, 200)}`,
      },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const { error } = (data ?? {}) as { error?: string };
    return NextResponse.json(
      { error: `El job respondió HTTP ${res.status}: ${error ?? texto.slice(0, 200)}` },
      { status: 502 },
    );
  }

  // Tal cual: `status`, `revisadas`, `enviadas`, `fallosPermanentes` y
  // `pendientesDeReintento` son del job, y el botón los pinta sin interpretarlos.
  return NextResponse.json(data);
}
