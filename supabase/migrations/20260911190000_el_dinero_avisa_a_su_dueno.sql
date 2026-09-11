-- ============================================================================
-- Enséñame Ya — Doc 33 · el dinero avisa a su dueño
--
-- Dos cambios de la misma familia: lo que le pasa al dinero del tutor tiene que
-- llegarle AL TUTOR, y una campana dentro de la app no es un sitio donde se
-- entere nadie. Quien tiene una incidencia de cobro es justo quien ha dejado de
-- entrar.
--
--   1. NTF-16 `payout_issue` pasa de `in_app` a `email`.
--   2. NTF-27 `payout_account_changed` NACE: hasta hoy se podía cambiar la
--      cuenta a la que va el dinero sin que el dueño recibiera una sola señal.
--      Es el hueco de seguridad más claro que quedaba del pliego.
--
-- ── ⚠️ CADENCIA: ESTO ES UNA REBAJA CONSCIENTE, Y CONVIENE SABERLO ANTES ─────
--
-- El pliego pedía NTF-27 en ENVÍO DIRECTO, fuera de la cola, como el aviso del
-- checkout de invitado. Aquí no se puede sin reescribir dos formularios, porque
-- las tres vías que cambian el destino del dinero son estas y dos de ellas
-- ocurren en el NAVEGADOR contra PostgREST, sin un punto de servidor nuestro
-- donde colgar un `await sendEmail`:
--
--   · public.upsert_payout_account(…)    → tutor_payout_accounts          (navegador)
--   · public.upsert_manual_destination(…) → tutor_manual_payout_destinations (navegador)
--   · public.conectar_cuenta_paypal(…)   → tutor_manual_payout_destinations (servidor)
--
-- Así que va por la cola, y la cola la vacía `/api/cron/notifications-send`,
-- que en producción —medido sobre corridas reales, no sobre el cron declarado—
-- entrega cada 2-6 horas. Un aviso de seguridad que llega esa tarde es peor que
-- uno que llega en el acto, y aun así es lo correcto aquí: un trigger cubre las
-- TRES vías con un solo mecanismo y no se puede saltar ni olvidar en la
-- siguiente pantalla que escriba en estas tablas; un `sendEmail` desde el
-- formulario cubre una vía, la que ya existe, y se olvida en la siguiente.
--
-- 🔴 La vía de subir esto a «inmediato» es darle al job de `notifications-send`
-- un reloj más rápido, NO cambiar este trigger por tres envíos sueltos.
--
-- ── Por qué TRIGGERS y no las RPC ───────────────────────────────────────────
--
-- Porque las tres vías acaban en una de DOS tablas, y dos triggers cubren tres
-- funciones (y las que vengan). Y porque tocar la firma de cualquiera de esas
-- RPC obliga a `drop function` + `create` (regla 12): `20260910190000` intentó
-- el atajo del `create or replace`, PostgreSQL creó una sobrecarga y PostgREST
-- devolvió `PGRST203` justo cuando el campo opcional iba vacío — o sea, rompió
-- el formulario bancario del tutor al revés de lo que promete la pantalla. Lo
-- arregló `20260910220000` dos horas después. No se vuelve a pasar por ahí para
-- mandar un correo.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · NTF-16: de la campana al correo
-- ════════════════════════════════════════════════════════════════════════════
--
-- Copia literal de `20260716170000_ep12_notifications.sql:170-190` con UN solo
-- cambio: el canal de la rama de incidencia, `'in_app'` → `'email'`. Todo lo
-- demás se deja exactamente como está, comparaciones de enum incluidas, porque
-- esta función lleva dos meses encolando NTF-12 correctamente y lo único roto
-- era a dónde iba NTF-16.
--
-- ⚠️ NO SE PIERDE EL AVISO IN-APP. La campana (`listNotices` en
-- `src/lib/notifications-server.ts`) selecciona TODAS las filas de
-- `notifications` del destinatario sin mirar `channel`: el canal solo decide
-- quién SACA la fila de la cola (`pending_email_notifications` filtra
-- `channel = 'email'`). O sea que esto no mueve el aviso de sitio, lo añade a
-- un segundo sitio.
--
-- ⚠️ LAS NTF-16 YA ENCOLADAS COMO 'in_app' NO SE REENVÍAN, y es a propósito.
-- La `idempotency_key` no cambia —sigue siendo `NTF-16:payout:<id>:<status>`—
-- así que las filas viejas se quedan donde están, con su canal viejo, y un
-- payout que vuelva a caer en el mismo estado seguirá chocando contra el
-- `on conflict do nothing` de `enqueue_notification`. Esto avisa por correo de
-- las incidencias DE AQUÍ EN ADELANTE. Si algún día hace falta rescatar las
-- viejas, eso es un `update notifications set channel = 'email'` acotado por
-- `type = 'NTF-16' and status = 'pending'`, y es una decisión de operaciones —
-- no de esta migración, que no puede saber cuántos de esos payouts siguen
-- abiertos.
--
-- Misma firma (sin argumentos, `returns trigger`): `create or replace` es
-- legal aquí y el trigger `notifications_on_payout` sigue apuntando a ella sin
-- tocarse. La regla 12 pide `drop` + `create` cuando cambian los ARGUMENTOS o
-- el `returns`; aquí no cambia ninguno de los dos.

