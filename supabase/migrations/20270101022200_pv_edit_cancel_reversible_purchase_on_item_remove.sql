-- =============================================================================
-- Edição de PV: ao remover item, cancela contribuição de compra reversível
-- =============================================================================
-- PV-00169: soft-exclude (22000) preservava o item com demanda/contribuição, mas
-- NÃO cancelava purchase_demand_contributions em awaiting_approval. A remoção
-- "aparecia salva" no toast genérico enquanto a demanda de compra seguia viva.
--
-- Esta migration:
--   1) cancela contribuições reversíveis (proposed/awaiting_approval/suspended
--      com committed=0) antes do soft-exclude;
--   2) barra contribuições já avançadas (approved/sent/partial/received) com
--      mensagem acionável — soft-exclude ainda ocorre (histórico), mas o receipt
--      reporta cancelled_purchase_contributions;
--   3) mantém hard-DELETE só para itens sem demanda/contribuição.
--
-- Marcador: pv_edit_cancel_reversible_purchase_20270101022200
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
  v_prev_guc text;
  v_actor uuid := auth.uid();
  v_removed int := 0;
  v_preserved int := 0;
  v_cancelled_demands int := 0;
  v_cancelled_purchases int := 0;
BEGIN
  -- pv_edit_cancel_reversible_purchase_20270101022200
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
      'cancelled_purchase_contributions', 0
    );
  END IF;

  FOREACH v_item_id IN ARRAY v_doomed
  LOOP
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items i
       WHERE i.id = v_item_id
         AND i.production_excluded_at IS NOT NULL
    ) THEN
      v_preserve := array_append(v_preserve, v_item_id);
      CONTINUE;
    END IF;

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

    -- Contribuição de compra já avançada: item precisa permanecer (histórico),
    -- mas o operador precisa saber que a OC/aprovação não é desfeita aqui.
    IF EXISTS (
      SELECT 1
        FROM public.purchase_demand_contributions c
       WHERE c.sale_order_item_id = v_item_id
         AND c.status IN ('approved', 'sent', 'partial', 'received')
    ) THEN
      v_preserve := array_append(v_preserve, v_item_id);
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

    -- Cancela contribuições de compra ainda reversíveis (sem qty committed).
    WITH cancelled_purchases AS (
      UPDATE public.purchase_demand_contributions c
         SET status = 'cancelled',
             suspension_reason = coalesce(
               nullif(btrim(c.suspension_reason), ''),
               'Item removido na edicao do PV'
             ),
             correlation_id = p_correlation_id,
             updated_at = now()
       WHERE c.sale_order_item_id = ANY(v_preserve)
         AND c.status IN ('proposed', 'awaiting_approval', 'suspended')
         AND coalesce(c.committed_quantity_stock_unit, 0) = 0
      RETURNING c.id
    )
    SELECT count(*)::integer INTO v_cancelled_purchases FROM cancelled_purchases;

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
    )
    SELECT coalesce(array_agg(DISTINCT cancelled.strap_variant_id), '{}'::uuid[]),
           count(*)::integer
      INTO v_variants, v_cancelled_demands
      FROM cancelled;

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
    DELETE FROM public.sale_order_items i
     WHERE i.id = ANY(v_delete)
       AND i.sale_order_id = p_order_id
       AND i.production_excluded_at IS NULL;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'removed_items', v_removed,
    'preserved_items', v_preserved,
    'cancelled_strap_demands', coalesce(v_cancelled_demands, 0),
    'cancelled_purchase_contributions', coalesce(v_cancelled_purchases, 0),
    'preserved_item_ids', to_jsonb(v_preserve),
    'deleted_item_ids', to_jsonb(v_delete)
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.finalize_removed_sale_order_items(uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.finalize_removed_sale_order_items(uuid, uuid[], uuid)
  TO service_role;

-- BEFORE DELETE: cancela contribuições reversíveis em vez de só barrar.
CREATE OR REPLACE FUNCTION public.tg_release_strap_demands_before_item_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_blocked uuid;
  v_variants uuid[] := '{}'::uuid[];
  v_variant uuid;
  v_correlation uuid := gen_random_uuid();
BEGIN
  -- pv_edit_cancel_reversible_purchase_20270101022200
  IF EXISTS (
    SELECT 1
      FROM public.nfe_devolucao_item_claims c
     WHERE c.sale_order_item_id = OLD.id
       AND c.status IS DISTINCT FROM 'released'
  ) THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: ha claim de devolucao NF-e vinculado'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.service_order_return_items r
     WHERE r.sale_order_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: ha retorno de OS vinculado'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT d.id INTO v_blocked
    FROM public.sale_order_strap_demands d
   WHERE d.sale_order_item_id = OLD.id
     AND public.strap_demand_has_external_commitment(d.id)
   LIMIT 1;
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: demanda de tira com compromisso externo (OS enviada/recibo/custodia)'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.purchase_demand_contributions c
     WHERE c.sale_order_item_id = OLD.id
       AND c.status IN ('approved', 'sent', 'partial', 'received')
  ) THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: ha contribuicao de compra de tira ja avancada. Use a retirada produtiva.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.purchase_demand_contributions c
     SET status = 'cancelled',
         suspension_reason = coalesce(
           nullif(btrim(c.suspension_reason), ''),
           'Item removido do PV'
         ),
         correlation_id = v_correlation,
         updated_at = now()
   WHERE c.sale_order_item_id = OLD.id
     AND c.status IN ('proposed', 'awaiting_approval', 'suspended')
     AND coalesce(c.committed_quantity_stock_unit, 0) = 0;

  -- Após cancelar, solta a FK RESTRICT apontando o item (coluna é nullable).
  UPDATE public.purchase_demand_contributions c
     SET sale_order_item_id = NULL,
         updated_at = now()
   WHERE c.sale_order_item_id = OLD.id
     AND c.status IN ('cancelled', 'superseded');

  IF EXISTS (
    SELECT 1
      FROM public.purchase_demand_contributions c
     WHERE c.sale_order_item_id = OLD.id
       AND c.status NOT IN ('cancelled', 'superseded')
  ) THEN
    RAISE EXCEPTION
      'Nao e possivel remover o item do PV: ha contribuicao de compra de tira ativa. Use a retirada produtiva.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(DISTINCT d.strap_variant_id), '{}'::uuid[])
    INTO v_variants
    FROM public.sale_order_strap_demands d
   WHERE d.sale_order_item_id = OLD.id
     AND d.is_current
     AND d.status NOT IN ('cancelled', 'superseded', 'fulfilled');

  UPDATE public.sale_order_strap_demands d
     SET cancelled_m = greatest(0, d.gross_required_m - coalesce(d.fulfilled_m, 0)),
         status = 'cancelled',
         correlation_id = v_correlation,
         updated_at = now()
   WHERE d.sale_order_item_id = OLD.id
     AND d.is_current
     AND d.status NOT IN ('cancelled', 'superseded', 'fulfilled')
     AND coalesce(d.fulfilled_m, 0) = 0
     AND NOT public.strap_demand_has_external_commitment(d.id);

  FOREACH v_variant IN ARRAY v_variants
  LOOP
    PERFORM public.reconcile_strap_variant(
      v_variant,
      v_correlation,
      'sale_order_item_deleted'
    );
  END LOOP;

  RETURN OLD;
END;
$function$;

DO $$
DECLARE
  v_finalize text := pg_get_functiondef(
    'private.finalize_removed_sale_order_items(uuid,uuid[],uuid)'::regprocedure
  );
  v_release text := pg_get_functiondef(
    'public.tg_release_strap_demands_before_item_delete()'::regprocedure
  );
BEGIN
  IF position('pv_edit_cancel_reversible_purchase_20270101022200' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize_removed sem marcador 22200';
  END IF;
  IF position('cancelled_purchase_contributions' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize_removed nao cancela purchase contributions';
  END IF;
  IF position('pv_edit_cancel_reversible_purchase_20270101022200' IN v_release) = 0 THEN
    RAISE EXCEPTION 'Guard: release trigger sem marcador 22200';
  END IF;
END $$;
