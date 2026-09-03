-- ============================================================================
-- Enséñame Ya — C2m · el riel manual no rompe lo que ya había.
--
-- `20260902150000` puso `payment_routing_rules.payout_provider = 'manual'` en la
-- fila de Venezuela, y con eso el sistema pasó de tener DOS clases de clave
-- ('un PSP' / 'simulated', que es la ausencia de uno) a tener TRES. Dos funciones
-- que ya existían razonaban con las dos de antes y **dejaron de ser ciertas el
-- mismo día**, sin que nada fallara ni se pusiera rojo:
--
--   1. 🔴 `anonymize_account` no borra `tutor_manual_payout_destinations`, o sea
--      que el correo de PayPal y el teléfono de Zelle de un tutor venezolano
--      SOBREVIVEN A LA BAJA DE CUENTA. Lo dejó escrito y sin arreglar la propia
--      migración que creó la tabla (`20260902110000` §8), a propósito: el arreglo
--      es un `create or replace` de 280 líneas y hacerlo en paralelo con otra
--      migración que también la reemplace es cómo se pierde un `delete` en
--      silencio. Ya no hay paralelo: se hace aquí.
--
--   2. 🟠 `payouts_backlog()` —el único termómetro de dinero atascado que este
--      proyecto mira— empieza a dar ROJO PERMANENTE sobre el mercado principal.
--      Dos de sus contadores dan por hecho que `payout_provider` nombra un PSP:
--      uno declara IMPAGABLE toda orden venezolana y el otro cuenta «sin datos de
--      cobro» a los tutores que sí los registraron, solo que en la otra tabla. Lo
--      avisó `20260902150000:80-95` con las líneas exactas; esto es ese arreglo.
--
-- ── POR QUÉ LAS DOS VAN EN LA MISMA MIGRACIÓN ──────────────────────────────
--
-- Porque son el mismo defecto contado dos veces —«se añadió un riel y las
-- funciones que ya existían no se enteraron»— y porque las dos se arreglan de la
-- única forma que Postgres admite: reemplazando el cuerpo ENTERO. Separarlas en
-- dos ficheros no da nada y multiplica por dos las probabilidades de que alguien
-- aplique una y no la otra.
--
-- ⚠️ NINGUNA DE LAS DOS ESTÁ EJERCITADA POR EL `create or replace`. Valida la
-- sintaxis, no ejecuta el cuerpo — que es exactamente lo que dejó vivo el fallo
-- de `close_expired_sessions()` durante 12.446 corridas (regla de oro 11). Por
-- eso el bloque 3 de este fichero llama a `payouts_backlog()` de verdad y
-- comprueba, leyendo el cuerpo instalado, que el `delete` nuevo de
-- `anonymize_account` está de verdad ahí. Si algo de eso no cuadra, la migración
-- NO aplica.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · `anonymize_account` — el destino de cobro manual también se borra
-- ════════════════════════════════════════════════════════════════════════════
--
-- Se reemplaza la función ENTERA. El cuerpo es BYTE A BYTE el de su versión
-- vigente —`20260901160000:1685-1967`, que es la que añadió el `delete` de
-- `tutor_payout_accounts` y supersedió a la de `20260827130000`— salvo UNA línea
-- nueva y su comentario, dentro del bloque 3.6. Se extrajo y se le añadió esa
-- línea en vez de reescribirlo, para no meter deriva.
--
-- Ni la firma ni los grants cambian: `anonymize_account(uuid) returns jsonb`,
-- `security definer`, `set search_path = ''`, ejecutable SOLO por `service_role`.
-- `create or replace` conserva ACL y `comment`, pero las cuatro líneas se
-- reescriben igualmente al final del bloque: son idempotentes y son lo que hace
-- grepeable quién puede llamar a esto.
--
-- ⚠️ Y lo que NO se toca, para que no se «complete»: el bloque 3.1 sigue siendo
-- un SELECT sobre `storage.objects` (borrar de ahí da 42501, ver
-- `20260827100000`), `messages`/`conversations` siguen fuera (trampa 5) y
-- `terms_acceptances` también.
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

