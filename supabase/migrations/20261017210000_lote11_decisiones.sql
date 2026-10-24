-- ============================================================================
-- Enséñame Ya — Lote 11 del sondeo de grupales · las decisiones del 17-oct
-- (M8, M7′, M2, P27, M14 · docs/SONDEO-GRUPALES-LOTES.md, «Lote 11»)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Seis hallazgos esperaban una decisión de producto (regla de oro 8). Jose las
-- tomó el 17-oct; esta migración es la parte de base de datos de cinco de
-- ellas (A5 y M30 son solo de la sala, sin SQL):
--
--   M7′ · (nació en el lote 2, sub-nota de M7 en el 3) El alumno que el tutor
--         saca a mitad de ciclo (M1) queda con la reserva `completed` y seguía
--         dentro del chat del grupo, porque `puede_ver_conversacion` admite
--         `completed`. Decisión: sale del chat, igual que de la sala (M2).
--   M8  · (lote 3) La tutora recibía un hilo privado vacío por cada inscrito de
--         cada clase. Decisión: el chat privado se mantiene, pero a la tutora
--         no se le muestran los hilos de par SIN mensajes cuyo único vínculo
--         con el alumno son reservas grupales. En cuanto alguien escribe, sale.
--   M2  · (lote 4) «Sacar de la sala» no persistía: el alumno volvía a entrar
--         con un clic. Decisión: no vuelve en ESA fecha; en las siguientes sí.
--   P27 · (lote 3) El tutor no podía compartir material con el grupo.
--         Decisión: adjuntos en el chat del grupo, solo el tutor; una carpeta
--         de Storage por producto que leen solo los miembros.
--   M14 · (lote 6) Si el tutor reagenda una fecha de un ciclo YA empezado,
--         NTF-54 prometía «puedes cancelar con el 100 %» y el sistema rechaza
--         esa baja (RG-16). Decisión: el alumno puede renunciar a ESA fecha y
--         recuperar su parte, round(gross / N), sin darse de baja del ciclo.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Funciones que REEMPLAZAN a su versión vigente, con los cambios marcados
--   «L11 ·». El cuerpo vivo de dev (`pg_get_functiondef`, 17-oct) coincide con
--   el del repo en las cinco: nadie las redefinió en la otra rama.
--     puede_ver_conversacion       · 20261009110000:44   (M7′)
--     my_conversations             · 20261017130000:68   (M8)
--     join_group_class             · 20261017140000:47   (M2)
--     avisar_cambio_de_fecha_grupal· 20261017160000:267  (M14)
--   Ninguna cambia firma ni tipo de vuelta → `create or replace` (la regla 12
--   no aplica). Se reponen comment y grants igualmente.
-- · Nuevas: `sacado_del_grupo` (PRIVADA), `expulsar_de_clase_grupal`,
--   `send_group_attachment` y `renunciar_fecha_grupal`. Tabla nueva:
--   `group_class_expulsiones` (RLS + grants, también a service_role: regla 9).
--   Columna nueva: `sessions.renunciada_at`.
-- · M7′ · «sacado» se deduce de las sesiones, sin columna nueva: sesión de la
--   reserva cancelada SIN `renunciada_at` cuya fecha (group_class) sigue viva.
--   Es exactamente el rastro de M1 (cancel_booking por tramos cancela las
--   sesiones futuras y la clase sigue). `cancelar_fecha_grupal` cancela la
--   group_class, así que esa no cuenta; la renuncia de M14 se distingue por
--   `renunciada_at`; la baja entera deja la reserva `cancelled`, que ya no
--   pasaba la puerta. `reserva_tras_salir_del_grupo` (P12) no cambia: en
--   cuanto `puede_ver_conversacion` da false, devuelve la reserva y la
--   pantalla pinta «Ya no formas parte de este grupo». Las políticas de
--   `conversations`, `messages` y Realtime cuelgan de la misma función, y la
--   SELECT nueva del bucket (P27) también: el sacado deja de leer los
--   adjuntos del grupo a la vez.
-- · P27 · cuarta cerradura en `messages_adjunto_requiere_reserva`: un adjunto
--   sin reserva solo puede vivir bajo `grupo/`. Las dos políticas viejas del
--   bucket (carpeta = id de reserva) no se tocan. Sin DELETE, como las de par.
--   La purga (`purge_expired_messages`, rama de grupo) ya encola
--   `attachment_path` para el borrado por la Storage API: no se toca.
-- · M14 · misma fórmula ACUMULADA que `cancelar_fecha_grupal` (20261008230100)
--   y M1: target = round(gross · k / N), con k las sesiones canceladas de la
--   reserva. Las tres cuadran entre sí y la suma de tramos nunca pasa de
--   gross. Clave idempotente 'M14:session:<id>:payment:<id>'.
--   `reembolsar_con_credito(uuid, bigint, bigint, text, text)` es la de
--   20260912110000:900 (cuerpo vivo idéntico).
-- · Ningún cambio toca una función de pg_cron.
-- ============================================================================


-- ── 0 · M14 · la marca de la renuncia ──────────────────────────────────────
alter table public.sessions
  add column if not exists renunciada_at timestamptz;

comment on column public.sessions.renunciada_at is
  'M14 · el alumno renunció a esta fecha porque el tutor la reagendó con el ciclo ya empezado. Distingue esta cancelación de la de M1 (sacado del ciclo).';


-- ── 1 · M7′ · el sacado a mitad de ciclo sale del chat del grupo ───────────
-- Privada: no mira `auth.uid()` y responde por cualquier reserva. Sus únicos
-- llamantes son DEFINER (puede_ver_conversacion), así que no necesita grants.
-- La marca se PERSISTE: deducirla de las sesiones («cancelada con la fecha
-- viva») se borraba sola si el tutor cancelaba después esa fecha, y el sacado
-- volvía al chat. La escribe la rama de tramos de cancel_booking (abajo).
alter table public.bookings add column if not exists sacado_at timestamptz;
comment on column public.bookings.sacado_at is
  'L11 · M7′ · cuándo el tutor (o el admin) sacó a este alumno de un ciclo ya empezado (M1, rama de tramos de cancel_booking). Con valor, deja el chat del grupo y sus avisos.';

