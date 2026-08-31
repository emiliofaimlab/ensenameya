-- ============================================================================
-- Enséñame Ya — baja de cuenta CON DINERO EN VUELO: se desactiva, se liquida,
-- y la anonimización ocurre después sola.
--
-- LO QUE PIDIÓ EL CLIENTE, literal: «¿qué pasa si le doy a borrar mi cuenta y
-- tengo saldo, o estoy esperando un reembolso, o un retiro pendiente? En ese
-- caso debemos DESACTIVAR la cuenta hasta que se haga ese pago, ese retiro, ese
-- reembolso, y LUEGO la borramos. Algo como cuando compras una suscripción y la
-- cancelas: la tienes hasta que llega la fecha de cobro y entonces se quita.»
--
-- Hoy (EY-192, `20260826230000`) esos tres casos **impiden pedir la baja**: la
-- pantalla enseña «todavía no puedes darte de baja» y no hay botón. Funciona,
-- pero le pasa el trabajo a la persona: tiene que volver dentro de dos semanas
-- a repetir la operación, y si no vuelve se queda con una cuenta que ya no
-- quiere. Esto invierte la carga.
--
-- ── LO QUE **NO** CAMBIA, Y ES LO IMPORTANTE ────────────────────────────────
-- `anonymize_account` NO SE TOCA. Sigue siendo la misma función atómica e
-- idempotente, sigue negándose a correr mientras queden bloqueos, y sigue
-- siendo la única que borra la identidad. Lo que se añade delante es un ESTADO
-- DE ESPERA; lo que se añade detrás es quién la llama cuando la espera acaba.
-- Todo lo que EY-192 razonó sobre qué se borra y qué se conserva sigue en pie.
--
-- Tampoco cambia el contrato de `account_deletion_blockers(uuid)`: sigue
-- devolviendo el mapa plano de motivos y `{}` cuando hay vía libre. Lo que
-- ocurre es que ahora es una VISTA de la función nueva (§2), para que no
-- existan dos definiciones de «no puedes» que puedan divergir.
--
-- ── LOS DOS TIPOS DE BLOQUEO, Y POR QUÉ HAY QUE SEPARARLOS ──────────────────
-- La lista de EY-192 mete cinco cosas en el mismo saco. No lo son: unas se
-- resuelven SOLAS con el tiempo y otras exigen que la persona haga algo. Y esa
-- diferencia es exactamente la que decide si la baja se puede programar.
--
-- **ACCIONABLES** — la baja NO se puede ni pedir. Nadie más las va a resolver:
--
--   · `clases_futuras_como_tutor` — `sessions` suyas en 'scheduled'/'in_progress'
--     con `start_at > now()`. Son clases YA VENDIDAS a terceros. Solo se
--     resuelven impartiéndolas (o cancelándolas el alumno), y para impartirlas
--     hace falta entrar en la sala: programar la baja aquí sería un INTERBLOQUEO
--     —la cuenta desactivada esperando unas clases que la propia desactivación
--     impide dar—. Sigue bloqueando, y se explica por qué.
--   · `clases_futuras_como_alumno` — idem por `student_id`. Aquí sí hay salida
--     propia: cancelar desde «Mis reservas», que pasa por `cancel_booking` y
--     aplica RN-37 (≥24 h 100 %, <24 h 50 %). Es un clic suyo, no una espera.
--     ⚠️ Y es EL CAMINO NORMAL hacia este estado nuevo: cancela → se le encola
--     el reembolso → pide la baja → cuenta desactivada esperando ese reembolso.
--
-- **EN ESPERA** — dinero en vuelo que se liquida solo. Desactivan y programan:
--
--   · `saldo_sin_liquidar` — `sum(payments.tutor_net_amount)` de pagos 'paid'
--     de reservas 'completed' suyas que todavía no están en ningún
--     `payout_item`. Es su dinero: clases dadas, alumno cobrado, tutor no
--     pagado. Se liquida SOLO: retención de 7 días desde `completed_at` (DP-02)
--     → `run-payout-batch` (pg_cron, lunes 03:00) crea el payout →
--     `process-payouts` (cada 10 min) lo paga. Peor caso ≈ 14 días. Ese plazo
--     ES la «fecha de cobro» de la analogía del cliente.
--   · `payouts_en_curso` — `payouts` suyos en 'pending','scheduled',
--     'processing','on_hold' **y 'failed'**. Retiro emitido que no ha
--     aterrizado. Los tres primeros los cierra `process-payouts` solo.
--     ⚠️ 'failed' y 'on_hold' NO: necesitan a un admin (`admin_payout_action`
--     'retry'/'release'). Se incluyen igual —es dinero que se le debe y
--     anonimizar a quien no has pagado no es una opción— y a cambio §6 cuenta
--     las bajas ESTANCADAS para que se vean.
--     ⚠️ 'failed' es NUEVO en la lista: EY-192 lo dejaba fuera, así que hoy un
--     tutor con un retiro fallido puede darse de baja y quedarse sin cobrar sin
--     que nadie se entere. Eso se arregla aquí.
--   · `reembolsos_pendientes` — `refund_requests` en 'pending' de reservas
--     suyas como alumno. Dinero que le debemos y que ejecuta
--     `/api/cron/refunds-process` contra el PSP.
--
-- ── LO QUE **NO** ES DINERO EN VUELO, Y POR QUÉ (mirado, no supuesto) ───────
--   · `payments` en 'pending'/'authorized' — no hace falta bloquear por ellos.
--     Las `sessions` se crean AL RESERVAR, antes de cobrar
--     (`20260827150000:443`), así que una reserva sin pagar YA cuenta como
--     clase futura; y si el cobro no llega, `expire_stale_bookings` la cancela
--     a los 7 minutos (`20260826120000`). Añadirlos sería contar dos veces lo
--     mismo y bloquear siete minutos por nada.
--   · `late_payment_refunds` (X-02) — append-only: la fila se escribe DESPUÉS
--     de que el webhook ya haya devuelto el dinero. No hay estado pendiente.
--   · `orders` en 'pending_payment' — se resuelven por sus reservas, que ya
--     están contadas arriba. Un pedido cuyas reservas vencieron se queda en
--     'pending_payment' para siempre a propósito (`20260827150000`): bloquear
--     por él sería bloquear para siempre por un cobro que nunca ocurrió.
--   · Reembolsos del lado TUTOR — no existen: `refund_requests` cuelga de la
--     reserva y el que cobra la devolución es siempre el alumno.
--   · Saldo del ALUMNO — no existe. No hay monedero ni crédito en el modelo;
--     «saldo» en este proyecto significa siempre saldo del tutor.
--
-- ── QUÉ SIGNIFICA «DESACTIVADA» (decidido aquí, no en la pantalla) ──────────
-- **Fuera del mercado, dentro de la cuenta.** Punto por punto:
--
--   · ✅ PUEDE ENTRAR. Es la decisión menos obvia y la más importante. La
--     alternativa —banear como hace EY-189 con las suspensiones de
--     moderación— le cierra la puerta a alguien A QUIEN SE LE DEBE DINERO: no
--     podría ver su reembolso llegar, ni consultar su saldo, ni arrepentirse,
--     ni saber por qué sigue esperando. Tendría que escribir a soporte para
--     todo. Y si la baja se estanca (un payout 'failed'), se queda encerrado
--     fuera de una cuenta con dinero dentro. Así que NO se banea y NO se matan
--     las sesiones: eso es de la anonimización, que ya lo hace.
--   · ❌ DESAPARECE DEL CATÁLOGO si es tutor: `approval_status = 'suspended'`
--     —lo que ya miran las consultas públicas, que filtran `= 'approved'`— y
--     sus mentorías 'active' pasan a 'paused'.
--     ⚠️ 'paused' y NO 'archived' a propósito: esto es REVERSIBLE. `archived`
--     es el estado terminal que usa la anonimización, y volver de ahí no es
--     una operación que la pantalla del tutor ofrezca. Los ids que se pausaron
--     se guardan en la fila (`prev_active_products`) para poder devolvérselos
--     tal cual si se arrepiente: sin eso, cancelar la baja le dejaría el
--     catálogo apagado y sin forma de saber qué estaba encendido.
--   · ❌ NO PUEDE RESERVAR NI SER RESERVADO — §5, trigger sobre `bookings`.
--     Sin eso, una compra nueva volvería a llenar la lista de bloqueos y la
--     baja no se completaría nunca.
--   · ✅ CONSERVA EL ROL `tutor`. Diferencia deliberada con EY-189, que lo
--     retira: el rol es lo que le da acceso a «Mis ingresos», que es
--     literalmente la pantalla donde ve el dinero que está esperando.
--     Quitárselo sería esconderle lo único que le importa ahora mismo.
--   · ✅ LE SIGUEN LLEGANDO LOS AVISOS. No se silencia nada, y no hace falta
--     tocar la cola: los que quedan por llegarle son NTF-10 (reembolso) y
--     NTF-13 (retiro pagado), o sea justo los que está esperando.
--     ⚠️ Y NO se encola ningún aviso nuevo de «baja programada»: la persona
--     está mirando la pantalla cuando la pide y esa pantalla se lo dice con
--     detalle; y el aviso de «ya se completó» no tendría a dónde llegar —la
--     anonimización reescribe el correo y borra sus `notifications`—. Una
--     plantilla más para un mensaje que nadie lee no es una plantilla más.
--   · ✅ PUEDE ARREPENTIRSE mientras no se haya completado (§4). Es la mitad
--     de la analogía del cliente: una suscripción cancelada se puede recuperar
--     hasta la fecha de cobro.
--   · El chat NO se toca: el hilo es compartido y la otra persona merece
--     respuesta (misma trampa 5 de EY-192).
--   · Su nombre y su foto siguen ahí. La identidad se borra al COMPLETAR, no
--     al pedir: hasta entonces puede volverse atrás, y una lápida reversible
--     sería lo peor de los dos mundos.
--
-- ⚠️ EFECTO LATERAL QUE HAY QUE CONOCER: un tutor con la baja programada sale
-- en el panel de admin con `approval_status='suspended'` pero SIN fila en
-- `account_suspensions` (EY-189). Es correcto —no es una sanción y el admin no
-- debe poder «levantarla»— pero si alguien busca por qué está suspendido, el
-- porqué está en `account_deletion_requests`, no en la tabla de moderación.
--
-- ── CÓMO SE COMPLETA DESPUÉS (§6 y §7), Y POR QUÉ SON DOS COSAS ─────────────
-- 1 · `pg_cron` diario → `process_pending_account_deletions()`, que recomprueba
--     los bloqueos y llama a `anonymize_account`. Va DENTRO de la base a
--     propósito: no depende de Vercel, ni de GitHub Actions, ni de que nadie
--     añada una variable. Funciona en cuanto esta migración aterriza.
-- 2 · Los FICHEROS de Storage no los puede barrer el SQL —Supabase lo prohíbe,
--     error 42501, ver `20260827100000`—, así que `anonymize_account` los deja
--     recolectados en `account_deletions.summary.ficheros`, que es el MISMO
--     estado recuperable que ya existe hoy cuando el barrido del handler falla.
--     Los barre `POST /api/cuenta/eliminar/barrido` (service_role + Storage
--     API), que es el único sitio que puede.
--     ⚠️ Ese endpoint necesita un reloj (una línea en `.github/workflows/`);
--     mientras no lo tenga, las rutas se quedan en `summary` y se barren a mano
--     desde el panel de Storage. No se pierde nada: solo se retrasa.
--
-- ⚠️ REGLA DE ORO 11 — un `pg_cron` que falla no se lo dice a nadie, y
-- `create or replace` valida la sintaxis, no ejecuta el cuerpo. TRAS APLICAR
-- ESTA MIGRACIÓN hay que mirar la primera corrida:
--
--   select j.jobname, d.status, d.return_message, d.start_time
--     from cron.job_run_details d join cron.job j using (jobid)
--    where j.jobname = 'complete-pending-account-deletions'
--    order by d.start_time desc limit 5;
--
-- Y como es un job DIARIO, no sale leyendo las diez últimas filas de la tabla:
-- hay que filtrar por `jobname` (misma trampa que `run-payout-batch`).
-- El otro termómetro, este sin esperar a mañana:
--
--   select public.process_pending_account_deletions();
-- ============================================================================


