-- ============================================================================
-- C4 complemento (auditoria 2026-06-09): BOM de área também na versão
-- SINGLE-SIZE de calculate_order_consumption.
--
-- A by_grade foi corrigida em 20260721150000. A single-size mantinha
-- required = quantity_per_unit × qtd cru (dm² pra material de área) e
-- available bruto. Hoje todos os itens de PV têm grade (279/279), e o único
-- consumidor da single-size é fn_projected_demand — que compensa dividindo
-- linhas com unit IS NULL por dm2_per_unit (mas SEM perda%). Este patch:
--   1. converte dentro da função (com perda%) e emite 'unit' → o
--      fn_projected_demand passa a linha direto (sem dupla conversão);
--   2. available passa a deduzir reserved_stock;
--   3. cobre itens futuros sem grade no custeio.
--
-- Patch cirúrgico idempotente sobre a definição viva (a função é grande e o
-- repo tem histórico divergente): se o padrão-base não existir, WARNING e
-- aborta sem quebrar o deploy.
-- ============================================================================
DO $patch$
DECLARE
  v_src text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc
   WHERE proname = 'calculate_order_consumption'
     AND pronamespace = 'public'::regnamespace
     AND pg_get_function_identity_arguments(oid) LIKE '%p_order_quantity%';

  IF v_src IS NULL THEN
    RAISE WARNING 'calculate_order_consumption não encontrada — patch single-size BOM NÃO aplicado';
    RETURN;
  END IF;
  IF v_src LIKE '%conv-bom-c4-single%' THEN
    RETURN; -- idempotente
  END IF;

  v_old := $old$    v_required := v_row.quantity_per_unit * p_order_quantity;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', v_row.quantity_per_unit,
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category);$old$;

  v_new := $new$    v_required := v_row.quantity_per_unit * p_order_quantity;
    -- conv-bom-c4-single (auditoria 2026-06-09): material de área em dm²/par
    -- → unidade física pela largura da ficha de componente (+ perda%).
    SELECT * INTO v_conv FROM get_material_conversion_info(v_row.product_id);
    IF COALESCE(v_conv.dm2_per_unit, 1) > 0 AND COALESCE(v_conv.dm2_per_unit, 1) <> 1 THEN
      v_required := (v_required / v_conv.dm2_per_unit) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    END IF;
    v_result := v_result || jsonb_build_object(
      'component', 'BOM', 'product_id', v_row.product_id, 'product_name', v_row.name,
      'color', v_row.product_color, 'consumption_per_unit', ROUND(v_required / NULLIF(p_order_quantity, 0), 4),
      'required', v_required, 'available', v_row.available,
      'stock_ok', v_row.available >= v_required,
      'debit_mode', CASE WHEN LOWER(COALESCE(v_row.category,'')) IN
        ('acessório','embalagem','cola / químico','ferramentas','solado') THEN 'hard' ELSE 'soft' END,
      'source', 'sheet_materials', 'category', v_row.category,
      'unit', v_conv.target_unit, 'conversion_warning', v_conv.conversion_warning);$new$;

  IF position(v_old IN v_src) = 0 THEN
    RAISE WARNING 'calculate_order_consumption: bloco BOM não encontrado — patch NÃO aplicado (verificar manualmente)';
    RETURN;
  END IF;
  v_src := replace(v_src, v_old, v_new);

  -- available líquido de reserva no SELECT do loop BOM
  v_src := replace(v_src,
    'SELECT sm.product_id, sm.quantity_per_unit, p.name, p.quantity AS available, p.category, p.color AS product_color',
    'SELECT sm.product_id, sm.quantity_per_unit, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available, p.category, p.color AS product_color');

  EXECUTE v_src;
  RAISE NOTICE 'calculate_order_consumption: patch single-size BOM aplicado';
END
$patch$;
