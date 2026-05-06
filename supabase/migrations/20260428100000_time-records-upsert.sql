-- Remove duplicate time_records, keeping the newest per (employee_name, record_date)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY employee_name, record_date
           ORDER BY created_at DESC
         ) AS rn
  FROM time_records
)
DELETE FROM time_records WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Unique constraint required for upsert (one row per employee per day)
ALTER TABLE time_records
  ADD CONSTRAINT time_records_employee_date_unique
  UNIQUE (employee_name, record_date);
