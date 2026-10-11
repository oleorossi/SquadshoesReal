-- Integração Estoque ↔ PV ↔ Compras — ETAPA 2 + backend dos avisos/telas
-- Spec: specs/integracao-estoque-pv-compras.md
--
-- 1. Compra automática pela NECESSIDADE TOTAL do PV quando há falta (Q1/Q16),
--    arredondada pelo múltiplo de compra (Q14).
-- 2. Uma OC por PV; PVs de clientes do MESMO GRUPO ECONÔMICO dividem a OC do
--    mesmo fornecedor (Q10). Nasce aguardando aprovação (Q10c) — inalterado.
-- 3. PV cancelado / sem falta: a linha dele sai da OC ainda não aprovada; OC
--    aprovada vira alerta (Q13) — a OC compartilhada só é cancelada quando
--    nenhum PV contribui mais.
-- 4. Aprovação com falta de material de corte AVISA, não bloqueia (Q12).
--    Cadastro incompleto continua bloqueando.
-- 5. RPCs para as telas: falta por PV, resumo Falta/Em compra por produto,
--    rateio da entrada (ver, editar) e rastreio do grupo de estoque.

-- ---------------------------------------------------------------------------
-- 1. Uma OC pode receber contribuição de vários PVs (grupo econômico)
-- ---------------------------------------------------------------------------
ALTER TABLE public.sale_order_purchase_shortage_effects
  DROP CONSTRAINT IF EXISTS sale_order_purchase_shortage_effects_purchase_order_id_key;
CREATE INDEX IF NOT EXISTS idx_sale_order_purchase_shortage_effects_po
  ON public.sale_order_purchase_shortage_effects (purchase_order_id);

-- Escopo da OC automática: o próprio PV, ou o grupo econômico do cliente.
CREATE OR REPLACE FUNCTION public.sale_order_purchase_scope_key(p_sale_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT 'eg:' || c.economic_group_id::text
       FROM public.sale_orders so
       JOIN public.clients c ON c.id = so.client_id
      WHERE so.id = p_sale_order_id
        AND c.economic_group_id IS NOT NULL),
    p_sale_order_id::text
  );
$$;

