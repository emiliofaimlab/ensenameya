-- ============================================================================
-- Enséñame Ya — Doc 33 · la plataforma da la bienvenida (y avisa del material)
--
-- CUATRO correos que el pliego de Emilio Faim da por existentes y que hoy no
-- manda nadie. Las plantillas ya están escritas (`src/lib/email-templates.ts`);
-- lo que faltaba es quién las encola. Aquí están los cuatro disparadores:
--
--   · NTF-24 `welcome_student`      → al CONFIRMAR el correo del alta.
--   · NTF-25 `welcome_tutor`        → al crear la ficha de tutor.
--   · NTF-26 `review_received_tutor`→ al tutor, y SOLO en la reseña nueva.
--   · NTF-30 `materials_ready`      → al alumno, material nuevo para su clase.
--
-- Todos por `public.enqueue_notification` y canal 'email'. Ninguno escribe en
-- `public.notifications` directamente: esa tabla no tiene grant de insert para
-- ningún rol a propósito, y la puerta es la función, que es SECURITY DEFINER e
-- idempotente por su clave (`on conflict do nothing`, US-1202).
--
-- ── Y UNA COSA MÁS, QUE NO ES UN CORREO ─────────────────────────────────────
--
-- 🔴 NTF-30 dice «ver el material» y hasta hoy llevaba a una pantalla que NO lo
-- enseñaba: las políticas de `tutor_materials` eran solo del dueño y de admin,
-- y el bucket es privado. Un correo que promete algo que la app no da es
-- exactamente lo que el pliego prohíbe, así que la política que le abre el
-- material al alumno entra en ESTE lote y no en el siguiente. Va al final.
--
-- ── Por qué TRIGGERS y no `await enqueue(...)` en la pantalla ───────────────
--
-- Por lo mismo que el resto de EP-12: dos de estos cuatro hechos ocurren en el
-- NAVEGADOR contra PostgREST (la ficha de tutor y la subida de material los
-- escribe el formulario, no un Route Handler nuestro), así que no hay un punto
-- de servidor donde colgar el envío. Un trigger cubre todas las vías —las de
-- hoy y las que vengan— y no se puede olvidar en la siguiente pantalla que
-- escriba en esa tabla.
--
-- ⚠️ Regla de oro 12: ninguna de las funciones que se tocan aquí cambia de
-- firma ni de `returns`, así que `create or replace` es correcto y NO hace
-- falta `drop function`. Se dice explícitamente porque lo contrario —replace
-- sobre una firma que sí cambia— es lo que rompió el formulario bancario del
-- tutor con `PGRST203` (`20260910190000`).
--
-- 20260716170000 (EP-12) · 20260817130000 (handle_new_user vigente) ·
-- 20260722160000 (tutor_materials y su bucket) · 20260911170000 (el contexto)
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · NTF-24 `welcome_student` — al confirmar el correo
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 HAY QUE CUBRIR DOS CAMINOS, Y SI SE CUBRE UNO SOLO EL FALLO SE VE EN
-- PRODUCCIÓN Y NO EN DEV. La confirmación de correo está APAGADA en dev y
-- ENCENDIDA en prod, y de ahí salen dos formas distintas de que
-- `auth.users.email_confirmed_at` acabe con un valor:
--
--   (a) VIENE EN EL PROPIO INSERT. Es dev entero, es Google OAuth en los dos
--       ambientes (Google ya probó el correo) y es el checkout de invitado, que
--       crea la cuenta con `email_confirm: true`. Aquí el UPDATE no existe: si
--       solo hubiera trigger de update, en dev NADIE recibiría la bienvenida y
--       daría la sensación de que esto no funciona.
--
--   (b) LLEGA EN UN UPDATE POSTERIOR. Es el alta por correo en producción: la
--       fila nace con `email_confirmed_at` null y GoTrue la rellena cuando la
--       persona pulsa el enlace. Aquí el trigger de insert ya pasó de largo: si
--       solo hubiera trigger de insert, en dev funcionaría todo y en producción
--       —la única que importa— no se mandaría ni una bienvenida.
--
-- Por eso van los dos, y por eso LOS DOS USAN LA MISMA CLAVE
-- (`NTF-24:welcome:<uuid>`): en las vías donde se disparasen ambos, el segundo
-- choca contra el `on conflict (idempotency_key) do nothing` de
-- `enqueue_notification` y no encola nada. La idempotencia no es un extra aquí,
-- es LO QUE PERMITE cubrir las dos vías sin contar cuál ocurrió.
--
-- ⚠️ EL ROL NO SE MIRA, y no es un descuido. En ese instante `user_roles` dice
-- 'alumno' para todo el mundo (lo acaba de escribir esta misma función) y
-- `tutor_profiles` no existe todavía: el tutor se hace tutor después. Así que
-- este correo es el del ALUMNO y punto — el del tutor es NTF-25, y cuelga de
-- otro hecho.
--
-- ⚠️ Trigger sobre `auth.users`: no es territorio nuevo. `on_auth_user_created`
-- (`20260606121500_init.sql:130-132`) lleva desde el primer día ahí y necesita
-- exactamente el mismo privilegio.

