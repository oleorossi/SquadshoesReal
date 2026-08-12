-- S&OP: plano mensal de demanda aprovado, separado da carteira/OP operacional.
-- O plano é uma referência gerencial: NÃO reordena nem cria OPs no motor diário.

CREATE TABLE IF NOT EXISTS public.sop_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month date NOT NULL,
  scenario text NOT NULL DEFAULT 'base' CHECK (scenario IN ('conservador', 'base', 'agressivo')),
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'aprovado', 'arquivado')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sop_plans_month_first_day CHECK (period_month = date_trunc('month', period_month)::date),
  CONSTRAINT sop_plans_unique_scenario_month UNIQUE (period_month, scenario)
);

CREATE TABLE IF NOT EXISTS public.sop_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.sop_plans(id) ON DELETE CASCADE,
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id),
  color text NOT NULL DEFAULT '',
  forecast_pairs numeric NOT NULL DEFAULT 0 CHECK (forecast_pairs >= 0),
  confirmed_pairs numeric NOT NULL DEFAULT 0 CHECK (confirmed_pairs >= 0),
  adjustment_pairs numeric NOT NULL DEFAULT 0,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sop_plan_items_unique_reference_color UNIQUE (plan_id, reference_id, color)
);

CREATE INDEX IF NOT EXISTS idx_sop_plans_period ON public.sop_plans(period_month DESC, scenario);
CREATE INDEX IF NOT EXISTS idx_sop_plan_items_plan ON public.sop_plan_items(plan_id);

ALTER TABLE public.sop_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sop_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sop_plans_read_approved ON public.sop_plans;
CREATE POLICY sop_plans_read_approved ON public.sop_plans FOR SELECT TO authenticated
  USING (public.is_approved_user());
DROP POLICY IF EXISTS sop_plan_items_read_approved ON public.sop_plan_items;
CREATE POLICY sop_plan_items_read_approved ON public.sop_plan_items FOR SELECT TO authenticated
  USING (public.is_approved_user());

