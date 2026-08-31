import Link from "next/link";

import { googleTemplateUrl, sesionIcsPath } from "@/lib/calendar/feed";
import { Button } from "@/components/ui/button";

/**
 * «Añadir al calendario» — una clase, dos caminos.
 *
 * ⚠️ DOS ENLACES Y NO UNO, y no es indecisión:
 * · Google Calendar de escritorio **no consume un .ics descargado** — obliga a
 *   Configuración → Importar. Para él, una plantilla `render?action=TEMPLATE`.
 * · Apple e iOS solo pasan el archivo a Calendario si llega servido con
 *   `Content-Type: text/calendar`; un blob montado en el navegador acaba en
 *   Archivos. Para ellos, el endpoint.
 *
 * Presentacional a secas: solo arma cadenas de URL. NO puede importar
 * `lib/calendar/ics.ts`, que es `server-only`; `utc()` vive en `ics-format.ts`,
 * que no lo es, y por eso `googleTemplateUrl` sí se puede llamar desde aquí.
 */
export function AddToCalendar({
  sessionId,
  titulo,
  inicio,
  fin,
}: {
  sessionId: string;
  titulo: string;
  /** ISO tal cual sale de la BD: `utc()` normaliza (regla de oro 4). */
  inicio: string;
  fin: string;
}) {
  return (
    /* Sin alineación propia: la pone quien lo monta. En la ficha de la reserva
       la columna ya es `items-end`; en la antesala de la sala, `items-center`. */
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-9 text-[13px]">
          <a
            href={googleTemplateUrl({
              titulo,
              inicio,
              fin,
              detalle: "Mentoría reservada en Enséñame Ya.",
            })}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Calendar
          </a>
        </Button>
        <Button asChild variant="outline" className="h-9 text-[13px]">
          <a href={sesionIcsPath(sessionId)} download>
            Apple / Outlook (.ics)
          </a>
        </Button>
      </div>
      {/* ⚠️ Este aviso es la mitad del componente, no un adorno. EY-188 eligió
          feed suscribible EN VEZ DE botón de descarga justo por esto: lo que se
          añade aquí es una foto, y si la clase se mueve o se cancela el evento
          del calendario sigue diciendo lo de antes. */}
      <p className="max-w-[16rem] text-[12px] text-[#6b6b6b]">
        Se añade una copia: si la clase cambia, el evento no se entera.{" "}
        <Link href="/account" className="underline underline-offset-2">
          Suscribe tu calendario
        </Link>{" "}
        y se actualiza solo.
      </p>
    </div>
  );
}