-- ── (a) El alta: copia literal de `20260817130000:82-116` + el enqueue ──────
-- Se reescribe entera porque una función no se parchea. Lo de arriba —perfil
-- con nombre, zona y código de referido, rol 'alumno' y la constancia de los
-- términos— queda exactamente como estaba.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, timezone, referral_code)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'),
    nullif(trim(new.raw_user_meta_data ->> 'referral_code'), '')
  );

  -- Todo registro nace como 'alumno'. El rol 'tutor' se otorga tras la
  -- aprobación manual del admin (Doc 2: M1/M2).
  insert into public.user_roles (user_id, role)
  values (new.id, 'alumno');

  -- La aceptación solo si viene: el alta por Google no la trae por aquí, y no
  -- se inventa una constancia que nadie dio.
  if nullif(trim(new.raw_user_meta_data ->> 'terms_version'), '') is not null then
    insert into public.terms_acceptances (user_id, version, locale)
    values (
      new.id,
      trim(new.raw_user_meta_data ->> 'terms_version'),
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'terms_locale'), ''), 'en')
    )
    on conflict (user_id, version) do nothing;
  end if;

  -- NTF-24 · la vía (a): el correo ya viene probado en el INSERT. Si viene
  -- null no se encola nada y lo recogerá el trigger de update de abajo cuando
  -- la persona pulse el enlace. El perfil se acaba de insertar dos líneas
  -- arriba, así que la FK de `notifications.recipient_id` está satisfecha.
  if new.email_confirmed_at is not null then
    perform public.enqueue_notification(
      new.id, 'NTF-24', 'email', 'welcome_student', '{}'::jsonb,
      'NTF-24:welcome:' || new.id
    );
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Alta: perfil + rol alumno + constancia de términos, y desde el Doc 33 la bienvenida NTF-24 cuando el correo ya viene confirmado en el INSERT (dev entero, Google OAuth y el checkout de invitado con email_confirm:true). La otra mitad de NTF-24 la pone notify_email_confirmed() sobre el UPDATE, que es como llega la confirmación en producción. Las dos usan la clave NTF-24:welcome:<uuid>, así que donde se disparan las dos solo encola una: el duplicado lo descarta el on conflict de enqueue_notification y no un if que haya que mantener.';

-- ── (b) La confirmación posterior: el camino de PRODUCCIÓN ─────────────────
create or replace function public.notify_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ⚠️ EL `exists` NO ES DEFENSA DE ADORNO. Esto corre DENTRO del UPDATE con
  -- el que GoTrue confirma el correo: si `enqueue_notification` levantara una
  -- excepción —y la levantaría, por la FK a `profiles`, si por lo que sea no
  -- hubiera perfil— la confirmación entera se caería y la persona no podría
  -- entrar nunca. Un correo de bienvenida no puede tener el poder de bloquear
  -- un alta, así que primero se comprueba que hay a quién escribirle.
  if exists (select 1 from public.profiles p where p.id = new.id) then
    perform public.enqueue_notification(
      new.id, 'NTF-24', 'email', 'welcome_student', '{}'::jsonb,
      'NTF-24:welcome:' || new.id   -- la MISMA clave que en el alta
    );
  end if;
  return new;
