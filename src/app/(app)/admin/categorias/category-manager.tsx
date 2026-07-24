"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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

      {/* Listado — filas del Figma (225:55): nombre + /slug, orden, píldora. */}
      {categories.length === 0 ? (
        <p className="rounded-[16px] border border-dashed border-[#e0e0e0] p-8 text-center text-[13px] text-[#6b6b6b]">
          Todavía no hay categorías.
        </p>
      ) : (
        <div className="rounded-[16px] border border-[#e0e0e0] bg-card px-5 py-2">
          <ul className="divide-y divide-[#e0e0e0]">
            {categories.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3.5"
              >
                <div className="min-w-0 sm:w-64">
                  <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-[#6b6b6b]">
                    /{c.slug} · {c.productCount}{" "}
                    {c.productCount === 1 ? "producto" : "productos"}
                  </p>
                </div>
                <div>
                  <p className="text-[11.5px] text-[#6b6b6b]">Orden</p>
                  <p className="text-[13px] font-medium text-[#404040]">
                    {c.sortOrder}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold ${
                      c.isActive
                        ? "bg-[#d9f0de] text-[#298c52]"
                        : "bg-[#ebebeb] text-[#6b6b6b]"
                    }`}
                  >
                    {c.isActive ? "Activa" : "Inactiva"}
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy}
                    className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
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
                  <Button
                    variant="outline"
                    disabled={busy}
                    className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
                    onClick={() => toggleActive(c)}
                  >
                    {c.isActive ? "Desactivar" : "Activar"}
                  </Button>
                  {/* Baja lógica (AC): con productos asociados no se borra, se
                      desactiva — borrarla arrastraría sus enlaces por el cascade
                      y dejaría productos sin categoría. Lo fuerza la BD igual. */}
                  <Button
                    variant="destructive"
                    disabled={busy || c.productCount > 0}
                    title={
                      c.productCount > 0
                        ? "Tiene productos asociados: desactívala en vez de borrarla"
                        : undefined
                    }
                    className="h-9 rounded-[8px] px-3.5 text-[13px]"
                    onClick={() => remove(c)}
                  >
                    Borrar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
