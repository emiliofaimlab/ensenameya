-- ============================================================================
-- El tope de los materiales de la mentoría sube de 10 MB a 50 MB.
--
-- Pedido del cliente el 21-sep-2026: «en "Materiales para la mentoría",
-- ¿podemos incrementar el espacio? Tengo un tutor que estaba montando unas
-- planillas de Excel y no podía por el tamaño». Es `tutor-materials`, creado a
-- 10 MB en `20260722160000:211` «como dice el Figma».
--
-- ⚠️ POR QUÉ ESTO ES UN `update` Y NO EL `insert` DE SIEMPRE — el mismo motivo
-- que documenta `20260820170000` (el 10 → 25 MB del chat, MN-11b) y que
-- `src/components/tutor/upload-formats.ts` repite en su cabecera: los siete
-- buckets se crearon con `insert … on conflict (id) do nothing`, y sobre un
-- bucket que YA EXISTE eso es un **no-op silencioso**. `db push` en verde,
-- typecheck en verde, y el bucket exactamente igual que estaba. Por eso abajo
-- va el `update` y, detrás, el bloque que verifica el valor y rompe el push si
-- no cuadra.
--
-- ⚠️ EL BUCKET ES EL ÚNICO SITIO DONDE ESTO SE APLICA. La subida va del
-- navegador a Storage con la clave anon, sin pasar por nuestro servidor: no hay
-- Route Handler que pueda validar nada. El espejo de cliente
-- (`MATERIAL_MAX_BYTES` en `upload-formats.ts`) existe solo para dar un mensaje
-- decente antes de intentarlo, y se cambia EN LA MISMA tanda que esto: si
-- divergen, la UI miente en una dirección o en la otra.
--
-- ── EL TECHO GLOBAL, QUE ESTA VEZ SÍ SE MIRÓ ANTES ──────────────────────────
--
-- Por encima del bucket manda el límite de subida del PROYECTO (panel →
-- Storage → Settings), que acota a cualquier bucket, no se ve desde el repo y
-- no se toca con SQL. `upload-formats.ts` avisa: «si algún tope de aquí lo
-- supera, la migración pasa en verde y las subidas siguen fallando».
--
-- Leído hoy por la Management API (`GET /v1/projects/<ref>/config/storage`):
--
--   dev  (lbtpnszjjsxbeileqsja) → fileSizeLimit = 52428800
--   prod (nrzsyysqanbrcgtslfte) → fileSizeLimit = 52428800
--
-- O sea **exactamente 50 MB en los dos**, que es justo el tope que se pide. No
-- hace falta tocar el panel, y tampoco se puede subir más: dev vive en una org
-- del plan Free, donde 50 MB es el máximo del plan. Si mañana alguien quiere
-- 100 MB, el trabajo NO empieza por esta migración: empieza por el panel (y en
-- dev, por el plan).
--
-- 🔴 Y POR ESO ESTE NÚMERO VA AL BORDE. Bucket y techo global valen lo mismo,
-- así que un archivo de 50 MB clavados pasa por los dos por un byte o falla por
-- un byte según cómo cuente cada capa. Se comprueba con subidas REALES al
-- bucket antes de dar la ficha por cerrada —como hizo MN-11b, que midió 12 MB,
-- 24,5 MB y 30 MB en vez de fiarse del SQL—, y si el borde raspa, lo que baja
-- es el tope del bucket y su espejo, no el mensaje al tutor.
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
--
-- `allowed_mime_types` se queda igual. El `.xlsx` de hoy ya está en la lista
-- (`…spreadsheetml.sheet`) y lo que se reportó fue el tamaño, no el formato. Un
-- Excel CON MACROS (`.xlsm`) sí lo rechazaría el bucket con un 400, pero eso es
-- otra ficha: obligaría a partir `OFFICE_TYPES`, que hoy comparten
-- `tutor-materials` y `chat-attachments`, y a tocar los dos buckets para que el
-- espejo no mienta. Nadie lo ha pedido.
-- ============================================================================

update storage.buckets
   set file_size_limit = 52428800  -- 50 MB (50 * 1024 * 1024)
 where id = 'tutor-materials';

-- La red contra el no-op que describe la cabecera: si el `update` no tocó
-- ninguna fila, esta migración habría pasado en verde sin cambiar nada. Mejor
-- romper el `db push` aquí que descubrirlo con un 413 que la UI ya no explica.
do $$
declare
  v_limit bigint;
begin
  select file_size_limit into v_limit
    from storage.buckets where id = 'tutor-materials';

  if v_limit is null then
    raise exception
      'el bucket tutor-materials no existe o no tiene tope; revisa 20260722160000';
  end if;

  if v_limit <> 52428800 then
    raise exception
      'tutor-materials quedó en % bytes, se esperaban 52428800', v_limit;
  end if;
end $$;
