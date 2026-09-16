-- ============================================================================
-- Enséñame Ya — EL REGALO SOBREVIVE AL TUTOR: si el tutor se da de baja, la
-- mentoría regalada se convierte en BONO para gastar con otro.
--
-- ── POR QUÉ ────────────────────────────────────────────────────────────────
-- Punto 9 de la lista del cliente, segunda mitad: «si la clase de regalo ya se
-- pagó y el tutor elimina su cuenta, que pueda quedar como bono para
-- redireccionarlo a otro tutor». De las dos salidas posibles —reembolsar o
-- convertir— el cliente eligió CONVERSIÓN AUTOMÁTICA, y automática significa
-- que nadie tiene que pedirla: ni el destinatario, ni operaciones.
--
-- Hoy el regalo muere con el tutor Y NO LO DICE. `anonymize_account` archiva
-- sus mentorías y le deja el perfil en `approval_status='suspended'`, así que
-- `products_select_public` deja de devolver la ficha, `/reservar/<id>` responde
-- 404 y `credito_aplicable` sigue exigiendo que el `product_id` case («este
-- regalo es para otra mentoría»). Al destinatario le queda un crédito que pone
-- 'active' y lleva dinero dentro, sin ninguna forma de gastarlo: caduca a los
-- 90 días y lo único que recibe es el NTF-37 de «caducó sin agendarse», que
-- además le echa la culpa. Alguien pagó eso.
--
-- ── EL MECANISMO ENTERO ES UNA COLUMNA ─────────────────────────────────────
-- `credits.kind = 'saldo'` ya significa exactamente lo que hace falta: dinero
-- que se gasta POR PARTES contra CUALQUIER mentoría de la misma moneda, con el
-- alumno pagando la diferencia. `credito_aplicable` ni mira `product_id` en esa
-- rama (`20260912110000:1452`). O sea que convertir un regalo en bono es un
-- `update` de una columna, y ni una línea más:
--
--   · NO se tocan `credito_aplicable`, `aplicar_credito` ni las constraints.
--     `credits_mentoria_entera` solo habla de `kind='mentoria'`, así que deja
--     de aplicar sola; `credits_forma_por_origen` exige `product_id` y
--     `purchased_by` en un regalo y los dos SE QUEDAN — son el rastro de qué se
--     regaló y quién lo pagó, no la atadura. La atadura era `kind`.
--   · `fondeo_del_cobro` sigue sabiendo dónde está la caja, porque
--     `credits.provider` —el PSP que cobró el regalo— tampoco se toca. El
--     regalo ya está cobrado: esto no mueve dinero, solo cambia contra qué se
--     puede gastar.
--
-- ── DÓNDE SE ENGANCHA, Y POR QUÉ NO DENTRO DE `anonymize_account` ──────────
-- Va en un trigger `after insert on public.account_deletions`, que es el
-- patrón que ya usa `purgar_navegacion_de_baja` (`20260827140000:300`) y por su
-- mismo motivo, escrito allí: «copiar doscientas líneas de una función crítica
-- para añadir un delete es la forma de romperla». Con el trigger, cualquier
-- baja lo hace, la escriba quien la escriba — el Route Handler de
-- `/api/cuenta/eliminar` y el barrido `complete-pending-account-deletions`
-- acaban los dos en `anonymize_account`, y ésa es la única que inserta aquí.
--
-- ⚠️ Y SE HACE AL ANONIMIZAR, NO AL PEDIR LA BAJA. `request_account_deletion`
-- (`20260831160000:473`) pausa las mentorías y suspende al tutor, pero eso es
-- REVERSIBLE: `cancel_account_deletion` lo devuelve todo. Convertir allí sería
-- irreversible sobre una baja que todavía puede cancelarse, y dejaría bonos
-- sueltos de tutores que siguen dando clase. El insert en `account_deletions`
-- es el punto de no retorno, y por eso es aquí.
--
-- ── LOS 30 DÍAS DE GRACIA ──────────────────────────────────────────────────
-- `expires_at = greatest(expires_at, now() + 30 días)`. Si el tutor se va el
-- día 85 de los 90, el destinatario no puede quedarse con cinco días para
-- encontrar otro tutor por un motivo que no es suyo — y encima ha pasado el
-- plazo entero sin poder agendar, porque la baja se desactiva al pedirla y se
-- completa hasta 90 días después. Precedente de la casa:
-- `liberar_credito_de_pago` (`20260912110000:658`) da gracia por lo mismo.
-- NUNCA acorta: `greatest` se queda con la fecha que ya tuviera si era mayor.
--
-- ⚠️ `greatest` IGNORA LOS NULL en PostgreSQL, así que `greatest(null, X)` es
-- `X`, no `null`. Escrito a pelo le pondría caducidad a un crédito que no
-- tenía ninguna — o sea justo lo contrario de dar gracia. De ahí el `case`.
--
-- ── EL AVISO ───────────────────────────────────────────────────────────────
-- 🔴 `gift_converted` (NTF-38) TODAVÍA NO EXISTE EN `email-templates.ts`, y eso
-- es a propósito: la plantilla la escribe el fichero de correos, no una
-- migración. Ninguna de las cuatro del regalo sirve — NTF-36 y NTF-37 dicen
-- «caduca» y «ya no se puede usar», que es lo contrario de lo que pasó.
--
-- ⚠️ MIENTRAS NO EXISTA, `npm run check:email` FALLA, y ese rojo es el diseño:
-- `email-templates.check.ts:47` lee los `enqueue_notification` de TODAS las
-- migraciones y exige que cada plantilla exista, precisamente porque
-- `renderEmail` devuelve null, el job lo marca `failed` PERMANENTE y la
-- `idempotency_key` gastada impide reencolarlo. El aviso se perdería sin que
-- nadie se entere. De ahí el orden de despliegue, igual que en
-- `20260912110000`: **Vercel primero, `db:push` después.**
--
-- Se encola a `coalesce(beneficiary_id, purchased_by)` —el patrón de
-- `avisar_creditos_por_expirar`—: al destinatario si ya reclamó el regalo, y a
-- quien lo pagó mientras siga sin reclamar, que es el único a quien se puede
-- escribir. La plantilla tiene que hablarles a los dos, como hace NTF-36.
--
-- ── LO QUE ESTA MIGRACIÓN NO HACE ──────────────────────────────────────────
-- · NO añade «tengo regalos vivos sobre mis mentorías» a los bloqueos de
--   `account_deletion_state`. Sería el interbloqueo contra el que avisa la
--   cabecera de `20260826230000`: el tutor no puede agendar por el alumno, así
--   que se quedaría atrapado hasta 90 días esperando algo que no depende de él.
--   La conversión es justo lo que permite que la baja siga siendo inmediata.
-- · NO hay pantalla de admin. Producción tiene tres cuentas y cero tutores
--   dados de baja con un regalo vivo encima.
-- · NO toca `caducar_creditos` ni `avisar_creditos_por_expirar`. Un bono que
--   caduque seguirá recibiendo el texto de «el regalo caducó sin agendarse»,
--   que es feo pero verdad. Afinarlo es tocar el payload de esas dos y la
--   plantilla; no vale el riesgo hoy.
--
-- ── LO QUE ESTA MIGRACIÓN DEJA PEDIDO FUERA (y no puede arreglar sola) ─────
-- Cuatro cosas viven en ficheros que no son éste. Se escriben aquí porque el
-- día que alguien lea esta migración buscando por qué un bono se comportó raro,
-- la respuesta va a estar en una de las cuatro:
--
-- 1. 🔴 `src/lib/email-templates.ts` · la plantilla `gift_converted` y su
--    entrada en `src/lib/notifications.ts` (título + ruta `/reservas`). BLOQUEA:
--    `npm run check:email` está en rojo hasta que exista, y ese es su trabajo.
-- 2. 🔴 `aplicar_credito` le pasa a `fondeo_del_cobro` el `credits.amount`
--    ENTERO como caja del regalo (`20260912110000:1721`). Con un regalo
--    `kind='mentoria'` eso se gastaba de una vez y daba igual; un BONO se puede
--    partir entre DOS reservas, y entonces la misma caja se cuenta dos veces:
--    `platform_funded_amount` sale 0 donde no lo es y la orden se va a 'failed'
--    por saldo semanas después. El arreglo es pasar
--    `v_c.amount - v_c.consumed_amount` —lo que del regalo sigue sin
--    comprometer— y es idéntico para todo lo que existe hoy, porque en una
--    'mentoria' `consumed_amount` vale 0 al aplicarla.
-- 3. `src/components/checkout/selector-de-credito.tsx:296` auto-aplica
--    CUALQUIER crédito con `source='gift'`, y su comentario dice por qué: «no
--    tiene uso alternativo». Un bono SÍ lo tiene —se gasta por partes—, así que
--    tal cual está se comería parte del saldo en la primera reserva que el
--    alumno abra, sin preguntarle. Hay que excluir `kind='saldo'` (la RPC ya
--    devuelve `kind`; el `map` de :213 lo tira).
-- 4. `src/app/(app)/reservas/page.tsx:73` pinta la tarjeta «regalo pendiente de
--    agendar» para todo `source='gift'`. Un bono cae ahí con su producto ya
--    archivado, o sea en la rama `producto === null` de `regalo-recibido.tsx`,
--    que enseña «escribe a soporte». No es un 404, pero la verdad —«ahora es un
--    bono, gástalo con quien quieras»— es mejor que soporte.
--
-- ── REGLAS DE ORO ──────────────────────────────────────────────────────────
-- · Regla 12 · ninguna firma cambia: las dos funciones van por `create or
--   replace`. No hay `drop`, así que no hay `grant execute` que reponer, y
--   `account_deletion_blockers` —que deriva de `account_deletion_state`— no se
--   queda apuntando al vacío porque aquí no se toca ninguna de las dos.
-- · Regla 9 · NINGÚN `grant` nuevo sobre `public.credits`, y es deliberado.
--   `service_role` tiene ahí `select` Y NADA MÁS (`20260912110000:462`): la
--   escritura va por funciones `security definer`, que corren como el dueño y
--   se saltan los grants de tabla. Un `grant update` convertiría cualquier
--   Route Handler con `createAdminClient()` en una imprenta de créditos.
-- · Regla 11 · esto NO añade ningún job de `pg_cron`: cuelga de un trigger, o
--   sea que corre dentro de la transacción de la baja y falla RUIDOSAMENTE (se
--   lleva la baja entera por delante) en vez de quedarse mudo en
--   `cron.job_run_details`. Después de aplicar, en dev, la comprobación es la
--   baja de un tutor con un regalo vivo — está en `verificacionPendiente`.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · La conversión, colgada del rastro de la baja
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.convertir_regalos_en_bono()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_r record;
begin
  -- ⚠️ `with … update … returning` Y NO UN `for … in update` A SECAS: el FOR de
  -- plpgsql abre un portal, y un portal no admite una sentencia que escribe.
  -- Es el patrón de `caducar_creditos` (`20260912110000:3549`) y está copiado
  -- de ahí a propósito.
  --
  -- El filtro es el del regalo VIVO, el mismo que usa `account_deletion_state`
  -- para contar los regalos sin agendar (`20260912110000:3443`):
  --   · `kind='mentoria'`  → lo que todavía no es un bono. También hace la
  --     conversión idempotente: pasar dos veces no reconvierte nada ni reencola
  --     el aviso (y la clave de idempotencia lo remataría igualmente).
  --   · `amount > consumed_amount` → queda dinero dentro.
  --   · LA FECHA MANDA SOBRE EL ESTADO: `caducar_creditos` corre una vez al día
  --     (03:17), así que hay vencidos que siguen diciendo 'active'. Uno vencido
  --     no se convierte: ya no valía nada antes de que el tutor se fuera.
  for v_r in
    with a_bono as (
      update public.credits c
         set kind = 'saldo',
             -- Gracia de 30 días; nunca acorta, y nunca le pone plazo a lo que
             -- no lo tenía (ver el ⚠️ de `greatest` en la cabecera).
             expires_at = case
                            when c.expires_at is null then null
                            else greatest(c.expires_at, now() + interval '30 days')
                          end
       where c.source  = 'gift'
         and c.kind    = 'mentoria'
         and c.status  = 'active'
         and c.destino = 'cobro'
         and c.amount  > c.consumed_amount
         and (c.expires_at is null or c.expires_at > now())
         -- El tutor que se va es el DUEÑO DE LA MENTORÍA REGALADA, no el
         -- beneficiario del crédito: el beneficiario es el alumno que lo
         -- recibió, y su propia baja ya la cubre el bloqueo `accionable` de
         -- `account_deletion_state`. Se mira `products.tutor_id` y no
         -- `products.status`, porque para cuando este trigger corre
         -- `anonymize_account` ya las archivó todas (su §3.5 va antes que el
         -- insert de su §3.8).
         and exists (
               select 1 from public.products p
                where p.id = c.product_id and p.tutor_id = new.user_id)
      returning c.id, c.beneficiary_id, c.purchased_by, c.product_id,
                c.amount, c.consumed_amount, c.currency, c.expires_at
    )
    select * from a_bono
  loop
    -- `expires_at` sale del RETURNING, o sea YA con la gracia aplicada: es la
    -- fecha que el correo le va a prometer al destinatario.
    perform public.enqueue_notification(
      coalesce(v_r.beneficiary_id, v_r.purchased_by),
      'NTF-38', 'email', 'gift_converted',
      jsonb_build_object(
        'credit_id',  v_r.id,
        -- La mentoría que se regaló, para nombrarla («ya no está disponible»).
        -- ⚠️ La plantilla NO puede enlazarla: está archivada y su ficha da 404.
        'product_id', v_r.product_id,
        -- Lo que le queda por gastar, no lo que costó el regalo. Aquí el
        -- importe SÍ va al destinatario —al revés que en NTF-37, donde lo que
        -- otro pagó por ti no es asunto tuyo—: esto ya es saldo suyo y sin la
        -- cifra el correo no dice nada.
        'restante',   v_r.amount - v_r.consumed_amount,
        'currency',   v_r.currency,
        'expires_at', v_r.expires_at),
      'CRED:bono:' || v_r.id);
  end loop;

  return new;
