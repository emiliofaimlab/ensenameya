-- ============================================================================
-- "Marcar atendida" en AD14 (decisión 29 del cliente, 24-jul · EP-23)
--
-- AD14 no tiene datos propios: cada alerta se DERIVA de un pago fallido, un
-- payout en problema o una cancelación. Por eso no se podía marcar nada como
-- atendido — no había fila donde escribirlo.
--
-- El cliente pidió "tabla de incidencias". Lo que hace falta de verdad es
-- registrar **la atención**, no copiar la incidencia: duplicar título, importe
-- y severidad en una tabla nueva crea dos versiones del mismo hecho que se
-- desincronizan en cuanto el pago se reintenta. Así que se guarda el acuse,
-- referido a la entidad que ya existe.
--
-- Sin RPC: no se mueve dinero ni roles, así que basta RLS + grants (mismo
-- criterio que las categorías de US-1102).
-- ============================================================================

create table if not exists public.alert_acks (
  kind       text        not null check (kind in ('pago', 'payout', 'cancelacion')),
  entity_id  uuid        not null,   -- payment.id | payout.id | booking.id
  acked_by   uuid        not null references public.profiles (id) on delete cascade,
  acked_at   timestamptz not null default now(),
  note       text        check (note is null or length(note) <= 500),
  primary key (kind, entity_id)      -- una alerta se atiende una vez
);

comment on table public.alert_acks is
  'Acuse de "atendida" sobre una alerta derivada de AD14. No guarda la alerta: apunta a la entidad de la que sale.';

alter table public.alert_acks enable row level security;

-- Solo el admin: AD14 es panel interno y estas filas no le importan a nadie más.
create policy "alert_acks_select_admin"
  on public.alert_acks for select
  using ( public.has_role('admin') );

create policy "alert_acks_insert_admin"
  on public.alert_acks for insert
  with check ( public.has_role('admin') and acked_by = (select auth.uid()) );

-- Desmarcar: si se atendió por error, se quita. No hay update — un acuse no se
-- edita, se retira y se vuelve a poner.
create policy "alert_acks_delete_admin"
  on public.alert_acks for delete
  using ( public.has_role('admin') );

grant select, insert, delete on public.alert_acks to authenticated;
