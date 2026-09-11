"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { SignOutDialog } from "@/components/layout/sign-out-dialog";

import { createClient } from "@/lib/supabase/client";
import { opcionesDeHora, type FormatoHora } from "@/lib/hora";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimezoneSelect } from "@/components/form/timezone-select";
import { FieldError } from "@/components/form/field-error";
import {
  PASSWORD_MIN,
  describedBy,
  passwordError,
  requiredError,
} from "@/components/form/validation";
import { AvatarUpload } from "@/components/onboarding/avatar-upload";
import {
  PanelCard,
  PanelCardTitle,
  StatusPill,
} from "@/components/layout/panel-shell";
import type { Database } from "@/lib/database.types";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { DeactivatedCard } from "./deactivated-card";
import {
  estaDesactivada,
  explicarAccionables,
  explicarEnEspera,
  hayDineroEnVuelo,
  type EstadoBaja,
} from "./baja";

type TutorApproval = Database["public"]["Enums"]["tutor_approval_status"];

/**
 * La hora que es AHORA en una zona IANA (RN-01/RN-02: la BD guarda UTC, la
 * pantalla enseña hora local), escrita en 12 h o 24 h según `ey-h12`. Devuelve
 * `null` —y no una hora falsa— si la zona no la conoce el runtime: `Intl` lanza
 * con un identificador que no existe, y una zona guardada hace meses puede
 * haber desaparecido.
 *
 * ⚠️ El `hourCycle` explícito que documentaba esta función se mudó a
 * `opcionesDeHora` (`lib/hora.ts`), que lo pone en los DOS sentidos y por el
 * mismo motivo: `hour12` a secas deja al runtime elegir el ciclo.
 */
function horaEnZona(tz: string, formato: FormatoHora): string | null {
  try {
    return new Intl.DateTimeFormat("es", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      ...opcionesDeHora(formato),
    }).format(new Date());
  } catch {
    return null;
  }
}

/* ── §7.2 · «AVISOS POR CORREO» — QUÉ SE PINTA Y POR QUÉ ASÍ (DP-4) ──────────
 *
 * El diseño aprobado enseña un interruptor Sí/No por aviso. Hoy NO HAY DÓNDE
 * GUARDAR ESA RESPUESTA: `notifications` es la COLA de lo enviado, no una tabla
 * de preferencias, y poder elegir exige una columna nueva — que es DP-4, o sea
 * decisión de producto + migración. Un interruptor que no guarda nada es peor
 * que ninguno: la persona lo apaga, se queda tranquila y le siguen llegando
 * todos los correos.
 *
 * Así que se enseña la verdad de hoy: la lista REAL, sacada de las plantillas
 * de `src/lib/email-templates.ts` (una por `asunto`), con la píldora «Siempre».
 * Cuando DP-4 tenga respuesta, la lista ya es la buena y solo hay que cambiar
 * la píldora por el interruptor.
 *
 * ⚠️ Se listan por ROL y no todas: `/account` la comparten alumno, tutor y
 * admin, y a un alumno no le llega ninguno de los de cobros. La lista del tutor
 * no incluye los de alumno aunque un tutor pueda reservar clases — serían 14
 * filas y ninguna de las dos mitades se leería.
 */
/* ⚠️ Nombres CORTOS, no el asunto entero del correo. A 768 la columna del
 * panel mide 258 px y la fila deja ~140 px para el texto: con el asunto
 * completo («La grabación de tu mentoría ya está disponible») cada fila caía en
 * cuatro líneas y la tarjeta medía 798 px de alto (medido). Cada nombre sigue
 * siendo el de UNA plantilla real; entre paréntesis, la suya. */
/* ⚠️ «Pago» y no «liquidación», aunque el ASUNTO del correo diga «liquidación»:
 * el panel del tutor ya eligió la otra palabra («Mis pagos», «Disponible para
 * retirar») y esta lista se lee dentro del panel, no dentro del buzón.
 *
 * ⚠️ Y «Tu pago todavía no ha llegado» cubre las DOS caras de `payout_unclaimed`.
 * Esa plantilla tiene dos asuntos según el riel —«…está esperando a que la
 * reclames» (PayPal) y «…está tardando más de lo normal» (el resto)— y el
 * nombre anterior («se está retrasando») solo nombraba el segundo, que es
 * justo el que NO pide hacer nada: quien recibiera el de reclamar no
 * encontraría su correo en esta lista. La frase elegida es la que abre los dos
 * cuerpos en `email-templates.ts`. */
