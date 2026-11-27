import { createElement } from "react";
import Image from "next/image";
import { ArrowUpRightIcon, CalendarIcon } from "lucide-react";

import { CATEGORY_HERO, categoryIcon } from "@/components/catalog/category-icons";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * Clasificados · la tarjeta pública (listado `/clasificados` y bloque del home).
 *
 * 27-nov · misma estructura que `ProductCard` (la de mentoría): portada arriba y
 * tres datos — categoría, título y fecha deseada. Nada más; el resto vive en el
 * detalle. La tarjeta ENTERA es el enlace (el `before:inset-0` del `<a>`).
 *
 * Solo pinta lo que devuelve `clasificados_publicos`: NO hay alumno en la fila.
 *
 * ⚠️ El enlace es `<a>` y no `<Link>`: `/clasificados/<id>` vive en `(app)` con
 * guarda, y una navegación de cliente que cruza de grupo hasta un `redirect()`
 * deja la pantalla en blanco (regla de oro 13).
 */
export type ClasificadoPublico =
  Database["public"]["Functions"]["clasificados_publicos"]["Returns"][number] & {
    /** Icono de la categoría (para la portada sin foto). */
    category_icon: string | null;
  };

/** Activos y no vencidos. Lanza si la RPC falla: quien llama decide qué hacer. */
export async function listarClasificados(limit = 200): Promise<ClasificadoPublico[]> {
  const supabase = await createClient();
  // ponytail: los iconos van en una consulta aparte y no en la RPC — cambiar lo
  // que devuelve `clasificados_publicos` obliga a drop + create (regla 12).
  const [{ data, error }, cats] = await Promise.all([
    supabase.rpc("clasificados_publicos", { p_limit: limit }),
    supabase.from("categories").select("slug, icon"),
  ]);
  if (error) throw error;
  // Sin iconos la portada cae al genérico: no merece tumbar la página.
  if (cats.error) console.error("[clasificados] categories", cats.error.message);
  const icono = new Map((cats.data ?? []).map((c) => [c.slug, c.icon]));
  return (data ?? []).map((c) => ({ ...c, category_icon: icono.get(c.category_slug) ?? null }));
}

/** `needed_by` es un `date` sin zona: se formatea en UTC para no correrle el día. */
export function fechaDeseada(fecha: string | null): string {
  if (!fecha) return "Fecha flexible";
  const f = new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "long" }).format(
    new Date(`${fecha}T00:00:00Z`),
  );
  return `Para el ${f}`;
}

/** Portada: la foto de la categoría si la hay; si no, su icono — el mismo
 *  respaldo que `ProductCover` en la tarjeta de mentoría. */
export function PortadaCategoria({
  slug,
  icon,
  className,
}: {
  slug: string;
  icon: string | null;
  className: string;
}) {
  const foto = CATEGORY_HERO[slug];
  if (foto) {
    return (
      <Image src={foto} alt="" width={552} height={280} className={`w-full object-cover ${className}`} />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`grid w-full place-items-center bg-linear-to-br from-primary-muted to-brand-muted text-primary-muted-foreground ${className}`}
    >
      <span className="grid size-14 place-items-center">
        {createElement(categoryIcon(icon), { className: "size-full", strokeWidth: 1.5 })}
      </span>
    </div>
  );
}

export function ClasificadoCard({ c }: { c: ClasificadoPublico }) {
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-[16px] border border-[#ebebeb] bg-card shadow-[0_8px_22px_rgb(0_0_0/0.06)] transition-shadow focus-within:ring-2 focus-within:ring-brand/40 hover:shadow-card-hover">
      <PortadaCategoria slug={c.category_slug} icon={c.category_icon} className="h-[140px]" />

      <div className="flex flex-1 flex-col gap-3 p-[18px]">
        <span className="w-fit max-w-full truncate rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium text-[#5c5c5c]">
          {c.category_name}
        </span>
        <h3 title={c.goal} className="line-clamp-2 text-base font-bold text-[#242424]">
          {c.goal}
        </h3>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="flex items-center gap-1.5 text-[12.5px] text-[#4d4d4d]">
            <CalendarIcon className="size-3.5 shrink-0 text-brand" aria-hidden />
            {fechaDeseada(c.needed_by)}
          </span>
          <a
            href={`/clasificados/${c.id}`}
            aria-label={`Ver el clasificado: ${c.goal}`}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-white before:absolute before:inset-0"
          >
            <ArrowUpRightIcon className="size-4" aria-hidden />
          </a>
        </div>
      </div>
    </article>
  );
}
