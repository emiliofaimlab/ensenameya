-- ============================================================================
-- Enséñame Ya — el tutor deja de ver Stripe, y el manual se cierra en Venezuela
--
-- Fase 2 de `docs/DICTADO-PAGOS.md` (aprobado por el cliente el 9-sep-2026).
--
-- Es la mitad de datos de un cambio cuya otra mitad es código: la familia
-- 'conectada' —el alta de Stripe Connect que el tutor veía— desaparece del
-- repositorio en el mismo commit que esta migración.
--
-- ⚠️ LAS DOS MITADES VAN JUNTAS O LA PANTALLA MIENTE. Si el código quitara la
-- tarjeta pero la tabla siguiera nombrando a `stripe` en `payout_providers`, el
-- riel seguiría siendo candidato del payout sin manera de que ningún tutor
-- registre su destino: la orden se elegiría, no encontraría cuenta conectada
-- —que ya nadie puede crear— y se quedaría en 'scheduled' en silencio. Es
-- exactamente el fallo que documenta `riel-viable.ts`, con otro riel.
--
-- ── LO QUE ESTO **NO** ES ──────────────────────────────────────────────────
--
-- No es «Stripe deja de pagar para siempre». La decisión D-1 del dictado sigue
-- abierta y su recomendación es que Stripe VUELVA como tercer riel de la
-- tarjeta de Banco, pagando con las coordenadas que el tutor teclea en nuestro
-- formulario. Está medido que se puede (`POST /v1/accounts` con acuerdo
-- `recipient`, 54 de 60 países probados el 9-sep). Cuando se apruebe, su clave
-- vuelve a estas listas con otra migración y `RIELES.stripe.puedePagar` deja de
-- devolver `false`. Por eso la fila del riel se queda declarada en el código.
--
-- Tampoco se borra `tutor_profiles.stripe_connect_account_id`: cero filas, cero
-- payouts ejecutados, y borrarla costaría una migración con grants por columna
-- que habría que rehacer entera el día que D-1 se apruebe.
--
-- ── POR QUÉ NO ROMPE A NADIE, MEDIDO ───────────────────────────────────────
--
-- 0 de 24 tutores tienen `stripe_connect_account_id`, y 0 payouts se ejecutaron
-- por ese riel. Lo único que hay que mover es una preferencia guardada.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · STRIPE SALE DE LOS RIELES DE PAYOUT
-- ════════════════════════════════════════════════════════════════════════════
--
-- `array_remove` y no un `update` con la lista escrita a mano: lo segundo
-- obligaría a enumerar las 21 filas y a acertar en las 21, y una lista tecleada
-- es cómo dev y producción llevaron semanas ruteando distinto (20260904190000).
-- Así la migración dice la INTENCIÓN —«fuera Stripe de donde esté»— y es
-- idempotente por construcción.

update public.payment_routing_rules
   set payout_providers = array_remove(payout_providers, 'stripe')
 where 'stripe' = any(payout_providers);

-- ⚠️ Y QUE NINGUNA FILA SE QUEDE SIN RIELES. Un país cuyo `payout_providers`
-- quedara vacío es un tutor al que no se le puede pagar por ninguna vía, y eso
-- no se ve: la orden se crea y se queda esperando. Se comprueba abajo.

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · LA PREFERENCIA QUE APUNTA A UN MÉTODO QUE YA NO EXISTE
-- ════════════════════════════════════════════════════════════════════════════
--
-- El método 'stripe' desaparece de `METODOS_FIJOS`, así que una preferencia
-- guardada con ese valor deja de tener tarjeta. `preferenciaVigente()` la
-- descarta sola y la pantalla diría «Sin elegir» sin explicar por qué — que es
-- correcto pero mudo. Se borra la fila para que el tutor elija de nuevo entre
-- lo que sí existe.
--
-- ⚠️ NO se traduce a 'banco' automáticamente aunque sea la tarjeta heredera.
-- Elegir por dónde cobra es suyo, y darlo por hecho sería moverle el dinero de
-- sitio sin preguntarle.

delete from public.tutor_payout_preferences where method = 'stripe';

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · EL RIEL MANUAL SE CIERRA EN VENEZUELA — TAMBIÉN AL ESCRIBIR
-- ════════════════════════════════════════════════════════════════════════════
--
-- El punto 4 del dictado dice «los manuales solo para Venezuela», y el ruteo y
-- la pantalla ya lo cumplían: la única fila de `payment_routing_rules` que
-- nombra el riel `manual` es la de VE. Lo que faltaba era la ESCRITURA.
--
-- `upsert_manual_destination` decía en su propio comentario que no mira el país
-- «porque el riel manual existe justamente para los que NO están en el
-- desplegable de dLocal». Esa premisa era verdad en septiembre, cuando el
-- formulario bancario existía en 9 países; con el dictado deja de serlo: el
-- banco se abre a todo país que cubra Wise, dLocal o Stripe, y el único que
-- ninguno alcanza es Venezuela. Medido — dLocal no paga allí, Wise no cotiza el
-- bolívar y Stripe no admite cuentas venezolanas.
--
-- Así que la puerta se cierra por país, y no por lista de canales: el día que
-- otro país se quede sin riel automático, se abre añadiéndole su fila de ruteo
-- con 'manual', que es dato. Lo que no puede seguir pasando es que un tutor de
-- México se guarde un Zelle que nadie va a pagarle.

