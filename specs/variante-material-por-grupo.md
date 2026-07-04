# Variante de Material por Grupo (napa) — redesenho do dialog

## Goal
Permitir que uma variante de material de uma ficha técnica aponte para **outro
grupo de material** (ex.: outra napa) em vez de um produto de cabedal individual.
A referência, o molde e a **quantidade consumida (área dm²/par) permanecem iguais**;
o que muda por variante é **qual grupo** fornece o material, e por consequência o
**SKU, o preço e o valor final de consumo** (metros lineares / custo), que saem
sozinhos da largura da ficha de componente e do preço daquele grupo.

Serve o cadastro de fichas técnicas (setor de Engenharia/PCP) que hoje precisa
duplicar fichas ou digitar consumos à mão para vender a mesma sandália em napas
diferentes.

## Background / Problem
Hoje o dialog **"Nova Variante de Material"** (`MaterialVariantsTab.tsx`, tab
VARIANTES da ficha) faz o usuário:
1. Selecionar **um produto de cabedal individual** (`upper_material_product_id`,
   filtro `category='cabedal'`) — ou seja, uma napa numa cor específica, quando o
   correto é a **família/grupo** (a cor é definida no PV).
2. Digitar **overrides de consumo por componente** (dm²/par) numa seção avançada —
   o que contradiz o princípio de que a quantidade consumida é a mesma da ficha; o
   que realmente muda entre napas é a **largura** (→ metros lineares) e o **preço**,
   não a área.

Resultado: cadastro trabalhoso e propenso a erro (consumo digitado errado infla
custo/estoque), e o modelo de dados não bate com a organização real por
`product_groups` (1 grupo = família de napa, N produtos = cores).

## Scope

### In scope
- Redesenhar o dialog de variante de material da tab VARIANTES
  (`MaterialVariantsTab.tsx`) para **selecionar grupos** (`product_groups`) em vez de
  produtos individuais.
- Variante pode apontar grupo para **3 componentes**: **Cabedal** (napa), **Forro**
  (forração) e **Palmilha**. Cada um: "herda a ficha" (default) ou "outro grupo".
- **Consumo automático**: a área (dm²/par) de cada componente vem sempre da ficha
  técnica (`upper_consumption` / `lining_consumption` / `insole_consumption` e as
  variantes `*_per_size`), **inalterada**. O valor final (metros/custo) é derivado da
  **largura** (`component_sheets`) + **preço** do grupo/produto resolvido.
- **Auto-preenchimento** da identidade fiscal a partir do grupo de cabedal
  selecionado (nome da variante, SKU, NCM, preço), tudo **editável** antes de salvar.
- Resolver, no motor de consumo/custeio (TS + SQL), a variante → **grupo + cor do
  PV** → produto específico, em vez de um produto fixo.
- Migração dos dados existentes (variantes que hoje apontam produto) para o novo
  modelo por grupo, sem quebrar consumo/custeio.
- Redesenho visual do dialog seguindo os design tokens e mobile-first (360px), via
  `/frontend-design` + `/ui-ux-pro-max`.

### Out of scope (explicitly not now)
- **Solado**: variante **nunca** troca o solado — sempre herda a ficha
  (`primary_sole_id`). Remover o seletor de solado do dialog.
- **Consumo manual por variante** (digitar dm²/par): removido. A área é sempre a da
  ficha. (Ver Open questions para a decisão de manter as colunas legadas no banco.)
- Alterar como o PV escolhe cor (o seletor de cor do PV continua o mesmo; só passa a
  oferecer as cores do grupo da variante — ver Requirements).
