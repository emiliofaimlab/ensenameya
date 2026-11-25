import Link from "next/link";
import { CalendarClockIcon, ClockIcon, HourglassIcon, UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime } from "@/lib/booking";
import { franjasDe, franjasLabel, zonaLabel } from "@/lib/clasificados";
import type { FormatoHora } from "@/lib/hora";

import { Postular, type OfertaElegible } from "./postular";

/**
 * Lo que ve de un clasificado quien NO es su dueño: el clasificado sin datos
 * del alumno y, si es un tutor que puede, el formulario para postular.
 *
 * CONTRATO (lo monta `page.tsx`): no cambiar las props sin cambiar la página.
 */
export type VistaTutorProps = {
  requestId: string;
  userId: string;
  timeZone: string;
  formato: FormatoHora;
};

/** `needed_by` es un `date` sin zona: se formatea en UTC para no correrle el día. */
function fechaSinZona(fecha: string): string {
  return new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "long" }).format(
    new Date(`${fecha}T00:00:00Z`),
  );
}

function postulacionesLabel(n: number): string {
  if (n === 0) return "Aún sin postulaciones";
  return n === 1 ? "1 tutor postulado" : `${n} tutores postulados`;
}

const caja = "rounded-[16px] border border-[#e0e0e0] bg-card p-5";

type PostulacionViva = {
  id: string;
  start_at: string;
  product_id: string;
  conversation_id: string;
  note: string | null;
  products: { title: string } | null;
};