create or replace function public.notify_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'paid' then
      perform public.enqueue_notification(new.tutor_id, 'NTF-12', 'email', 'payout_paid',
        jsonb_build_object('payout_id', new.id, 'amount', new.amount, 'currency', new.currency),
        'NTF-12:payout:' || new.id);
    elsif new.status in ('on_hold', 'failed') then
      perform public.enqueue_notification(new.tutor_id, 'NTF-16', 'email', 'payout_issue',
        jsonb_build_object('payout_id', new.id, 'status', new.status),
        'NTF-16:payout:' || new.id || ':' || new.status);
    end if;
  end if;
  return new;
end;
$$;

comment on function public.notify_payout() is
  'NTF-12 (pagado) y NTF-16 (incidencia) sobre payouts. Desde 20260911190000 NTF-16 va por email y no por in_app: un cobro que falla y solo se dice en una campana no se entera nadie, y menos el tutor que ha dejado de entrar. No se pierde el aviso in-app — la campana pinta todas las filas de notifications sin mirar el canal. Las NTF-16 ya encoladas como in_app NO se reenvían: la idempotency_key no cambió.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · NTF-27 `payout_account_changed` — el aviso de seguridad que faltaba
-- ════════════════════════════════════════════════════════════════════════════
--
-- Lo que esto cubre es el ataque aburrido: alguien que entra con la sesión del
-- tutor, cambia el número de cuenta y se va. Nada se rompe, nada se queda
-- `failed`, el payout sale con normalidad y el dinero llega a otro sitio. El
-- dueño se entera en la liquidación siguiente, o sea semanas después. Un correo
-- —aunque tarde unas horas— es lo que convierte eso en algo que el tutor puede
-- parar a tiempo.
--
-- ── ⚠️ LA IDEMPOTENCIA ES LA PARTE DELICADA ────────────────────────────────
--
-- La clave obvia, `'NTF-27:cobro:' || tutor_id`, avisaría UNA VEZ EN LA VIDA:
-- el primer guardado entra, y el cambio de cuenta de dentro de seis meses —el
-- único que de verdad importa— choca contra el `on conflict do nothing` y se
-- pierde en silencio. Es exactamente el caso que un aviso de seguridad existe
-- para cubrir, así que la clave lleva dentro un HASH DEL DESTINO.
--
-- Con eso, la propiedad que se consigue es la que se quiere:
--   · reguardar la misma cuenta (el tutor corrige una tilde del titular, o el
--     formulario reenvía la fila entera) NO manda correo — el hash no cambió;
--   · cambiar la cuenta SÍ manda correo — el hash es otro y la clave es nueva.
--
-- Qué entra en el hash y qué no:
--   · tutor_payout_accounts → país + banco + sucursal + número de cuenta. Son
--     las COORDENADAS POR LAS QUE VIAJA EL DINERO. Quedan fuera a propósito el
--     nombre del titular, el documento y la dirección: cambiarlos no redirige
--     el dinero a ningún sitio, y meterlos convertiría cada corrección de una
--     errata del apellido en un «tu dinero irá a otra cuenta», que es la forma
--     más rápida de enseñarle al tutor a ignorar este correo.
--   · tutor_manual_payout_destinations → canal + handle + verified_account_id.
--     El canal entra porque pasar de Zelle a Zinli CON EL MISMO CORREO es un
--     cambio de destino real. `verified_account_id` entra porque en PayPal es
--     el identificador al que se paga de verdad: el correo es solo el respaldo
--     (pagar al correo dejó `UNCLAIMED` 5 de 5 veces), así que un cambio ahí es
--     un cambio de destino aunque el correo no se mueva.
--
-- Los `'|'` entre campos no son adorno: sin separador, ('AR','123','4567') y
-- ('AR','1234','567') dan la misma cadena y por tanto el mismo hash, y ese
-- choque se come un aviso.
--
-- ⚠️ Lo que este diseño NO cubre, dicho para que no sorprenda: volver a una
-- cuenta que ya se usó antes NO manda correo, porque su hash ya está en la
-- tabla. Se acepta — el dinero vuelve a un destino del que el dueño ya fue
-- avisado en su día, que es el caso menos alarmante de todos.
--
-- ⚠️ EL PAYLOAD NO LLEVA LA CUENTA. Solo el TIPO de destino. Estas dos tablas
-- son las que más PII tienen del proyecto después de `verification_documents`,
-- y su número de cuenta no tiene `grant select` para NADIE justamente para que
-- no exista un camino por el que salga; meterlo en un jsonb que acaba en la
-- bandeja de Resend sería abrir ese camino por la puerta de atrás. Los cuatro
-- últimos los resuelve `pending_email_notifications` desde `bank_account_last4`
-- en la misma consulta que saca el lote.
--
-- ⚠️ SECURITY DEFINER, y no es opcional: `public.notifications` no tiene grant
-- de insert para ningún rol. Se escribe SOLO por `enqueue_notification`, que ya
-- es security definer — pero el que la llama tiene que poder llamarla.

