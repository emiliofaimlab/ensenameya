-- ============================================================================
-- Enséñame Ya — C2m · Venezuela deja de ser «no se puede pagar» y pasa a ser
-- «se paga a mano».
--
-- La fila de ruteo de VE dice hoy `payout_provider = 'simulated'`, y cuando A0
-- la escribió (`20260901140000:288-302`) era la verdad exacta: allí no
-- transfiere ni dLocal Go ni Stripe, y lo que había era un formulario bancario
-- que no podía guardar nada porque `payout_country_rules` no tiene fila VE.
--
-- Desde el 2-sep ya no es la verdad. `20260902110000` creó el sitio donde el
-- tutor venezolano dice a dónde cobrar (`tutor_manual_payout_destinations`, con
-- sus cinco canales) y `20260902120000` le dio al admin la acción con la que
-- cerrar la orden cuando la paga a mano (`manage_payout(id,'mark_paid',…)`). O
-- sea: el riel existe entero, de punta a punta, y lo único que sigue diciendo lo
-- contrario es esta tabla. 'simulated' ahí ya no significa «no hay a dónde»:
-- significa «no lo hemos escrito».
--
-- ── LA VÍA OBVIA ERA LA MALA, Y POR ESO ESTA MIGRACIÓN NO VA SOLA ──────────
--
-- `payout_provider` es texto libre sin `check` (`20260709160000:18`) y
-- `service_role` tiene `grant update (charge_provider, payout_provider,
-- is_active)` (`20260806180000:24-26`), así que poner 'manual' aquí parece un
-- `UPDATE` y ya está. No lo es: `payoutCountries()` (`src/lib/payments.ts`)
-- ofrecía al tutor TODO país cuyo `payout_provider` no fuese 'simulated'. Con
-- este `UPDATE` a secas, Venezuela habría aparecido en su desplegable y el
-- formulario bancario de B1 habría intentado guardar contra
-- `payout_country_rules` / `payout_banks`, que no tienen ni una fila VE: FK
-- violada, sin mensaje útil, y un tutor viendo su país en la lista sin poder
-- guardar nada.
--
-- La corrección no es un `if (pais === 'VE')` en la pantalla: es que la CLAVE
-- diga de qué clase de riel se trata. `payoutCountries()` devuelve desde hoy
-- pares país→riel ('banco' | 'manual') y `rielDePayout()` traduce la clave; el
-- riel es lo que decide qué formulario se pinta. Esta migración es la mitad de
-- datos de ese cambio y **no vale sin la mitad de código**: aplicarla sola
-- devuelve al agujero de arriba.
--
-- ── LO QUE ESTA MIGRACIÓN NO TOCA, Y POR QUÉ ───────────────────────────────
--
-- `charge_provider`. Ni se copia, ni se fuerza, ni se menciona en el `set`. El
-- cobro sigue por donde esté en cada ambiente —dev tiene 'stripe' desde un
-- `UPDATE` del 7-ago, producción tiene lo que tenga— y el precedente está
-- escrito en `20260901140000:54-60`: sembrar un valor ahí encendería Stripe en
-- producción desde una migración. El cobrador es un INTERRUPTOR de negocio y se
-- mueve con un `UPDATE` cuando alguien lo decide; el pagador de Venezuela es un
-- HECHO (lo paga una persona) y por eso sí se escribe aquí.
--
-- Tampoco se le añade un `check` a `payout_provider`. Una lista cerrada de
-- proveedores dentro del esquema convertiría «abrir un riel» en «escribir una
-- migración» para siempre, que es justo lo contrario de lo que hace que esta
-- tabla sea el interruptor (regla de oro 8). Quien valida las claves es el
-- código, que ya no las reparte en dos grupos sino en tres: banco, manual y
-- «no la reconozco» — ver `rielDePayout()`.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1 · La fila de Venezuela
-- ════════════════════════════════════════════════════════════════════════════
--
-- Idempotente por el `where`: si ya está en 'manual', no toca nada — y con ella
-- respeta una `notes` editada a mano después.
update public.payment_routing_rules
   set payout_provider = 'manual',
       notes = 'Venezuela: se COBRA por charge_provider (Stripe hoy), pero se PAGA a mano. Ni dLocal Go ni Stripe transfieren allí (P1, 1-sep-2026), y la decisión del 2-sep es no escribir adaptadores para rieles sin cuenta (PayPal/Airtm/Wise): el destino lo declara el tutor en tutor_manual_payout_destinations (20260902110000) y el admin cierra la orden con manage_payout(id,''mark_paid'',referencia,canal) (20260902120000). ''manual'' NO es un PSP y no tiene adaptador: es la ausencia de automatismo, escrita.'
 where payee_country = 'VE'
   and payer_country is null
   and payout_provider is distinct from 'manual';


