-- =============================================================================
-- AUDITORIA CUSTEIO: MOD (mão-de-obra) sempre R$0 — fonte errada
-- =============================================================================
-- calculate_order_cost_item lia technical_sheet_operations (+ JOIN labor_costs)
-- pra MOD, mas essa tabela NUNCA é populada. A Cronoanálise (apply_time_study_to_bom)
-- grava standard_time_minutes + cost_per_hour em bom_operations. Resultado: 219
-- order_costs calculados, 0% com MOD → margem sistematicamente superestimada.
--
-- Fix: repontar o loop de MOD pra bom_operations (tempo-padrão × custo/hora × qtd).
-- Sem dado de cronoanálise hoje (bom_operations vazia) → MOD segue 0 (zero mudança
-- no presente); ao cronometrar operações, a MO passa a entrar no custeio.
-- Patch CIRÚRGICO com guarda (aborta se o bloco original não casar → não quebra a
-- função). Idempotente: re-aplicar é no-op (bloco já está em bom_operations).
-- Aplicada via Supabase MCP em 2026-06-01.
-- =============================================================================
DO $patch$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.calculate_order_cost_item(uuid,boolean)'::regprocedure);
  src := replace(src,
$old$  FOR v_op IN
    SELECT lc.operation_name, lc.hour_cost, o.minutes_per_unit
      FROM public.technical_sheet_operations o
      JOIN public.labor_costs lc ON lc.id = o.labor_cost_id
     WHERE o.sheet_id = v_ref
  LOOP
    v_labor := v_labor + (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation', v_op.operation_name,
      'hour_cost', v_op.hour_cost,
      'minutes_per_unit', v_op.minutes_per_unit,
      'subtotal', (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty);
  END LOOP;$old$,
$new$  -- MOD (auditoria 2026-06-01): le bom_operations (onde a Cronoanalise grava
  -- standard_time_minutes + cost_per_hour via apply_time_study_to_bom). Antes
  -- lia technical_sheet_operations, NUNCA populada -> MOD sempre R$0.
  FOR v_op IN
    SELECT operation_name, cost_per_hour, standard_time_minutes
      FROM public.bom_operations
     WHERE sheet_id = v_ref AND active IS NOT FALSE
       AND standard_time_minutes IS NOT NULL AND cost_per_hour IS NOT NULL
  LOOP
    v_labor := v_labor + (v_op.standard_time_minutes / 60.0) * v_op.cost_per_hour * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation', v_op.operation_name,
      'hour_cost', v_op.cost_per_hour,
      'minutes_per_unit', v_op.standard_time_minutes,
      'subtotal', (v_op.standard_time_minutes / 60.0) * v_op.cost_per_hour * v_qty);
  END LOOP;$new$);
  IF position('bom_operations' in src) = 0 THEN
    RAISE EXCEPTION 'Patch MOD nao aplicou: bloco original nao casou (texto/whitespace divergente)';
  END IF;
  EXECUTE src;
END $patch$;
