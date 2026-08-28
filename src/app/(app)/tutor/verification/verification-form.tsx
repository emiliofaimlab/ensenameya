"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckIcon,
  ChevronDownIcon,
  FileTextIcon,
  GraduationCapIcon,
  LinkIcon,
  UserRoundIcon,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  MAX_SOCIALS,
  SOCIAL_PLATFORMS,
  type SocialLink,
} from "@/lib/socials";
import { PanelCard, StatusPill, type PillTone } from "@/components/layout/panel-shell";
// El asistente vive en la otra dirección (importa este módulo), pero el hook de
// "guardar al salir" es suyo y no se duplica: ver `useSaveOnExit` allí.
import { useSaveOnExit } from "@/components/onboarding/wizard";
// MN-11a · El tope y los formatos del bucket `kyc-documents` no se escriben
// aquí: salen de la fuente única, que es también donde está apuntado qué hay
// que hacer en la BD si el número cambia (P-8).
import {
  KYC_HINT,
  KYC_MAX_BYTES,
  KYC_TYPES,
  fileProblem,
  maxLabel,
} from "@/components/tutor/upload-formats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Database } from "@/lib/database.types";

export type DocStatus = "pending" | "approved" | "rejected" | "draft";
export type IdentityStatus =
  Database["public"]["Enums"]["identity_verification_status"];

/**
 * El tope, ya escrito: «10 MB». Se repite en las seis filas y en dos frases
 * más de esta pantalla, y antes eran siete literales a mano — cambiar el
 * número dejaba a la mitad de la pantalla mintiendo (MN-11a).
 *
 * El formato SÍ se escribe por documento a propósito: es una recomendación de
 * qué mandar (una cédula escaneada, un PDF del título), no lo que el bucket
 * admite — que es siempre `KYC_TYPES`, y se dice entero abajo y en el resumen.
 */
const TOPE = maxLabel(KYC_MAX_BYTES);

/**
 * C-14 — set de tipos confirmado por el cliente (UX-203 / EY-100). Las redes ya
 * NO son un documento: viven en `tutor_profiles.socials` como lista (R29-02),
 * en la tarjeta de abajo.
 *
 * ⚠️ Desde el 28-ago esta lista NO se pinta entera. El cliente pidió lo
 * contrario de lo que había: «ya no vamos a listar todos los documentos… un
 * selector correspondiente a qué documento y que cargo, para no bloquear al
 * usuario que vea una lista tan larga de documentos y se salga». Así que
 * alimenta un desplegable, y lo que se ve debajo es solo lo que el tutor ya
 * tiene — mismo patrón que el portafolio: elegir plataforma + añadir.
 *
 * `requerido` marca los tres que la aprobación exige de verdad (CV, título y
 * documento de identidad). Se DESTACAN, no se imponen: ningún paso del
 * asistente bloquea (EX-02) y este tampoco.
 *
 * Ampliar o reordenar el set = tocar esta lista. La BD (`doc_type` es texto) y
 * la pantalla de revisión del admin son genéricas y no se enteran.
 */
const KYC_DOCS = [
  { type: "cv", label: "Currículum vitae", hint: `PDF, máx ${TOPE}`, requerido: true },
  { type: "degree", label: "Título académico", hint: `PDF, máx ${TOPE}`, requerido: true },
  { type: "id_document", label: "Documento de identidad", hint: `Cédula o pasaporte · PDF/JPG, máx ${TOPE}`, requerido: true },
  { type: "certificate", label: "Certificado", hint: `PDF, máx ${TOPE}`, requerido: false },
  { type: "diploma", label: "Diploma", hint: `PDF/JPG, máx ${TOPE}`, requerido: false },
  { type: "transcript", label: "Corte de notas (transcript)", hint: `PDF, máx ${TOPE}`, requerido: false },
] as const;

/** Los tres de arriba, ya filtrados: se nombran en dos sitios de la pantalla. */
const KYC_REQUERIDOS = KYC_DOCS.filter((d) => d.requerido);

