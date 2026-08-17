"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { formatMoney } from "@/lib/catalog/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PanelCard } from "@/components/layout/panel-shell";
import {
  ACEPTACION,
  ACEPTACION_DEFECTO,
  PAGO,
  PAGO_DEFECTO,
} from "@/app/api/admin/expirar-reservas/cutoffs";

/**
 * RV-20 · el disparador de `expire_stale_bookings`, con su vista previa.
 *
 * ESTE FORMULARIO NO PUEDE VENCER NADA POR SÍ MISMO. La función es de
 * `service_role` y ese grant no se ha reabierto: aquí solo se le pide al Route
 * Handler `/api/admin/expirar-reservas` que la llame, y él revalida el rol en
 * el servidor. Si alguien abre la consola y llama al endpoint a mano, se
 * encuentra la misma puerta.
 *
 * LA REGLA DE SEGURIDAD DE LA PANTALLA: no se puede ejecutar sin haber visto
 * antes la vista previa DE ESOS MISMOS PLAZOS. Cambiar cualquiera de los dos
 * desplegables invalida lo que había en pantalla y vuelve a deshabilitar el
 * botón. Es una acción sin deshacer que cancela reservas de otras personas y
 * encola reembolsos de verdad: obligar a mirar antes cuesta un clic y evita el
 * accidente de pulsar con "sin plazo" seleccionado creyendo que estaba en 24 h.
 */

type Reserva = {
  id: string;
  ref: string | null;
  titulo: string;
  alumno: string;
  tutor?: string;
  importe: number;
  currency: string;
};

type Previa = {
  plazos: { aceptacion: { label: string }; pago: { label: string } };
  muestra: number;
  sinPagar: { total: number; reservas: Reserva[] };
  sinAceptar: {
    total: number;
    reembolso: { currency: string; amount: number }[];
    reservas: Reserva[];
  };
};

type Resultado = {
  payment_expired: number;
  acceptance_expired: number;
  refunds_enqueued: number;
};

