# Ateliê — cabedal complexo (rua) + anti–consumo duplo

## Goal

Substituir a fila inchada de Preparação de cabedal por um **Ateliê**: cadastro
curado de referências complexas (por setor), fila operacional em 3 estágios após
o PV ir para `Aprovado`, integração com Relatório → distribuição → OS no hub
Terceirizados, cartão físico da rua, bloco separado no Consumo do PV, e sinais
no Kanban/Gestão — sem consumir o mesmo material duas vezes (prep + OP).

## Background / Problem

- O motor atual (`materialize_cabedal_prep_demands`) puxa quase todo item com
  corte/aviamento (`has_straps` / `aviamento_steps`), gerando dezenas de
  demandas que não deveriam ir pra rua.
- Não existe flag de “cabedal complexo”; a aba Terceirizados da ficha
  (`reference_terceirizacoes`) **não** governa o prep.
- Débito na geração de OS é hard em `products.quantity` via
  `cabedal_prep_stock_debits`, **sem** soft na aprovação e **sem** gate no
  `hybrid_debit` / settle da OP → risco de consumo duplo.
- Kanban/Gestão não mostra estado na rua.

## Settled decisions (grill 27/09/2026)

| # | Decisão |
|---|---|
| Cadastro | `/atelie?view=cadastro` — ref × setor (Corte / Costura / Aviamento) |
| Fila | `/atelie?view=fila` — 3 espaços: Debitar → Enviado → Recebido |
| Gatilho | PV → **`Aprovado`** + ref×setor no cadastro |
| Fora do Ateliê | Sem fila de prep/rua; fábrica no Kanban/OP |
| Hub | Remover `tab=prep` como porta; Relatório → distribuir → OS |
| Prestador no cadastro | Não (escolhe na distribuição) |
| Estoque | Soft na aprovação; débito real no confirmação do espaço Debitar |
| Anti-2× | OP/`hybrid_debit`/settle pulam ledger Ateliê |
| Materiais | Por setor: Corte/Costura = cabedal; Aviamento = tiras/aviamentos |
| Consumo PV | Bloco “Prep. cabedal” só após débito; status evolui |
| Cancelamento | Soft libera; hard = estorno explícito |
| Cartão rua | Próprio (cliente + nº serviço + `k/N`); impressão explícita pós-OS |
| Kanban | Badge + trava apontamento “no prestador” + filtro; sem colunas novas |
| Escopo UI | Ateliê + prep fora + Relatório/OS cabedal + polish nav; sem redesign Na Rua/Contratadas |

## Unificação Antecipação → Ateliê (grill 06/10/2026)

| # | Decisão |
|---|---|
| Antecipação | `/producao/antecipacao` → redirect `/atelie`; some do hub Produção |
| Early-release fábrica | `start_offset_days` de Costura Cabedal e Aviamento = 0; UI em Setores aponta pro Ateliê |
| Rua | Só jobs `costura_cabedal` + `aviamento` (cadastro obrigatório); **não** cria job de corte rua |
| Corte | Interno (Kanban `Corte Cabedal`); cadastro Corte só marca complexidade |
| Pipeline | `awaiting_cut` → (Corte Cabedal `concluido`) → `awaiting_debit` → … ; soft já no approve |
| Agenda | `atelier_settings` (N Costura / N Aviamento) + `target_start`/`target_end` nas jobs |

Migração: `20270101031700_atelier_unificar_antecipacao.sql`.

## Scope

### In scope

1. **Tabela de cadastro** `atelier_complex_references` (nome final na migration):
   `(technical_sheet_id / reference_id, sector ∈ {corte_cabedal, costura_cabedal, aviamento}, active, unique)`.
2. **Página** [`/atelie`](src/pages/) sob Engenharia/Fichas: `?view=cadastro|fila`,
   nav em [`navigation.ts`](src/data/navigation.ts), rota + `ROUTE_MODULE_MAP`
   (`produtos`, espelho de `/fichas-tecnicas`), UI com tokens do app
   (EditorialPageHeader / Panel — sem landing solta).
3. **Motor de elegibilidade**: materializar / listar demandas Ateliê **somente**
   se existir linha ativa no cadastro para aquele setor; cancelar/não
   rematerializar demandas prep abertas que não casam (reaplicar).
