-- ============================================================================
-- Enséñame Ya — el tutor elige POR DÓNDE cobra, y el enrutador le hace caso
--
-- Hasta hoy la pantalla de payouts le pedía al tutor sus datos y el enrutador
-- decidía solo: el primer candidato de `payment_routing_rules.payout_providers`
-- que pudiera pagarle. Eso está bien como RESPALDO y mal como única regla — un
-- tutor mexicano con banco y PayPal registrados no tenía forma de decir «págame
-- por PayPal», y uno venezolano con Zinli y Zelle a la vez dependía de con cuál
-- se topara antes quien ejecuta. La pantalla llegó a decírselo con todas las
-- letras: «si prefieres que sea siempre la misma, retira las demás».
--
-- Decisión del cliente (8-sep-2026): el tutor manda.
--
-- ── POR QUÉ UNA TABLA Y NO UNA COLUMNA EN `tutor_profiles` ──────────────────
--
-- Se intentó primero como columna ahí, que es donde ya vive `payout_country`, y
-- la comprobación de esta misma migración lo tumbó: `tutor_profiles` tiene
-- `grant select` **a nivel de tabla** para `anon` —publica la fila entera de
-- cualquier tutor aprobado, que es como tiene que ser para el catálogo público—
-- y un `revoke` por columna NO recorta un grant de tabla en Postgres. O sea que
-- la columna habría nacido pública: cualquiera podría listar por dónde cobra
-- cada tutor de la plataforma.
--
-- Es literalmente el motivo por el que `tutor_payout_accounts` y
-- `tutor_manual_payout_destinations` son tablas aparte y no columnas. Esta es la
-- tercera de la familia y sigue el mismo patrón: RLS default-deny, política de
-- dueño, cero `anon`.
--
-- Lo que NO copia de sus hermanas es la escritura por RPC, y la diferencia es de
-- naturaleza: allí lo que se guarda es un número de cuenta o un correo, o sea
-- PII que mueve dinero. Aquí se guarda una PREFERENCIA, que por sí sola no
-- manda dinero a ningún sitio — los tres filtros del resolvedor siguen después.
-- Es el mismo criterio con el que `payout_country` se escribe desde el
-- navegador: es la CLAVE con la que el dinero se rutea, no el dinero.
--
-- ── QUÉ SE GUARDA: EL MÉTODO, NO EL RIEL ────────────────────────────────────
--
-- `method` NO es una clave de `RIELES`. Es lo que el tutor ve en pantalla, y son
-- cosas distintas en un caso concreto y a propósito:
--
--     'banco'    → los rieles de familia 'banco' (dlocal Y wise)
--     'stripe'   → el riel 'stripe' (cuenta conectada)
--     'paypal'   → el riel 'paypal'
--     <canal>    → el riel 'manual' con ESE canal ('zinli', 'zelle', 'binance'…)
--
-- dLocal y Wise leen la MISMA fila de `tutor_payout_accounts` y le ingresan en
-- la MISMA cuenta bancaria: lo único que los separa es qué corresponsal usamos
-- nosotros y cuánto nos cuesta. Pedirle al tutor que elija entre ellos sería
-- pedirle una decisión que no puede tomar con la información que tiene, y que
-- además no cambia nada de lo que él recibe. Por eso hay UNA opción 'banco'.
--
-- ── EL CHECK ES DE FORMATO, NO UNA LISTA CERRADA ────────────────────────────
--
-- Porque la mitad de los valores válidos viven en `payout_manual_channels`, que
-- es una tabla: un `check ... in (...)` habría que migrarlo cada vez que Legal
-- abre un canal, que es justo lo que esa tabla existe para evitar. Y el fallo es
-- seguro por construcción: un valor que no case con ningún riel candidato deja a
-- `ordenaPorPreferencia` sin nada que adelantar y el ruteo se comporta
-- exactamente como antes de esta migración. Un dato basura aquí no puede mandar
-- dinero a ningún sitio — solo puede no cambiar el orden.
--
-- ── Y LA PREFERENCIA NO SALTA NINGUNA COMPROBACIÓN ──────────────────────────
--
-- `payoutProviderFor` REORDENA candidatos con esto y después aplica los tres
-- filtros de siempre: `puedePagar()`, `ataduraDeBalance` y
-- `rielSirveParaEsteTutor`. Elegir PayPal sin conectar la cuenta no atasca la
-- orden: se cae al siguiente candidato, como cualquier otro riel que hoy no
-- pueda pagarle a esa persona. Es lo que la pantalla promete con «intentamos esa
-- primero», y no «solo esa».
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · LA TABLA
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.tutor_payout_preferences (
  -- Una fila por tutor: esto es una elección, no una lista. Al revés que
  -- `tutor_manual_payout_destinations`, donde la PK es `(tutor_id, channel)`
  -- porque el tutor puede tener varios destinos — de esos varios, ESTA fila dice
  -- cuál va primero.
  tutor_id   uuid        primary key
             references public.profiles (id) on delete cascade,

  -- Mismo alfabeto que `payout_manual_channels.channel` (`^[a-z][a-z0-9_]{1,30}$`),
  -- ensanchado con el guion para que quepan claves fijas que lo lleven. Nada de
  -- mayúsculas ni espacios: son claves, no etiquetas.
  method     text        not null
             check (method ~ '^[a-z][a-z0-9_-]{1,31}$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tutor_payout_preferences_set_updated_at
  before update on public.tutor_payout_preferences
  for each row execute function public.set_updated_at();

comment on table public.tutor_payout_preferences is
  'Por dónde PREFIERE cobrar cada tutor (8-sep-2026). Tabla aparte y no una columna en tutor_profiles porque esa tiene grant select de TABLA para anon y un revoke por columna no recorta un grant de tabla: la preferencia habría sido pública. Sin fila = no ha elegido, y manda el orden de payment_routing_rules, que es el comportamiento anterior. payoutProviderFor solo REORDENA candidatos con esto; los filtros puedePagar/ataduraDeBalance/rielSirveParaEsteTutor se aplican después, así que preferir un método sin completar sus datos NO deja la orden atascada: cae al siguiente candidato.';

comment on column public.tutor_payout_preferences.method is
  'La clave del MÉTODO que el tutor ve en pantalla, no la del riel: ''banco'' (los rieles dlocal y wise, que leen la misma cuenta bancaria y le ingresan en el mismo sitio), ''stripe'' (cuenta conectada), ''paypal'', o un channel de payout_manual_channels. El check es de FORMATO y no una lista cerrada porque la mitad de los valores válidos son filas de payout_manual_channels; un valor que no case con ningún riel candidato no rutea a ningún sitio, solo deja el orden como estaba.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · RLS + GRANTS (regla de oro 1: default-deny)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.tutor_payout_preferences enable row level security;

-- El dueño, y nadie más. No hay política para `anon`: por dónde cobra una
-- persona no es dato de catálogo, y ese es el fallo que esta tabla existe para
-- no cometer.
create policy "tutor_payout_preferences_select_own"
  on public.tutor_payout_preferences for select to authenticated
  using ( (select auth.uid()) = tutor_id );

create policy "tutor_payout_preferences_insert_own"
  on public.tutor_payout_preferences for insert to authenticated
  with check ( (select auth.uid()) = tutor_id );

create policy "tutor_payout_preferences_update_own"
  on public.tutor_payout_preferences for update to authenticated
  using ( (select auth.uid()) = tutor_id )
  with check ( (select auth.uid()) = tutor_id );

-- Y poder desdecirse: volver a «decidid vosotros» es borrar la fila.
create policy "tutor_payout_preferences_delete_own"
  on public.tutor_payout_preferences for delete to authenticated
  using ( (select auth.uid()) = tutor_id );

-- El admin la LEE (la cola de payouts enseña por dónde quiere cobrar el tutor,
-- que es lo único que hace útil el radio para los canales que paga una persona)
-- y no la escribe: la elección es del tutor.
create policy "tutor_payout_preferences_select_admin"
  on public.tutor_payout_preferences for select to authenticated
  using ( public.has_role('admin') );

grant select, insert, update, delete on public.tutor_payout_preferences to authenticated;

-- ⚠️ Regla de oro 9: `service_role` se salta la RLS pero NO los grants de tabla,
-- y con «auto-expose new tables» en OFF un job que lea esto sin este grant come
-- `permission denied` en tiempo de ejecución — no en el build, no en el
-- typecheck. Lo lee `datos_de_cobro_del_tutor`, que es SECURITY DEFINER y corre
-- como su dueño, pero el grant va igual: el día que alguien la consulte directo
-- desde el job, funciona.
grant select on public.tutor_payout_preferences to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · EL RESOLVEDOR SE ENTERA
--
-- `datos_de_cobro_del_tutor` es la única lectura que hace `payoutProviderFor`
-- sobre el tutor, y la misma que pinta la cola del admin. La preferencia entra
-- ahí y no en una consulta aparte por el motivo de siempre: dos lecturas se
-- desincronizan, y el panel de admin acabaría enseñando un riel distinto del que
-- el job va a usar.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.datos_de_cobro_del_tutor(p_tutor uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- Cuenta conectada de Stripe: el riel 'stripe' no puede pagar sin ella.
    'conectada', exists (
      select 1 from public.tutor_profiles tp
       where tp.profile_id = p_tutor and tp.stripe_connect_account_id is not null
    ),
    -- Coordenadas bancarias: las piden dLocal y Wise.
    'banco', exists (
      select 1 from public.tutor_payout_accounts a where a.tutor_id = p_tutor
    ),
    -- ⚠️ Y Wise pide MÁS que coordenadas: dirección, teléfono, un país que
    -- cubra y un banco que conozca. Sin esta clave aparte, el resolvedor elegiría
    -- Wise para cualquiera que tuviese banco y el adaptador devolvería
    -- 'sin-datos' para siempre — la orden ni pagaría ni fallaría.
    'banco_wise', public.wise_puede_pagar_a(p_tutor),
    -- Los canales de identificador que tenga registrados. 'paypal' es uno más
    -- de esta lista.
    'canales', coalesce(
      (select array_agg(d.channel order by d.channel)
         from public.tutor_manual_payout_destinations d
        where d.tutor_id = p_tutor),
      array[]::text[]
    ),
    -- 🔑 Y por dónde PREFIERE cobrar. Es lo único de este objeto que no describe
    -- un dato registrado sino una decisión suya, y por eso puede ser null sin
    -- que signifique «le falta algo»: significa «nos da igual, decidid
    -- vosotros», que es el comportamiento que había antes de esta migración.
    'metodo_preferido', (
      select p.method
        from public.tutor_payout_preferences p
       where p.tutor_id = p_tutor
    )
  );
$$;

comment on function public.datos_de_cobro_del_tutor(uuid) is
  'Qué datos de cobro tiene un tutor y por dónde prefiere cobrar, en la forma mínima que el ruteo necesita: tres booleanos, la lista de canales y metodo_preferido. NO devuelve ningún dato de cobro —ni un número de cuenta ni un correo—, por eso puede existir sin abrir grants sobre las cuatro tablas que los guardan. La usa payoutProviderFor para no elegir un riel que ese tutor no puede usar, y desde el 8-sep-2026 también para RESPETAR SU ELECCIÓN: metodo_preferido reordena los candidatos, no salta los filtros.';

revoke execute on function public.datos_de_cobro_del_tutor(uuid) from public;
grant  execute on function public.datos_de_cobro_del_tutor(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · COMPROBACIONES
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_tutor uuid;
  v_json  jsonb;
begin
  -- 1) Los canales que hay hoy caben en el check. Si alguien siembra uno con un
  --    formato que esta columna rechaza, el tutor no podría preferirlo y el
  --    fallo se vería como un guardado que revienta, no como una regla.
  if exists (
    select 1 from public.payout_manual_channels
     where channel !~ '^[a-z][a-z0-9_-]{1,31}$'
  ) then
    raise exception 'hay canales manuales que el check de method rechazaría';
  end if;

  -- 2) Las tres claves fijas también caben.
  if not ('banco' ~ '^[a-z][a-z0-9_-]{1,31}$'
      and 'stripe' ~ '^[a-z][a-z0-9_-]{1,31}$'
      and 'paypal' ~ '^[a-z][a-z0-9_-]{1,31}$') then
    raise exception 'el check de method rechaza una de las claves fijas';
  end if;

  -- 3) `anon` NO llega a la tabla. Es LA comprobación de esta migración: es
  --    exactamente lo que tumbó el primer intento, cuando esto era una columna
  --    de `tutor_profiles`. Preguntar por `anon` cubre también el grant a PUBLIC
  --    olvidado, que es el que nadie mira.
  if has_table_privilege('anon', 'public.tutor_payout_preferences', 'select') then
    raise exception 'anon llega a tutor_payout_preferences: por dónde cobra un tutor no es dato público';
  end if;

  -- 4) La RLS está encendida. Sin ella los grants de arriba son acceso total.
  if not exists (
    select 1 from pg_class
     where oid = 'public.tutor_payout_preferences'::regclass and relrowsecurity
  ) then
    raise exception 'tutor_payout_preferences sin RLS: los grants la abrirían entera';
  end if;

  -- 5) La RPC devuelve la clave nueva Y no ha perdido las cuatro de antes. Esta
  --    migración REESCRIBE la función, y perder una clave aquí dejaría al
  --    resolvedor eligiendo rieles que el tutor no puede usar sin que nada se
  --    queje: es el fallo del venezolano con Zinli, otra vez.
  select profile_id into v_tutor from public.tutor_profiles limit 1;
  if v_tutor is not null then
    v_json := public.datos_de_cobro_del_tutor(v_tutor);
    if not (v_json ? 'metodo_preferido' and v_json ? 'conectada' and v_json ? 'banco'
            and v_json ? 'banco_wise' and v_json ? 'canales') then
      raise exception 'datos_de_cobro_del_tutor perdió alguna clave: %', v_json;
    end if;
    if v_json -> 'metodo_preferido' <> 'null'::jsonb then
      raise exception 'un tutor sin fila de preferencia debería dar metodo_preferido null: %', v_json;
    end if;
  end if;
end $$;
