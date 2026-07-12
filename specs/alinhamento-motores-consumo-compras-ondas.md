# Alinhamento dos Motores: Consumo → Débito → Compras (Plano Semanal) → Ondas

> Spec gerada por entrevista em 2026-07-12. Entrega acordada: **diagnóstico + correção**
> (causa raiz explicada antes de cada fix, conforme regra do usuário) + **duas construções
> novas** que saíram da entrevista: o Plano de Compras Semanal unificado e a sugestão de
> composição de ondas com agrupamento.

## Goal

Garantir que os 5 motores do sistema — (1) consumo via ficha técnica, (2) débito/reserva de
estoque, (3) projeção de compras com lead time de fornecedor, (4) cronograma das ondas de
produção semanais e (5) agrupamento das OPs na produção — calculam **os mesmos números e as
mesmas datas**, de ponta a ponta, de modo que a fábrica nunca (a) inicie um pedido sem
material para concluí-lo, nem (b) deixe de gerar/antecipar demais uma Ordem de Compra
(dinheiro parado em estoque).

## Background / Problem

- O sistema hoje tem **três caminhos de compra** (Projeção de Compras, MRP/Planejamento,
  Compras por Pedido) que "seguem a mesma lógica mas mudam de nome" — o usuário não confia
  em qual número olhar, e cada tela pode divergir (consumo, estoque líquido, datas).
- A OC hoje tende a nascer "para agora" quando falta material, em vez de nascer na **data
  ideal de pedido** = (data em que a produção vai USAR o material) − (lead time do
  fornecedor). Exemplo dado: napa Papasoft preta necessária só daqui a um mês não deve
  virar compra hoje.
- Auditorias anteriores (2026-06-14 → 2026-07-08) fecharam divergências pontuais, mas nunca
  houve uma validação **ponta-a-ponta com escrita persistente** provando que
  consumo → reserva → plano de compra → data de OC → onda → débito contam a mesma história.
- **Nenhum caso de falha real ocorreu ainda — isto é prevenção**, antes da fábrica depender
  100% do sistema. Validação usa PVs abertos reais + cenários de teste persistentes.

## Scope

### In scope
1. **Auditoria E2E dos 4 motores existentes** (consumo, débito/reserva, datas de compra,
   cronograma de ondas), com correção de toda divergência confirmada.
   - Validação **E2E com escrita persistente**: criar PV/OP/OC de teste REAIS no banco de
     produção (marcadas como teste), exercitar triggers de INSERT/UPDATE de verdade, e
     **cancelar/limpar tudo ao final** com prova de que o estado voltou ao baseline
     (reserved_stock, stock_movements, quantity).
2. **Plano de Compras Semanal unificado** — UMA tela que substitui Projeção de Compras,
   MRP/Planejamento e Compras por Pedido (as antigas redirecionam para ela), mostrando
   semana a semana o que pedir, com geração de OC por clique.
3. **Remoção do trigger automático de OC por estoque mínimo**; o conceito de estoque mínimo
   vira linha visível no plano semanal ("reposição de estoque mínimo").
4. **Sugestão de composição + sequenciamento de ondas semanais** com o agrupamento-alvo:
   todos os setores produtivos por **solado + referência + cor**; **Acabamento e Expedição
   por loja**.
5. Avisos de cadastro: lead time faltante na página de fornecedores; ícone no item do
   estoque quando o produto não tem fornecedor vinculado.

### Out of scope (explicitamente agora não)
- **Fichas de operador impressas**: o agrupamento delas NÃO muda (regra de agrupamento vale
  só para o motor de ondas — decisão explícita do usuário).
- Layouts de impressão/etiquetas em geral.
- Custeio/DRE/financeiro além do necessário para provar paridade de quantidades.
- Recebimento de OC / conferência de NF (fluxos existentes permanecem).
- Migração do projeto Supabase (`ssvxfoybzmjlypnipqzn` continua sendo o banco).