-- ── 1) El estado de «baja pendiente» ────────────────────────────────────────
-- Tabla aparte y no `profiles.deletion_requested_at`, por la trampa que ya
-- documentaron EY-192 y EY-189: `20260703120000:16` hace
-- `grant select, update on public.profiles to authenticated` sobre LA TABLA
-- ENTERA, así que una columna nueva ahí nace escribible por el propio usuario
-- vía PostgREST y `profiles_update_own` la deja pasar. Cualquiera podría
-- marcarse la baja como completada, o quitársela, sin pasar por aquí. Y el
-- `revoke update (columna)` es un no-op mientras exista el grant de tabla.

-- Guardado por `if not exists` como el enum de `20260722160000`: `create type`
-- a secas revienta si alguien reaplica el fichero, y esta migración lleva
-- dentro un `cron.schedule` que sí está escrito para poder reaplicarse.
do $$
begin
  if not exists (
    select 1 from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where t.typname = 'account_deletion_request_status' and n.nspname = 'public'
  ) then
    create type public.account_deletion_request_status as enum (
      'pending',    -- desactivada, esperando a que el dinero termine de moverse
      'completed',  -- `anonymize_account` ya corrió: la identidad está borrada
      'cancelled'   -- se arrepintió antes de que se completara
    );
  end if;
