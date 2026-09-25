-- Al darse de baja, la conexión con Google Calendar se borra en el acto.
--
-- La baja NO borra `profiles` (anonimiza y deja la fila), así que el
-- `on delete cascade` de `google_calendar_connections` nunca se dispara y el
-- refresh token —cifrado, pero vivo— se quedaría guardado de alguien que ya no
-- está. La política de privacidad promete lo contrario (25-sep).
--
-- Mismo recurso que `purgar_navegacion_de_baja` (`20260827140000`): un trigger
-- sobre `account_deletions`, el rastro que deja cualquier baja, en vez de tocar
-- `anonymize_account`. Revocar en Google no se puede desde aquí; sin el token
-- guardado ya no hay forma de usarlo, y Google lo caduca solo si no se usa.
create or replace function public.olvidar_google_calendar_de_baja()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.google_calendar_connections where user_id = new.user_id;
  return new;
end;
$$;

comment on function public.olvidar_google_calendar_de_baja() is
  'Al insertarse una baja en account_deletions, borra la conexión de Google Calendar de esa persona. Hace falta porque la baja no borra profiles y el cascade no llega.';

revoke execute on function public.olvidar_google_calendar_de_baja() from public;
revoke execute on function public.olvidar_google_calendar_de_baja() from anon;
revoke execute on function public.olvidar_google_calendar_de_baja() from authenticated;

drop trigger if exists account_deletions_olvida_google_calendar on public.account_deletions;
create trigger account_deletions_olvida_google_calendar
  after insert on public.account_deletions
  for each row execute function public.olvidar_google_calendar_de_baja();
