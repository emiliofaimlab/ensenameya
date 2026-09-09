"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/form/field-error";
import { AUTH_FIELD, AUTH_LABEL, AUTH_SUBMIT } from "@/components/auth/field-classes";
import { describedBy } from "@/components/form/validation";
import { irAPagar, type DlocalTransparente } from "@/components/checkout/respuesta-de-cobro";

/**
 * EL CHECKOUT DE dLOCAL, DENTRO DE NUESTRA PANTALLA — dictado de pagos §2 punto 2.
 *
 * Gemelo de `stripe-embed.tsx` y con su misma forma a propósito: se monta en los
 * mismos TRES sitios (checkout de una reserva, «Pagar ahora» de una a medias y
 * pago de un pedido), tiene el mismo tope de ancho y vive en el mismo grupo
 * visual. Lo que cambia es de quién es el botón.
 *
 * ── LAS TRES DIFERENCIAS CON STRIPE, Y NINGUNA ES DE ESTILO ─────────────────
 *
 * 1. **EL BOTÓN DE PAGAR ES NUESTRO.** dLocal no trae uno: su SDK solo pinta el
 *    campo de la tarjeta. Así que aquí hay un `<form>` de verdad, con su
 *    `onSubmit`, su estado de envío y su `aria-live`. En Stripe el botón vive
 *    dentro de su iframe y poner otro nuestro abriría un segundo cobro.
 *
 * 2. **EL FORMULARIO PIDE TRES DATOS MÁS**: nombre, apellido y número de
 *    documento. Los exige dLocal para cobrar fuera de su checkout (dictado §2,
 *    D-4). El correo NO se pide: sale de la sesión, en el servidor.
 *
 *    ⚠️ Y son CUATRO en casi todas partes. dLocal exige además el **tipo** de
 *    documento (sin él, `confirm` → `908 Missing field: clientDocumentType`), y
 *    solo se puede rellenar solo donde el país ofrece un único tipo. Medido: eso
 *    hoy es únicamente **Ecuador** (`CI`); AR, BR, CL y MX ofrecen dos o tres y
 *    ven el desplegable. El dictado §2 dice que el tipo «no hace falta
 *    (medido)»; contra este sandbox, hace falta.
 *
 *    ⚠️ NI UNA REGLA DE FORMATO ES NUESTRA. Qué campos hay, en qué orden y con
 *    qué expresión regular lo contesta dLocal (`GET /v1/checkout/payment_method/
 *    {id}`), y este componente solo los traduce al español. Por eso no hay aquí
 *    ninguna regex ni ningún dígito verificador, ni hace falta
 *    `payout_country_rules` — que es del payout y va indexada por un tipo de
 *    documento que el comprador no elige.
 *
 * 3. **NOSOTROS CONFIRMAMOS, POR NUESTRO SERVIDOR.** Con Stripe se llama a
 *    `checkout.confirm()` desde el navegador; aquí el `confirm` de dLocal se
 *    identifica con una cookie de su dominio —cookie de tercero, que Safari
 *    bloquea— así que va por `POST /api/pagos/confirmar-dlocal`. Esa ruta relee
 *    el `DP-…` de la base de datos: este componente NUNCA le manda una
 *    referencia de cobro.
 *
 * ⚠️ SIGUE SIENDO PCI-DSS SAQ A, igual que con Stripe. El campo de la tarjeta es
 * un iframe de dLocal montado por su SDK: el PAN no toca nuestro DOM ni nuestro
 * servidor. Lo único que sale de aquí es un token (`CV-…`). Dibujar nosotros los
 * campos metería el proyecto en SAQ D, y por eso aquí no hay —ni puede haber— un
 * `<input>` de tarjeta.
 *
 * 🔴 Y NUNCA UN FORMULARIO MUERTO. Si el SDK no carga, si los campos no se
 * pueden pedir o si dLocal dice que el transparente no está activo, se enseña el
 * error CON la salida a `redirectUrl` —el checkout alojado del mismo cobro— en
 * vez de dejar a alguien mirando un hueco con el horario corriendo.
 */

/** Un campo del pagador tal y como lo pide dLocal. Las regex son SUYAS. */
type CampoDelPagador = {
  nombre: string;
  tipo: string;
  /** ⚠️ La escribe dLocal (`GET /v1/checkout/payment_method/{id}`). */
  regex: string | null;
  opciones: { valor: string; etiqueta: string }[] | null;
};

