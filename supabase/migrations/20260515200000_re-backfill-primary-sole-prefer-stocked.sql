-- =============================================================================
-- 20260515200000 — Re-backfill primary_sole_id preferindo produto COM ESTOQUE
-- =============================================================================
--
-- Bug reportado: OP-2026-00835 (DS19) disparou trigger
-- check_grade_quantity_coherence:
--   'Inconsistência: SUM(stock_grade) = 12 difere de quantity = 0
--    no produto 7056af4c (SL01-03 PRETO)'.
--
-- Causa raiz: migration 20260515170000 fez DISTINCT ON (sheet_id) sem
-- preferência por estoque — quando "sole_material=01" tem múltiplas
-- variantes de cor no catálogo (SL01-02 CARAMELO qty=700 e SL01-03 PRETO
-- qty=0), pegou aleatoriamente. Várias fichas acabaram apontando pra
-- SL01-03 PRETO (sem estoque). Daí qualquer débito de estoque/grade
-- atualizava stock_grade do produto vazio e disparava o trigger.
--
-- Fix: re-backfill com ORDER BY priorizando produto com quantity > 0.
-- Atualizou 6 fichas (DS12, SP101, SP117, SP119, TR05 → SL01-02 CARAMELO
-- estoque 700; ST15 → S180C CARAMELO). Fichas que apontam pra produto
-- sem nenhuma variante com estoque (Solado Infantil, S180C) ficaram —
-- usuário precisa cadastrar estoque ou apontar pra produto diferente.
--
-- Resposta direta ao trigger: OP-2026-00835 agora aponta pra SL01-02
-- CARAMELO (qty=700, stock_grade preenchido). Próximo débito vai OK.
--
-- ATENÇÃO: pode haver material_reservations ativas na OP-2026-00835
-- apontando pro produto antigo (SL01-03). Se sim, o user precisa
-- cancelar+reativar a OP pra que as reservas sejam recriadas no produto
-- correto. (Não toco aqui pra não destruir reservas legítimas.)

WITH best_match AS (
  SELECT DISTINCT ON (ts.id)
    ts.id AS sheet_id,
    p.id AS product_id
    FROM technical_sheets ts
    JOIN products p ON lower(trim(p.name)) = lower(trim(ts.sole_material))
   WHERE ts.sole_material IS NOT NULL AND ts.sole_material <> ''
     AND p.category ILIKE '%solado%'
     AND p.active = true
   ORDER BY ts.id,
            (CASE WHEN p.quantity > 0 THEN 0 ELSE 1 END),  -- com estoque primeiro
            p.quantity DESC,                                 -- maior estoque primeiro
            p.sku                                            -- determinístico
)
UPDATE technical_sheets ts
   SET primary_sole_id = bm.product_id
  FROM best_match bm
 WHERE ts.id = bm.sheet_id
   AND (ts.primary_sole_id IS NULL OR ts.primary_sole_id <> bm.product_id);