end;
$fn$;

comment on function public.convertir_regalos_en_bono() is
  'Punto 9 · al anonimizarse un TUTOR, cada regalo vivo sobre sus mentorías pasa de kind=''mentoria'' a kind=''saldo'': deja de estar atado a su product_id y vale contra cualquier mentoría de la misma moneda, pagando el alumno la diferencia. Suma 30 días de gracia (nunca acorta) porque el destinatario perdió su plazo por un motivo que no es suyo, y avisa a coalesce(beneficiary_id, purchased_by). Cuelga de account_deletions y no de anonymize_account por lo mismo que purgar_navegacion_de_baja: no se reescriben doscientas líneas críticas para añadir un update.';

drop trigger if exists account_deletions_regalos_a_bono on public.account_deletions;
create trigger account_deletions_regalos_a_bono
  after insert on public.account_deletions
  for each row execute function public.convertir_regalos_en_bono();


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · La etiqueta: un bono no se llama «Regalo: <mentoría vieja>»
-- ════════════════════════════════════════════════════════════════════════════
--
-- `creditos_disponibles` es lo que pinta el selector del checkout, y su rama de
-- regalo compone «Regalo: » + el título del producto. Sobre un bono eso es
-- mentira en la única línea que el alumno lee antes de gastarlo: le nombra una
-- mentoría que ya no existe y que ya no es donde se gasta.
--
-- Se reemite ENTERA porque plpgsql no se parchea por líneas, con la MISMA FIRMA
-- → `create or replace` y sin `grant execute` que reponer (regla de oro 12). El
-- cuerpo sale del fichero de `20260912110000` y no de `pg_get_functiondef()`
-- porque nadie más la ha tocado desde entonces: `grep -rl creditos_disponibles
-- supabase/migrations/` devuelve esa sola migración. Lo único que cambia es la
-- primera rama del `case` de `etiqueta` y su comentario.
create or replace function public.creditos_disponibles(p_booking_id uuid)
returns table (
  credit_id uuid,
  kind      text,
  source    text,
  etiqueta  text,
  cubre     bigint,
  usable    boolean,
  motivo    text
)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_b   record;
  v_p   record;
  v_c   record;
  v_r   jsonb;
