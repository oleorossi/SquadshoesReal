-- ════════════════════════════════════════════════════════════════════════════
-- Tiras artesanais — flag de cadastro `is_artisanal_strap` no grupo de produto
-- ════════════════════════════════════════════════════════════════════════════
-- Marca um GRUPO de tira como "artesanal cortada do rolo" (rolo padrão
-- 40 m × 1370 mm). Usado pelos painéis de consumo do PV (Resumo de Consumo e
-- Lista de Separação) para exibir o bloco vermelho "corte do rolo" e calcular
-- quantos cm do comprimento do rolo cortar.
--
-- Detecção no frontend segue a prioridade: flag por tira (strap_colors JSONB) →
-- ESTA flag de grupo → heurístico de nome. A largura de corte continua vindo de
-- `product_groups.dimensions_width` (ou da largura de qualquer produto do grupo).
--
-- DEFAULT false: não altera nada existente. O frontend lê esta coluna via query
-- DEFENSIVA — se ela ainda não estiver aplicada no banco, o painel cai no
-- heurístico sem quebrar; depois de aplicada, o cadastro explícito passa a valer.
ALTER TABLE public.product_groups
  ADD COLUMN IF NOT EXISTS is_artisanal_strap boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.product_groups.is_artisanal_strap IS
  'Grupo de tira artesanal cortada do rolo (40m × 1370mm). Liga o bloco de "corte do rolo" nos painéis de consumo do PV. A largura de corte vem de dimensions_width.';