create or replace function public.notify_payout_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_destino text;
  v_huella  text;
begin
  -- Una sola función para las dos tablas: lo que cambia es de qué columnas sale
  -- la huella y cómo se llama el destino en el correo. Se bifurca por
  -- `tg_table_name` y no por `to_jsonb(new)->>'…'` a propósito: si mañana una
  -- de estas columnas se renombra, el acceso por campo revienta con
  -- `undefined_column` y se ve; el `->>` devolvería null y seguiría mandando
  -- correos con el destino equivocado durante meses (regla 11, en pequeño).
  if tg_table_name = 'tutor_payout_accounts' then
    -- 🔴 El tutor NUNCA ve los tres rieles de detrás (Wise, dLocal, Stripe) —
    -- el dictado de pagos es explícito: dos tarjetas, PayPal y Banco. Así que
    -- el destino se nombra como lo nombra su pantalla.
    v_destino := 'Transferencia bancaria';
    v_huella  := md5('banco|'
                  || coalesce(new.country, '')     || '|'
                  || coalesce(new.bank_code, '')   || '|'
                  || coalesce(new.bank_branch, '') || '|'
                  || coalesce(new.bank_account, ''));

  elsif tg_table_name = 'tutor_manual_payout_destinations' then
    -- La etiqueta sale del catálogo y no de un `case` aquí dentro: los canales
    -- manuales son DATO (`payout_manual_channels`) y se pueden abrir o cerrar
    -- sin migración. Si el canal desapareciera del catálogo, mejor decir su
    -- código que no decir nada.
    select c.label into v_destino
      from public.payout_manual_channels c
     where c.channel = new.channel;
    v_destino := coalesce(v_destino, new.channel);

    v_huella := md5('manual|'
                 || coalesce(new.channel, '')             || '|'
                 || coalesce(new.handle, '')              || '|'
                 || coalesce(new.verified_account_id, ''));

  else
    -- Trigger colgado de una tabla que esta función no sabe leer. No se avisa
    -- de nada inventado: se sale sin tocar la cola.
    return new;
  end if;

  perform public.enqueue_notification(
    new.tutor_id,
    'NTF-27',
    'email',
    'payout_account_changed',
    jsonb_build_object('destino', v_destino),
    'NTF-27:cobro:' || new.tutor_id || ':' || v_huella
  );

  return new;