create or replace function public.sacado_del_grupo(p_booking uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b where b.id = p_booking and b.sacado_at is not null
  )
$$;

comment on function public.sacado_del_grupo(uuid) is
  'L11 · M7′ · ¿el tutor (o el admin) sacó esta reserva grupal a mitad de ciclo (M1)? Lee bookings.sacado_at, que escribe cancel_booking por tramos. No cuentan las fechas canceladas ni las renuncias de M14. PRIVADA: no mira auth.uid().';

revoke execute on function public.sacado_del_grupo(uuid) from public, anon, authenticated;

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
                  and b.status in ('confirmed', 'in_progress', 'completed')
                  -- L11 · M7′ · el sacado a mitad de ciclo queda `completed`,
                  -- pero ya no es del grupo.
                  and not public.sacado_del_grupo(b.id)))
       )
  )
$$;

comment on function public.puede_ver_conversacion(uuid) is
  'RG-13 · ¿el usuario actual pertenece a este hilo? Par: es su alumno o su tutor. Grupo: es el tutor o tiene una reserva pagada (confirmed / in_progress / completed) de esa clase. Quien se da de baja (cancelled) sale solo. L11 · M7′: tampoco el alumno que el tutor sacó a mitad de ciclo (sacado_del_grupo).';

revoke execute on function public.puede_ver_conversacion(uuid) from public, anon;
grant  execute on function public.puede_ver_conversacion(uuid) to authenticated, service_role;


