-- Restaura COLA FORTE = 14 g/par na fonte canônica do SOLADO 01.
--
-- Achado na auditoria do motor (2026-09-14): `run_consumption_parity_tests()`
-- falhava em `cola_forte_14g_versionada` porque o valor vivo tinha driftado
-- para 10 g/par (atualizado em 2026-09-13). A migration
-- `20270101013650_corrigir_previa_consumo_colas_solado` já havia versionado
-- 14 g/par como canônico (incidente PV-00167 / prévia 1000×).
--
-- Não inventa cadastro novo: só corrige a linha existente por chaves naturais
-- (SKU + nome do material + nome/setor do grupo). Aborta se o match ≠ 1.

DO $restore_cola_forte$
DECLARE
  v_updated integer;
  v_before numeric;
  v_unit text;
BEGIN
  SELECT sgsi.consumption_per_pair, sgsi.unit
    INTO v_before, v_unit
    FROM public.sole_group_standard_items sgsi
    JOIN public.products material ON material.id = sgsi.material_product_id
    JOIN public.product_groups sole_group ON sole_group.id = sgsi.sole_group_id
   WHERE material.sku = '0000568.00000.00000'
     AND material.name = 'COLA FORTE'
     AND sole_group.name = 'SOLADO 01'
     AND sole_group.sector = 'Solado'
     AND sgsi.role IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'COLA FORTE canônica: linha do SOLADO 01 não encontrada (sku 0000568.00000.00000)';
  END IF;

  IF v_before = 14 AND lower(v_unit) = 'g' THEN
    RAISE NOTICE 'COLA FORTE já está em 14 g/par — noop';
    RETURN;
  END IF;

  UPDATE public.sole_group_standard_items sgsi
     SET consumption_per_pair = 14,
         unit = 'g',
         updated_at = now()
    FROM public.products material,
         public.product_groups sole_group
   WHERE material.id = sgsi.material_product_id
     AND material.sku = '0000568.00000.00000'
     AND material.name = 'COLA FORTE'
     AND sole_group.id = sgsi.sole_group_id
     AND sole_group.name = 'SOLADO 01'
     AND sole_group.sector = 'Solado'
     AND sgsi.role IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'COLA FORTE canônica: esperava atualizar 1 linha do SOLADO 01 (antes=% %%), atualizou %',
      v_before, v_unit, v_updated;
  END IF;

  RAISE NOTICE 'COLA FORTE restaurada: % % → 14 g/par', v_before, v_unit;
END
$restore_cola_forte$;

-- Trava viva: o guard de paridade deve voltar a verde neste case.
DO $assert_cola_forte$
DECLARE
  v_ok boolean;
  v_message text;
BEGIN
  SELECT ok, message
    INTO v_ok, v_message
    FROM public.run_consumption_parity_tests()
   WHERE case_name = 'cola_forte_14g_versionada';

  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'Guard cola_forte_14g_versionada ainda vermelho após restore: %',
      coalesce(v_message, 'case ausente');
  END IF;
END
$assert_cola_forte$;
