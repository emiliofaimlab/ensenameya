import Link from "next/link";

import { googleTemplateUrl, sesionIcsPath } from "@/lib/calendar/feed";
import { LOGOS_CALENDARIO } from "@/components/calendar/logos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ⚠️ Este aviso es la mitad del componente, no un adorno. EY-188 eligió feed
 * suscribible EN VEZ DE botón de descarga justo por esto: lo que se añade con
 * estos botones es una foto, y si la clase se mueve o se cancela el evento del
 * calendario sigue diciendo lo de antes.
 *
 * Vive aparte porque se monta en DOS sitios distintos y por el mismo motivo:
 * · En la ficha de la reserva lo pinta la CABECERA del bloque de sesiones, una
 *   sola vez. Un paquete de 8 clases enseñaba ocho copias del mismo párrafo
 *   —esa era la queja, no los botones—, y el aviso vale para todas.
 * · En la antesala de la sala solo hay UNA sesión, así que sigue pegado a su
 *   botón: allí `AddToCalendar` lo trae de serie (`conAviso`).
 */
export function AvisoCopiaCalendario({ className }: { className?: string }) {
  return (
    <p className={cn("text-[12px] text-[#6b6b6b]", className)}>
      Se añade una copia: si la clase cambia, el evento no se entera.{" "}
      <Link href="/account" className="underline underline-offset-2">
        Suscribe tu calendario
      </Link>{" "}
      y se actualiza solo.
    </p>
  );
}

/** Una silueta de simple-icons pintada en el color oficial de su marca. */
function LogoMarca({ marca }: { marca: keyof typeof LOGOS_CALENDARIO }) {
  const { src, color } = LOGOS_CALENDARIO[marca];
  return (
    <span
      aria-hidden="true"
      className="size-[18px]"
      style={{
        backgroundColor: color,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
        maskSize: "contain",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

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
 * Por eso el .ics lleva los DOS logos dentro de UN SOLO control: los destinos
 * siguen siendo dos, no tres, y Apple y Outlook comparten el mismo fichero.
 * El logo NO es el nombre accesible —un `<span>` con máscara no dice nada a un
 * lector de pantalla—: quien nombra cada control es su `aria-label`.
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
  conAviso = true,
}: {
  sessionId: string;
  titulo: string;
  /** ISO tal cual sale de la BD: `utc()` normaliza (regla de oro 4). */
  inicio: string;
  fin: string;
  /**
   * Por defecto SÍ, para que quien monte un botón suelto no se quede sin el
   * aviso de EY-188 por olvido. Lo apaga quien ya lo pinta una vez arriba —hoy
   * la ficha de la reserva, que repite el componente por cada sesión—.
   */
  conAviso?: boolean;
}) {
  return (
    /* Sin alineación propia: la pone quien lo monta. En la ficha de la reserva
       la columna ya es `items-end`; en la antesala de la sala, `items-center`. */
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button
          asChild
          variant="outline"
          /* Alto de 40px y no de 36: es un objetivo táctil, y sin texto dentro
             el ancho ya no lo estira nada. */
          className="h-10 px-3.5"
        >
          <a
            href={googleTemplateUrl({
              titulo,
              inicio,
              fin,
              detalle: "Mentoría reservada en Enséñame Ya.",
            })}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Añadir al calendario de Google"
          >
            <LogoMarca marca="google" />
          </a>
        </Button>
        <Button asChild variant="outline" className="h-10 gap-2.5 px-3.5">
          <a
            href={sesionIcsPath(sessionId)}
            download
            aria-label="Descargar .ics para Apple u Outlook"
          >
            <LogoMarca marca="apple" />
            <LogoMarca marca="outlook" />
          </a>
        </Button>
      </div>
      {conAviso ? <AvisoCopiaCalendario className="max-w-[16rem]" /> : null}
    </div>
  );
}
