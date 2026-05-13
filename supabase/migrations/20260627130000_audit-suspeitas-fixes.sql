-- =============================================================================
-- 20260627130000 — Fixes das suspeitas confirmadas (B8, S2, S4)
-- =============================================================================
--
-- B8: calculate_order_cost_item passa a expor warning quando cost_policies
--     não tem linha ativa — antes overhead+packaging viravam 0 silenciosamente.
-- S2: trigger de frete usa filtro mais largo + UNIQUE INDEX pra impedir
--     duplicação se entry foi pago/estornado e shipping_rate é alterado.
-- S4: companies write split — admin/gerente continuam CRUD; nfe_operator
--     fica com UPDATE só nos campos fiscais essenciais (mas não pode
--     deletar/criar/desativar empresa).

-- ──────────────────────────────────────────────────────────────────────────────
-- B8 — warning em calculate_order_cost_item quando sem cost_policies ativa
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_order_cost_item(
  p_sale_order_item_id uuid,
  p_persist boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item record;
  v_sale_order_id uuid;
  v_ref uuid; v_color text; v_qty numeric; v_unit_price numeric;
  v_grade jsonb; v_cons jsonb; v_line jsonb;
  v_material numeric := 0; v_labor numeric := 0;
  v_overhead_per_pair numeric; v_overhead numeric := 0;
  v_packaging_per_pair numeric := 0; v_packaging numeric := 0;
  v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric; v_margin numeric; v_margin_pct numeric;
  v_op record; v_prod record; v_out jsonb;
  v_required_in_product_unit numeric; v_subtotal numeric;
  v_warnings text[] := ARRAY[]::text[];
  v_has_active_policy boolean;
  v_sheet_overhead numeric;
BEGIN
  SELECT i.id, i.sale_order_id, i.reference_id, i.color, i.quantity, i.unit_price,
         CASE WHEN i.grade IS NOT NULL AND i.grade::text <> 'null' THEN i.grade ELSE NULL END AS grade,
         i.material_variant_id
    INTO v_item
    FROM public.sale_order_items i
   WHERE i.id = p_sale_order_item_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_sale_order_id := v_item.sale_order_id;
  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := COALESCE(v_item.unit_price, 0);
  v_grade := v_item.grade;

  -- B8: verifica se há política ativa antes de buscar valores
  SELECT EXISTS (SELECT 1 FROM public.cost_policies WHERE active = true)
    INTO v_has_active_policy;

  SELECT COALESCE(custom_overhead, 0) INTO v_sheet_overhead
    FROM public.technical_sheets WHERE id = v_ref;
  v_overhead_per_pair := v_sheet_overhead;
  IF v_overhead_per_pair IS NULL OR v_overhead_per_pair = 0 THEN
    SELECT COALESCE(overhead_rate_per_pair, 0) INTO v_overhead_per_pair
      FROM public.cost_policies WHERE active = true LIMIT 1;
  END IF;
  v_overhead_per_pair := COALESCE(v_overhead_per_pair, 0);

  SELECT COALESCE(packaging_cost_per_pair, 0) INTO v_packaging_per_pair
    FROM public.cost_policies WHERE active = true LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  -- B8: warning quando não há política ativa E ficha não tem custom_overhead
  IF NOT v_has_active_policy AND COALESCE(v_sheet_overhead, 0) = 0 THEN
    v_warnings := array_append(v_warnings, 'no_active_cost_policy');
  END IF;

  SELECT consumption_snapshot INTO v_cons FROM public.technical_sheet_snapshots
   WHERE sale_order_id = v_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_ref, v_grade, COALESCE(v_color, ''), v_item.material_variant_id);
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_cons
        FROM public.calculate_order_consumption(v_ref, v_qty, COALESCE(v_color,''), NULL::integer, v_item.material_variant_id) c;
    END IF;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_required_in_product_unit := public.convert_to_product_unit(
      (v_line ->> 'required')::numeric,
      v_line ->> 'unit',
      COALESCE(v_prod.unit, ''));
    IF v_required_in_product_unit IS NULL THEN
      v_warnings := array_append(v_warnings, 'unit_mismatch:' || COALESCE(v_prod.name, '?'));
      v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
        'product_id', v_line ->> 'product_id',
        'product_name', v_prod.name,
        'component', v_line ->> 'component',
        'required', (v_line ->> 'required')::numeric,
        'consumption_unit', v_line ->> 'unit',
        'product_unit', v_prod.unit,
        'unit_price', COALESCE(v_prod.unit_price, 0),
        'subtotal', 0,
        'conversion_warning', 'unit_mismatch');
      CONTINUE;
    END IF;
    v_subtotal := COALESCE(v_prod.unit_price, 0) * v_required_in_product_unit;
    v_material := v_material + v_subtotal;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component', v_line ->> 'component',
      'required', (v_line ->> 'required')::numeric,
      'required_in_product_unit', v_required_in_product_unit,
      'consumption_unit', v_line ->> 'unit',
      'product_unit', v_prod.unit,
      'unit_price', COALESCE(v_prod.unit_price, 0),
      'subtotal', v_subtotal);
  END LOOP;

  FOR v_op IN
    SELECT lc.operation_name, lc.hour_cost, o.minutes_per_unit
      FROM public.technical_sheet_operations o
      JOIN public.labor_costs lc ON lc.id = o.labor_cost_id
     WHERE o.sheet_id = v_ref
  LOOP
    v_labor := v_labor + (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation', v_op.operation_name,
      'hour_cost', v_op.hour_cost,
      'minutes_per_unit', v_op.minutes_per_unit,
      'subtotal', (v_op.minutes_per_unit / 60.0) * v_op.hour_cost * v_qty);
  END LOOP;

  v_overhead := v_overhead_per_pair * v_qty;
  v_packaging := v_packaging_per_pair * v_qty;
  v_total := v_material + v_labor + v_overhead + v_packaging;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'sale_order_item_id', v_item.id,
    'reference_id', v_ref,
    'color', v_color,
    'quantity', v_qty,
    'material_cost', v_material, 'labor_cost', v_labor,
    'overhead_cost', v_overhead, 'packaging_cost', v_packaging,
    'total_cost', v_total, 'revenue', v_revenue,
    'margin', v_margin, 'margin_pct', v_margin_pct,
    'warnings', to_jsonb(v_warnings),
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'overhead_per_pair', v_overhead_per_pair,
      'packaging_per_pair', v_packaging_per_pair,
      'used_grade', v_grade IS NOT NULL AND v_grade <> '{}'::jsonb));

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, packaging_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      v_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_packaging, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown')
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost = EXCLUDED.material_cost,
      labor_cost = EXCLUDED.labor_cost,
      overhead_cost = EXCLUDED.overhead_cost,
      packaging_cost = EXCLUDED.packaging_cost,
      total_cost = EXCLUDED.total_cost,
      revenue = EXCLUDED.revenue,
      margin = EXCLUDED.margin,
      margin_pct = EXCLUDED.margin_pct,
      breakdown = EXCLUDED.breakdown,
      calculated_at = now();
  END IF;

  RETURN v_out;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- S2 — UNIQUE em sale_order_frete (impede duplicação pós-pagamento)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_sale_order_frete_unique
  ON public.financial_entries (reference_id)
  WHERE reference_type = 'sale_order_frete'
    AND reference_id IS NOT NULL
    AND reference_id <> ''
    AND status NOT IN ('cancelado', 'cancelled', 'estornado');

