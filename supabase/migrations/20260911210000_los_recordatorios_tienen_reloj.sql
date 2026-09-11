-- ══════════════════════════════════════════════════════════════════════════════
-- DOC 33 · LOS TRES AVISOS CON RELOJ — Y LA CADUCIDAD QUE LOS HACE HONESTOS
--
-- ── QUÉ FALTABA ──────────────────────────────────────────────────────────────
--
-- Casi todo el Doc 7 cuelga de una transición de estado: algo pasa en una tabla,
-- un trigger encola su NTF. NTF-17, NTF-11 y NTF-08 son los tres que NO. No hay
-- evento al que engancharse porque el evento es **que pase el tiempo**: que a la
-- reserva le queden horas de plazo, que la clase sea mañana, que la sala acabe
-- de abrir. Sin alguien mirando el reloj no se encolaban nunca, y las tres
-- plantillas llevaban escritas desde el Doc 33 sin que nadie las disparara.
--
-- ── DECISIÓN Nº 2 DEL PLIEGO: ESTO CORRE DENTRO DE POSTGRES ──────────────────
--
-- Los cuatro barridos van por `pg_cron`, no por GitHub Actions. El motivo no es
-- de gusto: **la cadencia de GitHub es una ficción**. Los cuatro relojes que hoy
-- viven en `.github/workflows/` piden `*/5` y, medido sobre corridas reales,
-- entregan **una cada 2-6 horas**. Con eso NTF-08 —«tu clase empieza en unos
-- minutos»— llegaría de media tres horas tarde, y NTF-11 —«tu mentoría es
-- mañana»— podría salir el mismo día por la tarde. `pg_cron` corre dentro del
-- propio Postgres, sin red de por medio, y sí respeta el crontab que se le pone.
--
-- Ésa es también la razón de que `booking_expiring_tutor` diga la hora LÍMITE y
-- no «te quedan 4 horas»: la hora límite es un dato de la reserva y sigue siendo
-- cierta aunque el correo se retrase; un contador sacado del reloj del job, no.
--
-- ── LO QUE NO ARREGLA pg_cron, Y POR ESO ESTÁ EL PUNTO 4 ─────────────────────
--
-- Encolar a tiempo no sirve de nada si el ENVÍO va por otro sitio. Y va por otro
-- sitio: la cola la vacía `/api/cron/notifications-send`, que es precisamente
-- uno de los relojes de GitHub, o sea el de las 2-6 horas.
--
-- Un «tu clase empieza en 10 minutos» que sale tres horas después **es peor que
-- no mandarlo**: manda al alumno a una sala vacía de una clase que ya terminó, y
-- le enseña que nuestros avisos no son de fiar. Por eso `caducar_notificaciones`
-- mata en la cola lo que ya no puede llegar a tiempo, en vez de dejar que salga
-- tarde. Es la mitad honesta de NTF-08: sin ella, el barrido de aquí solo
-- garantiza que el correo se escriba pronto, no que se lea a tiempo.
--
-- ── CÓMO SE COMPRUEBA QUE ESTOS CUATRO JOBS CORREN DE VERDAD ─────────────────
--
-- ⚠️ Un job de `pg_cron` que falla no se lo dice a nadie: no hay build en rojo ni
-- 500 en Vercel, el error se queda en `cron.job_run_details`. `create or replace`
-- de aquí abajo **valida la sintaxis, no ejecuta el cuerpo** — un `case` sin
-- `::session_status` sobrevivió a una reescritura entera y `close_expired_sessions`
-- acumuló 12.446 fallos seguidos mientras tanto (regla de oro 11). Por eso todos
-- los literales de enum van casteados a mano aquí abajo aunque «se resolverían
-- solos», y por eso al final hay un ensayo que EJECUTA los cuatro cuerpos.
--
-- Para mirarlo en caliente se AGREGA por job y por estado, no se leen las diez
-- últimas filas: con cuatro jobs a `*/5` y `*/10`, las diez últimas filas son
-- todas del mismo cuarto de hora y un job roto hace semanas no aparece.
--
--   select j.jobname,
--          d.status,
--          count(*)                as corridas,
--          max(d.start_time)       as ultima,
--          max(d.return_message)   filter (where d.status <> 'succeeded') as ultimo_error
--     from cron.job_run_details d
--     join cron.job j on j.jobid = d.jobid
--    where j.jobname in ('avisar-reservas-por-expirar', 'avisar-clases-de-manana',
--                        'avisar-clases-que-empiezan',  'caducar-notificaciones')
--    group by 1, 2
--    order by 1, 2;
--
-- Una fila con `status = 'failed'` y `corridas` en los miles es el retrato exacto
-- del fallo de julio. Y «arreglado» significa arreglado en SU ambiente: el mismo
-- fallo siguió cayendo en producción dos días después de existir la migración
-- en dev.
--
-- ── LO QUE ESTA MIGRACIÓN NO TOCA, A PROPÓSITO ───────────────────────────────
--
-- ⚠️ `expire_stale_bookings` se queda como está. La tentación era añadirle un
-- argumento de preaviso y encolar NTF-17 desde ahí, ya que calcula el mismo
-- plazo. Añadir un argumento a una función NO es `create or replace`: PostgreSQL
-- crea una **sobrecarga**, PostgREST responde `PGRST203` y —peor aquí— su propio
-- `cron.schedule` la llama sin argumentos y se volvería ambiguo (regla de oro
-- 12). Función nueva al lado, mismo criterio de plazo, cero riesgo sobre el job
-- que ya cancela reservas y devuelve dinero.
-- ══════════════════════════════════════════════════════════════════════════════


