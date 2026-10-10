-- Lote de etiquetas térmicas com foto (ex.: 72 etq.) gerava PDF > limite
-- antigo do bucket pdf-queue → "The object exceeded the maximum allowed size"
-- e a aba /api/render-pdf falhava depois do Chromium já ter renderizado.
-- 100 MB cobre o pior caso medido sem abrir o freio do Storage.

UPDATE storage.buckets
SET file_size_limit = 104857600
WHERE id = 'pdf-queue';
