-- ============================================================================
-- Revierte supabase/seed/dev-clasificados.sql.  ⚠️  SOLO DEV.
--
-- Borra los 6 clasificados de demo (99999999-…), sus postulaciones, los
-- mensajes-tarjeta y avisos que generaron, las conversaciones que se quedan
-- vacías, y las 2 mentorías extra (77777777-…). No toca nada más: las cuentas,
-- mentorías y disponibilidad de dev-poblar se quedan.
--
-- Un clasificado que ya se PAGÓ (reserva creada en la demo) no se borra: tiene
-- rastro financiero (regla de baja lógica). Se avisa y se deja.
-- ============================================================================

do $$
begin
  if not exists (select 1 from auth.users where email = 'marina.gomez@ensenameya.dev') then
    raise exception 'dev-clasificados-revertir: faltan las cuentas de dev-poblar.sql — ¿no es dev? Abortado.';
  end if;
  if exists (select 1 from public.class_proposals
              where request_id::text like '99999999-0000-4000-8000-%' and booking_id is not null) then
    raise warning 'Hay postulaciones de demo ya pagadas: esos clasificados y sus mentorías se conservan.';
  end if;
end $$;

-- Lo que se borra: clasificados de demo SIN postulación pagada.
drop table if exists _demo_req, _demo_prop;
create temp table _demo_req as
  select r.id from public.class_requests r
   where r.id::text like '99999999-0000-4000-8000-%'
     and not exists (select 1 from public.class_proposals cp
                      where cp.request_id = r.id and cp.booking_id is not null);

create temp table _demo_prop as
  select cp.id, cp.conversation_id from public.class_proposals cp
   where cp.request_id in (select id from _demo_req);

delete from public.notifications
 where payload->>'request_id' in (select id::text from _demo_req)
    or (payload->>'conversation_id' in (select conversation_id::text from _demo_prop)
        and created_at > (select min(created_at) from public.class_requests where id in (select id from _demo_req)));

delete from public.messages where proposal_id in (select id from _demo_prop);
delete from public.class_proposals where id in (select id from _demo_prop);

-- Conversaciones que solo existían por la demo: sin mensajes ni reservas.
delete from public.conversations c
 where c.id in (select conversation_id from _demo_prop)
   and not exists (select 1 from public.messages m where m.conversation_id = c.id)
   and not exists (select 1 from public.class_proposals cp where cp.conversation_id = c.id);

delete from public.class_requests where id in (select id from _demo_req);

-- Mentorías extra, solo si ya nada las referencia (una reserva las protege).
delete from public.products p
 where p.id::text like '77777777-0000-4000-8000-%'
   and not exists (select 1 from public.class_proposals cp where cp.product_id = p.id)
   and not exists (select 1 from public.bookings b where b.product_id = p.id);

select (select count(*) from public.class_requests where id::text like '99999999-0000-4000-8000-%') as clasificados_restantes,
       (select count(*) from public.products where id::text like '77777777-0000-4000-8000-%') as mentorias_restantes;

drop table if exists _demo_req, _demo_prop;
