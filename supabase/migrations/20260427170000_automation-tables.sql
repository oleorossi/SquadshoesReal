-- automation_workflows: persists workflow definitions (replaces in-memory useState)
CREATE TABLE IF NOT EXISTS public.automation_workflows (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  description    TEXT        NOT NULL DEFAULT '',
  trigger        TEXT        NOT NULL,
  trigger_label  TEXT        NOT NULL DEFAULT '',
  conditions     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  actions        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  category       TEXT        NOT NULL DEFAULT 'orders',
  execution_count INTEGER    NOT NULL DEFAULT 0,
  success_count  INTEGER     NOT NULL DEFAULT 0,
  last_run_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- automation_executions: one row per run attempt
CREATE TABLE IF NOT EXISTS public.automation_executions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   UUID        NOT NULL REFERENCES public.automation_workflows(id) ON DELETE CASCADE,
  workflow_name TEXT        NOT NULL,
  trigger       TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  context       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_exec_workflow_id  ON public.automation_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_auto_exec_executed_at  ON public.automation_executions(executed_at DESC);

ALTER TABLE public.automation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auto_workflows_all" ON public.automation_workflows;
CREATE POLICY "auto_workflows_all"  ON public.automation_workflows  FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auto_executions_all" ON public.automation_executions;
CREATE POLICY "auto_executions_all" ON public.automation_executions FOR ALL USING (true) WITH CHECK (true);

-- auto-update updated_at on edit
DROP FUNCTION IF EXISTS public.touch_automation_workflow() CASCADE;
CREATE OR REPLACE FUNCTION public.touch_automation_workflow()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_auto_workflow_updated_at ON public.automation_workflows;
CREATE TRIGGER trg_auto_workflow_updated_at
  BEFORE UPDATE ON public.automation_workflows
  FOR EACH ROW EXECUTE FUNCTION public.touch_automation_workflow();

-- Seed default workflows only when the table is empty
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.automation_workflows LIMIT 1) THEN
    INSERT INTO public.automation_workflows
      (name, description, trigger, trigger_label, conditions, actions, enabled, category)
    VALUES
      (
        'Alerta Estoque Baixo',
        'Notifica quando um material atinge o estoque mínimo',
        'stock_below_minimum', 'Estoque abaixo do mínimo',
        '[{"id":"c1","field":"quantity","operator":"less_than","value":"min_stock"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Enviar notificação","config":{"title":"Estoque Baixo","severity":"warning","message":"Material abaixo do estoque mínimo"}}]'::jsonb,
        true, 'stock'
      ),
      (
        'Pedido Confirmado → Notifica PCP',
        'Ao criar pedido de venda confirmado, alerta o PCP para programar produção',
        'sale_order_created', 'Pedido de venda criado',
        '[{"id":"c1","field":"status","operator":"equals","value":"Confirmado"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Notificar PCP","config":{"title":"Novo pedido confirmado","severity":"info","message":"Programar produção"}},{"id":"a2","type":"log_event","label":"Log de evento","config":{"message":"Pedido confirmado recebido","level":"info"}}]'::jsonb,
        true, 'orders'
      ),
      (
        'Pagamento Recebido → Notificar',
        'Notifica financeiro ao confirmar pagamento de cliente',
        'payment_received', 'Pagamento confirmado',
        '[]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Notificar financeiro","config":{"title":"Pagamento recebido","severity":"success","message":"Confirmar baixa no sistema"}}]'::jsonb,
        true, 'finance'
      ),
      (
        'Pagamento em Atraso',
        'Alerta quando título vence sem pagamento confirmado',
        'payment_overdue', 'Pagamento em atraso',
        '[{"id":"c1","field":"days_overdue","operator":"greater_than","value":"3"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Alerta de inadimplência","config":{"title":"Título em atraso","severity":"error","message":"Cliente com pagamento atrasado"}}]'::jsonb,
        true, 'finance'
      ),
      (
        'OS Concluída → Conta a Pagar',
        'Alerta para criar título no financeiro ao concluir OS de terceirizado',
        'service_order_completed', 'OS de terceirizado concluída',
        '[{"id":"c1","field":"type","operator":"equals","value":"terceirizado"}]'::jsonb,
        '[{"id":"a1","type":"notification","label":"Notificar financeiro","config":{"title":"Nova conta a pagar pendente","severity":"warning","message":"OS concluída — criar título"}},{"id":"a2","type":"log_event","label":"Log de OS","config":{"message":"OS terceirizado concluída","level":"info"}}]'::jsonb,
        true, 'finance'
      );
  END IF;
END;
$$;
