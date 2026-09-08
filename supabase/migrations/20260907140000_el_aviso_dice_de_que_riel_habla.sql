-- ══════════════════════════════════════════════════════════════════════════════
-- NTF-23 LE MANDABA A UN TUTOR CON CUENTA BANCARIA UN CORREO SOBRE SU PAYPAL
--
-- ── EL FALLO, MEDIDO ─────────────────────────────────────────────────────────
--
-- `avisar_payouts_sin_reclamar()` (20260903220000, contador arreglado en
-- 20260903230000) barre TODA fila de `payouts` en `processing` cuyo
-- `provider_metadata.c2.reclamado_en` lleve más de N días. **No filtra por
-- proveedor, y eso es deliberado**: su propia cabecera lo dice
-- (`20260903220000:34-36`) — «Si mañana otro riel deja un pago colgado igual,
-- este aviso ya lo cubre».
--
-- Ese mañana fue hoy. `20260907120000` encendió Wise, y un pago de Wise vive en
-- dos tiempos: primero se CREA la transferencia y luego se FONDEA. Con el saldo
-- del perfil business a cero —que es como está— la orden se crea, se queda en
-- `processing` y no sale de ahí nunca. Al día 7 el barrido la recoge, que es
-- justo para lo que se escribió.
--
-- Lo que NO acompañó al barrido fue el texto. El payload que encola es
-- `{payout_id, amount, currency, dias}` — **sin el proveedor**—, así que la
-- plantilla no tenía forma de saber de qué riel hablaba, y está escrita entera
-- para PayPal: «no ha llegado a tu cuenta de PayPal», «el correo que nos diste
-- no es el de tu cuenta PayPal», «PayPal nos lo devuelve a los 30 días», y un
-- botón que manda a revisar los datos de cobro.
--
-- O sea que un tutor colombiano al que le estamos pagando por transferencia
-- bancaria recibía un correo diciéndole que revise una cuenta de PayPal que no
-- tiene, por un dinero que en su riel no hay que reclamar. Y la primera frase
-- —«Enviamos tu liquidación»— encima es falsa ahí: la transferencia se creó y
-- el dinero no salió.
--
-- ── POR QUÉ ESTO Y NO FILTRAR POR PAYPAL ─────────────────────────────────────
--
-- Restringir el barrido a `provider = 'paypal'` haría el correo correcto por la
-- vía de dejar de mandarlo, y con él se perdería el único aviso que tiene un
-- tutor de Wise de que su dinero lleva una semana parado. Contradice además la
-- intención declarada de la función, que es cubrir a cualquier riel que deje un
-- pago colgado. Lo que faltaba no era filtrar: era **decir de qué riel se
-- habla**, para que el texto pueda ser cierto en cada uno.
--
-- Esta migración es la mitad de base de datos. La otra mitad es la plantilla
-- (`src/lib/email-templates.ts`), que a partir de ahora ramifica por este dato y
-- solo usa el cuerpo de PayPal cuando el proveedor ES PayPal.
--
-- ── LO QUE NO CAMBIA ─────────────────────────────────────────────────────────
--
-- La firma sigue siendo `(p_dias int default 7)`, así que un `create or replace`
-- conserva los privilegios y no hace falta repetir los `revoke`/`grant` de
-- `20260903220000`. «No hace falta» no es «da igual»: la regla de oro 9 se paga
-- en tiempo de ejecución, no en el build, así que se comprueban abajo en vez de
-- darlos por buenos.
--
-- Tampoco cambia la idempotencia: la clave sigue siendo `NTF-23:payout:<id>` y
-- el `not exists` sigue descartando en el propio `select` a los que ya tienen
-- aviso, que es lo que hace que el número devuelto signifique «tutores avisados
-- en esta pasada».
--
-- ⚠️ NO HAY AVISOS VIEJOS QUE MIGRAR. Comprobado el 7-sep-2026 en dev antes de
-- escribir esto: `select count(*) from notifications where type = 'NTF-23'`
-- devuelve **0**, y producción no ha lanzado. Por eso la plantilla puede tratar
-- «sin proveedor» como «no es PayPal» sin dejar a nadie con el texto equivocado:
-- no existe ni una fila encolada con el payload antiguo.
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.avisar_payouts_sin_reclamar(p_dias int default 7)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila   record;
  v_avisos int := 0;
