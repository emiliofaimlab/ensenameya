import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { adapterFor, payoutProviderFor, rielDePayout } from "@/lib/payments";
import type { PayoutInput, PayoutResult, PspProvider } from "@/lib/payments/port";

/**
 * C2 · EL EJECUTOR DE PAYOUTS — le paga al tutor de verdad.
 *
 * ── QUÉ PASABA ─────────────────────────────────────────────────────────────
 * El lote semanal (`run_payout_batch` → `build_payout_for_tutor`) calcula lo que
 * se le debe a cada tutor y **ahí se paraba**: en todo el repo no había una sola
 * línea que llamara a un PSP para pagar. Lo que había era peor que nada:
 * `process_scheduled_payouts()` marcaba `status='paid'` con `provider='simulated'`
 * sin llamar a nadie, y eso disparaba `notify_payout()` y con él el correo NTF-12
 * «Se pagó tu liquidación» a un tutor que no había cobrado. C1
 * (`20260901120000`) desarmó esa mentira dejando la función en solo-informa.
 * Este archivo es lo que la sustituye.
 *
 * ── POR QUÉ UN ROUTE HANDLER Y NO SQL ──────────────────────────────────────
 * Porque **Postgres no puede llamar a la API de un PSP**. Es el mismo motivo por
 * el que el correo y los reembolsos viven aquí: la base de datos ENCOLA (aquí la
 * cola es la propia tabla `payouts` en 'scheduled') y un proceso con
 * `service_role` EJECUTA. El gemelo más cercano —y de donde sale la forma de
 * este archivo, incluido el trato de los fallos transitorios frente a los
 * permanentes— es `src/app/api/cron/refunds-process/route.ts`.
 *
 * ── 🔴 LA REGLA QUE ORDENA TODO: NO HAY CLAVE DE IDEMPOTENCIA ──────────────
 * `POST /v1/payouts` de dLocal Go no tiene ninguna: ni cabecera, ni
 * `external_id`, ni el `order_id` que salva al cobro. Y encima **un 400 puede
 * haber creado el payout igual** (hay tres en `FAILED` en el sandbox nacidos de
 * respuestas de error), y la cancelación no sirve de red: devolvió
 * `2316 not cancellable` a los ~18 minutos pese a estar `PENDING`. O sea que un
 * reintento por timeout es un pago doble con dinero real y no hay «deshacer».
 *
 * La idempotencia se emula con DOS piezas, y ninguna vale sin la otra:
 *
 *   1. **EL CANDADO, aquí.** Una orden se reclama con
 *      `update payouts set status='processing' … where id=? and status='scheduled'`.
 *      Es una escritura condicional y atómica: de dos pasadas solapadas solo una
 *      la gana, y la que pierde ni siquiera mira al proveedor. En el mismo
 *      `update` se sella en `provider_metadata` el instante del reclamo, que es
 *      la frontera temporal del barrido.
 *   2. **EL BARRIDO, en `dlocal-provider.ts`.** Una orden ya reclamada que
 *      vuelve sin identificador NO se reintenta: se le pregunta a
 *      `GET /v1/payouts` si existe un payout posterior al reclamo que cuadre con
 *      ella. Si existe, se adopta; si se prueba que no, vuelve a la cola; y si no
 *      se puede saber, se queda en 'processing' y **no la toca nadie**.
 *
 * ── LA OTRA REGLA, MÁS CORTA: QUIÉN PUEDE ESCRIBIR CADA ESTADO ─────────────
 *   · `paid` lo escribe **solo** el proveedor diciendo DELIVERED o COMPLETED.
 *     Nunca al recibir un 2xx de la creación —dLocal nace PENDING— y nunca «por
 *     si acaso». De esa línea cuelga NTF-12.
 *   · `failed` lo escribe **solo** un rechazo del proveedor. Todo lo que ESTE
 *     job decide no mandar (falta la decisión del cambio, el balance es de otro,
 *     el tutor no tiene datos, no hay saldo, no hay credencial) deja la fila en
 *     'scheduled' y se CUENTA en la respuesta. Marcarlo 'failed' mandaría al
 *     tutor la incidencia NTF-16 por una indecisión nuestra, y exigiría un
 *     `manage_payout('retry')` a mano para algo que se arregla solo.
 *
 * ── LO QUE HOY BLOQUEA CASI TODO, DICHO AQUÍ PARA QUE NO SE DEPURE A CIEGAS ─
 *   · **El balance.** Las diez filas de `payment_routing_rules` dicen
 *     `charge_provider='stripe'` con `payout_provider='dlocal'`. O sea que todo
 *     payout nuevo nace con `funding_provider='stripe'` y su ejecutor es dLocal
 *     Go, que paga de SU balance: el dinero está en otro sitio. Mientras eso no
 *     se resuelva —cobrando por dLocal donde se vaya a pagar por dLocal, o
 *     fondeando su balance a propósito, que es una decisión de tesorería— este
 *     job cuenta esas órdenes en `balanceAjeno` y no manda ninguna.
 *   · **El tipo de cambio.** `payouts.currency` es USD y `currency_to_pay` es la
 *     moneda local en 7 de los 8 países. Ecuador es el único que paga en USD, o
 *     sea el único que hoy no exige una decisión de producto que nadie ha tomado.
 *     Ver `sinDecidirCambio`.
 */

/** Node, no edge: por debajo del puerto está el cliente del PSP. */
export const runtime = "nodejs";

