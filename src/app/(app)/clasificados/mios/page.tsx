import Link from "next/link";

import { getFormatoHora, getUserTimezone, requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { formatSessionTime } from "@/lib/booking";
import { PanelCard, PanelShell, StatusPill } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { ESTADO_CLASIFICADO } from "../[id]/vista-alumno";

export const metadata = { title: "Mis clasificados · Enséñame Ya" };

/** Los clasificados del alumno, del más reciente al más viejo. */
export default async function MisClasificadosPage() {
  const { user } = await requireUser();
  const [tz, formato] = await Promise.all([getUserTimezone(), getFormatoHora()]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("class_requests")
    .select("id, goal, status, expires_at, created_at, categories(name)")
    .eq("student_id", user.id)
    .order("created_at", { ascending: false });
  if (error) console.error("[clasificados/mios] class_requests", error);
  const clasificados = data ?? [];

  // Postulaciones vivas (pendientes de pago) por clasificado, en una sola consulta.
  const vivas = new Map<string, number>();
  let errorConteo = false;
  if (clasificados.length > 0) {
    const { data: ps, error: e2 } = await supabase
      .from("class_proposals")
      .select("request_id")
      .in(
        "request_id",
        clasificados.map((c) => c.id),
      )
      .eq("status", "pending");
    if (e2) {
      console.error("[clasificados/mios] postulaciones", e2);
      errorConteo = true;
    }
    for (const p of ps ?? []) {
      if (p.request_id) vivas.set(p.request_id, (vivas.get(p.request_id) ?? 0) + 1);
    }
  }

  const publicar = (
    <Button asChild className="rounded-[8px] font-semibold">
      <Link href="/clasificados/nuevo">Publicar un clasificado</Link>
    </Button>
  );

  return (
    <PanelShell
      title="Mis clasificados"
      description="Lo que pediste y las propuestas que te mandaron los tutores."
      actions={clasificados.length > 0 ? publicar : undefined}
    >
      {error ? (
        <p className="text-sm text-destructive">
          No pudimos cargar tus clasificados. Recarga la página en un momento.
        </p>
      ) : clasificados.length === 0 ? (
        <PanelCard className="flex flex-col items-start gap-3">
          <p className="font-semibold">Todavía no publicaste ningún clasificado.</p>
          <p className="text-sm text-muted-foreground">
            ¿No encuentras la mentoría que buscas? Cuenta en una línea qué quieres lograr y cuándo
            puedes, y los tutores de la categoría te escriben con una propuesta de clase lista para
            pagar.
          </p>
          {publicar}
        </PanelCard>
      ) : (
        <ul className="flex flex-col gap-3">
          {clasificados.map((c) => {
            const estado = ESTADO_CLASIFICADO[c.status] ?? { label: c.status, tone: "gray" as const };
            const n = vivas.get(c.id) ?? 0;
            return (
              <li key={c.id}>
                <a
                  href={`/clasificados/${c.id}`}
                  className="flex flex-col gap-2 rounded-[16px] border border-[#e0e0e0] bg-card p-4 transition-shadow hover:shadow-card-hover sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-[#6b6b6b]">{c.categories?.name ?? "Clasificado"}</p>
                    <p className="truncate font-semibold">{c.goal}</p>
                    <p className="text-[12px] text-muted-foreground first-letter:uppercase">
                      {c.status === "active"
                        ? `Abierto hasta el ${formatSessionTime(c.expires_at, tz, formato)}`
                        : `Publicado el ${formatSessionTime(c.created_at, tz, formato)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {!errorConteo && n > 0 ? (
                      <span className="text-[13px] font-semibold text-brand">
                        {n} {n === 1 ? "postulación" : "postulaciones"}
                      </span>
                    ) : null}
                    <StatusPill tone={estado.tone}>{estado.label}</StatusPill>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}