-- ═══ 1) NTF-17 · a la reserva le quedan horas de plazo ═══════════════════════
--
-- ⚠️ EL PLAZO DE RN-38 SE CUENTA DESDE QUE SE PAGÓ, NO DESDE QUE SE CREÓ LA
-- RESERVA. `bookings.created_at` marca el momento en que se abrió el checkout;
-- entre eso y el pago pueden pasar minutos (o el hold de siete minutos entero).
-- Quien vence la reserva es `expire_stale_bookings`, y cuenta desde
-- `payments.paid_at` (`20260826120000:129-133`). Este preaviso tiene que contar
-- desde exactamente el mismo sitio o avisaría de un vencimiento que no es el que
-- va a ocurrir.
--
-- ⚠️ `payments.paid_at` ES NULLABLE, y eso no es un descuido que haya que tapar:
-- una reserva sin pagar no está en `pending_acceptance`, y si estuviera, el `<`
-- contra null da **null** —ni true ni false—, así que la fila no entra aquí. No
-- entra tampoco en el vencimiento de `expire_stale_bookings`, que hace la misma
-- comparación. O sea que las dos funciones ignoran las mismas filas por el mismo
-- motivo: eso es lo que hace que el preaviso y el vencimiento hablen del mismo
-- conjunto de reservas y no de dos parecidos.
--
-- El join no puede multiplicar filas: `payments.booking_id` es UNIQUE
-- (`20260709140000:97`), un pago por reserva.
create or replace function public.avisar_reservas_por_expirar(p_horas int default 4)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila   record;
  v_avisos int := 0;
begin
  -- El tope de 24 no es decorativo: con `p_horas >= 24` la resta da cero o
  -- negativo y la condición se convierte en «toda reserva pagada», o sea un
  -- correo de «se te acaba el plazo» en el mismo instante de pagar.
  if p_horas < 1 or p_horas >= 24 then
    raise exception 'el preaviso tiene que estar entre 1 y 23 horas, y llegó %', p_horas
      using errcode = 'check_violation';
  end if;

  for v_fila in
    select b.id, b.tutor_id
      from public.bookings b
      join public.payments p on p.booking_id = b.id
     where b.status = 'pending_acceptance'::public.booking_status
       -- «Le quedan p_horas o menos» dicho al revés: ya pasaron (24 - p_horas)
       -- desde el pago. Se escribe así, y no como `paid_at + 24h < now() + …`,
       -- para que el lado izquierdo sea la columna pelada y el planner pueda
       -- usar el índice si algún día hace falta.
       and p.paid_at < now() - (interval '24 hours' - make_interval(hours => p_horas))
       -- 🔑 LA CLAVE NO LLEVA `p_horas` DENTRO, Y ES DELIBERADO. Con ella, bajar
       -- el preaviso de 4 h a 2 h mañana encolaría un SEGUNDO correo a la misma
       -- reserva. Sin ella, es un aviso por reserva y punto, que es lo que dice
       -- la ficha de NTF-17.
       and not exists (
         select 1 from public.notifications n
          where n.idempotency_key = 'NTF-17:booking:' || b.id
       )
  loop
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-17', 'email', 'booking_expiring_tutor',
      -- El payload lleva solo la llave: la hora LÍMITE que enseña la plantilla
      -- la resuelve el contexto del correo desde `payments.paid_at + 24 h`, que
      -- es el mismo dato que usa el vencimiento. Copiarla aquí sería una foto
      -- que envejece mal si algún día el plazo cambia.
      jsonb_build_object('booking_id', v_fila.id),
      'NTF-17:booking:' || v_fila.id
    );
    v_avisos := v_avisos + 1;
  end loop;

  return v_avisos;
