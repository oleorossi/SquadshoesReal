-- 1. 20260427240000_mesa-sector-planning.sql
DROP VIEW IF EXISTS public.purchase_projection_timeline;
CREATE VIEW public.purchase_projection_timeline AS
WITH lt AS (
  SELECT
    o.id               AS order_id,
    o.order_number     AS pedido_ref,
    o.sale_order_id,
    so.delivery_deadline AS data_entrega_cliente,
    o.quantity         AS op_quantity,
    o.status           AS order_status,
    o.reference_id,
    ts.name            AS referencia_nome,
    ts.id              AS sheet_id,
    ts.shoe_category   AS sheet_category,
    CASE
      WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                      dlt.cutting_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2)
    END AS lead_time_corte_dias,
    CASE
      WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                      dlt.sewing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3)
    END AS lead_time_costura_dias,
    CASE
      WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                      dlt.assembly_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2)
    END AS lead_time_montagem_dias,
    CASE
      WHEN ts.has_straps = true AND COALESCE(ts.handling_time_minutes, 0) > 0
        THEN GREATEST(1, CEIL(ts.handling_time_minutes::numeric
                              * o.quantity::numeric / 480.0)::integer)
      ELSE 0
    END AS lead_time_mesa_dias,
    CASE
      WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
        THEN GREATEST(1, CEIL(o.quantity::numeric /
             COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                      dlt.finishing_capacity_per_day)::numeric)::integer)
      ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1)
    END AS lead_time_acabamento_dias,
    COALESCE(ts.lead_time_buffer_material_dias,
             dlt.lead_time_buffer_material_dias, 2) AS lead_time_buffer_material_dias
  FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE o.status <> ALL (ARRAY['Pronto', 'FINALIZADO', 'Cancelado'])
    AND so.delivery_deadline IS NOT NULL
)
SELECT
  lt.order_id,
  lt.pedido_ref,
  lt.sale_order_id,
  lt.data_entrega_cliente,
  lt.op_quantity,
  lt.order_status,
  lt.reference_id,
  lt.referencia_nome,
  lt.lead_time_corte_dias,
  lt.lead_time_costura_dias,
  lt.lead_time_montagem_dias,
  lt.lead_time_mesa_dias,
  lt.lead_time_acabamento_dias,
  lt.lead_time_buffer_material_dias,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias AS data_inicio_acabamento,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias AS data_inicio_mesa,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias AS data_inicio_montagem,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias AS data_inicio_costura,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias AS data_inicio_corte,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias AS data_chegada_material,
  lt.data_entrega_cliente - lt.lead_time_acabamento_dias - lt.lead_time_mesa_dias - lt.lead_time_montagem_dias - lt.lead_time_costura_dias - lt.lead_time_corte_dias - lt.lead_time_buffer_material_dias - COALESCE(m.supplier_lead_time_days, 7) AS data_limite_compra,
  m.id              AS material_id,
  m.name            AS material,
  m.group_id        AS material_group_id,
  pg.name           AS grupo_material,
  m.unit            AS unidade,
  m.quantity        AS estoque_atual,
  m.min_stock,
  m.supplier_lead_time_days,
  m.supplier_id,
  sup.name          AS supplier_name,
  COALESCE(sm.quantity_per_unit, 1::numeric) * lt.op_quantity::numeric AS quantidade_necessaria
FROM lt
  JOIN public.sheet_materials sm ON sm.sheet_id = lt.sheet_id
  JOIN public.products m ON m.id = sm.product_id
  LEFT JOIN public.product_groups pg ON pg.id = m.group_id
  LEFT JOIN public.suppliers sup ON sup.id = m.supplier_id;

