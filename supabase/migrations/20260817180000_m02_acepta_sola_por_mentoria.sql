-- ============================================================================
-- Enséñame Ya — M-02: la aceptación automática baja del TUTOR a la MENTORÍA
--
-- Petición literal del cliente: «no queremos que todo funcione bajo un global…
-- las que quiero definir quién va, quién es aceptado y quién no, no puedo poner
-- todo global». Hoy `tutor_profiles.auto_accept_bookings` (R24-19) es un único
-- interruptor para todo lo que dicta un tutor: o acepta solo su taller de 6
-- sesiones y su clase de prueba, o ninguno de los dos. Un tutor que quiere
-- filtrar a mano quién entra en su preparación de examen, pero no quiere estar
-- pendiente de las clases sueltas de 30 minutos, no tiene forma de decirlo.
--
-- ⚠️⚠️ ESTO CAMBIA EL COMPORTAMIENTO DE NEGOCIO, Y NO ES UN DETALLE DE UI.
--
-- Con la aceptación automática puesta, la reserva pagada salta directa a
-- `confirmed` y NO PASA POR `pending_acceptance`. Y `pending_acceptance` no es
-- un estado decorativo: es el que arranca la ventana de 24 h de RN-38.
-- `expire_stale_bookings` (20260709190000, rama 2) mira EXACTAMENTE ese estado
-- para, si el tutor no respondió en 24 h desde `payments.paid_at`, cancelar la
-- reserva, liberar las sesiones y dejar el pago en `refunded` por el 100 %.
--
-- Dicho de otra forma: una reserva auto-aceptada YA NO TIENE esa red. Si el
-- tutor luego no aparece, al alumno le queda la cancelación normal (RN-37, con
-- sus porcentajes por antelación) y el no-show, no el reembolso íntegro
-- automático. Antes esto solo le pasaba a quien encendía el interruptor a
-- propósito; con el valor por defecto de abajo le pasa a casi todas las
-- reservas de la plataforma.
--
-- El cliente lo pidió así y así se implementa. Queda escrito aquí para que el
-- día que alguien pregunte «¿por qué esta reserva no se reembolsó sola?» la
-- respuesta esté en la migración y no en la memoria de nadie.
--
-- LO QUE **NO** SE PIERDE, que es fácil suponer lo contrario:
--   · el aviso al tutor. NTF-07 se encola en las DOS transiciones desde
--     20260806160000 (`pending_acceptance` **y** `confirmed`), justamente para
--     cubrir al tutor con auto-aceptar. Sigue enterándose de que tiene clase.
--   · la cancelación del alumno y la del tutor (`cancel_booking`), que aceptan
--     `confirmed` desde siempre.
--   · el reembolso del 100 % cuando cancela el tutor (RN-37, `lib/policy.ts`).
-- ============================================================================

-- ── 1) La columna, en la mentoría ───────────────────────────────────────────
--
-- `default true` = lo que pidió el cliente: nace activada. Y OJO, porque aquí
-- está el BACKFILL sin que se vea: un `add column ... not null default true`
-- rellena TODAS las filas existentes con `true` en el propio ALTER. No hay un
-- `update` más abajo porque no hace falta — y porque escribirlo daría a
-- entender que las filas viejas se tratan distinto, y no es así.
--
-- SE CONSIDERÓ Y SE DESCARTÓ copiar `tutor_profiles.auto_accept_bookings` a
-- cada mentoría (que habría dejado el comportamiento de hoy intacto: ese global
-- nace en `false` y casi nadie lo ha tocado). Se descarta porque el cliente
-- pidió el valor por defecto ACTIVADO, y un backfill conservador dejaría la
-- plataforma entera en `false` el día uno: el tutor abriría su mentoría, vería
-- el interruptor apagado y diría —con razón— que no se hizo lo que pidió. El
-- precio de esa decisión es el aviso de arriba, y es consciente.
--
-- SOBRE LA VISIBILIDAD: `products` la lee `anon` (RN-24, ficha pública), así que
-- esta columna queda a la vista de cualquiera. Se acepta a conciencia: dice si
-- una mentoría se confirma al instante, que es información del producto —lo que
-- otros marketplaces anuncian como «reserva inmediata»—, no un dato del tutor.
-- La vista `tutors_public` no la arrastra: enumera columnas una a una
-- (20260804120000), que es justo para lo que existe esa regla.
alter table public.products
  add column if not exists auto_accept_bookings boolean not null default true;

