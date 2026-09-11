"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { PrecioEnLinea } from "@/components/precio/precio";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * ── EL SELECTOR DE CRÉDITO — lo que convierte «tengo una mentoría gratis» en
 *    «no pago» ────────────────────────────────────────────────────────────────
 *
 * Un crédito NO baja el precio: cambia quién lo financia. La pasarela cobra
 * `gross_amount - credit_amount` y `tutor_net_amount` no se toca — el tutor
 * cobra lo mismo, solo que una parte la pone el regalo o la casa. Esa es toda
 * la idea, y es la razón de que aquí no se reste nada: la aritmética vive en
 * `public.credito_aplicable()` y la escriben `aplicar_credito` / `quitar_credito`
 * (`20260912110000`, §8). Este componente PINTA lo que ellas dicen.
 *
 * ── 🔴 POR QUÉ VA ANTES DEL FORMULARIO DE PAGO Y NO AL LADO ──────────────────
 *
 * Una Session de Stripe es inmutable una vez creada. Aplicar o quitar un crédito
 * DESPUÉS de abrir el cobro deja al alumno pagando un importe que ya no es el
 * debido — era literalmente una imprenta de crédito (aplicar → abrir Session por
 * `gross − credit` → quitar → pagar la Session vieja: el crédito vuelve a
 * `active` y la reserva queda `paid`, ilimitado y desde una cuenta normal). Lo
 * cierra un marcador positivo, `payments.checkout_opened_at`/`checkout_amount`,
 * y por eso las dos RPC se NIEGAN en cuanto hay un cobro abierto por otro
 * importe. La consecuencia para la pantalla es esta: **el padre monta este
 * componente, espera a su primer `onCambio`, y SOLO ENTONCES llama a
 * `/api/pagos/checkout`.** Ese primer aviso es la señal de «ya puedes abrir el
 * cobro»; llega siempre, también cuando no hay ningún crédito y también cuando
 * la lectura falla, justo para que el padre no se quede esperando.
 *
 * ── LO QUE ESTE COMPONENTE NO HACE ──────────────────────────────────────────
 *
 * No confirma nada. Cuando `aPagar` llega a 0 no hay pasarela que abrir, pero
 * quien compra es un botón del padre contra `POST /api/pagos/credito` — un POST
 * propio a propósito, porque `/api/pagos/checkout` se dispara al ENTRAR en la
 * pantalla y confirmar ahí convertiría «mirar el precio» en «comprar».
 *
 * Y no manda importes: al servidor solo viaja un `credit_id` (regla de oro 2).
 * Todo número que se enseña aquí sale de la RPC o de una columna que escribió el
 * servidor; ninguno se calcula para decidir un cobro.
 */

/**
 * Lo que el padre necesita saber. `aPagar` es lo que queda por cobrar DESPUÉS
 * del crédito, tal como lo devuelve `aplicar_credito`:
 *
 *   · `aPagar === 0` → **no hay nada que cobrar**: el padre esconde el
 *     formulario de pago y enseña su «Confirmar» (→ `/api/pagos/credito`).
 *   · `aPagar > 0`   → es el importe que se va a cobrar por la pasarela.
 *
 * ⚠️ Es lo que la pantalla ENSEÑA, no lo que decide el cobro: quien manda sigue
 * siendo el servidor, que lo recalcula en `/api/pagos/checkout` desde la base.
 *
 * ⚠️ Y NO SE LLAMA `EstadoDelCredito` A PROPÓSITO: ese nombre se barajó para
 * `confirmar-con-credito.tsx`, que acabó exponiendo `hayQueElegirCredito`, que contesta otra pregunta («¿hay algo que elegir
 * ANTES de abrir el cobro?»). Las dos acaban en la misma pantalla, y dos tipos
 * distintos con el mismo nombre importados en el mismo fichero es una hora
 * perdida por nada. Esto es lo que CAMBIA cuando alguien pulsa.
 */
export type CambioDeCredito =
  | { tipo: "sin-credito" }
  | { tipo: "aplicado"; creditId: string; cubre: number; aPagar: number };

