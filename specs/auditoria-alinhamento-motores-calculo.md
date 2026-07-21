# Auditoria de Cálculo System-Wide — Alinhamento dos Motores

> Spec gerada por entrevista em 2026-07-21. Entrega acordada: **auditoria + correção**,
> com checkpoint de aprovação entre as duas fases. Substitui em parte a spec
> `alinhamento-motores-consumo-compras-ondas.md` (2026-07-12, nunca construída): herda a
> parte de auditoria/paridade e **exclui** as construções novas que ela propunha (Plano de
> Compras Semanal unificado, sugestão de composição de ondas, remoção do trigger de OC).

## Goal

Verificar — e corrigir onde divergirem — que **todos os motores de cálculo do sistema
contam a mesma história com os mesmos números**: produção (timeline/capacidade por setor),
consumo de materiais, planejamento de compras, débito/reserva de estoque, lançamento
(entrada) de estoque e custeio. Prova final: para uma amostra real de PVs/OPs, cada família
de motores retorna valores idênticos, verificável em tela e por query.

## Background / Problem

- O sistema acumulou motores paralelos por área (ex.: 3 caminhos de compra + Wizard como
  "4º motor"; consumo em TS e em SQL; timeline em SQL e capacidade no front). Auditorias
  anteriores (2026-06-14, 2026-06-16, 2026-07-01, 2026-07-08, 2026-07-13, 2026-07-19)
  fecharam divergências pontuais por área, mas **nunca houve uma varredura única cobrindo
  todas as famílias de uma vez**, incluindo os caminhos de ENTRADA de estoque.
- Divergência silenciosa entre motores é o modo de falha mais caro do sistema: consumo
  certo no modal + débito errado no estoque = estoque fantasma; compra na data errada =
  produção parada ou dinheiro parado; custeio com unidade errada = margem fictícia.
- Há divergências **intencionais documentadas** (ex.: `v_mrp_needs` usa estoque BRUTO de
  propósito) que uma auditoria ingênua "corrigiria" causando regressão — a auditoria
  precisa classificá-las, não apagá-las.

## Scope

### In scope — 6 famílias de motores

**F1. Produção — timeline/capacidade por setor**
- SQL: `compute_wave_timeline`, `update_wave_timeline`, recompute v3 date-aware
  (migs `20260912*`, fixes `099d409`), `stage_order()`, `v_wave_detail`,
  `apontar_producao_setor`/`production_pointings`.
- TS: `sectorCapacity.ts`, `leadTime.ts` (paridade UI × SQL nas datas).
- Engine de produtividade por modelo (migs `20260719*`): cadeia
  `bom_operations > última ref > default`, snapshots congelados, `*_capacity_per_day`.
- Wizard de distribuição / `sector_distribution_plan` (o "4º motor" — verificar se segue o
  motor de ondas ou calcula por conta própria).
- Topologia canônica dos setores (preps em paralelo, sequenciais depois, Costura ‖
  Aviamento conforme regra viva no banco).

**F2. Consumo de materiais**
- TS: `orderConsumption.ts` (modal + fichas de operador), `bomConsumption.ts` (Lista de
  Separação), `materialConsumption.ts` (conversões), rollup `compute_materials_per_pv`.
- SQL: `calculate_order_consumption`, `calculate_order_consumption_by_grade`,
  `get_material_conversion_info`, `get_effective_bom`, resolvers de variante
  (`resolve_*_material_for_variant`, `resolve_sole_for_variant`).
- Regras a exercitar: dm²→unidade física pela largura da ficha de componente; forro/palmilha
  dirigidos pelo solado + supressão anti-duplicidade; variante de material do PV
  (precedência completa); forração pick-one; fachete; palmilha pronta; solado por numeração
  e conjugações; `TECHNICAL_SHEET_CONSUMPTION_COLUMNS` completo.

**F3. Planejamento de compras**
- `v_mrp_needs`, OC por PV (`compute_materials_per_pv` → `source_type='per_pv'`),
  `purchase_projection_timeline`, trigger de OC automática (dedup + `max_stock` null),
  Wizard de compras (`PurchasePlanningWizard`), `purchase_by_date` (backward do
  faturamento), múltiplo de compra vs `min_order_quantity`, unidade de compra × unidade de
  estoque (`conversion_rate`).

