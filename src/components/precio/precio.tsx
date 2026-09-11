"use client";

import { createContext, useContext } from "react";

import { dosCifras } from "@/lib/dinero";
import { cn } from "@/lib/utils";

/**
 * ── EL PRECIO, EN LA MONEDA DE QUIEN MIRA ──────────────────────────────────
 *
 * Un solo mecanismo para las ~25 superficies que enseñan dinero al alumno y al
 * público. La alternativa era hilar `{moneda, tasa}` por props desde cada
 * Server Component hasta cada tarjeta, y son cuatro niveles de profundidad en
 * el catálogo: un contexto montado una vez en el layout raíz es menos código y
 * no añade ni un peldaño de cascada.
 *
 * 🔴 ES UNA ETIQUETA, NO UN COBRO. El cobro se abre en USD (`payments.currency`
 * se congela desde `products.currency`, y el catálogo entero es USD). La cifra
 * local es orientativa y **siempre lleva su «≈» y el USD debajo**, los dos a la
 * vez: sin el «≈» promete una precisión que la tasa no tiene, y sin el USD
 * debajo el alumno no puede cuadrar lo que ve con lo que le llega al extracto.
 * Este repo ya pagó esa factura una vez —el `adaptive_pricing` de Stripe
 * prometía 45,00 US$ y cobraba PAB 46,80— y por eso el USD no es opcional.
 *
 * Sin conversión (país dolarizado, Venezuela, sin tasa, sin credencial) el
 * componente pinta exactamente lo que pintaba antes: el USD a secas. Degradar
 * a lo de siempre es el comportamiento correcto, no un caso de error.
 */
export type MonedaVisitante = { moneda: string; tasa: number } | null;

const Ctx = createContext<MonedaVisitante>(null);

/** Se monta UNA vez, en el layout raíz, con el valor resuelto en servidor. */
export function ProveedorDeMoneda({
  valor,
  children,
}: {
  valor: MonedaVisitante;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useMonedaVisitante(): MonedaVisitante {
  return useContext(Ctx);
}

/**
 * Las dos cifras ya formateadas, o `null` en `local` si no hay conversión.
 * Se exporta porque hay sitios (un botón, una frase) que no admiten el bloque
 * de dos líneas y necesitan montar el texto a su manera.
 */
export function usePrecio(
  amountMinor: number,
  currency: string,
): { local: string | null; usd: string } {
  // La cuenta vive en `lib/dinero.ts` y la comparte con `textosDePrecio()` del
  // servidor: el mismo precio no puede redondear distinto según quién lo pinte.
  return dosCifras(amountMinor, currency, useMonedaVisitante());
}

const AVISO = "Importe orientativo: el cobro se realiza en dólares (USD).";

/**
 * La CIFRA GRANDE, sola: en moneda local si la hay, y si no el USD de siempre.
 *
 * Existe para las superficies cuya línea pequeña no está libre —la franja
 * naranja de la ficha de mentoría mete ahí la duración y el «clase en vivo»—,
 * donde el bloque de dos líneas de `<Precio>` no encaja. Quien la use está
 * obligado a poner `<ImporteEnUsd>` cerca: las dos cifras se ven juntas o no se
 * pinta la conversión. Una cifra local sin su dólar al lado es la mitad que
 * miente.
 */
export function ImporteLocal({
  amountMinor,
  currency,
  className,
}: {
  amountMinor: number;
  currency: string;
  className?: string;
}) {
  const { local, usd } = usePrecio(amountMinor, currency);
  return (
    <span className={className} title={local ? AVISO : undefined}>
      {local ?? usd}
    </span>
  );
}

/**
 * El USD, solo — y **`null` cuando no hay conversión**, que es lo que hace que
 * se pueda soltar en cualquier sitio sin condicionarlo a mano: si no hay
 * moneda local, la cifra grande YA es el dólar y repetirlo debajo sobra.
 */
export function ImporteEnUsd({
  amountMinor,
  currency,
  className,
}: {
  amountMinor: number;
  currency: string;
  className?: string;
}) {
  const { local, usd } = usePrecio(amountMinor, currency);
  if (!local) return null;
  return (
    <span className={className} title={AVISO}>
      {usd}
    </span>
  );
}

/**
 * El bloque de dos líneas: la cifra grande arriba, el USD pequeño debajo.
 *
 * Sustituye al par `<p className="grande">{d.amount}</p>` +
 * `<p className="pequeña">{d.note}</p>` que hoy repiten las tarjetas: `nota`
 * es esa segunda línea de siempre («por sesión», «paquete · 6 sesiones»), y se
 * concatena al USD en vez de comerse una tercera línea, que en una tarjeta de
 * catálogo no cabe.
 */
export function Precio({
  amountMinor,
  currency,
  nota,
  className,
  notaClassName,
}: {
  amountMinor: number;
  currency: string;
  /** La línea pequeña que la superficie ya pintaba. Opcional. */
  nota?: string | null;
  /** Clases de la cifra GRANDE. La superficie manda en su tipografía. */
  className?: string;
  notaClassName?: string;
}) {
  const { local, usd } = usePrecio(amountMinor, currency);

  const grande = local ?? usd;
  const pie = local ? [usd, nota].filter(Boolean).join(" · ") : (nota ?? null);

  return (
    <>
      <span className={cn("block", className)} title={local ? AVISO : undefined}>
        {grande}
      </span>
      {pie ? (
        <span
          className={cn(
            "text-muted-foreground block text-[11px] leading-tight font-normal",
            notaClassName,
          )}
        >
          {pie}
        </span>
      ) : null}
    </>
  );
}

/**
 * La versión de una sola línea: «≈ 4.380 CLP (12,00 US$)».
 *
 * Para los sitios donde el importe va DENTRO de una frase o de un botón
 * («Confirmar pago · X», «Te quedan X por cobrar») y el bloque de dos líneas no
 * cabe ni tiene sentido. El USD va entre paréntesis y no en una segunda línea,
 * pero va: la regla de que las dos cifras se ven juntas no cambia por el sitio.
 */
export function PrecioEnLinea({
  amountMinor,
  currency,
  className,
}: {
  amountMinor: number;
  currency: string;
  className?: string;
}) {
  const { local, usd } = usePrecio(amountMinor, currency);
  if (!local) return <span className={className}>{usd}</span>;
  return (
    <span className={className} title={AVISO}>
      {local}{" "}
      <span className="text-muted-foreground text-[0.85em] font-normal whitespace-nowrap">
        ({usd})
      </span>
    </span>
  );
}
