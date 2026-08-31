import { NextResponse, after } from "next/server";
import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { emailError, passwordError } from "@/components/form/validation";
import {
  TERMS_GOVERNING_LOCALE,
  TERMS_VERSION,
} from "@/components/legal/terms-content";
import { COMPANY } from "@/lib/company";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { REFERRAL_COOKIE } from "@/lib/referral";
import { TZ_COOKIE } from "@/lib/tz";

/**
 * CHECKOUT DE INVITADO — la cuenta se crea DENTRO del pago.
 *
 * El comprador anónimo no ve `/signup` ni el onboarding: teclea correo,
 * contraseña y la casilla de términos en la propia pantalla de pago y la cuenta
 * nace con el mismo clic. Este endpoint es la mitad servidor de ese gesto; la
 * sesión la abre el NAVEGADOR después, con `signInWithPassword`.
 *
 * ── POR QUÉ HAY QUE CREAR LA CUENTA ANTES DE COBRAR ─────────────────────────
 * No es una preferencia de producto, es lo que exige el esquema:
 *   · `create_booking` y `create_order` resuelven al alumno con `auth.uid()` y
 *     lanzan «auth requerido» si es null;
 *   · `bookings.student_id` / `orders.student_id` son NOT NULL contra
 *     `profiles` → `auth.users`;
 *   · las dos RPC solo tienen `grant execute` a `authenticated`;
 *   · toda la RLS de reservas, sesiones, pagos y pedidos es
 *     `auth.uid() = student_id`.
 * O sea que «cobrar primero y registrar después» no existe. Lo que se esconde
 * es el REGISTRO, no la cuenta.
 *
 * ── POR QUÉ `admin.createUser` Y NO `signUp` ────────────────────────────────
 * En producción la confirmación por correo está ENCENDIDA
 * (`mailer_autoconfirm: false`), así que un `signUp` normal NO devuelve sesión:
 * el comprador tendría que ir a su bandeja en mitad del pago. `createUser` con
 * `email_confirm: true` crea la cuenta ya confirmada, y así el atajo queda
 * acotado a esta pantalla: para el resto del sitio la confirmación sigue
 * encendida y `/signup` no cambia.
 *
 * ⚠️ **ESA CONFIRMACIÓN NO PRUEBA NADA, Y AGUAS ABAJO NO DEBE VALER COMO
 * PRUEBA.** Aquí se está estampando «correo verificado» sobre una dirección que
 * nadie ha demostrado poseer: basta con teclearla. Una cuenta nacida en este
 * endpoint es «correo NO probado» aunque `auth.users.email_confirmed_at` diga
 * lo contrario, y eso tiene dos consecuencias que hay que tener presentes:
 *   · un correo mal tecleado crea una cuenta real e irrecuperable (el `reset
 *     password` va al buzón equivocado);
 *   · alguien puede crear una cuenta a nombre de un tercero.
 * Por eso lo de abajo NO es opcional: al terminar se **avisa a la dirección**
 * (`avisarAlCorreo`), que es lo único que le da al dueño real una forma de
 * enterarse. Está anotado en `docs/QA-LANZAMIENTO.md` §2.
 *
 * ⚠️ Y por eso mismo esto es un GRIFO DE CUENTAS SIN AUTENTICAR: la Admin API
 * no pasa por los límites propios de GoTrue, que son los que hoy protegen a
 * `signUp`. Lo que lo frena son las tres puertas del principio del handler
 * —mismo origen, forma del cuerpo y límite por IP contra `signup_attempts`—, y
 * cada una tiene su techo escrito al lado.
 *
 * ── EL METADATA ES UN CONTRATO CON `handle_new_user` ────────────────────────
 * `20260817130000_terms_acceptances.sql` lee de `raw_user_meta_data`:
 * `full_name`, `timezone`, `referral_code`, `terms_version` y `terms_locale`.
 * `createUser({ user_metadata })` puebla ese mismo campo, así que el trigger
 * escribe el perfil, el rol 'alumno' y la CONSTANCIA DE TÉRMINOS igual que con
 * el alta de siempre. La constancia la exige dLocal y **no se puede escribir
 * después**: `terms_acceptances` no tiene política de insert para el usuario.
 * Si estas dos claves no viajan, no falla nada — simplemente la fila no existe.
 *
 * Patrón: `api/contacto/route.ts`, el otro endpoint público que mueve
 * `service_role`. Se copia lo que importa: validar duro en servidor, limitar, y
 * no devolver al navegador nada que venga del admin.
 */
