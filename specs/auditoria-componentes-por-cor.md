# Auditoria do motor "Componentes por Cor" (cor predominante)

## Goal
Verificação preventiva, de ponta a ponta, de que o motor "Componentes por Cor"
(componentes avulsos que variam conforme a cor predominante do pedido) resolve o
SKU certo por cor em **todas** as superfícies — consumo, reserva, débito,
estorno, custeio e compras — antes do usuário configurar as demais cores da DS22
e passar a depender dele. Além do laudo, a auditoria deixa **guarda-corpos
permanentes** (função de diagnóstico em /diagnostics + teste de paridade SQL↔TS)
para impedir regressão silenciosa.

## Background / Problem
- Feature entregue em 2026-07-04 (modelo original DS05): opt-in por ficha via
  `technical_sheets.component_colors_enabled`; mapeamento curado em
  `technical_sheet_component_colors (sheet_id, cabedal_color, product_id,
  quantity_per_unit)` — 1 cor → N linhas, cada cor lista TUDO (quando há linha
  pra cor, a lista padrão `direct_components` é IGNORADA).
- Gate em lockstep SQL + TS: SQL só em `calculate_order_consumption_by_grade`
  (o escalar é wrapper dela); TS em `src/lib/orderConsumption.ts`
  (`componentColorMap` no ctx). Source da linha: `component_color` (registrado
  em `CONSUMPTION_SOURCES` no `consumptionService.ts`).
- Débito (`hybrid_debit_stock_for_order`) baixa por `product_id` sem mudança —
  a corretude do débito depende inteiramente do consumo ter resolvido o SKU certo.
- A DS22 acabou de ligar a flag; só **1 de 7 cores** tem lista própria. Histórico
  do projeto: divergência SQL↔TS já causou bug de 100× no consumo — daí o
  guarda-corpo de paridade.
- Não houve incidente: é auditoria **preventiva**.

## Scope

### In scope
1. **Teste ponta-a-ponta com a DS22** em banco de produção (autorizado), com
   dados de teste claramente rotulados e **estornados/removidos ao final**:
   - PV de teste numa **cor configurada** → lista por cor em todas as superfícies.
   - PV de teste numa **cor sem configuração** → fallback silencioso pro PADRÃO
     em todas as superfícies (comportamento correto por design).
   - Superfícies verificadas em cada caso:
     a. Consumo TS (motor do modal — `orderConsumption.ts`);
     b. Consumo SQL (`calculate_order_consumption_by_grade` + wrapper escalar),
        lendo as funções **vivas no banco** (verdade = banco, não os arquivos
        de migration);
     c. Custeio (`calculate_order_cost` / `order_costs`) — SKU e preço da cor certa;
     d. Reserva (`try_reserve_materials` + sync de `products.reserved_stock`
        via trigger);
     e. Débito (`hybrid_debit_stock_for_order` + linhas em `stock_movements`);
     f. Estorno (cancelar OP → estoque restaurado + reservas liberadas, drift 0);
     g. Compras caminho 1: MRP / OC automática (`v_mrp_needs`);
     h. Compras caminho 2: Compras por Pedido (`compute_materials_per_pv` /
        OC `source_type='per_pv'`).
2. **Checagem de integridade em TODAS as fichas** com
   `component_colors_enabled = true` (DS05, DS22 e o que mais existir):
   - mapeamento apontando pra produto deletado/inexistente/inativo;
   - `cabedal_color` que não existe (mais) entre as cores do grupo predominante;
   - `quantity_per_unit <= 0` ou NULL;
   - grafia da cor divergente da cor do grupo além de acento/caixa (o match é
     accent/case-insensitive — só divergência REAL é achado);
   - linha duplicada (mesma ficha + cor + produto);
   - flag ligada com **zero** cores configuradas;
   - flag ligada com `cor_predominante_id` NULL (painel e harmonizações caem
     em empty state).
3. **Guarda-corpos permanentes** (migration + código):
   - Função SQL de diagnóstico (ex.: `component_colors_consistency_report()`),
     nos moldes de `consumption_consistency_report()`, exposta na página
     **/diagnostics**;
   - **Teste de paridade** travando o contrato do gate: SQL e TS resolvem o
     MESMO conjunto de componentes para (cor configurada, cor sem configuração,
     cor com variação de acento/caixa). Preferência: estender
     `run_consumption_parity_tests()` + wrapper vitest existente
     (`consumptionService.parity.test.ts`, skip sem `RUN_DB_INTEGRATION`).
     ⚠ O CI (`weekly-units.yml`, role `ci_parity`) **asserta a contagem de
     cases** (hoje 9) — adicionar cases exige atualizar esse assert junto.
