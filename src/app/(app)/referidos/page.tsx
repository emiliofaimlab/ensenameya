import { headers } from "next/headers";
import { GraduationCapIcon, UsersIcon } from "lucide-react";

import { requireUser, getUserTimezone } from "@/lib/auth/server";
import { panelMenu } from "@/lib/auth/panel-items";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatShortDate } from "@/lib/booking";
// El buzón real del §39 del contrato, de una sola fuente (lib/company.ts).
import { COMPANY } from "@/lib/company";
import {
  createUser,
  isReferralFactoryConfigured,
  qrUrlDe,
  ReferralFactoryError,
} from "@/lib/referral-factory";
import type { Json } from "@/lib/database.types";
import {
  PanelShell,
  PanelCard,
  PanelCardTitle,
  StatusPill,
} from "@/components/layout/panel-shell";
import { LinkActions, RefrescarCuandoLlegueElEnlace } from "./link-actions";

export const metadata = { title: "Invita y gana · Enséñame Ya" };

/**
 * US-1301 · «Invita y gana», ahora NATIVA (migración `20260911120000`).
 *
 * ── QUÉ CAMBIÓ Y POR QUÉ ───────────────────────────────────────────────────
 * Hasta el 10-sep esto era un iframe de Referral Factory con un `notFound()`
 * delante: el programa lo decidía el panel del que venías, el enlace lo emitía
 * RF y la atribución **no existía** —la landing de RF no redirige de vuelta, así
 * que el `?ref=` nunca llegaba y `profiles.referral_code` era null siempre—.
 *
 * Ahora la pantalla es la MISMA para todos y pinta las campañas visibles: ya no
 * hay dos destinos entre los que equivocarse, así que se cae todo el reparto por
 * rol/panel (y con él la clase de fallo que describía B1.11). Tampoco hay
 * `notFound()`: la pantalla existe para cualquiera con sesión.
 *
 * ⚠️ SE PINTA ENTERA DESDE NUESTRA BASE. Cero llamadas a RF al renderizar, y no
 * por elegancia: medido el 10-sep, RF tiene picos de más de 25 s (3 de 40
 * llamadas). La única llamada que se hace aquí es el alta del referidor, y va
 * detrás de un `allSettled` con timeout de 8 s (ver `ensureMemberships`).
 */

type Campaña = {
  rf_campaign_id: number;
  audience: string;
  title: string;
  reward_text: string;
  visible: boolean;
};

/**
 * Alta del referidor en RF, una vez por campaña visible.
 *
 * ⚠️ ESCRIBE DURANTE EL RENDER DE UN SERVER COMPONENT, a sabiendas. Es
 * idempotente por la PK compuesta `(profile_id, rf_campaign_id)` y el insert va
 * con `ignoreDuplicates`, así que dos pestañas a la vez no revientan: la
 * segunda no inserta nada.
 *
 * ⚠️ `ignoreDuplicates` Y NO UN UPSERT DE VERDAD, y no es preferencia de
 * estilo: `service_role` tiene `grant select, insert` sobre esta tabla y NO
 * `update` (`20260911120000`). Un upsert con `resolution=merge-duplicates`
 * emite `on conflict do update` y se comería un `permission denied` **en
 * ejecución** —ni el build ni el typecheck lo ven— que es exactamente la regla
 * de oro 9.
 *
 * ⚠️ NO HAY CARRERA QUE PERDER, y por eso no se relee la fila. Dos pestañas a
 * la vez llaman las dos a `createUser` con el mismo correo y la misma campaña,
 * y RF devuelve a las dos el MISMO usuario con el MISMO código (medido el
 * 11-sep contra la API real). El `ignoreDuplicates` está para que la segunda
 * escritura no reviente, no para arbitrar entre dos códigos distintos.
 *
 * `authenticated` no puede insertar aquí a propósito (nadie se inventa un
 * código ajeno), por eso el `service_role`.
 */