4. **Pipeline de status** por demanda×setor: `awaiting_debit` → `debited` →
   `sent_to_contractor` → `received_at_factory` (valores exatos na migration).
5. **Estoque**:
   - Aprovado → soft `material_reservations` (kind dedicado, ex. `atelier_prep`)
     só dos SKUs do setor (D).
   - Confirmar no espaço Debitar → consome soft + grava ledger + `stock_movements`
     (corrigir gap atual sem movimento).
   - `hybrid_debit_stock_for_order` / settle: skip product_id já no ledger Ateliê
     daquele `sale_order_id` (e reservas `atelier_prep` já consumidas).
6. **Consumo de Materiais do PV**: segundo bloco “Preparação de cabedal (rua)”
   visível só com status ≥ `debited`; lista materiais + status do pipeline.
7. **Hub Terceirizados**: remover aba Prep; Relatório/fluxo de distribuição por
   prestador gera OS a partir das demandas Ateliê elegíveis; redirect
   `?tab=prep` → `/atelie?view=fila`.
8. **OS + cartão**: número de serviço Ateliê; cartão rua (evoluir ou irmão de
   [`CartaoFisico`](src/components/production/CartaoFisico.tsx)) com cliente,
   PV, nº serviço, `k/N`; ação Imprimir após OS (não automática).
9. **Kanban/Gestão**: badge nos 3 estados úteis + bloquear apontamento do setor
   enquanto `sent_to_contractor` + filtro “Com material na rua”.
10. Testes de contrato (migration + keys de rota + anti-rebaixa) e typecheck
    `tsconfig.app.json`.

### Out of scope

- Redesign completo de Na Rua / Prestadores / Tarifas.
- Prestador preferido no cadastro.
- Unificar com `reference_terceirizacoes` (aba ficha) neste pacote.
- Backfill inventando dm² / alterar regras de corrugado 12/15/18.
- Consumo antecipado de solado/embalagem.

## Requirements

### Cadastro e rota

1. Rota autenticada `ProtectedRoute` → `RouteGuard` em `/atelie`, módulo
   `produtos`.
2. Entrada no menu Engenharia (hub-child), junto de Fichas Técnicas.
3. View cadastro: abas Corte / Costura / Aviamento; adicionar/remover referência
   (busca ficha); listar ativas.
4. View fila: mesmos setores + três colunas/espaços do pipeline; linha mostra
   PV, cliente, ref, cor, pares, prazo/`ready_date`, OP se existir.

### Elegibilidade e materialização

5. Em PV → `Aprovado`, só cria/atualiza demanda Ateliê se cadastro ativo para
   o setor necessário daquele item (costura e/ou aviamento e/ou corte conforme
   flags de ficha **e** cadastro).
6. Item fora do cadastro: zero demanda Ateliê; não aparece em Relatório de rua
   deste fluxo.
7. Função/botão “Reaplicar Ateliê”: cancela demandas abertas que não casam mais
   com o cadastro (libera soft se houver).

### Estoque e anti–consumo duplo

8. Soft na aprovação para SKUs do setor (resolver produto pela cor/variante do
   item do PV — não “todo o grupo”).
9. Confirmar Debitar: baixa real + ledger Ateliê + movimento; idempotente por
   `(sale_order_id, product_id, sector)`.
10. `hybrid_debit` e settle **não** reservam/debitam de novo product_ids já no
    ledger Ateliê daquele PV (contrato testável).
11. Cancelar PV / remover item: libera soft; se já debitado, bloqueia cancel
    silencioso ou exige estorno explícito (mensagem clara).

### Consumo no PV

12. Painel Consumo: seção “Produção” (atual) + seção “Preparação de cabedal
    (rua)” só se existir débito Ateliê; status Debitado / Enviado / Recebido.

### Terceirizados / OS / cartão

13. Remover `tab=prep` do hub; links legados redirecionam ao Ateliê.
14. Relatório lista demandas Ateliê (não a fila prep antiga); clique leva à
    distribuição por prestador e gera OS.
15. Impressão de cartões da rua explícita pós-OS; Fardo interno permanece.

