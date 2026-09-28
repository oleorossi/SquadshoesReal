-- =============================================================================
-- Save da ficha → tiras do PV + Consumo + OPs
-- =============================================================================
-- Sintoma (PV-00222..227 / G02·G03): toast "OPs com consumo atualizado" após
-- salvar a ficha, mas o Consumo Consolidado (§ tiras / napa convertida) seguia
-- o strap_colors CONGELADO no item do PV. auto_resync só reescreve snapshot da
-- OP; calculate_consumption_report_batch lia o item e, em PV comprometido,
-- desligava o overlay estrutural da ficha (231).
--
-- Este patch:
--   1) overlay do Consumo também em Aprovado/Em Produção (ficha vigente)
--   2) merge não apaga group_name/label/group_id hidratados quando a ficha
--      não traz valor (evita falso drift de apresentação)
--   3) propagate_sheet_straps_to_open_pvs grava o overlay no item antes do
--      auto_resync — o gatilho tg_enqueue_strap_demands_on_item_change
--      reprocessa demandas; resync congela OP com o plano novo
-- Marca: sheet_strap_propagate_on_save_292
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Merge: overlay estrutural sem clobber de apresentação vazia na ficha
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(
  p_item_straps jsonb,
  p_reference_id uuid,
  p_overlay_structure boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  -- sheet_strap_gap_consumo_211
  -- sheet_strap_structure_overlay_consumo_231
  -- sheet_strap_propagate_on_save_292
  v_item jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_item_straps) = 'array' THEN p_item_straps
    ELSE '[]'::jsonb
  END;
  v_sheet jsonb := '[]'::jsonb;
  v_line jsonb;
  v_item_line jsonb;
  v_sheet_line jsonb;
  v_line_id text;
  v_present text[] := ARRAY[]::text[];
  v_out jsonb := '[]'::jsonb;
  v_drift boolean;
  v_overlay jsonb;
  v_sheet_group_id text;
  v_sheet_group_name text;
  v_sheet_label text;
