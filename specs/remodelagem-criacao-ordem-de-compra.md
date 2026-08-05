# Remodelagem da criação de ordem de compra

**Data:** 05/08/2026 · **Contexto:** [`src/components/purchase/CONTEXT.md`](../src/components/purchase/CONTEXT.md)
**ADRs:** [0002](../docs/adr/0002-necessidade-calculada-ao-vivo-com-decisoes-persistidas.md) · [0003](../docs/adr/0003-ordem-de-compra-sem-fornecedor-nasce-como-rascunho.md)

## 1. Objetivo

Substituir os nove caminhos de criação de ordem de compra por um fluxo único:
**necessidade → carrinho → fechamento → ordens**. Toda origem (PV, MRP, solado,
reposição, inclusão manual) alimenta o mesmo carrinho compartilhado, e todas as
ordens nascem sob as mesmas regras.

### O que motivou (dados de produção, 05/08/2026)

| Sintoma | Medida |
|---|---|
| Ordens canceladas | 28 de 54 (52%) |
| Ordens sem fornecedor resolvido | 26 de 54 — dessas, 19 mortas |
| "Sem Fornecedor" | 14 ordens, 13 canceladas (93%) |
| Ordens invisíveis no filtro (`suggested`) | 12, ~R$ 26 mil, uma com 58 itens |
| Necessidades acionáveis sem meio de recusar | 83 |
| Mesmo material em ordens simultâneas | Tira chata 8mm: 3 ordens, 214,8 m pedidos, MRP ainda pedindo 876,48 m |
| Ordem nunca revisada | OC-00030: **161.323 kg de cola**, R$ 2.933.318,32, `pending` desde 15/05 |

Causa comum: o sistema materializa a compra cedo demais — cria a ordem antes de
haver fornecedor, revisão ou responsável — e não tem onde guardar a decisão de
não comprar.

## 2. Decisões fechadas

| # | Decisão | Escolha |
|---|---|---|
| D1 | Onde vive a necessidade | Calculada ao vivo; banco grava só decisões (ADR 0002) |
| D2 | Forma do compositor | Drawer persistente + página de fechamento |
| D3 | Agrupamento na fila e no carrinho | Por grupo de material, **quantidade discriminada por cor** |
| D4 | Ordem sem fornecedor | Permitida, nasce `draft` e não é compra (ADR 0003) |
| D5 | Alçadas | Ativadas: livre até R$ 2.000 · gerente até R$ 20.000 · admin acima |
| D6 | Carrinho | **Único e compartilhado**, com autoria por linha |
| D7 | Solado | Entra no carrinho **com a grade preenchida desde a origem** |
| D8 | Legado | Wizard de 5 passos e `CreatePurchaseOrderDialog` aposentados |
| D9 | As 12 ordens `suggested` | Não tocar nesta rodada — limpeza separada |

## 3. Modelo de dados

Carimbo de migration: consultar `select max(version) from
supabase_migrations.schema_migrations` na hora de criar (em 05/08/2026 o topo era
`20261115120300`; outra sessão pode ter avançado).

### 3.1 `v_purchase_needs` — necessidade líquida unificada

View que une os motores existentes e desconta o que já está pedido.

Origens (`origin_type`): `mrp` (`v_mrp_needs`), `pv` (materiais dos PVs ativos,
mesma resolução de `buildPerPvPurchaseOrders`), `solado` (`checkSoleAvailability`),
`rop` (ponto de reposição).

Colunas mínimas:

| Coluna | Papel |
|---|---|
| `origin_type`, `origin_id`, `origin_label` | de onde veio (ex.: `pv`, id do PV, `PV-00146`) |
| `product_id`, `product_name`, `color` | material cadastrado (grupo + cor) |
| `group_id`, `group_name` | grupo de material — chave de exibição (D3) |
| `unit`, `purchase_unit` | unidade de estoque e de compra |
| `qty_gross` | falta bruta, na unidade de estoque |
| `qty_on_order` | já pedido em ordem aberta (`pending`, `approved`, `sent`, `parcial`) — **exclui `draft` e `cancelled`** |
| `qty_net` | `max(0, qty_gross − qty_on_order)` — é o que se mostra |
| `supplier_id`, `supplier_source` | fornecedor resolvido e por qual regra (ver §4.2) |
| `grade` | distribuição por numeração, só quando `origin_type = 'solado'` |

`qty_on_order` é a correção do defeito da Tira chata 8mm: hoje nenhum motor
desconta pedido em aberto.

### 3.2 `purchase_need_decisions` — o que uma pessoa determinou

```
id, need_key, decision, reason, snooze_until, created_by, created_at
```

