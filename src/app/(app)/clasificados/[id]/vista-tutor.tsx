import Link from "next/link";
import { CalendarIcon, ClockIcon, HourglassIcon, UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime } from "@/lib/booking";
import { franjasDe, franjasLabel, zonaLabel } from "@/lib/clasificados";
import type { FormatoHora } from "@/lib/hora";

import { Postular, type OfertaElegible } from "./postular";
import { AbrirChatButton } from "@/components/chat/abrir-chat-button";
import { fechaDeseada } from "@/components/clasificados/clasificado-card";
import { cajaLateral, DatoFicha, FichaClasificado, SeccionFicha } from "./ficha";

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

function postulacionesLabel(n: number): string {
  if (n === 0) return "Aún sin postulaciones";
  return n === 1 ? "1 tutor postulado" : `${n} tutores postulados`;
}

const caja = "rounded-[16px] border border-[#ebebeb] bg-card p-6 shadow-[0_8px_22px_rgb(0_0_0/0.04)]";

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
      <div className={`${caja} mx-auto my-10 flex max-w-xl flex-col items-start gap-3`}>
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
  const [perfil, ofertas, viva, cat] = await Promise.all([
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
    supabase.from("categories").select("icon").eq("id", c.category_id).maybeSingle(),
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
    <FichaClasificado
      categoria={{ name: c.category_name, slug: c.category_slug, icon: cat.data?.icon ?? null }}
      titulo={c.goal}
      datos={
        <>
          <DatoFicha>
            <CalendarIcon className="size-3.5" aria-hidden />
            {fechaDeseada(c.needed_by)}
          </DatoFicha>
          {franjas.length > 0 ? (
            <DatoFicha>
              <ClockIcon className="size-3.5" aria-hidden />
              {franjasLabel(franjas)} ({zonaLabel(c.timezone)})
            </DatoFicha>
          ) : null}
        </>
      }
      lateral={
        <div className={`${cajaLateral} flex flex-col gap-3 text-[14px] text-[#525252]`}>
          <p className="text-sm font-bold text-[#242424]">{c.category_name}</p>
          <p className="flex gap-2">
            <UsersIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            {postulacionesLabel(c.postulaciones)}
          </p>
          <p className="flex gap-2">
            <HourglassIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>
              Recibe postulaciones hasta: {formatSessionTime(c.expires_at, timeZone, formato)}
            </span>
          </p>
          {aprobado && elegibles.length > 0 ? (
            <Button asChild className="mt-1 w-full">
              <a href="#postular">{postulacion ? "Cambiar mi postulación" : "Postularme"}</a>
            </Button>
          ) : null}
        </div>
      }
    >
      {c.detail ? (
        <SeccionFicha titulo="Lo que quiere lograr">
          <p className="text-[14px] whitespace-pre-line text-[#525252]">{c.detail}</p>
        </SeccionFicha>
      ) : null}

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
        <div id="postular" className={`${caja} flex scroll-mt-24 flex-col gap-3`}>
          <h2 className="text-lg font-bold text-[#242424]">Tu postulación</h2>
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
              <AbrirChatButton conversationId={postulacion.conversation_id} variant="outline" className="w-fit">
                Abrir chat
              </AbrirChatButton>
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
    </FichaClasificado>
  );
}
