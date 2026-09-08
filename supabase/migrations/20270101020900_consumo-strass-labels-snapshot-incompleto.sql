-- Consumo: snapshot pré-demanda de tira (STRASS buy_ready) devolve rótulo.
-- Antes: rebuild incompleto gravava só group_name/label/color; o TS lia
-- strap_product_name/strap_color_name/measure_name → "Tira sem cadastro" e a
-- busca por STRASS na tela de consumo falhava. Enriquecer a partir dos IDs
-- congelados (finished_product / color / measure) + fallback do item.
-- Idempotente: marca strap_incomplete_display_labels_203 no corpo.

DO $migration$
DECLARE
  v_definition text;
  v_before text := $before$          'main_production_start', v_main_production_start,
          'schedule_revision', COALESCE(v_schedule_revision, 0)
        );
      END IF;

      v_resolved := COALESCE(v_resolved, '{}'::jsonb)$before$;
  v_after text := $after$          'main_production_start', v_main_production_start,
          'schedule_revision', COALESCE(v_schedule_revision, 0)
        );
        -- strap_incomplete_display_labels_203
        -- Rótulos de apresentação a partir dos IDs congelados; sem isso a
        -- STRASS (finished_product_group) chega ao consumo sem nome/cor.
        v_resolved := v_resolved || pg_catalog.jsonb_build_object(
          'strap_product_name', COALESCE(
            (
              SELECT p.name
                FROM public.products p
               WHERE p.id = v_frozen_finished_product_id
            ),
            NULLIF(pg_catalog.btrim(v_stored_line ->> 'group_name'), ''),
            NULLIF(pg_catalog.btrim(v_stored_line ->> 'label'), '')
          ),
          'strap_color_name', COALESCE(
            (
              SELECT c.name
                FROM public.canonical_colors c
               WHERE c.id = public.try_parse_uuid(COALESCE(
                 v_identity ->> 'color_id',
                 COALESCE(v_item.strap_sourcing, '{}'::jsonb)
                   -> v_preview.technical_strap_line_id::text
                   ->> 'color_id',
                 v_stored_line ->> 'color_id'
               ))
            ),
            NULLIF(pg_catalog.btrim(v_stored_line ->> 'color'), '')
          ),
          'measure_name', (
            SELECT m.display_name
              FROM public.artisanal_strap_measures m
             WHERE m.id = public.try_parse_uuid(COALESCE(
               v_identity ->> 'measure_id',
               v_stored_line ->> 'measure_id'
             ))
          )
        );
      END IF;

      v_resolved := COALESCE(v_resolved, '{}'::jsonb)$after$;
BEGIN
  IF to_regprocedure('public.preview_sale_order_strap_demand_draft(jsonb)') IS NULL THEN
    RAISE EXCEPTION
      'preview_sale_order_strap_demand_draft(jsonb) ausente; rode migrations anteriores';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_definition;

  IF position('strap_incomplete_display_labels_203' IN v_definition) > 0 THEN
    RETURN;
  END IF;

  IF (length(v_definition) - length(replace(v_definition, v_before, '')))
       / NULLIF(length(v_before), 0) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Preflight 203: bloco incompleto de v_resolved divergiu; revise o patch de labels STRASS.';
  END IF;

  v_definition := replace(v_definition, v_before, v_after);
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_definition;
  IF position('strap_incomplete_display_labels_203' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Posflight 203: marca strap_incomplete_display_labels_203 ausente';
  END IF;
  IF position('''strap_product_name''' IN v_definition) = 0
     OR position('''strap_color_name''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Posflight 203: campos de rótulo não entraram no preview';
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.preview_sale_order_strap_demand_draft(jsonb) IS
  'Preview de demanda de tira; snapshot pré-demanda inclui strap_product_name/color/measure para consumo (STRASS).';
