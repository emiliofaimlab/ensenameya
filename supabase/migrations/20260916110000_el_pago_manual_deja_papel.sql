-- ============================================================================
-- PUNTO 3 (Verónica, 16-sep-2026) — «pago manual debemos poder subir
-- comprobantes, fotos, no solo la referencia y el status».
--
-- Hoy cerrar un payout a mano guarda UNA cadena de texto
-- (`provider_metadata -> 'manual' ->> 'referencia'`, la escribe `mark_paid`) y
-- nada más. Quien concilia el extracto dentro de seis meses tiene el número del
-- movimiento y la palabra de quien lo tecleó; el tutor que pregunta «¿me
-- pagaste?» tiene todavía menos. Esta migración abre el sitio donde vive el
-- papel: la captura del Zelle, el PDF del banco, la foto del comprobante.
--
-- El alcance lo fijó el cliente y es CORTO: la FILA de un pago manual en
-- `/admin/payouts` —el botón «Marcar pagado» y lo que se concilia debajo—, y
-- que **el tutor también lo vea** en sus Movimientos. No hay pantalla nueva, ni
-- tabla nueva, ni bandeja de comprobantes.
--
-- ── LAS TRES TRAMPAS QUE ESTO ESQUIVA ───────────────────────────────────────
--
-- 1. ⚠️ `insert into storage.buckets … on conflict (id) do nothing` sobre un
--    bucket que YA EXISTE es un **no-op silencioso**: `db push` en verde y el
--    tope, los formatos y el `public` exactamente como estuvieran. Por eso el
--    `insert` de abajo cierra con un `do $$ … raise exception` que COMPRUEBA lo
--    que quedó. Precedente literal: `20260820170000` (MN-11b) y
--    `20260828161500` (DL-01).
--
-- 2. ⚠️ **NO se le añade un `p_comprobante` a `manage_payout`.** REGLA DE ORO
--    12: `create or replace` sobre una función a la que se le añade un
--    argumento crea una **sobrecarga**, y PostgREST responde `PGRST203` — que
--    es exactamente lo que `20260910190000` le hizo al formulario bancario del
--    tutor (y solo cuando el campo opcional iba vacío, porque supabase-js no
--    serializa `undefined`: menos argumentos → firma ambigua). Hacerlo bien
--    exigiría `drop function` + volcar otra vez las ~350 líneas del cuerpo
--    vigente (`20260910230000`) y reponer sus grants, para colgarle un dato
--    OPCIONAL. Así que el comprobante entra por una función NUEVA y pequeña,
--    `adjuntar_comprobante_payout`, y `manage_payout` no se toca.
--
-- 3. 🔴 **EL ORDEN IMPORTA, Y ES AL REVÉS DE LO QUE PARECE.** `mark_paid` no
--    añade a `{manual}`: lo **reescribe entero** con un
--    `jsonb_set(v_meta, '{manual}', jsonb_build_object('referencia', …,
--    'canal', …, 'pagado_en', …))` (`20260910230000`, rama 'mark_paid'). Un
--    comprobante adjuntado ANTES de marcar pagado desaparecería ahí mismo, sin
--    error y sin rastro: el admin vería subir el fichero, la fila quedaría
--    «Pagado» y el papel no estaría — la mentira creíble de la regla de oro 10,
--    esta vez sobre dinero. Por eso el cliente llama a esta función DESPUÉS de
--    `mark_paid`, y por eso la función crea `{manual}` si no existe (sirve
--    igual antes que después, pero el orden bueno es el de después).
--
-- ⚠️ Y NO HAY POLÍTICA DE `delete`, a propósito: un comprobante no se borra.
-- Es la convención de la casa donde hay rastro financiero o legal —baja lógica
-- sobre borrado físico— y aquí además es lo único que demuestra un pago que no
-- pasó por ningún proveedor. Si se subió el fichero equivocado, se sube otro:
-- la lista es un array y se lee entera.
-- ============================================================================


