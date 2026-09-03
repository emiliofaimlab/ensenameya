-- ============================================================================
-- Enséñame Ya — C2 · `manage_payout` v2: cerrar el ciclo a mano.
--
-- ── LO QUE PASABA ───────────────────────────────────────────────────────────
--
-- Desde C1 (`20260901120000`) **ningún camino alcanzable desde la aplicación
-- escribe `payouts.status = 'paid'`**. Y no es un olvido: C1 quitó el "pago"
-- falso a propósito —`process_scheduled_payouts()` marcaba 'paid' con
-- `provider='simulated'` sin llamar a nadie, y el trigger `notify_payout()`
-- mandaba al tutor el NTF-12 «Se pagó tu liquidación» por dinero que no se
-- movió— pero no puso nada en su lugar. El ejecutor de verdad
-- (`/api/cron/payouts-process`) sí cierra órdenes, y solo las que dLocal Go
-- confirma DELIVERED/COMPLETED. Todo lo demás —el 100 % de Venezuela, que es el
-- mercado principal y va por riel MANUAL; los ocho países mientras la decisión
-- del cambio siga abierta; cualquier tutor pagado por Zinli, Zelle o una
-- transferencia suelta— **no tiene forma de llegar a 'paid' desde el producto**.
--
-- `manage_payout(uuid, text)` (`20260716140000:220-266`) solo sabe mapear tres
-- transiciones: hold, release y retry. Su `case` no contempla 'paid' ni
-- 'processing'. O sea que la operativa que el documento de pagos pone como
-- **fase 1** —«payouts manuales operativos en Venezuela», lo primero de la
-- lista, por delante de cualquier integración— hoy termina en el panel del
-- banco y no vuelve nunca a esta base de datos.
--
-- Consecuencias medibles, no teóricas:
--   · El tutor ve su retiro «programado» para siempre. `payouts_en_curso` de
--     `account_deletion_blockers` cuenta 'scheduled', así que quien pida la baja
--     con un payout emitido **se queda desactivado indefinidamente** — la
--     cabecera de C1 lo aceptó a sabiendas «hasta que exista C2».
--   · NTF-12 no sale nunca. Al tutor al que se le pagó de verdad por Zelle no se
--     le avisa, porque el aviso cuelga de una transición que nadie escribe.
--   · `payouts_backlog()` (`20260901210000`) enseña la cola creciendo sin que
--     nada explique por qué: el dinero salió, la fila no se enteró.
--
-- ── Y LA FILA MÁS PELIGROSA DEL SISTEMA NO LA PODÍA TOCAR NADIE ─────────────
--
--     status = 'processing'  AND  provider_payout_id IS NULL
--
-- «Esta orden se reclamó, se le pudo pedir el pago al proveedor, y no sabemos si
-- lo creó». Existe porque `POST /v1/payouts` de dLocal Go **no tiene clave de
-- idempotencia de ninguna clase** y un 400 suyo puede haber creado el payout
-- igual. El ejecutor hace lo correcto —no reintenta, porque reintentar es elegir
-- pagar dos veces— y deja la fila quieta. `payouts_backlog()` la cuenta en
-- `sin_identificar` y la llama «la cifra que nunca puede quedarse arriba».
--
-- Pero **enseñarla no es resolverla**, y hasta hoy resolverla era entrar por el
-- SQL editor con `service_role` y escribir un `update` a mano sobre la tabla del
-- dinero. Eso es exactamente lo que la regla de oro 2 existe para impedir. Las
-- dos salidas que una persona necesita después de mirar el panel del PSP son
-- 'anotar' (existe, aquí está su id) y 'devolver' (no existe, vuelve a la cola),
-- y ninguna de las dos estaba escrita.
--
-- ── LO QUE HACE ESTA MIGRACIÓN ──────────────────────────────────────────────
--
-- Una sola función `manage_payout` con SIETE acciones. Las tres viejas siguen
-- (una de ellas, arreglada) y entran cuatro:
--
--   | acción      | desde                      | a           | exige            |
--   | :---------- | :------------------------- | :---------- | :--------------- |
--   | hold        | pending·scheduled·failed   | on_hold     | —                |
--   | release     | on_hold                    | scheduled   | —                |
--   | retry       | failed                     | scheduled   | — (ver abajo)    |
--   | mark_paid   | scheduled·failed·on_hold   | paid        | p_referencia     |
--   | anotar      | processing                 | paid        | p_referencia     |
--   | devolver    | processing                 | scheduled   | la contraseña    |
--
-- ⚠️ ESTA MIGRACIÓN NO CAMBIA EL PANEL. `src/app/(app)/admin/payouts/
-- payout-actions.tsx` mapea hoy `paid: []` y `processing: []`, así que las filas
-- en vuelo siguen sin un solo botón hasta que ese fichero —que es de otro
-- agente— ofrezca las acciones nuevas y pida la referencia. Lo que sí cambia es
-- que a partir de aquí **existe una puerta legítima**: soporte puede cerrar un
-- payout por RPC en vez de por `update` a pelo.
--
-- ── ⚠️ SÍ, DISPARA NTF-12. NO LO "ARREGLES". ────────────────────────────────
--
-- `notify_payout()` (`20260716170000:177-180`) encola «Se pagó tu liquidación»
-- en cuanto `status` pasa a 'paid', y con el job de correo vivo desde el 30-ago
-- ese correo SALE. Aquí eso es lo correcto y es el motivo de la acción: quien
-- pulsa 'mark_paid' o 'anotar' es una persona que acaba de ver el movimiento en
-- el panel del banco o del PSP. **El dinero se movió de verdad**, así que
-- decirlo no es mentir — es justo lo contrario de lo que hacía
-- `process_scheduled_payouts()`, que lo decía sola y sin haber llamado a nadie.
--
-- La diferencia no está en el trigger, está en quién escribe 'paid': antes, un
-- cron cada 10 minutos sobre todo lo que tuviera fecha vencida; ahora, un admin
-- que tiene que teclear la referencia del movimiento. Si algún día alguien
-- quiere silenciar el correo de esta ruta, que sepa que estaría quitándole el
-- aviso a los ÚNICOS tutores a los que hoy se les paga de verdad.
--
-- ── SOBRE `provider = 'manual'` Y EL ENUM ───────────────────────────────────
--
-- Verificado antes de escribir una línea: `public.payout_status` sigue teniendo
-- exactamente los seis valores con los que nació
-- (`20260716140000:20-22` → pending, scheduled, processing, paid, failed,
-- on_hold) y NINGUNA migración posterior le ha añadido nada
-- (`grep -rn "add value" supabase/migrations/` devuelve un único resultado, y es
-- de `document_status`).
--
-- **Y no hay que añadirle 'manual'.** 'manual' es un PROVEEDOR, no un estado: va
-- en `payouts.provider`, que es `text` libre y está descrito como «quién lo
-- SACÓ» (`20260901130000`). Un payout pagado por Zelle está 'paid' igual que uno
-- pagado por dLocal Go; lo que cambia es la columna de al lado. Meterlo en el
-- enum crearía un estado terminal paralelo a 'paid' que ni `notify_payout()`, ni
-- `account_deletion_blockers`, ni `payouts_backlog()`, ni el clawback de S-29
-- sabrían leer — seis sitios aprendiendo un séptimo estado para no decir nada
-- que la columna `provider` no diga ya.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · LA TRAMPA DE LA FIRMA, QUE VA PRIMERO PORQUE SI FALLA NO SE VE
-- ════════════════════════════════════════════════════════════════════════════
--
-- `create or replace` con cuatro argumentos **NO sustituye** a la de dos: en
-- Postgres la firma es parte de la identidad, así que quedarían DOS overloads
-- vivas. Y la vieja conserva su `grant execute … to authenticated`
-- (`20260716140000:266`), o sea que seguiría siendo invocable.
--
-- El fallo que eso produce es de los que no se ven: PostgREST resuelve el
-- `.rpc("manage_payout", {p_payout_id, p_action})` del panel por los nombres de
-- los argumentos, y con dos candidatas compatibles puede quedarse con la de dos
-- — que no conoce 'mark_paid'. El admin pulsaría «Marcar pagado» y recibiría
-- «acción "mark_paid" no válida», con la función nueva aplicada y correcta.
--
-- Así que se tira la vieja. `if exists` porque una migración tiene que poder
-- correr sobre un ambiente que ya la perdió.
drop function if exists public.manage_payout(uuid, text);


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · LA FUNCIÓN
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.manage_payout(
  p_payout_id  uuid,
  p_action     text,
  p_referencia text default null,   -- id/comprobante del movimiento real
  p_canal      text default null    -- 'zelle', 'zinli', 'binance', 'wise'…
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status  public.payout_status;
  v_old_id  text;
  v_meta    jsonb;
  v_c2      jsonb;
  v_intento int;
  -- La referencia se normaliza UNA vez: '   ' es tan vacío como null, y un
  -- espacio de más al pegar desde el panel del banco no puede ser la diferencia
  -- entre cerrar un payout y no cerrarlo.
  v_ref     text := nullif(btrim(coalesce(p_referencia, '')), '');
  v_canal   text := nullif(btrim(coalesce(p_canal, '')), '');
begin
  if not public.has_role('admin') then
    raise exception 'solo un admin gestiona payouts' using errcode = 'insufficient_privilege';
  end if;

  select p.status, p.provider_payout_id, coalesce(p.provider_metadata, '{}'::jsonb)
    into v_status, v_old_id, v_meta
    from public.payouts p
   where p.id = p_payout_id;

  if v_status is null then
    raise exception 'payout no encontrado' using errcode = 'no_data_found';
  end if;

  -- El rastro que deja el ejecutor (`route.ts` → `Rastro`). Se lee aquí porque
  -- dos de las acciones tienen que tocarlo, y se lee con `coalesce` en cada
  -- salto porque una fila creada por el lote no lo tiene todavía.
  v_c2      := coalesce(v_meta -> 'c2', '{}'::jsonb);
  v_intento := coalesce(nullif(v_c2 ->> 'intento', '')::int, 1);

  -- ── 'mark_paid' · el ciclo se cierra a mano ───────────────────────────────
  --
  -- Es la acción de la fase 1 del plan de pagos: Venezuela entera y cualquier
  -- riel sin adaptador (PayPal, Airtm, Wise: no hay cuenta, y sin cuenta no hay
  -- sandbox que pruebe nada, así que no se escriben adaptadores). El admin paga
  -- por fuera, vuelve y lo anota.
  --
  -- Desde 'on_hold' y desde 'failed' también, y no es un descuido: un payout
  -- retenido por una duda que se aclaró pagando, o uno que el PSP rechazó y se
  -- acabó pagando por otro canal, son los dos casos reales de soporte. Lo que NO
  -- se acepta es 'processing' — para eso está 'anotar', que es otra
  -- conversación (ahí la duda es si el proveedor cobró, no si pagamos nosotros).
  if p_action = 'mark_paid' then
    if v_status not in ('scheduled'::public.payout_status,
                        'failed'::public.payout_status,
                        'on_hold'::public.payout_status) then
      raise exception 'mark_paid no es válido desde el estado %: solo desde scheduled, failed u on_hold', v_status
        using errcode = 'check_violation';
    end if;
    if v_ref is null then
      raise exception 'mark_paid exige una referencia del movimiento real (id de la transferencia, del envío de Zelle/Zinli o del payout del proveedor): es lo único que permitirá reconciliar este payout con el extracto'
        using errcode = 'check_violation';
    end if;

    update public.payouts
       set status             = 'paid'::public.payout_status,
           provider           = coalesce(v_canal, 'manual'),
           provider_payout_id = v_ref,
           paid_at            = now(),
           -- El cadáver del intento anterior se limpia: esta orden ya no está
           -- fallida, y dejar `failure_reason` puesto sobre una fila 'paid' es
           -- pedir que alguien la lea mal dentro de seis meses.
           failed_at          = null,
           failure_reason     = null
     where id = p_payout_id;
    return 'paid';

  -- ── 'anotar' · processing → paid, con el id que se encontró en el panel ───
  --
  -- La mitad buena de la fila peligrosa: el admin buscó `EY-<payouts.id>-<intento>`
  -- en el panel del PSP, lo encontró y el pago está hecho. Se adopta el id y se
  -- cierra. `provider` se conserva —lo escribió el ejecutor al reclamar la orden
  -- y dice quién la sacó de verdad— salvo que se pase un canal distinto.
  elsif p_action = 'anotar' then
    if v_status <> 'processing'::public.payout_status then
      raise exception 'anotar solo es válido desde processing (una orden en vuelo), y este payout está %', v_status
        using errcode = 'check_violation';
    end if;
    if v_ref is null then
      raise exception 'anotar exige el identificador que el proveedor da al payout: es la marca con la que se buscó y sin ella no se está anotando nada, se está adivinando'
        using errcode = 'check_violation';
    end if;

    update public.payouts
       set status             = 'paid'::public.payout_status,
           provider           = coalesce(v_canal, provider, 'manual'),
           provider_payout_id = v_ref,
           paid_at            = now(),
           failed_at          = null,
           failure_reason     = null
     where id = p_payout_id;
    return 'paid';

  -- ── 'devolver' · processing → scheduled ───────────────────────────────────
  --
  -- 🔴 LA ACCIÓN MÁS PELIGROSA DE TODO EL SISTEMA, y conviene decirlo con todas
  -- las letras: **devolver a la cola algo que quizá se pagó es elegir pagar dos
  -- veces**. No hay deshacer. El dinero sale del balance del PSP y el segundo
  -- envío es tan real como el primero.
  --
  -- Solo se usa DESPUÉS de haber comprobado en el panel del proveedor que **no
  -- existe nada** con la marca `EY-<payouts.id>-<intento>` — esa cadena viaja en
  -- el `description` de cada `POST /v1/payouts` justamente para que esta
  -- comprobación sea un sí o un no, y no un «se le parece» por importe y fecha.
  -- El intento vive en `provider_metadata -> 'c2' -> 'intento'` (1 si no está).
  -- Si la búsqueda no es concluyente, la respuesta correcta es **no hacer nada**
  -- y dejar la fila en 'processing': ahí la sigue contando `payouts_backlog()`
  -- en `sin_identificar`, que es incómodo a propósito.
  --
  -- La confirmación explícita va en la firma y no en un `p_confirmo boolean`
  -- porque un booleano se pone a true sin leer nada. Escribir la palabra obliga
  -- a haber pasado por este comentario o por el mensaje del error.
  elsif p_action = 'devolver' then
    if v_status <> 'processing'::public.payout_status then
      raise exception 'devolver solo es válido desde processing, y este payout está %', v_status
        using errcode = 'check_violation';
    end if;
    if v_ref is distinct from 'COMPROBADO-SIN-RASTRO' then
      raise exception 'devolver un payout a la cola es elegir pagar dos veces si el proveedor sí lo creó. Busca la marca EY-%-% en el panel del proveedor y, SOLO si no existe nada con esa marca, vuelve a llamar con p_referencia => ''COMPROBADO-SIN-RASTRO''', p_payout_id, v_intento
        using errcode = 'check_violation';
    end if;

    -- Si arrastraba un identificador, se archiva y se sube el intento antes de
    -- soltarlo. Es lo mismo que hace el caso `difunto` del ejecutor y por el
    -- mismo motivo: la marca tiene que CAMBIAR cuando la orden se queda sin id,
    -- o el barrido del intento siguiente encontraría el payout del anterior y lo
    -- adoptaría como propio.
    if v_old_id is not null then
      v_c2 := jsonb_set(
                jsonb_set(v_c2, '{intento}', to_jsonb(v_intento + 1)),
                '{intentos_muertos}',
                coalesce(v_c2 -> 'intentos_muertos', '[]'::jsonb) || to_jsonb(v_old_id)
              );
    end if;

    update public.payouts
       set status             = 'scheduled'::public.payout_status,
           provider           = null,          -- nadie la sacó: vuelve a la cola
           provider_payout_id = null,
           provider_metadata  = jsonb_set(v_meta, '{c2}', v_c2),
           scheduled_for      = now(),
           failed_at          = null,
           failure_reason     = null
     where id = p_payout_id;
    return 'scheduled';

  -- ── 'retry' · failed → scheduled, PERO LIMPIA ─────────────────────────────
  --
  -- 🔴 ESTO ERA UN BUCLE SILENCIOSO. La versión vieja (`20260716140000:252`)
  -- movía failed → scheduled y **no tocaba nada más**: dejaba dentro el
  -- `provider_payout_id` del payout rechazado, `failed_at` y `failure_reason`.
  -- El ejecutor recogía la fila, veía que traía identidad, preguntaba por ella,
  -- el proveedor repetía que estaba muerta y la orden volvía a 'failed'. El
  -- admin pulsaba, el job lo deshacía, y nadie veía por qué.
  --
  -- Se limpian las tres. Y se archiva el id muerto subiendo el intento, en vez
  -- de borrarlo: es la única traza que queda para conciliar ese rechazo contra
  -- el panel del proveedor, y subir el intento es lo que garantiza que la orden
  -- nueva salga con una marca distinta de la del cadáver.
  --
  -- ⚠️ NOTA PARA QUIEN TOQUE EL EJECUTOR. `dlocal-provider.ts` tiene un «camino
  -- 1b · reintento de admin» que existía precisamente porque este botón NO
  -- limpiaba: ante una fila 'scheduled' con id, le pregunta al proveedor y, si
  -- confirma que está muerto, devuelve `difunto` para archivarlo él. Ese camino
  -- se queda —es la red por si una fila llega a 'scheduled' con id por otra vía,
  -- y una consulta no mueve dinero— pero **deja de ser la ruta normal**. Que se
  -- pueda limpiar aquí sin preguntar depende de un invariante que el propio
  -- ejecutor sostiene: `failed` lo escribe SOLO un rechazo del proveedor, nunca
  -- una decisión nuestra de no mandar. El día que alguien escriba 'failed' por
  -- otra cosa, esta limpieza deja de ser segura.
  elsif p_action = 'retry' then
    if v_status <> 'failed'::public.payout_status then
      raise exception 'retry solo es válido desde failed, y este payout está %', v_status
        using errcode = 'check_violation';
    end if;

    if v_old_id is not null then
      v_c2 := jsonb_set(
                jsonb_set(v_c2, '{intento}', to_jsonb(v_intento + 1)),
                '{intentos_muertos}',
                coalesce(v_c2 -> 'intentos_muertos', '[]'::jsonb) || to_jsonb(v_old_id)
              );
    end if;

    update public.payouts
       set status             = 'scheduled'::public.payout_status,
           provider           = null,
           provider_payout_id = null,
           provider_metadata  = jsonb_set(v_meta, '{c2}', v_c2),
           scheduled_for      = now(),
           failed_at          = null,
           failure_reason     = null
     where id = p_payout_id;
    return 'scheduled';

  -- ── 'hold' y 'release' · sin cambios ──────────────────────────────────────
  --
  -- Se reescriben tal cual estaban, con las mismas guardas. 'processing' sigue
  -- fuera de 'hold' a propósito: una orden en vuelo no se retiene retocando una
  -- fila nuestra —el proveedor no se entera—, se resuelve con 'anotar' o con
  -- 'devolver' según lo que diga su panel.
  elsif p_action = 'hold' then
    if v_status not in ('pending'::public.payout_status,
                        'scheduled'::public.payout_status,
                        'failed'::public.payout_status) then
      raise exception 'hold no es válido desde el estado %', v_status
        using errcode = 'check_violation';
    end if;
    update public.payouts
       set status = 'on_hold'::public.payout_status
     where id = p_payout_id;
    return 'on_hold';

  elsif p_action = 'release' then
    if v_status <> 'on_hold'::public.payout_status then
      raise exception 'release solo es válido desde on_hold, y este payout está %', v_status
        using errcode = 'check_violation';
    end if;
    update public.payouts
       set status        = 'scheduled'::public.payout_status,
           scheduled_for = now()
     where id = p_payout_id;
    return 'scheduled';

  else
    raise exception 'acción "%" desconocida: hold, release, retry, mark_paid, anotar o devolver', p_action
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.manage_payout(uuid, text, text, text) is
  'C2 v2 (2026-09-02): la ÚNICA puerta del producto a los estados terminales de un payout. Siete acciones: hold/release (sin cambios), retry (failed→scheduled, ahora LIMPIANDO provider_payout_id/failed_at/failure_reason y archivando el id muerto con intento+1 — antes lo dejaba dentro y el ejecutor volvía a marcar failed en bucle), mark_paid (scheduled|failed|on_hold→paid, exige referencia; es el riel MANUAL de Venezuela y de todo lo que no tiene adaptador), anotar (processing→paid con el id encontrado en el panel del PSP) y devolver (processing→scheduled, exige la contraseña COMPROBADO-SIN-RASTRO porque devolver a la cola algo que quizá se pagó es elegir pagar dos veces). ⚠️ mark_paid y anotar disparan NTF-12 «Se pagó tu liquidación» vía notify_payout(), y eso es CORRECTO: aquí el dinero se movió de verdad y lo confirma una persona — no se silencie. La firma vieja de dos argumentos se tiró en esta misma migración: dos overloads harían que PostgREST pudiera resolver el .rpc() a la que no conoce las acciones nuevas.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · GRANTS (regla de oro 9, que ya mordió tres veces el 6-ago)
-- ════════════════════════════════════════════════════════════════════════════
--
-- El `drop` se llevó por delante el `grant execute … to authenticated` de la
-- firma vieja, así que hay que volver a concederlo. Y en Postgres el EXECUTE de
-- una función nueva se concede a PUBLIC por defecto, que con PostgREST significa
-- `POST /rest/v1/rpc/manage_payout` abierto a `anon`: las cuatro líneas de
-- siempre, y aquí más que en ninguna otra función del proyecto.
--
-- `authenticated` y no `service_role` porque quien la llama es el panel de
-- admin desde el navegador; el rol se comprueba DENTRO (`has_role('admin')`),
-- que es el patrón de todo el proyecto.
revoke execute on function public.manage_payout(uuid, text, text, text) from public;
revoke execute on function public.manage_payout(uuid, text, text, text) from anon;
grant  execute on function public.manage_payout(uuid, text, text, text) to authenticated;

-- ── ¿Hacen falta grants de TABLA sobre `payouts`? NO, y conviene saber por qué
--
-- Comprobado contra `20260716140000` y `20260901130000` antes de escribir nada.
-- Esta función es `security definer`: corre como su dueño, que es quien aplica
-- las migraciones y sí tiene privilegios sobre `public.payouts`. El agujero de
-- la regla de oro 9 es el otro caso —un cliente `service_role` desde un Route
-- Handler, que se salta la RLS pero NO los grants de tabla— y ese ya está
-- cubierto por `20260901130000:277-318`: `select` sobre `payouts` y
-- `payout_items`, más `update` por columnas de status, provider,
-- provider_payout_id, provider_metadata, paid_at, failed_at y failure_reason.
--
-- 🔑 Y hay un detalle que explica por qué esto tiene que ser una RPC y no un
-- PATCH desde un Handler: **`scheduled_for` NO está en ese grant de columnas**,
-- a propósito («eso lo congela `build_payout_for_tutor` y el ejecutor no tiene
-- por qué poder moverlo; si algún día hay que corregirlo, es una RPC de admin,
-- no un UPDATE suelto»). `retry`, `release` y `devolver` lo escriben — o sea que
-- son exactamente la RPC de admin que aquel comentario anticipaba.

-- ponytail: TECHO ACEPTADO — esta función no registra QUIÉN pulsó. No hay tabla
-- de auditoría de acciones de admin en el proyecto, y no se crea una para esto:
-- la traza que queda es `provider_payout_id` (la referencia que el admin tuvo
-- que teclear), `provider` (el canal), `paid_at` y el `updated_at` que bumpea
-- `payouts_set_updated_at`. Con eso se reconcilia contra el extracto, que es el
-- caso de uso real. Lo que NO se puede responder es «¿quién marcó esto pagado?»,
-- y con dinero de por medio esa pregunta acabará apareciendo. El día que
-- aparezca, el sitio es una tabla `admin_actions` que sirva también a
-- `20260828130000` (acciones sobre usuarios) y a la cola de reportes — no un
-- campo suelto aquí.
--
-- ponytail: SEGUNDO TECHO — `p_referencia` no se valida contra ningún formato.
-- No puede: es un id de dLocal Go, o el de una transferencia SWIFT, o el número
-- de confirmación de Zelle, o «captura del 2-sep en el grupo». Cualquier `check`
-- que se inventara aquí rechazaría un cobro legítimo por no parecerse a lo que
-- esperaba quien lo escribió. Lo único que se exige es que no esté vacía.


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · CINCO COMENTARIOS QUE MANDAN A UNA FUNCIÓN QUE NO EXISTE
-- ════════════════════════════════════════════════════════════════════════════
--
-- Las migraciones son inmutables (regla de oro 5), así que la corrección se
-- escribe AQUÍ y no editando aquellos ficheros. Cinco comentarios de dos
-- migraciones de esta misma semana nombran **`admin_payout_action`**, que **NO
-- EXISTE**: `grep -rn "admin_payout_action" supabase/ src/` devuelve esos cinco
-- comentarios y ni una sola definición ni una sola llamada. La función real se
-- llama **`public.manage_payout`** — la que redefine esta migración.
--
--   · `20260831160000_baja_programada_con_dinero_en_vuelo.sql:60`
--       dice: «'failed' y 'on_hold' NO: necesitan a un admin
--              (`admin_payout_action` 'retry'/'release')»
--       real: `manage_payout(id, 'retry')` / `manage_payout(id, 'release')`.
--
--   · `20260831160000:330`
--       dice: «dinero que se le debe y que espera un `admin_payout_action('retry')`»
--       real: `manage_payout(id, 'retry')`.
--
--   · `20260831160000:759`
--       dice: «un payout en 'failed' o en 'on_hold' que necesita un
--              `admin_payout_action`»
--       real: `manage_payout`.
--
--   · `20260901160000_datos_de_cobro_del_tutor.sql:1042`
--       dice: «ninguna tarea de admin sobre payouts necesita el número de
--              cuenta: `admin_payout_action` mueve estados»
--       real: `manage_payout` mueve estados. Y el razonamiento **sigue siendo
--              correcto con la v2**: ninguna de las cuatro acciones nuevas lee
--              `tutor_payout_accounts`. El admin teclea una referencia que ya
--              tiene delante en el panel del banco; no necesita el IBAN.
--
--   · `20260901160000:1862`
--       dice: «Y `failed` no se resuelve solo: exige un `admin_payout_action`»
--       real: `manage_payout(id, 'retry')` — o, desde hoy,
--              `manage_payout(id, 'mark_paid', '<referencia>')` si al final se
--              pagó por otro canal. Eso **cierra el interbloqueo** que aquel
--              comentario describía: un tutor con la baja pedida y un payout en
--              'failed' ya tiene salida sin tocar SQL a mano.
--
-- El patrón que hay detrás, para no repetirlo: los cinco se escribieron
-- razonando sobre lo que la función HACE («una acción de admin sobre un payout»)
-- en vez de sobre cómo se LLAMA. Un nombre inventado en un comentario no rompe
-- ningún build, no lo ve el typecheck y sobrevive a cualquier revisión — igual
-- que `ref_email` sobrevivió en cuatro documentos.


-- ════════════════════════════════════════════════════════════════════════════
-- 5 · LO QUE HAY QUE MIRAR EL DÍA QUE ESTO SE APLIQUE (regla de oro 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ NO APLICADA. Se escribió sin `db:push` (el encargo lo prohibía), así que
-- `create or replace` ni siquiera ha validado su sintaxis contra el servidor.
--
-- a) Que queda UNA sola firma. Si salen dos filas, el `drop` no se aplicó y el
--    panel puede estar llamando a la vieja:
--
--      select p.oid::regprocedure
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname = 'manage_payout';
--
-- b) Que el cuerpo corre de verdad, que es lo único que `create or replace` NO
--    comprueba. Con la sesión de un admin, sobre un payout cualquiera y sin
--    tocar dinero — se busca el error de guarda, no el éxito:
--
--      select public.manage_payout(
--               (select id from public.payouts where status = 'scheduled' limit 1),
--               'mark_paid');
--      -- esperado: «mark_paid exige una referencia del movimiento real…»
--
-- c) Que los dos pg_cron de payouts no se han roto por el camino. `manage_payout`
--    no cuelga de ninguno, pero comparte tabla con los dos y esta migración toca
--    columnas que ellos leen. **Agregando por jobname**, que leer las diez
--    últimas filas de `cron.job_run_details` solo enseña los jobs frecuentes y
--    `run-payout-batch` corre una vez por semana:
--
--      select j.jobname, d.status, count(*), max(d.start_time), max(d.return_message)
--        from cron.job_run_details d join cron.job j using (jobid)
--       where j.jobname in ('run-payout-batch', 'process-payouts')
--       group by 1, 2;
--
-- d) Que la cifra que nunca puede quedarse arriba baja cuando se usa 'anotar' o
--    'devolver':
--
--      select public.payouts_backlog();
--      -- mirar `sin_identificar` antes y después.
