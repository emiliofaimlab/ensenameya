import Image from "next/image";
import Link from "next/link";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { initialsFrom, priceLabel, storageUrl } from "@/lib/catalog/format";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { Button } from "@/components/ui/button";
import { ProductStatusActions } from "./product-status-actions";

export const metadata = { title: "Mis mentorías · Enséñame Ya" };

/** Píldoras del Figma (191:60/78/96): color por estado del producto. */
const STATUS_PILL: Record<string, { label: string; tone: PillTone }> = {
  active: { label: "Activo", tone: "green" },
  draft: { label: "Borrador", tone: "neutral" },
  paused: { label: "Pausado", tone: "amber" },
  archived: { label: "Archivado", tone: "neutral" },
};

/**
 * US-401 (SCR-TU03) — Catálogo del tutor. Cada mentoría es una tarjeta con
 * miniatura, resultado y acciones (191:52). Publicar/pausar/archivar → US-402.
 */
export default async function TutorProductsPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select(
      "id, title, status, outcome, image_path, pricing_model, price_amount, currency, package_num_sessions, session_duration_min, product_categories(categories(name))",
    )
    .eq("tutor_id", userId)
    .order("created_at", { ascending: false });

  return (
    <TutorShell
      title="Mis mentorías"
      description="Crea y gestiona las clases que ofreces."
      actions={
        <Button asChild className="h-[45px] rounded-[8px] px-5 font-semibold">
          <Link href="/tutor/products/new">Crear mentoría</Link>
        </Button>
      }
    >
      {approvalStatus !== "approved" ? (
        <PanelCard className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#19191f]">
              Tu cuenta está en revisión
            </p>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
              Podrás publicar mentorías cuando se apruebe tu perfil (RN-23).
              Mientras tanto puedes guardarlas como borrador.
            </p>
          </div>
          <StatusPill tone="blue" className="h-7">
            En revisión
          </StatusPill>
        </PanelCard>
      ) : null}

      {!products?.length ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Aún no tienes mentorías. Crea la primera para empezar a enseñar.
          </p>
          <Button asChild className="mt-4 h-10 rounded-[8px] font-semibold">
            <Link href="/tutor/products/new">Crear mi primera mentoría</Link>
          </Button>
        </PanelCard>
      ) : (
        <ul className="flex flex-col gap-4">
          {products.map((p) => {
            const cats = (p.product_categories ?? [])
              .map((pc) => pc.categories?.name)
              .filter(Boolean);
            const thumb = storageUrl("product-images", p.image_path);
            const pill =
              STATUS_PILL[p.status] ?? { label: p.status, tone: "neutral" as const };
            return (
              <li key={p.id}>
                <PanelCard>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3.5">
                      {/* Miniatura 64×64 r12 (191:55); iniciales si no hay. */}
                      <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-brand-muted font-semibold text-brand">
                        {thumb ? (
                          <Image
                            src={thumb}
                            alt=""
                            width={64}
                            height={64}
                            className="size-16 object-cover"
                            unoptimized
                          />
                        ) : (
                          initialsFrom(p.title)
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-semibold text-[#19191f]">
                          {p.title}
                        </p>
                        {p.outcome ? (
                          <p className="mt-0.5 line-clamp-1 text-[12.5px] text-[#595959]">
                            Resultado: {p.outcome}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-[#6b6b6b]">
                          {priceLabel({
                            pricingModel: p.pricing_model,
                            priceAmount: p.price_amount,
                            currency: p.currency,
                            packageNumSessions: p.package_num_sessions,
                          })}
                          {p.session_duration_min
                            ? ` · ${p.session_duration_min} min`
                            : ""}
                          {cats.length ? ` · ${cats.join(", ")}` : ""}
                        </p>
                      </div>
                    </div>
                    <StatusPill tone={pill.tone} className="h-7">
                      {pill.label}
                    </StatusPill>
                  </div>

                  <hr className="my-4 border-[#e0e0e0]" />

                  <div className="flex flex-wrap items-center gap-2.5">
                    <Button
                      asChild
                      variant="outline"
                      className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    >
                      <Link href={`/tutor/products/${p.id}/edit`}>Editar</Link>
                    </Button>
                    <ProductStatusActions
                      productId={p.id}
                      status={p.status}
                      isApproved={approvalStatus === "approved"}
                    />
                  </div>
                </PanelCard>
              </li>
            );
          })}
        </ul>
      )}
    </TutorShell>
  );
}
