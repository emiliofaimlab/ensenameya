-- ============================================================================
-- Enséñame Ya — inscritos_de_clase devuelve también el id de cada uno (G3)
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- El chat del grupo (RG-13) pinta encima de cada mensaje ajeno el nombre de
-- quien lo escribió, y `messages` solo trae `sender_id`. Sin el id en esta
-- lista no hay forma de casar una cosa con la otra.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · REEMPLAZA a la versión de `20261009210000:84`. Mismo cuerpo, misma guarda
--   (solo el tutor y los inscritos pagados), con `user_id` delante.
-- · Cambia el tipo de vuelta, así que es `drop` + `create` (regla 12) y se
--   reponen los grants que el `drop` se lleva.
-- · El id no enseña nada nuevo: quien ve esta lista ya ve los `sender_id` del
--   hilo, que son los mismos.
-- ============================================================================

drop function if exists public.inscritos_de_clase(uuid);

create function public.inscritos_de_clase(p_product uuid)
returns table (user_id uuid, nombre text, avatar_path text, es_tutor boolean)
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
    select tp.profile_id, tp.display_name, tp.avatar_path, true
      from public.tutor_profiles tp where tp.profile_id = v_tutor
    union all
    select b.student_id, public.mask_person_name(pr.full_name), pr.avatar_path, false
      from public.bookings b
      join public.profiles pr on pr.id = b.student_id
     where b.product_id = p_product
       and b.status in ('confirmed', 'in_progress', 'completed')
     order by 4 desc, 2;
end;
$$;

comment on function public.inscritos_de_clase(uuid) is
  'RG-19 · quién está en la clase: el tutor y los alumnos con el cupo pagado, con su id, nombre visible (mask_person_name) y foto. Solo para el tutor y los inscritos pagados; a cualquier otro, «clase no encontrada». El id casa los mensajes del chat del grupo con su autor.';

revoke execute on function public.inscritos_de_clase(uuid) from public, anon;
grant  execute on function public.inscritos_de_clase(uuid) to authenticated;