-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Las tres cosas que empiezan a contar distinto a partir de aquí
-- ════════════════════════════════════════════════════════════════════════════
--
-- Ninguna es un fallo de esta migración: son sitios que preguntaban «¿es
-- 'simulated'?» para decir «no se puede pagar», y ahora hay un tercer valor.
-- Se dejan escritas porque el que las va a leer es quien mire un contador raro
-- dentro de tres semanas.
--
-- (a) 🟠 `payouts_backlog()` (`20260901210000:160-182`) va a dar una FALSA
--     ALARMA con las órdenes venezolanas, y hay que arreglarlo cuando a alguien
--     le toque reescribir esa función (no se hace aquí: es de otro dueño y
--     `create or replace` de 200 líneas en paralelo es cómo se pierden cambios).
--     · `sin_ejecutor` cuenta `payout_provider is null or = 'simulated'` → las
--       de VE dejan de contarse, y eso está BIEN: ya tienen riel.
--     · `balance_ajeno` cuenta `payout_provider <> 'simulated' and
--       funding_provider is distinct from payout_provider` → las de VE empiezan
--       a contarse, y eso está MAL: 'manual' no tiene balance del que salir, así
--       que comparar `funding_provider` contra él no significa nada. La línea
--       correcta lleva además `and r.payout_provider <> 'manual'`.
--     · `sin_datos_de_cobro` mira `tutor_payout_accounts`, donde un tutor
--       venezolano NUNCA va a tener fila (su tabla es
--       `tutor_manual_payout_destinations`): hoy los cuenta a todos como si no
--       hubieran registrado nada. Ahí hay que mirar la tabla que corresponda al
--       riel, no una sola.
--
-- (b) `/api/cron/payouts-process` sigue sin tocar estas órdenes, que es lo
--     correcto — no hay nada que llamar—, pero las cuenta como `sinEjecutor`, o
--     sea las mezcla con las que no tienen a dónde ir. Con `rielDePayout()` ya
--     puede separarlas: 'manual' es «esperando a una persona» y `null` es
--     «impagable». Es un contador, no una transferencia: no urge.
--
-- (c) `payoutCountries()` empieza a ofrecer Venezuela en el desplegable del
--     tutor, con `riel: 'manual'`. La pantalla DEBE mirar ese campo: con el
--     formulario bancario de B1 delante, un tutor venezolano se estrella contra
--     la FK de `payout_country_rules`. Es el motivo entero de que la función
--     devuelva pares y no códigos.


-- ════════════════════════════════════════════════════════════════════════════
-- 3 · COLOMBIA — el hallazgo que corrige la documentación
-- ════════════════════════════════════════════════════════════════════════════
--
-- `docs/PAGOS-Y-PAYOUTS.md` §9 dice, entre lo «verificado»:
--
--     «payment_routing_rules.payout_provider es texto libre → añadir un riel es
--      una fila.»
--
-- ⚠️ ESO ES CIERTO SOLO PARA UN PAÍS QUE YA TENGA FILA. Venezuela la tiene desde
-- el seed de `20260709160000:41-42`, así que abrirle un riel ha sido de verdad
-- un `UPDATE` — el de arriba. Colombia **no tiene ninguna**: los ocho países de
-- A0 son AR, BR, CL, EC, MX, PE, PY, UY (`20260901140000:268-284`) y CO no entra
-- en esa lista ni aparece en ninguna otra migración. Y `20260806180000` concede
-- a `service_role` exactamente `select` + `update (charge_provider,
-- payout_provider, is_active)`, **sin `insert` y sin `delete`**, a propósito y
-- dicho con estas palabras: «inventar o borrar un corredor sigue exigiendo una
-- migración revisada, que es donde debe estar esa decisión». `anon` y
-- `authenticated` no tienen nada, y la política `payment_routing_rules_admin_all`
-- no lo cambia: la RLS filtra filas de un grant que no existe.
--
-- Así que abrir Colombia —o España, o EE. UU.— NO es una fila que alguien pueda
-- meter desde el panel ni desde un Route Handler con el cliente admin: es una
-- migración, igual que este archivo. Lo que sí es «datos y no esquema» es lo que
-- el doc dice bien un par de líneas más abajo: `payout_country_rules` y
-- `payout_banks` admiten países nuevos sin tocar el esquema (PK por país, sin
-- restricción a los ocho de dLocal), y `tutor_payout_accounts` ya guarda lo que
-- Colombia y España necesitan. La frase que hay que corregir es solo la del
-- ruteo, y el bloque 4 lo deja comprobado por código en vez de por confianza.
--
-- Y cuando le toque a Colombia: su riel del §5 es **Wise**, que no tiene cuenta
-- todavía. Mientras no la tenga, lo honesto es la misma clave que Venezuela
-- ('manual'), no inventar 'wise' para una fila que nadie sabe ejecutar.


