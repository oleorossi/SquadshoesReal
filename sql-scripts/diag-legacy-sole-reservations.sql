-- Diagnóstico (somente leitura): reservas-fantasma de solado criadas pelo
-- try_reserve_materials ANTIGO (loop de BOM reservava todos os solados do BOM
-- com notes R1/R2/R3/R5 e sem metadata.kind — debit_sole_stock_by_grade não
-- as limpa, então inflam reserved_stock até a OP ser cancelada).
-- Uso: workflow supabase-db-exec.yml (strict=true) ou MCP / SQL Editor.
SELECT
  p.name                              AS produto,
  count(*)                            AS reservas,
  count(DISTINCT mr.order_id)         AS ops,
  round(SUM(mr.quantity_reserved - mr.quantity_consumed), 2) AS qtd_pendente,
  min(mr.created_at)::date            AS mais_antiga,
  max(mr.created_at)::date            AS mais_recente
FROM material_reservations mr
JOIN products p ON p.id = mr.product_id
WHERE mr.status IN ('reserved', 'partially_consumed')
  AND COALESCE(mr.metadata ->> 'kind', '') NOT IN ('sole_grade', 'sole_pending_grade')
  AND (LOWER(COALESCE(p.category, '')) LIKE '%solado%' OR p.sole_classification IS NOT NULL)
  AND COALESCE(mr.notes, '') IN ('R1-full', 'R2-onhand', 'R2-inbound', 'R3-partial', 'R5-urgent')
GROUP BY p.name
ORDER BY qtd_pendente DESC;
