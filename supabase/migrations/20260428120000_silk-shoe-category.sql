-- Allow silk registrations to be scoped to a shoe category (Adulto / Infantil).
-- NULL means the registration applies to all categories (backwards compatible).
ALTER TABLE sole_silk_registrations
  ADD COLUMN IF NOT EXISTS shoe_category TEXT DEFAULT NULL;
