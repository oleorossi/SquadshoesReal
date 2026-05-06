DROP FUNCTION IF EXISTS public.propagate_component_sole_to_sheets(
  p_component_sheet_id uuid,
  p_sole_group_id uuid
) CASCADE;
CREATE OR REPLACE FUNCTION public.propagate_component_sole_to_sheets(
  p_component_sheet_id uuid,
  p_sole_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_component_group_id uuid;
  v_component_product_id uuid;
  v_sheets_updated int := 0;
  v_sheet_record record;
  v_sole_product record;
BEGIN
  -- 1) Atualiza o próprio component_sheet (e fichas irmãs do mesmo grupo)
  SELECT cs.group_id, cs.product_id 
    INTO v_component_group_id, v_component_product_id
  FROM component_sheets cs
  WHERE cs.id = p_component_sheet_id;

  IF v_component_group_id IS NOT NULL THEN
    UPDATE component_sheets 
       SET default_sole_group_id = p_sole_group_id, 
           updated_at = now()
     WHERE group_id = v_component_group_id;
  ELSE
    UPDATE component_sheets 
       SET default_sole_group_id = p_sole_group_id, 
           updated_at = now()
     WHERE id = p_component_sheet_id;
  END IF;

  -- 2) Para cada technical_sheet que usa este componente (via bill_of_materials ou materials_data),
  --    insere/atualiza registros em technical_sheet_sole_colors com cada produto do grupo de solado
  FOR v_sheet_record IN
    SELECT DISTINCT ts.id AS sheet_id
    FROM technical_sheets ts
    LEFT JOIN bill_of_materials bom ON bom.master_id = ts.master_id
    LEFT JOIN products p_bom ON p_bom.id = bom.material_id
    WHERE 
      -- Match por bill_of_materials (variantes do mesmo grupo)
      p_bom.group_id = COALESCE(v_component_group_id, (SELECT group_id FROM products WHERE id = v_component_product_id))
      OR p_bom.id = v_component_product_id
      -- Match por materials_data JSONB
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(ts.materials_data, '[]'::jsonb)) AS m
        WHERE (m->>'product_id')::uuid = v_component_product_id
           OR (m->>'group_id')::uuid = v_component_group_id
      )
  LOOP
    -- Para cada produto do grupo de solado, criar/atualizar mapeamento
    FOR v_sole_product IN
      SELECT id, color FROM products WHERE group_id = p_sole_group_id
    LOOP
      INSERT INTO technical_sheet_sole_colors (
        sheet_id, sole_group_id, sole_product_id, product_color
      ) VALUES (
        v_sheet_record.sheet_id, 
        p_sole_group_id, 
        v_sole_product.id,
        COALESCE(v_sole_product.color, 'Padrão')
      )
      ON CONFLICT (sheet_id, product_color) 
      DO UPDATE SET 
        sole_group_id = EXCLUDED.sole_group_id,
        sole_product_id = EXCLUDED.sole_product_id;
    END LOOP;

    -- Atualiza também o sole_group_id da própria technical_sheet
    UPDATE technical_sheets 
       SET sole_group_id = p_sole_group_id, 
           updated_at = now() 
     WHERE id = v_sheet_record.sheet_id;

    v_sheets_updated := v_sheets_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'sheets_updated', v_sheets_updated,
    'sole_group_id', p_sole_group_id
  );
END;
$$;

-- Garantir índice único para o ON CONFLICT funcionar
CREATE UNIQUE INDEX IF NOT EXISTS uq_technical_sheet_sole_colors_sheet_color 
ON public.technical_sheet_sole_colors(sheet_id, product_color);

GRANT EXECUTE ON FUNCTION public.propagate_component_sole_to_sheets(uuid, uuid) TO authenticated;