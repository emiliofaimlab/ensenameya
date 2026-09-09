import Link from "next/link";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/server";
import { storageUrl } from "@/lib/catalog/format";
import { createClient } from "@/lib/supabase/server";
import { parseSocials } from "@/lib/socials";
import { TutorProfileBasics } from "@/components/tutor/profile-basics";
import {
  PanelCard,
  PanelCardTitle,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { Button } from "@/components/ui/button";
import { VerificationForm, type DocState } from "./verification-form";

// §6.3 · El título de la pestaña sigue al de la pantalla. El nombre viejo
// («…de identidad») además se había quedado corto: aquí se repasan foto,
// biografía, portafolio y primera mentoría, no solo el DNI.
export const metadata = { title: "Verificación · Enséñame Ya" };

/** Estado global de la verificación → píldora del Figma (190:10). */
const IDENTITY_PILL: Record<string, { label: string; tone: PillTone; note: string }> = {
  pending: {
    label: "En revisión",
    tone: "blue",
    note: "Tus documentos están siendo revisados. Te avisaremos cuando terminemos.",
  },
  approved: {
    label: "Verificada",
    tone: "green",
    note: "Tu identidad está verificada.",
  },
  rejected: {
    label: "Rechazada",
    tone: "red",
    note: "Algún documento fue rechazado. Vuelve a subirlo para continuar.",
  },
  not_submitted: {
    label: "Sin enviar",
    tone: "neutral",
    note: "Aún no has enviado documentos a revisión.",
  },
};

/**
 * US-203 (SCR-TU02) — Verificación de identidad del tutor, dentro del panel
 * (el Figma la cuelga del menú con "Cuenta" activo). Sube documentos a un
 * bucket privado → `identity_verification_status='pending'` (por trigger).
 */
export default async function VerificationPage() {
  const { user } = await requireUser();
  const supabase = await createClient();

  // Requiere haber hecho el onboarding de tutor (existe la fila tutor_profiles).
  // §6.3 · `approval_status` entra en la consulta por el botón de la cabecera:
  // decide si la ficha pública EXISTE (ver más abajo), no cómo se pinta nada.
  const { data: tp } = await supabase
    .from("tutor_profiles")
    .select("identity_verification_status, socials, avatar_path, bio, approval_status")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!tp) redirect("/tutor/onboarding");

  // N-10 · El checklist deriva su estado de TRES fuentes; dos se leen aquí y
  // la tercera (la foto) ya viene en `tp`. Sin el nº de mentorías esta pantalla
  // seguiría obligando a salir a "Mis mentorías" solo para saber si falta.
  const [{ data: docs }, { count: productCount }, { data: prof }] =
    await Promise.all([
      // §6.2 · `review_notes` es el MOTIVO que escribió el admin al rechazar
      // (`review_document`, US-1101). Se lee aquí porque hasta ahora no salía
      // en ninguna pantalla del tutor: el rechazo se veía, el porqué no, y
      // volver a subir el mismo documento cortado era el final previsible.
      supabase
        .from("verification_documents")
        .select("doc_type, status, link_url, review_notes")
        .eq("tutor_id", user.id),
      supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", user.id),
      // 28-ago · el bloque de la foto ya no informa, EDITA — y con él la
      // biografía: desde que las dos son opcionales en el asistente, esta
      // pantalla es el «luego» donde se completan. El nombre solo pinta las
      // iniciales del hueco sin foto.
      supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

  const docsByType: Record<string, DocState> = Object.fromEntries(
    (docs ?? []).map((d) => [
      d.doc_type,
      { status: d.status, linkUrl: d.link_url, reviewNotes: d.review_notes },
    ]),
  );

  // Con puros borradores la identidad es 'not_submitted' pero el tutor SÍ tiene
  // trabajo guardado: se lo decimos para que no parezca que empieza de cero.
  const hasDrafts = (docs ?? []).some((d) => d.status === "draft");
  const pill = IDENTITY_PILL[tp.identity_verification_status];
  const note =
    tp.identity_verification_status === "not_submitted" && hasDrafts
      ? "Tienes borradores guardados. Envíalos a revisión cuando estén listos."
      : pill?.note;

  // §6.3 · El botón de la cabecera lleva a la ficha pública… que solo EXISTE
  // con el perfil aprobado: `getTutorDetail` filtra por `approval_status =
  // 'approved'` y `/tutors/<id>` hace `notFound()` con cualquier otro. Y quien
  // más vive en esta pantalla es justamente el tutor sin aprobar, así que el
  // enlace se pinta sólo cuando lleva a algún sitio; sin aprobación queda el
  // mismo botón, inactivo, con el porqué escrito debajo A LA VISTA (el hueco de
  // la cabecera no cambia de sitio entre los dos estados).
  const aprobado = tp.approval_status === "approved";
  const verFicha = (
    <>
      Ver mi ficha pública <span aria-hidden>↗</span>
    </>
  );
  const porQueNoHayFicha =
    "Se publica cuando el equipo termine de revisar tu expediente.";

  return (
    <TutorShell
      userId={user.id}
      title="Verificación"
      description="Lo que ven los alumnos y lo que revisa el equipo antes de aprobarte."
      actions={
        aprobado ? (
          <Button
            asChild
            variant="outline"
            className="h-[45px] gap-1.5 rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
          >
            {/* La ↗ que pide §6.3 promete que se abre fuera, y hasta ahora no
                lo hacía: pulsarla sacaba al tutor del panel para ver su propia
                ficha, sin camino de vuelta. Se cumple la promesa — y quien no
                ve la flecha lo oye, porque el aviso va en el NOMBRE del enlace
                y no en un `title` (que un lector de pantalla puede no leer). */}
            <Link
              href={`/tutors/${user.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {verFicha}
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </Link>
          </Button>
        ) : (
          /*
           * ⚠️ Sin `disabled`. El `Button` del repo trae
           * `disabled:pointer-events-none`, y con los eventos apagados el
           * navegador NI SIQUIERA pinta el `title`: el porqué de que el botón
           * esté apagado no llegaba a nadie — ni al ratón, ni al teclado (que
           * tampoco puede enfocar un `disabled`), justo para el tutor sin
           * aprobar, que es quien más vive en esta pantalla.
           *
           * `aria-disabled` lo anuncia igual, lo deja enfocable, y sobre todo
           * la explicación pasa a ser TEXTO VISIBLE: una explicación no puede
           * vivir solo en un tooltip.
           */
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Button
              type="button"
              variant="outline"
              aria-disabled
              className="h-[45px] cursor-default gap-1.5 rounded-[8px] px-4 text-[13.5px] text-[#6b6b6b] hover:bg-background hover:text-[#6b6b6b]"
            >
              {verFicha}
            </Button>
            <p className="max-w-[260px] text-[12px] text-[#6b6b6b] sm:text-right">
              {porQueNoHayFicha}
            </p>
          </div>
        )
      }
    >
      {pill ? (
        <PanelCard className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {/* Encabezado de verdad, no un párrafo en negrita: desde que §6.1
                asciende «Tu expediente de tutor» a <h2>, este bloque era el
                único rótulo de la pantalla que no salía en el índice de
                encabezados… siendo lo primero que se lee y lo único que cambia
                según en qué punto de la revisión estés. El tamaño se queda como
                está (14/600): manda la captura, no el rango. */}
            <PanelCardTitle className="text-sm font-semibold">
              Estado de tu verificación
            </PanelCardTitle>
            <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">{note}</p>
          </div>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </PanelCard>
      ) : null}

      <VerificationForm
        userId={user.id}
        docsByType={docsByType}
        socials={parseSocials(tp.socials)}
        identityStatus={tp.identity_verification_status}
        hasAvatar={!!tp.avatar_path}
        hasBio={!!tp.bio?.trim()}
        productCount={productCount ?? 0}
        perfil={
          <TutorProfileBasics
            userId={user.id}
            avatarUrl={storageUrl("avatars", tp.avatar_path)}
            fullName={prof?.full_name ?? ""}
            bio={tp.bio ?? ""}
          />
        }
      />
    </TutorShell>
  );
}
