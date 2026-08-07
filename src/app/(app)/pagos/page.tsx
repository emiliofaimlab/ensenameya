import { requireUser } from "@/lib/auth/server";
import { panelItems } from "@/lib/auth/panel-items";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStripeConfigured, listSavedCards } from "@/lib/stripe";
import {
  PanelShell,
  PanelCard,
  PanelCardTitle,
} from "@/components/layout/panel-shell";
import { PaymentMethods } from "./payment-methods";

export const metadata = { title: "Métodos de pago · Enséñame Ya" };

/**
 * US-607 / PAC-02 — Métodos de pago como **módulo propio**, fuera de "Mi cuenta"
 * (24-jul). Card-on-file real: RN-43 se cumple porque el PAN no pasa por aquí
 * nunca — la tarjeta se guarda en el checkout alojado y se LEE de Stripe.
 *
 * Se lista del proveedor y no de `payment_methods` a propósito: Stripe es quien
 * sabe si una tarjeta caducó o el banco la reemplazó. Una copia local solo
 * añadiría un sitio donde quedar desfasado.
 */
export default async function PagosPage() {
  const { user, roles } = await requireUser();

  // Sin Customer todavía (nadie ha pagado aún) no hay nada que pedirle a
  // Stripe, y sin clave configurada tampoco: la pantalla se enseña vacía, que
  // es la verdad, en vez de reventar.
  const { data: perfil } = await createAdminClient()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const cards =
    isStripeConfigured() && perfil?.stripe_customer_id
      ? await listSavedCards(perfil.stripe_customer_id)
      : [];

  // El menú sigue al panel del que vienes, no al rol (ver `panelItems`).
  const items = await panelItems(user.id, roles);

  return (
    <PanelShell
      items={items}
      eyebrow="Pagos"
      title="Métodos de pago"
      description="Gestiona la tarjeta con la que pagas tus reservas."
    >
      <PanelCard>
        <PanelCardTitle>Tus tarjetas</PanelCardTitle>
        <div className="mt-4">
          <PaymentMethods cards={cards} />
        </div>
      </PanelCard>
    </PanelShell>
  );
}
