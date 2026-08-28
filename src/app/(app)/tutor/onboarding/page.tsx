import Link from "next/link";
import {
  BadgeCheckIcon,
  GraduationCapIcon,
  ShieldCheckIcon,
  TagIcon,
} from "lucide-react";

import { storageUrl } from "@/lib/catalog/format";
import { getUserTimezone, requireUser } from "@/lib/auth/server";
import { buildUsedBy } from "@/lib/availability";
import { createClient } from "@/lib/supabase/server";
import { parseSocials } from "@/lib/socials";
import { resolveStep } from "@/components/onboarding/wizard-step";
import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TutorOnboardingForm } from "./tutor-onboarding-form";
import type { DocState } from "../verification/verification-form";

export const metadata = { title: "Enseñar en Enséñame Ya · Onboarding tutor" };

/**
 * US-202 (SCR-TU01) — Onboarding del tutor. Crea/edita el perfil de vitrina
 * (headline, bio, redes) → `approval_status='pending'` hasta que el admin lo
 * apruebe (US-1101). Foto (Storage) y categorías (al crear productos) → diferidas.
 */
const WELCOME_POINTS = [
  { icon: TagIcon, text: "Tú decides tus tarifas y tus horarios" },
  { icon: ShieldCheckIcon, text: "Cobros garantizados y respaldados" },
  { icon: BadgeCheckIcon, text: "Perfil y credenciales verificados" },
];

/**
 * Pasos del asistente de tutor; lo sabe la página para saturar `?paso=`.
 *
 * EY-183 · pasó de 5 a 6 al entrar la disponibilidad como paso 4, y el 28-ago
 * **volvió a 5**: el alta de la mentoría dejó de ser un paso propio y vive
 * dentro del repaso, que pasó a ser el último (decisión del cliente).
 *
 * `resolveStep` satura al rango [1, total], así que un enlace guardado con la
 * numeración vieja sigue abriendo un paso válido — como mucho uno antes del que
 * decía, nunca una pantalla en blanco.
 */
const TOTAL_STEPS = 5;