export function ExpireForm() {
  const router = useRouter();

  const [aceptacion, setAceptacion] = useState(ACEPTACION_DEFECTO);
  const [pago, setPago] = useState(PAGO_DEFECTO);

  const [previa, setPrevia] = useState<Previa | null>(null);
  /** Los plazos con los que se pidió la previa; si cambian, ya no vale. */
  const [previaDe, setPreviaDe] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const [cargando, setCargando] = useState(false);
  const [ejecutando, setEjecutando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const clave = `${aceptacion}|${pago}`;
  const previaVigente = previa !== null && previaDe === clave;
  const peligro = ACEPTACION[aceptacion]?.peligro || PAGO[pago]?.peligro;

  function cambiar(set: (v: string) => void) {
    return (v: string) => {
      set(v);
      // No se borra la previa, pero deja de estar vigente (`previaDe` ya no
      // coincide con la selección) y por tanto desaparece de la pantalla junto
      // con el botón de ejecutar. Se conserva solo para poder decir "los plazos
      // han cambiado" en vez del mensaje inicial: enseñar una lista de reservas
      // que ya no describe lo seleccionado es justo el accidente que esta
      // pantalla intenta evitar.
      setResultado(null);
    };
  }

  async function verPrevia() {
    setCargando(true);
    setResultado(null);
    try {
      const res = await fetch(
        `/api/admin/expirar-reservas?aceptacion=${aceptacion}&pago=${pago}`,
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo consultar.");
        return;
      }
      setPrevia(data as Previa);
      setPreviaDe(clave);
    } catch {
      toast.error("No se pudo consultar. ¿Sigue viva la sesión?");
    } finally {
      setCargando(false);
    }
  }

  async function ejecutar() {
    setEjecutando(true);
    try {
      const res = await fetch("/api/admin/expirar-reservas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aceptacion, pago }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo ejecutar.");
        return;
      }
      const r = data.resultado as Resultado;
      setResultado(r);
      setConfirmando(false);
      // La previa ya no describe la realidad: lo que había, ya no está.
      setPrevia(null);
      setPreviaDe(null);
      toast.success(
        `${r.payment_expired + r.acceptance_expired} reservas vencidas · ${r.refunds_enqueued} reembolsos encolados.`,
      );
      // Refresca los contadores que pinta el Server Component de al lado.
      router.refresh();
    } catch {
      toast.error("No se pudo ejecutar.");
    } finally {
      setEjecutando(false);
    }
  }

  const totalPrevia = previa
    ? previa.sinPagar.total + previa.sinAceptar.total
    : 0;

  return (
    <div className="flex flex-col gap-5">
      <PanelCard className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cutoff-aceptacion">
              Plazo de aceptación del tutor
            </Label>
            <select
              id="cutoff-aceptacion"
              className="h-10 min-w-[300px] rounded-md border bg-transparent px-3 text-sm"
              value={aceptacion}
              onChange={(e) => cambiar(setAceptacion)(e.target.value)}
            >
              {Object.entries(ACEPTACION).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cutoff-pago">Plazo de pago</Label>
            <select
              id="cutoff-pago"
              className="h-10 min-w-[280px] rounded-md border bg-transparent px-3 text-sm"
              value={pago}
              onChange={(e) => cambiar(setPago)(e.target.value)}
            >
              {Object.entries(PAGO).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="outline"
            disabled={cargando}
            onClick={verPrevia}
            className="h-10 rounded-[8px] px-4 text-[13.5px]"
          >
            {cargando ? "Consultando…" : "Ver qué se vencería"}
          </Button>
        </div>

        {peligro ? (
          <p className="rounded-[8px] bg-[#f7dede] px-3 py-2 text-[13px] text-[#8f2b2b]">
            Has elegido un plazo <strong>sin margen</strong>: eso alcanza a{" "}
            <strong>todas</strong> las reservas de la plataforma que estén en ese
            estado ahora mismo, no solo a las tuyas de prueba. Míralo antes de
            ejecutar.
          </p>
        ) : null}

        <p className="text-xs text-[#6b6b6b]">
          Los plazos salen de una lista cerrada: son los mismos valores que
          acepta el servidor. Con los reales (24 h y 20 min) esto hace justo lo
          que ya hace el cron cada 5 minutos.
        </p>
      </PanelCard>

      {previaVigente && previa ? (
        <PanelCard className="flex flex-col gap-4">
          <div>
            <h3 className="text-[15px] font-bold text-[#19191f]">
              Se vencerían {totalPrevia}{" "}
              {totalPrevia === 1 ? "reserva" : "reservas"}
            </h3>
            <p className="mt-1 text-[13px] text-[#6b6b6b]">
              Con estos plazos, y según cómo estén las cosas en este momento. Es
              una foto: si mientras tanto alguien paga o un tutor acepta, esa
              reserva ya no entra.
            </p>
          </div>

          <Bloque
            titulo={`Sin pagar · ${previa.sinPagar.total}`}
            explicacion="Se cancelan y se libera el horario. No hay reembolso: nunca se llegó a cobrar."
            reservas={previa.sinPagar.reservas}
            muestra={previa.muestra}
            total={previa.sinPagar.total}
          />

          <Bloque
            titulo={`Sin respuesta del tutor · ${previa.sinAceptar.total}`}
            explicacion={
              previa.sinAceptar.reembolso.length > 0
                ? `Se cancelan y se encola el 100 % (RN-38): ${previa.sinAceptar.reembolso
                    .map((m) => formatMoney(m.amount, m.currency))
                    .join(" + ")} en reembolsos reales.`
                : "Se cancelan y se devuelve el 100 % (RN-38)."
            }
            reservas={previa.sinAceptar.reservas}
            muestra={previa.muestra}
            total={previa.sinAceptar.total}
            dinero
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={ejecutando || totalPrevia === 0}
              onClick={() => setConfirmando(true)}
              className="h-[43px] rounded-[8px] bg-[#bf3333] px-6 font-semibold text-white hover:bg-[#a82c2c]"
            >
              Vencer ahora
            </Button>
            {totalPrevia === 0 ? (
              <span className="text-[13px] text-[#6b6b6b]">
                No hay nada que vencer con estos plazos.
              </span>
            ) : null}
          </div>
        </PanelCard>
      ) : (
        <p className="text-[13px] text-[#6b6b6b]">
          {previa === null
            ? "Elige los plazos y consulta la vista previa: hasta verla no se puede ejecutar."
            : "Los plazos han cambiado. Vuelve a consultar la vista previa antes de ejecutar."}
        </p>
      )}

      {resultado ? (
        <PanelCard className="border-[#a8d8b9] bg-[#f0faf3]">
          <p className="text-[13px] font-semibold text-[#1f6b40]">Hecho.</p>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[#1f6b40]">
            <li>
              {resultado.payment_expired} sin pagar → canceladas, horario
              liberado.
            </li>
            <li>
              {resultado.acceptance_expired} sin respuesta del tutor →
              canceladas.
            </li>
            <li>
              <strong>{resultado.refunds_enqueued}</strong> reembolsos encolados.{" "}
              <a
                href="/admin/reembolsos"
                className="font-semibold underline underline-offset-2"
              >
                Verlos en la cola
              </a>
              . Ojo: encolados, no ejecutados — el dinero sale cuando corra
              /api/cron/refunds-process.
            </li>
          </ul>
        </PanelCard>
      ) : null}

      {/* Confirmación en diálogo de la app y no en `window.confirm()`, por lo
          mismo que N-34: tras varios seguidos el navegador ofrece bloquearlos y
          desde ahí `confirm()` devuelve false sin preguntar. Aquí eso sería
          creer que se ejecutó y que no pasó nada. */}
      <Dialog
        open={confirmando}
        onOpenChange={ejecutando ? undefined : setConfirmando}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>¿Vencer {totalPrevia} reservas?</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-2 text-left">
                <p>
                  Se cancelan reservas de otras personas y se liberan sus
                  sesiones. No se puede deshacer.
                </p>
                {previa && previa.sinAceptar.total > 0 ? (
                  <p className="font-semibold text-[#8f2b2b]">
                    {previa.sinAceptar.total} de ellas están pagadas: se encolan{" "}
                    {previa.sinAceptar.reembolso
                      .map((m) => formatMoney(m.amount, m.currency))
                      .join(" + ")}{" "}
                    en reembolsos reales contra el PSP, y a sus alumnos les
                    llegará el aviso de cancelación.
                  </p>
                ) : null}
                <p>
                  Plazos: aceptación {ACEPTACION[aceptacion]?.label} · pago{" "}
                  {PAGO[pago]?.label}.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={ejecutando}
              onClick={() => setConfirmando(false)}
            >
              No, volver
            </Button>
            <Button
              disabled={ejecutando}
              onClick={ejecutar}
              className="bg-[#bf3333] font-semibold text-white hover:bg-[#a82c2c]"
            >
              {ejecutando ? "Venciendo…" : "Sí, vencer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Bloque({
  titulo,
  explicacion,
  reservas,
  muestra,
  total,
  dinero,
}: {
  titulo: string;
  explicacion: string;
  reservas: Reserva[];
  muestra: number;
  total: number;
  dinero?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-[#e0e0e0] p-4">
      <p className="text-[13.5px] font-semibold text-[#19191f]">{titulo}</p>
      <p className="mt-0.5 text-xs text-[#6b6b6b]">{explicacion}</p>

      {reservas.length === 0 ? (
        <p className="mt-2 text-[13px] text-[#6b6b6b]">Ninguna.</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-[#f0f0f0]">
            {reservas.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0 truncate text-[13px] text-[#404040]">
                  {r.ref ?? `#${r.id.slice(0, 8)}`} · {r.titulo} · {r.alumno}
                  {r.tutor ? ` → ${r.tutor}` : ""}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[13px] tabular-nums",
                    dinero ? "font-semibold text-[#8f2b2b]" : "text-[#6b6b6b]",
                  )}
                >
                  {formatMoney(r.importe, r.currency)}
                </span>
              </li>
            ))}
          </ul>
          {total > muestra ? (
            <p className="mt-2 text-xs text-[#6b6b6b]">
              Se enseñan las {muestra} más antiguas de {total}. Se vencerían
              todas.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
