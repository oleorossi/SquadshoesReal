-- =============================================================================
-- REPARO DO BACKFILL DO CUTOVER (auditoria 2026-07-13, achado #7/#12)
--
-- O bloco 2a da 20260912120200 buscava a ficha via join morto (products+nome —
-- orders.reference_id aponta DIRETO pra technical_sheets) → ficha_sectors saiu
-- NULL e toda OP aberta sem estágio recebeu o fluxo GLOBAL de 10 setores,
-- inclusive setores que a ficha exclui. Esses estágios fantasma nunca são
-- agendados pelo motor (included=false), nunca concluem pelo fluxo normal e
-- inflavam remaining_pairs pra sempre (confirmado em produção: OP-2026-01146
-- com estágio Expedição que a ficha não prevê).
--
-- Remove APENAS estágios intocados (pendente, 0 apontado, sem pointing) de OPs
-- abertas cujo setor NÃO está no production_sectors da ficha da referência
-- (join correto ts.id = o.reference_id). Idempotente.
-- =============================================================================

DO $$
DECLARE
  v_n int;
BEGIN
  DELETE FROM order_stages os
  USING orders o, technical_sheets ts
  WHERE os.order_id = o.id
    AND ts.id = o.reference_id
    AND o.deleted_at IS NULL
    AND o.status NOT IN ('Cancelada','Cancelado','Finalizado','Concluída',
                         'Faturado','Finalizado s/ NF','Rascunho')
    AND os.status = 'pendente'
    AND COALESCE(os.quantity_processed, 0) = 0
    AND NOT EXISTS (SELECT 1 FROM production_pointings pp WHERE pp.order_stage_id = os.id)
    AND ts.production_sectors IS NOT NULL
    AND jsonb_array_length(ts.production_sectors) > 0
    AND NOT (ts.production_sectors ? os.stage_name
             OR (os.stage_name IN ('Mesa','Aviamento')
                 AND (ts.production_sectors ? 'Mesa' OR ts.production_sectors ? 'Aviamento')));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'Estágios fantasma do cutover removidos: %', v_n;
END $$;

SELECT public.recompute_production_schedule('fix_ghost_stages');
