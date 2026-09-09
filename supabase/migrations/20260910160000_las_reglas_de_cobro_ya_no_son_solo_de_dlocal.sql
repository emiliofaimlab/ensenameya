-- ══════════════════════════════════════════════════════════════════════════════
-- LOS COMENTARIOS DE LAS DOS TABLAS DE REGLAS, PUESTOS AL DÍA
--
-- Migración separada de `20260910150000` y no un párrafo suyo, a propósito:
-- aquella ya estaba aplicada en dev cuando se vio esto, y reescribir una
-- migración aplicada deja el fichero diciendo una cosa y la base otra —
-- exactamente la deriva que la regla de oro 5 existe para evitar. Dos `comment
-- on` no valen ese riesgo.
--
-- 🔴 POR QUÉ UN COMENTARIO MERECE UNA MIGRACIÓN. Porque en este proyecto la
-- documentación desactualizada sobre pagos ya ha costado semanas: el «dLocal
-- rechazó la cuenta» que seis documentos repitieron un mes de más, el «USD→PAB no
-- se puede» que tuvo cerrado a Panamá —tres tutores— por haber medido con la
-- moneda equivocada, el «ref_email» que no existió nunca. `payout_country_rules`
-- pasó de 9 filas de dLocal a 55, de las cuales 46 no tienen nada que ver con
-- dLocal, y su comentario seguía diciendo «los 8 países que sirve: AR, BR, CL,
-- EC, MX, PE, PY, UY». Quien lo lea buscando por qué España tiene fila se va con
-- la idea contraria a la verdad.
-- ══════════════════════════════════════════════════════════════════════════════

comment on table public.payout_country_rules is
  'Qué campos se le piden al tutor para pagarle, en qué formato y contra qué lista de bancos — POR PAÍS, y no por proveedor. Nació el 1-sep-2026 describiendo lo que exige dLocal Go en sus 8 países (AR BR CL EC MX PE PY UY) y desde el 10-sep-2026 describe 55: la aclaración del cliente al dictado de pagos abrió el formulario bancario a todo país que cubra Wise, dLocal o Stripe (docs/DICTADO-PAGOS.md §4). Es la PUERTA de ese formulario: sin fila, /tutor/payouts no pinta la tarjeta de Banco y ese tutor no puede cobrar por transferencia. Y es la fuente de verdad de la validación (la usa payout_account_check) Y del texto que lee el tutor, a propósito: si el rótulo y la regla viven en ficheros distintos, se desincronizan. No es PII: es documentación de proveedor transcrita, y por eso authenticated puede leerla. Quién puede pagar de verdad en cada país lo dicen payment_routing_rules (el riel) y wise_account_type (si Wise llega), no la existencia de la fila.';

comment on table public.payout_banks is
  'Los bancos entre los que el tutor elige, por país. Dos naturalezas en la misma tabla y conviene no confundirlas: (1) los 612+ códigos de los países de dLocal Go, transcritos a mano de su documentación porque NO hay endpoint que los sirva ni que valide una cuenta —la única validación real ocurre en el POST /v1/payouts y su fallo vuelve como REJECTED por webhook, semanas después—; y (2) desde el 10-sep-2026, UNA fila centinela por cada país nuevo (IBAN, SWIFT, ABA, SORT, BSB, IFSC), que existe porque tutor_payout_accounts.bank_code es not null y tiene FK contra esta tabla, pero donde no hay banco que elegir: el propio número de cuenta identifica al banco. El formulario no pinta desplegable cuando el país tiene una sola fila. Los códigos son TEXTO porque los ceros a la izquierda son parte del valor. Las filas no se borran (hay FK desde tutor_payout_accounts): se ponen is_active = false.';
