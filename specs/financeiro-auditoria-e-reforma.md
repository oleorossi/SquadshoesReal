# Financeiro — auditoria e reforma

> Spec fechada em **01/08/2026** após auditoria de código + dados de produção
> (`ssvxfoybzmjlypnipqzn`) e entrevista de decisão com o dono.
> Todos os números abaixo foram medidos no banco, não estimados.
> **Executor:** Codex. **Planejamento:** esta spec é a fonte de verdade do escopo.

---

## 1. Diagnóstico

### 1.1 O achado central

O financeiro **não está quebrado nem faltando** — está construído, ligado e **dormente**.
Cada cadeia automática existe e funciona, mas espera uma transição de status que
ninguém executa. Não é um problema de features ausentes; é de gatilho humano.

| Cadeia | Maquinário | Gatilho humano que falta | Consequência medida |
|---|---|---|---|
| AR → CMV → margem | `trg_ar_recompute_cmv` → `recompute_sale_order_cmv_recognition` | baixa da AR | **0 de 72** AR com `amount_received > 0` ⇒ DRE com receita **e** custo zerados |
| Folha → despesa | `tg_payroll_sync_financial_entry` (exige `status in ('aprovado','pago')`) | aprovar a folha | **394 de 395** folhas em `rascunho` ⇒ maior despesa fixa invisível |
| NF entrada → AP | **não existe** | subir o XML | 4 NFs em 5 meses vs **R$ 3.328.487,67** em 54 OCs |
| Extrato → baixa | `BankReconciliationTab` grava `amount_received`/`payment_date` corretamente | colar/subir extrato | **0** conciliações desde sempre |

### 1.2 Estado dos dados (01/08/2026)

**Contas a receber (72 linhas):**
- 32 `pending` — R$ 349.474,40
- 40 `cancelled` — R$ 470.505,90
- `amount_received > 0`: **0** · `payment_date is not null`: **0**

**Contas a pagar (9 linhas):** 1 `paid` (R$ 3.521,99) · 8 `pending` (R$ 24.033,09)

**`financial_entries` (162 linhas):**

| reference_type | tipo | status | n | valor |
|---|---|---|---|---|
| `sale_order` | receita | `confirmed` | 43 | R$ 523.716,80 |
| `sale_order` | receita | `estornado` | 26 | R$ 255.475,20 |
| `sale_order_cmv` | despesa | `pendente` | 43 | R$ 345.899,30 |
| `sale_order_cmv` | despesa | `cancelado` | 24 | R$ 82.948,87 |
| `sale_order_factoring` | despesa | `confirmed` | 15 | R$ 11.639,56 |
| `sale_order_frete` | despesa | `pendente` | 11 | R$ 4.568,96 |

**PVs `Faturado` (44 — R$ 574.542,80):**

| grupo | PVs | valor | AR ativa |
|---|---|---|---|
| com NF autorizada | 11 | R$ 173.630,00 | 11 |
| sem NF, **com factoring** | 12 | R$ 284.896,80 | 0 |
| sem NF, sem factoring (mar→17/abr) | 21 | R$ 116.016,00 | 0 |

**Factoring — 77% do faturamento:** Nalin 16 PVs / R$ 517.087,20 (2 dias, 3,5% a.m.) ·
Malupe 5 / R$ 102.771,60 (2 dias, 3,5%) · Jaelson 3 / R$ 9.974,00 (5 dias, 3%).
Confirmado na entrevista: **só prazo e taxa variam** entre elas — `factoring_config`
já cobre o modelo, nenhum campo novo necessário.

**Tabelas com 0 linhas:** `chart_of_accounts`, `cost_centers`, `budgets`,
`cnab_remittance_files`, `cnab_remittance_items`, `commission_tiers`,
`finance_attachments`, `fixed_assets`, `labor_costs`, `overhead_allocations`,
`bank_reconciliations`, `bank_reconciliation_items`, `payroll_payments`,
`sale_order_cmv_recognized`.

### 1.3 Bugs confirmados

