-- Cleanup retroativo de sheet_materials contaminados pelo bug do
-- autoFillStandardItemsFromSole (corrigido em b407e92 — mas fichas criadas
-- ANTES ficaram com lixo: todos os solados do estoque inseridos como
-- "Item padrão global" no BOM).
--
-- Auditoria 20/05/2026: user reportou erro "Estoque insuficiente para BOM
-- Saltinho Bloco: disponível 0, necessário 9" em 3 OPs do PV-00122
-- (cliente AGITO NITEROI, ref ST 10). Investigação: ST 10 tinha 10 solados
-- no BOM (Saltinho Bloco, 01, 204, 238, Solado Infantil em ambas cores) —
-- todos como "Item padrão global". debit_stock_for_order tentava debitar
-- TODOS, falhando no primeiro com estoque 0 e bloqueando a OP inteira.
--
-- Solados NÃO devem estar em sheet_materials — são debitados via
-- debit_sole_stock_by_grade usando technical_sheet_sole_colors (mapping
-- cabedal+ficha → solado específico).
--
-- Critério de cleanup: DELETE onde notes ILIKE '%padrão global%' AND
-- product.category='Solado'. Preserva COMPONENTES padrão (cola, linha, EVA)
-- que continuam fazendo sentido como item global.
--
-- Resultado da execução: 13 fichas afetadas, 125 linhas removidas.
-- Aplicado via MCP em 20/05/2026.

DELETE FROM public.sheet_materials sm
USING public.products p
WHERE sm.product_id = p.id
  AND sm.notes ILIKE '%padrão global%'
  AND p.category = 'Solado';