export type SelectorDeCreditoProps = {
  /** La reserva que se está pagando. Tiene que ser del usuario con sesión. */
  bookingId: string;
  /**
   * Se llama UNA vez al terminar la carga inicial (con el estado real, que
   * puede ser `sin-credito`) y después de cada aplicar/quitar que cambie algo.
   *
   * ⚠️ Si el padre la define en línea, que la envuelva en `useCallback` o no:
   * aquí se guarda en un ref a propósito, así que cambiar su identidad no
   * vuelve a disparar la lectura.
   */
  onCambio: (estado: CambioDeCredito) => void;
  className?: string;
};

/** Un candidato de la lista, ya cruzado con su fecha de caducidad. */
type Fila = {
  creditId: string;
  etiqueta: string;
  /** Unidades mínimas que cubriría. Solo se enseña si `usable`. */
  cubre: number;
  usable: boolean;
  /** El porqué que devuelve la RPC cuando no se puede usar. Nunca uno nuestro. */
  motivo: string | null;
  expiraEn: string | null;
};

/** El crédito que YA está aplicado a este cobro. */
type Aplicado = {
  creditId: string;
  etiqueta: string;
  cubre: number;
  aPagar: number;
};

type Lectura =
  /** No se pudo leer. Se dice; callarlo sería esconder una mentoría gratis. */
  | { tipo: "error" }
  /** No hay nada que ofrecer: sin cobro vivo o sin un solo crédito. */
  | { tipo: "vacio" }
  | { tipo: "hay"; moneda: string; aplicado: Aplicado | null; filas: Fila[] };

/**
 * Lee de la base todo lo que hace falta para pintar, en tres viajes paralelos.
 *
 * ⚠️ Hacen falta los tres y no uno: `creditos_disponibles` devuelve la
 * aritmética del canje (cuánto cubre, si se puede, y por qué no) pero **no la
 * caducidad ni la moneda** — esas salen de la vista `mis_creditos` y de
 * `payments`, que es también quien dice si este cobro sigue vivo. Los dos
 * filtros de `mis_creditos` son EXACTAMENTE los de la RPC (`destino = 'cobro'`),
 * para que lo que una devuelve la otra lo tenga.
 *
 * ⚠️ REGLA DE ORO 10 · se mira el `error` de las tres. Un `const { data } = …`
 * aquí convierte «la consulta falló» en «no tienes créditos», que es una mentira
 * creíble y silenciosa sobre dinero que alguien ya pagó.
 */
async function leerTodo(bookingId: string): Promise<Lectura> {
  const supabase = createClient();

  const [pago, disponibles, mios] = await Promise.all([
    supabase
      .from("payments")
      .select("credit_id, credit_amount, gross_amount, currency, status")
      .eq("booking_id", bookingId)
      .maybeSingle(),
    supabase.rpc("creditos_disponibles", { p_booking_id: bookingId }),
    supabase
      .from("mis_creditos")
      .select("id, kind, source, expires_at")
      .eq("destino", "cobro"),
  ]);

  if (pago.error) {
    console.error(
      "[selector-de-credito] no se pudo leer el cobro:",
      pago.error.message,
    );
    return { tipo: "error" };
  }
  if (disponibles.error) {
    console.error(
      "[selector-de-credito] creditos_disponibles falló:",
      disponibles.error.message,
    );
    return { tipo: "error" };
  }
  // Esta tercera SÍ se degrada en vez de tumbar el bloque: sin ella solo se
  // pierde la fecha de caducidad, y quedarse sin poder canjear por no saber un
  // «caduca el 3 oct» sería el remedio peor que la enfermedad.
  if (mios.error) {
    console.error(
      "[selector-de-credito] mis_creditos falló:",
      mios.error.message,
    );
  }

  // Sin fila de cobro no hay nada que financiar, y con el pago fuera de
  // `pending` las dos RPC se niegan por diseño (cerrojo 1): no se pinta un
  // selector que solo puede dar errores.
  if (!pago.data || pago.data.status !== "pending") return { tipo: "vacio" };

  // `mis_creditos` es una vista y sus columnas salen nullables; el `if (c.id)`
  // no es paranoia de tipos, es lo que deja el índice limpio.
  const extra = new Map<string, NonNullable<typeof mios.data>[number]>();
  for (const c of mios.data ?? []) {
    if (c.id) extra.set(c.id, c);
  }

  const filas: Fila[] = (disponibles.data ?? []).map((c) => ({
    creditId: c.credit_id,
    etiqueta: c.etiqueta,
    cubre: c.cubre,
    usable: c.usable,
    motivo: c.motivo ?? null,
    expiraEn: extra.get(c.credit_id)?.expires_at ?? null,
  }));

  /**
   * Rehidratación: la pestaña se recargó con un crédito ya aplicado.
   *
   * Hace falta porque un crédito aplicado ya NO sale en `creditos_disponibles`
   * (queda `consumed`, o con menos saldo): sin esto, quien recarga a mitad del
   * checkout vería el bloque vacío y no tendría por dónde quitarlo.
   *
   * ⚠️ `aPagar` sale aquí de una resta, y es la ÚNICA de todo el fichero. Las
   * dos cifras son columnas que escribió el servidor en la misma fila, y la
   * resta es carácter por carácter la que `aplicar_credito` devuelve como
   * `a_pagar` (`gross_amount - credit_amount`). No es el navegador decidiendo un
   * importe —eso lo prohíbe la regla de oro 2—: es el navegador releyendo un
   * estado que ya estaba decidido. Y no manda sobre el cobro: quien dice si hay
   * pasarela o no es `/api/pagos/checkout`, que lo recalcula desde la base.
   */
  let aplicado: Aplicado | null = null;
  if (pago.data.credit_id) {
    const suyo = extra.get(pago.data.credit_id);
    aplicado = {
      creditId: pago.data.credit_id,
      etiqueta: etiquetaDeRespaldo(suyo?.source ?? null, suyo?.kind ?? null),
      cubre: pago.data.credit_amount,
      aPagar: pago.data.gross_amount - pago.data.credit_amount,
    };
  }

  if (!aplicado && filas.length === 0) return { tipo: "vacio" };

  return { tipo: "hay", moneda: pago.data.currency, aplicado, filas };
}

