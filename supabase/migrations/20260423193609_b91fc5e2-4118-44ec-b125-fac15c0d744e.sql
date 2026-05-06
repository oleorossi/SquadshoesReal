-- Unify "ADOCICADO" duplicate
UPDATE public.stock_movements 
SET product_id = '600ba188-c49f-435b-93c5-f80d08ac4ac9' 
WHERE product_id = '042e2e59-1487-4a28-88cf-cadea92f838c';

DELETE FROM public.products 
WHERE id = '042e2e59-1487-4a28-88cf-cadea92f838c';

-- Rename "Tira Chata 11mm: New Whisky" for consistency
UPDATE public.products 
SET name = 'Tira chata Costurada 11mm: New Whisky' 
WHERE id = '328d4e9a-3f1f-4e2d-ace1-e1df2f2d5444';