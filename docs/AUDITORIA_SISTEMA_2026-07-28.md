# Auditoria Completa do Sistema (frontend + backend) — 2026-07-28

**Escopo:** todas as funcionalidades — motor de consumo (TS e SQL), estoque/reservas/débitos,
produção/ondas/setores (pós-split da Costura), impressão de fichas, financeiro/compras, RH/ponto,
rotas/permissões/UI, camada de dados (React Query) e **integridade de dados no banco de produção**
(`ssvxfoybzmjlypnipqzn`), além de segurança (advisors Supabase) e infraestrutura de deploy.

**Metodologia:** 10 auditores de área independentes + **verificação adversarial** (cada achado
critical/high verificado individualmente por um agente cético instruído a REFUTÁ-LO; mediums
verificados em lote por área) — 40 agentes no total, ~1.350 operações de leitura/queries.
Achados de área `Banco vivo` foram confirmados por queries no banco de produção.
Complementado por checagens estáticas canônicas e diagnóstico de advisors do Supabase.

**Resultado bruto:** 73 achados dos agentes → 69 únicos após deduplicação, + 4 achados do orquestrador = 73 no relatório →
**1 crítico, 12 altos, 32 médios confirmados**, 6 baixos confirmados,
17 baixos não verificados individualmente, 5 refutados na verificação (§6).

---

## 0. Estado geral — o que está saudável

| Checagem | Resultado |
|---|---|
| `bunx tsc -p tsconfig.app.json --noEmit` (canônico) | ✅ limpo |
| Suíte completa (`bun run test`) | ✅ 1.272 testes verdes (89 arquivos, 3 skips) |
| Suíte de unidades (`bun run test:units`) | ✅ 76 verdes |
| Navegação ↔ acesso (`NavigationAccessConsistency`) | ✅ 115 verdes |
| Design tokens (`check:tokens`) | ✅ zero violações |
| Imports de `lucide-react` | ✅ zero |
| CI (GitHub Actions) e deploy Vercel | ✅ verdes (runs de 27/07) |
| Migrations recentes aplicadas no vivo | ✅ (sondagem §7.3) |
| Paridade SQL de consumo (`run_consumption_parity_tests`) | ✅ existe e passa (área SQL) |

O núcleo do sistema está **operacional e coberto por testes**. Os problemas graves se concentram em
(1) **integridade de dados históricos** no banco vivo (furos de débito de estoque) e
(2) **rescaldo do split da Costura** (mig `20261001120000`): a migration renomeou os setores mas
**dezenas de consumidores SQL e TS não foram atualizados** — é o tema de ~metade dos achados altos/médios.

---

## 1. Crítico

### C1. [Banco vivo] 184 OPs finalizadas com consumo esperado e débito de estoque ZERO (R$ ~225 mil estimado)

- list_stock_debit_holes() reporta 1.172 linhas de 'consumo_sem_debito' em 184 OPs com status 'Finalizado': o consumo padrão foi calculado mas nenhum débito foi registrado (actual_quantity=0). Inclui solados por grade (ex.: solado '01' SL01-02: 1.248 pares na OP-2026-01167/PV-00146, 1.104 na OP-2026-01142/PV-00145), napas em metros, caixas de embalagem e tiras. Efeito: products.quantity fica superestimado, disponibilidade verde falsa no modal de consumo, e o custeio real (débitos) subestimado. Do valor total, ~R$140 mil vem de 2 linhas infladas pela ficha CF 09 errada (achado seguinte); mesmo excluindo-as sobram ~R$85,7 mil de furos reais. As detecções são recentes (jul/2026), ou seja, o fluxo de débito ainda está deixando buracos em produção.
- **Evidência:** SELECT origem, COUNT(*), COUNT(DISTINCT order_id), SUM(valor_estimado) FROM list_stock_debit_holes() → {origem: 'consumo_sem_debito', linhas: 1172, ops: 184, valor_total: 225736.46}. Amostra: OP-2026-01167 (PV-00146, DS21, status Finalizado) produto '01' (par): standard_quantity 1248.0000, actual_quantity 0.0000, detectado_em 2026-07-22.
- **Verificação adversarial:** Reproduzi a evidência no banco vivo (project ssvxfoybzmjlypnipqzn) e ela bate exatamente: `SELECT origem, COUNT(*), COUNT(DISTINCT order_id), SUM(valor_estimado) FROM list_stock_debit_holes()` → 1.172 linhas / 184 OPs / R$ 225.736,46, todas origem 'consumo_sem_debito' e todas com op_status 'Finalizado'. A amostra citada confere literalmente: OP-2026-01167 (PV-00146, ref DS21) produto '01' (par), standard 1248.0000, actual 0.0000, detectado 2026-07-22. (1) A função existe e diz o que o auditor afirma. Definida na migration `supabase/migrations/2…
- **Fix sugerido:** Triagem das 184 OPs: separar legado (anterior ao débito automático) de furos atuais; para OPs recentes (PV-00141..146, jul/2026) investigar por que trg_record_consumption_on_finalize/débito por grade não gravou stock_movements, e regularizar o estoque via ajuste auditado (não re-débito cego).


---

## 2. Altos (confirmados)

### A1. [Banco vivo] Ficha CF 09 com upper_consumption = 2000 dm²/par (~400× o plausível)

- A ficha técnica 'CF 09' tem consumo de cabedal 2000 dm²/par (plausível: 4–8 dm²/par). Todo cálculo derivado (modal de consumo, custeio, MRP, lista de separação) para essa referência sai ~400× inflado. Já produziu efeito real: as OPs-2026-00863/00864 (PV-00122) aparecem no relatório de furos de débito com 32.000 e 24.000 unidades de 'Elástico 30mm' (R$140 mil estimados), poluindo também os relatórios de diagnóstico.
- **Evidência:** SELECT name, upper_consumption FROM technical_sheets WHERE name ILIKE 'CF 0%' → {name: 'CF 09 ', upper_consumption: '2000'} (comparar CF 05: 4.67). consumption_consistency_report() → {check: 'consumo_implausivel_alto', severity: 'alto', item_count: 1, sample: 'CF 09  (cabedal 2000)'}.
- **Verificação adversarial:** Verifiquei os 4 pontos no banco vivo (ssvxfoybzmjlypnipqzn) e no código, e o achado se sustenta integralmente: (1) O dado existe e diz o que o auditor afirma. SELECT em technical_sheets retornou {name: 'CF 09 ', upper_consumption: '2000'} (id 6f0f3134-c5ca-49f5-81e9-d90ac6c61c31), contra CF 05 = 4.67 e CF 03 = 0.68. Pior: o JSONB upper_consumption_per_size — que é a fonte PRIMÁRIA desde a migration 20260426120000 — também está todo em 2000 ({"33/34":2000,"35":2000,...,"39/40":2000}), então nenhum caminho de cálculo escapa do valor errado. consu…
- **Fix sugerido:** Corrigir o valor na ficha CF 09 (provável 20.00 digitado sem vírgula ou valor em cm²). O trigger trg_guard_implausible_consumption existe em BEFORE INSERT — verificar por que não barrou/alerta esse registro legado.

### A2. [Banco vivo] 23 fichas com componente direto apontando produto inexistente (consumo silenciosamente descartado)

- consumption_consistency_report() marca 'direct_components_produto_inexistente' (severidade alta do próprio report) em 23 fichas: o JSONB de componentes diretos referencia product_id que não existe mais (ex.: 'BINÓCULO 6MM: DOURADO' em 120/140/170/I-series, 'Fivela Dourada 10.7mm' em ST15/ST17/ST702/ST703/STX, 'Dedinho GOLD' em SP135). Essas linhas somem do consumo/custeio/MRP sem aviso — material comprado e usado na fábrica que não é planejado nem debitado.
- **Evidência:** consumption_consistency_report() → {check_name: 'direct_components_produto_inexistente', severity: 'alto', item_count: 23, sample: '120 / BINÓCULO 6MM: DOURADO · … · ST15 / Fivela Dourada 10.7mm · SP135 / Dedinho GOLD …'}. Existe trigger tg_strip_invalid_direct_components em BEFORE INSERT de technical_sheets, mas os dados legados persistem.
- **Verificação adversarial:** Reproduzi o report no banco vivo e o achado se sustenta em todos os pontos materiais; só a palavra "silenciosamente" precisa de correção. (1) O dado existe e é pior do que "inativo": `consumption_consistency_report()` retorna exatamente {check_name:'direct_components_produto_inexistente', severity:'alto', item_count:23} com o mesmo sample citado. Detalhei os 23 com LEFT JOIN em products: TODOS os 23 product_ids estão DELETADOS (não meramente inativos) — ex.: 'Fivela Dourada 10.7mm' (645bf78e) em ST15/ST17/ST702/ST703/STX a 2/par, 'BINÓCULO 6MM:…
- **Fix sugerido:** Reapontar cada componente direto para o produto vigente (ou recadastrar o produto); depois rodar o report de novo até zerar.

### A3. [SQL consumo/custeio] finalize_production_sector com lista de preparo obsoleta após o split da Costura

- **Onde:** `supabase/migrations/20260909120000_pcp-costura-parallel-finalize.sql:26`
- A definição VIVA de finalize_production_sector (última redefinição: 20260909120000; as migs 20260912120200/20260913120000 apenas a CHAMAM) fixa os setores de preparo como ['Corte Palmilha','Corte Forração','Aviamento','Costura']. A mig 20261001120000 renomeou TODAS as order_stages 'Costura' para 'Costura Palmilha' (passo 7a) e criou 'Costura Cabedal' (7b) — ou seja, o nome 'Costura' não existe mais em order_stages e os dois nomes novos não estão na lista. Efeitos: (1) concluir 'Costura Palmilha'/'Costura Cabedal' cai no ramo ELSE (não-prep) e promove a próxima etapa 'pendente' (ex.: Silk) a 'em_andamento' mesmo com outro preparo ainda 'em_andamento' não concluído — pré-split isso era bloqueado pelo gate all_prep_done; (2) concluir Aviamento calcula v_all_prep_done ignorando costuras pendentes e devolve all_prep_done=true errado. O RPC é o caminho canônico do apontamento (src/hooks/useProductionTransitions.ts:72) e também é chamado pelo motor de apontamento novo (20260912120200:187), então o defeito afeta os dois fluxos.
- **Evidência:** 20260909120000:26 `v_prep_sectors text[] := ARRAY['Corte Palmilha','Corte Forração','Aviamento','Costura'];` vs 20261001120000:235 `UPDATE public.order_stages SET stage_name = 'Costura Palmilha' WHERE stage_name = 'Costura';` — o split não redefine finalize_production_sector (grep: última definição é a 20260909120000).
- **Verificação adversarial:** Todas as premissas do achado foram verificadas no código E no banco vivo (ssvxfoybzmjlypnipqzn). (1) A definição em supabase/migrations/20260909120000_pcp-costura-parallel-finalize.sql:26 é exatamente `v_prep_sectors text[] := ARRAY['Corte Palmilha','Corte Forração','Aviamento','Costura']`, e o pg_proc VIVO confirma que essa é a versão em produção (prosrc começa com essa mesma lista). Grep em todas as migrations mostra que a última que faz CREATE OR REPLACE de finalize_production_sector é a 20260909120000; a 20260912120200 (linha 187) e a 20260…
- **Fix sugerido:** Nova migration redefinindo finalize_production_sector com v_prep_sectors incluindo 'Costura Palmilha' e 'Costura Cabedal' (mantendo 'Costura' por segurança), ou — melhor — derivando o conjunto de preparo de sector_settings.parallel_group ('corte' + 'costura_aviamento') pra não fixar nomes de novo.

### A4. [SQL consumo/custeio] tg_strip_cut_sectors_when_ready_made não remove 'Costura Palmilha' quando insole_ready_made=true

- **Onde:** `supabase/migrations/20260723210000_strip-cut-sectors-only-on-ready-made-transition.sql:45`
- A definição viva do trigger de 'palmilha pronta na cor' só remove os nomes ('corte palmilha','corte forração','corte forracao','costura'). Após a 20261001120000, as fichas carregam 'Costura Palmilha' (o trigger trg_normalize_production_sectors dispara ANTES na ordem alfabética e converte o legado 'Costura'→'Costura Palmilha'), então marcar insole_ready_made=true deixa a etapa de costura da palmilha no roteiro — violando o invariante canônico do CLAUDE.md (o trigger deve remover Corte Palmilha/Corte Forração/Costura quando a palmilha vem pronta). Resultado: OPs de modelo 'pronto na cor' ganham etapa e ficha de operador de Costura Palmilha que não deveria existir, e o lead da costura entra no timeline da onda. O ramo de restauração (true→false) também re-insere o nome legado 'Costura' (linha 33), que só vira canônico no próximo save.
- **Evidência:** 20260723210000:45 `WHERE LOWER(TRIM(value)) NOT IN ('corte palmilha','corte forração','corte forracao','costura')` e :33 `v_required text[] := ARRAY['Corte Palmilha','Corte Forração','Costura']` — a 20261001120000 atualizou tg_normalize_production_sectors e fn_guard_manual_stage_transition mas NÃO este trigger (grep: última definição é 20260723210000).
- **Verificação adversarial:** O defeito central é real e alcançável, embora o mecanismo citado pelo auditor esteja parcialmente errado quanto a QUAL definição está viva. (1) Fato citado existe: `supabase/migrations/20260723210000:45` diz exatamente `NOT IN ('corte palmilha','corte forração','corte forracao','costura')` e a linha 33 tem `v_required := ARRAY['Corte Palmilha','Corte Forração','Costura']`. Porém essa NÃO é a definição viva. Consultei o banco (`pg_get_functiondef` de `tg_strip_cut_sectors_when_ready_made` em ssvxfoybzmjlypnipqzn): a versão em produção é uma vari…
- **Fix sugerido:** Redefinir o trigger incluindo 'costura palmilha' na lista de strip (e 'Costura Palmilha' no v_required da restauração; avaliar se 'Costura Cabedal' deve ser preservado, pois costura de cabedal independe da palmilha pronta).

### A5. [Rotas/UI/permissões] Folha de pagamento acessível ao papel 'rh' apesar do gate rh_folha (aba default do hub /rh)

- **Onde:** `src/pages/RHHub.tsx:87`
- O módulo 'rh_folha' é declarado como restrito a admin/gerente (ROLE_MODULES: comentário 'RH: ... SEM folha de pagamento (gera financial_entries, restrito a admin)' e gate em isRouteAllowed). Porém o RouteGuard só avalia location.pathname (App.tsx:311), então as entradas '/rh?tab=folha' e '/rh/payroll'→'rh_folha' do ROUTE_MODULE_MAP nunca são aplicadas na navegação real: um usuário com papel 'rh' abre /rh (módulo 'rh', permitido) e o RHHub renderiza a aba Folha SEM nenhum gate interno — e pior, 'folha' é a ABA DEFAULT do hub (usePersistedState('rh-active-tab', 'folha')). FolhaConsolidada, PayrollPaymentsHistory e Payroll.tsx não têm nenhuma checagem de useAccessControl/isAdmin. Resultado: o papel 'rh' vê a folha salarial completa (salário − faltas + HE, pagamentos e recibos) que a política declara admin/gerente-only. O redirect legado /rh/payroll é bloqueado corretamente, mas o conteúdo idêntico vaza pela rota /rh.
- **Evidência:** useAccessControl.ts:134 `'/rh?tab=folha': 'rh_folha'` e :306 `if (mod === 'rh_folha' && !roles.includes('gerente')) return false;` — mas App.tsx:311 `const path = location.pathname;` (query nunca chega ao guard). RHHub.tsx:87 `const [activeTab] = usePersistedState<Tab>('rh-active-tab', 'folha');` e :162 `<TabsContent value="folha"><FolhaTab /></TabsContent>` sem gate; `grep useAccessControl|isAdmin|useCan` em FolhaConsolidada.tsx/PayrollPaymentsHistory.tsx/Payroll.tsx retorna vazio.
- **Verificação adversarial:** Todas as afirmações do auditor foram verificadas no código real e no banco vivo. (1) Código: src/pages/RHHub.tsx:87 tem `usePersistedState<Tab>('rh-active-tab', 'folha')` — 'folha' é a aba DEFAULT — e a linha 162 renderiza `<TabsContent value="folha"><FolhaTab /></TabsContent>`; o arquivo não importa useAccessControl nem faz nenhuma checagem de papel. src/App.tsx:311 confirma `const path = location.pathname;` passado a `canAccessRoute(path)` — a query string nunca chega ao guard, então as entradas `'/rh?tab=folha': 'rh_folha'` (useAccessControl…
- **Fix sugerido:** No RHHub, esconder/bloquear a aba 'folha' quando `!canAccessModule('rh_folha')` (e trocar o default persistido pra 'funcionarios' nesses casos); alternativamente mover a checagem pro FolhaTab. O RouteGuard nunca verá query string, então o gate tem que ser no componente.

### A6. [Produção/ondas] Topologia de prep divergente: SQL compute_wave_timeline (Costura paralela aos cortes) vs frontend (Costura depois dos cortes)

- **Onde:** `src/lib/sectorCapacity.ts:404`
- Após o split, computeParallelWindows/computeForwardSchedule passaram a modelar dois blocos (Corte Palmilha‖Corte Forração primeiro; depois Costura Palmilha‖Costura Cabedal‖Aviamento). O SQL compute_wave_timeline vivo (20260920161000/121000, não atualizado pela 20261001120000) continua com a topologia antiga: Costura PARALELA aos 3 preps — lead prep = GREATEST(palmilha, forracao, mesa, costura) — e lendo só a coluna legada costura_capacity_per_day. As janelas/datas exibidas nas telas (Capacidade, Cronograma Direto, Setores por Dia) divergem de material_ready_date/purchase_deadline e das âncoras de compra que ainda delegam a compute_wave_timeline (get_wave_material_needs, purchase-date-anchors). É exatamente a classe de divergência que a auditoria 20260524120000 tinha fechado.
- **Evidência:** sectorCapacity.ts 404–421: 'Prep em DOIS blocos paralelos ... bloco 1 termina quando o 2 começa' (costPalmEnd = silkStart; palmEnd = bloco2Start). SQL vivo 20260920121000 linha 275: 'v_lead_prep_max := GREATEST(v_lead_palmilha, v_lead_forracao, v_lead_mesa, v_lead_costura);' e linhas 221–224 usando ts.costura_capacity_per_day legada.
- **Verificação adversarial:** Confirmado com evidência em três camadas. (1) Código citado confere: src/lib/sectorCapacity.ts:404-421 modela prep em DOIS blocos ("bloco 1 — Corte Palmilha ‖ Corte Forração (antes do bloco 2)"; costPalmEnd = silkStart; bloco2Start = min dos starts de costura/aviamento; palmEnd = bloco2Start), e computeForwardSchedule espelha (FORWARD_CORTES → FORWARD_COSTURA_AVIAMENTO → FORWARD_SEQ). (2) SQL vivo verificado via pg_get_functiondef no projeto ssvxfoybzmjlypnipqzn: compute_wave_timeline em produção é idêntico à mig 20260920161000 e mantém a topol…
- **Fix sugerido:** Atualizar compute_wave_timeline (e o espelho em purchase-date-anchors) para a topologia de dois blocos e lead da fase costura = GREATEST das duas capacidades novas (fallback à legada); ou, se a decisão for manter o SQL como está, reverter o frontend — hoje os dois lados afirmam ser espelho um do outro e não são.

### A7. [Produção/ondas] Engine de capacidade/produtividade (capacity_sector_key) não reconhece os setores novos — Costura vira 'faltando' e operações do BOM viram órfãs

- **Onde:** `supabase/migrations/20260719120100_rpc-model-productivity.sql:22`
- As operações do BOM criadas na fase 1 têm stage='Costura' (key 'costura'). Após o backfill do roteiro para 'Costura Palmilha'/'Costura Cabedal' (keys 'costura_palmilha'/'costura_cabedal'), get_model_productivity itera o roteiro e não encontra nenhuma operação com essas keys: as duas costuras aparecem como 'faltando' na tela Produtividade por Modelo e a operação 'Costura Cabedal' (fase 1) cai no balde de órfãs. Se o usuário preencher capacidade pela tela, set_model_sector_capacity não acha alvo (v_target NULL) e INSERE operação nova com stage=capacity_sector_label('costura_palmilha') = initcap → 'Costura_Palmilha' (rótulo malformado), coexistindo com a operação 'Costura' órfã ainda ativa — calculate_order_cost soma as duas e a MO da costura duplica no custo por par.
- **Evidência:** capacity_sector_key sem mapeamento para as costuras novas (CASE só corte/palmilha/forracao/aviamento/serigrafia; 'costura palmilha'→'costura_palmilha' cru) e capacity_sector_label ELSE initcap(p_key). get_model_productivity (20260719160100, 118–163) filtra bom_operations por capacity_sector_key(bo.stage)=v_rec.key; set_model_sector_capacity (20260719160000, 377–386) INSERT ... VALUES (p_sheet_id, v_label, v_label, ...). Fase 1 (20260719170000, 22–26) fixou as operações com stage de key 'costura'.
- **Verificação adversarial:** Confirmado com evidência de código E prova no banco vivo (ssvxfoybzmjlypnipqzn): (1) `capacity_sector_key` vivo em produção é idêntico ao da migration 20260719120100 (prosrc conferido): CASE só com corte/palmilha/forracao/aviamento/serigrafia — 'Costura' → key 'costura', sem mapeamento para o mundo pós-split. Nenhuma migration posterior redefine a função (grep em supabase/migrations: única definição é a 20260719120100). O espelho TS (`src/lib/sectors.ts` linha 43) já mapeia `'costura' → 'costura_palmilha'` — o lado SQL ficou para trás. (2) Fase…
- **Fix sugerido:** Migration: migrar bom_operations.stage das operações de costura para o setor novo correspondente (operation_name distingue palmilha/cabedal), ou ensinar capacity_sector_key/label os dois setores e mapear a compatibilidade 'costura' → par novo; adicionar as labels canônicas em capacity_sector_label.

### A8. [Produção/ondas] Detector de gargalo/atraso cego para OPs em Costura Palmilha e Costura Cabedal

- **Onde:** `src/lib/sectorBottleneck.ts:72`
- SECTOR_TO_CAPACITY_COLUMN em sectorBottleneck.ts não tem entradas para os dois setores novos (só 'Costura' legado), e o select das fichas não busca as colunas novas. Para OP cujo stage atual é 'Costura Palmilha'/'Costura Cabedal', capCol fica undefined → cap=0 → computeBottleneck devolve severity 'ok' sempre: OP atrasada nesses setores nunca é sinalizada (KPIs de atraso, alertas do PCP). É a reedição literal do bug que a auditoria 2026-06-14 corrigiu para 'Costura' (comentário nas linhas 163–164 do próprio arquivo).
- **Evidência:** const SECTOR_TO_CAPACITY_COLUMN = { 'Corte Palmilha': ..., 'Costura': 'costura_capacity_per_day', ... } (72–93, sem 'Costura Palmilha'/'Costura Cabedal'); linha 238: const capCol = SECTOR_TO_CAPACITY_COLUMN[current.stage_name]; let cap = capCol ? ... : 0; e cap===0 → info severity 'ok'.
- **Verificação adversarial:** Tentei refutar e não consegui — todos os pontos do achado se sustentam com evidência concreta. (1) O código diz exatamente o que o auditor afirma. Em src/lib/sectorBottleneck.ts, `SECTOR_TO_CAPACITY_COLUMN` (linhas 72–93) contém apenas `'Costura': 'costura_capacity_per_day'` — não há entradas para 'Costura Palmilha' nem 'Costura Cabedal'. O `.select()` das fichas (linha 165) não busca `costura_palmilha_capacity_per_day` nem `costura_cabedal_capacity_per_day` (colunas criadas pela migration 20261001120000). Na linha 238–239: `const capCol = SECT…
- **Fix sugerido:** Adicionar 'Costura Palmilha': 'costura_palmilha_capacity_per_day' e 'Costura Cabedal': 'costura_cabedal_capacity_per_day' (com fallback à coluna legada no resolve) e incluir as duas colunas no .select() das fichas.