-- ── 1 · El bucket: privado, y con los mismos formatos y tope que el KYC ──────
--
-- Se copian los de `kyc-documents` (`20260706150000`) porque es exactamente el
-- mismo material subido por la misma gente: una foto hecha con el móvil o un
-- PDF descargado del banco. No hay razón para inventar una lista distinta, y
-- sí para que el espejo de cliente (`src/components/tutor/upload-formats.ts`)
-- pueda decir la misma frase.
--
-- PRIVADO, y esto no es higiene: un comprobante de transferencia lleva el
-- nombre del tutor, su banco y con frecuencia parte del número de cuenta. Lo
-- ve el admin y lo ve su dueño, y por URL firmada emitida en servidor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payout-proofs', 'payout-proofs', false,
  10485760,  -- 10 MB, el de kyc-documents
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- La red de seguridad de MN-11b: sin esto, un `payout-proofs` preexistente
-- (público, o con 1 MB de tope) dejaría pasar la migración en verde y solo se
-- descubriría con un 413 —o, peor, con un bucket público— en producción.
do $$
declare
  v_limit  bigint;
  v_public boolean;
begin
  -- `b.public` con alias: `public` es también un nombre de esquema y de rol, y
  -- leerlo a pelo en una lista de selección se lee fatal aunque el parser lo
  -- acepte.
  select b.file_size_limit, b.public into v_limit, v_public
    from storage.buckets b where b.id = 'payout-proofs';

  if v_limit is distinct from 10485760 then
    raise exception
      'PUNTO 3: payout-proofs quedó en % bytes, se esperaban 10485760 (¿existía ya el bucket?)', v_limit;
  end if;

  if v_public is distinct from false then
    raise exception
      'PUNTO 3: payout-proofs quedó PÚBLICO: sus ficheros llevan nombre, banco y parte del número de cuenta del tutor';
  end if;
end $$;


-- ── 2 · Quién puede tocar esos ficheros ─────────────────────────────────────
--
-- Calcadas de `support_attachments_select_admin` (`20260828161500`), con una
-- tercera que allí no hacía falta.

-- Sube el admin y solo el admin: el comprobante lo genera quien hizo la
-- transferencia, que en un riel manual es siempre una persona de operaciones.
drop policy if exists "payout_proofs_insert_admin" on storage.objects;
create policy "payout_proofs_insert_admin"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'payout-proofs' and public.has_role('admin') );

drop policy if exists "payout_proofs_select_admin" on storage.objects;
create policy "payout_proofs_select_admin"
  on storage.objects for select to authenticated
  using ( bucket_id = 'payout-proofs' and public.has_role('admin') );

-- 🔑 Y EL TUTOR VE EL SUYO. Lo decidió el cliente en la misma frase del punto 3:
-- el comprobante no es papeleo interno, es la respuesta a «¿me pagaste?».
--
-- Se acota por CARPETA: el objeto vive bajo `<payout_id>/…` y esta política
-- comprueba que ese payout es suyo. Es la misma forma que usa el KYC
-- (`carpeta = uid`), con una indirección más porque aquí la carpeta es la
-- ORDEN y no la persona — un tutor tiene muchos payouts y ninguno de otro.
--
-- ⚠️ La comparación es `p.id::text = <carpeta>` y no `<carpeta>::uuid = p.id`:
-- una carpeta que no sea un uuid (un fichero subido a mano desde el panel de
-- Supabase, por ejemplo) reventaría el cast y con él la política entera. Así
-- simplemente no casa, que es lo correcto.
drop policy if exists "payout_proofs_select_tutor" on storage.objects;
create policy "payout_proofs_select_tutor"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payout-proofs'
    and exists (
      select 1
        from public.payouts p
       where p.id::text = (storage.foldername(name))[1]
         and p.tutor_id = (select auth.uid())
    )
  );

-- Sin `delete` y sin `update`: ver la cabecera. Un comprobante equivocado se
-- corrige subiendo otro, no borrando el primero.


