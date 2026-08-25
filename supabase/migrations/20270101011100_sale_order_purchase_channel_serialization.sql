-- Serializa os dois canais de compra por PV e fecha a grade da sugestão
-- automática sobre a falta real por numeração.
--
-- 110 criou o comando atômico manual. 109 criou a contribuição versionada da
-- outbox. As duas transações eram individualmente idempotentes, mas usavam
-- advisory locks diferentes e podiam observar simultaneamente "nenhuma OC".
-- Esta migration transforma a implementação 110 em função interna e mantém a
-- assinatura pública num wrapper que toma, em ordem, os mesmos locks da 109.

BEGIN;

-- Toda alteração de cabeçalho/item que possa mudar a demanda avança uma época
-- transacional. O comprador lê a época, trava produtos e, antes do efeito,
-- trava/revalida esta única linha. Assim uma edição que cruzou o cálculo força
-- retry; uma edição que começa depois espera o commit da compra.
CREATE TABLE public.sale_order_purchase_allocation_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  allocation_version bigint NOT NULL DEFAULT 1 CHECK (allocation_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sale_order_purchase_allocation_state(singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.sale_order_purchase_allocation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sale_order_purchase_allocation_state
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sale_order_purchase_allocation_state TO service_role;

CREATE OR REPLACE FUNCTION public.bump_sale_order_purchase_allocation_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.sale_order_purchase_allocation_state
     SET allocation_version = allocation_version + 1,
         updated_at = now()
   WHERE singleton;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_sale_order_purchase_allocation_version()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_aa_sale_order_purchase_allocation_version
BEFORE INSERT OR UPDATE OR DELETE ON public.sale_orders
FOR EACH STATEMENT
EXECUTE FUNCTION public.bump_sale_order_purchase_allocation_version();

CREATE TRIGGER trg_aa_sale_order_item_purchase_allocation_version
BEFORE INSERT OR UPDATE OR DELETE ON public.sale_order_items
FOR EACH STATEMENT
EXECUTE FUNCTION public.bump_sale_order_purchase_allocation_version();

CREATE OR REPLACE FUNCTION public.lock_sale_order_purchase_allocation()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_version bigint;
BEGIN
  SELECT s.allocation_version
    INTO v_version
    FROM public.sale_order_purchase_allocation_state s
   WHERE s.singleton
   FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'Estado global de alocação de compras ausente';
  END IF;
  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_sale_order_purchase_allocation()
  FROM PUBLIC, anon, authenticated, service_role;

-- Estes comandos podem tocar demanda/status e, na mesma transação, estoque.
-- O trigger sozinho seria tarde demais (produto -> época); injeta a época no
-- topo para que todos sigam época -> produto. Comandos criados depois da 111
-- adotam a chamada diretamente em suas próprias migrations.
DO $$
DECLARE
  v_function record;
  v_definition text;
  v_begin_pos integer;
  v_expected text[] := ARRAY[
    'execute_sale_order_command',
    'commit_standalone_nfe_stock_hold',
    'reverse_standalone_nfe_stock_for_cancel',
    'execute_production_order_command',
    'register_order_shipment_command',
    'soft_delete_sale_order_command',
    'restore_sale_order_command',
    'revert_invoiced_sale_order_command',
    'force_sale_order_production_command',
    'retry_sale_order_item_promotion'
  ];
  v_missing text[];
BEGIN
  SELECT array_agg(expected_name ORDER BY expected_name)
    INTO v_missing
    FROM unnest(v_expected) expected_name
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = expected_name
   );
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Comandos esperados sem época de compra: %', v_missing;
  END IF;

  FOR v_function IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND p.proname = ANY(v_expected)
       AND l.lanname = 'plpgsql'
     ORDER BY p.proname, p.oid
  LOOP
    SELECT pg_get_functiondef(v_function.oid) INTO v_definition;
    IF position('public.lock_sale_order_purchase_allocation()' IN v_definition) = 0 THEN
      v_begin_pos := position(E'\nBEGIN\n' IN v_definition);
      IF v_begin_pos = 0 THEN
        RAISE EXCEPTION 'BEGIN principal não encontrado em %', v_function.proname;
      END IF;
      v_definition := overlay(
        v_definition
        PLACING E'\nBEGIN\n  PERFORM public.lock_sale_order_purchase_allocation();\n'
        FROM v_begin_pos FOR length(E'\nBEGIN\n')
      );
      EXECUTE v_definition;
    END IF;
  END LOOP;
END;
$$;

-- Fronteira física comum a geração manual, outbox e recebimentos. A ordem é:
-- advisory de produto (UUID crescente) -> linha de produto (UUID crescente).
-- Quem também tocar OC deve continuar com cabeçalho -> itens.
CREATE OR REPLACE FUNCTION public.lock_sale_order_purchase_products(
  p_product_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_product_ids uuid[];
  v_product_id uuid;
  v_expected integer;
  v_found integer;
BEGIN
  IF array_position(p_product_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Produto nulo na fronteira de compra'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(x.product_id ORDER BY x.product_id), ARRAY[]::uuid[])
    INTO v_product_ids
    FROM (
      SELECT DISTINCT u.product_id
        FROM unnest(COALESCE(p_product_ids, ARRAY[]::uuid[])) u(product_id)
    ) x;
  v_expected := cardinality(v_product_ids);

  FOREACH v_product_id IN ARRAY v_product_ids
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sale-order-purchase-product:' || v_product_id::text,
      0
    ));
  END LOOP;

  SELECT count(*)::integer
    INTO v_found
    FROM (
      SELECT p.id
        FROM public.products p
       WHERE p.id = ANY(v_product_ids)
       ORDER BY p.id
       FOR UPDATE
    ) locked_products;
  IF v_found <> v_expected THEN
    RAISE EXCEPTION 'Um ou mais produtos da compra deixaram de existir'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_sale_order_purchase_products(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

-- O recebimento artesanal antigo travava item/OC e só depois produto. A
-- geração per-PV faz produto/OC/item; ordens opostas permitiam deadlock. O
-- patch mantém toda a regra do motor artesanal, mudando apenas a aquisição e
-- revalidando os IDs lidos sem lock antes de executar qualquer efeito.
DO $$
DECLARE
  v_oid oid;
  v_definition text;
  v_lock_marker constant text :=
    '  SELECT * INTO v_item FROM public.purchase_order_items' || E'\n' ||
    '   WHERE id=p_purchase_order_item_id FOR UPDATE;' || E'\n' ||
    '  IF NOT FOUND THEN RAISE EXCEPTION ''Item de OC nao encontrado''; END IF;' || E'\n' ||
    '  SELECT * INTO v_po FROM public.purchase_orders WHERE id=v_item.purchase_order_id FOR UPDATE;';
  v_product_marker constant text :=
    '  SELECT * INTO v_product FROM public.products WHERE id=v_item.product_id FOR UPDATE;';
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'register_strap_purchase_receipt';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'register_strap_purchase_receipt ausente';
  END IF;

  IF position('v_lock_product_id uuid;' IN v_definition) = 0 THEN
    IF position('  v_variant_id uuid;' IN v_definition) = 0
       OR position(v_lock_marker IN v_definition) = 0
       OR position(v_product_marker IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Definição do recebimento artesanal divergiu; patch recusado';
    END IF;
    v_definition := replace(
      v_definition,
      '  v_variant_id uuid;',
      '  v_variant_id uuid;' || E'\n' ||
      '  v_lock_product_id uuid;' || E'\n' ||
      '  v_lock_purchase_order_id uuid;'
    );
    v_definition := replace(
      v_definition,
      v_lock_marker,
      '  SELECT poi.product_id, poi.purchase_order_id' || E'\n' ||
      '    INTO v_lock_product_id, v_lock_purchase_order_id' || E'\n' ||
      '    FROM public.purchase_order_items poi' || E'\n' ||
      '   WHERE poi.id = p_purchase_order_item_id;' || E'\n' ||
      '  IF NOT FOUND THEN RAISE EXCEPTION ''Item de OC nao encontrado''; END IF;' || E'\n' ||
      '  PERFORM public.lock_sale_order_purchase_products(ARRAY[v_lock_product_id]);' || E'\n' ||
      '  SELECT * INTO v_po FROM public.purchase_orders' || E'\n' ||
      '   WHERE id = v_lock_purchase_order_id FOR UPDATE;' || E'\n' ||
      '  IF NOT FOUND THEN RAISE EXCEPTION ''OC do item nao encontrada''; END IF;' || E'\n' ||
      '  SELECT * INTO v_item FROM public.purchase_order_items' || E'\n' ||
      '   WHERE id = p_purchase_order_item_id FOR UPDATE;' || E'\n' ||
      '  IF NOT FOUND' || E'\n' ||
      '     OR v_item.product_id IS DISTINCT FROM v_lock_product_id' || E'\n' ||
      '     OR v_item.purchase_order_id IS DISTINCT FROM v_lock_purchase_order_id THEN' || E'\n' ||
      '    RAISE EXCEPTION ''Item de OC mudou durante o recebimento; repita''' || E'\n' ||
      '      USING ERRCODE = ''40001'';' || E'\n' ||
      '  END IF;'
    );
    v_definition := replace(
      v_definition,
      v_product_marker,
      '  SELECT * INTO v_product FROM public.products' || E'\n' ||
      '   WHERE id = v_lock_product_id;' || E'\n' ||
      '  IF NOT FOUND OR v_product.id IS DISTINCT FROM v_item.product_id THEN' || E'\n' ||
      '    RAISE EXCEPTION ''Produto do recebimento mudou; repita''' || E'\n' ||
      '      USING ERRCODE = ''40001'';' || E'\n' ||
      '  END IF;'
    );
    EXECUTE v_definition;
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;
  IF position('lock_sale_order_purchase_products' IN v_definition) = 0
     OR position('WHERE id = v_lock_purchase_order_id FOR UPDATE' IN v_definition) = 0
     OR position('WHERE id = p_purchase_order_item_id FOR UPDATE' IN v_definition) = 0
     OR position(v_product_marker IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Recebimento artesanal não adotou produto -> OC -> item';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Alocação global determinística do estoque entre PVs ativos
-- ---------------------------------------------------------------------------

-- Preserva o cálculo 110 como fonte de demanda de UM PV. A função pública é
-- recriada abaixo como uma agregação das alocações globais; assim tela, canal
-- manual e worker observam exatamente a mesma falta.
DO $$
BEGIN
  IF to_regprocedure(
       'public.compute_per_pv_purchase_needs_unallocated(uuid[])'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.compute_per_pv_purchase_needs(uuid[])'
       ) IS NULL THEN
      RAISE EXCEPTION 'compute_per_pv_purchase_needs da 110 ausente';
    END IF;
    ALTER FUNCTION public.compute_per_pv_purchase_needs(uuid[])
      RENAME TO compute_per_pv_purchase_needs_unallocated;
  END IF;
END;
$$;

-- Fórmula usada tanto pelo escalar quanto por cada numeração do solado.
-- `p_prior_demand` é a demanda dos PVs anteriores na ordem created_at,id.
CREATE OR REPLACE FUNCTION public.sale_order_purchase_allocated_shortage(
  p_demand numeric,
  p_onhand numeric,
  p_prior_demand numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT greatest(
    0::numeric,
    COALESCE(p_demand, 0)
      - greatest(
          0::numeric,
          COALESCE(p_onhand, 0) - COALESCE(p_prior_demand, 0)
        )
  );
$function$;

-- Dois PVs de 10 no mesmo produto: sem estoque compram 20; com 10 em estoque
-- compram 10. A soma usa a mesma janela determinística do motor abaixo.
DO $$
DECLARE
  v_shortage_zero_stock numeric;
  v_shortage_partial_stock numeric;
BEGIN
  WITH demands(seq, demand) AS (
    VALUES (1, 10::numeric), (2, 10::numeric)
  ), allocated AS (
    SELECT d.*,
           COALESCE(sum(d.demand) OVER (
             ORDER BY d.seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_demand
      FROM demands d
  )
  SELECT sum(public.sale_order_purchase_allocated_shortage(
           a.demand, 0, a.prior_demand
         )),
         sum(public.sale_order_purchase_allocated_shortage(
           a.demand, 10, a.prior_demand
         ))
    INTO v_shortage_zero_stock, v_shortage_partial_stock
    FROM allocated a;
  IF v_shortage_zero_stock <> 20 OR v_shortage_partial_stock <> 10 THEN
    RAISE EXCEPTION
      'Alocação entre dois PVs falhou: estoque 0 => %, estoque 10 => %',
      v_shortage_zero_stock, v_shortage_partial_stock;
  END IF;
END;
$$;

-- Uma linha por PV/produto. Todos os PVs ativos participam da alocação, mesmo
-- quando o caller pediu apenas um deles; o filtro dos alvos só acontece no
-- SELECT final. Reserva própria é capacidade dedicada do PV. Estoque livre é
-- distribuído uma única vez. Solado é distribuído por chave de stock_grade.
CREATE OR REPLACE FUNCTION public.compute_allocated_per_pv_purchase_need_lines(
  p_target_pv_ids uuid[],
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE(
  sale_order_id uuid,
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
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $function$
  WITH eligible_pvs AS (
    SELECT so.id AS sale_order_id, so.created_at
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND so.status IN ('Aprovado', 'Em Produção')
  ), demand AS (
    SELECT pv.sale_order_id,
           pv.created_at AS sale_order_created_at,
           need.*
      FROM eligible_pvs pv
      CROSS JOIN LATERAL public.compute_per_pv_purchase_needs_unallocated(
        ARRAY[pv.sale_order_id]
      ) need
     WHERE p_product_ids IS NULL
        OR need.material_id = ANY(p_product_ids)
  ), own_reservations AS (
    SELECT o.sale_order_id,
           mr.product_id,
           sum(greatest(
             0,
             COALESCE(mr.quantity_reserved, 0)
               - COALESCE(mr.quantity_consumed, 0)
           )) AS own_reserved
      FROM public.material_reservations mr
      JOIN public.orders o ON o.id = mr.order_id
      JOIN eligible_pvs pv ON pv.sale_order_id = o.sale_order_id
     WHERE mr.status IN ('reserved', 'partially_consumed')
       AND mr.sale_order_strap_demand_id IS NULL
       AND mr.strap_stock_floor_contribution_id IS NULL
     GROUP BY o.sale_order_id, mr.product_id
  ), annotated AS (
    SELECT d.*,
           greatest(0, COALESCE(p.quantity, 0)
             - COALESCE(p.reserved_stock, 0)) AS free_stock,
           COALESCE(p.stock_grade, '{}'::jsonb) AS stock_grade,
           COALESCE(orr.own_reserved, 0) AS own_reserved,
           EXISTS (
             SELECT 1
               FROM jsonb_each(
                 CASE WHEN jsonb_typeof(d.grade) = 'object'
                   THEN d.grade ELSE '{}'::jsonb END
               ) ge(key, value)
              WHERE left(ge.key, 1) <> '_'
                AND jsonb_typeof(ge.value) = 'number'
                AND (ge.value #>> '{}')::numeric > 0
           ) AS has_positive_grade
      FROM demand d
      JOIN public.products p ON p.id = d.material_id
      LEFT JOIN own_reservations orr
        ON orr.sale_order_id = d.sale_order_id
       AND orr.product_id = d.material_id
  ), scalar_with_own_before AS (
    SELECT a.*,
           COALESCE(sum(greatest(0, a.needed_qty)) OVER (
             PARTITION BY a.sale_order_id, a.material_id
             ORDER BY COALESCE(a.color, '')
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS own_demand_before
      FROM annotated a
     WHERE NOT a.has_positive_grade
  ), scalar_effective AS (
    SELECT s.*,
           least(
             greatest(0, s.needed_qty),
             greatest(0, s.own_reserved - s.own_demand_before)
           ) AS own_allocated,
           greatest(
             0,
             greatest(0, s.needed_qty)
               - least(
                   greatest(0, s.needed_qty),
                   greatest(0, s.own_reserved - s.own_demand_before)
                 )
           ) AS shared_demand
      FROM scalar_with_own_before s
  ), scalar_with_prior AS (
    SELECT s.*,
           COALESCE(sum(s.shared_demand) OVER (
             PARTITION BY s.material_id
             ORDER BY s.sale_order_created_at, s.sale_order_id,
                      COALESCE(s.color, '')
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_shared_demand
      FROM scalar_effective s
  ), scalar_allocated AS (
    SELECT s.sale_order_id,
           s.material_id,
           s.color,
           public.sale_order_purchase_allocated_shortage(
             s.shared_demand,
             s.free_stock,
             s.prior_shared_demand
           ) AS allocated_shortage
      FROM scalar_with_prior s
  ), grade_entries AS (
    SELECT a.sale_order_id,
           a.sale_order_created_at,
           a.material_id,
           a.color,
           ge.key AS size_key,
           (ge.value #>> '{}')::numeric AS demand_qty,
           greatest(
             0,
             COALESCE(NULLIF(a.stock_grade ->> ge.key, '')::numeric, 0)
           ) AS size_onhand
      FROM annotated a
      CROSS JOIN LATERAL jsonb_each(a.grade) ge(key, value)
     WHERE a.has_positive_grade
       AND left(ge.key, 1) <> '_'
       AND jsonb_typeof(ge.value) = 'number'
       AND (ge.value #>> '{}')::numeric > 0
  ), grade_with_prior AS (
    SELECT ge.*,
           COALESCE(sum(ge.demand_qty) OVER (
             PARTITION BY ge.material_id, ge.size_key
             ORDER BY ge.sale_order_created_at, ge.sale_order_id,
                      COALESCE(ge.color, '')
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_size_demand
      FROM grade_entries ge
  ), grade_allocated AS (
    SELECT gp.*,
           public.sale_order_purchase_allocated_shortage(
             gp.demand_qty,
             gp.size_onhand,
             gp.prior_size_demand
           ) AS size_shortage
      FROM grade_with_prior gp
  ), grade_rollup AS (
    SELECT ga.sale_order_id,
           ga.material_id,
           ga.color,
           sum(ga.size_shortage) AS allocated_shortage,
           COALESCE(
             jsonb_object_agg(
               ga.size_key,
               ga.size_shortage
               ORDER BY ga.size_key
             ) FILTER (WHERE ga.size_shortage > 0),
             '{}'::jsonb
           ) AS allocated_shortage_grade
      FROM grade_allocated ga
     GROUP BY ga.sale_order_id, ga.material_id, ga.color
  ), conflicting_open AS (
    SELECT pv.sale_order_id,
           poi.product_id,
           string_agg(DISTINCT po.order_number, ', ' ORDER BY po.order_number)
             AS order_numbers
      FROM eligible_pvs pv
      CROSS JOIN public.purchase_order_items poi
      JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
     WHERE lower(COALESCE(po.status, '')) NOT IN (
             'cancelled', 'canceled', 'cancelada',
             'received', 'recebida', 'receiving'
           )
       AND po.source_type IS DISTINCT FROM 'strap_demand'
       -- Sugestão automática de OUTRO PV é a contribuição em trânsito dele e
       -- não bloqueia este. A sugestão do próprio PV continua sendo conflito.
       AND (
         NOT (
           COALESCE(po.auto_generated, false)
           AND po.source_type = 'per_pv'
         )
         OR COALESCE(po.source_pv_ids, ARRAY[]::uuid[])
              @> ARRAY[pv.sale_order_id]
         OR COALESCE(po.linked_sale_order_ids, ARRAY[]::uuid[])
              @> ARRAY[pv.sale_order_id]
       )
       AND greatest(
             0,
             COALESCE(poi.quantity, 0) - COALESCE(poi.received_quantity, 0)
           ) > 0
     GROUP BY pv.sale_order_id, poi.product_id
  )
  SELECT a.sale_order_id,
         a.material_id,
         a.product_name,
         a.unit,
         a.color,
         a.needed_qty,
         greatest(
           0,
           a.needed_qty - CASE WHEN a.has_positive_grade
             THEN COALESCE(gr.allocated_shortage, a.needed_qty)
             ELSE COALESCE(sa.allocated_shortage, a.needed_qty)
           END
         ) AS stock_qty,
         CASE WHEN a.has_positive_grade
           THEN COALESCE(gr.allocated_shortage, a.needed_qty)
           ELSE COALESCE(sa.allocated_shortage, a.needed_qty)
         END AS shortage,
         a.supplier_id,
         a.supplier_name,
         a.last_unit_price,
         a.is_artisanal,
         a.grade,
         a.color_mismatch,
         a.conversion_warning,
         CASE WHEN a.has_positive_grade
           THEN COALESCE(gr.allocated_shortage_grade, '{}'::jsonb)
           ELSE NULL
         END AS shortage_grade,
         CASE WHEN co.product_id IS NOT NULL THEN format(
           'Já existe compra manual/MRP aberta para "%s" nas OCs %s. '
           || 'Confira ou autorize explicitamente antes de comprar novamente.',
           a.product_name,
           co.order_numbers
         ) ELSE NULL END AS open_purchase_warning
    FROM annotated a
    LEFT JOIN scalar_allocated sa
      ON sa.sale_order_id = a.sale_order_id
     AND sa.material_id = a.material_id
     AND sa.color IS NOT DISTINCT FROM a.color
    LEFT JOIN grade_rollup gr
      ON gr.sale_order_id = a.sale_order_id
     AND gr.material_id = a.material_id
     AND gr.color IS NOT DISTINCT FROM a.color
    LEFT JOIN conflicting_open co ON co.product_id = a.material_id
      AND co.sale_order_id = a.sale_order_id
   WHERE a.sale_order_id = ANY(p_target_pv_ids)
   ORDER BY a.supplier_name NULLS LAST,
            a.product_name,
            a.sale_order_created_at,
            a.sale_order_id,
            COALESCE(a.color, '');
$function$;

-- Compatibilidade da assinatura 110: agrega as parcelas já alocadas dos PVs
-- alvo. Para dois PVs do mesmo produto a UI continua recebendo uma linha, mas
-- o estoque aparece uma única vez e a soma das faltas fecha a demanda global.
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
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $function$
  WITH lines AS (
    SELECT *
      FROM public.compute_allocated_per_pv_purchase_need_lines(p_pv_ids, NULL)
  ), grouped AS (
    SELECT l.material_id,
           max(l.product_name) AS product_name,
           max(l.unit) AS unit,
           l.color,
           sum(l.needed_qty) AS needed_qty,
           sum(l.stock_qty) AS stock_qty,
           sum(l.shortage) AS shortage,
           max(l.supplier_id::text)::uuid AS supplier_id,
           max(l.supplier_name) AS supplier_name,
           max(l.last_unit_price) AS last_unit_price,
           bool_or(l.is_artisanal) AS is_artisanal,
           bool_or(l.color_mismatch) AS color_mismatch,
           max(l.conversion_warning) AS conversion_warning,
           max(l.open_purchase_warning) AS open_purchase_warning
      FROM lines l
     GROUP BY l.material_id, l.color
  ), demand_grade_values AS (
    SELECT l.material_id,
           l.color,
           ge.key,
           sum((ge.value #>> '{}')::numeric) AS quantity
      FROM lines l
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(l.grade) = 'object'
          THEN l.grade ELSE '{}'::jsonb END
      ) ge(key, value)
     WHERE left(ge.key, 1) <> '_'
       AND jsonb_typeof(ge.value) = 'number'
     GROUP BY l.material_id, l.color, ge.key
  ), demand_grades AS (
    SELECT d.material_id,
           d.color,
           jsonb_object_agg(d.key, d.quantity ORDER BY d.key) AS grade
      FROM demand_grade_values d
     WHERE d.quantity > 0
     GROUP BY d.material_id, d.color
  ), shortage_grade_values AS (
    SELECT l.material_id,
           l.color,
           ge.key,
           sum((ge.value #>> '{}')::numeric) AS quantity
      FROM lines l
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(l.shortage_grade) = 'object'
          THEN l.shortage_grade ELSE '{}'::jsonb END
      ) ge(key, value)
     WHERE left(ge.key, 1) <> '_'
       AND jsonb_typeof(ge.value) = 'number'
     GROUP BY l.material_id, l.color, ge.key
  ), shortage_grades AS (
    SELECT s.material_id,
           s.color,
           jsonb_object_agg(s.key, s.quantity ORDER BY s.key) AS shortage_grade
      FROM shortage_grade_values s
     WHERE s.quantity > 0
     GROUP BY s.material_id, s.color
  )
  SELECT g.material_id,
         g.product_name,
         g.unit,
         g.color,
         g.needed_qty,
         g.stock_qty,
         g.shortage,
         g.supplier_id,
         g.supplier_name,
         g.last_unit_price,
         g.is_artisanal,
         dg.grade,
         g.color_mismatch,
         g.conversion_warning,
         sg.shortage_grade,
         g.open_purchase_warning
    FROM grouped g
    LEFT JOIN demand_grades dg
      ON dg.material_id = g.material_id
     AND dg.color IS NOT DISTINCT FROM g.color
    LEFT JOIN shortage_grades sg
      ON sg.material_id = g.material_id
     AND sg.color IS NOT DISTINCT FROM g.color
   ORDER BY g.supplier_name NULLS LAST, g.product_name, COALESCE(g.color, '');
$function$;

REVOKE ALL ON FUNCTION public.sale_order_purchase_allocated_shortage(
  numeric, numeric, numeric
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sale_order_purchase_allocated_shortage(
  numeric, numeric, numeric
) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.compute_per_pv_purchase_needs_unallocated(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_per_pv_purchase_needs_unallocated(uuid[])
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.compute_allocated_per_pv_purchase_need_lines(
  uuid[], uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_allocated_per_pv_purchase_need_lines(
  uuid[], uuid[]
) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.compute_per_pv_purchase_needs(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_per_pv_purchase_needs(uuid[])
  TO authenticated, service_role;

DO $$
BEGIN
  IF to_regprocedure(
       'public.create_per_pv_purchase_orders_atomic_internal(uuid[],jsonb,uuid,boolean)'
     ) IS NULL THEN
    IF to_regprocedure(
         'public.create_per_pv_purchase_orders_atomic(uuid[],jsonb,uuid,boolean)'
       ) IS NULL THEN
      RAISE EXCEPTION
        'Implementação 110 de create_per_pv_purchase_orders_atomic ausente';
    END IF;
    ALTER FUNCTION public.create_per_pv_purchase_orders_atomic(
      uuid[], jsonb, uuid, boolean
    ) RENAME TO create_per_pv_purchase_orders_atomic_internal;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_per_pv_purchase_orders_atomic_internal(
  uuid[], jsonb, uuid, boolean
) FROM PUBLIC, anon, authenticated, service_role;

-- A implementação 110 tratava toda OC per_pv aberta como conflito. Depois da
-- alocação global, a sugestão automática de outro PV é uma parcela distinta;
-- o wrapper já bloqueia compras humanas/MRP e a sugestão do próprio PV.
DO $$
DECLARE
  v_oid oid;
  v_definition text;
  v_marker constant text :=
    'AND po.source_type IS DISTINCT FROM ''strap_demand''' || E'\n' ||
    '           AND greatest(';
  v_replacement constant text :=
    'AND po.source_type IS DISTINCT FROM ''strap_demand''' || E'\n' ||
    '           AND NOT (' || E'\n' ||
    '             COALESCE(po.auto_generated, false)' || E'\n' ||
    '             AND po.source_type = ''per_pv''' || E'\n' ||
    '           )' || E'\n' ||
    '           AND greatest(';
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_per_pv_purchase_orders_atomic_internal'
     AND pg_get_function_identity_arguments(p.oid) =
       'p_pv_ids uuid[], p_drafts jsonb, p_request_id uuid, p_allow_existing_open boolean';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Implementação interna per-PV ausente';
  END IF;
  IF position('COALESCE(po.auto_generated, false)' IN v_definition) = 0 THEN
    IF position(v_marker IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Marcador de conflito aberto da implementação 110 divergiu';
    END IF;
    v_definition := replace(v_definition, v_marker, v_replacement);
    EXECUTE v_definition;
  END IF;
END;
$$;

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
AS $$
DECLARE
  v_pv_ids uuid[];
  v_pv_id uuid;
  v_product_ids uuid[];
  v_product_ids_after uuid[];
  v_purchase_order_ids uuid[];
  v_request_hash text;
  v_existing_request public.per_pv_purchase_order_requests%ROWTYPE;
  v_draft_item jsonb;
  v_need record;
  v_requested_qty numeric;
  v_requested_unit text;
  v_allowed_qty numeric;
  v_allowed_unit text;
  v_basis_qty numeric;
  v_purchase_multiple numeric;
  v_net_of_stock boolean;
BEGIN
  -- Replica o gate da implementação antes de tomar locks. A função
  -- interna também o repete: SECURITY DEFINER nunca vira atalho de permissão.
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       auth.uid() IS NULL
       OR NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
     ) THEN
    RAISE EXCEPTION
      'Somente Administração/Gerência pode gerar ordens de compra por pedido'
      USING ERRCODE = '42501';
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
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id é obrigatório para gerar OCs por pedido'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(x.pv_id ORDER BY x.pv_id)
    INTO v_pv_ids
    FROM (
      SELECT DISTINCT u.pv_id
        FROM unnest(p_pv_ids) AS u(pv_id)
    ) x;

  -- Replay vem antes de qualquer leitura de estoque/demanda. Se a resposta da
  -- primeira tentativa se perdeu, o mesmo request_id devolve o recibo mesmo
  -- que a OC criada já tenha alterado avisos e estado observado.
  v_request_hash := md5(jsonb_build_object(
    'pv_ids', to_jsonb(v_pv_ids),
    'drafts', p_drafts,
    'allow_existing_open', COALESCE(p_allow_existing_open, false)
  )::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'perpv-request:' || p_request_id::text,
    0
  ));
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

  -- A época é o primeiro lock de negócio também no canal manual. Worker e
  -- manual seguem: época -> advisories de PV -> produtos -> OC -> itens.
  PERFORM public.lock_sale_order_purchase_allocation();

  -- Ordem global evita deadlock entre dois lotes multi-PV. A chave é
  -- deliberadamente idêntica à de process_sale_order_purchase_shortages.
  FOR v_pv_id IN
    SELECT u.pv_id
      FROM unnest(v_pv_ids) AS u(pv_id)
     ORDER BY u.pv_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sale-order-purchase-shortages:' || v_pv_id::text,
      0
    ));
  END LOOP;

  -- União da demanda calculada com os IDs enviados pelo cliente. O primeiro
  -- conjunto impede que uma linha omitida escape da serialização; o segundo
  -- impede que um produto stale/injetado seja validado antes de seu lock.
  SELECT array_agg(product_id ORDER BY product_id)
    INTO v_product_ids
    FROM (
      SELECT DISTINCT need.material_id AS product_id
        FROM public.compute_per_pv_purchase_needs_unallocated(v_pv_ids) need
       WHERE need.material_id IS NOT NULL
      UNION
      SELECT DISTINCT NULLIF(btrim(item.value ->> 'material_id'), '')::uuid
        FROM jsonb_array_elements(p_drafts) draft(value)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(draft.value -> 'items') = 'array'
            THEN draft.value -> 'items' ELSE '[]'::jsonb END
        ) item(value)
       WHERE NULLIF(btrim(item.value ->> 'material_id'), '') IS NOT NULL
    ) products_to_lock
   WHERE product_id IS NOT NULL;

  PERFORM public.lock_sale_order_purchase_products(v_product_ids);

  SELECT array_agg(product_id ORDER BY product_id)
    INTO v_product_ids_after
    FROM (
      SELECT DISTINCT need.material_id AS product_id
        FROM public.compute_per_pv_purchase_needs_unallocated(v_pv_ids) need
       WHERE need.material_id IS NOT NULL
      UNION
      SELECT DISTINCT NULLIF(btrim(item.value ->> 'material_id'), '')::uuid
        FROM jsonb_array_elements(p_drafts) draft(value)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(draft.value -> 'items') = 'array'
            THEN draft.value -> 'items' ELSE '[]'::jsonb END
        ) item(value)
       WHERE NULLIF(btrim(item.value ->> 'material_id'), '') IS NOT NULL
    ) products_after
   WHERE product_id IS NOT NULL;
  IF COALESCE(v_product_ids_after, ARRAY[]::uuid[])
       IS DISTINCT FROM COALESCE(v_product_ids, ARRAY[]::uuid[]) THEN
    RAISE EXCEPTION 'Os produtos demandados mudaram durante o cálculo; recalcule'
      USING ERRCODE = '40001';
  END IF;

  -- OCs humanas/MRP abertas são factualidade a conferir, não capacidade que
  -- se subtrai da demanda de outro PV. Ordem: produto -> época -> OC -> item.
  SELECT COALESCE(array_agg(x.purchase_order_id ORDER BY x.purchase_order_id),
                  ARRAY[]::uuid[])
    INTO v_purchase_order_ids
    FROM (
      SELECT DISTINCT po.id AS purchase_order_id
        FROM public.purchase_orders po
        JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
       WHERE poi.product_id = ANY(COALESCE(v_product_ids, ARRAY[]::uuid[]))
         AND lower(COALESCE(po.status, '')) NOT IN (
           'cancelled', 'canceled', 'cancelada',
           'received', 'recebida', 'receiving'
         )
         AND greatest(
               0,
               COALESCE(poi.quantity, 0) - COALESCE(poi.received_quantity, 0)
             ) > 0
    ) x;
  PERFORM po.id
    FROM public.purchase_orders po
   WHERE po.id = ANY(v_purchase_order_ids)
   ORDER BY po.id
   FOR UPDATE;
  PERFORM poi.id
    FROM public.purchase_order_items poi
   WHERE poi.purchase_order_id = ANY(v_purchase_order_ids)
     AND poi.product_id = ANY(COALESCE(v_product_ids, ARRAY[]::uuid[]))
   ORDER BY poi.purchase_order_id, poi.product_id, poi.id
   FOR UPDATE;

  -- Recalcula depois dos locks e limita cada linha ao shortage alocado dos PVs
  -- alvo (com conversão/MOQ canônica). Quantidade menor continua sendo decisão
  -- manual válida; quantidade maior exige novo recálculo, nunca overbuy stale.
  FOR v_need IN
    WITH needs AS MATERIALIZED (
      SELECT * FROM public.compute_per_pv_purchase_needs(v_pv_ids)
    ), draft_items AS MATERIALIZED (
      SELECT item.value AS draft_item, item.ordinality
        FROM jsonb_array_elements(p_drafts) draft(value)
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(draft.value -> 'items') = 'array'
            THEN draft.value -> 'items' ELSE '[]'::jsonb END
        ) WITH ORDINALITY item(value, ordinality)
    )
    SELECT di.draft_item, need.*
      FROM draft_items di
      LEFT JOIN needs need
        ON need.material_id = NULLIF(
             btrim(di.draft_item ->> 'material_id'), ''
           )::uuid
       AND need.color IS NOT DISTINCT FROM NULLIF(
             btrim(di.draft_item ->> 'color'), ''
           )
     ORDER BY di.ordinality
  LOOP
    v_draft_item := v_need.draft_item;
    IF v_need.material_id IS NULL OR COALESCE(v_need.shortage, 0) <= 0 THEN
      RAISE EXCEPTION
        'A falta do produto % foi resolvida/realocada; recalcule antes de gerar',
        v_draft_item ->> 'material_id'
        USING ERRCODE = '40001';
    END IF;
    IF v_need.open_purchase_warning IS NOT NULL
       AND NOT COALESCE(p_allow_existing_open, false) THEN
      RAISE EXCEPTION '%', v_need.open_purchase_warning
        USING ERRCODE = '55000';
    END IF;

    v_requested_qty := (v_draft_item ->> 'quantity')::numeric;
    v_requested_unit := NULLIF(btrim(v_draft_item ->> 'unit'), '');
    v_net_of_stock := COALESCE(
      NULLIF(btrim(v_draft_item ->> 'net_of_stock'), '')::boolean,
      true
    );
    v_basis_qty := CASE WHEN v_net_of_stock
      THEN v_need.shortage
      ELSE v_need.needed_qty
    END;

    SELECT CASE
             WHEN p.purchase_multiple > 0 THEN p.purchase_multiple
             WHEN pg.purchase_multiple > 0 THEN pg.purchase_multiple
             ELSE 0
           END
      INTO v_purchase_multiple
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id = p.group_id
     WHERE p.id = v_need.material_id;

    SELECT normalized.out_qty, normalized.out_unit
      INTO v_allowed_qty, v_allowed_unit
      FROM public.po_normalize_line(
        v_need.material_id,
        v_basis_qty,
        v_need.unit,
        COALESCE(v_need.last_unit_price, 0)
      ) normalized;
    IF COALESCE(v_purchase_multiple, 0) > 1 THEN
      v_allowed_qty := CEIL(v_allowed_qty / v_purchase_multiple)
        * v_purchase_multiple;
    END IF;
    IF public.po_norm_unit(v_requested_unit) = public.po_norm_unit(v_allowed_unit) THEN
      NULL;
    ELSIF public.po_norm_unit(v_requested_unit) = public.po_norm_unit(v_need.unit) THEN
      v_allowed_qty := v_basis_qty;
      v_allowed_unit := v_need.unit;
    ELSE
      RAISE EXCEPTION
        'Unidade % divergiu da falta recalculada (% / %)',
        v_requested_unit, v_need.unit, v_allowed_unit
        USING ERRCODE = '40001';
    END IF;
    IF v_requested_qty > v_allowed_qty + 0.0001 THEN
      RAISE EXCEPTION
        'Quantidade % % excede a falta alocada % % do produto %; recalcule',
        v_requested_qty, v_requested_unit,
        v_allowed_qty, v_allowed_unit,
        v_need.product_name
        USING ERRCODE = '40001';
    END IF;
  END LOOP;

  -- O wrapper já revalidou e travou as compras relevantes. A implementação
  -- interna foi estreitada acima para ignorar somente OCs automáticas de OUTRO
  -- PV; o gate deste wrapper continua honrando a decisão explícita do caller.
  RETURN public.create_per_pv_purchase_orders_atomic_internal(
    v_pv_ids,
    p_drafts,
    p_request_id,
    COALESCE(p_allow_existing_open, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_per_pv_purchase_orders_atomic(
  uuid[], jsonb, uuid, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_per_pv_purchase_orders_atomic(
  uuid[], jsonb, uuid, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_per_pv_purchase_orders_atomic(
  uuid[], jsonb, uuid, boolean
) IS
  'Fronteira pública da compra per-PV: normaliza e serializa todos os PVs com a mesma chave da outbox antes do comando atômico interno.';

COMMENT ON FUNCTION public.create_per_pv_purchase_orders_atomic_internal(
  uuid[], jsonb, uuid, boolean
) IS
  'Implementação atômica da 110; sem EXECUTE para clientes ou service_role, acessível somente pelo wrapper SECURITY DEFINER serializado.';

-- O motor 110 fornece demand_grade e shortage_grade separadamente. A OC deve
-- persistir a segunda, escalada somente quando MOQ/unidade fechada eleva a
-- quantidade de compra. Qualquer grade ausente ou incoerente aborta o efeito:
-- nunca se grava uma OC de solado com quantity que não fecha por numeração.
CREATE OR REPLACE FUNCTION public.sale_order_outbox_safe_shortage_grade(
  p_product_category text,
  p_demand_grade jsonb,
  p_shortage_grade jsonb,
  p_shortage numeric,
  p_out_qty numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry record;
  v_value numeric;
  v_shortage_total numeric := 0;
  v_scaled_total numeric := 0;
  v_demand_positive integer := 0;
  v_positive integer := 0;
  v_scaled jsonb;
  v_requires_grade boolean :=
    lower(btrim(COALESCE(p_product_category, ''))) = 'solado';
BEGIN
  IF p_demand_grade IS NULL THEN
    IF v_requires_grade THEN
      RAISE EXCEPTION 'Solado sem grade de demanda; OC automática recusada'
        USING ERRCODE = 'PZ211';
    END IF;
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_demand_grade) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Grade de demanda inválida; OC automática recusada'
      USING ERRCODE = 'PZ211';
  END IF;
  FOR v_entry IN
    SELECT e.key, e.value
      FROM jsonb_each(p_demand_grade) e
  LOOP
    CONTINUE WHEN left(v_entry.key, 1) = '_';
    IF jsonb_typeof(v_entry.value) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Grade de demanda contém valor não numérico em %', v_entry.key
        USING ERRCODE = 'PZ211';
    END IF;
    v_value := (v_entry.value #>> '{}')::numeric;
    IF v_value < 0 OR trunc(v_value) <> v_value THEN
      RAISE EXCEPTION 'Grade de demanda contém valor inválido em %', v_entry.key
        USING ERRCODE = 'PZ211';
    END IF;
    IF v_value > 0 THEN v_demand_positive := v_demand_positive + 1; END IF;
  END LOOP;
  -- O motor legado pode representar um material sem grade como '{}' ou com
  -- metadados `_...`. Isso continua sendo material escalar. Somente Solado
  -- exige uma distribuição positiva por numeração.
  IF v_demand_positive = 0 THEN
    IF v_requires_grade THEN
      RAISE EXCEPTION 'Solado sem grade positiva; OC automática recusada'
        USING ERRCODE = 'PZ211';
    END IF;
    RETURN NULL;
  END IF;
  IF p_shortage_grade IS NULL
     OR jsonb_typeof(p_shortage_grade) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Produto com grade sem grade de falta; OC automática recusada'
      USING ERRCODE = 'PZ211';
  END IF;

  FOR v_entry IN
    SELECT e.key, e.value
      FROM jsonb_each(p_shortage_grade) e
  LOOP
    CONTINUE WHEN left(v_entry.key, 1) = '_';
    IF jsonb_typeof(v_entry.value) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Grade de falta contém valor não numérico em %', v_entry.key
        USING ERRCODE = 'PZ211';
    END IF;
    v_value := (v_entry.value #>> '{}')::numeric;
    IF v_value < 0 OR trunc(v_value) <> v_value THEN
      RAISE EXCEPTION 'Grade de falta contém valor inválido em %', v_entry.key
        USING ERRCODE = 'PZ211';
    END IF;
    v_shortage_total := v_shortage_total + v_value;
    IF v_value > 0 THEN v_positive := v_positive + 1; END IF;
  END LOOP;

  IF v_positive = 0
     OR p_shortage IS NULL
     OR p_shortage <= 0
     OR abs(v_shortage_total - p_shortage) > 0.0001 THEN
    RAISE EXCEPTION
      'Grade de falta soma %, mas a falta escalar é %; OC automática recusada',
      v_shortage_total, p_shortage
      USING ERRCODE = 'PZ211';
  END IF;
  IF p_out_qty IS NULL OR p_out_qty <= 0 OR trunc(p_out_qty) <> p_out_qty THEN
    RAISE EXCEPTION
      'Quantidade de compra % não fecha uma grade inteira; OC automática recusada',
      p_out_qty
      USING ERRCODE = 'PZ211';
  END IF;

  v_scaled := public.scale_grade_to_total(p_shortage_grade, p_out_qty);
  IF v_scaled IS NULL OR jsonb_typeof(v_scaled) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Falha ao escalar grade de falta; OC automática recusada'
      USING ERRCODE = 'PZ211';
  END IF;
  FOR v_entry IN
    SELECT e.key, e.value
      FROM jsonb_each(v_scaled) e
  LOOP
    CONTINUE WHEN left(v_entry.key, 1) = '_';
    IF jsonb_typeof(v_entry.value) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Grade escalada contém valor não numérico em %', v_entry.key
        USING ERRCODE = 'PZ211';
    END IF;
    v_value := (v_entry.value #>> '{}')::numeric;
    IF v_value < 0 OR trunc(v_value) <> v_value THEN
      RAISE EXCEPTION 'Grade escalada contém valor inválido em %', v_entry.key
        USING ERRCODE = 'PZ211';
    END IF;
    v_scaled_total := v_scaled_total + v_value;
  END LOOP;
  IF abs(v_scaled_total - p_out_qty) > 0.0001 THEN
    RAISE EXCEPTION
      'Grade escalada soma %, mas quantity é %; OC automática recusada',
      v_scaled_total, p_out_qty
      USING ERRCODE = 'PZ211';
  END IF;
  RETURN v_scaled;
END;
$$;

REVOKE ALL ON FUNCTION public.sale_order_outbox_safe_shortage_grade(
  text, jsonb, jsonb, numeric, numeric
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sale_order_outbox_safe_shortage_grade(
  text, jsonb, jsonb, numeric, numeric
) TO service_role;

-- Patch cirúrgico e verificado da função extensa criada na 109. Copiar a
-- função inteira aqui criaria duas fontes que poderiam divergir. Se qualquer
-- marcador esperado mudar, a migration aborta antes de publicar uma adaptação
-- parcial.
DO $$
DECLARE
  v_oid oid;
  v_definition text;
  v_after text;
  v_engine_marker constant text :=
    'public.compute_materials_per_pv(ARRAY[p_sale_order_id])';
  v_product_marker constant text :=
    'SELECT need.*, p.min_stock, p.max_stock, p.active,';
  v_grade_marker constant text := '''grade'', v.grade,';
  v_engine_count integer;
  v_changed boolean := false;
  v_declare_marker constant text := '  v_attention integer := 0;';
  v_epoch_marker constant text :=
    '  IF p_sale_order_id IS NULL THEN' || E'\n' ||
    '    RAISE EXCEPTION ''sale_order_id obrigatório'' USING ERRCODE = ''22023'';' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  PERFORM pg_advisory_xact_lock(hashtextextended(';
  v_lock_marker constant text :=
    '  IF NOT FOUND THEN' || E'\n' ||
    '    RETURN jsonb_build_object(''skipped'', true, ''reason'', ''sale_order_not_found'');' || E'\n' ||
    '  END IF;' || E'\n\n' ||
    '  IF v_status IN (''Aprovado'', ''Em Produção'') THEN';
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid)
    INTO v_oid, v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'process_sale_order_purchase_shortages'
     AND pg_get_function_identity_arguments(p.oid) = 'p_sale_order_id uuid';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Worker 109 process_sale_order_purchase_shortages ausente';
  END IF;

  IF position('sale_order_outbox_safe_shortage_grade' IN v_definition) = 0 THEN
    v_engine_count := (
      length(v_definition) - length(replace(v_definition, v_engine_marker, ''))
    ) / length(v_engine_marker);
    IF v_engine_count <> 2
       OR position(v_product_marker IN v_definition) = 0
       OR position(v_grade_marker IN v_definition) = 0 THEN
      RAISE EXCEPTION
        'Definição 109 divergiu; patch de compra/grade recusado (% chamadas)',
        v_engine_count;
    END IF;

    v_definition := replace(
      v_definition,
      v_engine_marker,
      'public.compute_per_pv_purchase_needs(ARRAY[p_sale_order_id])'
    );
    v_definition := replace(
      v_definition,
      v_product_marker,
      v_product_marker || E'\n             p.category AS product_category,'
    );
    v_definition := replace(
      v_definition,
      v_grade_marker,
      '''grade'', public.sale_order_outbox_safe_shortage_grade(' || E'\n' ||
      '                   v.product_category,' || E'\n' ||
      '                   v.grade,' || E'\n' ||
      '                   v.shortage_grade,' || E'\n' ||
      '                   v.shortage,' || E'\n' ||
      '                   v.out_qty' || E'\n' ||
      '                 ),'
    );
    v_changed := true;
  END IF;

  IF position('v_purchase_product_ids uuid[];' IN v_definition) = 0 THEN
    IF position(v_declare_marker IN v_definition) = 0
       OR position(v_epoch_marker IN v_definition) = 0
       OR position(v_lock_marker IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Marcadores de serialização do worker 109 divergiram';
    END IF;
    v_definition := replace(
      v_definition,
      v_declare_marker,
      v_declare_marker || E'\n' ||
      '  v_purchase_product_ids uuid[];' || E'\n' ||
      '  v_purchase_product_ids_after uuid[];'
    );
    -- A época é o primeiro lock de negócio. Injetá-la somente depois do
    -- SELECT ... FOR UPDATE do PV formaria o ciclo worker PV->época contra
    -- os comandos comerciais época->PV.
    v_definition := replace(
      v_definition,
      v_epoch_marker,
      '  IF p_sale_order_id IS NULL THEN' || E'\n' ||
      '    RAISE EXCEPTION ''sale_order_id obrigatório'' USING ERRCODE = ''22023'';' || E'\n' ||
      '  END IF;' || E'\n\n' ||
      '  PERFORM public.lock_sale_order_purchase_allocation();' || E'\n\n' ||
      '  PERFORM pg_advisory_xact_lock(hashtextextended('
    );
    v_definition := replace(
      v_definition,
      v_lock_marker,
      '  IF NOT FOUND THEN' || E'\n' ||
      '    RETURN jsonb_build_object(''skipped'', true, ''reason'', ''sale_order_not_found'');' || E'\n' ||
      '  END IF;' || E'\n\n' ||
      '  SELECT COALESCE(array_agg(x.product_id ORDER BY x.product_id), ARRAY[]::uuid[])' || E'\n' ||
      '    INTO v_purchase_product_ids' || E'\n' ||
      '    FROM (' || E'\n' ||
      '      SELECT DISTINCT need.material_id AS product_id' || E'\n' ||
      '        FROM public.compute_per_pv_purchase_needs_unallocated(' || E'\n' ||
      '          ARRAY[p_sale_order_id]' || E'\n' ||
      '        ) need' || E'\n' ||
      '       WHERE need.material_id IS NOT NULL' || E'\n' ||
      '      UNION' || E'\n' ||
      '      SELECT DISTINCT poi.product_id' || E'\n' ||
      '        FROM public.sale_order_purchase_shortage_effects e' || E'\n' ||
      '        JOIN public.purchase_order_items poi' || E'\n' ||
      '          ON poi.purchase_order_id = e.purchase_order_id' || E'\n' ||
      '       WHERE e.sale_order_id = p_sale_order_id' || E'\n' ||
      '         AND poi.product_id IS NOT NULL' || E'\n' ||
      '    ) x;' || E'\n' ||
      '  PERFORM public.lock_sale_order_purchase_products(v_purchase_product_ids);' || E'\n' ||
      '  SELECT COALESCE(array_agg(x.product_id ORDER BY x.product_id), ARRAY[]::uuid[])' || E'\n' ||
      '    INTO v_purchase_product_ids_after' || E'\n' ||
      '    FROM (' || E'\n' ||
      '      SELECT DISTINCT need.material_id AS product_id' || E'\n' ||
      '        FROM public.compute_per_pv_purchase_needs_unallocated(' || E'\n' ||
      '          ARRAY[p_sale_order_id]' || E'\n' ||
      '        ) need' || E'\n' ||
      '       WHERE need.material_id IS NOT NULL' || E'\n' ||
      '      UNION' || E'\n' ||
      '      SELECT DISTINCT poi.product_id' || E'\n' ||
      '        FROM public.sale_order_purchase_shortage_effects e' || E'\n' ||
      '        JOIN public.purchase_order_items poi' || E'\n' ||
      '          ON poi.purchase_order_id = e.purchase_order_id' || E'\n' ||
      '       WHERE e.sale_order_id = p_sale_order_id' || E'\n' ||
      '         AND poi.product_id IS NOT NULL' || E'\n' ||
      '    ) x;' || E'\n' ||
      '  IF v_purchase_product_ids_after IS DISTINCT FROM v_purchase_product_ids THEN' || E'\n' ||
      '    RAISE EXCEPTION ''Os produtos demandados mudaram durante a compra; repita''' || E'\n' ||
      '      USING ERRCODE = ''40001'';' || E'\n' ||
      '  END IF;' || E'\n\n' ||
      '  IF v_status IN (''Aprovado'', ''Em Produção'') THEN'
    );
    v_changed := true;
  END IF;

  IF v_changed THEN
    EXECUTE v_definition;
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_after;
  IF position('public.compute_materials_per_pv(ARRAY[p_sale_order_id])' IN v_after) > 0
     OR position('public.compute_per_pv_purchase_needs(ARRAY[p_sale_order_id])' IN v_after) = 0
     OR position('sale_order_outbox_safe_shortage_grade' IN v_after) = 0
     OR position('lock_sale_order_purchase_products' IN v_after) = 0
     OR position('lock_sale_order_purchase_allocation()' IN v_after) = 0
     OR position('lock_sale_order_purchase_allocation()' IN v_after)
        > position('FROM public.sale_orders so' IN v_after)
     OR position('v.shortage_grade' IN v_after) = 0
     OR position('''grade'', v.grade' IN v_after) > 0 THEN
    RAISE EXCEPTION 'Patch do worker de compra ficou incompleto';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale_order_purchase_shortages(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale_order_purchase_shortages(uuid)
  TO service_role;

-- Fixtures executáveis da invariância: falta parcial 2/3, elevada por MOQ de
-- 5 para 8, precisa virar 3/5. Usar a grade total 6/4 produziria 5/3 e compra
-- os tamanhos errados, embora a soma parecesse correta.
DO $$
DECLARE
  v_scaled jsonb;
  v_failed_closed boolean := false;
BEGIN
  v_scaled := public.sale_order_outbox_safe_shortage_grade(
    'Solado',
    '{"34": 6, "35": 4}'::jsonb,
    '{"34": 2, "35": 3}'::jsonb,
    5,
    8
  );
  IF v_scaled IS DISTINCT FROM '{"34": 3, "35": 5}'::jsonb THEN
    RAISE EXCEPTION
      'Fixture grade parcial/MOQ falhou: esperado 3/5, recebido %', v_scaled;
  END IF;

  BEGIN
    PERFORM public.sale_order_outbox_safe_shortage_grade(
      'Solado', '{"34": 6, "35": 4}'::jsonb, NULL, 5, 8
    );
  EXCEPTION WHEN SQLSTATE 'PZ211' THEN
    v_failed_closed := true;
  END;
  IF NOT v_failed_closed THEN
    RAISE EXCEPTION 'Solado sem shortage_grade não falhou fechado';
  END IF;

  IF public.sale_order_outbox_safe_shortage_grade(
       'Napa', '{}'::jsonb, NULL, 12.5, 12.5
     ) IS NOT NULL
     OR public.sale_order_outbox_safe_shortage_grade(
       'Forro', '{"_source": "scalar"}'::jsonb, NULL, 7, 7
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'Material não graduado/vazio não retornou NULL';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_sale_order_purchase_channel_contract_tests()
RETURNS TABLE(case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_wrapper text;
  v_worker text;
  v_digest text;
  v_receipt text;
  v_product_child_124 text;
  v_scaled jsonb;
  v_zero_stock numeric;
  v_partial_stock numeric;
BEGIN
  SELECT pg_get_functiondef(
    'public.create_per_pv_purchase_orders_atomic(uuid[],jsonb,uuid,boolean)'::regprocedure
  ) INTO v_wrapper;
  SELECT pg_get_functiondef(
    'public.process_sale_order_purchase_shortages(uuid)'::regprocedure
  ) INTO v_worker;
  SELECT pg_get_functiondef(
    'public.sale_order_outbox_purchase_order_digest(uuid)'::regprocedure
  ) INTO v_digest;
  SELECT pg_get_functiondef(p.oid)
    INTO v_receipt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'register_strap_purchase_receipt';
  SELECT pg_get_functiondef(p.oid)
    INTO v_product_child_124
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_per_pv_purchase_orders_atomic_products_124'
     AND pg_get_function_identity_arguments(p.oid) =
       'p_pv_ids uuid[], p_drafts jsonb, p_request_id uuid, p_allow_existing_open boolean';

  case_name := 'single_purchase_channel_lock';
  ok := (
      position('sale-order-purchase-shortages:' IN v_wrapper) > 0
      AND position('ORDER BY u.pv_id' IN v_wrapper) > 0
      AND position('create_per_pv_purchase_orders_atomic_internal' IN v_wrapper) > 0
      AND position('v_net_of_stock' IN v_wrapper) > 0
      AND position('v_purchase_multiple' IN v_wrapper) > 0
      AND position('lock_sale_order_purchase_products' IN v_wrapper) > 0
      AND position('lock_sale_order_purchase_products' IN v_worker) > 0
      AND position('lock_sale_order_purchase_allocation()' IN v_wrapper) > 0
      AND position('lock_sale_order_purchase_allocation()' IN v_wrapper)
        < position('sale-order-purchase-shortages:' IN v_wrapper)
      AND position('lock_sale_order_purchase_allocation()' IN v_worker) > 0
      AND position('lock_sale_order_purchase_allocation()' IN v_worker)
        < position('FROM public.sale_orders so' IN v_worker)
      AND NOT has_function_privilege(
        'authenticated',
        'public.create_per_pv_purchase_orders_atomic_internal(uuid[],jsonb,uuid,boolean)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'service_role',
        'public.create_per_pv_purchase_orders_atomic_internal(uuid[],jsonb,uuid,boolean)',
        'EXECUTE'
      )
    ) OR (
      -- Estado final após a 124: o wrapper misto conserva a implementação 111
      -- owner-only para products e adiciona box_types sob a mesma ordem global.
      position('FROM public.per_pv_purchase_batch_receipts_124 receipt' IN v_wrapper) > 0
      AND position('create_per_pv_purchase_orders_atomic_products_124' IN v_wrapper) > 0
      AND position('sale-order-purchase-shortages:' IN v_wrapper) > 0
      AND position('lock_sale_order_purchase_allocation()' IN v_wrapper) > 0
      AND position('ORDER BY input.pv_id' IN v_wrapper) > 0
      AND position('lock_sale_order_purchase_products' IN v_wrapper) > 0
      AND position('lock_purchase_order_box_types_121' IN v_wrapper) > 0
      AND position('lock_sale_order_purchase_allocation()' IN v_wrapper)
        < position('ORDER BY input.pv_id' IN v_wrapper)
      AND position('ORDER BY input.pv_id' IN v_wrapper)
        < position('lock_sale_order_purchase_products' IN v_wrapper)
      AND position('lock_sale_order_purchase_products' IN v_wrapper)
        < position('lock_purchase_order_box_types_121' IN v_wrapper)
      AND position('v_net_of_stock' IN COALESCE(v_product_child_124, '')) > 0
      AND position('v_purchase_multiple' IN COALESCE(v_product_child_124, '')) > 0
      AND position(
        'create_per_pv_purchase_orders_atomic_internal'
        IN COALESCE(v_product_child_124, '')
      ) > 0
      AND position('lock_sale_order_purchase_products' IN v_worker) > 0
      AND position('lock_sale_order_purchase_allocation()' IN v_worker) > 0
      AND position('lock_sale_order_purchase_allocation()' IN v_worker)
        < position('FROM public.sale_orders so' IN v_worker)
      AND to_regprocedure(
        'public.create_per_pv_purchase_orders_atomic_products_124(uuid[],jsonb,uuid,boolean)'
      ) IS NOT NULL
      AND NOT COALESCE(has_function_privilege(
        'authenticated',
        to_regprocedure(
          'public.create_per_pv_purchase_orders_atomic_products_124(uuid[],jsonb,uuid,boolean)'
        ),
        'EXECUTE'
      ), false)
      AND NOT COALESCE(has_function_privilege(
        'service_role',
        to_regprocedure(
          'public.create_per_pv_purchase_orders_atomic_products_124(uuid[],jsonb,uuid,boolean)'
        ),
        'EXECUTE'
      ), false)
    );
  message := 'Manual e outbox serializam por PV; implementação sem bypass direto.';
  RETURN NEXT;

  case_name := 'durable_replay_before_recalculation';
  ok := (
      position('per_pv_purchase_order_requests' IN v_wrapper) > 0
      AND position('compute_per_pv_purchase_needs_unallocated' IN v_wrapper) > 0
      AND position('per_pv_purchase_order_requests' IN v_wrapper)
        < position('compute_per_pv_purchase_needs_unallocated' IN v_wrapper)
    ) OR (
      position('FROM public.per_pv_purchase_batch_receipts_124 receipt' IN v_wrapper) > 0
      AND position('compute_per_pv_purchase_needs_unallocated' IN v_wrapper) > 0
      AND position('compute_per_pv_packaging_purchase_needs_124' IN v_wrapper) > 0
      AND position('FROM public.per_pv_purchase_batch_receipts_124 receipt' IN v_wrapper)
        < position('compute_per_pv_purchase_needs_unallocated' IN v_wrapper)
      AND position('FROM public.per_pv_purchase_batch_receipts_124 receipt' IN v_wrapper)
        < position('compute_per_pv_packaging_purchase_needs_124' IN v_wrapper)
    );
  message := 'Replay consulta recibo durável antes de qualquer validação dependente de estoque.';
  RETURN NEXT;

  WITH demands(seq, demand) AS (
    VALUES (1, 10::numeric), (2, 10::numeric)
  ), allocated AS (
    SELECT d.*,
           COALESCE(sum(d.demand) OVER (
             ORDER BY d.seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ), 0) AS prior_demand
      FROM demands d
  )
  SELECT sum(public.sale_order_purchase_allocated_shortage(
           a.demand, 0, a.prior_demand
         )),
         sum(public.sale_order_purchase_allocated_shortage(
           a.demand, 10, a.prior_demand
         ))
    INTO v_zero_stock, v_partial_stock
    FROM allocated a;
  case_name := 'two_pvs_share_stock_once';
  ok := v_zero_stock = 20 AND v_partial_stock = 10;
  message := 'Dois PVs de 10 compram 20 com estoque zero e só 10 com estoque parcial de 10.';
  RETURN NEXT;

  case_name := 'receipt_lock_order_product_po_item';
  ok := position('lock_sale_order_purchase_products' IN v_receipt) > 0
    AND position('WHERE id = v_lock_purchase_order_id FOR UPDATE' IN v_receipt)
      > position('lock_sale_order_purchase_products' IN v_receipt)
    AND position('WHERE id = p_purchase_order_item_id FOR UPDATE' IN v_receipt)
      > position('WHERE id = v_lock_purchase_order_id FOR UPDATE' IN v_receipt);
  message := 'Recebimento artesanal e geração usam produto -> OC -> item, sem ciclo de deadlock.';
  RETURN NEXT;

  case_name := 'shortage_grade_not_total_grade';
  v_scaled := public.sale_order_outbox_safe_shortage_grade(
    'Solado',
    '{"34": 6, "35": 4}'::jsonb,
    '{"34": 2, "35": 3}'::jsonb,
    5,
    8
  );
  ok := v_scaled = '{"34": 3, "35": 5}'::jsonb
    AND position('compute_per_pv_purchase_needs' IN v_worker) > 0
    AND position('v.shortage_grade' IN v_worker) > 0
    AND position('''grade'', v.grade' IN v_worker) = 0;
  message := 'Grade parcial é escalada da falta para MOQ, nunca copiada da demanda total.';
  RETURN NEXT;

  case_name := 'empty_grade_is_scalar_except_sole';
  ok := public.sale_order_outbox_safe_shortage_grade(
      'Napa', '{}'::jsonb, NULL, 12.5, 12.5
    ) IS NULL
    AND public.sale_order_outbox_safe_shortage_grade(
      'Forro', '{"_source": "scalar"}'::jsonb, NULL, 7, 7
    ) IS NULL;
  message := 'Grade vazia/metadados de material comum permanece escalar.';
  RETURN NEXT;

  case_name := 'purchase_digest_human_state';
  ok := position('source_pv_ids' IN v_digest) > 0
    AND position('linked_sale_order_ids' IN v_digest) > 0
    AND position('approval_preflight_token' IN v_digest) > 0
    AND position('approval_preflight_by' IN v_digest) > 0
    AND position('approval_preflight_actor_name' IN v_digest) > 0
    AND position('approval_preflight_at' IN v_digest) > 0
    AND position('approval_preflight_revision' IN v_digest) > 0
    AND position('approval_preflight_digest' IN v_digest) > 0;
  message := 'Vínculos e todos os campos de preflight participam do digest.';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.run_sale_order_purchase_channel_contract_tests()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.run_sale_order_purchase_channel_contract_tests()
  TO service_role;

COMMIT;
