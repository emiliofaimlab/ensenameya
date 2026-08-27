import Link from "next/link";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { parseFaqs } from "@/lib/tutor-faqs";
import { PanelCard } from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { TutorFaqsForm } from "./faqs-form";

export const metadata = { title: "Mis preguntas frecuentes · Enséñame Ya" };

/**
 * EY-194 (petición del cliente del 26-ago) — las FAQ del TUTOR.
 *
 * POR QUÉ ESTA PANTALLA EXISTE Y NO ES UN BLOQUE DEL ASISTENTE: el asistente de
 * tutor (`/tutor/onboarding`) se cierra en cuanto el perfil está `approved` —
 * enseña "Ya eres tutor" y nada más—, así que meter aquí el editor lo dejaría
 * fuera del alcance de justo los tutores que publican mentorías. Hoy no hay
 * ninguna otra pantalla donde el tutor aprobado edite su perfil de vitrina
 * (headline, bio, redes): eso es un hueco conocido y más grande que esta
 * historia, y este módulo no lo tapa — solo evita heredarlo.
 *
 * Se exige `requireTutorProfile` y NO el rol `tutor`: el rol se concede al
 * aprobar (US-1101) y un tutor pendiente puede ir dejando escritas sus
 * respuestas mientras espera, igual que ya puede preparar mentorías en
 * borrador.
 */
export default async function TutorFaqsPage() {
  const { userId, approvalStatus } = await requireTutorProfile();

  const supabase = await createClient();

  const [{ data: perfil }, { count: mentorias }] = await Promise.all([
    supabase
      .from("tutor_profiles")
      .select("faqs")
      .eq("profile_id", userId)
      .maybeSingle(),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", userId),
  ]);

  const faqs = parseFaqs(perfil?.faqs);
  const cuantas = mentorias ?? 0;

  return (
    <TutorShell
      title="Preguntas frecuentes"
      description="Se escriben una vez y aparecen en todas tus mentorías."
    >
      {approvalStatus !== "approved" ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            Tus respuestas serán visibles para los alumnos cuando tu perfil de
            tutor esté aprobado. Puedes escribirlas desde ya.
          </p>
        </PanelCard>
      ) : null}

      <PanelCard>
        <h2 className="text-base font-semibold text-[#19191f]">
          Tus respuestas de siempre
        </h2>
        <p className="mt-1 text-[13px] text-[#6b6b6b]">
          Lo que te preguntan una y otra vez sea cual sea la mentoría: cómo son
          tus clases, qué necesita el alumno, cómo te organizas.{" "}
          {cuantas > 0 ? (
            <>
              Aparecen en{" "}
              <Link
                href="/tutor/products"
                className="font-medium text-brand hover:underline"
              >
                tus {cuantas} {cuantas === 1 ? "mentoría" : "mentorías"}
              </Link>
              , debajo de las que hayas escrito para cada una.
            </>
          ) : (
            <>
              Aparecerán en cada mentoría que publiques, debajo de las que
              escribas para ella.
            </>
          )}
        </p>
        <div className="mt-4">
          <TutorFaqsForm userId={userId} initial={faqs} />
        </div>
      </PanelCard>
    </TutorShell>
  );
}
