-- ============================================================================
-- GATE DE MATERIAL ANTES DO CORTE  (auditoria 2026-07-28 · Crítico #1)
-- ============================================================================
-- PROBLEMA
--   `compute_order_planned_dates()` calcula `planned_start` só REGRESSIVAMENTE
--   pela produção (entrega − Σ dias de setor). Ignora `material_ready_date`,
--   falta de material e `supplier_lead_time_days`. Resultado: OP planejada pra
--   cortar 10/08 com a napa chegando 15/08 — plano inexequível, e Capacidade
--   mostra carga sem matéria-prima.
--
-- SOLUÇÃO
--   Separar as duas datas e deixar a efetiva ser a mais tardia das duas:
--     planned_start_capacity → o regressivo puro (dono: o trigger)
--     material_ready_date    → quando o material tem como estar disponível
--                              (dono: recompute_material_gate_for_sale_orders)
--     planned_start          → GREATEST(capacidade, material) = data honesta
--
--   O gate NÃO é calculado dentro do trigger de propósito: a conta canônica
--   (`get_wave_material_needs_core`) explode o PV inteiro por grade/variante/cor
--   com conversão dm²→física — caro demais pra rodar por LINHA num INSERT em
--   lote de OPs. O trigger fica barato e aplica o gate JÁ GRAVADO; o recompute
--   roda uma vez por PV, sob demanda.
--
--   Motor único: usa `get_wave_material_needs_core`, o MESMO da onda/compras
--   (grade, variante, cor, conversão de área e reserva própria descontada).
--   Não recriar conta de falta aqui — divergir do motor foi o Alto #4.
-- ============================================================================

-- ── 1) Colunas de transparência ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS planned_start_capacity date,
  ADD COLUMN IF NOT EXISTS material_ready_date    date,
  ADD COLUMN IF NOT EXISTS material_gate_reason   text;

COMMENT ON COLUMN public.orders.planned_start_capacity IS
  'Início regressivo puro (entrega − Σ dias de setor), sem gate de material. Dono: compute_order_planned_dates().';
COMMENT ON COLUMN public.orders.material_ready_date IS
  'Data em que o material da OP tem como estar disponível (hoje + maior lead de fornecedor entre as faltas). NULL = sem falta. Dono: recompute_material_gate_for_sale_orders().';
COMMENT ON COLUMN public.orders.material_gate_reason IS
  'Por que a OP está travada por material (materiais em falta + lead). NULL quando não há trava.';

-- Backfill: quem já tem planned_start passa a ter a capacidade registrada.
UPDATE public.orders
   SET planned_start_capacity = planned_start
 WHERE planned_start_capacity IS NULL
   AND planned_start IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_material_gate
  ON public.orders (material_ready_date)
  WHERE material_ready_date IS NOT NULL;

-- ── 2) Trigger: grava a capacidade e aplica o gate já conhecido ─────────────
CREATE OR REPLACE FUNCTION public.compute_order_planned_dates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_delivery   date;
  v_corte      int;
  v_costura    int;
  v_montagem   int;
  v_mesa       int;
  v_acabamento int;
  v_capacity   date;
