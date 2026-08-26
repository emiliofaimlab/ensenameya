-- ============================================================================
-- Enséñame Ya — EY-192 · B5.9: baja de cuenta con anonimización
--
-- QUÉ SE PEDÍA Y POR QUÉ NO SE PODÍA HACER LITERALMENTE. El cliente contestó
-- (V-10, Doc 22 §22.2) «borrar usuario y reservas, conservar reseñas anónimas».
-- Las dos mitades se contradicen: `reviews.booking_id` es `not null unique …
-- on delete cascade` (`20260716130000:18`), así que borrar la reserva borra la
-- reseña. No hay orden de borrado que salve las dos cosas.
--
-- Y la cadena completa, verificada clave a clave, es peor todavía:
--
--   auth.users ──cascade──► profiles ──cascade──► bookings ──cascade──►
--   payments ──RESTRICT──► payout_items
--   20260606121500:31       20260709140000:35/:37   :97   20260716140000:48
--
-- O sea: **borrar la cuenta de acceso no es una alternativa a borrar las
-- reservas — es la misma cosa.** Para un tutor con pagos ya liquidados revienta
-- por integridad (`restrict` se comprueba de inmediato, no al final de la
-- sentencia: no hay orden que lo esquive); para el resto se lleva en silencio
-- reservas, pagos, sesiones y reseñas.
--
-- ── EL DISEÑO APROBADO (ficha EY-192) ───────────────────────────────────────
-- «Borrar la identidad, conservar la contabilidad.»
--
--   · No se borra ninguna reserva, pago ni liquidación. El motivo es FISCAL, no
--     técnico: son registros contables y hay que conservarlos por su plazo. Ese
--     es el argumento que sostiene la decisión si alguien la cuestiona.
--   · Se borra la identidad: nombre, foto y datos de contacto.
--   · Las reseñas quedan SIN AUTOR — y sobreviven de verdad, precisamente
--     porque la reserva de la que cuelgan sobrevive.
--   · La cuenta se INUTILIZA, no se elimina: se desvincula de Google y se
--     bloquea el acceso.
--   · Un tutor NO puede darse de baja con saldo pendiente o clases futuras ya
--     vendidas.
--
-- ── LAS SEIS TRAMPAS, Y CÓMO SE RESUELVEN ───────────────────────────────────
--
-- 1 · HAY DOS AVATARES, NO UNO. `profiles.avatar_path` (privado) y
--     `tutor_profiles.avatar_path` (público) son INDEPENDIENTES desde
--     `20260724170000`. Vaciar solo el primero deja la foto pública del tutor
--     en su sitio, y el bucket `avatars` es de LECTURA PÚBLICA
--     (`20260722160000:64-67`): la cara seguiría siendo accesible por URL.
--
-- 2 · ANONIMIZAR ES BORRAR FICHEROS, NO SOLO FILAS. Cuatro de los cinco buckets
--     guardan bajo `<uid>/…` y se purgan aquí; el más sensible con diferencia
--     es `kyc-documents`, que son documentos de identidad. El quinto,
--     `chat-attachments`, NO se toca — ver trampa 5.
--
-- 3 · CERRAR LA PUERTA DE GOOGLE. Reescribir el correo NO basta: el
--     emparejamiento de OAuth va por `auth.identities` (provider + provider_id),
--     no por el correo. Sin borrar la identidad, «Continuar con Google» vuelve
--     a aterrizar en el mismo perfil vaciado. Además `identity_data` es un jsonb
--     que guarda correo, nombre y foto de Google: es PII por sí mismo.
--     ⚠️ Ver el bloque de comprobación de privilegios al final del fichero.
--
-- 4 · EL CORREO SE LIBERA A PROPÓSITO. `auth.users.email` se reescribe a
--     `cuenta-eliminada+<uid>@ensenameya.invalid` (TLD `.invalid`, RFC 2606: no
--     puede existir). Cumple las dos cosas a la vez: quita el dato personal y
--     DEJA LIBRE la dirección real, para que la persona pueda registrarse de
--     nuevo si quiere — con cuenta nueva, uid nuevo y sin acceso a lo viejo.
--     Es determinista a partir del uid, así que reejecutar no colisiona.
--
-- 5 · LOS MENSAJES Y SUS ADJUNTOS NO SON SOLO SUYOS. `messages` y el bucket
--     `chat-attachments` (que va por id de RESERVA, no por uid,
--     `20260722180000:42-44`) son el hilo COMPARTIDO con la otra persona.
--     Borrarlos le arrancaría su conversación a alguien que no se ha dado de
--     baja — y la política de Storage ya lo prohíbe explícitamente («Sin
--     DELETE: un adjunto ya enviado no se retira del hilo del otro»). Se dejan;
--     ya caducan solos por `purge_expired_messages` (30 días, decisión 22).
--
-- 6 · `home_testimonials` NO FILTRA ESTADO, y hay que arreglarlo en la misma
--     pasada. Es `security definer` (`20260729150000:112`), o sea que se salta
--     la RLS, y su `where` solo mira comentario y nota. Sin tocarlo, la portada
--     seguiría enseñando la mentoría de una cuenta anonimizada. ⚠️ Es un
--     agujero que existe HOY, sin anonimizar a nadie: hoy ya publica productos
--     en borrador y de tutores no aprobados.
--
-- ── POR QUÉ NO HAY COLUMNA `profiles.deleted_at` ────────────────────────────
-- Era lo primero que pedía el cuerpo, y es una trampa: `20260703120000:16` hace
-- `grant select, update on public.profiles to authenticated` — LA TABLA ENTERA.
-- Una columna nueva ahí nace escribible por el propio usuario vía PostgREST, y
-- `profiles_update_own` la deja pasar. Cualquiera podría marcarse como
-- «eliminado» sin que la anonimización ocurriese. Y un `revoke update (col)`
-- NO arregla eso: con el privilegio a nivel de TABLA presente, el revoke por
-- columna es un no-op. Habría que revocar el grant de tabla y reconstruirlo
-- columna a columna, que es exactamente el tipo de cambio que rompe la app en
-- silencio.
--
-- Por eso el rastro va en TABLA APARTE, `account_deletions`, default-deny y sin
-- un solo grant a `authenticated`. Sale gratis y encima es mejor rastro: guarda
-- cuándo, con qué roles y qué se borró.
-- ============================================================================

