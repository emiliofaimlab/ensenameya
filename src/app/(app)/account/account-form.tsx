"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { SignOutDialog } from "@/components/layout/sign-out-dialog";

import { createClient } from "@/lib/supabase/client";
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
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { DeactivatedCard } from "./deactivated-card";
import { estaDesactivada, type EstadoBaja } from "./baja";

/**
 * US-104 (SCR-G03) — "Mi cuenta" en módulos (24-jul): foto, información
 * personal (nombre, correo, zona horaria), contraseña, rol tutor y sesión.
 * Todo por RLS (`profiles_update_own` / auth propio); nada privilegiado.
 *
 * 27-ago · Mosaico de dos columnas. Las tarjetas eran ocho apiladas a todo el
 * ancho y la pantalla se hacía interminable. Ver el comentario largo del
 * `return`: el orden de las tarjetas ES el diseño.
 */
export function AccountForm({
  userId,
  email,
  fullName,
  timezone,
  avatarUrl,
  isTutor,
  estadoBaja,
  calendario,
  referidos,
}: {
  userId: string;
  email: string;
  fullName: string;
  timezone: string;
  avatarUrl: string | null;
  isTutor: boolean;
  /** Estado de baja de la cuenta (`my_account_deletion_state`). `null` si la
   *  consulta falló: se pinta como cuenta activa, que es el caso de casi todo
   *  el mundo, y la verdad sigue estando en el diálogo de confirmación. */
  estadoBaja: EstadoBaja | null;
  /** Tarjetas que arma la página (servidor) y que este mosaico COLOCA.
   *  Entran como props en vez de detrás del componente porque su sitio dentro
   *  de la rejilla es una decisión de diseño, no un "y además". */
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

  return (
    /* ── EL MOSAICO ─────────────────────────────────────────────────────────
     *
     * ⚠️ EL NÚMERO DE TARJETAS NO ES FIJO, así que NO hay reparto a mano en dos
     * columnas. «Invita y gana» devuelve `null` cuando su campaña no está
     * configurada —hoy SIEMPRE para el tutor, que no tiene
     * `NEXT_PUBLIC_REFERRAL_URL_TUTOR` porque esa campaña no existe (ver
     * `lib/referral.ts`)— de modo que esta misma pantalla se ve con 7 tarjetas y
     * con 8. Con un reparto escrito a mano, la columna que perdiera la suya
     * quedaría coja; con la rejilla, la siguiente sube sola a su hueco. Lo único
     * atado son los dos `md:col-span-2`: son FILAS ENTERAS, y una fila entera da
     * igual cuántas tarjetas la precedan.
     *
     * ⚠️ ALTURAS MUY DISPARES. Las dos tarjetas altas son formularios
     * («Información personal» y «Contraseña») y el resto son cortas. En una
     * rejilla la fila mide lo que su tarjeta más alta, así que una alta al lado
     * de una corta deja un hueco enorme. Por eso el ORDEN del DOM empareja
     * alta con alta y corta con corta — no es el orden viejo, es el diseño.
     * Y por eso «Sincroniza tu calendario» va a ancho completo: es la única cuya
     * altura CAMBIA (se dispara al activar el enlace) y la única que necesita
     * sitio para una URL larga y tres botones.
     *
     * `items-start`: sin él cada tarjeta se estira hasta la altura de su fila y
     * «Sesión» saldría con medio palmo de vacío DENTRO. Preferimos el hueco
     * entre tarjetas al hueco dentro de una.
     *
     * `md:` y no `sm:`: a 640 px cada columna se quedaría en ~296 px, más
     * estrecha que un móvil, y aquí hay formularios con campos de 45 px, no las
     * cifras sueltas de `/admin`. Ojo con la intuición: la columna es MÁS
     * estrecha en `lg` (~332 px) que en `md` (~348 px), porque en `lg` aparece
     * el menú lateral de 232.
     *
     * ⚠️ `[&>*]:min-w-0` — un hijo de rejilla nace con `min-width:auto` y se
     * niega a encoger por debajo del ancho intrínseco de su contenido: el mismo
     * fallo que `panel-shell.tsx` documenta para la columna de contenido, un
     * nivel más abajo. Sin esto, la URL del feed de calendario ensancharía su
     * columna y volvería a estirar el panel entero.
     *
     * ⚠️ Nada de `columns-2` de CSS: parte una tarjeta entre dos columnas y
     * descoloca el tabulador. Y nada de la utilidad `order`: mueve lo que se ve
     * pero NO el orden de tabulación (WCAG 2.4.3). Orden del DOM = orden visual.
     */
    <div className="grid items-start gap-5 md:grid-cols-2 [&>*]:min-w-0">
      {/* Fila 1 · las dos altas juntas: es lo que la gente viene a tocar y es
          el único par que se equilibra solo. */}
      {/* Información personal */}
      <PanelCard>
        <PanelCardTitle>Información personal</PanelCardTitle>
        {/* `noValidate` en los dos formularios: los mensajes son nuestros y van
            bajo el campo, no en el globo del navegador (RV-14). */}
        <form onSubmit={saveProfile} noValidate className="mt-4 flex flex-col gap-4">
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
              className="h-[45px] rounded-[8px]"
            />
            <p className="text-xs text-muted-foreground">
              Tus mentorías se muestran en esta hora local.
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

      {/* Contraseña */}
      <PanelCard>
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

      {/* Fila 2 · las dos cortas de identidad y rol. «Foto de perfil» baja
          aquí desde el primer puesto: arriba iba emparejada con un formulario
          alto y dejaba un agujero de media tarjeta debajo. */}
      {/* Foto */}
      <PanelCard>
        <PanelCardTitle>Foto de perfil</PanelCardTitle>
        <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
          Se muestra en tu perfil y en tus reservas.
        </p>
        <div className="mt-4">
          <AvatarUpload
            userId={userId}
            initialUrl={avatarUrl}
            name={fullName}
            large
            onUploaded={onAvatarUploaded}
          />
        </div>
      </PanelCard>

      {/* Rol tutor */}
      <PanelCard>
        <PanelCardTitle>Enseñar en Enséñame Ya</PanelCardTitle>
        <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
          {isTutor
            ? "Ya tienes el rol de tutor activo."
            : "Conviértete en tutor para empezar a ofrecer tus mentorías."}
        </p>
        {isTutor ? null : (
          <div className="mt-4">
            <Button
              asChild
              variant="outline"
              className="h-[45px] rounded-[8px] px-5"
            >
              <Link href="/tutor/onboarding">Quiero enseñar</Link>
            </Button>
          </div>
        )}
      </PanelCard>

      {/* Fila 3 · EY-188, a ancho completo y en medio del mosaico, no al final.
          A ancho completo porque entrega una URL larga que hay que poder leer y
          copiar, con «Copiar» al lado y dos botones de calendario: en una
          columna de ~330 px eso se apelotona. Y porque es la ÚNICA tarjeta que
          cambia de altura —al activar el enlace le salen input, tres botones y
          el aviso—, así que dejarla en la rejilla metería un agujero variable
          que no se puede compensar con el orden. En medio y no al final para
          partir la columna de tarjetas pequeñas; el final es de la baja. */}
      <div className="md:col-span-2">{calendario}</div>

      {/* Fila 4 · ⚠️ `referidos` puede ser `null` (tutor, o campaña sin
          configurar). Al no pintarse no deja hueco: «Sesión» sube a su sitio y
          la fila queda con una sola tarjeta. Esto es justo lo que un reparto a
          mano no sabría hacer. */}
      {referidos}

      {/* Sesión */}
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

          ⚠️ EN UN MOSAICO ESO NO BASTA, Y POR ESO VA A ANCHO COMPLETO. Con dos
          columnas, «ser la última» ya no garantiza estar sola: con 8 tarjetas
          la fila anterior la dejaba pegada a «Cerrar sesión», y con 7 (tutor)
          caía en la columna de al lado. Una fila entera al final es lo único
          que no depende de cuántas tarjetas haya delante — que es exactamente
          el problema de esta pantalla.

          El tinte y el borde salen de `--destructive`, ya en uso para lo mismo
          en el carrito; no es un lenguaje nuevo. Y el texto va a la izquierda
          con el botón a la derecha para que la fila ancha no quede vacía.

          ⚠️ LA MISMA CASILLA TIENE DOS CARAS desde `20260831160000`. Si la baja
          ya está pedida y la cuenta está desactivada esperando a que se mueva
          el dinero, aquí va `DeactivatedCard` en vez del botón: sería absurdo
          ofrecer «Eliminar mi cuenta» a quien ya lo pidió. Ocupan el mismo
          sitio a propósito — el estado de tu cuenta se lee donde estaba el
          botón, no en un aviso nuevo en otra parte de la pantalla. */}
      {estaDesactivada(estadoBaja) && estadoBaja ? (
        <DeactivatedCard estado={estadoBaja} isTutor={isTutor} />
      ) : (
        <PanelCard className="border-destructive/30 bg-destructive/[0.03] md:col-span-2 md:mt-1">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
            <div className="md:max-w-[680px]">
              <PanelCardTitle>Eliminar mi cuenta</PanelCardTitle>
              <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                Borramos tu nombre, tu foto y tus datos de contacto, y cerramos
                tu acceso. Tus reservas y pagos se conservan por obligación
                legal, y tus reseñas quedan publicadas sin tu nombre. No se
                puede deshacer.
              </p>
              {/* La media frase que evita la sorpresa. Quien tiene un
                  reembolso en curso pulsa esperando que su cuenta desaparezca
                  hoy; que se entere aquí y no en el diálogo. */}
              <p className="mt-2 text-[13px] text-[#6b6b6b]">
                Si tienes saldo, un retiro o un reembolso en curso, tu cuenta se
                desactiva primero y se borra sola en cuanto ese dinero termine
                de moverse.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              className="h-[45px] shrink-0 self-start rounded-[8px] px-5 md:self-auto"
            >
              Eliminar mi cuenta
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
