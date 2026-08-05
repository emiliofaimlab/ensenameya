import { requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { AdminShell } from "@/components/layout/admin-shell";
import { CategoryManager, type CategoryRow } from "./category-manager";

export const metadata = { title: "Categorías · Enséñame Ya" };

/**
 * US-1102 (SCR-AD11) — CRUD de categorías. Planas (S-13).
 * Escritura por RLS (`categories_*_admin`), no por RPC: no hay dinero ni roles.
 * El conteo de productos decide si una categoría se puede borrar o solo
 * desactivar — lo respalda el trigger `categories_delete_guard` en BD.
 */
export default async function AdminCategoriasPage() {
  await requireRole("admin");

  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    // El count del puente N–M dice cuántos productos la usan (RN-09).
    .select("id, name, slug, description, is_active, sort_order, icon, product_categories(count)")
    .order("sort_order")
    .order("name");

  const categories: CategoryRow[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    isActive: c.is_active,
    sortOrder: c.sort_order,
    icon: c.icon,
    productCount: c.product_categories?.[0]?.count ?? 0,
  }));

  return (
    <AdminShell
          title="Categorías"
          description="Las que ven alumnos y tutores al explorar y al clasificar sus clases."
    >
        <CategoryManager categories={categories} />
    </AdminShell>
  );
}