-- ── 2 · M8 · la bandeja de la tutora sin los hilos vacíos de las grupales ──
create or replace function public.my_conversations()
returns table (
  id                 uuid,
  other_id           uuid,
  other_name         text,
  other_avatar_path  text,
  other_is_tutor     boolean,
  last_message_at    timestamptz,
  has_booking        boolean,
  can_chat           boolean,
  product_count      integer,
  session_count      integer,
  blocked_at         timestamptz,
  last_booking_id    uuid,
  last_product_title text,
  kind               text,   -- L3 · 'pair' | 'group'
  group_product_id   uuid    -- L3 · la clase del hilo de grupo; null en un par
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.other_id, t.other_name, t.other_avatar_path, t.other_is_tutor,
    t.last_message_at, t.has_booking, t.can_chat, t.product_count,
    t.session_count, t.blocked_at, t.last_booking_id, t.last_product_title,
    t.kind, t.group_product_id
  from (
    select
      c.id,
      case when c.student_id = (select auth.uid()) then c.tutor_id else c.student_id end as other_id,
      -- El nombre del tutor sale de `tutor_profiles.display_name` (la copia
      -- publicable, DD-01) y el del alumno de `profiles.full_name`. Son dos
      -- caminos distintos porque son dos datos distintos: uno es público de
      -- catálogo y el otro es privado y solo lo ve quien comparte hilo.
      case when c.student_id = (select auth.uid())
           then (select tp.display_name from public.tutor_profiles tp where tp.profile_id = c.tutor_id)
           else (select p.full_name     from public.profiles       p  where p.id         = c.student_id)
      end as other_name,
      case when c.student_id = (select auth.uid())
           then (select tp.avatar_path from public.tutor_profiles tp where tp.profile_id = c.tutor_id)
           else (select p.avatar_path  from public.profiles       p  where p.id         = c.student_id)
      end as other_avatar_path,
      c.student_id = (select auth.uid()) as other_is_tutor,
      c.last_message_at,
      -- `has_booking` sale del MISMO agregado que los dos recuentos
      -- (`pair_booking_stats`): es el resultado idéntico con una llamada por fila
      -- en vez de dos, y garantiza que «tiene reserva» y «tiene 2 mentorías» no
      -- puedan contradecirse.
      st.has_booking,
      -- MN-06 · la misma función que rechaza en el servidor. Si algún día las dos
      -- respuestas se separan, la culpa será de haber escrito el criterio dos
      -- veces — por eso aquí no se escribe, se llama.
      public.pair_can_chat(c.student_id, c.tutor_id) as can_chat,
      st.product_count,
      st.session_count,
      c.blocked_at,
      ultima.id    as last_booking_id,
      ultima.title as last_product_title,
      'pair'::text as kind,
      null::uuid   as group_product_id,
      c.created_at
    from public.conversations c
    left join lateral (
      select b.id, pr.title
        from public.bookings b
        join public.products pr on pr.id = b.product_id
       where b.student_id = c.student_id
         and b.tutor_id   = c.tutor_id
       order by b.created_at desc
       limit 1
    ) ultima on true
    -- Lateral hermano del de arriba (MN-08). Siempre devuelve exactamente una
    -- fila —es un agregado sin `group by`—, así que el `left join` nunca añade
    -- nulos y `has_booking` sigue sin poder ser null.
    left join lateral public.pair_booking_stats(c.student_id, c.tutor_id) st on true
    -- El filtro de participación, a mano y explícito: es DEFINER, así que la RLS
    -- de `conversations` no está mirando. Es LA línea que no se puede tocar.
    -- L3 · B3: solo pares. Sin esto el hilo del grupo (alumno NULL) le salía al
    -- tutor como un par con «tu alumno».
    where c.kind = 'pair'
      and (select auth.uid()) in (c.student_id, c.tutor_id)
      -- L11 · M8 · al TUTOR no se le enseña el hilo privado vacío de un alumno
      -- que solo tiene grupales con él: 10 inscritos eran 10 hilos en blanco.
      -- Se miran los mensajes, no `last_message_at`: la bandeja depende del
      -- dato real. En cuanto alguien escribe, aparece. Con alguna reserva 1:1
      -- del par no cambia nada, y al alumno tampoco.
      and not (
        c.tutor_id = (select auth.uid())
        and not exists (select 1 from public.messages m where m.conversation_id = c.id)
        and exists (select 1 from public.bookings b
                     where b.student_id = c.student_id and b.tutor_id = c.tutor_id
                       and b.pricing_model = 'group')
        and not exists (select 1 from public.bookings b
                         where b.student_id = c.student_id and b.tutor_id = c.tutor_id
                           and b.pricing_model <> 'group')
      )

    union all

    -- L3 · B4: el hilo de cada clase grupal, con su título como nombre.
    select
      c.id,
      c.tutor_id,
      pr.title,
      (select tp.avatar_path from public.tutor_profiles tp where tp.profile_id = c.tutor_id),
      c.tutor_id <> (select auth.uid()),
      c.last_message_at,
      -- La pertenencia YA es la puerta (RG-13): ni MN-06 ni los recuentos del
      -- par significan nada con 10 alumnos.
      true,
      true,
      0,
      0,
      c.blocked_at,
      mia.id,
      pr.title,
      'group'::text,
      c.group_product_id,
      c.created_at
    from public.conversations c
    left join public.products pr on pr.id = c.group_product_id
    -- La reserva pagada del que mira, para el enlace «Ver mi reserva». El tutor
    -- no tiene: null.
    left join lateral (
      select b.id
        from public.bookings b
       where b.product_id = c.group_product_id
         and b.student_id = (select auth.uid())
         and b.status in ('confirmed', 'in_progress', 'completed')
       order by b.created_at desc
       limit 1
    ) mia on true
    -- LA línea de participación del grupo, explícita por lo mismo de arriba.
    -- L3 · P29: y solo con al menos un pago. El hilo nace con el apartado; sin
    -- un solo inscrito pagado el tutor no tiene con quién hablar.
    where c.kind = 'group'
      and public.puede_ver_conversacion(c.id)
      and exists (
        select 1 from public.bookings b
         where b.product_id = c.group_product_id
           and b.status in ('confirmed', 'in_progress', 'completed'))
  ) t
  order by t.last_message_at desc nulls last, t.created_at desc;
$$;

comment on function public.my_conversations() is
  'M-12 + MN-08 + MN-06 + L3 + L11: la bandeja. Por cada hilo del usuario, con quién habla (nombre y foto), si ya hubo compra (`has_booking`), si se puede escribir (`can_chat`, que añade el checkout en curso), cuántas mentorías (`product_count`) y cuántas clases (`session_count`) hay detrás, y de qué mentoría fue la última reserva. Con `kind` = ''group'' (L3, B3/B4) es el hilo de una clase grupal: `other_name` es el título de la clase, `other_id` el tutor, `has_booking` = `can_chat` = true, recuentos a 0 y `last_booking_id` la reserva pagada del que mira (null para el tutor); solo sale si la clase tiene al menos una reserva pagada (P29). L11 · M8: al tutor no le salen los hilos de par sin ningún mensaje cuyo único vínculo con el alumno son reservas grupales; en cuanto alguien escribe, aparecen. L11 · M7′: el alumno sacado a mitad de ciclo ya no ve el hilo del grupo (puede_ver_conversacion). SECURITY DEFINER acotada por participación en la conversación (par: alumno o tutor; grupo: `puede_ver_conversacion`).';

revoke execute on function public.my_conversations() from public;
revoke execute on function public.my_conversations() from anon;
grant  execute on function public.my_conversations() to authenticated;


-- ── 3 · M2 · sacar de la sala, y que no vuelva en esa fecha ─────────────────
create table if not exists public.group_class_expulsiones (
  id              uuid primary key default gen_random_uuid(),
  group_class_id  uuid not null references public.group_classes(id) on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  expulsado_por   uuid references public.profiles(id) on delete set null,
  motivo          text check (motivo is null or char_length(motivo) <= 500),
  created_at      timestamptz not null default now(),
  unique (group_class_id, student_id)
);

comment on table public.group_class_expulsiones is
  'L11 · M2 · alumnos que el tutor (o el admin) sacó de la sala de UNA fecha grupal. join_group_class los rechaza en esa fecha; en las siguientes del ciclo entran. Se escribe solo por expulsar_de_clase_grupal (sin políticas de escritura).';
comment on column public.group_class_expulsiones.group_class_id is
  'La fecha (group_classes) de la que se le sacó. Solo esa: no es una baja del ciclo.';
comment on column public.group_class_expulsiones.student_id is
  'El alumno sacado: su user_id, el mismo que lleva su participante en Daily.';
comment on column public.group_class_expulsiones.expulsado_por is
  'Quién lo sacó (el tutor de la fecha o un admin). Null si esa cuenta ya no existe.';
comment on column public.group_class_expulsiones.motivo is
  'Opcional, hasta 500 caracteres. Lo escribe quien saca; lo ven el alumno, el tutor y el admin.';

alter table public.group_class_expulsiones enable row level security;

drop policy if exists "group_class_expulsiones_select" on public.group_class_expulsiones;
create policy "group_class_expulsiones_select"
  on public.group_class_expulsiones for select
  using (
    (select auth.uid()) = student_id
    or exists (select 1 from public.group_classes g
                where g.id = group_class_id and g.tutor_id = (select auth.uid()))
    or public.has_role('admin')
  );

-- Sin políticas de escritura, a propósito: solo la RPC (DEFINER).
grant select on public.group_class_expulsiones to authenticated;
grant all    on public.group_class_expulsiones to service_role;

create or replace function public.expulsar_de_clase_grupal(
  p_group_class uuid,
  p_student     uuid,
  p_motivo      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_gc  record;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select g.id, g.tutor_id, g.status, g.start_at, g.end_at into v_gc
    from public.group_classes g where g.id = p_group_class;
  if v_gc.id is null
     or (v_uid is distinct from v_gc.tutor_id and not public.has_role('admin')) then
    raise exception 'no puedes sacar a nadie de esta clase' using errcode = '42501';
  end if;

  if p_student is null or p_student = v_gc.tutor_id then
    raise exception 'ese alumno no está en esta clase' using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.sessions s
                  where s.group_class_id = v_gc.id and s.student_id = p_student) then
    raise exception 'ese alumno no está en esta clase' using errcode = 'no_data_found';
  end if;

  -- Solo desde la sala abierta: por adelantado, «sacar» de fechas futuras
  -- dejaba al alumno sin clase y sin reembolso (M1 sí devuelve el tramo).
  if v_gc.status <> 'scheduled'
     or not (public.session_access_window(v_gc.start_at, v_gc.end_at) @> now()) then
    raise exception 'esa fecha no está en curso' using errcode = 'check_violation';
  end if;

  insert into public.group_class_expulsiones (group_class_id, student_id, expulsado_por, motivo)
  values (v_gc.id, p_student, v_uid, nullif(left(btrim(coalesce(p_motivo, '')), 500), ''))
  on conflict (group_class_id, student_id) do nothing;
end;
$$;

comment on function public.expulsar_de_clase_grupal(uuid, uuid, text) is
  'L11 · M2 · el tutor de la fecha (o un admin) saca a un alumno de la sala de ESA fecha: join_group_class lo rechaza hasta que acabe; en las siguientes del ciclo entra. p_student es el user_id del alumno (el de su participante en Daily). Idempotente. No toca reserva ni dinero.';

revoke execute on function public.expulsar_de_clase_grupal(uuid, uuid, text) from public, anon;
grant  execute on function public.expulsar_de_clase_grupal(uuid, uuid, text) to authenticated;

create or replace function public.join_group_class(p_group_class uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_gc      record;
  v_sess    record;
  v_booking public.booking_status;
  v_es_tutor boolean;
  v_room    text;
  v_win     tstzrange;
  v_nombre  text;   -- Lote 4 · B10
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select g.id, g.tutor_id, g.status, g.start_at, g.end_at, g.daily_room_name, p.capacity
    into v_gc
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.id = p_group_class;
  if v_gc.id is null then
    raise exception 'clase no encontrada' using errcode = 'no_data_found';
  end if;

  v_es_tutor := (v_gc.tutor_id = v_uid);

  -- Lote 4 · B10 · el nombre que verán los demás en la sala. El del alumno va
  -- enmascarado como en el chat (RG-19: «Mariana X.»); el del tutor, el
  -- público de su ficha.
  if v_es_tutor then
    select coalesce(nullif(btrim(tp.display_name), ''), p.full_name) into v_nombre
      from public.profiles p
      left join public.tutor_profiles tp on tp.profile_id = p.id
     where p.id = v_uid;
  else
    select public.mask_person_name(p.full_name) into v_nombre
      from public.profiles p
     where p.id = v_uid;
  end if;

  if not v_es_tutor then
    -- El alumno entra con SU sesión de esa fecha.
    -- G3 · con un hold abandonado hay más de una sesión por fecha: manda la
    -- de la reserva viva (ver la cabecera).
    select s.id, s.booking_id, s.status into v_sess
      from public.sessions s
      join public.bookings b on b.id = s.booking_id
     where s.group_class_id = v_gc.id and s.student_id = v_uid
     order by (b.status in ('confirmed', 'in_progress', 'completed')) desc,
              (s.status <> 'cancelled') desc
     limit 1;
    if v_sess.id is null then
      raise exception 'clase no encontrada' using errcode = 'no_data_found';
    end if;
    -- L11 · M2 · el tutor lo sacó de la sala en ESTA fecha: no vuelve a entrar
    -- hasta la siguiente.
    if exists (select 1 from public.group_class_expulsiones e
                where e.group_class_id = v_gc.id and e.student_id = v_uid) then
      raise exception 'El tutor te sacó de la sala en esta fecha. En las siguientes fechas del ciclo sí puedes entrar.'
        using errcode = 'check_violation';
    end if;
    select status into v_booking from public.bookings where id = v_sess.booking_id;
    if v_booking not in ('confirmed', 'in_progress', 'completed') then
      raise exception 'la reserva no está activa (%).', v_booking using errcode = 'check_violation';
    end if;
    if v_sess.status in ('cancelled', 'completed', 'no_show') then
      raise exception 'esta sesión ya está cerrada' using errcode = 'check_violation';
    end if;
  end if;

  if v_gc.status <> 'scheduled' then
    raise exception 'esta clase ya está cerrada' using errcode = 'check_violation';
  end if;

  v_win := public.session_access_window(v_gc.start_at, v_gc.end_at);
  if not (v_win @> now()) then
    raise exception 'fuera de la ventana de acceso' using errcode = 'check_violation';
  end if;

  v_room := 'eyg-' || replace(v_gc.id::text, '-', '');
  if v_gc.daily_room_name is distinct from v_room then
    update public.group_classes set daily_room_name = v_room where id = v_gc.id;
  end if;

  -- Ciclo M5, solo si esto ES la clase (misma razón que join_session).
  if not v_es_tutor and public.session_live_window(v_gc.start_at, v_gc.end_at) @> now() then
    if v_sess.status = 'scheduled' then
      update public.sessions set status = 'in_progress' where id = v_sess.id;
    end if;
    if v_booking = 'confirmed' then
      update public.bookings set status = 'in_progress' where id = v_sess.booking_id;
    end if;
  end if;

  return jsonb_build_object(
    'room_name',        v_room,
    'is_tutor',         v_es_tutor,
    'starts_at',        v_gc.start_at,
    'ends_at',          v_gc.end_at,
    'closes_at',        upper(v_win),
    -- Lote 4 · M6 · el cupo, el tutor y 3 de margen para una segunda pestaña
    -- o una reconexión.
    'max_participants', v_gc.capacity + 4,
    -- Lote 4 · B10 · quién entra y con qué nombre lo verán los demás.
    'user_id',          v_uid,
    'user_name',        coalesce(v_nombre, case when v_es_tutor then 'Tutor' else 'Alumno' end)
  );
end;
$$;

comment on function public.join_group_class(uuid) is
  'RG-12 · autoriza la entrada a la sala compartida de una fecha grupal: el tutor (anfitrión, is_tutor) o un alumno con su sesión de esa fecha y reserva pagada. Ventana session_access_window; ciclo M5 del alumno solo dentro de session_live_window. Escribe y devuelve la sala ''eyg-<id>''. Sin token: lo firma el Route Handler (G3). Lote 4: devuelve user_id y user_name —el alumno con el nombre enmascarado de mask_person_name (RG-19, B10); el tutor con su display_name o, si falta, full_name; nunca null— y max_participants = capacidad + 4 (el cupo, el tutor y 3 de margen para otra pestaña o una reconexión, M6). L11 · M2: rechaza al alumno que el tutor sacó de la sala en ESA fecha (group_class_expulsiones); en las siguientes entra.';

revoke execute on function public.join_group_class(uuid) from public, anon;
grant  execute on function public.join_group_class(uuid) to authenticated;


-- ── 4 · P27 · adjuntos en el chat del grupo, solo el tutor ──────────────────
-- (a) La cuarta cerradura: sin reserva no hay adjunto, SALVO en la carpeta del
--     grupo. La ruta la valida send_group_attachment contra el producto del hilo.
alter table public.messages
  drop constraint if exists messages_adjunto_requiere_reserva,
  add constraint messages_adjunto_requiere_reserva
    check (attachment_path is null or booking_id is not null or attachment_path like 'grupo/%');

comment on constraint messages_adjunto_requiere_reserva on public.messages is
  'Decisión (c) de M-12: un adjunto cuelga de una reserva (carpeta = id de reserva). L11 · P27, cuarta cerradura: o vive en grupo/<group_product_id>/, la carpeta del chat de una clase grupal, donde solo el tutor sube (send_group_attachment y la política de Storage).';

-- (b) La carpeta del grupo: `grupo/<group_product_id>/<uuid>-<nombre>`. Sube
--     solo el tutor del hilo; lee cualquier miembro (puede_ver_conversacion,
--     que ya saca a quien se dio de baja y al sacado a mitad de ciclo).
drop policy if exists "chat_attachments_insert_tutor_grupo" on storage.objects;
create policy "chat_attachments_insert_tutor_grupo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = 'grupo'
    and exists (
      select 1 from public.conversations c
       where c.kind = 'group'
         and c.group_product_id::text = (storage.foldername(name))[2]
         and c.tutor_id = (select auth.uid())
    )
  );

drop policy if exists "chat_attachments_select_miembro_grupo" on storage.objects;
create policy "chat_attachments_select_miembro_grupo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] = 'grupo'
    and exists (
      select 1 from public.conversations c
       where c.kind = 'group'
         and c.group_product_id::text = (storage.foldername(name))[2]
         and public.puede_ver_conversacion(c.id)
    )
  );