end;
$$;

comment on function public.notify_email_confirmed() is
  'Doc 33 · la mitad de NTF-24 que vive en producción: con la confirmación por correo encendida, email_confirmed_at no llega en el INSERT sino en un UPDATE posterior, y el trigger del alta ya pasó de largo. Comparte clave con handle_new_user para que cubrir las dos vías no encole dos correos. No revoca execute a public a propósito: quien ejecuta el trigger es supabase_auth_admin, el rol con el que GoTrue escribe en auth.users, igual que con handle_new_user.';

-- ⚠️ `after update OF email_confirmed_at` (y no `after update` a secas) es
-- deliberado: el trigger solo se evalúa si la columna aparece en el SET. Eso
-- deja fuera de raíz al UPDATE gordo de `anonymize_account`, que reescribe
-- media tabla `auth.users` para borrar una cuenta y no toca esta columna —
-- mandarle la bienvenida a quien se acaba de dar de baja sería el peor correo
-- posible. El `when` es el segundo cerrojo: solo la transición null → valor.
drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.notify_email_confirmed();


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · NTF-25 `welcome_tutor` — al crear la ficha de tutor
-- ════════════════════════════════════════════════════════════════════════════
--
-- El hecho que el pliego llama «termina el alta de tutor» es la aparición de la
-- fila en `public.tutor_profiles`, que escribe el navegador desde
-- `tutor-onboarding-form.tsx` (`insert … {profile_id: userId, …}`). No es la
-- aprobación: el correo dice «te faltan dos pasos», o sea que se manda ANTES de
-- que nadie revise nada.
--
-- ⚠️ POR QUÉ UN TRIGGER NUEVO Y NO TOCAR EL QUE YA HAY. Sobre esta tabla vive
-- `notifications_on_tutor_profile` (NTF-03 y NTF-06), y es AFTER **UPDATE**:
-- el INSERT no lo dispara. Ampliarlo a `insert or update` obliga a soltar y
-- recrear el trigger, y su función da por hecho que `old` existe (compara
-- `new.x is distinct from old.x`, que con `old` null en un INSERT deja de
-- significar lo que dice). Dos triggers sobre el mismo evento son baratos; un
-- `drop` sobre el trigger que avisa del resultado del KYC, no.
create or replace function public.notify_tutor_profile_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Clave por tutor y no por fila: `tutor_profiles.profile_id` es la PK, así
  -- que la ficha se crea UNA vez en la vida de esa cuenta. Si algún día se
  -- borrara y se recreara, el `on conflict` evita el segundo «bienvenida».
  perform public.enqueue_notification(
    new.profile_id, 'NTF-25', 'email', 'welcome_tutor', '{}'::jsonb,
    'NTF-25:welcome:' || new.profile_id
  );
  return new;
end;
$$;

comment on function public.notify_tutor_profile_created() is
  'Doc 33 · NTF-25: la bienvenida al tutor cuelga del INSERT en tutor_profiles —el hecho «terminó el alta», que escribe el formulario del navegador— y no de la aprobación, porque el correo precisamente pide los dos pasos que faltan. Va en un trigger propio y no dentro de notify_tutor_profile porque aquel es AFTER UPDATE y ampliarlo sería drop+create del trigger que avisa del resultado del KYC, además de meter un OLD nulo en unas comparaciones escritas para updates.';