end;
$$;

-- Una fila por persona: la última petición pisa a la anterior. Igual que
-- `account_suspensions` (EY-189) y por el mismo motivo — la pregunta que hace
-- la pantalla es «¿tengo una baja en curso?», y para eso el historial sobra y
-- además se puede desincronizar. Si algún día hace falta, esto pasa a tener
-- `id` propio y la consulta de estado se vuelve un `order by … limit 1`.
create table if not exists public.account_deletion_requests (
  user_id       uuid        primary key references public.profiles (id) on delete cascade,
  status        public.account_deletion_request_status not null default 'pending',
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz,
  cancelled_at  timestamptz,

  -- Lo que estaba en vuelo EN EL MOMENTO DE PEDIRLA. No se usa para decidir
  -- nada —eso se recalcula siempre, porque el dinero se mueve— pero es el
  -- «por qué» de esta fila cuando alguien la mire dentro de un mes.
  pending_snapshot jsonb    not null default '{}'::jsonb,

  -- Lo que hay que devolverle si se arrepiente. Se guarda AL DESACTIVAR porque
  -- después ya no se puede saber: el estado se pisó con 'suspended' y las
  -- mentorías con 'paused'. Mismo patrón que `account_suspensions.prev_approval`.
  prev_approval        public.tutor_approval_status,
  prev_active_products uuid[]      not null default '{}',

  -- El rastro del job. `last_error` es lo ÚNICO que queda escrito cuando una
  -- baja no consigue completarse: el `return` de la función se lo lleva el
  -- viento de `cron.job_run_details` y ahí solo caben las corridas recientes.
  last_check_at timestamptz,
  last_error    text
);

comment on table public.account_deletion_requests is
  'Bajas de cuenta PROGRAMADAS: la persona la pidió teniendo dinero en vuelo (saldo sin liquidar, retiro en curso o reembolso pendiente), así que la cuenta se desactivó y la anonimización espera. `status=pending` = desactivada ahora mismo. La completa `process_pending_account_deletions()` por pg_cron cuando `account_deletion_blockers` se queda vacío. La baja INMEDIATA (sin dinero en vuelo) no pasa por aquí: va directa a `anonymize_account` y deja rastro en `account_deletions`.';

comment on column public.account_deletion_requests.prev_active_products is
  'Ids de las mentorías que estaban `active` al desactivar y que se pasaron a `paused`. Sin esta lista, cancelar la baja dejaría el catálogo apagado sin forma de saber qué estaba encendido.';

comment on column public.account_deletion_requests.last_error is
  'Último error al intentar completar la baja. Es el rastro duradero: `cron.job_run_details` solo guarda las corridas recientes y un job diario se cae de esa ventana enseguida.';

-- Índice parcial: la única consulta caliente es «las pendientes, la más vieja
-- primero», que es la del job. El `::` explícito no es adorno — un predicado de
-- índice tiene que ser inmutable, y con enums el cast implícito es justo el
-- sitio donde este proyecto ya se quemó una vez (`close_expired_sessions`,
-- 12.446 corridas rojas por un `case` sin `::session_status`).
create index if not exists account_deletion_requests_pendientes_idx
  on public.account_deletion_requests (requested_at)
  where status = 'pending'::public.account_deletion_request_status;

-- Regla de oro 1: default-deny. Nace con RLS y con dos políticas de LECTURA y
-- ninguna de escritura — todo lo que escribe aquí son las funciones de §3, §4
-- y §6, que son `security definer` y corren como el dueño.
alter table public.account_deletion_requests enable row level security;

