-- First, remove any existing duplicate records before applying the unique constraint
-- We keep the most recent one for each sole_product_id
DELETE FROM public.sole_silk_registrations
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY sole_product_id ORDER BY created_at DESC) as row_num
        FROM public.sole_silk_registrations
        WHERE sole_product_id IS NOT NULL
    ) t
    WHERE t.row_num > 1
);

-- Add unique constraint to sole_product_id
ALTER TABLE public.sole_silk_registrations
ADD CONSTRAINT sole_silk_registrations_sole_product_id_unique UNIQUE (sole_product_id);