-- Escrita exclusivamente pelas RPCs abaixo: evita que um plano aprovado seja
-- alterado por update direto do browser e deixa autoria/auditoria no servidor.
REVOKE INSERT, UPDATE, DELETE ON public.sop_plans, public.sop_plan_items FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.create_sop_plan(
  p_period_month date,
  p_scenario text DEFAULT 'base',
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_period_month IS NULL THEN RAISE EXCEPTION 'Mês do plano obrigatório'; END IF;
  IF p_scenario NOT IN ('conservador','base','agressivo') THEN RAISE EXCEPTION 'Cenário inválido'; END IF;

  INSERT INTO public.sop_plans(period_month, scenario, notes, created_by)
  VALUES (date_trunc('month', p_period_month)::date, p_scenario, NULLIF(btrim(p_notes), ''), auth.uid())
  RETURNING id INTO v_id;

  -- Previsão estatística é ponto de partida, nunca substitui a revisão comercial.
  INSERT INTO public.sop_plan_items(plan_id, reference_id, color, forecast_pairs, confirmed_pairs, updated_by)
  SELECT v_id, f.reference_id, COALESCE(f.color, ''),
         GREATEST(0, ROUND(f.total_forecast_monthly)), 0, auth.uid()
    FROM public.v_sku_forecast_summary f;

  -- Carteira confirmada com entrega no mês. Itens sem histórico também entram.
  INSERT INTO public.sop_plan_items(plan_id, reference_id, color, forecast_pairs, confirmed_pairs, updated_by)
  SELECT v_id, soi.reference_id, COALESCE(soi.color, ''), 0, SUM(soi.quantity), auth.uid()
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
   WHERE so.status IN ('Aprovado','Em Produção','Pronto')
     AND date_trunc('month', COALESCE(so.delivery_deadline, so.created_at)::date) = date_trunc('month', p_period_month)::date
   GROUP BY soi.reference_id, COALESCE(soi.color, '')
  ON CONFLICT (plan_id, reference_id, color) DO UPDATE
    SET confirmed_pairs = EXCLUDED.confirmed_pairs, updated_at = now(), updated_by = auth.uid();

  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.upsert_sop_plan_item(
  p_plan_id uuid, p_reference_id uuid, p_color text,
  p_forecast_pairs numeric, p_confirmed_pairs numeric, p_adjustment_pairs numeric,
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF NOT public.user_has_any_role(ARRAY['admin','gerente','comercial']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF EXISTS (SELECT 1 FROM public.sop_plans WHERE id = p_plan_id AND status = 'aprovado') THEN
    RAISE EXCEPTION 'Plano aprovado não pode ser alterado; crie uma nova versão';
  END IF;
  IF COALESCE(p_forecast_pairs,0) < 0 OR COALESCE(p_confirmed_pairs,0) < 0 THEN RAISE EXCEPTION 'Pares não podem ser negativos'; END IF;
  INSERT INTO public.sop_plan_items(plan_id, reference_id, color, forecast_pairs, confirmed_pairs, adjustment_pairs, notes, updated_by)
  VALUES (p_plan_id, p_reference_id, COALESCE(p_color,''), COALESCE(p_forecast_pairs,0), COALESCE(p_confirmed_pairs,0), COALESCE(p_adjustment_pairs,0), NULLIF(btrim(p_notes),''), auth.uid())
  ON CONFLICT (plan_id, reference_id, color) DO UPDATE SET
    forecast_pairs = EXCLUDED.forecast_pairs, confirmed_pairs = EXCLUDED.confirmed_pairs,
    adjustment_pairs = EXCLUDED.adjustment_pairs, notes = EXCLUDED.notes,
    updated_by = auth.uid(), updated_at = now();
END;
$fn$;

CREATE OR REPLACE FUNCTION public.approve_sop_plan(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF NOT public.user_has_any_role(ARRAY['admin','gerente']) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sop_plan_items WHERE plan_id = p_plan_id) THEN RAISE EXCEPTION 'Plano sem itens não pode ser aprovado'; END IF;
  UPDATE public.sop_plans SET status = 'aprovado', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   WHERE id = p_plan_id AND status = 'rascunho';
  IF NOT FOUND THEN RAISE EXCEPTION 'Plano não encontrado ou não está em rascunho'; END IF;
END;
$fn$;

CREATE OR REPLACE VIEW public.v_sop_plan_items AS
SELECT i.id, i.plan_id, p.period_month, p.scenario, p.status, i.reference_id,
       ts.code AS reference_code, ts.name AS reference_name, i.color,
       i.forecast_pairs, i.confirmed_pairs, i.adjustment_pairs,
       GREATEST(i.confirmed_pairs, i.forecast_pairs + i.adjustment_pairs) AS planned_pairs,
       i.notes, i.updated_at
  FROM public.sop_plan_items i
  JOIN public.sop_plans p ON p.id = i.plan_id
  JOIN public.technical_sheets ts ON ts.id = i.reference_id;

CREATE OR REPLACE FUNCTION public.get_sop_sector_load(p_plan_id uuid)
RETURNS TABLE(sector text, flow_order integer, planned_pairs numeric, daily_capacity_pairs numeric,
              business_days integer, capacity_pairs numeric, utilization_pct numeric, open_order_pairs numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  RETURN QUERY
  WITH plan AS (
    SELECT period_month FROM public.sop_plans WHERE id = p_plan_id
  ), days AS (
    SELECT count(*)::integer AS n FROM plan, generate_series(
      plan.period_month, (plan.period_month + interval '1 month - 1 day')::date, interval '1 day') d
    WHERE public.is_business_day(d::date)
  ), demand AS (
    SELECT ss.sector, ss.flow_order, ss.daily_capacity_pairs,
           SUM(v.planned_pairs) AS planned_pairs
      FROM public.v_sop_plan_items v
      JOIN public.technical_sheets ts ON ts.id = v.reference_id
      JOIN public.sector_settings ss ON ss.enabled
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(ts.production_sectors, '[]'::jsonb)) x WHERE btrim(x.value) = ss.sector)
     WHERE v.plan_id = p_plan_id
     GROUP BY ss.sector, ss.flow_order, ss.daily_capacity_pairs
  ), open_orders AS (
    SELECT os.stage_name AS sector, SUM(GREATEST(0, os.quantity_total - os.quantity_processed)) AS pairs
      FROM public.order_stages os JOIN public.orders o ON o.id=os.order_id
     WHERE o.status IN ('Reservado','Em Produção') AND os.status <> 'concluido'
     GROUP BY os.stage_name
  )
  SELECT ss.sector, ss.flow_order, COALESCE(d.planned_pairs,0), ss.daily_capacity_pairs,
         days.n, ss.daily_capacity_pairs * days.n,
         CASE WHEN ss.daily_capacity_pairs * days.n > 0 THEN round(COALESCE(d.planned_pairs,0) / (ss.daily_capacity_pairs * days.n) * 100, 1) ELSE 0 END,
         COALESCE(oo.pairs,0)
    FROM public.sector_settings ss CROSS JOIN days
    LEFT JOIN demand d ON d.sector=ss.sector
    LEFT JOIN open_orders oo ON oo.sector=ss.sector
   WHERE ss.enabled
   ORDER BY ss.flow_order;
END;
$fn$;

-- Gestão diária dos setores existentes: mesma agenda do motor + ledger de apontamento.
CREATE OR REPLACE FUNCTION public.get_sector_daily_management(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(sector text, flow_order integer, planned_pairs numeric, pointed_pairs numeric,
              adherence_pct numeric, open_ops integer, wip_pairs numeric, oldest_due_date date, priority_order_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'Permission denied'; END IF;
  RETURN QUERY
  WITH scheduled AS (
    SELECT sector, SUM(planned_pairs) planned_pairs FROM public.production_schedule
     WHERE date = p_date GROUP BY sector
  ), pointed AS (
    SELECT stage_name AS sector, SUM(quantity) pointed_pairs FROM public.production_pointings
     WHERE created_at >= (p_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND created_at < ((p_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
     GROUP BY stage_name
  ), wip AS (
    SELECT os.stage_name AS sector, count(*)::integer open_ops,
           SUM(GREATEST(0, os.quantity_total - os.quantity_processed)) wip_pairs,
           MIN(COALESCE(pq.due_date, so.delivery_deadline, o.planned_delivery)) oldest_due_date,
           (array_agg(o.id ORDER BY COALESCE(pq.due_date, so.delivery_deadline, o.planned_delivery) NULLS LAST, o.created_at))[1] priority_order_id
      FROM public.order_stages os JOIN public.orders o ON o.id=os.order_id
      LEFT JOIN public.sale_orders so ON so.id=o.sale_order_id
      LEFT JOIN public.production_queue pq ON pq.order_id=o.id
     WHERE o.status IN ('Reservado','Em Produção') AND os.status <> 'concluido'
     GROUP BY os.stage_name
  )
  SELECT ss.sector, ss.flow_order, COALESCE(s.planned_pairs,0), COALESCE(p.pointed_pairs,0),
         CASE WHEN COALESCE(s.planned_pairs,0) > 0 THEN round(LEAST(100, COALESCE(p.pointed_pairs,0) / s.planned_pairs * 100),1) ELSE NULL END,
         COALESCE(w.open_ops,0), COALESCE(w.wip_pairs,0), w.oldest_due_date, w.priority_order_id
    FROM public.sector_settings ss
    LEFT JOIN scheduled s ON s.sector=ss.sector
    LEFT JOIN pointed p ON p.sector=ss.sector
    LEFT JOIN wip w ON w.sector=ss.sector
   WHERE ss.enabled ORDER BY ss.flow_order;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_sop_plan(date,text,text), public.upsert_sop_plan_item(uuid,uuid,text,numeric,numeric,numeric,text), public.approve_sop_plan(uuid), public.get_sop_sector_load(uuid), public.get_sector_daily_management(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sop_plan(date,text,text), public.upsert_sop_plan_item(uuid,uuid,text,numeric,numeric,numeric,text), public.approve_sop_plan(uuid), public.get_sop_sector_load(uuid), public.get_sector_daily_management(date) TO authenticated, service_role;
GRANT SELECT ON public.v_sop_plan_items TO authenticated;