BEGIN
  IF NEW.sale_order_id IS NULL OR NEW.reference_id IS NULL OR NEW.quantity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT so.delivery_deadline INTO v_delivery
  FROM public.sale_orders so WHERE so.id = NEW.sale_order_id;
  IF v_delivery IS NULL THEN RETURN NEW; END IF;

  SELECT
    CASE WHEN COALESCE(ts.cutting_capacity_per_day, dlt.cutting_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.cutting_capacity_per_day, 0),
                       dlt.cutting_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_corte_dias, dlt.lead_time_corte_dias, 2) END,
    CASE WHEN COALESCE(ts.sewing_capacity_per_day, dlt.sewing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.sewing_capacity_per_day, 0),
                       dlt.sewing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_costura_dias, dlt.lead_time_costura_dias, 3) END,
    CASE WHEN COALESCE(ts.assembly_capacity_per_day, dlt.assembly_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.assembly_capacity_per_day, 0),
                       dlt.assembly_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_montagem_dias, dlt.lead_time_montagem_dias, 2) END,
    CASE WHEN ts.has_straps = true AND COALESCE(ts.mesa_daily_capacity, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              ts.mesa_daily_capacity::numeric)::int)
         WHEN ts.has_straps = true
         THEN 1
         ELSE 0 END,
    CASE WHEN COALESCE(ts.finishing_capacity_per_day, dlt.finishing_capacity_per_day, 0) > 0
         THEN GREATEST(1, CEIL(NEW.quantity::numeric /
              COALESCE(NULLIF(ts.finishing_capacity_per_day, 0),
                       dlt.finishing_capacity_per_day)::numeric)::int)
         ELSE COALESCE(ts.lead_time_acabamento_dias, dlt.lead_time_acabamento_dias, 1) END
  INTO v_corte, v_costura, v_montagem, v_mesa, v_acabamento
  FROM public.technical_sheets ts
    LEFT JOIN public.default_lead_times dlt ON dlt.shoe_category = ts.shoe_category
  WHERE ts.id = NEW.reference_id;

  IF v_corte IS NULL THEN RETURN NEW; END IF;

  v_capacity := v_delivery - v_acabamento - v_mesa - v_montagem - v_costura - v_corte;

  NEW.planned_start_capacity := v_capacity;
  -- Gate: nunca planejar o Corte antes de o material ter como chegar.
  NEW.planned_start := GREATEST(v_capacity, COALESCE(NEW.material_ready_date, v_capacity));
  RETURN NEW;
END;
$function$;

