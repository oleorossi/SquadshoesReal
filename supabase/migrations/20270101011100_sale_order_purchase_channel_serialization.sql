-- Serializa os dois canais de compra por PV e fecha a grade da sugestão
-- automática sobre a falta real por numeração.
--
-- 110 criou o comando atômico manual. 109 criou a contribuição versionada da
-- outbox. As duas transações eram individualmente idempotentes, mas usavam
-- advisory locks diferentes e podiam observar simultaneamente "nenhuma OC".
-- Esta migration transforma a implementação 110 em função interna e mantém a
-- assinatura pública num wrapper que toma, em ordem, os mesmos locks da 109.

BEGIN;

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

  SELECT array_agg(x.pv_id ORDER BY x.pv_id)
    INTO v_pv_ids
    FROM (
      SELECT DISTINCT u.pv_id
        FROM unnest(p_pv_ids) AS u(pv_id)
    ) x;

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
    EXECUTE v_definition;
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_after;
  IF position('public.compute_materials_per_pv(ARRAY[p_sale_order_id])' IN v_after) > 0
     OR position('public.compute_per_pv_purchase_needs(ARRAY[p_sale_order_id])' IN v_after) = 0
     OR position('sale_order_outbox_safe_shortage_grade' IN v_after) = 0
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
  v_scaled jsonb;
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

  case_name := 'single_purchase_channel_lock';
  ok := position('sale-order-purchase-shortages:' IN v_wrapper) > 0
    AND position('ORDER BY u.pv_id' IN v_wrapper) > 0
    AND position('create_per_pv_purchase_orders_atomic_internal' IN v_wrapper) > 0
    AND NOT has_function_privilege(
      'authenticated',
      'public.create_per_pv_purchase_orders_atomic_internal(uuid[],jsonb,uuid,boolean)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'public.create_per_pv_purchase_orders_atomic_internal(uuid[],jsonb,uuid,boolean)',
      'EXECUTE'
    );
  message := 'Manual e outbox serializam por PV; implementação sem bypass direto.';
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
