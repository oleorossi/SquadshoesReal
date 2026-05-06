-- 1. Update I50 technical sheet to include Corte in production_sectors
UPDATE public.technical_sheets 
SET production_sectors = '["Corte","Forração","Aviamento","Silk","Colagem","Montagem","Solagem","Acabamento"]'::jsonb,
    updated_at = now()
WHERE id = 'b85ac021-dfad-4f97-868d-1105c3451728';

-- 2. Insert missing Corte stages for OP-2026-00307
INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed, observations, defects, standard_time_minutes, cost_per_hour, cost_per_pair, actual_time_minutes)
VALUES 
  ('68d1d489-c541-45d5-94ad-bc136237e737', 'Corte', 1, 'pendente', 780, 0, '', '', 0, 0, 0, 0),
  ('af1ea499-27a0-4a51-8a63-b3afc94264fe', 'Corte', 1, 'pendente', 720, 0, '', '', 0, 0, 0, 0);