4. **Correção na mesma sessão**: bug real encontrado → explicar causa raiz +
   plano, aplicar o fix (migration via MCP / código) em seguida, e cobri-lo no
   guarda-corpo. Só decisões de PRODUTO (mudança de comportamento visível ao
   usuário) esperam aprovação.

### Out of scope (explicitamente não agora)
- Separar as linhas fundidas no modal de consumo (quirk conhecido: o motor TS
  agrega por grupo+cor+unidade, então 2 ABS do mesmo grupo sem cor FUNDEM numa
  linha somada com o nome do 1º; o débito por `product_id` continua correto).
  Documentar como comportamento esperado, não "consertar".
- Aviso de "cor usando fallback" no modal/ficha — usuário decidiu que fallback
  silencioso é o design correto (achado só se o fallback NÃO acontecer).
- Configurar as 6 cores restantes da DS22 (entrada de dados do usuário).
- Recalcular snapshots congelados de `order_costs` de PVs antigos (gotcha
  conhecido: corrigir ficha não conserta snapshot). Apenas sinalizar se um
  snapshot velho confundir a verificação.

## Requirements
Cada item é um "must", verificável isoladamente.

1. **Consumo TS — cor configurada:** para PV de teste da DS22 na cor
   configurada, o motor do modal lista os componentes da lista POR COR
   (source `component_color`), com qtd = `quantity_per_unit × pares`, e NÃO
   lista os itens do padrão que não estejam na lista da cor.
2. **Consumo SQL — cor configurada:** `calculate_order_consumption_by_grade`
   (função viva no banco) retorna os mesmos `product_id`s e quantidades do
   requisito 1 para a mesma OP.
3. **Custeio:** `calculate_order_cost` precifica os componentes pelo SKU da
   cor (preço do produto certo), e o breakdown em `order_costs` referencia
   esses `product_id`s.
4. **Reserva:** `try_reserve_materials` cria `material_reservations` para os
   `product_id`s da cor, e `products.reserved_stock` desses SKUs incrementa
   exatamente a quantidade reservada (sync via trigger — sem drift).
5. **Débito:** `hybrid_debit_stock_for_order` baixa `products.quantity` dos
   SKUs da cor, gera `stock_movements` correspondentes, e NÃO toca nos SKUs
   do padrão que não pertencem à lista da cor.
6. **Estorno:** cancelar a OP de teste devolve `products.quantity` e
   `products.reserved_stock` de TODOS os SKUs afetados ao baseline capturado
   antes do teste (comparação exata, tolerância só de arredondamento a 4 casas).
7. **Compras — MRP:** as linhas de necessidade (`v_mrp_needs`) geradas pelo PV
   de teste apontam para o `product_id` da cor (não do fallback), com a
   necessidade coerente com o consumo calculado.
8. **Compras — por Pedido:** `compute_materials_per_pv` do PV de teste lista o
   SKU da cor com quantidade e unidade corretas.
9. **Fallback:** requisitos 1–8 repetidos com PV numa cor SEM lista própria
   resolvem para a lista PADRÃO (`direct_components`), silenciosamente, em
   todas as superfícies.
10. **Integridade:** a checagem do escopo 2 roda em todas as fichas com a flag
    e cada categoria de dado quebrado listada é reportada com ficha + cor +
    produto + problema.
11. **Diagnóstico permanente:** a função de consistência existe no banco
    (migration commitada em `supabase/migrations/` E aplicada via MCP) e
    aparece em /diagnostics com resultado legível.
12. **Paridade permanente:** os cases de paridade componente-por-cor rodam
    verde (SQL ≡ TS para cor configurada, sem configuração, e variação de
    acento/caixa), e o assert de contagem do CI foi atualizado em conjunto.
13. **Limpeza:** nenhum dado de teste sobra — PVs/OPs de teste cancelados ou
    excluídos, reservas zeradas, movimentos estornados; baseline == estado final.
