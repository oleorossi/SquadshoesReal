-- Padrão de etiqueta por cliente (Etiquetagem Cliente multi-cliente).
-- Guarda layout/medidas/branding; NÃO guarda histórico de arquivos importados.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS label_pattern jsonb;

COMMENT ON COLUMN public.clients.label_pattern IS
  'Padrão editável de etiqueta do cliente (version/key/geometry/branding). Sem histórico de pedidos.';