export async function VistaTutor({ requestId, userId, timeZone, formato }: VistaTutorProps) {
  const supabase = await createClient();

  // Solo lo público: `class_requests` no se lee entera fuera de su dueño.
  const { data: filas, error } = await supabase.rpc("clasificados_publicos", { p_id: requestId });
  if (error) throw error;
  const c = filas?.[0];

  if (!c) {
    return (
      <div className={`${caja} flex flex-col items-start gap-3`}>
        <h1 className="text-[17px] font-semibold">Este clasificado ya no recibe postulaciones</h1>
        <p className="text-[14px] text-muted-foreground">
          Se reservó, se cerró o venció. Hay otros alumnos buscando tutor.
        </p>
        <Button asChild variant="outline">
          {/* Pública y sin guarda: `<Link>` no dispara la regla de oro 13. */}
          <Link href="/clasificados">Ver clasificados</Link>
        </Button>
      </div>
    );
  }

  const franjas = franjasDe(c.slots);

  // Las MISMAS condiciones que exige `postular_a_clasificado`: lo que no
  // pasaría, no se ofrece. Los errores se miran: una lista vacía por un fallo
  // diría «no tienes mentorías», que es una mentira creíble (regla de oro 10).
  const [perfil, ofertas, viva] = await Promise.all([
    supabase.from("tutor_profiles").select("approval_status").eq("profile_id", userId).maybeSingle(),
    supabase
      .from("products")
      .select("id, title, session_duration_min, product_categories!inner(category_id)")
      .eq("tutor_id", userId)
      .eq("status", "active")
      .eq("visibility", "public")
      .in("pricing_model", ["per_session", "per_hour"])
      .is("academy_id", null)
      .is("group_template_id", null)
      .eq("product_categories.category_id", c.category_id)
      .order("title"),
    supabase
      .from("class_proposals")
      .select("id, start_at, product_id, conversation_id, note, products(title)")
      .eq("request_id", requestId)
      .eq("tutor_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (perfil.error) throw perfil.error;
  if (ofertas.error) throw ofertas.error;
  if (viva.error) throw viva.error;

  const aprobado = perfil.data?.approval_status === "approved";
  const elegibles: OfertaElegible[] = (ofertas.data ?? []).map((o) => ({
    id: o.id,
    title: o.title,
    session_duration_min: o.session_duration_min,
  }));
  const postulacion = viva.data as PostulacionViva | null;

  return (
    <div className="flex flex-col gap-4">
      <article className={caja}>
        <span className="inline-flex items-center rounded-full bg-[#dbedff] px-2.5 py-1 text-xs font-semibold text-[#0063c4]">
          {c.category_name}
        </span>
        <h1 className="mt-3 text-[20px] font-bold text-pretty text-[#19191f]">{c.goal}</h1>
        {c.detail ? (
          <p className="mt-2 text-[14px] whitespace-pre-line text-[#525252]">{c.detail}</p>
        ) : null}

        <ul className="mt-4 space-y-2 text-[14px] text-[#525252]">
          {franjas.length > 0 ? (
            <li className="flex gap-2">
              <ClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {franjasLabel(franjas)}, {zonaLabel(c.timezone)}
              </span>
            </li>
          ) : null}
          {c.needed_by ? (
            <li className="flex gap-2">
              <CalendarClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Para el {fechaSinZona(c.needed_by)}</span>
            </li>
          ) : null}
          <li className="flex gap-2">
            <HourglassIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Recibe postulaciones hasta: {formatSessionTime(c.expires_at, timeZone, formato)}
            </span>
          </li>
          <li className="flex gap-2">
            <UsersIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{postulacionesLabel(c.postulaciones)}</span>
          </li>
        </ul>
      </article>

      {!perfil.data ? (
        <div className={`${caja} flex flex-col items-start gap-3`}>
          <p className="text-[15px] font-semibold">¿Sabes enseñar esto?</p>
          <p className="text-[14px] text-muted-foreground">
            Solo los tutores de Enséñame Ya pueden postular a un clasificado.
          </p>
          <Button asChild>
            {/* `<a>`: `/ensena` vive en otro grupo de rutas (regla de oro 13). */}
            <a href="/ensena">Postúlate como tutor</a>
          </Button>
        </div>
      ) : !aprobado ? (
        <div className={`${caja} flex flex-col items-start gap-3`}>
          <p className="text-[15px] font-semibold">Tu perfil de tutor aún no está aprobado</p>
          <p className="text-[14px] text-muted-foreground">
            Cuando lo aprobemos podrás postular a los clasificados de tus categorías.
          </p>
          <Button asChild variant="outline">
            <Link href="/tutor/verification">Ver el estado de mi solicitud</Link>
          </Button>
        </div>
      ) : elegibles.length === 0 ? (
        <div className={`${caja} flex flex-col items-start gap-3`}>
          <p className="text-[15px] font-semibold">Aún no puedes postular a este clasificado</p>
          <p className="text-[14px] text-muted-foreground">
            Necesitas una mentoría tuya 1:1 (por sesión o por hora), activa, pública y en la
            categoría <strong>{c.category_name}</strong>. Las clases grupales y las de academia no
            cuentan.
          </p>
          <Button asChild variant="outline">
            <Link href="/tutor/products">Ir a mis mentorías</Link>
          </Button>
        </div>
      ) : (
        <div className={`${caja} flex flex-col gap-3`}>
          {postulacion ? (
            <div className="flex flex-col gap-2 rounded-[10px] bg-[#e9f7ef] p-3 text-[14px]">
              <p>
                <strong>Ya postulaste:</strong> {postulacion.products?.title ?? "tu mentoría"},{" "}
                {formatSessionTime(postulacion.start_at, timeZone, formato).toLowerCase()}
              </p>
              {postulacion.note ? (
                <p className="text-[13px] text-[#525252] italic">«{postulacion.note}»</p>
              ) : null}
              <p className="text-[13px] text-[#525252]">
                El alumno la ve en el chat con su botón de pago.
              </p>
              <Button asChild variant="outline" className="w-fit">
                <a href={`/chat/${postulacion.conversation_id}`}>Abrir chat</a>
              </Button>
            </div>
          ) : null}
          <Postular
            requestId={c.id}
            ofertas={elegibles}
            franjas={franjas}
            zonaAlumno={c.timezone}
            expiresAt={c.expires_at}
            timeZone={timeZone}
            formato={formato}
            actual={
              postulacion
                ? { productId: postulacion.product_id, note: postulacion.note ?? "" }
                : null
            }
          />
        </div>
      )}
    </div>
  );
}
