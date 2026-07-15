import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { AccountForm } from "./account-form";
import { PaymentMethods } from "./payment-methods";

export const metadata = { title: "Mi cuenta · Enséñame Ya" };

/**
 * US-104 (SCR-G03) — Gestión de cuenta: editar perfil (nombre, timezone RN-01),
 * cambiar contraseña, activar rol tutor y cerrar sesión. Todo pasa por RLS
 * (profiles_update_own / auth propio); nada server-side privilegiado.
 */
export default async function AccountPage() {
  const { user, roles } = await requireUser();

  const supabase = await createClient();
  const [{ data: profile }, { data: cards }] = await Promise.all([
    supabase.from("profiles").select("full_name, timezone").eq("id", user.id).single(),
    supabase
      .from("payment_methods")
      .select("id, brand, last4")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <Container>
      <Section className="flex flex-col gap-8">
        <PageHeader
          title="Mi cuenta"
          description="Gestiona tu perfil, tu contraseña y tu sesión."
        />
        <AccountForm
          userId={user.id}
          email={user.email ?? ""}
          fullName={profile?.full_name ?? ""}
          timezone={profile?.timezone ?? "UTC"}
          isTutor={roles.includes("tutor")}
        />

        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Métodos de pago</h2>
          <PaymentMethods userId={user.id} cards={cards ?? []} />
        </div>
      </Section>
    </Container>
  );
}