BEGIN
  IF p_reference_id IS NULL THEN
    RETURN v_item;
  END IF;

  SELECT CASE
           WHEN pg_catalog.jsonb_typeof(ts.strap_colors) = 'array'
             THEN ts.strap_colors
           ELSE '[]'::jsonb
         END
    INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_reference_id;

  IF v_sheet IS NULL THEN
    v_sheet := '[]'::jsonb;
  END IF;

  FOR v_item_line IN
    SELECT value FROM pg_catalog.jsonb_array_elements(v_item)
  LOOP
    v_line_id := NULLIF(pg_catalog.btrim(
      v_item_line ->> 'technical_strap_line_id'
    ), '');

    IF p_overlay_structure
       AND v_line_id IS NOT NULL
       AND pg_catalog.jsonb_array_length(v_sheet) > 0
    THEN
      v_sheet_line := NULL;
      SELECT value
        INTO v_sheet_line
        FROM pg_catalog.jsonb_array_elements(v_sheet) sheet_line(value)
       WHERE NULLIF(pg_catalog.btrim(
               sheet_line.value ->> 'technical_strap_line_id'
             ), '') = v_line_id
       LIMIT 1;

      IF v_sheet_line IS NOT NULL THEN
        v_drift :=
             (NULLIF(pg_catalog.btrim(v_item_line ->> 'measure_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'measure_id'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'strap_type_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'strap_type_id'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'identity_basis'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'identity_basis'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'identity_group_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'identity_group_id'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'material_mode'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'material_mode'), ''))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'material_group_id'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'material_group_id'), ''))
          OR (COALESCE(v_item_line -> 'allowed_material_group_ids', '[]'::jsonb)
                IS DISTINCT FROM COALESCE(v_sheet_line -> 'allowed_material_group_ids', '[]'::jsonb))
          OR (COALESCE(v_item_line -> 'consumption_per_size', '{}'::jsonb)
                IS DISTINCT FROM COALESCE(v_sheet_line -> 'consumption_per_size', '{}'::jsonb))
          OR (NULLIF(pg_catalog.btrim(v_item_line ->> 'consumption'), '')
                IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'consumption'), ''))
          OR (COALESCE(v_item_line ->> 'internal_production_enabled', '')
                IS DISTINCT FROM COALESCE(v_sheet_line ->> 'internal_production_enabled', ''))
          -- Apresentação só conta como drift quando a FICHA traz valor próprio.
          OR (
            NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_id'), '') IS NOT NULL
            AND NULLIF(pg_catalog.btrim(v_item_line ->> 'group_id'), '')
              IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_id'), '')
          )
          OR (
            NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_name'), '') IS NOT NULL
            AND NULLIF(pg_catalog.btrim(v_item_line ->> 'group_name'), '')
              IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_name'), '')
          )
          OR (
            NULLIF(pg_catalog.btrim(v_sheet_line ->> 'label'), '') IS NOT NULL
            AND NULLIF(pg_catalog.btrim(v_item_line ->> 'label'), '')
              IS DISTINCT FROM NULLIF(pg_catalog.btrim(v_sheet_line ->> 'label'), '')
          );

        IF v_drift THEN
          v_sheet_group_id := NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_id'), '');
          v_sheet_group_name := NULLIF(pg_catalog.btrim(v_sheet_line ->> 'group_name'), '');
          v_sheet_label := NULLIF(pg_catalog.btrim(v_sheet_line ->> 'label'), '');

          v_overlay := v_item_line
            || pg_catalog.jsonb_build_object(
              'technical_strap_line_id', v_line_id,
              'measure_id', v_sheet_line -> 'measure_id',
              'strap_type_id', v_sheet_line -> 'strap_type_id',
              'identity_basis', v_sheet_line -> 'identity_basis',
              'identity_group_id', v_sheet_line -> 'identity_group_id',
              'material_mode', v_sheet_line -> 'material_mode',
              'material_group_id', v_sheet_line -> 'material_group_id',
              'allowed_material_group_ids',
                COALESCE(v_sheet_line -> 'allowed_material_group_ids', '[]'::jsonb),
              'consumption', v_sheet_line -> 'consumption',
              'consumption_per_size',
                COALESCE(v_sheet_line -> 'consumption_per_size', '{}'::jsonb),
              'consumo_sheet_structure_overlay', true
            );

          IF v_sheet_group_id IS NOT NULL THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'group_id', v_sheet_line -> 'group_id'
            );
          END IF;
          IF v_sheet_group_name IS NOT NULL THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'group_name', v_sheet_line -> 'group_name'
            );
          END IF;
          IF v_sheet_label IS NOT NULL THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'label', v_sheet_line -> 'label'
            );
          END IF;

          IF v_sheet_line ? 'internal_production_enabled' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'internal_production_enabled',
              v_sheet_line -> 'internal_production_enabled'
            );
          END IF;
          IF v_item_line ? 'color' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object('color', v_item_line -> 'color');
          END IF;
          IF v_item_line ? 'color_id' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object('color_id', v_item_line -> 'color_id');
          END IF;
          IF v_item_line ? 'color_mode' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object('color_mode', v_item_line -> 'color_mode');
          END IF;
          IF v_item_line ? 'base_group_id' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'base_group_id', v_item_line -> 'base_group_id'
            );
          END IF;
          IF v_item_line ? 'base_group_name' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'base_group_name', v_item_line -> 'base_group_name'
            );
          END IF;
          IF v_item_line ? 'pv_origem' THEN
            v_overlay := v_overlay || pg_catalog.jsonb_build_object(
              'pv_origem', v_item_line -> 'pv_origem'
            );
          END IF;

          v_out := v_out || pg_catalog.jsonb_build_array(v_overlay);
          IF v_line_id IS NOT NULL THEN
            v_present := v_present || v_line_id;
          END IF;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    v_out := v_out || pg_catalog.jsonb_build_array(v_item_line);
    IF v_line_id IS NOT NULL THEN
      v_present := v_present || v_line_id;
    END IF;
  END LOOP;

  IF pg_catalog.jsonb_array_length(v_sheet) > 0 THEN
    FOR v_line IN
      SELECT value FROM pg_catalog.jsonb_array_elements(v_sheet)
    LOOP
      v_line_id := NULLIF(pg_catalog.btrim(v_line ->> 'technical_strap_line_id'), '');
      IF v_line_id IS NULL THEN
        CONTINUE;
      END IF;
      IF v_line_id = ANY (v_present) THEN
        CONTINUE;
      END IF;

      v_out := v_out || pg_catalog.jsonb_build_array(
        v_line || pg_catalog.jsonb_build_object(
          'technical_strap_line_id', v_line_id,
          'consumo_sheet_gap', true
        )
      );
      v_present := v_present || v_line_id;
    END LOOP;
  END IF;

  RETURN v_out;
