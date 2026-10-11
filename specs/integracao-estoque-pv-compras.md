# Integração Estoque ↔ PV ↔ Compras — empenho parcial, falta e quitação na entrada

> Spec fechada por grill em 11/10/2026 (dono). **Não construída.** Implementação só
> com `/build` autorizado.
>
> **Relação com specs anteriores** — esta spec **amplia** e, nos pontos listados em
> [Conflitos com specs anteriores](#conflitos-com-specs-anteriores), **substitui**:
>
> - [`pv-material-commitments.md`](pv-material-commitments.md) (soft pegging no PV)
> - [`compras-producao-entrelacadas.md`](compras-producao-entrelacadas.md) (D9, D15)

## Goal

Quando um PV é aprovado, o sistema **empenha** o que existe em estoque, registra o que
**falta** por PV (por material, cor e — no solado — por numeração), gera a **ordem de
compra** dessa falta, e quando a mercadoria **entra** a falta é **quitada primeiro**,
com rateio editável e histórico de rastreio. O estoque físico sempre bate com a
prateleira; a tela de estoque mostra também **Falta**, **Em compra** e **Projetado**.

### Exemplo canônico (napa)

NAPA PRETO, físico 20 m. PV-A precisa de 40 m.

| Momento | Físico | Empenhado | Falta | Em compra | Disponível | Projetado |
|---|---|---|---|---|---|---|
| PV-A aprovado | 20 | 20 | 20 | 40 | 0 | 20 |
| Chegam 40 m (rateio: 20 → PV-A, 20 livre) | 60 | 40 | 0 | 0 | 20 | 20 |
| Corte do PV-A inicia (baixa 40) | 20 | 0 | 0 | 0 | 20 | 20 |

`Disponível = físico − empenhado` · `Projetado = disponível − falta + em compra`.

### Exemplo canônico (solado, número a número e cor a cor)

SOLADO 01 PRETO. PV pede 34:10 · 35:10 · 36:10. Estoque 34:10 · 35:4 · 36:0.
→ Empenha 34:10 · 35:4 · 36:0; **falta** 34:0 · 35:6 · 36:10; compra por numeração.
Cada numeração é independente — falta em uma não segura as outras.
Numeração **conjugada** (balde `"33/34"`) é um balde só: demanda, falta, compra e entrada
usam a mesma chave `"33/34"`; **nunca** se divide entre 33 e 34 (o solado só é fabricado
assim, então não chega separado).

## Decisões fechadas (grill 11/10/2026)

| # | Tema | Decisão |
|---|---|---|
| Q1 | Quantidade comprada | **Necessidade total do PV** quando há falta (falta + reposição do que o PV empenhou). Ex.: precisa 40, tem 20 → compra 40 |
| Q16 | Sem falta | **Não** gera compra (estoque cobre o PV inteiro → nada a comprar) |
| Q14 | Múltiplo de compra | Arredonda **para cima** pelo múltiplo de compra do grupo; sobra vira estoque livre |
| Q2/Q11 | Estoque negativo | **Físico nunca < 0** (trava do banco mantida). Falta vive em pendência por PV. Tela mostra colunas **Falta**, **Em compra**, **Projetado** + filtro "só itens com falta"; solado mostra falta por numeração em vermelho |
| Q8 | Quando baixa | **Empenho** na aprovação; **baixa física** quando o setor inicia (padrão indústria) |
| Q12 | Aprovação com falta | **Aviso**, não bloqueio. O gate de corte que hoje aborta a promoção inteira vira aviso |
| Q18 | Setor inicia com falta | Aviso + **confirmação**; baixa o que existe, falta continua aberta |
| Q5/Q10/Q10b/Q10c | Ordem de compra | Automática, **uma por PV**; PVs de clientes do **mesmo grupo econômico** (`clients.economic_group_id`) são agrupados na mesma OC (mesmo fornecedor). Nasce **aguardando aprovação** (`approval_status='pendente_aprovacao'`). Cada linha guarda os PVs de origem |
| Q3/Q9 | Prioridade no rateio | Tela abre **pré-preenchida** pela prioridade existente (`commitment_cover_priority`: Ateliê → 1º dia da semana de faturamento → prazo → aprovação). Dono **pode editar** e confirma |
| Q4 | Quitação | Automática na confirmação do rateio; registra **histórico de rastreio** |
| Q17 | Entradas que quitam | **Todas**: recebimento de OC, importação NF/XML, ajuste manual positivo, correção de inventário |
| Q14 | Entrega parcial | Quita falta primeiro (pela prioridade/rateio), sobra → livre; saldo não entregue fica **em aberto** na OC |
| Q13 | Cancelamento do PV | Empenho volta a livre; falta do PV zera. OC **não aprovada**: a linha do PV sai. OC **já aprovada**: aviso ao dono, que decide |
| Q20 | Rastreio | **Aba nova "Rastreio" na janela do grupo de estoque** (`GroupEditDialog`), filtro por cor e por numeração |
| Q22 | PV completo | Quando a falta de um PV zera: aviso **"PV-xxxx material completo — liberado para corte"** no resumo do rateio e na fila de produção |
| Q19 | Migração | Recalcula **todos os PVs em aberto** (aprovados aguardando produção **e** em produção). Em produção, só o que **ainda falta baixar** (respeita `production_sector_material_debits`). Finalizados e cancelados **não** são tocados (mantém a decisão de 08/2026 sobre os furos históricos) |
| Q7 | Escopo | **Modelo único** para todos os materiais (napa, forro, palmilha, BOM **e solado**) |
| Q15 | Defeitos conhecidos | Corrigir junto (ver [Defeitos a corrigir](#defeitos-a-corrigir)) |

## As-is (levantamento 10/10/2026 — ler código, não confirmado no banco)

| Etapa | Hoje | Onde |
|---|---|---|
| Aprovação | `pv_commitment` soft pela **necessidade inteira**, sem olhar estoque; solado e tiras fora | `commit_sale_order_material_demand` (`20270101030600`/`030800`), wire em `030700` |
| OP | `hybrid_debit_stock_for_order(p_force_soft)` adota o commitment; solado vira `kind='sole_grade'` com `effective_grade`, sem checar numeração | `030700`, `debit_sole_stock_by_grade` (`20260915110000`) |
| Gate de corte | Falta de material de corte → item `skipped` → **rollback da promoção inteira** | `20270101031200`, `032400` |
| Baixa física | Ao iniciar setor; **tudo ou nada** (`Estoque insuficiente…`) | `debit_reserved_materials_for_sector` (`20261231122000`) |
| Finalização | `LEAST(disponível, reservado)` + resto `pending_reconciliation` | `settle_open_reservations_for_order` (`024300`) |
| Negativo | Bloqueado (`CHECK quantity >= 0`, trigger, `stock_movements`) | `20260418211904`, `20260426152815` |
| Compra | Outbox → `process_sale_order_purchase_shortages` → OC `suggested` per_pv, `pendente_aprovacao` | `20270101010900` + patches |
| Entrada | `trg_cover_commitments_on_stock_in` só recalcula `reserved_stock` + rebalance. **Nada quita falta**; `pending_reconciliation` só por botão manual | `030700`, `reconcile_stock_debit_hole` (`20261016120000`) |
| Rateio de entrada | Só existe para **tiras** (`purchase_receipt_allocations`) | ledger de tiras |

## Modelo alvo

### 1. Empenho parcial na aprovação

- Na TX de confirm, para cada (PV, produto[, balde de numeração]):
  `empenhado = LEAST(necessidade, disponível_livre)`; `falta = necessidade − empenhado`.
- Disponível livre respeita a prioridade: aprovação **não rouba** empenho de PV de prioridade
  maior. (Rebalance existente continua valendo para aumento de necessidade.)
- Solado entra no mesmo modelo, com a chave de balde (`stock_grade` key, incluindo conjugado).
- Tiras artesanais continuam no ledger próprio (anti-2×, ver I4 de `pv-material-commitments`).
- `reserved_stock` passa a somar **só o empenhado** (não a necessidade cheia) → deixa de
  exceder `quantity`.

### 2. Registro de falta

- Falta é **dado persistido** por (PV, produto, balde), não um número derivado na tela —
  é o que a entrada quita e o que o rastreio referencia.
- Reaproveitar `material_reservations` (estado/coluna de falta) **ou** tabela nova — decisão
  de implementação, desde que: (a) não infle `reserved_stock`; (b) seja a mesma fonte para
  colunas da tela, compra e quitação.

### 3. Compra

- Gerada no outbox existente (`process_sale_order_purchase_shortages`) a partir da **falta**
  registrada.
- Quantidade = **necessidade total do PV** para aquele produto/balde (Q1), arredondada
  pelo múltiplo de compra. Sem falta → sem compra.
- Agrupamento: uma OC por PV; PVs com o mesmo `clients.economic_group_id`, mesmo fornecedor,
  ainda não comprados → mesma OC. Linha guarda os PVs de origem.
- Nasce `pendente_aprovacao`. Sem fornecedor → `draft` + alerta (comportamento atual).

### 4. Entrada e rateio

- **Toda** entrada positiva (OC receive, NF/XML, ajuste, inventário) com falta aberta naquele
  produto/balde abre a **tela de rateio**:
  - pré-preenchida pela prioridade; editável por linha; a soma não pode exceder o que entrou;
  - "confirmar" transforma falta → empenho, sobra → livre;
  - pode-se zerar o rateio (ex.: correção de inventário que não é para PV nenhum).
- Solado: rateio por balde (numeração ou conjugado), por cor.
- Resumo pós-confirmação: quanto foi para cada PV, quanto ficou livre, e os PVs que ficaram
  **material completo — liberado para corte**.
- Entradas em lote (NF com muitos itens): uma tela com todos os itens que têm falta; itens sem
  falta entram direto.
- Entrada parcial de OC: quita pela ordem do rateio; resto da OC fica em aberto.

### 5. Baixa física (setor)

- `debit_reserved_materials_for_sector` deixa de ser tudo-ou-nada: com falta, a UI de
  apontamento mostra aviso e pede confirmação; baixa o empenhado e mantém a falta aberta.
- Finalização (`settle_open_reservations_for_order`) segue como está — a falta não quitada
  continua visível (não vira `cancelled`).

### 6. Cancelamento / alteração do PV

- Empenho → livre; falta → zerada.
- Linha do PV em OC `pendente_aprovacao` → removida (OC sem linhas → cancelada).
  OC aprovada → alerta ao dono, sem mexer.
- Alteração de quantidade/cor recompõe empenho e falta (mesmo caminho do recompute existente).

### 7. Telas

| Tela | O quê |
|---|---|
| Lista de estoque | Colunas **Falta** (vermelho), **Em compra**, **Projetado**; filtro "só itens com falta". Solado: grade com falta por numeração em vermelho. Físico inalterado |
| Aprovação do PV | Aviso com as faltas e a compra que será gerada (não bloqueia) |
| Rateio da entrada | Ver §4 |
| Janela do grupo → aba **Rastreio** | Cada entrada: data, origem (OC/NF/ajuste/inventário), qtd; abaixo o rateio "PV-xxxx: N · livre: N" com link pro PV; filtros cor/numeração |
| Fila de produção | Selo "material completo" quando a falta do PV zera |
| Apontamento de setor | Aviso + confirmação quando há falta |

## Defeitos a corrigir

1. **Commitment do próprio PV contado como "outro PV"** — o gate de corte (`031200` ~190-197),
   `compute_materials_per_pv.own_res` (`003200:472-485`) e `useCorteLookahead` atribuem
   reserva ao PV via `JOIN orders ON order_id`, mas `pv_commitment` tem `order_id NULL`.
   Efeito: pode bloquear a própria promoção e **inflar a compra**.
2. **Patch de recompute em `process_sale_order_purchase_shortages` possivelmente nunca
   aplicado** — `030700:487-507` procura `SELECT status INTO v_status`, mas o corpo tem
   `SELECT so.status, so.order_version INTO v_status…`; sem match só emite WARNING.
   Conferir o corpo **vivo** (`pg_get_functiondef`) antes de corrigir.

## Conflitos com specs anteriores

Decisões de hoje que **substituem** decisões escritas antes (confirmar na revisão):

| Spec anterior | Dizia | Agora |
|---|---|---|
| `pv-material-commitments` — Modelo/Bloqueio | Commitment da **necessidade inteira** | Empenho **parcial** + falta separada |
| `pv-material-commitments` — Escopo v1 | **Solado fora** | Solado **dentro** (por balde) |
| `pv-material-commitments` — Out of scope | Sem allocation genérico de recebimento | Rateio + rastreio de entrada **genérico** |
| `compras-producao-entrelacadas` D15 | OC consolidada por produto/cor/fornecedor na janela | OC **por PV**, agrupada por **grupo econômico do cliente** |
| `compras-producao-entrelacadas` D9 | OC pronta; scheduler envia na janela | OC nasce **aguardando aprovação** |
| Gate de corte (`031100`+) | Falta de material de corte aborta a promoção | **Aviso** |

## Fora de escopo

- Reconciliar os furos de OPs **finalizadas** (decisão 08/2026 mantida).
- Estoque mínimo / reposição automática (zerado em `20270101032100`).
- Mudar o ledger de tiras artesanais.
- Carimbo de lote físico na NF.

## Pronto quando

1. Aprovar PV com estoque parcial: empenha o que existe, registra falta por PV
   (e por numeração no solado), avisa sem bloquear.
2. OC criada automaticamente na quantidade total do PV (arredondada pelo múltiplo),
   agrupada por grupo econômico, `pendente_aprovacao`.
3. Lista de estoque mostra Falta / Em compra / Projetado; filtro funciona; físico intacto.
4. Qualquer entrada com falta aberta abre o rateio pré-preenchido; editar e confirmar
   quita falta, sobra vira livre; entrega parcial deixa saldo da OC em aberto.
5. Aba Rastreio mostra entrada → PVs com qtd por cor/numeração.
6. PV que zera a falta mostra "material completo — liberado para corte".
7. Iniciar setor com falta pede confirmação e baixa o empenhado.
8. Cancelar PV libera empenho, zera falta, remove linha de OC não aprovada e alerta em OC aprovada.
9. Migração recalcula PVs em aberto sem duplicar baixa já feita; finalizados intactos.
10. Defeitos 1 e 2 corrigidos, com contrato de teste.
11. Exemplos canônicos (napa 20/40 e solado 34/35/36) cobertos por teste de banco/contrato.
12. Verificação no site de produção (regra 7 do CLAUDE.md) do fluxo aprovar → comprar → dar
    entrada → rateio → rastreio.
