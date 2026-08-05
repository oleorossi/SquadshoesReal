# Auditoria visual — 05/08/2026

**Método:** navegação em **produção** (`squadshoes-real.vercel.app`), logado como
Administrador, **somente leitura** — nenhum clique que grave. Cada número lido na
tela foi conferido contra `ssvxfoybzmjlypnipqzn` com SQL, e cada divergência
rastreada até a linha de código que a produz.

**Placar:** 9 achados, 1 card aprovado.

> **Como ler a severidade.** 🔴 = número errado na tela que alguém usa pra decidir.
> 🟡 = dado/cadastro inconsistente que ainda não mente na tela, mas vai.
> 🟢 = conferido e correto.

---

## O padrão por trás de quase todos

**Erro engolido em silêncio.** V1, V2, V5 e V7 não geram exceção, log, toast nem
alerta. Todos aparecem como número normal, formatado, na cor certa. É o mesmo
mecanismo dos bugs históricos que o `CLAUDE.md` já documenta (napa 4104 m em vez
de 30 m; forro fantasma do PV-00146): o sistema não erra alto, ele erra baixo.

Consequência prática pra qualquer correção daqui: **não basta consertar o valor —
precisa existir quem grite quando ele divergir de novo.**

---

## 🔴 V1 — "Estoque Crítico" usa número mágico, não o mínimo cadastrado

**Onde:** Painel, card `ESTOQUE CRÍTICO`, rótulo *"Itens abaixo do mín."*
**Tela:** 142 · **Banco:** 89

`src/pages/Dashboard.tsx:42`

```ts
supabase.from('products').select('id', { count: 'exact', head: true }).lt('quantity', 10)
```

`quantity < 10` — literal. O `min_stock` cadastrado produto a produto **não é
usado por este card**.

| Conferência | Resultado |
|---|---|
| `quantity < 10` (o que a tela faz) | **142** ← bate exato com a tela |
| `quantity < min_stock` (o que o rótulo promete) | **89** |
| Falsos alarmes (qty<10 mas **acima** do mínimo) | **62** |
| **Invisíveis** (abaixo do mínimo, mas qty ≥ 10) | **9** |

O pior não é o 142 — são os **9 produtos genuinamente em falta que o card não
conta**. E o `10` é cego a unidade: 10 m de napa, 10 pares de solado e 10 placas
de EVA não significam a mesma coisa.

**Decisão pendente do dono:** trocar o predicado muda o card de 142 → 89. Quem se
acostumou com 142 vai achar que sumiu alerta.

---

## 🔴 V2 — "A Pagar R$ 0,00" e o Saldo Líquido inflado ~4,7×

**Onde:** Painel, bloco `02 FINANCEIRO`
`src/pages/Dashboard.tsx:77` lê `accounts_payable`.

| Onde o painel olha | Onde o dinheiro está |
|---|---|
| `accounts_payable` → **0 linhas, R$ 0,00** | `financial_entries` tipo despesa → **94 lançamentos, R$ 369.975,98** |
| | dos quais **55 pendentes = R$ 275.387,54** |
| | \+ 14 OCs `pending` = **R$ 3.138.396,71** que nunca viraram conta a pagar |

O card **SALDO LÍQUIDO** calcula `A Receber − A Pagar`, então exibe
**R$ 349.474,40** onde, considerando só as despesas pendentes já lançadas, seria
**~R$ 74.087**.

**A pergunta de fundo não é do card.** Se as OCs *deveriam* gerar
`accounts_payable` automaticamente, isso não é bug de painel — é um pedaço do
fluxo financeiro que nunca foi ligado, e o card está sendo honesto sobre uma
tabela vazia. Relacionado: a migration `20260517150001_purchase-order-total-trigger`
(função + trigger de total da OC) **nunca aplicou**.

---

## 🔴 V7 — a coluna de reserva e o razão de reservas não batem

Existem **duas fontes** de reserva e elas divergem:

| Fonte | Total |
|---|---|
| `products.reserved_stock` (desnormalizada — **é o que a tela usa**) | **61.636,38** |
| `material_reservations` (o razão, linhas abertas) | **77.255,58** |

**14 produtos divergem.** Piores:

| Produto | Coluna | Razão | Diferença |
|---|---|---|---|
| `PLACA 1.0 EVA 3.0` | 1.974,36 | 6.671,92 | **−4.697,56** |
| `Tira Overlock 5mm` | 0 | 2.495,00 | −2.495,00 |
| `Tira Overlock 5mm` | 1.349,28 | 3.512,48 | −2.163,20 |
| `TIRA OVERLOCK 5MM` | 0 | 2.004,00 | −2.004,00 |