export const runtime = "nodejs";

/**
 * LÍMITE POR IP — ahora contra la base, que es el único estado que comparten
 * todas las instancias.
 *
 * ⚠️ Esto ANTES se contaba en un `Map` de módulo y no limitaba nada: en Vercel
 * cada instancia arranca con el mapa vacío, la plataforma escala por
 * concurrencia y recicla instancias solas, así que 50 peticiones en paralelo
 * pasaban «5 por instancia» y bastaba esperar a un arranque en frío para volver
 * a cero. La tabla es `signup_attempts` (`20260831140000`), copiando lo que ya
 * hace `api/contacto/route.ts` con `contact_messages`.
 *
 * TECHO QUE SIGUE AHÍ, dicho en voz alta: se limita por ORIGEN, no por persona.
 * Un bot con proxies —o una página de terceros que dispare desde el navegador
 * de sus visitantes, que es lo que cierra la comprobación de origen de abajo—
 * reparte y pasa; y una salida NAT compartida (un colegio, una operadora móvil)
 * comparte cupo, así que el sexto comprador legítimo de esa red en diez minutos
 * se come un 429 en mitad de un pago. Lo único que cierra esto de verdad es un
 * captcha, y no está decidido. Mientras tanto: esta ruta NO se da por protegida
 * en la lista de lanzamiento, y así está escrito en `docs/QA-LANZAMIENTO.md`.
 */
const MAX_POR_IP = 5;
const VENTANA_MIN = 10;

/** La tabla de intentos. Tipada desde `20260831140000` + `npm run db:types`. */
function intentos(admin: ReturnType<typeof createAdminClient>) {
  return admin.from("signup_attempts");
}

/**
 * ¿Esta IP ya gastó su cupo? Anota el intento si no, y de paso borra lo anterior
 * a la ventana —esa poda es lo que impide que la tabla crezca sin tope—.
 *
 * Se cuentan INTENTOS y no altas conseguidas: lo que hay que frenar es el
 * volumen de peticiones. Pero solo llegan aquí las que ya pasaron la validación,
 * así que un correo mal escrito no le gasta el cupo a nadie.
 *
 * ⚠️ Si la consulta falla, NO se sigue adelante: sin contador no hay límite, y
 * es lo contrario de lo que hace `api/contacto` a propósito —allí el peor caso
 * de fallar abierto es un mensaje de más, aquí es una cuenta—. Pero se devuelve
 * `"error"` y no `"limite"`, porque no es lo mismo: si la migración
 * `20260831140000` no está aplicada en este ambiente, la tabla no existe y el
 * endpoint entero deja de crear cuentas. Decirle a quien va a pagar «espera unos
 * minutos» cuando lo que pasa es que falta una migración manda a mirar donde no
 * es (ver `docs/QA-LANZAMIENTO.md` §2).
 */
type Cupo = "ok" | "limite" | "error";

async function estadoDelCupo(
  admin: ReturnType<typeof createAdminClient>,
  ip: string,
): Promise<Cupo> {
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();

  const { count, error } = await intentos(admin)
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", desde);

  if (error) {
    console.error("[checkout/invitado] no se pudo contar intentos:", error.message);
    return "error";
  }
  if ((count ?? 0) >= MAX_POR_IP) return "limite";

  const { error: errorInsert } = await intentos(admin).insert({ ip });
  if (errorInsert) {
    console.error("[checkout/invitado] no se pudo anotar el intento:", errorInsert.message);
    return "error";
  }

  await intentos(admin).delete().lt("created_at", desde);
  return "ok";
}

