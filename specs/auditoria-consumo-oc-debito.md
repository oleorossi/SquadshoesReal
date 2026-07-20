# Auditoria: Consumo de Materiais × Geração de OC × Débito de Estoque

> Spec gerada por entrevista em 2026-07-19/20, a partir do PV-00146.
> Entrega acordada: **laudo com evidência + correções aplicadas**.
> Regra do usuário respeitada: causa raiz explicada antes de cada fix
> ([[feedback_explain_before_fix]]).

## Goal

Provar, com números de pedidos reais, se o **consumo exibido no modal do PV**, a
**quantidade comprada pela OC** e a **quantidade debitada do estoque na OP** derivam do
mesmo cálculo da ficha técnica — e corrigir toda divergência confirmada, para que a fábrica
não compre material que não vai consumir nem baixe estoque que não saiu.

## Background / Problem

O sistema tem hoje **quatro implementações independentes** da mesma regra de consumo:

| Caminho | Motor | Grade? | Fonte da conversão dm²→física |
|---|---|---|---|
| Modal **Consumo de Materiais** (PV) | TS no cliente — `computeConsumptionForItems`, `src/lib/orderConsumption.ts:640` | por numeração | `component_sheets.dimensions_width` (`materialConsumption.ts:247`) |
| **Gerar OCs / MRP** | SQL `calculate_order_consumption_by_grade` via `compute_materials_per_pv` / `v_mrp_needs` | por numeração | `get_material_conversion_info(product_id)` |
| **Débito da OP** | mesma RPC, via `hybrid_debit_stock_for_order` (`20260915110000:388`) | híbrido (área escalar, solado por numeração) | idem |
| **PurchasePlanningWizard** | TS próprio (`PurchasePlanningWizard.tsx:414`) | **escalar, sem grade** | divisor próprio (`:434`) |

Existe ainda um quinto motor duplicado: `calculateBomForOrders`
(`src/lib/bomConsumption.ts:97`), cujas linhas 482-626 espelham manualmente 946-1217 de
`orderConsumption.ts`.

A spec [`alinhamento-motores-consumo-compras-ondas.md`](./alinhamento-motores-consumo-compras-ondas.md)
(commit `25a23f7`, 12/07/2026) já previa unificar as três telas de compra e matar o Wizard,
mas **nunca foi implementada** — não há commit de feature referenciando-a. Esta auditoria
não a substitui: mede o estrago concreto e corrige o que estiver provadamente errado, e o
laudo dirá se a unificação completa daquela spec deve ser retomada.

### Divergências candidatas já mapeadas (a confirmar com evidência)

1. **Motor duplicado TS vs SQL** — `orderConsumption.ts:640` vs
   `20260902160000_purchase-aggregators-parity.sql:75`. Fix em um não propaga ao outro.
2. **Fonte da conversão diverge** — TS converte pela largura da ficha de **componente**
   (por grupo/componente); SQL converte por `get_material_conversion_info(product_id)`
   (por produto). Mesmo material pode render números diferentes.
3. **Wizard é um terceiro número na mesma tela de compras** — escalar, sem grade, cobrindo
   só 4 componentes fixos (`PurchasePlanningWizard.tsx:467-483`): sem BOM, sem tira, sem
   fachete.
4. **Fallback de tamanho no escalar** — SQL usa `reference_size` ou hardcoded `37`
   (`20260911130000:33`); TS usa `DEFAULT_SIZE_MULTIPLIERS` (`materialConsumption.ts:238`).
5. **Dupla divisão por `dm2_per_unit`** — agregadores dividem de novo o que o `by_grade` já
   converteu (`20260902160000:1089-1093`, `:1267`), guardados apenas por `WHERE unit IS NULL`.
   Se essa coluna mudar de preenchimento, vira erro de ~100×.
6. **`color_mismatch`: OC compra, débito pula** — linhas com `matched_by='color_mismatch'`
   são descartadas no débito (`20260915110000:496`, `:534`) mas continuam somando em
   `needed_qty` no `compute_materials_per_pv`.
7. **Grade escalada só no SQL** — SQL usa `scale_grade_to_total`; o TS deriva fichas de
   `item.quantity / soma(grade)` (`materialConsumption.ts:226`). Grades BASE legadas
   (soma ≈12) divergem ([[project_sale_order_items_grade_is_base]]).
8. **Perda (`waste_pct`) em três lugares** — TS embute no conversor
   (`materialConsumption.ts:252,277`); SQL multiplica após a divisão
   (`20260902160000:250`); Wizard usa `consumption_loss_pct` da ficha
   (`PurchasePlanningWizard.tsx:390`).