END;
$function$;

COMMENT ON FUNCTION private.merge_consumo_strap_colors_with_sheet_gaps(jsonb, uuid, boolean) IS
  'Consumo: gap de line_id + overlay estrutural (consumo/tipo/medida) da ficha; '
  'não clobber group_name/label/group_id hidratados quando a ficha vem vazia.';

-- -----------------------------------------------------------------------------
-- 2) Persistência: overlay limpo (sem flags de relatório) no item do PV
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.strip_consumo_strap_report_flags(p_straps jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (
      SELECT pg_catalog.jsonb_agg(line.value - 'consumo_sheet_structure_overlay' - 'consumo_sheet_gap')
        FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(p_straps) = 'array' THEN p_straps ELSE '[]'::jsonb END
        ) line(value)
    ),
    '[]'::jsonb
  );
$function$;

CREATE OR REPLACE FUNCTION private.strap_line_productive_inputs_changed(
  p_old jsonb,
  p_new jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  -- Tipo/medida/identidade/consumo mudaram → receita pinada no sourcing
  -- fica inválida (metragem igual NÃO isenta: rendimento da napa muda).
  SELECT
       NULLIF(pg_catalog.btrim(p_old ->> 'strap_type_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'strap_type_id'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'measure_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'measure_id'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'identity_basis'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'identity_basis'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'identity_group_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'identity_group_id'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'material_mode'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'material_mode'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'material_group_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'material_group_id'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'consumption'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'consumption'), '')
    OR COALESCE(p_old -> 'consumption_per_size', '{}'::jsonb)
         IS DISTINCT FROM COALESCE(p_new -> 'consumption_per_size', '{}'::jsonb);
$function$;

CREATE OR REPLACE FUNCTION private.clear_stale_strap_sourcing_after_structure(
  p_sourcing jsonb,
  p_old_straps jsonb,
  p_new_straps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  v_sourcing jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_sourcing) = 'object' THEN p_sourcing
    ELSE '{}'::jsonb
  END;
  v_old jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_old_straps) = 'array' THEN p_old_straps
    ELSE '[]'::jsonb
  END;
  v_new jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_new_straps) = 'array' THEN p_new_straps
    ELSE '[]'::jsonb
  END;
  v_new_line jsonb;
  v_old_line jsonb;
  v_line_id text;
  v_keep jsonb := '{}'::jsonb;
BEGIN
  -- Mantém sourcing só de linhas que ainda existem e cujos inputs produtivos
  -- não mudaram. Troca de TIPO (mesmo com metragem igual) zera a receita.
  FOR v_new_line IN SELECT value FROM pg_catalog.jsonb_array_elements(v_new)
  LOOP
    v_line_id := NULLIF(pg_catalog.btrim(v_new_line ->> 'technical_strap_line_id'), '');
    IF v_line_id IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT (v_sourcing ? v_line_id) THEN
      CONTINUE;
    END IF;

    v_old_line := NULL;
    SELECT value INTO v_old_line
      FROM pg_catalog.jsonb_array_elements(v_old) old_line(value)
     WHERE NULLIF(pg_catalog.btrim(old_line.value ->> 'technical_strap_line_id'), '') = v_line_id
     LIMIT 1;

    IF v_old_line IS NULL THEN
      CONTINUE;
    END IF;

    IF private.strap_line_productive_inputs_changed(v_old_line, v_new_line) THEN
      CONTINUE;
    END IF;

    v_keep := v_keep || pg_catalog.jsonb_build_object(v_line_id, v_sourcing -> v_line_id);
  END LOOP;

  RETURN v_keep;
END;
$function$;

