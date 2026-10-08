-- ============================================================================
-- Enséñame Ya — el esquema de las clases grupales (Fase C, §10.1 del plan)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- `docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.1. Una clase grupal es un producto
-- `group` con fechas fijas (`group_classes`), y **cada cupo es una reserva y
-- un pago normales** (RG-06): así el 5 %, el nivel, los reembolsos, la reseña
-- y el payout no se tocan. Esta migración es SOLO esquema; las funciones
-- (`create_booking_line`, `publicar_clase_grupal`…) van en las siguientes.
-- Versiones vivas de lo que se reescribirá: `docs/INVENTARIO-FASE-C.md`.
--
-- Lo de academias (`REQUERIMIENTOS.md` §3.1) NO está aquí: ese documento aún
-- no está en el repo. Entrará en su propia migración.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · EL CANDADO DE SOLAPE SE RECREA. `sessions_sin_solape_por_tutor`
--   (`20260831180000:110-126`) prohíbe dos sesiones vivas del mismo tutor que
--   se pisen, y en una clase grupal las N sesiones de una misma fecha
--   comparten tutor y hora A PROPÓSITO. Pasa a vigilar solo las 1:1
--   (`group_class_id is null`). Mismo nombre, mismo código de error (23P01).
--
-- · UNA EXCLUSIÓN NO CRUZA TABLAS. Grupal contra grupal lo vigila la
--   exclusión de `group_classes`; 1:1 contra 1:1, la de `sessions`. El cruce
--   (RG-05: nadie reserva 1:1 encima de una grupal publicada, aunque no tenga
--   inscritos, y viceversa) lo vigila un trigger en las dos tablas que toma
--   `pg_advisory_xact_lock` por tutor. En READ COMMITTED la consulta que va
--   DESPUÉS del bloqueo ve lo que la otra transacción ya confirmó: el bloqueo
--   serializa, la consulta comprueba. Lanza 23P01, el mismo que la exclusión,
--   para que `create_booking_line` lo traduzca por la rama que ya tiene
--   (`exclusion_violation` → «ese horario acaba de ser tomado») sin tocarla.
--
-- · `conversations_pair_unique` NO SE TOCA, al revés de lo que proponía el
--   plan. Un `unique` trata los NULL como distintos, así que los hilos
--   grupales (`student_id` nulo) no chocan entre sí. Pasarlo a índice parcial
--   habría roto en tiempo de ejecución los `on conflict (student_id,
--   tutor_id)` de las funciones vivas (`20260817210000`, `20260820180000`):
--   un `on conflict` contra un índice PARCIAL exige repetir su `where`.
--
-- · Regla 10 (PGRST201): PostgREST solo toma como puente una tabla cuyas FK
--   formen parte de su clave primaria compuesta (como `tutor_views`,
--   `20260827140000`). `group_classes` y `conversations` llevan PK `id`, así
--   que sus FK nuevas no vuelven ambiguo ningún embed.
--
-- · `tutor_profiles.group_classes_enabled` NO lleva grant de columna, y es lo
--   que lo protege: `tutor_profiles_update_own` deja al tutor escribir su fila,
--   pero solo las columnas con grant (`20261005120000`). Si se le diera grant a
--   `authenticated`, el tutor se encendería las grupales solo. El interruptor
--   del admin (G4) va por RPC.
-- ============================================================================


-- ── 1 · products ────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists capacity  smallint,
  add column if not exists min_seats smallint;

comment on column public.products.capacity is
  'RG-03 · cupo máximo de una clase grupal (2 a 10). NULL salvo en pricing_model = ''group''. En grupales, package_num_sessions = número de fechas (RG-16).';
comment on column public.products.min_seats is
  'RG-04 · cupo mínimo opcional. NULL = la clase se da con un solo inscrito. Si no se alcanza 24 h antes de la primera fecha, se cancela sola con reembolso del 100 % (cancelar_grupales_sin_minimo, Fase C).';

alter table public.products drop constraint if exists products_capacidad_grupal;
alter table public.products add constraint products_capacidad_grupal check (
  (capacity is null or capacity between 2 and 10)
  and (min_seats is null or (capacity is not null and min_seats between 1 and capacity))
  -- Cupo si y solo si es grupal.
  and ((pricing_model = 'group') = (capacity is not null))
  -- RG-07: el tutor ya aceptó al publicar; una grupal no pasa por aceptación.
  and (pricing_model <> 'group' or auto_accept_bookings)
);


-- ── 2 · tutor_profiles: el interruptor (RG-18) ──────────────────────────────
alter table public.tutor_profiles
  add column if not exists group_classes_enabled boolean not null default false;

comment on column public.tutor_profiles.group_classes_enabled is
  'RG-18 · el admin habilita las clases grupales tutor por tutor. Sin grant de columna a authenticated A PROPÓSITO: con él, tutor_profiles_update_own dejaría al tutor encendérselas solo.';


-- ── 3 · group_classes: las fechas de una clase grupal ──────────────────────
create table if not exists public.group_classes (
  id                   uuid        primary key default gen_random_uuid(),
  product_id           uuid        not null
    constraint group_classes_product_id_fkey references public.products (id) on delete cascade,
  -- Denormalizado de products.tutor_id para la exclusión GiST y el candado
  -- entre tablas. Lo fija el trigger de abajo: nunca lo decide quien inserta.
  tutor_id             uuid        not null
    constraint group_classes_tutor_id_fkey references public.profiles (id) on delete cascade,
  sequence_no          smallint    not null default 1 check (sequence_no >= 1),
  start_at             timestamptz not null,                        -- UTC (RN-02)
  end_at               timestamptz not null,
  status               text        not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'completed')),
  daily_room_name      text,
  rescheduled_at       timestamptz,
  cancelled_at         timestamptz,
  cancel_reason        text,
  recordings_purged_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- Mismo mínimo que sessions (20260709140000:72). Además impide el rango
  -- vacío, que no solaparía con nada y se colaría bajo la exclusión.
  constraint group_classes_duracion_minima check (end_at >= start_at + interval '30 minutes'),
  constraint group_classes_secuencia_unica unique (product_id, sequence_no)
);

comment on table public.group_classes is
  'RG-01 · cada fecha fija de una clase grupal (una para una clase suelta, N para un ciclo, RG-16). Los inscritos NO se guardan aquí: son las reservas vivas del producto, y cada una tiene una sesión con group_class_id por fecha.';
comment on column public.group_classes.sequence_no is 'Orden de la fecha dentro del ciclo, 1..N. Una clase suelta es la 1.';
comment on column public.group_classes.daily_room_name is
  'RG-12 · una sala por fecha, compartida por todos los inscritos (''eyg-'' || id sin guiones). La fija join_group_class; se LEE de aquí, no se deriva (lección de sessions.daily_room_name).';
comment on column public.group_classes.rescheduled_at is
  'RG-11 · última vez que el tutor movió esta fecha. Desde entonces el alumno cancela con el 100 % aunque falten menos de 24 h.';
comment on column public.group_classes.recordings_purged_at is
  'RN-42 · la purga de grabaciones (/api/cron/recordings-purge) marca aquí cuándo borró las de esta sala.';

create index if not exists group_classes_product_idx on public.group_classes (product_id, sequence_no);
create index if not exists group_classes_tutor_start_idx on public.group_classes (tutor_id, start_at)
  where status = 'scheduled';

-- Grupal contra grupal: misma primitiva que sessions_sin_solape_por_tutor.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'group_classes_sin_solape_por_tutor'
       and conrelid = 'public.group_classes'::regclass
  ) then
    alter table public.group_classes
      add constraint group_classes_sin_solape_por_tutor
      exclude using gist (
        tutor_id with =,
        tstzrange(start_at, end_at) with &&
      )
      where (status = 'scheduled');
  end if;
end
$$;

comment on constraint group_classes_sin_solape_por_tutor on public.group_classes is
  'RG-05 · un tutor no puede tener dos fechas grupales vivas que se pisen. Rango medio abierto, como sessions_sin_solape_por_tutor. El cruce con las 1:1 lo vigila candado_agenda_entre_tablas().';

drop trigger if exists group_classes_set_updated_at on public.group_classes;
create trigger group_classes_set_updated_at
  before update on public.group_classes
  for each row execute function public.set_updated_at();

-- El tutor sale del producto, siempre.
-- ⚠️ El NOMBRE del trigger importa: los BEFORE de una tabla corren por orden
-- alfabético, y este tiene que ir antes que `group_classes_candado_entre_tablas`
-- o el candado bloquea sobre un tutor_id que aún no es el bueno (o es NULL, y
-- `pg_advisory_xact_lock(NULL)` no bloquea nada). 'asigna' < 'candado'.
create or replace function public.group_classes_tutor_del_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.tutor_id into new.tutor_id from public.products p where p.id = new.product_id;
  return new;
end;
$$;

drop trigger if exists group_classes_asigna_tutor on public.group_classes;
create trigger group_classes_asigna_tutor
  before insert or update of product_id, tutor_id on public.group_classes
  for each row execute function public.group_classes_tutor_del_producto();

alter table public.group_classes enable row level security;

-- Lectura: tutor, inscritos y admin. La parte pública del catálogo (fecha y
-- cupos libres) irá por una vista con solo esas columnas, en G2. Escritura:
-- ninguna política, a propósito; se escribe por RPC (publicar, cancelar,
-- reagendar), como bookings y sessions.
drop policy if exists "group_classes_select_tutor" on public.group_classes;
create policy "group_classes_select_tutor"
  on public.group_classes for select
  using ( (select auth.uid()) = tutor_id );

drop policy if exists "group_classes_select_admin" on public.group_classes;
create policy "group_classes_select_admin"
  on public.group_classes for select
  using ( public.has_role('admin') );

grant select on public.group_classes to authenticated;
-- Regla 9: la purga de grabaciones (service_role) lee la sala y marca la fecha.
grant select on public.group_classes to service_role;
grant update (recordings_purged_at) on public.group_classes to service_role;


-- ── 4 · sessions: a qué fecha grupal pertenece ──────────────────────────────
alter table public.sessions
  add column if not exists group_class_id uuid
    constraint sessions_group_class_id_fkey references public.group_classes (id) on delete restrict;

comment on column public.sessions.group_class_id is
  'RG-06 · la fecha grupal de esta sesión. NULL = sesión 1:1. Cada inscrito tiene su propia sesión por fecha (su asistencia, su in_progress, su no_show); la sala y la grabación son las de la group_class.';

create index if not exists sessions_group_class_idx on public.sessions (group_class_id)
  where group_class_id is not null;

-- La política de inscritos de group_classes va aquí y no en el §3: necesita
-- esta columna.
drop policy if exists "group_classes_select_inscrito" on public.group_classes;
create policy "group_classes_select_inscrito"
  on public.group_classes for select
  using ( exists (
    select 1 from public.sessions s
     where s.group_class_id = group_classes.id
       and s.student_id = (select auth.uid())
       and s.status not in ('cancelled', 'no_show')
  ) );

-- El candado pasa a vigilar solo las 1:1. drop + add, mismo nombre: quien lo
-- busque por nombre (comentarios de 20260910120000 y 20260925120000) lo
-- encuentra igual.
alter table public.sessions drop constraint if exists sessions_sin_solape_por_tutor;
alter table public.sessions
  add constraint sessions_sin_solape_por_tutor
  exclude using gist (
    tutor_id with =,
    tstzrange(start_at, end_at) with &&
  )
  where (status not in ('cancelled', 'no_show') and group_class_id is null);

comment on constraint sessions_sin_solape_por_tutor on public.sessions is
  'S-41 · un tutor no puede tener dos sesiones 1:1 vivas que se pisen. Desde 20261008120100 excluye las grupales (group_class_id no nulo): las N sesiones de una fecha comparten hora a propósito. Rango medio abierto. Violación = 23P01.';


-- ── 5 · El candado entre tablas (RG-05) ─────────────────────────────────────
create or replace function public.candado_agenda_entre_tablas()
returns trigger
language plpgsql
security definer          -- tiene que ver TODAS las filas del tutor, no las que la RLS deje
set search_path = ''
as $$
begin
  if tg_table_name = 'sessions' then
    if new.group_class_id is not null or new.status in ('cancelled', 'no_show') then
      return new;
    end if;
  elsif new.status <> 'scheduled' then
    return new;
  end if;

  -- Serializa por tutor. Lo que confirme la otra transacción antes de soltar
  -- el bloqueo lo ve la consulta de abajo (READ COMMITTED: snapshot por
  -- sentencia).
  perform pg_advisory_xact_lock(hashtext('agenda:' || new.tutor_id::text));

  if tg_table_name = 'sessions' then
    if exists (
      select 1 from public.group_classes g
       where g.tutor_id = new.tutor_id
         and g.status = 'scheduled'
         and tstzrange(g.start_at, g.end_at) && tstzrange(new.start_at, new.end_at)
    ) then
      raise exception 'ese horario choca con una clase grupal del tutor'
        using errcode = 'exclusion_violation';
    end if;
  else
    if exists (
      select 1 from public.sessions s
       where s.tutor_id = new.tutor_id
         and s.group_class_id is null
         and s.status not in ('cancelled', 'no_show')
         and tstzrange(s.start_at, s.end_at) && tstzrange(new.start_at, new.end_at)
    ) then
      raise exception 'esa fecha choca con una sesión 1:1 del tutor'
        using errcode = 'exclusion_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.candado_agenda_entre_tablas() is
  'RG-05 · cruce 1:1 ↔ grupal que ninguna exclusión puede vigilar (no cruzan tablas). pg_advisory_xact_lock por tutor + comprobación. Lanza 23P01 como las exclusiones.';

drop trigger if exists sessions_candado_entre_tablas on public.sessions;
create trigger sessions_candado_entre_tablas
  before insert or update of start_at, end_at, status, group_class_id, tutor_id on public.sessions
  for each row execute function public.candado_agenda_entre_tablas();

drop trigger if exists group_classes_candado_entre_tablas on public.group_classes;
create trigger group_classes_candado_entre_tablas
  before insert or update of start_at, end_at, status, tutor_id on public.group_classes
  for each row execute function public.candado_agenda_entre_tablas();


-- ── 6 · conversations: el hilo grupal (RG-13) ───────────────────────────────
alter table public.conversations
  add column if not exists kind text not null default 'pair',
  add column if not exists group_product_id uuid
    constraint conversations_group_product_id_fkey references public.products (id) on delete cascade;

alter table public.conversations alter column student_id drop not null;

alter table public.conversations drop constraint if exists conversations_kind_coherente;
alter table public.conversations add constraint conversations_kind_coherente check (
  (kind = 'pair'  and student_id is not null and group_product_id is null)
  or (kind = 'group' and student_id is null and group_product_id is not null)
);

comment on column public.conversations.kind is
  'RG-13 · ''pair'' = hilo alumno–tutor de siempre; ''group'' = hilo de una clase grupal. Los miembros de un hilo grupal NO se guardan: son el tutor y los alumnos con reserva viva y pagada del producto.';
comment on column public.conversations.group_product_id is
  'RG-13 · la clase grupal (producto) de un hilo ''group''. NULL en los de par. Uno por producto: un ciclo comparte hilo entre sus fechas.';

create unique index if not exists conversations_un_hilo_por_clase
  on public.conversations (group_product_id)
  where kind = 'group';
