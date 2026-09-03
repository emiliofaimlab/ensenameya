-- ============================================================================
-- Enséñame Ya — el destino de PayPal vuelve, y ahora lo cobra un proveedor.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
--
-- `20260903120000` apagó las filas de 'paypal' y 'airtm' con el argumento
-- correcto: no son canales MANUALES, el documento los clasifica como
-- automáticos. Y dejó escrito qué haría falta para devolver PayPal:
--
--     «No se resuelve apagando o encendiendo esta fila, se resuelve
--      automatizando PayPal — que exige la cuenta y la prueba de que admite
--      destinatarios venezolanos.»
--
-- Las dos condiciones se cumplieron el 3-sep-2026:
--
--   · CUENTA · credenciales de PayPal Business, y el sandbox probado de punta a
--     punta: token con scope `payouts`, `POST /v1/payments/payouts` → 201, lote
--     `PROCESSING`, item con su `payout_item_id`.
--   · VENEZUELA · la tabla de países de PayPal dice «Venezuela | Send, receive,
--     and withdraw | VE». Es su fuente primaria, no un blog.
--
-- ⚠️ LO QUE SIGUE SIN ESTAR PROBADO: que un destinatario venezolano REAL reciba.
-- La tabla de PayPal dice que se puede; el sandbox no replica restricciones por
-- país, así que un verde ahí es indicio y no prueba. La confirmación sale de
-- PayPal en vivo, y hasta entonces esto es un riel escrito, no un riel validado.
--
-- ── DÓNDE VIVE EL CORREO DEL TUTOR, Y POR QUÉ AQUÍ ─────────────────────────
--
-- En `tutor_manual_payout_destinations`, la misma tabla que Zinli, Binance y
-- Zelle. NO en una tabla nueva: esa ya resuelve lo caro y lo delicado —etiqueta
-- que lee el tutor, regex que valida lo que escribe, `handle_masked` para el
-- navegador y el valor en claro solo para `service_role`—. Duplicarla para
-- guardar exactamente el mismo dato es dos sitios donde se puede filtrar un
-- identificador en vez de uno.
--
-- ponytail: sí, la tabla se llama «manual» y este canal ya no lo es. Un nombre
-- no justifica una segunda tabla. Quién ejecuta —persona o proveedor— lo sabe el
-- registro de rieles de `lib/payments.ts`, no esta tabla, que solo guarda «a qué
-- identificador se le paga a este tutor». El techo es el nombre; si algún día
-- molesta de verdad, es un `alter table … rename`, no un rediseño.
--
-- Y 'airtm' NO vuelve: descartada en `20260903200000`.
-- ============================================================================

-- ── 1 · El canal vuelve, con el texto cambiado ─────────────────────────────
--
-- El texto importa: el anterior describía un ingreso a mano. Si el tutor lee
-- «se envía a mano» sobre un riel automático, la primera vez que cobre en
-- minutos escribirá a soporte para preguntar si es un error.
update public.payout_manual_channels
   set is_active = true,
       help = 'Recibes en tu saldo de PayPal, en dólares, de forma automática: '
              'lo envía nuestro sistema, no una persona, así que no depende de horarios. '
              'La cuenta tiene que estar a tu nombre. Lo que hagas después con el saldo '
              '(cambiarlo a bolívares) corre por tu cuenta y a tu tipo de cambio.',
       sort_order = 5   -- primero: es el único automático de la lista
 where channel = 'paypal';

