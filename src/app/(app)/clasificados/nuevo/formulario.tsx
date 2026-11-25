"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { DIAS, type Franja } from "@/lib/clasificados";
import { PanelCard } from "@/components/layout/panel-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const SELECT =
  "h-10 w-full rounded-[8px] border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Lunes primero: es como piensa la semana quien estudia. */
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

export function Formulario({
  categorias,
  categoriaInicial,
  objetivoInicial,
  zona,
  hoy,
  maximo,
}: {
  categorias: { id: string; name: string }[];
  categoriaInicial: string;
  objetivoInicial: string;
  /** «hora de Caracas»: la de `profiles.timezone`, que es la que toma el SQL. */
  zona: string;
  hoy: string;
  maximo: string;
}) {
  const [categoria, setCategoria] = useState(categoriaInicial);
  const [objetivo, setObjetivo] = useState(objetivoInicial);
  const [detalle, setDetalle] = useState("");
  const [franjas, setFranjas] = useState<Franja[]>([{ dia: 1, desde: "18:00", hasta: "20:00" }]);
  const [fecha, setFecha] = useState("");
  const [busy, setBusy] = useState(false);

  function cambiar(i: number, parche: Partial<Franja>) {
    setFranjas((fs) => fs.map((f, j) => (j === i ? { ...f, ...parche } : f)));
  }

  async function publicar(e: React.FormEvent) {
    e.preventDefault();
    if (!categoria) return toast.error("Elige una categoría.");
    if (objetivo.trim().length < 3) return toast.error("Cuéntanos en una línea qué quieres lograr.");
    if (franjas.length === 0) return toast.error("Indica al menos un horario en que puedes.");
    if (franjas.some((f) => !f.desde || !f.hasta || f.desde >= f.hasta)) {
      return toast.error("En cada horario, «desde» tiene que ser antes que «hasta».");
    }

    setBusy(true);
    const { data, error } = await createClient().rpc("publicar_clasificado", {
      p_category: categoria,
      p_goal: objetivo.trim(),
      // El SQL convierte el vacío en null (`nullif(btrim(...))`).
      p_detail: detalle.trim(),
      p_slots: franjas,
      // Los tipos generados no marcan el argumento como opcional, pero el SQL acepta null.
      p_needed_by: (fecha || null) as string,
    });
    if (error || !data) {
      setBusy(false);
      // El mensaje de la RPC ya viene redactado para el alumno.
      toast.error(error?.message || "No se pudo publicar. Inténtalo de nuevo.");
      return;
    }
    toast.success("¡Publicado! Ya avisamos a los tutores de la categoría.");
    // Recarga completa: el destino cruza a otra pantalla con guarda (regla de oro 13).
    window.location.assign(`/clasificados/${data}`);
  }

  return (
    <form onSubmit={publicar} className="flex max-w-[720px] flex-col gap-5">
      <PanelCard className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cl-categoria">Categoría</Label>
          <select
            id="cl-categoria"
            className={SELECT}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            required
          >
            <option value="" disabled>
              Elige una categoría
            </option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cl-objetivo">¿Qué quieres lograr?</Label>
          <Input
            id="cl-objetivo"
            value={objetivo}
            onChange={(e) => setObjetivo(e.target.value)}
            maxLength={120}
            required
            placeholder="Ej.: aprobar el examen de cálculo de diciembre"
          />
          <p className="text-right text-[11px] text-muted-foreground">{objetivo.length}/120</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cl-detalle">
            Detalle <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id="cl-detalle"
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            maxLength={1000}
            rows={5}
            placeholder="Tu nivel, los temas que te cuestan, cómo te gusta aprender…"
          />
          <p className="flex justify-between gap-3 text-[11px] text-muted-foreground">
            <span>Sin teléfonos ni correos: el contacto va por el chat de la plataforma.</span>
            <span className="shrink-0">{detalle.length}/1000</span>
          </p>
        </div>
      </PanelCard>

      <PanelCard className="flex flex-col gap-4">
        <div>
          <p className="text-sm font-semibold">¿Cuándo puedes?</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Horarios semanales en tu {zona}. Los tutores solo te proponen clases dentro de ellos.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {franjas.map((f, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <label className="flex w-full flex-col gap-1 text-[12px] text-muted-foreground sm:w-44">
                Día
                <select
                  className={SELECT}
                  value={f.dia}
                  onChange={(e) => cambiar(i, { dia: Number(e.target.value) })}
                >
                  {ORDEN_DIAS.map((d) => (
                    <option key={d} value={d}>
                      {DIAS[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground sm:max-w-40">
                Desde
                <Input type="time" value={f.desde} onChange={(e) => cambiar(i, { desde: e.target.value })} required />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-muted-foreground sm:max-w-40">
                Hasta
                <Input type="time" value={f.hasta} onChange={(e) => cambiar(i, { hasta: e.target.value })} required />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label="Quitar este horario"
                disabled={franjas.length === 1}
                onClick={() => setFranjas((fs) => fs.filter((_, j) => j !== i))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>

        {franjas.length < 21 ? (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => setFranjas((fs) => [...fs, { ...(fs.at(-1) ?? { dia: 1, desde: "18:00", hasta: "20:00" }) }])}
          >
            <PlusIcon /> Agregar otro horario
          </Button>
        ) : null}
      </PanelCard>

      <PanelCard className="flex flex-col gap-1.5">
        <Label htmlFor="cl-fecha">
          ¿Para cuándo lo necesitas? <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id="cl-fecha"
          type="date"
          className="w-full sm:w-[220px]"
          value={fecha}
          min={hoy}
          max={maximo}
          onChange={(e) => setFecha(e.target.value)}
        />
        <p className="text-[12px] text-muted-foreground">
          Si la indicas, el clasificado se cierra al acabar ese día. Si no, sigue abierto 14 días.
        </p>
      </PanelCard>

      <Button type="submit" disabled={busy} className="h-11 w-full rounded-[8px] font-semibold sm:w-fit sm:px-8">
        {busy ? "Publicando…" : "Publicar clasificado"}
      </Button>
    </form>
  );
}