begin
  if p_dias < 1 then
    raise exception 'el umbral de días tiene que ser al menos 1, y llegó %', p_dias
      using errcode = 'check_violation';
  end if;

  for v_fila in
    -- 🔑 `p.provider` ES EL DATO NUEVO. Sigue sin filtrarse por él a propósito
    -- (ver la cabecera): se lee para CONTARLO en el aviso, no para decidir a
    -- quién se avisa.
    select p.id, p.tutor_id, p.amount, p.currency, p.provider
      from public.payouts p
     where p.status = 'processing'::public.payout_status
       and (p.provider_metadata -> 'c2' ->> 'reclamado_en') is not null
       and (p.provider_metadata -> 'c2' ->> 'reclamado_en')::timestamptz
             < now() - make_interval(days => p_dias)
       -- LOS QUE YA TIENEN AVISO NO SE VUELVEN A MIRAR. Es lo que hace que el
       -- número devuelto signifique «tutores avisados en esta pasada» y no
       -- «tutores que cumplen la condición», que a los tres días son lo mismo y
       -- a los treinta no se parecen en nada (20260903230000).
       and not exists (
         select 1 from public.notifications n
          where n.idempotency_key = 'NTF-23:payout:' || p.id
       )
  loop
    perform public.enqueue_notification(
      v_fila.tutor_id, 'NTF-23', 'email', 'payout_unclaimed',
      jsonb_build_object(
        'payout_id', v_fila.id,
        'amount',    v_fila.amount,
        'currency',  v_fila.currency,
        'dias',      p_dias,
        -- ⚠️ QUIÉN TENÍA QUE PAGAR ESTO. Sin esta clave la plantilla no puede
        -- saber de qué riel habla y acaba contando lo mismo a todo el mundo:
        -- a un tutor con cuenta bancaria en Wise se le mandaba el texto de
        -- PayPal, con instrucciones que no le sirven para nada.
        --
        -- Puede venir a `null`: `payouts.provider` es `text` nullable y una
        -- orden reclamada por el riel manual o rechazada y reintentada por el
        -- admin lo tiene vacío. La plantilla lo trata como «no es PayPal», que
        -- es lo cierto: el cuerpo neutro vale para cualquier riel, y el de
        -- PayPal solo vale para PayPal.
        'provider',  v_fila.provider
      ),
      'NTF-23:payout:' || v_fila.id
    );
    v_avisos := v_avisos + 1;
  end loop;

  return v_avisos;
end $$;

comment on function public.avisar_payouts_sin_reclamar(int) is
  'Encola NTF-23 para cada payout que lleva N días reclamado y sin cerrar, y devuelve CUÁNTOS SE AVISARON EN ESTA PASADA — descarta en el propio select los que ya tienen la notificación, porque contar candidatos hacía que el job reportara el mismo tutor en cada corrida para siempre. Nació por el UNCLAIMED de PayPal (retiene 30 días un pago que nadie reclama y luego lo devuelve) pero NO filtra por proveedor a propósito: cubre a cualquier riel que deje un pago colgado, y desde 20260907120000 eso incluye a Wise, cuya transferencia creada y sin fondear se queda en processing indefinidamente. Por eso el payload lleva provider desde 20260907140000: la plantilla ramifica con él y solo cuenta lo de PayPal cuando el riel ES PayPal — antes le mandaba a un tutor con cuenta bancaria un correo sobre su cuenta de PayPal. Cuenta desde provider_metadata.c2.reclamado_en y NO desde updated_at, que cada pasada de seguimiento reescribe.';

