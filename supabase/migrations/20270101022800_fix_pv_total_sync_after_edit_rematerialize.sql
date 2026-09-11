-- =============================================================================
-- PV edit/create: total server-side após soft-preserve + readiness pós-update
-- =============================================================================
-- Sintoma (PV-00169 /sales/edit/41ce3fd8-…, Em Produção + cancelar OPs):
--   "Readiness pós-update recusou a rematerialização do PV ativo"
-- Receipt a8c54818…: post_write_preflight ready=false com
--   sale_order_total_mismatch { stored_total: 36738, calculated_total: 61560 }
--
-- Causa (duas camadas):
--   1) update_sale_order_atomic_legacy_202701 grava total = header do cliente
--      ANTES de finalize_removed_sale_order_items soft-preservar itens com
--      demanda de tira que saíram do payload. Itens soft-excluded continuam
--      na tabela com quantity>0.
--   2) trg_sync_sale_order_total / recalc_sale_order_total sumiram do banco
--      (funções ausentes; triggers de sync de total não existem em
--      sale_order_items). Sem recálculo, o header fica no total do payload
--      enquanto o preflight de promote soma TODOS os itens → PZ107.
--
-- Correção:
--   A) Restaura recalc_sale_order_total somando só itens produtivos
--      (production_excluded_at IS NULL) + triggers de sync (split 04300).
--   B) Writer legado: NÃO confia no total do cliente; após finalize chama
--      recalc_sale_order_total.
--   C) preflight confirm/promote: calculated_total ignora soft-excluded.
--   D) RAISE pós-update inclui o 1º blocker duro (mensagem acionável).
--
-- Marcador: pv_total_sync_after_edit_20270101022800
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalc_sale_order_total(p_sale_order_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
BEGIN
  -- pv_total_sync_after_edit_20270101022800
  IF p_sale_order_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(unit_price, 0)), 0)
    INTO v_total
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id
     AND production_excluded_at IS NULL;

  v_total := round(v_total::numeric, 2);

  UPDATE public.sale_orders
     SET total = v_total,
         updated_at = now()
   WHERE id = p_sale_order_id
     AND COALESCE(total, 0) IS DISTINCT FROM v_total;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_sale_order_total(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalc_sale_order_total(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.recalc_sale_order_total(uuid) IS
  'Sincroniza sale_orders.total com a soma qty×preço dos itens produtivos (production_excluded_at IS NULL).';

CREATE OR REPLACE FUNCTION public.fn_sync_sale_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id uuid;
BEGIN
  -- pv_total_sync_after_edit_20270101022800
  IF TG_OP = 'DELETE' THEN
    v_target_id := OLD.sale_order_id;
    PERFORM public.recalc_sale_order_total(v_target_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    PERFORM public.recalc_sale_order_total(OLD.sale_order_id);
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  ELSE
    PERFORM public.recalc_sale_order_total(NEW.sale_order_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_sync_sale_order_total_on_update ON public.sale_order_items;

CREATE TRIGGER trg_sync_sale_order_total
AFTER INSERT OR DELETE ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_sale_order_total();

-- Espelha o split da 04300: UPDATE só de material_variant_commercial_snapshot
-- (confirmação/review) não deve recalcular total.
CREATE TRIGGER trg_sync_sale_order_total_on_update
AFTER UPDATE ON public.sale_order_items
FOR EACH ROW
WHEN (NOT (
  (to_jsonb(OLD) - 'material_variant_commercial_snapshot')
    IS NOT DISTINCT FROM
  (to_jsonb(NEW) - 'material_variant_commercial_snapshot')
  AND (
    (
      pg_trigger_depth() > 0
      AND COALESCE(
        current_setting('app.material_variant_snapshot_confirmation_order_id', true)
          = NEW.sale_order_id::text,
        false
      )
    )
    OR COALESCE(
      current_setting('app.material_variant_snapshot_review_item_id', true)
        = NEW.id::text,
      false
    )
  )
))
EXECUTE FUNCTION public.fn_sync_sale_order_total();

-- Writer legado: total server-side após soft-preserve.
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
  v_total    numeric;
BEGIN
  -- pv_edit_preserve_strap_demands_20270101022000
  -- pv_total_sync_after_edit_20270101022800
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

  -- total NÃO vem do cliente: soft-preserve pode manter linhas históricas fora
  -- do payload. Recalcula após finalize.
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

  v_finalize := private.finalize_removed_sale_order_items(
    p_order_id,
    v_kept_ids,
    gen_random_uuid()
  );
  v_removed := coalesce((v_finalize ->> 'removed_items')::integer, 0);

  -- Autoridade do total: soma dos itens produtivos após soft-preserve/delete.
  v_total := public.recalc_sale_order_total(p_order_id);

  RETURN jsonb_build_object(
    'inserted_item_ids', to_jsonb(v_kept_ids),
    'item_ids',          to_jsonb(v_kept_ids),
    'removed_items',     v_removed,
    'order_id',          p_order_id,
    'finalize_removed',  v_finalize,
    'total',             v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_sale_order_atomic_legacy_202701(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sale_order_atomic_legacy_202701(uuid, jsonb, jsonb)
  TO authenticated, service_role;

-- Preflight: calculated_total ignora itens soft-excluded.
DO $$
DECLARE
  v_def text;
  v_old text := $old$WHERE i.sale_order_id = p_sale_order_id
           AND i.reference_id IS NOT NULL;$old$;
  v_new text := $new$WHERE i.sale_order_id = p_sale_order_id
           AND i.reference_id IS NOT NULL
           AND i.production_excluded_at IS NULL;$new$;
BEGIN
  IF to_regprocedure(
    'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'preflight_sale_order_command(uuid,text,bigint,uuid,jsonb) ausente';
  END IF;

  v_def := pg_get_functiondef(
    'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'::regprocedure
  );

  IF position('production_excluded_at IS NULL' IN v_def) > 0
     AND position(v_old IN v_def) = 0 THEN
    -- Já filtrado (reapply idempotente).
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Âncora do filtro de itens no preflight não encontrada — o fonte mudou.';
  END IF;

  -- Uma ocorrência: o bloco comercial de confirm/promote.
  IF (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / nullif(length(v_old), 0) <> 1 THEN
    RAISE EXCEPTION
      'Esperava 1 âncora de filtro de itens no preflight; encontrou %',
      (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$$;

-- RAISE pós-update com o blocker duro (sem enfraquecer o gate).
DO $$
DECLARE
  v_def text;
  v_old text := $old$          IF NOT COALESCE(
            (v_post_write_preflight ->> 'ready')::boolean,
            false
          ) THEN
            RAISE EXCEPTION USING
              ERRCODE = 'PZ107',
              MESSAGE = 'Readiness pós-update recusou a rematerialização do PV ativo';
          END IF;$old$;
  v_new text := $new$          IF NOT COALESCE(
            (v_post_write_preflight ->> 'ready')::boolean,
            false
          ) THEN
            RAISE EXCEPTION USING
              ERRCODE = 'PZ107',
              MESSAGE = format(
                'Readiness pós-update recusou a rematerialização do PV ativo: %s',
                COALESCE(
                  (
                    SELECT b->>'message'
                      FROM jsonb_array_elements(
                        COALESCE(v_post_write_preflight -> 'blockers', '[]'::jsonb)
                      ) b
                     WHERE NOT COALESCE((b->>'overridable')::boolean, false)
                     LIMIT 1
                  ),
                  'bloqueio sem detalhe'
                )
              );
          END IF;$new$;
BEGIN
  IF to_regprocedure(
    'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION 'execute_sale_order_command ausente';
  END IF;

  v_def := pg_get_functiondef(
    'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure
  );

  IF position('bloqueio sem detalhe' IN v_def) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION
      'Âncora do RAISE pós-update não encontrada em execute_sale_order_command';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$$;

-- Backfill: alinha totais divergentes (só itens produtivos).
DO $$
DECLARE
  v_so_id uuid;
  v_fixed integer := 0;
BEGIN
  FOR v_so_id IN
    SELECT so.id
      FROM public.sale_orders so
      LEFT JOIN public.sale_order_items soi
        ON soi.sale_order_id = so.id
       AND soi.production_excluded_at IS NULL
     WHERE so.deleted_at IS NULL
     GROUP BY so.id, so.total
    HAVING abs(
      COALESCE(so.total, 0)
      - COALESCE(SUM(COALESCE(soi.quantity, 0) * COALESCE(soi.unit_price, 0)), 0)
    ) > 0.01
  LOOP
    PERFORM public.recalc_sale_order_total(v_so_id);
    v_fixed := v_fixed + 1;
  END LOOP;
  RAISE NOTICE 'pv_total_sync_after_edit_20270101022800: % PVs com total realinhado.', v_fixed;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.recalc_sale_order_total(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Guard: recalc_sale_order_total ausente';
  END IF;
  IF to_regprocedure('public.fn_sync_sale_order_total()') IS NULL THEN
    RAISE EXCEPTION 'Guard: fn_sync_sale_order_total ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.sale_order_items'::regclass
       AND tgname = 'trg_sync_sale_order_total'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Guard: trg_sync_sale_order_total ausente';
  END IF;
  IF position(
    'pv_total_sync_after_edit_20270101022800' IN
    pg_get_functiondef(
      'public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'Guard: writer legado sem marcador 22800';
  END IF;
  IF position(
    'total              = v_merged.total' IN
    pg_get_functiondef(
      'public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)'::regprocedure
    )
  ) > 0 THEN
    RAISE EXCEPTION 'Guard: writer ainda confia no total do cliente';
  END IF;
  IF position(
    'recalc_sale_order_total' IN
    pg_get_functiondef(
      'public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'Guard: writer não recalcula total após finalize';
  END IF;
  IF position(
    'production_excluded_at IS NULL' IN
    pg_get_functiondef(
      'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'Guard: preflight não filtra itens soft-excluded no total';
  END IF;
END;
$$;
