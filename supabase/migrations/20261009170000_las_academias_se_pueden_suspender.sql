-- ============================================================================
-- Enséñame Ya — academy_status gana 'suspended' (Academias, Fase 1)
--
-- RA-20 (`docs/REQUERIMIENTOS.md` §2): una academia suspendida desaparece del
-- público y no admite reservas nuevas; las existentes siguen. Y una academia
-- con reservas no se borra: se suspende.
--
-- `ALTER TYPE ... ADD VALUE` en su propia migración (precedentes
-- `20260724130000` y `20261008120000`): el valor nuevo no se puede usar en la
-- misma transacción que lo crea.
--
-- La política `academies_select_active` (`20260915180000`) filtra por
-- status = 'active', así que una suspendida ya deja de verse sin tocar nada.
-- ============================================================================

alter type public.academy_status add value if not exists 'suspended';
