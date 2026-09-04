-- ============================================================================
-- Enséñame Ya — el tutor CONECTA su cuenta de PayPal en vez de teclear un correo
--
-- ── POR QUÉ, Y NO ES UNA PREFERENCIA ───────────────────────────────────────
--
-- Medido el 4-sep-2026 contra el sandbox, cuatro veces:
--
--     receptor = correo tecleado   → UNCLAIMED  (4 de 4)
--     receptor = id de cuenta      → SUCCESS    (inmediato)
--
-- Un payout por correo solo llega si esa dirección está CONFIRMADA en una
-- cuenta de PayPal, y eso no se puede comprobar al guardarlo: se descubre
-- semanas después, cuando el dinero vuelve. Peor: el lote informa `SUCCESS`
-- igualmente, así que ni siquiera parece un fallo.
--
-- Conectando la cuenta desaparece la clase entera de fallos —la errata, el
-- correo de otra persona, el correo sin confirmar— porque el dato ya no lo
-- teclea nadie: lo firma PayPal.
--
-- ⚠️ EL CORREO NO SE VA. Sigue siendo el respaldo para quien no quiera conectar
-- su cuenta, y la columna nueva es NULL en ese caso. El adaptador prefiere el
-- id cuando lo hay y usa el correo cuando no.
-- ============================================================================

alter table public.tutor_manual_payout_destinations
  add column if not exists verified_account_id text;

comment on column public.tutor_manual_payout_destinations.verified_account_id is
  'Identificador de la cuenta del proveedor, cuando el tutor la ha CONECTADO en vez de teclear un dato (hoy solo PayPal: su payer_id, vía Log in with PayPal). NULL = el tutor escribió el dato a mano y el pago irá al handle. Se prefiere este campo al handle porque el handle puede ser un correo sin confirmar —medido: 4 de 4 payouts por correo quedaron UNCLAIMED y el mismo pago al id salió SUCCESS—. No lo escribe el navegador: lo pone conectar_cuenta_paypal desde el callback del OAuth.';

-- El tutor ve si la tiene conectada; NO puede escribirla (apuntaría su dinero a
-- otra cuenta). El grant de columna es lo que hace que PostgREST la devuelva.
grant select (verified_account_id) on public.tutor_manual_payout_destinations to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- conectar_cuenta_paypal — lo que escribe el callback del OAuth
-- ════════════════════════════════════════════════════════════════════════════
--
-- Va por función y no por un `update` con grants por dos motivos: el destino se
-- CREA si el tutor no tenía ninguno (conectar es el camino corto, sin
-- formulario), y los tres datos vienen firmados por PayPal, así que se escriben
-- juntos o no se escribe nada.

create or replace function public.conectar_cuenta_paypal(
  p_tutor    uuid,
  p_payer_id text,
  p_email    text,
  p_holder   text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tutor is null or coalesce(trim(p_payer_id), '') = '' then
    raise exception 'faltan el tutor o el payer_id' using errcode = 'check_violation';
  end if;

  insert into public.tutor_manual_payout_destinations
    (tutor_id, channel, holder_name, handle, verified_account_id)
  values
    (p_tutor, 'paypal', coalesce(nullif(trim(p_holder), ''), 'Cuenta de PayPal'),
     lower(trim(p_email)), trim(p_payer_id))
  on conflict (tutor_id, channel) do update
    set holder_name         = excluded.holder_name,
        handle              = excluded.handle,
        verified_account_id = excluded.verified_account_id;
end $$;

comment on function public.conectar_cuenta_paypal(uuid, text, text, text) is
  'Guarda la cuenta de PayPal que el tutor acaba de conectar por OAuth (Log in with PayPal). Crea el destino si no lo tenía: conectar es el camino corto y no pasa por el formulario. Solo service_role, y solo desde /api/tutor/paypal-connect/callback, que es quien ha visto el token.';

revoke execute on function public.conectar_cuenta_paypal(uuid, text, text, text) from public;
grant  execute on function public.conectar_cuenta_paypal(uuid, text, text, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- El beneficiario devuelve también el id conectado
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un campo más en el jsonb que ya devolvía. Quien decide cuál usar es el
-- adaptador, no esta función: aquí solo se dice qué hay.

create or replace function public.payout_identifier_beneficiary(p_payout_id uuid, p_channel text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payout public.payouts;
  v_activo boolean;
  v_dest   public.tutor_manual_payout_destinations;
begin
  select * into v_payout from public.payouts p where p.id = p_payout_id;
  if not found then
    raise exception 'payout % no existe', p_payout_id using errcode = 'no_data_found';
  end if;
  if v_payout.status not in ('scheduled'::public.payout_status,
                             'processing'::public.payout_status) then
    raise exception 'el payout % está en % y no es ejecutable', p_payout_id, v_payout.status
      using errcode = 'check_violation';
  end if;

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
    'channel',             p_channel,
    'holder_name',         v_dest.holder_name,
    'handle',              v_dest.handle,
    'verified_account_id', v_dest.verified_account_id
  );
end $$;
