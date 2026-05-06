-- =================================================================
-- 03_test_resync_scenarios.sql
--
-- 3 cenários para validar manualmente o fluxo de resync de OPs em
-- produção quando dados técnicos da referência mudam. Roda em
-- ambiente de HOMOLOGAÇÃO ou em uma transação que pode ser ROLLBACK.
--
-- COMO USAR: cada cenário começa com BEGIN e termina com ROLLBACK
-- por padrão. Para aplicar de verdade, troque o ROLLBACK por COMMIT.
--
-- IDENTIFIQUE ANTES DE COMEÇAR:
--   - :sole_group_id  → grupo de produto de um solado de teste
--   - :sheet_id       → ficha técnica com OP ativa
--   - :recipe_id      → receita artesanal com OS ativa (se módulo ativo)
-- =================================================================

-- =================================================================
-- CENÁRIO 1: Mudar conjugação de solado (23/24)
-- Esperado: trigger trg_resync_for_sole_conjugation enfileira OPs
-- ativas que usam solado deste grupo, e process_resync_queue() faz
-- o resync atômico.
-- =================================================================

BEGIN;

-- 1.1 Capture estado pré-mudança das OPs afetadas
WITH opsafetadas AS (
  SELECT o.id, o.order_number, o.quantity, o.color
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.products p ON p.id = ts.sole_id
   WHERE p.group_id = (
     -- AJUSTAR: troque pelo sole_group_id real do seu ambiente
     SELECT id FROM public.product_groups WHERE name ILIKE '%solado%' LIMIT 1
   )
     AND LOWER(COALESCE(o.status,'')) IN ('reservado','em produção')
)
SELECT 'PRE_MUDANCA' AS fase, * FROM opsafetadas;

-- 1.2 Snapshot do stock_movements antes
SELECT 'PRE_MOVIMENTOS' AS fase, COUNT(*) AS total_out, SUM(quantity) AS qtd_total
FROM public.stock_movements
WHERE order_id IN (SELECT id FROM public.orders WHERE LOWER(COALESCE(status,'')) IN ('reservado','em produção'))
  AND movement_type = 'out';

-- 1.3 Crie ou atualize uma conjugação que afete OPs ativas
-- AJUSTAR: trocar pelo sole_group_id real
INSERT INTO public.sole_size_conjugations (sole_group_id, size_key, sizes, display_order)
VALUES (
  (SELECT id FROM public.product_groups WHERE name ILIKE '%solado%' LIMIT 1),
  '23/24', ARRAY[23, 24], 1
)
ON CONFLICT (sole_group_id, size_key) DO UPDATE SET sizes = EXCLUDED.sizes;

-- 1.4 Verifique a fila enfileirada pelo trigger
SELECT 'FILA' AS fase, id, order_id, reason, triggered_by, enqueued_at, processed_at
FROM public.resync_queue
WHERE processed_at IS NULL
ORDER BY enqueued_at;

-- 1.5 Drena a fila (frontend chama isso automaticamente; em SQL direto, manual)
SELECT 'DRENAR' AS fase, * FROM public.process_resync_queue(50);

-- 1.6 Confira que a fila foi processada
SELECT 'FILA_POS_DRENO' AS fase, COUNT(*) AS pendentes
FROM public.resync_queue WHERE processed_at IS NULL;

-- 1.7 Confira que houve estorno + re-débito (dois movimentos por produto afetado)
SELECT 'POS_RESYNC_MOVIMENTOS' AS fase,
       movement_type, COUNT(*) AS total, SUM(quantity) AS qtd
FROM public.stock_movements
WHERE description ILIKE '%resync_op_atomic%'
   OR description ILIKE '%Estorno automático%'
GROUP BY movement_type;

ROLLBACK; -- troque para COMMIT para aplicar de verdade

-- =================================================================
-- CENÁRIO 2: Mudar mapeamento cabedal × palmilha
-- Esperado: trigger trg_resync_for_palmilha_colors enfileira OPs
-- desta sheet_id, e a fila é drenada pelo frontend OU manualmente.
-- =================================================================

BEGIN;

-- 2.1 Identifique uma ficha com OP ativa e insole_has_lining = false
WITH ficha_alvo AS (
  SELECT ts.id AS sheet_id, ts.name, COUNT(o.id) AS qtd_ops_ativas
    FROM public.technical_sheets ts
    JOIN public.orders o ON o.reference_id = ts.id
   WHERE COALESCE(ts.insole_has_lining, true) = false
     AND LOWER(COALESCE(o.status,'')) IN ('reservado','em produção')
   GROUP BY ts.id, ts.name
   HAVING COUNT(o.id) > 0
   ORDER BY qtd_ops_ativas DESC
   LIMIT 5
)
SELECT 'FICHAS_CANDIDATAS' AS fase, * FROM ficha_alvo;