-- ── 3) Recompute do gate por PV (motor canônico) ────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_material_gate_for_sale_orders(
  p_sale_order_ids uuid[]
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so        uuid;
  v_max_lead  int;
  v_faltas    int;
  v_nomes     text;
  v_ready     date;
  v_reason    text;
  v_updated   int := 0;
  v_total     int := 0;
  v_travados  int := 0;
  v_detalhe   jsonb := '[]'::jsonb;
BEGIN
  IF p_sale_order_ids IS NULL OR array_length(p_sale_order_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('sale_orders', 0, 'orders_updated', 0, 'travados', 0, 'detalhe', '[]'::jsonb);
  END IF;

  FOREACH v_so IN ARRAY p_sale_order_ids
  LOOP
    -- Motor canônico da onda/compras: já converte dm²→física, respeita grade,
    -- variante e cor, e devolve a reserva própria do PV somada de volta.
    SELECT COALESCE(MAX(n.supplier_lead_time_days), 0),
           COUNT(*),
           string_agg(DISTINCT n.product_name, ', ' ORDER BY n.product_name)
      INTO v_max_lead, v_faltas, v_nomes
      FROM public.get_wave_material_needs_core(ARRAY[v_so], NULL::date) n
     WHERE n.shortage > 0;

    IF COALESCE(v_faltas, 0) > 0 AND v_max_lead > 0 THEN
      v_ready  := public.add_business_days(CURRENT_DATE, v_max_lead)::date;
      v_reason := v_faltas || ' material(is) em falta (lead ' || v_max_lead || 'd): '
                  || left(COALESCE(v_nomes, ''), 300);
      v_travados := v_travados + 1;
    ELSE
      v_ready  := NULL;
      v_reason := NULL;
    END IF;

    -- OPs vivas do PV: a gravação é idempotente (mesmo PV recalculado 2× dá o
    -- mesmo resultado) e planned_start volta pra capacidade quando a falta some.
    UPDATE public.orders o
       SET material_ready_date  = v_ready,
           material_gate_reason = v_reason,
           planned_start        = GREATEST(
                                    COALESCE(o.planned_start_capacity, o.planned_start),
                                    COALESCE(v_ready, COALESCE(o.planned_start_capacity, o.planned_start))
                                  ),
           updated_at           = now()
     WHERE o.sale_order_id = v_so
       AND o.deleted_at IS NULL
       AND o.status NOT IN ('Finalizado', 'FINALIZADO', 'Faturado', 'Cancelada', 'Cancelado')
       AND (o.material_ready_date IS DISTINCT FROM v_ready
            OR o.material_gate_reason IS DISTINCT FROM v_reason);
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;

    v_detalhe := v_detalhe || jsonb_build_array(jsonb_build_object(
      'sale_order_id', v_so,
      'faltas',        COALESCE(v_faltas, 0),
      'lead_days',     COALESCE(v_max_lead, 0),
      'ready_date',    v_ready,
      'ops_updated',   v_updated
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'sale_orders',    array_length(p_sale_order_ids, 1),
    'orders_updated', v_total,
    'travados',       v_travados,
    'detalhe',        v_detalhe
  );
END;
$function$;

COMMENT ON FUNCTION public.recompute_material_gate_for_sale_orders(uuid[]) IS
  'Recalcula o gate de material das OPs vivas de cada PV usando get_wave_material_needs_core (motor canônico) e reajusta planned_start = GREATEST(capacidade, material). Idempotente.';

-- ── 4) Consulta do gate de UMA OP (com OC/ETA em aberto) ────────────────────
CREATE OR REPLACE FUNCTION public.check_order_material_gate(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so        uuid;
  v_faltas    jsonb := '[]'::jsonb;
  v_max_lead  int   := 0;
  v_n         int   := 0;
  v_ready     date;
  v_pior_eta  date;
  v_sem_oc    int   := 0;
BEGIN
  SELECT o.sale_order_id INTO v_so FROM public.orders o WHERE o.id = p_order_id;
  IF v_so IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'motivo', 'OP sem PV vinculado');
  END IF;

  SELECT COALESCE(jsonb_agg(x.linha ORDER BY x.shortage DESC), '[]'::jsonb),
         COALESCE(MAX(x.lead), 0), COUNT(*),
         MAX(x.eta), COUNT(*) FILTER (WHERE x.eta IS NULL)
    INTO v_faltas, v_max_lead, v_n, v_pior_eta, v_sem_oc
    FROM (
      SELECT n.shortage,
             n.supplier_lead_time_days AS lead,
             -- ETA = data prometida (ou "comprar até") da OC ABERTA mais tardia
             -- que contém esse material pra este PV. NULL = sem OC = sem previsão.
             (SELECT MAX(COALESCE(po.promised_date, po.purchase_by_date))
                FROM public.purchase_orders po
                JOIN public.purchase_order_items poi ON poi.purchase_order_id = po.id
               WHERE poi.product_id = n.product_id
                 AND lower(COALESCE(po.status, '')) NOT IN
                     ('cancelled', 'canceled', 'cancelado', 'cancelada',
                      'received', 'recebido', 'completed', 'concluido', 'concluído')) AS eta,
             jsonb_build_object(
               'product_id', n.product_id, 'product_name', n.product_name,
               'color', n.color, 'unit', n.unit,
               'needed', round(n.needed_qty, 3), 'stock', round(n.stock_qty, 3),
               'shortage', round(n.shortage, 3), 'lead_days', n.supplier_lead_time_days
             ) AS linha
        FROM public.get_wave_material_needs_core(ARRAY[v_so], NULL::date) n
       WHERE n.shortage > 0
    ) x;

  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', true, 'faltas', '[]'::jsonb, 'ready_date', NULL);
  END IF;

  v_ready := public.add_business_days(CURRENT_DATE, GREATEST(v_max_lead, 0))::date;

  RETURN jsonb_build_object(
    'ok',              false,
    'faltas',          v_faltas,
    'faltas_count',    v_n,
    'sem_oc',          v_sem_oc,        -- faltas sem NENHUMA OC aberta = risco puro
    'lead_days',       v_max_lead,
    'ready_date',      v_ready,
    'pior_eta_oc',     v_pior_eta,
    'sale_order_id',   v_so
  );
END;
$function$;

COMMENT ON FUNCTION public.check_order_material_gate(uuid) IS
  'Gate de material de UMA OP: faltas do PV pelo motor canônico + ETA da OC aberta. ok=false significa liberar o Corte sem matéria-prima garantida.';

GRANT EXECUTE ON FUNCTION public.recompute_material_gate_for_sale_orders(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_order_material_gate(uuid) TO authenticated;