-- ── 1) El rastro ────────────────────────────────────────────────────────────
-- La fila de `profiles` sigue existiendo (anonimizada) para que la contabilidad
-- tenga a quién colgar las reservas; esta tabla es la que dice que la baja
-- ocurrió, cuándo y qué se llevó por delante.

create table if not exists public.account_deletions (
  user_id      uuid        primary key references public.profiles (id) on delete cascade,
  deleted_at   timestamptz not null default now(),
  roles        text[]      not null default '{}',   -- qué era la persona al darse de baja
  summary      jsonb       not null default '{}'::jsonb  -- recuento de lo purgado
);

comment on table public.account_deletions is
  'EY-192: rastro de las cuentas anonimizadas. La fila de `profiles` sobrevive vaciada para que reservas y pagos —conservados por plazo fiscal— sigan teniendo titular; esta tabla es la que registra que la baja ocurrió. NO lleva ningún dato personal a propósito: es el registro de que se borraron, no una copia de seguridad de ellos.';

comment on column public.account_deletions.roles is
  'Roles que tenía la cuenta en el momento de la baja. Se guardan porque `user_roles` se vacía: sin esto no habría forma de saber si la cuenta anonimizada era de un alumno o de un tutor.';

-- Regla de oro 1: default-deny. Nace con RLS y sin una sola política para
-- `anon`/`authenticated` — nadie ve nada salvo el admin.
alter table public.account_deletions enable row level security;

drop policy if exists "account_deletions_select_admin" on public.account_deletions;
create policy "account_deletions_select_admin"
  on public.account_deletions for select
  using ( public.has_role('admin') );

-- Regla de oro 9: `service_role` se salta la RLS pero NO los grants de tabla, y
-- este proyecto tiene "auto-expose new tables" OFF. Sin este grant, el panel de
-- admin come `permission denied` EN EJECUCIÓN. (La función de más abajo no lo
-- necesita —corre como su dueño, ver §3— pero el grant es barato y evita la
-- cuarta mordida del 6-ago.)
grant select on public.account_deletions to authenticated;
grant select on public.account_deletions to service_role;