DROP FUNCTION IF EXISTS public.compute_order_planned_dates() CASCADE;
CREATE OR REPLACE FUNCTION public.compute_order_planned_dates() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delivery date; v_corte int; v_costura int; v_montagem int; v_mesa int; v_acabamento int;
BEGIN
  IF NEW.sale_order_id IS NULL OR NEW.reference_id IS NULL OR NEW.quantity IS NULL THEN RETURN NEW; END IF;
  SELECT so.delivery_deadline INTO v_delivery FROM public.sale_orders so WHERE so.id = NEW.sale_order_id;
  IF v_delivery IS NULL THEN RETURN NEW; END IF;
  SELECT
    CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0 THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), dlt.cutting_capacity_per_day)::numeric)::int) ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2) END,
    CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0 THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), dlt.sewing_capacity_per_day)::numeric)::int) ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3) END,
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0 THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.assembly_capacity_per_day, 0), dlt.assembly_capacity_per_day)::numeric)::int) ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2) END,
    CASE WHEN ts.has_straps = true AND COALESCE(ts.handling_time_minutes, 0) > 0 THEN GREATEST(1, CEIL(ts.handling_time_minutes::numeric * NEW.quantity::numeric / 480.0)::int) ELSE 0 END,
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0 THEN GREATEST(1, CEIL(NEW.quantity::numeric / COALESCE(NULLIF(ts.finishing_capacity_per_day, 0), dlt.finishing_capacity_per_day)::numeric)::int) ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1) END
  INTO v_corte, v_costura, v_montagem, v_mesa, v_acabamento FROM public.technical_sheets ts LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category WHERE ts.id = NEW.reference_id;
  IF v_corte IS NULL THEN RETURN NEW; END IF;
  NEW.planned_start := v_delivery - v_acabamento - v_mesa - v_montagem - v_costura - v_corte;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_compute_order_planned_dates ON public.orders;
CREATE TRIGGER trg_compute_order_planned_dates BEFORE INSERT OR UPDATE OF quantity, sale_order_id, reference_id ON public.orders FOR EACH ROW EXECUTE FUNCTION public.compute_order_planned_dates();

-- 2. 20260428150000_block-rascunho-wave-assignment.sql
DROP FUNCTION IF EXISTS trg_fn_block_rascunho_wave_assignment() CASCADE;
CREATE OR REPLACE FUNCTION trg_fn_block_rascunho_wave_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status TEXT; v_order_number TEXT;
BEGIN
  SELECT status, order_number INTO v_status, v_order_number FROM sale_orders WHERE id = NEW.sale_order_id;
  IF v_status = 'Rascunho' THEN RAISE EXCEPTION 'O pedido % está em Rascunho.', COALESCE(v_order_number, NEW.sale_order_id::text); END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_block_rascunho_wave_assignment ON production_wave_item_sources;
CREATE TRIGGER trg_block_rascunho_wave_assignment BEFORE INSERT ON production_wave_item_sources FOR EACH ROW EXECUTE FUNCTION trg_fn_block_rascunho_wave_assignment();

-- 3. 20260428160000_fix-oc-00127-dedup.sql
DO $$
DECLARE v_po_id uuid; v_creation_date date; v_sole_id uuid; v_sole_name text; v_wave_pairs numeric; v_stock numeric; v_correct_qty numeric; v_item_id uuid; v_item_qty numeric; v_new_total numeric;
BEGIN
  SELECT id, created_at::date INTO v_po_id, v_creation_date FROM purchase_orders WHERE order_number = 'OC-2026-00127';
  IF v_po_id IS NULL THEN RETURN; END IF;
  DELETE FROM purchase_order_items WHERE purchase_order_id = v_po_id AND id NOT IN (SELECT DISTINCT ON (product_id) id FROM purchase_order_items WHERE purchase_order_id = v_po_id ORDER BY product_id, quantity DESC, created_at DESC);
  FOR v_item_id, v_sole_id, v_item_qty IN SELECT poi.id, poi.product_id, poi.quantity FROM purchase_order_items poi JOIN products p ON p.id = poi.product_id WHERE poi.purchase_order_id = v_po_id AND (lower(COALESCE(p.category, '')) LIKE '%solado%' OR lower(COALESCE(p.category, '')) = 'sola')
  LOOP
    SELECT COALESCE(SUM(pwi.total_quantity), 0) INTO v_wave_pairs FROM production_wave_items pwi JOIN production_waves pw ON pw.id = pwi.wave_id WHERE pwi.sole_product_id = v_sole_id AND pw.created_at::date BETWEEN (v_creation_date - INTERVAL '1 day') AND (v_creation_date + INTERVAL '1 day');
    SELECT COALESCE(quantity, 0) INTO v_stock FROM products WHERE id = v_sole_id;
    v_correct_qty := GREATEST(0, v_wave_pairs - v_stock);
    IF v_correct_qty = 0 THEN DELETE FROM purchase_order_items WHERE id = v_item_id;
    ELSIF v_correct_qty <> v_item_qty THEN UPDATE purchase_order_items SET quantity = v_correct_qty, suggested_quantity = v_correct_qty WHERE id = v_item_id; END IF;
  END LOOP;
  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_new_total FROM purchase_order_items WHERE purchase_order_id = v_po_id;
  UPDATE purchase_orders SET total_value = v_new_total WHERE id = v_po_id;