-- La persona ve la suya: es lo que pinta «Mi cuenta» para explicarle por qué
-- está desactivada. Solo lectura; para quitarla está `cancel_account_deletion`.
drop policy if exists "account_deletion_requests_select_own" on public.account_deletion_requests;
create policy "account_deletion_requests_select_own"
  on public.account_deletion_requests for select
  using ( (select auth.uid()) = user_id );

drop policy if exists "account_deletion_requests_select_admin" on public.account_deletion_requests;
create policy "account_deletion_requests_select_admin"
  on public.account_deletion_requests for select
  using ( public.has_role('admin') );

-- Regla de oro 9: `service_role` se salta la RLS pero NO los grants de tabla, y
-- este proyecto tiene "auto-expose new tables" OFF. Sin esto, cualquier lectura
-- desde un job o desde un Route Handler come `permission denied` EN EJECUCIÓN
-- —no en el build, no en el typecheck—, que es la mordida del 6-ago.
grant select on public.account_deletion_requests to authenticated;
grant select on public.account_deletion_requests to service_role;


-- ── 2) Una sola definición de «no puedes», ahora clasificada ────────────────
-- Sustituye al cuerpo de `account_deletion_blockers`, que pasa a ser una vista
-- de esta (más abajo). Dos definiciones separadas divergirían el primer día que
-- alguien añadiera un estado nuevo a `payout_status`.
--
-- ⚠️ TODOS los importes y fechas descriptivos van con `case when … > 0`. No es
-- cosmética: si `saldo_moneda` apareciera con el saldo a cero, `en_espera` no
-- estaría vacío, `account_deletion_blockers` tampoco, y la baja programada NO
-- SE COMPLETARÍA JAMÁS. El `case` es lo que impide ese punto muerto.

