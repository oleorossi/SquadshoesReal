-- =============================================================================
-- AUDITORIA A1 (alto): calculate_order_consumption_by_grade descartava numerações
-- CONJUGADAS ('33/34') pelo filtro key ~ '^[0-9]+$' (em v_total_qty e no loop por
-- tamanho) → consumo/custo/reserva de componentes subcontados ~25% nos itens com
-- conjugadas, e denominador divergente do custeio (que conta conjugadas).
--
-- Fix (2 partes, espelha debit_sole_stock_by_grade que já trata conjugadas):
--   1. filtro aceita 'NN' e 'NN/NN'.
--   2. o loop castava key::integer (estoura em '33/34'); passa a usar
--      split_part(key,'/',1) como tamanho representativo p/ o lookup de consumo por
--      numeração, mantendo a quantidade da chave conjugada.
-- Idempotente (replace é no-op se já aplicado).
-- =============================================================================
DO $patch$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure);
  src := replace(src, 'key ~ ''^[0-9]+$''', 'key ~ ''^[0-9]+(/[0-9]+)?$''');
  src := replace(src,
    'SELECT key::integer, value::numeric FROM jsonb_each_text(p_grade)',
    'SELECT split_part(key, ''/'', 1)::integer, value::numeric FROM jsonb_each_text(p_grade)');
  EXECUTE src;
END $patch$;
