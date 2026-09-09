-- ============================================================================
-- Enséñame Ya — `upsert_payout_account` vuelve a ser UNA función
--
-- 🔴 ARREGLA UN FALLO QUE INTRODUJO `20260910190000` Y QUE ROMPE EL FORMULARIO
-- BANCARIO DEL TUTOR AHORA MISMO.
--
-- ── QUÉ PASÓ ───────────────────────────────────────────────────────────────
--
-- Aquella migración añadió `p_dob` y `p_tos_ip` con `CREATE OR REPLACE`. En
-- PostgreSQL eso **no reemplaza cuando cambia la lista de argumentos: crea una
-- SOBRECARGA**. Quedaron dos funciones con el mismo nombre, una de 13 argumentos
-- y otra de 15.
--
-- PostgREST no puede elegir entre las dos y responde:
--
--     PGRST203 · Could not choose the best candidate function between:
--       public.upsert_payout_account(p_first_name => text, … p_state => text),
--       public.upsert_payout_account(p_first_name => text, … p_dob => date, …)
--
-- ── POR QUÉ ES GRAVE Y NO SE VIO ───────────────────────────────────────────
--
-- `supabase-js` NO serializa las claves con valor `undefined`. El formulario
-- manda `p_dob: nacimiento || undefined`, así que:
--
--   · con fecha de nacimiento → 15 argumentos → resuelve → guarda ✅
--   · SIN fecha              → 13 argumentos → ambiguo  → NO guarda ❌
--
-- O sea **exactamente al revés de lo que promete la pantalla**, que llama a esos
-- dos campos «Opcional… sin ellos te seguimos pagando igual». Se probó con la
-- fecha puesta y por eso pasó desapercibido.
--
-- Y el `setError(err.message)` del formulario pinta ese mensaje tal cual: 600
-- caracteres en inglés con los nombres de los parámetros SQL dentro, sobre la
-- pantalla del dinero del tutor.
--
-- ⚠️ LA LECCIÓN, QUE ESTE REPOSITORIO YA HABÍA ESCRITO: `20260907130000:10` y
-- `20260910150000` sí llevan su `drop function` antes de recrear. Aquella se
-- olvidó. **Añadir un argumento a una RPC es un `drop` + `create`, nunca un
-- `create or replace`.**
-- ============================================================================

-- ── 1 · fuera la vieja ─────────────────────────────────────────────────────
--
-- Solo la de 13 argumentos. La de 15 es la buena y NO se toca: recrearla aquí
-- sería copiar 200 líneas para no cambiar nada, y cada copia es una ocasión de
-- que las dos versiones diverjan.

drop function if exists public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text
);

-- ── 2 · los grants, que un `drop` se lleva por delante ─────────────────────
--
-- ⚠️ Se reponen sobre la que SOBREVIVE. `drop function` no toca los privilegios
-- de las otras sobrecargas, pero se declaran igual: es barato, es idempotente, y
-- una RPC sin `grant execute` para `authenticated` es un formulario que deja de
-- guardar con `permission denied` en tiempo de ejecución — que es la regla de
-- oro 9 con otro disfraz.

revoke execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text, date, text
) from public;
revoke execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text, date, text
) from anon;
grant  execute on function public.upsert_payout_account(
  text, text, text, text, text, text, text, text, text, text, text, text, text, date, text
) to authenticated;

-- ── 3 · autocomprobación ───────────────────────────────────────────────────
--
-- Afirma la INVARIANTE que se rompió: **una sola** función con ese nombre. Si
-- alguien vuelve a añadirle un argumento con `create or replace`, esta línea lo
-- para en el despliegue en vez de dejar que lo descubra un tutor.

do $$
declare
  v_n int;
  v_firmas text;
begin
  select count(*), string_agg(p.oid::regprocedure::text, E'\n  ')
    into v_n, v_firmas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'upsert_payout_account';

  if v_n <> 1 then
    raise exception
      'hay % versiones de upsert_payout_account y PostgREST no puede elegir (PGRST203). El formulario bancario del tutor deja de guardar. Firmas:%s',
      v_n, E'\n  ' || v_firmas;
  end if;

  -- Y que la que queda sea la que acepta los dos datos de Stripe: si
  -- sobreviviera la vieja, la fecha de nacimiento y la aceptación no se
  -- guardarían nunca y el riel de Stripe no se abriría para nadie.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'upsert_payout_account'
       and pg_get_function_identity_arguments(p.oid) like '%p_dob date%'
  ) then
    raise exception 'sobrevivió la versión sin p_dob: el tutor no podría abrir la ruta de Stripe';
  end if;
end $$;