-- Digest que o sistema aplicou por último na OC (qualquer PV contribuinte).
CREATE OR REPLACE FUNCTION public.pv_purchase_order_last_applied_digest(p_purchase_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.applied_digest
    FROM public.sale_order_purchase_shortage_effects e
   WHERE e.purchase_order_id = p_purchase_order_id
     AND e.applied_digest IS NOT NULL
   ORDER BY e.last_applied_at DESC NULLS LAST, e.updated_at DESC
   LIMIT 1;
$$;

-- Cancela a OC automática que ficou sem nenhum PV contribuinte.
CREATE OR REPLACE FUNCTION public.close_pv_purchase_order_without_contributors(p_purchase_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.purchase_orders
     SET status = 'cancelled',
         cancelled_at = now(),
         idempotency_key = COALESCE(idempotency_key, 'auto_pv:outbox') || ':closed:' ||
           to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'),
         notes = concat_ws(E'\n', NULLIF(notes, ''),
           '[SISTEMA] Sugestão automática sem PV contribuinte (falta resolvida/PV cancelado)'),
         updated_at = now()
   WHERE id = p_purchase_order_id;
END;
$$;

-- Troca os itens da OC pela soma das contribuições ativas dos PVs.
CREATE OR REPLACE FUNCTION public.replace_pv_purchase_order_items_from_effects(p_purchase_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id;

  WITH items AS (
    SELECT (i ->> 'product_id')::uuid AS product_id,
           NULLIF(i ->> 'color', '') AS color,
           COALESCE((i ->> 'quantity')::numeric, 0) AS quantity,
           COALESCE((i ->> 'unit_price')::numeric, 0) AS unit_price,
           COALESCE(NULLIF(i ->> 'unit', ''), 'un') AS unit,
           COALESCE((i ->> 'current_stock')::numeric, 0) AS current_stock,
           COALESCE((i ->> 'min_stock')::numeric, 0) AS min_stock,
           COALESCE((i ->> 'max_stock')::numeric, 0) AS max_stock,
           NULLIF(i -> 'grade', 'null'::jsonb) AS grade
      FROM public.sale_order_purchase_shortage_effects e,
           LATERAL jsonb_array_elements(COALESCE(e.desired_payload -> 'items', '[]'::jsonb)) i
     WHERE e.purchase_order_id = p_purchase_order_id
       AND e.effect_status = 'editable'
  ), grade_sum AS (
    SELECT it.product_id, it.color, g.key, sum((g.value #>> '{}')::numeric) AS qty
      FROM items it,
           LATERAL jsonb_each(CASE WHEN jsonb_typeof(it.grade) = 'object' THEN it.grade ELSE '{}'::jsonb END) g
     WHERE jsonb_typeof(g.value) = 'number'
     GROUP BY it.product_id, it.color, g.key
  ), grades AS (
    SELECT product_id, color, jsonb_object_agg(key, qty ORDER BY key) AS grade
      FROM grade_sum GROUP BY product_id, color
  )
  INSERT INTO public.purchase_order_items(
    purchase_order_id, product_id, quantity, suggested_quantity,
    unit_price, unit, current_stock, min_stock, max_stock, grade, color
  )
  SELECT p_purchase_order_id, it.product_id, sum(it.quantity), sum(it.quantity),
         max(it.unit_price), max(it.unit), max(it.current_stock),
         max(it.min_stock), max(it.max_stock), gr.grade, it.color
    FROM items it
    LEFT JOIN grades gr
      ON gr.product_id = it.product_id AND gr.color IS NOT DISTINCT FROM it.color
   GROUP BY it.product_id, it.color, gr.grade;
END;
$$;

-- Remonta os itens da OC somando a contribuição de TODOS os PVs ativos nela.
-- Sem contribuição ativa → cancela a OC (só chamada quando ela é editável).
CREATE OR REPLACE FUNCTION public.rebuild_pv_purchase_order_from_effects(p_purchase_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_pvs uuid[];
  v_digest text;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT e.sale_order_id), ARRAY[]::uuid[])
    INTO v_pvs
    FROM public.sale_order_purchase_shortage_effects e
   WHERE e.purchase_order_id = p_purchase_order_id
     AND e.effect_status = 'editable';

  IF cardinality(v_pvs) = 0 THEN
    PERFORM public.close_pv_purchase_order_without_contributors(p_purchase_order_id);
    RETURN NULL;
  END IF;

  PERFORM public.replace_pv_purchase_order_items_from_effects(p_purchase_order_id);

  SELECT COALESCE(sum(quantity * unit_price), 0) INTO v_total
    FROM public.purchase_order_items WHERE purchase_order_id = p_purchase_order_id;

  UPDATE public.purchase_orders
     SET total_value = v_total,
         source_pv_ids = v_pvs,
         linked_sale_order_ids = v_pvs,
         approval_status = 'pendente_aprovacao',
         approved_by = NULL,
         approved_at = NULL,
         rejection_reason = '',
         approval_preflight_token = NULL,
         approval_preflight_by = NULL,
         approval_preflight_actor_name = NULL,
         approval_preflight_at = NULL,
         approval_preflight_revision = NULL,
         approval_preflight_digest = NULL,
         commercial_revision = COALESCE(commercial_revision, 0) + 1,
         commercial_digest = NULL,
         notes = CASE WHEN cardinality(v_pvs) > 1
                      THEN 'Sugestão versionada pela outbox — grupo econômico (' ||
                           cardinality(v_pvs) || ' PVs)'
                      ELSE notes END,
         updated_at = now()
   WHERE id = p_purchase_order_id;

  v_digest := public.sale_order_outbox_purchase_order_digest(p_purchase_order_id);

  UPDATE public.sale_order_purchase_shortage_effects
     SET applied_digest = v_digest,
         last_applied_at = now(),
         updated_at = now()
   WHERE purchase_order_id = p_purchase_order_id
     AND effect_status = 'editable';

  RETURN v_digest;
END;
$$;

-- OC que o sistema ainda pode editar (não aprovada, nada recebido, sem mão humana)
CREATE OR REPLACE FUNCTION public.pv_purchase_order_is_system_editable(
  p_purchase_order_id uuid,
  p_is_new boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.purchase_orders po
     WHERE po.id = p_purchase_order_id
       AND po.auto_generated
       AND po.source_type = 'per_pv'
       AND po.idempotency_key LIKE 'auto\_pv:outbox:%'
       AND po.status IN ('suggested', 'draft')
       AND COALESCE(po.approval_status, 'pendente_aprovacao') = 'pendente_aprovacao'
       AND po.snapshot_locked_at IS NULL
       AND po.approved_by IS NULL
       AND po.approved_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_order_approvals a
          WHERE a.purchase_order_id = po.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_order_items poi
          WHERE poi.purchase_order_id = po.id
            AND COALESCE(poi.received_quantity, 0) > 0
       )
       AND (
         p_is_new
         OR public.sale_order_outbox_purchase_order_digest(po.id)
              = public.pv_purchase_order_last_applied_digest(po.id)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Worker de compra do PV (corpo vivo de 20270101035100 + regras novas)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_sale_order_purchase_shortages(p_sale_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_order_version bigint;
  v_desired_groups jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_group record;
  v_group_data jsonb;
  v_effect public.sale_order_purchase_shortage_effects%ROWTYPE;
  v_po public.purchase_orders%ROWTYPE;
  v_supplier_key text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_idem text;
  v_scope text;
  v_shared boolean;
  v_desired_digest text;
  v_current_digest text;
  v_po_id uuid;
  v_conflict_po_id uuid;
  v_is_new boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_reused integer := 0;
  v_cancelled integer := 0;
  v_attention integer := 0;
  v_purchase_product_ids uuid[];
  v_compute_version bigint;
BEGIN
  IF NOT public.is_service_role_request_128() THEN
    RAISE EXCEPTION 'process_sale_order_purchase_shortages exige service_role'
      USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id obrigatório' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('statement_timeout', '90s', true);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sale-order-purchase-shortages:' || p_sale_order_id::text,
    0
  ));

  SELECT so.status, so.order_version
    INTO v_status, v_order_version
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  v_compute_version := v_order_version;

  -- Alinha empenho/falta do PV antes de calcular a compra
  -- (spec integracao-estoque-pv-compras, defeito 2).
  IF v_status IN ('Aprovado', 'Em Produção') THEN
    BEGIN
      PERFORM public.recompute_sale_order_material_commitments(p_sale_order_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'recompute commitments falhou para %: %', p_sale_order_id, SQLERRM;
    END;
  END IF;

  -- OC do PV ou do grupo econômico do cliente (Q10)
  v_scope := public.sale_order_purchase_scope_key(p_sale_order_id);
  v_shared := v_scope LIKE 'eg:%';

  SELECT COALESCE(array_agg(x.product_id ORDER BY x.product_id), ARRAY[]::uuid[])
    INTO v_purchase_product_ids
    FROM (
      SELECT DISTINCT need.material_id AS product_id
        FROM public.compute_per_pv_purchase_needs_unallocated(
          ARRAY[p_sale_order_id]
        ) need
       WHERE need.material_id IS NOT NULL
      UNION
      SELECT DISTINCT poi.product_id
        FROM public.sale_order_purchase_shortage_effects e
        JOIN public.purchase_order_items poi
          ON poi.purchase_order_id = e.purchase_order_id
       WHERE e.sale_order_id = p_sale_order_id
         AND poi.product_id IS NOT NULL
    ) x;

  IF v_status IN ('Aprovado', 'Em Produção') THEN
    WITH material_rows AS (
      SELECT need.*, p.min_stock, p.max_stock, p.active,
             p.category AS product_category,
             COALESCE(NULLIF(btrim(need.unit), ''), p.unit, 'un') AS input_unit,
             COALESCE(NULLIF(p.purchase_multiple, 0), NULLIF(pg.purchase_multiple, 0)) AS purchase_multiple,
             -- Q1: havendo falta, compra a NECESSIDADE TOTAL do PV (falta +
             -- reposição do que o PV empenhou). Material com grade: soma da grade.
             COALESCE(
               (SELECT sum((g.value #>> '{}')::numeric)
                  FROM jsonb_each(CASE WHEN jsonb_typeof(need.grade) = 'object'
                                       THEN need.grade ELSE '{}'::jsonb END) g
                 WHERE left(g.key, 1) <> '_'
                   AND jsonb_typeof(g.value) = 'number'
                HAVING sum((g.value #>> '{}')::numeric) > 0),
               need.needed_qty
             ) AS buy_qty
        FROM public.compute_per_pv_purchase_needs(ARRAY[p_sale_order_id]) need
        LEFT JOIN public.products p ON p.id = need.material_id
        LEFT JOIN public.product_groups pg ON pg.id = p.group_id
       WHERE COALESCE(need.shortage, 0) > 0
         AND (
           NOT EXISTS (
             SELECT 1 FROM public.cabedal_prep_demands d
              WHERE d.sale_order_id = p_sale_order_id
                AND d.status <> 'cancelled'
           )
           OR need.material_id NOT IN (
             SELECT c.product_id
               FROM public.cabedal_prep_material_product_ids(p_sale_order_id) c
           )
         )
         AND need.material_id NOT IN (
           SELECT f.product_id
             FROM public.dublagem_finished_product_ids(p_sale_order_id) f
         )
    ), valid_rows AS (
      SELECT m.*,
             -- Q14: arredonda PARA CIMA pelo múltiplo de compra
             CASE WHEN COALESCE(m.purchase_multiple, 0) > 0
                  THEN CEIL(n.out_qty / m.purchase_multiple) * m.purchase_multiple
                  ELSE n.out_qty END AS out_qty,
             n.out_unit,
             n.out_unit_price
        FROM material_rows m
        CROSS JOIN LATERAL public.po_normalize_line(
          m.material_id,
          m.buy_qty,
          m.input_unit,
          COALESCE(m.last_unit_price, 0)
        ) n
       WHERE m.active
         AND NOT COALESCE(m.is_artisanal, false)
         AND NOT COALESCE(m.color_mismatch, false)
         AND COALESCE(m.last_unit_price, 0) > 0
         AND NULLIF(btrim(COALESCE(m.conversion_warning, '')), '') IS NULL
    ), grouped AS (
      SELECT CASE
               WHEN v.supplier_id IS NULL THEN 'none'
               ELSE 'supplier:' || v.supplier_id::text
             END AS supplier_key,
             v.supplier_id,
             COALESCE(NULLIF(btrim(max(v.supplier_name)), ''), 'A definir')
               AS supplier_name,
             jsonb_agg(
               jsonb_build_object(
                 'product_id', v.material_id,
                 'product_name', v.product_name,
                 'quantity', v.out_qty,
                 'unit_price', v.out_unit_price,
                 'unit', v.out_unit,
                 'current_stock', COALESCE(v.stock_qty, 0),
                 'min_stock', COALESCE(v.min_stock, 0),
                 'max_stock', COALESCE(v.max_stock, 0),
                 'grade', public.sale_order_outbox_safe_shortage_grade(
                   v.product_category,
                   v.grade,
                   v.grade,
                   v.buy_qty,
                   v.out_qty
                 ),
                 'color', NULLIF(v.color, '')
               )
               ORDER BY v.product_name, v.material_id, COALESCE(v.color, '')
             ) AS items
        FROM valid_rows v
       WHERE v.out_qty > 0
       GROUP BY v.supplier_id
    )
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'supplier_key', g.supplier_key,
               'supplier_id', g.supplier_id,
               'supplier_name', g.supplier_name,
               'items', g.items
             ) ORDER BY g.supplier_key
           ), '[]'::jsonb)
      INTO v_desired_groups
      FROM grouped g;

    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'product_id', need.material_id,
               'product_name', need.product_name,
               'color', need.color,
               'shortage', need.shortage,
               'reason', CASE
                 WHEN p.id IS NULL OR NOT COALESCE(p.active, false)
                   THEN 'produto_inativo_ou_ausente'
                 WHEN COALESCE(need.is_artisanal, false)
                   THEN 'material_artesanal'
                 WHEN COALESCE(need.color_mismatch, false)
                   THEN 'cor_sem_produto_exato'
                 WHEN COALESCE(need.last_unit_price, 0) <= 0
                   THEN 'preco_de_compra_ausente'
                 ELSE need.conversion_warning
               END
             ) ORDER BY need.product_name, need.material_id
           ), '[]'::jsonb)
      INTO v_blocked
      FROM public.compute_per_pv_purchase_needs(ARRAY[p_sale_order_id]) need
      LEFT JOIN public.products p ON p.id = need.material_id
     WHERE COALESCE(need.shortage, 0) > 0
       AND (
         p.id IS NULL
         OR NOT COALESCE(p.active, false)
         OR COALESCE(need.is_artisanal, false)
         OR COALESCE(need.color_mismatch, false)
         OR COALESCE(need.last_unit_price, 0) <= 0
         OR NULLIF(btrim(COALESCE(need.conversion_warning, '')), '') IS NOT NULL
       );
  END IF;

  PERFORM public.lock_sale_order_purchase_allocation();
  SELECT so.status, so.order_version
    INTO v_status, v_order_version
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_order_version IS DISTINCT FROM v_compute_version THEN
    RAISE EXCEPTION 'Os produtos demandados mudaram durante a compra; repita'
      USING ERRCODE = '40001';
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    v_desired_groups := '[]'::jsonb;
    v_blocked := '[]'::jsonb;
  END IF;
  PERFORM public.lock_sale_order_purchase_products(v_purchase_product_ids);

  IF jsonb_array_length(v_blocked) > 0 THEN
    PERFORM public.emit_sale_order_purchase_attention(
      p_sale_order_id,
      v_order_version,
      'materiais_bloqueados_para_compra_automatica',
      jsonb_build_object('blocked', v_blocked)
    );
    v_attention := v_attention + 1;
  END IF;

  FOR v_group IN
    SELECT value AS data
      FROM jsonb_array_elements(v_desired_groups)
  LOOP
    v_group_data := v_group.data;
    v_supplier_key := v_group_data ->> 'supplier_key';
    v_supplier_id := NULLIF(v_group_data ->> 'supplier_id', '')::uuid;
    v_supplier_name := COALESCE(
      NULLIF(btrim(v_group_data ->> 'supplier_name'), ''),
      'A definir'
    );
    v_idem := 'auto_pv:outbox:' || v_supplier_key || ':' || v_scope;
    v_desired_digest := md5(v_group_data::text);
    v_po_id := NULL;
    v_conflict_po_id := NULL;
    v_is_new := false;
    v_effect := NULL;

    -- Vários PVs do grupo podem escrever na mesma OC: serializa por OC.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_idem, 0));

    SELECT e.*
      INTO v_effect
      FROM public.sale_order_purchase_shortage_effects e
     WHERE e.sale_order_id = p_sale_order_id
       AND e.supplier_key = v_supplier_key
     FOR UPDATE;
    IF v_effect.id IS NOT NULL THEN
      v_po_id := v_effect.purchase_order_id;
    END IF;

    -- OC fechada (cancelada/recebida) não recebe contribuição nova.
    IF v_po_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.purchase_orders closed_po
       WHERE closed_po.id = v_po_id
         AND closed_po.status IN ('cancelled', 'received', 'receiving')
    ) AND v_effect.effect_status IN ('no_shortage', 'superseded') THEN
      v_po_id := NULL;
    END IF;

    -- OC manual/legada já vinculada ao PV + fornecedor é decisão humana.
    SELECT po.id
      INTO v_conflict_po_id
      FROM public.purchase_orders po
     WHERE po.id IS DISTINCT FROM v_po_id
       AND po.idempotency_key IS DISTINCT FROM v_idem
       AND po.status NOT IN ('cancelled', 'received', 'receiving')
       AND po.supplier_id IS NOT DISTINCT FROM v_supplier_id
       AND (
         COALESCE(po.source_pv_ids, ARRAY[]::uuid[]) @> ARRAY[p_sale_order_id]
         OR COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[])
              @> ARRAY[p_sale_order_id]
       )
     ORDER BY po.created_at, po.id
     LIMIT 1
     FOR UPDATE;

    IF v_conflict_po_id IS NOT NULL THEN
      INSERT INTO public.sale_order_purchase_shortage_effects(
        sale_order_id, supplier_key, supplier_id, purchase_order_id,
        source_order_version, desired_digest, applied_digest,
        desired_payload, effect_status, attention_reason, updated_at
      ) VALUES (
        p_sale_order_id, v_supplier_key, v_supplier_id, v_po_id,
        v_order_version, v_desired_digest, v_effect.applied_digest,
        v_group_data, 'attention_required',
        'existing_linked_purchase_order', now()
      )
      ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        source_order_version = EXCLUDED.source_order_version,
        desired_digest = EXCLUDED.desired_digest,
        desired_payload = EXCLUDED.desired_payload,
        effect_status = EXCLUDED.effect_status,
        attention_reason = EXCLUDED.attention_reason,
        updated_at = now();
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_ja_vinculada_ao_pv_exige_reconciliacao',
        jsonb_build_object(
          'supplier_key', v_supplier_key,
          'conflicting_purchase_order_id', v_conflict_po_id,
          'managed_purchase_order_id', v_po_id,
          'desired_digest', v_desired_digest
        )
      );
      v_attention := v_attention + 1;
      CONTINUE;
    END IF;

    IF v_po_id IS NULL THEN
      SELECT po.id
        INTO v_conflict_po_id
        FROM public.purchase_orders po
       WHERE po.idempotency_key = v_idem
         AND po.status NOT IN ('cancelled', 'received', 'receiving')
       LIMIT 1
       FOR UPDATE;
      IF v_conflict_po_id IS NOT NULL AND v_shared THEN
        -- Q10: o PV adere à OC aberta do seu grupo econômico.
        v_po_id := v_conflict_po_id;
      ELSIF v_conflict_po_id IS NOT NULL THEN
        INSERT INTO public.sale_order_purchase_shortage_effects(
          sale_order_id, supplier_key, supplier_id, source_order_version,
          desired_digest, desired_payload, effect_status, attention_reason,
          updated_at
        ) VALUES (
          p_sale_order_id, v_supplier_key, v_supplier_id, v_order_version,
          v_desired_digest, v_group_data, 'attention_required',
          'untracked_automatic_purchase_order', now()
        )
        ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
          supplier_id = EXCLUDED.supplier_id,
          source_order_version = EXCLUDED.source_order_version,
          desired_digest = EXCLUDED.desired_digest,
          desired_payload = EXCLUDED.desired_payload,
          effect_status = EXCLUDED.effect_status,
          attention_reason = EXCLUDED.attention_reason,
          updated_at = now();
        PERFORM public.emit_sale_order_purchase_attention(
          p_sale_order_id,
          v_order_version,
          'oc_automatica_sem_contribuicao_rastreada',
          jsonb_build_object(
            'supplier_key', v_supplier_key,
            'purchase_order_id', v_conflict_po_id,
            'desired_digest', v_desired_digest
          )
        );
        v_attention := v_attention + 1;
        CONTINUE;
      ELSE
        INSERT INTO public.purchase_orders(
          supplier_id, supplier_name, notes, total_value, auto_generated,
          status, approval_status, source_type, source_pv_ids,
          linked_sale_order_ids, idempotency_key
        ) VALUES (
          v_supplier_id,
          v_supplier_name,
          'Sugestão versionada pela outbox do PV ' || p_sale_order_id::text,
          0,
          true,
          CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,
          'pendente_aprovacao',
          'per_pv',
          ARRAY[p_sale_order_id],
          ARRAY[p_sale_order_id],
          v_idem
        ) RETURNING id INTO v_po_id;
        v_is_new := true;
        v_created := v_created + 1;
      END IF;
    END IF;

    SELECT po.*
      INTO v_po
      FROM public.purchase_orders po
     WHERE po.id = v_po_id
     FOR UPDATE;
    IF v_po.id IS NULL THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET purchase_order_id = NULL,
             source_order_version = v_order_version,
             desired_digest = v_desired_digest,
             desired_payload = v_group_data,
             effect_status = 'attention_required',
             attention_reason = 'managed_purchase_order_missing',
             updated_at = now()
       WHERE sale_order_id = p_sale_order_id
         AND supplier_key = v_supplier_key;
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_automatica_rastreada_nao_encontrada',
        jsonb_build_object('supplier_key', v_supplier_key)
      );
      v_attention := v_attention + 1;
      CONTINUE;
    END IF;

    v_current_digest := public.sale_order_outbox_purchase_order_digest(v_po_id);

    IF NOT public.pv_purchase_order_is_system_editable(v_po_id, v_is_new) THEN
      INSERT INTO public.sale_order_purchase_shortage_effects(
        sale_order_id, supplier_key, supplier_id, purchase_order_id,
        source_order_version, desired_digest, applied_digest,
        desired_payload, effect_status, attention_reason, updated_at
      ) VALUES (
        p_sale_order_id, v_supplier_key, v_supplier_id, v_po_id,
        v_order_version, v_desired_digest, v_current_digest,
        v_group_data, 'attention_required',
        'purchase_order_not_system_editable', now()
      )
      ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
        supplier_id = EXCLUDED.supplier_id,
        purchase_order_id = EXCLUDED.purchase_order_id,
        source_order_version = EXCLUDED.source_order_version,
        desired_digest = EXCLUDED.desired_digest,
        desired_payload = EXCLUDED.desired_payload,
        effect_status = EXCLUDED.effect_status,
        attention_reason = EXCLUDED.attention_reason,
        updated_at = now();
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_nao_editavel_exige_reconciliacao_manual',
        jsonb_build_object(
          'supplier_key', v_supplier_key,
          'purchase_order_id', v_po_id,
          'purchase_order_status', v_po.status,
          'approval_status', v_po.approval_status,
          'expected_applied_digest', public.pv_purchase_order_last_applied_digest(v_po_id),
          'current_digest', v_current_digest,
          'desired_digest', v_desired_digest
        )
      );
      v_attention := v_attention + 1;
      CONTINUE;
    END IF;

    IF NOT v_is_new
       AND v_effect.id IS NOT NULL
       AND v_effect.purchase_order_id IS NOT DISTINCT FROM v_po_id
       AND v_effect.desired_digest = v_desired_digest
       AND v_effect.effect_status = 'editable' THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_payload = v_group_data,
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;

    -- Grava a contribuição deste PV e remonta a OC com TODOS os contribuintes.
    INSERT INTO public.sale_order_purchase_shortage_effects(
      sale_order_id, supplier_key, supplier_id, purchase_order_id,
      source_order_version, desired_digest, applied_digest,
      desired_payload, effect_status, attention_reason,
      last_applied_at, updated_at
    ) VALUES (
      p_sale_order_id, v_supplier_key, v_supplier_id, v_po_id,
      v_order_version, v_desired_digest, NULL,
      v_group_data, 'editable', NULL, now(), now()
    )
    ON CONFLICT (sale_order_id, supplier_key) DO UPDATE SET
      supplier_id = EXCLUDED.supplier_id,
      purchase_order_id = EXCLUDED.purchase_order_id,
      source_order_version = EXCLUDED.source_order_version,
      desired_digest = EXCLUDED.desired_digest,
      desired_payload = EXCLUDED.desired_payload,
      effect_status = 'editable',
      attention_reason = NULL,
      updated_at = now();

    UPDATE public.purchase_orders
       SET supplier_id = v_supplier_id,
           supplier_name = v_supplier_name
     WHERE id = v_po_id;

    PERFORM public.rebuild_pv_purchase_order_from_effects(v_po_id);

    IF NOT v_is_new THEN
      v_updated := v_updated + 1;
    END IF;
  END LOOP;

  -- Contribuição que deixou de existir (falta resolvida, fornecedor mudou, PV
  -- cancelado/faturado): sai da OC ainda editável (Q13). OC compartilhada é
  -- remontada com os outros PVs; sem ninguém, é cancelada. OC aprovada ou
  -- mexida por gente fica intacta e vira alerta.
  FOR v_effect IN
    SELECT e.*
      FROM public.sale_order_purchase_shortage_effects e
     WHERE e.sale_order_id = p_sale_order_id
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(v_desired_groups) d
          WHERE d ->> 'supplier_key' = e.supplier_key
       )
     FOR UPDATE
  LOOP
    IF v_effect.purchase_order_id IS NULL
       OR v_effect.effect_status IN ('no_shortage', 'superseded') THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = CASE WHEN v_effect.purchase_order_id IS NULL
                                  THEN 'no_shortage' ELSE effect_status END,
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      CONTINUE;
    END IF;

    SELECT po.*
      INTO v_po
      FROM public.purchase_orders po
     WHERE po.id = v_effect.purchase_order_id
     FOR UPDATE;
    IF v_po.id IS NULL THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET purchase_order_id = NULL,
             source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'superseded',
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      CONTINUE;
    END IF;

    IF v_po.status IN ('cancelled', 'received', 'receiving') THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'superseded',
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      CONTINUE;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(v_po.idempotency_key, v_po.id::text), 0));

    IF public.pv_purchase_order_is_system_editable(v_po.id, false) THEN
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'no_shortage',
             attention_reason = NULL,
             updated_at = now()
       WHERE id = v_effect.id;
      IF public.rebuild_pv_purchase_order_from_effects(v_po.id) IS NULL THEN
        v_cancelled := v_cancelled + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;
    ELSE
      v_current_digest := public.sale_order_outbox_purchase_order_digest(v_po.id);
      UPDATE public.sale_order_purchase_shortage_effects
         SET source_order_version = v_order_version,
             desired_digest = NULL,
             desired_payload = '{}'::jsonb,
             effect_status = 'attention_required',
             attention_reason = 'obsolete_purchase_order_not_system_editable',
             updated_at = now()
       WHERE id = v_effect.id;
      PERFORM public.emit_sale_order_purchase_attention(
        p_sale_order_id,
        v_order_version,
        'oc_obsoleta_exige_reconciliacao_manual',
        jsonb_build_object(
          'supplier_key', v_effect.supplier_key,
          'purchase_order_id', v_po.id,
          'purchase_order_status', v_po.status,
          'approval_status', v_po.approval_status,
          'expected_applied_digest', public.pv_purchase_order_last_applied_digest(v_po.id),
          'current_digest', v_current_digest
        )
      );
      v_attention := v_attention + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'skipped', false,
    'sale_order_status', v_status,
    'source_order_version', v_order_version,
    'purchase_scope', v_scope,
    'desired_supplier_groups', jsonb_array_length(v_desired_groups),
    'created', v_created,
    'updated', v_updated,
    'reused', v_reused,
    'cancelled', v_cancelled,
    'attention_required', v_attention,
    'blocked', v_blocked
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Q12: falta de material de corte AVISA (vira falta registrada + compra),
--    não bloqueia a aprovação. Cadastro incompleto continua bloqueando.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sale_order_item_factory_gate_block_reason(p_item_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reference_id uuid;
  v_reason text;
BEGIN
  IF p_item_id IS NULL THEN RETURN 'item ausente'; END IF;
  SELECT soi.reference_id INTO v_reference_id FROM public.sale_order_items soi WHERE soi.id = p_item_id;
  IF NOT FOUND THEN RETURN 'item nao encontrado'; END IF;
  IF v_reference_id IS NULL THEN RETURN 'item sem referencia'; END IF;
  v_reason := public.atelier_item_block_reason(p_item_id);
  IF v_reason IS NOT NULL THEN RETURN v_reason; END IF;
  v_reason := public.sale_order_item_corte_material_gate_block_reason(p_item_id);
  -- "falta X no corte ..." deixa de bloquear: o empenho parcial registra a
  -- falta e a compra automática cobre (spec integracao-estoque-pv-compras Q12).
  IF v_reason LIKE 'falta %' THEN
    RETURN NULL;
  END IF;
  RETURN v_reason;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Leitura para as telas
-- ---------------------------------------------------------------------------

-- Falta por PV (badge na lista de PVs, confirmação no Kanban, selo "completo")
CREATE OR REPLACE FUNCTION public.list_sale_order_material_shortages(p_sale_order_ids uuid[])
RETURNS TABLE (
  sale_order_id uuid,
  order_number text,
  managed_lines integer,
  short_lines integer,
  shortages jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT COALESCE(mr.sale_order_id, o.sale_order_id) AS so_id,
           mr.product_id, mr.quantity_short,
           mr.metadata -> 'shortage_grade' AS shortage_grade
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
     WHERE public.material_reservation_is_pv_managed(mr)
       AND COALESCE(mr.sale_order_id, o.sale_order_id) = ANY (p_sale_order_ids)
  )
  SELECT so.id,
         so.order_number,
         count(r.*)::int,
         count(r.*) FILTER (WHERE r.quantity_short > 0)::int,
         COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', p.id,
           'product_name', p.name,
           'color', p.color,
           'unit', p.unit,
           'quantity_short', r.quantity_short,
           'shortage_grade', NULLIF(r.shortage_grade, '{}'::jsonb)
         ) ORDER BY p.name) FILTER (WHERE r.quantity_short > 0), '[]'::jsonb)
    FROM public.sale_orders so
    LEFT JOIN r ON r.so_id = so.id
    LEFT JOIN public.products p ON p.id = r.product_id
   WHERE so.id = ANY (p_sale_order_ids)
     AND public.is_approved_user()
   GROUP BY so.id, so.order_number;
