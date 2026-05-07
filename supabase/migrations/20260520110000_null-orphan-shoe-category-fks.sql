-- =============================================================================
-- Limpa FKs órfãos em technical_sheets.shoe_category_id antes do PR 1.
-- =============================================================================
-- 21 fichas tinham `shoe_category_id` apontando pra rows de
-- `silk_shoe_category` que foram deletadas em algum momento — corruption
-- pré-existente. Isso fazia o Postgres re-validar o FK em cada UPDATE
-- subsequente em technical_sheets, abortando com 23503 (foreign_key_violation)
-- a migration que faz backfill de production_sectors.
--
-- Como `shoe_category_id` é nullable e só serve pra filtragem na tela de
-- Silk Global, set NULL é seguro: a ficha continua 100% funcional, só perde
-- a categoria de silk associada (pode ser reapontada manualmente depois).
-- =============================================================================

UPDATE public.technical_sheets
   SET shoe_category_id = NULL
 WHERE shoe_category_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.silk_shoe_category sc WHERE sc.id = shoe_category_id
   );

-- Validação: se essa migration for re-executada num DB já saudável, deve
-- retornar 0 rows afetadas (idempotente).
