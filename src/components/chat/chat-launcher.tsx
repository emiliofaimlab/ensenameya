import { getSessionContext } from "@/lib/auth/server";
import { ChatBubble } from "./chat-bubble";
import { listConversations } from "./conversations";

/**
 * R24-21 — burbuja flotante de chat, **solo con sesión** (decisión 15).
 *
 * ── M-12 · qué cambió aquí ──────────────────────────────────────────────────
 * Antes esto listaba RESERVAS —con su filtro de estados y su cálculo de "¿ya
 * abrió la ventana de RN-41?"— porque el chat era de la reserva. Ahora lista
 * CONVERSACIONES, que es una llamada y ningún cálculo: `my_conversations()`
 * resuelve en el servidor con quién hablas, si hubo compra y de qué mentoría.
 *
 * De paso se fueron dos cosas que ya no aplican:
 *  · `OPEN_STATUSES` y la ventana de 2 días. Un hilo que existe antes de la
 *    compra no se puede filtrar por el estado de una reserva que no hay, y el
 *    candado de RN-41 dejó de poder cerrar nada (el razonamiento largo está en
 *    la migración `20260817210000` y en `chat-thread.tsx`).
 *  · El baile de `chatCounterparts` para averiguar el nombre del otro por dos
 *    caminos distintos según el rol. Sigue habiendo dos caminos —el del tutor
 *    es público, el del alumno privado— pero ahora viven dentro de la función
 *    SQL, que es donde se puede razonar sobre ellos con la RLS delante.
 *
 * ⚠️ AB-01 sigue vivo y sin decidir para el chat de reserva: `expires_at` se
 * calcula por MENSAJE, así que esa parte de la conversación se erosiona por
 * arriba. Lo pre-compra sí caduca de una pieza (decisión b de M-12).
 *
 * ── Por qué `getSessionContext()` y no `getUser()` ──────────────────────────
 * Porque no cuesta nada: `getUser()` es literalmente
 * `(await getSessionContext()).user`, así que la consulta de roles ya se estaba
 * pagando y se estaba tirando. Con ella, el estado vacío de la burbuja puede
 * hablarle a un tutor como a un tutor.
 */
export async function ChatLauncher() {
  const { user, roles } = await getSessionContext();
  if (!user) return null;

  const todas = await listConversations();

  /*
   * ── EL FILTRO DE HILOS VACÍOS, REESCRITO ─────────────────────────────────
   *
   * Un hilo puede existir ANTES de que se escriba el primer mensaje: lo crean
   * `open_conversation` (el botón «Escribir a X» de la ficha pública) y el
   * trigger `bookings_ensure_conversation`, que dispara con la reserva todavía
   * en `pending_payment` — y `pending_payment` NO cuenta como reserva para
   * `pair_booking_stats`, así que esos llegan aquí con `hasBooking` en false.
   *
   * ⚠️ EL COMENTARIO QUE HABÍA AQUÍ AFIRMABA DOS COSAS FALSAS, y conviene
   * dejarlo escrito para que no vuelvan: decía que «quien abre hilos vacíos ya
   * no es la ficha pública del tutor —`open_conversation` exige reserva desde
   * el 20-ago—» y que ese botón «ya no existe». Las dos las revirtió **EY-194**
   * el 26-ago (`20260826140000`): `pair_can_chat` volvió a ser `true` y
   * `contact-tutor.tsx` volvió del histórico. Hoy la ficha pública es otra vez
   * la principal fábrica de hilos vacíos.
   *
   * ── QUÉ SE FILTRA AHORA, Y POR QUÉ NO ES SIMÉTRICO ───────────────────────
   * El filtro se queda, pero solo del lado de quien NO abrió el hilo:
   *
   *  · **A quien es el ALUMNO del par** (`counterpartRole === "tutor"`, que es
   *    exactamente lo que dice `other_is_tutor` en la RPC: «el otro es el
   *    tutor», o sea «yo soy el alumno») se le enseña el hilo aunque esté
   *    mudo. Es SUYO: lo abrió él pulsando «Escribir a X». Escondérselo era el
   *    agujero de verdad — abría el chat desde la ficha del tutor, cerraba el
   *    hilo sin escribir y la conversación desaparecía de su bandeja, que se
   *    lee como que la aplicación se la ha comido.
   *  · **A quien es el TUTOR del par** se le sigue escondiendo. Aquí el hilo
   *    vacío no es suyo: es alguien que abrió el chat y se arrepintió, o un
   *    checkout abandonado. Y ahora importa más que antes, porque EY-194
   *    reabrió el canal y `open_conversation` deja abrir **10 hilos nuevos por
   *    alumno y día**: sin este filtro, plantar diez filas mudas en la bandeja
   *    de diez tutores es gratis y no requiere escribir ni una palabra.
   *
   * El precio, dicho en voz alta: al alumno le aparece también el hilo de un
   * checkout que abandonó, con el que nunca llegó a hablar. Se acepta —tras
   * EY-194 escribirle a ese tutor es una acción legítima y el hilo ya está
   * abierto—, y de todas formas se purga solo a los 30 días si nadie escribe
   * (`purge_expired_messages`, L1-4).
   */
  const conversations = todas
    .filter(
      (c) =>
        c.lastMessageAt !== null ||
        c.hasBooking ||
        c.counterpartRole === "tutor",
    )
    // Tope de cortesía: la bandeja es una lista corta con scroll, no un
    // buscador. Vienen ordenadas por actividad, así que lo que se corta es lo
    // más antiguo. (El día que haga falta más, esto pide paginación, no un
    // número más grande.)
    //
    // ⚠️ Este corte es una de las dos razones por las que la burbuja sabe
    // resolver una conversación por su cuenta contra `my_conversations()`: un
    // hilo que caiga fuera de los 30 sigue siendo alcanzable por enlace, y
    // tiene que poder abrirse. La otra es que esta lista es una foto del último
    // render y un hilo creado hace dos segundos no está en ella.
    .slice(0, 30);

  return (
    <ChatBubble
      conversations={conversations}
      currentUserId={user.id}
      esTutor={roles.includes("tutor")}
    />
  );
}
