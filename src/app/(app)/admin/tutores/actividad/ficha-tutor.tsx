"use client";

import { useState } from "react";
import Link from "next/link";

import type { TutorTeachingRow } from "@/lib/admin/queries";
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

/**
 * La ficha completa de un tutor, en un diálogo. Gemela de `FichaAlumno`.
 *
 * ⚠️ NO DUPLICA `/admin/tutores/[id]`, que es SCR-AD05 y hace otra cosa: allí se
 * REVISA —documentos KYC con enlaces firmados, aprobar, rechazar, asignar
 * tier— y aquí solo se MIRA. Por eso esto no enseña ni un documento ni un botón
 * de acción: enseña el recuento y manda allí, que es donde esas acciones quedan
 * registradas. Si algún día hay que actuar desde aquí, la puerta es ese enlace,
 * no una copia de sus botones.
 *
 * ⚠️ TAMPOCO ENSEÑA LA CUENTA BANCARIA: solo si la hay, el país y los últimos
 * cuatro. El número completo y el documento de identidad no salen de la base
 * (`20260917180000`), así que aquí no hay nada que esconder — pero conviene
 * saber por qué está a medias cuando alguien lo busque.
 *
 * El contenido solo existe con el diálogo abierto, y de eso depende que las
 * fechas no canten hidratación: se formatean con el reloj del navegador. Radix
 * no monta `DialogContent` con `open` en falso y el estado inicial siempre lo
 * es. La zona horaria llega como prop y es la del ADMIN (regla de oro 4).
 */
