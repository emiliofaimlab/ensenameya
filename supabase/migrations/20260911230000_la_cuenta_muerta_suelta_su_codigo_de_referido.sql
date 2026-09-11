-- ============================================================================
-- Enséñame Ya — Una cuenta dada de baja suelta su código de referido, en vez
-- de bloquearlo para siempre.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Reportado en PRODUCCIÓN el 11-sep-2026: `/referidos` se quedaba en
-- «Preparando tu enlace…» en las dos tarjetas, con la clave de Referral Factory
-- puesta y las dos migraciones de referidos aplicadas. Diagnóstico, contra la
-- base de prod:
--
--   · `referral_memberships` tenía 2 filas, y NO eran del usuario que miraba la
--     pantalla: eran de `cuenta-eliminada+7c276701-…@ensenameya.invalid`.
--   · Sus códigos eran `uYGjFEmA` y `ug7a0SPy`, o sea EXACTAMENTE los que RF le
--     devuelve a `jose@faimlab.com`. No es casualidad: `POST users` es
--     idempotente por (campaña, correo) —medido el 11-sep— y devuelve siempre
--     el mismo usuario con el mismo código.
--   · `referral_memberships.code` es `unique` en toda la tabla.
--
-- O sea: la cuenta se dio de baja, `anonymize_account` la anonimizó, y sus
-- memberships SOBREVIVIERON —porque la fila de `profiles` no se borra, se
-- anonimiza, y el `on delete cascade` nunca llega a dispararse—. Al registrarse
-- otra vez con el mismo correo, RF devuelve los mismos códigos y el insert se
-- come un `23505`. Para siempre, en cada carga.
--
-- `anonymize_account` borra de once tablas; `referral_memberships` no estaba en
-- la lista por el motivo de siempre: la tabla nació después (`20260911120000`).
--
-- ⚠️ EL `unique` NO SE TOCA, y no es negociable: la conversión resuelve al
-- referidor haciendo `join referral_memberships m on m.code = p.referral_code`
-- (`referral_conversions_pending`). Dos filas con el mismo código volverían esa
-- unión ambigua y acabarían premiando a quien no toca. Lo que sobra es la fila
-- muerta, no la restricción.
--
-- ── LO QUE HAY QUE SABER ───────────────────────────────────────────────────
-- · La función se reemite ENTERA porque plpgsql no se parchea por líneas. El
--   cuerpo sale de `pg_get_functiondef()` sobre la base de dev, no del fichero
--   de la migración anterior, para no revertir sin querer lo que otras tandas
--   le hayan añadido. Lo único que cambia es el `delete` nuevo y su comentario.
-- · El backfill de abajo limpia las filas que YA quedaron huérfanas. Se
--   reconocen por el correo que les deja la anonimización
--   (`cuenta-eliminada+…@ensenameya.invalid`), que es el marcador que ella misma
--   escribe.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.anonymize_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- ⚠️ B1 · LOS DATOS BANCARIOS SE BORRAN AQUÍ, Y SOLO AQUÍ.
  --
  -- Explícito, aunque la FK a `profiles` sea `on delete cascade`: la cascada NO
  -- se dispara nunca, porque `profiles` no se borra, se vacía (3.2). Confiar en
  -- ella dejaría el número de cuenta vivo para siempre.
  --
  -- Y BORRAR, no vaciar: una fila a medias es una fila que `payout_beneficiary`
  -- tendría que aprender a distinguir de una recién creada.
  --
  -- ── POR QUÉ AQUÍ Y NO EN `request_account_deletion` ───────────────────────
  -- Que es donde parece natural ponerlo, porque es donde «se desactiva la
  -- cuenta». Ahí sería un INTERBLOQUEO PERMANENTE: el tutor pide la baja con un
  -- payout `scheduled` → se le borran los datos → C2 no puede construir el
  -- beneficiario → el payout pasa a `failed` → `failed` ESTÁ en la lista de
  -- bloqueos de `account_deletion_state` → `process_pending_account_deletions`
  -- no completa jamás → la cuenta queda desactivada para siempre Y el tutor no
  -- cobra nunca. Y `failed` no se resuelve solo: exige un `admin_payout_action`.
  --
  -- Puesto aquí, la tensión se resuelve sin código extra: esta función YA se
  -- niega a correr mientras haya dinero en vuelo (el cerrojo de bloqueos, más
  -- arriba). Los datos con los que se le paga al tutor sobreviven exactamente
  -- hasta que aterriza el último payout, ni un día más. El corolario para la
  -- pantalla es que /tutor/payouts sigue siendo EDITABLE con la baja `pending`.
  delete from public.tutor_payout_accounts where tutor_id = p_user_id;  -- B1

  -- ⚠️ C2m · Y EL DESTINO DE COBRO MANUAL, POR EL MOTIVO IDÉNTICO.
  --
  -- `tutor_manual_payout_destinations` (`20260902110000`) guarda el correo de
  -- PayPal, el Pay ID de Binance o el teléfono de Zelle con los que se le paga a
  -- mano a un tutor venezolano. Tiene la MISMA FK `on delete cascade` a
  -- `profiles` que la línea de arriba, o sea la misma cascada que NO SE DISPARA
  -- NUNCA porque `profiles` se vacía (3.2), no se borra.
  --
  -- No estaba en esta lista porque no existía cuando se escribió, y el resultado
  -- era una fuga silenciosa: el tutor se daba de baja, su fila se quedaba, y
  -- /privacy seguía prometiendo lo contrario. Que la tabla enmascare el
  -- identificador hacia el navegador (`handle_masked`) no cambia nada aquí:
  -- `handle` está en claro en la base y `service_role` lo lee.
  --
  -- Y va AQUÍ, no en `request_account_deletion`, por lo mismo que el de B1 y en
  -- este riel más literal todavía: en el riel manual quien cierra la orden es una
  -- persona con `manage_payout(id,'mark_paid',…)` (`20260902120000`), o sea que
  -- puede tardar días. Borrar el destino antes de eso deja al tutor sin cobrar y
  -- a la cuenta desactivada para siempre. Puesto aquí no hace falta código extra:
  -- esta función ya se niega a correr mientras haya dinero en vuelo.
  delete from public.tutor_manual_payout_destinations where tutor_id = p_user_id;  -- C2m

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

  -- ⚠️ Y SUS ENLACES DE REFERIDO, que si no se quedan bloqueando el código
  -- PARA SIEMPRE. `referral_memberships.code` es `unique` en toda la tabla
  -- —tiene que serlo: la conversión resuelve al referidor por ese código y dos
  -- filas lo harían ambiguo—, y Referral Factory devuelve SIEMPRE el mismo
  -- código para el mismo (correo, campaña). Así que quien se da de baja y
  -- vuelve a registrarse con su correo choca contra su propia fila muerta y no
  -- consigue enlace nunca más. Pasó en producción el 11-sep-2026 con la cuenta
  -- del propio equipo: dos filas de una `cuenta-eliminada+…` reteniendo los
  -- códigos `uYGjFEmA` y `ug7a0SPy`.
  --
  -- Borrarlos es además lo correcto de fondo: una cuenta muerta no refiere a
  -- nadie. Quien entró con su código se queda con el `profiles.referral_code`
  -- por trazabilidad, pero ya no casa con ninguna membership y por tanto no
  -- convierte — que es lo que se quiere: no hay a quién premiar.
  delete from public.referral_memberships where profile_id = p_user_id;

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
$function$
;

-- ── Backfill: las filas que ya quedaron huérfanas ───────────────────────────
-- Hoy son 2 en prod y 0 en dev. Sin esto, la cuenta del equipo sigue sin poder
-- sacar enlace aunque la función ya esté arreglada: el arreglo vale para las
-- bajas futuras, no para la que ya pasó.
delete from public.referral_memberships m
 using auth.users u
 where u.id = m.profile_id
   and u.email like 'cuenta-eliminada+%@ensenameya.invalid';
