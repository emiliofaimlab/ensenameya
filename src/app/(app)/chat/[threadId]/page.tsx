import Link from "next/link";
import { notFound } from "next/navigation";

import { getFormatoHora, getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { ChatThread } from "@/components/chat/chat-thread";
import {
  conversationIdOfBooking,
  getConversation,
} from "@/components/chat/conversations";
import {
  conversationSubtitle,
  counterpartFallback,
} from "@/components/chat/types";
import { grupalDe, type MiembroGrupo } from "@/components/chat/grupo";
import { asRpc } from "@/components/chat/rpc";
import { initialsFrom, storageUrl } from "@/lib/catalog/format";
import { MESSAGE_COLUMNS, toChatMessage } from "@/lib/chat/messages";

export const metadata = { title: "Mensajes · Enséñame Ya" };

/**
 * El hilo 1:1 a página completa.
 *
 * ⚠️ ESTA PANTALLA CAMBIÓ DE PAPEL EL 27-AGO, aunque el código apenas se haya
 * movido. **Ya no es un destino de la aplicación: es la red de lo que no
 * controlamos.** El cliente pidió que el chat se abriera en la burbuja y no en
 * otra pantalla («esa pantalla individual de chat prácticamente ya no va a
 * existir»), así que se retiró la NAVEGACIÓN hacia aquí desde dentro: la ficha
 * pública del tutor, el «Chat» del panel del tutor y los avisos de la campana
 * abren ahora la burbuja en sitio. Lo que queda apuntando aquí es lo que no
 * podemos reescribir ni aunque quisiéramos:
 *
 *  · **Correos ya enviados**, que están en buzones ajenos (`email-templates.ts`
 *    → `rutaFor`, NTF-21). Una URL que sale de aquí ya no vuelve.
 *  · **La campana cuando no hay burbuja donde está pintada** — la propia sala, o
 *    cualquier pantalla futura fuera de `(app)`/`(public)`.
 *  · **La burbuja misma** (`chat-bubble.tsx`, `router.push`) cuando le piden un
 *    hilo y no está montada.
 *
 * ⚠️ **31-ago: ya no queda NINGÚN enlace clicable a esta ruta.** El «Ver hilo
 * completo» de la sala (`live-room.tsx`) era el último y se borró: el cliente
 * volvió a pedir que esta pantalla «no exista». Los tres respaldos de arriba son
 * programáticos o vienen de fuera, así que desde dentro de la app ya no se puede
 * llegar. La ruta sigue en pie porque un correo NTF-21 que ya salió no se puede
 * reescribir; borrarla convertiría ese aviso en un 404.
 *
 * Por eso **no se borra la ruta**. Y por eso el `git grep '/chat/'` de esta
 * tanda se hizo a mano: no hay `typedRoutes` en `next.config.ts` y el CI solo
 * pasa lint y typecheck, así que un enlace a una ruta borrada compila, se
 * despliega y solo revienta cuando alguien lo pulsa.
 *
 * ── POR QUÉ SE ENSEÑA LA PÁGINA Y NO SE REDIRIGE A UNA CON BURBUJA ──────────
 * La tentación es "que todo sea burbuja": mandar a quien llega de un correo a
 * `/app` con el hilo ya abierto. Se descarta, y estos son los dos lados:
 *
 *  A FAVOR DE REDIRIGIR: coherencia. El usuario vería siempre el mismo chat, y
 *  la pantalla dejaría de existir de verdad en vez de quedarse como un pariente
 *  pobre que nadie mantiene.
 *
 *  EN CONTRA, que es lo que gana:
 *   1. **El coste de equivocarse es asimétrico.** Enseñar una pantalla más sosa
 *      de lo que a uno le gustaría no le rompe el día a nadie; un enlace de
 *      correo que aterriza en `/app` y NO abre el hilo —porque la conversación
 *      cae fuera de las 30 que lista `ChatLauncher`, o porque el filtro
 *      `lastMessageAt !== null || hasBooking` la deja fuera— es un aviso muerto,
 *      y encima uno que ya no podemos corregir porque el correo ya se envió.
 *      Redirigir cambia un resultado seguro por uno que depende de otra pieza.
 *   2. **Habría que adivinar el destino.** No hay una "pantalla con burbuja"
 *      canónica: `/app` es del alumno y `/tutor` del tutor, así que el redirect
 *      tendría que mirar el rol para escoger — y aterrizar en un panel que no
 *      pediste, con un hilo encima, se lee como un fallo.
 *   3. **Quien llega de fuera no está en ninguna pantalla.** El daño que el
 *      cliente quería evitar era perder de vista lo que estabas mirando. Desde
 *      un correo no hay nada que perder: la página ES el sitio al que vas.
 *   4. Y una URL que redirige deja de servir para compartir, guardar en
 *      marcadores o volver con el botón atrás sin rebotar.
 *
 * ⚠️ EL PARÁMETRO ACEPTA DOS COSAS, y es a propósito. Desde M-12 la identidad
 * del hilo es la CONVERSACIÓN, pero hay enlaces vivos a `/chat/<reserva>` —la
 * sala (LV01), correos antiguos, y hasta el 27-ago también el panel del tutor—
 * que son de otros carriles y que no se van a reescribir. En vez de dejar 404
 * sembrados, se prueban las dos lecturas: primero conversación, y si no, reserva
 * → su conversación. Un uuid ajeno no encuentra ninguna de las dos, porque las
 * dos consultas van con la sesión del usuario y su RLS. **Esta doble lectura no
 * se toca**: es la mitad del valor de que la pantalla siga aquí (la otra mitad
 * está en `/api/chat/[threadId]/download`, que hace lo mismo).
 *
 * La autorización, por tanto, sigue siendo la RLS y no una comprobación a mano.
 */
export default async function ChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const [{ user }, { threadId }, formato, timeZone] = await Promise.all([
    requireUser(),
    params,
    getFormatoHora(),
    getUserTimezone(),
  ]);

  // 0) G3 · ¿Es el chat de una clase grupal (RG-13)? Se mira PRIMERO.
  //
  // ⚠️ B3 · hasta el lote 3 esto iba DESPUÉS de la bandeja, y la bandeja
  // (`my_conversations`) no filtraba `kind`: la tutora abría el chat de su
  // grupo y caía en la rama de par —«Chat con tu alumno · Conversación de solo
  // lectura», topes de consulta y mensajes sin autor—. Hoy la bandeja SÍ trae
  // los hilos de grupo (con su título), pero esta página los pinta con su
  // propia rama, así que el orden es lo que garantiza que nunca caigan en la
  // de par. La RLS (`puede_ver_conversacion`) deja fuera a quien no pagó o se
  // dio de baja.
  // Un id que no es UUID hace fallar a PostgREST (y `hiloDeGrupo` lanza): 404.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) notFound();
  const grupo = await hiloDeGrupo(threadId);
  if (grupo) {
    return (
      <Container>
        <Section className="flex flex-col gap-6">
          {/* `PageHeader` solo admite texto en `description`: las caras y la
              insignia van justo debajo, en su propio renglón. */}
          <div className="flex flex-col gap-2">
            <PageHeader title={grupo.titulo} description="Chat del grupo" />
            <Participantes miembros={grupo.grupal.miembros} yo={user.id} />
          </div>
          <ChatThread
            formato={formato}
            timeZone={timeZone}
            conversationId={grupo.id}
            currentUserId={user.id}
            initialMessages={grupo.mensajes}
            grupal={grupo.grupal}
          />
        </Section>
      </Container>
    );
  }

  // 1) ¿Es una conversación mía?
  let conversation = await getConversation(threadId);

  // 2) Si no, ¿es una reserva mía? (enlaces viejos)
  if (!conversation) {
    const id = await conversationIdOfBooking(threadId);
    if (id) conversation = await getConversation(id);
  }

  if (!conversation) {
    // P12 · quien se dio de baja de una clase grupal y abre el enlace del chat
    // (un correo, la campana) recibía un 404 seco. La RLS ya no le deja leer
    // el hilo —es lo correcto—, pero sí se le puede decir por qué y llevarle a
    // su reserva. La RPC solo devuelve id si el hilo es de grupo y quien mira
    // tuvo reserva en esa clase y ya no es miembro; a cualquier otro, `null`.
    const supabase = await createClient();
    const { data: reservaId } = await asRpc(supabase).rpc(
      "reserva_tras_salir_del_grupo",
      { p_conversation_id: threadId },
    );
    if (typeof reservaId === "string") {
      return (
        <Container>
          <Section className="flex flex-col gap-6">
            <PageHeader
              title="Ya no formas parte de este grupo"
              description="Tu lugar en esta clase ya no está activo, así que ya no puedes leer su chat. En tu reserva ves por qué."
            />
            <Link
              href={`/reservas/${reservaId}`}
              className="font-semibold text-brand hover:underline"
            >
              Ver mi reserva
            </Link>
          </Section>
        </Container>
      );
    }
    notFound();
  }

  const supabase = await createClient();
  const { data: msgs } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversation.id)
    .order("created_at");

  const initial = (msgs ?? []).map(toChatMessage);

  // Sin nombre legible se dice el rol ("Chat con tu alumno") y no un "Chat con
  // Alumno", que se lee como un fallo de la aplicación.
  const nombre =
    conversation.counterpart ?? counterpartFallback(conversation.counterpartRole);

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title={`Chat con ${nombre}`}
          // MN-08 · el recuento de mentorías del par delante del título de la
          // última reserva. El respaldo largo se conserva: aquí hay sitio para
          // una frase entera, y en un hilo sin compra es lo único que explica
          // qué es esta pantalla.
          //
          // ⚠️ MN-06 · pero ese respaldo cambió de sentido. Solo se usa cuando
          // no hay ni recuento ni título, o sea cuando el par NUNCA reservó — y
          // desde MN-06 eso es exactamente un hilo de solo lectura. El texto de
          // M-12 («pregúntale lo que necesites») invitaba a algo que ya no se
          // puede hacer.
          description={conversationSubtitle(
            conversation,
            "Conversación de solo lectura: no hay ninguna mentoría reservada entre los dos.",
          )}
        />
        <ChatThread
          formato={formato}
          timeZone={timeZone}
          conversationId={conversation.id}
          // La reserva más reciente del par, si la hay: es lo que etiqueta el
          // mensaje (retención de 30 días) y lo que permite adjuntar.
          bookingId={conversation.bookingId ?? undefined}
          hasBooking={conversation.hasBooking}
          // MN-06 · esta pantalla SÍ alcanza hilos cerrados: es el destino de
          // los enlaces que vienen de fuera, y ahí viven los hilos previos a
          // MN-06 y los de reservas canceladas.
          //
          // ⚠️ 27-ago: aquí ponía «y de la bandeja». Dejó de ser verdad — la
          // bandeja abre el hilo DENTRO de la burbuja y ya no pasa por aquí.
          canChat={conversation.canChat}
          // De qué lado se mira. Decide el contador de la consulta previa: los
          // topes son solo del alumno, así que sin esto el hilo no puede decir
          // «te quedan N» sin arriesgarse a decírselo al tutor, que no tiene
          // ninguno.
          counterpartRole={conversation.counterpartRole}
          // Solo cuando el otro es el tutor: es el único que tiene mentorías
          // que reservar.
          reservarHref={
            conversation.counterpartRole === "tutor"
              ? `/tutores/${conversation.counterpartId}`
              : undefined
          }
          blocked={conversation.blocked}
          currentUserId={user.id}
          initialMessages={initial}
        />
      </Section>
    </Container>
  );
}

