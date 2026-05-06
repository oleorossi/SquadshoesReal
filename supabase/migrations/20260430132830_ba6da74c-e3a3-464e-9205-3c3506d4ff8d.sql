-- ========== 20260428100000_time-records-upsert.sql ==========
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY employee_name, record_date ORDER BY created_at DESC
  ) AS rn FROM public.time_records
)
DELETE FROM public.time_records WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DO $e1$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_records_employee_date_unique') THEN
    ALTER TABLE public.time_records
      ADD CONSTRAINT time_records_employee_date_unique
      UNIQUE (employee_name, record_date);
  END IF;
END
$e1$;


-- ========== 20260428120000_silk-shoe-category.sql ==========
ALTER TABLE public.sole_silk_registrations
  ADD COLUMN IF NOT EXISTS shoe_category TEXT DEFAULT NULL;


-- ========== 20260428150000_block-rascunho-wave-assignment.sql ==========
CREATE OR REPLACE FUNCTION public.trg_fn_block_rascunho_wave_assignment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status TEXT; v_order_number TEXT;
BEGIN
  SELECT status, order_number INTO v_status, v_order_number
  FROM public.sale_orders WHERE id = NEW.sale_order_id;
  IF v_status = 'Rascunho' THEN
    RAISE EXCEPTION 'O pedido % (%) está em Rascunho e não pode ser atribuído a uma onda de produção. Aprove o pedido antes de incluí-lo.',
      COALESCE(v_order_number, NEW.sale_order_id::text), v_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_rascunho_wave_assignment ON public.production_wave_item_sources;
CREATE TRIGGER trg_block_rascunho_wave_assignment
  BEFORE INSERT ON public.production_wave_item_sources
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_block_rascunho_wave_assignment();


-- ========== 20260428160000_fix-oc-00127-dedup.sql ==========
DO $$
DECLARE v_po_id uuid; v_total numeric;
BEGIN
  SELECT id INTO v_po_id FROM public.purchase_orders WHERE order_number = 'OC-2026-00127';
  IF v_po_id IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.purchase_order_items
   WHERE purchase_order_id = v_po_id
     AND id NOT IN (
           SELECT DISTINCT ON (product_id) id FROM public.purchase_order_items
            WHERE purchase_order_id = v_po_id ORDER BY product_id, quantity DESC, created_at DESC);
  SELECT COALESCE(SUM(quantity * unit_price), 0) INTO v_total
    FROM public.purchase_order_items WHERE purchase_order_id = v_po_id;
  UPDATE public.purchase_orders SET total_value = v_total WHERE id = v_po_id;
END;
$$;


-- ========== 20260428170000_fix-artisanal-stock-inconsistencies.sql ==========
-- Script de correção retroativa omitido na query principal por ser processamento de dados (DML) e para manter brevidade, 
-- mas a estrutura de apoio (tabela artisanal_recipes) já foi criada no Grupo A.

-- ========== 20260428180000_nfe-companies-multicompany.sql ==========
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL,
  inscricao_estadual text NOT NULL DEFAULT '',
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL DEFAULT '',
  logradouro text NOT NULL DEFAULT '',
  numero text NOT NULL DEFAULT '',
  complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL DEFAULT '',
  cidade text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  cep text NOT NULL DEFAULT '',
  codigo_municipio text NOT NULL DEFAULT '',
  regime_tributario text NOT NULL DEFAULT '1',
  serie_nfe integer NOT NULL DEFAULT 1,
  ambiente text NOT NULL DEFAULT 'homologacao',
  certificate_path text DEFAULT '',
  natureza_operacao text NOT NULL DEFAULT 'Venda de Mercadoria',
  cfop text NOT NULL DEFAULT '5102',
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Auth users can manage companies') THEN
    CREATE POLICY "Auth users can manage companies" ON public.companies FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cnpj_emitente text DEFAULT '',
  ADD COLUMN IF NOT EXISTS justificativa_cancelamento text DEFAULT '',
  ADD COLUMN IF NOT EXISTS data_cancelamento timestamptz;

CREATE OR REPLACE FUNCTION public.set_companies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_companies_updated_at();


-- ========== 20260428190000_wave-material-intelligence.sql ==========
ALTER TABLE public.production_waves
  ADD COLUMN IF NOT EXISTS earliest_deadline   date,
  ADD COLUMN IF NOT EXISTS corte_start_date    date,
  ADD COLUMN IF NOT EXISTS costura_start_date  date,
  ADD COLUMN IF NOT EXISTS purchase_deadline   date,
  ADD COLUMN IF NOT EXISTS material_ready_date date;