end $$;

comment on function public.avisar_reservas_por_expirar(int) is
  'Encola NTF-17 (booking_expiring_tutor) al tutor cuando a una reserva en pending_acceptance le quedan p_horas o menos del plazo de RN-38, y devuelve CUÁNTOS SE AVISARON EN ESTA PASADA — descarta en el propio select los que ya tienen la notificación. Cuenta desde payments.paid_at + 24 h y NO desde bookings.created_at, porque es desde ahí desde donde cuenta expire_stale_bookings, que es quien de verdad cancela y devuelve el dinero; contar desde otro sitio avisaría de un vencimiento distinto del que va a ocurrir. paid_at es nullable y el < contra null da null: una reserva sin pagar no entra aquí ni en el vencimiento, por el mismo motivo y a la vez. La clave de idempotencia NO lleva p_horas dentro a propósito: es lo que hace que sea un aviso por reserva y no uno por cada valor del preaviso. No se metió dentro de expire_stale_bookings porque añadirle un argumento crearía una sobrecarga (PGRST203) y dejaría ambigua la llamada sin argumentos de su propio cron.';


-- ═══ 2) NTF-11 · la clase es mañana ══════════════════════════════════════════
--
-- 🔴 ESTO SE BARRE POR SESIÓN, NO POR RESERVA. `bookings.num_sessions` puede ser
-- mayor que 1 —un paquete—, y cada fila de `sessions` tiene su propio `start_at`,
-- normalmente en semanas distintas. Con una clave `'NTF-11:booking:<id>'` el
-- recordatorio de la primera clase bloquearía para siempre el de la segunda: el
-- alumno recibiría un aviso de las cuatro que compró. La clave va por sesión.
--
-- ⚠️ La horquilla es de 2 h y el job corre cada 30 min: la horquilla es MÁS
-- ANCHA que la cadencia a propósito, para que ninguna sesión pueda colarse entre
-- dos pasadas. El precio es que cada sesión se mira unas cuatro veces, y lo que
-- impide que eso sean cuatro correos es —otra vez— que la clave no lleva dentro
-- el instante de la pasada.
create or replace function public.avisar_clases_de_manana()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila   record;
  v_avisos int := 0;
begin
  for v_fila in
    select s.id as session_id, s.booking_id, s.student_id, s.tutor_id
      from public.sessions s
      join public.bookings b on b.id = s.booking_id
     where s.start_at between now() + interval '23 hours' and now() + interval '25 hours'
       and s.status = 'scheduled'::public.session_status
       -- `in_progress` está aquí por los paquetes: la reserva entra en curso al
       -- empezar la PRIMERA clase, y las siguientes siguen mereciendo su
       -- recordatorio. Filtrar solo por `confirmed` dejaría sin aviso a todas
       -- las clases de un paquete menos la primera.
       and b.status in ('confirmed'::public.booking_status,
                        'in_progress'::public.booking_status)
       -- Se mira la clave del alumno y vale por las dos: se encolan juntas en la
       -- misma transacción, así que una existe si y solo si existe la otra.
       and not exists (
         select 1 from public.notifications n
          where n.idempotency_key = 'NTF-11:session:' || s.id || ':student'
       )
  loop
    -- A los dos, con el patrón de `notify_recording` (20260729230000:26-31): la
    -- clase es de los dos, y el tutor también organiza su día con esto.
    perform public.enqueue_notification(
      v_fila.student_id, 'NTF-11', 'email', 'booking_reminder_24h',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id),
      'NTF-11:session:' || v_fila.session_id || ':student'
    );
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-11', 'email', 'booking_reminder_24h',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id),
      'NTF-11:session:' || v_fila.session_id || ':tutor'
    );
    v_avisos := v_avisos + 2;
  end loop;

  return v_avisos;
