import { DownloadIcon, ExternalLinkIcon, FileTextIcon, LinkIcon, MegaphoneIcon } from "lucide-react";

import { requireTutorProfile } from "@/lib/auth/tutor";
import { createClient } from "@/lib/supabase/server";
import { PanelCard } from "@/components/layout/panel-shell";
import { TutorShell } from "@/components/layout/tutor-shell";
import { humanSize } from "@/components/tutor/upload-formats";
import { BUCKET_RECURSOS, TTL_RECURSO_SEGUNDOS, esImagen } from "@/lib/recursos-redes";

export const metadata = { title: "Recursos para redes · Enséñame Ya" };

/**
 * EY-222 · La galería de recursos para redes del tutor.
 *
 * 🔑 Aquí NO se filtra por audiencia: lo hace la RLS (`social_resources_select_tutor`,
 * `20261013140000`). Esta consulta devuelve exactamente lo que a este tutor le
 * toca ver, y un recurso que no le toca no existe para él —ni la fila ni el
 * fichero, que solo se puede firmar si la fila se ve—. Los `is_published` /
 * `deleted_at` de abajo repiten la política a propósito: el admin que entra
 * aquí (también tiene `select` por `social_resources_select_admin`) vería si
 * no los borradores y las bajas.
 *
 * `requireTutorProfile` y no el rol `tutor`: un tutor pendiente de aprobación
 * también puede recibir material (audiencia «Todos los tutores»).
 */
export default async function TutorRecursosPage() {
  const { userId } = await requireTutorProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("social_resources")
    .select("id, title, description, category, kind, file_path, file_name, mime_type, size_bytes, external_url")
    .eq("is_published", true)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  // Regla de oro 10: un fallo NO es «no hay recursos».
  if (error) throw new Error(`No se pudieron leer los recursos: ${error.message}`);

  const recursos = data ?? [];

  // Enlaces firmados EN LOTE y en servidor (bucket privado, regla de oro 3).
  // Dos lotes: uno para ver (la miniatura, abrir el PDF) y otro que fuerza la
  // descarga con el nombre original.
  const rutas = recursos.flatMap((r) => (r.kind === "file" && r.file_path ? [r.file_path] : []));
  const ver = new Map<string, string>();
  const bajar = new Map<string, string>();
  if (rutas.length > 0) {
    const storage = supabase.storage.from(BUCKET_RECURSOS);
    const [vistas, descargas] = await Promise.all([
      storage.createSignedUrls(rutas, TTL_RECURSO_SEGUNDOS),
      storage.createSignedUrls(rutas, TTL_RECURSO_SEGUNDOS, { download: true }),
    ]);
    for (const f of vistas.data ?? []) if (f.path && f.signedUrl) ver.set(f.path, f.signedUrl);
    for (const f of descargas.data ?? []) if (f.path && f.signedUrl) bajar.set(f.path, f.signedUrl);
  }

  return (
    <TutorShell
      userId={userId}
      title="Recursos para redes"
      description="Plantillas e imágenes del equipo de Enséñame Ya para que promociones tus mentorías."
    >
      {recursos.length === 0 ? (
        <PanelCard className="flex flex-col items-center gap-3 py-12 text-center">
          <MegaphoneIcon className="size-8 text-[#fe6a00]" aria-hidden />
          <p className="text-[15px] font-semibold text-[#19191f]">Todavía no hay recursos para ti</p>
          <p className="max-w-md text-[13px] text-[#6b6b73]">
            Cuando el equipo publique plantillas o imágenes para redes que te
            correspondan, aparecerán aquí listas para descargar.
          </p>
        </PanelCard>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {recursos.map((r) => {
            const urlVer = r.file_path ? ver.get(r.file_path) : undefined;
            const urlBajar = r.file_path ? bajar.get(r.file_path) : undefined;
            return (
              <li key={r.id}>
                <PanelCard className="flex h-full flex-col gap-3 p-4">
                  <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[12px] bg-[#f5f5f7]">
                    {r.kind === "file" && esImagen(r.mime_type) && urlVer ? (
                      // Bucket privado con URL firmada que caduca: `next/image`
                      // la optimizaría y cachearía por su cuenta.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={urlVer} alt={r.title} className="size-full object-contain" loading="lazy" />
                    ) : r.kind === "link" ? (
                      <LinkIcon className="size-10 text-[#0080ff]" aria-hidden />
                    ) : (
                      <FileTextIcon className="size-10 text-[#fe6a00]" aria-hidden />
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-1">
                    {r.category ? (
                      <span className="w-fit rounded-full bg-[#fff0e5] px-2 py-0.5 text-[11px] font-semibold text-[#c2410c]">
                        {r.category}
                      </span>
                    ) : null}
                    <h2 className="text-[15px] font-bold text-[#19191f]">{r.title}</h2>
                    {r.description ? (
                      <p className="text-[13px] text-[#6b6b73]">{r.description}</p>
                    ) : null}
                    {r.kind === "file" && r.size_bytes ? (
                      <p className="text-[12px] text-[#8a8a93]">
                        {r.file_name ?? "Archivo"} · {humanSize(r.size_bytes)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {r.kind === "link" && r.external_url ? (
                      <a
                        href={r.external_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#fe6a00] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#e55f00]"
                      >
                        <ExternalLinkIcon className="size-4" aria-hidden /> Abrir plantilla
                      </a>
                    ) : urlBajar ? (
                      <>
                        <a
                          href={urlBajar}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[#fe6a00] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#e55f00]"
                        >
                          <DownloadIcon className="size-4" aria-hidden /> Descargar
                        </a>
                        {urlVer ? (
                          <a
                            href={urlVer}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#e0e0e0] px-4 py-2 text-[13px] font-semibold text-[#19191f] hover:bg-[#f5f5f7]"
                          >
                            Ver
                          </a>
                        ) : null}
                      </>
                    ) : (
                      // La fila se ve pero el fichero no se pudo firmar: se
                      // dice, en vez de pintar un botón que da 400.
                      <p className="text-[12px] text-[#b42318]">
                        El archivo no está disponible ahora mismo. Prueba a recargar.
                      </p>
                    )}
                  </div>
                </PanelCard>
              </li>
            );
          })}
        </ul>
      )}
    </TutorShell>
  );
}
