# Padronizar o "Consumo Consolidado" (multi-PV) pelo motor e pela tela do modal do PV

## Goal

Fazer a tela **Consumo Consolidado** (quando o usuário seleciona vários pedidos de
venda e clica em "Consumo") calcular e apresentar consumo **exatamente** como o modal
"Consumo de Materiais" de um PV único (`MaterialConsumptionDialog`) — mesmo motor,
mesma tela, mesmo PDF — só que agregando os itens dos vários PVs selecionados. Serve
ao PCP/Comercial que hoje vê números divergentes entre os dois caminhos.

## Background / Problem

Existem hoje **dois caminhos de consumo que divergem**:

- **PATH A — canônico (o botão que o usuário edita).** `src/components/sale-orders/MaterialConsumptionDialog.tsx` roda o motor único
  `computeConsumptionForItems()` de `src/lib/orderConsumption.ts` (mesmo motor da
  ficha de operador). Honra todas as regras load-bearing do projeto.
- **PATH B — "Consumo Consolidado".** `src/components/sale-orders/SummaryConsumptionPanel.tsx`
  **reimplementa o motor inteiro** num loop inline (`loadAll()`, ~linhas 121-636).
  **Não chama** `orderConsumption.ts`; compartilha só os helpers-folha de
  `src/lib/materialConsumption.ts`. É uma cópia paralela que já divergiu.

Onde o Consolidado erra hoje (o motor canônico acerta):

| Regra canônica | Consolidado (PATH B) hoje |
|---|---|
| Variante de material (`sale_order_items.material_variant_id`) | ❌ nem seleciona a coluna → item com material trocado consome do grupo errado |
| Tira segue a napa da ficha (tira-base / `materialFamily`) | ❌ não aplica |
| Supressão forro cabedal×palmilha (`sole_drives_consumption`) | ❌ sempre emite "Forração" → **conta a mesma napa 2×** (bug fantasma no Corte Forração) |
| Componentes por cor (`component_colors_enabled`) | ❌ não aplica |
| dm²→linear/placa, grade, forro/palmilha do solado, packaging_mode | ✅ espelha (só nesses) |

Além do cálculo, o Consolidado hoje **não tem disponibilidade** (sem verde/vermelho,
sem "em falta"), tem **2 abas** (Consolidado / Segmentado com filtros) que o modal não
tem, e um PDF próprio — tudo divergente da apresentação do modal.

## Scope

### In scope
- Aposentar o loop `loadAll()` inline do `SummaryConsumptionPanel` e passar a calcular
  via **`fetchConsumptionContext` + `computeConsumptionForItems`** (motor canônico)
  sobre os itens agregados de **todos os PVs selecionados**.
- **Paridade total de tela e PDF** com o modal: extrair a apresentação do modal
  (tela + PDF + faixas de disponibilidade) num **componente/módulo compartilhado**, e
  fazer os dois (modal por-PV e Consolidado multi-PV) renderizarem por ele.
- **Disponibilidade (verde/vermelho) no Consolidado**, avaliada **uma vez** sobre a
  demanda **combinada** de todos os PVs (por item para não-solado; por numeração para
  solado). É uma adição deliberada — hoje o Consolidado não mostra nada disso.
- Substituir as 2 abas pela **visão única rolável do modal** (seções por componente +
  segmentação por clique na coluna Cor/Grupo/Unidade).
- Adotar no PDF do Consolidado o layout **"Comprar primeiro"** que o usuário acabou de
  fazer no modal (lista de compra de napa por família→cor, pendentes, outros
  materiais, matriz de solado), **acrescido** do cabeçalho com a lista de PVs.
- Preservar o que é próprio do multi-PV: os **chips de resumo** por unidade e a
  **lista de PVs** no topo e no PDF.

### Out of scope (explicitly not now)
- A seção **"Corte de Cabedal — Terceirização"** (gerar OS) fica **fora** do
  Consolidado; continua só no modal por-PV.