$$;

-- Colunas Falta / Em compra (Projetado = físico − reservado − falta + em compra)
CREATE OR REPLACE FUNCTION public.product_supply_summary(p_product_ids uuid[])
RETURNS TABLE (
  product_id uuid,
  falta numeric,
  em_compra numeric,
  falta_grade jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (SELECT unnest(p_product_ids) AS id WHERE public.is_approved_user()),
  short AS (
    SELECT mr.product_id, sum(mr.quantity_short) AS falta
      FROM public.material_reservations mr
     WHERE mr.product_id = ANY (p_product_ids)
       AND mr.quantity_short > 0
       AND public.material_reservation_is_pv_managed(mr)
     GROUP BY mr.product_id
  ),
  short_grade AS (
    SELECT x.product_id, jsonb_object_agg(x.key, x.qty ORDER BY x.key) AS grade
      FROM (
        SELECT mr.product_id, g.key, sum(g.value::numeric) AS qty
          FROM public.material_reservations mr,
               LATERAL jsonb_each_text(COALESCE(mr.metadata -> 'shortage_grade', '{}'::jsonb)) g
         WHERE mr.product_id = ANY (p_product_ids)
           AND mr.quantity_short > 0
           AND public.material_reservation_is_pv_managed(mr)
           AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
         GROUP BY mr.product_id, g.key
        HAVING sum(g.value::numeric) > 0
      ) x
     GROUP BY x.product_id
  ),
  buying AS (
    SELECT poi.product_id,
           sum(GREATEST(COALESCE(poi.quantity, 0) - COALESCE(poi.received_quantity, 0), 0)
               * CASE WHEN public.po_norm_unit(COALESCE(poi.unit, p.unit)) = public.po_norm_unit(p.unit)
                      THEN 1 ELSE COALESCE(NULLIF(p.conversion_rate, 0), 1) END) AS em_compra
      FROM public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
      JOIN public.products p ON p.id = poi.product_id
     WHERE poi.product_id = ANY (p_product_ids)
       AND po.status NOT IN ('cancelled', 'received', 'suggested', 'draft')
     GROUP BY poi.product_id
  )
  SELECT ids.id,
         COALESCE(short.falta, 0),
         COALESCE(buying.em_compra, 0),
         short_grade.grade
    FROM ids
    LEFT JOIN short ON short.product_id = ids.id
    LEFT JOIN short_grade ON short_grade.product_id = ids.id
    LEFT JOIN buying ON buying.product_id = ids.id;
$$;

-- Rateio de entradas recentes (tela que abre depois de dar entrada)
CREATE OR REPLACE FUNCTION public.list_inbound_allocations(
  p_product_ids uuid[],
  p_since timestamptz
)
RETURNS TABLE (
  allocation_id uuid,
  product_id uuid,
  product_name text,
  color text,
  unit text,
  size_key text,
  reservation_id uuid,
  sale_order_id uuid,
  order_number text,
  client_name text,
  quantity numeric,
  stock_movement_id uuid,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.product_id, p.name, p.color, p.unit, a.size_key, a.reservation_id,
         a.sale_order_id, so.order_number, so.client_name, a.quantity,
         a.stock_movement_id, a.created_at
    FROM public.stock_inbound_allocations a
    JOIN public.products p ON p.id = a.product_id
    LEFT JOIN public.sale_orders so ON so.id = a.sale_order_id
   WHERE a.product_id = ANY (p_product_ids)
     AND a.created_at >= p_since
     AND a.reason = 'entrada'
     AND public.is_approved_user()
   ORDER BY p.name, so.order_number, a.size_key;
$$;

-- Faltas abertas (candidatos para editar o rateio), pela prioridade
CREATE OR REPLACE FUNCTION public.list_open_shortages_for_products(p_product_ids uuid[])
RETURNS TABLE (
  reservation_id uuid,
  product_id uuid,
  size_key text,
  sale_order_id uuid,
  order_number text,
  client_name text,
  quantity_short numeric,
  priority numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT mr.*, COALESCE(mr.sale_order_id, o.sale_order_id) AS so_id
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
     WHERE mr.product_id = ANY (p_product_ids)
       AND mr.quantity_short > 0
       AND public.material_reservation_is_pv_managed(mr)
       AND public.is_approved_user()
  )
  SELECT r.id, r.product_id, NULL::text, r.so_id, so.order_number, so.client_name,
         r.quantity_short, public.material_reservation_cover_priority(r.sale_order_id, r.order_id)
    FROM r LEFT JOIN public.sale_orders so ON so.id = r.so_id
   WHERE COALESCE(r.metadata ->> 'kind', '') <> 'sole_grade'
  UNION ALL
  SELECT r.id, r.product_id, g.key, r.so_id, so.order_number, so.client_name,
         g.value::numeric, public.material_reservation_cover_priority(r.sale_order_id, r.order_id)
    FROM r
    LEFT JOIN public.sale_orders so ON so.id = r.so_id
    CROSS JOIN LATERAL jsonb_each_text(COALESCE(r.metadata -> 'shortage_grade', '{}'::jsonb)) g
   WHERE COALESCE(r.metadata ->> 'kind', '') = 'sole_grade'
     AND g.value::numeric > 0
   ORDER BY 8, 5, 3;
$$;

-- Move quantidade entre empenho e falta numa linha (delta > 0: falta → empenho)
CREATE OR REPLACE FUNCTION public.move_reservation_short_to_covered(
  p_reservation_id uuid,
  p_size_key text,
  p_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res public.material_reservations%ROWTYPE;
  v_cov numeric;
  v_short numeric;
BEGIN
  SELECT * INTO v_res FROM public.material_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR NOT public.material_reservation_is_pv_managed(v_res) THEN
    RAISE EXCEPTION 'Reserva % não está aberta para rateio', p_reservation_id USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_res.metadata ->> 'kind', '') = 'sole_grade' THEN
    IF p_size_key IS NULL THEN
      RAISE EXCEPTION 'Solado exige numeração no rateio' USING ERRCODE = '22023';
    END IF;
    v_cov := COALESCE(NULLIF(v_res.metadata -> 'covered_grade' ->> p_size_key, '')::numeric, 0);
    v_short := COALESCE(NULLIF(v_res.metadata -> 'shortage_grade' ->> p_size_key, '')::numeric, 0);
    IF v_short - p_delta < -0.000001 OR v_cov + p_delta < -0.000001 THEN
      RAISE EXCEPTION 'Rateio maior que a falta do PV na numeração %', p_size_key USING ERRCODE = '22023';
    END IF;
    UPDATE public.material_reservations
       SET metadata = jsonb_set(
             jsonb_set(COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'covered_grade', COALESCE(metadata -> 'covered_grade', '{}'::jsonb),
               'shortage_grade', COALESCE(metadata -> 'shortage_grade', '{}'::jsonb)),
               ARRAY['covered_grade', p_size_key], to_jsonb(v_cov + p_delta)),
             ARRAY['shortage_grade', p_size_key], to_jsonb(v_short - p_delta)),
           quantity_reserved = quantity_reserved + p_delta,
           quantity_short = quantity_short - p_delta,
           updated_at = now()
     WHERE id = p_reservation_id;
  ELSE
    IF v_res.quantity_short - p_delta < -0.000001
       OR v_res.quantity_reserved - COALESCE(v_res.quantity_consumed, 0) + p_delta < -0.000001 THEN
      RAISE EXCEPTION 'Rateio maior que a falta do PV' USING ERRCODE = '22023';
    END IF;
    UPDATE public.material_reservations
       SET quantity_reserved = quantity_reserved + p_delta,
           quantity_short = quantity_short - p_delta,
           updated_at = now()
     WHERE id = p_reservation_id;
  END IF;
END;
$$;

-- Trava a linha do produto (mesma ordem de lock do realocador) e devolve o saldo.
CREATE OR REPLACE FUNCTION public.lock_product_for_allocation(p_product_id uuid)
RETURNS TABLE (quantity numeric, stock_grade jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT COALESCE(p.quantity, 0)::numeric, COALESCE(p.stock_grade, '{}'::jsonb)
      FROM public.products p
     WHERE p.id = p_product_id
     FOR UPDATE;
END;
$$;

-- Editar o rateio das entradas recentes de UM produto (Q9: tela editável).
-- p_allocations = [{reservation_id, size_key, quantity}] — substitui o rateio
-- automático feito desde p_since. Soma ≤ (o que foi rateado + livre agora).
CREATE OR REPLACE FUNCTION public.apply_inbound_allocation_edit(
  p_product_id uuid,
  p_since timestamptz,
  p_allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a record;
  v_item jsonb;
  v_phys numeric;
  v_free numeric;
  v_new_total numeric := 0;
  v_movement uuid;
  v_res public.material_reservations%ROWTYPE;
  v_is_sole boolean;
  v_stock_grade jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_allocations, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Rateio inválido' USING ERRCODE = '22023';
  END IF;

  SELECT l.quantity, l.stock_grade
    INTO v_phys, v_stock_grade
    FROM public.lock_product_for_allocation(p_product_id) l;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = '22023';
  END IF;

  SELECT a.stock_movement_id INTO v_movement
    FROM public.stock_inbound_allocations a
   WHERE a.product_id = p_product_id AND a.created_at >= p_since AND a.reason = 'entrada'
   ORDER BY a.created_at LIMIT 1;

  -- 1) desfaz o rateio automático dessas entradas. Rateio de reserva que já
  --    saiu do motor (consumida, PV cancelado) não volta: o registro fica no
  --    rastreio e o saldo dele não entra no novo rateio.
  FOR v_a IN
    SELECT a.* FROM public.stock_inbound_allocations a
     WHERE a.product_id = p_product_id AND a.created_at >= p_since AND a.reason = 'entrada'
  LOOP
    CONTINUE WHEN v_a.reservation_id IS NULL;
    SELECT * INTO v_res FROM public.material_reservations WHERE id = v_a.reservation_id;
    CONTINUE WHEN NOT FOUND OR NOT public.material_reservation_is_pv_managed(v_res);
    PERFORM public.move_reservation_short_to_covered(v_a.reservation_id, v_a.size_key, -v_a.quantity);
    DELETE FROM public.stock_inbound_allocations WHERE id = v_a.id;
  END LOOP;

  -- 2) aplica o rateio escolhido
  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE((v_item ->> 'quantity')::numeric, 0) <= 0;
    SELECT * INTO v_res FROM public.material_reservations
     WHERE id = (v_item ->> 'reservation_id')::uuid;
    IF NOT FOUND OR v_res.product_id <> p_product_id THEN
      RAISE EXCEPTION 'Reserva do rateio não pertence ao produto' USING ERRCODE = '22023';
    END IF;
    v_is_sole := COALESCE(v_res.metadata ->> 'kind', '') = 'sole_grade';
    IF v_is_sole THEN
      -- livre do balde
      SELECT GREATEST(COALESCE(NULLIF(v_stock_grade ->> (v_item ->> 'size_key'), '')::numeric, 0), 0)
             - COALESCE(sum(COALESCE(NULLIF(mr.metadata -> 'covered_grade' ->> (v_item ->> 'size_key'), '')::numeric, 0)), 0)
        INTO v_free
        FROM public.material_reservations mr
       WHERE mr.product_id = p_product_id
         AND mr.status IN ('reserved', 'partially_consumed')
         AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade';
    ELSE
      SELECT v_phys - COALESCE(sum(GREATEST(COALESCE(mr.quantity_reserved, 0) - COALESCE(mr.quantity_consumed, 0), 0)), 0)
        INTO v_free
        FROM public.material_reservations mr
       WHERE mr.product_id = p_product_id
         AND mr.status IN ('reserved', 'partially_consumed');
    END IF;
    IF (v_item ->> 'quantity')::numeric > v_free + 0.000001 THEN
      RAISE EXCEPTION 'Rateio maior que o estoque livre (livre %)', round(v_free, 3)
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.move_reservation_short_to_covered(
      v_res.id, NULLIF(v_item ->> 'size_key', ''), (v_item ->> 'quantity')::numeric);
    INSERT INTO public.stock_inbound_allocations (
      stock_movement_id, product_id, size_key, reservation_id, sale_order_id, order_id,
      quantity, reason
    ) VALUES (
      v_movement, p_product_id, NULLIF(v_item ->> 'size_key', ''), v_res.id,
      COALESCE(v_res.sale_order_id, (SELECT o.sale_order_id FROM public.orders o WHERE o.id = v_res.order_id)),
      v_res.order_id, (v_item ->> 'quantity')::numeric, 'entrada'
    );
    v_new_total := v_new_total + (v_item ->> 'quantity')::numeric;
  END LOOP;

  PERFORM public.sync_product_reserved_stock(p_product_id);
  RETURN jsonb_build_object('ok', true, 'product_id', p_product_id, 'allocated', v_new_total);
END;
$$;

-- Aba "Rastreio" da janela do grupo: entradas e para quais PVs foram
CREATE OR REPLACE FUNCTION public.list_group_stock_tracking(p_group_id uuid, p_limit integer DEFAULT 100)
RETURNS TABLE (
  stock_movement_id uuid,
  created_at timestamptz,
  product_id uuid,
  product_name text,
  color text,
  unit text,
  quantity numeric,
  origin text,
  description text,
  allocations jsonb,
  allocated_qty numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sm.id, sm.created_at, p.id, p.name, p.color, p.unit, sm.quantity,
         COALESCE(sm.movement_reason, sm.origin_type, 'entrada'),
         sm.description,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
                    'sale_order_id', a.sale_order_id,
                    'order_number', so.order_number,
                    'client_name', so.client_name,
                    'size_key', a.size_key,
                    'quantity', a.quantity
                  ) ORDER BY so.order_number, a.size_key)
             FROM public.stock_inbound_allocations a
             LEFT JOIN public.sale_orders so ON so.id = a.sale_order_id
            WHERE a.stock_movement_id = sm.id
         ), '[]'::jsonb),
         COALESCE((SELECT sum(a.quantity) FROM public.stock_inbound_allocations a
                    WHERE a.stock_movement_id = sm.id), 0)
    FROM public.stock_movements sm
    JOIN public.products p ON p.id = sm.product_id
   WHERE p.group_id = p_group_id
     AND sm.movement_type = 'in'
     AND public.is_approved_user()
   ORDER BY sm.created_at DESC
   LIMIT GREATEST(COALESCE(p_limit, 100), 1);
