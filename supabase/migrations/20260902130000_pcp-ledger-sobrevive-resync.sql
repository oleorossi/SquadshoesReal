-- ============================================================================
-- Fix (code review 2026-07-01): o ledger production_pointings nascia com
-- order_stage_id ON DELETE CASCADE, e resync_op_atomic faz
-- `DELETE FROM order_stages WHERE order_id = ...` antes de recriar os
-- estágios — ou seja, um resync de rotina (salvar ficha técnica com OP em
-- produção) apagava TODO o histórico de apontamentos da OP, contradizendo o
-- contrato de ledger append-only.
--
-- Correção: order_stage_id vira NULLABLE com ON DELETE SET NULL. O histórico
-- sobrevive ao resync — quem/quanto/quando ficam preservados via order_id +
-- stage_name (que já são gravados desnormalizados na linha do apontamento).
-- ============================================================================

ALTER TABLE public.production_pointings
  ALTER COLUMN order_stage_id DROP NOT NULL;

ALTER TABLE public.production_pointings
  DROP CONSTRAINT IF EXISTS production_pointings_order_stage_id_fkey;

ALTER TABLE public.production_pointings
  ADD CONSTRAINT production_pointings_order_stage_id_fkey
  FOREIGN KEY (order_stage_id) REFERENCES public.order_stages(id) ON DELETE SET NULL;
