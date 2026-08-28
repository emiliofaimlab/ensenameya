"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AttachmentPicker,
  type AdjuntoSubido,
} from "@/components/contact/attachment-picker";
import {
  CONTACT_KINDS,
  CONTACT_KIND_SPECS,
  type ContactKind,
} from "@/lib/contact/request-kinds";

/**
 * DL-01 · los tres campos que dLocal exige: nombre, correo y mensaje.
 *
 * La validación de verdad está en `POST /api/contacto` y en los `check` de la
 * tabla; lo de aquí solo evita el viaje de ida y vuelta para lo obvio. Cuando
 * el servidor rechaza, se enseña SU mensaje: es el que sabe por qué.
 *
 * ── TIPO DE SOLICITUD (28-ago) ──────────────────────────────────────────────
 * Petición del cliente. No es un campo más: es el que decide si aparece el
 * selector de ficheros y qué acepta. Se puso como `<select>` y no como un campo
 * de asunto libre porque de eso depende la validación de los adjuntos en las
 * dos puntas —el formulario no tenía asunto ni motivo, así que no hay nada que
 * integrar y no se añade un segundo selector que diga casi lo mismo—.
 *
 * ⚠️ Los ficheros se suben mientras se rellena el formulario, no al enviarlo
 * (el porqué está en `attachment-picker.tsx`). De ahí `folder`: es el id de la
 * solicitud, la carpeta del bucket, y se genera UNA vez por formulario. Si se
 * regenerase en cada repintado, cada adjunto acabaría en una carpeta distinta.
 */
export function ContactForm() {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [kind, setKind] = useState<ContactKind>("mensaje");
  const [adjuntos, setAdjuntos] = useState<AdjuntoSubido[]>([]);
  // Inicializador perezoso: `crypto.randomUUID()` corre una sola vez, no en
  // cada render.
  const [folder, setFolder] = useState(() => crypto.randomUUID());

  const spec = CONTACT_KIND_SPECS[kind];

  function cambiarTipo(nuevo: ContactKind) {
    setKind(nuevo);
    // Se vacía la lista: lo que estuviera subido no vale para el tipo nuevo —el
    // servidor lo rechazaría por MIME, o directamente por no admitir ficheros—.
    // Los objetos quedan huérfanos en el bucket y los recoge la purga: el
    // navegador no puede borrarlos (el porqué, en el picker).
    setAdjuntos([]);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;

    // Un tipo con adjuntos y ningún archivo casi siempre es un despiste: se ha
    // elegido "Subir documentos" y se ha olvidado el documento. Se corta aquí y
    // NO en el servidor a propósito: allí sería tirar un mensaje que ya está
    // escrito, y un texto sin fichero sigue siendo una consulta legítima.
    if (spec.types !== null && adjuntos.length === 0) {
      toast.error(
        "Adjunta al menos un archivo o cambia el tipo a «Mensaje».",
      );
      return;
    }

    setEnviando(true);

    const datos = new FormData(e.currentTarget);
    const payload = {
      name: String(datos.get("name") ?? ""),
      email: String(datos.get("email") ?? ""),
      message: String(datos.get("message") ?? ""),
      website: String(datos.get("website") ?? ""),
      kind,
      // Solo rutas y nombres: los bytes ya están en Storage. El servidor le
      // pregunta el tamaño y el tipo al objeto, no a esto.
      attachments: adjuntos.map((a) => ({ path: a.path, name: a.name })),
    };

    try {
      const res = await fetch("/api/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        toast.error(cuerpo.error ?? "No hemos podido enviar tu mensaje.");
        setEnviando(false);
        return;
      }
      setEnviado(true);
    } catch {
      toast.error("No hemos podido conectar. Revisa tu conexión.");
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <div className="rounded-2xl border border-border bg-background p-8 text-center">
        <CheckCircle2Icon
          className="mx-auto size-11 text-brand"
          strokeWidth={1.5}
          aria-hidden
        />
        <h2 className="mt-4 text-[20px] font-semibold">Mensaje recibido</h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Te responderemos al correo que nos has dejado. Solemos contestar en
          menos de 24 horas en días laborables.
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            setEnviado(false);
            setEnviando(false);
            setKind("mensaje");
            setAdjuntos([]);
            // Solicitud nueva, carpeta nueva: si se reutilizara la anterior, el
            // tope de archivos por carpeta contaría los del mensaje ya enviado.
            setFolder(crypto.randomUUID());
          }}
        >
          Escribir otro mensaje
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-border bg-background p-6 sm:p-8"
      noValidate
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="contacto-nombre">Nombre</Label>
          <Input
            id="contacto-nombre"
            name="name"
            autoComplete="name"
            maxLength={120}
            required
            placeholder="Cómo te llamas"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="contacto-email">Correo electrónico</Label>
          <Input
            id="contacto-email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            placeholder="tu@correo.com"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-2">
        <Label htmlFor="contacto-tipo">Tipo de solicitud</Label>
        {/* `<select>` nativo: es el patrón del resto del proyecto (no hay
            componente `ui/select`) y en móvil abre el selector del sistema, que
            es lo que mejor funciona. Las clases son las de `Input`. */}
        <select
          id="contacto-tipo"
          name="kind"
          value={kind}
          disabled={enviando}
          onChange={(e) => cambiarTipo(e.target.value as ContactKind)}
          className="h-[45px] w-full rounded-[8px] border border-input bg-muted px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {CONTACT_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONTACT_KIND_SPECS[k].label}
            </option>
          ))}
        </select>
        <p className="text-[13px] text-muted-foreground">{spec.help}</p>
      </div>

      <div className="mt-5 grid gap-2">
        <Label htmlFor="contacto-mensaje">Mensaje</Label>
        <Textarea
          id="contacto-mensaje"
          name="message"
          rows={6}
          maxLength={5000}
          required
          placeholder="Cuéntanos en qué podemos ayudarte."
        />
      </div>

      {/* Solo se pinta si el tipo elegido admite ficheros; el propio componente
          devuelve `null` para "Mensaje". */}
      <AttachmentPicker
        kind={kind}
        folder={folder}
        adjuntos={adjuntos}
        onAdd={(a) => setAdjuntos((prev) => [...prev, a])}
        onRemove={(path) =>
          setAdjuntos((prev) => prev.filter((a) => a.path !== path))
        }
        disabled={enviando}
      />

      {/*
        Honeypot. Invisible para una persona y tentador para un bot, que rellena
        todo lo que encuentra. `tabIndex={-1}` y `aria-hidden` lo sacan también
        del teclado y del lector de pantalla, para que nadie lo rellene sin
        querer; `autoComplete="off"` evita que lo haga el navegador.
        Va con `hidden` de CSS y no con `type="hidden"`: los bots suelen saltarse
        los ocultos por tipo.
      */}
      <div className="hidden" aria-hidden>
        <label htmlFor="contacto-website">No rellenes este campo</label>
        <input
          id="contacto-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <Button type="submit" className="mt-6 w-full sm:w-auto" disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar mensaje"}
      </Button>

      <p className="mt-4 text-[13px] text-muted-foreground">
        Usamos tu correo solo para responderte. Puedes leer cómo tratamos tus
        datos en nuestra{" "}
        <a href="/privacy" className="underline hover:text-brand">
          política de privacidad
        </a>
        .
      </p>
    </form>
  );
}
