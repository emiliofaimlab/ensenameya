import Link from "next/link";

import { Container } from "@/components/layout/container";
import { Section } from "@/components/layout/section";
import { COMPANY } from "@/lib/company";
// `CANCELLATION_POLICY` ya no se importa aquí: lo usaba el §4 de los términos,
// que ahora es el contrato del cliente (`terms-content.ts`). Privacidad y
// cookies no citan porcentajes. La garantía de que el texto y el código no
// divergen se comprueba en `npm run check:terms`.

/**
 * DD-06 · Páginas legales (`/terms`, `/privacy`, `/cookies`).
 *
 * El contenido describe **lo que la plataforma hace hoy en producción**, no una
 * plantilla: cada plazo sale de una migración o de una constante. Los
 * porcentajes de reembolso se importan de `lib/policy.ts` para que no puedan
 * divergir de lo que aplica `cancel_booking`.
 *
 * ⚠️ Si cambia el comportamiento, cambia el texto. Puntos que ya han cambiado
 * una vez y son los primeros que se quedan viejos: grabación (términos §5),
 * retención del chat (§6), terceros y plazos (privacidad §3 y §5) y el
 * inventario de cookies.
 *
 * ⚠️ OJO — el cliente YA tiene términos y privacidad publicados en
 * `ensenameya.com` (GoDaddy, «Última actualización: Marzo 23, 2026»). Estos
 * textos son su versión ampliada y alineada con lo que la app hace de verdad,
 * y divergen del suyo en dos puntos a propósito:
 *   · el suyo nombra «Stripe o Mercado Pago» como procesador; aquí se dice
 *     «el proveedor de pagos», porque C-01/DP-01 sigue sin decidir.
 *   · el suyo deja los reembolsos vagos («puede variar según cada caso»); aquí
 *     se declara RN-37, que es lo que `cancel_booking` aplica.
 * Mientras los dos sitios estén publicados hay dos contratos distintos vivos.
 * Eso lo tiene que resolver negocio, no el código.
 *
 * ⚠️ Redactado desde el funcionamiento del sistema, **no por un abogado**: lo
 * que aquí se describe es exacto, pero un contrato de servicio suele necesitar
 * además jurisdicción, identidad fiscal del responsable y resolución de
 * disputas, que no son datos que el código pueda contestar.
 */

/**
 * El buzón oficial. Desde el 17-ago sale de `lib/company.ts`, junto al resto de
 * la identidad legal, para que el pie y los legales no puedan divergir.
 */
const CONTACTO = COMPANY.email;

/** Fecha de la última revisión de estos textos. */
const ACTUALIZADO = "6 de agosto de 2026";

type Seccion = { titulo: string; parrafos: string[] };
type Doc = { title: string; intro: string; secciones: Seccion[] };

/*
 * ⚠️ AQUÍ VIVÍA EL TEXTO DE LOS TÉRMINOS, y ya no.
 *
 * Desde el 17-ago los Términos y Condiciones son el contrato que redactó el
 * cliente (39 secciones, inglés y español), y viven en `terms-content.ts` con
 * su propia página. Este archivo se queda con PRIVACIDAD y COOKIES, que siguen
 * siendo texto nuestro escrito desde el funcionamiento real del sistema.
 *
 * El texto que había aquí describía la plataforma con precisión y hasta
 * importaba los porcentajes de `lib/policy.ts` para que no pudieran divergir,
 * pero le faltaba lo que un contrato necesita —identidad del prestador, ley
 * aplicable y jurisdicción— y lo que dLocal exige. Esa garantía de no
 * divergencia no se ha perdido: se comprueba ahora en `terms-content.check.ts`
 * (`npm run check:terms`).
 */