## Requirements

### A. Auditoria de alinhamento (diagnóstico + correção)
1. **Paridade de consumo**: para PVs reais abertos, o consumo por material deve ser
   idêntico entre: modal "Consumo de Materiais" (`orderConsumption.ts`), Lista de Separação
   (`bomConsumption.ts`), SQL (`calculate_order_consumption` e `_by_grade`), custeio
   (`calculate_order_cost`) e o novo Plano de Compras. Cobrir: conversão dm²→unidade física
   pela largura da ficha de componente, variante de material do PV, componentes por cor
   predominante, forração pick-one, fachete, palmilha pronta, solado por numeração e
   numerações conjugadas. Rodar e passar `run_consumption_parity_tests()` e
   `consumption_consistency_report()` / `component_colors_consistency_report()`.
2. **Débito/reserva corretos**: `try_reserve_materials`, débito híbrido por cor,
   `debit_sole_stock_by_grade`, `debit_strap_stock` e `release_order_reservations` devem
   (a) debitar/reservar exatamente o consumo calculado no req. 1, (b) nunca debitar 2×,
   (c) manter `products.reserved_stock` com drift zero em relação a
   `material_reservations` ativas (trigger `tg_sync_reserved_stock`), (d) registrar
   `stock_movements` para todo débito.
3. **Cronograma de ondas correto**: `compute_wave_timeline`/`update_wave_timeline` devem
   refletir a topologia canônica (setores prep em paralelo, demais sequenciais), usar as
   capacidades diárias das fichas técnicas, e o frontend (`sectorCapacity.ts`,
   `leadTime.ts`) deve exibir as MESMAS datas que o SQL (paridade UI × servidor).
4. **Âncoras de data alinhadas (regra canônica)**: "quando o material é necessário" =
   **início do setor que o consome** no cronograma da onda (napa/forro antes do Corte,
   solado antes da Solagem, embalagem antes da Expedição), e `material_ready_date` da onda
   deve ser coerente com isso (mesma lógica, mesmo resultado para o primeiro setor). O
   conceito atual de `purchase_by_date` retroativo do faturamento deve ser **realinhado**
   para derivar do cronograma da onda; onde divergir, a onda vence.
5. Toda divergência confirmada é corrigida (migration e/ou código TS) com causa raiz
   explicada ANTES do fix; divergências não-críticas descobertas mas não corrigidas ficam
   documentadas com plano.

### B. Plano de Compras Semanal (construção)
6. **Motor único de necessidade**: uma única fonte de cálculo (RPC/view SQL) que produz,
   por material: necessidade total das OPs/PVs abertos, estoque líquido, falta, **data de
   necessidade** (req. 4) e **data ideal de pedido** = data de necessidade − lead time do
   fornecedor. Nenhuma tela recalcula por conta própria.
7. **Tela única com buckets semanais**: itens agrupados por semana de compra (semana
   inicia segunda-feira), "semana de dd/MM: pedir X, Y, Z", com filtros (fornecedor, PV,
   setor de estoque). Deve responder à pergunta: "o que eu pedido nesta semana para o
   material chegar exatamente quando a produção precisa?"
8. **Substituição real**: Projeção de Compras, MRP/Planejamento e Compras por Pedido saem
   do menu e suas rotas redirecionam para a tela nova. Histórico/gestão de OCs continua em
   Ordens de Compra.
9. **Sem lead time cadastrado** → o item cai na **semana atual** ("comprar já"), com flag
   visível explicando o motivo ("sem lead time cadastrado"). A página de cadastro de
   fornecedores exibe alerta listando fornecedores/materiais sem lead time.
10. **Produto sem fornecedor vinculado** → ícone/indicador visual no item na tela de
    Estoque, clicável para cadastrar fornecedor + lead time dali; no plano, também cai como
    "comprar já" com flag do motivo.
