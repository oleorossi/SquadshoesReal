# Auditoria Completa de Código — Squad Shoes ERP

- **Data:** 28/07/2026
- **Ferramenta:** Codex CLI (`gpt-5.6-terra`, reasoning `xhigh`), auditoria não-interativa em modo read-only.
- **Escopo:** todo o código de aplicação `src/` (~307k linhas, 1017 arquivos `.ts`/`.tsx`), particionado em 12 fatias de domínio auditadas em profundidade. Migrations SQL foram lidas como referência quando um achado de frontend dependia delas, mas o sweep automático focou o código de aplicação (a "verdade" do banco deve ser confirmada em produção antes de agir nos achados marcados como *Suspeita*).
- **Método:** cada fatia recebeu o mesmo prompt de auditor sênior calibrado pro projeto (TS *loose* → ReferenceError silencioso; `@phosphor-icons/react` vs `lucide-react`; regra dm²→física ~100×; `service_role`/RLS; débito/reserva duplicados ou não revertidos). Achados citam `arquivo:linha`, impacto concreto e correção.
- **Confiança:** a esmagadora maioria é **Confirmado** (lido no código). Itens que dependem de estado de banco/migrations pós-28/07 estão marcados **Suspeita** e dizem como confirmar.

> ⚠️ **Nenhum destes defeitos é barrado pelo build.** O TypeScript do projeto é `strict:false`/`noImplicitAny:false` e o build Vite/esbuild não type-checa. Símbolo indefinido, unidade errada e violação de regra de Hooks só aparecem em runtime/produção.

---

## Sumário executivo

A auditoria encontrou **152 achados** — **74 Críticos, 63 Altos, 15 Médios, 0 Baixos**. O peso em Crítico/Alto não é ruído: o prompt pediu explicitamente "poucos achados REAIS a muitos genéricos", então quase tudo aqui é bug de correção/segurança confirmado, não cosmético. Os achados se concentram em **cinco doenças sistêmicas** que se repetem em quase todas as fatias. Não são bugs isolados — são padrões arquiteturais que reaparecem porque a lógica que deveria ser server-side transacional está espalhada em mutações client-side sequenciais.

| # | Tema transversal | Gravidade | Onde aparece |
|---|---|---|---|
| T1 | **`conversion_rate = 0` vira fator `1:1` em silêncio** | 🔴 Crítico | P01, P02, P03, P05, P07, P10 |
| T2 | **Área (dm²) usada crua como unidade linear / sem largura da ficha → infla ~100×** | 🔴 Crítico | P01, P02, P03, P04, P05, P06, P07, P10, P11 |
| T3 | **Escala de grade com `Math.round` por número → soma ≠ total da OP** | 🔴 Crítico | P01, P03, P08 |
| T4 | **Mutações multi-etapa não-transacionais que mexem em estoque/dinheiro, com erros engolidos e sem idempotência** | 🔴 Crítico | P02, P04, P05, P06, P07, P09, P10, P11, P12 |
| T5 | **RLS permissiva / `SECURITY DEFINER` sem authz / identidade vinda do cliente** | 🔴 Crítico | P02, P09, P10, P11, P12 |

Além disso, três temas de **gravidade alta** recorrentes:

- **T6 — XSS persistente na impressão:** HTML montado por concatenação e injetado em `iframe.srcdoc` **sem `sandbox`** e sem `escapeHtml`, com dados vindos do banco (P01, P03, P04). Mais injeção de comandos **ZPL** nas etiquetas térmicas (P01).
- **T7 — Truncamento silencioso apresentado como "completo":** `limit(500)`, limite padrão de 1.000 linhas do PostgREST, `Math.min(…, 2000)`, `limit(5000)` — sem aviso de corte (P03, P06, P08, P09).
- **T8 — "Falha vira verde":** telas de diagnóstico/auditoria convertem erro de query em array vazio e o interpretam como "nenhuma inconsistência" (P03, P04, P06, P11, P12); `SystemMonitor` exibe `Math.random()` como telemetria de produção (P12).

### Concorrência sem lock (subconjunto de T4, alto volume)
Um padrão específico e perigoso dentro de T4: **read-modify-write no cliente** sem lock/incremento atômico em saldos e contadores. Aparece em bipagem de picking (`picked_qty + 1`), ajuste de estoque, conciliação bancária, grade de solado com total igual, pagamentos de folha e recebimento de OC. Todos perdem escrita sob duas abas / dois operadores. Correção comum: RPC de incremento atômico com `FOR UPDATE`.

**Recomendação estratégica:** priorizar T1–T5 porque corrompem **dado financeiro e de estoque** de forma cumulativa e difícil de reverter. T1, T2 e T3 têm correção pontual e alto retorno (uma função central cada). T4 e T5 exigem consolidar mutações em RPCs transacionais/idempotentes com autorização e `auth.uid()` server-side — trabalho maior, mas é a causa-raiz de dezenas de achados.

---

## Temas transversais (detalhe + plano de correção)