-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Lo que hay que ver el día que esto se aplique (regla de oro 11)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un `update` con `where` no falla cuando no encuentra nada: se queda callado y
-- deja el ambiente a medias, con el código ya desplegado ofreciendo un país que
-- la tabla no sabe rutear. Así que se comprueba el ESTADO final, no el número de
-- filas tocadas.
do $$
declare
  v_provider text;
  v_rol      text;
begin
  select r.payout_provider into v_provider
    from public.payment_routing_rules r
   where r.payee_country = 'VE'
     and r.payer_country is null
   order by r.priority
   limit 1;

  if v_provider is null then
    raise exception 'C2m: no hay fila de ruteo para VE (payer_country null). La sembró 20260709160000 y nadie tiene grant de delete: mira quién la borró antes de volver a crearla.';
  end if;
  if v_provider is distinct from 'manual' then
    raise exception 'C2m: la fila de VE quedó en % y no en ''manual'' — hay otra fila de VE con menos priority, o alguien la movió después', v_provider;
  end if;

  -- El respaldo del bloque 3, dicho por el motor y no por un comentario: si
  -- algún día alguien concede `insert` aquí, esta migración deja de ser cierta
  -- y conviene enterarse leyendo el fallo, no descubriéndolo con un corredor
  -- inventado desde un endpoint.
  foreach v_rol in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_rol::name, 'public.payment_routing_rules', 'insert')
       or has_table_privilege(v_rol::name, 'public.payment_routing_rules', 'delete') then
      raise exception 'C2m: % puede insertar o borrar corredores en payment_routing_rules — abrir un país tiene que seguir siendo una migración', v_rol;
    end if;
  end loop;

  raise notice 'C2m: Venezuela rutea a riel manual; abrir un corredor nuevo sigue exigiendo migración.';
end;
$$;

-- ── La foto de la tabla, para pegar en el SQL editor ────────────────────────
--
-- Qué corredores quedan vivos y con qué proveedor. Las columnas están en el
-- orden en que se leen: dónde cobra el tutor, quién le cobra al alumno, quién le
-- paga a él. `riel` traduce la clave igual que `rielDePayout()` en el código —
-- si esta consulta y esa función discrepan, manda la función, que es la que
-- pinta el desplegable.
--
--   select coalesce(payee_country, '(sin declarar)') as pais,
--          charge_provider,
--          payout_provider,
--          case
--            when payout_provider = 'manual'                      then 'manual'
--            when payout_provider in ('stripe', 'dlocal')         then 'banco'
--            else 'sin riel'
--          end as riel,
--          priority,
--          is_active
--     from public.payment_routing_rules
--    where is_active
--    order by riel, pais;
--
-- Lo que tiene que salir hoy: ocho filas 'banco' (AR BR CL EC MX PE PY UY),
-- una 'manual' (VE) y una 'sin riel' —la del tutor que no ha declarado país,
-- que es la única que debe seguir en 'simulated'—. Cualquier otra fila en
-- 'sin riel' es un error de tecleo en la clave, y desde hoy se nota aquí en vez
-- de a mitad de un lote de pagos.