11. **Geração de OC**: um clique por semana/fornecedor cria as OCs com quantidades
    sugeridas, respeitando múltiplo de compra e quantidade mínima de pedido, com
    deduplicação (não criar OC duplicada em retry/duplo clique). Nada é comprado sem
    confirmação do usuário.
12. **Trigger automático de OC por estoque mínimo é removido.** Item abaixo do mínimo
    (mesmo sem demanda de PV) aparece como linha na semana atual marcada "reposição de
    estoque mínimo"; o usuário decide se inclui na OC.
13. **Data ideal no passado** (pedido deveria ter saído semana passada) → o item aparece em
    um bucket "Atrasado — comprar já", no topo.

### C. Ondas: composição sugerida + sequenciamento (construção)
14. **Sugestão de composição semanal**: o motor propõe quais OPs entram na onda da semana,
    priorizando prazo de entrega dos PVs, juntando OPs do mesmo **solado + referência +
    cor** na mesma onda quando possível (minimizar troca de setup), e respeitando a
    capacidade diária dos setores. O usuário revisa e confirma — nada é planejado sem
    aprovação.
15. **Sequenciamento dentro da onda**: todos os setores produtivos (Corte Palmilha, Corte
    Forração, Costura, Aviamento, Silk, Colagem, Montagem, Solagem) ordenam por
    **solado + referência + cor**; **Acabamento e Expedição** ordenam por **loja**.
16. Fichas de operador impressas permanecem com o agrupamento atual (nenhuma mudança).

### D. Validação E2E persistente
17. Cenário completo com escrita real: criar PV de teste → gerar OPs → reservar materiais →
    verificar plano semanal (item na semana certa, data = necessidade − lead time) → gerar
    OC pelo clique → simular avanço de produção com débito → conferir `stock_movements` →
    cancelar tudo → provar que estoque, reservas e movimentos voltaram ao baseline
    (queries antes/depois idênticas).

## Data model / Domain

Entidades centrais (existentes): `technical_sheets` (+ `*_consumption_per_size`,
capacidades por setor), `component_sheets` (largura p/ conversão dm²→física),
`sheet_materials` (BOM), `reference_material_variants`, `sale_orders`/`sale_order_items`
(`material_variant_id`, `grade` base), `orders` (OPs), `material_reservations` +
`products.reserved_stock` (trigger de sync), `stock_grade` (solado por numeração),
`stock_movements`, `production_waves` (+ datas por setor, `material_ready_date`),
`purchase_orders`, `product_groups` (setor/hierarquia), `suppliers`.

Implicações prováveis (verificar no banco vivo — a verdade é o banco, não os arquivos de
migration):
- **Lead time do fornecedor**: confirmar onde mora hoje (campo em `suppliers` e/ou por
  produto/fornecedor). Se não existir campo adequado, criar (ex.:
  `suppliers.lead_time_days int`), com backfill vazio e alerta de cadastro (req. 9).
- **RPC/view do plano semanal** (ex.: `get_weekly_purchase_plan()`): necessidade por
  material × data de necessidade × data ideal de pedido × semana × flags (sem lead time,
  sem fornecedor, largura faltando, estoque mínimo).
- **DROP do trigger de OC automática por estoque mínimo** (migration).
- **Sugestão de onda**: função SQL ou motor TS que propõe composição; persistência só após
  confirmação do usuário (nenhuma tabela nova obrigatória além do que as ondas já usam;
  se precisar de rascunho, marcar status 'sugerida').
- Unidades sempre canônicas (`m`, `dm²`, `un`, `par`, `placa`, `kg`, `L`);
  `conversion_rate` nunca 0; conversão dm²→m mora na LARGURA da ficha de componente,
  nunca em `conversion_rate`.

