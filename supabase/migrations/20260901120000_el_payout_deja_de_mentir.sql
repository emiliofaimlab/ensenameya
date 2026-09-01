-- Enséñame Ya — C1 · `process_scheduled_payouts()` deja de marcar «pagado».
--
-- ── LO QUE PASABA ───────────────────────────────────────────────────────────
-- La función marcaba `status='paid'`, `provider='simulated'`,
-- `provider_payout_id='sim-payout-…'` y `paid_at=now()` **sin llamar a ningún
-- proveedor** (`20260716140000_ep10_payouts.sql:174-179`), y corre por pg_cron
-- **cada 10 minutos** (`:279`). Su comentario decía la verdad y nadie la leyó:
-- «Simulado: "paga" al instante. Con proveedor real, aquí una Edge Function
-- llama provider.payout()». Ese proveedor real nunca llegó.
--
-- Escribir una fila falsa en `payouts` ya era malo. Lo que lo vuelve urgente es
-- el eslabón siguiente, que se montó después y en otra épica:
--
--   process-payouts (cada 10 min)
--     → payouts.status = 'paid'
--     → trigger notify_payout()            (`20260716170000_ep12_notifications.sql:177-180`)
--     → enqueue_notification(NTF-12, 'email', 'payout_paid')
--     → asunto «Se pagó tu liquidación»    (`src/lib/email-templates.ts:96-100`)
--     → cuerpo «Tu liquidación de $X se marcó como pagada»
--
-- y **desde el 30-ago el job de correo está vivo y apunta a producción** con
-- `RESEND_API_KEY` puesta. O sea que el último eslabón, que durante seis semanas
-- fue inofensivo porque la cola no se vaciaba nunca, dejó de serlo sin que nadie
-- tocara esta función. Es exactamente el patrón de `process_notifications()`
-- —que marcaba la cola como `sent` sin enviar— pero en la pata de SALIDA y con
-- dinero delante: allí se dejaba de avisar a alguien; aquí se le dice a un tutor
-- que cobró.
--
-- ── LO QUE HACE AHORA ───────────────────────────────────────────────────────
-- Solo informa, igual que `process_notifications()` tras su corrección. No toca
-- una fila. Devuelve lo que un ejecutor de verdad tendría que pagar, para que la
-- cifra se pueda mirar desde `cron.job_run_details` y desde el SQL editor.
--
-- El job NO se desprograma a propósito. Con el cuerpo vacío de escrituras corre
-- en microsegundos, y mantenerlo vivo es lo que hace que su fila siga apareciendo
-- en `cron.job_run_details`: un job que se borra deja de contar su historia, y la
-- regla de oro 11 de este proyecto nació justamente de un pg_cron que fallaba sin
-- decírselo a nadie. Cuando llegue C2 (el `payout()` de verdad, que vive en un
-- Route Handler porque Postgres no puede hablar con la API de un PSP), este
-- cuerpo se sustituye y el reloj ya está puesto.
--
-- ⚠️ EFECTO SECUNDARIO QUE HAY QUE ACEPTAR A SABIENDAS, y es de la épica de al
-- lado. La baja de cuenta programada (`20260831160000`) cuenta con que
-- `process-payouts` cierre los payouts solos: su cabecera dice «peor caso ≈ 14
-- días» y ese plazo ES la «fecha de cobro» de la analogía que pidió el cliente.
-- A partir de aquí un `payouts` en 'scheduled' **no se cierra nunca** hasta que
-- exista C2, así que un tutor que pida la baja teniendo un payout emitido se
-- queda desactivado indefinidamente.
--
-- Se acepta porque la alternativa es peor y no es simétrica: retener una cuenta
-- de alguien a quien de verdad se le debe dinero es correcto —incómodo, pero
-- correcto—; decirle que se le pagó cuando no se le pagó no lo es. Y el bloqueo
-- es visible (la pantalla enumera lo pendiente), mientras que el correo falso no
-- deja rastro que nadie mire. Cuando C2 aterrice, ese plazo vuelve solo.
--
-- ⚠️ LAS FILAS YA ESCRITAS NO SE TOCAN. Un `update … set status='scheduled'`
-- sobre lo que hoy está 'paid' volvería a disparar `notify_payout()` —el trigger
-- mira `is distinct from`— y encima reescribiría un histórico. Si en producción
-- hay filas con `provider='simulated'` y `status='paid'`, eso es un problema de
-- negocio (hay tutores a los que se les dijo que cobraron) y se resuelve
-- hablando, no con SQL. Para saber si las hay:
--
--   select p.status, p.provider, count(*), min(p.paid_at), max(p.paid_at)
--     from public.payouts p group by 1, 2;
--
-- Y para saber a quién se le dijo:
--
--   select n.recipient_id, n.status, n.sent_at, n.created_at
--     from public.notifications n
--    where n.template = 'payout_paid'
--    order by n.created_at desc;
--
-- `status = 'sent'` en esa consulta es la línea que separa «escribimos una fila
-- falsa» de «se lo dijimos por correo».

create or replace function public.process_scheduled_payouts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n        int;
  v_importes jsonb;
begin
  -- Lo que un ejecutor real tendría delante ahora mismo. Mismo criterio que
  -- usaba el `update` que había aquí: 'scheduled' con la fecha ya vencida.
  select count(*),
         coalesce(
           jsonb_object_agg(x.currency, x.total) filter (where x.currency is not null),
           '{}'::jsonb
         )
    into v_n, v_importes
    from (
      select p.currency, sum(p.amount) as total, count(*) as n
        from public.payouts p
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
       group by p.currency
    ) x;

  -- `ejecutados` va SIEMPRE a 0 y se devuelve igualmente. Quitarlo haría que la
  -- fila del cron dejara de tener una cifra que contrastar, y el objetivo es que
  -- se vea que no se ejecuta nada, no que no se vea nada.
  return jsonb_build_object(
    'estado',     'sin-ejecutor',
    'ejecutados', 0,
    'esperando',  coalesce(v_n, 0),
    'importes',   coalesce(v_importes, '{}'::jsonb)
  );
end;
$$;

comment on function public.process_scheduled_payouts() is
  'C1 (2026-09-01): SOLO INFORMA. Antes marcaba payouts.status=''paid'' con provider=''simulated'' sin llamar a ningún proveedor, y el trigger notify_payout() mandaba al tutor el correo NTF-12 «Se pagó tu liquidación» por un dinero que no se movió — inofensivo hasta que el 30-ago el job de correo empezó a enviar de verdad contra producción. Devuelve {estado, ejecutados:0, esperando, importes} para que la cifra se vea en cron.job_run_details. El pago real es C2: vive en un Route Handler, no aquí, porque Postgres no puede llamar a la API de un PSP. ⚠️ Mientras tanto ningún payout llega a ''paid'', así que la baja de cuenta programada (20260831160000) retiene indefinidamente a quien tenga uno emitido: es deliberado, ver la cabecera de esta migración.';

-- Los grants no cambian: la función sigue siendo `security definer` y solo
-- `service_role` puede invocarla (`20260716140000:273`). Se repiten porque
-- `create or replace` no los pierde, pero un `drop`+`create` futuro sí, y este
-- es el sitio donde se mira.
revoke execute on function public.process_scheduled_payouts() from public;
revoke execute on function public.process_scheduled_payouts() from anon;
revoke execute on function public.process_scheduled_payouts() from authenticated;
grant  execute on function public.process_scheduled_payouts() to service_role;
