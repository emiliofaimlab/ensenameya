"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarCheckIcon,
  CalendarIcon,
  CalendarRangeIcon,
  ClockIcon,
  PackageIcon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { bookingTotal, serviceFee, SERVICE_FEE_PCT } from "@/lib/booking";
import { huecosDeFranja } from "@/lib/availability";
import { formatMoney, storageUrl } from "@/lib/catalog/format";
import { parseRequirements } from "@/lib/product-requirements";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/database.types";
import { PanelCard } from "@/components/layout/panel-shell";
import {
  AvailabilityBlocks,
  type AvailabilityRule,
  type AvailabilityScope,
} from "./availability-blocks";
import {
  CoverImagePicker,
  type SavedMaterial,
  type StagedFile,
} from "@/components/tutor/product-uploads";
import { PRODUCT_IMAGE_HINT } from "@/components/tutor/upload-formats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CARD_TITLE, FIELD, LABEL } from "./asistente/estilos";
import { ErrorCampo, OpcionTarjeta } from "./asistente/opcion-tarjeta";
import { PasoExtras } from "./asistente/paso-extras";
import { PasoRevisar, type BloqueResumen } from "./asistente/paso-revisar";
import { Stepper, type PasoId } from "./asistente/stepper";

type PricingModel = Database["public"]["Enums"]["pricing_model"];
type TeachingLevel = Database["public"]["Enums"]["teaching_level"];

// ponytail: MVP en una sola moneda (USD). Multi-moneda por geografía llega con
// C-13 / EP-07 (routing de cobro); cuando exista, sale de aquí a config del tutor.
const CURRENCY = "USD";

/**
 * Cada cuánto puede empezar una clase, en minutos. Es el «start time increment»
 * de Calendly, cuya documentación cita como ejemplo «every 10, 15, 30, 45, or
 * 60» sin cerrar la lista; aquí se cierra a propósito, porque un desplegable
 * corto se elige y un campo libre se rellena mal.
 *
 * El `check` de la columna (`20260831190000`) admite de 5 a 240: la BD sigue
 * siendo más ancha que este menú, así que ampliarlo mañana no pide migración.
 */
const INCREMENTOS = [10, 15, 20, 30, 45, 60, 90, 120] as const;

/** Los tres modelos de una mentoría individual, con su línea de explicación. */
const PRICING: {
  id: PricingModel;
  label: string;
  descripcion: string;
  icon: LucideIcon;
}[] = [
  {
    id: "per_session",
    label: "Por sesión",
    descripcion: "El alumno paga cada sesión por separado.",
    icon: CalendarCheckIcon,
  },
  {
    id: "per_package",
    label: "Paquete",
    descripcion: "Vendes varias sesiones juntas a un precio cerrado.",
    icon: PackageIcon,
  },
  {
    id: "per_hour",
    label: "Por hora",
    descripcion:
      "Pones un precio por hora y se cobra según lo que dure la sesión.",
    icon: ClockIcon,
  },
];

/** RG-03 · cupo de una grupal: el `check` de `products.capacity`. */
const CUPO_MIN = 2;
const CUPO_MAX = 10;
/**
 * RG-16 · fechas por ciclo. El tope de 20 viene del modelo viejo (el tutor
 * publicaba las fechas); hoy las elige el alumno en el selector, una a una.
 */
const MAX_FECHAS = 20;

/**
 * N-07 · topes de los campos de texto. El `maxLength` del input corta sin
 * avisar —el tutor escribe y las letras dejan de aparecer—, así que el número
 * sale del mismo sitio que el atributo y se escribe debajo del campo.
 */
const MAX_TITULO = 120;
const MAX_OUTCOME = 160;

/** Nombre corto (indicador) y título + explicación (cabecera) de cada paso. */
const PASOS_META: Record<
  PasoId,
  { corto: string; titulo: string; descripcion: string }
> = {
  tipo: {
    corto: "Tipo",
    titulo: "¿Individual o grupal?",
    descripcion: "Elige cómo vas a dar esta mentoría.",
  },
  formato: {
    corto: "Formato",
    titulo: "¿Cómo la vendes?",
    descripcion: "Define qué compra el alumno al reservar.",
  },
  contenido: {
    corto: "Contenido",
    titulo: "¿Qué vas a enseñar?",
    descripcion:
      "Es lo que el alumno lee en el catálogo antes de decidirse.",
  },
  precio: {
    corto: "Precio",
    titulo: "Precio y duración",
    descripcion: "Cuánto cuesta, cuánto dura y en qué horarios se ofrece.",
  },
  extras: {
    corto: "Extras",
    titulo: "Extras opcionales",
    descripcion:
      "Nada de este paso es obligatorio: puedes saltarlo y completarlo cuando quieras.",
  },
  revisar: {
    corto: "Revisar",
    titulo: "Revisa tu mentoría",
    descripcion: "Comprueba que todo está bien antes de guardar.",
  },
};

/** "las categorías y los materiales" — enumeración con «y» al final. */
function enumerar(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

/** P2 · «faltó el material» / «faltaron las categorías»: concuerda con lo que falta. */
function falto(items: string[]): string {
  return items.length > 1 || /^(las|los) /.test(items[0] ?? "")
    ? "faltaron"
    : "faltó";
}

/** DD-03 — mismas etiquetas que el filtro del Figma (386:1196). */
export const PRODUCT_LEVELS = [
  { value: "basico", label: "Básico" },
  { value: "intermedio", label: "Intermedio" },
  { value: "avanzado", label: "Avanzado" },
];

export const PRODUCT_LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
];

export type ProductFormValues = {
  id: string;
  title: string;
  description: string;
  outcome: string;
  pricingModel: PricingModel;
  priceAmount: number; // unidades menores
  sessionDurationMin: number | null;
  /**
   * Cada cuántos minutos puede EMPEZAR una clase. `null` = cada
   * `sessionDurationMin`, que es como se comportó todo hasta el 31-ago-2026 y
   * como se comporta toda mentoría que no lo toque.
   */
  startTimeIncrementMin: number | null;
  packageNumSessions: number | null;
  /** DD-03 — nivel e idioma de ESTA mentoría, no del tutor. */
  level: TeachingLevel | null;
  language: string | null;
  categoryIds: string[];
  imagePath: string | null;
  /** FAQ propias de la mentoría (R24-17). */
  faqs: { q: string; a: string }[];
  /**
   * Requerimientos de sesión: lo que el ALUMNO tiene que tener listo antes de
   * la clase. No confundir con los materiales (R24-16), que son los ficheros
   * que pone el TUTOR.
   */
  requirements: string[];
  /**
   * M-02 · `products.auto_accept_bookings` — si las reservas pagadas de ESTA
   * mentoría se confirman solas. No es una preferencia de estilo: decide si la
   * reserva pasa o no por `pending_acceptance`, y con ella la ventana de 24 h
   * de RN-38. Ver `acceptance-mode.tsx`.
   */
  autoAccept: boolean;
  /** G1 · RG-03/04: cupo máximo y mínimo opcional. Solo en grupales. */
  capacity: number | null;
  minSeats: number | null;
  /**
   * N-04 · franjas de disponibilidad a las que pertenece ESTA mentoría.
   * Lista vacía = «toda mi disponibilidad», que es literalmente lo que
   * significa no tener filas en `product_availability_rules`.
   */
  availabilityRuleIds: string[];
};

/**
 * Un error que devuelve la BD al guardar, ¿de qué paso es? Se mira el nombre
 * de la columna o del `check` en el mensaje (p. ej. `products_capacity_check`),
 * que es lo único estable que trae. Lo que no se reconoce se queda en
 * «Revisar», que es donde ya estaba el tutor.
 */
function pasoDelError(msg: string | undefined, pasos: PasoId[]): PasoId {
  const m = (msg ?? "").toLowerCase();
  const destino: PasoId =
    /package_num_sessions|pricing_model/.test(m)
      ? "formato"
      : /capacity|min_seats|price_amount|session_duration|start_time_increment/.test(
            m,
          )
        ? "precio"
        : /title|outcome|description|level|language|image_path/.test(m)
          ? "contenido"
          : /faqs|requirements|auto_accept/.test(m)
            ? "extras"
            : "revisar";
  return pasos.includes(destino) ? destino : "revisar";
}

