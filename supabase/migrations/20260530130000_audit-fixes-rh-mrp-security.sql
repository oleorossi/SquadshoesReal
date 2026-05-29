-- Auditoria 2026-05-29 — correções RH + MRP + Segurança
--
-- Aplicadas em prod via MCP. Achados verificados contra dados ao vivo.
--
-- RH-1  pay_bank_hours: gravava coluna `reason` (inexistente -> `description`)
--       e movement_type='payout' (CHECK só permite 'payment'). Quebrava 100%.
-- RH-2  resolve_monthly_overtime: mesmo problema (reason + payout).
-- MRP-1 v_mrp_needs: filtro de pipeline com status PT-BR ('Cancelado','Recebido')
--       que nunca casa (purchase_orders.status é inglês) -> sub-dimensiona compras.
-- MRP-2 generate_purchase_orders_from_mrp: gravava status 'Rascunho' (fora do
--       vocabulário do app) -> OC invisível na UI e ignorada no inbound.
-- SEC-1 views de RH/financeiro SECURITY DEFINER legíveis por anon (key pública).
-- SEC-2/3 superfície de RPC do anon (96 funções) — revoga EXECUTE de PUBLIC.
-- SEC-4 notifications_select USING(true) -> qualquer autenticado lia tudo.

-- ============================================================================
-- RH-1: pay_bank_hours
-- ============================================================================
CREATE OR REPLACE FUNCTION public.pay_bank_hours(p_employee_id uuid, p_hours numeric, p_hourly_rate numeric, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_minutes         integer;
  v_amount          numeric;
  v_employee        RECORD;
  v_balance_min     integer;
  v_period          text;
  v_payroll_status  text;
  v_movement_id     uuid;
  v_entry_id        uuid;
  v_account_id      uuid;
  v_now             timestamptz := now();
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'Funcionário é obrigatório';
  END IF;
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RAISE EXCEPTION 'Quantidade de horas deve ser maior que zero';
  END IF;
  IF p_hourly_rate IS NULL OR p_hourly_rate <= 0 THEN
    RAISE EXCEPTION 'Valor da hora deve ser maior que zero';
  END IF;

  SELECT id, name, salary, cost_center, department
    INTO v_employee
    FROM public.employees
   WHERE id = p_employee_id AND active = true;

  IF v_employee.id IS NULL THEN
    RAISE EXCEPTION 'Funcionário não encontrado ou inativo';
  END IF;

  SELECT (public.calculate_employee_bank_balance(p_employee_id, NULL, NULL)->>'balance_min')::integer
    INTO v_balance_min;

  v_minutes := CEIL(p_hours * 60)::integer;

  IF v_balance_min IS NULL OR v_balance_min < v_minutes THEN
    RAISE EXCEPTION 'Saldo insuficiente: disponível % min, solicitado % min (% horas)',
      COALESCE(v_balance_min, 0), v_minutes, p_hours;
  END IF;

  v_period := to_char(p_payment_date, 'YYYY-MM');
  SELECT status INTO v_payroll_status
    FROM public.payroll_runs
   WHERE employee_id = p_employee_id AND period = v_period
   LIMIT 1;

  IF v_payroll_status IS NOT NULL AND v_payroll_status <> 'rascunho' THEN
    RAISE EXCEPTION 'Folha do período % já está % — desfaça o status antes de registrar pagamento.',
      v_period, v_payroll_status;
  END IF;

  v_amount := ROUND(p_hours * p_hourly_rate, 2);

  INSERT INTO public.bank_hours_movements (
    employee_id, movement_date, movement_type, minutes, description, created_by, created_at
  ) VALUES (
    p_employee_id, p_payment_date, 'payment', -v_minutes,
    COALESCE(NULLIF(trim(p_notes), ''),
             format('Pagamento %s h × R$ %s/h = R$ %s',
                    trim(both '0' from to_char(p_hours, 'FM999990.00')),
                    trim(both '0' from to_char(p_hourly_rate, 'FM999990.00')),
                    trim(both '0' from to_char(v_amount, 'FM999990.00')))),
    auth.uid(), v_now
  )
  RETURNING id INTO v_movement_id;

  SELECT id INTO v_account_id
    FROM public.chart_of_accounts
   WHERE active = true
     AND (lower(name) LIKE '%sal%' OR lower(name) LIKE '%folha%' OR lower(name) LIKE '%hora extra%' OR lower(name) LIKE '%pessoal%')
   ORDER BY name
   LIMIT 1;

  INSERT INTO public.financial_entries (
    entry_date, type, description, amount,
    account_id, bank_account_id,
    reference_type, reference_id, status, created_at, updated_at
  ) VALUES (
    p_payment_date, 'despesa',
    format('Pagamento horas extras — %s (%s h)', v_employee.name,
           trim(both '0' from to_char(p_hours, 'FM999990.00'))),
    v_amount,
    v_account_id, p_bank_account_id,
    'bank_hours_payout', v_movement_id::text, 'pendente', v_now, v_now
  )
  RETURNING id INTO v_entry_id;

  UPDATE public.bank_hours_movements
     SET reference_id = v_entry_id
   WHERE id = v_movement_id;

  RETURN jsonb_build_object(
    'movement_id',        v_movement_id,
    'financial_entry_id', v_entry_id,
    'employee_id',        p_employee_id,
    'employee_name',      v_employee.name,
    'hours',              p_hours,
    'minutes',            v_minutes,
    'hourly_rate',        p_hourly_rate,
    'amount',             v_amount,
    'payment_date',       p_payment_date,
    'created_at',         v_now,
    'created_by',         auth.uid()
  );
END;
$function$;

-- ============================================================================
-- RH-2: resolve_monthly_overtime
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_monthly_overtime(p_employee_id uuid, p_month date, p_decision text, p_bank_minutes integer, p_pay_minutes integer, p_total_minutes integer, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_emp record; v_hourly_rate numeric; v_pay_amount numeric;
  v_bank_id uuid; v_pay_movement_id uuid; v_fin_id uuid; v_resolution_id uuid; v_user uuid;
  v_old_bank_id uuid; v_old_fin_id uuid;
BEGIN
  IF NOT user_has_any_role(ARRAY['admin','gerente','rh']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  v_user := auth.uid();
  p_month := date_trunc('month', p_month)::date;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('overtime_monthly:' || p_employee_id::text || ':' || p_month::text, 0)
  );

  IF p_decision NOT IN ('bank','pay','split') THEN RAISE EXCEPTION 'decision inválida: %', p_decision; END IF;
  IF p_decision = 'bank' THEN p_pay_minutes := 0; p_bank_minutes := p_total_minutes;
  ELSIF p_decision = 'pay' THEN p_bank_minutes := 0; p_pay_minutes := p_total_minutes;
  ELSIF p_decision = 'split' THEN
    IF (p_bank_minutes + p_pay_minutes) <> p_total_minutes THEN RAISE EXCEPTION 'split inconsistente'; END IF;
  END IF;

  SELECT id, salary, hourly_rate INTO v_emp FROM public.employees WHERE id = p_employee_id;
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Funcionário não encontrado'; END IF;
  v_hourly_rate := COALESCE(v_emp.hourly_rate, v_emp.salary / 220.0, 0);
  v_pay_amount  := ROUND((p_pay_minutes / 60.0) * v_hourly_rate, 2);

  SELECT bank_movement_id, financial_entry_id INTO v_old_bank_id, v_old_fin_id
    FROM public.overtime_resolutions
   WHERE employee_id = p_employee_id AND month = p_month;
  IF v_old_bank_id IS NOT NULL THEN
    DELETE FROM public.bank_hours_movements WHERE id = v_old_bank_id;
  END IF;
  IF v_old_fin_id IS NOT NULL THEN
    UPDATE public.financial_entries
       SET status = 'cancelado',
           notes = COALESCE(notes,'') || E'\n[' || now()::date || '] Cancelado por nova resolução de HE mensal'
     WHERE id = v_old_fin_id AND status NOT IN ('cancelado','estornado');
  END IF;

  IF p_bank_minutes > 0 THEN
    INSERT INTO public.bank_hours_movements (employee_id, movement_type, minutes, movement_date, description, created_by)
    VALUES (p_employee_id, 'credit', p_bank_minutes, (p_month + interval '1 month - 1 day')::date,
      COALESCE('Banco — HE ' || to_char(p_month, 'MM/YYYY') || COALESCE(' · ' || p_notes, ''),
        'Banco — HE ' || to_char(p_month, 'MM/YYYY')), v_user)
    RETURNING id INTO v_bank_id;
  END IF;

  IF p_pay_minutes > 0 AND v_pay_amount > 0 THEN
    INSERT INTO public.bank_hours_movements (employee_id, movement_type, minutes, movement_date, description, created_by)
    VALUES (p_employee_id, 'payment', -p_pay_minutes, (p_month + interval '1 month - 1 day')::date,
      'HE paga (resolução mensal) — ' || to_char(p_month, 'MM/YYYY')
        || ' · ' || (p_pay_minutes/60.0)::numeric(8,2) || 'h × R$ ' || v_hourly_rate::numeric(10,2)
        || COALESCE(' · ' || p_notes, ''), v_user)
    RETURNING id INTO v_pay_movement_id;

    INSERT INTO public.financial_entries (type, amount, status, description, reference_id, reference_type, entry_date, created_at, updated_at)
    VALUES ('despesa', v_pay_amount, 'pendente',
      'HE ' || to_char(p_month, 'MM/YYYY') || ' — ' || (p_pay_minutes/60.0)::numeric(8,2)
        || 'h × R$ ' || v_hourly_rate::numeric(10,2) || COALESCE(' · ' || p_notes, ''),
      v_pay_movement_id::text, 'bank_hours_payout', (p_month + interval '1 month - 1 day')::date, now(), now())
    RETURNING id INTO v_fin_id;

    UPDATE public.bank_hours_movements SET reference_id = v_fin_id WHERE id = v_pay_movement_id;
  END IF;

  INSERT INTO public.overtime_resolutions (
    employee_id, month, overtime_minutes_total, hourly_rate_snapshot, multiplier_snapshot,
    decision, bank_minutes, pay_minutes, pay_amount, bank_movement_id, financial_entry_id, notes, resolved_by
  ) VALUES (
    p_employee_id, p_month, p_total_minutes, v_hourly_rate, 1.0,
    p_decision, p_bank_minutes, p_pay_minutes, v_pay_amount, v_bank_id, v_fin_id, p_notes, v_user
  )
  ON CONFLICT (employee_id, month) DO UPDATE SET
    overtime_minutes_total = EXCLUDED.overtime_minutes_total,
    hourly_rate_snapshot   = EXCLUDED.hourly_rate_snapshot,
    multiplier_snapshot    = EXCLUDED.multiplier_snapshot,
    decision = EXCLUDED.decision,
    bank_minutes = EXCLUDED.bank_minutes, pay_minutes = EXCLUDED.pay_minutes, pay_amount = EXCLUDED.pay_amount,
    bank_movement_id = EXCLUDED.bank_movement_id, financial_entry_id = EXCLUDED.financial_entry_id,
    notes = EXCLUDED.notes, resolved_by = EXCLUDED.resolved_by, resolved_at = now()
  RETURNING id INTO v_resolution_id;

  RETURN v_resolution_id;
END;
$function$;

-- ============================================================================
-- MRP-1: v_mrp_needs — status em inglês no filtro de pipeline
-- ============================================================================
CREATE OR REPLACE VIEW public.v_mrp_needs AS
 WITH demand AS (
         SELECT fn_projected_demand.product_id, fn_projected_demand.product_name,
            fn_projected_demand.total_required, fn_projected_demand.earliest_deadline,
            fn_projected_demand.orders_count, fn_projected_demand.order_ids
           FROM fn_projected_demand() fn_projected_demand(product_id, product_name, total_required, earliest_deadline, orders_count, order_ids)
        ), po_open AS (
         SELECT poi.product_id, sum(poi.quantity) AS qty_in_pipeline
           FROM purchase_order_items poi
             JOIN purchase_orders po_1 ON po_1.id = poi.purchase_order_id
          WHERE po_1.status <> ALL (ARRAY['cancelled'::text, 'received'::text])
          GROUP BY poi.product_id
        ), reserved AS (
         SELECT material_reservations.product_id,
            sum(material_reservations.quantity_reserved - material_reservations.quantity_consumed) AS qty_reserved
           FROM material_reservations
          WHERE material_reservations.status = ANY (ARRAY['reserved'::text, 'partially_consumed'::text])
          GROUP BY material_reservations.product_id
        )
 SELECT p.id AS product_id, p.name AS product_name, p.sku, p.category, p.unit, p.unit_price,
    p.purchase_order_unit, COALESCE(p.conversion_rate, 1::numeric) AS conversion_rate,
    p.min_order_quantity, p.lead_time_days, p.preferred_supplier_id, s.name AS supplier_name,
    p.min_stock, p.quantity AS on_hand, COALESCE(r.qty_reserved, 0::numeric) AS reserved,
    GREATEST(p.quantity - COALESCE(r.qty_reserved, 0::numeric), 0::numeric) AS available_now,
    COALESCE(po.qty_in_pipeline, 0::numeric) AS qty_in_po,
    COALESCE(d.total_required, 0::numeric) AS projected_demand,
    d.earliest_deadline, d.orders_count,
    GREATEST(COALESCE(d.total_required, 0::numeric) + p.min_stock - p.quantity - COALESCE(po.qty_in_pipeline, 0::numeric), 0::numeric) AS suggested_qty,
    (d.earliest_deadline - ((p.lead_time_days || ' days'::text)::interval))::date AS order_by_date
   FROM products p
     LEFT JOIN demand d ON d.product_id = p.id
     LEFT JOIN po_open po ON po.product_id = p.id
     LEFT JOIN reserved r ON r.product_id = p.id
     LEFT JOIN suppliers s ON s.id = p.preferred_supplier_id
  WHERE COALESCE(d.total_required, 0::numeric) > 0::numeric OR p.quantity < p.min_stock;

-- ============================================================================
-- MRP-2: generate_purchase_orders_from_mrp — status 'pending' (era 'Rascunho')
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_purchase_orders_from_mrp(p_product_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record; v_supplier uuid; v_po_id uuid; v_po_number text;
  v_qty_to_order numeric; v_unit_price_po numeric; v_unit_po text;
  v_linked uuid[]; v_lock_key bigint;
BEGIN
  FOR v_row IN
    SELECT * FROM public.v_mrp_needs
     WHERE suggested_qty > 0
       AND (p_product_ids IS NULL OR product_id = ANY(p_product_ids))
     ORDER BY preferred_supplier_id NULLS LAST, product_name
  LOOP
    v_supplier := v_row.preferred_supplier_id;
    v_qty_to_order := v_row.suggested_qty / COALESCE(v_row.conversion_rate, 1);
    v_unit_price_po := COALESCE(v_row.unit_price, 0) * COALESCE(v_row.conversion_rate, 1);
    v_unit_po := COALESCE(v_row.purchase_order_unit, v_row.unit);
    v_qty_to_order := GREATEST(v_qty_to_order, COALESCE(v_row.min_order_quantity, 0));

    IF v_unit_po IN ('un', 'cx', 'rolo', 'chapa', 'unidade', 'par') THEN
      v_qty_to_order := CEIL(v_qty_to_order);
    END IF;

    v_lock_key := hashtextextended(COALESCE(v_supplier::text, 'no-supplier'), 0);
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT ARRAY_AGG(DISTINCT so.id) INTO v_linked
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    JOIN sheet_materials sm ON sm.sheet_id = soi.reference_id
    WHERE sm.product_id = v_row.product_id
      AND so.deleted_at IS NULL
      AND so.status IN ('Aprovado', 'Em Produção');

    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE supplier_id IS NOT DISTINCT FROM v_supplier
       AND status = 'pending'
       AND auto_generated = true
       AND created_at > now() - interval '2 minutes'
     LIMIT 1;

    IF v_po_id IS NULL THEN
      v_po_number := 'PO-MRP-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text),1,4);
      INSERT INTO public.purchase_orders
        (order_number, status, supplier_id, supplier_name, total_value, notes, auto_generated, linked_sale_order_ids)
      VALUES (
        v_po_number, 'pending', v_supplier, COALESCE(v_row.supplier_name, ''), 0,
        'Gerada automaticamente pelo MRP em ' || to_char(now(),'DD/MM/YYYY HH24:MI'),
        true, COALESCE(v_linked, ARRAY[]::uuid[])
      ) RETURNING id INTO v_po_id;
    ELSE
      UPDATE public.purchase_orders
      SET linked_sale_order_ids = (
        SELECT ARRAY_AGG(DISTINCT x)
        FROM unnest(COALESCE(linked_sale_order_ids, ARRAY[]::uuid[]) || COALESCE(v_linked, ARRAY[]::uuid[])) AS x
      )
      WHERE id = v_po_id;
    END IF;

    INSERT INTO public.purchase_order_items
      (purchase_order_id, product_id, quantity, unit_price, unit, current_stock, min_stock, suggested_quantity)
    VALUES (
      v_po_id, v_row.product_id, v_qty_to_order, v_unit_price_po, v_unit_po,
      v_row.on_hand, v_row.min_stock, v_row.suggested_qty
    );

    UPDATE public.purchase_orders
       SET total_value = (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM public.purchase_order_items WHERE purchase_order_id = v_po_id),
           updated_at = now()
     WHERE id = v_po_id;

    RETURN NEXT v_po_id;
  END LOOP;
END;
$function$;

-- ============================================================================
-- SEC-1: revoga anon nas views sensíveis de RH/financeiro
-- ============================================================================
DO $$
DECLARE v_view text;
BEGIN
  FOREACH v_view IN ARRAY ARRAY[
    'bank_hours_balance','v_bank_hours_summary','v_bank_hours_per_sector',
    'v_employee_punch_pattern','v_operator_productivity',
    'v_economic_group_credit','v_economic_group_kpis','sale_order_min_billing'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
              WHERE n.nspname='public' AND c.relname=v_view) THEN
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon', v_view);
    END IF;
  END LOOP;
END $$;

-- ============================================================================
-- SEC-2/3: fecha a superfície de RPC do anon (96 funções regrediram pós-revoke
-- de 20/06). anon herda EXECUTE via PUBLIC -> revoga de PUBLIC, re-concede a
-- authenticated + service_role. Trigger functions continuam disparando.
-- ============================================================================
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- ============================================================================
-- SEC-4: notifications_select restrito ao dono / broadcast
-- ============================================================================
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL);
