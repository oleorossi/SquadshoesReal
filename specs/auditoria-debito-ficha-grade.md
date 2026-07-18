# Auditoria: débito de estoque por ficha técnica × grade do pedido

## Goal
Auditar de ponta a ponta se o estoque debitado pelas OPs corresponde exatamente ao que a
ficha técnica de cada referência do pedido manda consumir, calculado pelas grades
(numerações) do pedido — cobrindo o código dos motores (TS + SQL) **e** os dados reais de
produção. Bugs confirmados nos motores são corrigidos; divergências em dados históricos são
apenas listadas de forma reproduzível.

## Background / Problem
O fluxo PV → OP → reserva → débito → (cancelamento/restauração) passa por vários motores que
já divergiram no passado (dm² tratado como metro ~100×, forro contado 2×, débito de solado
quebrado na janela 02–09/07, reservas vazadas). As regras canônicas estão documentadas no
`CLAUDE.md`, mas não há garantia de que **todos** os caminhos de débito as respeitam hoje,
nem visibilidade contínua de quando um débito real diverge do esperado. O dono precisa de:
(1) confiança de que o motor atual debita certo, (2) lista viva do que já foi debitado
errado.

## Scope

### In scope
- **Código dos motores (fonte de verdade = banco vivo, não arquivos de migration):**
  - TS: `src/lib/orderConsumption.ts` (motor unificado modal + fichas de operador),
    `src/lib/bomConsumption.ts` (Lista de Separação), `src/lib/materialConsumption.ts`
    (conversões dm²→m/placa), constante `TECHNICAL_SHEET_CONSUMPTION_COLUMNS`.
  - SQL (ler via `pg_get_functiondef` do banco `ssvxfoybzmjlypnipqzn`):
    `calculate_order_consumption`, `calculate_order_consumption_by_grade`,
    `hybrid_debit_*`, `debit_sole_stock_by_grade`, `debit_strap_stock`,
    `try_reserve_materials`, `release_order_reservations` + triggers de sincronismo
    (`tg_sync_reserved_stock*`), `resolve_*_material_for_variant`,
    `resolve_sole_for_variant`, `get_material_conversion_info`, `get_effective_bom`,
    `get_sole_size_key` (conjugados) e restauração de `stock_grade` no cancelamento.
- **Todos os componentes do débito:** solado por numeração (incl. conjugados e baixa
  parcial), cabedal/forro/palmilha (conversão dm²→unidade física pela largura da ficha de
  componente; forro dirigido pelo solado; anti-duplicidade `suppressCabedalForracao`),
  tiras (cm/par, PAR vs PÉ), fachete, BOM `sheet_materials` (incl. cola/aviamentos),
  embalagem, resolução de variante de material e cor do PV.
- **Ciclo de vida completo da OP:** reserva na criação, débito real no envio à produção,
  restauração no cancelamento, consistência em retries/edições (débito duplo, reserva
  vazada, snapshot de ficha desatualizado — incl. o gap conhecido das 4 tabelas
  `*_colors` sem invalidação de snapshot).
- **Motor de pedidos — PV → OP:** escala da grade base (`sale_order_items.grade` = 1 ficha,
  ~12 pares) para grade real e `quantity`, propagação de variante de material
  (`material_variant_id`), cor e `sale_order_item_id` — a OP tem que nascer com os números
  certos antes de qualquer débito.
- **Auditoria de dados reais:** recalcular o consumo esperado (ficha × grade, regras
  canônicas) de todas as OPs com débito nos **últimos 60 dias** + casos conhecidos
  (PV-00146; janela quebrada de solado 02–09/07/2026) e comparar com `stock_movements`.
  Inclui OPs avulsas (sem PV).
- **Correção de código:** bugs confirmados nos motores TS/SQL são corrigidos nesta
  auditoria, com guarda de regressão para todo fix.
- **Relatório:** doc markdown + função SQL reproduzível exposta em /diagnostics.

### Out of scope (explicitamente não agora)
- Correção de **saldos** de estoque afetados por débitos históricos errados — apenas
  listar; ajuste fica para decisão posterior, caso a caso.
- Máquina de status PV/OP (transições e efeitos colaterais além do trio
  reserva/débito/restauração).
- Paridade consumo × custeio (`calculate_order_cost` / snapshot `order_costs`) — só entra
  se um achado de débito depender dela.
- Varredura histórica completa (anterior aos 60 dias), exceto os casos conhecidos citados.
- Mudanças de UI além da exposição do relatório em /diagnostics.

## Requirements
1. **Auditoria de código:** cada função/motor listado no escopo é lido (SQL: definição viva
   no banco; TS: fonte no repo) e confrontado com a regra canônica do `CLAUDE.md`
   (conversão dm²→física pela largura, forro do solado, anti-duplicidade, solado por
   numeração, conjugados, variante, palmilha pronta, unidades canônicas). Toda divergência
   vira achado com evidência (trecho da função + regra violada) e severidade.
