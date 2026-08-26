-- ============================================================================
-- Enséñame Ya — EY-192 · corrección: los ficheros se borran por la Storage API
--
-- ⚠️ LEE ESTO ANTES DE VOLVER A METER UN `delete from storage.objects` AQUÍ.
--
-- `20260826230000` dejó la baja de cuenta funcionalmente completa salvo por un
-- detalle que no se ve ni al aplicar la migración ni en el typecheck: Supabase
-- PROHÍBE borrar directamente de las tablas de Storage. La baja de verdad,
-- ejecutada contra dev, devolvió 500 con esto:
--
--   ERROR 42501: Direct deletion from storage tables is not allowed.
--                Use the Storage API instead.
--   HINT:        This prevents accidental data loss from orphaned objects.
--
-- No es un problema de privilegios ni de RLS que se arregle con un `grant`: es
-- una guarda explícita de Storage sobre la ESCRITURA, puesta justamente para
-- que la fila y el fichero físico no se separen. Borrar la fila de
-- `storage.objects` no borra el objeto del bucket: lo deja huérfano, ocupando
-- sitio y —en `avatars`, que es de lectura pública— servible por URL. O sea que
-- la guarda tiene razón, y el diseño anterior estaba mal aunque hubiera pasado.
--
-- ⚠️ LEER SÍ SE PUEDE. La guarda es del camino de escritura; el `select` de
-- §3.1 es legal y es justo lo que se necesita.
--
-- ── EL ARREGLO, Y POR QUÉ EL ORDEN NO ES NEGOCIABLE ─────────────────────────
-- El borrado de ficheros se va al Route Handler (`POST /api/cuenta/eliminar`),
-- que corre con `service_role` y sí puede llamar a la Storage API. Pero no vale
-- con moverlo: hay una trampa de orden.
--
-- ⚠️ SI ANONIMIZAS PRIMERO, PIERDES LAS RUTAS. `profiles.avatar_path`,
-- `tutor_profiles.avatar_path` e `products.image_path` se vacían en la
-- anonimización. Un handler que llamase a `anonymize_account` y DESPUÉS mirase
-- esas columnas no encontraría nada que borrar, y fallaría en silencio.
--
-- Por eso la secuencia es:
--   1 · `anonymize_account` RECOLECTA las rutas de los cuatro buckets (§3.1) y
--       las DEVUELVE agrupadas por bucket, en vez de borrarlas.
--   2 · El resto sigue exactamente igual y, sobre todo, SIGUE SIENDO ATÓMICO.
--       Esa propiedad se conserva a propósito: el fallo del 500 deshizo la baja
--       entera y la cuenta quedó intacta. Es el desenlace bueno de los dos
--       posibles; el malo sería «datos borrados y puerta abierta».
--   3 · Ya con la transacción confirmada, el handler barre los ficheros con
--       `storage.from(<bucket>).remove([...])`.
--
-- ── QUÉ PASA SI EL BARRIDO FALLA (decisión, no descuido) ────────────────────
-- NO se devuelve 500 y NO se deshace nada. Los dos fallos no son comparables:
--
--   · La identidad ya está borrada de la base y la cuenta de acceso ya está
--     cerrada. Eso es lo que la persona pidió y lo que hay que cumplir.
--   · Un fichero huérfano en un bucket es un problema menor, y sobre todo
--     RECUPERABLE: se puede barrer después. Deshacer la baja para volver a
--     intentarla no lo es — implicaría resucitar la cuenta, y encima el segundo
--     intento fallaría igual si Storage sigue caído.
--
-- Devolver 500 le diría a la persona «no se pudo eliminar tu cuenta» cuando SÍ
-- se eliminó: la empujaría a reintentar, o a escribir a soporte por algo que ya
-- está hecho. Sería mentir sobre lo único que le importa.
--
-- A cambio, el fallo NO puede quedarse callado, y tiene dos redes:
--   a) `console.error` en el handler con las rutas CONCRETAS, para barrerlas a
--      mano desde el panel de Storage. Esta es la vía principal.
--   b) las rutas pendientes se quedan en `account_deletions.summary`, que el
--      admin sí puede leer (la política de SELECT de la tabla). Es la red por
--      si el log ya rotó.
--
-- ⚠️ Y OJO CON UNA COSA: LA PERSONA NO PUEDE REINTENTAR EL POST MÁS TARDE. En
-- cuanto la anonimización cuaja, §3.7 borra su sesión y la banea, así que el
-- siguiente `POST /api/cuenta/eliminar` se queda en el 401 del handler y NUNCA
-- llega hasta aquí. La rama de `ya_anonimizada` de abajo cubre lo que SÍ pasa:
-- peticiones ya en vuelo (doble clic, reintento del cliente por timeout con el
-- JWT todavía aceptado). Para un barrido posterior no hay hoy ruta automática:
-- es manual, con las rutas del log o de `summary`.
--
-- ── POR QUÉ LAS RUTAS VIVEN EN `summary` Y NO EN UNA COLUMNA NUEVA ──────────
-- Porque `summary` ya es `jsonb` y ya está en `database.types.ts`: cabe sin
-- regenerar tipos. Una columna nueva obligaría a un `db:types` para que el
-- handler pudiera escribirla, y esta corrección no debería arrastrar eso.
-- ============================================================================

