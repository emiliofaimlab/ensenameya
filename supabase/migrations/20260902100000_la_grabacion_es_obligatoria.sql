-- Enséñame Ya — la grabación deja de pedir permiso: es obligatoria y notificada.
--
-- ── QUÉ CAMBIÓ, Y NO ES CÓDIGO ──────────────────────────────────────────────
-- US-1801/RN-42 nacieron con un consentimiento de DOS partes: solo se grababa
-- si el alumno Y el tutor decían que sí. El cliente reformuló la regla —consta
-- en el acta: «la grabación de sesiones será **obligatoria y notificada** (no
-- requiere aceptación explícita del usuario)»— y la interfaz ya se movió: la
-- casilla de la sala pasó de «Acepto» a «Entiendo» y es obligatoria para entrar.
--
-- Lo que NO se movió fue esta función. Seguía preguntando si existían las dos
-- filas de `session_recording_consents`, o sea seguía aplicando la regla vieja
-- por debajo de una interfaz que ya contaba otra.
--
-- ⚠️ Y con el modelo nuevo eso no era «estricto de más», era ENGAÑOSO: como el
-- «Entiendo» es obligatorio para entrar, las dos filas acaban existiendo casi
-- siempre, así que la función parecía funcionar. Lo que comprobaba de verdad no
-- era «los dos consintieron» sino «los dos ENTRARON» — y esas dos frases se
-- separan justo en el caso que más importa: la clase donde uno no aparece, que
-- es la que puede acabar en disputa y la que nadie podría revisar.
--
-- ── EL OTRO FALLO, QUE ERA EL GORDO ─────────────────────────────────────────
-- La sala se creaba con `enable_recording: "cloud"`, y eso **no graba**: solo
-- enciende el botón de grabar en la barra de Daily. Si nadie lo pulsaba, no
-- había fichero. Eso explica el número que llevábamos días mirando sin atarlo:
-- **12 sesiones con sala y 2 grabaciones**. No era falta de consentimiento, era
-- que nadie pulsaba.
--
-- Se arregla fuera de aquí, en `src/lib/daily.ts`: el token de reunión lleva
-- `start_cloud_recording: true` y la grabación arranca cuando entra el primero.
-- Daily no ofrece propiedad de sala equivalente —`enable_automatic_recording`
-- no existe, su API responde «invalid property name»—, así que tiene que ser el
-- token, y por eso va en los DOS: si el tutor se retrasa, la clase queda
-- grabada desde el primer minuto igual.
--
-- ── QUÉ HACE AHORA ESTA FUNCIÓN ─────────────────────────────────────────────
-- Devuelve `true` siempre. Se conserva —en vez de borrarla y limpiar sus dos
-- llamadas— por dos motivos: es el único punto donde la regla está escrita en
-- la base, así que el día que vuelva a haber excepciones (un país que exija
-- consentimiento, una mentoría marcada como no grabable) se cambia aquí y no en
-- tres sitios; y `notify_recording` cuelga de ella, así que quitarla obligaría a
-- reescribir también el disparador de NTF-19 sin necesidad.
--
-- `session_recording_consents` NO se borra: sigue siendo el registro de que a
-- cada persona se le mostró el aviso y cuándo. Eso pasa de ser un permiso a ser
-- una prueba de notificación, que es exactamente lo que la regla nueva necesita
-- para sostenerse legalmente.
--
-- ⚠️ ESTO OBLIGA A TOCAR TEXTO PÚBLICO. La FAQ de la portada decía «las
-- grabaciones se realizan únicamente con el consentimiento de ambas partes», y
-- deja de ser cierto en el mismo despliegue. Va en el mismo commit.

create or replace function public.recording_allowed(p_session_id uuid)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  -- `p_session_id` se ignora a propósito y la firma se conserva: sus dos
  -- llamadas (`api/room/[sessionId]` y `notify_recording`) siguen compilando y
  -- el día que vuelva a haber excepciones por sesión, el parámetro ya está.
  select true;
$$;

comment on function public.recording_allowed(uuid) is
  'Si esta sesión se graba. Desde 2026-09-02 devuelve SIEMPRE true: el cliente cambió la regla a «grabación obligatoria y notificada», y por eso la casilla de la sala es un «Entiendo» y no un «Acepto». Antes exigía filas de consentimiento de AMBAS partes, lo que en la práctica comprobaba «los dos entraron» y dejaba sin grabar justo la clase con un no-show. Se conserva la función y su parámetro para tener un solo sitio donde volver a poner excepciones. Ojo: esto autoriza a grabar; quien ARRANCA la grabación es `start_cloud_recording` en el token de Daily.';

-- Los grants no cambian; se repiten porque `EXECUTE` se concede a PUBLIC por
-- defecto en Postgres y un `drop`+`create` futuro los perdería (lección US-605).
revoke execute on function public.recording_allowed(uuid) from public;
revoke execute on function public.recording_allowed(uuid) from anon;
grant  execute on function public.recording_allowed(uuid) to authenticated;
grant  execute on function public.recording_allowed(uuid) to service_role;
