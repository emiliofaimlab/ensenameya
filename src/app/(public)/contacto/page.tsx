import { BuildingIcon, MailIcon, ScaleIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { ContactForm } from "@/components/contact/contact-form";
import { COMPANY, COMPANY_ADDRESS_LINE } from "@/lib/company";

export const metadata = {
  title: "Contacto · Enséñame Ya",
  description:
    "Escríbenos si tienes dudas sobre una reserva, un pago o quieres enseñar con nosotros. Respondemos en menos de 24 horas laborables.",
};

/**
 * DL-01, DL-02 y DL-03 · la página que dLocal Go exige para validar el sitio.
 *
 * Tiene que cumplir tres cosas a la vez, y las tres se comprueban a mano:
 *   · un formulario con nombre, correo y mensaje que **envíe de verdad**;
 *   · datos de contacto reales y accesibles;
 *   · la identidad legal del prestador, con los mismos datos que se dieron de
 *     alta en dLocal Go (§39 del contrato → `lib/company.ts`).
 *
 * Por eso la identidad va en la propia página y no solo en el pie: el
 * requisito dice literalmente «en la página de contacto».
 */
export default function ContactoPage() {
  return (
    <div className="bg-muted py-14 sm:py-20">
      <Container>
        <div className="mx-auto max-w-[720px] text-center">
          <h1 className="text-[30px] font-semibold sm:text-[40px]">
            Hablemos
          </h1>
          <p className="mt-3 text-[16px] text-muted-foreground">
            ¿Dudas con una reserva, un pago o un reembolso? ¿Quieres enseñar con
            nosotros? Escríbenos y te contestamos en menos de 24 horas en días
            laborables.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-[1040px] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ContactForm />

          <aside className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-background p-6">
              <MailIcon className="size-5 text-brand" aria-hidden />
              <h2 className="mt-3 text-[16px] font-semibold">
                Escríbenos directamente
              </h2>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Si prefieres tu propio correo, esta es nuestra dirección
                oficial.
              </p>
              <a
                href={`mailto:${COMPANY.email}`}
                className="mt-3 inline-block text-[15px] font-medium transition-colors hover:text-brand"
              >
                {COMPANY.email}
              </a>
            </div>

            {/* DL-03 · identidad legal. Los mismos datos que constan en dLocal
                Go: los comparan uno contra otro, así que no se tocan aquí sin
                tocarlos allí. */}
            <div className="rounded-2xl border border-border bg-background p-6">
              <BuildingIcon className="size-5 text-brand" aria-hidden />
              <h2 className="mt-3 text-[16px] font-semibold">
                Quién opera la plataforma
              </h2>
              <address className="mt-2 text-[14px] leading-relaxed not-italic text-muted-foreground">
                <span className="font-medium text-foreground">
                  {COMPANY.legalName}
                </span>
                <br />
                {COMPANY.taxIdLabel} {COMPANY.taxId}
                <br />
                {COMPANY_ADDRESS_LINE}
              </address>
            </div>

            <div className="rounded-2xl border border-border bg-background p-6">
              <ScaleIcon className="size-5 text-brand" aria-hidden />
              <h2 className="mt-3 text-[16px] font-semibold">
                Reclamaciones y disputas
              </h2>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Si una sesión no se impartió o no fue como se describía,
                escríbenos por aquí y lo revisamos. Las condiciones están en los{" "}
                <a href="/terms" className="underline hover:text-brand">
                  términos y condiciones
                </a>
                , sujetos a la ley del {COMPANY.jurisdiction}.
              </p>
            </div>
          </aside>
        </div>
      </Container>
    </div>
  );
}