- Não mexer no **motor** `orderConsumption.ts` (só consumi-lo) nem nas funções SQL de
  custeio/MRP.
- Não mudar a **rota** (`/sales/consumo?ids=…`), o botão de entrada em `SaleOrders.tsx`,
  nem o wrapper `SaleOrdersConsumption.tsx` (plumbing permanece).
- Não alterar o comportamento do modal por-PV (a extração é refactor de mesmo
  comportamento; o modal deve continuar idêntico).
- Nada de nova migration — é mudança de frontend (o motor e o SQL já existem).

## Requirements

Numeradas, testáveis, todas "must":

1. O `SummaryConsumptionPanel` **não** deve mais conter um cálculo de consumo próprio.
   Toda a matemática de consumo vem de `computeConsumptionForItems(items, ctx)` com
   `ctx = fetchConsumptionContext(refIds)` (`refIds` = união dos `reference_id` de
   todos os PVs selecionados).
2. A query de itens do Consolidado deve **selecionar `sale_order_items.material_variant_id`**
   e o conjunto `TECHNICAL_SHEET_CONSUMPTION_COLUMNS` (via a mesma constante, não lista
   inline), para o motor resolver variante, tira-base, supressão de forro e cor-a-cor.
3. Cada item passado ao motor deve carregar o **`packaging_mode` do seu próprio PV**
   (mapa `sale_order_id → packaging_mode`), para PVs com modos diferentes mostrarem a
   caixa certa. Uma única chamada `computeConsumptionForItems` com todos os itens
   (cada um com seu `packagingMode`) é suficiente e é o caminho preferido.
4. Os números do Consolidado devem **bater com a soma** dos números do modal de cada
   PV, material a material (mesmo grupo, cor, unidade, e por numeração no solado).
5. O bug de **dupla contagem de forro** (napa contada 2× no Corte Forração) deve
   desaparecer no Consolidado — herdado da regra `suppressCabedalForracao`
   (`sole_drives_consumption`) do motor.
6. Itens com **variante de material** devem consumir do material da variante (origem
   correta), não do grupo da ficha.
7. **Disponibilidade** (verde/vermelho, "em falta") deve aparecer no Consolidado,
   avaliada **uma única vez** sobre a demanda **combinada** dos PVs:
   - não-solado: `SUM(max(0, quantity − reserved_stock))` do grupo na cor
     (`groupAvailable`), comparado ao consumo **somado** do item (grupo+cor+unidade),
     nunca somando o estoque das linhas-irmãs (evitar o fantasma 100+100+100=300);
   - solado: por numeração via `stock_grade` do produto resolvido, com baldes
     conjugados distribuídos uma vez (`buildColAvailability`); a demanda por numeração
     é **somada entre os PVs antes** de comparar.
8. A tela deve ser a **visão única do modal** (sem as 2 abas): banners âmbar de aviso,
   toolbar (totais por unidade + chip "N em falta"/"tudo em estoque" + legenda),
   seções por componente com faixa "Total do item", `SoleSection`/`SoleMatrix` colorida
   por disponibilidade, faixa "Material base" por seção, bloco vermelho de tiras
   artesanais, e **segmentação por clique** na coluna (Cor/Grupo/Unidade), inclusive a
   sub-quebra Cor × família de napa.
9. O **PDF** do Consolidado deve ser o mesmo "Comprar primeiro" do modal (napa a
   comprar por família→cor com selo "+N a cadastrar", pendentes de cadastro, outros
   materiais por componente, matriz de solado, faixa de totais, bloco de corte do
   rolo), **acrescido** de um cabeçalho listando os PVs consolidados; título/`<h1>`
   "Consumo Consolidado".
10. Os **chips de resumo** por unidade (a partir de `totalsByUnit`) e a **lista de PVs**
    no topo devem ser preservados (contexto multi-PV que o modal não tem).