end $$;

comment on function public.avisar_clases_de_manana() is
  'Encola NTF-11 (booking_reminder_24h) al alumno Y al tutor de cada sesión que empieza dentro de entre 23 y 25 horas, y devuelve CUÁNTOS AVISOS encoló en esta pasada (dos por sesión). Barre SESSIONS y no BOOKINGS porque num_sessions puede ser > 1 y cada sesión de un paquete tiene su propio start_at: con una clave por reserva, el recordatorio de la primera clase bloquearía para siempre el de las demás. La horquilla de 2 h es más ancha que la cadencia del job (30 min) para que ninguna sesión se cuele entre dos pasadas; lo que impide los duplicados que eso provoca es que la clave no lleva dentro el instante de la pasada. Acepta bookings en in_progress además de confirmed porque en un paquete la reserva entra en curso con la primera clase y las siguientes siguen necesitando su recordatorio.';


-- ═══ 3) NTF-08 · la sala ya está abierta ═════════════════════════════════════
--
-- ⚠️ SE BARRE `sessions.start_at`, QUE ES NOT NULL Y TIENE ÍNDICE
-- (`sessions_start_at_idx`, 20260709140000:85). La columna que «parece» la
-- correcta, `access_opens_at`, es NULLABLE: una sesión con ese campo vacío
-- saldría del `between` sin ruido y se quedaría sin aviso para siempre. Un
-- barrido que se salta filas en silencio es exactamente el fallo que no se
-- detecta hasta que un alumno se queja.
--
-- La ventana es solo hacia adelante (`now()` … `+15 min`): una clase que ya
-- empezó no recibe el aviso. Es lo correcto — «la sala ya está abierta» dicho
-- media hora tarde no es un aviso, es un reproche.
create or replace function public.avisar_clases_que_empiezan()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila   record;
  v_avisos int := 0;
begin
  for v_fila in
    select s.id as session_id, s.booking_id, s.student_id, s.tutor_id
      from public.sessions s
      join public.bookings b on b.id = s.booking_id
     where s.start_at between now() and now() + interval '15 minutes'
       and s.status = 'scheduled'::public.session_status
       and b.status in ('confirmed'::public.booking_status,
                        'in_progress'::public.booking_status)
       and not exists (
         select 1 from public.notifications n
          where n.idempotency_key = 'NTF-08:session:' || s.id || ':student'
       )
  loop
    perform public.enqueue_notification(
      v_fila.student_id, 'NTF-08', 'email', 'session_starting',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id),
      'NTF-08:session:' || v_fila.session_id || ':student'
    );
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-08', 'email', 'session_starting',
      jsonb_build_object('booking_id', v_fila.booking_id, 'session_id', v_fila.session_id),
      'NTF-08:session:' || v_fila.session_id || ':tutor'
    );
    v_avisos := v_avisos + 2;
  end loop;

  return v_avisos;
end $$;

comment on function public.avisar_clases_que_empiezan() is
  'Encola NTF-08 (session_starting) al alumno Y al tutor de cada sesión que empieza dentro de los próximos 15 minutos, y devuelve CUÁNTOS AVISOS encoló en esta pasada (dos por sesión). Barre sessions.start_at —not null y con índice— y NO access_opens_at, que es nullable: una sesión con ese campo vacío se caería del between sin ruido y se quedaría sin aviso para siempre. La ventana no mira hacia atrás a propósito: una clase que ya empezó no recibe el aviso. Para que este correo llegue a tiempo hace falta la otra mitad, caducar_notificaciones: encolarlo pronto no sirve de nada si el envío tarda horas.';


