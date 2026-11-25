import {
  CategoryExplorer,
  type CategorySearchParams,
} from "@/components/catalog/category-explorer";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";
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
  return (
    <>
      <CategoryExplorer slug={slug} sp={sp} />
      {/* Clasificados · `<a>` y no `<Link>`: `/clasificados/nuevo` tiene guarda
          y esta pantalla se pinta sin sesión (regla de oro 13). */}
      <Container className="pb-12">
        <div className="flex flex-col gap-3 rounded-[16px] border border-[#e0e0e0] bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">¿No encuentras lo que buscas?</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Publica lo que quieres lograr y los tutores te escriben con una propuesta.
            </p>
          </div>
          <Button asChild className="shrink-0 rounded-[8px] font-semibold">
            <a href={`/clasificados/nuevo?categoria=${encodeURIComponent(slug)}`}>
              Publicar lo que busco
            </a>
          </Button>
        </div>
      </Container>
    </>
  );
}