-- ── 2 · El beneficiario de los rieles que pagan a un IDENTIFICADOR ──────────
--
-- Hermana de `payout_beneficiary`, y hermana y no ampliación a propósito: aquella
-- construye el cuerpo del POST de dLocal Go a partir de coordenadas BANCARIAS y
-- valida contra `payout_country_rules`. Un riel de identificador no tiene banco,
-- ni tipo de cuenta, ni documento fiscal, y su país no se valida igual — el país
-- lo pone la cuenta que recibe, no nosotros. Meter las dos cosas en una función
-- con un `if` gordo es cómo se acaba mandando un IBAN a PayPal.
--
-- ⚠️ Devuelve el handle EN CLARO. Es el único sitio donde sale de la base, igual
-- que `payout_beneficiary` es el único donde sale un número de cuenta entero, y
-- por el mismo motivo existe el revoke de abajo: sin él sería un endpoint que
-- devuelve correos de tutores a cualquiera con sesión.
create or replace function public.payout_identifier_beneficiary(
  p_payout_id uuid,
  p_channel   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout public.payouts;
  v_dest   public.tutor_manual_payout_destinations;
  v_activo boolean;
begin
  select * into v_payout from public.payouts where id = p_payout_id;
  if not found then
    raise exception 'no existe el payout %', p_payout_id using errcode = 'check_violation';
  end if;

  -- Mismo criterio que `payout_beneficiary`: solo una orden que se está pagando
  -- o va a pagarse. Pedir el beneficiario de una orden ya pagada no tiene un uso
  -- legítimo y sí uno ilegítimo.
  if v_payout.status not in ('scheduled'::public.payout_status,
                             'processing'::public.payout_status) then
    raise exception 'el payout % está en % y no es ejecutable', p_payout_id, v_payout.status
      using errcode = 'check_violation';
  end if;

  -- ⚠️ El canal tiene que estar ACTIVO. Un canal apagado es una decisión de
  -- producto —«por aquí ya no se paga»— y el job tiene que respetarla aunque el
  -- tutor tenga el dato guardado de antes. Es justo lo que pasó con 'airtm'.
  select is_active into v_activo
    from public.payout_manual_channels where channel = p_channel;
  if v_activo is null then
    raise exception 'el canal % no existe', p_channel using errcode = 'check_violation';
  end if;
  if not v_activo then
    raise exception 'el canal % está cerrado y no se puede pagar por él', p_channel
      using errcode = 'check_violation';
  end if;

  select * into v_dest
    from public.tutor_manual_payout_destinations
   where tutor_id = v_payout.tutor_id and channel = p_channel;
  if not found then
    raise exception 'el tutor no ha registrado su destino de %', p_channel
      using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'channel',     p_channel,
    'holder_name', v_dest.holder_name,
    'handle',      v_dest.handle
  );
end $$;

comment on function public.payout_identifier_beneficiary(uuid, text) is
  'El beneficiario de un payout que se paga a un IDENTIFICADOR (correo de PayPal, y mañana cualquier otro riel de esa familia), leído de tutor_manual_payout_destinations. Hermana de payout_beneficiary, que hace lo mismo para las coordenadas BANCARIAS de dLocal Go: son datos distintos, validaciones distintas y cuerpos de POST distintos, y fundirlas es cómo se manda un IBAN a PayPal. Devuelve el handle EN CLARO —es el único sitio donde sale de la base— y por eso solo la ejecuta service_role. Se niega si la orden no es ejecutable, si el canal está cerrado (decisión de producto que el job debe respetar aunque el tutor tenga el dato guardado) o si el tutor no ha declarado destino.';

revoke execute on function public.payout_identifier_beneficiary(uuid, text) from public;
revoke execute on function public.payout_identifier_beneficiary(uuid, text) from anon;
revoke execute on function public.payout_identifier_beneficiary(uuid, text) from authenticated;
grant  execute on function public.payout_identifier_beneficiary(uuid, text) to service_role;

-- ── 3 · Autocomprobación ───────────────────────────────────────────────────
do $$
declare v_activos text; n int;
begin
  select string_agg(channel, ', ' order by sort_order)
    into v_activos from public.payout_manual_channels where is_active;
  if v_activos is distinct from 'paypal, zinli, binance, zelle' then
    raise exception 'los canales activos quedaron en «%»', coalesce(v_activos, '(ninguno)');
  end if;

  -- Airtm sigue fuera, que es lo decidido ayer.
  select count(*) into n from public.payout_manual_channels
   where channel = 'airtm' and is_active;
  if n <> 0 then
    raise exception 'airtm se reactivó, y está descartada';
  end if;

  -- La función existe y NO es ejecutable por el navegador.
  if has_function_privilege('authenticated',
       'public.payout_identifier_beneficiary(uuid, text)', 'execute') then
    raise exception 'payout_identifier_beneficiary es ejecutable por authenticated';
  end if;
  if not has_function_privilege('service_role',
       'public.payout_identifier_beneficiary(uuid, text)', 'execute') then
    raise exception 'service_role no puede ejecutar payout_identifier_beneficiary (regla de oro 9)';
  end if;

  raise notice 'PayPal vuelve como destino automático; airtm sigue fuera.';
end $$;