-- 🔴 Las cuatro líneas que no se pueden olvidar. Idénticas a las de
-- `20260826230000`: la baja de una cuenta la dispara SIEMPRE un Route Handler
-- con la clave de servicio, nunca la sesión del navegador.
revoke execute on function public.anonymize_account(uuid) from public;
revoke execute on function public.anonymize_account(uuid) from anon;
revoke execute on function public.anonymize_account(uuid) from authenticated;
grant  execute on function public.anonymize_account(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · `payouts_backlog()` — el termómetro aprende que hay un tercer riel
-- ════════════════════════════════════════════════════════════════════════════
--
-- La función es la de `20260901210000` con TRES cambios y ni uno más. Se enumeran
-- aquí arriba porque quien lea el diff dentro de un año va a ver 150 líneas y
-- necesita saber cuáles son las que importan:
--
--   (a) `balance_ajeno` excluye 'manual'. Era la falsa alarma grave: contaba
--       IMPAGABLE toda orden venezolana (fondeada por Stripe, ruteada a 'manual')
--       porque `funding_provider <> payout_provider`. 'manual' no es un balance
--       del que salga dinero —es una persona con una app de banco delante—, así
--       que compararlo con `funding_provider` no significa nada.
--
--   (b) `sin_datos_de_cobro` mira la tabla que le toca a cada riel. Antes miraba
--       solo `tutor_payout_accounts`, donde un tutor venezolano NUNCA va a tener
--       fila: su destino vive en `tutor_manual_payout_destinations` y se guarda
--       por `upsert_manual_destination`. Un tutor con su Zelle perfectamente
--       registrado se contaba como «no ha puesto sus datos».
--
--   (c) Contador nuevo: `a_pagar_a_mano`. Es la cifra que el riel manual hace
--       necesaria y que hasta hoy no existía en ningún sitio — cuántas órdenes
--       están esperando a que UNA PERSONA las pague. No es un bloqueo (por eso va
--       fuera de `bloqueos`, al lado de `en_cola`): es trabajo pendiente, y el
--       día que suba solo, lo que hace falta es un admin, no un despliegue.
--
-- ── LO QUE SIGUE IGUAL Y NO ES UN OLVIDO ───────────────────────────────────
--
-- `sin_ejecutor` no se toca. Cuenta `payout_provider is null or = 'simulated'` y
-- con VE en 'manual' esas órdenes dejan de contarse ahí — que es lo CORRECTO: ya
-- tienen riel. Lo único que queda dentro es la fila del tutor que no ha declarado
-- país, que sigue siendo la ausencia de ejecutor de verdad.
--
-- ponytail: `a_pagar_a_mano` es un `count`, sin desglose por moneda. El importe
-- de la cola entera ya está en `en_cola_importe` y todo el riel manual paga en
-- USD desde el mismo balance; el techo es que si algún día conviven dos monedas
-- en el riel manual, esta cifra no lo dirá. Se añade el desglose ese día.
--
-- ponytail: `cambio_sin_decidir` se queda con su nombre aunque el nombre ya
-- mienta a medias. La decisión SÍ se tomó el 2-sep —el spread lo asume el tutor,
-- ver `docs/PAGOS-Y-PAYOUTS.md`— así que hoy ese contador ya no dice «esto está
-- bloqueado» sino «esto exige conversión». No se renombra aquí porque la clave
-- sale en el pie del workflow de Actions y en el SQL editor de quien mire la
-- cola, y cambiarla desde una migración de otro asunto es cómo se rompe un
-- tablero. El techo: quien toque la conversión de verdad, que la renombre.
-- Venezuela no la enciende de todas formas — `payout_country_rules` no tiene fila
-- VE, así que el `left join` deja `c.currency` a null.

create or replace function public.payouts_backlog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(

    -- El reparto completo, sin interpretar. Si aquí aparece un estado que no
    -- esperabas, empieza por ahí.
    'por_estado', (
      select coalesce(jsonb_object_agg(t.estado, t.n), '{}'::jsonb)
        from (
          select p.status::text as estado, count(*) as n
            from public.payouts p
           group by 1
        ) t
    ),

    -- 🔴 LA CIFRA QUE NUNCA PUEDE QUEDARSE ARRIBA. Órdenes reclamadas de las que
    -- no se sabe si el proveedor llegó a crear el payout. No se resuelven solas
    -- (a propósito): hay que mirar el panel del PSP y anotar el id, o confirmar
    -- que no existe y devolver la fila a 'scheduled'.
    --   select id, tutor_id, amount, currency, provider_metadata
    --     from public.payouts
    --    where status = 'processing' and provider_payout_id is null;
    --
    -- 🔑 Y NO HAY QUE BUSCARLAS POR IMPORTE Y FECHA: cada payout que manda C2
    -- lleva su marca dentro. En dLocal Go va en `description` y es
    -- `EY-<payouts.id>-<intento>`, con el intento en
    -- `provider_metadata -> 'c2' -> 'intento'` (1 si no está). O sea que la fila
    -- de arriba se busca en el panel del proveedor pegando esa cadena, y la
    -- respuesta es sí o no — no «se le parece». Los ids de intentos anteriores
    -- que el proveedor dio por muertos quedan en
    -- `provider_metadata -> 'c2' -> 'intentos_muertos'`.
    --
    -- ⚠️ El riel manual NO pasa por aquí. Una orden pagada a mano no se queda en
    -- 'processing': `manage_payout(id,'mark_paid',referencia,canal)` la cierra en
    -- 'paid' en el mismo momento, con la referencia de la transferencia como
    -- `provider_payout_id`. Si aparece una fila venezolana en este contador, lo
    -- que hay que mirar es quién la puso en 'processing', no el panel de un PSP.
    'sin_identificar', (
      select count(*) from public.payouts p
       where p.status = 'processing'::public.payout_status
         and p.provider_payout_id is null
    ),

    -- En vuelo CON identificador: creadas en el proveedor y esperando a que el
    -- dinero llegue. dLocal Go las crea en PENDING, así que esto es lo normal
    -- entre el envío y el cobro; solo preocupa si no baja nunca.
    'en_vuelo', (
      select count(*) from public.payouts p
       where p.status = 'processing'::public.payout_status
         and p.provider_payout_id is not null
    ),

    -- Lo que hay delante ahora mismo. Mismo criterio que
    -- `process_scheduled_payouts()`, para que las dos cifras se puedan contrastar.
    -- ⚠️ INCLUYE las del riel manual, que el job no puede tocar: para saber
    -- cuántas de estas esperan a una persona y no a un PSP, `a_pagar_a_mano`.
    'en_cola', (
      select count(*) from public.payouts p
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
    ),
    'en_cola_importe', (
      select coalesce(jsonb_object_agg(t.currency, t.total), '{}'::jsonb)
        from (
          select p.currency::text as currency, sum(p.amount) as total
            from public.payouts p
           where p.status = 'scheduled'::public.payout_status
             and p.scheduled_for <= now()
           group by 1
        ) t
    ),

    -- 🟠 EL TRABAJO QUE NO LO HACE NINGÚN JOB. Órdenes vencidas cuyo destino
    -- rutea a 'manual' (hoy: Venezuela, `20260902150000`). No están rotas, no
    -- están bloqueadas y ninguna pasada de `/api/cron/payouts-process` las va a
    -- mover: esperan a que un admin abra `manual_destination(tutor_id)`, haga la
    -- transferencia y cierre la fila con `manage_payout(id,'mark_paid',…)`.
    --
    -- Existe porque sin ella ese trabajo era invisible: antes de hoy estas filas
    -- se contaban en `sin_ejecutor` (mezcladas con las impagables) o en
    -- `balance_ajeno` (declaradas imposibles), y en los dos casos el mensaje era
    -- «no se puede», cuando el mensaje correcto es «te toca a ti».
    --
    -- ⚠️ Puede solaparse con `bloqueos.sin_datos_de_cobro`: una orden manual cuyo
    -- tutor todavía no ha declarado a dónde cobrar sale en las dos, y así debe
    -- ser — es trabajo pendiente Y le falta un dato.
    'a_pagar_a_mano', (
      select count(*)
        from public.payouts p
        left join lateral (
          select rr.payout_provider
            from public.payment_routing_rules rr
           where rr.is_active
             and rr.payer_country is null
             and rr.payee_country is not distinct from p.payee_country
           order by rr.priority
           limit 1
        ) r on true
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
         and r.payout_provider = 'manual'
    ),

    -- Emitidas pero todavía no vencidas (retención de DP-02). No son un problema.
    'programadas_a_futuro', (
      select count(*) from public.payouts p
       where p.status = 'scheduled'::public.payout_status
         and (p.scheduled_for is null or p.scheduled_for > now())
    ),

    -- Rechazadas por el proveedor. Requieren `manage_payout(id,'retry')` o una
    -- decisión humana; no salen solas.
    'fallidas', (
      select count(*) from public.payouts p
       where p.status = 'failed'::public.payout_status
    ),

    -- ── POR QUÉ NO SALE LO QUE ESTÁ EN COLA ────────────────────────────────
    --
    -- Estos seis números explican una cola que no baja. Ninguno es un fallo del
    -- pago: son condiciones previas que el ejecutor comprueba ANTES de llamar a
    -- nadie, y que ninguna pasada del job va a resolver sola.
    --
    -- ⚠️ Se calculan aquí para poder mirarlos sin depender de que el workflow
    -- corra, PERO el que manda es el ejecutor: si algún día discrepan, gana el
    -- Route Handler, que es quien habla con el proveedor. Esta función explica;
    -- no decide.
    --
    -- ⚠️ Y desde C2m hay que leerlos sabiendo que `payout_provider` tiene TRES
    -- clases de valor, no dos: un PSP con adaptador ('stripe', 'dlocal'), el riel
    -- manual ('manual', que es una persona) y la ausencia de ejecutor ('simulated'
    -- o null). `rielDePayout()` en `src/lib/payments.ts` es la misma partición
    -- dicha en TypeScript, y si esa función y estos filtros discrepan, gana ella:
    -- es la que decide qué se le pinta al tutor y qué manda el job.
    'bloqueos', (
      select jsonb_build_object(

        -- Sin país de destino congelado no se puede pagar a ningún sitio.
        -- ⚠️ Hoy en dev son TODAS: el backfill de `20260901130000` copió
        -- `payments.payee_country`, que está a null en las 115 filas.
        'sin_pais',
          count(*) filter (where p.payee_country is null),

        -- A su destino no le corresponde ningún ejecutor: ni PSP ni persona. Se
        -- queda con `null` y con 'simulated', que es la ausencia de uno.
        -- ⚠️ VENEZUELA YA NO ESTÁ AQUÍ, y es correcto: desde `20260902150000` su
        -- fila dice 'manual', o sea que tiene riel — el de una persona. Lo único
        -- que debe quedar dentro es la fila del tutor que no ha declarado país.
        'sin_ejecutor',
          count(*) filter (where r.payout_provider is null
                              or r.payout_provider = 'simulated'),

        -- 🔴 EL DINERO ESTÁ EN OTRO BALANCE. Un payout se paga desde el balance
        -- del PSP que cobró ese dinero (`funding_provider`); si el que ejecuta es
        -- otro, la orden no es «difícil», es IMPAGABLE.
        -- ⚠️ Hoy esto lo cumple TODO lo que se construya por riel bancario: las
        -- filas de `payment_routing_rules` dicen `charge_provider='stripe'` con
        -- `payout_provider='dlocal'`. O se cobra por donde se paga, o se fondea el
        -- balance de dLocal Go a propósito. Es una decisión de tesorería, no de
        -- código.
        --
        -- ⚠️ C2m · Y POR ESO 'manual' QUEDA FUERA DEL FILTRO. Sin esa exclusión,
        -- toda orden venezolana entraba aquí —se fondea con Stripe y se «ejecuta»
        -- con 'manual', que nunca van a coincidir— y el termómetro declaraba
        -- imposible el mercado principal. 'manual' no tiene balance: el dinero
        -- sale de donde lo tengamos y lo mueve una persona. Cuando esa orden
        -- espera, no espera tesorería: espera a alguien. Eso es `a_pagar_a_mano`.
        'balance_ajeno',
          count(*) filter (where r.payout_provider is not null
                             and r.payout_provider <> 'simulated'
                             and r.payout_provider <> 'manual'
                             and p.funding_provider is distinct from r.payout_provider),

        -- El saldo del tutor está en USD y el país cobra en su moneda. Quién
        -- asume el spread ya está decidido (2-sep: el tutor), así que esto ya no
        -- es tanto un bloqueo como un aviso de que esa orden pasa por conversión.
        -- Ecuador es el único de los ocho países que cobra en USD; Venezuela no
        -- entra porque `payout_country_rules` no tiene fila VE. Ver el techo
        -- `ponytail` de la cabecera de este bloque: el nombre de la clave se
        -- quedó viejo y se renombra cuando alguien toque la conversión de verdad.
        'cambio_sin_decidir',
          count(*) filter (where c.currency is not null
                             and c.currency <> p.currency),

        -- El tutor no ha registrado a dónde cobrar. Se arregla solo en cuanto lo
        -- guarde: la orden sigue en la cola, no en 'failed'.
        --
        -- ⚠️ C2m · CADA RIEL TIENE SU TABLA, Y HAY QUE MIRAR LA QUE TOCA. El riel
        -- bancario guarda en `tutor_payout_accounts` (B1, una fila por tutor); el
        -- manual guarda en `tutor_manual_payout_destinations` (`20260902110000`,
        -- VARIAS por tutor, una por canal). Mirar solo la primera contaba «sin
        -- datos» a todo tutor venezolano, incluidos los que habían registrado su
        -- Zelle correctamente — y ese contador es el que decide si alguien va a
        -- escribirle al tutor o no.
        --
        -- Sin riel resuelto (`null` / 'simulated') se mira la bancaria, que es lo
        -- mismo que se hacía antes: esa orden ya está contada en `sin_ejecutor` y
        -- el dato de cobro no es su problema principal.
        'sin_datos_de_cobro',
          count(*) filter (
            where case
                    when r.payout_provider = 'manual' then m.hay is not true
                    else a.tutor_id is null
                  end
          ),

        -- El importe agregado no cuadra con sus líneas. Es integridad nuestra, no
        -- del PSP, y el ejecutor se niega a mandarlo (regla de oro 2).
        'descuadradas',
          count(*) filter (where p.amount is distinct from coalesce(i.suma, 0))
      )
        from public.payouts p
        left join lateral (
          select rr.payout_provider
            from public.payment_routing_rules rr
           where rr.is_active
             and rr.payer_country is null
             and rr.payee_country is not distinct from p.payee_country
           order by rr.priority
           limit 1
        ) r on true
        left join public.payout_country_rules   c on c.country  = p.payee_country
        left join public.tutor_payout_accounts  a on a.tutor_id = p.tutor_id
        -- El destino manual se pregunta por EXISTENCIA y con `limit 1`, no con un
        -- `left join` a secas: la PK de esa tabla es `(tutor_id, channel)`, así
        -- que un tutor con Zinli y Zelle multiplicaría su fila de `payouts` por
        -- dos y TODOS los contadores de este bloque saldrían inflados.
        left join lateral (
          select true as hay
            from public.tutor_manual_payout_destinations d
           where d.tutor_id = p.tutor_id
           limit 1
        ) m on true
        left join lateral (
          select sum(pi.amount) as suma
            from public.payout_items pi
           where pi.payout_id = p.id
        ) i on true
       where p.status = 'scheduled'::public.payout_status
         and p.scheduled_for <= now()
    )
  );
$$;

comment on function public.payouts_backlog() is
  'C2 · termómetro de la cola de payouts, para el SQL editor y el pie del workflow de Actions. NO está programado en ningún cron, igual que refunds_backlog(). Devuelve el reparto por estado, lo que hay en cola con su importe, lo que está en vuelo, cuántas esperan a que una persona las pague (a_pagar_a_mano, riel manual) y —la cifra que importa— sin_identificar: órdenes en ''processing'' sin provider_payout_id, o sea reclamadas sin saber si el proveedor llegó a crear el payout. Esas NO se reintentan solas a propósito (POST /v1/payouts no tiene clave de idempotencia y un 400 suyo puede haber creado el payout igual), así que mientras ese número no sea 0 puede haber un pago sin conciliar. El bloque bloqueos explica por qué una cola no baja: sin país, sin ejecutor, balance ajeno, cambio sin decidir, sin datos de cobro o descuadrada. ⚠️ Desde C2m (2026-09-02) distingue TRES rieles y no dos: PSP con adaptador, ''manual'' (una persona) y la ausencia de ejecutor. balance_ajeno excluye ''manual'' —no tiene balance del que salir— y sin_datos_de_cobro mira tutor_manual_payout_destinations cuando el riel es manual, no tutor_payout_accounts. Explica, no decide: quien manda sobre si una orden se manda es el Route Handler /api/cron/payouts-process.';

-- 🔴 Las cuatro líneas de siempre. Esta función no devuelve PII —solo cuenta—
-- pero sí dice cuánto se le debe a la plataforma y a cuántos tutores, y en
-- Postgres el EXECUTE de una función nueva se concede a PUBLIC por defecto, que
-- con PostgREST significa `POST /rest/v1/rpc/payouts_backlog` abierto a `anon`.
revoke execute on function public.payouts_backlog() from public;
revoke execute on function public.payouts_backlog() from anon;
revoke execute on function public.payouts_backlog() from authenticated;
grant  execute on function public.payouts_backlog() to service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Comprobación en EJECUCIÓN (reglas de oro 9 y 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `create or replace` valida la sintaxis, NO ejecuta el cuerpo. Es exactamente
-- lo que dejó vivo el fallo de `close_expired_sessions()` durante 12.446
-- corridas: la función se reescribió entera y el `case` sin `::session_status`
-- sobrevivió a la reescritura, porque nadie la llamó.
--
-- Aquí se llama a `payouts_backlog()` de verdad —es `stable`, no escribe nada— y
-- de `anonymize_account` se lee el cuerpo INSTALADO, que es lo único que se puede
-- comprobar sin borrar una cuenta. Si algo no cuadra, la migración no aplica.
do $$
declare
  v_res    jsonb;
  v_cuerpo text;
  v_rol    text;
  v_dueno  name;
  v_clave  text;
begin
  -- ── a) El termómetro corre, y trae la cifra nueva ────────────────────────
  -- Esta llamada es la única prueba de que el `left join lateral` sobre
  -- `tutor_manual_payout_destinations` resuelve: si el dueño de la función no
  -- pudiera leer esa tabla, aquí saldría un 42501 (regla de oro 9) y no en medio
  -- de un lote de pagos dentro de tres semanas.
  v_res := public.payouts_backlog();

  foreach v_clave in array array[
    'por_estado', 'sin_identificar', 'en_vuelo', 'en_cola', 'en_cola_importe',
    'a_pagar_a_mano', 'programadas_a_futuro', 'fallidas', 'bloqueos'
  ] loop
    -- `jsonb_exists(...)` y no el operador `?`: es la misma comprobación, pero
    -- el signo de interrogación es lo que muchas capas de cliente confunden con
    -- un marcador de parámetro, y esto lo aplica el CLI de Supabase.
    if not jsonb_exists(v_res, v_clave) then
      raise exception 'C2m: payouts_backlog() no devolvió la clave «%» — el jsonb_build_object quedó a medias', v_clave;
    end if;
  end loop;

  foreach v_clave in array array[
    'sin_pais', 'sin_ejecutor', 'balance_ajeno', 'cambio_sin_decidir',
    'sin_datos_de_cobro', 'descuadradas'
  ] loop
    if not jsonb_exists(v_res -> 'bloqueos', v_clave) then
      raise exception 'C2m: payouts_backlog().bloqueos perdió el contador «%»', v_clave;
    end if;
  end loop;

  -- Ninguna cifra puede quedar a null: un null aquí significa un `count` mal
  -- colocado y en un termómetro es peor que un número alto, porque no alarma.
  if (v_res ->> 'a_pagar_a_mano') is null
     or (v_res -> 'bloqueos' ->> 'sin_datos_de_cobro') is null
     or (v_res -> 'bloqueos' ->> 'balance_ajeno') is null then
    raise exception 'C2m: payouts_backlog() devolvió null en un contador: %', v_res;
  end if;

  -- ── b) `anonymize_account` lleva de verdad el `delete` nuevo ─────────────
  -- Se lee el cuerpo instalado y no se confía en que este fichero se aplicó: si
  -- otra migración la reemplazara DESPUÉS copiando una versión vieja, la fuga de
  -- PII volvería en silencio y este `raise` es lo único que lo diría.
  v_cuerpo := pg_get_functiondef('public.anonymize_account(uuid)'::regprocedure);

  if position('delete from public.tutor_manual_payout_destinations' in v_cuerpo) = 0 then
    raise exception 'C2m: anonymize_account NO borra tutor_manual_payout_destinations — el correo de PayPal y el teléfono de Zelle sobrevivirían a la baja de cuenta';
  end if;
  if position('delete from public.tutor_payout_accounts' in v_cuerpo) = 0 then
    raise exception 'C2m: al reemplazar anonymize_account se perdió el delete de tutor_payout_accounts (B1) — se copió una versión anterior a 20260901160000';
  end if;
  if position('delete from public.verification_documents' in v_cuerpo) = 0
     or position('delete from auth.identities' in v_cuerpo) = 0 then
    raise exception 'C2m: el cuerpo instalado de anonymize_account no es el completo — falta el KYC o el cierre de la puerta de auth';
  end if;

  -- ── c) Quién puede llamar a cada una ─────────────────────────────────────
  -- Un grant a PUBLIC lo hereda todo el mundo, así que preguntar por `anon` y
  -- `authenticated` cubre también el PUBLIC olvidado, que es el peligroso: con
  -- PostgREST delante, execute a anon es un endpoint que borra cuentas.
  foreach v_rol in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_rol::name, 'public.anonymize_account(uuid)', 'execute') then
      raise exception 'C2m: % puede ejecutar anonymize_account — eso es un endpoint que borra cuentas', v_rol;
    end if;
    if has_function_privilege(v_rol::name, 'public.payouts_backlog()', 'execute') then
      raise exception 'C2m: % puede ejecutar payouts_backlog — dice cuánto se debe y a cuántos tutores', v_rol;
    end if;
  end loop;

  if not has_function_privilege('service_role'::name, 'public.anonymize_account(uuid)', 'execute')
     or not has_function_privilege('service_role'::name, 'public.payouts_backlog()', 'execute') then
    raise exception 'C2m: service_role perdió el execute de alguna de las dos — el Route Handler de la baja o el pie del workflow van a dar 42501';
  end if;

  -- ── d) Regla de oro 9, dicha por el motor ────────────────────────────────
  -- Las dos funciones son `security definer`: leen las tablas con los privilegios
  -- de su DUEÑO, no con los del que llama, y por eso `payouts_backlog()` funciona
  -- aunque `service_role` no tenga ni `select` sobre `tutor_payout_accounts`
  -- (`20260901160000` se lo niega a propósito). Lo que sí hace falta es que el
  -- dueño pueda leer la tabla nueva; la llamada de (a) ya lo demuestra, y esto lo
  -- deja dicho con un mensaje legible por si algún día la llamada empieza a
  -- fallar y hay que saber por dónde mirar.
  select pg_get_userbyid(pr.proowner) into v_dueno
    from pg_proc pr
    join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and pr.proname = 'payouts_backlog'
   limit 1;

  if not has_table_privilege(v_dueno, 'public.tutor_manual_payout_destinations', 'select') then
    raise exception 'C2m: el dueño de payouts_backlog (%) no puede leer tutor_manual_payout_destinations', v_dueno;
  end if;
  if not has_table_privilege(v_dueno, 'public.tutor_manual_payout_destinations', 'delete') then
    raise exception 'C2m: el dueño de anonymize_account (%) no puede BORRAR de tutor_manual_payout_destinations — la baja de cuenta fallaría entera al llegar al bloque 3.6', v_dueno;
  end if;

  raise notice 'C2m: anonymize_account borra el destino manual y payouts_backlog cuenta a_pagar_a_mano = %.', (v_res ->> 'a_pagar_a_mano');