type Preparado = {
  pais: string | null;
  campos: CampoDelPagador[];
};

type Fase =
  | { f: "preparando" }
  /** Ni SDK ni campos: se enseña el error y la salida al checkout alojado. */
  | { f: "roto"; mensaje: string }
  | { f: "listo"; preparado: Preparado };

/**
 * CÓMO SE LLAMA CADA CAMPO EN ESPAÑOL.
 *
 * Solo traduce; la lista de qué campos hay y qué formato tienen la manda dLocal.
 * Un campo que no esté aquí se pinta igualmente, con su nombre crudo: es feo,
 * pero un campo invisible que dLocal exige es un pago que falla sin que nadie
 * pueda arreglarlo desde la pantalla.
 */
const ETIQUETAS: Record<string, { label: string; ayuda?: string; autoComplete?: string }> = {
  clientFirstName: { label: "Nombre", autoComplete: "given-name" },
  clientLastName: { label: "Apellido", autoComplete: "family-name" },
  clientDocument: {
    label: "Número de documento",
    // ⚠️ NO dice «sin puntos ni guiones», y es medido: la regex de dLocal para
    // BR y CL ADMITE puntos y guiones (`^\d{3}.?\d{3}.?\d{3}-?\d{2}…` en BR,
    // `^\d{1,2}.?\d{3}.?\d{3}-?(\d|k|K)$` en CL). Una ayuda que contradice a la
    // validación es peor que no tener ayuda.
    ayuda: "Tal y como figura en tu documento de identidad.",
  },
  clientDocumentType: { label: "Tipo de documento" },
};

/**
 * Campos que NO se le preguntan a la persona.
 *
 * `clientEmail` lo pone el servidor con el correo de la sesión, y
 * `clientDocumentCountry` con el país del cobro — el mismo que ya decidió qué
 * pasarela cobra. Preguntar dos veces algo que ya sabemos es la clase de campo
 * que hace abandonar un pago.
 */
const DEL_SERVIDOR = new Set(["clientEmail", "clientDocumentCountry"]);

/** El mínimo del SDK de dLocal que se usa aquí, tipado a mano (no hay `@types`). */
type CampoDeTarjeta = {
  mount: (el: HTMLElement) => void;
  unmount?: () => void;
  addEventListener: (evento: string, cb: (e: { error?: { message?: string } }) => void) => void;
};
type SdkDeDlocal = {
  fields: (opciones: { locale: string; country: string }) => {
    create: (
      tipo: "card",
      opciones: { classes?: Record<string, string>; style?: Record<string, unknown> },
    ) => CampoDeTarjeta;
  };
  createToken: (campo: CampoDeTarjeta, datos: { name: string }) => Promise<{ token: string }>;
  getBinInformation: (
    campo: CampoDeTarjeta,
  ) => Promise<{ brand: string; type: string; bin: string }>;
};

/**
 * Carga un `<script>` clásico UNA vez y resuelve en su `onload`.
 *
 * ⚠️ HAY QUE ESPERAR EL `onload`, no basta con insertar la etiqueta: `window
 * .dlocal` no existe hasta que el script acaba, y llamarlo antes es un
 * `TypeError` en la pantalla de pago. Se cachea por URL porque los tres puntos de
 * montaje pueden convivir en la misma navegación de cliente.
 */
const cargados = new Map<string, Promise<void>>();

function cargarScript(src: string): Promise<void> {
  const previo = cargados.get(src);
  if (previo) return previo;

  const promesa = new Promise<void>((resolver, rechazar) => {
    const ya = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (ya?.dataset.listo === "1") {
      resolver();
      return;
    }
    const el = ya ?? document.createElement("script");
    el.addEventListener("load", () => {
      el.dataset.listo = "1";
      resolver();
    });
    el.addEventListener("error", () => rechazar(new Error(`no cargó ${src}`)));
    if (!ya) {
      el.src = src;
      el.async = true;
      document.head.appendChild(el);
    }
  });
  cargados.set(src, promesa);
  // Un fallo no se cachea: recargar la pantalla tiene que poder reintentarlo.
  promesa.catch(() => cargados.delete(src));
  return promesa;
}

