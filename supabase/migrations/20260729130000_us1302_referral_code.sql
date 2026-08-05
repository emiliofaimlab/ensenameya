-- ============================================================================
-- US-1302 · Captura del código de referido (EP-13, S-18/RN-21)
--
-- El alta por correo ya mandaba `referral_code` en el metadata del usuario,
-- pero quien lo escribía en `profiles` era el formulario, DESPUÉS del signup y
-- sólo si había sesión inmediata. Con la confirmación por correo activa (que es
-- como está la nube) no hay sesión en ese momento: el código se quedaba en
-- `auth.users.raw_user_meta_data` y nunca llegaba al perfil.
--
-- El sitio correcto es el trigger que ya crea el perfil: copia `full_name` y
-- `timezone` del metadata, así que copia también el código. Un solo camino para
-- las dos variantes del alta por correo, y el cliente deja de escribirlo.
--
-- El alta por Google no pasa por aquí con código (el metadata lo trae Google),
-- así que esa rama la cubre AU04 en el cliente, igual que hace con `intended_role`.
--
-- Sin lógica de referidos: `profiles.referral_code` es sólo atribución para
-- Referral Factory (RN-21).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, timezone, referral_code)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'),
    nullif(trim(new.raw_user_meta_data ->> 'referral_code'), '')
  );

  -- Todo registro nace como 'alumno'. El rol 'tutor' se otorga tras la
  -- aprobación manual del admin (Doc 2: M1/M2).
  insert into public.user_roles (user_id, role)
  values (new.id, 'alumno');

  return new;
end;
$$;
