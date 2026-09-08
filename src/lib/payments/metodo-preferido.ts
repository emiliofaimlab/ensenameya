/**
 * 🔑 POR DÓNDE QUIERE COBRAR EL TUTOR — y qué se le ofrece para elegir.
 *
 * Vive aquí y no en `lib/payments.ts` por lo mismo que `riel-viable.ts` y los
 * mapeos: ese módulo lleva `import "server-only"` y no puede ejecutarse en un
 * `--experimental-strip-types`. Lo que decide por dónde sale el dinero tiene que
 * poder probarse sin red ni credenciales (`npm run check:metodo`).
 *
 * ── MÉTODO ≠ RIEL, Y ESA ES TODA LA IDEA ────────────────────────────────────
 *
 * El enrutador razona en RIELES (`dlocal`, `wise`, `stripe`, `paypal`,
 * `manual`); el tutor razona en MÉTODOS, que es lo que él reconoce:
 *
 *     'banco'    → los rieles de familia 'banco' (dlocal Y wise)
 *     'stripe'   → el riel 'stripe' (cuenta conectada)
 *     'paypal'   → el riel 'paypal'
 *     <canal>    → el riel 'manual' con ESE canal ('zinli', 'zelle', 'binance'…)
 *
 * La asimetría importante es la primera: dLocal y Wise leen la MISMA fila de
 * `tutor_payout_accounts` y le ingresan en la MISMA cuenta. Lo único que los
 * separa es qué corresponsal usamos y cuánto nos cuesta — información que el
 * tutor no tiene y que no cambia nada de lo que él recibe. Por eso son UNA
 * tarjeta y no dos.
 *
 * ── LA PREFERENCIA REORDENA, NO DECIDE ──────────────────────────────────────
 *
 * `ordenaPorPreferencia` adelanta a los rieles del método elegido y NO quita a
 * nadie. Los tres filtros de `payoutProviderFor` —`puedePagar()`,
 * `ataduraDeBalance` y `rielSirveParaEsteTutor`— corren después, igual que
 * antes. Consecuencia buscada: elegir PayPal sin conectar la cuenta no atasca la
 * orden, se cae al siguiente candidato. Es lo que la pantalla promete con
 * «intentamos esa primero» — y por eso NO dice «solo esa».
 */

import type { RielMinimo } from "./riel-viable.ts";

/**
 * Las claves de método que NO son un canal manual. Todo lo que no esté aquí y
 * llegue como preferencia es, por definición, un `payout_manual_channels.channel`.
 *
 * ⚠️ Que la comprobación sea «no está en esta lista» y no «está en el catálogo»
 * es a propósito: el catálogo es una tabla y este módulo es puro. Un canal
 * inventado se comporta como cualquier preferencia sin candidato — no reordena
 * nada — que es exactamente el fallo seguro que documenta la migración.
 */
export const METODOS_FIJOS = ["banco", "stripe", "paypal"] as const;

/** El riel 'manual' es el único de identificador que NO es PayPal. */
export function esCanalManual(metodo: string): boolean {
  return !(METODOS_FIJOS as readonly string[]).includes(metodo);
}

/**
 * ¿Este riel es de los que sirven al método que el tutor eligió?
 *
 * Es el gemelo de `rielSirveParaEsteTutor` y contesta otra pregunta: aquel dice
 * si el riel PUEDE pagarle con lo que tiene registrado, y este si es el que él
 * QUIERE. Los dos hacen falta y en este orden — se ordena por el querer y se
 * filtra por el poder.
 */
export function rielSirveAlMetodo(riel: RielMinimo, metodo: string | null): boolean {
  if (!metodo) return false;
  switch (riel.dato) {
    case "conectada":
      return metodo === "stripe";
    case "banco":
      // dLocal y Wise a la vez, a propósito: ver la cabecera.
      return metodo === "banco";
    case "identificador":
      // Misma asimetría que en `rielSirveParaEsteTutor`: el riel de PayPal
      // quiere SU canal, y el manual cualquier otro. Sin `esCanalManual` el
      // riel manual se daría por elegido también cuando el tutor pidió 'banco'.
      return riel.clave === "paypal" ? metodo === "paypal" : esCanalManual(metodo);
  }
}

/**
 * Los candidatos, con los del método preferido delante. Estable: dentro de cada
 * grupo se conserva el orden de `payment_routing_rules`, que es el respaldo.
 *
 * Sin preferencia devuelve la misma lista, y esa igualdad es el contrato: un
 * tutor que no ha elegido rutea exactamente como antes de que esto existiera.
 */