-- ═══ 4) LA MITAD HONESTA: caducar lo que ya no llega a tiempo ════════════════
--
-- 🔴 POR QUÉ EXISTE. La cola la vacía `/api/cron/notifications-send`, que es uno
-- de los relojes de GitHub Actions: pide `*/5` y entrega una corrida cada 2-6
-- horas. Un aviso de «tu clase empieza en unos minutos» que sale tres horas
-- después manda al alumno a una sala vacía de una clase que ya terminó. Eso es
-- **peor que no mandarlo**: no solo no ayuda, enseña que nuestros avisos no son
-- de fiar y hace que el siguiente se ignore.
--
-- Así que el aviso con reloj tiene fecha de caducidad, y al vencer se marca
-- `failed` —no se borra— para que quede el rastro de que existió y no salió.
-- `pending_email_notifications` solo mira `status = 'pending'`
-- (`20260806150000:91`), así que con esto deja de entrar en el lote.
--
-- ⚠️ QUÉ **NO** CADUCA, Y POR QUÉ ES UNA LISTA CORTA. Solo caduca lo que pierde
-- su sentido con la hora. Un recibo, una confirmación de reserva, un aviso de
-- payout o un reembolso siguen siendo exactamente igual de útiles con tres horas
-- —o tres días— de retraso: llegar tarde los hace lentos, no falsos. Matarlos en
-- la cola sería perder correo de verdad. Por eso la lista es explícita y por
-- plantilla, y no una regla del tipo «todo lo que lleve más de N horas».
--
--   · session_starting      → 30 min. Pasado eso la clase ya empezó.
--   · booking_reminder_24h  → 12 h.   Un «mañana» que sale el mismo día ya no
--                                     recuerda nada; y la plantilla, que calcula
--                                     los días contra el reloj del ENVÍO, se
--                                     titularía sola «Tu mentoría es hoy» —que
--                                     es cierto y a la vez inútil—.
--
-- NTF-17 (`booking_expiring_tutor`) **no está en la lista** aunque también tenga
-- reloj: su plazo es de 24 h y el correo dice la hora límite, así que aún con
-- retraso el tutor puede llegar a responder. Si la reserva ya venció, el que
-- habla es NTF-09 (cancelación), que sí llega.
create or replace function public.caducar_notificaciones()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caducadas int;
begin
  with caducadas as (
    update public.notifications n
       -- ⚠️ EL CAST A MANO. Sin `::public.notification_status` esto es el mismo
       -- error que tuvo a `close_expired_sessions` fallando 12.446 veces sin que
       -- nadie se enterara, y `create or replace` no lo habría visto (regla 11).
       set status = 'failed'::public.notification_status
     where n.status  = 'pending'::public.notification_status
       -- Solo el canal de correo: el aviso in-app es la MISMA fila (US-1203) y
       -- la campana lo lista por `read_at is null`, no por `status`. Caducar un
       -- in_app no lo escondería de la campana, solo mentiría sobre por qué no
       -- se envió — y la caducidad es un problema del riel de correo, que es el
       -- que entrega cada 2-6 horas.
       and n.channel = 'email'
       and (
            (n.template = 'session_starting'
              and n.created_at < now() - interval '30 minutes')
         or (n.template = 'booking_reminder_24h'
              and n.created_at < now() - interval '12 hours')
       )
    returning n.id
  )
  select count(*) into v_caducadas from caducadas;

  return v_caducadas;
end $$;

comment on function public.caducar_notificaciones() is
  'Marca failed las notificaciones de correo pendientes cuyo contenido ya no es cierto por la hora a la que saldrían, y devuelve cuántas caducó. Existe porque encolar a tiempo no basta: la cola la vacía /api/cron/notifications-send, que va por GitHub Actions y entrega una corrida cada 2-6 horas medidas, así que un session_starting puede salir tres horas tarde y mandar al alumno a una sala vacía de una clase terminada — peor que no mandarlo, porque enseña que nuestros avisos no son de fiar. Caduca SOLO dos plantillas y con plazos distintos: session_starting a los 30 min (pasado eso la clase ya empezó) y booking_reminder_24h a las 12 h (un «mañana» que sale el mismo día ya no recuerda nada). Todo lo demás NO caduca nunca y la lista es explícita a propósito: un recibo, una confirmación o un aviso de payout que llegan tarde siguen siendo útiles, y una regla genérica por antigüedad perdería correo de verdad. Marca y no borra para que quede el rastro de que el aviso existió y no salió. Solo canal email: el in-app es la misma fila y la campana lo lista por read_at, no por status.';