comment on column public.products.auto_accept_bookings is
  'M-02: si está activo, una reserva PAGADA de esta mentoría salta directa a confirmed y NO pasa por pending_acceptance — y por tanto NO le aplica la ventana de 24 h de RN-38 (cancelación + reembolso 100 % automáticos de expire_stale_bookings). Sustituye a tutor_profiles.auto_accept_bookings, que ya no decide nada.';

-- ── 2) El global queda deprecado, pero NO se borra ──────────────────────────
--
-- DECISIÓN: se RETIRA del camino de decisión (abajo, `confirm_payment` deja de
-- mirarlo), pero la columna se queda. Dos razones, y ninguna es sentimental:
--
--   · dropearla revienta EN RUNTIME el toggle del panel del tutor
--     (`src/app/(app)/tutor/reservas/auto-accept-toggle.tsx`), que hace un
--     `update` sobre ella. Un `drop column` aquí y un `PGRST204` allí.
--   · dejarla como «valor por defecto al crear mentorías» se estudió y no
--     encaja: el default de la columna nueva es `true` y el del global es
--     `false`, así que sembrar desde el global daría mentorías nuevas
--     desactivadas — lo contrario de lo que se pidió. Y un default de columna
--     no puede leer otra tabla; haría falta un trigger que además no sabe
--     distinguir «no me lo mandaron» de «me lo mandaron en true».
--
-- ⚠️ CONSECUENCIA A CERRAR FUERA DE ESTA MIGRACIÓN: a partir de aquí ese toggle
-- del panel del tutor escribe una columna que ya no lee nadie. Es un interruptor
-- inerte y hay que quitarlo o reconvertirlo en «aplicar a todas mis mentorías».
comment on column public.tutor_profiles.auto_accept_bookings is
  'DEPRECADA (M-02, 17-ago-2026). El auto-aceptar vive ahora en products.auto_accept_bookings, por mentoría. confirm_payment ya NO lee esta columna. Se conserva solo para no romper el toggle del panel del tutor mientras se retira.';

-- ── 3) Grants (auto-expose OFF · regla de oro 9) ────────────────────────────
--
-- `products` ya lleva `grant insert, update, delete ... to authenticated` a
-- nivel de TABLA desde EP-04 (20260709120000:79) —«todas las columnas de
-- products son contenido propio del tutor»—, y un grant de tabla cubre también
-- las columnas que lleguen después. O sea: esto es cinturón y tirantes.
--
-- Se escribe igual porque la regla de oro 9 ya mordió cinco veces y siempre en
-- tiempo de EJECUCIÓN, nunca en el typecheck: una línea explícita al lado de la
-- columna cuesta nada y sobrevive al día que alguien estreche el grant de tabla
-- para la moderación de admin (EP-11). Quien la lea sabe que el formulario del
-- tutor puede escribir esto.
grant insert (auto_accept_bookings) on public.products to authenticated;
grant update (auto_accept_bookings) on public.products to authenticated;

-- `service_role` NO necesita grant aquí y conviene decir por qué, para que no
-- se añada «por si acaso»: el único que lee esta columna es `confirm_payment`,
-- que es `security definer` → corre con los privilegios de su dueño, que es el
-- de la tabla, así que ni RLS ni grants le aplican. Es el mismo motivo por el
-- que hoy lee `tutor_profiles` sin tener ni un grant sobre ella. El día que un
-- Route Handler o un job la lea con el cliente admin, ESE día toca el grant.

