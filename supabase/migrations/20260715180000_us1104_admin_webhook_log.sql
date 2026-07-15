-- ============================================================================
-- Enséñame Ya — US-1104 (SCR-AD08): el admin lee el log de webhooks.
--
-- Casi toda esta historia es frontend: `bookings_select_admin`,
-- `payments_select_admin` y `sessions_select_admin` ya existen desde EP-06
-- Fase 1, así que las listas y detalles se leen por RLS sin tocar la BD.
--
-- La excepción es `payment_webhook_events`, que nació sin políticas ni grants
-- ("solo las RPC SECURITY DEFINER la tocan", US-703). Para supervisar pagos
-- hace falta verla: un pago atascado en `pending` SIN evento registrado
-- significa que el webhook del proveedor nunca llegó — que es exactamente la
-- primera pregunta de soporte cuando un alumno dice que pagó.
--
-- Solo lectura y solo admin. La escritura sigue siendo de las RPC (dedup de
-- US-703): que el admin mire el log no le deja fabricar eventos.
-- ============================================================================

alter table public.payment_webhook_events enable row level security;

create policy "payment_webhook_events_select_admin"
  on public.payment_webhook_events for select
  using ( public.has_role('admin') );

grant select on public.payment_webhook_events to authenticated;