-- ── Privilegios de las cuatro ────────────────────────────────────────────────
--
-- ⚠️ EXECUTE nace concedido a PUBLIC en Postgres. Las dispara `pg_cron`, que
-- corre como el dueño y no necesita ningún grant, así que el `revoke` no es
-- burocracia: es lo único que impide que cualquiera con la clave `anon` —que va
-- en el navegador— dispare un barrido de correos a mano. Y el `grant` a
-- `service_role` es para que un Route Handler pueda forzar una pasada sin que le
-- salte `permission denied` en tiempo de ejecución (regla de oro 9).
revoke execute on function public.avisar_reservas_por_expirar(int) from public;
revoke execute on function public.avisar_reservas_por_expirar(int) from anon;
revoke execute on function public.avisar_reservas_por_expirar(int) from authenticated;
grant  execute on function public.avisar_reservas_por_expirar(int) to service_role;

revoke execute on function public.avisar_clases_de_manana() from public;
revoke execute on function public.avisar_clases_de_manana() from anon;
revoke execute on function public.avisar_clases_de_manana() from authenticated;
grant  execute on function public.avisar_clases_de_manana() to service_role;

revoke execute on function public.avisar_clases_que_empiezan() from public;
revoke execute on function public.avisar_clases_que_empiezan() from anon;
revoke execute on function public.avisar_clases_que_empiezan() from authenticated;
grant  execute on function public.avisar_clases_que_empiezan() to service_role;

revoke execute on function public.caducar_notificaciones() from public;
revoke execute on function public.caducar_notificaciones() from anon;
revoke execute on function public.caducar_notificaciones() from authenticated;
grant  execute on function public.caducar_notificaciones() to service_role;


-- ═══ 5) LOS RELOJES ══════════════════════════════════════════════════════════
--
-- `unschedule` + `schedule` y no un `update` a `cron.job`: es el patrón de la
-- casa (`20260716170000:225-226`), y el `where exists` lo hace idempotente sobre
-- una base que todavía no tenga el job.
--
-- Las cadencias no son gusto, son la mitad de la ficha de cada aviso:
--
--   · reservas-por-expirar  */10 — el preaviso es de 4 h; diez minutos de error
--                                  sobre cuatro horas no los nota nadie.
--   · clases-de-manana      */30 — la horquilla es de 2 h, cuatro veces más
--                                  ancha: ninguna sesión se cuela entre pasadas.
--   · clases-que-empiezan    */5 — la ventana es de 15 min. Con */10 el aviso
--                                  podría salir con la clase ya empezada.
--   · caducar-notificaciones */5 — tiene que correr al menos tan seguido como el
--                                  aviso más corto que vigila (los 30 min de
--                                  session_starting), o la fila se quedaría viva
--                                  el rato justo para que el envío la pillara.
--
-- El coste de las cuatro es despreciable: `sessions` tiene índice por `start_at`,
-- `bookings` por `status` y `notifications` por `status`, y en la inmensa mayoría
-- de las pasadas no encolan nada.
select cron.unschedule('avisar-reservas-por-expirar')
 where exists (select 1 from cron.job where jobname = 'avisar-reservas-por-expirar');
select cron.schedule(
  'avisar-reservas-por-expirar',
  '*/10 * * * *',
  $cron$ select public.avisar_reservas_por_expirar() $cron$
);

select cron.unschedule('avisar-clases-de-manana')
 where exists (select 1 from cron.job where jobname = 'avisar-clases-de-manana');
select cron.schedule(
  'avisar-clases-de-manana',
  '*/30 * * * *',
  $cron$ select public.avisar_clases_de_manana() $cron$
);

select cron.unschedule('avisar-clases-que-empiezan')
 where exists (select 1 from cron.job where jobname = 'avisar-clases-que-empiezan');
select cron.schedule(
  'avisar-clases-que-empiezan',
  '*/5 * * * *',
  $cron$ select public.avisar_clases_que_empiezan() $cron$
);

select cron.unschedule('caducar-notificaciones')
 where exists (select 1 from cron.job where jobname = 'caducar-notificaciones');
