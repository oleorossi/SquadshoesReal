-- NEUTRALIZED for fresh database setup
-- Original migration inserted Corte stages for a specific production order
-- (OP-2026-00307) using hardcoded UUIDs that only exist in the original
-- (Lovable) Supabase project. On a clean install those orders don't exist,
-- so the FK constraint on order_stages.order_id failed.
-- The technical_sheets UPDATE is kept (no-op when the row doesn't exist).

-- 1. Update I50 technical sheet to include Corte in production_sectors (safe no-op if missing)
UPDATE public.technical_sheets
SET production_sectors = '["Corte","Forração","Aviamento","Silk","Colagem","Montagem","Solagem","Acabamento"]'::jsonb,
    updated_at = now()
WHERE id = 'b85ac021-dfad-4f97-868d-1105c3451728';

-- 2. order_stages INSERT removed: hardcoded order_ids not present in fresh DB.
