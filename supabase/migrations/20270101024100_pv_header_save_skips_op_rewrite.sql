-- =============================================================================
-- PV em produção: save de cabeçalho documental NÃO reescreve OPs
-- =============================================================================
-- Sintoma (PV-00194, 12/09/2026): editar NF / pedido do cliente / notas num PV
-- Em Produção abria "Cancelar OPs e editar" e o execute tentava
-- persist_sale_order_material_plan_revision + promote_sale_order_atomic_internal.
-- O statement estourou timeout; o pedido NÃO foi salvo.
--
-- Causa:
--   1) execute_sale_order_command WHEN 'update' sempre rematerializa PV ativo.
--   2) preflight exige cancel_op_ids para OPs avançadas mesmo sem mudança fabril.
--   3) o writer vivo (update_sale_order_with_teardown_pre_09100) NÃO faz
--      UPDATE em sale_orders — NF / OC / remessa / notes nunca round-trip.
--
-- Correção (patch do corpo VIVO de execute/preflight, não do arquivo 10400):
--   A) sale_order_update_is_production_neutral — itens + embalagem + terceirização
--   B) apply_sale_order_documentary_header — só chaves presentes; ausente preserva
--   C) apply_sale_order_production_neutral_update — preço/obs + total, sem teardown
--   D) execute: PZ120/cancel/teardown/promote pulados quando neutro
--   E) execute: documentary header SEMPRE, também no caminho que rematerializa
--   F) preflight: não pede confirmação de cancelamento quando neutro
--
-- Marcador: pv_header_save_skips_op_rewrite_20270101024100
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sale_order_update_is_production_neutral(
  p_sale_order_id uuid,
  p_header jsonb,
  p_items jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_header jsonb := COALESCE(p_header, '{}'::jsonb);
  v_existing_ids uuid[] := '{}'::uuid[];
  v_payload_ids uuid[] := '{}'::uuid[];
BEGIN
  -- pv_header_save_skips_op_rewrite_20270101024100
  IF p_sale_order_id IS NULL THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  SELECT so.*
    INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_header ? 'packaging_mode'
     AND NULLIF(btrim(v_header ->> 'packaging_mode'), '')
         IS DISTINCT FROM v_so.packaging_mode THEN
    RETURN false;
  END IF;
  IF v_header ? 'box_grouping'
     AND NULLIF(btrim(v_header ->> 'box_grouping'), '')
         IS DISTINCT FROM v_so.box_grouping THEN
    RETURN false;
  END IF;
  IF v_header ? 'packaging_product_id'
     AND NULLIF(btrim(v_header ->> 'packaging_product_id'), '')::uuid
         IS DISTINCT FROM v_so.packaging_product_id THEN
    RETURN false;
  END IF;
  IF v_header ? 'packaging_quantity'
     AND COALESCE((v_header ->> 'packaging_quantity')::numeric, 0)
         IS DISTINCT FROM COALESCE(v_so.packaging_quantity, 0) THEN
    RETURN false;
  END IF;
  IF v_header ? 'outsource_to_contractor_id'
     AND NULLIF(btrim(v_header ->> 'outsource_to_contractor_id'), '')::uuid
         IS DISTINCT FROM v_so.outsource_to_contractor_id THEN
    RETURN false;
  END IF;
  IF v_header ? 'outsource_to_sector'
     AND NULLIF(btrim(v_header ->> 'outsource_to_sector'), '')
         IS DISTINCT FROM v_so.outsource_to_sector THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) AS item(value)
     WHERE NULLIF(item.value ->> 'reference_id', '') IS NOT NULL
       AND NULLIF(item.value ->> 'production_excluded_at', '') IS NULL
       AND (
         NULLIF(item.value ->> 'id', '') IS NULL
         OR (item.value ->> 'id') !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
  ) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(array_agg(soi.id ORDER BY soi.id), '{}'::uuid[])
    INTO v_existing_ids
    FROM public.sale_order_items soi
   WHERE soi.sale_order_id = p_sale_order_id
     AND soi.production_excluded_at IS NULL
     AND soi.reference_id IS NOT NULL;

  SELECT COALESCE(array_agg(parsed.id ORDER BY parsed.id), '{}'::uuid[])
    INTO v_payload_ids
    FROM (
      SELECT DISTINCT NULLIF(item.value ->> 'id', '')::uuid AS id
        FROM jsonb_array_elements(p_items) AS item(value)
       WHERE NULLIF(item.value ->> 'reference_id', '') IS NOT NULL
         AND NULLIF(item.value ->> 'production_excluded_at', '') IS NULL
         AND NULLIF(item.value ->> 'id', '') IS NOT NULL
    ) parsed;

  IF v_existing_ids IS DISTINCT FROM v_payload_ids THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
      FROM public.sale_order_items soi
      JOIN LATERAL (
        SELECT item.value
          FROM jsonb_array_elements(p_items) AS item(value)
         WHERE item.value ->> 'id' = soi.id::text
         LIMIT 1
      ) proposed ON true
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.production_excluded_at IS NULL
       AND soi.reference_id IS NOT NULL
       AND (
         NULLIF(proposed.value ->> 'reference_id', '')::uuid
           IS DISTINCT FROM soi.reference_id
         OR COALESCE(
              NULLIF(proposed.value ->> 'quantity', '')::integer,
              0
            ) IS DISTINCT FROM soi.quantity
         OR COALESCE(proposed.value ->> 'color', '')
            IS DISTINCT FROM COALESCE(soi.color, '')
         OR COALESCE(proposed.value -> 'grade', '{}'::jsonb)
            IS DISTINCT FROM COALESCE(soi.grade, '{}'::jsonb)
         OR COALESCE(
              NULLIF(proposed.value ->> 'fichas', '')::integer,
              1
            ) IS DISTINCT FROM COALESCE(soi.fichas, 1)
         OR NULLIF(proposed.value ->> 'material_variant_id', '')::uuid
            IS DISTINCT FROM soi.material_variant_id
         OR CASE
              WHEN jsonb_typeof(proposed.value -> 'strap_colors') = 'array'
                THEN proposed.value -> 'strap_colors'
              ELSE '[]'::jsonb
            END IS DISTINCT FROM COALESCE(soi.strap_colors, '[]'::jsonb)
         OR (
           proposed.value ? 'strap_sourcing'
           AND CASE
             WHEN jsonb_typeof(proposed.value -> 'strap_sourcing') = 'object'
               THEN proposed.value -> 'strap_sourcing'
             ELSE NULL
           END IS DISTINCT FROM soi.strap_sourcing
         )
         OR (
           proposed.value ? 'selected_terceirizacao_ids'
           AND CASE
             WHEN jsonb_typeof(
               proposed.value -> 'selected_terceirizacao_ids'
             ) = 'array' THEN ARRAY(
               SELECT NULLIF(selected_id, '')::uuid
                 FROM jsonb_array_elements_text(
                   proposed.value -> 'selected_terceirizacao_ids'
                 ) AS selected(selected_id)
                WHERE NULLIF(selected_id, '') IS NOT NULL
             )
             ELSE '{}'::uuid[]
           END IS DISTINCT FROM COALESCE(
             soi.selected_terceirizacao_ids,
             '{}'::uuid[]
           )
         )
         OR (
           proposed.value ? 'terceirizacao_quantities'
           AND CASE
             WHEN jsonb_typeof(
               proposed.value -> 'terceirizacao_quantities'
             ) = 'object' THEN proposed.value -> 'terceirizacao_quantities'
             ELSE '{}'::jsonb
           END IS DISTINCT FROM COALESCE(
             soi.terceirizacao_quantities,
             '{}'::jsonb
           )
         )
         OR (
           proposed.value ? 'outsourced_sectors'
           AND CASE
             WHEN jsonb_typeof(proposed.value -> 'outsourced_sectors') = 'object'
               THEN proposed.value -> 'outsourced_sectors'
             ELSE '{}'::jsonb
           END IS DISTINCT FROM COALESCE(
             soi.outsourced_sectors,
             '{}'::jsonb
           )
         )
       )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.sale_order_update_is_production_neutral(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_order_update_is_production_neutral(uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.sale_order_update_is_production_neutral(uuid, jsonb, jsonb) IS
  'True quando o payload de update não altera demanda/embalagem/terceirização — NF/OC/notas não entram.';

CREATE OR REPLACE FUNCTION public.apply_sale_order_documentary_header(
  p_sale_order_id uuid,
  p_header jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_header jsonb := COALESCE(p_header, '{}'::jsonb);
BEGIN
  -- pv_header_save_skips_op_rewrite_20270101024100
  -- Chave ausente preserva o valor atual. Nunca grava NULL por omissão do cliente.
  -- packing/outsource ficam no complemento já existente de execute_sale_order_command.
  IF p_sale_order_id IS NULL OR v_header = '{}'::jsonb THEN
    RETURN;
  END IF;

  UPDATE public.sale_orders so
     SET client_order_number = CASE WHEN v_header ? 'client_order_number'
           THEN NULLIF(btrim(v_header ->> 'client_order_number'), '')
           ELSE so.client_order_number END,
         nfe = CASE WHEN v_header ? 'nfe'
           THEN NULLIF(btrim(v_header ->> 'nfe'), '')
           ELSE so.nfe END,
         remessa = CASE WHEN v_header ? 'remessa'
           THEN NULLIF(btrim(v_header ->> 'remessa'), '')
           ELSE so.remessa END,
         notes = CASE WHEN v_header ? 'notes'
           THEN NULLIF(btrim(v_header ->> 'notes'), '')
           ELSE so.notes END,
         brand = CASE WHEN v_header ? 'brand'
           THEN NULLIF(btrim(v_header ->> 'brand'), '')
           ELSE so.brand END,
         informacoes_complementares_nf = CASE
           WHEN v_header ? 'informacoes_complementares_nf'
           THEN NULLIF(btrim(v_header ->> 'informacoes_complementares_nf'), '')
           ELSE so.informacoes_complementares_nf END,
         nfe_required = CASE WHEN v_header ? 'nfe_required'
           THEN COALESCE((v_header ->> 'nfe_required')::boolean, so.nfe_required)
           ELSE so.nfe_required END,
         nfe_external = CASE WHEN v_header ? 'nfe_external'
           THEN COALESCE((v_header ->> 'nfe_external')::boolean, so.nfe_external)
           ELSE so.nfe_external END,
         external_nfe_number = CASE WHEN v_header ? 'external_nfe_number'
           THEN NULLIF(btrim(v_header ->> 'external_nfe_number'), '')
           ELSE so.external_nfe_number END,
         payment_condition = CASE WHEN v_header ? 'payment_condition'
           THEN NULLIF(btrim(v_header ->> 'payment_condition'), '')
           ELSE so.payment_condition END,
         representative = CASE WHEN v_header ? 'representative'
           THEN NULLIF(btrim(v_header ->> 'representative'), '')
           ELSE so.representative END,
         representative_id = CASE WHEN v_header ? 'representative_id'
           THEN NULLIF(btrim(v_header ->> 'representative_id'), '')::uuid
           ELSE so.representative_id END,
         client_contact = CASE WHEN v_header ? 'client_contact'
           THEN NULLIF(btrim(v_header ->> 'client_contact'), '')
           ELSE so.client_contact END,
         client_name = CASE WHEN v_header ? 'client_name'
           THEN NULLIF(btrim(v_header ->> 'client_name'), '')
           ELSE so.client_name END,
         client_cnpj = CASE WHEN v_header ? 'client_cnpj'
           THEN NULLIF(btrim(v_header ->> 'client_cnpj'), '')
           ELSE so.client_cnpj END,
         client_id = CASE WHEN v_header ? 'client_id'
           THEN NULLIF(btrim(v_header ->> 'client_id'), '')::uuid
           ELSE so.client_id END,
         company_id = CASE WHEN v_header ? 'company_id'
           THEN NULLIF(btrim(v_header ->> 'company_id'), '')::uuid
           ELSE so.company_id END,
         order_type = CASE WHEN v_header ? 'order_type'
           THEN NULLIF(btrim(v_header ->> 'order_type'), '')
           ELSE so.order_type END,
         own_delivery = CASE WHEN v_header ? 'own_delivery'
           THEN COALESCE((v_header ->> 'own_delivery')::boolean, so.own_delivery)
           ELSE so.own_delivery END,
         shipping_rate_per_pair = CASE WHEN v_header ? 'shipping_rate_per_pair'
           THEN COALESCE((v_header ->> 'shipping_rate_per_pair')::numeric, 0)
           ELSE so.shipping_rate_per_pair END,
         commission_value = CASE WHEN v_header ? 'commission_value'
           THEN COALESCE((v_header ->> 'commission_value')::numeric, so.commission_value)
           ELSE so.commission_value END,
         updated_at = now()
   WHERE so.id = p_sale_order_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_sale_order_documentary_header(uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_sale_order_documentary_header(uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_sale_order_documentary_header(uuid, jsonb) IS
  'Persiste NF/OC/notas/cliente do header jsonb; chave ausente não apaga o valor atual.';

CREATE OR REPLACE FUNCTION public.apply_sale_order_production_neutral_update(
  p_sale_order_id uuid,
  p_header jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_total numeric;
BEGIN
  -- pv_header_save_skips_op_rewrite_20270101024100
  PERFORM public.apply_sale_order_documentary_header(p_sale_order_id, p_header);

  IF jsonb_typeof(p_items) = 'array' THEN
    UPDATE public.sale_order_items soi
       SET unit_price = COALESCE(
             NULLIF(item.value ->> 'unit_price', '')::numeric,
             soi.unit_price
           ),
           observation = CASE
             WHEN item.value ? 'observation'
               THEN NULLIF(item.value ->> 'observation', '')
             ELSE soi.observation
           END
      FROM jsonb_array_elements(p_items) AS item(value)
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.id = NULLIF(item.value ->> 'id', '')::uuid;
  END IF;

  v_total := public.recalc_sale_order_total(p_sale_order_id);

  RETURN jsonb_build_object(
    'production_neutral', true,
    'order_id', p_sale_order_id,
    'total', v_total
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_sale_order_production_neutral_update(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_sale_order_production_neutral_update(uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_sale_order_production_neutral_update(uuid, jsonb, jsonb) IS
  'Update de PV sem teardown/rematerialização: cabeçalho documental + preço/obs dos itens.';

-- execute_sale_order_command: patches no corpo vivo.
DO $patch_execute$
DECLARE
  v_reg regprocedure := 'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(v_reg);

  IF position('pv_header_save_skips_op_rewrite_20270101024100' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_old := $old$  v_compensatory_cancel boolean := false;
  v_compensatory_reason text;
BEGIN$old$;
  v_new := $new$  v_compensatory_cancel boolean := false;
  v_compensatory_reason text;
  v_production_neutral boolean := false;
BEGIN$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora DECLARE de execute_sale_order_command não encontrada';
  END IF;
  IF (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'DECLARE de execute_sale_order_command não é único';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$        v_teardown_op_ids := v_derived_teardown_op_ids;

        IF p_payload ? 'cancel_op_ids' THEN$old$;
  v_new := $new$        v_teardown_op_ids := v_derived_teardown_op_ids;
        v_production_neutral := public.sale_order_update_is_production_neutral(
          p_sale_order_id,
          COALESCE(v_header, '{}'::jsonb),
          COALESCE(v_items, '[]'::jsonb)
        );

        IF NOT v_production_neutral AND p_payload ? 'cancel_op_ids' THEN$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora teardown/cancel_op_ids de execute_sale_order_command não encontrada';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$        IF EXISTS (
          SELECT 1
            FROM unnest(v_advanced_op_ids) AS advanced(id)
           WHERE NOT (advanced.id = ANY(v_cancel_op_ids))
        ) THEN
          RAISE EXCEPTION
            'Existem OPs avançadas fora de cancel_op_ids; confirme o cancelamento antes de editar'
            USING ERRCODE = 'PZ120';
        END IF;$old$;
  v_new := $new$        IF NOT v_production_neutral AND EXISTS (
          SELECT 1
            FROM unnest(v_advanced_op_ids) AS advanced(id)
           WHERE NOT (advanced.id = ANY(v_cancel_op_ids))
        ) THEN
          RAISE EXCEPTION
            'Existem OPs avançadas fora de cancel_op_ids; confirme o cancelamento antes de editar'
            USING ERRCODE = 'PZ120';
        END IF;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora PZ120 de execute_sale_order_command não encontrada';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$        IF cardinality(v_cancel_op_ids) > 0 THEN
          v_result := public.update_sale_order_with_atomic_op_cancel($old$;
  v_new := $new$        IF v_production_neutral THEN
          -- pv_header_save_skips_op_rewrite_20270101024100
          v_result := public.apply_sale_order_production_neutral_update(
            p_sale_order_id,
            COALESCE(v_header, '{}'::jsonb),
            COALESCE(v_items, '[]'::jsonb)
          );
        ELSIF cardinality(v_cancel_op_ids) > 0 THEN
          v_result := public.update_sale_order_with_atomic_op_cancel($new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora writer teardown de execute_sale_order_command não encontrada';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$        -- Billing/factoring opcionais pertencem ao MESMO intent de edição.$old$;
  v_new := $new$        PERFORM public.apply_sale_order_documentary_header(
          p_sale_order_id,
          COALESCE(v_header, '{}'::jsonb)
        );

        -- Billing/factoring opcionais pertencem ao MESMO intent de edição.$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora billing_patch de execute_sale_order_command não encontrada';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$        IF v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN
          SELECT so.order_version$old$;
  v_new := $new$        IF NOT v_production_neutral
           AND v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN
          SELECT so.order_version$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora rematerialize/persist plan de execute_sale_order_command não encontrada';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$        IF cardinality(v_cancel_op_ids) = 0
           AND v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN$old$;
  v_new := $new$        IF NOT v_production_neutral
           AND cardinality(v_cancel_op_ids) = 0
           AND v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora promote_sale_order_atomic_internal de execute_sale_order_command não encontrada';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END;
$patch_execute$;

-- preflight: OPs avançadas só exigem cancel_op_ids quando a edição mexe na fábrica.
DO $patch_preflight$
DECLARE
  v_reg regprocedure := 'public.preflight_sale_order_command(uuid,text,bigint,uuid,jsonb)'::regprocedure;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(v_reg);

  IF position('pv_header_save_skips_op_rewrite_20270101024100' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_old := $old$        IF cardinality(v_update_missing_cancel_op_ids) > 0 THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'advanced_orders_require_cancel_confirmation',
            'scope', 'production',
            'message', 'Existem OPs avançadas fora de cancel_op_ids.',$old$;
  v_new := $new$        -- pv_header_save_skips_op_rewrite_20270101024100
        IF cardinality(v_update_missing_cancel_op_ids) > 0
           AND NOT public.sale_order_update_is_production_neutral(
             p_sale_order_id,
             COALESCE(p_payload -> 'header', '{}'::jsonb),
             COALESCE(v_update_items, '[]'::jsonb)
           ) THEN
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'advanced_orders_require_cancel_confirmation',
            'scope', 'production',
            'message', 'Existem OPs avançadas fora de cancel_op_ids.',$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora advanced_orders_require_cancel_confirmation não encontrada';
  END IF;
  IF (
    length(v_def) - length(replace(v_def, v_old, ''))
  ) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Âncora advanced_orders_require_cancel_confirmation não é única';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$        SELECT COALESCE(array_agg(requested.id ORDER BY requested.id), '{}'::uuid[])
          INTO v_update_invalid_cancel_op_ids
          FROM unnest(v_update_requested_cancel_op_ids) AS requested(id)
         WHERE NOT (requested.id = ANY(v_update_advanced_op_ids));
        IF cardinality(v_update_invalid_cancel_op_ids) > 0 THEN$old$;
  v_new := $new$        SELECT COALESCE(array_agg(requested.id ORDER BY requested.id), '{}'::uuid[])
          INTO v_update_invalid_cancel_op_ids
          FROM unnest(v_update_requested_cancel_op_ids) AS requested(id)
         WHERE NOT (requested.id = ANY(v_update_advanced_op_ids));
        IF cardinality(v_update_invalid_cancel_op_ids) > 0
           AND NOT public.sale_order_update_is_production_neutral(
             p_sale_order_id,
             COALESCE(p_payload -> 'header', '{}'::jsonb),
             COALESCE(v_update_items, '[]'::jsonb)
           ) THEN$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora invalid_cancel_op_ids do preflight não encontrada';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END;
$patch_preflight$;