-- Sin DELETE, como las de par: un adjunto enviado no se retira del hilo de los
-- demás. La purga va por storage_purge_queue + la Storage API.

-- (c) El mensaje con el adjunto. Modelo: la rama de grupo de
--     send_conversation_message (20261009110000) y la validación del adjunto
--     de send_message (20260817210000).
create or replace function public.send_group_attachment(
  p_conversation_id uuid,
  p_attachment_path text,
  p_attachment_name text,
  p_attachment_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_c    record;
  v_name text := btrim(coalesce(p_attachment_name, ''));
  v_msg  uuid;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select id, tutor_id, blocked_at, group_product_id into v_c
    from public.conversations
   where id = p_conversation_id
     and kind = 'group'
     and public.puede_ver_conversacion(id);
  if v_c.id is null then
    -- Misma respuesta para "no existe" y "no es tuya": no se confirma la
    -- existencia de conversaciones ajenas.
    raise exception 'conversación no encontrada' using errcode = 'no_data_found';
  end if;

  -- P27 · decisión del 17-oct: en el grupo comparte archivos solo el tutor.
  if v_uid is distinct from v_c.tutor_id then
    raise exception 'En el chat del grupo solo el tutor puede compartir archivos.'
      using errcode = '42501';
  end if;

  if v_c.blocked_at is not null then
    raise exception 'esta conversación está bloqueada por moderación'
      using errcode = 'check_violation';
  end if;

  -- El adjunto tiene que vivir en la carpeta de ESTA clase: si no, el tutor
  -- podría colgar aquí la ruta de otra clase suya y filtrarla a este grupo.
  if p_attachment_path is null
     or p_attachment_path not like 'grupo/' || v_c.group_product_id::text || '/%' then
    raise exception 'el adjunto no pertenece a esta clase' using errcode = 'check_violation';
  end if;
  if v_name = '' or coalesce(p_attachment_size, 0) <= 0 then
    raise exception 'adjunto incompleto' using errcode = 'check_violation';
  end if;

  -- Acuerdo 17-jul: prefijo para separar lo del chat del material inicial.
  -- Idempotente: reenviar un nombre ya prefijado no lo duplica.
  if v_name not like 'chat\_%' then
    v_name := 'chat_' || v_name;
  end if;

  -- Sin reserva y sin caducidad propia, como todo mensaje del grupo: lo borra
  -- purge_expired_messages 30 días después de la última fecha (RG-13), y
  -- encola el fichero. Cumple messages_caducidad_por_reserva y la cuarta
  -- cerradura de messages_adjunto_requiere_reserva.
  insert into public.messages
    (conversation_id, booking_id, sender_id, body,
     attachment_path, attachment_name, attachment_size, expires_at)
  values
    (v_c.id, null, v_uid, '',
     p_attachment_path, v_name, p_attachment_size, null)
  returning id into v_msg;

  update public.conversations set last_message_at = now() where id = v_c.id;

  return v_msg;
end;
$$;

comment on function public.send_group_attachment(uuid, text, text, bigint) is
  'L11 · P27 · el tutor comparte un archivo en el chat de su clase grupal. Ruta en chat-attachments: grupo/<group_product_id>/<uuid>-<nombre>, validada contra el producto del hilo. Solo el tutor (el alumno recibe «En el chat del grupo solo el tutor puede compartir archivos.»); lo leen los miembros (puede_ver_conversacion). Mensaje sin reserva ni caducidad propia; avisa el trigger NTF-21 como cualquier mensaje del grupo.';

revoke execute on function public.send_group_attachment(uuid, text, text, bigint) from public, anon;
grant  execute on function public.send_group_attachment(uuid, text, text, bigint) to authenticated;


-- ── 5 · M14 · renunciar a una fecha reagendada con el ciclo empezado ────────
-- (a) La RPC.
create or replace function public.renunciar_fecha_grupal(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_booking uuid;
  v_s       record;
  v_pay     record;
  v_k       int;
  v_prev    bigint := 0;
  v_target  bigint := 0;
  v_delta   bigint := 0;
  v_reparto jsonb  := jsonb_build_object('cash', 0, 'credit', 0, 'credito_perdido', 0);
  v_estado  text;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select s.booking_id into v_booking
    from public.sessions s where s.id = p_session and s.student_id = v_uid;
  if v_booking is null then
    raise exception 'fecha no encontrada' using errcode = 'no_data_found';
  end if;

  -- El pago se bloquea ANTES que la reserva, en el mismo orden que
  -- cancel_booking: así dos movimientos de la misma reserva se ponen en fila
  -- sin cruzarse, y lo ya devuelto no cambia entre el cálculo y el update.
  perform 1 from public.payments where booking_id = v_booking for update;

  select s.id, s.status, s.start_at, s.group_class_id, s.student_id,
         b.id as booking_id, b.status as booking_status, b.created_at as booking_created_at,
         b.num_sessions, b.currency,
         g.status as gc_status, g.rescheduled_at
    into v_s
    from public.sessions s
    join public.bookings b on b.id = s.booking_id
    left join public.group_classes g on g.id = s.group_class_id
   where s.id = p_session
   for update of s, b;

  if v_s.id is null or v_s.student_id is distinct from v_uid then
    raise exception 'fecha no encontrada' using errcode = 'no_data_found';
  end if;
  if v_s.group_class_id is null then
    raise exception 'solo puedes renunciar a una fecha de una clase grupal' using errcode = 'check_violation';
  end if;
  if v_s.status <> 'scheduled' or v_s.start_at <= now() then
    raise exception 'esa fecha ya empezó o ya no está activa' using errcode = 'check_violation';
  end if;
  if v_s.booking_status not in ('confirmed', 'in_progress') then
    raise exception 'tu inscripción ya no está activa' using errcode = 'check_violation';
  end if;
  if v_s.gc_status <> 'scheduled' then
    raise exception 'esa fecha ya empezó o ya no está activa' using errcode = 'check_violation';
  end if;
  if v_s.rescheduled_at is null or v_s.rescheduled_at <= v_s.booking_created_at then
    raise exception 'solo puedes renunciar a una fecha que el tutor cambió después de tu inscripción'
      using errcode = 'check_violation';
  end if;
  -- Con el ciclo sin empezar, la salida es la baja entera al 100 % (RG-11),
  -- no esta.
  if not exists (select 1 from public.sessions s
                  where s.booking_id = v_s.booking_id and s.group_class_id is not null
                    and s.status <> 'cancelled' and s.start_at <= now()) then
    raise exception 'el ciclo todavía no empezó: puedes darte de baja de la clase completa'
      using errcode = 'check_violation';
  end if;

  update public.sessions
     set status = 'cancelled', cancelled_at = now(), renunciada_at = now()
   where id = v_s.id;

  -- Tramo acumulado, el mismo de cancelar_fecha_grupal y de M1: con k fechas
  -- caídas, round(gross · k / N). La suma de los tramos es gross exacto.
  select count(*) into v_k from public.sessions s
   where s.booking_id = v_s.booking_id and s.group_class_id is not null and s.status = 'cancelled';

  select p.id, p.status, p.gross_amount, p.currency, coalesce(p.refunded_amount, 0) as refunded_amount
    into v_pay
    from public.payments p where p.booking_id = v_s.booking_id;

  if v_pay.status in ('paid', 'partially_refunded') then
    v_prev   := v_pay.refunded_amount;
    v_target := greatest(round(v_pay.gross_amount * v_k::numeric / greatest(v_s.num_sessions, 1)),
                         v_prev);
    v_delta  := v_target - v_prev;

    if v_delta > 0 then
      update public.payments
         set refunded_amount = v_target,
             status = (case when v_target >= v_pay.gross_amount then 'refunded'
                            else 'partially_refunded' end)::public.payment_status
       where id = v_pay.id;

      -- `p_ya_devuelto` es lo de ANTES: el update de encima ya movió la fila.
      v_reparto := public.reembolsar_con_credito(
        v_pay.id, v_delta, v_prev,
        'M14 · el alumno renuncia a una fecha reagendada',
        'M14:session:' || v_s.id || ':payment:' || v_pay.id
      );
    end if;
  end if;

  -- Sin nada por delante, la reserva terminó (misma condición que
  -- cancelar_fecha_grupal y M1; close_expired_sessions no la vería nunca).
  if not exists (select 1 from public.sessions s
                  where s.booking_id = v_s.booking_id and s.status in ('scheduled', 'in_progress')) then
    update public.bookings
       set status = 'completed', completed_at = now()
     where id = v_s.booking_id and status in ('confirmed', 'in_progress');
  end if;

  select b.status::text into v_estado from public.bookings b where b.id = v_s.booking_id;

  -- `refund_amount` es lo devuelto AHORA (no el acumulado, al revés que
  -- cancel_booking): es una fecha, y la pantalla dice «te devolvemos X».
  return jsonb_build_object(
    'refund_amount',         v_delta,
    'refund_cash',           coalesce((v_reparto ->> 'cash')::bigint, 0),
    'refund_credit',         coalesce((v_reparto ->> 'credit')::bigint, 0),
    'refund_credit_perdido', coalesce((v_reparto ->> 'credito_perdido')::bigint, 0),
    'moneda',                coalesce(v_pay.currency, v_s.currency),
    'booking_status',        v_estado
  );
end;
$$;

comment on function public.renunciar_fecha_grupal(uuid) is
  'L11 · M14 · el alumno renuncia a UNA fecha que el tutor reagendó después de su inscripción, con el ciclo ya empezado (la baja entera no se permite, RG-16). Cancela su sesión (renunciada_at, que la distingue del sacado de M1) y devuelve el tramo con la fórmula acumulada de cancelar_fecha_grupal: round(gross · k / N), repartido entre tarjeta y crédito por reembolsar_con_credito, clave M14:session:<id>:payment:<id>. Sin fechas por delante, la reserva se completa. Devuelve { refund_amount (lo devuelto ahora), refund_cash, refund_credit, refund_credit_perdido, moneda, booking_status }.';

revoke execute on function public.renunciar_fecha_grupal(uuid) from public, anon;
grant  execute on function public.renunciar_fecha_grupal(uuid) to authenticated;

-- (b) NTF-54 dice si el ciclo ya empezó y con qué sesión renunciar.
create or replace function public.avisar_cambio_de_fecha_grupal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     record;
  v_clase text;
begin
  -- Lote 6 · A3: la campana y el correo nombran la clase.
  select pr.title into v_clase from public.products pr where pr.id = new.product_id;

  -- RG-11 · el tutor movió la hora de esta fecha.
  if new.rescheduled_at is not null and new.rescheduled_at is distinct from old.rescheduled_at then
    for v_b in
      select b.id, b.student_id from public.bookings b
       where b.product_id = new.product_id and b.status in ('confirmed', 'in_progress')
    loop
      perform public.enqueue_notification(v_b.student_id, 'NTF-54', 'email', 'group_rescheduled',
        jsonb_build_object('booking_id', v_b.id, 'product_id', new.product_id, 'group_class_id', new.id,
                           'nuevo_inicio', new.start_at, 'anterior', old.start_at, 'para', 'alumno',
                           'clase', v_clase,
                           -- L11 · M14 · con el ciclo empezado no hay baja al
                           -- 100 %: el correo ofrece renunciar a ESTA fecha.
                           'ciclo_empezado', exists (
                             select 1 from public.sessions s
                              where s.booking_id = v_b.id and s.group_class_id is not null
                                and s.status <> 'cancelled' and s.start_at <= now()),
                           'session_id', (
                             select s.id from public.sessions s
                              where s.booking_id = v_b.id and s.group_class_id = new.id
                              order by (s.status <> 'cancelled') desc
                              limit 1)),
        'NTF-54:group_class:' || new.id || ':' || extract(epoch from new.rescheduled_at)::bigint
          || ':' || v_b.student_id);
    end loop;
  end if;

  -- RG-16 · se canceló UNA fecha del ciclo. La clase entera cancelada la avisa
  -- notify_booking, una vez por alumno.
  -- Lote 6 · M27: la condición era «queda otra fecha `scheduled`», y cancelar
  -- la ÚLTIMA fecha de un ciclo ya empezado no avisaba (las dadas no son
  -- `scheduled`). Ahora basta con otra fecha NO cancelada, dada o pendiente.
  -- Cancelar la clase entera sigue sin mandar un correo por fecha:
  -- cancelar_clase_grupal solo deja hacerlo antes de empezar y marca todas en
  -- un único UPDATE, y los triggers AFTER ROW corren al final de la sentencia,
  -- con todas ya canceladas.
  if old.status = 'scheduled' and new.status = 'cancelled' and exists (
       select 1 from public.group_classes g
        where g.product_id = new.product_id and g.id <> new.id and g.status <> 'cancelled')
  then
    for v_b in
      select b.id, b.student_id from public.bookings b
       where b.product_id = new.product_id and b.status in ('confirmed', 'in_progress')
    loop
      perform public.enqueue_notification(v_b.student_id, 'NTF-55', 'email', 'group_cancelled',
        jsonb_build_object('booking_id', v_b.id, 'product_id', new.product_id, 'group_class_id', new.id,
                           'fecha', old.start_at, 'para', 'alumno', 'motivo', new.cancel_reason,
                           'clase', v_clase,
                           -- M27 · si era la última pendiente, el correo no puede
                           -- decir «el resto del ciclo sigue igual».
                           'quedan_fechas', exists (
                             select 1 from public.group_classes g
                              where g.product_id = new.product_id and g.id <> new.id
                                and g.status = 'scheduled')),
        'NTF-55:group_class:' || new.id || ':' || v_b.student_id);
    end loop;
  end if;
  return new;
end;
$$;

comment on function public.avisar_cambio_de_fecha_grupal() is
  'G4 · NTF-54 a cada inscrito cuando el tutor reagenda una fecha (RG-11) y NTF-55 cuando cancela UNA fecha de un ciclo (RG-16) mientras quede otra fecha no cancelada, dada o pendiente (Lote 6 · M27: antes exigía otra `scheduled` y la última fecha de un ciclo empezado no avisaba). La clase entera cancelada no pasa por aquí: notify_booking avisa una vez por alumno. Los payloads llevan `clase`. L11 · M14: NTF-54 lleva `ciclo_empezado` (con el ciclo empezado no hay baja al 100 %: se ofrece renunciar a la fecha) y `session_id`, la sesión del alumno en esa fecha para renunciar_fecha_grupal.';

revoke execute on function public.avisar_cambio_de_fecha_grupal() from public, anon, authenticated;
-- El trigger `group_classes_avisos` se deja como está: misma función, mismo nombre.


-- ── L11 · M7′ (revisión) · los avisos del chat siguen a la pertenencia ─────
-- notify_new_message (vigente: 20261017130000) calculaba los miembros con su
-- propia copia del criterio: el sacado a mitad de ciclo seguía recibiendo los
-- NTF-21 de un chat que ya no podía abrir.
create or replace function public.notify_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_student uuid;
  v_tutor   uuid;
  v_kind    text;
  v_product uuid;
  v_dest    uuid;
begin
  select c.student_id, c.tutor_id, c.kind, c.group_product_id
    into v_student, v_tutor, v_kind, v_product
    from public.conversations c
   where c.id = new.conversation_id;

  -- L3 · B4: en un hilo de grupo, todos los miembros menos el emisor. Los
  -- miembros salen de las reservas pagadas, igual que en
  -- `puede_ver_conversacion`: quien se dio de baja ya no recibe nada. El
  -- `union` quita el duplicado del alumno con dos reservas de la misma clase.
  if v_kind = 'group' then
    for v_dest in
      select v_tutor
      union
      select b.student_id
        from public.bookings b
       where b.product_id = v_product
         and b.status in ('confirmed', 'in_progress', 'completed')
         and not public.sacado_del_grupo(b.id)   -- L11 · M7′: el sacado ya no es del grupo
    loop
      if v_dest is distinct from new.sender_id then
        perform public.avisar_mensaje_nuevo(new.conversation_id, v_dest);
      end if;
    end loop;
    return new;
  end if;

  -- Sin conversación no hay par y no hay a quién avisar. No debería pasar
  -- (`messages.conversation_id` es NOT NULL con FK), pero un `return` es más
  -- barato que un error dentro del INSERT de un mensaje.
  if v_student is null then
    return new;
  end if;

  v_dest := case
              when new.sender_id = v_student then v_tutor
              when new.sender_id = v_tutor   then v_student
            end;
  if v_dest is null then
    return new;   -- el emisor no es del par: no se adivina destinatario
  end if;

  perform public.avisar_mensaje_nuevo(new.conversation_id, v_dest);

  return new;
end;
$function$;

-- ── L11 · M7′ (revisión) · cancel_booking marca al sacado ──────────────────
-- Vigente: 20261017120000 (cuerpo vivo en dev idéntico). Único cambio: la rama
-- de tramos (M1) escribe bookings.sacado_at.
create or replace function public.cancel_booking(p_booking_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pol      jsonb;
  v_is_tutor boolean;
  v_tramos   boolean;
  v_pay      record;
  v_refund   bigint := 0;   -- acumulado tras esta cancelación
  v_prev     bigint := 0;   -- lo que ya se había devuelto antes
  v_delta    bigint := 0;   -- lo que hay que mover DE VERDAD ahora
  v_reparto  jsonb  := jsonb_build_object('cash', 0, 'credit', 0, 'credito_perdido', 0);
  v_motivo   text   := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  -- M26 · quién puede, cuándo y cuánto lo decide `politica_de_baja`: la misma
  -- respuesta que enseñan las pantallas antes de pulsar. Sus motivos son los
  -- textos de siempre («reserva no cancelable o inexistente», RA-24, RG-16).
  -- El pago se bloquea ANTES de preguntar: si no, una fecha cancelada a la vez
  -- cambia `ya_devuelto` entre la política y el movimiento, y A8 se calcula
  -- sobre una base vieja.
  perform 1 from public.payments where booking_id = p_booking_id for update;
  v_pol := public.politica_de_baja(p_booking_id);
  if not coalesce((v_pol ->> 'permitida')::boolean, false) then
    raise exception '%', v_pol ->> 'motivo' using errcode = 'check_violation';
  end if;
  v_is_tutor := (v_pol ->> 'es_tutor')::boolean;
  v_tramos   := (v_pol ->> 'tramos')::boolean;

  -- Reembolso solo si el pago fue capturado.
  select id, status, gross_amount, refunded_amount
    into v_pay
  from public.payments where booking_id = p_booking_id
  for update;

  if v_pay.status in ('paid', 'partially_refunded') then
    v_prev   := coalesce(v_pay.refunded_amount, 0);
    -- El acumulado no retrocede jamás.
    v_refund := greatest((v_pol ->> 'reembolso_total')::bigint, v_prev);
    v_delta  := v_refund - v_prev;
  end if;

  if v_pay.status in ('paid', 'partially_refunded') and v_delta > 0 then
    update public.payments
      set status = (case when v_refund >= v_pay.gross_amount then 'refunded'
                         else 'partially_refunded' end)::public.payment_status,
          refunded_amount = v_refund
      where id = v_pay.id;

    -- El tramo se parte entre tarjeta y crédito (`reembolsar_con_credito`).
    -- `p_ya_devuelto` es `v_prev`, el acumulado de ANTES: el `update` de encima
    -- ya movió la fila.
    v_reparto := public.reembolsar_con_credito(
      v_pay.id,
      v_delta,
      v_prev,
      case when v_tramos
           then 'M1 · el tutor saca al alumno de un ciclo empezado (las fechas que faltan)'
           else 'RN-37 · cancela ' || (case when v_is_tutor then 'el tutor' else 'el alumno' end)
                || ' (' || (v_pol ->> 'pct') || ' %)'
      end,
      'X01:payment:' || v_pay.id || ':' || v_refund
    );

  elsif v_pay.status = 'pending' then
    -- Nunca se cobró (pending_payment): sin reembolso. Este 'failed' es además
    -- el que hace que X-02 rechace un cobro que llegue tarde por esta reserva.
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    -- Y la cuarta puerta: el crédito ya aplicado a una reserva sin pagar vuelve.
    perform public.liberar_credito_de_pago(v_pay.id);
    v_refund := 0;
  end if;

  if v_tramos then
    -- M1 · solo caen las fechas que faltan; lo ya dado sigue siendo del tutor.
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled' and start_at > now();
    update public.bookings
      set cancel_reason = coalesce(v_motivo, cancel_reason),
          sacado_at = now()   -- L11 · M7′: sale del chat del grupo (sacado_del_grupo)
      where id = p_booking_id;
    -- La reserva no pasa a `cancelled`, así que `notify_booking` no avisa: el
    -- NTF-55 va aquí, con `tramos` para que el correo no prometa el 100 %. La
    -- clave es la de «se canceló tu cupo»: si luego cae la clase, no se repite.
    perform public.enqueue_notification(b.student_id, 'NTF-55', 'email', 'group_cancelled',
              jsonb_build_object('booking_id', b.id, 'product_id', b.product_id, 'para', 'alumno',
                                 'motivo', v_motivo, 'tramos', true),
              'NTF-55:product:' || b.product_id || ':' || b.student_id)
       from public.bookings b where b.id = p_booking_id;
    -- Sin nada por delante, la reserva terminó: se completa (misma condición que
    -- `cancelar_fecha_grupal`; close_expired_sessions no la vería nunca).
    if not exists (
      select 1 from public.sessions s
       where s.booking_id = p_booking_id and s.status in ('scheduled', 'in_progress')
    ) then
      update public.bookings
         set status = 'completed', completed_at = now()
       where id = p_booking_id and status in ('confirmed', 'in_progress');
    end if;
  else
    update public.bookings
      set status = 'cancelled',
          cancelled_at = now(),
          cancel_reason = v_motivo
      where id = p_booking_id;
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  -- `refund_amount` es el ACUMULADO EN PRECIO (lo pinta cancel-form.tsx);
  -- `refund_cash`, `refund_credit` y `refund_credit_perdido`, lo que se movió.
  return jsonb_build_object(
    'refund_pct',            (v_pol ->> 'pct')::int,
    'refund_amount',         v_refund,
    'refund_cash',           coalesce((v_reparto ->> 'cash')::bigint, 0),
    'refund_credit',         coalesce((v_reparto ->> 'credit')::bigint, 0),
    'refund_credit_perdido', coalesce((v_reparto ->> 'credito_perdido')::bigint, 0),
    'tramos',                v_tramos
  );
end;
$function$;