end;
$$;

comment on function public.notify_payout_account() is
  'NTF-27 (Doc 33): avisa al tutor por correo cuando cambia el destino de su dinero. Cuelga de las DOS tablas de destino y no de las tres RPC que escriben en ellas, porque así cubre las tres vías —upsert_payout_account, upsert_manual_destination y conectar_cuenta_paypal— con un mecanismo que no se puede saltar, y sin tocar la firma de ninguna RPC (20260910190000 rompió el formulario bancario con PGRST203 por hacer eso con create or replace). La idempotency_key lleva un MD5 del destino —país+banco+sucursal+cuenta, o canal+handle+verified_account_id— y no solo el tutor_id: con el tutor_id a secas avisaría una vez en la vida y el cambio de cuenta de dentro de seis meses, que es el que importa, chocaría contra el on conflict do nothing. Con la huella dentro, reguardar lo mismo NO manda correo y cambiar de cuenta SÍ. Quedan fuera de la huella el titular, el documento y la dirección: cambiarlos no redirige el dinero y cada errata corregida se convertiría en un aviso de seguridad falso. El payload lleva el TIPO de destino y nunca el número de cuenta — los cuatro últimos los resuelve pending_email_notifications desde bank_account_last4.';


-- ── Los dos triggers ────────────────────────────────────────────────────────
--
-- `after insert or update` en las dos: el alta del primer destino también es un
-- cambio de destino (antes no había ninguno) y las tres RPC entran por
-- `insert … on conflict do update`, que dispara el trigger de UPDATE cuando la
-- fila ya existía y el de INSERT cuando no. Con los dos verbos, ninguna de las
-- dos ramas se queda muda.
--
-- El hueco AFTER está libre en las dos tablas: comprobado, lo único que cuelga
-- de ellas hoy son `tutor_payout_accounts_set_updated_at` y
-- `tutor_manual_payout_destinations_set_updated_at`, los dos BEFORE UPDATE.
--
-- ⚠️ Y ESTE TRIGGER NO PUEDE FALLAR, por un motivo concreto. En
-- `tutor_payout_accounts` dispara DENTRO de `upsert_payout_account`, cuyo
-- insert va envuelto en un `exception when check_violation or
-- not_null_violation or string_data_right_truncation` que reescribe el error
-- como «los datos de cobro no tienen el formato que pide XX» (así se hizo en
-- `20260901170000` para que un check no publicara la fila entera). Un fallo de
-- este trigger que cayera en una de esas tres clases saldría DISFRAZADO de
-- error de formato, y el tutor pasaría la tarde reescribiendo un IBAN que está
-- bien. `upsert_manual_destination` tiene el mismo envoltorio, con
-- `unique_violation` de propina.
-- Que no falle está sostenido por el diseño de `enqueue_notification`: es un
-- `insert … on conflict (idempotency_key) do nothing` que además se rinde solo
-- si el destinatario es null. La clave repetida —el caso normal, un reguardado
-- sin cambios— NO levanta `unique_violation`: la absorbe el `on conflict`.

create trigger notifications_on_payout_account
  after insert or update on public.tutor_payout_accounts
  for each row execute function public.notify_payout_account();

create trigger notifications_on_manual_destination
  after insert or update on public.tutor_manual_payout_destinations
  for each row execute function public.notify_payout_account();

-- Sin `grant` de tabla en esta migración, y se dice por qué para que no se
-- añada por reflejo (regla 9): aquí no entra ningún job con `service_role`. Los
-- dos triggers corren con el rol de quien hace el `upsert` —`authenticated` vía
-- PostgREST, `service_role` en el callback de PayPal— y la única escritura que
-- hacen es a través de `enqueue_notification`, que es SECURITY DEFINER y por
-- tanto ya lleva los privilegios de su dueño. `public.notifications` sigue sin
-- grant de insert para nadie, que es el cerrojo que se quiere.
