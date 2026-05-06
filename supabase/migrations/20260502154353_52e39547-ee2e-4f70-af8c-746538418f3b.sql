-- 1. Renomeação de estágios em production_wave_stages (usando valores em minúsculo do enum)
UPDATE public.production_wave_stages 
SET stage = 'mesa'::production_stage_enum
WHERE stage = 'solagem'::production_stage_enum;

-- 2. Renomeação de setores em technical_sheets (production_sectors JSONB array)
-- Mantendo capitalized como parece ser o padrão no JSONB
UPDATE public.technical_sheets
SET production_sectors = (
  SELECT jsonb_agg(
    CASE 
      WHEN element = '"Solagem"' THEN '"Mesa"'::jsonb
      ELSE element 
    END
  )
  FROM jsonb_array_elements(production_sectors) AS element
)
WHERE production_sectors ? 'Solagem';

-- 3. Renomeação em order_flow_audit (coluna 'current_sector')
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'order_flow_audit') THEN
    UPDATE public.order_flow_audit
    SET current_sector = 'Mesa'
    WHERE current_sector = 'Solagem';
  END IF;
END $$;
