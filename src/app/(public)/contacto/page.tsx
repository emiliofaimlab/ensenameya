import { MailIcon, ScaleIcon } from "lucide-react";

import { Container } from "@/components/layout/container";
import { ContactForm } from "@/components/contact/contact-form";
import { COMPANY } from "@/lib/company";

export const metadata = {
  title: "Contacto · Enséñame Ya",
  description:
    "Escríbenos si tienes dudas sobre una reserva, un pago o quieres enseñar con nosotros. Respondemos en menos de 24 horas laborables.",
};

/**
 * DL-01 y DL-02 · la página que dLocal Go exige para validar el sitio.
 *
 * Tiene que cumplir dos cosas, y las dos se comprueban a mano:
 *   · un formulario con nombre, correo y mensaje que **envíe de verdad**;
 *   · datos de contacto reales y accesibles.
 *
 * ⚠️ **DL-03 (identidad legal) YA NO SE PINTA AQUÍ.** El 24-ago salió el EIN
 * (V-8) y el 28-ago el cliente pidió el cuadro entero: «super importante, en la
 * página de contacto sigue saliendo el EIN y dirección de la empresa en el
 * cuadro de quién opera, eliminamos ese cuadro por completo».
 *
 * Lo que hay que saber antes de darlo por cerrado:
 *   · La razón social y el domicilio siguen publicados en el **§39 de los
 *     Términos**, en inglés y en español, que es donde los pone el contrato
 *     firmado. `COMPANY` y `COMPANY_ADDRESS_LINE` NO se tocan por eso —
 *     `terms-content.ts` los interpola y borrarlos rompería el contrato.
 *   · El requisito de dLocal decía literalmente «en la página de contacto», así
 *     que esto **es una divergencia consciente** con lo que se les presentó. Si
 *     su revisión vuelve a pedirlo, el cuadro se recupera de este commit; la
 *     decisión es del cliente y está anotada aquí para que nadie la deshaga
 *     "arreglando" DL-03 sin preguntar.
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

            {/* Aquí iba el cuadro "Quién opera la plataforma" (DL-03: razón
                social + domicilio). Fuera por petición del cliente el 28-ago —
                el porqué y lo que hay que saber antes de devolverlo, en la
                cabecera del fichero. */}

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