const AVISOS_TUTOR = [
  "Reserva nueva por aceptar", // booking_new_tutor
  "Respuesta a tu solicitud de tutor", // tutor_review_result
  "Documentos recibidos y en revisión", // identity_in_review
  "Pago enviado", // payout_paid
  "Tu pago todavía no ha llegado", // payout_unclaimed (sus DOS asuntos)
];

const AVISOS_ALUMNO = [
  "Reserva confirmada", // booking_confirmed_student
  "Pago recibido", // payment_receipt
  "Reembolso procesado", // refund_processed
  "Pago no completado", // payment_failed
  "Invitación a dejar reseña", // review_request
];

/** Los que van a las dos partes (los triggers los encolan por duplicado). */
const AVISOS_COMUNES = [
  "Reserva cancelada", // cancellation
  "Mensaje nuevo", // new_message
  "Grabación disponible", // recording_ready
  "Mensaje del equipo de Enséñame Ya", // admin_message
];

/**
 * US-104 (SCR-G03) — "Mi cuenta" en módulos (24-jul): foto, información
 * personal (nombre, correo, zona horaria), contraseña, rol tutor y sesión.
 * Todo por RLS (`profiles_update_own` / auth propio); nada privilegiado.
 *
 * 9-sep · §7 del paquete «Panel del tutor v2» fija el orden y el reparto en
 * columnas (ver el comentario largo del `return`). La foto deja de tener
 * tarjeta propia y aparece «Avisos por correo».
 */
