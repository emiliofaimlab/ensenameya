-- ============================================================================
-- Enséñame Ya — EY-247 · las grupales se habilitan solas a las 60 clases
--
-- RG-18 ya tenía la vía manual (`admin_habilitar_grupales`, `20261014160000`) y
-- el cupo ya tiene tope de 10 (`products.capacity between 2 and 10`,
-- `20261008120100`). Falta el desbloqueo automático: un tutor que llega a 60
-- clases 1:1 completadas recibe `group_classes_enabled = true`.
--
-- ── POR QUÉ UNA MARCA Y NO «justo 60» ──────────────────────────────────────
--   `group_classes_auto_at` registra que el automático YA actuó. Así actúa una
--   sola vez: si después el admin le apaga las grupales a ese tutor, la clase 61
--   no se las vuelve a encender. Comparar con «= 60» no sirve: el cron cierra
--   varias sesiones en un mismo UPDATE y los triggers AFTER ROW ven ya todas,
--   así que dos clases del mismo tutor saltarían del 59 al 61 sin pasar por 60.
--
--   Cuentan solo las 1:1 (`group_class_id is null`): en una grupal hay una
--   sesión por alumno, y contarlas inflaría el número.
--
--   60 es configuración del cliente (regla de oro 8): vive en una constante
--   de esta función y nada más.
-- ============================================================================

alter table public.tutor_profiles
  add column if not exists group_classes_auto_at timestamptz;

comment on column public.tutor_profiles.group_classes_auto_at is
  'EY-247 · cuándo se habilitaron solas las grupales al llegar a 60 clases 1:1 completadas. No nulo = el automático ya actuó y no vuelve a hacerlo: si el admin las apaga, se quedan apagadas. Sin grant de escritura a authenticated.';

create or replace function public.habilitar_grupales_por_clases()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_umbral constant int := 60;  -- EY-247 · clases 1:1 completadas
begin
  update public.tutor_profiles tp
     set group_classes_enabled = true,
         group_classes_auto_at = now()
   where tp.profile_id = new.tutor_id
     and tp.group_classes_auto_at is null
     and (select count(*)
            from public.sessions s
           where s.tutor_id = new.tutor_id
             and s.status = 'completed'
             and s.group_class_id is null) >= c_umbral;
  return null;
end;
$$;

comment on function public.habilitar_grupales_por_clases() is
  'EY-247 · trigger de sessions: al completarse una 1:1, si el tutor suma 60 o más y el automático aún no actuó (group_classes_auto_at null), le habilita las grupales y deja la marca.';

revoke execute on function public.habilitar_grupales_por_clases() from public, anon, authenticated;

drop trigger if exists sessions_habilitar_grupales on public.sessions;
create trigger sessions_habilitar_grupales
  after update of status on public.sessions
  for each row
  when (new.status = 'completed'
        and old.status is distinct from 'completed'
        and new.group_class_id is null)
  execute function public.habilitar_grupales_por_clases();

-- Backfill: los que ya pasaron el umbral antes de que existiera el trigger.
update public.tutor_profiles tp
   set group_classes_enabled = true,
       group_classes_auto_at = now()
 where tp.group_classes_auto_at is null
   and (select count(*)
          from public.sessions s
         where s.tutor_id = tp.profile_id
           and s.status = 'completed'
           and s.group_class_id is null) >= 60;

-- Regla de oro 9: la columna nueva, legible por los jobs.
grant select (group_classes_auto_at) on public.tutor_profiles to service_role;
