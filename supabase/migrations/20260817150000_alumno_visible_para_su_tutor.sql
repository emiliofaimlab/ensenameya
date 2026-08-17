-- ============================================================================
-- N-13 / N-14 — el tutor ve QUIÉN es su alumno.
--
-- Es UN problema, no dos. `profiles` nace en la migración inicial con
-- `profiles_select_own` + `profiles_select_admin` y nada más, así que el tutor
-- no puede leer ni el nombre de la persona con la que va a dar la clase. El
-- frontend lo lleva documentando como limitación conocida en tres sitios
-- (`tutor/page.tsx`, `tutor/reservas/[id]/page.tsx`, `chat/chat-launcher.tsx`)
-- y el resultado, en palabras del tutor: "aquí yo no veo con quién es la
-- llamada". Se abre AQUÍ, una vez, y las tres pantallas beben de lo mismo.
--
-- ⚠️ Esto es un cambio de PRIVACIDAD: hasta hoy el tutor no veía ningún dato
-- personal del alumno. Es la primera excepción, y por eso las tres decisiones
-- de abajo van razonadas y no "lo que salga".
--
-- ── Por qué NO una política nueva en `profiles` ──────────────────────────────
-- Sería el parche obvio ("select using (exists reserva compartida)") y es justo
-- el que filtra: la RLS es por FILA, no por columna, y `20260703120000` concede
-- `grant select on public.profiles to authenticated` sobre TODAS las columnas.
-- Abrir la fila le daría al tutor el teléfono (RN-44), el `primary_goal` del
-- alumno, su `referral_code` y su `stripe_customer_id`. Nada de eso hace falta
-- para dar una clase, y lo que se cuela hoy se cuela para siempre.
--
-- ── Por qué TAMPOCO una vista `security_invoker` ────────────────────────────
-- El patrón de `tutors_public` (`20260804120000`) aquí no aplica: con el
-- invoker puesto mandan las políticas de la tabla envuelta, y las de `profiles`
-- siguen siendo own-only → la vista le devolvería CERO filas al tutor. Para que
-- funcionara habría que abrir `profiles` igualmente, o sea, el problema de
-- arriba. Una vista con `security_invoker = false` sería peor todavía: la regla
-- de oro dice SIEMPRE invoker, precisamente para no tener superficies que se
-- salten la RLS sin que nadie lo note.
--
-- ── Lo que queda: función `SECURITY DEFINER` acotada ────────────────────────
-- Salta la RLS como su dueña, así que las columnas se eligen a mano —una a una,
-- nunca `p.*`: lo que se añada mañana a `profiles` no debe colarse solo— y la
-- relación tutor↔alumno la comprueba ella misma. Precedente en el repo:
-- `home_testimonials` (`20260723120000`), que publica el nombre enmascarado de
-- quien reseña sin abrir `profiles` a `anon`.
-- ============================================================================

-- ── Decisión 1 · QUÉ columnas ───────────────────────────────────────────────
-- Solo lo que hace falta para reconocer a quién le vas a explicar y a qué hora
-- le toca:
--   · full_name    — el dato que se pedía (N-13). Sin él la reserva es anónima.
--   · avatar_path  — bucket `avatars`, que ya es PÚBLICO (`20260722160000`):
--                    no se abre nada nuevo, solo se dice cuál es la ruta.
--   · timezone     — el tutor necesita saber que su 10:00 es la 1:00 del alumno
--                    (RN-01/RN-02). Es dato de la clase, no de la persona.
--
-- Fuera, a propósito: `phone` y `stripe_customer_id` (nadie los necesita para
-- enseñar), `referral_code` (es de marketing) y `primary_goal`.
--
-- ⚠️ Fuera también `student_interests`: se sembraron PRIVADOS a propósito
-- ("son para recomendar, no para publicar", `20260722160000`) y enseñárselos al
-- tutor es cambio de producto, no un arreglo de bug. Si el cliente lo pide,
-- será otra migración con su decisión detrás.

