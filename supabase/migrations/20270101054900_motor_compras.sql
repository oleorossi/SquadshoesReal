-- ════════════════════════════════════════════════════════════════════════════
-- Motor de produção · 3/3 — Compras automáticas do motor.
--
--  * OC do kit do cabedal complexo (rascunho, gerada pelo outbox ao aprovar):
--    chegar = ENVIO ao prestador; comprar = chegar − lead; sector_need_date =
--    envio; expedite quando o PV é urgente ou o comprar-até cai na janela de
--    urgência. Continua rascunho/sugerida: OC real só pelo clique "Gerar OC".
--  * purchase_order_motor_priority: ordem e destaque das OCs em rascunho
--    (atrasada → urgente → normal; comprar-até; envio; semana de faturamento
--    do PV) e marca o que passa do teto semanal de compra (Prazos do motor).
--    Recalculada a cada recompute da agenda e a cada OC do kit.
--  * list_cabedal_motor_purchase_snapshot: materiais por ITEM (ficha × grade)
--    — acabou a multiplicação das reservas do PV pelo nº de itens.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.purchase_order_motor_priority (
  purchase_order_id uuid PRIMARY KEY REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  motor_rank integer NOT NULL,
  urgency text NOT NULL CHECK (urgency IN ('atrasada', 'urgente', 'normal')),
  material_need_date date,
  purchase_by_date date,
  send_to_contractor_date date,
  lead_days integer,
  billing_anchor date,
  is_urgent_pv boolean NOT NULL DEFAULT false,
  purchase_week date,
  week_cumulative_brl numeric,
  over_weekly_cap boolean NOT NULL DEFAULT false,
  reason text,
  computed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.purchase_order_motor_priority IS
  'Prioridade do motor para OCs automáticas em rascunho/sugeridas (topo e destaque na lista de OCs). Não muda a OC; reescrita a cada recálculo.';
COMMENT ON COLUMN public.purchase_order_motor_priority.material_need_date IS
  'Data em que o material precisa estar na fábrica segundo o motor: kit do Ateliê = envio ao prestador; demais = semana de faturamento − "pronto antes do faturamento" (Prazos do motor).';
COMMENT ON COLUMN public.purchase_order_motor_priority.purchase_by_date IS
  'Comprar até = material_need_date − lead do fornecedor (cadastro do produto/fornecedor ou "lead padrão de OC").';

ALTER TABLE public.purchase_order_motor_priority ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_order_motor_priority_select ON public.purchase_order_motor_priority;
CREATE POLICY purchase_order_motor_priority_select ON public.purchase_order_motor_priority
  FOR SELECT TO authenticated USING (public.is_approved_user());
REVOKE ALL ON public.purchase_order_motor_priority FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.purchase_order_motor_priority FROM authenticated;
GRANT SELECT ON public.purchase_order_motor_priority TO authenticated;
GRANT ALL ON public.purchase_order_motor_priority TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_purchase_order_motor_priority()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := public.br_today();
  v_window int;
  v_cap numeric;
  v_ready_before int;
  v_default_lead int := public.motor_default_oc_lead_days();
  v_n int := 0;
BEGIN
  SELECT COALESCE(s.oc_urgency_window_business_days, 2), s.weekly_purchase_cap_brl,
         COALESCE(s.ready_before_billing_days, 7)
    INTO v_window, v_cap, v_ready_before
    FROM public.atelier_settings s WHERE s.id = 1;
  v_window := COALESCE(v_window, 2);
  v_ready_before := COALESCE(v_ready_before, 7);

  DELETE FROM public.purchase_order_motor_priority;

  INSERT INTO public.purchase_order_motor_priority (
    purchase_order_id, motor_rank, urgency, material_need_date, purchase_by_date, send_to_contractor_date,
    lead_days, billing_anchor, is_urgent_pv, purchase_week, week_cumulative_brl, over_weekly_cap, reason, computed_at
  )
  WITH po AS (
    SELECT p.id, p.source_type, p.purchase_by_date AS po_buy, p.sector_need_date AS po_need, p.promised_date,
           p.total_value, p.created_at, p.expedite,
           GREATEST(COALESCE(NULLIF(p.eta_days, 0), v_default_lead), 0) AS lead,
           COALESCE(p.linked_sale_order_ids, ARRAY[]::uuid[]) || COALESCE(p.source_pv_ids, ARRAY[]::uuid[]) AS pvs
      FROM public.purchase_orders p
     WHERE p.status IN ('draft', 'suggested')
       AND p.cancelled_at IS NULL
       AND COALESCE(p.auto_generated, false)
  ),
  enr AS (
    SELECT po.*,
           (SELECT bool_or(lower(btrim(COALESCE(so.order_type, ''))) = 'urgente')
              FROM public.sale_orders so WHERE so.id = ANY (po.pvs) AND so.deleted_at IS NULL) AS urgent_pv,
           (SELECT MIN(COALESCE(public.cabedal_prep_billing_start(so.billing_week), so.delivery_deadline))
              FROM public.sale_orders so WHERE so.id = ANY (po.pvs) AND so.deleted_at IS NULL) AS anchor
      FROM po
  ),
  dated AS (
    SELECT e.*,
           CASE WHEN e.source_type = 'cabedal_prep' THEN COALESCE(e.po_need, e.promised_date) END AS send_date,
           CASE
             WHEN e.source_type = 'cabedal_prep' THEN COALESCE(e.po_need, e.promised_date)
             WHEN e.anchor IS NOT NULL THEN e.anchor - v_ready_before
             ELSE e.po_need
           END AS need
      FROM enr e
  ),
  bought AS (
    SELECT d.*,
           CASE WHEN d.need IS NOT NULL THEN d.need - d.lead ELSE d.po_buy END AS buy
      FROM dated d
  ),
  cls AS (
    SELECT b.*,
           CASE
             WHEN b.buy IS NOT NULL AND b.buy < v_today THEN 'atrasada'
             WHEN COALESCE(b.urgent_pv, false) OR COALESCE(b.expedite, false)
                  OR (b.buy IS NOT NULL AND b.buy <= public.add_business_days(v_today, v_window)) THEN 'urgente'
             ELSE 'normal'
           END AS urgency
      FROM bought b
  ),
  ranked AS (
    SELECT c.*,
           row_number() OVER (
             ORDER BY CASE c.urgency WHEN 'atrasada' THEN 0 WHEN 'urgente' THEN 1 ELSE 2 END,
                      c.buy NULLS LAST, c.need NULLS LAST,
                      c.anchor NULLS LAST, c.created_at, c.id
           )::int AS rnk,
           date_trunc('week', GREATEST(COALESCE(c.buy, v_today), v_today))::date AS wk
      FROM cls c
  ),
  cum AS (
    SELECT r.*,
           SUM(COALESCE(r.total_value, 0)) OVER (PARTITION BY r.wk ORDER BY r.rnk
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS wk_cum
      FROM ranked r
  )
  SELECT c.id, c.rnk, c.urgency, c.need, c.buy, c.send_date, c.lead, c.anchor,
         COALESCE(c.urgent_pv, false), c.wk, c.wk_cum,
         (v_cap IS NOT NULL AND c.wk_cum > v_cap),
         concat_ws(' · ',
           CASE c.urgency WHEN 'atrasada' THEN 'comprar-até ' || to_char(c.buy, 'DD/MM') || ' já passou'
                          WHEN 'urgente' THEN CASE WHEN COALESCE(c.urgent_pv, false) THEN 'PV urgente'
                                                   WHEN COALESCE(c.expedite, false) THEN 'acelerar entrega'
                                                   ELSE 'comprar até ' || to_char(c.buy, 'DD/MM') END
                          ELSE CASE WHEN c.buy IS NOT NULL THEN 'comprar até ' || to_char(c.buy, 'DD/MM') END END,
           CASE WHEN c.send_date IS NOT NULL THEN 'envio ao prestador ' || to_char(c.send_date, 'DD/MM')
                WHEN c.need IS NOT NULL THEN 'material na fábrica até ' || to_char(c.need, 'DD/MM') END,
           CASE WHEN v_cap IS NOT NULL AND c.wk_cum > v_cap THEN 'passa do teto semanal' END),
         now()
    FROM cum c;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- A OC do kit nasce com as datas do motor (chegar = envio ao prestador). O
-- gatilho de despacho recalculava sector_need_date/comprar-até pela "onda" do
-- PV logo depois do INSERT e apagava essas datas. Para OC do kit (cabedal_prep)
-- as datas já gravadas são mantidas; demais OCs seguem como antes.
CREATE OR REPLACE FUNCTION public.refresh_purchase_order_dispatch_fields(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pvs uuid[];
  v_need date;
  v_buy date;
  v_setup integer;
BEGIN
  SELECT COALESCE(NULLIF(linked_sale_order_ids, '{}'::uuid[]),
                  NULLIF(source_pv_ids, '{}'::uuid[]))
    INTO v_pvs
    FROM public.purchase_orders
   WHERE id = p_po_id;

  IF v_pvs IS NULL THEN
    UPDATE public.purchase_orders
       SET source_pv_labels = '[]'::jsonb,
           updated_at = now()
     WHERE id = p_po_id;
    RETURN;
  END IF;

  SELECT d.sector_need_date, d.purchase_by_date, d.setup_days
    INTO v_need, v_buy, v_setup
    FROM public.compute_po_need_and_purchase_dates(v_pvs) d;

  UPDATE public.purchase_orders
     SET source_pv_labels = public.build_source_pv_labels(v_pvs),
         sector_need_date = CASE WHEN source_type = 'cabedal_prep' AND sector_need_date IS NOT NULL
                                 THEN sector_need_date ELSE COALESCE(v_need, sector_need_date) END,
         purchase_by_date = CASE WHEN source_type = 'cabedal_prep' AND purchase_by_date IS NOT NULL
                                 THEN purchase_by_date ELSE COALESCE(v_buy, purchase_by_date) END,
         setup_days_applied = COALESCE(v_setup, setup_days_applied),
         updated_at = now()
   WHERE id = p_po_id
     AND status IN ('suggested', 'draft', 'pending')
     AND exported_at IS NULL
     AND COALESCE(approval_status, 'pendente_aprovacao') = 'pendente_aprovacao';
END;
$function$;
REVOKE ALL ON FUNCTION public.refresh_purchase_order_dispatch_fields(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_purchase_order_dispatch_fields(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_purchase_order_motor_priority() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_purchase_order_motor_priority() TO service_role;

-- ─── OC do kit: chegar até o envio ao prestador, já priorizada ──────────
CREATE OR REPLACE FUNCTION public.process_cabedal_prep_purchase_shortages_po(p_sale_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_send date;
  v_urgent boolean := false;
  v_window int;
  v_expedite boolean := false;
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

    -- motor_compras_20270101054900: o kit tem de CHEGAR até o envio ao
    -- prestador (envio = pronto − prazo do prestador); comprar = chegar − lead.
    SELECT MIN(j.target_start) INTO v_send
      FROM public.cabedal_prep_jobs j
     WHERE j.sale_order_id = p_sale_order_id
       AND j.pipeline_status = 'awaiting_cut'
       AND j.target_start IS NOT NULL;
    IF v_send IS NOT NULL THEN
      v_lead := COALESCE(v_lead, public.motor_default_oc_lead_days());
      v_promised := v_send;
      v_buy := v_send - GREATEST(v_lead, 0);
    END IF;
    SELECT (lower(btrim(COALESCE(so.order_type, ''))) = 'urgente') INTO v_urgent
      FROM public.sale_orders so WHERE so.id = p_sale_order_id;
    SELECT COALESCE(s.oc_urgency_window_business_days, 2) INTO v_window
      FROM public.atelier_settings s WHERE s.id = 1;
    v_expedite := COALESCE(v_urgent, false)
      OR (v_buy IS NOT NULL AND v_buy <= public.add_business_days(public.br_today(), COALESCE(v_window, 2)));

    SELECT po.id INTO v_po_id
      FROM public.purchase_orders po
     WHERE po.idempotency_key = v_idem
     LIMIT 1;

    IF v_po_id IS NOT NULL THEN
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
               sector_need_date = CASE
                 WHEN v_send IS NULL THEN po.sector_need_date
                 WHEN po.sector_need_date IS NULL THEN v_send
                 ELSE LEAST(po.sector_need_date, v_send)
               END,
               expedite = COALESCE(po.expedite, false) OR v_expedite,
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
      purchase_by_date, promised_date, eta_days,
      sector_need_date, expedite
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
      v_lead,
      v_send,
      v_expedite
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

  -- Rascunho já nasce priorizado (topo/destaque na lista de OCs)
  BEGIN
    PERFORM public.refresh_purchase_order_motor_priority();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[cabedal_prep_po] prioridade de OC não atualizada: %', SQLERRM;
  END;

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
$function$
;

-- ─── Snapshot do motor: materiais por item ──────────────────────────────
CREATE OR REPLACE FUNCTION public.list_cabedal_motor_purchase_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT public.is_approved_user() THEN jsonb_build_object(
      'motor_enabled', false,
      'items', '[]'::jsonb,
      'stock', '[]'::jsonb
    )
    ELSE jsonb_build_object(
      'motor_enabled', COALESCE((SELECT s.auto_motor_enabled FROM public.atelier_settings s WHERE s.id = 1), false),
      'urgent_release_without_material', COALESCE((SELECT s.urgent_release_without_material FROM public.atelier_settings s WHERE s.id = 1), false),
      'purchase_horizon_business_days', COALESCE((SELECT s.purchase_horizon_business_days FROM public.atelier_settings s WHERE s.id = 1), 10),
      'weekly_purchase_cap_brl', (SELECT s.weekly_purchase_cap_brl FROM public.atelier_settings s WHERE s.id = 1),
      'buffer_business_days', COALESCE((SELECT s.buffer_business_days FROM public.atelier_settings s WHERE s.id = 1), 2),
      'ready_before_billing_days', COALESCE((SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1), 7),
      'default_oc_lead_days', public.motor_default_oc_lead_days(),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sale_order_id', so.id,
          'order_number', so.order_number,
          'order_type', so.order_type,
          'billing_week', so.billing_week,
          'item_id', soi.id,
          'reference_code', COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), ''),
          'color', soi.color,
          'pairs', soi.quantity,
          'assembly_capacity_per_day', ts.assembly_capacity_per_day,
          'prep_business_days', CASE
            WHEN cardinality(public.atelier_reference_street_sectors(soi.reference_id)) > 0
            THEN (SELECT MAX(public.atelier_effective_prep_business_days(soi.reference_id, x))
                    FROM unnest(public.atelier_reference_street_sectors(soi.reference_id)) x)
          END,
          'explicit_complex', EXISTS (
            SELECT 1
              FROM public.atelier_complex_references acr
             WHERE acr.reference_id = soi.reference_id
               AND acr.active IS TRUE
               AND acr.sector IN ('costura_cabedal', 'aviamento')
          ),
          'materials', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'product_id', p.id,
              'product_name', p.name,
              'unit', p.unit,
              'required', agg.required,
              'unit_price', p.unit_price,
              'supplier_id', s.id,
              'supplier_name', s.name,
              'supplier_lead_days', public.get_effective_supplier_lead_days(p.id, NULL)
            ))
              FROM (
                -- motor_compras_20270101054900: consumo DESTE item (ficha × grade),
                -- não as reservas do PV inteiro repetidas em cada item.
                SELECT d.product_id, SUM(d.required) AS required
                  FROM public.sale_order_material_demand_lines(so.id) d
                 WHERE d.sale_order_item_id = soi.id
                 GROUP BY d.product_id
                UNION ALL
                -- solado (sole_grade) é por OP do item
                SELECT mr.product_id,
                       SUM(COALESCE(mr.quantity_reserved, 0) + COALESCE(mr.quantity_short, 0))
                  FROM public.material_reservations mr
                  JOIN public.orders o ON o.id = mr.order_id
                 WHERE mr.status = 'reserved'
                   AND o.sale_order_item_id = soi.id
                   AND COALESCE(mr.metadata ->> 'kind', '') = 'sole_grade'
                 GROUP BY mr.product_id
              ) agg
              JOIN public.products p ON p.id = agg.product_id
              LEFT JOIN public.suppliers s ON s.id = p.supplier_id
             WHERE agg.required > 0
          ), '[]'::jsonb)
        ))
          FROM public.sale_orders so
          JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
          LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
         WHERE so.deleted_at IS NULL
           AND so.status IN ('Aprovado', 'Em Produção')
           AND soi.production_excluded_at IS NULL
           AND COALESCE(soi.quantity, 0) > 0
      ), '[]'::jsonb),
      'stock', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'product_id', p.id,
          'free', GREATEST(COALESCE(p.quantity, 0), 0)
        ))
          FROM public.products p
         WHERE p.id IN (
           SELECT mr.product_id
             FROM public.material_reservations mr
            WHERE mr.status = 'reserved'
         )
      ), '[]'::jsonb)
    )
  END;
$function$
;

GRANT EXECUTE ON FUNCTION public.list_cabedal_motor_purchase_snapshot() TO authenticated, service_role;

SELECT public.refresh_purchase_order_motor_priority();
