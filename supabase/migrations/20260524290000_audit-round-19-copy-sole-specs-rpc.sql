-- =============================================================================
-- AUDIT ROUND 19 — RPC pra copiar specs de solado
-- =============================================================================
-- User: "Essas fichas com solado sem consumo, pode usar como base um produto
--        com o mesmo solado, depois eu coloco os dados corretos."
--
-- Hoje existe tryLoadReferenceSpecs no frontend mas filtra apenas por nome
-- similar. Operador pode querer copiar de QUALQUER solado com specs.
--
-- Fix:
--   - RPC copy_sole_specs_from(p_source_id, p_target_id, p_overwrite)
--     Copia sole_technical_specs + sole_structures (forro/palmilha).
--     Marca cada linha com reference_sole_id = p_source_id e reference_date
--     pra audit trail.
--     p_overwrite=false: erra se target já tem specs.
--     p_overwrite=true: substitui tudo no target.
--
--   - View v_soles_with_specs: lista solados que têm specs cadastradas
--     (pra UI mostrar opções selecionáveis).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.copy_sole_specs_from(
  p_source_sole_id uuid,
  p_target_sole_id uuid,
  p_overwrite boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source_count int;
  v_target_count int;
  v_copied_specs int := 0;
  v_copied_structs int := 0;
BEGIN
  IF p_source_sole_id IS NULL OR p_target_sole_id IS NULL THEN
    RAISE EXCEPTION 'IDs origem e destino são obrigatórios';
  END IF;
  IF p_source_sole_id = p_target_sole_id THEN
    RAISE EXCEPTION 'IDs origem e destino são iguais';
  END IF;

  -- Source precisa ter specs
  SELECT COUNT(*) INTO v_source_count
    FROM sole_technical_specs WHERE sole_id = p_source_sole_id;
  IF v_source_count = 0 THEN
    RAISE EXCEPTION 'Solado origem (%) não tem specs cadastradas', p_source_sole_id;
  END IF;

  -- Target check
  SELECT COUNT(*) INTO v_target_count
    FROM sole_technical_specs WHERE sole_id = p_target_sole_id;
  IF v_target_count > 0 AND NOT p_overwrite THEN
    RAISE EXCEPTION 'Solado destino já tem % specs cadastradas. Use p_overwrite=true pra substituir.', v_target_count;
  END IF;

  -- Limpa target se overwrite
  IF p_overwrite THEN
    DELETE FROM sole_technical_specs WHERE sole_id = p_target_sole_id;
    DELETE FROM sole_structures WHERE sole_id = p_target_sole_id;
  END IF;

  -- Copia specs marcando reference_sole_id e reference_date pra audit trail.
  -- Mantém todos os campos relevantes: lining/insole/fachete dm² + size + consumption.
  INSERT INTO sole_technical_specs (
    sole_id, size,
    lining_consumption_dm2, insole_consumption_dm2,
    fachete_lining_consumption_dm2, consumption,
    reference_sole_id, reference_date
  )
  SELECT
    p_target_sole_id, size,
    lining_consumption_dm2, insole_consumption_dm2,
    fachete_lining_consumption_dm2, consumption,
    p_source_sole_id, now()
  FROM sole_technical_specs
  WHERE sole_id = p_source_sole_id;
  GET DIAGNOSTICS v_copied_specs = ROW_COUNT;

  -- Copia structures (forro/palmilha defaults)
  INSERT INTO sole_structures (
    sole_id, component_type, default_group_id,
    lining_material_id, insole_material_id
  )
  SELECT
    p_target_sole_id, component_type, default_group_id,
    lining_material_id, insole_material_id
  FROM sole_structures
  WHERE sole_id = p_source_sole_id;
  GET DIAGNOSTICS v_copied_structs = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'copied_specs', v_copied_specs,
    'copied_structures', v_copied_structs,
    'source_sole_id', p_source_sole_id,
    'target_sole_id', p_target_sole_id,
    'overwrite', p_overwrite
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.copy_sole_specs_from(uuid, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.copy_sole_specs_from(uuid, uuid, boolean) IS
  'Copia sole_technical_specs + sole_structures de um solado pra outro. '
  'Marca reference_sole_id pra audit. p_overwrite controla se sobrescreve target.';


-- ─── View: solados com specs disponíveis (pra UI seletor) ─────────────────

CREATE OR REPLACE VIEW public.v_soles_with_specs AS
SELECT
  p.id,
  p.name,
  p.color,
  p.sku,
  COALESCE(p.is_fachetado, false) AS is_fachetado,
  -- Quantos tamanhos
  (SELECT COUNT(*) FROM sole_technical_specs WHERE sole_id = p.id) AS sizes_count,
  -- Tamanhos numa string ordenada (ex: "33-42")
  (SELECT string_agg(DISTINCT size::text, ', ' ORDER BY size::text)
     FROM sole_technical_specs WHERE sole_id = p.id) AS sizes_list,
  -- Última atualização
  (SELECT MAX(updated_at) FROM sole_technical_specs WHERE sole_id = p.id) AS last_updated_at,
  -- Quantas fichas usam
  (SELECT COUNT(DISTINCT sheet_id) FROM technical_sheet_sole_colors WHERE sole_product_id = p.id) AS sheets_using
FROM products p
WHERE EXISTS (
  SELECT 1 FROM sole_technical_specs WHERE sole_id = p.id
);

GRANT SELECT ON public.v_soles_with_specs TO authenticated;
