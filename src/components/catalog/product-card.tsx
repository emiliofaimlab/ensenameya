import Link from "next/link";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { priceLabel } from "@/lib/catalog/format";
import type { ProductCardData } from "@/lib/catalog/queries";

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link href={`/products/${product.id}`} className="group">
      <Card className="flex h-full flex-col transition-colors group-hover:border-ring">
        <CardHeader>
          <CardTitle className="text-base">{product.title}</CardTitle>
          {product.outcome ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {product.outcome}
            </p>
          ) : null}
        </CardHeader>
        {product.categories.length > 0 ? (
          <CardContent className="mt-auto flex flex-wrap gap-1.5">
            {product.categories.map((c) => (
              <Badge key={c.slug} variant="secondary">
                {c.name}
              </Badge>
            ))}
          </CardContent>
        ) : null}
        <CardFooter className="font-medium">{priceLabel(product)}</CardFooter>
      </Card>
    </Link>
  );
}
