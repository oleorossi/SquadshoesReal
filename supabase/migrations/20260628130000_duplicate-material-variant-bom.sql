-- =============================================================================
-- RPC duplicate_material_variant_bom — copiar BOM específico de uma variante
-- =============================================================================
-- CONTEXTO: A migration 20260525140000 criou a coluna `material_variant_id`
-- em `sheet_materials`, permitindo BOMs específicos por variante. Mas a UI
-- só permite criar variante zerada — sem reaproveitar o BOM de outra.
--
-- ESTE RPC: dado (source_variant, target_variant, sheet), copia as linhas de
-- `sheet_materials` que pertencem APENAS à source (material_variant_id =
-- source_id) e cria cópias atreladas à target.
--
-- IMPORTANTE — o que NÃO é copiado:
--   • Linhas com material_variant_id IS NULL (compartilhadas) — elas já valem
--     automaticamente pra TODAS as variantes via get_effective_bom(). Copiar
--     viraria override desnecessário e quebraria a herança automática.
--   • Linhas de OUTRAS variantes — só interessa o BOM da source.
--
-- IDEMPOTÊNCIA: NOT EXISTS check evita duplicar product_id que a target já
-- tenha. Re-chamar a RPC vira no-op.
-- =============================================================================

DROP FUNCTION IF EXISTS public.duplicate_material_variant_bom(uuid, uuid, uuid) CASCADE;

CREATE OR REPLACE FUNCTION public.duplicate_material_variant_bom(
  p_source_variant_id uuid,
  p_target_variant_id uuid,
  p_sheet_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copied_count integer := 0;
  v_source_sheet_id uuid;
  v_target_sheet_id uuid;
BEGIN
  IF p_source_variant_id IS NULL OR p_target_variant_id IS NULL OR p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'Parâmetros obrigatórios: source_variant_id, target_variant_id, sheet_id';
  END IF;

  IF p_source_variant_id = p_target_variant_id THEN
    RAISE EXCEPTION 'source_variant_id e target_variant_id devem ser diferentes';
  END IF;

  SELECT reference_id INTO v_source_sheet_id
  FROM public.reference_material_variants
  WHERE id = p_source_variant_id;

  SELECT reference_id INTO v_target_sheet_id
  FROM public.reference_material_variants
  WHERE id = p_target_variant_id;

  IF v_source_sheet_id IS NULL THEN
    RAISE EXCEPTION 'Variante de origem não encontrada (id=%)', p_source_variant_id;
  END IF;

  IF v_target_sheet_id IS NULL THEN
    RAISE EXCEPTION 'Variante de destino não encontrada (id=%)', p_target_variant_id;
  END IF;

  IF v_source_sheet_id <> p_sheet_id OR v_target_sheet_id <> p_sheet_id THEN
    RAISE EXCEPTION 'Variantes precisam pertencer à mesma ficha técnica (sheet_id=%)', p_sheet_id;
  END IF;

  WITH inserted AS (
    INSERT INTO public.sheet_materials (
      sheet_id, product_id, quantity_per_unit, color, width, weight,
      supplier, notes, sizes, material_variant_id
    )
    SELECT
      sm.sheet_id,
      sm.product_id,
      sm.quantity_per_unit,
      sm.color,
      sm.width,
      sm.weight,
      sm.supplier,
      sm.notes,
      sm.sizes,
      p_target_variant_id
    FROM public.sheet_materials sm
    WHERE sm.sheet_id = p_sheet_id
      AND sm.material_variant_id = p_source_variant_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.sheet_materials sm2
        WHERE sm2.sheet_id = p_sheet_id
          AND sm2.material_variant_id = p_target_variant_id
          AND sm2.product_id = sm.product_id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_copied_count FROM inserted;

  RETURN v_copied_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.duplicate_material_variant_bom(uuid, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.duplicate_material_variant_bom(uuid, uuid, uuid) IS
  'Copia linhas de sheet_materials específicas da variante origem para a variante destino. '
  'NÃO copia linhas compartilhadas (material_variant_id IS NULL) — elas já valem pra todas '
  'as variantes via get_effective_bom(). Idempotente: re-chamar não duplica product_id já '
  'presentes na target. Retorna quantidade de linhas inseridas.';
