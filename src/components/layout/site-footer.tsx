import Image from "next/image";
import Link from "next/link";

import { Container } from "@/components/layout/container";
import { COMPANY, COMPANY_SOCIALS } from "@/lib/company";

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
      {/* US-1601 · El aire vertical sale del `v3-footer` del Figma nuevo:
          pad 32/28 a 390 y 40/28 a 768. `lg:pb-10` devuelve el `py-10` de
          escritorio (EP-22, en producción desde el 22-jul) sin tocarlo — el
          `pt-10` de `md:` ya sigue vigente ahí, así que ≥1024 vuelve a ser
          40/40 exactos. Los 28 de abajo son los ~12 px que este pie se pasaba
          del alto que pide el diseño en tablet. */}
      <Container className="pt-8 pb-7 md:pt-10 lg:pb-10">
        {/* gap-6 = los 24 px que el Figma pone entre los bloques del pie
            móvil; `md:gap-8` restituye los 32 de tablet y escritorio. */}
        <div className="flex flex-col gap-6 md:flex-row md:justify-between md:gap-8">
          <div className="max-w-[592px]">
            {/* La marca. El Figma no dibuja este SVG: escribe a mano el
                imagotipo «yä» (20/30) en móvil y el logotipo «Enséñame ya»
                (700 18/27, azul) en tablet, porque Diana no tenía el asset.
                Se queda el SVG —es la marca de verdad y coincide con la
                versión móvil— pero baja a 40 px por debajo de `lg`: a 60 pesa
                el doble que el bloque de marca del diseño (30 a 390, 27 a
                768) y era la mitad del exceso de alto medido en tablet.
                `lg:h-[60px]` deja el escritorio como estaba. */}
            <Image
              src="/img/logo-ya.svg"
              alt="Enséñame Ya"
              width={56}
              height={60}
              className="h-10 w-auto lg:h-[60px]"
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
                contrato — ver `lib/company.ts`.

                ⚠️ **El domicilio ya no se pinta aquí** (MN-10). Estaba, junto a
                la razón social y el EIN, porque es DL-03; se quitó el 20-ago
                por **decisión expresa del cliente** (P-2): preguntado si la
                molestia era cómo se veía o publicar el domicilio, respondió que
                lo segundo, y que se retirara **solo del pie**. O sea que no es
                un descuido de maquetación: si vuelves a ponerlo «porque lo pide
                dLocal», estás deshaciendo la decisión.

                Y no lo hace privado: el domicilio **sigue publicado** en
                `/contacto` y en el §39 de los Términos, en inglés y en español.
                Por eso `COMPANY.address` y `COMPANY_ADDRESS_LINE` siguen en
                `lib/company.ts` — borrarlos allí rompería el contrato.

                ⚠️ **Y el EIN tampoco se pinta ya** (V-8, 24-ago). Misma
                historia y misma frontera: el cliente lo quiere fuera **de la
                web**, no del contrato. `COMPANY.taxIdLabel` y `COMPANY.taxId`
                se quedan en `lib/company.ts` porque el §39 de
                `terms-content.ts` los interpola en los dos idiomas; borrarlos
                allí rompe por tipos el contrato ya firmado. Sacarlo del §39
                está pendiente de Néstor, y sube `TERMS_VERSION`. */}
            <address className="mt-5 text-[12.5px] leading-relaxed not-italic text-muted-foreground">
              <span className="font-medium text-foreground">
                {COMPANY.legalName}
              </span>
            </address>
          </div>

          {/* US-1601: en tablet el bloque de texto se quedaba con sus 592 px y
              dejaba las tres columnas a ~18 px, así que "Privacidad" se salía
              de la pantalla y toda la página cogía scroll horizontal. Con
              `shrink-0` los enlaces conservan su ancho y lo que cede es el
              párrafo, que para eso es texto fluido.

              US-1601 (móvil) · La base pasa de 2 columnas a 1: el Figma apila
              PRODUCTO / EMPRESA / LEGAL en TODOS los frames de 390
              (`footer-cols · col gap20`), y con `grid-cols-2` la tercera
              quedaba huérfana debajo de las otras dos. `sm:` restituye las 3
              columnas y el gap-8 tal cual estaban de 640 en adelante, así que
              tablet y escritorio no se mueven. */}
          <div className="grid shrink-0 grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-8">
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

        {/* La divisoria naranja se queda: el Figma se contradice consigo mismo
            —#fe6a00 en «P01 Tablet» y «AL02 Tablet», #e0e0e0 en AU01/TU06/AD02—
            y el naranja es el que ya está en producción desde EP-22. Anotado
            como divergencia razonada.

            El Figma reparte 24 arriba y 24 abajo de la línea; el repo tenía
            32/16. Misma suma, pero así la línea cae donde la dibuja el diseño.
            `lg:` devuelve el 32/16 del escritorio. */}
        <hr className="mt-6 border-t border-primary lg:mt-8" />

        <div className="flex flex-col gap-2 pt-6 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:pt-4">
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
