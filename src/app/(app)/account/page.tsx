import { requireUser } from "@/lib/auth/server";
import { panelItems } from "@/lib/auth/panel-items";
import { createClient } from "@/lib/supabase/server";
import { PanelShell } from "@/components/layout/panel-shell";
import { ReferralCard } from "@/components/referral/referral-card";
import { AccountForm } from "./account-form";

export const metadata = { title: "Mi cuenta · Enséñame Ya" };

/**
 * US-104 (SCR-G03) — "Mi cuenta" dentro del panel (24-jul): menú lateral como
 * el resto del área autenticada + módulos de información personal. El sidebar
 * sigue al panel del rol (alumno por defecto). Todo pasa por RLS.
 * Los métodos de pago viven en su propio módulo `/pagos` (R24-20).
 */
export default async function AccountPage() {
  const { user, roles } = await requireUser();

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, timezone, avatar_path")
    .eq("id", user.id)
    .single();

  const avatarUrl = profile?.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : null;

  // El menú lateral es el del panel del rol (undefined = alumno por defecto).
  // El menú sigue al panel del que vienes, no al rol (ver `panelItems`).
  const items = await panelItems(user.id, roles);

  return (
    <PanelShell items={items}>
      <div>
        <p className="text-xs text-[#6b6b6b]">Cuenta</p>
        <h1 className="mt-1 text-[24px] font-bold tracking-tight text-[#19191f]">
          Mi cuenta
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Gestiona tu información personal, tu contraseña y tu sesión.
        </p>
      </div>

      <AccountForm
        userId={user.id}
        email={user.email ?? ""}
        fullName={profile?.full_name ?? ""}
        timezone={profile?.timezone ?? "UTC"}
        avatarUrl={avatarUrl}
        isTutor={roles.includes("tutor")}
      />

      {/* G03 · el otro punto de integración de referidos (Doc 4 §4.x). */}
      <ReferralCard />
    </PanelShell>
  );
}
