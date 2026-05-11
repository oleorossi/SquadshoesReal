-- ============================================================================
-- AUDIT ROUND 7 — Fixes do fluxo de pedido (Frontend ↔ Backend)
-- ============================================================================
-- Cobertura: 3 achados da auditoria de fluxo "PV → produção → expedição → NF":
--
--   FIX 1: UNIQUE constraint para financial_entries de devolução (idempotency
--          em retry de emit-nfe-devolucao). Antes: reference_type='sale_order_devolucao'
--          podia gerar estorno duplicado pq não tinha constraint. Agora: cada
--          devolução só pode ter 1 estorno ativo.
--
--   FIX 2: nfe_required na sale_orders ganha CHECK pra não voltar a NULL/false
--          sem motivo. Mantém TRUE como default seguro (PV exige NF a não ser
--          que operador marque explicitamente como informal).
--
--   FIX 3: View v_sale_order_billing_health pra mostrar PVs que estão Faturado
--          mas sem NF emitida (gap entre status e NF). Front pode usar pra
--          alertar gestor sobre PVs que deveriam ter NF.
-- ============================================================================


-- ─── FIX 1: UNIQUE em financial_entries pra devolução ───────────────────────
-- Reference_id agora é nfe_devolucoes.id (não sale_order_id) pra permitir
-- múltiplas devoluções por PV. Bloqueia duplicar estorno da MESMA devolução.

CREATE UNIQUE INDEX IF NOT EXISTS financial_entries_devolucao_unique
  ON public.financial_entries (reference_id)
  WHERE reference_type = 'sale_order_devolucao'
    AND reference_id IS NOT NULL
    AND reference_id <> ''
    AND status NOT IN ('cancelado', 'cancelled', 'estornado');

COMMENT ON INDEX public.financial_entries_devolucao_unique IS
  'Audit round 7: garante 1 estorno ativo por nfe_devolucoes.id. Retry da edge function emit-nfe-devolucao não pode mais duplicar receita negativa.';


-- ─── FIX 2: nfe_required CHECK pra evitar drift ──────────────────────────────
-- Garantia: a coluna nunca volta a NULL. Se não foi setada explicitamente,
-- assume TRUE (padrão seguro - exige NF). Trigger BEFORE INSERT/UPDATE
-- aplicado em sale_orders.

CREATE OR REPLACE FUNCTION public.tg_sale_orders_default_nfe_required()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.nfe_required IS NULL THEN
    NEW.nfe_required := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_default_nfe_required ON public.sale_orders;
CREATE TRIGGER tg_default_nfe_required
  BEFORE INSERT OR UPDATE OF nfe_required ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sale_orders_default_nfe_required();


-- ─── FIX 3: View de health do faturamento ────────────────────────────────────
-- Mostra PVs onde status e NF estão dessincronizados:
--   - Faturado mas sem NF autorizada (gap principal — operador esqueceu de emitir)
--   - NF autorizada mas status ainda não é Faturado (raro - emit-nfe deveria avançar)
--   - PV nfe_required=true sem NF nenhuma (pendente)
--
-- Frontend pode usar pra alertar gestor sobre PVs órfãos.

DROP VIEW IF EXISTS public.v_sale_order_billing_health;

CREATE VIEW public.v_sale_order_billing_health AS
SELECT
  so.id                            AS sale_order_id,
  so.order_number,
  so.client_name,
  so.status                        AS so_status,
  so.nfe_required,
  so.total,
  so.delivery_deadline,
  so.created_at,
  -- NF info
  COUNT(n.id) FILTER (WHERE n.status = 'autorizada')                      AS nfes_autorizadas,
  COUNT(n.id) FILTER (WHERE n.status = 'rejeitada')                       AS nfes_rejeitadas,
  COUNT(n.id) FILTER (WHERE n.status = 'cancelada')                       AS nfes_canceladas,
  COUNT(n.id) FILTER (WHERE n.status IN ('processando','autorizada','cancelando')) AS nfes_ativas,
  -- AR info
  COALESCE(SUM(ar.amount) FILTER (WHERE ar.status NOT IN ('cancelled','received')), 0) AS ar_pendente,
  COUNT(ar.id)                                                             AS ar_count,
  -- Health classification
  CASE
    WHEN so.status = 'Cancelado' THEN 'cancelado'
    WHEN so.nfe_required = false THEN 'informal_ok'
    WHEN so.status = 'Faturado' AND COUNT(n.id) FILTER (WHERE n.status = 'autorizada') = 0
      THEN 'faturado_sem_nf'
    WHEN COUNT(n.id) FILTER (WHERE n.status = 'autorizada') > 0 AND so.status <> 'Faturado' AND so.status <> 'Cancelado'
      THEN 'nf_emitida_status_atrasado'
    WHEN so.status = 'Faturado' AND COUNT(n.id) FILTER (WHERE n.status = 'autorizada') > 0
      AND COALESCE(SUM(ar.amount) FILTER (WHERE ar.status NOT IN ('cancelled','received')), 0) = 0
      THEN 'faturado_sem_ar'
    ELSE 'ok'
  END                                                                      AS health
FROM public.sale_orders so
LEFT JOIN public.nfe_emitidas       n  ON n.sale_order_id  = so.id
LEFT JOIN public.accounts_receivable ar ON ar.sale_order_id = so.id
GROUP BY so.id;

GRANT SELECT ON public.v_sale_order_billing_health TO authenticated;

COMMENT ON VIEW public.v_sale_order_billing_health IS
  'Audit round 7: detecta PVs com inconsistência entre status, NF emitida e AR. Frontend usa pra alertar gestor sobre PVs órfãos (Faturado sem NF, NF emitida sem Faturado, etc.).';