2. **Auditoria PV → OP:** verificar que grade real, `quantity`, variante, cor e vínculo
   `sale_order_item_id` das OPs geradas batem com o item do PV (escala grade base → real).
   Divergência = achado.
3. **Auditoria de dados:** para toda OP com débito nos últimos 60 dias + casos conhecidos,
   recalcular o consumo esperado por material (ficha × grade, regras canônicas) e comparar
   com o total debitado em `stock_movements` por OP × produto.
4. **Critério de divergência:** diferença relativa > 1% **ou** material esperado não
   debitado **ou** material debitado sem previsão na ficha, com piso absoluto de 0,01 na
   unidade do produto. Abaixo disso = arredondamento legítimo (estoque usa `round(,4)`),
   não entra no relatório.
5. **Ciclo de vida:** verificar, por amostragem nos mesmos 60 dias, que (a) OP cancelada
   restaurou `stock_grade` e liberou reserva sem drift de `reserved_stock`; (b) não há
   débito duplicado da mesma OP × produto em `stock_movements`; (c) OPs em aberto têm
   reserva viva coerente com o consumo esperado.
6. **Fixes de código:** todo bug confirmado nos motores é corrigido — TS no repo; SQL via
   migration idempotente em `supabase/migrations/` **aplicada imediatamente via MCP** no
   banco de produção, com verificação pós-aplicação.
7. **Guarda de regressão para todo fix:** TS → teste vitest ao lado do motor; SQL →
   estender `run_consumption_parity_tests()` ou criar guard equivalente de débito.
8. **Relatório vivo:** função SQL `debit_consistency_report()` (nome definitivo pode
   seguir o padrão de `consumption_consistency_report()`) que reproduz a comparação
   esperado × debitado a qualquer momento, exposta na página /diagnostics.
9. **Relatório doc:** `docs/AUDITORIA_DEBITO_FICHA_GRADE_2026-07-18.md` com todos os
   achados (código + dados), evidência, severidade, o que foi corrigido (commit/migration)
   e o que ficou pendente de decisão (divergências históricas).
10. **Severidade padronizada:** CRÍTICO = débito errado de valor/material acontecendo hoje;
    ALTO = vazamento de reserva/restauração ou drift; MÉDIO = aviso/diagnóstico
    faltando; BAIXO = hardening defensivo.

## Data model / Domain
- **Entidades:** `sale_orders` / `sale_order_items` (grade base, `quantity` real,
  `material_variant_id`, cor), `orders` (OP; `sale_order_item_id`, `stock_grade` no
  produto solado), `technical_sheets` (+ `*_consumption_per_size`, flags
  `insole_ready_made`, `sole_drives_consumption`), `sole_technical_specs`,
  `component_sheets` (largura → conversão), `sheet_materials` (BOM, `material_variant_id`
  NULL = compartilhada), `reference_material_variants`, `products`
  (`quantity`, `reserved_stock`, `stock_grade`, `unit`, `color`), `product_groups`,
  `material_reservations`, `stock_movements`, `sole_size_conjugations`.
- **Unidades:** lista canônica do `CLAUDE.md` (m, dm², un, par, placa, kg, L…);
  `purchase_unit == unit ⇒ conversion_rate = 1`; conversão dm²→m mora na **largura da
  ficha de componente**, nunca em `conversion_rate`.
- **Migrations implicadas:** possíveis fixes em funções de débito/reserva + a nova
  `debit_consistency_report()`. Todas idempotentes, aplicadas via MCP e commitadas em
  `supabase/migrations/`.

## User flows
### Happy path (o fluxo que a auditoria valida)
1. PV criado com itens (referência, cor, variante, grade base × quantidade real).
2. Geração de OPs: cada OP nasce com grade real escalada, quantity, variante, cor e
   `sale_order_item_id` corretos.
3. Criação da OP reserva materiais (`try_reserve_materials` → `reserved_stock` sobe via
   trigger).
4. Envio à produção debita: solado por numeração via `stock_grade` (conjugados
   distribuídos), materiais de área convertidos dm²→física pela largura, tiras por cm/par,
   BOM conforme `get_effective_bom` + variante, forro/palmilha dirigidos pelo solado sem
   duplicidade, palmilha pronta sem débito de placa/forração.
5. `stock_movements` registra cada débito 1× por OP × produto; reserva é consumida.
6. Cancelamento (quando ocorre) restaura `stock_grade` e libera reserva sem drift.

### Alternate / edge flows
- OP avulsa (sem PV) → mesmo débito por ficha × grade, sem resolução de variante do PV.
- Retry de envio (erro no meio) → advisory lock + dedup impedem débito 2×.
- Ficha editada após OP criada → identificar qual versão o débito usou (snapshot × vivo) e
  se as tabelas `*_colors` invalidam o que deveriam.

## Edge cases & failure modes
- **Conjugado "33/34"** existente no `stock_grade` → debita a chave conjugada; inexistente
  → fallback para chaves individuais. Nunca contar o mesmo balde 2×.
- **Baixa parcial de solado** → `LEAST(disponível, necessário)` por tamanho; o não-debitado
  precisa ficar visível (não sumir em silêncio).
