-- ════════════════════════════════════════════════════════════════════════════
-- EL RECLAMO TIENE SU PROPIO CORREO · se acabó el NTF-35 por duplicado
-- ════════════════════════════════════════════════════════════════════════════
--
-- 🔴 EL DUPLICADO LO INTRODUJIMOS NOSOTROS EL 16-sep-2026, arreglando otra cosa.
--
-- Antes: a quien recibía un regalo SIN tener cuenta no le llegaba ningún correo
-- al comprarse —`confirm_gift_payment` encola NTF-35 contra un `recipient_id`
-- que ahí todavía es null, y `enqueue_notification` con null se va sin hacer
-- nada (`20260716170000:62`)—. Su único correo era éste, el del reclamo, al
-- registrarse. Un correo, y NTF-35 valía.
--
-- El 16-sep se tapó ese agujero real: el webhook manda NTF-35 DIRECTO por Resend
-- a la bandeja sin cuenta (`src/lib/regalo-aviso.ts`, llamado desde los webhooks
-- de Stripe y dLocal). Pero ese envío no pasa por `notifications`, así que no
-- hereda la `idempotency_key` de la cola: al registrarse, este bucle encolaba
-- otra vez NTF-35 con `GIFT:recv:<id>` y salía el MISMO correo por segunda vez.
--
-- ⚠️ Y el segundo llevaba una instrucción FALSA: «crea tu cuenta con esta misma
--    dirección», a alguien que la acababa de crear. Eso no era culpa del
--    duplicado —ya pasaba antes, cuando el reclamo era el único correo— y se
--    arregla con el mismo cambio.
--
-- Así que el reclamo pasa a tener su propia plantilla, **NTF-39
-- `gift_claimed`** («tu regalo ya está en tu cuenta»), con su propia clave de
-- idempotencia. NTF-35 se queda para lo que siempre fue: «te han regalado una
-- mentoría, ven a por ella».
--
-- ── LA OTRA SALIDA Y POR QUÉ NO ────────────────────────────────────────────
--
-- Se podía haber quitado este `enqueue_notification` a secas, dejando solo el
-- del webhook. Es una línea menos y tiene un agujero: si el envío directo falla
-- —Resend caído, un 4xx, la clave sin poner— NADIE vuelve a intentarlo, porque
-- ese camino no tiene cola ni reintento (lo dice `regalo-aviso.ts`: registra y
-- sigue, a propósito). El reclamo es la segunda oportunidad de que esa persona
-- se entere, y ahora además dice la verdad del momento en que ocurre.
--
-- ── REGLAS DE ORO ──────────────────────────────────────────────────────────
-- · Regla 5 · esto es una MIGRACIÓN, no un `UPDATE` en la nube.
-- · Regla 12 · la firma NO cambia (`reclamar_regalos_por_correo(uuid)`), así que
--   va por `create or replace` y NO hay `grant execute` que reponer. Lo que
--   obliga `create or replace` es a volcar el cuerpo ENTERO: las 47 líneas de
--   abajo son copia literal de `20260912110000` con **un solo `perform`
--   cambiado**. Cualquier otra diferencia que se vea al revisar es un error de
--   copia. Comprobado con un diff antes de escribir esto: la única diferencia
--   está marcada con 🔴.
-- · Regla 11 · esto no cuelga de `pg_cron`: lo llaman el trigger de la
--   confirmación del correo y `reclamar_mis_regalos()`, que corre cuando
--   `/reservas` se pinta. O sea que se prueba entrando, no mirando
--   `cron.job_run_details`.
--
-- ⚠️ ORDEN DE DESPLIEGUE: **Vercel primero, `db:push` después.** Si esta
--    migración llega a un entorno cuyo código todavía no tiene `gift_claimed` en
--    `src/lib/email-templates.ts`, `renderEmail()` devuelve null y el job marca
--    la fila `failed`, que NO se reintenta sola. Y no lo dice nadie: no hay
--    build en rojo ni 500, solo se mueve el contador `fallosPermanentes` del
--    JSON del cron.
--
--    ⚠️ «Permanente» es lo que hace el job, no lo que impone la clave. La fila
--    YA EXISTE con su `GIFT:claim:<id>`, así que lo que no se puede es
--    RE-ENCOLARLA —`enqueue_notification` haría `on conflict do nothing`—, pero
--    la de siempre se revive con un `update`. El rescate, si llega a pasar:
--
--      update public.notifications
--         set status = 'pending', sent_at = null
--       where template = 'gift_claimed' and status = 'failed';
--
--    Se dice aquí porque el día que ocurra, quien lo mire va a estar buscando
--    justo esto y va a encontrar antes la palabra «permanente».
-- ════════════════════════════════════════════════════════════════════════════