Enquanto isso não fechar, **todo número de "disponível" na tela é indefensável** —
inclusive o V6 abaixo. Este é o achado que mais compromete os outros.

---

## 🔴 V6 — 53 produtos com reserva maior que o estoque

A tela mostra `ELÁSTICO 7MM: −6.210 cm`. Conferido: `30 bruto − 6.240 reservado =
−6.210`. **A tela está matematicamente certa** — o problema é o dado.

| | |
|---|---|
| Produtos ativos com reserva > estoque | **53** |
| Destes, com estoque **zero** e reserva > 0 | **38** |
| Unidades reservadas sem lastro | **51.969,36** |
| Pior caso | **Ilhós 51** — 0 em estoque, **8.800 reservados** |

**Checagem que muda a leitura:** *zero* dessas reservas pertence a OP concluída ou
cancelada. São 1.473 linhas em **246 OPs abertas**. Não é lixo de OP fechada — é a
fábrica com 246 ordens vivas comprometendo material que nunca entrou. Nessa parte
**o sistema está reportando corretamente uma escassez real**; o defeito é o V7.

---

## 🔴 V5 — administrador vê "Nenhuma área liberada" durante o carregamento

Ao navegar para `/estoque`: sidebar sumiu inteira, cargo virou **`0.0.0`**, e
apareceu *"Sua conta ainda não tem permissão para nenhuma área do sistema. Peça a
um administrador para liberar os acessos."* Recuperou sozinha em segundos.

É o estado **fail-closed sendo renderizado como se fosse resposta final** enquanto
o perfil ainda carrega — falta distinguir "ainda não sei" de "não tem acesso".
Registrado nas auditorias de mai/2026 como *"Acesso Restrito intermitente"*;
**continua vivo**.

---

## 🟡 V4 — status misturando português e inglês na mesma coluna

`financial_entries.status`: **`pendente`** (55), **`cancelado`** (24),
**`confirmed`** (15).

A mistura é sistêmica, não pontual — e é a mesma classe que produziu os 4 bugs
corrigidos nesta sessão (commit `7c0fd34`). A varredura conferiu ~90 literais
pt-BR contra o domínio real: **8 tabelas têm pt-BR legítimo** (`orders`,
`sale_orders`, `service_orders`, `order_stages`, `payroll_runs`,
`financial_entries`, `nfe_*`, `sac_tickets`) e só 4 literais eram fantasmas.
Não é para "traduzir tudo" — é para o literal do código bater com o domínio real.

---

## 🟡 V8 — unidades fora da lista canônica

4 produtos usam **`cm`** como unidade de **estoque**: `Elástico 6MM`,
`Borracha pra dedinho`. O `CLAUDE.md` é explícito — linear canônico é `m`, com
`cm`/`mm` reservados a *dimensões*. E o valor denuncia o cadastro: "10 cm de
elástico" em estoque não é quantidade plausível de fábrica.

---

## 🟡 V9 — cadastro de grupos inconsistente

- Grupo **`ELÁSTICO 7MM`** contém três produtos **`Elástico 6MM`** — nome não bate
  com o conteúdo, e os três são duplicatas idênticas (10 cm cada)
- Grupo **`DUBLAGEM`** tem três produtos chamados **`DUBLAGEM`** (35 m, 10 m, 7 m)
- Grupo **`LINHANYL`** mistura `kg` e `un` — a tela **detecta e avisa** *"unidades
  diferentes"* (✅ bom comportamento), mas o total do grupo fica sem significado

---

## 🟢 V3 — "A Receber R$ 349.474,40" está correto

Bate centavo a centavo com `sum(amount)` de `accounts_receivable` status
`pending` (32 títulos). Único card do painel financeiro que passa.

---

## Corrigido nesta sessão

Ver commits `7c0fd34`, `adda84d`, `8b01028`, `4ca2830`, `b3ef997`, `20261122120000`.
Nenhum dos 9 achados acima foi corrigido — **são diagnóstico**, e V1/V2 dependem
de decisão do dono sobre qual lado é a fonte de verdade.

## Não coberto

Telas de Compras, Produção, Vendas, Fichas Técnicas e o layout de impressão não
foram varridos — a auditoria parou no Painel e no Estoque. Dark mode e viewport
mobile também não foram exercitados.
