import Link from "next/link";
import { MegaphoneIcon } from "lucide-react";

import { FilterPills } from "@/components/catalog/filter-pills";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { ClasificadoCard, listarClasificados } from "@/components/clasificados/clasificado-card";

export const metadata = {
  title: "Lo que están buscando los alumnos · Enséñame Ya",
  description:
    "Clasificados de alumnos: qué quieren lograr, en qué categoría y en qué horarios. Si sabes enseñarlo, postúlate con una mentoría lista para reservar.",
};

/**
 * Clasificados · fase 3, la capa de demanda. Se pinta SIN sesión: la RPC
 * `clasificados_publicos` está abierta a `anon` y no devuelve al alumno.
 *
 * El filtro va por `?categoria=<slug>` y se resuelve AQUÍ, sobre la misma tanda
 * de 200: la RPC filtra por `category_id` (uuid), y traerlo todo una vez da
 * además los chips con su recuento sin una segunda consulta. Cuando haya más de
 * 200 activos a la vez, esto pasa a resolver el slug y filtrar en la RPC.
 *
 * ⚠️ Los enlaces a `/clasificados/nuevo` y `/clasificados/<id>` son `<a>`, no
 * `<Link>`: esas rutas viven en `(app)` con guarda (regla de oro 13).
 */
export default async function ClasificadosPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string }>;
}) {
  const [{ categoria }, todos] = await Promise.all([searchParams, listarClasificados(200)]);

  const categorias = new Map<string, { slug: string; name: string; n: number }>();
  for (const c of todos) {
    const actual = categorias.get(c.category_slug);
    if (actual) actual.n++;
    else categorias.set(c.category_slug, { slug: c.category_slug, name: c.category_name, n: 1 });
  }
  const chips = [...categorias.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const activa = categoria && categorias.has(categoria) ? categoria : null;
  const lista = activa ? todos.filter((c) => c.category_slug === activa) : todos;

  const hrefCat = (slug?: string) =>
    slug ? `/clasificados?categoria=${encodeURIComponent(slug)}` : "/clasificados";

  // 27-nov · mismo armazón que `/mentorias`: hero azul, filtros a la izquierda
  // desde `lg` (píldoras por debajo) y rejilla de tarjetas a la derecha.
  return (
    <>
      <div className="bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-12">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/90">
            <Link href="/" className="-my-3 inline-block py-3 hover:underline">
              Inicio
            </Link>
            {" / "}
            <span>Clasificados</span>
          </nav>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <h1 className="text-2xl font-bold sm:text-3xl">Lo que están buscando los alumnos</h1>
            <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-semibold">
              <span className="size-1.5 rounded-full bg-white" />
              {todos.length} {todos.length === 1 ? "clasificado activo" : "clasificados activos"}
            </span>
          </div>
          <p className="mt-4 max-w-3xl text-[15px] text-pretty text-white/90">
            Cada clasificado es lo que un alumno quiere lograr y cuándo puede. Los tutores de esa
            categoría se postulan con una mentoría lista para reservar, y el alumno elige.
          </p>

          <div className="mt-6 flex flex-col gap-3 rounded-[16px] bg-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <MegaphoneIcon className="size-4 shrink-0" aria-hidden />
              ¿Buscas tutor? Publica lo que quieres lograr
            </p>
            <Button asChild className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- regla 13 */}
              <a href="/clasificados/nuevo">Publicar un clasificado</a>
            </Button>
          </div>
        </Container>
      </div>

      <Container>
        <Section className="grid gap-8 lg:grid-cols-[248px_1fr]">
          <aside className="hidden h-fit rounded-[16px] border border-[#dbdbdb] bg-card p-[22px] lg:sticky lg:top-24 lg:block">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-bold">Filtros</h2>
              {activa ? (
                <Link
                  href={hrefCat()}
                  className="text-[13px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Limpiar
                </Link>
              ) : null}
            </div>
            <p className="mt-5 text-sm font-bold text-[#242424]">Categoría</p>
            <ul className="mt-2 space-y-1.5">
              {chips.map((c) => {
                const on = activa === c.slug;
                return (
                  <li key={c.slug}>
                    <Link
                      href={hrefCat(on ? undefined : c.slug)}
                      aria-current={on ? "true" : undefined}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <span
                        className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] border text-[11px] ${
                          on ? "border-brand bg-brand text-white" : "bg-card"
                        }`}
                      >
                        {on ? "✓" : null}
                      </span>
                      {c.name} ({c.n})
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>

          <div className="min-w-0">
            <FilterPills
              className="lg:hidden"
              ariaLabel="Filtros de clasificados"
              clearHref={hrefCat()}
              filters={[
                {
                  key: "cat",
                  label: "Categoría",
                  current: activa ? categorias.get(activa)?.name : undefined,
                  options: chips.map((c) => ({
                    label: `${c.name} (${c.n})`,
                    href: hrefCat(c.slug),
                    active: activa === c.slug,
                  })),
                },
              ]}
            />

            <p className="mt-5 text-[13px] text-[#595959] lg:mt-0">
              {lista.length} {lista.length === 1 ? "clasificado" : "clasificados"}
              {activa ? ` en ${categorias.get(activa)?.name}` : ""}
            </p>

            {lista.length === 0 ? (
              <div className="mt-6 rounded-[16px] border border-[#ebebeb] bg-card p-8 text-center">
                <p className="text-[15px] text-[#525252]">
                  Ahora mismo no hay clasificados activos
                  {categoria && !activa ? " en esa categoría" : ""}. Los alumnos los publican cuando
                  no encuentran la mentoría que necesitan.
                </p>
                <Button asChild className="mt-5">
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- regla 13 */}
                  <a href="/clasificados/nuevo">Publica el primero</a>
                </Button>
              </div>
            ) : (
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {lista.map((c) => (
                  <li key={c.id}>
                    <ClasificadoCard c={c} />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-10 rounded-[16px] border border-[#ebebeb] bg-muted/40 p-6 text-center sm:p-8">
              <h2 className="text-[18px] font-bold text-[#212121]">¿Sabes enseñar esto?</h2>
              <p className="mx-auto mt-2 max-w-xl text-[14.5px] text-[#525252]">
                Crea tu perfil de tutor y te avisamos cuando un alumno publique algo de tu categoría.
              </p>
              <Button asChild className="mt-5">
                <Link href="/ensena">Postúlate como tutor</Link>
              </Button>
            </div>
          </div>
        </Section>
      </Container>
    </>
  );
}