-- ── 2) Por qué NO puedes darte de baja ──────────────────────────────────────
-- Se saca a su propia función por dos motivos: la pantalla la llama ANTES de
-- ofrecer el botón (para explicar el motivo en vez de soltar un error genérico
-- al final), y la anonimización la vuelve a llamar por dentro justo antes de
-- tocar nada. Una sola definición de «no puedes» → imposible que diverjan.
--
-- ⚠️ ASIMETRÍA DELIBERADA ENTRE TUTOR Y ALUMNO, y conviene dejarla escrita.
-- La ficha habla solo del tutor. Pero un ALUMNO con clases futuras ya pagadas
-- tampoco puede irse sin más: su dinero ya salió y el tutor tiene la agenda
-- bloqueada contra un fantasma. La diferencia está en la SALIDA, no en el
-- bloqueo:
--   · El alumno tiene salida propia: cancelar sus reservas futuras, que pasa
--     por `cancel_booking` y aplica RN-37 (≥24h 100%, <24h 50%). Después ya
--     puede darse de baja.
--   · El tutor NO puede cancelar unilateralmente: son clases vendidas a
--     terceros y saldo suyo pendiente. Tiene que esperar a impartirlas y a
--     cobrar.
-- Lo importante de hacerlo así: el reembolso sigue viajando por el camino
-- auditado de siempre. Si la baja cancelase y devolviese por su cuenta estaría
-- moviendo dinero por un camino nuevo y sin auditar, justo lo que prohíbe la
-- regla de oro 2.

create or replace function public.account_deletion_blockers(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  -- Clases futuras ya vendidas. Se mira `sessions` y no `bookings` porque la
  -- fecha vive ahí: `create_booking` mete una sesión por hueco del paquete.
  futuras_tutor as (
    select count(*) as n from public.sessions s
     where s.tutor_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  futuras_alumno as (
    select count(*) as n from public.sessions s
     where s.student_id = p_user_id
       and s.status in ('scheduled', 'in_progress')
       and s.start_at > now()
  ),
  -- Saldo pendiente. La definición de «liquidable» se copia LITERALMENTE de
  -- `tutor_balance` (`20260716150000`), que a su vez la comparte con
  -- `build_payout_for_tutor`: una sola fuente para los tres. Aquí se juntan
  -- `available` e `in_retention` porque para darse de baja da igual que la
  -- retención haya vencido o no — es dinero suyo que todavía no ha cobrado.
  sin_liquidar as (
    select coalesce(sum(p.tutor_net_amount), 0) as importe
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.tutor_id = p_user_id
       and p.status   = 'paid'
       and b.status   = 'completed'
       and not exists (
         select 1 from public.payout_items pi where pi.payment_id = p.id
       )
  ),
  -- Y el dinero ya en vuelo: un payout emitido que aún no ha aterrizado.
  payouts_vivos as (
    select count(*) as n from public.payouts po
     where po.tutor_id = p_user_id
       and po.status in ('pending', 'scheduled', 'processing', 'on_hold')
  ),
  -- Reembolso pendiente HACIA el alumno. No bloquea por el dinero —el abono va
  -- contra el pago de Stripe, no contra el perfil— sino porque irse mientras
  -- te deben algo deja a la persona sin a dónde reclamar.
  reembolsos_vivos as (
    select count(*) as n
      from public.refund_requests rr
      join public.bookings b on b.id = rr.booking_id
     where b.student_id = p_user_id
       and rr.status = 'pending'
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'clases_futuras_como_tutor',
      case when (select n from futuras_tutor)  > 0 then (select n from futuras_tutor)  end,
    'clases_futuras_como_alumno',
      case when (select n from futuras_alumno) > 0 then (select n from futuras_alumno) end,
    'saldo_sin_liquidar',
      case when (select importe from sin_liquidar) > 0 then (select importe from sin_liquidar) end,
    'payouts_en_curso',
      case when (select n from payouts_vivos)  > 0 then (select n from payouts_vivos)  end,
    'reembolsos_pendientes',
      case when (select n from reembolsos_vivos) > 0 then (select n from reembolsos_vivos) end
  ));
$$;

comment on function public.account_deletion_blockers(uuid) is
  'EY-192: motivos por los que una cuenta NO puede darse de baja, como jsonb. Objeto vacío = vía libre. La pantalla lo pinta antes de ofrecer el botón y `anonymize_account` lo vuelve a comprobar por dentro.';

revoke execute on function public.account_deletion_blockers(uuid) from public;
revoke execute on function public.account_deletion_blockers(uuid) from anon;
revoke execute on function public.account_deletion_blockers(uuid) from authenticated;
grant  execute on function public.account_deletion_blockers(uuid) to service_role;

-- ── 3) La anonimización ─────────────────────────────────────────────────────
-- Recibe el uid por parámetro y NO lee `auth.uid()`: la llama el Route Handler
-- con `service_role`, que no tiene sesión. Quién puede pedir la baja de quién
-- lo decide el handler, que sí tiene las cookies — y solo se deja a uno mismo.
--
-- Por qué el parámetro no es un agujero: la función está concedida ÚNICAMENTE a
-- `service_role`, que jamás llega al navegador (regla de oro 3). Desde el
-- cliente no se puede invocar ni con el uid de otro ni con el propio.
--
-- SECURITY DEFINER, además de para tocar `auth`, resuelve la regla de oro 9 de
-- raíz: el cuerpo corre con los privilegios del DUEÑO de la función, así que
-- las ~15 tablas que toca no necesitan grants nuevos para `service_role`.
--
-- TODO EN UNA TRANSACCIÓN, y es una propiedad que importa: la función corre
-- dentro de la transacción de quien la llama, así que o pasa entera o no pasa
-- nada. No existe el estado «datos borrados pero acceso abierto», que es el
-- único desenlace de verdad malo de una operación así.

