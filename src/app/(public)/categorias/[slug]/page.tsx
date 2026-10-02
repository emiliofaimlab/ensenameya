import {
  CategoryExplorer,
  type CategorySearchParams,
} from "@/components/catalog/category-explorer";
import { getCategoryBySlug } from "@/lib/catalog/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  return { title: category ? `${category.name} · Enséñame Ya` : "Categoría" };
}

/** P06 con una categoría activa: mismo frame, listado filtrado. */
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<CategorySearchParams>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  return <CategoryExplorer slug={slug} sp={sp} />;
}
