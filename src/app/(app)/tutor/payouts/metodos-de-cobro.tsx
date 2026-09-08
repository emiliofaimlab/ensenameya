"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
  /** Dos letras. No es el logo de la marca: ver el porqué en la lista de abajo. */
  monograma: string;
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
};

/**
 * 🔑 POR DÓNDE QUIERE COBRAR EL TUTOR — el radiogroup.
 *
 * ── POR QUÉ SON RADIOS DE VERDAD Y NO DIVS CON `role="radio"` ───────────────
 *
 * Porque un `<input type="radio">` dentro de su `<label>` ya trae gratis lo que
 * un div hay que reimplementar mal: el nombre accesible es la etiqueta entera,
 * las flechas recorren el grupo, Espacio marca, y el estado lo anuncia el
 * navegador sin un solo `aria-checked` escrito a mano. Lo único que se estiliza
 * es el borde de la tarjeta.
 *
 * ── Y POR QUÉ EL BOTÓN DE «AÑADIR» VA FUERA DE LA ETIQUETA ──────────────────
 *
 * Porque un `<button>` dentro de un `<label>` hereda su clic: pulsar «Editar»
 * en la tarjeta de PayPal cambiaría la preferencia del tutor a PayPal sin que
 * él lo pidiera. Son dos cosas independientes —cuál prefiero y cuál estoy
 * rellenando— y aquí se modelan como dos controles, no como uno con dos
 * significados.
 *
 * ── ELEGIR UNA SIN TERMINAR NO ROMPE NADA ───────────────────────────────────
 *
 * El enrutador REORDENA candidatos con esta preferencia y después aplica sus
 * tres filtros de siempre, así que marcar PayPal sin conectar la cuenta no deja
 * ninguna orden atascada: se cae al siguiente riel que sí pueda pagarle. Por eso
 * la pantalla lo dice en voz alta abajo («mientras tanto te pagamos por X») en
 * vez de impedir la elección: prohibirla sería mentir sobre lo que pasa.
 */
