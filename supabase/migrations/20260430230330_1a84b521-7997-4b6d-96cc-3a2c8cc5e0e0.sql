ALTER TABLE technical_sheets
  ADD COLUMN IF NOT EXISTS corte_a_faca boolean NOT NULL DEFAULT false;