14. **Qualidade:** `bunx tsc -p tsconfig.app.json --noEmit` limpo;
    `bun run test` (suites relevantes) verde; `npm run check:tokens` limpo se
    /diagnostics for tocada; commit + push ao final.
15. **Bugs achados:** cada um com causa raiz explicada ANTES do fix, fix
    aplicado, e regressão coberta por guarda-corpo (case de paridade ou linha
    do relatório de consistência) quando aplicável.

## Data model / Domain
Entidades envolvidas (nenhuma mudança de schema além da função de diagnóstico):

- `technical_sheets`: `component_colors_enabled` (bool, default false),
  `cor_predominante_id` (⚠ FK para `product_groups`, NÃO para colors — é o
  grupo do material do cabedal que carrega as cores do modelo, ex.: NAPA SUDANI).
- `technical_sheet_component_colors`: `sheet_id`, `cabedal_color` (texto, match
  accent/case-insensitive via `extensions.unaccent` qualificado — search_path é
  public), `product_id`, `quantity_per_unit`. RLS espelha
  `technical_sheet_lining_colors` (is_approved_user).
- `sale_order_items.color`: a cor predominante escolhida no PV — chave do gate.
- `products`: `quantity`, `reserved_stock`, `group_id`, `color`, `unit` (un).
- `stock_movements`, `material_reservations`, `order_costs`, `v_mrp_needs`,
  `purchase_orders (source_type='per_pv')`.

Migrations implícitas: **1 nova** (função de diagnóstico + cases de paridade,
ou 2 se ficar mais limpo separar). Aplicar via **Supabase MCP** (o GitHub
Action de migrate está quebrado — push comentado + senha inválida); arquivo
fica commitado em `supabase/migrations/` para histórico.

## User flows

### Happy path (execução da auditoria)
1. Descobrir estado real: fichas com flag ligada, cores configuradas da DS22
   (qual é a 1/7), SKUs envolvidos; **capturar baseline** de
   `quantity`/`reserved_stock` desses SKUs.
2. Ler as funções SQL **vivas** no banco (`pg_get_functiondef`) — não confiar
   nos arquivos de migration — e revisar o gate TS (`orderConsumption.ts`,
   `consumptionService.ts`, `useComponentColorMappings.ts`).
3. Rodar a checagem de integridade (escopo 2) em todas as fichas com a flag.
4. Criar PV de teste da DS22 na cor configurada (rotulado "TESTE AUDITORIA");
   verificar superfícies a–h do escopo 1 na ordem consumo → custeio → reserva
   → débito → compras.
5. Repetir com PV na cor sem configuração (fallback).
6. Estornar tudo (cancelar OPs/PVs, conferir baseline restaurado — isso JÁ
   testa o requisito 6).
7. Escrever migration do diagnóstico + cases de paridade; expor em
   /diagnostics; atualizar assert do CI; rodar testes.
8. Corrigir bugs achados (causa raiz primeiro), re-rodar as verificações
   afetadas.
9. Relatório final: o que foi verificado, achados, fixes, e o que ficou de
   guarda-corpo.

### Alternate / edge flows
- **Bug encontrado no meio do fluxo** (ex.: débito baixou SKU errado): parar a
  cadeia, explicar causa raiz, corrigir, estornar o efeito errado, re-executar
  a superfície desde o passo anterior.
- **Cor configurada da DS22 sem estoque no SKU mapeado:** ainda dá pra validar
  resolução/consumo/reserva/compra; débito parcial vira observação, não bloqueio.
- **Snapshot de custo congelado confunde a leitura:** recalcular custo do PV de
  teste (não de PVs históricos) e seguir.

## Edge cases & failure modes
- **Cor do PV sem linha própria** → fallback silencioso pro PADRÃO em TODAS as
  superfícies (correto por design; achado só se divergir entre superfícies).
- **Cor com acento/caixa diferente** (ex.: "Café" no PV vs "CAFE" no
  mapeamento) → DEVE casar (unaccent no SQL, `normalizeColorKey` no TS); não
  casar = bug.
- **Flag ligada + zero mapeamentos** → tudo cai no padrão (funciona); relatório
  de integridade lista como pendência de cadastro.
- **Flag ligada + `cor_predominante_id` NULL** → painéis em empty state;
  relatório de integridade acusa.