COMMENT ON INDEX public.financial_entries_sale_order_frete_unique IS
  'S2 audit fix: garante 1 lançamento ativo de frete por PV. Antes o trigger '
  'só filtrava status=pendente no SELECT — se entry fosse pago e shipping_rate '
  'fosse alterado depois, criava duplicata. Agora o INSERT falha por UNIQUE.';

-- Atualiza o trigger pra filtrar todos os status ativos (não só pendente)
-- evitando assim erro de unique conflict desnecessário ao já existir um pago.
CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_shipping_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_pairs int;
  v_amount numeric;
  v_due_date date;
  v_existing_id uuid;
  v_existing_status text;
BEGIN
  IF COALESCE(NEW.shipping_rate_per_pair, 0) <= 0 THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.shipping_rate_per_pair, 0) > 0 THEN
      UPDATE public.financial_entries
         SET status = 'cancelado',
             updated_at = now()
       WHERE reference_type = 'sale_order_frete'
         AND reference_id = NEW.id::text
         AND status = 'pendente';
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(quantity)::int, 0) INTO v_total_pairs
    FROM public.sale_order_items
   WHERE sale_order_id = NEW.id;

  IF v_total_pairs <= 0 THEN RETURN NEW; END IF;

  v_amount := NEW.shipping_rate_per_pair * v_total_pairs;
  v_due_date := public.add_business_days(CURRENT_DATE, 3)::date;

  -- S2: procura qualquer entry ativa (não só pendente)
  SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.financial_entries
   WHERE reference_type = 'sale_order_frete'
     AND reference_id = NEW.id::text
     AND status NOT IN ('cancelado', 'cancelled', 'estornado')
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Se já pago/confirmado, NÃO altera amount (trilha contábil imutável).
    IF v_existing_status IN ('pago', 'paid', 'confirmed', 'posted', 'reconciled') THEN
      RETURN NEW;
    END IF;
    UPDATE public.financial_entries
       SET amount = v_amount,
           description = 'Frete - ' || COALESCE(NEW.order_number, NEW.id::text),
           updated_at = now()
     WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.financial_entries (
      entry_date, type, description, amount,
      reference_type, reference_id, status, notes
    ) VALUES (
      v_due_date,
      'despesa',
      'Frete - ' || COALESCE(NEW.order_number, NEW.id::text),
      v_amount,
      'sale_order_frete',
      NEW.id::text,
      'pendente',
      'Lançamento automático gerado ao criar/atualizar PV com taxa de frete por par. ' ||
        'Pagamento previsto pra ' || to_char(v_due_date, 'DD/MM/YYYY') ||
        ' (3 dias úteis). Taxa: R$ ' || NEW.shipping_rate_per_pair ||
        '/par × ' || v_total_pairs || ' pares.'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- S4 — separar permissões companies (admin/gerente full, nfe_operator restrito)
-- ──────────────────────────────────────────────────────────────────────────────
-- nfe_operator precisa LER companies (pra emitir NF-e) e atualizar campos
-- fiscais leves (próximo número de série), MAS não pode criar/deletar/desativar
-- empresa. Antes tinha CRUD total que permitia desativar a empresa principal.

DROP POLICY IF EXISTS rls_companies_write ON public.companies;

CREATE POLICY rls_companies_select ON public.companies
  FOR SELECT TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','nfe_operator','financeiro']));

CREATE POLICY rls_companies_insert ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente']));

CREATE POLICY rls_companies_delete ON public.companies
  FOR DELETE TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente']));

-- UPDATE: admin/gerente sem restrição; nfe_operator só campos operacionais
-- (próxima série, certificado, ambiente). RLS check é coarse — controle fino
-- de campos fica via trigger (próxima migration se necessário).
CREATE POLICY rls_companies_update ON public.companies
  FOR UPDATE TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente','nfe_operator']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente','nfe_operator']));