-- ── 3 · La función: añadir un papel a la lista de una orden ─────────────────
create or replace function public.adjuntar_comprobante_payout(
  p_payout_id uuid,
  p_path      text,
  p_nombre    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
begin
  -- Guarda explícita: es `security definer`, así que sin esto cualquier
  -- `authenticated` podría escribir en `provider_metadata` de cualquier payout.
  if not public.has_role('admin') then
    raise exception 'solo un administrador puede adjuntar el comprobante de un payout'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_path), '') = '' then
    raise exception 'falta la ruta del comprobante en Storage'
      using errcode = 'check_violation';
  end if;

  -- 🔑 LA RUTA TIENE QUE COLGAR DE LA CARPETA DEL PAYOUT. No es cosmético: es
  -- exactamente lo que mira `payout_proofs_select_tutor`. Un comprobante
  -- guardado fuera de `<payout_id>/…` quedaría anotado en la fila y el tutor
  -- recibiría un 403 al abrirlo — un enlace roto que parece un fichero perdido.
  if p_path not like p_payout_id::text || '/%' then
    raise exception 'la ruta del comprobante tiene que empezar por %/ (es la carpeta que la RLS del tutor comprueba), y llegó «%»',
      p_payout_id, p_path
      using errcode = 'check_violation';
  end if;

  select provider_metadata into v_meta
    from public.payouts
   where id = p_payout_id
     for update;

  if not found then
    raise exception 'el payout % no existe', p_payout_id
      using errcode = 'no_data_found';
  end if;

  v_meta := coalesce(v_meta, '{}'::jsonb);

  -- ⚠️ `jsonb_set` NO crea los pasos intermedios del camino: con `{manual}`
  -- ausente, un `jsonb_set(v_meta, '{manual,comprobantes}', …, true)` devuelve
  -- el jsonb TAL CUAL y no avisa. Otro no-op silencioso, y el segundo de este
  -- fichero. Por eso `{manual}` se asegura primero.
  if jsonb_typeof(v_meta -> 'manual') is distinct from 'object' then
    v_meta := jsonb_set(v_meta, '{manual}', '{}'::jsonb, true);
  end if;

  -- AÑADE, nunca reemplaza: un envío por lote deja un justificante y tres
  -- órdenes, y una orden puede acumular el comprobante bueno detrás del malo.
  v_meta := jsonb_set(
    v_meta,
    '{manual,comprobantes}',
    coalesce(v_meta -> 'manual' -> 'comprobantes', '[]'::jsonb)
      || jsonb_build_array(
           jsonb_build_object(
             'path',      p_path,
             -- El nombre con el que salió del ordenador de quien lo subió:
             -- «transferencia-nestor.pdf» dice más que un uuid, y la ruta lleva
             -- uno delante para que dos ficheros iguales no se pisen.
             'nombre',    to_jsonb(coalesce(nullif(btrim(p_nombre), ''), 'comprobante')),
             'subido_en', to_jsonb(now()),
             -- Quién lo subió. No hay pantalla que lo pinte hoy; se guarda
             -- porque un comprobante sin autor es media firma, y añadirlo
             -- mañana sería otra migración sobre filas ya escritas.
             'subido_por', to_jsonb(auth.uid())
           )
         ),
    true
  );

  update public.payouts
     set provider_metadata = v_meta
   where id = p_payout_id;
end;
$$;

comment on function public.adjuntar_comprobante_payout(uuid, text, text) is $c$
PUNTO 3 (16-sep-2026): anota un comprobante ya subido a `payout-proofs` en
`payouts.provider_metadata -> 'manual' -> 'comprobantes'` (array; AÑADE, no
reemplaza).

Es una función NUEVA y no un argumento más de `manage_payout` por la regla de
oro 12: añadírselo con `create or replace` habría creado una sobrecarga y
PostgREST respondería PGRST203, que es lo que rompió el formulario bancario del
tutor el 10-sep (`20260910190000`).

🔴 Se llama DESPUÉS de `manage_payout('mark_paid')`, nunca antes: esa rama
reescribe `{manual}` entero (`jsonb_set(v_meta, '{manual}', jsonb_build_object(
…))`) y se llevaría por delante, sin error, lo que se hubiera adjuntado antes.

Guarda `has_role('admin')` y exige que la ruta cuelgue de `<payout_id>/`, que es
exactamente lo que comprueba la política `payout_proofs_select_tutor`.
$c$;

revoke execute on function public.adjuntar_comprobante_payout(uuid, text, text) from public;
revoke execute on function public.adjuntar_comprobante_payout(uuid, text, text) from anon;
-- La llama la pantalla de admin desde el NAVEGADOR, o sea como `authenticated`;
-- quién es admin lo decide la guarda de dentro, no el grant.
grant  execute on function public.adjuntar_comprobante_payout(uuid, text, text) to authenticated;
grant  execute on function public.adjuntar_comprobante_payout(uuid, text, text) to service_role;