create or replace function public.anonymize_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blockers   jsonb;
  v_roles      text[];
  v_ya         timestamptz;
  v_marcador   text := 'Usuario eliminado';
  v_correo     text := 'cuenta-eliminada+' || p_user_id::text || '@ensenameya.invalid';
  v_ficheros   int  := 0;
  v_resumen    jsonb;
begin
  if p_user_id is null then
    raise exception 'falta el usuario' using errcode = '22004';
  end if;

  -- IDEMPOTENCIA. Ejecutarla dos veces no debe romper nada: si ya hay rastro,
  -- se sale sin tocar. Importa de verdad — un reintento del cliente tras un
  -- timeout llega aquí con la cuenta ya vaciada, y sin esta guarda volvería a
  -- recorrer las quince tablas para no cambiar nada.
  select ad.deleted_at into v_ya
    from public.account_deletions ad where ad.user_id = p_user_id;
  if v_ya is not null then
    return jsonb_build_object('status', 'ya_anonimizada', 'deleted_at', v_ya);
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'la cuenta no existe' using errcode = 'P0002';
  end if;

  -- Segundo cerrojo sobre los bloqueos. El handler ya los consultó para pintar
  -- la pantalla, pero entre aquello y esto la persona pudo comprar una clase.
  v_blockers := public.account_deletion_blockers(p_user_id);
  if v_blockers <> '{}'::jsonb then
    raise exception 'la cuenta no puede darse de baja todavía: %', v_blockers
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(ur.role::text order by ur.role), '{}')
    into v_roles
    from public.user_roles ur where ur.user_id = p_user_id;

  -- ── 3.1) Storage: los ficheros, antes que las filas que los referencian ──
  -- ⚠️ Se borra la fila de `storage.objects`, que es el precedente que ya
  -- existe en el proyecto (la purga de chat, `20260729180000:36-38`). El filtro
  -- va por prefijo `<uid>/%` en vez de por `storage.foldername(name))[1]`
  -- —que es como lo expresan las políticas— porque son equivalentes para estos
  -- cuatro buckets y el prefijo sí puede usar el índice de `name`.
  --
  -- `chat-attachments` queda fuera a propósito: trampa 5 de la cabecera.
  --   · avatars         → las dos fotos (trampa 1) viven aquí
  --   · kyc-documents   → documentos de identidad: el dato más fuerte
  --   · tutor-materials → material de clase subido por el tutor
  --   · product-images  → portadas de mentoría; pueden ser su propia cara
  with borrados as (
    delete from storage.objects
     where bucket_id in ('avatars', 'kyc-documents', 'tutor-materials', 'product-images')
       and name like (p_user_id::text || '/%')
    returning 1
  )
  select count(*) into v_ficheros from borrados;

  -- ── 3.2) `profiles`: la lápida ──────────────────────────────────────────
  -- Se vacía, NO se borra: es lo que sostiene `bookings.student_id` y
  -- `bookings.tutor_id`, que son `not null`. El nombre se sustituye por un
  -- marcador legible en vez de dejarse a null para que el otro lado de una
  -- reserva vea «Usuario eliminado» y no un hueco en blanco que parece un bug.
  --
  -- `timezone` se queda: no identifica a nadie y las fechas de sus reservas
  -- pasadas se siguen renderizando (RN-01/RN-02).
  -- `stripe_customer_id` se va porque es un identificador personal en un
  -- tercero. No se pierde nada operativo: los reembolsos van por
  -- `payments.provider_payment_id`, no por el cliente de Stripe.
  update public.profiles
     set full_name          = v_marcador,
         phone              = null,
         primary_goal       = null,
         avatar_path        = null,
         referral_code      = null,
         stripe_customer_id = null,
         onboarding_complete = false
   where id = p_user_id;

  -- ── 3.3) `tutor_profiles`: la otra mitad de la identidad ────────────────
  -- El avatar de aquí es el PÚBLICO y es independiente del anterior desde
  -- `20260724170000` (trampa 1). `approval_status = 'suspended'` es lo que
  -- saca al tutor del catálogo: las consultas públicas filtran `= 'approved'`.
  update public.tutor_profiles
     set display_name    = v_marcador,
         avatar_path     = null,
         bio             = null,
         headline        = null,
         socials         = '{}'::jsonb,
         faqs            = '[]'::jsonb,
         search_text     = null,
         approval_notes  = null,
         approval_status = 'suspended'
   where profile_id = p_user_id;

  -- ── 3.4) Las reseñas se quedan, sin autor ───────────────────────────────
  -- Esto es lo que el cliente pidió y lo único que lo hace posible es que la
  -- reserva de la que cuelgan no se borre. `author_display` a null hace que
  -- `home_testimonials` caiga en su `coalesce(…, 'Alumno')`.
  update public.reviews
     set author_display = null
   where student_id = p_user_id;

  -- ── 3.5) Sus mentorías dejan de ofrecerse ───────────────────────────────
  -- `archived`, no borradas: `bookings.product_id` es `on delete restrict`
  -- (`20260709140000:36`) y las reservas se conservan.
  update public.products
     set status     = 'archived',
         image_path = null
   where tutor_id = p_user_id
     and status <> 'archived';

  -- ── 3.6) Filas puramente personales ─────────────────────────────────────
  -- Nada de esto tiene valor contable ni pertenece a otra persona.
  delete from public.verification_documents where tutor_id  = p_user_id;  -- KYC
  delete from public.tutor_materials        where tutor_id  = p_user_id;
  delete from public.payment_methods        where profile_id = p_user_id;
  delete from public.notifications          where recipient_id = p_user_id;
  delete from public.student_interests      where student_id = p_user_id;
  delete from public.tutor_categories       where tutor_id   = p_user_id;
  delete from public.contact_messages       where sender_id  = p_user_id;

  -- La agenda se vacía para que nadie pueda reservar contra una cuenta muerta.
  -- `product_availability_rules` cae sola: su FK a `availability_rules` es
  -- `on delete cascade` (`20260817200000:77`).
  delete from public.availability_exceptions where tutor_id = p_user_id;
  delete from public.availability_rules      where tutor_id = p_user_id;

  -- Los roles se van: la cuenta está muerta y dejar un 'admin' colgando de ella
  -- es superficie de escalada gratis. Por eso se guardan antes en el rastro.
  delete from public.user_roles where user_id = p_user_id;

  -- ⚠️ `messages`, `conversations` y sus adjuntos NO se tocan: trampa 5.
  -- ⚠️ `terms_acceptances` tampoco. Es la prueba de que aceptó los términos
  --    vigentes al comprar, no un dato de contacto: solo guarda uid, versión e
  --    idioma. Borrarla dejaría las reservas conservadas sin su consentimiento.

  -- ── 3.7) Cerrar la puerta ───────────────────────────────────────────────
  -- ⚠️ ESTE ES EL BLOQUE QUE PUEDE FALLAR POR PRIVILEGIOS EN EJECUCIÓN. Ver la
  -- comprobación del final del fichero.
  --
  -- Orden: primero las identidades (que es lo que reconoce Google), después la
  -- fila de usuario, y al final las sesiones vivas.
  --
  -- Borrar `auth.identities` hace DOS cosas, y las dos hacen falta:
  --   a) quita el emparejamiento provider+provider_id, así que «Continuar con
  --      Google» ya no encuentra esta cuenta. Como además el correo queda
  --      liberado (trampa 4), GoTrue crea un usuario NUEVO: exactamente lo que
  --      se quiere, cuenta limpia y sin acceso a lo anterior.
  --   b) borra `identity_data`, un jsonb con el correo, el nombre y la foto de
  --      Google. Sin esto la PII seguiría ahí aunque el acceso estuviera roto.
  delete from auth.identities where user_id = p_user_id;

  -- La fila se conserva —borrarla cascadearía toda la contabilidad— pero se
  -- inutiliza. `banned_until` es lo que mira GoTrue al emitir sesión; se usa
  -- un siglo en vez de 'infinity' porque el `infinity` de Postgres no siempre
  -- sobrevive al parseo de tiempos de GoTrue.
  -- Los campos de token se ponen a '' y no a null: en unas versiones de GoTrue
  -- son `not null default ''` y en otras nulables, y '' vale en las dos.
  update auth.users
     set email                        = v_correo,
         phone                        = null,
         encrypted_password           = null,
         raw_user_meta_data           = '{}'::jsonb,   -- guardaba full_name
         raw_app_meta_data            = '{}'::jsonb,   -- guardaba providers[]
         banned_until                 = now() + interval '100 years',
         email_change                 = '',
         phone_change                 = '',
         confirmation_token           = '',
         recovery_token               = '',
         email_change_token_new       = '',
         email_change_token_current   = '',
         reauthentication_token       = ''
   where id = p_user_id;

  -- Y se le echa AHORA. Sin esto, el JWT que ya tiene en el navegador sigue
  -- siendo válido hasta que caduque (~1 h): estaría baneado y navegando.
  -- ⚠️ `auth.refresh_tokens.user_id` es `varchar`, no `uuid` — de ahí el cast.
  delete from auth.sessions       where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.mfa_factors    where user_id = p_user_id;

  -- ── 3.8) El rastro ──────────────────────────────────────────────────────
  v_resumen := jsonb_build_object('ficheros_borrados', v_ficheros);

  insert into public.account_deletions (user_id, roles, summary)
  values (p_user_id, coalesce(v_roles, '{}'), v_resumen)
  on conflict (user_id) do nothing;   -- cinturón: dos llamadas a la vez

  return jsonb_build_object(
    'status',            'ok',
    'ficheros_borrados', v_ficheros,
    'roles',             to_jsonb(coalesce(v_roles, '{}'::text[]))
  );
