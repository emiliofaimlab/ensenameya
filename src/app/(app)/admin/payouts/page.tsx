import { getUserTimezone, requireRole } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/catalog/format";
import { nombrePais, PAYOUT_BADGE } from "@/lib/payouts";
import { rielDePayout, type Riel } from "@/lib/payments";
import type { Database, Json } from "@/lib/database.types";
import {
  PanelCard,
  StatusPill,
  type PillTone,
} from "@/components/layout/panel-shell";
import { AdminShell } from "@/components/layout/admin-shell";
import { AdminFilters } from "../payments/filters";
import { esperaDesde } from "../tiempo";
import { DatoCopiable, PayoutActions } from "./payout-actions";
import {
  leerBeneficiario,
  rpcNueva,
  type DestinoBancario,
  type DestinoManual,
  type DestinosDeTutor,
  type FamiliaDeDato,
} from "./rpc";

export const metadata = { title: "Payouts · Enséñame Ya" };

type PayoutStatus = Database["public"]["Enums"]["payout_status"];

const STATUSES: PayoutStatus[] = [
  "pending",
  "scheduled",
  "processing",
  "paid",
  "failed",
  "on_hold",
];
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: PAYOUT_BADGE[s].label }));

const PAYOUT_PILL: Record<string, PillTone> = {
  paid: "green",
  processing: "blue",
  scheduled: "blue",
  pending: "amber",
  failed: "red",
  on_hold: "red",
};

function asStatus(v?: string): PayoutStatus | undefined {
  return STATUSES.find((s) => s === v);
}

/**
 * ponytail: TECHO de filas. La pantalla no pagina —nunca lo hizo— y las tres
 * cifras de arriba se calculan sobre lo que se lee, así que sin un límite
 * explícito quien decide cuántas filas entran es el `max-rows` de PostgREST
 * (1000 por defecto en Supabase) **en silencio**: las cifras dirían menos de lo
 * que hay y nadie se enteraría. Con techo propio se pide una fila de más y, si
 * llega, la pantalla lo DICE. El día que 500 se quede corto, lo que toca es
 * paginar como `/admin/payments`, no subir el número.
 */
const TECHO = 500;

/** El valor del filtro de país para «el tutor no ha declarado ninguno». */
const SIN_PAIS = "sin-pais";

/**
 * ponytail: TECHO de consultas de destino. `manual_destination` y
 * `payout_beneficiary` son RPC de una en una y aquí se llaman todas en
 * paralelo, así que sin tope una vista con doscientas órdenes manuales abriría
 * doscientas llamadas de golpe. El techo es a propósito y NO se sube: el día que
 * haga falta, lo que toca es filtrar (por país o por estado) o pedir los
 * destinos por lotes, que es otra migración.
 *
 * ⚠️ Se aplica POR FAMILIA de destino, no al total: 25 tutores de riel de canal
 * MÁS 25 órdenes de riel bancario. Compartir un presupuesto entre las dos
 * habría hecho que una tanda de órdenes venezolanas dejara sin coordenadas a
 * las colombianas de la misma pantalla, que es un límite raro de explicar y
 * peor de depurar.
 *
 * ⚠️ Vive fuera del componente porque los dos mensajes de «no se ha
 * consultado» lo NOMBRAN: si el número está en dos sitios, el texto miente el
 * día que uno de los dos cambie.
 */
const TOPE_DESTINOS = 25;

/**
 * Los tres tipos de cuenta del enum global de dLocal, en castellano.
 *
 * ponytail: TECHO de tres valores, y el código se sigue enseñando al lado. No
 * es una traducción cosmética —quien va a hacer la transferencia tiene que
 * elegir «ahorros» o «corriente» en la web de su banco, y `SAVINGS` no es una
 * de las opciones que le ofrece— pero tampoco es un dato nuestro: el que manda
 * es el que el tutor guardó, así que se pinta también en crudo. Un valor que no
 * esté aquí (CBU, ALIAS, o uno nuevo) sale tal cual, que es lo correcto:
 * inventarle un nombre en castellano a un formato argentino sería peor.
 */
const TIPO_DE_CUENTA: Record<string, string> = {
  CHECKING: "corriente",
  SAVINGS: "ahorros",
  VISTA: "vista",
};

/** Suma por moneda de un subconjunto; "—" si no hay nada. */
function sumLine(rows: { amount: number; currency: string }[]): string {
  if (rows.length === 0) return "—";
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
  return [...by.entries()].map(([c, a]) => formatMoney(a, c)).join(" · ");
}

type FilaPayout = {
  id: string;
  tutor_id: string;
  status: PayoutStatus;
  currency: string;
  amount: number;
  provider: string | null;
  /** En qué balance está el dinero. Descarta a los rieles atados que no sean él. */
  funding_provider: string | null;
  provider_payout_id: string | null;
  provider_metadata: Json | null;
  payee_country: string | null;
  scheduled_for: string | null;
  paid_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  created_at: string;
  profiles: { full_name: string | null } | null;
};

type ReglaDeRuteo = {
  payee_country: string | null;
  payer_country: string | null;
  payout_providers: string[];
  priority: number;
  is_active: boolean;
};