**F4. Débito e reserva de estoque**
- `try_reserve_materials` (deve derivar do motor de consumo — migs `20260910150000+160000`),
  débito híbrido por cor, `debit_sole_stock_by_grade` (conjugados + baixa parcial),
  `debit_strap_stock` (CEIL, unaccent, advisory lock), débito artesanal via receita da OS,
  débito de embalagem, `release_order_reservations` (drift zero de `reserved_stock` via
  trigger `tg_sync_reserved_stock`), invalidação de snapshot ao editar ficha — incluindo o
  gap conhecido: tabelas `*_colors` (lista POR COR) **não invalidam** snapshot/reserva
  (caso PV-00146 ABS MARROM, spec registrada e não aplicada).

**F5. Lançamento (entrada) de estoque — TODOS os caminhos**
- Entrada por NF: `convertNfToStockUnit` / `toCanonical` / bloqueio `needsConfig` /
  desambiguação por cor.
- Recebimento de OC: qtd × `conversion_rate` (caso dm² 150×), múltiplo de embalagem.
- Ajuste manual: `adjust_stock` (RPC com controle de concorrência).
- Produção interna: receitas artesanais (entrada da tira + baixa da napa base; múltiplas
  bases por rendimento).
- Produto acabado: entrada ao finalizar/faturar OP.
- Estornos/cancelamentos: restauração de estoque escalar e por grade (`stock_grade`).
- Invariantes: `purchase_unit == unit ⇒ conversion_rate = 1`; `conversion_rate = 0`
  inválido; conversão dm²→m NUNCA em `conversion_rate` (mora na largura da ficha).

**F6. Custeio**
- `calculate_order_cost` (+ `convert_to_product_unit` antes de multiplicar por preço),
  snapshots `order_costs` (congelados — ver premissas), `markupCalc.ts` /
  `bomMaterialCostPerPair` (fonte única), MOD lida de `bom_operations` / Ficha de
  Montadores (snapshot R$/par), invariante `unit_price` = R$ por **unidade de estoque**.