end;
$$;


-- ── Lo que hay que mirar el día que esto se aplique ─────────────────────────
--
-- a) Que el termómetro dejó de mentir sobre Venezuela. Antes de esta migración,
--    toda orden venezolana vencida salía en `balance_ajeno` (impagable) y en
--    `sin_datos_de_cobro` (aunque el tutor hubiera registrado su Zelle). Después,
--    ninguna de las dos y sí en `a_pagar_a_mano`:
--
--      select public.payouts_backlog();
--
-- b) Que una baja de cuenta se lleva el destino manual. En dev, con un tutor de
--    prueba que tenga fila (`select tutor_id, channel, handle_masked from
--    public.tutor_manual_payout_destinations;`), después de darlo de baja esa
--    consulta no debe devolver su fila. Es la comprobación que el bloque 3 no
--    puede hacer sin borrar a alguien.
--
-- c) Que `run-payout-batch` —el pg_cron de C1— no se ha roto por el camino.
--    Agregando por jobname, que leer las diez últimas filas solo enseña los jobs
--    frecuentes (regla de oro 11):
--
--      select j.jobname, d.status, count(*), max(d.start_time), max(d.return_message)
--        from cron.job_run_details d join cron.job j using (jobid)
--       where j.jobname in ('run-payout-batch', 'process-payouts')
--       group by 1, 2;