const PRIVACY: Doc = {
  title: "Política de privacidad",
  intro:
    "Qué datos tuyos tratamos, para qué, cuánto tiempo los conservamos y cómo ejercer tus derechos sobre ellos.",
  secciones: [
    {
      titulo: "1. Qué datos recogemos",
      parrafos: [
        "Al registrarte: tu correo electrónico y tu nombre. Al completar el perfil: zona horaria, teléfono, y opcionalmente una foto, tus intereses y tu objetivo de aprendizaje.",
        "Si te registras como tutor, además: el nombre público que decidas mostrar, tu titular profesional, tu biografía, tus enlaces profesionales y la documentación de verificación (documento de identidad, titulación, certificados, diplomas, expediente académico y currículum).",
        "Del uso de la plataforma: tus reservas, los pagos asociados, los mensajes del chat de cada reserva y las reseñas que escribas. Si eres tutor, también tus liquidaciones.",
        "Si tú y la otra parte aceptáis grabar una clase, la grabación de esa sesión —imagen y voz de ambos— pasa a ser un dato que tratamos. Sin las dos aceptaciones no existe grabación alguna.",
        "No almacenamos números de tarjeta. El pago se realiza en el entorno del proveedor de pagos; si eliges guardar un medio de pago para futuras compras, de él solo conservamos la marca (Visa, Mastercard…), los últimos cuatro dígitos y una referencia opaca del proveedor.",
      ],
    },
    {
      titulo: "2. Para qué los usamos",
      parrafos: [
        "Para prestarte el servicio: crear tu cuenta, mostrarte los horarios en tu hora local, gestionar reservas y pagos, abrir la sala de la clase, permitir el chat con la otra parte y liquidar a los tutores.",
        "Para verificar a los tutores antes de permitirles publicar, que es lo que sostiene la confianza del resto de usuarios.",
        "Para avisarte de lo que ocurre con tus reservas y pagos, y para atender incidencias.",
        "No usamos tus datos con fines publicitarios, ni los vendemos, ni los cedemos a terceros con fines comerciales.",
      ],
    },
    {
      titulo: "3. Quién más los trata",
      parrafos: [
        "Supabase, como proveedor de base de datos, autenticación y almacenamiento de archivos.",
        "Daily, como proveedor de la videollamada. Los permisos de entrada a la sala se firman en nuestro servidor, van acotados a una sesión y una persona, y no se almacenan. Si la clase se graba con el consentimiento de ambos, el archivo se aloja también en Daily.",
        "Vercel, como proveedor de alojamiento de la aplicación.",
        "El proveedor de pagos, que trata los datos necesarios para cobrar y para liquidar a los tutores.",
        "Sentry, para registrar errores técnicos de la aplicación y poder corregirlos. Está configurado expresamente para no enviar datos personales: recoge el fallo, no quién lo sufrió.",
        "Referral Factory, solo si participas en el programa de invitaciones. El programa entero (códigos, recompensas, seguimiento) vive en su plataforma; nosotros únicamente guardamos el código con el que llegaste para atribuir la invitación. Si no usas un enlace de invitación, no interviene.",
        "Ninguno de ellos usa tus datos para fines propios: los tratan por encargo nuestro y solo para prestar el servicio que les corresponde.",
      ],
    },
    {
      titulo: "4. Qué es público y qué no",
      parrafos: [
        "El perfil de un tutor aprobado es público: su nombre público, foto, titular, biografía, valoración y mentorías. Un tutor que no ha sido aprobado no aparece en ninguna parte del catálogo, y su documentación de verificación no es pública en ningún caso.",
        "El perfil de los alumnos es privado. Las reseñas del perfil de un tutor se publican sin identificar a su autor; en la página de inicio se muestra una selección de reseñas firmada con el nombre y la inicial del apellido.",
        "El chat de una reserva solo es accesible para sus dos participantes: ni siquiera el personal de administración puede leerlo. La grabación de una clase, cuando existe, sigue exactamente el mismo criterio.",
      ],
    },
    {
      titulo: "5. Cuánto tiempo los conservamos",
      parrafos: [
        "Los mensajes del chat y sus adjuntos se borran automáticamente a los 30 días de haberse enviado, mensaje y archivo. Puedes descargarte la conversación antes de que caduque.",
        "Las grabaciones de clase dejan de estar accesibles 30 días después de terminar la sesión. Con transparencia: hoy lo que hacemos al cumplirse el plazo es dejar de servir el acceso al archivo; su eliminación en los servidores del proveedor de videollamada todavía no está automatizada y está pendiente de implementarse.",
        "Los datos de tu cuenta, tus reservas y sus pagos se conservan mientras la cuenta esté activa, y después durante el plazo que exija la normativa fiscal y contable aplicable a las operaciones realizadas.",
      ],
    },
    {
      titulo: "6. Tus derechos",
      parrafos: [
        "Puedes consultar y corregir la mayoría de tus datos desde tu propia cuenta, en «Mi cuenta».",
        `Para acceder a lo que no puedas ver desde la aplicación, pedir la supresión de tus datos, oponerte a un tratamiento o solicitar una copia portable, escríbenos a ${CONTACTO}.`,
      ],
    },
    {
      titulo: "7. Seguridad",
      parrafos: [
        "El acceso a los datos está restringido en la propia base de datos por usuario y por rol: cada persona solo alcanza lo suyo, y el sistema deniega por defecto lo que no se ha permitido explícitamente. Los documentos de verificación y los adjuntos del chat se guardan en almacenamiento privado, accesible solo mediante enlaces firmados y temporales.",
        "Los movimientos de dinero se ejecutan exclusivamente en el servidor: ninguna aplicación cliente puede escribir sobre pagos ni sobre liquidaciones.",
      ],
    },
  ],
};

