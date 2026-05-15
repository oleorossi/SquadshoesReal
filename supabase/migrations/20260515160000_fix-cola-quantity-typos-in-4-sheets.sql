-- =============================================================================
-- 20260515160000 — Fix typo em quantity_per_unit de cola em 4 fichas técnicas
-- =============================================================================
--
-- Bug reportado pelo usuário: custo de cola por par estava ~R$256 quando o
-- real é < R$0,60. Investigação mostrou que NÃO é bug do sistema de cálculo
-- nem da conversão de unidades — era erro de cadastro nas fichas técnicas
-- SP117, SP119, DS15, DS19.
--
-- Quem cadastrou digitou o consumo de COLA PVC como "14" achando que estava
-- em gramas, mas a unidade do produto cola é kg → sistema gravou 14 kg/par.
-- Multiplicado por R$18/kg × pares × grades = custo inflado de 254×.
--
-- Padrão correto (verificado em outras ~10 fichas como SP130, SP101, etc.):
--   COLA PVC:   0.03 kg/par  (30g)
--   COLA FORTE: 0.023 kg/par (23g)
--
-- A migration:
--   1. Corrige as 8 linhas afetadas em sheet_materials.
--   2. Atualiza também consumption_per_size (JSONB) pra manter coerência.
--   3. Limpa technical_sheet_snapshots dos PVs afetados (forçar recálculo).
--   4. Apaga order_costs dos PVs afetados.
--   5. Marca PVs como costs_dirty_at = now() pra disparar recálculo.
--
-- WHERE inclui `quantity_per_unit > 0.05` como salvaguarda — só toca nas
-- linhas absurdas (cola/par > 50g é fora de qualquer realidade industrial),
-- nunca nas que já estavam certas.

UPDATE sheet_materials sm
   SET quantity_per_unit = CASE
     WHEN sm.product_id = '66b39bc6-fa22-4b10-bc82-19cb49ed44d2' THEN 0.03    -- COLA PVC
     WHEN sm.product_id = 'fbbe0f31-90f9-4685-9f7c-fae261617db0' THEN 0.023   -- COLA FORTE
   END,
   consumption_per_size = CASE
     WHEN sm.product_id = '66b39bc6-fa22-4b10-bc82-19cb49ed44d2'
       THEN (SELECT jsonb_object_agg(k, 0.03) FROM jsonb_object_keys(sm.consumption_per_size) k)
     WHEN sm.product_id = 'fbbe0f31-90f9-4685-9f7c-fae261617db0'
       THEN (SELECT jsonb_object_agg(k, 0.023) FROM jsonb_object_keys(sm.consumption_per_size) k)
   END
 WHERE sm.sheet_id IN (
         '75d359aa-4927-4d3e-b2fb-02d4fc555640', -- SP119
         'a01bf8c3-b044-4e17-a05d-d454039659da', -- SP117
         'e5263807-0dcc-41fa-9c44-58a9f5b2a8db', -- DS15
         '56400ba3-e784-441f-8eea-740b065c4216'  -- DS19
       )
   AND sm.product_id IN (
         '66b39bc6-fa22-4b10-bc82-19cb49ed44d2', -- COLA PVC
         'fbbe0f31-90f9-4685-9f7c-fae261617db0'  -- COLA FORTE
       )
   AND sm.quantity_per_unit > 0.05;

-- Invalida snapshots + order_costs + marca dirty pros PVs afetados
WITH affected_orders AS (
  SELECT DISTINCT i.sale_order_id
    FROM sale_order_items i
   WHERE i.reference_id IN (
           '75d359aa-4927-4d3e-b2fb-02d4fc555640',
           'a01bf8c3-b044-4e17-a05d-d454039659da',
           'e5263807-0dcc-41fa-9c44-58a9f5b2a8db',
           '56400ba3-e784-441f-8eea-740b065c4216'
         )
),
deleted_snaps AS (
  DELETE FROM technical_sheet_snapshots
   WHERE sale_order_id IN (SELECT sale_order_id FROM affected_orders)
  RETURNING 1
),
deleted_costs AS (
  DELETE FROM order_costs
   WHERE sale_order_id IN (SELECT sale_order_id FROM affected_orders)
  RETURNING 1
)
UPDATE sale_orders SET costs_dirty_at = now()
 WHERE id IN (SELECT sale_order_id FROM affected_orders);
