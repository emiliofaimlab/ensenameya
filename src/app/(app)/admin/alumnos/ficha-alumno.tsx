"use client";

import { useState } from "react";

import type { StudentLearningRow } from "@/lib/admin/queries";
import { formatMoney } from "@/lib/catalog/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill, type PillTone } from "@/components/layout/panel-shell";
import { BOOKING_BADGE } from "../badges";

/**
 * La ficha completa de un alumno, en un diálogo.
 *
 * POR QUÉ UN COMPONENTE CLIENTE Y NO UNA RUTA. El cliente pidió «un modal con
 * toda la información», y una ruta `/admin/alumnos/[id]` costaría una carga
 * entera —consulta incluida— por cada alumno que se quiera mirar. Aquí la fila
 * ya viene con todo desde el servidor, así que abrir la ficha es instantáneo y
 * no hay ningún `route.ts` de por medio.
 *
 * ⚠️ EL CONTENIDO SOLO EXISTE CON EL DIÁLOGO ABIERTO, y de eso depende que las
 * fechas no canten un error de hidratación: se formatean con el reloj del
 * navegador, que en el servidor daría otra cosa. Radix no monta `DialogContent`
 * mientras `open` es falso y el estado inicial SIEMPRE es cerrado, así que ese
 * HTML no se renderiza nunca en el servidor. Si algún día esto se convierte en
 * una ruta, las fechas hay que formatearlas arriba.
 *
 * La zona horaria llega como prop y es la del ADMIN (regla de oro 4): la base
 * guarda UTC y aquí se pinta en la hora de quien mira, no en la del alumno —
 * que se enseña aparte, como dato suyo que es.
 */
