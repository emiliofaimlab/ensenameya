import Link from "next/link";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { priceLabel } from "@/lib/catalog/format";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ProductStatusActions } from "./product-status-actions";

export const metadata = { title: "Mis productos · Enséñame Ya" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador",
  active: "Publicado",
  paused: "Pausado",
  archived: "Archivado",
};

/**
 * US-401 (SCR-TU04) — Catálogo del tutor: lista sus productos. Alta/edición van
 * a `/tutor/products/new` y `/…/[id]/edit`. Publicar/pausar/archivar → US-402.
 */
export default async function TutorProductsPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();
  const { data: products } = await supabase
    .from("products")
    .select(
      "id, title, status, pricing_model, price_amount, currency, package_num_sessions, session_duration_min, product_categories(categories(name))",
    )
    .eq("tutor_id", userId)
    .order("created_at", { ascending: false });

  return (
    <Container>
      <Section className="flex flex-col gap-6">
        <PageHeader
          title="Mis productos"
          description="Crea y edita las tutorías que ofreces."
          actions={
            <>
              <Button asChild variant="outline">
                <Link href="/tutor/availability">Disponibilidad</Link>
              </Button>
              <Button asChild>
                <Link href="/tutor/products/new">Crear producto</Link>
              </Button>
            </>
          }
        />

        {approvalStatus !== "approved" ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            Puedes preparar borradores ahora. Para <strong>publicarlos</strong>,
            tu perfil de tutor debe estar aprobado.
          </p>
        ) : null}

        {!products?.length ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3 py-8 text-sm text-muted-foreground">
              <p>Aún no tienes productos. Crea el primero para empezar a enseñar.</p>
              <Button asChild>
                <Link href="/tutor/products/new">Crear mi primer producto</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {products.map((p) => {
              const cats = (p.product_categories ?? [])
                .map((pc) => pc.categories?.name)
                .filter(Boolean);
              return (
                <li key={p.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.title}</span>
                          <Badge variant={p.status === "active" ? "default" : "secondary"}>
                            {STATUS_LABEL[p.status] ?? p.status}
                          </Badge>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {priceLabel({
                            pricingModel: p.pricing_model,
                            priceAmount: p.price_amount,
                            currency: p.currency,
                            packageNumSessions: p.package_num_sessions,
                          })}
                          {" · "}
                          {p.session_duration_min} min
                          {cats.length ? ` · ${cats.join(", ")}` : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ProductStatusActions
                          productId={p.id}
                          status={p.status}
                          isApproved={approvalStatus === "approved"}
                        />
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/tutor/products/${p.id}/edit`}>Editar</Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </Container>
  );
}