create or replace function public.account_deletion_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  -- Clases futuras ya vendidas. Se mira `sessions` y no `bookings` porque la
  -- fecha vive ahí: `create_booking` mete una sesión por hueco del paquete.
  futuras_tutor as (
    select count(*) as n from public.sessions s
     where s.tutor_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  futuras_alumno as (
    select count(*) as n from public.sessions s
     where s.student_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  -- Saldo pendiente. La definición de «liquidable» se copia LITERALMENTE de
  -- `tutor_balance` (`20260716150000`), que a su vez la comparte con
  -- `build_payout_for_tutor`: una sola fuente para los tres. Se juntan
  -- `available` e `in_retention` porque para darse de baja da igual que la
  -- retención haya vencido o no — es dinero suyo que todavía no ha cobrado.
  --
  -- `ultimo_completado` es lo que permite decirle CUÁNDO: la retención de 7
  -- días (DP-02, el default de `run_payout_batch`) corre desde `completed_at`,
  -- así que el saldo entero es liquidable a partir del último + 7 días. La
  -- pantalla lo redondea al lote semanal; aquí se da el dato crudo.
  sin_liquidar as (
    select coalesce(sum(p.tutor_net_amount), 0) as importe,
           count(distinct p.currency)           as monedas,
           min(p.currency)                      as moneda,
           max(b.completed_at)                  as ultimo_completado
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.tutor_id = p_user_id
       and p.status   = 'paid'
       and b.status   = 'completed'
       and not exists (
         select 1 from public.payout_items pi where pi.payment_id = p.id
       )
  ),
  -- Dinero ya en vuelo: un retiro emitido que aún no ha aterrizado.
  -- ⚠️ 'failed' está DENTRO, a diferencia de EY-192: un payout fallido es
  -- dinero que se le debe y que espera un `admin_payout_action('retry')`.
  -- Dejarlo fuera dejaba anonimizar a quien no habías pagado.
  payouts_vivos as (
    select count(*) as n from public.payouts po
     where po.tutor_id = p_user_id
       and po.status in ('pending', 'scheduled', 'processing', 'on_hold', 'failed')
  ),
  -- Reembolso pendiente HACIA el alumno. No bloquea por el dinero —el abono va
  -- contra el pago del PSP, no contra el perfil— sino porque irse mientras te
  -- deben algo deja a la persona sin a dónde reclamar.
  reembolsos_vivos as (
    select count(*) as n
      from public.refund_requests rr
      join public.bookings b on b.id = rr.booking_id
     where b.student_id = p_user_id
       and rr.status = 'pending'
  )
  select jsonb_build_object(
    'accionables', jsonb_strip_nulls(jsonb_build_object(
      'clases_futuras_como_tutor',
        case when (select n from futuras_tutor)  > 0 then (select n from futuras_tutor)  end,
      'clases_futuras_como_alumno',
        case when (select n from futuras_alumno) > 0 then (select n from futuras_alumno) end
    )),
    'en_espera', jsonb_strip_nulls(jsonb_build_object(
      'saldo_sin_liquidar',
        case when (select importe from sin_liquidar) > 0
             then (select importe from sin_liquidar) end,
      -- Solo cuando hay UNA moneda: con varias, sumar no significa nada
      -- (RN-13) y la pantalla se calla el importe en vez de mentirlo.
      'saldo_moneda',
        case when (select importe from sin_liquidar) > 0
              and (select monedas from sin_liquidar) = 1
             then (select moneda from sin_liquidar) end,
      'saldo_liquidable_desde',
        case when (select importe from sin_liquidar) > 0
             then (select ultimo_completado + interval '7 days' from sin_liquidar) end,
      'payouts_en_curso',
        case when (select n from payouts_vivos)   > 0 then (select n from payouts_vivos)   end,
      'reembolsos_pendientes',
        case when (select n from reembolsos_vivos) > 0 then (select n from reembolsos_vivos) end
    ))
  );
$$;

comment on function public.account_deletion_state(uuid) is
  'Motivos por los que una cuenta no puede anonimizarse TODAVÍA, separados en `accionables` (la persona tiene que hacer algo: dar o cancelar clases futuras) y `en_espera` (dinero en vuelo que se liquida solo: saldo, retiro, reembolso). Los `accionables` impiden pedir la baja; los `en_espera` la PROGRAMAN. Ver la cabecera de la migración para el porqué de cada fila.';

revoke execute on function public.account_deletion_state(uuid) from public;
revoke execute on function public.account_deletion_state(uuid) from anon;
revoke execute on function public.account_deletion_state(uuid) from authenticated;
grant  execute on function public.account_deletion_state(uuid) to service_role;

-- El contrato de EY-192, intacto: mapa plano de motivos, `{}` = vía libre. Lo
-- siguen llamando `anonymize_account` (su segundo cerrojo), el Route Handler y
-- ahora el job de §6. Pasa a ser una vista de la función de arriba para que no
-- haya dos definiciones de «no puedes».
--
-- ⚠️ Las dos claves DESCRIPTIVAS de `en_espera` se quitan del merge con el
-- operador `-`. Es doble cinturón sobre el mismo punto muerto que ya evitan los
-- `case`: aquí no puede colarse nunca una clave que no sea un motivo real, así
-- que `anonymize_account` no puede quedarse bloqueada por un dato de pantalla.
create or replace function public.account_deletion_blockers(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(e.s -> 'accionables', '{}'::jsonb)
         || (coalesce(e.s -> 'en_espera', '{}'::jsonb)
             - 'saldo_moneda' - 'saldo_liquidable_desde')
    from (select public.account_deletion_state(p_user_id) as s) e;
$$;

comment on function public.account_deletion_blockers(uuid) is
  'EY-192: motivos por los que una cuenta NO puede ANONIMIZARSE, como jsonb plano. Objeto vacío = vía libre, y es lo que exige `anonymize_account` por dentro. Desde la baja programada es una vista de `account_deletion_state`: los `accionables` impiden pedir la baja, los `en_espera` solo la retrasan, pero para BORRAR hacen falta los dos vacíos.';

revoke execute on function public.account_deletion_blockers(uuid) from public;
revoke execute on function public.account_deletion_blockers(uuid) from anon;
revoke execute on function public.account_deletion_blockers(uuid) from authenticated;
grant  execute on function public.account_deletion_blockers(uuid) to service_role;

-- Lo que lee la pantalla «Mi cuenta». Es la única de esta familia que puede
-- llamar `authenticated`, y solo puede preguntar por SÍ MISMA: no acepta uid,
-- lo saca de `auth.uid()`. Devuelve el estado RECALCULADO (no el snapshot: el
-- dinero se mueve y lo que hay que enseñar es lo que queda hoy) más la fila de
-- la baja si existe.
create or replace function public.my_account_deletion_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_req   record;
  v_baja  jsonb := null;
begin
  if v_uid is null then
    raise exception 'auth requerido' using errcode = '28000';
  end if;

  select r.requested_at, r.last_check_at, r.last_error
    into v_req
    from public.account_deletion_requests r
   where r.user_id = v_uid
     and r.status = 'pending'::public.account_deletion_request_status;

  if found then
    v_baja := jsonb_build_object(
      'requested_at',  v_req.requested_at,
      'last_check_at', v_req.last_check_at,
      'last_error',    v_req.last_error
    );
  end if;

  return public.account_deletion_state(v_uid)
         || jsonb_build_object('baja_programada', v_baja);
end;
$$;

comment on function public.my_account_deletion_state() is
  'Estado de baja de la cuenta que llama: `accionables`, `en_espera` (los dos recalculados ahora, no el snapshot) y `baja_programada` con la fila pendiente si la hay. Lo pinta «Mi cuenta».';

revoke execute on function public.my_account_deletion_state() from public;
revoke execute on function public.my_account_deletion_state() from anon;
grant  execute on function public.my_account_deletion_state() to authenticated;
grant  execute on function public.my_account_deletion_state() to service_role;


-- ── 3) Pedir la baja: desactivar y programar ────────────────────────────────
-- Recibe el uid por parámetro y NO lee `auth.uid()`, exactamente como
-- `anonymize_account` y por lo mismo: la llama el Route Handler con
-- `service_role`, que no tiene sesión. Quién puede dar de baja a quién se
-- decide EN EL HANDLER, y la respuesta sigue siendo «solo a uno mismo».
--
-- NO anonimiza nada, ni siquiera cuando no hay nada que esperar: en ese caso
-- devuelve 'sin_espera' y es el handler quien llama a `anonymize_account`,
-- porque el barrido de ficheros de Storage vive allí (error 42501, ver
-- `20260827100000`). Esta función jamás borra identidad.

create or replace function public.request_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado jsonb;
  v_accion jsonb;
  v_espera jsonb;
  v_prev   public.tutor_approval_status;
  v_prods  uuid[];
begin
  if p_user_id is null then
    raise exception 'falta el usuario' using errcode = '22004';
  end if;

  -- Ya anonimizada: no hay nada que programar. En la práctica no se llega
  -- (la sesión está muerta y el handler devuelve 401 antes), pero una función
  -- que mueve estados no puede fiarse de eso.
  if exists (select 1 from public.account_deletions ad where ad.user_id = p_user_id) then
    return jsonb_build_object('status', 'ya_anonimizada');
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'la cuenta no existe' using errcode = 'P0002';
  end if;

  -- IDEMPOTENCIA, y va lo PRIMERO. Un doble clic o un reintento por timeout
  -- tiene que devolver la baja que ya existe, no volver a pausar mentorías ni
  -- —peor— reescribir `prev_active_products` con la lista ya vaciada, que
  -- dejaría el catálogo apagado para siempre al cancelar.
  if exists (
    select 1 from public.account_deletion_requests r
     where r.user_id = p_user_id
       and r.status = 'pending'::public.account_deletion_request_status
  ) then
    return jsonb_build_object(
      'status',    'ya_programada',
      'en_espera', public.account_deletion_state(p_user_id) -> 'en_espera'
    );
  end if;

  v_estado := public.account_deletion_state(p_user_id);
  v_accion := v_estado -> 'accionables';
  v_espera := v_estado -> 'en_espera';

  -- Hay cosas que solo puede resolver la persona: no se programa nada. Se
  -- devuelven las dos listas para que la pantalla explique el camino completo
  -- («cancela estas clases y entonces sí»).
  if v_accion <> '{}'::jsonb then
    return jsonb_build_object(
      'status', 'bloqueada', 'accionables', v_accion, 'en_espera', v_espera
    );
  end if;

  -- Vía libre de verdad: que la borre el handler ahora mismo. Programar una
  -- baja que se completaría esta noche sería peor que hacerla ya.
  if v_espera = '{}'::jsonb then
    return jsonb_build_object('status', 'sin_espera');
  end if;

  -- ── Desactivar ───────────────────────────────────────────────────────────
  -- Lo que se pisa se guarda ANTES, que es la única ventana en la que todavía
  -- se sabe (mismo motivo que `account_suspensions.prev_approval`).
  select tp.approval_status into v_prev
    from public.tutor_profiles tp where tp.profile_id = p_user_id;

  select coalesce(array_agg(pr.id), '{}')
    into v_prods
    from public.products pr
   where pr.tutor_id = p_user_id
     and pr.status = 'active'::public.product_status;

  -- 'paused' y no 'archived': esto es reversible (ver cabecera).
  update public.products
     set status = 'paused'::public.product_status
   where tutor_id = p_user_id
     and status = 'active'::public.product_status;

  -- Lo que lo saca del catálogo: las consultas públicas filtran 'approved'.
  -- Si ya estaba 'suspended' (moderación) no se toca — y `v_prev` guarda ese
  -- 'suspended', así que cancelar la baja no le levantará la sanción.
  if v_prev is not null and v_prev <> 'suspended'::public.tutor_approval_status then
    update public.tutor_profiles
       set approval_status = 'suspended'::public.tutor_approval_status
     where profile_id = p_user_id;
  end if;

  insert into public.account_deletion_requests
    (user_id, status, requested_at, pending_snapshot, prev_approval, prev_active_products,
     completed_at, cancelled_at, last_check_at, last_error)
  values
    (p_user_id, 'pending'::public.account_deletion_request_status, now(), v_espera, v_prev, v_prods,
     null, null, null, null)
  -- Reincidencia: quien canceló su baja y vuelve a pedirla reutiliza la fila.
  on conflict (user_id) do update
    set status               = 'pending'::public.account_deletion_request_status,
        requested_at         = now(),
        pending_snapshot     = excluded.pending_snapshot,
        prev_approval        = excluded.prev_approval,
        prev_active_products = excluded.prev_active_products,
        completed_at         = null,
        cancelled_at         = null,
        last_check_at        = null,
        last_error           = null;

  return jsonb_build_object('status', 'programada', 'en_espera', v_espera);
end;
$$;

comment on function public.request_account_deletion(uuid) is
  'Pide la baja. Si hay dinero en vuelo (`en_espera`) DESACTIVA la cuenta —tutor fuera del catálogo, mentorías en pausa— y la programa; la anonimización la hace después `process_pending_account_deletions`. Devuelve `sin_espera` cuando no hay nada que esperar, para que el Route Handler anonimice en el acto (el barrido de Storage vive allí). Nunca borra identidad. Idempotente. Solo `service_role`.';

revoke execute on function public.request_account_deletion(uuid) from public;
revoke execute on function public.request_account_deletion(uuid) from anon;
revoke execute on function public.request_account_deletion(uuid) from authenticated;
grant  execute on function public.request_account_deletion(uuid) to service_role;


-- ── 4) Arrepentirse ─────────────────────────────────────────────────────────
-- La otra mitad de la analogía del cliente. Devuelve lo que se pisó y NADA más:
-- no toca reservas, ni pagos, ni la cola de reembolsos — nada de eso se detuvo
-- al desactivar, así que no hay nada que reanudar.

create or replace function public.cancel_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
begin
  if p_user_id is null then
    raise exception 'falta el usuario' using errcode = '22004';
  end if;

  select r.prev_approval, r.prev_active_products
    into v_req
    from public.account_deletion_requests r
   where r.user_id = p_user_id
     and r.status = 'pending'::public.account_deletion_request_status;

  if not found then
    return jsonb_build_object('status', 'sin_baja');
  end if;

  -- ⚠️ Solo se devuelve el estado de tutor si la suspensión sigue siendo LA
  -- NUESTRA. Dos guardas, y las dos hacen falta:
  --   · `prev_approval <> 'suspended'` → si ya estaba suspendido antes de
  --     pedir la baja, no había nada que pisar y no hay nada que devolver;
  --   · sin suspensión de moderación viva (EY-189) → si un admin lo sancionó
  --     mientras esperaba, cancelar la baja NO puede levantarle la sanción.
  -- El `where approval_status = 'suspended'` de abajo es la tercera: si el
  -- admin ya lo movió a otro estado, esto no lo pisa.
  if v_req.prev_approval is not null
     and v_req.prev_approval <> 'suspended'::public.tutor_approval_status
     and not exists (
       select 1 from public.account_suspensions s
        where s.user_id = p_user_id and s.lifted_at is null
     )
  then
    update public.tutor_profiles
       set approval_status = v_req.prev_approval
     where profile_id = p_user_id
       and approval_status = 'suspended'::public.tutor_approval_status;
  end if;

  -- Solo las que pausamos nosotros, y solo si siguen pausadas: si el tutor
  -- archivó alguna desde su panel mientras esperaba, era su decisión.
  update public.products
     set status = 'active'::public.product_status
   where tutor_id = p_user_id
     and id = any(v_req.prev_active_products)
     and status = 'paused'::public.product_status;

  update public.account_deletion_requests
     set status       = 'cancelled'::public.account_deletion_request_status,
         cancelled_at = now(),
         last_error   = null
   where user_id = p_user_id
     and status = 'pending'::public.account_deletion_request_status;

  return jsonb_build_object('status', 'cancelada');
end;
$$;

comment on function public.cancel_account_deletion(uuid) is
  'Cancela una baja programada y reactiva la cuenta: devuelve el `approval_status` del tutor y vuelve a poner `active` las mentorías que se pausaron. No levanta una suspensión de moderación (EY-189) si la hay. Solo `service_role`.';

revoke execute on function public.cancel_account_deletion(uuid) from public;
revoke execute on function public.cancel_account_deletion(uuid) from anon;
revoke execute on function public.cancel_account_deletion(uuid) from authenticated;
grant  execute on function public.cancel_account_deletion(uuid) to service_role;


-- ── 5) Una cuenta desactivada no compra ni vende ────────────────────────────
-- Sin esto, la baja programada NO SE COMPLETARÍA NUNCA: una reserva nueva crea
-- sesiones futuras (`20260827150000:443`), o sea un bloqueo `accionable`, y el
-- job de §6 se limitaría a saltársela cada noche para siempre.
--
-- ⚠️ Va como TRIGGER sobre `bookings` y no como comprobación dentro de
-- `create_booking`, a propósito: hay tres caminos que insertan reservas
-- —`create_booking`, `create_booking_line` (pedido multilínea) y el checkout de
-- invitado— y los tres pasan por aquí. Un `if` en una de las tres funciones
-- sería un agujero por las otras dos, y encima obligaría a reescribir funciones
-- de dinero para añadir una guarda que no es de dinero.
--
-- Cubre los DOS lados. Que el tutor esté fuera del catálogo ya lo hace casi
-- imposible, pero «casi» no vale para una fila de `bookings`: un enlace directo
-- a la ficha guardado en un marcador se salta el catálogo entero.

