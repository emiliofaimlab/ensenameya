-- ============================================================================
-- Enséñame Ya — el segundo número del banco se llama como toque en cada país
--
-- Remate de la fase 3 de `docs/DICTADO-PAGOS.md`.
--
-- ── EL PROBLEMA, EN UNA FRASE ──────────────────────────────────────────────
--
-- Con 9 países, el segundo dato bancario era siempre la SUCURSAL (la agência
-- brasileña, la sucursal uruguaya) y llamarlo así en todas partes era correcto.
-- Con 55 ya no: en Reino Unido es el *sort code*, en Estados Unidos el número de
-- ruta ACH, en Australia el BSB, en India el IFSC y en 7 países más el BIC.
--
-- `validarCuenta()` seguía devolviendo «Falta la sucursal, que en este país es
-- obligatoria» a un tutor británico al que lo que le falta es su sort code. Un
-- mensaje de error que nombra un campo que no existe en su formulario es un
-- tutor que no sabe qué corregir — y un tutor que no cobra.
--
-- ── POR QUÉ UNA COLUMNA Y NO UN `Record<>` EN EL TSX ───────────────────────
--
-- Porque es exactamente el mismo problema que ya resolvieron `account_label` y
-- `account_help` en esta misma tabla, y su razón sigue valiendo palabra por
-- palabra: «si el texto que lee el tutor y la regla que valida su cuenta están
-- en ficheros distintos, se desincronizan y el que se entera es él, tres semanas
-- después». Un mapa en el componente vive en un fichero distinto de
-- `branch_pattern`, que es la regla que de verdad lo valida.
--
-- Consecuencia buscada: abrir un país sigue siendo UNA FILA, también en lo que
-- el tutor lee. Y el `Record<>` que había en `payout-account-form.tsx` se borra.
-- ============================================================================

alter table public.payout_country_rules
  add column if not exists branch_label text,
  add column if not exists branch_help  text;

comment on column public.payout_country_rules.branch_label is
  'Cómo se llama EN ESTE PAÍS el segundo dato bancario, el que valida branch_pattern: «Sucursal», «Sort code», «Número de ruta (ABA)», «BSB», «Código IFSC», «Código BIC / SWIFT». Lo leen el formulario del tutor y validarCuenta(), que es lo que impide que el mensaje de error nombre un campo que no está en pantalla. NULL cuando el país no pide segundo dato (requires_branch = false).';

comment on column public.payout_country_rules.branch_help is
  'La ayuda bajo ese campo, en la voz del sitio y en segunda persona. Vive aquí y no en el TSX por lo mismo que account_help: el texto y la regla que lo valida tienen que poder cambiar juntos. NULL = sin ayuda.';

-- ── Los rótulos, por FORMATO y no país a país ──────────────────────────────
--
-- Mismo criterio con el que se abrieron los 46 países nuevos: el formato manda,
-- así que un país que mañana entre con `wise_account_type = 'iban'` hereda su
-- rótulo sin tocar esto.

update public.payout_country_rules set
  branch_label = 'Sort code',
  branch_help  = 'Seis dígitos, con o sin guiones. Lo tienes en tu banca en línea.'
 where wise_account_type = 'sort_code';

update public.payout_country_rules set
  branch_label = 'Número de ruta (ABA)',
  branch_help  = 'Nueve dígitos. Tiene que ser el de transferencias ACH, no el de wire: son distintos y el de wire lo rechazan.'
 where wise_account_type = 'aba';

update public.payout_country_rules set
  branch_label = 'BSB',
  branch_help  = 'Seis dígitos, con o sin guion.'
 where wise_account_type = 'australian';

update public.payout_country_rules set
  branch_label = 'Código IFSC',
  branch_help  = 'Once caracteres; el quinto es siempre un cero.'
 where wise_account_type = 'indian';

update public.payout_country_rules set
  branch_label = 'Código BIC / SWIFT',
  branch_help  = 'Ocho u once caracteres. Lo encuentras en tu banca en línea o en tu extracto.'
 where wise_account_type = 'swift_code';

-- El resto de los que piden segundo dato son los de siempre: ahí sí es una
-- sucursal de verdad. `coalesce` y no un `where` por lista: lo que decide es
-- «pide segundo dato y aún no tiene rótulo», que es la condición real.
update public.payout_country_rules set
  branch_label = coalesce(branch_label, 'Sucursal'),
  branch_help  = coalesce(branch_help, 'El número de la oficina donde abriste la cuenta.')
 where requires_branch;

-- ── Autocomprobación ───────────────────────────────────────────────────────
--
-- ⚠️ Afirma la INVARIANTE —«todo país que pide segundo dato sabe cómo se
-- llama»—, no el estado del ambiente. Es verdad en dev y en producción en
-- cuanto esto corre, porque lo acaba de escribir esta migración.

do $$
declare
  v_mudos text;
begin
  select string_agg(country, ', ') into v_mudos
    from public.payout_country_rules
   where requires_branch and (branch_label is null or btrim(branch_label) = '');
  if v_mudos is not null then
    raise exception 'piden segundo dato bancario y no saben cómo se llama: % — el tutor vería «Falta la sucursal» sin tener ese campo', v_mudos;
  end if;
end $$;