/**
 * US-401 (SCR-TU04) — alta/edición de mentoría, como ASISTENTE PASO A PASO
 * (24-oct, petición de Emilio: el formulario de una sola tirada «no dan ganas
 * de crear»). Los pasos son Tipo (solo con grupales, RG-18) → Formato →
 * Contenido → Precio → Extras → Revisar.
 *
 * ⚠️ Es un rediseño de la UI y nada más: un solo `<form>`, un solo estado, y el
 * guardado de abajo es el de siempre —mismas tablas, mismas columnas, mismas
 * comprobaciones y mismos textos—. Lo único nuevo es CUÁNDO se comprueba: cada
 * paso valida lo suyo al pulsar «Siguiente» (`erroresDe`), y al guardar se
 * vuelven a pasar todos, por si en edición se saltó directo a «Revisar».
 *
 * Todos los campos son controlados (antes título, descripción, nivel… se
 * leían del `FormData`): un paso que no se pinta no está en el DOM, y lo
 * escrito tiene que sobrevivir a ir y volver.
 *
 * N-05/N-06 · portada y materiales se eligen aquí y suben al pulsar guardar.
 * No es una preferencia de estilo: en el ALTA todavía no hay `product_id` al
 * que colgar los archivos, así que o se difiere la subida o se obliga a
 * guardar y volver a entrar (que es justo lo que se reportó).
 *
 * N-04 · la mentoría elige a QUÉ franjas de la disponibilidad del tutor
 * pertenece. No son fechas propias del producto (eso no existe en el modelo),
 * sino un subconjunto del horario semanal del tutor.
 */