end;
$$;

comment on function public.anonymize_account(uuid) is
  'EY-192: borra la identidad y conserva la contabilidad. Vacía perfil y perfil de tutor, purga los ficheros de los cuatro buckets con carpeta por uid (incluido KYC), deja las reseñas sin autor, archiva las mentorías y INUTILIZA la cuenta de acceso (borra `auth.identities` para cerrar Google, banea y mata las sesiones). NO toca bookings/payments/payouts/sessions: se conservan por plazo fiscal. Idempotente. Solo `service_role`.';

revoke execute on function public.anonymize_account(uuid) from public;
revoke execute on function public.anonymize_account(uuid) from anon;
revoke execute on function public.anonymize_account(uuid) from authenticated;
grant  execute on function public.anonymize_account(uuid) to service_role;

-- ── 4) Tapar `home_testimonials` (trampa 6) ─────────────────────────────────
-- Bug PREEXISTENTE, no consecuencia de esta ficha: la función es
-- `security definer` —se salta la RLS— y su `where` solo miraba comentario y
-- nota. Hoy ya publica en portada mentorías en borrador o de tutores sin
-- aprobar; con la anonimización pasaría a publicar además las de cuentas
-- muertas. Se le añaden las dos condiciones que le faltaban.
--
-- La reseña de un alumno anonimizado NO se excluye, y es deliberado: su
-- `author_display` quedó a null en §3.4, así que sale firmada como «Alumno».
-- Eso es literalmente lo que pidió el cliente — reseñas anónimas.
create or replace function public.home_testimonials(p_limit integer default 7)
returns table (
  id      uuid,
  comment text,
  rating  smallint,
  author  text,
  context text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.comment,
         r.rating,
         coalesce(r.author_display, 'Alumno') as author,
         pr.title as context
    from public.reviews r
    join public.products      pr on pr.id         = r.product_id
    join public.tutor_profiles tp on tp.profile_id = pr.tutor_id
   where r.comment is not null
     and length(btrim(r.comment)) > 0
     and r.rating >= 4                    -- testimonios, no reseñas a secas
     and pr.status = 'active'             -- ni borradores, ni pausadas, ni archivadas
     and tp.approval_status = 'approved'  -- ni sin aprobar, ni suspendidas, ni anonimizadas
   order by r.created_at desc
   limit greatest(1, least(p_limit, 20));
$$;

grant execute on function public.home_testimonials(integer) to anon, authenticated;

-- ── 5) ⚠️ ¿Puede el dueño de la función tocar el esquema `auth`? ────────────
-- Es el único punto de todo el fichero que no se puede dar por sentado. El
-- proyecto ya LEE `auth.users` desde `security definer`
-- (`20260806150000:69-90`) y ya cuelga un trigger de la tabla
-- (`20260606121500:107-131`), pero ESCRIBIR y BORRAR ahí es otro privilegio, y
-- este es el primer sitio del repo que lo necesita.
--
-- Si falta, `anonymize_account` no falla al aplicar la migración ni al hacer
-- typecheck: falla EN EJECUCIÓN, con `permission denied for table users`.
--
-- 🟢 LA BUENA NOTICIA: NO deja la cuenta a medio anonimizar. La función corre
-- dentro de la transacción de quien la llama, así que si el bloque 3.7 revienta
-- se deshace TODO lo anterior —los ficheros de Storage incluidos— y la cuenta
-- se queda exactamente como estaba. El fallo es total y visible, que en una
-- operación irreversible es justo lo que se quiere: la alternativa mala sería
-- una cuenta con los datos borrados y la puerta abierta.
--
-- ⚠️ Con un matiz: se deshace la FILA de `storage.objects`, no necesariamente
-- el fichero físico. Ver la nota de Storage en el informe de la ficha.
--
-- Se comprueba aquí para que salte en el log del despliegue en vez de
-- descubrirlo con una persona real intentando darse de baja. Es WARNING y no
-- EXCEPTION a propósito: el resto de la migración (el rastro, los bloqueos, el
-- arreglo de `home_testimonials`) es válido igualmente, y abortar el despliegue
-- entero por esto sería peor.
--
-- SI SALTA: o se le conceden los privilegios al dueño de la función, o el
-- bloque 3.7 se saca a la Admin API de Auth desde el Route Handler. ⚠️ Ojo con
-- lo segundo: la Admin API sabe banear y reescribir el correo, pero NO tiene
-- una operación limpia de «borra las identidades de proveedor de este usuario»,
-- que es justo la que cierra la puerta de Google. Si se va por ahí, hay que
-- resolver esa parte antes de darla por buena.
do $$
declare
  v_falta text[] := '{}';
begin
  if not has_table_privilege('auth.users', 'UPDATE')      then v_falta := v_falta || 'UPDATE auth.users';      end if;
  if not has_table_privilege('auth.identities', 'DELETE') then v_falta := v_falta || 'DELETE auth.identities'; end if;
  if not has_table_privilege('auth.sessions', 'DELETE')   then v_falta := v_falta || 'DELETE auth.sessions';   end if;

  if array_length(v_falta, 1) > 0 then
    raise warning
      'EY-192: al dueño de `anonymize_account` le faltan privilegios sobre `auth`: %. La baja de cuenta fallará ENTERA (no a medias) hasta que se concedan o se mueva ese bloque a la Admin API de Auth.',
      array_to_string(v_falta, ', ');
  end if;
end;
$$;