drop trigger if exists notifications_on_tutor_profile_insert on public.tutor_profiles;
create trigger notifications_on_tutor_profile_insert
  after insert on public.tutor_profiles
  for each row execute function public.notify_tutor_profile_created();


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · NTF-26 `review_received_tutor` — solo en la reseña NUEVA
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 ESTE ES EL PUNTO ENTERO DEL TICKET, y por eso no se engancha en
-- `submit_review`: esa RPC hace UPSERT (`on conflict (booking_id) do update`),
-- así que cada vez que el alumno corrige su reseña —cambia la nota, añade una
-- frase— volvería a pasar por el mismo sitio y el tutor recibiría otro «tienes
-- una reseña nueva» por algo que ya leyó.
--
-- La forma correcta es un trigger AFTER INSERT sobre la tabla, y funciona por
-- una regla de PostgreSQL que aquí viene de perlas: en un `insert … on conflict
-- do update`, la fila que choca se resuelve por la rama de UPDATE y dispara los
-- triggers de UPDATE, NO los de INSERT. O sea que el aviso sale en la reseña
-- nueva y se calla en la corrección **sin comparar nada**: sin guardar el
-- rating anterior, sin una columna `avisada` y sin un `if` que alguien tenga
-- que mantener el día que cambie el upsert.
--
-- ⚠️ Y POR ESO MISMO NO SE TOCA `submit_review`. Cambiarle la firma sería
-- `drop function` + `create` (regla 12) y reponer sus grants; no hay ninguna
-- necesidad de pasar por ahí para mandar un correo.
create or replace function public.notify_review_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `review_id` es lo que `pending_email_notifications` necesita para resolver
  -- la puntuación, el comentario, la firma del alumno y la media nueva del
  -- tutor; `booking_id` es de qué clase habla. El texto NO viaja en el payload:
  -- se resuelve al ENVIAR, que es cuando tiene que ser verdad.
  perform public.enqueue_notification(
    new.tutor_id, 'NTF-26', 'email', 'review_received_tutor',
    jsonb_build_object('booking_id', new.booking_id, 'review_id', new.id),
    'NTF-26:review:' || new.id
  );
  return new;
end;
$$;

comment on function public.notify_review_created() is
  'Doc 33 · NTF-26: avisa al tutor de una reseña NUEVA y se calla en las correcciones. Cuelga de un AFTER INSERT y no de submit_review porque esa RPC hace upsert: en PostgreSQL la rama on conflict do update dispara los triggers de UPDATE y no los de INSERT, así que la distinción sale del motor y no de comparar el rating anterior contra el nuevo. El payload lleva review_id (de ahí saca pending_email_notifications la nota, el comentario, el autor y la media) y booking_id (de qué clase habla).';

