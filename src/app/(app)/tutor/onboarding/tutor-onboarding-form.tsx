"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { horasSemana, type Rule } from "@/lib/availability";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  PhoneInput,
  countryFromTimezone,
} from "@/components/form/phone-input";
import { TimezoneSelect } from "@/components/form/timezone-select";
import {
  WizardShell,
  WizardDone,
  DoneChecklist,
  ChipGroup,
  Field,
  FIELD_CLASS,
  useWizardStep,
  useSaveOnExit,
} from "@/components/onboarding/wizard";
import { AvatarUpload } from "@/components/onboarding/avatar-upload";
import { FirstProductForm } from "@/components/onboarding/first-product-form";
import { AvailabilityManager } from "../availability/availability-manager";
import {
  VerificationForm,
  type DocState,
  type IdentityStatus,
  type VerificationSave,
} from "../verification/verification-form";
import type { SocialLink } from "@/lib/socials";
import type { Database } from "@/lib/database.types";

type TeachingLevel = Database["public"]["Enums"]["teaching_level"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

const LEVELS: { id: TeachingLevel; label: string }[] = [
  { id: "basico", label: "Básico" },
  { id: "intermedio", label: "Intermedio" },
  { id: "avanzado", label: "Avanzado" },
];

// E.164: '+' + 7–15 dígitos, el primero no cero (RN-44). Es el mismo CHECK que
// tiene `profiles.phone`; comprobarlo aquí cambia un "no se pudo guardar" seco
// por un aviso que dice qué falta.
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * US-202 / UX-202 (SCR-TU01) — asistente de 6 pasos: perfil, categorías,
 * contacto, **disponibilidad** (EY-183), **verificación de identidad**
 * (penúltimo, 24-jul) y primera mentoría (N-03). Los materiales de clase
 * salieron a la creación de la oferta (R24-16).
 *
 * Cada paso persiste al avanzar, así que "Guardar y salir" no necesita lógica
 * propia: lo escrito ya está guardado. `approval_status` NO se toca aquí (fuera
 * del column-grant, US-1403): el perfil nace y queda `pending`.
 *
 * ⚠️ **Un solo par de botones manda: «Atrás» y «Continuar».** Los pasos montan
 * módulos del panel (disponibilidad, verificación) y el de verificación traía
 * los suyos —«Guardar borrador» y «Guardar y enviar a revisión»—, así que el
 * paso 5 llegó a tener CUATRO controles y ninguno decía cuál avanzaba. Dentro
 * del asistente manda el paso: si un módulo nuevo trae botón de guardar, se
 * apaga aquí dentro y lo dispara «Continuar» (patrón: `saveRef`). Los botones
 * que CREAN algo —«Añadir franja», «Crear mi primera mentoría»— sí se quedan:
 * no son la misma intención que avanzar, y «Continuar» nunca los exige.
 *
 * ⚠️ **EY-183 · por qué la disponibilidad va DESPUÉS de la zona horaria y no
 * antes.** Las franjas se guardan como hora de pared (`time`), y quien las
 * interpreta es `get_available_slots` usando `profiles.timezone` del tutor. La
 * columna trae `'UTC'` por defecto y esa zona solo se fija en el paso 3: puesto
 * antes, un tutor de Caracas escribiría «9:00–13:00» y publicaría 05:00–09:00
 * de su hora sin que nada se lo dijera. Es exactamente RV-03c contado al revés,
 * así que el orden que pidió el cliente resulta ser además el único correcto.
 *
 * ⚠️ **Y por qué NO puede encerrar a nadie (RN-44).** `requireUser()` rebota a
 * `/onboarding` mientras `onboarding_complete` sea false, con `/onboarding` y
 * `/tutor/onboarding` como únicas excepciones, comparando el pathname PELADO
 * (`middleware.ts:rutaActual` quita la query justo para eso, así que `?paso=4`
 * no rompe la igualdad). El flag lo pone el paso 3 — antes de estos dos pasos
 * nuevos—, de modo que a partir de aquí el guarda ya no redirige a nadie, y
 * antes de aquí estamos en una ruta exenta. Ninguno de los dos pasos nuevos
 * escribe en `profiles`, así que tampoco puede volver a apagarlo.
 */
export function TutorOnboardingForm({
  userId,
  exists,
  initialStep,
  totalSteps,
  headline: headline0,
  bio: bio0,
  fullName: name0,
  avatarPath,
  avatarUrl,
  timezone: tz0,
  phone: phone0,
  level: level0,
  categories,
  productCategories,
  selectedCategories,
  docsByType,
  identityStatus,
  socials,
  productCount: productCount0,
  rules,
  rulesUsedBy,
}: {
  userId: string;
  exists: boolean;
  /** M-03: paso ya resuelto en servidor (URL → cookie → 1). */
  initialStep: number;
  totalSteps: number;
  headline: string;
  bio: string;
  fullName: string;
  avatarPath: string | null;
  avatarUrl: string | null;
  timezone: string;
  phone: string;
  level: TeachingLevel | null;
  categories: { id: string; label: string }[];
  /** Categorías ACTIVAS, que son las que puede llevar una mentoría (N-03). */
  productCategories: { id: string; name: string }[];
  selectedCategories: string[];
  docsByType: Record<string, DocState>;
  /** Estado global de la verificación → checklist del paso 5 (N-10). */
  identityStatus: IdentityStatus;
  /** R29-02: redes/portafolio ya guardados; los edita el módulo del paso 5. */
  socials: SocialLink[];
  /** Mentorías ya creadas. EX-02: se puede posponer, pero sin ninguna el
   *  perfil no se aprueba — el asistente lo dice, no lo bloquea. */
  productCount: number;
  /**
   * EY-183 · franjas del paso 4. Llegan del servidor y NO suben a estado: el
   * gestor guarda contra Supabase y llama a `router.refresh()`, que vuelve a
   * pintar la página y baja esta prop ya actualizada. Duplicarlas en un
   * `useState` daría dos verdades que se desincronizan al primer borrado.
   */
  rules: Rule[];
  /** N-04 · `rule_id` → mentorías que la usan; el gestor avisa antes de borrar. */
  rulesUsedBy: Record<string, string[]>;
}) {
  const { step, setStep, finish } = useWizardStep("tutor", initialStep);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // `exists` viene del server y no se entera del INSERT del paso 1: sin este
  // estado, el paso 2 reintenta insertar la misma fila y choca contra la PK.
  const [hasProfile, setHasProfile] = useState(exists);
  /**
   * N-03 · El número de mentorías llegaba del servidor y era inmutable, así que
   * al crear la oferta desde aquí el último paso seguía diciendo que no había
   * ninguna. Sube a estado: es el asistente quien la crea.
   */
  const [productCount, setProductCount] = useState(productCount0);
  /** "Añadir otra" reabre el formulario embebido sin salir del asistente. */
  const [addingProduct, setAddingProduct] = useState(false);

  /**
   * Guardado del paso 5, en manos del asistente. El módulo de verificación ya
   * no pinta sus dos botones aquí dentro (ver `verification-form.tsx`), así que
   * lo registra y quien lo dispara es «Continuar».
   */
  const guardarVerificacion = useRef<VerificationSave | null>(null);

  /*
   * Cuánto expediente hay, para la pantalla de cierre. `null` = "todavía manda
   * el servidor": entre guardar el paso 5 y pulsar «Finalizar» no hay otra
   * petición a la página, así que las props dirían "cero documentos" a quien
   * acaba de subir seis. Se guarda el DELTA en vez de sembrar un `useState` con
   * el valor del servidor, que se quedaría fijo aunque las props se refresquen.
   */
  const [docsSubidos, setDocsSubidos] = useState<number | null>(null);
  const [enlacesGuardados, setEnlacesGuardados] = useState<number | null>(null);

  // M-05 · El nombre viaja del alta al onboarding. Aquí faltaba: quien elige
  // "quiero enseñar" al registrarse salta DIRECTO a este asistente sin pasar
  // por el de alumno, así que sin este campo el tutor se quedaba sin nombre —
  // y `display_name` (la vitrina pública, DD-01) sin nada que copiar.
  const [fullName, setFullName] = useState(name0);
  const [headline, setHeadline] = useState(headline0);
  const [bio, setBio] = useState(bio0);
  const [avatar, setAvatar] = useState<string | null>(avatarPath);
  const [cats, setCats] = useState<Set<string>>(new Set(selectedCategories));
  const [level, setLevel] = useState<TeachingLevel | null>(level0);
  const [timezone, setTimezone] = useState(tz0);
  const [phone, setPhone] = useState(phone0);
  // El prefijo sigue a la zona horaria mientras no haya número escrito; si ya
  // lo escribiste manda tu número. La librería no admite país controlado, así
  // que el cambio se aplica remontando el campo (`key`), que estando vacío no
  // pierde nada.
  const [country, setCountry] = useState(() => countryFromTimezone(tz0));

  /*
   * RV-03c · Este asistente NO proponía zona horaria y el de alumno sí, así que
   * un tutor que no tocara el selector se guardaba con el `'UTC'` que trae por
   * defecto la columna. Es la vía más probable por la que hay perfiles en
   * `'UTC'` en la base, y de ahí salían las horas desplazadas de RV-03.
   *
   * Y aquí importa más que en el de alumno: `profiles.timezone` del tutor no es
   * decorativa — `get_available_slots` interpreta en esa zona sus reglas de
   * disponibilidad, así que un tutor guardado como UTC publica sus horas
   * corridas. (Comprobado el 17-ago: ningún tutor APROBADO estaba así, o sea
   * que nadie tiene hoy la agenda torcida. Esto evita que vuelva a pasar.)
   *
   * Se resuelve en la página con `getUserTimezone()` y llega ya en `tz0`, en
   * vez de detectarla aquí: leer `Intl` durante el render daría un valor en el
   * servidor y otro en el cliente, que es el desajuste de hidratación de RV-18.
   */
  function pickTimezone(tz: string) {
    setTimezone(tz);
    if (!phone.trim()) setCountry(countryFromTimezone(tz) ?? country);
  }

  const supabase = createClient();

  /**
   * Perfil de vitrina: se reescribe entero en cada paso que lo toca.
   * `socials` NO se toca aquí (R29-02): lo escribe el módulo de verificación
   * del paso 5, y pisarlo con `{}` desde el paso 1 borraría lo ya guardado.
   */
  async function saveProfile() {
    const payload = {
      headline: headline.trim(),
      bio: bio.trim() || null,
      teaching_level: level,
      // Copia pública del nombre y la foto (DD-01): `profiles` no es visible
      // para anon, así que la tarjeta del catálogo lee estas dos columnas.
      display_name: fullName.trim() || null,
      avatar_path: avatar,
    };

    const { error } = hasProfile
      ? await supabase.from("tutor_profiles").update(payload).eq("profile_id", userId)
      : await supabase.from("tutor_profiles").insert({ profile_id: userId, ...payload });
    if (!error) setHasProfile(true);
    return error;
  }

  // ¿Las categorías elegidas difieren de las que trajo el servidor? El guardado
  // las reemplaza en bloque (delete + insert), así que solo se toca si cambió.
  const catsChanged =
    cats.size !== selectedCategories.length ||
    selectedCategories.some((id) => !cats.has(id));

  /**
   * M-03 · Lo que guarda "Guardar y salir" (ver `useSaveOnExit`): lo que haya
   * en pantalla, sin exigir que el paso esté completo y sin avisos —el usuario
   * ya se fue—. Descarta lo que rompería la base (`profiles.phone` tiene CHECK
   * E.164).
   */
  async function guardarBorrador() {
    if (done) return; // ya terminó: no hay borrador, hay perfil enviado

    const patch: ProfileUpdate = { timezone };
    if (fullName.trim()) patch.full_name = fullName.trim();
    if (E164.test(phone.trim())) patch.phone = phone.trim();
    await supabase.from("profiles").update(patch).eq("id", userId);

    /*
     * ⚠️ La fila de `tutor_profiles` NO se crea con el paso 1 en blanco. Es la
     * que decide si sales de aquí siendo tutor: la pantalla de bienvenida solo
     * aparece mientras no existe (`!tp`), y `pickHome({esTutor})` manda al
     * panel de tutor a quien la tenga. Crearla porque alguien pulsó "Comenzar
     * registro" y se arrepintió lo convertiría en tutor a medias sin haber
     * escrito una línea.
     */
    if (hasProfile || headline.trim() || bio.trim() || avatar) {
      await saveProfile();
      if (catsChanged) {
        await supabase.from("tutor_categories").delete().eq("tutor_id", userId);
        const rows = [...cats].map((category_id) => ({ tutor_id: userId, category_id }));
        if (rows.length > 0) await supabase.from("tutor_categories").insert(rows);
      }
    }
  }

  useSaveOnExit(guardarBorrador);

  async function next() {
    setBusy(true);

    if (step === 1) {
      // M-05: el nombre es del USUARIO → va a `profiles`; `saveProfile` lo
      // copia a `tutor_profiles.display_name`, que es lo que ve el catálogo.
      if (!fullName.trim()) return fail("Escribe tu nombre.");
      if (!headline.trim()) return fail("Escribe un titular para tu perfil.");
      if (!avatar) return fail("La foto de perfil es obligatoria.");
      if (!bio.trim()) return fail("Escribe tu biografía.");
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() })
        .eq("id", userId); // RLS profiles_update_own limita a la fila propia.
      if (error) return fail("No se pudo guardar tu nombre.");
      // Espeja el nombre en el metadata de Auth → header/saludo sin query
      // extra, igual que hace el asistente de alumno al terminar.
      await supabase.auth.updateUser({ data: { full_name: fullName.trim() } });
      // La foto va SOLO a tutor_profiles (dentro de saveProfile): la foto de
      // tutor es independiente de la personal de `profiles` (R24-23).
      if (await saveProfile()) return fail("No se pudo guardar tu perfil.");
    }

    if (step === 2) {
      if (cats.size === 0) return fail("Elige al menos una categoría.");
      if (await saveProfile()) return fail("No se pudo guardar.");
      // Reemplaza el conjunto entero: más simple que calcular el diff.
      await supabase.from("tutor_categories").delete().eq("tutor_id", userId);
      const rows = [...cats].map((category_id) => ({ tutor_id: userId, category_id }));
      const { error } = await supabase.from("tutor_categories").insert(rows);
      if (error) return fail("No se pudieron guardar las categorías.");
    }

    if (step === 3) {
      if (!E164.test(phone.trim())) {
        return fail("Escribe tu teléfono completo, sin el código de país.");
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          timezone,
          phone: phone.trim(),
          // Con esto el asistente de tutor cierra también el onboarding de
          // CUENTA: son los mismos básicos que pedía el de alumno (RN-44), y
          // sin marcarlo `requireUser` devolvería al tutor a /onboarding en
          // cuanto saliera de aquí. La FOTO no se toca: la del alumno es
          // independiente de la del tutor y se edita desde Mi cuenta.
          onboarding_complete: true,
        })
        .eq("id", userId);
      if (error) return fail("No se pudo guardar tu contacto.");
      if (await saveProfile()) return fail("No se pudo guardar.");
    }

    // El paso 4 (disponibilidad) no aparece arriba a propósito, no por olvido:
    // monta el gestor del panel, que escribe por su cuenta al momento, así que
    // aquí no hay nada que guardar ni nada que validar. Ver EY-183.

    /*
     * Paso 5 · verificación. Este SÍ guarda desde aquí: el módulo traía dentro
     * «Guardar borrador» y «Guardar y enviar a revisión», que dentro del
     * asistente eran dos botones más peleándose con «Atrás» y «Continuar» sin
     * que nadie dijera cuál avanzaba. Ahora manda el paso y «Continuar» guarda
     * —siempre como BORRADOR, ver el cierre de abajo—.
     */
    if (step === 5) {
      const guardado = await guardarVerificacion.current?.();
      // OPCIONAL como el 4 y el 6 (EX-02): sin nada elegido no hay nada que
      // guardar y se avanza. Lo que sí frena es un guardado FALLIDO —un enlace
      // inválido, una subida caída—: el paso siguiente desmonta el módulo y con
      // él los archivos elegidos, que hasta guardarse viven solo en memoria.
      // El QUÉ falló ya lo dijo `persist` con su propio toast.
      if (guardado && !guardado.ok) {
        setBusy(false);
        return;
      }
      if (guardado) {
        setDocsSubidos(guardado.docs);
        setEnlacesGuardados(guardado.socials);
      }
    }

    if (step === totalSteps) {
      /*
       * ⚠️ Aquí —y solo aquí— el expediente pasa a revisión.
       *
       * Antes «Finalizar» se limitaba a cerrar el asistente, y la pantalla de
       * cierre decía "Tu perfil pasó a revisión" sin que nadie lo hubiera
       * enviado: quien hubiese usado «Guardar borrador» en el paso 5 terminaba
       * con los seis documentos en `draft`, la identidad en `not_submitted` —o
       * sea, invisible para el admin— y la sensación de haber acabado.
       *
       * Este es además el único momento en que el envío es honesto: manda
       * documentos Y enlaces a la vez, y el propio checklist del paso 5 cuenta
       * la primera mentoría, que es el paso 6. Enviar desde el 5 era enviar
       * antes de terminar.
       *
       * La RPC solo pasa `draft` → `pending`: sin borradores es un no-op, así
       * que llamarla siempre es seguro (y no toca lo ya aprobado o rechazado).
       */
      const { error } = await supabase.rpc("submit_documents_for_review");
      if (error) {
        return fail("No pudimos enviar tu expediente a revisión. Inténtalo otra vez.");
      }
      // M-03 · El asistente TERMINA aquí. Antes hacía `router.push("/tutor")`
      // y el tutor aterrizaba en el menú sin señal de haber acabado.
      finish(); // saca el `?paso=` de la URL: la pantalla de cierre no es un paso
      setBusy(false);
      setDone(true);
      return;
    }

    setBusy(false);
    setStep((s) => s + 1);
  }

  function fail(msg: string) {
    toast.error(msg);
    setBusy(false);
  }

  const back = () => setStep((s) => Math.max(1, s - 1));
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  // M-03 · Cierre del asistente de tutor.
  if (done) {
    /*
     * Lo que se pospuso, con SU consecuencia — que no es la misma en los dos
     * casos y mezclarlas sería mentir:
     *  · sin mentoría no hay aprobación (EX-02);
     *  · sin franjas sí hay aprobación, pero nadie puede reservar
     *    (`get_available_slots` no tiene de dónde sacar huecos).
     * Un tutor aprobado, visible en el catálogo y con la agenda vacía es el
     * peor de los dos finales, porque parece que todo fue bien.
     */
    const horas = horasSemana(rules);
    const pendientes = [
      // El expediente de identidad ya salió hacia el admin (lo manda
      // «Finalizar»), pero puede haber salido VACÍO: sin documentos no hay nada
      // que verificar, y eso el tutor tiene que oírlo aquí y no tres semanas
      // después preguntándose por qué su revisión no avanza.
      (docsSubidos ?? Object.keys(docsByType).length) === 0
        ? "No subiste ningún documento. Sin ellos no podemos verificar tu identidad, y sin verificarla no aprobamos el perfil. Se añaden desde «Verificación»."
        : null,
      // R29-02 · fuera del asistente este enlace es obligatorio para poder
      // enviar a revisión; aquí no se bloquea —ningún paso del asistente
      // bloquea— pero sí se dice, y allí seguirá esperándole el mismo aviso.
      (enlacesGuardados ?? socials.length) === 0
        ? "No dejaste ninguna red social ni portafolio. Forma parte de lo que revisamos; se añade desde «Verificación»."
        : null,
      productCount === 0
        ? "Te falta tu primera mentoría. Puedes crearla cuando quieras desde «Mis mentorías», pero hasta que exista no podemos aprobar tu perfil."
        : null,
      rules.length === 0
        ? "No has marcado ningún horario. Aunque aprobemos tu perfil, nadie podrá reservarte hasta que añadas al menos una franja en «Disponibilidad»."
        : null,
    ].filter((t) => t !== null);

    return (
      <WizardDone
        title="¡Listo! Tu perfil pasó a revisión"
        description="Revisamos tu expediente y te avisamos por correo. Mientras tanto puedes seguir preparando tus mentorías desde tu panel."
        href="/tutor"
      >
        <DoneChecklist
          items={[
            `Perfil público a nombre de ${fullName.trim()}`,
            `${cats.size} ${cats.size === 1 ? "categoría elegida" : "categorías elegidas"}`,
            `Zona horaria: ${timezone} — tus horarios se publican en esta hora`,
            horas
              ? `Abres ${horas} a la semana`
              : "Sin horarios todavía",
            productCount > 0
              ? `${productCount} ${productCount === 1 ? "mentoría creada" : "mentorías creadas"} (en borrador hasta que te aprobemos)`
              : "Sin mentorías todavía",
          ]}
        />
        {/* Los dos pasos opcionales se pueden posponer, y eso está bien; lo que
            no puede es descubrirse semanas después, cuando el tutor se pregunte
            por qué su revisión no avanza o por qué no le entra nadie. */}
        {pendientes.length > 0 ? (
          <div className="flex w-full gap-3 rounded-[16px] border border-[#f0d9a8] bg-[#fdf6e7] p-5">
            <TriangleAlertIcon className="mt-0.5 size-4.5 shrink-0 text-[#9a6b00]" />
            <div className="flex flex-col gap-2 text-[12.5px] text-[#7a5600]">
              <strong className="font-semibold">
                Antes de poder recibir alumnos:
              </strong>
              <ul className="flex list-disc flex-col gap-1.5 pl-4">
                {pendientes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </WizardDone>
    );
  }

  if (step === 1) {
    return (
      <WizardShell
        step={1}
        total={totalSteps}
        title="Crea tu perfil de tutor"
        description="Empecemos por lo básico. Esta info es parte de tu entrevista de ingreso."
        onNext={next}
        busy={busy}
      >
        {/* M-05 · Va el primero: es el nombre con el que apareces en el
            catálogo, y quien llegó aquí desde el alta como tutor no lo dio en
            ningún otro sitio. */}
        <Field
          label="¿Cómo te llamas? (obligatorio)"
          htmlFor="full_name"
          hint="Es el nombre con el que te verán los alumnos."
        >
          <Input
            id="full_name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            placeholder="Ej: María Fernández"
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Foto de perfil (obligatoria)">
          <AvatarUpload
            userId={userId}
            initialUrl={avatarUrl}
            onUploaded={setAvatar}
            name={fullName}
            large
            fileBase="tutor-avatar"
          />
        </Field>
        <Field label="Headline (obligatorio)" htmlFor="headline">
          <Input
            id="headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Ej: Profesora de inglés para entrevistas tech"
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Bio (obligatoria)" htmlFor="bio">
          <Textarea
            id="bio"
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Resume tu experiencia y el resultado que ayudas a lograr…"
            className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
          />
        </Field>
      </WizardShell>
    );
  }

  if (step === 2) {
    return (
      <WizardShell
        step={2}
        total={totalSteps}
        title="¿Qué enseñas?"
        description="Elige al menos una categoría. Podrás ajustarlas luego."
        onBack={back}
        onNext={next}
        busy={busy}
      >
        <Field label="Categorías">
          <ChipGroup
            ariaLabel="Categorías que enseñas"
            options={categories}
            selected={cats}
            onToggle={(id) => setCats((p) => toggle(p, id))}
          />
        </Field>
        {/* El Figma lo pinta como select (186:44), no como chips. */}
        <Field label="Nivel principal" htmlFor="teaching_level">
          <select
            id="teaching_level"
            value={level ?? ""}
            onChange={(e) =>
              setLevel((e.target.value || null) as TeachingLevel | null)
            }
            className={cn(
              FIELD_CLASS,
              "w-full border border-input bg-transparent outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          >
            <option value="">Sin especificar</option>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
      </WizardShell>
    );
  }

  if (step === 3) {
    return (
      <WizardShell
        step={3}
        total={totalSteps}
        title="Zona horaria y contacto"
        description="Usamos tu zona horaria para mostrar tus horarios correctamente."
        onBack={back}
        onNext={next}
        busy={busy}
      >
        <Field label="Zona horaria" htmlFor="timezone">
          <TimezoneSelect
            value={timezone}
            onChange={pickTimezone}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Teléfono" htmlFor="phone">
          <PhoneInput
            key={country}
            id="phone"
            value={phone}
            onChange={setPhone}
            defaultCountry={country}
          />
        </Field>
        {/* R29-02: los enlaces se piden una sola vez, en el paso siguiente
            (junto a los documentos). Aquí solo va el contacto. */}
      </WizardShell>
    );
  }

  /*
   * EY-183 · Disponibilidad, justo después de la zona horaria.
   *
   * Monta el gestor del panel TAL CUAL (`/tutor/availability`), sin una
   * variante «de onboarding». No es pereza: esa pantalla se rehízo entera el
   * 7-ago por ser difícil de entender, y el acordeón —un solo día abierto— y el
   * «copiar a lunes-viernes» son la respuesta a los dos problemas que se
   * midieron allí. Una versión simplificada aquí volvería a tener los siete
   * formularios abiertos que se quitaron, y encima en la pantalla donde el
   * tutor ve esto por primera vez.
   *
   * Consecuencias de reusarlo, que hay que conocer:
   *  · Guarda AL MOMENTO contra Supabase (no espera a «Continuar»), así que
   *    este paso no valida ni persiste nada en `next()`.
   *  · Refresca con `router.refresh()`. Aquí eso re-renderiza la página del
   *    asistente, no la del panel; el estado del cliente (el paso, el nombre a
   *    medio escribir) sobrevive porque `refresh` reconcilia, no remonta.
   *
   * Las EXCEPCIONES puntuales («la semana que viene no») se quedan fuera a
   * propósito: son para cuando ya tienes agenda, no para montarla.
   *
   * OPCIONAL (misma decisión que EX-02 para la mentoría): «Continuar» nunca se
   * bloquea. Un tutor que aún no ha decidido su horario semanal no puede
   * quedarse encerrado en el alta por eso; lo que sí hace falta es que sepa qué
   * pierde, y eso se dice aquí y otra vez en la pantalla de cierre.
   */
  if (step === 4) {
    return (
      <WizardShell
        step={4}
        total={totalSteps}
        title="¿Cuándo puedes dar clase?"
        description={`Marca las franjas en las que estás disponible cada semana. Se guardan en tu zona horaria (${timezone}) y se muestran a cada alumno en la suya.`}
        onBack={back}
        onNext={next}
        busy={busy}
        maxWidth={760}
      >
        <AvailabilityManager
          userId={userId}
          rules={rules}
          usedBy={rulesUsedBy}
        />

        {rules.length === 0 ? (
          <p className="text-[13px] text-[#4d4d4d]">
            Puedes dejarlo para luego y pulsar «Continuar», pero ten en cuenta
            que mientras no tengas ninguna franja nadie podrá reservarte, aunque
            aprobemos tu perfil. Se cambia cuando quieras desde
            «Disponibilidad».
          </p>
        ) : (
          <p className="text-[13px] text-[#6b6b6b]">
            Podrás afinarlo desde «Disponibilidad», donde además se marcan los
            días sueltos que no puedes (vacaciones, un festivo…).
          </p>
        )}
      </WizardShell>
    );
  }

  // Penúltimo paso (24-jul): verificación de identidad reusando el módulo TU02,
  // pero SIN sus dos botones: aquí guarda «Continuar» (ver `next()`) y el envío
  // a revisión es de «Finalizar». Los materiales de clase salieron del
  // onboarding a la oferta (R24-16).
  if (step === 5) {
    return (
      <WizardShell
        step={5}
        total={totalSteps}
        title="Verifica tu identidad"
        description="Sube lo que tengas a mano y pulsa «Continuar»: se guarda solo, y lo que falte lo puedes completar después. Nada llega a revisión hasta que termines el registro."
        onBack={back}
        onNext={next}
        busy={busy}
        bare
        maxWidth={760}
      >
        <VerificationForm
          userId={userId}
          docsByType={docsByType}
          socials={socials}
          identityStatus={identityStatus}
          hasAvatar={!!avatar}
          productCount={productCount}
          // La mentoría es el paso SIGUIENTE de este mismo asistente: el
          // checklist muestra su estado pero no manda a crearla fuera, que es
          // exactamente el salto que hay que evitar aquí (N-03). `inWizard`
          // apaga además sus dos botones de guardar: aquí manda el paso.
          inWizard
          saveRef={guardarVerificacion}
        />
      </WizardShell>
    );
  }

  /*
   * N-03 · La primera mentoría se crea AQUÍ DENTRO.
   *
   * Antes esto eran dos `<Link>` a `/tutor/products/new`: el tutor salía del
   * asistente y aterrizaba en el panel del tutor, donde ya no había ni rastro
   * del asistente ni de "vuelve a terminar" — "quien se sale ahí no vuelve".
   *
   * Y "Finalizar" ya NO se bloquea (EX-02): el tutor puede posponer su primera
   * mentoría; lo que no puede es que le aprueben el perfil sin ella. Eso se
   * dice —aquí y en la pantalla de cierre— en vez de dejarle un botón muerto
   * cuya causa no se ve.
   */
  const mostrarFormulario = productCount === 0 || addingProduct;
  return (
    <WizardShell
      step={totalSteps}
      total={totalSteps}
      title="Tu primera mentoría"
      description={
        productCount > 0
          ? "Ya tienes tu primera mentoría creada. Puedes finalizar tu registro."
          : "Créala sin salir de aquí. Lo básico basta: podrás completarla y publicarla desde tu panel."
      }
      onBack={back}
      onNext={next}
      nextLabel="Finalizar"
      // No es "Guardando…": lo que hace este botón es ENVIAR el expediente.
      busyLabel="Enviando…"
      busy={busy}
    >
      {productCount > 0 ? (
        <>
          <p className="flex items-center gap-2 text-[13px] font-medium text-success">
            <CheckIcon className="size-4" />
            {productCount === 1
              ? "Tienes una mentoría creada."
              : `Tienes ${productCount} mentorías creadas.`}
          </p>
          {!addingProduct ? (
            <Button
              variant="outline"
              onClick={() => setAddingProduct(true)}
              className="h-[45px] w-full rounded-[8px] text-sm"
            >
              Añadir otra mentoría
            </Button>
          ) : null}
        </>
      ) : (
        // EX-02: la salida por arriba existe y se nombra, para que posponer sea
        // una decisión y no un abandono.
        <p className="text-[13px] text-[#4d4d4d]">
          Sin al menos una mentoría no podemos aprobar tu perfil. Si prefieres
          dejarlo para luego, pulsa «Finalizar»: tu perfil se envía igual y
          quedará marcado como incompleto hasta que la crees.
        </p>
      )}

      {mostrarFormulario ? (
        <FirstProductForm
          userId={userId}
          categories={productCategories}
          onCreated={() => {
            setProductCount((n) => n + 1);
            setAddingProduct(false);
          }}
        />
      ) : null}

      <p className="text-xs text-[#6b6b6b]">
        Al finalizar enviamos a revisión tu perfil y los documentos del paso
        anterior. Es el único botón que los envía: hasta aquí todo queda en
        borrador.
      </p>
    </WizardShell>
  );
}
