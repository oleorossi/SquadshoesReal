-- SP130: numeração da ficha volta para 34-40 (estava 25-40)
--
-- SINTOMA (dono, 21/08/2026): no PV (/sales/new) o item da referência SP130 abria o grid
-- "Distribuição por Numeração" com 16 colunas, de 25 a 40, quando o solado dela só produz
-- 34-40. A referência SR01, no mesmo pedido, abria correto em 34-40.
--
-- CAUSA: o grid do PV monta a faixa em três degraus (SaleOrderItemForm.tsx, memo SIZES):
--   1. range do solado — products.stock_grade->>'_size_from'/'_size_to' do grupo da ficha;
--   2. sole_size_conjugations do mesmo grupo;
--   3. último recurso: technical_sheets.sizes.
-- Os degraus 1 e 2 têm `enabled: !!sheetSpecs?.sole_group_id`. A SP130 está com
-- sole_group_id = NULL (o campo sole_material guarda o texto legado
-- 'SOLADO: CARAMELO - Caramelo (CARAMELO)', que é COR, não solado), então os dois primeiros
-- ficam desligados e o grid cai no degrau 3 — lendo o 25-40 errado da própria ficha.
--
-- ESCOPO DELIBERADO: esta migration corrige APENAS o cadastro de numeração da SP130.
-- Decisão do dono em 21/08/2026: "corrigir por enquanto só isso".
--
-- O que NÃO é feito aqui, de propósito:
--   * NÃO vincula sole_group_id. Qual é o solado real da SP130 é dado de engenharia do dono —
--     os grupos existentes são SOLADO, SOLADO 01, SOLADO 204, SOLADO 238 e SOLADO INFANTIL,
--     nenhum 'CARAMELO', e os 2 itens de PV existentes (PV-2026-00013, faturado) não apontam
--     um solado inequívoco. Inventar o vínculo contaminaria consumo por numeração, débito por
--     grade, classificação do solado e capacidade de caixa de uma vez.
--   * NÃO mexe nas outras 16 fichas sem sole_group_id (17 no total, de 56). Nenhuma delas
--     apresenta o sintoma: as demais rasteirinhas/sandálias sem vínculo já estão em 34-40, e a
--     única outra com 25-40 é a 'i40', que é Infantil (rascunho, 0 itens de PV) — ali a faixa
--     larga provavelmente está certa.
--   * NÃO altera o fallback do código nem cria trava para ficha publicada sem solado.
--
-- SEM RISCO NO HISTÓRICO: os 2 itens de PV da SP130 (PV-2026-00013, NEW TAN e TÂMARA,
-- Faturado) têm grade 34·10 35·20 36·30 37·30 38·20 39·10 — nenhum par entre 25 e 33. Estreitar
-- a faixa não cria nenhum tamanho órfão (o memo orphanSizes preservaria, mas não há o que
-- preservar).
--
-- CONVIVE COM O TRIGGER DE SYNC: trg_sync_ficha_sizes_from_sole é
-- `BEFORE INSERT OR UPDATE OF sole_group_id` e retorna cedo quando sole_group_id IS NULL —
-- este UPDATE não o dispara. E no dia em que o dono vincular o grupo, o trigger recalcula
-- `sizes` a partir do range real do solado e sobrescreve este valor, que é o comportamento
-- desejado: esta linha é ponte, não verdade concorrente.
--
-- Guarda `AND sizes = '25-40'`: re-execução vira no-op e não desfaz uma correção posterior
-- feita pela tela de Ficha Técnica.

UPDATE public.technical_sheets
   SET sizes = '34-40'
 WHERE name = 'SP130'
   AND sizes = '25-40';
