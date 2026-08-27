-- ============================================================================
-- US-1203 · Avisos in-app (EP-12, S-48/50)
--
-- La tabla `notifications` y sus triggers existen desde EP-12: cada transición
-- del negocio ya encola su NTF. Lo único que faltaba para enseñarlos dentro de
-- la app era saber cuáles ha visto el usuario.
--
-- No se crea tabla nueva ni un segundo canal: el aviso in-app es la MISMA fila
-- que dispara el correo (Doc 7). `read_at` es del destinatario, y por eso es lo
-- único que se le deja escribir de esa tabla.
-- ============================================================================

alter table public.notifications
  add column if not exists read_at timestamptz;

comment on column public.notifications.read_at is
  'Cuándo el destinatario marcó el aviso como leído (US-1203). Nulo = sin leer.';

-- El listado pide "las no leídas de este usuario", que es justo este índice.
create index if not exists notifications_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

-- ── Marcar como leído ───────────────────────────────────────────────────────
-- Por RLS + grant de UNA columna, no por RPC: no hay dinero ni roles de por
-- medio (mismo criterio que las categorías de US-1102). El grant por columna
-- impide que el cliente toque `status`, `payload` o `sent_at`, que son del
-- procesador de envíos.
create policy "notifications_update_own_read"
  on public.notifications for update
  using      ( (select auth.uid()) = recipient_id )
  with check ( (select auth.uid()) = recipient_id );

grant update (read_at) on public.notifications to authenticated;