-- ── 1) El rastro pasa a ser escribible por el handler (solo `summary`) ──────
-- Regla de oro 9: `service_role` se salta la RLS pero NO los grants de tabla, y
-- este proyecto tiene "auto-expose new tables" OFF. El handler necesita anotar
-- el resultado del barrido, así que hace falta UPDATE — y sin él comería
-- `permission denied` en ejecución, que es exactamente la mordida del 6-ago.
--
-- ⚠️ Va POR COLUMNA a propósito: `deleted_at` y `roles` son el rastro, y el
-- rastro no se reescribe. Aquí el grant por columna sí funciona (a diferencia
-- del caso que describe la cabecera de `20260826230000` sobre `profiles`)
-- porque NO existe un grant de UPDATE a nivel de tabla que lo convierta en
-- no-op: `account_deletions` nació sin ninguno.
grant update (summary) on public.account_deletions to service_role;

-- El comentario de la tabla decía «NO lleva ningún dato personal a propósito».
-- Sigue siendo verdad en lo importante, pero ahora hay un matiz que hay que
-- dejar escrito: mientras el barrido esté pendiente, `summary` guarda RUTAS de
-- fichero, y las de `tutor-materials` incluyen el nombre original del archivo
-- que subió el tutor. Es temporal por diseño —el handler las borra de ahí en
-- cuanto el fichero se va— pero no es «ningún dato personal».
comment on table public.account_deletions is
  'EY-192: rastro de las cuentas anonimizadas. La fila de `profiles` sobrevive vaciada para que reservas y pagos —conservados por plazo fiscal— sigan teniendo titular; esta tabla es la que registra que la baja ocurrió. No guarda nombre, correo ni teléfono: es el registro de que se borraron, no una copia de ellos. ⚠️ `summary.ficheros` es la excepción y es TRANSITORIA: son las rutas de Storage que el Route Handler todavía no ha podido barrer, y se vacían en cuanto lo consigue.';

comment on column public.account_deletions.summary is
  'EY-192: `{ficheros: {<bucket>: [rutas]}, ficheros_recolectados: int, ficheros_barridos: int}`. `ficheros` es lo que QUEDA por borrar de Storage —lo escribe `anonymize_account` y lo va vaciando el Route Handler, porque el SQL no puede borrar de `storage.objects` (error 42501)—; `{}` significa que no quedó nada huérfano.';

