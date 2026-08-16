-- =============================================================================
-- Tiras artesanais: motor transacional, fila, netting, execucao e financeiro
-- Depende de 20270101003000 (catalogo) e 20270101003100 (esquema operacional).
-- =============================================================================

-- Shim deploy-safe: 03000 ja pode estar aplicada em ambientes existentes sem
-- o contrato Req25. O motor abaixo referencia este helper; 03400 o reaplica
-- como hardening pos-deploy junto dos demais guards cadastrais.
CREATE OR REPLACE FUNCTION public.resolve_artisanal_strap_source_availability(
  p_variant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_finished public.products%ROWTYPE;
  v_official public.base_material_color_official_products%ROWTYPE;
  v_base public.products%ROWTYPE;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_measure_active boolean := false;
  v_color_active boolean := false;
  v_finished_allowed boolean := false;
  v_internal_allowed boolean := false;
  v_buy_allowed boolean := false;
  v_base_width_mm numeric;
  v_internal_reason text;
  v_buy_reason text;
BEGIN
  SELECT * INTO v_variant
    FROM public.artisanal_strap_variants
   WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante de tira inexistente'; END IF;

  SELECT * INTO v_finished FROM public.products WHERE id = v_variant.finished_product_id;
  SELECT EXISTS (
    SELECT 1
      FROM public.artisanal_strap_measures m
      JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
     WHERE m.id = v_variant.measure_id AND m.active AND t.active
  ) INTO v_measure_active;
  SELECT EXISTS (
    SELECT 1 FROM public.canonical_colors c
     WHERE c.id = v_variant.color_id AND c.active
  ) INTO v_color_active;

  SELECT * INTO v_official
    FROM public.base_material_color_official_products op
   WHERE op.base_group_id = v_variant.base_group_id
     AND op.color_id = v_variant.color_id
     AND op.status = 'active';
  IF v_official.id IS NOT NULL THEN
    SELECT * INTO v_base FROM public.products WHERE id = v_official.official_product_id;
    v_base_width_mm := public.strap_material_product_width_mm(v_official.official_product_id);
  END IF;
  SELECT * INTO v_recipe
    FROM public.artisanal_strap_recipes r
   WHERE r.measure_id = v_variant.measure_id
     AND r.base_group_id = v_variant.base_group_id
     AND r.status = 'approved'
     AND r.valid_from <= now()
     AND (r.valid_to IS NULL OR r.valid_to > now());

  v_finished_allowed := v_variant.status = 'active'
    AND v_finished.id IS NOT NULL AND v_finished.active AND v_finished.unit = 'm';
  v_internal_allowed := v_finished_allowed
    AND v_measure_active AND v_color_active
    AND v_official.id IS NOT NULL
    AND v_base.id IS NOT NULL AND v_base.active
    AND v_base.group_id IS NOT DISTINCT FROM v_variant.base_group_id
    AND v_base_width_mm IS NOT NULL
    AND v_recipe.id IS NOT NULL
    AND abs(v_base_width_mm - v_recipe.usable_base_width_mm_snapshot) <= 0.000001;
  v_buy_allowed := v_finished_allowed
    AND v_variant.purchase_enabled
    AND coalesce(v_finished.purchase_price > 0, false)
    AND nullif(btrim(coalesce(v_finished.purchase_unit, '')), '') IS NOT NULL
    AND coalesce(v_finished.conversion_rate > 0, false)
    AND (v_finished.purchase_unit <> v_finished.unit OR v_finished.conversion_rate = 1)
    AND coalesce(v_finished.min_order_quantity > 0, false)
    AND coalesce(v_finished.purchase_multiple > 0, false)
    AND coalesce(v_finished.material_preparation_days >= 0, false);

  v_internal_reason := CASE
    WHEN v_variant.status <> 'active' THEN 'variant_administratively_blocked'
    WHEN NOT v_finished_allowed THEN 'finished_product_inactive_or_invalid'
    WHEN NOT v_measure_active THEN 'type_or_measure_inactive'
    WHEN NOT v_color_active THEN 'canonical_color_discontinued'
    WHEN v_official.id IS NULL OR v_base.id IS NULL OR NOT coalesce(v_base.active, false)
      THEN 'official_base_color_discontinued'
    WHEN v_recipe.id IS NULL THEN 'approved_current_recipe_missing'
    WHEN v_base_width_mm IS NULL
      OR abs(v_base_width_mm - v_recipe.usable_base_width_mm_snapshot) > 0.000001
      THEN 'official_base_width_invalid'
    ELSE NULL END;
  v_buy_reason := CASE
    WHEN v_variant.status <> 'active' THEN 'variant_administratively_blocked'
    WHEN NOT v_finished_allowed THEN 'finished_product_inactive_or_invalid'
    WHEN NOT v_variant.purchase_enabled THEN 'buy_ready_not_enabled'
    WHEN NOT v_buy_allowed THEN 'commercial_data_inactive_or_invalid'
    ELSE NULL END;

  RETURN jsonb_build_object(
    'variant_status', v_variant.status,
    'administratively_active', v_variant.status = 'active',
    'finished_stock_consumption_allowed', v_finished_allowed,
    'finished_available_m', CASE WHEN v_finished_allowed THEN
      greatest(coalesce(v_finished.quantity, 0) - coalesce(v_finished.reserved_stock, 0), 0)
      ELSE 0 END,
    'internal_production_allowed', v_internal_allowed,
    'buy_ready_purchase_allowed', v_buy_allowed,
    'internal_block_reason', v_internal_reason,
    'buy_ready_block_reason', v_buy_reason,
    'base_product_id', v_official.official_product_id,
    'recipe_id', v_recipe.id
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Helpers puros: hash, metragem, calendario e custo/estoque disponivel
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.strap_payload_hash(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT encode(
    digest(convert_to(coalesce(p_payload, 'null'::jsonb)::text,'UTF8'),'sha256'),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION public.calculate_strap_line_required_m(
  p_line jsonb,
  p_order_quantity numeric,
  p_order_grade jsonb DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v_per_size jsonb := p_line -> 'consumption_per_size';
  v_default_cm numeric := coalesce(nullif(p_line ->> 'consumption', '')::numeric, 0);
  v_total_cm numeric := 0;
  v_grade_total numeric := 0;
  v_scale numeric := 1;
  v_size text;
  v_pairs numeric;
BEGIN
  IF coalesce(p_order_quantity, 0) <= 0 THEN RETURN 0; END IF;
  IF v_default_cm < 0 THEN RETURN 0; END IF;

  IF jsonb_typeof(v_per_size) = 'object' AND jsonb_typeof(p_order_grade) = 'object' THEN
    FOR v_size, v_pairs IN
      SELECT key, value::numeric FROM jsonb_each_text(p_order_grade)
      WHERE value::numeric > 0
    LOOP
      v_total_cm := v_total_cm + v_pairs * coalesce(nullif(v_per_size ->> v_size, '')::numeric, v_default_cm);
      v_grade_total := v_grade_total + v_pairs;
    END LOOP;
    IF v_grade_total > 0 THEN
      -- A quantidade do PV pode representar uma fracao exata da grade-base.
      -- Arredondar para uma "ficha" inteira superestima pedidos parciais.
      v_scale := p_order_quantity / v_grade_total;
      RETURN (v_total_cm * v_scale) / 100;
    END IF;
  END IF;
  RETURN (v_default_cm * p_order_quantity) / 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_strap_payment_terms(p_text text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v_days integer[]; v_count integer; v_each numeric; v_result jsonb:='[]'::jsonb;
  v_day integer; v_previous integer:=-1; v_idx integer:=0; v_pct numeric;
BEGIN
  IF btrim(coalesce(p_text,'')) !~ '^\d+(\s*[/,;-]\s*\d+)*$' THEN RETURN NULL; END IF;
  SELECT array_agg((m)[1]::integer) INTO v_days
    FROM regexp_matches(coalesce(p_text,''),'([0-9]+)','g') m;
  v_count:=coalesce(cardinality(v_days),0);
  IF v_count=0 THEN RETURN NULL; END IF;
  v_each:=round(100::numeric/v_count,8);
  FOREACH v_day IN ARRAY v_days LOOP
    v_idx:=v_idx+1;
    IF v_day<0 OR v_day<=v_previous THEN RETURN NULL; END IF;
    v_pct:=CASE WHEN v_idx=v_count THEN 100-v_each*(v_count-1) ELSE v_each END;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('days',v_day,'percentage',v_pct));
    v_previous:=v_day;
  END LOOP;
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_strap_payment_terms(p_terms jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v_item jsonb; v_total numeric:=0; v_day integer; v_previous integer:=-1; v_count integer:=0;
BEGIN
  IF jsonb_typeof(p_terms)<>'array' OR jsonb_array_length(p_terms)=0 THEN RETURN false; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_terms) LOOP
    v_count:=v_count+1;
    IF jsonb_typeof(v_item)<>'object' OR NOT (v_item?'days') OR NOT (v_item?'percentage') THEN RETURN false; END IF;
    v_day:=(v_item->>'days')::integer;
    IF v_day<0 OR v_day<=v_previous OR (v_item->>'percentage')::numeric<=0 THEN RETURN false; END IF;
    v_total:=v_total+(v_item->>'percentage')::numeric;
    v_previous:=v_day;
  END LOOP;
  RETURN v_count>0 AND abs(v_total-100)<=0.000001;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_strap_payment_installments(
  p_terms jsonb,p_base_date date,p_total numeric
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v_item jsonb; v_result jsonb:='[]'::jsonb; v_count integer; v_idx integer:=0;
  v_allocated numeric:=0; v_amount numeric;
BEGIN
  IF NOT public.is_valid_strap_payment_terms(p_terms) OR p_base_date IS NULL OR coalesce(p_total,0)<0 THEN
    RETURN NULL;
  END IF;
  v_count:=jsonb_array_length(p_terms);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_terms) LOOP
    v_idx:=v_idx+1;
    v_amount:=CASE WHEN v_idx=v_count THEN round(p_total-v_allocated,2)
      ELSE round(p_total*(v_item->>'percentage')::numeric/100,2) END;
    v_allocated:=v_allocated+v_amount;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'installment_number',v_idx,'days',(v_item->>'days')::integer,
      'percentage',(v_item->>'percentage')::numeric,
      'due_date',p_base_date+(v_item->>'days')::integer,'amount',v_amount));
  END LOOP;
  RETURN v_result;
END;
$$;

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_strap_payment_terms_valid_ck;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_strap_payment_terms_valid_ck CHECK (
    payment_terms_snapshot IS NULL OR public.is_valid_strap_payment_terms(payment_terms_snapshot));
ALTER TABLE public.purchase_demand_contributions
  ADD CONSTRAINT purchase_demand_contributions_payment_terms_valid_ck CHECK (
    payment_terms_snapshot IS NULL OR public.is_valid_strap_payment_terms(payment_terms_snapshot));
ALTER TABLE public.purchase_receipts
  ADD CONSTRAINT purchase_receipts_payment_terms_valid_ck CHECK (
    payment_terms_structured_snapshot IS NULL
    OR public.is_valid_strap_payment_terms(payment_terms_structured_snapshot));

UPDATE public.suppliers s SET payment_terms_structured=public.normalize_strap_payment_terms(s.payment_terms)
 WHERE s.payment_terms_structured IS NULL
   AND public.normalize_strap_payment_terms(s.payment_terms) IS NOT NULL;
ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_payment_terms_structured_valid_ck;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_payment_terms_structured_valid_ck CHECK (
    payment_terms_structured IS NULL
    OR public.is_valid_strap_payment_terms(payment_terms_structured));

CREATE OR REPLACE FUNCTION public.refresh_strap_purchase_cashflow_forecast(
  p_purchase_order_id uuid,p_correlation_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_po public.purchase_orders%ROWTYPE; v_item jsonb; v_count integer:=0;
  v_installments jsonb;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id=p_purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po.source_type<>'strap_demand' THEN RETURN 0; END IF;
  DELETE FROM public.strap_purchase_cashflow_installments
   WHERE purchase_order_id=v_po.id AND layer='forecast' AND purchase_receipt_id IS NULL;
  IF v_po.status NOT IN ('pending','Pendente') OR v_po.provisional
     OR NOT public.is_valid_strap_payment_terms(v_po.payment_terms_snapshot) THEN RETURN 0; END IF;
  v_installments:=public.build_strap_payment_installments(v_po.payment_terms_snapshot,
    coalesce(v_po.purchase_by_date,current_date),coalesce(v_po.total_value,0));
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_installments,'[]'::jsonb)) LOOP
    INSERT INTO public.strap_purchase_cashflow_installments(
      purchase_order_id,layer,installment_number,days_offset,percentage,due_date,
      original_amount,remaining_amount,status,correlation_id)
    VALUES(v_po.id,'forecast',(v_item->>'installment_number')::integer,
      (v_item->>'days')::integer,(v_item->>'percentage')::numeric,
      (v_item->>'due_date')::date,(v_item->>'amount')::numeric,
      (v_item->>'amount')::numeric,'open',p_correlation_id);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- -----------------------------------------------------------------------------
-- 14. Cutover nominal dos cinco caminhos legados de tira
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deprecated_strap_stock_noop(
  p_strap_colors jsonb,
  p_order_quantity integer,
  p_order_id uuid DEFAULT NULL,
  p_order_grade jsonb DEFAULT NULL,
  p_force_soft boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Intencionalmente vazio. Demanda/reserva/baixa de tira pertencem ao motor
  -- UUID-only desta migration; materiais nao-tira continuam nos callers.
  RETURN;
END;
$$;

-- Recompila todos os callers vivos conhecidos (incluindo os overloads de
-- promote/retry) trocando somente a chamada de tira pelo no-op. A logica de
-- OP, solado, embalagem e demais materiais permanece integralmente viva.
DO $$
DECLARE v_proc record; v_definition text;
BEGIN
  FOR v_proc IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind='f'
       AND p.proname NOT IN ('debit_strap_stock','deprecated_strap_stock_noop')
       -- Instalacoes antigas misturam chamadas qualificadas e nao
       -- qualificadas; comentarios tambem podem conservar o nome legado. O
       -- mesmo predicado amplo usado pela assertion final precisa dirigir a
       -- recompilacao, senao o deploy depende da versao intermediaria viva.
       AND p.prosrc LIKE '%debit_strap_stock%'
  LOOP
    v_definition:=replace(pg_get_functiondef(v_proc.oid),
      'public.debit_strap_stock','public.deprecated_strap_stock_noop');
    v_definition:=replace(v_definition,
      'debit_strap_stock','public.deprecated_strap_stock_noop');
    EXECUTE v_definition;
  END LOOP;
END;
$$;

-- Tombstone defensivo da assinatura final: mesmo um caller externo antigo que
-- sobreviva ao deploy nao movimenta estoque. Sem permissao RPC publica.
CREATE OR REPLACE FUNCTION public.debit_strap_stock(
  p_strap_colors jsonb,
  p_order_quantity integer,
  p_order_id uuid DEFAULT NULL,
  p_order_grade jsonb DEFAULT NULL,
  p_force_soft boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$ BEGIN RETURN; END; $$;

REVOKE ALL ON FUNCTION public.debit_strap_stock(jsonb,integer,uuid,jsonb,boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deprecated_strap_stock_noop(jsonb,integer,uuid,jsonb,boolean)
  FROM PUBLIC, anon, authenticated;

-- O canal manual "Compras por Pedido" continua listando todos os materiais
-- comuns. Tira pronta e napa de transformacao ficam integralmente fora desta
-- RPC: o worker 032 e suas contribuicoes pre_netted sao o unico canal. A
-- assinatura permanece identica para os consumidores existentes.
CREATE OR REPLACE FUNCTION public.compute_materials_per_pv(p_pv_ids uuid[])
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
  conversion_warning text
)
LANGUAGE sql
SET search_path TO 'public', 'extensions'
AS $function$
  WITH item_cons AS (
    SELECT soi.grade AS item_grade,
      coalesce(public.filter_caixa_by_packaging_mode(
        public.calculate_order_consumption_by_grade(
          soi.reference_id,
          public.scale_grade_to_total(soi.grade,soi.quantity),
          coalesce(soi.color,''),
          soi.material_variant_id
        ),so.packaging_mode),'[]'::jsonb) AS cons
    FROM public.sale_orders so
    JOIN public.sale_order_items soi ON soi.sale_order_id=so.id
    WHERE soi.sale_order_id=ANY(p_pv_ids)
      AND soi.reference_id IS NOT NULL
      AND soi.grade IS NOT NULL
      AND jsonb_typeof(soi.grade)='object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(soi.grade) g
         WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND g.value::numeric>0
      )
      AND (
        so.status NOT IN ('Faturado','Cancelado','Finalizado s/ NF')
        OR EXISTS (
          SELECT 1 FROM public.orders o
           WHERE o.sale_order_item_id=soi.id
             AND o.status NOT IN ('Finalizado','Cancelada')
        )
      )
  ),
  -- O consumo por grade nao emite a parcela especializada de tira. Esta
  -- fronteira estrutural preserva cabedal/forracao/palmilha/solado/BOM sem
  -- classificar tira por nome, cor, grupo ou products.is_artisanal.
  exploded AS (
    SELECT
      (line->>'product_id')::uuid AS product_id,
      line->>'product_name' AS product_name,
      CASE WHEN line->>'matched_by'='group_generic' THEN ''
           ELSE coalesce(line->>'color','') END AS color,
      (line->>'required')::numeric AS required,
      line->>'unit' AS unit,
      line->>'component' AS component,
      line->>'matched_by' AS matched_by,
      line->>'conversion_warning' AS conversion_warning,
      ic.item_grade
    FROM item_cons ic, jsonb_array_elements(ic.cons) AS line
    WHERE line->>'product_id' IS NOT NULL
  ),
  agg AS (
    SELECT e.product_id,e.color,max(e.product_name) AS product_name,
      coalesce(sum(e.required) FILTER (
        WHERE e.unit IS NULL AND e.conversion_warning IS NULL),0)
        /greatest(coalesce((
          SELECT conv.dm2_per_unit
            FROM public.get_material_conversion_info(e.product_id) conv
           LIMIT 1
        ),1),1)
      +coalesce(sum(e.required) FILTER (
        WHERE e.unit IS NOT NULL AND e.conversion_warning IS NULL),0) AS needed_qty,
      max(e.conversion_warning) AS conversion_warning
    FROM exploded e
    GROUP BY e.product_id,e.color
  ),
  own_res AS (
    SELECT mr.product_id,
      sum(greatest(0,coalesce(mr.quantity_reserved,0)
        -coalesce(mr.quantity_consumed,0))) AS own_reserved
    FROM public.material_reservations mr
    JOIN public.orders o ON o.id=mr.order_id
    WHERE o.sale_order_id=ANY(p_pv_ids)
      AND mr.status IN ('reserved','partially_consumed')
      -- Reserva de tira acabada/base pertence ao netting 032 e nao pode ser
      -- devolvida ao estoque disponivel deste canal generico.
      AND mr.sale_order_strap_demand_id IS NULL
      AND mr.strap_stock_floor_contribution_id IS NULL
    GROUP BY mr.product_id
  ),
  mism AS (
    SELECT product_id,color,bool_or(matched_by='color_mismatch') AS color_mismatch
      FROM exploded GROUP BY product_id,color
  ),
  solado_grade AS (
    SELECT product_id,color,jsonb_object_agg(k,v) AS grade FROM (
      SELECT e.product_id,e.color,kv.key AS k,
        round(sum(kv.value::numeric*e.required/nullif(gs.total,0))) AS v
      FROM exploded e
      CROSS JOIN LATERAL (
        SELECT sum(x.value::numeric) AS total
          FROM jsonb_each_text(e.item_grade) x WHERE x.key ~ '^[0-9/]+$'
      ) gs,
      jsonb_each_text(e.item_grade) kv
      WHERE e.component='Solado' AND e.item_grade IS NOT NULL
        AND kv.key ~ '^[0-9/]+$' AND coalesce(gs.total,0)>0
      GROUP BY e.product_id,e.color,kv.key
    ) g WHERE v>0 GROUP BY product_id,color
  )
  SELECT
    a.product_id AS material_id,
    coalesce(p.name,a.product_id::text) AS product_name,
    coalesce(p.unit,'un') AS unit,
    a.color,
    a.needed_qty,
    greatest(0,p.quantity-coalesce(p.reserved_stock,0)
      +coalesce(orr.own_reserved,0)) AS stock_qty,
    greatest(0,a.needed_qty-greatest(0,p.quantity
      -coalesce(p.reserved_stock,0)+coalesce(orr.own_reserved,0))) AS shortage,
    p.supplier_id,
    sup.name AS supplier_name,
    coalesce(p.unit_price,0) AS last_unit_price,
    coalesce(p.is_artisanal,false) AS is_artisanal,
    sg.grade,
    coalesce(m.color_mismatch,false) AS color_mismatch,
    a.conversion_warning
  FROM agg a
  LEFT JOIN public.products p ON p.id=a.product_id
  LEFT JOIN public.suppliers sup ON sup.id=p.supplier_id
  LEFT JOIN own_res orr ON orr.product_id=a.product_id
  LEFT JOIN solado_grade sg ON sg.product_id=a.product_id AND sg.color=a.color
  LEFT JOIN mism m ON m.product_id=a.product_id AND m.color=a.color
  WHERE a.needed_qty>0 OR a.conversion_warning IS NOT NULL
  ORDER BY sup.name NULLS LAST,coalesce(p.name,a.product_id::text);
$function$;

COMMENT ON FUNCTION public.compute_materials_per_pv(uuid[]) IS
  'Canal generico Compras por Pedido: somente exploded nao-tira. Tira pronta e '
  'napa de transformacao pertencem exclusivamente ao worker canonico 032 e as '
  'contribuicoes pre_netted; assinatura legada preservada para consumidores.';

DO $$
DECLARE v_oid oid; v_definition text;
BEGIN
  SELECT p.oid,lower(pg_get_functiondef(p.oid)) INTO v_oid,v_definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='compute_materials_per_pv'
     AND pg_get_function_identity_arguments(p.oid)='p_pv_ids uuid[]';
  IF v_oid IS NULL
     OR position('exploded as (' IN v_definition)=0
     OR position('calculate_order_consumption_by_grade' IN v_definition)=0
     OR position('from agg a' IN v_definition)=0
     OR position('mr.sale_order_strap_demand_id is null' IN v_definition)=0
     OR position('mr.strap_stock_floor_contribution_id is null' IN v_definition)=0
     OR position('strap_lines as (' IN v_definition)>0
     OR position('resolve_strap_stock_lines' IN v_definition)>0
     OR position('order_strap_needs' IN v_definition)>0
     OR position('component=''tira''' IN replace(v_definition,' ',''))>0 THEN
    RAISE EXCEPTION 'Req5/52/54: compute_materials_per_pv ainda duplica o motor canonico de tiras';
  END IF;
END;
$$;

-- A cascata legada nao pode cancelar uma OS consolidada do motor de tiras.
-- O worker supersede apenas a contribuicao do PV cancelado.
CREATE OR REPLACE FUNCTION public.tg_cancel_service_orders_on_pv_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_finalized constant text[]:=ARRAY['received','Concluido','Concluído','finalizado','Finalizado'];
BEGIN
  IF lower(btrim(coalesce(NEW.status,''))) IN ('cancelado','cancelada','cancelled') THEN
    UPDATE public.service_orders so SET status='Cancelado',updated_at=now()
     WHERE so.source_sale_order_id=NEW.id AND so.status<>'Cancelado'
       AND NOT (so.status=ANY(v_finalized))
       AND NOT EXISTS (SELECT 1 FROM public.service_order_items soi
         WHERE soi.service_order_id=so.id AND soi.strap_variant_id IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;

-- Shortages do promotion engine nunca carregam tira para autoCreateMaterialPO.
DO $$
DECLARE v_oid oid; v_definition text;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='promote_sale_order_item'
     AND pg_get_function_identity_arguments(p.oid)=
       'p_item_id uuid, p_op_status text, p_notes text, p_planned_delivery date, p_is_ahead boolean, p_packaging_mode text';
  IF v_oid IS NOT NULL THEN
    v_definition:=pg_get_functiondef(v_oid);
    v_definition:=regexp_replace(v_definition,
      'v_effective,[[:space:]]*v_item\\.strap_colors,[[:space:]]*p_packaging_mode',
      'v_effective, NULL::jsonb, p_packaging_mode','g');
    EXECUTE v_definition;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname NOT IN ('debit_strap_stock','deprecated_strap_stock_noop')
       AND p.prosrc LIKE '%debit_strap_stock%'
  ) THEN RAISE EXCEPTION 'Cutover incompleto: caller vivo de baixa legada de tira'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='compute_materials_per_pv'
       AND p.prosrc LIKE '%resolve_strap_stock_lines%'
  ) THEN RAISE EXCEPTION 'Cutover incompleto: compra por PV ainda inclui canal legado de tira'; END IF;
END;
$$;

CREATE TABLE public.strap_service_order_financial_snapshots (
  service_order_item_id uuid PRIMARY KEY REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  recipe_id uuid NOT NULL REFERENCES public.artisanal_strap_recipes(id) ON DELETE RESTRICT,
  recipe_version_snapshot integer NOT NULL,
  transformation_cost_per_m_snapshot numeric(24,9) NOT NULL,
  planned_m numeric(24,6) NOT NULL,
  total_value_snapshot numeric(24,9) GENERATED ALWAYS AS
    (planned_m*transformation_cost_per_m_snapshot) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_so_financial_snapshot_values_ck CHECK (
    recipe_version_snapshot>0 AND transformation_cost_per_m_snapshot>=0 AND planned_m>=0)
);
ALTER TABLE public.strap_service_order_financial_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY strap_so_financial_snapshot_select
  ON public.strap_service_order_financial_snapshots FOR SELECT TO authenticated
  USING ((SELECT public.can_see_strap_financial_values()));
GRANT SELECT ON public.strap_service_order_financial_snapshots TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.strap_service_order_financial_snapshots FROM authenticated;

-- Snapshot financeiro imutavel do recebimento. O fato operacional continua
-- sem custo (visivel a Producao), enquanto custo efetivo integral da napa fica
-- protegido pelo gate financeiro mesmo quando a baixa fisica vira pendencia.
CREATE TABLE public.strap_production_receipt_financial_snapshots (
  production_receipt_id uuid PRIMARY KEY
    REFERENCES public.strap_production_receipts(id) ON DELETE RESTRICT,
  base_consumed_m_snapshot numeric(24,9) NOT NULL,
  approved_m_snapshot numeric(24,6) NOT NULL,
  rejected_m_snapshot numeric(24,6) NOT NULL,
  base_unit_cost_snapshot numeric(24,9) NOT NULL,
  transformation_cost_per_m_snapshot numeric(24,9) NOT NULL,
  base_consumed_cost_snapshot numeric(24,9) GENERATED ALWAYS AS
    (base_consumed_m_snapshot*base_unit_cost_snapshot) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_production_receipt_financial_values_ck CHECK (
    base_consumed_m_snapshot>=0 AND approved_m_snapshot>=0
    AND rejected_m_snapshot>=0 AND base_unit_cost_snapshot>=0
    AND transformation_cost_per_m_snapshot>=0)
);
ALTER TABLE public.strap_production_receipt_financial_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY strap_production_receipt_financial_select
  ON public.strap_production_receipt_financial_snapshots FOR SELECT TO authenticated
  USING ((SELECT public.can_see_strap_financial_values()));
GRANT SELECT ON public.strap_production_receipt_financial_snapshots TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE
  ON public.strap_production_receipt_financial_snapshots FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_guard_strap_production_receipt_financial_fact
  BEFORE UPDATE OR DELETE ON public.strap_production_receipt_financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_immutable_fact();

-- -----------------------------------------------------------------------------
-- 13. Leituras seguras de claims, ciclos, rendimento real e variacao de custo
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_strap_contractor_loss_claims_operational
WITH (security_invoker = false)
AS
SELECT
  cl.id AS claim_id,
  cl.service_order_id,
  cl.service_order_item_id,
  so.order_number AS service_order_number,
  so.contractor_id,
  ct.name AS contractor_name,
  cl.base_product_id,
  p.name AS base_product_name,
  cl.lost_quantity,
  cl.responsible_party,
  cl.status,
  cl.reason,
  cl.evidence,
  cl.applied_cycle_id,
  CASE WHEN public.can_see_strap_financial_values() THEN cl.base_unit_cost_snapshot ELSE NULL END AS base_unit_cost_snapshot,
  CASE WHEN public.can_see_strap_financial_values() THEN cl.claim_amount ELSE NULL END AS claim_amount,
  cl.approved_by,
  cl.approved_at,
  cl.rejected_by,
  cl.rejected_at,
  cl.correlation_id,
  cl.created_at
FROM public.contractor_loss_claims cl
JOIN public.service_orders so ON so.id=cl.service_order_id
JOIN public.contractors ct ON ct.id=so.contractor_id
JOIN public.products p ON p.id=cl.base_product_id
WHERE public.is_approved_user();

CREATE OR REPLACE VIEW public.v_strap_contractor_payment_cycles_operational
WITH (security_invoker = false)
AS
SELECT
  cy.id AS cycle_id,
  cy.contractor_id,
  ct.name AS contractor_name,
  cy.schedule_version_id,
  cy.cycle_start,
  cy.cycle_end,
  cy.payment_date,
  cy.status,
  coalesce(a.accrual_count,0) AS accrual_count,
  coalesce(a.accepted_m,0) AS accepted_m,
  coalesce(e.discount_count,0) AS discount_count,
  CASE WHEN public.can_see_strap_financial_values() THEN cy.gross_amount ELSE NULL END AS gross_amount,
  CASE WHEN public.can_see_strap_financial_values() THEN cy.discount_amount ELSE NULL END AS discount_amount,
  CASE WHEN public.can_see_strap_financial_values() THEN cy.carried_credit_in ELSE NULL END AS carried_credit_in,
  CASE WHEN public.can_see_strap_financial_values() THEN cy.carried_credit_out ELSE NULL END AS carried_credit_out,
  CASE WHEN public.can_see_strap_financial_values() THEN cy.net_amount ELSE NULL END AS net_amount,
  CASE WHEN public.can_see_strap_financial_values() THEN cy.accounts_payable_id ELSE NULL END AS accounts_payable_id,
  cy.closed_at,
  cy.created_at,
  cy.updated_at
FROM public.contractor_payment_cycles cy
JOIN public.contractors ct ON ct.id=cy.contractor_id
LEFT JOIN LATERAL (SELECT count(*)::integer AS accrual_count,
  coalesce(sum(x.accepted_m),0) AS accepted_m
  FROM public.contractor_accruals x WHERE x.payment_cycle_id=cy.id) a ON true
LEFT JOIN LATERAL (SELECT count(*)::integer AS discount_count
  FROM public.contractor_payment_cycle_entries x
  WHERE x.payment_cycle_id=cy.id AND x.contractor_loss_claim_id IS NOT NULL) e ON true
WHERE public.is_approved_user();

CREATE OR REPLACE VIEW public.v_strap_real_yield_history
WITH (security_invoker = true)
AS
SELECT
  r.strap_variant_id,
  r.recipe_id,
  r.finished_product_id,
  fp.name AS finished_product_name,
  r.base_product_id,
  bp.name AS base_product_name,
  bi.recipe_version_snapshot,
  b.executor_type,
  b.contractor_id,
  sum(r.approved_m) AS approved_m,
  sum(r.rejected_m) AS rejected_m,
  sum(r.base_consumed_m) AS base_consumed_m,
  CASE WHEN sum(r.base_consumed_m)>0 THEN sum(r.approved_m)/sum(r.base_consumed_m) ELSE NULL END AS actual_yield_m_per_m,
  bi.confirmed_yield_snapshot,
  CASE WHEN sum(r.base_consumed_m)>0 AND bi.confirmed_yield_snapshot>0 THEN
    ((sum(r.approved_m)/sum(r.base_consumed_m))-bi.confirmed_yield_snapshot)
      /bi.confirmed_yield_snapshot*100 ELSE NULL END AS yield_deviation_pct,
  min(r.occurred_at) AS first_receipt_at,
  max(r.occurred_at) AS last_receipt_at,
  count(*) AS receipt_count
FROM public.strap_production_receipts r
JOIN public.strap_production_batch_items bi ON bi.id=coalesce(r.batch_item_id,
  (SELECT soi.strap_batch_item_id FROM public.service_order_items soi WHERE soi.id=r.service_order_item_id))
JOIN public.strap_production_batches b ON b.id=bi.batch_id
JOIN public.products fp ON fp.id=r.finished_product_id
JOIN public.products bp ON bp.id=r.base_product_id
GROUP BY r.strap_variant_id,r.recipe_id,r.finished_product_id,fp.id,r.base_product_id,bp.id,
  bi.recipe_version_snapshot,b.executor_type,b.contractor_id,bi.confirmed_yield_snapshot;

CREATE OR REPLACE VIEW public.v_strap_cost_variance_operational
WITH (security_invoker = false)
AS
WITH claims_by_receipt AS (
  SELECT cl.production_receipt_id,sum(cl.claim_amount) AS recovered_cost
  FROM public.contractor_loss_claims cl
  WHERE cl.production_receipt_id IS NOT NULL
    AND cl.responsible_party='contractor' AND cl.status IN ('approved','applied')
  GROUP BY cl.production_receipt_id
), receipt_origin_weights AS (
  -- Terceiro tem linha de OS por contribuicao: a origem e exata inclusive
  -- quando o recebimento foi 100% rejeitado e nao gerou allocation aprovada.
  SELECT r.id AS production_receipt_id,h.id AS sale_order_strap_demand_id,
    1::numeric AS origin_weight
  FROM public.strap_production_receipts r
  JOIN public.service_order_items soi ON soi.id=r.service_order_item_id
  JOIN public.sale_order_strap_demands h ON h.id=soi.sale_order_strap_demand_id
  WHERE r.service_order_item_id IS NOT NULL
  UNION ALL
  -- Na fabrica o item pode consolidar varias contribuicoes. Para a parcela
  -- rejeitada sem output, distribui o custo pelo plano que existia quando o
  -- fato foi registrado; piso participa do denominador e nao e atribuido a PV.
  SELECT r.id,w.sale_order_strap_demand_id,w.origin_weight
  FROM public.strap_production_receipts r
  JOIN LATERAL (
    SELECT c.sale_order_strap_demand_id,
      c.planned_m/nullif(sum(c.planned_m) OVER (),0) AS origin_weight
    FROM public.strap_production_batch_contributions c
    WHERE c.batch_item_id=r.batch_item_id AND c.planned_m>0
      AND c.created_at<=r.created_at
  ) w ON true
  WHERE r.service_order_item_id IS NULL
), internal_realized AS (
  SELECT c.sale_order_strap_demand_id,
    sum(a.approved_m) AS realized_m,
    sum(a.approved_m*(
      coalesce(fs.base_consumed_cost_snapshot/nullif(r.delivered_m,0),0)
      +fs.transformation_cost_per_m_snapshot)) AS realized_cost
  FROM public.strap_production_receipt_allocations a
  JOIN public.strap_production_batch_contributions c ON c.id=a.batch_contribution_id
  JOIN public.strap_production_receipts r ON r.id=a.production_receipt_id
  JOIN public.strap_production_receipt_financial_snapshots fs
    ON fs.production_receipt_id=r.id
  WHERE c.sale_order_strap_demand_id IS NOT NULL
  GROUP BY c.sale_order_strap_demand_id
), purchase_realized AS (
  SELECT c.sale_order_strap_demand_id,
    sum(a.accepted_stock_quantity) AS realized_m,
    sum(a.accepted_stock_quantity*pri.effective_unit_cost_stock) AS realized_cost
  FROM public.purchase_receipt_allocations a
  JOIN public.purchase_demand_contributions c
    ON c.id=a.purchase_demand_contribution_id
  JOIN public.purchase_receipt_items pri ON pri.id=a.purchase_receipt_item_id
  WHERE c.sale_order_strap_demand_id IS NOT NULL
    AND a.accepted_stock_quantity>0
  GROUP BY c.sale_order_strap_demand_id
), rejected_cost_by_demand AS (
  SELECT w.sale_order_strap_demand_id,
    sum(greatest(0,fs.base_consumed_cost_snapshot*(r.rejected_m/nullif(r.delivered_m,0))
      -coalesce(cr.recovered_cost,0))*w.origin_weight) AS net_rejected_base_cost
  FROM public.strap_production_receipts r
  JOIN public.strap_production_receipt_financial_snapshots fs
    ON fs.production_receipt_id=r.id
  JOIN receipt_origin_weights w ON w.production_receipt_id=r.id
  LEFT JOIN claims_by_receipt cr ON cr.production_receipt_id=r.id
  WHERE r.rejected_m>0
  GROUP BY w.sale_order_strap_demand_id
), realized_rollup AS (
  SELECT x.sale_order_strap_demand_id,sum(x.realized_m) AS realized_m,
    sum(x.realized_cost)+coalesce(max(rc.net_rejected_base_cost),0) AS realized_cost
  FROM (
    SELECT sale_order_strap_demand_id,realized_m,realized_cost FROM internal_realized
    UNION ALL
    SELECT sale_order_strap_demand_id,realized_m,realized_cost FROM purchase_realized
  ) x
  LEFT JOIN rejected_cost_by_demand rc
    ON rc.sale_order_strap_demand_id=x.sale_order_strap_demand_id
  GROUP BY x.sale_order_strap_demand_id
), report_rows AS (
  SELECT d.*,coalesce(rr.realized_m,0) AS report_realized_m,
    coalesce(rr.realized_cost,0) AS report_realized_cost,
    CASE
      -- Fato realizado continua na demanda/revisao que o originou. Depois de
      -- override administrativo, a identidade nova reporta somente a falta que
      -- restou apos o netting global; estoque livre nao e custo realizado da
      -- origem nova e realizacao de outra variante nunca atravessa este join.
      WHEN NOT d.is_current THEN coalesce(rr.realized_m,0)
      WHEN d.calculation_explanation ? 'admin_source_override'
        THEN greatest(0,d.replenishment_required_m)
      ELSE d.gross_required_m
    END::numeric(24,6) AS report_planned_m
  FROM public.sale_order_strap_demands d
  LEFT JOIN realized_rollup rr ON rr.sale_order_strap_demand_id=d.id
  WHERE d.is_current OR coalesce(rr.realized_m,0)>0
)
SELECT
  d.id AS sale_order_strap_demand_id,
  d.sale_order_id,
  so.order_number,
  d.sale_order_item_id,
  d.strap_variant_id,
  d.source_mode,
  d.report_planned_m AS planned_m,
  d.report_realized_m AS realized_m,
  CASE WHEN public.can_see_strap_financial_values() THEN fs.planned_unit_cost ELSE NULL END AS planned_unit_cost,
  CASE WHEN public.can_see_strap_financial_values() AND d.report_realized_m>0
    THEN d.report_realized_cost/d.report_realized_m ELSE NULL END AS realized_unit_cost,
  CASE WHEN public.can_see_strap_financial_values() THEN fs.planned_unit_cost*d.report_planned_m ELSE NULL END AS planned_cost,
  CASE WHEN public.can_see_strap_financial_values() THEN d.report_realized_cost ELSE NULL END AS realized_cost,
  CASE WHEN public.can_see_strap_financial_values() THEN
    d.report_realized_cost-(fs.planned_unit_cost*d.report_planned_m) ELSE NULL END AS cost_variance,
  CASE
    WHEN d.report_realized_m=0 THEN 'Sem recebimento realizado nesta origem/revisao'
    WHEN d.report_realized_m<d.report_planned_m THEN 'Execucao parcial: ainda ha metragem sem custo realizado'
    WHEN d.report_realized_m>d.report_planned_m THEN 'Metragem efetiva acima da quantidade prevista'
    WHEN NOT public.can_see_strap_financial_values() THEN 'Execucao concluida; valores financeiros protegidos'
    WHEN fs.planned_unit_cost IS NULL THEN 'Snapshot de custo previsto indisponivel'
    WHEN abs((d.report_realized_cost/nullif(d.report_realized_m,0))-fs.planned_unit_cost)<=0.000001
      THEN 'Custo efetivo aderente ao snapshot do PV'
    WHEN (d.report_realized_cost/nullif(d.report_realized_m,0))>fs.planned_unit_cost
      THEN CASE WHEN d.source_mode='internal'
        THEN 'Custo efetivo interno acima do snapshot (napa, rendimento ou transformacao)'
        ELSE 'Preco efetivo da compra pronta acima do snapshot' END
    ELSE CASE WHEN d.source_mode='internal'
      THEN 'Custo efetivo interno abaixo do snapshot (napa, rendimento ou transformacao)'
      ELSE 'Preco efetivo da compra pronta abaixo do snapshot' END
  END AS variance_reason,
  d.status,
  d.correlation_id
FROM report_rows d
JOIN public.sale_orders so ON so.id=d.sale_order_id
LEFT JOIN public.strap_financial_snapshots fs ON fs.sale_order_strap_demand_id=d.id
WHERE public.is_approved_user();

DO $$
DECLARE v_definition text:=lower(pg_get_viewdef(
  'public.v_strap_cost_variance_operational'::regclass,true));
BEGIN
  -- pg_get_viewdef renomeia aliases repetidos (por exemplo, d -> d_1).
  -- Valide os vinculos estruturais e a semantica, nao o alias escolhido pelo
  -- deparser da versao de PostgreSQL do ambiente.
  IF position('sale_order_strap_demand_id' IN v_definition)=0
     OR position('purchase_demand_contribution_id' IN v_definition)=0
     OR position('batch_contribution_id' IN v_definition)=0
     OR position('admin_source_override' IN v_definition)=0
     OR v_definition !~ 'not [a-z_][a-z0-9_]*\.is_current'
     OR position('replenishment_required_m' IN v_definition)=0
     OR position('left join realized_rollup rr' IN v_definition)=0
     OR position('rr.realized_m' IN v_definition)=0 THEN
    RAISE EXCEPTION 'Req51/112/113: custo realizado perdeu a revisao/origem fisica antiga';
  END IF;
END;
$$;

GRANT SELECT ON public.v_strap_contractor_loss_claims_operational,
  public.v_strap_contractor_payment_cycles_operational,
  public.v_strap_real_yield_history,
  public.v_strap_cost_variance_operational TO authenticated;

CREATE OR REPLACE VIEW public.v_contractor_material_custody_balances
WITH (security_invoker = false)
AS
SELECT
  m.service_order_id,m.service_order_item_id,m.contractor_id,m.base_product_id,
  sum(CASE WHEN m.movement_type='sent' THEN m.quantity
           WHEN m.movement_type='adjusted' THEN m.quantity ELSE -m.quantity END)::numeric(24,9)
    AS balance_in_custody,
  max(m.occurred_at) AS last_movement_at
FROM public.contractor_material_custody_movements m
WHERE public.is_approved_user()
GROUP BY m.service_order_id,m.service_order_item_id,m.contractor_id,m.base_product_id;

-- Policies permissivas historicas das OCs gerais nao podem expor preco,
-- parcelas ou total da OC automatica. A operacao nao financeira continua pela
-- view SECURITY DEFINER redigida criada abaixo.
CREATE OR REPLACE FUNCTION public.is_canonical_strap_purchase_order(
  p_purchase_order_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.purchase_orders po
     WHERE po.id=p_purchase_order_id AND po.source_type='strap_demand'
  );
$$;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strap_purchase_orders_raw_financial_restrictive
  ON public.purchase_orders;
CREATE POLICY strap_purchase_orders_raw_financial_restrictive
  ON public.purchase_orders AS RESTRICTIVE FOR SELECT TO authenticated
  USING (source_type IS DISTINCT FROM 'strap_demand'
    OR (SELECT public.can_see_strap_financial_values()));
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strap_purchase_order_items_raw_financial_restrictive
  ON public.purchase_order_items;
CREATE POLICY strap_purchase_order_items_raw_financial_restrictive
  ON public.purchase_order_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT public.is_canonical_strap_purchase_order(purchase_order_id)
    OR (SELECT public.can_see_strap_financial_values()));

-- -----------------------------------------------------------------------------
-- 8. Documentos congelados e views seguras de OC/OS/picking
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('strap-purchase-orders', 'strap-purchase-orders', false, 20971520,
  ARRAY['application/pdf']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS strap_purchase_orders_pdf_read ON storage.objects;
CREATE POLICY strap_purchase_orders_pdf_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'strap-purchase-orders'
    AND public.is_approved_user()
    AND public.can_see_strap_financial_values());
DROP POLICY IF EXISTS strap_purchase_orders_pdf_insert ON storage.objects;
CREATE POLICY strap_purchase_orders_pdf_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'strap-purchase-orders'
    AND name ~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'
    AND lower(coalesce(user_metadata->>'sha256','')) =
      lower(substring(name from '/([0-9a-f]{64})\.pdf$'))
    AND public.user_has_any_role(ARRAY['admin']));
DROP POLICY IF EXISTS strap_purchase_orders_pdf_update ON storage.objects;
DROP POLICY IF EXISTS strap_purchase_orders_pdf_delete ON storage.objects;

-- O objeto aprovado e write-once: authenticated pode criar um path novo, mas
-- nunca substituir ou apagar o PDF congelado. Correcoes usam novo path/hash.

CREATE OR REPLACE FUNCTION public.get_strap_purchase_order_document(p_purchase_order_id uuid)
RETURNS TABLE(bucket_id text, storage_path text, sha256 text, snapshot_locked_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  IF NOT public.is_approved_user() OR NOT public.can_see_strap_financial_values() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN QUERY
  SELECT 'strap-purchase-orders'::text, po.pdf_storage_path, po.pdf_sha256,
         po.snapshot_locked_at
    FROM public.purchase_orders po
   WHERE po.id = p_purchase_order_id
     AND po.source_type = 'strap_demand'
     AND po.snapshot_locked_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'strap-purchase-orders' AND o.name = po.pdf_storage_path);
END;
$$;

CREATE OR REPLACE VIEW public.v_strap_purchase_order_items_operational
WITH (security_invoker = false)
AS
SELECT
  i.id AS purchase_order_item_id,
  po.id AS purchase_order_id,
  po.order_number,
  po.created_at AS purchase_order_created_at,
  po.notes AS purchase_order_notes,
  po.status AS purchase_order_status,
  po.approval_status,
  po.approved_by,
  po.approved_by_name_snapshot,
  po.approved_at,
  po.supplier_id,
  po.supplier_name,
  coalesce(po.supplier_snapshot->>'contact_name','') AS supplier_contact_name,
  coalesce(po.supplier_snapshot->>'phone','') AS supplier_phone,
  coalesce(po.supplier_snapshot->>'email','') AS supplier_email,
  coalesce(po.supplier_snapshot->>'address','') AS supplier_address,
  coalesce(po.supplier_snapshot->>'city','') AS supplier_city,
  coalesce(po.supplier_snapshot->>'state','') AS supplier_state,
  coalesce(po.supplier_snapshot->>'zip_code','') AS supplier_zip_code,
  po.delivery_company_snapshot,
  po.delivery_company_snapshot->>'razao_social' AS delivery_company_name,
  po.delivery_company_snapshot->>'logradouro' AS delivery_address,
  po.delivery_company_snapshot->>'numero' AS delivery_address_number,
  po.delivery_company_snapshot->>'complemento' AS delivery_address_complement,
  po.delivery_company_snapshot->>'bairro' AS delivery_neighborhood,
  po.delivery_company_snapshot->>'cidade' AS delivery_city,
  po.delivery_company_snapshot->>'uf' AS delivery_state,
  po.delivery_company_snapshot->>'cep' AS delivery_zip_code,
  po.billing_year,
  po.billing_month,
  po.billing_fortnight,
  po.provisional,
  CASE WHEN public.can_see_strap_financial_values()
    THEN po.payment_condition_snapshot ELSE NULL END AS payment_condition_snapshot,
  CASE WHEN public.can_see_strap_financial_values()
    THEN po.payment_terms_snapshot ELSE NULL END AS payment_terms_snapshot,
  po.commercial_revision,
  po.commercial_digest,
  po.purchase_by_date,
  po.promised_date,
  po.strap_manual_purchase_by_date,
  po.strap_manual_promised_date,
  po.strap_manual_adjustment_reason,
  po.strap_manual_adjusted_by,
  po.strap_manual_adjusted_at,
  po.snapshot_locked_at,
  po.suspension_reason,
  po.suspended_by,
  po.suspended_at,
  po.pdf_storage_path IS NOT NULL AS has_frozen_pdf,
  CASE WHEN greatest(0,i.quantity-coalesce(i.received_quantity,0))<=0 THEN 'Normal'
       WHEN current_date>po.promised_date THEN 'Urgente'
       WHEN current_date>po.purchase_by_date THEN 'Atrasada'
       ELSE 'Normal' END AS criticality,
  (SELECT j.status FROM public.strap_demand_jobs j
    WHERE j.source_type='purchase_order' AND j.source_id=po.id
    ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS latest_job_status,
  (SELECT j.last_error FROM public.strap_demand_jobs j
    WHERE j.source_type='purchase_order' AND j.source_id=po.id
    ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS latest_job_error,
  i.product_id,
  p.name AS product_name,
  p.sku AS product_sku,
  i.strap_variant_id,
  CASE WHEN bool_or(c.sale_order_strap_demand_id IS NOT NULL AND d.source_mode = 'buy_ready')
       THEN 'buy_ready' ELSE 'internal' END AS source_mode,
  i.quantity AS ordered_purchase_quantity,
  coalesce(i.received_quantity,0) AS received_purchase_quantity,
  CASE WHEN public.can_see_strap_financial_values() THEN i.unit_price ELSE NULL END AS unit_price,
  CASE WHEN public.can_see_strap_financial_values() THEN po.total_value ELSE NULL END AS total_value,
  i.unit,
  i.stock_unit_snapshot,
  i.purchase_unit_snapshot,
  i.conversion_rate_snapshot,
  i.min_order_quantity_snapshot,
  i.purchase_multiple_snapshot,
  i.needed_at,
  i.suggested_quantity AS calculated_purchase_quantity,
  i.strap_manual_quantity,
  i.strap_manual_needed_at,
  i.strap_manual_adjustment_reason AS item_manual_adjustment_reason,
  i.strap_manual_adjusted_by AS item_manual_adjusted_by,
  i.strap_manual_adjusted_at AS item_manual_adjusted_at,
  sum(c.required_quantity_stock_unit) AS required_stock_quantity,
  sum(c.committed_quantity_stock_unit) AS committed_stock_quantity,
  sum(c.accepted_quantity_stock_unit) AS accepted_stock_quantity,
  sum(c.rejected_quantity_stock_unit) AS rejected_stock_quantity,
  coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'origin_type', CASE WHEN c.sale_order_id IS NULL THEN 'stock_floor' ELSE 'sale_order' END,
    'sale_order_id', c.sale_order_id,
    'sale_order_item_id', c.sale_order_item_id,
    'strap_variant_id', c.strap_variant_id,
    'label', coalesce(so.order_number, 'Reposicao de estoque minimo'),
    'required_stock_quantity', c.required_quantity_stock_unit,
    'committed_stock_quantity', c.committed_quantity_stock_unit,
    'accepted_stock_quantity', c.accepted_quantity_stock_unit,
    'status', c.status
  ) ORDER BY c.needed_at, c.id) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS contributions
FROM public.purchase_order_items i
JOIN public.purchase_orders po ON po.id = i.purchase_order_id AND po.source_type = 'strap_demand'
JOIN public.products p ON p.id = i.product_id
LEFT JOIN public.purchase_demand_contributions c ON c.purchase_order_item_id = i.id
LEFT JOIN public.sale_order_strap_demands d ON d.id = c.sale_order_strap_demand_id
LEFT JOIN public.sale_orders so ON so.id = c.sale_order_id
WHERE public.is_approved_user()
GROUP BY i.id, po.id, p.id;

CREATE OR REPLACE VIEW public.v_strap_service_order_items_operational
WITH (security_invoker = false)
AS
SELECT
  soi.id AS service_order_item_id,
  so.id AS service_order_id,
  so.order_number AS service_order_number,
  so.status AS service_order_status,
  so.contractor_id,
  ct.name AS contractor_name,
  soi.strap_batch_item_id AS batch_item_id,
  bi.batch_id,
  bi.status AS batch_item_status,
  bi.started_at AS batch_item_started_at,
  b.status AS batch_status,
  b.started_at AS batch_started_at,
  soi.strap_variant_id,
  soi.strap_recipe_id AS recipe_id,
  soi.base_product_id,
  bp.name AS base_product_name,
  soi.finished_product_id,
  fp.name AS finished_product_name,
  soi.recipe_version_snapshot,
  soi.confirmed_yield_snapshot,
  CASE WHEN public.can_see_strap_financial_values()
    THEN sfs.transformation_cost_per_m_snapshot ELSE NULL END AS transformation_cost_per_m_snapshot,
  soi.meters AS planned_m,
  soi.meters/nullif(soi.confirmed_yield_snapshot,0) AS planned_base_m,
  b.deadline AS needed_at,
  coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'production_receipt_id',x.production_receipt_id,
      'document_number',x.document_number,
      'occurred_at',x.occurred_at,
      'delivered_m',x.delivered_m,
      'approved_m',x.approved_m,
      'rejected_m',x.rejected_m,
      'rejected_base_m',x.rejected_base_m,
      'claimed_base_m',x.claimed_base_m,
      'available_unclaimed_base_m',x.available_unclaimed_base_m
    ) ORDER BY x.occurred_at,x.production_receipt_id)
    FROM (
      SELECT r.id AS production_receipt_id,r.document_number,r.occurred_at,
        r.delivered_m,r.approved_m,r.rejected_m,
        r.base_consumed_m*r.rejected_m/nullif(r.delivered_m,0) AS rejected_base_m,
        coalesce(sum(cl.lost_quantity) FILTER (
          WHERE cl.status IN ('pending','approved','applied')),0) AS claimed_base_m,
        greatest(0,r.base_consumed_m*r.rejected_m/nullif(r.delivered_m,0)
          -coalesce(sum(cl.lost_quantity) FILTER (
            WHERE cl.status IN ('pending','approved','applied')),0)) AS available_unclaimed_base_m
      FROM public.strap_production_receipts r
      LEFT JOIN public.contractor_loss_claims cl ON cl.production_receipt_id=r.id
      WHERE r.service_order_item_id=soi.id AND r.rejected_m>0
      GROUP BY r.id
      HAVING greatest(0,r.base_consumed_m*r.rejected_m/nullif(r.delivered_m,0)
        -coalesce(sum(cl.lost_quantity) FILTER (
          WHERE cl.status IN ('pending','approved','applied')),0))>0
    ) x
  ),'[]'::jsonb) AS loss_receipt_candidates,
  coalesce(soi.delivered_qty,0) AS delivered_m,
  soi.line_status,
  soi.sent_at,
  soi.delivered_at,
  coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'contribution_id',c.id,
      'origin_type',CASE WHEN c.sale_order_strap_demand_id IS NULL THEN 'stock_floor' ELSE 'sale_order' END,
      'sale_order_strap_demand_id',c.sale_order_strap_demand_id,
      'stock_floor_contribution_id',c.stock_floor_contribution_id,
      'label',coalesce(pv_c.order_number,'Reposicao de estoque minimo'),
      'planned_m',c.planned_m,
      'delivered_m',c.delivered_m,
      'remaining_m',greatest(0,c.planned_m-c.delivered_m),
      'priority',c.priority,
      'status',c.status
    ) ORDER BY c.priority,c.created_at,c.id)
    FROM public.strap_production_batch_contributions c
    LEFT JOIN public.sale_order_strap_demands d_c ON d_c.id=c.sale_order_strap_demand_id
    LEFT JOIN public.sale_orders pv_c ON pv_c.id=d_c.sale_order_id
    WHERE c.service_order_item_id=soi.id
  ),'[]'::jsonb) AS contributions
FROM public.service_order_items soi
JOIN public.service_orders so ON so.id = soi.service_order_id
JOIN public.contractors ct ON ct.id = so.contractor_id
JOIN public.strap_production_batch_items bi ON bi.id = soi.strap_batch_item_id
JOIN public.strap_production_batches b ON b.id = bi.batch_id
LEFT JOIN public.strap_service_order_financial_snapshots sfs ON sfs.service_order_item_id=soi.id
LEFT JOIN public.products bp ON bp.id = soi.base_product_id
LEFT JOIN public.products fp ON fp.id = soi.finished_product_id
WHERE soi.strap_variant_id IS NOT NULL AND public.is_approved_user();

DO $$
DECLARE v_definition text:=lower(pg_get_viewdef(
  'public.v_strap_service_order_items_operational'::regclass,true));
BEGIN
  IF v_definition ~ 'bi\.planned_base_m'
     OR v_definition !~ 'soi\.meters[[:space:]]*/[[:space:]]*nullif\(soi\.confirmed_yield_snapshot'
     OR v_definition !~ '''contribution_id''' THEN
    RAISE EXCEPTION 'Contrato documental invalido: napa da OS deve ser calculada por linha, nao pelo lote consolidado';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW public.v_strap_picking_operational
WITH (security_invoker = false)
AS
SELECT
  d.id AS sale_order_strap_demand_id,
  d.sale_order_id,
  d.sale_order_item_id,
  d.technical_strap_line_id,
  d.strap_variant_id,
  d.recipe_id,
  d.base_product_id,
  bp.name AS base_product_name,
  d.finished_product_id,
  fp.name AS finished_product_name,
  cc.id AS color_id,
  cc.name AS color_name,
  d.source_mode,
  d.gross_required_m AS planned_finished_m,
  greatest(0,d.gross_required_m-d.fulfilled_m-d.cancelled_m) AS remaining_finished_m,
  d.finished_stock_reserved_m,
  d.base_required_m,
  d.base_reserved_m,
  coalesce(sum(r.quantity_consumed) FILTER (WHERE r.product_id=d.base_product_id),0) AS base_consumed_m,
  d.confirmed_yield_snapshot,
  d.status,
  d.target_week,
  d.correlation_id
FROM public.sale_order_strap_demands d
JOIN public.artisanal_strap_variants v ON v.id=d.strap_variant_id
JOIN public.canonical_colors cc ON cc.id=v.color_id
JOIN public.products fp ON fp.id=d.finished_product_id
LEFT JOIN public.products bp ON bp.id=d.base_product_id
LEFT JOIN public.material_reservations r ON r.sale_order_strap_demand_id=d.id
WHERE d.is_current AND public.is_approved_user()
GROUP BY d.id, bp.id, fp.id, cc.id;

CREATE OR REPLACE VIEW public.v_strap_purchase_order_notifications_operational
WITH (security_invoker = false)
AS
SELECT n.id,n.event_type,n.purchase_order_id,po.order_number,
  po.status AS purchase_order_status,n.previous_criticality,n.criticality,
  n.title,n.message,n.payload,n.correlation_id,n.created_at
FROM public.strap_operational_notifications n
JOIN public.purchase_orders po ON po.id=n.purchase_order_id
WHERE public.user_has_any_role(ARRAY['admin']);

GRANT SELECT ON public.v_strap_purchase_order_items_operational,
  public.v_strap_service_order_items_operational,
  public.v_strap_picking_operational,
  public.v_strap_purchase_order_notifications_operational TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_strap_purchase_order_document(uuid) TO authenticated;

COMMENT ON FUNCTION public.calculate_strap_line_required_m(jsonb, numeric, jsonb) IS
  'Metragem canonica por linha: escala fracionaria exata quantidade/grade, sem default inventado, sem arredondamento intermediario e sem perda.';

DO $$
BEGIN
  IF abs(public.calculate_strap_line_required_m(
      '{"consumption":150,"consumption_per_size":{"34":100,"35":200}}'::jsonb,
      1, '{"34":1,"35":1}'::jsonb
    ) - 1.5) > 0.000001 THEN
    RAISE EXCEPTION 'Regressao: grade parcial de tira deve usar escala fracionaria exata';
  END IF;
  IF public.calculate_strap_line_required_m('{}'::jsonb, 10, '{}'::jsonb) <> 0 THEN
    RAISE EXCEPTION 'Regressao: consumo ausente nao pode inventar 1 cm/par';
  END IF;
END;
$$;

-- Vincula a reserva de tira acabada a OP exata. A demanda nasce no PV; se a
-- OP ainda nao existir, o trigger de criacao faz o bind depois. A finalizacao
-- jamais baixa por nome/cor e continua usando o settlement canonico da OP.
CREATE OR REPLACE FUNCTION public.bind_strap_finished_reservations_to_order(
  p_order_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  UPDATE public.material_reservations r
     SET order_id=p_order_id,
         metadata=r.metadata||jsonb_build_object('bound_order_id',p_order_id)
    FROM public.sale_order_strap_demands d, public.orders o
   WHERE o.id=p_order_id
     AND o.sale_order_item_id=d.sale_order_item_id
     AND r.sale_order_strap_demand_id=d.id
     AND r.source='strap_engine_finished'
     AND r.order_id IS NULL
     AND r.status IN ('reserved','partially_consumed');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_bind_strap_finished_reservations_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NEW.sale_order_item_id IS NOT NULL THEN
    PERFORM public.bind_strap_finished_reservations_to_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bind_strap_finished_on_order_insert ON public.orders;
CREATE TRIGGER trg_bind_strap_finished_on_order_insert
  AFTER INSERT OR UPDATE OF sale_order_item_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_bind_strap_finished_reservations_to_order();

-- Nome deliberadamente anterior a trg_aa_settle_reservations_on_finalize.
DROP TRIGGER IF EXISTS trg_a_bind_strap_finished_before_finalize ON public.orders;
CREATE TRIGGER trg_a_bind_strap_finished_before_finalize
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.tg_bind_strap_finished_reservations_to_order();

-- O settlement legado insere o movimento antes de marcar a reserva consumida.
-- Esse trigger injeta a identidade UUID e o WAC no mesmo fato de estoque.
CREATE OR REPLACE FUNCTION public.tg_enrich_strap_finished_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_res public.material_reservations%ROWTYPE; v_source text; v_cost numeric;
BEGIN
  IF NEW.movement_type='out' AND NEW.order_id IS NOT NULL THEN
    NEW.strap_movement_event_id:=coalesce(NEW.strap_movement_event_id,gen_random_uuid());
    PERFORM set_config('app.strap_last_movement_event',NEW.strap_movement_event_id::text,true);
  END IF;
  IF NEW.material_reservation_id IS NULL OR NEW.movement_type<>'out' THEN RETURN NEW; END IF;
  SELECT r.* INTO v_res FROM public.material_reservations r
   WHERE r.id=NEW.material_reservation_id AND r.product_id=NEW.product_id
     AND r.order_id IS NOT DISTINCT FROM NEW.order_id
     AND r.source='strap_engine_finished';
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT d.source_mode,p.unit_price INTO v_source,v_cost
    FROM public.sale_order_strap_demands d
    JOIN public.products p ON p.id=v_res.product_id
   WHERE d.id=v_res.sale_order_strap_demand_id;
  NEW.strap_variant_id:=v_res.strap_variant_id;
  NEW.sale_order_strap_demand_id:=v_res.sale_order_strap_demand_id;
  NEW.finished_product_id:=v_res.finished_product_id;
  NEW.origin_type:=CASE WHEN v_source='buy_ready' THEN 'buy_ready' ELSE 'internal_factory' END;
  NEW.effective_unit_cost:=coalesce(v_cost,0);
  NEW.correlation_id:=v_res.correlation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrich_strap_finished_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_enrich_strap_finished_stock_movement
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_enrich_strap_finished_stock_movement();

-- Writers legados de picking inserem o movimento imediatamente antes de
-- atualizar a reserva exata. O bind ocorre nesse segundo evento e nunca escolhe
-- "a primeira" reserva por order/product, que e ambiguo para duas linhas de
-- tira do mesmo SKU no mesmo item do PV.
CREATE OR REPLACE FUNCTION public.tg_attach_strap_finished_movement_to_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_delta numeric; v_event_id uuid; v_source text; v_cost numeric;
BEGIN
  IF NEW.source<>'strap_engine_finished' OR NEW.sale_order_strap_demand_id IS NULL THEN RETURN NEW; END IF;
  v_delta:=greatest(coalesce(NEW.quantity_consumed,0)-coalesce(OLD.quantity_consumed,0),0);
  IF v_delta<=0 THEN RETURN NEW; END IF;
  BEGIN v_event_id:=nullif(current_setting('app.strap_last_movement_event',true),'')::uuid;
  EXCEPTION WHEN OTHERS THEN v_event_id:=NULL; END;
  IF v_event_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.stock_movements sm
     WHERE sm.strap_movement_event_id=v_event_id
       AND sm.material_reservation_id IS NULL
       AND sm.order_id IS NOT DISTINCT FROM NEW.order_id
       AND sm.product_id=NEW.product_id AND sm.movement_type='out'
       AND sm.quantity=v_delta FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Baixa da reserva canonica % sem event key exata de quantidade %',NEW.id,v_delta;
  END IF;
  SELECT d.source_mode,p.unit_price INTO v_source,v_cost
    FROM public.sale_order_strap_demands d JOIN public.products p ON p.id=NEW.product_id
   WHERE d.id=NEW.sale_order_strap_demand_id;
  PERFORM set_config('app.strap_engine_write','1',true);
  UPDATE public.stock_movements SET material_reservation_id=NEW.id,
    strap_variant_id=NEW.strap_variant_id,
    sale_order_strap_demand_id=NEW.sale_order_strap_demand_id,
    finished_product_id=NEW.finished_product_id,
    origin_type=CASE WHEN v_source='buy_ready' THEN 'buy_ready' ELSE 'internal_factory' END,
    effective_unit_cost=coalesce(v_cost,0),correlation_id=NEW.correlation_id
   WHERE strap_movement_event_id=v_event_id;
  PERFORM set_config('app.strap_last_movement_event','',true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_a_attach_strap_finished_movement ON public.material_reservations;
CREATE TRIGGER trg_a_attach_strap_finished_movement
  AFTER UPDATE OF quantity_consumed,status ON public.material_reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_attach_strap_finished_movement_to_reservation();

-- Os quatro writers vivos de picking passam por wrappers nomeados e
-- autorizados. O token nunca nasce de INSERT generico em stock_movements; so a
-- RPC operacional o emite, e o event key acima preserva a reserva exata.
DO $$
BEGIN
  IF to_regprocedure('public.confirm_picking_reservation_legacy_202701(uuid,text)') IS NULL THEN
    ALTER FUNCTION public.confirm_picking_reservation(uuid,text)
      RENAME TO confirm_picking_reservation_legacy_202701;
  END IF;
  IF to_regprocedure('public.commit_picking_for_sale_order_legacy_202701(uuid)') IS NULL THEN
    ALTER FUNCTION public.commit_picking_for_sale_order(uuid)
      RENAME TO commit_picking_for_sale_order_legacy_202701;
  END IF;
  IF to_regprocedure('public.commit_picking_session_legacy_202701(uuid)') IS NULL THEN
    ALTER FUNCTION public.commit_picking_session(uuid)
      RENAME TO commit_picking_session_legacy_202701;
  END IF;
  IF to_regprocedure('public.consume_all_reservations_for_order_legacy_202701(uuid,text)') IS NULL THEN
    ALTER FUNCTION public.consume_all_reservations_for_order(uuid,text)
      RENAME TO consume_all_reservations_for_order_legacy_202701;
  END IF;
  IF to_regprocedure('public.convert_reservation_to_out_legacy_202701(uuid,uuid)') IS NULL THEN
    ALTER FUNCTION public.convert_reservation_to_out(uuid,uuid)
      RENAME TO convert_reservation_to_out_legacy_202701;
  END IF;
  IF to_regprocedure('public.release_order_reservations_legacy_202701(uuid)') IS NULL THEN
    ALTER FUNCTION public.release_order_reservations(uuid)
      RENAME TO release_order_reservations_legacy_202701;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_strap_picking_writer()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin','gerente','producao','almoxarifado']) THEN
    RAISE EXCEPTION 'Somente Producao/Almoxarifado pode efetivar picking';
  END IF;
  PERFORM set_config('app.strap_engine_write','1',true);
  PERFORM set_config('app.strap_picking_writer','1',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_picking_reservation(
  p_reservation_id uuid,p_picked_by text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  PERFORM public.assert_strap_picking_writer();
  PERFORM public.confirm_picking_reservation_legacy_202701(p_reservation_id,p_picked_by);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_picking_for_sale_order(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  PERFORM public.assert_strap_picking_writer();
  RETURN public.commit_picking_for_sale_order_legacy_202701(p_sale_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_picking_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  PERFORM public.assert_strap_picking_writer();
  RETURN public.commit_picking_session_legacy_202701(p_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_all_reservations_for_order(
  p_order_id uuid,p_picked_by text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  PERFORM public.assert_strap_picking_writer();
  RETURN public.consume_all_reservations_for_order_legacy_202701(p_order_id,p_picked_by);
END;
$$;

CREATE OR REPLACE FUNCTION public.convert_reservation_to_out(
  p_order_id uuid,p_product_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF auth.role()<>'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin','gerente','producao']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  PERFORM set_config('app.strap_engine_write','1',true);
  PERFORM set_config('app.strap_picking_writer','1',true);
  PERFORM public.convert_reservation_to_out_legacy_202701(p_order_id,p_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_order_reservations(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF auth.role()<>'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin','gerente','producao','almoxarifado','comercial']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  PERFORM set_config('app.strap_engine_write','1',true);
  PERFORM public.release_order_reservations_legacy_202701(p_order_id);
END;
$$;

-- O resync legado da ficha pode coexistir com uma reserva canonica do motor no
-- mesmo produto/OP. Ele deve manter somente as reservas de componentes diretos
-- legadas: nunca usa, atualiza ou cancela strap_engine_finished/base. O wrapper
-- por ficha e a funcao por OP tambem recebem gate explicito; a funcao por OP
-- permanece interna (sem GRANT ao cliente).
CREATE OR REPLACE FUNCTION public.resync_op_material_reservations(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE
  v_o record; v_variant uuid; v_pkg text; v_grade jsonb; v_cons jsonb;
  v_ins integer:=0; v_upd integer:=0; v_can integer:=0;
BEGIN
  IF auth.role()<>'service_role'
     AND (NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin','gerente','producao','almoxarifado'])) THEN
    RAISE EXCEPTION 'Somente Producao/Almoxarifado pode ressincronizar reservas da OP';
  END IF;
  SELECT o.id,o.reference_id,o.color,o.quantity,o.grade,o.status,
         o.sale_order_item_id,o.sale_order_id
    INTO v_o FROM public.orders o WHERE o.id=p_order_id;
  IF NOT FOUND OR v_o.reference_id IS NULL THEN
    RETURN jsonb_build_object('order_id',p_order_id,'skipped','OP inexistente ou sem ficha');
  END IF;
  IF v_o.status NOT IN ('Reservado','Em Produção') THEN
    RETURN jsonb_build_object('order_id',p_order_id,'skipped','OP nao ativa: '||v_o.status);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('reserve:'||p_order_id::text));
  SELECT i.material_variant_id INTO v_variant
    FROM public.sale_order_items i WHERE i.id=v_o.sale_order_item_id;
  SELECT so.packaging_mode INTO v_pkg
    FROM public.sale_orders so WHERE so.id=v_o.sale_order_id;
  v_grade:=public.resolve_effective_op_grade(v_o.grade,coalesce(v_o.quantity,0)::numeric);
  IF v_grade IS NULL THEN
    RETURN jsonb_build_object('order_id',p_order_id,'skipped','OP sem grade resolvivel');
  END IF;
  v_cons:=coalesce(public.filter_caixa_by_packaging_mode(
    public.calculate_order_consumption_by_grade(
      v_o.reference_id,v_grade,coalesce(v_o.color,''),v_variant),v_pkg),'[]'::jsonb);

  CREATE TEMP TABLE IF NOT EXISTS _exp_direct(product_id uuid,req numeric) ON COMMIT DROP;
  DELETE FROM _exp_direct;
  INSERT INTO _exp_direct(product_id,req)
  SELECT (line->>'product_id')::uuid,sum(coalesce((line->>'required')::numeric,0))
    FROM jsonb_array_elements(v_cons) line
   WHERE line->>'product_id' IS NOT NULL
     AND coalesce(line->>'component','')='Componente Direto'
     AND coalesce((line->>'required')::numeric,0)>0
   GROUP BY (line->>'product_id')::uuid;

  WITH ins AS (
    INSERT INTO public.material_reservations(
      order_id,product_id,quantity_reserved,quantity_consumed,status,
      reservation_type,source,metadata,notes)
    SELECT p_order_id,e.product_id,e.req,0,'reserved','soft','onhand',
      jsonb_build_object('kind','component','component','Componente Direto',
        'source','direct_components','resync',true),
      'reserva criada pelo resync da ficha (componente acrescentado depois da OP)'
      FROM _exp_direct e
     WHERE NOT EXISTS (
       SELECT 1 FROM public.material_reservations mr
        WHERE mr.order_id=p_order_id AND mr.product_id=e.product_id
          AND coalesce(mr.source,'') NOT IN ('strap_engine_finished','strap_engine_base')
          AND mr.strap_variant_id IS NULL
          AND mr.status IN ('reserved','partially_consumed'))
    RETURNING 1
  ) SELECT count(*) INTO v_ins FROM ins;

  WITH upd AS (
    UPDATE public.material_reservations mr
       SET quantity_reserved=e.req,updated_at=now(),
           notes='quantidade ajustada pelo resync da ficha'
      FROM _exp_direct e
     WHERE mr.order_id=p_order_id AND mr.product_id=e.product_id
       AND coalesce(mr.source,'') NOT IN ('strap_engine_finished','strap_engine_base')
       AND mr.strap_variant_id IS NULL
       AND mr.status IN ('reserved','partially_consumed')
       AND coalesce(mr.quantity_consumed,0)=0
       AND mr.quantity_reserved IS DISTINCT FROM e.req
    RETURNING 1
  ) SELECT count(*) INTO v_upd FROM upd;

  WITH can AS (
    UPDATE public.material_reservations mr
       SET status='cancelled',updated_at=now(),
           notes='reserva obsoleta cancelada pelo resync da ficha'
     WHERE mr.order_id=p_order_id
       AND coalesce(mr.source,'') NOT IN ('strap_engine_finished','strap_engine_base')
       AND mr.strap_variant_id IS NULL
       AND mr.status IN ('reserved','partially_consumed')
       AND coalesce(mr.quantity_consumed,0)=0
       AND coalesce(mr.metadata->>'source','') IN ('direct_components','component_color')
       AND NOT EXISTS(SELECT 1 FROM _exp_direct e WHERE e.product_id=mr.product_id)
    RETURNING 1
  ) SELECT count(*) INTO v_can FROM can;
  RETURN jsonb_build_object('order_id',p_order_id,'inseridas',v_ins,
    'atualizadas',v_upd,'canceladas',v_can);
END;
$$;

CREATE OR REPLACE FUNCTION public.resync_sheet_material_reservations(p_sheet_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $$
DECLARE v_op record; v_r jsonb; v_ops integer:=0; v_ins integer:=0;
  v_upd integer:=0; v_can integer:=0;
BEGIN
  IF auth.role()<>'service_role'
     AND (NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin','gerente','producao','almoxarifado'])) THEN
    RAISE EXCEPTION 'Somente Producao/Almoxarifado pode ressincronizar reservas da ficha';
  END IF;
  FOR v_op IN SELECT o.id FROM public.orders o
    WHERE o.reference_id=p_sheet_id AND o.status IN ('Reservado','Em Produção')
  LOOP
    v_r:=public.resync_op_material_reservations(v_op.id);
    v_ops:=v_ops+1;
    v_ins:=v_ins+coalesce((v_r->>'inseridas')::integer,0);
    v_upd:=v_upd+coalesce((v_r->>'atualizadas')::integer,0);
    v_can:=v_can+coalesce((v_r->>'canceladas')::integer,0);
  END LOOP;
  RETURN jsonb_build_object('sheet_id',p_sheet_id,'ops',v_ops,
    'inseridas',v_ins,'atualizadas',v_upd,'canceladas',v_can);
END;
$$;

-- Os writers fabris legados por setor e o resync atomico da OP continuam
-- necessarios para materiais comuns, mas nao sao donos das reservas/movimentos
-- UUID-only de tira. O cutover preserva esses registros e reforca o RBAC do
-- resync sem alterar o restante da baixa da OP.
DO $$
DECLARE v_def text; v_before text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure(
    'public.debit_reserved_materials_for_sector(uuid,uuid,text,numeric)'))
    INTO v_def;
  IF v_def IS NOT NULL THEN
    v_before:=v_def;
    v_def:=replace(v_def,
      'WHERE mr.order_id = p_order_id
         AND mr.status IN (''reserved'', ''partially_consumed'')',
      'WHERE mr.order_id = p_order_id
         AND coalesce(mr.source,'''') NOT IN (''strap_engine_finished'',''strap_engine_base'')
         AND mr.strap_variant_id IS NULL
         AND mr.status IN (''reserved'', ''partially_consumed'')');
    v_def:=replace(v_def,
      'WHERE mr.order_id = p_order_id AND mr.status IN (''reserved'', ''partially_consumed'')',
      'WHERE mr.order_id = p_order_id
         AND coalesce(mr.source,'''') NOT IN (''strap_engine_finished'',''strap_engine_base'')
         AND mr.strap_variant_id IS NULL
         AND mr.status IN (''reserved'', ''partially_consumed'')');
    IF v_def=v_before OR (length(v_def)-length(replace(v_def,'strap_engine_finished','')))
         /length('strap_engine_finished')<2 THEN
      RAISE EXCEPTION 'Cutover recusado: baixa por setor nao foi isolada das reservas de tira';
    END IF;
    EXECUTE v_def;
  END IF;

  SELECT pg_get_functiondef('public.resync_op_atomic(uuid)'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN RAISE EXCEPTION 'resync_op_atomic(uuid) ausente'; END IF;
  v_before:=v_def;
  v_def:=replace(v_def,
    'IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION ''Permission denied: usuário não aprovado'';
  END IF;',
    'IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY[''admin'',''gerente'',''producao'']) THEN
    RAISE EXCEPTION ''Somente Producao/Gerencia pode ressincronizar OP'';
  END IF;');
  v_def:=replace(v_def,
    'WHERE order_id = p_order_id AND movement_type = ''out''',
    'WHERE order_id = p_order_id AND movement_type = ''out''
       AND strap_variant_id IS NULL AND sale_order_strap_demand_id IS NULL');
  v_def:=replace(v_def,
    'DELETE FROM public.material_reservations WHERE order_id = p_order_id;',
    'DELETE FROM public.material_reservations WHERE order_id = p_order_id
     AND coalesce(source,'''') NOT IN (''strap_engine_finished'',''strap_engine_base'')
     AND strap_variant_id IS NULL;');
  v_def:=replace(v_def,
    'WHERE order_id = p_order_id
     AND movement_type = ''out'';',
    'WHERE order_id = p_order_id
     AND movement_type = ''out''
     AND strap_variant_id IS NULL AND sale_order_strap_demand_id IS NULL;');
  IF v_def=v_before OR position('strap_engine_finished' in v_def)=0
     OR position('Somente Producao/Gerencia pode ressincronizar OP' in v_def)=0 THEN
    RAISE EXCEPTION 'Cutover recusado: resync_op_atomic nao foi isolado das tiras';
  END IF;
  EXECUTE v_def;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_preserve_unstarted_sector_reservations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public
AS $$
BEGIN
  IF NEW.status IN ('Finalizado','FINALIZADO','Faturado','Concluído','Concluido')
     AND coalesce(OLD.status,'') IS DISTINCT FROM NEW.status THEN
    UPDATE public.material_reservations mr SET status='pending_reconciliation',
      updated_at=now(),notes=coalesce(nullif(mr.notes,''),'')
        ||' [pendente: setor de consumo nao iniciado antes da finalizacao]'
     WHERE mr.order_id=NEW.id AND mr.status IN ('reserved','partially_consumed')
       AND coalesce(mr.source,'') NOT IN ('strap_engine_finished','strap_engine_base')
       AND mr.strap_variant_id IS NULL
       AND nullif(mr.metadata->>'consumption_sector','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.order_stages os
         WHERE os.order_id=NEW.id
           AND public.canonical_stage_name(os.stage_name)=
             public.canonical_stage_name(mr.metadata->>'consumption_sector')
           AND coalesce(os.quantity_processed,0)>0);
  END IF;
  RETURN NEW;
END;
$$;

-- Corrige nominalmente o settlement vivo sem tocar historico: uma reserva ja
-- consumida em parte debita somente quantity_reserved-quantity_consumed. O
-- restante sem estoque continua virando pendencia, nunca cancelamento.
DO $$
DECLARE v_def text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='settle_open_reservations_for_order'
     AND pg_get_function_identity_arguments(p.oid)='p_order_id uuid, p_reason text';
  IF v_def IS NULL THEN RAISE EXCEPTION 'settle_open_reservations_for_order(uuid,text) ausente no cutover'; END IF;
  v_before:=v_def;
  v_def:=replace(v_def,
    'BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(''settle_reservations:'' || p_order_id::text));',
    'BEGIN
  PERFORM set_config(''app.strap_engine_write'',''1'',true);
  PERFORM pg_advisory_xact_lock(hashtext(''settle_reservations:'' || p_order_id::text));');
  v_def:=replace(v_def,
    'v_debit := LEAST(GREATEST(COALESCE(v_prev_qty, 0), 0), COALESCE(v_res.quantity_reserved, 0));
      v_shortfall := COALESCE(v_res.quantity_reserved, 0) - v_debit;',
    'v_debit := LEAST(GREATEST(COALESCE(v_prev_qty, 0), 0),
        GREATEST(COALESCE(v_res.quantity_reserved, 0)-COALESCE(v_res.quantity_consumed, 0),0));
      v_shortfall := GREATEST(COALESCE(v_res.quantity_reserved, 0)
        -COALESCE(v_res.quantity_consumed, 0)-v_debit,0);');
  v_def:=replace(v_def,
    'quantity_reserved = v_debit, quantity_consumed = v_debit,',
    'quantity_reserved = COALESCE(quantity_consumed,0)+v_debit,
               quantity_consumed = COALESCE(quantity_consumed,0)+v_debit,');
  IF v_def=v_before
     OR position('GREATEST(COALESCE(v_res.quantity_reserved, 0)-COALESCE(v_res.quantity_consumed, 0),0)' in v_def)=0
     OR position('app.strap_engine_write' in v_def)=0 THEN
    RAISE EXCEPTION 'Assinatura interna inesperada: settlement nao foi corrigido com seguranca';
  END IF;
  EXECUTE v_def;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_settle_strap_finished_demand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_delta numeric;
BEGIN
  IF NEW.source<>'strap_engine_finished' OR NEW.sale_order_strap_demand_id IS NULL THEN RETURN NEW; END IF;
  v_delta:=greatest(coalesce(NEW.quantity_consumed,0)-coalesce(OLD.quantity_consumed,0),0);
  IF v_delta<=0 THEN RETURN NEW; END IF;
  UPDATE public.sale_order_strap_demands d
     SET fulfilled_m=least(d.gross_required_m-d.cancelled_m,d.fulfilled_m+v_delta),
         status=CASE WHEN d.fulfilled_m+v_delta>=d.gross_required_m-d.cancelled_m
           THEN 'fulfilled' ELSE d.status END,
         correlation_id=coalesce(NEW.correlation_id,d.correlation_id)
    FROM public.sale_order_strap_demands origin
   WHERE origin.id=NEW.sale_order_strap_demand_id
     AND d.sale_order_item_id=origin.sale_order_item_id
     AND d.technical_strap_line_id=origin.technical_strap_line_id
     AND d.is_current;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_strap_finished_demand ON public.material_reservations;
CREATE TRIGGER trg_settle_strap_finished_demand
  AFTER UPDATE OF quantity_consumed,status ON public.material_reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_settle_strap_finished_demand();

CREATE OR REPLACE FUNCTION public.is_strap_calendar_open(p_calendar_id uuid, p_date date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calendar public.strap_operational_calendars%ROWTYPE;
  v_override boolean;
BEGIN
  IF p_calendar_id IS NULL THEN RETURN public.is_business_day(p_date); END IF;
  SELECT * INTO v_calendar FROM public.strap_operational_calendars
   WHERE id = p_calendar_id AND status = 'active';
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT e.is_open INTO v_override
    FROM public.strap_operational_calendar_exceptions e
   WHERE e.calendar_id = p_calendar_id AND e.work_date = p_date;
  IF FOUND THEN RETURN v_override; END IF;
  IF v_calendar.uses_factory_calendar THEN RETURN public.is_business_day(p_date); END IF;
  RETURN extract(isodow FROM p_date)::smallint = ANY(v_calendar.open_iso_weekdays);
END;
$$;

CREATE OR REPLACE FUNCTION public.next_strap_calendar_open_day(p_calendar_id uuid, p_date date)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_day date := p_date; v_guard integer := 0;
BEGIN
  WHILE NOT public.is_strap_calendar_open(p_calendar_id, v_day) LOOP
    v_day := v_day + 1;
    v_guard := v_guard + 1;
    IF v_guard > 370 THEN RAISE EXCEPTION 'Calendario sem dia aberto nos proximos 370 dias'; END IF;
  END LOOP;
  RETURN v_day;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_previous_strap_open_week(
  p_main_production_start date,
  p_calendar_id uuid DEFAULT NULL
)
RETURNS TABLE(target_week date, window_start date, window_end date, calendar_exception boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week date := date_trunc('week', p_main_production_start)::date - 7;
  v_first date;
  v_last date;
  v_skipped boolean := false;
  v_guard integer := 0;
BEGIN
  LOOP
    SELECT min(d), max(d) INTO v_first, v_last
      FROM generate_series(v_week, v_week + 6, interval '1 day') g(d)
     WHERE public.is_strap_calendar_open(p_calendar_id, d::date);
    IF v_first IS NOT NULL THEN
      target_week := v_week;
      window_start := v_first;
      window_end := v_last;
      calendar_exception := v_skipped;
      RETURN NEXT;
      RETURN;
    END IF;
    v_week := v_week - 7;
    v_skipped := true;
    v_guard := v_guard + 1;
    IF v_guard > 104 THEN RAISE EXCEPTION 'Calendario sem semana aberta nos ultimos dois anos'; END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.strap_base_available_now(p_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT greatest(
    0,
    coalesce(p.quantity, 0)
      - coalesce(p.reserved_stock, 0)
      - coalesce((
          SELECT sum(b.balance_in_custody)
            FROM public.v_contractor_material_custody_balances b
           WHERE b.base_product_id = p.id AND b.balance_in_custody > 0
        ), 0)
  )
  FROM public.products p WHERE p.id = p_product_id;
$$;

-- A identidade da napa-base nunca vem do JSON da linha nem de nome. Esta
-- funcao espelha a precedencia do resolvedor historico
-- strap_base_family_for_sheet(), mas devolve somente um UUID que ja esteja
-- persistido na variante/ficha (pins legados por texto tornam-se bloqueio).
CREATE OR REPLACE FUNCTION public.resolve_strap_base_group_id(
  p_reference_id uuid,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT rmv.upper_material_group_id,
           rmv.upper_material_product_id,
           rmv.lining_material_group_id,
           rmv.lining_material_product_id,
           rmv.main_material_group_id
      FROM public.reference_material_variants rmv
     WHERE rmv.id = p_material_variant_id
       AND rmv.reference_id = p_reference_id
       AND coalesce(rmv.active, true)
  ), s AS (
    SELECT ts.upper_material_product_id, ts.lining_material_product_id
      FROM public.technical_sheets ts
     WHERE ts.id = p_reference_id
  )
  SELECT coalesce(
    (SELECT upper_material_group_id FROM v),
    (SELECT p.group_id FROM v JOIN public.products p ON p.id = v.upper_material_product_id),
    (SELECT lining_material_group_id FROM v),
    (SELECT p.group_id FROM v JOIN public.products p ON p.id = v.lining_material_product_id),
    (SELECT main_material_group_id FROM v),
    (SELECT p.group_id FROM s JOIN public.products p ON p.id = s.upper_material_product_id),
    (SELECT p.group_id FROM s JOIN public.products p ON p.id = s.lining_material_product_id)
  );
$$;

COMMENT ON FUNCTION public.resolve_strap_base_group_id(uuid, uuid) IS
  'Resolve a napa-base por UUID (referencia + variante) sem lookup operacional por nome e sem confiar em base_group_id enviado pelo cliente.';

CREATE OR REPLACE FUNCTION public.resolve_strap_billing_anchor_value(
  p_delivery_deadline date,
  p_billing_week text,
  p_delivery_month text,
  p_delivery_week text
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE v_value text; v_year integer; v_month integer; v_week integer; v_first date;
BEGIN
  -- O PV persiste em delivery_deadline o primeiro dia escolhido na tela; ele
  -- sempre vence os textos legados e evita recalcular uma decisao congelada.
  IF p_delivery_deadline IS NOT NULL THEN RETURN p_delivery_deadline; END IF;
  v_value:=nullif(btrim(p_billing_week),'');
  IF v_value ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
    v_year:=split_part(v_value,'-',1)::integer;
    v_month:=split_part(v_value,'-',2)::integer;
    v_week:=substring(split_part(v_value,'-',3) FROM 2)::integer;
    v_first:=make_date(v_year,v_month,1);
    RETURN greatest(v_first,
      v_first-(extract(isodow FROM v_first)::integer-1)+((v_week-1)*7));
  ELSIF v_value ~ '^\d{4}-W\d{1,2}$' THEN
    RETURN date_trunc('week',public.parse_iso_billing_week(v_value))::date;
  ELSIF v_value ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN v_value::date;
  END IF;
  IF coalesce(p_delivery_month,'') ~ '^\d{4}-\d{2}$'
     AND coalesce(p_delivery_week,'') ~ '^S\d{1,2}$' THEN
    v_year:=split_part(p_delivery_month,'-',1)::integer;
    v_month:=split_part(p_delivery_month,'-',2)::integer;
    v_week:=substring(p_delivery_week FROM 2)::integer;
    v_first:=make_date(v_year,v_month,1);
    RETURN greatest(v_first,
      v_first-(extract(isodow FROM v_first)::integer-1)+((v_week-1)*7));
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_strap_sale_order_billing_anchor(p_sale_order_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.resolve_strap_billing_anchor_value(
    so.delivery_deadline,so.billing_week::text,so.delivery_month::text,so.delivery_week::text)
  FROM public.sale_orders so WHERE so.id=p_sale_order_id;
$$;

DO $$
BEGIN
  IF public.resolve_strap_billing_anchor_value(NULL,'2026-09-S1',NULL,NULL)
       IS DISTINCT FROM DATE '2026-09-01' THEN
    RAISE EXCEPTION 'Regressao de faturamento: S1 jamais pode sair do mes escolhido';
  END IF;
END;
$$;

-- Ancora canonica do inicio da primeira etapa produtiva. Prefere a grade
-- global vigente (capacidade compartilhada), depois os snapshots da OP/onda e,
-- antes da criacao das OPs, o cronograma reverso canonico do PV. A segunda
-- coluna identifica a revisao da grade que produziu a data.
CREATE OR REPLACE FUNCTION public.resolve_sale_order_main_production_start(
  p_sale_order_id uuid,
  p_sale_order_item_id uuid DEFAULT NULL
)
RETURNS TABLE(main_production_start date, schedule_revision integer, resolution_source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run uuid;
  v_run_at timestamptz;
  v_start date;
BEGIN
  v_run := public.latest_schedule_run_id();
  SELECT min(ps.date), max(er.ran_at)
    INTO v_start, v_run_at
    FROM public.production_schedule ps
    JOIN public.orders o ON o.id = ps.order_id
    LEFT JOIN public.production_engine_runs er ON er.run_id = ps.recalc_run_id
   WHERE ps.recalc_run_id = v_run
     AND o.deleted_at IS NULL
     AND o.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR o.sale_order_item_id = p_sale_order_item_id);
  IF v_start IS NOT NULL THEN
    RETURN QUERY SELECT v_start,
      (hashtext(coalesce(v_run::text, 'schedule'))::bigint & 2147483647)::integer,
      'production_schedule'::text;
    RETURN;
  END IF;

  SELECT min(coalesce(o.planned_start_capacity, o.planned_start))
    INTO v_start
    FROM public.orders o
   WHERE o.sale_order_id = p_sale_order_id
     AND o.deleted_at IS NULL
     AND (p_sale_order_item_id IS NULL OR o.sale_order_item_id = p_sale_order_item_id);
  IF v_start IS NOT NULL THEN
    RETURN QUERY SELECT v_start, 0, 'order_planned_start'::text;
    RETURN;
  END IF;

  SELECT min(pw.corte_start_date)
    INTO v_start
    FROM public.production_wave_item_sources wis
    JOIN public.production_wave_items wi ON wi.id = wis.wave_item_id
    JOIN public.production_waves pw ON pw.id = wi.wave_id
   WHERE wis.sale_order_id = p_sale_order_id
     AND (p_sale_order_item_id IS NULL OR wis.sale_order_item_id = p_sale_order_item_id)
     AND pw.status::text <> 'cancelled';
  IF v_start IS NOT NULL THEN
    RETURN QUERY SELECT v_start, 0, 'production_wave'::text;
    RETURN;
  END IF;

  SELECT least(t.corte_palmilha_start_date, t.corte_forracao_start_date,
               t.costura_start_date, t.mesa_start_date)
    INTO v_start
    FROM public.compute_wave_timeline(ARRAY[p_sale_order_id]) t
   LIMIT 1;
  IF v_start IS NOT NULL THEN
    RETURN QUERY SELECT v_start, 0, 'reverse_timeline'::text;
    RETURN;
  END IF;

  v_start := public.resolve_strap_sale_order_billing_anchor(p_sale_order_id);
  IF v_start IS NOT NULL THEN
    RETURN QUERY SELECT v_start,0,'sale_order_billing_anchor'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT v_start, 0,
    CASE WHEN v_start IS NULL THEN 'unresolved' ELSE 'billing_week_first_day' END::text;
END;
$$;

COMMENT ON FUNCTION public.resolve_sale_order_main_production_start(uuid, uuid) IS
  'Inicio principal do PV: grade global vigente -> OP/onda -> cronograma reverso -> primeiro dia da semana de faturamento.';

-- -----------------------------------------------------------------------------
-- 2. Preview unico: draft sem IDs persistidos e wrapper de PV salvo
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand_draft(p_item jsonb)
RETURNS TABLE(
  line_ordinal integer,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_sourcing jsonb := coalesce(p_item -> 'strap_sourcing', '{}'::jsonb);
  v_selection jsonb;
  v_sale_order_id uuid;
  v_sale_order_item_id uuid;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_measure_id uuid;
  v_base_group_id uuid;
  v_color_id uuid;
  v_selected_variant_id uuid;
  v_catalog jsonb;
  v_reasons jsonb;
  v_line_id uuid;
  v_source text;
  v_gross numeric;
  v_main_start date;
  v_schedule_revision integer := 0;
  v_schedule_source text;
  v_billing_week text;
  v_year integer;
  v_month integer;
  v_week integer;
  v_first date;
  v_can_financial boolean := public.can_see_strap_financial_values();
  v_idx integer := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF jsonb_typeof(p_item) <> 'object' THEN RAISE EXCEPTION 'p_item deve ser objeto JSON'; END IF;
  IF jsonb_typeof(coalesce(p_item -> 'strap_colors', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'strap_colors deve ser array';
  END IF;

  BEGIN v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_reference_id := NULL; END;
  BEGIN v_material_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_material_variant_id := NULL; END;
  BEGIN v_sale_order_id := nullif(p_item ->> 'sale_order_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_sale_order_id := NULL; END;
  BEGIN v_sale_order_item_id := nullif(p_item ->> 'sale_order_item_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_sale_order_item_id := NULL; END;
  FOR v_line IN SELECT value FROM jsonb_array_elements(coalesce(p_item -> 'strap_colors', '[]'::jsonb))
  LOOP
    v_idx := v_idx + 1;
    v_reasons := '[]'::jsonb;
    v_catalog := '{}'::jsonb;
    v_line_id := NULL; v_measure_id := NULL; v_base_group_id := NULL; v_color_id := NULL;
    v_selected_variant_id := NULL;
    strap_variant_id := NULL; recipe_id := NULL; base_product_id := NULL; finished_product_id := NULL;

    BEGIN v_line_id := nullif(v_line ->> 'technical_strap_line_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_line_id := NULL; END;
    IF v_line_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','technical_line_missing','field','technical_strap_line_id',
        'message','Linha de tira sem UUID tecnico estavel; corrija a ficha tecnica.'));
    END IF;

    BEGIN v_measure_id := nullif(v_line ->> 'measure_id', '')::uuid; EXCEPTION WHEN OTHERS THEN v_measure_id := NULL; END;
    IF v_measure_id IS NULL AND v_line_id IS NOT NULL THEN
      SELECT m.measure_id INTO v_measure_id
        FROM public.technical_strap_line_identity_map m
       WHERE m.technical_strap_line_id = v_line_id AND m.status = 'resolved';
    END IF;
    IF v_measure_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','measure_missing','field','measure_id',
        'message','Linha tecnica sem medida canonica resolvida.'));
    END IF;

    IF v_line_id IS NOT NULL THEN v_selection := v_sourcing -> v_line_id::text; ELSE v_selection := NULL; END IF;
    BEGIN v_selected_variant_id := nullif(v_selection ->> 'strap_variant_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_selected_variant_id := NULL; END;
    v_source := v_selection ->> 'source_mode';
    IF v_source NOT IN ('internal', 'buy_ready') THEN
      v_source := NULL;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','source_mode_required','field','source_mode',
        'message','Escolha Produzir com napa propria ou Comprar tira pronta.'));
    END IF;

    v_main_start := NULL;
    BEGIN
      v_main_start := nullif(coalesce(
        v_selection ->> 'main_production_start', p_item ->> 'main_production_start'
      ), '')::date;
    EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    BEGIN
      v_schedule_revision := coalesce(
        nullif(v_selection ->> 'schedule_revision','')::integer,
        nullif(p_item ->> 'schedule_revision','')::integer,
        0
      );
    EXCEPTION WHEN OTHERS THEN v_schedule_revision := 0; END;
    IF v_main_start IS NULL AND v_sale_order_id IS NOT NULL THEN
      SELECT s.main_production_start, s.schedule_revision, s.resolution_source
        INTO v_main_start, v_schedule_revision, v_schedule_source
        FROM public.resolve_sale_order_main_production_start(
          v_sale_order_id, v_sale_order_item_id
        ) s;
    END IF;
    IF v_main_start IS NULL THEN
      BEGIN
        v_main_start := nullif(coalesce(
          p_item ->> 'billing_anchor', p_item ->> 'required_at'
        ), '')::date;
        v_schedule_source := 'draft_billing_anchor';
      EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    END IF;
    IF v_main_start IS NULL THEN
      v_billing_week := nullif(p_item ->> 'billing_week', '');
      BEGIN
        IF v_billing_week ~ '^\d{4}-W\d{1,2}$' THEN
          v_main_start := date_trunc('week', public.parse_iso_billing_week(v_billing_week))::date;
        ELSIF v_billing_week ~ '^\d{4}-\d{2}-S\d{1,2}$' THEN
          v_year := split_part(v_billing_week, '-', 1)::integer;
          v_month := split_part(v_billing_week, '-', 2)::integer;
          v_week := substring(split_part(v_billing_week, '-', 3) FROM 2)::integer;
          v_first := make_date(v_year, v_month, 1);
          v_main_start := greatest(v_first,
            v_first - (extract(isodow FROM v_first)::integer - 1)
              + ((v_week - 1) * 7));
        ELSIF v_billing_week ~ '^\d{4}-\d{2}-\d{2}$' THEN
          v_main_start := date_trunc('week', v_billing_week::date)::date;
        END IF;
        IF v_main_start IS NOT NULL THEN v_schedule_source := 'draft_billing_week_first_day'; END IF;
      EXCEPTION WHEN OTHERS THEN v_main_start := NULL; END;
    END IF;
    IF v_main_start IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','main_production_start_missing','field','main_production_start',
        'message','Cronograma global ainda nao definiu o inicio produtivo deste item.'));
    END IF;

    IF v_reference_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.technical_sheets ts WHERE ts.id = v_reference_id
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','reference_unresolved','field','reference_id',
        'message','Referencia sem UUID persistido ou inexistente.'));
    END IF;
    IF v_material_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.reference_material_variants rmv
       WHERE rmv.id = v_material_variant_id
         AND rmv.reference_id = v_reference_id
         AND coalesce(rmv.active, true)
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','material_variant_mismatch','field','material_variant_id',
        'message','Variante de material nao pertence a referencia ou esta inativa.'));
    END IF;
    v_base_group_id := public.resolve_strap_base_group_id(v_reference_id, v_material_variant_id);
    IF v_base_group_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','base_group_unresolved','field','material_variant_id',
        'message','A referencia/variante nao identifica uma base canonica por UUID; nomes legados nao sao aceitos.'));
    END IF;

    -- Cor operacional e uma identidade persistida. Texto e alias continuam
    -- disponiveis somente para exibicao/cadastro e nunca entram no netting.
    BEGIN v_color_id := nullif(v_line ->> 'color_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    IF v_color_id IS NULL THEN
      BEGIN v_color_id := nullif(v_selection ->> 'color_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN v_color_id := NULL; END;
    END IF;
    IF v_color_id IS NULL AND v_selected_variant_id IS NOT NULL THEN
      SELECT v.color_id INTO v_color_id
        FROM public.artisanal_strap_variants v
       WHERE v.id = v_selected_variant_id;
    END IF;
    IF v_color_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.canonical_colors c WHERE c.id = v_color_id
    ) THEN
      v_color_id := NULL;
    END IF;
    IF v_color_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','color_id_missing','field','color_id',
        'message','Cor sem UUID canonico persistido; texto/alias nao identifica estoque.'));
    END IF;

    v_gross := public.calculate_strap_line_required_m(
      v_line,
      coalesce(nullif(p_item ->> 'quantity', '')::numeric, 0),
      coalesce(p_item -> 'grade', '{}'::jsonb)
    );
    IF (
      jsonb_typeof(coalesce(p_item -> 'grade', '{}'::jsonb)) = 'object'
      AND EXISTS (
        SELECT 1
          FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
           AND coalesce(
             nullif(v_line -> 'consumption_per_size' ->> g.key, '')::numeric,
             nullif(v_line ->> 'consumption', '')::numeric,
             0
           ) <= 0
      )
    ) OR (
      NOT EXISTS (
        SELECT 1 FROM jsonb_each_text(coalesce(p_item -> 'grade', '{}'::jsonb)) g
         WHERE g.value::numeric > 0
      )
      AND coalesce(nullif(v_line ->> 'consumption', '')::numeric, 0) <= 0
    ) THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','consumption_missing','field','consumption_per_size',
        'message','Consumo da tira ausente ou zero para uma numeracao demandada.'));
    END IF;
    IF v_gross <= 0 THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','gross_required_invalid','field','quantity',
        'message','Consumo bruto calculado deve ser maior que zero.'));
    END IF;

    IF v_measure_id IS NOT NULL AND v_base_group_id IS NOT NULL AND v_color_id IS NOT NULL THEN
      BEGIN
        v_catalog := public.resolve_artisanal_strap_catalog(
          v_measure_id, v_base_group_id, v_color_id, v_source
        );
        strap_variant_id := (v_catalog ->> 'variant_id')::uuid;
        recipe_id := nullif(v_catalog ->> 'recipe_id', '')::uuid;
        base_product_id := nullif(v_catalog ->> 'base_product_id', '')::uuid;
        finished_product_id := (v_catalog ->> 'finished_product_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code','catalog_resolution_blocked','field','strap_variant_id','message',SQLERRM));
      END;
    END IF;

    IF v_source IS NOT NULL AND v_selected_variant_id IS NULL THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','variant_identity_not_persisted','field','strap_variant_id',
        'message','A escolha de origem deve persistir o UUID exato da variante resolvida.'));
    ELSIF v_selected_variant_id IS DISTINCT FROM strap_variant_id THEN
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','variant_snapshot_stale','field','strap_variant_id',
        'message','Variante escolhida nao corresponde mais a identidade tecnica atual.'));
    END IF;

    line_ordinal := v_idx;
    technical_strap_line_id := v_line_id;
    source_mode := v_source;
    gross_required_m := v_gross;
    blocking_reasons := v_reasons;
    resolved := jsonb_build_object(
      'base_group_id', v_base_group_id,
      'color_id', v_color_id,
      'strap_product_name', (SELECT p.name FROM public.products p WHERE p.id = finished_product_id),
      'strap_color_name', (SELECT c.name FROM public.canonical_colors c WHERE c.id = v_color_id),
      'base_product_name', (SELECT p.name FROM public.products p WHERE p.id = base_product_id),
      'measure_name', (SELECT m.display_name FROM public.artisanal_strap_measures m WHERE m.id = v_measure_id),
      'cut_band_width_mm', (SELECT r.cut_band_width_mm FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'usable_base_width_mm_snapshot', (SELECT r.usable_base_width_mm_snapshot FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'theoretical_yield_m_per_m', (SELECT r.theoretical_yield_m_per_m FROM public.artisanal_strap_recipes r WHERE r.id = recipe_id),
      'confirmed_yield_m_per_m', v_catalog -> 'confirmed_yield_m_per_m',
      'base_required_m', CASE WHEN v_source = 'internal'
        THEN v_gross / nullif((v_catalog ->> 'confirmed_yield_m_per_m')::numeric, 0) ELSE 0 END,
      'purchase_price', CASE WHEN v_can_financial THEN v_catalog -> 'purchase_price' ELSE 'null'::jsonb END,
      'purchase_conversion_rate', CASE WHEN v_can_financial THEN
        to_jsonb((SELECT p.conversion_rate FROM public.products p WHERE p.id=finished_product_id))
        ELSE 'null'::jsonb END,
      'purchase_unit_cost_stock', CASE WHEN v_can_financial THEN to_jsonb(
        (SELECT p.purchase_price/nullif(p.conversion_rate,0)
           FROM public.products p WHERE p.id=finished_product_id)) ELSE 'null'::jsonb END,
      'internal_unit_cost', CASE WHEN v_can_financial THEN v_catalog -> 'internal_unit_cost' ELSE 'null'::jsonb END,
      'can_internal', coalesce((v_catalog ->> 'internal_available')::boolean, false),
      'can_buy_ready', coalesce((v_catalog ->> 'buy_ready_available')::boolean, false),
      'source_mode', v_source,
      'required_at', coalesce(v_selection ->> 'required_at', p_item ->> 'required_at'),
      'main_production_start', v_main_start,
      'schedule_revision', v_schedule_revision,
      'schedule_source', coalesce(v_schedule_source, 'draft_supplied'),
      'catalog', v_catalog
    );
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_demand(p_sale_order_id uuid)
RETURNS TABLE(
  sale_order_item_id uuid,
  technical_strap_line_id uuid,
  strap_variant_id uuid,
  source_mode text,
  gross_required_m numeric,
  recipe_id uuid,
  base_product_id uuid,
  finished_product_id uuid,
  blocking_reasons jsonb,
  resolved jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, p.technical_strap_line_id, p.strap_variant_id, p.source_mode,
         p.gross_required_m, p.recipe_id, p.base_product_id, p.finished_product_id,
         p.blocking_reasons, p.resolved
    FROM public.sale_order_items i
    CROSS JOIN LATERAL public.resolve_sale_order_main_production_start(
      p_sale_order_id, i.id
    ) s
    CROSS JOIN LATERAL public.preview_sale_order_strap_demand_draft(jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'sale_order_item_id', i.id,
      'reference_id', i.reference_id,
      'material_variant_id', i.material_variant_id,
      'color', i.color,
      'quantity', i.quantity,
      'grade', i.grade,
      'strap_colors', i.strap_colors,
      'strap_sourcing', i.strap_sourcing,
      'main_production_start', s.main_production_start,
      'schedule_revision', s.schedule_revision
    )) p
   WHERE i.sale_order_id = p_sale_order_id
   ORDER BY i.id, p.line_ordinal;
$$;

-- Req48/89/118: a linha externa e vinculada por UUID a demanda. sent_at e
-- qualquer ledger/recebimento/claim sao fatos historicos e continuam sendo
-- compromisso para a edicao comum. O override administrativo pode encerrar
-- somente o saldo futuro quando o preflight abaixo provar custodia zero e
-- inexistencia de pendencia fisica; nenhum fato desta funcao e apagado.
CREATE OR REPLACE FUNCTION public.strap_demand_has_external_commitment(
  p_sale_order_strap_demand_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_sale_order_strap_demand_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.service_order_items soi
     WHERE (
       soi.sale_order_strap_demand_id = p_sale_order_strap_demand_id
       OR EXISTS (
         SELECT 1
           FROM public.strap_production_batch_contributions c
          WHERE c.sale_order_strap_demand_id = p_sale_order_strap_demand_id
            AND c.service_order_item_id = soi.id
       )
     )
       AND (
         soi.sent_at IS NOT NULL
         OR EXISTS (
           SELECT 1
             FROM public.contractor_material_custody_movements m
            WHERE m.service_order_item_id = soi.id
              AND m.service_order_id = soi.service_order_id
              AND m.base_product_id = soi.base_product_id
         )
         OR EXISTS (
           SELECT 1
             FROM public.strap_production_receipts r
            WHERE r.service_order_item_id = soi.id
              AND r.batch_item_id = soi.strap_batch_item_id
              AND r.strap_variant_id = soi.strap_variant_id
              AND r.base_product_id = soi.base_product_id
              AND r.finished_product_id = soi.finished_product_id
         )
         OR EXISTS (
           SELECT 1
             FROM public.contractor_loss_claims cl
            WHERE cl.service_order_item_id = soi.id
              AND cl.service_order_id = soi.service_order_id
              AND cl.base_product_id = soi.base_product_id
         )
       )
  );
$$;

-- Estado interno usado pelo preflight e pela pos-condicao da troca
-- administrativa. Fato realizado e preservado na revisao antiga e nao e, por
-- si so, bloqueio. Bloqueiam somente documento congelado ainda com saldo,
-- custodia/claim/retrabalho abertos e inconsistencias sem reversao canonica.
CREATE OR REPLACE FUNCTION public.inspect_strap_source_override_state(
  p_sale_order_strap_demand_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH demand_ids AS (
    SELECT DISTINCT id
      FROM unnest(coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[])) id
  ), linked_service_lines AS (
    SELECT DISTINCT soi.id,soi.service_order_id,soi.strap_batch_item_id,
      soi.strap_variant_id,soi.base_product_id,soi.finished_product_id,
      soi.sent_at,soi.line_status,soi.delivered_qty,soi.meters
      FROM public.service_order_items soi
     WHERE soi.sale_order_strap_demand_id IN (SELECT id FROM demand_ids)
        OR EXISTS(SELECT 1 FROM public.strap_production_batch_contributions c
          JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
          WHERE c.service_order_item_id=soi.id)
  ), custody AS (
    SELECT l.id AS service_order_item_id,
      coalesce(sum(m.quantity) FILTER (WHERE m.movement_type='sent'),0) AS sent_m,
      coalesce(sum(m.quantity) FILTER (WHERE m.movement_type='returned'),0) AS returned_m,
      coalesce(sum(m.quantity) FILTER (WHERE m.movement_type='consumed'),0) AS consumed_m,
      coalesce(sum(m.quantity) FILTER (WHERE m.movement_type='lost'),0) AS lost_m,
      coalesce(sum(m.quantity) FILTER (WHERE m.movement_type='adjusted'),0) AS adjusted_m,
      coalesce(sum(CASE WHEN m.movement_type='sent' THEN m.quantity
        WHEN m.movement_type='adjusted' THEN m.quantity ELSE -m.quantity END),0) AS balance_m,
      coalesce(jsonb_agg(m.id ORDER BY m.occurred_at,m.id)
        FILTER (WHERE m.id IS NOT NULL),'[]'::jsonb) AS movement_ids
      FROM linked_service_lines l
      LEFT JOIN public.contractor_material_custody_movements m
        ON m.service_order_item_id=l.id
       AND m.service_order_id=l.service_order_id
       AND m.base_product_id=l.base_product_id
     GROUP BY l.id
  ), immutable_facts AS (
    SELECT 'purchase_document_frozen_with_open_balance'::text AS fact_type,
      c.id AS entity_id,
      jsonb_build_object(
        'contribution_id',c.id,'purchase_order_id',c.purchase_order_id,
        'purchase_order_item_id',c.purchase_order_item_id,
        'contribution_status',c.status,'purchase_order_status',po.status,
        'snapshot_locked_at',po.snapshot_locked_at,
        'committed_quantity_stock_unit',c.committed_quantity_stock_unit,
        'accepted_quantity_stock_unit',c.accepted_quantity_stock_unit,
        'open_quantity_stock_unit',greatest(0,c.committed_quantity_stock_unit
          -c.accepted_quantity_stock_unit)
      ) AS detail
      FROM public.purchase_demand_contributions c
      JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
      LEFT JOIN public.purchase_orders po ON po.id=c.purchase_order_id
     WHERE greatest(0,c.committed_quantity_stock_unit-c.accepted_quantity_stock_unit)>0.000001
       AND (po.snapshot_locked_at IS NOT NULL
         OR c.status IN ('approved','sent','partial','received'))
       AND lower(btrim(coalesce(po.status,''))) NOT IN
         ('cancelled','canceled','cancelado','cancelada','reversed','estornado')
    UNION ALL
    SELECT 'purchase_allocation_inconsistent',c.id,
      jsonb_build_object('contribution_id',c.id,
        'accepted_quantity_stock_unit',c.accepted_quantity_stock_unit,
        'allocated_receipt_m',coalesce((SELECT sum(a.accepted_stock_quantity)
          FROM public.purchase_receipt_allocations a
          WHERE a.purchase_demand_contribution_id=c.id),0))
      FROM public.purchase_demand_contributions c
      JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
     WHERE abs(c.accepted_quantity_stock_unit-coalesce((SELECT sum(a.accepted_stock_quantity)
       FROM public.purchase_receipt_allocations a
       WHERE a.purchase_demand_contribution_id=c.id),0))>0.000001
    UNION ALL
    SELECT 'contractor_custody_open',l.id,
      jsonb_build_object(
        'service_order_item_id',l.id,'service_order_id',l.service_order_id,
        'sent_at',l.sent_at,'sent_m',c.sent_m,'returned_m',c.returned_m,
        'consumed_m',c.consumed_m,'lost_m',c.lost_m,'adjusted_m',c.adjusted_m,
        'balance_in_custody_m',c.balance_m,'movement_ids',c.movement_ids
      )
      FROM linked_service_lines l JOIN custody c ON c.service_order_item_id=l.id
     WHERE abs(c.balance_m)>0.000001
    UNION ALL
    SELECT 'contractor_dispatch_inconsistent',l.id,
      jsonb_build_object(
        'service_order_item_id',l.id,'sent_at',l.sent_at,
        'sent_m',c.sent_m,'returned_m',c.returned_m,'movement_ids',c.movement_ids,
        'diagnostic','sent_at sem remessa estrutural correspondente'
      )
      FROM linked_service_lines l JOIN custody c ON c.service_order_item_id=l.id
     WHERE (l.sent_at IS NOT NULL AND c.sent_m<=0)
        OR (l.sent_at IS NULL AND c.sent_m>0)
    UNION ALL
    SELECT 'contractor_custody_link_inconsistent',m.id,
      jsonb_build_object('custody_movement_id',m.id,
        'service_order_item_id',l.id,'expected_service_order_id',l.service_order_id,
        'actual_service_order_id',m.service_order_id,
        'expected_base_product_id',l.base_product_id,
        'actual_base_product_id',m.base_product_id)
      FROM linked_service_lines l
      JOIN public.contractor_material_custody_movements m
        ON m.service_order_item_id=l.id
     WHERE m.service_order_id IS DISTINCT FROM l.service_order_id
        OR m.base_product_id IS DISTINCT FROM l.base_product_id
    UNION ALL
    SELECT 'contractor_claim_pending',cl.id,
      jsonb_build_object('claim_id',cl.id,'service_order_item_id',cl.service_order_item_id,
        'status',cl.status,'lost_quantity',cl.lost_quantity)
      FROM public.contractor_loss_claims cl
      JOIN linked_service_lines l ON l.id=cl.service_order_item_id
     WHERE cl.status='pending'
    UNION ALL
    SELECT 'contractor_rework_pending',rr.id,
      jsonb_build_object('rework_request_id',rr.id,
        'service_order_item_id',rr.service_order_item_id,'status',rr.status,
        'approved_m',rr.approved_m,'sent_m',rr.sent_m)
      FROM public.strap_rework_material_requests rr
      JOIN linked_service_lines l ON l.id=rr.service_order_item_id
     WHERE rr.status IN ('pending','approved')
    UNION ALL
    SELECT 'physical_reconciliation_pending',pr.id,
      jsonb_build_object('pending_reconciliation_id',pr.id,
        'production_receipt_id',pr.production_receipt_id,
        'reconciliation_type',pr.reconciliation_type,
        'expected_quantity',pr.expected_quantity,'posted_quantity',pr.posted_quantity)
      FROM public.strap_pending_reconciliations pr
      JOIN public.strap_production_receipt_allocations ra
        ON ra.production_receipt_id=pr.production_receipt_id
      JOIN public.strap_production_batch_contributions c
        ON c.id=ra.batch_contribution_id
      JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
     WHERE pr.status='pending'
    UNION ALL
    SELECT 'production_allocation_inconsistent',c.id,
      jsonb_build_object('contribution_id',c.id,'delivered_m',c.delivered_m,
        'allocated_receipt_m',coalesce((SELECT sum(ra.approved_m)
          FROM public.strap_production_receipt_allocations ra
          WHERE ra.batch_contribution_id=c.id),0))
      FROM public.strap_production_batch_contributions c
      JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
     WHERE abs(c.delivered_m-coalesce((SELECT sum(ra.approved_m)
       FROM public.strap_production_receipt_allocations ra
       WHERE ra.batch_contribution_id=c.id),0))>0.000001
    UNION ALL
    SELECT 'consumption_without_physical_origin',r.id,
      jsonb_build_object('reservation_id',r.id,'source',r.source,
        'product_id',r.product_id,'quantity_consumed',r.quantity_consumed)
      FROM public.material_reservations r
      JOIN demand_ids d ON d.id=r.sale_order_strap_demand_id
     WHERE coalesce(r.quantity_consumed,0)>0 AND (
       (r.source='strap_engine_finished' AND NOT EXISTS(
         SELECT 1 FROM public.stock_movements sm
          WHERE sm.material_reservation_id=r.id AND sm.movement_type='out'
            AND sm.product_id=r.product_id AND sm.finished_product_id=r.product_id))
       OR (r.source='strap_engine_base' AND NOT EXISTS(
         SELECT 1 FROM public.strap_production_receipts pr
          WHERE pr.batch_item_id=r.strap_batch_item_id
            AND pr.base_product_id=r.product_id AND pr.base_consumed_m>0))
       OR r.source NOT IN ('strap_engine_finished','strap_engine_base')
     )
  ), preserved_facts AS (
    SELECT 'purchase_receipt'::text AS fact_type,c.id AS entity_id,
      jsonb_build_object('contribution_id',c.id,'source_mode','buy_ready',
        'accepted_quantity_stock_unit',c.accepted_quantity_stock_unit,
        'receipt_allocation_ids',coalesce((SELECT jsonb_agg(a.id ORDER BY a.id)
          FROM public.purchase_receipt_allocations a
          WHERE a.purchase_demand_contribution_id=c.id),'[]'::jsonb)) AS detail
      FROM public.purchase_demand_contributions c
      JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
     WHERE c.accepted_quantity_stock_unit>0
    UNION ALL
    SELECT 'production_receipt',c.id,
      jsonb_build_object('contribution_id',c.id,'source_mode','internal',
        'delivered_m',c.delivered_m,
        'receipt_allocation_ids',coalesce((SELECT jsonb_agg(a.id ORDER BY a.id)
          FROM public.strap_production_receipt_allocations a
          WHERE a.batch_contribution_id=c.id),'[]'::jsonb))
      FROM public.strap_production_batch_contributions c
      JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
     WHERE c.delivered_m>0
    UNION ALL
    SELECT 'finished_stock_consumption',r.id,
      jsonb_build_object('reservation_id',r.id,'quantity_consumed',r.quantity_consumed,
        'stock_movement_ids',coalesce((SELECT jsonb_agg(sm.id ORDER BY sm.created_at,sm.id)
          FROM public.stock_movements sm WHERE sm.material_reservation_id=r.id),'[]'::jsonb))
      FROM public.material_reservations r
      JOIN demand_ids d ON d.id=r.sale_order_strap_demand_id
     WHERE r.source='strap_engine_finished' AND coalesce(r.quantity_consumed,0)>0
    UNION ALL
    SELECT 'contractor_history',l.id,
      jsonb_build_object('service_order_item_id',l.id,'sent_at',l.sent_at,
        'sent_m',c.sent_m,'returned_m',c.returned_m,'consumed_m',c.consumed_m,
        'lost_m',c.lost_m,'adjusted_m',c.adjusted_m,'movement_ids',c.movement_ids)
      FROM linked_service_lines l JOIN custody c ON c.service_order_item_id=l.id
     WHERE l.sent_at IS NOT NULL OR jsonb_array_length(c.movement_ids)>0
    UNION ALL
    SELECT 'contractor_production_receipt',r.id,
      jsonb_build_object('production_receipt_id',r.id,
        'service_order_item_id',r.service_order_item_id,
        'approved_m',r.approved_m,'rejected_m',r.rejected_m,
        'base_consumed_m',r.base_consumed_m,'base_returned_m',r.base_returned_m)
      FROM linked_service_lines l
      JOIN public.strap_production_receipts r
        ON r.service_order_item_id=l.id
       AND r.batch_item_id=l.strap_batch_item_id
       AND r.strap_variant_id=l.strap_variant_id
       AND r.base_product_id=l.base_product_id
       AND r.finished_product_id=l.finished_product_id
    UNION ALL
    SELECT 'contractor_loss_claim',cl.id,
      jsonb_build_object('claim_id',cl.id,
        'service_order_item_id',cl.service_order_item_id,'status',cl.status,
        'lost_quantity',cl.lost_quantity,'claim_amount',cl.claim_amount)
      FROM linked_service_lines l
      JOIN public.contractor_loss_claims cl
        ON cl.service_order_item_id=l.id
       AND cl.service_order_id=l.service_order_id
       AND cl.base_product_id=l.base_product_id
     WHERE cl.status<>'pending'
  ), reversible_state AS (
    SELECT jsonb_build_object(
      'current_demand_ids',coalesce((SELECT jsonb_agg(d.id ORDER BY d.id)
        FROM public.sale_order_strap_demands d JOIN demand_ids x ON x.id=d.id
        WHERE d.is_current AND d.status<>'cancelled'),'[]'::jsonb),
      'reservation_ids',coalesce((SELECT jsonb_agg(r.id ORDER BY r.id)
        FROM public.material_reservations r JOIN demand_ids d ON d.id=r.sale_order_strap_demand_id
        WHERE r.status IN ('reserved','partially_consumed')
          AND r.quantity_reserved-coalesce(r.quantity_consumed,0)>0.000001),'[]'::jsonb),
      'purchase_contribution_ids',coalesce((SELECT jsonb_agg(c.id ORDER BY c.id)
        FROM public.purchase_demand_contributions c
        JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
        LEFT JOIN public.purchase_orders po ON po.id=c.purchase_order_id
        WHERE c.status IN ('proposed','awaiting_approval','suspended')
           OR (c.status IN ('approved','sent','partial')
             AND lower(btrim(coalesce(po.status,''))) IN
               ('cancelled','canceled','cancelado','cancelada','reversed','estornado'))),'[]'::jsonb),
      'production_contribution_ids',coalesce((SELECT jsonb_agg(c.id ORDER BY c.id)
        FROM public.strap_production_batch_contributions c
        JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
        WHERE c.status IN ('planned','in_progress','partial','suspended')),'[]'::jsonb),
      'service_order_item_ids',coalesce((SELECT jsonb_agg(soi.id ORDER BY soi.id)
        FROM linked_service_lines soi
        WHERE soi.line_status NOT IN ('Entregue','Cancelado')),'[]'::jsonb),
      'batch_item_ids',coalesce((SELECT jsonb_agg(DISTINCT c.batch_item_id ORDER BY c.batch_item_id)
        FROM public.strap_production_batch_contributions c
        JOIN demand_ids d ON d.id=c.sale_order_strap_demand_id
        WHERE c.status IN ('planned','in_progress','partial','suspended')),'[]'::jsonb)
    ) AS detail
  )
  SELECT jsonb_build_object(
    'immutable_blockers',coalesce((SELECT jsonb_agg(
      jsonb_build_object('type',f.fact_type,'entity_id',f.entity_id,'detail',f.detail)
      ORDER BY f.fact_type,f.entity_id) FROM immutable_facts f),'[]'::jsonb),
    'preserved_realized_facts',coalesce((SELECT jsonb_agg(
      jsonb_build_object('type',f.fact_type,'entity_id',f.entity_id,'detail',f.detail)
      ORDER BY f.fact_type,f.entity_id) FROM preserved_facts f),'[]'::jsonb),
    'reversible',r.detail
  ) FROM reversible_state r;
$$;

-- Encerra somente o saldo futuro da revisao antiga. Recebimentos, allocations,
-- movimentos, consumo e snapshots permanecem apontando para a demanda antiga;
-- reserva parcialmente consumida libera apenas quantity_reserved-consumed.
CREATE OR REPLACE FUNCTION public.neutralize_strap_source_override_promises(
  p_sale_order_strap_demand_ids uuid[],
  p_reason text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_ids uuid[]:=ARRAY[]::uuid[];
  v_batch_item_ids uuid[]:=ARRAY[]::uuid[];
  v_batch_ids uuid[]:=ARRAY[]::uuid[];
  v_service_item_ids uuid[]:=ARRAY[]::uuid[];
  v_id uuid;
  v_lock record;
  v_item public.strap_production_batch_items%ROWTYPE;
  v_total numeric;
  v_released_finished numeric:=0;
  v_released_base numeric:=0;
  v_reservation_count integer:=0;
  v_purchase_count integer:=0;
  v_production_count integer:=0;
  v_service_count integer:=0;
  v_count integer:=0;
BEGIN
  IF nullif(btrim(p_reason),'') IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'Neutralizacao de origem exige motivo e correlation_id';
  END IF;
  PERFORM set_config('app.strap_engine_write','1',true);
  PERFORM set_config('app.strap_po_engine','1',true);
  FOR v_lock IN
    SELECT DISTINCT d.base_product_id AS id
      FROM public.sale_order_strap_demands d
     WHERE d.id=ANY(coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
       AND d.base_product_id IS NOT NULL ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-base-netting:'||v_lock.id::text,0));
  END LOOP;
  FOR v_lock IN
    SELECT DISTINCT d.strap_variant_id AS id
      FROM public.sale_order_strap_demands d
     WHERE d.id=ANY(coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-variant:'||v_lock.id::text,0));
  END LOOP;

  WITH targets AS (
    SELECT r.id,r.source,
      greatest(r.quantity_reserved-coalesce(r.quantity_consumed,0),0) AS released_m
      FROM public.material_reservations r
     WHERE r.sale_order_strap_demand_id=ANY(
       coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
       AND r.status IN ('reserved','partially_consumed')
       AND r.quantity_reserved-coalesce(r.quantity_consumed,0)>0.000001
     FOR UPDATE
  ), changed AS (
    UPDATE public.material_reservations r SET
      quantity_reserved=coalesce(r.quantity_consumed,0),
      status=CASE WHEN coalesce(r.quantity_consumed,0)>0 THEN 'consumed' ELSE 'cancelled' END,
      notes=coalesce(r.notes,'')||' | saldo futuro liberado por override de origem',
      metadata=coalesce(r.metadata,'{}'::jsonb)||jsonb_build_object(
        'source_override_correlation_id',p_correlation_id,
        'source_override_reason',btrim(p_reason))
      FROM targets t WHERE r.id=t.id
      RETURNING t.source,t.released_m
  )
  SELECT coalesce(sum(released_m) FILTER (WHERE source='strap_engine_finished'),0),
         coalesce(sum(released_m) FILTER (WHERE source='strap_engine_base'),0),
         count(*)::integer
    INTO v_released_finished,v_released_base,v_reservation_count FROM changed;

  SELECT coalesce(array_agg(DISTINCT c.purchase_order_id)
    FILTER (WHERE c.purchase_order_id IS NOT NULL),ARRAY[]::uuid[])
    INTO v_po_ids
    FROM public.purchase_demand_contributions c
    LEFT JOIN public.purchase_orders po ON po.id=c.purchase_order_id
   WHERE c.sale_order_strap_demand_id=ANY(
     coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
     AND (c.status IN ('proposed','awaiting_approval','suspended')
       OR (c.status IN ('approved','sent','partial')
         AND lower(btrim(coalesce(po.status,''))) IN
           ('cancelled','canceled','cancelado','cancelada','reversed','estornado')));
  UPDATE public.purchase_demand_contributions c SET
    status=CASE WHEN c.status IN ('proposed','awaiting_approval','suspended')
      THEN 'cancelled' ELSE 'superseded' END,
    suspension_reason='Saldo futuro neutralizado por override: '||btrim(p_reason),
    correlation_id=p_correlation_id
    FROM public.purchase_orders po
   WHERE c.sale_order_strap_demand_id=ANY(
     coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
     AND po.id=c.purchase_order_id
     AND (c.status IN ('proposed','awaiting_approval','suspended')
       OR (c.status IN ('approved','sent','partial')
         AND lower(btrim(coalesce(po.status,''))) IN
           ('cancelled','canceled','cancelado','cancelada','reversed','estornado')));
  GET DIAGNOSTICS v_purchase_count=ROW_COUNT;
  -- Contribuicao proposta ainda nao materializada nao possui purchase_order.
  UPDATE public.purchase_demand_contributions c SET status='cancelled',
    suspension_reason='Saldo futuro neutralizado por override: '||btrim(p_reason),
    correlation_id=p_correlation_id
   WHERE c.sale_order_strap_demand_id=ANY(
     coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
     AND c.purchase_order_id IS NULL
     AND c.status IN ('proposed','awaiting_approval','suspended');
  GET DIAGNOSTICS v_count=ROW_COUNT;
  v_purchase_count:=v_purchase_count+v_count;

  SELECT coalesce(array_agg(DISTINCT c.batch_item_id),ARRAY[]::uuid[]),
         coalesce(array_agg(DISTINCT c.service_order_item_id)
           FILTER (WHERE c.service_order_item_id IS NOT NULL),ARRAY[]::uuid[])
    INTO v_batch_item_ids,v_service_item_ids
    FROM public.strap_production_batch_contributions c
   WHERE c.sale_order_strap_demand_id=ANY(
     coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
     AND c.status IN ('planned','in_progress','partial','suspended');
  SELECT coalesce(array_agg(DISTINCT bi.batch_id),ARRAY[]::uuid[])
    INTO v_batch_ids FROM public.strap_production_batch_items bi
   WHERE bi.id=ANY(v_batch_item_ids);

  -- delivered_m e receipt allocations ficam intactos. superseded significa
  -- apenas que planned_m-delivered_m deixou de ser promessa futura.
  UPDATE public.strap_production_batch_contributions SET
    status='superseded',correlation_id=p_correlation_id
   WHERE sale_order_strap_demand_id=ANY(
     coalesce(p_sale_order_strap_demand_ids,ARRAY[]::uuid[]))
     AND status IN ('planned','in_progress','partial','suspended');
  GET DIAGNOSTICS v_production_count=ROW_COUNT;

  UPDATE public.service_order_items soi SET line_status='Cancelado',
    suspension_reason='Saldo futuro neutralizado por override: '||btrim(p_reason)
   WHERE soi.id=ANY(v_service_item_ids)
     AND soi.line_status NOT IN ('Entregue','Cancelado')
     AND NOT EXISTS(SELECT 1 FROM public.strap_production_batch_contributions c
       WHERE c.service_order_item_id=soi.id
         AND c.status NOT IN ('fulfilled','cancelled','superseded'))
     AND NOT EXISTS(SELECT 1
       FROM public.contractor_material_custody_movements m
       WHERE m.service_order_item_id=soi.id
       GROUP BY m.service_order_item_id
       HAVING abs(sum(CASE WHEN m.movement_type='sent' THEN m.quantity
         WHEN m.movement_type='adjusted' THEN m.quantity ELSE -m.quantity END))>0.000001)
     AND NOT EXISTS(SELECT 1 FROM public.contractor_loss_claims cl
       WHERE cl.service_order_item_id=soi.id AND cl.status='pending')
     AND NOT EXISTS(SELECT 1 FROM public.strap_rework_material_requests rr
       WHERE rr.service_order_item_id=soi.id AND rr.status IN ('pending','approved'));
  GET DIAGNOSTICS v_service_count=ROW_COUNT;

  FOREACH v_id IN ARRAY v_service_item_ids LOOP
    PERFORM public.reconcile_strap_service_order_completion(v_id,p_correlation_id,
      'Encerramento do saldo futuro por override de origem');
  END LOOP;

  FOREACH v_id IN ARRAY v_batch_item_ids LOOP
    SELECT * INTO v_item FROM public.strap_production_batch_items
     WHERE id=v_id FOR UPDATE;
    IF v_item.started_at IS NULL AND v_item.delivered_m=0 THEN
      SELECT coalesce(sum(c.planned_m),0) INTO v_total
        FROM public.strap_production_batch_contributions c
       WHERE c.batch_item_id=v_id
         AND c.status IN ('planned','in_progress','partial');
      UPDATE public.strap_executor_daily_capacity_allocations
         SET status='superseded',updated_at=now()
       WHERE batch_item_id=v_id AND status='active';
      UPDATE public.strap_production_batch_items SET
        planned_finished_m=v_total,
        planned_base_m=v_total/confirmed_yield_snapshot,
        scheduled_m=0,unscheduled_m=v_total,
        status=CASE WHEN v_total=0 THEN 'cancelled' ELSE 'planned' END,
        updated_at=now()
       WHERE id=v_id;
      IF v_total>0 THEN
        PERFORM public.schedule_strap_batch_item(v_id,
          'Reagendamento apos override de origem',p_correlation_id);
      END IF;
    ELSIF NOT EXISTS(SELECT 1 FROM public.strap_production_batch_contributions c
      WHERE c.batch_item_id=v_id
        AND c.status NOT IN ('fulfilled','cancelled','superseded')) THEN
      -- Documento iniciado nao e reescrito. A conclusao explicita registra
      -- que o restante foi abandonado, mantendo plano, realizado e started_at.
      UPDATE public.strap_production_batch_items SET status='completed',
        completed_at=coalesce(completed_at,now()),updated_at=now() WHERE id=v_id;
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_batch_ids LOOP
    IF NOT EXISTS(SELECT 1 FROM public.strap_production_batch_items bi
      WHERE bi.batch_id=v_id AND bi.status NOT IN ('completed','cancelled')) THEN
      UPDATE public.strap_production_batches b SET
        status=CASE WHEN b.started_at IS NOT NULL OR EXISTS(
          SELECT 1 FROM public.strap_production_batch_items bi
          WHERE bi.batch_id=b.id AND (bi.started_at IS NOT NULL OR bi.delivered_m>0))
          THEN 'completed' ELSE 'cancelled' END,
        completed_at=CASE WHEN b.started_at IS NOT NULL OR EXISTS(
          SELECT 1 FROM public.strap_production_batch_items bi
          WHERE bi.batch_id=b.id AND (bi.started_at IS NOT NULL OR bi.delivered_m>0))
          THEN coalesce(b.completed_at,now()) ELSE NULL END,
        suspension_reason='Saldo futuro neutralizado por override: '||btrim(p_reason),
        correlation_id=p_correlation_id,updated_at=now()
       WHERE b.id=v_id;
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_po_ids LOOP
    IF EXISTS(SELECT 1 FROM public.purchase_orders po WHERE po.id=v_id
      AND po.snapshot_locked_at IS NULL
      AND po.status IN ('draft','pending','Pendente')) THEN
      PERFORM public.recalculate_open_strap_purchase_order(v_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'released_finished_stock_m',v_released_finished,
    'released_base_stock_m',v_released_base,
    'released_reservation_count',v_reservation_count,
    'neutralized_purchase_contribution_count',v_purchase_count,
    'neutralized_production_contribution_count',v_production_count,
    'closed_service_order_item_count',v_service_count,
    'affected_purchase_order_ids',to_jsonb(v_po_ids),
    'affected_batch_item_ids',to_jsonb(v_batch_item_ids),
    'preserved_facts',true,'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_version_and_guard_sale_order_item_strap_sourcing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_key text; v_value jsonb; v_committed boolean := false; v_correlation_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.strap_sourcing IS NOT DISTINCT FROM OLD.strap_sourcing THEN
    NEW.strap_sourcing_revision:=OLD.strap_sourcing_revision;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' AND NEW.strap_sourcing='{}'::jsonb THEN
    NEW.strap_sourcing_revision:=0;
    RETURN NEW;
  END IF;
  IF auth.role()<>'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode definir a origem da tira no PV';
  END IF;
  IF TG_OP='UPDATE'
     AND current_setting('app.strap_source_rpc',true) IS DISTINCT FROM '1'
     AND current_setting('app.strap_source_admin_override',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Atualizacao direta de strap_sourcing bloqueada; use a RPC com revisao esperada';
  END IF;
  IF jsonb_typeof(NEW.strap_sourcing)<>'object' THEN
    RAISE EXCEPTION 'strap_sourcing deve ser objeto por UUID tecnico';
  END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(NEW.strap_sourcing) LOOP
    BEGIN PERFORM v_key::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Chave de linha tecnica invalida: %',v_key; END;
    IF jsonb_typeof(v_value)<>'object'
       OR v_value->>'source_mode' NOT IN ('internal','buy_ready')
       OR nullif(v_value->>'strap_variant_id','') IS NULL THEN
      RAISE EXCEPTION 'Origem/variante persistida invalida para linha %',v_key;
    END IF;
    BEGIN PERFORM (v_value->>'strap_variant_id')::uuid;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'UUID da variante invalido para linha %',v_key; END;
  END LOOP;

  IF TG_OP='INSERT' THEN
    NEW.strap_sourcing_revision:=1;
    v_correlation_id:=gen_random_uuid();
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('sale_order_item',NEW.id,'insert',NULL,
      jsonb_build_object('strap_sourcing',NEW.strap_sourcing,
        'strap_sourcing_revision',NEW.strap_sourcing_revision),
      'Escolha inicial de origem no PV',v_correlation_id,auth.uid());
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.sale_order_strap_demands d
    WHERE d.sale_order_item_id=OLD.id
      AND (
        OLD.strap_sourcing->d.technical_strap_line_id::text->>'source_mode'
          IS DISTINCT FROM NEW.strap_sourcing->d.technical_strap_line_id::text->>'source_mode'
        OR nullif(OLD.strap_sourcing->d.technical_strap_line_id::text->>'strap_variant_id','')::uuid
          IS DISTINCT FROM nullif(NEW.strap_sourcing->d.technical_strap_line_id::text->>'strap_variant_id','')::uuid
      ) AND (
      EXISTS(SELECT 1 FROM public.purchase_demand_contributions c
        JOIN public.purchase_orders po ON po.id=c.purchase_order_id
        WHERE c.sale_order_strap_demand_id=d.id
          AND (po.snapshot_locked_at IS NOT NULL
            OR c.status IN ('approved','sent','partial','received')))
      OR EXISTS(SELECT 1 FROM public.strap_production_batch_contributions c
        JOIN public.strap_production_batch_items bi ON bi.id=c.batch_item_id
        JOIN public.strap_production_batches b ON b.id=bi.batch_id
        LEFT JOIN public.service_order_items soi ON soi.id=c.service_order_item_id
        WHERE c.sale_order_strap_demand_id=d.id
          AND (b.started_at IS NOT NULL OR bi.started_at IS NOT NULL OR soi.sent_at IS NOT NULL
            OR c.status IN ('in_progress','partial','fulfilled')))
      OR public.strap_demand_has_external_commitment(d.id)
    )
  ) INTO v_committed;
  IF v_committed AND current_setting('app.strap_source_admin_override',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Origem comprometida: use override_sale_order_item_strap_sourcing com motivo';
  END IF;
  IF v_committed AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode trocar origem apos compromisso';
  END IF;
  NEW.strap_sourcing_revision:=OLD.strap_sourcing_revision+1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_version_guard_sale_order_item_strap_sourcing ON public.sale_order_items;
CREATE TRIGGER trg_version_guard_sale_order_item_strap_sourcing
  BEFORE UPDATE OF strap_sourcing,strap_sourcing_revision ON public.sale_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_version_and_guard_sale_order_item_strap_sourcing();
DROP TRIGGER IF EXISTS trg_guard_sale_order_item_strap_sourcing_insert ON public.sale_order_items;
CREATE TRIGGER trg_guard_sale_order_item_strap_sourcing_insert
  BEFORE INSERT ON public.sale_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_version_and_guard_sale_order_item_strap_sourcing();

CREATE OR REPLACE FUNCTION public.set_sale_order_item_strap_sourcing(
  p_sale_order_item_id uuid,
  p_expected_revision integer,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_item public.sale_order_items%ROWTYPE; v_before jsonb;
  v_key text; v_value jsonb; v_correlation_id uuid:=gen_random_uuid();
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode definir a origem da tira no PV';
  END IF;
  IF jsonb_typeof(p_lines) <> 'object' THEN RAISE EXCEPTION 'p_lines deve ser objeto por UUID tecnico'; END IF;
  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_sale_order_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do PV nao encontrado'; END IF;
  IF v_item.strap_sourcing_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Edicao concorrente: revisao atual %, esperada %',
      v_item.strap_sourcing_revision, p_expected_revision USING ERRCODE = '40001';
  END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_lines) LOOP
    BEGIN PERFORM v_key::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Chave de linha tecnica invalida: %', v_key; END;
    IF jsonb_typeof(v_value) <> 'object' OR v_value ->> 'source_mode' NOT IN ('internal','buy_ready') THEN
      RAISE EXCEPTION 'Origem invalida para linha %', v_key;
    END IF;
  END LOOP;
  v_before:=jsonb_build_object('strap_sourcing',v_item.strap_sourcing,
    'strap_sourcing_revision',v_item.strap_sourcing_revision);
  PERFORM set_config('app.strap_source_rpc','1',true);
  UPDATE public.sale_order_items
     SET strap_sourcing = p_lines
   WHERE id = p_sale_order_item_id
   RETURNING * INTO v_item;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('sale_order_item',v_item.id,'update',v_before,
    jsonb_build_object('strap_sourcing',v_item.strap_sourcing,
      'strap_sourcing_revision',v_item.strap_sourcing_revision),
    'Escolha de origem no PV',v_correlation_id,auth.uid());
  RETURN jsonb_build_object('sale_order_item_id', v_item.id,
    'strap_sourcing_revision', v_item.strap_sourcing_revision,
    'strap_sourcing', v_item.strap_sourcing,'correlation_id',v_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.override_sale_order_item_strap_sourcing(
  p_sale_order_item_id uuid,
  p_expected_revision integer,
  p_lines jsonb,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_before_state jsonb;
  v_after_state jsonb;
  v_blockers jsonb;
  v_neutralization jsonb:='{}'::jsonb;
  v_changed_demand_ids uuid[]:=ARRAY[]::uuid[];
  v_new_demand_ids uuid[]:=ARRAY[]::uuid[];
  v_job_id uuid;
  v_job_status text;
  v_worker_id text;
  v_process_result jsonb;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode trocar origem comprometida';
  END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatorio'; END IF;
  IF jsonb_typeof(p_lines)<>'object' THEN RAISE EXCEPTION 'p_lines deve ser objeto'; END IF;
  SELECT * INTO v_item FROM public.sale_order_items WHERE id=p_sale_order_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item do PV nao encontrado'; END IF;
  IF v_item.strap_sourcing_revision<>p_expected_revision THEN
    RAISE EXCEPTION 'Edicao concorrente: revisao atual %, esperada %',
      v_item.strap_sourcing_revision,p_expected_revision USING ERRCODE='40001';
  END IF;

  SELECT coalesce(array_agg(d.id ORDER BY d.id),ARRAY[]::uuid[])
    INTO v_changed_demand_ids
    FROM public.sale_order_strap_demands d
   WHERE d.sale_order_item_id=v_item.id AND d.is_current
     AND (nullif(p_lines->d.technical_strap_line_id::text->>'strap_variant_id','')::uuid
          IS DISTINCT FROM d.strap_variant_id
       OR p_lines->d.technical_strap_line_id::text->>'source_mode'
          IS DISTINCT FROM d.source_mode);
  v_before_state:=public.inspect_strap_source_override_state(v_changed_demand_ids);
  v_blockers:=coalesce(v_before_state->'immutable_blockers','[]'::jsonb);
  IF jsonb_array_length(v_blockers)>0 THEN
    RAISE EXCEPTION 'Troca de origem bloqueada por saldo fisico/documental aberto'
      USING ERRCODE='55000',
        DETAIL=jsonb_build_object(
          'code','strap_source_override_blocked',
          'sale_order_item_id',v_item.id,
          'blocked_facts',v_blockers,
          'preserved_realized_facts',v_before_state->'preserved_realized_facts',
          'required_action','Concilie custodia/pendencia ou cancele o saldo congelado pelo fluxo documental'
        )::text,
        HINT='Recebimento/consumo concluido e preservado; somente saldo congelado, custodia ou inconsistencia aberta bloqueiam';
  END IF;
  v_before:=jsonb_build_object('strap_sourcing',v_item.strap_sourcing,
    'strap_sourcing_revision',v_item.strap_sourcing_revision,
    'changed_demand_ids',to_jsonb(v_changed_demand_ids),
    'override_state',v_before_state);

  IF cardinality(v_changed_demand_ids)>0 THEN
    v_neutralization:=public.neutralize_strap_source_override_promises(
      v_changed_demand_ids,p_reason,p_correlation_id);
  END IF;
  PERFORM set_config('app.strap_source_admin_override','1',true);
  PERFORM set_config('app.strap_source_rpc','1',true);
  UPDATE public.sale_order_items SET strap_sourcing=p_lines WHERE id=v_item.id
    RETURNING * INTO v_item;

  IF cardinality(v_changed_demand_ids)>0 THEN
    -- A troca administrativa so confirma depois que o worker neutralizar as
    -- promessas reversiveis na propria transacao. Qualquer retry/error aborta
    -- tambem a alteracao de strap_sourcing.
    v_job_id:=public.enqueue_sale_order_strap_demands(
      v_item.sale_order_id,'item_updated',p_correlation_id);
    IF v_job_id IS NULL THEN
      RAISE EXCEPTION 'Troca administrativa nao gerou job de reconciliacao' USING ERRCODE='55000';
    END IF;
    v_worker_id:='admin-override:'||p_correlation_id::text;
    UPDATE public.strap_demand_jobs SET status='processing',attempts=attempts+1,
      locked_at=now(),locked_by=v_worker_id,last_error=NULL
     WHERE id=v_job_id AND status IN ('queued','retry');
    SELECT status,result INTO v_job_status,v_process_result
      FROM public.strap_demand_jobs WHERE id=v_job_id;
    IF v_job_status='processing' THEN
      v_process_result:=public.process_strap_demand_job(v_job_id,v_worker_id);
      SELECT status,result INTO v_job_status,v_process_result
        FROM public.strap_demand_jobs WHERE id=v_job_id;
    ELSIF v_job_status<>'completed' THEN
      RAISE EXCEPTION 'Job do override nao pode ser reconciliado no estado %',v_job_status
        USING ERRCODE='55000';
    END IF;
    IF v_job_status<>'completed' OR coalesce(v_process_result ? 'error',false)
       OR coalesce((v_process_result->>'blocked')::integer,0)>0 THEN
      RAISE EXCEPTION 'Reconciliacao atomica da troca de origem falhou'
        USING ERRCODE='55000',
          DETAIL=jsonb_build_object('code','strap_source_override_reconciliation_failed',
            'job_id',v_job_id,'job_status',v_job_status,
            'reconciliation',v_process_result)::text;
    END IF;

    SELECT coalesce(array_agg(d.id ORDER BY d.id),ARRAY[]::uuid[])
      INTO v_new_demand_ids
      FROM public.sale_order_strap_demands d
     WHERE d.is_current AND d.supersedes_demand_id=ANY(v_changed_demand_ids);
    UPDATE public.sale_order_strap_demands d SET
      calculation_explanation=coalesce(d.calculation_explanation,'{}'::jsonb)
        ||jsonb_build_object('admin_source_override',jsonb_build_object(
          'previous_demand_ids',to_jsonb(v_changed_demand_ids),
          'preserved_realized_facts',v_before_state->'preserved_realized_facts',
          'released_to_free_stock_m',coalesce(
            (v_neutralization->>'released_finished_stock_m')::numeric,0),
          'new_identity',jsonb_build_object(
            'strap_variant_id',d.strap_variant_id,
            'source_mode',d.source_mode,
            'gross_required_m',d.gross_required_m,
            'inherited_fulfilled_m',d.fulfilled_m,
            'inherited_cancelled_m',d.cancelled_m,
            'coverage_policy','global_priority_netting'),
          'correlation_id',p_correlation_id,
          'reason',btrim(p_reason)))
     WHERE d.id=ANY(v_new_demand_ids);
  END IF;

  v_after_state:=public.inspect_strap_source_override_state(v_changed_demand_ids);
  IF jsonb_array_length(coalesce(v_after_state->'immutable_blockers','[]'::jsonb))>0
     OR jsonb_array_length(v_after_state->'reversible'->'current_demand_ids')>0
     OR jsonb_array_length(v_after_state->'reversible'->'reservation_ids')>0
     OR jsonb_array_length(v_after_state->'reversible'->'purchase_contribution_ids')>0
     OR jsonb_array_length(v_after_state->'reversible'->'production_contribution_ids')>0
     OR jsonb_array_length(v_after_state->'reversible'->'service_order_item_ids')>0
     OR jsonb_array_length(v_after_state->'reversible'->'batch_item_ids')>0
     OR EXISTS (SELECT 1 FROM public.sale_order_strap_demands d
          WHERE d.id=ANY(v_new_demand_ids)
            AND (coalesce(d.fulfilled_m,0)<>0 OR coalesce(d.cancelled_m,0)<>0)) THEN
    RAISE EXCEPTION 'Troca de origem deixou promessa antiga sem neutralizar'
      USING ERRCODE='55000',
        DETAIL=jsonb_build_object('code','strap_source_override_postcondition_failed',
          'changed_demand_ids',to_jsonb(v_changed_demand_ids),
          'new_demand_state',(SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id',d.id,'strap_variant_id',d.strap_variant_id,
            'source_mode',d.source_mode,'gross_required_m',d.gross_required_m,
            'fulfilled_m',d.fulfilled_m,'cancelled_m',d.cancelled_m) ORDER BY d.id),'[]'::jsonb)
            FROM public.sale_order_strap_demands d WHERE d.id=ANY(v_new_demand_ids)),
          'remaining_state',v_after_state)::text;
  END IF;
  v_after:=jsonb_build_object('strap_sourcing',v_item.strap_sourcing,
    'strap_sourcing_revision',v_item.strap_sourcing_revision,
    'changed_demand_ids',to_jsonb(v_changed_demand_ids),
    'new_demand_ids',to_jsonb(v_new_demand_ids),
    'override_state',v_after_state,'job_id',v_job_id,
    'neutralization',v_neutralization,'reconciliation',v_process_result);
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('sale_order_item',v_item.id,'override_source',v_before,v_after,
    btrim(p_reason),p_correlation_id,auth.uid());
  RETURN jsonb_build_object('code','strap_source_override_applied',
    'sale_order_item_id',v_item.id,
    'strap_sourcing_revision',v_item.strap_sourcing_revision,
    'strap_sourcing',v_item.strap_sourcing,'correlation_id',p_correlation_id,
    'changed_demand_ids',to_jsonb(v_changed_demand_ids),
    'new_demand_ids',to_jsonb(v_new_demand_ids),
    'neutralization',jsonb_build_object('before',v_before_state,
      'actions',v_neutralization,'after',v_after_state,
      'preserved_realized_facts',v_before_state->'preserved_realized_facts',
      'fully_reconciled',true),
    'job_id',v_job_id,'reconciliation',v_process_result);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Fila persistente, validacao na confirmacao e gatilhos de enqueue
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enqueue_strap_demand_job(
  p_source_type text,
  p_source_id uuid,
  p_source_revision integer,
  p_schedule_revision integer,
  p_event_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_hash text := public.strap_payload_hash(p_payload); v_existing public.strap_demand_jobs%ROWTYPE; v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF p_source_type NOT IN ('sale_order','strap_variant','stock','purchase_order','production_batch','service_order','custody') THEN
    RAISE EXCEPTION 'source_type invalido';
  END IF;
  IF nullif(btrim(p_idempotency_key), '') IS NULL THEN RAISE EXCEPTION 'idempotency_key obrigatoria'; END IF;
  IF jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'payload deve ser objeto'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));

  SELECT * INTO v_existing FROM public.strap_demand_jobs
   WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'Replay idempotente com payload divergente para %', p_idempotency_key
        USING ERRCODE = '22000';
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.strap_demand_jobs (
    source_type, source_id, source_revision, schedule_revision, event_type,
    payload, semantic_hash, idempotency_key, payload_hash, correlation_id
  ) VALUES (
    p_source_type, p_source_id, greatest(coalesce(p_source_revision,0),0),
    greatest(coalesce(p_schedule_revision,0),0), p_event_type,
    p_payload, v_hash, p_idempotency_key, v_hash, p_correlation_id
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Mudancas no ledger de custodia alteram strap_base_available_now sem tocar
-- products.quantity. Este fan-out persiste, na mesma transacao do movimento,
-- um job idempotente para cada variante estruturalmente afetada pelo produto
-- exato. Nao usa nome/cor/group_id e nao e chamado na remessa, que apenas move
-- oferta ja reservada da fabrica para custodia sem devolve-la ao pool livre.
CREATE OR REPLACE FUNCTION public.enqueue_strap_base_availability_reconciliation(
  p_base_product_id uuid,
  p_origin_variant_id uuid,
  p_custody_movement_id uuid,
  p_availability_delta_m numeric,
  p_reason text,
  p_correlation_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant record;
  v_movement_type text;
  v_key text;
  v_count integer:=0;
BEGIN
  IF p_base_product_id IS NULL OR p_origin_variant_id IS NULL
     OR p_custody_movement_id IS NULL OR p_correlation_id IS NULL
     OR coalesce(p_availability_delta_m,0)=0
     OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Fan-out de disponibilidade de napa exige IDs, delta e motivo';
  END IF;
  SELECT m.movement_type INTO v_movement_type
    FROM public.contractor_material_custody_movements m
   WHERE m.id=p_custody_movement_id
     AND m.base_product_id=p_base_product_id;
  IF NOT FOUND OR v_movement_type NOT IN ('returned','adjusted') THEN
    RAISE EXCEPTION 'Movimento de custodia nao altera disponibilidade reconciliavel';
  END IF;

  FOR v_variant IN
    SELECT DISTINCT affected.id
      FROM (
        SELECT p_origin_variant_id AS id
        UNION
        SELECT d.strap_variant_id
          FROM public.sale_order_strap_demands d
         WHERE d.base_product_id=p_base_product_id AND d.is_current
           AND d.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT f.strap_variant_id
          FROM public.strap_stock_floor_contributions f
         WHERE f.base_product_id=p_base_product_id AND f.is_current
           AND f.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT v.id
          FROM public.artisanal_strap_variants v
          JOIN public.base_material_color_official_products op
            ON op.base_group_id=v.base_group_id
           AND op.color_id=v.color_id
           AND op.official_product_id=p_base_product_id
         WHERE v.status='active'
      ) affected
      JOIN public.artisanal_strap_variants v ON v.id=affected.id
     WHERE affected.id IS NOT NULL
     ORDER BY affected.id
  LOOP
    v_key:=format('strap-custody-availability:%s:%s',
      p_custody_movement_id,v_variant.id);
    PERFORM public.enqueue_strap_demand_job(
      'custody',p_custody_movement_id,0,0,'custody_availability_changed',
      jsonb_build_object(
        'strap_variant_id',v_variant.id,
        'base_product_id',p_base_product_id,
        'custody_movement_id',p_custody_movement_id,
        'movement_type',v_movement_type,
        'availability_delta_m',p_availability_delta_m,
        'reason',btrim(p_reason)
      ),v_key,p_correlation_id
    );
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_strap_financial_snapshot(
  p_source_mode text,
  p_recipe_id uuid,
  p_base_product_id uuid,
  p_finished_product_id uuid,
  p_confirmed_yield numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base public.products%ROWTYPE;
  v_finished public.products%ROWTYPE;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_planned_unit_cost numeric;
BEGIN
  IF p_source_mode='internal' THEN
    IF p_recipe_id IS NULL OR p_base_product_id IS NULL
       OR coalesce(p_confirmed_yield,0)<=0 THEN
      RAISE EXCEPTION 'Identidade financeira interna incompleta';
    END IF;
    SELECT * INTO v_recipe FROM public.artisanal_strap_recipes
     WHERE id=p_recipe_id AND confirmed_yield_m_per_m=p_confirmed_yield;
    SELECT * INTO v_base FROM public.products WHERE id=p_base_product_id;
    IF v_recipe.id IS NULL OR v_base.id IS NULL THEN
      RAISE EXCEPTION 'Receita/base financeira interna nao encontrada';
    END IF;
    v_planned_unit_cost:=coalesce(v_base.unit_price,0)/p_confirmed_yield
      +coalesce(v_recipe.transformation_cost_per_m,0);
    RETURN jsonb_build_object(
      'source_mode','internal',
      'planned_unit_cost',v_planned_unit_cost,
      'base_unit_cost_snapshot',coalesce(v_base.unit_price,0),
      'transformation_cost_per_m_snapshot',coalesce(v_recipe.transformation_cost_per_m,0),
      'recipe_id',v_recipe.id,
      'recipe_version',v_recipe.version,
      'confirmed_yield_snapshot',p_confirmed_yield,
      'captured_at',now());
  ELSIF p_source_mode='buy_ready' THEN
    SELECT * INTO v_finished FROM public.products WHERE id=p_finished_product_id;
    IF v_finished.id IS NULL OR coalesce(v_finished.purchase_price,0)<=0
       OR coalesce(v_finished.conversion_rate,0)<=0 THEN
      RAISE EXCEPTION 'Cadastro financeiro da tira pronta incompleto';
    END IF;
    v_planned_unit_cost:=v_finished.purchase_price/v_finished.conversion_rate;
    RETURN jsonb_build_object(
      'source_mode','buy_ready',
      'planned_unit_cost',v_planned_unit_cost,
      'purchase_price_snapshot',v_finished.purchase_price,
      'conversion_rate_snapshot',v_finished.conversion_rate,
      'finished_product_id',v_finished.id,
      'captured_at',now());
  END IF;
  RAISE EXCEPTION 'Origem financeira de tira invalida: %',p_source_mode;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_sale_order_strap_demands(
  p_sale_order_id uuid,
  p_event_type text DEFAULT 'confirmed',
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_lines jsonb;
  v_block_count integer;
  v_source_revision integer;
  v_schedule_revision integer;
  v_anchor date;
  v_payload jsonb;
  v_hash text;
  v_key text;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PV nao encontrado'; END IF;

  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'sale_order_item_id', p.sale_order_item_id,
      'technical_strap_line_id', p.technical_strap_line_id,
      'strap_variant_id', p.strap_variant_id,
      'source_mode', p.source_mode,
      'gross_required_m', p.gross_required_m,
      'recipe_id', p.recipe_id,
      'base_product_id', p.base_product_id,
      'finished_product_id', p.finished_product_id,
      'blocking_reasons', p.blocking_reasons,
      'resolved', p.resolved
    ) ORDER BY p.sale_order_item_id, p.technical_strap_line_id), '[]'::jsonb),
    count(*) FILTER (WHERE jsonb_array_length(p.blocking_reasons) > 0)
    INTO v_lines, v_block_count
    FROM public.preview_sale_order_strap_demand(p_sale_order_id) p;

  IF jsonb_array_length(v_lines)=0
     AND p_event_type IN ('confirmed','approved','direct_production')
     AND EXISTS (
       SELECT 1
         FROM public.sale_order_items i
         JOIN public.technical_sheets ts ON ts.id=i.reference_id
        WHERE i.sale_order_id=p_sale_order_id
          AND (
            coalesce(ts.has_straps,false)
            OR (jsonb_typeof(coalesce(ts.strap_colors,'[]'::jsonb))='array'
              AND jsonb_array_length(coalesce(ts.strap_colors,'[]'::jsonb))>0)
          )
          AND (
            coalesce(jsonb_typeof(i.strap_colors),'null')<>'array'
            OR jsonb_array_length(coalesce(i.strap_colors,'[]'::jsonb))=0
          )
     ) THEN
    RAISE EXCEPTION 'PV possui referencia com tiras, mas o item nao congelou strap_colors; revise a ficha e o item antes de confirmar'
      USING ERRCODE='check_violation';
  END IF;
  IF jsonb_array_length(v_lines)=0
     AND p_event_type IN ('confirmed','approved','direct_production')
     AND NOT EXISTS (SELECT 1 FROM public.sale_order_strap_demands d
       WHERE d.sale_order_id=p_sale_order_id AND d.is_current) THEN RETURN NULL; END IF;
  IF p_event_type IN ('confirmed','approved','direct_production') AND v_block_count > 0 THEN
    RAISE EXCEPTION 'PV possui % linha(s) de tira bloqueada(s); consulte preview_sale_order_strap_demand', v_block_count
      USING ERRCODE = 'check_violation';
  END IF;

  -- O preview publico mascara custos para Comercial/Producao. Como esta RPC
  -- e SECURITY DEFINER, congela o snapshot financeiro no mesmo evento de
  -- confirmacao sem devolver os valores ao chamador. O worker nunca depende
  -- de campos financeiros redigidos pelo preview da UI.
  SELECT coalesce(jsonb_agg(
    CASE WHEN jsonb_array_length(coalesce(x.value->'blocking_reasons','[]'::jsonb))>0
      THEN x.value
      ELSE x.value||jsonb_build_object('financial_snapshot',
        public.capture_strap_financial_snapshot(
          x.value->>'source_mode',
          nullif(x.value->>'recipe_id','')::uuid,
          nullif(x.value->>'base_product_id','')::uuid,
          (x.value->>'finished_product_id')::uuid,
          nullif(x.value->'resolved'->>'confirmed_yield_m_per_m','')::numeric))
    END ORDER BY x.ord), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(v_lines) WITH ORDINALITY x(value,ord);

  SELECT coalesce(max(strap_sourcing_revision),0) INTO v_source_revision
    FROM public.sale_order_items WHERE sale_order_id = p_sale_order_id;
  SELECT coalesce(max(nullif(x.value -> 'resolved' ->> 'schedule_revision','')::integer),0)
    INTO v_schedule_revision FROM jsonb_array_elements(v_lines) x(value);

  v_anchor := public.resolve_strap_sale_order_billing_anchor(p_sale_order_id);
  IF v_anchor IS NULL THEN
    IF p_event_type IN ('confirmed','approved','direct_production') THEN
      RAISE EXCEPTION 'Semana de faturamento do PV nao resolve uma data ancora';
    END IF;
    v_anchor := coalesce(v_so.delivery_deadline, current_date);
  END IF;

  v_payload := jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'sale_order_status', v_so.status,
    'event_type', p_event_type,
    'billing_anchor', v_anchor,
    'billing_year', extract(year FROM v_anchor)::integer,
    'billing_month', extract(month FROM v_anchor)::integer,
    'billing_fortnight', CASE WHEN extract(day FROM v_anchor) <= 15 THEN 1 ELSE 2 END,
    'source_revision', v_source_revision,
    'schedule_revision', v_schedule_revision,
    'requested_by', auth.uid(),
    'lines', v_lines
  );
  v_hash := public.strap_payload_hash(v_payload);
  v_key := format('sale_order:%s:%s:%s:%s', p_sale_order_id, p_event_type, v_source_revision, v_hash);
  RETURN public.enqueue_strap_demand_job(
    'sale_order', p_sale_order_id, v_source_revision, v_schedule_revision,
    p_event_type, v_payload, v_key, p_correlation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_event text;
BEGIN
  IF NEW.status IN ('Aprovado','Em Produção') AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_event := CASE WHEN NEW.status = 'Em Produção' THEN 'direct_production' ELSE 'approved' END;
    PERFORM public.enqueue_sale_order_strap_demands(NEW.id, v_event, gen_random_uuid());
  ELSIF NEW.status IN ('Cancelado','Cancelada') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.enqueue_sale_order_strap_demands(NEW.id, 'cancelled', gen_random_uuid());
  ELSIF NEW.status IN ('Aprovado','Em Produção')
     AND (NEW.billing_week IS DISTINCT FROM OLD.billing_week
       OR NEW.delivery_month IS DISTINCT FROM OLD.delivery_month
       OR NEW.delivery_week IS DISTINCT FROM OLD.delivery_week
       OR NEW.delivery_deadline IS DISTINCT FROM OLD.delivery_deadline) THEN
    PERFORM public.enqueue_sale_order_strap_demands(NEW.id, 'schedule_changed', gen_random_uuid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_sale_order_confirm ON public.sale_orders;
CREATE TRIGGER trg_enqueue_strap_demands_on_sale_order_confirm
  AFTER UPDATE OF status, billing_week, delivery_month, delivery_week, delivery_deadline
  ON public.sale_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_sale_order_confirm();

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text; v_sale_order_id uuid;
BEGIN
  v_sale_order_id:=CASE WHEN TG_OP='DELETE' THEN OLD.sale_order_id ELSE NEW.sale_order_id END;
  SELECT status INTO v_status FROM public.sale_orders WHERE id = v_sale_order_id;
  IF v_status IN ('Aprovado','Em Produção') THEN
    PERFORM public.enqueue_sale_order_strap_demands(v_sale_order_id,
      CASE WHEN TG_OP='INSERT' THEN 'approved' ELSE 'item_updated' END,gen_random_uuid());
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_item_change ON public.sale_order_items;
CREATE CONSTRAINT TRIGGER trg_enqueue_strap_demands_on_item_change
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_item_change();

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order_id uuid; v_sale_order_id uuid; v_status text;
BEGIN
  v_order_id:=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  SELECT o.sale_order_id,so.status INTO v_sale_order_id,v_status
    FROM public.orders o JOIN public.sale_orders so ON so.id=o.sale_order_id
   WHERE o.id=v_order_id;
  IF v_sale_order_id IS NOT NULL AND v_status IN ('Aprovado','Em Produção') THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      v_sale_order_id,'schedule_changed',gen_random_uuid());
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_schedule_change ON public.production_schedule;
CREATE CONSTRAINT TRIGGER trg_enqueue_strap_demands_on_schedule_change
  AFTER INSERT OR UPDATE OR DELETE ON public.production_schedule
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_schedule_change();

CREATE OR REPLACE FUNCTION public.claim_next_strap_demand_job(p_worker_id text)
RETURNS public.strap_demand_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_job public.strap_demand_jobs%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL THEN RAISE EXCEPTION 'worker_id obrigatorio'; END IF;

  SELECT * INTO v_job
    FROM public.strap_demand_jobs
   WHERE status IN ('queued','retry') AND next_attempt_at <= now()
   ORDER BY next_attempt_at, created_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.strap_demand_jobs
     SET status = 'processing', attempts = attempts + 1,
         locked_at = now(), locked_by = p_worker_id, last_error = NULL
   WHERE id = v_job.id
   RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Adaptador pre-netted para OC: contribuicao, consolidacao e congelamento
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.strap_committed_purchase_inbound(
  p_product_id uuid,
  p_sale_order_strap_demand_id uuid DEFAULT NULL,
  p_stock_floor_contribution_id uuid DEFAULT NULL,
  p_needed_at date DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- A oferta comprometida e fisica por item de OC, nao a soma das
  -- contribuicoes. Assim o excedente inevitavel de MOQ/pacote continua livre
  -- para a proxima demanda, sem ser atribuido ficticiamente ao primeiro PV.
  WITH physical_inbound AS (
    SELECT coalesce(sum(
      greatest(0, i.quantity - coalesce(i.received_quantity,0))
      * i.conversion_rate_snapshot
    ),0) AS quantity_stock_unit
    FROM public.purchase_order_items i
    JOIN public.purchase_orders po ON po.id=i.purchase_order_id
    WHERE po.source_type='strap_demand'
      AND po.snapshot_locked_at IS NOT NULL
      AND po.status IN ('approved','sent','partial')
      AND i.product_id=p_product_id
      AND i.conversion_rate_snapshot>0
      AND (p_needed_at IS NULL
        OR coalesce(po.promised_date,i.needed_at)<=p_needed_at)
  ), allocated_elsewhere AS (
    SELECT coalesce(sum(x.quantity_stock_unit),0) AS quantity_stock_unit
    FROM (
      SELECT d.committed_finished_inbound_m AS quantity_stock_unit
      FROM public.sale_order_strap_demands d
      WHERE d.is_current AND d.source_mode='buy_ready'
        AND d.finished_product_id=p_product_id
        AND d.id IS DISTINCT FROM p_sale_order_strap_demand_id
        AND d.status NOT IN ('superseded','cancelled','error','fulfilled')
      UNION ALL
      SELECT d.base_inbound_allocated_m
      FROM public.sale_order_strap_demands d
      WHERE d.is_current AND d.source_mode='internal'
        AND d.base_product_id=p_product_id
        AND d.id IS DISTINCT FROM p_sale_order_strap_demand_id
        AND d.status NOT IN ('superseded','cancelled','error','fulfilled')
      UNION ALL
      SELECT f.committed_finished_inbound_m
      FROM public.strap_stock_floor_contributions f
      WHERE f.is_current AND f.source_mode='buy_ready'
        AND f.finished_product_id=p_product_id
        AND f.id IS DISTINCT FROM p_stock_floor_contribution_id
        AND f.status NOT IN ('superseded','cancelled','fulfilled')
      UNION ALL
      SELECT f.base_inbound_allocated_m
      FROM public.strap_stock_floor_contributions f
      WHERE f.is_current AND f.source_mode='internal'
        AND f.base_product_id=p_product_id
        AND f.id IS DISTINCT FROM p_stock_floor_contribution_id
        AND f.status NOT IN ('superseded','cancelled','fulfilled')
    ) x
  )
  SELECT greatest(0,p.quantity_stock_unit-a.quantity_stock_unit)
  FROM physical_inbound p CROSS JOIN allocated_elsewhere a;
$$;

CREATE OR REPLACE FUNCTION public.upsert_strap_purchase_contribution(
  p_sale_order_strap_demand_id uuid,
  p_stock_floor_contribution_id uuid,
  p_purchase_product_id uuid,
  p_required_quantity_stock_unit numeric,
  p_needed_at date,
  p_billing_anchor date,
  p_billing_year integer,
  p_billing_month integer,
  p_billing_fortnight smallint,
  p_correlation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_supplier public.suppliers%ROWTYPE;
  v_existing public.purchase_demand_contributions%ROWTYPE;
  v_source_type text;
  v_sale_order_id uuid;
  v_sale_order_item_id uuid;
  v_variant_id uuid;
  v_stock_unit text;
  v_purchase_unit text;
  v_rate numeric;
  v_moq numeric;
  v_multiple numeric;
  v_price numeric;
  v_terms jsonb;
  v_lead integer;
  v_prep integer;
  v_status text := 'proposed';
  v_reason text;
  v_provisional boolean;
  v_revision integer;
  v_payload jsonb;
  v_hash text;
  v_id uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF num_nonnulls(p_sale_order_strap_demand_id, p_stock_floor_contribution_id) <> 1 THEN
    RAISE EXCEPTION 'Contribuicao de compra exige exatamente uma origem';
  END IF;
  IF coalesce(p_required_quantity_stock_unit, 0) < 0 THEN
    RAISE EXCEPTION 'Quantidade pre-netted nao pode ser negativa';
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_purchase_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto de compra nao encontrado'; END IF;

  IF p_sale_order_strap_demand_id IS NOT NULL THEN
    v_source_type := 'pv_automatico';
    SELECT d.sale_order_id, d.sale_order_item_id, d.strap_variant_id
      INTO v_sale_order_id, v_sale_order_item_id, v_variant_id
      FROM public.sale_order_strap_demands d
     WHERE d.id = p_sale_order_strap_demand_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Demanda de tira nao encontrada'; END IF;
  ELSE
    v_source_type := 'strap_stock_floor';
    SELECT f.strap_variant_id INTO v_variant_id
      FROM public.strap_stock_floor_contributions f
     WHERE f.id = p_stock_floor_contribution_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contribuicao de piso nao encontrada'; END IF;
  END IF;

  v_stock_unit := coalesce(nullif(btrim(v_product.unit), ''), 'un');
  v_purchase_unit := nullif(btrim(v_product.purchase_unit), '');
  v_rate := coalesce(v_product.conversion_rate, CASE WHEN v_purchase_unit = v_stock_unit THEN 1 ELSE 0 END);
  v_moq := coalesce(v_product.min_order_quantity, 0);
  v_multiple := coalesce(v_product.purchase_multiple, 0);
  v_price := coalesce(v_product.purchase_price, 0);
  v_prep := coalesce(v_product.material_preparation_days, 2);

  IF v_product.supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier FROM public.suppliers
     WHERE id = v_product.supplier_id;
  END IF;
  v_provisional := v_supplier.id IS NULL;
  IF v_supplier.lead_time_days IS NOT NULL AND v_supplier.lead_time_days < 0 THEN
    v_lead := 15;
    v_reason := 'Lead time negativo no fornecedor; corrija o cadastro';
  ELSE
    v_lead := coalesce(nullif(v_supplier.lead_time_days,0),15);
  END IF;
  v_terms:=coalesce(
    v_supplier.payment_terms_structured,
    public.normalize_strap_payment_terms(v_supplier.payment_terms)
  );

  IF v_reason IS NOT NULL THEN
    NULL;
  ELSIF v_stock_unit <> 'm' THEN
    v_reason := format('Unidade de estoque invalida para tira/napa: %s', v_stock_unit);
  ELSIF v_purchase_unit IS NULL THEN
    v_reason := 'Unidade de compra ausente';
  ELSIF v_rate <= 0 OR (v_purchase_unit = v_stock_unit AND v_rate <> 1) THEN
    v_reason := 'Conversao de compra invalida';
  ELSIF v_moq <= 0 THEN
    v_reason := 'Quantidade minima de compra ausente/invalida';
  ELSIF v_multiple <= 0 THEN
    v_reason := 'Multiplo/pacote de compra ausente/invalido';
  ELSIF v_price <= 0 THEN
    v_reason := 'Preco de compra ausente/invalido';
  ELSIF NOT public.is_valid_strap_payment_terms(v_terms) THEN
    v_reason := 'Condicao de pagamento vazia ou nao calculavel';
  ELSIF v_prep < 0 OR v_lead < 0 THEN
    v_reason := 'Lead time ou preparo invalido';
  END IF;
  -- Cadastro incompleto bloqueia aprovacao, mas nao equivale a rejeicao
  -- administrativa. Suspensao e sempre uma acao atomica sobre a OC inteira.

  SELECT * INTO v_existing
    FROM public.purchase_demand_contributions c
   WHERE c.purchase_product_id = p_purchase_product_id
     -- Deve espelhar o conjunto do indice unico de contribuicao aberta. Uma
     -- suspensao administrativa e uma fotografia preservada, nao permissao
     -- para inserir uma segunda contribuicao concorrente.
     AND c.status IN ('proposed','awaiting_approval','suspended')
     AND ((p_sale_order_strap_demand_id IS NOT NULL
       AND c.sale_order_strap_demand_id = p_sale_order_strap_demand_id)
       OR (p_stock_floor_contribution_id IS NOT NULL
       AND c.strap_stock_floor_contribution_id = p_stock_floor_contribution_id))
   FOR UPDATE;

  IF v_existing.id IS NOT NULL AND v_existing.status='suspended' THEN
    -- A demanda corrente continua sendo recalculada no PV, mas a fotografia
    -- comercial rejeitada pelo Administrador nao e reescrita nem duplicada.
    UPDATE public.purchase_demand_contributions
       SET correlation_id=p_correlation_id
     WHERE id=v_existing.id;
    RETURN v_existing.id;
  END IF;

  IF p_required_quantity_stock_unit = 0 THEN
    IF v_existing.id IS NOT NULL THEN
      v_before:=to_jsonb(v_existing);
      UPDATE public.purchase_demand_contributions
         SET status = 'cancelled', suspended_from_status = NULL,
             suspension_reason = 'Falta liquida zerada por reconciliacao'
       WHERE id = v_existing.id RETURNING to_jsonb(purchase_demand_contributions.*) INTO v_after;
      INSERT INTO public.artisanal_strap_operational_audit_log(
        entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
      VALUES('purchase_demand_contribution',v_existing.id,'cancel',v_before,v_after,
        'Falta liquida zerada por reconciliacao',p_correlation_id,auth.uid());
      RETURN v_existing.id;
    END IF;
    RETURN NULL;
  END IF;

  v_payload := jsonb_build_object(
    'source_type', v_source_type,
    'sale_order_strap_demand_id', p_sale_order_strap_demand_id,
    'stock_floor_contribution_id', p_stock_floor_contribution_id,
    'product_id', p_purchase_product_id,
    'required_stock_unit', p_required_quantity_stock_unit,
    'needed_at', p_needed_at,
    'billing_anchor', p_billing_anchor,
    'billing_year', p_billing_year,
    'billing_month', p_billing_month,
    'billing_fortnight', p_billing_fortnight,
    'supplier_id', v_supplier.id,
    'stock_unit', v_stock_unit,
    'purchase_unit', v_purchase_unit,
    'conversion_rate', v_rate,
    'min_order_quantity', v_moq,
    'purchase_multiple', v_multiple,
    'purchase_price', v_price,
    'payment_terms', v_terms,
    'lead_time_days', v_lead,
    'preparation_days', v_prep,
    'status', v_status,
    'suspension_reason', v_reason
  );
  v_hash := public.strap_payload_hash(v_payload);

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.payload_hash = v_hash THEN
      UPDATE public.purchase_demand_contributions
         SET correlation_id = p_correlation_id WHERE id = v_existing.id;
      RETURN v_existing.id;
    END IF;
    v_before:=to_jsonb(v_existing);
    UPDATE public.purchase_demand_contributions
       SET supplier_id = v_supplier.id,
           required_quantity_stock_unit = p_required_quantity_stock_unit,
           needed_at = p_needed_at,
           expected_at = p_needed_at,
           billing_anchor = p_billing_anchor,
           billing_year = p_billing_year,
           billing_month = p_billing_month,
           billing_fortnight = p_billing_fortnight,
           stock_unit = v_stock_unit,
           purchase_unit_snapshot = v_purchase_unit,
           conversion_rate_snapshot = greatest(v_rate, 0),
           min_order_quantity_snapshot = greatest(v_moq, 0),
           purchase_multiple_snapshot = greatest(v_multiple, 0),
           purchase_price_snapshot = greatest(v_price, 0),
           supplier_lead_time_days_snapshot = greatest(v_lead, 0),
           material_preparation_days_snapshot = greatest(v_prep, 0),
           payment_condition_snapshot = v_supplier.payment_terms,
           payment_terms_snapshot = v_terms,
           provisional = v_provisional,
           status = CASE WHEN v_existing.purchase_order_id IS NOT NULL
             THEN 'awaiting_approval' ELSE 'proposed' END,
           suspended_from_status = NULL,
           suspension_reason = v_reason,
           payload_hash = v_hash,
           correlation_id = p_correlation_id
     WHERE id = v_existing.id
     RETURNING id,to_jsonb(purchase_demand_contributions.*) INTO v_id,v_after;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('purchase_demand_contribution',v_id,'reconcile',v_before,v_after,
      coalesce(v_reason,'Contribuicao recalculada'),p_correlation_id,auth.uid());
    RETURN v_id;
  END IF;

  SELECT coalesce(max(c.contribution_revision), 0) + 1 INTO v_revision
    FROM public.purchase_demand_contributions c
   WHERE c.purchase_product_id = p_purchase_product_id
     AND ((p_sale_order_strap_demand_id IS NOT NULL
       AND c.sale_order_strap_demand_id = p_sale_order_strap_demand_id)
       OR (p_stock_floor_contribution_id IS NOT NULL
       AND c.strap_stock_floor_contribution_id = p_stock_floor_contribution_id));

  INSERT INTO public.purchase_demand_contributions (
    source_type, sale_order_id, sale_order_item_id, sale_order_strap_demand_id,
    strap_stock_floor_contribution_id, purchase_product_id, strap_variant_id,
    supplier_id, required_quantity_stock_unit, needed_at, expected_at,
    billing_anchor, billing_year, billing_month, billing_fortnight,
    stock_unit, purchase_unit_snapshot, conversion_rate_snapshot,
    min_order_quantity_snapshot, purchase_multiple_snapshot, purchase_price_snapshot,
    supplier_lead_time_days_snapshot, material_preparation_days_snapshot,
    payment_condition_snapshot, provisional, contribution_revision, status,
    payment_terms_snapshot,
    suspended_from_status, suspension_reason, operation_type, idempotency_key,
    payload_hash, correlation_id
  ) VALUES (
    v_source_type, v_sale_order_id, v_sale_order_item_id, p_sale_order_strap_demand_id,
    p_stock_floor_contribution_id, p_purchase_product_id, v_variant_id,
    v_supplier.id, p_required_quantity_stock_unit, p_needed_at, p_needed_at,
    p_billing_anchor, p_billing_year, p_billing_month, p_billing_fortnight,
    v_stock_unit, v_purchase_unit, greatest(v_rate, 0), greatest(v_moq, 0),
    greatest(v_multiple, 0), greatest(v_price, 0), greatest(v_lead, 0),
    greatest(v_prep, 0), v_supplier.payment_terms, v_provisional, v_revision, v_status,
    v_terms,
    NULL, v_reason,
    'strap_purchase_contribution',
    format('%s:%s:%s:r%s', v_source_type,
      coalesce(p_sale_order_strap_demand_id, p_stock_floor_contribution_id),
      p_purchase_product_id, v_revision),
    v_hash, p_correlation_id
  ) RETURNING id INTO v_id;
  SELECT to_jsonb(c) INTO v_after FROM public.purchase_demand_contributions c WHERE c.id=v_id;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('purchase_demand_contribution',v_id,'insert',NULL,v_after,
    coalesce(v_reason,'Contribuicao automatica criada'),p_correlation_id,auth.uid());
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_strap_purchase_order_commercial_snapshot(
  p_purchase_order_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'purchase_order_id',po.id,
    'order_number',po.order_number,
    'billing_year',po.billing_year,
    'billing_month',po.billing_month,
    'billing_fortnight',po.billing_fortnight,
    'provisional',po.provisional,
    'purchase_by_date',po.purchase_by_date,
    'promised_date',po.promised_date,
    'payment_condition',po.payment_condition_snapshot,
    'payment_terms',po.payment_terms_snapshot,
    'notes',po.notes,
    'supplier',CASE WHEN s.id IS NULL THEN jsonb_build_object(
      'id',NULL,'name','OC Provisoria - Sem fornecedor') ELSE jsonb_build_object(
      'id',s.id,'name',s.name,'trade_name',s.trade_name,'cnpj',s.cnpj,'ie',s.ie,
      'contact_name',s.contact_name,'phone',s.phone,'email',s.email,
      'address',s.address,'city',s.city,'state',s.state,'zip_code',s.zip_code) END,
    'delivery_company',(
      SELECT jsonb_build_object(
        'id',c.id,'cnpj',c.cnpj,'razao_social',c.razao_social,
        'nome_fantasia',c.nome_fantasia,'logradouro',c.logradouro,'numero',c.numero,
        'complemento',c.complemento,'bairro',c.bairro,'cidade',c.cidade,
        'uf',c.uf,'cep',c.cep)
      FROM public.companies c
      WHERE c.active AND c.is_primary
    ),
    'items',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'purchase_order_item_id',i.id,'product_id',i.product_id,
        'product_name',p.name,'product_sku',p.sku,'strap_variant_id',i.strap_variant_id,
        'quantity',i.quantity,'calculated_quantity',i.suggested_quantity,
        'manual_quantity',i.strap_manual_quantity,
        'manual_adjustment_reason',i.strap_manual_adjustment_reason,
        'unit',i.unit,'unit_price',i.unit_price,
        'stock_unit',i.stock_unit_snapshot,'purchase_unit',i.purchase_unit_snapshot,
        'conversion_rate',i.conversion_rate_snapshot,
        'minimum_order_quantity',i.min_order_quantity_snapshot,
        'purchase_multiple',i.purchase_multiple_snapshot,
        'preparation_days',i.preparation_days_snapshot,'needed_at',i.needed_at,
        'contributions',coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id',pc.id,'source_type',pc.source_type,
            'sale_order_id',pc.sale_order_id,'sale_order_item_id',pc.sale_order_item_id,
            'sale_order_number',so.order_number,
            'stock_floor_contribution_id',pc.strap_stock_floor_contribution_id,
            'label',coalesce(so.order_number,'Reposicao de estoque minimo'),
            'required_stock_quantity',pc.required_quantity_stock_unit,
            'needed_at',pc.needed_at
          ) ORDER BY pc.needed_at,pc.id)
          FROM public.purchase_demand_contributions pc
          LEFT JOIN public.sale_orders so ON so.id=pc.sale_order_id
          WHERE pc.purchase_order_item_id=i.id
            AND pc.status IN ('awaiting_approval','approved','sent','partial','received')
        ),'[]'::jsonb)
      ) ORDER BY p.name,p.sku,i.id)
      FROM public.purchase_order_items i
      JOIN public.products p ON p.id=i.product_id
      WHERE i.purchase_order_id=po.id
    ),'[]'::jsonb)
  )
  FROM public.purchase_orders po
  LEFT JOIN public.suppliers s ON s.id=po.supplier_id
  WHERE po.id=p_purchase_order_id AND po.source_type='strap_demand';
$$;

CREATE OR REPLACE FUNCTION public.refresh_strap_purchase_order_commercial_snapshot(
  p_purchase_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_po public.purchase_orders%ROWTYPE; v_snapshot jsonb; v_digest text;
  v_supplier jsonb; v_delivery jsonb;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders
   WHERE id=p_purchase_order_id AND source_type='strap_demand' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC automatica nao encontrada'; END IF;
  IF v_po.snapshot_locked_at IS NOT NULL THEN
    RETURN jsonb_build_object('commercial_revision',v_po.commercial_revision,
      'commercial_digest',v_po.commercial_digest,'locked',true);
  END IF;
  v_snapshot:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);
  v_digest:=public.strap_payload_hash(v_snapshot);
  v_supplier:=v_snapshot->'supplier';
  v_delivery:=v_snapshot->'delivery_company';
  PERFORM set_config('app.strap_po_engine','1',true);
  UPDATE public.purchase_orders SET
    supplier_snapshot=v_supplier,delivery_company_snapshot=v_delivery,
    commercial_revision=CASE WHEN commercial_digest IS DISTINCT FROM v_digest
      THEN commercial_revision+1 ELSE commercial_revision END,
    approval_preflight_token=CASE WHEN commercial_digest IS DISTINCT FROM v_digest
      THEN NULL ELSE approval_preflight_token END,
    approval_preflight_by=CASE WHEN commercial_digest IS DISTINCT FROM v_digest
      THEN NULL ELSE approval_preflight_by END,
    approval_preflight_actor_name=CASE WHEN commercial_digest IS DISTINCT FROM v_digest
      THEN NULL ELSE approval_preflight_actor_name END,
    approval_preflight_at=CASE WHEN commercial_digest IS DISTINCT FROM v_digest
      THEN NULL ELSE approval_preflight_at END,
    approval_preflight_revision=CASE WHEN commercial_digest IS DISTINCT FROM v_digest
      THEN NULL ELSE approval_preflight_revision END,
    approval_preflight_digest=CASE WHEN commercial_digest IS DISTINCT FROM v_digest
      THEN NULL ELSE approval_preflight_digest END,
    commercial_digest=v_digest
   WHERE id=v_po.id RETURNING * INTO v_po;
  RETURN jsonb_build_object('commercial_revision',v_po.commercial_revision,
    'commercial_digest',v_po.commercial_digest,'supplier_snapshot',v_po.supplier_snapshot,
    'delivery_company_snapshot',v_po.delivery_company_snapshot,'locked',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_strap_purchase_order_notifications(
  p_purchase_order_id uuid,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_po public.purchase_orders%ROWTYPE; v_open numeric:=0; v_criticality text:='Normal';
  v_previous text; v_count integer:=0; v_rows integer;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders
   WHERE id=p_purchase_order_id AND source_type='strap_demand' FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  INSERT INTO public.strap_operational_notifications(
    event_key,event_type,purchase_order_id,title,message,payload,correlation_id)
  VALUES('strap-po:'||v_po.id||':created','purchase_order_created',v_po.id,
    'Nova ordem de compra automatica',
    format('A OC %s esta aguardando aprovacao.',coalesce(v_po.order_number,v_po.id::text)),
    jsonb_build_object('purchase_order_id',v_po.id,'status',v_po.status,
      'commercial_revision',v_po.commercial_revision),p_correlation_id)
  ON CONFLICT (event_key) DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT; v_count:=v_count+v_rows;

  SELECT coalesce(sum(greatest(0,i.quantity-coalesce(i.received_quantity,0))),0)
    INTO v_open FROM public.purchase_order_items i WHERE i.purchase_order_id=v_po.id;
  IF v_open>0 AND v_po.status NOT IN (
      'cancelled','Cancelada','received','Recebida','completed','Concluida','suspended') THEN
    v_criticality:=CASE
      WHEN v_po.promised_date IS NOT NULL AND current_date>v_po.promised_date THEN 'Urgente'
      WHEN v_po.purchase_by_date IS NOT NULL AND current_date>v_po.purchase_by_date THEN 'Atrasada'
      ELSE 'Normal' END;
  END IF;
  IF v_criticality IN ('Atrasada','Urgente') THEN
    SELECT n.criticality INTO v_previous
      FROM public.strap_operational_notifications n
     WHERE n.purchase_order_id=v_po.id AND n.event_type='criticality_changed'
     ORDER BY n.created_at DESC,n.id DESC LIMIT 1;
    INSERT INTO public.strap_operational_notifications(
      event_key,event_type,purchase_order_id,previous_criticality,criticality,
      title,message,payload,correlation_id)
    VALUES(format('strap-po:%s:criticality:%s:revision:%s',v_po.id,
        lower(v_criticality),v_po.commercial_revision),
      'criticality_changed',v_po.id,coalesce(v_previous,'Normal'),v_criticality,
      CASE v_criticality WHEN 'Urgente' THEN 'Ordem de compra urgente'
        ELSE 'Ordem de compra atrasada' END,
      format('A OC %s passou para %s.',coalesce(v_po.order_number,v_po.id::text),v_criticality),
      jsonb_build_object('purchase_order_id',v_po.id,'status',v_po.status,
        'open_purchase_quantity',v_open,'purchase_by_date',v_po.purchase_by_date,
        'promised_date',v_po.promised_date,'commercial_revision',v_po.commercial_revision),
      p_correlation_id)
    ON CONFLICT (event_key) DO NOTHING;
    GET DIAGNOSTICS v_rows=ROW_COUNT; v_count:=v_count+v_rows;
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_open_strap_purchase_order_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_po record; v_count integer:=0; v_correlation uuid:=gen_random_uuid();
BEGIN
  FOR v_po IN SELECT id FROM public.purchase_orders
    WHERE source_type='strap_demand'
      AND status NOT IN ('cancelled','Cancelada','received','Recebida','completed','Concluida')
    ORDER BY id
  LOOP
    v_count:=v_count+public.refresh_strap_purchase_order_notifications(v_po.id,v_correlation);
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_strap_purchase_orders(
  p_limit integer DEFAULT 500,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE(purchase_order_id uuid, contribution_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group record;
  v_line record;
  v_po public.purchase_orders%ROWTYPE;
  v_poi_id uuid;
  v_qty_purchase numeric;
  v_total numeric;
  v_count integer;
  v_supplier_name text;
  v_before jsonb;
  v_after jsonb;
  v_bucket_supplier_id uuid;
  v_bucket_year integer;
  v_bucket_month integer;
  v_bucket_fortnight integer;
  v_bucket_provisional boolean;
BEGIN
  PERFORM set_config('app.strap_po_engine','1',true);
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  FOR v_group IN
    SELECT c.supplier_id, c.billing_year, c.billing_month, c.billing_fortnight,
           c.provisional, min(c.needed_at) AS needed_at,
           min(c.payment_condition_snapshot) AS payment_terms_label,
           (array_agg(c.payment_terms_snapshot ORDER BY c.updated_at DESC,c.id))[1]
             AS payment_terms
      FROM public.purchase_demand_contributions c
     WHERE c.status IN ('proposed','awaiting_approval')
       AND (c.purchase_order_id IS NULL OR EXISTS (
         SELECT 1 FROM public.purchase_orders po
          WHERE po.id = c.purchase_order_id
            AND po.source_type = 'strap_demand'
            AND po.status IN ('draft','pending','Pendente')
            AND po.snapshot_locked_at IS NULL
       ))
     GROUP BY c.supplier_id, c.billing_year, c.billing_month, c.billing_fortnight, c.provisional
     ORDER BY c.billing_year, c.billing_month, c.billing_fortnight, c.supplier_id NULLS FIRST
     LIMIT greatest(coalesce(p_limit,500),1)
  LOOP
    v_before:=NULL;
    v_bucket_supplier_id:=v_group.supplier_id;
    v_bucket_year:=v_group.billing_year;
    v_bucket_month:=v_group.billing_month;
    v_bucket_fortnight:=v_group.billing_fortnight;
    v_bucket_provisional:=v_group.provisional;
    PERFORM pg_advisory_xact_lock(hashtextextended(format(
      'strap-po:%s:%s:%s:%s:%s', coalesce(v_bucket_supplier_id::text,'provisional'),
      v_bucket_year, v_bucket_month, v_bucket_fortnight,
      v_bucket_provisional), 0));

    -- A consulta externa serve apenas para escolher buckets candidatos. Depois
    -- de esperar pelo lock, refazemos TODO o agregado canonico em novo snapshot
    -- antes de tocar cabecalho ou itens. Assim A+B determinam juntos prazo e
    -- termos, independentemente de qual materializador entrou primeiro.
    SELECT c.supplier_id, c.billing_year, c.billing_month, c.billing_fortnight,
           c.provisional, min(c.needed_at) AS needed_at,
           min(c.payment_condition_snapshot) AS payment_terms_label,
           (array_agg(c.payment_terms_snapshot ORDER BY c.updated_at DESC,c.id))[1]
             AS payment_terms
      INTO v_group
      FROM public.purchase_demand_contributions c
     WHERE c.status IN ('proposed','awaiting_approval')
       AND c.supplier_id IS NOT DISTINCT FROM v_bucket_supplier_id
       AND c.billing_year = v_bucket_year
       AND c.billing_month = v_bucket_month
       AND c.billing_fortnight = v_bucket_fortnight
       AND c.provisional = v_bucket_provisional
       AND (c.purchase_order_id IS NULL OR EXISTS (
         SELECT 1 FROM public.purchase_orders open_po
          WHERE open_po.id = c.purchase_order_id
            AND open_po.source_type = 'strap_demand'
            AND open_po.status IN ('draft','pending','Pendente')
            AND open_po.snapshot_locked_at IS NULL
       ))
     GROUP BY c.supplier_id, c.billing_year, c.billing_month,
       c.billing_fortnight, c.provisional;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_po FROM public.purchase_orders po
     WHERE po.source_type = 'strap_demand'
       AND po.supplier_id IS NOT DISTINCT FROM v_group.supplier_id
       AND po.billing_year = v_group.billing_year
       AND po.billing_month = v_group.billing_month
       AND po.billing_fortnight = v_group.billing_fortnight
       AND po.provisional = v_group.provisional
       AND po.status IN ('draft','pending','Pendente')
       AND po.snapshot_locked_at IS NULL
     ORDER BY po.created_at, po.id FOR UPDATE LIMIT 1;
    IF v_po.id IS NOT NULL THEN
      v_before:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);
    END IF;

    IF v_po.id IS NULL THEN
      SELECT s.name INTO v_supplier_name FROM public.suppliers s WHERE s.id = v_group.supplier_id;
      INSERT INTO public.purchase_orders (
        status, approval_status, supplier_id, supplier_name, total_value, notes,
        auto_generated, source_type, billing_year, billing_month, billing_fortnight,
        provisional, payment_condition_snapshot, payment_terms_snapshot,
        promised_date, purchase_by_date,
        idempotency_key
      ) VALUES (
        CASE WHEN v_group.provisional THEN 'draft' ELSE 'pending' END,
        'pendente', v_group.supplier_id,
        coalesce(v_supplier_name, 'OC Provisoria - Sem fornecedor'), 0,
        CASE WHEN v_group.provisional THEN 'OC Provisoria - Sem fornecedor; aprovacao bloqueada.'
             ELSE 'Demanda automatica de tiras/napa; cobertura pre-netted.' END,
        true, 'strap_demand', v_group.billing_year, v_group.billing_month,
        v_group.billing_fortnight, v_group.provisional, v_group.payment_terms_label,
        v_group.payment_terms,
        v_group.needed_at, NULL,
        format('strap-po:%s:%s:%s:%s:%s', coalesce(v_group.supplier_id::text,'provisional'),
          v_group.billing_year, v_group.billing_month, v_group.billing_fortnight,
          v_group.provisional)
      ) RETURNING * INTO v_po;
    END IF;

    v_count := 0;
    FOR v_line IN
      SELECT c.purchase_product_id,
             CASE WHEN count(DISTINCT c.strap_variant_id) = 1
                  THEN (array_agg(DISTINCT c.strap_variant_id)
                    FILTER (WHERE c.strap_variant_id IS NOT NULL))[1]
                  ELSE NULL END AS strap_variant_id,
             sum(c.required_quantity_stock_unit) AS required_stock,
             min(c.needed_at) AS needed_at,
             min(c.purchase_unit_snapshot) AS purchase_unit,
             min(c.stock_unit) AS stock_unit,
             min(c.conversion_rate_snapshot) AS conversion_rate,
             min(c.min_order_quantity_snapshot) AS moq,
             min(c.purchase_multiple_snapshot) AS multiple_qty,
             min(c.purchase_price_snapshot) AS purchase_price,
             min(c.material_preparation_days_snapshot) AS prep_days,
             min(c.supplier_lead_time_days_snapshot) AS lead_days
        FROM public.purchase_demand_contributions c
       WHERE c.status IN ('proposed','awaiting_approval')
         AND (c.purchase_order_id IS NULL OR c.purchase_order_id = v_po.id)
         AND c.supplier_id IS NOT DISTINCT FROM v_group.supplier_id
         AND c.billing_year = v_group.billing_year
         AND c.billing_month = v_group.billing_month
         AND c.billing_fortnight = v_group.billing_fortnight
         AND c.provisional = v_group.provisional
       GROUP BY c.purchase_product_id
       ORDER BY c.purchase_product_id
    LOOP
      -- MOQ e multiplo pertencem ao item consolidado da OC, nao a cada PV.
      -- Ex.: 10 + 10, MOQ 100 => 100 (nunca 200). O ceil externo garante
      -- simultaneamente quantidade >= MOQ e pacote inteiro.
      v_qty_purchase := CASE
        WHEN coalesce(v_line.conversion_rate,0)<=0 THEN 0
        WHEN coalesce(v_line.multiple_qty,0)>0 THEN
          ceil(greatest(v_line.required_stock/v_line.conversion_rate,
            greatest(coalesce(v_line.moq,0),0))/v_line.multiple_qty)*v_line.multiple_qty
        ELSE v_line.required_stock/v_line.conversion_rate
      END;

      SELECT id INTO v_poi_id FROM public.purchase_order_items
       WHERE purchase_order_id = v_po.id AND product_id = v_line.purchase_product_id
       FOR UPDATE;
      IF v_poi_id IS NULL THEN
        INSERT INTO public.purchase_order_items (
          purchase_order_id, product_id, quantity, suggested_quantity, unit_price, unit,
          current_stock, min_stock, max_stock, strap_variant_id,
          stock_unit_snapshot, purchase_unit_snapshot, conversion_rate_snapshot,
          min_order_quantity_snapshot, purchase_multiple_snapshot,
          preparation_days_snapshot, needed_at
        ) VALUES (
          v_po.id, v_line.purchase_product_id, v_qty_purchase, v_qty_purchase,
          greatest(coalesce(v_line.purchase_price,0),0),
          coalesce(v_line.purchase_unit,v_line.stock_unit), 0, 0, 0, v_line.strap_variant_id,
          v_line.stock_unit, v_line.purchase_unit, v_line.conversion_rate,
          v_line.moq, v_line.multiple_qty, v_line.prep_days, v_line.needed_at
        ) RETURNING id INTO v_poi_id;
      ELSE
        UPDATE public.purchase_order_items
           SET quantity = CASE WHEN strap_manual_quantity
                 AND coalesce(v_line.multiple_qty,0)>0
                 THEN ceil(greatest(quantity,v_qty_purchase)/v_line.multiple_qty)
                   * v_line.multiple_qty
                 WHEN strap_manual_quantity THEN greatest(quantity,v_qty_purchase)
                 ELSE v_qty_purchase END,
               suggested_quantity = v_qty_purchase,
               unit_price = greatest(coalesce(v_line.purchase_price,0),0),
               unit = coalesce(v_line.purchase_unit,v_line.stock_unit),
               strap_variant_id = v_line.strap_variant_id,
               stock_unit_snapshot = v_line.stock_unit,
               purchase_unit_snapshot = v_line.purchase_unit,
               conversion_rate_snapshot = v_line.conversion_rate,
               min_order_quantity_snapshot = v_line.moq,
               purchase_multiple_snapshot = v_line.multiple_qty,
               preparation_days_snapshot = v_line.prep_days,
               needed_at = coalesce(strap_manual_needed_at,v_line.needed_at)
         WHERE id = v_poi_id;
      END IF;

      UPDATE public.purchase_demand_contributions c
         SET purchase_order_id = v_po.id, purchase_order_item_id = v_poi_id,
             status = 'awaiting_approval'
       WHERE c.status IN ('proposed','awaiting_approval')
         AND c.purchase_product_id = v_line.purchase_product_id
         AND c.supplier_id IS NOT DISTINCT FROM v_group.supplier_id
         AND c.billing_year = v_group.billing_year
         AND c.billing_month = v_group.billing_month
         AND c.billing_fortnight = v_group.billing_fortnight
         AND c.provisional = v_group.provisional
         AND (c.purchase_order_id IS NULL OR c.purchase_order_id = v_po.id);
      GET DIAGNOSTICS v_count = ROW_COUNT;
    END LOOP;

    -- Contribuicao cancelada/movida de quinzena remove somente o item ainda
    -- editavel; fatos aprovados nunca entram neste materializador.
    DELETE FROM public.purchase_order_items i
     WHERE i.purchase_order_id = v_po.id
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_demand_contributions c
          WHERE c.purchase_order_item_id = i.id
            AND c.status = 'awaiting_approval'
       );

    SELECT coalesce(sum(i.quantity*i.unit_price),0)
      INTO v_total
      FROM public.purchase_order_items i WHERE i.purchase_order_id=v_po.id;
    -- Cada prazo conserva o seu proprio par lead/preparo. Nunca combina
    -- min(needed_at) de uma contribuicao com min(lead) de outra.
    SELECT min(c.needed_at
      -coalesce(c.material_preparation_days_snapshot,2)
      -coalesce(c.supplier_lead_time_days_snapshot,15))
      INTO v_po.purchase_by_date
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_id=v_po.id
       AND c.status='awaiting_approval';
    UPDATE public.purchase_orders SET total_value = v_total,
      purchase_by_date = coalesce(strap_manual_purchase_by_date,v_po.purchase_by_date),
      promised_date = coalesce(strap_manual_promised_date,v_group.needed_at),
      payment_condition_snapshot=v_group.payment_terms_label,
      payment_terms_snapshot=v_group.payment_terms,
      linked_sale_order_ids = (
        SELECT array_agg(DISTINCT c.sale_order_id ORDER BY c.sale_order_id)
        FROM public.purchase_demand_contributions c
        WHERE c.purchase_order_id = v_po.id AND c.sale_order_id IS NOT NULL
      )
     WHERE id = v_po.id;
    PERFORM public.refresh_strap_purchase_order_commercial_snapshot(v_po.id);
    PERFORM public.refresh_strap_purchase_cashflow_forecast(v_po.id,p_correlation_id);
    PERFORM public.refresh_strap_purchase_order_notifications(v_po.id,p_correlation_id);

    purchase_order_id := v_po.id;
    SELECT count(*)::integer INTO contribution_count
      FROM public.purchase_demand_contributions c WHERE c.purchase_order_id = v_po.id;
    v_after:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('purchase_order',v_po.id,CASE WHEN v_before IS NULL THEN 'insert' ELSE 'reconcile' END,
      v_before,v_after,'Materializacao/recalculo automatico da OC',p_correlation_id,auth.uid());
    RETURN NEXT;
  END LOOP;
END;
$$;

DO $$
DECLARE v_def text; v_after_bucket_lock text; v_group_aggregates integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.materialize_strap_purchase_orders(integer,uuid)'::regprocedure)
    INTO v_def;
  v_after_bucket_lock:=split_part(v_def,'PERFORM pg_advisory_xact_lock',2);
  SELECT count(*) INTO v_group_aggregates FROM regexp_matches(v_def,
    'SELECT c\.supplier_id, c\.billing_year, c\.billing_month, c\.billing_fortnight', 'g');
  IF v_def !~ 'min\(c\.needed_at\s*-\s*coalesce\(c\.material_preparation_days_snapshot,\s*2\)\s*-\s*coalesce\(c\.supplier_lead_time_days_snapshot,\s*15\)\)'
     OR v_group_aggregates <> 2
     OR position('INTO v_group' IN v_after_bucket_lock)=0
     OR position('SELECT * INTO v_po' IN v_after_bucket_lock)
        < position('INTO v_group' IN v_after_bucket_lock)
     OR position('FOR v_line IN' IN v_after_bucket_lock)
        < position('INTO v_group' IN v_after_bucket_lock) THEN
    RAISE EXCEPTION 'Regressao OC: agregado de bucket/prazos precisa ser refeito sob lock';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_strap_purchase_order(
  p_purchase_order_id uuid,
  p_expected_commercial_revision integer,
  p_changes jsonb,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_po public.purchase_orders%ROWTYPE; v_target public.purchase_orders%ROWTYPE;
  v_supplier public.suppliers%ROWTYPE; v_new_supplier_id uuid; v_terms jsonb;
  v_change jsonb; v_changes jsonb:='[]'::jsonb; v_adjustments jsonb:='[]'::jsonb;
  v_item public.purchase_order_items%ROWTYPE; v_target_item public.purchase_order_items%ROWTYPE;
  v_product_id uuid; v_requested numeric; v_price numeric; v_needed date;
  v_required numeric; v_rate numeric; v_moq numeric; v_multiple numeric;
  v_calculated numeric; v_final numeric; v_result_po_id uuid; v_before jsonb;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode ajustar a OC';
  END IF;
  IF jsonb_typeof(p_changes)<>'object' OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'p_changes objeto e motivo sao obrigatorios';
  END IF;
  PERFORM set_config('app.strap_po_engine','1',true);
  PERFORM set_config('app.artisanal_strap_catalog_write','1',true);
  SELECT * INTO v_po FROM public.purchase_orders
   WHERE id=p_purchase_order_id AND source_type='strap_demand' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OC automatica nao encontrada'; END IF;
  IF v_po.snapshot_locked_at IS NOT NULL OR v_po.status NOT IN ('draft','pending','Pendente') THEN
    RAISE EXCEPTION 'Somente OC provisoria/aguardando aprovacao e editavel';
  END IF;
  IF v_po.commercial_revision IS DISTINCT FROM p_expected_commercial_revision THEN
    RAISE EXCEPTION 'Edicao concorrente: revisao atual %, esperada %',
      v_po.commercial_revision,p_expected_commercial_revision USING ERRCODE='40001';
  END IF;
  v_before:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);
  v_new_supplier_id:=CASE WHEN p_changes?'supplier_id'
    THEN nullif(p_changes->>'supplier_id','')::uuid ELSE v_po.supplier_id END;
  IF v_new_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier FROM public.suppliers WHERE id=v_new_supplier_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Fornecedor nao encontrado'; END IF;
    v_terms:=CASE WHEN public.is_valid_strap_payment_terms(v_supplier.payment_terms_structured)
      THEN v_supplier.payment_terms_structured
      ELSE public.normalize_strap_payment_terms(v_supplier.payment_terms) END;
  ELSE
    v_terms:=NULL;
  END IF;

  IF p_changes?'items' AND jsonb_typeof(p_changes->'items')<>'array' THEN
    RAISE EXCEPTION 'items deve ser array';
  END IF;
  FOR v_change IN SELECT value FROM jsonb_array_elements(coalesce(p_changes->'items','[]'::jsonb)) LOOP
    SELECT * INTO v_item FROM public.purchase_order_items
     WHERE id=nullif(v_change->>'purchase_order_item_id','')::uuid
       AND purchase_order_id=v_po.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item de OC invalido'; END IF;
    v_requested:=nullif(v_change->>'quantity','')::numeric;
    v_price:=nullif(v_change->>'unit_price','')::numeric;
    v_needed:=nullif(v_change->>'needed_at','')::date;
    IF v_requested IS NOT NULL AND v_requested<=0 THEN RAISE EXCEPTION 'Quantidade deve ser positiva'; END IF;
    IF v_price IS NOT NULL AND v_price<=0 THEN RAISE EXCEPTION 'Preco deve ser positivo'; END IF;
    v_changes:=v_changes||jsonb_build_array(jsonb_build_object(
      'product_id',v_item.product_id,'requested_quantity',v_requested,
      'unit_price',v_price,'needed_at',v_needed));
    IF v_price IS NOT NULL THEN
      UPDATE public.products SET purchase_price=v_price WHERE id=v_item.product_id;
      UPDATE public.purchase_demand_contributions SET purchase_price_snapshot=v_price,
        correlation_id=p_correlation_id WHERE purchase_order_id=v_po.id
        AND purchase_product_id=v_item.product_id AND status='awaiting_approval';
    END IF;
  END LOOP;

  IF v_new_supplier_id IS DISTINCT FROM v_po.supplier_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(format('strap-po:%s:%s:%s:%s:%s',
      coalesce(v_new_supplier_id::text,'provisional'),v_po.billing_year,v_po.billing_month,
      v_po.billing_fortnight,(v_new_supplier_id IS NULL)),0));
    UPDATE public.products p SET supplier_id=v_new_supplier_id
     WHERE p.id IN (SELECT DISTINCT c.purchase_product_id
       FROM public.purchase_demand_contributions c WHERE c.purchase_order_id=v_po.id);
    UPDATE public.purchase_demand_contributions SET supplier_id=v_new_supplier_id,
      provisional=(v_new_supplier_id IS NULL),
      supplier_lead_time_days_snapshot=CASE WHEN v_new_supplier_id IS NULL THEN 15
        WHEN coalesce(v_supplier.lead_time_days,0)>0 THEN v_supplier.lead_time_days
        ELSE 15 END,
      payment_condition_snapshot=v_supplier.payment_terms,payment_terms_snapshot=v_terms,
      status='proposed',purchase_order_id=NULL,purchase_order_item_id=NULL,
      correlation_id=p_correlation_id
     WHERE purchase_order_id=v_po.id AND status='awaiting_approval';
    SELECT * INTO v_target FROM public.purchase_orders po
     WHERE po.id<>v_po.id AND po.source_type='strap_demand'
       AND po.supplier_id IS NOT DISTINCT FROM v_new_supplier_id
       AND po.billing_year=v_po.billing_year AND po.billing_month=v_po.billing_month
       AND po.billing_fortnight=v_po.billing_fortnight
       AND po.provisional=(v_new_supplier_id IS NULL)
       AND po.status IN ('draft','pending','Pendente') AND po.snapshot_locked_at IS NULL
     ORDER BY po.created_at,po.id FOR UPDATE LIMIT 1;
    IF v_target.id IS NOT NULL THEN
      UPDATE public.purchase_orders SET status='cancelled',cancelled_at=now(),
        suspension_reason='Substituida/fundida na OC '||coalesce(v_target.order_number,v_target.id::text)
       WHERE id=v_po.id;
      v_result_po_id:=v_target.id;
    ELSE
      UPDATE public.purchase_orders SET supplier_id=v_new_supplier_id,
        supplier_name=coalesce(v_supplier.name,'OC Provisoria - Sem fornecedor'),
        provisional=(v_new_supplier_id IS NULL),
        status=CASE WHEN v_new_supplier_id IS NULL THEN 'draft' ELSE 'pending' END,
        payment_condition_snapshot=v_supplier.payment_terms,payment_terms_snapshot=v_terms
       WHERE id=v_po.id;
      v_result_po_id:=v_po.id;
    END IF;
    PERFORM public.materialize_strap_purchase_orders(500,p_correlation_id);
    SELECT c.purchase_order_id INTO v_result_po_id
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_product_id=(SELECT (x->>'product_id')::uuid
       FROM jsonb_array_elements(v_changes) x LIMIT 1)
       AND c.billing_year=v_po.billing_year AND c.billing_month=v_po.billing_month
       AND c.billing_fortnight=v_po.billing_fortnight
       AND c.supplier_id IS NOT DISTINCT FROM v_new_supplier_id
       AND c.status='awaiting_approval'
     ORDER BY c.updated_at DESC LIMIT 1;
    v_result_po_id:=coalesce(v_result_po_id,v_target.id,v_po.id);
  ELSE
    v_result_po_id:=v_po.id;
  END IF;

  FOR v_change IN SELECT value FROM jsonb_array_elements(v_changes) LOOP
    v_product_id:=(v_change->>'product_id')::uuid;
    SELECT * INTO v_target_item FROM public.purchase_order_items
     WHERE purchase_order_id=v_result_po_id AND product_id=v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item nao foi materializado na OC de destino'; END IF;
    SELECT coalesce(sum(c.required_quantity_stock_unit),0),
      min(c.conversion_rate_snapshot),min(c.min_order_quantity_snapshot),
      min(c.purchase_multiple_snapshot)
      INTO v_required,v_rate,v_moq,v_multiple
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_item_id=v_target_item.id AND c.status='awaiting_approval';
    v_calculated:=CASE WHEN coalesce(v_rate,0)<=0 THEN 0
      WHEN coalesce(v_multiple,0)>0 THEN
        ceil(greatest(v_required/v_rate,greatest(coalesce(v_moq,0),0))/v_multiple)*v_multiple
      ELSE v_required/v_rate END;
    v_requested:=nullif(v_change->>'requested_quantity','')::numeric;
    v_final:=CASE WHEN v_requested IS NULL THEN v_target_item.quantity
      WHEN coalesce(v_multiple,0)>0 THEN
        ceil(greatest(v_requested,v_calculated)/v_multiple)*v_multiple
      ELSE greatest(v_requested,v_calculated) END;
    UPDATE public.purchase_order_items SET quantity=v_final,suggested_quantity=v_calculated,
      unit_price=coalesce(nullif(v_change->>'unit_price','')::numeric,unit_price),
      needed_at=coalesce(nullif(v_change->>'needed_at','')::date,needed_at),
      strap_manual_quantity=(v_requested IS NOT NULL),
      strap_manual_needed_at=nullif(v_change->>'needed_at','')::date,
      strap_manual_adjustment_reason=btrim(p_reason),strap_manual_adjusted_by=auth.uid(),
      strap_manual_adjusted_at=now()
     WHERE id=v_target_item.id;
    v_adjustments:=v_adjustments||jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id',v_target_item.id,'product_id',v_product_id,
      'requested_quantity',v_requested,'calculated_quantity',v_calculated,
      'final_quantity',v_final,'unit_price',coalesce(nullif(v_change->>'unit_price','')::numeric,
        v_target_item.unit_price),'needed_at',coalesce(nullif(v_change->>'needed_at','')::date,
        v_target_item.needed_at)));
  END LOOP;

  UPDATE public.purchase_orders po SET
    strap_manual_purchase_by_date=CASE WHEN p_changes?'purchase_by_date'
      THEN nullif(p_changes->>'purchase_by_date','')::date ELSE strap_manual_purchase_by_date END,
    strap_manual_promised_date=CASE WHEN p_changes?'promised_date'
      THEN nullif(p_changes->>'promised_date','')::date ELSE strap_manual_promised_date END,
    purchase_by_date=CASE WHEN p_changes?'purchase_by_date'
      THEN nullif(p_changes->>'purchase_by_date','')::date ELSE purchase_by_date END,
    promised_date=CASE WHEN p_changes?'promised_date'
      THEN nullif(p_changes->>'promised_date','')::date ELSE promised_date END,
    strap_manual_adjustment_reason=btrim(p_reason),strap_manual_adjusted_by=auth.uid(),
    strap_manual_adjusted_at=now(),
    total_value=(SELECT coalesce(sum(i.quantity*i.unit_price),0)
      FROM public.purchase_order_items i WHERE i.purchase_order_id=po.id)
   WHERE po.id=v_result_po_id;
  PERFORM public.refresh_strap_purchase_order_commercial_snapshot(v_result_po_id);
  PERFORM public.refresh_strap_purchase_cashflow_forecast(v_result_po_id,p_correlation_id);
  PERFORM public.refresh_strap_purchase_order_notifications(v_result_po_id,p_correlation_id);
  SELECT * INTO v_target FROM public.purchase_orders WHERE id=v_result_po_id;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('purchase_order',v_result_po_id,'update',v_before,
    public.build_strap_purchase_order_commercial_snapshot(v_result_po_id),
    btrim(p_reason),p_correlation_id,auth.uid());
  RETURN jsonb_build_object('purchase_order_id',v_result_po_id,
    'replaced_purchase_order_id',CASE WHEN v_result_po_id<>v_po.id THEN v_po.id ELSE NULL END,
    'commercial_revision',v_target.commercial_revision,
    'commercial_digest',v_target.commercial_digest,'status',v_target.status,
    'supplier_id',v_target.supplier_id,'adjustments',v_adjustments,
    'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_strap_purchase_order_approval(
  p_purchase_order_id uuid,
  p_expected_commercial_revision integer,
  p_expected_commercial_digest text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_po public.purchase_orders%ROWTYPE; v_snapshot jsonb; v_digest text;
  v_token uuid:=gen_random_uuid(); v_prepared_at timestamptz:=clock_timestamp();
  v_actor_name text; v_before jsonb;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode preparar a aprovacao da OC';
  END IF;
  SELECT * INTO v_po FROM public.purchase_orders
   WHERE id=p_purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po.source_type<>'strap_demand' THEN
    RAISE EXCEPTION 'OC de tiras nao encontrada';
  END IF;
  IF v_po.status NOT IN ('pending','Pendente') OR v_po.snapshot_locked_at IS NOT NULL
     OR v_po.provisional OR v_po.supplier_id IS NULL THEN
    RAISE EXCEPTION 'OC nao esta elegivel para preparar aprovacao';
  END IF;
  IF NOT public.is_valid_strap_payment_terms(v_po.payment_terms_snapshot) THEN
    RAISE EXCEPTION 'Condicao de pagamento estruturada ausente/invalida';
  END IF;
  v_snapshot:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);
  v_digest:=public.strap_payload_hash(v_snapshot);
  IF p_expected_commercial_revision IS DISTINCT FROM v_po.commercial_revision
     OR lower(coalesce(p_expected_commercial_digest,'')) IS DISTINCT FROM lower(coalesce(v_po.commercial_digest,''))
     OR lower(coalesce(v_po.commercial_digest,'')) IS DISTINCT FROM lower(v_digest) THEN
    RAISE EXCEPTION 'OC mudou; recarregue antes de gerar o PDF' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_demand_contributions c
    WHERE c.purchase_order_id=v_po.id AND (
      c.status<>'awaiting_approval' OR c.suspension_reason IS NOT NULL
      OR nullif(btrim(c.purchase_unit_snapshot),'') IS NULL
      OR c.purchase_price_snapshot<=0 OR c.conversion_rate_snapshot<=0
      OR c.min_order_quantity_snapshot<=0 OR c.purchase_multiple_snapshot<=0
      OR NOT public.is_valid_strap_payment_terms(c.payment_terms_snapshot))) THEN
    RAISE EXCEPTION 'OC possui contribuicao bloqueada ou snapshot comercial invalido';
  END IF;
  SELECT nullif(btrim(p.full_name),'') INTO v_actor_name
    FROM public.profiles p WHERE p.id=auth.uid();
  v_actor_name:=coalesce(v_actor_name,'Administrador');
  v_before:=to_jsonb(v_po);
  PERFORM set_config('app.strap_po_preflight','1',true);
  UPDATE public.purchase_orders SET approval_preflight_token=v_token,
    approval_preflight_by=auth.uid(),approval_preflight_actor_name=v_actor_name,
    approval_preflight_at=v_prepared_at,
    approval_preflight_revision=v_po.commercial_revision,
    approval_preflight_digest=v_po.commercial_digest
   WHERE id=v_po.id;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('purchase_order',v_po.id,'update',v_before,
    jsonb_build_object('approval_preflight_token',v_token,
      'approval_preflight_by',auth.uid(),'approval_preflight_actor_name',v_actor_name,
      'approval_preflight_at',v_prepared_at,
      'commercial_revision',v_po.commercial_revision,'commercial_digest',v_po.commercial_digest),
    'Reserva transacional da identidade/data para o PDF de aprovacao',p_correlation_id,auth.uid());
  RETURN jsonb_build_object('approval_token',v_token,'approver_id',auth.uid(),
    'approver_name',v_actor_name,'approved_at',v_prepared_at,
    'commercial_revision',v_po.commercial_revision,
    'commercial_digest',v_po.commercial_digest,'commercial_snapshot',v_snapshot,
    'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_strap_purchase_order(
  p_purchase_order_id uuid,
  p_pdf_storage_path text,
  p_pdf_sha256 text,
  p_expected_commercial_revision integer DEFAULT NULL,
  p_expected_commercial_digest text DEFAULT NULL,
  p_approval_token uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS public.purchase_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_po public.purchase_orders%ROWTYPE; v_before jsonb;
  v_current_snapshot jsonb; v_current_digest text;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode aprovar a OC';
  END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po.source_type <> 'strap_demand' THEN RAISE EXCEPTION 'OC de tiras nao encontrada'; END IF;
  IF v_po.status = 'approved' THEN
    IF v_po.pdf_storage_path=p_pdf_storage_path AND lower(v_po.pdf_sha256)=lower(p_pdf_sha256) THEN
      RETURN v_po;
    END IF;
    RAISE EXCEPTION 'OC ja aprovada possui PDF congelado diferente';
  END IF;
  IF v_po.status NOT IN ('pending','Pendente') THEN
    RAISE EXCEPTION 'Somente OC Aguardando aprovacao pode ser aprovada';
  END IF;
  IF v_po.provisional OR v_po.supplier_id IS NULL THEN
    RAISE EXCEPTION 'OC Provisoria sem fornecedor nao pode ser aprovada';
  END IF;
  IF NOT public.is_valid_strap_payment_terms(v_po.payment_terms_snapshot) THEN
    RAISE EXCEPTION 'Condicao de pagamento estruturada ausente/invalida';
  END IF;
  IF p_expected_commercial_revision IS NULL OR nullif(lower(btrim(p_expected_commercial_digest)),'') IS NULL THEN
    RAISE EXCEPTION 'Revisao e digest comercial esperados sao obrigatorios para aprovar';
  END IF;
  v_current_snapshot:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);
  v_current_digest:=public.strap_payload_hash(v_current_snapshot);
  IF v_po.commercial_revision IS DISTINCT FROM p_expected_commercial_revision
     OR lower(coalesce(v_po.commercial_digest,'')) IS DISTINCT FROM lower(p_expected_commercial_digest)
     OR lower(coalesce(v_po.commercial_digest,'')) IS DISTINCT FROM lower(v_current_digest) THEN
    RAISE EXCEPTION 'OC mudou depois da geracao do PDF; atualize o documento (revisao atual %, esperada %)',
      v_po.commercial_revision,p_expected_commercial_revision USING ERRCODE='40001';
  END IF;
  IF p_approval_token IS NULL OR v_po.approval_preflight_token IS DISTINCT FROM p_approval_token
     OR v_po.approval_preflight_by IS DISTINCT FROM auth.uid()
     OR v_po.approval_preflight_revision IS DISTINCT FROM v_po.commercial_revision
     OR lower(coalesce(v_po.approval_preflight_digest,'')) IS DISTINCT FROM lower(v_po.commercial_digest)
     OR v_po.approval_preflight_at < now()-interval '15 minutes' THEN
    RAISE EXCEPTION 'Reserva de aprovacao ausente, expirada ou divergente; prepare novamente o PDF';
  END IF;
  IF nullif(btrim(p_pdf_storage_path),'') IS NULL OR nullif(btrim(p_pdf_sha256),'') IS NULL THEN
    RAISE EXCEPTION 'PDF congelado e hash sao obrigatorios na aprovacao';
  END IF;
  IF lower(p_pdf_sha256) !~ '^[0-9a-f]{64}$'
     OR p_pdf_storage_path <> p_purchase_order_id::text || '/' || lower(p_pdf_sha256) || '.pdf' THEN
    RAISE EXCEPTION 'Path/hash invalido; use <purchase_order_id>/<sha256>.pdf no bucket strap-purchase-orders';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
     WHERE o.bucket_id = 'strap-purchase-orders' AND o.name = p_pdf_storage_path
       AND lower(coalesce(o.user_metadata->>'sha256','')) = lower(p_pdf_sha256)
  ) THEN
    RAISE EXCEPTION 'PDF ausente ou SHA-256 do objeto nao confere com o snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_id = v_po.id
       AND (c.status <> 'awaiting_approval' OR c.purchase_price_snapshot <= 0
         OR c.conversion_rate_snapshot <= 0 OR c.min_order_quantity_snapshot <= 0
         OR c.purchase_multiple_snapshot <= 0 OR c.suspension_reason IS NOT NULL
         OR NOT public.is_valid_strap_payment_terms(c.payment_terms_snapshot)
         OR c.payment_terms_snapshot IS DISTINCT FROM v_po.payment_terms_snapshot)
  ) THEN RAISE EXCEPTION 'OC possui contribuicao bloqueada ou cadastro comercial invalido'; END IF;

  v_before:=to_jsonb(v_po);
  PERFORM public.refresh_strap_purchase_cashflow_forecast(v_po.id,p_correlation_id);
  PERFORM set_config('app.strap_po_approval','1',true);
  UPDATE public.purchase_orders SET pdf_storage_path = p_pdf_storage_path,
    pdf_sha256 = p_pdf_sha256, snapshot_locked_at = now(), status = 'approved',
    approved_by = v_po.approval_preflight_by,
    approved_by_name_snapshot=v_po.approval_preflight_actor_name,
    approved_at = v_po.approval_preflight_at,
    approval_preflight_token=NULL,approval_preflight_by=NULL,
    approval_preflight_actor_name=NULL,approval_preflight_at=NULL,
    approval_preflight_revision=NULL,approval_preflight_digest=NULL
   WHERE id = v_po.id RETURNING * INTO v_po;
  UPDATE public.purchase_demand_contributions
     SET status = 'approved', committed_quantity_stock_unit = required_quantity_stock_unit,
         correlation_id = p_correlation_id
   WHERE purchase_order_id = v_po.id AND status = 'awaiting_approval';
  UPDATE public.strap_purchase_cashflow_installments SET
    layer='committed_unbilled',due_date=current_date+days_offset,
    correlation_id=p_correlation_id,updated_at=now()
   WHERE purchase_order_id=v_po.id AND layer='forecast' AND purchase_receipt_id IS NULL;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('purchase_order',v_po.id,'approve',v_before,to_jsonb(v_po),
    'Aprovacao administrativa da OC com PDF comercial congelado',p_correlation_id,auth.uid());
  RETURN v_po;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_strap_purchase_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old_canonical boolean:=false; v_new_canonical boolean:=false;
  v_has_token boolean;
BEGIN
  IF TG_OP<>'INSERT' THEN v_old_canonical:=OLD.source_type='strap_demand'; END IF;
  IF TG_OP<>'DELETE' THEN v_new_canonical:=NEW.source_type='strap_demand'; END IF;
  v_has_token:=current_setting('app.strap_po_engine',true)='1'
    OR current_setting('app.strap_po_approval',true)='1'
    OR current_setting('app.strap_po_preflight',true)='1'
    OR current_setting('app.strap_po_receipt',true)='1'
    OR current_setting('app.strap_po_suspend',true)='1';

  -- O guard cobre nascimento, mutacao, remocao e conversao de/para o canal
  -- canonico. Policies FOR ALL legadas nao podem fabricar uma OC automatica
  -- a partir de uma OC comum nem apagar seu historico.
  IF NOT v_old_canonical AND NOT v_new_canonical THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT v_has_token THEN
    RAISE EXCEPTION 'OC automatica so pode ser alterada pelas RPCs canonicas';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status NOT IN ('draft','pending','Pendente') OR NEW.snapshot_locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'OC automatica deve nascer Provisoria/Aguardando aprovacao e sem snapshot congelado';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.snapshot_locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'OC automatica aprovada nao pode ser apagada';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.source_type IS DISTINCT FROM OLD.source_type THEN
    IF current_setting('app.strap_po_engine',true) IS DISTINCT FROM '1'
       OR OLD.snapshot_locked_at IS NOT NULL OR NEW.snapshot_locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Conversao de/para OC automatica exige motor e documento reversivel';
    END IF;
  END IF;
  IF OLD.snapshot_locked_at IS NOT NULL AND (
    NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
    OR NEW.billing_year IS DISTINCT FROM OLD.billing_year
    OR NEW.billing_month IS DISTINCT FROM OLD.billing_month
    OR NEW.billing_fortnight IS DISTINCT FROM OLD.billing_fortnight
    OR NEW.total_value IS DISTINCT FROM OLD.total_value
    OR NEW.payment_condition_snapshot IS DISTINCT FROM OLD.payment_condition_snapshot
    OR NEW.payment_terms_snapshot IS DISTINCT FROM OLD.payment_terms_snapshot
    OR NEW.supplier_snapshot IS DISTINCT FROM OLD.supplier_snapshot
    OR NEW.delivery_company_snapshot IS DISTINCT FROM OLD.delivery_company_snapshot
    OR NEW.commercial_revision IS DISTINCT FROM OLD.commercial_revision
    OR NEW.commercial_digest IS DISTINCT FROM OLD.commercial_digest
    OR NEW.approved_by_name_snapshot IS DISTINCT FROM OLD.approved_by_name_snapshot
    OR NEW.pdf_storage_path IS DISTINCT FROM OLD.pdf_storage_path
    OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
    OR NEW.strap_manual_purchase_by_date IS DISTINCT FROM OLD.strap_manual_purchase_by_date
    OR NEW.strap_manual_promised_date IS DISTINCT FROM OLD.strap_manual_promised_date
    OR NEW.strap_manual_adjustment_reason IS DISTINCT FROM OLD.strap_manual_adjustment_reason
    OR NEW.strap_manual_adjusted_by IS DISTINCT FROM OLD.strap_manual_adjusted_by
    OR NEW.strap_manual_adjusted_at IS DISTINCT FROM OLD.strap_manual_adjusted_at
  ) THEN RAISE EXCEPTION 'OC aprovada possui snapshot imutavel'; END IF;
  IF OLD.snapshot_locked_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status
     AND current_setting('app.strap_po_receipt',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Status de OC aprovada so muda por RPC operacional autorizada';
  END IF;
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF current_setting('app.strap_po_approval',true) IS DISTINCT FROM '1'
       OR NOT public.user_has_any_role(ARRAY['admin']) THEN
      RAISE EXCEPTION 'Use approve_strap_purchase_order para aprovar a OC';
    END IF;
    IF NEW.provisional OR NEW.supplier_id IS NULL THEN
      RAISE EXCEPTION 'OC Provisoria sem fornecedor nao pode ser aprovada';
    END IF;
    IF NEW.snapshot_locked_at IS NULL OR nullif(btrim(NEW.pdf_storage_path),'') IS NULL
       OR nullif(btrim(NEW.pdf_sha256),'') IS NULL THEN
      RAISE EXCEPTION 'Use approve_strap_purchase_order para congelar snapshots e PDF';
    END IF;
    IF lower(NEW.pdf_sha256) !~ '^[0-9a-f]{64}$'
       OR NEW.pdf_storage_path <> NEW.id::text || '/' || lower(NEW.pdf_sha256) || '.pdf'
       OR NOT EXISTS (SELECT 1 FROM storage.objects o
         WHERE o.bucket_id='strap-purchase-orders' AND o.name=NEW.pdf_storage_path
           AND lower(coalesce(o.user_metadata->>'sha256',''))=lower(NEW.pdf_sha256)) THEN
      RAISE EXCEPTION 'PDF congelado/hash/objeto invalido';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_strap_purchase_order ON public.purchase_orders;
CREATE TRIGGER trg_guard_strap_purchase_order
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_purchase_order();

CREATE OR REPLACE FUNCTION public.tg_guard_strap_purchase_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old_locked timestamptz; v_new_locked timestamptz;
  v_old_source text; v_new_source text;
  v_old_strap_product boolean:=false; v_new_strap_product boolean:=false;
BEGIN
  IF TG_OP<>'INSERT' THEN
    SELECT po.snapshot_locked_at,po.source_type INTO v_old_locked,v_old_source
      FROM public.purchase_orders po WHERE po.id=OLD.purchase_order_id;
    SELECT coalesce(p.is_artisanal,false)
        OR coalesce(pg.is_artisanal_strap,false)
        OR EXISTS(SELECT 1 FROM public.artisanal_strap_variants v
          WHERE v.finished_product_id=p.id)
      INTO v_old_strap_product
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE p.id=OLD.product_id;
  END IF;
  IF TG_OP<>'DELETE' THEN
    SELECT po.snapshot_locked_at,po.source_type INTO v_new_locked,v_new_source
      FROM public.purchase_orders po WHERE po.id=NEW.purchase_order_id;
    SELECT coalesce(p.is_artisanal,false)
        OR coalesce(pg.is_artisanal_strap,false)
        OR EXISTS(SELECT 1 FROM public.artisanal_strap_variants v
          WHERE v.finished_product_id=p.id)
      INTO v_new_strap_product
      FROM public.products p
      LEFT JOIN public.product_groups pg ON pg.id=p.group_id
     WHERE p.id=NEW.product_id;
    IF coalesce(v_new_strap_product,false) AND v_new_source IS DISTINCT FROM 'strap_demand' THEN
      RAISE EXCEPTION 'Produto de tira so pode entrar pela OC canonica strap_demand; inbound generico bloqueado';
    END IF;
    IF v_new_source='strap_demand' AND (
      NEW.strap_variant_id IS NULL OR NOT EXISTS(
        SELECT 1
          FROM public.artisanal_strap_variants v
          LEFT JOIN public.base_material_color_official_products op
            ON op.base_group_id=v.base_group_id AND op.color_id=v.color_id
         WHERE v.id=NEW.strap_variant_id
           AND (v.finished_product_id=NEW.product_id OR op.official_product_id=NEW.product_id)
      )
    ) THEN
      RAISE EXCEPTION 'Item de OC de tira exige strap_variant_id e produto exatos';
    END IF;
  END IF;
  IF coalesce(v_old_source,'')<>'strap_demand'
     AND coalesce(v_new_source,'')<>'strap_demand' THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_setting('app.strap_po_engine',true)='1'
     AND v_old_locked IS NULL AND v_new_locked IS NULL THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='UPDATE' AND current_setting('app.strap_po_receipt',true)='1'
     AND OLD.purchase_order_id=NEW.purchase_order_id
     AND v_old_source='strap_demand' AND v_new_source='strap_demand'
     AND (to_jsonb(NEW)-'received_quantity'-'received_at')
       = (to_jsonb(OLD)-'received_quantity'-'received_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Itens e snapshots de OC aprovada sao imutaveis';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_strap_purchase_order_item ON public.purchase_order_items;
CREATE TRIGGER trg_guard_strap_purchase_order_item
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_purchase_order_item();

-- O produto acabado hibrido e artesanal, mas pode ser comprado quando a variante
-- explicitamente habilita purchase_enabled. O guard legado passa a reconhecer
-- essa excecao sem liberar os demais materiais artesanais para OC.
CREATE OR REPLACE FUNCTION public.tg_validate_purchase_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_unit text;
  v_purchase_unit text;
  v_is_artisanal boolean;
  v_group_is_strap boolean;
  v_is_strap_product boolean;
  v_is_buyable_strap boolean;
  v_open_strap_po boolean:=false;
  v_po_source text;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT coalesce(nullif(btrim(p.unit),''),'un'),
         coalesce(nullif(btrim(p.purchase_unit),''),nullif(btrim(p.unit),''),'un'),
         coalesce(p.is_artisanal,false),
         coalesce(pg.is_artisanal_strap,false),
         EXISTS (SELECT 1 FROM public.artisanal_strap_variants v
           WHERE v.finished_product_id = p.id),
         EXISTS (SELECT 1 FROM public.artisanal_strap_variants v
           WHERE v.finished_product_id = p.id AND v.status = 'active' AND v.purchase_enabled)
    INTO v_stock_unit, v_purchase_unit, v_is_artisanal,v_group_is_strap,
         v_is_strap_product,v_is_buyable_strap
    FROM public.products p
    LEFT JOIN public.product_groups pg ON pg.id=p.group_id
   WHERE p.id = NEW.product_id;
  IF v_stock_unit IS NULL THEN RAISE EXCEPTION 'Produto da linha de OC nao encontrado'; END IF;
  SELECT po.source_type INTO v_po_source FROM public.purchase_orders po
   WHERE po.id=NEW.purchase_order_id;
  v_is_strap_product:=coalesce(v_is_strap_product,false)
    OR coalesce(v_group_is_strap,false) OR coalesce(v_is_artisanal,false);
  IF v_is_strap_product AND v_po_source IS DISTINCT FROM 'strap_demand' THEN
    RAISE EXCEPTION 'Produto de tira nao pode ser comprado/recebido por OC generica';
  END IF;
  IF EXISTS(SELECT 1 FROM public.artisanal_strap_variants v
       WHERE v.finished_product_id=NEW.product_id)
     AND NOT v_is_buyable_strap THEN
    RAISE EXCEPTION 'Material artesanal nao compravel: produza por lote/OS';
  END IF;
  IF v_po_source='strap_demand' AND (
    NEW.strap_variant_id IS NULL OR NOT EXISTS(
      SELECT 1
        FROM public.artisanal_strap_variants v
        LEFT JOIN public.base_material_color_official_products op
          ON op.base_group_id=v.base_group_id AND op.color_id=v.color_id
       WHERE v.id=NEW.strap_variant_id
         AND (v.finished_product_id=NEW.product_id OR op.official_product_id=NEW.product_id)
    )
  ) THEN
    RAISE EXCEPTION 'OC canonica exige variante e produto estruturalmente compativeis';
  END IF;
  IF public.po_norm_unit(coalesce(NEW.unit,'')) NOT IN
     (public.po_norm_unit(v_stock_unit), public.po_norm_unit(v_purchase_unit)) THEN
    RAISE EXCEPTION 'Unidade de OC invalida; compra %, estoque %', v_purchase_unit, v_stock_unit;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.purchase_orders po
    WHERE po.id=NEW.purchase_order_id AND po.source_type='strap_demand'
      AND po.snapshot_locked_at IS NULL AND po.status IN ('draft','pending','Pendente'))
    INTO v_open_strap_po;
  IF NOT v_open_strap_po
     AND (coalesce(NEW.quantity,0)<=0 OR coalesce(NEW.unit_price,0)<=0) THEN
    RAISE EXCEPTION 'Quantidade e preco da linha de OC devem ser positivos';
  END IF;
  IF v_open_strap_po AND (coalesce(NEW.quantity,0)<0 OR coalesce(NEW.unit_price,0)<0) THEN
    RAISE EXCEPTION 'Quantidade/preco bloqueado nao pode ser negativo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_purchase_order_item ON public.purchase_order_items;
CREATE TRIGGER trg_validate_purchase_order_item
  BEFORE INSERT OR UPDATE OF product_id, unit, quantity, unit_price
  ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_purchase_order_item();

CREATE OR REPLACE FUNCTION public.tg_assert_strap_purchase_order_item_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.purchase_orders po
      WHERE po.id=NEW.purchase_order_id AND po.source_type='strap_demand')
     AND NOT EXISTS(
       SELECT 1 FROM public.purchase_demand_contributions c
        WHERE c.purchase_order_id=NEW.purchase_order_id
          AND c.purchase_order_item_id=NEW.id
          AND c.strap_variant_id=NEW.strap_variant_id
          AND c.purchase_product_id=NEW.product_id
     ) THEN
    RAISE EXCEPTION 'Item de OC de tira sem contribuicao canonica estrutural';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_strap_purchase_order_item_origin
  ON public.purchase_order_items;
CREATE CONSTRAINT TRIGGER trg_assert_strap_purchase_order_item_origin
  AFTER INSERT OR UPDATE OF purchase_order_id,product_id,strap_variant_id
  ON public.purchase_order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_assert_strap_purchase_order_item_origin();

-- Contrato executavel adversarial: flag somente no grupo e variante historica
-- tambem pertencem ao canal de tiras; uma linha canonica termina a transacao
-- somente com variante/produto/contribuicao exatos.
DO $$
DECLARE
  v_guard text:=pg_get_functiondef('public.tg_guard_strap_purchase_order_item()'::regprocedure);
  v_validate text:=pg_get_functiondef('public.tg_validate_purchase_order_item()'::regprocedure);
  v_origin text:=pg_get_functiondef('public.tg_assert_strap_purchase_order_item_origin()'::regprocedure);
  v_trigger text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_trigger FROM pg_trigger t
   WHERE t.tgrelid='public.purchase_order_items'::regclass
     AND t.tgname='trg_assert_strap_purchase_order_item_origin' AND NOT t.tgisinternal;
  IF position('is_artisanal_strap' IN v_guard)=0
     OR position('artisanal_strap_variants' IN v_guard)=0
     OR position('v_new_source IS DISTINCT FROM ''strap_demand''' IN v_guard)=0
     OR position('NEW.strap_variant_id IS NULL' IN v_guard)=0
     OR position('is_artisanal_strap' IN v_validate)=0
     OR position('v_po_source IS DISTINCT FROM ''strap_demand''' IN v_validate)=0
     OR position('purchase_demand_contributions' IN v_origin)=0
     OR position('c.purchase_product_id=NEW.product_id' IN v_origin)=0
     OR v_trigger NOT ILIKE '%DEFERRABLE INITIALLY DEFERRED%' THEN
    RAISE EXCEPTION 'Cutover inseguro: produto de tira ainda aceita OC/inbound generico';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Lotes, OS externa e agenda global executor x dia
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.strap_committed_production_inbound(
  p_sale_order_strap_demand_id uuid DEFAULT NULL,
  p_stock_floor_contribution_id uuid DEFAULT NULL,
  p_needed_at date DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(greatest(0, c.planned_m - c.delivered_m)),0)
  FROM public.strap_production_batch_contributions c
  JOIN public.strap_production_batch_items i ON i.id = c.batch_item_id
  JOIN public.strap_production_batches b ON b.id = i.batch_id
  WHERE c.status IN ('in_progress','partial')
    AND b.status IN ('in_progress','partial','suspended')
    AND (p_sale_order_strap_demand_id IS NULL
      OR c.sale_order_strap_demand_id = p_sale_order_strap_demand_id)
    AND (p_stock_floor_contribution_id IS NULL
      OR c.stock_floor_contribution_id = p_stock_floor_contribution_id)
    AND (p_needed_at IS NULL OR b.deadline <= p_needed_at);
$$;

CREATE OR REPLACE FUNCTION public.strap_committed_finished_inbound(
  p_finished_product_id uuid,
  p_sale_order_strap_demand_id uuid DEFAULT NULL,
  p_stock_floor_contribution_id uuid DEFAULT NULL,
  p_needed_at date DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Tira acabada comprometida e fungivel: uma OC aprovada e um lote ja
  -- iniciado cobrem o mesmo SKU mesmo se o Administrador trocar a origem da
  -- revisao. A alocacao e unica e o excedente de MOQ permanece livre.
  WITH physical_purchase AS (
    SELECT coalesce(sum(
      greatest(0,i.quantity-coalesce(i.received_quantity,0))
      * i.conversion_rate_snapshot
    ),0) AS quantity_m
    FROM public.purchase_order_items i
    JOIN public.purchase_orders po ON po.id=i.purchase_order_id
    WHERE po.source_type='strap_demand' AND po.snapshot_locked_at IS NOT NULL
      AND po.status IN ('approved','sent','partial')
      AND i.product_id=p_finished_product_id
      AND i.conversion_rate_snapshot>0
      AND (p_needed_at IS NULL
        OR coalesce(po.promised_date,i.needed_at)<=p_needed_at)
  ), physical_production AS (
    SELECT coalesce(sum(greatest(0,c.planned_m-c.delivered_m)),0) AS quantity_m
    FROM public.strap_production_batch_contributions c
    JOIN public.strap_production_batch_items i ON i.id=c.batch_item_id
    JOIN public.strap_production_batches b ON b.id=i.batch_id
    WHERE c.status IN ('in_progress','partial')
      AND b.status IN ('in_progress','partial','suspended')
      AND i.finished_product_id=p_finished_product_id
      AND (p_needed_at IS NULL OR b.deadline<=p_needed_at)
  ), allocated_elsewhere AS (
    SELECT coalesce(sum(x.quantity_m),0) AS quantity_m
    FROM (
      SELECT d.committed_finished_inbound_m AS quantity_m
      FROM public.sale_order_strap_demands d
      WHERE d.is_current AND d.finished_product_id=p_finished_product_id
        AND d.id IS DISTINCT FROM p_sale_order_strap_demand_id
        AND d.status NOT IN ('superseded','cancelled','error','fulfilled')
      UNION ALL
      SELECT f.committed_finished_inbound_m
      FROM public.strap_stock_floor_contributions f
      WHERE f.is_current AND f.finished_product_id=p_finished_product_id
        AND f.id IS DISTINCT FROM p_stock_floor_contribution_id
        AND f.status NOT IN ('superseded','cancelled','fulfilled')
    ) x
  )
  SELECT greatest(0,p.quantity_m+r.quantity_m-a.quantity_m)
  FROM physical_purchase p CROSS JOIN physical_production r
  CROSS JOIN allocated_elsewhere a;
$$;

CREATE OR REPLACE FUNCTION public.schedule_strap_batch_item(
  p_batch_item_id uuid,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.strap_production_batch_items%ROWTYPE;
  v_batch public.strap_production_batches%ROWTYPE;
  v_capacity public.strap_executor_capacities%ROWTYPE;
  v_bucket public.strap_executor_daily_capacity_buckets%ROWTYPE;
  v_day date;
  v_remaining numeric;
  v_available numeric;
  v_alloc numeric;
  v_total numeric := 0;
  v_first date;
  v_contract_key text;
  v_executor_type text;
  v_before_allocations jsonb;
  v_after_allocations jsonb;
BEGIN
  IF auth.role()<>'service_role' AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.has_artisanal_strap_capability('execute_strap_batch')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo do agendamento e obrigatorio'; END IF;
  SELECT b.executor_type,coalesce(b.contractor_id::text,'factory')
    INTO v_executor_type,v_contract_key
    FROM public.strap_production_batch_items i
    JOIN public.strap_production_batches b ON b.id=i.batch_id
   WHERE i.id=p_batch_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de lote nao encontrado'; END IF;
  -- Ordem global de lock: executor -> item -> lote -> dia. O mesmo contrato e
  -- usado pela reconciliacao e pelas RPCs de configuracao.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('strap-schedule:%s:%s',v_executor_type,v_contract_key),0));
  SELECT * INTO v_item FROM public.strap_production_batch_items
   WHERE id = p_batch_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de lote nao encontrado'; END IF;
  SELECT * INTO v_batch FROM public.strap_production_batches
   WHERE id = v_item.batch_id FOR UPDATE;

  IF v_item.started_at IS NOT NULL OR v_batch.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('batch_item_id', v_item.id, 'immutable', true,
      'scheduled_m', v_item.scheduled_m, 'unscheduled_m', v_item.unscheduled_m);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id',a.id,'capacity_bucket_id',cb.id,'work_date',cb.work_date,
    'capacity_profile_id',cb.capacity_profile_id,
    'capacity_m_snapshot',cb.capacity_m_snapshot,'scheduled_m',a.scheduled_m,
    'allocation_status',a.status,'bucket_status',cb.status
  ) ORDER BY cb.work_date,a.id),'[]'::jsonb)
    INTO v_before_allocations
    FROM public.strap_executor_daily_capacity_allocations a
    JOIN public.strap_executor_daily_capacity_buckets cb ON cb.id=a.capacity_bucket_id
   WHERE a.batch_item_id=v_item.id AND a.status='active';

  -- Lotes ainda nao iniciados sempre adotam a versao de capacidade vigente
  -- para o seu prazo. Lotes iniciados retornam acima e preservam o snapshot
  -- historico. As RPCs de configuracao refazem, em conjunto, os buckets
  -- globais; esta defesa evita que um replanejamento manual reutilize um
  -- profile obsoleto.
  SELECT * INTO v_capacity FROM public.strap_executor_capacities c
   WHERE c.executor_type=v_batch.executor_type
     AND c.contractor_id IS NOT DISTINCT FROM v_batch.contractor_id
     AND c.status='active' AND c.valid_from<=greatest(v_batch.deadline,current_date)
     AND (c.valid_to IS NULL OR c.valid_to>=greatest(v_batch.deadline,current_date))
   ORDER BY c.version DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Capacidade vigente do executor nao encontrada para o prazo do lote';
  END IF;
  IF v_batch.capacity_profile_id IS DISTINCT FROM v_capacity.id
     OR v_batch.capacity_m_per_open_day_snapshot IS DISTINCT FROM v_capacity.capacity_m_per_open_day THEN
    UPDATE public.strap_production_batches
       SET capacity_profile_id=v_capacity.id,
           capacity_m_per_open_day_snapshot=v_capacity.capacity_m_per_open_day,
           updated_at=now()
     WHERE id=v_batch.id
     RETURNING * INTO v_batch;
  END IF;

  UPDATE public.strap_executor_daily_capacity_allocations
     SET status = 'superseded'
   WHERE batch_item_id = v_item.id AND status = 'active';

  v_remaining := greatest(v_item.planned_finished_m - v_item.delivered_m, 0);
  v_day := v_batch.deadline;
  -- Comeca pela semana fabril imediatamente anterior e, quando necessario,
  -- estende para dias fabris anteriores sem jamais prometer data passada. O
  -- horizonte inferior operacional e hoje; o saldo que nao couber fica
  -- explicitamente nao programado.
  WHILE v_remaining > 0 AND v_day >= current_date LOOP
    IF public.is_strap_calendar_open(v_capacity.calendar_id, v_day) THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(format(
        'strap-capacity:%s:%s:%s', v_batch.executor_type, v_contract_key, v_day), 0));

      SELECT * INTO v_bucket
        FROM public.strap_executor_daily_capacity_buckets b
       WHERE b.executor_type = v_batch.executor_type
         AND b.contractor_id IS NOT DISTINCT FROM v_batch.contractor_id
         AND b.work_date = v_day AND b.status = 'active'
       FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.strap_executor_daily_capacity_buckets (
          executor_type, contractor_id, work_date, capacity_profile_id,
          capacity_m_snapshot, schedule_revision, status
        ) VALUES (
          v_batch.executor_type, v_batch.contractor_id, v_day, v_capacity.id,
          v_capacity.capacity_m_per_open_day, v_batch.schedule_revision, 'active'
        ) RETURNING * INTO v_bucket;
      END IF;

      SELECT greatest(0, v_bucket.capacity_m_snapshot - coalesce(sum(a.scheduled_m),0))
        INTO v_available
        FROM public.strap_executor_daily_capacity_allocations a
       WHERE a.capacity_bucket_id = v_bucket.id AND a.status = 'active';
      v_alloc := least(v_remaining, v_available);
      IF v_alloc > 0 THEN
        INSERT INTO public.strap_executor_daily_capacity_allocations (
          capacity_bucket_id, batch_item_id, scheduled_m, status
        ) VALUES (v_bucket.id, v_item.id, v_alloc, 'active');
        v_remaining := v_remaining - v_alloc;
        v_total := v_total + v_alloc;
        v_first := least(coalesce(v_first, v_day), v_day);
      END IF;
    END IF;
    v_day := v_day - 1;
  END LOOP;

  UPDATE public.strap_production_batch_items
     SET scheduled_m = v_total, unscheduled_m = v_remaining,
         status = CASE WHEN v_total > 0 THEN 'planned' ELSE 'suspended' END
   WHERE id = v_item.id;
  UPDATE public.strap_production_batches b SET
    production_start_date = x.first_day,
    status = CASE WHEN x.scheduled > 0 THEN 'planned' ELSE 'suspended' END,
    suspension_reason = CASE WHEN x.scheduled > 0 THEN NULL
      ELSE 'Sem capacidade disponivel entre hoje e o prazo da tira' END
  FROM (
    SELECT min(cb.work_date) AS first_day, coalesce(sum(a.scheduled_m),0) AS scheduled
      FROM public.strap_production_batch_items bi
      LEFT JOIN public.strap_executor_daily_capacity_allocations a
        ON a.batch_item_id = bi.id AND a.status = 'active'
      LEFT JOIN public.strap_executor_daily_capacity_buckets cb
        ON cb.id = a.capacity_bucket_id
     WHERE bi.batch_id = v_batch.id
  ) x
  WHERE b.id = v_batch.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id',a.id,'capacity_bucket_id',cb.id,'work_date',cb.work_date,
    'capacity_profile_id',cb.capacity_profile_id,
    'capacity_m_snapshot',cb.capacity_m_snapshot,'scheduled_m',a.scheduled_m,
    'allocation_status',a.status,'bucket_status',cb.status
  ) ORDER BY cb.work_date,a.id),'[]'::jsonb)
    INTO v_after_allocations
    FROM public.strap_executor_daily_capacity_allocations a
    JOIN public.strap_executor_daily_capacity_buckets cb ON cb.id=a.capacity_bucket_id
   WHERE a.batch_item_id=v_item.id AND a.status='active';
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('strap_production_batch_item',v_item.id,'reconcile',
    jsonb_build_object('item',to_jsonb(v_item),'allocations',v_before_allocations),
    jsonb_build_object('scheduled_m',v_total,'unscheduled_m',v_remaining,
      'capacity_profile_id',v_capacity.id,'allocations',v_after_allocations),
    btrim(p_reason),p_correlation_id,auth.uid());

  RETURN jsonb_build_object('batch_item_id', v_item.id,
    'scheduled_m', v_total, 'unscheduled_m', v_remaining,
    'production_start_date', v_first,'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_strap_production_contribution(
  p_sale_order_strap_demand_id uuid,
  p_stock_floor_contribution_id uuid,
  p_finished_m numeric,
  p_correlation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant_id uuid;
  v_recipe_id uuid;
  v_base_product_id uuid;
  v_finished_product_id uuid;
  v_yield numeric;
  v_required_at date;
  v_main_start date;
  v_target_week date;
  v_schedule_revision integer;
  v_sale_order_id uuid;
  v_source_label text;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_capacity public.strap_executor_capacities%ROWTYPE;
  v_week record;
  v_batch public.strap_production_batches%ROWTYPE;
  v_item public.strap_production_batch_items%ROWTYPE;
  v_contribution public.strap_production_batch_contributions%ROWTYPE;
  v_batch_revision integer;
  v_os_id uuid;
  v_soi_id uuid;
  v_existing_os uuid;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF num_nonnulls(p_sale_order_strap_demand_id, p_stock_floor_contribution_id) <> 1 THEN
    RAISE EXCEPTION 'Contribuicao de producao exige exatamente uma origem';
  END IF;
  IF coalesce(p_finished_m,0) <= 0 THEN RETURN NULL; END IF;

  IF p_sale_order_strap_demand_id IS NOT NULL THEN
    SELECT d.strap_variant_id, d.recipe_id, d.base_product_id, d.finished_product_id,
           d.confirmed_yield_snapshot, d.required_at, d.main_production_start,
           d.target_week, d.schedule_revision, d.sale_order_id,
           so.order_number
      INTO v_variant_id, v_recipe_id, v_base_product_id, v_finished_product_id,
           v_yield, v_required_at, v_main_start, v_target_week,
           v_schedule_revision, v_sale_order_id, v_source_label
      FROM public.sale_order_strap_demands d
      JOIN public.sale_orders so ON so.id = d.sale_order_id
     WHERE d.id = p_sale_order_strap_demand_id;
  ELSE
    SELECT f.strap_variant_id, f.recipe_id, f.base_product_id, f.finished_product_id,
           f.confirmed_yield_snapshot, f.needed_at, f.needed_at + 7,
           date_trunc('week', f.needed_at)::date, f.schedule_revision,
           NULL::uuid, 'Reposicao de estoque minimo'
      INTO v_variant_id, v_recipe_id, v_base_product_id, v_finished_product_id,
           v_yield, v_required_at, v_main_start, v_target_week,
           v_schedule_revision, v_sale_order_id, v_source_label
      FROM public.strap_stock_floor_contributions f
     WHERE f.id = p_stock_floor_contribution_id;
  END IF;
  IF v_variant_id IS NULL OR v_recipe_id IS NULL THEN RAISE EXCEPTION 'Origem interna sem receita exata'; END IF;
  SELECT * INTO v_recipe FROM public.artisanal_strap_recipes WHERE id = v_recipe_id;

  SELECT * INTO v_capacity FROM public.strap_executor_capacities c
   WHERE c.executor_type = v_recipe.executor_type
     AND c.contractor_id IS NOT DISTINCT FROM v_recipe.default_contractor_id
     AND c.status = 'active'
     AND c.valid_from <= greatest(coalesce(v_required_at,current_date),current_date)
     AND (c.valid_to IS NULL
       OR c.valid_to >= greatest(coalesce(v_required_at,current_date),current_date))
   ORDER BY c.version DESC LIMIT 1;
  IF NOT FOUND THEN
    IF p_sale_order_strap_demand_id IS NOT NULL THEN
      UPDATE public.sale_order_strap_demands SET suspended_from_status = status,
        status = 'suspended', suspension_reason = 'Capacidade diaria do executor nao cadastrada',
        suspended_at = now(), suspended_by = auth.uid()
       WHERE id = p_sale_order_strap_demand_id;
    ELSE
      UPDATE public.strap_stock_floor_contributions SET suspended_from_status = status,
        status = 'suspended', suspension_reason = 'Capacidade diaria do executor nao cadastrada',
        suspended_at = now(), suspended_by = auth.uid()
       WHERE id = p_stock_floor_contribution_id;
    END IF;
    RETURN NULL;
  END IF;

  -- Serializa a busca/edicao do lote antes de adquirir qualquer row lock de
  -- contribuicao, na mesma ordem usada pelo scheduler e pelo replanejamento
  -- de configuracao.
  PERFORM pg_advisory_xact_lock(hashtextextended(format(
    'strap-schedule:%s:%s',v_recipe.executor_type,
    coalesce(v_recipe.default_contractor_id::text,'factory')),0));

  SELECT c.* INTO v_contribution
    FROM public.strap_production_batch_contributions c
    JOIN public.strap_production_batch_items i ON i.id = c.batch_item_id
    JOIN public.strap_production_batches b ON b.id = i.batch_id
   WHERE c.status IN ('planned','suspended')
     AND b.started_at IS NULL AND i.started_at IS NULL
     AND ((p_sale_order_strap_demand_id IS NOT NULL
       AND c.sale_order_strap_demand_id = p_sale_order_strap_demand_id)
       OR (p_stock_floor_contribution_id IS NOT NULL
       AND c.stock_floor_contribution_id = p_stock_floor_contribution_id))
   FOR UPDATE OF c, i, b
   LIMIT 1;
  IF FOUND THEN
    UPDATE public.strap_production_batch_contributions
       SET planned_m = p_finished_m, correlation_id = p_correlation_id, status = 'planned'
     WHERE id = v_contribution.id;
    UPDATE public.strap_production_batch_items i SET
      planned_finished_m = x.total_m,
      planned_base_m = x.total_m / i.confirmed_yield_snapshot
    FROM (
      SELECT coalesce(sum(c.planned_m),0) AS total_m
      FROM public.strap_production_batch_contributions c
      WHERE c.batch_item_id = v_contribution.batch_item_id
        AND c.status IN ('planned','in_progress','partial')
    ) x WHERE i.id = v_contribution.batch_item_id;
    PERFORM set_config('app.strap_engine_write','1',true);
    UPDATE public.service_order_items SET meters = p_finished_m, quantity = p_finished_m,
      unit_price=0,total_value=0
     WHERE id = v_contribution.service_order_item_id AND sent_at IS NULL;
    UPDATE public.strap_service_order_financial_snapshots SET planned_m=p_finished_m,updated_at=now()
     WHERE service_order_item_id=v_contribution.service_order_item_id;
    PERFORM public.schedule_strap_batch_item(v_contribution.batch_item_id,
      'Atualizacao de contribuicao da demanda',p_correlation_id);
    RETURN v_contribution.id;
  END IF;

  SELECT * INTO v_week FROM public.get_previous_strap_open_week(v_main_start, v_capacity.calendar_id);
  v_target_week := v_week.target_week;
  v_batch_revision := v_schedule_revision;
  PERFORM pg_advisory_xact_lock(hashtextextended(format(
    'strap-batch:%s:%s:%s',v_target_week,v_recipe.executor_type,
    coalesce(v_recipe.default_contractor_id::text,'factory')),0));

  -- schedule_revision e snapshot da origem, nao parte da compatibilidade do
  -- lote ainda nao iniciado. Revisoes distintas compartilham o mesmo lote e,
  -- principalmente, a mesma grade global executor x dia.
  SELECT * INTO v_batch FROM public.strap_production_batches b
   WHERE b.target_week = v_target_week
     AND b.executor_type = v_recipe.executor_type
     AND b.contractor_id IS NOT DISTINCT FROM v_recipe.default_contractor_id
     AND b.status IN ('draft','planned','suspended')
     AND b.started_at IS NULL
   ORDER BY b.created_at, b.id FOR UPDATE LIMIT 1;

  IF v_batch.id IS NULL AND EXISTS (
    SELECT 1 FROM public.strap_production_batches b
     WHERE b.target_week = v_target_week
       AND b.executor_type = v_recipe.executor_type
       AND b.contractor_id IS NOT DISTINCT FROM v_recipe.default_contractor_id
       AND b.status IN ('in_progress','partial')
  ) THEN
    SELECT coalesce(max(b.schedule_revision), v_batch_revision) + 1 INTO v_batch_revision
      FROM public.strap_production_batches b
     WHERE b.target_week = v_target_week
       AND b.executor_type = v_recipe.executor_type
       AND b.contractor_id IS NOT DISTINCT FROM v_recipe.default_contractor_id;
  END IF;

  IF v_batch.id IS NULL THEN
    INSERT INTO public.strap_production_batches (
      target_week, executor_type, contractor_id, deadline, schedule_revision,
      capacity_profile_id, capacity_m_per_open_day_snapshot, calendar_exception,
      status, correlation_id
    ) VALUES (
      v_target_week, v_recipe.executor_type, v_recipe.default_contractor_id,
      v_week.window_end, v_batch_revision, v_capacity.id,
      v_capacity.capacity_m_per_open_day, v_week.calendar_exception, 'draft', p_correlation_id
    ) RETURNING * INTO v_batch;
  END IF;

  SELECT * INTO v_item FROM public.strap_production_batch_items i
   WHERE i.batch_id = v_batch.id AND i.strap_variant_id = v_variant_id
     AND i.recipe_id = v_recipe_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.strap_production_batch_items (
      batch_id, strap_variant_id, recipe_id, recipe_version_snapshot,
      base_product_id, finished_product_id, confirmed_yield_snapshot,
      planned_finished_m, planned_base_m, status
    ) VALUES (
      v_batch.id, v_variant_id, v_recipe_id, v_recipe.version,
      v_base_product_id, v_finished_product_id, v_yield,
      p_finished_m, p_finished_m / v_yield, 'draft'
    ) RETURNING * INTO v_item;
  ELSE
    UPDATE public.strap_production_batch_items SET
      planned_finished_m = planned_finished_m + p_finished_m,
      planned_base_m = (planned_finished_m + p_finished_m) / confirmed_yield_snapshot
     WHERE id = v_item.id RETURNING * INTO v_item;
  END IF;

  INSERT INTO public.strap_production_batch_contributions (
    batch_item_id, sale_order_strap_demand_id, stock_floor_contribution_id,
    planned_m, priority, status, correlation_id
  ) VALUES (
    v_item.id, p_sale_order_strap_demand_id, p_stock_floor_contribution_id,
    p_finished_m, CASE WHEN p_sale_order_strap_demand_id IS NOT NULL THEN 100 ELSE 1000000 END,
    'planned', p_correlation_id
  ) RETURNING * INTO v_contribution;

  IF v_recipe.executor_type = 'contractor' THEN
    PERFORM set_config('app.strap_engine_write','1',true);
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'strap-open-os:' || v_recipe.default_contractor_id::text, 0));
    SELECT so.id INTO v_existing_os FROM public.service_orders so
     WHERE so.contractor_id = v_recipe.default_contractor_id
       AND lower(btrim(so.status)) IN ('pendente','pending')
       AND NOT EXISTS (SELECT 1 FROM public.service_order_items x
         WHERE x.service_order_id = so.id AND x.sent_at IS NOT NULL)
     ORDER BY so.created_at, so.id FOR UPDATE LIMIT 1;
    IF v_existing_os IS NULL THEN
      INSERT INTO public.service_orders (
        contractor_id, status, service_date, description, notes,
        source_sale_order_id, sale_order_id, linked_sale_order_ids, is_avulsa
      ) VALUES (
        v_recipe.default_contractor_id, 'Pendente', current_date,
        'Transformacao de tiras artesanais com napa da empresa',
        'OS-contêiner gerada pelo motor canonico de tiras',
        v_sale_order_id, v_sale_order_id,
        CASE WHEN v_sale_order_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[v_sale_order_id] END,
        v_sale_order_id IS NULL
      ) RETURNING id INTO v_existing_os;
    END IF;
    v_os_id := v_existing_os;

    INSERT INTO public.service_order_items (
      service_order_id, sale_order_id, material_name, description, color,
      quantity, unit, meters, unit_price, total_value, line_status, source_item_key,
      strap_variant_id, strap_recipe_id, strap_batch_item_id,
      sale_order_strap_demand_id, strap_stock_floor_contribution_id,
      base_product_id, finished_product_id, recipe_version_snapshot,
      confirmed_yield_snapshot
    ) VALUES (
      v_os_id, v_sale_order_id,
      (SELECT p.name FROM public.products p WHERE p.id = v_finished_product_id),
      v_source_label,
      (SELECT c.name FROM public.artisanal_strap_variants v
        JOIN public.canonical_colors c ON c.id = v.color_id WHERE v.id = v_variant_id),
      p_finished_m, 'm', p_finished_m, 0,
      0, 'Pendente',
      format('strap:%s:%s', coalesce(p_sale_order_strap_demand_id,p_stock_floor_contribution_id), v_contribution.id),
      v_variant_id, v_recipe_id, v_item.id, p_sale_order_strap_demand_id,
      p_stock_floor_contribution_id, v_base_product_id, v_finished_product_id,
      v_recipe.version, v_yield
    ) RETURNING id INTO v_soi_id;
    INSERT INTO public.strap_service_order_financial_snapshots(
      service_order_item_id,recipe_id,recipe_version_snapshot,
      transformation_cost_per_m_snapshot,planned_m)
    VALUES(v_soi_id,v_recipe.id,v_recipe.version,v_recipe.transformation_cost_per_m,p_finished_m);
    UPDATE public.strap_production_batch_contributions
       SET service_order_item_id = v_soi_id WHERE id = v_contribution.id;
  END IF;

  PERFORM public.schedule_strap_batch_item(v_item.id,
    'Inclusao de contribuicao da demanda',p_correlation_id);
  RETURN v_contribution.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_open_strap_purchase_order(p_purchase_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_item public.purchase_order_items%ROWTYPE;
  v_required numeric;
  v_rate numeric;
  v_moq numeric;
  v_multiple numeric;
  v_qty numeric;
  v_count integer;
  v_total numeric;
  v_before jsonb;
  v_after jsonb;
  v_correlation uuid:=gen_random_uuid();
BEGIN
  PERFORM set_config('app.strap_po_engine','1',true);
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po.source_type <> 'strap_demand' THEN RETURN '{}'::jsonb; END IF;
  IF v_po.snapshot_locked_at IS NOT NULL OR v_po.status NOT IN ('draft','pending','Pendente') THEN
    RETURN jsonb_build_object('purchase_order_id',v_po.id,'immutable',true);
  END IF;
  v_before:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);

  FOR v_item IN SELECT * FROM public.purchase_order_items
    WHERE purchase_order_id = v_po.id ORDER BY id FOR UPDATE
  LOOP
    SELECT sum(c.required_quantity_stock_unit), min(c.conversion_rate_snapshot),
           min(c.min_order_quantity_snapshot), min(c.purchase_multiple_snapshot)
      INTO v_required, v_rate, v_moq, v_multiple
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_item_id = v_item.id AND c.status = 'awaiting_approval';
    IF coalesce(v_required,0) <= 0 THEN
      UPDATE public.purchase_demand_contributions SET
        superseded_purchase_order_id = purchase_order_id,
        superseded_purchase_order_item_id = purchase_order_item_id,
        purchase_order_id = NULL, purchase_order_item_id = NULL
       WHERE purchase_order_item_id = v_item.id
         AND status IN ('cancelled','superseded','suspended');
      DELETE FROM public.purchase_order_items WHERE id = v_item.id;
    ELSE
      v_qty := CASE WHEN coalesce(v_rate,0)<=0 THEN 0
        WHEN coalesce(v_multiple,0)>0 THEN
          ceil(greatest(v_required/v_rate,greatest(coalesce(v_moq,0),0))/v_multiple)*v_multiple
        ELSE v_required/v_rate END;
      UPDATE public.purchase_order_items SET quantity = CASE
          WHEN strap_manual_quantity AND coalesce(v_multiple,0)>0
            THEN ceil(greatest(quantity,v_qty)/v_multiple)*v_multiple
          WHEN strap_manual_quantity THEN greatest(quantity,v_qty)
          ELSE v_qty END,
        suggested_quantity = v_qty WHERE id = v_item.id;
    END IF;
  END LOOP;

  SELECT count(*), coalesce(sum(quantity * unit_price),0)
    INTO v_count, v_total FROM public.purchase_order_items
   WHERE purchase_order_id = v_po.id;
  UPDATE public.purchase_orders SET total_value = v_total,
    status = CASE WHEN v_count = 0 THEN 'cancelled' ELSE status END,
    cancelled_at = CASE WHEN v_count = 0 THEN now() ELSE cancelled_at END
   WHERE id = v_po.id;
  PERFORM public.refresh_strap_purchase_order_commercial_snapshot(v_po.id);
  PERFORM public.refresh_strap_purchase_cashflow_forecast(v_po.id,v_correlation);
  v_after:=public.build_strap_purchase_order_commercial_snapshot(v_po.id);
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('purchase_order',v_po.id,'reconcile',v_before,v_after,
    'Recalculo de contribuicoes reversiveis da OC',v_correlation,auth.uid());
  RETURN jsonb_build_object('purchase_order_id',v_po.id,'item_count',v_count,'total_value',v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_strap_variant_local_202701(
  p_strap_variant_id uuid,
  p_correlation_id uuid DEFAULT gen_random_uuid(),
  p_reason text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant public.artisanal_strap_variants%ROWTYPE;
  v_finished public.products%ROWTYPE;
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_floor public.strap_stock_floor_contributions%ROWTYPE;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_anchor public.sale_order_strap_demands%ROWTYPE;
  v_available numeric;
  v_stock_alloc numeric;
  v_committed numeric;
  v_remaining numeric;
  v_shortage numeric;
  v_base_required numeric;
  v_base_custody numeric;
  v_base_factory_need numeric;
  v_base_available numeric;
  v_base_reserved numeric;
  v_base_inbound numeric;
  v_base_shortage numeric;
  v_base_needed_at date;
  v_floor_total numeric;
  v_floor_needed numeric;
  v_floor_committed numeric;
  v_floor_hash text;
  v_floor_payload jsonb;
  v_floor_revision integer;
  v_floor_has_commitment boolean := false;
  v_floor_prior_committed numeric := 0;
  v_batch_contribution_id uuid;
  v_purchase_order_ids uuid[];
  v_batch_item_ids uuid[];
  v_id uuid;
  v_order_id uuid;
  v_order_count integer;
  v_count integer := 0;
  v_before jsonb;
  v_source_availability jsonb;
  v_internal_allowed boolean := false;
  v_buy_allowed boolean := false;
  v_preserved_min_m numeric := 0;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-variant:' || p_strap_variant_id::text,0));
  SELECT * INTO v_variant FROM public.artisanal_strap_variants
   WHERE id = p_strap_variant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Variante nao encontrada'; END IF;
  v_source_availability := public.resolve_artisanal_strap_source_availability(v_variant.id);
  v_internal_allowed := coalesce(
    (v_source_availability->>'internal_production_allowed')::boolean,false);
  v_buy_allowed := coalesce(
    (v_source_availability->>'buy_ready_purchase_allowed')::boolean,false);
  v_preserved_min_m := CASE
    WHEN v_variant.min_stock_replenishment_mode='internal' AND v_internal_allowed
      THEN coalesce(v_variant.min_stock_m,0)
    WHEN v_variant.min_stock_replenishment_mode='buy_ready' AND v_buy_allowed
      THEN coalesce(v_variant.min_stock_m,0)
    ELSE 0 END;
  v_before:=jsonb_build_object(
    'demands',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.required_at,d.id)
      FROM public.sale_order_strap_demands d
      WHERE d.strap_variant_id=p_strap_variant_id AND d.is_current),'[]'::jsonb),
    'floor',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.created_at,f.id)
      FROM public.strap_stock_floor_contributions f
      WHERE f.strap_variant_id=p_strap_variant_id AND f.is_current),'[]'::jsonb),
    'reservations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at,r.id)
      FROM public.material_reservations r
      WHERE r.strap_variant_id=p_strap_variant_id
        AND r.source IN ('strap_engine_finished','strap_engine_base')),'[]'::jsonb));

  -- Ordem global de locks de produtos: UUID crescente, incluindo todas as bases
  -- historicas ainda abertas. Variantes diferentes que disputam a mesma napa
  -- nunca prometem o mesmo saldo.
  PERFORM 1 FROM public.products p
   WHERE p.id IN (
     SELECT v_variant.finished_product_id
     UNION
     SELECT d.base_product_id FROM public.sale_order_strap_demands d
      WHERE d.strap_variant_id = p_strap_variant_id AND d.is_current
        AND d.base_product_id IS NOT NULL
     UNION
     SELECT f.base_product_id FROM public.strap_stock_floor_contributions f
      WHERE f.strap_variant_id = p_strap_variant_id AND f.is_current
        AND f.base_product_id IS NOT NULL
   ) ORDER BY p.id FOR UPDATE;

  -- Neutraliza somente reservas automaticas integralmente reversiveis da
  -- propria variante. Reserva parcialmente consumida e fato fisico e nunca
  -- pode ser apagada por uma nova rodada de planejamento.
  UPDATE public.material_reservations SET status = 'cancelled',
    notes = coalesce(notes,'') || ' | supersedida pela reconciliacao ' || p_correlation_id::text
   WHERE strap_variant_id = p_strap_variant_id
     AND source IN ('strap_engine_finished','strap_engine_base')
     AND status = 'reserved'
     AND coalesce(quantity_consumed,0)=0
     AND NOT EXISTS (
       SELECT 1 FROM public.strap_production_batch_items bi
       JOIN public.strap_production_batches b ON b.id=bi.batch_id
       WHERE bi.id=material_reservations.strap_batch_item_id
         AND (bi.started_at IS NOT NULL OR b.started_at IS NOT NULL
           OR bi.status IN ('in_progress','partial') OR b.status IN ('in_progress','partial'))
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.strap_production_batch_contributions c
       JOIN public.service_order_items soi ON soi.id=c.service_order_item_id
       WHERE c.batch_item_id=material_reservations.strap_batch_item_id
         AND soi.sent_at IS NOT NULL
     );

  -- Variante suspensa/review/descontinuada nao cria reserva, lote ou OC nova.
  -- O reconcile apenas retira promessas reversiveis e preserva integralmente
  -- entradas aprovadas, lotes iniciados, consumo e custodia ja existentes.
  IF v_variant.status <> 'active' THEN
    SELECT array_agg(DISTINCT c.purchase_order_id) INTO v_purchase_order_ids
      FROM public.purchase_demand_contributions c
     WHERE c.strap_variant_id=p_strap_variant_id
       AND c.purchase_order_id IS NOT NULL
       AND c.status IN ('proposed','awaiting_approval');
    UPDATE public.purchase_demand_contributions c
       SET status='cancelled',
           suspension_reason='Variante fora do estado ativo: '||v_variant.status,
           correlation_id=p_correlation_id
     WHERE c.strap_variant_id=p_strap_variant_id
       AND c.status IN ('proposed','awaiting_approval');

    SELECT array_agg(DISTINCT c.batch_item_id) INTO v_batch_item_ids
      FROM public.strap_production_batch_contributions c
      JOIN public.strap_production_batch_items bi ON bi.id=c.batch_item_id
      JOIN public.strap_production_batches b ON b.id=bi.batch_id
     WHERE bi.strap_variant_id=p_strap_variant_id
       AND c.status='planned' AND bi.started_at IS NULL AND b.started_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.service_order_items soi
         WHERE soi.id=c.service_order_item_id AND soi.sent_at IS NOT NULL);
    UPDATE public.service_order_items soi SET line_status='Cancelado'
     WHERE soi.id IN (
       SELECT c.service_order_item_id
         FROM public.strap_production_batch_contributions c
         JOIN public.strap_production_batch_items bi ON bi.id=c.batch_item_id
         JOIN public.strap_production_batches b ON b.id=bi.batch_id
        WHERE bi.strap_variant_id=p_strap_variant_id
          AND c.status='planned' AND bi.started_at IS NULL AND b.started_at IS NULL
          AND c.service_order_item_id IS NOT NULL
     ) AND soi.sent_at IS NULL;
    UPDATE public.strap_production_batch_contributions c
       SET status='superseded',correlation_id=p_correlation_id
      FROM public.strap_production_batch_items bi,
           public.strap_production_batches b
     WHERE bi.id=c.batch_item_id AND b.id=bi.batch_id
       AND bi.strap_variant_id=p_strap_variant_id
       AND c.status='planned' AND bi.started_at IS NULL AND b.started_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.service_order_items soi
         WHERE soi.id=c.service_order_item_id AND soi.sent_at IS NOT NULL);

    UPDATE public.sale_order_strap_demands d SET
      finished_stock_reserved_m=coalesce((
        SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
          FROM public.material_reservations r
         WHERE r.sale_order_strap_demand_id=d.id
           AND r.source='strap_engine_finished'
           AND r.status IN ('reserved','partially_consumed')
      ),0),
      base_reserved_m=coalesce((
        SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
          FROM public.material_reservations r
         WHERE r.sale_order_strap_demand_id=d.id
           AND r.source='strap_engine_base'
           AND r.status IN ('reserved','partially_consumed')
      ),0),
      suspended_from_status=CASE WHEN d.status='suspended'
        THEN d.suspended_from_status ELSE d.status END,
      status='suspended',
      suspension_reason='Variante fora do estado ativo: '||v_variant.status,
      suspended_at=coalesce(d.suspended_at,now()),
      suspended_by=coalesce(d.suspended_by,auth.uid()),
      correlation_id=p_correlation_id
    WHERE d.strap_variant_id=p_strap_variant_id AND d.is_current
      AND d.status NOT IN ('fulfilled','superseded','cancelled','error');

    UPDATE public.strap_stock_floor_contributions f SET
      base_reserved_m=coalesce((
        SELECT sum(greatest(r.quantity_reserved-r.quantity_consumed,0))
          FROM public.material_reservations r
         WHERE r.strap_stock_floor_contribution_id=f.id
           AND r.source='strap_engine_base'
           AND r.status IN ('reserved','partially_consumed')
      ),0),
      suspended_from_status=CASE WHEN f.status='suspended'
        THEN f.suspended_from_status ELSE f.status END,
      status='suspended',
      suspension_reason='Variante fora do estado ativo: '||v_variant.status,
      suspended_at=coalesce(f.suspended_at,now()),
      suspended_by=coalesce(f.suspended_by,auth.uid()),
      correlation_id=p_correlation_id
    WHERE f.strap_variant_id=p_strap_variant_id AND f.is_current
      AND f.status NOT IN ('fulfilled','superseded','cancelled','error');

    FOREACH v_id IN ARRAY coalesce(v_purchase_order_ids,ARRAY[]::uuid[]) LOOP
      PERFORM public.recalculate_open_strap_purchase_order(v_id);
    END LOOP;
    UPDATE public.strap_executor_daily_capacity_allocations a
       SET status='superseded',updated_at=now()
     WHERE a.batch_item_id=ANY(coalesce(v_batch_item_ids,ARRAY[]::uuid[]))
       AND a.status='active';
    UPDATE public.strap_production_batch_items bi SET
      planned_finished_m=x.total_m,
      planned_base_m=x.total_m/bi.confirmed_yield_snapshot,
      scheduled_m=0,unscheduled_m=x.total_m,
      status=CASE WHEN x.total_m=0 AND bi.started_at IS NULL THEN 'cancelled' ELSE bi.status END,
      updated_at=now()
    FROM (
      SELECT u.item_id,coalesce(sum(c.planned_m),0) AS total_m
      FROM unnest(coalesce(v_batch_item_ids,ARRAY[]::uuid[])) AS u(item_id)
      LEFT JOIN public.strap_production_batch_contributions c
        ON c.batch_item_id=u.item_id AND c.status IN ('planned','in_progress','partial')
      GROUP BY u.item_id
    ) x
    WHERE bi.id=x.item_id;
    PERFORM public.materialize_strap_purchase_orders(500,p_correlation_id);
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES ('strap_variant',p_strap_variant_id,'suspend',v_before,
      jsonb_build_object('variant_status',v_variant.status,
        'reversible_promises_neutralized',true),
      p_reason,p_correlation_id,auth.uid());
    RETURN jsonb_build_object('strap_variant_id',p_strap_variant_id,
      'variant_status',v_variant.status,'reconciled',false,
      'reversible_promises_neutralized',true,'correlation_id',p_correlation_id);
  END IF;

  -- Reconstroi as alocacoes reversiveis desta variante na ordem de prioridade.
  -- Alocacoes de outras variantes permanecem contabilizadas pela funcao de
  -- inbound; os locks globais de produto serializam a disputa pelo excedente.
  UPDATE public.sale_order_strap_demands
     SET committed_finished_inbound_m=0,base_inbound_allocated_m=0
   WHERE strap_variant_id=p_strap_variant_id AND is_current
     AND status NOT IN ('superseded','cancelled','error','fulfilled');
  SELECT coalesce(f.committed_finished_inbound_m,0)
    INTO v_floor_prior_committed
    FROM public.strap_stock_floor_contributions f
   WHERE f.strap_variant_id=p_strap_variant_id AND f.is_current;
  v_floor_prior_committed:=coalesce(v_floor_prior_committed,0);
  UPDATE public.strap_stock_floor_contributions
     SET committed_finished_inbound_m=0,base_inbound_allocated_m=0
   WHERE strap_variant_id=p_strap_variant_id AND is_current
     AND status NOT IN ('superseded','cancelled','fulfilled');

  SELECT * INTO v_finished FROM public.products
   WHERE id = v_variant.finished_product_id FOR UPDATE;
  v_available := greatest(0, coalesce(v_finished.quantity,0) - coalesce(v_finished.reserved_stock,0));

  FOR v_demand IN
    SELECT d.* FROM public.sale_order_strap_demands d
     WHERE d.strap_variant_id = p_strap_variant_id AND d.is_current
       AND d.status NOT IN ('superseded','cancelled','error','fulfilled')
     ORDER BY d.required_at, d.confirmed_at, d.id
  LOOP
    v_remaining := greatest(0, v_demand.gross_required_m - v_demand.fulfilled_m - v_demand.cancelled_m);
    SELECT count(*)::integer,max(o.id) INTO v_order_count,v_order_id
      FROM public.orders o
     WHERE o.sale_order_item_id=v_demand.sale_order_item_id
       AND lower(btrim(o.status)) NOT IN
         ('finalizado','cancelado','cancelada','completed','cancelled');
    IF v_order_count>1 THEN
      v_committed:=least(v_remaining,public.strap_committed_finished_inbound(
        v_demand.finished_product_id,v_demand.id,NULL,v_demand.required_at));
      UPDATE public.sale_order_strap_demands SET finished_stock_reserved_m=0,
        committed_finished_inbound_m=v_committed,
        replenishment_required_m=greatest(0,v_remaining-v_committed),
        status='suspended',suspended_from_status=status,
        suspension_reason='Mais de uma OP ativa para o mesmo item do PV; vinculo de picking ambiguo',
        suspended_at=now(),suspended_by=auth.uid(),correlation_id=p_correlation_id
       WHERE id=v_demand.id;
      v_count:=v_count+1;
      CONTINUE;
    END IF;
    -- Suspensao tecnica causada pelo catalogo/fonte e reavaliada
    -- automaticamente. Isso permite consumir saldo que chegou depois e
    -- retomar quando a variante e reativada ou o cadastro e saneado. Suspensao
    -- operacional manual continua exigindo a RPC de retomada.
    IF v_demand.status='suspended' AND (
      v_demand.suspension_reason LIKE 'Variante fora do estado ativo:%'
      OR (v_demand.source_mode='internal'
        AND v_demand.suspension_reason LIKE 'Producao interna indisponivel:%')
      OR (v_demand.source_mode='buy_ready'
        AND v_demand.suspension_reason LIKE 'Compra pronta indisponivel:%')
    ) THEN
      UPDATE public.sale_order_strap_demands SET
        status=coalesce(suspended_from_status,'pending'),
        suspended_from_status=NULL,suspension_reason=NULL,
        suspended_at=NULL,suspended_by=NULL,correlation_id=p_correlation_id
      WHERE id=v_demand.id RETURNING * INTO v_demand;
    END IF;
    IF v_demand.status='suspended' THEN
      v_committed:=least(v_remaining,public.strap_committed_finished_inbound(
        v_demand.finished_product_id,v_demand.id,NULL,v_demand.required_at));
      UPDATE public.sale_order_strap_demands SET finished_stock_reserved_m=0,
        committed_finished_inbound_m=v_committed,
        replenishment_required_m=greatest(0,v_remaining-v_committed),
        base_reserved_m=0,correlation_id=p_correlation_id WHERE id=v_demand.id;
      v_count:=v_count+1;
      CONTINUE;
    END IF;
    -- Req58: tira acabada fisicamente disponivel cobre primeiro o PV. O inbound
    -- comprometido cobre apenas o saldo, deixando sua sobra para a proxima
    -- demanda/piso da fila deterministica.
    v_stock_alloc := least(v_remaining,
      greatest(0,v_available-v_preserved_min_m));
    v_available := v_available - v_stock_alloc;
    v_committed := least(greatest(v_remaining-v_stock_alloc,0),
      public.strap_committed_finished_inbound(
        v_demand.finished_product_id,v_demand.id,NULL,v_demand.required_at));

    IF v_stock_alloc > 0 THEN
      INSERT INTO public.material_reservations (
        order_id, product_id, quantity_reserved, quantity_consumed, status,
        reservation_type, source, notes, metadata, strap_variant_id,
        sale_order_strap_demand_id, finished_product_id, correlation_id
      ) VALUES (
        v_order_id,
        v_demand.finished_product_id, v_stock_alloc, 0, 'reserved', 'soft',
        'strap_engine_finished', 'Alocacao automatica de tira acabada',
        jsonb_build_object('consumption_sector','Tiras artesanais','coverage_mode','pre_netted'),
        p_strap_variant_id, v_demand.id, v_demand.finished_product_id, p_correlation_id
      );
    END IF;

    v_shortage := greatest(0, v_remaining - v_stock_alloc - v_committed);
    v_base_required := 0; v_base_reserved := 0; v_base_inbound := 0; v_base_shortage := 0;
    v_base_needed_at := NULL; v_batch_contribution_id := NULL;

    IF v_shortage > 0 AND v_demand.source_mode = 'internal' AND v_internal_allowed THEN
      SELECT * INTO v_recipe FROM public.artisanal_strap_recipes
       WHERE id = v_demand.recipe_id
         AND version = v_demand.recipe_version_snapshot
         AND base_group_id = (v_demand.identity_snapshot->'resolved'->'catalog'->>'base_group_id')::uuid;
      IF FOUND
         AND v_recipe.confirmed_yield_m_per_m = v_demand.confirmed_yield_snapshot
         AND v_demand.base_product_id IS NOT NULL
         AND v_demand.finished_product_id = v_variant.finished_product_id THEN
        v_batch_contribution_id := public.ensure_strap_production_contribution(
          v_demand.id,NULL,v_shortage,p_correlation_id);
        SELECT b.production_start_date INTO v_base_needed_at
          FROM public.strap_production_batch_contributions c
          JOIN public.strap_production_batch_items i ON i.id = c.batch_item_id
          JOIN public.strap_production_batches b ON b.id = i.batch_id
         WHERE c.id = v_batch_contribution_id;
        v_base_needed_at := coalesce(v_base_needed_at, v_demand.strap_start, v_demand.required_at);
        v_base_required := v_shortage / v_demand.confirmed_yield_snapshot;
        SELECT coalesce(sum(cb.balance_in_custody),0) INTO v_base_custody
          FROM public.v_contractor_material_custody_balances cb
          JOIN public.service_order_items soi ON soi.id=cb.service_order_item_id
         WHERE soi.sale_order_strap_demand_id=v_demand.id
           AND cb.base_product_id=v_demand.base_product_id
           AND cb.balance_in_custody>0;
        v_base_factory_need:=greatest(v_base_required-v_base_custody,0);
        v_base_available := public.strap_base_available_now(v_demand.base_product_id);
        -- Req76: estoque fisico disponivel e a primeira cobertura. Inbound so
        -- cobre o saldo restante; nunca deixamos napa presente sem reserva.
        v_base_reserved := least(v_base_factory_need,v_base_available);
        v_base_inbound := least(greatest(v_base_factory_need-v_base_reserved,0),
          public.strap_committed_purchase_inbound(
            v_demand.base_product_id,v_demand.id,NULL,v_base_needed_at));
        IF v_base_reserved > 0 THEN
          INSERT INTO public.material_reservations (
            order_id, product_id, quantity_reserved, quantity_consumed, status,
            reservation_type, source, notes, metadata, strap_variant_id,
            sale_order_strap_demand_id, strap_batch_item_id, base_product_id,
            correlation_id
          ) VALUES (
            NULL, v_demand.base_product_id, v_base_reserved, 0, 'reserved', 'soft',
            'strap_engine_base', 'Reserva de napa para transformacao de tira',
            jsonb_build_object('consumption_sector','Tiras artesanais','coverage_mode','pre_netted'),
            p_strap_variant_id, v_demand.id,
            (SELECT c.batch_item_id FROM public.strap_production_batch_contributions c
              WHERE c.id = v_batch_contribution_id),
            v_demand.base_product_id, p_correlation_id
          );
        END IF;
        v_base_shortage := greatest(0,v_base_factory_need-v_base_reserved-v_base_inbound);
        PERFORM public.upsert_strap_purchase_contribution(
          v_demand.id,NULL,v_demand.base_product_id,v_base_shortage,v_base_needed_at,
          v_demand.billing_anchor,v_demand.billing_year,v_demand.billing_month,
          v_demand.billing_fortnight,p_correlation_id);
      ELSE
        UPDATE public.sale_order_strap_demands SET suspended_from_status = status,
          status = 'suspended', suspension_reason = 'Identidade da receita congelada esta divergente',
          suspended_at = now(), suspended_by = auth.uid() WHERE id = v_demand.id;
      END IF;
    ELSIF v_shortage > 0 AND v_demand.source_mode = 'buy_ready' AND v_buy_allowed THEN
      PERFORM public.upsert_strap_purchase_contribution(
        v_demand.id,NULL,v_demand.finished_product_id,v_shortage,v_demand.required_at,
        v_demand.billing_anchor,v_demand.billing_year,v_demand.billing_month,
        v_demand.billing_fortnight,p_correlation_id);
    ELSIF v_shortage > 0 THEN
      UPDATE public.sale_order_strap_demands SET suspended_from_status = status,
        status = 'suspended', suspension_reason = CASE
          WHEN v_demand.source_mode='internal' THEN
            'Producao interna indisponivel: '||coalesce(
              v_source_availability->>'internal_block_reason','cadastro atual')
          ELSE 'Compra pronta indisponivel: '||coalesce(
            v_source_availability->>'buy_ready_block_reason','cadastro atual') END,
        suspended_at = now(), suspended_by = auth.uid() WHERE id = v_demand.id;
    END IF;

    UPDATE public.sale_order_strap_demands SET
      finished_stock_reserved_m = v_stock_alloc,
      committed_finished_inbound_m = v_committed,
      replenishment_required_m = v_shortage,
      base_required_m = v_base_required,
      base_reserved_m = v_base_reserved,
      base_inbound_allocated_m = v_base_inbound,
      base_shortage_m = v_base_shortage,
      purchase_product_id = CASE
        WHEN v_demand.source_mode = 'buy_ready' AND v_shortage > 0 THEN v_demand.finished_product_id
        WHEN v_demand.source_mode = 'internal' AND v_base_shortage > 0 THEN v_demand.base_product_id
        ELSE NULL END,
      purchase_shortage_stock_unit = CASE
        WHEN v_demand.source_mode = 'buy_ready' THEN v_shortage ELSE v_base_shortage END,
      base_required_at = v_base_needed_at,
      base_purchase_by = CASE WHEN v_base_shortage > 0 THEN
        v_base_needed_at - coalesce((SELECT p.material_preparation_days FROM public.products p
          WHERE p.id = v_demand.base_product_id),2)
        - coalesce((SELECT CASE WHEN coalesce(s.lead_time_days,0)>0
            THEN s.lead_time_days ELSE 15 END
          FROM public.products p LEFT JOIN public.suppliers s
            ON s.id = p.supplier_id
          WHERE p.id = v_demand.base_product_id),15) ELSE NULL END,
      calculation_explanation = jsonb_build_object(
        'physical_available_before', v_available + v_stock_alloc,
        'minimum_preserved_m', v_preserved_min_m,
        'finished_stock_allocated_m', v_stock_alloc,
        'committed_inbound_m', v_committed,
        'finished_shortage_m', v_shortage,
        'base_required_m', v_base_required,
        'base_reserved_m', v_base_reserved,
        'base_inbound_m', v_base_inbound,
        'base_shortage_m', v_base_shortage,
        'reason', p_reason
      ),
      status = CASE
        WHEN status = 'suspended' THEN status
        WHEN v_remaining = 0 THEN 'fulfilled'
        WHEN v_shortage > 0 THEN 'planned'
        WHEN v_stock_alloc + v_committed > 0 THEN 'allocated'
        ELSE 'pending' END,
      correlation_id = p_correlation_id
    WHERE id = v_demand.id;
    v_count := v_count + 1;
  END LOOP;

  -- Piso: nasce depois de todos os PVs e usa exclusivamente a origem configurada
  -- na variante. Nunca herda a origem de uma demanda nem cria PV ficticio.
  SELECT * INTO v_anchor FROM public.sale_order_strap_demands d
   WHERE d.strap_variant_id = p_strap_variant_id AND d.is_current
     AND d.status NOT IN ('superseded','cancelled','error','fulfilled')
   ORDER BY d.required_at,d.confirmed_at,d.id LIMIT 1;
  SELECT * INTO v_floor FROM public.strap_stock_floor_contributions f
   WHERE f.strap_variant_id = p_strap_variant_id AND f.is_current FOR UPDATE;
  v_floor_total := greatest(0,coalesce(v_variant.min_stock_m,0)-v_available);
  v_floor_committed := CASE WHEN v_floor.id IS NULL THEN 0 ELSE
    least(v_floor_total,public.strap_committed_finished_inbound(
      v_variant.finished_product_id,NULL,v_floor.id,v_anchor.required_at)) END;
  v_floor_needed := greatest(0,v_floor_total-v_floor_committed);

  IF v_floor.id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.purchase_demand_contributions c
       WHERE c.strap_stock_floor_contribution_id=v_floor.id
         AND c.status IN ('approved','sent','partial','received')
      UNION ALL
      SELECT 1 FROM public.strap_production_batch_contributions c
      JOIN public.strap_production_batch_items bi ON bi.id=c.batch_item_id
      JOIN public.strap_production_batches b ON b.id=bi.batch_id
       WHERE c.stock_floor_contribution_id=v_floor.id
         AND (b.started_at IS NOT NULL OR bi.started_at IS NOT NULL
           OR c.status IN ('in_progress','partial','fulfilled'))
    ) INTO v_floor_has_commitment;
  END IF;

  IF v_anchor.id IS NULL THEN
    IF v_floor.id IS NOT NULL THEN
      UPDATE public.strap_stock_floor_contributions SET
        required_m = required_m,
        fulfilled_m = CASE WHEN v_floor_has_commitment THEN fulfilled_m ELSE required_m END,
        committed_finished_inbound_m=CASE WHEN v_floor_has_commitment
          THEN v_floor_prior_committed ELSE 0 END,
        replenishment_required_m = CASE WHEN v_floor_has_commitment
          THEN greatest(0,required_m-fulfilled_m-v_floor_prior_committed) ELSE 0 END,
        status = CASE WHEN v_floor_has_commitment THEN status ELSE 'fulfilled' END,
        correlation_id = p_correlation_id
       WHERE id = v_floor.id;
    END IF;
  ELSIF coalesce(v_variant.min_stock_m,0) = 0 THEN
    IF v_floor.id IS NOT NULL THEN
      UPDATE public.strap_stock_floor_contributions SET fulfilled_m=required_m,
        committed_finished_inbound_m=CASE WHEN v_floor_has_commitment
          THEN v_floor_prior_committed ELSE 0 END,
        replenishment_required_m = 0, status = 'fulfilled', correlation_id = p_correlation_id
       WHERE id = v_floor.id;
    END IF;
  ELSIF v_floor_needed = 0 THEN
    -- O piso ja foi coberto pelo saldo fisico/entrada concluida. Encerra a
    -- contribuicao corrente para que ela nao permaneça planejada eternamente;
    -- compromissos irreversiveis continuam como fatos e sua sobra vira oferta
    -- livre quando chegar, sem apagar o snapshot original.
    IF v_floor.id IS NOT NULL THEN
      UPDATE public.strap_stock_floor_contributions SET
        fulfilled_m=required_m,
        committed_finished_inbound_m=CASE WHEN v_floor_has_commitment
          THEN v_floor_prior_committed ELSE 0 END,
        replenishment_required_m=0,
        purchase_shortage_stock_unit=0,
        base_shortage_m=0,
        status='fulfilled',correlation_id=p_correlation_id
       WHERE id=v_floor.id;
    END IF;
  ELSIF v_floor_needed > 0 THEN
    SELECT * INTO v_recipe FROM public.artisanal_strap_recipes r
     WHERE r.measure_id = v_variant.measure_id AND r.base_group_id = v_variant.base_group_id
       AND r.status = 'approved' AND r.valid_from <= now()
       AND (r.valid_to IS NULL OR r.valid_to > now());
    v_floor_payload := jsonb_build_object('variant_id',v_variant.id,
      'required_m',v_floor_total,'source_mode',v_variant.min_stock_replenishment_mode,
      'anchor_demand_id',v_anchor.id,'needed_at',v_anchor.required_at,
      'billing_anchor',v_anchor.billing_anchor,'schedule_revision',v_anchor.schedule_revision);
    v_floor_hash := public.strap_payload_hash(v_floor_payload);
    IF v_floor.id IS NULL OR v_floor.payload_hash <> v_floor_hash THEN
      IF v_floor.id IS NOT NULL THEN
        UPDATE public.strap_stock_floor_contributions SET is_current=false,status='superseded'
         WHERE id=v_floor.id;
      END IF;
      SELECT coalesce(max(revision),0)+1 INTO v_floor_revision
        FROM public.strap_stock_floor_contributions WHERE strap_variant_id=p_strap_variant_id;
      INSERT INTO public.strap_stock_floor_contributions (
        strap_variant_id,recipe_id,base_product_id,finished_product_id,
        confirmed_yield_snapshot,source_mode,calculation_revision,required_m,
        committed_finished_inbound_m,replenishment_required_m,needed_at,
        billing_anchor_sale_order_id,billing_anchor_demand_id,billing_anchor,
        billing_year,billing_month,billing_fortnight,schedule_revision,status,
        revision,is_current,supersedes_contribution_id,operation_type,idempotency_key,
        payload_hash,correlation_id
      ) VALUES (
        v_variant.id,
        CASE WHEN v_variant.min_stock_replenishment_mode='internal' THEN v_recipe.id ELSE NULL END,
        CASE WHEN v_variant.min_stock_replenishment_mode='internal' THEN
          (SELECT op.official_product_id FROM public.base_material_color_official_products op
            WHERE op.base_group_id=v_variant.base_group_id AND op.color_id=v_variant.color_id
              AND op.status='active') ELSE NULL END,
        v_variant.finished_product_id,
        CASE WHEN v_variant.min_stock_replenishment_mode='internal'
          THEN v_recipe.confirmed_yield_m_per_m ELSE NULL END,
        v_variant.min_stock_replenishment_mode,v_floor_revision,v_floor_total,
        v_floor_committed,v_floor_needed,v_anchor.required_at,v_anchor.sale_order_id,
        v_anchor.id,v_anchor.billing_anchor,v_anchor.billing_year,v_anchor.billing_month,
        v_anchor.billing_fortnight,v_anchor.schedule_revision,
        CASE WHEN v_variant.min_stock_replenishment_mode IS NULL
          OR (v_variant.min_stock_replenishment_mode='internal' AND NOT v_internal_allowed)
          OR (v_variant.min_stock_replenishment_mode='buy_ready' AND NOT v_buy_allowed)
          THEN 'suspended' ELSE 'pending' END,
        v_floor_revision,true,v_floor.id,'strap_stock_floor',
        format('strap-floor:%s:r%s',v_variant.id,v_floor_revision),v_floor_hash,p_correlation_id
      ) RETURNING * INTO v_floor;
    ELSE
      UPDATE public.strap_stock_floor_contributions SET required_m=v_floor_total,
        committed_finished_inbound_m=v_floor_committed,replenishment_required_m=v_floor_needed,
        suspended_from_status=CASE
          WHEN (source_mode='internal' AND NOT v_internal_allowed)
            OR (source_mode='buy_ready' AND NOT v_buy_allowed)
          THEN CASE WHEN status='suspended' THEN suspended_from_status ELSE status END
          ELSE suspended_from_status END,
        status=CASE
          WHEN (source_mode='internal' AND NOT v_internal_allowed)
            OR (source_mode='buy_ready' AND NOT v_buy_allowed)
          THEN 'suspended' ELSE status END,
        suspension_reason=CASE
          WHEN source_mode='internal' AND NOT v_internal_allowed THEN
            'Producao interna indisponivel: '||coalesce(
              v_source_availability->>'internal_block_reason','cadastro atual')
          WHEN source_mode='buy_ready' AND NOT v_buy_allowed THEN
            'Compra pronta indisponivel: '||coalesce(
              v_source_availability->>'buy_ready_block_reason','cadastro atual')
          ELSE suspension_reason END,
        suspended_at=CASE
          WHEN (source_mode='internal' AND NOT v_internal_allowed)
            OR (source_mode='buy_ready' AND NOT v_buy_allowed)
          THEN coalesce(suspended_at,now()) ELSE suspended_at END,
        suspended_by=CASE
          WHEN (source_mode='internal' AND NOT v_internal_allowed)
            OR (source_mode='buy_ready' AND NOT v_buy_allowed)
          THEN coalesce(suspended_by,auth.uid()) ELSE suspended_by END,
        correlation_id=p_correlation_id WHERE id=v_floor.id RETURNING * INTO v_floor;
    END IF;

    IF (v_floor.source_mode='internal' AND NOT v_internal_allowed)
       OR (v_floor.source_mode='buy_ready' AND NOT v_buy_allowed) THEN
      UPDATE public.strap_stock_floor_contributions SET
        suspended_from_status=CASE WHEN status='suspended'
          THEN suspended_from_status ELSE status END,
        status='suspended',
        suspension_reason=CASE WHEN source_mode='internal' THEN
          'Producao interna indisponivel: '||coalesce(
            v_source_availability->>'internal_block_reason','cadastro atual')
          ELSE 'Compra pronta indisponivel: '||coalesce(
            v_source_availability->>'buy_ready_block_reason','cadastro atual') END,
        suspended_at=coalesce(suspended_at,now()),
        suspended_by=coalesce(suspended_by,auth.uid()),
        correlation_id=p_correlation_id
      WHERE id=v_floor.id
      RETURNING * INTO v_floor;
    ELSIF v_floor.status='suspended' AND (
      v_floor.suspension_reason LIKE 'Variante fora do estado ativo:%'
      OR (v_floor.source_mode='internal' AND v_internal_allowed
        AND v_floor.suspension_reason LIKE 'Producao interna indisponivel:%')
      OR (v_floor.source_mode='buy_ready' AND v_buy_allowed
        AND v_floor.suspension_reason LIKE 'Compra pronta indisponivel:%')
    ) THEN
      UPDATE public.strap_stock_floor_contributions SET
        status=coalesce(suspended_from_status,'pending'),
        suspended_from_status=NULL,suspension_reason=NULL,
        suspended_at=NULL,suspended_by=NULL,correlation_id=p_correlation_id
      WHERE id=v_floor.id
      RETURNING * INTO v_floor;
    END IF;

    IF v_floor.status <> 'suspended' AND v_floor.source_mode='buy_ready' THEN
      PERFORM public.upsert_strap_purchase_contribution(NULL,v_floor.id,
        v_floor.finished_product_id,v_floor_needed,v_floor.needed_at,v_floor.billing_anchor,
        v_floor.billing_year,v_floor.billing_month,v_floor.billing_fortnight,p_correlation_id);
      UPDATE public.strap_stock_floor_contributions SET purchase_product_id=finished_product_id,
        purchase_shortage_stock_unit=v_floor_needed,status='planned' WHERE id=v_floor.id;
    ELSIF v_floor.status <> 'suspended' AND v_floor.source_mode='internal' THEN
      v_batch_contribution_id := public.ensure_strap_production_contribution(
        NULL,v_floor.id,v_floor_needed,p_correlation_id);
      SELECT b.production_start_date INTO v_base_needed_at
        FROM public.strap_production_batch_contributions c
        JOIN public.strap_production_batch_items i ON i.id=c.batch_item_id
        JOIN public.strap_production_batches b ON b.id=i.batch_id
       WHERE c.id=v_batch_contribution_id;
      v_base_required := v_floor_needed/v_floor.confirmed_yield_snapshot;
      SELECT coalesce(sum(cb.balance_in_custody),0) INTO v_base_custody
        FROM public.v_contractor_material_custody_balances cb
        JOIN public.service_order_items soi ON soi.id=cb.service_order_item_id
       WHERE soi.strap_stock_floor_contribution_id=v_floor.id
         AND cb.base_product_id=v_floor.base_product_id
         AND cb.balance_in_custody>0;
      v_base_factory_need:=greatest(v_base_required-v_base_custody,0);
      v_base_available := public.strap_base_available_now(v_floor.base_product_id);
      -- Mesma precedencia normativa do PV: fisico, depois inbound, depois falta.
      v_base_reserved := least(v_base_factory_need,v_base_available);
      v_base_inbound:=least(greatest(v_base_factory_need-v_base_reserved,0),
        public.strap_committed_purchase_inbound(v_floor.base_product_id,NULL,v_floor.id,v_base_needed_at));
      IF v_base_reserved>0 THEN
        INSERT INTO public.material_reservations (
          order_id,product_id,quantity_reserved,quantity_consumed,status,reservation_type,
          source,notes,metadata,strap_variant_id,strap_stock_floor_contribution_id,
          strap_batch_item_id,base_product_id,correlation_id
        ) VALUES (NULL,v_floor.base_product_id,v_base_reserved,0,'reserved','soft',
          'strap_engine_base','Reserva de napa para reposicao do piso',
          jsonb_build_object('consumption_sector','Tiras artesanais','coverage_mode','pre_netted'),
          v_variant.id,v_floor.id,(SELECT batch_item_id FROM public.strap_production_batch_contributions
            WHERE id=v_batch_contribution_id),v_floor.base_product_id,p_correlation_id);
      END IF;
      v_base_shortage:=greatest(0,v_base_factory_need-v_base_reserved-v_base_inbound);
      PERFORM public.upsert_strap_purchase_contribution(NULL,v_floor.id,v_floor.base_product_id,
        v_base_shortage,coalesce(v_base_needed_at,v_floor.needed_at),v_floor.billing_anchor,
        v_floor.billing_year,v_floor.billing_month,v_floor.billing_fortnight,p_correlation_id);
      UPDATE public.strap_stock_floor_contributions SET base_required_m=v_base_required,
        base_reserved_m=v_base_reserved,base_inbound_allocated_m=v_base_inbound,
        base_shortage_m=v_base_shortage,purchase_product_id=CASE WHEN v_base_shortage>0
          THEN base_product_id ELSE NULL END,purchase_shortage_stock_unit=v_base_shortage,
        status='planned' WHERE id=v_floor.id;
    END IF;
  END IF;

  -- Remove somente contribuicoes automaticas reversiveis que nao foram tocadas
  -- por esta rodada; fatos aprovados/iniciados permanecem como inbound.
  SELECT array_agg(DISTINCT c.purchase_order_id) INTO v_purchase_order_ids
    FROM public.purchase_demand_contributions c
   WHERE c.strap_variant_id=p_strap_variant_id AND c.purchase_order_id IS NOT NULL
     AND c.status IN ('proposed','awaiting_approval','suspended')
     AND c.correlation_id<>p_correlation_id;
  UPDATE public.purchase_demand_contributions SET status='cancelled',
    suspension_reason='Contribuicao supersedida pela reconciliacao'
   WHERE strap_variant_id=p_strap_variant_id
     AND status IN ('proposed','awaiting_approval')
     AND correlation_id<>p_correlation_id;

  SELECT array_agg(DISTINCT c.batch_item_id) INTO v_batch_item_ids
    FROM public.strap_production_batch_contributions c
    JOIN public.strap_production_batch_items i ON i.id=c.batch_item_id
   WHERE i.strap_variant_id=p_strap_variant_id AND c.status='planned'
     AND c.correlation_id<>p_correlation_id
     AND NOT EXISTS (SELECT 1 FROM public.service_order_items soi
       WHERE soi.id=c.service_order_item_id AND soi.sent_at IS NOT NULL);
  UPDATE public.service_order_items s SET line_status='Cancelado'
   WHERE s.id IN (SELECT c.service_order_item_id
     FROM public.strap_production_batch_contributions c
     JOIN public.strap_production_batch_items i ON i.id=c.batch_item_id
     WHERE i.strap_variant_id=p_strap_variant_id AND c.status='planned'
       AND c.correlation_id<>p_correlation_id AND c.service_order_item_id IS NOT NULL)
     AND s.sent_at IS NULL;
  UPDATE public.strap_production_batch_contributions c SET status='superseded'
   FROM public.strap_production_batch_items i
   WHERE i.id=c.batch_item_id AND i.strap_variant_id=p_strap_variant_id
     AND c.status='planned' AND c.correlation_id<>p_correlation_id
     AND NOT EXISTS (SELECT 1 FROM public.service_order_items soi
       WHERE soi.id=c.service_order_item_id AND soi.sent_at IS NOT NULL);

  FOREACH v_id IN ARRAY coalesce(v_purchase_order_ids,ARRAY[]::uuid[]) LOOP
    PERFORM public.recalculate_open_strap_purchase_order(v_id);
  END LOOP;
  FOREACH v_id IN ARRAY coalesce(v_batch_item_ids,ARRAY[]::uuid[]) LOOP
    UPDATE public.strap_production_batch_items i SET
      planned_finished_m=x.total_m,planned_base_m=x.total_m/i.confirmed_yield_snapshot
    FROM (SELECT coalesce(sum(c.planned_m),0) total_m
      FROM public.strap_production_batch_contributions c
      WHERE c.batch_item_id=v_id AND c.status IN ('planned','in_progress','partial')) x
    WHERE i.id=v_id;
    PERFORM public.schedule_strap_batch_item(v_id,p_reason,p_correlation_id);
  END LOOP;

  PERFORM public.materialize_strap_purchase_orders(500,p_correlation_id);
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES ('strap_variant',p_strap_variant_id,'reconcile',v_before,
    jsonb_build_object('demand_count',v_count,'finished_available_after',v_available),
    p_reason,p_correlation_id,auth.uid());
  RETURN jsonb_build_object('strap_variant_id',p_strap_variant_id,
    'demand_count',v_count,'finished_available_after',v_available,
    'floor_required_m',v_floor_total,'floor_remaining_m',v_floor_needed,
    'correlation_id',p_correlation_id);
END;
$$;

-- Contrato executavel Req76: nos dois ramos (PV e piso) a napa fisica e
-- reservada antes de consultar/alocar inbound. Evita que uma refatoracao volte
-- a deixar estoque presente livre enquanto uma compra futura cobre a demanda.
DO $$
DECLARE v_def text; v_reserved_count integer; v_inbound_count integer;
  v_suspended_inbound_clamps integer; v_active_inbound_clamps integer;
  v_finished_stock_first integer; v_floor_inbound_clamps integer;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_strap_variant_local_202701(uuid,uuid,text)'::regprocedure)
    INTO v_def;
  SELECT count(*) INTO v_reserved_count FROM regexp_matches(v_def,
    'v_base_reserved\s*:=\s*least\(v_base_factory_need\s*,\s*v_base_available\)', 'g');
  SELECT count(*) INTO v_inbound_count FROM regexp_matches(v_def,
    'v_base_inbound\s*:=\s*least\(greatest\(v_base_factory_need-v_base_reserved,0\)', 'g');
  SELECT count(*) INTO v_suspended_inbound_clamps FROM regexp_matches(v_def,
    'v_committed\s*:=\s*least\(v_remaining\s*,\s*public\.strap_committed_finished_inbound', 'g');
  SELECT count(*) INTO v_active_inbound_clamps FROM regexp_matches(v_def,
    'v_committed\s*:=\s*least\(greatest\(v_remaining-v_stock_alloc,0\)\s*,\s*public\.strap_committed_finished_inbound', 'g');
  SELECT count(*) INTO v_finished_stock_first FROM regexp_matches(v_def,
    'v_stock_alloc\s*:=\s*least\(v_remaining\s*,\s*greatest\(0\s*,\s*v_available-v_preserved_min_m\)\)', 'g');
  SELECT count(*) INTO v_floor_inbound_clamps FROM regexp_matches(v_def,
    'least\(v_floor_total\s*,\s*public\.strap_committed_finished_inbound', 'g');
  IF v_reserved_count<>2 OR v_inbound_count<>2
     OR v_suspended_inbound_clamps<>2 OR v_active_inbound_clamps<>1
     OR v_finished_stock_first<>1 OR v_floor_inbound_clamps<>1
     OR v_def~'v_base_reserved\s*:=\s*least\(greatest\(v_base_factory_need-v_base_inbound' THEN
    RAISE EXCEPTION 'Regressao Req76/MOQ: fisico -> inbound -> falta e sobra nunca atribuida alem do saldo';
  END IF;
END;
$$;

-- Contrato executavel Req25/Req118: status administrativo bloqueia tudo novo;
-- indisponibilidade de base/cor/receita bloqueia somente a fonte interna.
DO $$
DECLARE
  v_local text;
  v_preview text;
  v_admin_branch text;
  v_cleanup_branch text;
  v_source_resume_count integer;
  v_sent_guard_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.reconcile_strap_variant_local_202701(uuid,uuid,text)'::regprocedure
  ) INTO v_local;
  SELECT pg_get_functiondef(
    'public.preview_sale_order_strap_demand_draft(jsonb)'::regprocedure
  ) INTO v_preview;
  v_admin_branch := split_part(split_part(v_local,
    'IF v_variant.status <> ''active'' THEN',2),
    '-- Reconstroi as alocacoes reversiveis',1);
  v_cleanup_branch := split_part(split_part(v_local,
    '-- Remove somente contribuicoes automaticas reversiveis',2),
    'FOREACH v_id IN ARRAY coalesce(v_purchase_order_ids',1);
  SELECT count(*) INTO v_source_resume_count FROM regexp_matches(v_local,
    'status=coalesce\(suspended_from_status,''pending''\)', 'g');
  SELECT count(*) INTO v_sent_guard_count FROM regexp_matches(v_local,
    'soi\.sent_at IS NOT NULL', 'g');
  IF v_local !~ 'resolve_artisanal_strap_source_availability'
     OR v_local !~ 'v_variant\.status <> ''active'''
     OR v_local !~ 'v_demand\.source_mode = ''internal'' AND v_internal_allowed'
     OR v_local !~ 'v_demand\.source_mode = ''buy_ready'' AND v_buy_allowed'
     OR v_local !~ 'v_available-v_preserved_min_m'
     OR v_local !~ 'ELSE 0 END;'
     OR v_local !~ 'min_stock_replenishment_mode=''internal'' AND NOT v_internal_allowed'
     OR v_local !~ 'min_stock_replenishment_mode=''buy_ready'' AND NOT v_buy_allowed'
     OR v_local !~ 'c\.status IN \(''approved'',''sent'',''partial'',''received''\)'
     OR v_local !~ 'c\.status IN \(''in_progress'',''partial'',''fulfilled''\)'
     OR v_source_resume_count <> 2
     OR v_local !~ 'v_demand\.suspension_reason LIKE ''Variante fora do estado ativo:%'''
     OR v_local !~ 'v_floor\.suspension_reason LIKE ''Variante fora do estado ativo:%'''
     OR v_local !~ 'Producao interna indisponivel:'
     OR v_local !~ 'Compra pronta indisponivel:'
     OR v_sent_guard_count < 5
     OR v_admin_branch !~ 'UPDATE public\.strap_production_batch_contributions'
     OR v_admin_branch !~ 'soi\.sent_at IS NOT NULL'
     OR v_cleanup_branch !~ 'UPDATE public\.strap_production_batch_contributions'
     OR v_cleanup_branch !~ 'soi\.sent_at IS NOT NULL' THEN
    RAISE EXCEPTION 'Regressao Req25/Req118: gates por fonte ou preservacao de compromisso ausentes';
  END IF;
  IF v_preview ~ 'canonical_colors c WHERE c\.id = v_color_id AND c\.active' THEN
    RAISE EXCEPTION 'Req25: cor descontinuada nao pode apagar o UUID exato usado por saldo/compra pronta';
  END IF;
END;
$$;

-- Resolve o componente bipartido variante <-> produto-base por FKs correntes.
-- A funcao e chamada antes e depois da espera pelos locks: cada chamada e uma
-- nova instrucao READ COMMITTED e, portanto, enxerga o commit que acabou de
-- liberar o lock sem usar arrays descobertos num snapshot antigo.
CREATE OR REPLACE FUNCTION public.resolve_strap_netting_component(
  p_strap_variant_id uuid
)
RETURNS TABLE(base_product_ids uuid[], strap_variant_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_ids uuid[]:=ARRAY[]::uuid[];
  v_new_base_ids uuid[]:=ARRAY[]::uuid[];
  v_variant_ids uuid[]:=ARRAY[p_strap_variant_id];
  v_new_variant_ids uuid[]:=ARRAY[p_strap_variant_id];
BEGIN
  IF p_strap_variant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.artisanal_strap_variants v WHERE v.id=p_strap_variant_id
  ) THEN
    RAISE EXCEPTION 'Variante de netting inexistente';
  END IF;

  LOOP
    SELECT coalesce(array_agg(q.id ORDER BY q.id),ARRAY[]::uuid[])
      INTO v_new_base_ids
      FROM (
        SELECT DISTINCT d.base_product_id AS id
          FROM public.sale_order_strap_demands d
         WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
           AND d.base_product_id IS NOT NULL
           AND d.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT DISTINCT f.base_product_id
          FROM public.strap_stock_floor_contributions f
         WHERE f.strap_variant_id=ANY(v_variant_ids) AND f.is_current
           AND f.base_product_id IS NOT NULL
           AND f.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT DISTINCT op.official_product_id
          FROM public.artisanal_strap_variants v
          JOIN public.base_material_color_official_products op
            ON op.base_group_id=v.base_group_id AND op.color_id=v.color_id
           AND op.status='active'
         WHERE v.id=ANY(v_variant_ids)
           AND v.min_stock_replenishment_mode='internal'
      ) q WHERE q.id IS NOT NULL;

    SELECT coalesce(array_agg(q.id ORDER BY q.id),ARRAY[p_strap_variant_id])
      INTO v_new_variant_ids
      FROM (
        SELECT unnest(v_variant_ids) AS id
        UNION
        SELECT DISTINCT d.strap_variant_id
          FROM public.sale_order_strap_demands d
         WHERE d.is_current AND d.base_product_id=ANY(v_new_base_ids)
           AND d.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT DISTINCT f.strap_variant_id
          FROM public.strap_stock_floor_contributions f
         WHERE f.is_current AND f.base_product_id=ANY(v_new_base_ids)
           AND f.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT DISTINCT v.id
          FROM public.artisanal_strap_variants v
          JOIN public.base_material_color_official_products op
            ON op.base_group_id=v.base_group_id AND op.color_id=v.color_id
           AND op.status='active'
         WHERE op.official_product_id=ANY(v_new_base_ids)
           AND v.min_stock_replenishment_mode='internal'
      ) q WHERE q.id IS NOT NULL;

    EXIT WHEN v_new_base_ids=v_base_ids AND v_new_variant_ids=v_variant_ids;
    v_base_ids:=v_new_base_ids;
    v_variant_ids:=v_new_variant_ids;
  END LOOP;

  base_product_ids:=v_base_ids;
  strap_variant_ids:=v_variant_ids;
  RETURN NEXT;
END;
$$;

-- Orquestrador global por napa. A rotina local continua dona do netting da
-- tira acabada e da criacao estrutural de lote/contribuicao; esta camada
-- neutraliza todas as promessas reversiveis que disputam a mesma base e
-- redistribui napa fisica + inbound pela fila required_at/confirmed_at/id.
CREATE OR REPLACE FUNCTION public.reconcile_strap_variant(
  p_strap_variant_id uuid,
  p_correlation_id uuid DEFAULT gen_random_uuid(),
  p_reason text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_ids uuid[]:=ARRAY[]::uuid[];
  v_new_base_ids uuid[]:=ARRAY[]::uuid[];
  v_locked_base_ids uuid[]:=ARRAY[]::uuid[];
  v_missing_base_ids uuid[]:=ARRAY[]::uuid[];
  v_variant_ids uuid[]:=ARRAY[p_strap_variant_id];
  v_new_variant_ids uuid[]:=ARRAY[p_strap_variant_id];
  v_lock_ceiling uuid;
  v_base_id uuid;
  v_variant_id uuid;
  v_current_base uuid;
  v_work record;
  v_result jsonb;
  v_requested_result jsonb:='{}'::jsonb;
  v_available numeric:=0;
  v_custody numeric:=0;
  v_need numeric:=0;
  v_existing_reserved numeric:=0;
  v_existing_coverage numeric:=0;
  v_new_reserved numeric:=0;
  v_inbound numeric:=0;
  v_shortage numeric:=0;
  v_batch_item_id uuid;
  v_batch_item_count integer;
  v_purchase_order_id uuid;
  v_purchase_order_ids uuid[]:=ARRAY[]::uuid[];
  v_id uuid;
BEGIN
  IF p_strap_variant_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'variant_id e correlation_id obrigatorios';
  END IF;
  IF auth.role()<>'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  PERFORM set_config('app.strap_engine_write','1',true);

  -- Descoberta inicial escolhe somente quais locks tentar. Depois de qualquer
  -- espera, o componente e obrigatoriamente refeito em novo snapshot. Assim a
  -- transacao que esperou enxerga demandas concorrentes ja commitadas.
  SELECT c.base_product_ids,c.strap_variant_ids
    INTO v_base_ids,v_variant_ids
    FROM public.resolve_strap_netting_component(p_strap_variant_id) c;

  FOR v_base_id IN SELECT unnest(v_base_ids) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('strap-base-netting:'||v_base_id::text,0));
  END LOOP;
  v_locked_base_ids:=v_base_ids;

  LOOP
    SELECT c.base_product_ids,c.strap_variant_ids
      INTO v_new_base_ids,v_new_variant_ids
      FROM public.resolve_strap_netting_component(p_strap_variant_id) c;
    SELECT coalesce(array_agg(u.id ORDER BY u.id),ARRAY[]::uuid[])
      INTO v_missing_base_ids
      FROM unnest(v_new_base_ids) AS u(id)
     WHERE NOT (u.id=ANY(v_locked_base_ids));

    IF cardinality(v_missing_base_ids)=0 THEN
      v_base_ids:=v_new_base_ids;
      v_variant_ids:=v_new_variant_ids;
      EXIT;
    END IF;

    SELECT max(u.id) INTO v_lock_ceiling
      FROM unnest(v_locked_base_ids) AS u(id);
    IF v_lock_ceiling IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(v_missing_base_ids) AS u(id)
       WHERE u.id<v_lock_ceiling
    ) THEN
      RAISE EXCEPTION 'Componente de napa expandiu abaixo da ordem de locks; retry obrigatorio'
        USING ERRCODE='40001';
    END IF;

    -- Expansao somente acima do maior lock ja obtido preserva a ordem global.
    -- Qualquer expansao para UUID menor aborta/retry em vez de formar ciclo.
    FOR v_base_id IN SELECT u.id FROM unnest(v_missing_base_ids) AS u(id) ORDER BY u.id LOOP
      PERFORM pg_advisory_xact_lock(
        hashtextextended('strap-base-netting:'||v_base_id::text,0));
    END LOOP;
    SELECT array_agg(q.id ORDER BY q.id) INTO v_locked_base_ids
      FROM (SELECT DISTINCT u.id
        FROM unnest(v_locked_base_ids||v_missing_base_ids) AS u(id)) q;
  END LOOP;

  PERFORM 1 FROM public.products p
   WHERE p.id=ANY(v_base_ids) ORDER BY p.id FOR UPDATE;

  -- Antes de qualquer local, libera a cobertura reversivel de TODO o
  -- componente. Assim o primeiro local nao herda a reserva tardia de outro
  -- job/medida. Fatos consumidos ou com lote iniciado ficam intocados.
  UPDATE public.material_reservations r SET
    status='cancelled',
    notes=coalesce(r.notes,'')||' | realocada por netting global '
      ||p_correlation_id::text,
    correlation_id=p_correlation_id,updated_at=now()
  WHERE r.source='strap_engine_base'
    AND r.strap_variant_id=ANY(v_variant_ids)
    AND r.product_id=ANY(v_base_ids)
    AND r.status='reserved' AND coalesce(r.quantity_consumed,0)=0
    AND NOT EXISTS (
      SELECT 1 FROM public.strap_production_batch_items bi
      JOIN public.strap_production_batches b ON b.id=bi.batch_id
      WHERE bi.id=r.strap_batch_item_id
        AND (bi.started_at IS NOT NULL OR b.started_at IS NOT NULL
          OR bi.status IN ('in_progress','partial')
          OR b.status IN ('in_progress','partial'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.strap_production_batch_contributions c
      JOIN public.service_order_items soi ON soi.id=c.service_order_item_id
      WHERE c.batch_item_id=r.strap_batch_item_id AND soi.sent_at IS NOT NULL
    );
  UPDATE public.sale_order_strap_demands d SET
    base_reserved_m=0,base_inbound_allocated_m=0
  WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
    AND d.source_mode='internal'
    AND d.status NOT IN ('fulfilled','superseded','cancelled','error','suspended');
  UPDATE public.strap_stock_floor_contributions f SET
    base_reserved_m=0,base_inbound_allocated_m=0
  WHERE f.strap_variant_id=ANY(v_variant_ids) AND f.is_current
    AND f.source_mode='internal'
    AND f.status NOT IN ('fulfilled','superseded','cancelled','error','suspended');

  -- A rotina local cria/atualiza as estruturas e calcula base_required_m. Sua
  -- ordem nao decide a napa: a alocacao provisoria e neutralizada logo abaixo.
  FOR v_variant_id IN SELECT unnest(v_variant_ids) ORDER BY 1 LOOP
    v_result:=public.reconcile_strap_variant_local_202701(
      v_variant_id,p_correlation_id,p_reason||':local');
    IF v_variant_id=p_strap_variant_id THEN v_requested_result:=v_result; END IF;
  END LOOP;

  UPDATE public.material_reservations r SET
    status='cancelled',
    notes=coalesce(r.notes,'')||' | substituida pela fila global '
      ||p_correlation_id::text,
    correlation_id=p_correlation_id,updated_at=now()
  WHERE r.source='strap_engine_base'
    AND r.strap_variant_id=ANY(v_variant_ids)
    AND r.product_id=ANY(v_base_ids)
    AND r.status='reserved' AND coalesce(r.quantity_consumed,0)=0
    AND NOT EXISTS (
      SELECT 1 FROM public.strap_production_batch_items bi
      JOIN public.strap_production_batches b ON b.id=bi.batch_id
      WHERE bi.id=r.strap_batch_item_id
        AND (bi.started_at IS NOT NULL OR b.started_at IS NOT NULL
          OR bi.status IN ('in_progress','partial')
          OR b.status IN ('in_progress','partial'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.strap_production_batch_contributions c
      JOIN public.service_order_items soi ON soi.id=c.service_order_item_id
      WHERE c.batch_item_id=r.strap_batch_item_id AND soi.sent_at IS NOT NULL
    );
  UPDATE public.sale_order_strap_demands d SET
    base_reserved_m=0,base_inbound_allocated_m=0
  FROM public.artisanal_strap_variants v
  WHERE v.id=d.strap_variant_id AND v.status='active'
    AND d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
    AND d.source_mode='internal'
    AND d.status NOT IN ('fulfilled','superseded','cancelled','error','suspended');
  UPDATE public.strap_stock_floor_contributions f SET
    base_reserved_m=0,base_inbound_allocated_m=0
  FROM public.artisanal_strap_variants v
  WHERE v.id=f.strap_variant_id AND v.status='active'
    AND f.strap_variant_id=ANY(v_variant_ids) AND f.is_current
    AND f.source_mode='internal'
    AND f.status NOT IN ('fulfilled','superseded','cancelled','error','suspended');

  FOR v_work IN
    WITH work AS (
      SELECT 'demand'::text AS entity_type,d.id AS entity_id,
        d.strap_variant_id,d.base_product_id,d.base_required_m,
        d.required_at AS priority_at,d.confirmed_at,
        coalesce(d.base_required_at,d.strap_start,d.required_at) AS needed_at,
        d.billing_anchor,d.billing_year,d.billing_month,d.billing_fortnight
      FROM public.sale_order_strap_demands d
      JOIN public.artisanal_strap_variants v ON v.id=d.strap_variant_id
      WHERE d.strap_variant_id=ANY(v_variant_ids) AND d.is_current
        AND v.status='active' AND d.source_mode='internal'
        AND d.base_product_id=ANY(v_base_ids)
        AND d.status NOT IN ('fulfilled','superseded','cancelled','error','suspended')
      UNION ALL
      SELECT 'floor',f.id,f.strap_variant_id,f.base_product_id,f.base_required_m,
        f.needed_at,f.created_at,f.needed_at,f.billing_anchor,
        f.billing_year,f.billing_month,f.billing_fortnight
      FROM public.strap_stock_floor_contributions f
      JOIN public.artisanal_strap_variants v ON v.id=f.strap_variant_id
      WHERE f.strap_variant_id=ANY(v_variant_ids) AND f.is_current
        AND v.status='active' AND f.source_mode='internal'
        AND f.base_product_id=ANY(v_base_ids)
        AND f.status NOT IN ('fulfilled','superseded','cancelled','error','suspended')
    )
    SELECT work.* FROM work
    ORDER BY work.base_product_id,work.priority_at,work.confirmed_at,work.entity_id
  LOOP
    IF v_current_base IS DISTINCT FROM v_work.base_product_id THEN
      v_current_base:=v_work.base_product_id;
      v_available:=public.strap_base_available_now(v_current_base);
    END IF;

    IF v_work.entity_type='demand' THEN
      SELECT coalesce(sum(cb.balance_in_custody),0) INTO v_custody
        FROM public.v_contractor_material_custody_balances cb
        JOIN public.service_order_items soi ON soi.id=cb.service_order_item_id
       WHERE soi.sale_order_strap_demand_id=v_work.entity_id
         AND cb.base_product_id=v_work.base_product_id
         AND cb.balance_in_custody>0;
      SELECT count(DISTINCT c.batch_item_id),
             (array_agg(DISTINCT c.batch_item_id ORDER BY c.batch_item_id))[1]
        INTO v_batch_item_count,v_batch_item_id
        FROM public.strap_production_batch_contributions c
       WHERE c.sale_order_strap_demand_id=v_work.entity_id
         AND c.status IN ('planned','in_progress','partial');
      SELECT coalesce(sum(greatest(r.quantity_reserved-r.quantity_consumed,0)),0)
        INTO v_existing_reserved
        FROM public.material_reservations r
       WHERE r.sale_order_strap_demand_id=v_work.entity_id
         AND r.product_id=v_work.base_product_id
         AND r.source='strap_engine_base'
         AND r.status IN ('reserved','partially_consumed');
    ELSE
      SELECT coalesce(sum(cb.balance_in_custody),0) INTO v_custody
        FROM public.v_contractor_material_custody_balances cb
        JOIN public.service_order_items soi ON soi.id=cb.service_order_item_id
       WHERE soi.strap_stock_floor_contribution_id=v_work.entity_id
         AND cb.base_product_id=v_work.base_product_id
         AND cb.balance_in_custody>0;
      SELECT count(DISTINCT c.batch_item_id),
             (array_agg(DISTINCT c.batch_item_id ORDER BY c.batch_item_id))[1]
        INTO v_batch_item_count,v_batch_item_id
        FROM public.strap_production_batch_contributions c
       WHERE c.stock_floor_contribution_id=v_work.entity_id
         AND c.status IN ('planned','in_progress','partial');
      SELECT coalesce(sum(greatest(r.quantity_reserved-r.quantity_consumed,0)),0)
        INTO v_existing_reserved
        FROM public.material_reservations r
       WHERE r.strap_stock_floor_contribution_id=v_work.entity_id
         AND r.product_id=v_work.base_product_id
         AND r.source='strap_engine_base'
         AND r.status IN ('reserved','partially_consumed');
    END IF;

    v_need:=greatest(coalesce(v_work.base_required_m,0)-coalesce(v_custody,0),0);
    v_existing_reserved:=coalesce(v_existing_reserved,0);
    v_existing_coverage:=least(v_need,v_existing_reserved);
    v_new_reserved:=least(greatest(v_need-v_existing_coverage,0),v_available);
    v_available:=greatest(0,v_available-v_new_reserved);
    IF v_need>v_existing_coverage AND coalesce(v_batch_item_count,0)<>1 THEN
      RAISE EXCEPTION 'Origem % sem batch_item estrutural unico para netting global',
        v_work.entity_id;
    END IF;
    IF v_new_reserved>0 THEN
      INSERT INTO public.material_reservations(
        order_id,product_id,quantity_reserved,quantity_consumed,status,
        reservation_type,source,notes,metadata,strap_variant_id,
        sale_order_strap_demand_id,strap_stock_floor_contribution_id,
        strap_batch_item_id,base_product_id,correlation_id
      ) VALUES (
        NULL,v_work.base_product_id,v_new_reserved,0,'reserved','soft',
        'strap_engine_base','Reserva global priorizada de napa',
        jsonb_build_object('consumption_sector','Tiras artesanais',
          'coverage_mode','pre_netted','global_base_netting',true),
        v_work.strap_variant_id,
        CASE WHEN v_work.entity_type='demand' THEN v_work.entity_id ELSE NULL END,
        CASE WHEN v_work.entity_type='floor' THEN v_work.entity_id ELSE NULL END,
        v_batch_item_id,v_work.base_product_id,p_correlation_id
      );
    END IF;

    IF v_work.entity_type='demand' THEN
      v_inbound:=least(greatest(v_need-v_existing_coverage-v_new_reserved,0),
        public.strap_committed_purchase_inbound(
          v_work.base_product_id,v_work.entity_id,NULL,v_work.needed_at));
    ELSE
      v_inbound:=least(greatest(v_need-v_existing_coverage-v_new_reserved,0),
        public.strap_committed_purchase_inbound(
          v_work.base_product_id,NULL,v_work.entity_id,v_work.needed_at));
    END IF;
    v_shortage:=greatest(0,
      v_need-v_existing_coverage-v_new_reserved-v_inbound);

    SELECT (array_agg(c.purchase_order_id ORDER BY c.id))[1]
      INTO v_purchase_order_id
      FROM public.purchase_demand_contributions c
     WHERE c.purchase_product_id=v_work.base_product_id
       AND c.status IN ('proposed','awaiting_approval','suspended')
       AND ((v_work.entity_type='demand'
          AND c.sale_order_strap_demand_id=v_work.entity_id)
         OR (v_work.entity_type='floor'
          AND c.strap_stock_floor_contribution_id=v_work.entity_id));
    IF v_purchase_order_id IS NOT NULL THEN
      v_purchase_order_ids:=array_append(v_purchase_order_ids,v_purchase_order_id);
    END IF;

    PERFORM public.upsert_strap_purchase_contribution(
      CASE WHEN v_work.entity_type='demand' THEN v_work.entity_id ELSE NULL END,
      CASE WHEN v_work.entity_type='floor' THEN v_work.entity_id ELSE NULL END,
      v_work.base_product_id,v_shortage,v_work.needed_at,
      v_work.billing_anchor,v_work.billing_year,v_work.billing_month,
      v_work.billing_fortnight,p_correlation_id);

    IF v_work.entity_type='demand' THEN
      UPDATE public.sale_order_strap_demands d SET
        base_reserved_m=v_existing_reserved+v_new_reserved,
        base_inbound_allocated_m=v_inbound,base_shortage_m=v_shortage,
        purchase_product_id=CASE WHEN v_shortage>0 THEN v_work.base_product_id ELSE NULL END,
        purchase_shortage_stock_unit=v_shortage,
        base_purchase_by=CASE WHEN v_shortage>0 THEN v_work.needed_at
          - coalesce((SELECT p.material_preparation_days FROM public.products p
             WHERE p.id=v_work.base_product_id),2)
          - coalesce((SELECT CASE WHEN coalesce(s.lead_time_days,0)>0
                THEN s.lead_time_days ELSE 15 END
              FROM public.products p LEFT JOIN public.suppliers s ON s.id=p.supplier_id
             WHERE p.id=v_work.base_product_id),15) ELSE NULL END,
        calculation_explanation=coalesce(d.calculation_explanation,'{}'::jsonb)
          ||jsonb_build_object('global_base_netting',jsonb_build_object(
            'priority_at',v_work.priority_at,'confirmed_at',v_work.confirmed_at,
            'base_product_id',v_work.base_product_id,'custody_m',v_custody,
            'existing_irreversible_reserved_m',v_existing_reserved,
            'new_reserved_m',v_new_reserved,'inbound_m',v_inbound,
            'shortage_m',v_shortage)),
        correlation_id=p_correlation_id
      WHERE d.id=v_work.entity_id;
    ELSE
      UPDATE public.strap_stock_floor_contributions f SET
        base_reserved_m=v_existing_reserved+v_new_reserved,
        base_inbound_allocated_m=v_inbound,base_shortage_m=v_shortage,
        purchase_product_id=CASE WHEN v_shortage>0 THEN v_work.base_product_id ELSE NULL END,
        purchase_shortage_stock_unit=v_shortage,correlation_id=p_correlation_id
      WHERE f.id=v_work.entity_id;
    END IF;
  END LOOP;

  FOR v_id IN SELECT DISTINCT unnest(v_purchase_order_ids) ORDER BY 1 LOOP
    PERFORM public.recalculate_open_strap_purchase_order(v_id);
  END LOOP;
  PERFORM public.materialize_strap_purchase_orders(500,p_correlation_id);
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES ('strap_variant',p_strap_variant_id,'reconcile',NULL,
    jsonb_build_object('global_base_netting',true,
      'base_product_ids',to_jsonb(v_base_ids),'variant_ids',to_jsonb(v_variant_ids)),
    p_reason,p_correlation_id,auth.uid());
  RETURN coalesce(v_requested_result,'{}'::jsonb)||jsonb_build_object(
    'global_base_netting',true,'global_base_product_ids',to_jsonb(v_base_ids),
    'global_variant_ids',to_jsonb(v_variant_ids),'correlation_id',p_correlation_id);
END;
$$;

-- Contrato executavel: todos os competidores sao neutralizados antes da fila
-- global e a ordem nao depende da sequencia dos jobs (B tardio -> A cedo gera
-- o mesmo resultado que A cedo -> B tardio).
DO $$
DECLARE v_def text; v_after_initial_locks text;
  v_sent_reservation_guards integer; v_component_refreshes integer;
BEGIN
  SELECT pg_get_functiondef('public.reconcile_strap_variant(uuid,uuid,text)'::regprocedure)
    INTO v_def;
  SELECT count(*) INTO v_sent_reservation_guards FROM regexp_matches(v_def,
    'soi\.sent_at IS NOT NULL', 'g');
  SELECT count(*) INTO v_component_refreshes FROM regexp_matches(v_def,
    'resolve_strap_netting_component', 'g');
  v_after_initial_locks:=split_part(v_def,'v_locked_base_ids:=v_base_ids;',2);
  IF v_def !~ 'strap-base-netting:'
     OR v_def !~ 'reconcile_strap_variant_local_202701'
     OR v_def !~ 'ORDER BY work\.base_product_id,work\.priority_at,work\.confirmed_at,work\.entity_id'
     OR v_def !~ 'r\.status=''reserved'' AND coalesce\(r\.quantity_consumed,0\)=0'
     OR v_def !~ 'v_existing_coverage:=least\(v_need,v_existing_reserved\)'
     OR v_component_refreshes <> 2
     OR v_after_initial_locks !~ 'resolve_strap_netting_component'
     OR v_def !~ 'u\.id<v_lock_ceiling'
     OR v_def !~ 'ERRCODE=''40001'''
     OR v_sent_reservation_guards <> 2 THEN
    RAISE EXCEPTION 'Regressao: netting de napa nao e global/deterministico/fact-safe';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Worker transacional: snapshot de PV, retry/dead-letter e reconciliacao
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.process_strap_demand_job(
  p_job_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.strap_demand_jobs%ROWTYPE;
  v_line jsonb;
  v_existing public.sale_order_strap_demands%ROWTYPE;
  v_demand public.sale_order_strap_demands%ROWTYPE;
  v_week record;
  v_factory_calendar uuid;
  v_main_start date;
  v_gross numeric;
  v_variant_id uuid;
  v_recipe_id uuid;
  v_base_product_id uuid;
  v_finished_product_id uuid;
  v_source_mode text;
  v_recipe_version integer;
  v_yield numeric;
  v_line_hash text;
  v_revision integer;
  v_carry_fulfilled numeric;
  v_carry_cancelled numeric;
  v_existing_financial public.strap_financial_snapshots%ROWTYPE;
  v_affected uuid[] := ARRAY[]::uuid[];
  v_removed uuid[] := ARRAY[]::uuid[];
  v_requested_by uuid;
  v_has_commitment boolean;
  v_is_admin_identity_change boolean:=false;
  v_processed integer := 0;
  v_blocked integer := 0;
  v_cost numeric;
  v_result jsonb;
  v_variant uuid;
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  SELECT * INTO v_job FROM public.strap_demand_jobs WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job nao encontrado'; END IF;
  IF v_job.status='completed' THEN RETURN coalesce(v_job.result,'{}'::jsonb); END IF;
  IF v_job.status<>'processing' OR v_job.locked_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job nao pertence ao worker informado';
  END IF;

  BEGIN
    IF v_job.source_type <> 'sale_order' THEN
      v_variant_id := coalesce(
        nullif(v_job.payload->>'strap_variant_id','')::uuid,
        CASE WHEN v_job.source_type='strap_variant' THEN v_job.source_id ELSE NULL END
      );
      IF v_variant_id IS NOT NULL THEN
        v_result := public.reconcile_strap_variant(v_variant_id,v_job.correlation_id,v_job.event_type);
      ELSE
        v_result := jsonb_build_object('no_op',true,'reason','evento sem variante afetada');
      END IF;
    ELSIF v_job.event_type='cancelled' THEN
      SELECT coalesce(array_agg(DISTINCT d.strap_variant_id),ARRAY[]::uuid[])
        INTO v_affected FROM public.sale_order_strap_demands d
       WHERE d.sale_order_id=v_job.source_id AND d.is_current
         AND d.status NOT IN ('cancelled','superseded','fulfilled');
      UPDATE public.sale_order_strap_demands SET
        cancelled_m=greatest(0,gross_required_m-fulfilled_m),status='cancelled',
        correlation_id=v_job.correlation_id
       WHERE sale_order_id=v_job.source_id AND is_current
         AND status NOT IN ('cancelled','superseded','fulfilled');
      FOREACH v_variant IN ARRAY v_affected LOOP
        PERFORM public.reconcile_strap_variant(v_variant,v_job.correlation_id,'sale_order_cancelled');
      END LOOP;
      v_result:=jsonb_build_object('cancelled',true,'variants',to_jsonb(v_affected));
    ELSE
      BEGIN v_requested_by:=nullif(v_job.payload->>'requested_by','')::uuid;
      EXCEPTION WHEN OTHERS THEN v_requested_by:=NULL; END;
      SELECT id INTO v_factory_calendar FROM public.strap_operational_calendars
       WHERE calendar_type='factory' AND status='active' ORDER BY created_at,id LIMIT 1;

      FOR v_line IN SELECT value FROM jsonb_array_elements(v_job.payload->'lines')
      LOOP
        SELECT * INTO v_existing FROM public.sale_order_strap_demands d
         WHERE d.sale_order_item_id=(v_line->>'sale_order_item_id')::uuid
           AND d.technical_strap_line_id=(v_line->>'technical_strap_line_id')::uuid
           AND d.is_current FOR UPDATE;

        IF jsonb_array_length(coalesce(v_line->'blocking_reasons','[]'::jsonb))>0 THEN
          v_blocked:=v_blocked+1;
          IF v_existing.id IS NOT NULL THEN
            UPDATE public.sale_order_strap_demands SET suspended_from_status=status,
              status='suspended',suspension_reason=(v_line->'blocking_reasons')::text,
              suspended_at=now(),suspended_by=v_requested_by,
              correlation_id=v_job.correlation_id WHERE id=v_existing.id;
            v_affected:=array_append(v_affected,v_existing.strap_variant_id);
            CONTINUE;
          END IF;
          RAISE EXCEPTION 'Nova linha de tira invalida apos aprovacao: %',
            (v_line->'blocking_reasons')::text;
        END IF;

        v_variant_id:=(v_line->>'strap_variant_id')::uuid;
        v_source_mode:=v_line->>'source_mode';
        v_gross:=(v_line->>'gross_required_m')::numeric;
        v_recipe_id:=nullif(v_line->>'recipe_id','')::uuid;
        v_base_product_id:=nullif(v_line->>'base_product_id','')::uuid;
        v_finished_product_id:=(v_line->>'finished_product_id')::uuid;
        v_recipe_version:=nullif(v_line->'resolved'->'catalog'->>'recipe_version','')::integer;
        v_yield:=nullif(v_line->'resolved'->>'confirmed_yield_m_per_m','')::numeric;
        v_main_start:=(v_line->'resolved'->>'main_production_start')::date;
        v_is_admin_identity_change:=v_existing.id IS NOT NULL
          AND current_setting('app.strap_source_admin_override',true)='1'
          AND (v_existing.source_mode<>v_source_mode
            OR v_existing.strap_variant_id<>v_variant_id);
        SELECT * INTO v_week FROM public.get_previous_strap_open_week(v_main_start,v_factory_calendar);

        v_has_commitment:=v_existing.id IS NOT NULL AND (
          EXISTS (SELECT 1 FROM public.purchase_demand_contributions c
            WHERE c.sale_order_strap_demand_id=v_existing.id
              AND c.status IN ('approved','sent','partial','received'))
          OR EXISTS (SELECT 1 FROM public.strap_production_batch_contributions c
            JOIN public.strap_production_batch_items i ON i.id=c.batch_item_id
            JOIN public.strap_production_batches b ON b.id=i.batch_id
            WHERE c.sale_order_strap_demand_id=v_existing.id
              AND (c.status IN ('in_progress','partial','fulfilled') OR b.started_at IS NOT NULL))
          OR public.strap_demand_has_external_commitment(v_existing.id)
        );
        IF v_existing.id IS NOT NULL
           AND (v_existing.source_mode<>v_source_mode
             OR v_existing.strap_variant_id<>v_variant_id)
           AND v_has_commitment
           AND current_setting('app.strap_source_admin_override',true) IS DISTINCT FROM '1' THEN
          UPDATE public.sale_order_strap_demands SET suspended_from_status=status,
            status='suspended',suspension_reason='Origem comprometida: cancele/reconcilie o documento antes da troca',
            suspended_at=now(),suspended_by=v_requested_by,
            correlation_id=v_job.correlation_id WHERE id=v_existing.id;
          v_affected:=array_append(v_affected,v_existing.strap_variant_id);
          v_blocked:=v_blocked+1;
          CONTINUE;
        END IF;

        v_line_hash:=public.strap_payload_hash(jsonb_build_object(
          'line',v_line,'billing_anchor',v_job.payload->'billing_anchor',
          'billing_year',v_job.payload->'billing_year',
          'billing_month',v_job.payload->'billing_month',
          'billing_fortnight',v_job.payload->'billing_fortnight',
          'strap_start',v_week.window_start,'strap_deadline',v_week.window_end
        ));
        IF v_existing.id IS NOT NULL AND v_existing.payload_hash=v_line_hash THEN
          UPDATE public.sale_order_strap_demands SET correlation_id=v_job.correlation_id
           WHERE id=v_existing.id;
          v_affected:=array_append(v_affected,v_existing.strap_variant_id);
          CONTINUE;
        END IF;

        v_revision:=coalesce(v_existing.revision,0)+1;
        IF v_is_admin_identity_change THEN
          -- Fatos realizados/cancelados pertencem exclusivamente a revisao e
          -- identidade antigas. A nova identidade nasce pelo bruto completo e
          -- entra no netting global; saldo acabado liberado pode ser reservado
          -- por qualquer PV elegivel segundo a prioridade canonica. Em especial,
          -- nenhuma realizacao de V1 pode reduzir a necessidade de V2.
          v_carry_fulfilled:=0;
          v_carry_cancelled:=0;
        ELSE
          v_carry_fulfilled:=least(coalesce(v_existing.fulfilled_m,0),v_gross);
          v_carry_cancelled:=least(coalesce(v_existing.cancelled_m,0),
            greatest(0,v_gross-v_carry_fulfilled));
        END IF;
        IF v_existing.id IS NOT NULL THEN
          UPDATE public.sale_order_strap_demands SET is_current=false,status='superseded',
            correlation_id=v_job.correlation_id WHERE id=v_existing.id;
          v_affected:=array_append(v_affected,v_existing.strap_variant_id);
        END IF;
        INSERT INTO public.sale_order_strap_demands (
          sale_order_id,sale_order_item_id,technical_strap_line_id,strap_variant_id,
          recipe_id,recipe_version_snapshot,base_product_id,finished_product_id,
          source_mode,gross_required_m,fulfilled_m,cancelled_m,
          required_at,main_production_start,strap_start,
          strap_deadline,target_week,schedule_revision,billing_anchor,billing_year,
          billing_month,billing_fortnight,confirmed_yield_snapshot,identity_snapshot,
          calculation_explanation,status,revision,is_current,supersedes_demand_id,
          operation_type,idempotency_key,payload_hash,correlation_id
        ) VALUES (
          v_job.source_id,(v_line->>'sale_order_item_id')::uuid,
          (v_line->>'technical_strap_line_id')::uuid,v_variant_id,v_recipe_id,
          CASE WHEN v_source_mode='internal' THEN v_recipe_version ELSE NULL END,
          v_base_product_id,v_finished_product_id,v_source_mode,v_gross,
          v_carry_fulfilled,v_carry_cancelled,v_week.window_end,
          v_main_start,v_week.window_start,v_week.window_end,v_week.target_week,
          v_job.schedule_revision,(v_job.payload->>'billing_anchor')::date,
          (v_job.payload->>'billing_year')::integer,(v_job.payload->>'billing_month')::integer,
          (v_job.payload->>'billing_fortnight')::smallint,
          CASE WHEN v_source_mode='internal' THEN v_yield ELSE NULL END,
          jsonb_build_object('technical_strap_line_id',v_line->>'technical_strap_line_id',
            'strap_variant_id',v_variant_id,'resolved',v_line->'resolved'),
          jsonb_build_object('gross_required_m',v_gross,'loss_factor',0,
            'calendar_exception',v_week.calendar_exception)
            ||CASE WHEN v_is_admin_identity_change THEN jsonb_build_object(
              'admin_source_revision_split',jsonb_build_object(
                'previous_demand_id',v_existing.id,
                'previous_revision_fulfilled_m',coalesce(v_existing.fulfilled_m,0),
                'previous_revision_cancelled_m',coalesce(v_existing.cancelled_m,0),
                'new_identity_gross_m',v_gross,
                'inherited_fulfilled_m',0,
                'inherited_cancelled_m',0))
              ELSE '{}'::jsonb END,
          CASE WHEN v_carry_fulfilled+v_carry_cancelled>=v_gross
            THEN 'fulfilled' ELSE 'pending' END,
          v_revision,true,v_existing.id,'sale_order_strap_demand',
          format('%s:%s:%s:r%s',v_job.source_id,v_line->>'sale_order_item_id',
            v_line->>'technical_strap_line_id',v_revision),v_line_hash,v_job.correlation_id
        ) RETURNING * INTO v_demand;

        SELECT * INTO v_existing_financial
          FROM public.strap_financial_snapshots s
         WHERE s.sale_order_strap_demand_id=v_existing.id;
        IF FOUND AND v_existing.source_mode=v_source_mode
           AND v_existing.strap_variant_id=v_variant_id THEN
          -- O custo planejado pertence a confirmacao original do PV. Mudanca
          -- de agenda, quantidade ou origem nao reprecifica uma venda aprovada.
          INSERT INTO public.strap_financial_snapshots(
            sale_order_strap_demand_id,planned_unit_cost,base_unit_cost_snapshot,
            transformation_cost_per_m_snapshot,purchase_price_snapshot,composition
          ) VALUES (v_demand.id,v_existing_financial.planned_unit_cost,
            v_existing_financial.base_unit_cost_snapshot,
            v_existing_financial.transformation_cost_per_m_snapshot,
            v_existing_financial.purchase_price_snapshot,v_existing_financial.composition);
        ELSIF v_source_mode='internal' THEN
          v_cost:=nullif(v_line->'financial_snapshot'->>'planned_unit_cost','')::numeric;
          IF v_cost IS NULL OR v_cost<0 THEN
            RAISE EXCEPTION 'Snapshot financeiro interno ausente no evento de confirmacao';
          END IF;
          INSERT INTO public.strap_financial_snapshots(
            sale_order_strap_demand_id,planned_unit_cost,base_unit_cost_snapshot,
            transformation_cost_per_m_snapshot,composition
          ) VALUES (v_demand.id,v_cost,
            (v_line->'financial_snapshot'->>'base_unit_cost_snapshot')::numeric,
            (v_line->'financial_snapshot'->>'transformation_cost_per_m_snapshot')::numeric,
            jsonb_build_object('formula','base_unit_cost / confirmed_yield + transformation_cost',
              'confirmed_yield',v_yield,'snapshot_source','sale_order_confirmation'));
        ELSE
          v_cost:=nullif(v_line->'financial_snapshot'->>'planned_unit_cost','')::numeric;
          IF v_cost IS NULL OR v_cost<=0 THEN
            RAISE EXCEPTION 'Snapshot financeiro de compra pronta ausente no evento de confirmacao';
          END IF;
          INSERT INTO public.strap_financial_snapshots(
            sale_order_strap_demand_id,planned_unit_cost,purchase_price_snapshot,composition
          ) VALUES (v_demand.id,v_cost,
            (v_line->'financial_snapshot'->>'purchase_price_snapshot')::numeric,
            jsonb_build_object('formula','purchase_price / conversion_rate',
              'conversion_rate',(v_line->'financial_snapshot'->>'conversion_rate_snapshot')::numeric,
              'snapshot_source','sale_order_confirmation'));
        END IF;
        v_affected:=array_append(v_affected,v_variant_id);
        v_processed:=v_processed+1;
      END LOOP;

      -- Linhas removidas do item/PV deixam de ser demanda corrente sem apagar
      -- fatos ja executados; a oferta recebida depois fica livre no mesmo SKU.
      SELECT coalesce(array_agg(DISTINCT d.strap_variant_id),ARRAY[]::uuid[])
        INTO v_removed FROM public.sale_order_strap_demands d
       WHERE d.sale_order_id=v_job.source_id AND d.is_current
         AND d.status NOT IN ('cancelled','superseded','fulfilled')
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_job.payload->'lines') x
           WHERE (x->>'sale_order_item_id')::uuid=d.sale_order_item_id
             AND (x->>'technical_strap_line_id')::uuid=d.technical_strap_line_id);
      UPDATE public.sale_order_strap_demands d SET
        cancelled_m=greatest(0,d.gross_required_m-d.fulfilled_m),status='cancelled',
        correlation_id=v_job.correlation_id
       WHERE d.sale_order_id=v_job.source_id AND d.is_current
         AND d.status NOT IN ('cancelled','superseded','fulfilled')
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_job.payload->'lines') x
           WHERE (x->>'sale_order_item_id')::uuid=d.sale_order_item_id
             AND (x->>'technical_strap_line_id')::uuid=d.technical_strap_line_id);
      v_affected:=v_affected||v_removed;

      SELECT coalesce(array_agg(DISTINCT x),ARRAY[]::uuid[]) INTO v_affected
        FROM unnest(v_affected) x;
      FOREACH v_variant IN ARRAY v_affected LOOP
        PERFORM public.reconcile_strap_variant(v_variant,v_job.correlation_id,v_job.event_type);
      END LOOP;
      v_result:=jsonb_build_object('processed',v_processed,'blocked',v_blocked,
        'variants',to_jsonb(v_affected),'correlation_id',v_job.correlation_id);
    END IF;

    UPDATE public.strap_demand_jobs SET status='completed',result=v_result,
      completed_at=now(),locked_at=NULL,locked_by=NULL,last_error=NULL
     WHERE id=v_job.id;
    RETURN v_result;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.strap_demand_jobs SET
      status=CASE WHEN attempts>=max_attempts THEN 'dead_letter' ELSE 'retry' END,
      next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,greatest(attempts-1,0)))::integer),
      locked_at=NULL,locked_by=NULL,last_error=SQLSTATE||': '||SQLERRM,
      completed_at=CASE WHEN attempts>=max_attempts THEN now() ELSE NULL END
     WHERE id=v_job.id;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,reason,correlation_id,actor_id)
    VALUES ('strap_demand_job',v_job.id,
      CASE WHEN v_job.attempts>=v_job.max_attempts THEN 'dead_letter' ELSE 'retry' END,
      SQLSTATE||': '||SQLERRM,v_job.correlation_id,auth.uid());
    RETURN jsonb_build_object('job_id',v_job.id,'status',
      CASE WHEN v_job.attempts>=v_job.max_attempts THEN 'dead_letter' ELSE 'retry' END,
      'error',SQLSTATE||': '||SQLERRM);
  END;
END;
$$;

-- Contrato executavel Req48/89/118: os tres gates de troca consultam a
-- mesma prova estrutural de compromisso externo antes de superseder demanda.
DO $$
DECLARE
  v_helper text:=pg_get_functiondef(
    'public.strap_demand_has_external_commitment(uuid)'::regprocedure);
  v_state text:=pg_get_functiondef(
    'public.inspect_strap_source_override_state(uuid[])'::regprocedure);
  v_neutralizer text:=pg_get_functiondef(
    'public.neutralize_strap_source_override_promises(uuid[],text,uuid)'::regprocedure);
  v_trigger text:=pg_get_functiondef(
    'public.tg_version_and_guard_sale_order_item_strap_sourcing()'::regprocedure);
  v_override text:=pg_get_functiondef(
    'public.override_sale_order_item_strap_sourcing(uuid,integer,jsonb,text,uuid)'::regprocedure);
  v_worker text:=pg_get_functiondef(
    'public.process_strap_demand_job(uuid,text)'::regprocedure);
BEGIN
  IF position('soi.sale_order_strap_demand_id = p_sale_order_strap_demand_id' IN v_helper)=0
     OR position('c.sale_order_strap_demand_id = p_sale_order_strap_demand_id' IN v_helper)=0
     OR position('c.service_order_item_id = soi.id' IN v_helper)=0
     OR position('soi.sent_at IS NOT NULL' IN v_helper)=0
     OR position('contractor_material_custody_movements' IN v_helper)=0
     OR position('m.service_order_item_id = soi.id' IN v_helper)=0
     OR position('m.service_order_id = soi.service_order_id' IN v_helper)=0
     OR position('m.base_product_id = soi.base_product_id' IN v_helper)=0
     OR position('strap_production_receipts' IN v_helper)=0
     OR position('r.service_order_item_id = soi.id' IN v_helper)=0
     OR position('contractor_loss_claims' IN v_helper)=0
     OR position('cl.service_order_item_id = soi.id' IN v_helper)=0
     OR position('purchase_document_frozen_with_open_balance' IN v_state)=0
     OR position('contractor_custody_open' IN v_state)=0
     OR position('physical_reconciliation_pending' IN v_state)=0
     OR position('purchase_allocation_inconsistent' IN v_state)=0
     OR position('contractor_custody_link_inconsistent' IN v_state)=0
     OR position('preserved_realized_facts' IN v_state)=0
     OR position('finished_stock_consumption' IN v_state)=0
     OR position('contractor_production_receipt' IN v_state)=0
     OR position('contractor_loss_claim' IN v_state)=0
     OR position('quantity_reserved=coalesce(r.quantity_consumed,0)' IN v_neutralizer)=0
     OR position('status=''superseded''' IN v_neutralizer)=0
     OR position('delivered_m e receipt allocations ficam intactos' IN v_neutralizer)=0
     OR position('strap_demand_has_external_commitment(d.id)' IN v_trigger)=0
     OR position('inspect_strap_source_override_state(v_changed_demand_ids)' IN v_override)=0
     OR position('neutralize_strap_source_override_promises' IN v_override)=0
     OR position('strap_source_override_blocked' IN v_override)=0
     OR position('strap_source_override_postcondition_failed' IN v_override)=0
     OR position('released_to_free_stock_m' IN v_override)=0
     OR position('preserved_realized_facts' IN v_override)=0
     OR position('global_priority_netting' IN v_override)=0
     OR position('new_demand_state' IN v_override)=0
     OR position('coalesce(d.fulfilled_m,0)<>0' IN v_override)=0
     OR position('coalesce(d.cancelled_m,0)<>0' IN v_override)=0
     OR position('process_strap_demand_job(v_job_id,v_worker_id)' IN v_override)=0
     OR position('''override_source''' IN v_override)=0
     OR position('strap_demand_has_external_commitment(v_existing.id)' IN v_worker)=0
     OR position('app.strap_source_admin_override' IN v_worker)=0
     OR position('v_existing.strap_variant_id<>v_variant_id' IN v_worker)=0
     OR position('v_carry_fulfilled:=0' IN v_worker)=0
     OR position('v_carry_cancelled:=0' IN v_worker)=0
     OR position('v_prior_revision_settled' IN v_worker)>0
     OR position('admin_source_revision_split' IN v_worker)=0
     OR position('new_identity_gross_m' IN v_worker)=0
     OR position('inherited_fulfilled_m' IN v_worker)=0
     OR position('inherited_cancelled_m' IN v_worker)=0
     OR position('v_existing.strap_variant_id=v_variant_id' IN v_worker)=0
     OR position('strap_demand_has_external_commitment(v_existing.id)' IN v_worker)
        >= position('is_current=false,status=''superseded''' IN v_worker) THEN
    RAISE EXCEPTION 'Req48/117/118: override nao preserva fatos nem neutraliza promessas atomicamente';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_next_strap_demand_job(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_job public.strap_demand_jobs%ROWTYPE;
BEGIN
  v_job:=public.claim_next_strap_demand_job(p_worker_id);
  IF v_job.id IS NULL THEN RETURN jsonb_build_object('claimed',false); END IF;
  RETURN public.process_strap_demand_job(v_job.id,p_worker_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.drain_strap_demand_jobs(
  p_limit integer DEFAULT 50,
  p_worker_id text DEFAULT 'pg_cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_processed integer := 0;
  v_completed integer := 0;
  v_retry integer := 0;
BEGIN
  IF auth.role() <> 'service_role'
     AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  LOOP
    EXIT WHEN v_processed >= greatest(1, least(coalesce(p_limit,50),500));
    v_result := public.process_next_strap_demand_job(p_worker_id);
    EXIT WHEN NOT coalesce((v_result ->> 'claimed')::boolean, true);
    v_processed := v_processed + 1;
    IF v_result ->> 'status' = 'retry' OR v_result ? 'error' THEN
      v_retry := v_retry + 1;
    ELSE
      v_completed := v_completed + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('processed',v_processed,'completed',v_completed,
    'retry',v_retry,'worker_id',p_worker_id,'finished_at',now());
END;
$$;

REVOKE ALL ON FUNCTION public.drain_strap_demand_jobs(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_strap_demand_jobs(integer, text) TO service_role;

DO $$
DECLARE v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'artisanal-strap-demand-worker';
    IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
    PERFORM cron.schedule(
      'artisanal-strap-demand-worker',
      '* * * * *',
      $cron$SELECT public.drain_strap_demand_jobs(100, 'pg_cron');$cron$
    );
  ELSE
    RAISE WARNING 'pg_cron ausente: configure dispatcher externo para drain_strap_demand_jobs';
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
  RAISE WARNING 'Nao foi possivel instalar cron de tiras; configure dispatcher externo: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_strap_demand_job(p_job_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  UPDATE public.strap_demand_jobs SET status='retry',next_attempt_at=now(),
    locked_at=NULL,locked_by=NULL,last_error=NULL,
    attempts=CASE WHEN attempts>=max_attempts THEN 0 ELSE attempts END,completed_at=NULL
   WHERE id=p_job_id AND status IN ('dead_letter','retry') RETURNING id INTO p_job_id;
  IF p_job_id IS NULL THEN RAISE EXCEPTION 'Job nao elegivel para retry'; END IF;
  RETURN p_job_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Custodia da napa e calendario financeiro estruturado do terceirizado
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_contractor_payment_cycle(
  p_contractor_id uuid,
  p_accrual_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.contractor_payment_schedules%ROWTYPE;
  v_cycle public.contractor_payment_cycles%ROWTYPE;
  v_start date;
  v_end date;
  v_payment date;
  v_target_day integer;
  v_local_date date;
  v_latest_closed_end date;
  v_guard integer:=0;
BEGIN
  -- Duas parciais simultaneas do mesmo terceirizado nao podem tentar criar o
  -- mesmo ciclo. O lock por contractor cobre inclusive o salto para um ciclo
  -- de ajuste/versionamento diferente e preserva a decisao sobre ciclo fechado.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-contractor-payment-cycle:'||p_contractor_id::text,0));
  SELECT * INTO v_schedule FROM public.contractor_payment_schedules s
   WHERE s.contractor_id=p_contractor_id AND s.status='active'
     AND s.valid_from<=(p_accrual_at AT TIME ZONE s.timezone)::date
     AND (s.valid_to IS NULL OR s.valid_to>=(p_accrual_at AT TIME ZONE s.timezone)::date)
   ORDER BY s.version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Terceirizado sem calendario de pagamento ativo'; END IF;
  v_local_date:=(p_accrual_at AT TIME ZONE v_schedule.timezone)::date;

  LOOP
    IF v_schedule.frequency='weekly' THEN
      v_end:=v_local_date + mod(v_schedule.cutoff_iso_weekday
        - extract(isodow FROM v_local_date)::integer + 7,7);
      v_start:=v_end-6;
    ELSE
      v_target_day:=coalesce(v_schedule.cutoff_day_of_month,15);
      IF extract(day FROM v_local_date)<=v_target_day THEN
        v_start:=date_trunc('month',v_local_date)::date;
        v_end:=v_start+(v_target_day-1);
      ELSE
        v_start:=date_trunc('month',v_local_date)::date+v_target_day;
        v_end:=(date_trunc('month',v_local_date)+interval '1 month - 1 day')::date;
      END IF;
    END IF;
    SELECT * INTO v_cycle FROM public.contractor_payment_cycles c
     WHERE c.contractor_id=p_contractor_id AND c.schedule_version_id=v_schedule.id
       AND c.cycle_start=v_start AND c.cycle_end=v_end FOR UPDATE;
    EXIT WHEN FOUND AND v_cycle.status='open';
    IF NOT FOUND THEN
      SELECT max(c.cycle_end) INTO v_latest_closed_end
        FROM public.contractor_payment_cycles c
       WHERE c.contractor_id=p_contractor_id
         AND c.status IN ('closed','paid') AND c.cycle_end>=v_end;
      EXIT WHEN v_latest_closed_end IS NULL;
      v_local_date:=v_latest_closed_end+1;
    ELSE
      v_local_date:=v_end+1;
    END IF;
    SELECT * INTO v_schedule FROM public.contractor_payment_schedules s
     WHERE s.contractor_id=p_contractor_id AND s.status='active'
       AND s.valid_from<=v_local_date AND (s.valid_to IS NULL OR s.valid_to>=v_local_date)
     ORDER BY s.version DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sem calendario de pagamento vigente para ciclo de ajuste em %',v_local_date; END IF;
    v_guard:=v_guard+1;
    IF v_guard>104 THEN RAISE EXCEPTION 'Nao foi possivel achar ciclo financeiro aberto'; END IF;
  END LOOP;

  IF v_schedule.payment_offset_days IS NOT NULL THEN
    v_payment:=v_end+v_schedule.payment_offset_days;
  ELSIF v_schedule.payment_iso_weekday IS NOT NULL THEN
    v_payment:=v_end+mod(v_schedule.payment_iso_weekday
      - extract(isodow FROM v_end)::integer + 7,7);
  ELSE
    v_target_day:=least(v_schedule.payment_day_of_month,
      extract(day FROM (date_trunc('month',v_end)+interval '1 month - 1 day'))::integer);
    v_payment:=date_trunc('month',v_end)::date+(v_target_day-1);
    IF v_payment<v_end THEN
      v_target_day:=least(v_schedule.payment_day_of_month,
        extract(day FROM (date_trunc('month',v_end)+interval '2 month - 1 day'))::integer);
      v_payment:=(date_trunc('month',v_end)+interval '1 month')::date+(v_target_day-1);
    END IF;
  END IF;
  v_payment:=public.next_strap_calendar_open_day(v_schedule.bank_calendar_id,v_payment);

  IF v_cycle.id IS NULL THEN
    INSERT INTO public.contractor_payment_cycles(
      contractor_id,schedule_version_id,cycle_start,cycle_end,payment_date,status
    ) VALUES (p_contractor_id,v_schedule.id,v_start,v_end,v_payment,'open')
    RETURNING * INTO v_cycle;
  END IF;
  RETURN v_cycle.id;
END;
$$;

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.resolve_contractor_payment_cycle(uuid,timestamptz)'::regprocedure
  ) INTO v_def;
  IF v_def !~ 'pg_advisory_xact_lock'
     OR v_def !~ 'strap-contractor-payment-cycle:'
     OR v_def !~ 'FOR UPDATE' THEN
    RAISE EXCEPTION 'Regressao: criacao de ciclo financeiro nao esta serializada';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_contractor_payment_cycle(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle public.contractor_payment_cycles%ROWTYPE;
  v_schedule public.contractor_payment_schedules%ROWTYPE;
  v_contractor public.contractors%ROWTYPE;
  v_hash text;
  v_gross numeric;
  v_claims numeric;
  v_carry_in numeric;
  v_discount numeric;
  v_carry_out numeric;
  v_net numeric;
  v_ap_id uuid;
  v_before jsonb;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin'])
     OR NOT public.can_see_strap_financial_values() THEN
    RAISE EXCEPTION 'Somente Administrador financeiro pode fechar ciclo';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'idempotency_key obrigatoria'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));
  SELECT * INTO v_cycle FROM public.contractor_payment_cycles WHERE id=p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ciclo nao encontrado'; END IF;
  SELECT * INTO v_schedule FROM public.contractor_payment_schedules
   WHERE id=v_cycle.schedule_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot do calendario de pagamento nao encontrado'; END IF;
  v_before:=to_jsonb(v_cycle);
  v_hash:=public.strap_payload_hash(jsonb_build_object('cycle_id',p_cycle_id,
    'cycle_start',v_cycle.cycle_start,'cycle_end',v_cycle.cycle_end,
    'schedule_version_id',v_cycle.schedule_version_id));
  IF v_cycle.status IN ('closed','paid') THEN
    IF v_cycle.operation_type='contractor_cycle_close'
       AND v_cycle.idempotency_key=p_idempotency_key AND v_cycle.payload_hash=v_hash THEN
      RETURN jsonb_build_object('cycle_id',v_cycle.id,'replayed',true,
        'accounts_payable_id',v_cycle.accounts_payable_id,'gross_amount',v_cycle.gross_amount,
        'discount_amount',v_cycle.discount_amount,'net_amount',v_cycle.net_amount,
        'carried_credit_out',v_cycle.carried_credit_out);
    END IF;
    RAISE EXCEPTION 'Ciclo ja fechado com outra operacao';
  END IF;
  IF v_cycle.status<>'open' THEN RAISE EXCEPTION 'Ciclo nao esta aberto'; END IF;
  IF (clock_timestamp() AT TIME ZONE v_schedule.timezone)::date<=v_cycle.cycle_end THEN
    RAISE EXCEPTION 'Ciclo so pode ser fechado depois de % no fuso %',
      v_cycle.cycle_end,v_schedule.timezone;
  END IF;
  IF EXISTS(SELECT 1 FROM public.contractor_payment_cycles c
    WHERE c.contractor_id=v_cycle.contractor_id AND c.cycle_end<v_cycle.cycle_start
      AND c.status='open') THEN
    RAISE EXCEPTION 'Feche primeiro os ciclos anteriores do terceirizado';
  END IF;
  SELECT * INTO v_contractor FROM public.contractors WHERE id=v_cycle.contractor_id FOR UPDATE;

  SELECT coalesce(sum(a.gross_amount),0) INTO v_gross
    FROM public.contractor_accruals a
   WHERE a.payment_cycle_id=v_cycle.id AND a.status='open';
  SELECT coalesce(sum(cl.claim_amount),0) INTO v_claims
    FROM public.contractor_loss_claims cl
    JOIN public.service_orders so ON so.id=cl.service_order_id
   WHERE so.contractor_id=v_cycle.contractor_id
     AND cl.status='approved' AND cl.responsible_party='contractor'
     AND cl.applied_cycle_id IS NULL
     AND (cl.approved_at AT TIME ZONE v_schedule.timezone)::date<=v_cycle.cycle_end;
  SELECT coalesce(c.carried_credit_out,0) INTO v_carry_in
    FROM public.contractor_payment_cycles c
   WHERE c.contractor_id=v_cycle.contractor_id AND c.cycle_end<v_cycle.cycle_start
     AND c.status IN ('closed','paid')
   ORDER BY c.cycle_end DESC,c.id DESC LIMIT 1;
  v_carry_in:=coalesce(v_carry_in,0);
  v_discount:=least(v_gross,v_claims+v_carry_in);
  v_carry_out:=greatest(0,v_claims+v_carry_in-v_gross);
  v_net:=greatest(0,v_gross-v_discount);

  INSERT INTO public.contractor_payment_cycle_entries(
    payment_cycle_id,entry_type,contractor_accrual_id,amount)
  SELECT v_cycle.id,'accrual',a.id,a.gross_amount
    FROM public.contractor_accruals a
   WHERE a.payment_cycle_id=v_cycle.id AND a.status='open';
  INSERT INTO public.contractor_payment_cycle_entries(
    payment_cycle_id,entry_type,contractor_loss_claim_id,amount)
  SELECT v_cycle.id,'loss_claim',cl.id,cl.claim_amount
    FROM public.contractor_loss_claims cl
    JOIN public.service_orders so ON so.id=cl.service_order_id
   WHERE so.contractor_id=v_cycle.contractor_id
     AND cl.status='approved' AND cl.responsible_party='contractor'
     AND cl.applied_cycle_id IS NULL
     AND (cl.approved_at AT TIME ZONE v_schedule.timezone)::date<=v_cycle.cycle_end;
  IF v_carry_in>0 THEN
    INSERT INTO public.contractor_payment_cycle_entries(payment_cycle_id,entry_type,amount)
    VALUES(v_cycle.id,'credit_carry',v_carry_in);
  END IF;

  UPDATE public.contractor_accruals SET status='applied'
   WHERE payment_cycle_id=v_cycle.id AND status='open';
  UPDATE public.contractor_loss_claims cl SET status='applied',applied_cycle_id=v_cycle.id
   FROM public.service_orders so
   WHERE so.id=cl.service_order_id AND so.contractor_id=v_cycle.contractor_id
     AND cl.status='approved' AND cl.responsible_party='contractor'
     AND cl.applied_cycle_id IS NULL
     AND (cl.approved_at AT TIME ZONE v_schedule.timezone)::date<=v_cycle.cycle_end;

  IF v_net>0 THEN
    IF v_contractor.financial_supplier_id IS NULL THEN
      RAISE EXCEPTION 'Terceirizado sem beneficiario financeiro valido';
    END IF;
    INSERT INTO public.accounts_payable(
      description,supplier_id,category,due_date,amount,status,installment_number,
      total_installments,notes,reference_id,reference_type,contractor_id,
      contractor_payment_cycle_id
    ) VALUES (
      'Ciclo de tiras terceirizadas '||v_cycle.cycle_start||' a '||v_cycle.cycle_end,
      v_contractor.financial_supplier_id,'service',v_cycle.payment_date,v_net,'pending',1,1,
      'Competencias e descontos detalhados em contractor_payment_cycle_entries.',
      v_cycle.id,'contractor_payment_cycle',v_cycle.contractor_id,v_cycle.id
    ) RETURNING id INTO v_ap_id;
  END IF;

  UPDATE public.contractor_payment_cycles SET gross_amount=v_gross,
    discount_amount=v_discount,carried_credit_in=v_carry_in,carried_credit_out=v_carry_out,
    net_amount=v_net,accounts_payable_id=v_ap_id,status='closed',closed_by=auth.uid(),
    closed_at=now(),operation_type='contractor_cycle_close',
    idempotency_key=p_idempotency_key,payload_hash=v_hash
   WHERE id=v_cycle.id RETURNING * INTO v_cycle;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('contractor_payment_cycle',v_cycle.id,'close_cycle',v_before,to_jsonb(v_cycle),
    'Fechamento administrativo do ciclo de pagamento',p_correlation_id,auth.uid());
  RETURN jsonb_build_object('cycle_id',v_cycle.id,'accounts_payable_id',v_ap_id,
    'gross_amount',v_gross,'discount_amount',v_discount,'net_amount',v_net,
    'carried_credit_out',v_carry_out,'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_contractor_payment_cycle_paid(
  p_cycle_id uuid,
  p_payment_date date,
  p_payment_method text DEFAULT NULL,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle public.contractor_payment_cycles%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_effective_method text;
  v_hash text;
  v_key text;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin'])
     OR NOT public.can_see_strap_financial_values() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  SELECT * INTO v_cycle FROM public.contractor_payment_cycles WHERE id=p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ciclo nao encontrado'; END IF;
  IF p_payment_date IS NULL THEN RAISE EXCEPTION 'Data de pagamento obrigatoria'; END IF;
  SELECT coalesce(p_payment_method,ap.payment_method)
    INTO v_effective_method FROM public.accounts_payable ap
   WHERE ap.id=v_cycle.accounts_payable_id;
  v_key:='contractor-cycle-paid:'||v_cycle.id::text;
  v_hash:=public.strap_payload_hash(jsonb_build_object('cycle_id',v_cycle.id,
    'accounts_payable_id',v_cycle.accounts_payable_id,
    'payment_date',p_payment_date,'payment_method',v_effective_method));
  IF v_cycle.status='paid' THEN
    IF v_cycle.payment_idempotency_key=v_key AND v_cycle.payment_payload_hash=v_hash THEN
      RETURN jsonb_build_object('cycle_id',v_cycle.id,'replayed',true,
        'accounts_payable_id',v_cycle.accounts_payable_id);
    END IF;
    RAISE EXCEPTION 'Replay de pagamento divergente para ciclo ja pago';
  END IF;
  IF v_cycle.status<>'closed' THEN RAISE EXCEPTION 'Ciclo precisa estar fechado'; END IF;
  v_before:=to_jsonb(v_cycle);
  IF v_cycle.accounts_payable_id IS NOT NULL THEN
    UPDATE public.accounts_payable SET status='paid',amount_paid=amount,
      payment_date=p_payment_date,payment_method=v_effective_method
     WHERE id=v_cycle.accounts_payable_id;
  END IF;
  PERFORM set_config('app.strap_cycle_payment','1',true);
  UPDATE public.contractor_payment_cycles SET status='paid',paid_by=auth.uid(),paid_at=now(),
    payment_date_snapshot=p_payment_date,payment_method_snapshot=v_effective_method,
    payment_idempotency_key=v_key,payment_payload_hash=v_hash
   WHERE id=v_cycle.id RETURNING * INTO v_cycle;
  v_after:=to_jsonb(v_cycle)||jsonb_build_object('accounts_payable',
    (SELECT to_jsonb(ap) FROM public.accounts_payable ap WHERE ap.id=v_cycle.accounts_payable_id));
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('contractor_payment_cycle',v_cycle.id,'update',v_before,v_after,
    'Baixa administrativa do ciclo de pagamento',p_correlation_id,auth.uid());
  RETURN jsonb_build_object('cycle_id',v_cycle.id,'status','paid',
    'accounts_payable_id',v_cycle.accounts_payable_id);
END;
$$;

CREATE TABLE public.strap_rework_material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_item_id uuid NOT NULL REFERENCES public.service_order_items(id) ON DELETE RESTRICT,
  batch_item_id uuid NOT NULL REFERENCES public.strap_production_batch_items(id) ON DELETE RESTRICT,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  base_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  requested_m numeric(24,9) NOT NULL,
  approved_m numeric(24,9) NOT NULL DEFAULT 0,
  sent_m numeric(24,9) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  decision_reason text,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  operation_type text NOT NULL DEFAULT 'strap_rework_material_request',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strap_rework_material_request_qty_ck CHECK (
    requested_m>0 AND approved_m>=0 AND approved_m<=requested_m
    AND sent_m>=0 AND sent_m<=approved_m),
  CONSTRAINT strap_rework_material_request_status_ck CHECK (
    status IN ('pending','approved','rejected','consumed','cancelled')),
  CONSTRAINT strap_rework_material_request_reason_ck CHECK (btrim(reason)<>''),
  CONSTRAINT strap_rework_material_request_decision_ck CHECK (
    (status='pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status<>'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL
      AND nullif(btrim(decision_reason),'') IS NOT NULL)),
  CONSTRAINT strap_rework_material_request_idempotency_uq UNIQUE(operation_type,idempotency_key)
);

ALTER TABLE public.strap_rework_material_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY strap_rework_material_requests_select
  ON public.strap_rework_material_requests FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
GRANT SELECT ON public.strap_rework_material_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.strap_rework_material_requests FROM authenticated;

CREATE TRIGGER trg_touch_strap_rework_material_requests
  BEFORE UPDATE ON public.strap_rework_material_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_artisanal_strap_operational();

-- Primeiro lock comum a reconciliacao e a TODO writer fisico da linha/lote.
-- A leitura inicial descobre apenas FKs de escopo; depois do advisory o writer
-- rele FOR UPDATE. Ordem: napa global -> variante -> headers/linha -> produtos,
-- eliminando o ciclo produto <-> service_order_item.
CREATE OR REPLACE FUNCTION public.lock_strap_physical_operation_scope(
  p_service_order_item_id uuid DEFAULT NULL,
  p_batch_item_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_variant_id uuid; v_base_product_id uuid; v_batch_item_id uuid;
BEGIN
  IF num_nonnulls(p_service_order_item_id,p_batch_item_id)<>1 THEN
    RAISE EXCEPTION 'Escopo fisico exige service_order_item_id xor batch_item_id';
  END IF;
  IF p_service_order_item_id IS NOT NULL THEN
    SELECT soi.strap_variant_id,soi.base_product_id,soi.strap_batch_item_id
      INTO v_variant_id,v_base_product_id,v_batch_item_id
      FROM public.service_order_items soi WHERE soi.id=p_service_order_item_id;
  ELSE
    SELECT bi.strap_variant_id,bi.base_product_id,bi.id
      INTO v_variant_id,v_base_product_id,v_batch_item_id
      FROM public.strap_production_batch_items bi WHERE bi.id=p_batch_item_id;
  END IF;
  IF v_variant_id IS NULL OR v_base_product_id IS NULL OR v_batch_item_id IS NULL THEN
    RAISE EXCEPTION 'Escopo fisico de tira inexistente/incompleto';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-base-netting:'||v_base_product_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-variant:'||v_variant_id::text,0));
  RETURN jsonb_build_object('strap_variant_id',v_variant_id,
    'base_product_id',v_base_product_id,'batch_item_id',v_batch_item_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.strap_custody_open_value(
  p_service_order_item_id uuid,
  p_base_product_id uuid
)
RETURNS TABLE(balance_m numeric, open_value numeric, unit_cost numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ledger AS (
    SELECT coalesce(sum(CASE
      WHEN m.movement_type='sent' THEN m.quantity
      WHEN m.movement_type='adjusted' THEN m.quantity
      ELSE -m.quantity END),0)::numeric AS balance_m,
      coalesce(sum(CASE
        WHEN m.movement_type='sent' THEN m.quantity*m.base_unit_cost_snapshot
        WHEN m.movement_type='adjusted' THEN m.quantity*m.base_unit_cost_snapshot
        ELSE -(m.quantity*m.base_unit_cost_snapshot) END),0)::numeric AS open_value
    FROM public.contractor_material_custody_movements m
    WHERE m.service_order_item_id=p_service_order_item_id
      AND m.base_product_id=p_base_product_id
  )
  SELECT balance_m,open_value,
    CASE WHEN balance_m>0 THEN greatest(open_value,0)/balance_m ELSE 0 END
  FROM ledger;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_strap_service_order_completion(
  p_service_order_item_id uuid,
  p_correlation_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.service_order_items%ROWTYPE;
  v_os public.service_orders%ROWTYPE;
  v_line_before jsonb;
  v_os_before jsonb;
  v_balance numeric:=0;
  v_line_ready boolean:=false;
  v_order_ready boolean:=false;
BEGIN
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo de reconciliacao obrigatorio'; END IF;
  PERFORM set_config('app.strap_engine_write','1',true);
  SELECT * INTO v_line FROM public.service_order_items
   WHERE id=p_service_order_item_id FOR UPDATE;
  IF NOT FOUND OR v_line.strap_variant_id IS NULL THEN
    RETURN jsonb_build_object('service_order_item_id',p_service_order_item_id,'canonical',false);
  END IF;
  SELECT * INTO v_os FROM public.service_orders WHERE id=v_line.service_order_id FOR UPDATE;
  SELECT coalesce(sum(CASE WHEN m.movement_type IN ('sent','adjusted') THEN m.quantity
    ELSE -m.quantity END),0) INTO v_balance
    FROM public.contractor_material_custody_movements m
   WHERE m.service_order_item_id=v_line.id;
  v_line_ready:=coalesce(v_line.delivered_qty,0)+0.000001>=coalesce(v_line.meters,0)
    AND abs(v_balance)<=0.000001
    AND NOT EXISTS(SELECT 1 FROM public.strap_production_batch_contributions c
      WHERE c.service_order_item_id=v_line.id
        AND c.status NOT IN ('fulfilled','cancelled','superseded'))
    AND NOT EXISTS(SELECT 1 FROM public.contractor_loss_claims cl
      WHERE cl.service_order_item_id=v_line.id AND cl.status='pending')
    AND NOT EXISTS(SELECT 1 FROM public.strap_rework_material_requests rr
      WHERE rr.service_order_item_id=v_line.id AND rr.status IN ('pending','approved'));
  IF v_line_ready AND v_line.line_status NOT IN ('Entregue','Cancelado') THEN
    v_line_before:=to_jsonb(v_line);
    UPDATE public.service_order_items SET line_status='Entregue',
      delivered_at=coalesce(delivered_at,now()) WHERE id=v_line.id
      RETURNING * INTO v_line;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('service_order_item',v_line.id,'update',v_line_before,to_jsonb(v_line),
      btrim(p_reason),p_correlation_id,auth.uid());
  END IF;

  v_order_ready:=NOT EXISTS(SELECT 1 FROM public.service_order_items i
      WHERE i.service_order_id=v_os.id AND i.line_status NOT IN ('Entregue','Cancelado'))
    AND NOT EXISTS(SELECT 1 FROM public.contractor_material_custody_movements m
      WHERE m.service_order_id=v_os.id
      GROUP BY m.service_order_item_id,m.base_product_id
      HAVING abs(sum(CASE WHEN m.movement_type IN ('sent','adjusted') THEN m.quantity
        ELSE -m.quantity END))>0.000001)
    AND NOT EXISTS(SELECT 1 FROM public.contractor_loss_claims cl
      JOIN public.service_order_items i ON i.id=cl.service_order_item_id
      WHERE i.service_order_id=v_os.id AND cl.status='pending')
    AND NOT EXISTS(SELECT 1 FROM public.strap_rework_material_requests rr
      JOIN public.service_order_items i ON i.id=rr.service_order_item_id
      WHERE i.service_order_id=v_os.id AND rr.status IN ('pending','approved'));
  IF v_order_ready AND lower(btrim(coalesce(v_os.status,''))) NOT IN (
      'concluído','concluido','finalizado','received','cancelado') THEN
    v_os_before:=to_jsonb(v_os);
    UPDATE public.service_orders SET status='Concluído' WHERE id=v_os.id RETURNING * INTO v_os;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('service_order',v_os.id,'update',v_os_before,to_jsonb(v_os),
      btrim(p_reason),p_correlation_id,auth.uid());
  END IF;
  RETURN jsonb_build_object('service_order_item_id',v_line.id,
    'line_status',v_line.line_status,'custody_balance_m',v_balance,
    'service_order_id',v_os.id,'service_order_status',v_os.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.send_strap_material_to_contractor(
  p_service_order_item_id uuid,
  p_quantity_m numeric,
  p_idempotency_key text,
  p_document_number text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.service_order_items%ROWTYPE;
  v_os public.service_orders%ROWTYPE;
  v_item public.strap_production_batch_items%ROWTYPE;
  v_batch public.strap_production_batches%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_existing public.contractor_material_custody_movements%ROWTYPE;
  v_payload jsonb;
  v_hash text;
  v_reserved numeric;
  v_factory_physical numeric;
  v_planned_base numeric;
  v_sent_total numeric;
  v_extra_authorized numeric;
  v_extra_to_apply numeric;
  v_extra_take numeric;
  v_remaining numeric;
  v_take numeric;
  v_res public.material_reservations%ROWTYPE;
  v_request public.strap_rework_material_requests%ROWTYPE;
  v_id uuid; v_before jsonb; v_after jsonb;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.has_artisanal_strap_capability('execute_strap_batch') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF coalesce(p_quantity_m,0)<=0 THEN RAISE EXCEPTION 'Quantidade de remessa deve ser positiva'; END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'idempotency_key obrigatoria'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));
  v_payload:=jsonb_build_object('service_order_item_id',p_service_order_item_id,
    'quantity_m',p_quantity_m,'document_number',p_document_number,'occurred_at',p_occurred_at);
  v_hash:=public.strap_payload_hash(v_payload);
  SELECT * INTO v_existing FROM public.contractor_material_custody_movements
   WHERE operation_type='custody_send' AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash<>v_hash THEN RAISE EXCEPTION 'Replay com payload divergente'; END IF;
    RETURN jsonb_build_object('movement_id',v_existing.id,'replayed',true);
  END IF;

  PERFORM public.lock_strap_physical_operation_scope(p_service_order_item_id,NULL);
  SELECT * INTO v_line FROM public.service_order_items
   WHERE id=p_service_order_item_id FOR UPDATE;
  IF NOT FOUND OR v_line.strap_variant_id IS NULL THEN RAISE EXCEPTION 'Linha de OS de tira nao encontrada'; END IF;
  SELECT * INTO v_os FROM public.service_orders WHERE id=v_line.service_order_id FOR UPDATE;
  SELECT * INTO v_item FROM public.strap_production_batch_items
   WHERE id=v_line.strap_batch_item_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.strap_production_batches
   WHERE id=v_item.batch_id FOR UPDATE;
  IF v_line.suspended_at IS NOT NULL OR v_line.line_status='Suspensa'
     OR v_item.status='suspended' OR v_batch.status='suspended' THEN
    RAISE EXCEPTION 'Linha/lote suspenso; somente retorno, ajuste ou recebimento essencial e permitido';
  END IF;
  IF v_line.line_status IN ('Entregue','Cancelado')
     OR v_item.status IN ('completed','cancelled')
     OR v_batch.status IN ('completed','cancelled')
     OR coalesce(v_line.delivered_qty,0)+0.000001>=coalesce(v_line.meters,0)
     OR NOT EXISTS (SELECT 1 FROM public.strap_production_batch_contributions c
       WHERE c.service_order_item_id=v_line.id
         AND c.status NOT IN ('fulfilled','cancelled','superseded')) THEN
    RAISE EXCEPTION 'Linha/item/lote terminal ou producao ja atendida nao aceita nova remessa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contractor_payment_schedules s
    WHERE s.contractor_id=v_os.contractor_id AND s.status='active' AND s.valid_to IS NULL) THEN
    RAISE EXCEPTION 'Cadastre calendario de pagamento do terceirizado antes da remessa';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('strap-custody:%s:%s',p_service_order_item_id,v_line.base_product_id),0));
  SELECT * INTO v_product FROM public.products WHERE id=v_line.base_product_id FOR UPDATE;
  SELECT coalesce(sum(quantity_reserved-quantity_consumed),0) INTO v_reserved
    FROM public.material_reservations
   WHERE strap_batch_item_id=v_line.strap_batch_item_id AND product_id=v_line.base_product_id
     AND (service_order_item_id=v_line.id
       OR (v_line.sale_order_strap_demand_id IS NOT NULL
         AND sale_order_strap_demand_id=v_line.sale_order_strap_demand_id)
       OR (v_line.strap_stock_floor_contribution_id IS NOT NULL
         AND strap_stock_floor_contribution_id=v_line.strap_stock_floor_contribution_id))
     AND status IN ('reserved','partially_consumed');
  v_planned_base:=coalesce(v_line.meters,0)/nullif(v_line.confirmed_yield_snapshot,0);
  SELECT coalesce(sum(cm.quantity) FILTER (WHERE cm.movement_type='sent'),0)
    INTO v_sent_total FROM public.contractor_material_custody_movements cm
   WHERE cm.service_order_item_id=v_line.id;
  SELECT coalesce(sum(approved_m),0) INTO v_extra_authorized
    FROM public.strap_rework_material_requests
   WHERE service_order_item_id=v_line.id AND status IN ('approved','consumed');
  SELECT greatest(0,v_product.quantity-coalesce(sum(CASE
    WHEN m.movement_type='sent' THEN m.quantity WHEN m.movement_type='adjusted' THEN m.quantity
    ELSE -m.quantity END),0)) INTO v_factory_physical
    FROM public.contractor_material_custody_movements m
   WHERE m.base_product_id=v_line.base_product_id;
  IF v_sent_total+p_quantity_m>coalesce(v_planned_base,0)+v_extra_authorized+0.000001 THEN
    RAISE EXCEPTION 'Remessa acumulada (%) excede napa planejada + retrabalho autorizado (%)',
      v_sent_total+p_quantity_m,coalesce(v_planned_base,0)+v_extra_authorized;
  END IF;
  IF p_quantity_m>v_reserved OR p_quantity_m>v_factory_physical THEN
    RAISE EXCEPTION 'Remessa excede napa reservada/disponivel na fabrica (reservada %, fabrica %)',
      v_reserved,v_factory_physical;
  END IF;
  v_before:=jsonb_build_object('service_order_item_id',v_line.id,
    'custody_balance_m',coalesce((SELECT balance_in_custody
      FROM public.v_contractor_material_custody_balances
      WHERE service_order_item_id=v_line.id AND base_product_id=v_line.base_product_id),0),
    'reserved_m',v_reserved,'factory_available_m',v_factory_physical,
    'sent_total_m',v_sent_total,'planned_base_m',v_planned_base,
    'additional_authorized_m',v_extra_authorized);

  v_remaining:=p_quantity_m;
  FOR v_res IN SELECT * FROM public.material_reservations
    WHERE strap_batch_item_id=v_line.strap_batch_item_id AND product_id=v_line.base_product_id
      AND (service_order_item_id=v_line.id
        OR (v_line.sale_order_strap_demand_id IS NOT NULL
          AND sale_order_strap_demand_id=v_line.sale_order_strap_demand_id)
        OR (v_line.strap_stock_floor_contribution_id IS NOT NULL
          AND strap_stock_floor_contribution_id=v_line.strap_stock_floor_contribution_id))
      AND status IN ('reserved','partially_consumed')
    ORDER BY created_at,id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_take:=least(v_remaining,v_res.quantity_reserved-v_res.quantity_consumed);
    UPDATE public.material_reservations SET
      quantity_reserved=quantity_reserved-v_take,
      status=CASE WHEN quantity_reserved-v_take<=quantity_consumed THEN 'cancelled' ELSE status END,
      metadata=metadata||jsonb_build_object('sent_to_custody_m',
        coalesce((metadata->>'sent_to_custody_m')::numeric,0)+v_take)
     WHERE id=v_res.id;
    v_remaining:=v_remaining-v_take;
  END LOOP;

  INSERT INTO public.contractor_material_custody_movements(
    service_order_id,service_order_item_id,contractor_id,base_product_id,movement_type,
    quantity,base_unit_cost_snapshot,document_number,occurred_at,recorded_by,
    operation_type,idempotency_key,payload_hash,correlation_id
  ) VALUES (v_line.service_order_id,v_line.id,v_os.contractor_id,v_line.base_product_id,
    'sent',p_quantity_m,v_product.unit_price,p_document_number,p_occurred_at,auth.uid(),
    'custody_send',p_idempotency_key,v_hash,p_correlation_id) RETURNING id INTO v_id;
  v_extra_to_apply:=greatest(v_sent_total+p_quantity_m-coalesce(v_planned_base,0),0)
    -greatest(v_sent_total-coalesce(v_planned_base,0),0);
  FOR v_request IN SELECT * FROM public.strap_rework_material_requests
    WHERE service_order_item_id=v_line.id AND status='approved' AND sent_m<approved_m
    ORDER BY decided_at,id FOR UPDATE
  LOOP
    EXIT WHEN v_extra_to_apply<=0;
    v_extra_take:=least(v_extra_to_apply,v_request.approved_m-v_request.sent_m);
    UPDATE public.strap_rework_material_requests SET sent_m=sent_m+v_extra_take,
      status=CASE WHEN sent_m+v_extra_take>=approved_m THEN 'consumed' ELSE status END
     WHERE id=v_request.id;
    v_extra_to_apply:=v_extra_to_apply-v_extra_take;
  END LOOP;
  UPDATE public.service_order_items SET sent_at=coalesce(sent_at,p_occurred_at) WHERE id=v_line.id;
  UPDATE public.service_orders SET status='Enviado' WHERE id=v_os.id
    AND lower(btrim(status)) IN ('pendente','pending');
  v_after:=jsonb_build_object('movement_id',v_id,'quantity_m',p_quantity_m,
    'custody_balance_m',(SELECT balance_in_custody
      FROM public.v_contractor_material_custody_balances
      WHERE service_order_item_id=v_line.id AND base_product_id=v_line.base_product_id));
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('contractor_material_custody',v_id,'send',v_before,v_after,
    'Remessa de napa ao terceirizado',p_correlation_id,auth.uid());
  RETURN jsonb_build_object('movement_id',v_id,'balance_in_custody',
    (SELECT balance_in_custody FROM public.v_contractor_material_custody_balances
      WHERE service_order_item_id=v_line.id AND base_product_id=v_line.base_product_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.return_strap_material_from_contractor(
  p_service_order_item_id uuid,
  p_quantity_m numeric,
  p_idempotency_key text,
  p_document_number text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line public.service_order_items%ROWTYPE; v_os public.service_orders%ROWTYPE;
  v_balance numeric; v_cost numeric; v_payload jsonb; v_hash text; v_existing uuid; v_id uuid;
  v_before jsonb; v_after jsonb; v_jobs integer;
BEGIN
  IF NOT public.has_artisanal_strap_capability('execute_strap_batch') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF coalesce(p_quantity_m,0)<=0 THEN RAISE EXCEPTION 'Quantidade deve ser positiva'; END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'idempotency_key obrigatoria'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));
  v_payload:=jsonb_build_object('service_order_item_id',p_service_order_item_id,
    'quantity_m',p_quantity_m,'document_number',p_document_number,'occurred_at',p_occurred_at);
  v_hash:=public.strap_payload_hash(v_payload);
  SELECT id INTO v_existing FROM public.contractor_material_custody_movements
   WHERE operation_type='custody_return' AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF (SELECT payload_hash FROM public.contractor_material_custody_movements WHERE id=v_existing)<>v_hash
      THEN RAISE EXCEPTION 'Replay divergente'; END IF;
    RETURN jsonb_build_object('movement_id',v_existing,'replayed',true);
  END IF;
  PERFORM public.lock_strap_physical_operation_scope(p_service_order_item_id,NULL);
  SELECT * INTO v_line FROM public.service_order_items WHERE id=p_service_order_item_id FOR UPDATE;
  SELECT * INTO v_os FROM public.service_orders WHERE id=v_line.service_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('strap-custody:%s:%s',v_line.id,v_line.base_product_id),0));
  SELECT x.balance_m,x.unit_cost INTO v_balance,v_cost
    FROM public.strap_custody_open_value(v_line.id,v_line.base_product_id) x;
  IF p_quantity_m>v_balance THEN RAISE EXCEPTION 'Devolucao excede saldo em custodia %',v_balance; END IF;
  v_before:=jsonb_build_object('service_order_item_id',v_line.id,
    'custody_balance_m',v_balance,'return_quantity_m',p_quantity_m);
  INSERT INTO public.contractor_material_custody_movements(
    service_order_id,service_order_item_id,contractor_id,base_product_id,movement_type,
    quantity,base_unit_cost_snapshot,document_number,occurred_at,recorded_by,
    operation_type,idempotency_key,payload_hash,correlation_id
  ) VALUES (v_line.service_order_id,v_line.id,v_os.contractor_id,v_line.base_product_id,
    'returned',p_quantity_m,v_cost,p_document_number,p_occurred_at,auth.uid(),
    'custody_return',p_idempotency_key,v_hash,p_correlation_id) RETURNING id INTO v_id;
  v_after:=jsonb_build_object('movement_id',v_id,
    'custody_balance_m',v_balance-p_quantity_m,'returned_m',p_quantity_m);
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('contractor_material_custody',v_id,'receive',v_before,v_after,
    'Devolucao de napa pelo terceirizado',p_correlation_id,auth.uid());
  PERFORM public.reconcile_strap_service_order_completion(v_line.id,p_correlation_id,
    'Reconciliacao apos devolucao de napa');
  v_jobs:=public.enqueue_strap_base_availability_reconciliation(
    v_line.base_product_id,v_line.strap_variant_id,v_id,p_quantity_m,
    'Disponibilidade de napa alterada por devolucao de custodia',p_correlation_id);
  RETURN jsonb_build_object('movement_id',v_id,'balance_in_custody',v_balance-p_quantity_m,
    'reconciliation_jobs',v_jobs,'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_strap_contractor_custody(
  p_service_order_item_id uuid,
  p_quantity_delta_m numeric,
  p_reason text,
  p_idempotency_key text,
  p_occurred_at timestamptz DEFAULT now(),
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line public.service_order_items%ROWTYPE; v_os public.service_orders%ROWTYPE;
  v_balance numeric; v_cost numeric; v_hash text; v_payload jsonb; v_id uuid;
  v_replayed boolean:=false; v_jobs integer;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Somente Administrador'; END IF;
  IF coalesce(p_quantity_delta_m,0)=0 OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Ajuste assinado e motivo sao obrigatorios'; END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'idempotency_key obrigatoria'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));
  PERFORM public.lock_strap_physical_operation_scope(p_service_order_item_id,NULL);
  SELECT * INTO v_line FROM public.service_order_items WHERE id=p_service_order_item_id FOR UPDATE;
  SELECT * INTO v_os FROM public.service_orders WHERE id=v_line.service_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(format('strap-custody:%s:%s',v_line.id,v_line.base_product_id),0));
  SELECT x.balance_m,x.unit_cost INTO v_balance,v_cost
    FROM public.strap_custody_open_value(v_line.id,v_line.base_product_id) x;
  IF v_balance+p_quantity_delta_m<0 THEN RAISE EXCEPTION 'Ajuste deixaria custodia negativa'; END IF;
  v_payload:=jsonb_build_object('service_order_item_id',v_line.id,'delta',p_quantity_delta_m,
    'reason',p_reason,'occurred_at',p_occurred_at); v_hash:=public.strap_payload_hash(v_payload);
  INSERT INTO public.contractor_material_custody_movements(
    service_order_id,service_order_item_id,contractor_id,base_product_id,movement_type,
    quantity,base_unit_cost_snapshot,reason,approved_by,occurred_at,recorded_by,
    operation_type,idempotency_key,payload_hash,correlation_id
  ) VALUES (v_line.service_order_id,v_line.id,v_os.contractor_id,v_line.base_product_id,
    'adjusted',p_quantity_delta_m,v_cost,p_reason,auth.uid(),p_occurred_at,auth.uid(),
    'custody_adjustment',p_idempotency_key,v_hash,p_correlation_id)
  ON CONFLICT(operation_type,idempotency_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    v_replayed:=true;
    SELECT id INTO v_id FROM public.contractor_material_custody_movements
     WHERE operation_type='custody_adjustment' AND idempotency_key=p_idempotency_key
       AND payload_hash=v_hash;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Replay divergente'; END IF;
  END IF;
  IF v_replayed THEN
    RETURN jsonb_build_object('movement_id',v_id,'balance_in_custody',v_balance+p_quantity_delta_m,
      'replayed',true);
  END IF;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('contractor_material_custody',v_id,'update',
    jsonb_build_object('custody_balance_m',v_balance),
    jsonb_build_object('custody_balance_m',v_balance+p_quantity_delta_m,
      'quantity_delta_m',p_quantity_delta_m,'movement_id',v_id),
    btrim(p_reason),p_correlation_id,auth.uid());
  PERFORM public.reconcile_strap_service_order_completion(v_line.id,p_correlation_id,
    'Reconciliacao apos ajuste de custodia: '||btrim(p_reason));
  v_jobs:=public.enqueue_strap_base_availability_reconciliation(
    v_line.base_product_id,v_line.strap_variant_id,v_id,-p_quantity_delta_m,
    'Disponibilidade de napa alterada por ajuste de custodia: '||btrim(p_reason),
    p_correlation_id);
  RETURN jsonb_build_object('movement_id',v_id,'balance_in_custody',v_balance+p_quantity_delta_m,
    'reconciliation_jobs',v_jobs,'correlation_id',p_correlation_id);
END;
$$;

-- Contrato executavel Req53/61/89: somente retorno/ajuste efetivo muda a
-- disponibilidade derivada da fabrica e cada movimento gera um fan-out
-- idempotente, estrutural e transacional para todas as variantes afetadas.
DO $$
DECLARE
  v_send text:=pg_get_functiondef(
    'public.send_strap_material_to_contractor(uuid,numeric,text,text,timestamptz,uuid)'::regprocedure);
  v_return text:=pg_get_functiondef(
    'public.return_strap_material_from_contractor(uuid,numeric,text,text,timestamptz,uuid)'::regprocedure);
  v_adjust text:=pg_get_functiondef(
    'public.adjust_strap_contractor_custody(uuid,numeric,text,text,timestamptz,uuid)'::regprocedure);
  v_fanout text:=pg_get_functiondef(
    'public.enqueue_strap_base_availability_reconciliation(uuid,uuid,uuid,numeric,text,uuid)'::regprocedure);
BEGIN
  IF v_send ~ 'enqueue_strap_base_availability_reconciliation'
     OR v_return !~ 'enqueue_strap_base_availability_reconciliation'
     OR v_adjust !~ 'enqueue_strap_base_availability_reconciliation'
     OR v_fanout !~ '''custody''.*''custody_availability_changed'''
     OR v_fanout !~ 'strap-custody-availability:%s:%s'
     OR v_fanout !~ 'd\.base_product_id=p_base_product_id'
     OR v_fanout !~ 'f\.base_product_id=p_base_product_id'
     OR v_fanout !~ 'op\.official_product_id=p_base_product_id'
     OR v_fanout !~ '''reason'',btrim\(p_reason\)'
     OR v_fanout !~ 'v_key,p_correlation_id'
     OR v_fanout ~ 'products\.quantity[[:space:]]*=' THEN
    RAISE EXCEPTION 'Regressao de custodia: disponibilidade derivada sem fan-out estrutural/idempotente';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_strap_contractor_loss_claim(
  p_service_order_item_id uuid,
  p_lost_quantity_m numeric,
  p_responsible_party text,
  p_reason text,
  p_evidence jsonb,
  p_idempotency_key text,
  p_production_receipt_id uuid,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line public.service_order_items%ROWTYPE;
  v_receipt public.strap_production_receipts%ROWTYPE;
  v_cost numeric; v_rejected_base numeric; v_claimed numeric;
  v_hash text; v_id uuid; v_replayed boolean:=false;
BEGIN
  IF NOT public.has_artisanal_strap_capability('execute_strap_batch')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF coalesce(p_lost_quantity_m,0)<=0 THEN RAISE EXCEPTION 'Perda deve ser positiva'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL OR nullif(btrim(p_responsible_party),'') IS NULL
     OR nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'Responsavel, motivo e idempotency_key sao obrigatorios'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));
  PERFORM public.lock_strap_physical_operation_scope(p_service_order_item_id,NULL);
  SELECT * INTO v_line FROM public.service_order_items WHERE id=p_service_order_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linha de OS nao encontrada'; END IF;
  IF p_production_receipt_id IS NULL THEN
    RAISE EXCEPTION 'production_receipt_id e obrigatorio para vincular a perda ao recebimento rejeitado';
  END IF;
  SELECT * INTO v_receipt FROM public.strap_production_receipts
   WHERE id=p_production_receipt_id AND service_order_item_id=v_line.id
     AND base_product_id=v_line.base_product_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.rejected_m<=0 THEN
    RAISE EXCEPTION 'Recebimento com rejeicao nao pertence a esta linha de OS';
  END IF;
  v_rejected_base:=v_receipt.base_consumed_m*v_receipt.rejected_m
    /nullif(v_receipt.delivered_m,0);
  SELECT coalesce(sum(c.lost_quantity),0) INTO v_claimed
    FROM public.contractor_loss_claims c
   WHERE c.production_receipt_id=v_receipt.id
     AND c.status IN ('pending','approved','applied');
  IF p_lost_quantity_m>greatest(0,v_rejected_base-v_claimed)+0.000001 THEN
    RAISE EXCEPTION 'Perda excede napa rejeitada ainda sem claim (rejeitada %, ja reclamada %)',
      v_rejected_base,v_claimed;
  END IF;
  -- O custo da perda pertence ao lote de custodia remetido, nao ao saldo
  -- contabil disponivel no instante do recebimento. Mesmo quando a baixa
  -- fisica fica em pending_reconciliation por deficit, o movimento consumed
  -- preserva o WAC congelado da remessa consumida por este recebimento.
  SELECT sum(cm.quantity*cm.base_unit_cost_snapshot)/nullif(sum(cm.quantity),0)
    INTO v_cost FROM public.contractor_material_custody_movements cm
   WHERE cm.production_receipt_id=v_receipt.id
     AND cm.service_order_item_id=v_line.id
     AND cm.base_product_id=v_receipt.base_product_id
     AND cm.movement_type='consumed';
  IF v_cost IS NULL OR v_cost<0 THEN
    RAISE EXCEPTION 'Snapshot de custo da custodia nao encontrado no recebimento %',v_receipt.id;
  END IF;
  v_hash:=public.strap_payload_hash(jsonb_build_object('line_id',v_line.id,'lost',p_lost_quantity_m,
    'production_receipt_id',v_receipt.id,'responsible',p_responsible_party,
    'reason',p_reason,'evidence',coalesce(p_evidence,'[]'::jsonb)));
  INSERT INTO public.contractor_loss_claims(
    service_order_id,service_order_item_id,production_receipt_id,base_product_id,lost_quantity,
    base_unit_cost_snapshot,responsible_party,reason,evidence,status,
    idempotency_key,payload_hash,correlation_id
  ) VALUES (v_line.service_order_id,v_line.id,v_receipt.id,v_line.base_product_id,p_lost_quantity_m,
    v_cost,p_responsible_party,p_reason,coalesce(p_evidence,'[]'::jsonb),'pending',
    p_idempotency_key,v_hash,p_correlation_id)
  ON CONFLICT(operation_type,idempotency_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    v_replayed:=true;
    SELECT id INTO v_id FROM public.contractor_loss_claims
     WHERE operation_type='contractor_loss_claim' AND idempotency_key=p_idempotency_key
       AND payload_hash=v_hash;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Replay divergente'; END IF;
  END IF;
  IF v_replayed THEN RETURN v_id; END IF;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  SELECT 'contractor_loss_claim',c.id,'insert',
    jsonb_build_object('production_receipt_id',v_receipt.id,
      'rejected_base_m',v_rejected_base,'claimed_base_m',v_claimed),
    to_jsonb(c),btrim(p_reason),p_correlation_id,auth.uid()
  FROM public.contractor_loss_claims c WHERE c.id=v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_strap_contractor_loss_claim(
  p_claim_id uuid,
  p_decision text,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_claim public.contractor_loss_claims%ROWTYPE; v_line public.service_order_items%ROWTYPE;
  v_os public.service_orders%ROWTYPE; v_balance numeric; v_product public.products%ROWTYPE;
  v_posted numeric; v_movement uuid; v_before jsonb; v_claimed numeric;
  v_scope_service_order_item_id uuid;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Somente Administrador'; END IF;
  IF p_decision NOT IN ('approved','rejected') OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Decisao e motivo sao obrigatorios'; END IF;
  SELECT service_order_item_id INTO v_scope_service_order_item_id
    FROM public.contractor_loss_claims WHERE id=p_claim_id;
  IF v_scope_service_order_item_id IS NULL THEN RAISE EXCEPTION 'Claim nao encontrado'; END IF;
  PERFORM public.lock_strap_physical_operation_scope(v_scope_service_order_item_id,NULL);
  SELECT * INTO v_claim FROM public.contractor_loss_claims WHERE id=p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim nao encontrado'; END IF;
  IF v_claim.status=p_decision THEN RETURN jsonb_build_object('claim_id',v_claim.id,'replayed',true); END IF;
  IF v_claim.status<>'pending' THEN RAISE EXCEPTION 'Claim ja decidido'; END IF;
  v_before:=to_jsonb(v_claim);
  IF p_decision='rejected' THEN
    UPDATE public.contractor_loss_claims SET status='rejected',rejected_by=auth.uid(),
      rejected_at=now() WHERE id=v_claim.id RETURNING * INTO v_claim;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('contractor_loss_claim',v_claim.id,'reject',v_before,to_jsonb(v_claim),
      btrim(p_reason),p_correlation_id,auth.uid());
    PERFORM public.reconcile_strap_service_order_completion(
      v_claim.service_order_item_id,p_correlation_id,
      'Reconciliacao apos rejeicao de claim: '||btrim(p_reason));
    RETURN jsonb_build_object('claim_id',v_claim.id,'status','rejected',
      'correlation_id',p_correlation_id);
  END IF;
  IF v_claim.production_receipt_id IS NOT NULL THEN
    -- A napa rejeitada ja foi baixada fisicamente no recebimento que originou
    -- o claim. A aprovacao aqui e somente decisao de responsabilidade/credito:
    -- nao cria segunda saida de estoque nem segunda baixa de custodia.
    UPDATE public.contractor_loss_claims SET status='approved',approved_by=auth.uid(),approved_at=now()
     WHERE id=v_claim.id RETURNING * INTO v_claim;
    SELECT coalesce(sum(c.lost_quantity),0) INTO v_claimed
      FROM public.contractor_loss_claims c
     WHERE c.production_receipt_id=v_claim.production_receipt_id
       AND c.status IN ('approved','applied');
    UPDATE public.strap_pending_reconciliations pr SET status='resolved',
      resolution_reason=btrim(p_reason),resolved_by=auth.uid(),resolved_at=now(),
      correlation_id=p_correlation_id
     WHERE pr.production_receipt_id=v_claim.production_receipt_id
       AND pr.reconciliation_type='rejected_base_review' AND pr.status='pending'
       AND v_claimed+0.000001>=pr.expected_quantity;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('contractor_loss_claim',v_claim.id,'approve',v_before,
      to_jsonb(v_claim)||jsonb_build_object('production_receipt_id',v_claim.production_receipt_id,
        'claimed_base_m',v_claimed,'physical_stock_posted_m',0,
        'financial_recovery_only',v_claim.responsible_party='contractor'),
      btrim(p_reason),p_correlation_id,auth.uid());
    PERFORM public.reconcile_strap_service_order_completion(
      v_claim.service_order_item_id,p_correlation_id,
      'Reconciliacao apos aprovacao de perda: '||btrim(p_reason));
    RETURN jsonb_build_object('claim_id',v_claim.id,'status','approved',
      'production_receipt_id',v_claim.production_receipt_id,'stock_posted_m',0,
      'financial_recovery_only',v_claim.responsible_party='contractor',
      'correlation_id',p_correlation_id);
  END IF;
  SELECT * INTO v_line FROM public.service_order_items WHERE id=v_claim.service_order_item_id FOR UPDATE;
  SELECT * INTO v_os FROM public.service_orders WHERE id=v_line.service_order_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(format('strap-custody:%s:%s',v_line.id,v_claim.base_product_id),0));
  SELECT coalesce(balance_in_custody,0) INTO v_balance FROM public.v_contractor_material_custody_balances
   WHERE service_order_item_id=v_line.id AND base_product_id=v_claim.base_product_id;
  IF v_claim.lost_quantity>v_balance THEN RAISE EXCEPTION 'Perda excede saldo em custodia %',v_balance; END IF;
  UPDATE public.contractor_loss_claims SET status='approved',approved_by=auth.uid(),approved_at=now()
   WHERE id=v_claim.id RETURNING * INTO v_claim;
  INSERT INTO public.contractor_material_custody_movements(
    service_order_id,service_order_item_id,contractor_id,base_product_id,movement_type,
    quantity,base_unit_cost_snapshot,contractor_loss_claim_id,occurred_at,recorded_by,
    operation_type,idempotency_key,payload_hash,correlation_id
  ) VALUES (v_line.service_order_id,v_line.id,v_os.contractor_id,v_claim.base_product_id,
    'lost',v_claim.lost_quantity,v_claim.base_unit_cost_snapshot,v_claim.id,now(),auth.uid(),
    'custody_loss','claim:'||v_claim.id,public.strap_payload_hash(to_jsonb(v_claim)),p_correlation_id)
  RETURNING id INTO v_movement;
  SELECT * INTO v_product FROM public.products WHERE id=v_claim.base_product_id FOR UPDATE;
  v_posted:=least(v_product.quantity,v_claim.lost_quantity);
  IF v_posted>0 THEN
    UPDATE public.products SET quantity=quantity-v_posted,current_stock=quantity-v_posted WHERE id=v_product.id;
    INSERT INTO public.stock_movements(product_id,movement_type,quantity,previous_stock,new_stock,
      description,movement_reason,base_product_id,service_order_item_id,effective_unit_cost,correlation_id)
    VALUES(v_product.id,'out',v_posted,v_product.quantity,v_product.quantity-v_posted,
      'Consumo por perda aprovada em custodia','consumo_op',v_product.id,v_line.id,
      v_claim.base_unit_cost_snapshot,p_correlation_id);
  END IF;
  IF v_posted<v_claim.lost_quantity THEN
    INSERT INTO public.strap_pending_reconciliations(reconciliation_type,product_id,
      strap_variant_id,expected_quantity,posted_quantity,correlation_id)
    VALUES('custody_variance',v_product.id,v_line.strap_variant_id,
      v_claim.lost_quantity,v_posted,p_correlation_id);
  END IF;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('contractor_loss_claim',v_claim.id,'approve',v_before,
    to_jsonb(v_claim)||jsonb_build_object('custody_movement_id',v_movement,
      'stock_posted_m',v_posted),btrim(p_reason),p_correlation_id,auth.uid());
  PERFORM public.reconcile_strap_service_order_completion(v_line.id,p_correlation_id,
    'Reconciliacao apos baixa de perda: '||btrim(p_reason));
  RETURN jsonb_build_object('claim_id',v_claim.id,'status','approved',
    'custody_movement_id',v_movement,'stock_posted_m',v_posted,
    'correlation_id',p_correlation_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Recebimento parcial de OC: NF, estoque, alocacao e financeiro
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_strap_purchase_receipt(
  p_purchase_order_item_id uuid,
  p_delivered_quantity numeric,
  p_accepted_quantity numeric,
  p_rejected_quantity numeric,
  p_actual_unit_price_purchase numeric,
  p_invoice_number text,
  p_invoice_issue_date date,
  p_installments jsonb,
  p_idempotency_key text,
  p_invoice_key text DEFAULT NULL,
  p_rejection_reason text DEFAULT NULL,
  p_rejection_disposition text DEFAULT NULL,
  p_received_at timestamptz DEFAULT now(),
  p_installment_adjustment_reason text DEFAULT NULL,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.purchase_order_items%ROWTYPE;
  v_po public.purchase_orders%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_receipt public.purchase_receipts%ROWTYPE;
  v_existing public.purchase_receipts%ROWTYPE;
  v_receipt_item public.purchase_receipt_items%ROWTYPE;
  v_payload jsonb;
  v_hash text;
  v_rate numeric;
  v_accepted_stock numeric;
  v_rejected_stock numeric;
  v_cost_stock numeric;
  v_invoice_total numeric;
  v_committed_release_total numeric;
  v_committed_release_amount numeric;
  v_installment_total numeric;
  v_installment_count integer;
  v_default_installments jsonb;
  v_effective_installments jsonb;
  v_installments_adjusted boolean:=false;
  v_installment record;
  v_open_purchase numeric;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_new_wac numeric;
  v_remaining numeric;
  v_take numeric;
  v_free_accepted numeric := 0;
  v_accepted_allocations jsonb := '{}'::jsonb;
  v_rejected_allocations jsonb := '{}'::jsonb;
  v_contribution public.purchase_demand_contributions%ROWTYPE;
  v_variant_id uuid;
  v_before jsonb;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.user_has_any_role(ARRAY['admin','gerente']) THEN
    RAISE EXCEPTION 'Somente Administrador/Gerente pode confirmar recebimento de OC';
  END IF;
  IF coalesce(p_delivered_quantity,0)<=0 OR coalesce(p_accepted_quantity,0)<0
     OR coalesce(p_rejected_quantity,0)<0
     OR p_delivered_quantity<>p_accepted_quantity+p_rejected_quantity THEN
    RAISE EXCEPTION 'Entregue deve ser igual a aceita + rejeitada';
  END IF;
  IF coalesce(p_actual_unit_price_purchase,0)<=0 THEN
    RAISE EXCEPTION 'Preco efetivo de compra deve ser positivo';
  END IF;
  IF nullif(btrim(p_invoice_number),'') IS NULL OR p_invoice_issue_date IS NULL THEN
    RAISE EXCEPTION 'Numero e data de emissao da NF sao obrigatorios';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'idempotency_key obrigatoria';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));
  IF p_rejected_quantity>0 AND (
    nullif(btrim(p_rejection_reason),'') IS NULL
    OR p_rejection_disposition NOT IN ('return','replace','scrap','credit_note','pending')
  ) THEN RAISE EXCEPTION 'Rejeicao exige motivo e disposicao'; END IF;
  IF jsonb_typeof(coalesce(p_installments,'[]'::jsonb))<>'array' THEN
    RAISE EXCEPTION 'p_installments deve ser array';
  END IF;

  SELECT * INTO v_item FROM public.purchase_order_items
   WHERE id=p_purchase_order_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de OC nao encontrado'; END IF;
  SELECT * INTO v_po FROM public.purchase_orders WHERE id=v_item.purchase_order_id FOR UPDATE;
  IF NOT public.is_valid_strap_payment_terms(v_po.payment_terms_snapshot) THEN
    RAISE EXCEPTION 'Snapshot estruturado da condicao de pagamento esta ausente/invalido';
  END IF;
  v_invoice_total:=p_accepted_quantity*p_actual_unit_price_purchase;
  v_committed_release_total:=p_accepted_quantity*coalesce(v_item.unit_price,0);
  IF v_invoice_total=0 THEN
    IF jsonb_array_length(coalesce(p_installments,'[]'::jsonb))<>0 THEN
      RAISE EXCEPTION 'Recebimento integralmente rejeitado nao gera parcelas financeiras';
    END IF;
    v_default_installments:='[]'::jsonb;
    v_effective_installments:='[]'::jsonb;
  ELSE
    v_default_installments:=public.build_strap_payment_installments(
      v_po.payment_terms_snapshot,p_invoice_issue_date,v_invoice_total);
    v_effective_installments:=CASE WHEN jsonb_array_length(coalesce(p_installments,'[]'::jsonb))=0
      THEN v_default_installments ELSE p_installments END;
  END IF;
  v_installments_adjusted:=v_effective_installments IS DISTINCT FROM v_default_installments;
  IF v_installments_adjusted AND nullif(btrim(p_installment_adjustment_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Ajuste manual de vencimentos/parcelas exige motivo';
  END IF;

  v_payload:=jsonb_build_object(
    'purchase_order_item_id',p_purchase_order_item_id,
    'delivered_quantity',p_delivered_quantity,'accepted_quantity',p_accepted_quantity,
    'rejected_quantity',p_rejected_quantity,
    'actual_unit_price_purchase',p_actual_unit_price_purchase,
    'invoice_number',btrim(p_invoice_number),'invoice_key',nullif(btrim(p_invoice_key),''),
    'invoice_issue_date',p_invoice_issue_date,'installments',v_effective_installments,
    'installment_adjustment_reason',nullif(btrim(p_installment_adjustment_reason),''),
    'rejection_reason',p_rejection_reason,'rejection_disposition',p_rejection_disposition,
    'received_at',p_received_at
  );
  v_hash:=public.strap_payload_hash(v_payload);
  SELECT * INTO v_existing FROM public.purchase_receipts
   WHERE operation_type='strap_purchase_receipt' AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash<>v_hash THEN RAISE EXCEPTION 'Replay idempotente divergente'; END IF;
    RETURN jsonb_build_object('purchase_receipt_id',v_existing.id,'replayed',true,
      'purchase_receipt_item_id',(SELECT i.id FROM public.purchase_receipt_items i
        WHERE i.purchase_receipt_id=v_existing.id LIMIT 1));
  END IF;

  IF v_po.source_type<>'strap_demand' OR v_po.snapshot_locked_at IS NULL
     OR v_po.status NOT IN ('approved','sent','partial') THEN
    RAISE EXCEPTION 'OC nao esta aprovada/enviada e elegivel a recebimento';
  END IF;
  v_rate:=coalesce(v_item.conversion_rate_snapshot,0);
  IF v_rate<=0 THEN RAISE EXCEPTION 'Snapshot de conversao invalido'; END IF;
  v_open_purchase:=greatest(0,v_item.quantity-coalesce(v_item.received_quantity,0));
  IF p_delivered_quantity>v_open_purchase+0.000001 THEN
    RAISE EXCEPTION 'Quantidade entregue % excede saldo aberto %',p_delivered_quantity,v_open_purchase;
  END IF;
  v_before:=jsonb_build_object('purchase_order',to_jsonb(v_po),
    'purchase_order_item',to_jsonb(v_item),'open_purchase_quantity',v_open_purchase,
    'contributions',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at,c.id)
      FROM public.purchase_demand_contributions c
      WHERE c.purchase_order_item_id=v_item.id),'[]'::jsonb));

  v_accepted_stock:=p_accepted_quantity*v_rate;
  v_rejected_stock:=p_rejected_quantity*v_rate;
  v_cost_stock:=p_actual_unit_price_purchase/v_rate;
  SELECT coalesce(sum((x->>'amount')::numeric),0),count(*)::integer
    INTO v_installment_total,v_installment_count
    FROM jsonb_array_elements(coalesce(v_effective_installments,'[]'::jsonb)) x;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(v_effective_installments,'[]'::jsonb)) x
     WHERE nullif(x->>'due_date','') IS NULL OR (x->>'due_date')::date<p_invoice_issue_date
       OR coalesce((x->>'amount')::numeric,0)<=0
  ) THEN RAISE EXCEPTION 'Parcela exige vencimento valido e valor positivo'; END IF;
  IF (v_invoice_total>0 AND (v_installment_count=0
      OR abs(v_installment_total-v_invoice_total)>0.01))
     OR (v_invoice_total=0 AND v_installment_count<>0) THEN
    RAISE EXCEPTION 'Parcelas (%) nao fecham o valor aceito da NF (%)',v_installment_total,v_invoice_total;
  END IF;
  IF v_invoice_total>0
     AND v_installment_count<>jsonb_array_length(v_po.payment_terms_snapshot) THEN
    RAISE EXCEPTION 'Ajuste preserva a quantidade de parcelas da condicao congelada';
  END IF;

  INSERT INTO public.purchase_receipts(
    purchase_order_id,invoice_number,invoice_key,invoice_issue_date,received_at,
    payment_condition_snapshot,payment_terms_structured_snapshot,
    installments_snapshot,status,confirmed_by,
    operation_type,idempotency_key,payload_hash,correlation_id
  ) VALUES (
    v_po.id,btrim(p_invoice_number),nullif(btrim(p_invoice_key),''),p_invoice_issue_date,
    p_received_at,v_po.payment_condition_snapshot,v_po.payment_terms_snapshot,
    coalesce(v_effective_installments,'[]'::jsonb),
    'confirmed',auth.uid(),'strap_purchase_receipt',p_idempotency_key,v_hash,p_correlation_id
  ) RETURNING * INTO v_receipt;

  INSERT INTO public.purchase_receipt_items(
    purchase_receipt_id,purchase_order_id,purchase_order_item_id,product_id,
    delivered_quantity,accepted_quantity,rejected_quantity,accepted_stock_quantity,
    conversion_rate_snapshot,actual_unit_price_purchase,effective_unit_cost_stock,
    rejection_reason,rejection_disposition,document_number,received_at,received_by,
    operation_type,idempotency_key,payload_hash,correlation_id
  ) VALUES (
    v_receipt.id,v_po.id,v_item.id,v_item.product_id,p_delivered_quantity,
    p_accepted_quantity,p_rejected_quantity,v_accepted_stock,v_rate,
    p_actual_unit_price_purchase,v_cost_stock,p_rejection_reason,p_rejection_disposition,
    btrim(p_invoice_number),p_received_at,auth.uid(),'purchase_receipt',
    p_idempotency_key,v_hash,p_correlation_id
  ) RETURNING * INTO v_receipt_item;

  -- Token local consumido pelos guards do cabecalho/item; nao concede acesso e
  -- existe apenas dentro desta transacao SECURITY DEFINER ja autorizada.
  PERFORM set_config('app.strap_po_receipt','1',true);

  SELECT * INTO v_product FROM public.products WHERE id=v_item.product_id FOR UPDATE;
  v_previous_stock:=coalesce(v_product.quantity,0);
  IF v_accepted_stock>0 THEN
    v_new_stock:=v_previous_stock+v_accepted_stock;
    v_new_wac:=((v_previous_stock*coalesce(v_product.unit_price,0))
      +(v_accepted_stock*v_cost_stock))/nullif(v_new_stock,0);
    PERFORM set_config('app.artisanal_strap_catalog_write','1',true);
    PERFORM set_config('app.artisanal_strap_catalog_reason',
      'Recebimento OC '||v_po.order_number||' NF '||btrim(p_invoice_number),true);
    UPDATE public.products SET quantity=v_new_stock,current_stock=v_new_stock,
      purchase_price=p_actual_unit_price_purchase,unit_price=v_new_wac WHERE id=v_product.id;
    SELECT CASE WHEN EXISTS(
      SELECT 1 FROM public.artisanal_strap_variants v
       WHERE v.finished_product_id=v_product.id AND v.purchase_enabled
    ) THEN coalesce(v_item.strap_variant_id,(SELECT v.id
      FROM public.artisanal_strap_variants v
      WHERE v.finished_product_id=v_product.id AND v.purchase_enabled)) ELSE NULL END
      INTO v_variant_id;
    INSERT INTO public.stock_movements(
      product_id,movement_type,quantity,previous_stock,new_stock,description,
      movement_reason,strap_variant_id,finished_product_id,purchase_receipt_item_id,
      origin_type,effective_unit_cost,correlation_id
    ) VALUES (
      v_product.id,'in',v_accepted_stock,v_previous_stock,v_new_stock,
      'Entrada aceita da OC '||v_po.order_number||' / NF '||btrim(p_invoice_number),
      'compra',v_variant_id,CASE WHEN v_variant_id IS NOT NULL THEN v_product.id ELSE NULL END,
      v_receipt_item.id,CASE WHEN v_variant_id IS NOT NULL THEN 'buy_ready' ELSE NULL END,
      v_cost_stock,p_correlation_id
    );
  END IF;

  UPDATE public.purchase_order_items SET
    received_quantity=coalesce(received_quantity,0)+p_accepted_quantity,
    received_at=CASE WHEN coalesce(received_quantity,0)+p_accepted_quantity>=quantity
      THEN p_received_at ELSE received_at END
   WHERE id=v_item.id;

  v_remaining:=v_accepted_stock;
  FOR v_contribution IN
    SELECT c.* FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_item_id=v_item.id
       AND c.status IN ('approved','sent','partial')
     ORDER BY c.needed_at,c.created_at,c.id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_take:=least(v_remaining,greatest(0,
      v_contribution.committed_quantity_stock_unit-v_contribution.accepted_quantity_stock_unit));
    IF v_take>0 THEN
      v_accepted_allocations:=v_accepted_allocations
        || jsonb_build_object(v_contribution.id::text,v_take);
      UPDATE public.purchase_demand_contributions SET
        accepted_quantity_stock_unit=accepted_quantity_stock_unit+v_take,
        status=CASE WHEN accepted_quantity_stock_unit+v_take>=committed_quantity_stock_unit
          THEN 'received' ELSE 'partial' END,correlation_id=p_correlation_id
       WHERE id=v_contribution.id;
      v_remaining:=v_remaining-v_take;
    END IF;
  END LOOP;
  v_free_accepted:=greatest(v_remaining,0);

  v_remaining:=v_rejected_stock;
  FOR v_contribution IN
    SELECT c.* FROM public.purchase_demand_contributions c
     WHERE c.purchase_order_item_id=v_item.id
       AND c.status IN ('approved','sent','partial','received')
     ORDER BY c.needed_at,c.created_at,c.id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining<=0;
    v_take:=least(v_remaining,greatest(0,
      v_contribution.committed_quantity_stock_unit-v_contribution.accepted_quantity_stock_unit));
    IF v_take>0 THEN
      v_rejected_allocations:=v_rejected_allocations
        || jsonb_build_object(v_contribution.id::text,v_take);
      UPDATE public.purchase_demand_contributions SET
        rejected_quantity_stock_unit=rejected_quantity_stock_unit+v_take,
        status=CASE WHEN accepted_quantity_stock_unit>=committed_quantity_stock_unit
          THEN 'received' ELSE 'partial' END,correlation_id=p_correlation_id
       WHERE id=v_contribution.id;
      v_remaining:=v_remaining-v_take;
    END IF;
  END LOOP;

  -- Um unico fato imutavel por contribuicao contem as parcelas aceita e
  -- rejeitada. Nao ha UPDATE posterior que viole o guard de fatos.
  INSERT INTO public.purchase_receipt_allocations(
    purchase_receipt_item_id,purchase_demand_contribution_id,
    accepted_stock_quantity,rejected_stock_quantity)
  SELECT v_receipt_item.id,k::uuid,
    coalesce((v_accepted_allocations->>k)::numeric,0),
    coalesce((v_rejected_allocations->>k)::numeric,0)
  FROM (
    SELECT key AS k FROM jsonb_object_keys(v_accepted_allocations) key
    UNION
    SELECT key AS k FROM jsonb_object_keys(v_rejected_allocations) key
  ) allocations;

  FOR v_installment IN
    SELECT ordinality::integer AS installment_number,
           (x->>'due_date')::date AS due_date,(x->>'amount')::numeric AS amount
      FROM jsonb_array_elements(coalesce(v_effective_installments,'[]'::jsonb))
        WITH ORDINALITY e(x,ordinality)
  LOOP
    SELECT v_committed_release_total*((t->>'percentage')::numeric/100)
      INTO v_committed_release_amount
      FROM jsonb_array_elements(v_po.payment_terms_snapshot) WITH ORDINALITY terms(t,ordinality)
     WHERE ordinality=v_installment.installment_number;
    INSERT INTO public.strap_purchase_cashflow_installments(
      purchase_order_id,purchase_receipt_id,layer,installment_number,days_offset,
      percentage,due_date,original_amount,remaining_amount,status,correlation_id)
    VALUES(v_po.id,v_receipt.id,'invoiced',v_installment.installment_number,
      (v_installment.due_date-p_invoice_issue_date),
      CASE WHEN v_invoice_total>0 THEN v_installment.amount/v_invoice_total*100 ELSE 100 END,
      v_installment.due_date,v_installment.amount,v_installment.amount,'open',p_correlation_id);
    UPDATE public.strap_purchase_cashflow_installments SET
      remaining_amount=greatest(0,remaining_amount-coalesce(v_committed_release_amount,0)),
      status=CASE WHEN remaining_amount-coalesce(v_committed_release_amount,0)<=0.000001
        THEN 'converted' ELSE 'open' END,updated_at=now(),correlation_id=p_correlation_id
     WHERE purchase_order_id=v_po.id AND purchase_receipt_id IS NULL
       AND layer='committed_unbilled'
       AND installment_number=v_installment.installment_number;
    INSERT INTO public.accounts_payable(
      description,supplier_id,category,due_date,amount,status,installment_number,
      total_installments,notes,reference_id,reference_type,purchase_order_id,purchase_receipt_id
    ) VALUES (
      'NF '||btrim(p_invoice_number)||' - '||v_po.order_number||' - parcela '
        ||v_installment.installment_number||'/'||v_installment_count,
      v_po.supplier_id,'material',
      v_installment.due_date,v_installment.amount,'pending',v_installment.installment_number,
      v_installment_count,'Recebimento parcial aceito; vencimentos confirmados no recebimento.'
        ||CASE WHEN v_installments_adjusted THEN ' Ajuste: '||btrim(p_installment_adjustment_reason) ELSE '' END,
      v_receipt.id,'strap_purchase_receipt',v_po.id,v_receipt.id
    );
  END LOOP;

  UPDATE public.purchase_orders SET status=CASE WHEN NOT EXISTS(
    SELECT 1 FROM public.purchase_order_items i WHERE i.purchase_order_id=v_po.id
      AND coalesce(i.received_quantity,0)<i.quantity
  ) THEN 'received' ELSE 'partial' END WHERE id=v_po.id;

  FOR v_variant_id IN SELECT DISTINCT c.strap_variant_id
    FROM public.purchase_demand_contributions c
    WHERE c.purchase_order_item_id=v_item.id AND c.strap_variant_id IS NOT NULL
  LOOP
    PERFORM public.reconcile_strap_variant(v_variant_id,p_correlation_id,'purchase_receipt');
  END LOOP;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('purchase_receipt',v_receipt.id,'receive',v_before,
    to_jsonb(v_receipt)||jsonb_build_object('receipt_item',to_jsonb(v_receipt_item),
      'accepted_allocations',v_accepted_allocations,'rejected_allocations',v_rejected_allocations,
      'free_stock_quantity',v_free_accepted,
      'purchase_order_status',(SELECT status FROM public.purchase_orders WHERE id=v_po.id)),
    'NF '||btrim(p_invoice_number)||CASE WHEN v_installments_adjusted
      THEN ' | ajuste de parcelas: '||btrim(p_installment_adjustment_reason) ELSE '' END,
    p_correlation_id,auth.uid());
  RETURN jsonb_build_object('purchase_receipt_id',v_receipt.id,
    'purchase_receipt_item_id',v_receipt_item.id,'accepted_stock_quantity',v_accepted_stock,
    'rejected_stock_quantity',v_rejected_stock,'free_stock_quantity',v_free_accepted,
    'correlation_id',p_correlation_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Recebimento parcial de producao: estoque, custodia e competencia
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_strap_production_receipt(
  p_batch_item_id uuid,
  p_service_order_item_id uuid,
  p_delivered_m numeric,
  p_approved_m numeric,
  p_rejected_m numeric,
  p_base_consumed_m numeric,
  p_idempotency_key text,
  p_base_returned_m numeric DEFAULT 0,
  p_document_number text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_notes text DEFAULT NULL,
  p_correlation_id uuid DEFAULT gen_random_uuid(),
  p_allocations jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.strap_production_batch_items%ROWTYPE;
  v_batch public.strap_production_batches%ROWTYPE;
  v_line public.service_order_items%ROWTYPE;
  v_os public.service_orders%ROWTYPE;
  v_base public.products%ROWTYPE;
  v_finished public.products%ROWTYPE;
  v_receipt public.strap_production_receipts%ROWTYPE;
  v_existing public.strap_production_receipts%ROWTYPE;
  v_batch_item_id uuid;
  v_payload jsonb;
  v_hash text;
  v_balance numeric;
  v_posted_base numeric;
  v_new_finished numeric;
  v_finished_unit_cost numeric;
  v_base_cost_snapshot numeric;
  v_base_for_approved numeric;
  v_base_for_rejected numeric;
  v_new_wac numeric;
  v_transform_cost numeric;
  v_remaining numeric;
  v_take numeric;
  v_contribution public.strap_production_batch_contributions%ROWTYPE;
  v_reservation public.material_reservations%ROWTYPE;
  v_reservation_remaining numeric;
  v_reservation_take numeric;
  v_cycle uuid;
  v_schedule uuid;
  v_schedule_timezone text;
  v_before jsonb;
  v_allocation jsonb;
  v_contribution_id uuid;
  v_receipt_allocation_id uuid;
  v_applied_allocations jsonb:='[]'::jsonb;
  v_item_complete boolean;
  v_batch_complete boolean;
  v_line_was_suspended boolean:=false;
  v_item_was_suspended boolean:=false;
  v_batch_was_suspended boolean:=false;
  v_has_physical_commitment boolean:=false;
  v_explicit_allocation_total numeric:=0;
  v_eligible_allocation_total numeric:=0;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.has_artisanal_strap_capability('execute_strap_batch')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF num_nonnulls(p_batch_item_id,p_service_order_item_id) <> 1 THEN
    RAISE EXCEPTION 'Informe exatamente batch_item_id ou service_order_item_id';
  END IF;
  IF coalesce(p_delivered_m,0) <= 0 OR coalesce(p_approved_m,-1) < 0
     OR coalesce(p_rejected_m,-1) < 0
     OR p_delivered_m IS DISTINCT FROM p_approved_m + p_rejected_m
     OR coalesce(p_base_consumed_m,-1) < 0 OR coalesce(p_base_returned_m,-1) < 0 THEN
    RAISE EXCEPTION 'Quantidades invalidas no recebimento';
  END IF;
  IF nullif(btrim(p_idempotency_key),'') IS NULL THEN RAISE EXCEPTION 'idempotency_key obrigatoria'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));

  v_payload := jsonb_build_object('batch_item_id',p_batch_item_id,
    'service_order_item_id',p_service_order_item_id,'delivered_m',p_delivered_m,
    'approved_m',p_approved_m,'rejected_m',p_rejected_m,
    'base_consumed_m',p_base_consumed_m,'base_returned_m',p_base_returned_m,
    'document_number',p_document_number,'occurred_at',p_occurred_at,'notes',p_notes,
    'allocations',p_allocations);
  v_hash := public.strap_payload_hash(v_payload);
  SELECT * INTO v_existing FROM public.strap_production_receipts
   WHERE operation_type='strap_production_receipt' AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.payload_hash <> v_hash THEN RAISE EXCEPTION 'Replay idempotente divergente'; END IF;
    RETURN jsonb_build_object('receipt_id',v_existing.id,'replayed',true,
      'approved_m',v_existing.approved_m,'rejected_m',v_existing.rejected_m);
  END IF;

  PERFORM public.lock_strap_physical_operation_scope(
    p_service_order_item_id,p_batch_item_id);
  IF p_service_order_item_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.service_order_items
     WHERE id=p_service_order_item_id FOR UPDATE;
    IF NOT FOUND OR v_line.strap_batch_item_id IS NULL THEN RAISE EXCEPTION 'Linha de OS de tira inexistente'; END IF;
    IF v_line.line_status IN ('Cancelado','Entregue') THEN
      RAISE EXCEPTION 'Linha de OS nao aceita recebimento no estado atual';
    END IF;
    v_line_was_suspended:=v_line.suspended_at IS NOT NULL OR v_line.line_status='Suspensa';
    v_batch_item_id := v_line.strap_batch_item_id;
    SELECT * INTO v_os FROM public.service_orders WHERE id=v_line.service_order_id FOR UPDATE;
  ELSE
    v_batch_item_id := p_batch_item_id;
  END IF;

  v_base_for_approved:=CASE WHEN p_delivered_m>0
    THEN p_base_consumed_m*(p_approved_m/p_delivered_m) ELSE 0 END;
  v_base_for_rejected:=greatest(0,p_base_consumed_m-v_base_for_approved);

  SELECT * INTO v_item FROM public.strap_production_batch_items
   WHERE id=v_batch_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item de lote inexistente'; END IF;
  SELECT * INTO v_batch FROM public.strap_production_batches WHERE id=v_item.batch_id FOR UPDATE;
  v_item_was_suspended:=v_item.status='suspended';
  v_batch_was_suspended:=v_batch.status='suspended';
  IF v_item.status IN ('cancelled','completed') OR v_batch.status IN ('cancelled','completed') THEN
    RAISE EXCEPTION 'Lote/item nao aceita recebimento no estado atual';
  END IF;
  v_has_physical_commitment:=v_item.started_at IS NOT NULL OR v_batch.started_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.strap_production_receipts r
      WHERE r.batch_item_id=v_item.id)
    OR (p_service_order_item_id IS NOT NULL AND (
      v_line.sent_at IS NOT NULL OR EXISTS(
        SELECT 1 FROM public.contractor_material_custody_movements m
         WHERE m.service_order_item_id=v_line.id AND m.movement_type='sent'
      )
    ));
  IF (v_line_was_suspended OR v_item_was_suspended OR v_batch_was_suspended)
     AND NOT v_has_physical_commitment THEN
    RAISE EXCEPTION 'Recebimento suspenso exige lote iniciado ou napa previamente enviada';
  END IF;
  IF p_service_order_item_id IS NULL AND v_batch.executor_type <> 'factory' THEN
    RAISE EXCEPTION 'Recebimento de terceiro exige service_order_item_id';
  END IF;
  IF p_service_order_item_id IS NOT NULL AND v_batch.executor_type <> 'contractor' THEN
    RAISE EXCEPTION 'service_order_item_id so e valido para lote terceirizado';
  END IF;
  IF p_service_order_item_id IS NOT NULL AND (
       v_line.sent_at IS NULL OR v_line.sent_at>p_occurred_at
       OR NOT EXISTS(
         SELECT 1 FROM public.contractor_material_custody_movements m
          WHERE m.service_order_item_id=v_line.id
            AND m.service_order_id=v_line.service_order_id
            AND m.base_product_id=v_item.base_product_id
            AND m.movement_type='sent' AND m.occurred_at<=p_occurred_at)
     ) THEN
    RAISE EXCEPTION 'Recebimento terceirizado exige remessa estrutural anterior da napa';
  END IF;
  IF p_service_order_item_id IS NOT NULL AND p_base_consumed_m<=0 THEN
    RAISE EXCEPTION 'Recebimento terceirizado com metragem entregue exige consumo positivo de napa';
  END IF;

  IF p_allocations IS NOT NULL THEN
    IF jsonb_typeof(p_allocations)<>'array' THEN
      RAISE EXCEPTION 'allocations deve ser array JSON';
    END IF;
    IF EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_allocations) x(value)
       WHERE jsonb_typeof(x.value)<>'object'
          OR nullif(x.value->>'contribution_id','') IS NULL
          OR coalesce((x.value->>'approved_m')::numeric,0)<=0
    ) THEN
      RAISE EXCEPTION 'Cada allocation exige contribution_id e approved_m positivo';
    END IF;
    IF EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_allocations) x(value)
       GROUP BY x.value->>'contribution_id' HAVING count(*)>1
    ) THEN
      RAISE EXCEPTION 'contribution_id duplicado em allocations';
    END IF;
    SELECT coalesce(sum((x.value->>'approved_m')::numeric),0)
      INTO v_explicit_allocation_total
      FROM jsonb_array_elements(p_allocations) x(value);

    -- Bloqueia todas as contribuicoes informadas em UUID order antes de
    -- validar saldos, impedindo duas parciais concorrentes de alocar o mesmo PV.
    PERFORM 1 FROM public.strap_production_batch_contributions c
     WHERE c.id IN (SELECT (x.value->>'contribution_id')::uuid
       FROM jsonb_array_elements(p_allocations) x(value))
     ORDER BY c.id FOR UPDATE;
    SELECT coalesce(sum(greatest(0,c.planned_m-c.delivered_m)),0)
      INTO v_eligible_allocation_total
      FROM public.strap_production_batch_contributions c
     WHERE c.batch_item_id=v_item.id
       AND c.status IN ('planned','in_progress','partial','suspended')
       AND (p_service_order_item_id IS NULL
         OR c.service_order_item_id=p_service_order_item_id);
    IF abs(v_explicit_allocation_total
      -least(p_approved_m,v_eligible_allocation_total))>0.000001 THEN
      RAISE EXCEPTION 'Soma de allocations deve ser % (minimo entre aprovado e saldo elegivel)',
        least(p_approved_m,v_eligible_allocation_total);
    END IF;
    IF EXISTS(
      SELECT 1
        FROM jsonb_array_elements(p_allocations) x(value)
        LEFT JOIN public.strap_production_batch_contributions c
          ON c.id=(x.value->>'contribution_id')::uuid
       WHERE c.id IS NULL OR c.batch_item_id<>v_item.id
          OR c.status NOT IN ('planned','in_progress','partial','suspended')
          OR (p_service_order_item_id IS NOT NULL
            AND c.service_order_item_id IS DISTINCT FROM p_service_order_item_id)
          OR (x.value->>'approved_m')::numeric
             > greatest(0,c.planned_m-c.delivered_m)+0.000001
    ) THEN
      RAISE EXCEPTION 'Allocation nao pertence a linha/lote ou excede saldo elegivel';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('strap-stock:'||least(v_item.base_product_id::text,v_item.finished_product_id::text),0));
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-stock:'||greatest(v_item.base_product_id::text,v_item.finished_product_id::text),0));
  SELECT * INTO v_base FROM public.products WHERE id=v_item.base_product_id FOR UPDATE;
  SELECT * INTO v_finished FROM public.products WHERE id=v_item.finished_product_id FOR UPDATE;
  v_before:=jsonb_build_object('batch',to_jsonb(v_batch),'batch_item',to_jsonb(v_item),
    'service_order_item',CASE WHEN p_service_order_item_id IS NULL THEN NULL ELSE to_jsonb(v_line) END,
    'base_stock_m',v_base.quantity,'finished_stock_m',v_finished.quantity);

  IF p_service_order_item_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      format('strap-custody:%s:%s',v_line.id,v_item.base_product_id),0));
    SELECT x.balance_m,x.unit_cost INTO v_balance,v_base_cost_snapshot
      FROM public.strap_custody_open_value(v_line.id,v_item.base_product_id) x;
    IF p_base_consumed_m + p_base_returned_m > coalesce(v_balance,0) THEN
      RAISE EXCEPTION 'Consumo/devolucao excede saldo em custodia %',coalesce(v_balance,0);
    END IF;
    SELECT transformation_cost_per_m_snapshot INTO v_transform_cost
      FROM public.strap_service_order_financial_snapshots
     WHERE service_order_item_id=v_line.id;
    v_transform_cost:=coalesce(v_transform_cost,0);
  ELSE
    v_balance := NULL;
    v_base_cost_snapshot:=coalesce(v_base.unit_price,0);
    SELECT transformation_cost_per_m INTO v_transform_cost
      FROM public.artisanal_strap_recipes WHERE id=v_item.recipe_id;
  END IF;

  INSERT INTO public.strap_production_receipts(
    batch_item_id,service_order_item_id,strap_variant_id,recipe_id,
    base_product_id,finished_product_id,delivered_m,approved_m,rejected_m,
    base_consumed_m,base_returned_m,base_lost_m,balance_in_custody_snapshot,
    document_number,notes,occurred_at,recorded_by,idempotency_key,payload_hash,correlation_id
  ) VALUES (
    v_batch_item_id,p_service_order_item_id,v_item.strap_variant_id,v_item.recipe_id,
    v_item.base_product_id,v_item.finished_product_id,p_delivered_m,p_approved_m,p_rejected_m,
    p_base_consumed_m,p_base_returned_m,0,
    CASE WHEN v_balance IS NULL THEN NULL ELSE v_balance-p_base_consumed_m-p_base_returned_m END,
    p_document_number,p_notes,p_occurred_at,auth.uid(),p_idempotency_key,v_hash,p_correlation_id
  ) RETURNING * INTO v_receipt;

  INSERT INTO public.strap_production_receipt_financial_snapshots(
    production_receipt_id,base_consumed_m_snapshot,approved_m_snapshot,
    rejected_m_snapshot,base_unit_cost_snapshot,transformation_cost_per_m_snapshot
  ) VALUES (
    v_receipt.id,p_base_consumed_m,p_approved_m,p_rejected_m,
    v_base_cost_snapshot,coalesce(v_transform_cost,0)
  );

  IF p_service_order_item_id IS NOT NULL AND p_base_consumed_m > 0 THEN
    INSERT INTO public.contractor_material_custody_movements(
      service_order_id,service_order_item_id,contractor_id,base_product_id,movement_type,
      quantity,base_unit_cost_snapshot,production_receipt_id,document_number,occurred_at,
      recorded_by,operation_type,idempotency_key,payload_hash,correlation_id
    ) VALUES(v_line.service_order_id,v_line.id,v_os.contractor_id,v_item.base_product_id,
      'consumed',p_base_consumed_m,v_base_cost_snapshot,v_receipt.id,p_document_number,
      p_occurred_at,auth.uid(),'custody_consumption','receipt:'||v_receipt.id||':consumed',
      v_hash,p_correlation_id);
  END IF;
  IF p_service_order_item_id IS NOT NULL AND p_base_returned_m > 0 THEN
    INSERT INTO public.contractor_material_custody_movements(
      service_order_id,service_order_item_id,contractor_id,base_product_id,movement_type,
      quantity,base_unit_cost_snapshot,production_receipt_id,document_number,occurred_at,
      recorded_by,operation_type,idempotency_key,payload_hash,correlation_id
    ) VALUES(v_line.service_order_id,v_line.id,v_os.contractor_id,v_item.base_product_id,
      'returned',p_base_returned_m,v_base_cost_snapshot,v_receipt.id,p_document_number,
      p_occurred_at,auth.uid(),'custody_return_on_receipt','receipt:'||v_receipt.id||':returned',
      v_hash,p_correlation_id);
  END IF;

  -- Na fabrica, a baixa fisica liquida primeiro as reservas do proprio item.
  -- No terceiro, a remessa ja retirou a reserva da fabrica e a custodia passa a
  -- ser o saldo fisico correspondente, portanto nao se consome reserva outra vez.
  IF p_service_order_item_id IS NULL AND p_base_consumed_m > 0 THEN
    v_reservation_remaining := p_base_consumed_m;
    FOR v_reservation IN
      SELECT r.* FROM public.material_reservations r
       WHERE r.strap_batch_item_id=v_item.id
         AND r.product_id=v_item.base_product_id
         AND r.status IN ('reserved','partially_consumed')
       ORDER BY r.created_at,r.id FOR UPDATE
    LOOP
      EXIT WHEN v_reservation_remaining<=0;
      v_reservation_take:=least(v_reservation_remaining,
        greatest(0,v_reservation.quantity_reserved-v_reservation.quantity_consumed));
      IF v_reservation_take>0 THEN
        UPDATE public.material_reservations SET
          quantity_consumed=quantity_consumed+v_reservation_take,
          status=CASE WHEN quantity_consumed+v_reservation_take>=quantity_reserved
            THEN 'consumed' ELSE 'partially_consumed' END,
          metadata=metadata||jsonb_build_object('last_strap_production_receipt_id',v_receipt.id)
         WHERE id=v_reservation.id;
        v_reservation_remaining:=v_reservation_remaining-v_reservation_take;
      END IF;
    END LOOP;
  END IF;

  v_posted_base := least(coalesce(v_base.quantity,0),p_base_consumed_m);
  IF v_posted_base > 0 THEN
    UPDATE public.products SET quantity=quantity-v_posted_base,current_stock=quantity-v_posted_base
     WHERE id=v_base.id;
    INSERT INTO public.stock_movements(product_id,movement_type,quantity,previous_stock,new_stock,
      description,movement_reason,strap_variant_id,base_product_id,strap_batch_item_id,
      service_order_item_id,strap_production_receipt_id,strap_recipe_id,
      strap_recipe_version_snapshot,origin_type,effective_unit_cost,correlation_id)
    VALUES(v_base.id,'out',v_posted_base,v_base.quantity,v_base.quantity-v_posted_base,
      'Consumo de napa no recebimento de tira','consumo_op',v_item.strap_variant_id,
      v_base.id,v_item.id,p_service_order_item_id,v_receipt.id,v_item.recipe_id,
      v_item.recipe_version_snapshot,
      CASE WHEN p_service_order_item_id IS NULL THEN 'internal_factory' ELSE 'internal_contractor' END,
      v_base_cost_snapshot,p_correlation_id);
  END IF;
  IF v_posted_base < p_base_consumed_m THEN
    INSERT INTO public.strap_pending_reconciliations(reconciliation_type,product_id,
      strap_variant_id,production_receipt_id,expected_quantity,posted_quantity,correlation_id)
    VALUES('base_stock_deficit',v_base.id,v_item.strap_variant_id,v_receipt.id,
      p_base_consumed_m,v_posted_base,p_correlation_id);
  END IF;

  IF v_base_for_rejected>0 THEN
    INSERT INTO public.strap_pending_reconciliations(reconciliation_type,product_id,
      strap_variant_id,production_receipt_id,expected_quantity,posted_quantity,correlation_id)
    VALUES('rejected_base_review',v_base.id,v_item.strap_variant_id,v_receipt.id,
      v_base_for_rejected,0,p_correlation_id);
  END IF;

  IF p_approved_m > 0 THEN
    v_finished_unit_cost := (v_base_for_approved*v_base_cost_snapshot/p_approved_m)
      + coalesce(v_transform_cost,0);
    v_new_finished := coalesce(v_finished.quantity,0)+p_approved_m;
    v_new_wac := CASE WHEN v_new_finished>0 THEN
      ((coalesce(v_finished.quantity,0)*coalesce(v_finished.unit_price,0))
       +(p_approved_m*v_finished_unit_cost))/v_new_finished ELSE v_finished_unit_cost END;
    UPDATE public.products SET quantity=v_new_finished,current_stock=v_new_finished,
      unit_price=v_new_wac WHERE id=v_finished.id;
    INSERT INTO public.stock_movements(product_id,movement_type,quantity,previous_stock,new_stock,
      description,movement_reason,strap_variant_id,base_product_id,finished_product_id,
      strap_batch_item_id,service_order_item_id,strap_production_receipt_id,
      strap_recipe_id,strap_recipe_version_snapshot,origin_type,effective_unit_cost,correlation_id)
    VALUES(v_finished.id,'in',p_approved_m,v_finished.quantity,v_new_finished,
      'Entrada aprovada de producao de tira','ajuste',v_item.strap_variant_id,v_base.id,
      v_finished.id,v_item.id,p_service_order_item_id,v_receipt.id,v_item.recipe_id,
      v_item.recipe_version_snapshot,
      CASE WHEN p_service_order_item_id IS NULL THEN 'internal_factory' ELSE 'internal_contractor' END,
      v_finished_unit_cost,p_correlation_id);
  END IF;

  v_remaining := p_approved_m;
  IF p_allocations IS NULL THEN
    -- Sugestao normativa: prazo/prioridade. A UI pode revisar enviando o
    -- payload explicito; sem payload, este continua sendo o default canonico.
    FOR v_contribution IN
      SELECT c.* FROM public.strap_production_batch_contributions c
       WHERE c.batch_item_id=v_item.id
         AND c.status IN ('planned','in_progress','partial','suspended')
         AND (p_service_order_item_id IS NULL OR c.service_order_item_id=p_service_order_item_id)
       ORDER BY c.priority,c.created_at,c.id FOR UPDATE
    LOOP
      EXIT WHEN v_remaining<=0;
      v_take:=least(v_remaining,greatest(0,v_contribution.planned_m-v_contribution.delivered_m));
      IF v_take>0 THEN
        INSERT INTO public.strap_production_receipt_allocations(
          production_receipt_id,batch_contribution_id,approved_m)
        VALUES(v_receipt.id,v_contribution.id,v_take)
        RETURNING id INTO v_receipt_allocation_id;
        UPDATE public.strap_production_batch_contributions SET delivered_m=delivered_m+v_take,
          status=CASE WHEN delivered_m+v_take>=planned_m THEN 'fulfilled'
            WHEN status='suspended' THEN 'suspended' ELSE 'partial' END,
          correlation_id=p_correlation_id WHERE id=v_contribution.id;
        v_applied_allocations:=v_applied_allocations||jsonb_build_array(jsonb_build_object(
          'receipt_allocation_id',v_receipt_allocation_id,
          'contribution_id',v_contribution.id,'approved_m',v_take,'mode','suggested'));
        v_remaining:=v_remaining-v_take;
      END IF;
    END LOOP;
  ELSE
    FOR v_allocation IN
      SELECT x.value FROM jsonb_array_elements(p_allocations) WITH ORDINALITY x(value,ord)
       ORDER BY x.ord
    LOOP
      v_contribution_id:=(v_allocation->>'contribution_id')::uuid;
      v_take:=(v_allocation->>'approved_m')::numeric;
      SELECT * INTO v_contribution FROM public.strap_production_batch_contributions
       WHERE id=v_contribution_id FOR UPDATE;
      INSERT INTO public.strap_production_receipt_allocations(
        production_receipt_id,batch_contribution_id,approved_m)
      VALUES(v_receipt.id,v_contribution.id,v_take)
      RETURNING id INTO v_receipt_allocation_id;
      UPDATE public.strap_production_batch_contributions SET delivered_m=delivered_m+v_take,
        status=CASE WHEN delivered_m+v_take>=planned_m THEN 'fulfilled'
          WHEN status='suspended' THEN 'suspended' ELSE 'partial' END,
        correlation_id=p_correlation_id WHERE id=v_contribution.id;
      v_applied_allocations:=v_applied_allocations||jsonb_build_array(jsonb_build_object(
        'receipt_allocation_id',v_receipt_allocation_id,
        'contribution_id',v_contribution.id,'approved_m',v_take,'mode','operator'));
      v_remaining:=v_remaining-v_take;
    END LOOP;
  END IF;
  -- O aprovado excedente permanece no estoque acabado como saldo livre. Apenas
  -- a parte coberta pelo planejamento e vinculada a contribuicoes.

  SELECT NOT EXISTS(
    SELECT 1 FROM public.strap_production_batch_contributions c
     WHERE c.batch_item_id=v_item.id
       AND c.status NOT IN ('fulfilled','cancelled','superseded')
  ) INTO v_item_complete;
  UPDATE public.strap_production_batch_items SET
    delivered_m=delivered_m+p_delivered_m,approved_m=approved_m+p_approved_m,
    rejected_m=rejected_m+p_rejected_m,base_consumed_m=base_consumed_m+p_base_consumed_m,
    started_at=coalesce(started_at,p_occurred_at),
    completed_at=CASE WHEN v_item_complete THEN coalesce(completed_at,p_occurred_at) ELSE NULL END,
    status=CASE WHEN v_item_complete THEN 'completed'
      WHEN v_item_was_suspended THEN 'suspended' ELSE 'partial' END
   WHERE id=v_item.id;

  -- Ao atender todas as contribuicoes, qualquer napa ainda reservada para o
  -- item deixa de ser compromisso. Libera somente o saldo nao consumido e
  -- preserva o consumo historico na propria reserva.
  IF v_item_complete THEN
    UPDATE public.material_reservations SET
      quantity_reserved=quantity_consumed,
      status=CASE WHEN quantity_consumed>0 THEN 'consumed' ELSE 'cancelled' END,
      notes=coalesce(notes,'')||' | saldo liberado apos conclusao do item de tira',
      metadata=metadata||jsonb_build_object(
        'released_after_strap_completion',true,
        'completion_receipt_id',v_receipt.id,
        'correlation_id',p_correlation_id)
     WHERE strap_batch_item_id=v_item.id
       AND source='strap_engine_base'
       AND status IN ('reserved','partially_consumed');
  END IF;

  IF p_service_order_item_id IS NOT NULL THEN
    UPDATE public.service_order_items SET delivered_qty=coalesce(delivered_qty,0)+p_approved_m,
      delivered_at=CASE WHEN coalesce(delivered_qty,0)+p_approved_m>=coalesce(meters,0)
          AND coalesce(v_balance,0)-p_base_consumed_m-p_base_returned_m<=0.000001
        THEN p_occurred_at ELSE delivered_at END,
      line_status=CASE WHEN coalesce(delivered_qty,0)+p_approved_m>=coalesce(meters,0)
          AND coalesce(v_balance,0)-p_base_consumed_m-p_base_returned_m<=0.000001
        THEN 'Entregue' WHEN v_line_was_suspended THEN 'Suspensa' ELSE 'Parcial' END
     WHERE id=v_line.id;
    IF p_approved_m>0 THEN
      v_cycle:=public.resolve_contractor_payment_cycle(v_os.contractor_id,p_occurred_at);
      SELECT c.schedule_version_id,s.timezone INTO v_schedule,v_schedule_timezone
        FROM public.contractor_payment_cycles c
        JOIN public.contractor_payment_schedules s ON s.id=c.schedule_version_id
       WHERE c.id=v_cycle;
      INSERT INTO public.contractor_accruals(contractor_id,schedule_version_id,payment_cycle_id,
        production_receipt_id,service_order_id,service_order_item_id,accepted_m,
        transformation_cost_per_m_snapshot,accrual_date,status,idempotency_key,payload_hash,correlation_id)
      VALUES(v_os.contractor_id,v_schedule,v_cycle,v_receipt.id,v_line.service_order_id,v_line.id,
        p_approved_m,coalesce(v_transform_cost,0),
        (p_occurred_at AT TIME ZONE v_schedule_timezone)::date,'open',
        'receipt:'||v_receipt.id,v_hash,p_correlation_id);
    END IF;
  END IF;

  SELECT NOT EXISTS(
    SELECT 1 FROM public.strap_production_batch_items x
     WHERE x.batch_id=v_batch.id AND x.status NOT IN ('completed','cancelled')
  ) INTO v_batch_complete;
  UPDATE public.strap_production_batches b SET
    started_at=coalesce(started_at,p_occurred_at),
    completed_at=CASE WHEN v_batch_complete THEN coalesce(completed_at,p_occurred_at) ELSE NULL END,
    status=CASE WHEN v_batch_complete THEN 'completed'
      WHEN v_batch_was_suspended THEN 'suspended' ELSE 'partial' END
   WHERE b.id=v_batch.id;

  PERFORM public.reconcile_strap_variant(v_item.strap_variant_id,p_correlation_id,'production_receipt');
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('strap_production_receipt',v_receipt.id,'receive',v_before,
    to_jsonb(v_receipt)||jsonb_build_object(
      'base_stock_m',(SELECT quantity FROM public.products WHERE id=v_base.id),
      'finished_stock_m',(SELECT quantity FROM public.products WHERE id=v_finished.id),
      'batch_item_status',(SELECT status FROM public.strap_production_batch_items WHERE id=v_item.id),
      'applied_allocations',v_applied_allocations,
      'free_finished_m',greatest(v_remaining,0)),
    coalesce(nullif(btrim(p_notes),''),'Recebimento parcial de producao'),
    p_correlation_id,auth.uid());
  IF p_service_order_item_id IS NOT NULL THEN
    PERFORM public.reconcile_strap_service_order_completion(v_line.id,p_correlation_id,
      coalesce(nullif(btrim(p_notes),''),'Reconciliacao apos recebimento de producao'));
  END IF;
  RETURN jsonb_build_object('receipt_id',v_receipt.id,'approved_m',p_approved_m,
    'rejected_m',p_rejected_m,'base_posted_m',v_posted_base,
    'free_finished_m',greatest(v_remaining,0),
    'applied_allocations',v_applied_allocations,
    'finished_unit_cost',CASE WHEN public.can_see_strap_financial_values()
      THEN v_finished_unit_cost ELSE NULL END,'correlation_id',p_correlation_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. Ciclo operacional de lote e guarda de encerramento da custodia
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.start_strap_production_batch(
  p_batch_id uuid,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_batch public.strap_production_batches%ROWTYPE;
  v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.has_artisanal_strap_capability('execute_strap_batch') THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo do inicio e obrigatorio'; END IF;
  SELECT * INTO v_batch FROM public.strap_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote nao encontrado'; END IF;
  IF v_batch.status IN ('in_progress','partial') THEN
    RETURN jsonb_build_object('batch_id',v_batch.id,'replayed',true,'status',v_batch.status);
  END IF;
  IF v_batch.status NOT IN ('draft','planned') THEN RAISE EXCEPTION 'Estado do lote nao permite inicio'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.strap_production_batch_items i
    WHERE i.batch_id=v_batch.id AND i.scheduled_m>0) THEN RAISE EXCEPTION 'Lote sem metragem programada'; END IF;
  IF v_batch.executor_type='contractor' AND EXISTS(
    SELECT 1 FROM public.service_order_items soi
    JOIN public.strap_production_batch_items bi ON bi.id=soi.strap_batch_item_id
    WHERE bi.batch_id=v_batch.id AND soi.sent_at IS NULL AND soi.line_status<>'Cancelado'
  ) THEN RAISE EXCEPTION 'Envie a napa de todas as linhas antes de iniciar lote terceirizado'; END IF;
  SELECT jsonb_build_object(
      'batch',to_jsonb(v_batch),
      'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
        FROM public.strap_production_batch_items i WHERE i.batch_id=v_batch.id),'[]'::jsonb),
      'contributions',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id)
        FROM public.strap_production_batch_contributions c
        JOIN public.strap_production_batch_items i ON i.id=c.batch_item_id
        WHERE i.batch_id=v_batch.id),'[]'::jsonb))
    INTO v_before;
  UPDATE public.strap_production_batches SET status='in_progress',started_at=coalesce(started_at,now()),
    correlation_id=p_correlation_id WHERE id=v_batch.id;
  UPDATE public.strap_production_batch_items SET status='in_progress',started_at=coalesce(started_at,now())
   WHERE batch_id=v_batch.id AND status IN ('draft','planned');
  UPDATE public.strap_production_batch_contributions c SET status='in_progress',correlation_id=p_correlation_id
   FROM public.strap_production_batch_items bi
   WHERE bi.id=c.batch_item_id AND bi.batch_id=v_batch.id AND c.status='planned';
  SELECT jsonb_build_object(
      'batch',to_jsonb(b),
      'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
        FROM public.strap_production_batch_items i WHERE i.batch_id=b.id),'[]'::jsonb),
      'contributions',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id)
        FROM public.strap_production_batch_contributions c
        JOIN public.strap_production_batch_items i ON i.id=c.batch_item_id
        WHERE i.batch_id=b.id),'[]'::jsonb))
    INTO v_after FROM public.strap_production_batches b WHERE b.id=v_batch.id;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('strap_production_batch',v_batch.id,'update',v_before,v_after,btrim(p_reason),
    p_correlation_id,auth.uid());
  RETURN jsonb_build_object('batch_id',v_batch.id,'status','in_progress','correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.replan_strap_production_batch(
  p_batch_id uuid,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_batch public.strap_production_batches%ROWTYPE; v_item uuid; v_results jsonb:='[]'::jsonb;
  v_executor_type text; v_contract_key text;
  v_before jsonb; v_after jsonb;
BEGIN
  IF NOT public.has_artisanal_strap_capability('execute_strap_batch')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo do replanejamento e obrigatorio'; END IF;
  SELECT b.executor_type,coalesce(b.contractor_id::text,'factory')
    INTO v_executor_type,v_contract_key
    FROM public.strap_production_batches b WHERE b.id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote nao encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(format(
    'strap-schedule:%s:%s',v_executor_type,v_contract_key),0));
  SELECT * INTO v_batch FROM public.strap_production_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote nao encontrado'; END IF;
  IF v_batch.started_at IS NOT NULL OR v_batch.status IN ('in_progress','partial','completed','cancelled') THEN
    RAISE EXCEPTION 'Somente lote ainda nao iniciado pode ser replanejado';
  END IF;
  SELECT jsonb_build_object('batch',to_jsonb(v_batch),'allocations',coalesce(jsonb_agg(
    jsonb_build_object('allocation_id',a.id,'batch_item_id',a.batch_item_id,
      'capacity_bucket_id',a.capacity_bucket_id,'scheduled_m',a.scheduled_m,'status',a.status)
    ORDER BY a.created_at,a.id) FILTER (WHERE a.id IS NOT NULL),'[]'::jsonb))
    INTO v_before
    FROM public.strap_production_batch_items bi
    LEFT JOIN public.strap_executor_daily_capacity_allocations a
      ON a.batch_item_id=bi.id AND a.status='active'
   WHERE bi.batch_id=v_batch.id;
  FOR v_item IN SELECT id FROM public.strap_production_batch_items
    WHERE batch_id=v_batch.id AND status NOT IN ('cancelled','completed') ORDER BY id
  LOOP
    v_results:=v_results||jsonb_build_array(public.schedule_strap_batch_item(
      v_item,p_reason,p_correlation_id));
  END LOOP;
  UPDATE public.strap_production_batches SET correlation_id=p_correlation_id WHERE id=v_batch.id;
  SELECT jsonb_build_object('batch',to_jsonb(b),'allocations',coalesce(jsonb_agg(
    jsonb_build_object('allocation_id',a.id,'batch_item_id',a.batch_item_id,
      'capacity_bucket_id',a.capacity_bucket_id,'scheduled_m',a.scheduled_m,'status',a.status)
    ORDER BY a.created_at,a.id) FILTER (WHERE a.id IS NOT NULL),'[]'::jsonb),
    'results',v_results)
    INTO v_after
    FROM public.strap_production_batches b
    JOIN public.strap_production_batch_items bi ON bi.batch_id=b.id
    LEFT JOIN public.strap_executor_daily_capacity_allocations a
      ON a.batch_item_id=bi.id AND a.status='active'
   WHERE b.id=v_batch.id
   GROUP BY b.id;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('strap_production_batch',v_batch.id,'reconcile',v_before,v_after,
    btrim(p_reason),p_correlation_id,auth.uid());
  RETURN jsonb_build_object('batch_id',v_batch.id,'items',v_results,'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_strap_operation(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_batch public.strap_production_batches%ROWTYPE; v_variants uuid[]; v_variant uuid;
  v_executor_type text; v_contract_key text;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Somente Administrador'; END IF;
  IF p_entity_type<>'batch' THEN RAISE EXCEPTION 'Cancelamento canonico aceita entity_type=batch'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatorio'; END IF;
  SELECT b.executor_type,coalesce(b.contractor_id::text,'factory')
    INTO v_executor_type,v_contract_key
    FROM public.strap_production_batches b WHERE b.id=p_entity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote nao encontrado'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(format(
    'strap-schedule:%s:%s',v_executor_type,v_contract_key),0));
  SELECT * INTO v_batch FROM public.strap_production_batches WHERE id=p_entity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote nao encontrado'; END IF;
  IF v_batch.status='cancelled' THEN RETURN jsonb_build_object('batch_id',v_batch.id,'replayed',true); END IF;
  IF v_batch.started_at IS NOT NULL OR EXISTS(
    SELECT 1 FROM public.strap_production_receipts r
    LEFT JOIN public.service_order_items soi ON soi.id=r.service_order_item_id
    JOIN public.strap_production_batch_items bi ON bi.id=coalesce(r.batch_item_id,soi.strap_batch_item_id)
    WHERE bi.batch_id=v_batch.id
  ) OR EXISTS(
    SELECT 1 FROM public.service_order_items soi
    JOIN public.strap_production_batch_items bi ON bi.id=soi.strap_batch_item_id
    WHERE bi.batch_id=v_batch.id AND soi.sent_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'Lote com fato fisico exige suspensao/estorno, nao cancelamento'; END IF;
  SELECT array_agg(DISTINCT bi.strap_variant_id) INTO v_variants
    FROM public.strap_production_batch_items bi WHERE bi.batch_id=v_batch.id;
  UPDATE public.sale_order_strap_demands d SET suspended_from_status=d.status,status='suspended',
    suspension_reason=p_reason,suspended_by=auth.uid(),suspended_at=now(),correlation_id=p_correlation_id
   WHERE d.id IN (SELECT c.sale_order_strap_demand_id
    FROM public.strap_production_batch_contributions c
    JOIN public.strap_production_batch_items bi ON bi.id=c.batch_item_id
    WHERE bi.batch_id=v_batch.id AND c.sale_order_strap_demand_id IS NOT NULL)
    AND d.status NOT IN ('fulfilled','cancelled','superseded');
  UPDATE public.strap_stock_floor_contributions f SET suspended_from_status=f.status,status='suspended',
    suspension_reason=p_reason,suspended_by=auth.uid(),suspended_at=now(),correlation_id=p_correlation_id
   WHERE f.id IN (SELECT c.stock_floor_contribution_id
    FROM public.strap_production_batch_contributions c
    JOIN public.strap_production_batch_items bi ON bi.id=c.batch_item_id
    WHERE bi.batch_id=v_batch.id AND c.stock_floor_contribution_id IS NOT NULL)
    AND f.status NOT IN ('fulfilled','cancelled','superseded');
  UPDATE public.material_reservations r SET status='cancelled',notes=coalesce(notes,'')||' | '||p_reason
   WHERE r.strap_batch_item_id IN (SELECT id FROM public.strap_production_batch_items WHERE batch_id=v_batch.id)
     AND r.status IN ('reserved','partially_consumed');
  UPDATE public.strap_executor_daily_capacity_allocations a SET status='cancelled'
   WHERE a.batch_item_id IN (SELECT id FROM public.strap_production_batch_items WHERE batch_id=v_batch.id)
     AND a.status='active';
  UPDATE public.service_order_items soi SET line_status='Cancelado'
   WHERE soi.strap_batch_item_id IN (SELECT id FROM public.strap_production_batch_items WHERE batch_id=v_batch.id)
     AND soi.sent_at IS NULL;
  UPDATE public.service_orders so SET status='Cancelado'
   WHERE EXISTS(SELECT 1 FROM public.service_order_items soi
      JOIN public.strap_production_batch_items bi ON bi.id=soi.strap_batch_item_id
      WHERE soi.service_order_id=so.id AND bi.batch_id=v_batch.id)
     AND NOT EXISTS(SELECT 1 FROM public.service_order_items x
      WHERE x.service_order_id=so.id AND x.line_status NOT IN ('Cancelado','Entregue'));
  UPDATE public.strap_production_batch_contributions c SET status='cancelled',correlation_id=p_correlation_id
   FROM public.strap_production_batch_items bi
   WHERE bi.id=c.batch_item_id AND bi.batch_id=v_batch.id
     AND c.status IN ('planned','suspended');
  UPDATE public.strap_production_batch_items SET status='cancelled'
   WHERE batch_id=v_batch.id AND status NOT IN ('completed','cancelled');
  UPDATE public.strap_production_batches SET status='cancelled',suspension_reason=p_reason,
    correlation_id=p_correlation_id WHERE id=v_batch.id;
  FOREACH v_variant IN ARRAY coalesce(v_variants,ARRAY[]::uuid[]) LOOP
    PERFORM public.reconcile_strap_variant(v_variant,p_correlation_id,'batch_cancelled');
  END LOOP;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('strap_production_batch',v_batch.id,'cancel',to_jsonb(v_batch),
    jsonb_build_object('status','cancelled'),p_reason,p_correlation_id,auth.uid());
  RETURN jsonb_build_object('batch_id',v_batch.id,'status','cancelled','correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_strap_service_order_custody_zero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.strap_variant_id IS NOT NULL AND NEW.line_status='Entregue'
     AND OLD.line_status IS DISTINCT FROM NEW.line_status
     AND (EXISTS(SELECT 1 FROM public.v_contractor_material_custody_balances b
       WHERE b.service_order_item_id=NEW.id AND abs(b.balance_in_custody)>0.000001)
       OR EXISTS(SELECT 1 FROM public.contractor_loss_claims cl
         WHERE cl.service_order_item_id=NEW.id AND cl.status='pending')) THEN
    RAISE EXCEPTION 'Linha de OS nao pode encerrar com custodia ou perda pendente';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_strap_service_order_item_custody ON public.service_order_items;
CREATE TRIGGER trg_guard_strap_service_order_item_custody
  BEFORE UPDATE OF line_status ON public.service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_service_order_custody_zero();

CREATE OR REPLACE FUNCTION public.tg_guard_strap_service_order_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(btrim(coalesce(NEW.status,''))) IN ('concluído','concluido','finalizado','received')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS(SELECT 1 FROM public.service_order_items soi
       WHERE soi.service_order_id=NEW.id AND soi.strap_variant_id IS NOT NULL
         AND (soi.line_status<>'Entregue' OR EXISTS(
           SELECT 1 FROM public.v_contractor_material_custody_balances b
            WHERE b.service_order_item_id=soi.id AND abs(b.balance_in_custody)>0.000001)
           OR EXISTS(SELECT 1 FROM public.contractor_loss_claims cl
             WHERE cl.service_order_item_id=soi.id AND cl.status='pending'))) THEN
    RAISE EXCEPTION 'OS de tiras possui linha aberta, custodia ou perda pendente';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_strap_service_order_close ON public.service_orders;
CREATE TRIGGER trg_guard_strap_service_order_close
  BEFORE UPDATE OF status ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_service_order_close();

-- -----------------------------------------------------------------------------
-- 12. Suspensao administrativa atomica (estado inteiro, nunca item solto)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.suspend_strap_operation(
  p_entity_type text,
  p_entity_id uuid,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_before jsonb; v_after jsonb; v_variant uuid; v_po public.purchase_orders%ROWTYPE;
  v_executor_type text; v_contract_key text;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode suspender';
  END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatorio'; END IF;

  IF p_entity_type='batch' THEN
    SELECT b.executor_type,coalesce(b.contractor_id::text,'factory')
      INTO v_executor_type,v_contract_key
      FROM public.strap_production_batches b WHERE b.id=p_entity_id;
  ELSIF p_entity_type='batch_item' THEN
    SELECT b.executor_type,coalesce(b.contractor_id::text,'factory')
      INTO v_executor_type,v_contract_key
      FROM public.strap_production_batch_items bi
      JOIN public.strap_production_batches b ON b.id=bi.batch_id
     WHERE bi.id=p_entity_id;
  END IF;
  IF v_executor_type IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(format(
      'strap-schedule:%s:%s',v_executor_type,v_contract_key),0));
  END IF;

  CASE p_entity_type
    WHEN 'demand' THEN
      SELECT to_jsonb(d), d.strap_variant_id INTO v_before,v_variant
        FROM public.sale_order_strap_demands d WHERE d.id=p_entity_id FOR UPDATE;
      UPDATE public.sale_order_strap_demands SET suspended_from_status=status,status='suspended',
        suspension_reason=p_reason,suspended_by=auth.uid(),suspended_at=now(),correlation_id=p_correlation_id
       WHERE id=p_entity_id AND status NOT IN ('cancelled','superseded','fulfilled','suspended')
       RETURNING to_jsonb(sale_order_strap_demands.*) INTO v_after;
    WHEN 'stock_floor' THEN
      SELECT to_jsonb(f), f.strap_variant_id INTO v_before,v_variant
        FROM public.strap_stock_floor_contributions f WHERE f.id=p_entity_id FOR UPDATE;
      UPDATE public.strap_stock_floor_contributions SET suspended_from_status=status,status='suspended',
        suspension_reason=p_reason,suspended_by=auth.uid(),suspended_at=now(),correlation_id=p_correlation_id
       WHERE id=p_entity_id AND status NOT IN ('cancelled','superseded','fulfilled','suspended')
       RETURNING to_jsonb(strap_stock_floor_contributions.*) INTO v_after;
    WHEN 'batch' THEN
      SELECT to_jsonb(b) INTO v_before FROM public.strap_production_batches b WHERE b.id=p_entity_id FOR UPDATE;
      UPDATE public.strap_production_batches SET suspended_from_status=status,status='suspended',
        suspension_reason=p_reason,suspended_by=auth.uid(),suspended_at=now(),correlation_id=p_correlation_id
       WHERE id=p_entity_id AND status NOT IN ('completed','cancelled','suspended')
       RETURNING to_jsonb(strap_production_batches.*) INTO v_after;
    WHEN 'batch_item' THEN
      SELECT to_jsonb(i),i.strap_variant_id INTO v_before,v_variant
        FROM public.strap_production_batch_items i WHERE i.id=p_entity_id FOR UPDATE;
      UPDATE public.strap_production_batch_items SET status='suspended'
       WHERE id=p_entity_id AND status NOT IN ('completed','cancelled','suspended')
       RETURNING to_jsonb(strap_production_batch_items.*) INTO v_after;
    WHEN 'service_order_item' THEN
      SELECT to_jsonb(i),i.strap_variant_id INTO v_before,v_variant
        FROM public.service_order_items i WHERE i.id=p_entity_id FOR UPDATE;
      UPDATE public.service_order_items SET suspended_from_status=line_status,line_status='Suspensa',
        suspension_reason=p_reason,suspended_by=auth.uid(),suspended_at=now()
       WHERE id=p_entity_id AND line_status NOT IN ('Entregue','Cancelado','Suspensa')
       RETURNING to_jsonb(service_order_items.*) INTO v_after;
    WHEN 'purchase_contribution' THEN
      RAISE EXCEPTION 'Suspensao de compra e sempre da OC inteira; use entity_type=purchase_order';
    WHEN 'purchase_order' THEN
      PERFORM set_config('app.strap_po_suspend','1',true);
      SELECT * INTO v_po FROM public.purchase_orders
       WHERE id=p_entity_id AND source_type='strap_demand' FOR UPDATE;
      IF FOUND THEN v_before:=to_jsonb(v_po); END IF;
      UPDATE public.purchase_orders SET suspended_from_status=status,status='suspended',
        suspension_reason=btrim(p_reason),suspended_by=auth.uid(),suspended_at=now()
       WHERE id=p_entity_id AND source_type='strap_demand'
         AND snapshot_locked_at IS NULL AND status IN ('draft','pending','Pendente')
       RETURNING to_jsonb(purchase_orders.*) INTO v_after;
      UPDATE public.purchase_demand_contributions SET
        suspended_from_status=status,status='suspended',suspension_reason=btrim(p_reason),
        correlation_id=p_correlation_id
       WHERE purchase_order_id=p_entity_id AND status IN ('proposed','awaiting_approval');
      UPDATE public.strap_purchase_cashflow_installments SET status='cancelled',updated_at=now(),
        correlation_id=p_correlation_id
       WHERE purchase_order_id=p_entity_id AND layer='forecast' AND status='open';
    ELSE RAISE EXCEPTION 'entity_type invalido';
  END CASE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Entidade nao encontrada'; END IF;
  IF v_after IS NULL THEN RAISE EXCEPTION 'Estado atual nao permite suspensao'; END IF;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES(p_entity_type,p_entity_id,'suspend',v_before,v_after,p_reason,p_correlation_id,auth.uid());
  IF v_variant IS NOT NULL THEN PERFORM public.reconcile_strap_variant(v_variant,p_correlation_id,'suspended'); END IF;
  RETURN jsonb_build_object('entity_type',p_entity_type,'entity_id',p_entity_id,'status','suspended');
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_strap_operation(
  p_entity_type text,
  p_entity_id uuid,
  p_correlation_id uuid DEFAULT gen_random_uuid(),
  p_reason text DEFAULT 'Retomada administrativa apos saneamento'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_before jsonb; v_after jsonb; v_variant uuid;
  v_po public.purchase_orders%ROWTYPE; v_target public.purchase_orders%ROWTYPE;
  v_executor_type text; v_contract_key text;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode retomar';
  END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatorio'; END IF;
  IF p_entity_type='batch' THEN
    SELECT b.executor_type,coalesce(b.contractor_id::text,'factory')
      INTO v_executor_type,v_contract_key
      FROM public.strap_production_batches b WHERE b.id=p_entity_id;
  ELSIF p_entity_type='batch_item' THEN
    SELECT b.executor_type,coalesce(b.contractor_id::text,'factory')
      INTO v_executor_type,v_contract_key
      FROM public.strap_production_batch_items bi
      JOIN public.strap_production_batches b ON b.id=bi.batch_id
     WHERE bi.id=p_entity_id;
  END IF;
  IF v_executor_type IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(format(
      'strap-schedule:%s:%s',v_executor_type,v_contract_key),0));
  END IF;
  CASE p_entity_type
    WHEN 'demand' THEN
      SELECT to_jsonb(d),d.strap_variant_id INTO v_before,v_variant
        FROM public.sale_order_strap_demands d WHERE d.id=p_entity_id FOR UPDATE;
      UPDATE public.sale_order_strap_demands SET status=coalesce(suspended_from_status,'pending'),
        suspended_from_status=NULL,suspension_reason=NULL,suspended_by=NULL,suspended_at=NULL,
        correlation_id=p_correlation_id WHERE id=p_entity_id AND status='suspended'
       RETURNING to_jsonb(sale_order_strap_demands.*) INTO v_after;
    WHEN 'stock_floor' THEN
      SELECT to_jsonb(f),f.strap_variant_id INTO v_before,v_variant
        FROM public.strap_stock_floor_contributions f WHERE f.id=p_entity_id FOR UPDATE;
      UPDATE public.strap_stock_floor_contributions SET status=coalesce(suspended_from_status,'pending'),
        suspended_from_status=NULL,suspension_reason=NULL,suspended_by=NULL,suspended_at=NULL,
        correlation_id=p_correlation_id WHERE id=p_entity_id AND status='suspended'
       RETURNING to_jsonb(strap_stock_floor_contributions.*) INTO v_after;
    WHEN 'batch' THEN
      SELECT to_jsonb(b) INTO v_before FROM public.strap_production_batches b WHERE b.id=p_entity_id FOR UPDATE;
      UPDATE public.strap_production_batches SET status=coalesce(suspended_from_status,'planned'),
        suspended_from_status=NULL,suspension_reason=NULL,suspended_by=NULL,suspended_at=NULL,
        correlation_id=p_correlation_id WHERE id=p_entity_id AND status='suspended'
       RETURNING to_jsonb(strap_production_batches.*) INTO v_after;
    WHEN 'batch_item' THEN
      SELECT to_jsonb(i),i.strap_variant_id INTO v_before,v_variant
        FROM public.strap_production_batch_items i WHERE i.id=p_entity_id FOR UPDATE;
      UPDATE public.strap_production_batch_items SET status=CASE WHEN started_at IS NULL THEN 'planned' ELSE 'partial' END
       WHERE id=p_entity_id AND status='suspended'
       RETURNING to_jsonb(strap_production_batch_items.*) INTO v_after;
    WHEN 'service_order_item' THEN
      SELECT to_jsonb(i),i.strap_variant_id INTO v_before,v_variant
        FROM public.service_order_items i WHERE i.id=p_entity_id FOR UPDATE;
      UPDATE public.service_order_items SET line_status=coalesce(suspended_from_status,'Pendente'),
        suspended_from_status=NULL,suspension_reason=NULL,suspended_by=NULL,suspended_at=NULL
       WHERE id=p_entity_id AND line_status='Suspensa'
       RETURNING to_jsonb(service_order_items.*) INTO v_after;
    WHEN 'purchase_contribution' THEN
      RAISE EXCEPTION 'Reabertura de compra e sempre da OC inteira; use entity_type=purchase_order';
    WHEN 'purchase_order' THEN
      PERFORM set_config('app.strap_po_suspend','1',true);
      SELECT * INTO v_po FROM public.purchase_orders
       WHERE id=p_entity_id AND source_type='strap_demand' FOR UPDATE;
      IF FOUND THEN v_before:=to_jsonb(v_po); END IF;
      IF v_po.status='suspended' THEN
        SELECT * INTO v_target FROM public.purchase_orders po
         WHERE po.id<>v_po.id AND po.source_type='strap_demand'
           AND po.supplier_id IS NOT DISTINCT FROM v_po.supplier_id
           AND po.billing_year=v_po.billing_year AND po.billing_month=v_po.billing_month
           AND po.billing_fortnight=v_po.billing_fortnight
           AND po.provisional=v_po.provisional
           AND po.status IN ('draft','pending','Pendente') AND po.snapshot_locked_at IS NULL
         ORDER BY po.created_at,po.id FOR UPDATE LIMIT 1;
        IF v_target.id IS NOT NULL THEN
          UPDATE public.purchase_demand_contributions SET
            superseded_purchase_order_id=purchase_order_id,
            superseded_purchase_order_item_id=purchase_order_item_id,
            purchase_order_id=NULL,purchase_order_item_id=NULL,status='proposed',
            suspended_from_status=NULL,suspension_reason=NULL,correlation_id=p_correlation_id
           WHERE purchase_order_id=v_po.id AND status='suspended';
          UPDATE public.purchase_orders SET status='cancelled',cancelled_at=now(),
            suspension_reason='Reaberta e fundida na OC '||v_target.order_number
           WHERE id=v_po.id RETURNING to_jsonb(purchase_orders.*) INTO v_after;
        ELSE
          UPDATE public.purchase_orders SET
            status=CASE WHEN provisional THEN 'draft' ELSE 'pending' END,
            suspended_from_status=NULL,suspension_reason=NULL,suspended_by=NULL,suspended_at=NULL
           WHERE id=v_po.id RETURNING to_jsonb(purchase_orders.*) INTO v_after;
          UPDATE public.purchase_demand_contributions SET status='awaiting_approval',
            suspended_from_status=NULL,suspension_reason=NULL,correlation_id=p_correlation_id
           WHERE purchase_order_id=v_po.id AND status='suspended';
        END IF;
        PERFORM public.materialize_strap_purchase_orders(500,p_correlation_id);
      END IF;
    ELSE RAISE EXCEPTION 'entity_type invalido';
  END CASE;
  IF v_before IS NULL THEN RAISE EXCEPTION 'Entidade nao encontrada'; END IF;
  IF v_after IS NULL THEN RAISE EXCEPTION 'Entidade nao esta suspensa'; END IF;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES(p_entity_type,p_entity_id,'resume',v_before,v_after,
    btrim(p_reason),p_correlation_id,auth.uid());
  IF v_variant IS NOT NULL THEN PERFORM public.reconcile_strap_variant(v_variant,p_correlation_id,'resumed'); END IF;
  RETURN jsonb_build_object('entity_type',p_entity_type,'entity_id',p_entity_id,'status','resumed');
END;
$$;

CREATE OR REPLACE FUNCTION public.request_strap_rework_material(
  p_service_order_item_id uuid,
  p_requested_m numeric,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_line public.service_order_items%ROWTYPE; v_os public.service_orders%ROWTYPE;
  v_hash text; v_id uuid; v_replayed boolean:=false;
BEGIN
  IF NOT public.has_artisanal_strap_capability('execute_strap_batch')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF coalesce(p_requested_m,0)<=0 OR nullif(btrim(p_reason),'') IS NULL
     OR nullif(btrim(p_idempotency_key),'') IS NULL THEN
    RAISE EXCEPTION 'Quantidade, motivo e idempotency_key sao obrigatorios';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-idempotency:'||p_idempotency_key,0));
  PERFORM public.lock_strap_physical_operation_scope(p_service_order_item_id,NULL);
  SELECT * INTO v_line FROM public.service_order_items
   WHERE id=p_service_order_item_id FOR UPDATE;
  IF NOT FOUND OR v_line.strap_batch_item_id IS NULL THEN RAISE EXCEPTION 'Linha de OS de tira nao encontrada'; END IF;
  SELECT * INTO v_os FROM public.service_orders WHERE id=v_line.service_order_id;
  IF v_os.contractor_id IS NULL OR NOT EXISTS(SELECT 1
    FROM public.contractor_material_custody_movements m
    WHERE m.service_order_item_id=v_line.id AND m.movement_type='sent') THEN
    RAISE EXCEPTION 'Retrabalho adicional exige OS terceirizada com remessa anterior';
  END IF;
  v_hash:=public.strap_payload_hash(jsonb_build_object('service_order_item_id',v_line.id,
    'requested_m',p_requested_m,'reason',btrim(p_reason)));
  INSERT INTO public.strap_rework_material_requests(
    service_order_item_id,batch_item_id,contractor_id,base_product_id,
    requested_m,reason,requested_by,idempotency_key,payload_hash,correlation_id)
  VALUES(v_line.id,v_line.strap_batch_item_id,v_os.contractor_id,v_line.base_product_id,
    p_requested_m,btrim(p_reason),auth.uid(),p_idempotency_key,v_hash,p_correlation_id)
  ON CONFLICT(operation_type,idempotency_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    v_replayed:=true;
    SELECT id INTO v_id FROM public.strap_rework_material_requests
     WHERE operation_type='strap_rework_material_request' AND idempotency_key=p_idempotency_key
       AND payload_hash=v_hash;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Replay idempotente divergente'; END IF;
  END IF;
  IF NOT v_replayed THEN
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    SELECT 'strap_rework_material_request',r.id,'insert',
      jsonb_build_object('service_order_item_id',v_line.id),to_jsonb(r),
      btrim(p_reason),p_correlation_id,auth.uid()
    FROM public.strap_rework_material_requests r WHERE r.id=v_id;
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_strap_rework_material_request(
  p_request_id uuid,
  p_decision text,
  p_approved_m numeric DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_request public.strap_rework_material_requests%ROWTYPE;
  v_line public.service_order_items%ROWTYPE; v_approved numeric; v_available numeric;
  v_before jsonb; v_scope_service_order_item_id uuid;
BEGIN
  PERFORM set_config('app.strap_engine_write','1',true);
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Somente Administrador pode decidir napa adicional';
  END IF;
  IF p_decision NOT IN ('approved','rejected') OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Decisao e motivo sao obrigatorios';
  END IF;
  SELECT service_order_item_id INTO v_scope_service_order_item_id
    FROM public.strap_rework_material_requests WHERE id=p_request_id;
  IF v_scope_service_order_item_id IS NULL THEN RAISE EXCEPTION 'Solicitacao nao encontrada'; END IF;
  PERFORM public.lock_strap_physical_operation_scope(v_scope_service_order_item_id,NULL);
  SELECT * INTO v_request FROM public.strap_rework_material_requests
   WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitacao nao encontrada'; END IF;
  IF v_request.status=p_decision OR (v_request.status='consumed' AND p_decision='approved') THEN
    RETURN jsonb_build_object('request_id',v_request.id,'status',v_request.status,'replayed',true);
  END IF;
  IF v_request.status<>'pending' THEN RAISE EXCEPTION 'Solicitacao ja decidida'; END IF;
  v_before:=to_jsonb(v_request);
  IF p_decision='rejected' THEN
    UPDATE public.strap_rework_material_requests SET status='rejected',decision_reason=btrim(p_reason),
      decided_by=auth.uid(),decided_at=now(),correlation_id=p_correlation_id
      WHERE id=v_request.id RETURNING * INTO v_request;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('strap_rework_material_request',v_request.id,'reject',v_before,to_jsonb(v_request),
      btrim(p_reason),p_correlation_id,auth.uid());
    RETURN jsonb_build_object('request_id',v_request.id,'status','rejected',
      'correlation_id',p_correlation_id);
  END IF;
  v_approved:=coalesce(p_approved_m,v_request.requested_m);
  IF v_approved<=0 OR v_approved>v_request.requested_m THEN
    RAISE EXCEPTION 'Metragem aprovada deve estar entre zero e a solicitada';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-stock:'||v_request.base_product_id::text,0));
  v_available:=public.strap_base_available_now(v_request.base_product_id);
  IF v_approved>v_available+0.000001 THEN
    RAISE EXCEPTION 'Napa adicional disponivel (%) menor que a autorizacao solicitada (%)',v_available,v_approved;
  END IF;
  SELECT * INTO v_line FROM public.service_order_items WHERE id=v_request.service_order_item_id;
  INSERT INTO public.material_reservations(
    order_id,product_id,quantity_reserved,quantity_consumed,status,reservation_type,
    source,notes,metadata,strap_variant_id,sale_order_strap_demand_id,
    strap_stock_floor_contribution_id,strap_batch_item_id,service_order_item_id,
    base_product_id,correlation_id)
  VALUES(NULL,v_request.base_product_id,v_approved,0,'reserved','soft','strap_engine_base',
    'Napa adicional autorizada para retrabalho',
    jsonb_build_object('rework_material_request_id',v_request.id,'coverage_mode','authorized_rework'),
    v_line.strap_variant_id,v_line.sale_order_strap_demand_id,
    v_line.strap_stock_floor_contribution_id,v_request.batch_item_id,v_line.id,
    v_request.base_product_id,p_correlation_id);
  UPDATE public.strap_rework_material_requests SET status='approved',approved_m=v_approved,
    decision_reason=btrim(p_reason),decided_by=auth.uid(),decided_at=now(),
    correlation_id=p_correlation_id WHERE id=v_request.id RETURNING * INTO v_request;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('strap_rework_material_request',v_request.id,'approve',v_before,to_jsonb(v_request),
    btrim(p_reason),p_correlation_id,auth.uid());
  RETURN jsonb_build_object('request_id',v_request.id,'status','approved',
    'approved_m',v_approved,'correlation_id',p_correlation_id);
END;
$$;

CREATE OR REPLACE VIEW public.v_strap_rework_material_requests_operational
WITH (security_invoker=true)
AS
SELECT r.id AS request_id,r.service_order_item_id,r.batch_item_id,r.contractor_id,
  c.name AS contractor_name,r.base_product_id,p.name AS base_product_name,
  r.requested_m,r.approved_m,r.sent_m,r.reason,r.decision_reason,r.status,
  r.requested_by,r.decided_by,r.decided_at,r.correlation_id,r.created_at,r.updated_at
FROM public.strap_rework_material_requests r
JOIN public.contractors c ON c.id=r.contractor_id
JOIN public.products p ON p.id=r.base_product_id;

GRANT SELECT ON public.v_strap_rework_material_requests_operational TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_strap_rework_material(uuid,numeric,text,text,uuid),
  public.decide_strap_rework_material_request(uuid,text,numeric,text,uuid) TO authenticated;

-- Contrato executavel Req53/61/87/89: reconciliacao e writers fisicos usam o
-- mesmo advisory antes de qualquer row lock. Recebimento externo tambem prova
-- sent_at + movimento sent exato antes de criar estoque/accrual.
DO $$
DECLARE
  v_scope text:=pg_get_functiondef(
    'public.lock_strap_physical_operation_scope(uuid,uuid)'::regprocedure);
  v_global text:=pg_get_functiondef(
    'public.reconcile_strap_variant(uuid,uuid,text)'::regprocedure);
  v_local text:=pg_get_functiondef(
    'public.reconcile_strap_variant_local_202701(uuid,uuid,text)'::regprocedure);
  v_defs text[]:=ARRAY[
    pg_get_functiondef('public.send_strap_material_to_contractor(uuid,numeric,text,text,timestamptz,uuid)'::regprocedure),
    pg_get_functiondef('public.return_strap_material_from_contractor(uuid,numeric,text,text,timestamptz,uuid)'::regprocedure),
    pg_get_functiondef('public.adjust_strap_contractor_custody(uuid,numeric,text,text,timestamptz,uuid)'::regprocedure),
    pg_get_functiondef('public.create_strap_contractor_loss_claim(uuid,numeric,text,text,jsonb,text,uuid,uuid)'::regprocedure),
    pg_get_functiondef('public.decide_strap_contractor_loss_claim(uuid,text,text,uuid)'::regprocedure),
    pg_get_functiondef('public.register_strap_production_receipt(uuid,uuid,numeric,numeric,numeric,numeric,text,numeric,text,timestamptz,text,uuid,jsonb)'::regprocedure),
    pg_get_functiondef('public.request_strap_rework_material(uuid,numeric,text,text,uuid)'::regprocedure),
    pg_get_functiondef('public.decide_strap_rework_material_request(uuid,text,numeric,text,uuid)'::regprocedure)
  ];
  v_def text;
  v_receipt text;
BEGIN
  IF position('strap-base-netting:' IN v_scope)=0
     OR position('strap-variant:' IN v_scope)=0
     OR position('strap-base-netting:' IN v_scope)>=position('strap-variant:' IN v_scope) THEN
    RAISE EXCEPTION 'Ordem advisory fisica divergente da reconciliacao global';
  END IF;
  IF position('strap-base-netting:' IN v_global)=0
     OR position('strap-base-netting:' IN v_global)>=position('FOR UPDATE' IN v_global)
     OR position('strap-variant:' IN v_local)=0
     OR position('strap-variant:' IN v_local)>=position('FOR UPDATE' IN v_local) THEN
    RAISE EXCEPTION 'Reconciliacao adquiriu row lock antes do advisory canonico';
  END IF;
  FOREACH v_def IN ARRAY v_defs LOOP
    IF position('lock_strap_physical_operation_scope' IN v_def)=0
       OR position('lock_strap_physical_operation_scope' IN v_def)
          >=position('FOR UPDATE' IN v_def) THEN
      RAISE EXCEPTION 'Writer fisico adquiriu row lock antes do escopo advisory comum';
    END IF;
  END LOOP;
  v_receipt:=v_defs[6];
  IF position('v_line.sent_at IS NULL' IN v_receipt)=0
     OR position('m.service_order_item_id=v_line.id' IN v_receipt)=0
     OR position('m.service_order_id=v_line.service_order_id' IN v_receipt)=0
     OR position('m.base_product_id=v_item.base_product_id' IN v_receipt)=0
     OR position('m.movement_type=''sent''' IN v_receipt)=0
     OR position('p_base_consumed_m<=0' IN v_receipt)=0
     OR position('Recebimento terceirizado exige remessa estrutural anterior' IN v_receipt)=0 THEN
    RAISE EXCEPTION 'Recebimento terceirizado ainda aceita entrada sem remessa/consumo';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_strap_executor_planning_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  RETURN jsonb_build_object(
    'calendars',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.status,c.created_at DESC)
      FROM public.strap_operational_calendars c),'[]'::jsonb),
    'exceptions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.work_date)
      FROM public.strap_operational_calendar_exceptions e
      JOIN public.strap_operational_calendars c ON c.id=e.calendar_id
      WHERE c.status='active'),'[]'::jsonb),
    'capacities',coalesce((SELECT jsonb_agg(to_jsonb(cp) ORDER BY cp.status,cp.version DESC)
      FROM public.strap_executor_capacities cp),'[]'::jsonb),
    'contractors',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)
      ORDER BY c.name) FROM public.contractors c),'[]'::jsonb),
    'payment_schedules',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.status,s.version DESC)
      FROM public.contractor_payment_schedules s),'[]'::jsonb),
    'can_manage',public.user_has_any_role(ARRAY['admin']),
    'can_see_financial',public.can_see_strap_financial_values()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reprocess_strap_planning_after_config(
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_variant record;
  v_count integer:=0;
  v_key text;
  v_executor record;
  v_batch public.strap_production_batches%ROWTYPE;
  v_capacity public.strap_executor_capacities%ROWTYPE;
  v_bucket public.strap_executor_daily_capacity_buckets%ROWTYPE;
  v_new_bucket_id uuid;
  v_committed_m numeric;
  v_item_id uuid;
  v_plan_capacity_id uuid;
  v_before_plan jsonb;
  v_after_plan jsonb;
BEGIN
  IF auth.role()<>'service_role' AND session_user NOT IN ('postgres','supabase_admin')
     AND NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Motivo do reprocessamento e obrigatorio'; END IF;
  PERFORM set_config('app.strap_engine_write','1',true);
  UPDATE public.sale_order_strap_demands SET
    status=coalesce(suspended_from_status,'pending'),suspended_from_status=NULL,
    suspension_reason=NULL,suspended_at=NULL,suspended_by=NULL,correlation_id=p_correlation_id
   WHERE is_current AND status='suspended'
     AND suspension_reason='Capacidade diaria do executor nao cadastrada';
  UPDATE public.strap_stock_floor_contributions SET
    status=coalesce(suspended_from_status,'pending'),suspended_from_status=NULL,
    suspension_reason=NULL,suspended_at=NULL,suspended_by=NULL,correlation_id=p_correlation_id
   WHERE is_current AND status='suspended'
     AND suspension_reason='Capacidade diaria do executor nao cadastrada';

  -- Uma mudanca de capacidade/calendario e prospectiva: preserva lotes ja
  -- iniciados, mas troca o snapshot de todos os lotes abertos. O lock por
  -- executor serializa esta reconstrucao com workers e agendamentos manuais.
  FOR v_executor IN
    SELECT DISTINCT b.executor_type,b.contractor_id,b.contractor_key
      FROM public.strap_production_batches b
     WHERE b.started_at IS NULL
       AND b.status IN ('draft','planned','suspended')
     ORDER BY b.executor_type,b.contractor_key
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(format(
      'strap-schedule:%s:%s',v_executor.executor_type,
      coalesce(v_executor.contractor_id::text,'factory')),0));

    SELECT c.id INTO v_plan_capacity_id
      FROM public.strap_executor_capacities c
     WHERE c.executor_type=v_executor.executor_type
       AND c.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
       AND c.status='active' AND c.valid_from<=current_date
       AND (c.valid_to IS NULL OR c.valid_to>=current_date)
     ORDER BY c.version DESC LIMIT 1;
    SELECT jsonb_build_object(
      'batches',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'batch_id',b.id,'status',b.status,'deadline',b.deadline,
        'capacity_profile_id',b.capacity_profile_id,
        'capacity_m_per_open_day_snapshot',b.capacity_m_per_open_day_snapshot)
        ORDER BY b.deadline,b.id)
        FROM public.strap_production_batches b
        WHERE b.executor_type=v_executor.executor_type
          AND b.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
          AND b.started_at IS NULL AND b.status IN ('draft','planned','suspended')),'[]'::jsonb),
      'buckets',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'bucket_id',cb.id,'work_date',cb.work_date,'status',cb.status,
        'capacity_profile_id',cb.capacity_profile_id,'capacity_m_snapshot',cb.capacity_m_snapshot,
        'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'allocation_id',a.id,'batch_item_id',a.batch_item_id,
          'scheduled_m',a.scheduled_m,'status',a.status) ORDER BY a.id)
          FROM public.strap_executor_daily_capacity_allocations a
          WHERE a.capacity_bucket_id=cb.id AND a.status='active'),'[]'::jsonb))
        ORDER BY cb.work_date,cb.id)
        FROM public.strap_executor_daily_capacity_buckets cb
        WHERE cb.executor_type=v_executor.executor_type
          AND cb.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
          AND cb.status='active'),'[]'::jsonb)
    ) INTO v_before_plan;

    FOR v_batch IN
      SELECT b.* FROM public.strap_production_batches b
       WHERE b.executor_type=v_executor.executor_type
         AND b.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
         AND b.started_at IS NULL
         AND b.status IN ('draft','planned','suspended')
       ORDER BY b.deadline,b.created_at,b.id
       FOR UPDATE
    LOOP
      SELECT * INTO v_capacity FROM public.strap_executor_capacities c
       WHERE c.executor_type=v_batch.executor_type
         AND c.contractor_id IS NOT DISTINCT FROM v_batch.contractor_id
         AND c.status='active' AND c.valid_from<=greatest(v_batch.deadline,current_date)
         AND (c.valid_to IS NULL OR c.valid_to>=greatest(v_batch.deadline,current_date))
       ORDER BY c.version DESC LIMIT 1;
      IF FOUND AND (
        v_batch.capacity_profile_id IS DISTINCT FROM v_capacity.id
        OR v_batch.capacity_m_per_open_day_snapshot IS DISTINCT FROM v_capacity.capacity_m_per_open_day
      ) THEN
        UPDATE public.strap_production_batches
           SET capacity_profile_id=v_capacity.id,
               capacity_m_per_open_day_snapshot=v_capacity.capacity_m_per_open_day,
               correlation_id=p_correlation_id,updated_at=now()
         WHERE id=v_batch.id;
      END IF;
    END LOOP;

    -- Primeiro retira todas as promessas reversiveis do executor. Assim a
    -- nova agenda nao depende da ordem em que jobs de variantes chegarem.
    UPDATE public.strap_executor_daily_capacity_allocations a
       SET status='superseded',updated_at=now()
      FROM public.strap_production_batch_items bi
      JOIN public.strap_production_batches b ON b.id=bi.batch_id
     WHERE a.batch_item_id=bi.id AND a.status='active'
       AND b.executor_type=v_executor.executor_type
       AND b.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
       AND b.started_at IS NULL AND bi.started_at IS NULL
       AND b.status IN ('draft','planned','suspended');

    -- Bucket e um ledger global executor x dia. Versiona o bucket ativo e
    -- carrega somente compromissos de lotes ja iniciados. Se a capacidade foi
    -- reduzida abaixo desses compromissos, o snapshot efetivo fica no piso ja
    -- prometido (zero espaco novo), sem reescrever o lote historico nem criar
    -- sobrecarga retroativa.
    FOR v_bucket IN
      SELECT b.* FROM public.strap_executor_daily_capacity_buckets b
       WHERE b.executor_type=v_executor.executor_type
         AND b.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
         AND b.status='active' AND b.work_date>=current_date
       ORDER BY b.work_date,b.id
       FOR UPDATE
    LOOP
      SELECT * INTO v_capacity FROM public.strap_executor_capacities c
       WHERE c.executor_type=v_bucket.executor_type
         AND c.contractor_id IS NOT DISTINCT FROM v_bucket.contractor_id
         AND c.status='active' AND c.valid_from<=v_bucket.work_date
         AND (c.valid_to IS NULL OR c.valid_to>=v_bucket.work_date)
       ORDER BY c.version DESC LIMIT 1;
      IF NOT FOUND OR (
        v_bucket.capacity_profile_id IS NOT DISTINCT FROM v_capacity.id
        AND v_bucket.capacity_m_snapshot IS NOT DISTINCT FROM v_capacity.capacity_m_per_open_day
      ) THEN
        CONTINUE;
      END IF;

      SELECT coalesce(sum(a.scheduled_m),0) INTO v_committed_m
        FROM public.strap_executor_daily_capacity_allocations a
       WHERE a.capacity_bucket_id=v_bucket.id AND a.status='active';

      UPDATE public.strap_executor_daily_capacity_buckets
         SET status='superseded',updated_at=now()
       WHERE id=v_bucket.id;

      IF v_committed_m>0 THEN
        INSERT INTO public.strap_executor_daily_capacity_buckets(
          executor_type,contractor_id,work_date,capacity_profile_id,
          capacity_m_snapshot,schedule_revision,status)
        VALUES(v_bucket.executor_type,v_bucket.contractor_id,v_bucket.work_date,
          v_capacity.id,greatest(v_capacity.capacity_m_per_open_day,v_committed_m),
          v_bucket.schedule_revision+1,'active')
        RETURNING id INTO v_new_bucket_id;

        WITH moved AS (
          UPDATE public.strap_executor_daily_capacity_allocations a
             SET status='superseded',updated_at=now()
           WHERE a.capacity_bucket_id=v_bucket.id AND a.status='active'
           RETURNING a.id,a.batch_item_id,a.scheduled_m
        )
        INSERT INTO public.strap_executor_daily_capacity_allocations(
          capacity_bucket_id,batch_item_id,scheduled_m,status)
        SELECT v_new_bucket_id,m.batch_item_id,m.scheduled_m,'active'
          FROM moved m ORDER BY m.id;
      ELSE
        UPDATE public.strap_executor_daily_capacity_allocations
           SET status='superseded',updated_at=now()
         WHERE capacity_bucket_id=v_bucket.id AND status='active';
      END IF;
    END LOOP;

    -- Reagenda a fila reversivel inteira, em ordem deterministica de prazo e
    -- prioridade, contra os novos buckets e calendarios.
    FOR v_item_id IN
      SELECT bi.id
        FROM public.strap_production_batch_items bi
        JOIN public.strap_production_batches b ON b.id=bi.batch_id
       WHERE b.executor_type=v_executor.executor_type
         AND b.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
         AND b.started_at IS NULL AND bi.started_at IS NULL
         AND b.status IN ('draft','planned','suspended')
         AND bi.status NOT IN ('cancelled','completed')
       ORDER BY b.deadline,
         coalesce((SELECT min(c.priority) FROM public.strap_production_batch_contributions c
           WHERE c.batch_item_id=bi.id AND c.status IN ('planned','suspended')),2147483647),
         bi.created_at,bi.id
    LOOP
      PERFORM public.schedule_strap_batch_item(v_item_id,
        coalesce(nullif(btrim(p_reason),''),'Mudanca de configuracao de planejamento'),
        p_correlation_id);
    END LOOP;

    SELECT jsonb_build_object(
      'batches',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'batch_id',b.id,'status',b.status,'deadline',b.deadline,
        'capacity_profile_id',b.capacity_profile_id,
        'capacity_m_per_open_day_snapshot',b.capacity_m_per_open_day_snapshot)
        ORDER BY b.deadline,b.id)
        FROM public.strap_production_batches b
        WHERE b.executor_type=v_executor.executor_type
          AND b.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
          AND b.started_at IS NULL AND b.status IN ('draft','planned','suspended')),'[]'::jsonb),
      'buckets',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'bucket_id',cb.id,'work_date',cb.work_date,'status',cb.status,
        'capacity_profile_id',cb.capacity_profile_id,'capacity_m_snapshot',cb.capacity_m_snapshot,
        'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'allocation_id',a.id,'batch_item_id',a.batch_item_id,
          'scheduled_m',a.scheduled_m,'status',a.status) ORDER BY a.id)
          FROM public.strap_executor_daily_capacity_allocations a
          WHERE a.capacity_bucket_id=cb.id AND a.status='active'),'[]'::jsonb))
        ORDER BY cb.work_date,cb.id)
        FROM public.strap_executor_daily_capacity_buckets cb
        WHERE cb.executor_type=v_executor.executor_type
          AND cb.contractor_id IS NOT DISTINCT FROM v_executor.contractor_id
          AND cb.status='active'),'[]'::jsonb)
    ) INTO v_after_plan;
    IF v_plan_capacity_id IS NOT NULL THEN
      INSERT INTO public.artisanal_strap_operational_audit_log(
        entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
      VALUES('strap_executor_capacity',v_plan_capacity_id,'reconcile',v_before_plan,v_after_plan,
        btrim(p_reason),p_correlation_id,auth.uid());
    END IF;
  END LOOP;

  FOR v_variant IN SELECT id FROM public.artisanal_strap_variants WHERE status='active' ORDER BY id
  LOOP
    v_key:=format('strap-config:%s:%s:%s',txid_current(),v_variant.id,coalesce(p_reason,'changed'));
    PERFORM public.enqueue_strap_demand_job('strap_variant',v_variant.id,0,0,
      'planning_config_changed',jsonb_build_object('strap_variant_id',v_variant.id,
        'reason',coalesce(p_reason,'changed')),v_key,p_correlation_id);
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_strap_operational_calendar(
  p_payload jsonb,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_type text:=p_payload->>'calendar_type'; v_name text:=p_payload->>'name';
  v_contractor uuid:=nullif(p_payload->>'contractor_id','')::uuid;
  v_weekdays smallint[]; v_timezone text:=coalesce(nullif(p_payload->>'timezone',''),'America/Sao_Paulo');
  v_old public.strap_operational_calendars%ROWTYPE; v_new uuid; v_exception jsonb;
  v_capacity public.strap_executor_capacities%ROWTYPE; v_version integer;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Somente Administrador'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL OR nullif(btrim(v_name),'') IS NULL
     OR v_type NOT IN ('factory','contractor','banking') THEN RAISE EXCEPTION 'Payload/motivo de calendario invalido'; END IF;
  IF jsonb_typeof(coalesce(p_payload->'open_iso_weekdays','null'::jsonb))<>'array' THEN
    RAISE EXCEPTION 'open_iso_weekdays deve ser array'; END IF;
  SELECT array_agg(value::smallint ORDER BY value::smallint) INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload->'open_iso_weekdays');
  IF cardinality(v_weekdays)=0 OR NOT (v_weekdays<@ARRAY[1,2,3,4,5,6,7]::smallint[]) THEN
    RAISE EXCEPTION 'Dias ISO invalidos'; END IF;
  IF (v_type='contractor') IS DISTINCT FROM (v_contractor IS NOT NULL) THEN
    RAISE EXCEPTION 'Calendario contractor exige contractor_id; demais nao aceitam'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-calendar:'||v_type||':'||coalesce(v_contractor::text,v_name),0));
  IF v_type IN ('factory','contractor') THEN
    SELECT * INTO v_old FROM public.strap_operational_calendars
     WHERE calendar_type=v_type AND contractor_id IS NOT DISTINCT FROM v_contractor
       AND status='active' FOR UPDATE;
    IF FOUND THEN UPDATE public.strap_operational_calendars SET status='superseded' WHERE id=v_old.id; END IF;
  ELSIF nullif(p_payload->>'supersedes_calendar_id','') IS NOT NULL THEN
    SELECT * INTO v_old FROM public.strap_operational_calendars
     WHERE id=(p_payload->>'supersedes_calendar_id')::uuid AND calendar_type='banking' FOR UPDATE;
    IF FOUND THEN UPDATE public.strap_operational_calendars SET status='superseded' WHERE id=v_old.id; END IF;
  END IF;
  INSERT INTO public.strap_operational_calendars(
    name,calendar_type,contractor_id,uses_factory_calendar,open_iso_weekdays,timezone,status)
  VALUES(btrim(v_name),v_type,v_contractor,v_type='factory',v_weekdays,v_timezone,'active')
  RETURNING id INTO v_new;
  FOR v_exception IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'exceptions','[]'::jsonb))
  LOOP
    INSERT INTO public.strap_operational_calendar_exceptions(
      calendar_id,work_date,is_open,reason,created_by)
    VALUES(v_new,(v_exception->>'work_date')::date,(v_exception->>'is_open')::boolean,
      btrim(v_exception->>'reason'),auth.uid());
  END LOOP;
  -- Mantem o executor imediatamente operavel ao versionar seu calendario.
  IF v_old.id IS NOT NULL THEN
    FOR v_capacity IN SELECT * FROM public.strap_executor_capacities
      WHERE calendar_id=v_old.id AND status='active' AND valid_to IS NULL FOR UPDATE
    LOOP
      UPDATE public.strap_executor_capacities SET status='superseded',
        valid_to=greatest(valid_from,current_date-1) WHERE id=v_capacity.id;
      SELECT coalesce(max(version),0)+1 INTO v_version FROM public.strap_executor_capacities
       WHERE executor_type=v_capacity.executor_type
         AND contractor_id IS NOT DISTINCT FROM v_capacity.contractor_id;
      INSERT INTO public.strap_executor_capacities(
        executor_type,contractor_id,capacity_m_per_open_day,calendar_id,version,
        valid_from,status,created_by)
      VALUES(v_capacity.executor_type,v_capacity.contractor_id,v_capacity.capacity_m_per_open_day,
        v_new,v_version,greatest(current_date,v_capacity.valid_from),'active',auth.uid());
    END LOOP;
  END IF;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,after_data,reason,correlation_id,actor_id)
  VALUES('strap_operational_calendar',v_new,'insert',p_payload,btrim(p_reason),p_correlation_id,auth.uid());
  PERFORM public.reprocess_strap_planning_after_config('calendar_changed',p_correlation_id);
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_strap_executor_capacity(
  p_executor_type text,
  p_contractor_id uuid,
  p_capacity_m_per_open_day numeric,
  p_calendar_id uuid,
  p_valid_from date,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old public.strap_executor_capacities%ROWTYPE; v_version integer; v_id uuid;
  v_calendar_type text; v_calendar_contractor_id uuid;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Somente Administrador'; END IF;
  IF p_executor_type NOT IN ('factory','contractor') OR coalesce(p_capacity_m_per_open_day,0)<=0
     OR p_calendar_id IS NULL OR p_valid_from IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN
    RAISE EXCEPTION 'Configuracao de capacidade invalida'; END IF;
  IF p_valid_from>current_date THEN
    RAISE EXCEPTION 'Vigencia futura de capacidade nao e suportada; use hoje ou data anterior e replaneje os lotes abertos';
  END IF;
  IF (p_executor_type='contractor') IS DISTINCT FROM (p_contractor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'executor_type/contractor_id divergentes'; END IF;
  SELECT c.calendar_type,c.contractor_id
    INTO v_calendar_type,v_calendar_contractor_id
    FROM public.strap_operational_calendars c
   WHERE c.id=p_calendar_id AND c.status='active';
  IF NOT FOUND OR v_calendar_type IS DISTINCT FROM p_executor_type
     OR v_calendar_contractor_id IS DISTINCT FROM p_contractor_id THEN
    RAISE EXCEPTION 'Calendario ativo nao pertence ao executor/cadastro informado';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-capacity:'||p_executor_type||':'
    ||coalesce(p_contractor_id::text,'factory'),0));
  SELECT * INTO v_old FROM public.strap_executor_capacities
   WHERE executor_type=p_executor_type AND contractor_id IS NOT DISTINCT FROM p_contractor_id
     AND status='active' AND valid_to IS NULL FOR UPDATE;
  IF FOUND THEN
    IF p_valid_from<v_old.valid_from THEN RAISE EXCEPTION 'Nova vigencia nao pode anteceder a atual'; END IF;
    UPDATE public.strap_executor_capacities SET status='superseded',
      valid_to=greatest(valid_from,p_valid_from-1) WHERE id=v_old.id;
  END IF;
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.strap_executor_capacities
   WHERE executor_type=p_executor_type AND contractor_id IS NOT DISTINCT FROM p_contractor_id;
  INSERT INTO public.strap_executor_capacities(
    executor_type,contractor_id,capacity_m_per_open_day,calendar_id,version,valid_from,status,created_by)
  VALUES(p_executor_type,p_contractor_id,p_capacity_m_per_open_day,p_calendar_id,
    v_version,p_valid_from,'active',auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('strap_executor_capacity',v_id,'insert',to_jsonb(v_old),
    jsonb_build_object('version',v_version,'capacity_m_per_open_day',p_capacity_m_per_open_day,
      'calendar_id',p_calendar_id,'valid_from',p_valid_from),btrim(p_reason),p_correlation_id,auth.uid());
  PERFORM public.reprocess_strap_planning_after_config('capacity_changed',p_correlation_id);
  RETURN v_id;
END;
$$;

DO $$
DECLARE
  v_save_definition text:=lower(pg_get_functiondef(
    'public.save_strap_executor_capacity(text,uuid,numeric,uuid,date,text,uuid)'::regprocedure));
  v_reprocess_definition text:=lower(pg_get_functiondef(
    'public.reprocess_strap_planning_after_config(text,uuid)'::regprocedure));
  v_schedule_definition text:=lower(pg_get_functiondef(
    'public.schedule_strap_batch_item(uuid,text,uuid)'::regprocedure));
  v_ensure_definition text:=lower(pg_get_functiondef(
    'public.ensure_strap_production_contribution(uuid,uuid,numeric,uuid)'::regprocedure));
BEGIN
  IF v_save_definition !~ 'p_valid_from[[:space:]]*>[[:space:]]*current_date' THEN
    RAISE EXCEPTION 'Contrato de capacidade invalido: vigencia futura nao pode desativar o perfil atual';
  END IF;
  IF v_reprocess_definition !~ 'capacity_profile_id[[:space:]]*=[[:space:]]*v_capacity\.id'
     OR v_reprocess_definition !~ 'schedule_strap_batch_item\('
     OR position('strap_executor_daily_capacity_buckets' in v_reprocess_definition)=0
     OR v_reprocess_definition !~ 'set[[:space:]]+status[[:space:]]*=[[:space:]]*''superseded''' THEN
    RAISE EXCEPTION 'Contrato de replanejamento invalido: lotes/buckets abertos devem adotar a capacidade vigente';
  END IF;
  IF v_schedule_definition !~ 'greatest\([[:space:]]*v_batch\.deadline[[:space:]]*,[[:space:]]*current_date[[:space:]]*\)'
     OR v_reprocess_definition !~ 'greatest\([[:space:]]*v_batch\.deadline[[:space:]]*,[[:space:]]*current_date[[:space:]]*\)'
     OR v_ensure_definition !~ 'greatest\([[:space:]]*coalesce\([[:space:]]*v_required_at' THEN
    RAISE EXCEPTION 'Contrato de capacidade invalido: demanda/lote atrasado deve usar a capacidade vigente de hoje';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_contractor_payment_schedule(
  p_contractor_id uuid,
  p_frequency text,
  p_cutoff_iso_weekday integer,
  p_cutoff_day_of_month integer,
  p_payment_offset_days integer,
  p_payment_iso_weekday integer,
  p_payment_day_of_month integer,
  p_timezone text,
  p_bank_calendar_id uuid,
  p_valid_from date,
  p_reason text,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_old public.contractor_payment_schedules%ROWTYPE; v_version integer; v_id uuid; v_type text;
BEGIN
  IF NOT public.user_has_any_role(ARRAY['admin']) THEN RAISE EXCEPTION 'Somente Administrador'; END IF;
  IF p_contractor_id IS NULL OR p_frequency NOT IN ('weekly','biweekly')
     OR p_cutoff_iso_weekday NOT BETWEEN 1 AND 7 OR p_valid_from IS NULL
     OR (p_frequency='weekly' AND p_cutoff_day_of_month IS NOT NULL)
     OR (p_frequency='biweekly' AND p_cutoff_day_of_month NOT BETWEEN 1 AND 27)
     OR nullif(btrim(p_reason),'') IS NULL
     OR nullif(btrim(p_timezone),'') IS NULL
     OR num_nonnulls(p_payment_offset_days,p_payment_iso_weekday,p_payment_day_of_month)<>1 THEN
    RAISE EXCEPTION 'Calendario de pagamento invalido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name=p_timezone) THEN
    RAISE EXCEPTION 'Timezone IANA invalido: %',p_timezone; END IF;
  SELECT calendar_type INTO v_type FROM public.strap_operational_calendars
   WHERE id=p_bank_calendar_id AND status='active';
  IF v_type IS DISTINCT FROM 'banking' THEN RAISE EXCEPTION 'bank_calendar_id deve ser calendario bancario ativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('strap-payment-schedule:'||p_contractor_id::text,0));
  SELECT * INTO v_old FROM public.contractor_payment_schedules
   WHERE contractor_id=p_contractor_id AND status='active' AND valid_to IS NULL FOR UPDATE;
  IF FOUND THEN
    IF p_valid_from<v_old.valid_from THEN RAISE EXCEPTION 'Nova vigencia nao pode anteceder a atual'; END IF;
    UPDATE public.contractor_payment_schedules SET status='superseded',
      valid_to=greatest(valid_from,p_valid_from-1) WHERE id=v_old.id;
  END IF;
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.contractor_payment_schedules
   WHERE contractor_id=p_contractor_id;
  INSERT INTO public.contractor_payment_schedules(
    contractor_id,frequency,cutoff_iso_weekday,cutoff_day_of_month,
    payment_iso_weekday,payment_day_of_month,payment_offset_days,timezone,
    bank_calendar_id,version,valid_from,status)
  VALUES(p_contractor_id,p_frequency,p_cutoff_iso_weekday,p_cutoff_day_of_month,
    p_payment_iso_weekday,p_payment_day_of_month,p_payment_offset_days,p_timezone,
    p_bank_calendar_id,v_version,p_valid_from,'active')
  RETURNING id INTO v_id;
  INSERT INTO public.artisanal_strap_operational_audit_log(
    entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
  VALUES('contractor_payment_schedule',v_id,'insert',to_jsonb(v_old),
    jsonb_build_object('version',v_version,'frequency',p_frequency,
      'cutoff_iso_weekday',p_cutoff_iso_weekday,'cutoff_day_of_month',p_cutoff_day_of_month,
      'timezone',p_timezone,'valid_from',p_valid_from),
    btrim(p_reason),p_correlation_id,auth.uid());
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_product_stock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_variant record; v_key text; v_correlation uuid:=gen_random_uuid();
BEGIN
  IF NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN RETURN NEW; END IF;
  FOR v_variant IN
    SELECT DISTINCT v.id FROM public.artisanal_strap_variants v
      JOIN (
        -- Catalogo corrente/historico, sem exigir status ativo: Req118 ainda
        -- permite concluir o documento comprometido da variante suspensa.
        SELECT av.id AS strap_variant_id
          FROM public.artisanal_strap_variants av
         WHERE av.finished_product_id=NEW.id
        UNION
        SELECT av.id FROM public.artisanal_strap_variants av
          JOIN public.base_material_color_official_products op
            ON op.base_group_id=av.base_group_id AND op.color_id=av.color_id
         WHERE op.official_product_id=NEW.id
        UNION
        -- Snapshots operacionais exatos sobrevivem a troca/inativacao do
        -- oficial; nenhuma busca usa nome, cor textual ou LIMIT 1.
        SELECT d.strap_variant_id FROM public.sale_order_strap_demands d
         WHERE d.is_current AND (d.base_product_id=NEW.id OR d.finished_product_id=NEW.id)
           AND d.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT f.strap_variant_id FROM public.strap_stock_floor_contributions f
         WHERE f.is_current AND (f.base_product_id=NEW.id OR f.finished_product_id=NEW.id)
           AND f.status NOT IN ('fulfilled','superseded','cancelled','error')
        UNION
        SELECT r.strap_variant_id FROM public.material_reservations r
         WHERE r.strap_variant_id IS NOT NULL AND r.product_id=NEW.id
           AND r.status IN ('reserved','partially_consumed')
        UNION
        SELECT soi.strap_variant_id FROM public.service_order_items soi
         WHERE soi.strap_variant_id IS NOT NULL
           AND (soi.base_product_id=NEW.id OR soi.finished_product_id=NEW.id)
           AND soi.line_status NOT IN ('Entregue','Cancelado')
        UNION
        SELECT bi.strap_variant_id FROM public.strap_production_batch_items bi
         WHERE (bi.base_product_id=NEW.id OR bi.finished_product_id=NEW.id)
           AND bi.status NOT IN ('completed','cancelled')
        UNION
        SELECT c.strap_variant_id FROM public.purchase_demand_contributions c
         WHERE c.strap_variant_id IS NOT NULL AND c.purchase_product_id=NEW.id
           AND c.status NOT IN ('received','cancelled','superseded')
      ) affected ON affected.strap_variant_id=v.id
     ORDER BY v.id
  LOOP
    v_key:=format('strap-product-stock:%s:%s:%s:%s:%s',txid_current(),NEW.id,
      v_variant.id,OLD.quantity,NEW.quantity);
    PERFORM public.enqueue_strap_demand_job('stock',v_variant.id,0,0,'stock_changed',
      jsonb_build_object('strap_variant_id',v_variant.id,'product_id',NEW.id,
        'previous_quantity',OLD.quantity,'new_quantity',NEW.quantity,
        'reason','products.quantity changed for exact operational strap relation'),
      v_key,v_correlation);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_strap_product_stock_change ON public.products;
CREATE TRIGGER trg_enqueue_strap_product_stock_change
  AFTER UPDATE OF quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_product_stock_change();

-- Contrato executavel Req53/118: quantity de uma napa/artefato historico faz
-- fan-out por FKs operacionais mesmo depois de trocar o oficial ou suspender a
-- variante. A relacao nunca e inferida por nome/cor.
DO $$
DECLARE v_def text:=pg_get_functiondef(
  'public.tg_enqueue_strap_product_stock_change()'::regprocedure);
BEGIN
  IF position('sale_order_strap_demands' IN v_def)=0
     OR position('strap_stock_floor_contributions' IN v_def)=0
     OR position('material_reservations' IN v_def)=0
     OR position('service_order_items' IN v_def)=0
     OR position('strap_production_batch_items' IN v_def)=0
     OR position('purchase_demand_contributions' IN v_def)=0
     OR position('d.base_product_id=NEW.id' IN v_def)=0
     OR position('soi.base_product_id=NEW.id' IN v_def)=0
     OR position('bi.base_product_id=NEW.id' IN v_def)=0
     OR position('v.status=''active''' IN v_def)>0
     OR position('op.status=''active''' IN v_def)>0 THEN
    RAISE EXCEPTION 'Req53/118: mudanca de estoque nao cobre snapshots historicos exatos';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_commercial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_variant record; v_entity uuid:=NEW.id; v_before jsonb; v_after jsonb;
  v_hash text; v_key text; v_correlation uuid:=gen_random_uuid();
BEGIN
  IF TG_TABLE_NAME='products' THEN
    v_before:=jsonb_build_object('active',OLD.active,'supplier_id',OLD.supplier_id,
      'purchase_unit',OLD.purchase_unit,'conversion_rate',OLD.conversion_rate,
      'purchase_price',OLD.purchase_price,'min_order_quantity',OLD.min_order_quantity,
      'purchase_multiple',OLD.purchase_multiple,
      'material_preparation_days',OLD.material_preparation_days);
    v_after:=jsonb_build_object('active',NEW.active,'supplier_id',NEW.supplier_id,
      'purchase_unit',NEW.purchase_unit,'conversion_rate',NEW.conversion_rate,
      'purchase_price',NEW.purchase_price,'min_order_quantity',NEW.min_order_quantity,
      'purchase_multiple',NEW.purchase_multiple,
      'material_preparation_days',NEW.material_preparation_days);
  ELSE
    v_before:=jsonb_build_object('lead_time_days',OLD.lead_time_days,
      'payment_terms',OLD.payment_terms,
      'payment_terms_structured',OLD.payment_terms_structured);
    v_after:=jsonb_build_object('lead_time_days',NEW.lead_time_days,
      'payment_terms',NEW.payment_terms,
      'payment_terms_structured',NEW.payment_terms_structured);
  END IF;
  IF v_before IS NOT DISTINCT FROM v_after THEN RETURN NEW; END IF;
  v_hash:=public.strap_payload_hash(v_after);

  FOR v_variant IN
    SELECT DISTINCT v.id
      FROM public.artisanal_strap_variants v
      LEFT JOIN public.base_material_color_official_products op
        ON op.base_group_id=v.base_group_id AND op.color_id=v.color_id AND op.status='active'
      LEFT JOIN public.products fp ON fp.id=v.finished_product_id
      LEFT JOIN public.products bp ON bp.id=op.official_product_id
     WHERE v.status='active' AND (
       (TG_TABLE_NAME='products' AND (fp.id=v_entity OR bp.id=v_entity))
       OR (TG_TABLE_NAME='suppliers'
         AND (fp.supplier_id=v_entity OR bp.supplier_id=v_entity)))
     ORDER BY v.id
  LOOP
    v_key:=format('strap-commercial:%s:%s:%s:%s:%s',txid_current(),TG_TABLE_NAME,
      v_entity,v_variant.id,v_hash);
    PERFORM public.enqueue_strap_demand_job('strap_variant',v_variant.id,0,0,
      'commercial_changed',jsonb_build_object('strap_variant_id',v_variant.id,
        'entity_type',TG_TABLE_NAME,'entity_id',v_entity,'before',v_before,'after',v_after),
      v_key,v_correlation);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_strap_product_commercial_change ON public.products;
CREATE TRIGGER trg_enqueue_strap_product_commercial_change
  AFTER UPDATE OF active,supplier_id,purchase_unit,conversion_rate,purchase_price,
    min_order_quantity,purchase_multiple,material_preparation_days ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_commercial_change();

DROP TRIGGER IF EXISTS trg_enqueue_strap_supplier_commercial_change ON public.suppliers;
CREATE TRIGGER trg_enqueue_strap_supplier_commercial_change
  AFTER UPDATE OF lead_time_days,payment_terms,payment_terms_structured ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_commercial_change();

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_catalog_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_variant record; v_row jsonb:=to_jsonb(NEW); v_old jsonb:=to_jsonb(OLD);
  v_entity uuid; v_key text; v_correlation uuid:=gen_random_uuid();
BEGIN
  BEGIN v_entity:=coalesce(nullif(v_row->>'id',''),nullif(v_old->>'id',''))::uuid;
  EXCEPTION WHEN OTHERS THEN v_entity:=NULL; END;
  FOR v_variant IN
    SELECT DISTINCT v.id
      FROM public.artisanal_strap_variants v
     WHERE (
       TG_TABLE_NAME='artisanal_strap_variants' AND v.id=v_entity
       AND (v.status='active' OR v_old->>'status'='active')
     ) OR (
       v.status='active' AND (
         (TG_TABLE_NAME='canonical_colors' AND v.color_id=v_entity)
         OR (TG_TABLE_NAME='artisanal_strap_recipes'
         AND v.measure_id=coalesce(nullif(v_row->>'measure_id',''),v_old->>'measure_id')::uuid
         AND v.base_group_id=coalesce(nullif(v_row->>'base_group_id',''),v_old->>'base_group_id')::uuid)
         OR (TG_TABLE_NAME='base_material_color_official_products'
         AND v.base_group_id=coalesce(nullif(v_row->>'base_group_id',''),v_old->>'base_group_id')::uuid
         AND v.color_id=coalesce(nullif(v_row->>'color_id',''),v_old->>'color_id')::uuid)
       )
     ) ORDER BY v.id
  LOOP
    v_key:=format('strap-catalog:%s:%s:%s:%s',txid_current(),TG_TABLE_NAME,
      coalesce(v_entity::text,'row'),v_variant.id);
    PERFORM public.enqueue_strap_demand_job('strap_variant',v_variant.id,0,0,'catalog_changed',
      jsonb_build_object('strap_variant_id',v_variant.id,'catalog_table',TG_TABLE_NAME,
        'catalog_entity_id',v_entity),v_key,v_correlation);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_strap_catalog_variant_change ON public.artisanal_strap_variants;
CREATE TRIGGER trg_enqueue_strap_catalog_variant_change
  AFTER INSERT OR UPDATE ON public.artisanal_strap_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_catalog_change();
DROP TRIGGER IF EXISTS trg_enqueue_strap_catalog_color_change ON public.canonical_colors;
CREATE TRIGGER trg_enqueue_strap_catalog_color_change
  AFTER UPDATE OF active ON public.canonical_colors
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_catalog_change();
DROP TRIGGER IF EXISTS trg_enqueue_strap_catalog_recipe_change ON public.artisanal_strap_recipes;
CREATE TRIGGER trg_enqueue_strap_catalog_recipe_change
  AFTER INSERT OR UPDATE ON public.artisanal_strap_recipes
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_catalog_change();
DROP TRIGGER IF EXISTS trg_enqueue_strap_catalog_official_product_change ON public.base_material_color_official_products;
CREATE TRIGGER trg_enqueue_strap_catalog_official_product_change
  AFTER INSERT OR UPDATE ON public.base_material_color_official_products
  FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_catalog_change();

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.tg_enqueue_strap_catalog_change()'::regprocedure)
    INTO v_def;
  IF v_def !~ 'v_old->>''status''=''active'''
     OR v_def !~ 'TG_TABLE_NAME=''artisanal_strap_variants'''
     OR v_def !~ 'TG_TABLE_NAME=''canonical_colors''' THEN
    RAISE EXCEPTION 'Req118: transicao active -> suspended precisa enfileirar neutralizacao reversivel';
  END IF;
END;
$$;

DO $$
DECLARE v_job_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job
      WHERE jobname='artisanal-strap-purchase-order-notifications';
    IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
    PERFORM cron.schedule('artisanal-strap-purchase-order-notifications','*/15 * * * *',
      $cron$SELECT public.refresh_open_strap_purchase_order_notifications();$cron$);
  ELSE
    RAISE WARNING 'pg_cron ausente: configure chamada externa de refresh_open_strap_purchase_order_notifications';
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_table OR undefined_function THEN
  RAISE WARNING 'Nao foi possivel instalar cron de notificacoes de OC: %',SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_strap_executor_planning_config(),
  public.save_strap_operational_calendar(jsonb,text,uuid),
  public.save_strap_executor_capacity(text,uuid,numeric,uuid,date,text,uuid),
  public.save_contractor_payment_schedule(uuid,text,integer,integer,integer,integer,integer,text,uuid,date,text,uuid)
TO authenticated;

-- Amplia o diagnostico seguro do catalogo com as duas filas de migracao que
-- possuem RPCs de resolucao. A UI nao precisa consultar tabelas cruas.
CREATE OR REPLACE FUNCTION public.artisanal_strap_catalog_diagnostics()
RETURNS TABLE(issue_code text,entity_id uuid,details jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role()<>'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  RETURN QUERY
  SELECT 'variant_product_status_divergence'::text,v.id,
    jsonb_build_object('variant_status',v.status,'product_id',p.id,'product_active',p.active)
  FROM public.artisanal_strap_variants v JOIN public.products p ON p.id=v.finished_product_id
  WHERE p.active IS DISTINCT FROM (v.status='active')
  UNION ALL
  SELECT 'purchase_enabled_invalid_commercial_data',v.id,
    jsonb_build_object('finished_product_id',p.id,'has_purchase_price',p.purchase_price>0,
      'has_purchase_unit',nullif(btrim(coalesce(p.purchase_unit,'')),'') IS NOT NULL,
      'conversion_valid',p.conversion_rate>0 AND (p.purchase_unit<>p.unit OR p.conversion_rate=1),
      'moq_valid',p.min_order_quantity>0,'multiple_valid',p.purchase_multiple>0,
      'preparation_days_valid',p.material_preparation_days>=0,
      'supplier_missing_allowed_only_as_provisional_po',p.supplier_id IS NULL)
  FROM public.artisanal_strap_variants v JOIN public.products p ON p.id=v.finished_product_id
  WHERE v.purchase_enabled AND (p.purchase_price IS NULL OR p.purchase_price<=0
    OR nullif(btrim(coalesce(p.purchase_unit,'')),'') IS NULL OR p.conversion_rate IS NULL
    OR p.conversion_rate<=0 OR (p.purchase_unit=p.unit AND p.conversion_rate<>1)
    OR p.min_order_quantity IS NULL OR p.min_order_quantity<=0
    OR p.purchase_multiple IS NULL OR p.purchase_multiple<=0 OR p.material_preparation_days<0)
  UNION ALL
  SELECT 'active_internal_variant_without_current_recipe',v.id,
    jsonb_build_object('measure_id',v.measure_id,'base_group_id',v.base_group_id)
  FROM public.artisanal_strap_variants v
  WHERE v.status='active' AND v.min_stock_replenishment_mode='internal'
    AND NOT EXISTS (SELECT 1 FROM public.artisanal_strap_recipes r
      WHERE r.measure_id=v.measure_id AND r.base_group_id=v.base_group_id
        AND r.status='approved' AND r.valid_from<=now()
        AND (r.valid_to IS NULL OR r.valid_to>now()))
  UNION ALL
  SELECT 'official_base_width_divergence',op.id,
    jsonb_build_object('base_group_id',op.base_group_id,'color_id',op.color_id,
      'official_product_id',op.official_product_id,
      'product_width_mm',public.strap_material_product_width_mm(op.official_product_id),
      'profile_width_mm',wp.usable_width_mm)
  FROM public.base_material_color_official_products op
  JOIN public.base_material_width_profiles wp ON wp.base_group_id=op.base_group_id
    AND wp.status='approved' AND wp.valid_to IS NULL
  WHERE op.status='active' AND (public.strap_material_product_width_mm(op.official_product_id) IS NULL
    OR abs(public.strap_material_product_width_mm(op.official_product_id)-wp.usable_width_mm)>0.000001)
  UNION ALL
  SELECT 'legacy_technical_line_review_required',m.id,
    jsonb_build_object('technical_sheet_id',m.technical_sheet_id,
      'technical_strap_line_id',m.technical_strap_line_id,'legacy_path',m.legacy_path,
      'legacy_ordinal',m.legacy_ordinal)
  FROM public.technical_strap_line_identity_map m WHERE m.status='review_required'
  UNION ALL
  SELECT 'legacy_recipe_map_review_required',m.legacy_recipe_id,
    jsonb_build_object('legacy_recipe_id',m.legacy_recipe_id,
      'resolution_reason',m.resolution_reason,
      'candidates',coalesce((SELECT ri.candidates
        FROM public.artisanal_strap_migration_review_items ri
        WHERE ri.status='review_required' AND ri.legacy_id=m.legacy_recipe_id::text
        ORDER BY ri.created_at DESC LIMIT 1),'[]'::jsonb))
  FROM public.legacy_artisanal_recipe_map m WHERE m.status='review_required'
  UNION ALL
  SELECT 'migration_review_item_required',ri.id,
    jsonb_build_object('entity_type',ri.entity_type,'legacy_id',ri.legacy_id,
      'candidates',ri.candidates,'reason',ri.reason)
  FROM public.artisanal_strap_migration_review_items ri WHERE ri.status='review_required';
END;
$$;

-- Mantem o save desktop inteiro em uma transacao, mas torna strap_sourcing
-- otimista e auditavel. A assinatura publica continua a mesma; cada item
-- existente que enviar strap_sourcing deve enviar strap_sourcing_revision.

DO $$
BEGIN
  IF to_regprocedure('public.create_sale_order_atomic(jsonb,jsonb,uuid)') IS NOT NULL
     AND to_regprocedure('public.create_sale_order_atomic_legacy_202701(jsonb,jsonb,uuid)') IS NULL THEN
    ALTER FUNCTION public.create_sale_order_atomic(jsonb,jsonb,uuid)
      RENAME TO create_sale_order_atomic_legacy_202701;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_order_atomic_legacy_202701(jsonb,jsonb,uuid)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_sale_order_atomic(
  p_header jsonb,
  p_items jsonb,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_hash text; v_order_id uuid; v_existing public.sale_orders%ROWTYPE;
  v_item_ids uuid[]; v_result jsonb; v_count integer; v_signature_at timestamptz;
  v_status text;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode criar PV';
  END IF;
  IF jsonb_typeof(p_header)<>'object' OR jsonb_typeof(p_items)<>'array'
     OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'Cabecalho e array nao vazio de itens sao obrigatorios';
  END IF;
  v_hash:=public.strap_payload_hash(jsonb_build_object('header',p_header,'items',p_items));
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'create-sale-order:'||p_client_request_id::text,0));
    SELECT * INTO v_existing FROM public.sale_orders
     WHERE client_request_id=p_client_request_id FOR UPDATE;
    IF FOUND THEN
      IF v_existing.client_request_payload_hash IS NULL
         OR v_existing.client_request_payload_hash<>v_hash
         OR v_existing.client_request_item_count<>jsonb_array_length(p_items) THEN
        RAISE EXCEPTION 'Replay idempotente divergente ou historico sem digest para client_request_id %',
          p_client_request_id USING ERRCODE='22000';
      END IF;
      SELECT coalesce(array_agg(i.id ORDER BY i.created_at,i.id),'{}'::uuid[]),count(*)::integer
        INTO v_item_ids,v_count FROM public.sale_order_items i
       WHERE i.sale_order_id=v_existing.id;
      IF v_count<>v_existing.client_request_item_count THEN
        RAISE EXCEPTION 'Replay atomico incompleto: esperado %, persistido %',
          v_existing.client_request_item_count,v_count USING ERRCODE='55000';
      END IF;
      -- Replay de uma criacao historica parcialmente concluida se autocorrige:
      -- depois de validar todos os itens, garante a fila canônica antes de
      -- devolver o mesmo PV confirmado.
      IF v_existing.status IN ('Aprovado','Em Produção') THEN
        PERFORM public.enqueue_sale_order_strap_demands(v_existing.id,
          CASE WHEN v_existing.status='Em Produção' THEN 'direct_production' ELSE 'approved' END,
          gen_random_uuid());
      END IF;
      RETURN jsonb_build_object('order_id',v_existing.id,'item_ids',to_jsonb(v_item_ids),
        'idempotent_replay',true,'payload_hash',v_hash);
    END IF;
  END IF;

  v_result:=public.create_sale_order_atomic_legacy_202701(p_header,p_items,p_client_request_id);
  v_order_id:=(v_result->>'order_id')::uuid;
  SELECT coalesce(array_agg(i.id ORDER BY i.created_at,i.id),'{}'::uuid[]),count(*)::integer
    INTO v_item_ids,v_count FROM public.sale_order_items i WHERE i.sale_order_id=v_order_id;
  IF v_order_id IS NULL OR v_count<>jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'Criacao atomica incompleta: esperado %, persistido %',
      jsonb_array_length(p_items),v_count USING ERRCODE='55000';
  END IF;
  BEGIN v_signature_at:=nullif(p_header->>'client_signature_at','')::timestamptz;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'client_signature_at invalido'; END;
  UPDATE public.sale_orders SET
    client_signature_data_url=nullif(p_header->>'client_signature_data_url',''),
    client_signature_at=v_signature_at,
    client_request_payload_hash=v_hash,
    client_request_item_count=v_count
   WHERE id=v_order_id
   RETURNING status INTO v_status;
  -- O header ja pode nascer Aprovado no mobile. O enqueue ocorre somente
  -- depois de todos os itens/snapshots existirem e na mesma transacao.
  IF v_status IN ('Aprovado','Em Produção') THEN
    PERFORM public.enqueue_sale_order_strap_demands(v_order_id,
      CASE WHEN v_status='Em Produção' THEN 'direct_production' ELSE 'approved' END,
      gen_random_uuid());
  END IF;
  RETURN v_result||jsonb_build_object('item_ids',to_jsonb(v_item_ids),
    'idempotent_replay',false,'payload_hash',v_hash);
END;
$$;

-- O escritor historico atualiza/deleta itens sem preflight de revisao,
-- teardown ou permissao por papel. Mantem o OID apenas como helper interno
-- do wrapper canonico; o nome antigo deixa de ser uma RPC publica.
DO $$
BEGIN
  IF to_regprocedure('public.update_sale_order_atomic(uuid,jsonb,jsonb)') IS NOT NULL
     AND to_regprocedure('public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)') IS NULL THEN
    ALTER FUNCTION public.update_sale_order_atomic(uuid,jsonb,jsonb)
      RENAME TO update_sale_order_atomic_legacy_202701;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.update_sale_order_with_teardown(
  p_order_id uuid,
  p_header jsonb,
  p_items jsonb,
  p_teardown_op_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_op_id uuid; v_op_status text; v_teardown uuid[]:='{}'::uuid[];
  v_item jsonb; v_item_id uuid; v_current public.sale_order_items%ROWTYPE;
  v_expected integer; v_after_source jsonb; v_changes jsonb:='[]'::jsonb;
  v_change jsonb; v_result jsonb; v_correlation uuid:=gen_random_uuid();
  v_requires_source_permission boolean:=false; v_revisions jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied: usuario nao aprovado'; END IF;
  IF NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode editar PV e desmontar OPs vinculadas';
  END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'p_items deve ser array nao vazio';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('update_sale_order_with_teardown:'||p_order_id::text,0));
  PERFORM 1 FROM public.sale_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PV nao encontrado'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
    ORDER BY coalesce(value->>'id','')
  LOOP
    v_item_id:=nullif(v_item->>'id','')::uuid;
    IF v_item_id IS NOT NULL THEN
      SELECT * INTO v_current FROM public.sale_order_items
       WHERE id=v_item_id AND sale_order_id=p_order_id FOR UPDATE;
      IF FOUND AND v_item ? 'strap_sourcing' THEN
        IF jsonb_typeof(v_item->'strap_sourcing')<>'object'
           OR nullif(v_item->>'strap_sourcing_revision','') IS NULL THEN
          RAISE EXCEPTION 'Item % exige strap_sourcing objeto e strap_sourcing_revision',v_item_id;
        END IF;
        v_expected:=(v_item->>'strap_sourcing_revision')::integer;
        IF v_expected IS DISTINCT FROM v_current.strap_sourcing_revision THEN
          RAISE EXCEPTION 'Edicao concorrente no item %: revisao atual %, esperada %',
            v_item_id,v_current.strap_sourcing_revision,v_expected USING ERRCODE='40001';
        END IF;
        v_after_source:=v_item->'strap_sourcing';
        IF v_after_source IS DISTINCT FROM v_current.strap_sourcing THEN
          v_requires_source_permission:=true;
          v_changes:=v_changes||jsonb_build_array(jsonb_build_object(
            'item_id',v_item_id,'before',v_current.strap_sourcing,
            'before_revision',v_current.strap_sourcing_revision,'after',v_after_source));
        END IF;
      END IF;
    ELSIF jsonb_typeof(v_item->'strap_sourcing')='object'
          AND v_item->'strap_sourcing'<>'{}'::jsonb THEN
      v_requires_source_permission:=true;
    END IF;
  END LOOP;
  IF v_requires_source_permission
     AND NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerencia pode definir a origem da tira no PV';
  END IF;

  FOREACH v_op_id IN ARRAY coalesce(p_teardown_op_ids,'{}'::uuid[]) LOOP
    SELECT status INTO v_op_status FROM public.orders
     WHERE id=v_op_id AND sale_order_id=p_order_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF v_op_status NOT IN ('Rascunho','Pendente','Reservado','Cancelada','Cancelado')
       OR EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.order_id=v_op_id)
       OR EXISTS (SELECT 1 FROM public.production_consumptions pc WHERE pc.order_id=v_op_id)
       OR EXISTS (SELECT 1 FROM public.material_reservations r
         WHERE r.order_id=v_op_id AND (
           coalesce(r.quantity_consumed,0)>0
           OR r.status NOT IN ('reserved','cancelled','released')))
       OR EXISTS (SELECT 1 FROM public.order_stages s
         WHERE s.order_id=v_op_id AND (
           coalesce(s.quantity_processed,0)>0
           OR lower(btrim(coalesce(s.status,''))) NOT IN
             ('pendente','pending','aguardando','bloqueado','blocked','nao iniciado','não iniciado'))) THEN
      RAISE EXCEPTION 'OP % possui inicio/fato fisico e nao pode ser desmontada; use fluxo administrativo compensatorio com motivo',
        v_op_id USING ERRCODE='55000';
    END IF;
    v_teardown:=array_append(v_teardown,v_op_id);
  END LOOP;
  IF cardinality(v_teardown)>0 THEN
    -- Somente reservas ainda totalmente reversiveis passaram pelo preflight.
    -- O token fica local a esta transacao e nao libera writer direto externo.
    PERFORM set_config('app.strap_engine_write','1',true);
    FOREACH v_op_id IN ARRAY v_teardown LOOP
      PERFORM public.release_order_reservations(v_op_id);
    END LOOP;
    DELETE FROM public.order_stages WHERE order_id=ANY(v_teardown);
    DELETE FROM public.orders WHERE id=ANY(v_teardown);
  END IF;

  PERFORM set_config('app.strap_source_rpc','1',true);
  v_result:=public.update_sale_order_atomic_legacy_202701(p_order_id,p_header,p_items);
  FOR v_change IN SELECT value FROM jsonb_array_elements(v_changes) LOOP
    SELECT * INTO v_current FROM public.sale_order_items
     WHERE id=(v_change->>'item_id')::uuid;
    INSERT INTO public.artisanal_strap_operational_audit_log(
      entity_type,entity_id,action,before_data,after_data,reason,correlation_id,actor_id)
    VALUES('sale_order_item',v_current.id,'update',
      jsonb_build_object('strap_sourcing',v_change->'before',
        'strap_sourcing_revision',(v_change->>'before_revision')::integer),
      jsonb_build_object('strap_sourcing',v_current.strap_sourcing,
        'strap_sourcing_revision',v_current.strap_sourcing_revision),
      'Escolha de origem atualizada no save atomico do PV',v_correlation,auth.uid());
  END LOOP;
  SELECT coalesce(jsonb_object_agg(i.id::text,i.strap_sourcing_revision),'{}'::jsonb)
    INTO v_revisions FROM public.sale_order_items i WHERE i.sale_order_id=p_order_id;
  RETURN v_result||jsonb_build_object('strap_sourcing_revisions',v_revisions,
    'correlation_id',v_correlation);
END;
$$;

-- Contrato executavel de cutover: authenticated nao conserva o escritor
-- historico e toda atualizacao passa pelo wrapper com papel, revisao e
-- preflight de teardown/fatos fisicos.
DO $$
DECLARE v_wrapper text:=pg_get_functiondef(
  'public.update_sale_order_with_teardown(uuid,jsonb,jsonb,uuid[])'::regprocedure);
BEGIN
  IF to_regprocedure('public.update_sale_order_atomic(uuid,jsonb,jsonb)') IS NOT NULL
     OR has_function_privilege('authenticated',
       'public.update_sale_order_atomic_legacy_202701(uuid,jsonb,jsonb)','EXECUTE')
     OR position('update_sale_order_atomic_legacy_202701' IN v_wrapper)=0
     OR position('user_has_any_role' IN v_wrapper)=0
     OR position('strap_sourcing_revision' IN v_wrapper)=0
     OR position('quantity_consumed' IN v_wrapper)=0
     OR position('stock_movements' IN v_wrapper)=0
     OR position('production_consumptions' IN v_wrapper)=0 THEN
    RAISE EXCEPTION 'Cutover inseguro: update_sale_order_atomic legado ainda contorna o wrapper canonico';
  END IF;
END;
$$;

-- Guardas de cutover contra policies legadas permissivas. Linhas nao-tira
-- continuam no fluxo antigo; qualquer identidade canonica exige token local
-- emitido pelas RPCs transacionais acima.
CREATE OR REPLACE FUNCTION public.tg_guard_strap_engine_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_source text:=coalesce(NEW.source,OLD.source); v_variant uuid:=coalesce(NEW.strap_variant_id,OLD.strap_variant_id);
BEGIN
  IF (v_source IN ('strap_engine_finished','strap_engine_base') OR v_variant IS NOT NULL)
     AND current_setting('app.strap_engine_write',true) IS DISTINCT FROM '1' THEN
    -- As duas triggers terminais vivas em orders liberam o saldo de uma OP
    -- cancelada (ou preservam partial_pending). Elas rodam aninhadas e so podem
    -- trocar o estado; identidade e quantidades permanecem congeladas. Fluxos
    -- RPC continuam exigindo o token, pois neles pg_trigger_depth()=1.
    IF TG_OP='UPDATE' AND pg_trigger_depth()>1
       AND OLD.status IN ('reserved','partially_consumed')
       AND NEW.status IN ('cancelled','pending_reconciliation')
       AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id
       AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
       AND NEW.source IS NOT DISTINCT FROM OLD.source
       AND NEW.strap_variant_id IS NOT DISTINCT FROM OLD.strap_variant_id
       AND NEW.sale_order_strap_demand_id IS NOT DISTINCT FROM OLD.sale_order_strap_demand_id
       AND NEW.finished_product_id IS NOT DISTINCT FROM OLD.finished_product_id
       AND NEW.quantity_reserved IS NOT DISTINCT FROM OLD.quantity_reserved
       AND NEW.quantity_consumed IS NOT DISTINCT FROM OLD.quantity_consumed THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Reserva canonica de tira so pode ser alterada pelo motor operacional';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_z_guard_strap_engine_reservation ON public.material_reservations;
CREATE TRIGGER trg_z_guard_strap_engine_reservation
  BEFORE INSERT OR UPDATE OR DELETE ON public.material_reservations
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_strap_engine_reservation();

CREATE OR REPLACE FUNCTION public.tg_guard_canonical_strap_service_order_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_canonical boolean:=false;
  v_new_canonical boolean:=false;
BEGIN
  IF TG_OP<>'INSERT' THEN
    v_old_canonical:=OLD.strap_variant_id IS NOT NULL
      OR OLD.strap_recipe_id IS NOT NULL
      OR OLD.strap_batch_item_id IS NOT NULL;
  END IF;
  IF TG_OP<>'DELETE' THEN
    v_new_canonical:=NEW.strap_variant_id IS NOT NULL
      OR NEW.strap_recipe_id IS NOT NULL
      OR NEW.strap_batch_item_id IS NOT NULL;
  END IF;
  IF (v_old_canonical OR v_new_canonical)
     AND current_setting('app.strap_engine_write',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Linha canonica de OS de tira so pode ser alterada pelas RPCs operacionais';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_z_guard_canonical_strap_service_order_item ON public.service_order_items;
CREATE TRIGGER trg_z_guard_canonical_strap_service_order_item
  BEFORE INSERT OR UPDATE OR DELETE ON public.service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_canonical_strap_service_order_item();

CREATE OR REPLACE FUNCTION public.tg_guard_canonical_strap_service_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_id uuid;
  v_new_id uuid;
  v_old_legacy_identity boolean:=false;
  v_new_legacy_identity boolean:=false;
  v_old_has_canonical_item boolean:=false;
  v_new_has_canonical_item boolean:=false;
BEGIN
  IF TG_OP<>'INSERT' THEN
    v_old_id:=OLD.id;
    v_old_legacy_identity:=OLD.artisanal_recipe_id IS NOT NULL
      OR nullif(btrim(coalesce(OLD.artisanal_output_name,'')),'') IS NOT NULL
      OR nullif(btrim(coalesce(OLD.artisanal_output_color,'')),'') IS NOT NULL
      OR coalesce(OLD.artisanal_output_meters,0)<>0
      OR coalesce(OLD.artisanal_for_order_meters,0)<>0
      OR coalesce(OLD.artisanal_for_stock_meters,0)<>0
      OR nullif(btrim(coalesce(OLD.artisanal_base_color,'')),'') IS NOT NULL
      OR coalesce(OLD.artisanal_stock_entry_done,false);
    SELECT EXISTS(
      SELECT 1 FROM public.service_order_items i
       WHERE i.service_order_id=v_old_id
         AND (i.strap_variant_id IS NOT NULL
           OR i.strap_recipe_id IS NOT NULL
           OR i.strap_batch_item_id IS NOT NULL)
    ) INTO v_old_has_canonical_item;
  END IF;
  IF TG_OP<>'DELETE' THEN
    v_new_id:=NEW.id;
    v_new_legacy_identity:=NEW.artisanal_recipe_id IS NOT NULL
      OR nullif(btrim(coalesce(NEW.artisanal_output_name,'')),'') IS NOT NULL
      OR nullif(btrim(coalesce(NEW.artisanal_output_color,'')),'') IS NOT NULL
      OR coalesce(NEW.artisanal_output_meters,0)<>0
      OR coalesce(NEW.artisanal_for_order_meters,0)<>0
      OR coalesce(NEW.artisanal_for_stock_meters,0)<>0
      OR nullif(btrim(coalesce(NEW.artisanal_base_color,'')),'') IS NOT NULL
      OR coalesce(NEW.artisanal_stock_entry_done,false);
    SELECT EXISTS(
      SELECT 1 FROM public.service_order_items i
       WHERE i.service_order_id=v_new_id
         AND (i.strap_variant_id IS NOT NULL
           OR i.strap_recipe_id IS NOT NULL
           OR i.strap_batch_item_id IS NOT NULL)
    ) INTO v_new_has_canonical_item;
  END IF;

  IF (v_old_legacy_identity OR v_new_legacy_identity
      OR v_old_has_canonical_item OR v_new_has_canonical_item)
     AND current_setting('app.strap_engine_write',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION USING
      ERRCODE='42501',
      MESSAGE='OS artesanal legada/canonica so pode ser alterada pelas RPCs operacionais';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_z_guard_canonical_strap_service_order ON public.service_orders;
CREATE TRIGGER trg_z_guard_canonical_strap_service_order
  BEFORE INSERT OR UPDATE OR DELETE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_canonical_strap_service_order();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid='public.service_orders'::regclass
       AND t.tgname='trg_z_guard_canonical_strap_service_order'
       AND NOT t.tgisinternal
       AND (t.tgtype::integer & 31)=31
  ) THEN
    RAISE EXCEPTION 'Cutover invalido: guard de service_orders nao cobre BEFORE I/U/D';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_guard_canonical_strap_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_canonical boolean;
BEGIN
  v_canonical:=coalesce(NEW.strap_variant_id,OLD.strap_variant_id) IS NOT NULL
    OR coalesce(NEW.sale_order_strap_demand_id,OLD.sale_order_strap_demand_id) IS NOT NULL
    OR coalesce(NEW.strap_batch_item_id,OLD.strap_batch_item_id) IS NOT NULL
    OR coalesce(NEW.strap_production_receipt_id,OLD.strap_production_receipt_id) IS NOT NULL
    OR coalesce(NEW.purchase_receipt_item_id,OLD.purchase_receipt_item_id) IS NOT NULL;
  IF v_canonical AND current_setting('app.strap_engine_write',true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Movimento canonico de tira so pode ser criado pela RPC parcial/settlement';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_z_guard_canonical_strap_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_z_guard_canonical_strap_stock_movement
  BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_canonical_strap_stock_movement();

-- Cutover cadastral legado: preserva o historico de receitas antigas, remove
-- todos os escritores e deixa o custo visivel apenas ao gate financeiro.
DO $$
DECLARE v_policy record;
BEGIN
  FOR v_policy IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='artisanal_recipes'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.artisanal_recipes',v_policy.policyname);
  END LOOP;
END;
$$;
ALTER TABLE public.artisanal_recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_artisanal_recipes_financial_select
  ON public.artisanal_recipes FOR SELECT TO authenticated
  USING ((SELECT public.can_see_strap_financial_values()));
GRANT SELECT ON public.artisanal_recipes TO authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.artisanal_recipes
  FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='artisanal_recipes' AND cmd<>'SELECT')
     OR has_table_privilege('authenticated','public.artisanal_recipes','INSERT')
     OR has_table_privilege('authenticated','public.artisanal_recipes','UPDATE')
     OR has_table_privilege('authenticated','public.artisanal_recipes','DELETE') THEN
    RAISE EXCEPTION 'Cutover incompleto: artisanal_recipes legado ainda aceita escrita';
  END IF;
END;
$$;

-- Policies permissivas legadas nao podem contornar a revisao otimista da
-- origem. Mantemos escrita direta nas demais colunas, mas strap_sourcing e sua
-- revisao so sao gravadas pelas RPCs/atômicos SECURITY DEFINER.
DO $$
DECLARE v_insert_columns text; v_update_columns text;
BEGIN
  REVOKE INSERT,UPDATE ON public.sale_order_items FROM PUBLIC,anon,authenticated;
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum)
    INTO v_insert_columns
    FROM pg_attribute a
   WHERE a.attrelid='public.sale_order_items'::regclass AND a.attnum>0 AND NOT a.attisdropped
     AND a.attgenerated='' AND a.attname NOT IN ('strap_sourcing','strap_sourcing_revision');
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum)
    INTO v_update_columns
    FROM pg_attribute a
   WHERE a.attrelid='public.sale_order_items'::regclass AND a.attnum>0 AND NOT a.attisdropped
     AND a.attgenerated='' AND a.attname NOT IN ('id','sale_order_id','strap_sourcing','strap_sourcing_revision');
  EXECUTE format('GRANT INSERT (%s) ON public.sale_order_items TO authenticated',v_insert_columns);
  EXECUTE format('GRANT UPDATE (%s) ON public.sale_order_items TO authenticated',v_update_columns);
  IF has_column_privilege('authenticated','public.sale_order_items','strap_sourcing','UPDATE')
     OR has_column_privilege('authenticated','public.sale_order_items','strap_sourcing','INSERT') THEN
    RAISE EXCEPTION 'Cutover incompleto: strap_sourcing ainda gravavel diretamente';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_guard_strap_engine_reservation(),
  public.tg_guard_canonical_strap_service_order_item(),
  public.tg_guard_canonical_strap_service_order(),
  public.tg_guard_canonical_strap_stock_movement()
FROM PUBLIC,anon,authenticated;

-- Fecha o default EXECUTE PUBLIC de todas as funcoes definidas neste motor.
-- Somente a allow-list abaixo volta a ser RPC de authenticated.
DO $$
DECLARE v_name text; v_proc record;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'strap_payload_hash','normalize_strap_payment_terms','is_valid_strap_payment_terms',
    'build_strap_payment_installments','refresh_strap_purchase_cashflow_forecast',
    'calculate_strap_line_required_m','deprecated_strap_stock_noop',
    'resolve_artisanal_strap_source_availability',
    'assert_artisanal_strap_variant_activation',
    'debit_strap_stock','tg_cancel_service_orders_on_pv_cancel',
    'is_canonical_strap_purchase_order','get_strap_purchase_order_document',
    'bind_strap_finished_reservations_to_order',
    'tg_bind_strap_finished_reservations_to_order','tg_enrich_strap_finished_stock_movement',
    'tg_attach_strap_finished_movement_to_reservation',
    'tg_settle_strap_finished_demand','is_strap_calendar_open','next_strap_calendar_open_day',
    'get_previous_strap_open_week','strap_base_available_now','resolve_strap_base_group_id',
    'resolve_strap_billing_anchor_value','resolve_strap_sale_order_billing_anchor',
    'resolve_sale_order_main_production_start','preview_sale_order_strap_demand_draft',
    'preview_sale_order_strap_demand','strap_demand_has_external_commitment',
    'inspect_strap_source_override_state',
    'neutralize_strap_source_override_promises',
    'tg_version_and_guard_sale_order_item_strap_sourcing',
    'set_sale_order_item_strap_sourcing','override_sale_order_item_strap_sourcing',
    'create_sale_order_atomic','create_sale_order_atomic_legacy_202701',
    'update_sale_order_atomic_legacy_202701','update_sale_order_with_teardown',
    'capture_strap_financial_snapshot',
    'enqueue_strap_demand_job','enqueue_strap_base_availability_reconciliation',
    'enqueue_sale_order_strap_demands',
    'tg_enqueue_strap_demands_on_sale_order_confirm','tg_enqueue_strap_demands_on_item_change',
    'tg_enqueue_strap_demands_on_schedule_change',
    'claim_next_strap_demand_job','strap_committed_purchase_inbound',
    'upsert_strap_purchase_contribution','build_strap_purchase_order_commercial_snapshot',
    'refresh_strap_purchase_order_commercial_snapshot',
    'refresh_strap_purchase_order_notifications','refresh_open_strap_purchase_order_notifications',
    'materialize_strap_purchase_orders',
    'adjust_strap_purchase_order','prepare_strap_purchase_order_approval',
    'approve_strap_purchase_order','tg_guard_strap_purchase_order',
    'tg_guard_strap_purchase_order_item','tg_validate_purchase_order_item',
    'tg_assert_strap_purchase_order_item_origin',
    'strap_committed_production_inbound','strap_committed_finished_inbound',
    'schedule_strap_batch_item',
    'ensure_strap_production_contribution','recalculate_open_strap_purchase_order',
    'resolve_strap_netting_component','reconcile_strap_variant',
    'reconcile_strap_variant_local_202701',
    'process_strap_demand_job','process_next_strap_demand_job',
    'drain_strap_demand_jobs','retry_strap_demand_job','resolve_contractor_payment_cycle',
    'close_contractor_payment_cycle','mark_contractor_payment_cycle_paid',
    'lock_strap_physical_operation_scope','strap_custody_open_value',
    'reconcile_strap_service_order_completion',
    'send_strap_material_to_contractor','return_strap_material_from_contractor',
    'adjust_strap_contractor_custody','create_strap_contractor_loss_claim',
    'decide_strap_contractor_loss_claim','register_strap_purchase_receipt',
    'register_strap_production_receipt','start_strap_production_batch',
    'replan_strap_production_batch','cancel_strap_operation',
    'tg_guard_strap_service_order_custody_zero','tg_guard_strap_service_order_close',
    'suspend_strap_operation','resume_strap_operation','request_strap_rework_material',
    'decide_strap_rework_material_request','list_strap_executor_planning_config',
    'save_strap_operational_calendar','save_strap_executor_capacity',
    'save_contractor_payment_schedule','reprocess_strap_planning_after_config',
    'tg_enqueue_strap_product_stock_change','tg_enqueue_strap_commercial_change',
    'tg_enqueue_strap_catalog_change',
    'artisanal_strap_catalog_diagnostics','tg_guard_strap_engine_reservation',
    'tg_guard_canonical_strap_service_order_item','tg_guard_canonical_strap_service_order',
    'tg_guard_canonical_strap_stock_movement','assert_strap_picking_writer',
    'confirm_picking_reservation','confirm_picking_reservation_legacy_202701',
    'commit_picking_for_sale_order','commit_picking_for_sale_order_legacy_202701',
    'commit_picking_session','commit_picking_session_legacy_202701',
    'consume_all_reservations_for_order','consume_all_reservations_for_order_legacy_202701',
    'convert_reservation_to_out','convert_reservation_to_out_legacy_202701',
    'release_order_reservations','release_order_reservations_legacy_202701',
    'resync_op_material_reservations','resync_sheet_material_reservations',
    'settle_open_reservations_for_order','tg_settle_reservations_on_op_finalize',
    'tg_release_reservations_on_order_terminal','auto_release_reservations_on_op_cancel',
    'debit_reserved_materials_for_sector','tg_debit_materials_when_sector_starts',
    'tg_preserve_unstarted_sector_reservations','resync_op_atomic'
  ] LOOP
    FOR v_proc IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=v_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
        v_proc.oid::regprocedure);
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.is_canonical_strap_purchase_order(uuid),
  public.preview_sale_order_strap_demand_draft(jsonb),
  public.preview_sale_order_strap_demand(uuid),
  public.set_sale_order_item_strap_sourcing(uuid,integer,jsonb),
  public.override_sale_order_item_strap_sourcing(uuid,integer,jsonb,text,uuid),
  public.create_sale_order_atomic(jsonb,jsonb,uuid),
  public.update_sale_order_with_teardown(uuid,jsonb,jsonb,uuid[]),
  public.confirm_picking_reservation(uuid,text),
  public.commit_picking_for_sale_order(uuid),
  public.commit_picking_session(uuid),
  public.consume_all_reservations_for_order(uuid,text),
  public.convert_reservation_to_out(uuid,uuid),
  public.release_order_reservations(uuid),
  public.resync_op_atomic(uuid),
  public.resync_sheet_material_reservations(uuid),
  public.get_strap_purchase_order_document(uuid),
  public.adjust_strap_purchase_order(uuid,integer,jsonb,text,uuid),
  public.prepare_strap_purchase_order_approval(uuid,integer,text,uuid),
  public.approve_strap_purchase_order(uuid,text,text,integer,text,uuid,uuid),
  public.retry_strap_demand_job(uuid),
  public.close_contractor_payment_cycle(uuid,text,uuid),
  public.mark_contractor_payment_cycle_paid(uuid,date,text,uuid),
  public.send_strap_material_to_contractor(uuid,numeric,text,text,timestamptz,uuid),
  public.return_strap_material_from_contractor(uuid,numeric,text,text,timestamptz,uuid),
  public.adjust_strap_contractor_custody(uuid,numeric,text,text,timestamptz,uuid),
  public.create_strap_contractor_loss_claim(uuid,numeric,text,text,jsonb,text,uuid,uuid),
  public.decide_strap_contractor_loss_claim(uuid,text,text,uuid),
  public.register_strap_purchase_receipt(uuid,numeric,numeric,numeric,numeric,text,date,jsonb,text,text,text,text,timestamptz,text,uuid),
  public.register_strap_production_receipt(uuid,uuid,numeric,numeric,numeric,numeric,text,numeric,text,timestamptz,text,uuid,jsonb),
  public.schedule_strap_batch_item(uuid,text,uuid),
  public.start_strap_production_batch(uuid,text,uuid),
  public.replan_strap_production_batch(uuid,text,uuid),
  public.cancel_strap_operation(text,uuid,text,uuid),
  public.suspend_strap_operation(text,uuid,text,uuid),
  public.resume_strap_operation(text,uuid,uuid,text),
  public.request_strap_rework_material(uuid,numeric,text,text,uuid),
  public.decide_strap_rework_material_request(uuid,text,numeric,text,uuid),
  public.list_strap_executor_planning_config(),
  public.save_strap_operational_calendar(jsonb,text,uuid),
  public.save_strap_executor_capacity(text,uuid,numeric,uuid,date,text,uuid),
  public.save_contractor_payment_schedule(uuid,text,integer,integer,integer,integer,integer,text,uuid,date,text,uuid),
  public.artisanal_strap_catalog_diagnostics()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.convert_reservation_to_out(uuid,uuid),
  public.release_order_reservations(uuid),
  public.resync_sheet_material_reservations(uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.drain_strap_demand_jobs(integer,text) TO service_role;
