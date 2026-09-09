"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { LandmarkIcon, StarIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { StatusPill } from "@/components/layout/panel-shell";
import { cn } from "@/lib/utils";

/**
 * Una tarjeta de la lista, ya resuelta EN EL SERVIDOR.
 *
 * Todo lo que hay aquí dentro es texto: ni un código de país, ni una clave de
 * canal que este componente tenga que traducir. El motivo es el de siempre en
 * esta pantalla —los nombres de país arrastran el locale entero de
 * `react-phone-number-input` y las etiquetas de canal son filas de
 * `payout_manual_channels`— así que quien sabe llamarlas es el servidor.
 */
export type TarjetaMetodo = {
  /** Lo que se guarda en `tutor_payout_preferences.method`. */
  clave: string;
  nombre: string;
  /**
   * El logo OFICIAL de la marca, cuando lo hay (`logos.ts`). `null` en dos
   * casos distintos y los dos a propósito: la transferencia bancaria, que no es
   * de ninguna marca —cubre a dLocal y a Wise sin decir cuál—, y Zinli, que no
   * publica un SVG que podamos usar. Los dos caen al monograma.
   */
  logo: { src: string; color?: string } | null;
  /** El respaldo cuando no hay logo. Dos letras del propio nombre. */
  monograma: string;
  /** Una línea, o vacío si la tarjeta se explica sola. Nunca un párrafo: eso
      vive dentro del formulario, que es donde el tutor lo necesita. */
  descripcion: string;
  /** Proveedor (el job) o persona. Es lo único comparable que se puede prometer. */
  automatico: boolean;
  /** ¿Tiene ya todo lo que hace falta para cobrar por aquí? */
  listo: boolean;
  /** «Cuenta conectada · jo····@gmail.com». `null` si no hay nada guardado. */
  detalle: string | null;
  /** Un aviso propio del método (el cambio de moneda, el correo de PayPal). */
  aviso: { texto: string; tono: "warn" | "info" } | null;
  /** Media tarea suelta: hoy solo Wise pidiendo dirección y teléfono. */
  subtarea: string | null;
  /**
   * 🔑 ¿SE CONECTA EN VEZ DE RELLENARSE?
   *
   * PayPal y Stripe sí, y por eso NO tienen formulario: en los dos el dato de
   * cobro se lo da el tutor A ELLOS, no a nosotros. En PayPal escribir el correo
   * a mano llegó a ser posible y está medido lo que pasaba — cuatro pagos a un
   * correo, cuatro `UNCLAIMED`; el mismo pago a la cuenta conectada, `SUCCESS`
   * al instante— así que ofrecer las dos vías era ofrecer una que no entrega.
   *
   * Zinli, Binance y Zelle son al revés: no hay nada que conectar, solo un
   * identificador que el tutor teclea. Esos sí llevan formulario.
   */
  conectar: boolean;
};

/**
 * 🔑 «MIS CUENTAS» — las formas de cobro del tutor y cuál es la predeterminada.
 *
 * ── SE FUE EL RADIO, Y EL MOTIVO NO ES ESTÉTICO (§5.4) ──────────────────────
 *
 * Cada fila tenía DOS controles para DOS decisiones distintas —un radio a la
 * izquierda («¿es esta mi preferida?») y un botón a la derecha («¿la
 * configuro?»)— y la izquierda pesaba más que la derecha justo al revés de lo
 * que importa: una cuenta sin conectar no puede ser preferida de nada. Ahora la
 * fila enseña primero lo que hay que hacer («Conectar» / «Configurar») y la
 * preferencia es una ESTRELLA que solo existe en las cuentas ya completas.
 *
 * ── LA ESTRELLA ES UN BOTÓN CON `aria-pressed`, NO UN RADIO DISFRAZADO ──────
 *
 * Es un grupo de botones de dos estados, no un grupo de opciones excluyentes en
 * un formulario: el cambio se guarda al pulsar, no al enviar nada. `aria-pressed`
 * anuncia «predeterminada / no predeterminada» sin reimplementar el recorrido
 * con flechas que un radiogroup trae hecho y que aquí no aplica —las tarjetas
 * también llevan botón y formulario, así que el foco tiene que poder entrar en
 * ellas una por una.
 *
 * Volver a pulsar la que ya está marcada no hace nada (no la «desmarca»): sin
 * preferida el enrutador vuelve a decidir solo, y eso es un estado al que se
 * llega por no haber elegido nunca, no por deshacer.
 *
 * ── EL BOTÓN DE «CONFIGURAR» NUNCA CAMBIÓ LA PREFERENCIA ────────────────────
 *
 * Cuando el radio vivía dentro del `<label>`, un `<button>` ahí dentro habría
 * heredado su clic: pulsar «Editar» en PayPal habría cambiado la preferencia
 * sin pedirlo. Por eso iba fuera. Con el radio fuera el riesgo desaparece, pero
 * la separación se mantiene: cuál prefiero y cuál estoy rellenando siguen
 * siendo dos cosas.
 *
 * ── ELEGIR UNA SIN TERMINAR NO ROMPE NADA ───────────────────────────────────
 *
 * El enrutador REORDENA candidatos con esta preferencia y después aplica sus
 * tres filtros de siempre, así que una preferencia que hoy no puede pagar no
 * deja ninguna orden atascada: se cae al siguiente riel que sí pueda. Ya no se
 * puede llegar a ese estado desde aquí —la estrella solo sale en las completas—
 * pero sí se puede haber llegado antes (una cuenta que se desconectó después),
 * y por eso el aviso de abajo sigue existiendo.
 */
