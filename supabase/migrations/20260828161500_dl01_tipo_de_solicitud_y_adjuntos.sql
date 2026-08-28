-- ============================================================================
-- Enséñame Ya — DL-01 · el formulario de contacto gana TIPO DE SOLICITUD y
-- ADJUNTOS (documentos y capturas de pantalla).
--
-- Petición del cliente (28-ago): «habilitar tipos de solicitud (mensaje, subida
-- de documentos o capturas) en el formulario de contacto». Hasta hoy el buzón
-- de `20260817120000` guardaba nombre, correo y texto y nada más: quien
-- escribía «te mando la captura del error» no tenía dónde ponerla y acababa
-- mandándola por su cuenta a `Info@ensenameya.com`, fuera de la bandeja.
--
-- ── POR QUÉ UN BUCKET PROPIO Y NO `chat-attachments` ────────────────────────
-- `chat-attachments` tiene sus políticas atadas a `bookings`: la carpeta es el
-- id de una reserva y solo la leen sus dos participantes. Quien escribe a
-- soporte muchas veces NI SIQUIERA TIENE CUENTA —el formulario es público y así
-- lo exige dLocal—, así que no hay reserva a la que colgar el fichero ni uid
-- con el que comprobar nada. Meterlo ahí obligaría a inventar reservas falsas o
-- a abrir la política del chat, que es justo lo que no se toca.
--
-- Se copia, eso sí, TODO lo demás del chat: los mismos MIME admitidos y el
-- mismo tope de 25 MB (MN-11b / P-8), con su espejo de cliente en
-- `components/tutor/upload-formats.ts` — que se cambia en la MISMA tanda que
-- esta migración o la UI miente en una dirección o en la otra.
--
-- ── QUIÉN SUBE, Y POR QUÉ NO HAY POLÍTICA DE INSERT ─────────────────────────
-- Ninguna. A propósito, y por el mismo razonamiento que dejó a
-- `contact_messages` sin `insert` para `anon`: un bucket con insert abierto
-- desde el navegador es un alojamiento de ficheros gratis con pasos de más, y
-- la clave anon viaja en el bundle de JavaScript.
--
-- El camino es una **URL de subida firmada**: `POST /api/contacto/adjuntos`
-- valida tipo, tamaño y número EN SERVIDOR, y solo entonces emite el token con
-- `service_role`. El navegador sube contra ese token, no contra la RLS. Y el
-- bucket sigue siendo la última barrera: 400 si el MIME no está en la lista,
-- 413 si pasa del tope, venga la subida por donde venga.
--
-- ⚠️ No he podido comprobarlo contra dev —el CLI no tiene acceso al proyecto
-- (403), así que esta migración va sin aplicar—. Si la subida firmada acabara
-- exigiendo también política de `insert`, el síntoma sería un 403 al subir, no
-- un fallo de despliegue.
--
-- ── LO QUE ESTA MIGRACIÓN **NO** TRAE ───────────────────────────────────────
-- Bandeja de admin. Hoy nadie lee `contact_messages` desde la app (se mira por
-- SQL), así que los adjuntos se abren igual: URL firmada sobre el bucket. La
-- política de `select` para admin queda puesta para el día que exista pantalla.
--
-- Doc 3 §permisos · 20260817120000 (DL-01) · 20260722180000 (adjuntos del chat)
-- ============================================================================

-- ── El tipo de solicitud ────────────────────────────────────────────────────
-- Tres valores y no más, que son los tres que pidió el cliente. El tipo decide
-- QUÉ se puede adjuntar (nada / documentos / imágenes), y esa correspondencia
-- vive en `src/lib/contact/request-kinds.ts`, que la comparten el formulario y
-- el Route Handler para no volver a tener dos listas.
create type public.contact_request_kind as enum (
  'mensaje',     -- solo texto, el comportamiento de siempre
  'documentos',  -- PDF, Word, PowerPoint o Excel
  'capturas'     -- PNG, JPG o WebP
);

-- `default 'mensaje'` y no null: las filas que ya existen son exactamente eso,
-- y el formulario viejo —si quedara alguna pestaña abierta— sigue funcionando
-- sin mandar el campo.
alter table public.contact_messages
  add column kind public.contact_request_kind not null default 'mensaje';

comment on column public.contact_messages.kind is
  'Tipo de solicitud elegido en el formulario. Decide qué MIME admiten sus adjuntos; la tabla de correspondencias está en src/lib/contact/request-kinds.ts.';


-- ── Los adjuntos ────────────────────────────────────────────────────────────
-- Tabla hija y no columnas en `contact_messages` (como sí hizo el chat en
-- `20260722180000`): allí el Figma pinta UN fichero por mensaje, y aquí quien
-- reporta un error manda tres capturas de la misma pantalla.
create table public.contact_message_attachments (
  id           uuid        primary key default gen_random_uuid(),

  message_id   uuid        not null
    references public.contact_messages (id) on delete cascade,

  -- Ruta dentro del bucket `support-attachments`, con la forma
  -- `<uuid-de-la-solicitud>/<uuid>-<nombre>`. Única: dos filas no apuntan al
  -- mismo objeto, así que la purga no puede encolarlo dos veces por error.
  path         text        not null unique,

  -- El nombre TAL Y COMO lo tenía quien lo subió. La ruta lleva prefijo
  -- aleatorio para que dos «captura.png» no se pisen, y sin esta columna la
  -- bandeja enseñaría el uuid en vez del nombre.
  file_name    text        not null check (char_length(trim(file_name)) between 1 and 200),

  -- Tamaño y MIME **como los reporta Storage**, no como los declaró el
  -- navegador: el Route Handler los lee del objeto ya subido antes de insertar.
  size_bytes   bigint      not null check (size_bytes > 0),
  mime_type    text        not null,

  created_at   timestamptz not null default now()
);

