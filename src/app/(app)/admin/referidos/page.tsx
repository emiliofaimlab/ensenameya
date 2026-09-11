import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isReferralFactoryConfigured } from "@/lib/referral-factory";
import { PanelCard } from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { CampaignManager, type CampaignRow } from "./campaign-manager";

export const metadata = { title: "Campañas de referidos · Enséñame Ya" };

/**
 * §7 de INSTRUCCIONES-DESARROLLO — qué campañas de Referral Factory se enseñan
 * en «Invita y gana», con qué texto en español y en qué orden.
 *
 * LAS REGLAS DE LA CAMPAÑA VIVEN EN RF (RN-21). EL PREMIO, NO — y esto cambió
 * el 11-sep. `referral_campaigns.reward_kind/amount/currency/expires_days`
 * (`20260912110000`) es lo que `emitir_credito_de_referido` copia dentro de
 * `credits` sin volver a preguntar, así que lo que se teclea en esta pantalla
 * es dinero que la plataforma acabará fondeando. Presentación, visibilidad
 * **y premio**.
 *
 * ⚠️ NO SE LLAMA A REFERRAL FACTORY AL RENDERIZAR. Medido el 10-sep-2026, RF
 * normalmente contesta en menos de 1 s pero tiene picos de más de 25 s (3 de 40
 * llamadas). Una pantalla que lo esperase se quedaría colgada un cuarto de
 * minuto sin que nada lo explicara. RF se toca solo cuando el admin pulsa
 * «Traer campañas», que es una acción con su propio spinner.
 *
 * ⚠️ No hace falta `loading.tsx` propio: `(app)/admin/loading.tsx` cubre todo
 * lo que cuelga de `/admin/*` y pinta el menú del panel mientras tanto.
 */

/**
 * Los totales de §7 —enlaces, invitados, convertidos— y los dos que el cliente
 * pregunta en cuanto la recompensa empieza a repartirse: cuántas se han
 * EMITIDO y cuántas se han USADO.
 *
 * ⚠️ CON `service_role`, Y NO ES UN ATAJO. `referral_memberships` solo tiene la
 * política `select_own` (`(select auth.uid()) = profile_id`): con el cliente de
 * sesión, el admin vería sus PROPIOS enlaces y ninguno más, o sea el total
 * equivocado presentado como si fuera el bueno. `credits` es peor todavía: su
 * único `select` para `authenticated` es el del dueño y además está dado POR
 * COLUMNAS (`20260912110000:442`), así que un `select('*')` con la sesión del
 * admin ni siquiera falla de forma reconocible. La regla de oro 3 dice «nunca
 * en el NAVEGADOR», no «nunca en una pantalla»; esto es un Server Component y
 * la clave no cruza a ningún sitio.
 */
async function totales(): Promise<
  | {
      ok: true;
      personas: number;
      invitados: number;
      convertidos: number;
      emitidas: number;
      usadas: number;
    }
  | { ok: false; motivo: string }
> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, motivo: "SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno." };
  }

  // ponytail: las dos primeras se traen enteras y se cruzan en JavaScript en vez
  // de pelearse con `count(distinct …)`, que PostgREST no sabe hacer, y con un
  // `.in(codigos)` que metería miles de códigos en la URL. Las dos consultas
  // son pequeñas por construcción —una fila por (persona, campaña) y solo los
  // perfiles que TRAEN código— y el techo de 1000 filas de PostgREST avisaría
  // mucho antes de que esto fuera un problema. Si algún día se llega ahí, esto
  // se convierte en una RPC de tres `count`.
  const [ms, ps, emitidas, usadas] = await Promise.all([
    admin.from("referral_memberships").select("profile_id, code"),
    admin
      .from("profiles")
      .select("referral_code, referral_converted_at")
      .not("referral_code", "is", null),
    // Las recompensas SÍ se cuentan en la base (`head: true` + `count`) y no se
    // traen para contarlas en JavaScript: estas dos crecen con cada conversión
    // y son justo las que un día pasarían del techo de 1000 filas de PostgREST
    // —y lo harían en silencio, devolviendo una cifra menor que la verdadera—.
    admin
      .from("credits")
      .select("id", { count: "exact", head: true })
      .eq("source", "referral"),
    // ⚠️ «USADAS» ES `consumed_amount > 0`, NO `status = 'consumed'`. Un saldo
    // gastado a medias sigue en `'active'` (`aplicar_credito` solo lo cierra
    // cuando llega al tope, `20260912110000:1738-1751`): contar por estado
    // diría que nadie ha canjeado nada mientras el dinero ya se está yendo.
    admin
      .from("credits")
      .select("id", { count: "exact", head: true })
      .eq("source", "referral")
      .gt("consumed_amount", 0),
  ]);

  // Regla de oro 10: sin mirar el `error`, un `permission denied` se pintaría
  // como «0 personas con enlace», que es una mentira creíble.
  if (ms.error) return { ok: false, motivo: ms.error.message };
  if (ps.error) return { ok: false, motivo: ps.error.message };
  if (emitidas.error) return { ok: false, motivo: emitidas.error.message };
  if (usadas.error) return { ok: false, motivo: usadas.error.message };

  const codigos = new Set((ms.data ?? []).map((m) => m.code));
  // Un `?ref=` inventado se queda en `profiles.referral_code` por trazabilidad
  // pero no es un invitado de nadie: el cruce contra los códigos emitidos es la
  // misma validación que hace `referral_conversions_pending`.
  const invitados = (ps.data ?? []).filter(
    (p) => p.referral_code !== null && codigos.has(p.referral_code),
  );

  return {
    ok: true,
    personas: new Set((ms.data ?? []).map((m) => m.profile_id)).size,
    invitados: invitados.length,
    convertidos: invitados.filter((p) => p.referral_converted_at !== null).length,
    // `count` puede venir `null` sin que haya error (PostgREST no siempre lo
    // devuelve); 0 es la lectura correcta de «no ha contado ninguna».
    emitidas: emitidas.count ?? 0,
    usadas: usadas.count ?? 0,
  };
}

