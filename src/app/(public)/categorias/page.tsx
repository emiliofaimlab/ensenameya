import {
  CategoryExplorer,
  type CategorySearchParams,
} from "@/components/catalog/category-explorer";

export const metadata = { title: "Categorías · Enséñame Ya" };

/** P06 sin categoría fijada: el catálogo completo con el selector arriba. */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<CategorySearchParams>;
}) {
  return <CategoryExplorer sp={await searchParams} />;
}
