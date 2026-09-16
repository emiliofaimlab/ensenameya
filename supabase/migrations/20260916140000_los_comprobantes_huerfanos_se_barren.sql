-- ============================================================================
-- Los comprobantes huérfanos se barren — cierra el hueco de `20260916110000`
--
-- El picker de comprobantes de `/admin/payouts` **sube el fichero ANTES de
-- confirmar**, y lo hace a propósito: un MIME que el bucket no acepta o un PDF
-- de 12 MB es mejor descubrirlo antes de marcar el pago y dispararle al tutor
-- el aviso de que ya cobró (`payout-actions.tsx`, «1 · El papel, a Storage»).
-- El precio de ese orden es un objeto suelto cada vez que lo de después no
-- ocurre: quien adjunta y cierra la pestaña, quien ve fallar `mark_paid`, quien
-- recibe el error de `adjuntar_comprobante_payout` con el segundo de tres
-- ficheros. Nadie lo limpia, nadie lo ve —el bucket es privado y no hay
-- pantalla que lo liste— y son 10 MB la pieza.
--
-- Es EXACTAMENTE el basurero que ya documentó la purga de contacto
-- (`20260828161500`, punto 2): «el formulario sube el fichero ANTES de enviar el
-- mensaje, así que quien adjunta y luego cierra la pestaña deja el objeto sin
-- fila que lo reclame». La misma forma, el mismo día de gracia, la misma cola.
--
-- ⚠️ Y NO, ESTO NO CONTRADICE EL «un comprobante no se borra» de
-- `20260916110000`. Aquella frase protege el papel de un pago REAL —por eso el
-- bucket no tiene política de `delete` y por eso un comprobante equivocado se
-- corrige subiendo otro—. Lo que se barre aquí es lo que NINGUNA orden reclama:
-- un fichero que jamás llegó a ser el comprobante de nada. En cuanto una fila
-- lo cita, este barrido deja de verlo, para siempre y aunque el pago se anule.
-- (El job va con `service_role` por la Storage API, que se salta las políticas
-- del bucket: la ausencia de política de `delete` no lo frena, y no es un
-- descuido — es que no hay ninguna persona que pueda disparar esto.)
--
-- ── LAS TRES COSAS QUE ESTO NO HACE, Y POR QUÉ ──────────────────────────────
--
-- 1. ⚠️ **No borra: encola.** Supabase prohíbe `delete from storage.objects`
--    desde SQL (42501) y la guarda salta **incluso con cero filas**, tumbando
--    la transacción entera (`20260827190000`). Aquí se apuntan las rutas en
--    `storage_purge_queue` y las retira con la Storage API el job HTTP, que es
--    el único camino que Supabase admite. Leer `storage.objects` sí se puede:
--    lo prohibido es el `delete`.
--
-- 2. ⚠️ **No se cuelga de `pg_cron`** (regla de oro 11): ahí su fallo sería
--    mudo —ni build en rojo ni 500 en Vercel, solo una fila en
--    `cron.job_run_details` que nadie mira—, y `close_expired_sessions()`
--    acumuló 12.446 fallos seguidos así. La llama
--    `/api/cron/recordings-purge` (Vercel Cron, `0 4 * * *`), que es quien ya
--    drena la cola: se encola y se vacía **en la misma pasada**, y el número de
--    encolados sale en el JSON de respuesta del job.
--
-- 3. ⚠️ **No barre a los cinco minutos: espera UN DÍA.** Un comprobante recién
--    subido y todavía sin su `adjuntar_comprobante_payout` es indistinguible de
--    un huérfano — entre el `upload()` y la RPC hay un `mark_paid` de por medio.
--    Barrer agresivamente borraría el justificante de alguien que está
--    rellenando el formulario, y un comprobante es lo ÚNICO que demuestra un
--    pago que no pasó por ningún proveedor.
-- ============================================================================


create or replace function public.encolar_comprobantes_huerfanos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_encolados integer;
begin
  -- Todas las rutas que alguna orden reclama como suyas. Se calcula UNA vez
  -- —son pocas filas y muchos menos objetos— en vez de recorrer `payouts` por
  -- cada fichero del bucket.
  --
  -- ⚠️ El `case` no es paranoia gratuita: `jsonb_array_elements` sobre un
  -- escalar levanta «cannot extract elements from a scalar» y se llevaría por
  -- delante la pasada entera, en ejecución y no en el `create`. Con `null`
  -- (que es lo que hay hoy en cuanto `mark_paid` reescribe `{manual}` sin
  -- comprobantes) la función es STRICT y devuelve cero filas, que ya está bien.
  with referenciados as (
    select c ->> 'path' as path
      from public.payouts p
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(p.provider_metadata -> 'manual' -> 'comprobantes') = 'array'
            then p.provider_metadata -> 'manual' -> 'comprobantes'
          else '[]'::jsonb
        end
      ) as c
  ),
  huerfanos as (
    insert into public.storage_purge_queue (bucket_id, path)
    select 'payout-proofs', o.name
      from storage.objects o
     where o.bucket_id = 'payout-proofs'
       -- El día de gracia del punto 3 de la cabecera.
       and o.created_at < now() - interval '1 day'
       and not exists (
         select 1 from referenciados r where r.path = o.name
       )
    -- La misma ruta no se encola dos veces: si el barrido de ayer la dejó a
    -- medias, mañana se reintenta su fila en vez de acumular duplicados.
    on conflict (bucket_id, path) do nothing
    returning 1
  )
  select count(*) into v_encolados from huerfanos;

  return v_encolados;
end;
$$;

comment on function public.encolar_comprobantes_huerfanos() is $c$
Apunta en `storage_purge_queue` los objetos de `payout-proofs` con más de un día
que ninguna orden reclama, o sea los que el picker de `/admin/payouts` subió y
nadie llegó a anotar (sube ANTES de confirmar, a propósito: `20260916110000`).

No borra, porque no puede: `delete from storage.objects` desde SQL es 42501 y la
guarda salta hasta con cero filas (`20260827190000`). Los retira con la Storage
API `/api/cron/recordings-purge`, que la llama y drena la cola en la misma
pasada. NO está en pg_cron a propósito (regla de oro 11: ahí el fallo es mudo).

⚠️ «Reclamada» significa hoy `provider_metadata -> 'manual' -> 'comprobantes'`,
que es lo único que escribe `adjuntar_comprobante_payout`. El día que una ruta
de este bucket se guarde en otro sitio del `provider_metadata`, hay que ampliar
el CTE `referenciados` **antes** de desplegarlo o este barrido se llevará el
papel de un pago real.
$c$;

-- ⚠️ REGLA DE ORO 9. La función es `security definer`, así que lee `payouts` y
-- `storage.objects` con los privilegios de su dueña y no con los de quien la
-- llama —por eso no hacen falta `grant` nuevos sobre esas dos—, pero el
-- `execute` sí es del llamante: sin el de abajo, el job comería
-- `permission denied` EN EJECUCIÓN, no en el build ni en el typecheck.
-- `storage_purge_queue` ya tiene sus grants de `service_role` desde
-- `20260827190000`, que es lo que además deja al Route Handler vaciarla.
--
-- Y solo `service_role`: esto es trabajo de sistema. Nadie lo llama desde un
-- navegador, así que no existe como endpoint de PostgREST ni queriendo.
revoke execute on function public.encolar_comprobantes_huerfanos() from public;
revoke execute on function public.encolar_comprobantes_huerfanos() from anon;
revoke execute on function public.encolar_comprobantes_huerfanos() from authenticated;
grant  execute on function public.encolar_comprobantes_huerfanos() to service_role;