/** "el CV, el título y la cédula" — enumeración en castellano, con «y» final. */
function enumerar(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

export type DocState = { status: DocStatus; linkUrl: string | null };

/**
 * Lo que el asistente recibe de vuelta al guardar su paso de repaso.
 *
 * Los contadores salen de aquí y no de las props del servidor porque entre
 * guardar y pulsar «Finalizar» el asistente no vuelve a pedir la página: su
 * pantalla de cierre leería los números de antes de subir nada y diría "no
 * subiste ningún documento" a quien acaba de subir seis.
 */
export type VerificationSaveResult = {
  ok: boolean;
  /** Documentos con archivo guardado (los de antes más los de esta llamada). */
  docs: number;
  /** Enlaces de redes o portafolio guardados. */
  socials: number;
};

export type VerificationSave = () => Promise<VerificationSaveResult>;

/** Píldoras del Figma (190:23/37/65/93): color por estado del documento. */
const DOC_PILL: Record<DocStatus | "none", { label: string; tone: PillTone }> = {
  approved: { label: "Aprobado", tone: "green" },
  pending: { label: "En revisión", tone: "blue" },
  rejected: { label: "Rechazado", tone: "red" },
  draft: { label: "Borrador", tone: "neutral" },
  none: { label: "Pendiente", tone: "neutral" },
};
/** Archivo elegido pero aún sin subir (vive solo en memoria hasta el botón). */
const STAGED_PILL = { label: "Sin guardar", tone: "amber" as PillTone };

/** Fila de documento del Figma (190:14): icono, nombre + hint, píldora, botón. */
function FileRow({
  label,
  hint,
  requerido,
  status,
  stagedName,
  onPick,
  onClear,
  disabled,
}: {
  label: string;
  hint: string;
  /** De los tres que pide la aprobación: se dice en la fila, no solo arriba. */
  requerido?: boolean;
  status?: DocStatus;
  stagedName?: string;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-seleccionar el mismo archivo
    if (!file) return;
    const problema = fileProblem(file, {
      types: KYC_TYPES,
      maxBytes: KYC_MAX_BYTES,
      hint: KYC_HINT,
    });
    if (problema) {
      toast.error(problema);
      return;
    }
    onPick(file); // solo lo dejamos listo; sube al pulsar un botón de abajo
  }

  const pill = stagedName ? STAGED_PILL : DOC_PILL[status ?? "none"];
  // Un archivo elegido esta sesión manda sobre el estado guardado (aún sin
  // subir). Sin archivo elegido, el botón depende del estado en la BD.
  const pickLabel = stagedName
    ? "Cambiar"
    : !status
      ? "Seleccionar"
      : status === "rejected"
        ? "Volver a subir"
        : "Reemplazar";
  const solid = !stagedName && status === "rejected";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-muted text-[#666666]">
          <FileTextIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-[#333333]">
            {label}
          </p>
          <p className="truncate text-xs text-[#6b6b6b]">
            {stagedName ?? hint}
            {requerido ? " · requerido para aprobar" : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={pill.tone}>
          {pill.label}
        </StatusPill>
        <input
          ref={inputRef}
          type="file"
          accept={KYC_TYPES.join(",")}
          className="hidden"
          onChange={onFile}
        />
        {stagedName ? (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={onClear}
            className="h-10 rounded-[8px] px-3 text-[13.5px] text-[#6b6b6b]"
          >
            Quitar
          </Button>
        ) : null}
        <Button
          variant={solid ? "default" : "outline"}
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={
            solid
              ? "h-10 rounded-[8px] bg-brand px-4 text-[13.5px] font-semibold hover:bg-brand/90"
              : "h-10 rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
          }
        >
          {pickLabel}
        </Button>
      </div>
    </div>
  );
}

/** Estado de un paso del checklist: `hecho` cuenta para el progreso. */
type StepState = { label: string; tone: PillTone; hecho: boolean };

/**
 * N-10 · Un paso del checklist: cabecera pulsable con icono, título, resumen y
 * píldora de estado, y el trabajo dentro. Acordeón propio y no `<details>`:
 * el `open` de `<details>` es DOM y React no lo controla del todo, y aquí hay
 * que poder abrir "el primero que falte" al entrar.
 */
function ChecklistStep({
  n,
  icon: Icon,
  title,
  summary,
  state,
  open,
  onToggle,
  children,
}: {
  n: number;
  icon: typeof FileTextIcon;
  title: string;
  summary: string;
  state: StepState;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const id = `verif-paso-${n}`;
  return (
    <PanelCard className="p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full flex-wrap items-center gap-3 p-5 text-left"
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full",
            state.hecho
              ? "bg-success-muted text-success"
              : "bg-muted text-[#666666]",
          )}
        >
          {state.hecho ? (
            <CheckIcon className="size-4.5" strokeWidth={3} />
          ) : (
            <Icon className="size-4.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-[#6b6b6b]">Paso {n}</span>
          <span className="block text-base font-semibold text-[#19191f]">
            {title}
          </span>
          <span className="block text-[12.5px] text-[#6b6b6b]">{summary}</span>
        </span>
        <StatusPill tone={state.tone}>
          {state.label}
        </StatusPill>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-[#6b6b6b] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div id={id} className="border-t border-[#e0e0e0] p-5">
          {children}
        </div>
      ) : null}
    </PanelCard>
  );
}

/**
 * TU02 — Verificación con subida DIFERIDA. Elegir un archivo solo lo deja listo
 * (en memoria); nada sube hasta pulsar un botón:
 *   · "Guardar borrador" → sube y guarda como `draft` (no llega al admin).
 *   · "Guardar y enviar a revisión" → sube y pasa TODO a `pending`.
 * Así el tutor completa su expediente poco a poco. Documentos y enlace de redes
 * comparten estado para que los dos botones actúen sobre todo a la vez.
 *
 * N-10 · Ya no es una lista plana que obligaba a saltar de pantalla en pantalla
 * para saber qué falta: son cuatro bloques plegables con estado propio. El estado
 * NO sale de un sitio, sale de tres —documentos, redes y nº de mentorías— más
 * la foto, y por eso vive aquí y no en la columna `identity_verification_status`
 * (que solo habla de los documentos).
 *
 * ⚠️ `'draft'` es trabajo guardado que deja la verificación en `not_submitted`.
 * El checklist distingue "empezado" de "enviado" a propósito: una píldora que
 * dijera "sin enviar" a secas para quien lleva seis documentos subidos le haría
 * volver a subirlos.
 *
 * ⚠️ Este módulo está COMPARTIDO entre `/tutor/verification` y el ÚLTIMO paso
 * del asistente (fue el 4, luego el 5 cuando EY-183 metió la disponibilidad
 * delante, y desde el 28-ago es el último porque el alta de mentoría se metió
 * aquí dentro): cualquier cambio de aquí se ve en las dos.
 *
 * ⚠️ …pero los DOS BOTONES de arriba son solo del panel (`inWizard === false`).
 * En el panel son la única acción de la pantalla y están bien; dentro del
 * asistente quedaban cuatro controles compitiendo —«Guardar borrador»,
 * «Guardar y enviar a revisión», «Atrás» y «Continuar»— sin que ninguno dijera
 * cuál avanzaba. Allí manda el paso: el módulo se guarda solo (`saveRef` y el
 * desmontaje), siempre como BORRADOR, y el envío a revisión es del final del
 * asistente. Ver `tutor-onboarding-form.tsx`.
 *
 * ⚠️ La DISPONIBILIDAD no entra en este checklist a propósito. Lo que se lista
 * aquí es lo que hace falta para APROBAR el perfil, y ninguna regla —ni de BD
 * ni de negocio— exige franjas para aprobar a un tutor. Sin ellas el perfil se
 * aprueba igual y lo que no ocurre es que alguien pueda reservar; ese aviso lo
 * da el paso 4 y la pantalla de cierre del asistente, no esta lista.
 */
export function VerificationForm({
  userId,
  docsByType,
  socials,
  identityStatus,
  hasAvatar,
  hasBio,
  productCount,
  inWizard = false,
  perfil,
  mentoria,
  saveRef,
}: {
  userId: string;
  docsByType: Record<string, DocState>;
  /** R29-02: portafolio y redes ya guardados (`tutor_profiles.socials`). */
  socials: SocialLink[];
  /** Estado global de los DOCUMENTOS (lo pone un trigger al enviar). */
  identityStatus: IdentityStatus;
  /** Foto pública del tutor (`tutor_profiles.avatar_path`). */
  hasAvatar: boolean;
  /**
   * Biografía (`tutor_profiles.bio`). Desde el 28-ago ni ella ni la foto
   * bloquean el avance del asistente, pero las dos siguen haciendo falta para
   * APROBAR — y esa diferencia tiene que verse: por eso el checklist las cuenta.
   */
  hasBio: boolean;
  /** Mentorías creadas: sin ninguna no se aprueba el perfil (EX-02). */
  productCount: number;
  /** Dentro del asistente el repaso es el ÚLTIMO paso: nada manda fuera. */
  inWizard?: boolean;
  /**
   * Bloques que se montan DESDE FUERA, ya listos (mismo patrón que las tarjetas
   * de `account-form`): la foto + biografía y el alta de mentoría.
   *
   * 28-ago · "no me digas que ya subí la foto, muéstrame ahí el cuadrito de la
   * foto que subí y cambiarlo" — el repaso deja EDITAR, no solo informar. Vienen
   * de fuera porque quien sabe guardar es quien los monta: uno escribe en
   * `tutor_profiles` y el otro crea un `product`, y ninguna de las dos
   * escrituras es de este módulo.
   */
  perfil?: React.ReactNode;
  mentoria?: React.ReactNode;
  /**
   * Solo en el asistente: sin botones propios, «Continuar» necesita disparar el
   * guardado y ESPERAR su resultado (un enlace inválido no puede avanzar de
   * paso, porque la pantalla de cierre desmonta este módulo y con él los
   * archivos elegidos, que hasta guardarlos viven solo en memoria).
   */
  saveRef?: RefObject<VerificationSave | null>;
}) {
  const router = useRouter();
  const [staged, setStaged] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState<null | "draft" | "review">(null);
  // Siempre hay una fila en pantalla: la primera es la obligatoria.
  const [links, setLinks] = useState<SocialLink[]>(() =>
    socials.length > 0 ? socials : [{ platform: "", url: "" }],
  );
  /** Tipo elegido en el selector de documentos, todavía sin archivo detrás. */
  const [tipoNuevo, setTipoNuevo] = useState("");
  const nuevoRef = useRef<HTMLInputElement>(null);

  const filled = links.filter((l) => l.platform || l.url.trim());
  const linksDirty =
    JSON.stringify(filled.map((l) => ({ ...l, url: l.url.trim() }))) !==
    JSON.stringify(socials);
  const stagedTypes = Object.keys(staged);
  const hasNew = stagedTypes.length > 0 || linksDirty;
  const hasDrafts = Object.values(docsByType).some((d) => d.status === "draft");

  /* ── N-10 · Estado por paso, derivado de las TRES fuentes ────────────────
   * Documentos (`verification_documents`), redes (`tutor_profiles.socials`) y
   * nº de mentorías (`products`). Ninguna columna lo resume: pedírsela a
   * `identity_verification_status` daría "sin enviar" a un tutor con los seis
   * documentos guardados como borrador.
   */
  const docStatuses = KYC_DOCS.map(
    (d) => staged[d.type] ? "staged" : docsByType[d.type]?.status,
  );
  const docsListos = docStatuses.filter(Boolean).length;
  const docsState: StepState = (() => {
    if (docStatuses.some((s) => s === "rejected"))
      return { label: "Rechazado", tone: "red", hecho: false };
    if (identityStatus === "approved")
      return { label: "Aprobado", tone: "green", hecho: true };
    if (docStatuses.some((s) => s === "pending"))
      return { label: "En revisión", tone: "blue", hecho: true };
    // 'draft' (o un archivo elegido y aún sin subir) es trabajo hecho que la
    // verificación NO cuenta como enviado: se nombra distinto para no dar a
    // entender que hay que repetirlo.
    if (docsListos > 0)
      return { label: "Empezado, sin enviar", tone: "amber", hecho: false };
    return { label: "Sin empezar", tone: "neutral", hecho: false };
  })();

  /** Tipos que aún no están en el expediente → los que ofrece el selector. */
  const disponibles = KYC_DOCS.filter(
    (d) => !staged[d.type] && !docsByType[d.type],
  );
  /** Y los que sí: es lo único que se pinta como lista (28-ago). */
  const enExpediente = KYC_DOCS.filter(
    (d) => staged[d.type] || docsByType[d.type],
  );
  const faltanRequeridos = KYC_REQUERIDOS.filter(
    (d) => !staged[d.type] && !docsByType[d.type],
  );

  const redesGuardadas = socials.length > 0;
  const redesState: StepState = redesGuardadas
    ? { label: "Guardado", tone: "green", hecho: true }
    : filled.length > 0
      ? { label: "Sin guardar", tone: "amber", hecho: false }
      : { label: "Falta", tone: "neutral", hecho: false };

  /**
   * Foto y biografía, juntas: desde el 28-ago las dos son opcionales para
   * avanzar y ninguna lo es para aprobar, así que aquí cuentan igual. Una sola
   * de las dos deja el paso «a medias» en vez de «lista» — que es exactamente
   * la diferencia entre "puedes seguir" y "podemos aprobarte".
   */
  const perfilState: StepState =
    hasAvatar && hasBio
      ? { label: "Lista", tone: "green", hecho: true }
      : hasAvatar || hasBio
        ? { label: "A medias", tone: "amber", hecho: false }
        : { label: "Falta", tone: "neutral", hecho: false };

  const mentoriaState: StepState = productCount > 0
    ? { label: "Creada", tone: "green", hecho: true }
    : { label: "Falta", tone: "neutral", hecho: false };

  const pasos = [perfilState, docsState, redesState, mentoriaState];
  const completos = pasos.filter((p) => p.hecho).length;

  /**
   * TODOS CERRADOS dentro del asistente (28-ago, petición del cliente): el
   * repaso ahora trae dentro la foto, la biografía y el formulario entero de la
   * mentoría, así que abrir uno de entrada es abrir una pantalla larguísima
   * sobre otra pantalla larga.
   *
   * En el panel se mantiene lo de antes —el primer paso que falte, abierto—
   * porque allí esta lista ES la pantalla: no hay nada que la preceda y caer en
   * una lista toda cerrada obliga a un clic para empezar a trabajar.
   *
   * En los dos casos es estado INICIAL a propósito: recalcularlo en cada render
   * cerraría de golpe la sección que el tutor acaba de completar sin haber
   * salido de ella.
   */
  const [abiertos, setAbiertos] = useState<Set<number>>(() => {
    if (inWizard) return new Set();
    const primero = pasos.findIndex((p) => !p.hecho);
    return new Set([primero === -1 ? 2 : primero + 1]);
  });
  const togglePaso = (n: number) =>
    setAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  /**
   * Filas completas y con URL válida, o `null` si alguna está a medias (con su
   * aviso ya mostrado). Una fila del todo vacía no estorba: se ignora.
   */
  function cleanLinks(): SocialLink[] | null {
    const out: SocialLink[] = [];
    for (const l of filled) {
      if (!l.platform) {
        toast.error("Elige la plataforma de cada enlace.");
        return null;
      }
      // ponytail: validación de forma con el parser del navegador, sin regex ni
      // dependencia. El contenido lo juzga el admin al revisar.
      let url: string;
      try {
        const u = new URL(l.url.trim());
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          toast.error("Los enlaces deben empezar por https://");
          return null;
        }
        url = u.toString();
      } catch {
        toast.error("Hay un enlace que no es una URL válida (incluye https://).");
        return null;
      }
      out.push({ platform: l.platform, url });
    }
    return out;
  }

  /** Sube y guarda lo pendiente. Devuelve false si algo falló (deja lo demás). */
  async function persist(draft: boolean): Promise<boolean> {
    const supabase = createClient();

    const cleaned = cleanLinks();
    if (!cleaned) return false;
    // El primer enlace es obligatorio para ENVIAR a revisión; el borrador puede
    // quedarse a medias (el módulo se completa poco a poco, R24-15).
    if (!draft && cleaned.length === 0) {
      toast.error("Añade al menos un enlace a tu portafolio.");
      return false;
    }

    const saved: string[] = [];
    for (const [type, file] of Object.entries(staged)) {
      const path = `${userId}/${type}`; // carpeta = uid → lo exige la RLS
      const up = await supabase.storage
        .from("kyc-documents")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (up.error) {
        toast.error("No se pudo subir un archivo. Intenta de nuevo.");
        break;
      }
      const { error } = await supabase.rpc("submit_document", {
        p_doc_type: type,
        p_storage_path: path,
        p_draft: draft,
      });
      if (error) {
        toast.error("No se pudo guardar un documento.");
        break;
      }
      saved.push(type);
    }
    // Quita del staging solo lo que sí se guardó (un fallo deja el resto listo).
    if (saved.length) {
      setStaged((prev) => {
        const next = { ...prev };
        saved.forEach((t) => delete next[t]);
        return next;
      });
    }
    if (saved.length !== stagedTypes.length) return false;

    if (linksDirty) {
      // Perfil de vitrina, no documento: va a `tutor_profiles` (column-grant de
      // `socials`), no por `submit_document`.
      const { error } = await supabase
        .from("tutor_profiles")
        .update({ socials: cleaned })
        .eq("profile_id", userId);
      if (error) {
        toast.error("No se pudieron guardar tus enlaces.");
        return false;
      }
    }
    return true;
  }

  /** Marca de "el repaso ya se guardó"; su porqué, dentro de `guardarPaso`. */
  const yaGuardado = useRef(false);

  /**
   * Guardado del paso de repaso. Siempre BORRADOR, también ahora que es el
   * último paso: quien envía a revisión es «Finalizar», en la misma pulsación y
   * justo después de esto (ver `next()` del asistente). Separarlo no es un
   * capricho — el envío manda documentos Y enlaces a la vez, y si el guardado
   * falla no hay nada que enviar.
   *
   * No avisa de nada al terminar bien: quien lo dispara es «Finalizar», y la
   * pantalla de cierre ya es el acuse de recibo. Los fallos sí hablan (los
   * toasts los pone `persist`).
   */
  async function guardarPaso(): Promise<VerificationSaveResult> {
    setBusy("draft");
    const ok = await persist(true);
    setBusy(null);
    if (ok) {
      // ⚠️ La marca va aquí y no en `hasNew`: el desmontaje que viene detrás de
      // «Continuar» se cierra sobre el `staged` de ANTES de guardar —React
      // agrupa el vaciado y el cambio de paso en el mismo commit—, así que sin
      // ella el guardado de salida volvería a subir los mismos seis archivos.
      yaGuardado.current = true;
      router.refresh();
    }
    return {
      ok,
      // Lo que ya había en la BD más lo que acaba de subir esta llamada:
      // `docsByType` es una prop del servidor y no se entera del upload.
      docs: new Set([...Object.keys(docsByType), ...(ok ? stagedTypes : [])]).size,
      // Si `persist` falló, los enlaces no llegaron a escribirse: aborta antes.
      socials: ok && linksDirty ? filled.length : socials.length,
    };
  }

  /*
   * Se re-registra en CADA render a propósito: `guardarPaso` se cierra sobre
   * `staged` y `links`, y un registro con `[]` dejaría al asistente guardando
   * lo que hubiera en el primer render (mismo motivo que el ref de
   * `useSaveOnExit`).
   */
  useEffect(() => {
    if (saveRef) saveRef.current = guardarPaso;
  });

  /**
   * ⚠️ …y se BORRA al desmontar. Sin esto el asistente se quedaría con un cierre
   * sobre el `staged` del repaso y, al salir desde la pantalla de cierre,
   * volvería a subir como `draft` los documentos que «Finalizar» acaba de pasar
   * a `pending`.
   */
  useEffect(() => {
    if (!saveRef) return;
    return () => {
      saveRef.current = null;
    };
  }, [saveRef]);

  /**
   * Salir del repaso por cualquier otra puerta —«Atrás», «Guardar y salir» del
   * header, el botón del navegador— también guarda. Sin los dos botones de
   * antes, este desmontaje es lo único que queda entre el tutor y perder los
   * archivos que eligió, que hasta aquí solo existen en memoria.
   *
   * Fuera del asistente NO se activa: allí mandan los dos botones, y un
   * guardado silencioso al abandonar la pantalla contradiría el "nada se sube
   * hasta que pulses" que promete el pie.
   */
  useSaveOnExit(() => {
    if (inWizard && hasNew && !yaGuardado.current) void guardarPaso();
  });

  async function saveDraft() {
    setBusy("draft");
    const ok = await persist(true);
    setBusy(null);
    if (ok) {
      toast.success("Borrador guardado. Envíalo a revisión cuando esté listo.");
      router.refresh();
    }
  }

  async function submitReview() {
    setBusy("review");
    const ok = await persist(false);
    if (ok) {
      // Barre los borradores de sesiones anteriores que no se re-subieron ahora.
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_documents_for_review");
      if (error) {
        setBusy(null);
        toast.error("No se pudo enviar a revisión.");
        return;
      }
    }
    setBusy(null);
    if (ok) {
      toast.success("Documentos enviados a revisión.");
      router.refresh();
    }
  }

  const setLink = (i: number, patch: Partial<SocialLink>) =>
    setLinks((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));

  /**
   * Archivo elegido desde el selector: se deja listo bajo su tipo y el
   * desplegable vuelve a cero, que es lo que invita a añadir el siguiente.
   * La subida sigue siendo diferida (nada toca Storage hasta el guardado).
   */
  function onNuevoArchivo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file || !tipoNuevo) return;
    const problema = fileProblem(file, {
      types: KYC_TYPES,
      maxBytes: KYC_MAX_BYTES,
      hint: KYC_HINT,
    });
    if (problema) {
      toast.error(problema);
      return;
    }
    setStaged((p) => ({ ...p, [tipoNuevo]: file }));
    setTipoNuevo("");
  }

  return (
    <>
      {/* Barra de progreso del paquete completo: foto + documentos + redes +
          mentoría. Es lo que la sesión de pruebas pedía ver de un vistazo. */}
      <PanelCard className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#19191f]">
            Tu expediente de tutor
          </p>
          <p className="mt-0.5 text-[12.5px] text-[#6b6b6b]">
            {inWizard
              ? completos === pasos.length
                ? "Está todo. Lo enviamos a revisión al pulsar «Finalizar»."
                : "Repasa lo que falta y complétalo aquí mismo. Lo que dejes se guarda al pulsar «Finalizar»; nada llega a revisión hasta entonces."
              : completos === pasos.length
                ? "Está todo. Envía tus documentos a revisión cuando quieras."
                : "Completa los cuatro bloques y envíalo todo junto: así lo revisamos de una vez."}
          </p>
        </div>
        <StatusPill tone={completos === pasos.length ? "green" : "neutral"}>
          {completos} de {pasos.length} listos
        </StatusPill>
      </PanelCard>

      {/* Paso 1 · Foto y biografía, editables AQUÍ MISMO (28-ago). Antes esto
          era un texto que decía "ya la subiste" y un enlace al paso 1 del
          asistente — el único sitio donde se podían tocar—; ahora las dos son
          opcionales para avanzar, así que el sitio donde se completan «luego»
          tiene que existir, y es este. */}
      <ChecklistStep
        n={1}
        icon={UserRoundIcon}
        title="Tu foto y tu biografía"
        summary="La cara y el texto de tu tarjeta en el catálogo."
        state={perfilState}
        open={abiertos.has(1)}
        onToggle={() => togglePaso(1)}
      >
        {perfil ?? (
          <p className="text-[13px] text-[#4d4d4d]">
            {hasAvatar && hasBio
              ? "Ya tienes foto y biografía."
              : "Todavía te falta la foto o la biografía. Puedes completarlas desde tu registro de tutor."}
          </p>
        )}
        {/* Opcionales para AVANZAR, no para APROBAR: la diferencia se dice, no
            se deduce. Es lo único que queda del bloqueo que había antes. */}
        {!hasAvatar || !hasBio ? (
          <p className="mt-3 text-[12.5px] text-[#9a6b00]">
            Puedes seguir sin ellas, pero no aprobamos un perfil sin foto ni
            biografía: los alumnos eligen tutor por la ficha.
          </p>
        ) : null}
      </ChecklistStep>

      {/* Paso 2 · Documentos (C-14). 28-ago: selector + lista de lo subido, no
          las seis filas fijas de antes — ver la nota de `KYC_DOCS`. */}
      <ChecklistStep
        n={2}
        icon={FileTextIcon}
        title="Documentos de identidad y formación"
        summary={
          docsListos === 0
            ? `Elige el tipo y añádelo · ${KYC_HINT}`
            : `${docsListos} ${docsListos === 1 ? "documento añadido" : "documentos añadidos"} · ${
                faltanRequeridos.length === 0
                  ? "tienes los tres requeridos"
                  : `${faltanRequeridos.length === 1 ? "falta 1" : `faltan ${faltanRequeridos.length}`} de los requeridos`
              }`
        }
        state={docsState}
        open={abiertos.has(2)}
        onToggle={() => togglePaso(2)}
      >
        <p className="text-xs text-[#6b6b6b]">
          Sube lo que tengas a mano y vuelve cuando quieras: no hay una lista
          que rellenar de golpe.
        </p>
        {/* Se DESTACAN, no bloquean: «Continuar» nunca los exige. */}
        <p
          className={cn(
            "mt-2 text-xs",
            faltanRequeridos.length > 0 ? "text-[#9a6b00]" : "text-success",
          )}
        >
          {faltanRequeridos.length === 0
            ? "Ya tienes los tres documentos que pide la aprobación."
            : `Requeridos para aprobar tu perfil: ${enumerar(KYC_REQUERIDOS.map((d) => d.label))}. Te ${faltanRequeridos.length === 1 ? "falta" : "faltan"} ${enumerar(faltanRequeridos.map((d) => d.label))}.`}
        </p>

        {/* El selector: mismo gesto que el portafolio de abajo — elegir qué es
            y añadirlo. El archivo NO sube aquí; se queda listo como siempre. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            aria-label="Tipo de documento"
            value={tipoNuevo}
            disabled={busy !== null || disponibles.length === 0}
            onChange={(e) => setTipoNuevo(e.target.value)}
            className="h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm text-[#333333] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-[260px]"
          >
            <option value="">¿Qué documento subes?</option>
            {/* Un solo hijo de texto por opción: `<option>` no admite varios. */}
            {disponibles.map((d) => (
              <option key={d.type} value={d.type}>
                {`${d.label}${d.requerido ? " · requerido" : ""}`}
              </option>
            ))}
          </select>
          <input
            ref={nuevoRef}
            type="file"
            accept={KYC_TYPES.join(",")}
            className="hidden"
            onChange={onNuevoArchivo}
          />
          <Button
            variant="outline"
            disabled={busy !== null || !tipoNuevo}
            onClick={() => nuevoRef.current?.click()}
            className="h-[45px] rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
          >
            Elegir archivo y añadir
          </Button>
        </div>
        {disponibles.length === 0 ? (
          <p className="mt-2 text-xs text-[#6b6b6b]">
            Ya has añadido los {KYC_DOCS.length} tipos de documento que
            aceptamos. Puedes reemplazar cualquiera desde la lista.
          </p>
        ) : null}

        {/* Lo que YA hay. Un documento guardado se REEMPLAZA, no se quita: la
            RLS de `verification_documents` no da `delete` a `authenticated`
            —solo select, insert y update de `storage_path`—, así que un botón
            de borrar sería un botón que falla. Lo que sí se quita es lo elegido
            en esta sesión, que hasta guardarse vive solo en memoria. */}
        {enExpediente.length > 0 ? (
          <div className="mt-5 divide-y divide-[#e0e0e0]">
            {enExpediente.map((d) => (
              <FileRow
                key={d.type}
                label={d.label}
                hint={d.hint}
                requerido={d.requerido}
                status={docsByType[d.type]?.status}
                stagedName={staged[d.type]?.name}
                onPick={(file) => setStaged((p) => ({ ...p, [d.type]: file }))}
                onClear={() =>
                  setStaged((p) => {
                    const next = { ...p };
                    delete next[d.type];
                    return next;
                  })
                }
                disabled={busy !== null}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-[12px] border border-dashed border-[#e0e0e0] p-4 text-center text-[13px] text-[#6b6b6b]">
            Todavía no has añadido ningún documento.
          </p>
        )}
      </ChecklistStep>

      {/* Paso 3 · R29-02 — portafolio y redes en UN módulo (190:98). Antes esto
          era un enlace suelto aquí y dos campos más en el paso 3 del asistente.
          ⚠️ El apartado se llama «Portafolio» desde el 28-ago (petición del
          cliente): solo cambia la ETIQUETA. La columna sigue siendo
          `tutor_profiles.socials` y su lógica, `lib/socials.ts`. */}
      <ChecklistStep
        n={3}
        icon={LinkIcon}
        title="Portafolio"
        summary={
          redesGuardadas
            ? `${socials.length} ${socials.length === 1 ? "enlace guardado" : "enlaces guardados"}`
            : "Al menos uno, obligatorio para enviar a revisión."
        }
        state={redesState}
        open={abiertos.has(3)}
        onToggle={() => togglePaso(3)}
      >
        <p className="text-xs text-[#6b6b6b]">
          Tu web, tu portafolio o tus perfiles públicos: es parte de lo que
          revisamos. El primer enlace es obligatorio para enviar tu perfil a
          revisión y puedes añadir hasta {MAX_SOCIALS}; si lo tuyo es una web
          propia, elige «Sitio web / Portafolio» y pega el enlace que quieras.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {links.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`Plataforma del enlace ${i + 1}`}
                value={l.platform}
                disabled={busy !== null}
                onChange={(e) => setLink(i, { platform: e.target.value })}
                className="h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm text-[#333333] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-[190px]"
              >
                <option value="">Plataforma…</option>
                {SOCIAL_PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Input
                type="url"
                inputMode="url"
                aria-label={`Enlace ${i + 1}`}
                placeholder="https://…"
                value={l.url}
                disabled={busy !== null}
                onChange={(e) => setLink(i, { url: e.target.value })}
                className="h-[45px] min-w-0 flex-1 rounded-[8px] bg-muted px-3.5 text-sm placeholder:text-[#8c8c8c]"
              />
              {/* La fila 1 no se quita: siempre queda algo que rellenar. */}
              {i > 0 ? (
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    setLinks((prev) => prev.filter((_, j) => j !== i))
                  }
                  className="h-10 rounded-[8px] px-3 text-[13.5px] text-[#6b6b6b]"
                >
                  Quitar
                </Button>
              ) : null}
            </div>
          ))}
          {links.length < MAX_SOCIALS ? (
            <Button
              variant="outline"
              disabled={busy !== null}
              // El tope se comprueba sobre `prev`, no sobre el render: con el
              // guard solo en el JSX, dos clicks seguidos metían la fila 6.
              onClick={() =>
                setLinks((prev) =>
                  prev.length >= MAX_SOCIALS
                    ? prev
                    : [...prev, { platform: "", url: "" }],
                )
              }
              className="h-10 w-fit rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
            >
              Añadir otra
            </Button>
          ) : (
            <p className="text-xs text-[#6b6b6b]">
              Máximo {MAX_SOCIALS} enlaces.
            </p>
          )}
        </div>
      </ChecklistStep>

      {/* Paso 4 · La primera mentoría, con acceso directo (N-10). EX-02: el
          tutor puede posponerla, pero sin ella no se aprueba el perfil — así
          que el checklist la cuenta y no la esconde en otra pantalla. */}
      <ChecklistStep
        n={4}
        icon={GraduationCapIcon}
        title="Tu primera mentoría"
        summary={
          productCount > 0
            ? `${productCount} ${productCount === 1 ? "mentoría creada" : "mentorías creadas"}`
            : "Sin ella no podemos aprobar tu perfil."
        }
        state={mentoriaState}
        open={abiertos.has(4)}
        onToggle={() => togglePaso(4)}
      >
        <p className="text-[13px] text-[#4d4d4d]">
          {productCount > 0
            ? "Ya tienes tu primera mentoría. Se publicará en cuanto aprobemos tu perfil."
            : "Define qué enseñas, a qué precio y en cuánto tiempo. Se guarda como borrador: una mentoría solo se publica con el perfil aprobado."}
        </p>
        {/* 28-ago · "no digas que en el próximo paso la cargo, debemos incluir
            el formulario ahí mismo". El paso siguiente ya no existe: el alta
            entra AQUÍ y con ella el asistente termina. */}
        {mentoria ? (
          <div className="mt-4">{mentoria}</div>
        ) : (
          <Button
            asChild
            variant={productCount > 0 ? "outline" : "default"}
            className={
              productCount > 0
                ? "mt-3 h-10 rounded-[8px] px-4 text-[13.5px] text-[#4d4d4d]"
                : "mt-3 h-10 rounded-[8px] bg-brand px-4 text-[13.5px] font-semibold hover:bg-brand/90"
            }
          >
            <Link href="/tutor/products/new">
              {productCount > 0 ? "Crear otra mentoría" : "Crear mi primera mentoría"}
            </Link>
          </Button>
        )}
      </ChecklistStep>

      {/* El envío es en bloque (Figma: "Enviar a revisión / Guardar borrador"):
          nada llega al admin hasta "Guardar y enviar a revisión". Vive fuera de
          los pasos a propósito: manda documentos Y enlaces a la vez, así que
          colgarlo de uno solo mentiría sobre su alcance.

          ⚠️ Y NO se pintan dentro del asistente: allí serían dos botones más
          peleándose con «Atrás» y «Finalizar» sin que ninguno dijera cuál
          termina. Manda el paso: «Finalizar» guarda esto como borrador y, en la
          misma pulsación, envía el expediente. */}
      {!inWizard ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            variant="outline"
            disabled={busy !== null || !hasNew}
            onClick={saveDraft}
            className="h-[45px] rounded-[8px] px-5 text-[13.5px] text-[#4d4d4d]"
          >
            {busy === "draft" ? "Guardando…" : "Guardar borrador"}
          </Button>
          <Button
            disabled={busy !== null || !(hasNew || hasDrafts)}
            onClick={submitReview}
            className="h-[45px] rounded-[8px] bg-brand px-5 text-[13.5px] font-semibold hover:bg-brand/90"
          >
            {busy === "review" ? "Enviando…" : "Guardar y enviar a revisión"}
          </Button>
        </div>
      ) : null}

      <p className="text-xs text-[#6b6b6b]">
        Formatos: {KYC_HINT}. Tus documentos son privados; solo el equipo de
        revisión los ve.{" "}
        {inWizard
          ? "Elige tus archivos y pulsa «Finalizar»: se guardan y se envían a revisión con el resto de tu expediente."
          : "Elige tus archivos y guárdalos como borrador para seguir más tarde: nada llega a revisión hasta que pulses «Guardar y enviar a revisión»."}
      </p>
    </>
  );
}