create or replace function public.bookings_rechaza_baja_pendiente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.account_deletion_requests r
     where r.status = 'pending'::public.account_deletion_request_status
       and r.user_id in (new.student_id, new.tutor_id)
  ) then
    raise exception
      'no se puede reservar: una de las dos cuentas está desactivada a la espera de darse de baja'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_sin_baja_pendiente on public.bookings;
create trigger bookings_sin_baja_pendiente
  before insert on public.bookings
  for each row execute function public.bookings_rechaza_baja_pendiente();


-- ── 6) Quien la completa ────────────────────────────────────────────────────
-- Recomprueba los bloqueos —TODOS, no solo los que había al pedirla— y llama a
-- `anonymize_account`, que es la misma función de siempre con su mismo segundo
-- cerrojo dentro. Esta función no sabe anonimizar: sabe *cuándo*.
--
-- ⚠️ CADA FILA VA EN SU PROPIO BLOQUE `begin … exception`. Eso abre una
-- subtransacción: si una cuenta revienta, se deshace ENTERA (la propiedad
-- atómica de EY-192 se conserva) y la pasada sigue con las demás. Sin esto, un
-- fallo en la primera abortaría la noche completa y nadie se enteraría —regla
-- de oro 11: un pg_cron que falla no se lo dice a nadie—.
--
-- ⚠️ LOS FICHEROS DE STORAGE NO SE BARREN AQUÍ, y no es un olvido: el SQL no
-- puede tocar `storage.objects` (error 42501, `20260827100000`).
-- `anonymize_account` los deja recolectados en `account_deletions.summary`, que
-- es exactamente el estado que el Route Handler ya sabe reanudar. Ver §7 de la
-- cabecera.