/** G3 · el hilo de una clase grupal, con quién está dentro. `null` si no es
 *  un hilo de grupo o si quien mira no es miembro.
 *
 *  P45 · los errores SE LANZAN (regla de oro 10): convertirlos en `null`
 *  mandaba el hilo de grupo a la rama de par o a un 404, y en `[]` pintaba un
 *  grupo vacío. Mejor la pantalla de error que una mentira creíble. */
async function hiloDeGrupo(id: string) {
  const supabase = await createClient();
  const { data: c, error } = await supabase
    .from("conversations")
    .select("id, group_product_id, products!conversations_group_product_id_fkey(title)")
    .eq("id", id)
    .eq("kind", "group")
    .maybeSingle();
  if (error) throw new Error(`hilo de grupo: ${error.message}`);
  if (!c?.group_product_id) return null;
  const [msgs, inscritos] = await Promise.all([
    supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", c.id)
      .order("created_at"),
    supabase.rpc("inscritos_de_clase", { p_product: c.group_product_id }),
  ]);
  if (msgs.error) throw new Error(`mensajes del grupo: ${msgs.error.message}`);
  if (inscritos.error) {
    throw new Error(`inscritos del grupo: ${inscritos.error.message}`);
  }
  return {
    id: c.id,
    titulo: c.products?.title ?? "Clase grupal",
    mensajes: (msgs.data ?? []).map(toChatMessage),
    grupal: grupalDe(inscritos.data),
  };
}

