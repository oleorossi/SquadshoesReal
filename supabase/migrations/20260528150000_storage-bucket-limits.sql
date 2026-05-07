-- =============================================================================
-- Hardening de buckets de Storage: file_size_limit + allowed_mime_types
-- =============================================================================
-- Auditoria identificou 8 dos 9 buckets sem limite de tamanho nem MIME
-- whitelist. Risco: usuário autenticado (ou atacante com anon key em buckets
-- públicos) pode subir arquivos gigantes ou executáveis maliciosos.
-- Esta migration aplica limites sensatos por propósito de cada bucket.
-- =============================================================================

-- Imagens (avatar/cliente/produto/silk): max 5MB, JPEG/PNG/WebP/SVG
UPDATE storage.buckets SET
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']
WHERE id IN ('avatars','client-logos','reference-images','silk-images');

-- Documentos PDF/imagens (certificados, recibos, comprovantes, OS): max 10MB
UPDATE storage.buckets SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'image/jpeg','image/png','image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
WHERE id IN ('certificates','employee-receipts','finance-attachments','service-orders');

-- timesheet-imports já estava configurado em 20260525130000 (10MB + xlsx/txt/csv).