select cron.schedule(
  'caducar-notificaciones',
  '*/5 * * * *',
  $cron$ select public.caducar_notificaciones() $cron$
);


-- ═══ 6) LOS GRANTS QUE LE FALTAN AL RESUMEN DE INCIDENCIAS (NTF-13) ══════════
--
-- El endpoint que manda `admin_alert` lee cuatro tablas con `service_role`. Dos
-- de ellas —`user_roles` y `alert_acks`— no tienen **ni un grant** para ese rol:
-- comprobado migración por migración antes de escribir esto. `user_roles` solo
-- concede a `authenticated` (`20260703120000:20`) y `alert_acks` a
-- `authenticated` (`20260729170000:47`).
--
-- ⚠️ `service_role` SE SALTA LA RLS PERO NO LOS GRANT DE TABLA, y con
-- «auto-expose new tables» en OFF eso no lo tapa nadie: el job compilaría, el
-- typecheck pasaría, y comería `permission denied` **la primera vez que corriera
-- de verdad** (regla de oro 9). Mordió tres veces el 6-ago. Va aquí porque quien
-- necesita el grant es un job, y el grant se declara donde se descubre.
--
-- Solo `select`: el resumen lee, y `alert_acks` la escribe el admin por su
-- política de insert, no el job.
grant select on public.user_roles to service_role;
grant select on public.alert_acks to service_role;


-- ── Autocomprobaciones ───────────────────────────────────────────────────────
--
-- El patrón de `20260903210000`, `20260907120000` y `20260907140000`: la
-- migración se comprueba a sí misma. Aquí es más necesario que nunca, porque
-- todo lo de arriba son `create or replace` —que validan la sintaxis y NO
-- ejecutan el cuerpo— más cuatro jobs que, si fallan, no se lo dicen a nadie.
do $$
begin
  -- 1) La guarda del preaviso, por los dos extremos. Son las dos formas de
  --    convertir el aviso en spam: 0 no tiene sentido y 24 haría que la
  --    condición fuese «toda reserva pagada».
  begin
    perform public.avisar_reservas_por_expirar(0);
    raise exception 'un preaviso de 0 horas tenía que fallar y no falló';
  exception when check_violation then
    null;
  end;
  begin
    perform public.avisar_reservas_por_expirar(24);
    raise exception 'un preaviso de 24 horas tenía que fallar y no falló';
  exception when check_violation then
    null;
  end;

  -- 2) Los privilegios. Darlos por hechos es exactamente la forma del fallo que
  --    describe la regla de oro 9: no rompe el build, rompe la corrida.
  if has_function_privilege('authenticated',
       'public.avisar_reservas_por_expirar(int)', 'execute')
     or has_function_privilege('authenticated',
       'public.avisar_clases_de_manana()', 'execute')
     or has_function_privilege('authenticated',
       'public.avisar_clases_que_empiezan()', 'execute')
     or has_function_privilege('authenticated',
       'public.caducar_notificaciones()', 'execute') then
    raise exception 'alguno de los barridos es ejecutable por authenticated';
  end if;
  if not (has_function_privilege('service_role',
            'public.avisar_reservas_por_expirar(int)', 'execute')
      and has_function_privilege('service_role',
            'public.avisar_clases_de_manana()', 'execute')
      and has_function_privilege('service_role',
            'public.avisar_clases_que_empiezan()', 'execute')
      and has_function_privilege('service_role',
            'public.caducar_notificaciones()', 'execute')) then
    raise exception 'service_role no puede ejecutar alguno de los barridos (regla de oro 9)';
  end if;

  -- 3) Los grants de NTF-13, que son el motivo entero del punto 6.
  if not has_table_privilege('service_role', 'public.user_roles', 'select') then
    raise exception 'service_role no puede leer user_roles (regla de oro 9)';
  end if;
  if not has_table_privilege('service_role', 'public.alert_acks', 'select') then
    raise exception 'service_role no puede leer alert_acks (regla de oro 9)';
  end if;

  -- 4) Los cuatro relojes existen y con la cadencia pedida. Un job que no se
  --    programó no falla: simplemente no está, y eso no se ve en ningún sitio.
  if (select count(*) from cron.job
       where jobname in ('avisar-reservas-por-expirar', 'avisar-clases-de-manana',
                         'avisar-clases-que-empiezan',  'caducar-notificaciones')) <> 4 then
    raise exception 'faltan relojes: no están los cuatro jobs de los recordatorios';
  end if;
  if (select schedule from cron.job where jobname = 'avisar-clases-que-empiezan')
       is distinct from '*/5 * * * *' then
    raise exception 'avisar-clases-que-empiezan no corre cada 5 minutos y su ventana es de 15';
  end if;
