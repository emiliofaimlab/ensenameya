"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/form/field-error";
import { AUTH_FIELD, AUTH_LABEL, AUTH_SUBMIT } from "@/components/auth/field-classes";
import { describedBy, emailError } from "@/components/form/validation";
// El buzón real del §39 del contrato, de una sola fuente (regla de oro 8).
import { COMPANY } from "@/lib/company";
import { cn } from "@/lib/utils";

/**
 * Tope de la dedicatoria, el MISMO que recorta `comprar_regalo`
 * (`nullif(left(btrim(...), 500), '')`, `20260912110000` §10).
 *
 * Se repite aquí porque el contador de caracteres tiene que decir la verdad: sin
 * él el navegador dejaría escribir 900 y el servidor guardaría 500 sin avisar,
 * o sea que la mitad de la dedicatoria desaparecería en silencio entre pulsar y
 * pagar. Si el número cambia en la migración, cambia aquí.
 */
const MAX_DEDICATORIA = 500;

type Errores = Partial<Record<"email" | "form", string>>;

/**
 * US-REG · EL FORMULARIO DEL REGALO — correo del destinatario y dedicatoria.
 *
 * ── 🔴 EL PRECIO NO VIAJA (regla de oro 2) ──────────────────────────────────
 * Se le mandan tres cosas a `comprar_regalo`: el producto, el correo y el
 * texto. Ni importe, ni moneda, ni país. El total lo congela la RPC en servidor
 * con la misma aritmética que `create_booking_line`, y el riel de cobro lo elige
 * ella por el país del COMPRADOR (dictado §1). Un formulario de regalo que
 * mandara el precio sería un regalo con el precio que ponga el navegador.
 *
 * ── ⚠️ NO SE DICE SI ESE CORREO TIENE CUENTA ────────────────────────────────
 * Ni antes ni después de enviar. La RPC tampoco lo resuelve —lo deja escrito en
 * su cuerpo: escribir `beneficiary_id` antes de cobrar convertiría esto en un
 * oráculo gratis de existencia de cuentas para cualquier dirección—. Así que
 * aquí la validación del correo es solo de FORMA (`emailError`, la misma que
 * `/signup`), y el mensaje de éxito habla del regalo, nunca de la persona.
 *
 * ── ⚠️ LOS ERRORES DE LA RPC SE TRADUCEN, NO SE REENVÍAN ────────────────────
 * `comprar_regalo` levanta excepciones con texto pensado para un humano
 * («tienes 3 regalos sin pagar…»), pero también otras que nombran estado
 * interno. Se mapean las que el comprador puede ARREGLAR y el resto cae en una
 * frase única con el error entero en consola — el mismo criterio que
 * `/api/pagos/credito` (`MENSAJE_FALLO`): hacia fuera una frase, hacia el log
 * todo.
 *
 * ── ⚠️ Y DESPUÉS DE ESTO YA HAY UNA FILA EN LA TABLA DEL DINERO ─────────────
 * `comprar_regalo` crea el `credits` en `pending_payment`. Si el navegador se
 * pierde entre esta pantalla y el pago, esa fila se queda ahí y la barre
 * `caducar_creditos()` a los 30 días; entretanto cuenta contra el tope de 3
 * regalos sin pagar y se ve —con su botón de pagar— en «Mis regalos». Por eso
 * la navegación al pago es lo ÚNICO que pasa tras la RPC: nada de trabajo
 * intermedio que pueda fallar y dejar el regalo huérfano sin que su dueño lo
 * sepa.
 */
