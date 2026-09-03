-- ============================================================================
-- Enséñame Ya — C2 · higiene del dinero EN VUELO.
--
-- Dos defectos que hoy son inofensivos por una razón que se acaba pronto:
-- **nadie ha cobrado todavía**. `process_scheduled_payouts()` solo informa desde
-- C1 (`20260901120000`) y el ejecutor real —el Route Handler
-- `/api/cron/payouts-process`— aún no tiene ni credencial de dLocal ni riel
-- manual encendido. El día que una orden empiece a estar de verdad en manos de
-- un proveedor, los dos pasan a destruir dinero. Se cierran ahora, antes, porque
-- después el síntoma es un pago duplicado o un tutor sin cobrar, y ninguno de
-- los dos avisa.
--
-- Esta migración NO enciende nada ni cambia el ruteo. Solo pone dos barreras.
--
-- ── DEFECTO 1: el reembolso pisa una orden que el proveedor está ejecutando ──
--
-- El bloque S-29 de `refund_payment` (nacido en `20260716160000`, reescrito
-- entero en `20260817170000:401-521`) contempla exactamente DOS mundos:
--
--     if v_item.payout_status = 'paid' then  → clawback manual (MVP/S-29)
--     else                                   → borra el payout_item,
--                                              resta el importe del payout y
--                                              borra el payout si se quedó vacío
--
-- El `else` se escribió cuando `payout_status` solo podía significar «aún no ha
-- salido»: en aquel momento el único ejecutor era `process_scheduled_payouts()`,
-- que iba de 'scheduled' a 'paid' en el mismo `update` y **no dejaba a nadie en
-- 'processing'**. Con C2 sí lo deja, y 'processing' significa literalmente lo
-- contrario que el `else`: la orden está creada en el proveedor y no se sabe
-- todavía cómo acaba —dLocal Go nace PENDING y confirma más tarde
-- (`src/lib/payments/port.ts`, caso `enviado`)—. Hoy el reembolso total de un
-- pago cuya orden esté en vuelo:
--
--   1. borra el `payout_item`,
--   2. le resta su importe al `payouts.amount` … que es EL IMPORTE QUE EL
--      PROVEEDOR YA ESTÁ PAGANDO, y
--   3. si era el único item, **borra la fila entera de `payouts`** — con su
--      `provider_payout_id` dentro.
--
-- El paso 3 es el que no tiene vuelta: ese identificador es lo único que ata
-- este sistema con el payout del panel del proveedor. Sin él, el dinero sale
-- igual (el proveedor no se entera de nuestros DELETE) y aquí no queda ni la
-- fila para conciliarlo. Es peor que el caso 'paid', que al menos se marca
-- `clawback_needed` y alguien lo mira.
--
-- Se añade un tercer mundo, y no hace nada más listo que negarse: **si la orden
-- está 'processing', el reembolso falla y no se toca NADA**. No se inventa un
-- clawback (no se sabe si se pagó), no se cancela la orden (con dLocal Go no se
-- puede: `POST /v1/payouts` no tiene contraparte de anulación) y no se deja el
-- reembolso a medias. El admin espera a que el job cierre la orden —la deja en
-- 'paid' o en 'failed', y las dos ramas de S-29 ya saben qué hacer con eso— y
-- repite el reembolso. La espera es de minutos u horas, no de días.
--
-- El resto de estados sigue igual, y a propósito: 'pending', 'scheduled',
-- 'on_hold' y 'failed' son órdenes que NO están en manos de nadie —'failed' es
-- el rechazo explícito del proveedor, o sea dinero que no salió— y sacarles el
-- item es exactamente lo correcto.
--
-- ⚠️ Solo se guarda el reembolso TOTAL, que es el único que toca payouts. El
-- parcial sigue sin tocarlos (prorrateo manual, DP-03) y por eso no se bloquea:
-- no puede pisar nada.
--
-- ── DEFECTO 2: dos payouts podían llevar el mismo identificador del proveedor ─
--
-- `payouts.provider_payout_id` no tiene índice único (`20260716140000:23-43`:
-- tres índices, ninguno único). Ese campo es la llave de conciliación de todo
-- C2 y de `payouts_backlog()` (`20260901210000`), y sin restricción nada impide
-- que dos filas lo compartan — es decir, que dos órdenes den por suyo el mismo
-- pago del proveedor. Con el barrido de dLocal delante eso es doble contabilidad
-- del mismo dinero: una de las dos está mintiendo y no hay forma de saber cuál.
--
-- El adaptador ya empuja en la dirección contraria (la marca `EY-{payout}-{n}`
-- de `marcaDe()` es única por orden e intento, justamente para no adoptar el
-- payout de otro), pero eso es disciplina de la aplicación. Esto es la red.
--
-- Qué pasa cuando la red salta: el `update` del Route Handler devuelve 23505,
-- `marca()` propaga el error y el caso 'pagado' escribe «🔴 payout PAGADO pero
-- no anotado» y cuenta la orden como EN DUDA. Ruidoso y visible, que es lo que
-- se quiere: hoy el mismo escenario se anota en silencio.
--
-- ── POR QUÉ EL ÍNDICE ES PARCIAL Y DE UNA SOLA COLUMNA ───────────────────────
--
-- PARCIAL porque la inmensa mayoría de las filas tienen el campo a null: una
-- orden solo recibe identificador cuando el proveedor la crea. En Postgres los
-- NULL no chocan entre sí en un índice único, así que técnicamente el `where`
-- no cambia el resultado — cambia el tamaño: el índice solo indexa las órdenes
-- que de verdad han llegado a un proveedor, que es también el conjunto sobre el
-- que se concilia.
--
-- UNA SOLA COLUMNA, sin `provider`, y esto sí se decidió mirando el código:
--   · una fila puede tener `provider_payout_id` **con `provider` a null**. Pasa
--     por construcción: la orden que el admin reintenta sale de 'failed'
--     arrastrando el id del payout rechazado, y `volver` la devuelve a la cola
--     poniendo `provider: null` **sin limpiar el identificador**
--     (`src/app/api/cron/payouts-process/route.ts`). Con `provider` en la clave,
--     (null,'X') y (null,'X') NO chocan —NULL es distinto de NULL— y la barrera
--     se abriría justo en las filas descuidadas, que son las peligrosas;
--   · `nulls not distinct` lo arreglaría, pero es atar la migración a PG15+ para
--     ganar cero: un identificador repetido es un problema aunque las dos filas
--     digan proveedores distintos — eso sería un bug encima del otro;
--   · el falso positivo (dos proveedores devolviendo la misma cadena) da un
--     error alto y visible; el falso negativo da un pago duplicado en silencio.
--     Ante la duda se elige el fallo ruidoso.
-- ============================================================================


