-- REGRA DE NEGÓCIO (decisão do dono, 03/08/2026): a perda de corte NÃO EXISTE
-- neste sistema. Os valores de consumo cadastrados (dm²/par, g/par, un/par) já
-- consideram o rendimento REAL do material — somar um percentual por cima conta a
-- mesma perda duas vezes e infla consumo, reserva, débito, custeio e compra.
--
-- As migrations `20261112120800` (zerou o dado) e `20261115120300` (arrancou o
-- conceito do cálculo, 8 pontos incluindo a view `purchase_projection_timeline`)
-- fecharam isso no caminho principal. Sobrou UM resíduo do padrão antigo:
-- `technical_reference_materials.waste_factor` com `DEFAULT 5`, criado lá em
-- `20260403223523` junto com a tabela.
--
-- ESCOPO DESTA MIGRATION: só o DEFAULT. Não dropa a coluna, não mexe na tela, não
-- remove as multiplicações `× (1 + waste_factor / 100)` que ainda existem no painel
-- `TechnicalReferencePanel.tsx` e no hook `useTechnicalReferenceValidation.ts`. O
-- destino do módulo "Referências Técnicas" é decisão de produto ainda não tomada.
--
-- POR QUE É PREVENÇÃO, NÃO CONSERTO: verificado antes de aplicar —
--   select count(*) from public.technical_reference_materials;  -- 0 linhas
-- e nenhuma função/view de consumo, custeio, MRP ou compra lê essa tabela (a única
-- que a referencia é `merge_product_into`, que só remapeia `product_id`). Hoje o
-- valor morre na própria tela. O risco é futuro: com `DEFAULT 5`, toda linha nova
-- nasce com perda, e no dia em que esse módulo for religado a algum cálculo a
-- duplicidade volta sozinha — sem ninguém ter decidido nada.
--
-- Por ser tabela vazia, NÃO há UPDATE de backfill aqui de propósito. Se um dia
-- houver linhas legadas com waste_factor > 0, elas precisam de decisão explícita do
-- dono, não de um UPDATE silencioso escondido numa migration de DEFAULT.
--
-- ⚠ NÃO reverter para 5 achando que zero é bug: zero é a regra vigente.

ALTER TABLE public.technical_reference_materials
  ALTER COLUMN waste_factor SET DEFAULT 0;

COMMENT ON COLUMN public.technical_reference_materials.waste_factor IS
  'Perda de corte em %. DESATIVADO — a perda de corte não existe neste sistema '
  '(decisão do dono, 03/08/2026; migrations 20261112120800 e 20261115120300). '
  'DEFAULT 0. A coluna sobrevive só porque o módulo Referências Técnicas ainda não '
  'teve seu destino decidido; nenhum cálculo de consumo/custeio/MRP/compra a lê. '
  'Não voltar o DEFAULT para 5 sem decisão de negócio explícita.';