/**
 * EL RIEL: por dónde sale este dinero, y sobre todo si sale solo o lo tiene que
 * sacar una persona.
 *
 * Se resuelve con la MISMA consulta que hace `payouts_backlog()` sobre
 * `payment_routing_rules` (regla activa, comodín de pagador, país del
 * beneficiario, menor prioridad primero). No se deduce de `payout_country_rules`
 * ni de una lista de países en el TSX a propósito: quién ejecuta un payout lo
 * decide la tabla de ruteo y solo ella, y tener ese razonamiento en dos sitios
 * es exactamente el fallo del que avisa `20260901210000` — el día que
 * discrepasen, uno sería el que paga y otro el que se enseña.
 *
 * ⚠️ AQUÍ SE DECIDÍA CON `ejecutor !== 'simulated'`, Y ESO ANULABA LA PANTALLA
 * ENTERA DESDE EL 2-SEP. Mientras 'simulated' fue la única ausencia de ejecutor,
 * la resta funcionaba; `20260902150000` puso Venezuela en `payout_provider =
 * 'manual'`, y como 'manual' ≠ 'simulated' TODA orden venezolana salía
 * «automática»: la tarjeta «Por pagar a mano» decía «0 órdenes» con diez
 * esperando, y la lista de tutores a los que consultar el destino se quedaba
 * vacía — o sea que el admin no veía a dónde pagar, que es la única razón de ser
 * de esta pantalla.
 *
 * Se decide con `rielDePayout()` (`src/lib/payments.ts`), que es la MISMA
 * traducción que usan `payoutCountries()` y el job. Son tres respuestas y no
 * dos:
 *
 *   · `'banco'`  → hay adaptador y el job paga solo. Aquí no hay nada que hacer.
 *   · `'manual'` → lo paga una persona desde esta pantalla, y por eso se le
 *     consulta a dónde (`manual_destination`).
 *   · `null`     → 'simulated', `null` o un error de tecleo en la tabla: ese
 *     destino no se puede pagar por ninguna vía. Hoy es el tutor que no ha
 *     declarado país. NO es «a mano»: no hay riel que ejecutar, y pintarlo como
 *     manual mandaría al admin a buscar un destino de cobro que no existe.
 */
type RielEnPantalla = {
  /** Lo que se pinta en la píldora. */
  etiqueta: string;
  /**
   * El riel según la tabla de ruteo, o `null` si ningún candidato nombra uno.
   * `null` también cuando no se ha podido leer la tabla (ver `resuelto`): son
   * dos «no se sabe» distintos y solo uno es culpa del dato.
   */
  riel: Riel | null;
  /**
   * ¿tiene que sacarla una persona? Es `riel.ejecuta === 'persona'`, o sea
   * 'manual' Y 'banco-manual': piden datos distintos al tutor pero los dos los
   * cierra el admin.
   */
  manual: boolean;
  /** false cuando no se ha podido leer la tabla de ruteo (sin clave de servicio). */
  resuelto: boolean;
};

function rielDe(fila: FilaPayout, reglas: ReglaDeRuteo[] | null): RielEnPantalla {
  // Sin tabla de ruteo no se inventa nada: se dice lo poco que se sabe (quién
  // lo ejecutó, si ya se ejecutó) y la pantalla avisa arriba de por qué.
  if (reglas === null) {
    return { etiqueta: fila.provider ?? "—", riel: null, manual: false, resuelto: false };
  }

  const regla = reglas
    .filter(
      (r) =>
        r.is_active &&
        r.payer_country === null &&
        r.payee_country === fila.payee_country,
    )
    .sort((a, b) => a.priority - b.priority)[0];

  // ⚠️ C2r · El ruteo ya no da UN ejecutor sino una LISTA de candidatos.
  //
  // 🔴 AQUÍ SE COGÍA «EL PRIMER CANDIDATO CON RIEL RECONOCIDO», Y ESO DEJABA
  // COLOMBIA FUERA DE LA PANTALLA ENTERA. Su fila es
  // `{wise, paypal, stripe, banco-manual}` (`20260903140000`), y 'wise' es un
  // riel perfectamente reconocido —está declarado en `RIELES`— que NO TIENE
  // ADAPTADOR: `puedePagar()` devuelve false. Así que la píldora decía «wise»,
  // `ejecuta` era 'proveedor' y `manual` salía false: una orden colombiana que
  // solo puede pagar una persona se pintaba como automática, no entraba en «Por
  // pagar a mano» y no se le preguntaba a dónde transferir. El comentario que
  // había aquí lo llamaba «la preferencia», pero una preferencia que nadie
  // puede ejecutar no es un ejecutor, y `payments.ts` ya lo dice del revés:
  // «su sitio en la lista de candidatos no hace nada».
  //
  // Se elige con el MISMO bucle que `payoutProviderFor` —riel reconocido, que
  // pueda pagar hoy, y si está atado a un balance que sea el del dinero de esta
  // orden— porque tener ese razonamiento en dos sitios es el fallo del que avisa
  // `20260901210000`: el día que discrepen, uno es el que paga y otro el que se
  // enseña. Lo que no se replica es la consulta (la fila ya está leída arriba).
  //
  // `null` = ningún candidato puede pagar esta orden hoy, que es distinto de «no
  // hay riel»: aquí se pinta igual («sin ejecutor») porque para quien mira la
  // cola las dos cosas significan lo mismo — esta orden no sale sola y tampoco
  // hay a dónde mandarla a mano.
  const candidatos = regla?.payout_providers ?? [];
  let riel: Riel | null = null;
  for (const clave of candidatos) {
    const r = rielDePayout(clave);
    if (!r) continue; // typo en la tabla, o 'simulated': no es un riel
    if (!r.puedePagar()) continue; // declarado y esperando cuenta
    if (r.ataduraDeBalance && r.clave !== fila.funding_provider) continue;
    riel = r;
    break;
  }
  const ejecutor = riel?.clave ?? null;

  // Lo que dice el RUTEO. Si ya se ejecutó manda `payouts.provider`, que dice
  // quién la sacó DE VERDAD y no tiene por qué ser quien decía la tabla (un
  // `mark_paid` escribe 'zelle' sobre una orden que el ruteo mandaba a 'dlocal').
  const delRuteo = riel ? (ejecutor ?? "—") : "sin ejecutor";

  // ⚠️ `fila.provider` y el ruteo NO son la misma pregunta, y confundirlos hace
  // que un payout argentino que dLocal rechazó y que se acabó pagando por Zelle
  // se pinte como si fuera de riel manual — o sea, se pierde la información de
  // que ESA orden tendría que haber salido sola. El ruteo dice por dónde IBA;
  // `provider` dice por dónde SALIÓ. Cuando difieren se enseñan las dos.
  const pagadoPorOtro =
    riel !== null && fila.provider !== null && fila.provider !== delRuteo;

  return {
    etiqueta:
      riel === null
        ? (fila.provider ?? delRuteo)
        : pagadoPorOtro
          ? `${delRuteo} · pagado por ${fila.provider}`
          : delRuteo,
    riel,
    // Pagable a mano es una propiedad del riel, no de su nombre: cubre 'manual'
    // (canal e identificador) y 'banco-manual' (transferencia bancaria), que
    // piden datos distintos pero los dos los cierra una persona.
    manual: riel?.ejecuta === "persona",
    resuelto: true,
  };
}