9. **Largura ausente: três comportamentos** — TS devolve dm² cru + flag
   (`materialConsumption.ts:263`); Wizard exclui da OC (`:673`); **o débito não tem guard e
   baixa o número inflado** (`20260915110000:582`).
10. **Estoque líquido vs bruto** — `get_wave_material_needs` deduz `reserved_stock`
    (`20260902160000:1276`); `v_mrp_needs` usa bruto de propósito
    ([[project_v_mrp_needs_gross_is_correct]]); o débito compara contra `products.quantity`
    cru (`20260915110000:516`).

## Scope

### In scope

1. **Fase 1 — Laudo com evidência.** Rodar os quatro motores lado a lado sobre pedidos
   reais e publicar a tabela de divergências, material a material, com veredito de qual
   está certo em cada caso.
2. **Fase 2 — Correções de código.** Corrigir toda divergência com veredito, incluindo a
   eliminação/unificação do `PurchasePlanningWizard` como motor independente.
3. **Fase 3 — Ajuste de saldo pós-veredito.** Aplicar automaticamente ajustes de estoque
   **somente** nos casos em que a Fase 1 provou qual motor estava errado.
4. **Fase 4 — Anti-regressão.** Teste de paridade no CI + painel em `/diagnostics`.

### Out of scope (explicitamente agora não)

- Custeio / DRE / margem além do necessário para provar paridade de quantidades.
- Recebimento de OC, conferência de NF, fluxo fiscal.
- Cronograma de ondas / datas de compra por lead time (isso é a spec
  `alinhamento-motores-consumo-compras-ondas.md`; aqui só quantidade, não data).
- Layout de impressão, fichas de operador, etiquetas.
- Migração do projeto Supabase — continua `ssvxfoybzmjlypnipqzn`.
- Reescrita do agrupamento de OPs ou do motor de produção.

## Requirements

### Fase 1 — Laudo

1. O laudo deve comparar, para o **PV-00146**, cada material consumido pelos quatro
   caminhos, exibindo: material, unidade, quantidade do modal, quantidade da OC/MRP,
   quantidade do Wizard, quantidade debitada, e o delta absoluto e percentual.
2. O laudo deve incluir uma **varredura de todos os PVs em produção**, reportando quantos
   divergem, em quais materiais, e a magnitude (para dimensionar se o problema é sistêmico
   ou pontual).
3. Cada uma das 10 divergências candidatas listadas acima deve receber um veredito
   explícito: **confirmada** (com o PV/material que a evidencia), **falso positivo** (com o
   motivo), ou **não exercitada pelos dados** (nenhum PV atual aciona o caminho).
4. Para cada divergência confirmada, o laudo deve declarar **qual motor está certo** e por
   quê, ancorado na regra canônica do `CLAUDE.md` — não em qual motor é mais novo.
5. Divergência dentro de **1%** é ruído de arredondamento e não conta como achado
   (mesma tolerância da spec `auditoria-debito-ficha-grade.md`).

### Fase 2 — Correções

6. Toda divergência com veredito "confirmada" deve ser corrigida, com a causa raiz
   explicada antes do fix.
7. O `PurchasePlanningWizard` deve deixar de ter motor próprio: ou passa a consumir a RPC
   canônica, ou a tela é removida em favor do caminho unificado. O laudo decide qual, e a
   decisão deve constar antes da implementação.
8. **A arquitetura final (um motor ou dois com paridade travada) é recomendada pelo laudo**,
   com custo medido de cada opção — latência do modal se ele passar a depender de roundtrip,
   e número de pontos de duplicação se os dois forem mantidos. Não decidir de antemão.
9. Nenhuma correção pode quebrar as garantias já travadas por
   `run_consumption_parity_tests()` e `orderConsumption.test.ts`.
10. Toda coluna nova que o motor TS passar a ler deve entrar em
    `TECHNICAL_SHEET_CONSUMPTION_COLUMNS` — regra load-bearing do `CLAUDE.md` (a omissão de
    `sole_drives_consumption` já causou o bug do forro fantasma em 2026-07-15).

### Fase 3 — Ajuste de saldo

11. Ajuste automático é permitido **apenas** para deltas cujo veredito da Fase 1 é
    inequívoco — o caso canônico é dm² cru debitado por falta de largura, que é errado por
    definição, não por opinião.
12. Deltas onde os motores discordam **sem** veredito claro são **listados sem ajuste**.
13. Todo ajuste aplicado deve gerar `stock_movements` rastreável, com motivo identificando
    esta auditoria.
14. Deve existir um **script de reversão** que desfaz exatamente os ajustes aplicados.

### Fase 4 — OPs em curso e anti-regressão

15. Ao entrar a correção, **OPs abertas recalculam reserva** e **OCs ainda não enviadas são
    revisadas** com o motor corrigido.
