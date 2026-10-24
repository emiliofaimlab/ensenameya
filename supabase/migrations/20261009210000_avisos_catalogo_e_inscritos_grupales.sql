-- ============================================================================
-- Enséñame Ya — avisos de inscripción, catálogo e inscritos de las grupales
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Dos de las tres últimas piezas de grupales de la Fase C
-- (`docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §10.2); la tercera, los avisos de
-- inscripción, está en `20261009210100`:
--   2. `group_classes_public` + `cupos_libres()`: lo que el catálogo enseña de
--      una clase (fechas y «quedan N cupos») a cualquiera, anon incluido.
--   3. `inscritos_de_clase()`: nombre visible y foto de los inscritos (RG-19),
--      solo para quien está en la clase.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · Las fechas de una clase las ve QUIEN VE SU PRODUCTO: la política nueva
--   pregunta a `products`, que ya trae su RLS (activo, público, tutor
--   aprobado). No hay una segunda regla de visibilidad que mantener al día.
-- · `group_classes` pasa a grant POR COLUMNA: `daily_room_name` y
--   `recordings_purged_at` no se leen desde el cliente. La sala se obtiene con
--   `join_group_class`, que ya comprueba quién entra.
-- · `cupos_libres` es SECURITY DEFINER a propósito: cuenta reservas de otros
--   alumnos, que la RLS de bookings le esconde a quien mira el catálogo. Solo
--   devuelve un número.
-- ============================================================================

-- (El cambio de `notify_booking` va en `20261009210100`.)


-- ── 2 · catálogo: fechas y cupos libres ─────────────────────────────────────
create or replace function public.cupos_libres(p_product uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
           p.capacity - (select count(*) from public.bookings b
                          where b.product_id = p.id
                            and b.status in ('pending_payment', 'pending_acceptance', 'confirmed', 'in_progress')),
           0)::int
    from public.products p
   where p.id = p_product and p.pricing_model = 'group'
$$;

comment on function public.cupos_libres(uuid) is
  'RG-08/20 · cupos que quedan en una clase grupal: capacidad menos reservas vivas (un pago en curso ocupa su cupo). NULL si el producto no es grupal. Solo devuelve el número.';

revoke execute on function public.cupos_libres(uuid) from public;
grant  execute on function public.cupos_libres(uuid) to anon, authenticated, service_role;

drop policy if exists "group_classes_select_publica" on public.group_classes;
create policy "group_classes_select_publica"
  on public.group_classes for select
  using ( exists (select 1 from public.products p where p.id = group_classes.product_id) );

comment on policy "group_classes_select_publica" on public.group_classes is
  'Las fechas de una clase las ve quien ve su producto: hereda la RLS de products (activo, público, tutor aprobado; privadas solo para su lista).';

revoke select on public.group_classes from authenticated;
grant select (id, product_id, tutor_id, sequence_no, start_at, end_at, status,
              rescheduled_at, cancelled_at, cancel_reason, created_at, updated_at)
  on public.group_classes to anon, authenticated;

create or replace view public.group_classes_public
with (security_invoker = true) as
  select g.id,
         g.product_id,
         g.sequence_no,
         g.start_at,
         g.end_at,
         p.capacity,
         public.cupos_libres(g.product_id) as cupos_libres
    from public.group_classes g
    join public.products p on p.id = g.product_id
   where g.status = 'scheduled';

comment on view public.group_classes_public is
  'G2 · lo que el catálogo enseña de una clase grupal: sus fechas pendientes, el cupo y cuántos quedan. security_invoker: hereda la RLS de group_classes y products.';

grant select on public.group_classes_public to anon, authenticated;


-- ── 3 · inscritos_de_clase (RG-19) ──────────────────────────────────────────
create or replace function public.inscritos_de_clase(p_product uuid)
returns table (nombre text, avatar_path text, es_tutor boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_tutor uuid;
begin
  select p.tutor_id into v_tutor
    from public.products p where p.id = p_product and p.pricing_model = 'group';

  if v_tutor is null
     or (v_uid is distinct from v_tutor and not exists (
           select 1 from public.bookings b
            where b.product_id = p_product and b.student_id = v_uid
              and b.status in ('confirmed', 'in_progress', 'completed')))
  then
    raise exception 'clase no encontrada' using errcode = 'no_data_found';
  end if;

  return query
    select tp.display_name, tp.avatar_path, true
      from public.tutor_profiles tp where tp.profile_id = v_tutor
    union all
    select public.mask_person_name(pr.full_name), pr.avatar_path, false
      from public.bookings b
      join public.profiles pr on pr.id = b.student_id
     where b.product_id = p_product
       and b.status in ('confirmed', 'in_progress', 'completed')
     order by 3 desc, 1;
end;
$$;

comment on function public.inscritos_de_clase(uuid) is
  'RG-19 · quién está en la clase: el tutor y los alumnos con el cupo pagado, solo con nombre visible (mask_person_name) y foto. Solo para el tutor y los inscritos pagados; a cualquier otro, «clase no encontrada».';

revoke execute on function public.inscritos_de_clase(uuid) from public, anon;
grant  execute on function public.inscritos_de_clase(uuid) to authenticated;
