-- ============================================================================
-- Monitoramento de gargalos por setor (Costura, Aviamento/Mesa, Corte) +
-- integração com Ordens de Serviço pra terceirizadas.
-- ============================================================================
-- Fluxo de negócio:
-- 1. Pra cada OP ativa, calculamos a JANELA de cada setor (data de início e
--    duração estimada) usando a capacidade por dia da ficha técnica e o
--    `planned_delivery` da OP.
-- 2. Agregamos por (setor, semana ISO de início) e somamos os pares planejados.
-- 3. Comparamos com a capacidade total da semana (capacidade/dia × 5 dias úteis).
-- 4. Marcamos `is_bottleneck=true` quando utilização > 100%.
-- 5. UI mostra os gargalos e oferece botão "Gerar OS Terceirizada" pra
--    transferir OPs daquele gargalo pra uma costureira/contractor externa.
--
-- Setores priorizados (usuário confirmou): costura, mesa (aviamento),
-- corte_palmilha, corte_forracao. Outros setores podem ser monitorados
-- via views derivadas no futuro.
-- ============================================================================

-- 1. service_orders ganha colunas pra rastrear gargalo de origem e fluxo de quote
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS target_sector text,
  ADD COLUMN IF NOT EXISTS bottleneck_week date,
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS quoted_deadline date;

COMMENT ON COLUMN public.service_orders.target_sector IS
  'Setor da fábrica que essa OS terceirizada está cobrindo (costura, mesa, corte_palmilha, corte_forracao). NULL = OS genérica/legacy.';
COMMENT ON COLUMN public.service_orders.bottleneck_week IS
  'Semana ISO (segunda-feira) do gargalo que originou essa OS. Usado pra associar OS ↔ alerta.';
COMMENT ON COLUMN public.service_orders.order_id IS
  'OP específica que essa OS está descarregando. Permite bloquear o avanço da OP pra Montagem até a OS retornar com prazo confirmado.';
COMMENT ON COLUMN public.service_orders.quoted_at IS
  'Quando a contratada respondeu com o prazo de entrega (status passa de pending_quote para quoted).';
COMMENT ON COLUMN public.service_orders.quoted_deadline IS
  'Prazo de devolução do trabalho prometido pela contratada. A OP só destrava pra Montagem após esse prazo ser confirmado.';

-- Índices p/ lookups frequentes (alerta de gargalo + bloqueio de Montagem)
CREATE INDEX IF NOT EXISTS idx_service_orders_order_status
  ON public.service_orders(order_id, status) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_orders_bottleneck
  ON public.service_orders(bottleneck_week, target_sector) WHERE bottleneck_week IS NOT NULL;

-- 2. Helper: dias úteis entre duas datas (seg-sex, ignora feriados em `holidays`)
CREATE OR REPLACE FUNCTION public.biz_days_between(p_start date, p_end date)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT GREATEST(1, COUNT(*)::int)
  FROM generate_series(p_start, p_end, INTERVAL '1 day') d
  WHERE EXTRACT(DOW FROM d) NOT IN (0, 6)
    AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.holiday_date = d::date)
$$;

GRANT EXECUTE ON FUNCTION public.biz_days_between(date, date) TO authenticated, service_role;