export function MetodosDeCobro({
  tarjetas,
  preferida,
  formularios,
  acciones,
}: {
  tarjetas: TarjetaMetodo[];
  /** La vigente, ya descartada si apunta a un método que este país no ofrece. */
  preferida: string | null;
  /** El formulario de cada método CON formulario, renderizado en el servidor. */
  formularios: Record<string, React.ReactNode>;
  /**
   * El botón de conectar de los que no tienen formulario. Va en la esquina
   * derecha de la tarjeta, en el sitio donde los otros tienen «Configurar»: es
   * la única acción que existe para ellos, así que esconderla detrás de un
   * desplegable sería un clic de más para llegar a lo mismo.
   */
  acciones: Record<string, React.ReactNode>;
}) {
  const router = useRouter();
  // Optimista: el radio se mueve al pulsar y no cuando vuelve el servidor. Si
  // la escritura falla se devuelve al valor anterior y se dice por qué.
  const [elegida, setElegida] = useState<string | null>(preferida);
  const [guardando, setGuardando] = useState(false);
  // Qué formulario está desplegado. Independiente del radio, a propósito.
  const [abierta, setAbierta] = useState<string | null>(null);

  async function elegir(clave: string) {
    // Volver a pulsar la estrella ya rellena no desmarca: ver la cabecera.
    if (clave === elegida) return;
    const anterior = elegida;
    setElegida(clave);
    setGuardando(true);
    // Ya no se abre ningún formulario al marcar. Antes tenía sentido —se podía
    // elegir una tarjeta a medias y lo siguiente era rellenarla—, pero la
    // estrella solo aparece en las que ya están completas: no queda nada que
    // abrir, y abrir algo sería un salto que el tutor no pidió.

    const supabase = createClient();
    const { data: sesion } = await supabase.auth.getUser();
    const uid = sesion.user?.id;
    if (!uid) {
      setElegida(anterior);
      setGuardando(false);
      toast.error("Tu sesión ha caducado. Vuelve a entrar para guardar tu elección.");
      return;
    }

    // Upsert directo y no una RPC: aquí no se guarda ni un dato de cobro, solo
    // cuál prefiere. La RLS limita a la fila propia y el `check` de formato lo
    // pone la tabla. Lo que sí es dinero —cuentas, correos— sigue entrando solo
    // por sus RPC (regla de oro 2).
    const { error } = await supabase
      .from("tutor_payout_preferences")
      .upsert({ tutor_id: uid, method: clave }, { onConflict: "tutor_id" });
    setGuardando(false);

    if (error) {
      setElegida(anterior);
      toast.error(error.message || "No se pudo guardar por dónde quieres cobrar.");
      return;
    }
    toast.success("Guardado. Lo intentaremos por ahí primero.");
    router.refresh();
  }

  const laElegida = tarjetas.find((t) => t.clave === elegida) ?? null;
  const listas = tarjetas.filter((t) => t.listo);
  // El respaldo REAL: otra que esté completa. Es lo que el enrutador haría, no
  // una promesa: si la elegida no puede pagar, el siguiente candidato de la
  // tabla que sí pueda es uno de estos.
  const respaldo = listas.find((t) => t.clave !== elegida) ?? null;

  /**
   * La única frase que se gana su sitio: la que avisa de que lo que va a pasar
   * NO es lo que el radio parece decir. Los estados evidentes —elegiste una y
   * está completa, o no has elegido y hay alguna lista— no llevan nada: eso ya
   * lo cuentan la píldora de la tarjeta y la ficha de «Cómo cobras».
   */
  const aviso =
    laElegida && !laElegida.listo
      ? respaldo
        ? `Hasta que completes ${laElegida.nombre}, te pagamos por ${respaldo.nombre}.`
        : `Completa ${laElegida.nombre} para que podamos pagarte. Tu saldo se sigue acumulando.`
      : listas.length === 0
        ? "Aún no podemos pagarte: completa una. Tu saldo se sigue acumulando."
        : null;

  return (
    <div>
      <ul aria-label="Tus cuentas de cobro" className="mt-4 grid gap-2.5">
        {tarjetas.map((t) => {
          const marcada = elegida === t.clave;
          const desplegada = abierta === t.clave;
          return (
            <li
              key={t.clave}
              // Borde neutro también en la predeterminada: quien lo dice es la
              // estrella. Un borde azul más el icono serían dos marcas para lo
              // mismo, y la azul se confundiría con «la que estoy editando».
              className="rounded-[12px] border border-[#e0e0e0] bg-card transition-colors hover:border-[#949494]"
            >
              <div className="flex flex-wrap items-center gap-3 p-3.5 sm:flex-nowrap sm:gap-4">
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                  {/* El logo OFICIAL de la marca, en SU color. El azulejo se
                      queda neutro porque un logo recoloreado deja de ser el
                      logo: lo que dice «predeterminada» es la estrella, no la
                      marca ajena.

                      ⚠️ Va con `mask` y no con `<img>`: los SVG de simple-icons
                      no traen `fill`, así que un `<img>` los pintaría negros. El
                      fichero pone la forma y `logos.ts` el color. */}
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-[#ececec] bg-[#fafafa]"
                  >
                    {t.logo && !t.logo.color ? (
                      // Logo que ya trae sus colores: se pinta tal cual. Una
                      // máscara lo aplanaría a un solo tono.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.logo.src}
                        alt=""
                        className="size-[26px] rounded-[6px]"
                      />
                    ) : t.logo ? (
                      <span
                        className="size-[22px]"
                        style={{
                          backgroundColor: t.logo.color,
                          maskImage: `url(${t.logo.src})`,
                          WebkitMaskImage: `url(${t.logo.src})`,
                          maskRepeat: "no-repeat",
                          WebkitMaskRepeat: "no-repeat",
                          maskPosition: "center",
                          WebkitMaskPosition: "center",
                          maskSize: "contain",
                          WebkitMaskSize: "contain",
                        }}
                      />
                    ) : t.clave === "banco" ? (
                      // La transferencia no es de ninguna marca: cubre a dLocal
                      // y a Wise sin decir cuál. Glifo genérico, color de la casa.
                      <LandmarkIcon className="size-[19px] text-brand" strokeWidth={1.9} />
                    ) : (
                      <span className="text-[13px] font-bold text-[#19191f]">
                        {t.monograma}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-semibold text-[#19191f]">
                        {t.nombre}
                      </strong>
                      {/* «Sin conectar» y no «Sin configurar» (§5.4): es la
                          palabra que usa la acción de la propia fila. */}
                      {t.listo ? (
                        <StatusPill tone="green">Completo</StatusPill>
                      ) : (
                        <StatusPill tone="gray">Sin conectar</StatusPill>
                      )}
                      {/* Nunca un plazo: de la velocidad de estos rieles no hay
                          ni una medida. Automático o a mano sí es un hecho. */}
                      <StatusPill tone="gray">
                        {t.automatico ? "Automático" : "Lo envía una persona"}
                      </StatusPill>
                    </span>
                    {/* Cadena vacía = esta tarjeta no necesita explicarse: su
                        nombre y sus dos píldoras ya lo dicen, y lo largo vive
                        dentro de su formulario. Sin este `if` quedaba un span
                        vacío con su margen, o sea aire de más por tarjeta. */}
                    {t.descripcion ? (
                      <span className="mt-1.5 block max-w-[56ch] text-[12.5px] leading-[1.5] text-[#4d4d4d]">
                        {t.descripcion}
                      </span>
                    ) : null}
                    {t.detalle ? (
                      <span className="mt-2 inline-block rounded-[6px] border border-[#e0e0e0] bg-muted px-2.5 py-1 text-[12.5px] tabular-nums text-[#19191f]">
                        {t.detalle}
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* 🔑 LA ESTRELLA, SOLO EN LAS CUENTAS COMPLETAS (§5.4).
                      Vacía = se puede marcar; rellena = es la predeterminada, y
                      hay una sola. En una cuenta sin conectar no se pinta: no
                      hay nada que preferir hasta que pueda cobrar. */}
                  {t.listo ? (
                    <button
                      type="button"
                      aria-pressed={marcada}
                      aria-label={
                        marcada
                          ? `${t.nombre}: es tu cuenta predeterminada`
                          : `Marcar como predeterminada: ${t.nombre}`
                      }
                      title={
                        marcada
                          ? "Es tu cuenta predeterminada. Lo intentamos por aquí primero."
                          : "Marcar como predeterminada"
                      }
                      disabled={guardando}
                      onClick={() => elegir(t.clave)}
                      className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-[8px] border transition-colors disabled:opacity-60",
                        marcada
                          ? "border-[#e8d5a8] bg-[#fdf7e6] text-[#a67314]"
                          : "border-[#e0e0e0] bg-card text-[#949494] hover:border-[#949494] hover:text-[#a67314]",
                      )}
                    >
                      <StarIcon
                        aria-hidden
                        className="size-[18px]"
                        strokeWidth={2}
                        // Rellena solo la predeterminada: es la diferencia que
                        // se lee de un vistazo en una lista de cinco.
                        fill={marcada ? "currentColor" : "none"}
                      />
                    </button>
                  ) : null}

                  {/* 🔑 Los de conectar NO despliegan nada: su única acción es
                      el botón que los lleva a PayPal o a Stripe, y va aquí,
                      donde los otros tienen «Configurar». Esconderlo detrás de
                      un desplegable sería un clic de más para llegar a lo
                      mismo. */}
                  {t.conectar ? (
                    acciones[t.clave] ?? null
                  ) : (
                    <button
                      type="button"
                      aria-expanded={desplegada}
                      onClick={() => setAbierta(desplegada ? null : t.clave)}
                      className="h-11 shrink-0 rounded-[8px] border border-[#949494] bg-card px-4 text-[13px] font-semibold text-[#19191f] transition-colors hover:bg-[#f5f5f5]"
                    >
                      {desplegada ? "Cerrar" : t.listo ? "Editar" : "Configurar"}
                    </button>
                  )}
                </div>
              </div>

              {t.aviso ? (
                <p
                  className={cn(
                    "mx-4 mb-4 max-w-[64ch] rounded-[8px] border p-3 text-[12.5px] leading-[1.55] text-[#19191f]",
                    t.aviso.tono === "warn"
                      ? "border-[#e8d5a8] bg-[#fdf7e6]"
                      : "border-[#b6dbff] bg-brand-muted",
                  )}
                >
                  {t.aviso.texto}
                </p>
              ) : null}

              {t.subtarea ? (
                <div className="mx-4 mb-4 flex flex-wrap items-center gap-3 border-t border-dashed border-[#e0e0e0] pt-3">
                  <StatusPill tone="amber">Falta un dato</StatusPill>
                  <p className="max-w-[48ch] text-[12.5px] leading-[1.5] text-[#4d4d4d]">
                    {t.subtarea}
                  </p>
                </div>
              ) : null}

              {desplegada && !t.conectar ? (
                <div className="border-t border-[#e0e0e0] px-4 pb-4">
                  {formularios[t.clave] ?? null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* 🔑 SOLO CUANDO DICE ALGO QUE LAS TARJETAS NO DICEN.

          Aquí había un párrafo que se pintaba SIEMPRE y que casi siempre
          repetía lo que ya se ve: si el radio está marcado en una tarjeta con
          la píldora «Completo», escribir «cobras por X» debajo no añade nada,
          solo alarga la pantalla.

          Lo que las tarjetas NO pueden contar es el desfase entre lo que el
          tutor eligió y lo que va a pasar de verdad — porque el enrutador
          reordena candidatos pero después filtra, así que una elección sin
          completar se cae al siguiente riel. Eso, y solo eso, se dice aquí, en
          una línea. Cuando no hay desfase no hay caja. */}
      {aviso ? (
        <p className="mt-3 text-[12.5px] leading-[1.55] text-[#4d4d4d]">{aviso}</p>
      ) : null}
    </div>
  );
}
