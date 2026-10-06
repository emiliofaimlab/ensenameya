-- ============================================================================
-- Enséñame Ya — EY-214: texto nuevo de la campaña de tutores (Néstor, 5-oct)
--
-- `reward_text` es configuración que el admin edita en /admin/referidos; va por
-- migración solo para que llegue igual a dev y a prod sin tocar la nube a mano.
--
-- ⚠️ Cambia la PROMESA, no lo que se paga: lo que se entrega sigue siendo
-- `reward_kind`/`reward_amount` (crédito único al convertir). El reparto del
-- 50 % durante 12 meses no existe en el código; se avisó y se pidió igual.
-- ============================================================================

update public.referral_campaigns
set reward_text = 'Recibe el 50% de la comisión que la plataforma retiene en sus clases durante los próximos 12 meses.'
where rf_campaign_id = 50784;