/**
 * DE DÓNDE SALEN LOS DOS SCRIPTS, Y POR QUÉ EL SEGUNDO ES OPCIONAL.
 *
 *   1. **El SDK de campos** (`js-sandbox.dlocal.com` → `js.dlocal.com` en vivo).
 *      Define `window.dlocal` y es el que monta el iframe de la tarjeta. Sin él
 *      no hay formulario: su fallo es `roto`.
 *   2. **El recolector antifraude** (`static-sandbox.dlocal.com/js/collector/
 *      direct.js`). Define `window.dlocalCollector` y devuelve el `deviceId` que
 *      el `confirm` acepta. Es el segundo script que carga el propio checkout de
 *      dLocal.
 *
 * ⚠️ EL SEGUNDO ES «MEJOR ESFUERZO» A PROPÓSITO, y está medido: el `confirm`
 * acepta `deviceId: ""` (probado contra el sandbox). Así que si no carga —un
 * bloqueador, una red que lo corta— se paga igual, con más probabilidad de que el
 * banco rechace. Al revés —hacerlo obligatorio— un bloqueador de rastreadores
 * dejaría a alguien sin poder pagar.
 *
 * ⚠️ Y ES UN TERCERO MÁS EN LA PANTALLA DE PAGO. El propio recolector inyecta los
 * servicios que su configuración le diga. El dictado §6 ya avisa de que con el
 * transparente la página carga terceros de dLocal y que `/cookies` y `/privacy`
 * quedan desactualizados; esto es exactamente eso, y es del cliente decidirlo.
 */
function urlDelSdk(esProduccion: boolean): string {
  return esProduccion ? "https://js.dlocal.com" : "https://js-sandbox.dlocal.com";
}
function urlDelRecolector(esProduccion: boolean): string {
  return esProduccion
    ? "https://static.dlocal.com/js/collector/direct.js"
    : "https://static-sandbox.dlocal.com/js/collector/direct.js";
}

/**
 * ⚠️ EL AMBIENTE SE DEDUCE DE LA CLAVE, no de una variable de entorno del
 * navegador. Las dos claves de plataforma de dLocal Go son constantes conocidas
 * (están en su propio SDK), y la de sandbox emparejada con el host de producción
 * da un token que el otro ambiente no reconoce. Quien decide el ambiente sigue
 * siendo el servidor: `DLOCALGO_API_BASE`, que es lo que eligió esta clave.
 */
const CLAVE_SANDBOX = "9dffb0de-42f0-4115-9fa7-2615c2fb5c88";

