-- ============================================================================
-- "30+ Países" de P01. Refs: EY-110, RN-15/RN-16 (ruteo por geografía), C-13.
--
-- El Figma remata la banda de cifras con "Países", y el modelo **no tiene país**:
-- `bookings.payee_country` existe, pero `create_booking` lo escribe con un
-- `v_payee char(2) := 'VE'` hardcodeado, a la espera de C-13 (mercado) — el país
-- de cobro del tutor es precisamente una de las decisiones bloqueantes.
--
-- Pedirle el país al tutor implica decidir la lista de países que sirve la
-- plataforma, o sea C-13. Pero el dato ya está ahí de otra forma: la zona
-- horaria es obligatoria desde el registro (RN-01) y, para todo el cono
-- americano y España, una zona = un país. Así que la cifra se DERIVA de la zona
-- en vez de inventarse un número o añadir un campo que hoy nadie puede
-- responder.
--
-- Cuando C-13 se cierre y el tutor declare su país de cobro, esta función pasa a
-- contar esa columna y el `'VE'` hardcodeado se cae con ella.
-- ============================================================================

-- Zona horaria → ISO-3166 alpha-2. Solo las zonas del mercado objetivo; el resto
-- devuelve null y no suma (una cifra de vitrina prefiere quedarse corta a mentir).
create or replace function public.country_from_timezone(p_tz text)
returns char(2)
language sql
immutable
set search_path = ''
as $$
  select case p_tz
    when 'America/Caracas'             then 'VE'
    when 'America/Bogota'              then 'CO'
    when 'America/Lima'                then 'PE'
    when 'America/Guayaquil'           then 'EC'
    when 'America/La_Paz'              then 'BO'
    when 'America/Santiago'            then 'CL'
    when 'America/Asuncion'            then 'PY'
    when 'America/Montevideo'          then 'UY'
    when 'America/Argentina/Buenos_Aires' then 'AR'
    when 'America/Argentina/Cordoba'   then 'AR'
    when 'America/Argentina/Mendoza'   then 'AR'
    when 'America/Sao_Paulo'           then 'BR'
    when 'America/Manaus'              then 'BR'
    when 'America/Bahia'               then 'BR'
    when 'America/Mexico_City'         then 'MX'
    when 'America/Tijuana'             then 'MX'
    when 'America/Monterrey'           then 'MX'
    when 'America/Cancun'              then 'MX'
    when 'America/Guatemala'           then 'GT'
    when 'America/El_Salvador'         then 'SV'
    when 'America/Tegucigalpa'         then 'HN'
    when 'America/Managua'             then 'NI'
    when 'America/Costa_Rica'          then 'CR'
    when 'America/Panama'              then 'PA'
    when 'America/Havana'              then 'CU'
    when 'America/Santo_Domingo'       then 'DO'
    when 'America/Puerto_Rico'         then 'PR'
    when 'America/New_York'            then 'US'
    when 'America/Chicago'             then 'US'
    when 'America/Denver'              then 'US'
    when 'America/Phoenix'             then 'US'
    when 'America/Los_Angeles'         then 'US'
    when 'America/Toronto'             then 'CA'
    when 'America/Vancouver'           then 'CA'
    when 'Europe/Madrid'               then 'ES'
    when 'Atlantic/Canary'             then 'ES'
    when 'Europe/Lisbon'               then 'PT'
    when 'Europe/London'               then 'GB'
    else null
  end::char(2);
$$;

-- `categories` sale y entra `countries`: el Figma pide países y ya hay de dónde
-- sacarlos. Cuenta tutores aprobados, que son los que "cubren" un país.
create or replace function public.home_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tutors',     (select count(*) from public.tutor_profiles where approval_status = 'approved'),
    'sessions',   (select count(*) from public.bookings        where status = 'completed'),
    'rating_avg', (select round(avg(rating), 1) from public.reviews),
    'countries',  (select count(distinct public.country_from_timezone(p.timezone))
                     from public.tutor_profiles tp
                     join public.profiles p on p.id = tp.profile_id
                    where tp.approval_status = 'approved')
  );
$$;

grant execute on function public.country_from_timezone(text) to anon, authenticated;
grant execute on function public.home_stats() to anon, authenticated;
