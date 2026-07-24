-- ============================================================================
-- Enséñame Ya — AD13 (US-1105): series para los gráficos de Estadísticas.
-- Dos agregaciones de SOLO LECTURA, guard `has_role('admin')` dentro, mismo
-- patrón que `admin_stats`:
--   · admin_gmv_weekly(p_weeks) — GMV cobrado por semana (barras 228:76)
--   · admin_bookings_by_category(p_from, p_to) — reservas por categoría (228:115)
-- Sin tablas nuevas, sin RLS que tocar. El dinero solo se lee.
-- ============================================================================

create or replace function public.admin_gmv_weekly(p_weeks int default 12)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin ve las estadísticas'
      using errcode = 'insufficient_privilege';
  end if;

  -- GMV = bruto cobrado (paid / partially_refunded / refunded se cobró
  -- igual; el reembolso se mira aparte, como en admin_stats). Semana ISO.
  select coalesce(jsonb_agg(w order by w.week_start), '[]'::jsonb)
    into v_out
  from (
    select date_trunc('week', p.paid_at)::date as week_start,
           p.currency,
           sum(p.gross_amount)::bigint as gmv
    from public.payments p
    where p.paid_at is not null
      and p.paid_at >= date_trunc('week', now()) - make_interval(weeks => p_weeks - 1)
      and p.status in ('paid', 'partially_refunded', 'refunded')
    group by 1, 2
  ) w;

  return v_out;
end;
$$;

grant execute on function public.admin_gmv_weekly(int) to authenticated;

create or replace function public.admin_bookings_by_category(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := case when p_from is null then '-infinity'::timestamptz
                             else p_from::timestamptz end;
  v_to   timestamptz := case when p_to is null then 'infinity'::timestamptz
                             else (p_to + 1)::timestamptz end;
  v_out jsonb;
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin ve las estadísticas'
      using errcode = 'insufficient_privilege';
  end if;

  -- Una reserva cuenta en cada categoría de su producto (N–M): mide interés
  -- por categoría, no suma exclusiva.
  select coalesce(jsonb_agg(c order by c.bookings desc), '[]'::jsonb)
    into v_out
  from (
    select cat.name,
           count(distinct b.id)::int as bookings
    from public.bookings b
    join public.product_categories pc on pc.product_id = b.product_id
    join public.categories cat on cat.id = pc.category_id
    where b.created_at >= v_from and b.created_at < v_to
    group by cat.name
  ) c;

  return v_out;
end;
$$;

grant execute on function public.admin_bookings_by_category(date, date) to authenticated;
