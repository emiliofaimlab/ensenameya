/**
 * LA CADENA DE RESPALDO DEL COBRO — en qué orden se intenta, y **cuándo se deja
 * de intentar**.
 *
 * Es la regla 1 del §1 de `docs/PAGOS-Y-PAYOUTS.md` («el checkout tiene
 * respaldo»), que hasta hoy estaba escrita en el documento y no en el código:
 * `payment_routing_rules.charge_providers` ya era una lista ordenada
 * (`20260903140000`) y el Route Handler usaba UN proveedor — si no podía, el
 * alumno se quedaba sin comprar.
 *
 * ── POR QUÉ ESTE FICHERO NO IMPORTA NADA ────────────────────────────────────
 * Ni Next, ni Supabase, ni un adaptador. No es gusto por separar: es lo que
 * permite que `cadena.check.ts` ejecute esto con `node
 * --experimental-strip-types` y falle con exit code si alguien rompe el orden o
 * la regla de parada, igual que `check:chat` o `check:ics`. La función que
 * decide quién cobra mueve dinero: no puede quedarse sin una prueba que falle
 * cuando se rompa.
 *
 * Lo que sí sabe hacer el Route Handler y aquí no se hace: hablar con un
 * proveedor. El recorrido recibe la llamada ya envuelta (`intentar`) y solo
 * clasifica lo que devuelve.
 */

/** Un candidato que no cobró, con el motivo. Es lo que se le enseña al 503. */
export type Intento = { clave: string; motivo: string };

/**
 * Cómo acabó UN candidato. Las tres salidas salen de la forma del puerto
 * (`ChargeResult` en `lib/payments/port.ts`) y cada una tiene una consecuencia
 * distinta para la cadena:
 *
 *   · `descartado` → SE CAE AL SIGUIENTE. Solo los casos en que se puede
 *     DEMOSTRAR que no se creó nada: el candidato no es un PSP, le falta
 *     credencial (`missingChargeConfig()`), o el adaptador devolvió
 *     `{ok:false, creado:'nada'}` — un rechazo limpio del payload, que es el
 *     caso práctico de «dLocal no puede cobrar a este pagador».
 *
 *     ⚠️ AQUÍ ESTUVO ESCRITO que TODO `{ok:false}` era descartable «por
 *     contrato del puerto». Ese contrato no existía: el tipo era
 *     `{ok:false, error}` a secas y tres de sus cuatro sitios tienen un cobro
 *     vivo detrás. Ahora el adaptador lo declara (`creado`, en `port.ts`) y el
 *     compilador obliga a elegir a quien añada uno nuevo.
 *
 *   · `abierto` → hay cobro. Se para y se devuelve.
 *
 *   · `en-duda` → `charge()` LANZÓ (red, 5xx, timeout, un `DlocalGoError`
 *     reenviado). **NO se cae al siguiente**: ver `recorreLaCadena`.
 */
export type Salida<T> =
  | { tipo: "descartado"; motivo: string }
  | { tipo: "abierto"; cobro: T }
  | { tipo: "en-duda"; mensaje: string };

/**
 * Cómo acabó la cadena entera. `intentos` viaja en las tres: es lo que hace
 * depurable encender un proveedor — el 503 dice qué le faltaba a CADA uno, no
 * «no se pudo cobrar».
 */
export type Recorrido<T> =
  | { estado: "cobrado"; clave: string; cobro: T; intentos: Intento[] }
  | { estado: "en-duda"; clave: string; mensaje: string; intentos: Intento[] }
  | { estado: "nadie"; intentos: Intento[] };

/**
 * EL ORDEN EN QUE SE INTENTA, y los tres sitios de donde sale.
 *
 * No es `charge_providers` tal cual, y las dos cosas que se le ponen delante son
 * las que impiden abrir DOS cobros vivos para la misma reserva:
 *
 *   1. `cobrador` — quien ya abrió un cobro para este sujeto en una visita
 *      anterior (`payments.provider_metadata.checkout.cobrador`). Va PRIMERO
 *      siempre. Sin esto, el día que se arregle la credencial del preferido una
 *      recarga del checkout abriría un cobro nuevo con él mientras el que abrió
 *      el respaldo sigue vivo y pagable en el otro proveedor — dos cobros, un
 *      alumno, y la red de X-02 reembolsando después.
 *
 *   2. `snapshot` — `payments.provider`, lo que congeló `create_booking_line`.
 *      Es `charge_providers[1]` del día de la reserva, así que en el caso normal
 *      ya es la cabeza de `ruteo` y no cambia nada. Va explícito para el caso
 *      que sí importa: si alguien reordenó la tabla mientras había reservas a
 *      medias, esas reservas terminan por donde empezaron (el mismo criterio que
 *      documenta `adapterFor`).
 *
 * Después, `ruteo` entero y en su orden. Se quitan los repetidos y los vacíos:
 * un candidato dos veces en la cadena serían dos llamadas idénticas al mismo
 * proveedor, y la segunda con la misma clave de idempotencia no aporta nada.
 *
 * ⚠️ NO SE FILTRA POR DISPONIBILIDAD AQUÍ, igual que `chargeProvidersFor` no
 * filtra: quien cobra necesita saber qué se intentó. Un candidato que no puede
 * entra en la cadena, se descarta con su motivo y ese motivo acaba en el 503.
 */
export function cadenaDeCobro(opts: {
  cobrador: string | null;
  snapshot: string | null;
  ruteo: string[];
}): string[] {
  const cadena: string[] = [];
  for (const clave of [opts.cobrador, opts.snapshot, ...opts.ruteo]) {
    if (!clave) continue;
    if (cadena.includes(clave)) continue;
    cadena.push(clave);
  }
  return cadena;
}