-- 3. View v_sector_weekly_load — carga estimada por (setor, semana ISO)
-- Estimativa simplificada: para cada OP ativa com planned_delivery, calculamos
-- a janela de cada setor monitorado baseado nos lead times acumulados a partir
-- do delivery date. Capacidade vem da ficha técnica (com fallback).
CREATE OR REPLACE VIEW public.v_sector_weekly_load
WITH (security_invoker = true) AS
WITH active_ops AS (
  SELECT
    o.id AS order_id,
    o.order_number,
    o.sale_order_id,
    o.reference_id,
    o.quantity,
    o.planned_delivery,
    o.color,
    o.status,
    ts.id AS sheet_id,
    ts.name AS sheet_name,
    -- NULLIF(0) é essencial: fichas hoje gravam 0 (não NULL) quando o usuário
    -- não preencheu, então COALESCE direto pegava 0 e zerava a view inteira.
    COALESCE(NULLIF(ts.costura_capacity_per_day, 0), 300) AS costura_cap,
    COALESCE(NULLIF(ts.mesa_daily_capacity, 0), 275) AS mesa_cap,
    COALESCE(NULLIF(ts.sewing_capacity_per_day, 0), 500) AS corte_palmilha_cap,
    COALESCE(NULLIF(ts.cutting_capacity_per_day, 0), 450) AS corte_forracao_cap,
    COALESCE(NULLIF(ts.lead_time_corte_dias, 0), 2) AS lt_corte,
    COALESCE(NULLIF(ts.lead_time_costura_dias, 0), 1) AS lt_costura,
    COALESCE(NULLIF(ts.lead_time_montagem_dias, 0), 2) AS lt_montagem,
    COALESCE(NULLIF(ts.lead_time_acabamento_dias, 0), 1) AS lt_acabamento
  FROM public.orders o
  JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE o.status NOT IN ('Finalizado','Concluído','Cancelada','Cancelado','finalizado','concluído','cancelada','cancelado','Rascunho','rascunho')
    AND o.planned_delivery IS NOT NULL
    AND o.quantity > 0
),
sector_windows AS (
  -- Para cada OP, gera uma linha por setor monitorado com janela
  -- (start_date, duration_days). Estimativa retroage do planned_delivery:
  -- delivery − lt_acabamento − lt_montagem = fim do bloco prep (Costura/Mesa/Corte)
  -- Setores prep rodam em paralelo, então todos têm o mesmo end_date.
  SELECT order_id, order_number, sale_order_id, reference_id, quantity,
         planned_delivery, color, status, sheet_id, sheet_name,
         'costura'::text AS sector,
         costura_cap AS capacity_per_day,
         (planned_delivery - lt_acabamento - lt_montagem - lt_costura)::date AS start_date,
         (planned_delivery - lt_acabamento - lt_montagem)::date AS end_date
  FROM active_ops
  UNION ALL
  SELECT order_id, order_number, sale_order_id, reference_id, quantity,
         planned_delivery, color, status, sheet_id, sheet_name,
         'mesa'::text,
         mesa_cap,
         (planned_delivery - lt_acabamento - lt_montagem - lt_corte)::date,
         (planned_delivery - lt_acabamento - lt_montagem)::date
  FROM active_ops
  UNION ALL
  SELECT order_id, order_number, sale_order_id, reference_id, quantity,
         planned_delivery, color, status, sheet_id, sheet_name,
         'corte_palmilha'::text,
         corte_palmilha_cap,
         (planned_delivery - lt_acabamento - lt_montagem - lt_corte)::date,
         (planned_delivery - lt_acabamento - lt_montagem)::date
  FROM active_ops
  UNION ALL
  SELECT order_id, order_number, sale_order_id, reference_id, quantity,
         planned_delivery, color, status, sheet_id, sheet_name,
         'corte_forracao'::text,
         corte_forracao_cap,
         (planned_delivery - lt_acabamento - lt_montagem - lt_corte)::date,
         (planned_delivery - lt_acabamento - lt_montagem)::date
  FROM active_ops
),
sector_per_day AS (
  -- Distribui os pares uniformemente pelos dias úteis da janela
  SELECT
    sw.order_id, sw.order_number, sw.sale_order_id, sw.reference_id, sw.quantity,
    sw.planned_delivery, sw.color, sw.status, sw.sheet_id, sw.sheet_name,
    sw.sector, sw.capacity_per_day,
    sw.start_date, sw.end_date,
    public.biz_days_between(sw.start_date, sw.end_date) AS window_days,
    sw.quantity::numeric / public.biz_days_between(sw.start_date, sw.end_date) AS pairs_per_day
  FROM sector_windows sw
  WHERE sw.end_date >= sw.start_date
)
SELECT
  -- Identificadores da OP
  spd.order_id, spd.order_number, spd.sale_order_id, spd.reference_id,
  spd.quantity, spd.planned_delivery, spd.color, spd.status,
  spd.sheet_id, spd.sheet_name,
  -- Setor e janela
  spd.sector,
  spd.capacity_per_day,
  spd.start_date,
  spd.end_date,
  spd.window_days,
  spd.pairs_per_day,
  -- Semana ISO de início (segunda-feira)
  date_trunc('week', spd.start_date::timestamp)::date AS week_start,
  EXTRACT(YEAR FROM date_trunc('week', spd.start_date::timestamp)) AS iso_year,
  EXTRACT(WEEK FROM date_trunc('week', spd.start_date::timestamp)) AS iso_week
FROM sector_per_day spd;

COMMENT ON VIEW public.v_sector_weekly_load IS
  'Carga estimada por (setor, OP, semana ISO de início). Cada linha = uma OP em um setor monitorado, com pares/dia e capacidade do setor.';

GRANT SELECT ON public.v_sector_weekly_load TO authenticated, service_role;

