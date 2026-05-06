-- Construction model restructure: 3 clear production models
-- Model 1: Corte Cabedal (sole + insole ready-made from outside, consumed in units)
-- Model 2: Corte Cabedal + Palmilha Forrada (standard with lining)
-- Model 3: Tiras (no cabedal cut, goes through Mesa sector)

-- 1. mesa_daily_capacity: daily pair capacity at the Mesa sector (Model 3 / tiras)
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity integer NOT NULL DEFAULT 0;

-- 2. insole_ready_made: sole + insole arrive ready-made (Model 1)
--    Consumed in units by size, not dm². Only cabedal needs consumption tracking.
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS insole_ready_made boolean NOT NULL DEFAULT false;

-- 3. insole_included: mark a sole product group as "comes with insole included"
--    When a sole with insole_included=true is used, the sheet defaults to Model 1.
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS insole_included boolean NOT NULL DEFAULT false;
