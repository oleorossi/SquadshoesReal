# Reorganização dos Grupos de Estoque — Árvore Setor → Família → Grupo

## Goal
Transformar a tela de **Grupos de Estoque** numa árvore hierárquica de 3 níveis fixos
(**Setor → Família → Grupo**) com visão de estoque agregada por nível, e reformular as
telas de edição (grupo, família, subgrupo, item) para que organizar o estoque seja rápido,
consistente e à prova de erro de setor. Serve o gestor/almoxarife da Squad Shoes que hoje
não consegue enxergar famílias de material nem o saldo/valor por grupo.

## Background / Problem
Hoje `product_groups` já tem `parent_group_id` (hierarquia livre) e `sector` (9 valores fixos
com cascade pra `products.category`), mas na prática:
- **#2 Hierarquia fraca** — ninguém usa `parent_group_id` de forma consistente; a lista é
  praticamente plana e não dá pra ver "todas as NAPAS" ou "todas as TIRAS" como família.
- **#3 Setor/categoria erra** — grupo sem setor cai em "Componente" por default; mover setor
  não avisa que reclassifica itens.
- **#4 Falta visão de estoque** — a lista mostra só nomes e contagem, não saldo/valor/reserva.
- **#5 Fluxo ruim** — criar/editar/mover é trabalhoso; reorganizar em massa é inviável.

A decisão de arquitetura (ver **Constraints**) é renderizar o Setor como nó-raiz **sem** criar
linhas sintéticas em `product_groups`, preservando todos os motores que hoje leem a tabela.

## Scope

### In scope (v1)
- Árvore de 3 níveis **Setor → Família → Grupo** em `Estoque → Organização`
  (`/estoque?tab=organization`), preservando `/grupos` como deep link.
- **Setor = nó-raiz renderizado** a partir da coluna `sector` (9 valores). Sem linha física.
- **Família** = grupo container explícito (`is_family = true`, `parent_group_id IS NULL`);
  **Grupo-folha** = `is_family = false` e sem filhos (recebe itens). Família é **opcional**,
  pode existir vazia e **nunca recebe itens diretos**.
- **Métricas inline** por nível na árvore + **painel de detalhe expansível** por grupo (ambos):
  - Nº de itens, Valor em R$ (`Σ quantity × custo`), contagem "abaixo do mínimo".
  - Barra **Reservado (vermelho) vs Disponível/livre (verde)** — **só no nível Grupo**.
- **Telas de edição** (skin B1 — Editorial vermelho): Grupo, Família, Subgrupo, Item individual.
- **Setor por chip único** com aviso de reclassificação em cascata ao mover.
- **Ações em massa**: mover grupos-folha soltos para uma Família (e mover itens entre grupos).
- **Relatório de sugestões de Família** (opt-in, 1 clique aceita; nada é aplicado sozinho).
- **Backfill não destrutivo**: legado permanece como está (grupos viram "soltos" sob o setor).

### Out of scope (explicitamente não agora)
- Setor como linha física em `product_groups` (Opção A rejeitada).
- Auto-criação automática de famílias por heurística sem confirmação (Opção B de backfill).
- Mais de 3 níveis (nenhuma família dentro de família).
- Redesenhar os motores de consumo/MRP/débito/embalagem — só **leem** grupos; não mudam.
- Alterar os motores de consumo por causa da hierarquia; a gestão visual das variantes
  continua gravando a cor real somente em `products.color`.
- Alterar a lista de 9 setores ou a semântica do cascade `sector → products.category`.

## Requirements
Numerados e testáveis. Cada um é um "must".

**Hierarquia & modelo**
1. A tela `/grupos` renderiza uma árvore com **exatamente 3 níveis**: Setor (raiz) → Família
   (opcional) → Grupo. Grupos soltos aparecem direto sob o Setor.
2. O Setor-raiz é derivado da coluna `product_groups.sector`; **nenhuma linha nova** é criada
   em `product_groups` para representar setores.
3. Uma Família é um `product_groups` com `is_family = true` e `parent_group_id IS NULL`,
   mesmo quando ainda não possui filhos. Um Grupo-folha tem `is_family = false` e não possui
   filhos. A UI rotula cada nó (`família · container` vs `grupo-folha`) por essa identidade
   explícita, mantendo a contagem de filhos como compatibilidade para legado.
