-- Consumo: backfill SEMPRE de rótulos de tira (STRASS buy_ready) no preview
-- comprometido, imediatamente antes do RETURN.
--
-- A 20900 (e a tentativa 20300) só enriqueciam o ramo pré-demanda
-- (physical_snapshot_complete=false). Snapshot "completo" com resolved vazio
-- — ou resolved sem strap_product_name — ainda chegava ao TS como
-- "Tira sem cadastro" e sumia na busca por STRASS.
--
-- Idempotente: marca strap_display_labels_210. Não early-return pela marca
-- 203/209 — são patches em outro ponto do corpo.

DO $migration$
DECLARE
  v_definition text;
  v_before text := $before$        || CASE
          WHEN v_snapshot_complete THEN '{}'::jsonb
          ELSE pg_catalog.jsonb_build_object(
            'snapshot_warning', v_identity ->> 'snapshot_warning'
          )
        END;

      RETURN QUERY SELECT
        v_preview.line_ordinal::integer,
        v_preview.technical_strap_line_id::uuid,
        v_frozen_variant_id,
        v_frozen_source,
        v_preview.gross_required_m::numeric,$before$;
  v_after text := $after$        || CASE
          WHEN v_snapshot_complete THEN '{}'::jsonb
          ELSE pg_catalog.jsonb_build_object(
            'snapshot_warning', v_identity ->> 'snapshot_warning'
          )
        END;

        -- strap_display_labels_210
        -- Preenche rótulos se o snapshot (pré-demanda OU demanda sem
        -- resolved nomeado) não trouxe nome/cor/medida. Sem isso a STRASS
        -- some na busca do consumo de materiais.
        v_resolved := v_resolved || pg_catalog.jsonb_build_object(
          'strap_product_name', COALESCE(
            NULLIF(pg_catalog.btrim(v_resolved ->> 'strap_product_name'), ''),
            (
              SELECT p.name
                FROM public.products p
               WHERE p.id = v_frozen_finished_product_id
            ),
            NULLIF(pg_catalog.btrim(v_stored_line ->> 'group_name'), ''),
            NULLIF(pg_catalog.btrim(v_stored_line ->> 'label'), '')
          ),
          'strap_color_name', COALESCE(
            NULLIF(pg_catalog.btrim(v_resolved ->> 'strap_color_name'), ''),
            (
              SELECT c.name
                FROM public.canonical_colors c
               WHERE c.id = public.try_parse_uuid(COALESCE(
                 v_identity ->> 'color_id',
                 COALESCE(v_item.strap_sourcing, '{}'::jsonb)
                   -> v_preview.technical_strap_line_id::text
                   ->> 'color_id',
                 v_stored_line ->> 'color_id',
                 v_resolved ->> 'color_id'
               ))
            ),
            NULLIF(pg_catalog.btrim(v_resolved ->> 'color'), ''),
            NULLIF(pg_catalog.btrim(v_stored_line ->> 'color'), '')
          ),
          'measure_name', COALESCE(
            NULLIF(pg_catalog.btrim(v_resolved ->> 'measure_name'), ''),
            (
              SELECT m.display_name
                FROM public.artisanal_strap_measures m
               WHERE m.id = public.try_parse_uuid(COALESCE(
                 v_identity ->> 'measure_id',
                 v_stored_line ->> 'measure_id',
                 v_resolved ->> 'measure_id'
               ))
            )
          )
        );

      RETURN QUERY SELECT
        v_preview.line_ordinal::integer,
        v_preview.technical_strap_line_id::uuid,
        v_frozen_variant_id,
        v_frozen_source,
        v_preview.gross_required_m::numeric,$after$;
BEGIN
  IF to_regprocedure('public.preview_sale_order_strap_demand_draft(jsonb)') IS NULL THEN
    RAISE EXCEPTION
      'preview_sale_order_strap_demand_draft(jsonb) ausente; rode migrations anteriores';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_definition;

  IF position('strap_display_labels_210' IN v_definition) > 0 THEN
    RETURN;
  END IF;

  IF (length(v_definition) - length(replace(v_definition, v_before, '')))
       / NULLIF(length(v_before), 0) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Preflight 210: bloco RETURN do preview comprometido divergiu; revise labels STRASS.';
  END IF;

  v_definition := replace(v_definition, v_before, v_after);
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_definition;
  IF position('strap_display_labels_210' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Posflight 210: marca strap_display_labels_210 ausente';
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb) IS
  'Preview de demanda de tira; backfill sempre de strap_product_name/color/measure no consumo (STRASS).';