type AltaEnRf = {
  codigos: Map<number, string>;
  /**
   * Campañas en las que RF dijo que NO y no va a cambiar de opinión (un 4xx que
   * no es reintentable). Se separan de las que fallaron por un mal minuto
   * porque la pantalla tiene que decir cosas distintas: «Preparando tu
   * enlace…» es verdad en el segundo caso y MENTIRA en el primero.
   */
  rechazadas: Set<number>;
};

async function ensureMemberships(
  perfil: { id: string; email: string | null; nombre: string | null },
  campañas: Campaña[],
  yaTiene: Map<number, string>,
): Promise<AltaEnRf> {
  const nada: AltaEnRf = { codigos: yaTiene, rechazadas: new Set() };
  const faltan = campañas.filter((c) => !yaTiene.has(c.rf_campaign_id));
  // La credencial es el interruptor (CLAUDE.md): sin ella no se llama a RF y
  // las tarjetas lo dicen. Nada revienta.
  if (faltan.length === 0 || !isReferralFactoryConfigured()) return nada;

  const email = perfil.email?.trim();
  // RF exige correo para dar de alta. Sin él no hay nada que intentar.
  if (!email) return nada;
  const first_name = perfil.nombre?.trim().split(/\s+/)[0] || email.split("@")[0];

  // ⚠️ FUERA DEL `allSettled` NO, DENTRO DE UN `try` SÍ. `createAdminClient()`
  // LANZA si falta `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/admin.ts:29`), y
  // aquí eso tumbaba la pantalla entera con un 500 en vez de caer al aviso —
  // que es justo lo contrario de «la credencial es el interruptor». Los dos
  // handlers de admin de este mismo cambio ya lo envuelven; esto lo iguala.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    console.error("[referidos] sin service_role, no se puede dar de alta en RF", e);
    return nada;
  }

  const resultados = await Promise.allSettled(
    faltan.map(async (c) => {
      const { data: u } = await createUser({
        campaign_id: c.rf_campaign_id,
        first_name,
        email,
      });
      // ⚠️ SIN `.select()`, Y ESO ARREGLA UN FALLO QUE SE VIO EJECUTANDO, NO
      // LEYENDO. Con `ignoreDuplicates` PostgREST manda `on conflict do
      // nothing` y NO devuelve representación, así que un `.select().
      // maybeSingle()` sale `null` — también cuando el insert ha ido bien. El
      // código leía ese `null` como "carrera perdida" y tiraba la tarjeta a
      // «Preparando tu enlace…»: o sea, en la PRIMERA visita de cada persona,
      // siempre, con la fila ya escrita en la tabla. Medido el 11-sep en dev.
      //
      // Y no hace falta releer: `u.code` ES el código bueno. Una pestaña que
      // corriera a la vez habría llamado a `createUser` con el mismo correo y
      // la misma campaña, y eso —MEDIDO contra la API real— devuelve el MISMO
      // usuario con el MISMO código. No hay carrera que perder.
      const { error } = await admin.from("referral_memberships").upsert(
        {
          profile_id: perfil.id,
          rf_campaign_id: c.rf_campaign_id,
          rf_user_id: u.id,
          code: u.code,
          url: u.url,
          // El array `[{social,url}]` de RF cruza tal cual a `jsonb`: se
          // guarda crudo porque sus redes pueden cambiar sin avisarnos.
          sharing: (u.sharing ?? []) as Json,
          qr_url: qrUrlDe(u),
        },
        { onConflict: "profile_id,rf_campaign_id", ignoreDuplicates: true },
      );
      if (error) throw error;
      return [c.rf_campaign_id, u.code] as const;
    }),
  );

  const codigos = new Map(yaTiene);
  const rechazadas = new Set<number>();

  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") {
      codigos.set(r.value[0], r.value[1]);
      return;
    }

    const campaña = faltan[i].rf_campaign_id;
    console.error(`[referidos] alta en RF · campaña ${campaña}`, r.reason);

    // ⚠️ UN 4xx QUE NO ES REINTENTABLE NO ES «PREPARANDO TU ENLACE…», y
    // enseñarlo así es la peor de las dos mentiras posibles: promete algo que
    // no va a llegar NUNCA y, con el refresco de los 10 s, además vuelve a
    // pegarle a RF en cada carga.
    //
    // El caso real que lo destapó (11-sep, preview de dev): RF **rechaza los
    // dominios sin MX**. `camila.duarte@ensenameya.dev` devuelve
    // `422 The email must be a valid email address`, y 18 de las cuentas de
    // prueba de dev usan ese dominio. No es un fallo del programa —un usuario
    // de verdad trae un correo de verdad— pero la pantalla tenía que saberlo
    // decir.
    //
    // Un mal minuto de RF (timeout, 429, 5xx) SÍ se queda en «Preparando tu
    // enlace…»: ahí el reintento es la respuesta correcta y además es seguro,
    // porque `createUser` con el mismo correo y la misma campaña devuelve el
    // MISMO usuario (medido).
    // ⚠️ Y UN ERROR DE LA BASE TAMBIÉN ES UN «NO». Antes solo contaba un
    // `ReferralFactoryError` permanente, así que un fallo del insert caía por
    // el hueco y volvía a decir «Preparando tu enlace…». Lo destapó producción
    // el 11-sep: RF respondía perfectamente y lo que fallaba era un `23505`
    // —el `code` que devolvía RF ya lo tenía una cuenta dada de baja, ver
    // `20260911230000`—. La regla se invierte: solo un MAL MINUTO de RF
    // (timeout, 429, 5xx) sigue siendo «Preparando…»; todo lo demás se dice.
    const malMinutoDeRf =
      r.reason instanceof ReferralFactoryError && r.reason.retriable;
    if (!malMinutoDeRf) rechazadas.add(campaña);
  });

  return { codigos, rechazadas };
}

