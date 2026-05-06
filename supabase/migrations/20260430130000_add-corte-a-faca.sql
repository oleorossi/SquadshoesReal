-- Adds "corte a faca" flag to technical_sheets.
-- When true the cabedal of this model must be cut in the Corte sector
-- and will appear in a dedicated "Cabedal (Corte a Faca)" section in the
-- Corte grouped report, separated by reference + color with a full grade.
ALTER TABLE technical_sheets
  ADD COLUMN IF NOT EXISTS corte_a_faca boolean NOT NULL DEFAULT false;
