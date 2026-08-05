import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";

/**
 * DD-06 · Páginas legales (`/terms`, `/privacy`, `/cookies`).
 *
 * El footer y la casilla de AU02 llevan a estas tres rutas desde el rediseño;
 * hasta ahora las tres daban 404, que es el peor sitio donde mandar a alguien a
 * quien le pides que acepte unos términos.
 *
 * El texto legal lo redacta el cliente (no se inventa: obliga a la plataforma).
 * Mientras llega, cada página dice **qué** documento es, **qué cubre** y a
 * dónde escribir — y no finge ser un contrato vigente.
 */
type LegalDoc = {
  title: string;
  intro: string;
  /** Lo que el documento va a cubrir, para que la página diga algo útil. */
  covers: string[];
};

export const LEGAL_DOCS = {
  terms: {
    title: "Términos y condiciones",
    intro:
      "Las reglas de uso de Enséñame Ya: qué puedes esperar de la plataforma y qué esperamos de ti como alumno o como tutor.",
    covers: [
      "Uso de la plataforma y requisitos de la cuenta",
      "Reservas, pagos y comisiones",
      "Política de cancelación y reembolsos",
      "Obligaciones del tutor y verificación de identidad",
      "Conducta en las sesiones en vivo",
    ],
  },
  privacy: {
    title: "Política de privacidad",
    intro:
      "Qué datos tuyos tratamos, para qué, cuánto tiempo los guardamos y cómo ejercer tus derechos sobre ellos.",
    covers: [
      "Datos que recogemos al registrarte y al usar la plataforma",
      "Documentos de verificación de los tutores",
      "Conservación de las conversaciones del chat",
      "Terceros que intervienen (pagos, videollamada, correo)",
      "Cómo acceder, corregir o borrar tus datos",
    ],
  },
  cookies: {
    title: "Política de cookies",
    intro:
      "Qué cookies usamos y para qué. Hoy son las imprescindibles para que la sesión y tus preferencias funcionen.",
    covers: [
      "Cookies de sesión e inicio de sesión",
      "Preferencias (zona horaria, panel activo)",
      "Atribución de referidos",
      "Cómo desactivarlas desde tu navegador",
    ],
  },
} satisfies Record<string, LegalDoc>;

export type LegalSlug = keyof typeof LEGAL_DOCS;

export function LegalDocPage({ slug }: { slug: LegalSlug }) {
  const doc = LEGAL_DOCS[slug];

  return (
    <Section>
      <Container className="max-w-[800px]">
        <h1 className="text-[36px] leading-tight font-bold">{doc.title}</h1>
        <p className="mt-4 text-[17px] text-muted-foreground">{doc.intro}</p>

        <div className="mt-8 rounded-2xl border border-brand/20 bg-brand/5 p-6">
          <p className="text-[15px] font-semibold">Documento en preparación</p>
          <p className="mt-2 text-[15px] text-muted-foreground">
            Estamos terminando la redacción legal de esta política. Mientras
            tanto, si tienes dudas sobre cómo funciona algo de lo que aparece
            aquí abajo, escríbenos y te respondemos.
          </p>
        </div>

        <h2 className="mt-10 text-[20px] font-semibold">Qué va a cubrir</h2>
        <ul className="mt-4 space-y-3">
          {doc.covers.map((item) => (
            <li key={item} className="flex gap-3 text-[15px]">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
              <span className="text-muted-foreground">{item}</span>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-[15px] text-muted-foreground">
          ¿Necesitas algo antes de que publiquemos el texto completo? Mira{" "}
          <Link href="/how-it-works" className="font-semibold text-brand hover:underline">
            cómo funciona la plataforma
          </Link>{" "}
          o{" "}
          <Link href="/about" className="font-semibold text-brand hover:underline">
            quiénes somos
          </Link>
          .
        </p>
      </Container>
    </Section>
  );
}