11. A seção **"Corte de Cabedal — Terceirização"** não deve aparecer no Consolidado.
12. A extração do componente/módulo compartilhado deve **partir do código do modal
    recém-editado** (`MaterialConsumptionDialog.tsx`) — o modal é a fonte da
    apresentação; o Consolidado conforma-se a ele, nunca o contrário. Depois da
    extração, **não pode restar duplicação** da apresentação nem da lógica de
    disponibilidade/tiras-artesanais entre os dois arquivos.
13. O modal por-PV deve continuar **idêntico** em números, tela e PDF após a extração
    (nenhuma regressão).
14. Typecheck canônico limpo: `bunx tsc -p tsconfig.app.json --noEmit`.

## Data model / Domain

Sem mudança de schema, sem migration. Entidades/campos que o caminho passa a
respeitar (via motor):

- **`sale_order_items`**: `reference_id`, `color`, `quantity`, `grade` (grade BASE),
  `fichas`, `strap_colors`, **`material_variant_id`** (hoje não selecionado).
- **`sale_orders`**: `id`, `order_number`, `client_order_number` (cabeçalho/lista),
  `packaging_mode` (por PV → `item.packagingMode`).
- **`technical_sheets`**: exatamente as colunas de `TECHNICAL_SHEET_CONSUMPTION_COLUMNS`
  (upper/lining/insole/sole \*_material/\*_consumption/\*_per_size, `insole_has_lining`,
  `insole_ready_made`, `sole_group_id`, **`sole_drives_consumption`**, `lining_accessories`,
  `components_accessories`, `direct_components`, **`component_colors_enabled`**).
- **Contexto do motor** (`fetchConsumptionContext`): `sheet_materials` (BOM +
  `material_variant_id`), `products` (ativos, com `quantity`, `reserved_stock`,
  `stock_grade`, `sole_classification`, `is_fachetado`, `fachete_material_group_id`),
  `product_groups` (dims de placa), `component_sheets` (largura/yield/waste),
  `technical_sheet_sole/lining/palmilha_colors`, `technical_sheet_component_colors`,
  `reference_material_variants`, `sole_color_conjugations`, `sole_technical_specs`
  (fachete/lining/insole/insole-lining por numeração), `sole_standard_items_consumption`.
- **Saída** (`MaterialConsumptionRow`): `componentType`, `groupName`, `materialName`,
  `productUnit`, `color`, `totalQuantity`, `sizeBreakdown?`, `soleProductId?`,
  `widthMissing?`, `warning?`, `materialFamily?`. O Consolidado **anota** por cima:
  `available` (não-solado), `soleSizeStock` (solado), `artisanal` (equivalente napa-base
  das tiras) — exatamente como o modal.

**Regra de disponibilidade multi-PV (a única sutileza nova):** estoque é global
(`products.quantity/reserved_stock/stock_grade`), e a demanda vem **já somada** entre
PVs porque o motor agrega linhas idênticas (`addConsumptionRow` por
componentType||grupo||material||cor||unidade||família). Logo a comparação
"demanda combinada vs estoque" é feita **uma vez** por linha agregada — sem dupla
contagem. Para solado, some a demanda por numeração antes de distribuir os baldes.

## User flows

### Happy path
1. Na lista **Pedidos de Venda** (`SaleOrders.tsx`), o usuário marca ≥2 PVs e clica
   **"Consumo"** → `navigate('/sales/consumo?ids=<id1,id2,…>')`.
2. `SaleOrdersConsumption.tsx` lê `?ids=`, monta o cabeçalho editorial e renderiza
   `<SummaryConsumptionPanel saleOrderIds={…} />`.
3. O painel: (a) busca itens de todos os PVs (com `material_variant_id` +
   `TECHNICAL_SHEET_CONSUMPTION_COLUMNS`) e o `packaging_mode` por PV; (b) monta
   `refIds` e chama `fetchConsumptionContext(refIds)`; (c) roda
   `computeConsumptionForItems(itemsComModo, ctx)` **uma vez**; (d) anota
   disponibilidade e tiras artesanais (mesma lógica do modal, agora compartilhada).
