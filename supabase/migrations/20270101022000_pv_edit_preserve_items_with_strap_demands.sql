-- =============================================================================
-- Edição de PV: itens com demanda de tira não podem ser hard-deleted
-- =============================================================================
-- Sintoma (/sales/edit/… + cancelar OPs avançadas):
--   update or delete on table "sale_order_items" violates foreign key constraint
--   "sale_order_strap_demands_sale_order_item_id_fkey"
--
-- Causa: update_sale_order_atomic_legacy_202701 apaga o que sumiu do payload.
-- sale_order_strap_demands.sale_order_item_id é NOT NULL ON DELETE RESTRICT.
-- Cancelar a demanda (status='cancelled') NÃO solta a FK — a linha histórica
-- permanece apontando pro item. O grafo filho (piso, OC, lote, snapshot) também
-- é RESTRICT, então apagar a demanda não é opção segura.
--
-- Correção (alinhada à aposentadoria de ficha / production_excluded_*):
--   1) Itens já retirados da produção nunca entram no DELETE (guard PZ240).
--   2) Itens com demanda de tira (ou contrib. de compra / claims fiscais)
--      viram soft-exclude + cancelamento do saldo reversível de demanda.
--   3) Itens limpos continuam sendo hard-deleted.
--   4) Compromisso externo (OS enviada/recibo/custódia) continua bloqueando,
--      com mensagem acionável.
--
-- Marcador: pv_edit_preserve_strap_demands_20270101022000
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_guard_sale_order_item_production_exclusion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_internal boolean := COALESCE(
    pg_catalog.current_setting(
      'app.sale_order_item_production_exclusion_internal',
      true
    ),
    ''
  ) = '1';
  v_changed boolean;
  v_production_identity_changed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.production_excluded_at IS NOT NULL THEN
      RAISE EXCEPTION 'Item retirado da producao nao pode ser apagado; preserve a linha historica'
        USING ERRCODE = 'PZ240';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := NEW.production_excluded_at IS NOT NULL
      OR NEW.production_excluded_by IS NOT NULL
      OR NEW.production_exclusion_reason IS NOT NULL
      OR NEW.production_exclusion_request_id IS NOT NULL;
  ELSE
    v_changed := NEW.production_excluded_at IS DISTINCT FROM OLD.production_excluded_at
      OR NEW.production_excluded_by IS DISTINCT FROM OLD.production_excluded_by
      OR NEW.production_exclusion_reason IS DISTINCT FROM OLD.production_exclusion_reason
      OR NEW.production_exclusion_request_id IS DISTINCT FROM OLD.production_exclusion_request_id;

    IF OLD.production_excluded_at IS NOT NULL THEN
      v_production_identity_changed := (
        pg_catalog.to_jsonb(NEW) - ARRAY[
          'qty_devolvida',
          'material_variant_commercial_snapshot',
          'production_excluded_at',
          'production_excluded_by',
          'production_exclusion_reason',
          'production_exclusion_request_id'
        ]::text[]
      ) IS DISTINCT FROM (
        pg_catalog.to_jsonb(OLD) - ARRAY[
          'qty_devolvida',
          'material_variant_commercial_snapshot',
          'production_excluded_at',
          'production_excluded_by',
          'production_exclusion_reason',
          'production_exclusion_request_id'
        ]::text[]
      );
    END IF;
  END IF;

  IF v_production_identity_changed THEN
    RAISE EXCEPTION 'Item retirado da producao e imutavel; preserve a linha historica'
      USING ERRCODE = 'PZ240';
  END IF;

  IF v_changed AND NOT v_internal THEN
    RAISE EXCEPTION 'Retirada produtiva do item exige o comando administrativo da ficha'
      USING ERRCODE = '42501';
  END IF;

  -- GUC interno só é ligado por SECURITY DEFINER (aposentar ficha OU writer
  -- atômico do PV). Com o GUC, Comercial/Gerência também podem soft-exclude
  -- na edição — senão o save com OP avançada morria na FK de strap_demands
  -- sem caminho legal pra preservar a linha.
  IF v_changed
     AND (
       auth.uid() IS NULL
       OR NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])
     ) THEN
    RAISE EXCEPTION 'Permission denied: retirada produtiva exige Administrador/Gerencia/Comercial'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.finalize_removed_sale_order_items(
  p_order_id uuid,
  p_kept_ids uuid[],
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  -- pv_edit_preserve_strap_demands_20270101022000
  SELECT coalesce(array_agg(i.id ORDER BY i.id), '{}'::uuid[])
    INTO v_doomed
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_order_id
     AND NOT (i.id = ANY(coalesce(p_kept_ids, '{}'::uuid[])));

  IF cardinality(v_doomed) = 0 THEN
    RETURN jsonb_build_object(
      'removed_items', 0,
      'preserved_items', 0,
      'cancelled_strap_demands', 0
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
           ),
           updated_at = now()
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
    'preserved_item_ids', to_jsonb(v_preserve),
    'deleted_item_ids', to_jsonb(v_delete)
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.finalize_removed_sale_order_items(uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Substitui só o trecho de DELETE do writer legado (corpo = 20261115120100).
CREATE OR REPLACE FUNCTION public.update_sale_order_atomic_legacy_202701(
  p_order_id uuid,
  p_header jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so       sale_orders%ROWTYPE;
  v_merged   sale_orders%ROWTYPE;
  v_item     jsonb;
  v_item_id  uuid;
  v_new_id   uuid;
  v_kept_ids uuid[] := '{}';
  v_removed  int := 0;
  v_finalize jsonb;
BEGIN
  -- pv_edit_preserve_strap_demands_20270101022000
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % não encontrado', p_order_id;
  END IF;

  v_merged := jsonb_populate_record(v_so, p_header);
  v_merged.id         := v_so.id;
  v_merged.status     := v_so.status;
  v_merged.created_at := v_so.created_at;
  v_merged.updated_at := now();

  UPDATE public.sale_orders SET
    order_number       = v_merged.order_number,
    client_name        = v_merged.client_name,
    client_cnpj        = v_merged.client_cnpj,
    client_contact     = v_merged.client_contact,
    client_id          = v_merged.client_id,
    representative     = v_merged.representative,
    representative_id  = v_merged.representative_id,
    payment_condition  = v_merged.payment_condition,
    delivery_deadline  = v_merged.delivery_deadline,
    notes              = v_merged.notes,
    total              = v_merged.total,
    commission_value   = v_merged.commission_value,
    client_order_number = v_merged.client_order_number,
    nfe                = v_merged.nfe,
    company_id         = v_merged.company_id,
    informacoes_complementares_nf = v_merged.informacoes_complementares_nf,
    brand              = v_merged.brand,
    transporter_id     = v_merged.transporter_id,
    nfe_external       = v_merged.nfe_external,
    remessa            = v_merged.remessa,
    packaging_product_id = v_merged.packaging_product_id,
    packaging_quantity = v_merged.packaging_quantity,
    is_factoring       = v_merged.is_factoring,
    factoring_config_id = v_merged.factoring_config_id,
    packaging_mode     = v_merged.packaging_mode,
    delivery_week      = v_merged.delivery_week,
    delivery_month     = v_merged.delivery_month,
    billing_week       = v_merged.billing_week,
    manual_billing_override = v_merged.manual_billing_override,
    original_min_billing_date = v_merged.original_min_billing_date,
    manual_override_reason = v_merged.manual_override_reason,
    scheduled_dispatch_at = v_merged.scheduled_dispatch_at,
    modalidade_frete   = v_merged.modalidade_frete,
    transport_company_id = v_merged.transport_company_id,
    valor_frete        = v_merged.valor_frete,
    checked_by         = v_merged.checked_by,
    order_type         = v_merged.order_type,
    parent_order_id    = v_merged.parent_order_id,
    export_currency    = v_merged.export_currency,
    export_exchange_rate = v_merged.export_exchange_rate,
    export_incoterm    = v_merged.export_incoterm,
    shipping_rate_per_pair = v_merged.shipping_rate_per_pair,
    nfe_required       = v_merged.nfe_required,
    own_delivery       = v_merged.own_delivery,
    updated_at         = v_merged.updated_at
  WHERE id = p_order_id;

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
      v_item_id := NULLIF(v_item->>'id', '')::uuid;

      IF v_item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.sale_order_items
         WHERE id = v_item_id AND sale_order_id = p_order_id
      ) THEN
        UPDATE public.sale_order_items SET
          reference_id        = (v_item->>'reference_id')::uuid,
          color               = COALESCE(v_item->>'color', ''),
          quantity            = COALESCE((v_item->>'quantity')::integer, 0),
          unit_price          = COALESCE((v_item->>'unit_price')::numeric, 0),
          grade               = COALESCE(v_item->'grade', '{}'::jsonb),
          fichas              = COALESCE((v_item->>'fichas')::integer, 1),
          observation         = NULLIF(v_item->>'observation', ''),
          material_variant_id = NULLIF(v_item->>'material_variant_id', '')::uuid,
          strap_colors        = CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
                                     THEN v_item->'strap_colors'
                                     ELSE '[]'::jsonb END,
          strap_sourcing      = CASE WHEN v_item ? 'strap_sourcing'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'strap_sourcing') = 'object'
                                                THEN v_item->'strap_sourcing' ELSE NULL END)
                                     ELSE strap_sourcing END,
          selected_terceirizacao_ids = CASE WHEN v_item ? 'selected_terceirizacao_ids'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'selected_terceirizacao_ids') = 'array'
                                                THEN ARRAY(SELECT NULLIF(t, '')::uuid
                                                             FROM jsonb_array_elements_text(v_item->'selected_terceirizacao_ids') t
                                                            WHERE NULLIF(t, '') IS NOT NULL)
                                                ELSE '{}'::uuid[] END)
                                     ELSE selected_terceirizacao_ids END,
          terceirizacao_quantities = CASE WHEN v_item ? 'terceirizacao_quantities'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'terceirizacao_quantities') = 'object'
                                                THEN v_item->'terceirizacao_quantities' ELSE '{}'::jsonb END)
                                     ELSE terceirizacao_quantities END,
          outsourced_sectors  = CASE WHEN v_item ? 'outsourced_sectors'
                                     THEN (CASE WHEN jsonb_typeof(v_item->'outsourced_sectors') = 'object'
                                                THEN v_item->'outsourced_sectors' ELSE '{}'::jsonb END)
                                     ELSE outsourced_sectors END
        WHERE id = v_item_id;
        v_kept_ids := v_kept_ids || v_item_id;
      ELSE
        INSERT INTO public.sale_order_items (
          sale_order_id, reference_id, color, quantity, unit_price,
          grade, fichas, observation, material_variant_id, strap_colors,
          strap_sourcing, selected_terceirizacao_ids, terceirizacao_quantities, outsourced_sectors
        ) VALUES (
          p_order_id,
          (v_item->>'reference_id')::uuid,
          COALESCE(v_item->>'color', ''),
          COALESCE((v_item->>'quantity')::integer, 0),
          COALESCE((v_item->>'unit_price')::numeric, 0),
          COALESCE(v_item->'grade', '{}'::jsonb),
          COALESCE((v_item->>'fichas')::integer, 1),
          NULLIF(v_item->>'observation', ''),
          NULLIF(v_item->>'material_variant_id', '')::uuid,
          CASE WHEN jsonb_typeof(v_item->'strap_colors') = 'array'
               THEN v_item->'strap_colors'
               ELSE '[]'::jsonb END,
          CASE WHEN jsonb_typeof(v_item->'strap_sourcing') = 'object' THEN v_item->'strap_sourcing' ELSE NULL END,
          CASE WHEN jsonb_typeof(v_item->'selected_terceirizacao_ids') = 'array'
               THEN ARRAY(SELECT NULLIF(t, '')::uuid
                            FROM jsonb_array_elements_text(v_item->'selected_terceirizacao_ids') t
                           WHERE NULLIF(t, '') IS NOT NULL)
               ELSE '{}'::uuid[] END,
          CASE WHEN jsonb_typeof(v_item->'terceirizacao_quantities') = 'object'
               THEN v_item->'terceirizacao_quantities' ELSE '{}'::jsonb END,
          CASE WHEN jsonb_typeof(v_item->'outsourced_sectors') = 'object'
               THEN v_item->'outsourced_sectors' ELSE '{}'::jsonb END
        )
        RETURNING id INTO v_new_id;
        v_kept_ids := v_kept_ids || v_new_id;
      END IF;
    END LOOP;
  END IF;

  -- Em vez do DELETE cru: soft-exclude itens com demanda de tira / preserve
  -- linhas já excluídas; só apaga o que não tem dependência RESTRICT.
  v_finalize := private.finalize_removed_sale_order_items(
    p_order_id,
    v_kept_ids,
    gen_random_uuid()
  );
  v_removed := coalesce((v_finalize ->> 'removed_items')::integer, 0);

  RETURN jsonb_build_object(
    'inserted_item_ids', to_jsonb(v_kept_ids),
    'item_ids',          to_jsonb(v_kept_ids),
    'removed_items',     v_removed,
    'order_id',          p_order_id,
    'finalize_removed',  v_finalize
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_sale_order_atomic_legacy_202701(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  v_legacy text := pg_get_functiondef(
    'public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)'::regprocedure
  );
  v_finalize text := pg_get_functiondef(
    'private.finalize_removed_sale_order_items(uuid,uuid[],uuid)'::regprocedure
  );
  v_guard text := pg_get_functiondef(
    'public.tg_guard_sale_order_item_production_exclusion()'::regprocedure
  );
BEGIN
  IF position('pv_edit_preserve_strap_demands_20270101022000' IN v_legacy) = 0 THEN
    RAISE EXCEPTION 'Guard: legacy writer sem marcador 22000';
  END IF;
  IF position('private.finalize_removed_sale_order_items' IN v_legacy) = 0 THEN
    RAISE EXCEPTION 'Guard: legacy writer nao chama finalize_removed_sale_order_items';
  END IF;
  IF position('DELETE FROM public.sale_order_items' IN v_legacy) > 0
     AND position('private.finalize_removed_sale_order_items' IN v_legacy) = 0 THEN
    RAISE EXCEPTION 'Guard: DELETE cru de itens ainda no writer legado';
  END IF;
  IF position('pv_edit_preserve_strap_demands_20270101022000' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize sem marcador 22000';
  END IF;
  IF position('sale_order_strap_demands' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'Guard: finalize nao trata sale_order_strap_demands';
  END IF;
  IF position('''admin'', ''gerente'', ''comercial''' IN v_guard) = 0
     AND position('ARRAY[''admin'', ''gerente'', ''comercial'']' IN v_guard) = 0 THEN
    RAISE EXCEPTION 'Guard: exclusao produtiva nao libera gerente/comercial com GUC';
  END IF;
END;
$$;