export function ordenaPorPreferencia<T extends RielMinimo>(
  candidatos: T[],
  metodo: string | null,
): T[] {
  if (!metodo) return candidatos;
  const preferidos = candidatos.filter((r) => rielSirveAlMetodo(r, metodo));
  if (preferidos.length === 0) return candidatos;
  return [...preferidos, ...candidatos.filter((r) => !rielSirveAlMetodo(r, metodo))];
}

/* ══════════════════════════════════════════════════════════════════════════
 * LA OTRA MITAD: qué métodos se le OFRECEN, o sea qué tarjetas se pintan.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Una tarjeta de la lista, ya lista para pintar. */
export type MetodoDisponible = {
  /** Lo que se guarda en `tutor_payout_preferences.method`. */
  clave: string;
  familia: RielMinimo["dato"];
  /** El canal manual, cuando la tarjeta es uno. `null` en las otras tres. */
  canal: string | null;
  /**
   * ¿Lo ejecuta un proveedor o una persona? Se dice en pantalla porque es lo
   * único que el tutor puede comparar de verdad entre dos formas de cobro:
   * de la velocidad no hay ni una medida, y prometerla sería inventarla.
   */
  automatico: boolean;
};

/** Los rieles que ejecuta una persona, no un adaptador. Espejo de `RIELES`. */
const RIELES_A_MANO = new Set(["manual", "banco-manual"]);

/**
 * 🔑 LAS TARJETAS DE ESTE PAÍS, en el orden de preferencia de la tabla de ruteo.
 *
 * Se construye desde los RIELES que hoy pueden pagar ahí —no desde una lista de
 * países— por el mismo compromiso que el resto de la pantalla: abrir un país o
 * apagar un riel es tocar datos, no este fichero.
 *
 * `familias` llega ya filtrada por quien llama, y ese filtro no es cosmético: la
 * familia 'banco' se cae cuando el país no tiene fila en `payout_country_rules`,
 * porque sin ella no hay etiquetas que poner ni bancos que ofrecer y el
 * formulario no podría guardar. Es lo que hace que España —que rutea por la fila
 * por defecto, con Wise dentro— vea Stripe y PayPal y no una tarjeta de banco
 * que no se puede rellenar.
 */
export function metodosDelPais(args: {
  /** Los rieles que pueden pagar HOY en ese país, en orden de ruteo. */
  rieles: RielMinimo[];
  /** Las familias PINTABLES, en orden. Subconjunto de las de `rieles`. */
  familias: RielMinimo["dato"][];
  /** Canales manuales encendidos Y servibles en ese país, en orden de catálogo. */
  canalesActivos: string[];
}): MetodoDisponible[] {
  const { rieles, familias, canalesActivos } = args;
  const metodos: MetodoDisponible[] = [];

  for (const familia of familias) {
    const deLaFamilia = rieles.filter((r) => r.dato === familia);
    if (deLaFamilia.length === 0) continue;

    if (familia === "conectada") {
      metodos.push({ clave: "stripe", familia, canal: null, automatico: true });
      continue;
    }

    if (familia === "banco") {
      // UNA tarjeta para dLocal y Wise. Automática si alguno de los dos lo es:
      // hoy los dos lo son, y `banco-manual` ya no está en ninguna fila de
      // ruteo desde `20260903190000`.
      metodos.push({
        clave: "banco",
        familia,
        canal: null,
        automatico: deLaFamilia.some((r) => !RIELES_A_MANO.has(r.clave)),
      });
      continue;
    }

    // 'identificador' — aquí sí hay una tarjeta por destino, porque para el
    // tutor Zinli y Zelle son dos sitios distintos con dos datos distintos.
    const hayPaypal = deLaFamilia.some((r) => r.clave === "paypal");
    const hayManual = deLaFamilia.some((r) => r.clave !== "paypal");
    for (const canal of canalesActivos) {
      if (canal === "paypal") {
        if (hayPaypal) {
          metodos.push({ clave: "paypal", familia, canal, automatico: true });
        }
        continue;
      }
      if (hayManual) {
        metodos.push({ clave: canal, familia, canal, automatico: false });
      }
    }
  }

  return metodos;
}

/**
 * La preferencia que de verdad manda en pantalla.
 *
 * Sin elección guardada NO se inventa una: se devuelve `null` y la pantalla
 * pide que elija. Lo que sí se hace es descartar una elección que ya no está
 * disponible —el tutor eligió Zinli y su país dejó de ofrecerlo, o cambió de
 * país— porque enseñar un radio marcado en una tarjeta que no existe sería
 * decirle que cobra por donde no cobra.
 */
export function preferenciaVigente(
  guardada: string | null,
  metodos: MetodoDisponible[],
): string | null {
  if (!guardada) return null;
  return metodos.some((m) => m.clave === guardada) ? guardada : null;
}