$$;

-- ---------------------------------------------------------------------------
-- 5. Permissões
-- Função nova nasce com EXECUTE para PUBLIC: revogar só de anon não fecha nada.
-- RPCs das telas: só authenticated (e cada uma checa is_approved_user()).
-- Auxiliares internos (SECURITY DEFINER que mexem em reserva/OC): só o próprio
-- banco — quem chama são funções/gatilhos SECURITY DEFINER do dono.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.list_sale_order_material_shortages(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.product_supply_summary(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_inbound_allocations(uuid[], timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_open_shortages_for_products(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_inbound_allocation_edit(uuid, timestamptz, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_group_stock_tracking(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sale_order_material_shortages(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_supply_summary(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_inbound_allocations(uuid[], timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_open_shortages_for_products(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_inbound_allocation_edit(uuid, timestamptz, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_group_stock_tracking(uuid, integer) TO authenticated, service_role;

-- inclui os auxiliares da etapa 1 (035100), que tinham ficado abertos a PUBLIC
REVOKE ALL ON FUNCTION public.allocate_reservation_partial(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_sole_grade_reservation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reallocate_product_commitments(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_reservation_short_to_covered(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rebuild_pv_purchase_order_from_effects(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_pv_purchase_order_without_contributors(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_pv_purchase_order_items_from_effects(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_product_for_allocation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sale_order_purchase_scope_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pv_purchase_order_last_applied_digest(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pv_purchase_order_is_system_editable(uuid, boolean) FROM PUBLIC, anon, authenticated;