-- ── 1) refund_payment v3 — no se pisa una orden en vuelo ────────────────────
--
-- Cuerpo íntegro de `20260817170000:413-517` (en Postgres una función no se
-- parchea, se reescribe entera) con UN añadido: la comprobación de 'processing'.
-- Lo que se conserva y es lo fácil de perder al copiar:
--   · `has_role('admin')` como primera línea (S-15/RN-26);
--   · solo se reembolsa lo cobrado ('paid' / 'partially_refunded');
--   · el importe acotado a `gross_amount - refunded_amount`, y el acumulado que
--     nunca retrocede;
--   · `enqueue_refund` con su clave de idempotencia `X01:payment:<id>:<total>`,
--     que es lo que hace que el reembolso mueva dinero de verdad (X-01);
--   · el bloque S-29 entero, el paso de la reserva a 'refunded' (M4) y el jsonb
--     de vuelta {refunded_amount, total_refunded, status, clawback_needed}, que
--     es lo que consume `admin/payments/[id]/refund-form.tsx`.
--
-- El guardián va ANTES de escribir nada. Da igual para la integridad —todo esto
-- es una transacción y el `raise` la deshace— pero no da igual para lo que ve el
-- admin: así el mensaje que recibe es el del payout, no un fallo a mitad de un
-- reembolso que parecía haber empezado.
create or replace function public.refund_payment(
  p_payment_id uuid,
  p_amount     bigint default null   -- null = reembolsar todo lo que quede
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay        record;
  v_remaining  bigint;
  v_amount     bigint;
  v_new_total  bigint;
  v_full       boolean;
  v_new_status public.payment_status;
  v_clawback   boolean := false;
  v_item       record;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin reembolsa' using errcode = 'insufficient_privilege';
  end if;

  select id, booking_id, status, gross_amount, refunded_amount
    into v_pay
  from public.payments where id = p_payment_id;
  if v_pay.id is null then
    raise exception 'pago no encontrado' using errcode = 'no_data_found';
  end if;

  -- Solo se reembolsa lo que se cobró.
  if v_pay.status not in ('paid', 'partially_refunded') then
    raise exception 'el pago no está cobrado (está: %)', v_pay.status using errcode = 'check_violation';
  end if;

  v_remaining := v_pay.gross_amount - v_pay.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);   -- por defecto, el resto
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe inválido: entre 1 y % (queda por reembolsar)', v_remaining
      using errcode = 'check_violation';
  end if;

  v_new_total := v_pay.refunded_amount + v_amount;
  v_full := v_new_total >= v_pay.gross_amount;
  v_new_status := case when v_full then 'refunded' else 'partially_refunded' end;

  -- El item del payout se busca UNA vez y arriba, porque de él depende si este
  -- reembolso puede siquiera empezar. `payout_items.payment_id` es único
  -- (`20260716140000:48`), así que esto devuelve como mucho una fila.
  if v_full then
    select pi.id as item_id, pi.amount as item_amount, po.id as payout_id, po.status as payout_status
      into v_item
    from public.payout_items pi
    join public.payouts po on po.id = pi.payout_id
    where pi.payment_id = p_payment_id;

    -- 🔴 EL GUARDIÁN. Ver el DEFECTO 1 de la cabecera: 'processing' es una orden
    -- que el proveedor tiene entre manos. Ni se le quita el item ni se le resta
    -- el importe ni —lo irreversible— se borra la fila con su identificador.
    if v_item.payout_status = 'processing' then
      raise exception
        'hay una orden de pago en ejecución para este importe (payout %): espera a que el proveedor la confirme —el job la deja en pagada o rechazada, y entonces este reembolso ya sabe qué hacer— y repite. Si lleva más de un día parada, mírala desde el panel o con select * from public.payouts_backlog().',
        v_item.payout_id
        using errcode = 'check_violation';
    end if;
  end if;

  update public.payments
     set status = v_new_status, refunded_amount = v_new_total
   where id = p_payment_id;

  -- X-01 · el dinero, no solo el estado.
  perform public.enqueue_refund(
    v_pay.id,
    v_amount,
    'US-704 · reembolso manual desde el panel admin',
    'X01:payment:' || v_pay.id || ':' || v_new_total
  );

  -- S-29: solo en reembolso TOTAL se toca el payout (el prorrateo parcial del
  -- neto es DP-03, manual). El item ya está leído arriba.
  if v_full then
    if v_item.item_id is not null then
      if v_item.payout_status = 'paid' then
        -- Ya se pagó al tutor → clawback manual (no automatizado, MVP/S-29).
        v_clawback := true;
      else
        -- 'pending', 'scheduled', 'on_hold' o 'failed': nadie está pagando esto.
        -- Se excluye el item y se ajusta/limpia el payout.
        delete from public.payout_items where id = v_item.item_id;
        update public.payouts
           set amount = amount - v_item.item_amount
         where id = v_item.payout_id;
        -- Si el payout se quedó sin items, se elimina (no estaba pagado).
        delete from public.payouts po
         where po.id = v_item.payout_id
           and not exists (select 1 from public.payout_items x where x.payout_id = po.id);
      end if;
    end if;

    -- M4: reembolso total → la reserva pasa a refunded (cierre financiero).
    update public.bookings set status = 'refunded'
     where id = v_pay.booking_id and status <> 'refunded';
  end if;

  -- NTF-10 lo dispara el trigger de `payments` (20260716170000), no esta
  -- función. Ojo: avisa al ACORDAR el reembolso; el dinero sale cuando el job
  -- vacíe la cola.
  return jsonb_build_object(
    'refunded_amount', v_amount,
    'total_refunded',  v_new_total,
    'status',          v_new_status::text,
    'clawback_needed', v_clawback
  );