CREATE OR REPLACE FUNCTION public.upsert_manual_destination(p_channel text, p_holder_name text, p_handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := (select auth.uid());
  v_ch     public.payout_manual_channels%rowtype;
  v_canal  text;
  v_holder text;
  v_handle text;
  v_pais   char(2);
begin
  if v_uid is null then
    raise exception 'requiere sesión' using errcode = 'insufficient_privilege';
  end if;

  -- Guard de rol, y de paso el mismo que usa B1: un alumno no tiene fila en
  -- `tutor_profiles`.
  select tp.payout_country into v_pais
    from public.tutor_profiles tp where tp.profile_id = v_uid;
  if not found then
    raise exception 'solo un tutor puede registrar un destino de cobro'
      using errcode = 'insufficient_privilege';
  end if;

  -- 🔑 EL GUARD DEL DICTADO (9-sep-2026): «los manuales, solo Venezuela».
  --
  -- ⚠️ AQUÍ PONÍA «No se mira `payout_country`: el riel manual existe justamente
  -- para los países que NO están en el desplegable de dLocal». Esa razón era
  -- verdad cuando el formulario bancario existía en 9 países. Con el dictado el
  -- banco se abre a todo país que cubra Wise, dLocal o Stripe, y el único que
  -- ninguno de los tres alcanza es Venezuela (medido: dLocal no paga allí, Wise
  -- no cotiza el bolívar y Stripe no admite cuentas venezolanas).
  --
  -- Sin este guard, un tutor de México podía guardarse un Zelle por la puerta de
  -- atrás: la pantalla no se lo ofrecía, pero la RPC lo aceptaba — y ese destino
  -- no lo iba a pagar nadie, porque su país no rutea el riel 'manual'.
  --
  -- Se pregunta a la TABLA DE RUTEO y no a un literal 'VE': el día que otro país
  -- se quede sin riel automático se le añade 'manual' a su fila y esto lo admite
  -- sin tocar código (regla de oro 5).
  if not ('manual' = any((public.ruta_de_pago(v_pais)).payout_providers)) then
    raise exception 'en tu país te pagamos por transferencia o por PayPal, no a mano'
      using errcode = 'check_violation';
  end if;

  v_canal := lower(btrim(coalesce(p_channel, '')));

  select * into v_ch
    from public.payout_manual_channels c
   where c.channel = v_canal
     and c.is_active;
  if not found then
    raise exception 'ese canal de cobro no existe o ya no está disponible'
      using errcode = 'check_violation';
  end if;

  -- ── Normalización ─────────────────────────────────────────────────────────
  -- El titular pierde el espacio de sobra («Ana  Pérez» → «Ana Pérez») para que
  -- el admin no vea dos titulares donde hay uno. NO se toca el uso de mayúsculas:
  -- un apellido no es nuestro para reescribirlo.
  v_holder := btrim(regexp_replace(coalesce(p_holder_name, ''), '\s+', ' ', 'g'));

  -- El identificador se parte en dos casos y no en uno, porque son dos tipos de
  -- dato distintos disfrazados de columna única:
  --   · con `@` es un correo → minúsculas (la parte del dominio no distingue
  --     mayúsculas y ningún proveedor de los cinco distingue la local),
  --   · sin `@` es un teléfono o un Pay ID → se le quitan los adornos con los
  --     que la gente escribe los números: espacios, paréntesis, puntos y
  --     guiones. «+1 (305) 555-1234» y «+13055551234» son el mismo teléfono, y
  --     guardar las dos formas sería guardar dos verdades del mismo dato.
  v_handle := btrim(coalesce(p_handle, ''));
  if strpos(v_handle, '@') > 0 then
    v_handle := lower(v_handle);
  else
    v_handle := regexp_replace(v_handle, '[\s().-]', '', 'g');
  end if;

  if v_holder = '' then
    raise exception 'falta el nombre del titular: tiene que ser el tuyo, el de la cuenta a la que cobras'
      using errcode = 'check_violation';
  end if;
  if v_handle = '' then
    raise exception 'falta el dato de %', v_ch.handle_label
      using errcode = 'check_violation';
  end if;

  -- La validación de formato. ⚠️ El mensaje NO lleva el handle dentro: nombra el
  -- campo y el canal, que es lo que el tutor necesita para corregirlo, y nada
  -- más. Un error de formato no vale un correo en el log de Vercel.
  if v_handle !~ v_ch.handle_pattern then
    raise exception '«%» no tiene el formato que espera %', v_ch.handle_label, v_ch.label
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.tutor_manual_payout_destinations as d
      (tutor_id, channel, holder_name, handle)
    values
      (v_uid, v_canal, v_holder, v_handle)
    on conflict (tutor_id, channel) do update
       set holder_name = excluded.holder_name,
           handle      = excluded.handle
     where d.tutor_id = v_uid;

    -- Se devuelve el resumen ENMASCARADO, no la fila: así el formulario repinta
    -- sin volver a consultar y sigue sin haber un camino por el que un
    -- identificador de pago llegue entero al navegador.
    return (
      select jsonb_build_object(
        'channel',       d.channel,
        'label',         v_ch.label,
        'holder_name',   d.holder_name,
        'handle_masked', d.handle_masked,
        'updated_at',    d.updated_at
      )
        from public.tutor_manual_payout_destinations d
       where d.tutor_id = v_uid
         and d.channel  = v_canal
    );
  exception
    -- Los tres de `20260901170000`, más `unique_violation`. Ese cuarto no hace
    -- falta hoy —el único índice único es la PK y el `on conflict` la cubre—
    -- pero se deja puesto porque el mensaje de un `unique_violation` lleva **el
    -- valor de la clave** dentro: el día que alguien añada `unique (channel,
    -- handle)` para cazar destinos compartidos, ese mensaje sería el handle
    -- viajando hasta el navegador, y nadie se acordaría de venir aquí.
    when check_violation
      or not_null_violation
      or string_data_right_truncation
      or unique_violation then
      raise exception 'ese dato no tiene el formato que espera %', v_ch.label
        using errcode = 'check_violation';
  end;
end;
$function$;

comment on function public.upsert_manual_destination(text, text, text) is
  'Única puerta de escritura de tutor_manual_payout_destinations. Desde el dictado del 9-sep-2026 EXIGE que el país de cobro del tutor tenga el riel ''manual'' en su fila de payment_routing_rules — hoy solo Venezuela, que es el único país que no alcanzan ni dLocal, ni Wise, ni Stripe. Se pregunta a la tabla de ruteo y no a un literal ''VE'' para que abrir otro país siga siendo una migración de datos. Normaliza el handle (minúsculas si lleva @; sin espacios, puntos, guiones ni paréntesis si no) y devuelve SIEMPRE la forma enmascarada.';

revoke execute on function public.upsert_manual_destination(text, text, text) from public;
revoke execute on function public.upsert_manual_destination(text, text, text) from anon;
grant  execute on function public.upsert_manual_destination(text, text, text) to authenticated;

-- ── Y las filas que entraron por la puerta abierta ─────────────────────────
--
-- Un destino manual de un tutor cuyo país no rutea 'manual' no se puede pagar:
-- no hay quien lo ejecute. Se borra en vez de dejarlo como una promesa muerta
-- en su pantalla.
delete from public.tutor_manual_payout_destinations d
 using public.tutor_profiles tp
 where tp.profile_id = d.tutor_id
   and not ('manual' = any((public.ruta_de_pago(tp.payout_country)).payout_providers));

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · AUTOCOMPROBACIÓN
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ AFIRMA LO QUE ESTA MIGRACIÓN ESCRIBE, no el estado del ambiente: lo de
-- abajo es verdad en dev y en producción por igual en cuanto esto corre.

do $$
declare
  v_con_stripe int;
  v_vacias     text;
begin
  select count(*) into v_con_stripe
    from public.payment_routing_rules where 'stripe' = any(payout_providers);
  if v_con_stripe > 0 then
    raise exception '% filas de ruteo siguen nombrando a stripe como riel de payout', v_con_stripe;
  end if;

  -- Ninguna fila activa puede quedarse sin rieles: sería un país vendible al
  -- que no se le puede pagar, y eso no se ve hasta que hay una orden atascada.
  select string_agg(coalesce(payee_country, 'POR-DEFECTO'), ', ') into v_vacias
    from public.payment_routing_rules
   where is_active and coalesce(array_length(payout_providers, 1), 0) = 0;
  if v_vacias is not null then
    raise exception 'se quedaron sin riel de payout: % — ese tutor no podría cobrar', v_vacias;
  end if;

  -- Venezuela conserva su riel manual: es el único país que lo tiene y el
  -- dictado lo mantiene explícitamente.
  if not ('manual' = any((public.ruta_de_pago('VE')).payout_providers)) then
    raise exception 'Venezuela perdió el riel manual, que es su única vía';
  end if;

  -- Y ningún otro lo tiene: «manual solo Venezuela», comprobado y no supuesto.
  if exists (
    select 1 from public.payment_routing_rules
     where is_active and 'manual' = any(payout_providers)
       and payee_country is distinct from 'VE'
  ) then
    raise exception 'hay un país que no es Venezuela con riel manual';
  end if;
end $$;
