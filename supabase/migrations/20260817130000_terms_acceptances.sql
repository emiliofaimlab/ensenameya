-- ============================================================================
-- Enséñame Ya — Constancia de la aceptación de los Términos y Condiciones
--
-- Lo pide el cliente (correo del 17-ago: «que estos términos aparezcan a la
-- hora del registro […] con un simple click los usuarios acepten») y lo exige
-- dLocal Go de hecho, porque hasta hoy NO había forma de demostrar que un
-- usuario concreto aceptó un texto concreto: la casilla de `/signup` se
-- validaba en un `if` del navegador y no dejaba rastro en ninguna parte.
--
-- UNA TABLA Y NO UNA COLUMNA EN `profiles`. Los términos van a cambiar —el §34
-- lo dice— y cada versión nueva necesita su propia aceptación. Con una columna,
-- aceptar la v2 borraría la constancia de haber aceptado la v1, que es
-- justamente la que hay que poder enseñar si alguien discute una compra hecha
-- bajo la v1. Aquí cada aceptación es una fila y el histórico se conserva.
--
-- SE GUARDA EL IDIOMA porque el contrato tiene dos versiones y el §38 dice que
-- gobierna la inglesa. Saber cuál leyó cada persona no cambia qué le obliga,
-- pero sí es el dato que se necesita si alguien alega que aceptó otra cosa.
--
-- DOS CAMINOS DE ESCRITURA, uno por cada forma de darse de alta:
--   · Correo → viaja en el metadata de `signUp` y lo persiste este mismo
--     trigger. ⚠️ NO se puede escribir desde el cliente después del alta: con
--     la confirmación por correo activa (que es como está la nube) NO hay
--     sesión en ese momento y el insert fallaría en silencio. Es exactamente
--     el fallo que documenta `20260729130000` con `referral_code`, y la
--     solución es la misma: el trigger, que corre igual en las dos variantes.
--   · Google → el metadata lo trae Google, así que no pasa por el trigger. Lo
--     cubre AU04 en el cliente llamando a `record_terms_acceptance`, igual que
--     ya hace con `intended_role` y con el código de referido.
--
-- Doc 3 §permisos · docs/19-PLAN-DE-EJECUCION.md §19.5
-- ============================================================================

create table public.terms_acceptances (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.profiles (id) on delete cascade,

  -- `TERMS_VERSION` de `src/components/legal/terms-content.ts`. Formato fecha
  -- AAAA-MM-DD para que se lea sin consultar nada; lo comprueba `check:terms`.
  version     text        not null check (char_length(version) between 4 and 32),

  -- Qué versión leyó. La que obliga es siempre la inglesa (§38).
  locale      text        not null check (locale in ('en', 'es')),

  accepted_at timestamptz not null default now(),

  -- Una aceptación por usuario y versión. Si vuelve a pulsar, no se duplica:
  -- lo que importa es que aceptó esa versión, no cuántas veces.
  unique (user_id, version)
);

create index terms_acceptances_user_idx on public.terms_acceptances (user_id);

-- ── RLS: cada quien ve la suya; admin todas; nadie escribe directo ───────────
alter table public.terms_acceptances enable row level security;

create policy "terms_acceptances_select_own"
  on public.terms_acceptances for select
  using ( (select auth.uid()) = user_id );

create policy "terms_acceptances_select_admin"
  on public.terms_acceptances for select
  using ( public.has_role('admin') );

-- Sin políticas de insert/update/delete a propósito. Una constancia legal que
-- el propio interesado pudiera editar o borrar no vale como constancia: se
-- escribe por el trigger o por la función de abajo, las dos SECURITY DEFINER.

-- ── Grants (auto-expose OFF) ────────────────────────────────────────────────
grant select on public.terms_acceptances to authenticated;

-- Regla de oro 9: `service_role` se salta la RLS pero NO los grants. Hace falta
-- para poder consultar y rellenar aceptaciones desde el servidor — en concreto
-- el día que se decida qué hacer con las cuentas anteriores a hoy, que no
-- tienen ninguna (ver la nota del final).
grant select, insert on public.terms_acceptances to service_role;

-- ── Alta por correo: el trigger que ya crea el perfil ────────────────────────
-- Se reescribe entero (no se puede parchear) conservando lo que ya hacía:
-- perfil con nombre, zona y código de referido, y rol 'alumno'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, timezone, referral_code)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'),
    nullif(trim(new.raw_user_meta_data ->> 'referral_code'), '')
  );

  -- Todo registro nace como 'alumno'. El rol 'tutor' se otorga tras la
  -- aprobación manual del admin (Doc 2: M1/M2).
  insert into public.user_roles (user_id, role)
  values (new.id, 'alumno');

  -- La aceptación solo si viene: el alta por Google no la trae por aquí, y no
  -- se inventa una constancia que nadie dio.
  if nullif(trim(new.raw_user_meta_data ->> 'terms_version'), '') is not null then
    insert into public.terms_acceptances (user_id, version, locale)
    values (
      new.id,
      trim(new.raw_user_meta_data ->> 'terms_version'),
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'terms_locale'), ''), 'en')
    )
    on conflict (user_id, version) do nothing;
  end if;

  return new;
end;
$$;

-- ── Alta por Google: la llama AU04 con la sesión ya creada ───────────────────
create or replace function public.record_terms_acceptance(
  p_version text,
  p_locale  text default 'en'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'no autenticado';
  end if;

  insert into public.terms_acceptances (user_id, version, locale)
  values (
    auth.uid(),
    trim(p_version),
    case when p_locale in ('en', 'es') then p_locale else 'en' end
  )
  on conflict (user_id, version) do nothing;
end;
$$;

-- ⚠️ `execute` sobre una función es PUBLIC por defecto en Postgres: revocarlo
-- solo de `authenticated` NO cierra nada. Es el mismo agujero que cerró
-- `20260715150000` con `expire_stale_bookings`, y se cierra igual.
revoke execute on function public.record_terms_acceptance(text, text) from public;
grant  execute on function public.record_terms_acceptance(text, text) to authenticated;

-- ============================================================================
-- ⚠️ PENDIENTE, y es una decisión de negocio, no de código.
--
-- Las cuentas creadas ANTES de hoy no tienen ninguna fila aquí: aceptaron una
-- casilla que no dejaba rastro, y además aceptaron un texto distinto (el que
-- teníamos escrito nosotros, no el contrato del cliente). Las opciones son
-- pedirles que acepten la versión nueva la próxima vez que entren —lo que el
-- §34 contempla— o dar por buena la aceptación anterior. Lo segundo es más
-- cómodo y más débil. Hay que preguntárselo al cliente antes de lanzar.
-- ============================================================================
