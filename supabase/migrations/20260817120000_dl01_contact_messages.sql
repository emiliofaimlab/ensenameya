-- ============================================================================
-- Enséñame Ya — DL-01: el buzón del formulario de contacto público
--
-- dLocal Go no valida la cuenta sin un formulario de contacto que funcione de
-- verdad: lo prueban a mano, mandan un mensaje y esperan respuesta. Hasta hoy
-- el sitio no tenía ni ruta de contacto ni ningún canal fuera del §11 de los
-- términos, donde el correo estaba como texto plano sin enlazar.
--
-- POR QUÉ UNA TABLA Y NO SOLO UN `sendEmail`. La credencial es el interruptor
-- (ver `lib/email.ts`): sin `RESEND_API_KEY` no sale nada y `sendEmail`
-- devuelve `retriable`. Si el formulario solo mandara correo, cada mensaje
-- enviado antes de configurar Resend se perdería en silencio — y el primero
-- que lo pruebe va a ser el revisor de dLocal. Con la tabla, el mensaje queda
-- guardado pase lo que pase y `delivery` dice si además llegó al buzón.
--
-- QUIÉN ESCRIBE. Solo el Route Handler `POST /api/contacto`, con service_role.
-- El formulario es público —hay que poder escribir sin cuenta, que es el caso
-- normal— y por eso NO se le da ninguna política de insert a `anon`: una tabla
-- con insert abierto desde el navegador es un formulario de spam con pasos
-- extra. La validación, el límite por IP y el honeypot viven en el handler.
--
-- ⚠️ REGLA DE ORO 9. `service_role` se salta la RLS pero NO los grants de
-- tabla, y este proyecto tiene "auto-expose new tables" en OFF. Sin el
-- `grant ... to service_role` de abajo el handler come `permission denied` en
-- TIEMPO DE EJECUCIÓN — no en el build, no en el typecheck. Ya mordió tres
-- veces el 6-ago (`sessions`, `payments`/`profiles`, `payment_routing_rules`).
--
-- Doc 3 §permisos · docs/19-PLAN-DE-EJECUCION.md §19.4 (DL-01)
-- ============================================================================

-- Si el correo salió o no. Mismos tres estados que `notifications` (y por la
-- misma razón): 'pending' es "todavía no", no "falló" — el día que se ponga la
-- clave de Resend se puede reintentar lo acumulado.
create type public.contact_delivery_status as enum ('pending', 'sent', 'failed');

create table public.contact_messages (
  id             uuid        primary key default gen_random_uuid(),

  -- Los tres campos que dLocal exige (nombre, correo, mensaje). Los topes son
  -- los mismos que valida el handler: la comprobación se repite aquí a
  -- propósito, porque es la que no se puede saltar tocando el cliente.
  name           text        not null check (char_length(trim(name))    between 1 and 120),
  email          text        not null check (char_length(trim(email))   between 3 and 254),
  message        text        not null check (char_length(trim(message)) between 10 and 5000),

  -- Si tenía sesión al escribir. `set null` y no `cascade`: si esa persona
  -- borra su cuenta, el mensaje sigue siendo parte del historial de soporte y
  -- puede haber una disputa abierta detrás (§18 del contrato).
  sender_id      uuid        references public.profiles (id) on delete set null,

  -- Trazabilidad y antispam. La IP es dato personal: se guarda porque es la
  -- única forma de limitar por origen sin cuenta, y la purga de abajo la borra
  -- con el resto del mensaje.
  ip             inet,
  user_agent     text,

  -- ¿Llegó al buzón oficial?
  delivery       public.contact_delivery_status not null default 'pending',
  delivery_error text,
  delivered_at   timestamptz,

  -- Cuándo lo atendió alguien. Null = sin responder.
  handled_at     timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- La bandeja se lee por fecha descendente, y el límite por IP consulta los
-- últimos minutos de una IP concreta.
create index contact_messages_created_idx on public.contact_messages (created_at desc);
create index contact_messages_ip_recent_idx on public.contact_messages (ip, created_at desc);

create trigger contact_messages_set_updated_at
  before update on public.contact_messages
  for each row execute function public.set_updated_at();

-- ── RLS: default-deny. Solo admin lee; nadie escribe desde el cliente ────────
alter table public.contact_messages enable row level security;

create policy "contact_messages_select_admin"
  on public.contact_messages for select
  using ( public.has_role('admin') );

-- Sin política de insert/update/delete a propósito: el único camino de
-- escritura es el Route Handler con service_role, que se salta la RLS.

-- ── Grants (auto-expose OFF) ────────────────────────────────────────────────
-- `authenticated` para que el admin pueda leer la bandeja desde el panel; la
-- política de arriba es la que acota a quién.
grant select on public.contact_messages to authenticated;

-- ⚠️ El grant que importa (regla de oro 9). `insert` para recibir el mensaje y
-- `update` para anotar si el correo salió; `select` para el límite por IP.
-- Mínimo privilegio: nada de `all`, y ningún `delete` — los mensajes los borra
-- la purga de abajo, que corre como `postgres`.
grant select, insert, update on public.contact_messages to service_role;

-- ── Retención ───────────────────────────────────────────────────────────────
-- Los mensajes atendidos guardan nombre, correo e IP de alguien que quizá no
-- tenga cuenta. Se quedan un año —plazo razonable para una disputa (§18) y
-- para la contabilidad— y se van solos. Mismo criterio que la purga del chat.
create or replace function public.purge_contact_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare borrados integer;
begin
  delete from public.contact_messages
   where created_at < now() - interval '1 year';
  get diagnostics borrados = row_count;
  return borrados;
end;
$$;

-- `execute` sobre una función es PUBLIC por defecto en Postgres, así que hay
-- que revocarlo explícitamente o cualquier autenticado podría llamarla (el
-- mismo agujero que cerró 20260715150000 con `expire_stale_bookings`).
revoke execute on function public.purge_contact_messages() from public;

select cron.schedule(
  'purge-contact-messages',
  '30 4 * * *',
  $$select public.purge_contact_messages();$$
);
