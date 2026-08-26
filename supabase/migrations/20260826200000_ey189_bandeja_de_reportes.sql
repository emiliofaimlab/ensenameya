-- ============================================================================
-- Enséñame Ya — EY-189 · B5.6: la bandeja de moderación de reportes
--
-- QUÉ FALTABA. La puerta de moderación se construyó entera en M-12
-- (`20260817210000` §13) y desde entonces está cerrada por dentro: la tabla
-- `conversation_reports` con sus columnas de triaje, su índice de pendientes,
-- su RLS de admin, la RPC de escritura `report_conversation` y hasta la palanca
-- `set_conversation_blocked`. Lo único que nunca se escribió es **quien la
-- abre**: `grep -rn "conversation_reports" src/` solo acertaba en los tipos
-- generados, y `set_conversation_blocked` no la ha llamado nadie jamás. Esta
-- migración es lo que le falta a esa puerta para ser usable desde el panel.
--
-- ── POR QUÉ HACEN FALTA FUNCIONES Y NO POLÍTICAS ────────────────────────────
-- La tentación evidente es abrirle al admin un `select` sobre `conversations` y
-- montar la bandeja con un join de PostgREST. **Eso rompería una decisión
-- explícita**, escrita en la propia M-12 (`20260817210000:150-154`):
--
--     «Sin política de admin a propósito: el chat no se lee "por soporte" —
--      para eso está el reporte, que trae el hilo con consentimiento del que lo
--      levanta.»
--
-- O sea: el acceso del admin al hilo no es un privilegio de rol, es una
-- consecuencia de que un participante haya pedido que lo miren. Una política de
-- `select` no sabe expresar eso —le daría al admin TODAS las conversaciones,
-- reportadas o no, para siempre—; una función SECURITY DEFINER sí, porque puede
-- exigir las dos cosas a la vez: ser admin **y** que exista el reporte.
--
-- Es además el mismo nudo que M-12 ya desató para el bloqueo, y por el mismo
-- motivo (`20260817210000:164-170`): con RLS, un `update … where id = $1` tiene
-- que LEER la fila, y sin política de `select` no encuentra ninguna — no falla,
-- no hace nada, que es peor.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE ───────────────────────────────────────────
-- · NO crea ninguna tabla. No hay RLS nueva que declarar porque no hay
--   superficie nueva: los dos objetos son funciones, y su barrera es el
--   `has_role('admin')` de su primera línea.
-- · NO toca los grants de `conversation_reports`. Los de M-12 ya son los
--   correctos y son los que usa la bandeja para cerrar un reporte:
--   `grant update (handled_at, handled_by) … to authenticated` (`:983`), acotado
--   por columnas para que ni un admin pueda reescribir el `reason`. Ese grant
--   llevaba nueve días sin llamante; ahora lo tiene.
-- · NO añade taxonomía de motivos. `reason` sigue siendo texto libre (§23.5
--   punto 5). Una lista cerrada es columna nueva y decisión de producto sin
--   respuesta; el default operable —texto libre— ya funciona.
-- · NO ata el reporte a una clase concreta. `conversation_reports` no tiene
--   `session_id` ni `booking_id` (§23.5 punto 4): se reporta el HILO del par, no
--   la sesión. El botón de la sala resuelve la conversación de la reserva y
--   reporta ese hilo, que es lo que la tabla sabe guardar. Si «reportar
--   conducta» pasa a significar «esta clase», eso es columna nueva y otra ficha.
--
-- ⚠️ REGLA DE ORO 9 (grants para `service_role`): no aplica aquí y conviene
-- dejarlo dicho para que nadie la eche de menos en la revisión. Las tres
-- funciones son SECURITY DEFINER —corren como su dueña, así que los grants de
-- rol no las miran— y ningún job toca estas tablas. Además M-12 ya declaró
-- `grant … to service_role` sobre `conversations` (`:182`) y sobre
-- `conversation_reports` (`:984`) precisamente por esa regla.
-- ============================================================================