export default async function TutorOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; paso?: string }>;
}) {
  const { user } = await requireUser();
  const { start, paso } = await searchParams;

  const supabase = await createClient();
  const [
    { data: tp },
    { data: prof },
    { data: cats },
    { data: activeCats },
    { data: myCats },
    { data: docs },
    { data: products },
    { data: rules },
    { data: ruleLinks },
  ] = await Promise.all([
    supabase
      .from("tutor_profiles")
      .select(
        "headline, bio, socials, approval_status, identity_verification_status, teaching_level, avatar_path",
      )
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("full_name, timezone, phone")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("categories").select("id, name").order("sort_order"),
    // N-03 · Las categorías que puede llevar una MENTORÍA son solo las activas
    // (mismo filtro que `/tutor/products/new`). Las de arriba, sin filtrar, son
    // las que el tutor declara enseñar: filtrar ahí escondería las que ya tiene
    // elegidas de antes.
    supabase
      .from("categories")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("tutor_categories").select("category_id").eq("tutor_id", user.id),
    supabase
      .from("verification_documents")
      .select("doc_type, status, link_url")
      .eq("tutor_id", user.id),
    // EX-02: sin mentoría no se aprueba el perfil, pero el asistente sí se
    // cierra. El número alimenta el último paso y el checklist de verificación.
    // ⚠️ Ya no es un `head: true` con `count`: los TÍTULOS hacen falta para el
    // mapa de N-04 de aquí abajo, y pedirlos aquí evita una consulta más.
    supabase.from("products").select("id, title").eq("tutor_id", user.id),
    // EY-183 · las franjas del paso 4. Mismo orden que el panel para que las
    // dos pantallas pinten los mismos chips en el mismo sitio.
    supabase
      .from("availability_rules")
      .select("id, weekday, start_time, end_time, is_active")
      .eq("tutor_id", user.id)
      .order("weekday")
      .order("start_time"),
    // N-04 · qué mentorías cuelgan de cada franja → el gestor avisa antes de
    // borrar una que sostiene una oferta. No es teórico dentro del asistente:
    // al asistente se vuelve a entrar mientras el perfil no esté aprobado, y
    // para entonces el tutor puede haber atado franjas a mentorías desde el
    // panel. Sin `.eq()`: la RLS de `product_availability_rules` ya lo acota.
    supabase.from("product_availability_rules").select("rule_id, product_id"),
  ]);

  // Paso resuelto en servidor: el primer HTML ya sale con el bueno y no parpadea
  // otro número al hidratar. Solo mira `?paso=` —la navegación interna del
  // asistente—; entrar aquí sin parámetro da el paso 1 SIEMPRE (28-ago-2026,
  // ver `wizard-step.ts`).
  const initialStep = resolveStep({ param: paso, total: TOTAL_STEPS });

  // Estado de los documentos KYC → el paso de verificación reusa el módulo TU02.
  const docsByType: Record<string, DocState> = Object.fromEntries(
    (docs ?? []).map((d) => [d.doc_type, { status: d.status, linkUrl: d.link_url }]),
  );

  // La foto del asistente es la PÚBLICA del tutor (tutor_profiles), no la
  // personal de `profiles`: son independientes (R24-23).
  const avatarUrl = storageUrl("avatars", tp?.avatar_path);

  if (tp?.approval_status === "approved") {
    return (
      <Container>
        <Section className="mx-auto flex w-full max-w-lg flex-col">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Ya eres tutor</CardTitle>
              <CardDescription>Tu perfil está publicado.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/tutor/products">Mis productos</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/tutors/${user.id}`}>Ver mi perfil público</Link>
              </Button>
            </CardContent>
          </Card>
        </Section>
      </Container>
    );
  }

  // Pantalla cero (24-jul): la primera vez —sin perfil aún y sin venir de pulsar
  // "Comenzar"— una bienvenida que invita a crear la cuenta de tutor, antes del
  // asistente. `?start=1` entra ya al formulario.
  if (!tp && !start) {
    return (
      <div className="flex-1 bg-muted pt-14 pb-10 sm:pt-[105px] sm:pb-[120px]">
        <Container>
          <div className="mx-auto flex max-w-xl flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-full bg-brand/10 text-brand">
              <GraduationCapIcon className="size-7" />
            </span>
            <h1 className="mt-5 text-2xl font-bold text-[#19191f] sm:text-3xl">
              Conviértete en tutor <span className="text-primary">YA</span>
            </h1>
            <p className="mt-3 text-pretty text-[15px] text-[#5c5c5c]">
              Todavía no tienes una cuenta de tutor. Crea tu perfil, define tus
              tarifas y empieza a enseñar en vivo a alumnos de toda Latinoamérica.
            </p>
            <ul className="mt-7 flex w-full flex-col gap-3 text-left">
              {WELCOME_POINTS.map(({ icon: Icon, text }) => (
                <li
                  key={text}
                  className="flex items-center gap-3 rounded-[12px] border border-[#e6e6e6] bg-card px-4 py-3"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#ffeddb] text-[#db5400]">
                    <Icon className="size-4.5" />
                  </span>
                  <span className="text-sm font-medium text-[#333333]">{text}</span>
                </li>
              ))}
            </ul>
            <Button
              asChild
              className="mt-8 h-[45px] w-full max-w-xs bg-brand text-white hover:bg-brand/90"
            >
              <Link href="/tutor/onboarding?start=1">Comenzar registro</Link>
            </Button>
            <Link
              href="/app"
              className="mt-3 text-[13px] text-[#6b6b6b] transition-colors hover:text-foreground"
            >
              Ahora no
            </Link>
          </div>
        </Container>
      </div>
    );
  }

  return (
    // TU01: cuerpo sobre #f9fafc con ~105 px de aire arriba (185:13 y=178).
    <div className="flex-1 bg-muted pt-14 pb-10 sm:pt-[105px] sm:pb-[120px]">
      <Container>
        <div>
          <TutorOnboardingForm
            userId={user.id}
            exists={!!tp}
            initialStep={initialStep}
            totalSteps={TOTAL_STEPS}
            headline={tp?.headline ?? ""}
            bio={tp?.bio ?? ""}
            fullName={prof?.full_name ?? ""}
            avatarPath={tp?.avatar_path ?? null}
            avatarUrl={avatarUrl}
            timezone={await getUserTimezone()}
            phone={prof?.phone ?? ""}
            level={tp?.teaching_level ?? null}
            categories={(cats ?? []).map((c) => ({ id: c.id, label: c.name }))}
            productCategories={activeCats ?? []}
            selectedCategories={(myCats ?? []).map((r) => r.category_id)}
            docsByType={docsByType}
            identityStatus={tp?.identity_verification_status ?? "not_submitted"}
            socials={parseSocials(tp?.socials)}
            productCount={(products ?? []).length}
            rules={rules ?? []}
            rulesUsedBy={buildUsedBy(products ?? [], ruleLinks ?? [])}
          />
        </div>
      </Container>
    </div>
  );
}
