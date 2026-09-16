-- ════════════════════════════════════════════════════════════════════════════
-- EL COMPRADOR VE SU CARGO · `service_fee_amount` en `mis_regalos_comprados`
-- ════════════════════════════════════════════════════════════════════════════
--
-- `20260916130000` metió el cargo por servicio DENTRO de `credits.amount` al
-- comprar un regalo. La pantalla de pago del regalo
-- (`src/app/(checkout)/regalar/[creditId]/pagar/page.tsx`) lee de la VISTA, no
-- de la tabla, así que sin esta columna el desglose «Subtotal / Cargo por
-- servicio / Total» no se puede pintar: el comprador vería un total más alto
-- que el precio de la mentoría y sin explicación.
--
-- ⚠️ Se recrea la vista ENTERA con `create or replace` porque PostgreSQL no deja
--    añadir una columna en medio; va al final, que es donde `create or replace`
--    las admite sin `drop` (y un `drop` se llevaría por delante el
--    `grant select` de `authenticated`).
--
-- ⚠️ `with (security_invoker = true)`, como manda la casa y como ya estaba:
--    sin eso la vista correría con los privilegios de su dueño y publicaría lo
--    que `credits_select_comprador` tapa. El precedente es `tutors_public`
--    (`20260804120000`).
--
-- ⚠️ COLUMNAS EXPLÍCITAS, nunca `c.*`: lo que se le añada mañana a `credits` no
--    debe colarse solo en una superficie que ve el usuario. Por eso esta
--    migración existe en vez de haber escrito un asterisco en su día.
--
-- ⚠️ Y SIGUE SIN EXPONER `beneficiary_id`, que es lo que decía el comentario
--    original y hay que conservar: saber si esa dirección tiene cuenta es un
--    oráculo de existencia y la pantalla no lo necesita para nada.
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.mis_regalos_comprados
with (security_invoker = true) as
  select c.id,
         c.status,
         c.amount,
         c.currency,
         c.product_id,
         c.beneficiary_email,
         c.gift_message,
         c.expires_at,
         c.issued_at,
         c.consumed_at,
         c.created_at,
         (c.consumed_at is not null) as canjeado,
         c.service_fee_amount
    from public.credits c
   where c.source = 'gift'
     and c.purchased_by = (select auth.uid());

comment on view public.mis_regalos_comprados is
  'Los regalos que YO pagué: en qué estado están, hasta cuándo, y cuánto de lo que pagué fue cargo por servicio (service_fee_amount, ya sumado dentro de amount desde 20260916130000 — amount − service_fee_amount es el precio del tutor). security_invoker: hereda la RLS de credits (credits_select_comprador). NO expone beneficiary_id: saber si esa dirección tiene cuenta es un oráculo de existencia y no hace falta para nada que la pantalla enseñe.';

-- `create or replace view` conserva los grants, así que este no haría falta.
-- Se repite por lo mismo que lo hacen las otras vistas de la casa: si algún día
-- alguien tiene que convertir esto en `drop` + `create`, el grant ya está
-- escrito al lado y no se pierde en el camino.
grant select on public.mis_regalos_comprados to authenticated;