-- ── 1 · La cola de la bandeja ────────────────────────────────────────────────
-- Devuelve el reporte MÁS su contexto, porque un reporte a secas no se puede
-- triar: «alguien reportó la conversación 8f3c…» no dice a quién hay que
-- moderar. El admin sí puede leer `profiles` (`profiles_select_admin`,
-- `20260606121500:81`), pero NO `conversations`, así que el otro participante
-- —el reportado— es exactamente el dato que le falta y el que justifica esta
-- función.
--
-- Columnas elegidas a mano, nunca `tabla.*`: lo que se añada mañana a
-- `conversations` o a `profiles` no debe colarse solo en una superficie de
-- admin. Y NUNCA el correo de nadie: para hablar con las partes está su ficha.
create or replace function public.admin_conversation_reports(
  p_pendientes boolean default true,
  p_limit      integer default 100
)
returns table (
  id                 uuid,
  conversation_id    uuid,
  reason             text,
  created_at         timestamptz,
  handled_at         timestamptz,
  handled_by         uuid,
  handled_by_name    text,
  reporter_id        uuid,
  reporter_name      text,
  -- El OTRO participante del hilo: la persona sobre la que va el reporte.
  reported_id        uuid,
  reported_name      text,
  -- `true` si quien reporta es el tutor (o sea: el reportado es el alumno).
  -- Cambia por completo cómo se lee el caso, y el nombre solo no lo dice.
  reporter_is_tutor  boolean,
  blocked_at         timestamptz,
  blocked_reason     text,
  -- ¿El par llegó a comprar? Decide dos cosas para el admin: si hay dinero de
  -- por medio, y si la purga a 30 días puede llevarse el hilo (ver §3).
  pair_bought        boolean,
  message_count      integer,
  last_message_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- LA barrera. `has_role` mira `auth.uid()` por dentro y devuelve false sin
  -- sesión, así que esta línea cubre también la llamada sin autenticar. Misma
  -- forma y mismo `errcode` que `set_conversation_blocked`.
  if not public.has_role('admin') then
    raise exception 'solo un administrador puede ver los reportes'
      using errcode = '42501';
  end if;

  return query
  select
    r.id,
    r.conversation_id,
    r.reason,
    r.created_at,
    r.handled_at,
    r.handled_by,
    (select p.full_name from public.profiles p where p.id = r.handled_by),
    r.reporter_id,
    -- El nombre del que reporta sale siempre de `profiles`: puede ser el alumno
    -- o el tutor, y `profiles.full_name` es el dato que tienen los dos.
    (select p.full_name from public.profiles p where p.id = r.reporter_id),
    case when c.student_id = r.reporter_id then c.tutor_id else c.student_id end,
    -- ⚠️ Del tutor se prefiere `tutor_profiles.display_name` (la copia
    -- publicable, DD-01) igual que en `my_conversations`, pero con `coalesce` a
    -- `profiles.full_name`: allí el destinatario era el alumno, que solo ve el
    -- nombre de catálogo; aquí es el admin, que necesita identificar a UNA
    -- PERSONA aunque su ficha pública esté a medias. Un reporte sin nombre es
    -- un reporte que no se puede triar.
    case when c.student_id = r.reporter_id
         then coalesce(
                (select tp.display_name from public.tutor_profiles tp where tp.profile_id = c.tutor_id),
                (select p.full_name     from public.profiles       p  where p.id         = c.tutor_id)
              )
         else (select p.full_name from public.profiles p where p.id = c.student_id)
    end,
    c.tutor_id = r.reporter_id,
    c.blocked_at,
    c.blocked_reason,
    public.pair_has_booking(c.student_id, c.tutor_id),
    (select count(*)::integer from public.messages m where m.conversation_id = c.id),
    c.last_message_at
  from public.conversation_reports r
  join public.conversations c on c.id = r.conversation_id
  -- `p_pendientes` = solo lo que pide acción. Con `false` sale la cola entera,
  -- que es como se revisa lo ya atendido sin necesitar una segunda función.
  where (not p_pendientes or r.handled_at is null)
  -- Pendientes primero y dentro de cada grupo lo más reciente arriba. Es el
  -- orden del índice parcial de M-12 (`conversation_reports_pendientes_idx`,
  -- `created_at desc where handled_at is null`), así que la vista por defecto
  -- de la bandeja lo usa tal cual.
  order by (r.handled_at is null) desc, r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

comment on function public.admin_conversation_reports(boolean, integer) is
  'EY-189: la cola de moderación. Cada reporte con su contexto — quién reporta, a quién, si el hilo está bloqueado y si el par compró. SECURITY DEFINER porque el admin NO puede leer `conversations` (decisión de M-12) y sin el otro participante un reporte no se puede triar.';

revoke execute on function public.admin_conversation_reports(boolean, integer) from public;
revoke execute on function public.admin_conversation_reports(boolean, integer) from anon;
grant  execute on function public.admin_conversation_reports(boolean, integer) to authenticated;


-- ── 2 · El hilo reportado, y SOLO el reportado ───────────────────────────────
-- ⚠️ ESTA ES LA FUNCIÓN DELICADA DE LA MIGRACIÓN: abre contenido privado de
-- chat a un tercero. Va acotada por las dos condiciones a la vez, y las dos
-- están en el `where`, no en la confianza:
--
--   · quien llama es admin (la guarda de arriba), y
--   · existe un reporte sobre ESA conversación (el `join` por `p_report_id`).
--
-- Lo segundo es el consentimiento del que levanta la mano, que es literalmente
-- el modelo que M-12 dejó escrito. Sin reporte no hay parámetro que pasar: la
-- función se llama con el id del REPORTE, nunca con el de la conversación, así
-- que un admin no puede pedir un hilo cualquiera ni por descuido ni a mano.
--
-- Y esto es lo que separa moderar de fisgar. Bloquear a alguien leyendo solo la
-- versión del que reporta es sancionar sin ver el caso; y la decisión de §21 de
-- los Términos —llevarse la clase fuera de la plataforma— no se puede verificar
-- de ninguna otra forma que leyendo lo que se escribió.
--
-- NO devuelve los adjuntos, solo su nombre: el fichero vive en Storage con su
-- propia RLS (carpeta de reserva) y abrirlo es otra decisión, con otra ficha.
create or replace function public.admin_report_thread(
  p_report_id uuid,
  p_limit     integer default 200
)
returns table (
  id             uuid,
  sender_id      uuid,
  sender_name    text,
  body           text,
  created_at     timestamptz,
  attachment_name text,
  -- Quién habla, en la única clave que le importa al que tría: ¿es el que
  -- reportó o el reportado? Los nombres se repiten y los uuid no se leen.
  from_reporter  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'solo un administrador puede leer un hilo reportado'
      using errcode = '42501';
  end if;

  return query
  select
    m.id,
    m.sender_id,
    coalesce(
      (select p.full_name from public.profiles p where p.id = m.sender_id),
      (select tp.display_name from public.tutor_profiles tp where tp.profile_id = m.sender_id)
    ),
    m.body,
    m.created_at,
    m.attachment_name,
    m.sender_id = r.reporter_id
  from public.conversation_reports r
  join public.messages m on m.conversation_id = r.conversation_id
  where r.id = p_report_id
  -- Los ÚLTIMOS del hilo, no los primeros: lo que se denuncia acaba de pasar.
  -- Se ordena descendente para el `limit` y se le da la vuelta fuera, en la
  -- pantalla, que es donde se lee en orden de conversación.
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

comment on function public.admin_report_thread(uuid, integer) is
  'EY-189: los mensajes de la conversación de UN reporte, para poder triarlo. Doble llave: admin + que el reporte exista (se llama con el id del reporte, nunca con el de la conversación). Es el «el reporte trae el hilo con consentimiento del que lo levanta» de M-12, hecho código.';

revoke execute on function public.admin_report_thread(uuid, integer) from public;
revoke execute on function public.admin_report_thread(uuid, integer) from anon;
grant  execute on function public.admin_report_thread(uuid, integer) to authenticated;


-- ── 3 · Un reporte sin atender ya no se evapora ──────────────────────────────
-- ⚠️ DEFECTO REAL, y es el que convierte la bandeja en un colador si no se
-- arregla en la misma pasada. `purge_expired_messages` borra la conversación
-- ENTERA de un par que nunca compró a los 30 días sin actividad, y
-- `conversation_reports.conversation_id` es `on delete cascade`
-- (`20260817210000:952`): el reporte se va con ella. O sea, una denuncia sobre
-- una consulta de preventa que no convirtió desaparece sola de la cola del
-- admin, sin rastro y sin haberla mirado nadie. Lo dice la propia M-12 en su
-- comentario de la purga (`:1076-1078`), pero hasta hoy no había cola de la que
-- desaparecer, así que no dolía.
--
-- La guarda es la hermana exacta de la (a) que ya existe: allí se salvó el hilo
-- BLOQUEADO —«un hilo bajo moderación no es un hilo abandonado»— y aquí se
-- salva el hilo REPORTADO Y SIN ATENDER, que es el mismo argumento un paso
-- antes en el tiempo: todavía no se ha decidido si hay que bloquearlo.
--
-- Es deliberadamente estrecha: en cuanto el admin cierra el reporte
-- (`handled_at`), el hilo vuelve a ser purgable por el camino de siempre. Un
-- reporte atendido no debe conservar datos personales para siempre — eso sería
-- cambiar la retención por la puerta de atrás.
--
-- El resto del cuerpo es idéntico a `20260820150000`: se reproduce entero
-- porque `create or replace` no admite parches. Solo cambia el bloque (c).
create or replace function public.purge_expired_messages()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted  int;
  v_objects  int;
  v_consultas int;
begin
  -- 1 · MENSAJES DE RESERVA: 30 días desde CADA mensaje. Sin cambios (AB-01
  --     sigue abierto). Los nulos —lo pre-compra— quedan fuera solos.
  with gone as (
    delete from public.messages where expires_at < now()
    returning attachment_path
  ),
  dropped as (
    delete from storage.objects
    where bucket_id = 'chat-attachments'
      and name in (select attachment_path from gone where attachment_path is not null)
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
     where coalesce(c.last_message_at, c.created_at) < now() - interval '30 days'
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
$$;

comment on function public.purge_expired_messages() is
  'US-1703 + M-12 + L1-4 + EY-189: purga del chat a 30 días. Mensajes de reserva por `expires_at`; conversaciones sin compra por `coalesce(last_message_at, created_at)`, salvo que estén bloqueadas, tengan mensajes de los últimos 30 días, o tengan un reporte sin atender (la bandeja de moderación no puede perder casos por caducidad).';

-- Re-declarados igual que en `20260820150000`: un `create or replace` no toca
-- los grants, pero el día que alguien copie este bloque como plantilla se lo
-- lleva puesto.
revoke execute on function public.purge_expired_messages() from public;
revoke execute on function public.purge_expired_messages() from anon;
revoke execute on function public.purge_expired_messages() from authenticated;
grant  execute on function public.purge_expired_messages() to service_role;