16. **Débito já efetivado NÃO é estornado nem redebitado** — o material já saiu fisicamente
    do estoque; estornar criaria saldo que não existe na prateleira. Diferenças ficam para
    o ajuste pós-veredito da Fase 3.
17. Deve existir teste de paridade no CI que falhe o build quando consumo, OC e débito
    divergirem sobre os mesmos dados — estendendo o padrão existente para cobrir OC e
    débito, não só consumo.
18. Deve existir painel em `/diagnostics` (`SystemDiagnostics.tsx`) listando os PVs onde os
    três números não batem **hoje** — para pegar divergência causada por cadastro, não só
    por código.

## Data model / Domain

Entidades e funções tocadas (leitura na Fase 1; escrita a partir da Fase 2):

- `technical_sheets` — fonte do consumo por componente; colunas lidas travadas por
  `TECHNICAL_SHEET_CONSUMPTION_COLUMNS`.
- `component_sheets.dimensions_width` / `dimensions_unit` — largura que permite dm²→metro.
- `sole_technical_specs` — fonte de verdade de forro e palmilha (anti-duplicidade).
- `sheet_materials` — BOM; `material_variant_id` NULL = linha compartilhada.
- `reference_material_variants` — variante do item do PV.
- `products` (`quantity`, `reserved_stock`, `stock_grade`, `unit`, `conversion_rate`).
- `material_reservations`, `stock_movements`, `order_costs`, `orders`, `sale_order_items`.
- RPCs: `calculate_order_consumption`, `calculate_order_consumption_by_grade`,
  `compute_materials_per_pv`, `get_wave_material_needs`, `fn_projected_demand`,
  `get_material_conversion_info`, `hybrid_debit_stock_for_order`,
  `debit_sole_stock_by_grade`, `debit_strap_stock`, `try_reserve_materials`,
  `resolve_material_product`, `scale_grade_to_total`.
- Views: `v_mrp_needs`, `purchase_projection_timeline`, `report_material_needs_by_group`.

**Migrations implicadas:** correções em funções SQL de consumo/agregação; nova função de
relatório de inconsistência entre os três motores (para o painel); possíveis ajustes de
saldo via `adjust_stock`. Todas em `supabase/migrations/`, aplicadas via MCP.

## User flows

### Happy path (após a correção)

1. Usuário abre o PV e clica **Consumo de Materiais** → vê a quantidade X de cada material.
2. Clica **Gerar OCs** → a OC nasce pedindo exatamente o que falta para atingir X, líquido
   do que já existe em estoque.
3. A OP é gerada e reserva material → a reserva é de X.
4. A OP é finalizada → o débito baixa X (solado por numeração, área na unidade física).
5. Nenhuma das quatro telas mostra um número diferente para o mesmo material.

### Fluxo do laudo (Fase 1)

1. Rodar os quatro motores sobre o PV-00146; montar a tabela material a material.
2. Rodar a varredura em todos os PVs em produção; agregar por tipo de divergência.
3. Para cada candidata (1-10), buscar o caso que a exercita; emitir veredito.
4. Publicar o laudo com a recomendação de arquitetura antes de tocar em código.

### Alternate / edge flows

- Material sem largura cadastrada → hoje três comportamentos diferentes; após a correção,
  comportamento único e explícito.
- Item do PV com variante de material → precedência
  `produto legado pinado > grupo da variante (+cor do PV) > pin da ficha > grupo da ficha`
  deve valer igual nos três caminhos.
- Palmilha pronta na cor → não debita placa nem forração; os três caminhos devem concordar.
- Solado com grade conjugada (`"33/34"`) → distribuição proporcional, sem contar o mesmo
  balde duas vezes.

## Edge cases & failure modes

| Caso | Comportamento esperado |
|---|---|
| Largura ausente na ficha de componente | Comportamento **único** nos três motores; o débito **não** pode baixar dm² cru como se fosse metro. |
| `matched_by = 'color_mismatch'` | OC e débito devem concordar: ou ambos consideram, ou ambos pulam. Divergência aqui é compra de material que nunca é consumido. |
| Grade BASE legada (soma ≈ 12) vs grade real | `scale_grade_to_total` e a derivação TS de fichas devem produzir o mesmo total. |
| PV sem grade (só quantidade escalar) | Fallback de tamanho único entre SQL (`reference_size`/37) e TS (`DEFAULT_SIZE_MULTIPLIERS`). |
| `dm2_per_unit` aplicado duas vezes | Guard não pode depender de `unit IS NULL`; precisa ser estrutural. |
| OP já debitada quando a correção entra | Congela — não estorna, não redebita (R16). |
| Delta encontrado mas sem veredito | Listado no laudo, **sem** ajuste automático (R12). |
| Divergência ≤ 1% | Ignorada como arredondamento (R5). |
| Motor TS lê coluna nova não declarada | Retorna `undefined` silenciosamente (TS loose) — travado pelo guard auto-derivado do `orderConsumption.test.ts`. |

