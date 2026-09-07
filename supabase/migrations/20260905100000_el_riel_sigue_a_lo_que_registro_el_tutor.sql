-- ============================================================================
-- Enséñame Ya — qué datos de cobro tiene el tutor, para que el ruteo lo sepa
--
-- 🔴 EL FALLO QUE ARREGLA: UN TUTOR VENEZOLANO CON ZINLI NO COBRABA NUNCA.
--
-- La ruta de Venezuela es `{paypal, manual}` y `payoutProviderFor` se queda con
-- el primer candidato que puede pagar. PayPal puede desde que tiene adaptador,
-- así que se elegía siempre — y entonces el adaptador pedía un destino de
-- PayPal que ese tutor no tiene, devolvía `sin-datos`, y la orden se quedaba en
-- 'scheduled' PARA SIEMPRE: ni pagaba ni fallaba, y nadie se enteraba.
--
-- O sea que los tres canales manuales que el cliente decidió el 3-sep —Zinli,
-- Binance y Zelle— estaban MUERTOS desde el día que PayPal empezó a funcionar,
-- mientras la pantalla se los seguía ofreciendo al tutor.
--
-- ── POR QUÉ UNA FUNCIÓN Y NO UN `select` ───────────────────────────────────
--
-- Porque `service_role` no tiene grants sobre ninguna de las tres tablas de
-- datos de cobro, y es a propósito: dos de ellas guardan números de cuenta
-- (regla de oro 9 + `20260901160000`). Esto no devuelve ni un dato de cobro:
-- devuelve TRES BOOLEANOS y la lista de canales. Con eso basta para elegir riel
-- y no se abre ninguna puerta nueva a la PII.
-- ============================================================================

create or replace function public.datos_de_cobro_del_tutor(p_tutor uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- Cuenta conectada de Stripe: el riel 'stripe' no puede pagar sin ella.
    'conectada', exists (
      select 1 from public.tutor_profiles tp
       where tp.profile_id = p_tutor and tp.stripe_connect_account_id is not null
    ),
    -- Coordenadas bancarias: las piden dLocal y Wise.
    'banco', exists (
      select 1 from public.tutor_payout_accounts a where a.tutor_id = p_tutor
    ),
    -- Los canales de identificador que tenga registrados. 'paypal' es uno más
    -- de esta lista: para el ruteo, la diferencia entre PayPal y Zinli es
    -- exactamente esto y nada más.
    'canales', coalesce(
      (select array_agg(d.channel order by d.channel)
         from public.tutor_manual_payout_destinations d
        where d.tutor_id = p_tutor),
      array[]::text[]
    )
  );
$$;

comment on function public.datos_de_cobro_del_tutor(uuid) is
  'Qué datos de cobro tiene un tutor, en la forma mínima que el ruteo necesita: dos booleanos y la lista de canales. NO devuelve ningún dato de cobro —ni un número de cuenta ni un correo—, por eso puede existir sin abrir grants sobre las tres tablas que los guardan. La usa payoutProviderFor para no elegir un riel que ese tutor no puede usar: antes elegía PayPal para un venezolano con Zinli y la orden se quedaba en scheduled para siempre.';

revoke execute on function public.datos_de_cobro_del_tutor(uuid) from public;
grant  execute on function public.datos_de_cobro_del_tutor(uuid) to service_role;