-- ── 2) La función, con §3.1 recolectando en vez de borrando ─────────────────
-- `create or replace` porque `20260826230000` YA ESTÁ APLICADA en dev: esto va
-- encima, no la edita. Lo único que cambia respecto a aquella versión son §3.1
-- (recolectar), §3.8 (guardar las rutas) y la rama de idempotencia (devolver
-- las que queden). Todo lo demás es idéntico, incluida la atomicidad.

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
  -- ⚠️ `v_ficheros` YA NO es un contador: es el mapa `{bucket: [rutas]}` que la
  -- función recolecta y devuelve para que lo barra el Route Handler.
  v_ficheros   jsonb := '{}'::jsonb;
  v_n_ficheros int   := 0;
  v_resumen    jsonb;
begin
  if p_user_id is null then
    raise exception 'falta el usuario' using errcode = '22004';
  end if;

  -- IDEMPOTENCIA. Ejecutarla dos veces no debe romper nada: si ya hay rastro,
  -- se sale sin tocar. Importa de verdad — un reintento del cliente tras un
  -- timeout llega aquí con la cuenta ya vaciada, y sin esta guarda volvería a
  -- recorrer las quince tablas para no cambiar nada.
  --
  -- ⚠️ Y AHORA IMPORTA EL DOBLE. Desde que el barrido de ficheros vive fuera de
  -- la transacción (ver cabecera), «ya anonimizada» ya no significa «no queda
  -- nada por hacer»: puede quedar el barrido a medias de un intento anterior.
  -- Por eso esta rama devuelve las rutas PENDIENTES guardadas en el rastro, con
  -- la misma forma que la rama `ok`, y quien llame las barre sin distinguir de
  -- qué rama vienen. En la práctica esto cubre las peticiones ya en vuelo (el
  -- doble clic, el reintento por timeout); un reintento posterior no llega
  -- —la sesión ya está muerta, ver la cabecera—, pero devolverlas igualmente
  -- es lo que hace que un futuro barrido de admin no tenga que reinventarlas.
  select ad.deleted_at, ad.summary into v_ya, v_resumen
    from public.account_deletions ad where ad.user_id = p_user_id;
  if v_ya is not null then
    return jsonb_build_object(
      'status',                'ya_anonimizada',
      'deleted_at',            v_ya,
      'ficheros',              coalesce(v_resumen -> 'ficheros', '{}'::jsonb),
      'ficheros_recolectados', coalesce((v_resumen ->> 'ficheros_recolectados')::int, 0)
    );
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

  -- ── 3.1) Storage: RECOLECTAR las rutas, NO borrarlas ────────────────────
  -- ⚠️ ESTE BLOQUE SOLÍA BORRAR Y POR ESO LA BAJA DEVOLVÍA 500. Es SELECT a
  -- propósito: ver la cabecera (error 42501). No lo devuelvas a `delete`.
  --
  -- ⚠️ Y LA FUENTE ES `storage.objects`, NO LAS COLUMNAS QUE APUNTAN A ELLOS.
  -- Es tentador sacar las rutas de `profiles.avatar_path`,
  -- `tutor_profiles.avatar_path`, `products.image_path`,
  -- `verification_documents.storage_path` y `tutor_materials.storage_path`,
  -- que es lo primero que se le ocurre a cualquiera. No vale, por dos motivos:
  --   · Se van TODAS dentro de esta misma transacción: las tres primeras se
  --     vacían (§3.2, §3.3, §3.5) y las dos últimas se borran con su fila
  --     (§3.6). Después de anonimizar no queda de dónde leerlas.
  --   · Aunque se leyeran antes, solo listan lo que la app registró. Una subida
  --     que dejó el fichero y falló al guardar la fila NO aparece ahí, y es
  --     justo el huérfano que hay que barrer. El bucket es la lista completa.
  --
  -- El filtro va por prefijo `<uid>/%` en vez de por
  -- `storage.foldername(name))[1]` —que es como lo expresan las políticas—
  -- porque son equivalentes para estos cuatro buckets y el prefijo sí puede
  -- usar el índice de `name`.
  --
  -- `chat-attachments` queda fuera a propósito: trampa 5 de la cabecera.
  --   · avatars         → las dos fotos (trampa 1) viven aquí
  --   · kyc-documents   → documentos de identidad: el dato más fuerte
  --   · tutor-materials → material de clase subido por el tutor
  --   · product-images  → portadas de mentoría; pueden ser su propia cara
  --
  -- Se agrupa POR BUCKET porque la Storage API es por bucket: el handler hace
  -- un `storage.from(<bucket>).remove([...])` por clave, sin tener que partir
  -- cadenas ni adivinar dónde acaba el nombre del bucket.
  select coalesce(jsonb_object_agg(g.bucket_id, g.rutas), '{}'::jsonb),
         coalesce(sum(jsonb_array_length(g.rutas)), 0)
    into v_ficheros, v_n_ficheros
    from (
      select so.bucket_id,
             jsonb_agg(so.name order by so.name) as rutas
        from storage.objects so
       where so.bucket_id in ('avatars', 'kyc-documents', 'tutor-materials', 'product-images')
         and so.name like (p_user_id::text || '/%')
       group by so.bucket_id
    ) g;

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
  -- ⚠️ AQUÍ SE GUARDAN LAS RUTAS, y no es decorativo: es lo único que hace
  -- recuperable un barrido fallido. Si el handler revienta entre el `commit` y
  -- el `remove()` —se cae el proceso, se agota el tiempo de la función— no
  -- queda NADA de donde reconstruirlas: `profiles.avatar_path` y las demás se
  -- vaciaron hace cuatro bloques, y el log del handler nunca llegó a
  -- escribirse. Sin esta línea, esos ficheros serían huérfanos invisibles.
  --
  -- `ficheros`              → lo que QUEDA por barrer. El handler lo reescribe
  --                           con el resto tras cada pasada; `{}` = terminado.
  -- `ficheros_recolectados` → cuántos había al darse de baja. NO se toca nunca:
  --                           es el número de auditoría.
  v_resumen := jsonb_build_object(
    'ficheros',              v_ficheros,
    'ficheros_recolectados', v_n_ficheros
  );

  insert into public.account_deletions (user_id, roles, summary)
  values (p_user_id, coalesce(v_roles, '{}'), v_resumen)
  on conflict (user_id) do nothing;   -- cinturón: dos llamadas a la vez

  -- Misma forma que la rama de idempotencia en `ficheros` /
  -- `ficheros_recolectados`: el handler barre igual venga de donde venga.
  return jsonb_build_object(
    'status',                'ok',
    'ficheros',              v_ficheros,
    'ficheros_recolectados', v_n_ficheros,
    'roles',                 to_jsonb(coalesce(v_roles, '{}'::text[]))
  );
