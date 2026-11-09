"use client";

import { DownloadIcon } from "lucide-react";

import { aCsv, fechaCsv } from "@/lib/admin/csv";
import { Button } from "@/components/ui/button";

export type Lead = {
  id: string;
  name: string;
  email: string;
  documento: string;
  /** Solo en la vista del admin. */
  tutor?: string;
  /** ISO, para el CSV. */
  creado: string;
  /** Ya en la hora del que mira (se formatea en servidor). */
  cuando: string;
};

/**
 * EY-248 · Los leads de los descargables. La misma tabla para el tutor (los
 * suyos, por RLS) y el admin (todos, con columna de tutor). El CSV se arma en
 * el navegador: los datos ya están aquí y una ruta de exportación sería otra
 * guarda de rol que mantener.
 */
export function LeadsTable({ leads, conTutor = false }: { leads: Lead[]; conTutor?: boolean }) {
  function exportar() {
    const cab = ["Fecha", "Nombre", "Correo", "Documento", ...(conTutor ? ["Tutor"] : [])];
    const filas = leads.map((l) => [
      fechaCsv(l.creado),
      l.name,
      l.email,
      l.documento,
      ...(conTutor ? [l.tutor ?? ""] : []),
    ]);
    const url = URL.createObjectURL(new Blob([aCsv(cab, filas)], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "leads-descargables.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  if (leads.length === 0) {
    return (
      <p className="text-[13px] text-[#6b6b6b]">
        Todavía nadie ha descargado tus documentos.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportar}>
          <DownloadIcon /> Exportar CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="text-[#6b6b6b]">
            <tr className="border-b border-[#ececec]">
              <th className="py-2 pr-3 font-medium">Nombre</th>
              <th className="py-2 pr-3 font-medium">Correo</th>
              <th className="py-2 pr-3 font-medium">Documento</th>
              {conTutor ? <th className="py-2 pr-3 font-medium">Tutor</th> : null}
              <th className="py-2 font-medium">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-b border-[#f3f3f3] last:border-0">
                <td className="py-2 pr-3 text-[#19191f]">{l.name}</td>
                <td className="py-2 pr-3">
                  <a href={`mailto:${l.email}`} className="text-brand hover:underline">
                    {l.email}
                  </a>
                </td>
                <td className="py-2 pr-3">{l.documento}</td>
                {conTutor ? <td className="py-2 pr-3">{l.tutor}</td> : null}
                <td className="py-2 whitespace-nowrap text-[#6b6b6b]">{l.cuando}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