/**
 * El nombre del crédito cuando no lo da `creditos_disponibles`.
 *
 * Solo se usa al rehidratar: la etiqueta bonita —el título de la mentoría
 * regalada, el `reward_text` que escribió el admin— la compone la RPC, y un
 * crédito ya consumido no pasa por ella. Se dice lo que se sabe, que es de qué
 * tipo es, en vez de inventar un texto que prometa otra cosa.
 */
function etiquetaDeRespaldo(
  source: string | null,
  kind: string | null,
): string {
  if (source === "gift") return "Tu mentoría de regalo";
  if (kind === "mentoria") return "Tu mentoría gratis";
  return "Tu saldo";
}

/**
 * «Caduca hoy» · «Caduca mañana» · «Caduca el 3 oct».
 *
 * RN-01/RN-02 · la fecha vive en UTC en la base y se lee en la hora LOCAL de
 * quien mira: aquí el navegador YA es el visitante, así que no se le pasa
 * `timeZone` (los helpers de `getViewerTimezone()` son para el servidor, que no
 * tiene reloj del usuario). La cuenta es por DÍA DE CALENDARIO local y no por
 * milisegundos: algo que vence esta noche es «hoy», no «mañana».
 *
 * Vive a nivel de módulo a propósito: leer el reloj dentro de una closure de
 * render dispara la regla de pureza de react-hooks — el mismo motivo por el que
 * `isUpcoming()` vive donde vive.
 */
function textoDeCaducidad(iso: string | null): string | null {
  if (!iso) return null;
  const cuando = new Date(iso);
  if (Number.isNaN(cuando.getTime())) return null;

  const hoy = new Date();
  const dias = Math.round(
    (Date.UTC(cuando.getFullYear(), cuando.getMonth(), cuando.getDate()) -
      Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) /
      86_400_000,
  );

  // Ya vencido: no se dice nada, porque de eso ya habla el motivo de la RPC
  // («este crédito ha caducado») y repetirlo con otra fecha confunde.
  if (dias < 0) return null;
  if (dias === 0) return "Caduca hoy";
  if (dias === 1) return "Caduca mañana";

  const mismoAno = cuando.getFullYear() === hoy.getFullYear();
  return `Caduca el ${cuando.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    ...(mismoAno ? {} : { year: "numeric" }),
  })}`;
}

