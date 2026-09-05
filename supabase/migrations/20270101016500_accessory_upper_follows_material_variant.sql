-- Material adicional do mesmo Cabedal acompanha a variante sem perder sua
-- área. I701 usa 2,74 + 2,28 dm²/par: as duas partes devem consumir o mesmo
-- GLOW METALIC + MASSABOX, com uma única reserva física após a soma.
-- Pins explícitos e materiais adicionais diferentes permanecem independentes.
-- O motor escalar já delega ao motor por grade; snapshots antigos não mudam.
DO $migration$
DECLARE
  v_definition text;
  v_before text := $before$      IF v_pid IS NULL AND COALESCE(v_item ->> 'material', '') <> '' THEN
        SELECT product_id INTO v_pid FROM resolve_material_product(v_item ->> 'material', p_color, v_required, false);
      END IF;$before$;
  v_after text := $after$      -- extra_upper_variant_identity_165
      v_extra_upper_match := NULL;
      IF v_pid IS NULL AND COALESCE(v_item ->> 'material', '') <> '' THEN
        IF NULLIF(btrim(v_item ->> 'product_id'), '') IS NULL
           AND NULLIF(btrim(v_item ->> 'id'), '') IS NULL
           AND COALESCE((v_item ->> 'leftover')::boolean, false) = false
           AND lower(btrim(v_item ->> 'material')) = lower(btrim(v_sheet.upper_material)) THEN
          -- É outra peça do mesmo material principal, não uma camada fixa.
          -- Reutiliza a precedência e a proteção de cor do Cabedal composto.
          SELECT resolved.product_id, resolved.matched_by
            INTO v_pid, v_extra_upper_match
            FROM public.resolve_upper_material_for_variant(
              p_material_variant_id, v_sheet.upper_material, p_color,
              v_required, v_sheet.upper_material_product_id
            ) resolved;
        ELSE
          SELECT product_id INTO v_pid FROM resolve_material_product(v_item ->> 'material', p_color, v_required, false);
        END IF;
      END IF;$after$;
BEGIN
  SELECT pg_get_functiondef(
    'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure
  ) INTO v_definition;
  IF position('extra_upper_variant_identity_165' IN v_definition) > 0 THEN RETURN; END IF;

  IF (length(v_definition) - length(replace(v_definition, v_before, ''))) / length(v_before) <> 1
     OR position('  v_pid uuid;' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Motor de consumo divergiu do bloco esperado de adicionais do Cabedal; revise a migration165.';
  END IF;
  v_definition := replace(v_definition, '  v_pid uuid;', E'  v_pid uuid;\n  v_extra_upper_match text;');
  v_definition := replace(v_definition, v_before, v_after);

  v_before := '              v_result, v_pid, v_required, v_total_qty, v_row.avail';
  v_after := $after$              v_result, v_pid, v_required, v_total_qty,
              CASE WHEN v_extra_upper_match = 'color_mismatch' THEN 0 ELSE v_row.avail END$after$;
  IF (length(v_definition) - length(replace(v_definition, v_before, ''))) / length(v_before) <> 1 THEN
    RAISE EXCEPTION 'Merge do adicional de Cabedal não corresponde ao contrato esperado.';
  END IF;
  v_definition := replace(v_definition, v_before, v_after);

  v_before := $before$              'available', v_row.avail, 'stock_ok', v_row.avail >= v_required,
              'debit_mode', 'soft', 'source', 'component_accessory', 'unit', v_conv.target_unit,$before$;
  v_after := $after$              'available', v_row.avail,
              'stock_ok', v_extra_upper_match IS DISTINCT FROM 'color_mismatch' AND v_row.avail >= v_required,
              'debit_mode', 'soft', 'source', 'component_accessory', 'unit', v_conv.target_unit,
              'matched_by', v_extra_upper_match,$after$;
  IF (length(v_definition) - length(replace(v_definition, v_before, ''))) / length(v_before) <> 1 THEN
    RAISE EXCEPTION 'Linha do adicional de Cabedal não corresponde ao contrato esperado.';
  END IF;
  v_definition := replace(v_definition, v_before, v_after);
  EXECUTE v_definition;
END
$migration$;
