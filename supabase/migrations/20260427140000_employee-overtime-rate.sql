-- Add per-employee overtime hourly rate.
-- When set, this value (R$/hora) is used for overtime cost calculations
-- instead of the derived rate (salary / 220 * schedule.overtime_multiplier).
-- This allows each employee to have an individual overtime agreement.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS overtime_hourly_rate NUMERIC DEFAULT NULL;

COMMENT ON COLUMN public.employees.overtime_hourly_rate IS
  'Custom overtime hourly rate (R$/hr). When set, overrides salary/220 * multiplier for OT cost calculations.';
