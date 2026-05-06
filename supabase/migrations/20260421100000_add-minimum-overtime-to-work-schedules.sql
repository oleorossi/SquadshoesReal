ALTER TABLE work_schedules
  ADD COLUMN IF NOT EXISTS minimum_overtime_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN work_schedules.minimum_overtime_minutes IS
  'Minimum weekly overtime minutes required before overtime is counted. Below this threshold the excess is ignored (not paid, not accumulated).';