export function FormularioDeRegalo({
  productId,
  dias,
  className,
}: {
  productId: string;
  /** Días para agendar (`gift_expiry_days()`); `null` = no se pudo leer. */
  dias: number | null;
  className?: string;
}) {
  const router = useRouter();
  // Sufijo propio en los `id`: esta tarjeta convive con la cabecera del panel y
  // con el buscador, y dos `id="email"` en el documento hacen que el `htmlFor`
  // enfoque el campo equivocado.
  const uid = useId();
  const idCampo = (base: string) => `${base}-${uid}`;

  const [enviando, setEnviando] = useState(false);
  const [dedicatoria, setDedicatoria] = useState("");
  const [errores, setErrores] = useState<Errores>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();

    // Solo la forma. Quien valida de verdad es la RPC (misma regex, en SQL).
    const fallo = emailError(email);
    if (fallo) {
      setErrores({ email: fallo });
      document.getElementById(idCampo("email"))?.focus();
      return;
    }

    setErrores({});
    setEnviando(true);

    const { data: creditId, error } = await createClient().rpc("comprar_regalo", {
      p_product_id: productId,
      p_recipient_email: email,
      // Vacío = sin dedicatoria. La RPC ya hace `nullif(btrim(...), '')`, pero
      // mandar `undefined` haría que supabase-js ni serialice el argumento y
      // entonces manda su `default null`: el mismo resultado por otro camino.
      p_message: dedicatoria.trim() || undefined,
    });

    if (error || !creditId) {
      console.error("[regalar] comprar_regalo falló:", {
        producto: productId,
        error: error?.message,
      });
      setErrores({ form: mensajeDeFallo(error?.message) });
      setEnviando(false);
      return;
    }

    /**
     * ⚠️ NO SE QUITA EL «Creando…» al navegar. `router.push` resuelve antes de
     * que la pantalla nueva esté pintada, así que un `setEnviando(false)` aquí
     * devolvería el botón a su estado normal durante la espera — y quien lo
     * pulsara otra vez crearía un SEGUNDO regalo de la misma mentoría, que es
     * justo lo que el tope de 3 sin pagar existe para que no pase en bucle.
     *
     * El destino está en `(checkout)`: el cobro del regalo va aislado como los
     * otros tres (N-37, ver `src/app/(checkout)/layout.tsx`).
     */
    router.push(`/regalar/${creditId}/pagar`);
  }

  return (
    <form onSubmit={onSubmit} noValidate className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idCampo("email")} className={AUTH_LABEL}>
          Correo de quien lo recibe
        </Label>
        <Input
          id={idCampo("email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="nombre@correo.com"
          required
          aria-invalid={errores.email ? true : undefined}
          aria-describedby={describedBy(
            errores.email && idCampo("email-error"),
            idCampo("email-pista"),
          )}
          className={AUTH_FIELD}
        />
        <FieldError id={idCampo("email-error")} message={errores.email} />
        {/*
          La pista dice lo que pasa DESPUÉS y calla lo que no se puede contar.
          No afirma ni niega que esa dirección tenga cuenta —eso es un oráculo de
          existencia— y por eso está escrita en futuro y sin condición: sirve
          igual para quien ya es usuario y para quien se registrará mañana.
        */}
        <p id={idCampo("email-pista")} className="text-[12px] text-[#6b6b6b]">
          Le escribiremos a esta dirección cuando el pago se confirme. Si aún no
          tiene cuenta, el regalo le espera: aparece en «Mis reservas» al
          registrarse con este mismo correo y confirmarlo.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={idCampo("mensaje")} className={AUTH_LABEL}>
          Dedicatoria <span className="text-[#8a8a8a]">(opcional)</span>
        </Label>
        <Textarea
          id={idCampo("mensaje")}
          name="mensaje"
          rows={4}
          maxLength={MAX_DEDICATORIA}
          value={dedicatoria}
          onChange={(e) => setDedicatoria(e.target.value)}
          placeholder="¡Felicidades! Te regalo esta mentoría para que empieces cuando quieras."
          aria-describedby={idCampo("mensaje-contador")}
          className="min-h-[104px] rounded-[10px] text-[15px]"
        />
        <p
          id={idCampo("mensaje-contador")}
          className="text-right text-[12px] text-[#8a8a8a]"
        >
          {dedicatoria.length} / {MAX_DEDICATORIA}
        </p>
      </div>

      {/* Lo último que se lee antes de pulsar, y lo repite a propósito: son las
          dos condiciones del regalo, no letra pequeña. Sin número si no se pudo
          leer `gift_expiry_days()` — mejor «caduca» que un plazo inventado. */}
      <p className="rounded-[10px] bg-muted px-3.5 py-3 text-[12.5px] text-pretty text-[#595959]">
        Al continuar pagarás el precio íntegro de la mentoría por adelantado.
        Quien la reciba elige el día y la hora con ese tutor y{" "}
        {dias === null
          ? "tiene un plazo para agendarla"
          : `tiene ${dias} días para agendarla`}{" "}
        desde que se confirme el pago.
      </p>

      <FieldError id={idCampo("form-error")} message={errores.form} />

      <Button type="submit" disabled={enviando} className={AUTH_SUBMIT}>
        {enviando ? "Creando tu regalo…" : "Continuar al pago"}
      </Button>
    </form>
  );
}

/**
 * Del error de Postgres a una frase que el comprador pueda usar.
 *
 * Solo se traducen los casos que tienen ARREGLO desde esta pantalla. El resto
 * —producto despublicado entre que se pintó y se pulsó, ruta de pago sin
 * candidatos, un fallo de red— comparten frase: los tres se resuelven igual
 * (recargar, o escribirnos) y ninguno se explica sin contar cómo funciona la
 * tabla por dentro.
 */
function mensajeDeFallo(raw: string | undefined): string {
  const m = (raw ?? "").toLowerCase();

  if (m.includes("regalarte a ti mismo")) {
    return "Ese es tu propio correo. Escribe el de la persona a la que se lo regalas.";
  }
  if (m.includes("regalar tu propia mentoría") || m.includes("regalar tu propia mentoria")) {
    return "No puedes regalar una mentoría tuya. Elige la de otro tutor.";
  }
  if (m.includes("regalos sin pagar")) {
    return "Tienes regalos sin pagar. Termina o abandona uno antes de empezar otro: los verás en «Mis regalos».";
  }
  if (m.includes("no parece un correo")) {
    return "Ese correo no parece válido. Revísalo.";
  }
  if (m.includes("necesitas iniciar sesión") || m.includes("necesitas iniciar sesion")) {
    return "Tu sesión caducó. Vuelve a entrar y repite el regalo.";
  }
  return `No pudimos crear el regalo. Recarga la página y vuelve a intentarlo; si sigue igual, escríbenos a ${COMPANY.email}.`;
}
