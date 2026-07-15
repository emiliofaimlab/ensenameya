"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
};

/**
 * Slug legible para URL: sin acentos, sin símbolos, separado por guiones.
 * `normalize("NFD")` + quitar diacríticos es el truco estándar del navegador —
 * "Programación" → "programacion". Sin dependencia.
 */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Draft = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
  // El slug deja de auto-seguir al nombre en cuanto se toca a mano.
  slugTouched: boolean;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  slug: "",
  description: "",
  sortOrder: "0",
  slugTouched: false,
};

export function CategoryManager({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);

  const editing = draft.id !== null;

  async function save() {
    const name = draft.name.trim();
    const slug = draft.slug.trim();
    if (!name) {
      toast.error("La categoría necesita un nombre.");
      return;
    }
    if (!slug) {
      toast.error("La categoría necesita un slug.");
      return;
    }
    const sortOrder = Number.parseInt(draft.sortOrder, 10);
    if (Number.isNaN(sortOrder)) {
      toast.error("El orden debe ser un número.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const values = {
      name,
      slug,
      description: draft.description.trim() || null,
      sort_order: sortOrder,
    };

    const { error } = editing
      ? await supabase.from("categories").update(values).eq("id", draft.id!)
      : await supabase.from("categories").insert(values);
    setBusy(false);

    if (error) {
      // 23505 = el slug ya existe (unique). El resto se muestra tal cual.
      toast.error(
        error.code === "23505"
          ? `Ya existe una categoría con el slug "${slug}".`
          : error.message || "No se pudo guardar la categoría.",
      );
      return;
    }
    toast.success(editing ? "Categoría actualizada." : "Categoría creada.");
    setDraft(EMPTY);
    router.refresh();
  }

  async function toggleActive(c: CategoryRow) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("categories")
      .update({ is_active: !c.isActive })
      .eq("id", c.id);
    setBusy(false);

    if (error) {
      toast.error(error.message || "No se pudo cambiar el estado.");
      return;
    }
    toast.success(c.isActive ? "Categoría desactivada." : "Categoría activada.");
    router.refresh();
  }

  async function remove(c: CategoryRow) {
    if (!window.confirm(`¿Borrar "${c.name}"? Es definitivo.`)) return;

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("categories").delete().eq("id", c.id);
    setBusy(false);

    if (error) {
      // El trigger categories_delete_guard rechaza borrar si tiene productos,
      // aunque la UI no ofrezca el botón (p. ej. si se asoció uno mientras).
      toast.error(error.message || "No se pudo borrar la categoría.");
      return;
    }
    toast.success("Categoría borrada.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Alta / edición */}
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-sm font-medium">
          {editing ? `Editar "${draft.name || "categoría"}"` : "Nueva categoría"}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-name">Nombre</Label>
            <Input
              id="cat-name"
              value={draft.name}
              placeholder="Programación"
              onChange={(e) => {
                const name = e.target.value;
                setDraft((d) => ({
                  ...d,
                  name,
                  // Al crear, el slug sigue al nombre hasta que lo editas.
                  slug: d.slugTouched ? d.slug : slugify(name),
                }));
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-slug">Slug</Label>
            <Input
              id="cat-slug"
              value={draft.slug}
              placeholder="programacion"
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  slug: slugify(e.target.value),
                  slugTouched: true,
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              {editing
                ? "Cambiarlo rompe los enlaces existentes a /categories/…"
                : "Se usa en la URL: /categories/…"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cat-desc">Descripción (opcional)</Label>
          <Textarea
            id="cat-desc"
            rows={2}
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:max-w-[10rem]">
          <Label htmlFor="cat-order">Orden</Label>
          <Input
            id="cat-order"
            type="number"
            value={draft.sortOrder}
            onChange={(e) => setDraft((d) => ({ ...d, sortOrder: e.target.value }))}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={save}>
            {editing ? "Guardar cambios" : "Crear categoría"}
          </Button>
          {editing ? (
            <Button variant="outline" disabled={busy} onClick={() => setDraft(EMPTY)}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      {/* Listado */}
      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Todavía no hay categorías.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {categories.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  /{c.slug} · orden {c.sortOrder}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant={c.isActive ? "default" : "outline"}>
                    {c.isActive ? "Activa" : "Inactiva"}
                  </Badge>
                  <Badge variant="secondary">
                    {c.productCount} {c.productCount === 1 ? "producto" : "productos"}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      id: c.id,
                      name: c.name,
                      slug: c.slug,
                      description: c.description ?? "",
                      sortOrder: String(c.sortOrder),
                      slugTouched: true,
                    })
                  }
                >
                  Editar
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => toggleActive(c)}>
                  {c.isActive ? "Desactivar" : "Activar"}
                </Button>
                {/* Baja lógica (AC): con productos asociados no se borra, se
                    desactiva — borrarla arrastraría sus enlaces por el cascade
                    y dejaría productos sin categoría. Lo fuerza la BD igual. */}
                {c.productCount === 0 ? (
                  <Button variant="destructive" size="sm" disabled={busy} onClick={() => remove(c)}>
                    Borrar
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled
                    title="Tiene productos asociados: desactívala en vez de borrarla"
                  >
                    Borrar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