/**
 * 🔴 DOS CUPOS, NO UNO, Y ESTA ES LA DIFERENCIA MÁS IMPORTANTE DE ESTE ARCHIVO.
 *
 * Antes había un solo tope de 10 que se repartían las dos colas: primero lo que
 * está en vuelo y con lo que sobrara, lo nuevo. Suena razonable y es una bomba:
 * las órdenes en vuelo que se quedan atascadas —una en duda no sale sola, se
 * queda hasta que la mire una persona— **no se van nunca**, así que diez de
 * ellas se comen el cupo entero de cada pasada y **ningún tutor vuelve a
 * cobrar**. En silencio, además: la respuesta seguiría diciendo `status: "ok"` y
 * el workflow saldría verde.
 *
 * Con dos cupos independientes, un atasco en vuelo no puede robarle sitio a un
 * pago nuevo. Y la cola en vuelo se recorre por `updated_at` ascendente —lo que
 * más tiempo lleva sin tocarse, primero— para que las mismas diez filas
 * atascadas no acaparen todas las pasadas: cada intento escribe en la fila, así
 * que rotan solas.
 *
 * Los topes son bajos a propósito: cada vuelta puede mover el saldo de una
 * semana de un tutor y, en el peor caso, pasea decenas de páginas del listado
 * del proveedor. Lo que sobre sale en la pasada siguiente.
 */
const LOTE_EN_VUELO = 10;
const LOTE_NUEVOS = 10;

/**
 * Cuánto tiene que llevar una orden reclamada sin identificador antes de que se
 * la barra.
 *
 * ⚠️ NO ES PRUDENCIA GENÉRICA: es que el listado del proveedor puede tardar en
 * enseñar un payout recién creado, y un barrido demasiado pronto devolvería
 * «ausente» sobre algo que existe. Y «ausente» es precisamente lo que autoriza a
 * devolver la orden a la cola, o sea a mandarla otra vez.
 *
 * Medido el 2-sep-2026, la propagación fueron **once segundos**: payout creado a
 * las 16:11:12 y visible en `GET /v1/payouts` a las 16:11:23. Los quince minutos
 * se quedan igualmente, y con motivo: una medida no es una garantía, y lo que se
 * arriesga al acortarlos es un pago doble. Esperar no cuesta nada — el pago ya
 * está hecho o no, y esperar no lo cambia.
 */
const ESPERA_ANTES_DE_BARRER_MS = 15 * 60 * 1000;

/** Una orden de pago, con lo justo para ejecutarla. */
type OrdenDePago = {
  id: string;
  tutor_id: string;
  status: string;
  currency: string;
  amount: number;
  provider: string | null;
  provider_payout_id: string | null;
  provider_metadata: unknown;
  funding_provider: string | null;
  payee_country: string | null;
  scheduled_for: string | null;
  /** Lo bumpea el trigger `payouts_set_updated_at` en cada escritura nuestra. */
  updated_at: string;
};

const COLUMNAS =
  "id, tutor_id, status, currency, amount, provider, provider_payout_id, provider_metadata, funding_provider, payee_country, scheduled_for, updated_at";

/** El rastro que este job deja en `provider_metadata`. Sin PII, nunca. */
type Rastro = {
  /** ISO del `update` que ganó la orden. Es el `claimedAt` del puerto. */
  reclamado_en?: string;
  /**
   * 🔑 EL NÚMERO DE INTENTO, que junto a `payouts.id` forma la marca que viaja en
   * `description` y que sustituye a la clave de idempotencia que dLocal Go no
   * tiene. Empieza en 1 y **solo sube cuando el payout anterior está muerto en el
   * proveedor** — nunca por reintentar, nunca por un fallo transitorio.
   *
   * Si sube de más, el barrido de la orden busca una marca que nunca se escribió
   * y no encuentra el pago que sí salió. Si no sube cuando debe,
   * `manage_payout('retry')` reencuentra el payout rechazado y no reintenta
   * jamás. Por eso lo escribe un solo sitio: el caso `difunto` de abajo.
   */
  intento?: number;
  /**
   * Los `provider_payout_id` de intentos anteriores que el proveedor dio por
   * muertos. Se archivan en vez de borrarse: es la única traza que queda para
   * conciliar contra su panel un rechazo que ya no está en la fila.
   */
  intentos_muertos?: string[];
  /** Cómo acabó el último intento, en el vocabulario del puerto. */
  ultimo_estado?: string;
  ultimo_mensaje?: string;
  ultimo_intento_en?: string;
  /** El estado tal como lo nombra el proveedor. Para conciliar con su panel. */
  proveedor_detalle?: string;
};

function rastroDe(fila: OrdenDePago): Rastro {
  const m = fila.provider_metadata;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const c2 = (m as Record<string, unknown>).c2;
    if (c2 && typeof c2 === "object") return c2 as Rastro;
  }
  return {};
}

/**
 * El adaptador ya estrechado a PSP, o `null`.
 *
 * `adapterFor` devuelve `AnyProvider` porque 'simulated' —y cualquier clave
 * desconocida— cae al proveedor que no sale de casa, que no sabe pagar. Aquí eso
 * significa «esta orden no tiene ejecutor», que es una respuesta legítima y hay
 * que contarla, no un error que reventar.
 *
 * ⚠️ NO SIRVE PARA DECIDIR SI LA ORDEN ES UN PROBLEMA, y por eso la llamada de
 * abajo pregunta antes por `rielDePayout()`. 'manual' también devuelve null aquí
 * —es un `LocalProvider`, no sabe pagar— y sin embargo es lo contrario de un
 * callejón sin salida: es una orden que paga una persona.
 */
