-- ============================================================================
-- COMPRAS POR PEDIDO (canal paralelo ao MRP/ondas)
-- ============================================================================
-- Permite gerar Ordens de Compra (OC) a partir de UM pedido (PV) ou de um
-- conjunto de PVs selecionados — uma OC por fornecedor + uma OC agrupada pros
-- itens sem fornecedor. Esse canal é SEPARADO do MRP/ondas (que agrega tudo
-- até um prazo), pra não duplicar compra.
--
-- Distinção do canal:
--   - purchase_orders.source_type:
--       'manual'  → criação avulsa (default; inclui o que o MRP cria hoje, que
--                   nunca seta source_type)
--       'mrp'     → reservado pra futura marcação explícita do MRP
--       'per_pv'  → criada por este canal (modal "Materiais necessários do PV")
--   - purchase_orders.source_pv_ids → PVs que originaram a OC quando per_pv.
--     (coluna DEDICADA, separada de linked_sale_order_ids, que é usada pela
--      agregação do MRP/auto-PO — assim a aba "Compras deste PV" e o filtro do
--      menu tradicional não se misturam com as OCs agregadas.)
--
-- A listagem tradicional (/purchase-orders) esconde source_type='per_pv' por
-- padrão (toggle no frontend). A aba "Compras deste PV" (no detalhe do PV) e a
-- rota /purchase-orders/per-pv consultam exatamente essas.
-- ============================================================================

-- 1) Colunas de origem ---------------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual';

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS source_pv_ids uuid[];

COMMENT ON COLUMN public.purchase_orders.source_type IS
  'Canal de origem da OC: manual (avulsa/MRP legado) | mrp | per_pv (canal '
  '"Compras por Pedido"). per_pv é escondida do menu tradicional por padrão.';
COMMENT ON COLUMN public.purchase_orders.source_pv_ids IS
  'PVs que originaram esta OC quando source_type=per_pv. Coluna dedicada, '
  'separada de linked_sale_order_ids (usada pela agregação do MRP/auto-PO).';

-- Constraint de domínio (idempotente). Todas as rows existentes já viram
-- 'manual' pelo DEFAULT no ADD COLUMN, então validar é seguro.
ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS chk_purchase_orders_source_type;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_source_type
  CHECK (source_type IN ('manual', 'mrp', 'per_pv'));

-- 2) Índices -------------------------------------------------------------------
-- Filtro do menu tradicional ("esconder per_pv") — índice parcial só nas per_pv,
-- que são minoria, pra acelerar tanto o filtro quanto a rota dedicada.
CREATE INDEX IF NOT EXISTS idx_purchase_orders_per_pv
  ON public.purchase_orders (created_at DESC)
  WHERE source_type = 'per_pv';

-- Busca "OCs deste PV" por elemento do array (source_pv_ids @> ARRAY[pv]).
CREATE INDEX IF NOT EXISTS idx_purchase_orders_source_pv_ids
  ON public.purchase_orders USING GIN (source_pv_ids);

-- 3) RPC de cálculo: materiais necessários por PV ------------------------------
-- Thin wrapper sobre get_wave_material_needs (a função CANÔNICA de demanda por
-- sale_order — já aplica conversão dm²→unidade física via
-- get_material_conversion_info e desconta reserva/estoque). Aqui só anexamos
-- last_unit_price (custo padrão do produto) pra estimar o valor da OC. NÃO
-- reimplementamos a demanda — assim este canal nunca diverge do motor de ondas.
CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
RETURNS TABLE(
  material_id      uuid,
  product_name     text,
  unit             text,
  color            text,
  needed_qty       numeric,
  stock_qty        numeric,
  shortage         numeric,
  supplier_id      uuid,
  supplier_name    text,
  last_unit_price  numeric,
  is_artisanal     boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    w.product_id              AS material_id,
    w.product_name,
    w.unit,
    w.color,
    w.needed_qty,
    w.stock_qty,
    w.shortage,
    w.supplier_id,
    w.supplier_name,
    COALESCE(p.unit_price, 0) AS last_unit_price,
    w.is_artisanal
  FROM public.get_wave_material_needs(p_pv_ids) w
  LEFT JOIN public.products p ON p.id = w.product_id
  ORDER BY w.supplier_name NULLS LAST, w.product_name;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_materials_per_pv(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.compute_materials_per_pv(uuid[]) IS
  'Materiais necessários para um conjunto de PVs (canal "Compras por Pedido"). '
  'Wrapper sobre get_wave_material_needs + last_unit_price. Não duplica a '
  'fórmula do MRP — reusa a função canônica de demanda por sale_order.';
