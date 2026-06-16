-- ════════════════════════════════════════════════════════════════════════════
-- Tiras artesanais — largura de corte na RECEITA (`artisanal_recipes.cut_width_mm`)
-- ════════════════════════════════════════════════════════════════════════════
-- Largura de corte da tira artesanal, em MILÍMETROS, cadastrada diretamente na
-- tela "Receitas → Produtos artesanais". É a largura usada para calcular quantas
-- tiras saem do rolo padrão (40 m × 1370 mm) no bloco "corte do rolo" dos painéis
-- de consumo do PV (Resumo de Consumo e Lista de Separação).
--
-- Por que na receita: o Leonardo cadastra a tira artesanal AQUI (não no estoque).
-- A receita liga o grupo de RESULTADO (`artisanal_product_name`) à matéria-prima
-- base, e o frontend usa `artisanal_product_name` como fonte da verdade de "tira
-- artesanal". Pôr a largura no mesmo cadastro fecha o ciclo: detecção + largura
-- saem do mesmo lugar.
--
-- Resolução de largura no frontend (prioridade): cut_width_mm da receita →
-- product_groups.dimensions_width → largura de qualquer produto do grupo.
--
-- nullable: receitas existentes ficam sem largura (degradação elegante: o bloco
-- aparece com aviso "Largura não cadastrada" até o valor ser preenchido). O
-- frontend lê esta coluna via query DEFENSIVA — se ainda não estiver aplicada, o
-- painel cai na largura do grupo/produto sem quebrar.
ALTER TABLE public.artisanal_recipes
  ADD COLUMN IF NOT EXISTS cut_width_mm integer
    CHECK (cut_width_mm IS NULL OR cut_width_mm > 0);

COMMENT ON COLUMN public.artisanal_recipes.cut_width_mm IS
  'Largura de corte da tira artesanal em mm. Usada no bloco "corte do rolo" (40m × 1370mm) dos painéis de consumo do PV. Prioritária sobre product_groups.dimensions_width.';
