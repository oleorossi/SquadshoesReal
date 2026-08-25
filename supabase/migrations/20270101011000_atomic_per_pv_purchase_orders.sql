-- Canal Compras por Pedido: uma chamada = uma transação.
--
-- Antes desta fronteira o frontend gravava um cabeçalho por fornecedor e depois
-- os itens. Uma falha tardia (preço zero, unidade, tira) deixava as OCs dos
-- fornecedores anteriores vivas. A chave `perpv::PV::fornecedor` também só era
-- protegida pelo trigger geral de 30 segundos.
--
-- A partir daqui:
--   * todo o lote é pré-validado antes do primeiro INSERT;
--   * cabeçalhos + itens são gravados na mesma transação da RPC;
--   * preço precisa ser estritamente positivo;
--   * a grade do solado é obrigatória, íntegra e fecha com quantity;
--   * um client request UUID identifica UMA tentativa para sempre. Repetir o
--     mesmo UUID devolve o resultado anterior; uma compra deliberadamente nova
--     usa outro UUID, mesmo para os mesmos PVs/fornecedores.

BEGIN;

-- Wrapper exclusivo do canal de compra. A demanda continua vindo integralmente
-- do motor canônico; aqui só se acrescentam duas decisões de compra que não
-- pertencem ao consumo: cobertura do solado por numeração e OCs em trânsito.
CREATE OR REPLACE FUNCTION public.compute_per_pv_purchase_needs(p_pv_ids uuid[])
RETURNS TABLE(
  material_id uuid,
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
SECURITY INVOKER
SET search_path = public, extensions
AS $function$
  WITH base AS (
    SELECT need.*
      FROM public.compute_materials_per_pv(p_pv_ids) need
  ), mapped_grade AS (
    SELECT b.material_id,
           b.color,
           CASE
             WHEN g.key ~ '^[0-9]+/[0-9]+$' THEN g.key
             WHEN g.key ~ '^[0-9]+$' THEN COALESCE(
               public.get_sole_size_key(p.group_id, g.key::integer),
               g.key
             )
             ELSE g.key
           END AS size_key,
           sum(g.value::numeric) AS required_qty
      FROM base b
      JOIN public.products p ON p.id = b.material_id
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(b.grade, '{}'::jsonb)) g
     WHERE b.grade IS NOT NULL
       AND left(g.key, 1) <> '_'
       AND g.value::numeric > 0
     GROUP BY b.material_id, b.color, p.group_id,
              CASE
                WHEN g.key ~ '^[0-9]+/[0-9]+$' THEN g.key
                WHEN g.key ~ '^[0-9]+$' THEN COALESCE(
                  public.get_sole_size_key(p.group_id, g.key::integer),
                  g.key
                )
                ELSE g.key
              END
  ), grade_rollup AS (
    SELECT mg.material_id,
           mg.color,
           jsonb_object_agg(mg.size_key, mg.required_qty ORDER BY mg.size_key)
             AS demand_grade,
           COALESCE(
             jsonb_object_agg(
               mg.size_key,
               greatest(0, mg.required_qty - st.available_qty)
               ORDER BY mg.size_key
             ) FILTER (WHERE mg.required_qty > st.available_qty),
             '{}'::jsonb
           ) AS shortage_grade,
           sum(greatest(0, mg.required_qty - st.available_qty)) AS shortage_qty
      FROM mapped_grade mg
      JOIN public.products p ON p.id = mg.material_id
      CROSS JOIN LATERAL (
        SELECT greatest(
          0,
          COALESCE(NULLIF(p.stock_grade ->> mg.size_key, '')::numeric, 0)
        ) AS available_qty
      ) st
     GROUP BY mg.material_id, mg.color
  ), open_purchase AS (
    SELECT poi.product_id,
           string_agg(DISTINCT po.order_number, ', ' ORDER BY po.order_number)
             AS order_numbers
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
     WHERE lower(COALESCE(po.status, '')) NOT IN (
             'cancelled', 'canceled', 'cancelada', 'received', 'recebida', 'receiving'
           )
       AND po.source_type IS DISTINCT FROM 'strap_demand'
       AND greatest(
             0,
             COALESCE(poi.quantity, 0) - COALESCE(poi.received_quantity, 0)
           ) > 0
     GROUP BY poi.product_id
  )
  SELECT b.material_id,
         b.product_name,
         b.unit,
         b.color,
         b.needed_qty,
         CASE WHEN gr.material_id IS NOT NULL
           THEN greatest(0, b.needed_qty - gr.shortage_qty)
           ELSE b.stock_qty
         END AS stock_qty,
         CASE WHEN gr.material_id IS NOT NULL
           THEN gr.shortage_qty
           ELSE b.shortage
         END AS shortage,
         b.supplier_id,
         b.supplier_name,
         b.last_unit_price,
         b.is_artisanal,
         COALESCE(gr.demand_grade, b.grade) AS grade,
         b.color_mismatch,
         b.conversion_warning,
         gr.shortage_grade,
         CASE
           WHEN op.product_id IS NOT NULL
            AND (CASE WHEN gr.material_id IS NOT NULL
                  THEN gr.shortage_qty ELSE b.shortage END) > 0
           THEN format(
             'Já existe compra aberta para "%s" nas OCs %s. Confira antes de comprar novamente.',
             b.product_name,
             op.order_numbers
           )
           ELSE NULL
         END AS open_purchase_warning
    FROM base b
    LEFT JOIN grade_rollup gr
      ON gr.material_id = b.material_id AND gr.color IS NOT DISTINCT FROM b.color
    LEFT JOIN open_purchase op ON op.product_id = b.material_id
   ORDER BY b.supplier_name NULLS LAST, b.product_name;