## Constraints & assumptions

- **Stack:** Vite + React + TS loose. Typecheck canônico
  `bunx tsc -p tsconfig.app.json --noEmit` — a raiz **não** checa nada.
- **Package manager:** Bun. Ícones: `@phosphor-icons/react`, nunca `lucide-react`.
- **Design tokens:** painel novo em `/diagnostics` usa tokens, não cores hardcoded;
  rodar `npm run check:tokens` após edits visuais.
- **Unidades canônicas:** conforme tabela do `CLAUDE.md`. A conversão dm²→metro **não** vai
  em `conversion_rate` — mora na largura da ficha de componente.
- **Migrations:** `supabase/migrations/`, aplicadas via Supabase MCP no projeto
  `ssvxfoybzmjlypnipqzn`.
- **Não tocar:** motor de produção/ondas, fichas de operador impressas, fluxo fiscal.
- **Assunção registrada:** a arquitetura final (um motor ou dois) foi explicitamente
  **adiada para o laudo** — a implementação da Fase 2 não pode começar antes dessa decisão.
- **Assunção registrada:** tolerância de 1% herdada da spec `auditoria-debito-ficha-grade.md`
  por consistência entre auditorias; não foi discutida na entrevista.

## Open questions

- Se a varredura mostrar que a divergência é **sistêmica** (maioria dos PVs), a Fase 3 pode
  gerar centenas de ajustes de saldo — nesse cenário, confirmar com o usuário antes de
  aplicar, mesmo nos casos com veredito claro.
- Retomar ou não a spec `alinhamento-motores-consumo-compras-ondas.md` (unificação das três
  telas de compra) depende do que o laudo mostrar sobre o Wizard.

## Definition of Done

### Fase 1 — Laudo
- [ ] R1 — Tabela do PV-00146 com os quatro números por material e o delta — verificável
      abrindo o laudo e conferindo contra o modal do PV-00146 na tela.
- [ ] R2 — Varredura de todos os PVs em produção, com contagem de divergentes por material
      — verificável rodando a query do laudo no SQL Editor.
- [ ] R3 — As 10 candidatas têm veredito explícito (confirmada / falso positivo / não
      exercitada) — verificável lendo a seção de vereditos.
- [ ] R4 — Cada confirmada declara qual motor está certo, com âncora no `CLAUDE.md`.
- [ ] R5 — Nenhum achado reportado com delta ≤ 1%.

### Fase 2 — Correções
- [ ] R6 — Cada confirmada tem commit com causa raiz na mensagem.
- [ ] R7 — `PurchasePlanningWizard` não tem mais cálculo de consumo próprio — verificável
      por `grep` de `consumptionPerPair`/`areaToStockDivisor` no arquivo (deve sumir) ou
      pela ausência da tela.
- [ ] R8 — O laudo contém a recomendação de arquitetura com custo medido, e a implementação
      seguiu ela.
- [ ] R9 — `run_consumption_parity_tests()` e `bun run test` verdes.
- [ ] R10 — Guard auto-derivado do `orderConsumption.test.ts` passa.
- [ ] Typecheck limpo: `bunx tsc -p tsconfig.app.json --noEmit`.

### Fase 3 — Ajuste de saldo
- [ ] R11 — Ajustes aplicados apenas em casos com veredito inequívoco — verificável
      cruzando a lista de ajustes com a seção de vereditos.
- [ ] R12 — Casos ambíguos aparecem no laudo marcados "sem ajuste".
- [ ] R13 — `SELECT * FROM stock_movements WHERE reason LIKE '%auditoria%'` mostra todos os
      ajustes com rastro.
- [ ] R14 — Script de reversão existe e foi testado (aplicar → reverter → saldo volta ao
      valor original).

### Fase 4 — OPs em curso e anti-regressão
- [ ] R15 — OP aberta recalcula reserva após a correção — verificável abrindo uma OP em
      produção e conferindo `material_reservations`.
- [ ] R16 — Nenhum `stock_movements` de estorno de débito foi gerado pela correção.
- [ ] R17 — Teste de paridade consumo↔OC↔débito no CI; falha o build ao introduzir
      divergência proposital (verificável quebrando um valor de propósito).
- [ ] R18 — Painel em `/diagnostics` lista PVs divergentes hoje — verificável abrindo a
      tela e conferindo que o PV-00146 aparece (ou não aparece, se já corrigido).