/**
 * El error de la RPC, en cristiano.
 *
 * Los mensajes de `aplicar_credito`/`quitar_credito` están escritos para quien
 * lee el esquema («ya hay un cobro abierto para esta reserva por otro importe»,
 * y un `hint` que habla de cerrar checkouts): dicen la verdad, pero no la del
 * alumno. Casi todos se arreglan igual —recargar— y eso es lo que se dice.
 *
 * El del cerrojo es el importante: significa que el formulario de pago YA se
 * abrió, así que el crédito no se puede tocar sin volver a empezar.
 */
function enCristiano(mensaje: string): string {
  if (/cobro abierto/i.test(mensaje)) {
    return "Tu pago ya se abrió con otro importe. Recarga la página para cambiar tu crédito.";
  }
  if (/ya tiene un crédito/i.test(mensaje)) {
    return "Esta reserva ya tiene un crédito aplicado. Recarga la página para verlo.";
  }
  if (/ya está en/i.test(mensaje)) {
    return "Este pago ya no admite cambios. Recarga la página para ver cómo quedó.";
  }
  if (/crédito no disponible/i.test(mensaje)) {
    return "Ese crédito ya no está disponible. Abajo tienes los que te quedan.";
  }
  if (/iniciar sesión/i.test(mensaje)) {
    return "Tu sesión caducó. Vuelve a entrar para usar tu crédito.";
  }
  if (/no tiene cobro|reserva no encontrada/i.test(mensaje)) {
    return "No encontramos el cobro de esta reserva. Recarga la página.";
  }
  return "No pudimos aplicar tu crédito. Recarga la página e inténtalo de nuevo.";
}

