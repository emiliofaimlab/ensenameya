import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import {
  PanelShell,
  PanelCard,
  PanelCardTitle,
} from "@/components/layout/panel-shell";
import { ADMIN_ITEMS, TUTOR_ITEMS } from "@/components/layout/app-sidebar";
import { PaymentMethods } from "./payment-methods";

export const metadata = { title: "Métodos de pago · Enséñame Ya" };

/**
 * US-607 — Métodos de pago como **módulo propio**, fuera de "Mi cuenta"
 * (24-jul). Tarjeta simulada card-on-file (RN-43: sin PAN). El sidebar sigue
 * al panel del rol (alumno por defecto). Todo por RLS.
 */
export default async function PagosPage() {
  const { user, roles } = await requireUser();

  const supabase = await createClient();
  const { data: cards } = await supabase
    .from("payment_methods")
    .select("id, brand, last4")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false });

  const items = roles.includes("admin")
    ? ADMIN_ITEMS
    : roles.includes("tutor")
      ? TUTOR_ITEMS
      : undefined;

  return (
    <PanelShell items={items}>
      <div>
        <p className="text-xs text-[#6b6b6b]">Pagos</p>
        <h1 className="mt-1 text-[24px] font-bold tracking-tight text-[#19191f]">
          Métodos de pago
        </h1>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Gestiona la tarjeta con la que pagas tus reservas.
        </p>
      </div>

      <PanelCard>
        <PanelCardTitle>Tus tarjetas</PanelCardTitle>
        <div className="mt-4">
          <PaymentMethods userId={user.id} cards={cards ?? []} />
        </div>
      </PanelCard>
    </PanelShell>
  );
}