### Armadilhas conhecidas que a auditoria DEVE reconciliar (de memórias/auditorias passadas)
- `v_mrp_needs` usa estoque **BRUTO de propósito** (reservas correspondem às próprias
  necessidades contadas — descontar duas vezes = over-buy). O motor único (req. 6) precisa
  escolher UMA convenção líquido/bruto, documentá-la e aplicá-la em todo lugar.
- `order_costs` lê snapshot congelado — corrigir ficha não conserta snapshot antigo.
- OC automática já duplicou com fornecedor "Sem Fornecedor" — a deduplicação do req. 11
  deve usar chave estável.
- Largura faltando na ficha de componente → consumo ~100× inflado; `try_reserve` já pula
  esses materiais; o plano semanal deve exibi-los como pendência de cadastro, não como
  número confiável.
- Baldes conjugados de solado ("33/34") distribuem entre números — não contar 2×.

## User flows

### Happy path (operação semanal do dono)
1. Usuário abre **Plano de Compras Semanal** (menu Compras).
2. Vê buckets: "Atrasado", "Esta semana (13/07)", "Semana 20/07", "Semana 27/07"…; cada
   item mostra material, falta, fornecedor, lead time, data de necessidade (qual OP/setor
   puxa), data ideal de pedido e flags.
3. Revisa a semana atual, ajusta quantidades se quiser, clica **Gerar OC** por fornecedor.
4. OCs nascem com múltiplo de compra respeitado; material chega na data em que o setor que
   o consome inicia.
5. No PCP, usuário pede **Sugerir onda da semana**: o motor propõe OPs agrupadas por
   solado+referência+cor dentro da capacidade; usuário confirma; cronograma por setor é
   calculado; Acabamento/Expedição sequenciados por loja.
6. Produção avança; débitos batem com o consumo previsto; estoque permanece correto.

### Alternate / edge flows
- Material sem lead time → aparece em "Esta semana" com flag; usuário cadastra lead time
  no fornecedor (alerta na página de fornecedores) e o item se move para a semana certa.
- Produto sem fornecedor → ícone no Estoque; usuário cadastra dali.
- OP sem onda planejada → data de necessidade cai para a **data de entrega do PV** (com
  aviso "sem onda planejada — usando prazo do PV") até a onda existir.
- Capacidade da semana estoura na sugestão de onda → OPs excedentes transbordam para a
  sugestão da semana seguinte, com aviso.
- Mesmo material demandado por vários PVs na mesma janela → linha consolidada no plano com
  detalhamento por PV; data de necessidade = a mais cedo.

## Edge cases & failure modes

- **Retry/duplo clique em Gerar OC** → dedup por chave estável; nunca 2 OCs iguais.
- **Reserva de OP cancelada** → `reserved_stock` devolvido via trigger (NÃO reintroduzir
  UPDATE manual — causa duplo-decremento com `tg_sync_reserved_stock`).
- **Grade conjugada no débito de solado** → usar key conjugada só se existir no
  `stock_grade`, senão keys individuais.
- **Ficha de área sem largura** → não converter; flag `widthMissing`; excluído de sugestão
  de OC automática de quantidade (aparece como pendência).
- **Lead time = 0 ou negativo** → tratar como inválido = sem lead time (flag, semana atual).
- **Data ideal no passado** → bucket "Atrasado", nunca some do plano.
- **PV faturado/cancelado** → sai do plano imediatamente (mesma exclude-list do picking:
  Cancelado/Rascunho fora).
- **Cenário E2E persistente falhar no meio** → roteiro de limpeza idempotente documentado
  (IDs de teste registrados antes de criar), pra nunca deixar lixo no banco de produção.

## Constraints & assumptions

- Banco de produção Supabase `ssvxfoybzmjlypnipqzn`; migrations via MCP (Action de push
  está quebrada); **a verdade é o banco vivo**, não os arquivos de migration.
- Typecheck canônico `bunx tsc -p tsconfig.app.json --noEmit`; testes `bun run test`;
  tokens `npm run check:tokens`; convenções do CLAUDE.md (React Query, sonner, phosphor,
  domínio pt-BR, unidades canônicas, design tokens).