### Kanban

16. Card no setor Ateliê: badge conforme status; apontamento bloqueado em
    `sent_to_contractor`; filtro na Gestão.

## Constraints

- Package manager Bun; typecheck `bunx tsc -p tsconfig.app.json --noEmit`.
- Design tokens (`bun run check:tokens` nas UIs novas); print do cartão rua com
  cores hardcoded / Anton como demais cartões.
- Migration: carimbo > `max(arquivo local, schema_migrations)`; consultar as
  duas fontes na hora de aplicar.
- Não reintroduzir perda de corte; não usar `lucide-react`.
- Reusar o que for seguro de [`useCabedalPrep`](src/hooks/useCabedalPrep.ts) /
  [`cabedal_prep_*`](supabase/migrations/20270101027600_cabedal_prep_motor.sql);
  onde o contrato mudar (elegibilidade, soft, anti-rebaixa), substituir de
  propósito — não manter dois motores divergentes.

## Data model (alvo)

```
atelier_complex_references
  id, reference_id (→ technical_sheets), sector, active, created_at, created_by

atelier_demands          -- ou evolução de cabedal_prep_demands
  id, sale_order_id, sale_order_item_id, sector, pairs, color, status,
  ready_date, billing_week, …

atelier_stock_ledger     -- ou evolução de cabedal_prep_stock_debits
  sale_order_id, product_id, sector, qty, reservation_id?, stock_movement_id,
  service_order_id?

atelier_service_numbers  -- sequência nº serviço impresso no cartão
```

Decisão de implementação: **evoluir** tabelas `cabedal_prep_*` com colunas de
pipeline + gate de cadastro **ou** criar `atelier_*` e migrar. Preferência:
evoluir `cabedal_prep_*` se o custo de rename for baixo; senão `atelier_*` +
deprecate prep UI.

## Implementation phases

### Phase 1 — Cadastro + filtro de elegibilidade
- Migration cadastro + gate em `materialize_*`.
- Página `/atelie` view cadastro.
- Remover aba prep do hub (redirect).
- Reaplicar / limpar demandas não elegíveis.

### Phase 2 — Pipeline 3 espaços + estoque
- Status pipeline + soft na aprovação + confirmar débito.
- Gate anti-rebaixa em hybrid/settle.
- View fila Ateliê.
- Bloco Consumo PV.

### Phase 3 — Relatório → OS → cartão + Kanban
- Distribuição/OS a partir do Relatório.
- Cartão rua + impressão.
- Badges/trava/filtro Kanban Gestão.

## Definition of Done

- [ ] Spec requirements 1–16 implementados com testes de contrato nos pontos
      load-bearing (elegibilidade, soft→débito, anti-rebaixa OP, rota/nav).
- [ ] Typecheck limpo (`tsconfig.app.json`); `check:tokens` limpo nas telas app.
- [ ] Demandas prep antigas fora do cadastro não aparecem na operação de rua.
- [ ] Após deploy em `main`, verificação em produção
      (https://squadshoes-real.vercel.app): cadastrar ref no Ateliê → aprovar PV
      → soft → confirmar débito → enviar → bloco no Consumo → badge no Kanban
      (regra do dono). Login bloqueando = declarar, não afirmar tela certa.

## Key files (hoje)

| Papel | Path |
|---|---|
| Hub prep | `src/pages/TerceirizadosHub.tsx`, `CabedalPrepPanel.tsx` |
| Hooks/motor TS | `src/hooks/useCabedalPrep.ts`, `src/lib/cabedalPrep.ts` |
| SQL motor | `supabase/migrations/20270101027600_cabedal_prep_motor.sql` (+ 277/279) |
| Outbox | `supabase/functions/process-sale-order-outbox/index.ts` |
| Consumo PV | `SummaryConsumptionPanel` / `MaterialConsumptionView` |
| Kanban | `ProducaoKanbanGestao.tsx`, `kanbanDerive.ts`, `KanbanOpCard.tsx` |
| Fardo | `CartaoFisico.tsx`, `cartaoFisico.ts` |
| Spec irmã | `specs/aprovacao-distribuicao-prep-cabedal.md` (parcial; este doc vence no conflito de produto Ateliê) |
