-- ============================================================================
-- Enséñame Ya — el chat grupal (Fase C §10.2, RG-13)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Un hilo por clase grupal (`conversations.kind = 'group'`, `20261008120100`)
-- con el tutor y los alumnos que PAGARON. Los miembros no se guardan: salen
-- de las reservas, así que quien se da de baja sale solo del hilo y no hay
-- tabla puente (regla 10).
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `puede_ver_conversacion(id)` es LA pregunta de pertenencia: par (alumno o
--   tutor del hilo) o grupo (tutor, o alumno con reserva confirmed /
--   in_progress / completed de esa clase). La usan las políticas de
--   `conversations` y `messages` —también lo que Realtime filtra— y las RPC.
--   SECURITY DEFINER para no depender de la RLS de bookings dentro de una
--   política.
-- · Funciones que REEMPLAZAN a su versión VIVA de dev (`pg_get_functiondef`,
--   9-oct), con los cambios marcados «G ·»:
--     send_conversation_message · las reglas de PAR (MN-06, tope de 5) solo
--                                 en hilos de par
--     mark_conversation_read    · pertenencia por puede_ver_conversacion
--     ensure_conversation_for_booking · crea también el hilo de la clase
--     purge_expired_messages    · ⚠️ ARREGLO: sin `kind = 'pair'`, un hilo
--                                 grupal (alumno NULL → sin reserva del par)
--                                 se borraba a los 30 días aunque la clase
--                                 siguiera. Y RG-13: el grupal se va 30 días
--                                 después de su última fecha (S-G-07)
--     tutor_response_time       · solo pares: con 10 alumnos «no es el tutor»
--                                 deja de significar «el alumno»
-- · NO se tocan aún, y es a propósito:
--     my_conversations  · la bandeja. Añadirle los hilos grupales cambia su
--                         tipo de vuelta (drop + create, regla 12) y lo que
--                         pinta: va con las pantallas de G3.
--     notify_new_message · con alumno NULL ya sale sin avisar a nadie
--                         (`if v_student is null then return`). El aviso
--                         a N miembros va con los correos de G4.
--     report_conversation · un miembro de un grupo aún no puede reportar: G3.
-- · Un alumno de una grupal TAMBIÉN tiene su hilo privado con el tutor: el
--   trigger de reservas lo crea como para cualquier reserva. El plan no lo
--   prohíbe y es lo que pasa con una 1:1. Si el cliente no lo quiere, se
--   quita aquí.
-- ============================================================================

create or replace function public.puede_ver_conversacion(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conversation_id
       and (
         (select auth.uid()) in (c.student_id, c.tutor_id)
         or (c.kind = 'group' and exists (
               select 1 from public.bookings b
                where b.product_id = c.group_product_id
                  and b.student_id = (select auth.uid())
                  and b.status in ('confirmed', 'in_progress', 'completed')))
       )
  )
$$;

comment on function public.puede_ver_conversacion(uuid) is
  'RG-13 · ¿el usuario actual pertenece a este hilo? Par: es su alumno o su tutor. Grupo: es el tutor o tiene una reserva pagada (confirmed / in_progress / completed) de esa clase. Quien se da de baja (cancelled) sale solo.';

revoke execute on function public.puede_ver_conversacion(uuid) from public, anon;
grant  execute on function public.puede_ver_conversacion(uuid) to authenticated, service_role;

-- La clase terminó (o se canceló) hace más de 30 días.
create or replace function public.hilo_grupal_caducado(p_product uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(g.end_at) from public.group_classes g where g.product_id = p_product)
      < now() - interval '30 days',
    false)
$$;

comment on function public.hilo_grupal_caducado(uuid) is
  'RG-13 / S-G-07 · el hilo grupal de esta clase ya se puede borrar: su última fecha (cancelada o no) acabó hace más de 30 días. Sin fechas, nunca.';

revoke execute on function public.hilo_grupal_caducado(uuid) from public, anon, authenticated;

-- ── Políticas: el par de siempre o un miembro del grupo ─────────────────────
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant"
  on public.conversations for select
  using ( (select auth.uid()) in (student_id, tutor_id)
          or (kind = 'group' and public.puede_ver_conversacion(id)) );

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant"
  on public.messages for select
  using ( public.puede_ver_conversacion(conversation_id) );