$function$;

COMMENT ON FUNCTION public.compute_per_pv_purchase_needs(uuid[]) IS
  'Wrapper de compra sobre compute_materials_per_pv: neta solado por stock_grade/numeração e avisa OCs/ROPs abertas, sem duplicar o motor de consumo.';

REVOKE ALL ON FUNCTION public.compute_per_pv_purchase_needs(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_per_pv_purchase_needs(uuid[])
  TO authenticated, service_role;

CREATE TABLE public.per_pv_purchase_order_requests (
  request_id uuid PRIMARY KEY,
  pv_ids uuid[] NOT NULL CHECK (cardinality(pv_ids) > 0),
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  purchase_order_ids uuid[] NOT NULL CHECK (cardinality(purchase_order_ids) > 0),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.per_pv_purchase_order_requests IS
  'Recibo imutável da geração atômica de OCs por PV. request_id identifica a tentativa; request_hash impede reutilizar o UUID com outro payload.';

ALTER TABLE public.per_pv_purchase_order_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.per_pv_purchase_order_requests
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.per_pv_purchase_order_requests TO service_role;

-- Proteção física adicional ao recibo. Diferente da key per_pv antiga, esta
-- chave representa uma tentativa UUID, não a demanda permanente do PV; por isso
-- pode e deve ser UNIQUE inclusive depois de receber/cancelar a OC.
CREATE UNIQUE INDEX ux_purchase_orders_perpv_request_key
  ON public.purchase_orders(idempotency_key)
  WHERE idempotency_key LIKE 'perpv_req:%';

COMMENT ON INDEX public.ux_purchase_orders_perpv_request_key IS
  'Idempotência durável por tentativa do canal per-PV. Nova compra legítima usa novo request_id.';

CREATE OR REPLACE FUNCTION public.create_per_pv_purchase_orders_atomic(
  p_pv_ids uuid[],
  p_drafts jsonb,
  p_request_id uuid,
  p_allow_existing_open boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_pv_ids uuid[];
  v_pv_count integer;
  v_pv_labels text;
  v_request_hash text;
  v_existing_request public.per_pv_purchase_order_requests%ROWTYPE;
  v_draft jsonb;
  v_item jsonb;
  v_grade jsonb;
  v_normalized_drafts jsonb := '[]'::jsonb;
  v_normalized_items jsonb;
  v_draft_index integer;
  v_item_index integer;
  v_supplier_text text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_supplier_key text;
  v_supplier_keys text[] := ARRAY[]::text[];
  v_idempotency_key text;
  v_product_text text;
  v_product_id uuid;
  v_product record;
  v_product_name text;
  v_group_is_strap boolean;
  v_is_strap_product boolean;
  v_unit text;
  v_stock_unit text;
  v_purchase_unit text;
  v_color text;
  v_quantity numeric;
  v_unit_price numeric;
  v_current_stock numeric;
  v_grade_entry record;
  v_grade_value numeric;
  v_grade_total numeric;
  v_item_key text;
  v_item_keys text[] := ARRAY[]::text[];
  v_open_order_number text;
  v_total numeric;
  v_total_item_count integer := 0;
  v_po_id uuid;
  v_created_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- SECURITY DEFINER não amplia o conjunto de compradores: a autorização é a
  -- mesma das policies vivas de purchase_orders/purchase_order_items.
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       auth.uid() IS NULL
       OR NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
     ) THEN
    RAISE EXCEPTION 'Somente Administração/Gerência pode gerar ordens de compra por pedido'
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
  IF jsonb_array_length(p_drafts) > 100 THEN
    RAISE EXCEPTION 'Uma geração aceita no máximo 100 fornecedores'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(x.id ORDER BY x.id)
    INTO v_pv_ids
    FROM (SELECT DISTINCT unnest(p_pv_ids) AS id) x;

  v_request_hash := md5(jsonb_build_object(
    'pv_ids', to_jsonb(v_pv_ids),
    'drafts', p_drafts,
    'allow_existing_open', COALESCE(p_allow_existing_open, false)
  )::text);

  -- Serializa a tentativa entre abas/conexões. O recibo só nasce no final da
  -- transação, portanto nunca representa lote parcial.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('perpv-request:' || p_request_id::text, 0)
  );

  SELECT r.*
    INTO v_existing_request
    FROM public.per_pv_purchase_order_requests r
   WHERE r.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing_request.request_hash <> v_request_hash
       OR v_existing_request.pv_ids <> v_pv_ids THEN
      RAISE EXCEPTION 'request_id já foi usado com outro conteúdo'
        USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.purchase_orders po
         WHERE po.id = ANY(v_existing_request.purchase_order_ids))
       <> cardinality(v_existing_request.purchase_order_ids) THEN
      RAISE EXCEPTION 'Recibo per-PV aponta para OC ausente; geração recusada'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'created_ids', to_jsonb(v_existing_request.purchase_order_ids),
      'order_count', cardinality(v_existing_request.purchase_order_ids),
      'replayed', true
    );
  END IF;

  SELECT count(*)::integer,
         string_agg(so.order_number, ', ' ORDER BY so.order_number)
    INTO v_pv_count, v_pv_labels
    FROM public.sale_orders so
   WHERE so.id = ANY(v_pv_ids);
  IF v_pv_count <> cardinality(v_pv_ids) THEN
    RAISE EXCEPTION 'Um ou mais PVs não existem ou não estão acessíveis'
      USING ERRCODE = '22023';
  END IF;

  -- PRE-FLIGHT COMPLETO. Nenhum INSERT ocorre antes do fim deste bloco.
  FOR v_draft, v_draft_index IN
    SELECT e.value, e.ordinality::integer
      FROM jsonb_array_elements(p_drafts) WITH ORDINALITY e(value, ordinality)
     ORDER BY e.ordinality
  LOOP
    IF jsonb_typeof(v_draft) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'OC % deve ser um objeto', v_draft_index
        USING ERRCODE = '22023';
    END IF;

    v_supplier_text := NULLIF(btrim(v_draft ->> 'supplier_id'), '');
    BEGIN
      v_supplier_id := v_supplier_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Fornecedor inválido na OC %', v_draft_index
        USING ERRCODE = '22023';
    END;
    v_supplier_key := COALESCE(v_supplier_id::text, 'none');
    IF v_supplier_key = ANY(v_supplier_keys) THEN
      RAISE EXCEPTION 'Fornecedor repetido na mesma geração: %', v_supplier_key
        USING ERRCODE = '22023';
    END IF;
    v_supplier_keys := array_append(v_supplier_keys, v_supplier_key);

    IF v_supplier_id IS NULL THEN
      v_supplier_name := 'Sem Fornecedor';
    ELSE
      SELECT s.name
        INTO v_supplier_name
        FROM public.suppliers s
       WHERE s.id = v_supplier_id
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Fornecedor não encontrado na OC %', v_draft_index
          USING ERRCODE = '22023';
      END IF;
    END IF;

    IF jsonb_typeof(v_draft -> 'items') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_draft -> 'items') = 0 THEN
      RAISE EXCEPTION 'OC % não possui itens', v_draft_index
        USING ERRCODE = '22023';
    END IF;

    v_normalized_items := '[]'::jsonb;
    v_total := 0;

    FOR v_item, v_item_index IN
      SELECT e.value, e.ordinality::integer
        FROM jsonb_array_elements(v_draft -> 'items') WITH ORDINALITY e(value, ordinality)
       ORDER BY e.ordinality
    LOOP
      v_total_item_count := v_total_item_count + 1;
      IF v_total_item_count > 1000 THEN
        RAISE EXCEPTION 'Uma geração aceita no máximo 1000 itens'
          USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Item % da OC % deve ser um objeto', v_item_index, v_draft_index
          USING ERRCODE = '22023';
      END IF;

      v_product_text := NULLIF(btrim(v_item ->> 'material_id'), '');
      BEGIN
        v_product_id := v_product_text::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Produto inválido no item % da OC %', v_item_index, v_draft_index
          USING ERRCODE = '22023';
      END;
      IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'Produto obrigatório no item % da OC %', v_item_index, v_draft_index
          USING ERRCODE = '22023';
      END IF;

      SELECT p.id, p.name, p.category, p.supplier_id, p.unit,
             p.purchase_unit, p.purchase_order_unit, p.is_artisanal, p.group_id
        INTO v_product
        FROM public.products p
       WHERE p.id = v_product_id
       FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto não encontrado no item % da OC %', v_item_index, v_draft_index
          USING ERRCODE = '22023';
      END IF;
      v_product_name := COALESCE(NULLIF(btrim(v_product.name), ''), v_product_id::text);

      IF v_product.supplier_id IS DISTINCT FROM v_supplier_id THEN
        RAISE EXCEPTION 'Fornecedor de "%" mudou; recalcule as OCs antes de gerar', v_product_name
          USING ERRCODE = '40001';
      END IF;

      v_group_is_strap := false;
      IF v_product.group_id IS NOT NULL THEN
        SELECT COALESCE(pg.is_artisanal_strap, false)
          INTO v_group_is_strap
          FROM public.product_groups pg
         WHERE pg.id = v_product.group_id;
        v_group_is_strap := COALESCE(v_group_is_strap, false);
      END IF;
      SELECT EXISTS (
        SELECT 1 FROM public.artisanal_strap_variants sv
         WHERE sv.finished_product_id = v_product_id
      ) INTO v_is_strap_product;
      IF COALESCE(v_product.is_artisanal, false)
         OR v_group_is_strap
         OR v_is_strap_product THEN
        RAISE EXCEPTION '"%" pertence ao motor de tiras e não pode entrar em OC genérica', v_product_name
          USING ERRCODE = '22023';
      END IF;

      IF NOT COALESCE(p_allow_existing_open, false) THEN
        SELECT po.order_number
          INTO v_open_order_number
          FROM public.purchase_order_items poi
          JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
         WHERE poi.product_id = v_product_id
           AND lower(COALESCE(po.status, '')) NOT IN (
             'cancelled', 'canceled', 'cancelada', 'received', 'recebida', 'receiving'
           )
           AND po.source_type IS DISTINCT FROM 'strap_demand'
           AND greatest(
                 0,
                 COALESCE(poi.quantity, 0) - COALESCE(poi.received_quantity, 0)
               ) > 0
         ORDER BY po.created_at DESC, po.id
         LIMIT 1;
        IF FOUND THEN
          RAISE EXCEPTION 'Já existe compra aberta para "%" na OC %. Confira-a ou confirme explicitamente a compra adicional.',
            v_product_name, v_open_order_number
            USING ERRCODE = '55000';
        END IF;
      END IF;

      IF jsonb_typeof(v_item -> 'quantity') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Quantidade inválida em "%"', v_product_name
          USING ERRCODE = '22023';
      END IF;
      v_quantity := (v_item ->> 'quantity')::numeric;
      IF v_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantidade deve ser positiva em "%"', v_product_name
          USING ERRCODE = '22023';
      END IF;

      IF jsonb_typeof(v_item -> 'unit_price') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Preço inválido em "%"', v_product_name
          USING ERRCODE = '22023';
      END IF;
      v_unit_price := (v_item ->> 'unit_price')::numeric;
      IF v_unit_price <= 0 THEN
        RAISE EXCEPTION 'Preço deve ser maior que zero em "%"', v_product_name
          USING ERRCODE = '22023';
      END IF;

      v_unit := NULLIF(btrim(v_item ->> 'unit'), '');
      IF v_unit IS NULL THEN
        RAISE EXCEPTION 'Unidade obrigatória em "%"', v_product_name
          USING ERRCODE = '22023';
      END IF;
      v_stock_unit := COALESCE(NULLIF(btrim(v_product.unit), ''), 'un');
      v_purchase_unit := COALESCE(
        NULLIF(btrim(v_product.purchase_unit), ''),
        NULLIF(btrim(v_product.purchase_order_unit), ''),
        v_stock_unit
      );
      IF public.po_norm_unit(v_unit) NOT IN (
        public.po_norm_unit(v_stock_unit), public.po_norm_unit(v_purchase_unit)
      ) THEN
        RAISE EXCEPTION 'Unidade "%" inválida em "%"; use % ou %',
          v_unit, v_product_name, v_stock_unit, v_purchase_unit
          USING ERRCODE = '22023';
      END IF;

      IF NOT (v_item ? 'current_stock') OR v_item -> 'current_stock' = 'null'::jsonb THEN
        v_current_stock := 0;
      ELSE
        IF jsonb_typeof(v_item -> 'current_stock') IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'Estoque atual inválido em "%"', v_product_name
            USING ERRCODE = '22023';
        END IF;
        v_current_stock := (v_item ->> 'current_stock')::numeric;
        IF v_current_stock < 0 THEN
          RAISE EXCEPTION 'Estoque atual não pode ser negativo em "%"', v_product_name
            USING ERRCODE = '22023';
        END IF;
      END IF;

      v_color := NULLIF(btrim(v_item ->> 'color'), '');
      v_item_key := v_product_id::text || ':' || lower(COALESCE(v_color, ''));
      IF v_item_key = ANY(v_item_keys) THEN
        RAISE EXCEPTION 'Produto/cor repetido no lote: "%" / %',
          v_product_name, COALESCE(v_color, 'sem cor')
          USING ERRCODE = '22023';
      END IF;
      v_item_keys := array_append(v_item_keys, v_item_key);

      IF NOT (v_item ? 'grade') OR v_item -> 'grade' = 'null'::jsonb THEN
        v_grade := NULL;
      ELSE
        v_grade := v_item -> 'grade';
        IF jsonb_typeof(v_grade) IS DISTINCT FROM 'object' THEN
          RAISE EXCEPTION 'Grade inválida em "%"', v_product_name
            USING ERRCODE = '22023';
        END IF;
      END IF;

      v_grade_total := 0;
      IF v_grade IS NOT NULL THEN
        FOR v_grade_entry IN SELECT e.key, e.value FROM jsonb_each(v_grade) e
        LOOP
          CONTINUE WHEN left(v_grade_entry.key, 1) = '_';
          IF jsonb_typeof(v_grade_entry.value) IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Grade de "%" contém quantidade não numérica em %',
              v_product_name, v_grade_entry.key
              USING ERRCODE = '22023';
          END IF;
          v_grade_value := (v_grade_entry.value #>> '{}')::numeric;
          IF v_grade_value < 0 OR trunc(v_grade_value) <> v_grade_value THEN
            RAISE EXCEPTION 'Grade de "%" contém quantidade inválida em %',
              v_product_name, v_grade_entry.key
              USING ERRCODE = '22023';
          END IF;
          v_grade_total := v_grade_total + v_grade_value;
        END LOOP;
        IF v_grade_total <= 0 OR abs(v_grade_total - v_quantity) > 0.0001 THEN
          RAISE EXCEPTION 'Grade de "%" soma %, mas a quantidade da OC é %',
            v_product_name, v_grade_total, v_quantity
            USING ERRCODE = '22023';
        END IF;
      END IF;
      IF lower(COALESCE(v_product.category, '')) = 'solado'
         AND v_grade IS NULL THEN
        RAISE EXCEPTION 'Solado "%" precisa de grade por numeração', v_product_name
          USING ERRCODE = '22023';
      END IF;

      v_total := v_total + (v_quantity * v_unit_price);
      IF v_total > 1000000000000 THEN
        RAISE EXCEPTION 'Total da OC % fora do limite', v_draft_index
          USING ERRCODE = '22023';
      END IF;

      v_normalized_items := v_normalized_items || jsonb_build_array(jsonb_build_object(
        'material_id', v_product_id,
        'quantity', v_quantity,
        'unit_price', v_unit_price,
        'unit', v_unit,
        'current_stock', v_current_stock,
        'color', v_color,
        'grade', v_grade
      ));
    END LOOP;

    v_idempotency_key := concat(
      'perpv_req:', p_request_id::text, ':', v_supplier_key
    );
    v_normalized_drafts := v_normalized_drafts || jsonb_build_array(jsonb_build_object(
      'supplier_id', v_supplier_id,
      'supplier_name', v_supplier_name,
      'idempotency_key', v_idempotency_key,
      'total', v_total,
      'items', v_normalized_items
    ));
  END LOOP;

  -- PRIMEIRA escrita do comando: todos os fornecedores/itens já passaram pelo
  -- pre-flight acima. Qualquer erro daqui em diante aborta a transação inteira.
  FOR v_draft IN
    SELECT e.value FROM jsonb_array_elements(v_normalized_drafts) e(value)
  LOOP
    INSERT INTO public.purchase_orders(
      supplier_id,
      supplier_name,
      notes,
      total_value,
      auto_generated,
      status,
      source_type,
      source_pv_ids,
      idempotency_key
    ) VALUES (
      NULLIF(v_draft ->> 'supplier_id', '')::uuid,
      v_draft ->> 'supplier_name',
      'Gerado a partir de ' || v_pv_labels || ' (Compras por Pedido)',
      (v_draft ->> 'total')::numeric,
      false,
      'pending',
      'per_pv',
      v_pv_ids,
      v_draft ->> 'idempotency_key'
    )
    RETURNING id INTO v_po_id;

    FOR v_item IN
      SELECT e.value FROM jsonb_array_elements(v_draft -> 'items') e(value)
    LOOP
      INSERT INTO public.purchase_order_items(
        purchase_order_id,
        product_id,
        quantity,
        suggested_quantity,
        unit_price,
        unit,
        current_stock,
        min_stock,
        max_stock,
        color,
        grade
      ) VALUES (
        v_po_id,
        (v_item ->> 'material_id')::uuid,
        (v_item ->> 'quantity')::numeric,
        (v_item ->> 'quantity')::numeric,
        (v_item ->> 'unit_price')::numeric,
        v_item ->> 'unit',
        (v_item ->> 'current_stock')::numeric,
        0,
        0,
        NULLIF(v_item ->> 'color', ''),
        CASE WHEN v_item -> 'grade' = 'null'::jsonb
          THEN NULL ELSE v_item -> 'grade' END
      );
    END LOOP;

    v_created_ids := array_append(v_created_ids, v_po_id);
  END LOOP;

  INSERT INTO public.per_pv_purchase_order_requests(
    request_id,
    pv_ids,
    request_hash,
    purchase_order_ids,
    actor_id
  ) VALUES (
    p_request_id,
    v_pv_ids,
    v_request_hash,
    v_created_ids,
    auth.uid()
  );

  RETURN jsonb_build_object(
    'created_ids', to_jsonb(v_created_ids),
    'order_count', cardinality(v_created_ids),
    'replayed', false
  );
END;
$function$;

COMMENT ON FUNCTION public.create_per_pv_purchase_orders_atomic(uuid[], jsonb, uuid, boolean) IS
  'Gera atomicamente uma OC per_pv por fornecedor. Pré-valida todos os itens, exige preço > 0, persiste grade e usa request_id durável/idempotente.';

REVOKE ALL ON FUNCTION public.create_per_pv_purchase_orders_atomic(uuid[], jsonb, uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_per_pv_purchase_orders_atomic(uuid[], jsonb, uuid, boolean)
  TO authenticated, service_role;

DO $contract$
DECLARE
  v_definition text;
  v_rls boolean;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_per_pv_purchase_orders_atomic(uuid[],jsonb,uuid,boolean)'::regprocedure
  ) INTO v_definition;

  IF position('v_unit_price <= 0' IN v_definition) = 0
     OR position('PRE-FLIGHT COMPLETO' IN v_definition) = 0
     OR position('grade' IN v_definition) = 0
     OR position('per_pv_purchase_order_requests' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Contrato da RPC atômica per-PV incompleto';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.create_per_pv_purchase_orders_atomic(uuid[],jsonb,uuid,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'anon ainda executa a RPC atômica per-PV';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.create_per_pv_purchase_orders_atomic(uuid[],jsonb,uuid,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'authenticated não executa a RPC atômica per-PV';
  END IF;
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c
   WHERE c.oid = 'public.per_pv_purchase_order_requests'::regclass;
  IF NOT COALESCE(v_rls, false) THEN
    RAISE EXCEPTION 'Tabela de recibos per-PV está sem RLS';
  END IF;
  IF to_regclass('public.ux_purchase_orders_perpv_request_key') IS NULL THEN
    RAISE EXCEPTION 'Índice idempotente durável per-PV ausente';
  END IF;
END;
$contract$;

COMMIT;
