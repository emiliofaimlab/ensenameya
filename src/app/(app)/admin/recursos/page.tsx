import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/layout/admin-shell";
import { BUCKET_RECURSOS, TTL_RECURSO_SEGUNDOS, esImagen } from "@/lib/recursos-redes";
import { RecursosManager, type RecursoRow } from "./recursos-manager";

export const metadata = { title: "Recursos para redes · Enséñame Ya" };

/**
 * EY-222 · El admin publica recursos y plantillas para redes y decide a qué
 * tutores se les enseña cada uno.
 *
 * Escritura por RLS (`social_resources_*_admin`, `20261013140000`) desde el
 * cliente, como `/admin/tiers`: no mueve dinero ni datos de nadie. Los ficheros
 * van del navegador al bucket privado `social-resources`, que solo acepta
 * subidas de un admin.
 */
export default async function AdminRecursosPage() {
  await requireRole("admin");
  const supabase = await createClient();

  const [recursosQ, tiersQ, tutoresQ] = await Promise.all([
    supabase
      .from("social_resources")
      .select(
        "id, title, description, category, kind, file_path, file_name, mime_type, size_bytes, external_url, audience, tier_ids, tutor_ids, is_published, sort_order, created_at",
      )
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase.from("tutor_tiers").select("id, name").order("split_pct"),
    // ⚠️ La FK nombrada (regla de oro 10): `tutor_profiles` ↔ `profiles` tiene
    // más de un camino y sin el nombre la consulta se cae con PGRST201.
    supabase
      .from("tutor_profiles")
      .select("profile_id, display_name, approval_status, profiles!tutor_profiles_profile_id_fkey(full_name)")
      .not("approval_status", "in", "(rejected,suspended)"),
  ]);

  // Se revienta en vez de pintar listas vacías: «0 recursos» o «0 tutores» es
  // la mentira creíble de la regla de oro 10.
  for (const [que, q] of [
    ["los recursos", recursosQ],
    ["los niveles", tiersQ],
    ["los tutores", tutoresQ],
  ] as const) {
    if (q.error) throw new Error(`No se pudieron leer ${que}: ${q.error.message}`);
  }

  const recursos = recursosQ.data ?? [];

  // Miniaturas firmadas en lote (el admin entra por `social_resources_files_select`).
  const rutas = recursos.flatMap((r) =>
    r.kind === "file" && r.file_path && esImagen(r.mime_type) ? [r.file_path] : [],
  );
  const miniaturas = new Map<string, string>();
  if (rutas.length > 0) {
    const { data: firmadas } = await supabase.storage
      .from(BUCKET_RECURSOS)
      .createSignedUrls(rutas, TTL_RECURSO_SEGUNDOS);
    for (const f of firmadas ?? []) if (f.path && f.signedUrl) miniaturas.set(f.path, f.signedUrl);
  }

  const filas: RecursoRow[] = recursos.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    kind: r.kind === "link" ? "link" : "file",
    filePath: r.file_path,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    externalUrl: r.external_url,
    audience: r.audience,
    tierIds: r.tier_ids ?? [],
    tutorIds: r.tutor_ids ?? [],
    isPublished: r.is_published,
    sortOrder: r.sort_order,
    thumbUrl: r.file_path ? (miniaturas.get(r.file_path) ?? null) : null,
  }));

  const tiers = (tiersQ.data ?? []).map((t) => ({
    id: t.id,
    // En la base se llaman «Tier N» (ver `tutor/tier.ts`); al admin se le
    // enseña igual que al tutor.
    name: t.name.replace(/^tier\b/i, "Nivel"),
  }));

  const tutores = (tutoresQ.data ?? [])
    .map((t) => ({
      id: t.profile_id,
      name: t.profiles?.full_name || t.display_name || "Tutor sin nombre",
      approved: t.approval_status === "approved",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  return (
    <AdminShell
      title="Recursos para redes"
      description="Plantillas, imágenes y guías que los tutores ven en su panel. Cada recurso decide a quién se le enseña."
    >
      <RecursosManager recursos={filas} tiers={tiers} tutores={tutores} />
    </AdminShell>
  );
}
