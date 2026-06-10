-- AUDITORIA PV 2026-06-10 (D1): check_stock_availability comparava required
-- CRU (dm² pra material de área) com estoque em metros → falta falsa ~100×
-- no pré-check de aprovação e nas OCs automáticas. Conversão SÓ no loop de
-- sheet_materials (tiras são cm nativo), pelo produto-alvo pós swap de cor.
DO $patch$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
    FROM pg_proc WHERE proname='check_stock_availability' AND pronamespace='public'::regnamespace;
  IF v_src IS NULL THEN RAISE WARNING 'check_stock_availability não encontrada'; RETURN; END IF;
  IF v_src LIKE '%conv-d1%' THEN RETURN; END IF;

  v_src := replace(v_src, E'DECLARE\n', E'DECLARE\n  v_conv RECORD;\n');

  IF position($a$        v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
      END IF;
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;$a$ IN v_src) = 0 THEN
    RAISE WARNING 'check_stock_availability: âncora não encontrada — patch D1 NÃO aplicado';
    RETURN;
  END IF;

  v_src := replace(v_src,
$a$        v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
      END IF;
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;$a$,
$a$        v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
      END IF;
    END IF;

    -- conv-d1 (auditoria 2026-06-10): material de área em dm²/par → unidade
    -- física do produto-alvo pela largura da ficha de componente (+ perda%).
    SELECT * INTO v_conv FROM public.get_material_conversion_info(v_target_id);
    IF COALESCE(v_conv.dm2_per_unit, 1) > 0 AND COALESCE(v_conv.dm2_per_unit, 1) <> 1 THEN
      v_required := (v_required / v_conv.dm2_per_unit) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;$a$);

  EXECUTE v_src;
END
$patch$;
