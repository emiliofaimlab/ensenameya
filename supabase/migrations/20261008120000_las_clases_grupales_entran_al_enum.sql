-- ============================================================================
-- Enséñame Ya — `pricing_model` gana 'group' (clases grupales, Fase C)
--
-- RN-22 quedó derogada el 2-oct-2026: las clases grupales entran en alcance
-- (`docs/PLAN-ACADEMIAS-Y-GRUPALES.md` §3, RG-01). Una clase grupal es un
-- producto con `pricing_model = 'group'`.
--
-- `ALTER TYPE ... ADD VALUE` va en su PROPIA migración (precedente
-- `20260724130000`): Postgres no deja usar un valor de enum recién añadido en
-- la misma transacción, y la siguiente migración ya lo usa en un `check`.
--
-- ⚠️ Al regenerar tipos, `PricingModel` pasa a tener cuatro valores: todo
-- `Record<PricingModel, …>` y todo `switch` exhaustivo del frontend deja de
-- compilar hasta que sepa pintar 'group'. Es el aviso que se quiere.
-- ============================================================================

alter type public.pricing_model add value if not exists 'group';
