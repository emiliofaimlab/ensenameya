import Image from "next/image";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import {
  COMPANY,
  COMPANY_ADDRESS_LINE,
  COMPANY_SOCIALS,
} from "@/lib/company";

/**
 * Columnas de v3-footer.
 *
 * ⚠️ Los tres enlaces de LEGAL existen en `dev` pero **todavía no en `main`**:
 * hasta que se mergee, el pie de producción los enlaza y devuelven 404. Es lo
 * primero que ve un revisor de dLocal.
 */
const columns = [
  {
    title: "PRODUCTO",
    links: [
      { href: "/tutors", label: "Explorar tutores" },
      { href: "/classes", label: "Explorar mentorías" },
      { href: "/categories", label: "Categorías" },
    ],
  },
  {
    title: "EMPRESA",
    links: [
      { href: "/about", label: "Sobre nosotros" },
      { href: "/how-it-works", label: "¿Cómo funciona?" },
      { href: "/contacto", label: "Contacto" },
    ],
  },
  {
    title: "LEGAL",
    links: [
      { href: "/terms", label: "Términos" },
      { href: "/privacy", label: "Privacidad" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
];

/**
 * RV-18 · El año se calcula UNA vez al cargar el módulo, no en cada render.
 *
 * Parece un componente de servidor —lo es en el layout público— pero en `(app)`
 * lo monta `app-chrome.tsx`, que es `"use client"`, y un módulo importado desde
 * un módulo de cliente entra al bundle de cliente. O sea que ese `new Date()`
 * corría en el SSR y otra vez al hidratar: desajuste garantizado en el cambio
 * de año, y el patrón exacto que produce el React #418 que se ve en `/app`.
 *
 * A nivel de módulo se congela por proceso, que para un año es de sobra.
 */
const AÑO = new Date().getFullYear();

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-muted">
      <Container className="py-10">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-[592px]">
            <Image
              src="/img/logo-ya.svg"
              alt="Enséñame Ya"
              width={56}
              height={60}
              className="h-[60px] w-auto"
            />
            <p className="mt-2 text-[13px] text-muted-foreground">
              Conectamos el conocimiento y la pasión con mentorías en vivo 1 - 1
              con expertos verificados. El espacio donde lo que YA sabes vale
              oro, y lo que quieres aprender se logra YA.
            </p>

            {/* DL-02 y DL-03 · dLocal Go revisa el sitio a mano y busca dos
                cosas en el pie: quién es el prestador y cómo se le escribe.
                Hasta hoy el único dato de contacto del sitio entero vivía
                dentro de los términos, en el §11, como texto sin enlazar: para
                verlo había que entrar y bajar. Los datos salen del §39 del
                contrato — ver `lib/company.ts`. */}
            <address className="mt-5 text-[12.5px] leading-relaxed not-italic text-muted-foreground">
              <span className="font-medium text-foreground">
                {COMPANY.legalName}
              </span>
              {" · "}
              {COMPANY.taxIdLabel} {COMPANY.taxId}
              <br />
              {COMPANY_ADDRESS_LINE}
            </address>
          </div>

          {/* US-1601: en tablet el bloque de texto se quedaba con sus 592 px y
              dejaba las tres columnas a ~18 px, así que "Privacidad" se salía
              de la pantalla y toda la página cogía scroll horizontal. Con
              `shrink-0` los enlaces conservan su ancho y lo que cede es el
              párrafo, que para eso es texto fluido. */}
          <div className="grid shrink-0 grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((column) => (
              <nav key={column.title} aria-label={column.title}>
                <p className="text-[11px] font-semibold tracking-wide text-brand">
                  {column.title}
                </p>
                <ul className="mt-3 space-y-2">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-[13px] transition-colors hover:text-brand"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <hr className="mt-8 border-t border-primary" />

        <div className="flex flex-col gap-2 pt-4 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {AÑO} {COMPANY.brand}</p>

          <div className="flex flex-wrap items-center gap-4">
            {/* `mailto:` y no texto plano: en móvil un correo que no se puede
                pulsar es medio canal, y dLocal comprueba que el contacto sea
                accesible de verdad. */}
            <a
              href={`mailto:${COMPANY.email}`}
              className="font-medium text-foreground transition-colors hover:text-brand"
            >
              {COMPANY.email}
            </a>

            {/* Hoy `COMPANY_SOCIALS` está vacío a propósito: los tres enlaces
                que había se dedujeron del nombre de la marca y no llevaban a
                ningún perfil. Ver la nota en `lib/company.ts`. En cuanto el
                cliente mande las URL reales, esto se pinta solo. */}
            {COMPANY_SOCIALS.length > 0 && (
              <nav className="flex gap-4" aria-label="Redes sociales">
                {COMPANY_SOCIALS.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-brand"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            )}
          </div>
        </div>
      </Container>
    </footer>
  );
}
