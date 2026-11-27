import Link from "next/link";
import { CalendarClockIcon, ClockIcon, UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { franjasDe, franjasLabel, zonaLabel } from "@/lib/clasificados";
import type { Database } from "@/lib/database.types";

/**
 * Clasificados · la tarjeta pública (listado `/clasificados` y bloque del home).
 *
 * Solo pinta lo que devuelve `clasificados_publicos`: NO hay alumno en la fila,
 * y no se le va a añadir aquí («público sin datos personales»).
 *
 * ⚠️ «Ver y postular» va con `<a>` y no con `<Link>`: `/clasificados/<id>` vive
 * en `(app)` con guarda, y una navegación de cliente que cruza de grupo hasta un
 * `redirect()` de servidor deja la pantalla en blanco (regla de oro 13).
 */
export type ClasificadoPublico =
  Database["public"]["Functions"]["clasificados_publicos"]["Returns"][number];

/** Activos y no vencidos. Lanza si la RPC falla: quien llama decide qué hacer. */
export async function listarClasificados(limit = 200): Promise<ClasificadoPublico[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clasificados_publicos", { p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

/**
 * «hace 3 h». Se calcula en el SERVIDOR al pintar: en un componente cliente el
 * reloj del navegador daría otro texto que el HTML (error de hidratación).
 */
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const min = Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(min) || min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

/** `needed_by` es un `date` sin zona: se formatea en UTC para no correrle el día. */
function fechaCorta(fecha: string): string {
  return new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "long" }).format(
    new Date(`${fecha}T00:00:00Z`),
  );
}

function postulacionesLabel(n: number): string {
  if (n === 0) return "Aún sin postulaciones";
  return n === 1 ? "1 tutor postulado" : `${n} tutores postulados`;
}

export function ClasificadoCard({
  c,
  compacta = false,
}: {
  c: ClasificadoPublico;
  /** Home: sin detalle ni CTA de tutor, para que quepan seis sin un muro. */
  compacta?: boolean;
}) {
  const franjas = franjasDe(c.slots);

  return (
    <article className="flex h-full flex-col rounded-[16px] border border-[#e0e0e0] bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-[#dbedff] px-2.5 py-1 text-xs font-semibold text-[#0063c4]">
          {c.category_name}
        </span>
        <span className="text-xs text-[#595959]">Publicado {haceCuanto(c.created_at)}</span>
      </div>

      <h3 className="mt-3 text-[16px] font-bold text-pretty text-[#19191f]">{c.goal}</h3>

      {!compacta && c.detail ? (
        <p className="mt-2 line-clamp-3 text-[14px] text-[#525252]">{c.detail}</p>
      ) : null}

      <ul className="mt-3 space-y-1.5 text-[13px] text-[#525252]">
        {franjas.length > 0 ? (
          <li className="flex gap-2">
            <ClockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {franjasLabel(franjas)}{" "}
              <span className="text-[#6b6b6b]">({zonaLabel(c.timezone)})</span>
            </span>
          </li>
        ) : null}
        {c.needed_by ? (
          <li className="flex gap-2">
            <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>Para el {fechaCorta(c.needed_by)}</span>
          </li>
        ) : null}
        <li className="flex gap-2">
          <UsersIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{postulacionesLabel(c.postulaciones)}</span>
        </li>
      </ul>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <Button asChild className="w-full">
          <a href={`/clasificados/${c.id}`}>Ver y postular</a>
        </Button>
        {!compacta ? (
          <Link
            href="/ensena"
            className="-my-1 py-1 text-center text-[13px] font-medium text-brand hover:underline"
          >
            ¿Sabes enseñar esto? Postúlate como tutor
          </Link>
        ) : null}
      </div>
    </article>
  );
}
