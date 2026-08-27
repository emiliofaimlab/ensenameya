import { storageUrl } from "@/lib/catalog/format";
import { requireUser } from "@/lib/auth/server";
import { panelItems } from "@/lib/auth/panel-items";
import { createClient } from "@/lib/supabase/server";
import { PanelShell } from "@/components/layout/panel-shell";
import { ReferralCard } from "@/components/referral/referral-card";
import { CalendarFeedCard } from "@/components/calendar/calendar-feed-card";
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

  const avatarUrl = storageUrl("avatars", profile?.avatar_path);

  // EY-188 · ¿ya hay suscripción de calendario? Se LEE, no se crea: si esta
  // llamada emitiera el token, todo el que abre su cuenta acabaría con un
  // secreto vivo que nunca pidió. Crearlo es un clic explícito de la tarjeta.
  const { data: feedToken } = await supabase.rpc(
    "my_calendar_feed_token",
  );

  // El menú lateral es el del panel del rol (undefined = alumno por defecto).
  // El menú sigue al panel del que vienes, no al rol (ver `panelItems`).
  const items = await panelItems(user.id, roles);

  return (
    <PanelShell
      items={items}
      eyebrow="Cuenta"
      title="Mi cuenta"
      description="Gestiona tu información personal, tu contraseña y tu sesión."
    >
      {/* ⚠️ EL MOSAICO LO ARMA `AccountForm`, y estas dos tarjetas entran por
          props en vez de detrás. No es rebuscado: en dos columnas el ORDEN de
          las tarjetas es el diseño (tarjetas altas emparejadas entre sí, el
          calendario a ancho completo, la baja de cuenta sola al final), y
          partirlo entre dos ficheros lo rompería el primer día. Aquí se decide
          QUÉ tarjetas hay y con qué datos; allí, DÓNDE cae cada una. */}
      <AccountForm
        userId={user.id}
        email={user.email ?? ""}
        fullName={profile?.full_name ?? ""}
        timezone={profile?.timezone ?? "UTC"}
        avatarUrl={avatarUrl}
        isTutor={roles.includes("tutor")}
        /* EY-188 (B5.5) · la misma tarjeta para alumno y tutor: el feed
           devuelve las sesiones en las que participas, sin mirar el rol. */
        calendario={
          <CalendarFeedCard
            tokenInicial={typeof feedToken === "string" ? feedToken : null}
          />
        }
        /* G03 · el otro punto de integración de referidos (Doc 4 §4.x).
           B1.11 · el rol decide QUÉ programa se le ofrece. Esta pantalla la
           comparten los dos, y `roles` ya estaba a mano más arriba.
           ⚠️ Puede renderizar `null` (hoy, siempre para el tutor): el mosaico
           cuenta con ello, ver `account-form.tsx`. */
        referidos={<ReferralCard isTutor={roles.includes("tutor")} />}
      />
    </PanelShell>
  );
}
