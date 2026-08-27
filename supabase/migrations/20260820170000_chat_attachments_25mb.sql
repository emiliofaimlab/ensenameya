-- ============================================================================
-- MN-11b (P-8) — El tope de los adjuntos del chat sube de 10 MB a 25 MB.
--
-- Respuesta del cliente del 20-ago a la pregunta P-8 del Doc 20. Solo el chat:
-- `avatars` y `product-images` se quedan en 5 MB, `tutor-materials` y
-- `kyc-documents` en 10 MB. Nadie pidió tocarlos y subir un tope no es gratis
-- —es cuota de Storage y son subidas desde el navegador de gente con la línea
-- que tenga—, así que se sube el que se pidió y ni uno más.
--
-- ⚠️ POR QUÉ ESTO ES UN `update` Y NO EL `insert` DE SIEMPRE.
-- Los cinco buckets del proyecto se crearon con
--     insert into storage.buckets (…) values (…) on conflict (id) do nothing;
-- y sobre un bucket que YA EXISTE ese `on conflict … do nothing` es un
-- **no-op silencioso**: `db push` en verde, `psql` sin un solo error, y el
-- `file_size_limit` exactamente igual que estaba. Copiar el patrón vecino
-- —que es lo natural, porque en todo el repo no había ni un `update
-- storage.buckets` hasta este fichero— es la forma de cerrar esta ficha sin
-- haber cambiado nada, y de no enterarse hasta que un alumno intente subir
-- 12 MB y se coma un 413 que la UI ya no explica.
--
-- ⚠️ EL BUCKET ES EL ÚNICO SITIO DONDE ESTO SE APLICA. La subida va del
-- navegador a Storage con la clave anon, sin pasar por nuestro servidor: no hay
-- Route Handler en medio que pueda validar nada. El espejo de cliente
-- (`src/components/tutor/upload-formats.ts`, `ATTACHMENT_MAX_BYTES`) existe
-- solo para dar un mensaje decente antes de intentarlo, y se cambia EN LA MISMA
-- tanda que esta migración: si divergen, la UI miente en una dirección o en la
-- otra.
--
-- ⚠️ Y HAY UN TECHO POR ENCIMA DE ESTE. El proyecto tiene un límite global de
-- subida en el panel de Supabase (Storage → Settings) que acota por arriba a
-- CUALQUIER bucket. Si algún día alguien lo baja por debajo de estos 25 MB,
-- esta migración seguirá pasando en verde y las subidas seguirán fallando. No
-- se ve desde el repo y no se arregla con SQL: es una acción de panel.
-- Comprobado el 20-ago contra dev con subidas REALES al bucket, no con SQL:
--   12 MB    → 200 (con el tope viejo esto era un 413: prueba de que el
--                   `update` de abajo surtió efecto y no fue un no-op)
--   24,5 MB  → 200 (prueba de que el techo GLOBAL del proyecto deja sitio
--                   hasta 25 MB; el `update` solo no lo demostraría)
--   30 MB    → EntityTooLarge, que es el rechazo correcto
-- Son tres pruebas distintas y cada una demuestra una cosa. Por encima de
-- 25 MB no hay nada comprobado: mirar el panel antes de subir ningún tope.
-- ============================================================================

update storage.buckets
   set file_size_limit = 26214400  -- 25 MB (25 * 1024 * 1024)
 where id = 'chat-attachments';

-- La red de seguridad contra el fallo que describe la cabecera: si el `update`
-- no tocó ninguna fila, el bucket no existe con ese id y la migración habría
-- pasado en verde sin hacer nada. Mejor romper el `db push` aquí que descubrirlo
-- en producción con un 413.
do $$
declare
  v_limit bigint;
begin
  select file_size_limit into v_limit
    from storage.buckets where id = 'chat-attachments';

  if v_limit is null then
    raise exception
      'MN-11b: el bucket chat-attachments no existe o no tiene tope; revisa 20260722180000';
  end if;

  if v_limit <> 26214400 then
    raise exception
      'MN-11b: chat-attachments quedó en % bytes, se esperaban 26214400', v_limit;
  end if;
end $$;
