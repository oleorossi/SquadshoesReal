-- Consumo: draft comprometido NÃO pode descartar tira da ficha ausente do item.
--
-- A 21100 une strap_colors da ficha no payload do batch, mas
-- preview_sale_order_strap_demand_draft (PV Aprovado+) sobrescreve com
-- v_item.strap_colors do banco — o merge vira no-op (PV-00169 / Dakotton STRASS).
--
-- Este patch: (1) mergeia no payload dos dois ramos comprometidos; (2) lookup
-- de v_stored_line usa o array mergeado (senão some group_name/label →
-- "Tira sem cadastro" e isStrassStrapRow falha); (3) marca
-- sheet_strap_missing_from_item_snapshot quando consumo_sheet_gap.
-- Idempotente: sheet_strap_gap_committed_draft_217.

DO $migration$
DECLARE
  v_definition text;
  v_count integer;
  v_strap_colors_before text := $before$'strap_colors', COALESCE(v_item.strap_colors, '[]'::jsonb),$before$;
  v_strap_colors_after text := $after$'strap_colors', private.merge_consumo_strap_colors_with_sheet_gaps(
        COALESCE(v_item.strap_colors, '[]'::jsonb),
        v_item.reference_id
      ),$after$;
  v_stored_before text := $before$      FROM pg_catalog.jsonb_array_elements(
        CASE
          WHEN pg_catalog.jsonb_typeof(v_item.strap_colors) = 'array'
            THEN v_item.strap_colors
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY line(value, ordinality)
     WHERE public.try_parse_uuid(
             line.value ->> 'technical_strap_line_id'
           ) IS NOT DISTINCT FROM v_preview.technical_strap_line_id;

    v_identity := private.resolve_committed_strap_identity($before$;
  v_stored_after text := $after$      FROM pg_catalog.jsonb_array_elements(
        -- sheet_strap_gap_committed_draft_217
        private.merge_consumo_strap_colors_with_sheet_gaps(
          COALESCE(v_item.strap_colors, '[]'::jsonb),
          v_item.reference_id
        )
      ) WITH ORDINALITY line(value, ordinality)
     WHERE public.try_parse_uuid(
             line.value ->> 'technical_strap_line_id'
           ) IS NOT DISTINCT FROM v_preview.technical_strap_line_id;

    v_identity := private.resolve_committed_strap_identity($after$;
  v_valid_reasons_before text := $before$         'material_selection_required',
         'material_selection_invalid'
       );

      v_snapshot_resolved := CASE$before$;
  v_valid_reasons_after text := $after$         'material_selection_required',
         'material_selection_invalid'
       );

      -- sheet_strap_gap_committed_draft_217
      IF COALESCE((v_stored_line ->> 'consumo_sheet_gap')::boolean, false) THEN
        v_reasons := v_reasons || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'code', 'sheet_strap_missing_from_item_snapshot',
            'field', 'strap_colors',
            'message',
              'Tira da ficha ausente do snapshot do item do PV; '
              || 'salve o item de novo ou revise Origem no Hub de Tiras.'
          )
        );
      END IF;

      v_snapshot_resolved := CASE$after$;
  v_else_before text := $before$    ELSE
      v_reasons := COALESCE(v_preview.blocking_reasons, '[]'::jsonb)
        || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'committed_identity_snapshot_missing',
          'field', 'strap_sourcing',
          'message', COALESCE(
            v_identity ->> 'reason',
            'Identidade comprometida da tira nao pode ser reidratada.'
          )
        ));
      RETURN QUERY SELECT$before$;
  v_else_after text := $after$    ELSE
      v_reasons := COALESCE(v_preview.blocking_reasons, '[]'::jsonb)
        || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'code', 'committed_identity_snapshot_missing',
          'field', 'strap_sourcing',
          'message', COALESCE(
            v_identity ->> 'reason',
            'Identidade comprometida da tira nao pode ser reidratada.'
          )
        ));
      -- sheet_strap_gap_committed_draft_217
      IF COALESCE((v_stored_line ->> 'consumo_sheet_gap')::boolean, false) THEN
        v_reasons := v_reasons || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'code', 'sheet_strap_missing_from_item_snapshot',
            'field', 'strap_colors',
            'message',
              'Tira da ficha ausente do snapshot do item do PV; '
              || 'salve o item de novo ou revise Origem no Hub de Tiras.'
          )
        );
      END IF;
      RETURN QUERY SELECT$after$;
BEGIN
  IF to_regprocedure(
    'public.preview_sale_order_strap_demand_draft(jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'preview_sale_order_strap_demand_draft(jsonb) ausente; rode migrations anteriores';
  END IF;

  IF to_regprocedure(
    'private.merge_consumo_strap_colors_with_sheet_gaps(jsonb,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'merge_consumo_strap_colors_with_sheet_gaps ausente; rode a 21100 antes';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_definition;

  IF position('sheet_strap_gap_committed_draft_217' IN v_definition) > 0 THEN
    RETURN;
  END IF;

  v_count := (length(v_definition) - length(replace(v_definition, v_strap_colors_before, '')))
    / NULLIF(length(v_strap_colors_before), 0);
  IF v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'Preflight 218: esperava 2 assignments strap_colors:=v_item; achei %',
      COALESCE(v_count, 0);
  END IF;

  v_definition := replace(v_definition, v_strap_colors_before, v_strap_colors_after);

  IF (length(v_definition) - length(replace(v_definition, v_stored_before, '')))
       / NULLIF(length(v_stored_before), 0) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Preflight 218: bloco v_stored_line (item.strap_colors) divergiu';
  END IF;
  v_definition := replace(v_definition, v_stored_before, v_stored_after);

  IF (length(v_definition) - length(replace(v_definition, v_valid_reasons_before, '')))
       / NULLIF(length(v_valid_reasons_before), 0) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Preflight 218: bloco v_reasons (ramo identidade valida) divergiu';
  END IF;
  v_definition := replace(v_definition, v_valid_reasons_before, v_valid_reasons_after);

  IF (length(v_definition) - length(replace(v_definition, v_else_before, '')))
       / NULLIF(length(v_else_before), 0) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Preflight 218: bloco ELSE committed_identity_snapshot_missing divergiu';
  END IF;
  v_definition := replace(v_definition, v_else_before, v_else_after);

  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_definition;

  IF position('sheet_strap_gap_committed_draft_217' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Posflight 218: marca sheet_strap_gap_committed_draft_217 ausente';
  END IF;
  IF position('merge_consumo_strap_colors_with_sheet_gaps' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Posflight 218: merge_consumo_strap_colors_with_sheet_gaps ausente';
  END IF;
  IF position('sheet_strap_missing_from_item_snapshot' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Posflight 218: codigo sheet_strap_missing_from_item_snapshot ausente';
  END IF;
  -- Os dois ramos comprometidos + o lookup de v_stored_line.
  IF (
    length(v_definition)
    - length(replace(v_definition, 'merge_consumo_strap_colors_with_sheet_gaps', ''))
  ) / length('merge_consumo_strap_colors_with_sheet_gaps') < 3 THEN
    RAISE EXCEPTION
      'Posflight 218: esperava >=3 chamadas ao merge (2 payloads + lookup)';
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb) IS
  'Preview de demanda de tira; PV comprometido une tiras da ficha ausentes do snapshot do item (Consumo/STRASS).';
