# Aprovação → distribuição Prep. cabedal

## Goal
Ao **aprovar** um Pedido de Venda (individual ou em lote), abrir uma tela full-bleed
de distribuição no motor de **Preparação de cabedal**, para Costura cabedal e
Aviamento, na mesma ordem de acompanhamento (`ready_date`). Remover o modal
pós-create de “Terceirizar Costura (override admin)” e os atalhos pós-save de OS
no create.

## Background / Problem
Hoje, ao criar PV com override de data mínima, abre
`OverrideOutsourceCosturaDialog` (Costura de fábrica, um contractor, modal).
Capacidade/OS pós-save também empilham diálogos. O dono quer: **não distribuir
antes de aprovar**; na aprovação, uma tela só no modelo Prep. cabedal
(`/terceirizados` → prep), setores costura_cabedal + aviamento.

## Scope

### In scope
- Abrir tela full-bleed **depois** de aprovação bem-sucedida (individual, select
  de status → Aprovado, e lote “Gerar OPs”).
- Tela lista demandas Prep. cabedal dos PVs aprovados, só
  `costura_cabedal` / `aviamento`, ordenadas por `ready_date`.
- Relatório (lote): PVs cuja data de entrega/fat. está na mínima viável
  automática.
- Confirmar: salva alocações + **trava plano** (não gera OS).
- Pular: fecha sem alocar (PV já aprovado).
- Aviso soft de capacidade/prazo (não bloqueia).
- Remover pós-create: `OverrideOutsourceCosturaDialog`, abertura automática do
  wizard por flag de capacidade, dialog “Pedido salvo → Gerar OS”.

### Out of scope
- Gerar OS de prep. cabedal no Confirmar.
- Segunda tela / wizard de OS de fábrica neste fluxo.
- Setor `corte_cabedal` nesta tela.
- Alterar gates pré-save (crédito, data mín., materiais, solados, capacidade).
- Remover `ItemSectorOutsourcingSection` / header de terceirização do form.
- Auto-alocador completo; refactors amplos no hub Prep. cabedal.
- Botão manual “Gerar OS” no edit do PV (permanece).

## Requirements

1. Após **Aprovar** individual com sucesso (botão do detalhe), o app abre a tela
   full-bleed de distribuição Prep. cabedal para aquele `sale_order_id` — não
   navega direto para a lista sem a tela.
2. Ao mudar status individual para **Aprovado** via select da lista, com sucesso,
   abre a mesma tela para aquele PV.
3. Após **Gerar OPs / aprovar lote** com ≥1 PV aprovado com sucesso, abre **uma**
   tela multi-PV com todos os IDs aprovados na rodada.
4. A tela materializa/sincroniza demandas (`backfill_cabedal_prep_demands` /
   equivalente por PV) antes de listar.
5. Lista só demandas com `requires_sewing` e/ou `requires_aviamento`; setor da
   linha ∈ {`costura_cabedal`, `aviamento`}; ordenação por `ready_date` asc.
6. Em lote (ou sempre que `saleOrderIds.length > 1`), o topo mostra relatório:
   order_number, data de entrega/fat., data mínima viável, flag se a data do
   pedido **é igual** à mínima (entrada “automática”).
7. Cada linha permite escolher prestador ou **Manter interno** (prestador
   FÁBRICA `payment_days ≥ 999`); default pré-selecionado quando houver
   capacidade/contractor óbvio.
8. Aviso soft (âmbar) quando o término estimado da alocação passa da
   `ready_date` / meta — **não** impede Confirmar nem Pular.
9. **Confirmar** persiste alocações via `useSaveCabedalPrepAllocations` (ou
   equivalente) com `lockPlan: true` para cada demanda editada; **não** chama
   `generate_cabedal_prep_service_orders`.
10. **Pular** fecha a tela sem gravar alocações novas.
11. Create/save de PV novo **não** abre `OverrideOutsourceCosturaDialog`, nem o
    wizard por `capacityOutsourceAfterSaveRef`, nem o dialog “Pedido salvo”;
    navega para `/sales` (salvo outros guards já existentes de divergência).
12. Gates pré-save e o botão manual “Gerar OS” no **edit** do PV permanecem.

## Constraints
- Reusar motor/hooks em `src/lib/cabedalPrep.ts` e `src/hooks/useCabedalPrep.ts`.
- Design tokens (sem cores hardcoded Tailwind default).
- Typecheck: `bunx tsc -p tsconfig.app.json --noEmit`.

## Definition of Done
- [ ] Spec requirements 1–12 implementados e cobertos por teste de contrato ou
      verificação manual descrita.
- [ ] `OverrideOutsourceCosturaDialog` sem callers no create path (arquivo pode
      ser removido se órfão).
- [ ] Typecheck limpo; `check:tokens` limpo nas UIs novas.
- [ ] Após deploy em `main`, verificação em produção do fluxo Aprovar → tela →
      Confirmar/Pular (regra do dono).