create or replace function public.reclamar_regalos_por_correo(p_user uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_correo text;
  v_n      int := 0;
  v_r      record;
begin
  select lower(btrim(u.email)) into v_correo
    from auth.users u
   where u.id = p_user
     and u.email_confirmed_at is not null;   -- ← el cerrojo entero

  if v_correo is null then
    return 0;
  end if;

  -- El perfil tiene que existir: `credits.beneficiary_id` es FK contra él.
  if not exists (select 1 from public.profiles pr where pr.id = p_user) then
    return 0;
  end if;

  for v_r in
    update public.credits c
       set beneficiary_id = p_user
     where c.beneficiary_id is null
       and c.source = 'gift'
       and c.beneficiary_email = v_correo
       and c.status in ('pending_payment', 'active')
    returning c.id, c.status, c.product_id, c.gift_message
  loop
    v_n := v_n + 1;
    if v_r.status = 'active' then
      -- 🔴 NTF-39 Y NO NTF-35, y este es todo el cambio de la migración.
      --
      --    Aquí decía `'NTF-35', 'gift_received'` con la clave `GIFT:recv:`, y
      --    el comentario que lo acompañaba —«misma clave que
      --    confirm_gift_payment: no duplica»— era CIERTO hasta el 16-sep-2026,
      --    por un motivo que ese día dejó de valer: a quien no tenía cuenta no
      --    le llegaba nada al comprarse el regalo (`enqueue_notification` con
      --    `recipient_id` null se va sin hacer nada), así que este era su ÚNICO
      --    correo y el texto de NTF-35 encajaba de casualidad.
      --
      --    El 16-sep se tapó ese agujero: el webhook manda NTF-35 directo por
      --    Resend a la bandeja sin cuenta (`src/lib/regalo-aviso.ts`). Ese
      --    envío NO pasa por `notifications` y por tanto NO comparte esta
      --    clave, así que esto volvía a mandar el mismo correo: dos veces «Te
      --    han regalado una mentoría», y la segunda pidiéndole crear una cuenta
      --    a quien la acababa de crear.
      --
      --    NTF-39 es el correo de ESTE momento: ya hay cuenta, ya está
      --    confirmada y el regalo ya está atado. Lo único que queda es elegir
      --    el día.
      --
      -- ⚠️ CLAVE PROPIA (`GIFT:claim:`), no la de NTF-35. Dos plantillas
      --    distintas no comparten idempotencia: compartirla haría que el día
      --    que una de las dos vuelva a encolarse por otro camino, la otra se
      --    tragara el aviso en silencio. Y aquí no hace falta para nada — este
      --    bucle solo ve filas que ACABA de atar (`beneficiary_id is null` en
      --    el `where` del propio `update`), así que corre una vez por regalo.
      perform public.enqueue_notification(
        p_user, 'NTF-39', 'email', 'gift_claimed',
        jsonb_build_object('credit_id', v_r.id, 'product_id', v_r.product_id,
                           'gift_message', v_r.gift_message),
        'GIFT:claim:' || v_r.id);
    end if;
  end loop;

  return v_n;
end;
$fn$;

comment on function public.reclamar_regalos_por_correo(uuid) is
  'Ata a su dueño los regalos comprados a un correo que hasta ahora no tenía cuenta, y le manda NTF-39 (gift_claimed) por cada uno que ya esté pagado. Exige email_confirmed_at: atar un regalo pagado a una dirección sin probar es regalárselo a quien la escriba primero. ⚠️ NTF-39 y NO NTF-35: desde el 16-sep-2026 el aviso de «te han regalado una mentoría» lo manda el webhook directo por Resend en cuanto se cobra, así que repetirlo aquí eran dos correos iguales y el segundo pedía crear una cuenta a quien acababa de crearla. La llaman el trigger de la confirmación y reclamar_mis_regalos().';