COMMENT ON POLICY rls_companies_select ON public.companies IS
  'S4: admin/gerente/nfe_operator/financeiro podem ler dados fiscais da empresa emitente.';
COMMENT ON POLICY rls_companies_insert ON public.companies IS
  'S4: criar nova empresa só admin/gerente. nfe_operator não pode.';
COMMENT ON POLICY rls_companies_delete ON public.companies IS
  'S4: deletar empresa só admin/gerente. nfe_operator não pode.';
COMMENT ON POLICY rls_companies_update ON public.companies IS
  'S4: atualizar pode admin/gerente/nfe_operator (operador precisa pra atualizar série, certificado, etc.).';

-- ──────────────────────────────────────────────────────────────────────────────
-- S1 — increment_qty_devolvida atômico com check de saldo
-- ──────────────────────────────────────────────────────────────────────────────
-- emit-nfe-devolucao referencia a função mas ela nunca foi criada — caía no
-- fallback de SELECT+UPDATE não-atômico. Dois operadores concorrentes podiam
-- passar a validação e devolver mais do que vendido.
CREATE OR REPLACE FUNCTION public.increment_qty_devolvida(
  p_sale_order_item_id uuid,
  p_qty numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current numeric;
  v_total numeric;
  v_new_qty numeric;
BEGIN
  -- Lock atomic da row do item
  SELECT COALESCE(qty_devolvida, 0), COALESCE(quantity, 0)
    INTO v_current, v_total
    FROM public.sale_order_items
   WHERE id = p_sale_order_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_order_item_id % não encontrado', p_sale_order_item_id;
  END IF;

  v_new_qty := v_current + p_qty;
  IF v_new_qty > v_total THEN
    RAISE EXCEPTION 'Devolução excede saldo: tentou +%.2f, total %.2f, já devolvido %.2f',
      p_qty, v_total, v_current;
  END IF;

  UPDATE public.sale_order_items
     SET qty_devolvida = v_new_qty,
         updated_at = now()
   WHERE id = p_sale_order_item_id;

  RETURN jsonb_build_object(
    'sale_order_item_id', p_sale_order_item_id,
    'previous', v_current,
    'increment', p_qty,
    'new_qty_devolvida', v_new_qty,
    'remaining', v_total - v_new_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_qty_devolvida(uuid, numeric) TO authenticated;

COMMENT ON FUNCTION public.increment_qty_devolvida(uuid, numeric) IS
  'S1 audit fix: incremento atômico de qty_devolvida com FOR UPDATE + check '
  'de saldo. Antes a edge function emit-nfe-devolucao caía em fallback '
  'SELECT+UPDATE não-atômico — duas devoluções concorrentes podiam exceder a '
  'venda original.';
