-- ============================================================================
-- Enséñame Ya — TU02: estado 'draft' para los documentos de verificación.
--
-- El tutor puede ir subiendo sus documentos POCO A POCO sin mandarlos a
-- revisión: quedan en 'draft' (borrador) hasta que pulsa "Enviar a revisión",
-- que los pasa a 'pending'. Un borrador NO cuenta como enviado: no aparece en
-- la cola del admin ni pone la identidad "en revisión".
--
-- `ALTER TYPE ... ADD VALUE` va en su PROPIA migración: Postgres no deja usar
-- un valor de enum recién añadido en la misma transacción, y la siguiente
-- migración ya lo usa en DML/RPC. Un archivo = una transacción (Supabase CLI).
-- ============================================================================

alter type public.document_status add value if not exists 'draft';