CREATE OR REPLACE FUNCTION public.propagate_sheet_straps_to_open_pvs(
  p_sheet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- sheet_strap_propagate_on_save_292
  -- sheet_strap_propagate_prepare_hotfix_292b
  v_item public.sale_order_items%ROWTYPE;
  v_next jsonb;
  v_clean jsonb;
  v_next_sourcing jsonb;
  v_prepared jsonb;
  v_sourcing_changed boolean;
  v_colors_changed boolean;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_skipped_started integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_sqlstate text;
  v_message text;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     ) THEN
    RAISE EXCEPTION 'Somente Produção/Gerência pode propagar tiras da ficha'
      USING ERRCODE = '42501';
  END IF;

  IF p_sheet_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'updated_items', 0,
      'unchanged_items', 0,
      'skipped_started_items', 0,
      'errors', '[]'::jsonb
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));

  FOR v_item IN
    SELECT i.*
      FROM public.sale_order_items i
      JOIN public.sale_orders so ON so.id = i.sale_order_id
     WHERE i.reference_id = p_sheet_id
       AND i.production_excluded_at IS NULL
       AND so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
     ORDER BY i.id
     FOR UPDATE OF i
  LOOP
    BEGIN
      -- Item com OP que tem fato físico: não reescreve snapshot comercial
      -- (resync destrutivo também recusa — PZ105). Consumo ainda vê a ficha
      -- via overlay do batch.
      IF EXISTS (
        SELECT 1
          FROM public.orders o
         WHERE o.sale_order_item_id = v_item.id
           AND o.deleted_at IS NULL
           AND lower(COALESCE(o.status, '')) NOT IN ('cancelado', 'cancelada')
           AND (
             EXISTS (
               SELECT 1 FROM public.order_stages os
                WHERE os.order_id = o.id
                  AND (
                    COALESCE(os.quantity_processed, 0) > 0
                    OR os.started_at IS NOT NULL
                    OR os.completed_at IS NOT NULL
                    OR lower(COALESCE(os.status, '')) NOT IN ('', 'pendente', 'pending')
                  )
             )
             OR EXISTS (
               SELECT 1 FROM public.production_pointings pp
                WHERE pp.order_id = o.id
             )
             OR EXISTS (
               SELECT 1 FROM public.production_consumptions pc
                WHERE pc.order_id = o.id
                  AND pc.superseded_at IS NULL
                  AND COALESCE(pc.actual_quantity, 0) > 0
             )
           )
      ) THEN
        v_skipped_started := v_skipped_started + 1;
        CONTINUE;
      END IF;

      v_next := private.merge_consumo_strap_colors_with_sheet_gaps(
        COALESCE(v_item.strap_colors, '[]'::jsonb),
        v_item.reference_id,
        true
      );
      v_clean := private.strip_consumo_strap_report_flags(v_next);

      v_colors_changed := v_clean IS DISTINCT FROM COALESCE(v_item.strap_colors, '[]'::jsonb);
      IF NOT v_colors_changed THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;

      -- Troca de TIPO (metragem igual) muda o rendimento da napa: re-resolve
      -- receita/variante via prepare. clear_stale sozinho deixa o item sem
      -- cor/variante congelada e tg_validate_…_strap_color_alignment recusa.
      PERFORM set_config('app.strap_source_rpc', '1', true);
      PERFORM set_config('app.strap_force_revalidate', '1', true);
      v_prepared := public.prepare_sale_order_item_internal_straps(
        jsonb_build_object(
          'id', v_item.id,
          'reference_id', v_item.reference_id,
          'material_variant_id', v_item.material_variant_id,
          'color', v_item.color,
          'strap_colors', v_clean,
          'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb)
        )
      );
      v_clean := COALESCE(v_prepared -> 'item' -> 'strap_colors', v_clean);
      v_next_sourcing := COALESCE(
        v_prepared -> 'item' -> 'strap_sourcing',
        '{}'::jsonb
      );
      v_sourcing_changed := v_next_sourcing IS DISTINCT FROM COALESCE(v_item.strap_sourcing, '{}'::jsonb);

      IF v_sourcing_changed THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_clean,
               strap_sourcing = v_next_sourcing,
               strap_sourcing_revision = COALESCE(
                 nullif(v_prepared -> 'item' ->> 'strap_sourcing_revision', '')::bigint,
                 strap_sourcing_revision
               )
         WHERE id = v_item.id;
      ELSE
        UPDATE public.sale_order_items
           SET strap_colors = v_clean
         WHERE id = v_item.id;
      END IF;
      v_updated := v_updated + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_message = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'item_id', v_item.id,
        'color', v_item.color,
        'sqlstate', v_sqlstate,
        'message', v_message
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sheet_id', p_sheet_id,
    'updated_items', v_updated,
    'unchanged_items', v_unchanged,
    'skipped_started_items', v_skipped_started,
    'errors', v_errors
  );
END;
$function$;

COMMENT ON FUNCTION public.propagate_sheet_straps_to_open_pvs(uuid) IS
  'Após save da ficha: alinha strap_colors/sourcing dos itens de PVs '
  'Aprovado/Em Produção sem fato físico à ficha vigente (tipo novo → receita nova). '
  'Falhas de cadastro (ex.: receita ausente) voltam em errors[] sem abortar o lote.';