4. Renderiza via o componente compartilhado `<MaterialConsumptionView
   rows artisanalStrapRows title="Consumo Consolidado" showAvailability
   orderHeaders={…} />`: chips de resumo, lista de PVs, banners, toolbar, seções por
   componente com faixas e disponibilidade, matriz de solado colorida, faixa material
   base, bloco de tiras, segmentação por clique.
5. **RELATÓRIO PDF** → mesmo layout "Comprar primeiro" do modal + cabeçalho de PVs.

### Alternate / edge flows
- 1 PV só selecionado → o Consolidado ainda funciona (chips + 1 PV no cabeçalho);
  números idênticos ao modal daquele PV.
- Segmentar por Cor → cada cor quebra por família de napa (SECTION_SEP), igual ao modal.
- PVs com `packaging_mode` diferentes → cada um mostra sua caixa (por item).

## Edge cases & failure modes

- **Seleção vazia / ids ausente** → `SaleOrdersConsumption` mostra `EmptyState`
  (comportamento atual, mantido).
- **Item sem ficha técnica** → motor não emite linha para ele (sem crash).
- **Largura faltando** (napa área sem largura na ficha de componente) → linha em dm²,
  `widthMissing`, **neutra** (sem verde/vermelho) + banner âmbar; consumo pode estar
  ~100× inflado até cadastrar — igual ao modal.
- **Aviso sem quantidade** (ex.: fachete sem specs) → linha neutra, não comparada.
  **Aviso com quantidade** (`fallback_average`) → compara normalmente.
- **Mesma napa+cor em cabedal e forração** → um único balde de estoque (itemKey sem
  componentType); somar consumo, avaliar estoque uma vez (não recriar o fantasma 300).
- **Solado com estoque total suficiente mas mal distribuído** → conta como "em falta"
  por numeração (célula vermelha), igual ao modal; baldes conjugados distribuídos uma vez.
- **Variante que troca material** → resolve origem correta (fix); sem variante, mantém
  a ficha.
- **Tiras artesanais da mesma família/cor/base em PVs diferentes** → combinam num único
  plano de corte do rolo (agregar antes de `aggregateArtisanalStrapCut`), não fragmentos
  por PV.
- **Concorrência de estoque** → disponibilidade é um retrato do momento da consulta
  (`products.quantity − reserved_stock`), não uma reserva; aceitável (igual ao modal).

## Constraints & assumptions

- **Stack/convenções:** React + TS loose (`tsconfig.app.json`), Bun, phosphor icons,
  design tokens (sem cores hardcoded em tela; **print** usa cores sólidas inline —
  regra do projeto). Domínio em pt-BR, framework em inglês.
- **Typecheck real:** só `bunx tsc -p tsconfig.app.json --noEmit` (a raiz não checa
  nada; símbolo indefinido vira ReferenceError em runtime). Rodar antes de commitar.
- **Colunas lidas pelo motor:** toda coluna `sheet.*` que o motor lê **tem que estar**
  em `TECHNICAL_SHEET_CONSUMPTION_COLUMNS` (senão vira `undefined` e a regra vira no-op
  silencioso). Consumir a constante, nunca listar inline.
- **Assunções (defaults escolhidos onde o usuário deferiu):**
  - Disponibilidade **habilitada** no Consolidado (`showAvailability = true`),
    combinada-vs-estoque-uma-vez — decisão do usuário por "paridade total". (O flag
    `showAvailability` existe no componente compartilhado; aqui fica `true`.)
  - Uma **única** chamada ao motor com todos os itens (não por-PV somado) — evita
    dupla contagem de estoque e respeita packaging por item.
  - Componente compartilhado owna o estado de sort/segmentação internamente (é pura
    apresentação).
- **Não tocar:** motor `orderConsumption.ts`, SQL de custeio/MRP, rota, botão de
  entrada, wrapper de rota, e o comportamento do modal por-PV.
