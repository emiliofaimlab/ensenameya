import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import {
  formatMoney,
  modelLabel,
  sessionsLabel,
} from "@/lib/catalog/format";
import type { ProductCardData } from "@/lib/catalog/queries";

export function FeaturedProducts({
  products,
}: {
  products: ProductCardData[];
}) {
  if (products.length === 0) return null;

  return (
    <div className="bg-muted">
      <Container>
        <Section>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight">
              Resultados listos para reservar
            </h2>
            <Link
              href="/classes"
              className="text-sm font-medium text-brand hover:underline"
            >
              Ver todos →
            </Link>
          </div>

          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((p) => {
              const sessions = sessionsLabel(p);
              return (
                <li
                  key={p.id}
                  className="flex flex-col gap-3 rounded-[20px] bg-card p-5"
                >
                  {/* Sin miniatura: products no tiene columna de imagen. */}
                  <h3 className="text-[15px] font-semibold">{p.title}</h3>
                  {p.outcome ? (
                    <p className="line-clamp-2 text-[13px] text-muted-foreground">
                      {p.outcome}
                    </p>
                  ) : null}

                  <span className="w-fit rounded-full bg-primary-muted px-3 py-1 text-xs font-semibold text-primary-muted-foreground">
                    {modelLabel(p)}
                  </span>

                  <div className="mt-auto flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">
                      {formatMoney(p.priceAmount, p.currency)}
                    </span>
                    {sessions ? (
                      <span className="text-xs text-muted-foreground">
                        {sessions}
                      </span>
                    ) : null}
                  </div>

                  <Link
                    href={`/products/${p.id}`}
                    className="text-[13px] font-semibold text-brand hover:underline"
                  >
                    Ver detalle →
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      </Container>
    </div>
  );
}