/** Lee un número de la respuesta `jsonb` de la RPC sin fiarse de su forma. */
function numeroDe(json: unknown, clave: string): number | null {
  if (typeof json !== "object" || json === null) return null;
  const v = (json as Record<string, unknown>)[clave];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function SelectorDeCredito({
  bookingId,
  onCambio,
  className,
}: SelectorDeCreditoProps) {
  /**
   * La lectura, ETIQUETADA con la reserva de la que salió. `null` = todavía no
   * hay ninguna, o sea «cargando» (ver la nota de «no pintar nada» de abajo).
   *
   * ⚠️ Lleva la etiqueta dentro en vez de reiniciarse desde el efecto, y no es
   * cosmético: un `setLectura(null)` síncrono en el cuerpo de un efecto es una
   * cascada de renders y lo canta `react-hooks/set-state-in-effect`. Con la
   * etiqueta, cambiar de reserva invalida la lectura vieja SOLA
   * (`de !== bookingId` → se pinta nada, que es lo correcto) sin tocar el estado
   * dos veces ni arriesgarse a enseñar los créditos de otra reserva.
   */
  const [lectura, setLectura] = useState<{ de: string; l: Lectura } | null>(
    null,
  );
  /** El `credit_id` que se está aplicando, o "quitar". Nada de optimismo. */
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const tituloId = useId();

  /**
   * ⚠️ EL CANDADO DEL DOBLE CLIC ES UN `ref`, NO EL `disabled` DEL BOTÓN.
   * `disabled` depende de que React haya repintado, y un doble clic rápido cabe
   * entero antes de ese repintado. Aquí eso no es un pulso de más inofensivo: la
   * segunda llamada a `aplicar_credito` se encuentra el cerrojo 3 («esta reserva
   * ya tiene un crédito aplicado») y la persona LEE UN ERROR justo después de
   * haber canjeado bien. Es el mismo candado que lleva `ConfirmarConCredito`.
   */
  const enVuelo = useRef(false);

  /** Suelta el candado y apaga el «Aplicando…». Las dos cosas, siempre juntas. */
  function terminar() {
    enVuelo.current = false;
    setTrabajando(null);
  }

  // La identidad de `onCambio` no tiene que reiniciar la lectura: el padre
  // probablemente la redefine en cada render.
  const onCambioRef = useRef(onCambio);
  useEffect(() => {
    onCambioRef.current = onCambio;
  }, [onCambio]);

  /** Pinta una lectura y le cuenta al padre lo que hay que cobrar. */
  const asentar = useCallback((de: string, l: Lectura) => {
    setLectura({ de, l });
    onCambioRef.current(
      l.tipo === "hay" && l.aplicado
        ? {
            tipo: "aplicado",
            creditId: l.aplicado.creditId,
            cubre: l.aplicado.cubre,
            aPagar: l.aplicado.aPagar,
          }
        : // También cuando la lectura falla: el padre necesita su señal para
          // abrir el cobro, y sin crédito aplicado lo que se cobra es el bruto,
          // que él ya tiene. Dejarlo esperando sería una pantalla muerta.
          { tipo: "sin-credito" },
    );
  }, []);

  useEffect(() => {
    let vivo = true;
    void leerTodo(bookingId).then((l) => {
      if (vivo) asentar(bookingId, l);
    });
    return () => {
      vivo = false;
    };
  }, [bookingId, asentar]);

  async function usar(fila: Fila) {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setAviso(null);
    setTrabajando(fila.creditId);
    const supabase = createClient();
    // 🔴 Al servidor solo viaja el `credit_id`. Cuánto cubre lo recalcula la RPC
    // desde `payments.gross_amount` y el propio crédito, los dos ya bloqueados
    // (regla de oro 2).
    const { data, error } = await supabase.rpc("aplicar_credito", {
      p_booking_id: bookingId,
      p_credit_id: fila.creditId,
    });

    if (error) {
      setAviso(enCristiano(error.message));
      // Se vuelve a leer: si el mundo cambió entre pintar y pulsar, el motivo
      // de verdad aparece al lado de su crédito en vez de solo en el aviso.
      asentar(bookingId, await leerTodo(bookingId));
      terminar();
      return;
    }

    const cubre = numeroDe(data, "credit_amount");
    const aPagar = numeroDe(data, "a_pagar");

    if (cubre === null || aPagar === null) {
      // La RPC hizo su trabajo aunque no entendamos su respuesta. Se relee la
      // base en vez de inventar un importe.
      console.error(
        "[selector-de-credito] aplicar_credito devolvió algo inesperado:",
        data,
      );
      asentar(bookingId, await leerTodo(bookingId));
      terminar();
      return;
    }

    // No hace falta releer: los dos números salen de la RPC que acaba de
    // escribirlos, que es justo lo que manda la regla (el importe se enseña tal
    // como lo devuelve el servidor, nunca restándolo aquí).
    setLectura((prev) =>
      prev && prev.de === bookingId && prev.l.tipo === "hay"
        ? {
            de: prev.de,
            l: {
              ...prev.l,
              aplicado: {
                creditId: fila.creditId,
                etiqueta: fila.etiqueta,
                cubre,
                aPagar,
              },
            },
          }
        : prev,
    );
    onCambioRef.current({
      tipo: "aplicado",
      creditId: fila.creditId,
      cubre,
      aPagar,
    });
    terminar();
  }

  async function quitar() {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setAviso(null);
    setTrabajando("quitar");
    const supabase = createClient();
    const { error } = await supabase.rpc("quitar_credito", {
      p_booking_id: bookingId,
    });

    if (error) {
      setAviso(enCristiano(error.message));
      asentar(bookingId, await leerTodo(bookingId));
      terminar();
      return;
    }

    // Aquí sí se relee entera: el crédito vuelve a estar vivo y su `cubre` puede
    // ser otro (un saldo parcial recupera lo que había puesto).
    asentar(bookingId, await leerTodo(bookingId));
    terminar();
  }

  /**
   * ⚠️ MIENTRAS CARGA NO SE PINTA NADA, y tampoco cuando no hay ni un crédito.
   * Quien no tiene ninguno —que son casi todos— tiene que ver la pantalla de
   * pago EXACTAMENTE como está hoy: ni un bloque vacío, ni un «no tienes
   * créditos», ni un parpadeo de «buscando…» antes de nada.
   *
   * Los que NO se pueden usar sí se pintan, con el motivo que da la RPC. No es
   * una contradicción con lo anterior: un premio invisible es un premio que
   * caduca a los 30 días sin que su dueño sepa por qué, y esa es justo la razón
   * de que `creditos_disponibles` se moleste en devolverlos.
   */
  // Una lectura de OTRA reserva no vale: cuenta como «todavía no hay ninguna».
  const actual = lectura && lectura.de === bookingId ? lectura.l : null;

  if (actual === null || actual.tipo === "vacio") return null;

  if (actual.tipo === "error") {
    // No se calla (regla de oro 10). Es raro y es mejor que el silencio: aquí
    // el silencio se lleva por delante una mentoría que alguien ya pagó.
    return (
      <p role="alert" className={cn("text-[13px] text-[#6b6b6b]", className)}>
        No pudimos comprobar si tienes créditos para esta mentoría. Recarga la
        página.
      </p>
    );
  }

  const { moneda, aplicado, filas } = actual;
  const ocupado = trabajando !== null;
  const hayUsables = filas.some((f) => f.usable);

  return (
    <section
      aria-labelledby={tituloId}
      aria-busy={ocupado}
      className={cn(
        "rounded-[16px] border border-[#e0e0e0] bg-card p-4",
        className,
      )}
    >
      <h3 id={tituloId} className="text-[15px] font-semibold text-[#19191f]">
        {aplicado || filas.length === 1 ? "Tu crédito" : "Tus créditos"}
      </h3>
      <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
        {aplicado
          ? "Ya está aplicado a esta reserva."
          : hayUsables
            ? "Aplícalo antes de pagar: solo se cobra la diferencia."
            : "Ninguno se puede usar en esta mentoría."}
      </p>

      {aplicado ? (
        <div className="mt-3 rounded-[10px] border border-brand bg-brand-muted p-3">
          <p className="text-sm font-semibold break-words text-[#19191f]">
            {aplicado.etiqueta}
          </p>
          <p className="mt-1 text-[13px] text-[#333333]">
            Cubre{" "}
            <PrecioEnLinea
              amountMinor={aplicado.cubre}
              currency={moneda}
              className="font-semibold"
            />
            {aplicado.aPagar === 0 ? (
              // El caso que da sentido a todo esto: no hay pasarela que abrir.
              // El botón de confirmar es del padre, no de aquí.
              <> · no tienes que pagar nada.</>
            ) : (
              <>
                {" "}
                · te quedan{" "}
                <PrecioEnLinea
                  amountMinor={aplicado.aPagar}
                  currency={moneda}
                  className="font-semibold"
                />{" "}
                por pagar.
              </>
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2.5 h-11 px-4"
            disabled={ocupado}
            onClick={() => void quitar()}
          >
            {trabajando === "quitar" ? "Quitando…" : "Quitar el crédito"}
          </Button>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {filas.map((fila) => {
            const caduca = textoDeCaducidad(fila.expiraEn);
            return (
              <li
                key={fila.creditId}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 rounded-[10px] border p-3",
                  fila.usable
                    ? "border-[#e0e0e0]"
                    : "border-[#e0e0e0] bg-muted",
                )}
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p
                    className={cn(
                      "text-sm font-medium break-words",
                      fila.usable ? "text-[#19191f]" : "text-[#6b6b6b]",
                    )}
                  >
                    {fila.etiqueta}
                  </p>
                  <p className="mt-0.5 text-[13px] text-[#6b6b6b]">
                    {fila.usable ? (
                      <>
                        Cubre{" "}
                        <PrecioEnLinea
                          amountMinor={fila.cubre}
                          currency={moneda}
                          className="font-semibold text-[#333333]"
                        />
                      </>
                    ) : (
                      // 🔴 El motivo es el que devuelve la RPC, nunca uno
                      // nuestro: si aquí dijéramos otra cosa que
                      // `credito_aplicable`, el alumno leería un porqué y se
                      // comería otro al pulsar.
                      (fila.motivo ?? "No se puede usar en esta mentoría")
                    )}
                    {caduca ? ` · ${caduca}` : ""}
                  </p>
                </div>

                {fila.usable ? (
                  <Button
                    type="button"
                    className="h-11 px-4 font-semibold"
                    disabled={ocupado}
                    aria-label={`Usar ${fila.etiqueta}`}
                    onClick={() => void usar(fila)}
                  >
                    {trabajando === fila.creditId ? "Aplicando…" : "Usar"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {aviso ? (
        <p role="alert" className="mt-2.5 text-[13px] text-destructive">
          {aviso}
        </p>
      ) : null}
    </section>
  );
}
