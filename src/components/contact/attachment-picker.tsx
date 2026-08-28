"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileTextIcon, ImageIcon, UploadCloudIcon, XIcon } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  CONTACT_KIND_SPECS,
  MAX_ADJUNTOS,
  SUPPORT_BUCKET,
  SUPPORT_MAX_BYTES,
  type ContactKind,
} from "@/lib/contact/request-kinds";
import { fileProblem, humanSize } from "@/components/tutor/upload-formats";

/** Lo que el formulario manda al enviar: la ruta, y el nombre original que
 *  Storage no conserva (la ruta lleva prefijo aleatorio). El tamaño es solo
 *  para pintarlo — el servidor se lo pregunta al objeto, no a nosotros. */
export type AdjuntoSubido = { path: string; name: string; size: number };

/**
 * DL-01 · el selector de ficheros del formulario de contacto.
 *
 * ⚠️ SUBE ANTES DE ENVIAR, y no al pulsar "Enviar mensaje". No es un capricho:
 * los bytes no pueden pasar por el Route Handler —Vercel topa el cuerpo de una
 * función serverless en 4,5 MB y aquí se admiten 25— así que el fichero viaja
 * del navegador a Storage con una URL firmada que emite
 * `POST /api/contacto/adjuntos`, y lo que se envía luego con el mensaje son
 * rutas. El precio es que quien adjunta y cierra la pestaña deja el objeto
 * huérfano; de eso se encarga la purga (`20260828161500`), que barre lo que no
 * tiene mensaje que lo reclame pasado un día.
 *
 * ⚠️ Y por lo mismo, QUITAR UN ADJUNTO DE LA LISTA NO BORRA EL FICHERO. El
 * bucket no tiene política de `delete` (ni de `insert`: se sube con token), así
 * que el navegador no puede retirarlo. Se saca de la lista, no se manda, y la
 * purga de huérfanos se lo lleva. Es el mismo compromiso que ya documenta
 * `lib/chat/attachments.ts`, y conviene no dar por hecho lo contrario.
 */
export function AttachmentPicker({
  kind,
  folder,
  adjuntos,
  onAdd,
  onRemove,
  disabled,
}: {
  kind: ContactKind;
  /** Id de la solicitud = carpeta en el bucket. Lo genera el formulario una vez. */
  folder: string;
  adjuntos: AdjuntoSubido[];
  onAdd: (a: AdjuntoSubido) => void;
  onRemove: (path: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  const spec = CONTACT_KIND_SPECS[kind];
  const tipos = spec.types;
  const pista = spec.hint;

  // El tipo "Mensaje" no lleva ficheros: no se pinta nada. El servidor rechaza
  // igualmente los adjuntos de un tipo que no los admite.
  if (!tipos || !pista) return null;

  const esImagen = kind === "capturas";

  async function subir(files: FileList) {
    setSubiendo(true);
    const supabase = createClient();

    // Contador local: dentro del bucle `adjuntos.length` sigue siendo el de
    // antes de empezar (el estado del padre no se ha repintado todavía), y sin
    // esto arrastrar seis ficheros colaría los seis.
    let cuantos = adjuntos.length;

    for (const file of Array.from(files)) {
      if (cuantos >= MAX_ADJUNTOS) {
        toast.error(`Puedes adjuntar como máximo ${MAX_ADJUNTOS} archivos.`);
        break;
      }

      // Archivo a archivo, no la tanda entera: si arrastra tres y uno es un
      // .zip, los otros dos sí valen. Mismo juez que el resto de subidas.
      const problema = fileProblem(file, {
        types: tipos!,
        maxBytes: SUPPORT_MAX_BYTES,
        hint: pista!,
      });
      if (problema) {
        toast.error(problema);
        continue;
      }

      // 1 · El permiso. Aquí es donde el servidor vuelve a comprobar tipo,
      //     tamaño y cuántos van: lo de arriba solo evita el viaje.
      let path: string;
      let token: string;
      try {
        const res = await fetch("/api/contacto/adjuntos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folder,
            kind,
            name: file.name,
            type: file.type,
            size: file.size,
          }),
        });
        const cuerpo = (await res.json().catch(() => ({}))) as {
          path?: string;
          token?: string;
          error?: string;
        };
        if (!res.ok || !cuerpo.path || !cuerpo.token) {
          toast.error(cuerpo.error ?? `No se pudo subir ${file.name}.`);
          continue;
        }
        path = cuerpo.path;
        token = cuerpo.token;
      } catch {
        toast.error("No hemos podido conectar. Revisa tu conexión.");
        break;
      }

      // 2 · Los bytes, directos a Storage con el token. El bucket sigue siendo
      //     la última barrera: 400 si el MIME no cuadra, 413 si pasa del tope.
      const { error } = await supabase.storage
        .from(SUPPORT_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });

      if (error) {
        toast.error(`No se pudo subir ${file.name}.`);
        continue;
      }

      cuantos += 1;
      onAdd({ path, name: file.name, size: file.size });
    }

    setSubiendo(false);
  }

  return (
    <div className="mt-5 grid gap-3">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={tipos.join(",")}
        className="hidden"
        disabled={disabled || subiendo}
        onChange={(e) => {
          if (e.target.files?.length) void subir(e.target.files);
          // Se limpia para que elegir DOS VECES el mismo archivo vuelva a
          // disparar el `change`.
          e.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={disabled || subiendo || adjuntos.length >= MAX_ADJUNTOS}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled || subiendo) return;
          if (e.dataTransfer.files?.length) void subir(e.dataTransfer.files);
        }}
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-input p-6 text-center transition-colors hover:border-brand hover:bg-brand-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <UploadCloudIcon className="size-6 text-muted-foreground" aria-hidden />
        <span className="text-[14px] font-medium">
          {subiendo
            ? "Subiendo…"
            : esImagen
              ? "Arrastra tus capturas aquí o haz clic para subirlas"
              : "Arrastra tus documentos aquí o haz clic para subirlos"}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {pista} · hasta {MAX_ADJUNTOS} archivos
        </span>
      </button>

      {adjuntos.length > 0 ? (
        <ul className="grid gap-2">
          {adjuntos.map((a) => (
            <li
              key={a.path}
              className="flex items-center gap-3 rounded-lg bg-muted px-4 py-3"
            >
              {esImagen ? (
                <ImageIcon className="size-4 shrink-0 text-brand" aria-hidden />
              ) : (
                <FileTextIcon className="size-4 shrink-0 text-brand" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-[14px]">{a.name}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {humanSize(a.size)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(a.path)}
                disabled={disabled || subiendo}
                className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={`Quitar ${a.name}`}
              >
                <XIcon className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
