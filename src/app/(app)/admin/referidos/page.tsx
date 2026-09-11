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
 * LAS REGLAS Y EL DINERO NO SE TOCAN AQUÍ: viven en RF (RN-21). Esta pantalla
 * decide presentación y visibilidad, nada más.
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
 * Los tres totales de §7.
 *
 * ⚠️ CON `service_role`, Y NO ES UN ATAJO. `referral_memberships` solo tiene la
 * política `select_own` (`(select auth.uid()) = profile_id`): con el cliente de
 * sesión, el admin vería sus PROPIOS enlaces y ninguno más, o sea el total
 * equivocado presentado como si fuera el bueno. La regla de oro 3 dice «nunca
 * en el NAVEGADOR», no «nunca en una pantalla»; esto es un Server Component y
 * la clave no cruza a ningún sitio.
 */
async function totales(): Promise<
  | { ok: true; personas: number; invitados: number; convertidos: number }
  | { ok: false; motivo: string }
> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, motivo: "SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno." };
  }

  // ponytail: se traen las dos listas enteras y se cruzan en JavaScript en vez
  // de pelearse con `count(distinct …)`, que PostgREST no sabe hacer, y con un
  // `.in(codigos)` que metería miles de códigos en la URL. Las dos consultas
  // son pequeñas por construcción —una fila por (persona, campaña) y solo los
  // perfiles que TRAEN código— y el techo de 1000 filas de PostgREST avisaría
  // mucho antes de que esto fuera un problema. Si algún día se llega ahí, esto
  // se convierte en una RPC de tres `count`.
  const [ms, ps] = await Promise.all([
    admin.from("referral_memberships").select("profile_id, code"),
    admin
      .from("profiles")
      .select("referral_code, referral_converted_at")
      .not("referral_code", "is", null),
  ]);

  // Regla de oro 10: sin mirar el `error`, un `permission denied` se pintaría
  // como «0 personas con enlace», que es una mentira creíble.
  if (ms.error) return { ok: false, motivo: ms.error.message };
  if (ps.error) return { ok: false, motivo: ps.error.message };

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
  };
}

export default async function AdminReferidosPage() {
  await requireRole("admin");

  const supabase = await createClient();
  const [tz, campanas, nums] = await Promise.all([
    getUserTimezone(),
    // El admin las ve todas, incluidas las apagadas: la política
    // `referral_campaigns_select_visible` es `visible or has_role('admin')`.
    supabase
      .from("referral_campaigns")
      .select(
        "rf_campaign_id, rf_name, rf_status, rf_lang, rf_url, title, reward_text, audience, visible, sort_order, synced_at",
      )
      .order("sort_order"),
    totales(),
  ]);

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
      // §7 es la descripción de la pantalla, no el copy. Si el cliente
      // prefiere la larga del §7, es cambiar estas dos líneas.
      description="Qué campañas se muestran en «Invita y gana» y con qué texto. Reglas y recompensas se editan en Referral Factory."
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
        <CampaignManager filas={filas} sincronizado={sincronizado} />
      )}

      <PanelCard className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-[#19191f]">Totales</h2>
        {nums.ok ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Total label="Personas con enlace" value={nums.personas} />
            <Total label="Invitados registrados" value={nums.invitados} />
            <Total label="Convertidos" value={nums.convertidos} />
          </dl>
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