create index contact_message_attachments_message_idx
  on public.contact_message_attachments (message_id);

-- ── RLS: default-deny, igual que el padre ───────────────────────────────────
alter table public.contact_message_attachments enable row level security;

create policy "contact_message_attachments_select_admin"
  on public.contact_message_attachments for select
  using ( public.has_role('admin') );

-- Sin insert/update/delete: el único camino de escritura es POST /api/contacto
-- con `service_role`, que se salta la RLS. El borrado lo hace la cascada del
-- padre cuando la purga anual se lleva el mensaje.

-- ── Grants (auto-expose OFF · regla de oro 9) ───────────────────────────────
-- `service_role` se salta la RLS pero NO los grants, y el fallo sería en TIEMPO
-- DE EJECUCIÓN. Mínimo privilegio: ni `all` ni `delete` — de borrar se encarga
-- el `on delete cascade`.
grant select on public.contact_message_attachments to authenticated;
grant select, insert on public.contact_message_attachments to service_role;


-- ── El bucket ───────────────────────────────────────────────────────────────
-- Privado: son documentos y capturas de pantalla de gente que está contando un
-- problema, muchas veces con datos personales dentro. Se leen con URL firmada.
--
-- Los MIME y el tope son los mismos que `chat-attachments` tras MN-11b: PDF,
-- imagen o documento de Office, 25 MB. Aquí sí se puede poner el número en el
-- `insert` porque el bucket NACE en esta migración; el `update` del precedente
-- existía porque el suyo ya estaba creado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments', 'support-attachments', false,
  26214400,  -- 25 MB (25 * 1024 * 1024), el mismo que el chat
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword', 'application/vnd.ms-powerpoint', 'application/vnd.ms-excel'
  ]
)
on conflict (id) do nothing;

-- La red de seguridad de MN-11b: `on conflict do nothing` sobre un bucket que
-- ya existiera sería un no-op silencioso —`db push` en verde y el tope el que
-- estuviera— y solo se descubriría con un 413 en producción.
do $$
declare
  v_limit bigint;
begin
  select file_size_limit into v_limit
    from storage.buckets where id = 'support-attachments';

  if v_limit is distinct from 26214400 then
    raise exception
      'DL-01: support-attachments quedó en % bytes, se esperaban 26214400', v_limit;
  end if;
end $$;

-- Solo lectura, y solo para admin: quien escribe a soporte no vuelve a entrar a
-- ver su fichero (no hay ni pantalla ni, muchas veces, cuenta). Sin política de
-- insert a propósito — ver la cabecera.
drop policy if exists "support_attachments_select_admin" on storage.objects;
create policy "support_attachments_select_admin"
  on storage.objects for select to authenticated
  using ( bucket_id = 'support-attachments' and public.has_role('admin') );


-- ── Retención: la purga anual también se lleva los ficheros ─────────────────
-- `purge_contact_messages` borraba filas y ya. Con adjuntos, eso dejaría el
-- objeto huérfano en Storage — que es justo el dato personal que la retención
-- quiere caducar.
--
-- ⚠️ ENCOLAR, NO BORRAR (20260827190000). Supabase prohíbe `delete from
-- storage.objects` desde SQL (42501) y la guarda salta incluso con CERO filas,
-- tumbando la transacción entera: el fichero no se borraba y el mensaje tampoco.
-- Esta función corre en pg_cron, sin llamante HTTP, así que la vía es la cola:
-- se apuntan las rutas y `/api/cron/recordings-purge` las retira con la Storage
-- API. La fila vive hasta que el `remove()` va bien → reintentos gratis.
create or replace function public.purge_contact_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare borrados integer;
begin
  -- 1 · Los ficheros de los mensajes que se van. Se encolan ANTES del delete:
  --     después, la cascada ya se habría llevado las filas de la tabla hija y
  --     no quedaría de dónde sacar las rutas.
  insert into public.storage_purge_queue (bucket_id, path)
  select 'support-attachments', a.path
    from public.contact_message_attachments a
    join public.contact_messages m on m.id = a.message_id
   where m.created_at < now() - interval '1 year'
  on conflict (bucket_id, path) do nothing;

  delete from public.contact_messages
   where created_at < now() - interval '1 year';
  get diagnostics borrados = row_count;

  -- 2 · HUÉRFANOS. El formulario sube el fichero ANTES de enviar el mensaje
  --     —hace falta la ruta para mandarla en el envío—, así que quien adjunta
  --     y luego cierra la pestaña deja el objeto sin fila que lo reclame. Sin
  --     esto se acumularían para siempre, a 25 MB la pieza.
  --
  --     El día de margen es para no barrer un fichero que se subió hace un
  --     minuto y cuyo mensaje aún se está escribiendo. `storage.objects` se
  --     puede LEER desde SQL: lo prohibido es el `delete`.
  insert into public.storage_purge_queue (bucket_id, path)
  select 'support-attachments', o.name
    from storage.objects o
   where o.bucket_id = 'support-attachments'
     and o.created_at < now() - interval '1 day'
     and not exists (
       select 1 from public.contact_message_attachments a where a.path = o.name
     )
  on conflict (bucket_id, path) do nothing;

  return borrados;
end;
$$;

-- `execute` sobre una función es PUBLIC por defecto en Postgres. `create or
-- replace` conserva los privilegios de la versión anterior, pero se repite por
-- si esta migración corriera sobre una base donde la función no existía.
revoke execute on function public.purge_contact_messages() from public;
revoke execute on function public.purge_contact_messages() from anon;

-- El cron ya está programado por 20260817120000 ('30 4 * * *'): no se reprograma
-- aquí, que duplicaría la entrada.