END; $$;

-- 4. 20260428170000_fix-artisanal-stock-inconsistencies.sql
DO $$
DECLARE rec record; v_base_prod_id uuid; v_base_qty numeric; v_base_needed numeric; v_new_qty numeric;
BEGIN
  FOR rec IN SELECT so.id AS os_id, so.order_number AS os_number, so.artisanal_output_meters AS output_meters, COALESCE(so.artisanal_base_color, so.artisanal_output_color, '') AS base_color, ar.base_product_name, ar.yield_per_meter, so.artisanal_output_meters / NULLIF(ar.yield_per_meter, 0) AS base_needed FROM service_orders so JOIN artisanal_recipes ar ON ar.id = so.artisanal_recipe_id WHERE so.status = 'Concluído' AND so.artisanal_stock_entry_done = true AND so.artisanal_recipe_id IS NOT NULL AND so.artisanal_output_meters > 0 AND EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.movement_type='in' AND sm.description ILIKE '%'||so.order_number||'%' AND sm.description ILIKE '%artesanal%') AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.movement_type='out' AND sm.description ILIKE '%'||so.order_number||'%' AND (sm.description ILIKE '%artesanal%' OR sm.description ILIKE '%Consumo artesanal%'))
  LOOP
    v_base_needed := rec.base_needed;
    SELECT p.id, p.quantity INTO v_base_prod_id, v_base_qty FROM products p WHERE (lower(p.name) = lower(rec.base_product_name) OR lower(p.name) LIKE lower(rec.base_product_name)||':%' OR lower(p.name) LIKE lower(rec.base_product_name)||' -%') AND (rec.base_color='' OR lower(COALESCE(p.color,''))=lower(rec.base_color)) ORDER BY p.updated_at DESC LIMIT 1;
    IF v_base_prod_id IS NOT NULL AND v_base_qty >= v_base_needed THEN v_new_qty := v_base_qty - v_base_needed; UPDATE products SET quantity = v_new_qty, updated_at = now() WHERE id = v_base_prod_id; INSERT INTO stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description) VALUES (v_base_prod_id, 'out', v_base_needed, v_base_qty, v_new_qty, 'Débito retroativo MP artesanal — '||rec.os_number); END IF;
  END LOOP;
END; $$;