CREATE OR REPLACE FUNCTION public.send_conversation_message(p_conversation_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := (select auth.uid());
  v_c        record;
  v_body     text := btrim(coalesce(p_body, ''));
  v_msg      uuid;
  v_comprado boolean;
  v_mios     int;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;
  if v_body = '' then
    raise exception 'el mensaje no puede estar vacío' using errcode = 'check_violation';
  end if;

  select id, student_id, tutor_id, blocked_at, kind into v_c
    from public.conversations
   where id = p_conversation_id
     and public.puede_ver_conversacion(id);   -- G · par o miembro del grupo
  if v_c.id is null then
    -- Misma respuesta para "no existe" y "no es tuya": no se confirma la
    -- existencia de conversaciones ajenas.
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  if v_c.blocked_at is not null then
    raise exception 'esta conversación está bloqueada por moderación'
      using errcode = 'check_violation';
  end if;

  -- G · RG-13: en un hilo grupal la pertenencia YA es la puerta (reserva
  -- pagada de esa clase, o ser su tutor). Ni MN-06 ni el tope previo a la
  -- compra tienen sentido ahí: son reglas de un PAR.
  if v_c.kind = 'pair' then
  -- ── MN-06 · LA PUERTA ─────────────────────────────────────────────────────
  -- `pair_can_chat` y NO `pair_has_booking`: aquí entra también `send_message`
  -- cuando el par no ha comprado todavía, y cerrarlo a secas dejaría al alumno
  -- con un checkout a medias leyendo «no tienes mentoría con este tutor» en la
  -- pantalla de su propia reserva.
  --
  -- El mensaje está redactado para que valga a los dos lados: el tutor también
  -- lo puede recibir, y «no tienes mentoría con este tutor» no le diría nada.
  if not public.pair_can_chat(v_c.student_id, v_c.tutor_id) then
    raise exception 'para escribir aquí hace falta una mentoría reservada entre los dos'
      using errcode = 'check_violation';
  end if;

  v_comprado := public.pair_has_booking(v_c.student_id, v_c.tutor_id);

  -- ── EL TOPE, AHORA SIMÉTRICO ──────────────────────────────────────────────
  -- Sin `v_uid = v_c.student_id`: esa condición es justo lo que el cliente
  -- quitó el 28-ago. Ahora cuenta el que escriba, sea quien sea.
  --
  -- `booking_id is null` es lo que hace que esto sea el canal PREVIO: los
  -- mensajes que cuelgan de una reserva son otra conversación y no gastan
  -- cupo. Mismo predicado que usaba el tope de 20 al que sustituye.
  if not v_comprado then
    select count(*) into v_mios
      from public.messages m
     where m.conversation_id = v_c.id
       and m.sender_id = v_uid
       and m.booking_id is null;

    if v_mios >= public.pre_booking_message_cap() then
      -- Dos textos, porque la salida de cada lado es distinta: el alumno
      -- reserva, el tutor espera a que reserven. Un mensaje único obligaría a
      -- redactarlo tan vago que no diría qué hacer.
      if v_uid = v_c.student_id then
        raise exception 'has usado tus % mensajes antes de reservar; reserva una mentoría para seguir hablando con este tutor',
          public.pre_booking_message_cap() using errcode = 'check_violation';
      else
        raise exception 'has usado tus % mensajes antes de la reserva; podrás seguir escribiendo cuando el alumno reserve',
          public.pre_booking_message_cap() using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- `expires_at` explícitamente NULL: decisión (b) de M-12. El `check` de la
  -- tabla no dejaría otra cosa, pero se escribe aquí para que se lea al lado
  -- del motivo.
  end if;  -- G · fin de las reglas de par

  insert into public.messages (conversation_id, booking_id, sender_id, body, expires_at)
  values (v_c.id, null, v_uid, v_body, null)
  returning id into v_msg;

  update public.conversations set last_message_at = now() where id = v_c.id;

  return v_msg;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid  uuid := (select auth.uid());
  v_ok   boolean;
  v_when timestamptz;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select true into v_ok
    from public.conversations
   where id = p_conversation_id
     and public.puede_ver_conversacion(id);   -- G · par o miembro del grupo
  if not coalesce(v_ok, false) then
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  insert into public.conversation_reads (conversation_id, user_id, last_read_at)
  values (p_conversation_id, v_uid, now())
  on conflict (conversation_id, user_id) do update
    -- `greatest` y no `excluded` a secas: dos pestañas (o una petición que se
    -- demora) pueden llegar desordenadas, y una marca vieja pisando a una nueva
    -- resucitaría el contador de mensajes ya leídos. La marca solo avanza.
    set last_read_at = greatest(excluded.last_read_at, conversation_reads.last_read_at)
  returning last_read_at into v_when;

  return v_when;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_conversation_for_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.conversations (student_id, tutor_id)
  values (new.student_id, new.tutor_id)
  on conflict (student_id, tutor_id) do nothing;   -- ya hablaban: es la misma

  -- G · RG-13: el hilo grupal de la clase, uno por producto, nace con su
  -- primera reserva. Vacío no molesta a nadie: solo lo ven los que pagaron.
  if exists (select 1 from public.products p
              where p.id = new.product_id and p.pricing_model = 'group') then
    insert into public.conversations (kind, tutor_id, group_product_id)
    values ('group', new.tutor_id, new.product_id)
    on conflict (group_product_id) where kind = 'group' do nothing;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.purge_expired_messages()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deleted  int;
  v_objects  int;
  v_consultas int;
begin
  -- 1 · MENSAJES DE RESERVA: 30 días desde CADA mensaje. Sin cambios (AB-01
  --     sigue abierto). Los nulos —lo pre-compra— quedan fuera solos.
  with gone as (
    delete from public.messages
     where expires_at < now()
        -- G · RG-13 (S-G-07): los de un hilo grupal, 30 días después de su
        -- última fecha. Se calcula aquí y no en `expires_at`: una reagenda
        -- movería la fecha y dejaría la caducidad escrita mintiendo.
        or conversation_id in (select c.id from public.conversations c
                                where c.kind = 'group'
                                  and public.hilo_grupal_caducado(c.group_product_id))
    returning attachment_path
  ),
  -- ⚠️ ENCOLAR, NO BORRAR. Ver la cabecera: `delete from storage.objects`
  --    está prohibido y tumba la transacción entera, con lo que los MENSAJES
  --    tampoco se borraban. Aquí solo se apunta la ruta; el fichero lo retira
  --    después el job HTTP con la Storage API, que es el único camino que
  --    Supabase admite. `on conflict do nothing` porque la misma ruta puede
  --    reencolarse si un barrido anterior la dejó a medias.
  dropped as (
    insert into public.storage_purge_queue (bucket_id, path)
    select 'chat-attachments', g.attachment_path
      from gone g
     where g.attachment_path is not null
    on conflict (bucket_id, path) do nothing
    returning 1
  )
  select
    (select count(*) from gone),
    (select count(*) from dropped)
  into v_deleted, v_objects;

  -- 2 · CONSULTAS QUE NO LLEGARON A NADA: la conversación entera, de una
  --     pieza, a los 30 días sin actividad y solo si el par NUNCA compró.
  --     El `coalesce` es L1-4: sin él, un hilo abierto y nunca usado
  --     (`last_message_at is null`) era inmortal.
  with idas as (
    delete from public.conversations c
     where (
             -- G · el hilo grupal se va entero con sus mensajes
             (c.kind = 'group' and public.hilo_grupal_caducado(c.group_product_id))
             or (
       c.kind = 'pair'   -- G · sin esto un hilo grupal (sin alumno) caía aquí a los 30 días
       and coalesce(c.last_message_at, c.created_at) < now() - interval '30 days'
       and not public.pair_has_booking(c.student_id, c.tutor_id)
       -- (a) Un hilo bajo moderación no es un hilo abandonado. `blocked_at` y
       --     `blocked_reason` viven SOLO en esta fila —`set_conversation_blocked`
       --     hace un `update` y no copia nada a ninguna auditoría—, así que
       --     borrarla desbloquea al par en silencio: `conversations_pair_unique`
       --     era lo único que impedía duplicar el hilo, y `open_conversation`
       --     devolvería uno nuevo, sin bloqueo y con los contadores anti-spam de
       --     `send_conversation_message` (5 seguidos / 20 totales, que cuentan
       --     `messages` del hilo) a cero. Bloquear a alguien que no ha comprado
       --     tenía, por construcción, fecha de caducidad.
       and c.blocked_at is null
       -- (b) Cinturón: el `coalesce` de arriba se fía de que `last_message_at`
       --     esté al día, y no siempre lo estuvo — el sembrado de M-12 creó las
       --     filas sin rellenarla (lo repara `20260820140000`). Mientras esa
       --     reparación no haya corrido, un hilo CON mensajes reales y
       --     `last_message_at is null` heredaría un `created_at` viejo y se
       --     borraría con sus mensajes por cascada. Esta condición mira los
       --     mensajes de verdad, así que la purga es correcta ANTES y DESPUÉS
       --     del backfill y deja de depender del orden de las migraciones.
       --     Solo puede impedir borrados, nunca provocarlos.
       and not exists (
         select 1
           from public.messages m
          where m.conversation_id = c.id
            and m.created_at >= now() - interval '30 days'
       )
       -- (c) EY-189 · Un hilo con un reporte SIN ATENDER tampoco es un hilo
       --     abandonado: es el siguiente de la cola del admin. Sin esta línea la
       --     bandeja pierde casos sola y nadie se entera — la cascada borra el
       --     reporte y no queda ni el hueco. Se limita a los pendientes a
       --     propósito: cerrado el reporte, la retención de 30 días vuelve a
       --     mandar. Como (a) y (b), solo puede impedir borrados.
       and not exists (
         select 1
           from public.conversation_reports r
          where r.conversation_id = c.id
            and r.handled_at is null
       )
             )
           )
    returning 1
  )
  select count(*) into v_consultas from idas;

  return jsonb_build_object(
    'estado',              'activa',
    'retencion_dias',      30,
    'messages_purged',     v_deleted,
    'attachments_purged',  v_objects,
    -- Consultas previas a la compra que caducaron enteras (M-12). Desde L1-4
    -- también cuenta las que nunca tuvieron un mensaje.
    'consultas_purgadas',  v_consultas
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.tutor_response_time(p_tutor_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Centinela = "no contestó". En minutos, un número que ninguna latencia real
  -- alcanza; se usa para que la mediana pueda caer EN él y delatar al que no
  -- contesta, cosa que un NULL no haría (percentile_cont los ignora).
  c_sin_respuesta constant double precision := 1e9;
  v_muestras int;
  v_mediana  double precision;
begin
  with hilo as (
    select
      m.conversation_id,
      m.created_at,
      m.sender_id,
      lag(m.sender_id) over (partition by m.conversation_id order by m.created_at) as anterior
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where c.tutor_id = p_tutor_id
      and c.kind = 'pair'   -- G · «no es el tutor» = el alumno, solo en un par
      and m.created_at > now() - interval '90 days'
  ),
  preguntas as (
    -- Del alumno (el hilo tiene exactamente dos personas, así que "no es el
    -- tutor" basta) y primera de su ráfaga.
    select conversation_id, created_at
      from hilo
     where sender_id <> p_tutor_id
       and (anterior is null or anterior = p_tutor_id)
  ),
  latencias as (
    select
      q.created_at,
      (select min(extract(epoch from (r.created_at - q.created_at)) / 60)
         from public.messages r
        where r.conversation_id = q.conversation_id
          and r.sender_id       = p_tutor_id
          and r.created_at      > q.created_at) as minutos
    from preguntas q
  ),
  observaciones as (
    select coalesce(l.minutos::double precision, c_sin_respuesta) as minutos
      from latencias l
     -- Sin respuesta pero reciente: el reloj sigue corriendo, no se juzga.
     -- (El `l.` no es adorno: en el `where` manda la columna de origen, no el
     -- alias de la línea de arriba, y sin prefijo se lee al revés de lo que
     -- hace.)
     where l.minutos is not null
        or l.created_at < now() - interval '14 days'
  )
  select count(*), percentile_cont(0.5) within group (order by o.minutos)
    into v_muestras, v_mediana
    from observaciones o;

  if coalesce(v_muestras, 0) < 5 then
    return null;                       -- muestra insuficiente: no se inventa
  end if;
  if v_mediana >= c_sin_respuesta then
    return null;                       -- más de la mitad sin contestar
  end if;

  -- Mínimo un minuto: un "responde en 0 minutos" se lee como un error.
  return greatest(1, ceil(v_mediana))::integer;
end;
$function$;

