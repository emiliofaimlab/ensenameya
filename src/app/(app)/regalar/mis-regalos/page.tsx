import Link from "next/link";
import { GiftIcon } from "lucide-react";

import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { panelMenu } from "@/lib/auth/panel-items";
import { createClient } from "@/lib/supabase/server";
import { tutorNames } from "@/lib/booking";
import { Precio } from "@/components/precio/precio";
import {
  PanelCard,
  PanelCardTitle,
  PanelShell,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { COMPANY } from "@/lib/company";
import { diasParaAgendar } from "../gift-policy";

export const metadata = { title: "Mis regalos · Enséñame Ya" };

/**
 * Fecha con AÑO, en la zona de quien mira (RN-01 / RN-02).
 *
 * ⚠️ No se usa `formatShortDate` —que es el helper de la casa— porque ése
 * escribe «12 dic» sin año, y aquí la fecha que más importa es la de caducidad:
 * con 90 días por delante, la mitad de los regalos vencen el año que viene y
 * «12 dic» no dice cuál. `timeZone` explícito es OBLIGATORIO en servidor: sin
 * él el SSR usa la del servidor (UTC en Vercel) y la fecha puede saltar un día.
 */
function fechaLarga(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
}

/** Cómo se lee cada `credits.status` desde el lado de quien PAGÓ el regalo. */
const ESTADO: Record<string, { label: string; tone: PillTone }> = {
  pending_payment: { label: "Sin pagar", tone: "amber" },
  active: { label: "Esperando a que lo agenden", tone: "blue" },
  consumed: { label: "Ya lo agendó", tone: "green" },
  expired: { label: "Caducado", tone: "neutral" },
  refunded: { label: "Reembolsado", tone: "neutral" },
  revoked: { label: "Anulado", tone: "red" },
};

/**
 * US-REG · **LO QUE YO REGALÉ** — a quién, en qué estado y hasta cuándo vale.
 *
 * Sale entera de `mis_regalos_comprados` (`20260912110000`), que es
 * `security_invoker` y filtra por `purchased_by = auth.uid()`: la autorización
 * es la RLS (`credits_select_comprador`), no un `.eq()` de este fichero. Se lee
 * por la VISTA y no por `credits` a propósito — esa tabla tiene `grant select`
 * POR COLUMNAS y un `.select("*")` responde `permission denied`.
 *
 * ⚠️ **LA VISTA NO EXPONE `beneficiary_id`, Y ESO ES EL DISEÑO.** Aquí no se
 * puede decir —ni se dice— si esa dirección tiene cuenta: sería un oráculo de
 * existencia gratis para cualquier correo del mundo. Lo que sí se cuenta es lo
 * observable: si el regalo se agendó o no.
 *
 * ⚠️ **`expires_at` SIGNIFICA DOS COSAS DISTINTAS Y NO SE PUEDEN PINTAR IGUAL.**
 * En `pending_payment` es el plazo de ABANDONO del cobro sin terminar —30 días,
 * lo pone `comprar_regalo` y lo barre `caducar_creditos()`—; en `active` es el
 * plazo real para AGENDAR, que `confirm_gift_payment` reescribe con
 * `gift_expiry_days()`. Enseñar «vale hasta el 11 de octubre» sobre un regalo
 * sin pagar sería prometer una validez que todavía no existe.
 *
 * ⚠️ **«NO HAY» NO ES «NO SE PUDO LEER» (regla de oro 10).** Un
 * `const { data } = …` convierte un fallo de consulta en una lista vacía, que
 * es una mentira creíble: exactamente cómo la cola del admin enseñó «(0)» con
 * 11 tutores esperando. Con un fallo aquí, quien acaba de pagar 45 dólares
 * leería «Todavía no has regalado nada». Así que el error se pinta como error.
 */
export default async function MisRegalosPage() {
  const [{ user, roles }, tz] = await Promise.all([
    requireUser(),
    getUserTimezone(),
  ]);

  const supabase = await createClient();
  const [menu, dias, consulta] = await Promise.all([
    panelMenu(user.id, roles),
    diasParaAgendar(),
    supabase
      .from("mis_regalos_comprados")
      .select(
        // `canjeado` de la vista NO se pide: es `consumed_at is not null`, y
        // aquí ya se lee `consumed_at` para poder decir CUÁNDO se agendó. Pedir
        // las dos sería tener dos versiones del mismo dato en la misma pantalla.
        "id, status, amount, currency, product_id, beneficiary_email, gift_message, expires_at, consumed_at, created_at",
      )
      .order("created_at", { ascending: false }),
  ]);

  const fallo = consulta.error;
  if (fallo) {
    console.error("[mis-regalos] no se pudieron leer los regalos:", fallo.message);
  }
  // El tipo va explícito para que la rama del fallo no infiera `never[]`: con un
  // `never[] | Row[]` el `.map` de abajo deja de ser invocable y el error que da
  // TypeScript no se parece en nada a lo que pasa.
  type RegaloComprado = NonNullable<typeof consulta.data>[number];
  const regalos: RegaloComprado[] = fallo ? [] : (consulta.data ?? []);

  // Los títulos, en UNA consulta y no una por fila. Un producto despublicado
  // después del regalo deja de ser legible por RLS y entonces no hay título que
  // enseñar: se dice «Mentoría» en vez de inventar uno (el regalo sigue siendo
  // válido — el crédito está atado a su `product_id`, no a su título).
  const ids = [...new Set(regalos.map((r) => r.product_id).filter(Boolean))] as string[];
  const titulos = new Map<string, { title: string; tutorId: string | null }>();
  let tutores = new Map<string, string>();
  if (ids.length > 0) {
    const { data: productos, error } = await supabase
      .from("products")
      .select("id, title, tutor_id")
      .in("id", ids);
    if (error) {
      // No bloquea la pantalla: sin títulos la lista sigue diciendo lo esencial
      // —a quién, cuánto y en qué estado—, que es para lo que se entra aquí.
      console.error("[mis-regalos] no se pudieron leer las mentorías:", error.message);
    }
    for (const p of productos ?? []) {
      titulos.set(p.id, { title: p.title, tutorId: p.tutor_id });
    }
    tutores = await tutorNames(
      supabase,
      [...titulos.values()].map((t) => t.tutorId),
    );
  }

  return (
    <PanelShell
      items={menu.items}
      badges={menu.badges}
      back={{ href: "/regalar", label: "Volver a regalar" }}
      title="Mis regalos"
      description="Las mentorías que has regalado: a quién, en qué estado y hasta cuándo valen."
      actions={
        <Button asChild className="h-11 rounded-[10px] font-semibold">
          <Link href="/regalar">Regalar otra</Link>
        </Button>
      }
    >
      {fallo ? (
        <PanelCard>
          <PanelCardTitle className="text-[22px]">
            No pudimos cargar tus regalos
          </PanelCardTitle>
          <p role="alert" className="mt-2 text-[13px] text-[#6b6b6b]">
            Ha fallado la consulta, así que esta lista está incompleta —no es que
            no tengas regalos—. Recarga la página y, si sigue igual, escríbenos a{" "}
            {COMPANY.email}.
          </p>
        </PanelCard>
      ) : regalos.length === 0 ? (
        <PanelCard>
          <PanelCardTitle className="flex items-center gap-2 text-[22px]">
            <GiftIcon className="size-5 shrink-0 text-brand" aria-hidden />
            Todavía no has regalado ninguna mentoría
          </PanelCardTitle>
          <p className="mt-2 text-[13px] text-[#6b6b6b]">
            Eliges la mentoría y la pagas entera; quien la reciba elige el día y
            la hora con ese tutor.
          </p>
          <Button asChild className="mt-5 h-11 rounded-[10px] font-semibold">
            <Link href="/regalar">Elegir una mentoría</Link>
          </Button>
        </PanelCard>
      ) : (
        <PanelCard>
          <ul className="flex flex-col">
            {regalos.map((r) => {
              const estado = ESTADO[r.status ?? ""] ?? {
                label: r.status ?? "—",
                tone: "gray" as PillTone,
              };
              const ficha = r.product_id ? titulos.get(r.product_id) : undefined;
              const tutor = ficha?.tutorId ? tutores.get(ficha.tutorId) : undefined;
              const sinPagar = r.status === "pending_payment";

              return (
                <li
                  key={r.id}
                  className="border-t border-[#e0e0e0] py-4 first:border-0 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-balance text-[#19191f]">
                        {ficha?.title ?? "Mentoría"}
                      </p>
                      <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                        {tutor ? `con ${tutor} · ` : ""}
                        Para{" "}
                        <span className="font-medium text-[#333333]">
                          {r.beneficiary_email ?? "—"}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                      <Precio
                        amountMinor={r.amount ?? 0}
                        currency={r.currency ?? "USD"}
                        className="text-[15px] font-bold text-[#19191f]"
                        notaClassName="text-[11px] text-[#666666]"
                      />
                    </div>
                  </div>

                  {r.gift_message ? (
                    <blockquote className="mt-2 rounded-[10px] bg-muted px-3 py-2 text-[12.5px] text-pretty text-[#595959]">
                      «{r.gift_message}»
                    </blockquote>
                  ) : null}

                  {/* La línea de plazo dice cosas DISTINTAS según el estado
                      porque `expires_at` significa cosas distintas (ver la
                      cabecera). Y en `consumed` no se habla de plazos: ya se
                      agendó, el plazo dejó de existir. */}
                  <p className="mt-2 text-[12.5px] text-[#595959]">
                    {r.status === "consumed" && r.consumed_at
                      ? `Lo agendó el ${fechaLarga(r.consumed_at, tz)}.`
                      : r.status === "active" && r.expires_at
                        ? `Sin agendar todavía. Vale hasta el ${fechaLarga(r.expires_at, tz)}${
                            dias === null ? "" : ` (${dias} días desde el pago)`
                          }.`
                        : sinPagar && r.expires_at
                          ? `Aún no lo has pagado. Si no lo pagas, lo damos por abandonado el ${fechaLarga(r.expires_at, tz)}.`
                          : r.status === "expired" && r.expires_at
                            ? `Caducó el ${fechaLarga(r.expires_at, tz)} sin agendarse.`
                            : r.created_at
                              ? `Creado el ${fechaLarga(r.created_at, tz)}.`
                              : ""}
                  </p>

                  {sinPagar ? (
                    <Button
                      asChild
                      className="mt-3 h-11 rounded-[10px] px-5 font-semibold"
                    >
                      <Link href={`/regalar/${r.id}/pagar`}>Pagar este regalo</Link>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}
    </PanelShell>
  );
}
