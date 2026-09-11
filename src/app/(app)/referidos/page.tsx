import { headers } from "next/headers";
import Link from "next/link";
import { GraduationCapIcon, UsersIcon } from "lucide-react";

import { requireUser, getUserTimezone } from "@/lib/auth/server";
import { panelMenu } from "@/lib/auth/panel-items";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatShortDate } from "@/lib/booking";
import { formatMoney } from "@/lib/catalog/format";
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
  type PillTone,
} from "@/components/layout/panel-shell";
import { PrecioEnLinea } from "@/components/precio/precio";
import { Button } from "@/components/ui/button";
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
  /**
   * Qué ofrece de verdad la campaña (`20260912110000`, §2). NO es `reward_text`,
   * que es la frase que escribe el admin y puede decir misa: `reward_kind` es lo
   * que mira `emitir_credito_de_referido` para acuñar —o no acuñar— el premio, y
   * su default es `'ninguna'` a propósito.
   *
   * Se lee aquí por una sola razón: con todas las campañas visibles en
   * `'ninguna'`, «todavía no has ganado ninguna recompensa» promete algo que no
   * va a llegar nunca. Ese es el tipo de mentira creíble contra la que avisa la
   * regla de oro 10, solo que con la campaña en el papel de la consulta muda.
   */
  reward_kind: string;
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

  const [
    { items, badges },
    tz,
    cabeceras,
    campañasRes,
    membershipsRes,
    invitadosRes,
    creditosRes,
  ] = await Promise.all([
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
      .select(
        "rf_campaign_id, audience, title, reward_text, visible, reward_kind",
      )
      .order("sort_order"),
    supabase
      .from("referral_memberships")
      .select("rf_campaign_id, code")
      .eq("profile_id", user.id),
    supabase.rpc("referral_invitees"),
    /**
     * Las recompensas de verdad (`20260912110000`).
     *
     * ⚠️ POR LA VISTA, NUNCA POR `credits`. Esa tabla tiene `grant select` **por
     * columnas** —el cobro del regalo se queda fuera a propósito—, así que un
     * `.select("*")` sobre ella contesta `permission denied` en EJECUCIÓN: ni
     * el typecheck ni el build lo ven. `mis_creditos` es `security_invoker`, o
     * sea que hereda `credits_select_own` y solo devuelve lo mío; el
     * `.eq("beneficiary_id", …)` que uno escribiría por costumbre no existe
     * aquí, y no hace falta.
     *
     * ⚠️ Y SOLO `source = 'referral'`. La vista trae también los REGALOS que me
     * han hecho, y esos se agendan desde «Mis reservas»: mezclarlos en «Invita
     * y gana» le pondría a alguien un regalo de su madre en la casilla de lo
     * que ganó invitando.
     */
    supabase
      .from("mis_creditos")
      .select(
        "id, kind, destino, status, amount, consumed_amount, restante, currency, expires_at, consumed_at",
      )
      .eq("source", "referral")
      .order("issued_at", { ascending: false, nullsFirst: false }),
  ]);

  // ⚠️ Regla de oro 10. `const { data } = …` convertiría cualquiera de estos
  // cuatro fallos en una lista vacía, que aquí es la mentira más creíble que
  // hay: «todavía nadie ha entrado con tu enlace» se lee igual de bien roto que
  // funcionando. Por eso se miran, se registran, y abajo se distingue «cero»
  // de «no lo sé».
  //
  // 🔴 Y EN LOS CRÉDITOS DUELE MÁS QUE EN NINGUNO: «0 recompensas» por un
  // `permission denied` se lee palabra por palabra igual que «no has ganado
  // nada», y lo que hay detrás es dinero emitido a nombre de esta persona.
  if (campañasRes.error)
    console.error("[referidos] campañas", campañasRes.error.code, campañasRes.error.message);
  if (membershipsRes.error)
    console.error("[referidos] memberships", membershipsRes.error.code, membershipsRes.error.message);
  if (invitadosRes.error)
    console.error("[referidos] invitados", invitadosRes.error.code, invitadosRes.error.message);
  if (creditosRes.error)
    console.error("[referidos] créditos", creditosRes.error.code, creditosRes.error.message);

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

  // `null` = no se pudo leer, exactamente igual que `invitados`. Nunca `[]`.
  const recompensas = creditosRes.error
    ? null
    : (creditosRes.data ?? [])
        .map((c) => recompensaDe(c, tz))
        .filter((r): r is Recompensa => r !== null);

  // Las que se pueden gastar HOY van primero y ordenadas por urgencia: la que
  // caduca el martes tiene que estar por delante de la que caduca en un mes, y
  // el orden de emisión —que es el que trae la consulta— las mezclaba.
  const usables = (recompensas ?? [])
    .filter((r) => r.usable)
    .sort((a, b) => a.caducaEn - b.caducaEn);
  const gastadas = (recompensas ?? []).filter((r) => !r.usable);

  /**
   * ¿Hay algún programa visible que de verdad reparta algo?
   *
   * Con las campañas en `reward_kind = 'ninguna'` —su default— no se emite un
   * solo crédito por mucho que alguien convierta, así que «todavía no has ganado
   * ninguna» sería prometer algo que no va a llegar. Si la consulta de campañas
   * falló no se sabe, y entonces se dice lo neutro: no se afirma nada sobre unos
   * programas que no hemos podido leer.
   */
  const reparteAlgo =
    Boolean(campañasRes.error) || visibles.some((c) => c.reward_kind !== "ninguna");

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
            pie: null as string | null,
            destacada: false,
          },
          {
            label: "Convertidos",
            valor: convertidos,
            pie: null as string | null,
            destacada: false,
          },
          /**
           * ⚠️ ESTE NÚMERO ERA, LITERALMENTE, `convertidos`. Era honesto mientras
           * no había nada que dar —RN-21 decía que el monto lo fijaba RF y
           * nosotros solo contábamos conversiones—, pero desde
           * `20260912110000` la recompensa es una fila de `credits` con su
           * importe, su caducidad y su estado, y una conversión NO es una
           * recompensa: la campaña puede no repartir nada (`reward_kind =
           * 'ninguna'`), el crédito puede haberse gastado o caducado, y entre la
           * conversión y la emisión está el cron horario de `referrals-sync`.
           * Ahora se cuentan las recompensas, y el pie dice cuántas sirven hoy.
           */
          {
            label: "Recompensas",
            valor: recompensas === null ? null : recompensas.length,
            pie:
              recompensas && recompensas.length > 0
                ? `${usables.length} por usar`
                : null,
            destacada: true,
          },
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
            {/* §5.0 · una línea de 11 px que envuelve si hace falta: a 390 px la
                tarjeta tiene ~90 px de ancho útil y dos líneas son mejores que
                una barra horizontal. */}
            {t.pie ? (
              <p className="mt-0.5 text-[11px] text-[#6b6b6b]">{t.pie}</p>
            ) : null}
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

      {/**
       * ── TUS RECOMPENSAS ───────────────────────────────────────────────────
       *
       * ⚠️ VA DEBAJO DE «TUS ENLACES», Y NO ES UN DESCUIDO. La nota de §5.0 de
       * los tres contadores dice por qué existen en una sola fila: para no
       * empujar las tarjetas de enlace —que es a lo que se viene— por debajo del
       * pliegue. Meter aquí arriba una sección entera haría justo eso. Lo que
       * avisa de que hay algo que mirar es el contador naranja, que ya cuenta
       * recompensas de verdad.
       */}
      <div className="flex flex-col gap-3">
        <h2
          id="recompensas"
          className="text-base font-semibold text-[#19191f]"
        >
          Tus recompensas
        </h2>

        {recompensas === null ? (
          // Regla de oro 10, el caso que más duele de los cuatro de esta
          // pantalla: se dice que no se pudo leer, y se dice que lo que hubiera
          // sigue ahí. Un «0» aquí sería indistinguible de la verdad.
          <PanelCard>
            <p className="text-[13px] text-[#6b6b6b]">
              No pudimos cargar tus recompensas ahora mismo. Vuelve a intentarlo
              en un momento: si tenías alguna, sigue donde estaba.
            </p>
          </PanelCard>
        ) : recompensas.length === 0 ? (
          <PanelCard>
            <p className="text-[13px] text-[#6b6b6b]">
              {reparteAlgo
                ? "Todavía no has ganado ninguna. Cuando alguien que invitaste cumpla lo que pide su programa, tu recompensa aparece aquí sola: no hay nada que reclamar."
                : "Los programas activos no reparten recompensas ahora mismo."}
            </p>
          </PanelCard>
        ) : (
          <>
            {usables.length > 0 ? (
              // Una columna hasta 1024, igual que los enlaces: el importe y su
              // aviso de caducidad comparten fila y a dos columnas se estrechan.
              <div className="grid gap-3 lg:grid-cols-2">
                {usables.map((r) => (
                  <PanelCard
                    key={r.id}
                    className="flex flex-col gap-2.5 p-4 sm:p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <PanelCardTitle className="text-[16px]">
                          {r.titulo}
                        </PanelCardTitle>
                        <p className="mt-1 text-[20px] leading-tight font-bold text-[#19191f]">
                          {/* La misma cifra que el checkout: en la moneda de
                              quien mira, con su USD al lado cuando hay tasa. */}
                          <PrecioEnLinea
                            amountMinor={r.importe}
                            currency={r.moneda}
                          />
                        </p>
                      </div>
                      <StatusPill tone={r.tono} className="whitespace-nowrap">
                        {r.aviso}
                      </StatusPill>
                    </div>

                    <p className="text-[12.5px] text-[#6b6b6b]">{r.detalle}</p>

                    {/* `mt-auto`: con dos tarjetas de distinta altura los dos
                        botones quedan alineados abajo. Alto 44 (§5.0) y ancho
                        completo en móvil, que es el objetivo táctil de verdad. */}
                    {r.cta ? (
                      <Button
                        asChild
                        variant={r.cta.principal ? "default" : "outline"}
                        className="mt-auto h-11 w-full font-semibold sm:w-fit sm:px-5"
                      >
                        <Link href={r.cta.href}>{r.cta.label}</Link>
                      </Button>
                    ) : null}
                  </PanelCard>
                ))}
              </div>
            ) : null}

            {/* Las que ya no sirven NO se esconden —que se vea que existieron y
                en qué acabaron— pero no compiten con las usables: una lista
                compacta, en gris, sin un solo botón. */}
            {gastadas.length > 0 ? (
              <PanelCard className="p-0">
                <h3 className="px-4 pt-4 text-[11px] font-semibold tracking-[0.05em] text-[#6b6b6b] uppercase sm:px-5">
                  Ya no disponibles
                </h3>
                <ul className="mt-1 divide-y divide-[#efefef]">
                  {gastadas.map((r) => (
                    <li
                      key={r.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-2 px-4 py-3 sm:px-5"
                    >
                      {/* `min-w-0` + `truncate`: es lo que impide que un título
                          largo junto al chip saque la barra horizontal a 390. */}
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[#595959]">
                          {r.titulo} ·{" "}
                          <PrecioEnLinea
                            amountMinor={r.importe}
                            currency={r.moneda}
                          />
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#6b6b6b]">
                          {r.detalle}
                        </p>
                      </div>
                      <StatusPill tone={r.tono} className="whitespace-nowrap">
                        {r.aviso}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              </PanelCard>
            ) : null}
          </>
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

/**
 * ── LA RECOMPENSA, YA MASTICADA PARA PINTARLA ───────────────────────────────
 *
 * Una fila de `mis_creditos` no se puede enseñar tal cual: lo que la persona
 * necesita saber son tres cosas —QUÉ es, CUÁNTO vale y CUÁNDO caduca— y ninguna
 * de las tres es una columna. `kind` + `destino` deciden la primera, `amount` y
 * `restante` no significan lo mismo según `kind`, y la caducidad no se lee de
 * `status`. Se resuelve aquí, una vez, y el JSX solo coloca.
 */
type Recompensa = {
  id: string;
  titulo: string;
  detalle: string;
  /**
   * Unidades mínimas que vale HOY. Con `kind = 'mentoria'` es el TOPE entero
   * (`amount`), porque ese crédito se canjea entero o no se canjea; con `saldo`
   * es lo que queda por gastar (`restante`), que es lo único que sirve para algo
   * cuando ya se usó una parte. Es la misma distinción que hace
   * `credito_aplicable()` en la base.
   */
  importe: number;
  moneda: string;
  usable: boolean;
  /** Lo que dice el chip: la urgencia, o en qué acabó. */
  aviso: string;
  tono: PillTone;
  /** Milisegundos de su caducidad, `Infinity` si no caduca. Solo para ORDENAR. */
  caducaEn: number;
  cta: { href: string; label: string; principal: boolean } | null;
};

/**
 * Una fila de la vista. Todas las columnas salen anulables —es una vista— y por
 * eso las cuatro que deciden algo se comprueban antes de usarlas: un `!` aquí
 * sería inventarse un importe o un estado. Mismo `if` que hace el selector del
 * checkout con esta misma vista.
 */
type FilaDeCredito = {
  id: string | null;
  kind: string | null;
  destino: string | null;
  status: string | null;
  amount: number | null;
  consumed_amount: number | null;
  restante: number | null;
  currency: string | null;
  expires_at: string | null;
  consumed_at: string | null;
};

function recompensaDe(c: FilaDeCredito, tz: string): Recompensa | null {
  if (
    !c.id ||
    !c.kind ||
    !c.destino ||
    !c.status ||
    c.amount === null ||
    !c.currency
  ) {
    return null;
  }

  const restante = c.restante ?? 0;
  const caduca = c.expires_at ? new Date(c.expires_at).getTime() : null;
  const caducaEn = caduca === null || Number.isNaN(caduca) ? Infinity : caduca;

  /**
   * 🔴 `status = 'active'` NO SIGNIFICA VIGENTE, y aquí eso no es un matiz.
   * `caducar_creditos()` es un barrido DIARIO (03:17), así que un crédito
   * vencido a las 00:01 sigue diciendo `'active'` durante ~27 horas. Quien
   * ORDENA la caducidad es el barrido; quien la DECIDE es esta fecha — que es
   * exactamente lo que mira `aplicar_credito` antes de dejar canjear
   * (`20260912110000`, §8.2, con su propio ⚠️ al lado). Si la pantalla mirara
   * solo el estado, ofrecería un «Reservar mi mentoría gratis» que el checkout
   * va a rechazar, que es la peor forma de enterarse.
   */
  const vencida = caducaEn <= Date.now();
  const usable = c.status === "active" && !vencida && restante > 0;

  // Los tres títulos salen de las dos columnas que de verdad mandan, y `destino`
  // va PRIMERO: se congela al emitir y es lo que decide si esto se gasta o si
  // llega solo. Derivarlo del rol al pintar sería contradecir a la base.
  const titulo =
    c.destino === "payout"
      ? "Dinero para tu próximo cobro"
      : c.kind === "mentoria"
        ? "Una mentoría gratis"
        : "Saldo para tus mentorías";

  if (!usable) {
    // Las que ya no sirven dicen EN QUÉ ACABARON y con qué fecha. `'refunded'` y
    // `'pending_payment'` son del regalo y no deberían llegar aquí (esta lista
    // filtra `source = 'referral'`), pero se contemplan: un estado sin texto se
    // pinta como una fila muda y nadie sabe qué mirar.
    const fin =
      c.status === "consumed"
        ? {
            aviso: "Usada",
            detalle: c.consumed_at
              ? `La usaste el ${fechaLocal(c.consumed_at, tz)}.`
              : "Ya la usaste.",
          }
        : c.status === "expired" || vencida
          ? {
              aviso: "Caducada",
              detalle: c.expires_at
                ? `Caducó el ${fechaLocal(c.expires_at, tz)} sin usarse.`
                : "Caducó sin usarse.",
            }
          : c.status === "revoked"
            ? { aviso: "Anulada", detalle: "Ya no está disponible." }
            : c.status === "refunded"
              ? { aviso: "Devuelta", detalle: "Su importe volvió a su origen." }
              : { aviso: "No disponible", detalle: "Todavía no se puede usar." };

    return {
      id: c.id,
      titulo,
      // El importe de una gastada es el que TUVO (`amount`), no lo que queda:
      // «Usada · US$ 0,00» no le dice nada a nadie.
      importe: c.amount,
      moneda: c.currency,
      detalle: fin.detalle,
      aviso: fin.aviso,
      tono: "neutral",
      usable: false,
      caducaEn,
      cta: null,
    };
  }

  // ── Las que sí se pueden usar ──────────────────────────────────────────────

  if (c.destino === "payout") {
    /**
     * El tutor no canjea nada: el diagrama dice «le llega solo», y la base lo
     * sostiene —`credits_payout_no_caduca` prohíbe ponerle fecha—. Lo único que
     * se le ofrece es el sitio donde verá el ajuste cuando salga el lote.
     */
    return {
      id: c.id,
      titulo,
      importe: restante,
      moneda: c.currency,
      detalle:
        "Se suma sola a tu próximo cobro: no hay nada que canjear ni que reservar, y no caduca.",
      aviso: "Te llega solo",
      tono: "green",
      usable: true,
      caducaEn,
      cta: {
        href: "/tutor/payouts#saldo",
        label: "Ver tus cobros",
        principal: false,
      },
    };
  }

  // A partir de aquí es dinero que se gasta EN EL CHECKOUT, así que el empujón
  // es hacia reservar. `/agendar` y no `/tutors`: es la ruta del panel, con
  // sesión, y vale igual para un tutor que además tiene una mentoría gratis (su
  // única guarda es `requireUser`). El canje en sí ocurre en el checkout, antes
  // del formulario de pago; desde aquí no se canjea nada.
  const expira = c.expires_at;
  const dias = expira ? diasHasta(expira, tz) : null;
  // `dias === null` con fecha puesta solo pasa si esa fecha no se puede leer, y
  // entonces se dice lo mismo que ya asume el resto del cálculo (`caducaEn` es
  // `Infinity` y `vencida` es false): que no caduca. Inventar una urgencia a
  // partir de un dato ilegible sería peor que no decirla.
  const aviso =
    !expira || dias === null
      ? "No caduca"
      : dias <= 0
        ? "Caduca hoy"
        : dias === 1
          ? "Caduca mañana"
          : dias <= 7
            ? `Caduca en ${dias} días`
            : `Caduca el ${fechaLocal(expira, tz)}`;
  // Tres niveles y no dos: una que caduca esta semana no se puede leer igual que
  // una recién ganada, y la de hoy tampoco igual que la del viernes.
  const tono: PillTone =
    dias === null ? "green" : dias <= 1 ? "red" : dias <= 7 ? "amber" : "gray";

  if (c.kind === "mentoria") {
    return {
      id: c.id,
      titulo,
      // 🔴 EL TOPE, NO «LO QUE QUEDA». Con `kind = 'mentoria'` el `amount` es un
      // máximo y el crédito se consume ENTERO al canjearlo: el sobrante es de la
      // plataforma (`credits_mentoria_entera` + la cabecera de la migración).
      // Decirlo aquí es lo que evita la sorpresa en el checkout.
      importe: c.amount,
      moneda: c.currency,
      detalle:
        "Vale por una mentoría de hasta ese importe. Se canjea entera: no se puede aplicar a una más cara, y si eliges una más barata la diferencia no se guarda.",
      aviso,
      tono,
      usable: true,
      caducaEn,
      cta: {
        href: "/agendar",
        label: "Reservar mi mentoría gratis",
        principal: true,
      },
    };
  }

  const consumido = c.consumed_amount ?? 0;
  return {
    id: c.id,
    titulo,
    importe: restante,
    moneda: c.currency,
    detalle:
      consumido > 0
        ? `Ya has usado ${formatMoney(consumido, c.currency)} de ${formatMoney(c.amount, c.currency)}. El resto se descuenta al reservar: pagas solo la diferencia.`
        : "Se descuenta al reservar tu próxima mentoría: pagas solo la diferencia.",
    aviso,
    tono,
    usable: true,
    caducaEn,
    cta: { href: "/agendar", label: "Usar mi saldo", principal: true },
  };
}

/**
 * El día de calendario de un instante EN LA ZONA DE QUIEN MIRA (RN-01/02).
 *
 * `en-CA` da `2026-09-11` y es la forma más corta de sacar el día local sin
 * dependencias: restar milisegundos sería contar horas, no días, y algo que
 * vence esta noche saldría «mañana» para media Europa. Devuelve el día como
 * marca UTC para poder restar dos de ellos sin que el huso vuelva a meterse.
 */
function diaLocal(d: Date, tz: string): number {
  const [a, m, dia] = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(d)
    .split("-")
    .map(Number);
  return Date.UTC(a, m - 1, dia);
}

/** Días de calendario que faltan, en la zona del usuario. `null` si la fecha no
 *  se puede leer — nunca 0, que aquí significaría «caduca hoy». */
function diasHasta(iso: string, tz: string): number | null {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return null;
  // El reloj se lee en una función de módulo y no dentro del render: es la misma
  // razón por la que `isUpcoming()` vive donde vive (pureza de react-hooks).
  return Math.round(
    (diaLocal(cuando, tz) - diaLocal(new Date(), tz)) / 86_400_000,
  );
}

/**
 * «3 oct», y «3 ene 2027» cuando el año no es el de hoy.
 *
 * No es `formatShortDate` con otro nombre: aquí el año hace falta. Una
 * recompensa dura hasta 365 días (`referral_campaigns_reward_dias_check`), así
 * que quien gane una en diciembre ve un «caduca el 3 ene» que sin el año no dice
 * si quedan tres días o quince meses. La zona horaria se pasa SIEMPRE: sin ella
 * el SSR formatearía en la del servidor, que en Vercel es UTC (R24-12).
 */
function fechaLocal(iso: string, tz: string): string {
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return "—";
  const año = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric" }).format(d);
  const mismoAño = año(cuando) === año(new Date());
  return cuando.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    timeZone: tz,
    ...(mismoAño ? {} : { year: "numeric" }),
  });
}