4. **Invariante container**: um grupo que tem filhos **não pode ter itens** (`products.group_id`
   apontando pra ele), e um grupo que tem itens **não pode receber filhos**. Enforçado na UI e
   no banco (trigger/constraint) — a violação retorna erro claro, nunca grava.
5. Uma Família só pode conter Grupos do **mesmo setor** (o filho herda/segue o setor da mãe).
   Vincular um grupo de setor diferente é **bloqueado**; o usuário primeiro move o grupo de
   setor, confirma o aviso de cascade e depois faz o vínculo.
6. Não é permitido aninhar Família dentro de Família (profundidade máx. = Grupo). A UI não
   oferece famílias como pai de outra família.
7. Desvincular um Grupo de sua Família **não apaga** o grupo: ele volta a ser "grupo solto"
   direto no setor (mantém `sector`, zera `parent_group_id`).

**Métricas & visão de estoque**
8. Cada linha de **Grupo** mostra inline: nº de itens, valor em R$, e a barra
   **Reservado vs Livre** com números (`reservado` = `Σ reserved_stock`; `livre` =
   `Σ (quantity − reserved_stock)`, o disponível até a baixa no picking).
9. Cada linha de **Família** e de **Setor** mostra o rollup: **Σ nº de itens**, **Σ valor R$**
   e **contagem de itens abaixo do mínimo** entre seus descendentes. A barra Reservado/Livre
   **não** aparece em Família/Setor (unidades podem ser mistas).
10. Um Grupo com ao menos um item `disponível < mínimo` exibe o alerta **"abaixo do mínimo"**
    (vermelho escuro hachurado, distinto da barra vermelha de reservado).
11. Clicar num Grupo abre o **painel de detalhe** com a quebra por item: nome/cor, saldo,
    reservado, disponível, custo e valor.
12. Valor em R$ é `Σ (quantity × custo_unitário)` e **sempre** rola de Grupo → Família → Setor
    (denominador comum). O saldo bruto por unidade **não** é somado em nível agregado.

**Edição (skin B1)**
13. Existe uma tela de **edição de Grupo-folha** com abas condicionais ao tipo:
    - **Geral** (nome, descrição, comportamento de cor, tipo linha/coleção, unidade de consumo
      e acesso explícito à aplicação em lote de custo/local/reposição).
    - **Hierarquia** (Família pai opcional; mostra que é grupo-folha).
    - **Dimensões** — só material de **área**; largura obrigatória com **prévia da conversão
      dm²→metro**.
    - **Embalagem** — só **solado**; aponta para o cadastro canônico em Embalagens, sem criar
      uma segunda porta de gravação.
    - **Cores** — catálogo, duplicidades/variações próximas, saldo por variante e criação em lote.
    - **Itens** — tabela dos produtos do grupo + adicionar/remover.
14. Existe uma tela de **edição de Família** com: Geral (nome, descrição, Setor com aviso de
    cascade) e **Subgrupos** (vincular grupo existente / novo subgrupo / desvincular). Deixa
    explícito que família **não recebe item direto**. Mostra rollup (subgrupos, itens, R$).
15. A tela de **Subgrupo** é a mesma de Grupo-folha, com a aba Hierarquia mostrando a Família
    pai e o breadcrumb `SETOR › FAMÍLIA › GRUPO`.
16. Existe uma tela de **edição de Item individual** (produto) com: Geral (SKU, cor, unidade
    base, e o trio **Setor→Família→Grupo** onde Setor é herdado/somente-leitura), Estoque
    (saldo, reservado/disponível calculados, barra, mín/máx, localização) e Compra &
    Fornecedor (unidade de compra + fator de conversão, com o invariante `compra=base ⇒ fator=1`).
17. Mudar o **Setor** de um Grupo/Família via chip mostra o aviso de que **reclassifica N itens**
    (`products.category` via cascade) antes de salvar.

