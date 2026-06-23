-- Auditoria de consumo (A1): 8 fichas tinham lining_consumption_per_size = 0,5
-- em todas as numerações (erro de digitação), enquanto o escalar lining_consumption
-- era 5,7–5,83. Como o per-size é fonte PRIMÁRIA em todos os motores (modal, ficha,
-- by_grade, custeio, MRP), o forro vinha sendo cobrado ~11× A MENOS em 12 PVs / 9.264
-- pares → risco de ruptura de napa de forro + CMV subestimado.
--
-- Fix de DADO (não de motor): zera o per-size errado pra o escalar (5,7) assumir.
-- Idempotente: a condição não casa mais após o '{}' (per-size vazio).
-- Aplicado via MCP em 2026-06-23 (ssvxfoybzmjlypnipqzn).
UPDATE public.technical_sheets
SET lining_consumption_per_size = '{}'::jsonb, updated_at = now()
WHERE jsonb_typeof(lining_consumption_per_size) = 'object'
  AND (SELECT count(*) FROM jsonb_each_text(lining_consumption_per_size)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(lining_consumption_per_size) kv
    WHERE NULLIF(kv.value,'')::numeric <> 0.5
  )
  AND COALESCE(lining_consumption, 0) >= 5;