- Fichas de operador/print: **não tocar** (exempt + regra explícita desta spec).
- Assumido (usuário deferiu ou não especificou):
  - Semana inicia **segunda-feira**; buckets por semana ISO local.
  - "Ícone no estoque utilizando artifacts" interpretado como **indicador visual (ícone/
    badge) na listagem de estoque** abrindo o cadastro de fornecedor do produto.
  - Geração de OC = **um clique por semana/fornecedor com revisão** (usuário rejeitou o
    trigger automático; nada nasce sem confirmação).
  - Nome/rota da tela nova: "Plano de Compras" substituindo a rota do MRP (redirects nas
    demais).
  - PVs de validação: escolher ≥3 PVs abertos reais cobrindo variante de material,
    componentes por cor, solado fachetado/conjugado e palmilha pronta.

## Open questions

- Onde exatamente mora o lead time do fornecedor hoje (campo existente vs criar) — decidir
  na fase de descoberta da auditoria, olhando o schema vivo.
- Convenção final líquido × bruto do motor único (req. 6) — a auditoria decide com base na
  reconciliação da armadilha do `v_mrp_needs` e documenta a escolha.

## Definition of Done

- [ ] **Req. 1** — Para ≥3 PVs reais (cobrindo variante, componentes por cor, fachete,
      conjugado, palmilha pronta), tabela comparativa modal × Lista de Separação × SQL ×
      custeio × plano semanal com **diferença zero** por material;
      `run_consumption_parity_tests()` e os consistency reports passam sem erro novo.
- [ ] **Req. 2** — Cenário E2E: reserva+débito de OP de teste bate 1:1 com o consumo
      calculado; query de drift `reserved_stock` × reservas ativas retorna 0 linhas;
      nenhum débito duplicado em retry.
- [ ] **Req. 3** — Para uma onda real, datas por setor exibidas na UI == datas do SQL
      (paridade provada por query + screenshot).
- [ ] **Req. 4** — Para a onda de teste: data de necessidade de cada material == início do
      setor consumidor; `material_ready_date` == início do 1º setor; data ideal de pedido
      == necessidade − lead time (provado com query lado a lado).
- [ ] **Req. 5** — Relatório final lista cada divergência encontrada com causa raiz,
      correção aplicada (commit/migration) ou plano documentado.
- [ ] **Reqs. 6–8** — Tela "Plano de Compras" no ar com buckets semanais; rotas antigas
      (Projeção, MRP, Compras por Pedido) redirecionam; nenhum outro lugar do app calcula
      necessidade de compra por caminho próprio.
- [ ] **Reqs. 9–10** — Material sem lead time aparece em "Esta semana" com flag; página de
      fornecedores mostra alerta de lead times faltantes; produto sem fornecedor tem ícone
      no Estoque que abre o cadastro.
- [ ] **Req. 11** — Clique em Gerar OC cria OC com múltiplo/mínimo respeitados; duplo
      clique não duplica (testado).
- [ ] **Req. 12** — Trigger de OC automática removido do banco (query em `pg_trigger`
      prova); item abaixo do mínimo aparece como linha "reposição de estoque mínimo".
- [ ] **Req. 13** — Item com data ideal no passado aparece no bucket "Atrasado".
- [ ] **Reqs. 14–15** — Botão "Sugerir onda" propõe composição agrupada por
      solado+referência+cor dentro da capacidade; nada persiste sem confirmação;
      sequenciamento interno segue a regra (Acabamento/Expedição por loja).
- [ ] **Req. 16** — Diff das fichas de operador/print = vazio.
- [ ] **Req. 17** — Roteiro E2E persistente executado e documentado; queries
      antes/depois provam baseline restaurado (estoque, reservas, movimentos).
- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo; `bun run test` verde;
      `npm run check:tokens` sem violação nova.