- `need_key` — âncora estável da necessidade: `origin_type || ':' || coalesce(origin_id,'') || ':' || product_id`.
- `decision` — `descartada` | `adiada` | `resolvida_por_fora`.
- `snooze_until` — obrigatório quando `adiada`; a necessidade reaparece nessa data.
- `reason` — obrigatório em `descartada` e `resolvida_por_fora`.

Uma decisão vale enquanto a necessidade não muda materialmente: se `qty_gross`
subir mais de 20% acima do valor no momento da decisão, a necessidade **reaparece**
marcada como "voltou a crescer". Guardar `qty_at_decision` para isso.

### 3.3 `purchase_cart_items` — o carrinho compartilhado

```
id, product_id, qty_purchase_unit, unit_price, grade jsonb,
supplier_id, supplier_source, need_key, note,
added_by, added_at, updated_by, updated_at
```

Um só carrinho para a fábrica inteira (D6) — sem coluna de dono. `added_by`
registra a autoria da linha. `need_key` nulo = inclusão direta, sem necessidade
por trás. `grade` preenchida só para solado (D7).

RLS: leitura e escrita para usuário aprovado; `added_by` gravado por default
`auth.uid()`.

### 3.4 `purchase_orders.status = 'draft'`

Novo estado (ADR 0003). Guardas obrigatórias:

- `createAPEntries` / `buildInstallments` ignoram `draft` — não gera contas a pagar.
- `SaldoFinalTab` e toda projeção de saldo excluem `draft`.
- Aprovação, envio e impressão bloqueados em `draft`.
- `v_purchase_needs.qty_on_order` **não** conta `draft` (a intenção não reserva).
- Transição única de saída: ganhar `supplier_id` → vira `pending`.

⚠ Todo consumidor de `purchase_orders` que soma valor precisa filtrar
`status <> 'draft'`. É a dívida assumida no ADR 0003.

### 3.5 Faixas de alçada (D5)

Seed em `purchase_approval_tiers` (hoje vazia, trigger `tg_enforce_po_alcada` já
vivo):

| Faixa | min | max | required_role |
|---|---|---|---|
| Compra corrente | 0 | 2.000 | — (livre) |
| Compra relevante | 2.000 | 20.000 | `gerente` |
| Compra crítica | 20.000 | null | `admin` |

`APPROVER_ROLES` já é `['gerente','admin','comercial']`.

## 4. Regras de negócio

### 4.1 Agrupamento por grupo, quebra por cor (D3)

A fila e o carrinho mostram **uma linha por grupo de material**, com o total do
grupo, e dentro dela a quantidade **por cor**. `TIRA OVERLOCK 5MM` é uma linha
com 18 cores dentro — não 18 linhas.

O débito de estoque, o preço e a linha da ordem continuam sendo por
`product_id` (grupo + cor). O agrupamento é de apresentação e de negociação; a
gravação é por material cadastrado.

### 4.2 Resolução de fornecedor

Ordem de tentativa, parando na primeira que acerta:

1. `products.supplier_id` do próprio material
2. `resolveGroupSupplier(group_id)` — `group_suppliers`, por CNPJ com fallback por nome
3. último fornecedor de quem se comprou aquele material (última ordem recebida)
4. escolha humana no fechamento

`supplier_source` registra qual regra valeu. Quando é a 4, ofereça **gravar como
fornecedor padrão do grupo** — é o que impede o caso se repetir.

Hoje nenhum dos cinco geradores chama `resolveGroupSupplier`; só `useSaleOrders` e
`materialAutoPO`. Unificar aqui.

### 4.3 Quantidade a comprar

Uma única função, usada por todos os caminhos:
`qty_net` → lote mínimo (`min_order_quantity`) → múltiplo de compra
(`effectivePurchaseMultiple`) → conversão estoque→compra
(`effectiveConversionFactorStrict`).

Hoje só o wizard aplica lote mínimo e múltiplo — é uma das divergências de regra
que motivam a remodelagem. Reusar `computeBuyQty` e `purchaseMultiple.ts`, não
reimplementar.

O carrinho **mostra o arredondamento**: "déficit 28 m → múltiplo 5 m → **30 m**".

### 4.4 Fechamento

1. Agrupa os itens do carrinho por fornecedor resolvido.
2. Cada grupo vira uma ordem de compra.
3. Itens sem fornecedor resolvido viram **uma ordem `draft`** (D4/ADR 0003).
4. Antes de gerar, mostra por ordem: total, faixa de alçada aplicável, quem terá
   de aprovar, prazo de pagamento do fornecedor.
5. Gerado com sucesso → as linhas saem do carrinho e as necessidades de origem
   passam a computar `qty_on_order`.

