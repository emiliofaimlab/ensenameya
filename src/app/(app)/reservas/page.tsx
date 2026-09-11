import Link from "next/link";

import {
  getFormatoHora,
  getUserTimezone,
  requireUser,
} from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { PrecioEnLinea } from "@/components/precio/precio";
import {
  BOOKING_STATUS_LABEL,
  bookingFormatLabel,
  bookingTotal,
  porProximidad,
  sesionVigente,
  tutorNames,
} from "@/lib/booking";
import { salaDeLaReserva } from "@/lib/room-window";
import { BookingRow } from "@/components/booking-row";
import { EmptyResults } from "@/components/catalog/empty-results";
import {
  RegaloPorAgendar,
  RegalosCerrados,
  regaloPorAgendar,
  type RegaloRecibido,
} from "@/components/regalo/regalo-recibido";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { categoriesWithOffer } from "../app/sugerencias";
import type { Database } from "@/lib/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const metadata = { title: "Mis reservas · Enséñame Ya" };

type BookingStatus = Database["public"]["Enums"]["booking_status"];

const OPEN = new Set<BookingStatus>([
  "pending_payment",
  "pending_acceptance",
  "confirmed",
  "in_progress",
]);

/**
 * Los créditos de REGALO de quien mira, por la vista y nunca por la tabla.
 *
 * ⚠️ `credits` tiene `grant select` POR COLUMNAS (`20260912110000:442`), así que
 * un `.select("*")` contra la tabla responde `permission denied` — no una lista
 * vacía, un error. `mis_creditos` es la superficie prevista: `security_invoker`,
 * columnas explícitas y ya filtrada a `beneficiary_id = auth.uid()`.
 *
 * Se filtra a `source = 'gift'`: las recompensas de referido también viven en
 * esta vista y tienen su propia pantalla (`/referidos`); aquí no pintan nada.
 *
 * ⚠️ Y se dejan fuera los `pending_payment` a propósito. Un regalo nace sin
 * cobrar, y `reclamar_regalos_por_correo` ata al destinatario los que están en
 * `pending_payment` **y** en `active` (`20260912110000:2558`): sin este filtro,
 * un regalo que el comprador empezó y abandonó le saldría en pantalla a quien
 * lo iba a recibir y desaparecería solo a los 30 días cuando `caducar_creditos`
 * lo pase a `revoked`. Prometer una mentoría que nadie pagó es peor que no
 * decir nada.
 */
function leerRegalos(supabase: SupabaseClient<Database>) {
  return supabase
    .from("mis_creditos")
    .select(
      "id, status, amount, currency, product_id, gift_message, expires_at, consumed_at, created_at",
    )
    .eq("source", "gift")
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false });
}

/**
 * US-603 — el alumno ve sus reservas: estado, horario y total. No tiene frame
 * propio en el Figma; hereda el armazón y la fila de AL02, y cada fila enlaza
 * al detalle (AL03) — antes la lista no tenía ni un solo enlace.
 *
 * Desde los créditos (`20260912110000`) esta pantalla es TAMBIÉN donde aterriza
 * un regalo: el cliente lo pidió literal —«al destinatario le aparece en *Mis
 * reservas* como un regalo pendiente de agendar»—. Un regalo sin agendar no es
 * una reserva (no hay `bookings`, ni `sessions`, ni hueco tomado), así que no
 * se cuela en las listas: va en su propia tarjeta, arriba. Ver
 * `components/regalo/regalo-recibido.tsx`.
 */
