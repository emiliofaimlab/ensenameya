-- ============================================================================
-- US-1801 · Consentimiento de grabación (EP-18, RN-42, M9)
--
-- La regla es dura: **sin el sí de LOS DOS no se graba**. Y el sí se da ANTES
-- de entrar a la sala, no a mitad de clase.
--
-- La fila ES el consentimiento: existe = dijo que sí. Retirar es borrarla, no
-- editar un booleano — así no hay estado "false" que confundir con "todavía no
-- ha contestado", que a efectos de RN-42 son la misma cosa (no se graba) pero
-- se cuentan distinto en la pantalla.
--
-- La grabación en sí la hace Daily (add-on de pago, EP-18): esta tabla decide
-- si la sala se crea CON grabación habilitada. Sin las dos filas, la sala ni
-- ofrece el botón.
-- ============================================================================

create table if not exists public.session_recording_consents (
  session_id uuid        not null references public.sessions (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

comment on table public.session_recording_consents is
  'RN-42: una fila por participante que acepta que se grabe la sesión. Dos filas = se puede grabar.';

alter table public.session_recording_consents enable row level security;

-- Los DOS participantes leen las dos filas: cada uno necesita saber si el otro
-- ya aceptó (la pantalla dice "esperando al tutor/alumno").
create policy "recording_consents_select_participant"
  on public.session_recording_consents for select
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_recording_consents.session_id
        and (select auth.uid()) in (s.student_id, s.tutor_id)
    )
  );

-- Cada uno consiente por SÍ MISMO. Sin esto, el tutor podría "aceptar" por el
-- alumno y grabarlo sin permiso, que es justo lo que RN-42 impide.
create policy "recording_consents_insert_own"
  on public.session_recording_consents for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.sessions s
      where s.id = session_recording_consents.session_id
        and (select auth.uid()) in (s.student_id, s.tutor_id)
    )
  );

-- Retirar el propio consentimiento. No hay update: un consentimiento no se
-- edita, se quita y se vuelve a dar.
create policy "recording_consents_delete_own"
  on public.session_recording_consents for delete
  using ( user_id = (select auth.uid()) );

grant select, insert, delete on public.session_recording_consents to authenticated;

-- ── ¿Se puede grabar esta sesión? ───────────────────────────────────────────
-- Lo pregunta el endpoint de la sala antes de crear la room en Daily. Va como
-- función y no como consulta suelta para que la regla ("los dos") viva en un
-- sitio y no se copie en cada llamador.
create or replace function public.recording_allowed(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sessions s
    join public.session_recording_consents cs on cs.session_id = s.id and cs.user_id = s.student_id
    join public.session_recording_consents ct on ct.session_id = s.id and ct.user_id = s.tutor_id
    where s.id = p_session_id
  );
$$;

grant execute on function public.recording_allowed(uuid) to authenticated;
