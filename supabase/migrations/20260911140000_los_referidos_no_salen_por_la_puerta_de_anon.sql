-- ============================================================================
-- Enséñame Ya — Las dos RPC de referidos dejan de ser públicas, el enmascarado
-- deja de fallar abierto, y el código de referido deja de poder reasignarse.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Tres agujeros que abrió `20260911120000_referidos_nativos.sql` y que se
-- encontraron revisándola contra la base de dev, no leyendo el SQL.
--
-- 1 · ⚠️ `grant execute … to service_role` NO QUITA EL `EXECUTE` QUE POSTGRES
--     LE DA A `PUBLIC` AL CREAR LA FUNCIÓN. Un grant suma, no acota. Medido en
--     dev sobre la migración anterior:
--
--       referral_conversions_pending  {=X/postgres, postgres=X/…, service_role=X/…}  anon → true
--       referral_invitees             {=X/postgres, postgres=X/…, authenticated=X/…} anon → true
--       pending_email_notifications   {postgres=X/…, service_role=X/…}               anon → false
--
--     Ese `=X/postgres` de cabeza —grantee vacío— ES el grant a `PUBLIC`.
--     `referral_conversions_pending` es `security definer` y devuelve
--     `auth.users.email` y el nombre de pila de cada invitado: con la clave
--     `anon`, que viaja en el bundle del navegador, un
--     `POST /rest/v1/rpc/referral_conversions_pending {"p_limit":1000000}`
--     se los llevaba todos. Hoy devuelve `[]` sólo porque dev no tiene aún
--     ninguna conversión pendiente: eso es estado de datos, no control de
--     acceso. La hermana que hace lo mismo con `auth.users` —
--     `pending_email_notifications` (`20260806150000:98-101`)— sí lleva el
--     triple `revoke`, y es el patrón de la casa: 28 líneas de `revoke execute`
--     en 10 migraciones. La anterior fue la única que lo olvidó.
--
--     Y de paso, `p_limit` no estaba acotado. Se acota como en el precedente.
--
-- 2 · ⚠️ EL ENMASCARADO DEL HISTORIAL FALLABA ABIERTO. `split_part(full_name,
--     ' ', 1)` parte por el U+0020 literal, y `profiles.full_name` es texto
--     libre copiado del alta sin normalizar (`20260817130000:89`). Un nombre
--     separado por espacio duro U+00A0 —lo que produce iOS y casi cualquier
--     copiar-pegar— no encuentra delimitador y salía ENTERO. Y un `full_name`
--     que sea un correo (una sola palabra) salía literal, que es exactamente lo
--     que la cabecera de la migración anterior prometía impedir: «el referidor
--     no debe ver el nombre completo ni el correo del referido».
--
-- 3 · ⚠️ `profiles.referral_code` LO SIGUE ESCRIBIENDO SU PROPIO DUEÑO, y desde
--     la migración anterior eso decide QUIÉN COBRA. `20260703120000:16` da
--     `grant select, update on public.profiles to authenticated` sobre la tabla
--     entera y `profiles_update_own` es por fila, sin restricción de columna:
--     un `PATCH /rest/v1/profiles?id=eq.<el mío> {"referral_code":"<el de A>"}`
--     desde el navegador se lo atribuye a A. Los códigos son públicos por
--     diseño —son lo que cada referidor reparte por WhatsApp—, así que no hay
--     nada que adivinar, y el join de `referral_conversions_pending` sólo
--     comprueba que el código EXISTA, no que llegara por la cookie `ey-ref`.
--     Lo caro es el caso retroactivo: alguien que ya pagó su primera clase hace
--     un mes se pone el código de quien quiera y la pasada siguiente del cron
--     le acredita la recompensa, gratis.
--
--     La nota S-32.1 de la migración anterior razonaba sólo sobre
--     `referral_converted_at` («es autolesión, no un exploit»), y para esa
--     columna es cierto. Para la de al lado no: con el trigger de abajo, ahora
--     sí lo es.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · `create or replace` sobre las dos funciones mantiene la firma EXACTA, así
--   que no hay sobrecarga ni `PGRST203` (regla de oro 12). Y como no hay
--   `drop`, los `grant` no se pierden — pero los `revoke` van después del
--   `create` de todas formas, que es el orden que importa aquí.
-- · El trigger sólo frena al rol `authenticated`, que es el único que llega
--   desde un navegador. `service_role` y `postgres` siguen pudiendo corregir
--   datos a mano, y la anonimización de la baja (`20260826230000:326`, que pone
--   `referral_code = null`) sigue funcionando: borrarlo se permite siempre.
-- ============================================================================


