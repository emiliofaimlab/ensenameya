-- Demo: reabre la ventana de acceso de la sesión de demo.
--
-- La ventana es [inicio - 10 min, fin + 10 min] (RN-18/S-45), así que una
-- sesión preparada hace un rato se cierra sola y "Ir a la sala" empieza a
-- rechazar. Esto la recoloca alrededor de AHORA: la clase arrancó hace 5 min y
-- dura 60 (los que anuncia el producto), o sea ventana abierta ~65 min más.
--
-- EJECÚTALO JUSTO ANTES DE PRESENTAR. Es reejecutable: usa now(), así que cada
-- pasada da una ventana nueva. Si se te pasa la hora, vuelve a correrlo.
--
-- No toca `status` a propósito:
--   · La sesión sigue 'in_progress' y la reserva 'in_progress' → `join_session`
--     las acepta (solo rechaza reservas muertas y sesiones ya cerradas).
--   · Mover la reserva a 'confirmed' para enseñar la transición del primer join
--     (US-802) dispararía `notifications_on_booking` y encolaría NTF-05/NTF-07.
--
-- Mantiene viva la reserva dc79691e ("Python desde cero"), que es la que tiene
-- el chat sembrado: misma fila del panel, "Chat" e "Ir a la sala" juntos.

update public.sessions
   set start_at = date_trunc('minute', now()) - interval '5 minutes',
       end_at   = date_trunc('minute', now()) + interval '55 minutes'
 where id = 'e91e3ce6-afa4-4323-ad92-02d8ed3779b7'
returning id, start_at, end_at, status;
