import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { adapterFor, payoutProviderFor } from "@/lib/payments";
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
 * Tope por pasada. MÁS BAJO que el de los reembolsos (25) y mucho más que el del
 * correo (50), y no es simetría rota: cada vuelta de este bucle puede mover el
 * saldo de una semana entera de un tutor y, en el peor caso, hace hasta seis
 * llamadas a la API (la creación más cinco páginas de barrido). Lo que sobre sale
 * en la pasada siguiente — para eso 'scheduled' significa «todavía no».
 */
const LOTE = 10;

/**
 * Cuánto tiene que llevar una orden reclamada sin identificador antes de que se
 * la barra.
 *
 * ⚠️ NO ES PRUDENCIA GENÉRICA: es que el listado del proveedor puede tardar en
 * enseñar un payout recién creado, y un barrido demasiado pronto devolvería
 * «ausente» sobre algo que existe. Y «ausente» es precisamente lo que autoriza a
 * devolver la orden a la cola, o sea a mandarla otra vez. Quince minutos es
 * mucho más que cualquier propagación razonable y no cuesta nada: el pago ya
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
};

const COLUMNAS =
  "id, tutor_id, status, currency, amount, provider, provider_payout_id, provider_metadata, funding_provider, payee_country, scheduled_for";

/** El rastro que este job deja en `provider_metadata`. Sin PII, nunca. */
type Rastro = {
  /** ISO del `update` que ganó la orden. Es el `claimedAt` del puerto. */
  reclamado_en?: string;
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
 */
function pspDe(clave: string): PspProvider | null {
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
  const { data: enVuelo, error: eVuelo } = await admin
    .from("payouts")
    .select(COLUMNAS)
    .eq("status", "processing")
    .order("scheduled_for", { ascending: true, nullsFirst: true })
    .limit(LOTE);

  if (eVuelo) {
    return NextResponse.json({ error: eVuelo.message }, { status: 500 });
  }

  const hueco = Math.max(0, LOTE - (enVuelo?.length ?? 0));
  let pendientes: OrdenDePago[] = [];
  if (hueco > 0) {
    const { data, error } = await admin
      .from("payouts")
      .select(COLUMNAS)
      .eq("status", "scheduled")
      .lte("scheduled_for", ahora())
      .order("scheduled_for", { ascending: true }) // lo más viejo primero
      .limit(hueco);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    pendientes = (data ?? []) as OrdenDePago[];
  }

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
  let balanceAjeno = 0;
  let sinPais = 0;
  let descuadrados = 0;
  let enDuda = 0;
  let esperandoBarrido = 0;
  let noReclamados = 0;
  const ensayo: unknown[] = [];

  for (const fila of cola) {
    const rastro = rastroDe(fila);
    const enVueloYa = fila.status === "processing";

    // ── Quién ejecuta ───────────────────────────────────────────────────────
    // Para una orden en vuelo manda `payouts.provider`, que es el snapshot de
    // quién la reclamó: si alguien cambia la tabla de ruteo mientras hay órdenes
    // a medias, esas órdenes terminan por donde empezaron. Para una orden nueva
    // se resuelve por `payee_country`, que es la definición de la columna.
    const claveEjecutor = enVueloYa
      ? (fila.provider ?? "simulated")
      : await payoutProviderFor(fila.payee_country);
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

    if (!psp) {
      // 'simulated', null, o una clave sin adaptador. No es un fallo de la
      // orden: es que a su destino no le corresponde ningún PSP que sepa pagar
      // (hoy, Venezuela y el tutor que no ha declarado país). La fila se queda
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

    // Una orden EN VUELO sin país no debería existir —para haberse mandado tuvo
    // que tenerlo— pero si existe no se puede barrer: sin país el cotejo
    // descartaría todos los payouts del proveedor y devolvería «ausente», que es
    // justo lo que autoriza a mandarla otra vez. Se queda quieta y se grita.
    if (!fila.payee_country) {
      enDuda++;
      console.error("[C2] 🔴 orden en vuelo SIN país de destino: no se puede barrer ni mandar", base);
      continue;
    }

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
            c2: { reclamado_en: claimedAt, ultimo_estado: "reclamado" } satisfies Rastro,
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
      payeeCountry: fila.payee_country,
      claimedAt,
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
    const volver: Record<string, unknown> =
      enVueloYa || fila.provider_payout_id ? {} : { status: "scheduled", provider: null };

    const marca = async (campos: Record<string, unknown>, estadoRastro: string, mensaje?: string) => {
      const meta = {
        c2: {
          reclamado_en: claimedAt,
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

  if (simulacro) {
    return NextResponse.json({
      status: "simulacro",
      revisadas: cola.length,
      // Sin un solo dato del beneficiario: solo el veredicto.
      haria: ensayo,
      enCola: enCola ?? 0,
      enVuelo: enVueloTotal ?? 0,
      sinIdentificar: sinIdentificar ?? 0,
      lote: LOTE,
    });
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
    // Reclamadas hace poco: se barren en la pasada siguiente, no antes.
    esperandoBarrido,
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
      // Su destino no tiene ningún PSP que sepa pagar (VE, o sin país declarado).
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
    lote: LOTE,
  });
}