### A9. [Impressão] FlowRail e cor-assinatura do setor nunca renderizam — parseInt('OP …') = NaN

- **Onde:** `src/components/production/worksheet/WorksheetHeader.tsx:116`
- O trilho do fluxo (FLOW_RAIL_STEPS, 11 passos) e a faixa/cor-assinatura do setor (SECTOR_COLORS, escolha do dono 2026-06-30) dependem de `flowStep = parseInt(editorialIndex, 10)`. Porém TODOS os 5 chamadores (OperatorWorkSheet:139, SilkMontageWorkSheet:879, SolagemWorkSheet:331, PalmilhaWorkSheet:116, ExpedicaoWorkSheet:194) passam `index={`OP ${formatOpNumber(sector)} / …`}` — a string começa com 'OP', então parseInt retorna NaN, `hasFlow` é sempre false e NENHUMA ficha imprime o trilho nem a cor do setor (nome do setor sai preto). O commit 0c76898 (2026-07-26, split da Costura) até estendeu o trilho pra 11 passos e anuncia 'trilho de 11 passos na impressão' no changelog — mantendo/evoluindo um recurso que está morto em produção. Agravante: mesmo consertando o parse, `formatOpNumber` devolve a numeração ANTIGA de 10 etapas (Silk=5, Aviamento=4), desalinhada do trilho de 11 posições (posição 5 = 'AVIA', 6 = 'SILK') — todos os setores após Costura destacariam o passo errado e a cor errada.
- **Evidência:** WorksheetHeader.tsx:114-119: `const editorialIndex = index || `01 / ${sector.toUpperCase()}`;` / `const flowStep = parseInt(editorialIndex, 10);` / `const hasFlow = Number.isFinite(flowStep) && flowStep >= 1 && flowStep <= 11;` — e todo caller passa ex.: SilkMontageWorkSheet.tsx:879 `index={`OP ${formatOpNumber(sector)} / ${sector.toUpperCase()}`}`. parseInt('OP 05 / SILK', 10) === NaN.
- **Verificação adversarial:** Todos os elementos do achado foram verificados no código real. (1) WorksheetHeader.tsx:114-119 contém exatamente `const flowStep = parseInt(editorialIndex, 10); const hasFlow = Number.isFinite(flowStep) && flowStep >= 1 && flowStep <= 11;` e TANTO a faixa de cor (linha 124), quanto a cor do nome do setor (linha 143, `color: sectorColor` com fallback '#000'), quanto o trilho (linha 178 `{hasFlow && <FlowRail current={flowStep} />}`) são gated por `hasFlow`. (2) Grep confirma que os ÚNICOS 5 chamadores de WorksheetHeader (OperatorWorkSheet:139, S…
- **Fix sugerido:** Extrair o passo com um match explícito (ex.: `/(\d+)/.exec(editorialIndex)`) OU passar o nº como prop dedicada (`flowStep={...}`), e mapear pelo trilho de 11 posições (fonte única compartilhada com FLOW_RAIL_STEPS/SECTOR_COLORS) em vez do canonical antigo de 10.

### A10. [Impressão] Costura Cabedal renderiza mas não conta: sheetCount usa proxy morto 'Corte Cabedal' e pode desabilitar o Imprimir

- **Onde:** `src/components/production/PrintWorkSheetsPage.tsx:2831`
- O commit 0c76898 mudou o filtro de render de Costura Cabedal para identidade (`roteiroSectorFor = sector`, linha 3115, testando 'Costura Cabedal' no roteiro), mas NÃO atualizou o memo `sheetCount`, que ainda testa o proxy antigo `opsInRoteiro(cg.opNumbers, 'Corte Cabedal')`. 'Corte Cabedal' nunca foi valor válido de `technical_sheets.production_sectors`: a lista canônica do trigger `tg_normalize_production_sectors` (migs 20260605120000, 20260617130000 e 20261001120000) não o inclui e o descarta em qualquer write, e `normalizeSector('corte cabedal')` não existe em SECTOR_NORMALIZE. Resultado: pra toda ficha com roteiro preenchido (o normal pós-backfill), a condição é false — o maço de Costura Cabedal RENDERIZA no preview mas nunca incrementa o contador. Efeitos: (1) o contador 'N fichas' da toolbar subestima sempre que Costura Cabedal tem conteúdo; (2) com apenas 'Costura Cabedal' selecionado, `sheetCount === 0` DESABILITA os botões Imprimir/Relatório simplificado (linha 2921: `disabled={… || sheetCount === 0 …}`) com a ficha visível na tela — impressão bloqueada numa seleção válida.
- **Evidência:** PrintWorkSheetsPage.tsx:2831-2832: `if (activeSectors.has('Costura Cabedal') && smGroups.some(g => g.colorGroups.some(cg => cg.requiresUpperSewing === true && opsInRoteiro(cg.opNumbers, 'Corte Cabedal')))) total += 1;` vs render em 3115/3130: `const roteiroSectorFor = (sector) => sector;` + `filtered.filter(cg => cg.requiresUpperSewing === true)`. Migration 20261001120000: `v_canonical text[] := ARRAY['Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']` (sem 'Corte Cabedal').
- **Verificação adversarial:** Confirmado em três camadas. (1) Código: PrintWorkSheetsPage.tsx:2831-2832 realmente testa `cg.requiresUpperSewing === true && opsInRoteiro(cg.opNumbers, 'Corte Cabedal')` no memo sheetCount, enquanto o render (linha 3115: `const roteiroSectorFor = (sector) => sector;` + 3130-3132) filtra o maço de Costura Cabedal por `opsInRoteiro(cg.opNumbers, 'Costura Cabedal')` + requiresUpperSewing. `git show 0c76898` prova que o commit alterou SÓ o hunk do roteiroSectorFor nesse arquivo — o sheetCount ficou com o proxy antigo (e o comentário estale das lin…
- **Fix sugerido:** Em sheetCount, trocar `opsInRoteiro(cg.opNumbers, 'Corte Cabedal')` por `opsInRoteiro(cg.opNumbers, 'Costura Cabedal')` (e por simetria trocar o teste de Costura Palmilha de 'Costura' pra 'Costura Palmilha' — equivalente hoje via alias, mas evita novo drift). Idealmente derivar o contador da mesma função de filtro usada no render.

### A11. [Impressão] Botão 'Ficha de Operador' reintroduz o cálculo antigo de fichas (round(total/Σgrid)) sem resolveFicha

- **Onde:** `src/lib/printOperatorFichas.ts:90`
- O caminho `printOperatorFichasFromRows`/`printOperatorFichas` (botão 'Ficha de Operador' em /imprimir-fichas e no PV) calcula `nFichas = Math.max(1, Math.round(total / baseSum))` usando `sale_order_items.grade` cru como curva-base. É EXATAMENTE o cálculo que o 7º passe (PRINT_SPEC/CLAUDE.md) documenta como bug corrigido: a grade ora chega como curva-base (soma 12/15/18), ora como grade TOTAL do pedido (soma 120/360/444 — ex. real TAMARA), e `round(total/Σgrid)` então imprime 'Ficha 1/1 · Pares por ficha: 360 pares' em vez de N fichas de 12 — instrução errada pro operador no chão de fábrica. O helper canônico `worksheet/fichaSize.ts → resolveFicha` (que trata os 4 casos e marca resolução inexata) existe pra isso e não é usado aqui; o fallback por MDC (`deriveBaseFromScaled`) só roda quando o item do PV NÃO é encontrado (linha 209: `baseByItem.get(...) || deriveBaseFromScaled(...)`). Além disso `Math.round` pode SUBcontar fornadas (total=27, base=12 → round(2.25)=2 fichas → 3 pares sem ficha), onde resolveFicha marcaria '≈ N fichas'.
- **Evidência:** printOperatorFichas.ts:87-90: `const baseSum = Object.values(base).reduce(...); const total = Number(it.quantity) || baseSum; const nFichas = Math.max(1, Math.round(total / baseSum));` — sem resolveFicha. CLAUDE.md/PRINT_SPEC 7º passe: "o cálculo antigo (fichas = round(total/Σgrid)) imprimia 'POR FICHA (120P) · 1 ficha'" e "Todos os builders de grupos … usam o helper".
- **Verificação adversarial:** Verifiquei os 4 pontos e o achado se sustenta integralmente. (1) O código citado existe verbatim. `src/lib/printOperatorFichas.ts:86-90` (dentro de `renderAndOpen`, usado por AMBOS os caminhos): `const base = it.grade || {}; const baseSum = Object.values(base).reduce((s, v) => s + Number(v || 0), 0); ... const total = Number(it.quantity) || baseSum; const nFichas = Math.max(1, Math.round(total / baseSum));`. Não há import de `resolveFicha` no arquivo. É exatamente o cálculo que `src/components/production/worksheet/fichaSize.ts:9-13` e `docs/PRI…
- **Fix sugerido:** Usar `resolveFicha(total, base)` de `@/components/production/worksheet/fichaSize` pra derivar corrugado/nFichas/curva-base (e sinalizar `exact=false` como '≈ N fichas'), em vez do round direto.

### A12. [RH/ponto] punch_map_resolve/get_punch_reconciliation: SECURITY DEFINER liberadas a qualquer authenticated, sem is_approved_user()

- **Onde:** `supabase/migrations/20260627120000_punch-reconciliation.sql:187`
- As RPCs que contornam o RLS de punch_device_map (por design) foram GRANTed a `authenticated` sem o gate `is_approved_user()` usado no resto do RH (ex.: policies do bucket timesheet-imports na mig 20260525130000). Qualquer usuário logado — inclusive conta ainda não aprovada — pode revincular device→funcionário e disparar o UPDATE em massa de time_records.employee_id (backfill/cleanup dentro de punch_map_resolve), corrompendo a identidade do ponto que alimenta pagamento.
- **Evidência:** supabase/migrations/20260627120000_punch-reconciliation.sql:143-145 `security definer` sem checagem de aprovação no corpo, :173-184 UPDATE em massa de time_records, :187-188 `grant execute … to authenticated;` — contraste com 20260525130000:60-62 `USING (bucket_id = 'timesheet-imports' AND public.is_approved_user())`.
- **Verificação adversarial:** Confirmado no repo E no banco vivo — e a exposição real é PIOR que o reportado. Mig 20260627120000: ambas security definer sem gate (:88, :144), UPDATE em massa de time_records.employee_id (:173-184), grant a authenticated (:187-188); nenhuma migration posterior endurece (grep: só este arquivo define as funções). Banco vivo (pg_proc): prosecdef=true, corpo sem is_approved_user, enquanto import_time_records_safe TEM o gate (precedente da mig 20260527190000, que classificou exatamente essa lacuna como brecha de segurança a corrigir). Agravante ve…
- **Fix sugerido:** Adicionar `IF NOT public.is_approved_user() THEN RAISE EXCEPTION` no início das duas funções (ou revogar de authenticated e conceder a um role/claim de RH).


---

## 3. Médios (confirmados)

### M1. [Banco vivo] 26 OPs ativas (Reservado/Em Produção) com linhas de consumo sem nenhuma reserva ativa

- list_ops_with_stale_reservations() retorna 56 linhas em 26 OPs: consumo esperado (via op_expected_consumption_lines) sem reserva 'reserved'/'partially_consumed' cobrindo o produto ou seu grupo. Inclui OPs com status literal 'Reservado' (PV-2026-00094: OPs 00733/00734/00737/00738/00740/00741 sem reserva do solado '180 SALTO BLOCO', 12 pares cada) — contradição direta do status. Efeito: reserved_stock subestimado para esses materiais → 'disponível' superestimado → outro PV pode alocar o mesmo material e travar a OP. Parte das linhas em 'Em Produção' pode ser reserva já convertida em débito (falso positivo parcial), mas as de 'Reservado' são inconsistência real.
- **Evidência:** SELECT COUNT(*), COUNT(DISTINCT order_id) FROM list_ops_with_stale_reservations() → {linhas: 56, ops: 26}. Amostra: {order_number: 'OP-2026-00733', pv: 'PV-2026-00094', op_status: 'Reservado', product_name: '180 SALTO BLOCO', required_qty: 12, consumption_source: 'primary_sole'}.
- **Fix sugerido:** Para as OPs 'Reservado' sem reserva: re-executar a reserva de materiais; ajustar o report para cruzar com stock_movements e excluir consumo já debitado nas OPs 'Em Produção'.

### M2. [Banco vivo] Cadastro de receitas/materiais artesanais inconsistente (66 cores sem material base + 6 flags inconsistentes)

- consumption_consistency_report(): 'material_base_artesanal_sem_cor' = 66 combinações (tiras/trança artesanais cuja cor não existe nos grupos de napa de origem — ex.: 'Tira Overlock 5mm: AMARELO → NAPA SOFT/NAPA MADRID') e 'produto_artesanal_flag_inconsistente' = 6 produtos. A resolução do material base por cor falha para essas combinações, então a produção artesanal dessas tiras não consegue debitar a napa de origem correta.
- **Evidência:** consumption_consistency_report() → {check: 'material_base_artesanal_sem_cor', severity: 'medio', item_count: 66, sample: 'Meia Cana 10mm - TAN → NAPA MADRID · Tira Overlock 5mm: AMARELO → NAPA SOFT · …'}; {check: 'produto_artesanal_flag_inconsistente', item_count: 6, sample: 'Tira chata 8mm: ROCHA · TIRA OVERLOCK 5MM: CAPUCCINO …'}.

### M3. [Banco vivo] PCP desatualizado: 6 compras vencidas em ondas ativas e 14 fichas alteradas após snapshot

- pcp_freshness_report(): 'compra_vencida_onda_ativa' (severidade alta do report) = 6 ondas (W2026-19/20/21, AUTO-2026-22/27, PV-00116) com compra já vencida enquanto a onda segue ativa — risco de setor arrancar sem matéria-prima; 'ficha_alterada_apos_snapshot' = 14 referências (BT01, CF 09, DS20, DS21, EC06…) cujo snapshot de planejamento está defasado da ficha atual.
- **Evidência:** pcp_freshness_report() → {check: 'compra_vencida_onda_ativa', severity: 'alto', item_count: 6, sample: 'W2026-20 · W2026-19 · W2026-21 · AUTO-2026-22 · PV-00116 · AUTO-2026-27'}; {check: 'ficha_alterada_apos_snapshot', item_count: 14}.

### M4. [Banco vivo] Capacidade/cronoanálise incompleta: 61 setores sem tempo, 43 operações órfãs, 24 divergências de capacidade

- capacity_consistency_report(): 61 combinações referência×setor 'tempo_faltando' com severidade alta (maioria 'Costura Palmilha' e 'Costura Cabedal' — sem BOM ativo, sem cronoanálise e sem padrão da categoria), 43 'operacao_orfa', 24 'divergencia_capacidade', 12 'funcionario_sem_setor', 4 'default_incompleto', 3 'setor_sem_equipe', 1 'headcount_drift'. O timeline de ondas (compute_wave_timeline) e o custo de MO calculam com buracos para essas referências.
- **Evidência:** SELECT categoria, severidade, COUNT(*) FROM capacity_consistency_report() GROUP BY 1,2 → tempo_faltando/alta: 61; operacao_orfa/media: 43; divergencia_capacidade/media: 24; funcionario_sem_setor/media: 12. Amostra: {referencia: 'DS21', detalhe: 'Setor Costura Palmilha sem tempo: sem BOM ativo, sem valor manual/cronoanálise… e sem padrão da categoria Rasteirinha'}.

### M5. [Banco vivo] 2 solados fachetados (180 SALTO BLOCO C/P) sem consumo de fachete nas specs

- Os produtos '180 SALTO BLOCO' (SKUs S180C e S180P) têm is_fachetado=true mas nenhuma das 7 linhas de sole_technical_specs de cada um tem fachete_lining_consumption_dm2 > 0. O componente 'Fachete' (adicionado em calculate_order_consumption_by_grade pela mig 20260518120000) não emite consumo para esses solados → forro de fachete não planejado nem custeado. Ambos estão em OPs ativas do PV-2026-00094.
- **Evidência:** consumption_consistency_report() → {check: 'solado_fachetado_sem_specs_fachete', item_count: 2, sample: '180 SALTO BLOCO · 180 SALTO BLOCO'}. Confirmação: SELECT p.sku, COUNT(sts.id), COUNT(*) FILTER (WHERE COALESCE(sts.fachete_lining_consumption_dm2,0)>0) FROM products p LEFT JOIN sole_technical_specs sts ON sts.sole_id=p.id WHERE p.name='180 SALTO BLOCO' GROUP BY p.sku → S180C: 7 specs, 0 com fachete; S180P: 7 specs, 0 com fachete.
- **Fix sugerido:** Cadastrar fachete_lining_consumption_dm2 por numeração nas specs dos dois solados (ou desligar is_fachetado se a classificação estiver errada — hoje estão como 'palmilha_pronta').

### M6. [Banco vivo] Ficha CF 03 com consumo de cabedal 0.68 dm²/par (provável m² em campo dm² → ~100× subestimado)

- audit_unit_divergences(): a ficha 'CF 03' tem upper_consumption = 0.68 e o mesmo 0.68 replicado em 6 chaves do JSONB upper_consumption_per_size (tam 33/34–38). Esperado 1–30 dm²/par; 0.68 é o padrão de valor digitado em m². Consumo/custeio de cabedal dessa referência sai ~100× menor que o real.
- **Evidência:** audit_unit_divergences() → {key: 'tech_sheets_upper_lt1', count: 1, examples: [{label: 'CF 03', value: 0.68}]}; {key: 'tech_sheets_per_size_lt1', count: 6, examples: [{label: 'CF 03 · upper tam 35', value: 0.68}, …]}. Confirmado: SELECT upper_consumption FROM technical_sheets WHERE name='CF 03' → 0.68.

### M7. [Motor de consumo TS] Pin da FICHA vence o grupo da VARIANTE no motor TS (precedência invertida vs SQL)

- **Onde:** `src/lib/orderConsumption.ts:1027`
- Quando o item do PV tem variante de material que define SÓ o grupo (upper/lining/insole_material_group_id, sem produto pinado) e a ficha técnica tem pin próprio (upper_material_product_id / lining_material_product_id / pin de technical_sheet_palmilha_colors), o motor TS usa o pin DA FICHA como SKU da linha e como fonte da ficha de conversão. Isso inverte a precedência canônica do CLAUDE.md ('produto legado pinado > grupo da variante > pin da ficha > grupo da ficha') e diverge dos resolvers SQL vivos: em resolve_upper/lining_material_for_variant (mig 20260907120500), quando v_gid está setado a função RETORNA 'variant_group' ANTES de sequer olhar p_sheet_pin_product_id; resolve_insole_material_for_variant nem recebe pin. Impacto: (a) materialName da linha mostra o SKU do material ORIGINAL sob o grupo da variante; (b) quando esse SKU pinado tem component_sheet própria com dimensões, getConversionSheetForProduct usa a LARGURA/waste_pct do material errado na conversão dm²→m — violando a regra canônica 'a conversão dm²→m usa a largura da ficha de componente do grupo DA VARIANTE' — e o consumo em metros diverge do débito/custeio SQL; (c) na palmilha, o pin do mapping da ficha dirige nome/unidade/cor da linha e pode desviar o caminho dm²/linear/par inteiro. Mesmo padrão em bomConsumption.ts (linhas 502-511 e 569-576).
- **Evidência:** orderConsumption.ts:1024-1031: `const isPrincipal = upperVariantDriven || upperMatch.group === (sheet?.upper_material || ''); const upperPin = upperVariant.pin || (isPrincipal && (sheet as any)?.upper_material_product_id ? (allProducts || []).find(...) : null);` — com variante group-only, upperVariant.pin é null e isPrincipal=true, então upperPin = pin da ficha; depois `getConversionSheetForProduct(upperPin?.id, upperMatch.group, ...)` prioriza a cs desse pin. SQL (20260907120500_variant-group-resolution.sql): `IF v_gid IS NOT NULL THEN ... RETURN QUERY SELECT ... 'variant_group' ... RETURN; E…
- **Fix sugerido:** Quando o componente é variant-driven por GRUPO (variante sem product_id), não cair no pin da ficha: usar pin somente se for da variante; a ficha de conversão e o SKU devem sair de resolveMaterialProductCanonical(grupoDaVariante, cor). Ex.: `const upperPin = upperVariant.pin || (!upperVariantDriven && isPrincipal && sheet.upper_material_product_id ? ... : null)` (e o análogo no forro, palmilha e em bomConsumption.ts). Adicionar teste de paridade com variante group-only + ficha pinada.

### M8. [SQL consumo/custeio] compute_wave_timeline/compute_min_billing_date ainda leem só a capacidade legada costura_capacity_per_day

- **Onde:** `supabase/migrations/20260920161000_shortage-gate-color-aware-v2.sql:254`
- As definições vivas das duas funções de timeline (20260920161000, não tocadas pela 20261001) calculam o lead da fase de costura exclusivamente por ts.costura_capacity_per_day/dlt.costura_capacity_per_day. O split criou costura_palmilha_capacity_per_day e costura_cabedal_capacity_per_day (backfill copiando o legado), apontou sector_settings.ficha_capacity_column pra as colunas novas e o motor TS (src/lib/leadTime.ts:112 e sectorCapacity.ts) passou a ler as novas com fallback no legado. O cabeçalho da 20261001 declara que o lead da onda deve ser 'o maior dos dois lados', mas o SQL não implementa GREATEST das duas capacidades. Hoje os valores são iguais (backfill); assim que alguém editar uma capacidade nova sem mexer na legada, as datas da onda (SQL) divergem das telas de capacidade (TS) — mesma classe do bug corrigido na 20260524120000 (datas UI ≠ servidor).
- **Evidência:** 20260920161000:254 `CASE WHEN COALESCE(NULLIF(ts.costura_capacity_per_day,0), dlt.costura_capacity_per_day, 0) > 0 ...` (idem :366 em compute_min_billing_date) vs leadTime.ts:112 `costura_palmilha: { capField: 'costura_palmilha_capacity_per_day', fallbackCapField: 'costura_capacity_per_day', ... }` e 20261001120000 header: 'cujo lead time é o maior dos dois lados'.
- **Fix sugerido:** Redefinir as duas funções usando GREATEST dos leads derivados de costura_palmilha_capacity_per_day e costura_cabedal_capacity_per_day (cada um com fallback no legado), espelhando leadTime.ts.

### M9. [Hooks/React Query] queryFn de carga por setor engole erros e devolve painel vazio como sucesso

- **Onde:** `src/hooks/useSectorDailyLoad.ts:78`
- useSectorDailyLoad (e o gêmeo useSectorPeriodLoad) fazem os 3 fetches principais (`orders`, `technical_sheets`, `order_stages`) descartando o `error`. Em qualquer falha, `ordersRaw` fica null, `orders.length === 0` e o hook retorna `emptyResult` — o painel de carga/PCP mostra todos os setores com 0 pares e severidade 'idle' como se a fábrica estivesse vazia. Como a Promise resolve com sucesso, o QueryCache global (App.tsx:142-151), que toastaria a falha, nunca dispara — o usuário não tem nenhum sinal de erro e toma decisão de capacidade com dado falso. Viola a convenção canônica do CLAUDE.md ('sempre if (error) throw error antes de retornar').
- **Evidência:** src/hooks/useSectorDailyLoad.ts:78-96: `const { data: ordersRaw } = await supabase.from('orders').select(...).gt('quantity', 0); const orders = (ordersRaw || []).filter(...); ... if (orders.length === 0) return emptyResult;` — sem `if (error) throw`. Mesmo padrão em useSectorPeriodLoad.ts:87, 100 e 139.
- **Fix sugerido:** Destructurar `{ data, error }` e lançar o erro nos 3 fetches de cada hook, deixando o React Query marcar a query como error (o QueryCache global já mostra o toast e a UI pode exibir estado de falha em vez de fábrica vazia).

### M10. [Hooks/React Query] RPC recall_lot_buyers não existe em nenhuma migration — só no banco vivo

- **Onde:** `src/hooks/useStockQuality.ts:121`
- O hook useRecallLot chama a RPC `recall_lot_buyers`, mas em ~1275 migrations não há nenhum CREATE FUNCTION para ela — o nome aparece apenas num comentário do cabeçalho da migration 20260620120000. A função existe hoje no banco de produção (verificado via pg_proc: exists=true), ou seja, foi aplicada por fora (MCP/SQL Editor) e nunca foi retro-portada para o repositório. Qualquer ambiente reconstruído a partir das migrations (branch DB do Supabase, CI com `supabase db push`, o projeto vazio 'SquadShoes Correto', disaster recovery) nasce sem a função, e a aba Recall de Lote (EstoqueQualidade) quebra em runtime — o cast `as any` na chamada confirma que os types gerados e o schema das migrations divergem do código.
- **Evidência:** src/hooks/useStockQuality.ts:121: `const { data, error } = await supabase.rpc('recall_lot_buyers' as any, { p_lot_id: lotId });` — grep em supabase/migrations/ só encontra `-- production_lots, sale_order_lot_allocations, recall_lot_buyers()` (comentário em 20260620120000_ondas1a7_full_erp_expansion.sql:25). Verificação no banco vivo ssvxfoybzmjlypnipqzn: `SELECT EXISTS(... pg_proc ... proname='recall_lot_buyers')` → true. Todas as outras 66 RPCs chamadas de src/hooks/ têm CREATE FUNCTION em migration.
- **Fix sugerido:** Criar uma migration com o corpo atual da função (extrair do banco vivo via `pg_get_functiondef`) em supabase/migrations/, para que o repositório volte a reproduzir o schema de produção.

### M11. [Rotas/UI/permissões] Split de nomenclatura de módulo 'reports' × 'relatorios' deixa os 6 relatórios A4 inacessíveis a gerente/comercial/consulta

- **Onde:** `src/hooks/useAccessControl.ts:78`
- ROUTE_MODULE_MAP mapeia as 6 rotas /relatorios/* (op, oee, diario-producao, qualidade, refugo, semanal) pro módulo 'reports', com comentário afirmando 'Sub-rotas continuam acessíveis a gerente via módulo reports'. Mas NENHUM papel em ROLE_MODULES contém 'reports' — gerente/comercial/consulta têm 'relatorios' (pt), que só governa '/sales-report', uma rota que é redirect pra /comercial ('vendas'). Efeito: (a) gerente recebe 'Acesso Restrito' em qualquer /relatorios/*, contrariando a intenção documentada; (b) o módulo 'relatorios' concedido a 3 papéis não dá acesso a página nenhuma (módulo morto). O CreateUserDialog agrava a divergência: seus ROLE_TEMPLATES usam 'reports' (gerente/comercial/consulta), uma terceira tabela paralela desalinhada do ROLE_MODULES runtime.
- **Evidência:** useAccessControl.ts:78-92 `'/relatorios/op': 'reports'` (+5 rotas) e comentário :82-83 'Sub-rotas continuam acessíveis a gerente via módulo reports'; ROLE_MODULES :179-184 gerente = [... 'relatorios' ...] — sem 'reports'; único mapeamento de 'relatorios' é :46 `'/sales-report': 'relatorios'` (redirect). CreateUserDialog.tsx:31 gerente modules inclui 'reports'.
- **Fix sugerido:** Unificar o nome do módulo (ex.: trocar os valores 'reports' do ROUTE_MODULE_MAP por 'relatorios', ou adicionar 'reports' aos papéis pretendidos em ROLE_MODULES) e alinhar os ROLE_TEMPLATES do CreateUserDialog à mesma fonte.

### M12. [Rotas/UI/permissões] Rotas reais fora do ROUTE_MODULE_MAP ficam liberadas pra qualquer usuário autenticado (inclui detalhe financeiro de cliente)

- **Onde:** `src/pages/EconomicGroupDetail.tsx:159`
- isRouteAllowed retorna true pra rota sem módulo no modo RBAC legado ('rotas fora do mapa = livres'). Quatro rotas reais de App.tsx não têm entrada no ROUTE_MODULE_MAP: /grupos-economicos/:id, /navigation-audit, /modules/quality e /modules/reports. A mais grave é /grupos-economicos/:id (EconomicGroupDetail): exibe 'Receita 12m', limite de crédito e aging completo de AR do grupo econômico — papéis 'producao' e 'almoxarifado' (bloqueados de valores financeiros via ROLES_BLOCKED_FROM_FINANCIAL_VALUES e sem módulo 'clientes') acessam por URL direta e veem tudo, sem nenhum gate no componente. /navigation-audit é ferramenta de sistema liberada a todos enquanto o análogo /unit-audit é 'sistema' (admin-only) — inconsistência.
- **Evidência:** useAccessControl.ts:323 `if (!mod) return true; // rotas fora do mapa = livres`; App.tsx:901-904 rota `grupos-economicos/:id` e :864-866 `navigation-audit`, :1224-1225 `modules/quality|reports` — nenhuma dessas keys existe no ROUTE_MODULE_MAP (:10-172). EconomicGroupDetail.tsx:159 `<KpiCard label="Receita 12m" value={fmtCurrency(kpis?.revenue_12m...)}` e :168-177 limite/AR aging, sem useAccessControl/canSeeFinancialValues no arquivo.
- **Fix sugerido:** Adicionar ao ROUTE_MODULE_MAP: '/grupos-economicos': 'clientes', '/navigation-audit': 'sistema', '/modules/quality': 'producao', '/modules/reports': 'sistema' (ou o módulo pretendido); opcionalmente gatear valores no EconomicGroupDetail com canSeeFinancialValues.

### M13. [Rotas/UI/permissões] Modo granular de permissões bloqueia /orders (e todas as secondaryRoutes) sem forma de conceder acesso

- **Onde:** `src/hooks/useAccessControl.ts:315`
- Quando o usuário tem rows granulares (allow-list estrita por path), isRouteAllowed só libera rota cujo item de menu dono foi concedido — mas 'Ordens (OPs)' saiu do menu (navigation.ts: '/orders segue vivo via links dos cards/fila e busca global') e a matriz de permissões só grava paths que existem em getAllMenuItems (useUserManagement.ts valida contra a sidebar). Logo NÃO existe forma de conceder /orders a um usuário granular: resolveMenuOwner('/orders/...') = null → negado. Porém as telas de Produção linkam direto pra lá (ProducaoPlanejamento.tsx:289 e KanbanOpCard.tsx:80 `/orders/${id}/edit`) — usuário granular com Produção liberada clica na OP e cai em 'Acesso Restrito'. O mesmo vale pra todas as secondaryRoutes (/sac, /forecast, /patrimonio, /producao/produtividade etc.), que não são itens de menu e portanto nunca são concedíveis pela matriz.
- **Evidência:** useAccessControl.ts:315-319 `if (hasGranular) { const owner = resolveMenuOwner(path...); if (owner && grantedPaths.has(owner)) return true; ... return false; }` + :242 `ALL_MENU_PATHS = getAllMenuItems()` (só menuGroups); navigation.ts:61-62 '"Ordens (OPs)" saiu do menu'; useUserManagement.ts:283 `const valid = new Set(getAllMenuItems().map((i) => i.path));` e :291 `module: g.path`; links: src/pages/ProducaoPlanejamento.tsx:289, src/components/production/kanban/KanbanOpCard.tsx:80.
- **Fix sugerido:** No modo granular, tratar /orders como sub-rota do fluxo de Produção (ex.: mapear owner sintético: grant de '/producao/kanban' ou '/producao/planejamento' implica '/orders'), ou incluir secondaryRoutes/rotas-satélite na lista de paths concedíveis da matriz.

### M14. [Financeiro/compras] Semana de faturamento S1 divergente entre frontend (clamp) e SQL (sem clamp)

- **Onde:** `src/lib/billingWeek.ts:32`
- Para a semana 1 de um mes que nao comeca em segunda-feira, o frontend (monthWeekToISODate, que deriva sale_orders.delivery_deadline no SaleOrderForm.tsx:336) clampa a segunda-feira para o dia 1 do mes, mas a funcao SQL resolve_billing_week_for_order (que interpreta billing_week 'YYYY-MM-S#' para o motor de producao) NAO clampa e devolve a segunda da semana que contem o dia 1 — podendo cair no mes ANTERIOR. resolve_op_due_date (migration 20260912120000) devolve essa segunda + 4 (sexta), entao a OP de um PV com billing_week '2026-08-S1' (ago comeca sabado) ganha due_date 2026-07-31, um mes antes do delivery_deadline 2026-08-01 gravado pelo frontend — fila de producao marca atraso/urgencia numa semana que o comercial nao escolheu, e as parcelas de AR (ancoradas em delivery_deadline) discordam do due de producao. O proprio frontend tem duas semanticas: factoringCalc.getDeliveryWeekEndDate (linhas 44-49) segue o SQL (sem clamp), billingWeek.ts clampa.
- **Evidência:** src/lib/billingWeek.ts:31-34 — `// Clampa: se a segunda cair no mês anterior, usa dia 1 do mês selecionado / if (weekStart < firstDay) { return `${year}-...-${firstDay.getDate()}` }`. Já o SQL (supabase/migrations/20260504102501...sql:38-41, definição viva de resolve_billing_week_for_order): `v_dow := (EXTRACT(ISODOW FROM v_first_day)::int) - 1; v_billing_date := v_first_day - v_dow; v_billing_date := v_billing_date + ((v_week - 1) * 7);` — sem nenhum clamp; e resolve_op_due_date (20260912120000_production-engine-schema.sql:184) faz `RETURN v_monday + 4`.
- **Fix sugerido:** Escolher UMA semantica para S1 (sugestao: a do clamp, que respeita o mes escolhido) e aplicar nos 3 lugares: resolve_billing_week_for_order (adicionar clamp `IF v_billing_date < v_first_day THEN v_billing_date := v_first_day`), factoringCalc.getDeliveryWeekEndDate e billingWeek.ts; adicionar teste unitario com mes iniciando em sabado.

### M15. [Financeiro/compras] Reversao de faturamento nao estorna a despesa de juros de factoring

- **Onde:** `supabase/migrations/20260526120000_revert_invoiced_sale_order.sql:91`
- revert_invoiced_sale_order marca como 'estornado' apenas as financial_entries com reference_type='sale_order' (a receita). A entry de despesa de juros de factoring (reference_type='sale_order_factoring', criada 'confirmed' no faturamento) fica viva: apos reverter um PV faturado com factoring, a DRE (useDREAuto soma jurosFactoring filtrando so cancelado/cancelled/estornado) continua mostrando a despesa financeira de um faturamento que nao existe mais. O mesmo vale para o cancel-nfe (edge function so estorna reference_type='sale_order'). No financialSync, a remocao da entry de factoring so acontece no branch 'Cancelado' — PV revertido fica em 'Em Produção', branch que nao toca factoring. A despesa fantasma persiste ate o PV ser re-faturado ou cancelado.
- **Evidência:** Migration 20260526120000:87-93: `UPDATE public.financial_entries SET status = 'estornado' ... WHERE reference_type = 'sale_order' AND reference_id = p_sale_order_id` — nenhum UPDATE/DELETE para reference_type='sale_order_factoring'. Em src/lib/financialSync.ts:229-233, o delete de juros factoring existe SO no branch `so.status === 'Cancelado'`; o branch 'Aprovado'/'Em Produção' (linhas 431-450) nao toca factoring. useFinanceIntelligence.ts:299-305 soma a entry na DRE enquanto o status for 'confirmed'.
- **Fix sugerido:** No revert_invoiced_sale_order, estender o UPDATE de estorno para `reference_type IN ('sale_order','sale_order_factoring')` (o indice unico parcial de 20260616120000 ja exclui 'estornado', liberando re-faturamento); avaliar o mesmo no cancel-nfe.

### M16. [Produção/ondas] Motor de agenda diária ignora capacidade de ficha das duas Costuras (CASE sem as colunas novas)

- **Onde:** `supabase/migrations/20260920103000_schedule-holidays.sql:89`
- A migration do split aponta sector_settings.ficha_capacity_column para 'costura_palmilha_capacity_per_day'/'costura_cabedal_capacity_per_day', mas a função viva recompute_production_schedule (20260920103000, não tocada pela 20261001120000) resolve o override de ficha num CASE que só conhece as colunas antigas e cai em ELSE NULL para qualquer coluna desconhecida. Resultado: para Costura Palmilha e Costura Cabedal o motor ignora a capacidade da ficha e agenda pelo default global do setor (daily_capacity_pairs, herdado 600) — regressão vs. pré-split, quando 'costura_capacity_per_day' era honrada. Afeta production_schedule, o 'hoje: X/Y pares' do Kanban e o Planejamento.
- **Evidência:** CASE ss.ficha_capacity_column WHEN 'sewing_capacity_per_day' ... WHEN 'costura_capacity_per_day' THEN ... ELSE NULL END AS ficha_rate (linhas 89–101; o SELECT da ficha nas linhas 65–69 também não busca as colunas novas), enquanto 20261001120000 linhas 184–199 gravam ficha_capacity_column='costura_palmilha_capacity_per_day'/'costura_cabedal_capacity_per_day' e deletam a linha 'Costura'.
- **Fix sugerido:** Nova migration redefinindo recompute_production_schedule: adicionar as duas colunas ao SELECT da CTE ficha e dois WHEN no CASE ('costura_palmilha_capacity_per_day', 'costura_cabedal_capacity_per_day'), com fallback COALESCE(nova, costura_capacity_per_day).

### M17. [Produção/ondas] insole_ready_made: trigger SQL não remove 'Costura Palmilha' do roteiro, mas a UI afirma/finge que remove

- **Onde:** `supabase/migrations/20260723210000_strip-cut-sectors-only-on-ready-made-transition.sql:45`
- O trigger vivo tg_strip_cut_sectors_when_ready_made (20260723210000) remove apenas 'corte palmilha','corte forração','corte forracao','costura' (grafia legada exata). Após o split, o roteiro guarda 'Costura Palmilha' — que NÃO casa com 'costura' e sobrevive ao strip. A UI (READY_MADE_STRIPPED_SECTORS + chip desabilitado exibido como desmarcado) diz que Corte Palmilha, Corte Forração e Costura Palmilha 'são removidos automaticamente'. Ficha que já tinha Costura Palmilha e liga 'palmilha pronta na cor' mantém o setor no banco: a OP nasce com etapa Costura Palmilha e a ficha de operador imprime para um setor que não deveria existir (mesma família do fantasma PV-00146), com a UI mascarando o valor salvo.
- **Evidência:** WHERE LOWER(TRIM(value)) NOT IN ('corte palmilha','corte forração','corte forracao','costura') — 'costura palmilha' não está na lista; TechnicalSheets.tsx 4086: const READY_MADE_STRIPPED_SECTORS = ['Corte Palmilha','Corte Forração','Costura Palmilha'] e 4195: Checkbox checked={isActive && !lockedByReadyMade}. A 20261001120000 atualizou o normalize mas não este trigger.
- **Fix sugerido:** Migration atualizando o strip para incluir 'costura palmilha' (e o restore v_required para ['Corte Palmilha','Corte Forração','Costura Palmilha']), mantendo 'Costura Cabedal' intocada (decisão da fase 1).

### M18. [Produção/ondas] CapacityPlanning lê costura_*_capacity_per_day de query que não seleciona as colunas — KPI das costuras sempre no default 300

- **Onde:** `src/pages/CapacityPlanning.tsx:40`
- Em CapacityPlanning.tsx os cards de setor usam capField 'costura_palmilha_capacity_per_day'/'costura_cabedal_capacity_per_day', mas a query de orders embute technical_sheets selecionando apenas costura_capacity_per_day (legada). sheetCap(sheet, field, def) lê sheet[field] === undefined e cai direto no defaultCap 300 — sem sequer tentar a coluna legada. Capacidade média, occupancy e dias-para-concluir dos dois setores de Costura saem errados para toda ficha cuja capacidade real difere de 300.
- **Evidência:** Linhas 40–41: capField: 'costura_palmilha_capacity_per_day' / 'costura_cabedal_capacity_per_day'; select das linhas 149–159 traz só 'costura_capacity_per_day'; linhas 109–112: sheetCap lê sheet?.[field] e retorna def quando vazio; linha 240: const c = sheetCap(o.sheet, sc.capField, sc.defaultCap).
- **Fix sugerido:** Incluir costura_palmilha_capacity_per_day e costura_cabedal_capacity_per_day no select embutido (e idealmente fallback à coluna legada em sheetCap).

### M19. [Produção/ondas] Colunas novas de capacidade não são buscadas em nenhum fetch nem editáveis na ficha — split de capacidade é no-op no TS

- **Onde:** `src/lib/sectorCapacity.ts:123`
- leadTime.ts lê primeiro costura_palmilha/cabedal_capacity_per_day, mas nenhum ponto que monta o objeto sheet as seleciona: DEFAULT_LEAD_TIME_COLUMNS (usado por todas as telas p/ defaults de categoria), o select de checkSectorCapacity, useSectorDailyLoad, useSectorPeriodLoad e ForwardScheduleTool trazem só costura_capacity_per_day. Além disso o form da ficha (EXTRA_DB_FIELDS) só hidrata/salva a coluna legada. Hoje tudo cai no fallback legado (valores iguais por causa da cópia da migration), mas qualquer valor preenchido nas colunas novas (via SQL/MCP ou UI futura) será ignorado pelas telas — e o motor SQL da agenda também as ignora (achado 1) — divergência silenciosa garantida.
- **Evidência:** DEFAULT_LEAD_TIME_COLUMNS = 'shoe_category, cutting..., costura_capacity_per_day, silk..., lead_time_expedicao_dias' (123–124, sem as colunas novas); mesmo padrão em sectorCapacity.ts:176, useSectorDailyLoad.ts:105, useSectorPeriodLoad.ts:102, ForwardScheduleTool.tsx:48; TechnicalSheets.tsx 1365–1369 (EXTRA_DB_FIELDS só 'costura_capacity_per_day'); leadTime.ts 112–113 define capField nas colunas novas.
- **Fix sugerido:** Adicionar as duas colunas a DEFAULT_LEAD_TIME_COLUMNS e a todos os selects que alimentam getEffectiveCapacityPerDay/computeParallelWindows; expor os dois campos no form da ficha (ou remover as colunas novas e derivar tudo da legada até existir editor).

### M20. [Produção/ondas] Listas-default de criação de etapas ainda geram etapa 'Costura' (frontend e SQL) — etapa órfã fora do motor e do guard

- **Onde:** `src/hooks/useOrders.ts:174`
- Para ficha sem production_sectors, a OP nasce com etapa 'Costura' legada: useCreateOrder usa DEFAULT_SECTOR_NAMES com 'Costura', e os fallbacks SQL vivos (resync_op_atomic e tg_sync_orders_from_sale_order_item em 20260925133000) usam o mesmo ARRAY. Pós-split, 'Costura' não existe mais em sector_settings (DELETE na 20261001120000): o INNER JOIN do recompute_production_schedule descarta a etapa (nunca é agendada), no Kanban ela vira coluna extra jogada pro fim (flow_order 999), e o fn_guard da Colagem exige 'Costura Palmilha'/'Costura Cabedal' — uma etapa chamada 'Costura' com 0 pares nunca bloqueia a Colagem (pré-requisito silenciosamente pulado).
- **Evidência:** useOrders.ts 174–177: DEFAULT_SECTOR_NAMES = ['Corte Palmilha','Corte Forração','Aviamento','Costura','Silk',...]; 20260925133000 linhas 711/773/1304: ARRAY['Corte Palmilha','Corte Forração','Costura','Aviamento',...]; 20261001120000 linha 208: DELETE FROM sector_settings WHERE sector='Costura'; fn_guard (20261001120000, 293): Colagem exige ARRAY['Corte Palmilha','Costura Palmilha','Costura Cabedal'].
- **Fix sugerido:** Trocar 'Costura' por 'Costura Palmilha','Costura Cabedal' (na ordem canônica nova) nos três defaults (frontend + 2 funções SQL) via migration.

### M21. [Produção/ondas] OrdersKanbanBoard: OP em costura cai na coluna 'PREPARAÇÃO' (mapa de setores sem os nomes novos)

- **Onde:** `src/components/orders/OrdersKanbanBoard.tsx:55`
- O quadro editorial de /orders agrupa por SECTOR_TO_GROUP construído de STAGE_GROUPS, cuja coluna COSTURA lista sectors: ['Costura','Silk']. Etapas agora se chamam 'Costura Palmilha'/'Costura Cabedal' → lookup undefined → inferGroupKey cai no fallback 'preparacao'. Toda OP em andamento em qualquer costura é exibida na coluna PREPARAÇÃO, e os KPIs de contagem/pares por mega-grupo saem errados.
- **Evidência:** sectors: ['Costura', 'Silk'] (linha 55); inferGroupKey linha 114: return SECTOR_TO_GROUP[inProgress.stage_name] || 'preparacao'.
- **Fix sugerido:** Incluir 'Costura Palmilha' e 'Costura Cabedal' no grupo 'costura' (e manter 'Costura' pra legado).

### M22. [Produção/ondas] Planejamento de terceirização de Costura filtra pelo setor errado (palmilha) — a terceirizável é a de cabedal

- **Onde:** `src/components/contractors/OutsourcingPlanningTab.tsx:85`
- OutsourcingPlanningTab usa appliesTo: sheetHasSector(s, 'Costura'); normalizeSector resolve 'costura' → 'costura_palmilha'. Pela decisão registrada (fase 1 e comentário do split), quem é terceirizável é a Costura CABEDAL. Ficha que tenha só 'Costura Cabedal' no roteiro (ex.: costura de palmilha desmarcada) fica fora do planejamento de terceirização, e a capacidade usada é a coluna legada única — a demanda de costura terceirizável fica sub/super-contada conforme o mix.
- **Evidência:** { key: 'costura', label: 'Costura', appliesTo: (s) => sheetHasSector(s, 'Costura'), capPerDay: (s) => Number(s.costura_capacity_per_day || 0) } (85–89); sectors.ts: 'costura': 'costura_palmilha'; TechnicalSheets.tsx 4059: 'Costura Cabedal: costura do cabedal (é a terceirizável)'.
- **Fix sugerido:** Testar sheetHasSector(s, 'Costura Cabedal') (mantendo compat com legado via has_straps===false) e ler costura_cabedal_capacity_per_day com fallback à legada.

### M23. [Impressão] CANONICAL_STAGE_ORDER (TS) divergente do SQL após split da Costura — 'OP NN' impresso errado nas fichas

- **Onde:** `src/components/production/worksheet/stageOrder.ts:9`
- A migration 20261001120000 reescreveu a função SQL `canonical_stage_order` pro fluxo de 11 etapas (Costura Cabedal=4, Aviamento=5, Silk=6, Colagem=7, Montagem=8, Solagem=9, Acabamento=10, Expedição=11) e renumerou `order_stages.stage_order` no banco (passo 7c). O espelho TS `CANONICAL_STAGE_ORDER` — cujo próprio comentário diz 'espelha SQL function canonical_stage_order' — continua na numeração antiga de 10 etapas (Costura Cabedal=3, Aviamento=4, …, Expedição=10). Efeito no papel: o eyebrow `OP ${formatOpNumber(sector)}` de toda ficha imprime número divergente do stage_order vivo no banco (Aviamento sai 'OP 04' com o banco em 5; Expedição 'OP 10' vs 11), e as fichas de Costura Palmilha e Costura Cabedal saem AMBAS como 'OP 03' — dois setores distintos com o mesmo número de operação no traveler. O teste `stageOrder.test.ts` ('matches SQL canonical_stage_order (smoke test)') trava os valores obsoletos, dando falsa confiança.
- **Evidência:** stageOrder.ts:17-27: `'Costura Palmilha': 3, 'Costura Cabedal': 3, 'Aviamento': 4, … 'Expedição': 10` vs migration 20261001120000:63-74: `WHEN 'Costura Cabedal' THEN 4 / WHEN 'Aviamento' THEN 5 / … WHEN 'Expedição' THEN 11`; e o passo 7c: `UPDATE public.order_stages SET stage_order = public.canonical_stage_order(stage_name)`.
- **Fix sugerido:** Atualizar CANONICAL_STAGE_ORDER pro mapa de 11 etapas da migration (mantendo aliases 'Costura'→3, 'Mesa'→5) e corrigir o teste smoke pra refletir o SQL vivo.

### M24. [Impressão] printOperatorFichas viola regra obrigatória anti-header do navegador (@page margin 10mm) e sai do modelo canônico sem Controle de Fichas

- **Onde:** `src/lib/printOperatorFichas.ts:122`
- PRINT_SPEC §0 declara as regras anti-folha-branca OBRIGATÓRIAS pra TODA impressão A4, 'inclusive as geradas via window.open', e a regra §0.2-4 exige `@page { margin: 0 }` + padding interno — 'única forma programática de suprimir o header/footer do navegador (URL + data + Página 1 de 83)', artefato que o dono reportou com foto. Este gerador de fichas de operador A4 (botão 'Ficha de Operador', criado 2026-06-27, DEPOIS da spec) usa `@page{size:A4 portrait;margin:10mm}` — toda folha do maço sai com URL/data/nº de página do navegador. O caminho também não tem TallyBox/Controle de Fichas (o 6º passe deletou o popup legado `printSectorWorkSheet.ts` exatamente porque 'era por ele que o dono imprimia setores sem ver o Controle de Fichas') e não está classificado no inventário §0.4 da spec.
- **Evidência:** printOperatorFichas.ts:122: `@page{size:A4 portrait;margin:10mm}` vs PRINT_SPEC §0.2-4: '`@page { size: A4 portrait; margin: 0 }` + padding interno POR página (mata o header/footer do navegador)' e §0: 'OBRIGATÓRIAS para TODAS as A4 — inclusive as geradas via window.open'.
- **Fix sugerido:** Trocar pra `@page{margin:0}` movendo a área segura pro padding do `.ficha`/body (como printLabels.ts:434 e atrasoReportPrint.ts:80 já fazem), adicionar o tally de fornadas, e registrar o caminho na classificação §0.4 da PRINT_SPEC.

### M25. [RH/ponto] Motor de dia TS × SQL divergem (dedupe <5min e batida ímpar ≥5) — Pendências não mostra o que a Folha zera

- **Onde:** `src/lib/hourlyPayroll.ts:117`
- A view viva v_time_pendings (badge + aba Pendências, useTimePendings) usa a função SQL calculate_day_summary, que desde a mig 20260721280000 DEDUPLICA batida dupla (<5 min) e trata QUALQUER nº ímpar como 'irregular'. O motor TS da folha (splitDayMinutes) faz o OPOSTO: não deduplica (comentário explícito em useTimesheet.ts:630 'sem dedupe de 5min (a folha não dedupa)') e nº ímpar ≥5 É calculado (última batida = saída). Caso real (o mesmo do próprio comentário da migration): batidas [07:59, 08:01, 18:00] → folha TS vê 3 batidas → dia PENDENTE, 0h, não paga; SQL deduplica p/ [07:59, 18:00] → dia 'normal/overtime' → NÃO aparece na aba Pendências nem no badge. O chip de Situação da Folha manda 'resolver em Pendências', mas a pendência não está lá. Inverso também ocorre: [08:00,12:00,13:00,17:00,18:00] (5 batidas ≥5min entre si) → SQL lista como pendência, folha TS já paga o dia. A migration afirma 'espelha o JS', o que não é mais verdade desde o motor único de 2026-06-17.
- **Evidência:** src/lib/hourlyPayroll.ts:117 `if (n % 2 !== 0 && n < 5) return { normal: 0, premium: 0, incomplete: true };` (ímpar ≥5 calcula) + src/hooks/useTimesheet.ts:630 '…sem dedupe de 5min (a folha não dedupa)' VS supabase/migrations/20260721280000_day-summary-dedupe-double-punch.sql:36-52 (pré-passe `IF v_prev_min IS NULL OR ABS(v_min - v_prev_min) >= 5`) e :60 `IF v_count = 1 OR (v_count > 1 AND v_count % 2 <> 0) THEN … 'irregular'`; consumidor vivo: supabase/migrations/20260914120000_employee-payment-type-producao-por-par.sql:44 `public.calculate_day_summary(tr.punches, …)` em v_time_pendings, lida…
- **Fix sugerido:** Alinhar os dois motores: ou adicionar o dedupe <5min no splitDayMinutes TS (e aceitar ímpar≥5 no SQL tratando última batida como saída), ou remover o dedupe do SQL. Travar com teste de paridade (mesmo padrão do consumptionService.parity).

### M26. [RH/ponto] Excel da Folha e espelho impresso usam motor LEGADO (÷30, ×1,5) divergente do Resumo pago (÷dias úteis, R$/h) — e a nota afirma que a falta 'é exata'

- **Onde:** `src/lib/exportFolhaExcel.ts:65`
- O Resumo do Excel e a Folha (Payroll) vêm de computePeriodFolha com a política canônica: falta = salário ÷ dias úteis do mês, HE = R$/h absoluto por funcionário com mínimo 10min. Já o 'Detalhe dia a dia' do MESMO arquivo Excel e a seção de valores do espelho impresso usam evaluationDetail (printTimesheet), que calcula valorDia = salário ÷ 30 e HE = (sal/220) × 1,5. Para salário 3.000 num mês de 22 dias úteis, a falta desconta R$136,36 no Resumo e o Detalhe imprime R$100,00 — e a aba 'Como ler' afirma "Falta = desconta 1 dia (salário ÷ 30). O 'Desconto do dia (R$)' da falta é exato", o que é falso sob a política. Documentos de conferência/holerite contradizem o valor efetivamente pago.
- **Evidência:** src/lib/printTimesheet.ts:672 `const valorDia = vh * (SALARY_HOUR_DIVISOR / SALARY_DAY_DIVISOR);  // = salário ÷ 30` e :798 'Valor-dia = salário ÷ 30' VS src/lib/salaryPayroll.ts:91 '• falta = salário ÷ dias_úteis_do_mês (businessDaysDivisor)' e :239-241; mistura no export: src/lib/exportFolhaExcel.ts:43 `'Faltas (R$)': r2(r.mes.falta_desconto)` (política) × :65 `descontoDia = d.kind === 'falta' ? e.valorDia : …` (÷30) × :94 nota "Falta = desconta 1 dia (salário ÷ 30). O 'Desconto do dia (R$)' da falta é exato."
- **Fix sugerido:** Fazer evaluationDetail receber/derivar a mesma SalaryPolicy (valorDia por dias úteis do mês, HE por R$/h do funcionário) ou, no mínimo, corrigir as notas do Excel/print para declarar a fórmula real e parar de afirmar exatidão do valor ÷30.

### M27. [RH/ponto] minimum_overtime_minutes da escala é editável na UI mas a folha ignora (fixa 10)

- **Onde:** `src/lib/salaryPayroll.ts:590`
- A tela de escalas permite configurar 'Mín. HE para contar (min)' por escala, e as visões semanais do ponto (weeklyTimeCalculation) e o SQL (v_time_pendings passa COALESCE(ws.minimum_overtime_minutes,10)) usam esse valor. A folha (computePeriodFolha) porém usa `inp.minOvertimeMin ?? 10` e NENHUM caller passa o campo da escala (grep: só definições em salaryPayroll). Escala com mínimo ≠ 10 (ex.: 30) → o ponto descarta HE < 30min mas a folha paga a partir de 11min: HE paga ≠ HE exibida.
- **Evidência:** src/lib/salaryPayroll.ts:590 `minOvertimeMin: inp.minOvertimeMin ?? 10,` (nenhum caller em src/ passa minOvertimeMin — payrollComparativo.ts:179-194 não inclui) VS src/pages/Timesheet.tsx:222 input 'Mín. HE para contar (min)' e src/lib/weeklyTimeCalculation.ts:120/137 `const minimumOT = schedule.minimum_overtime_minutes || 0; … rawOvertime >= minimumOT`.
- **Fix sugerido:** Em payrollComparativo.ts (função folha) passar `minOvertimeMin: sch?.minimum_overtime_minutes ?? 10` — ou remover o campo da UI se a política do dono é 10 fixo.

### M28. [RH/ponto] Feriado 'recurring' só vale nas telas de Ponto — Folha, absenteísmo, Espelho e SQL usam a data crua (falta indevida no ano seguinte)

- **Onde:** `src/pages/Payroll.tsx:154`
- O quick-add de feriados nacionais grava com ano fixo E recurring=true (Timesheet.tsx:286). As telas de Ponto expandem recorrência por MM-DD (Timesheet, OverviewTab, LateArrivalsTab, ExceptionsTab, useTimeAnalytics), mas a Folha (Payroll), RelatorioAtrasos/Faltas, o absenteísmo (mandatoryHolidaySet) e a view SQL v_time_pendings comparam a data literal — no ano seguinte ao cadastro, o Ponto mostra feriado e a Folha desconta FALTA (dinheiro errado) e o absenteísmo conta dia útil a mais. O Espelho (EspelhoPontoPage) tem uma 3ª semântica: não expande recorrente NEM filtra `optional` (feriado facultativo vira 1,5× no espelho mas não na folha).
- **Evidência:** src/pages/Timesheet.tsx:286 `addHoliday.mutate({ …, holiday_date: `${year}-${h.date}`, recurring: true })` e :716-721 expansão `recurringHolidayMMDD.has(dateStr.slice(5))` VS src/pages/Payroll.tsx:154-158 `new Set(holidaysList.filter(h => h.optional !== true).map(h => h.holiday_date))` (sem expansão), src/lib/absenteeism.ts:83-85 idem, src/pages/EspelhoPontoPage.tsx:101 `new Set(holidays.map(h => h.holiday_date))` (sem optional e sem recorrência), supabase/migrations/20260914120000:50-51 `h.holiday_date = tr.record_date`.
- **Fix sugerido:** Criar um helper único (ex.: buildHolidaySet(holidays, from, to) que expande recurring por MM-DD e filtra optional) e usá-lo em Payroll, Relatórios, absenteísmo, Espelho e replicar a regra nas funções/views SQL.

### M29. [RH/ponto] Importação de ponto nunca mescla batidas em dia já existente — dia importado parcial (ou vazio) congela para sempre

- **Onde:** `src/hooks/useTimesheet.ts:1156`
- O import descarta qualquer registro cuja chave (employee_name, record_date) já exista no banco (skip), sem mesclar batidas novas. Dois cenários reais: (1) arquivo exportado no meio do dia grava o dia só com a entrada (batida ímpar) — reimportar o arquivo completo à noite é 'skipped' e o dia fica pendente/falta até edição manual; (2) funcionário no quadro sem batidas gera punches=[] para TODOS os dias do período — se um export corrigido trouxer as batidas reais desses dias, todas são ignoradas. O toast de 'nenhum registro novo' até orienta 'gere um download novo cobrindo até hoje', o que não resolve para esses dias. O RPC import_time_records_safe (ON CONFLICT DO NOTHING) tem o mesmo comportamento.
- **Evidência:** src/hooks/useTimesheet.ts:1156-1158 `const toInsert = uniqueRecords.filter(r => !existingKeys.has(`${r.employee_name}__${r.record_date}`));` + :1069-1084 geração de `punches: []` p/ cada dia do período de funcionário sem batidas + :1302-1305 toast sugerindo novo download.
- **Fix sugerido:** Quando a key existe, comparar punches: se o registro do arquivo é superset do existente (ou o existente está vazio), fazer UPDATE mesclando (Set union, sort) em vez de skip — de preferência dentro do RPC import_time_records_safe (ON CONFLICT DO UPDATE com merge de jsonb).

### M30. [RH/ponto] namesMatch aceita substring: nome curto cadastrado casa dentro de nome maior (mistura ponto de funcionários distintos)

- **Onde:** `src/lib/employeeMatching.ts:26`
- A auditoria 2026-06-14 endureceu o fallback de tokens (≥2 tokens ≥4 chars), mas o primeiro ramo continua aceitando CONTAINMENT de substring do nome inteiro: normalizeName('Ana') está contido em 'mariana silva' ('mari-ana' casa), e o compactName agrava ('ana' ⊂ 'marianasilva'). Funcionário cadastrado só com o primeiro nome (ou nome curto do relógio) pode capturar batidas de outra pessoa nas abas Overview/Atrasos/Divergências (que usam findEmployeeMatch com linkedOnly) quando não há external_id coligado — exatamente o tipo de mistura de ponto/folha que o fix anterior visava.
- **Evidência:** src/lib/employeeMatching.ts:26 `if (nl === nr || nl.includes(nr) || nr.includes(nl)) return true;` e :30 `if (cl === cr || cl.includes(cr) || cr.includes(cl)) return true;` — 'ana' é substring de 'mariana silva' em ambos os ramos; uso em src/components/timesheet/OverviewTab.tsx:102, LateArrivalsTab.tsx:117, DivergencesTab.tsx:76.
- **Fix sugerido:** Restringir o containment a fronteira de token (ex.: startsWith/endsWith com espaço, ou includes(' '+nr+' ') em ' '+nl+' ') e exigir ≥2 tokens quando um dos nomes tem 1 token só.

### M31. [Orquestrador (inline)] Padrão 'Number(x) ?? fallback' nunca aplica o fallback (NaN) no editor de consumo do solado

- **Onde:** `src/components/technical-sheets/SolesComponentSheetTab.tsx:121`
- `consumption: draft?.consumption ?? Number(baseConsumption) ?? 1` e `waste_pct: ... ?? Number(baseWaste) ?? 0`: quando `baseConsumption`/`baseWaste` é undefined/valor não-numérico, `Number()` devolve NaN — e `??` só captura null/undefined, então o `?? 1`/`?? 0` é inalcançável (o ESLint acusa `no-constant-binary-expression` nas duas linhas). O campo de consumo da ficha de componente do solado pode inicializar como NaN em vez do default.
- **Evidência:** src/components/technical-sheets/SolesComponentSheetTab.tsx:121-122; regra: Number(undefined)=NaN e NaN ?? x === NaN.
- **Fix sugerido:** Trocar por `Number.isFinite(Number(base)) ? Number(base) : 1` (idem waste_pct com 0).

### M32. [Orquestrador (inline)] Drift de rastreamento de migrations: 238 arquivos do repo sem registro em schema_migrations

- **Onde:** `supabase/migrations/`
- 238 migrations do repo (incluindo TODAS de set/out 2026, ex. 20261001120000) não constam em supabase_migrations.schema_migrations, e 753 versões registradas no banco não têm arquivo 14-dígitos correspondente (aplicações via MCP com versão auto-gerada). Sondagem confirma que o CONTEÚDO recente está aplicado (canonical_stage_order, component_color_defaults, list_stock_debit_holes existem no vivo) — o gap é de rastreamento, não de funcionalidade. Risco: reativar o auto-apply do GitHub Action (`supabase db push`) tentaria re-executar as 238; as não-idempotentes falham/corrompem. O workflow supabase-migrate.yml já está com trigger automático desativado por exatamente isso (nota de 2026-05-12), mas o backlog só cresceu desde então (era ~35, hoje 238).
- **Evidência:** list_migrations (MCP): 1680 versões no banco; repo: 1165 arquivos com timestamp; diff: 238 sem registro / 753 sem arquivo. Sondas no vivo: fn canonical_stage_order=1, tabela component_color_defaults=true.
- **Fix sugerido:** Rodar scripts/repair-applied-migrations.sh com a lista completa (gerar via diff acima) marcando --status applied, e só então considerar reativar o push automático; enquanto isso, manter aplicação via MCP como via canônica.


---

## 4. Baixos confirmados

### B1. [Banco vivo] Kardex quebrado: products.quantity diverge da soma de stock_movements em dezenas de produtos ativos

- audit_stock_drift_report() lista 50+ produtos ativos com drift entre a quantidade em banco e a soma dos movimentos. Casos 'drift_alto' com movimentos registrados: solado '01' (SL01-02) quantity=0 mas movimentos somam −868 (débitos além do estoque que entrou — o trigger trg_prevent_negative_product_stock clampa em 0 e a diferença se perde); '238' drift 452; CAIXA INDIVIDUAL 11 drift 298; CAIXA COLMEIA 11 drift 260; NAPA SOFT-COGUMELO drift 105. Há também muitos 'sem_movimentos' (estoque seed sem movimento de entrada — rastreabilidade zero). Consequência: kardex não audita o saldo, e ajustes/débitos futuros partem de base não confiável.
- **Evidência:** SELECT * FROM audit_stock_drift_report() → {name: '01', sku: 'SL01-02', db_quantity: '0.00', movements_total: '-868', drift: '868.00', movement_count: 7, drift_severity: 'drift_alto'}; {name: 'CAIXA INDIVIDUAL 11', db_quantity: '0.00', movements_total: '-298.00', drift: '298.00', movement_count: 11}.
- **Fix sugerido:** Inventário físico dos itens drift_alto + movimento de ajuste ('adjustment_in/out') para reconciliar; para itens 'sem_movimentos', registrar movimento de saldo inicial para restabelecer a trilha.

### B2. [Fluxos de estoque] Fallback legado do resyncOPs deleta material_reservations ANTES de restore_sole_grade_for_order — estorno de grade vira no-op e re-débito debita a grade 2×

- **Onde:** `src/lib/resyncOPs.ts:168`
- No caminho fallback não-atômico de resyncOPsForSheet (ativado só quando a RPC resync_op_atomic não existe — PGRST202), o passo 2 deleta TODAS as material_reservations da OP (linha 168) e só depois o passo 3b chama restore_sole_grade_for_order (linha 191). A versão viva dessa função (mig 20260721270000) restaura a grade LENDO as reservas kind='sole_grade' com metadata.effective_grade — que acabaram de ser deletadas — então restaura NADA. Como o passo 1 já creditou o total escalar via adjustStockSafe (quantity, sem tocar stock_grade), o re-débito do passo 5 (debit_sole_stock_by_grade hard) baixa uma stock_grade JÁ decrementada: baldes por numeração debitados 2× com quantity debitada 1× (drift grade↔quantity, baldes zerados indevidamente). O comentário da linha 189-190 diz exatamente o que o código deveria garantir ('sem isso, o re-débito posterior cai sobre uma grade já decrementada'), mas a ordem das operações derrota a intenção. Risco latente: em produção a RPC existe, mas o caminho está vivo no código e dispara sozinho num ambiente sem a migration 20260504180000.
- **Evidência:** src/lib/resyncOPs.ts:168 — `await supabase.from('material_reservations').delete().eq('order_id', op.id);` seguido de src/lib/resyncOPs.ts:191 — `await supabase.rpc('restore_sole_grade_for_order', { p_order_id: op.id })`. A função viva (supabase/migrations/20260721270000:78-88) itera `material_reservations ... WHERE (metadata ->> 'kind') = 'sole_grade' AND status IN ('consumed','converted')` — rows já deletadas pelo passo 2 ⇒ loop vazio.
- **Fix sugerido:** Mover a chamada de restore_sole_grade_for_order para ANTES do delete de material_reservations (entre os passos 1 e 2), ou remover de vez o fallback não-atômico (a RPC resync_op_atomic existe em produção desde 20260504180000) e falhar com instrução de aplicar a migration.

### B3. [Hooks/React Query] useSaleOrderAllItems sem .limit e sem .order — truncamento silencioso no teto de 1000 linhas do PostgREST

- **Onde:** `src/hooks/useSaleOrders.ts:520`
- O hook busca TODOS os sale_order_items sem `.limit()` nem `.order()`. O Supabase/PostgREST corta respostas no max-rows (default 1000) sem erro — convenção que o próprio código reconhece (useOrders limita a 1000 e loga 'hit 1000-row ceiling'; useProducts pagina em blocos de 1000). Hoje a tabela tem 316 linhas (verificado no banco vivo), então o bug é latente, mas o consumo cresce a cada PV: ao passar de 1000, os consumidores passam a receber um subconjunto NÃO determinístico (sem ORDER BY) — e um deles é o ComissoesTab, que calcula comissão sobre `quantity × unit_price` dos itens: comissões seriam subcontadas em silêncio, sem qualquer aviso.
- **Evidência:** src/hooks/useSaleOrders.ts:520-523: `const { data, error } = await supabase.from('sale_order_items').select('id, sale_order_id, reference_id, color, quantity, unit_price');` — único fetch de tabela-transacional em useSaleOrders sem limit/paginação; comentário nas linhas 515-517 confirma os consumidores (SaleOrders.tsx, ComissoesTab, OutsourcingPlanningTab). Contagem viva: sale_order_items = 316.
- **Fix sugerido:** Paginar com `.range()` em loop (padrão de useProducts.ts:35-67) ou, no mínimo, adicionar `.order('created_at')` + `.limit(N)` explícito com warning ao atingir o teto, como useOrders.ts:31-33.

### B4. [Hooks/React Query] Idempotência per-PV das OCs automáticas depende de SELECT com erro engolido

- **Onde:** `src/hooks/useSaleOrders.ts:179`
- generateAutoPurchaseOrders (roda no Aprovar e no Faturar) tem dois guards anti-duplicação — (a) 'se este PV já gerou OC auto linkada, não reprocessa' e (b) reuso de OC pendente por fornecedor — ambos alimentados por um único SELECT de purchase_orders cujo erro é descartado. Se a query falhar, `existingPOs` fica null, os dois guards viram no-op e o fluxo cria OCs novas para o cesto inteiro de produtos abaixo do mínimo — exatamente a classe de bug que o comentário da linha 187 documenta ('bloqueia o double-fire que criava 14 OCs idênticas'). Como a criação subsequente usa a RPC upsert_open_purchase_order/inserts diretos sem outra checagem por PV, a duplicação não é barrada server-side nesse caminho.
- **Evidência:** src/hooks/useSaleOrders.ts:179-190: `const { data: existingPOs } = await (supabase as any).from('purchase_orders').select('id, supplier_id, supplier_name, linked_sale_order_ids').eq('status', 'pending').eq('auto_generated', true)...; if (saleOrderId && (existingPOs || []).some((po: any) => (po.linked_sale_order_ids || []).includes(saleOrderId))) { return; }` — `error` nunca é lido; com `existingPOs=null` o `.some()` roda sobre `[]` e o guard passa reto.
- **Fix sugerido:** Capturar o erro e ABORTAR a geração automática quando o SELECT falhar (`if (err) { console.error(...); return; }`) — em dúvida, é mais seguro não criar OC do que criar duplicada; o fluxo é best-effort e o MRP re-sugere na próxima passada.

### B5. [Orquestrador (inline)] stockAvail vira NaN (nunca null) na decisão de embalagem

- **Onde:** `src/components/packaging/PackagingDecision.tsx:103`
- `Number((c.box_types as any)?.quantity) ?? null`: se quantity está ausente, `Number(undefined)`=NaN e o `?? null` nunca aplica — stockAvail segue NaN (comparações downstream sempre false / exibição 'NaN').
- **Evidência:** src/components/packaging/PackagingDecision.tsx:103 (ESLint no-constant-binary-expression).
- **Fix sugerido:** `const q = Number(...); const stockAvail = Number.isFinite(q) ? q : null;`

### B6. [Orquestrador (inline)] ESLint não é gate de CI e está 99% afogado em no-explicit-any

- **Onde:** `eslint.config.js`
- `bun run lint` acusa 4.956 erros, dos quais 4.834 são @typescript-eslint/no-explicit-any — regra que contradiz a filosofia TS-loose documentada no CLAUDE.md. O CI (ci.yml) não roda lint, então as ~120 violações de regras que pegam bug real (no-fallthrough, no-dupe-else-if, no-constant-binary-expression — 2 delas viraram achados desta auditoria) ficam invisíveis.
- **Evidência:** bun run lint → 4.956 erros; ci.yml sem step de lint; breakdown: 4.834 no-explicit-any, 21 no-empty, 7 no-constant-binary-expression, 1 no-fallthrough, 1 no-dupe-else-if.
- **Fix sugerido:** Desligar no-explicit-any no eslint.config.js (alinha com o TS loose intencional), zerar o resíduo real (~120) e adicionar `bun run lint` ao ci.yml.


---

## 5. Baixos NÃO verificados individualmente

> Reportados pelos auditores com evidência, mas sem passe adversarial dedicado (custo/benefício). Tratar como leads.

1. **[Banco vivo]** 26 fichas ainda no padrão de forro-cabedal duplicado com palmilha (bug PV-00146)
   consumption_consistency_report() lista 26 fichas (120, 140, 170, DS05..DS22, EC06, EC23, EC60, I-series, S-039, SP1xx, ST15/17, TR05) no padrão de cadastro em que lining_consumption escalar duplica a área da palmilha dirigida pelo solado. A supressão em runtime (suppressCabedalFo…

2. **[Banco vivo]** 34 fichas de componente com dimensões possivelmente trocadas (comprimento > largura)
   audit_unit_invariants() marca 34 component_sheets lineares com padrão '1000x1370' (GLOW METALIC, NAPA SOFT, Tira Overlock COBRE…) onde o comprimento cadastrado excede a largura — provável troca de campos. Como a largura da ficha de componente é o divisor da conversão dm²→metros l…

3. **[Banco vivo]** Tabelas de lixo no schema de produção (_tmp_fn_backup, sole_technical_specs_backup_20260630)
   Duas tabelas de backup/temporárias vivem no schema public do banco de produção: _tmp_fn_backup (2 rows) e sole_technical_specs_backup_20260630 (63 rows). Não corrompem nada, mas ficam expostas a RLS/policies default e poluem o schema.…

4. **[Motor de consumo TS]** groupHasColor compara cor SEM remover acento — diverge do resto do motor e do SQL — `src/lib/orderConsumption.ts:900`
   A eleição de material principal vs alternativa (resolveOption→groupHasColor) usa apenas toLowerCase().trim(), enquanto todo o resto do motor (normalizeColorKey, normColorCanonical, resolveMaterialProductCanonical) e o SQL (group_covers_color→resolve_material_product com unaccent)…

5. **[Motor de consumo TS]** Palmilha com estoque em m²/cm²: linha emitida em dm² sem conversão → comparação verde/vermelho 100× errada — `src/lib/orderConsumption.ts:1282`
   isAreaStockUnit aceita m²/m2/cm²/cm2 além de dm², mas o ramo 'estoque em ÁREA' emite a linha sempre com productUnit 'dm2' e totalQuantity em dm², sem converter para a unidade real do produto. Para produto com unit='dm²' (o caso do fix original, PLACA 1.0 EVA) a comparação é 1:1 e…

6. **[Fluxos de estoque]** Recebimento de OC: falha ao marcar received_at após crédito bem-sucedido só é logada — retry re-credita o item (duplo crédito) — `src/pages/PurchaseOrders.tsx:1081`
   Em handleFinalize e handleMarkReceived, o crédito de estoque via adjust_stock acontece primeiro e a marcação de idempotência (received_at/received_quantity no purchase_order_items) vem depois; se essa marcação falhar (RLS/rede), o código apenas faz console.error e segue. Num retr…

7. **[Hooks/React Query]** Propagação de consumo entre variantes de cor do solado falha em silêncio — `src/hooks/useSoleStandardItems.ts:14`
   resolveSoleSiblingIds sustenta o invariante 'cadastrar consumo em uma variante propaga para todas as cores do mesmo solado' (usado por useUpsertSoleStandardItem e useRemoveSoleStandardItem), mas engole o erro das duas queries: se o fetch do anchor ou o dos candidatos falhar, reto…

8. **[Rotas/UI/permissões]** Cópia duplicada de check-navigation-access.mjs na raiz do repo está quebrada (resolve path errado) — `check-navigation-access.mjs:13`
   Existem duas cópias idênticas do validador de navegação: scripts/check-navigation-access.mjs (usada pelo build e por check:navigation — funciona) e uma na raiz do repo. Como o script computa ROOT = resolve(__dirname, '..'), a cópia da raiz resolve pra /home/user (fora do repo) e …

9. **[Rotas/UI/permissões]** Dead code em App.tsx: 4 lazy consts nunca renderizados e 2 rotas irmãs duplicadas inalcançáveis — `src/App.tsx:103`
   App.tsx declara 4 React.lazy que nenhuma rota renderiza: Contractors (rota /contractors virou redirect), PCPDashboard, CapacityDistribution (rota /capacity-planning/distribuir virou redirect na linha 1051, contradizendo o comentário da linha 101-102 que diz que 'a filha segue viv…

10. **[Rotas/UI/permissões]** 13 páginas órfãs em src/pages/ sem rota e sem importador (dead code, com comentários desatualizados) — `src/pages/ProductionLive.tsx:1`
   Arquivos em src/pages/ que não têm rota em App.tsx nem são importados por nenhum outro módulo (verificado por grep de import estático, relativo e dinâmico): AbsenceReport, DashboardCharts, FinanceiroDashboard, HeadcountReport, MaintenancePage, MaterialConsumption, ProductionLive,…

11. **[Financeiro/compras]** Caminhos de reversao do gate anti-ghost-revenue preservam receita 'confirmed' sem estorno compensatorio — `src/lib/financialSync.ts:193`
   Quando um PV faturado vira informal (nfe_required flipado para false depois do Faturar — cenario que o proprio comentario do branch antecipa) ou o gate anti-ghost-revenue dispara depois de a receita ja ter sido reconhecida, o financialSync cancela as parcelas de AR mas so DELETA …

12. **[Produção/ondas]** Telas de monitoramento legadas seguem com lane única 'Costura' (Central de Produção, RCCP, ProductionPipeline) — `src/pages/ProductionControlCenter.tsx:25`
   ProductionControlCenter monitora 'Costura' única (colunas da view purchase_projection_timeline + costura_capacity_per_day), RCCPPlanning lê costura_capacity_per_day da view v_capacity_driven_lead_times como setor único, e ProductionPipeline (OrderEdit) não tem step pros nomes nov…

13. **[Impressão]** Regra WYSIWYG violada: .print-area .section-label muda tamanho de fonte só em @media print — `src/index.css:1472`
   A regra WYSIWYG (PRINT_SPEC §0.2-1, 'NÃO devolver estas regras pro @media print') proíbe qualquer regra que altere ALTURA de conteúdo viver só em @media print, porque o PaginatedSheet mede o layout de TELA pra empacotar as folhas. `index.css` mantém `.print-area .section-label { …

14. **[Impressão]** PRINT_SPEC.md e CLAUDE.md desatualizados vs implementação de print — `docs/PRINT_SPEC.md:505`
   Divergências verificadas entre a spec canônica (última revisão 2026-06-19) e o código atual: (1) §4 e §7 listam o primitive `<SignatureFooter>` em `src/components/production/worksheet/` — o arquivo não existe (substituído pelo CompletionFooter; o CSS de PrintWorkSheetsPage ainda …

15. **[RH/ponto]** v_time_pendings não suporta external_id CSV nem nome fuzzy — funcionário multi-matrícula fica sem pendências — `supabase/migrations/20260914120000_employee-payment-type-producao-por-par.sql:63`
   O frontend suporta múltiplas matrículas por funcionário em employees.external_id como CSV ('8,14' — split(',') em findEmployeeMatch), mas a view v_time_pendings faz join por igualdade exata `e.external_id = tr.employee_external_id` (e nome só por lower/trim exato, sem acento-fold…

16. **[RH/ponto]** AEJ: layout subset auto-declarado e PIS sempre '000000000000' sem aviso — arquivo não serve para fiscalização — `src/lib/aejExporter.ts:143`
   O gerador de AEJ admite no próprio cabeçalho ser um 'subset do anexo da Portaria 671' (sem tipo 4/ajustes) e sem assinatura ICP-Brasil (este último É avisado via toast). Porém o campo PIS do registro tipo 2 sai SEMPRE zerado — employee.pis nunca é populado ('futuro — coluna não e…

17. **[RH/ponto]** Tolerância de 10min ressuscita em fallbacks: weeklyTimeCalculation e escalas-fallback hardcoded contrariam a remoção de 2026-06-30 — `src/lib/weeklyTimeCalculation.ts:119`
   O dono removeu a tolerância (folha fixa 0; mig 20260830140000 zera a coluna e o default no banco). Mas calculateWeeklyPeriod usa `schedule.tolerance_minutes ?? 10` e as escalas-fallback hardcoded das abas de ponto (Overview/Exceptions/LateArrivals/ManualEntry/Divergences/useTimeA…


---

## 6. Refutados na verificação adversarial (transparência)

1. ~~ProductionPipeline não reconhece 'Costura Palmilha'/'Costura Cabedal' como etapa atual~~ (SQL consumo/custeio) — A premissa do cenário de falha não se sustenta: o ÚNICO caller de ProductionPipeline é src/pages/OrderEdit.tsx:210, que passa `currentPipelineStep` — um token de fase calculado localmente a partir dos status de order_stages (OrderEdit.tsx:116-131), com valores possíveis 'corte' | 'preparacao' | 'montagem' | 'expedicao'…

2. ~~Soles Hub grava stock_grade a partir de cache stale (read-modify-write sem guard de concorrência)~~ (Fluxos de estoque) — O padrão read-modify-write existe como descrito (SolesCadastroTab.tsx:150-153 e 190-191 espalham sole.stock_grade vindo do cache ['soles_hub_products'] e reescrevem o objeto inteiro). Porém há proteção server-side que bloqueia exatamente o cenário reportado: o trigger trg_check_grade_quantity_coherence (BEFORE UPDATE O…

3. ~~Tabelas de sinônimos de unidade divergem: 'mts' fora de LINEAR_UNITS e 'chapa' fora de PLATE_UNITS (risco ~100× silencioso)~~ (Motor de consumo TS) — A divergência textual das tabelas existe (materialConsumption.ts:40/45 sem 'mts'/'chapa'; nfUnitConversion.ts:22/38 aceita ambas; unitConversion.ts:55 chapa→'chapa' identidade), mas a premissa central do achado — 'a normalização de 2026-05-30 foi one-shot' e as grafias 'PODEM reaparecer no cadastro' — é falsa: há prote…

4. ~~Preset 'Cabedal Forrado' grava 'Corte Cabedal' que tg_normalize_production_sectors descarta em silêncio~~ (SQL consumo/custeio) — A mecânica citada é real, mas o DEFEITO alegado (etapa Corte Cabedal "some do roteiro e nunca vira order_stage nem ficha de operador") não existe — 'Corte Cabedal' NÃO é setor de roteiro por design documentado, e a ficha de operador dele é gerada por outro caminho que não depende de production_sectors. Fatos verificado…

5. ~~Fluxo 'Aprovado' engole erro do SELECT anti-duplicação de OPs — risco de OP duplicada com débito duplo de estoque~~ (Hooks/React Query) — O trecho citado existe como descrito (src/hooks/useSaleOrders.ts:1341-1344 realmente descartam `error` dos dois SELECTs, e a linha 1365 usa o Set como guard), mas o cenário de dano alegado — OP duplicada com débito duplo — é inalcançável por DUAS proteções server-side que o auditor não viu, ambas verificadas VIVAS no b…

---

## 7. Segurança e infraestrutura (diagnóstico do orquestrador)

### 7.1 Advisors de segurança do Supabase — 472 apontamentos

| Categoria | Qtd | Observação |
|---|---|---|
| `security_definer_view` (ERROR) | 13 | Views que **bypassam RLS** do consultante: `v_products_below_rop`, `v_faturado_sem_ar`, `v_sector_load_by_reference`, `v_service_order_contractor_balance`, `v_time_pendings`, `v_ncm_coverage`, `v_sector_cost_per_minute`, `v_fixed_assets`, `v_product_abc`, `v_bom_audit_issues`, `v_materials_config_issues`, `purchase_projection_timeline` + 1 |
| `rls_disabled_in_public` (ERROR) | 1 | `_tmp_fn_backup` — tabela de lixo, dropar (ver §5) |
| `authenticated_security_definer_function_executable` | 305 | Funções SECURITY DEFINER executáveis por qualquer `authenticated` — o achado A12 (punch) é o caso mais grave; revisar as de escrita |
| `anon_security_definer_function_executable` | 71 | Executáveis **sem login** (`anon`) — inclui `apontar_producao_setor`, `finalize_production_sector`, `create_product_with_initial_stock`, `reserve_missing_materials_for_order`, `resync_*`. **Reduzir a superfície: REVOKE de anon nas funções de escrita é prioridade de segurança** |
| `rls_policy_always_true` | 23 | Policies USING/WITH CHECK `true` p/ authenticated em `fuel_prices`, `inventory_counts/_items`, `labor_cost_results`, `order_lots`, `sector_labor_rates`, `time_studies`, `sector_distribution_plan`, etc. — RLS de fachada |
| `function_search_path_mutable` | 51 | Funções sem `SET search_path` — vetor de hijack em SECURITY DEFINER |
| `rls_enabled_no_policy` | 4 | `punch_device_map` (ver A13), `sole_technical_specs_backup_20260630`, `wa_messages`, `wa_pending_actions` — RLS ligado sem policy = ninguém lê via API (ok p/ backup; conferir intenção nas `wa_*`) |
| `public_bucket_allows_listing` | 3 | `note-images`, `reference-images`, `silk-images` listáveis por qualquer um |
| `auth_leaked_password_protection` | 1 | Proteção contra senha vazada (HIBP) **desativada** — ligar no dashboard Auth |

Detalhe completo salvo durante a auditoria; regenerável via MCP `get_advisors(security)`.

### 7.2 Advisors de performance — 262 apontamentos

| Categoria | Qtd | Observação |
|---|---|---|
| `auth_rls_initplan` | 10 | Policies re-avaliando `auth.uid()`/`current_setting()` por LINHA (`note_folders` etc.) — envolver em `(select …)`; já houve mig `20260927120000` p/ outras tabelas, faltam estas |
| `multiple_permissive_policies` | 52 | Policies permissivas duplicadas p/ mesmo role/ação (ex.: `group_color_sources` com `gcs_read`+`gcs_write` ambas em SELECT) — cada SELECT avalia todas |
| `unindexed_foreign_keys` | 58 | FKs sem índice de cobertura (ex.: `component_color_defaults.product_id`) — joins e cascades lentos |
| `unused_index` | 138 | Índices jamais usados — candidatos a DROP (reduz custo de escrita) |
| `no_primary_key` | 4 | Inclui `_tmp_fn_backup` |

### 7.3 Rastreamento de migrations (drift)

Ver achado **M32** (§3): 238 arquivos do repo sem registro em `schema_migrations` / 753 versões
no banco sem arquivo. Conteúdo recente CONFIRMADO aplicado no vivo por sondagem
(`canonical_stage_order`, `component_color_defaults`, `list_stock_debit_holes`,
`sector_display_to_enum('Costura Palmilha')='costura'`). O trigger automático do
`supabase-migrate.yml` segue desativado — correto enquanto o repair não for feito.

---

## 8. Cobertura — o que cada auditor checou e encontrou OK

<details>
<summary><b>Banco vivo</b> — 14 itens verificados OK</summary>

- reserved_stock 100% sincronizado: 0 produtos divergem de SUM(quantity_reserved−quantity_consumed) das material_reservations status='reserved' — invariante do trigger tg_sync_reserved_stock confirmado no banco vivo (obs.: status ativo é 'reserved', não 'active')
- list_orphan_reservations() → vazio (nenhuma reserva órfã)
- list_materials_missing_width() → vazio (todos os materiais de área usados em fichas têm largura cadastrada — regra dm²→m do CLAUDE.md operável)
- broken_sale_order_links_report() → 0 nos 3 checks críticos (OP ativa sem item do PV; OS com vínculo destruído; item com >1 OP ativa — travado por ux_orders_one_active_op_per_item)
- component_colors_consistency_report() → 0 em todos os 11 checks (cpc_* e ccd_*: produto inexistente/inativo, quantidade inválida, duplicada, cor órfã, fora do grupo, duplicidade de variantes)
- financial_entries: nenhuma duplicata ativa por (reference_id, reference_type) fora de status cancelado/estornado — unique index parcial da mig 20260524160000 segurando
- Unidades canônicas: products.unit só contém m(143), un(15), par(12), kg(7), cm(4), dm²(1), L(1) — nenhum sinônimo proibido (metro/mt/unid/chapa/gr); nenhum conversion_rate=0; nenhum purchase_unit=unit com conversion_rate≠1
- audit_unit_invariants(): purchase_unit_missing_rate=0, purchase_unit_spurious_rate=0, linear_material_price_placeholder=0
- audit_unit_divergences(): 11 dos 13 checks zerados (insole/lining/sole/strap/fachete/soles_unit_not_par todos ok) — só o caso CF 03 reportado como achado
- consumption_consistency_report(): material_linear_sem_largura=0, palmilha_pronta_com_consumo_area=0, solado_dirige_consumo_sem_specs=0, persize_diverge_do_escalar=0, cor_sem_mapeamento_componentes_por_cor=0, direct_components_nome_desatualizado=0
- pcp_freshness_report(): compra_iminente_7d=0
- audit_duplicate_triggers(): inspecionado — contagens altas (11 BEFORE INSERT em technical_sheets, 6 AFTER UPDATE em orders) são triggers distintos por design, sem duplicata do mesmo trigger
- check_grade_quantity_coherence / check_sale_order_single_active_wave / check_purchase_order_idempotency: são funções TRIGGER (não reports) — invariantes ativos no schema, não executáveis como SELECT
- debit_consistency_report(): NÃO executável via MCP — RAISE 'Permission denied: usuario nao aprovado' (gate de auth por usuário aprovado); cobertura equivalente obtida via list_stock_debit_holes(), que gerou o achado crítico

</details>

<details>
<summary><b>Motor de consumo TS</b> — 17 itens verificados OK</summary>

- TECHNICAL_SHEET_CONSUMPTION_COLUMNS: extração independente (regex própria sobre o fonte) dos 20 campos sheet.* lidos pelo motor — TODOS presentes no select; nenhum campo faltando (id/lining_consumption_per_size/sole_group_id sobram no select, inofensivo)
- Guard de contrato auto-derivado em orderConsumption.test.ts:1100-1152 cobre orderConsumption E o select inline de bomConsumption (regex pega sheet.x, sheet?.x, (sheet as any).x) com sanity check anti-falso-verde (read.size > 15)
- Conversão dm²→m linear correta: largura da ficha de componente (max(width,length) em mm ÷10 = dm²/metro) + waste_pct aplicados em convertDm2ToLinearMeters; dm²→placa pela área da placa em dm² + perda (convertDm2ToPlates); branch cm ÷100 em areaToStockDivisor espelha o SQL
- Item linear DIRETO sem ficha de componente NÃO converte (orderConsumption.ts:1920 'if (isLinearUnit && cs)'); tiras via calculateStrapConsumptionCm/100 — regra canônica respeitada
- suppressCabedalForracao exige sheet.sole_drives_consumption === true nos DOIS motores (orderConsumption.ts:1111, bomConsumption.ts:564) + insole_lining_consumption_dm2>0 + lining_consumption_dm2 nulo — espelho fiel da mig 20260911120000; teste dedicado trava a coluna no select
- widthMissing marcado em todos os caminhos de área sem largura (cabedal, forro, forração palmilha, fachete, BOM linear com ficha) e a UI trata a linha como neutra (não verde/vermelho) — MaterialConsumptionView linhas 101/148/804
- Disponibilidade não-solado = estoque LÍQUIDO max(0, quantity − reserved_stock), medido nos productIds exatos quando a linha sabe a origem (fix Fivela 12mm/PV-00147), senão por grupo+cor (consumptionRows.ts:97-127)
- Solado por numeração via stock_grade bruto com baldes conjugados ('33/34') somados na coluna conjugada OU distribuídos entre números individuais proporcional à necessidade, sem dupla contagem (soleMatrixHtml.ts buildColAvailability:28-68) — conforme regra canônica
- Resolução de variante: área/per-size da ficha mantida (variante só troca origem), override legado suprime per-size, pin de solado da variante honrado (resolveSoleForItem), BOM com semântica get_effective_bom (NULL=compartilhada, override por product_id da variante) — orderConsumption.ts:1783-1792
- Cascata canônica de solado P0–P3 (conjugação de cor → mapping explícito → mapping legado por maior estoque → primary_sole_id) centralizada em resolveSoleProductIdCanonical e reusada pela Lista de Separação (bomConsumption.ts:554-562)
- Palmilha pronta (insole_ready_made OU sole_classification='palmilha_pronta') pula placa+forração inteiras nos dois motores — paridade com o ramo SQL
- Forro/palmilha/fachete dirigidos pelo SOLADO por numeração (liningSpecBySole/insoleSpecBySole/insoleLiningSpecBySole/facheteSpecBySole) com fallback escalar por tamanho + warnings de fallback_average/zero — contrato SQL F2-02 espelhado
- Linhas de alerta qtd-0 (fachete sem specs, palmilha sem material, solado texto-livre sem produto, componente direto órfão) tornam gaps de cadastro visíveis em vez de sumir silenciosamente (CONS-8)
- convertNfToStockUnit: prioridades 1-7 seguras — mesma canônica entra direto, conversion_rate só com purchase_unit compatível (F5-07), package_weight_kg restrito a destino MASSA, e bloqueio needsConfig em vez de gravar quantidade errada
- Testes da área: 132/132 passando (orderConsumption 64, bomConsumption 22, nfUnitConversion 23, strapConsumption 15, materialConsumption.units 8)
- Typecheck canônico (bunx tsc -p tsconfig.app.json --noEmit): zero erros fora de 'Cannot find module jspdf' — dependência declarada no package.json mas ausente do node_modules deste sandbox (artefato de ambiente, não do repo)
- MaterialConsumptionDialog usa TECHNICAL_SHEET_CONSUMPTION_COLUMNS no select do join (fonte única) + motor canônico compartilhado + annotateConsumptionAvailability — modal e ficha de operador em paridade por construção

</details>

<details>
<summary><b>SQL consumo/custeio</b> — 17 itens verificados OK</summary>

- calculate_order_consumption_by_grade (definição viva: 20260925131000 + patch 20260928121000) aplica get_material_conversion_info (dm²→m/placa, waste_pct, conversion_warning) em Cabedal, Forração, Palmilha, Forração Palmilha, Fachete, BOM (get_effective_bom) e acessórios — nenhuma regressão de conversão nas redefinições recentes.
- Fachete continua presente na versão viva do motor, com aviso por tamanhos sem fachete_lining_consumption_dm2 e linha diagnóstica quando o grupo do fachete não resolve produto (fachete_material_group_id do solado > lining_material da ficha, paridade TS).
- Supressão anti-duplicidade do forro cabedal intacta: v_suppress_cabedal_lining exige sole_drives_consumption=true e palm-forro>0 sem cabedal-forro (20260925131000:283-290, 438); espelho TS suppressCabedalForracao (orderConsumption.ts:1111) com sole_drives_consumption presente em TECHNICAL_SHEET_CONSUMPTION_COLUMNS e travado por orderConsumption.test.ts.
- calculate_order_consumption (escalar, 20260911130000) é wrapper puro que delega ao by_grade com grade sintética — sem dupla conversão; contrato travado pelos cases escalar_delega_ao_bygrade/escalar_nao_duplica_conversao.
- calculate_order_cost_item (definição viva: 20260920150000) converte via convert_to_product_unit ANTES de multiplicar por unit_price, com fallback dm²→unidade via get_material_conversion_info e warning unit_mismatch (subtotal 0); ramo de tiras também converte m→unidade do produto (F6-5); overhead com fonte única (rate > mensal/meta). calculate_order_cost é agregador puro sobre o item.
- get_material_conversion_info (20260917120000): material de ÁREA sem largura agora emite conversion_warning (fim da heurística 'sem ficha ⇒ é tira' que comprava/reservava calado); waste default 0 (paridade com materialConsumption.ts); fallback de ficha do grupo determinístico (ORDER BY largura>0, updated_at, id).
- Resolvers de variante (20260907120500) seguem a precedência canônica do CLAUDE.md: variant.product_id ('variant') > variant.group_id+cor do PV ('variant_group') > pin da ficha ('sheet_pin') > grupo da ficha; resolve_sole_for_variant honrado no by_grade (v_variant_sole_pid sobrescreve resolve_sole_color).
- get_effective_bom (20260525140000) usado no by_grade com a semântica compartilhada+override da variante, e espelhado 1:1 no TS (itemMaterials em orderConsumption.ts).
- component_color_defaults (20260928120000/121000): precedência correta — lista por-cor da ficha vence; regra exata vence is_default (ORDER BY d.is_default ASC); regra só com produto ATIVO e DO GRUPO (senão warning e mantém o original); colapso-soma de entradas que resolvem pro mesmo SKU com cobertura dos pids originais (dedup dc↔BOM preservado); invalidação de custos/snapshot/reservas via trigger com fan-out por grupo; consistency report estendido (4 checks ccd_*).
- Espelho TS de component_color_defaults em paridade (orderConsumption.ts:1725+): mapa group::corNormalizada / group::*, allProducts filtrado por active=true, quantidade da ficha mantida, soma via addConsumptionRow, mesmo warning de regra apontando produto inativo.
- Tiras (20260929120000): prioridade 0 da regra global aplicada em paridade nos 3 pontos SQL — order_strap_needs, debit_strap_stock (re-SELECT FOR UPDATE no SKU da regra) e check_stock_availability — sempre com produto ativo e do grupo; hardening pré-existente do débito (advisory lock, CEIL, unaccent) preservado pelo patch de texto.
- Linhas de diagnóstico product_id NULL (20260925131000) nunca chegam a reserva/débito/custeio/snapshot: strip_diagnostic_consumption_lines aplicado em filter_caixa_by_packaging_mode (ponto de estrangulamento), com predicado pela chave 'component' que protege o bom_snapshot de sheet_materials.
- shortage-gate color-aware v2 (20260920161000): lead de fornecedor derivado da get_wave_material_needs_core chamada DIRETO (sem a recursão mútua 54001 da v1 revertida), excluindo linhas com conversion_warning e tratando artesanal pelo shortage do produto base.
- strap-base-follows-reference-napa (20260922120000): a base da tira artesanal segue a napa da ficha técnica (family = upper_material > lining_material); sem receita para a base NÃO converte às cegas — emite conversion_warning e mantém a tira visível (paridade com materialFamily do TS).
- run_consumption_parity_tests existe e foi estendida pelas migs novas (18→20 cases, incl. bygrade_padrao_global_por_cor e lookup normalizado com unaccent); cobre fachete, conversão dm², palmilha pronta unificada, gates de reserva, pick-one de forro e smoke de runtime; complementada por run_consumption_integration_tests (fixtures reais, CASO 1-3) e run_debit_guard_tests (G1-G22).
- Split 20261001120000 internamente coerente no núcleo SQL: canonical_stage_order, sector_display_to_enum (os dois setores → enum 'costura', escopo consciente), fn_guard_manual_stage_transition (Colagem exige Corte Palmilha + as duas costuras, sem endurecer o DAG), sector_settings com parallel_groups 'corte'/'costura_aviamento', backfill FK-safe de roteiro/etapas/capacidades.
- Lado TS do split atualizado nos motores de planejamento: src/lib/sectors.ts (fonte única, alias legado 'costura'→costura_palmilha), sectorCapacity.ts (bloco 2 Costura Palmilha ‖ Costura Cabedal ‖ Aviamento), leadTime.ts (capFields novos com fallback no legado) e forwardSchedule.test.ts cobrindo as colunas novas.

</details>

<details>
<summary><b>Fluxos de estoque</b> — 18 itens verificados OK</summary>

- reserved_stock: sincronização 100% via triggers (INSERT ativo-only 20260524160000; UPDATE delta-based e DELETE ativo-only 20260617120000) + sync_product_reserved_stock recalcula do zero incluindo 'partially_consumed' (20260902150000) — grep em todas as migrations pós-0617 confirma que NENHUMA reintroduziu UPDATE manual de products.reserved_stock (a função morta reserve_material_for_order que fazia isso foi DROPada na 20260902150000)
- release_order_reservations (versão viva, 20260617120000): delega o decremento ao trigger AFTER UPDATE (sem decremento manual — sem duplo decremento), cancela reserved+partially_consumed e limpa reservation_batches
- try_reserve_materials (versão viva, 20260910150000): advisory lock por OP, idempotência por reservation_batch 'done', demanda derivada do motor unificado calculate_order_consumption_by_grade (variante do item + packaging_mode), pula color_mismatch e conversion_warning, reservas parciais capadas em LEAST(demanda, disponível), OC com dedup de OC aberta
- debit_sole_stock_by_grade (versão viva, 20260915110000): advisory lock por OP + guard de retry via stock_movements 'Debito Solado por grade%' (RES-7); chave conjugada acumulada em v_effective_grade (mesmo balde debitado 1× com a soma) + fallback pra numeração individual quando a chave conjugada não existe no stock_grade (DEB-7, recupera mig 20260426140000); baixa parcial com reserva de shortfall e sync final
- debit_strap_stock (versão viva, 20260902131000): advisory lock por OP, idempotência hard (LIKE 'Debito Tira%') e soft (reserva kind='strap' existente), match de cor com unaccent, cor vazia/consumo zero vira warning anotado em orders.notes (não débito inventado), stock_movements gravados
- debit_packaging_for_order (versão viva, 20260706180000): idempotência POR RECONCILIAÇÃO por caixa (debita só a diferença vs já debitado) — os únicos chamadores hard do frontend (useSaleOrders/resync) são seguros pra retry por construção
- convert_reservation_to_out (versão viva, 20260915110000): ledger honesto (quantity_consumed = debitado REAL, não a reserva cheia), flag partial_debit + linha de shortfall reconciliável + aviso na OP, advisory lock, sync por produto tocado
- restore_product_stocks_for_order (versão viva, 20260916120000): estorno por NET (out − in) de stock_movements por produto ⇒ idempotente em re-runs; produto com grade recebe só o resíduo escalar (numeração fica pro restore por grade, com desconto do pendente via marcador sole_restored_at — funciona em qualquer ordem de chamada); cobre box_types; grava movimento 'in' em todos os caminhos
- restore_sole_grade_for_order (versão viva, 20260721270000): advisory lock + idempotência server-side via metadata.sole_restored_at (retry de cancelamento não credita grade 2×), movimento 'in' gravado
- Cancelamento/exclusão de OP no frontend (useOrders.ts useUpdateOrderStatus/useCancelOrdersBatch/useDeleteOrder): claim atômico por status (.eq status anterior) contra double-click/aba concorrente, ordem canônica release→restore_sole_grade→restore_product_stocks, revert do claim em falha, bloqueio quando PV já faturado, e recusa de deletar OP se estorno falhou (evita perda permanente); FK material_reservations.order_id ON DELETE CASCADE + trigger BEFORE DELETE cobrem o cleanup de órfãs
- adjust_stock RPC (versão viva, 20260819120000): SELECT FOR UPDATE + optimistic check tolerante a float64 (round 4 casas) + rejeição de quantidade negativa + stock_movement com autor; nenhum UPDATE direto de products.quantity encontrado em src/ — todos os caminhos de crédito (NF XmlImportDialog, AddToStockDialog, recebimento de OC, OC avulsa, inspeção, OS de terceiro) passam por adjustStockSafe
- StockAdjustmentPage: usa exclusivamente a RPC adjust_stock, com detecção proativa de concorrência (poll 15s + snapshot + bloqueio de save com conflito), validação de balde negativo na grade e motivo obrigatório
- Recebimento de OC (PurchaseOrders.tsx): claim atômico via estado transitório 'receiving' (uma aba vence), preflight do lote inteiro, idempotência por item (received_at + recebimento parcial por received_quantity), fator ciente da unidade da LINHA (receiptConversionFactor: linha em unidade de estoque ⇒ 1; compra ⇒ fator estrito; sem regra segura ⇒ BLOQUEIA), conversão e WAC aplicados exatamente 1×
- convertNfToStockUnit (src/lib/nfUnitConversion.ts): bloqueia com needsConfig toda diferença de unidade sem regra segura (P2/P3 exigem match com purchase_unit; package_weight_kg restrito a destino de MASSA; CONVERSOES contém apenas conversões dimensionalmente consistentes — sem m→dm² cego); NF_CONVERSION_PRODUCT_SELECT unifica os campos lidos nos 3 caminhos de NF
- resync_op_material_reservations / resync_sheet_material_reservations (20260926120000): não tocam reserved_stock à mão (delegam aos triggers — documentado no próprio corpo), advisory lock compartilhado com a reserva, escopo restrito a componente direto e nunca mexem em reserva com quantity_consumed > 0
- Liberação automática em OP terminal (20260916120000, RES-6): matriz de status unificada nas duas triggers (Finalizado/FINALIZADO/Faturado/Cancelado/Cancelada/Concluído/Concluido) liberando reserved+partially_consumed com sync por produto
- consume_all_reservations_for_order (versão viva, 20260803130000): advisory lock por OP, baixa parcial por numeração com split de shortfall, embalagem deferida com guard 'Débito embalagem%', reserved_stock via trigger+sync
- Guardas de regressão presentes: run_debit_guard_tests (20260915/20260916), run_consumption_parity_tests com 15 cases travando a delegação da reserva ao motor (20260910150000), debit_consistency_report + stock-debit-hole-prevention (20260925133000), e testes vitest colocados (consumptionService.parity.test.ts, debitSoleStock.idempotency.test.ts, rpc-parity.units.test.ts)

</details>

<details>
<summary><b>Hooks/React Query</b> — 17 itens verificados OK</summary>

- Nenhum import de 'lucide-react' em todo src/ — ícones 100% @phosphor-icons/react, conforme regra canônica (grep completo, 0 matches)
- 66 das 67 RPCs chamadas em src/hooks/ têm CREATE FUNCTION em supabase/migrations/ (verificação nome a nome; única exceção reportada: recall_lot_buyers)
- Nenhum hook escreve products.reserved_stock diretamente — a regra 'sincronização só via trigger tg_sync_reserved_stock' do CLAUDE.md é respeitada (grep: só leituras)
- useOrders.ts inteiro é exemplar: claim atômico por status antes dos RPCs de estorno (cancel/delete/batch), ordem canônica release→sole→product, todos os erros de restore capturados e OP marcada 'Cancelada' com notas quando o estorno parcial falha
- useUpdateSaleOrderStatus tem claim atômico (.eq('status', currentStatus).select('id')) que bloqueia double-click/duas abas antes dos fluxos Aprovado/Faturado, e guards fiscais (NF-e autorizada p/ Expedido, bloqueio de cancelamento com NF-e viva) com erro capturado
- useCreateSaleOrder tem idempotência real via client_request_id (UNIQUE parcial no banco) + rollback de PV órfão via RPC delete_empty_sale_order quando o insert de itens falha
- useCreatePurchaseOrder tem idempotência dupla (Map TTL 30s client-side + idempotency_key com trigger server-side) e delete compensatório de OC órfã filtrado por status='pending'
- useAvulso (OC/OS avulsa) tem idempotency_key própria, aproveita os UNIQUE de accounts_payable por reference_id, e reverte a OC/OS quando o lançamento financeiro falha
- useProducts pagina a tabela inteira em blocos de 1000 com count prévio (não sofre o teto do PostgREST); useUpdateProduct STRIPA quantity/stock_grade forçando o caminho adjust_stock RPC (audit trail preservado)
- useFinance: edição/exclusão de contas pagas/recebidas bloqueada por UPDATE/DELETE condicional atômico (predicado .not('status','in',...) + checagem de 0 rows) — sem race SELECT-then-UPDATE
- useUpdateOrderStage usa claim por status predecessor (pendente→em_andamento, em_andamento→concluido) que elimina corrida de dois operadores na mesma etapa; apontamento centraliza invalidação em invalidateProductionCaches + realtime debounced
- Scan heurístico de queryKey vs. parâmetros usados na queryFn nos 155 hooks: nenhuma dependência real faltando na key (únicos hits foram flags 'enabled', que não parametrizam dados)
- Convenção 'if (error) throw error' cumprida na esmagadora maioria das queryFn (594 ocorrências em 128 arquivos com queryFn); QueryCache global toasta toda query que falha, com retry que ignora erros de auth
- Invalidations dos fluxos nucleares (criar/cancelar/excluir OP, status de PV, picking, custos) cobrem o conjunto amplo de keys certas (orders, sale_orders, products, stock_movements, material_reservations, order_stages, financial, MRP), casando por prefixo com as keys parametrizadas (['sale_order_items', id] etc.)
- useOrderCost com persist=false — abrir o card de margem não regrava o snapshot de order_costs (histórico de custo protegido); persistência só nos caminhos explícitos
- useUpdateSaleOrder (edição de PV): guards de OP em produção avançada e de NF-e autorizada com erro capturado, teardown seletivo só das OPs de itens removidos, RPC atômica update_sale_order_atomic com status stripado do header (não bypassa a state machine)
- Uso de .single() auditado: concentrado em .insert(...).select().single() (1 row garantida) e lookups por PK após seleção do usuário; caminhos com 0-rows plausível usam .maybeSingle() (ex.: validação de packaging_product_id)

</details>

<details>
<summary><b>Rotas/UI/permissões</b> — 12 itens verificados OK</summary>

- Navegação ↔ rotas: todas as 71 rotas de navigation.ts (topItem, menuGroups, systemItems, secondaryRoutes) têm entrada em ROUTE_MODULE_MAP (scripts/check-navigation-access.mjs ✅) e rota viva correspondente em App.tsx — nenhuma rota de menu sem página.
- Ícones: zero imports de 'lucide-react' em src/ (grep vazio) e o pacote nem está em package.json/bun.lock — regra @phosphor-icons/react respeitada em App.tsx, navigation.ts e páginas.
- Design tokens: bash scripts/check-design-tokens.sh passa sem violações (exempts de print respeitados).
- Typecheck canônico (bunx tsc -p tsconfig.app.json --noEmit): limpo exceto TS2307 em jspdf/jspdf-autotable — pacotes declarados em package.json/bun.lock mas não instaláveis neste sandbox (registry Lovable via proxy caiu no download); não é bug de código. Nenhum import quebrado ou export nomeado inexistente detectado.
- Testes de navegação: Navigation.test.tsx + NavigationAccessConsistency.test.ts — 119 testes passando (menu não aponta pra módulo admin-only, systemItems admin-only, sem duplicidade de rota no menu).
- ErrorBoundary/chunks: GlobalErrorBoundary na raiz com detecção de chunk-load/PWA error, errorElement=RouteErrorFallback em TODAS as rotas top-level, chunkErrorHandler instalado em main.tsx, todas as páginas lazy sob Suspense (inclusive AppLayout lazy com boundary próprio).
- Guard estrutural: todos os filhos de '/' passam por ProtectedRoute→RouteGuard; /producao/kanban/gestao (fullscreen fora do AppLayout) tem ProtectedRoute+RouteGuard próprios; /m/* protegido; /design-preview é público mas é mockup estático sem acesso a dados (0 refs a supabase).
- Consistência menu/busca: AppLayout (sidebar), BottomNav, favoritos e GlobalSearch filtram itens por canAccessRoute — usuário não vê entrada de menu/busca que a rota negaria.
- Fonte única de criação de grupos respeitada: único insert em product_groups está em useGroups.ts:83, consumido via GroupCreateDialog — nenhum form paralelo de criação de grupo.
- Conflito estático×dinâmico de rota OK: /estoque/qualidade e /estoque/inventario vencem /estoque/:id pelo ranking de segmento estático do React Router.
- Matriz granular grava apenas paths reais da sidebar (useUserManagement valida contra getAllMenuItems) — sem lixo em user_permissions.
- Rotas legadas: 40+ aliases/redirects (pt-BR e ingleses antigos) preservam deep-links e query string (LegacyRouteRedirect); catch-all '*' cai em NotFound real.

</details>

<details>
<summary><b>Financeiro/compras</b> — 19 itens verificados OK</summary>

- Faturar PV: receita em financial_entries protegida por indice unico parcial (financial_entries_sale_order_unique, mig 20260524160000) + pre-check filtrando cancelado/cancelled/estornado (financialSync.ts:358-364); estorno via revert_invoiced_sale_order marca 'estornado' e libera o indice para re-faturamento
- Juros de factoring com indice unico proprio (financial_entries_sale_order_factoring_unique, mig 20260616120000, com cleanup de duplicatas) e valor TRAVADO na criacao — re-sync so atualiza o rotulo, evitando encolhimento do desconto a cada sync
- Double-click no Faturar bloqueado por claim atomico `.eq('status', currentStatus)` com erro explicito quando 0 rows (useSaleOrders.ts:762-771); transicoes validadas por isValidStatusTransition antes do update
- Gate anti-ghost-revenue (NF-e autorizada OU NF externa explicita, backfill marcado com BACKFILL_SEM_NF_MARKER protegido de cancelamento em loop) implementado em financialSync.ts:237-291
- Espelhos sync-ar byte-identicos verificados com cmp (financialSync.ts, saleOrderAR.ts, factoringCalc.ts) e travados pelo teste financialSyncShared.parity.test.ts
- calculate_order_cost_item (mig 20260920150000): overhead com cadeia ficha custom_overhead > policy rate_per_pair > overhead_monthly_total/meta (F6-3, mesma cadeia do simulador); tiras convertem m->unidade do produto antes do preco (F6-5); unit_mismatch vira warning com subtotal 0 em vez de custo errado; margin_pct com guard revenue>0
- calculate_order_cost agregado (mig 20260903123500): deleta order_costs orfaos de itens removidos antes de agregar; margin_pct guardado contra receita 0
- Malha costs_dirty completa (mig 20260920130000): 5 tabelas *_colors, sole_technical_specs, sole_standard_items_consumption, component_sheets (largura da conversao dm2->m), reference_material_variants, cost_policies e preco de produto por TODOS os caminhos de resolucao; debito de snapshot desatualizado emite WARNING + flag no retorno
- process_dirty_order_costs converge (mig 20260927120000): lista 'frozen' e complemento exato do NOT IN do loop + early-exit; staleness exibida na UI via PvOutdatedBadge (costs_dirty_at) e useOrderCost exibe com persist=false (nao regrava snapshot congelado ao abrir o card de margem)
- useCreatePurchaseOrder mantem idempotencia client-side (Map por hash do payload, TTL 30s) + trigger server-side de 30s + validacao de quantidade/preco + compensating delete de OC orfa em falha de itens (usePurchaseOrders.ts:384-447)
- Server-side purchase-order-integrity (mig 20260925132000): UNIQUE INDEX parcial permanente para keys auto:/auto_pv:/sole:/rop: cobrindo exatamente o conjunto 'em aberto'; po_normalize_line converte estoque->compra por conversion_rate e aplica CEIL so em unidade contavel; upsert_po_item_atomic/upsert_open_purchase_order renormalizam linha legada antes de somar e nao deixam preco 0 sobrescrever preco existente; generateAutoPurchaseOrders preenche source_type/source_pv_ids/idempotency_key e trata 23505 como disparo duplicado
- Parcelas de AR: split em centavos com resto na ultima parcela (saleOrderAR.ts:94-107) garante soma exata; parcela 'received' e sagrada no reconcile (financialSync.ts:96); parcelas extras/duplicadas canceladas com `.neq('status','received')`
- boletoParser: DV mod10/mod11 FEBRABAN corretos (dv 0/10/11 -> 1 no barcode), rollover do fator de vencimento de 2025 com janela de plausibilidade, concessionaria com ids 6/7/8/9 (quantidade de moeda -> amount null), extracao em texto ruidoso por janela+DV — tudo com testes (boletoParser.test.ts, casos reais BB e Sicredi)
- factoringCalc: PV = FV/(1+i)^n com guards (total<=0 ou taxa<=0 -> desconto 0), dias nunca negativos (Math.max(0,...)), fallback documentado que nao subestima o desconto; discountPct guardado contra total 0
- Helpers monetarios canonicos Intl 'pt-BR'/BRL hoisted em modulo (utils.ts BRL_MONEY 2 casas para totais, BRL_UNIT_PRICE ate 4 para preco unitario); toFixed em componentes de finance e so para abreviacao de eixo/percentual, nao para dinheiro somado
- DREAuto (useFinanceIntelligence): todas as divisoes de margem guardadas com receita>0; regime de caixa consistente (payment_date), CMV reconhecido com degradacao elegante se a tabela nao existir; categorias de custo de produto excluidas das despesas para evitar double-count com CMV
- useFinance (AP/AR): edicao/exclusao de conta paga/recebida bloqueada com UPDATE/DELETE condicional de uma rodada (sem race select-then-update); useFinanceAdvanced bloqueia mutacao estrutural de plano de contas/centro de custo com lancamentos confirmados, capturando erro de count (sem bypass silencioso)
- useDeletePurchaseOrder faz soft-cancel preservando audit trail e cancela accounts_payable vinculadas pelo token [OC#id] em notes; useUpdatePurchaseOrder/Item recusam alteracao de OC recebida/cancelada
- cancel_orphan_auto_purchase_orders (mig 20260925132000 B6): so cancela OC pending sem recebimento cujas OPs citadas estejam TODAS mortas — criada e nao executada, com guards contra cancelar compra ainda necessaria

</details>

<details>
<summary><b>Produção/ondas</b> — 17 itens verificados OK</summary>

- src/lib/sectors.ts — fonte única atualizada pro split: SectorKey com costura_palmilha/costura_cabedal, SECTOR_NORMALIZE ('costura'→costura_palmilha, decisão documentada) e DISPLAY_SECTORS na ordem nova do fluxo
- computeParallelWindows + computeForwardSchedule (sectorCapacity.ts) — topologia nova coerente entre cascata reversa e forward, feriado-aware, com required/caps espelhados e defaults de categoria na mesma cadeia
- leadTime.ts — SECTOR_CONFIG com capFields novos das costuras e fallback pra coluna legada (cobre ficha não recadastrada); aliases legacy 'corte'/'costura' preservados
- Migration 20261001120000 internamente consistente: normalize trigger atualizado ANTES do backfill (nomes novos não são descartados), rename preserva produção apontada, Costura Cabedal criada zerada só onde o roteiro pede (ON CONFLICT DO NOTHING), renumeração canônica das etapas e production_schedule renomeado
- fn_guard_manual_stage_transition atualizado: Colagem exige as duas costuras + Corte Palmilha, setor ausente na OP não bloqueia, DAG não endurecido (decisão explícita); 'Costura' legado ainda aceito
- sector_display_to_enum e canonical_stage_order SQL cobrem os nomes novos E os legados ('Costura'→enum costura/posição 3)
- Kanban principal (ProducaoKanban) e Modo Gestão: colunas data-driven de sector_settings (os dois setores novos aparecem na ordem certa), deriveCard/orderStagesByRoute usam o stage_order da própria OP (não o flow_order global)
- Busca do kanban (#116): filtro preserva allCards, visibleColumns só oculta colunas sem match durante a busca, drag-drop e destinos do select continuam íntegros
- Mover OPs em lote (#111): buildPointingPlan compartilhado com o fluxo de card único (sem divergência de regra), destino validado contra a rota pendente da OP, snapshot congelado na abertura do wizard, falha de passo não avança sozinha
- Race de apontamento: apontar_producao_setor trava a linha do stage com SELECT ... FOR UPDATE, bloqueia positivo em stage concluído, rejeita acumulado negativo e emite warnings confirmáveis sem gravar — dois usuários movendo a mesma OP serializam no servidor
- Autoria (#111): applyPointing não pede operário; RPC grava o usuário logado; nota de origem ('Via Kanban (lote)') registrada no ledger
- Foto da referência no card (#118): useReferenceThumbs usa images[0] com fallback image_url (mesma convenção do resto do sistema), 1 query cacheada pro quadro inteiro
- PCPDashboard consome DISPLAY_SECTORS da fonte única — WIP de Costura Palmilha/Cabedal incluído no gráfico
- Camada de impressão: PrintWorkSheetsPage filtra roteiro por identidade pós-split (com fallback legado 'Costura'→palmilha documentado) e SilkMontageWorkSheet cobre os dois setores de costura como GroupedSector com tema próprio
- ProducaoSetoresConfig 100% data-driven de sector_settings — linhas novas aparecem, reorder/capacidade/toggles funcionam sem enumeração hard-coded
- commit_capacity_overflow_outsourcing valida setor via sector_display_to_enum — 'Costura' ≡ enum costura ≡ roteiro com Costura Palmilha/Cabedal, terceirização de costura segue funcionando
- Testes: forwardSchedule.test.ts exercita as capacidades novas das costuras; pointingPlan.test.ts trava a regra de rota da OP contra flow_order global divergente

</details>

<details>
<summary><b>Impressão</b> — 14 itens verificados OK</summary>

- Nenhum primitive shadcn (Card/Badge/Button/Table/Tabs) dentro de componente de PRINT — o Button/chips da PrintWorkSheetsPage vivem na toolbar `no-print`; SignedImage/BarcodeSVG são componentes próprios, não shadcn.
- Nenhum token com alpha em bordas/fundos de print: todos os worksheets usam inline styles com `#000`/`#C00000`/`#fff` sólidos (grep de `/10|/15|foreground/` sem matches nos componentes de print).
- Fontes corretas por contexto: fichas inline usam só 'Fira Sans'/'Fira Code'/'Anton' (zero 'Inter Tight'/'JetBrains' em src/components/production); etiquetas térmicas (printLabels.ts) carregam Inter Tight + JetBrains Mono + Anton no window.open próprio, como manda a regra.
- Pisos de fonte da tabela canônica respeitados: buckets do adaptiveFont (displayPx mínimo 12, cellPx 8, textPx 7.5, headerPx 8), TallyBox getFontSize (md 11/9.5/7.5 · sm 10/8/7), rótulos do FlowRail 6.5px e CompletionFooter (campo manuscrito 22px, visto 15px) batem exatamente com a referência viva do CLAUDE.md; único desconto é o auto-fit até 0.80, que é o piso documentado.
- keep-together/keep-with-next/keep-with-previous + `thead{display:table-header-group}`/tfoot presentes no CSS de print e aplicados nos pontos exigidos (WorksheetHeader, GroupSubHeader, CompletionFooter keepWithPrev, chunks de 14 linhas da Expedição com thead repetido, flow-card com box-decoration-break: clone).
- PaginatedSheet conforme §3-B v7.2/v7.3: PAGE_HEIGHT_MM 288, PRINT_INFLATE 1.06 aplicado na base e na busca do auto-fit, AUTO_FIT_FLOOR 0.80/STEP 0.01, medição só na baseline scale=1 (fix React #185), re-medição via ResizeObserver/beforeprint/matchMedia com flushSync, keepWithPrev/keepWithNext no packBlocks puro (testado em worksheet/__tests__).
- Saída invertida (2026-07-24) implementada como especificado: ReversePrintContext + ReversibleStack, flip transitório beforeprint/afterprint com flushSync e fallback matchMedia, preview nunca inverte, numeração N/TOTAL lógica preservada, aviso de reconciliação com .page-break próprio.
- ReducedWorkSheet com root `display:block` (sem flex — regra §0.2-7 contra o clip do Chrome) e .reduced-card com break-inside avoid + traço de corte.
- Setores novos Costura Palmilha/Costura Cabedal presentes e com layout correto nas fichas: SECTORS os inclui, SECTOR_THEME diferencia (compacto tipo Corte Forração vs completo com 'Peças a Costurar' = pares×2), filtro de roteiro por identidade com alias legado 'Costura'→costura_palmilha em sheetHasSector, flowOrder de render na sequência de fábrica (só o contador sheetCount ficou pra trás — ver achado).
- Regra WYSIWYG respeitada no grosso: tipografia 8pt/1.12, compressão de spacing e table-layout fixed vivem no bloco sempre-ativo da .print-area (fora do @media print), como o §0.2-1 exige (exceção pontual do section-label — ver achado low).
- @page margin:0 + padding interno por página no fluxo canônico (/imprimir-fichas), reset agressivo de overflow/visibility pro app chrome, print-color-adjust: exact global, e gates de impressão por loading/erro de query (initialQueriesLoading/failedQueries) funcionando.
- EtiquetaProduto (100×30mm): safe-area lateral 3mm, fallback de imagem em cascata, sem invenção de EAN falso quando barcode ausente (mostra '—'); CSS dedicado em index.css com @page próprio e break-inside avoid.
- QR do WorksheetHeader é QRCodeSVG real (nítido em qualquer DPI) com fundo/moldura sólidos; tamanho 46px (~12mm) abaixo do piso de acionável é gap CONHECIDO e documentado no CLAUDE.md (hoje é só identificação visual).
- Nenhum import de lucide-react em src/ (zero risco do ReferenceError documentado); typecheck canônico (tsc -p tsconfig.app.json) limpo nos componentes de print — únicos erros são jspdf/jspdf-autotable ausentes do node_modules deste ambiente (declarados no package.json, artefato de instalação, não do repo).

</details>

<details>
<summary><b>RH/ponto</b> — 13 itens verificados OK</summary>

- Banco de horas: feature foi REMOVIDA por decisão do dono (mig 20260910130000 dropa bank_hours_balance/v_bank_hours_summary/calculate_employee_bank_balance/pay_bank_hours) com ordering correto vs 20260908 (recriações rodam antes do drop em fresh DB); o bug histórico round-6 (view sem derivado do timesheet) está portanto obsoleto/encerrado.
- Frontend pós-drop do banco de horas está limpo: nenhuma query/RPC viva contra objetos dropados — restam só invalidateQueries de query keys mortas (inócuo) e useBankHoursCutoff usa get_bank_hours_cutoff, preservada de propósito pela migration.
- Absenteísmo (src/lib/absenteeism.ts): divisão por zero guardada (denom>0 → 0, com teste absenteeism.test.ts:57), recorte de ausência na janela [from,to], feriados obrigatórios excluídos dos dias úteis, fmtLocal sem drift de timezone; fonte única usada por AbsenceReport e KPIsRH.
- Parser de importação é robusto a formatos reais: detecção de encoding UTF-16LE/BE/UTF-8/latin1 (BOM + heurística de bytes nulos), XLSX/XLS/HTML-table via SheetJS com fallback ExcelJS, TXT em 6 formatos (ZKTeco TSV, AGL fixed-width espaçado, compacto, CSV, AFD, delimitado); linha malformada é ignorada sem abortar o arquivo.
- Import: dedupe intra-batch por (nome, data) com merge de punches, paginação das keys existentes (>1000 rows) e insert atômico via RPC import_time_records_safe (ON CONFLICT DO NOTHING) com fallback chunked — sem race 23505.
- Arquivamento do arquivo bruto (mig 20260525130000) está de fato ligado: upload pro bucket privado timesheet-imports, upsert em time_import_logs (file_path/size/mime) e download via signed URL (useTimeImportLogs.getImportFileUrl); falha de upload não derruba a importação.
- punch_device_map: RLS habilitado SEM policy é intencional (comentário na própria migration — acesso só via RPCs SECURITY DEFINER); o frontend NUNCA acessa a tabela diretamente (aparece só nos types gerados), então nada quebra pra authenticated. (Ressalva de gating das RPCs reportada à parte.)
- Trigger resolve_time_record_employee não conflita com os fluxos vivos: ManualEntryTab insere sem employee_id, complete_punches só toca punches e punch_map_resolve não altera employee_external_id (trigger é BEFORE INSERT OR UPDATE OF employee_external_id).
- useRH/payroll_runs bem blindado: upsert recusa sobrescrever folha aprovada/paga (checagem + throw quando 0 rows no conflito), transição de status exige predecessor válido (rascunho→aprovado→pago), e assertNoClosedPayroll bloqueia editar/remover ausência de período já fechado.
- Matching da FOLHA (payrollComparativo) não usa o fuzzy: casa por matrícula exata com desambiguação de device compartilhado (matrícula+nome) e fallback de nome exato — o risco de substring do namesMatch fica restrito às abas de visualização do Ponto.
- Regimes de pagamento coerentes no motor: remoto (salário cheio sem ponto), diarista (meia-diária ≥2h/diária ≥6h; batida ímpar vira pendência, não paga), produção por par (ignora ponto; excluído de v_time_pendings na mig 20260914) — sem falta/HE espúrios.
- Falta por cobertura correta na folha: coveredDates evita falta em dia sem importação, clamp em maxCoveredDate e recorte por admissão/demissão (activeFrom/activeTo) — funcionário admitido no meio do período não gera falta retroativa.
- exportFolhaExcel: xlsx lazy-loaded (não infla o bundle da rota), 3 abas geradas com colunas dimensionadas; valores do Resumo vêm do motor oficial computePeriodFolha (a divergência do Detalhe está reportada como achado).

</details>


---

## 9. Plano de ação recomendado (priorizado)

**P0 — dados e dinheiro (agir já):**
1. **C1 — furos de débito**: triagem das 184 OPs (separar legado × recente), investigar o vazamento
   ativo (OPs de 18–22/07) no caminho `finalize`→débito, e regularizar estoque via ajuste auditado.
2. **A1 — ficha CF 09** (`upper_consumption=2000`): corrigir o valor (a ficha está travada pra
   edição pelo guard — a única edição possível é a que conserta) e recalcular custos do PV-00122.
3. **A2 — 23 fichas com componente direto órfão**: reapontar produtos e re-rodar
   `consumption_consistency_report()` até zerar.

**P1 — rescaldo do split da Costura (1 PR de SQL + 1 de frontend):**
4. SQL: `finalize_production_sector` (A3), `tg_strip_cut_sectors_when_ready_made` (A4),
   `compute_wave_timeline`/anchors (A6/M), `capacity_sector_key/label` + `bom_operations.stage` (A7),
   listas-default de etapas (M).
5. Frontend: `sectorBottleneck.ts` (A8), `stageOrder.ts` (M), `OrdersKanbanBoard` (M),
   fetchs/edição das colunas `costura_*_capacity_per_day` (M×3), terceirização (M),
   `sheetCount` do print (A10).

**P2 — segurança:**
6. A12 (gate `is_approved_user()` nas RPCs de punch) + REVOKE de `anon` nas 71 funções SECURITY
   DEFINER (§7.1) + gate da aba Folha no RHHub (A5) + ligar leaked-password protection.

**P3 — consistência de motores (RH e financeiro):**
7. Unificar motor de dia TS×SQL do ponto, folha legada×resumo, feriado recorrente (M×3 do RH);
   estorno de juros de factoring e clamp da semana S1 (M×2 finance).

**P4 — higiene:**
8. Repair de migrations (§7.3), dropar `_tmp_fn_backup`/backups, lint como gate com
   `no-explicit-any` off, dead code (§5), índices (§7.2).

---

*Auditoria executada em 2026-07-27/28 na branch `claude/system-audit-frontend-backend-snds41`
(mesmo commit da `main` `40f9727`). Relatórios anteriores relacionados:
`docs/AUDITORIA_SISTEMA_2026-06-09.md`, `docs/AUDITORIA_MOTORES_2026-07-21.md`,
`docs/AUDITORIA_DEBITO_FICHA_GRADE_2026-07-18.md`.*