- **Palmilha pronta** (`insole_ready_made` OU `sole_classification='palmilha_pronta'`) →
  não debita placa nem forração de palmilha.
- **Anti-duplicidade forro:** `insole_lining_consumption_dm2 > 0` + `lining_consumption_dm2`
  nulo + `sole_drives_consumption = true` → NÃO emitir linha "Forração" (cabedal).
- **Ficha de área sem largura** → não converter; flag `widthMissing`; débito nesse estado é
  achado CRÍTICO (valor ~100× inflado).
- **Cor não resolvida** → `hybrid_debit` PULA (não debita cor errada); o pulo tem que ser
  reportado, não silencioso.
- **Variante com `available_colors` vazio** → deriva cores do grupo; débito deve usar o
  material do grupo da variante, não o da ficha.
- **Grade do PV com números fora do range do solado** → como o motor trata (bloqueia,
  ignora, debita média?) — comportamento verificado e documentado.
- **`conversion_rate = 0` ou unidade não canônica** em produto debitado → achado.
- **OP cancelada com débito já feito** → estorno/restauração completa (grade + reserva);
  drift de `reserved_stock` = achado ALTO.
- **Janela histórica 02–09/07** (débito de solado quebrado, 22P02) → OPs dessa janela
  entram na amostra com atenção especial: débitos ausentes esperados.

## Constraints & assumptions
- **Verdade = banco vivo** (`pg_get_functiondef`), não os arquivos de migration
  (memória: Action de migrate quebrada; funções já divergiram dos arquivos).
- Typecheck canônico: `bunx tsc -p tsconfig.app.json --noEmit` (root não checa nada).
  Package manager: Bun. Testes: `bun run test` / `bun run test:units`.
- **Não reintroduzir** UPDATE manual de `reserved_stock` (trigger `tg_sync_reserved_stock`
  já sincroniza — UPDATE manual causa duplo-decremento).
- `v_mrp_needs` usa estoque BRUTO **por decisão** — não "corrigir" isso de tabela.
- Nomes de trigger respeitam ordem alfabética (`tg_` < `trg_`) quando a ordem importa.
- `unaccent` vive no schema `extensions` — qualificar no `search_path` das funções.
- Comparações de quantidade sempre com tolerância (dízimas, `round(,4)`) — nunca igualdade
  exata.
- Migrations idempotentes; aplicadas via MCP em `ssvxfoybzmjlypnipqzn` e commitadas.
- Toda coluna nova que o motor TS passar a ler entra em
  `TECHNICAL_SHEET_CONSUMPTION_COLUMNS` (guard auto-derivado já trava isso).
- Design tokens em qualquer UI nova de /diagnostics; `npm run check:tokens` após edits
  visuais.
- **Assumido (usuário delegou):** janela de 60 dias contada de 2026-07-18 para trás;
  severidade conforme Requirement 10; nome da função de relatório segue o padrão existente
  de `consumption_consistency_report()`.

## Open questions
- Nenhuma bloqueante. (Divergências históricas encontradas geram lista para o usuário
  decidir ajuste de saldo depois — por design, não é pergunta em aberto da spec.)

## Definition of Done
- [ ] Req 1 — Doc lista cada motor auditado (TS e SQL) com veredito conforme/divergente e
      evidência; verificável lendo `docs/AUDITORIA_DEBITO_FICHA_GRADE_2026-07-18.md`.
- [ ] Req 2 — Consulta de conferência PV → OP (grade/quantity/variante/cor) incluída no
      relatório com resultado por OP dos últimos 60 dias; divergências viram achados.
- [ ] Req 3+4 — `debit_consistency_report()` roda no banco e retorna, por OP × produto:
      esperado, debitado, delta relativo e classificação (ok / divergente / material
      faltando / material extra), aplicando tolerância 1% + piso 0,01.
- [ ] Req 5 — Relatório inclui seção de ciclo de vida: OPs canceladas com restauração
      incompleta, débitos duplicados e reservas órfãs nos 60 dias (cada lista pode ser
      vazia — mas a checagem tem que ter rodado e constar no doc).
- [ ] Req 6 — Todo bug CRÍTICO/ALTO confirmado tem fix commitado (TS) e/ou migration
      aplicada via MCP com verificação pós-aplicação registrada no doc.
- [ ] Req 7 — Cada fix tem teste: `bun run test:units` verde incluindo os testes novos;
      guards SQL atualizados e listados no doc.
- [ ] Req 8 — /diagnostics exibe o resultado de `debit_consistency_report()`;
      verificável abrindo a página em produção após deploy.
- [ ] Req 9 — Doc final existe, com achados numerados, severidade, status
      (corrigido/pendente) e a lista de divergências históricas para decisão posterior.
- [ ] Typecheck (`bunx tsc -p tsconfig.app.json --noEmit`) e `bun run test` verdes;
      `npm run check:tokens` limpo se houver UI nova.
- [ ] Commit + push feitos (pipeline auto-deploy da main).