-- ── Autocomprobaciones ───────────────────────────────────────────────────────
--
-- El patrón de `20260903210000` y `20260907120000`: una migración que toca
-- dinero se comprueba a sí misma. Un `create or replace` valida la sintaxis, no
-- el sentido —el `case` sin `::session_status` sobrevivió a una reescritura
-- entera (regla de oro 11)— y un grant perdido no falla hasta que el job corre
-- en producción (regla de oro 9).
do $$
declare n int;
begin
  select public.avisar_payouts_sin_reclamar(3650) into n;
  if n <> 0 then
    raise exception 'con umbral de 10 años salieron % avisos', n;
  end if;

  begin
    perform public.avisar_payouts_sin_reclamar(0);
    raise exception 'un umbral de 0 días tenía que fallar y no falló';
  exception when check_violation then
    null;
  end;

  -- La firma no cambia, así que los privilegios de 20260903220000 sobreviven al
  -- reemplazo. Se mira igualmente: darlo por hecho es exactamente la forma del
  -- fallo que describe la regla de oro 9.
  if has_function_privilege('authenticated',
       'public.avisar_payouts_sin_reclamar(int)', 'execute') then
    raise exception 'avisar_payouts_sin_reclamar es ejecutable por authenticated';
  end if;
  if not has_function_privilege('service_role',
       'public.avisar_payouts_sin_reclamar(int)', 'execute') then
    raise exception 'service_role no puede ejecutar avisar_payouts_sin_reclamar (regla de oro 9)';
  end if;
end $$;

-- ── El ensayo de verdad: que el payload LLEVE el proveedor ───────────────────
--
-- Mirar el cuerpo de la función con `pg_get_functiondef` diría que la palabra
-- 'provider' está escrita, no que llegue al payload. Esto crea un payout de Wise
-- reclamado hace 30 días, hace el barrido, LEE LA FILA ENCOLADA y deshace todo
-- con una excepción: el subbloque `begin … exception` es una subtransacción, y
-- al salir por excepción Postgres la revierte entera. No queda ni el payout ni
-- el aviso.
--
-- Se salta si la base no tiene perfiles (producción está vacía y `payouts`
-- exige una FK contra `profiles`): saltarlo es correcto, inventar un perfil para
-- probar no lo sería.
do $$
declare
  v_tutor   uuid;
  v_payout  uuid;
  v_payload jsonb;
  v_n       int;
begin
  select id into v_tutor from public.profiles limit 1;
  if v_tutor is null then
    raise notice 'sin perfiles en esta base: el ensayo de NTF-23 se salta.';
    return;
  end if;

  begin
    insert into public.payouts (tutor_id, status, currency, amount, provider,
                                provider_metadata)
    values (v_tutor, 'processing'::public.payout_status, 'COP', 1, 'wise',
            jsonb_build_object('c2', jsonb_build_object(
              'reclamado_en', (now() - interval '30 days')::text)))
    returning id into v_payout;

    select public.avisar_payouts_sin_reclamar(7) into v_n;
    if v_n < 1 then
      raise exception 'el barrido no recogió el payout de Wise reclamado hace 30 días';
    end if;

    select n.payload into v_payload
      from public.notifications n
     where n.idempotency_key = 'NTF-23:payout:' || v_payout;

    if v_payload is null then
      raise exception 'NTF-23 no encoló nada para el payout del ensayo';
    end if;
    -- 🔴 LA LÍNEA POR LA QUE EXISTE ESTA MIGRACIÓN. Sin ella el correo habla de
    -- PayPal a un tutor que cobra por transferencia.
    if v_payload ->> 'provider' is distinct from 'wise' then
      raise exception 'el payload de NTF-23 no lleva el proveedor: %', v_payload;
    end if;
    -- Y no se perdió nada de lo que ya llevaba: el importe es lo que el correo
    -- enseña y `payout_id` es lo que decide el enlace (`rutaFor`).
    if v_payload ->> 'payout_id' is distinct from v_payout::text
       or (v_payload ->> 'amount')::bigint <> 1
       or v_payload ->> 'currency' is distinct from 'COP'
       or (v_payload ->> 'dias')::int <> 7 then
      raise exception 'el payload de NTF-23 perdió campos por el camino: %', v_payload;
    end if;

    -- Sale por excepción a propósito: es lo que revierte el payout y el aviso.
    raise exception 'ensayo-ok';
  exception when others then
    if sqlerrm <> 'ensayo-ok' then
      raise;
    end if;
  end;

  raise notice 'NTF-23 ya dice de qué riel habla: el payload lleva provider.';
end $$;