export function AccountForm({
  userId,
  email,
  fullName,
  timezone,
  avatarUrl,
  isTutor,
  tutorStatus,
  estadoBaja,
  calendario,
  referidos,
  formato,
}: {
  userId: string;
  email: string;
  fullName: string;
  timezone: string;
  /**
   * 12 h o 24 h (`ey-h12`), resuelto en SERVIDOR. Llega por prop y no se lee la
   * cookie aquí: en cliente el primer render saldría con el formato por defecto
   * y cambiaría al hidratar — un parpadeo justo en el reloj que esta tarjeta
   * usa para demostrar que la zona elegida es la buena.
   */
  formato: FormatoHora;
  avatarUrl: string | null;
  /** El ROL `tutor`, que solo llega al aprobar (US-1101). Lo siguen usando la
   *  baja de cuenta y el diálogo de eliminar, que preguntan por el rol. */
  isTutor: boolean;
  /** `approval_status` de `tutor_profiles`, o `null` si nunca empezó el alta
   *  de tutor. Con `isTutor` decide la cara de la tarjeta «Tu perfil de
   *  tutor» (Verónica, 3-sep-2026). */
  tutorStatus: TutorApproval | null;
  /** Estado de baja de la cuenta (`my_account_deletion_state`). `null` si la
   *  consulta falló: se pinta como cuenta activa, que es el caso de casi todo
   *  el mundo, y la verdad sigue estando en el diálogo de confirmación. */
  estadoBaja: EstadoBaja | null;
  /** Tarjetas que arma la página (servidor) y que este componente COLOCA.
   *  Entran como props en vez de detrás del componente porque su sitio dentro
   *  de la pantalla es una decisión de diseño, no un "y además". */
  calendario: React.ReactNode;
  referidos: React.ReactNode;
}) {
  const router = useRouter();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  // RV-14 · Errores por campo. Dos formularios distintos, un solo estado: sus
  // claves no se pisan y así el reset de uno no toca al otro.
  const [errores, setErrores] = useState<
    Partial<Record<"full_name" | "password" | "confirm", string>>
  >({});

  // La foto se guarda al instante: AvatarUpload sube al bucket y devuelve la
  // ruta; aquí se apunta `profiles.avatar_path` (no hay "submit" como en el
  // onboarding).
  async function onAvatarUploaded(path: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_path: path })
      .eq("id", userId);
    if (error) {
      toast.error("No se pudo guardar la foto.");
      return;
    }
    toast.success("Foto actualizada.");
    router.refresh();
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = new FormData(e.currentTarget);
    const full_name = String(form.get("full_name") ?? "").trim();
    const tz = String(form.get("timezone") ?? "UTC");

    const fallo = requiredError(full_name, "Escribe tu nombre.");
    setErrores((prev) => ({ ...prev, full_name: fallo ?? undefined }));
    if (fallo) {
      document.getElementById("full_name")?.focus();
      return;
    }

    setSavingProfile(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: full_name || null, timezone: tz })
      .eq("id", userId); // RLS profiles_update_own ya limita a la fila propia.

    if (error) {
      toast.error("No se pudo guardar el perfil. Intenta de nuevo.");
      setSavingProfile(false);
      return;
    }
    toast.success("Perfil actualizado.");
    setSavingProfile(false);
    router.refresh();
  }

  async function savePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = e.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    // RV-12 · Mínimo 8 (`PASSWORD_MIN`), validado también aquí: el `minLength`
    // del HTML no se cumple en un submit programático.
    const fallos = {
      password: passwordError(password) ?? undefined,
      confirm:
        !password || password === confirm
          ? undefined
          : "Las contraseñas no coinciden.",
    };
    setErrores((prev) => ({ ...prev, ...fallos }));
    if (fallos.password || fallos.confirm) {
      document.getElementById(fallos.password ? "password" : "confirm")?.focus();
      return;
    }

    setSavingPassword(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      // El servidor de Auth tiene su propia política (longitud mínima del
      // panel de Supabase): puede rechazar lo que aquí pasó.
      const msg = "No se pudo cambiar la contraseña. Intenta de nuevo.";
      setErrores((prev) => ({ ...prev, password: msg }));
      toast.error(msg);
      setSavingPassword(false);
      return;
    }
    toast.success("Contraseña actualizada.");
    form.reset();
    setErrores((prev) => ({ ...prev, password: undefined, confirm: undefined }));
    setSavingPassword(false);
  }

  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // §7.2 · La ayuda de la zona horaria dice LA HORA QUE ES AHÍ, y eso obliga a
  // dos cosas. Una, calcularla después de montar: el servidor no sabe qué hora
  // es en la zona de quien mira, así que pintarla en el HTML sería un desajuste
  // de hidratación seguro. Dos, seguir al `select` sin esperar a «Guardar
  // cambios»: la frase es justo lo que deja comprobar que elegiste bien ANTES
  // de guardar, y para eso tiene que moverse al cambiar la zona.
  const [zona, setZona] = useState(timezone);
  const [ahora, setAhora] = useState<string | null>(null);

  useEffect(() => {
    const pinta = () => setAhora(horaEnZona(zona, formato));
    // ⚠️ La primera puesta en hora va en un `setTimeout(…, 0)` y NO en un
    // `pinta()` suelto dentro del efecto: eso último es justo lo que prohíbe
    // `react-hooks/set-state-in-effect` (React 19). Mismo patrón —y mismo
    // motivo— que `HoldCountdown` en el checkout.
    const primera = setTimeout(pinta, 0);
    // El minuto avanza solo: una hora congelada en una pestaña abierta toda la
    // tarde miente más que no ponerla.
    const id = setInterval(pinta, 30_000);
    return () => {
      clearTimeout(primera);
      clearInterval(id);
    };
    // `formato` entra en las dependencias porque `pinta` lo lee: el conmutador
    // 12/24 h hace `router.refresh()`, que en un componente de cliente ya
    // montado repinta con la prop nueva sin desmontar el efecto.
  }, [zona, formato]);

  // §7.4 · Los bloqueos de la baja, EN LA TARJETA y no solo dentro del diálogo.
  //
  // ⚠️ Sin consulta nueva: `page.tsx` ya lee `my_account_deletion_state` en cada
  // carga —lo necesita para saber si la cuenta está desactivada— y de ahí salen
  // los dos grupos. Los textos son los MISMOS del diálogo a propósito (viven en
  // `baja.ts`): dos versiones de tu propia situación no se pueden reconciliar
  // leyendo.
  //
  // ⚠️ `estadoBaja` puede ser `null` si la RPC falló. Entonces no hay bloqueos
  // que enseñar y el botón queda ACTIVO: la comprobación de verdad la hace el
  // diálogo al abrirse y el servidor al confirmar, así que un fallo de lectura
  // no puede saltarse nada — solo deja de avisar antes de tiempo.
  const motivos = explicarAccionables(estadoBaja?.accionables ?? {});
  const enVuelo = hayDineroEnVuelo(estadoBaja?.en_espera ?? {});
  const espera = explicarEnEspera(estadoBaja?.en_espera ?? {});
  const bloqueada = motivos.length > 0;

  // ¿Le hablamos como a un tutor? UNA sola puerta para las dos cosas de esta
  // pantalla que dependen de ello: qué avisos por correo recibe y si su zona
  // horaria decide además su país de pago.
  //
  // ⚠️ Y NO es `isTutor`. El rol `tutor` solo llega al APROBAR (US-1101), y las
  // dos cosas empiezan ANTES:
  //
  //   · los avisos del trámite —«Documentos recibidos» y «Respuesta a tu
  //     solicitud»— se los mandamos justo a quien todavía no tiene el rol;
  //   · el país de pago también: el disparador de `20260908130000` escribe
  //     `tutor_profiles.payout_country` en CUALQUIER fila de esa tabla con esa
  //     persona (`where profile_id = new.id`), sin mirar `approval_status`.
  //
  // Con `isTutor` a secas, un tutor en revisión veía la lista de avisos de
  // tutor y, en la columna de al lado, la frase de alumno sin «tu país de
  // pago» — que en su caso ya es verdad.
  const haEmpezadoComoTutor = isTutor || tutorStatus !== null;
  const avisos = [
    ...(haEmpezadoComoTutor ? AVISOS_TUTOR : AVISOS_ALUMNO),
    ...AVISOS_COMUNES,
  ];

  return (
    /* ── EL ORDEN DE LA PANTALLA (§7 del paquete aprobado) ───────────────────
     *
     * ⚠️ YA NO ES UN MOSAICO QUE SE REPARTE SOLO, y el comentario largo que
     * había aquí describía justo eso. El paquete FIJA qué va en cada columna
     * —izquierda «Información personal»; derecha «Contraseña» y debajo «Avisos
     * por correo»— y una rejilla de flujo automático no lo puede garantizar:
     * bastaba que una tarjeta cambiara de alto para que «Avisos» saltara a la
     * izquierda. Por eso la derecha es una PILA explícita, no una celda más.
     *
     * Lo que sí sigue siendo variable —«Tu perfil de tutor», «Invita y gana»
     * (que renderiza `null` para el tutor) y «Sincroniza tu calendario»— baja a
     * su propia rejilla, donde puede repartirse solo sin tocar lo que §7 fija.
     * Ninguna de las tres está en el paquete, así que se conservan tal cual.
     *
     * `items-start`: sin él cada tarjeta se estira hasta la altura de su fila y
     * las cortas salen con medio palmo de vacío DENTRO.
     *
     * ⚠️ `[&>*]:min-w-0` — un hijo de rejilla nace con `min-width:auto` y se
     * niega a encoger por debajo del ancho intrínseco de su contenido. Sin
     * esto, la URL del feed de calendario ensancha su columna y estira el panel
     * entero (el mismo fallo que documenta `panel-shell.tsx` un nivel arriba).
     *
     * Nada de la utilidad `order`: mueve lo que se ve pero NO el orden de
     * tabulación (WCAG 2.4.3).
     *
     * ⚠️ Con las dos pilas, el tabulador recorre la columna izquierda ENTERA y
     * después la derecha; antes, con la rejilla de flujo automático, iba en
     * zigzag. Las dos cosas cumplen 2.4.3 —recorrer una columna entera preserva
     * el significado— pero conviene saberlo: aquí el orden del DOM es el visual
     * DENTRO de cada columna, no de arriba abajo cruzando las dos. Cambiarlo
     * sería mover el DOM, nunca `order`.
     */
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-5 md:grid-cols-2 [&>*]:min-w-0">
        {/* §7.2 · La izquierda es «Información personal». Debajo, y en la misma
            pila, la ficha de tutor: no está en el paquete —así que se conserva—
            y es de lo mismo, quién eres. Puesta en una fila aparte dejaba 394 px
            de hueco bajo esta columna a 1280 (medido), porque la derecha lleva
            dos tarjetas y esta una. */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* El ancla la apunta el subnivel de «Mi cuenta» en `TUTOR_ITEMS`
              (G-01). `scroll-mt-24` deja el aire de la cabecera sticky: sin él
              el título queda debajo de ella al saltar. */}
          <PanelCard id="informacion-personal" className="scroll-mt-24">
            <PanelCardTitle>Información personal</PanelCardTitle>

            {/* §7.3 · LA FOTO SUBE AQUÍ y su tarjeta suelta desaparece. Era una
                tarjeta entera para un botón, y dejaba la cara lejos del nombre al
                que pertenece. Va FUERA del `<form>` porque no se envía con él: se
                guarda sola al subir (ver `onAvatarUploaded`). */}
            <div className="mt-4">
              <AvatarUpload
                userId={userId}
                initialUrl={avatarUrl}
                name={fullName}
                large
                onUploaded={onAvatarUploaded}
              />
            </div>

            {/* `noValidate` en los dos formularios: los mensajes son nuestros y van
                bajo el campo, no en el globo del navegador (RV-14). */}
            <form onSubmit={saveProfile} noValidate className="mt-5 flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="full_name">Nombre</Label>
                <Input
                  id="full_name"
                  name="full_name"
                  defaultValue={fullName}
                  autoComplete="name"
                  required
                  aria-invalid={Boolean(errores.full_name)}
                  aria-describedby={describedBy(
                    errores.full_name && "full_name-error",
                  )}
                  placeholder="Tu nombre"
                  className="h-[45px] rounded-[8px]"
                />
                <FieldError id="full_name-error" message={errores.full_name} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  defaultValue={email}
                  disabled
                  className="h-[45px] rounded-[8px] opacity-70"
                />
                <p className="text-xs text-muted-foreground">
                  El correo no se puede cambiar aquí.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="timezone">Zona horaria</Label>
                <TimezoneSelect
                  name="timezone"
                  defaultValue={timezone}
                  /* No lo vuelve controlado: en modo no controlado el valor sigue
                     viviendo dentro y viajando en el submit. Esto solo es para
                     que la frase de abajo enseñe la hora de la zona ELEGIDA. */
                  onChange={setZona}
                  className="h-[45px] rounded-[8px]"
                />
                {/* §7.2 · la ayuda que pidió el paquete. Antes decía «Tus
                    mentorías se muestran en esta hora local», que no explicaba
                    por qué importa acertar.
                    ⚠️ Sin «y a tu país de pago» para quien no es tutor: un alumno
                    no cobra nada, y prometerle un efecto que no existe es peor
                    que callarlo. Para quien empezó el alta sí es literal —
                    `20260908130000` DEDUCE el país de pago de la zona horaria y
                    lo hace desde la primera fila de `tutor_profiles`, sin
                    esperar a la aprobación (ver `haEmpezadoComoTutor`; y DP-6:
                    si algún día se permite elegirlo aparte, esta frase cambia).
                    La hora falta en el primer render (se calcula tras montar) y
                    la frase tiene que seguir siendo una frase sin ella. */}
                <p className="text-xs text-muted-foreground">
                  {ahora ? `Ahora son las ${ahora} en tu zona. ` : ""}
                  {haEmpezadoComoTutor
                    ? "Afecta a tu horario, a las horas de tus clases, a los correos que te enviamos y a tu país de pago."
                    : "Afecta a las horas de tus clases y a los correos que te enviamos."}
                </p>
              </div>
              <Button
                type="submit"
                disabled={savingProfile}
                className="h-[45px] self-start rounded-[8px] bg-brand px-5 hover:bg-brand/90"
              >
                {savingProfile ? "Guardando…" : "Guardar cambios"}
              </Button>
            </form>
          </PanelCard>

          {/* Rol tutor · Verónica (3-sep-2026, captura 28): «si ya soy tutor no
              debería salir que quiero ser tutor; en dado caso, ver perfil de
              tutor». Hasta ahora la tarjeta miraba solo el ROL, y el rol `tutor`
              se concede al APROBAR (US-1101): a quien acababa de terminar el
              asistente —perfil pendiente— se le seguía ofreciendo «Quiero
              enseñar» hacia el asistente que ya había hecho. Tres caras, por lo
              que de verdad ha pasado:

                sin fila en `tutor_profiles`  → invitación a enseñar (lo de siempre)
                fila sin rol (pendiente…)     → «en revisión», con acceso a su panel
                rol `tutor`                   → perfil público + panel

              Un rechazado o suspendido tampoco vuelve a ver la invitación: su
              panel (`/tutor`) ya explica el motivo y cómo volver a enviarlo. Los
              botones van hug y envuelven (`flex-wrap`), como el resto de tarjetas
              de esta pantalla: a 390 los dos del tutor aprobado no caben en una
              línea y caen uno bajo otro sin estirarse. */}
          <PanelCard>
            {isTutor ? (
              <>
                <PanelCardTitle>Tu perfil de tutor</PanelCardTitle>
                <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                  Ya eres tutor. Mira cómo te ven los alumnos o gestiona tus
                  mentorías desde tu panel.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    asChild
                    variant="outline"
                    className="h-[45px] rounded-[8px] px-5"
                  >
                    <Link href={`/tutors/${userId}`}>Ver mi perfil de tutor</Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="h-[45px] rounded-[8px] px-5"
                  >
                    <Link href="/tutor">Ir a mi panel de tutor</Link>
                  </Button>
                </div>
              </>
            ) : tutorStatus ? (
              <>
                <PanelCardTitle>Tu perfil de tutor</PanelCardTitle>
                <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                  {tutorStatus === "pending"
                    ? // NTF-03 (`tutor_review_result`) manda ese correo de verdad.
                      "Está en revisión. Te avisamos por correo cuando lo aprobemos."
                    : "No está activo. Entra a tu panel para ver el motivo y volver a enviarlo."}
                </p>
                <div className="mt-4">
                  <Button
                    asChild
                    variant="outline"
                    className="h-[45px] rounded-[8px] px-5"
                  >
                    <Link href="/tutor">Ir a mi panel de tutor</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <PanelCardTitle>Enseñar en Enséñame Ya</PanelCardTitle>
                <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                  Conviértete en tutor para empezar a ofrecer tus mentorías.
                </p>
                <div className="mt-4">
                  <Button
                    asChild
                    variant="outline"
                    className="h-[45px] rounded-[8px] px-5"
                  >
                    <Link href="/tutor/onboarding">Quiero enseñar</Link>
                  </Button>
                </div>
              </>
            )}
          </PanelCard>
        </div>

        {/* §7.2 · La columna derecha es una PILA, no dos celdas sueltas: el
            paquete pide «Contraseña» y DEBAJO «Avisos por correo», y en una
            rejilla automática eso dependería de las alturas. */}
        <div className="flex min-w-0 flex-col gap-5">
          <PanelCard id="contrasena" className="scroll-mt-24">
            <PanelCardTitle>Contraseña</PanelCardTitle>
            <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
              Cambia tu contraseña cuando lo necesites.
            </p>
            <form onSubmit={savePassword} noValidate className="mt-4 flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="password">Nueva contraseña</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN}
                  aria-invalid={Boolean(errores.password)}
                  aria-describedby={describedBy(
                    "password-hint",
                    errores.password && "password-error",
                  )}
                  className="h-[45px] rounded-[8px]"
                />
                <p id="password-hint" className="text-xs text-muted-foreground">
                  Mínimo {PASSWORD_MIN} caracteres.
                </p>
                <FieldError id="password-error" message={errores.password} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="confirm">Repite la contraseña</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={PASSWORD_MIN}
                  aria-invalid={Boolean(errores.confirm)}
                  aria-describedby={describedBy(errores.confirm && "confirm-error")}
                  className="h-[45px] rounded-[8px]"
                />
                <FieldError id="confirm-error" message={errores.confirm} />
              </div>
              <Button
                type="submit"
                disabled={savingPassword}
                className="h-[45px] self-start rounded-[8px] px-5"
              >
                {savingPassword ? "Guardando…" : "Cambiar contraseña"}
              </Button>
            </form>
          </PanelCard>

          {/* §7.2 · «Avisos por correo» — ver el comentario de AVISOS_COMUNES:
              la lista es la real, las píldoras NO son interruptores, y el
              porqué es DP-4. */}
          <PanelCard id="avisos" className="scroll-mt-24">
            <PanelCardTitle>Avisos por correo</PanelCardTitle>
            {/* ⚠️ «como tutor» / «como alumno», y no «hoy» a secas: la lista es
                la del ROL que mira (ver `haEmpezadoComoTutor`), así que sin esa
                coletilla la frase era falsa para un tutor que además reserva
                mentorías —le faltarían sus cinco avisos de alumno—. Acotar el
                subtítulo lo arregla sin meter catorce filas que no se leerían. */}
            <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
              Estos son los correos que te enviamos{" "}
              {haEmpezadoComoTutor ? "como tutor" : "como alumno"}. Todavía no se
              pueden activar y desactivar uno a uno; llegan todos.
            </p>
            {/* `role="list"`: el reset de Tailwind pone `list-style:none` y
                Safari + VoiceOver le quitan el rol de lista a un `ul` sin
                viñeta, así que las nueve filas se anunciarían sueltas, sin
                «lista de 9 elementos». */}
            <ul role="list" className="mt-3 divide-y divide-[#ebebeb]">
              {avisos.map((aviso) => (
                <li
                  key={aviso}
                  /* `py-2.5` y no `py-3`: la fila mide lo que la píldora (26 px,
                     que los decide `StatusPill`, N-15), y con nueve avisos cada
                     4 px de más son 36 de columna descuadrada. */
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <span className="min-w-0 text-[13px] text-[#333333]">
                    {aviso}
                  </span>
                  {/* «Siempre» y no «Sí»: «Sí» es media respuesta a una
                      pregunta que aquí no se puede contestar que no. */}
                  <StatusPill tone="green">Siempre</StatusPill>
                </li>
              ))}
            </ul>
          </PanelCard>
        </div>
      </div>

      {/* «Invita y gana» — no está en el paquete, así que se conserva. Va en
          media fila y no a ancho completo: es una tarjeta de cuatro líneas y
          estirada a 944 px se queda vacía por dentro.
          `empty:hidden` se queda, pero ya no protege de nada: desde Referidos
          v2 (11-sep-2026) `ReferralCard` devuelve SIEMPRE una tarjeta — la
          pantalla `/referidos` existe para todo el mundo y las campañas se
          deciden en `/admin/referidos`, no por variable de entorno. Lo que
          decía este comentario —que el tutor no tenía campaña porque faltaba
          `NEXT_PUBLIC_REFERRAL_URL_TUTOR`— es falso por partida triple: la
          variable ya no existe, la campaña de tutores es la 50784 y está en el
          seed, y la tarjeta no puede renderizar `null`. Se deja el `empty:hidden`
          porque cuesta cero y cubre a quien vacíe esta rejilla mañana. */}
      <div className="grid items-start gap-5 empty:hidden md:grid-cols-2 [&>*]:min-w-0">
        {referidos}
      </div>

      {/* EY-188, a ancho completo: entrega una URL larga que hay que poder leer
          y copiar, con «Copiar» al lado y dos botones de calendario —en media
          columna eso se apelotona—, y es la única tarjeta que CAMBIA de altura
          al activar el enlace. */}
      {calendario}

      {/* §7.4 · «Sesión» y «Eliminar mi cuenta», a ancho completo, apiladas y en
          este orden. Antes «Sesión» era media fila y la baja caía donde le
          tocara según cuántas tarjetas hubiera delante. */}
      <PanelCard>
        <PanelCardTitle>Sesión</PanelCardTitle>
        <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
          Cierra la sesión en este dispositivo.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => setSignOutOpen(true)}
            className="h-[45px] rounded-[8px] px-5 text-[#bf3333]"
          >
            Cerrar sesión
          </Button>
        </div>
        <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen} />
      </PanelCard>

      {/* EY-192 · baja de cuenta. Va la última y en su propio módulo: es la
          única acción irreversible de la pantalla, y no debe compartir tarjeta
          con «Cerrar sesión», que es justo la que se le parece y no lo es.

          El tinte y el borde salen de `--destructive`, ya en uso para lo mismo
          en el carrito; no es un lenguaje nuevo.

          ⚠️ §7.4 · EL TEXTO YA NO VA A LA IZQUIERDA CON EL BOTÓN A LA DERECHA.
          Los bloqueos se leen ANTES de pulsar, así que tienen que estar encima
          del botón: en dos columnas quedaban al lado y se podía pulsar sin
          haberlos mirado.

          ⚠️ LA MISMA CASILLA TIENE DOS CARAS desde `20260831160000`. Si la baja
          ya está pedida y la cuenta está desactivada esperando a que se mueva
          el dinero, aquí va `DeactivatedCard` en vez del botón: sería absurdo
          ofrecer «Eliminar mi cuenta» a quien ya lo pidió. Ocupan el mismo
          sitio a propósito — el estado de tu cuenta se lee donde estaba el
          botón, no en un aviso nuevo en otra parte de la pantalla. */}
      {estaDesactivada(estadoBaja) && estadoBaja ? (
        <DeactivatedCard estado={estadoBaja} isTutor={isTutor} />
      ) : (
        <PanelCard className="border-destructive/30 bg-destructive/[0.03]">
          <PanelCardTitle>Eliminar mi cuenta</PanelCardTitle>
          <p className="mt-0.5 max-w-[720px] text-[13px] text-[#6b6b6b]">
            Borramos tu nombre, tu foto y tus datos de contacto, y cerramos tu
            acceso. Tus reservas y pagos se conservan por obligación legal, y
            tus reseñas quedan publicadas sin tu nombre. No se puede deshacer.
          </p>

          {/* §7.4 · LOS BLOQUEOS, ANTES DEL BOTÓN.
              ⚠️ Son DOS COSAS DISTINTAS y el código las distingue desde
              `20260831160000`, aunque el diseño aprobado las junte en una sola
              frase («tienes 2 clases confirmadas y $ 157,50 sin pagar»):

                · `accionables` (clases vendidas sin impartir) → los cierra la
                  persona, nadie más. Impiden pedir la baja y por eso apagan el
                  botón.
                · `en_espera` (saldo, retiro o reembolso en curso) → NO impiden
                  nada: desactivan la cuenta y un job la borra sola después.

              TODO · DP-5 — el paquete pide bloquear también con dinero
              pendiente («espera el pago del lunes; después podrás eliminarla»),
              que es lo contrario de lo que hace la migración. Es decisión de
              producto (¿se bloquea hasta el último pago, o se permite y se paga
              después?) y cambiarlo toca el SQL, no esta pantalla: hasta que se
              responda se enseña lo que de verdad va a pasar. */}
          {bloqueada ? (
            /* `id`: el botón lo apunta con `aria-describedby`, para que quien
               llega con teclado o lector oiga POR QUÉ no puede pulsarlo sin
               tener que ir a buscarlo. */
            <div
              id="bloqueos-baja"
              className="mt-4 max-w-[720px] rounded-[8px] border border-destructive/30 bg-card p-4"
            >
              <p className="text-[13px] font-medium text-[#bf3333]">
                Antes de poder borrarla:
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
                {motivos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : enVuelo ? (
            <div className="mt-4 max-w-[720px] rounded-[8px] border border-[#e0e0e0] bg-card p-4">
              <p className="text-[13px] font-medium text-[#19191f]">
                Tu cuenta no se borrará hoy
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-[#6b6b6b]">
                {espera.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-[#6b6b6b]">
                Se desactiva ahora y se borra sola en cuanto ese dinero termine
                de moverse. No tendrás que volver a hacer nada.
              </p>
            </div>
          ) : (
            // La media frase que evita la sorpresa cuando hoy no hay nada en
            // vuelo: quien tenga un reembolso mañana pulsa esperando que su
            // cuenta desaparezca hoy.
            <p className="mt-2 max-w-[720px] text-[13px] text-[#6b6b6b]">
              Si tienes saldo, un retiro o un reembolso en curso, tu cuenta se
              desactiva primero y se borra sola en cuanto ese dinero termine de
              moverse.
            </p>
          )}

          <div className="mt-4">
            {/* ⚠️ `aria-disabled` y NO `disabled`. Un botón `disabled` no recibe
                foco: quien navega con teclado —o con lector de pantalla— pasaba
                de largo sin enterarse de que el botón existe ni de por qué no
                se puede pulsar, porque el motivo vivía en un `title` que solo
                lee el ratón. Así el botón sigue en el recorrido, se anuncia
                «no disponible» y `aria-describedby` le ata la caja de bloqueos
                que está justo encima.

                El clic se corta en el `onClick` (la barrera de verdad son el
                diálogo y el servidor, que vuelven a comprobarlo). El aspecto
                apagado lo pone `aria-disabled:opacity-50`, y el hover se
                neutraliza a propósito: un botón que se ilumina al pasar por
                encima promete que se puede pulsar. `pointer-events-none` NO,
                que también se llevaría el `title`. */}
            <Button
              variant="destructive"
              onClick={() => {
                if (bloqueada) return;
                setDeleteOpen(true);
              }}
              aria-disabled={bloqueada}
              aria-describedby={bloqueada ? "bloqueos-baja" : undefined}
              title={
                bloqueada
                  ? "Todavía no puedes darte de baja: resuelve lo de arriba."
                  : undefined
              }
              className="h-[45px] rounded-[8px] px-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-destructive/10"
            >
              {/* «Eliminar cuenta» y no «Eliminar mi cuenta»: el botón repetía
                  palabra por palabra el título de su propia tarjeta, así que un
                  lector decía «Eliminar mi cuenta, encabezado… Eliminar mi
                  cuenta, botón». La captura de §7.4 las distingue igual. */}
              Eliminar cuenta
            </Button>
          </div>

          <DeleteAccountDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            email={email}
            isTutor={isTutor}
          />
        </PanelCard>
      )}
    </div>
  );
}