/**
 * La marca que viaja en el `description` de cada `POST /v1/payouts` y que
 * sustituye a la clave de idempotencia que dLocal Go no tiene. Es la cadena que
 * hay que pegar en el buscador del panel del proveedor: la respuesta es sí o no,
 * no «se le parece por importe y fecha».
 */
function marcaDe(fila: FilaPayout): string {
  let intento = 1;
  const meta = fila.provider_metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const c2 = (meta as Record<string, unknown>).c2;
    if (c2 && typeof c2 === "object" && !Array.isArray(c2)) {
      const n = (c2 as Record<string, unknown>).intento;
      if (typeof n === "number" && n >= 1) intento = n;
    }
  }
  return `EY-${fila.id}-${intento}`;
}

/**
 * La referencia del comprobante de un pago hecho A MANO.
 *
 * ⚠️ NO está en `provider_payout_id`, y esa columna es justo donde la intuición
 * la busca. `mark_paid` la deja a null a propósito (`20260902160000`): esa
 * columna es el identificador que da UN PROVEEDOR, y en un pago manual no hay
 * proveedor que dé ninguno — hay un justificante de una transferencia nuestra.
 * Además tiene índice único, y un solo envío por lote a tres tutores comparte
 * justificante: meterlo ahí reventaba la segunda orden con un `duplicate key`.
 *
 * Vive en `provider_metadata -> 'manual' ->> 'referencia'`, de primer nivel y
 * hermana de `c2` (que el job reescribe entero en cada desenlace).
 */
function referenciaManual(fila: FilaPayout): string | null {
  const meta = fila.provider_metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const manual = (meta as Record<string, unknown>).manual;
  if (!manual || typeof manual !== "object" || Array.isArray(manual)) return null;
  const ref = (manual as Record<string, unknown>).referencia;
  return typeof ref === "string" && ref.trim() !== "" ? ref : null;
}

/** Estados desde los que el admin puede cerrar el ciclo a mano (`mark_paid`). */
const PAGABLES_A_MANO: PayoutStatus[] = ["scheduled", "failed", "on_hold"];

/**
 * US-1003 (SCR-AD15) — el admin supervisa payouts, cierra a mano los que no
 * tienen adaptador y desatasca los que se quedaron en vuelo.
 *
 * ── LO QUE ESTA PANTALLA TIENE QUE NO MENTIR (regla de oro 10) ──────────────
 *
 * 1. **Las consultas miran su `error`.** La versión anterior hacía
 *    `const { data } = await q` y pintaba `data ?? []`: un fallo de la consulta
 *    —un embed ambiguo, un grant que falta— se veía en pantalla EXACTAMENTE
 *    igual que «no hay payouts». Es el fallo que dejó la cola de tutores en
 *    «(0)» con 11 esperando el 28-ago. Aquí se revienta a propósito.
 * 2. **El embed nombra su FK.** `profiles!payouts_tutor_id_fkey(...)`. Hoy solo
 *    hay un camino entre `payouts` y `profiles`, así que el embed corto todavía
 *    funciona; nombrarla cuesta doce caracteres y es lo que evita que la primera
 *    tabla puente que una esas dos tablas tire la consulta entera con PGRST201.
 * 3. **Las cifras cubren la cola ENTERA, no lo filtrado.** Antes se calculaban
 *    sobre `payouts` ya filtrado por estado, así que filtrar por «Pagado» dejaba
 *    «En retención» en «—» — que se lee como «no hay nada retenido» cuando lo
 *    que pasa es que lo has escondido tú. Ahora el filtro solo afecta a la
 *    lista, y las tarjetas lo dicen debajo.
 *
 * Lectura por RLS (`payouts_select_admin`); las acciones por RPC `manage_payout`.
 */
