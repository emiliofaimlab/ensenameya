import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import {
  TERMS,
  TERMS_GOVERNING_LOCALE,
  TERMS_VERSION,
  type Bloque,
  type TermsLocale,
} from "@/components/legal/terms-content";

/**
 * Renderiza los Términos y Condiciones en un idioma.
 *
 * Es un componente aparte de `LegalDocPage` (privacidad y cookies) porque el
 * contrato tiene una forma que aquel no cubre: listas con viñetas, una lista
 * numerada (§6), subtítulos en negrita (§13) y, sobre todo, dos idiomas con uno
 * de ellos gobernando sobre el otro.
 */

/** Ruta de cada idioma. El gobernante (inglés) se queda con `/terms` a secas. */
export function rutaTerminos(locale: TermsLocale): string {
  return locale === TERMS_GOVERNING_LOCALE ? "/terms" : `/terms/${locale}`;
}

function BloqueTexto({ bloque }: { bloque: Bloque }) {
  if (typeof bloque === "string") {
    return (
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        {bloque}
      </p>
    );
  }

  if (Array.isArray(bloque)) {
    return (
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted-foreground">
        {bloque.map((li) => (
          <li key={li.slice(0, 48)}>{li}</li>
        ))}
      </ul>
    );
  }

  if ("ol" in bloque) {
    return (
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-muted-foreground">
        {bloque.ol.map((li) => (
          <li key={li.slice(0, 48)}>{li}</li>
        ))}
      </ol>
    );
  }

  return (
    <p className="mt-4 text-[15px] leading-relaxed font-semibold text-foreground">
      {bloque.destacado}
    </p>
  );
}

export function TermsPage({ locale }: { locale: TermsLocale }) {
  const doc = TERMS[locale];
  const otro = locale === "en" ? "es" : "en";
  const docOtro = TERMS[otro];
  const esGobernante = locale === TERMS_GOVERNING_LOCALE;

  const t =
    locale === "en"
      ? {
          actualizado: "Last updated",
          version: "Version",
          verOtro: `Read this document in ${docOtro.idioma}`,
          otrasPaginas: "See also our",
          privacidad: "privacy policy",
          y: "and",
          cookies: "cookie policy",
        }
      : {
          actualizado: "Última actualización",
          version: "Versión",
          verOtro: `Leer este documento en ${docOtro.idioma}`,
          otrasPaginas: "Consulta también",
          privacidad: "la política de privacidad",
          y: "y",
          cookies: "la de cookies",
        };

  return (
    <Section>
      {/*
        `lang` explícito: el layout raíz declara `lang="es"` para toda la app, y
        sin esto un lector de pantalla leería el contrato inglés con fonética
        española. Es la única superficie del sitio en otro idioma.
      */}
      <Container className="max-w-[800px]" lang={locale}>
        <h1 className="text-[36px] leading-tight font-bold">{doc.title}</h1>

        <p className="mt-3 text-[14px] text-muted-foreground">
          {t.actualizado}: {doc.actualizado} · {t.version} {TERMS_VERSION}
        </p>

        {/*
          §38 · el aviso de idioma gobernante. Va arriba y visible en las dos
          versiones, no en una nota al pie: es la diferencia entre el texto que
          obliga y el que solo informa.
        */}
        <div
          className={`mt-6 rounded-xl border p-4 text-[14px] leading-relaxed ${
            esGobernante
              ? "border-border bg-muted text-muted-foreground"
              : "border-brand/30 bg-brand/5 text-foreground"
          }`}
        >
          <p>{doc.avisoIdioma}</p>
          <Link
            href={rutaTerminos(otro)}
            hrefLang={otro}
            className="mt-2 inline-block font-medium text-brand hover:underline"
          >
            {t.verOtro} →
          </Link>
        </div>

        {doc.intro.map((b, i) => (
          <BloqueTexto key={i} bloque={b} />
        ))}

        {doc.secciones.map((s) => (
          <section key={s.titulo} className="mt-10">
            <h2 className="text-[20px] font-semibold">{s.titulo}</h2>
            {s.bloques.map((b, i) => (
              <BloqueTexto key={i} bloque={b} />
            ))}
          </section>
        ))}

        <hr className="mt-12 border-border" />
        <p className="mt-4 text-[13px] text-muted-foreground">
          {t.otrasPaginas}{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            {t.privacidad}
          </Link>{" "}
          {t.y}{" "}
          <Link href="/cookies" className="font-medium text-brand hover:underline">
            {t.cookies}
          </Link>
          .
        </p>
      </Container>
    </Section>
  );
}
