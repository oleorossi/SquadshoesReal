-- =============================================================================
-- 20260513170000 — production_wave_items ganha client_id + store_name
-- =============================================================================
-- Bug: 6 funções (auto_assign_sale_order_to_wave, sync_sale_order_wave_items,
-- create_wave_from_sale_order, create_solo_wave, create_production_wave,
-- split_wave_to_finishing) tentam INSERT em production_wave_items com
-- store_name + client_id, mas as colunas não existiam. Trocar PV de Rascunho
-- pra Aprovado/Em Produção dispara trigger que chama essas funções e a
-- transação falhava com: 'column store_name of relation production_wave_items
-- does not exist'.
--
-- Fix: adiciona as duas colunas. client_id FK pra clients.id, store_name
-- denormalizado do client.razao_social pra label sem JOIN.
-- =============================================================================

ALTER TABLE public.production_wave_items
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS store_name text;

CREATE INDEX IF NOT EXISTS idx_production_wave_items_client_id
  ON public.production_wave_items(client_id);