export function DlocalEmbed({
  sujeto,
  publicKey,
  redirectUrl,
  returnUrl,
}: DlocalTransparente & {
  /** Qué se está cobrando. Es lo ÚNICO que el servidor acepta para identificarlo. */
  sujeto: { tipo: "booking" | "order"; id: string };
  /** A dónde ir cuando el cobro se empuja sin 3DS. La confirmación de SU compra. */
  returnUrl: string;
}) {
  const uid = useId();
  const idCampo = (base: string) => `${base}-${uid}`;

  const [fase, setFase] = useState<Fase>({ f: "preparando" });
  const [valores, setValores] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  /** El error del propio campo de tarjeta, que lo escribe dLocal. */
  const [errorTarjeta, setErrorTarjeta] = useState<string | null>(null);
  /** El que no cuelga de ningún campo (la pasarela, la red, el banco). */
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  /** Salida al checkout alojado que el servidor puede cambiar (D-3, 929). */
  const [urlDeRespaldo, setUrlDeRespaldo] = useState(redirectUrl);

  const contenedor = useRef<HTMLDivElement | null>(null);
  const sdk = useRef<SdkDeDlocal | null>(null);
  const campoTarjeta = useRef<CampoDeTarjeta | null>(null);
  const deviceId = useRef<string>("");
  /** Qué cobro se preparó ya: con la clave dentro, StrictMode no monta dos veces. */
  const preparadoPara = useRef<string | null>(null);

  const consulta =
    sujeto.tipo === "order" ? `orderId=${sujeto.id}` : `bookingId=${sujeto.id}`;

  // ── 1 · pedir los campos y arrancar el SDK ────────────────────────────────
  useEffect(() => {
    const clave = `${sujeto.tipo}:${sujeto.id}`;
    if (preparadoPara.current === clave) return;
    preparadoPara.current = clave;

    let vivo = true;
    const esProduccion = publicKey !== CLAVE_SANDBOX;

    async function preparar() {
      // Los campos ANTES del SDK: sin `pais` no se pueden crear (`fields({country})`).
      const res = await fetch(`/api/pagos/confirmar-dlocal?${consulta}`, {
        headers: { Accept: "application/json" },
      });
      const salida = (await res.json().catch(() => ({}))) as {
        estado?: string;
        pais?: string | null;
        campos?: CampoDelPagador[];
        redirectUrl?: string | null;
        error?: string;
      };
      if (!vivo) return;

      if (salida.redirectUrl) setUrlDeRespaldo(salida.redirectUrl);

      // El servidor dice que este cobro no se puede montar aquí (la cuenta no
      // tiene el transparente, o el país no tiene tarjeta). No es un error del
      // alumno: se le lleva a la pasarela sin enseñarle nada roto.
      if (salida.estado === "no-transparente" || salida.estado === "sin-tarjeta") {
        irAPagar(salida.redirectUrl ?? redirectUrl);
        return;
      }
      if (!res.ok || salida.estado !== "listo" || !salida.pais || !salida.campos) {
        setFase({
          f: "roto",
          mensaje: salida.error ?? "No se pudo preparar el formulario de pago.",
        });
        return;
      }

      // El SDK de campos: obligatorio. El recolector: mejor esfuerzo.
      await cargarScript(urlDelSdk(esProduccion));
      if (!vivo) return;

      void cargarScript(urlDelRecolector(esProduccion))
        .then(async () => {
          const colector = (
            window as unknown as {
              dlocalCollector?: { create: (o: { ENV: string; apiKey: string }) => Promise<string> };
            }
          ).dlocalCollector;
          if (!colector) return;
          const id = await colector.create({
            ENV: esProduccion ? "production" : "sandbox",
            apiKey: publicKey,
          });
          if (vivo && typeof id === "string") deviceId.current = id;
        })
        .catch(() => {
          // Sin huella se cobra igual. No se dice nada: no es asunto de quien paga.
        });

      const fabrica = (window as unknown as { dlocal?: (k: string) => SdkDeDlocal }).dlocal;
      if (!fabrica) throw new Error("el SDK de dLocal no definió window.dlocal");
      sdk.current = fabrica(publicKey);

      setValores((previos) => {
        const iniciales = { ...previos };
        for (const c of salida.campos!) {
          if (iniciales[c.nombre] !== undefined) continue;
          // Un desplegable con UNA sola opción no se pregunta: se rellena.
          // ⚠️ Y eso hoy solo pasa en ECUADOR (`CI`), medido: AR, BR, CL y MX
          // ofrecen dos o tres tipos de documento, así que allí el comprador ve
          // CUATRO campos y no los tres que promete el dictado §2.
          iniciales[c.nombre] =
            c.opciones?.length === 1 ? c.opciones[0]!.valor : "";
        }
        return iniciales;
      });
      setFase({ f: "listo", preparado: { pais: salida.pais, campos: salida.campos } });
    }

    void preparar().catch((e) => {
      if (!vivo) return;
      console.error("[dlocal-embed] no se pudo preparar el formulario:", e);
      setFase({
        f: "roto",
        mensaje: "No se pudo cargar el formulario de pago.",
      });
    });

    return () => {
      vivo = false;
    };
  }, [consulta, publicKey, redirectUrl, sujeto.id, sujeto.tipo]);

  // ── 2 · montar el iframe de la tarjeta cuando el hueco existe ─────────────
  useEffect(() => {
    if (fase.f !== "listo" || !contenedor.current || campoTarjeta.current) return;
    const instancia = sdk.current;
    const pais = fase.preparado.pais;
    if (!instancia || !pais) return;

    // ⚠️ EL MONTAJE VA EN UNA MICROTAREA, y no es un adorno: montar el iframe
    // puede lanzar, y avisar del fallo con `setFase` DENTRO del cuerpo síncrono
    // del efecto es lo que prohíbe `react-hooks/set-state-in-effect` — un
    // `setState` síncrono en un efecto encadena un render de más y, en el peor
    // caso, un bucle. Diferirlo lo convierte en el mismo camino asíncrono que ya
    // usa el efecto de arriba para su `.catch()`.
    //
    // `cancelado` evita el aviso de «setState en un componente desmontado»
    // cuando el alumno se va de la pantalla mientras el iframe está montando.
    let cancelado = false;
    void Promise.resolve().then(() => {
      if (cancelado || !contenedor.current) return;
      try {
        // ⚠️ UN SOLO CAMPO `card`, NO `pan` / `expiration` / `cvv` POR SEPARADO.
        // Probado: por separado la tokenización falla. El iframe pinta los tres
        // huecos dentro de una sola caja.
        const campos = instancia.fields({ locale: "es", country: pais });
        // `style: { base: {} }` con el objeto vacío dentro, exactamente como lo
        // llama su propio SDK: probado, y es lo que evita que el iframe arranque
        // con la tipografía por defecto de dLocal en vez de heredar la caja.
        const campo = campos.create("card", {
          classes: { base: "ey-dlocal-card" },
          style: { base: {} },
        });
        campo.addEventListener("change", (e) => {
          setErrorTarjeta(e.error?.message ?? null);
        });
        campo.mount(contenedor.current);
        campoTarjeta.current = campo;
      } catch (e) {
        console.error("[dlocal-embed] no se pudo montar el campo de tarjeta:", e);
        setFase({ f: "roto", mensaje: "No se pudo cargar el formulario de pago." });
      }
    });

    return () => {
      cancelado = true;
    };
  }, [fase]);

  // El iframe se desmonta al salir de la pantalla; si no, queda un hueco muerto
  // cuando React reutiliza el contenedor.
  useEffect(
    () => () => {
      campoTarjeta.current?.unmount?.();
      campoTarjeta.current = null;
    },
    [],
  );

  const escribir = useCallback((nombre: string, valor: string) => {
    setValores((p) => ({ ...p, [nombre]: valor }));
    setErrores((p) => (p[nombre] ? { ...p, [nombre]: "" } : p));
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando || fase.f !== "listo") return;

    setErrorGeneral(null);

    // ── validación, CON LAS REGLAS DE dLOCAL ────────────────────────────────
    // ⚠️ NI UNA REGEX NUESTRA, y tampoco un dígito verificador: la expresión de
    // cada campo viene de `GET /v1/checkout/payment_method/{id}`. Inventarla
    // rechazaría documentos buenos —el mismo error que la tabla de payouts
    // documenta— y quien valida de verdad es el `confirm`.
    const fallos: Record<string, string> = {};
    for (const c of fase.preparado.campos) {
      if (DEL_SERVIDOR.has(c.nombre)) continue;
      const valor = (valores[c.nombre] ?? "").trim();
      if (!valor) {
        fallos[c.nombre] = "Completa este dato para poder pagar.";
        continue;
      }
      if (c.regex) {
        let cuadra = true;
        try {
          cuadra = new RegExp(c.regex).test(valor);
        } catch {
          // Una regex de dLocal que este navegador no sabe compilar no puede
          // frenar un pago: se deja pasar y que valide el `confirm`.
          cuadra = true;
        }
        if (!cuadra) {
          fallos[c.nombre] =
            c.nombre === "clientDocument"
              ? "Ese número no tiene el formato que pide tu país. Revísalo."
              : "Revisa este dato: no tiene el formato que pide la pasarela.";
        }
      }
    }
    setErrores(fallos);
    if (Object.keys(fallos).length > 0) {
      // 3.3.1 · el foco al primer campo con error, para que un lector de
      // pantalla lo anuncie sin tener que recorrer el formulario entero.
      const primero = fase.preparado.campos.find((c) => fallos[c.nombre]);
      if (primero) document.getElementById(idCampo(primero.nombre))?.focus();
      return;
    }

    const campo = campoTarjeta.current;
    const instancia = sdk.current;
    if (!campo || !instancia) {
      setErrorGeneral("El formulario de la tarjeta no está listo. Vuelve a cargar la pantalla.");
      return;
    }

    setEnviando(true);
    try {
      // El nombre del titular tal como lo exige el SDK: nombre y apellido juntos.
      const titular = [valores.clientFirstName, valores.clientLastName]
        .map((v) => (v ?? "").trim())
        .filter(Boolean)
        .join(" ");

      const { token } = await instancia.createToken(campo, { name: titular });
      // La marca y el tipo salen del BIN, no de un desplegable: es lo que el
      // servidor necesita para el `prepare-confirm`, y sin él el `confirm`
      // devuelve 406.
      const bin = await instancia.getBinInformation(campo).catch(() => null);

      const res = await fetch("/api/pagos/confirmar-dlocal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sujeto.tipo === "order" ? { orderId: sujeto.id } : { bookingId: sujeto.id }),
          paymentToken: token,
          brand: bin?.brand ?? "",
          type: bin?.type ?? "CREDIT",
          deviceId: deviceId.current,
          // Solo los campos del pagador. Ni importe, ni referencia del cobro.
          ...Object.fromEntries(
            fase.preparado.campos
              .filter((c) => !DEL_SERVIDOR.has(c.nombre))
              .map((c) => [c.nombre, (valores[c.nombre] ?? "").trim()]),
          ),
        }),
      });
      const salida = (await res.json().catch(() => ({}))) as {
        estado?: string;
        error?: string;
        campo?: string;
        redirectUrl?: string;
      };

      if (salida.redirectUrl && (salida.estado === "3ds" || res.ok)) {
        // El 3DS del banco emisor: la única salida del sitio que el dictado
        // acepta, porque la impone su banco. Vuelve a nuestra confirmación.
        irAPagar(salida.redirectUrl);
        return;
      }

      if (res.ok) {
        // Empujado. NO se dice «pagado»: acredita el webhook. La pantalla de
        // confirmación lee la reserva y cuenta la verdad.
        window.location.assign(returnUrl);
        return;
      }

      /**
       * 🔴 SU CHECKOUT ALOJADO ES LA SALIDA, Y SE USA AUNQUE dLocal NO NOS
       * DEVUELVA LA URL.
       *
       * Aquí se exigía `salida.redirectUrl`. Cuando el servidor no consigue
       * releer el cobro para sacarla (`recuperarPago` falla), devuelve el mismo
       * mensaje —«No podemos cobrar aquí mismo. Te llevamos a la pasarela para
       * terminar.»— con `redirectUrl` a `undefined`, así que esta rama no
       * entraba y el alumno leía que lo llevábamos a algún sitio mientras se
       * quedaba exactamente donde estaba, con el reloj del hold corriendo.
       *
       * `urlDeRespaldo` es la URL alojada que `interpretar()` EXIGE en la
       * respuesta del checkout, así que siempre hay destino.
       */
      if (salida.estado === "no-transparente") {
        irAPagar(salida.redirectUrl ?? urlDeRespaldo);
        return;
      }
      // Ya se cobró (el webhook llegó primero, u otra pestaña pagó).
      if (salida.estado === "ya-procesado") {
        window.location.assign(returnUrl);
        return;
      }

      // 3.3.1 · si dLocal dice QUÉ campo está mal (viene en su `causeMessage`),
      // el error se cuelga de ese campo y el foco se va allí. Un «revisa tus
      // datos» genérico en un formulario de pago es un abandono.
      const mensaje = salida.error ?? "No se pudo completar el pago.";
      const campoConError = salida.campo;
      /**
       * 🔴 SOLO SE CUELGA DEL CAMPO SI EL CAMPO ESTÁ EN PANTALLA.
       *
       * `salida.campo` sale de un `/Missing field:\s*(\w+)/` sobre el mensaje
       * de dLocal, y ese grupo puede ser cualquier cosa: `clientEmail`,
       * `country`, `deviceId`, `installments`… o `clientDocumentType`, que en
       * Ecuador NO se pinta porque tiene un solo valor y se rellena solo.
       *
       * Cuando el nombre no corresponde a ningún campo visible, `setErrores`
       * escribía en una clave que nadie renderiza y `errorGeneral` se quedaba a
       * null: el alumno pulsaba «Pagar», el botón se rehabilitaba y **no salía
       * ni un mensaje**. Silencio absoluto en una pantalla de pago.
       *
       * Y cuando el campo es de los que rellenamos NOSOTROS (`DEL_SERVIDOR`),
       * la culpa no es suya: decirle «revisa el formulario» es mandarlo a
       * corregir algo que no puede tocar.
       */
      const enPantalla =
        !!campoConError &&
        !DEL_SERVIDOR.has(campoConError) &&
        !!document.getElementById(idCampo(campoConError));

      if (enPantalla) {
        setErrores((p) => ({ ...p, [campoConError]: mensaje }));
        document.getElementById(idCampo(campoConError))?.focus();
      } else {
        if (campoConError) {
          console.error("[dlocal-embed] dLocal señala un campo que no está en pantalla:", {
            campo: campoConError,
            mensaje,
          });
        }
        setErrorGeneral(
          campoConError
            ? "No pudimos completar el pago con estos datos. Vuelve a intentarlo o paga en la pasarela."
            : mensaje,
        );
      }
    } catch (e) {
      // Lo que lanza aquí es casi siempre la tokenización: tarjeta incompleta,
      // BIN no aceptado. Su mensaje ya viene en el idioma del `locale`.
      const suyo = (e as { error?: { message?: string } })?.error?.message;
      if (suyo) {
        setErrorTarjeta(suyo);
      } else {
        console.error("[dlocal-embed] falló el envío del pago:", e);
        setErrorGeneral("No pudimos enviar tu pago. Prueba de nuevo en un momento.");
      }
    } finally {
      setEnviando(false);
    }
  }

  // El mismo tope de ancho que `StripeEmbed`, y por el mismo motivo: los tres
  // puntos de montaje dan contenedores de 560 a 900 px y un formulario de pago
  // estirado a 900 es «el diseño alargado» que MN-01 vino a quitar.
  return (
    <div className="mx-auto w-full max-w-[520px]">
      {/*
        LA CAJA DEL CAMPO DE TARJETA, Y LAS DOS REGLAS QUE NO SE PUEDEN QUITAR.

        `ey-dlocal-card` es el `classes.base` que se le pasa al SDK: dLocal lo
        pone en SU envoltorio (`#credit-card-wrapper`), que es hijo del `div` de
        abajo. O sea que el borde va aquí y no en nuestro contenedor.

        ⚠️ `width: 100%` + `box-sizing: border-box` SON OBLIGATORIOS, y está
        medido: sin ellos el envoltorio mide **0 px de ancho** y el campo se ve
        como una caja vacía —el iframe existe, pero con 0 de ancho—. Es lo que
        pasa cuando no se carga `dlocalgo.min.css`, que es su hoja de estilos y
        que aquí NO se carga a propósito (trae una fuente de Google, un botón
        rosa y una rejilla entera). Su propia clase `DirectoPagoField` declara
        exactamente estas dos, y de ahí salen.

        ⚠️ Y NADA DE `display: flex` en esta clase: dentro van número, MM/AA y CVV
        en una fila que monta el propio iframe, y un contenedor flexible los
        encoge a cero por el mismo camino.
      */}
      <style>{`
        .ey-dlocal-card {
          width: 100%;
          box-sizing: border-box;
          padding: 14px 12px;
          line-height: 18px;
          border-radius: 10px;
          border: 1px solid var(--input);
          background: transparent;
        }
        .ey-dlocal-card iframe { width: 100%; }
      `}</style>

      {fase.f === "preparando" ? (
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          Preparando el formulario de pago…
        </p>
      ) : null}

      {fase.f === "roto" ? (
        <div className="rounded-xl border border-dashed border-[#e0e0e0] p-5">
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {fase.mensaje}
          </p>
          {/* 🔴 NUNCA UN FORMULARIO MUERTO: la salida al checkout del mismo
              cobro. No es un enlace decorativo — es el cobro que ya existe. */}
          <button
            type="button"
            onClick={() => irAPagar(urlDeRespaldo)}
            className="mt-3 text-[13px] font-semibold text-brand hover:underline"
          >
            Pagar en la pasarela
          </button>
        </div>
      ) : null}

      {fase.f === "listo" ? (
        // `noValidate` por lo mismo que en `datos-invitado`: el globo del
        // navegador sale en el idioma del sistema y los lectores de pantalla no
        // lo anuncian de forma fiable. Los mensajes son nuestros y en español.
        <form onSubmit={onSubmit} noValidate aria-busy={enviando} className="flex flex-col gap-4">
          {/* Los datos del pagador van ANTES de la tarjeta: es el orden en el
              que se rellenan y el que deja el botón justo debajo del último
              campo (2.4.3). */}
          {fase.preparado.campos.map((c) => {
            if (DEL_SERVIDOR.has(c.nombre)) return null;
            // Un tipo de documento con una sola opción ya está resuelto: no se
            // pinta un desplegable de un elemento.
            if (c.opciones && c.opciones.length <= 1) return null;

            const meta = ETIQUETAS[c.nombre];
            const etiqueta = meta?.label ?? c.nombre;
            const error = errores[c.nombre] || undefined;
            const idError = idCampo(`${c.nombre}-error`);
            const idAyuda = idCampo(`${c.nombre}-ayuda`);

            return (
              <div key={c.nombre} className="grid gap-2">
                <Label htmlFor={idCampo(c.nombre)} className={AUTH_LABEL}>
                  {etiqueta}
                </Label>

                {c.opciones ? (
                  <select
                    id={idCampo(c.nombre)}
                    name={c.nombre}
                    value={valores[c.nombre] ?? ""}
                    disabled={enviando}
                    onChange={(ev) => escribir(c.nombre, ev.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy(error && idError)}
                    className={`${AUTH_FIELD} border border-input bg-transparent px-3 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive`}
                  >
                    <option value="">Elige…</option>
                    {c.opciones.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.etiqueta}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={idCampo(c.nombre)}
                    name={c.nombre}
                    type="text"
                    autoComplete={meta?.autoComplete}
                    value={valores[c.nombre] ?? ""}
                    disabled={enviando}
                    onChange={(ev) => escribir(c.nombre, ev.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy(meta?.ayuda && idAyuda, error && idError)}
                    className={AUTH_FIELD}
                  />
                )}

                {/* La regla se dice ANTES de fallar, como en `/signup`. */}
                {meta?.ayuda ? (
                  <p id={idAyuda} className="text-[13px] text-muted-foreground">
                    {meta.ayuda}
                  </p>
                ) : null}
                <FieldError id={idError} message={error} />
              </div>
            );
          })}

          <div className="grid gap-2">
            {/* ⚠️ NO ES UN `<label htmlFor>`: no hay `<input>` nuestro al que
                apuntar —los campos viven dentro del iframe de dLocal— y un
                `htmlFor` a un id que no existe es peor que ninguno. Va como
                texto con `id`, y el hueco lo referencia por `aria-labelledby`. */}
            <span id={idCampo("tarjeta-label")} className={AUTH_LABEL}>
              Tarjeta
            </span>
            <div
              ref={contenedor}
              // `group` para el lector de pantalla: dentro hay varios campos
              // (número, caducidad, CVV) que no son nuestros y no podemos
              // etiquetar uno a uno. Al menos se anuncia de qué es el grupo.
              role="group"
              aria-labelledby={idCampo("tarjeta-label")}
              aria-describedby={describedBy(
                idCampo("tarjeta-ayuda"),
                errorTarjeta && idCampo("tarjeta-error"),
              )}
            />
            <p id={idCampo("tarjeta-ayuda")} className="text-[13px] text-muted-foreground">
              Número, vencimiento y código de seguridad. Los procesa dLocal: no
              pasan por nuestros servidores.
            </p>
            <FieldError id={idCampo("tarjeta-error")} message={errorTarjeta} />
          </div>

          <FieldError id={idCampo("form-error")} message={errorGeneral} />

          {/* NUESTRO botón: dLocal no trae uno. */}
          <Button type="submit" disabled={enviando} className={AUTH_SUBMIT}>
            {enviando ? "Procesando tu pago…" : "Pagar"}
          </Button>

          {/* 4.1.2 · el estado del pago, anunciado sin robar el foco. El
              `aria-live` va en un contenedor que existe SIEMPRE: si el nodo
              aparece con el texto dentro, muchos lectores no lo anuncian. */}
          <p className="sr-only" aria-live="polite">
            {enviando ? "Procesando tu pago. No cierres esta pantalla." : ""}
          </p>

          <p className="text-[13px] text-muted-foreground">
            El pago lo procesa dLocal. Puede que tu banco te pida confirmarlo en
            su propia pantalla; al terminar te traemos de vuelta.
          </p>
        </form>
      ) : null}
    </div>
  );
}