- Refatorar o `MaterialVariantsPanel.tsx` (painel alternativo de "Grupos de
  Material", não usado na tab VARIANTES) — fora do escopo, mas anotar divergência.

## Requirements
Numerados, testáveis, cada um é um "must".

1. Na tab VARIANTES, o botão "Adicionar Variante" abre um dialog **redesenhado** que
   substitui o seletor de "material de cabedal" (produto único) por um **seletor de
   grupo de Cabedal** (`product_groups` cujo setor mapeia para `category='cabedal'`).
2. O dialog oferece, além do Cabedal, **seletores opcionais de grupo** para **Forro**
   (grupos de forração) e **Palmilha** (grupos de palmilha), cada um com a opção
   default **"Herda a ficha"**. Nenhum seletor de Solado.
3. O dialog **não** contém campos de consumo em dm²/par (nem cabedal, nem forro, nem
   palmilha). A antiga seção "Overrides de consumo por componente (avançado)" é
   removida.
4. Ao selecionar o **grupo de Cabedal**, o dialog auto-preenche, de forma **editável**:
   - **Nome da variante** = nome do grupo (ex.: `NAPA SANTORINE`);
   - **SKU** sugerido a partir do grupo / produto representativo (mantendo o helper
     "gerar próximo SKU" como fallback);
   - **NCM** do grupo/produto representativo, ou herdado da ficha se ausente;
   - **Preço** unitário sugerido do grupo/produto representativo (continua opcional).
5. Salvar uma variante grava a referência de **grupo** por componente
   (`upper_material_group_id`, `lining_material_group_id`, `insole_material_group_id`)
   em `reference_material_variants`. Componentes deixados em "Herda a ficha" gravam
   `NULL`.
6. **Invariante de quantidade:** para qualquer variante, o consumo em **dm²/par
   (área)** de cada componente é **idêntico** ao da ficha base. A variante nunca
   altera a área — só a origem do material.
7. **Consumo/custeio resolve por grupo + cor:** o motor de consumo (TS
   `orderConsumption.ts` / `consumptionService.ts` e as RPCs SQL
   `calculate_order_consumption*`, que já recebem `p_material_variant_id`) passa a
   resolver, para cada componente com grupo definido na variante, o **produto
   específico** pela **cor do item do PV** dentro daquele grupo
   (`resolve_material_product`), aplicando a largura (`get_material_conversion_info`)
   e o preço desse produto. A área continua vindo da ficha.
8. **Precedência de resolução** por componente (upper/lining/insole), do mais
   específico ao mais genérico:
   1. `*_material_group_id` da variante → produto por cor do PV;
   2. `*_material_product_id` da variante (legado — back-compat);
   3. pin da ficha (`upper_material_product_id` etc.);
   4. grupo/cor da própria ficha.
9. No **PV**, ao escolher esta variante, as **cores oferecidas** para o item passam a
   ser as cores dos produtos do **grupo de cabedal** da variante (não uma lista
   manual). Selecionar variante sem cor válida no grupo bloqueia/avisa (não grava cor
   inexistente — respeita o guard de cor já existente).
10. **Migração de dados:** cada variante existente com `upper_material_product_id`
    (e `lining_/insole_material_product_id`) recebe o `*_material_group_id`
    correspondente = `group_id` do produto apontado. Variantes sem produto ficam
    `NULL` (herdam ficha). O consumo/custeio dos PVs existentes **não muda de valor**
    após a migração (verificável).
11. Validação preservada: **SKU único por ficha** (case-insensitive) e **nome de
    variante único por ficha**, com mensagem de erro clara (comportamento atual
    mantido).
12. O redesenho usa **design tokens** (sem cores hardcoded — passa `npm run
    check:tokens`), funciona em **360px**, e mantém as ações existentes que fazem
    sentido: toggle Ativo, Descrição NF-e, sugerir-NCM por IA, duplicar variante,
    reordenar, ativar/inativar.

## Data model / Domain

### Tabela `reference_material_variants` (existente)
Colunas relevantes hoje: `id, reference_id, material_name, sku, barcode, ncm,
description_override, unit_price_override, available_colors, active, display_order`,
mais os pins/overrides:
`upper_material_product_id, upper_consumption_override,
lining_material_product_id, lining_consumption_override,
insole_material_product_id, insole_consumption_override,
sole_material_product_id, sole_consumption_override`.

### Migração (nova)
- **Adicionar** colunas FK → `product_groups(id)`:
  `upper_material_group_id`, `lining_material_group_id`, `insole_material_group_id`
  (nullable; `ON DELETE SET NULL` ou `RESTRICT` — decidir com o padrão do projeto).
- **Backfill:** `UPDATE ... SET upper_material_group_id = (SELECT group_id FROM
  products WHERE id = upper_material_product_id)` e equivalentes para lining/insole.
- **Não** adicionar coluna de grupo para solado (fora do escopo).
- **Manter** as colunas `*_material_product_id` e `*_consumption_override` no banco
  (back-compat do motor e das variantes legadas). A UI redesenhada **para de
  escrever** os `*_consumption_override` (sempre NULL em variantes novas). Drop
  eventual dessas colunas fica para depois (Open questions).

### Motor de consumo/custeio
- **TS:** `src/lib/orderConsumption.ts` (lê hoje `upper_material_product_id` /
  `lining_material_product_id` — linhas ~611 e ~686) e
  `src/services/consumptionService.ts` (passa `p_material_variant_id`) precisam da
  nova precedência do requisito 8.
- **SQL:** RPC `calculate_order_consumption` / `..._by_grade` (aplicam
  `p_material_variant_id` desde a mig `20260629210000`) precisam ler
  `*_material_group_id` e resolver produto por cor via `resolve_material_product`,
  usando `get_material_conversion_info` para dm²→física. **Área sempre da ficha.**
- Travar com teste de paridade (existe `orderConsumption.test.ts` no TS e
  `run_consumption_parity_tests()` no SQL) para garantir que a migração não muda
  valores dos PVs existentes.

### Grupos (`product_groups`)
- Filtro do seletor de Cabedal: grupos cujo `sector` mapeia para
  `category='cabedal'` (usar `SECTOR_OPTIONS`/`categoryFromGroup.ts`). Forro → setor
  de forração; Palmilha → setor de palmilha. Reusar `useGroups` (não recriar árvore).
- "Produto representativo" do grupo (para sugerir SKU/NCM/preço): definição default =
  primeiro produto ativo do grupo por ordem de nome (anotar; ajustável).

## User flows

### Happy path — cadastrar variante por grupo
1. Usuário abre a ficha `DS05` → tab **VARIANTES** → **Adicionar Variante**.
2. No dialog, seção **Material**, campo **Cabedal**: escolhe o grupo `NAPA
   SANTORINE` num combobox com busca (mostra nome do grupo, SKU do produto
   representativo, nº de cores).
3. Nome/SKU/NCM/preço auto-preenchem a partir do grupo; usuário ajusta o SKU se
   quiser.
4. (Opcional) Em **Forro** e **Palmilha**, mantém "Herda a ficha" ou escolhe outro
   grupo.
5. Salva. A variante aparece na tabela com o nome e o SKU. Nenhum dm²/par foi pedido.
6. No **PV**, ao adicionar a referência `DS05`, o dropdown de variante mostra `NAPA
   SANTORINE`; ao escolhê-la, as cores disponíveis são as do grupo. O consumo/custo
   do PV usa a área da ficha + largura/preço da napa Santorine.

### Alternate / edge flows
- **Editar** variante existente (migrada): o dialog abre com o grupo já selecionado
  (derivado do backfill); usuário pode trocar o grupo.
- **Duplicar** variante: copia grupos + identidade; usuário troca o grupo de cabedal
  e o SKU. (Manter o fluxo de duplicação de BOM específico já existente.)
- **Herda a ficha** em todos os componentes: variante que só muda identidade fiscal
  (SKU/NCM/descrição) sobre o mesmo material da ficha — permitido.

## Edge cases & failure modes
- **Grupo sem largura na ficha de componente** → dm²→metros não converte; o consumo
  fica marcado `widthMissing` (aviso âmbar, linha neutra) exatamente como já ocorre
  hoje. Não travar o cadastro da variante; avisar no consumo.
- **Cor do PV não existe no grupo da variante** → respeitar o guard de cor: não
  gravar cor inexistente; avisar o usuário (requisito 9).
- **Grupo vazio** (sem produtos ativos) → permitir selecionar, mas avisar que não há
  produto/cor resolvível; o consumo cairá em fallback e sinalizará.
- **Variante legada** sem grupo e sem produto → herda a ficha (precedência 3/4).
- **SKU/nome duplicado** na ficha → bloquear com toast (requisito 11).
- **Palmilha placa + forração:** o grupo de Palmilha deve mirar o material de
  **forração da palmilha** (napa), não a placa (EVA). Palmilha "pronta na cor" não
  debita — a variante de palmilha não deve reintroduzir débito. (Ver Open questions.)
- **Snapshot de custo congelado:** custos já calculados de PVs antigos usam snapshot;
  mudar a variante/grupo não reescreve o snapshot (comportamento conhecido — só novos
  cálculos refletem).

## Constraints & assumptions
- Stack: React + TS, shadcn/ui, Supabase; **português** em código/UI; datas
  `dd/MM/yyyy`; moeda `R$ 0.000,00`; **mobile-first 360px**.
- **Design tokens obrigatórios** (`src/index.css`); rodar `npm run check:tokens`
  após edits. Sem cores hardcoded.
- **Unidades canônicas**: área em `dm²`; conversão dm²→física mora na **largura da
  ficha de componente**, nunca em `conversion_rate` (regra canônica do projeto).
- Typecheck real: `bunx tsc -p tsconfig.app.json --noEmit` antes de commitar.
- Migrations em `supabase/migrations/`, aplicadas via MCP (preferido); registrar no
  histórico. Idempotência para o GitHub Action.
- **Assumption (default registrado):** manter colunas `*_material_product_id` e
  `*_consumption_override` no banco por back-compat; UI nova não escreve os
  `*_consumption_override`.
- **Assumption:** "produto representativo" do grupo = primeiro produto ativo por
  nome (para sugerir SKU/NCM/preço).
- **Assumption:** cores oferecidas no PV = cores dos produtos do grupo de cabedal da
  variante; `available_colors` manual deixa de ser a fonte (fica derivado/legado).
- Não tocar em Solado, no `MaterialVariantsPanel.tsx`, nem no fluxo de escolha de cor
  do PV além de trocar a fonte das cores.

## Open questions
- **Palmilha placa vs. forração:** o grupo de Palmilha da variante mira a forração da
  palmilha (napa) ou o material de placa? Default proposto: **forração da palmilha**;
  confirmar no build.
- **Drop das colunas legadas** (`*_consumption_override`, e eventualmente
  `sole_material_product_id`): fazer agora ou deixar para uma migração de limpeza
  posterior? Default: **deixar para depois**.
- **FK on delete** de `*_material_group_id`: `SET NULL` (herda ficha se o grupo for
  apagado) vs `RESTRICT`. Default proposto: `SET NULL`. **[Decidido: SET NULL]**
- **Modal Consumo de Materiais group-aware:** o preview TS (`orderConsumption.ts` /
  `computeMaterialConsumption`) não recebe a variante do item hoje. Torná-lo
  group-aware (resolver o grupo da variante em vez do grupo da ficha) é um follow-up
  — o custeio/débito (SQL) já refletem o grupo. Requer passar `material_variant_id`
  por item ao motor e resolver o nome do grupo da variante.
- **Precedência product vs group (implementado):** produto legado (`*_material_product_id`)
  resolve ANTES do grupo, pra garantir que variantes antigas não mudem de valor
  (req 10). Variantes novas nascem sem product_id → grupo governa.

## Definition of Done
- [ ] Abrir ficha `DS05` → tab VARIANTES → **Adicionar Variante** mostra o dialog
      redesenhado com seletor de **grupo** de Cabedal (não mais "material de
      cabedal"), + Forro e Palmilha opcionais, **sem** campos dm²/par e **sem**
      Solado — verificado clicando no fluxo. (Req 1,2,3)
- [ ] Selecionar o grupo `NAPA SANTORINE` auto-preenche nome/SKU/NCM/preço, todos
      editáveis. (Req 4)
- [ ] Salvar grava `upper_material_group_id` (e forro/palmilha quando escolhidos) —
      verificado por `SELECT` na tabela `reference_material_variants`. (Req 5)
- [ ] Num PV com a variante (grupos de larguras/preços diferentes), o **custeio**
      (`calculate_order_cost`/`order_costs`) e o **débito** (snapshot de
      `calculate_order_consumption`) usam a **mesma área (dm²/par)** da ficha e um
      **valor final (m/custo) diferente** por grupo — verificado por
      `calculate_order_consumption(ref, qty, cor, size, variant_id)` retornando o
      produto do grupo escolhido com `required` proporcional à largura do grupo. (Req 6,7)
- [ ] ⚠ O modal **Consumo de Materiais** (TS `orderConsumption.ts`) NÃO é
      variant-aware hoje (nunca foi, nem com o modelo antigo por produto) — mostra
      o material da ficha independente da variante. Tornar esse preview group-aware é
      **follow-up** (ver Open questions); não bloqueia custeio/débito. (Req 7 — parcial)
- [ ] Variante legada (com produto) continua consumindo/custando **o mesmo valor**
      após a migração — verificado por `run_consumption_parity_tests()` +
      `orderConsumption.test.ts` verdes. (Req 8,10)
- [ ] No PV, o dropdown de cor da variante lista as cores do **grupo** e bloqueia cor
      inexistente. (Req 9)
- [ ] Backfill: toda variante que tinha `upper_material_product_id` agora tem
      `upper_material_group_id` = `group_id` do produto — verificado por `SELECT`
      com `WHERE upper_material_product_id IS NOT NULL AND upper_material_group_id IS
      NULL` retornando 0 linhas. (Req 10)
- [ ] SKU/nome duplicado na mesma ficha bloqueiam com toast. (Req 11)
- [ ] `npm run check:tokens` limpo, layout ok em 360px, `bunx tsc -p
      tsconfig.app.json --noEmit` limpo. (Req 12)