export function ProductForm({
  userId,
  categories,
  availabilityRules = [],
  product,
  materials = [],
  isApproved = false,
  onCreated,
  submitLabel,
  groupClassesEnabled = false,
}: {
  userId: string;
  categories: { id: string; name: string }[];
  /** N-04 · franjas semanales del tutor (US-501), para elegir entre ellas. */
  availabilityRules?: AvailabilityRule[];
  product?: ProductFormValues;
  /** Materiales YA guardados de esta oferta (R24-16); solo existen al editar. */
  materials?: SavedMaterial[];
  /** Habilita "Publicar" al guardar (RN-23: solo tutor aprobado). */
  isApproved?: boolean;
  /**
   * N-03 · Alta DESDE EL ASISTENTE de tutor (28-ago). El asistente tenía su
   * propio formulario reducido —`first-product-form.tsx`— y se quedó atrás:
   * "los vi y siento que en el onboarding está desactualizado" (le faltaban
   * portada, materiales, FAQ, nivel, idioma, horarios y el modo de aceptación).
   * Ya no hay dos: es este, y lo único que cambia al pasar esta prop es que al
   * CREAR no se navega a «Mis mentorías» —eso sacaba al tutor del asistente y,
   * dicho por la sesión de pruebas, no volvía—, sino que se avisa aquí y el
   * asistente sigue donde estaba.
   */
  onCreated?: (productId: string) => void;
  /** Texto del botón de guardar; por defecto, el del panel. */
  submitLabel?: string;
  /** G1 · RG-18: el admin le encendió las clases grupales a este tutor. */
  groupClassesEnabled?: boolean;
}) {
  const router = useRouter();
  const isEdit = !!product;
  const [loading, setLoading] = useState(false);
  const [pricingModel, setPricingModel] = useState<PricingModel>(
    product?.pricingModel ?? "per_session",
  );
  const [titulo, setTitulo] = useState(product?.title ?? "");
  const [outcome, setOutcome] = useState(product?.outcome ?? "");
  const [descripcion, setDescripcion] = useState(product?.description ?? "");
  const [nivel, setNivel] = useState<string>(product?.level ?? "");
  const [idioma, setIdioma] = useState(product?.language ?? "");
  const [paquete, setPaquete] = useState(
    String(product?.packageNumSessions ?? 4),
  );
  // Controlados también para poder decir en vivo lo que acabará pagando el alumno.
  const [precio, setPrecio] = useState(
    product ? String(product.priceAmount / 100) : "",
  );
  const [duracion, setDuracion] = useState(
    String(product?.sessionDurationMin ?? 60),
  );
  /**
   * El paso de la rejilla («las clases pueden empezar»). Controlado porque la
   * frase de ejemplo de debajo tiene que cambiar mientras se escribe: es la
   * única forma de que el tutor entienda qué está eligiendo antes de guardarlo.
   *
   * Cadena vacía = «cada duración», que en la BD es `NULL`. Se representa así y
   * no con un `null` en el estado porque el valor sale de un `<select>`, y el
   * valor de un `<select>` siempre es texto.
   */
  const [incremento, setIncremento] = useState(
    product?.startTimeIncrementMin ? String(product.startTimeIncrementMin) : "",
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(product?.categoryIds ?? []),
  );
  // El submit del form guarda; este flag decide si además publica (US-402).
  const [publishAfter, setPublishAfter] = useState(false);
  // FAQ de la mentoría (R24-17): lista editable, se guarda con el producto.
  const [faqs, setFaqs] = useState<{ q: string; a: string }[]>(
    product?.faqs ?? [],
  );
  // Requerimientos de sesión: misma mecánica que las FAQ —lista editable en
  // memoria que viaja en el mismo `row` del guardado—, pero de una sola línea
  // por fila: un requisito es una frase, no un par pregunta/respuesta.
  const [requirements, setRequirements] = useState<string[]>(
    product?.requirements ?? [],
  );
  // N-06: la portada dejó de viajar en el `FormData` y vive aquí. Sigue
  // valiendo la regla de antes — `null` significa "no eligió ninguna nueva",
  // y entonces al editar se conserva la que ya estaba.
  const [cover, setCover] = useState<File | null>(null);
  // N-05: los materiales elegidos esperan en memoria hasta el guardado. Los
  // que ya estaban en la BD se listan aparte porque se borran en el acto.
  const [savedMaterials, setSavedMaterials] =
    useState<SavedMaterial[]>(materials);
  const [stagedMaterials, setStagedMaterials] = useState<StagedFile[]>([]);
  // N-04 · el modo se DEDUCE de lo guardado porque en la BD no hay más que eso:
  // con enlaces, «solo estas franjas»; sin enlaces, «toda mi disponibilidad».
  // Así una mentoría anterior a N-04 abre en el modo que describe lo que hace
  // hoy, en vez de estrenarse en un modo que nadie eligió.
  const [scope, setScope] = useState<AvailabilityScope>(
    product?.availabilityRuleIds.length ? "blocks" : "all",
  );
  const [selectedRules, setSelectedRules] = useState<Set<string>>(
    new Set(product?.availabilityRuleIds ?? []),
  );
  // M-02 · el alta arranca en `true` PORQUE ESE ES EL DEFAULT DE LA COLUMNA
  // (`20260817180000`, petición literal del cliente). No es un descuido: si
  // aquí se pusiera `false`, una mentoría creada desde el formulario y otra
  // creada por SQL nacerían distintas, y además sería revertir por la puerta de
  // atrás una decisión que la migración defiende por escrito. Lo que se hace en
  // vez de cambiarlo es contarlo — ver el aviso de `AcceptanceMode`.
  const [autoAccept, setAutoAccept] = useState(product?.autoAccept ?? true);
  // G1 · clase grupal.
  const [cupo, setCupo] = useState(String(product?.capacity ?? 6));
  const [minimo, setMinimo] = useState(
    product?.minSeats ? String(product.minSeats) : "",
  );
  /**
   * RG-01 (24-oct) · la hora de una grupal ya no la publica el tutor: la elige
   * el primer alumno en el selector, como en una 1:1. Aquí solo queda cuántas
   * fechas tiene el ciclo (`package_num_sessions`, RG-16): una = clase suelta.
   * Y lo que el tutor edita es la PLANTILLA, que no tiene fechas ni inscritos:
   * las clases ya nacidas copiaron sus datos y no cambian por debajo (B6).
   *
   * «Una sola clase / ciclo» es una elección de la UI y no una columna: el
   * ciclo es `package_num_sessions > 1`. Va en su propio estado para que
   * vaciar el campo mientras se escribe («4» → «» → «12») no salte de tarjeta.
   */
  const [esCiclo, setEsCiclo] = useState(
    product?.pricingModel === "group" && (product.packageNumSessions ?? 1) > 1,
  );
  const [fechasCiclo, setFechasCiclo] = useState(
    String(
      product?.pricingModel === "group" ? (product.packageNumSessions ?? 1) : 4,
    ),
  );
  const grupal = pricingModel === "group";
  const fechasEfectivas = esCiclo ? fechasCiclo : "1";
  /** P24 · cuántas fechas cubre el precio. */
  const nFechas = Math.max(1, Math.floor(Number(fechasEfectivas) || 1));
  const totalCiclo = Math.round(Number(precio) * 100);

  // ── El asistente ───────────────────────────────────────────────────────
  // El paso «Tipo» solo existe con el interruptor de grupales (RG-18), o al
  // editar una grupal (para que se vea qué es, aunque no se pueda cambiar).
  const conTipo = groupClassesEnabled || product?.pricingModel === "group";
  const pasos: PasoId[] = [
    ...(conTipo ? (["tipo"] as const) : []),
    "formato",
    "contenido",
    "precio",
    "extras",
    "revisar",
  ];
  // En EDICIÓN se abre en «Revisar» y todo es navegable: la mentoría ya está
  // completa y lo normal es venir a cambiar una cosa.
  const [pasoActual, setPasoActual] = useState<PasoId>(
    isEdit ? "revisar" : pasos[0],
  );
  const [alcanzado, setAlcanzado] = useState(isEdit ? pasos.length - 1 : 0);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const idx = pasos.indexOf(pasoActual);
  const tituloPasoRef = useRef<HTMLHeadingElement>(null);
  // A dónde llevar el foco tras el siguiente render: el primer campo con error
  // o, si no hay, el título del paso. `foco` solo existe para disparar el efecto
  // también cuando el paso no cambia (error en el mismo paso).
  const focoPendiente = useRef<string | null>(null);
  const [foco, setFoco] = useState(0);

  useEffect(() => {
    if (foco === 0) return; // al montar no se roba el foco a nadie
    const id = focoPendiente.current;
    focoPendiente.current = null;
    const el = (id ? document.getElementById(id) : null) ?? tituloPasoRef.current;
    if (!el) return;
    // Al cambiar de paso se sube al FORMULARIO, no al título: con la cabecera
    // fija, alinear el título arriba dejaba el stepper tapado. `scroll-mt-24`
    // del <form> deja el hueco de la cabecera.
    if (id) el.scrollIntoView({ block: "center" });
    else el.closest("form")?.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }, [foco]);

  // `…/edit#horarios` es el destino del aviso ámbar «Sin franja de horario
  // asignada» de §2.3 (`page.tsx`). Con el asistente las franjas viven en el
  // paso «Precio», que no es el que se abre: sin esto el enlace dejaba al tutor
  // en «Revisar», sin el bloque que venía a arreglar.
  useEffect(() => {
    if (isEdit && !grupal && window.location.hash === "#horarios")
      irA("precio", "horarios");
    // Solo al montar: el hash es de la navegación que trajo aquí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function irA(p: PasoId, focoId?: string) {
    setPasoActual(p);
    setAlcanzado((a) => Math.max(a, pasos.indexOf(p)));
    focoPendiente.current = focoId ?? null;
    setFoco((n) => n + 1);
  }

  function limpiar(id: string) {
    setErrores((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /**
   * Lo que impide salir de un paso, por campo (la clave es el `id` del campo,
   * para poder llevarle el foco). Los textos son los de siempre, y los límites
   * los de los `check` de la BD: comprobarlos aquí es para dar un mensaje en
   * español en vez de un 23514 crudo, no para sustituir a la BD, que sigue
   * mandando.
   */
  function erroresDe(p: PasoId): Record<string, string> {
    const e: Record<string, string> = {};
    if (p === "formato") {
      // Paquete ≥ 1 sesión, solo per_package (RN-22).
      if (pricingModel === "per_package") {
        const n = Number(paquete);
        if (!Number.isInteger(n) || n < 1)
          e.package_num_sessions = "El paquete debe tener al menos 1 sesión.";
      }
      if (grupal) {
        const n = Number(fechasEfectivas);
        if (!Number.isInteger(n) || n < 1 || n > MAX_FECHAS)
          e.fechas_ciclo = `Una clase lleva entre 1 y ${MAX_FECHAS} fechas.`;
      }
    }
    if (p === "contenido") {
      if (!titulo.trim()) e.title = "Escribe un título.";
      if (selected.size === 0) e.categorias = "Elige al menos una categoría.";
    }
    if (p === "precio") {
      // Precio en unidades mayores (USD, 2 decimales). Vacío no es 0: antes lo
      // paraba el `required` del navegador, que el asistente ya no usa.
      const priceMajor = Number(precio);
      if (!precio.trim() || !Number.isFinite(priceMajor) || priceMajor < 0)
        e.price = "Indica un precio válido.";
      // Duración ≥ 30 min (RN-03).
      const duration = Number(duracion);
      if (!Number.isFinite(duration) || duration < 30)
        e.session_duration_min = "La duración mínima es 30 minutos.";
      // Paso de la rejilla. Vacío = null = «cada duración». Límites: el
      // `check` de `20260831190000`.
      if (!grupal && incremento.trim()) {
        const inc = Number(incremento);
        if (!Number.isInteger(inc) || inc < 5 || inc > 240)
          e.start_time_increment_min =
            "El intervalo debe estar entre 5 y 240 minutos.";
      }
      // G1 · cupo y mínimo de la grupal.
      if (grupal) {
        const capacity = Number(cupo);
        if (
          !Number.isInteger(capacity) ||
          capacity < CUPO_MIN ||
          capacity > CUPO_MAX
        )
          e.capacity = `El cupo va de ${CUPO_MIN} a ${CUPO_MAX} alumnos.`;
        else if (minimo.trim()) {
          const m = Number(minimo);
          if (!Number.isInteger(m) || m < 1 || m > capacity)
            e.min_seats = "El mínimo tiene que estar entre 1 y el cupo.";
        }
      }
      // N-04 · «solo estas franjas» con ninguna marcada no se puede guardar tal
      // cual: sin filas, la BD lo lee como «toda mi disponibilidad» y el tutor
      // se quedaría convencido de haber limitado la mentoría a nada. Se le pide
      // que elija, o que diga «toda» a propósito.
      if (!grupal && scope === "blocks" && selectedRules.size === 0)
        e.horarios =
          "Marca al menos una franja, o elige «Toda mi disponibilidad».";
    }
    return e;
  }

  /** Valida el paso actual; si pasa, avanza. Si no, foco al primer error. */
  function siguiente() {
    const e = erroresDe(pasoActual);
    setErrores(e);
    const primero = Object.keys(e)[0];
    if (primero) {
      focoPendiente.current = primero;
      setFoco((n) => n + 1);
      return;
    }
    if (idx < pasos.length - 1) irA(pasos[idx + 1]);
  }

  /**
   * Clic en el indicador. En edición, a cualquier paso. En el alta, hacia
   * atrás siempre; hacia delante solo a lo ya alcanzado, y validando los pasos
   * de en medio —si no, volver al 2, cambiar algo y saltar al 5 se saltaría
   * la comprobación del 2—.
   */
  function alPulsarPaso(p: PasoId) {
    const destino = pasos.indexOf(p);
    if (isEdit || destino <= idx) return irA(p);
    if (destino > alcanzado) return;
    for (let i = idx; i < destino; i++) {
      const e = erroresDe(pasos[i]);
      const primero = Object.keys(e)[0];
      if (primero) {
        setErrores(e);
        return irA(pasos[i], primero);
      }
    }
    irA(p);
  }

  function elegirTipo(g: boolean) {
    if (g) setPricingModel("group");
    else if (grupal) setPricingModel("per_session");
  }

  const coverUrl = storageUrl("product-images", product?.imagePath);

  const cobroPorSesion = bookingTotal({
    pricingModel,
    priceAmount: Math.round((Number(precio) || 0) * 100),
    sessionDurationMin: Number(duracion) || 60,
  });

  function toggleRule(id: string) {
    limpiar("horarios");
    setSelectedRules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCategory(id: string) {
    limpiar("categorias");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Un Enter dentro de un campo no guarda a medio asistente: avanza.
    if (pasoActual !== "revisar") return siguiente();

    // Se vuelven a pasar TODOS los pasos: en edición se puede llegar aquí sin
    // haber pulsado «Siguiente» en ninguno. El primero que falle se abre con
    // el foco en su campo.
    for (const p of pasos) {
      const errs = erroresDe(p);
      const primero = Object.keys(errs)[0];
      if (primero) {
        setErrores(errs);
        return irA(p, primero);
      }
    }

    const title = titulo.trim();
    const priceAmount = Math.round(Number(precio) * 100);
    const duration = Number(duracion);
    const increment = incremento.trim() ? Number(incremento) : null;
    const capacity = grupal ? Number(cupo) : null;
    const minSeats = grupal && minimo.trim() ? Number(minimo) : null;
    const fechasPorCiclo = grupal ? Number(fechasEfectivas) : null;
    const packageNum = pricingModel === "per_package" ? Number(paquete) : null;

    setLoading(true);
    const supabase = createClient();

    // ── Fase 1 · Storage ─────────────────────────────────────────────────
    // Todo lo que va a disco sube ANTES de tocar la BD, a propósito: si el
    // bucket falla no hay ningún producto a medias que explicar, y lo ya
    // subido se puede retirar. Al revés (producto primero) el fallo dejaría
    // una mentoría publicada prometiendo unos materiales que no existen.
    const subidos: string[] = []; // rutas en `tutor-materials`
    let nuevaPortada: string | null = null;

    /** Retira del bucket lo subido en este intento. Best-effort: si el borrado
     *  falla no hay nada mejor que hacer, el objeto queda huérfano pero no lo
     *  referencia ninguna fila y nadie lo ve. */
    async function retirar() {
      if (nuevaPortada)
        await supabase.storage.from("product-images").remove([nuevaPortada]);
      if (subidos.length)
        await supabase.storage.from("tutor-materials").remove(subidos);
    }

    // Imagen del producto (DD-02). Solo se sube si el tutor eligió una nueva;
    // al editar sin tocarla, se conserva la que ya estaba.
    let imagePath = product?.imagePath ?? null;
    if (cover) {
      const ext = cover.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // La RLS de Storage exige que el primer segmento sea el uid del tutor.
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, cover, { contentType: cover.type });
      if (error)
        return fail(
          "No se pudo subir la imagen de portada, así que no se guardó nada. Tus datos siguen en el formulario: vuelve a intentarlo.",
          "contenido",
        );
      nuevaPortada = path;
      imagePath = path;
    }

    // Materiales, uno a uno: Storage no tiene subida en lote. Si uno falla se
    // dice CUÁL y se deshace lo demás — dejarlo a medias sería peor, porque el
    // tutor no tendría forma de saber cuáles repetir.
    for (const { file } of stagedMaterials) {
      // Prefijo aleatorio: dos archivos con el mismo nombre no se pisan.
      const path = `${userId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage
        .from("tutor-materials")
        .upload(path, file, { contentType: file.type });
      if (error) {
        await retirar();
        return fail(
          `No se pudo subir «${file.name}», así que no se guardó nada${subidos.length ? ` (tampoco los ${subidos.length} archivos anteriores)` : ""}. Tus datos siguen en el formulario: vuelve a intentarlo.`,
          "extras",
        );
      }
      subidos.push(path);
    }

    // ── Fase 2 · Base de datos ───────────────────────────────────────────
    const row = {
      title,
      image_path: imagePath,
      description: descripcion.trim() || null,
      outcome: outcome.trim() || null,
      pricing_model: pricingModel,
      price_amount: priceAmount,
      currency: CURRENCY,
      session_duration_min: duration,
      // Viaja en el mismo `row` que todo lo demás: el column-grant de
      // `20260831190000` cubre insert Y update, así que el alta y la edición
      // escriben por el mismo camino. `null` explícito —y no omitir la clave—
      // para que volver a «cada duración» de verdad limpie la columna en vez de
      // dejar el valor anterior.
      start_time_increment_min: grupal ? null : increment,
      // RG-16 · en una grupal `package_num_sessions` es el número de fechas
      // del ciclo: el alumno que abre la clase elige esas N fechas.
      package_num_sessions: grupal ? fechasPorCiclo : packageNum,
      capacity,
      min_seats: minSeats,
      // DD-03: opcionales — vacío se guarda como nulo, que es lo que espera el
      // check, y las mentorías viejas siguen válidas sin el dato.
      level: (nivel || null) as TeachingLevel | null,
      language: idioma || null,
      // FAQ de ESTA mentoría (R24-17). Se descartan las filas a medio escribir.
      faqs: faqs
        .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
        .filter((f) => f.q && f.a),
      // Requerimientos: se guardan por el MISMO parseo con el que se leen, así
      // que una fila que el tutor añadió y dejó en blanco no llega a la BD y
      // tampoco reaparece al reabrir el formulario.
      requirements: parseRequirements(requirements),
      // M-02 · viaja en el mismo `row` que todo lo demás: el column-grant de
      // `20260817180000` cubre insert Y update, así que el alta y la edición
      // escriben por el mismo camino. Va explícito también en el insert —y no
      // se deja al default de la columna— para que lo guardado sea lo que el
      // tutor tenía en pantalla, incluso si algún día cambia ese default.
      // RG-07: una grupal se confirma sola siempre (`check` de products).
      auto_accept_bookings: grupal ? true : autoAccept,
      // `status` NO se toca en el insert: alta → 'draft' (default). Publicar es
      // un UPDATE aparte tras guardar; el guard RN-23 de BD sigue mandando.
    };

    // ponytail: catálogo, no dinero → escritura directa bajo RLS (regla 2 aplica a
    // payments/bookings). Producto, categorías y materiales son escrituras
    // separadas y no atómicas: no hay transacción de cliente. Mientras el
    // producto no exista se puede abortar limpio (se retira lo del bucket);
    // en cuanto existe, ya no — de ahí lo de abajo.
    let productId = product?.id ?? undefined;
    if (isEdit) {
      const { error } = await supabase
        .from("products")
        .update(row)
        .eq("id", productId!);
      if (error) {
        await retirar();
        return fail(error.message, pasoDelError(error.message, pasos));
      }
      // Reconciliar categorías: borrar todas y reinsertar las elegidas.
      await supabase
        .from("product_categories")
        .delete()
        .eq("product_id", productId!);
      // N-04 · mismo criterio con las franjas, y el borrado va SIEMPRE, también
      // al volver a «toda mi disponibilidad»: en ese modo lo correcto es cero
      // filas, así que el borrado no es la primera mitad de una reconciliación
      // sino la operación entera.
      await supabase
        .from("product_availability_rules")
        .delete()
        .eq("product_id", productId!);
    } else {
      const { data, error } = await supabase
        .from("products")
        .insert({ tutor_id: userId, ...row })
        .select("id")
        .single();
      if (error || !data) {
        await retirar();
        return fail(error?.message, pasoDelError(error?.message, pasos));
      }
      productId = data.id;
    }

    // A partir de aquí el producto EXISTE, así que ya no se aborta: cada fallo
    // se anota por su nombre y se cuenta al final. Un "no se pudo guardar" a
    // secas dejaba al tutor sin saber si repetir el alta entera o solo volver a
    // adjuntar — que es lo que N-05 pide evitar.
    const aMedias: string[] = [];

    // M19 · idempotente: un reintento sobre el mismo producto no choca con la
    // PK (product_id, category_id) ni avisa de un fallo que no existe.
    // `ignoreDuplicates` es ON CONFLICT DO NOTHING: basta el grant de insert.
    const { error: catErr } = await supabase.from("product_categories").upsert(
      [...selected].map((category_id) => ({
        product_id: productId!,
        category_id,
      })),
      { onConflict: "product_id,category_id", ignoreDuplicates: true },
    );
    if (catErr) aMedias.push("las categorías");

    // N-04 · las franjas elegidas. En modo «toda mi disponibilidad» no hay nada
    // que insertar: la ausencia de filas ES el dato.
    if (!grupal && scope === "blocks" && selectedRules.size > 0) {
      const { error: rulesErr } = await supabase
        .from("product_availability_rules")
        .insert(
          [...selectedRules].map((rule_id) => ({
            product_id: productId!,
            rule_id,
          })),
        );
      // Se nombra el efecto, no la tabla: si esto falla la mentoría queda «en
      // toda tu disponibilidad», que es lo que el tutor va a ver y lo que tiene
      // que poder corregir.
      if (rulesErr)
        aMedias.push("los horarios elegidos (queda en toda tu disponibilidad)");
    }

    if (subidos.length > 0) {
      // Las N filas en UN insert: Postgres lo resuelve en una transacción, así
      // que o quedan todas o ninguna. Con un insert por archivo podía quedar
      // "3 de 5 adjuntos" y ni el tutor ni nosotros sabríamos cuáles.
      const { error: matErr } = await supabase.from("tutor_materials").insert(
        subidos.map((storage_path, i) => ({
          tutor_id: userId,
          product_id: productId!,
          storage_path,
          file_name: stagedMaterials[i].file.name,
          size_bytes: stagedMaterials[i].file.size,
        })),
      );
      if (matErr) {
        // Los archivos están en el bucket pero no los referencia ninguna fila:
        // se retiran para que no cuenten en la cuota ni reaparezcan luego.
        await supabase.storage.from("tutor-materials").remove(subidos);
        aMedias.push(
          subidos.length === 1
            ? "el material adjunto"
            : `los ${subidos.length} materiales`,
        );
      } else {
        // Ya no están pendientes. La lista definitiva la trae el servidor en
        // el `router.refresh()` de más abajo, con los ids reales.
        setStagedMaterials([]);
      }
    }

    // RG-01 (24-oct) · una grupal se publica como cualquier mentoría: sin
    // fechas (las elige el primer alumno). `publicar_clase_grupal` se borró.
    if (publishAfter) {
      const { error: pubErr } = await supabase
        .from("products")
        .update({ status: "active" })
        .eq("id", productId!);
      // Guardado sí, publicado no (p. ej. el guard RN-23 de BD): se dice tal cual.
      if (pubErr) aMedias.push("la publicación (sigue como borrador)");
    }

    if (aMedias.length > 0) {
      // Se dice qué quedó guardado y qué no, y se abre la edición de ESTA
      // mentoría: lo que falta se remata ahí sin reescribir el formulario.
      // Dentro del asistente NO se abre nada: sacar al tutor a media alta es
      // justo lo que N-03 vino a arreglar, así que se le dice dónde rematarlo.
      toast.error(
        `La mentoría se guardó, pero ${falto(aMedias)} ${enumerar(aMedias)}. ${
          onCreated
            ? "Complétalo desde «Mis mentorías» cuando termines el registro."
            : "Complétalo desde aquí."
        }`,
        { duration: 12_000 },
      );
      if (onCreated) {
        // La mentoría EXISTE aunque falte algo: el asistente tiene que
        // enterarse igual, o su repaso seguiría diciendo que no hay ninguna.
        setLoading(false);
        onCreated(productId!);
        return;
      }
      router.push(`/tutor/products/${productId}/edit`);
      router.refresh();
      return;
    }

    toast.success(
      publishAfter
        ? "Mentoría publicada."
        : isEdit
          ? "Mentoría actualizada."
          : "Mentoría guardada como borrador.",
    );
    if (onCreated) {
      // `loading` sí se apaga aquí: en el panel el formulario se va con la
      // navegación y daba igual, pero en el asistente sigue montado.
      setLoading(false);
      onCreated(productId!);
      return;
    }
    router.push("/tutor/products");
    router.refresh();

    /** El aviso de siempre y, si se sabe de qué paso es el fallo, a ese paso. */
    function fail(msg?: string, paso?: PasoId) {
      toast.error(msg ?? "No se pudo guardar. Intenta de nuevo.");
      setLoading(false);
      if (paso && paso !== "revisar") irA(paso);
    }
  }

  /**
   * Quita un material YA guardado. Aquí no se difiere nada: el producto existe
   * y la fila es suya. Se borra primero la fila (es la que ve la ficha) y
   * después el objeto; si lo segundo falla queda un archivo huérfano en un
   * bucket privado, que es preferible a una fila apuntando a un archivo que ya
   * no está.
   */
  async function removeSavedMaterial(id: string) {
    const material = savedMaterials.find((m) => m.id === id);
    if (!material) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("tutor_materials")
      .delete()
      .eq("id", id);
    if (error) return toast.error("No se pudo quitar el material.");
    await supabase.storage
      .from("tutor-materials")
      .remove([material.storage_path]);
    setSavedMaterials((prev) => prev.filter((m) => m.id !== id));
  }

  /** Props de accesibilidad de un campo con posible error. */
  function invalido(id: string) {
    return errores[id]
      ? { "aria-invalid": true, "aria-describedby": `${id}-error` }
      : {};
  }

  // ── Resumen para «Revisar» ─────────────────────────────────────────────
  const sinDato = (t = "Sin especificar") => (
    <span className="text-[#8c8c8c]">{t}</span>
  );
  const faltaDato = (t: string) => (
    <span className="font-medium text-destructive">{t}</span>
  );
  const formatoTexto = grupal
    ? nFechas > 1
      ? `Ciclo de ${nFechas} fechas`
      : "Una sola clase"
    : pricingModel === "per_package"
      ? `Paquete de ${paquete || "?"} sesiones`
      : (PRICING.find((m) => m.id === pricingModel)?.label ?? pricingModel);
  const nMateriales = savedMaterials.length + stagedMaterials.length;
  const nRequisitos = parseRequirements(requirements).length;
  const nFaqs = faqs.filter((f) => f.q.trim() && f.a.trim()).length;
  const precioValido = precio.trim() !== "" && Number(precio) >= 0;

  const bloques: BloqueResumen[] = [
    {
      titulo: conTipo ? "Tipo y formato" : "Formato",
      paso: conTipo ? "tipo" : "formato",
      filas: [
        ...(conTipo
          ? [
              {
                etiqueta: "Tipo",
                valor: grupal ? "Clase grupal" : "Mentoría individual",
              },
            ]
          : []),
        { etiqueta: "Formato", valor: formatoTexto },
      ],
    },
    {
      titulo: "Contenido",
      paso: "contenido",
      filas: [
        {
          etiqueta: "Título",
          valor: titulo.trim() || faltaDato("Falta el título"),
        },
        { etiqueta: "Resultado", valor: outcome.trim() || sinDato("—") },
        {
          etiqueta: "Descripción",
          valor: descripcion.trim() ? (
            <span className="line-clamp-3 whitespace-pre-line">
              {descripcion.trim()}
            </span>
          ) : (
            sinDato("—")
          ),
        },
        {
          etiqueta: "Categorías",
          valor:
            selected.size > 0
              ? categories
                  .filter((c) => selected.has(c.id))
                  .map((c) => c.name)
                  .join(", ")
              : faltaDato("Elige al menos una"),
        },
        {
          etiqueta: "Nivel",
          valor:
            PRODUCT_LEVELS.find((l) => l.value === nivel)?.label ?? sinDato(),
        },
        {
          etiqueta: "Idioma",
          valor:
            PRODUCT_LANGUAGES.find((l) => l.value === idioma)?.label ??
            sinDato(),
        },
        {
          etiqueta: "Portada",
          valor: cover
            ? cover.name
            : product?.imagePath
              ? "La que ya tenía"
              : sinDato("Sin portada"),
        },
      ],
    },
    {
      titulo: "Precio y duración",
      paso: "precio",
      filas: [
        {
          etiqueta: grupal
            ? nFechas > 1
              ? "Precio del ciclo, por alumno"
              : "Precio por cupo"
            : pricingModel === "per_hour"
              ? "Precio por hora"
              : "Precio",
          valor: precioValido
            ? formatMoney(Math.round(Number(precio) * 100), CURRENCY)
            : faltaDato("Falta el precio"),
        },
        { etiqueta: "Duración", valor: `${duracion || "?"} min` },
        ...(grupal
          ? [
              { etiqueta: "Cupo máximo", valor: `${cupo || "?"} alumnos` },
              {
                etiqueta: "Cupo mínimo",
                valor: minimo.trim()
                  ? `${minimo} alumnos`
                  : sinDato("Sin mínimo"),
              },
            ]
          : [
              {
                etiqueta: "Las clases pueden empezar",
                valor: incremento
                  ? `Cada ${incremento} min`
                  : `Una detrás de otra (cada ${duracion || "?"} min)`,
              },
              {
                etiqueta: "Horarios",
                valor:
                  scope === "all"
                    ? "Toda tu disponibilidad"
                    : selectedRules.size > 0
                      ? `${selectedRules.size} ${selectedRules.size === 1 ? "franja elegida" : "franjas elegidas"}`
                      : faltaDato("Marca al menos una franja"),
              },
            ]),
      ],
    },
    {
      titulo: "Extras",
      paso: "extras",
      filas: [
        {
          etiqueta: "Materiales",
          valor:
            nMateriales > 0
              ? `${nMateriales} ${nMateriales === 1 ? "archivo" : "archivos"}`
              : sinDato("Ninguno"),
        },
        {
          etiqueta: "Requerimientos",
          valor: nRequisitos > 0 ? `${nRequisitos}` : sinDato("Ninguno"),
        },
        {
          etiqueta: "Preguntas frecuentes",
          valor:
            nFaqs > 0 ? `${nFaqs}` : sinDato("Ninguna (se muestran las generales)"),
        },
        {
          etiqueta: "Confirmación de reservas",
          valor: grupal
            ? "Se confirman solas (siempre, en una clase grupal)"
            : autoAccept
              ? "Se confirman solas"
              : "Las acepto yo, una a una",
        },
      ],
    },
  ];

  const meta = PASOS_META[pasoActual];
  const esRevisar = pasoActual === "revisar";

  return (
    <form onSubmit={onSubmit} noValidate className="flex scroll-mt-24 flex-col gap-5">
      <PanelCard className="py-4">
        <Stepper
          pasos={pasos.map((id) => ({ id, corto: PASOS_META[id].corto }))}
          actual={idx}
          alcanzado={alcanzado}
          libre={isEdit}
          onIr={alPulsarPaso}
        />
      </PanelCard>

      <header className="grid gap-1">
        {/* `tabIndex=-1`: al cambiar de paso el foco viene aquí, para que el
            lector de pantalla anuncie dónde se está y el teclado siga desde
            arriba del paso nuevo. */}
        <h2
          ref={tituloPasoRef}
          tabIndex={-1}
          className="scroll-mt-24 text-xl font-bold text-[#19191f] outline-none"
        >
          {pasoActual === "formato" && grupal
            ? "¿Una clase o un ciclo?"
            : esRevisar && isEdit
              ? "Revisa y guarda los cambios"
              : meta.titulo}
        </h2>
        <p className="text-[13px] text-[#6b6b6b]">{meta.descripcion}</p>
      </header>

      {/* ── 1 · Tipo ──────────────────────────────────────────────────── */}
      {pasoActual === "tipo" ? (
        <div className="grid gap-3">
          <div
            role="radiogroup"
            aria-label="Tipo de mentoría"
            className="grid gap-3 sm:grid-cols-2"
          >
            {/* Al editar no se cambia entre grupal y no grupal: los cupos
                vendidos no tienen equivalente 1:1 (y la BD lo prohíbe con
                clases nacidas). Se enseña la otra opción apagada, con el
                porqué debajo, en vez de esconderla. */}
            <OpcionTarjeta
              icon={UserIcon}
              titulo="Individual"
              descripcion="Tú y un alumno, en el horario que él elija de tu disponibilidad."
              selected={!grupal}
              onSelect={() => elegirTipo(false)}
              disabled={isEdit && product?.pricingModel === "group"}
            />
            <OpcionTarjeta
              icon={UsersIcon}
              titulo="Clase grupal"
              descripcion={`De ${CUPO_MIN} a ${CUPO_MAX} alumnos en la misma clase: el primero elige la hora y los demás se suman.`}
              selected={grupal}
              onSelect={() => elegirTipo(true)}
              disabled={isEdit && product?.pricingModel !== "group"}
            />
          </div>
          {isEdit ? (
            <p className="text-xs text-[#6b6b6b]">
              El tipo no se cambia al editar: lo vendido en una no tiene
              equivalente en la otra. Si quieres el otro tipo, crea una
              mentoría nueva.
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── 2 · Formato ───────────────────────────────────────────────── */}
      {pasoActual === "formato" ? (
        grupal ? (
          <div className="grid gap-4">
            <div
              role="radiogroup"
              aria-label="Formato de la clase grupal"
              className="grid gap-3 sm:grid-cols-2"
            >
              <OpcionTarjeta
                icon={CalendarIcon}
                titulo="Una sola clase"
                descripcion="Una fecha. Cada alumno paga esa clase."
                selected={!esCiclo}
                onSelect={() => {
                  setEsCiclo(false);
                  limpiar("fechas_ciclo");
                }}
              />
              <OpcionTarjeta
                icon={CalendarRangeIcon}
                titulo="Un ciclo de varias fechas"
                descripcion="El mismo grupo en varias fechas. Cada alumno paga el ciclo completo."
                selected={esCiclo}
                onSelect={() => {
                  setEsCiclo(true);
                  if (Number(fechasCiclo) < 2) setFechasCiclo("4");
                }}
              />
            </div>
            {esCiclo ? (
              <div className="grid gap-1.5 sm:max-w-xs">
                <Label htmlFor="fechas_ciclo" className={LABEL}>
                  Fechas por clase
                </Label>
                <Input
                  id="fechas_ciclo"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_FECHAS}
                  step={1}
                  required
                  value={fechasCiclo}
                  onChange={(e) => {
                    setFechasCiclo(e.target.value);
                    limpiar("fechas_ciclo");
                  }}
                  className={FIELD}
                  {...invalido("fechas_ciclo")}
                />
                <ErrorCampo id="fechas_ciclo" msg={errores.fechas_ciclo} />
              </div>
            ) : null}
            {/* RG-01 (24-oct) · el tutor ya no publica fechas: las elige el
                primer alumno en tu disponibilidad, como en una 1:1. */}
            <p className="text-xs text-[#6b6b6b]">
              No publicas fechas: el primer alumno elige la hora dentro de tu
              disponibilidad y los demás se suman a esa clase hasta llenar el
              cupo.
              {nFechas > 1
                ? ` Con ${nFechas} fechas es un ciclo: quien abre la clase elige las ${nFechas}, cada alumno paga el ciclo completo y solo puede darse de baja antes de la primera.`
                : ""}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div
              role="radiogroup"
              aria-label="Modelo de precio"
              className="grid gap-3 sm:grid-cols-3"
            >
              {PRICING.map((m) => (
                <OpcionTarjeta
                  key={m.id}
                  icon={m.icon}
                  titulo={m.label}
                  descripcion={m.descripcion}
                  selected={pricingModel === m.id}
                  onSelect={() => {
                    setPricingModel(m.id);
                    limpiar("package_num_sessions");
                  }}
                />
              ))}
            </div>
            {pricingModel === "per_package" ? (
              <div className="grid gap-1.5 sm:max-w-xs">
                <Label htmlFor="package_num_sessions" className={LABEL}>
                  Nº de sesiones del paquete
                </Label>
                <Input
                  id="package_num_sessions"
                  name="package_num_sessions"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  required
                  value={paquete}
                  onChange={(e) => {
                    setPaquete(e.target.value);
                    limpiar("package_num_sessions");
                  }}
                  className={FIELD}
                  {...invalido("package_num_sessions")}
                />
                <ErrorCampo
                  id="package_num_sessions"
                  msg={errores.package_num_sessions}
                />
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {/* ── 3 · Contenido ─────────────────────────────────────────────── */}
      {pasoActual === "contenido" ? (
        <PanelCard className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="title" className={LABEL}>
              Título
            </Label>
            <Input
              id="title"
              name="title"
              value={titulo}
              onChange={(e) => {
                setTitulo(e.target.value);
                limpiar("title");
              }}
              required
              maxLength={MAX_TITULO}
              placeholder="Ej: Inglés para entrevistas tech"
              className={FIELD}
              {...invalido("title")}
            />
            <ErrorCampo id="title" msg={errores.title} />
            <p className="text-xs text-[#6b6b6b]">
              Máx. {MAX_TITULO} caracteres.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="outcome" className={LABEL}>
              Resultado (outcome)
            </Label>
            <Input
              id="outcome"
              name="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              maxLength={MAX_OUTCOME}
              placeholder="Ej: apruebas tu entrevista técnica en inglés"
              className={FIELD}
            />
            <p className="text-xs text-[#6b6b6b]">
              Máx. {MAX_OUTCOME} caracteres. Es la línea que se lee bajo el
              título en el catálogo.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description" className={LABEL}>
              Descripción
            </Label>
            <Textarea
              id="description"
              name="description"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={4}
              placeholder="Explica la metodología y qué incluye la mentoría…"
              className="rounded-[8px] px-3.5 placeholder:text-[#8c8c8c]"
            />
          </div>

          {/* `tabIndex=-1` para poder llevarle el foco si falta elegir. */}
          <fieldset
            id="categorias"
            tabIndex={-1}
            className="grid gap-2 rounded-[8px] outline-none"
            {...(errores.categorias
              ? { "aria-describedby": "categorias-error" }
              : {})}
          >
            <legend className={LABEL}>Categorías (elige al menos 1)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {categories.map((c) => {
                const on = selected.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "inline-flex h-9 cursor-pointer items-center rounded-full border px-4 text-[13px] transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      on
                        ? "border-brand bg-brand font-semibold text-white"
                        : "border-[#e0e0e0] bg-card text-[#6b6b6b] hover:border-brand hover:text-brand",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      onChange={() => toggleCategory(c.id)}
                    />
                    {c.name}
                  </label>
                );
              })}
            </div>
            <ErrorCampo id="categorias" msg={errores.categorias} />
          </fieldset>

          {/* DD-03 — de la mentoría, no del tutor: un tutor avanzado puede
              publicar una clase básica. Alimentan los filtros de P05/P06. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="level" className={LABEL}>
                Nivel de la mentoría (opcional)
              </Label>
              <select
                id="level"
                name="level"
                value={nivel}
                onChange={(e) => setNivel(e.target.value)}
                className={`${FIELD} border bg-transparent`}
              >
                <option value="">Sin especificar</option>
                {PRODUCT_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="language" className={LABEL}>
                Idioma en que la impartes (opcional)
              </Label>
              <select
                id="language"
                name="language"
                value={idioma}
                onChange={(e) => setIdioma(e.target.value)}
                className={`${FIELD} border bg-transparent`}
              >
                <option value="">Sin especificar</option>
                {PRODUCT_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <p className={LABEL}>Imagen de portada (opcional)</p>
            <p className="text-xs text-[#6b6b6b]">
              Es la miniatura de la tarjeta en el catálogo. {PRODUCT_IMAGE_HINT}
              .
            </p>
            <CoverImagePicker
              currentUrl={coverUrl}
              file={cover}
              onPick={setCover}
              onClear={() => setCover(null)}
              disabled={loading}
            />
          </div>
        </PanelCard>
      ) : null}

      {/* ── 4 · Precio y duración ─────────────────────────────────────── */}
      {pasoActual === "precio" ? (
        <>
          <PanelCard className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="price" className={LABEL}>
                  {/* P24 · en un ciclo el precio es el de TODAS las fechas:
                      «por cupo» hacía creer al tutor que ponía el de cada una. */}
                  {grupal
                    ? nFechas > 1
                      ? "Precio del ciclo, por alumno"
                      : "Precio por cupo"
                    : pricingModel === "per_hour"
                      ? "Precio por hora"
                      : pricingModel === "per_package"
                        ? "Precio del paquete"
                        : "Precio"}
                </Label>
                <Input
                  id="price"
                  name="price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={precio}
                  onChange={(e) => {
                    setPrecio(e.target.value);
                    limpiar("price");
                  }}
                  placeholder="40"
                  className={FIELD}
                  {...invalido("price")}
                />
                <ErrorCampo id="price" msg={errores.price} />
                {/* Mismo patrón que el aviso de «por hora»: lo que paga el
                    alumno por el ciclo y a cuánto sale cada fecha, en vivo. */}
                {grupal && nFechas > 1 && Number(precio) > 0 ? (
                  <p className="text-xs text-[#6b6b6b]">
                    El alumno paga{" "}
                    <strong className="font-semibold text-[#333333]">
                      {formatMoney(totalCiclo, CURRENCY)}
                    </strong>{" "}
                    por las {nFechas} fechas (
                    {formatMoney(Math.round(totalCiclo / nFechas), CURRENCY)}{" "}
                    c/u).
                  </p>
                ) : null}
                {/* El cargo por servicio lo paga el ALUMNO encima del precio
                    (16-sep): `serviceFee` es la copia que solo pinta de
                    `cargo_por_servicio`, la misma que usa el checkout. Se dice
                    para que el tutor no lo descuente de su precio por su
                    cuenta. Con «por hora» y la duración a medio escribir, no. */}
                {cobroPorSesion > 0 &&
                (pricingModel !== "per_hour" || Number(duracion) >= 30) ? (
                  <p className="text-xs text-[#6b6b6b]">
                    Al pagar, el alumno suma un cargo por servicio del{" "}
                    {SERVICE_FEE_PCT} % (
                    {formatMoney(serviceFee(cobroPorSesion), CURRENCY)}
                    {pricingModel === "per_hour" ? " por sesión" : ""}); no sale
                    de tu precio.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1.5 self-start">
                <Label className={LABEL}>Moneda</Label>
                {/* USD fijo hasta C-13; se muestra, no se edita. */}
                <Input value={CURRENCY} disabled readOnly className={FIELD} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5 self-start">
                <Label htmlFor="session_duration_min" className={LABEL}>
                  Duración de la sesión (min)
                </Label>
                <Input
                  id="session_duration_min"
                  name="session_duration_min"
                  type="number"
                  inputMode="numeric"
                  min={30}
                  step={5}
                  required
                  value={duracion}
                  onChange={(e) => {
                    setDuracion(e.target.value);
                    limpiar("session_duration_min");
                  }}
                  className={FIELD}
                  {...invalido("session_duration_min")}
                />
                <ErrorCampo
                  id="session_duration_min"
                  msg={errores.session_duration_min}
                />
                {/* Con «por hora» el precio NO es lo que paga el alumno: el
                    servidor multiplica por la duración (RN-10,
                    `create_booking`). Sin decirlo aquí, el tutor pone 40 y 90
                    min y descubre el cobro de 60 cuando ya se ha hecho. Mismo
                    cálculo que el servidor: `bookingTotal`. Con el campo a
                    medio escribir (vacío, o un «9» suelto) la frase se leería
                    «cada sesión de min se cobra…». Callarse es mejor. */}
                {pricingModel === "per_hour" &&
                cobroPorSesion > 0 &&
                Number(duracion) >= 30 ? (
                  <p className="text-xs text-[#6b6b6b]">
                    Cada sesión de {duracion} min se cobra{" "}
                    <strong className="font-semibold text-[#333333]">
                      {formatMoney(cobroPorSesion, CURRENCY)}
                    </strong>
                    .
                  </p>
                ) : null}
              </div>

              {/*
                EL DIVISOR DE LA FRANJA — «cada cuánto puede empezar una clase».

                ⚠️ ES UN AJUSTE INDEPENDIENTE DE LA DURACIÓN, y ése es el punto
                entero. Hasta el 31-ago el paso ERA la duración: una clase de 60
                min solo podía empezar cada 60 min, así que una franja de 8:00 a
                17:00 daba 9 horarios y ni uno más. Con el paso separado, esa
                misma franja puede dar 18 horarios de 60 min empezando cada 30 —
                que es lo que hace Calendly y lo que pidió el cliente.

                Va al lado de la duración porque solo se entiende con ella
                delante, y la frase de debajo se recalcula en vivo: sin ella,
                «30» y «60» son dos números sin consecuencia visible.
              */}
              {grupal ? null : (
                <div className="grid gap-1.5 self-start">
                  <Label htmlFor="start_time_increment_min" className={LABEL}>
                    Las clases pueden empezar
                  </Label>
                  <select
                    id="start_time_increment_min"
                    name="start_time_increment_min"
                    value={incremento}
                    onChange={(e) => {
                      setIncremento(e.target.value);
                      limpiar("start_time_increment_min");
                    }}
                    className={`${FIELD} border bg-transparent`}
                    {...invalido("start_time_increment_min")}
                  >
                    {/* La opción vacía es `NULL` en la BD y es el
                        comportamiento de siempre. Se nombra con la duración a
                        la vista para que no haya que deducir qué significa
                        «cada duración». */}
                    <option value="">
                      Una detrás de otra
                      {Number(duracion) >= 30 ? ` (cada ${duracion} min)` : ""}
                    </option>
                    {INCREMENTOS.map((m) => (
                      <option key={m} value={m}>
                        Cada {m} min
                      </option>
                    ))}
                  </select>
                  <ErrorCampo
                    id="start_time_increment_min"
                    msg={errores.start_time_increment_min}
                  />
                  {/* La cuenta, con los números que el tutor tiene delante. Es
                      la misma aritmética que `get_available_slots` y que la
                      previsualización del panel de disponibilidad
                      (`huecosDeFranja`): un hueco solo cuenta si la clase cabe
                      ENTERA en la franja. Se calla con el campo a medio
                      escribir. */}
                  {Number(duracion) >= 30 ? (
                    <p className="text-xs text-[#6b6b6b]">
                      Una franja de 8:00 a 17:00 te daría{" "}
                      <strong className="font-semibold text-[#333333]">
                        {huecosDeFranja(
                          { start_time: "08:00", end_time: "17:00" },
                          Number(duracion),
                          incremento ? Number(incremento) : null,
                        )}{" "}
                        horarios
                      </strong>{" "}
                      de {duracion} min.
                      {incremento && Number(incremento) < Number(duracion)
                        ? " Se solapan entre sí: al reservarse uno, los que lo pisan desaparecen."
                        : ""}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </PanelCard>

          {grupal ? (
            <PanelCard
              id="cupo-y-fechas"
              className="flex scroll-mt-24 flex-col gap-4"
            >
              <h3 className={CARD_TITLE}>Cupo</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5 self-start">
                  <Label htmlFor="capacity" className={LABEL}>
                    Cupo máximo ({CUPO_MIN} a {CUPO_MAX} alumnos)
                  </Label>
                  <Input
                    id="capacity"
                    type="number"
                    inputMode="numeric"
                    min={CUPO_MIN}
                    max={CUPO_MAX}
                    step={1}
                    required
                    value={cupo}
                    onChange={(e) => {
                      setCupo(e.target.value);
                      limpiar("capacity");
                    }}
                    className={FIELD}
                    {...invalido("capacity")}
                  />
                  <ErrorCampo id="capacity" msg={errores.capacity} />
                </div>
                <div className="grid gap-1.5 self-start">
                  <Label htmlFor="min_seats" className={LABEL}>
                    Cupo mínimo (opcional)
                  </Label>
                  <Input
                    id="min_seats"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={Number(cupo) || CUPO_MAX}
                    step={1}
                    value={minimo}
                    onChange={(e) => {
                      setMinimo(e.target.value);
                      limpiar("min_seats");
                    }}
                    placeholder="Sin mínimo"
                    className={FIELD}
                    {...invalido("min_seats")}
                  />
                  <ErrorCampo id="min_seats" msg={errores.min_seats} />
                </div>
              </div>
              {minimo.trim() ? (
                <p className="text-xs text-[#6b6b6b]">
                  Si 24 horas antes de la primera fecha no hay ese mínimo de
                  inscritos, la clase se cancela sola y todos recuperan el 100
                  %; por eso con mínimo solo se abren clases a más de 48 horas.
                </p>
              ) : null}
            </PanelCard>
          ) : (
            /* N-04 · a qué franjas de tu disponibilidad pertenece esta
               mentoría. Va después del formato porque depende de la duración:
               las franjas se trocean en huecos del tamaño de la sesión.
               `id="horarios"` es el destino del aviso ámbar «Sin franja de
               horario asignada» de §2.3 (ver el efecto del hash, arriba).
               `scroll-mt-24` lo separa de la cabecera fija. */
            <PanelCard
              id="horarios"
              tabIndex={-1}
              className="flex scroll-mt-24 flex-col gap-3 outline-none"
              {...(errores.horarios
                ? { "aria-describedby": "horarios-error" }
                : {})}
            >
              <h3 className={CARD_TITLE}>Horarios de esta mentoría</h3>
              <p className="text-[13px] text-[#6b6b6b]">
                Tus horarios se definen una vez en{" "}
                <Link
                  href="/tutor/availability"
                  className="font-medium text-brand underline underline-offset-2"
                >
                  Disponibilidad
                </Link>
                . Aquí eliges cuáles usa esta mentoría.
              </p>
              <AvailabilityBlocks
                rules={availabilityRules}
                scope={scope}
                onScopeChange={(s) => {
                  setScope(s);
                  limpiar("horarios");
                }}
                selected={selectedRules}
                onToggle={toggleRule}
                disabled={loading}
              />
              <ErrorCampo id="horarios" msg={errores.horarios} />
            </PanelCard>
          )}
        </>
      ) : null}

      {/* ── 5 · Extras ────────────────────────────────────────────────── */}
      {pasoActual === "extras" ? (
        <PasoExtras
          grupal={grupal}
          loading={loading}
          savedMaterials={savedMaterials}
          stagedMaterials={stagedMaterials}
          setStagedMaterials={setStagedMaterials}
          onRemoveSavedMaterial={removeSavedMaterial}
          requirements={requirements}
          setRequirements={setRequirements}
          faqs={faqs}
          setFaqs={setFaqs}
          autoAccept={autoAccept}
          setAutoAccept={setAutoAccept}
        />
      ) : null}

      {/* ── 6 · Revisar ───────────────────────────────────────────────── */}
      {esRevisar ? (
        <PasoRevisar bloques={bloques} grupal={grupal} onEditar={irA} />
      ) : null}

      {/* Barra del asistente. En móvil se queda pegada abajo (`sticky` y no
          `fixed`: este formulario también vive dentro del asistente de alta
          de tutor, y una barra fija se le montaría encima a sus botones); en
          escritorio es una fila normal al final. `pe-[72px]`: en el panel
          siempre hay sesión y con ella la burbuja del chat abajo a la derecha,
          que tapaba «Publicar» (el mismo hueco que `barra-cta-movil.tsx`). */}
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t border-[#e0e0e0] bg-card/95 px-1 pe-[72px] pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {idx > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => irA(pasos[idx - 1])}
            disabled={loading}
            // En «Revisar» móvil sobra: cada bloque tiene su «Editar», y los
            // dos botones de guardar necesitan el ancho.
            className={cn(
              "h-[47px] rounded-[8px] px-4 font-medium",
              esRevisar && "hidden sm:inline-flex",
            )}
          >
            <ArrowLeftIcon aria-hidden />
            Atrás
          </Button>
        ) : null}

        <div className="ml-auto flex flex-1 justify-end gap-3 sm:flex-none">
          {/* ⚠️ LAS `key` NO SON DECORACIÓN. Sin ellas React REUTILIZA el
              botón «Revisar» como «Guardar borrador»: le cambia `type` a
              `submit` en mitad del mismo clic y el navegador remata ese clic
              enviando el formulario — llegar a «Revisar» guardaba la mentoría
              sin que el tutor la revisara (medido contra el build, 24-oct). */}
          {esRevisar ? (
            <>
              <Button
                key="guardar"
                type="submit"
                variant={isApproved ? "outline" : "default"}
                disabled={loading}
                onClick={() => setPublishAfter(false)}
                className="h-[47px] flex-1 rounded-[8px] px-5 font-medium sm:flex-none"
              >
                {loading && !publishAfter
                  ? "Guardando…"
                  : (submitLabel ??
                    (isEdit ? "Guardar cambios" : "Guardar borrador"))}
              </Button>
              {isApproved ? (
                <Button
                  key="publicar"
                  type="submit"
                  disabled={loading}
                  onClick={() => setPublishAfter(true)}
                  className="h-[47px] flex-1 rounded-[8px] px-6 font-semibold sm:flex-none"
                >
                  {loading && publishAfter ? "Publicando…" : "Publicar"}
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              key="siguiente"
              type="button"
              onClick={siguiente}
              className="h-[47px] flex-1 rounded-[8px] px-6 font-semibold sm:flex-none"
            >
              {pasos[idx + 1] === "revisar" ? "Revisar" : "Siguiente"}
              <ArrowRightIcon aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