create or replace function public.process_pending_account_deletions(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row          record;
  v_res          jsonb;
  v_completadas  int := 0;
  v_esperando    int := 0;
  v_estancadas   int := 0;
  v_errores      int := 0;
  v_ficheros     int := 0;
begin
  for v_row in
    select r.user_id, r.requested_at
      from public.account_deletion_requests r
     where r.status = 'pending'::public.account_deletion_request_status
     order by r.requested_at          -- la más vieja primero: nadie se queda atrás
     limit greatest(1, coalesce(p_limit, 50))
  loop
    begin
      -- ⚠️ `if/else` y no un `continue` que salte fuera del bloque. Este
      -- `begin` lleva `exception`, o sea que es una SUBTRANSACCIÓN, y saltar
      -- fuera de una desde dentro es justo el tipo de detalle que `create or
      -- replace` no valida y que solo se descubre con el job en producción.
      if public.account_deletion_blockers(v_row.user_id) <> '{}'::jsonb then
        v_esperando := v_esperando + 1;
        -- Estancada: lleva más de 30 días esperando. Casi siempre significa un
        -- payout en 'failed' o en 'on_hold' que necesita un `admin_payout_action`
        -- — o sea, dinero parado que nadie está mirando. Se cuenta aquí porque
        -- es el único sitio del sistema que lo mira todas las noches.
        if v_row.requested_at < now() - interval '30 days' then
          v_estancadas := v_estancadas + 1;
        end if;
        update public.account_deletion_requests
           set last_check_at = now(), last_error = null
         where user_id = v_row.user_id;
      else
        v_res := public.anonymize_account(v_row.user_id);
        v_ficheros := v_ficheros + coalesce((v_res ->> 'ficheros_recolectados')::int, 0);

        update public.account_deletion_requests
           set status        = 'completed'::public.account_deletion_request_status,
               completed_at  = now(),
               last_check_at = now(),
               last_error    = null
         where user_id = v_row.user_id
           and status = 'pending'::public.account_deletion_request_status;

        v_completadas := v_completadas + 1;
      end if;
    exception when others then
      -- La cuenta se queda tal cual estaba (la subtransacción se deshizo) y el
      -- motivo queda ESCRITO en su fila: `cron.job_run_details` no guarda
      -- suficientes corridas de un job diario como para encontrarlo allí.
      v_errores := v_errores + 1;
      update public.account_deletion_requests
         set last_check_at = now(),
             last_error    = left(coalesce(sqlerrm, 'error sin mensaje'), 500)
       where user_id = v_row.user_id;
    end;
  end loop;

  return jsonb_build_object(
    'completadas', v_completadas,
    'esperando',   v_esperando,
    'estancadas',  v_estancadas,   -- > 30 días: hay dinero parado, mirar payouts
    'errores',     v_errores,
    -- Ficheros que quedaron recolectados y SIN BARRER en
    -- `account_deletions.summary.ficheros`. Los barre `POST
    -- /api/cuenta/eliminar/barrido`; si este número crece y no baja, ese
    -- endpoint no lo está llamando nadie.
    'ficheros_por_barrer', v_ficheros
  );
end;
$$;

comment on function public.process_pending_account_deletions(int) is
  'Completa las bajas programadas cuyo dinero ya terminó de moverse: recomprueba `account_deletion_blockers` y llama a `anonymize_account`. Una subtransacción por cuenta (un fallo no arrastra a las demás) y el error queda en `account_deletion_requests.last_error`. NO barre los ficheros de Storage —el SQL no puede—: quedan en `account_deletions.summary.ficheros` para `POST /api/cuenta/eliminar/barrido`.';

revoke execute on function public.process_pending_account_deletions(int) from public;
revoke execute on function public.process_pending_account_deletions(int) from anon;
revoke execute on function public.process_pending_account_deletions(int) from authenticated;
grant  execute on function public.process_pending_account_deletions(int) to service_role;


-- ── 6 bis) Lo que el SQL dejó recolectado y no puede barrer ─────────────────
-- El complemento de la función de arriba, para el Route Handler del barrido.
-- Es una RPC y no una consulta desde Next por una razón concreta: el filtro es
-- «`summary->'ficheros'` no vacío», y expresarlo en PostgREST obliga a
-- comparaciones sobre jsonb que se escriben mal con facilidad y que, cuando se
-- escriben mal, no fallan — devuelven de menos. Una lista de barrido que
-- devuelve de menos deja ficheros huérfanos sin que nadie lo note, que es el
-- fallo silencioso que EY-192 se pasó dos migraciones evitando.
--
-- Orden por `deleted_at` ascendente: lo que lleva más tiempo huérfano primero.
create or replace function public.account_deletions_pendientes_de_barrido(p_limit int default 50)
returns table (user_id uuid, ficheros jsonb, ficheros_recolectados int)
language sql
stable
security definer
set search_path = ''
as $$
  select ad.user_id,
         coalesce(ad.summary -> 'ficheros', '{}'::jsonb),
         coalesce((ad.summary ->> 'ficheros_recolectados')::int, 0)
    from public.account_deletions ad
   where coalesce(ad.summary -> 'ficheros', '{}'::jsonb) <> '{}'::jsonb
   order by ad.deleted_at
   limit greatest(1, coalesce(p_limit, 50));
