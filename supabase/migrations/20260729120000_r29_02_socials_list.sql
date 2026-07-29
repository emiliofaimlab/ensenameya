-- R29-02 · Redes y portafolio en UN solo módulo
--
-- Los enlaces se pedían en dos sitios: el paso 3 del asistente (los escribía en
-- `tutor_profiles.socials` con forma `{instagram: …, linkedin: …}`) y el módulo
-- de verificación (como documento `social_media`, por `link_url`). Ahora viven
-- todos en `socials` como LISTA — `[{platform, url}]` — para admitir hasta 5 y
-- cualquier enlace externo (portafolios).
--
-- Sin cambios de esquema: `socials` ya es jsonb y ya tiene sus grants. Esto es
-- solo el traslado del dato y la retirada del tipo obsoleto.

-- ── 1) Forma vieja (objeto) → lista ──────────────────────────────────────────
-- La clave era la plataforma, así que se conserva tal cual. Las entradas con
-- valor vacío se descartan: no son un enlace, son un campo que quedó sin llenar.
update public.tutor_profiles tp
   set socials = coalesce(
         (select jsonb_agg(jsonb_build_object('platform', key, 'url', btrim(value))
                           order by key)
            from jsonb_each_text(tp.socials)
           where btrim(coalesce(value, '')) <> ''),
         '[]'::jsonb)
 where jsonb_typeof(tp.socials) = 'object';

-- ── 2) El enlace que vivía como documento entra en la lista ──────────────────
-- Sin plataforma declarada (el campo era libre) → 'other'. El `not exists`
-- evita duplicarlo si ya estaba en `socials`.
update public.tutor_profiles tp
   set socials = tp.socials
                 || jsonb_build_array(
                      jsonb_build_object('platform', 'other', 'url', vd.link_url))
  from public.verification_documents vd
 where vd.tutor_id = tp.profile_id
   and vd.doc_type = 'social_media'
   and btrim(coalesce(vd.link_url, '')) <> ''
   and not exists (
         select 1
           from jsonb_array_elements(tp.socials) e
          where e->>'url' = vd.link_url);

-- ── 3) Fuera el tipo obsoleto ────────────────────────────────────────────────
-- Mismo motivo (y mismo precedente) que la limpieza de C-14 en
-- `20260715130000`: `refresh_identity_status` agrega TODOS los documentos del
-- tutor, así que un `social_media` en 'rejected' dejaría su identidad clavada en
-- rechazada — y el formulario ya no ofrece dónde volver a enviarlo. El enlace no
-- se pierde: acaba de copiarse a `socials` en el paso 2.
delete from public.verification_documents
 where doc_type = 'social_media';
