import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRightIcon,
  BarChart3Icon,
  CheckIcon,
  ClockIcon,
  StarIcon,
  VideoIcon,
  ZapIcon,
} from "lucide-react";

import { ProductCover } from "@/components/catalog/product-cover";
import { LEVELS } from "@/components/catalog/product-filters";
import { Precio } from "@/components/precio/precio";
import {
  initialsFrom,
  perSessionLabel,
  priceDisplay,
  sessionsLabel,
  storageUrl,
} from "@/lib/catalog/format";
import type { ProductCardData } from "@/lib/catalog/queries";

/**
 * Tarjeta de producto de P05 y P06. El botón circular cambia de color según la
 * pantalla: naranja en el catálogo general, azul en la página de categoría.
 */
export function ProductCard({
  product,
  accent = "primary",
  action = "circle",
  compact = false,
}: {
  product: ProductCardData;
  accent?: "primary" | "brand";
  /** `ver` = botón outline "Ver" (P07); `circle` = botón circular (P05/P06). */
  action?: "circle" | "ver";
  /** P09 la usa a 273px: miniatura y tipografías más pequeñas, tutor en una línea. */
  compact?: boolean;
}) {
  /**
   * §6 · fila de datos con icono: `⏱ 60 min · 📹 En vivo 1 a 1 · 📶 Intermedio`.
   *
   * La duración de una sesión suelta se escribe "60 min" y NO "1 × 60 min":
   * `sessionsLabel` antepone el recuento siempre, y ese "1 ×" no informa de
   * nada cuando solo hay una sesión. En paquetes sí manda `sessionsLabel`
   * ("4 × 60 min"), para no tener dos sitios escribiendo el mismo formato.
   *
   * Sin idioma a propósito (§6): a 190px —la anchura de la fila desplazable de
   * móvil— el cuarto dato empuja la fila a una tercera línea.
   */
  const duracion =
    (product.packageNumSessions ?? 1) > 1
      ? sessionsLabel(product)
      : product.sessionDurationMin
        ? `${product.sessionDurationMin} min`
        : null;
  // DD-03 · el nivel es el de LA MENTORÍA y su vocabulario lo da el filtro de
  // P05 (básico/intermedio/avanzado). Sin nivel —mentorías anteriores al
  // campo— el dato no se pinta en vez de inventar uno.
  const nivel = LEVELS.find((l) => l.id === product.level)?.label ?? null;
  const datos: { k: string; Icon: LucideIcon; label: string }[] = [
    ...(duracion ? [{ k: "dur", Icon: ClockIcon, label: duracion }] : []),
    { k: "vivo", Icon: VideoIcon, label: "En vivo 1 a 1" },
    ...(nivel ? [{ k: "nivel", Icon: BarChart3Icon, label: nivel }] : []),
  ];

  /**
   * G-03 · la confirmación es POR MENTORÍA (`products.auto_accept_bookings`),
   * nunca del perfil del tutor: dos mentorías del mismo tutor pueden responder
   * distinto. Se pinta siempre —también en `compact`—, porque es justo lo que
   * decide si el alumno puede entrar hoy o tiene que esperar 24 h.
   */
  const confirmacion: { Icon: LucideIcon; label: string; className: string } =
    product.autoAccept
      ? {
          Icon: ZapIcon,
          label: "Confirmación inmediata",
          // Naranja oscuro, no el `primary` de marca: a 11-12px sobre blanco el
          // #fe6a00 se queda en 2.4:1 de contraste y esto es texto, no un botón.
          className: "text-[#c4470a]",
        }
      : {
          Icon: CheckIcon,
          label: "El tutor confirma en 24 h",
          className: "text-[#595959]",
        };

  // RV-08 · manda el total de la reserva, no la tarifa (ver `priceDisplay`).
  const precio = priceDisplay(product);
  /**
   * RV-09 · el paquete sale más barato por sesión y la tarjeta no lo decía.
   *
   * La nota del precio en un paquete es "paquete · 6 sesiones": repite lo que ya
   * dice la fila de datos ("6 × 60 min") y calla lo único que sirve para
   * comparar con una clase suelta — cuánto cuesta CADA sesión. `perSessionLabel`
   * lo dice ("4 sesiones · US$ 15,00 c/u") y trae también el recuento, así que
   * SUSTITUYE a la nota en lugar de apilarse encima. Es el mismo criterio que ya
   * sigue el panel de reserva de P08, y aquí importa más: el catálogo es donde
   * se comparan mentorías.
   *
   * Devuelve `null` fuera de `per_package` y en paquetes de una sola sesión, así
   * que el resto de tarjetas no cambian.
   *
   * ⚠️ LO QUE **NO** SE PINTA, y no por olvido: ni "ahorras un 20 %" ni un precio
   * tachado. Un producto `per_package` no conoce hoy el precio de la sesión
   * suelta del mismo tutor —no hay columna de referencia—, así que cualquier
   * ahorro saldría de compararlo con otro producto por casualidad o de un
   * importe tecleado sin control. Eso ya no sería una promoción, sería
   * publicidad engañosa, y los Términos publicados describen el flujo real de
   * compra. Con dato de verdad detrás se puede añadir; sin él, no.
   */
  const porSesion = perSessionLabel(product);
  const tutorAvatar = storageUrl("avatars", product.tutor?.avatarPath ?? null);
  const tutorName =
    product.tutor?.displayName ?? product.tutor?.headline ?? "Tutor";

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[16px] border border-[#ebebeb] bg-card shadow-[0_8px_22px_rgb(0_0_0/0.06)]">
      {/* Miniatura 276×140 (DD-02). MN-09 · sin imagen se pinta el icono de
          categoría, no una banda gris: la caja ocupa lo mismo en los dos casos
          (por eso el alto va en `className`, que `ProductCover` aplica a las dos
          ramas) y la rejilla no se desalinea. */}
      <ProductCover
        product={product}
        width={276}
        height={compact ? 120 : 140}
        className={compact ? "h-[120px]" : "h-[140px]"}
      />

      <div
        className={`flex flex-1 flex-col ${compact ? "gap-2 p-3.5" : "gap-3 p-[18px]"}`}
      >
        <h3
          className={`line-clamp-2 font-bold text-[#242424] ${compact ? "text-sm" : "text-base"}`}
        >
          {product.title}
        </h3>

        {product.tutor && compact ? (
          <p className="truncate text-xs text-[#666666]">
            {tutorName}
            {product.tutor.ratingAvg !== null
              ? ` · ★ ${product.tutor.ratingAvg.toFixed(1)}`
              : ""}
          </p>
        ) : product.tutor ? (
          <div className="flex items-center gap-2">
            {/* Sin foto, iniciales — como el resto del sitio. */}
            <span className="grid size-[26px] shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold">
              {tutorAvatar ? (
                <Image
                  src={tutorAvatar}
                  alt=""
                  width={26}
                  height={26}
                  className="size-[26px] object-cover"
                  unoptimized
                />
              ) : (
                initialsFrom(tutorName)
              )}
            </span>
            {/* N-12 · `min-w-0` en el PROPIO enlace: es un ítem flex, y sin él
                `min-width:auto` le impide encoger, así que el `truncate` no
                recortaba nada y un nombre largo empujaba a la estrella fuera
                de la tarjeta. El subrayado del hover sigue el recorte. */}
            <Link
              href={`/tutors/${product.tutor.id}`}
              className="min-w-0 truncate text-[13px] font-medium text-[#474747] hover:underline"
            >
              {tutorName}
            </Link>
            {product.tutor.ratingAvg !== null ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] text-[#666666]">
                ·
                <StarIcon className="size-3.5 fill-primary text-primary" />
                {product.tutor.ratingAvg.toFixed(1)}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Cada dato con su icono (G-02) y `whitespace-nowrap` por ítem: la fila
            envuelve ENTRE datos, nunca dentro de uno ("En vivo 1 a" + "1" sería
            peor que dos líneas). A 190px caben dos por línea en `compact`. */}
        <ul
          className={`flex flex-wrap items-center text-[#4d4d4d] ${
            compact
              ? "gap-x-2.5 gap-y-1 text-[11px]"
              : "gap-x-3.5 gap-y-1 text-[12.5px]"
          }`}
        >
          {datos.map(({ k, Icon, label }) => (
            <li key={k} className="flex items-center gap-1.5 whitespace-nowrap">
              <Icon className="size-3.5 shrink-0 text-brand" aria-hidden />
              {label}
            </li>
          ))}
        </ul>

        {/* G-03 · categoría a la izquierda y confirmación a la derecha, en la
            MISMA fila. Solo la primera categoría: con la confirmación
            compartiendo la línea, dos chips + "El tutor confirma en 24 h" no
            caben en los 276px de la tarjeta y la fila se partiría en dos.
            En `compact` no hay chip (como hasta hoy) y la confirmación se queda
            sola a la izquierda. */}
        <div className="flex items-center justify-between gap-2">
          {product.categories.length > 0 && !compact ? (
            <span className="min-w-0 truncate rounded-[6px] bg-[#f0f0f0] px-2.5 py-1 text-xs font-medium text-[#5c5c5c]">
              {product.categories[0].name}
            </span>
          ) : null}
          <span
            className={`flex shrink-0 items-center gap-1.5 font-semibold whitespace-nowrap ${
              compact ? "text-[11px]" : "text-xs"
            } ${confirmacion.className}`}
          >
            <confirmacion.Icon className="size-3.5 shrink-0" aria-hidden />
            {confirmacion.label}
          </span>
        </div>

        <div
          className={`mt-auto border-t border-[#ebebeb] ${compact ? "pt-2.5" : "pt-3"}`}
        >
          <div className="flex items-end justify-between gap-3">
            {/* Precio destacado (24-jul): el monto grande arriba y la unidad
                pequeña debajo, para que sea el ancla visual de la tarjeta.
                RV-08: el monto grande es lo que se COBRA por reservar; la
                tarifa por hora, cuando la hay, es la línea de abajo. */}
            {/* La cifra grande va en la moneda de quien mira y el USD baja a la
                línea pequeña (11-sep-2026). Sin conversión —país dolarizado,
                Venezuela, sin tasa— `<Precio>` pinta exactamente lo de antes:
                el USD arriba y la nota debajo.

                RV-09 · la nota del paquete ("4 sesiones · US$ 15,00 c/u") puede
                no caber en una línea a 276px, así que en ese caso se deja
                envolver en vez de recortarse: un "4 sesiones · US$ 15…" cortado
                esconde justo el dato que se añadió. La nota corriente sigue con
                `truncate`. */}
            <div className="min-w-0">
              <Precio
                amountMinor={precio.amountMinor}
                currency={product.currency}
                nota={porSesion ?? precio.note}
                className={`font-bold text-[#19191f] ${compact ? "text-base" : "text-[19px]"} leading-tight`}
                notaClassName={`text-[#666666] ${compact ? "text-[11px]" : "text-xs"} ${
                  porSesion ? "text-pretty" : "truncate"
                }`}
              />
            </div>
            {action === "ver" ? (
              <Link
                href={`/products/${product.id}`}
                className="shrink-0 rounded-[8px] border-[1.5px] border-brand px-4 py-2 text-[13px] font-semibold text-brand transition-colors hover:bg-brand-muted"
              >
                Ver
              </Link>
            ) : (
              <Link
                href={`/products/${product.id}`}
                aria-label={`Ver detalle de ${product.title}`}
                className={`grid size-10 shrink-0 place-items-center rounded-full text-white transition-colors ${
                  accent === "brand"
                    ? "bg-brand hover:bg-brand-foreground"
                    : "bg-primary hover:bg-primary/85"
                }`}
              >
                <ArrowUpRightIcon className="size-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
