# Estoque por cor — lista colapsada + reforma dos editores

> Decidido em 02/08/2026 com protótipo sobre os dados reais de produção.
> Fase 1 é **só renderização e formulário** — nenhuma linha de `products` é
> criada, fundida ou renomeada. A higiene de dados é a Fase 2, fora deste spec.

> ## ⚠ ERRATA (22/08/2026) — o `MasterVariantDialog` não existe mais
>
> Este spec entregou a divisão certa de CAMPOS (`products` × `product_groups`) e
> as travas contra achatamento (R2.5–R2.9) — tudo isso continua valendo. O que
> ele errou foi a **embalagem**: manteve dois DIÁLOGOS para o mesmo grupo, e o
> dono derrubou isso olhando as duas telas lado a lado.
>
> O `MasterVariantDialog` virou `src/components/inventory/VariantManagerPanel.tsx`,
> exportando dois painéis sem janela própria — `VariantListPanel` e
> `VariantBulkEditPanel` — que agora são **abas do `GroupEditDialog`**. Leia,
> daqui pra frente:
>
> | Onde o spec diz | Leia |
> |---|---|
> | R1.16 `+ Cor` abre o `MasterVariantDialog` na aba Adicionar | abre a **janela do grupo** na aba **Cores** |
> | R1.16 `Editar N cores` abre o `MasterVariantDialog` na edição em massa | abre a **janela do grupo** na aba **Em massa** |
> | Parte 2 — "Edição em massa (`MasterVariantDialog.tsx`)" | `VariantBulkEditPanel`, aba **Em massa** da janela do grupo |
> | R2.4 aba `Aplicar a todas as cores` | aba **Em massa · aplicar a todas as cores** |
> | R2.11 link `Editar no grupo de estoque →` | botão que troca de ABA, não abre janela |
> | R3.2 link `Editar as N cores →` abre o `MasterVariantDialog` | troca para a aba **Em massa** |
>
> Fecha o **M4** de `inventory-packaging-overhaul.md`. A regra canônica está no
> `CLAUDE.md` ("A janela do grupo é a PORTA ÚNICA de edição") e travada por
> `src/__tests__/grupoEstoquePortaUnica.contract.test.ts`.

---

## Contexto: o que o banco diz hoje

| Fato | Número |
|---|---|
| Produtos ativos | 195 (189 em grupo + 6 sem grupo) |
| Grupos de estoque com item ativo | 32 |
| **Cores com saldo zero** | **95 de 189 — 50%** |
| **Cores com reserva maior que o saldo** | **51** |
| Maior grupo | `NAPA SOFT` — 44 cores, 27 zeradas |
| Grupo da print original | `NAPA SANTORINE` — 10 cores, `name` idêntico nas 10 |

