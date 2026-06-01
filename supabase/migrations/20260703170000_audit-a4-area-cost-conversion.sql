-- =============================================================================
-- AUDITORIA A4 (alto): custo de material de ÁREA (sole_standard_items) zerado.
-- =============================================================================
-- sole_standard_items são emitidas com unit='dm²' mas o produto (NAPA/couro) tem
-- unit='m'. convert_to_product_unit detecta area×length → NULL → a linha cai em
-- warning 'unit_mismatch' com subtotal=0 (≠ cabedal/forro/palmilha, que já vêm
-- convertidos do by_grade). 19/217 order_costs com unit_mismatch → custo de napa
-- cortada via itens-padrão silenciosamente zerado, inflando margem.
--
-- Fix: em calculate_order_cost_item, ANTES de desistir (NULL), converte dm²→unidade
-- física do produto pela LARGURA da ficha via get_material_conversion_info (mesmo
-- caminho do cabedal). Só atua quando a unidade da linha é área; outros mismatches
-- continuam virando warning. Patch cirúrgico (dollar-quote evita escapar aspas).
-- =============================================================================
DO $patch$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.calculate_order_cost_item(uuid,boolean)'::regprocedure);

  -- 1) novas variáveis
  src := replace(src,
    $r$  v_scaled_subtotal numeric;$r$,
    $r$  v_scaled_subtotal numeric;
  v_conv4 record;
  v_dm2_norm numeric;$r$);

  -- 2) tenta conversão de ÁREA pela largura da ficha antes de marcar unit_mismatch
  src := replace(src,
    $r$    IF v_required_in_product_unit IS NULL THEN$r$,
    $r$    IF v_required_in_product_unit IS NULL THEN
      -- A4: material de área (dm²) com produto linear/placa — converte pela largura da ficha
      v_dm2_norm := public.convert_to_product_unit((v_line ->> 'required')::numeric, v_line ->> 'unit', 'dm²');
      IF v_dm2_norm IS NOT NULL THEN
        SELECT * INTO v_conv4 FROM public.get_material_conversion_info((v_line ->> 'product_id')::uuid);
        IF v_conv4.dm2_per_unit IS NOT NULL AND v_conv4.dm2_per_unit > 0 THEN
          v_required_in_product_unit := v_dm2_norm / v_conv4.dm2_per_unit;
        END IF;
      END IF;
    END IF;
    IF v_required_in_product_unit IS NULL THEN$r$);

  EXECUTE src;
END $patch$;