-- 2.2 Faça o upsert do mapping na primeira ficha encontrada (ou ajuste manualmente)
INSERT INTO public.technical_sheet_palmilha_colors (sheet_id, cabedal_color, palmilha_color)
SELECT sheet_id, 'PRETO', 'BEGE'
  FROM (
    SELECT ts.id AS sheet_id
      FROM public.technical_sheets ts
      JOIN public.orders o ON o.reference_id = ts.id
     WHERE COALESCE(ts.insole_has_lining, true) = false
       AND LOWER(COALESCE(o.status,'')) IN ('reservado','em produção')
     LIMIT 1
  ) x
ON CONFLICT (sheet_id, cabedal_color) DO UPDATE SET palmilha_color = EXCLUDED.palmilha_color;

-- 2.3 Confirme enfileiramento
SELECT 'FILA' AS fase, COUNT(*) AS pendentes
FROM public.resync_queue
WHERE triggered_by ILIKE 'technical_sheet_palmilha_colors%'
  AND processed_at IS NULL;

-- 2.4 Drena
SELECT 'DRENAR' AS fase, * FROM public.process_resync_queue(50);

-- 2.5 Pós-resync: snapshot deletado e movimentos de palmilha refeitos
SELECT 'POS_RESYNC' AS fase,
       COUNT(*) FILTER (WHERE movement_type = 'in' AND description ILIKE '%Estorno%') AS estornos,
       COUNT(*) FILTER (WHERE movement_type = 'out') AS novos_debitos
FROM public.stock_movements
WHERE created_at > NOW() - INTERVAL '5 minutes';

ROLLBACK;

-- =================================================================
-- CENÁRIO 3: Mudar yield_per_meter em receita artesanal
-- Esperado (apenas se artisanal_orders existir): trigger
-- trg_resync_for_artisanal_recipe enfileira OSs ativas.
-- =================================================================

BEGIN;

-- 3.1 Verifica se módulo artesanal está ativo
SELECT
  CASE
    WHEN EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'artisanal_orders')
    THEN 'MÓDULO ATIVO — prosseguir'
    ELSE 'MÓDULO INATIVO — pular cenário 3'
  END AS check_artisanal;

-- 3.2 Receita com OSs ativas
SELECT 'RECEITAS_ALVO' AS fase, ar.id, ar.artisanal_product_name,
       ar.yield_per_meter,
       (SELECT COUNT(*) FROM public.artisanal_orders ao
         WHERE ao.recipe_id = ar.id
           AND LOWER(COALESCE(ao.status,'')) NOT IN
               ('finalizado','finalizada','cancelado','cancelada','entregue')
       ) AS oss_ativas
  FROM public.artisanal_recipes ar
 ORDER BY oss_ativas DESC
 LIMIT 5;

-- 3.3 Atualiza yield (deve disparar trigger por causa do WHEN guard)
-- AJUSTAR: troque o id pela receita real
-- UPDATE public.artisanal_recipes
--   SET yield_per_meter = yield_per_meter * 1.1  -- aumenta 10% o rendimento
-- WHERE id = '<recipe_id_real>';

-- 3.4 Confirme enfileiramento
SELECT 'FILA' AS fase, COUNT(*) AS pendentes_artesanal
FROM public.resync_queue
WHERE artisanal_order_id IS NOT NULL
  AND processed_at IS NULL;

-- NOTA: process_resync_queue ainda NÃO processa OSs artesanais (só order_id).
-- O backend para isso ainda precisa ser implementado. Por enquanto, a fila
-- registra a necessidade e um job manual ou o frontend deve processar.

ROLLBACK;

-- =================================================================
-- CENÁRIO 4: Validar que sale_orders.total fica em sincronia com itens
-- =================================================================

BEGIN;

-- 4.1 Pega um pedido ativo qualquer
WITH alvo AS (
  SELECT id, total
    FROM public.sale_orders
   WHERE LOWER(COALESCE(status,'')) NOT IN ('cancelado','cancelada','finalizado','finalizada','entregue')
   LIMIT 1
)
SELECT 'ALVO' AS fase, * FROM alvo;

-- 4.2 Inseir um item dummy (ajuste reference_id real)
-- INSERT INTO public.sale_order_items (sale_order_id, reference_id, color, quantity, unit_price)
-- SELECT (SELECT id FROM alvo), '<reference_id_real>', 'PRETO', 10, 50.00
--   FROM alvo;

-- 4.3 Confirma que sale_orders.total foi recalculado pelo trigger
-- SELECT 'POS_INSERT' AS fase, total FROM public.sale_orders WHERE id = (SELECT id FROM alvo);

ROLLBACK;