export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; country?: string; riel?: string }>;
}) {
  await requireRole("admin");
  const sp = await searchParams;
  const status = asStatus(sp.status);

  const [tz, supabase] = await Promise.all([getUserTimezone(), createClient()]);

  // ── 1 · La cola entera (con techo), SIN filtrar ───────────────────────────
  // Una sola consulta para las cifras y para la lista: así no pueden discrepar.
  // Los tres filtros se aplican en memoria más abajo — el del riel no se puede
  // hacer en SQL (es derivado) y partirlo en «dos en SQL y uno aquí» solo
  // conseguiría que las tarjetas contaran un conjunto y la lista otro.
  const { data, error } = await supabase
    .from("payouts")
    .select(
      "id, tutor_id, status, currency, amount, provider, funding_provider, provider_payout_id, provider_metadata, payee_country, scheduled_for, paid_at, failed_at, failure_reason, created_at, profiles!payouts_tutor_id_fkey(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(TECHO + 1); // pide una de más → sabe si se ha quedado corto

  if (error) {
    throw new Error(`No se pudo leer la cola de payouts: ${error.message}`);
  }

  const leidas = (data ?? []) as unknown as FilaPayout[];
  const recortada = leidas.length > TECHO;
  const todas = recortada ? leidas.slice(0, TECHO) : leidas;

  // ── 2 · El ruteo, que es lo que dice el riel ──────────────────────────────
  // `payment_routing_rules` NO tiene grant para `authenticated` (su comentario
  // de `20260709160000` lo dice: solo admin por RLS, y el runtime la lee dentro
  // de las RPC). El único rol con `select` es `service_role`
  // (`20260806180000`), así que esta lectura va por el cliente de servicio —
  // igual que la de destinos de abajo, que no tiene otra puerta.
  //
  // ⚠️ Y si falta la clave, `createAdminClient()` LANZA. Antes esta pantalla no
  // la necesitaba, así que reventar por eso sería romper el panel de admin en
  // cualquier entorno sin `SUPABASE_SERVICE_ROLE_KEY`. Se degrada diciendo qué
  // falta: sin riel no se puede filtrar por riel, pero la cola se sigue viendo.
  let admin: ReturnType<typeof createAdminClient> | null = null;
  let faltaServicio: string | null = null;
  try {
    admin = createAdminClient();
  } catch (e) {
    faltaServicio = e instanceof Error ? e.message : String(e);
  }

  let reglas: ReglaDeRuteo[] | null = null;
  let errorRuteo: string | null = null;
  if (admin) {
    const { data: rr, error: errRR } = await admin
      .from("payment_routing_rules")
      .select("payee_country, payer_country, payout_providers, priority, is_active");
    if (errRR) errorRuteo = errRR.message;
    else reglas = (rr ?? []) as unknown as ReglaDeRuteo[];
  }

  // ── 3 · Riel por fila, y de ahí todo lo demás ─────────────────────────────
  const conRiel = todas.map((p) => ({ fila: p, riel: rielDe(p, reglas) }));

  const paises = [
    ...new Set(todas.map((p) => p.payee_country).filter((c): c is string => !!c)),
  ].sort();
  const rieles = [
    ...new Set(conRiel.map((x) => x.riel.etiqueta).filter((r) => r !== "—")),
  ].sort();

  const visibles = conRiel.filter(({ fila, riel }) => {
    if (status && fila.status !== status) return false;
    if (sp.country === SIN_PAIS && fila.payee_country !== null) return false;
    if (sp.country && sp.country !== SIN_PAIS && fila.payee_country !== sp.country)
      return false;
    if (sp.riel && riel.etiqueta !== sp.riel) return false;
    return true;
  });

  // ── 4 · Las cifras, sobre la cola entera ──────────────────────────────────
  const enCurso = todas.filter(
    (p) => p.status === "scheduled" || p.status === "processing",
  );
  const enRetencion = todas.filter((p) => p.status === "pending");
  const atascadas = todas.filter(
    (p) => p.status === "failed" || p.status === "on_hold",
  );
  const aMano = conRiel
    .filter((x) => x.riel.manual && PAGABLES_A_MANO.includes(x.fila.status))
    .map((x) => x.fila);

  // 🔴 La cifra que nunca puede quedarse arriba (`payouts_backlog().sin_identificar`):
  // órdenes reclamadas de las que no se sabe si el proveedor llegó a crear el
  // payout. No se resuelven solas a propósito.
  const sinIdentificar = todas.filter(
    (p) => p.status === "processing" && p.provider_payout_id === null,
  );

  // ── 5 · A dónde pagar, solo para lo que hay que pagar a mano ──────────────
  //
  // `manual_destination` devuelve el identificador EN CLARO y su `execute` es
  // solo de `service_role`: no existe como endpoint de PostgREST, así que se
  // resuelve aquí, en el servidor, y viaja ya resuelto a los botones (regla de
  // oro 3). Se pide SOLO para los tutores de las órdenes visibles que hay que
  // pagar a mano —no para toda la lista— porque cada llamada devuelve un correo
  // o un teléfono y no hay ninguna razón para meter en el HTML los datos de
  // cobro de gente a la que hoy no se le paga.
  //
  // ponytail: una llamada por tutor, en paralelo y con tope (`TOPE_DESTINOS`).
  // La RPC es por tutor (así la escribió `20260902110000`: quien elige el canal
  // es la persona que paga, mirando la lista), y una versión por lotes sería
  // otra migración para ahorrar unas cuantas idas y venidas en una pantalla de
  // admin.
  //
  // ⚠️ EL TOPE SE RECORDABA COMO UN FALLO QUE NO HABÍA PASADO. Los tutores que
  // se quedaban fuera del corte no entraban en el mapa, y la fila los pintaba
  // con el texto de «no se han podido consultar los datos de cobro» — que es el
  // que está reservado para «falta la clave de servicio». Con 30 órdenes
  // manuales, cinco tutores perfectamente sanos salían marcados como rotos. Son
  // TRES casos y hay que distinguirlos: no consultado (el tope), no se pudo
  // consultar (error) y consultado sin resultado (el tutor no ha registrado
  // nada). Por eso lo que viaja a la fila es `undefined` / `null` / `[]` y no
  // un `?? null` que los aplasta a dos.
  //
  // ⚠️ Y SON DOS FAMILIAS DE DESTINO, NO UNA. Aquí se le preguntaba
  // `manual_destination` a TODO tutor con una orden a mano, y eso valía mientras
  // el único riel manual fue Venezuela. Desde `20260903140000` Colombia va por
  // `banco-manual`: su tutor tiene banco, cédula y número de cuenta guardados en
  // `tutor_payout_accounts`, y a la RPC de canales no le consta nada de eso —
  // devolvía `no_data_found` y la fila pintaba «este tutor no ha registrado
  // ningún destino de cobro manual». O sea que el admin veía «pagable a mano» y
  // «no hay a dónde pagarle» en la misma fila, y las dos frases eran falsas a la
  // vez.
  //
  // La familia se decide con `rielDePayout(clave)?.dato`, NO por país ni por el
  // nombre del proveedor: son cuatro rieles hoy y el eje que importa aquí es
  // qué se le pidió al tutor. Cada una tiene su puerta y ninguna sirve para la
  // otra:
  //
  //   'identificador' → `manual_destination(tutor_id)` · por TUTOR
  //   'banco'         → `payout_beneficiary(payout_id)` · por PAYOUT
  const aManoVisibles = visibles.filter(
    (x) => x.riel.manual && PAGABLES_A_MANO.includes(x.fila.status),
  );

  const tutoresManual = [
    ...new Set(
      aManoVisibles
        .filter((x) => x.riel.riel?.dato === "identificador")
        .map((x) => x.fila.tutor_id),
    ),
  ];
  const tutoresAPagar = tutoresManual.slice(0, TOPE_DESTINOS);

  // `null` = no se pudo preguntar; `[]` = se preguntó y no hay nada registrado.
  // Ausente del mapa = no se preguntó (quedó fuera del tope).
  const destinos = new Map<string, DestinoManual[] | null>();
  if (admin && tutoresAPagar.length > 0) {
    const respuestas = await Promise.all(
      tutoresAPagar.map((id) =>
        rpcNueva<DestinosDeTutor>(admin, "manual_destination", { p_tutor_id: id }),
      ),
    );
    respuestas.forEach((r, i) => {
      const id = tutoresAPagar[i];
      // `no_data_found` no es un fallo: es «este tutor no ha registrado dónde
      // cobrar», que es información accionable (hay que escribirle) y no un
      // error de la pantalla. Cualquier otro error deja el destino en `null`,
      // que se pinta como «no se pudo consultar».
      if (r.error) {
        destinos.set(id, r.error.code === "P0002" ? [] : null);
        return;
      }
      destinos.set(id, r.data?.destinations ?? []);
    });
  }

  // ── 5b · Y a dónde TRANSFERIR, para la familia bancaria ───────────────────
  //
  // `payout_beneficiary(payout_id)` es la única puerta al número de cuenta
  // entero: `tutor_payout_accounts.bank_account` y `.beneficiary_document` no
  // tienen `grant select` para ningún rol, y el `execute` de la función es solo
  // de `service_role` (`20260901160000` §8). Se resuelve aquí, en el servidor,
  // y viaja ya resuelto a la fila (regla de oro 3). NO se lee la tabla.
  //
  // Va por PAYOUT porque la función valida cosas de la orden —estado ejecutable,
  // país de destino, que el país de los datos coincida con `payee_country`,
  // que los datos SIGAN validando contra `payout_country_rules`— así que dos
  // órdenes del mismo tutor pueden dar respuestas distintas. Ver `./rpc.ts`.
  //
  // ponytail: mismo tope y mismo criterio que los canales de arriba, y aplicado
  // por familia en vez de al total. Son dos colas cortas: 25 tutores + 25
  // órdenes, no 25 entre las dos. Lo que no se pregunta se DICE en la fila.
  //
  // ⚠️ `PAGABLES_A_MANO` incluye 'failed' y 'on_hold', y `payout_beneficiary`
  // solo construye beneficiario desde 'scheduled' y 'processing'. Esas dos
  // vuelven con `no-ejecutable` y su mensaje; se preguntan igual, a propósito:
  // el motivo por el que no se puede leer el destino es lo que el admin tiene
  // que saber (hay que liberar o reintentar la orden antes de transferir), y
  // esconderlo dejaría un «Marcar pagado» sin coordenadas y sin explicación.
  const ordenesBancarias = aManoVisibles
    .filter((x) => x.riel.riel?.dato === "banco")
    .map((x) => x.fila);
  const bancariasAPagar = ordenesBancarias.slice(0, TOPE_DESTINOS);

  const beneficiarios = new Map<string, DestinoBancario>();
  if (admin && bancariasAPagar.length > 0) {
    const respuestas = await Promise.all(
      bancariasAPagar.map((p) => leerBeneficiario(admin, p.id)),
    );
    respuestas.forEach((r, i) => beneficiarios.set(bancariasAPagar[i].id, r));
  }

  // El NOMBRE del banco, que es lo que se busca en la web del banco propio:
  // `payout_beneficiary` devuelve el `bank_code` (lo que pide el POST de
  // dLocal) y un código de tres dígitos no le dice nada a quien va a hacer la
  // transferencia.
  //
  // ⚠️ Esta lectura va por el cliente del USUARIO y no por el de servicio, al
  // revés que las dos de arriba, y es la regla de oro 9 en su forma útil:
  // `payout_banks` concede `select` a `authenticated` y a nadie más
  // (`20260901160000:260`), así que con el cliente de servicio esto sería un
  // `permission denied` en tiempo de ejecución. Su RLS filtra por `is_active`,
  // así que un banco desactivado no vuelve — y eso también hay que decirlo en
  // vez de pintar el hueco.
  const paisesBancarios = [
    ...new Set(
      bancariasAPagar
        .map((p) => p.payee_country)
        .filter((c): c is string => c !== null),
    ),
  ];
  const nombresDeBanco = new Map<string, string>();
  let errorBancos: string | null = null;
  if (paisesBancarios.length > 0) {
    const { data: bs, error: errBancos } = await supabase
      .from("payout_banks")
      .select("country, bank_code, name")
      .in("country", paisesBancarios);
    // Regla de oro 10: sin mirar el `error`, un grant que falte se vería igual
    // que «este país no tiene bancos en el catálogo».
    if (errBancos) errorBancos = errBancos.message;
    else {
      for (const b of bs ?? []) nombresDeBanco.set(`${b.country}|${b.bank_code}`, b.name);
    }
  }

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString("es", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz, // regla de oro 4
    });

  return (
    <AdminShell
      title="Payouts a tutores"
      description="Lote por tutor y moneda (RN-13/RN-15). Retén, libera, reintenta — y cierra a mano lo que no tiene adaptador (M7)."
    >
      {/* Lo primero: ¿hay algo de lo que no se sabe si se pagó? */}
      {sinIdentificar.length > 0 ? (
        <PanelCard className="border-[#e8b4b4] bg-[#fdf0f0]">
          <p className="text-[13px] font-semibold text-[#8f2b2b]">
            {sinIdentificar.length}{" "}
            {sinIdentificar.length === 1
              ? "orden reclamada sin identificador del proveedor"
              : "órdenes reclamadas sin identificador del proveedor"}
            : {sumLine(sinIdentificar)}.
          </p>
          <p className="mt-1 text-[13px] text-[#8f2b2b]">
            Se le pidió el pago al proveedor y no sabemos si lo creó
            (<code className="font-mono text-xs">POST /v1/payouts</code> no tiene
            clave de idempotencia). No se reintentan solas a propósito:
            reintentar es elegir pagar dos veces. Busca su marca{" "}
            <code className="font-mono text-xs">EY-&lt;id&gt;-&lt;intento&gt;</code>{" "}
            en el panel del proveedor y usa <strong>Anotar</strong> si existe o{" "}
            <strong>Devolver a la cola</strong> si no.
          </p>
        </PanelCard>
      ) : null}

      {/* Sin ruteo no hay riel, y sin riel esta pantalla no sabe qué se paga a
          mano. Se dice, en vez de enseñar una columna vacía que parece un dato. */}
      {faltaServicio || errorRuteo ? (
        <PanelCard className="border-[#f0c987] bg-[#fdf6e7]">
          <p className="text-[13px] font-semibold text-[#8a5a12]">
            No se ha podido resolver el riel de estas órdenes.
          </p>
          <p className="mt-1 text-[13px] text-[#8a5a12]">
            {faltaServicio
              ? "Falta la clave de servicio en este entorno, y tanto la tabla de ruteo como los datos de cobro manual solo se pueden leer con ella."
              : "La tabla de ruteo devolvió un error."}{" "}
            La cola se sigue viendo, pero la columna <strong>Riel</strong>, el
            filtro por riel y el destino de cobro de cada tutor no están
            disponibles.{" "}
            <span className="font-mono text-xs">
              {faltaServicio ?? errorRuteo}
            </span>
          </p>
        </PanelCard>
      ) : null}

      {recortada ? (
        <PanelCard className="border-[#f0c987] bg-[#fdf6e7]">
          <p className="text-[13px] text-[#8a5a12]">
            Hay más de {TECHO} payouts: esta pantalla solo lee los {TECHO} más
            recientes, así que las cifras de abajo son de ese trozo y no de la
            cola entera. Toca paginar.
          </p>
        </PanelCard>
      ) : null}

      {/* Cifras sobre la cola COMPLETA, no sobre lo filtrado (ver cabecera). */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Programados y en vuelo" value={sumLine(enCurso)} />
        <Stat label="En retención" value={sumLine(enRetencion)} />
        <Stat label="Fallidos / retenidos" value={sumLine(atascadas)} />
        <Stat
          label="Por pagar a mano"
          value={sumLine(aMano)}
          sub={
            reglas === null
              ? "sin ruteo no se puede saber"
              : `${aMano.length} ${aMano.length === 1 ? "orden" : "órdenes"} en riel manual`
          }
        />
      </div>
      <p className="-mt-1 text-xs text-[#6b6b6b]">
        Las cuatro cifras cubren la cola entera: los filtros de abajo solo
        recortan la lista, nunca los totales.
      </p>

      <AdminFilters
        basePath="/admin/payouts"
        fields={[
          { name: "status", label: "Estado", type: "select", options: STATUS_OPTIONS },
          {
            name: "country",
            label: "País del tutor",
            type: "select",
            options: [
              ...paises.map((c) => ({ value: c, label: `${nombrePais(c)} (${c})` })),
              { value: SIN_PAIS, label: "Sin país declarado" },
            ],
          },
          {
            name: "riel",
            label: "Riel",
            type: "select",
            options: rieles.map((r) => ({
              value: r,
              label: rielDePayout(r)?.ejecuta === "persona" ? `${r} (a mano)` : r,
            })),
          },
        ]}
      />

      {visibles.length === 0 ? (
        <PanelCard>
          <p className="text-[13px] text-[#6b6b6b]">
            No hay payouts con estos filtros.
            {todas.length > 0
              ? ` La cola tiene ${todas.length} ${todas.length === 1 ? "orden" : "órdenes"} en total.`
              : ""}
          </p>
        </PanelCard>
      ) : (
        <PanelCard className="py-2">
          <p className="pb-1 pt-2 text-xs text-[#6b6b6b]">
            {visibles.length} de {todas.length}{" "}
            {todas.length === 1 ? "orden" : "órdenes"} con estos filtros.
          </p>
          <ul className="divide-y divide-[#e0e0e0]">
            {visibles.map(({ fila: p, riel }) => {
              const b = PAYOUT_BADGE[p.status];
              const pagableAMano = riel.manual && PAGABLES_A_MANO.includes(p.status);
              // ⚠️ SIN `?? null`: `undefined` (no se preguntó, por el tope) y
              // `null` (se preguntó y falló) dicen cosas distintas, y solo una
              // de las dos es un problema. Aquí `undefined` únicamente puede
              // venir del tope: si faltara la clave de servicio, `reglas` sería
              // null, `riel.manual` false y esta rama ni se pintaría.
              // Qué se le pidió al tutor. Cuando la fila es pagable a mano
              // esto NO puede ser null: `riel.manual` ya exige un riel
              // reconocido (`ejecuta === 'persona'`), y un riel siempre tiene
              // familia. Se deja como unión para que el día que aparezca una
              // tercera familia no compile en silencio.
              const familia: FamiliaDeDato | null = riel.riel?.dato ?? null;
              const dest =
                pagableAMano && familia === "identificador"
                  ? destinos.get(p.tutor_id)
                  : undefined;
              const banco =
                pagableAMano && familia === "banco"
                  ? beneficiarios.get(p.id)
                  : undefined;
              return (
                <li key={p.id} className="flex flex-col gap-2.5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 sm:w-72">
                      <p className="truncate text-[13.5px] font-semibold text-[#19191f]">
                        #{p.id.slice(0, 8)} ·{" "}
                        <span className="tabular-nums">
                          {formatMoney(p.amount, p.currency)}
                        </span>
                      </p>
                      <p className="truncate text-xs text-[#6b6b6b]">
                        {p.profiles?.full_name ?? "Tutor"}
                        {p.payee_country
                          ? ` · ${nombrePais(p.payee_country)}`
                          : " · sin país declarado"}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11.5px] text-[#6b6b6b]">Riel</p>
                      <div className="mt-1 flex items-center gap-2">
                        <StatusPill tone={riel.manual ? "amber" : "gray"}>
                          {riel.etiqueta}
                        </StatusPill>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <p className="text-[11.5px] text-[#6b6b6b]">
                        {p.paid_at
                          ? "Pagado"
                          : p.failed_at
                            ? "Falló"
                            : p.scheduled_for
                              ? "Programado"
                              : "Creado"}
                      </p>
                      <p className="text-[13px] font-medium text-[#404040] tabular-nums">
                        {fecha(
                          p.paid_at ?? p.failed_at ?? p.scheduled_for ?? p.created_at,
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-[#6b6b6b]">Estado (M7)</p>
                      <StatusPill
                        tone={PAYOUT_PILL[p.status] ?? "neutral"}
                        className="mt-1"
                      >
                        {b.label}
                      </StatusPill>
                    </div>
                  </div>

                  {/* Segunda línea: el detalle con el que se concilia. */}
                  <p className="text-xs text-[#6b6b6b]">
                    Espera {esperaDesde(p.scheduled_for ?? p.created_at)}
                    {p.provider_payout_id
                      ? ` · id del proveedor ${p.provider_payout_id}`
                      : referenciaManual(p)
                        ? ` · referencia ${referenciaManual(p)}`
                        : ""}
                    {p.status === "processing" && !p.provider_payout_id
                      ? ` · 🔴 sin identificar — busca ${marcaDe(p)} en el panel del proveedor`
                      : ""}
                    {p.failure_reason ? ` · ${p.failure_reason}` : ""}
                  </p>

                  {/* A dónde pagar. Solo para lo que hay que pagar a mano, y
                      cada familia con su destino: las dos conviven en la misma
                      cola —una orden venezolana y una colombiana se ven a la
                      vez— y ninguna de las dos pintadas sirve para la otra. */}
                  {pagableAMano ? (
                    familia === "banco" ? (
                      <DestinoBanco
                        destino={banco}
                        moneda={p.currency}
                        nombreDelBanco={(pais, code) =>
                          nombresDeBanco.get(`${pais}|${code}`) ?? null
                        }
                        catalogoRoto={errorBancos !== null}
                      />
                    ) : (
                      <Destinos destinos={dest} />
                    )
                  ) : null}

                  <PayoutActions
                    payoutId={p.id}
                    status={p.status}
                    manual={riel.manual}
                    familia={familia}
                    marca={marcaDe(p)}
                    identificado={p.provider_payout_id !== null}
                    canales={(dest ?? []).map((d) => d.channel)}
                  />
                </li>
              );
            })}
          </ul>
        </PanelCard>
      )}

      {/* La decisión del 2-sep, escrita donde se mira el importe.
          ⚠️ NO se reutiliza `avisoDeImporteAproximado()` de `dlocal-provider.ts`
          aunque diga lo mismo: ese texto está escrito en segunda persona para el
          TUTOR («el importe se te paga en ARS») y aquí quien lee es quien paga.
          Repetirlo tal cual sería más raro que decirlo bien una vez. */}
      {/* ⚠️ La condición mira la CLAVE del riel y no su familia de dato, y desde
          C2r eso importa: el aviso habla del tipo de cambio DE dLOCAL, y
          'banco' incluye ahora también a Wise y al payout directo de Stripe,
          que no convierten con la tasa de dLocal. Antes decía `clase ===
          'banco'` para no meter las órdenes sin ejecutor —que era el bug que
          arregló—, pero se quedó corto en la otra dirección. */}
      {reglas !== null &&
      visibles.some(({ riel }) => riel.riel?.clave === "dlocal") ? (
        <p className="text-xs text-[#6b6b6b]">
          En los rieles con conversión —los 7 países de dLocal con moneda local;
          Ecuador no, cobra en USD— el importe de cada fila es lo que{" "}
          <strong>sale</strong> de Enséñame Ya. Lo que le llega al tutor en su
          moneda lo fija dLocal con su tipo de cambio el día de la transferencia,
          y ese diferencial lo asume él (decisión del 2-sep-2026).
        </p>
      ) : null}
    </AdminShell>
  );
}

/**
 * Dónde cobra este tutor. El identificador va EN CLARO y sin recortar: quien
 * mira esta pantalla está a punto de copiarlo en Zelle o en Zinli, y un dato de
 * pago a medias es peor que ninguno.
 */
function Destinos({ destinos }: { destinos: DestinoManual[] | null | undefined }) {
  // No se preguntó: la vista trae más órdenes manuales de las que se consultan
  // de una vez. Es una limitación de la pantalla, no un dato roto del tutor —
  // decirlo con el texto del error de abajo es lo que hacía que el admin viera
  // cinco tutores «rotos» que no lo estaban.
  if (destinos === undefined) {
    return (
      <p className="text-xs text-[#6b6b6b]">
        Datos de cobro no consultados: esta vista tiene más de {TOPE_DESTINOS}{" "}
        tutores con órdenes a mano y solo se preguntan los {TOPE_DESTINOS}{" "}
        primeros. Filtra por país o por estado para ver a dónde pagarle a este
        tutor.
      </p>
    );
  }
  if (destinos === null) {
    return (
      <p className="text-xs text-[#8a5a12]">
        No se han podido consultar los datos de cobro de este tutor.
      </p>
    );
  }
  if (destinos.length === 0) {
    return (
      <p className="text-xs text-[#8f2b2b]">
        Este tutor no ha registrado ningún destino de cobro manual: no hay a
        dónde pagarle todavía. Hay que pedírselo antes de marcar nada.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-[#f7f7f9] px-3 py-2">
      <p className="text-[11.5px] text-[#6b6b6b]">Pagar a</p>
      {destinos.map((d) => (
        <p key={d.channel} className="text-[13px] text-[#333333]">
          <span className="font-semibold">{d.label}</span> ·{" "}
          <span className="font-mono select-all">{d.handle}</span> ·{" "}
          {d.holder_name}
          {d.is_active ? null : (
            <span className="text-[#8f2b2b]">
              {" "}
              · ⚠️ canal desactivado: pídele otro al tutor
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

/**
 * A DÓNDE TRANSFERIR — la otra familia de destino, la que tiene coordenadas
 * bancarias en vez de un canal y un identificador.
 *
 * Es a `DestinoBanco` lo que `Destinos` es al riel de canal, y existe por la
 * misma razón: sin esto, el admin ve «pagable a mano» y no ve a dónde, así que
 * la función que abrió `20260903140000` no sirve para nada.
 *
 * Mismo criterio de privacidad que la de arriba, y por el mismo motivo: el
 * documento y el número de cuenta van EN CLARO y sin recortar, porque quien
 * mira esto está a punto de teclearlos en la web de su banco y un dato de pago
 * a medias es peor que ninguno. Lo que limita la exposición no es enmascarar,
 * es preguntar poco: solo se piden para las órdenes VISIBLES que hay que pagar
 * a mano, nunca para la lista entera.
 */
function DestinoBanco({
  destino,
  moneda,
  nombreDelBanco,
  catalogoRoto,
}: {
  /** `undefined` = no se preguntó (tope). Ver los cuatro estados en `./rpc.ts`. */
  destino: DestinoBancario | undefined;
  /** `payouts.currency`, para decir si la cuenta es de otra moneda. */
  moneda: string;
  /** `payout_banks` ya leído, inyectado: este componente no consulta nada. */
  nombreDelBanco: (pais: string, bankCode: string) => string | null;
  /** ¿falló la lectura del catálogo? Cambia por qué falta el nombre. */
  catalogoRoto: boolean;
}) {
  if (destino === undefined) {
    return (
      <p className="text-xs text-[#6b6b6b]">
        Coordenadas bancarias no consultadas: esta vista tiene más de{" "}
        {TOPE_DESTINOS} órdenes con transferencia pendiente y solo se preguntan
        las {TOPE_DESTINOS} primeras. Filtra por país o por estado para ver a
        dónde transferirle.
      </p>
    );
  }
  if (destino.estado === "error") {
    return (
      <p className="text-xs text-[#8a5a12]">
        No se han podido leer las coordenadas bancarias de esta orden.{" "}
        <span className="font-mono">{destino.mensaje}</span>
      </p>
    );
  }
  if (destino.estado === "sin-datos") {
    return (
      <p className="text-xs text-[#8f2b2b]">
        No hay a dónde transferirle todavía: {destino.mensaje}. Hay que pedirle
        que registre sus datos bancarios antes de marcar nada.
      </p>
    );
  }
  if (destino.estado === "no-ejecutable") {
    // El mensaje de la BD entero y tal cual: dice si es el estado de la orden,
    // el país que no coincide o un dato que dejó de validar, y esas son cuatro
    // cosas distintas que se arreglan de cuatro maneras. La frase de después es
    // la única que se añade, y vale para las cuatro.
    return (
      <p className="text-xs text-[#8f2b2b]">
        No se pueden construir sus coordenadas de cobro: {destino.mensaje}. Eso
        es lo que hay que resolver antes de transferir — y ojo, «Marcar pagado»
        sigue disponible: si transfieres sin leer esto, estarás cerrando una
        orden con un destino que la base de datos considera inválido.
      </p>
    );
  }

  const b = destino.datos;
  const nombre = nombreDelBanco(b.transfer_country, b.bank_code);
  const tipo = b.bank_account_type;
  const monedaDeLaCuenta = b.currency_to_pay?.toUpperCase() ?? null;

  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-[#f7f7f9] px-3 py-2">
      <p className="text-[11.5px] text-[#6b6b6b]">Transferir a</p>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[7.5rem_1fr]">
        <Campo k="Titular">
          {b.beneficiary_first_name} {b.beneficiary_last_name}
        </Campo>
        <Campo k="Documento">
          <span className="text-[#6b6b6b]">{b.beneficiary_document_type}</span>{" "}
          <DatoCopiable valor={b.beneficiary_document} etiqueta="el documento" />
        </Campo>
        <Campo k="Banco">
          {nombre ? (
            <>
              <span className="font-semibold">{nombre}</span>{" "}
              <span className="text-[#6b6b6b]">· código {b.bank_code}</span>
            </>
          ) : (
            <>
              <span className="font-semibold">código {b.bank_code}</span>{" "}
              <span className="text-[#8a5a12]">
                ·{" "}
                {catalogoRoto
                  ? "no se pudo leer el catálogo de bancos, así que falta el nombre"
                  : "el catálogo ya no lo nombra (banco desactivado): confírmalo con el tutor antes de transferir"}
              </span>
            </>
          )}
        </Campo>
        {tipo ? (
          <Campo k="Tipo de cuenta">
            {TIPO_DE_CUENTA[tipo] ? (
              <>
                {TIPO_DE_CUENTA[tipo]}{" "}
                <span className="text-[#6b6b6b]">({tipo})</span>
              </>
            ) : (
              tipo
            )}
          </Campo>
        ) : null}
        <Campo k="Cuenta">
          <DatoCopiable valor={b.bank_account} etiqueta="el número de cuenta" />
        </Campo>
        {b.bank_branch ? <Campo k="Sucursal">{b.bank_branch}</Campo> : null}
      </dl>
      {/* La moneda, dicha y NO calculada (regla de oro 2): el importe de la
          fila es lo que sale de Enséñame Ya, en la moneda de la orden, y aquí
          no se convierte nada — ni con tipo de cambio ni con redondeo. Para el
          riel bancario manual, quién asume el diferencial sigue SIN DECIDIR
          (`docs/PAGOS-Y-PAYOUTS.md` §1.1), así que se dice eso y no una cifra. */}
      {monedaDeLaCuenta && monedaDeLaCuenta !== moneda.toUpperCase() ? (
        <p className="text-xs text-[#6b6b6b]">
          La cuenta es en {monedaDeLaCuenta} y la orden está en{" "}
          {moneda.toUpperCase()}: la conversión la hace quien transfiere, con el
          tipo de cambio de su banco, y quién asume ese diferencial todavía no
          está decidido.
        </p>
      ) : null}
    </div>
  );
}

/** Una línea de la ficha: etiqueta y valor. Fragmento, para que manden las
    columnas del `<dl>` de arriba y no una caja intermedia. */
function Campo({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[11.5px] text-[#6b6b6b] sm:pt-[3px]">{k}</dt>
      <dd className="text-[13px] text-[#333333]">{children}</dd>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <PanelCard className="p-5">
      <p className="text-xs text-[#6b6b6b]">{label}</p>
      <p className="mt-1.5 truncate text-[22px] font-bold text-[#19191f] tabular-nums">
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-[#6b6b6b]">{sub}</p> : null}
    </PanelCard>
  );
}