end;
$$;

comment on function public.refund_payment(uuid, bigint) is
  'US-704 · reembolso manual del admin (total o parcial), server-side y solo admin. S-29: un reembolso TOTAL saca el payout_item del payout no liquidado y lo ajusta o borra; si el payout ya está ''paid'' devuelve clawback_needed=true (manual, MVP). ⚠️ Desde 20260902130000 un payout en ''processing'' NO se toca: la orden está en manos del proveedor y borrarla perdería su provider_payout_id, que es lo único que la concilia — el reembolso falla y hay que esperar a que el job la cierre.';

-- `create or replace` conserva privilegios; se repiten por si esta migración
-- cayera sobre una base donde la función no existiera (mismo criterio que
-- 20260817170000).
revoke execute on function public.refund_payment(uuid, bigint) from public;
revoke execute on function public.refund_payment(uuid, bigint) from anon;
grant  execute on function public.refund_payment(uuid, bigint) to authenticated;


-- ── 2) un identificador de proveedor = un payout ────────────────────────────
--
-- ⚠️ ANTES DE NADA, LOS DUPLICADOS QUE PUEDA HABER YA. Esta es la consulta que
-- los saca, y es también la que hay que ejecutar si sale el WARNING de abajo:
--
--   select provider_payout_id,
--          count(*)                        as filas,
--          array_agg(id order by created_at) as payouts,
--          array_agg(status)               as estados
--     from public.payouts
--    where provider_payout_id is not null
--    group by provider_payout_id
--   having count(*) > 1;
--
-- Se espera que devuelva cero filas: el único escritor histórico fue
-- `process_scheduled_payouts()`, que derivaba el id del propio `payouts.id`
-- ('sim-payout-' || id, `20260716140000:178`) y por tanto no podía repetirlo.
-- Pero «se espera» no es «se sabe», y en dev/prod hay filas de aquella época.
--
-- Por eso el `create` va dentro de un bloque que ATRAPA el choque. Reventar la
-- migración por dos filas viejas pararía TODAS las migraciones siguientes de
-- este despliegue —incluida la corrección de arriba, que es la que protege
-- dinero— y eso es peor que quedarse sin el índice un rato.
--
-- ponytail: si el WARNING salta, esta migración queda APLICADA y sin índice, y
-- no se puede reintentar tocándola (regla de oro 5: una migración aplicada es
-- inmutable). La cura es limpiar los duplicados con la consulta de arriba y
-- crear el índice en una migración NUEVA. No se automatiza esa limpieza aquí a
-- propósito: decidir cuál de dos filas que dicen haber pagado el mismo payout
-- es la buena no es un `delete`, es mirar el panel del proveedor.
--
-- El `comment on` va DENTRO del bloque, detrás del `create`: fuera, comentar un
-- índice que no llegó a existir volvería a reventar la migración por la puerta
-- de atrás y todo lo anterior no habría servido de nada.
do $$
begin
  create unique index if not exists payouts_provider_payout_id_uidx
    on public.payouts (provider_payout_id)
    where provider_payout_id is not null;

  comment on index public.payouts_provider_payout_id_uidx is
    'C2 (2026-09-02): un identificador del proveedor pertenece a UN payout. provider_payout_id es la llave de conciliación entre esta base y el panel del PSP (la usan /api/cron/payouts-process y payouts_backlog()); sin este único, dos órdenes podían dar por suyo el mismo pago y contarlo dos veces. Parcial porque casi todas las filas lo tienen a null hasta que el proveedor crea la orden. Sin `provider` en la clave a propósito: una fila puede llevar identificador con provider a null (el reintento del admin arrastra el id del payout rechazado) y con NULL en la clave el único no protegería justo esas filas.';
exception
  when unique_violation then
    raise warning
      '🔴 NO se pudo crear payouts_provider_payout_id_uidx: hay payouts que comparten provider_payout_id. Quiénes son lo dice la consulta del comentario de esta migración (20260902130000_higiene_del_dinero_en_vuelo.sql): resuélvelos contra el panel del proveedor y crea el índice en una migración NUEVA. Hasta entonces, dos órdenes pueden dar por suyo el mismo pago. Detalle: %',
      sqlerrm;
end;
$$;