begin
  if v_uid is null then
    raise exception 'necesitas iniciar sesión' using errcode = '28000';
  end if;

  -- La reserva tiene que ser SUYA. Esta función es `definer`, así que la RLS no
  -- la está protegiendo: la comprobación es explícita.
  select b.id, b.product_id, b.num_sessions
    into v_b
  from public.bookings b
  where b.id = p_booking_id and b.student_id = v_uid;
  if v_b.id is null then
    raise exception 'reserva no encontrada' using errcode = 'no_data_found';
  end if;

  select p.gross_amount, p.currency, coalesce(p.credit_amount, 0) as credit_amount
    into v_p
  from public.payments p
  where p.booking_id = p_booking_id;

  for v_c in
    select c.id, c.kind, c.source, c.amount, c.consumed_amount, c.currency,
           c.product_id, c.referral_campaign_id, c.expires_at,
           pr.title as producto,
           rc.reward_text
      from public.credits c
      left join public.products pr            on pr.id = c.product_id
      left join public.referral_campaigns rc  on rc.rf_campaign_id = c.referral_campaign_id
     where c.beneficiary_id  = v_uid
       and c.status          = 'active'
       and c.destino         = 'cobro'
     order by c.expires_at nulls last, c.created_at
  loop
    v_r := public.credito_aplicable(
             v_c.kind, v_c.source, v_c.amount, v_c.consumed_amount,
             v_c.currency, v_c.product_id,
             v_p.gross_amount, v_b.num_sessions, v_p.currency, v_b.product_id);

    credit_id := v_c.id;
    kind      := v_c.kind;
    source    := v_c.source;
    etiqueta  := case
                   -- 🔴 EL BONO VA PRIMERO, y el orden es todo el arreglo: un
                   -- regalo convertido sigue siendo `source='gift'` —el dinero
                   -- lo puso un tercero y eso no cambia nunca— así que la rama
                   -- de abajo también casaría, y el `case` para en la primera.
                   -- Ya NO está atado a `product_id` (`credito_aplicable` ni lo
                   -- mira con kind='saldo'), o sea que nombrar la mentoría
                   -- vieja sería nombrar justo donde ya no se gasta.
                   when v_c.source = 'gift' and v_c.kind = 'saldo'
                     then 'Bono de tu regalo'
                   when v_c.source = 'gift'
                     then 'Regalo: ' || coalesce(v_c.producto, 'una mentoría')
                   when v_c.kind = 'mentoria'
                     then coalesce(nullif(btrim(v_c.reward_text), ''), 'Una mentoría gratis')
                   else coalesce(nullif(btrim(v_c.reward_text), ''), 'Saldo de tus invitaciones')
                 end;
    cubre     := (v_r ->> 'cubre')::bigint;
    usable    := (v_r ->> 'usable')::boolean;
    motivo    := v_r ->> 'motivo';

    -- ⚠️ LA FECHA MANDA SOBRE EL ESTADO, y aquí se ve por qué importa que esta
    -- función y `aplicar_credito` digan lo mismo: `caducar_creditos` corre a las
    -- 03:17, así que entre la medianoche y esa hora hay créditos vencidos que
    -- siguen diciendo 'active'. `aplicar_credito` ya los rechaza; si el selector
    -- los pintara usables, el alumno se comería un 500 en la pantalla de pagar.
    -- Se DEVUELVE con motivo, y no se omite, por la misma razón que la moneda
    -- distinta: un premio que desaparece sin explicación es una pregunta a
    -- soporte.
    if v_c.expires_at is not null and v_c.expires_at <= now() then
      usable := false;
      motivo := 'este crédito ha caducado';
    end if;

    return next;
  end loop;
end;
$fn$;

comment on function public.creditos_disponibles(uuid) is
  'Los créditos que el alumno puede aplicar a ESTA reserva, con cuánto cubre cada uno y por qué no se puede usar el que no se puede. Devuelve también los NO usables —moneda distinta, tope superado, regalo de otra mentoría, caducado— a propósito: un premio invisible es un premio que caduca sin que nadie sepa por qué. La caducidad se mira por FECHA y no por status: el barrido es diario (03:17) y hasta que pasa hay créditos vencidos que siguen diciendo active. Desde el punto 9, un regalo con kind=''saldo'' es un BONO —su tutor se dio de baja— y se etiqueta como tal: llamarlo «Regalo: <mentoría>» nombraría la única mentoría contra la que ya no sirve. ⚠️ No toma candados: dos pestañas pintan lo mismo y la segunda se cae en aplicar_credito, que es donde está el for update.';

-- Repetidos aunque un `create or replace` conserve los privilegios: es lo que
-- hace que el permiso se lea junto a la función y no dos migraciones atrás.
revoke execute on function public.creditos_disponibles(uuid) from public;
revoke execute on function public.creditos_disponibles(uuid) from anon;
grant  execute on function public.creditos_disponibles(uuid) to authenticated;
