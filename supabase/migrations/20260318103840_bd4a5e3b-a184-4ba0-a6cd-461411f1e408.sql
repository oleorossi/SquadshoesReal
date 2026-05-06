
-- Tornar todos os buckets públicos em privados
UPDATE storage.buckets SET public = false WHERE id IN ('avatars', 'client-logos', 'employee-receipts', 'reference-images');
