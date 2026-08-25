-- Compras por Pedido: inclui a embalagem canônica no mesmo lote atômico.
--
-- Fonte única:
--   sale_order_items.reference_id
--     -> technical_sheets.sole_group_id
--     -> product_groups.box_type_* (selecionado por sale_orders.packaging_mode)
--     -> box_types
--
-- Não cria produto espelho, não casa nome/categoria e não toca movimentos,
-- reservas, OCs ou pedidos históricos. A migration 121 abriu o contrato XOR
-- de purchase_order_items e fornece create/receive atômico para box_types.

BEGIN;

-- A 124 compõe, mas não redefine, a fronteira genérica da 121. Falhar aqui é
-- preferível a criar um canal per-PV sobre uma versão parcial da migration.
DO $require_purchase_order_box_contract_121$
DECLARE
  v_command text;
BEGIN
  IF to_regprocedure(
       'public.lock_purchase_order_box_types_121(uuid[])'
     ) IS NULL
     OR to_regprocedure(
       'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'
     ) IS NULL
     OR to_regclass('public.box_type_stock_movements') IS NULL THEN
    RAISE EXCEPTION
      'Contrato box_types da migration 121 ausente; 124 não pode ser aplicada';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns column_row
     WHERE column_row.table_schema = 'public'
       AND column_row.table_name = 'purchase_order_items'
       AND column_row.column_name = 'product_id'
       AND column_row.is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_constraint constraint_row
     WHERE constraint_row.conrelid = 'public.purchase_order_items'::regclass
       AND constraint_row.conname = 'purchase_order_items_exactly_one_stock_identity_ck'
       AND constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION
      'purchase_order_items não possui identidade XOR products/box_types validada';
  END IF;

  SELECT pg_get_functiondef(
    'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure
  ) INTO v_command;
  IF position('lock_purchase_order_box_types_121' IN v_command) = 0
     OR position('INSERT INTO public.box_type_stock_movements' IN v_command) = 0
     OR position('v_box_type.tipo::text = ''fitilho'' THEN ''m''' IN v_command) = 0 THEN
    RAISE EXCEPTION
      'execute_purchase_order_command da 121 não cobre lock, ledger dedicado e unidade de box_types';
  END IF;
END;
$require_purchase_order_box_contract_121$;

