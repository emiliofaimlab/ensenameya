-- ============================================================================
-- Enséñame Ya — EY-192: `search_text` no se escribe, se recalcula sola
--
-- ⚠️ SEGUNDO FALLO EN EJECUCIÓN DE LA MISMA FUNCIÓN. El primero fue el 42501 de
-- Storage (`20260827100000`); este salió justo detrás, al volver a probar la
-- baja de verdad contra dev:
--
--     column "search_text" can only be updated to DEFAULT   (428C9)
--     Column "search_text" is a generated column.
--
-- `tutor_profiles.search_text` es `generated always as (...) stored` desde
-- `20260724140000:19`: la calcula Postgres a partir de `display_name`,
-- `headline` y `bio`. Ponerla a `null` a mano no es que esté prohibido y haya
-- que pedir permiso — es que **no tiene sentido**. En cuanto la anonimización
-- vacía esos tres campos, la columna se recalcula sola y queda vacía. La línea
-- sobraba y además rompía la función entera.
--
-- ── LA LECCIÓN, PARA QUE NO VUELVA A PASAR ──────────────────────────────────
-- Los dos fallos comparten causa: se escribió un `update` enumerando columnas
-- sin comprobar cuáles ACEPTAN escritura. Antes de tocar una tabla ancha,
-- mirar si tiene columnas generadas:
--
--     select attname from pg_attribute
--      where attrelid = 'public.tutor_profiles'::regclass and attgenerated <> '';
--
-- Y el motivo de que ninguno de los dos lo detectara antes: **el typecheck no
-- mira dentro del SQL, y `supabase db push` tampoco ejecuta la función**. Una
-- función solo se prueba llamándola. Esta se llamó, por eso están los dos
-- arreglos; `products` se revisó de paso y su `update` no toca `search_text`.
--
-- El resto del cuerpo es byte a byte el de `20260827100000` — se extrajo y se
-- le quitó esa única línea, en vez de reescribirlo, para no meter deriva.
-- ============================================================================


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
