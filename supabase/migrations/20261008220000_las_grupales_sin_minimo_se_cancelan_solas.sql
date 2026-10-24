-- ============================================================================
-- Enséñame Ya — las clases grupales sin el cupo mínimo se cancelan solas
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- RG-04 (`docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §3 y §10.2): con `min_seats`
-- puesto, si 24 h antes de la primera fecha no hay ese número de cupos
-- PAGADOS, la clase se cancela con el 100 % para todos. Las 24 h son el
-- supuesto S-G-02 y coinciden con el corte de RN-37.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Cuentan los cupos PAGADOS ('confirmed', 'in_progress'). Un hold de pago
--   ('pending_payment') no llega al mínimo: si se cancela la clase, ese hold se
--   suelta igual que los demás.
-- · Cancela por `cancelar_clase_grupal` (`20261008180000`), que exige ser el
--   tutor o el admin. Desde pg_cron `auth.uid()` es NULL, así que se le presta
--   la identidad del tutor de cada clase, igual que hace esa función con
--   `cancel_booking`. NO se abre la puerta a «auth.uid() nulo = interno»: anon
--   también llega con auth.uid() nulo.
-- · Cada clase en su propio `begin … exception` (patrón de
--   `expire_stale_bookings`): una que falle no frena a las demás. ⚠️ Regla de
--   oro 11: ese fallo NO pone el job en rojo, sale como WARNING en el log de
--   Postgres. Tras aplicar, mirar `cron.job_run_details` por jobname.
-- · La ventana es (ahora, ahora + 24 h]: el job corre cada 15 min, así que
--   una clase entra en ella mucho antes de empezar. Una que ya empezó no se
--   toca (cancelar_clase_grupal la rechazaría igual).
-- · El correo NTF-53 llega con las plantillas de G4.
-- ============================================================================

create or replace function public.cancelar_grupales_sin_minimo()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c      record;
  v_n      int := 0;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
begin
  for v_c in
    select p.id, p.tutor_id, p.min_seats
      from public.products p
      join lateral (
        select min(g.start_at) as inicio
          from public.group_classes g
         where g.product_id = p.id and g.status <> 'cancelled'
      ) f on true
     where p.pricing_model = 'group'
       and p.min_seats is not null
       and f.inicio > now()
       and f.inicio <= now() + interval '24 hours'
       and exists (select 1 from public.group_classes g
                    where g.product_id = p.id and g.status = 'scheduled')
       and (select count(*) from public.bookings b
             where b.product_id = p.id
               and b.status in ('confirmed', 'in_progress')) < p.min_seats
  loop
    begin
      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_c.tutor_id, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_c.tutor_id::text, true);
      perform public.cancelar_clase_grupal(v_c.id, 'No se alcanzó el cupo mínimo de la clase');
      v_n := v_n + 1;
    exception when others then
      raise warning 'cancelar_grupales_sin_minimo: la clase % no se pudo cancelar: % (%)',
        v_c.id, sqlerrm, sqlstate;
    end;
  end loop;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_n;
end;
$$;

comment on function public.cancelar_grupales_sin_minimo() is
  'RG-04 · cancela con el 100 % las clases grupales con min_seats cuya primera fecha empieza en 24 h o menos y que no llegan al mínimo de cupos PAGADOS. Corre por pg_cron (cancelar-grupales-sin-minimo, cada 15 min). Devuelve cuántas canceló; un fallo por clase sale como WARNING y no para el resto.';

-- Solo el reloj: ni authenticated ni anon.
revoke execute on function public.cancelar_grupales_sin_minimo() from public, anon, authenticated;

select cron.unschedule('cancelar-grupales-sin-minimo')
 where exists (select 1 from cron.job where jobname = 'cancelar-grupales-sin-minimo');
select cron.schedule(
  'cancelar-grupales-sin-minimo',
  '*/15 * * * *',
  $cron$ select public.cancelar_grupales_sin_minimo() $cron$
);