O fechamento é **idempotente** por assinatura do carrinho — dois cliques não
geram ordens duplicadas.

### 4.5 Sanidade de quantidade

Um item cuja quantidade exceda **50×** a média de compra histórica daquele
material (ou, sem histórico, 50× o consumo mensal) exibe alerta bloqueante no
fechamento, exigindo confirmação explícita.

É a rede que teria pego OC-00030 (161 toneladas de cola).

## 5. Telas

### 5.1 Drawer do carrinho — `CartDrawer`

Baseado em `@/components/ui/sheet`. Botão-âncora com contador visível no header
do app, em todas as telas de Compras, no PV e no estoque.

```
┌─────────────────────────────────────┐
│ CARRINHO DE COMPRAS            (7)  │
│ 3 fornecedores · R$ 1.204,00        │
├─────────────────────────────────────┤
│ SANSIN                    R$ 372,00 │
│  ▸ TIRA OVERLOCK 5MM        180 m   │
│      PRETO 90 · OFF WHITE 60 · ...  │
│      déficit 152 → múltiplo 5 → 180 │
│      Leonardo · há 2h               │
│  ▸ NAPA SANTORINE            30 m   │
├─────────────────────────────────────┤
│ SEM FORNECEDOR ⚠          R$ 190,00 │
│  ▸ ELÁSTICO 6MM             96 m    │
│      resolver fornecedor →          │
├─────────────────────────────────────┤
│ ⚠ 1 grupo sem fornecedor            │
│              [Revisar e fechar →]   │
└─────────────────────────────────────┘
```

- Linha expansível: fechada mostra grupo + total; aberta mostra a quebra por cor.
- Cada linha traz autoria (`added_by`, tempo relativo) — D6.
- Solado mostra a grade (`2×33/34 · 4×35 · 6×36`), editável ali mesmo (D7).
- Alteração de quantidade salva com debounce e otimismo; erro reverte com toast.

### 5.2 Página de fechamento — `/compras/fechamento`

```
┌────────────────────────────────────────────────────┐
│ COMPRAS · FECHAMENTO                               │
│ 3 ordens serão criadas · R$ 1.204,00               │
├────────────────────────────────────────────────────┤
│ ▸ SANSIN              R$ 372,00 · 28 dias          │
│   2 itens · livre (abaixo de R$ 2.000)             │
│ ▸ LC COMPONENTES      R$ 642,00 · à vista          │
│   3 itens · livre                                  │
│ ▸ SEM FORNECEDOR ⚠    R$ 190,00                    │
│   1 item · nasce como RASCUNHO — não é compra      │
│   [resolver fornecedor]  [salvar padrão do grupo]  │
├────────────────────────────────────────────────────┤
│                      [Voltar]  [Gerar as 3 ordens] │
└────────────────────────────────────────────────────┘
```

- Ordem acima da alçada mostra em destaque quem terá de aprovar, **antes** de gerar.
- Alerta de sanidade (§4.5) bloqueia o botão até confirmação explícita.

### 5.3 Fila de necessidades — nova aba em `/purchase-planning`

Substitui a sub-view "Por Fornecedor" (que hoje é o wizard). Uma linha por grupo,
com quebra por cor, e três ações por linha: **adicionar ao carrinho**, **adiar**
(com data), **descartar** (com motivo).

Filtros: origem, grupo, fornecedor resolvido/não resolvido, "só o que voltou a
crescer". `EmptyState` honesto quando tudo foi decidido.

### 5.4 Janelas que ficam e são remodeladas

| Janela | O que muda |
|---|---|
| `OrderDetailDialog` | Adotar `draft` no `STATUS_MAP`; preservar a trava de edição por contas a pagar já lançadas (trabalho não commitado em [PurchaseOrders.tsx](../src/pages/PurchaseOrders.tsx)) |
| "Receber parcial" | Anatomia padronizada; conversão compra→estoque explícita por linha |
| `SoleGradeEditorDialog` | Passa a ser reusado também pelo carrinho (D7), não só pós-criação |
| 6 `AlertDialog` de aprovar/enviar/cancelar/excluir | Padronizar texto e hierarquia; ação destrutiva sempre em `destructive` e separada |

### 5.5 Janelas aposentadas (D8)

- `PurchasePlanningWizard` (5 passos, 1.211 linhas) → substituído pela fila §5.3.
  ⚠ Preservar a correção de total não commitada (total do cabeçalho vindo das
  linhas, com `computeBuyQty` aplicado) — a regra migra pra §4.3.
- `CreatePurchaseOrderDialog` → "adicionar item avulso ao carrinho".
- `GeneratePurchaseOrdersDialog` (por PV) → botão "mandar pro carrinho" no PV.
- Aba Solados de `/purchase-orders` → necessidades de solado entram na fila §5.3.

