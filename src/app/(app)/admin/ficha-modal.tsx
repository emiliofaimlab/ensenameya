"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * El armazón compartido de los modales que PIDEN su contenido al abrirse.
 *
 * Existe porque `/admin/bookings` y `/admin/payments` necesitan exactamente el
 * mismo comportamiento —botón, diálogo, carga, error, reintento— y solo cambian
 * el título y lo que se pinta dentro. Las fichas de alumno y tutor NO lo usan:
 * aquellas ya tienen el dato en memoria y no piden nada, así que meterlas aquí
 * sería inventar una abstracción para dos casos que no se parecen.
 *
 * ⚠️ SE PIDE AL ABRIR Y SOLO UNA VEZ. Sin la guarda de `datos`, cada apertura
 * repetiría la consulta; con ella, cerrar y volver a abrir es instantáneo. El
 * dato no se refresca solo: es una ficha que se mira, no un panel en vivo.
 */
export function FichaModal<T>({
  etiqueta = "Ver detalle",
  titulo,
  descripcion,
  url,
  children,
}: {
  etiqueta?: string;
  titulo: string;
  descripcion?: React.ReactNode;
  url: string;
  children: (datos: T) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function pedir() {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(url);
      if (!r.ok) {
        // El mensaje del servidor es más útil que «algo falló»: distingue
        // «sesión caducada» de «ya no existe», que se arreglan de formas
        // distintas.
        const cuerpo = await r.json().catch(() => null);
        throw new Error(cuerpo?.error ?? `Error ${r.status}`);
      }
      setDatos((await r.json()) as T);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar");
    } finally {
      setCargando(false);
    }
  }

  function abrir() {
    setOpen(true);
    if (!datos && !cargando) void pedir();
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={abrir}
        className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
      >
        {etiqueta}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            {descripcion ? (
              <DialogDescription>{descripcion}</DialogDescription>
            ) : null}
          </DialogHeader>

          {cargando ? (
            <p className="py-6 text-center text-[13px] text-[#6b6b6b]">
              Cargando…
            </p>
          ) : error ? (
            <div className="flex flex-col items-start gap-3 rounded-[12px] border border-[#e8b4b4] bg-[#fdf2f2] p-4">
              <p className="text-[13px] text-[#a82929]">{error}</p>
              <Button
                variant="outline"
                onClick={() => void pedir()}
                className="h-9 rounded-[8px] px-3.5 text-[13px]"
              >
                Reintentar
              </Button>
            </div>
          ) : datos ? (
            <div className="flex flex-col gap-5">{children(datos)}</div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Bloque({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold tracking-wide text-brand">
        {titulo.toUpperCase()}
      </h3>
      <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function Dato({
  etiqueta,
  valor,
  nota,
  copiable = false,
  ancho = false,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  copiable?: boolean;
  ancho?: boolean;
}) {
  return (
    <div className={ancho ? "col-span-full min-w-0" : "min-w-0"}>
      <p className="text-[11.5px] text-[#6b6b6b]">{etiqueta}</p>
      <p
        className={
          copiable
            ? "truncate select-all font-mono text-[12.5px] text-[#19191f]"
            : "truncate text-[13px] font-medium text-[#404040]"
        }
        title={valor}
      >
        {valor}
      </p>
      {nota ? <p className="mt-0.5 text-[11px] text-[#8a8a8a]">{nota}</p> : null}
    </div>
  );
}
