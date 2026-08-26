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
      <div className="mx-auto w-full max-w-[1280px] px-4 py-9 sm:px-8">
        <div className="flex flex-wrap justify-between gap-10">
          <div className="max-w-[300px]">
            <p className="text-lg font-bold text-[#19191f]">Enséñame Ya</p>
            <p className="mt-2 text-[13px] text-[#6b6b6b]">
              Panel de administración · Enséñame Ya.
            </p>
          </div>
          <div className="flex flex-wrap gap-16">
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
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#6b6b6b]">
          <span>© 2026 Enséñame Ya</span>
          <span>Panel interno</span>
        </div>
      </div>
    </footer>
  );
}