-- ⚠️ EL NOMBRE DEL TRIGGER ES FUNCIONAL, NO DECORATIVO. Sobre `public.reviews`
-- ya corre `reviews_refresh_rating` (AFTER INSERT OR UPDATE OR DELETE), que es
-- quien recalcula `tutor_profiles.rating_avg/rating_count`. Este correo enseña
-- «tu media ahora: 4,8 sobre 12 reseñas», o sea que tiene que leerla YA
-- actualizada. Y en PostgreSQL los triggers del mismo evento sobre la misma
-- tabla corren por ORDEN ALFABÉTICO de su nombre — no por orden de creación.
-- `reviews_zz_notify_tutor` va después de `reviews_refresh_rating` por la 'z',
-- y el prefijo `zz_` está ahí para que se lea como lo que es: «este corre el
-- último». Renombrarlo a algo más bonito que empiece por letra baja adelanta el
-- correo al recálculo y el tutor recibe la media de ANTES de su propia reseña —
-- un fallo de un dígito que nadie mira dos veces.
drop trigger if exists reviews_zz_notify_tutor on public.reviews;
create trigger reviews_zz_notify_tutor
  after insert on public.reviews
  for each row execute function public.notify_review_created();


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · NTF-30 `materials_ready` — material nuevo para la clase
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── El puente hasta el alumno ───────────────────────────────────────────────
-- `tutor_materials` NO tiene `booking_id`: desde `20260724150000` el material
-- cuelga de un PRODUCTO (`product_id`, nullable). El único camino hasta la
-- persona a la que le sirve es `bookings.product_id`, que sí es `not null` y
-- tiene índice. De ahí sale la consulta de abajo.
--
-- ⚠️ `product_id is null` → NO SE ENCOLA NADA, y no es un olvido: son los
-- materiales que se subieron en el onboarding, antes de que R24-16 los moviera
-- a la oferta. No cuelgan de ningún producto, así que no hay ninguna reserva a
-- la que pertenezcan y no hay a quién avisar.
--
-- ⚠️ SE FILTRA POR RESERVA VIVA Y SESIÓN FUTURA. El correo dice «míralo antes
-- de la clase»: mandárselo a quien ya terminó, canceló o está esperando a pagar
-- sería ruido, y en la reserva cancelada sería además desconcertante. Por eso
-- `confirmed`/`in_progress` y una sesión `scheduled` que todavía no ha acabado.
--
-- ── La agrupación, que es lo que hace este correo soportable ────────────────
-- 🔴 EL PLIEGO PIDE AGRUPAR POR RESERVA Y HORA, como ya hace NTF-21 con el
-- chat. Subir cuatro ficheros seguidos son cuatro INSERT y por tanto cuatro
-- disparos de este trigger; sin agrupar serían cuatro correos idénticos por el
-- mismo material, que es la forma más rápida de que alguien marque la
-- plataforma como spam.
--
-- Se consigna **con la clave**, no con una tabla de estado ni con un `if`: la
-- clave lleva la RESERVA y la HORA (`NTF-30:material:<booking>:<AAAAMMDDHH>`),
-- así que misma reserva + misma hora = un solo correo, y el resto los descarta
-- el `on conflict do nothing` de `enqueue_notification`. La clave NO lleva el
-- id del material justamente por eso: con él cada fichero tendría clave propia
-- y la agrupación no existiría.
--
-- ⚠️ La hora se trunca en UTC explícitamente (`now() at time zone 'utc'`) y no
-- con `date_trunc('hour', now())` a secas: eso último depende del `TimeZone` de
-- la sesión que esté escribiendo, y una clave de idempotencia que cambia según
-- quién hace el insert no es una clave de idempotencia (regla de oro 4).
--
-- ── Por qué SECURITY DEFINER y no un job ────────────────────────────────────
-- Porque `tutor_materials` no tiene ningún grant para `service_role` (regla de
-- oro 9: se salta la RLS, no los grants), así que un job que quisiera leer esta
-- tabla comería `permission denied` en tiempo de ejecución. El trigger corre
-- como el dueño de la función y no necesita ninguno.
create or replace function public.notify_material_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Se calcula UNA vez: `now()` es la hora de inicio de la transacción, así que
  -- las N filas de una misma subida caen en el mismo cubo aunque el reloj de
  -- pared cruce la hora en medio.
  v_hora     text := to_char(date_trunc('hour', (now() at time zone 'utc')), 'YYYYMMDDHH24');
  v_reserva  record;
begin
  if new.product_id is null then
    return new;
  end if;

  for v_reserva in
    select distinct b.student_id, b.id
      from public.bookings b
     where b.product_id = new.product_id
       and b.status in ('confirmed', 'in_progress')
       and exists (
         select 1
           from public.sessions s
          where s.booking_id = b.id
            and s.status     = 'scheduled'
            and s.end_at     > now()
       )
  loop
    -- Solo `booking_id` en el payload, y a conciencia: de él salen la clase, el
    -- tutor y la hora (`pending_email_notifications`) y de él sale el enlace
    -- (`rutaFor` → `/reservas/<id>`). Meter aquí el id del material sería
    -- mentir: con la agrupación por hora, un correo puede cubrir cuatro.
    perform public.enqueue_notification(
      v_reserva.student_id, 'NTF-30', 'email', 'materials_ready',
      jsonb_build_object('booking_id', v_reserva.id),
      'NTF-30:material:' || v_reserva.id || ':' || v_hora
    );
  end loop;

  return new;
end;
$$;

comment on function public.notify_material_ready() is
  'Doc 33 · NTF-30: avisa al alumno de que su tutor subió material. El puente es bookings.product_id, porque tutor_materials no tiene booking_id —desde 20260724150000 el material cuelga del producto—, y solo alcanza a reservas vivas (confirmed/in_progress) con una sesión scheduled por delante: el correo dice «míralo antes de la clase». Los materiales sin product_id (los del onboarding viejo) no avisan a nadie porque no pertenecen a ninguna oferta. La AGRUPACIÓN que pide el pliego está en la clave y no en una tabla de estado: NTF-30:material:<reserva>:<hora UTC>, así que subir cuatro ficheros seguidos manda UN correo. La hora se trunca en UTC explícito porque date_trunc sobre now() depende del TimeZone de la sesión, y una clave que cambia según quién escribe no es idempotente.';

