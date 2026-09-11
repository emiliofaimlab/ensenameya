import { storageUrl } from "@/lib/catalog/format";
import { requireUser } from "@/lib/auth/server";
import { panelMenu } from "@/lib/auth/panel-items";
import { createClient } from "@/lib/supabase/server";
import { PanelShell } from "@/components/layout/panel-shell";
import { ReferralCard } from "@/components/referral/referral-card";
import { CalendarFeedCard } from "@/components/calendar/calendar-feed-card";
import { rpcNueva } from "@/app/api/cuenta/eliminar/rpc";
import { AccountForm } from "./account-form";
import type { EstadoBaja } from "./baja";

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
  // Verónica (3-sep-2026): «si ya soy tutor no debería salir "quiero ser
  // tutor"». Ser tutor a efectos de la tarjeta de `/account` NO es tener el
  // rol —que solo se concede al APROBAR (US-1101)— sino haber empezado: la
  // fila de `tutor_profiles`. Se lee su `approval_status` (y no el booleano de
  // `hasTutorProfile()`) porque la tarjeta distingue «en revisión» de
  // «rechazado». Las dos consultas van juntas: no dependen una de otra.
  // ⚠️ LAS CINCO JUNTAS, y no por gusto: encadenadas eran cuatro peldaños de
  // latencia (perfil → token → estado de baja → menú) y esta pantalla tardaba
  // 1.122 ms, de los que ~400 ms eran solo esperar en fila. Ninguna necesita el
  // resultado de la anterior.
  const [
    [{ data: profile }, { data: tutorProfile }],
    { data: feedToken },
    { data: estadoBaja },
    { items, badges },
  ] = await Promise.all([
    Promise.all([
    supabase
      .from("profiles")
      .select("full_name, timezone, avatar_path")
      .eq("id", user.id)
      .single(),
    supabase
      .from("tutor_profiles")
      .select("approval_status")
      .eq("profile_id", user.id)
      .maybeSingle(),
    ]),
    // EY-188 · ¿ya hay suscripción de calendario? Se LEE, no se crea: si esta
    // llamada emitiera el token, todo el que abre su cuenta acabaría con un
    // secreto vivo que nunca pidió. Crearlo es un clic explícito de la tarjeta.
    supabase.rpc("my_calendar_feed_token"),
    // ⚠️ Esto SÍ se pide en cada carga, a diferencia de los bloqueos de la baja,
    // que el diálogo consulta solo al abrirse. La diferencia es que aquí no se
    // pregunta «¿podrías darte de baja?» —eso solo le interesa a quien va a
    // pulsar el botón— sino «¿está tu cuenta desactivada AHORA MISMO?». Una
    // cuenta desactivada tiene que decirlo en cuanto la abres: si hay que pulsar
    // algo para enterarse, la persona no se entera.
    //
    // Es una RPC de esta migración, así que todavía no está en los tipos
    // generados: `rpcNueva` es la puerta estrecha hasta el próximo `db:types`.
    // Un fallo aquí NO rompe la pantalla — se pinta como cuenta activa, que es
    // el caso de casi todo el mundo, y la verdad sigue estando en el diálogo.
    rpcNueva<EstadoBaja>(supabase, "my_account_deletion_state"),
    // El menú lateral es el del panel del rol (undefined = alumno por defecto).
    // El menú sigue al panel del que vienes, no al rol (ver `panelItems`).
    panelMenu(user.id, roles),
  ]);

  const avatarUrl = storageUrl("avatars", profile?.avatar_path);




  return (
    <PanelShell
      items={items}
      badges={badges}
      eyebrow="Cuenta"
      title="Mi cuenta"
      /* §7.1 · el subtítulo nombra las TRES cosas que hay aquí, y la tercera
         («los avisos») es nueva: hasta ahora decía «tu sesión», que es lo menos
         importante de la pantalla. */
      description="Tus datos, tu acceso y los avisos que recibes."
    >
      {/* ⚠️ EL ORDEN DE LA PANTALLA LO DECIDE `AccountForm`, y estas dos
          tarjetas entran por props en vez de detrás. No es rebuscado: §7 fija
          qué va en cada columna y qué va a ancho completo, y partir esa
          decisión entre dos ficheros la rompería el primer día. Aquí se decide
          QUÉ tarjetas hay y con qué datos; allí, DÓNDE cae cada una. */}
      <AccountForm
        userId={user.id}
        email={user.email ?? ""}
        fullName={profile?.full_name ?? ""}
        timezone={profile?.timezone ?? "UTC"}
        avatarUrl={avatarUrl}
        isTutor={roles.includes("tutor")}
        /* La cara de la tarjeta «Tu perfil de tutor»: `null` = nunca empezó
           el alta de tutor (ver el comentario de la consulta, arriba). */
        tutorStatus={tutorProfile?.approval_status ?? null}
        /* Baja programada: si la cuenta está desactivada esperando a que se
           mueva el dinero, la última tarjeta cambia de cara. */
        estadoBaja={estadoBaja}
        /* EY-188 (B5.5) · la misma tarjeta para alumno y tutor: el feed
           devuelve las sesiones en las que participas, sin mirar el rol. */
        calendario={
          <CalendarFeedCard
            tokenInicial={typeof feedToken === "string" ? feedToken : null}
          />
        }
        /* G03 · el otro punto de integración de referidos (Doc 4 §4.x).
           ⚠️ SIN PROPS desde el 11-sep: ya no hay una campaña por rol que
           repartir —`/referidos` pinta todas las visibles— así que aquí no se
           decide nada. Por eso `panel` desapareció de la desestructuración de
           arriba: se leía SOLO para esto. */
        referidos={<ReferralCard />}
      />
    </PanelShell>
  );
}
