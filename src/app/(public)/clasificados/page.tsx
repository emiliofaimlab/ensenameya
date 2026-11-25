import Link from "next/link";
import { MegaphoneIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { ClasificadoCard, listarClasificados } from "@/components/clasificados/clasificado-card";
import { cn } from "@/lib/utils";

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

  return (
    <>
      <div className="bg-brand bg-linear-to-r from-[#0072ff] to-[#49a9ff] to-80% text-white">
        <Container className="py-10 sm:py-14">
          <nav aria-label="Miga de pan" className="text-[13px] text-white/90">
            <Link href="/" className="-my-3 inline-block py-3 hover:underline">
              Inicio
            </Link>
            {" / "}
            <span>Clasificados</span>
          </nav>

          <h1 className="mt-4 text-2xl font-bold text-balance sm:text-3xl">
            Lo que están buscando los alumnos
          </h1>
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
        <Section>
          {chips.length > 1 ? (
            <nav aria-label="Filtrar por categoría" className="mb-6 flex flex-wrap gap-2">
              <Chip href="/clasificados" activo={!activa}>
                Todas ({todos.length})
              </Chip>
              {chips.map((c) => (
                <Chip
                  key={c.slug}
                  href={`/clasificados?categoria=${encodeURIComponent(c.slug)}`}
                  activo={activa === c.slug}
                >
                  {c.name} ({c.n})
                </Chip>
              ))}
            </nav>
          ) : null}

          {lista.length === 0 ? (
            <div className="rounded-[16px] border border-[#ebebeb] bg-card p-8 text-center">
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
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
        </Section>
      </Container>
    </>
  );
}

function Chip({
  href,
  activo,
  children,
}: {
  href: string;
  activo: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      className={cn(
        "inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
        activo
          ? "border-brand bg-brand text-white"
          : "border-[#e0e0e0] bg-card text-[#333333] hover:border-brand",
      )}
    >
      {children}
    </Link>
  );
}
