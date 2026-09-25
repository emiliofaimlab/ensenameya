-- `20260925180000` dio el grant por columnas pero no quitó los privilegios por
-- defecto con los que nace una tabla en `public` en este proyecto: `anon` y
-- `authenticated` salieron con REFERENCES, TRIGGER y TRUNCATE. Mismo `revoke`
-- que `calendar_feed_tokens` (`20260826210000`), y se repone lo único que
-- `authenticated` debe tener: leer si está conectado, nunca el token.
revoke all on public.google_calendar_connections from anon, authenticated;
grant select (user_id, google_email, created_at)
  on public.google_calendar_connections to authenticated;