export function FichaAlumno({
  alumno: a,
  tz,
}: {
  alumno: StudentLearningRow;
  tz: string;
}) {
  const [open, setOpen] = useState(false);

  const fecha = (iso: string | null, conHora = false) =>
    iso
      ? new Date(iso).toLocaleString("es", {
          day: "numeric",
          month: "short",
          year: "numeric",
          ...(conHora ? { hour: "2-digit", minute: "2-digit" } : {}),
          timeZone: tz,
        })
      : "—";

  const dinero = (
    g: { currency: string; gastado?: number; saldo?: number }[],
    campo: "gastado" | "saldo" = "gastado",
  ) =>
    g.length === 0
      ? "—"
      : g.map((x) => formatMoney(x[campo] ?? 0, x.currency)).join(" · ");

  const devuelto = a.gastado.filter((g) => g.devuelto > 0);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 rounded-[8px] px-3.5 text-[13px] text-[#595959]"
      >
        Ver detalle
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Alto acotado y scroll dentro: la ficha de alguien con diez tutores y
            siete estados de reserva no cabe en una pantalla de portátil, y un
            diálogo que desborda deja el botón de cerrar fuera de alcance. */}
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {a.nombre}
              {a.suspendido ? (
                <StatusPill tone="red">Suspendido</StatusPill>
              ) : null}
              {a.baja ? (
                <StatusPill tone="amber">
                  {a.baja.estado === "completed" ? "Dada de baja" : "Baja pedida"}
                </StatusPill>
              ) : null}
              {!a.onboardingCompleto ? (
                <StatusPill tone="amber">Registro a medias</StatusPill>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              Ficha interna. Nada de esto se publica en ningún perfil.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <Bloque titulo="Contacto">
              <Dato etiqueta="Correo" valor={a.correo ?? "Sin correo"} copiable />
              <Dato
                etiqueta="Teléfono"
                valor={a.telefono ?? "Sin teléfono"}
                copiable={!!a.telefono}
                // No es lo mismo «no tiene» que «no se lo pedimos»: el registro
                // normal lo exige en su último paso, así que si falta es que la
                // cuenta nació pagando como invitado, que se salta ese paso.
                nota={
                  a.telefono
                    ? undefined
                    : "La cuenta se creó al pagar como invitado, que se salta el paso del teléfono."
                }
              />
              <Dato etiqueta="Zona horaria" valor={a.zonaHoraria ?? "—"} />
              <Dato etiqueta="Registro" valor={fecha(a.alta)} />
            </Bloque>

            <Bloque titulo="Qué vino a hacer">
              <Dato etiqueta="Objetivo" valor={a.objetivo ?? "No lo dijo"} />
              <Dato
                etiqueta="Intereses"
                valor={a.intereses.length ? a.intereses.join(" · ") : "Ninguno"}
              />
              <Dato
                etiqueta="Vino por una invitación"
                valor={a.vinoReferido ? "Sí" : "No"}
              />
              <Dato etiqueta="Su código de invitación" valor={a.codigoReferido ?? "—"} />
            </Bloque>

            <Bloque titulo="Mentorías">
              <Cifra etiqueta="Tomadas" valor={a.tomadas} />
              {/* Aparte y sin sumarse: si un no-show cuenta como clase es DP-08,
                  que sigue sin respuesta. Y aquí «no-show» es que no entró
                  NADIE: la base no sabe quién faltó (`20260716120000`). */}
              <Cifra etiqueta="No abrió nadie" valor={a.noShows} tenue />
              <Cifra etiqueta="Canceladas" valor={a.canceladas} tenue />
              <Cifra etiqueta="Tutores distintos" valor={a.tutoresDistintos} />
              <Dato etiqueta="Primera" valor={fecha(a.primeraClase)} />
              <Dato etiqueta="Última" valor={fecha(a.ultimaClase)} />
              <Dato
                etiqueta="Próxima"
                valor={fecha(a.proximaClase, true)}
                nota={a.proximaClase ? "No se acota al período: es de hoy." : undefined}
              />
            </Bloque>

            {a.tutores.length ? (
              <Bloque titulo="Con quién ha estudiado más">
                <div className="col-span-full flex flex-wrap gap-2">
                  {a.tutores.map((t) => (
                    <span
                      key={t.nombre}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#e0e0e0] px-3 py-1 text-[13px] text-[#404040]"
                    >
                      {t.nombre}
                      <span className="font-semibold tabular-nums text-[#19191f]">
                        {t.mentorias}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="col-span-full text-xs text-[#6b6b6b]">
                  Por clases dadas, no por perfiles vistos: lo que navega cada
                  quien no se guarda para el panel, a propósito.
                </p>
              </Bloque>
            ) : null}

            <Bloque titulo="Reservas">
              <Cifra etiqueta="Llegaron a pagarse" valor={a.reservas} />
              <div className="col-span-full flex flex-wrap gap-2">
                {a.reservasDetalle.length === 0 ? (
                  <p className="text-[13px] text-[#6b6b6b]">Ninguna todavía.</p>
                ) : (
                  a.reservasDetalle.map((r) => (
                    <StatusPill key={r.estado} tone={TONO_RESERVA[r.estado] ?? "neutral"}>
                      {BOOKING_BADGE[r.estado as keyof typeof BOOKING_BADGE]?.label ??
                        r.estado}{" "}
                      · {r.n}
                    </StatusPill>
                  ))
                )}
              </div>
            </Bloque>

            <Bloque titulo="Dinero">
              <Dato
                etiqueta="Gastado"
                valor={dinero(a.gastado)}
                nota="De su bolsillo: el bruto menos lo que cubrieran créditos o regalos, con el cargo por servicio dentro."
              />
              <Dato
                etiqueta="Devuelto"
                valor={devuelto.length ? dinero(devuelto.map((g) => ({ currency: g.currency, gastado: g.devuelto }))) : "—"}
              />
              <Cifra etiqueta="Pagos" valor={a.pagos} />
              <Dato
                etiqueta="Medios que usó"
                valor={a.mediosDePago.length ? a.mediosDePago.join(" · ") : "—"}
              />
              <Dato
                etiqueta="Crédito sin gastar"
                valor={dinero(a.creditoDisponible, "saldo")}
                nota="Saldo de hoy, no del período."
              />
            </Bloque>

            <Bloque titulo="Lo que dejó por escrito">
              <Cifra etiqueta="Reseñas" valor={a.resenas} />
              <Dato
                etiqueta="Nota que pone de media"
                valor={a.notaMedia === null ? "—" : `${a.notaMedia} ★`}
              />
              <Dato
                etiqueta="Términos aceptados"
                valor={
                  a.terminos
                    ? `${a.terminos.version} · ${fecha(a.terminos.aceptados)}`
                    : "Sin registro"
                }
              />
            </Bloque>

            {a.suspension || a.baja ? (
              <Bloque titulo="Incidencias de la cuenta">
                {a.suspension ? (
                  <Dato
                    etiqueta="Suspendida"
                    valor={`Desde ${fecha(a.suspension.desde)}`}
                    nota={a.suspension.motivo ?? undefined}
                  />
                ) : null}
                {a.baja ? (
                  <Dato
                    etiqueta="Baja"
                    valor={`${a.baja.estado} · pedida ${fecha(a.baja.solicitada)}`}
                    nota={
                      a.baja.completada
                        ? `Ejecutada ${fecha(a.baja.completada)}`
                        : undefined
                    }
                  />
                ) : null}
              </Bloque>
            ) : null}

            <p className="text-xs text-[#6b6b6b]">
              No aparecen aquí sus conversaciones ni por dónde navega: ninguna de
              las dos cosas se abre al panel, y en los dos casos es una decisión
              tomada, no un dato que falte. Para actuar sobre esta cuenta —
              escribirle o desactivarla— la puerta es Reportes.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Mismo mapa estado→tono que el resto del panel; local a la pantalla, con red. */
const TONO_RESERVA: Record<string, PillTone> = {
  confirmed: "green",
  in_progress: "green",
  completed: "neutral",
  pending_acceptance: "blue",
  pending_payment: "neutral",
  cancelled: "red",
  refunded: "red",
};

function Bloque({
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

function Dato({
  etiqueta,
  valor,
  nota,
  copiable = false,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
  copiable?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] text-[#6b6b6b]">{etiqueta}</p>
      <p
        className={
          copiable
            ? "truncate select-all text-[13px] font-medium text-[#19191f]"
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

function Cifra({
  etiqueta,
  valor,
  tenue = false,
}: {
  etiqueta: string;
  valor: number;
  tenue?: boolean;
}) {
  return (
    <div>
      <p className="text-[11.5px] text-[#6b6b6b]">{etiqueta}</p>
      <p
        className={`text-[18px] font-bold tabular-nums ${
          tenue && valor === 0 ? "text-[#b0b0b0]" : "text-[#19191f]"
        }`}
      >
        {valor}
      </p>
    </div>
  );
}