$$;

comment on function public.account_deletions_pendientes_de_barrido(int) is
  'Cuentas ya anonimizadas a las que les quedan ficheros por borrar de Storage (`account_deletions.summary.ficheros`). Lo consume `POST /api/cuenta/eliminar/barrido`, que es el único sitio que puede llamar a la Storage API — el SQL tiene prohibido tocar `storage.objects` (error 42501).';

revoke execute on function public.account_deletions_pendientes_de_barrido(int) from public;
revoke execute on function public.account_deletions_pendientes_de_barrido(int) from anon;
revoke execute on function public.account_deletions_pendientes_de_barrido(int) from authenticated;
grant  execute on function public.account_deletions_pendientes_de_barrido(int) to service_role;


-- ── 7) El reloj ─────────────────────────────────────────────────────────────
-- Diario a las 05:00 y no cada pocos minutos: lo que espera son días (retención
-- de 7 + lote semanal), así que apurar horas no le cambia nada a nadie y sí
-- ahorra 288 pasadas al día que casi siempre no harían nada.
--
-- Las 05:00 tampoco son casualidad. Antes está TODO lo que puede desbloquear
-- una baja o competir con ella: `run-payout-batch` (lunes 03:00),
-- `process-payouts` (cada 10 min), `purge-expired-messages` (04:00) y
-- `purge-tutor-views` (04:30). Con el lote del lunes ya pagado, un tutor que
-- solo esperaba su saldo se va ese mismo lunes.
--
-- `unschedule` + `schedule` con `where exists`: es el patrón de
-- `20260716140000`, `20260716170000`, `20260716180000` y `20260826120000`, y lo
-- hace idempotente sobre una base que aún no tuviera el job.
select cron.unschedule('complete-pending-account-deletions')
 where exists (select 1 from cron.job where jobname = 'complete-pending-account-deletions');

select cron.schedule(
  'complete-pending-account-deletions',
  '0 5 * * *',
  $cron$ select public.process_pending_account_deletions(); $cron$
);
