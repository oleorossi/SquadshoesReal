-- =============================================================================
-- Hard-delete soft-excluded: finalize liga também o command boundary
-- =============================================================================
-- O DELETE de sale_order_items exige app.sale_order_command_internal=1
-- (boundary de comando). O caminho normal da UI já liga via
-- execute_sale_order_command; o SQL Editor / finalize isolado não.
-- Sem este GUC, a 2ª remoção (hard-delete) estoura no gatilho de boundary
-- mesmo com app.sale_order_item_production_exclusion_internal=1.
--
-- Marcador: pv_edit_hard_delete_command_boundary_20270101023500
-- =============================================================================

CREATE OR REPLACE FUNCTION private.finalize_removed_sale_order_items(
  p_order_id uuid,
  p_kept_ids uuid[],
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doomed uuid[] := '{}'::uuid[];
  v_preserve uuid[] := '{}'::uuid[];
  v_delete uuid[] := '{}'::uuid[];
  v_item_id uuid;
  v_blocked uuid;
  v_variants uuid[];
  v_variant uuid;
  v_orphan_item_ids uuid[] := '{}'::uuid[];
  v_prev_guc text;
  v_prev_command text;
  v_prev_engine text;
  v_actor uuid := auth.uid();
  v_removed int := 0;
  v_preserved int := 0;
  v_cancelled_demands int := 0;
  v_cancelled_purchases int := 0;
  v_deleted_orphan_po_items int := 0;
  v_already_excluded boolean;
BEGIN
  -- pv_edit_cancel_reversible_purchase_20270101022200
  -- pv_edit_detach_cancelled_po_fk_20270101022900
  -- pv_edit_delete_orphan_po_after_detach_20270101023000
  -- pv_edit_hard_delete_soft_excluded_20270101023300
  -- pv_edit_hard_delete_command_boundary_20270101023500
  SELECT coalesce(array_agg(i.id ORDER BY i.id), '{}'::uuid[])
    INTO v_doomed
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_order_id
     AND NOT (i.id = ANY(coalesce(p_kept_ids, '{}'::uuid[])));

  IF cardinality(v_doomed) = 0 THEN
    RETURN jsonb_build_object(
      'removed_items', 0,
      'preserved_items', 0,
      'cancelled_strap_demands', 0,
      'cancelled_purchase_contributions', 0,
      'deleted_orphan_strap_po_items', 0
    );
  END IF;

  FOREACH v_item_id IN ARRAY v_doomed
  LOOP
    SELECT i.production_excluded_at IS NOT NULL
      INTO v_already_excluded
      FROM public.sale_order_items i
     WHERE i.id = v_item_id;

    IF EXISTS (
      SELECT 1
        FROM public.nfe_devolucao_item_claims c
       WHERE c.sale_order_item_id = v_item_id
         AND c.status IS DISTINCT FROM 'released'
    ) THEN
      RAISE EXCEPTION
        'Nao e possivel remover o item do PV: ha claim de devolucao NF-e vinculado. Liberte a devolucao antes.'
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.service_order_return_items r
       WHERE r.sale_order_item_id = v_item_id
    ) THEN
      RAISE EXCEPTION
        'Nao e possivel remover o item do PV: ha retorno de OS vinculado. Preserve a linha historica.'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT d.id INTO v_blocked
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_item_id = v_item_id
       AND public.strap_demand_has_external_commitment(d.id)
     LIMIT 1;
    IF v_blocked IS NOT NULL THEN
      RAISE EXCEPTION
        'Nao e possivel remover o item do PV: demanda de tira com compromisso externo (OS enviada/recibo/custodia). Libere o compromisso antes de editar.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Compra avançada: mantém linha histórica (1ª ou 2ª remoção).
    IF EXISTS (
      SELECT 1
        FROM public.purchase_demand_contributions c
       WHERE c.sale_order_item_id = v_item_id
         AND c.status IN ('approved', 'sent', 'partial', 'received')
    ) THEN
      v_preserve := array_append(v_preserve, v_item_id);
      CONTINUE;
    END IF;

    -- Já soft-excluded e sem bloqueio duro → hard-delete (segunda remoção).
    IF coalesce(v_already_excluded, false) THEN
      v_delete := array_append(v_delete, v_item_id);
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.sale_order_strap_demands d WHERE d.sale_order_item_id = v_item_id
    ) OR EXISTS (
      SELECT 1 FROM public.purchase_demand_contributions c WHERE c.sale_order_item_id = v_item_id
    ) THEN
      v_preserve := array_append(v_preserve, v_item_id);
    ELSE
      v_delete := array_append(v_delete, v_item_id);
    END IF;
  END LOOP;

  IF cardinality(v_preserve) > 0 THEN
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'Retirada produtiva na edicao do PV exige usuario autenticado'
        USING ERRCODE = '42501';
    END IF;

    v_prev_guc := coalesce(
      nullif(current_setting('app.sale_order_item_production_exclusion_internal', true), ''),
      ''
    );
    PERFORM set_config('app.sale_order_item_production_exclusion_internal', '1', true);

    WITH cancelled_purchases AS (
      UPDATE public.purchase_demand_contributions c
         SET status = 'cancelled',
             suspension_reason = coalesce(
               nullif(btrim(c.suspension_reason), ''),
               'Item removido na edicao do PV'
             ),
             superseded_purchase_order_id = coalesce(
               c.superseded_purchase_order_id,
               c.purchase_order_id
             ),
             superseded_purchase_order_item_id = coalesce(
               c.superseded_purchase_order_item_id,
               c.purchase_order_item_id
             ),
             purchase_order_id = NULL,
             purchase_order_item_id = NULL,
             correlation_id = p_correlation_id,
             updated_at = now()
       WHERE c.sale_order_item_id = ANY(v_preserve)
         AND c.status IN ('proposed', 'awaiting_approval', 'suspended')
         AND coalesce(c.committed_quantity_stock_unit, 0) = 0
      RETURNING c.id,
                c.strap_variant_id,
                c.superseded_purchase_order_item_id AS orphan_item_id
    )
    SELECT count(*)::integer,
           coalesce(
             array_agg(DISTINCT cancelled_purchases.strap_variant_id)
               FILTER (WHERE cancelled_purchases.strap_variant_id IS NOT NULL),
             '{}'::uuid[]
           ),
           coalesce(
             array_agg(DISTINCT cancelled_purchases.orphan_item_id)
               FILTER (WHERE cancelled_purchases.orphan_item_id IS NOT NULL),
             '{}'::uuid[]
           )
      INTO v_cancelled_purchases, v_variants, v_orphan_item_ids
      FROM cancelled_purchases;

    IF cardinality(v_orphan_item_ids) > 0 THEN
      v_prev_engine := coalesce(
        nullif(current_setting('app.strap_po_engine', true), ''),
        ''
      );
      PERFORM set_config('app.strap_po_engine', '1', true);

      WITH deleted AS (
        DELETE FROM public.purchase_order_items i
         USING public.purchase_orders po
         WHERE i.id = ANY(v_orphan_item_ids)
           AND po.id = i.purchase_order_id
           AND po.source_type = 'strap_demand'
           AND po.snapshot_locked_at IS NULL
           AND po.status IN ('draft', 'pending', 'Pendente')
           AND NOT EXISTS (
             SELECT 1
               FROM public.purchase_demand_contributions c
              WHERE c.purchase_order_item_id = i.id
                AND c.status = 'awaiting_approval'
           )
        RETURNING i.id
      )
      SELECT count(*)::integer INTO v_deleted_orphan_po_items FROM deleted;

      PERFORM set_config('app.strap_po_engine', v_prev_engine, true);
    END IF;

    WITH cancelled AS (
      UPDATE public.sale_order_strap_demands d
         SET cancelled_m = greatest(
               0,
               d.gross_required_m - coalesce(d.fulfilled_m, 0)
             ),
             status = 'cancelled',
             correlation_id = p_correlation_id,
             updated_at = now()
       WHERE d.sale_order_item_id = ANY(v_preserve)
         AND d.is_current
         AND d.status NOT IN ('cancelled', 'superseded', 'fulfilled')
         AND coalesce(d.fulfilled_m, 0) = 0
         AND NOT public.strap_demand_has_external_commitment(d.id)
      RETURNING d.strap_variant_id
    ),
    demand_variants AS (
      SELECT coalesce(
               array_agg(DISTINCT cancelled.strap_variant_id)
                 FILTER (WHERE cancelled.strap_variant_id IS NOT NULL),
               '{}'::uuid[]
             ) AS ids,
             count(*)::integer AS n
        FROM cancelled
    )
    SELECT (
             SELECT coalesce(array_agg(DISTINCT v), '{}'::uuid[])
               FROM unnest(
                 coalesce(v_variants, '{}'::uuid[]) || demand_variants.ids
               ) AS u(v)
              WHERE v IS NOT NULL
           ),
           demand_variants.n
      INTO v_variants, v_cancelled_demands
      FROM demand_variants;

    UPDATE public.sale_order_items i
       SET production_excluded_at = coalesce(i.production_excluded_at, now()),
           production_excluded_by = coalesce(i.production_excluded_by, v_actor),
           production_exclusion_reason = coalesce(
             nullif(btrim(i.production_exclusion_reason), ''),
             'Removido na edicao do PV; demanda de tira historica preservada'
           ),
           production_exclusion_request_id = coalesce(
             i.production_exclusion_request_id,
             p_correlation_id
           )
     WHERE i.id = ANY(v_preserve)
       AND i.production_excluded_at IS NULL;

    GET DIAGNOSTICS v_preserved = ROW_COUNT;

    PERFORM set_config(
      'app.sale_order_item_production_exclusion_internal',
      v_prev_guc,
      true
    );

    FOREACH v_variant IN ARRAY coalesce(v_variants, '{}'::uuid[])
    LOOP
      PERFORM public.reconcile_strap_variant(
        v_variant,
        p_correlation_id,
        'sale_order_item_removed_on_edit'
      );
    END LOOP;
  END IF;

  IF cardinality(v_delete) > 0 THEN
    v_prev_guc := coalesce(
      nullif(current_setting('app.sale_order_item_production_exclusion_internal', true), ''),
      ''
    );
    v_prev_command := coalesce(
      nullif(current_setting('app.sale_order_command_internal', true), ''),
      ''
    );
    -- pv_edit_hard_delete_command_boundary_20270101023500
    PERFORM set_config('app.sale_order_item_production_exclusion_internal', '1', true);
    PERFORM set_config('app.sale_order_command_internal', '1', true);

    DELETE FROM public.sale_order_items i
     WHERE i.id = ANY(v_delete)
       AND i.sale_order_id = p_order_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    PERFORM set_config(
      'app.sale_order_item_production_exclusion_internal',
      v_prev_guc,
      true
    );
    PERFORM set_config(
      'app.sale_order_command_internal',
      v_prev_command,
      true
    );
  END IF;

  RETURN jsonb_build_object(
    'removed_items', v_removed,
    'preserved_items', v_preserved,
    'cancelled_strap_demands', coalesce(v_cancelled_demands, 0),
    'cancelled_purchase_contributions', coalesce(v_cancelled_purchases, 0),
    'deleted_orphan_strap_po_items', coalesce(v_deleted_orphan_po_items, 0),
    'preserved_item_ids', to_jsonb(v_preserve),
    'deleted_item_ids', to_jsonb(v_delete)
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.finalize_removed_sale_order_items(uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.finalize_removed_sale_order_items(uuid, uuid[], uuid)
  TO service_role;

DO $$
DECLARE
  v_finalize text;
BEGIN
  v_finalize := pg_get_functiondef(
    'private.finalize_removed_sale_order_items(uuid,uuid[],uuid)'::regprocedure
  );
  IF position('pv_edit_hard_delete_command_boundary_20270101023500' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize sem marcador 23500 (command boundary)';
  END IF;
  IF position('app.sale_order_command_internal' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize nao liga app.sale_order_command_internal no hard-delete';
  END IF;
  IF position('v_already_excluded' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize perdeu classificacao soft-excluded';
  END IF;
END;
$$;