function pspDe(clave: string | null): PspProvider | null {
  const p = adapterFor(clave);
  return p.opensRemoteCheckout ? p : null;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;

  // FALLA CERRADO, igual que los otros tres jobs, y aquí con más motivo que en
  // ninguno: sin secreto esto sería un endpoint público capaz de vaciar la cola
  // de payouts de la plataforma contra el PSP. Que no corra retiene dinero de
  // los tutores; que lo dispare cualquiera lo manda.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurada" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  // Ensayo: dice de cada orden qué haría y por qué, sin reclamar nada, sin
  // llamar a nadie y sin escribir una fila. Es la única forma de mirar por dentro
  // de este job antes de que mueva el primer dólar — y ahora mismo es también la
  // única forma de ejecutarlo, porque el reloj no existe fuera de `main`.
  const simulacro = new URL(req.url).searchParams.get("simulacro") === "1";

  const admin = createAdminClient();
  const ahora = () => new Date().toISOString();

  // ── La cola ───────────────────────────────────────────────────────────────
  //
  // ⚠️ SON DOS COLAS Y EL ORDEN IMPORTA. Primero lo que ya está EN VUELO
  // ('processing'), y no por cortesía: de esas filas cuelgan el correo NTF-12 y
  // la baja de cuenta programada, que retiene al tutor mientras tenga un payout
  // sin cerrar. Y sobre todo, ahí es donde vive el peligro: una orden reclamada
  // sin identificador es la única fila del sistema que puede corresponder a un
  // pago que nadie ha identificado. Se mira antes de crear nada nuevo.
  //
  // service_role a propósito: `payouts` es admin-only por RLS y este trabajo no
  // tiene ninguna persona detrás. Regla de oro 9 — los grants (select + update
  // por columnas) están en `20260901130000:277-318`.
  //
  // ⚠️ Y SON DOS CUPOS INDEPENDIENTES. Que la cola en vuelo se lea primero es
  // una prioridad de atención, no un derecho a quedarse con el lote: ver
  // `LOTE_EN_VUELO` / `LOTE_NUEVOS`. El `order` por `updated_at` ascendente es lo
  // que hace rotar las atascadas — cada intento toca la fila y la manda al final.
  const { data: enVuelo, error: eVuelo } = await admin
    .from("payouts")
    .select(COLUMNAS)
    .eq("status", "processing")
    .order("updated_at", { ascending: true })
    .limit(LOTE_EN_VUELO);

  if (eVuelo) {
    return NextResponse.json({ error: eVuelo.message }, { status: 500 });
  }

  const { data: nuevas, error: eNuevas } = await admin
    .from("payouts")
    .select(COLUMNAS)
    .eq("status", "scheduled")
    .lte("scheduled_for", ahora())
    .order("scheduled_for", { ascending: true }) // lo más viejo primero
    .limit(LOTE_NUEVOS);
  if (eNuevas) {
    return NextResponse.json({ error: eNuevas.message }, { status: 500 });
  }
  const pendientes = (nuevas ?? []) as OrdenDePago[];

  const cola: OrdenDePago[] = [...((enVuelo ?? []) as OrdenDePago[]), ...pendientes];

  // ── Los contadores ────────────────────────────────────────────────────────
  // Cada uno responde a una pregunta distinta y ninguno se puede deducir de los
  // otros. Son lo que se mira desde el log de Actions.
  let pagados = 0;
  let importePagado = 0;
  let enviados = 0;
  let seguidos = 0;
  let adoptados = 0;
  let rechazados = 0;
  let reintentables = 0;
  let sinDecidirCambio = 0;
  let sinDatosDeCobro = 0;
  let sinFondos = 0;
  let sinCredencial = 0;
  let sinEjecutor = 0;
  /**
   * 🟠 ÓRDENES DE RIEL MANUAL: no son un problema, están esperando a una
   * persona.
   *
   * Hasta el 2-sep este job no distinguía «no hay a dónde pagar» de «lo paga
   * alguien desde el panel»: las dos caían en `sinEjecutor` porque las dos se
   * quedan sin adaptador. Con Venezuela ruteada a 'manual'
   * (`20260902150000`) esa mezcla convierte el log del cron en una mentira —
   * diría que hay N órdenes impagables cuando lo que hay son N órdenes con
   * riel, destino declarado por el tutor y un `manage_payout('mark_paid')`
   * pendiente. Lo avisaba el comentario de `rielDePayout()`: «el job tiene que
   * contarla aparte».
   */
  let esperandoPersona = 0;
  let balanceAjeno = 0;
  let sinPais = 0;
  let descuadrados = 0;
  let enDuda = 0;
  let esperandoBarrido = 0;
  let noReclamados = 0;
  /** Identidades muertas archivadas: `manage_payout('retry')` por fin reintenta. */
  let difuntos = 0;
  /**
   * 🔴 Si esto se pone a true, el lote se PARA. No hay credencial válida, así que
   * lo que le pase a esta orden le va a pasar a todas, y seguir solo sirve para
   * escribir el mismo error en diez filas.
   */
  let credencialRota: string | null = null;
  const ensayo: unknown[] = [];

  for (const fila of cola) {
    if (credencialRota) break;
    const rastro = rastroDe(fila);
    const enVueloYa = fila.status === "processing";
    // El intento vive en el rastro y NO se toca aquí: solo lo sube `difunto`.
    const intento = typeof rastro.intento === "number" && rastro.intento >= 1 ? rastro.intento : 1;

    // ── Quién ejecuta ───────────────────────────────────────────────────────
    // Para una orden en vuelo manda `payouts.provider`, que es el snapshot de
    // quién la reclamó: si alguien cambia la tabla de ruteo mientras hay órdenes
    // a medias, esas órdenes terminan por donde empezaron. Para una orden nueva
    // se resuelve por `payee_country`, que es la definición de la columna.
    // ⚠️ C2r · El resolvedor recibe ahora de dónde SALIÓ el dinero, porque con
    // listas de candidatos la atadura del balance no es una comprobación
    // posterior sino parte de elegir: descarta a un candidato y deja pasar al
    // siguiente. Y puede devolver `null` — «ningún candidato puede pagar esta
    // orden hoy» —, que NO es un fallo: la fila se queda esperando.
    const claveEjecutor = enVueloYa
      ? (fila.provider ?? "simulated")
      : await payoutProviderFor(fila.payee_country, fila.funding_provider);
    // `claveEjecutor` puede ser null desde C2r: «ningún candidato puede pagar
    // esta orden hoy». `pspDe` ya sabe tratar una clave que no es un PSP, así
    // que se le pasa el null tal cual y la fila cae en el camino de «sin
    // ejecutor», que es exactamente lo que significa.
    const psp = pspDe(claveEjecutor);

    const base = {
      payout: fila.id,
      tutor: fila.tutor_id,
      importe: fila.amount,
      moneda: fila.currency,
      pais: fila.payee_country,
      ejecutor: claveEjecutor,
      financia: fila.funding_provider,
    };

    // ⚠️ ANTES DE `!psp`, Y EL ORDEN ES LO ÚNICO QUE LO HACE FUNCIONAR: el
    // adaptador de 'manual' existe pero no sabe pagar (`LocalProvider`), así que
    // `pspDe('manual')` devuelve null igual que un typo. Preguntar por la CLASE
    // de riel es lo que separa las dos cosas, y por eso se hace primero.
    if (rielDePayout(claveEjecutor)?.ejecuta === "persona") {
      // Riel manual: NO hay adaptador y no va a haberlo (decisión de producto
      // del 2-sep). La fila se queda intacta —igual que en el caso de abajo— y
      // se cuenta APARTE, porque esto no es un bloqueo: es una orden con riel,
      // con destino declarado por el tutor y esperando a que el admin la cierre
      // con `manage_payout(id,'mark_paid',referencia,canal)`.
      esperandoPersona++;
      if (simulacro) {
        ensayo.push({
          ...base,
          haria: `nada: ${
            rielDePayout(claveEjecutor)?.dato === "banco"
              ? "transferencia bancaria a mano"
              : "riel manual por canal"
          } — la paga una persona desde /admin/payouts`,
        });
      }
      continue;
    }

    if (!psp) {
      // 'simulated', null, o una clave que nadie reconoce. Ahora sí significa lo
      // que dice: a este destino no le corresponde ningún ejecutor, ni máquina
      // ni persona. Hoy es el tutor que no ha declarado país. La fila se queda
      // como está y se cuenta.
      sinEjecutor++;
      if (simulacro) ensayo.push({ ...base, haria: "nada: su destino no tiene ejecutor" });
      continue;
    }

    const falta = psp.missingPayoutConfig();
    if (falta) {
      // Sin credencial la fila NO se toca —ni se reclama— y sale entera en la
      // primera pasada con el proveedor encendido. Marcarla de cualquier otra
      // forma sería inventarse que el dinero se movió.
      sinCredencial++;
      if (simulacro) ensayo.push({ ...base, haria: `nada: ${falta}` });
      continue;
    }

    // ── LAS TRES PUERTAS PREVIAS ────────────────────────────────────────────
    //
    // ⚠️ SOLO SE APLICAN A UNA ORDEN NUEVA, y esto es un arreglo consciente y no
    // un descuido. Deciden si se puede EMPEZAR a pagar; una orden que ya está en
    // 'processing' hay que seguirla hasta el final pase lo que pase, porque puede
    // haber dinero suyo en vuelo. Si alguien cambia la tabla de ruteo entre el
    // envío y el cobro, saltarse esa orden por la puerta del balance la dejaría
    // colgada para siempre — y si encima no tenía identificador, dejaría un pago
    // sin conciliar. El seguimiento no consulta ninguna de las tres.
    if (!enVueloYa) {
      // 🔴 EL BALANCE. Un payout se paga desde el balance del PSP que cobró ese
      // dinero, y `funding_provider` dice cuál fue. Si no es el ejecutor, la
      // orden es IMPAGABLE: no es que vaya a fallar, es que a ese proveedor no le
      // consta ese importe. Mandarla es pedirle a dLocal Go que saque de su
      // bolsillo lo que cobró Stripe.
      if (fila.funding_provider !== psp.key) {
        balanceAjeno++;
        if (simulacro) {
          ensayo.push({
            ...base,
            haria: `nada: el dinero está en el balance de ${fila.funding_provider ?? "(sin constar)"} y paga ${psp.key}`,
          });
        }
        continue;
      }

      // Sin país no se puede pagar a ningún sitio. `payout_beneficiary` también
      // lo rechaza, pero cortar aquí ahorra una RPC y da un contador propio: las
      // 10 filas que hay hoy en dev tienen `payee_country` a null.
      if (!fila.payee_country) {
        sinPais++;
        if (simulacro) ensayo.push({ ...base, haria: "nada: la orden no tiene país de destino" });
        continue;
      }

      // El importe, contra sus líneas. `payouts.amount` es un agregado y
      // `payout_items` es de dónde salió; que el total que va a la API cuadre con
      // sus líneas es la regla de oro 2 aplicada al lado de salida, y es justo
      // para esto que `20260901130000` concedió el `select` sobre `payout_items`.
      // Un descuadre no se manda y no se marca 'failed': es un problema de
      // integridad nuestro, no un rechazo del PSP.
      const { data: lineas, error: eLineas } = await admin
        .from("payout_items")
        .select("amount")
        .eq("payout_id", fila.id);
      if (eLineas) {
        reintentables++;
        console.error("[C2] no se pudieron leer las líneas del payout", { ...base, error: eLineas.message });
        continue;
      }
      const suma = (lineas ?? []).reduce((s, l) => s + (l.amount ?? 0), 0);
      if (suma !== fila.amount) {
        descuadrados++;
        console.error("[C2] ⚠️ el importe del payout no cuadra con sus líneas — NO se manda", {
          ...base,
          sumaDeLineas: suma,
          lineas: (lineas ?? []).length,
        });
        if (simulacro) ensayo.push({ ...base, haria: `nada: descuadre (líneas suman ${suma})` });
        continue;
      }
    }

    // ⚠️ AQUÍ HABÍA UN FRENO QUE YA NO HACE FALTA Y QUE HACÍA DAÑO. Decía que una
    // orden EN VUELO sin país no se podía barrer —«sin país el cotejo descartaría
    // todos los payouts y devolvería ausente»— y la dejaba en duda para siempre.
    // Era cierto cuando el cotejo iba por parecido; con la marca de
    // `description`, el barrido no mira el país (ni podría: el listado del
    // proveedor no devuelve `transfer_country`). Así que una orden en vuelo sin
    // país SÍ se puede resolver, que es justo lo que hay que hacer con ella.
    //
    // El país sigue siendo obligatorio para CREAR, y eso lo corta la puerta de
    // `sinPais` de arriba, que solo mira las órdenes nuevas.

    // ── El ensayo se para aquí ──────────────────────────────────────────────
    // Todo lo que sigue reclama o llama. En simulacro se pregunta solo lo que se
    // puede preguntar sin escribir: si el beneficiario se puede construir y si la
    // orden exige una conversión sin decidir. Eso obliga a leer los datos del
    // tutor, así que **de la respuesta sale un veredicto y nada más**: ni
    // nombres, ni documento, ni número de cuenta.
    if (simulacro) {
      const { data: b, error: eB } = await admin.rpc("payout_beneficiary", {
        p_payout_id: fila.id,
      });
      const destino =
        b && typeof b === "object"
          ? ((b as Record<string, string | null>).currency_to_pay ?? "?")
          : "?";
      ensayo.push({
        ...base,
        // El número de intento. Con `payout` (que es `payouts.id`) forma la
        // marca que el ejecutor escribe en el proveedor y que permite conciliar
        // una orden a mano — en dLocal Go, `EY-<payout>-<intento>` dentro de
        // `description`. No se compone aquí: cómo se marca un pago es cosa de
        // cada adaptador, y este job no conoce a ninguno por su nombre.
        intento,
        beneficiario: eB ? `no: ${eB.message}` : "sí",
        conversion: eB
          ? "?"
          : destino.toUpperCase() === fila.currency.toUpperCase()
            ? "no hace falta"
            : `${fila.currency} → ${destino} · SIN DECIDIR quién come el spread`,
        haria: eB
          ? "nada: no se puede construir el beneficiario"
          : destino.toUpperCase() === fila.currency.toUpperCase()
            ? enVueloYa
              ? "seguir la orden ya reclamada"
              : "reclamar y crear el payout"
            : "nada: conversión sin decidir",
      });
      continue;
    }

    // ── El reclamo, o la reanudación ────────────────────────────────────────
    let claimedAt: string;
    if (enVueloYa) {
      // Ya reclamada por una pasada anterior. El sello del PRIMER intento es lo
      // que hace que el barrido pueda distinguir nuestro payout del de la semana
      // pasada, así que se relee y NO se renueva.
      claimedAt = rastro.reclamado_en ?? fila.scheduled_for ?? new Date(0).toISOString();

      // ⚠️ Sin identificador y recién reclamada: se deja respirar. Barrer antes
      // de que el listado del proveedor pueda enseñar un payout recién creado
      // devolvería «ausente» sobre algo que existe, y «ausente» es lo que
      // autoriza a mandarla otra vez.
      if (!fila.provider_payout_id) {
        const desde = Date.parse(claimedAt);
        if (Number.isFinite(desde) && Date.now() - desde < ESPERA_ANTES_DE_BARRER_MS) {
          esperandoBarrido++;
          continue;
        }
      }
    } else {
      claimedAt = ahora();
      // 🔴 EL CANDADO. `eq('status','scheduled')` no es un filtro de comodidad:
      // es lo que hace que de dos pasadas solapadas solo una gane la orden. Si
      // devuelve cero filas, otra la tiene y esta pasada NO la mira.
      const { data: ganada, error: eClaim } = await admin
        .from("payouts")
        .update({
          status: "processing",
          provider: psp.key,
          provider_metadata: {
            c2: {
              reclamado_en: claimedAt,
              // Se reescribe tal cual: el intento solo lo mueve `difunto`, y
              // perderlo aquí haría que el barrido buscara una marca que no es.
              intento,
              ...(rastro.intentos_muertos ? { intentos_muertos: rastro.intentos_muertos } : {}),
              ultimo_estado: "reclamado",
            } satisfies Rastro,
          },
        })
        .eq("id", fila.id)
        .eq("status", "scheduled")
        .select("id");

      if (eClaim) {
        reintentables++;
        console.error("[C2] no se pudo reclamar la orden", { ...base, error: eClaim.message });
        continue;
      }
      if (!ganada || ganada.length === 0) {
        // Otra pasada (u otro camino) se la llevó entre la lectura y el update.
        noReclamados++;
        continue;
      }
    }

    const entrada: PayoutInput = {
      payoutId: fila.id,
      // ⚠️ DE LA FILA Y DE NINGÚN OTRO SITIO (regla de oro 2). Ya se ha
      // comprobado contra `payout_items` unas líneas más arriba.
      amountMinor: fila.amount,
      currency: fila.currency,
      // Vacío solo puede llegar en una orden EN VUELO, y a esas no se les crea
      // nada: el camino que lo usa es el del POST, y ahí `sinPais` ya cortó.
      payeeCountry: fila.payee_country ?? "",
      claimedAt,
      intento,
      reanudar: enVueloYa,
      providerPayoutId: fila.provider_payout_id,
    };

    let salida: PayoutResult;
    try {
      salida = await psp.payout(entrada);
    } catch (e) {
      // Una excepción que el adaptador no supo clasificar es, por definición,
      // una orden en estado desconocido. No se toca la fila: se queda
      // 'processing' y la barre la pasada siguiente, que para eso hay barrido.
      enDuda++;
      console.error("[C2] 🔴 excepción sin clasificar — la orden queda EN DUDA", {
        ...base,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    /**
     * Qué se escribe cuando la orden NO llegó a mandarse. Para una orden nueva
     * es «vuelve a la cola limpia»; para una que ya venía en 'processing' es
     * «no toques nada», porque puede tener un pago detrás.
     */
    // ⚠️ LA CONDICIÓN ES SOLO `enVueloYa`, y antes también miraba
    // `provider_payout_id`. Ese añadido dejaba atascada en 'processing' la orden
    // que un admin acababa de reintentar: viene de 'failed' con el id del payout
    // rechazado dentro, y cualquier desenlace que no fuera terminal la congelaba.
    // Es innecesario además de dañino: si la fila se reclamó EN ESTA pasada, los
    // únicos caminos que llegan aquí o no han llamado a crear nada (tienen id, y
    // con id solo se consulta) o han barrido y han DEMOSTRADO que no se creó
    // nada. En los dos casos volver a la cola es seguro.
    const volver: Record<string, unknown> = enVueloYa ? {} : { status: "scheduled", provider: null };

    const marca = async (campos: Record<string, unknown>, estadoRastro: string, mensaje?: string) => {
      const meta = {
        c2: {
          reclamado_en: claimedAt,
          intento,
          ...(rastro.intentos_muertos ? { intentos_muertos: rastro.intentos_muertos } : {}),
          ultimo_estado: estadoRastro,
          ultimo_intento_en: ahora(),
          ...(mensaje ? { ultimo_mensaje: mensaje } : {}),
          ...("detalle" in salida && typeof salida.detalle === "string"
            ? { proveedor_detalle: salida.detalle }
            : {}),
        } satisfies Rastro,
      };
      const { error } = await admin
        .from("payouts")
        .update({ ...campos, provider_metadata: meta })
        .eq("id", fila.id);
      return error;
    };

    switch (salida.estado) {
      // ── El dinero salió. Es lo ÚNICO que escribe 'paid', y con ello dispara
      // `notify_payout()` → NTF-12 «Se pagó tu liquidación». Esa frase por fin es
      // verdad porque llega aquí y no antes.
      case "pagado": {
        const err = await marca(
          {
            status: "paid",
            provider: psp.key,
            provider_payout_id: salida.payoutId,
            paid_at: ahora(),
          },
          "pagado",
        );
        if (err) {
          // El dinero YA SALIÓ y no se pudo anotar. La fila sigue 'processing'
          // CON su `provider_payout_id`… salvo que fuera justo eso lo que falló,
          // en cuyo caso la pasada siguiente la barre y la adopta. Por eso el
          // orden es pagar → anotar y no al revés: una caída en medio deja un
          // pago hecho y sin anotar (recuperable), no una anotación de un pago
          // que no existe (indetectable).
          enDuda++;
          console.error("[C2] 🔴 payout PAGADO pero no anotado", {
            ...base,
            proveedorPayout: salida.payoutId,
            error: err.message,
          });
          break;
        }
        pagados++;
        importePagado += fila.amount;
        // Traza de conciliación: con estos ids se cierra el círculo entre esta
        // base y el panel del proveedor sin adivinar nada. Sin PII: ni nombre, ni
        // documento, ni número de cuenta.
        console.info("[C2] payout PAGADO", {
          ...base,
          proveedorPayout: salida.payoutId,
          detalle: salida.detalle,
          adoptado: salida.adoptado,
        });
        break;
      }

      // ── Aceptado y en camino. dLocal Go nace PENDING: esto NO es 'paid' y no
      // puede serlo. La fila se queda 'processing' con su identificador, y la
      // pasada siguiente pregunta por él hasta que llegue a DELIVERED.
      case "enviado": {
        const err = await marca(
          { status: "processing", provider: psp.key, provider_payout_id: salida.payoutId },
          salida.adoptado ? "adoptado" : "enviado",
        );
        if (err) {
          enDuda++;
          console.error("[C2] 🔴 payout CREADO pero no anotado", {
            ...base,
            proveedorPayout: salida.payoutId,
            error: err.message,
          });
          break;
        }
        // Tres cosas distintas con la misma escritura, y contarlas juntas
        // escondería la única interesante: `adoptados` es el antidoble en
        // acción, `enviados` es dinero que acaba de salir, y `seguidos` es una
        // orden que ya estaba en vuelo y sigue igual. Si `seguidos` no baja
        // nunca, hay pagos atascados en el proveedor.
        if (salida.adoptado) adoptados++;
        else if (fila.provider_payout_id) seguidos++;
        else enviados++;
        console.info(
          salida.adoptado
            ? "[C2] payout ADOPTADO (no se creó otro)"
            : fila.provider_payout_id
              ? "[C2] payout sigue en vuelo"
              : "[C2] payout enviado",
          { ...base, proveedorPayout: salida.payoutId, detalle: salida.detalle },
        );
        break;
      }

      // ── El proveedor rechazó la orden. Es el ÚNICO camino que escribe
      // 'failed', y con él la incidencia NTF-16 al tutor.
      case "rechazado": {
        await marca(
          {
            status: "failed",
            provider: psp.key,
            ...(salida.payoutId ? { provider_payout_id: salida.payoutId } : {}),
            failed_at: ahora(),
            failure_reason: salida.mensaje.slice(0, 500),
          },
          "rechazado",
          salida.mensaje,
        );
        rechazados++;
        console.error("[C2] payout RECHAZADO por el proveedor — requiere revisión", {
          ...base,
          proveedorPayout: salida.payoutId ?? null,
          error: salida.mensaje,
        });
        break;
      }

      // ── 🔴 NO SE SABE SI SE PAGÓ. La fila se queda 'processing' y **no se
      // reintenta sola jamás**: la pasada siguiente vuelve a barrer, y hasta que
      // el barrido pueda afirmar algo, nadie manda nada. Es la única salida
      // honesta de una API sin idempotencia.
      case "en-duda": {
        await marca({}, "en-duda", salida.mensaje);
        enDuda++;
        console.error("[C2] 🔴 ORDEN EN DUDA: puede haber un payout creado sin identificar", {
          ...base,
          error: salida.mensaje,
        });
        break;
      }

      // ── 🔑 LA IDENTIDAD QUE ARRASTRABA ESTÁ MUERTA: se archiva, sube el
      // intento y la orden vuelve a la cola LIMPIA. Es lo que hace que
      // `manage_payout('retry')` reintente de verdad.
      //
      // Las tres escrituras van juntas y ninguna sobra:
      //   · `provider_payout_id` a null — si se queda, la pasada siguiente vuelve
      //     a preguntar por el cadáver y el bucle sigue igual.
      //   · `intento + 1` — cambia la marca, para que el barrido del intento
      //     nuevo no encuentre el payout del viejo y lo adopte como propio.
      //   · el id viejo al historial — es la única traza que queda para conciliar
      //     ese rechazo contra el panel del proveedor.
      //
      // ⚠️ NO se escribe 'failed' ni se manda NTF-16: el tutor ya recibió esa
      // incidencia cuando el payout se rechazó. Esto es el reintento del admin
      // poniéndose en marcha, no un fallo nuevo.
      case "difunto": {
        const muertos = [...(rastro.intentos_muertos ?? []), salida.payoutId];
        const { error: eDif } = await admin
          .from("payouts")
          .update({
            status: "scheduled",
            provider: null,
            provider_payout_id: null,
            provider_metadata: {
              c2: {
                reclamado_en: claimedAt,
                intento: intento + 1,
                intentos_muertos: muertos,
                ultimo_estado: "difunto",
                ultimo_intento_en: ahora(),
                ultimo_mensaje: salida.mensaje,
                proveedor_detalle: salida.detalle,
              } satisfies Rastro,
            },
          })
          .eq("id", fila.id);
        if (eDif) {
          // No se pudo archivar. La fila sigue con su id muerto dentro: el bucle
          // del retry sigue en pie, pero nadie ha pagado dos veces. Se grita.
          enDuda++;
          console.error("[C2] 🔴 no se pudo archivar la identidad muerta del payout", {
            ...base,
            proveedorPayout: salida.payoutId,
            error: eDif.message,
          });
          break;
        }
        difuntos++;
        console.info("[C2] identidad muerta archivada: la orden vuelve a la cola con intento nuevo", {
          ...base,
          proveedorPayout: salida.payoutId,
          detalle: salida.detalle,
          intentoNuevo: intento + 1,
        });
        break;
      }

      // ── 🔴 NO HAY CREDENCIAL. No se toca la fila —no es culpa suya— y se PARA
      // el lote: lo que le pase a esta orden le va a pasar a las diez. Antes esto
      // caía en `en-duda`, que marca la fila y exige que la mire una persona:
      // una variable de entorno mal puesta abría diez incidencias falsas por
      // pasada y las órdenes se quedaban paradas aunque la clave se arreglara.
      case "sin-credencial": {
        credencialRota = salida.mensaje;
        // ⚠️ `pudoCrear` decide si la fila vuelve a la cola. Si el 401/403 lo dio
        // la propia llamada, no se creó nada y la orden vuelve intacta; si la
        // credencial se cayó durante un barrido que comprobaba si una creación
        // había cuajado, esa duda sigue en pie y no se toca nada. Sin esto, cada
        // pasada con la clave rota dejaría una orden reclamada y sin
        // identificador, que es la alarma que no puede llorar en falso.
        await marca(salida.pudoCrear ? {} : volver, "sin-credencial", salida.mensaje);
        console.error("[C2] 🔴 CREDENCIAL RECHAZADA por el proveedor: se para el lote", {
          ...base,
          vuelveALaCola: !salida.pudoCrear,
          error: salida.mensaje,
        });
        break;
      }

      // ── El barrido demostró que no se creó nada. Vuelve a la cola limpia:
      // `provider` a null porque no la ejecutó nadie.
      case "sin-rastro": {
        await marca({ status: "scheduled", provider: null, provider_payout_id: null }, "sin-rastro", salida.mensaje);
        reintentables++;
        console.info("[C2] orden reclamada sin rastro en el proveedor: vuelve a la cola", base);
        break;
      }

      // ── Todo lo que sigue: NO SE LLAMÓ A CREAR NADA, así que la orden puede
      // volver a 'scheduled' intacta. Ninguno es un fallo del payout y ninguno
      // escribe 'failed'.
      //
      // ⚠️ «PUEDE» ES LITERAL: solo vuelve a la cola lo que se reclamó EN ESTA
      // pasada. Una orden que ya venía en 'processing' arrastra la duda de si
      // llegó a crearse un payout, y esa duda solo la despeja `sin-rastro`.
      // Devolverla a la cola por cualquier otro motivo sería mandarla otra vez
      // encima de algo que quizá ya salió. `volver` es esa distinción.
      case "sin-decidir": {
        await marca(volver, "sin-decidir", salida.mensaje);
        sinDecidirCambio++;
        console.warn("[C2] payout BLOQUEADO por una decisión de producto (tipo de cambio)", {
          ...base,
          motivo: salida.mensaje,
        });
        break;
      }
      case "sin-datos": {
        await marca(volver, "sin-datos", salida.mensaje);
        sinDatosDeCobro++;
        console.warn("[C2] payout sin datos de cobro utilizables", { ...base, motivo: salida.mensaje });
        break;
      }
      case "sin-fondos": {
        await marca(volver, "sin-fondos", salida.mensaje);
        sinFondos++;
        console.error("[C2] ⚠️ SALDO INSUFICIENTE en el proveedor — el dinero se sigue debiendo", {
          ...base,
          motivo: salida.mensaje,
        });
        break;
      }
      case "sin-ejecutor": {
        await marca(volver, "sin-ejecutor", salida.mensaje);
        sinEjecutor++;
        break;
      }
      case "transitorio": {
        await marca(volver, "transitorio", salida.mensaje);
        reintentables++;
        console.error("[C2] fallo transitorio, se reintenta", { ...base, error: salida.mensaje });
        break;
      }
    }
  }

  // Una línea, no una por fila: en el log de Actions lo que hace falta saber es
  // que hay dinero esperando a una persona, no cuáles. Va como `info` a
  // propósito — un riel manual funcionando no es una incidencia.
  if (esperandoPersona > 0 && !simulacro) {
    console.info(
      "[C2] órdenes en riel manual: no las paga este job, las cierra el admin desde /admin/payouts",
      { esperandoPersona },
    );
  }

  // Lo que espera detrás del lote. Es lo que distingue «no hay nada que hacer»
  // de «hay cola y el lote se llenó».
  const { count: enCola } = await admin
    .from("payouts")
    .select("id", { count: "exact", head: true })
    .eq("status", "scheduled")
    .lte("scheduled_for", ahora());

  const { count: enVueloTotal } = await admin
    .from("payouts")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing");

  // Órdenes reclamadas que NO tienen identificador en el proveedor. Es LA cifra
  // de este endpoint: mientras no sea 0, puede haber un payout creado que esta
  // base de datos no sabe identificar. Cero está bien; que no baje, no.
  const { count: sinIdentificar } = await admin
    .from("payouts")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .is("provider_payout_id", null);

  // 🔴 LA CIFRA QUE DELATA UN ATASCO. Órdenes en vuelo que llevan más de un día
  // sin moverse: o están en duda esperando a una persona, o hay pagos parados en
  // el proveedor. Con un solo cupo compartido, diez de estas paraban TODOS los
  // pagos nuevos y la respuesta seguía diciendo `ok`; ahora no pueden, pero
  // siguen siendo lo primero que hay que mirar cuando una cola no baja.
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: atascadas } = await admin
    .from("payouts")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .lt("updated_at", ayer);

  if (simulacro) {
    return NextResponse.json({
      status: "simulacro",
      revisadas: cola.length,
      // Sin un solo dato del beneficiario: solo el veredicto.
      haria: ensayo,
      // Las que este job no va a tocar nunca porque las paga una persona.
      esperandoPersona,
      enCola: enCola ?? 0,
      enVuelo: enVueloTotal ?? 0,
      sinIdentificar: sinIdentificar ?? 0,
      atascadas: atascadas ?? 0,
      lote: { enVuelo: LOTE_EN_VUELO, nuevos: LOTE_NUEVOS },
    });
  }

  // 🔴 SI SE ROMPIÓ LA CREDENCIAL, ESTO NO ES UN 200. Un lote que se para a la
  // primera orden no es un lote «ok» con un contador dentro: el workflow tiene
  // que verlo rojo, igual que los otros jobs devuelven 503 cuando les falta la
  // configuración. Las filas que se llegaron a procesar antes van igualmente en
  // la respuesta, porque el dinero que se movió se cuenta pase lo que pase.
  if (credencialRota) {
    return NextResponse.json(
      {
        status: "sin-credencial",
        error: credencialRota,
        revisadas: cola.length,
        pagados,
        importePagado,
        enviados,
        adoptados,
        enCola: enCola ?? 0,
        enVuelo: enVueloTotal ?? 0,
        sinIdentificar: sinIdentificar ?? 0,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    status: "ok",
    revisadas: cola.length,
    // El dinero que se movió en esta pasada, en unidades menores como en la BD.
    // Es la cifra que debe cuadrar con el panel del proveedor al final del día.
    pagados,
    importePagado,
    // Creados en esta pasada y en vuelo: todavía no son dinero en la cuenta
    // del tutor.
    enviados,
    // Órdenes que YA estaban en vuelo y siguen igual. Si no baja nunca, hay
    // pagos atascados en el proveedor.
    seguidos,
    // Órdenes que YA existían en el proveedor y se adoptaron en vez de crearse
    // otra vez. No es un incidente: es el mecanismo antidoble funcionando.
    adoptados,
    // Rechazos del proveedor. Si no es 0, hay dinero prometido que no va a salir
    // sin que una persona mire.
    rechazados,
    // 🔴 Órdenes que pueden corresponder a un pago sin identificar. Debe ser 0.
    enDuda,
    sinIdentificar: sinIdentificar ?? 0,
    // 🔴 En vuelo y sin tocarse desde hace más de un día. Es lo que delata un
    // atasco, y lo que antes se comía el lote entero en silencio.
    atascadas: atascadas ?? 0,
    // Identidades muertas archivadas: el `retry` del admin poniéndose en marcha.
    difuntos,
    // Reclamadas hace poco: se barren en la pasada siguiente, no antes.
    esperandoBarrido,
    // 🟠 Riel manual: este job NO las va a pagar nunca y eso es lo correcto.
    // Esperan a que el admin las cierre desde /admin/payouts. NO es un bloqueo
    // —por eso está aquí arriba y no dentro de `bloqueos`— pero si sube y no
    // baja, hay tutores esperando su dinero sin que nadie mire la pantalla.
    esperandoPersona,
    // Bloqueos que NO son fallos y que ninguna pasada va a resolver sola.
    bloqueos: {
      // Decisión de producto sin responder: quién come el spread del cambio.
      sinDecidirCambio,
      // El dinero está en el balance de otro proveedor. Decisión de tesorería.
      balanceAjeno,
      // El tutor no ha registrado datos de cobro, o ya no validan.
      sinDatosDeCobro,
      // No hay saldo en el proveedor. Se sigue debiendo.
      sinFondos,
      // Falta la credencial del ejecutor.
      sinCredencial,
      // Su destino no tiene ejecutor de ninguna clase: ni PSP que sepa pagar ni
      // riel manual. Hoy, el tutor que no ha declarado país. Venezuela YA NO
      // cuenta aquí desde `20260902150000`: se cuenta en `esperandoPersona`.
      sinEjecutor,
      // La orden no tiene país de destino congelado.
      sinPais,
      // `payouts.amount` no cuadra con la suma de `payout_items`.
      descuadrados,
    },
    reintentables,
    noReclamados,
    enCola: enCola ?? 0,
    enVuelo: enVueloTotal ?? 0,
    lote: { enVuelo: LOTE_EN_VUELO, nuevos: LOTE_NUEVOS },
  });
}