/**
 * QUIÉN PIDE ESTO, y desde dónde.
 *
 * Los Route Handlers de Next NO llevan protección CSRF —eso solo lo tienen las
 * Server Actions—, así que sin esta comprobación cualquier página de terceros
 * podía disparar altas desde el navegador y la IP de sus visitantes: con
 * `Content-Type: text/plain` (de la lista segura de CORS) no hay ni preflight,
 * la respuesta es opaca y al atacante le da igual. Eso convertía el límite por
 * IP en «5 altas por visitante ajeno» en vez de en un tope.
 *
 * Se compara el HOST del `Origin` con el `Host` de la petición y no con
 * `new URL(req.url).origin`: detrás del borde de Vercel esa URL puede no ser el
 * dominio que el navegador tiene en la barra (dominio propio, alias de preview),
 * y un 403 falso aquí sería un checkout roto.
 *
 * Un cliente que no manda `Origin` ni `Sec-Fetch-Site` —curl, un script— pasa
 * esta puerta: no hay nada que comprobar. A ese lo frena el límite por IP.
 */
function vieneDeOtroSitio(req: Request): boolean {
  const origen = req.headers.get("origin");
  if (origen) {
    let mismoHost = false;
    try {
      mismoHost = new URL(origen).host === req.headers.get("host");
    } catch {
      mismoHost = false;
    }
    if (!mismoHost) return true;
  }
  const desde = req.headers.get("sec-fetch-site");
  return Boolean(desde) && desde !== "same-origin";
}

/**
 * La IP que identifica el intento.
 *
 * ⚠️ NO se coge el primer elemento de `x-forwarded-for`: ese es el extremo que
 * escribe el CLIENTE cuando la cadena de proxies apende en vez de sobrescribir,
 * y con él `curl -H 'x-forwarded-for: 1.2.3.<n>'` estrenaba cubo en cada
 * petición, o sea que no había límite en absoluto. Se prefieren las cabeceras
 * que pone la infraestructura (`x-vercel-forwarded-for`, `x-real-ip`) y, si no
 * hay ninguna, el ÚLTIMO salto de la lista.
 *
 * Y lo que no parezca una dirección —o no venga en absoluto, como en local—
 * cae en un cubo COMÚN en vez de apagar el límite: sin esto, un
 * `x-forwarded-for:` vacío dejaba `ip = null` y la comprobación devolvía «no
 * supera» sin anotar nada. Ese cubo común se comparte, así que en local el
 * quinto intento en diez minutos responde 429: es el precio de no fallar
 * abierto justo aquí.
 */
const IP_PLAUSIBLE = /^[0-9a-fA-F.:]{3,45}$/;

function ipDeLaPeticion(req: Request): string {
  const candidatas = [
    req.headers.get("x-vercel-forwarded-for"),
    req.headers.get("x-real-ip"),
    req.headers.get("x-forwarded-for")?.split(",").pop(),
  ];
  for (const cruda of candidatas) {
    const valor = cruda?.trim();
    if (valor && IP_PLAUSIBLE.test(valor)) return valor;
  }
  return "sin-ip";
}

/** Cookie del navegador, tolerante a que venga manipulada a mano. */
function leerCookie(
  jar: Awaited<ReturnType<typeof cookies>>,
  nombre: string,
): string | null {
  const bruto = jar.get(nombre)?.value;
  if (!bruto) return null;
  try {
    return decodeURIComponent(bruto).trim() || null;
  } catch {
    return null;
  }
}

/**
 * ⚠️ La zona horaria se VALIDA antes de viajar al metadata, y no es cortesía.
 * `handle_new_user` la copia tal cual a `profiles.timezone`, que es `text` sin
 * check, y desde ese momento `getUserTimezone()` PREFIERE el perfil sobre la
 * cookie: un `document.cookie = "ey-tz=Marte/Olympus"` antes de comprar dejaba
 * el perfil envenenado para siempre —borrar la cookie ya no lo arreglaba— y
 * `toLocaleString(..., { timeZone })` lanza `RangeError` en toda pantalla de
 * servidor con horas. Con `null` el trigger cae a su default y no se rompe nada.
 */
function zonaValida(tz: string | null): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/**
 * ¿El correo ya tiene cuenta? GoTrue lo dice con el código `email_exists`; el
 * texto se mira también porque el código es reciente y no queremos depender de
 * la versión exacta del servidor de Auth.
 */
function correoYaRegistrado(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  if (error.code === "email_exists") return true;
  return /registered|already/i.test(error.message ?? "");
}