const COOKIES: Doc = {
  title: "Política de cookies",
  intro:
    "Qué cookies usamos y para qué. Todas son necesarias para que la plataforma funcione: no usamos cookies de publicidad ni de seguimiento de terceros.",
  secciones: [
    {
      titulo: "Cookies de sesión",
      parrafos: [
        "Cuando inicias sesión se guardan las cookies de autenticación de Supabase, que empiezan por «sb-». Sin ellas no es posible mantenerte identificado entre páginas. Se eliminan al cerrar sesión.",
      ],
    },
    {
      titulo: "Cookies de preferencia",
      parrafos: [
        "«ey-tz» guarda la zona horaria que detecta tu navegador, para mostrarte los horarios de las clases en tu hora local incluso antes de que inicies sesión. Dura un año.",
        "«ey-panel» recuerda desde qué panel llegaste (alumno, tutor o administración), para enseñarte el menú correcto en las pantallas que comparten los tres perfiles. Dura 30 días.",
        "«ey-ref» solo se escribe si llegas por el enlace de invitación de otra persona: guarda ese código para que la recomendación se le atribuya si acabas registrándote. Si no vienes de una invitación, no se crea.",
      ],
    },
    {
      titulo: "Cómo desactivarlas",
      parrafos: [
        "Puedes borrar o bloquear las cookies desde la configuración de tu navegador. Ten en cuenta que si bloqueas las de sesión no podrás iniciar sesión ni usar la parte privada de la plataforma.",
        `Si tienes dudas sobre este apartado, escríbenos a ${CONTACTO}.`,
      ],
    },
  ],
};

export const LEGAL_DOCS = { privacy: PRIVACY, cookies: COOKIES };
export type LegalSlug = keyof typeof LEGAL_DOCS;

export function LegalDocPage({ slug }: { slug: LegalSlug }) {
  const doc = LEGAL_DOCS[slug];

  return (
    <Section>
      <Container className="max-w-[800px]">
        <h1 className="text-[36px] leading-tight font-bold">{doc.title}</h1>
        <p className="mt-4 text-[17px] text-muted-foreground">{doc.intro}</p>

        {doc.secciones.map((s) => (
          <section key={s.titulo} className="mt-10">
            <h2 className="text-[20px] font-semibold">{s.titulo}</h2>
            {s.parrafos.map((p) => (
              <p
                key={p.slice(0, 40)}
                className="mt-3 text-[15px] leading-relaxed text-muted-foreground"
              >
                {p}
              </p>
            ))}
          </section>
        ))}

        <hr className="mt-12 border-border" />
        <p className="mt-4 text-[13px] text-muted-foreground">
          Última actualización: {ACTUALIZADO}. Consulta también{" "}
          <Link href="/terms" className="font-medium text-brand hover:underline">
            los términos
          </Link>
          ,{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            la privacidad
          </Link>{" "}
          y{" "}
          <Link href="/cookies" className="font-medium text-brand hover:underline">
            las cookies
          </Link>
          .
        </p>
      </Container>
    </Section>
  );
}
