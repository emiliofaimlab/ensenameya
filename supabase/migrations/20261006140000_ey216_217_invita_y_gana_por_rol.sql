-- ============================================================================
-- Enséñame Ya — EY-216/EY-217: «Invita y gana» deja de ser igual para todos
-- (Néstor vía Vero, 6-oct: «que cada quien vea lo suyo, estudiante y tutor»)
--
-- La misma campaña (invitar alumnos, 50785) se promete distinto según quién la
-- lea: al alumno, una clase gratis; al tutor, el 90 % en las clases a sus
-- invitados. Una fila por campaña de RF (`rf_campaign_id` es la PK), así que el
-- segundo texto va en una columna hermana y no en una fila nueva.
--
-- ⚠️ Igual que `reward_text`, es una PROMESA: lo que se entrega lo siguen
-- diciendo `reward_kind`/`reward_amount`. El 90 % no lo calcula nada; lo da el
-- admin a mano asignando un tier (honor system, decidido el 6-oct).
--
-- Sin `grant` nuevo: `referral_campaigns` tiene grants de TABLA
-- (`20260911120000`), así que la columna entra sola para `authenticated`
-- (lectura) y `service_role` (el PATCH del admin).
-- ============================================================================

alter table public.referral_campaigns add column reward_text_tutores text;

comment on column public.referral_campaigns.reward_text_tutores is
  'EY-216: lo que leen los TUTORES en «Invita y gana». NULL = leen reward_text. Promesa, no pago: lo que se entrega es reward_kind/reward_amount.';

update public.referral_campaigns
set reward_text_tutores = 'Invita estudiantes y eleva tu comisión al 90% en ellos.'
where rf_campaign_id = 50785;
