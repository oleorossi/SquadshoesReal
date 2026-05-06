-- Rename the foreign key constraint to 'references' (quoted as it is a keyword)
-- This allows PostgREST to recognize the relationship as 'references'
ALTER TABLE public.orders 
RENAME CONSTRAINT orders_reference_id_fkey TO "references";

-- Update comments for clarity
COMMENT ON CONSTRAINT "references" ON public.orders IS 'Vínculo com a Ficha Técnica, exposto como "references" para a API.';