export function FichaTutor({
  tutor: t,
  tz,
}: {
  tutor: TutorTeachingRow;
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

  const precio =
    t.precioDesde === null || t.moneda === null
      ? "—"
      : t.precioDesde === t.precioHasta
        ? formatMoney(t.precioDesde, t.moneda)
        : `${formatMoney(t.precioDesde, t.moneda)} – ${formatMoney(t.precioHasta ?? 0, t.moneda)}`;

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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {t.nombre}
              <StatusPill tone={TONO_APROBACION[t.estadoAprobacion] ?? "neutral"}>
                {ETIQUETA_APROBACION[t.estadoAprobacion] ?? t.estadoAprobacion}
              </StatusPill>
              {t.suspendido ? <StatusPill tone="red">Suspendido</StatusPill> : null}
              {t.baja ? (
                <StatusPill tone="amber">
                  {t.baja.estado === "completed" ? "Dado de baja" : "Baja pedida"}
                </StatusPill>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              Ficha interna de solo lectura. Para revisar documentos o cambiar su
              estado,{" "}
              <Link
                href={`/admin/tutores/${t.tutorId}`}
                className="text-brand hover:underline"
              >
                abrir su revisión
              </Link>
              .
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <Bloque titulo="Contacto">
              <Dato etiqueta="Correo" valor={t.correo ?? "Sin correo"} copiable />
              <Dato
                etiqueta="Teléfono"
                valor={t.telefono ?? "Sin teléfono"}
                copiable={!!t.telefono}
              />
              <Dato etiqueta="Zona horaria" valor={t.zonaHoraria ?? "—"} />
              <Dato etiqueta="Registro" valor={fecha(t.alta)} />
              {t.nombrePublico && t.nombrePublico !== t.nombre ? (
                <Dato
                  etiqueta="Nombre público"
                  valor={t.nombrePublico}
                  nota="El que se ve en su perfil; arriba está el real."
                />
              ) : null}
              {t.academia ? <Dato etiqueta="Academia" valor={t.academia} /> : null}
            </Bloque>

            <Bloque titulo="Perfil">
              <Dato etiqueta="Titular" valor={t.titular ?? "—"} />
              <Dato etiqueta="Nivel que enseña" valor={t.nivel ?? "—"} />
              <Dato
                etiqueta="Categorías"
                valor={t.categorias.length ? t.categorias.join(" · ") : "Ninguna"}
              />
              <Dato
                etiqueta="Enlaces"
                valor={
                  t.redes.length
                    ? t.redes.map((r) => r.platform).join(" · ")
                    : "Ninguno"
                }
              />
            </Bloque>

            <Bloque titulo="Aprobación">
              <Dato etiqueta="Estado" valor={ETIQUETA_APROBACION[t.estadoAprobacion] ?? t.estadoAprobacion} />
              <Dato etiqueta="Aprobado el" valor={fecha(t.aprobadoEl)} />
              <Dato etiqueta="Identidad" valor={t.identidad} />
              <Dato
                etiqueta="Documentos"
                valor={
                  t.documentos.length
                    ? t.documentos.map((d) => `${d.n} ${d.estado}`).join(" · ")
                    : "Ninguno subido"
                }
                // El recuento y nada más: los enlaces al bucket se firman a 5
                // minutos y se revisan en SCR-AD05, no aquí.
                nota="Son 6 los que se piden. Para verlos, su revisión."
              />
              {t.notasAprobacion ? (
                <Dato etiqueta="Notas" valor={t.notasAprobacion} />
              ) : null}
            </Bloque>

            <Bloque titulo="Lo que ofrece">
              <Cifra etiqueta="Mentorías publicadas" valor={t.mentoriasPublicadas} />
              <Dato etiqueta="Precio" valor={precio} />
              <Dato
                etiqueta="Todas sus mentorías"
                valor={
                  t.mentoriasDetalle.length
                    ? t.mentoriasDetalle.map((m) => `${m.n} ${m.estado}`).join(" · ")
                    : "Ninguna"
                }
              />
              <Cifra
                etiqueta="Franjas de horario"
                valor={t.franjasDisponibles}
                tenue
              />
            </Bloque>

            <Bloque titulo="Docencia">
              <Cifra etiqueta="Impartidas" valor={t.impartidas} />
              {/* Aparte y sin sumarse: si un no-show cuenta como clase dada es
                  DP-08, sin responder. Y significa que no entró NADIE. */}
              <Cifra etiqueta="No abrió nadie" valor={t.noShows} tenue />
              <Cifra etiqueta="Canceladas" valor={t.canceladas} tenue />
              <Cifra etiqueta="Alumnos distintos" valor={t.alumnosDistintos} />
              <Dato etiqueta="Primera" valor={fecha(t.primeraClase)} />
              <Dato etiqueta="Última" valor={fecha(t.ultimaClase)} />
              <Dato
                etiqueta="Próxima"
                valor={fecha(t.proximaClase, true)}
                nota={t.proximaClase ? "No se acota al período: es de hoy." : undefined}
              />
            </Bloque>

            {t.alumnos.length ? (
              <Bloque titulo="Con qué alumnos repite">
                <div className="col-span-full flex flex-wrap gap-2">
                  {t.alumnos.map((a) => (
                    <span
                      key={a.nombre}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#e0e0e0] px-3 py-1 text-[13px] text-[#404040]"
                    >
                      {a.nombre}
                      <span className="font-semibold tabular-nums text-[#19191f]">
                        {a.mentorias}
                      </span>
                    </span>
                  ))}
                </div>
              </Bloque>
            ) : null}

            <Bloque titulo="Reputación">
              <Dato
                etiqueta="Nota media"
                valor={t.notaMedia === null ? "—" : `${t.notaMedia} ★`}
              />
              <Cifra etiqueta="Reseñas recibidas" valor={t.resenas} />
            </Bloque>

            <Bloque titulo="Dinero">
              <Dato
                etiqueta="Tier"
                valor={
                  t.tier ? `${t.tier}${t.tierSplitPct ? ` · ${t.tierSplitPct} %` : ""}` : "Sin tier"
                }
                nota="El porcentaje es lo que se queda él."
              />
              <Dato
                etiqueta="Generado (bruto)"
                valor={
                  t.generado.length
                    ? t.generado.map((g) => formatMoney(g.bruto, g.currency)).join(" · ")
                    : "—"
                }
                nota="Lo que pagaron sus alumnos, cargo por servicio incluido."
              />
              <Dato
                etiqueta="Le corresponde"
                valor={
                  t.generado.length
                    ? t.generado.map((g) => formatMoney(g.neto_tutor, g.currency)).join(" · ")
                    : "—"
                }
              />
              <Dato
                etiqueta="Comisión de la plataforma"
                valor={
                  t.generado.length
                    ? t.generado.map((g) => formatMoney(g.comision, g.currency)).join(" · ")
                    : "—"
                }
                // ⚠️ La nota anterior decía que las tres cifras «no cuadran», y
                // es falso justo donde más se mira: los pagos ANTERIORES al
                // 16-sep llevan el cargo a 0, así que ahí suman exacto. Esto es
                // cierto siempre.
                nota="Bruto = le corresponde + comisión + el cargo por servicio del alumno (5 % desde el 16-sep, 0 en los pagos anteriores)."
              />
              <Dato etiqueta="Cobra por" valor={t.metodoDeCobro ?? "Sin elegir"} />
              <Dato
                etiqueta="Cuenta de cobro"
                valor={
                  t.cuentaConfigurada
                    ? `${t.cuentaPais ?? "?"} · ****${t.cuentaUltimos4 ?? "????"}`
                    : "Sin configurar"
                }
                nota="El número completo no sale de la base, a propósito."
              />
            </Bloque>

            {t.payouts.length ? (
              <Bloque titulo="Payouts">
                <div className="col-span-full flex flex-wrap gap-2">
                  {t.payouts.map((p) => (
                    <StatusPill
                      key={`${p.estado}-${p.currency}`}
                      tone={TONO_PAYOUT[p.estado] ?? "neutral"}
                    >
                      {p.estado} · {p.n} · {formatMoney(p.importe, p.currency)}
                    </StatusPill>
                  ))}
                </div>
                <p className="col-span-full text-xs text-[#6b6b6b]">
                  Todos los suyos, sin acotar al período: lo que se le debe es de
                  hoy. El detalle y las acciones están en{" "}
                  <Link href="/admin/payouts" className="text-brand hover:underline">
                    Payouts
                  </Link>
                  .
                </p>
              </Bloque>
            ) : null}

            {t.suspension || t.baja || t.terminos ? (
              <Bloque titulo="Cuenta">
                {t.suspension ? (
                  <Dato
                    etiqueta="Suspendido"
                    valor={`Desde ${fecha(t.suspension.desde)}`}
                    nota={t.suspension.motivo ?? undefined}
                  />
                ) : null}
                {t.baja ? (
                  <Dato
                    etiqueta="Baja"
                    valor={`${t.baja.estado} · pedida ${fecha(t.baja.solicitada)}`}
                  />
                ) : null}
                <Dato
                  etiqueta="Términos aceptados"
                  valor={
                    t.terminos
                      ? `${t.terminos.version} · ${fecha(t.terminos.aceptados)}`
                      : "Sin registro"
                  }
                />
              </Bloque>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const ETIQUETA_APROBACION: Record<string, string> = {
  pending: "Por aprobar",
  approved: "Aprobado",
  rejected: "Rechazado",
  suspended: "Suspendido",
};

const TONO_APROBACION: Record<string, PillTone> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  suspended: "red",
};

const TONO_PAYOUT: Record<string, PillTone> = {
  paid: "green",
  pending: "amber",
  scheduled: "blue",
  processing: "blue",
  failed: "red",
  on_hold: "amber",
};

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
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
