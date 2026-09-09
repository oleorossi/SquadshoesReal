-- A medida canônica determina quais identidades existem no catálogo.
-- Tira comprada pronta não herda material/cor do cabedal nem aceita receita.
-- Não cria produtos, variantes, preços, conversões, saldos ou fatos históricos.

DO $migration$
DECLARE
  v_definition text;
  v_anchor text := $anchor$    BEGIN
      v_legacy_group_id := nullif(v_line ->> 'group_id', '')::uuid;$anchor$;
  v_guard text := $guard$    -- strap_measure_catalog_identity_166
    -- Linhas antigas sem medida mantêm a compatibilidade do cadastro legado.
    -- Ao escolher uma medida canônica, a identidade precisa existir no catálogo.
    IF v_measure_id IS NOT NULL THEN
      IF v_basis = 'reference_base' AND NOT (
        EXISTS (
          SELECT 1 FROM public.artisanal_strap_variants variant
           WHERE variant.measure_id = v_measure_id
             AND variant.status = 'active'
             AND variant.identity_basis = 'reference_base'
             AND variant.internal_production_enabled
        ) OR EXISTS (
          SELECT 1 FROM public.artisanal_strap_recipes recipe
           WHERE recipe.measure_id = v_measure_id
             AND recipe.status = 'approved'
             AND recipe.valid_from <= now()
             AND (recipe.valid_to IS NULL OR recipe.valid_to > now())
        )
      ) THEN
        RAISE EXCEPTION 'Medida da tira sem producao interna cadastrada; selecione uma identidade comprada pronta ou cadastre a receita'
          USING ERRCODE = '23514';
      ELSIF v_basis = 'finished_product_group' AND NOT EXISTS (
        SELECT 1 FROM public.artisanal_strap_variants variant
        JOIN public.products product ON product.id = variant.finished_product_id
          AND product.active AND product.unit = 'm'
          AND product.group_id = variant.base_group_id
         WHERE variant.measure_id = v_measure_id
           AND variant.base_group_id = v_group_id
           AND variant.status = 'active'
           AND variant.identity_basis = 'finished_product_group'
      ) THEN
        RAISE EXCEPTION 'Grupo comprado pronto nao pertence ao catalogo ativo desta medida de tira'
          USING ERRCODE = '23514';
      END IF;
    END IF;

$guard$;
BEGIN
  SELECT pg_get_functiondef('public.tg_validate_technical_strap_identity()'::regprocedure)
    INTO v_definition;
  IF position('strap_measure_catalog_identity_166' IN v_definition) = 0 THEN
    IF (length(v_definition) - length(replace(v_definition, v_anchor, '')))
       / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Guarda de identidade de tira mudou; revisar migration166';
    END IF;
    EXECUTE replace(v_definition, v_anchor, v_guard || v_anchor);
  END IF;
END;
$migration$;

DO $backfill$
DECLARE
  v_updates jsonb;
  v_cost_trigger_state "char";
