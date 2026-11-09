import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/server";
import { leerAcademias } from "@/lib/admin/academias";
import { AdminShell } from "@/components/layout/admin-shell";
import { PanelCard, PanelCardTitle, StatusPill } from "@/components/layout/panel-shell";
import { ESTADO_ACADEMIA } from "../estado";
import { CambiosPendientes } from "../cambios-pendientes";
import { FormularioAcademia } from "../formulario-academia";
import { AccionesAcademia } from "./acciones-academia";

export const metadata = { title: "Academia · Admin · Enséñame Ya" };

/** A2 · editar, permisos, aprobación pendiente y «Ver como la academia». */
export default async function AdminAcademiaPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  const [{ id }, todas] = await Promise.all([params, leerAcademias()]);
  const a = todas.find((x) => x.id === id);
  if (!a) notFound();

  const estado = ESTADO_ACADEMIA[a.status] ?? { label: a.status, tone: "neutral" as const };
  const t = (v: string | number | null) => (v === null ? "" : String(v));

  return (
    <AdminShell
      eyebrow={<Link href="/admin/academias" className="hover:underline">Academias</Link>}
      title={a.name}
      description={`${a.tutores} tutores · ${a.alumnos} alumnos · ${a.ofertas} ofertas · ${a.reservas} reservas`}
      actions={
        <div className="flex items-center gap-3">
          <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
          {/* Guarda propia (`requireAcademiaPropia`): enlace interno de (app), regla 13 a salvo. */}
          <Link href={`/academia?a=${a.id}`} className="text-[13px] font-semibold text-brand-foreground hover:underline">
            Ver como la academia
          </Link>
        </div>
      }
    >
      {a.pending_changes ? (
        <PanelCard>
          <PanelCardTitle>Cambios de perfil por aprobar</PanelCardTitle>
          <div className="mt-3">
            <CambiosPendientes academia={a} />
          </div>
        </PanelCard>
      ) : a.pending_changes_rejection ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">Último rechazo: {a.pending_changes_rejection}</p>
        </PanelCard>
      ) : null}

      <PanelCard>
        <PanelCardTitle>Permisos</PanelCardTitle>
        <div className="mt-3">
          <AccionesAcademia
            id={a.id}
            status={a.status}
            administrador={a.owner_name ?? a.owner_email}
            invitado={a.invited_email}
          />
        </div>
      </PanelCard>

      <PanelCard>
        <FormularioAcademia
          id={a.id}
          inicial={{
            name: a.name, slug: a.slug, tagline: t(a.tagline), description: t(a.description),
            website: t(a.website), brand_color: t(a.brand_color), policies_url: t(a.policies_url),
            payout_country: t(a.payout_country), allow_public_offers: a.allow_public_offers,
            commission_pct: t(a.commission_pct),
            fixed_fee: a.fixed_fee_amount === null ? "" : String(a.fixed_fee_amount / 100),
            fixed_fee_currency: t(a.fixed_fee_currency) || "USD", fixed_fee_period: t(a.fixed_fee_period),
            included_free_classes: t(a.included_free_classes), agreement_starts_on: t(a.agreement_starts_on),
            agreement_notes: t(a.agreement_notes),
          }}
        />
      </PanelCard>
    </AdminShell>
  );
}