REVOKE ALL ON FUNCTION public.propagate_sheet_straps_to_open_pvs(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.propagate_sheet_straps_to_open_pvs(uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3) auto_resync: propaga tiras ANTES de re-congelar OPs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_resync_unstarted_ops_for_sheet(
  p_sheet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op record;
  v_resync jsonb;
  v_delta jsonb;
  v_straps jsonb;
  v_resynced integer := 0;
  v_skipped_inactive integer := 0;
  v_skipped_started integer := 0;
  v_delta_reserved integer := 0;
  v_delta_shortfalls integer := 0;
  v_straps_updated integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_sale_order_ids uuid[] := ARRAY[]::uuid[];
  v_so_id uuid;
  v_sqlstate text;
  v_message text;
  v_n_reserved integer;
  v_n_shortfalls integer;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     ) THEN
    RAISE EXCEPTION 'Somente Produção/Gerência pode propagar consumo da ficha'
      USING ERRCODE = '42501';
  END IF;

  IF p_sheet_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'resynced', 0,
      'skipped_inactive', 0,
      'skipped_started', 0,
      'delta_reserved', 0,
      'delta_shortfalls', 0,
      'straps_updated', 0,
      'errors', '[]'::jsonb
    );
  END IF;

  -- Tiras do PV primeiro: o freeze da OP e o Consumo leem strap_colors do item.
  v_straps := public.propagate_sheet_straps_to_open_pvs(p_sheet_id);
  v_straps_updated := COALESCE((v_straps ->> 'updated_items')::integer, 0);
  -- Falha de cadastro (ex.: receita ausente p/ tipo×napa) não aborta o lote,
  -- mas precisa aparecer no toast — senão o Consumo overlaya e o item fica velho.
  IF jsonb_typeof(v_straps -> 'errors') = 'array'
     AND jsonb_array_length(v_straps -> 'errors') > 0
  THEN
    v_errors := v_errors || (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'order_number', NULL,
          'message',
            'Tiras PV'
            || CASE
                 WHEN NULLIF(e->>'color', '') IS NOT NULL
                   THEN ' (' || (e->>'color') || ')'
                 ELSE ''
               END
            || ': '
            || COALESCE(e->>'message', 'falha ao realinhar')
        )
      ), '[]'::jsonb)
        FROM jsonb_array_elements(v_straps -> 'errors') AS t(e)
    );
  END IF;

  FOR v_op IN
    SELECT o.id,
           o.order_number,
           o.sale_order_id
      FROM public.orders o
      JOIN public.sale_orders so
        ON so.id = o.sale_order_id
     WHERE o.reference_id = p_sheet_id
       AND o.deleted_at IS NULL
       AND so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND lower(COALESCE(o.status, '')) IN (
         'reservado', 'em produção', 'em producao'
       )
     ORDER BY o.order_number NULLS LAST, o.id
  LOOP
    BEGIN
      v_resync := public.resync_op_atomic(v_op.id);

      IF COALESCE((v_resync ->> 'skipped')::boolean, false) THEN
        v_skipped_inactive := v_skipped_inactive + 1;
      ELSIF COALESCE((v_resync ->> 'ok')::boolean, false) THEN
        v_resynced := v_resynced + 1;
        IF v_op.sale_order_id IS NOT NULL THEN
          v_sale_order_ids := array_append(v_sale_order_ids, v_op.sale_order_id);
        END IF;
      ELSE
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'order_id', v_op.id,
          'order_number', v_op.order_number,
          'message', COALESCE(v_resync #>> '{error,message}', 'resync recusado')
        ));
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'PZ105' THEN
        v_skipped_started := v_skipped_started + 1;
        BEGIN
          v_delta := public.reserve_missing_materials_for_order(v_op.id);
          v_n_reserved := COALESCE(jsonb_array_length(v_delta -> 'reserved'), 0);
          v_n_shortfalls := COALESCE(jsonb_array_length(v_delta -> 'shortfalls'), 0);
          IF v_n_reserved > 0 THEN
            v_delta_reserved := v_delta_reserved + 1;
          END IF;
          v_delta_shortfalls := v_delta_shortfalls + v_n_shortfalls;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_sqlstate = RETURNED_SQLSTATE,
            v_message = MESSAGE_TEXT;
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'order_id', v_op.id,
            'order_number', v_op.order_number,
            'sqlstate', v_sqlstate,
            'message', 'delta reserve: ' || v_message
          ));
        END;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_sqlstate = RETURNED_SQLSTATE,
          v_message = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'order_id', v_op.id,
          'order_number', v_op.order_number,
          'sqlstate', v_sqlstate,
          'message', v_message
        ));
    END;
  END LOOP;

  FOR v_so_id IN
    SELECT DISTINCT x
      FROM unnest(v_sale_order_ids) AS t(x)
     WHERE x IS NOT NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.technical_sheet_snapshots tss
       WHERE tss.sale_order_id = v_so_id
         AND tss.sheet_id = p_sheet_id
         AND tss.outdated_at IS NOT NULL
    ) THEN
      UPDATE public.sale_orders
         SET reservations_outdated_at = NULL
       WHERE id = v_so_id
         AND reservations_outdated_at IS NOT NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sheet_id', p_sheet_id,
    'resynced', v_resynced,
    'skipped_inactive', v_skipped_inactive,
    'skipped_started', v_skipped_started,
    'delta_reserved', v_delta_reserved,
    'delta_shortfalls', v_delta_shortfalls,
    'straps_updated', v_straps_updated,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.auto_resync_unstarted_ops_for_sheet(uuid) IS
  'Após save da ficha: alinha tiras do PV + re-freeze/re-reserva das OPs '
  'Aprovado/Em Produção sem fato físico; em PZ105 reserva só o delta.';

