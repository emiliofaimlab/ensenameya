-- ============================================================================
-- P07 · el perfil público del tutor enseña su calendario. Refs: EY-110, US-601.
--
-- `get_available_slots` (US-601) solo tenía grant para `authenticated`, porque
-- hasta ahora únicamente la usaba el flujo de reserva, que va tras `requireUser`.
-- El Figma de P07 pinta el calendario y los horarios **en la ficha pública**,
-- antes de iniciar sesión: es el gancho de la pantalla.
--
-- Abrirla a `anon` no expone nada nuevo del modelo: la función es SECURITY
-- DEFINER y ya se limita a productos `active` de tutores `approved` (RN-24), y
-- devuelve huecos LIBRES — nunca quién reservó ni qué. Lo que sí se publica es
-- la agenda del tutor (qué días tiene libres), que es exactamente lo que el
-- diseño quiere mostrar y lo que hace cualquier marketplace de este tipo.
--
-- Reservar sigue exigiendo sesión: el botón lleva a `/reservar/[productId]`,
-- que está detrás de `requireUser`.
-- ============================================================================

grant execute on function public.get_available_slots(uuid, date, date) to anon;
