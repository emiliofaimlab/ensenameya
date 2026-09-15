"use client";

import { Button } from "@/components/ui/button";

/**
 * 🔑 EL RADIO DE TARJETA / PAYPAL — petición del cliente, 15-sep-2026.
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO TRES BLOQUES DE JSX ──────────────────────
 * Porque hay TRES pantallas que abren un cobro —el checkout de una reserva
 * nueva, el «Pagar ahora» de una a medias y el de un pedido— y es el mismo
 * problema que ya resolvió `respuesta-de-cobro.ts`: las tres interpretaban la
 * respuesta por su cuenta con la misma línea copiada, y con dos proveedores esa
 * copia se volvió un bug. Un radio con tres copias tendría el mismo final: el
 * día que el cliente pida cambiar el texto, dos cambian y una no.
 *
 * ── LO QUE ESTE COMPONENTE NO DECIDE ───────────────────────────────────────
 * Si se puede ofrecer PayPal. Eso lo resuelve el SERVIDOR (`metodosDeCheckout`
 * en `lib/payments.ts`) y llega hecho: la ruta del pagador tiene que nombrarlo
 * y el riel tiene que estar encendido en este entorno. Aquí no se pregunta
 * nada, solo se pinta — y quien no recibe `true` no pinta nada en absoluto, así
 * que la pantalla de siempre no gana ni un elemento.
 *
 * ⚠️ 'tarjeta' NO ES UN RIEL. El servidor razona en `stripe`/`dlocal`/`paypal`;
 * 'tarjeta' es la familia que el alumno reconoce, igual que la tarjeta «Banco»
 * del tutor esconde a Wise, dLocal y Stripe (`metodo-preferido.ts`). Por eso
 * elegir tarjeta = NO mandar preferencia, que es lo que deja al ruteo del país
 * decidir entre Stripe y dLocal — que es justo lo que tiene que seguir haciendo.
 */
export type MetodoElegido = "tarjeta" | "paypal";

export function SelectorDeMetodo({
  valor,
  onChange,
  className = "mt-4",
}: {
  valor: MetodoElegido;
  onChange: (v: MetodoElegido) => void;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="mb-2 text-[13px] font-semibold text-[#19191f]">
        ¿Cómo quieres pagar?
      </legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        {(
          [
            { valor: "tarjeta", etiqueta: "Tarjeta de crédito o débito" },
            { valor: "paypal", etiqueta: "PayPal" },
          ] as const
        ).map((opcion) => (
          <label
            key={opcion.valor}
            className={`flex flex-1 cursor-pointer items-center gap-2.5 rounded-[10px] border px-4 py-3 text-[13px] transition-colors ${
              valor === opcion.valor
                ? "border-brand bg-brand/5 font-semibold text-[#19191f]"
                : "border-[#e4e4e7] text-[#6b6b6b] hover:border-[#c9c9cf]"
            }`}
          >
            <input
              type="radio"
              name="metodo-de-pago"
              value={opcion.valor}
              checked={valor === opcion.valor}
              onChange={() => onChange(opcion.valor)}
              className="size-4 accent-brand"
            />
            {opcion.etiqueta}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * El botón de PayPal. Es NUESTRO, al revés que con Stripe y dLocal —donde lo
 * pinta el proveedor dentro de su formulario— porque PayPal no monta nada aquí:
 * se abre la orden al pulsar y la pestaña se va a pagar.
 *
 * ⚠️ Y LA ORDEN SE ABRE EN EL CLIC, NO AL ELEGIR EL RADIO. Cambiar de opción
 * para mirar no puede abrir un cobro: es el mismo criterio por el que el crédito
 * que cubre el total confirma con un POST propio y no con la apertura
 * (`/api/pagos/checkout` se dispara al ENTRAR en la pantalla).
 */
export function BotonPaypal({
  onClick,
  className = "mt-3.5",
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <Button
        className="h-[49px] w-full rounded-[10px] px-6 font-semibold"
        onClick={onClick}
      >
        Pagar con PayPal
      </Button>
      <p className="mt-2 text-[12px] text-[#6b6b6b]">
        Te llevamos a PayPal para completar el pago y vuelves aquí.
      </p>
    </div>
  );
}
