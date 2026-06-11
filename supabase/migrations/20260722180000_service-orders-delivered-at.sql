-- =============================================================================
-- Entrega rápida de OS terceirizada — data real de entrega
-- =============================================================================
-- A ação "Marcar como Entregue" (1 clique na lista de OSs em /terceirizados)
-- grava status='Concluído' + delivered_at=now(). Antes a única âncora temporal
-- de conclusão era receipt_generated_at/updated_at (frágil: updated_at muda em
-- qualquer edição). delivered_at registra o momento REAL da entrega declarada.
--
-- Idempotente (IF NOT EXISTS) — segura pra rodar via supabase db push ou MCP.
-- Após aplicar, regenerar src/integrations/supabase/types.ts (o frontend usa
-- `(supabase as any)` neste update até lá).
-- =============================================================================

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

COMMENT ON COLUMN public.service_orders.delivered_at IS
  'Momento em que a OS foi marcada como Entregue (ação rápida da lista em /terceirizados). NULL em OSs antigas concluídas antes da coluna existir — fallback: receipt_generated_at/updated_at.';