export function MetodosDeCobro({
  tarjetas,
  preferida,
  formularios,
}: {
  tarjetas: TarjetaMetodo[];
  /** La vigente, ya descartada si apunta a un método que este país no ofrece. */
  preferida: string | null;
  /** El formulario de cada método, renderizado en el servidor. */
  formularios: Record<string, React.ReactNode>;
}) {
  const router = useRouter();
  // Optimista: el radio se mueve al pulsar y no cuando vuelve el servidor. Si
  // la escritura falla se devuelve al valor anterior y se dice por qué.
  const [elegida, setElegida] = useState<string | null>(preferida);
  const [guardando, setGuardando] = useState(false);
  // Qué formulario está desplegado. Independiente del radio, a propósito.
  const [abierta, setAbierta] = useState<string | null>(null);

  async function elegir(clave: string) {
    if (clave === elegida) return;
    const anterior = elegida;
    setElegida(clave);
    setGuardando(true);
    // Una tarjeta a medias se abre sola al elegirla: el siguiente paso del tutor
    // es rellenarla, y hacerle buscar el botón sería un clic de castigo.
    if (!tarjetas.find((t) => t.clave === clave)?.listo) setAbierta(clave);

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

  return (
    <div>
      <ul
        role="radiogroup"
        aria-label="Forma de cobro preferida"
        className="mt-4 grid gap-2.5"
      >
        {tarjetas.map((t) => {
          const marcada = elegida === t.clave;
          const desplegada = abierta === t.clave;
          return (
            <li
              key={t.clave}
              className={cn(
                "rounded-[12px] border bg-card transition-colors",
                marcada
                  ? "border-brand shadow-[0_0_0_1px_var(--brand)]"
                  : "border-[#e0e0e0] hover:border-[#949494]",
              )}
            >
              <div className="flex flex-wrap items-start gap-3 p-4 sm:flex-nowrap sm:gap-4">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 sm:gap-4">
                  <input
                    type="radio"
                    name="metodo-de-cobro"
                    className="mt-0.5 size-5 shrink-0 accent-brand"
                    checked={marcada}
                    disabled={guardando}
                    onChange={() => elegir(t.clave)}
                  />
                  {/* Monograma y no logo: el Figma no trae marcas de terceros y
                      meter el azul de PayPal o el morado de Stripe rompería la
                      paleta en la única pantalla donde conviven cinco. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold",
                      marcada
                        ? "bg-brand-muted text-[#0068d0]"
                        : "bg-[#f0f0f0] text-[#19191f]",
                    )}
                  >
                    {t.monograma}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-semibold text-[#19191f]">
                        {t.nombre}
                      </strong>
                      {t.listo ? (
                        <StatusPill tone="green">Completo</StatusPill>
                      ) : (
                        <StatusPill tone="gray">Sin configurar</StatusPill>
                      )}
                      {/* Nunca un plazo: de la velocidad de estos rieles no hay
                          ni una medida. Automático o a mano sí es un hecho. */}
                      <StatusPill tone="gray">
                        {t.automatico ? "Automático" : "Lo envía una persona"}
                      </StatusPill>
                    </span>
                    <span className="mt-1.5 block max-w-[54ch] text-[12.5px] leading-[1.55] text-[#4d4d4d]">
                      {t.descripcion}
                    </span>
                    {t.detalle ? (
                      <span className="mt-2 inline-block rounded-[6px] border border-[#e0e0e0] bg-muted px-2.5 py-1 text-[12.5px] tabular-nums text-[#19191f]">
                        {t.detalle}
                      </span>
                    ) : null}
                  </span>
                </label>

                <button
                  type="button"
                  aria-expanded={desplegada}
                  onClick={() => setAbierta(desplegada ? null : t.clave)}
                  className="h-11 shrink-0 rounded-[8px] border border-[#949494] bg-card px-4 text-[13px] font-semibold text-[#19191f] transition-colors hover:bg-[#f5f5f5]"
                >
                  {desplegada ? "Cerrar" : t.listo ? "Editar" : "Configurar"}
                </button>
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

              {desplegada ? (
                <div className="border-t border-[#e0e0e0] px-4 pb-4">
                  {formularios[t.clave] ?? null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* 🔑 LA FRASE QUE DICE LA VERDAD. El enrutador no obedece a ciegas: la
          preferencia reordena y después filtra. Si el tutor eligió algo que
          todavía no puede pagar, esto lo dice — y dice por dónde va a cobrar
          mientras tanto, que es lo que de verdad quiere saber. */}
      <p className="mt-4 max-w-[72ch] rounded-[8px] border border-[#e0e0e0] bg-muted px-3.5 py-3 text-[12.5px] leading-[1.6] text-[#4d4d4d]">
        {laElegida === null ? (
          listas.length > 0 ? (
            <>
              Todavía no has elegido, así que lo decidimos nosotros y hoy te
              pagaríamos por{" "}
              <strong className="font-semibold text-[#19191f]">
                {listas[0].nombre}
              </strong>
              . Marca una si prefieres otra.
            </>
          ) : (
            <>
              Todavía no podemos pagarte: no has completado ninguna.{" "}
              <strong className="font-semibold text-[#19191f]">
                Tu saldo se sigue acumulando
              </strong>{" "}
              mientras tanto.
            </>
          )
        ) : laElegida.listo ? (
          <>
            Cobras por{" "}
            <strong className="font-semibold text-[#19191f]">
              {laElegida.nombre}
            </strong>
            .{" "}
            {respaldo ? (
              <>
                Si algún día no se puede, lo intentamos por{" "}
                <strong className="font-semibold text-[#19191f]">
                  {respaldo.nombre}
                </strong>{" "}
                sin que tengas que hacer nada.
              </>
            ) : (
              <>
                Es la única que tienes completa, así que no hay alternativa si
                algún día falla: completa otra y te cubrimos.
              </>
            )}
          </>
        ) : (
          <>
            Elegiste{" "}
            <strong className="font-semibold text-[#19191f]">
              {laElegida.nombre}
            </strong>{" "}
            pero te faltan datos.{" "}
            {respaldo ? (
              <>
                Mientras tanto te pagamos por{" "}
                <strong className="font-semibold text-[#19191f]">
                  {respaldo.nombre}
                </strong>
                ; en cuanto la completes, pasamos a pagarte por ahí.
              </>
            ) : (
              <>
                Y no tenemos ninguna otra completa, así que{" "}
                <strong className="font-semibold text-[#19191f]">
                  hoy no podemos pagarte
                </strong>
                . Tu saldo se sigue acumulando.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