export default async function ReferidosPage() {
  const { user, roles, fullName } = await requireUser();
  const supabase = await createClient();

  const [{ items, badges }, tz, cabeceras, campañasRes, membershipsRes, invitadosRes] =
    await Promise.all([
      // El menú sigue al panel del que vienes, no al rol (ver `panelItems`).
      panelMenu(user.id, roles),
      getUserTimezone(),
      headers(),
      // Sin filtro de `visible` en SQL a propósito: la RLS ya lo aplica para
      // quien no es admin, y al admin le hacen falta las apagadas para poder
      // leer el programa de un invitado que entró por una campaña ya retirada.
      // El filtro para lo que SE OFRECE va en JS, dos líneas más abajo.
      supabase
        .from("referral_campaigns")
        .select("rf_campaign_id, audience, title, reward_text, visible")
        .order("sort_order"),
      supabase
        .from("referral_memberships")
        .select("rf_campaign_id, code")
        .eq("profile_id", user.id),
      supabase.rpc("referral_invitees"),
    ]);

  // ⚠️ Regla de oro 10. `const { data } = …` convertiría cualquiera de estos
  // tres fallos en una lista vacía, que aquí es la mentira más creíble que hay:
  // «todavía nadie ha entrado con tu enlace» se lee igual de bien roto que
  // funcionando. Por eso se miran, se registran, y abajo se distingue «cero»
  // de «no lo sé».
  if (campañasRes.error)
    console.error("[referidos] campañas", campañasRes.error.code, campañasRes.error.message);
  if (membershipsRes.error)
    console.error("[referidos] memberships", membershipsRes.error.code, membershipsRes.error.message);
  if (invitadosRes.error)
    console.error("[referidos] invitados", invitadosRes.error.code, invitadosRes.error.message);

  const todas: Campaña[] = campañasRes.data ?? [];
  const visibles = todas.filter((c) => c.visible);

  const codigos = new Map<number, string>(
    (membershipsRes.data ?? []).map((m) => [m.rf_campaign_id, m.code] as const),
  );
  // Si la lectura falló no se intenta ningún alta: RF crearía usuarios que ya
  // existen y devolvería 422 a partir de la segunda carga.
  const { codigos: conEnlace, rechazadas } = membershipsRes.error
    ? { codigos, rechazadas: new Set<number>() }
    : await ensureMemberships(
        { id: user.id, email: user.email, nombre: fullName },
        visibles,
        codigos,
      );

  /**
   * El origen sale de la propia petición y NO de una variable.
   *
   * Es lo mismo que hace `notifications-send` con `new URL(req.url).origin`:
   * así el enlace nunca apunta al entorno equivocado —dev repartiendo enlaces
   * de prod, o una preview repartiendo los de dev— y no hay una variable más
   * que acordarse de poner en cada entorno. Detrás de Vercel el host real viaja
   * en `x-forwarded-host`.
   */
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host");
  const origen = host ? `${cabeceras.get("x-forwarded-proto") ?? "https"}://${host}` : "";

  // `null` = no se pudo leer. Distinto de `[]`, que sí es «todavía nadie».
  const invitados = invitadosRes.error ? null : (invitadosRes.data ?? []);
  const convertidos = invitados?.filter((i) => i.converted_at).length ?? null;

  const porCampaña = new Map<number, { invitados: number; convertidos: number }>();
  for (const i of invitados ?? []) {
    const n = porCampaña.get(i.rf_campaign_id) ?? { invitados: 0, convertidos: 0 };
    n.invitados += 1;
    if (i.converted_at) n.convertidos += 1;
    porCampaña.set(i.rf_campaign_id, n);
  }

  const deCampaña = new Map(todas.map((c) => [c.rf_campaign_id, c] as const));
  const sinCredencial = !isReferralFactoryConfigured();

  return (
    <PanelShell
      items={items}
      badges={badges}
      eyebrow="Cuenta"
      title="Invita y gana"
      description="Invita alumnos y tutores con tus enlaces. Aquí ves quién entró y qué ganaste."
    >
      {/* §5.0 · LOS TRES EN UNA FILA TAMBIÉN EN MÓVIL. Apilados empujan las
          tarjetas de enlace —que es a lo que se viene— por debajo del pliegue. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {[
          {
            label: "Invitados",
            valor: invitados === null ? null : invitados.length,
            destacada: false,
          },
          { label: "Convertidos", valor: convertidos, destacada: false },
          // La recompensa se cuenta por conversión (RN-21: el monto lo fija RF,
          // nosotros solo contamos cuántas se ganaron).
          { label: "Recompensas", valor: convertidos, destacada: true },
        ].map((t) => (
          <PanelCard
            key={t.label}
            className={
              t.destacada
                ? "border-primary bg-[linear-gradient(180deg,#fff4ea_0%,#fff_100%)] p-3 text-center sm:p-4"
                : "p-3 text-center sm:p-4"
            }
          >
            <p className="text-[11px] text-[#6b6b6b]">{t.label}</p>
            {/* «—» y no «0» cuando la consulta falló: ver la regla de oro 10
                arriba. Un cero inventado es indistinguible de la verdad. */}
            <p className="mt-0.5 text-[22px] leading-tight font-bold text-[#19191f] tabular-nums sm:text-[26px]">
              {t.valor ?? "—"}
            </p>
          </PanelCard>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-[#19191f]">Tus enlaces</h2>

        {campañasRes.error ? (
          <PanelCard>
            <p className="text-[13px] text-[#6b6b6b]">
              No pudimos cargar tus enlaces ahora mismo. Vuelve a intentarlo en un
              momento.
            </p>
          </PanelCard>
        ) : visibles.length === 0 ? (
          <PanelCard>
            <p className="text-[13px] text-[#6b6b6b]">
              El programa de invitaciones todavía no está activo.
            </p>
          </PanelCard>
        ) : (
          // Una columna hasta 1024 (§5.0): a dos columnas la caja del enlace se
          // queda sin ancho y la url se corta antes de decir nada.
          <div className="grid gap-3 lg:grid-cols-2">
            {visibles.map((c) => {
              const alumnos = c.audience === "alumnos";
              const code = conEnlace.get(c.rf_campaign_id);
              // `encodeURIComponent`: el `code` lo emite RF, no un usuario, pero un
              // día que traiga un `&` o un `#` el enlace se rompe en silencio y
              // la atribución se pierde sin que nadie vea un error.
              const enlace =
                code && origen ? `${origen}/?ref=${encodeURIComponent(code)}` : null;
              const n = porCampaña.get(c.rf_campaign_id);

              return (
                <PanelCard key={c.rf_campaign_id} className="flex flex-col p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid size-10 shrink-0 place-items-center rounded-full ${
                        alumnos
                          ? "bg-primary/10 text-primary"
                          : "bg-brand-muted text-brand"
                      }`}
                    >
                      {alumnos ? (
                        <GraduationCapIcon className="size-5" />
                      ) : (
                        <UsersIcon className="size-5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <PanelCardTitle className="text-[16px]">{c.title}</PanelCardTitle>
                      {/* ⚠️ TEXTO PLANO, NO UN CHIP. La recompensa es una frase
                          entera («Ganas 1 clase gratis cuando…») y un chip que
                          envuelve a dos líneas rompe la lectura (guía «Compact
                          Label Overflow»). */}
                      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
                        {c.reward_text}
                      </p>
                    </div>
                  </div>

                  {enlace ? (
                    <LinkActions enlace={enlace} titulo={c.title} />
                  ) : (
                    <p className="mt-3 text-[12.5px] text-[#6b6b6b]">
                      {sinCredencial
                        ? "El programa de invitaciones todavía no está activo."
                        : rechazadas.has(c.rf_campaign_id)
                          ? `No hemos podido preparar tu enlace con este correo. Escríbenos a ${COMPANY.email.toLowerCase()} y lo resolvemos.`
                          : "Preparando tu enlace…"}
                      {/* El refresco SOLO cuando el enlace está de verdad en
                          camino. Sin credencial no hay nada que esperar, y con
                          un rechazo permanente pedir la pantalla cada 10 s es
                          pegarle a RF para que vuelva a decir que no. */}
                      {sinCredencial || rechazadas.has(c.rf_campaign_id) ? null : (
                        <RefrescarCuandoLlegueElEnlace />
                      )}
                    </p>
                  )}

                  {/* `mt-auto`: con dos tarjetas de distinta altura el pie se
                      queda alineado abajo en las dos. */}
                  {invitados === null ? null : (
                    <p className="mt-auto pt-3 text-[12px] text-[#6b6b6b] tabular-nums">
                      {n?.invitados ?? 0} invitados · {n?.convertidos ?? 0} convertidos
                    </p>
                  )}
                </PanelCard>
              );
            })}
          </div>
        )}
      </div>

      <PanelCard className="p-0">
        <h2 className="px-4 pt-4 text-base font-semibold text-[#19191f] sm:px-5 sm:pt-5">
          Historial
        </h2>

        {invitados === null ? (
          <p className="px-4 pt-2 pb-4 text-[13px] text-[#6b6b6b] sm:px-5 sm:pb-5">
            No pudimos cargar tu historial ahora mismo. Vuelve a intentarlo en un
            momento.
          </p>
        ) : invitados.length === 0 ? (
          <p className="px-4 pt-2 pb-4 text-[13px] text-[#6b6b6b] sm:px-5 sm:pb-5">
            Todavía nadie ha entrado con tu enlace.
          </p>
        ) : (
          <>
            {/* ⚠️ DOS MARCADOS, NO UNA TABLA RESPONSIVA. §5.0 pide tarjetas en
                móvil, y convertir `<tr>` en tarjetas a base de `display` deja
                una tabla que el lector de pantalla anuncia con una estructura
                que ya no existe. Los dos salen del MISMO `map`, así que no
                pueden divergir en los datos: solo en la forma.
                // ponytail: repetir 15 líneas de JSX es más barato que el
                // componente-fila que haría falta para no repetirlas. */}
            <div className="hidden overflow-x-auto px-5 pt-3 pb-5 md:block">
              <table className="w-full min-w-[560px] border-collapse">
                <thead>
                  <tr>
                    {["Invitado", "Programa", "Se registró", "Estado", "Recompensa"].map(
                      (h) => (
                        <th
                          key={h}
                          scope="col"
                          className="border-b border-[#e0e0e0] pr-3 pb-2.5 text-left text-[11px] font-semibold tracking-[0.05em] text-[#6b6b6b] uppercase"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {invitados.map((i) => {
                    const f = filaDe(i, deCampaña, tz);
                    return (
                      <tr key={i.id}>
                        <td className="border-b border-[#efefef] py-3.5 pr-3 align-middle text-[13px] font-medium text-[#19191f]">
                          {f.nombre}
                        </td>
                        <td className="border-b border-[#efefef] py-3.5 pr-3 align-middle">
                          <StatusPill tone="gray" className="whitespace-nowrap">
                            {f.programa}
                          </StatusPill>
                        </td>
                        <td className="border-b border-[#efefef] py-3.5 pr-3 align-middle text-[13px] text-[#4d4d4d]">
                          {f.fecha}
                        </td>
                        <td className="border-b border-[#efefef] py-3.5 pr-3 align-middle">
                          <StatusPill
                            tone={f.convertido ? "green" : "amber"}
                            className="whitespace-nowrap"
                          >
                            {f.estado}
                          </StatusPill>
                        </td>
                        <td className="border-b border-[#efefef] py-3.5 align-middle text-[13px] text-[#6b6b6b]">
                          {f.recompensa ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ul className="mt-2 divide-y divide-[#efefef] md:hidden">
              {invitados.map((i) => {
                const f = filaDe(i, deCampaña, tz);
                return (
                  <li key={i.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      {/* `min-w-0` + `truncate`: un nombre largo junto al chip
                          es lo que sacaba la barra horizontal a 390 px. */}
                      <span className="min-w-0 truncate text-[13.5px] font-semibold text-[#19191f]">
                        {f.nombre}
                      </span>
                      <StatusPill tone="gray" className="whitespace-nowrap">
                        {f.programa}
                      </StatusPill>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <span className="min-w-0 truncate text-[12px] text-[#6b6b6b]">
                        {f.fecha}
                      </span>
                      <StatusPill
                        tone={f.convertido ? "green" : "amber"}
                        className="whitespace-nowrap"
                      >
                        {f.estado}
                      </StatusPill>
                    </div>
                    {/* La recompensa solo cuando existe: en móvil una tercera
                        línea con «—» es ruido en todas las filas pendientes. */}
                    {f.recompensa ? (
                      <p className="text-[12px] text-[#6b6b6b]">{f.recompensa}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </PanelCard>
    </PanelShell>
  );
}

/**
 * Lo que se pinta de un invitado, una sola vez para la tabla y las tarjetas.
 *
 * ⚠️ EL ESTADO DEPENDE DE LA AUDIENCIA DE SU CAMPAÑA, no de un booleano: el
 * invitado de alumnos convierte al PAGAR su primera clase y el de tutores al
 * DARLA (`referral_conversions_pending`, `20260911120000`). Decirlo mal no es
 * un matiz de copy: explica por qué alguien que lleva meses comprando clases
 * sigue en «Pendiente» si entró por el enlace de tutores.
 *
 * Si la campaña no está en el mapa —solo posible si un admin la apagó DESPUÉS
 * de que alguien entrara por ella, y entonces la RLS ya no se la devuelve a su
 * referidor— se cae a la regla de alumnos, que es la de las tres campañas del
 * seed salvo la 50784.
 */
function filaDe(
  i: { display_name: string; rf_campaign_id: number; signed_up_at: string; converted_at: string | null },
  campañas: Map<number, Campaña>,
  tz: string,
) {
  const c = campañas.get(i.rf_campaign_id);
  const alumnos = (c?.audience ?? "alumnos") === "alumnos";
  const convertido = Boolean(i.converted_at);
  return {
    // `display_name` viene enmascarado de la RPC («María G.»). Puede salir
    // vacío si el perfil nunca guardó nombre.
    nombre: i.display_name?.trim() || "Invitado",
    programa: alumnos ? "Alumnos" : "Tutores",
    // UTC en la base, hora local al pintar (RN-01/02): sin `tz` el SSR usaría
    // la del servidor, que en Vercel es UTC.
    fecha: formatShortDate(i.signed_up_at, tz),
    convertido,
    estado: !convertido
      ? "Pendiente"
      : alumnos
        ? "Pagó su primera clase"
        : "Dio su primera clase",
    recompensa: convertido ? (c?.reward_text ?? null) : null,
  };
}