export default async function AdminReferidosPage() {
  await requireRole("admin");

  const supabase = await createClient();
  const [tz, campanas, nums, productos] = await Promise.all([
    getUserTimezone(),
    // El admin las ve todas, incluidas las apagadas: la política
    // `referral_campaigns_select_visible` es `visible or has_role('admin')`.
    supabase
      .from("referral_campaigns")
      .select(
        "rf_campaign_id, rf_name, rf_status, rf_lang, rf_url, title, reward_text, audience, visible, sort_order, synced_at, reward_kind, reward_amount, reward_currency, reward_expires_days",
      )
      .order("sort_order"),
    totales(),
    // EN QUÉ MONEDAS COBRA EL CATÁLOGO. No es adorno del selector: el canje no
    // convierte nada —`credito_aplicable` devuelve «tu saldo está en otra
    // moneda»—, así que una recompensa en una moneda que ningún producto usa
    // nace muerta y caduca a los 30 días sin que nadie sepa por qué. El
    // `PATCH` vuelve a comprobarlo; esto es para no ofrecer el error siquiera.
    //
    // ⚠️ PostgREST corta en 1000 filas: con un catálogo mayor esta lista serían
    // las monedas de los primeros mil productos, no todas. Hoy son 18 y todos
    // en USD; el día que deje de ser cierto, la salida es una vista
    // `monedas_del_catalogo` con su `distinct`, no paginar aquí.
    supabase.from("products").select("currency").eq("status", "active"),
  ]);

  // Lo que ya está guardado entra en la lista aunque hoy no lo cobre nadie: si
  // el último producto en esa moneda se pausa, el selector tiene que poder
  // seguir enseñando lo que la campaña tiene puesto en vez de saltar solo a
  // otra moneda. Misma regla que aplica el `PATCH` al dejar pasar la guardada.
  const monedas = [
    ...new Set(
      [
        ...(productos.data ?? []).map((p) => p.currency),
        ...(campanas.data ?? []).map((c) => c.reward_currency ?? ""),
      ]
        .map((m) => m.trim().toUpperCase())
        .filter(Boolean),
    ),
  ].sort();

  const filas: CampaignRow[] = (campanas.data ?? []).map((c) => ({
    rfCampaignId: c.rf_campaign_id,
    rfName: c.rf_name,
    rfStatus: c.rf_status,
    rfLang: c.rf_lang,
    rfUrl: c.rf_url,
    title: c.title,
    rewardText: c.reward_text,
    // `audience` es `text` con un `check` en la base, así que el tipo generado
    // es `string`. El check manda; esto solo lo estrecha para el selector.
    audience: c.audience === "tutores" ? "tutores" : "alumnos",
    visible: c.visible,
    sortOrder: c.sort_order,
    // Mismo caso que `audience`: `reward_kind` es `text` con un `check`
    // (`referral_campaigns_reward_kind_check`), así que el tipo generado es
    // `string`. Manda el check; esto solo lo estrecha para el selector, y lo
    // que no reconozca se trata como «no reparte», que es el lado seguro.
    rewardKind:
      c.reward_kind === "mentoria" || c.reward_kind === "saldo"
        ? c.reward_kind
        : "ninguna",
    rewardAmount: c.reward_amount,
    rewardCurrency: c.reward_currency,
    rewardExpiresDays: c.reward_expires_days,
  }));

  // Regla de oro 4: UTC en la base, hora local al mirarla.
  const ultimaSync = (campanas.data ?? [])
    .map((c) => c.synced_at)
    .sort()
    .at(-1);
  const sincronizado = ultimaSync
    ? new Date(ultimaSync).toLocaleString("es", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tz,
      })
    : null;

  return (
    <AdminShell
      title="Campañas de referidos"
      // ⚠️ §7 y §8 de la especificación se contradicen en esta cadena y en la
      // del botón de abajo. Manda el §8, que se titula «Textos exactos»; el
      // §7 es la descripción de la pantalla, no el copy.
      //
      // ⚠️ Pero el §8 decía «Reglas y recompensas se editan en Referral
      // Factory», y desde el diagrama del 11-sep ESO YA NO ES VERDAD: la
      // recompensa que se entrega la decide esta pantalla
      // (`referral_campaigns.reward_*` → `emitir_credito_de_referido`). Lo que
      // sigue en RF son las reglas de la campaña. Un texto exacto que miente
      // sobre dónde se toca el dinero es peor que un texto aproximado.
      description="Qué campañas se muestran en «Invita y gana», con qué texto y qué entregan de verdad. Las reglas de la campaña siguen en Referral Factory."
    >
      {/* El diagnóstico que se busca al abrir esta pantalla cuando «Traer
          campañas» contesta 503. La clave no se enseña, solo si está puesta. */}
      {!isReferralFactoryConfigured() ? (
        <PanelCard className="border-[#f0c987] bg-[#fdf6e7]">
          <p className="text-[13px] font-semibold text-[#8a5a12]">
            No hay clave de Referral Factory en este entorno.
          </p>
          <p className="mt-1 text-[12.5px] text-[#8a5a12]">
            Las campañas ya guardadas se editan igual y «Invita y gana» sigue
            funcionando con ellas, pero «Traer campañas» no podrá hablar con RF
            hasta que exista <code className="font-mono text-xs">REFERRAL_FACTORY_API_KEY</code>.
          </p>
        </PanelCard>
      ) : null}

      {/* Regla de oro 10 otra vez: si esta lectura falla, el selector de moneda
          se queda con lo ya guardado y diría por omisión «el catálogo no cobra
          en nada». Que se vea que es un fallo, no un catálogo vacío. */}
      {productos.error ? (
        <PanelCard className="border-[#f0c987] bg-[#fdf6e7]">
          <p className="text-[13px] font-semibold text-[#8a5a12]">
            No se pudo leer en qué monedas cobra el catálogo.
          </p>
          <p className="mt-1 text-[12.5px] text-[#8a5a12]">
            El selector de moneda solo ofrece las que ya estaban guardadas.{" "}
            <span className="font-mono text-[12px]">{productos.error.message}</span>
          </p>
        </PanelCard>
      ) : null}

      {/* Regla de oro 10: la consulta que alimenta la tabla se mira. Sin esto,
          un fallo saldría como «no hay campañas» con un botón para crear la
          primera, que es exactamente la cola vacía de `20260827140000`. */}
      {campanas.error ? (
        <PanelCard className="border-[#e5b4b4] bg-[#fdf0f0]">
          <p className="text-[13px] font-semibold text-[#a82929]">
            No se pudieron leer las campañas.
          </p>
          <p className="mt-1 font-mono text-[12px] text-[#a82929]">
            {campanas.error.message}
          </p>
        </PanelCard>
      ) : (
        <CampaignManager filas={filas} sincronizado={sincronizado} monedas={monedas} />
      )}

      <PanelCard className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-[#19191f]">Totales</h2>
        {nums.ok ? (
          <>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <Total label="Personas con enlace" value={nums.personas} />
              <Total label="Invitados registrados" value={nums.invitados} />
              <Total label="Convertidos" value={nums.convertidos} />
              <Total label="Recompensas emitidas" value={nums.emitidas} />
              <Total label="Recompensas usadas" value={nums.usadas} />
            </dl>
            {/* El hueco que el cliente va a ver primero y es LO ESPERADO, no un
                fallo: la recompensa la emite `emitir_credito_de_referido`, que
                sale sin hacer nada mientras la campaña diga «no entrega nada».
                Sin esta línea, «Convertidos: 7 · Emitidas: 0» se lee como un
                bug del reparto. */}
            {nums.convertidos > 0 && nums.emitidas === 0 ? (
              <p className="text-[12.5px] text-[#6b6b6b]">
                Hay conversiones y ninguna recompensa emitida: es lo que pasa
                mientras las campañas no entreguen nada. Elige qué entrega cada
                una arriba.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-[#a82929]">
            No se pudieron calcular: {nums.motivo}
          </p>
        )}
      </PanelCard>
    </AdminShell>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-[#6b6b6b]">{label}</dt>
      <dd className="text-[26px] leading-tight font-bold text-[#19191f]">{value}</dd>
    </div>
  );
}