-- 5. 20260428180000_nfe-companies-multicompany.sql
CREATE TABLE IF NOT EXISTS public.companies ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cnpj text NOT NULL, inscricao_estadual text NOT NULL DEFAULT '', razao_social text NOT NULL, nome_fantasia text NOT NULL DEFAULT '', logradouro text NOT NULL DEFAULT '', numero text NOT NULL DEFAULT '', complemento text NOT NULL DEFAULT '', bairro text NOT NULL DEFAULT '', cidade text NOT NULL DEFAULT '', uf text NOT NULL DEFAULT '', cep text NOT NULL DEFAULT '', codigo_municipio text NOT NULL DEFAULT '', regime_tributario text NOT NULL DEFAULT '1', serie_nfe integer NOT NULL DEFAULT 1, ambiente text NOT NULL DEFAULT 'homologacao', certificate_path text DEFAULT '', natureza_operacao text NOT NULL DEFAULT 'Venda de Mercadoria', cfop text NOT NULL DEFAULT '5102', is_primary boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now() );
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can manage companies" ON public.companies;
CREATE POLICY "Auth users can manage companies" ON public.companies FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE public.nfe_emitidas ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS cnpj_emitente text DEFAULT '', ADD COLUMN IF NOT EXISTS justificativa_cancelamento text DEFAULT '', ADD COLUMN IF NOT EXISTS data_cancelamento timestamptz;
DROP FUNCTION IF EXISTS public.set_companies_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.set_companies_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_companies_updated_at();

-- 6. 20260428190000_wave-material-intelligence.sql
ALTER TABLE public.production_waves ADD COLUMN IF NOT EXISTS earliest_deadline date, ADD COLUMN IF NOT EXISTS corte_start_date date, ADD COLUMN IF NOT EXISTS costura_start_date date, ADD COLUMN IF NOT EXISTS purchase_deadline date, ADD COLUMN IF NOT EXISTS material_ready_date date;

DROP FUNCTION IF EXISTS public.compute_wave_timeline(uuid[]);
CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[]) RETURNS TABLE (earliest_deadline date, corte_start_date date, costura_start_date date, montagem_start_date date, acabamento_start_date date, material_ready_date date, purchase_deadline date) LANGUAGE plpgsql STABLE AS $$
DECLARE v_lead_corte int; v_lead_costura int; v_lead_montagem int; v_lead_acab int; v_lead_buffer int; v_lead_supplier int; v_deadline date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline FROM sale_orders so WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;
  SELECT COALESCE(MAX(ts.lead_time_corte_dias),2), COALESCE(MAX(ts.lead_time_costura_dias),3), COALESCE(MAX(ts.lead_time_montagem_dias),2), COALESCE(MAX(ts.lead_time_acabamento_dias),1), COALESCE(MAX(ts.lead_time_buffer_material_dias),2) INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer FROM sale_order_items soi JOIN technical_sheets ts ON ts.id = soi.reference_id WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7) INTO v_lead_supplier FROM sale_order_items soi JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id JOIN products p ON p.id = sm.product_id WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  RETURN QUERY SELECT v_deadline, (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura - v_lead_corte)::date, (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura)::date, (v_deadline - v_lead_acab - v_lead_montagem)::date, (v_deadline - v_lead_acab)::date, (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura - v_lead_corte - v_lead_buffer)::date, (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura - v_lead_corte - v_lead_buffer - v_lead_supplier)::date;
END; $$;