### T1 — `conversion_rate = 0` tratado como conversão 1:1
`resolveConversionFactors` em [src/lib/unitConversion.ts:123-154](../src/lib/unitConversion.ts#L123-L154) transforma taxa ausente/zero/inválida em `1`. Isso propaga por MRP, explosão de materiais, reserva, baixa e geração de OC. Exemplos: 1 rolo = 100 m com fator 0 → necessidade de 100 m vira **100 rolos**; placa EVA com fator correto 150 salvo como 0 → 600 dm² vira **600 placas** (deveria ser 4). O `CHECK (conversion_rate > 0)` só existe em migration datada de **2026-08-14**, posterior a esta auditoria.

**Correção central:** falhar fechado (`throw`/bloquear) quando as unidades divergem e não há fator `> 0`; validar `> 0` no `NumberInput`/schema `zod` do cadastro; aplicar a `CHECK` constraint imediatamente e sanear registros com `0`/`NULL`. Nunca usar fallback `1`.

### T2 — Área (dm²) usada crua como unidade linear
A regra canônica (dm²/par → metro pela largura da ficha de componente) **não é aplicada** em vários caminhos paralelos ao motor `orderConsumption`:
- [src/lib/purchaseConversion.ts:44-52](../src/lib/purchaseConversion.ts#L44-L52) — `widthInDm` assume `dm` quando `dimensions_unit` é omitido; os chamadores passam `dimensions_width` mas **não** a unidade → `1000 mm` vira `1000 dm` (fator 100× errado). Idem [CreatePurchaseOrderDialog.tsx](../src/components/purchase/CreatePurchaseOrderDialog.tsx) e [GeneratePurchaseOrdersDialog.tsx](../src/components/purchase/GeneratePurchaseOrdersDialog.tsx).
- [src/components/production/MaterialConsumptionTab.tsx:64-105](../src/components/production/MaterialConsumptionTab.tsx#L64-L105) — busca `quantity_per_unit` sem largura e custeia dm² como metro.
- [src/pages/ComponentSheets.tsx](../src/pages/ComponentSheets.tsx) permite salvar material linear **sem largura** (só avisa).
- [src/lib/serviceOrderStock.ts:15-104](../src/lib/serviceOrderStock.ts#L15-L104) subtrai "metros" crus de qualquer unidade de estoque na baixa de OS.

**Correção central:** um único motor de consumo/conversão (o de `orderConsumption`, que já converte via largura e marca `widthMissing`); tornar `dimensions_unit` obrigatório quando a largura vem do cadastro; bloquear item de área sem largura válida em **compra, reserva, débito e OS**.

### T3 — Escala de grade não preserva o total da OP
Dezenas de telas e libs escalam cada número com `Math.round(base × mult)` de forma independente, mas exibem o cabeçalho com o total original → a soma das células diverge (ex.: grade `1/1/1` numa OP de 4 pares imprime 3; base 12 numa OP de 120 imprime 12). Afeta corte, solagem, silk, expedição, fichas A4 e relatórios.

**Correção central:** usar `scaleGradeWithLargestRemainder(grade, mult, orderTotal)` **uma vez por OP** (já existe e é usado corretamente em `bomConsumption.ts:807` e `OperatorWorkSheet.tsx:152`) e propagar o mesmo mapa para cálculo, tela e impressão. Para fichas em lote, `ceil` no número de fichas + montar a última ficha com o **saldo remanescente** por numeração.

### T4 — Mutações multi-etapa não-transacionais
Padrão repetido: uma sequência de `insert/update` separados no cliente move estoque/dinheiro; erros intermediários são só `console.error`; não há idempotência. Resultados: PV faturado sem NF, OC cancelada com AP aberta, crédito de estoque em dobro no recebimento, OP reservada sem reserva real, cancelamento em lote que não estorna, edição de PV que apaga+recria itens e orfana OPs.

**Correção central:** mover cada operação que toca estoque/financeiro para **RPC transacional idempotente** (idempotency key/ledger append-only), derivando autoria de `auth.uid()`. Validar **todo** retorno Supabase (`if (error) throw`). Nunca reportar `onSuccess` antes de confirmar todas as etapas.

### T5 — Autorização fraca
Políticas `FOR ALL USING (true)`, funções `SECURITY DEFINER` concedidas a `authenticated`/`anon` sem checar papel nem proprietário, e campos de autoria (`created_by`, `approvedBy`, `inspectedBy`, `userId` de auditoria) aceitos do payload do cliente. Guard de rota **falha aberto** enquanto grants carregam. Busca global (Cmd/Ctrl+K) ignora a permissão de menu.

**Correção central:** RLS por papel/proprietário; `SECURITY INVOKER` quando possível; validar `is_approved_user()`/alçada dentro de toda função `DEFINER`; derivar identidade de `auth.uid()` no servidor; guard de rota deve **negar** enquanto grants não chegam e em erro de query; condicionar cada query da busca global à rota permitida.

---

## Achados por domínio

Cada seção abaixo preserva a ordenação Crítico → Baixo da fatia correspondente.

---

### P01 · Motores (lib): consumo, custeio, grading, markup, print

**Resumo:** cinco falhas críticas podem gerar compra/separação/débito incorretos: escala de grade de solado, conversão com taxa zero, largura mm×dm, divergência de `sole_consumption` e sync offline incompleta. Também: disponibilidade de solado que ignora numeração, XSS no preview de impressão e injeção ZPL.

- 🔴 **Grade de solado da Lista de Separação não soma o total da OP** — `src/lib/bomConsumption.ts:1182-1207`. `Math.round(qty×mult)` por número; soma ≠ `order.quantity`. Grade `{34:1,35:1,36:1}` p/ OP de 4 gera 3. **Fix:** `scaleGradeWithLargestRemainder` (já usado em `:807-810`). *Confirmado.*
- 🔴 **`conversion_rate=0` → fator 1 → OC em unidade errada** — `src/lib/materialAvailability.ts:259-271`, `src/lib/materialAutoPO.ts:45-55`. Falta de 300 m com taxa 0 → OC de 300 rolos. **Fix:** bloquear quando unidades divergem sem fator positivo; `effectiveConversionFactorStrict`. *Confirmado.* (ver T1)
- 🔴 **Largura em mm interpretada como dm na compra por PV** — `src/lib/purchaseConversion.ts:44-52`, `GeneratePurchaseOrdersDialog.tsx:91-101`. `1000 mm`→`1000 dm`; fator 100→10.000; necessidade de 1.000 dm² gera 0,1 m. **Fix:** `dimensions_unit` obrigatório. *Confirmado.* (ver T2)
- 🔴 **Planejamento usa `sole_consumption`, débito por grade não** — `src/lib/orderConsumption.ts:1376-1389`, `bomConsumption.ts:730-736`, mig `20260915110000:687-746`. `sole_consumption=2` + OP 100 → picking/custo 200, estoque baixa 100. **Fix:** restringir a 1 ou aplicar multiplicador à grade antes de reservar/debitar. *Confirmado.*
- 🔴 **Retry offline remove PV da fila mesmo se os itens nunca foram criados** — `src/lib/mobile/syncEngine.ts:51-85`. Insert do PV ok + insert de itens falha → `23505` lido como dedup → fila removida. PV sem itens. **Fix:** buscar por `client_request_id`, reconciliar itens; RPC transacional. *Confirmado.*
- 🟠 **Disponibilidade de solado ignora falta por numeração** — `src/lib/soleAvailability.ts:279-376`. Compara saldo total, mas débito faz `LEAST` por número. Estoque `{34:0,35:100}` vs demanda `{34:60,35:40}` passa como suficiente. **Fix:** carregar `stock_grade`, déficit por chave. *Confirmado.*
- 🟠 **XSS persistente no preview de impressão** — `src/lib/printGroupedReport.ts:323-324,473-475`, `printOrder.ts:233-242`. `imageUrl`/HTML sem escape em `iframe.srcdoc` sem `sandbox`. **Fix:** escapar atributos, validar protocolo, sandbox restritivo. *Confirmado.* (ver T6)
- 🟠 **Injeção de comandos ZPL nos campos de etiqueta** — `src/lib/printLabels.ts:1132-1136,1497-1534`. Sanitizador preserva `^` e `~`. `^XZ` no nome/cor encerra a etiqueta. **Fix:** `^FH`/hex ou rejeitar delimitadores. *Confirmado.*
- 🟠 **Renomear rótulo de tira duplica o consumo** — `src/lib/strapConsumption.ts:17-57`. Chave de merge `id+label`; rótulo renomeado não casa com snapshot → conta 2×. **Fix:** chave por `id` quando existir. *Confirmado.*
- 🟠 **Relatórios ainda imprimem grade divergente do total** — `printCombinedSectorReport.ts:57-73`, `groupedReportSummary.ts:251-260`, `exportCombinedReport.ts:99-137`, `printOrder.ts:825-842`. `Math.round` por número + omite chaves conjugadas (`33/34`). **Fix:** `scaleGradeWithLargestRemainder` + iterar chaves reais. *Confirmado.*
- 🟡 **Área de DXF com `bulge` calculada como polígono de cordas** — `src/lib/dxfArea.ts:4-13,105-108`. Ignora arcos → dm²/par incorreto. **Fix:** calcular arco ou marcar aproximado. *Confirmado.*

---

### P02 · Hooks (camada de acesso a dados)

**Resumo:** ledgers de consumo/WIP graváveis direto pelo browser; tarefas sem isolamento real; reativações/resyncs deixam OP ativa sem reserva; fluxos financeiros não-transacionais; conversão dm²→m com fallback 1.

- 🔴 **RLS de tarefas permite ler/alterar tarefa de qualquer usuário** — `useNoteTasks.ts:75,201`, mig `20260531170000:68`. Policy `USING(true)`; filtro `created_by` só no cliente; batch não preenche autor. **Fix:** RLS por `auth.uid()`, autoria por trigger. *Confirmado.* (ver T5)
- 🔴 **Ledger de consumo de produção forjável/editável/apagável pelo frontend** — `useProductionConsumptions.ts:79,118`, mig `20260317102950:396`. Insert/update/delete diretos em `production_consumptions`. **Fix:** DML só por RPC transacional; ledger imutável. *Confirmado.*
- 🔴 **Recebimento de PA e WIP ledger manipuláveis pelo cliente** — `useFinishedGoods.ts:52,76`, mig `20260326110220:171`. Aceita `inspectedBy` do caller. **Fix:** RPC que valide saldo e grave `auth.uid()`; ledger append-only. *Confirmado.*
- 🔴 **NF avulsa cria PV faturado órfão, sem idempotência de intenção** — `useNfe.ts:307,340`, `emit-nfe/index.ts:346`. PV nasce `Faturado` antes dos itens e da Edge Function; dedup por `sale_order_id`; cada retry cria outro PV. **Fix:** PV+itens+emissão em outbox transacional com idempotency key. *Confirmado.* (ver T4)
- 🔴 **Reativação de PV ignora falha ao reservar solado/tiras/embalagem** — `useSaleOrders.ts:807,837,859`. OP vira `Reservado` antes das reservas; só o débito híbrido é checado. **Fix:** consolidar status só após todas as reservas; compensar em falha. *Confirmado.*
- 🔴 **Resync legado apaga dados e segue após erros** — `useSaleOrders.ts:2326,2391,2653`. Estornos/deletes/recriações multi-request ignorando erros; escolhe tiras pelo primeiro item de mesma ref/cor. **Fix:** `resync_op_atomic`, preservar `sale_order_item_id`, abortar na 1ª falha. *Confirmado.*
- 🔴 **Entrada avulsa pode creditar estoque 2×** — `useAvulso.ts:123,131`, `PurchaseOrders.tsx:1031`. Após crédito, updates de "recebido" descartam erro → OC segue `approved` → operador recebe de novo. **Fix:** crédito+marcação em RPC transacional. *Confirmado.*
- 🔴 **Conversão área→metro usa fallback 1 e ignora largura** — `useMaterialExplosion.ts:60`, `unitConversion.ts:129`, `useProducts.ts:79`. 1.000 dm² napa larg. 1,40 m → correto ~7,14 m; fallback indica 1.000 m. **Fix:** bloquear sem largura; validar `>0`. *Confirmado.* (ver T1/T2)
- 🔴 **Alterar receita artesanal enfileira OS que o processador nunca consome** — `useArtisanalRecipes.ts:113`, migs `20260504180000:154`/`20260522120000:177`. Trigger enfileira por `artisanal_order_id` mas `process_resync_queue` filtra `order_id IS NOT NULL`. **Fix:** implementar handler artesanal. *Confirmado.*
- 🟠 **Falha de reconhecimento financeiro pós-NF é suprimida** — `useNfe.ts:374,603`. Erro de `syncFinancialRecords` só no console; `nfe_first_due_date` ignora erro. **Fix:** persistir pendência + retry server-side. *Confirmado.*
- 🟠 **Cancelar OC pode deixar conta a pagar aberta** — `usePurchaseOrders.ts:274,294`. Falha ao cancelar AP só logada, mas `onSuccess` diz "cancelada". **Fix:** OC+AP em RPC transacional. *Confirmado.*
- 🟠 **Contas pagas/recebidas permitem adulterar dados de baixa** — `useFinance.ts:124,135,154`. Bloqueio por status só dispara se payload tem `amount`/`status`; `amount_paid`/`payment_date` passam. **Fix:** whitelist por status + imutabilidade no banco. *Confirmado.*
- 🟠 **Geração de OCs por PV deixa lote parcialmente criado** — `usePerPvPurchasing.ts:85,127`. Compensação remove só a última OC. **Fix:** lote em RPC transacional. *Confirmado.*
- 🟠 **Autoria/aprovação de versão de BOM falsificáveis** — `useBomVersions.ts:33,68`, mig `20260317102950:83`. `createdBy`/`approvedBy` do cliente têm precedência. **Fix:** gravar `auth.uid()` no banco. *Confirmado.* (ver T5)
- 🟡 **Variância de consumo desatualizada ao alterar só o padrão** — `useProductionConsumptions.ts:95,99`. Só recalcula com `actual_*`. **Fix:** recalcular ambos os eixos. *Confirmado.*

---

### P03 · Produção / PCP e fichas de operador

**Resumo:** consumo por unidade errada, grades que não fecham o total, Solagem/Silk sem escalonar a base, Kanban linear incompatível com preparação paralela, XSS na impressão, folha histórica reescrita, integridade mascarada como "verde".

- 🔴 **Consumo de área tratado como metro linear** — `MaterialConsumptionTab.tsx:64-105,259-304`. Napa 2 dm²/par p/ 100 pares aparece como 200 m. **Fix:** reusar motor `orderConsumption`. *Confirmado.* (ver T2)
- 🔴 **Grades impressas/demanda de corte não somam o total** — `Aviamento.tsx:225-232,769-775`; `Colagem.tsx:225-229`; `Costura.tsx:249-252`; `Acabamento.tsx:222-225`; `Montagem.tsx:447-450`; `Corte.tsx:238-288`. **Fix:** `scaleGradeWithLargestRemainder` uma vez. *Confirmado.* (ver T3)
- 🔴 **Solagem e Silk usam a curva-base sem escalar** — `Solagem.tsx:64-66,305-344`; `Silk.tsx:52-68,301-340`. OP de 120 cuja base soma 12 demanda/imprime 12. **Fix:** escalar antes de agrupar. *Confirmado.* (ver T3)
- 🔴 **XSS persistente no preview de impressão** — `printOrder.ts:233-242,290-308`; `Aviamento.tsx:205-268`. **Fix:** escapar tudo, sandbox sem `allow-scripts`. *Confirmado.* (ver T6)
- 🔴 **Alterar R$/par reescreve snapshots históricos da folha** — `FichaMontadoresPage.tsx:421-430,502-515`; `montadorProduction.ts:4-85`; `Payroll.tsx:593-599`. `persistRateMontador` atualiza todas as fichas do montador sem limitar período. **Fix:** taxa nova só p/ novos apontamentos. *Confirmado.*
- 🔴 **Kanban linear corrompe o fluxo paralelo de preparação** — `ProducaoKanban.tsx:53-86,325-415`, mig `20260912120000:48-60`. `deriveCard` ignora `parallel_group`; conclui setores pulados com zero. **Fix:** apontar setor escolhido; não finalizar paralelos com zero. *Confirmado.*
- 🔴 **`conversion_rate=0` aceito como 1:1** — `unitConversion.ts:123-130`; `useMaterialExplosion.ts:58-100`; `ExplosionPanel.tsx:97-106`; `OrderReservationForm.tsx:49-81`. **Fix:** falhar fechado quando unidades diferem. *Confirmado.* (ver T1)
- 🟠 **Chamada por setor conflita no índice único e falha sob concorrência** — `FichaMontadoresPage.tsx:337-454`, migs `20260901120000`/`20260901130000`. Índice `(dia, montador_id)` mas UI separa por setor. **Fix:** índice `(dia, montador_id, setor)` + upsert atômico. *Confirmado.*
- 🟠 **Criação legada de OS contorna idempotência por OP/setor** — `ProductionControlCenter.tsx:1026-1044`, mig `20260703120000:18-25`. Usa `related_order_id`/`sector` em vez do vínculo canônico. **Fix:** RPC idempotente. *Confirmado.*
- 🟠 **Onda criada sem OC/OS necessárias e com estado parcial** — `WaveBuilder.tsx:371-409`; `waveTimelineService.ts:102-362`. Falha de OC ignorada com `continue`. **Fix:** RPC transacional onda+timeline+OC+OS. *Confirmado.*
- 🟠 **Impressão libera ficha sem consumo quando o cálculo falha** — `PrintWorkSheetsPage.tsx:663-865`; `useBulkOrderConsumption.ts:150-175`. `bulk-order-consumption` fora do gate; exceção vira `[]`. **Fix:** propagar falha por OP. *Confirmado.* (ver T8)
- 🟠 **Capacidade semanal divide por dias diferentes dos alocados** — `CapacityPlanning.tsx:54-296`. `bizDaysBetween` inclusivo vs alocação exclusiva. **Fix:** semântica `[start,end)` consistente. *Confirmado.*
- 🟠 **RCCP desloca entregas do dia 1º do mês pro mês anterior** — `RCCPPlanning.tsx:163-185`. `new Date(ISO date-only)` em UTC. **Fix:** `parseISO` date-only local. *Confirmado.*
- 🟠 **Lead Time grava capacidades em setores errados e omite setores** — `LeadTime.tsx:29-375`; `leadTime.ts:102-111`. Rótulos trocados (Costura↔Forração, Corte↔Corte Palmilha); Costura/Aviamento/Solagem sem campo. **Fix:** expor os 10 setores canônicos com colunas corretas. *Confirmado.*
- 🟡 **"Todo período" de consumo limitado a 500 OPs em silêncio** — `MaterialConsumptionTab.tsx:64-398`. **Fix:** paginar/agregar no servidor + indicar limite. *Confirmado.* (ver T7)
- 🟡 **Diagnóstico mostra falha de RPC como auditoria aprovada** — `SystemDiagnostics.tsx:104-660`. Erro → array vazio → "nenhuma inconsistência". **Fix:** estado explícito de indisponibilidade. *Confirmado.* (ver T8)

---

### P04 · Pedidos de venda (PV) e ordens

**Resumo:** cancelar OP em lote não estorna estoque; aprovar PV cria OP sem reserva; edição de PV destrói a identidade dos itens; crash determinístico ao abrir etapa; reserva por motor legado com dm² como metro; XSS no resumo.

- 🔴 **Abrir etapa de produção quebra por violação da ordem de Hooks** — `SectorStageDialog.tsx:130,178`; `Orders.tsx:315-316`. `useState(pendingConfirm)` depois de `if(!stage) return null`. ESLint acusa `react-hooks/rules-of-hooks`. **Fix:** mover o `useState` antes do return. *Confirmado.*
- 🔴 **Cancelamento em lote não libera reservas nem estorna estoque** — `Orders.tsx:649-664`; `useOrders.ts:268-319`. Só `UPDATE status='Cancelada'`; não chama `release_order_reservations`/`restore_*`. **Fix:** `useCancelOrdersBatch`/RPC transacional. *Confirmado.* (ver T4)
- 🔴 **Aprovação de PV cria OP "Reservado" sem reserva de materiais** — `SaleOrders.tsx:730-754,2479-2491`; `useSaleOrders.ts:759-771`; mig `20260629230000:65-159`. Gatilho cria OP/etapas mas não debita/reserva. **Fix:** aprovação+OP+reserva em RPC única. *Confirmado.*
- 🔴 **Edição de PV apaga e recria itens, quebrando identidade de OP/OS** — `SaleOrderForm.tsx:438-475`; `useSaleOrders.ts:1844-1854`; mig `20260607130000:88-121`. Form não carrega `sale_order_items.id`; RPC faz DELETE+INSERT; OPs ficam com `sale_order_item_id=NULL`. **Fix:** UPSERT por id; bloquear delete de item com OP ativa. *Confirmado.*
- 🔴 **Falhas de reserva na edição deixam OP ativa e utilizável** — `useSaleOrders.ts:2119-2227`. Falha de tira→toast, embalagem→log; OP segue `Reservado`. **Fix:** rollback verificado em qualquer falha obrigatória. *Confirmado.*
- 🔴 **Edição usa dois motores de reserva incompatíveis, com dm² cru** — `useSaleOrders.ts:2053-2115`; migs `20260627120000`/`20260527130000`. `try_reserve_materials` multiplica escalar sem conversão e reserva todos os solados; `hybrid_debit` vê reserva e faz `idempotent_skip`. **Fix:** um motor canônico por OP (`calculate_order_consumption_by_grade`). *Confirmado.* (ver T2)
- 🟠 **OP avulsa aceita PV na UI mas perde vínculo/grade/componentes** — `Orders.tsx:1029-1058`; `useOrders.ts:7-159`. `sale_order_id` via `as any` não é persistido. **Fix:** exigir item estável de PV ou remover seletor. *Confirmado.*
- 🟠 **"Aprovar OPs" só cria etapas, não aprova nem reserva; fallback omite Costura** — `Orders.tsx:674-743`; `useSaleOrders.ts:16-27`. **Fix:** transição canônica + `DEFAULT_OP_STAGES`. *Confirmado.*
- 🟠 **XSS armazenado no resumo de produção impresso** — `OrdersSummary.tsx:200-260`; `printOrder.ts:233-242`. **Fix:** `escapeHtml` + sandbox. *Confirmado.* (ver T6)
- 🟡 **Auditoria de fluxo trata falha de consulta como dado vazio** — `OrderFlowAudit.tsx:63-85`. 9 queries ignoram `error`; limites 200–5.000. **Fix:** falhar quando query crítica falha. *Confirmado.* (ver T8)
- 🟡 **Indicador de pipeline em edição de OP preso no primeiro corte** — `OrderEdit.tsx:106-131`; `stageFlow.ts:17-24`. Busca `Corte` genérico; canônico é `Corte Palmilha`/`Corte Forração`. **Fix:** nomes canônicos. *Confirmado.*

---

### P05 · Fichas técnicas e de componente

**Resumo:** ajuste de estoque concorrente, troca de unidade sem conversão, consumo de solado divergente do débito SQL, ficha sem largura inflando ~100×, editor que pula a validação.

- 🔴 **Ajuste manual de estoque perde movimentos concorrentes** — `ProductDetail.tsx:803-847`; mig `20260503211415:11-25`. Calcula saldo do snapshot React e sobrescreve `products.quantity` após o trigger já recalcular. **Fix:** `adjustStockSafe`/RPC `adjust_stock`; nunca escrever `quantity` direto. *Confirmado.* (ver T4)
- 🔴 **Troca de unidade-base altera só o rótulo** — `ComponentSheets.tsx:1722-1759,1984-2040`. `update({unit})` sem converter saldo/preço/mín/máx/fator. **Fix:** bloquear com saldo/reserva; RPC que converta campos e inverta preço. *Confirmado.*
- 🔴 **Ficha aceita material linear sem largura e infla consumo** — `ComponentSheets.tsx:663-684,1230-1259`; `useComponentSheets.ts:81-114`; `materialConsumption.ts:297-311`. Sem largura, `convertDm2ToLinearMeters` devolve dm² cru → ~100×. **Fix:** exigir largura+unidade linear antes de salvar; constraint no banco. *Confirmado.* (ver T2)
- 🔴 **Editor de grade de solado pula a validação e deixa colunas do motor vazias** — `SoleTechnicalDetails.tsx:461-508,679-685`; mig `20260721150000:121-145`. Botão chama `handleSave(true)` (bypass); `validateSpecs` não cobre `lining_consumption_dm2`/`insole_lining_consumption_dm2`. **Fix:** save normal valida; cobrir todas as colunas. *Confirmado.*
- 🔴 **`sole_consumption` exibido no PV não é aplicado pelo motor SQL** — `TechnicalSheets.tsx:2415-2417`; `orderConsumption.ts:1471-1482`; mig `20260721150000:192-199`. TS multiplica, SQL fixa `1`. **Fix:** paridade ou bloquear ≠1. *Confirmado.*
- 🟠 **Espelhamento de specs entre cores falha em silêncio** — `SoleTechnicalDetails.tsx:524-614`. `upsert`/`delete` das cores irmãs ignoram `error`; toast diz sucesso. **Fix:** RPC transacional; validar cada retorno. *Confirmado.*
- 🟠 **Alterar ficha de componente não resincroniza OPs/reservas abertas** — `useComponentSheets.ts:102-129`; `useTechnicalSheets.ts:10-345`. Só invalida cache (ficha técnica chama `resyncOPsForSheet`, componente não). **Fix:** enfileirar recomputação das OPs dependentes. *Confirmado.*
- 🟠 **`conversion_rate=0` pode ser salvo e é mascarado como 1** — `number-input.tsx:28-100` (não aplica `min`); `ProductDetail.tsx:713-716`; `useProducts.ts:9-28`; `materialAvailability.ts:269-274`. **Fix:** validar `>0` no componente/schema + constraint. *Confirmado.* (ver T1)
- 🟠 **Salvar consumos embutidos navega pra página anterior** — `SoleTechnicalDetails.tsx:618-620`; `ProductDetail.tsx:657-666`; `ComponentSheets.tsx:1509-1516`. Sem `onClose` → `window.history.back()`. **Fix:** `onClose` obrigatório. *Confirmado.*
- 🟡 **Aba de embalagem do solado não entrega o que anuncia** — `BaseConsumption.tsx:287-296`; `SolesComponentSheetTab.tsx:405-411`; `PackagingTab.tsx:35-57`. Passa só `soleGroupId` → aba retorna aviso; hooks após return condicional. **Fix:** implementar vínculo ou remover; reordenar hooks. *Confirmado.*

---

### P07 · Financeiro, NF-e, notas, custos de insumo

**Resumo:** NF avulsa fatura sem baixar estoque nem CMV; XML reimportável duplica nota/estoque/AP; pagamentos parciais realocados pra última data; corrida na conciliação; `conversion_rate=0`.

- 🔴 **NF avulsa fatura sem baixar estoque nem registrar CMV** — `useNfe.ts:307-366`; `StandaloneNfePanel.tsx:63-65`; mig `20260628140000:17-21`. Saldo 10 → emite 10 → saldo continua 10; CMV zero infla margem/DRE. **Fix:** autorização aciona RPC que debita produto + CMV vinculados à NF. *Confirmado.* (ver T4)
- 🔴 **XML reimportável duplica estoque e AP** — `XmlImportDialog.tsx:253-738`; mig `20260306154506:25-40`. Pré-checagem só por número+série; ignora `invoice_key`; oferece "Importar mesmo assim". **Fix:** `UNIQUE` na chave de 44 dígitos + importação transacional. *Confirmado.*
- 🔴 **DRE de caixa atribui pagamentos parciais à última baixa** — `BankReconciliationTab.tsx:255-283`; `useFinanceIntelligence.ts:167-295`. Acumula `amount_received` e sobrescreve `payment_date` único. AR 1.000 (400 jun + 600 jul) vira 1.000 em jul. **Fix:** tabela imutável de liquidações por evento. *Confirmado.*
- 🔴 **Conciliação concorrente perde/sobrescreve baixas parciais** — `BankReconciliationTab.tsx:245-286`. Lê saldo, calcula no cliente, update por status sem lock/versão. **Fix:** RPC com lock de linha/incremento atômico. *Confirmado.*
- 🔴 **`conversion_rate=0` tratado como fator 1** — `PurchasePlanningWizard.tsx:400-407`; `unitConversion.ts:123-154`; `InputCostsPage.tsx:361-364`. Placa fator 150 salvo 0 → 600 dm² vira 600 placas. **Fix:** rejeitar `<=0`; `CHECK`. *Confirmado.* (ver T1)
- 🟠 **Falha da RPC de largura converte dm² cru em unidade física** — `PurchasePlanningWizard.tsx:329-398`. Erro de `get_material_conversion_info` descartado → `widthMissing=false` → divide por 1. **Fix:** bloquear linha de área se RPC falhar. *Confirmado.* (ver T2)
- 🟠 **AR pode ficar ausente após autorização assíncrona da NF-e** — `useNfe.ts:593-704`; `nfe-status/index.ts:139-152`; `sync-ar/index.ts:1-14`. Se NF ainda `processando`, gate não cria AR; verificação posterior não sincroniza. **Fix:** sync idempotente no backend ao virar `autorizada`; cron só contingência. *Confirmado.*
- 🟠 **Importação de boleto aceita o mesmo título repetidamente** — `BoletoUploadDialog.tsx:80-233`; mig `20260427133717:4-6`. Sem dedup por linha digitável/barcode. **Fix:** normalizar barcode + unicidade no banco. *Confirmado.*
- 🟠 **CT-e e MDF-e reutilizam formulário do documento anterior** — `CTe.tsx:172-240`; `MDFe.tsx:203-321`. Dialog montado inicializa `form` só no `useState`, sem sincronizar ao trocar `editing`. **Fix:** `useEffect([open, editing?.id])` ou `key`. *Confirmado.*

---

### P08 · Etiquetas e embalagem

**Resumo:** ajuste manual sobrescreve débito concorrente; ficha A4 imprime quantidade errada em lote parcial; sugestão de embalagem por modelo legado; status de impressão sem lastro físico; truncamento silencioso; template selecionado não controla a saída.

- 🔴 **Ajuste manual de estoque sobrescreve débito concorrente e perde auditoria** — `PackagingStockPanel.tsx:191-274`. Grava `box_types.quantity` absoluto; ignora erro do movimento. **Fix:** RPC com lock + delta; hook canônico já proíbe (`usePackaging.ts:128-135`). *Confirmado.* (ver T4)
- 🔴 **Fichas A4 omitem/superestimam pares em lotes parciais** — `printOperatorFichas.ts:87-101`. `Math.round(total/baseSum)` + grade completa por ficha. OP 13 (base 12) → 1 ficha de 12 (perde 1); OP 18 → 2×12=24. **Fix:** `ceil` + última ficha com saldo remanescente. *Confirmado.* (ver T3)
- 🟠 **Sugestão de embalagem diverge do débito real e mascara caixa ausente** — `PackagingDecision.tsx:39-114`. Lê slots legados de `product_groups`; débito usa `technical_sheet_box_types`; `Number(undefined) ?? null` = `NaN`. **Fix:** consultar `technical_sheet_box_types`; tratar não-finito como indisponível. *Confirmado.*
- 🟠 **Status de impressão não representa a impressão física** — `LabelProductionTab.tsx:703-1579`. Jobs inseridos como `completed` antes do PDF; abas mock mutadas em memória. **Fix:** separar gerado/solicitado de confirmado-impresso. *Confirmado.*
- 🟠 **Limites silenciosos descartam etiquetas térmicas/hangtags** — `LabelProductionTab.tsx:1002-1217`. `Math.min(…, 2000)` térmica, 500 hangtag. **Fix:** remover truncamento ou confirmar com paginação. *Confirmado.* (ver T7)
- 🟠 **Template selecionado não controla a impressão** — `LabelProductionTab.tsx:734-1554`. IDs só no select/preview; geração usa builders fixos. **Fix:** renderer por template ou desabilitar seleção. *Confirmado.*
- 🟠 **Etiqueta manual usa nome da ficha como material** — `LabelManualTab.tsx:129-309`. Preenche `materials` com `technical_sheets.name`. **Fix:** resolver variante/cor via `resolveMaterialLabels`. *Confirmado.*
- 🟠 **Rótulo externo duplicado por ficha com o mesmo volume** — `LabelProductionTab.tsx:1330-1424`. Cria `boxItem` por ficha; 12 fichas → 12 rótulos "Volume 1/1". **Fix:** 1 item por caixa master. *Confirmado.*
- 🟠 **Editor promete replicar material/tiras na térmica, mas não replica** — `LabelProductionTab.tsx:752-2173`. Override térmico só aceita ref/nome/cor. **Fix:** expandir override aos campos impressos. *Confirmado.*
- 🟡 **Calibração térmica inacessível e não aplicada** — `LabelSystem.tsx:38-87`; `LabelCalibrationTab.tsx:312-398`. Salva em `localStorage` mas produção não lê. **Fix:** aplicar na construção térmica ou remover promessa. *Confirmado.*

---

### P09 · RH, ponto, folha, montadores

**Resumo:** folha e ponto alteráveis por qualquer autenticado (RLS permissiva + RPCs `DEFINER` sem authz); folha por par corta produção acima de 1.000; ponto/espelho/folha divergem em sábado, ausência e feriado; identidade por nome; mutação retroativa após fechamento.

- 🔴 **RLS de `payroll_runs` permite ler/escrever a qualquer autenticado** — migs `20260620140000:123-128`, `20260607120000:89-98`. Policy só `auth.uid() IS NOT NULL`. **Fix:** authz de RH/admin; acesso do próprio por vínculo. *Confirmado.* (ver T5)
- 🔴 **RPCs de completar ponto ignoram autorização** — migs `20260524140000:385-447`, `20260613120000:61-123`. `complete_punches`/`apply_manual_punch_completion` `DEFINER` p/ `authenticated`, sem checar dono/papel/período; `["18:00","08:00"]` passa. **Fix:** exigir papel RH + validar vínculo/cronologia no servidor. *Confirmado.*
- 🔴 **Identidade do ponto é nome+data, não matrícula** — mig `20260430132830:1-17`; `useTimesheet.ts:1104-1158`; `ManualEntryTab.tsx:133-224`; `EspelhoPontoPage.tsx:89-99`. Homônimos colidem. **Fix:** chave por `employee_id`+data com FK. *Confirmado.*
- 🔴 **Folha de montador corta produção acima de 1.000 (PostgREST)** — `Payroll.tsx:245-599`; `useMontadorProducao.ts:15-27`. Sem paginação/`order`. Regime `producao` recebe menos que produziu. **Fix:** RPC agregada por `montador_id`. *Confirmado.* (ver T7)
- 🔴 **Pagamentos: funcionário errado, sobrepagamento e autor forjado** — mig `20260901140000:25-174`; `usePayrollPayments.ts:167-221`. FKs independentes p/ run/employee; sem limite ao saldo; `created_by` do cliente. **Fix:** validar `employee_id` contra a run; `auth.uid()`; RPC com lock + `total_pago+novo <= liquido`. *Suspeita — confirmar aplicação da migration de set/2026.*
- 🟠 **Sábado usa jornada de dia útil no ponto/espelho, não na folha** — `useTimesheet.ts:653-655`; `pontoEngine.ts:82-90`. `expectedDayMinutes` sem `dow`. Sábado 08–12 aparece com déficit falso de 5h. **Fix:** passar `dayOfWeek` em todas as chamadas. *Confirmado.*
- 🟠 **Ausências abonam só a folha e podem ser alteradas após fechamento** — `Payroll.tsx:577-645`; `EspelhoPontoPage.tsx:101-168`; `RelatorioFaltas.tsx:252-279`; `useEmployeeAbsences.ts:46-106`. Espelho/relatórios não recebem `absenceDates`; tela ignora guard de folha fechada; tudo gravado `justified:true`. **Fix:** expansão central de ausências + bloqueio pós-fechamento. *Confirmado.*
- 🟠 **Relatórios de faltas/atrasos exibem descontos diferentes da folha** — `RelatorioFaltas.tsx:73-329` (`/30`); `RelatorioAtrasos.tsx:73-184` (`/220`). Folha usa dias úteis da escala/jornada. **Fix:** transportar `falta_desconto`/`atraso_desconto` de `computePeriodFolha`. *Confirmado.*
- 🟠 **Lançamento manual de ponto alterável após folha aprovada/paga** — `ManualEntryTab.tsx:199-247`; mig `20260705130000:1-17` (trava removida). **Fix:** bloquear DML de ponto coberto por `payroll_runs` não-rascunho. *Confirmado.*
- 🟠 **Feriados recorrentes resolvidos de forma inconsistente** — `Timesheet.tsx:283-807`; `Payroll.tsx:153-158`; `EspelhoPontoPage.tsx:101-145`. UI marca `recurring=true` mas motores usam data literal. **Fix:** resolvedor central que expande `MM-DD` por ano. *Confirmado.*
- 🟠 **Baixa em lote de vales baixa pendências futuras** — `useEmployees.ts:242-255`; `AdvancesPanel.tsx:309-459`. `useSettleEmployeeAdvances` altera todos os `pending` sem filtrar período/`payroll_run_id`. **Fix:** baixa por `payroll_run_id`. *Confirmado.*
- 🟡 **Painel de pendências pode ocultar registros após 1.000 linhas** — `useTimePendings.ts:79-90`. Lê `v_time_pendings` sem `.range()`. **Fix:** paginar. *Confirmado.* (ver T7)

---

### P10 · Terceirização, fornecedores, compras

**Resumo:** OS/NF/recebimentos alteram estoque/financeiro em etapas independentes e reprocessáveis; dois bypasses de RLS (incluindo linhas de PV expostas a `anon`); OCs duplicáveis por PV e por cotação; parcelas de AP duplicadas/incompletas.

- 🔴 **OS consolidada é enviada e concluída sem despacho, baixa ou pagamento** — `useConsolidatedServiceOrders.ts:131-160`; migs `20260913120000:181-192`, `20260628120000:19-26`. "Enviar" só marca `Enviada`+`dispatch_tracked=true`; entrega conclui sem AP. **Fix:** RPCs de despacho+baixa e retorno+AP. *Confirmado.* (ver T4)
- 🔴 **Despachos de OS com RLS totalmente aberta** — mig `20260825120000:12-24`. `so_dispatches_all` `USING(true) WITH CHECK(true)`. **Fix:** restringir a aprovados; correções por RPC. *Confirmado.* (ver T5)
- 🔴 **RPC expõe linhas de PV a usuários anônimos** — mig `20260703120000:31-251`. `get_pv_outsourceable_lines` `DEFINER` com `GRANT EXECUTE` p/ `anon`. **Fix:** revogar `anon`, `INVOKER`, validar acesso ao PV. *Confirmado.*
- 🔴 **Geração de OS por PV confia em contratada/qtd/tarifa do cliente** — mig `20260703120000:129-244`. Só checa positividade. **Fix:** derivar setor/contratada/tarifa/limite no banco. *Confirmado.*
- 🔴 **Formulário cria OS mesmo quando a baixa de material falha** — `ServiceOrderFormDialog.tsx:226-254`. "OS criada mesmo assim". **Fix:** OS+débito em RPC ou estado `pendente_de_baixa`. *Confirmado.*
- 🔴 **Débito de material de OS usa "metros" crus em qualquer unidade** — `ServiceOrderFormDialog.tsx:509-522`; `serviceOrderStock.ts:15-104`. Napa dm²: 1 m larg. 1 m deveria baixar 100 dm², baixa 1. **Fix:** converter linear→área pela largura; bloquear sem conversão. *Confirmado.* (ver T2)
- 🔴 **Planejamento semanal pode criar 2 OS pro mesmo excedente** — `OutsourcingPlanningTab.tsx:185-302`; mig `20260513210000:40-43`. Dedup só no cache da tela; índice não único. **Fix:** unicidade por demanda ou RPC com claim. *Confirmado.*
- 🔴 **"Compras por Pedido" volta a duplicar OCs após 30s** — `usePerPvPurchasing.ts:81-133`; migs `20260523130000:37-47`, `20260925132000:295-332`. Chave `perpv::` só protegida por trigger de 30s; índice permanente exclui `perpv::`. **Fix:** chave determinística coberta por unicidade + RPC. *Confirmado.*
- 🔴 **Cotação aprovada gera OCs duplicadas indefinidamente** — `Quotations.tsx:245-255`; mig `20260701210000:10-53`. `create_po_from_quotation` sempre insere; sem vínculo/idempotência. **Fix:** guardar `quotation_id` único ou idempotency key. *Confirmado.*
- 🔴 **Largura mm interpretada como dm na criação de OC** — `CreatePurchaseOrderDialog.tsx:49-205`; `GeneratePurchaseOrdersDialog.tsx:91-101`; `purchaseConversion.ts:44-123`. Também normaliza `rate=0`→`1`. **Fix:** propagar `dimensions_unit`; rejeitar `<=0`. *Confirmado.* (ver T1/T2)
- 🔴 **Recebimento de OC pode creditar estoque 2×** — `PurchaseOrders.tsx:1030-1345`. Crédito antes de `received_*`; falha só logada. **Fix:** RPC transacional por recebimento com idempotency key. *Confirmado.*
- 🔴 **Parcelas de AP da OC não são atômicas nem idempotentes** — `PurchaseOrders.tsx:938-987`. Qualquer AP com `[OC#id]` conclui "todas existem"; inserts um a um. **Fix:** RPC transacional + único `(purchase_order_id, installment_number)`. *Confirmado.*
- 🔴 **Reimportação explícita de NF duplica estoque e passivo** — `XmlImportDialog.tsx:253-738`; mig `20260306154506:25-40`. **Fix:** único por chave de acesso + fluxo separado de complemento/cancelamento. *Confirmado.*
- 🔴 **Entradas de NF têm caminhos sem claim atômico do item** — `Suppliers.tsx:93-146`; `AddToStockDialog.tsx:252-350`. Produto/movimento/marcação em requests separadas; WAC após crédito. **Fix:** RPC idempotente por `invoice_item_id`. *Confirmado.*
- 🟠 **Exclusão de NF deixa estoque e AP sem documento de origem** — `useSuppliers.ts:164-173`; migs `20260306154506`/`20260306180804`. Cascade sem estornar estoque; AP com `invoice_id=NULL`. **Fix:** bloquear hard delete; estorno transacional. *Confirmado.*
- 🟠 **Confirmação repetida de boleto duplica todas as parcelas** — `AddBoletoFinanceDialog.tsx:79-103`. Sempre `insert`. **Fix:** único `(invoice_id, installment_number)` + upsert. *Confirmado.*

> Nota de escopo: `src/pages/OutsourcedInField.tsx` não existe no workspace auditado.

---

### P12 · UI base, layout, contexts, services, permissões, telas gerais

**Resumo:** autorização granular pode falhar aberta; busca global consulta dados sem respeitar o menu; várias tabelas permitem mutação direta a qualquer aprovado; OCs duplicáveis por cotação e por reexecução de onda; tarefas sem isolamento; monitor com métricas aleatórias.

- 🔴 **Tarefas globais; usuários "consulta" ainda conseguem alterá-las** — mig `20260531170000:65-74`; `useNoteTasks.ts:61-174`; `Tarefas.tsx:263-269`; `TaskBoard.tsx:50-89`. `USING(true)`; batch sem `created_by`; UI ignora `perm.canEdit`. **Fix:** RLS por dono/papel; `canEdit` nas views. *Confirmado.* (ver T5)
- 🔴 **Guard de rota falha aberto enquanto grants carregam/falham** — `useAccessControl.ts:310-475`; `App.tsx:307-352`. `loading` só considera `rolesQuery`; grants pendentes/erro → `[]` → cai no RBAC legado. **Fix:** aguardar grants; erro nega. *Confirmado.*
- 🔴 **Busca global exibe dados sem validar permissão da rota** — `GlobalSearch.tsx:217-519`; migs `20260404193149`, `20260528120000:71-74`. OPs/clientes/produtos/PV/fornecedores sem gate. **Fix:** condicionar cada query à rota; RLS por domínio. *Confirmado.*
- 🔴 **Automações alteráveis por qualquer aprovado** — mig `20260527190000:23-35`; `useAutomations.ts:63-138`. Rota é do módulo `sistema` mas policies só exigem `is_approved_user()`. **Fix:** restringir a admin; execução por RPC auditada. *Confirmado.*
- 🔴 **Gerar OC a partir de cotação não é idempotente** — mig `20260701210000:10-56`; `Quotations.tsx:245-284`. **Fix:** vínculo único com a cotação + lock. *Confirmado.* (ver T4)
- 🔴 **Reexecução de onda adiciona a mesma necessidade de novo à OC** — `waveTimelineService.ts:94-220`. `waveId` não participa da dedup; envia necessidade inteira como `p_qty_delta`. **Fix:** demanda por `wave_id+product_id`; delta do já registrado. *Confirmado.*
- 🟠 **Alterações de cotação podem terminar parciais; tela confirma preços não gravados** — `Quotations.tsx:215-729`. Três `UPDATE`s independentes; erros por item ignorados. **Fix:** RPC transacional. *Confirmado.*
- 🟠 **Editar e-mail de outro perfil altera o e-mail do admin logado** — `EditProfileDialog.tsx:109-135`; `Settings.tsx:675-727`. `supabase.auth.updateUser()` sempre altera a sessão atual. **Fix:** só o próprio, ou Edge Function admin com ID alvo. *Confirmado.*
- 🟠 **Substituir permissões apaga a allow-list antes de recriá-la** — `useUserManagement.ts:271-306`; `useAccessControl.ts:310-326`. Delete + insert separados; falha → sem grants → RBAC legado (mais amplo). **Fix:** RPC transacional. *Confirmado.*
- 🟠 **Tela de Clientes ignora `canEdit`** — `Clients.tsx:166-558`; `useClients.ts:128-140`; mig `20260329163941:76-80`. Edição de crédito/fiscal/grupo sem gate. **Fix:** `perm.canEdit` em todos os controles; RLS por papel. *Confirmado.*
- 🟠 **Matriz do grupo econômico não é atômica nem garantida pelo banco** — `useEconomicGroup360.ts:435-460`; mig `20260512120000:53-62`. **Fix:** RPC com lock + índice único parcial `WHERE is_matriz`. *Confirmado.*
- 🟠 **Contatos/notas/anexos de grupo econômico mutáveis por qualquer aprovado** — mig `20260512120000:87-171`; `EconomicGroupDetail.tsx:650-871`. **Fix:** RLS por papel + gates `useCan`; autor no servidor. *Confirmado.*
- 🟠 **Trilha de auditoria forjável pelo cliente** — `auditService.ts:18-40`; mig `20260404015618:57-60`. `logAuditEvent` grava `event.userId` do cliente. **Fix:** gerar em trigger/RPC com `auth.uid()`. *Confirmado.* (ver T5)
- 🟠 **Manutenção preventiva: CRUD a qualquer aprovado** — mig `20260528120000:94-115`; `useMaintenance.ts:64-99`; `MaintenancePage.tsx:275-324`. **Fix:** RLS por papel + `useCan`. *Confirmado.*
- 🟡 **Filtro de ficha técnica interpola texto cru na gramática PostgREST** — `services/supabase/fichas-tecnicas.ts:91-101`. `.or(\`code.ilike.%${termo}%,...\`)` sem escape. **Fix:** escapar sintaxe PostgREST ou RPC parametrizada. *Confirmado.*
- 🟡 **Rotas secundárias não podem ser concedidas pela matriz granular** — `data/navigation.ts:196-245`; `useUserManagement.ts:280-298`; `useAccessControl.ts:315-319`. `/sac`, `/forecast`, `/audit-logs` fora de `getAllMenuItems()`. **Fix:** catálogo único menu+rotas secundárias. *Confirmado.*
- 🟡 **System Monitor apresenta métricas aleatórias como produção** — `SystemMonitor.tsx:49-126`. Latência/erro/usuários via `Math.random()`. **Fix:** observabilidade real ou marcar como demo. *Confirmado.* (ver T8)

---

### P06 · Estoque, grupos, solados, MRP, receitas, picking

**Resumo:** caminhos críticos alteram saldo/reserva/custo fora dos invariantes transacionais; picking pode ser encerrado sem baixa; bipagem perde unidades sob concorrência; largura mm×dm infla até 100×; perda de saldo por conjugação e sobrescrita concorrente de grades.

- 🔴 **Largura mm usada como dm infla conversões/custos em 100×** — `ProductFormDialog.tsx:799-1743`; `MrpProjectionsTab.tsx:124-132`; `MrpNeedsTable.tsx:40-52`; `purchaseConversion.ts:44-132`. `effectiveConversionFactor` assume `dm` sem unidade; form grava `conversion_rate = 10×largura` sem normalizar. Napa 1.400 mm → `1 m = 14.000 dm²` (correto 140). **Fix:** propagar `dimensions_unit`; centralizar em `widthInDm`; bloquear fator automático sem largura/unidade. *Confirmado.* (ver T2)
- 🔴 **Editor de variante altera `quantity`/`reserved_stock` direto, sem RPC nem trilha** — `MasterVariantDialog.tsx:85-242`; `useProducts.ts:162-179`. Contorna a proteção do hook padrão (que remove `quantity`/`stock_grade`). Pode zerar `reserved_stock` com reservas ativas → MRP vê comprometido como livre. **Fix:** remover qty/reserva do editor; ajuste por RPC; `reserved_stock` derivado das reservas. *Confirmado.* (ver T4)
- 🔴 **Baixa manual permite consumir material já reservado** — `ManualStockOutDialog.tsx:33-121`; mig `20260819120000:33-65`. Valida contra `quantity`, não `quantity − reserved_stock`; `adjust_stock` idem. 100 estoque/90 reservado → baixa de 50 aceita → disponível negativo. **Fix:** validar na RPC sob lock que saída comum não reduza abaixo de `reserved_stock`. *Confirmado.*
- 🔴 **Sessão de picking finalizável sem efetivar a baixa** — `Picking.tsx:163-288`; mig `20260613120000:202-212`. "Finalizar" vai a `concluida` sem exigir `stock_committed_at`; depois esconde "Dar baixa". 10 unidades conferidas concluem sem debitar. **Fix:** transição via RPC que faça/valide o commit; banco rejeita `picked_qty > committed_qty`. *Confirmado.*
- 🔴 **Bipagem de picking perde unidades em concorrência** — `Picking.tsx:387-400`. `picked_qty + 1` calculado no cliente, sem incremento atômico. Duas bipagens leem 0, gravam 1 → some 1 unidade. **Fix:** RPC de incremento atômico. *Confirmado.* (ver T4/concorrência)
- 🟠 **Remover conjugação abandona saldo no bucket antigo** — `SoleSizeConjugationsEditor.tsx:144-239`; `SoleConjugationPanel.tsx:118-155`; `SoladoGradeDialog.tsx:495-520`. Excluir `"33/34"` não migra o saldo p/ 33 e 34 → 12 pares viram zero. **Fix:** bloquear remoção com saldo; realocar por RPC. *Confirmado.*
- 🟠 **Concorrência de grade não detecta redistribuição com total igual** — `StockAdjustmentPage.tsx:275-612`; mig `20260819120000:38-65`. Conflito só por `quantity`; dois movimentos de mesmo total sobrescrevem o JSON. **Fix:** versionar a grade (hash/updated_at) e validar sob `FOR UPDATE`. *Confirmado.*
- 🟠 **RPC de picking incompatível com solado graduado** — `Picking.tsx:651-669`; migs `20260613120000:152-168`, `20260620310000:24-33`. `commit_picking_session` reduz só `quantity`, não `stock_grade` → trigger de coerência aborta. **Fix:** proibir solado graduado genérico ou debitar grade+quantity juntas. *Confirmado.*
- 🟠 **Consumo de fachete não pode ser zerado** — `SolesCadastroTab.tsx:348-827`. Form remove linhas `dm2<=0`; mutation nunca zera/apaga as existentes. 0,25 dm²/par permanece e é reservado/custeado. **Fix:** enviar grade completa com zero ou excluir explicitamente. *Confirmado.*
- 🟠 **Cópia de materiais padrão pode apagar BOM parcialmente** — `SoleStandardMaterialsEditor.tsx:207-305`. Delete antes do insert, sem validar; cópia p/ vários solados em requests sequenciais. **Fix:** RPC por destino, delete+insert na mesma transação. *Confirmado.*
- 🟠 **Operações de hierarquia de grupos não são atômicas** — `useGroups.ts:107-146`; `useGroupOrganization.ts:129-145`. Desvincula fichas/produtos antes do delete final; família criada antes de mover. **Fix:** encapsular em RPCs transacionais. *Confirmado.*
- 🟠 **Diálogo "adicionar item ao picking" consulta colunas inexistentes e esconde o erro** — `Picking.tsx:150-698`. Seleciona `code`/`ean` que `products` não tem; erro ignorado → lista vazia. **Fix:** usar `sku`; propagar `error`. *Confirmado.* (ver T8)
- 🟡 **Salvar receita artesanal com várias bases pode persistir só parte** — `ArtisanalRecipes.tsx:161-229`. Updates/inserts/deletes sequenciais sem transação. **Fix:** RPC transacional que substitua o conjunto de bases. *Confirmado.*
- 🟡 **Painel de reservas mostra totais incompletos acima de 5.000 produtos** — `StockReservations.tsx:148-162`. `limit(5000)` tratado como universo completo. **Fix:** paginar + agregar no banco. *Confirmado.* (ver T7)

---

### P11 · Logística, transporte, entrega própria

**Resumo:** RLS aberta na frota/entrega própria; cubagem que subdimensiona carga; romaneio que registra volume mas não efetiva a expedição do PV (reaparece em fluxos posteriores); rotas próprias não-atômicas, roteirizáveis sem status de expedição e concluíveis com paradas pendentes; dois cadastros de "transportadora" incompatíveis.

- 🔴 **RLS de frota e entrega própria libera tudo p/ qualquer autenticado** — mig `20260512120000_own-delivery-module.sql:182-197`. 5 tabelas com `FOR ALL TO authenticated USING(true) WITH CHECK(true)`. Expõe CNH/telefone de motorista; qualquer um edita veículos/rotas/preço de combustível. **Fix:** escopo por dono/empresa + RLS por `auth.uid()`; operações sensíveis por RPC. *Confirmado.* (ver T5)
- 🔴 **Cubagem usa a capacidade do baú como se fosse a quantidade solicitada** — `OrderTransportCalculator.tsx:79-128`; `packingCalculator.ts:113-120`. `calculatePacking` retorna `best.total` quando a demanda excede a capacidade, sem marcar falha nem calcular viagens. 500 pares (42 caixas) num baú de 10 → calcula 10. **Fix:** separar solicitado/capacidade/viagens; `fits:false` + volume total na recomendação/frete. *Confirmado.*
- 🔴 **Adicionar volume ao romaneio não registra a expedição do pedido** — `Manifests.tsx:420-450`. Insere só em `shipping_volumes`; não chama `register_order_shipment` nem muda status/`shipped_at` do PV. Romaneio vai a `entregue` com PV ainda `Faturado` → reaparece / dupla expedição. **Fix:** RPC transacional que bloqueie o PV, valide NF/status e faça a transição. *Confirmado.* (ver T4)
- 🔴 **Rota própria não mantém pedido e paradas consistentes** — `useDeliveryRoutes.ts:139-258`. `useOwnDeliveryOrders` não filtra status do PV; `useUpdateRouteStatus` altera só `delivery_routes.status`, não paradas/`delivered_at`/estado do pedido. Rota "concluída" com paradas `pending`. **Fix:** restringir a status prontos p/ expedição + RPC de transição atômica. *Confirmado.*
- 🔴 **Criação de rota e paradas não é atômica nem impede PV duplicado** — `useDeliveryRoutes.ts:103-124`; mig `20260512120000:80-98`. Rota e paradas em chamadas separadas; sem restrição de PV em 2 rotas ativas. **Fix:** RPC transacional com `FOR UPDATE` nos PVs + regra no banco. *Confirmado.*
- 🟠 **Alerta de sobrecarga não bloqueia salvar a rota** — `RoutePlannerOwn.tsx:99-434`. `exceedsCapacity` só muda o aviso; `canSubmit` não exige `!exceedsCapacity`. Veículo 1.000 kg / carga 1.200 kg salva. **Fix:** bloquear salvar com sobrecarga; override auditado se necessário. *Confirmado.*
- 🟠 **Recalcular totais do romaneio pode gravar zero após erro de leitura** — `Manifests.tsx:203-223`. Leitura de `shipping_volumes` ignora `error` → `undefined` → totais zero → `update` também ignora erro. **Fix:** propagar erros; agregação por RPC. *Confirmado.* (ver T8)
- 🟠 **Permissões granulares não protegem mutações de romaneio/transporte** — `Manifests.tsx:252-274`; `Transport.tsx:108-204`. Botões usam `editable`, não `perm.canEdit`; Transporte não usa `useCan`. Usuário "consulta" avança status / edita cadastros. **Fix:** `canCreate/canEdit/canDelete` + RLS/RPC. *Confirmado.* (ver T5)
- 🟠 **"Transportadoras" da aba Transporte e do romaneio são cadastros incompatíveis** — `useTransport.ts:182-200`; `Manifests.tsx:577-600`. Transporte grava `transport_companies`; romaneio usa `transporters`; sem sincronização. **Fix:** unificar numa tabela canônica ou integrar explicitamente. *Confirmado.*
- 🟠 **Campo `responsavel` provavelmente quebra salvar transportadora em produção** — `Transport.tsx:584-658`; `useTransport.ts:196-201`; `types.ts:22737-22788`. Payload sempre inclui `responsavel`, mas `transport_companies` (tipo gerado) não tem essa coluna; TS loose deixa passar. **Fix:** adicionar coluna+regenerar tipos ou remover o campo. *Suspeita — confirmar em `information_schema.columns` de produção.*
- 🟡 **Comparação de fretes faz 1 consulta por transportadora** — `OrderTransportCalculator.tsx:621-648`. Cada `CarrierRateCard` chama `useTransportCompanyRates(id)` → waterfall de N queries. **Fix:** buscar todas as tarifas numa query e mapear por `transport_company_id`. *Confirmado.*

---

## Apêndice — Metodologia e limitações

- **Cobertura:** 12 fatias cobrindo todo `src/` exceto `src/integrations/supabase/types.ts` (gerado). Cada fatia recebeu o mesmo prompt e leu os arquivos reais em sandbox read-only.
- **Falsos positivos possíveis:** achados que citam migrations com data **> 28/07/2026** (ex.: `CHECK conversion_rate > 0` em `20260814…`, `payroll-payments` em `20260901…`) estão marcados **Suspeita** — confirmar o estado real no banco de produção antes de agir, conforme a regra do projeto "a verdade é o banco, não os arquivos de migration".
- **Nota de escopo:** `src/pages/OutsourcedInField.tsx` (listado na fatia P10) não existe no workspace; foi ignorado.
- **Não coberto por este sweep:** as ~1257 migrations SQL como corpo isolado, e a paridade fina entre os motores SQL (`calculate_order_consumption*`) e o motor TS — vários achados aqui (T1, T2, `sole_consumption`) já apontam divergências SQL↔TS que merecem uma auditoria SQL dedicada via MCP do Supabase.
- **Reprodutibilidade:** relatórios por fatia preservados em `scratchpad/audit/reports/P01…P12.md` (sessão).