A tela hoje empilha **três níveis** para dez cores: grupo (`product_groups.name`)
→ subgrupo por nome-base → linhas. O nível do meio não carrega informação:
`getBaseName` ([ProductTable.tsx:80](../src/components/inventory/ProductTable.tsx#L80))
corta a última palavra do nome, então dez produtos chamados `NAPA SANTORINE`
produzem o rótulo `NAPA`.

---

## Invariante de segurança — o débito não pode mudar

`resolve_material_product(grupo, cor)` resolve por **`product_groups.name` +
`products.color`**, nesta cascata: cor exata → cor contida no nome
(`partial_name`) → maior saldo do grupo. Ela **nunca** lê o agrupamento da tela
nem o nome-base.

**R0.1** — Nenhum item deste spec pode alterar `products.name`, `products.color`,
`products.group_id` ou `products.active` como efeito colateral. Onde o código
atual faz isso, o spec manda **remover** a escrita, nunca redirecioná-la.

**R0.2** — Os 21 produtos ativos com `color` vazia dependem do `partial_name`: a
cor deles só existe dentro do nome (`NAPA ONÇA`). Qualquer renomeação apaga a
única pista que o débito tem sobre eles.

---

## Parte 1 — Lista de materiais (`ProductTable.tsx`)

### 1.1 Colapso por material

**R1.1** — Remover o nível de subgrupo por nome-base do caminho de renderização.
A hierarquia passa a ser **grupo de estoque → sub-linhas**, com a linha do grupo
virando a linha colapsável. `getBaseName` continua existindo para o
`handleEditIntercepted`, mas deixa de gerar cabeçalho visual.

O colapso é por `group_id` porque essa é a mesma unidade que o
`resolve_material_product` usa para resolver cor — ele ignora o nome do produto e
disputa entre todos os itens do grupo. A tela passa a espelhar o que o débito
enxerga.

**R1.1a** — 9 dos 32 grupos guardam mais de um material (`COMPONENTES DIVERSOS`
tem 8: Binóculo, Fivela, Ilhós, ABS…). A sub-linha se adapta:

| Grupo | Contador | Sub-linha mostra |
|---|---|---|
| Homogêneo (1 nome) | `N cores` | cor · SKU |
| Heterogêneo (2+ nomes) | `N itens` | nome · cor · SKU |

A identidade de material é o `name` normalizado (uppercase, sem o sufixo `: COR`
e sem a cor repetida no fim) — **não** o `getBaseName` de corte de palavra.

**R1.2** — A linha do material nasce **fechada**, exceto quando a busca a abre
(R1.6). O estado de aberto/fechado é por sessão, em memória, não persistido.

**R1.3** — Um grupo com uma única cor renderiza a linha de cor direto, sem
cabeçalho de material — comportamento que o `renderSubGroups` já tem hoje para
subgrupo de 1 item.

**R1.4** — A ordenação por cabeçalho de coluna (`isFlatSortMode`) continua
existindo e continua produzindo lista plana sem colapso.

### 1.2 O que a linha do material mostra

**R1.5** — Da esquerda para a direita:

| Elemento | Conteúdo |
|---|---|
| Trilho de severidade | 4 px na borda esquerda: vermelho se alguma cor tem disponível negativo; âmbar se alguma cor com saldo está no ou abaixo do mínimo; cinza se todas zeradas; verde caso contrário |
| Nome | `product_groups.name`, uppercase, peso 700 |
| Metadados | setor · `N cores` · selo `N em falta` (vermelho) · selo `N zeradas` (neutro) |
| Número principal | **disponível somado** (`Σ quantity − Σ reserved_stock`), vermelho quando negativo |
| Número secundário | valor total em R$ (`Σ quantity × unit_price`) |

**R1.6** — O número principal é o **disponível**, não o bruto. Consequência
obrigatória: `getStockStatus` ([ProductTable.tsx:94](../src/components/inventory/ProductTable.tsx#L94))
passa a comparar `quantity − reserved_stock` com `min_stock`. Sem isso o selo
`Normal` apareceria ao lado de um número negativo. A mudança vale nos três
consumidores do helper: card mobile, linha de tabela e ordenação por status.

**R1.7** — A linha do material mostra o **bruto** como terceira informação, em
corpo menor, ao lado do disponível — a conferência física conta prateleira, não
disponível.

### 1.3 Sub-linhas de cor

**R1.8** — Colunas: cor (com amostra de cor à esquerda) · SKU · saldo bruto ·
reservado · disponível. Disponível negativo em vermelho e peso 600.

**R1.9** — Quando o material tem mais de duas cores com saldo positivo, uma linha
de resumo fecha o bloco: `N de M cores com saldo concentram 80% dos X m
disponíveis`.

### 1.4 Filtro de zeradas

**R1.10** — Chip `Cores zeradas (N)` na barra de ferramentas do
`MaterialsTab`, **ativo por padrão no sentido de esconder**. Cor com
`quantity <= 0` sai da lista; o chip alterna para `Zeradas ocultas` quando
aplicado. A contagem no chip é sempre a contagem real, para que nada suma em
silêncio.

**R1.11** — Chip `Só com falta (N)` filtra para cores com disponível negativo.
Os dois chips combinam.

**R1.12** — Material cujas cores todas foram filtradas não aparece na lista.

### 1.5 Busca

**R1.13** — Busca que casa o **nome do material** mantém o material fechado e
lista todas as cores dele quando aberto.

**R1.14** — Busca que casa **cor ou SKU** abre o material automaticamente e
mostra **só as cores que casam**. Buscar `cogumelo` devolve os materiais que têm
essa cor, cada um já aberto com uma linha.

**R1.15** — A busca continua usando `searchMatchesAllTerms` (contrato do `/`
como refinamento AND) e continua normalizando acento.

### 1.6 Ações — cada uma no seu nível

**R1.16** — Na **linha do material**, sempre visíveis (não só no hover):
- `+ Cor` — abre o `MasterVariantDialog` na aba Adicionar
- `Editar N cores` — abre o `MasterVariantDialog` na aba de edição em massa
- menu `⋯` — abrir o grupo de estoque, marcar as N como artesanais

**R1.17** — Na **sub-linha da cor**, reveladas no hover/foco como hoje:
baixa manual · estoque por numeração (só solado) · artesanal · editar · excluir.

**R1.18** — Baixa manual e excluir **só existem na sub-linha de cor**. Nunca na
linha do material, para que nunca haja dúvida sobre qual SKU é o alvo.

---

## Parte 2 — Edição em massa das cores (`MasterVariantDialog.tsx`)

### 2.1 Parar de renomear

**R2.1** — Remover a montagem de `name` do payload de `doSaveGroupForm`
([MasterVariantDialog.tsx:533](../src/components/inventory/MasterVariantDialog.tsx#L533)).
Salvar deixa de escrever `products.name`.

**R2.2** — Remover o campo `Nome do modelo` do formulário de edição em massa. O
nome do material passa a ser editado só no editor de item individual, um produto
por vez.

**R2.3** — O título do diálogo passa a exibir `product_groups.name`, não o
`baseName` derivado por corte de palavra.

**R2.4** — A aba muda de rótulo: `Dados do Grupo` → **`Aplicar a todas as cores`**.
Ela nunca editou `product_groups`; o rótulo antigo é a origem da confusão com o
`GroupEditDialog`.

### 2.2 Divergência visível

**R2.5** — Ao abrir a aba, calcular por campo quantos valores distintos existem
entre as variantes. Campo com mais de um valor recebe um selo ao lado do rótulo:
`N valores diferentes`, com tooltip listando os valores e quantas cores têm cada um.

**R2.6** — Campo divergente nasce **vazio**, não preenchido com o valor da
primeira variante. Campo vazio é ignorado no salvamento — só é gravado o campo que
o usuário efetivamente preencher. Isso elimina o achatamento silencioso: hoje
salvar `COMPONENTES DIVERSOS` transforma 6 preços distintos em 1, e `NAPA SOFT`
troca o custo do `PRETO` (R$ 13,34) pelo dos outros (R$ 24,90).

**R2.7** — Campo homogêneo nasce preenchido com o valor comum, como hoje.

### 2.3 Prévia antes de aplicar

**R2.8** — O botão de salvar abre uma confirmação antes de gravar, listando:
- quais campos mudaram, com valor antigo → novo
- quantas cores serão afetadas por campo
- destaque para cores que perdem valor próprio, nomeando a cor e o valor perdido

**R2.9** — A confirmação só aparece quando há pelo menos um campo preenchido e
diferente. Nenhum campo alterado → toast informando que não há alterações, sem
gravar.

**R2.10** — Manter as validações existentes de `handleSaveGroupForm`
(`conversion_rate > 0`, categoria obrigatória, lead time não negativo, cores
duplicadas) e mantê-las **antes** da prévia.

### 2.4 Campos que saem

**R2.11** — Sair da aba de edição em massa e virar link `Editar no grupo de
estoque →` (abre o `GroupEditDialog`): dimensões (comprimento, largura, altura,
espessura, unidade), `calculation_method` e `purchase_multiple`. Esses moram em
`product_groups`; ver R3.2.

**R2.12** — Ficam na edição em massa, porque só existem em `products`: custo
unitário, atacado, varejo, unidade de consumo, unidade de compra, unidade de
produção, taxa de conversão, unidade de OC, rendimento, unidade de rendimento,
estoque mínimo/máximo/segurança, localização, fornecedor, nome técnico,
categoria, lead time, quantidade mínima de compra, ativo.

### 2.5 Invariantes de unidade à vista

**R2.13** — Quando `purchase_unit === unit`, a taxa de conversão trava em 1 e
fica em leitura, com a explicação ao lado. Quando diferem, o campo abre e exige
valor maior que zero.

**R2.14** — Todo campo de medida exibe a unidade ao lado do input, não só no
rótulo.

---

## Parte 3 — Grupo de estoque (`GroupEditDialog.tsx`)

**R3.1** — Remover o card `Configurações de Itens (Em Massa)`
([GroupEditDialog.tsx:1105](../src/components/groups/GroupEditDialog.tsx#L1105))
— preço unitário, localização física e múltiplo de compra. Esses três gravam em
`products` e passam a ter porta única no `MasterVariantDialog`.

**R3.2** — No lugar dele, um link `Editar as N cores →` que abre o
`MasterVariantDialog` na aba de edição em massa.

**R3.3** — As dimensões passam a ser cadastradas **só aqui**. `product_groups` é
a fonte; `products.dimensions_*` deixa de ser editável.

**R3.4** — Quando algum item do grupo tiver `dimensions_width` diferente do
grupo, exibir aviso não bloqueante nomeando o conflito. Divergência viva hoje:

| Grupo | Grupo | Itens |
|---|---|---|
| `NAPA SOFT` | 1370 | 1000 (nos 44) |
| `NAPA SANTORINE` | 1370 | 1000 |
| `GLOW METALIC` | 1370 | 1000 |
| `NAPA SUDANI` | 1370 | 0 e 1000 |
| `DUBLAGEM` | 0 | 0, 1 e 1000 |

**R3.5** — **Não** copiar o valor do grupo para os itens. Os motores de consumo
usam `GREATEST(comprimento, largura)`, então o 1000 não está cortando consumo;
alinhar 189 linhas é decisão de Fase 2, não efeito colateral desta reforma.

---

## Parte 4 — Editor de item (`ProductFormDialog.tsx`)

**R4.1** — Reorganizar os cerca de 40 campos em **um scroll só**, com o essencial
aberto e o resto em seções recolhidas. Não usar abas.

**R4.2** — Aberto por padrão:

| Seção | Campos |
|---|---|
| Identidade | nome, cor, SKU, grupo, fornecedor |
| Estoque | quantidade atual, mínimo, localização |
| Custo | custo por unidade de estoque, atacado, varejo |

**R4.3** — Recolhido, cada um com **resumo do estado atual no cabeçalho** para
que o valor seja legível sem abrir:

| Seção | Resumo no cabeçalho |
|---|---|
| Unidades e conversão | `m · compra m · 1×` |
| Dimensões | `largura 1370 mm (do grupo)` |
| Compra e reposição | `lead 10 d · múltiplo 50` |
| Solado | só aparece com categoria Solado |
| Avançado | `químico · ativo` |

**R4.4** — Seção recolhida abre automaticamente quando contém campo com erro de
validação, e o foco vai para o primeiro campo inválido.

**R4.5** — As dimensões aparecem em **leitura**, herdadas do grupo, com link para
o `GroupEditDialog` (ver R3.3). Se o item tiver valor próprio divergente, mostrar
os dois e marcar a divergência.

**R4.6** — Mesma regra de unidade da R2.13 e R2.14: conversão travada em 1 quando
as unidades coincidem, unidade sempre ao lado do input.

**R4.7** — O custo declara explicitamente que é **por unidade de estoque**, não
por unidade de compra.

**R4.8** — A propagação para as cores irmãs (`useVariantPropagation`) continua
funcionando como hoje, e a confirmação passa a usar o mesmo componente de prévia
da R2.8.

---

## Fora de escopo desta fase

Registrar como Fase 2, **não implementar aqui**:

1. `NAPA SOFT` tem `CAPPUCCINO` (66 m) e `CAPUCCINO` (1 m, com 19,15 m
   reservados) como cores separadas no mesmo grupo. Um PV escrito `CAPUCCINO`
   casa exato no registro de 1 m, não no de 66 m. É defeito de dado, presente
   hoje, independente da tela.
2. As 51 cores com disponível negativo — reserva viva sobre saldo zerado.
3. As 95 cores zeradas: decidir quais desativar.
4. `NAPA ONÇA` mora dentro do grupo `NAPA SOFT` com cor vazia, dependendo do
   `partial_name`.
5. Alinhar `products.dimensions_*` ao grupo.

Também fora: virtualização da lista (189 linhas não justificam), mudança em
`product_groups.sector`, e qualquer alteração nos motores de consumo.

---

## Verificação

- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo
- [ ] `bun run lint`
- [ ] `bun run check:tokens` — sem cor hardcoded nova
- [ ] `bun run test`
- [ ] Nenhum `products.name` gravado por `MasterVariantDialog` (grep no payload)
- [ ] `NAPA SANTORINE` abre 10 cores; nenhuma renomeada após salvar em massa
- [ ] `NAPA SOFT` com o chip de zeradas ativo mostra 17 cores, não 44
- [ ] Buscar `cogumelo` abre os materiais que têm a cor, com 1 linha cada
- [ ] Selo de divergência aparece em `COMPONENTES DIVERSOS` (6 custos) e o campo
      de custo nasce vazio
- [ ] Baixa manual não existe na linha do material
- [ ] 360 px: linha do material e sub-linhas legíveis, sem scroll horizontal
- [ ] Tema escuro: trilho de severidade e número negativo com contraste
