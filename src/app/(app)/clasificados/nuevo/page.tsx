import { requireUser } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { zonaLabel } from "@/lib/clasificados";
import { PanelShell } from "@/components/layout/panel-shell";
import { Formulario } from "./formulario";

export const metadata = { title: "Publicar un clasificado · Enséñame Ya" };

/** «YYYY-MM-DD» de hoy en `tz`. A nivel de módulo: leer el reloj en el render lo veta react-hooks. */
function hoyEn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

function masDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Clasificados · el alumno publica lo que quiere lograr. Quien valida es
 * `publicar_clasificado` (`20261125120000`); aquí solo se ayuda a rellenar.
 */
export default async function NuevoClasificadoPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; q?: string }>;
}) {
  const [{ user }, sp] = await Promise.all([requireUser(), searchParams]);
  const supabase = await createClient();

  const [cats, perfil] = await Promise.all([
    supabase
      .from("categories")
      .select("id, slug, name")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (cats.error) console.error("[clasificados/nuevo] categorías", cats.error);
  if (perfil.error) console.error("[clasificados/nuevo] perfil", perfil.error);

  // La MISMA zona que tomará el SQL: la del perfil, o UTC si no hay. No la del
  // navegador: la franja se guarda con la del perfil y decir otra sería mentir.
  const tz = perfil.data?.timezone || "UTC";
  const hoy = hoyEn(tz);
  const categorias = cats.data ?? [];
  const inicial = categorias.find((c) => c.slug === sp.categoria)?.id ?? "";

  return (
    <PanelShell
      title="Publica lo que quieres lograr"
      description="Los tutores de la categoría te escriben con una propuesta de clase lista para pagar. Sin datos personales: tu nombre no se publica."
    >
      {cats.error ? (
        <p className="text-sm text-destructive">
          No pudimos cargar las categorías. Recarga la página en un momento.
        </p>
      ) : (
        <Formulario
          categorias={categorias.map((c) => ({ id: c.id, name: c.name }))}
          categoriaInicial={inicial}
          objetivoInicial={(sp.q ?? "").trim().slice(0, 120)}
          zona={zonaLabel(tz)}
          hoy={hoy}
          maximo={masDias(hoy, 90)}
        />
      )}
    </PanelShell>
  );
}