DROP FUNCTION IF EXISTS public.get_wave_material_needs(uuid[]);
CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[]) RETURNS TABLE (product_id uuid, product_name text, unit text, color text, needed_qty numeric, stock_qty numeric, shortage numeric, supplier_id uuid, supplier_name text, supplier_lead_time_days int, is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text, base_product_id uuid, base_product_name text, base_needed_qty numeric, base_stock_qty numeric, base_shortage numeric, os_send_date date) LANGUAGE plpgsql STABLE AS $$
DECLARE v_corte_start date;
BEGIN
  SELECT t.corte_start_date INTO v_corte_start FROM compute_wave_timeline(p_sale_order_ids) t LIMIT 1;
  RETURN QUERY
  WITH sheet_needed AS ( SELECT sm.product_id, COALESCE(NULLIF(sm.color, ''), soi.color, '') AS effective_color, SUM(sm.quantity_per_unit * soi.quantity) AS needed_qty FROM sale_order_items soi JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id JOIN products sp ON sp.id = sm.product_id WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND lower(COALESCE(sp.category, '')) NOT LIKE '%solado%' AND lower(COALESCE(sp.category, '')) != 'sola' GROUP BY sm.product_id, COALESCE(NULLIF(sm.color, ''), soi.color, '') ),
  sole_needed AS ( SELECT rsc.sole_product_id AS product_id, COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '') AS effective_color, SUM(soi.quantity) AS needed_qty FROM sale_order_items soi CROSS JOIN LATERAL (SELECT sole_product_id, sole_color FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) rsc WHERE soi.sale_order_id = ANY(p_sale_order_ids) AND rsc.sole_product_id IS NOT NULL GROUP BY rsc.sole_product_id, COALESCE(NULLIF(rsc.sole_color, ''), soi.color, '') ),
  all_needed AS ( SELECT product_id, effective_color, needed_qty FROM sheet_needed UNION ALL SELECT product_id, effective_color, needed_qty FROM sole_needed ),
  needed AS ( SELECT product_id, effective_color, SUM(needed_qty) AS needed_qty FROM all_needed GROUP BY product_id, effective_color ),
  enriched AS ( SELECT n.product_id, p.name AS product_name, COALESCE(p.unit, 'un') AS unit, n.effective_color AS color, n.needed_qty, p.quantity AS stock_qty, GREATEST(0, n.needed_qty - p.quantity) AS shortage, p.supplier_id, sup.name AS supplier_name, COALESCE(p.supplier_lead_time_days, 7)::int AS supplier_lead_time_days, COALESCE(p.is_artisanal, false) AS is_artisanal FROM needed n JOIN products p ON p.id = n.product_id LEFT JOIN suppliers sup ON sup.id = p.supplier_id )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty, e.shortage, e.supplier_id, e.supplier_name, e.supplier_lead_time_days, e.is_artisanal, ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name, bp.id AS base_product_id, ar.base_product_name, CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0 THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty, bp.quantity AS base_stock_qty, CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL THEN GREATEST(0, ROUND(e.needed_qty / NULLIF(ar.yield_per_meter, 0), 3) - bp.quantity) ELSE NULL END AS base_shortage, CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date FROM enriched e LEFT JOIN artisanal_recipes ar ON e.is_artisanal = true AND ar.active = true AND (lower(e.product_name) LIKE '%' || lower(ar.artisanal_product_name) || '%' OR lower(ar.artisanal_product_name) LIKE '%' || lower(e.product_name) || '%') LEFT JOIN products bp ON ar.id IS NOT NULL AND (lower(bp.name) = lower(ar.base_product_name) OR lower(bp.name) LIKE lower(ar.base_product_name) || ':%' OR lower(bp.name) LIKE lower(ar.base_product_name) || ' -%') AND (e.color = '' OR lower(COALESCE(bp.color, '')) = lower(e.color) OR bp.color IS NULL OR bp.color = '') ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END; $$;

-- 7. 20260430120000_import-time-records-safe-rpc.sql
DROP FUNCTION IF EXISTS import_time_records_safe(records jsonb) CASCADE;
CREATE OR REPLACE FUNCTION import_time_records_safe(records jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec jsonb; ins_count integer := 0; skp_count integer := 0;
BEGIN
  FOR rec IN SELECT value FROM jsonb_array_elements(records)
  LOOP INSERT INTO time_records (employee_name, employee_external_id, department, record_date, punches, import_batch) VALUES (rec->>'employee_name', rec->>'employee_external_id', rec->>'department', (rec->>'record_date')::date, ARRAY(SELECT jsonb_array_elements_text(rec->'punches')), rec->>'import_batch') ON CONFLICT (employee_name, record_date) DO NOTHING; IF FOUND THEN ins_count := ins_count + 1; ELSE skp_count := skp_count + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', ins_count, 'skipped', skp_count);
END; $$;
GRANT EXECUTE ON FUNCTION import_time_records_safe(jsonb) TO authenticated;