/**
 * AVISO AL DUEÑO DE LA DIRECCIÓN — la única forma de que se entere.
 *
 * Con `email_confirm: true` no sale ningún correo de confirmación (es el sentido
 * de la clave), y ningún trigger encola nada al crear una cuenta: el alta era
 * MUDA. O sea que alguien podía crear una cuenta con el correo de otra persona,
 * quedarse con la contraseña, y esa persona no recibía ni una pista — solo
 * descubría que «ya tiene cuenta» el día que intentara registrarse.
 *
 * No va por la cola de `notifications` sino directo por `sendEmail`: la cola la
 * vacía un cron que en producción pasa cada 2-6 horas (CLAUDE.md), y un aviso de
 * seguridad que llega mañana no avisa. Y va dentro de `after()` para que el
 * comprador no espere a Resend en mitad de su pago; si no hay clave, no se
 * manda nada, como en todo el proyecto (la credencial es el interruptor).
 *
 * La dirección NO se interpola en el cuerpo: quien lo recibe ya la conoce, y así
 * no hay texto de nadie dentro del HTML que haya que escapar.
 */
async function avisarAlCorreo(email: string): Promise<void> {
  if (!isEmailConfigured()) return;

  const lineas = [
    "Hola,",
    "",
    "Acabamos de crear una cuenta en Enséñame Ya con esta dirección de correo, desde el formulario de pago.",
    "",
    "Si fuiste tú, no tienes que hacer nada.",
    "",
    `Si NO fuiste tú, escríbenos a ${COMPANY.email}: esa cuenta puede entrar con la contraseña que se eligió al crearla, así que conviene que la desactivemos.`,
    "",
    "— Enséñame Ya",
  ];

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#242424;max-width:520px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px">Hola,</p>
  <p style="margin:0 0 16px">Acabamos de crear una cuenta en Enséñame Ya con esta dirección de correo, desde el formulario de pago.</p>
  <p style="margin:0 0 16px">Si fuiste tú, no tienes que hacer nada.</p>
  <p style="margin:0 0 24px">Si <strong>no</strong> fuiste tú, escríbenos a <a href="mailto:${COMPANY.email}" style="color:#fe6a00">${COMPANY.email}</a>: esa cuenta puede entrar con la contraseña que se eligió al crearla, así que conviene que la desactivemos.</p>
  <p style="margin:0;color:#666;font-size:13px">Enséñame Ya · Recibes este correo porque alguien usó esta dirección para crear una cuenta.</p>
</div>`;

  const enviado = await sendEmail({
    to: email,
    subject: "Se creó una cuenta con tu correo en Enséñame Ya",
    html,
    text: lineas.join("\n"),
  });
  if (!enviado.ok) {
    console.error("[checkout/invitado] aviso de alta no salió:", enviado.error);
  }
}

export async function POST(req: Request) {
  // 1) ¿Es una petición de NUESTRA pantalla? Va la primera porque es la única
  //    que no cuesta ni una consulta.
  if (vieneDeOtroSitio(req)) {
    return NextResponse.json({ error: "Petición inválida." }, { status: 403 });
  }

  // Y el tipo de contenido, por lo mismo: `text/plain` es de la lista segura de
  // CORS y con él una página ajena manda esto sin preflight. `req.json()`
  // parsearía el cuerpo igual sin mirar la cabecera.
  const tipo = req.headers.get("content-type") ?? "";
  if (!tipo.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }

  // `req.json()` puede devolver perfectamente `null` o un número: un cuerpo con
  // el literal `null` es JSON válido. Sin esta comprobación, leer `body.email`
  // reventaría con un TypeError, o sea un 500 mudo en mitad de un pago.
  let crudo: unknown;
  try {
    crudo = await req.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }
  if (typeof crudo !== "object" || crudo === null) {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }
  const body = crudo as Record<string, unknown>;

  // 2) VALIDACIÓN EN SERVIDOR, no solo en el formulario. Son las MISMAS reglas
  //    que `/signup` (`components/form/validation.ts`), reutilizadas y no
  //    reescritas: dos versiones del mínimo de contraseña divergen el día que
  //    alguien cambia una.
  //
  //    ⚠️ Y aquí revalidar no es cortesía: el mínimo que de verdad manda es el
  //    del servidor de Auth de Supabase, que sigue en 6, y `createUser` es
  //    exactamente el «signUp programático» del que avisa ese fichero. Sin esta
  //    línea, el checkout crearía cuentas de 6 caracteres.
  //
  //    Va ANTES del límite para que un correo mal escrito no gaste cupo, y los
  //    topes de longitud van antes que las regex: comprobar el tamaño de un
  //    campo de megabytes cuesta menos que pasarle una expresión regular.
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const fullName =
    typeof body.fullName === "string" ? body.fullName.trim().slice(0, 120) : "";
  const aceptaTerminos = body.acceptedTerms === true;

  const fallo =
    (email.length > 254 ? "Ese correo no parece válido. Revísalo." : null) ??
    emailError(email) ??
    // GoTrue rechaza por encima de 72 caracteres; el tope de aquí es solo para
    // no mandarle a Auth un campo de tamaño arbitrario.
    (password.length > 200 ? "Esa contraseña es demasiado larga." : null) ??
    passwordError(password) ??
    // Sin la casilla no hay constancia que escribir, y sin constancia dLocal no
    // valida la cuenta. No es un campo opcional del formulario: es el requisito.
    (aceptaTerminos ? null : "Debes aceptar los términos para continuar.");
  if (fallo) return NextResponse.json({ error: fallo }, { status: 400 });

  // ⚠️ `createAdminClient()` LANZA si falta la clave de servicio. En el resto de
  // integraciones «la credencial es el interruptor» y todo cae al camino
  // simulado; aquí no hay camino simulado, y una excepción sin capturar sería
  // un 500 mudo en mitad de un pago.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Ahora mismo no podemos crear cuentas. Intenta en unos minutos." },
      { status: 503 },
    );
  }

  // 3) El límite, antes de hablar con el servidor de Auth: no vamos a pagar ese
  //    viaje —ni el de crear la cuenta— por cada petición de quien martillea.
  const cupo = await estadoDelCupo(admin, ipDeLaPeticion(req));
  if (cupo === "limite") {
    return NextResponse.json(
      {
        error:
          "Has hecho varios intentos seguidos. Espera unos minutos y vuelve a intentarlo.",
      },
      { status: 429 },
    );
  }
  if (cupo === "error") {
    // Sin contador no hay límite, así que aquí se para. Mismo texto que cuando
    // falta la clave de servicio: para quien compra es el mismo hecho.
    return NextResponse.json(
      { error: "Ahora mismo no podemos crear cuentas. Intenta en unos minutos." },
      { status: 503 },
    );
  }

  // 4) Quien ya tiene sesión no pinta nada aquí: su checkout no enseña este
  //    formulario. Si llega igual es una pestaña vieja o algo manipulado, y
  //    crearle una segunda cuenta sería lo peor que podríamos hacer.
  const supabase = await createClient();
  const {
    data: { user: yaDentro },
  } = await supabase.auth.getUser();
  if (yaDentro) {
    return NextResponse.json(
      { error: "Ya tienes la sesión abierta. Recarga la página." },
      { status: 409 },
    );
  }

  const jar = await cookies();
  // La atribución de referido y la zona horaria se leen de las cookies EN
  // SERVIDOR: aquí ya están a mano y así el navegador no puede inventárselas.
  // El recorte a 64 es el mismo que aplica el proxy al guardar `?ref=`
  // (`lib/supabase/middleware.ts`); aquí se lee la cookie directamente, así que
  // hay que repetirlo o entra en `profiles` lo que quepa en una cabecera.
  const referralCode = leerCookie(jar, REFERRAL_COOKIE)?.slice(0, 64) ?? null;
  const timezone = zonaValida(leerCookie(jar, TZ_COOKIE));

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    // La única razón de que este endpoint exista (ver el docblock) — y lo que
    // NO prueba, también.
    email_confirm: true,
    user_metadata: {
      // Lo lee `lib/auth/server.ts` al decidir a qué onboarding mandar: con
      // "tutor" el guard llevaría al comprador a `/tutor/onboarding`.
      intended_role: "alumno",
      referral_code: referralCode,
      // Sin estas dos el trigger no escribe la constancia y no se ve el fallo:
      // se ve como una fila de `terms_acceptances` que no existe.
      terms_version: TERMS_VERSION,
      terms_locale: TERMS_GOVERNING_LOCALE,
      // `handle_new_user` lo copia a `profiles.full_name` aunque `/signup` no lo
      // mande (M-05); aquí sí se pide, porque el comprador no va a pasar por un
      // onboarding donde dárnoslo.
      full_name: fullName || null,
      // El trigger hace `coalesce(…, 'UTC')`, y ese 'UTC' es el default que
      // causaba RV-03: horas desplazadas bajo un rótulo que dice «tu hora
      // local». La cookie `ey-tz` la escribe `TimezoneSync` desde el layout
      // raíz, así que un anónimo también la trae.
      timezone,
    },
  });

  if (error || !data?.user) {
    // ⚠️ CORREO QUE YA EXISTE → NO SE CREA NADA, NO SE ABRE NINGUNA SESIÓN Y
    // TAMPOCO SE DICE. Entregar sesión a quien teclea el correo de otro es tomar
    // una cuenta sabiendo solo un email; y CONTESTAR que ese correo tiene cuenta
    // es un comprobador de listas gratis, que en una plataforma de mentorías es
    // dato personal.
    //
    // ⚠️ El comentario que había aquí decía que esto «no abre una vía de
    // enumeración nueva porque `/signup` ya enseña el mismo texto», y era FALSO
    // justo en el ambiente que importa: con la confirmación por correo ENCENDIDA
    // —la premisa de este endpoint entero— `supabase.auth.signUp` sobre un
    // correo ya registrado NO devuelve error, devuelve un usuario ofuscado, así
    // que `signup-form.tsx` cae en su rama de «te enviamos un correo» y no
    // delata nada. La Admin API se salta esa protección por diseño y contesta
    // `email_exists`. O sea que sí era una vía nueva, y más limpia.
    //
    // Por eso se responde 200 GENÉRICO: para el navegador, «sigue adelante». El
    // que decide es el `signInWithPassword` de `datos-invitado.tsx`, que sin la
    // contraseña de verdad no entra a ninguna parte, y quien no la tenga no
    // aprende nada de este endpoint.
    if (correoYaRegistrado(error)) {
      return NextResponse.json({ ok: true });
    }
    // Nunca el mensaje crudo de GoTrue: puede traer detalles de configuración
    // nuestra contados como si fueran culpa de quien iba a pagar (mismo
    // criterio que `api/pedidos/route.ts` con los errores de Postgres).
    console.error("[checkout/invitado] createUser falló:", error?.message);
    return NextResponse.json(
      { error: "No se pudo crear la cuenta. Revisa los datos e intenta de nuevo." },
      { status: 400 },
    );
  }

  // La cuenta del checkout NACE con el onboarding dado por hecho: al volver de
  // la pasarela, la confirmación vive en `(app)` y su layout llama a
  // `requireUser()`, que rebota al asistente mientras el flag esté en false.
  // Así el guard sigue intacto para todos los demás.
  //
  // ⚠️ El grant que hace posible este `update` es de `20260831130000` (regla de
  // oro 9). Si algún día falta, esto falla en EJECUCIÓN y no en el build: se
  // registra y se sigue, porque la cuenta ya existe y devolver un error aquí
  // dejaría al comprador con una cuenta que no puede volver a crear. El precio
  // de ese caso es una parada en `/onboarding` antes de pagar, no una compra
  // perdida.
  const { error: errorPerfil } = await admin
    .from("profiles")
    .update({ onboarding_complete: true })
    .eq("id", data.user.id);
  if (errorPerfil) {
    console.error(
      "[checkout/invitado] no se pudo marcar onboarding_complete:",
      errorPerfil.message,
    );
  }

  // El alta deja de ser muda: el dueño de la dirección se entera. Después de
  // responder, para no meter a Resend en el camino del pago.
  after(async () => {
    await avisarAlCorreo(email);
  });

  // Ni contraseña, ni tokens, ni nada que venga del cliente admin. La sesión la
  // abre el navegador con la contraseña que su dueño acaba de teclear.
  return NextResponse.json({ ok: true });
}