-- ── 4) confirm_payment v6: el auto-aceptar sale de la MENTORÍA ──────────────
--
-- ⚠️ Cuerpo íntegro de `20260817160000` (X-02, de HOY MISMO), con UN cambio: el
-- join deja de ser contra `tutor_profiles` y pasa a ser contra `products`. Se
-- parte de esa versión y no de R24-19 porque en Postgres una función no se
-- parchea, se reescribe entera, y reescribirla desde la vieja revertiría el
-- arreglo del cobro tardío —el `'failed'` en la lista de idempotencia— sin que
-- nada avise. Se revisó línea a línea; esto es lo que hay que conservar:
--
--   · el dedup por `p_event_id` contra `payment_webhook_events` (US-703);
--   · la comprobación de existencia SIN `auth.uid()` — un webhook no tiene
--     usuario, y ese check era justo lo que la hacía inllamable (20260806120000);
--   · la idempotencia por estado CON `'failed'` dentro (X-02): un pago que ya
--     falló significa que el horario se liberó, y acreditarlo ahora cobraría por
--     una clase que no existe;
--   · la rama de fallo: pago 'failed', reserva 'cancelled' y liberación del
--     hold de `sessions`.
create or replace function public.confirm_payment(
  p_booking_id uuid,
  p_success    boolean default true,
  p_event_id   text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay_status public.payment_status;
  v_new        public.booking_status;
  v_auto       boolean;
begin
  if not exists (select 1 from public.bookings b where b.id = p_booking_id) then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  -- US-703: dedup por event-id (procesar cada evento una sola vez).
  if p_event_id is not null then
    insert into public.payment_webhook_events (event_id, booking_id)
    values (p_event_id, p_booking_id)
    on conflict (event_id) do nothing;
    if not found then
      select status into v_new from public.bookings where id = p_booking_id;
      return v_new::text;  -- evento ya procesado → no-op
    end if;
  end if;

  select status into v_pay_status from public.payments where booking_id = p_booking_id;

  -- Idempotencia por estado: un pago ya RESUELTO no se reprocesa. 'failed' es
  -- tan definitivo como 'paid' (X-02) — significa que el horario ya se liberó,
  -- y acreditarlo ahora cobraría por una clase que no existe.
  if v_pay_status in ('paid', 'refunded', 'partially_refunded', 'failed') then
    select status into v_new from public.bookings where id = p_booking_id;
    return v_new::text;
  end if;

  if p_success then
    update public.payments set status = 'paid', paid_at = now() where booking_id = p_booking_id;

    -- M-02 · ¿esta MENTORÍA acepta sola? (antes: ¿este tutor?)
    --
    -- Subconsulta envuelta en `coalesce` y no `select … into` a secas: si el
    -- join no devolviera fila, `into` dejaría la variable en null y el `case`
    -- de abajo se iría por la rama del else igualmente, pero por accidente.
    -- Así el respaldo es EXPLÍCITO y es el conservador: sin producto legible,
    -- la reserva espera a que un humano la acepte. En la práctica no puede
    -- pasar —`bookings.product_id` es `not null` y `on delete restrict`
    -- (20260709140000:36), así que el producto de una reserva no se borra—,
    -- pero un `false` escrito gana a un null implícito.
    select coalesce(
             (select p.auto_accept_bookings
                from public.bookings b
                join public.products p on p.id = b.product_id
               where b.id = p_booking_id),
             false)
      into v_auto;

    update public.bookings
      set status = case when v_auto then 'confirmed' else 'pending_acceptance' end::public.booking_status
      where id = p_booking_id and status = 'pending_payment'
      returning status into v_new;
  else
    update public.payments set status = 'failed', failed_at = now() where booking_id = p_booking_id;
    update public.bookings set status = 'cancelled', cancelled_at = now()
      where id = p_booking_id
      returning status into v_new;
    update public.sessions set status = 'cancelled', cancelled_at = now()
      where booking_id = p_booking_id and status = 'scheduled';
  end if;

  return v_new::text;
end;
$$;

-- `create or replace` conserva los privilegios existentes, pero se repiten por
-- si esta migración se aplica sobre una base donde la función no existía: en
-- Postgres el `execute` nace concedido a PUBLIC, así que revocar ANTES de
-- conceder no es ceremonia (mismo gotcha de 20260715150000, 20260806120000 y
-- 20260817160000). Sigue siendo del webhook y de nadie más; el cliente entra
-- por `confirm_simulated_payment`.
revoke execute on function public.confirm_payment(uuid, boolean, text) from public;
revoke execute on function public.confirm_payment(uuid, boolean, text) from anon;
revoke execute on function public.confirm_payment(uuid, boolean, text) from authenticated;

grant  execute on function public.confirm_payment(uuid, boolean, text) to service_role;