BEGIN
  -- Um grupo único de produtos prontos é evidência de identidade; nomes e
  -- larguras não são usados para inferir família, medida ou matéria-prima.
  -- Receitas aprovadas também representam produção interna cadastrada antes
  -- da primeira variante/cor, por isso essas medidas não são convertidas.
  WITH finished_measures AS (
    SELECT measure.id AS measure_id,
           (array_agg(DISTINCT variant.base_group_id))[1] AS finished_group_id
      FROM public.artisanal_strap_measures measure
      JOIN public.artisanal_strap_types strap_type
        ON strap_type.id = measure.strap_type_id AND strap_type.active
      JOIN public.artisanal_strap_variants variant
        ON variant.measure_id = measure.id
       AND variant.status = 'active'
       AND variant.identity_basis = 'finished_product_group'
      JOIN public.products product ON product.id = variant.finished_product_id
       AND product.active AND product.unit = 'm'
       AND product.group_id = variant.base_group_id
     WHERE measure.active
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_variants internal_variant
          WHERE internal_variant.measure_id = measure.id
            AND internal_variant.status = 'active'
            AND internal_variant.identity_basis = 'reference_base'
            AND internal_variant.internal_production_enabled
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.artisanal_strap_recipes recipe
          WHERE recipe.measure_id = measure.id
            AND recipe.status = 'approved'
            AND recipe.valid_from <= now()
            AND (recipe.valid_to IS NULL OR recipe.valid_to > now())
       )
     GROUP BY measure.id
    HAVING count(DISTINCT variant.base_group_id) = 1
  ), corrected AS (
    SELECT sheet.id, sheet.strap_colors AS old_lines, to_jsonb(sheet) AS before_row,
           jsonb_agg(
             CASE WHEN catalog.measure_id IS NOT NULL AND (
               coalesce(nullif(line.value->>'identity_basis', ''), 'reference_base')
                 <> 'finished_product_group'
               OR line.value->>'identity_group_id' IS DISTINCT FROM catalog.finished_group_id::text
               OR line.value->>'color_mode' = 'follow_main'
             ) THEN (line.value - 'color_id' - 'base_group_id' - 'base_group_name') || jsonb_build_object(
               'identity_basis', 'finished_product_group',
               'identity_group_id', catalog.finished_group_id,
               'color_mode', 'select_on_order',
               'color', '',
               'internal_production_enabled', false,
               'material_mode', 'follow_reference',
               'material_group_id', NULL,
               'allowed_material_group_ids', '[]'::jsonb
             ) || CASE WHEN line.value ? 'group_id' THEN jsonb_build_object(
               'group_id', catalog.finished_group_id,
               'group_name', finished_group.name
             ) ELSE '{}'::jsonb END
             ELSE line.value END ORDER BY line.ordinality
           ) AS new_lines
      FROM public.technical_sheets sheet
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(sheet.strap_colors) = 'array'
          THEN sheet.strap_colors ELSE '[]'::jsonb END
      ) WITH ORDINALITY line(value, ordinality)
      LEFT JOIN finished_measures catalog
        ON catalog.measure_id::text = line.value->>'measure_id'
      LEFT JOIN public.product_groups finished_group
        ON finished_group.id = catalog.finished_group_id
     WHERE sheet.retired_at IS NULL
     GROUP BY sheet.id, sheet.strap_colors
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'old_lines', old_lines, 'new_lines', new_lines, 'before_row', before_row))
    INTO v_updates FROM corrected WHERE old_lines IS DISTINCT FROM new_lines;

  IF v_updates IS NULL THEN RETURN; END IF;

  -- ALTER TRIGGER segura o lock da tabela até o término da transação. Somente
  -- o marcador de custos/snapshots fica suspenso durante este backfill; os
  -- validadores continuam ativos e nenhum UPDATE concorrente o contorna.
  SELECT tgenabled INTO STRICT v_cost_trigger_state FROM pg_trigger
   WHERE tgrelid = 'public.technical_sheets'::regclass
     AND tgname = 'trg_mark_so_costs_dirty_from_sheet';
  ALTER TABLE public.technical_sheets DISABLE TRIGGER trg_mark_so_costs_dirty_from_sheet;

  UPDATE public.technical_sheets sheet SET strap_colors = patch.new_lines
    FROM jsonb_to_recordset(v_updates) AS patch(id uuid, old_lines jsonb, new_lines jsonb)
   WHERE sheet.id = patch.id AND sheet.strap_colors = patch.old_lines;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_updates) AS patch(id uuid, old_lines jsonb, new_lines jsonb)
    JOIN public.technical_sheets sheet ON sheet.id = patch.id
    WHERE sheet.strap_colors IS DISTINCT FROM patch.new_lines
  ) THEN
    RAISE EXCEPTION 'Ficha mudou durante a correcao da identidade de tira' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_updates) AS patch(id uuid, before_row jsonb)
    JOIN public.technical_sheets sheet ON sheet.id = patch.id
    WHERE (to_jsonb(sheet) - 'strap_colors' - 'updated_at')
      IS DISTINCT FROM (patch.before_row - 'strap_colors' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'Correcao de identidade alteraria outros campos da ficha; revisar gatilhos';
  END IF;

  IF v_cost_trigger_state = 'O' THEN
    ALTER TABLE public.technical_sheets ENABLE TRIGGER trg_mark_so_costs_dirty_from_sheet;
  ELSIF v_cost_trigger_state = 'A' THEN
    ALTER TABLE public.technical_sheets ENABLE ALWAYS TRIGGER trg_mark_so_costs_dirty_from_sheet;
  ELSIF v_cost_trigger_state = 'R' THEN
    ALTER TABLE public.technical_sheets ENABLE REPLICA TRIGGER trg_mark_so_costs_dirty_from_sheet;
  END IF;
END;
$backfill$;
