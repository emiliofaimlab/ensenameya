-- ============================================================================
-- Enséñame Ya — B-2: la sala vuelve a 10 min antes / 10 min después
-- (V-1 de la lista del 21-ago · Doc 22 §22.8-22.9 · deshace la mitad de MN-05)
--
-- El cliente dio marcha atrás sobre P-6: la sala debe abrir «a la hora que
-- corresponde y la duración que tiene» (V-1, 24-ago), y el número elegido es el
-- de siempre — 10 y 10.
--
-- Y eso NO es solo revertir un número: es que **acceso y clase vuelven a
-- coincidir**. MN-05 los separó porque el cliente quería 7 días de sala sin
-- retrasar el cobro del tutor; con 10/10 los dos relojes marcan lo mismo otra
-- vez. La separación se queda igualmente, y a propósito: son dos preguntas
-- distintas («¿la sala admite gente?» y «¿esto es la clase?») que hoy dan la
-- misma respuesta por coincidencia, no por diseño. Volver a fundirlas sería
-- repetir el accidente histórico que MN-05 tuvo que deshacer.
--
-- ── LO QUE NO SE TOCA, Y ES LO IMPORTANTE ───────────────────────────────────
-- `session_live_window()` y `close_expired_sessions()` **no aparecen en este
-- fichero**. De ahí sale `bookings.completed_at`, y de él el plazo de pago al
-- tutor (§12 del contrato). Ya marcan 10 min: tocarlos «para unificar» sería
-- mover dinero por estética. Tampoco `join_session`, cuyos cambios de MN-05
-- (la sesión cerrada por tiempo no cierra la puerta, la reserva `completed`
-- da acceso) dejan de tener efecto solos: con la ventana en 10 min, una sesión
-- cerrada ya cae fuera del rango y el estado no tiene que volver a ser puerta.
--
-- ── ⚠️ EL BACKFILL VA SIN `WHERE`, Y ESA ES LA TRAMPA DE ESTA FICHA ─────────
-- MN-05 lo escribió `where access_opens_at is null` porque entonces las
-- columnas estaban vacías y solo había que estrenarlas. Hoy están LLENAS, con
-- los 7 días dentro. Copiar aquel `where` dejaría:
--   · la migración en verde,
--   · la función diciendo 10 minutos,
--   · y `join_session` leyendo las columnas, o sea el acceso **siguiendo en 7
--     días** — porque quien manda en tiempo de ejecución son las columnas, no
--     la función.
-- Sin que nada avisara. Por eso el `update` es incondicional: recalcula TODAS
-- las filas desde la función nueva.
--
-- El trigger `sessions_set_access_window` no hay que tocarlo: ya llama a
-- `session_access_window()` por nombre, así que las sesiones nuevas salen con
-- el valor nuevo desde el primer insert.
-- ============================================================================


-- ── 1) La ventana de ACCESO, de vuelta a 10 minutos ─────────────────────────
--
-- Mismo nombre, misma firma, `immutable` igual: solo cambia el intervalo. El
-- `create or replace` conserva el trigger y a `join_session`, que la llaman por
-- nombre.
--
-- ⚠️ Si mañana el cliente vuelve a pedir otro plazo, hay que tocar TRES cosas
-- —esto, `ACCESS_WINDOW_MIN` en `src/lib/room-window.ts`, y volver a correr el
-- backfill de abajo—. Las columnas materializadas NO se recalculan solas, y esa
-- es exactamente la piedra con la que tropieza esta migración.
create or replace function public.session_access_window(
  p_start timestamptz,
  p_end   timestamptz
)
returns tstzrange
language sql
immutable
set search_path = ''
as $$
  select tstzrange(p_start - interval '10 minutes', p_end + interval '10 minutes', '[]');
$$;

comment on function public.session_access_window(timestamptz, timestamptz) is
  'B-2 (V-1, 24-ago): ventana en la que la SALA admite gente — 10 min antes del inicio y 10 después del fin. Deshace los 7 días de MN-05 a petición del cliente. Sigue siendo una función DISTINTA de session_live_window() aunque hoy den el mismo rango: aquélla gobierna la contabilidad (bookings.completed_at y con ella el payout) y ésta el acceso. Que coincidan es coincidencia, no diseño.';


-- ── 2) Backfill INCONDICIONAL ───────────────────────────────────────────────
--
-- Sin `where`: hay que reescribir las filas que MN-05 dejó con 7 días, que son
-- todas. Un `where … is null` no encontraría ninguna y dejaría la base
-- diciendo una cosa y la función otra — ver la cabecera.
--
-- Recalcula desde la función, no desde un literal, para que no pueda divergir
-- de lo que se acaba de definir arriba.
--
-- No dispara `sessions_set_access_window` (es `update of start_at, end_at` y
-- aquí no se tocan), por eso el `set` va escrito. Sí mueve `updated_at` de
-- todas las filas vía `sessions_set_updated_at`: se acepta, esa columna es
-- auditoría y no la lee ninguna regla de negocio.
--
-- ⚠️ Efecto inmediato al aplicarla: cualquier sesión que no esté dentro de sus
-- ±10 min pierde el acceso a la sala EN EL ACTO. Es lo pedido, pero conviene
-- saberlo antes de correrla en horario de clases.
update public.sessions
   set access_opens_at  = lower(public.session_access_window(start_at, end_at)),
       access_closes_at = upper(public.session_access_window(start_at, end_at));

comment on column public.sessions.access_opens_at is
  'B-2 · instante desde el que la sala admite gente. Lo deriva el trigger sessions_set_access_window a partir de session_access_window(start_at, end_at) — hoy start_at − 10 min. NO es cuándo empieza la clase (eso es start_at) ni cuándo se cierra la contabilidad (eso es session_live_window).';
comment on column public.sessions.access_closes_at is
  'B-2 · instante en que la sala deja de admitir gente (end_at + 10 min). Es también el `exp` con el que se crea la room en Daily. Desde B-2 vuelve a coincidir con el cierre contable, pero son dos relojes distintos: éste es acceso.';
