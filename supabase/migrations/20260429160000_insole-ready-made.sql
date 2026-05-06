-- insole_ready_made: palmilha pronta na cor
-- When true: no insole cutting, no lining sector, no Forração/Costura operator sheets
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_ready_made boolean NOT NULL DEFAULT false;