**Fluxo & massa**
18. **Criar Família**: a partir do Setor, criar um container (nome CAIXA ALTA, setor herdado).
19. **Criar/mover em massa**: selecionar múltiplos grupos-folha soltos e **movê-los para uma
    Família** de uma vez; e **mover itens** entre grupos-folha em lote. Nenhuma operação em
    massa quebra o invariante container (bloqueia com mensagem se quebraria).
20. **Relatório de sugestões de Família** (opt-in): lista agrupamentos prováveis (ex.: grupos
    cujo nome começa com "NAPA" → sugerir família "NAPAS"); cada sugestão é aceita com 1 clique;
    **nada é aplicado automaticamente**.

**Nomes & integridade**
21. Nomes de Família e Grupo seguem **CAIXA ALTA** e são **únicos case-insensitive globalmente**
    (reaproveita o índice único existente `product_groups_name_ci_unique`). Duplicata é
    bloqueada com aviso, tanto na UI quanto no banco.
22. Setor é **obrigatório** em toda criação (Família ou Grupo) — sem default silencioso para
    "Componente".

## Data model / Domain

Tabela central: **`product_groups`**.
- Chaves do modelo: `id`, `name` (único ci global), `sector` (CHECK nos 9 valores),
  `parent_group_id` (FK self, `ON DELETE SET NULL`), `description`, `is_family`.
- Tipo explícito: **Família** ⇔ `is_family = true`; **Grupo-folha** ⇔ `is_family = false`
  e sem filhos. O backfill marca como família toda raiz que já possuía filhos.
- Campos por tipo já existentes (visibilidade das abas): `dimensions_width/length/thickness/unit`
  (área), `box_type_*_id` + `pairs_per_box_*` (solado), flags `is_bom_color_source`,
  `is_color_agnostic`, `shared_specs`, `auto_component_sheet`, `is_artisanal_strap`,
  `unit_weight_kg`, `purchase_multiple`, `consumption_unit`.

Produtos: **`products`**
- `group_id` (FK → product_groups, `ON DELETE SET NULL`), `category` (derivada do setor via
  trigger `tg_group_sector_cascade` / `fn_products_auto_category`), `quantity`, `reserved_stock`,
  custo unitário, `min_stock`/mínimo, `max_stock`, `unit` (canônica), localização, unidade de
  compra + `conversion_rate`.
- **Disponível p/ picking** = `quantity − reserved_stock`. **Reservado** = `reserved_stock`.

**Read model de rollup** (implicado — view ou RPC, decidir na implementação):
- Por Grupo: `count(itens)`, `Σ quantity×custo`, `Σ reserved_stock`, `Σ (quantity−reserved_stock)`,
  `count(itens com disponível < mínimo)`.
- Por Família/Setor: soma dos grupos descendentes de nº itens, valor R$ e alertas de mínimo.

**Migração implicada:**
- Coluna `is_family` + triggers para o **invariante container**, identidade explícita e
  **família mono-setor** (req. 4–5). Não destrutivo.
- **Nenhum** backfill que mova grupos automaticamente (req. do backfill = Opção A).
- Função de leitura para o **relatório de sugestões** (req. 20) — read-only, não aplica nada.

## User flows

### Happy path — organizar um setor grande
1. Usuário abre `/grupos`; vê a árvore com Setores no topo (CABEDAL, COMPONENTE, SOLADO…).
2. Expande **CABEDAL**; vê grupos soltos (ex.: NAPA SANTORINE, NAPA PU, VELVET PRETO).
3. Clica **"Nova família"** no setor → cria **NAPAS** (CAIXA ALTA, setor CABEDAL herdado).
4. Seleciona NAPA SANTORINE + NAPA PU → **mover em massa** para a família NAPAS.
5. A árvore passa a mostrar `CABEDAL › NAPAS › (NAPA SANTORINE, NAPA PU)` com rollup de itens/R$.
6. Abre NAPA SANTORINE, aba **Dimensões**, cadastra a **largura (1370 mm)** → prévia dm²→m aparece.
7. Na lista, o grupo mostra a barra reservado/livre; um item abaixo do mínimo acende o alerta.

### Sugestão opt-in
1. Usuário abre **"Sugestões de Família"**; sistema lista "6 grupos parecem TIRAS — criar família?".
2. Usuário aceita 1 sugestão → família criada + grupos vinculados. As demais ficam pendentes.