REVOKE ALL ON FUNCTION public.auto_resync_unstarted_ops_for_sheet(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resync_unstarted_ops_for_sheet(uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4) Consumo batch: overlay estrutural também em PV comprometido
-- -----------------------------------------------------------------------------
DO $patch_batch$
DECLARE
  v_def text;
  v_old text :=
    'v_overlay_structure := NOT private.is_committed_sale_order_status('
    || E'\n'
    || '      v_scope.sale_order_status'
    || E'\n'
    || '    )';
  v_new text :=
    -- sheet_strap_propagate_on_save_292: ficha vigente no Consumo também
    -- para Aprovado/Em Produção (espelha o rodapé "ficha técnica vigente").
    'v_overlay_structure := true';
BEGIN
  SELECT pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_consumption_report_batch ausente';
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    IF position('v_overlay_structure := true' IN v_def) > 0 THEN
      RAISE NOTICE 'overlay já liberado no batch; skip';
      RETURN;
    END IF;
    RAISE EXCEPTION 'Gate de overlay não encontrado no batch vivo';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch_batch$;

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
DO $guards$
DECLARE
  v_auto text;
  v_merge text;
  v_batch text;
BEGIN
  IF to_regprocedure('public.propagate_sheet_straps_to_open_pvs(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Guard: propagate_sheet_straps_to_open_pvs ausente';
  END IF;

  SELECT pg_get_functiondef(
    'public.auto_resync_unstarted_ops_for_sheet(uuid)'::regprocedure
  ) INTO v_auto;
  SELECT pg_get_functiondef(
    'private.merge_consumo_strap_colors_with_sheet_gaps(jsonb,uuid,boolean)'::regprocedure
  ) INTO v_merge;
  SELECT pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  ) INTO v_batch;

  IF v_auto NOT ILIKE '%propagate_sheet_straps_to_open_pvs%' THEN
    RAISE EXCEPTION 'Guard: auto_resync não chama propagate_sheet_straps';
  END IF;
  IF v_auto NOT ILIKE '%straps_updated%' THEN
    RAISE EXCEPTION 'Guard: auto_resync sem contador straps_updated';
  END IF;
  IF v_auto NOT ILIKE '%resync_op_atomic%' THEN
    RAISE EXCEPTION 'Guard: auto_resync sem resync_op_atomic';
  END IF;
  IF v_auto NOT ILIKE '%PZ105%' THEN
    RAISE EXCEPTION 'Guard: auto_resync sem PZ105';
  END IF;
  IF v_merge NOT ILIKE '%sheet_strap_propagate_on_save_292%' THEN
    RAISE EXCEPTION 'Guard: merge sem marca 292';
  END IF;
  IF position('v_overlay_structure := true' IN v_batch) = 0 THEN
    RAISE EXCEPTION 'Guard: batch ainda gated por is_committed';
  END IF;
END;
$guards$;

COMMIT;