### Out of scope (explicitamente agora não)
- **Reparo de dados históricos**: saldos de estoque, snapshots de custo, reservas e
  movimentos já gravados errados FICAM COMO ESTÃO (decisão do usuário: "corrigir só daqui
  pra frente"). Inclui o estoque fantasma conhecido das ~21 OPs de maio.
- **Guards/testes novos**: nenhum teste de paridade, guard de /diagnostics ou vitest novo
  será criado. Os já existentes devem continuar passando (rodá-los faz parte da auditoria).
- **Construções novas da spec de 2026-07-12**: Plano de Compras Semanal unificado,
  sugestão de composição/sequenciamento de ondas, remoção do trigger de OC por estoque
  mínimo. (Se uma correção aprovada exigir consolidar caminhos, isso é proposto no
  checkpoint — não é escopo default.)
- Folha/RH como motor próprio (entra só como INSUMO do custo MOD no custeio).
- DRE/financeiro além do que o custeio alimenta.
- Layouts de impressão, etiquetas, UI visual (exceto se um número exibido estiver errado).
- Migração de projeto Supabase (`ssvxfoybzmjlypnipqzn` continua sendo o banco).

## Requirements

1. **Inventário vivo**: mapear, por família, todos os pontos de cálculo REALMENTE em uso
   (função SQL viva no banco + módulo TS importado), incluindo motores mortos/duplicados
   encontrados no caminho. A verdade é o **banco de produção**, não os arquivos de
   migration.
2. **Paridade de consumo (F2)**: para a amostra, consumo por material idêntico entre modal,
   Lista de Separação, SQL escalar, SQL by-grade e rollup per-PV — cobrindo as regras
   listadas no escopo. Rodar `run_consumption_parity_tests()`,
   `consumption_consistency_report()` e os guards existentes de /diagnostics como parte da
   evidência.
3. **Paridade de produção (F1)**: datas/capacidades exibidas no front idênticas às do SQL;
   cadeia de produtividade por modelo aplicada igualmente em timeline, Wizard e
   distribuição; topologia de setores idêntica em todos os consumidores.
4. **Paridade de compras (F3)**: necessidade calculada consistente entre MRP, OC por PV,
   projeção e Wizard — respeitando a semântica documentada de cada um (bruto × líquido);
   datas de compra derivadas da mesma âncora; conversão compra↔estoque correta na
   quantidade sugerida.
5. **Débito = consumo (F4)**: reserva e débito usam exatamente os números do motor de
   consumo (mesma fonte, mesma conversão); nenhum caminho debita 2×; drift de
   `reserved_stock` contra reservas ativas = 0 na amostra.
6. **Entradas corretas (F5)**: cada caminho de entrada credita a quantidade certa NA
   unidade-base canônica do produto; nenhuma entrada aplica fator errado nem grava unidade
   sinônima; estornos devolvem exatamente o que foi debitado (escalar e por grade).
7. **Custeio íntegro (F6)**: quantidades do custeio = consumo do motor F2; toda
   multiplicação por preço converte antes para a unidade do `unit_price` (R$/unidade de
   estoque); markup/margem derivam desses mesmos números.
8. **Relatório classificado**: todo achado rotulado como (a) divergência REAL de motor,
   (b) divergência INTENCIONAL documentada (listar e não corrigir), ou (c) GAP DE CADASTRO
   (largura faltando, lead time faltando, conversion_rate errado — não é bug de motor;
   listar para o usuário corrigir o cadastro).
9. **Checkpoint obrigatório**: nenhuma correção é aplicada antes do relatório ser
   apresentado com causa raiz + proposta de fix por achado e o usuário aprovar
   (aprovação pode ser por item ou em bloco, a critério dele).
10. **Correções só-lógica**: fixes em TS e/ou migrations SQL valendo daqui pra frente;
    nenhum UPDATE de reparo em dados históricos.
11. **Verificação final**: repetir a comparação lado a lado na MESMA amostra mostrando
    igualdade onde antes havia divergência; typecheck
    (`bunx tsc -p tsconfig.app.json --noEmit`), build e suíte de testes existente verdes.

## Data model / Domain

- **Nenhuma tabela nova.** Mudanças de banco, se aprovadas, são correções de funções/
  views/triggers existentes via migration em `supabase/migrations/` (timestamp **maior**
  que a última migration aplicada no remoto), aplicadas via Supabase MCP.
- Entidades centrais lidas pela auditoria: `technical_sheets`, `component_sheets`,
  `sheet_materials`, `sole_technical_specs`, `reference_material_variants`, `products`
  (`quantity`, `reserved_stock`, `unit`, `purchase_unit`, `conversion_rate`, `stock_grade`),
  `material_reservations`, `stock_movements`, `orders`/`order_stages`/`order_costs`,
  `sale_order_items`, `production_waves`, `sector_distribution_plan`, `purchase_orders`,
  `v_mrp_needs`, `purchase_projection_timeline`, receitas artesanais, `production_pointings`.
- Unidades: lista canônica única por produto (m, dm², un, par, placa, kg, g, L, ml) — toda
  comparação entre motores é feita na unidade-base do produto.

## User flows

### Fase 1 — Auditoria (happy path)
1. Montar o inventário vivo dos motores por família (código TS + funções/views/triggers
   vivos no banco de produção, lidos via MCP).
2. Selecionar a amostra: PVs abertos/OPs recentes reais cobrindo o máximo de regras
   (variante de material, fachete, palmilha pronta, solado conjugado, tira artesanal,
   material de área com e sem largura, item linear direto).
3. Para cada família, computar o mesmo input em cada motor e registrar os números lado a
   lado; rodar os relatórios/guards de diagnóstico existentes.
4. Classificar cada divergência (real / intencional / gap de cadastro) com causa raiz.
5. Salvar o relatório em `docs/` e apresentar no chat.

### Checkpoint
6. Usuário revisa achado a achado (causa raiz + proposta de correção + risco) e aprova o
   que será corrigido.

### Fase 2 — Correção
7. Aplicar os fixes aprovados (TS e/ou migrations via MCP), família por família.
8. Typecheck + build + testes existentes verdes; commit + push (pipeline auto-deploy).

### Fase 3 — Verificação
9. Repetir a comparação lado a lado na mesma amostra; evidenciar igualdade.
10. Atualizar o relatório com o "depois" e o que ficou registrado como intencional/cadastro.

### Fluxos alternativos
- **Divergência intencional detectada** → entra no relatório como (b), sem proposta de fix.
- **Gap de cadastro** → entra como (c) com lista de itens a corrigir pelo usuário no app;
  o motor não é alterado por causa disso.
- **Fix reprovado no checkpoint** → registrado como "conhecido e aceito", sem correção.

## Edge cases & failure modes

- **Regra sem exemplo vivo na amostra** (ex.: nenhum PV aberto com fachete) → validar por
  leitura de código/SQL e marcar no relatório como "não exercitado em dados reais" (não
  criar dados de teste persistentes — fora do acordado).
- **Snapshot congelado antigo divergente** (`order_costs`, snapshots de consumo) → esperado
  e aceito; comparar motores apenas em cálculo NOVO, não contra snapshots velhos.
- **Motor morto/código órfão** encontrado → apontar no relatório; remoção só com aprovação
  no checkpoint.
- **Divergência causada por dado sujo** (unidade sinônima remanescente, `conversion_rate`
  0/errado) → classificar como gap de cadastro, nunca "consertar" o motor para acomodar o
  dado errado.
- **Correção SQL em função usada por triggers** → respeitar ordem alfabética de triggers
  (`tg_` < `trg_`) e o padrão vivo de sync de `reserved_stock` (NUNCA reintroduzir UPDATE
  manual — causa duplo-decremento com `tg_sync_reserved_stock`).
- **`v_mrp_needs` usa estoque BRUTO de propósito** → NÃO aplicar mudança para líquido
  (regressão conhecida: over-buy; mig `20260723120000` foi rejeitada).
- **Migration nova** → timestamp maior que a última aplicada no remoto, senão trava o
  pipeline de `db push`.
- **Amostra com dízimas de precisão** → comparar com `round(,4)`/tolerância, nunca
  igualdade exata de float.

## Constraints & assumptions

- Stack/convenções do CLAUDE.md do projeto: Bun, typecheck real só com
  `-p tsconfig.app.json`, imports `@/`, domínio em pt-BR, sonner, sem Prettier.
- Fase 1 é **somente leitura** no banco de produção (queries via MCP); escrita só na
  Fase 2, e só o que foi aprovado.
- Migrations aplicadas via Supabase MCP (Action de migrate não é confiável); arquivo
  também commitado em `supabase/migrations/`.
- Commit + push ao final de cada fase concluída (pipeline auto-deploy para produção).
- **Defaults assumidos** (usuário delegou): amostra escolhida pelo auditor para máxima
  cobertura de regras; relatório salvo como `docs/AUDITORIA_MOTORES_2026-07-21.md`;
  comparações numéricas com tolerância de arredondamento a 4 casas.

## Open questions

- Nenhuma bloqueante. (Se durante a auditoria surgir correção que exija consolidar
  caminhos de compra — território da spec antiga — a decisão é tomada no checkpoint.)

## Definition of Done

- [ ] Req. 1 — Relatório contém o inventário vivo das 6 famílias (funções SQL vivas +
      módulos TS), verificável conferindo o documento em `docs/` contra o banco.
- [ ] Req. 2 — Tabela lado a lado de consumo (modal × separação × SQL escalar × by-grade ×
      per-PV) igual para toda a amostra; `run_consumption_parity_tests()` e
      `consumption_consistency_report()` sem falhas novas — verificado por query e nas telas.
- [ ] Req. 3 — Datas de onda na UI = datas do SQL para as ondas da amostra; Wizard e
      distribuição usando a mesma capacidade/topologia — verificado abrindo a tela e
      comparando com `v_wave_detail`.
- [ ] Req. 4 — Necessidade e data de compra iguais (respeitada a semântica bruto×líquido
      documentada) entre MRP, OC por PV, projeção e Wizard para os materiais da amostra.
- [ ] Req. 5 — Para OPs da amostra: reserva/débito = consumo calculado; zero débito
      duplicado em `stock_movements`; drift de `reserved_stock` = 0.
- [ ] Req. 6 — Um caso real (ou simulado reversível) de cada caminho de entrada credita a
      quantidade certa na unidade-base — verificado em `stock_movements` + saldo.
- [ ] Req. 7 — Custeio recalculado da amostra usa quantidades do motor de consumo e
      converte unidade antes do preço — verificado no breakdown de `order_costs` novo.
- [ ] Req. 8 — Todo achado do relatório tem classificação (real/intencional/cadastro) e
      causa raiz.
- [ ] Req. 9 — Existe registro do checkpoint (achados apresentados e aprovação do usuário)
      antes de qualquer correção aplicada.
- [ ] Req. 10 — Nenhuma migration/commit da Fase 2 contém UPDATE de reparo retroativo de
      dados históricos.
- [ ] Req. 11 — Comparação "depois" igual na mesma amostra; typecheck, build e testes
      existentes verdes; mudanças commitadas e em produção.
