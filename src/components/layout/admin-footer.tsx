import Link from "next/link";

/** Footer del panel admin (218:1851): claro, con columnas de gestión. */
const COLS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "GESTIÓN",
    links: [
      { href: "/admin/tutores", label: "Tutores" },
      { href: "/admin/payments", label: "Pagos" },
      { href: "/admin/bookings", label: "Reservas" },
      { href: "/admin/payouts", label: "Payouts" },
    ],
  },
  {
    title: "CONFIG",
    links: [
      { href: "/admin/categorias", label: "Categorías" },
      { href: "/admin/tiers", label: "Tiers" },
      { href: "/admin/alertas", label: "Alertas" },
      { href: "/admin/reportes", label: "Reportes" },
    ],
  },
  {
    title: "LEGAL",
    links: [
      { href: "/terms", label: "Términos" },
      { href: "/privacy", label: "Privacidad" },
    ],
  },
];

export function AdminFooter() {
  return (
    <footer className="border-t border-[#e0e0e0] bg-[#f7f7f7]">
      {/* US-1601 · Este pie tiene su propio contenedor (no pasa por
          `Container`), así que su aire lo arregla este fichero o no lo
          arregla nadie. Del `v3-footer` de «AD02 — Dashboard Admin»: pad-x 20
          y pad-y 32/28 a 390, pad-x 32 y pad-y 40/28 a 768. `sm:px-8` ya daba
          los 32 y se queda; `lg:pt-9 lg:pb-9` devuelve el `py-9` de
          escritorio, que no se toca. */}
      <div className="mx-auto w-full max-w-[1280px] px-5 pt-8 pb-7 sm:px-8 md:pt-10 lg:pt-9 lg:pb-9">
        {/* Era `flex-wrap` puro, sin un solo breakpoint: a 390 la marca y las
            tres columnas cabían por los pelos en una fila. El Figma móvil
            apila marca → columnas (`col gap24`).

            En tablet la fila vuelve, pero NO con `justify-between`: el
            `top-row` de «AD02 Tablet» es `row gap24` pegado a la izquierda y
            deja el hueco a la DERECHA (brand 250 → cols en x=306/385/478).
            Con `justify-between` y el gap20 de las columnas el grupo se iba
            al borde derecho, que es justo lo que el diseño no hace.
            `lg:justify-between` + `lg:gap-10` devuelven el escritorio. */}
        <div className="flex flex-col gap-6 md:flex-row md:flex-wrap lg:justify-between lg:gap-10">
          {/* 250 es el ancho exacto del `brand` del Figma tablet; con el
              gap24 de arriba deja las columnas en x=306, como el diseño. */}
          <div className="max-w-[300px] md:max-w-[250px] lg:max-w-[300px]">
            <p className="text-lg font-bold text-[#19191f]">Enséñame Ya</p>
            <p className="mt-2 text-[13px] text-[#6b6b6b]">
              Panel de administración · Enséñame Ya.
            </p>
          </div>
          {/* GESTIÓN / CONFIG / LEGAL. A 390 el Figma las apila
              (`footer-cols · col gap20`) y a 768 las pone en fila con gap20
              —no con los 64 de aquí, que son de escritorio—. `lg:gap-16`
              devuelve esos 64 de 1024 en adelante. */}
          <div className="flex flex-col gap-5 md:flex-row md:flex-wrap md:gap-5 lg:gap-16">
            {COLS.map((c) => (
              <div key={c.title}>
                <p className="text-[11px] font-semibold tracking-wide text-brand">
                  {c.title}
                </p>
                <ul className="mt-2.5 flex flex-col gap-2.5">
                  {c.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="text-[13px] text-[#6b6b6b] transition-colors hover:text-foreground"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <hr className="mt-8 border-[#e0e0e0]" />
        {/* El Figma móvil apila «© 2026 Enséñame Ya» y «Panel interno»
            (`bottom · col gap8`) y solo a partir de tablet los separa a los
            extremos. `items-center` se va a `md:` porque en columna centraría
            el texto horizontalmente, que no es lo que dibuja el diseño. */}
        <div className="mt-5 flex flex-col gap-2 text-xs text-[#6b6b6b] md:flex-row md:flex-wrap md:items-center md:justify-between">
          <span>© 2026 Enséñame Ya</span>
          <span>Panel interno</span>
        </div>
      </div>
    </footer>
  );
}