**Não** é aposentado: `LancamentoAvulsoDialog` (nota que já chegou — registro
retroativo, não compra).

## 6. Design

Direção confirmada pelo gerador do skill (*Data-Dense Dashboard*, Fira Sans +
Fira Code) — que é o que o `index.css` já usa. **Manter os tokens do projeto**;
não importar paleta externa.

- Tokens obrigatórios, zero cor hardcoded — `bun run check:tokens` limpo.
  Semânticas (`amber` para rascunho/atenção, `red` para bloqueio) permanecem.
- Ícones **Phosphor** (`@phosphor-icons/react`), nunca lucide, nunca emoji.
- Alturas: `h-7` em linha de tabela densa, `h-9` em toolbar, `h-10` no CTA de
  fechamento.
- Z-index: `.z-modal` para o drawer, `.z-popover` para selects dentro dele.
- Transições 150–300ms, só `transform`/`opacity`; respeitar `prefers-reduced-motion`.
- Rascunho nunca sinalizado só por cor — badge com ícone + texto "Rascunho".
- `EmptyState` de `@/components/ui/empty-state` em fila e carrinho vazios.
- Alvo de clique ≥ 44px nas ações de linha (expandir, adiar, descartar).
- Contraste ≥ 4,5:1 em claro e escuro, verificados separadamente.

## 7. Ordem de execução

| Fase | Entrega | Verificável por |
|---|---|---|
| 1 | `v_purchase_needs` + `purchase_need_decisions` + `purchase_cart_items` + status `draft` + seed de alçadas | SQL: necessidade líquida da Tira chata 8mm cai de 876,48 para o valor menos os 214,8 pedidos |
| 2 | `CartDrawer` + adicionar ao carrinho a partir da fila | Adicionar, editar quantidade e ver autoria |
| 3 | Página de fechamento + geração idempotente + alçada visível + sanidade §4.5 | Gerar 3 ordens de um carrinho misto, uma delas `draft` |
| 4 | Fila de necessidades §5.3 com adiar/descartar | Descartar uma linha e ela não voltar |
| 5 | Aposentar wizard, dialog manual, gerador por PV e aba Solados | Rotas e imports removidos, sem referência órfã |
| 6 | Remodelagem visual das janelas que ficam §5.4 | `check:tokens` limpo, claro e escuro conferidos |

Após cada fase: `bunx tsc -p tsconfig.app.json --noEmit` (**nunca** `bunx tsc
--noEmit` na raiz — não checa nada) e `bun run test`.

## 8. Critérios de aceite

1. Nenhuma ordem pode ser criada por caminho que não seja o fechamento do
   carrinho — exceto o lançamento avulso.
2. Lote mínimo, múltiplo de compra e conversão estoque→compra produzem o mesmo
   resultado independentemente da origem da necessidade.
3. A necessidade líquida desconta ordem aberta e **não** desconta `draft`.
4. Uma necessidade descartada não reaparece, salvo se crescer mais de 20%.
5. Ordem `draft` não gera contas a pagar, não entra no saldo projetado e não pode
   ser aprovada, enviada nem impressa.
6. O fechamento mostra a faixa de alçada e o aprovador exigido antes de gerar.
7. Item 50× acima do histórico bloqueia o fechamento até confirmação explícita.
8. `TIRA OVERLOCK 5MM` aparece como **uma** linha com 18 cores dentro, na fila e
   no carrinho.
9. Solado chega ao carrinho com grade preenchida e editável.
10. Dois cliques em "Gerar ordens" não produzem ordens duplicadas.
11. `bun run check:tokens` limpo; `bunx tsc -p tsconfig.app.json --noEmit` limpo.

## 9. Fora de escopo

- As 12 ordens em `suggested` (D9) — limpeza separada. Enquanto isso elas seguem
  fora do filtro da tela, exibidas como "Pendente".
- OC-00030 (161 toneladas de cola) — a regra §4.5 impede casos novos; corrigir a
  ordem existente é decisão à parte.
- Cotações (RFQ): `purchase_quotations` tem 1 linha e nada liga cotação a ordem.
  Ligar RFQ ao fluxo é trabalho próprio.
- Consolidar os cadastros por cor: o modelo está **certo** (um produto por cor,
  todos sob o mesmo grupo) — o que estava errado era a tela, e §4.1 resolve.
- `TIRA OVERLOCK 5MM CAPUCCINO` com `unit = 'm'` e `purchase_unit = 'un'`
  (conversão inválida) e materiais com `reserved_stock` acima do estoque:
  saneamento de cadastro, fora desta remodelagem.