-- ── Decisión 2 · POR QUÉ ESTADO se acota ────────────────────────────────────
-- Sin filtro de estado, un tutor con una reserva cancelada seguiría leyendo ese
-- perfil para siempre. Se exige que la relación haya existido de verdad:
--
--   · `pending_acceptance` SÍ — la reserva ya está PAGADA y el tutor tiene 24 h
--     para aceptarla (RN-38): decidir a ciegas quién es el alumno no tiene
--     sentido.
--   · `confirmed` / `in_progress` / `completed` SÍ — hay o hubo clase.
--   · `pending_payment` NO — nadie ha pagado nada; la reserva puede expirar
--     sola (US-605) y el tutor ni se entera de que existió.
--   · `cancelled` NO — la clase no llegó a darse: el tutor conserva la reserva
--     (mentoría, importe, fecha) pero pierde el dato personal. Es el precio de
--     que el acceso caduque, y es el lado correcto en el que equivocarse.
--   · `refunded` — depende. `refund_payment` (`20260716160000`) marca la reserva
--     como `refunded` incluso si la clase YA SE DIO, así que un reembolso
--     administrativo borraría de golpe el nombre de un alumno al que el tutor
--     estuvo dando clase un mes. Por eso el `or completed_at is not null`:
--     `cancel_booking` nunca lo rellena (solo cancela desde
--     pending_payment/pending_acceptance/confirmed), así que esa columna
--     distingue exactamente "hubo clase" de "no la hubo".
--
-- Efecto lateral asumido: si la ÚNICA reserva entre ambos se cancela, la lista
-- de reservas del tutor pinta esa fila sin nombre. Es coherente: el acceso lo
-- da la relación viva, no el histórico.

create or replace function public.tutor_students(p_student_id uuid default null)
returns table (
  student_id  uuid,
  full_name   text,
  avatar_path text,
  timezone    text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Sirve a las dos pantallas: sin argumento devuelve TODOS los alumnos del
  -- tutor (el listado resuelve los nombres de una vez, no uno por reserva) y
  -- con argumento, uno solo (la ficha de N-14). El filtro de relación es el
  -- mismo en ambos casos: pasarle un uuid cualquiera no salta el `exists`.
  select p.id, p.full_name, p.avatar_path, p.timezone
    from public.profiles p
   where (p_student_id is null or p.id = p_student_id)
     and exists (
       select 1
         from public.bookings b
        where b.tutor_id   = (select auth.uid())
          and b.student_id = p.id
          and (
            b.status in ('pending_acceptance', 'confirmed', 'in_progress', 'completed')
            or b.completed_at is not null   -- reembolsada DESPUÉS de darse
          )
     );
$$;

comment on function public.tutor_students(uuid) is
  'N-13/N-14: identidad mínima del alumno (nombre, foto, zona horaria) para el tutor que comparte con él una reserva viva. SECURITY DEFINER con columnas explícitas porque `profiles` es own-only y su grant de select es de tabla entera.';

-- ── Decisión 3 · GRANTS ─────────────────────────────────────────────────────
-- `execute` sobre una función recién creada es PUBLIC por defecto en Postgres:
-- sin este `revoke` primero, el `grant` de abajo no cierra nada y `anon` podría
-- llamarla (devolvería vacío porque `auth.uid()` es null, pero no se deja una
-- puerta abierta apostando a eso). Mismo orden que
-- `pending_email_notifications` (`20260806150000`).
revoke execute on function public.tutor_students(uuid) from public;
revoke execute on function public.tutor_students(uuid) from anon;
grant  execute on function public.tutor_students(uuid) to authenticated;

-- Regla de oro 9 (grants explícitos) no pide nada más aquí: la función es
-- SECURITY DEFINER —corre con los privilegios de su dueña, no con los del rol
-- que llama— y ningún job con `service_role` la usa. Si mañana la llama uno,
-- `grant execute ... to service_role` va EN ESA migración.

-- El `exists` de arriba corre en cada render del panel y del listado de
-- reservas. `bookings_tutor_id_idx` (solo tutor_id) obliga a filtrar el alumno
-- fila a fila; el compuesto lo resuelve en el índice.
create index if not exists bookings_tutor_student_idx
  on public.bookings (tutor_id, student_id);