end;
$$;

comment on function public.anonymize_account(uuid) is
  'EY-192: borra la identidad y conserva la contabilidad. Vacía perfil y perfil de tutor, deja las reseñas sin autor, archiva las mentorías e INUTILIZA la cuenta de acceso (borra `auth.identities` para cerrar Google, banea y mata las sesiones). NO toca bookings/payments/payouts/sessions: se conservan por plazo fiscal. ⚠️ NO borra los ficheros de Storage —Supabase lo prohíbe desde SQL, error 42501—: los RECOLECTA de los cuatro buckets con carpeta por uid (incluido KYC) y devuelve `ficheros: {<bucket>: [rutas]}` para que los barra el Route Handler con la Storage API. Atómica e idempotente; si se repite devuelve `ya_anonimizada` con las rutas que sigan pendientes. Solo `service_role`.';

-- Los grants de ejecución no cambian, pero `create or replace` no los pierde y
-- repetirlos es barato: si alguien aplica solo este fichero sobre una base
-- donde la función no existiera, sale con los privilegios correctos.
revoke execute on function public.anonymize_account(uuid) from public;
revoke execute on function public.anonymize_account(uuid) from anon;
revoke execute on function public.anonymize_account(uuid) from authenticated;
grant  execute on function public.anonymize_account(uuid) to service_role;
