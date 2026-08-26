"use client";

import { useState, useSyncExternalStore } from "react";
import { CalendarSyncIcon, CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { feedUrl, googleAddUrl, webcalUrl } from "@/lib/calendar/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelCard, PanelCardTitle } from "@/components/layout/panel-shell";

/**
 * El origen del navegador, leído sin efecto.
 *
 * ⚠️ NO se puede calcular en el render a secas: este componente también se
 * renderiza en el servidor, donde `window` no existe, y devolver algo distinto
 * allí es un desajuste de hidratación. La solución obvia —`useEffect` que hace
 * `setOrigin`— la rechaza `react-hooks/set-state-in-effect`, y con razón: son
 * dos renders para leer un dato que nunca cambia.
 *
 * `useSyncExternalStore` es justo para esto, y ya se usa igual en
 * `components/chat/unread.ts`: instantánea del cliente, instantánea del
 * servidor, y una suscripción vacía porque el origen no se mueve nunca. Las
 * tres funciones viven a nivel de módulo para que su identidad sea estable.
 */
const nuncaCambia = () => () => {};
const leerOrigin = () => window.location.origin;
const leerOriginEnServidor = () => "";

/**
 * EY-188 (B5.5) · «Sincroniza tu calendario» en Mi cuenta.
 *
 * Vive en G03 y no en los paneles porque la pantalla la comparten alumno y
 * tutor —igual que `ReferralCard`, justo debajo— y la ficha pide las dos. El
 * feed no distingue rol: devuelve las sesiones en las que participas, seas
 * quien seas en ellas.
 *
 * ── LO QUE SE ENTREGA ES UNA URL, Y ESO CAMBIA EL TEXTO ─────────────────────
 * No es un archivo que se descarga: es una suscripción. Los botones de Apple y
 * Google son atajos, pero el camino que SIEMPRE funciona es copiar la URL y
 * pegarla en «añadir calendario desde un enlace», así que la URL se enseña
 * entera y en primer plano, no escondida detrás de los botones.
 *
 * ⚠️ El aviso de «cualquiera con este enlace…» no es texto de relleno. Es un
 * secreto que el usuario va a pegar en un servicio de terceros y que después
 * puede compartir sin darse cuenta (una captura, un correo a soporte). Tiene
 * que saber qué está repartiendo y que puede cortarlo de un clic.
 */
export function CalendarFeedCard({
  tokenInicial,
}: {
  tokenInicial: string | null;
}) {
  const [token, setToken] = useState(tokenInicial);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // Cadena vacía en el servidor y en el primer render; el origen de verdad en
  // cuanto hidrata. Ver `nuncaCambia` arriba.
  const origin = useSyncExternalStore(
    nuncaCambia,
    leerOrigin,
    leerOriginEnServidor,
  );

  async function activar() {
    setOcupado(true);
    const { data, error } = await createClient().rpc(
      "calendar_feed_token",
    );
    setOcupado(false);
    if (error || typeof data !== "string") {
      toast.error("No se pudo activar la sincronización. Intenta de nuevo.");
      return;
    }
    setToken(data);
    toast.success("Sincronización activada.");
  }

  async function desconectar() {
    setOcupado(true);
    const { error } = await createClient().rpc(
      "revoke_calendar_feed_token",
    );
    setOcupado(false);
    if (error) {
      toast.error("No se pudo desconectar. Intenta de nuevo.");
      return;
    }
    setToken(null);
    setCopiado(false);
    toast.success("Enlace anulado. Tu calendario dejará de actualizarse.");
  }

  async function copiar(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      toast.success("Enlace copiado.");
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS) no se puede copiar por
      // código. No es un fallo que haya que disculpar: la URL está a la vista y
      // se puede seleccionar a mano.
      toast.error("Copia el enlace a mano: está en el recuadro de arriba.");
    }
  }

  const url = origin && token ? feedUrl(origin, token) : "";

  return (
    <PanelCard>
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <CalendarSyncIcon className="size-5" />
      </span>
      <PanelCardTitle className="mt-4 text-xl">
        Sincroniza tu calendario
      </PanelCardTitle>
      <p className="mt-1 text-[12.5px] text-[#6b6b6b]">
        Suscribe Apple Calendar o Google Calendar a tus clases. No es una
        descarga: tu calendario vuelve a consultar el enlace cada cierto tiempo,
        así que las clases nuevas y las cancelaciones aparecen solas.
      </p>

      {token === null ? (
        <Button className="mt-4 h-10" onClick={activar} disabled={ocupado}>
          {ocupado ? "Activando…" : "Activar sincronización"}
        </Button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="feed-url" className="text-[12.5px]">
              Enlace de suscripción
            </Label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <Input
                id="feed-url"
                readOnly
                value={url}
                // Al enfocar se selecciona entero: en móvil el portapapeles
                // suele estar bloqueado y esto es lo que salva la copia manual.
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 font-mono text-[12px]"
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0"
                onClick={() => copiar(url)}
                disabled={!url}
              >
                {copiado ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </div>

          {/* Atajos. Se pintan solo cuando ya hay origen, porque hasta entonces
              el enlace estaría a medias. ⚠️ Son URL de terceros y su forma la
              deciden ellos: si algún día dejan de abrir el diálogo, sigue
              estando el camino de copiar y pegar, que no depende de nadie. */}
          {url ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="h-10">
                <a href={webcalUrl(origin, token)}>Añadir a Apple Calendar</a>
              </Button>
              <Button asChild variant="outline" className="h-10">
                <a
                  href={googleAddUrl(origin, token)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Añadir a Google Calendar
                </a>
              </Button>
            </div>
          ) : null}

          <p className="text-[12px] text-[#6b6b6b]">
            Cualquiera que tenga este enlace puede ver tus horarios de clase y el
            título de tus mentorías, sin necesidad de iniciar sesión. No permite
            entrar a las salas ni cambiar nada. Si crees que se ha filtrado,
            anúlalo: el enlace deja de funcionar al momento y luego puedes
            generar uno nuevo.
          </p>

          <div>
            <Button
              type="button"
              variant="destructive"
              className="h-10"
              onClick={desconectar}
              disabled={ocupado}
            >
              {ocupado ? "Anulando…" : "Anular enlace"}
            </Button>
          </div>
        </div>
      )}
    </PanelCard>
  );
}
