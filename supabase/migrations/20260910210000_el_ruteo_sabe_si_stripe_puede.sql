-- ============================================================================
-- Enséñame Ya — el ruteo sabe si Stripe puede pagarle a ESTE tutor
--
-- Fase 5 de `docs/DICTADO-PAGOS.md`, remate.
--
-- `rielSirveParaEsteTutor` contesta «¿puede este riel pagarle a esta persona con
-- lo que tiene registrado?», y hasta hoy para Stripe contestaba lo mismo que
-- para dLocal: «¿tiene cuenta bancaria?». No basta.
--
-- Stripe pide además los dos campos que el formulario marca como OPCIONALES —la
-- fecha de nacimiento y la aceptación de condiciones—, así que un tutor con su
-- banco puesto y esos dos en blanco hacía que se eligiera Stripe, que
-- `payout_beneficiary_stripe` levantara excepción y que la orden se quedara en
-- `sin-datos`. Ni paga ni falla: exactamente el fallo mudo que documenta
-- `riel-viable.ts` y que dejó a un tutor venezolano con Zinli sin cobrar nunca.
--
-- ⚠️ HOY NO ES UNA REGRESIÓN y conviene decirlo: Stripe va el ÚLTIMO en las 18
-- filas que lo nombran, así que detrás no queda nadie a quien caerse. Lo que
-- cambia es que la orden deja de elegir un riel que no puede ejecutar, y que el
-- tutor ve el estado correcto en su pantalla en vez de una tarjeta «lista» que
-- no lo está.
--
-- De paso se va la clave `conectada`, que quedó sin consumidor cuando se borró
-- la familia del mismo nombre.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.datos_de_cobro_del_tutor(p_tutor uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    -- 🔑 STRIPE PIDE MÁS QUE COORDENADAS, igual que Wise, y por eso tiene su
    -- propia clave en vez de estrechar 'banco'.
    --
    -- ⚠️ AQUÍ HABÍA UNA CLAVE 'conectada' que miraba si el tutor tenía cuenta de
    -- Stripe Connect. Se fue con la familia entera el 9-sep-2026: el tutor ya no
    -- da de alta ninguna cuenta — la creamos nosotros con lo que él teclea.
    --
    -- Lo que Stripe necesita ahora son los dos campos OPCIONALES del formulario:
    -- la fecha de nacimiento y la aceptación de condiciones. Sin ellos
    -- `payout_beneficiary_stripe` levanta excepción y la orden se queda quieta
    -- en `sin-datos` — el mismo fallo mudo que dejó a un tutor venezolano con
    -- Zinli sin cobrar nunca, y la razón por la que esta función existe.
    --
    -- ⚠️ NO se comprueba el PAÍS aquí, y es a propósito. Stripe no admite
    -- cuentas de EE. UU. ni de Brasil desde una plataforma estadounidense
    -- (medido), pero quien sabe eso es Stripe: el adaptador lo clasifica como
    -- `sin-datos` y la orden baja al siguiente candidato. Una lista de países en
    -- esta función sería una SEGUNDA lista que mantener sincronizada con la
    -- suya, que es justo lo que el adaptador evita a propósito.
    'banco_stripe', exists (
      select 1 from public.tutor_payout_accounts a
       where a.tutor_id = p_tutor
         and a.beneficiary_dob is not null
         and a.stripe_tos_accepted_at is not null
         and a.stripe_tos_ip is not null
    ),
    -- Coordenadas bancarias: las piden dLocal y Wise.
    'banco', exists (
      select 1 from public.tutor_payout_accounts a where a.tutor_id = p_tutor
    ),
    -- ⚠️ Y Wise pide MÁS que coordenadas: dirección, teléfono, un país que
    -- cubra y un banco que conozca. Sin esta clave aparte, el resolvedor elegiría
    -- Wise para cualquiera que tuviese banco y el adaptador devolvería
    -- 'sin-datos' para siempre — la orden ni pagaría ni fallaría.
    'banco_wise', public.wise_puede_pagar_a(p_tutor),
    -- Los canales de identificador que tenga registrados. 'paypal' es uno más
    -- de esta lista.
    'canales', coalesce(
      (select array_agg(d.channel order by d.channel)
         from public.tutor_manual_payout_destinations d
        where d.tutor_id = p_tutor),
      array[]::text[]
    ),
    -- 🔑 Y por dónde PREFIERE cobrar. Es lo único de este objeto que no describe
    -- un dato registrado sino una decisión suya, y por eso puede ser null sin
    -- que signifique «le falta algo»: significa «nos da igual, decidid
    -- vosotros», que es el comportamiento que había antes de esta migración.
    'metodo_preferido', (
      select p.method
        from public.tutor_payout_preferences p
       where p.tutor_id = p_tutor
    )
  );
$function$;