### Editar item individual
1. A partir de um grupo, abre um item → vê Setor herdado (read-only), Família e Grupo editáveis.
2. Troca o grupo do item → categoria continua coerente (herdada do setor do novo grupo).

### Alternate / edge flows
- Grupo solto sem família: fica direto no Setor; totalmente válido (família é opcional).
- Setor pequeno (Fôrma, Ferramentas): pode não ter nenhuma família — só grupos soltos.

## Edge cases & failure modes
- **Adicionar item a uma Família (container)** → bloqueado com mensagem "Família não recebe itens
  direto; escolha um grupo-folha". (req. 4)
- **Vincular filho a um grupo que já tem itens** → bloqueado ("este grupo tem itens; esvazie ou
  escolha outro pai"). (req. 4)
- **Mover grupo para família de outro setor** → vínculo bloqueado; a mudança de setor precisa
  ser salva e confirmada antes, com aviso da reclassificação dos itens. (req. 5)
- **Unidades mistas num grupo** → a barra reservado/livre mostra "—" com tooltip explicando que
  o grupo tem unidades diferentes; valor R$ continua válido.
- **Grupo sem itens** → nº itens 0, valor R$ 0, sem barra; não é erro.
- **Ficha de área sem largura** → aba Dimensões marca largura faltando (aviso); consumo fica
  inflado até cadastrar (comportamento canônico já existente, apenas espelhado aqui).
- **Ciclo de hierarquia** (pai = descendente) → bloqueado (helpers `canBeParent`/`getDescendantIds`).
- **`parent_group_id` órfão** (pai deletado) → `ON DELETE SET NULL` derruba o grupo para solto;
  a árvore ainda renderiza (defensivo, sem quebrar).
- **Nome duplicado** (mesmo ci) → bloqueado na UI e no banco. (req. 21)
- **Deletar Família com filhos** → confirmar; filhos viram soltos (não são apagados).
- **Concorrência**: dois usuários movendo/renomeando o mesmo grupo → última escrita vence, mas
  o índice único e o invariante container impedem estado inválido.

## Constraints & assumptions
- **Stack**: React/Vite + Supabase (RLS). Português BR em todo código/UI. Datas `dd/MM/yyyy`,
  moeda `R$ 0.000,00`, mobile-first (funcionar em 360px). Ver `CLAUDE.md`.
- **Design tokens obrigatórios** (`src/index.css`) — sem cores hardcoded; rodar `check:tokens`
  após edits. O skin visual escolhido é **B1 (Editorial vermelho)**: acento vermelho = `primary`
  do app; reservado = vermelho, livre = verde, abaixo-do-mínimo = vermelho escuro hachurado
  (semânticas, separadas do accent). Anton (display) + Fira Sans (corpo) já no index.css.
- **Alturas** `h-*` conforme convenção; z-index via utilitários (`.z-modal`, etc.).
- **Typecheck real**: `bunx tsc -p tsconfig.app.json --noEmit` antes de commit.
- **Reusar, não duplicar**: `GroupCreateDialog.tsx` é a fonte única de criação; helpers de
  árvore em `groupHierarchy.ts` (`flattenGroupTree`, `getDescendantIds`, `canBeParent`,
  `getGroupPath`); setores em `categoryFromGroup.ts` (`SECTOR_OPTIONS`).
- **Arquitetura Setor-raiz = Opção B** (aprovada): Setor renderizado a partir da coluna
  `sector`, **sem** linhas sintéticas — evita quebrar `products.group_id`, MRP, consumo, débito
  de embalagem, variantes (todos tratam qualquer linha de `product_groups` como grupo atribuível).
- **Backfill = Opção A** (aprovada): legado intocado; reorganização é ato consciente do usuário,
  auxiliado por mover-em-massa + sugestões opt-in.
- **Motores a jusante não mudam**: consumo/MRP/custeio/embalagem continuam lendo `product_groups`
  como hoje; a hierarquia é organizacional, não altera cálculo.
- **Assunções onde o usuário deferiu** ("Aprovar"):
  - Ações em massa (mover) + relatório de sugestões entram na **v1**.
  - Unicidade de nome é **global** case-insensitive (não por setor), reusando o índice existente.
  - Toggles "ligado" = verde (estado positivo), não vermelho.

## Decisões de implementação
- Read model do rollup: RPC `get_group_stock_rollups`, agregado no cliente para Família/Setor.
- Invariantes de container, profundidade e mono-setor: triggers com mensagens em PT-BR.
- Dimensões: RPC transacional sincroniza o grupo e uma `component_sheet` por item atual.

## Definition of Done
Checklist verificável item a item.

- [ ] **Árvore 3 níveis** — abrir `/grupos` mostra Setor → Família → Grupo com indentação;
      um grupo solto aparece direto sob o setor. (req. 1, 3)
- [ ] **Sem linha de setor** — `select count(*) from product_groups where name in
      ('CABEDAL','SOLADO',…)` continua 0; nenhuma linha sintética criada. (req. 2)
- [ ] **Família container** — tentar adicionar item a uma família retorna erro e não grava;
      tentar dar filho a um grupo com itens idem. (req. 4)
- [ ] **Mono-setor** — vincular grupo de outro setor é bloqueado; mover o setor antes mostra o
      aviso de cascade e reclassifica os itens. (req. 5)
- [ ] **Desvincular preserva** — desvincular um subgrupo o transforma em solto (não apaga,
      `sector` mantém, `parent_group_id` nulo). (req. 7)
- [ ] **Métricas inline no Grupo** — cada grupo mostra nº itens, valor R$ e barra reservado/livre
      com números batendo `Σ reserved_stock` e `Σ(quantity−reserved_stock)`. (req. 8)
- [ ] **Rollup Família/Setor** — Σ itens, Σ R$ e contagem de mínimo conferem com a soma dos
      grupos; barra não aparece nesses níveis. (req. 9, 12)
- [ ] **Alerta de mínimo** — um grupo com item `disponível < mínimo` acende o alerta vermelho
      hachurado (ex.: VELVET PRETO / TIRA STRASS). (req. 10)
- [ ] **Detalhe por item** — clicar num grupo abre a quebra por item (saldo/reservado/dispon./
      custo/valor). (req. 11)
- [ ] **Edição de Grupo** — abas Geral/Hierarquia condicionais; Dimensões aparece só p/ área,
      Embalagem só p/ solado; prévia dm²→m ao preencher largura. (req. 13)
- [ ] **Edição de Família** — aba Subgrupos vincula/desvincula/cria; texto "não recebe item
      direto" presente; rollup no cabeçalho. (req. 14)
- [ ] **Edição de Subgrupo** — breadcrumb SETOR › FAMÍLIA › GRUPO e Família pai na Hierarquia. (req. 15)
- [ ] **Edição de Item** — Setor herdado read-only; Família e Grupo editáveis; barra reservado/
      livre e mín/máx; invariante de compra exibido. (req. 16)
- [ ] **Aviso de cascade** — trocar o setor por chip mostra "reclassifica N itens" antes de
      salvar; ao salvar, `products.category` dos itens muda. (req. 17)
- [ ] **Mover em massa** — selecionar ≥2 grupos soltos e movê-los para uma família numa ação;
      idem mover itens entre grupos; operação que quebraria o invariante é bloqueada. (req. 19)
- [ ] **Sugestões opt-in** — o relatório lista agrupamentos prováveis e só aplica com 1 clique
      por sugestão; nada é aplicado automaticamente. (req. 20)
- [ ] **Nomes** — criar grupo/família com nome duplicado (ci) é bloqueado na UI e no banco;
      nomes em CAIXA ALTA. (req. 21)
- [ ] **Setor obrigatório** — não é possível criar família/grupo sem setor; nada cai
      silenciosamente em "Componente". (req. 22)
- [ ] **Visual B1** — lista e telas de edição usam o skin Editorial vermelho com tokens (sem
      cores hardcoded; `check:tokens` limpo) e responsivo em 360px.
- [ ] **Sem regressão nos motores** — consumo/MRP/débito de embalagem/variantes continuam
      funcionando (nenhuma leitura de `product_groups` quebrou).
- [ ] **Typecheck** — `bunx tsc -p tsconfig.app.json --noEmit` limpo; `bun run build` passa.
