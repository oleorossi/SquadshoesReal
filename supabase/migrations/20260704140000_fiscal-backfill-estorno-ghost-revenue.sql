-- =============================================================================
-- AUDITORIA FISCAL — Backfill (A): estorno da receita-fantasma
-- =============================================================================
-- Receita 'confirmed' (nenhuma recebida) reconhecida SEM NF-e autorizada em PVs
-- que exigem NF (nfe_required ≠ false). Causa: marcar 'Faturado' pela UI criava
-- receita sem documento fiscal (corrigido forward no lote 6 — gate). SPED-safe:
-- marca status='estornado' (mantém a linha p/ trilha), NÃO deleta. Cancela só
-- os AR em aberto dos MESMOS PVs. 26 PVs / R$255.475,20. Validado read-only +
-- OK do dono. Aplicada via MCP em 2026-06-01. Idempotente (após rodar, as linhas
-- viram 'estornado' e a condição status='confirmed' não as pega de novo).
-- =============================================================================
UPDATE public.financial_entries fe
SET status='estornado',
    notes = TRIM(BOTH ' |' FROM COALESCE(fe.notes,'') || ' | Estorno auditoria fiscal 2026-06-01: receita reconhecida sem NF-e autorizada (ghost revenue)')
WHERE fe.reference_type='sale_order' AND fe.type='receita' AND fe.status='confirmed'
  AND NOT EXISTS (SELECT 1 FROM public.nfe_emitidas n WHERE n.sale_order_id::text = fe.reference_id AND n.status='autorizada')
  AND EXISTS (SELECT 1 FROM public.sale_orders so WHERE so.id::text = fe.reference_id AND so.nfe_required IS DISTINCT FROM false);

UPDATE public.accounts_receivable ar
SET status='cancelled'
WHERE ar.status NOT IN ('received','cancelled')
  AND ar.sale_order_id::text IN (
    SELECT fe.reference_id FROM public.financial_entries fe
    WHERE fe.reference_type='sale_order' AND fe.type='receita' AND fe.status='estornado'
      AND fe.notes LIKE '%Estorno auditoria fiscal 2026-06-01%'
  );