drop trigger if exists notifications_on_material on public.tutor_materials;
create trigger notifications_on_material
  after insert on public.tutor_materials
  for each row execute function public.notify_material_ready();


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Y lo que hace verdad el correo de arriba: que el alumno pueda verlo
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 Hasta esta línea, NINGÚN alumno podía ver un material. `tutor_materials`
-- tenía SELECT para el dueño y para admin, y el bucket `tutor-materials` es
-- privado con políticas de carpeta-por-uid. O sea: el correo de NTF-30 habría
-- llevado a `/reservas/<id>` y la tarjeta habría salido vacía, que es
-- exactamente el correo que el pliego prohíbe.
--
-- Hacen falta LAS DOS, y por motivos distintos: la de la tabla para que la
-- consulta devuelva las filas, y la de Storage para que `createSignedUrl`
-- pueda firmar el objeto. Sin la segunda la pantalla enseñaría una lista de
-- ficheros sin enlace, que es peor que no enseñar nada.

-- ── 5.1 · La tabla ─────────────────────────────────────────────────────────
-- `completed` entra en la lista aunque el correo no se mande para reservas
-- terminadas: una cosa es a quién se avisa y otra a quién se le deja mirar. El
-- material de una clase que ya diste sigue siendo tuyo para repasar.
drop policy if exists "tutor_materials_select_student" on public.tutor_materials;
create policy "tutor_materials_select_student"
  on public.tutor_materials for select
  using (
    product_id is not null
    and exists (
      select 1 from public.bookings b
       where b.product_id = tutor_materials.product_id
         and b.student_id = (select auth.uid())
         and b.status in ('confirmed', 'in_progress', 'completed')
    )
  );

-- Sin grant nuevo: `grant select on public.tutor_materials to authenticated` ya
-- lo puso `20260722160000:205`. Lo que faltaba era la política, no el permiso —
-- y esa es justo la pareja que hay que mirar entera cada vez (regla de oro 9).

-- ── 5.2 · El bucket ────────────────────────────────────────────────────────
-- La carpeta de `tutor-materials` es el uid del TUTOR (`<uid>/<uuid>-nombre`),
-- así que la ruta por sí sola no dice de qué producto es el fichero: el camino
-- hasta el alumno tiene que pasar por la fila de `tutor_materials`, que es
-- quien guarda `product_id`. De ahí el `exists` con dos saltos.
--
-- Es el mismo patrón que `chat_attachments_select_participant`
-- (`20260722180000:58-68`): un `exists` contra `public.bookings` dentro de la
-- política de `storage.objects`, con el `name` de la fila de Storage sin
-- cualificar —ni `tutor_materials` ni `bookings` tienen una columna `name`, así
-- que resuelve al objeto y no a otra cosa—.
--
-- ⚠️ Y la condición se REPITE aquí en vez de apoyarse solo en la RLS de
-- `tutor_materials` (que también se evalúa dentro de este subconsulta). Que las
-- dos digan lo mismo es a propósito: cada superficie declara a quién abre, y
-- así abrir la tabla mañana para otro caso no abre de rebote el bucket.
drop policy if exists "materials_select_student" on storage.objects;
create policy "materials_select_student"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tutor-materials'
    and exists (
      select 1
        from public.tutor_materials m
        join public.bookings b on b.product_id = m.product_id
       where m.storage_path = name
         and b.student_id   = (select auth.uid())
         and b.status in ('confirmed', 'in_progress', 'completed')
    )
  );

-- ⚠️ SOLO SELECT. Ni insert ni delete ni update para el alumno: el material es
-- del tutor y el alumno solo lo mira. Y nada de abrir el bucket (`public =
-- true`) para ahorrarse esto — sería publicar en internet, sin sesión, todo lo
-- que cualquier tutor haya subido nunca.
