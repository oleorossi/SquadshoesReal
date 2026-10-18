-- OC Ateliê: comprar e receber o material ANTES do pronto do cabedal.
-- Só quando NÃO há estoque (shortage > 0 em compute_materials_per_pv) — sem falta, sem OC.
-- Cadeia (calendário):
--   purchase_by = promised − lead_fornecedor
--   promised    = ready − GREATEST(costura_offset, aviamento_offset)  -- tempo corte→prestador→volta
--   ready       = início semana faturamento − ready_before_billing_days (já na materialize)
-- Assim o cabedal chega pronto quando o pedido precisa entrar em produção.

-- ─── 1. Helper puro: datas da OC a partir da meta de pronto ───────────────────
CREATE OR REPLACE FUNCTION public.atelier_oc_dates_from_ready(
  p_ready_date date,
  p_product_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  ready_date date,
  promised_date date,
  purchase_by_date date,
  pipeline_days integer,
  lead_days integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline int;
  v_lead int;
  v_promised date;
  v_buy date;
  v_pid uuid;
BEGIN
  IF p_ready_date IS NULL THEN
    RETURN;
  END IF;

  SELECT GREATEST(
           COALESCE(s.costura_offset_days, 5),
           COALESCE(s.aviamento_offset_days, 5)
         )
    INTO v_pipeline
    FROM public.atelier_settings s
   WHERE s.id = 1;
  v_pipeline := GREATEST(0, COALESCE(v_pipeline, 5));

  v_lead := 10;
  IF p_product_ids IS NOT NULL AND coalesce(array_length(p_product_ids, 1), 0) > 0 THEN
    v_lead := 0;
    FOREACH v_pid IN ARRAY p_product_ids
    LOOP
      v_lead := GREATEST(
        v_lead,
        COALESCE(public.get_effective_supplier_lead_days(v_pid, NULL), 10)
      );
    END LOOP;
    IF v_lead <= 0 THEN
      v_lead := 10;
    END IF;
  END IF;

  v_promised := p_ready_date - v_pipeline;
  v_buy := v_promised - v_lead;

  ready_date := p_ready_date;
  promised_date := v_promised;
  purchase_by_date := v_buy;
  pipeline_days := v_pipeline;
  lead_days := v_lead;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.atelier_oc_dates_from_ready(date, uuid[]) IS
  'Datas da OC do kit Ateliê: promised = ready − max(offsets Costura/Aviamento); purchase_by = promised − lead do fornecedor.';

REVOKE ALL ON FUNCTION public.atelier_oc_dates_from_ready(date, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atelier_oc_dates_from_ready(date, uuid[])
  TO authenticated, service_role;

-- ─── 2. Reescreve o gerador de OC com as datas antecipadas ───────────────────
CREATE OR REPLACE FUNCTION public.process_cabedal_prep_purchase_shortages_po(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_mat record;
  v_supplier_id uuid;
  v_supplier_name text;
  v_idem text;
  v_po_id uuid;
  v_created int := 0;
  v_reused int := 0;
  v_skipped int := 0;
  v_cabedal_ids uuid[];
  v_by_supplier jsonb := '{}'::jsonb;
  v_key text;
  v_items jsonb;
  v_entry jsonb;
  v_total numeric;
  v_ready date;
  v_promised date;
  v_buy date;
  v_pipeline int;
  v_lead int;
  v_product_ids uuid[];
  v_timing record;
BEGIN
  SELECT MIN(d.ready_date)
    INTO v_ready
    FROM public.cabedal_prep_demands d
   WHERE d.sale_order_id = p_sale_order_id
     AND d.status IN ('open', 'planned', 'stale')
     AND d.ready_date IS NOT NULL;

  SELECT so.status INTO v_status
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id AND so.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'sale_order_not_found');
  END IF;
  IF v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'status_not_aprovado');
  END IF;

  -- materialize roda no wrapper (erro sobe)

  SELECT COALESCE(array_agg(DISTINCT c.product_id), ARRAY[]::uuid[])
    INTO v_cabedal_ids
    FROM public.cabedal_prep_material_product_ids(p_sale_order_id) c;

  IF coalesce(array_length(v_cabedal_ids, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'created', 0, 'reason', 'no_cabedal_products');
  END IF;

  FOR v_mat IN
    SELECT need.*
      FROM public.compute_materials_per_pv(ARRAY[p_sale_order_id]) need
     WHERE COALESCE(need.shortage, 0) > 0
       AND need.material_id = ANY (v_cabedal_ids)
       AND NOT COALESCE(need.is_artisanal, false)
       AND COALESCE(need.last_unit_price, 0) > 0
  LOOP
    v_key := CASE
      WHEN v_mat.supplier_id IS NULL THEN 'none'
      ELSE 'supplier:' || v_mat.supplier_id::text
    END;
    v_entry := jsonb_build_object(
      'product_id', v_mat.material_id,
      'product_name', v_mat.product_name,
      'quantity', v_mat.shortage,
      'unit_price', v_mat.last_unit_price,
      'unit', COALESCE(NULLIF(btrim(v_mat.unit), ''), 'un'),
      'color', NULLIF(v_mat.color, ''),
      'current_stock', COALESCE(v_mat.stock_qty, 0)
    );
    IF v_by_supplier ? v_key THEN
      v_by_supplier := jsonb_set(
        v_by_supplier,
        ARRAY[v_key, 'items'],
        (v_by_supplier -> v_key -> 'items') || jsonb_build_array(v_entry)
      );
    ELSE
      v_by_supplier := v_by_supplier || jsonb_build_object(
        v_key,
        jsonb_build_object(
          'supplier_id', v_mat.supplier_id,
          'supplier_name', COALESCE(NULLIF(btrim(v_mat.supplier_name), ''), 'A definir'),
          'items', jsonb_build_array(v_entry)
        )
      );
    END IF;
  END LOOP;

  FOR v_key, v_entry IN SELECT * FROM jsonb_each(v_by_supplier)
  LOOP
    v_supplier_id := NULLIF(v_entry ->> 'supplier_id', '')::uuid;
    v_supplier_name := v_entry ->> 'supplier_name';
    v_items := v_entry -> 'items';
    v_idem := 'cabedal_prep:outbox:' || COALESCE(v_supplier_id::text, 'none') || ':' || p_sale_order_id::text;

    SELECT COALESCE(array_agg(DISTINCT (i ->> 'product_id')::uuid), ARRAY[]::uuid[])
      INTO v_product_ids
      FROM jsonb_array_elements(v_items) i
     WHERE NULLIF(i ->> 'product_id', '') IS NOT NULL;

    SELECT t.*
      INTO v_timing
      FROM public.atelier_oc_dates_from_ready(v_ready, v_product_ids) t
     LIMIT 1;

    v_promised := v_timing.promised_date;
    v_buy := v_timing.purchase_by_date;
    v_pipeline := v_timing.pipeline_days;
    v_lead := v_timing.lead_days;

    SELECT po.id INTO v_po_id
      FROM public.purchase_orders po
     WHERE po.idempotency_key = v_idem
     LIMIT 1;

    IF v_po_id IS NOT NULL THEN
      -- Reuso: puxa metas se a cadeia Ateliê ficou mais cedo.
      IF v_buy IS NOT NULL OR v_promised IS NOT NULL THEN
        UPDATE public.purchase_orders po
           SET purchase_by_date = CASE
                 WHEN v_buy IS NULL THEN po.purchase_by_date
                 WHEN po.purchase_by_date IS NULL THEN v_buy
                 ELSE LEAST(po.purchase_by_date, v_buy)
               END,
               promised_date = CASE
                 WHEN v_promised IS NULL THEN po.promised_date
                 WHEN po.promised_date IS NULL THEN v_promised
                 ELSE LEAST(po.promised_date, v_promised)
               END,
               eta_days = COALESCE(v_lead, po.eta_days),
               notes = CASE
                 WHEN po.notes LIKE 'OC Ateliê (kit)%' OR po.notes LIKE 'OC preparação de cabedal%'
                 THEN 'OC Ateliê (kit) · pronto ' || COALESCE(v_ready::text, '?')
                      || ' · chegar ' || COALESCE(v_promised::text, '?')
                      || ' · comprar até ' || COALESCE(v_buy::text, '?')
                      || ' · PV ' || p_sale_order_id::text
                 ELSE po.notes
               END,
               updated_at = now()
         WHERE po.id = v_po_id
           AND (
             (v_buy IS NOT NULL AND (po.purchase_by_date IS NULL OR po.purchase_by_date > v_buy))
             OR (v_promised IS NOT NULL AND (po.promised_date IS NULL OR po.promised_date > v_promised))
           );
      END IF;
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM((i ->> 'quantity')::numeric * (i ->> 'unit_price')::numeric), 0)
      INTO v_total
      FROM jsonb_array_elements(v_items) i;

    INSERT INTO public.purchase_orders(
      supplier_id, supplier_name, notes, total_value, auto_generated,
      status, approval_status, source_type, source_pv_ids,
      linked_sale_order_ids, idempotency_key,
      purchase_by_date, promised_date, eta_days
    ) VALUES (
      v_supplier_id,
      v_supplier_name,
      'OC Ateliê (kit) · pronto ' || COALESCE(v_ready::text, '?')
        || ' · chegar ' || COALESCE(v_promised::text, '?')
        || ' · comprar até ' || COALESCE(v_buy::text, '?')
        || ' · PV ' || p_sale_order_id::text,
      v_total,
      true,
      CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,
      'pendente_aprovacao',
      'cabedal_prep',
      ARRAY[p_sale_order_id],
      ARRAY[p_sale_order_id],
      v_idem,
      v_buy,
      v_promised,
      v_lead
    ) RETURNING id INTO v_po_id;

    INSERT INTO public.purchase_order_items (
      purchase_order_id, product_id, quantity, suggested_quantity,
      unit_price, unit, current_stock, color
    )
    SELECT
      v_po_id,
      (i ->> 'product_id')::uuid,
      (i ->> 'quantity')::numeric,
      (i ->> 'quantity')::numeric,
      (i ->> 'unit_price')::numeric,
      COALESCE(i ->> 'unit', 'un'),
      COALESCE((i ->> 'current_stock')::numeric, 0),
      i ->> 'color'
    FROM jsonb_array_elements(v_items) i;

    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'created', v_created,
    'reused', v_reused,
    'skipped', v_skipped,
    'ready_date', v_ready,
    'pipeline_days', (
      SELECT t.pipeline_days FROM public.atelier_oc_dates_from_ready(v_ready, NULL) t LIMIT 1
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', SQLERRM
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_cabedal_prep_purchase_shortages_po(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_cabedal_prep_purchase_shortages_po(uuid)
  TO service_role;

-- ─── 3. Recalcula OCs Ateliê ainda abertas (rascunho/sugerida) ───────────────
DO $backfill$
DECLARE
  r record;
  v_ready date;
  v_timing record;
  v_pids uuid[];
  v_n int := 0;
BEGIN
  FOR r IN
    SELECT po.id, po.linked_sale_order_ids
      FROM public.purchase_orders po
     WHERE po.source_type = 'cabedal_prep'
       AND po.status IN ('draft', 'suggested', 'pending')
       AND COALESCE(po.approval_status, '') IN ('pendente_aprovacao', 'pending', '')
       AND po.cancelled_at IS NULL
  LOOP
    IF r.linked_sale_order_ids IS NULL OR coalesce(array_length(r.linked_sale_order_ids, 1), 0) = 0 THEN
      CONTINUE;
    END IF;

    SELECT MIN(d.ready_date)
      INTO v_ready
      FROM public.cabedal_prep_demands d
     WHERE d.sale_order_id = ANY (r.linked_sale_order_ids)
       AND d.status IN ('open', 'planned', 'stale')
       AND d.ready_date IS NOT NULL;

    IF v_ready IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT poi.product_id), ARRAY[]::uuid[])
      INTO v_pids
      FROM public.purchase_order_items poi
     WHERE poi.purchase_order_id = r.id;

    SELECT t.* INTO v_timing
      FROM public.atelier_oc_dates_from_ready(v_ready, v_pids) t
     LIMIT 1;

    UPDATE public.purchase_orders po
       SET purchase_by_date = v_timing.purchase_by_date,
           promised_date = v_timing.promised_date,
           eta_days = v_timing.lead_days,
           notes = 'OC Ateliê (kit) · pronto ' || v_ready::text
                || ' · chegar ' || v_timing.promised_date::text
                || ' · comprar até ' || v_timing.purchase_by_date::text
                || ' · PV ' || r.linked_sale_order_ids[1]::text,
           updated_at = now()
     WHERE po.id = r.id;

    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'atelier_oc_lead_antes_pronto: % OCs abertas recalculadas', v_n;
END
$backfill$;