-- Demanda alocada por PV. O estoque de box_types é distribuído uma única vez,
-- em ordem determinística de criação do PV, para dois botões simultâneos não
-- contarem o mesmo metro/caixa como disponível.
CREATE OR REPLACE FUNCTION public.compute_per_pv_packaging_purchase_needs_124(
  p_pv_ids uuid[]
)
RETURNS TABLE(
  box_type_id uuid,
  packaging_type text,
  product_name text,
  unit text,
  needed_qty numeric,
  stock_qty numeric,
  shortage numeric,
  supplier_id uuid,
  supplier_name text,
  last_unit_price numeric,
  conversion_warning text,
  open_purchase_warning text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $function$
  WITH eligible_items AS (
    SELECT so.id AS sale_order_id,
           so.created_at AS sale_order_created_at,
           soi.id AS sale_order_item_id,
           soi.reference_id,
           COALESCE(soi.quantity, 0)::numeric AS quantity,
           soi.grade,
           so.packaging_mode
      FROM public.sale_orders so
      JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
       AND soi.reference_id IS NOT NULL
       AND COALESCE(soi.quantity, 0) > 0
  ), raw_lines AS (
    SELECT item.sale_order_id,
           item.sale_order_created_at,
           item.sale_order_item_id,
           packaging.box_type_id,
           packaging.packaging_type,
           packaging.box_name,
           packaging.unit,
           packaging.required,
           packaging.warning
      FROM eligible_items item
      CROSS JOIN LATERAL public.calculate_packaging_consumption(
        item.reference_id,
        item.quantity,
        item.packaging_mode,
        item.grade
      ) packaging
  ), demand_by_pv AS (
    SELECT line.sale_order_id,
           min(line.sale_order_created_at) AS sale_order_created_at,
           line.box_type_id,
           max(line.packaging_type) AS packaging_type,
           max(line.box_name) AS box_name,
           max(line.unit) AS unit,
           sum(line.required) AS needed_qty
      FROM raw_lines line
     WHERE line.box_type_id IS NOT NULL
       AND line.warning IS NULL
       AND COALESCE(line.required, 0) > 0
     GROUP BY line.sale_order_id, line.box_type_id
  ), ordered AS (
    SELECT demand.*,
           COALESCE(sum(demand.needed_qty) OVER (
             PARTITION BY demand.box_type_id
             ORDER BY demand.sale_order_created_at, demand.sale_order_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_demand
      FROM demand_by_pv demand
  ), allocated AS (
    SELECT demand.*,
           LEAST(
             demand.needed_qty,
             GREATEST(0, COALESCE(box.quantity, 0) - demand.prior_demand)
           ) AS allocated_stock,
           GREATEST(
             0,
             demand.needed_qty
               - GREATEST(0, COALESCE(box.quantity, 0) - demand.prior_demand)
           ) AS allocated_shortage
      FROM ordered demand
      JOIN public.box_types box ON box.id = demand.box_type_id
  ), target_rollup AS (
    SELECT allocated.box_type_id,
           max(allocated.packaging_type) AS packaging_type,
           max(allocated.box_name) AS box_name,
           max(allocated.unit) AS unit,
           sum(allocated.needed_qty) AS needed_qty,
           sum(allocated.allocated_stock) AS stock_qty,
           sum(allocated.allocated_shortage) AS shortage
      FROM allocated
     WHERE allocated.sale_order_id = ANY(COALESCE(p_pv_ids, ARRAY[]::uuid[]))
     GROUP BY allocated.box_type_id
  ), open_purchase AS (
    SELECT item.box_type_id,
           string_agg(DISTINCT purchase_order.order_number, ', '
             ORDER BY purchase_order.order_number) AS order_numbers
      FROM public.purchase_order_items item
      JOIN public.purchase_orders purchase_order
        ON purchase_order.id = item.purchase_order_id
     WHERE item.box_type_id IS NOT NULL
       AND lower(COALESCE(purchase_order.status, '')) NOT IN (
         'cancelled', 'canceled', 'cancelada',
         'received', 'recebida', 'receiving'
       )
       AND purchase_order.source_type IS DISTINCT FROM 'strap_demand'
       -- Espelha o canal products da 111: compra automática de OUTRO PV é
       -- contribuição distinta e não bloqueia. Compra manual/MRP ou a compra
       -- automática dos próprios PVs selecionados continua sendo conflito.
       AND (
         NOT (
           COALESCE(purchase_order.auto_generated, false)
           AND purchase_order.source_type = 'per_pv'
         )
         OR COALESCE(purchase_order.source_pv_ids, ARRAY[]::uuid[])
              && COALESCE(p_pv_ids, ARRAY[]::uuid[])
         OR COALESCE(purchase_order.linked_sale_order_ids, ARRAY[]::uuid[])
              && COALESCE(p_pv_ids, ARRAY[]::uuid[])
       )
       AND GREATEST(
         0,
         COALESCE(item.quantity, 0) - COALESCE(item.received_quantity, 0)
       ) > 0
     GROUP BY item.box_type_id
  ), diagnostics AS (
    SELECT line.packaging_type,
           max(line.warning) AS warning
      FROM raw_lines line
     WHERE line.sale_order_id = ANY(COALESCE(p_pv_ids, ARRAY[]::uuid[]))
       AND line.warning IS NOT NULL
     GROUP BY line.packaging_type, line.warning
  )
  SELECT combined.*
    FROM (
      SELECT rollup.box_type_id AS box_type_id,
             rollup.packaging_type AS packaging_type,
             COALESCE(box.nome, rollup.box_name, rollup.box_type_id::text)
               AS product_name,
             CASE WHEN box.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END
               AS unit,
             rollup.needed_qty AS needed_qty,
             rollup.stock_qty AS stock_qty,
             rollup.shortage AS shortage,
             box.supplier_id AS supplier_id,
             supplier.name AS supplier_name,
             COALESCE(box.unit_price, 0) AS last_unit_price,
             NULL::text AS conversion_warning,
             CASE WHEN open_purchase.box_type_id IS NOT NULL THEN format(
               'Já existe compra aberta para a embalagem "%s" nas OCs %s. '
               || 'Confira ou autorize explicitamente antes de comprar novamente.',
               box.nome,
               open_purchase.order_numbers
             ) ELSE NULL END AS open_purchase_warning
        FROM target_rollup rollup
        JOIN public.box_types box
          ON box.id = rollup.box_type_id
         AND box.active = true
        LEFT JOIN public.suppliers supplier ON supplier.id = box.supplier_id
        LEFT JOIN open_purchase ON open_purchase.box_type_id = rollup.box_type_id
      UNION ALL
      SELECT NULL::uuid AS box_type_id,
             diagnostic.packaging_type AS packaging_type,
             'Embalagem não resolvida'::text AS product_name,
             'un'::text AS unit,
             0::numeric AS needed_qty,
             0::numeric AS stock_qty,
             0::numeric AS shortage,
             NULL::uuid AS supplier_id,
             NULL::text AS supplier_name,
             0::numeric AS last_unit_price,
             diagnostic.warning AS conversion_warning,
             NULL::text AS open_purchase_warning
        FROM diagnostics diagnostic
    ) combined
   ORDER BY combined.supplier_name NULLS LAST,
            combined.product_name,
            combined.packaging_type;
$function$;

REVOKE ALL ON FUNCTION public.compute_per_pv_packaging_purchase_needs_124(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_per_pv_packaging_purchase_needs_124(uuid[])
  TO authenticated, service_role;

-- Contrato discriminado consumido pelo frontend. material_id/box_type_id são
-- XOR; as colunas restantes preservam o shape anterior para o builder de OCs.
CREATE OR REPLACE FUNCTION public.compute_per_pv_purchase_needs_v2(p_pv_ids uuid[])
RETURNS TABLE(
  material_id uuid,
  box_type_id uuid,
  packaging_type text,
  product_name text,
  unit text,
  color text,
  needed_qty numeric,
  stock_qty numeric,
  shortage numeric,
  supplier_id uuid,
  supplier_name text,
  last_unit_price numeric,
  is_artisanal boolean,
  grade jsonb,
  color_mismatch boolean,
  conversion_warning text,
  shortage_grade jsonb,
  open_purchase_warning text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $function$
  SELECT combined.*
    FROM (
      SELECT material.material_id AS material_id,
             NULL::uuid AS box_type_id,
             NULL::text AS packaging_type,
             material.product_name AS product_name,
             material.unit AS unit,
             material.color AS color,
             material.needed_qty AS needed_qty,
             material.stock_qty AS stock_qty,
             material.shortage AS shortage,
             material.supplier_id AS supplier_id,
             material.supplier_name AS supplier_name,
             material.last_unit_price AS last_unit_price,
             material.is_artisanal AS is_artisanal,
             material.grade AS grade,
             material.color_mismatch AS color_mismatch,
             material.conversion_warning AS conversion_warning,
             material.shortage_grade AS shortage_grade,
             material.open_purchase_warning AS open_purchase_warning
        FROM public.compute_per_pv_purchase_needs(p_pv_ids) material
      UNION ALL
      SELECT NULL::uuid AS material_id,
             packaging.box_type_id AS box_type_id,
             packaging.packaging_type AS packaging_type,
             packaging.product_name AS product_name,
             packaging.unit AS unit,
             NULL::text AS color,
             packaging.needed_qty AS needed_qty,
             packaging.stock_qty AS stock_qty,
             packaging.shortage AS shortage,
             packaging.supplier_id AS supplier_id,
             packaging.supplier_name AS supplier_name,
             packaging.last_unit_price AS last_unit_price,
             false AS is_artisanal,
             NULL::jsonb AS grade,
             false AS color_mismatch,
             packaging.conversion_warning AS conversion_warning,
             NULL::jsonb AS shortage_grade,
             packaging.open_purchase_warning AS open_purchase_warning
        FROM public.compute_per_pv_packaging_purchase_needs_124(p_pv_ids) packaging
    ) combined
   ORDER BY combined.supplier_name NULLS LAST,
            combined.product_name,
            combined.color;
$function$;

REVOKE ALL ON FUNCTION public.compute_per_pv_purchase_needs_v2(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_per_pv_purchase_needs_v2(uuid[])
  TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.per_pv_purchase_batch_receipts_124 (
  request_id uuid PRIMARY KEY,
  pv_ids uuid[] NOT NULL CHECK (cardinality(pv_ids) > 0),
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  purchase_order_ids uuid[] NOT NULL CHECK (cardinality(purchase_order_ids) > 0),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.per_pv_purchase_batch_receipts_124 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.per_pv_purchase_batch_receipts_124
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.per_pv_purchase_batch_receipts_124 TO service_role;

COMMENT ON TABLE public.per_pv_purchase_batch_receipts_124 IS
  'Recibo do lote misto products + box_types. Nasce na mesma transação das OCs e impede replay divergente.';

CREATE OR REPLACE FUNCTION public.per_pv_child_request_id_124(
  p_parent uuid,
  p_scope text
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.md5(p_parent::text || ':' || p_scope)::uuid;
$function$;

REVOKE ALL ON FUNCTION public.per_pv_child_request_id_124(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.per_pv_child_request_id_124(uuid, text)
  TO service_role;

-- Conserva a implementação especializada e já serializada da 111 somente
-- para a parcela products. O novo wrapper público mantém o nome/RPC existente.
DO $rename_product_only_per_pv_124$
BEGIN
  IF to_regprocedure(
       'public.create_per_pv_purchase_orders_atomic_products_124(uuid[],jsonb,uuid,boolean)'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.create_per_pv_purchase_orders_atomic(uuid[],jsonb,uuid,boolean)'
       ) IS NULL THEN
      RAISE EXCEPTION 'Fronteira per-PV da migration 111 não encontrada';
    END IF;
    ALTER FUNCTION public.create_per_pv_purchase_orders_atomic(
      uuid[], jsonb, uuid, boolean
    ) RENAME TO create_per_pv_purchase_orders_atomic_products_124;
  END IF;
END;
$rename_product_only_per_pv_124$;

REVOKE ALL ON FUNCTION public.create_per_pv_purchase_orders_atomic_products_124(
  uuid[], jsonb, uuid, boolean
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_per_pv_purchase_orders_atomic(
  p_pv_ids uuid[],
  p_drafts jsonb,
  p_request_id uuid,
  p_allow_existing_open boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_is_service boolean := COALESCE(
    current_setting('request.jwt.claim.role', true), ''
  ) = 'service_role' OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_pv_ids uuid[];
  v_pv_id uuid;
  v_request_hash text;
  v_existing public.per_pv_purchase_batch_receipts_124%ROWTYPE;
  v_draft jsonb;
  v_item jsonb;
  v_product_items jsonb;
  v_box_items jsonb;
  v_product_drafts jsonb := '[]'::jsonb;
  v_box_drafts jsonb := '[]'::jsonb;
  v_product_ids uuid[] := ARRAY[]::uuid[];
  v_box_type_ids uuid[] := ARRAY[]::uuid[];
  v_open_po_ids uuid[] := ARRAY[]::uuid[];
  v_draft_supplier_ids uuid[] := ARRAY[]::uuid[];
  v_need record;
  v_requested_qty numeric;
  v_requested_unit text;
  v_allowed_qty numeric;
  v_net_of_stock boolean;
  v_product_response jsonb;
  v_box_response jsonb;
  v_box_command_items jsonb;
  v_command_payload jsonb;
  v_supplier_id uuid;
  v_supplier_name text;
  v_created_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
BEGIN
  IF NOT v_is_service AND (
    v_actor_id IS NULL
    OR NOT public.is_approved_user()
    OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
  ) THEN
    RAISE EXCEPTION
      'Somente Administração/Gerência pode gerar ordens de compra por pedido'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id é obrigatório para gerar OCs por pedido'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_pv_ids), 0) = 0
     OR array_position(p_pv_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Informe ao menos um PV válido'
      USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_pv_ids) > 100 THEN
    RAISE EXCEPTION 'Uma geração aceita no máximo 100 PVs'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_drafts) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_drafts) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos uma OC com itens'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(scope.pv_id ORDER BY scope.pv_id)
    INTO v_pv_ids
    FROM (SELECT DISTINCT unnest(p_pv_ids) AS pv_id) scope;

  v_request_hash := md5(jsonb_build_object(
    'pv_ids', to_jsonb(v_pv_ids),
    'drafts', p_drafts,
    'allow_existing_open', COALESCE(p_allow_existing_open, false)
  )::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'perpv-mixed-request:' || p_request_id::text,
    0
  ));
  SELECT receipt.*
    INTO v_existing
    FROM public.per_pv_purchase_batch_receipts_124 receipt
   WHERE receipt.request_id = p_request_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash IS DISTINCT FROM v_request_hash
       OR v_existing.pv_ids IS DISTINCT FROM v_pv_ids
       OR (NOT v_is_service AND v_existing.actor_id IS DISTINCT FROM v_actor_id) THEN
      RAISE EXCEPTION 'request_id já foi usado com outro conteúdo'
        USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.purchase_orders purchase_order
         WHERE purchase_order.id = ANY(v_existing.purchase_order_ids))
       <> cardinality(v_existing.purchase_order_ids) THEN
      RAISE EXCEPTION 'Recibo per-PV aponta para OC ausente; geração recusada'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'created_ids', to_jsonb(v_existing.purchase_order_ids),
      'order_count', cardinality(v_existing.purchase_order_ids),
      'replayed', true
    );
  END IF;

  -- Valida XOR e particiona sem reinterpretar UUID por nome/categoria.
  FOR v_draft IN SELECT value FROM jsonb_array_elements(p_drafts)
  LOOP
    IF jsonb_typeof(v_draft) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_draft -> 'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_draft -> 'items') = 0 THEN
      RAISE EXCEPTION 'Cada OC deve ser objeto com items não vazio'
        USING ERRCODE = '22023';
    END IF;

    v_product_items := '[]'::jsonb;
    v_box_items := '[]'::jsonb;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_draft -> 'items')
    LOOP
      IF (NULLIF(btrim(v_item ->> 'material_id'), '') IS NULL)
         = (NULLIF(btrim(v_item ->> 'box_type_id'), '') IS NULL) THEN
        RAISE EXCEPTION 'Item per-PV exige exatamente material_id OU box_type_id'
          USING ERRCODE = '22023';
      END IF;
      IF NULLIF(btrim(v_item ->> 'material_id'), '') IS NOT NULL THEN
        v_product_items := v_product_items || jsonb_build_array(v_item - 'box_type_id');
      ELSE
        IF NULLIF(btrim(v_item ->> 'color'), '') IS NOT NULL
           OR (v_item ? 'grade' AND v_item -> 'grade' IS NOT NULL
               AND v_item -> 'grade' <> 'null'::jsonb) THEN
          RAISE EXCEPTION 'Embalagem canônica não aceita cor/grade'
            USING ERRCODE = '22023';
        END IF;
        v_box_items := v_box_items || jsonb_build_array(v_item - 'material_id');
      END IF;
    END LOOP;

    IF jsonb_array_length(v_product_items) > 0 THEN
      v_product_drafts := v_product_drafts || jsonb_build_array(
        (v_draft - 'items') || jsonb_build_object('items', v_product_items)
      );
    END IF;
    IF jsonb_array_length(v_box_items) > 0 THEN
      v_box_drafts := v_box_drafts || jsonb_build_array(
        (v_draft - 'items') || jsonb_build_object('items', v_box_items)
      );
    END IF;
  END LOOP;

  -- Mesma ordem global da 111/121: época -> PVs -> products -> box_types -> OCs.
  PERFORM public.lock_sale_order_purchase_allocation();
  FOR v_pv_id IN
    SELECT input.pv_id
      FROM unnest(v_pv_ids) AS input(pv_id)
     ORDER BY input.pv_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sale-order-purchase-shortages:' || v_pv_id::text,
      0
    ));
  END LOOP;

  SELECT COALESCE(array_agg(product_id ORDER BY product_id), ARRAY[]::uuid[])
    INTO v_product_ids
    FROM (
      SELECT DISTINCT need.material_id AS product_id
        FROM public.compute_per_pv_purchase_needs_unallocated(v_pv_ids) need
       WHERE need.material_id IS NOT NULL
      UNION
      SELECT DISTINCT NULLIF(btrim(item.value ->> 'material_id'), '')::uuid
        FROM jsonb_array_elements(v_product_drafts) draft(value)
        CROSS JOIN LATERAL jsonb_array_elements(draft.value -> 'items') item(value)
    ) scope
   WHERE product_id IS NOT NULL;
  PERFORM public.lock_sale_order_purchase_products(v_product_ids);

  SELECT COALESCE(array_agg(box_type_id ORDER BY box_type_id), ARRAY[]::uuid[])
    INTO v_box_type_ids
    FROM (
      SELECT DISTINCT need.box_type_id
        FROM public.compute_per_pv_packaging_purchase_needs_124(v_pv_ids) need
       WHERE need.box_type_id IS NOT NULL
      UNION
      SELECT DISTINCT NULLIF(btrim(item.value ->> 'box_type_id'), '')::uuid
        FROM jsonb_array_elements(v_box_drafts) draft(value)
        CROSS JOIN LATERAL jsonb_array_elements(draft.value -> 'items') item(value)
    ) scope
   WHERE box_type_id IS NOT NULL;
  PERFORM public.lock_purchase_order_box_types_121(v_box_type_ids);

  -- Trava OCs abertas de embalagem antes de recalcular warning/falta.
  SELECT COALESCE(array_agg(scope.purchase_order_id ORDER BY scope.purchase_order_id), ARRAY[]::uuid[])
    INTO v_open_po_ids
    FROM (
      SELECT DISTINCT purchase_order.id AS purchase_order_id
        FROM public.purchase_orders purchase_order
        JOIN public.purchase_order_items item
          ON item.purchase_order_id = purchase_order.id
       WHERE item.box_type_id = ANY(v_box_type_ids)
         AND lower(COALESCE(purchase_order.status, '')) NOT IN (
           'cancelled', 'canceled', 'cancelada',
           'received', 'recebida', 'receiving'
         )
         AND GREATEST(
           0,
           COALESCE(item.quantity, 0) - COALESCE(item.received_quantity, 0)
         ) > 0
    ) scope;
  PERFORM purchase_order.id
    FROM public.purchase_orders purchase_order
   WHERE purchase_order.id = ANY(v_open_po_ids)
   ORDER BY purchase_order.id
   FOR UPDATE;
  PERFORM item.id
    FROM public.purchase_order_items item
   WHERE item.purchase_order_id = ANY(v_open_po_ids)
     AND item.box_type_id = ANY(v_box_type_ids)
   ORDER BY item.purchase_order_id, item.box_type_id, item.id
   FOR UPDATE;

  -- Lacuna de modo/slot/box_type é bloqueio real, nunca fallback nem override.
  SELECT need.*
    INTO v_need
    FROM public.compute_per_pv_packaging_purchase_needs_124(v_pv_ids) need
   WHERE need.conversion_warning IS NOT NULL
   ORDER BY need.packaging_type
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Embalagem do PV não configurada: %', v_need.conversion_warning
      USING ERRCODE = '55000';
  END IF;

  -- Um box_type só pode aparecer uma vez no lote. O frontend já agrega por
  -- fornecedor; repetir aqui seria dupla compra com duas OCs plausíveis.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_box_drafts) draft(value)
      CROSS JOIN LATERAL jsonb_array_elements(draft.value -> 'items') item(value)
     GROUP BY NULLIF(btrim(item.value ->> 'box_type_id'), '')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Embalagem repetida em mais de uma linha do lote per-PV'
      USING ERRCODE = '22023';
  END IF;

  FOR v_need IN
    WITH needs AS MATERIALIZED (
      SELECT *
        FROM public.compute_per_pv_packaging_purchase_needs_124(v_pv_ids)
       WHERE box_type_id IS NOT NULL
    )
    SELECT draft.value AS draft,
           item.value AS draft_item,
           need.*
      FROM jsonb_array_elements(v_box_drafts) draft(value)
      CROSS JOIN LATERAL jsonb_array_elements(draft.value -> 'items') item(value)
      LEFT JOIN needs need
        ON need.box_type_id = NULLIF(btrim(item.value ->> 'box_type_id'), '')::uuid
  LOOP
    IF v_need.box_type_id IS NULL OR COALESCE(v_need.shortage, 0) <= 0 THEN
      RAISE EXCEPTION
        'A falta da embalagem % foi resolvida/realocada; recalcule antes de gerar',
        v_need.draft_item ->> 'box_type_id'
        USING ERRCODE = '40001';
    END IF;
    IF v_need.supplier_id IS NULL THEN
      RAISE EXCEPTION
        'Embalagem "%" está sem fornecedor; cadastre antes de gerar a OC',
        v_need.product_name
        USING ERRCODE = '55000';
    END IF;
    IF NULLIF(btrim(v_need.draft ->> 'supplier_id'), '')::uuid
       IS DISTINCT FROM v_need.supplier_id THEN
      RAISE EXCEPTION
        'Fornecedor da embalagem "%" mudou; recalcule antes de gerar',
        v_need.product_name
        USING ERRCODE = '40001';
    END IF;
    IF v_need.open_purchase_warning IS NOT NULL
       AND NOT COALESCE(p_allow_existing_open, false) THEN
      RAISE EXCEPTION '%', v_need.open_purchase_warning
        USING ERRCODE = '55000';
    END IF;

    v_requested_qty := NULLIF(btrim(v_need.draft_item ->> 'quantity'), '')::numeric;
    v_requested_unit := NULLIF(btrim(v_need.draft_item ->> 'unit'), '');
    v_net_of_stock := COALESCE(
      NULLIF(btrim(v_need.draft_item ->> 'net_of_stock'), '')::boolean,
      true
    );
    v_allowed_qty := CASE WHEN v_net_of_stock
      THEN v_need.shortage ELSE v_need.needed_qty END;
    IF public.po_norm_unit(v_requested_unit) IS DISTINCT FROM public.po_norm_unit(v_need.unit) THEN
      RAISE EXCEPTION
        'Unidade % divergiu da embalagem recalculada (% / %)',
        v_requested_unit, v_need.product_name, v_need.unit
        USING ERRCODE = '40001';
    END IF;
    IF v_need.unit = 'un' THEN
      v_allowed_qty := CEIL(v_allowed_qty);
    END IF;
    IF COALESCE(v_requested_qty, 0) <= 0
       OR v_requested_qty > v_allowed_qty + 0.0001 THEN
      RAISE EXCEPTION
        'Quantidade % % excede a falta alocada % % da embalagem %; recalcule',
        v_requested_qty, v_requested_unit,
        v_allowed_qty, v_need.unit, v_need.product_name
        USING ERRCODE = '40001';
    END IF;
    IF COALESCE(NULLIF(btrim(v_need.draft_item ->> 'unit_price'), '')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION
        'Informe preço maior que zero para a embalagem %', v_need.product_name
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Parcela products conserva todos os guards/normalização/grade da 111.
  IF jsonb_array_length(v_product_drafts) > 0 THEN
    v_product_response := public.create_per_pv_purchase_orders_atomic_products_124(
      v_pv_ids,
      v_product_drafts,
      public.per_pv_child_request_id_124(p_request_id, 'products'),
      COALESCE(p_allow_existing_open, false)
    );
    FOR v_id IN
      SELECT value::uuid
        FROM jsonb_array_elements_text(v_product_response -> 'created_ids') value
    LOOP
      v_created_ids := array_append(v_created_ids, v_id);
    END LOOP;
  END IF;

  -- Parcela box_types usa a fronteira 121. Cada fornecedor vira uma OC, mas
  -- qualquer erro ainda reverte também a parcela products (mesma transação).
  FOR v_draft IN SELECT value FROM jsonb_array_elements(v_box_drafts)
  LOOP
    v_supplier_id := NULLIF(btrim(v_draft ->> 'supplier_id'), '')::uuid;
    SELECT supplier.name INTO v_supplier_name
      FROM public.suppliers supplier
     WHERE supplier.id = v_supplier_id;
    IF v_supplier_name IS NULL OR btrim(v_supplier_name) = '' THEN
      RAISE EXCEPTION 'Fornecedor % da embalagem não existe', v_supplier_id
        USING ERRCODE = 'P0002';
    END IF;
    IF v_supplier_id = ANY(v_draft_supplier_ids) THEN
      RAISE EXCEPTION 'Fornecedor de embalagem repetido no lote per-PV'
        USING ERRCODE = '22023';
    END IF;
    v_draft_supplier_ids := array_append(v_draft_supplier_ids, v_supplier_id);

    SELECT jsonb_agg(jsonb_build_object(
             'box_type_id', box.id,
             'quantity', (item.value ->> 'quantity')::numeric,
             'unit_price', (item.value ->> 'unit_price')::numeric,
             'unit', CASE WHEN box.tipo::text = 'fitilho' THEN 'm' ELSE 'un' END,
             'current_stock', COALESCE(box.quantity, 0)
           ) ORDER BY box.id)
      INTO v_box_command_items
      FROM jsonb_array_elements(v_draft -> 'items') item(value)
      JOIN public.box_types box
        ON box.id = NULLIF(btrim(item.value ->> 'box_type_id'), '')::uuid;

    -- Se a parcela products já abriu OC para o mesmo fornecedor, anexa a
    -- embalagem nela. Assim o contrato "uma OC por fornecedor" continua vivo.
    SELECT purchase_order.id
      INTO v_id
      FROM public.purchase_orders purchase_order
     WHERE purchase_order.id = ANY(v_created_ids)
       AND purchase_order.supplier_id = v_supplier_id
       AND purchase_order.source_type = 'per_pv'
     ORDER BY purchase_order.id
     LIMIT 1;
    IF FOUND THEN
      v_command_payload := jsonb_build_object(
        'header_patch', jsonb_build_object(
          'notes_append', ' · embalagem canônica por box_types',
          'linked_sale_order_ids_add', to_jsonb(v_pv_ids),
          'source_pv_ids_add', to_jsonb(v_pv_ids)
        ),
        'items', v_box_command_items
      );
      v_box_response := public.execute_purchase_order_command(
        'append',
        v_command_payload,
        public.per_pv_child_request_id_124(
          p_request_id,
          'box:' || v_supplier_id::text
        ),
        v_id,
        NULL
      );
    ELSE
      v_command_payload := jsonb_build_object(
        'header', jsonb_build_object(
          'supplier_id', v_supplier_id,
          'supplier_name', v_supplier_name,
          'status', 'pending',
          'notes', 'Compra exclusiva dos PVs ' || array_to_string(v_pv_ids, ', ')
            || ' — embalagem canônica por box_types',
          'auto_generated', true,
          'linked_sale_order_ids', to_jsonb(v_pv_ids),
          'source_pv_ids', to_jsonb(v_pv_ids),
          'source_type', 'per_pv',
          'idempotency_key', 'perpv_box:' || p_request_id::text || ':' || v_supplier_id::text
        ),
        'items', v_box_command_items,
        'return_existing_on_idempotency', true
      );
      v_box_response := public.execute_purchase_order_command(
        'create',
        v_command_payload,
        public.per_pv_child_request_id_124(
          p_request_id,
          'box:' || v_supplier_id::text
        ),
        NULL,
        NULL
      );
    END IF;
    v_id := NULLIF(v_box_response ->> 'purchase_order_id', '')::uuid;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Comando de OC de embalagem não devolveu purchase_order_id';
    END IF;
    v_created_ids := array_append(v_created_ids, v_id);
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT created.id ORDER BY created.id), ARRAY[]::uuid[])
    INTO v_created_ids
    FROM unnest(v_created_ids) AS created(id);
  IF cardinality(v_created_ids) = 0 THEN
    RAISE EXCEPTION 'Nenhuma OC válida foi gerada para o lote per-PV'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.per_pv_purchase_batch_receipts_124(
    request_id, pv_ids, request_hash, purchase_order_ids, actor_id
  ) VALUES (
    p_request_id, v_pv_ids, v_request_hash, v_created_ids, v_actor_id
  );

  RETURN jsonb_build_object(
    'created_ids', to_jsonb(v_created_ids),
    'order_count', cardinality(v_created_ids),
    'replayed', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_per_pv_purchase_orders_atomic(
  uuid[], jsonb, uuid, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_per_pv_purchase_orders_atomic(
  uuid[], jsonb, uuid, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_per_pv_purchase_orders_atomic(
  uuid[], jsonb, uuid, boolean
) IS
  'Fronteira per-PV mista e atômica: revalida/serializa products e box_types, delega produtos ao motor 111 e embalagem ao comando 121, com um recibo único.';

CREATE OR REPLACE FUNCTION public.run_per_pv_packaging_purchase_contract_tests_124()
RETURNS TABLE(case_name text, ok boolean, detail text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_compute text;
  v_create text;
BEGIN
  SELECT pg_get_functiondef(
    'public.compute_per_pv_purchase_needs_v2(uuid[])'::regprocedure
  ) INTO v_compute;
  SELECT pg_get_functiondef(
    'public.create_per_pv_purchase_orders_atomic(uuid[],jsonb,uuid,boolean)'::regprocedure
  ) INTO v_create;

  case_name := 'per_pv_demand_has_xor_box_identity';
  ok := position('compute_per_pv_packaging_purchase_needs_124' IN v_compute) > 0
    AND position('NULL::uuid AS material_id' IN v_compute) > 0
    AND position('packaging.box_type_id' IN v_compute) > 0;
  detail := 'o botão recebe box_type_id canônico em linha separada de products';
  RETURN NEXT;

  case_name := 'per_pv_creation_is_one_atomic_transaction';
  ok := position('create_per_pv_purchase_orders_atomic_products_124' IN v_create) > 0
    AND position('execute_purchase_order_command' IN v_create) > 0
    AND position('per_pv_purchase_batch_receipts_124' IN v_create) > 0;
  detail := 'produtos e embalagem usam seus motores especializados sob um recibo único';
  RETURN NEXT;

  case_name := 'per_pv_box_lock_and_revalidation';
  ok := position('lock_purchase_order_box_types_121' IN v_create) > 0
    AND position('compute_per_pv_packaging_purchase_needs_124' IN v_create) > 0
    AND position('Quantidade % % excede a falta alocada' IN v_create) > 0;
  detail := 'box_types são travados e a falta é recalculada antes de qualquer INSERT';
  RETURN NEXT;

  case_name := 'per_pv_packaging_gap_fails_closed';
  ok := position('Embalagem do PV não configurada' IN v_create) > 0
    AND position('conversion_warning IS NOT NULL' IN v_create) > 0;
  detail := 'modo/slot ausente não escolhe caixa por nome nem gera OC parcial';
  RETURN NEXT;

  case_name := 'per_pv_fitilho_unit_is_meter';
  ok := position('box.tipo::text = ''fitilho'' THEN ''m''' IN v_create) > 0;
  detail := 'fitilho mantém estoque, compra e recebimento em metros';
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_per_pv_packaging_purchase_contract_tests_124()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_per_pv_packaging_purchase_contract_tests_124()
  TO service_role;

COMMIT;
