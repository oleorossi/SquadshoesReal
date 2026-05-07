-- =============================================================================
-- AUDITORIA ROUND 4: Edge functions, pg_cron, auth, data integrity, suppliers
-- =============================================================================
-- Áreas auditadas (todas com resultado positivo):
--   ✅ Edge functions: 10 ativas, 4 com verify_jwt=false validam JWT manualmente
--      (time-control, emit-nfe, nfe-status, recolor-image — todas seguras)
--   ✅ emit-nfe: production-grade (idempotência via uq_nfe_active_per_sale_order,
--      validação CNPJ/IE/CEP/NCM/CFOP, race-aware, reconciliação manual)
--   ✅ pg_cron: extensão ativa, zero scheduled jobs (não é problema)
--   ✅ Auth/Profiles: 1 user / 1 profile / 1 user_role — 100% consistente
--   ✅ Data integrity: 0 órfãos em 7 FKs críticas (orders, sale_orders, products,
--      employees, employee_advances, stock_movements, order_stages)
--
-- 🔴 ACHADO REAL: 115/133 produtos ativos (86%) sem supplier_id
--    → 11 suppliers cadastrados, só 18 produtos vinculados
--    → 33 produtos abaixo_minimo sem supplier (urgente em médio prazo)
--    → 0 em PVs ATIVOS no momento (não-urgente imediato)
--    → R$ 18k em estoque "órfão" de fornecedor formal
--    → Quebra automação de OC silenciosamente: MaterialPurchaseConfirmDialog
--      filtra "if (!supplier.supplier_id)" e dá warning toast.
--
-- Esta migration cria helper view + função pra admin localizar e corrigir.
-- Não faz backfill automático — supplier por produto é decisão humana.
-- Aplicada em produção via Supabase MCP em 2026-05-07.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_products_missing_supplier AS
SELECT
  p.id, p.name, p.sku, p.category, p.color,
  p.unit, p.quantity, p.min_stock,
  COALESCE(p.unit_price, 0) AS unit_price,
  ROUND((p.quantity * COALESCE(p.unit_price, 0))::numeric, 2) AS valor_estoque,
  CASE
    WHEN p.quantity < p.min_stock THEN 'abaixo_minimo'
    WHEN p.quantity = 0           THEN 'zerado'
    ELSE 'ok'
  END AS stock_status,
  pg.name AS group_name,
  -- Sugestão automática: se outro produto do mesmo group_id já tem supplier,
  -- sugere ele. Senão deixa null pro admin escolher.
  (SELECT s.name FROM public.products p2
   JOIN public.suppliers s ON s.id = p2.supplier_id
   WHERE p2.group_id = p.group_id AND p2.supplier_id IS NOT NULL AND p2.id <> p.id
   LIMIT 1) AS suggested_supplier_from_group
FROM public.products p
LEFT JOIN public.product_groups pg ON pg.id = p.group_id
WHERE p.active = true AND p.supplier_id IS NULL
ORDER BY
  CASE WHEN p.quantity < p.min_stock THEN 0 ELSE 1 END,
  p.category, p.name;
GRANT SELECT ON public.v_products_missing_supplier TO authenticated;
COMMENT ON VIEW public.v_products_missing_supplier IS
  'Lista produtos ativos sem supplier_id. Quebra silenciosamente automação de OC '
  '(MaterialPurchaseConfirmDialog pula com warning quando supplier_id é null). '
  'suggested_supplier_from_group: fornecedor de outro produto do mesmo grupo, se houver.';

-- Helper RPC: aplica fornecedor a TODOS produtos do mesmo grupo de uma vez
DROP FUNCTION IF EXISTS public.apply_supplier_to_group(uuid, uuid);
CREATE OR REPLACE FUNCTION public.apply_supplier_to_group(
  p_group_id uuid,
  p_supplier_id uuid
) RETURNS TABLE(updated_count int, sample_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count int;
  v_ids uuid[];
BEGIN
  IF p_group_id IS NULL OR p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'group_id e supplier_id são obrigatórios';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id AND active = true) THEN
    RAISE EXCEPTION 'supplier_id % não existe ou está inativo', p_supplier_id;
  END IF;

  WITH updated AS (
    UPDATE public.products
    SET supplier_id = p_supplier_id, updated_at = now()
    WHERE group_id = p_group_id AND supplier_id IS NULL AND active = true
    RETURNING id
  )
  SELECT count(*)::int, array_agg(id) INTO v_count, v_ids FROM updated;

  RETURN QUERY SELECT COALESCE(v_count, 0), COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_supplier_to_group(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.apply_supplier_to_group IS
  'Aplica supplier_id a TODOS produtos ativos do mesmo group_id que estão sem supplier. '
  'Útil pra admin corrigir batch (ex: "todos os tons de Napa Soft do mesmo fabricante").';

-- View crítica: produtos sem supplier que ESTÃO sendo consumidos em PVs ativos
-- sale_order_items.reference_id → technical_sheets.id
-- sheet_materials.sheet_id → technical_sheets.id (consumo de material por ficha)
CREATE OR REPLACE VIEW public.v_products_missing_supplier_active_demand AS
SELECT
  p.id, p.name, p.sku, p.category,
  p.quantity AS estoque_atual, p.min_stock,
  count(DISTINCT so.id) AS pvs_ativos_consumindo,
  array_agg(DISTINCT so.order_number ORDER BY so.order_number) AS pvs
FROM public.products p
JOIN public.sheet_materials sm ON sm.product_id = p.id
JOIN public.sale_order_items soi ON soi.reference_id = sm.sheet_id
JOIN public.sale_orders so ON so.id = soi.sale_order_id
WHERE p.active = true
  AND p.supplier_id IS NULL
  AND so.status IN ('Aprovado','Em Produção','Pendente')
GROUP BY p.id, p.name, p.sku, p.category, p.quantity, p.min_stock
ORDER BY count(DISTINCT so.id) DESC, p.name;
GRANT SELECT ON public.v_products_missing_supplier_active_demand TO authenticated;
COMMENT ON VIEW public.v_products_missing_supplier_active_demand IS
  'Subset crítico de v_products_missing_supplier: produtos sem fornecedor que ESTÃO '
  'sendo consumidos em PVs ativos (Aprovado/Em Produção/Pendente). Esses são os '
  'urgentes — sem supplier_id a auto-OC não dispara quando estoque cair abaixo do mínimo.';
