-- ============================================================================
-- EY-238 · "Países" de la home contaba mal.
--
-- `20260723140000` derivaba el país de la ZONA HORARIA porque entonces el tutor
-- no declaraba país, y dejó escrito que cambiaría cuando lo hiciera. Lo hace
-- desde `20260901140000` (`tutor_profiles.payout_country`), y la zona miente:
-- en dev hay tutores en Caracas que cobran en CL o en Lima que cobran en VE.
--
-- Manda el país declarado; la zona queda solo de respaldo para quien aún no lo
-- ha declarado. Sin cambio de firma → `create or replace` (los grants siguen).
-- ============================================================================

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
    'countries',  (select count(distinct coalesce(tp.payout_country,
                                                  public.country_from_timezone(p.timezone)))
                     from public.tutor_profiles tp
                     join public.profiles p on p.id = tp.profile_id
                    where tp.approval_status = 'approved')
  );
$$;

comment on function public.home_stats() is
  'Cifras de la home. countries = países distintos de los tutores aprobados: tutor_profiles.payout_country y, si no lo declaró, el derivado de su zona horaria (EY-238).';
