-- =============================================================================
-- 20260902170000_drop-material-status-fiction.sql
--
-- ACHADO (auditoria motores 2026-07-01, severidade BAIXA):
-- `orders.material_status` é FICÇÃO. O mecanismo que o preenche:
--
--   trigger tr_update_order_material_status (BEFORE INSERT OR UPDATE OF
--     quantity, reference_id ON public.orders)
--     → update_order_material_status()
--       → get_order_material_status(p_order_id uuid)
--
-- get_order_material_status compara `products.current_stock` (coluna ESTALE —
-- o estoque vivo é `products.quantity`) contra `bill_of_materials`, tabela com
-- 0 rows em produção (o BOM real mora em `sheet_materials`). COUNT(*) de
-- faltantes é sempre 0 → TODA OP nasce/vira 'LIBERADO'. Verificado no banco
-- vivo em 2026-07-02: 238/238 orders com material_status='LIBERADO', enquanto
-- o modal "Consumo de Materiais" (src/lib/orderConsumption.ts, referência
-- canônica) mostra falta real.
--
-- FIX: derrubar o MECANISMO (trigger + funções + DEFAULT), preservando a
-- coluna `orders.material_status` (sem DROP COLUMN — compatibilidade com o
-- types.ts gerado e com qualquer consumidor externo). Sem o DROP DEFAULT,
-- toda OP nova continuaria nascendo 'LIBERADO' mesmo sem o trigger.
-- Nenhuma view/função do banco e nenhum código do frontend lê a coluna
-- (verificado via pg_depend + grep em src/ — só o types.ts gerado a declara),
-- então não há UI pra ajustar além de nada exibir.
--
-- Idempotente: DROP ... IF EXISTS / DROP DEFAULT (no-op se já removido) /
-- UPDATE com WHERE estrito.
-- =============================================================================

-- 1) Trigger que estampava a ficção a cada INSERT/UPDATE de quantity/reference_id.
DROP TRIGGER IF EXISTS tr_update_order_material_status ON public.orders;

-- 2) Função-trigger (chamava get_order_material_status e gravava em NEW).
DROP FUNCTION IF EXISTS public.update_order_material_status();

-- 3) Função de cálculo (current_stock estale × bill_of_materials vazia).
DROP FUNCTION IF EXISTS public.get_order_material_status(uuid);

-- 4) DEFAULT 'LIBERADO' — sem isto, OPs novas continuariam nascendo com o
--    status fictício mesmo depois do trigger removido.
ALTER TABLE public.orders ALTER COLUMN material_status DROP DEFAULT;

-- 5) Zera os valores fictícios já gravados. 100% das rows em produção estão
--    em 'LIBERADO' (saída única possível do mecanismo com BOM vazio), então o
--    WHERE estrito limpa exatamente a ficção e nada mais. NULL = "não
--    calculado", que é a verdade — a disponibilidade real é consultada no
--    momento pelo modal de consumo, não por esta coluna.
UPDATE public.orders
SET material_status = NULL
WHERE material_status = 'LIBERADO';