-- ── 1 · El historial del referidor: enmascarar de verdad ────────────────────
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
         nombre.display,
         m.rf_campaign_id,
         p.created_at,
         p.referral_converted_at
    from public.referral_memberships m
    join public.profiles p on p.referral_code = m.code
    -- Por CUALQUIER espacio en blanco, no por el U+0020 literal: el espacio
    -- duro de iOS dejaba el nombre completo a la vista.
    cross join lateral (
      select regexp_split_to_array(btrim(coalesce(p.full_name, '')), '\s+') as partes
    ) w
    cross join lateral (
      select case
        when coalesce(array_length(w.partes, 1), 0) = 0 or w.partes[1] = '' then ''
        -- `split_part(…, '@', 1)`: hay gente que se registra poniendo su correo
        -- en el nombre. Una sola palabra salía literal, correo incluido.
        when coalesce(array_length(w.partes, 1), 0) = 1 then split_part(w.partes[1], '@', 1)
        else split_part(w.partes[1], '@', 1) || ' ' || left(w.partes[2], 1) || '.'
      end as display
    ) nombre
   where m.profile_id = (select auth.uid())
     and p.id <> m.profile_id
   order by p.created_at desc;
$$;

-- ⚠️ El `grant` de la migración anterior no quitó el `EXECUTE` de `PUBLIC`.
-- Inofensiva hoy (con `anon`, `auth.uid()` es null y no casa ninguna fila),
-- pero cae en la misma línea y no hay motivo para dejarla abierta.
revoke execute on function public.referral_invitees() from public;
revoke execute on function public.referral_invitees() from anon;
grant  execute on function public.referral_invitees() to authenticated;


-- ── 2 · Los candidatos del cron: sólo el cron, y con tope ───────────────────
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
         nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), '') as first_name,
         u.email::text,
         p.referral_code,
         m.rf_campaign_id,
         c.audience
    from public.profiles p
    join auth.users u on u.id = p.id
    join public.referral_memberships m on m.code = p.referral_code
    join public.referral_campaigns   c on c.rf_campaign_id = m.rf_campaign_id
   where p.referral_converted_at is null
     and p.referral_code is not null
     and m.profile_id <> p.id
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
   -- Acotado como en `pending_email_notifications`: el lote del cron son 50, y
   -- un `p_limit` sin techo era media base de datos en una sola llamada.
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ⚠️ ESTE ES EL CRÍTICO. Con sólo el `grant`, la clave `anon` —que va en el
-- bundle del navegador— podía leer el correo de `auth.users` de cada invitado
-- pendiente de convertir.
revoke execute on function public.referral_conversions_pending(int) from public;
revoke execute on function public.referral_conversions_pending(int) from anon;
revoke execute on function public.referral_conversions_pending(int) from authenticated;
grant  execute on function public.referral_conversions_pending(int) to service_role;


-- ── 3 · El código de referido se pone una vez, al entrar ────────────────────
create or replace function public.referral_code_no_se_reasigna()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Sin cambio: la inmensa mayoría de los `update` sobre profiles.
  if new.referral_code is not distinct from old.referral_code then
    return new;
  end if;

  -- Borrarlo se permite siempre: lo hace la anonimización de la baja de cuenta.
  if new.referral_code is null then
    return new;
  end if;

  -- Ponerlo por primera vez, recién llegado: es el camino legítimo. El alta por
  -- correo lo trae ya en el `insert` (`handle_new_user`), así que este `update`
  -- es el de Google —`callback-status.tsx` lo escribe con `is("referral_code",
  -- null)` segundos después de crearse el perfil— y el del checkout de
  -- invitado, que lo mete en el metadata al crear la cuenta. La hora de margen
  -- es holgada a propósito: el camino real tarda segundos.
  if old.referral_code is null and old.created_at > now() - interval '1 hour' then
    return new;
  end if;

  -- ⚠️ Sólo se frena al rol del NAVEGADOR. Operaciones (service_role, postgres)
  -- sigue pudiendo corregir una atribución a mano, que es trabajo legítimo y no
  -- es lo que esto viene a impedir.
  -- ⚠️ `current_user` A SECAS. Es una palabra reservada del estándar, no una
  -- función de `pg_catalog`: cualificarla da `42P01 missing FROM-clause entry
  -- for table "pg_catalog"` EN EJECUCIÓN, no al crear la función — que es
  -- justo lo que avisa la regla de oro 11 («create or replace valida la
  -- sintaxis, no ejecuta el cuerpo»). Y por ser palabra reservada, el
  -- `set search_path = ''` de arriba no la afecta.
  if current_user::text = 'authenticated' then
    raise exception
      'referral_code no se reasigna después del alta (perfil %)', old.id
      using errcode = '42501',
            hint = 'La atribución la fija la cookie ey-ref al registrarse.';
  end if;

  return new;
end;
$$;

comment on function public.referral_code_no_se_reasigna() is
  'Impide que alguien se atribuya a sí mismo a un referidor DESPUÉS del alta. '
  'profiles tiene grant update de TABLA a authenticated (20260703120000:16) y '
  'la política es por fila, así que sin esto un PATCH desde el navegador bastaba '
  'para regalarle una recompensa a cualquiera con una compra ya hecha.';

drop trigger if exists profiles_referral_code_no_se_reasigna on public.profiles;
create trigger profiles_referral_code_no_se_reasigna
  before update on public.profiles
  for each row execute function public.referral_code_no_se_reasigna();