/**
 * Recorre la cadena hasta que alguien cobre, hasta que se acaben los candidatos
 * o hasta que haya que PARAR.
 *
 * 🔴 LA REGLA DE PARADA ES LA MITAD DE ESTA FUNCIÓN, Y NO ES SIMÉTRICA CON EL
 * DESCARTE. Un candidato que devuelve `descartado` no creó nada —lo dice el
 * contrato del puerto— así que pasar al siguiente es gratis. Un candidato que
 * LANZA es otra cosa: **la petición pudo llegar**. Un timeout, un 502 de un
 * balanceador o una conexión cortada no dicen que el proveedor no haya abierto
 * el cobro; dicen que no sabemos si lo abrió.
 *
 * Abrir entonces un cobro con el siguiente proveedor deja potencialmente DOS
 * cobros vivos para la misma reserva, en dos proveedores distintos, y el alumno
 * puede pagar los dos. Es el mismo razonamiento que el estado `en-duda` de
 * `PayoutResult` —«entre puede que haya pagado y puede que no, reintentar es
 * elegir pagar dos veces»— aplicado al cobro: aquí no se paga dos veces, se
 * COBRA dos veces, y el que come el error es el alumno.
 *
 * Así que se para y se devuelve `en-duda`. Quien llama lo traduce a 503: se
 * reintenta recargando la pantalla, que es cuando el cobro ya abierto —si lo
 * hubo— se reencuentra por su lado (`refGuardada` en dLocal, la clave de
 * idempotencia en Stripe) en vez de duplicarse.
 *
 * ⚠️ Y NO ES EL CASO DE LA TARJETA RECHAZADA, que se confunde solo: eso ocurre
 * DESPUÉS, cuando el cobro ya está abierto y lo rechaza el banco del alumno.
 * No pasa por esta función, no es un fallo de proveedor y no tiene respaldo
 * posible — la respuesta a una tarjeta rechazada es otra tarjeta, no otra
 * pasarela.
 */
export async function recorreLaCadena<T>(
  cadena: string[],
  intentar: (clave: string) => Promise<Salida<T>>,
): Promise<Recorrido<T>> {
  const intentos: Intento[] = [];

  for (const clave of cadena) {
    const salida = await intentar(clave);

    if (salida.tipo === "abierto") {
      return { estado: "cobrado", clave, cobro: salida.cobro, intentos };
    }
    if (salida.tipo === "en-duda") {
      // 🔴 Se PARA. Ni un candidato más: leer el bloque de arriba antes de
      // convertir esto en un `continue`.
      intentos.push({ clave, motivo: salida.mensaje });
      return { estado: "en-duda", clave, mensaje: salida.mensaje, intentos };
    }
    intentos.push({ clave, motivo: salida.motivo });
  }

  return { estado: "nadie", intentos };
}

/** El 503 en una línea: qué le faltaba a cada candidato, en orden. */
export function porQueNadie(intentos: Intento[]): string {
  if (intentos.length === 0) return "no hay ninguna pasarela configurada para este destino";
  return intentos.map((i) => `${i.clave}: ${i.motivo}`).join(" · ");
}

/**
 * ¿Este error demuestra que la petición NUNCA LLEGÓ al proveedor?
 *
 * Existe por la regla del cliente (4-sep-2026): «si dLocal está caído por fallo
 * de sistema, mostramos Stripe». `recorreLaCadena` paraba en TODO lo que
 * lanzara, así que un dLocal apagado dejaba al alumno con un 503 y Stripe
 * intacto detrás — el respaldo no respaldaba justo en el caso para el que se
 * escribió.
 *
 * 🔴 LA LÍNEA NO ES «FALLÓ» / «NO FALLÓ», ES «SE ENVIÓ» / «NO SE ENVIÓ», y hay
 * que mantenerla ahí. `fetch` de Node envuelve los errores de socket en
 * `TypeError: fetch failed` con el motivo real en `cause.code`. Los de FASE DE
 * CONEXIÓN —DNS que no resuelve, puerto cerrado, no se pudo abrir el socket—
 * ocurren ANTES de mandar un solo byte: ahí no hay cobro posible y caer al
 * siguiente candidato es seguro.
 *
 * Lo que NO entra, y es deliberado: timeouts de respuesta, `ECONNRESET` y
 * cualquier 5xx. En esos la petición ya salió y el cobro pudo abrirse; probar
 * otra pasarela sería arriesgar DOS cobros vivos, que es lo que paga el alumno.
 *
 * ponytail: una lista de códigos, no una taxonomía de errores de red. El techo
 * es que solo cubre el caído de verdad; si un día hace falta cubrir también el
 * «responde 503 desde su balanceador», eso pide idempotencia en el adaptador
 * primero, no un código más en esta lista.
 */
export function nuncaLlego(e: unknown): boolean {
  const codigo = (e as { cause?: { code?: unknown } })?.cause?.code;
  return typeof codigo === "string" && CODIGOS_DE_CONEXION.has(codigo);
}

const CODIGOS_DE_CONEXION = new Set([
  "ECONNREFUSED",          // el puerto está cerrado: no hay nadie escuchando
  "ENOTFOUND",             // el DNS no resuelve su dominio
  "EAI_AGAIN",             // fallo temporal de DNS
  "EHOSTUNREACH",          // no hay ruta hasta su host
  "ENETUNREACH",           // no hay red
  "UND_ERR_CONNECT_TIMEOUT", // se agotó abriendo el socket, antes de enviar
  "CERT_HAS_EXPIRED",      // su TLS caducó: el handshake no llegó a completarse
]);
