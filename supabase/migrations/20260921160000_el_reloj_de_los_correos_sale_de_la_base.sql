-- ============================================================================
-- Enséñame Ya — el reloj de los correos deja de ser GitHub Actions.
--
-- ── LO QUE SE MIDIÓ ─────────────────────────────────────────────────────────
--
-- 21-sep-2026, el cliente: «los correos en prod salen bastante tarde». No es
-- una impresión. Sobre los últimos 7 días de la cola de PRODUCCIÓN:
--
--   demora media   94 minutos
--   peor caso     252 minutos (4 h 12)
--
--   encolado 19-sep 01:36 → enviado 05:48   (4 h 12)
--   encolado 19-sep 13:56 → enviado 16:39   (2 h 43)
--   encolado 21-sep 11:43 → enviado 13:19   (1 h 36)
--
-- Y eso es exactamente lo que `notifications-send` ya lleva escrito en su
-- cabecera desde agosto: «está pedido cada 5 minutos y, medido sobre corridas
-- reales, entrega una cada 2-6 horas». El `.yml` dice `*/5 * * * *`; GitHub no
-- lo cumple y no promete cumplirlo. Para un «tu clase empieza en unos minutos»
-- eso no es un retraso: es no mandarlo — por eso `caducar_notificaciones()`
-- marca `failed` lo que llega tarde.
--
-- ── POR QUÉ ESTE RELOJ Y NO OTRO ────────────────────────────────────────────
--
-- Vercel Cron, que sería lo natural, en el plan Hobby permite UNA corrida
-- diaria: es el motivo por el que el job acabó en Actions. Pero ya hay un
-- planificador de verdad dentro de este proyecto y lleva trece jobs corriendo:
-- `pg_cron`. Lo único que le faltaba era poder salir a internet, y eso es
-- `pg_net`, que Supabase trae disponible (0.20.3) y solo había que encender.
--
-- Así que el reloj pasa a vivir en la base: un job cada 2 minutos que llama al
-- MISMO endpoint que llamaba GitHub. No se toca ni el envío, ni las plantillas,
-- ni la cola. Solo quién aprieta el botón y cada cuánto.
--
-- ⚠️ EL WORKFLOW DE GITHUB SE QUEDA, y no por olvido: es la red de seguridad.
-- Si este job se cae, la cola se sigue vaciando cada 2-6 horas en vez de
-- quedarse quieta para siempre — que es justo el fallo mudo de la regla de
-- oro 11. Los dos llaman a un endpoint idempotente: lo ya enviado está `sent` y
-- `pending_email_notifications` no lo devuelve.
--
-- ── EL SECRETO NO ESTÁ AQUÍ, Y NO PUEDE ESTARLO ─────────────────────────────
--
-- El endpoint exige `Authorization: Bearer <CRON_SECRET>` y falla cerrado (503)
-- sin ella. Ese valor NO va en una migración: esto es git, y sería publicar la
-- llave de los siete jobs. Vive en el **vault** de cada proyecto, que Supabase
-- ya trae instalado (`supabase_vault` 0.3.1), bajo dos nombres:
--
--   ey_cron_secret → el mismo valor que la variable CRON_SECRET de Vercel
--   ey_site_url    → la base del sitio, SIN barra final (https://ensenameya.com)
--   ey_vercel_bypass → OPCIONAL, y solo en dev (ver abajo)
--
-- Se siembran UNA vez por ambiente, a mano, fuera de git:
--
--   select vault.create_secret('<valor>', 'ey_cron_secret',
--          'Bearer del endpoint /api/cron/* — igual que CRON_SECRET en Vercel');
--   select vault.create_secret('https://ensenameya.com', 'ey_site_url',
--          'Origen del sitio para las llamadas de pg_cron');
--
-- ⚠️ Mientras no estén, la función NO llama a nadie y lo dice por `raise
-- notice`: falla cerrado, igual que el endpoint. Un job que dispare sin
-- credencial solo sabría coleccionar 401 en una tabla que nadie mira.
--
-- ── EL TERCER SECRETO, QUE SOLO HACE FALTA EN DEV ───────────────────────────
--
-- El preview de la rama `dev` está detrás de Vercel Deployment Protection
-- (`ssoProtection: all_except_custom_domains`), así que una llamada sin más
-- se come un 401 de VERCEL —no del endpoint— con un cuerpo que habla de SSO.
-- Medido aquí mismo al probarlo. El dominio propio de producción no tiene ese
-- muro, y por eso allí este secreto sobra.
--
-- Es el mismo mecanismo que ya usa el workflow de GitHub con
-- `VERCEL_PROTECTION_BYPASS`, y se siembra igual:
--
--   select vault.create_secret('<token de automation-bypass>', 'ey_vercel_bypass',
--          'x-vercel-protection-bypass del preview de dev — en prod no hace falta');
--
-- Sin él la cabecera no se manda, que es exactamente lo que queremos en prod.
-- ============================================================================

create extension if not exists pg_net;


-- ════════════════════════════════════════════════════════════════════════════
-- La función que aprieta el botón
-- ════════════════════════════════════════════════════════════════════════════
--
-- `security definer` porque lee del vault, cuyo `decrypted_secrets` no está al
-- alcance de nadie de fuera — y no hace falta que lo esté: esta función no
-- devuelve el secreto, lo gasta.
--
-- ⚠️ `search_path = ''` (regla de la casa) obliga a calificar TODO: `net.`,
-- `vault.`, `public.`. Sin eso, el día que alguien cree un esquema `net` propio
-- este job llamaría a otra cosa.
create or replace function public.disparar_correos_pendientes()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
  v_bypass text;
  v_cabeceras jsonb;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'ey_site_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'ey_cron_secret';
  -- Opcional y solo de dev: ver el bloque del tercer secreto en la cabecera.
  select decrypted_secret into v_bypass
    from vault.decrypted_secrets where name = 'ey_vercel_bypass';

  if v_url is null or v_secret is null then
    -- Falla cerrado y lo cuenta. Es el caso de un proyecto recién clonado o de
    -- un ambiente donde nadie sembró el vault todavía.
    raise notice 'disparar_correos_pendientes: falta ey_site_url o ey_cron_secret en el vault; no se llama a nadie';
    return;
  end if;

  -- ponytail: sin cerrojo entre pasadas. `pending_email_notifications` no
  -- reserva las filas que devuelve (no lleva `for update skip locked`), así que
  -- dos pasadas SIMULTÁNEAS podrían mandar el mismo correo dos veces. Hoy no
  -- cabe: el lote son 50 correos, tarda segundos, y el intervalo son 2 minutos.
  -- El día que el lote suba o el envío se ralentice, el cerrojo va en esa RPC
  -- —que es donde se reparten las filas—, no aquí.
  v_cabeceras := jsonb_build_object(
    'Authorization', 'Bearer ' || v_secret,
    'Content-Type',  'application/json'
  );
  if v_bypass is not null then
    v_cabeceras := v_cabeceras || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;

  -- ⚠️ `http_get` y NO `http_post`: los siete endpoints de `/api/cron/` exportan
  -- `GET` —así los llama `curl` en los workflows de GitHub, sin `-X`— y un POST
  -- contesta **405**. Medido al montar esto: el primer intento fue un POST y se
  -- lo comió entero. No se cambia el endpoint para que acepte POST: cambiar el
  -- verbo de siete rutas para contentar a un cliente nuevo es al revés.
  perform net.http_get(
    url     := v_url || '/api/cron/notifications-send',
    headers := v_cabeceras,
    -- Por encima de lo que tarda un lote y por debajo del intervalo: si una
    -- pasada se atasca, la siguiente no la encuentra todavía en vuelo.
    timeout_milliseconds := 55000
  );
end;
$$;

comment on function public.disparar_correos_pendientes() is
  'Llama a /api/cron/notifications-send con el CRON_SECRET del vault. Es el reloj rápido de la cola de correo (cada 2 min); el workflow de GitHub se queda como red de seguridad porque su cadencia real son 2-6 horas. Sin ey_site_url / ey_cron_secret en el vault no llama a nadie.';

revoke execute on function public.disparar_correos_pendientes() from public;
revoke execute on function public.disparar_correos_pendientes() from anon;
revoke execute on function public.disparar_correos_pendientes() from authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- El job
-- ════════════════════════════════════════════════════════════════════════════
--
-- Cada 2 minutos y no cada minuto: la cola de este producto recibe unidades de
-- correos al día, no miles. Con 2 minutos el peor caso pasa de 4 horas a 2
-- minutos, que es la diferencia que importa; bajar a 1 duplicaría las llamadas
-- para ganar 60 segundos que nadie nota.
select cron.unschedule('enviar-correos-pendientes')
 where exists (select 1 from cron.job where jobname = 'enviar-correos-pendientes');
select cron.schedule(
  'enviar-correos-pendientes',
  '*/2 * * * *',
  $cron$ select public.disparar_correos_pendientes() $cron$
);
