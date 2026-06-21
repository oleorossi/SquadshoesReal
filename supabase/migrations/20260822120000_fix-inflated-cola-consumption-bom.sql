-- Correção de consumo INFLADO de cola na BOM (sheet_materials) — 2026-06-20
-- ============================================================================
-- Auditoria do PV-00144 (modal "Materiais necessários" / Compras por Pedido):
-- COLA FORTE e COLA PVC apareciam com consumo ~10× o real. A matemática dos
-- motores está CORRETA (modal = calculate_order_consumption = quantity_per_unit
-- × pares; dm2_per_unit=1, sem bug de conversão). O problema era o VALOR
-- cadastrado em sheet_materials.quantity_per_unit:
--   COLA FORTE: cluster correto 0,0018 kg/par (4 fichas) vs inflado 0,023 (14
--               fichas) + 1 ficha absurda 0,25 (DS12 = 250 g/par).
--   COLA PVC:   cluster correto 0,0028 kg/par vs inflado 0,028/0,03 (15 fichas).
-- Todas são construction_type=corte_costura (costurado, pouca cola) → os altos
-- não são variação legítima; há fichas até internamente contraditórias (SP105,
-- EC111). HOTMELT estava consistente (0,01) → não mexido. Só COLA FORTE e COLA
-- PVC tinham essa dispersão (varredura max/min ≥ 5× em todos os materiais).
--
-- Valor correto confirmado pelo dono: FORTE 0,0018 · PVC 0,0028 kg/par.
-- Corrige só as linhas claramente infladas (> 0,01 kg/par), preservando as que
-- já estavam baixas (ex.: EC111 PVC 0,0043, ~1,5× — não é inflação 10×).
-- IDEMPOTENTE: o guard > 0.01 não recasa após a correção.
-- Aplicado via MCP em 2026-06-20.
-- ⚠ PVs que já rodaram "Calcular Custos" guardam custo de cola antigo em
--   order_costs → precisam recalcular pra refletir o valor corrigido.

UPDATE public.sheet_materials sm
   SET quantity_per_unit = 0.0018
  FROM public.products p
 WHERE p.id = sm.product_id
   AND p.name = 'COLA FORTE'
   AND sm.quantity_per_unit::numeric > 0.01;

UPDATE public.sheet_materials sm
   SET quantity_per_unit = 0.0028
  FROM public.products p
 WHERE p.id = sm.product_id
   AND p.name = 'COLA PVC'
   AND sm.quantity_per_unit::numeric > 0.01;
