import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  PanelShell,
  PanelCard,
  PanelCardTitle,
} from "@/components/layout/panel-shell";
import { ADMIN_ITEMS, TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { AccountForm } from "./account-form";
import { PaymentMethods } from "./payment-methods";

export const metadata = { title: "Mi cuenta · Enséñame Ya" };

/**
 * US-104 (SCR-G03) — "Mi cuenta" dentro del panel (24-jul): menú lateral como
 * el resto del área autenticada + módulos de información personal. El sidebar
 * sigue al panel del rol (alumno por defecto). Todo pasa por RLS.
 */
export default async function AccountPage() {
  const { user, roles } = await requireUser();

  const supabase = await createClient();
  const [{ data: profile }, { data: cards }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, timezone, avatar_path")
      .eq("id", user.id)
      .single(),
    supabase
      .from("payment_methods")
      .select("id, brand, last4")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const avatarUrl = profile?.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : null;

  // El menú lateral es el del panel del rol (undefined = alumno por defecto).
  const items = roles.includes("admin")
    ? ADMIN_ITEMS
    : roles.includes("tutor")
      ? TUTOR_ITEMS
      : undefined;

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

      {/* Métodos de pago: por ahora aquí; R24-20 lo moverá a su propio módulo. */}
      <PanelCard>
        <PanelCardTitle>Métodos de pago</PanelCardTitle>
        <div className="mt-4">
          <PaymentMethods userId={user.id} cards={cards ?? []} />
        </div>
      </PanelCard>
    </PanelShell>
  );
}