-- 4. View v_sector_bottlenecks — agrega por (setor, semana) e marca gargalo
CREATE OR REPLACE VIEW public.v_sector_bottlenecks
WITH (security_invoker = true) AS
SELECT
  sector,
  week_start,
  iso_year::int AS iso_year,
  iso_week::int AS iso_week,
  COUNT(DISTINCT order_id) AS ops_count,
  SUM(quantity)::int AS total_pairs_planned,
  -- Capacidade total na semana = média ponderada × 5 dias úteis
  -- (capacidade pondera por pares de cada OP)
  CASE WHEN SUM(quantity) > 0
    THEN ROUND(SUM(capacity_per_day::numeric * quantity) / SUM(quantity) * 5)::int
    ELSE 0
  END AS total_capacity_week,
  -- Utilização % = pares ÷ capacidade_semana × 100
  CASE WHEN SUM(quantity) > 0 AND SUM(capacity_per_day::numeric * quantity) > 0
    THEN ROUND((SUM(quantity)::numeric / (SUM(capacity_per_day::numeric * quantity) / SUM(quantity) * 5)) * 100)::int
    ELSE 0
  END AS utilization_pct,
  -- Marca gargalo quando excede 100% (sobrecarga real)
  CASE WHEN SUM(quantity) > 0 AND SUM(capacity_per_day::numeric * quantity) > 0
       AND (SUM(quantity)::numeric / (SUM(capacity_per_day::numeric * quantity) / SUM(quantity) * 5)) > 1.0
    THEN true ELSE false
  END AS is_bottleneck,
  -- Severidade pra UI
  CASE
    WHEN SUM(quantity) > 0 AND SUM(capacity_per_day::numeric * quantity) > 0 THEN
      CASE
        WHEN (SUM(quantity)::numeric / (SUM(capacity_per_day::numeric * quantity) / SUM(quantity) * 5)) > 1.5 THEN 'critical'
        WHEN (SUM(quantity)::numeric / (SUM(capacity_per_day::numeric * quantity) / SUM(quantity) * 5)) > 1.0 THEN 'warning'
        ELSE 'ok'
      END
    ELSE 'ok'
  END AS severity,
  -- Lista de OPs que contribuem (pra UI dar drill-down)
  ARRAY_AGG(json_build_object(
    'order_id', order_id,
    'order_number', order_number,
    'sale_order_id', sale_order_id,
    'sheet_name', sheet_name,
    'color', color,
    'quantity', quantity,
    'planned_delivery', planned_delivery,
    'pairs_per_day', ROUND(pairs_per_day, 1)
  ) ORDER BY quantity DESC) AS contributing_orders
FROM public.v_sector_weekly_load
GROUP BY sector, week_start, iso_year, iso_week;

COMMENT ON VIEW public.v_sector_bottlenecks IS
  'Gargalos agregados por (setor, semana ISO). Marca is_bottleneck=true quando utilização > 100%. ops_count + contributing_orders permitem drill-down pra UI.';

GRANT SELECT ON public.v_sector_bottlenecks TO authenticated, service_role;

-- 5. Trigger: bloqueia avanço da OP pra Montagem quando há OS terceirizada pendente
CREATE OR REPLACE FUNCTION public.tg_block_montagem_with_pending_service_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pending_os_count int;
BEGIN
  -- Só aplica quando o stage entrou em andamento (não pendente)
  IF NEW.stage_name <> 'Montagem' THEN RETURN NEW; END IF;
  IF NEW.status <> 'em_andamento' AND NEW.status <> 'em_progresso' THEN RETURN NEW; END IF;
  -- Pula se OLD já estava em andamento (não é uma transição nova)
  IF OLD IS NOT NULL AND (OLD.status = 'em_andamento' OR OLD.status = 'em_progresso') THEN RETURN NEW; END IF;

  -- Conta OS pendentes (sem prazo confirmado pela contratada) pra essa OP
  SELECT COUNT(*) INTO v_pending_os_count
  FROM public.service_orders so
  WHERE so.order_id = NEW.order_id
    AND so.status IN ('pending_quote', 'quoted_unconfirmed')
    AND so.quoted_deadline IS NULL;

  IF v_pending_os_count > 0 THEN
    RAISE EXCEPTION 'OP % tem % OS terceirizada(s) pendente(s) de confirmação de prazo. Aguarde a costureira responder antes de avançar pra Montagem.',
      NEW.order_id, v_pending_os_count
      USING ERRCODE = 'check_violation', HINT = 'Vá em /gargalos ou /terceirizados pra acompanhar.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_block_montagem_with_pending_service_order ON public.order_stages;
CREATE TRIGGER tg_block_montagem_with_pending_service_order
  BEFORE INSERT OR UPDATE OF status ON public.order_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_montagem_with_pending_service_order();

COMMENT ON FUNCTION public.tg_block_montagem_with_pending_service_order IS
  'Impede que uma OP avance pra Montagem enquanto houver OS terceirizada pendente de confirmação de prazo. Garante que o trabalho terceirizado retorne antes da etapa seguinte.';