export default async function ReservasPage() {
  const { user } = await requireUser();
  // Zona y formato juntos: son las dos mitades de «qué hora es para quien
  // mira», y las dos son lecturas baratas que no deben encadenarse.
  const [tz, formato] = await Promise.all([
    getUserTimezone(),
    getFormatoHora(),
  ]);

  const supabase = await createClient();

  /**
   * ── EL RECLAMO, Y POR QUÉ HACE FALTA ADEMÁS DEL TRIGGER ──────────────────
   *
   * Un regalo se compra contra un CORREO, no contra una cuenta: `comprar_regalo`
   * no resuelve quién es el destinatario a propósito (hacerlo sería un oráculo
   * gratis de «¿existe esta dirección en Enséñame Ya?», y `profiles` es
   * own-only). Quien lo ata a su dueño es `reclamar_regalos_por_correo`, y el
   * ÚNICO momento en que puede hacerlo con seguridad es cuando el correo está
   * PROBADO: por eso cuelga de `notify_email_confirmed()`, el trigger del
   * `update auth.users` con el que GoTrue marca `email_confirmed_at`.
   *
   * 🔴 Ese trigger es `after update of email_confirmed_at`, así que **no se
   * dispara nunca** cuando el `email_confirmed_at` llega ya puesto en el
   * INSERT. Y eso pasa en tres caminos vivos de este proyecto: dev (la
   * confirmación de correo está APAGADA, al revés que prod), Google OAuth (el
   * correo viene probado por Google) y el checkout de invitado. En los tres, el
   * regalo se queda con `beneficiary_id = null` para siempre: pagado, cobrado y
   * sin que nadie lo vea. Ese es el agujero que tapa `reclamar_mis_regalos()`,
   * que no toma argumentos —solo puede reclamar para `auth.uid()`— y es
   * idempotente: su `update` no encuentra nada cuando ya no queda qué atar.
   *
   * Se engancha AQUÍ, en el render de la pantalla donde el cliente dijo que el
   * regalo tiene que aparecer, y no detrás de un botón: un botón «reclamar mi
   * regalo» solo lo pulsa quien ya sabe que tiene uno, y el caso que duele es
   * justo el contrario. Escribe durante el render de un Server Component a
   * sabiendas, con el precedente de `ensureMemberships` en `/referidos`.
   *
   * ⚠️ Va en PARALELO con la lectura, no delante, y por eso hay una relectura:
   * encadenarlas le añadiría un peldaño a la cascada en las 999 visitas de cada
   * 1000 en las que no hay nada que reclamar (CLAUDE.md · «mira la PROFUNDIDAD
   * de la cascada»). La relectura solo ocurre la primera vez que alguien entra
   * con un regalo esperándole.
   */
  const [bookingsRes, regalosRes, reclamados] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        // Las columnas de ventana viajan con la sesión: sin ellas esta lista no
        // puede saber si la sala está abierta, y el cliente pidió el botón
        // «Entrar a sala» aquí también — hasta hoy solo lo tenía el panel, así
        // que desde la lista había que entrar al detalle para llegar a la clase.
        // Ver `salaDeLaReserva`.
        "id, status, total_amount, currency, products(title, tutor_id), sessions(id, start_at, end_at, status, access_opens_at, access_closes_at)",
      )
      .eq("student_id", user.id)
      .order("created_at", { ascending: false }),
    leerRegalos(supabase),
    supabase.rpc("reclamar_mis_regalos"),
  ]);

  const regalosLeidos =
    (reclamados.data ?? 0) > 0 ? await leerRegalos(supabase) : regalosRes;

  // Regla de oro 10 · el `error` SE MIRA. `const { data } = …` convierte un
  // fallo en una lista vacía, y esta pantalla tiene dos estados vacíos que son
  // afirmaciones: «Aún no tienes reservas» y la ausencia de la tarjeta del
  // regalo. La segunda es la cara: alguien pagó por eso y el destinatario no
  // tendría forma de saber que existe.
  const errorReservas = bookingsRes.error;
  const bookings = bookingsRes.data ?? [];
  const filasDeRegalo = regalosLeidos.data ?? [];

  // El reclamo que falla no pinta aviso —no afirma que no haya regalos, solo
  // que no se pudo atar ninguno ahora mismo, y el trigger de la confirmación
  // sigue siendo el otro camino— pero tampoco se traga en silencio: si esto
  // empieza a fallar, el síntoma en pantalla es «no tengo ningún regalo» y sin
  // esta línea no habría por dónde empezar a mirar.
  if (reclamados.error) {
    console.error(
      "[reservas] no se pudo reclamar los regalos:",
      reclamados.error.message,
    );
  }

  /**
   * La ficha de las mentorías regaladas. Va en consulta aparte porque el regalo
   * solo guarda el `product_id` — y solo se pide si hay regalos, de modo que la
   * pantalla sin ninguno mantiene EXACTAMENTE la cascada que tenía (reservas →
   * tutores), sin un peldaño nuevo.
   *
   * ⚠️ Puede volver corta o vacía sin que sea un error: `products_select_public`
   * pide `status = 'active'` **y** tutor aprobado. Una mentoría archivada deja
   * a su regalo sin ficha, y eso la tarjeta lo sabe pintar.
   */
  const idsDeProducto = [
    ...new Set(filasDeRegalo.map((r) => r.product_id).filter(Boolean)),
  ] as string[];

  const productosRes = idsDeProducto.length
    ? await supabase
        .from("products")
        .select(
          "id, title, tutor_id, pricing_model, price_amount, session_duration_min, package_num_sessions",
        )
        .in("id", idsDeProducto)
    : null;

  // `as const` en la tupla y no por gusto: sin él TypeScript infiere
  // `(string | Producto)[][]` y el constructor de `Map` no lo acepta.
  const productos = new Map(
    (productosRes?.data ?? []).map((p) => [p.id, p] as const),
  );

  // Regla de oro 10 · las DOS lecturas del regalo cuentan. Si la de productos
  // se cae, el `Map` queda vacío y cada tarjeta caería en su rama de «sin
  // ficha» — que es cierta para una mentoría archivada y falsa para un fallo de
  // red. La tarjeta no puede distinguirlas, así que lo dice el aviso de arriba.
  const errorRegalos = regalosLeidos.error ?? productosRes?.error ?? null;

  // Un solo viaje a los tutores para las dos superficies: las reservas y los
  // regalos. `tutorNames` lee `tutor_profiles` (la tabla que hay debajo de
  // `tutors_public`), que sí tiene política pública para los aprobados —
  // `profiles` es own-only y devolvería vacío.
  const names = await tutorNames(supabase, [
    ...bookings.map((b) => b.products?.tutor_id),
    ...[...productos.values()].map((p) => p.tutor_id),
  ]);

  /**
   * V-6 · El «con Fulanito» de cada fila lleva ahora a su ficha pública — hasta
   * hoy era texto muerto y, comprada la mentoría, no había forma de volver al
   * tutor.
   *
   * ⚠️ Solo si es legible, y `names` YA es esa comprobación: `tutorNames` sale
   * de `tutor_profiles`, que solo se lee con `approval_status = 'approved'`. A
   * un tutor desaprobado no se le enlaza — su ficha daría un 404 desde el panel
   * del propio alumno. Ver `tutorCards`.
   */
  const perfilDelTutor = (id: string | null | undefined) =>
    id && names.has(id) ? `/tutors/${id}` : undefined;

  const regalos: RegaloRecibido[] = filasDeRegalo.map((r) => {
    const p = r.product_id ? productos.get(r.product_id) : undefined;
    const sesiones =
      p?.pricing_model === "per_package" ? (p.package_num_sessions ?? 1) : 1;
    return {
      id: r.id as string,
      status: r.status ?? "",
      amount: r.amount ?? 0,
      currency: r.currency ?? "USD",
      productId: r.product_id,
      giftMessage: r.gift_message,
      expiresAt: r.expires_at,
      consumedAt: r.consumed_at,
      producto: p
        ? {
            titulo: p.title,
            // Le dice al destinatario cuántos horarios va a elegir: un paquete
            // le pedirá N y eso no se descubre bien a mitad del calendario.
            formato: bookingFormatLabel(sesiones),
            tutor: names.get(p.tutor_id),
            tutorHref: perfilDelTutor(p.tutor_id),
            // La MISMA aritmética que congeló `comprar_regalo`
            // (`20260912110000:2216`), que a su vez es la de
            // `create_booking_line`. Sirve para decir la verdad sobre si al
            // agendar hay que pagar diferencia; el importe que mande sigue
            // saliendo del servidor (regla de oro 2).
            totalHoy: bookingTotal({
              pricingModel: p.pricing_model,
              priceAmount: p.price_amount,
              sessionDurationMin: p.session_duration_min,
            }),
          }
        : null,
    };
  });

  const regalosVivos = regalos.filter(regaloPorAgendar);
  const regalosCerrados = regalos.filter((r) => !regaloPorAgendar(r));

  // En curso primero, luego las próximas por fecha y hora. El «Historial» se
  // queda como está: sin sesión viva todas empatan y el sort estable conserva
  // el `created_at desc` de la consulta.
  const open = bookings.filter((b) => OPEN.has(b.status)).sort(porProximidad);
  const closed = bookings.filter((b) => !OPEN.has(b.status));

  // RV-11 · las burbujas del estado vacío. Se piden SOLO cuando no hay ninguna
  // reserva: son dos consultas más, y en la pantalla que sí tiene reservas
  // nadie las vería. Van con oferta filtrada porque mandar al alumno a una
  // categoría sin mentorías es el mismo callejón del que se le quiere sacar.
  // No se pintan si la consulta falló: «aún no tienes reservas» sería mentira.
  //
  // ⚠️ Ni tampoco si hay un regalo esperando. Quien acaba de recibir uno y
  // todavía no ha reservado nada cumple las dos condiciones a la vez, y
  // enseñarle «Aún no tienes reservas · Ver las mentorías disponibles» justo
  // debajo de su regalo es mandarle a buscar —y a pagar— lo que ya tiene. El
  // estado vacío existe para dar una salida a quien no tiene ninguna; el
  // regalo YA es esa salida, y además es mejor.
  const vacio =
    !errorReservas && bookings.length === 0 && regalosVivos.length === 0;
  const conOferta = vacio ? await categoriesWithOffer() : [];

  /** La sesión que representa a la reserva: la vigente, o la última que hubo.
   *  Es la MISMA que ordena la lista — antes filtraba por `start_at`, así que
   *  durante la clase la fila saltaba a mostrar la sesión siguiente y la fecha
   *  contradecía al orden. */
  const when = (b: (typeof bookings)[number]) => {
    const all = [...(b.sessions ?? [])].sort((x, y) =>
      x.start_at.localeCompare(y.start_at),
    );
    return sesionVigente(all)?.start_at ?? all.at(-1)?.start_at ?? null;
  };

  const row = (b: (typeof bookings)[number]) => {
    // El mismo criterio del panel del alumno, ahora en un solo sitio: reserva
    // en `confirmed`/`in_progress` **y** sesión dentro de su ventana de acceso.
    // Sin la segunda mitad el botón saldría para una clase de dentro de tres
    // semanas y el servidor la rechazaría.
    const sala = salaDeLaReserva(b.status, b.sessions);
    return (
      <BookingRow
        key={b.id}
        href={`/reservas/${b.id}`}
        tutor={names.get(b.products?.tutor_id ?? "")}
        tutorHref={perfilDelTutor(b.products?.tutor_id)}
        title={b.products?.title ?? "Mentoría"}
        when={when(b)}
        timeZone={tz}
        formato={formato}
        status={BOOKING_STATUS_LABEL[b.status]}
        note={<PrecioEnLinea amountMinor={b.total_amount} currency={b.currency} />}
        action={
          sala ? (
            <Button
              asChild
              className="h-[38px] rounded-[8px] px-4 text-[13px] font-semibold"
            >
              <Link href={`/room/${sala.id}`}>Entrar a sala</Link>
            </Button>
          ) : (
            <Button
              asChild
              variant="outline"
              className="h-[38px] rounded-[8px] px-4 text-[13px] text-[#4d4d4d]"
            >
              <Link href={`/reservas/${b.id}`}>Ver detalle</Link>
            </Button>
          )
        }
      />
    );
  };

  return (
    <PanelShell>
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-[#19191f]">
          Mis reservas
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          El estado de tus mentorías y sus horarios.
        </p>
      </div>

      {/* Lo accionable, arriba: un regalo cobrado y sin agendar es lo único de
          esta pantalla que espera a que alguien haga algo. */}
      {regalosVivos.map((r) => (
        <RegaloPorAgendar key={r.id} regalo={r} timeZone={tz} />
      ))}

      {/* Regla de oro 10 · si la lectura de los regalos se cae, se DICE. El
          silencio aquí es la pantalla de siempre, indistinguible de «no te han
          regalado nada» — y alguien pagó por lo contrario. */}
      {errorRegalos ? (
        <PanelCard className="border-[#f0bfbf] bg-[#fdf5f5]">
          <p className="text-[13px] text-[#bf3333]">
            No pudimos comprobar si tienes algún regalo pendiente de agendar.
            Recarga la página; si vuelve a fallar, escríbenos a soporte antes de
            reservar: puede que no tengas que pagar.
          </p>
        </PanelCard>
      ) : null}

      {errorReservas ? (
        <PanelCard className="border-[#f0bfbf] bg-[#fdf5f5]">
          <p className="text-[13px] text-[#bf3333]">
            No pudimos cargar tus reservas. Recarga la página; si vuelve a
            fallar, escríbenos a soporte.
          </p>
        </PanelCard>
      ) : null}

      {vacio ? (
        // RV-11 · el mismo estado vacío del catálogo, no otro inventado aquí:
        // frase + salida + categorías reales. Antes era un párrafo y un botón a
        // /tutors, o sea "busca tú" — que en una lista vacía es justo el hueco
        // que hay que evitar.
        <PanelCard>
          <PanelCardTitle className="text-[22px]">
            Aún no tienes reservas
          </PanelCardTitle>
          <EmptyResults
            className="mt-3"
            message="Cuando reserves una mentoría, aquí verás su estado, su horario y su total."
            action={{ href: "/classes", label: "Ver las mentorías disponibles" }}
            categories={conOferta}
          />
        </PanelCard>
      ) : null}

      {open.length > 0 ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">Activas</PanelCardTitle>
          <ul className="mt-4 divide-y divide-[#e0e0e0]">{open.map(row)}</ul>
        </PanelCard>
      ) : null}

      {closed.length > 0 ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">Historial</PanelCardTitle>
          <ul className="mt-4 divide-y divide-[#e0e0e0]">{closed.map(row)}</ul>
        </PanelCard>
      ) : null}

      {/* Los que ya no piden nada, al final y en gris: se ven, pero no compiten
          con lo accionable ni con las reservas de verdad. */}
      <RegalosCerrados regalos={regalosCerrados} timeZone={tz} />
    </PanelShell>
  );
}
