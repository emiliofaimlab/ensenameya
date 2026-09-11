-- ============================================================================
-- Enséñame Ya — «Invita y gana» deja de ser un iframe: campañas, enlaces y
-- conversiones viven en nuestra base y Referral Factory pasa a ser solo API.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Hasta hoy la atribución de referidos NO EXISTÍA. `profiles.referral_code`
-- (20260729130000) se rellenaba desde la cookie `ey-ref`, pero el `?ref=` nunca
-- llegaba: la landing de RF no redirige de vuelta a la app, así que la columna
-- se quedaba null siempre y quién trajo a quién se quedaba entero en RF —que
-- tampoco lo sabía, porque nadie daba de alta a nadie por API—.
--
-- Medido contra la API real el 10-sep-2026 (INSTRUCCIONES-DESARROLLO.md §1):
-- `POST users` devuelve `id/code/url/sharing/qr` y NO manda correo; `PUT
-- users/{id} {qualified:true}` marca la conversión; `GET users?campaign_id=`
-- IGNORA el filtro. Con eso el reparto queda: el enlace lo emitimos nosotros
-- (`APP_BASE_URL/?ref=<code>`), la cuenta la lleva RF, y las dos llamadas a RF
-- se hacen FUERA del camino crítico (primera visita a /referidos, y el cron).
-- RF tiene picos de >25 s: ninguna pantalla puede quedarse esperándolo.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- ⚠️ `referral_memberships` ES UNA TABLA PUENTE entre `profiles` y
--    `referral_campaigns`. No toca ningún embed existente (nadie embebía
--    campañas), pero si mañana alguien escribe `.select("…, profiles(…)")`
--    partiendo de `referral_campaigns`, PostgREST responderá `PGRST201` y la
--    consulta SE CAE entera. Se nombra la FK. Precedente: `20260827140000`.
--
-- ⚠️ EL HISTORIAL DEL REFERIDOR ES UNA RPC `security definer`, NO UNA VISTA.
--    La especificación pedía una vista `security_invoker` + una política
--    `profiles_select_referred`. Eso NO cumple lo que la propia especificación
--    exige ("el referidor no debe ver el nombre completo ni el correo del
--    referido"): la RLS es por FILA, no por columna, y `20260703120000:16` hace
--    `grant select on public.profiles to authenticated` sobre LA TABLA ENTERA.
--    Con esa política, el referidor pediría `/rest/v1/profiles?select=*` y se
--    llevaría `full_name`, `phone`, `primary_goal` y `stripe_customer_id` de
--    sus invitados; el `split_part()` de la vista sería un adorno. La RPC
--    enmascara dentro y no abre ninguna fila nueva de `profiles`.
--
-- ⚠️ `service_role` NO tiene `update` de tabla sobre `profiles` — lo tiene por
--    COLUMNAS (`20260806170000:41`, `20260831130000:39`). El cron escribe dos
--    columnas nuevas, así que su grant va aquí o el job se come
--    `permission denied` EN EJECUCIÓN: ni el build ni el typecheck lo ven
--    (regla de oro 9).
-- ============================================================================


-- ── 1 · Qué campañas se enseñan, y con qué texto ────────────────────────────
-- Las campañas se CREAN y se configuran en RF; aquí solo se decide cuáles se
-- muestran, en qué orden y con qué texto en español. El admin las trae con
-- «Traer campañas» (POST /api/admin/referidos/sync).
create table if not exists public.referral_campaigns (
  rf_campaign_id  integer     primary key,
  rf_name         text        not null,
  rf_code         text        not null,
  rf_url          text        not null,
  rf_status       text        not null,
  rf_lang         text,
  audience        text        not null check (audience in ('alumnos','tutores')),
  title           text        not null,
  reward_text     text        not null,
  visible         boolean     not null default false,
  sort_order      smallint    not null default 0,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.referral_campaigns is
  'Campañas de Referral Factory que la app enseña en «Invita y gana». Fuente de '
  'verdad de las REGLAS y los PAGOS: Referral Factory (RN-21). Fuente de verdad '
  'de qué se muestra y cómo se lee en español: esta tabla.';
comment on column public.referral_campaigns.rf_campaign_id is
  'Id en Referral Factory. Es la PK a propósito: no inventamos identidad propia '
  'para algo que vive fuera, y el upsert del admin se hace por esta columna.';
comment on column public.referral_campaigns.rf_code is
  'Código de la CAMPAÑA en RF (no el del referidor). Solo informativo.';
comment on column public.referral_campaigns.rf_url is
  'Landing pública de RF. No se comparte: lo que se reparte es NUESTRO enlace '
  '(APP_BASE_URL/?ref=<code del referidor>), que es el único que deja rastro '
  'en la cookie ey-ref y por tanto en profiles.referral_code.';
comment on column public.referral_campaigns.audience is
  'Decide la REGLA DE CONVERSIÓN (ver referral_conversions_pending) y el icono: '
  'alumnos = primer pago; tutores = primera sesión completada (DP-32.2).';
comment on column public.referral_campaigns.title is
  'Título en español que ve el usuario. RF los nombra en inglés y sin contexto.';
comment on column public.referral_campaigns.reward_text is
  'Una línea: «Ganas 1 clase gratis cuando…». DP-32.1 — lo edita el admin, NO '
  'sale del `rewards` de RF (que viene en inglés y sin sujeto).';
comment on column public.referral_campaigns.visible is
  'Default FALSE a propósito: una campaña nueva traída de RF no se publica sola.';
comment on column public.referral_campaigns.synced_at is
  'Última vez que «Traer campañas» refrescó los campos rf_*.';

drop trigger if exists referral_campaigns_set_updated_at on public.referral_campaigns;
create trigger referral_campaigns_set_updated_at
  before update on public.referral_campaigns
  for each row execute function public.set_updated_at();

alter table public.referral_campaigns enable row level security;

-- El usuario ve las visibles; el admin, todas (para poder encender las que no).
create policy "referral_campaigns_select_visible"
  on public.referral_campaigns for select
  using ( visible or public.has_role('admin') );

-- Sin políticas de escritura para `authenticated`: escribe el admin por Route
-- Handler con `service_role`, igual que `user_roles` (RN-31/S-31).
grant select                 on public.referral_campaigns to authenticated;
grant select, insert, update on public.referral_campaigns to service_role;


-- ── 2 · Mis enlaces ─────────────────────────────────────────────────────────
create table if not exists public.referral_memberships (
  profile_id      uuid        not null references public.profiles (id) on delete cascade,
  rf_campaign_id  integer     not null references public.referral_campaigns (rf_campaign_id),
  rf_user_id      bigint      not null,
  code            text        not null unique,
  url             text        not null,
  sharing         jsonb       not null default '[]'::jsonb,
  qr_url          text,
  created_at      timestamptz not null default now(),
  primary key (profile_id, rf_campaign_id)
);

comment on table public.referral_memberships is
  'El alta de una persona como REFERIDOR en una campaña de RF. Una fila por '
  '(persona, campaña): cada campaña emite su propio código.';
comment on column public.referral_memberships.code is
  'El código del REFERIDOR en RF. Es lo que viaja en ?ref= y lo que aterriza en '
  'profiles.referral_code del invitado. `unique` no es decoración: la conversión '
  'resuelve el referidor por este código y dos filas lo harían ambiguo.';
comment on column public.referral_memberships.url is
  'La url que da RF (su landing con el código). Se guarda por si se quisiera '
  'ofrecer, pero NO es la que se comparte: ver referral_campaigns.rf_url.';
comment on column public.referral_memberships.sharing is
  'El array [{social,url}] tal cual lo da RF. Guardado crudo a propósito: sus '
  'redes pueden cambiar sin que nos enteremos, y re-derivarlo sería adivinar.';
comment on column public.referral_memberships.qr_url is
  'QR que devuelve RF. Apunta a la landing de RF, así que la pantalla NO lo usa '
  'para el botón «QR» (ese genera el QR de NUESTRO enlace). Se guarda por '
  'trazabilidad y por si el cliente pide el de RF.';

-- Sin `updated_at`: una membership no se edita, nace y se queda. Si RF
-- reemitiera un código, la fila se borra y se vuelve a crear.

alter table public.referral_memberships enable row level security;

create policy "referral_memberships_select_own"
  on public.referral_memberships for select
  using ( (select auth.uid()) = profile_id );

-- El alta la hace el servidor con `service_role` (la escribe tras hablar con
-- RF): `authenticated` no inserta, para que nadie se invente un código ajeno.
grant select         on public.referral_memberships to authenticated;
grant select, insert on public.referral_memberships to service_role;


-- ── 3 · La conversión del invitado, en su perfil ────────────────────────────
-- ⚠️ S-32.1 (aceptado, INSTRUCCIONES-DESARROLLO §3.3): `20260703120000:16` da
-- `grant select, update on public.profiles to authenticated` sobre la tabla
-- ENTERA, así que estas dos columnas nacen escribibles por el propio dueño del
-- perfil. El daño posible es marcarse «convertido» a uno mismo, lo que NO mueve
-- dinero (la recompensa la cuenta RF) y solo consigue que el cron deje de
-- mandarlo a RF: es autolesión, no un exploit. Cerrarlo pide mover las columnas
-- fuera de `profiles`, porque un `revoke update (col)` no quita el grant de
-- tabla (ver la nota de `20260827140000`).
alter table public.profiles
  add column if not exists referral_converted_at timestamptz,
  add column if not exists referral_rf_user_id   bigint;

comment on column public.profiles.referral_converted_at is
  'Cuándo este perfil cumplió la regla de conversión de la campaña por la que '
  'entró (referral_code). null = todavía no, o no entró por ninguna. Lo escribe '
  'el cron /api/cron/referrals-sync DESPUÉS de que RF lo acepte: es el ancla de '
  'idempotencia, no un cálculo — por eso se guarda y no se deriva.';
comment on column public.profiles.referral_rf_user_id is
  'Id del INVITADO en RF (el que creamos al convertirlo). Sirve para contrastar '
  'con RF y para no volver a crearlo.';

-- El cron busca por `referral_code`; sin índice es un seq scan de toda la tabla
-- cada hora. Parcial porque la inmensa mayoría de los perfiles no traen código.
create index if not exists profiles_referral_code_idx
  on public.profiles (referral_code)
  where referral_code is not null;

-- ⚠️ Regla de oro 9. `service_role` tiene `update` sobre profiles POR COLUMNAS
-- (20260806170000:41, 20260831130000:39), no de tabla: sin esto el cron falla
-- en ejecución con `permission denied`, y un cron que falla no se lo dice a
-- nadie (regla de oro 11).
grant update (referral_converted_at, referral_rf_user_id)
  on public.profiles to service_role;


-- ── 4 · El historial que ve el referidor ────────────────────────────────────
-- `security definer` y no vista: ver la cabecera. Enmascara aquí dentro y no
-- necesita abrir ninguna fila de `profiles` a `authenticated`.
--
-- Nombre y una inicial («María G.»): basta para reconocer a quien invitaste y
-- no publica el nombre completo ni el correo.
create or replace function public.referral_invitees()
returns table (
  id                uuid,
  display_name      text,
  rf_campaign_id    integer,
  signed_up_at      timestamptz,
  converted_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         trim(
           split_part(coalesce(p.full_name, ''), ' ', 1) ||
           case
             when split_part(coalesce(p.full_name, ''), ' ', 2) <> ''
               then ' ' || left(split_part(p.full_name, ' ', 2), 1) || '.'
             else ''
           end
         ) as display_name,
         m.rf_campaign_id,
         p.created_at,
         p.referral_converted_at
    from public.referral_memberships m
    join public.profiles p on p.referral_code = m.code
   where m.profile_id = (select auth.uid())
     -- Nadie se cuenta a sí mismo como invitado suyo.
     and p.id <> m.profile_id
   order by p.created_at desc;
$$;

comment on function public.referral_invitees() is
  'Los invitados del usuario con sesión, con el nombre enmascarado. '
  'security definer a propósito: la alternativa (vista security_invoker + '
  'política en profiles) expondría la fila ENTERA del invitado, porque la RLS '
  'es por fila y profiles tiene grant select de tabla a authenticated.';

grant execute on function public.referral_invitees() to authenticated;


-- ── 5 · A quién le toca convertir ───────────────────────────────────────────
-- La regla la decide la AUDIENCIA de la campaña por la que entró el invitado
-- (§2 de INSTRUCCIONES-DESARROLLO):
--   alumnos  → su primer `payments.status = 'paid'` como alumno.
--   tutores  → su primera `sessions.status = 'completed'` como tutor (DP-32.2).
-- Un invitado que entró por el enlace de tutores y solo compra clases NO
-- convierte: es lo que dice la campaña, no un fallo.
--
-- `security definer` porque lee `auth.users` (el correo) y porque el cron entra
-- con `service_role`: así el correo no se expone por ninguna otra superficie.
create or replace function public.referral_conversions_pending(p_limit int default 50)
returns table (
  profile_id     uuid,
  first_name     text,
  email          text,
  referral_code  text,
  rf_campaign_id integer,
  audience       text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         nullif(split_part(trim(coalesce(p.full_name, '')), ' ', 1), '') as first_name,
         u.email::text,
         p.referral_code,
         m.rf_campaign_id,
         c.audience
    from public.profiles p
    join auth.users u on u.id = p.id
    -- El join VALIDA el código: un `?ref=` inventado no casa con ninguna
    -- membership y sale de la lista sin llamar a RF. Se queda en `profiles`
    -- por trazabilidad.
    join public.referral_memberships m on m.code = p.referral_code
    join public.referral_campaigns   c on c.rf_campaign_id = m.rf_campaign_id
   where p.referral_converted_at is null
     and p.referral_code is not null
     and m.profile_id <> p.id                       -- nadie se refiere a sí mismo
     and u.email is not null
     and (
       (c.audience = 'alumnos' and exists (
          select 1
            from public.payments pay
            join public.bookings b on b.id = pay.booking_id
           where b.student_id = p.id
             and pay.status = 'paid'))
       or
       (c.audience = 'tutores' and exists (
          select 1
            from public.sessions s
           where s.tutor_id = p.id
             and s.status = 'completed'))
     )
   order by p.created_at
   limit p_limit;
$$;

comment on function public.referral_conversions_pending(int) is
  'Invitados que ya cumplieron la regla de su campaña y todavía no se han '
  'mandado a Referral Factory. Lo consume /api/cron/referrals-sync. No escribe '
  'nada: el cron marca referral_converted_at solo si RF acepta, para que un '
  'timeout se reintente en la pasada siguiente.';

-- Solo el cron. `authenticated` no la necesita y traería el correo de otros.
grant execute on function public.referral_conversions_pending(int) to service_role;


-- ── 6 · Seed: las tres campañas medidas el 10-sep-2026 ──────────────────────
-- Los `reward_text` son EJEMPLOS (DP-32.1): el cliente fija los reales desde
-- /admin/referidos. `on conflict do nothing` porque «Traer campañas» refresca
-- los campos rf_* y NO debe pisar lo que el admin haya escrito.
insert into public.referral_campaigns
  (rf_campaign_id, rf_name, rf_code, rf_url, rf_status, rf_lang,
   audience, title, reward_text, visible, sort_order)
values
  (50785, 'Enséñame Ya', 'ctAI3ZWp', 'https://ensenameya.referral-factory.com/ctAI3ZWp',
   'launched', 'es', 'alumnos', 'Invita alumnos',
   'Ganas 1 clase gratis cuando tu invitado paga su primera clase.', true, 10),
  (50784, 'Enséñame Ya - Tutor', 'cKAf69gl', 'https://ensename-ya.referral-factory.com/cKAf69gl',
   'launched', 'en', 'tutores', 'Invita tutores',
   'Ganas US$ 10 cuando tu invitado da su primera clase.', true, 20),
  -- La vieja, a la que apuntaban las NEXT_PUBLIC_REFERRAL_* de Vercel. Entra
  -- apagada: se queda registrada para no perder el rastro de quien ya tenía su
  -- enlace, pero deja de ofrecerse.
  (50297, 'Campaign for Enséñame Ya', 'cXr65Wou', 'https://vercel.referral-factory.com/cXr65Wou',
   'launched', 'es', 'alumnos', 'Invita y gana',
   'Campaña anterior. Sustituida por «Invita alumnos».', false, 90)
on conflict (rf_campaign_id) do nothing;
