-- =============================================================================
-- AUDITORIA A3 (alto): try_reserve_materials × hybrid_debit divergem no BOM de área
-- =============================================================================
-- Na recriação de OPs, try_reserve_materials roda primeiro e reserva os materiais de
-- ESPECIFICAÇÃO (cabedal/forro/palmilha) por consumo × qtd CRU (dm²/par), sem
-- converter pela largura da ficha — diferente do by_grade/snapshot, que converte
-- dm²→unidade física via get_material_conversion_info. Como hybrid_debit(force_soft)
-- tem guarda EXISTS material_reservations → idempotent_skip, a reserva inflada (~100×)
-- do try_reserve é a que fica, inflando reserved_stock e disparando POs por falsa falta.
--
-- Fix: no loop de spec (upper/lining/insole — sempre material de ÁREA, igual ao que o
-- by_grade converte), converte v_demand dm²→unidade física pela largura da ficha antes
-- de reservar/comprar. Loop de BOM/diretos fica como está (espelha o by_grade, que
-- também emite cru — divergência conhecida modal×SQL, fora do escopo do A3).
-- Patch cirúrgico (ancorado em 'R1 ' || v_spec_name, único do loop de spec).
-- =============================================================================
DO $patch$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.try_reserve_materials(uuid,uuid,numeric,text,date,boolean,boolean,text,boolean,boolean)'::regprocedure);

  -- 1) nova variável de conversão
  src := replace(src,
    $r$  v_spec_consumption numeric; v_spec_material text; v_result jsonb;$r$,
    $r$  v_spec_consumption numeric; v_spec_material text; v_result jsonb;
  v_conv4 record;$r$);

  -- 2) converte v_demand dm²→unidade física no loop de spec, antes de reservar
  src := replace(src,
    $r$    v_demand_with_safety := v_demand + v_safety;
    IF v_available >= v_demand_with_safety THEN
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
      VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1 ' || v_spec_name);$r$,
    $r$    -- A3: cabedal/forro/palmilha têm consumo em dm²/par → converte p/ a unidade física
    -- do produto pela largura da ficha (igual ao by_grade), senão reserva ~100x inflado.
    SELECT * INTO v_conv4 FROM public.get_material_conversion_info(v_target_id);
    IF v_conv4.dm2_per_unit IS NOT NULL AND v_conv4.dm2_per_unit > 0 THEN
      v_demand := (v_demand / v_conv4.dm2_per_unit) * (1 + COALESCE(v_conv4.waste_pct, 0) / 100);
    END IF;
    v_demand_with_safety := v_demand + v_safety;
    IF v_available >= v_demand_with_safety THEN
      INSERT INTO material_reservations (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, source, batch_id, notes)
      VALUES (p_order_id, v_target_id, v_demand, 0, 'reserved', 'soft', 'onhand', v_batch_id, 'R1 ' || v_spec_name);$r$);

  EXECUTE src;
END $patch$;