**B1 — Furo no gate anti-ghost-revenue (R$ 350.086,80).**
`syncFinancialRecordsCore` ([`src/lib/financialSync.ts:260-288`](../src/lib/financialSync.ts#L260-L288))
cancela a AR quando não há NF, mas o `DELETE` em `financial_entries` exclui
`confirmed` do filtro. Resultado: **32 PVs têm receita `confirmed` e zero AR ativa**.
O gate apaga a cobrança e mantém a receita — o oposto exato do que existe pra fazer.

**B2 — Tela CNAB nunca listou nada.**
[`src/pages/CNAB.tsx:50`](../src/pages/CNAB.tsx#L50) seleciona `customer_name`
(a coluna é `client_name`) **e** filtra `status='pendente'` (o valor real é `'pending'`).
Dois erros independentes, ambos engolidos por `return data || []`. Além disso a tela
não gera arquivo CNAB nenhum — só insere uma linha em `cnab_remittance_files`.

**B3 — 28 NF-e autorizadas órfãs bloqueiam o reconhecimento de receita (R$ 115.245,60).**
O gate exige `nfe_emitidas.sale_order_id = PV` **e** `status='autorizada'`. Uma NF
autorizada **sem** `sale_order_id` é invisível pro gate — a receita fica barrada mesmo
existindo documento fiscal válido.

Estado medido:

| origem | autorizadas | ligadas a PV | **órfãs** |
|---|---|---|---|
| emitida pelo app (`ref_nfe = nfe-…`) | 8 | 8 | 0 |
| sync do painel (`ref_nfe = gc-sync-…`) | 32 | 4 | **28** |

Confirmado que o app **não** emite desde 18/06 (última: #278, `-r4`, cancelada) — as
notas seguintes saíram do painel ClickNotas e entraram por sync. O sync religa ao PV via
`extractPvNumber`, que depende do trecho `Pedido de Venda: <n>` em
`informacoes_complementares`; nota emitida no painel não carrega esse trecho, então
entra órfã. **28 notas, R$ 115.245,60, de 11/05 a 30/07, 12 destinatários.**

⚠ **Religar por valor é impossível.** O grupo Raquel tem 15 filiais com PV de exatamente
R$ 1.836,00 e há múltiplas NFs no mesmo valor — casamento automático erraria o dono da
nota. O destinatário também não desambigua: a NF sai para a matriz
(`RAQUEL CALCADOS LTDA`) enquanto o PV é da filial. **Tem que ser operação assistida.**

**B4 — Duplicidade estrutural.** `src/components/finance/` e `src/components/financial/`
coexistem. Conciliação bancária existe como rota `/bank-reconciliation` **e** como
sub-aba dentro de "Comissões & Factoring".

---

## 2. Decisões tomadas (entrevista 01/08/2026)

| # | Decisão | Justificativa dada |
|---|---|---|
| D1 | O caixa é controlado **fora** do sistema (banco/factoring). Baixa vem de **importação/derivação**, nunca de digitação obrigatória. | Nunca foi a fonte de verdade do caixa. |
| D2 | Corrigir o gate: **estornar a `financial_entry` junto com a AR**. | Receita e cobrança param de divergir. |
| D3 | Escopo é **tudo** (caixa + DRE + contabilidade + cobrança). Ordem definida por dependência técnica. | — |
| D4 | Factoring: só **prazo e taxa** variam ⇒ modelo atual serve. | — |
| D5 | Extrato disponível: **arquivo OFX** ⇒ escrever parser OFX real. | Hoje só existe parser de texto colado. |
| D6 | AP nasce da **NF de entrada do fornecedor** (duplicatas do XML). | Obrigação real nasce com a NF. |
| D7 | A rotina **vai mudar**: todo XML de entrada será importado. Sistema deve facilitar (lote) e cobrar (pendência). | — |
| D8 | Baixa de factoring: **sugere e espera confirmação em 1 clique**, em lote. | Não trocar uma mentira (receita fantasma) por outra (recebimento não verificado). |
| D9 | Os 12 PVs sem NF com factoring (R$ 284.896,80): **o dinheiro entrou** ⇒ AR nasce e já entra baixada pela regra de factoring; pendência fiscal marcada à parte. | Factoring desconta duplicata; ignorá-los abriria buraco de R$ 285k no caixa. |
| D10 | Os 21 PVs mar→17/abr (R$ 116.016,00): **informais**, saem do financeiro, **mas visíveis em relatório à parte**. | Fase pré-NF documentada como tal. |
| D11 | Folha vira **AP automática ao aprovar**. | Maior despesa recorrente, hoje 100% invisível. |
| D12 | Aprovar folha é **conferência real** — falta o sistema cobrar. Aprovação em lote + pendência visível. | — |
| D13 | Superfície morta: **esconder atrás de "recursos avançados"**, manter o código. | Financeiro com 4-5 telas que funcionam > 15 que fingem. |
| D14 | DRE: **caixa e competência lado a lado**. | Caixa = "quanto sobrou no bolso"; competência = "o mês foi lucrativo". A diferença é o a receber/pagar. |
| D15 | **Tela "Fechamento"** com tudo que falta confirmar, com ações em lote. | É a resposta de design pro problema de adoção — sem ela o resto volta a dormir. |

---

## 3. Invariantes — não violar

**I1. AR é sempre BRUTA.** Decisão de 14/06/2026, mantida. `accounts_receivable.amount`
= valor total da venda. O custo do factoring é despesa separada
(`financial_entries.reference_type = 'sale_order_factoring'`), debitada **uma única vez**.

**I2. Baixa de factoring grava `amount_received = amount` (bruto), não o líquido.**
Existe `CHECK (amount_received <= amount)`. Se a baixa gravar `total − juros`, o título
fica **eternamente em `parcial`** com resíduo igual aos juros, **e** os juros passam a
ser contados duas vezes (como resíduo não recebido + como despesa `sale_order_factoring`).
O recebível **foi** liquidado integralmente; o desconto é custo de financiamento já
lançado à parte.

**I3. Linha `received`/`paid` é sagrada.** Nenhuma rotina desta spec pode alterar,
cancelar ou apagar linha já baixada. Vale para backfills.

**I4. `financialSync.ts` tem espelho byte-idêntico** em
`supabase/functions/sync-ar/financialSync.ts` (idem `saleOrderAR.ts`, `factoringCalc.ts`).
Travado por `src/lib/__tests__/financialSyncShared.parity.test.ts`. **Toda alteração
precisa ser aplicada nos dois arquivos.**

**I5. Trilha de auditoria preservada.** Lançamento `posted`/`paid`/`reconciled` nunca é
deletado — vira `estornado`. O que muda nesta spec é que `confirmed` **passa a ser
estornável pelo gate** (B1); os demais estados seguem intocados.

**I6. Migration nova usa carimbo > maior versão registrada** (hoje `20261019120000`),
não a data corrente.

**I7. Typecheck real:** `bunx tsc -p tsconfig.app.json --noEmit`. A raiz não checa nada.

---

## 4. Escopo por fase (ordem = dependência técnica)

### FASE 0 — Parar de mentir

Nada de novo é confiável enquanto os números atuais estiverem errados.

**0.1 — Corrigir o furo do gate (B1).**
Em `syncFinancialRecordsCore`, no branch em que o gate barra a receita (PV `Faturado`
sem NF autorizada e sem NF externa): além de cancelar a AR, **estornar** a
`financial_entry` de receita — `UPDATE ... SET status='estornado'` em vez de depender do
`DELETE` que exclui `confirmed`. Mesma regra no branch de PV `Cancelado` e de PV
informal (`nfe_required=false` / `Finalizado s/ NF`).
Aplicar em **`src/lib/financialSync.ts` e no espelho** (I4).
*Aceite:* nenhum PV com `financial_entries` receita `confirmed` e zero AR ativa.

**0.2 — Backfill dos 32 PVs (R$ 350.086,80).**
Migration que estorna as receitas `confirmed` órfãs. **Excluir do backfill** os 12 PVs
do grupo factoring (D9) — esses vão ganhar AR na fase 1, e sua receita é real.
Efeito esperado: a DRE de competência cai ~R$ 116k (os informais). Isso é correção, não
perda — o número já estava errado.

**0.3 — Reclassificar os 21 PVs informais (D10).**
Migration marcando-os como `Finalizado s/ NF` — status que o motor **já** sabe ignorar
(cancela AR e limpa lançamento sem exceção nova no código).
Lista: PVs `Faturado`, sem NF autorizada, `is_factoring = false`, criados entre
2026-03-09 e 2026-04-17. **Gerar a lista e conferir antes de aplicar.**

⚠ **Recomputar a lista depois de 0.4.** Os 21 PVs foram contados com as 28 NF-e órfãs
ainda desvinculadas — se alguma delas pertencer a um desses PVs, ele **não** é informal.
Rodar o religamento primeiro e só então fechar a lista.

**0.4 — Religar as 28 NF-e órfãs (B3) — antes de classificar qualquer PV como informal.**
Esta etapa **precede** 0.2 e 0.3: um PV hoje contado como "sem nota" pode ter NF
autorizada órfã, e religá-la faz o gate liberar sozinho — sem `allowMissingNf`, sem
exceção no código, fiscalmente limpo.

Tela assistida (não automática, ver ⚠ em B3): lista as NF-e autorizadas com
`sale_order_id is null`, e para cada uma sugere PVs candidatos por **valor + janela de
data + CNPJ do destinatário**, exibindo `numero`, `data_emissao`, `nome_destinatario`,
`valor_total`. O usuário escolhe. Ao vincular, disparar `syncFinancialRecordsCore` do PV
— a AR nasce pelo caminho normal.

**Nunca vincular automaticamente**: valores colidem entre filiais do mesmo grupo.
Bloquear vincular a mesma NF a dois PVs, e vincular um PV que já tenha NF autorizada.

**Prevenção:** o sync de notas do painel deve marcar como pendência de vínculo (aparece
no Fechamento, 4.1) em vez de deixar a nota órfã silenciosa.

**0.5 — Relatório "Vendas sem nota" (D10).**
Nova visão listando PVs `Finalizado s/ NF` com cliente, valor e data, com total do
período. Fora da DRE e do caixa, mas visível. Onde: aba dentro de Relatórios do
Financeiro.

---

### FASE 1 — Baixa derivada de factoring (77% do caixa)

A maior alavanca: fecha o loop de 77% do faturamento **sem depender de extrato**.

**1.1 — Criar AR para os 12 PVs sem NF com factoring (D9).**
Usar o `allowMissingNf` que já existe em `SyncFinancialOptions` — as parcelas nascem com
`BACKFILL_SEM_NF_MARKER` em `notes`, e o branch de cancelamento do gate já pula essas
linhas. Marcar a pendência fiscal à parte (ver 1.4).

**1.2 — Motor de baixa sugerida de factoring.**
Nova lib `src/lib/factoringSettlement.ts` (+ teste colocado). Para cada AR de PV com
`is_factoring = true`, calcular a **liquidação prevista**:

- `data_prevista` = data-base + `factoring_config.receiving_days`
- `valor` = `amount` **bruto** (I2)
- data-base = data de autorização da NF-e quando existir; senão `delivery_deadline`;
  senão data de faturamento do PV. **Ver ponto aberto A1.**

Retorna a lista de títulos elegíveis (não `received`, não `cancelled`, `data_prevista <= hoje`).

**1.3 — UI de confirmação em lote (D8).**
Na tela Fechamento (fase 4) e na aba Contas: bloco "Factoring pronto pra baixa —
N títulos, R$ X". Seleção múltipla, confirmação em 1 clique. A gravação usa exatamente
o caminho já existente e correto do `BankReconciliationTab`
([`src/components/finance/BankReconciliationTab.tsx:283`](../src/components/finance/BankReconciliationTab.tsx#L283)):
`status`, `amount_received`, `payment_date`. **Extrair essa gravação para um hook
compartilhado** (`useSettleReceivable`) em vez de duplicar.
*Aceite:* confirmar um lote dispara `trg_ar_recompute_cmv` e popula
`sale_order_cmv_recognized` — receita **e** CMV aparecem na DRE no mesmo movimento.

**1.4 — Marcador de pendência fiscal.**
PV com AR ativa e sem NF autorizada aparece com selo "sem documento fiscal" na lista de
contas e conta como pendência no Fechamento. O selo **some sozinho** quando a NF for
emitida (o gate já reconhece).

---

### FASE 2 — Passivo real

**2.1 — NF de entrada gera contas a pagar (D6).**
`XmlImportDialog` hoje grava `invoices`, `invoice_items`, `products`, `purchase_orders`
— **nunca** `accounts_payable`, e **descarta as duplicatas do XML**.

Escrever parser de `<cobr><dup>` (campos `nDup`, `dVenc`, `vDup`) em
`src/lib/nfeDuplicatas.ts` (+ teste). Cada duplicata vira uma linha de
`accounts_payable`: `due_date = dVenc`, `amount = vDup`,
`installment_number`/`total_installments` da sequência, `supplier_id` e `invoice_id`
preenchidos, `category = 'material'`.
Sem bloco `<cobr>`: 1 AP à vista com `due_date = issue_date`.
**Idempotência:** índice único por `(invoice_id, installment_number)` — reimportar o
mesmo XML não duplica passivo.
**Retroativo:** `invoices.xml_data` guarda o XML cru — as 4 NFs já importadas podem ser
reprocessadas pela mesma função.

**2.2 — Importação em lote de XML (D7).**
Aceitar múltiplos arquivos de uma vez (arrastar N XMLs), com resumo por arquivo
(importado / duplicado / erro). Reduz o atrito que fez a rotina não pegar.

**2.3 — Folha aprovada vira AP (D11, D12).**
Ao aprovar a folha, gerar `accounts_payable` além do `financial_entry` que o trigger já
cria. Granularidade: **1 AP por funcionário por período** (rastreabilidade individual),
com `category = 'mao_de_obra'` e `due_date` = data de pagamento do período.
Idempotência por `(reference_type='payroll_run', reference_id)`.

**2.4 — Aprovação de folha em lote (D12).**
Tela de folha ganha "aprovar período inteiro" com conferência antes: total de proventos,
descontos e líquido do período, e destaque de outliers (funcionário com variação
atípica vs período anterior). As 394 folhas em rascunho **não** devem ser aprovadas em
massa às cegas — ver ponto aberto A2.

---

### FASE 3 — Conciliação OFX

**3.1 — Parser OFX real (D5).** `src/lib/ofxParser.ts` (+ teste). Hoje não existe: a tela
menciona OFX mas o parser é regex sobre texto colado
([`BankReconciliationTab.tsx:65`](../src/components/finance/BankReconciliationTab.tsx#L65)).
Extrair de cada `<STMTTRN>`: `DTPOSTED`, `TRNAMT`, `MEMO`/`NAME`, `FITID`.
`FITID` é a chave de idempotência — reimportar o mesmo extrato não duplica baixa.

**3.2 — Manter o parser de texto colado** como fallback. Não remover: é o caminho de
menor atrito quando o OFX não está à mão.

**3.3 — Unificar a conciliação (B4).** Uma única superfície. A rota
`/bank-reconciliation` e a sub-aba em "Comissões & Factoring" apontam para o mesmo
componente — eliminar a duplicação de UI.

**3.4 — Confronto com a baixa presumida de factoring.** Quando o extrato trouxer o
crédito da factoring, confrontar com a baixa já confirmada na fase 1 e sinalizar
divergência de valor ou data — sem baixar duas vezes (`FITID` + AR já `received`).

---

### FASE 4 — Fechamento e DRE

**4.1 — Tela "Fechamento" (D15).** Rota nova em Financeiro. Lista, com ação em lote em
cada bloco:

- Títulos de factoring prontos pra baixa (N, R$ X)
- **NF-e autorizadas sem PV vinculado** (N, R$ X) — leva à tela de religamento (0.4)
- Folhas em rascunho (N períodos)
- NFs de entrada sem conta a pagar (N)
- PVs faturados sem NF (N, R$ X)
- Contas vencidas sem baixa (N, R$ X)
- Extrato não conciliado (última importação, N linhas sem match)

Bloco com zero pendências fica recolhido, não some — assim a ausência de pendência é
informação, não silêncio ambíguo.

**4.2 — DRE caixa + competência lado a lado (D14).**
`useDREAuto` hoje é só caixa ([`src/hooks/useFinanceIntelligence.ts:171`](../src/hooks/useFinanceIntelligence.ts#L171)).
Adicionar a coluna de competência a partir do mesmo dado: receita por
`financial_entries` receita ativa na data do faturamento, CMV por `sale_order_cmv`,
despesa por AP na `due_date`. Exibir as duas colunas e a **diferença** (= a receber /
a pagar), que é o número que explica a distância entre lucro e caixa.

**4.3 — Honestidade quando não há dado.** Enquanto um período não tiver baixa
registrada, a DRE **não** mostra "R$ 0,00" como se fosse resultado: mostra o aviso de
que não há baixa no período e o link pro Fechamento. Zero silencioso foi a causa de o
erro ter durado meses.

---

### FASE 5 — Limpeza

**5.1 — "Recursos avançados" (D13).** Mover para trás de um disclosure: plano de contas,
centros de custo, orçamentos, imobilizado, comissões, CNAB, anexos. Código e tabelas
**permanecem** — só saem da navegação do dia a dia. Reaparecem automaticamente se a
tabela tiver linhas.

**5.2 — Corrigir a tela CNAB (B2).** `customer_name` → `client_name`;
`status='pendente'` → `'pending'`; e trocar `return data || []` por `if (error) throw error`.
Vai pra trás do disclosure (5.1), mas corrigida — tela quebrada escondida continua
quebrada quando alguém abrir.

**5.3 — Varredura de erro engolido.** `return data || []` sem checagem de `error` é o
padrão que produziu B2 e as outras telas mortas já catalogadas. Varrer o módulo
financeiro inteiro e trocar por `if (error) throw error`.

**5.4 — Unificar `finance/` e `financial/` (B4).** `financial/` é majoritariamente
compras/pricing/MRP, não financeiro. Mover cada arquivo para o domínio real
(`purchase/`, `pricing/`) e deixar `finance/` como o único diretório do setor.
Mudança mecânica de imports — fazer por último, em commit isolado.

---

## 5. Critérios de aceite globais

1. Nenhum PV com receita `confirmed` sem AR ativa correspondente.
1b. Nenhuma NF-e `autorizada` com `sale_order_id is null` sem triagem — ou está
   vinculada, ou está marcada como "não pertence a nenhum PV" (venda avulsa/painel).
2. Soma de `accounts_receivable` ativa dos PVs faturados = faturamento reconhecível
   (excluídos os informais de D10).
3. Confirmar um lote de factoring popula `sale_order_cmv_recognized` — receita e CMV
   aparecem juntos na DRE.
4. Reimportar o mesmo XML de NF de entrada não duplica AP.
5. Reimportar o mesmo OFX não duplica baixa (`FITID`).
6. Nenhuma linha `received`/`paid` é alterada por qualquer rotina desta spec (I3).
7. `bunx tsc -p tsconfig.app.json --noEmit` limpo · `bun run lint` limpo ·
   `bun run test` verde · `bun run check:tokens` limpo.
8. `financialSyncShared.parity.test.ts` verde (espelho intacto — I4).

---

## 6. Pontos abertos — confirmar antes de codar

**A1 — Data-base da liquidação de factoring.**
`computeARSchedule` usa `max(hoje, delivery_deadline) + receiving_days + dias_do_cliente`
como *vencimento* da parcela — que é quando o **cliente** paga, não quando a **factoring**
credita você. Para a baixa presumida preciso da data em que o dinheiro cai na conta.
*Recomendação:* data de autorização da NF-e + `receiving_days`; sem NF, data de
faturamento do PV + `receiving_days`. Errar aqui misdata ~R$ 630k de entrada de caixa.

**A2 — As 394 folhas em rascunho.**
Há períodos com formato irregular (`2026-06-16_2026-07-13`, `2026-06-22_2026-07-13`)
convivendo com mensais (`2026-07`). Antes de qualquer aprovação em lote, definir quais
períodos são folha oficial e quais são simulação — aprovar tudo lançaria despesa
duplicada e sobreposta.

**A4 — As 28 NF-e órfãs pertencem a PVs do sistema?**
São R$ 115.245,60 emitidos entre 11/05 e 30/07 para 12 destinatários. Se forem vendas
feitas direto pelo painel (fora do fluxo de PV), não há o que religar — e a receita
delas nunca vai aparecer no financeiro do app. Precisa de uma passada sua na lista antes
de decidir se 0.4 é religamento ou reconhecimento de venda avulsa.

**A3 — Ordem de execução das fases.** Fases 0 e 1 são sequenciais (0 limpa, 1 constrói
sobre limpo). Fases 2, 3 e 5 são independentes entre si. Fase 4 depende de 1 e 2.