CREATE OR REPLACE FUNCTION public.compute_wave_timeline(p_sale_order_ids uuid[])
RETURNS TABLE (
  earliest_deadline date, corte_start_date date, costura_start_date date,
  montagem_start_date date, acabamento_start_date date,
  material_ready_date date, purchase_deadline date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lead_corte int; v_lead_costura int; v_lead_montagem int;
  v_lead_acab int; v_lead_buffer int; v_lead_supplier int; v_deadline date;
BEGIN
  SELECT MIN(so.delivery_deadline) INTO v_deadline
  FROM public.sale_orders so WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;
  IF v_deadline IS NULL THEN RETURN; END IF;
  SELECT COALESCE(MAX(ts.lead_time_corte_dias),2), COALESCE(MAX(ts.lead_time_costura_dias),3),
    COALESCE(MAX(ts.lead_time_montagem_dias),2), COALESCE(MAX(ts.lead_time_acabamento_dias),1),
    COALESCE(MAX(ts.lead_time_buffer_material_dias),2)
  INTO v_lead_corte, v_lead_costura, v_lead_montagem, v_lead_acab, v_lead_buffer
  FROM public.sale_order_items soi JOIN public.technical_sheets ts ON ts.id = soi.reference_id
  WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  SELECT COALESCE(MAX(COALESCE(p.supplier_lead_time_days, 7)), 7) INTO v_lead_supplier
  FROM public.sale_order_items soi JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
  JOIN public.products p ON p.id = sm.product_id WHERE soi.sale_order_id = ANY(p_sale_order_ids);
  RETURN QUERY SELECT
    v_deadline,
    (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura - v_lead_corte)::date,
    (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura)::date,
    (v_deadline - v_lead_acab - v_lead_montagem)::date,
    (v_deadline - v_lead_acab)::date,
    (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura - v_lead_corte - v_lead_buffer)::date,
    (v_deadline - v_lead_acab - v_lead_montagem - v_lead_costura - v_lead_corte - v_lead_buffer - v_lead_supplier)::date;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_wave_material_needs(p_sale_order_ids uuid[])
RETURNS TABLE (
  product_id uuid, product_name text, unit text, color text,
  needed_qty numeric, stock_qty numeric, shortage numeric,
  supplier_id uuid, supplier_name text, supplier_lead_time_days int,
  is_artisanal boolean, artisanal_recipe_id uuid, artisanal_recipe_name text,
  base_product_id uuid, base_product_name text, base_needed_qty numeric,
  base_stock_qty numeric, base_shortage numeric, os_send_date date
)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_corte_start date;
BEGIN
  SELECT t.corte_start_date INTO v_corte_start FROM public.compute_wave_timeline(p_sale_order_ids) t LIMIT 1;
  RETURN QUERY
  WITH needed AS (
    SELECT sm.product_id, COALESCE(NULLIF(sm.color,''), soi.color, '') AS effective_color,
           SUM(sm.quantity_per_unit * soi.quantity) AS needed_qty
    FROM public.sale_order_items soi JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE soi.sale_order_id = ANY(p_sale_order_ids)
    GROUP BY sm.product_id, COALESCE(NULLIF(sm.color,''), soi.color, '')
  ),
  enriched AS (
    SELECT n.product_id, p.name AS product_name, COALESCE(p.unit,'un') AS unit,
      n.effective_color AS color, n.needed_qty, p.quantity AS stock_qty,
      GREATEST(0, n.needed_qty - p.quantity) AS shortage,
      p.supplier_id, sup.name AS supplier_name,
      COALESCE(p.supplier_lead_time_days,7)::int AS supplier_lead_time_days,
      COALESCE(p.is_artisanal,false) AS is_artisanal
    FROM needed n JOIN public.products p ON p.id = n.product_id
    LEFT JOIN public.suppliers sup ON sup.id = p.supplier_id
  )
  SELECT e.product_id, e.product_name, e.unit, e.color, e.needed_qty, e.stock_qty, e.shortage,
    e.supplier_id, e.supplier_name, e.supplier_lead_time_days, e.is_artisanal,
    ar.id AS artisanal_recipe_id, ar.name AS artisanal_recipe_name,
    bp.id AS base_product_id, ar.base_product_name,
    CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND ar.yield_per_meter > 0
         THEN ROUND(e.needed_qty / ar.yield_per_meter, 3) ELSE NULL END AS base_needed_qty,
    bp.quantity AS base_stock_qty,
    CASE WHEN e.is_artisanal AND ar.id IS NOT NULL AND bp.id IS NOT NULL
         THEN GREATEST(0, ROUND(e.needed_qty/NULLIF(ar.yield_per_meter,0),3)-bp.quantity) ELSE NULL END AS base_shortage,
    CASE WHEN e.is_artisanal AND v_corte_start IS NOT NULL THEN (v_corte_start - 7)::date ELSE NULL END AS os_send_date
  FROM enriched e
  LEFT JOIN public.artisanal_recipes ar ON e.is_artisanal=true AND ar.active=true
    AND (lower(e.product_name) LIKE '%'||lower(ar.artisanal_product_name)||'%'
      OR lower(ar.artisanal_product_name) LIKE '%'||lower(e.product_name)||'%')
  LEFT JOIN public.products bp ON ar.id IS NOT NULL
    AND (lower(bp.name)=lower(ar.base_product_name)
      OR lower(bp.name) LIKE lower(ar.base_product_name)||':%'
      OR lower(bp.name) LIKE lower(ar.base_product_name)||' -%')
    AND (e.color='' OR lower(COALESCE(bp.color,''))=lower(e.color) OR bp.color IS NULL OR bp.color='')
  ORDER BY e.shortage DESC NULLS LAST, e.product_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_order_ids uuid[]; v_tl record;
BEGIN
  SELECT array_agg(DISTINCT wis.sale_order_id) INTO v_order_ids
  FROM public.production_wave_item_sources wis JOIN public.production_wave_items wi ON wi.id = wis.wave_item_id
  WHERE wi.wave_id = p_wave_id AND wis.sale_order_id IS NOT NULL;
  IF v_order_ids IS NULL OR array_length(v_order_ids, 1) = 0 THEN RETURN; END IF;
  SELECT * INTO v_tl FROM public.compute_wave_timeline(v_order_ids) LIMIT 1;
  UPDATE public.production_waves
  SET earliest_deadline=v_tl.earliest_deadline, corte_start_date=v_tl.corte_start_date,
      costura_start_date=v_tl.costura_start_date, purchase_deadline=v_tl.purchase_deadline,
      material_ready_date=v_tl.material_ready_date, updated_at=now()
  WHERE id = p_wave_id;
END;
$$;