end $$;

-- ── El ensayo que sí EJECUTA los cuerpos ─────────────────────────────────────
--
-- 🔴 ESTE ES EL BLOQUE QUE IMPORTA. `create or replace` valida que el SQL está
-- bien escrito; no toca una sola tabla. El `case` sin cast de julio sobrevivió a
-- una reescritura entera por eso. Aquí se llaman los cuatro barridos de verdad,
-- que es lo único que resuelve los enums, los casts y los nombres de columna.
--
-- Todo pasa dentro de un subbloque `begin … exception`, que es una
-- subtransacción, y se sale por excepción a propósito: Postgres la revierte
-- entera. Si alguno de los barridos encolara avisos sobre filas REALES de dev,
-- se revierten con el resto — y la siguiente pasada del cron los vuelve a
-- encolar en cinco o diez minutos, que es justo para lo que están.
do $$
declare
  v_n       int;
  v_dest    uuid;
  v_viva    uuid;
  v_estado  public.notification_status;
begin
  begin
    perform public.avisar_reservas_por_expirar(4);
    perform public.avisar_clases_de_manana();
    perform public.avisar_clases_que_empiezan();
    perform public.caducar_notificaciones();

    -- El ensayo de la caducidad, con filas de mentira: que mate lo que caduca y
    -- —mucho más importante— que NO toque lo que no caduca. Un fallo en el
    -- segundo lado se comería recibos sin que nadie lo notara.
    --
    -- Se salta si la base no tiene perfiles: `notifications.recipient_id` es una
    -- FK contra `profiles` y producción está vacía. Saltarlo es correcto;
    -- inventar un perfil para probar no lo sería.
    select id into v_dest from public.profiles limit 1;
    if v_dest is null then
      raise notice 'sin perfiles en esta base: el ensayo de la caducidad se salta.';
    else
      insert into public.notifications
        (recipient_id, type, channel, template, payload, idempotency_key, created_at)
      values
        (v_dest, 'NTF-08', 'email', 'session_starting', '{}'::jsonb,
         'ensayo:caduca:' || gen_random_uuid(), now() - interval '2 hours'),
        (v_dest, 'NTF-11', 'email', 'booking_reminder_24h', '{}'::jsonb,
         'ensayo:caduca:' || gen_random_uuid(), now() - interval '20 hours');

      -- El testigo, en su propio insert y no en el de arriba: un `returning …
      -- into` sobre varias filas se queda con la PRIMERA, no con la última, así
      -- que metido en el mismo values este id sería el del session_starting y la
      -- comprobación de abajo estaría mirando la fila equivocada — pasaría
      -- siempre en verde diciendo lo contrario de lo que cree decir.
      insert into public.notifications
        (recipient_id, type, channel, template, payload, idempotency_key, created_at)
      values
        (v_dest, 'NTF-04', 'email', 'payment_receipt', '{}'::jsonb,
         'ensayo:vive:' || gen_random_uuid(), now() - interval '3 days')
      returning id into v_viva;

      select public.caducar_notificaciones() into v_n;
      if v_n < 2 then
        raise exception 'la caducidad no mató las dos filas caducables, mató %', v_n;
      end if;

      select status into v_estado from public.notifications where id = v_viva;
      if v_estado is distinct from 'pending'::public.notification_status then
        raise exception 'la caducidad se comió un recibo de hace 3 días: quedó en %', v_estado;
      end if;
    end if;

    -- Sale por excepción a propósito: es lo que revierte las filas del ensayo y
    -- cualquier aviso que los barridos hayan encolado sobre datos reales.
    raise exception 'ensayo-ok';
  exception when others then
    if sqlerrm <> 'ensayo-ok' then
      raise;
    end if;
  end;

  raise notice 'Los cuatro barridos corren, caducan lo que caduca y respetan lo que no.';
end $$;
