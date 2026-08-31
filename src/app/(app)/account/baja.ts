import { formatMoney } from "@/lib/catalog/format";
import type {
  Accionables,
  EnEspera,
  EstadoBaja,
} from "@/app/api/cuenta/eliminar/rpc";

/**
 * Los textos de la baja de cuenta, en un solo sitio.
 *
 * Los comparten el diálogo de confirmación y la tarjeta de «cuenta
 * desactivada», que cuentan lo MISMO en dos momentos distintos: antes de
 * pedirla y mientras se espera. Si divergen, la persona lee dos versiones de
 * su propia situación y no sabe cuál creer.
 *
 * ⚠️ Los tipos vienen del contrato del handler (`api/cuenta/eliminar/rpc.ts`) y
 * se importan con `import type`, que TypeScript borra al compilar: nada de
 * aquel módulo entra en el bundle del navegador.
 */

export type { Accionables, EnEspera, EstadoBaja };

/** ¿Está la cuenta desactivada esperando a que se mueva el dinero? */
export function estaDesactivada(estado: EstadoBaja | null): boolean {
  return Boolean(estado?.baja_programada);
}

/** ¿Queda algo en vuelo? (lo que convierte la baja en programada). */
export function hayDineroEnVuelo(e: EnEspera): boolean {
  return Object.keys(e).some(
    (k) => k !== "saldo_moneda" && k !== "saldo_liquidable_desde",
  );
}

/**
 * Lo que la persona tiene que hacer ELLA. Cada texto dice la ACCIÓN y dónde,
 * no el nombre del campo.
 *
 * La asimetría entre tutor y alumno es deliberada y está razonada en la
 * migración: el alumno puede cancelar y salir; el tutor no, porque son clases
 * vendidas a terceros que solo se cierran impartiéndolas.
 */
export function explicarAccionables(a: Accionables): string[] {
  const fuera: string[] = [];

  if (a.clases_futuras_como_tutor) {
    fuera.push(
      `Tienes ${a.clases_futuras_como_tutor} clase(s) ya vendidas y sin impartir. ` +
        "Son compromisos con tus alumnos: hay que darlas (o que ellos las cancelen) antes de poder darte de baja.",
    );
  }
  if (a.clases_futuras_como_alumno) {
    fuera.push(
      `Tienes ${a.clases_futuras_como_alumno} clase(s) reservadas y sin dar. ` +
        "Cancélalas primero desde «Mis reservas»: así se te aplica la política de reembolso que corresponda.",
    );
  }
  return fuera;
}

/**
 * Fecha larga y en la hora local de quien mira (RN-01/RN-02): las de la base
 * vienen en UTC. Devuelve `null` —y no «Invalid Date»— cuando no hay fecha o
 * no se puede leer, para que quien la use decida qué frase escribir sin ella.
 */
export function fechaLegible(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * El dinero en vuelo, explicado por lo que va a PASAR con él y —cuando se
 * puede saber— cuándo. Es la mitad de la promesa que hace la pantalla: «tu
 * cuenta se borra sola», sin decir cuándo, es una espera sin final.
 *
 * ⚠️ El importe solo se enseña si viene con moneda. `saldo_moneda` llega vacío
 * cuando el saldo está repartido en varias monedas, y ahí sumarlo no
 * significaría nada (RN-13): se dice que hay saldo, sin cifra.
 */
export function explicarEnEspera(e: EnEspera): string[] {
  const fuera: string[] = [];

  if (e.saldo_sin_liquidar) {
    const importe =
      e.saldo_moneda != null
        ? formatMoney(e.saldo_sin_liquidar, e.saldo_moneda)
        : null;
    const desde = fechaLegible(e.saldo_liquidable_desde);
    fuera.push(
      (importe
        ? `Te quedan ${importe} por cobrar de clases ya impartidas.`
        : "Te queda saldo por cobrar de clases ya impartidas.") +
        // La fecha es el fin de la retención; el abono llega en el lote
        // semanal siguiente (`run-payout-batch`, los lunes). Se dice el día de
        // la semana porque «pronto» no es una respuesta.
        (desde
          ? ` Se libera el ${desde} y se abona en el pago semanal del lunes siguiente.`
          : " Se abona en el próximo pago semanal (los lunes)."),
    );
  }
  if (e.payouts_en_curso) {
    fuera.push(
      `Tienes ${e.payouts_en_curso} retiro(s) en curso. Te avisamos en cuanto el dinero salga.`,
    );
  }
  if (e.reembolsos_pendientes) {
    fuera.push(
      `Tienes ${e.reembolsos_pendientes} reembolso(s) en curso. Una vez enviados, tu banco tarda entre 5 y 10 días hábiles en abonarlos.`,
    );
  }
  return fuera;
}

/**
 * Qué se puede y qué no mientras la cuenta está desactivada. Es exactamente lo
 * que la gente acaba preguntando a soporte cuando no está escrito en pantalla.
 *
 * «Puedes entrar» es la decisión menos obvia de toda la ficha y por eso va la
 * primera: lo que la persona está esperando es dinero suyo, y cerrarle la
 * puerta mientras espera sería lo peor que se podría hacer. El razonamiento
 * completo está en la cabecera de la migración `20260831160000`.
 */
export function mientrasDesactivada(esTutor: boolean): {
  puedes: string[];
  noPuedes: string[];
} {
  return {
    puedes: [
      "Entrar a tu cuenta y seguir tus pagos y reembolsos.",
      "Responder a las conversaciones que tengas abiertas.",
      "Cambiar de idea y volver a activar tu cuenta.",
    ],
    noPuedes: [
      "Reservar clases nuevas.",
      ...(esTutor
        ? [
            "Aparecer en el buscador ni recibir reservas: tus mentorías quedan en pausa (se reactivan si vuelves).",
          ]
        : []),
    ],
  };
}