/**
 * M31 · La cabecera del chat del grupo: las caras apiladas (hasta cuatro y
 * «+N») y la lista de nombres, con «(tú)» detrás del propio y la insignia
 * «Tutor» — con once personas, saber quién da la clase es lo primero.
 */
function Participantes({ miembros, yo }: { miembros: MiembroGrupo[]; yo: string }) {
  const visibles = miembros.slice(0, 4);
  const resto = miembros.length - visibles.length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <span className="flex shrink-0 -space-x-1.5" aria-hidden>
        {visibles.map((m) => {
          const foto = storageUrl("avatars", m.avatarPath);
          return (
            <span
              key={m.userId}
              className="grid size-7 place-items-center overflow-hidden rounded-full bg-[#e0eeff] text-[10px] font-semibold text-brand ring-2 ring-background"
            >
              {foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={foto} alt="" className="size-7 object-cover" />
              ) : (
                initialsFrom(m.nombre)
              )}
            </span>
          );
        })}
        {resto > 0 ? (
          <span className="grid size-7 place-items-center rounded-full bg-muted text-[10px] font-semibold ring-2 ring-background">
            +{resto}
          </span>
        ) : null}
      </span>
      <span>
        {miembros.map((m, i) => (
          <span key={m.userId}>
            {i > 0 ? ", " : null}
            {m.nombre}
            {m.userId === yo ? " (tú)" : null}
            {m.esTutor ? (
              <span className="ml-1 rounded-full bg-brand-muted px-1.5 py-px text-[11px] font-semibold text-brand-foreground">
                Tutor
              </span>
            ) : null}
          </span>
        ))}
      </span>
    </div>
  );
}