- **Mapeamento → produto deletado/inativo** → comportamento do motor deve ser
  documentado (linha ignorada? erro?); relatório de integridade acusa sempre.
- **`quantity_per_unit` = 0/NULL** → consumo zero silencioso; relatório acusa.
- **Linha duplicada (ficha+cor+produto)** → risco de consumo dobrado; verificar
  se o motor soma ou deduplica; relatório acusa.
- **2 componentes do mesmo grupo sem cor fundem no modal** → quirk conhecido e
  aceito (débito por product_id correto); documentar, não corrigir.
- **OP com grade vs item escalar** → wrapper escalar delega pra by_grade; os
  dois caminhos devem dar o mesmo resultado por par.
- **Concorrência de sessão** (worktree compartilhado / stop hook) → commits da
  auditoria não podem empacotar arquivos de outra sessão (`git add` seletivo).

## Constraints & assumptions
- **Banco é produção.** Dados de teste rotulados e 100% revertidos; débitos só
  em SKUs com movimentação reversível; nada de mexer em PVs reais de cliente.
- Migrations: aplicar via **Supabase MCP**; arquivo em `supabase/migrations/`.
- Verdade = **banco** (funções vivas), não arquivos de migration.
- Typecheck canônico: `bunx tsc -p tsconfig.app.json --noEmit` (a raiz não
  checa nada). Package manager: **Bun**.
- Domínio em pt-BR; ícones `@phosphor-icons/react`; toasts `sonner`; design
  tokens (nada de cor hardcoded em /diagnostics); `unaccent` sempre qualificado
  `extensions.unaccent`.
- Triggers novos: atenção à ordem alfabética (`tg_` < `trg_`) se algum for criado.
- Comparações de estoque com `round(...,4)` — não comparar float exato (dízimas
  de alta precisão existem no estoque).
- Não tocar: fichas de impressão/worksheets; agregação visual do modal.
- **Defaults escolhidos onde o usuário delegou:**
  - Nome da função de diagnóstico: `component_colors_consistency_report()`
    (seguindo o padrão existente).
  - Paridade: estender `run_consumption_parity_tests()` em vez de criar função
    nova, mantendo um único ponto de entrada no CI (e atualizando o assert de
    contagem de cases).
  - PVs de teste: 1 par ou 1 grade mínima, cliente de teste, nota "TESTE
    AUDITORIA — pode excluir".

## Open questions
- Nenhuma bloqueante. (Qual das 7 cores da DS22 está configurada é descoberto
  no banco no passo 1, não precisa do usuário.)

## Definition of Done
- [ ] Req. 1–2: PV de teste na cor configurada — motor TS e função SQL viva
      retornam o MESMO conjunto de `product_id`/qtd da lista por cor; provado
      com a saída lado a lado no relatório.
- [ ] Req. 3: `order_costs` do PV de teste referencia os SKUs da cor com o
      preço deles — conferível via query no breakdown.
- [ ] Req. 4: `material_reservations` + delta de `reserved_stock` batem com o
      consumo calculado (query antes/depois).
- [ ] Req. 5: `stock_movements` do débito listam só os SKUs da cor; delta de
      `products.quantity` bate (query antes/depois, round 4 casas).
- [ ] Req. 6 e 13: após estorno/limpeza, snapshot final == baseline para todos
      os SKUs afetados (query de diff vazia) e nenhum PV/OP/OC de teste restante.
- [ ] Req. 7–8: linhas de `v_mrp_needs` e `compute_materials_per_pv` do PV de
      teste apontam pro SKU da cor — conferível por query.
- [ ] Req. 9: mesma bateria com cor sem configuração resolve o PADRÃO em todas
      as superfícies (saídas no relatório).
- [ ] Req. 10–11: `component_colors_consistency_report()` existe no banco,
      migration commitada, e /diagnostics exibe o resultado — verificável
      abrindo a página.
- [ ] Req. 12: `run_consumption_parity_tests()` inclui os cases novos e passa;
      assert de contagem do CI atualizado; wrapper vitest roda com
      `RUN_DB_INTEGRATION`.
- [ ] Req. 14: typecheck limpo + testes verdes + check:tokens (se UI mudou) +
      commit e push feitos.
- [ ] Req. 15: relatório final lista cada achado com causa raiz, fix aplicado
      e guarda-corpo que o cobre (ou "nenhum bug encontrado").