- **Arquitetura recomendada (a confirmar no build):**
  - `<MaterialConsumptionView rows artisanalStrapRows title showAvailability orderHeaders? onRecalcular? loading? />`
    — **extraído do modal**; owna tela + PDF + faixas de disponibilidade; corpo termina
    após o bloco de tiras (a seção de Corte de Cabedal fica no wrapper do modal).
  - Lógica de **anotação de disponibilidade** e de **tiras artesanais** (hoje inline no
    `loadConsumption` do modal) extraída para helper(s) compartilhado(s) e reusada pelo
    Consolidado — sem duplicar.
  - `SummaryConsumptionPanel` vira wrapper fino: pipeline de dados multi-PV +
    `<MaterialConsumptionView>`. `MaterialConsumptionDialog` vira wrapper fino: pipeline
    de dados single-PV + auto-recalc + Corte de Cabedal + `<MaterialConsumptionView>`.

## Open questions

- Nenhuma bloqueante. (Confirmar no build a granularidade exata da extração —
  um componente + helpers vs um módulo — respeitando "não pode restar duplicação".)

## Definition of Done

Checklist verificável por terceiro:

- [ ] **R1/R2** — `grep` em `SummaryConsumptionPanel.tsx` não acha mais o loop próprio
  (sem `calculateGradeBasedDm2`/`classifyBomMaterial`/`resolveOption` inline); acha
  `computeConsumptionForItems` e `fetchConsumptionContext`; a query de itens seleciona
  `material_variant_id` e usa `TECHNICAL_SHEET_CONSUMPTION_COLUMNS`.
- [ ] **R3** — abrir `/sales/consumo?ids=` com 2 PVs de `packaging_mode` diferentes
  mostra a caixa correta de cada um (conferir a seção Embalagem).
- [ ] **R4** — abrir o modal de **PV-00147** e de **PV-00148** separadamente, anotar os
  totais por material; abrir o Consolidado dos dois → cada material = soma dos dois
  modais (checar NAPA MADRID Forração, NAPA SOFT, NAPA PALHA Cabedal, e a grade do
  solado por numeração).
- [ ] **R5** — num PV com solado dirigindo forro de palmilha (ex.: sandália PV-00148),
  o Consolidado **não** duplica a napa no Corte Forração (uma linha de forração, não
  duas).
- [ ] **R6** — item com `material_variant_id` no Consolidado consome do material da
  variante (comparar o grupo/material da linha com a variante cadastrada).
- [ ] **R7** — verde/vermelho aparece no Consolidado; para um material cujo estoque
  cobre a demanda **combinada** dos PVs → verde; abaixo → "faltam X"; solado colorido
  por numeração; nenhum estoque contado 2× (um material repetido em 2 PVs mostra um
  único balde disponível).
- [ ] **R8** — a tela não tem mais as abas Consolidado/Segmentado; é a visão única do
  modal; clicar na coluna Cor/Grupo/Unidade segmenta; Cor quebra por família de napa.
- [ ] **R9** — o RELATÓRIO PDF do Consolidado abre no layout "Comprar primeiro"
  (napa por família→cor, pendentes, outros, matriz de solado, corte do rolo) com um
  cabeçalho listando os PVs e `<h1>` "Consumo Consolidado".
- [ ] **R10** — chips de resumo por unidade e a lista de PVs continuam no topo.
- [ ] **R11** — a seção "Corte de Cabedal — Terceirização" não aparece no Consolidado.
- [ ] **R12** — o componente/lógica compartilhados foram extraídos do
  `MaterialConsumptionDialog` (não recriados a partir do Consolidado); não há
  duplicação de apresentação nem de anotação de disponibilidade/tiras entre os 2
  arquivos (revisão de diff).
- [ ] **R13** — regressão: o modal por-PV continua com os mesmos números, tela e PDF de
  antes (comparar um PV antes/depois).
- [ ] **R14** — `bunx tsc -p tsconfig.app.json --noEmit` sai limpo (exit 0).
