# Análise completa do cálculo — Setor Pessoas (RH)

- **Data:** 08/09/2026
- **Escopo:** pipeline Relógio → importação → ponto → compensação entre dias → hora extra → folha.
- **Natureza:** auditoria **read-only** do código e do contrato de produto. Nenhum motor de cálculo foi alterado nesta entrega.
- **Contrato de produto:** [`specs/gestao-de-pessoas.md`](../specs/gestao-de-pessoas.md)
- **Fonte de verdade do pagamento:** `src/lib/salaryPayroll.ts` → `computePeriodFolha` (versão `saldo-periodo-v2-2026-08-26`)

---

## Sumário executivo

A lógica que o dono descreveu **já é a regra canônica da folha**, com um ajuste de vocabulário:

| Frase do dono | Como o sistema interpreta hoje |
|---|---|
| Marcado no relógio de ponto | Só batidas (entrada/saída). O arquivo **não traz** hora extra. |
| Download do arquivo | `.txt` / `.xls` / `.xlsx` (KP1028 / AGL / AFD / CSV). |
| Sistema lê chegada, saída e “hora extra” | Lê chegada/saída; **calcula** HE depois. |
| Balanço entre os dias | Sim — créditos de um dia compensam atrasos de outro **dentro do período da folha**. |
| HE só depois do “mínimo de horas” | HE = excedente **após a jornada esperada**, depois do balanço do período. Saldo líquido positivo **≤ 10 min é descartado**; **> 10 min paga o saldo inteiro**. |

**Pagamento** usa um único motor mensal (`computePeriodFolha`). O risco atual não é “a fórmula da folha estar errada em relação à regra do dono”; é a **coexistência de visões** (relatório semanal na aba Relatórios; SQL por dia nas pendências; campo `minimum_overtime_minutes` da escala que a folha **não lê**) e **cópia stale** no cadastro de funcionários.

---

## 1. Mapa do pipeline

```text
Relógio físico (KP1028 / AGL / REP)
        │  download .txt / .xls / .xlsx
        ▼
RH → Ponto  (src/pages/Timesheet.tsx via RHHub)
        │  parseTimesheetTxt / parseTimesheetXlsx  (src/hooks/useTimesheet.ts)
        ▼
useImportTimeRecords
        │  RPC import_time_records_with_archive
        ▼
time_records.punches  (+ arquivo em time_import_logs)
        │
        ├─► Pendências (batida ímpar / incompleta) → resolver antes de fechar
        │
        ├─► buildPontoDays (src/lib/ponto/pontoEngine.ts)  — base por-dia
        │         │
        │         └─► splitDayMinutes + expectedDayMinutes
        │
        └─► computePeriodFolha (src/lib/salaryPayroll.ts)  — PAGAMENTO
                  │
                  ├─► Folha (Payroll / FolhaConsolidada)
                  ├─► Espelho do funcionário (EspelhoPontoPage)
                  ├─► Visão Geral do Ponto (OverviewTab)
                  └─► Relatórios (TimeBalanceReports — totais pagos vêm daqui;
                      agrupamento semanal é só apresentação)
```

### Telas do hub (`/rh`)

| Aba | Página | Papel no cálculo |
|---|---|---|
| Equipe | `Employees.tsx` | Cadastro: salário, jornada, taxas HE R$/h, regime |
| Ponto | `Timesheet.tsx` | Importar batidas, pendências, histórico de arquivo |
| Relatórios | `TimeBalanceReports.tsx` | Conferência de crédito/débito (ledger da folha + visão semanal) |
| Folha | `Payroll.tsx` + `FolhaConsolidada` | Fecha o período e paga |

Rotas legadas (`/timesheet`, `/ponto`, `/rh/banco-de-horas`) remapeiam ou foram removidas. **Banco de horas** foi dropado na migration `20260910130000_drop-bank-hours`.

### Arquivos-chave

| Camada | Path | Função |
|---|---|---|
| Import / parse | `src/hooks/useTimesheet.ts` | `parseTimesheetTxtContent`, `parseTimesheetXlsx`, `useImportTimeRecords` |
| Minutos no dia | `src/lib/hourlyPayroll.ts` | `splitDayMinutes` |
| Jornada esperada | `src/lib/salaryPayroll.ts` | `expectedDayMinutes`, `worksOnDow` |
| Motor de pagamento | `src/lib/salaryPayroll.ts` | `computePeriodFolha` → `calculateSalaryPayroll` |
| Base por-dia | `src/lib/ponto/pontoEngine.ts` | `buildPontoDays`, `computeFolha`, `computeWeekly` |
| HE semanal (legado/gerencial) | `src/lib/weeklyTimeCalculation.ts` | `calculateWeeklyPeriod` |
| Relatório de saldo | `src/lib/ponto/timeBalanceReports.ts` | `buildTimeBalanceReports` |
| SQL por dia | `calculate_day_summary` (migrations) | status/diff por dia com tolerância + mínimo |
| Spec | `specs/gestao-de-pessoas.md` | contrato negociado com o dono |

---

## 2. Fórmulas canônicas (pagamento)

Versão persistida no snapshot da folha: `PAYROLL_RULE_VERSION = 'saldo-periodo-v2-2026-08-26'`.

### 2.1 Minutos trabalhados no dia — `splitDayMinutes`

- Nº **ímpar** de batidas → `incomplete: true`, **0 minutos** (pendência; não paga nem desconta).
- Hora fora de faixa (`29:59` etc.) → pendência.
- **2 batidas** → span 1ª→última; em dia longo que cruza meio-dia, garante almoço mínimo de 1h na janela 12:00–14:00 (decisão do dono P1, 29/07/2026).
- **4+ pares** → soma dos pares reais.
- Sábado / domingo / feriado → bucket “premium” (classificação); o **valor** pago de HE na folha vem das taxas absolutas do funcionário, não do multiplicador 1,5× legado.

### 2.2 Jornada esperada — `expectedDayMinutes`

```text
dia útil:   saída − entrada − (fim_almoço − início_almoço)
sábado:     saturday_exit − saturday_entry  (se cadastrado; senão cai no padrão)
```

Exemplo padrão 08:00–18:00 com almoço 12:00–13:00 → **540 min (9h)**.

### 2.3 Saldo bruto do dia

Para cada dia útil coberto:

```text
raw_balance = worked − expected
  > 0  → crédito bruto (candidato a HE)
  < 0  → atraso bruto
  = 0  → normal
```

Regras de fronteira:

- **Tolerância diária de pagamento = 0** (todo minuto abaixo da jornada conta como atraso bruto).
- **Falta integral** (dia útil sem trabalho, sem abono) → desconto de **1 valor-dia**, **fora** da compensação entre dias.
- **Falta/atraso justificado** (`employee_absences`) → zera o desconto daquele dia/minutos.
- **Domingo/feriado trabalhado** → crédito bruto inteiro (taxa HE domingo/feriado).
- **Batida ímpar** → status `pending` no ledger; fora do pool de crédito/débito.

### 2.4 Balanço entre dias (período da folha)

Dentro do intervalo calculado (quinzena ou mês):

1. Soma `raw_credit_minutes` e `raw_delay_minutes`.
2. Compensa: créditos **normais** são consumidos primeiro; créditos de domingo/feriado são preservados quando ainda houver saldo positivo. Dentro de cada grupo, ordem **cronológica**.
3. `positiveBalance = max(0, créditos − atrasos)`.
4. Se `0 < positiveBalance ≤ minOvertimeMin` (default **10**) → **descarta** (não vira HE).
5. Se `positiveBalance > 10` → **paga todo o saldo restante** como HE (não só o que passou de 10).
6. Atraso líquido = débitos que sobraram após a compensação.

Trecho canônico (`salaryPayroll.ts`):

```text
positiveBalance = max(0, rawCreditMin - rawDelayMin)
discardPositive = usePolicy && positiveBalance > 0 && positiveBalance <= minOt
→ se discard: discarded_tolerance_minutes
→ senão:     payable_overtime_minutes
```

### 2.5 Dinheiro

```text
valor-dia          = salário ÷ dias_úteis_do_mês   (da escala + feriados)
valor-hora atraso  = valor-dia ÷ (jornada_diária_em_horas)
HE normal          = (he_normal_min / 60) × he_normal_rate
HE domingo/feriado = (he_holiday_min / 60) × he_sunday_holiday_rate
bruto              = salário_período − faltas − atraso_líquido + HE
líquido            = bruto − adiantamentos
```

Taxas HE são **R$/hora absolutas por funcionário** (não multiplicador da escala). Noturna usa HE normal (decisão 2026-07-09).

### 2.6 Regimes especiais

| Regime | Comportamento |
|---|---|
| **Mensalista** | Fórmulas acima (canônico). |
| **Remoto** | Salário cheio; ponto não desconta nem paga HE. |
| **Diarista** | `≥6h` → 1 diária; `2–6h` → 0,5; `<2h` → 0. Sem desconto de falta/atraso. |
| **Produção (por par)** | Folha por Ficha de Montadores; ponto só presença. |

---

## 3. Os três regimes de HE

Coexistem de propósito histórico. **Só o regime A paga.**

| Regime | Onde | Unidade | “Mínimo” | Quem usa na UI hoje |
|---|---|---|---|---|
| **A — Folha (pagamento)** | `computePeriodFolha` | Saldo líquido do **período** | 10 min no saldo positivo final (hardcoded via `minOvertimeMin ?? 10`) | Folha, Espelho do funcionário, Overview do Ponto, totais pagos dos Relatórios, Relatório de atrasos/faltas |
| **B — Semanal ISO** | `calculateWeeklyPeriod` / `computeWeekly` | Soma por **semana ISO** Mon–Sun | `schedule.tolerance_minutes` + `schedule.minimum_overtime_minutes` | Quase só testes + API de `pontoEngine`. UI viva migrou para o motor A |
| **C — SQL por dia** | `calculate_day_summary` | Diff **por dia** | `COALESCE(ws.minimum_overtime_minutes, 10)` e tolerância da escala | Pendências / fiscalização (`v_time_pendings`, reconciliação) |

### Nuance da aba Relatórios (`TimeBalanceReports`)

- Os **totais pagáveis** (`payableOvertimeMinutes`, `he_value`) vêm do motor A (folha).
- O **calendário semanal** reagrupa o ledger e mostra `worked − expected` **dentro de cada semana ISO**, sem reaplicar a compensação do período inteiro nem o piso de 10 min.
- Efeito prático: uma semana pode parecer “com HE” no relatório enquanto a folha do mês, após compensar atrasos de outra semana do mesmo período, paga menos (ou zero).

### Campo `work_schedules.minimum_overtime_minutes`

Editável na tela de escalas / parâmetros do ponto. **A folha não lê esse campo** — usa sempre o default de política **10** em `computePeriodFolha`. O campo afeta o caminho SQL (regime C) e o caminho semanal (regime B, quase sem UI). Editar “Mín. HE para contar” na escala **não muda o que a Folha paga**.

---

## 4. Confrontação com a lógica do dono

| # | Afirmação | Veredito | Detalhe |
|---|---|---|---|
| 1 | Batida no relógio → download → sistema lê | ✅ Confirmado | Parsers em `useTimesheet.ts`; arquivo arquivado. |
| 2 | Sistema “lê” a hora extra do arquivo | ⚠ Nuance | Arquivo só tem batidas. HE é **calculada**. |
| 3 | Balanço entre os dias | ✅ Confirmado | Compensação crédito↔atraso no período da folha (desde 2026-08-13). |
| 4 | HE só após atingir o mínimo de horas | ✅ Confirmado (com definição precisa) | “Mínimo” = **jornada esperada** + **saldo líquido do período > 10 min**. Não é um gatilho do tipo “só conta HE depois da 8ª/9ª hora do dia isolado”. |
| 5 | Banco de horas | ❌ Removido | HE paga na folha do mês; tabelas dropadas. |
| 6 | Tolerância de atraso no dia | ✅ Zero | Qualquer minuto abaixo da jornada entra como atraso bruto (depois pode ser compensado). |

### Exemplo numérico (mensalista, jornada 9h)

Período com 2 dias úteis:

| Dia | Batidas (resumo) | Trabalhado | Esperado | Bruto |
|---|---|---|---|---|
| Seg | 08:00–18:00 | 9h | 9h | 0 |
| Ter | 08:00–19:00 | 10h | 9h | +60 min crédito |
| Qua | 08:30–18:00 | 8h30 | 9h | −30 min atraso |

Compensação: 60 − 30 = **+30 min** saldo. Como 30 > 10 → **paga 30 min de HE**.  
Se o crédito fosse só +8 min e o atraso 0 → saldo 8 ≤ 10 → **HE = 0** (descarta).

---

## 5. Inconsistências vivas (para decisão posterior)

Nada abaixo foi corrigido nesta entrega — são achados para priorizar.

### I1 — Cópia stale no cadastro (Equipe)

`Employees.tsx` ainda diz, no regime mensalista:

> “contados por dia **(sem compensar entre dias)**”

Isso **contradiz** a regra vigente desde 2026-08-13. Risco: o RH confia no texto da tela e acha que a folha não compensa.

### I2 — `minimum_overtime_minutes` da escala não governa a folha

Controle na UI de jornada sugere efeito no pagamento; o pagamento ignora e fixa 10 min no saldo líquido. Já documentado como T5/D12 na auditoria de 29/07/2026; **continua verdadeiro**.

### I3 — Relatório semanal ≠ folha do período

Aba Relatórios mostra saldos por semana ISO a partir do ledger diário, enquanto o pagamento compensa o **período inteiro**. Números de HE “da semana” podem não bater com o holerite.

### I4 — SQL `calculate_day_summary` ainda é por dia

Pendências/fiscal usam threshold **por dia** (`diff < minimum_overtime → 0`). A folha não usa esse diff para pagar HE. Status de pendência (ímpar) e pagamento já foram alinhados no TS (`splitDayMinutes` marca todo ímpar como incomplete — fix D1/P2).

### I5 — Comentários / headers legados

- `hourlyPayroll.ts` header ainda descreve o modelo “só horas batidas × 1,5×” de 2026-06-01 — **aposentado** pela folha salário−descontos.
- `pontoEngine.ts` ainda fala em “banco de horas / espelho” no `computeWeekly`, feature já dropada.
- `EspelhoPontoPage.tsx` comentários ainda citam “movimentações de banco de horas”.

### I6 — Divisores na UI de salário

Texto de ajuda em Equipe ainda menciona “valor-dia = salário ÷ 30” e “÷ 220”, enquanto a política canônica da folha usa **dias úteis do mês** e jornada da escala. O caminho legado ÷30/÷220 existe só sem `SalaryPolicy`; a folha real sempre passa a policy.

---

## 6. O que já foi fechado (contexto)

Comparado à auditoria `AUDITORIA_RH_PONTO_2026-07-29.md`, o código atual já incorpora:

| Item antigo | Estado em 08/09/2026 |
|---|---|
| D1 — ímpar ≥5 pago na folha | ✅ TS trata **qualquer** ímpar como pendência (`splitDayMinutes`) |
| D5 — hora `29:59` | ✅ Fora de faixa → pendência |
| Compensação entre dias | ✅ Implementada (`saldo-periodo-v2`) |
| Banco de horas | ✅ Removido |
| HE R$/h por funcionário | ✅ `he_normal_rate` / `he_sunday_holiday_rate` |
| Hub com 4 telas | ✅ Equipe / Ponto / Relatórios / Folha |
| Overview do Ponto | ✅ Usa `computePeriodFolha` (não mais HE semanal para totais) |

---

## 7. Recomendações (sem implementar agora)

Ordem sugerida se o dono quiser fechar os gaps de compreensão (não de fórmula):

1. **Corrigir o texto** em `Employees.tsx` (I1) — baixo risco, alto valor de clareza.
2. **Rotular na UI** o que é “HE paga (folha)” vs “saldo da semana (conferência)” na aba Relatórios (I3).
3. **Decidir o destino** de `minimum_overtime_minutes` na escala: ou a folha passa a ler o campo, ou a UI deixa de editá-lo / explica que só afeta pendência SQL (I2).
4. Limpar comentários legados (I5) e o texto ÷30/÷220 (I6) para bater com a policy.

Unificar os três regimes de HE em um só **não** está recomendado sem decisão explícita: mexe em saldos históricos e na fila de pendências SQL.

---

## 8. Como validar na prática

1. Importar o arquivo do relógio em **Pessoas → Ponto**.
2. Resolver pendências (batida ímpar).
3. Registrar faltas justificadas quando houver atestado.
4. Abrir **Folha** → Calcular: conferir ledger dia a dia (`raw` → `compensated` → `payable`).
5. Conferir no **Espelho** do funcionário: mesmos minutos de HE/atraso que a Folha (mesmo motor).
6. Se a aba Relatórios mostrar HE semanal diferente do holerite, usar o holerite como verdade de pagamento (seção 3).

Testes automatizados que travam o contrato:

- `src/lib/__tests__/salaryPayroll.test.ts`
- `src/lib/ponto/pontoEngine.test.ts`
- `src/lib/ponto/timeBalanceReports.test.ts`
- `src/lib/__tests__/hourlyPayroll.test.ts`
- `src/lib/__tests__/weeklyTimeCalculation.test.ts` (regime B, sem UI viva)

---

## 9. Catálogo de relatórios vs `computePeriodFolha`

Auditoria arquivo-a-arquivo (08/09/2026). Referência canônica: `computePeriodFolha` → `calculateSalaryPayroll` (`src/lib/salaryPayroll.ts`), versão `saldo-periodo-v2-2026-08-26`. O `day_ledger` carrega bruto → compensado → `payable_*`.

### 9.0 Veredito — os relatórios de hoje estão corretos?

**No cálculo de pagamento, sim.** O que a Folha grava e mostra (resumo, holerite, PDF gerencial) usa `computePeriodFolha`.

Há **um bug vivo no print**, **divergências de propósito** e um **gap de navegação** maior do que parecia:

| Situação | Veredito | O que fazer |
|---|---|---|
| Folha (resumo / calendário / holerite / PDF gerencial) | **CORRECT** | Confiar |
| Aba Relatórios → “Horas extras” / “Pendências semanais” | **INTENTIONAL** | Conferência por semana ISO; o holerite é a verdade de pagamento |
| Espelho legal (`/rh/espelho-ponto`) — totais de saldo | **INTENTIONAL** | Soma saldo **bruto**; rota **sem link** no hub |
| Botão **Imprimir espelho** na Folha (`printTimeMirror`) | **BUG** | HE em R$ = `salário÷220 × 1,5 × Σ excedente/dia` |
| Excel / Documentos / Faltas / Atrasos | **INALCANÇÁVEL** | Código pronto atrás de `reportsOnly` sem caller — remontar (§10) |
| Overview / LateArrivals / PreFolha / KPIsRH | **ORPHAN** | Existem no disco, não montados |

**Legenda de veredito**

| Tag | Significado |
|---|---|
| **CORRECT** | Mesmos minutos/R$ que a folha (ou snapshot dela) |
| **INTENTIONAL_DIVERGENCE** | Número diferente de propósito (conferência semanal, presença, operacional) |
| **BUG/STALE** | Fórmula errada, cópia desatualizada, motor morto ainda exposto, ou leftover de banco de horas |
| **ORPHAN** | Arquivo existe, **nenhum** mount/rota viva no hub atual |

### 9.1 Hub vivo (`/rh`)

#### R00 — Espelho relógio de ponto (documento bruto na Folha)
| Campo | Valor |
|---|---|
| **Nome + path** | Painel Documentos da Folha · `Payroll.tsx` (`reportSel.espelho` → `printPayrollBundle`) |
| **Claims** | Registro bruto das batidas importadas — **sem cálculo** — só conferência |
| **Fonte** | `time_records.punches` agrupados por funcionário (`scopedEspelho`) |
| **Motor** | Nenhum (não calcula HE/atraso/falta) |
| **Veredito** | **CORRECT** para o que promete (presença bruta) |
| **Evidência** | Copy em `Payroll.tsx:1145–1146`; montagem `scopedEspelho` ~484–524. Não confundir com R07/R08. |

#### R01 — Folha / Fechamento
| Campo | Valor |
|---|---|
| **Nome + path** | Folha do Mês · `src/pages/Payroll.tsx` (via `FolhaConsolidada` → `RHHub` aba `folha`) |
| **Claims** | Calcula/fecha período; HE, faltas, atraso líquido, adiantamentos, líquido; holerite |
| **Fonte** | `computePeriodFolha` direto no calculate (`Payroll.tsx` ~879); persistência em `payroll_runs` + `calculation_snapshot` |
| **Motor** | `computePeriodFolha` + `day_ledger` |
| **Veredito** | **CORRECT** |
| **Evidência** | Grava `overtime_50_minutes = he_minutes`, `overtime_amount = he_value`, `deductions_amount = atraso_desconto`, `absence_discount = falta_desconto` (`Payroll.tsx:937–945`). |

#### R02 — FolhaConsolidada
| Campo | Valor |
|---|---|
| **Nome + path** | `src/components/hr/FolhaConsolidada.tsx` |
| **Claims** | Wrapper da Folha (fusão Relatório + Folha do Mês) |
| **Fonte** | Reexporta `<Payroll />` |
| **Motor** | Mesmo que R01 |
| **Veredito** | **CORRECT** (sem cálculo próprio) |
| **Evidência** | Arquivo inteiro = lazy `Payroll` (`FolhaConsolidada.tsx:9–19`). |

#### R03 — Relatório de Faltas
| Campo | Valor |
|---|---|
| **Nome + path** | Relatório de Faltas · `src/components/hr/RelatorioFaltas.tsx` (sub-view da Folha) |
| **Claims** | Dias de falta = dia útil coberto sem trabalho; desconto R$ = coluna Faltas da folha |
| **Fonte** | `computePeriodFolha` → `falta_dates` / `falta_desconto` |
| **Motor** | `computePeriodFolha` (+ print via `printRhReport`) |
| **Veredito** | **CORRECT** |
| **Evidência** | Header do arquivo + chamada com `coveredDates`/`absenceDates` (`RelatorioFaltas.tsx:6–8`, `:245–263`). |

#### R04 — Relatório de Atrasos
| Campo | Valor |
|---|---|
| **Nome + path** | Relatório de Atrasos · `src/components/hr/RelatorioAtrasos.tsx` |
| **Claims** | Atraso bruto por dia + líquido após compensação; R$ = coluna Atrasos da folha |
| **Fonte** | `computePeriodFolha` → `late_days` / `atraso_minutes` / `atraso_desconto` |
| **Motor** | `computePeriodFolha` + `atrasoReportPrint.ts` |
| **Veredito** | **CORRECT** |
| **Evidência** | `RelatorioAtrasos.tsx:5–7`, `:257–275`; print `atrasoReportPrint.ts:8–10`. |

#### R05 — TimeBalanceReports (aba Relatórios / “Espelho” do hub)
| Campo | Valor |
|---|---|
| **Nome + path** | Relatórios do Ponto · `src/pages/TimeBalanceReports.tsx` + `EmployeeBalanceCalendar` + `lib/ponto/timeBalanceReports.ts` |
| **Claims** | Quadro completo / “Horas extras” / “Pendências semanais”; calendário por semana ISO; saldo final pagável |
| **Fonte** | Inputs: `computeComparativoRows` → `computePeriodFolha` (`day_ledger`, `he_minutes`, `atraso_minutes`). Apresentação semanal: `buildEmployeeTimeBalanceReport` reagrupa ledger e faz `worked − expected` **por semana ISO** |
| **Motor** | Folha para totais pagáveis; **semanal bruto** para cards “Horas extras” / “Pendências” |
| **Veredito** | **INTENTIONAL_DIVERGENCE** (semanal) + **CORRECT** (`finalPayableBalanceMinutes` / quadro completo) |
| **Evidência** | Payable injetado em `TimeBalanceReports.tsx:124–131`; semana recalcula em `timeBalanceReports.ts:123–138` (`overtimeMinutes = max(0, balance)` sem piso 10min nem compensação cross-week). UI admite: “compensação dentro de cada semana” (`TimeBalanceReports.tsx:270–271`). Filtro `kind=overtime` usa `totalOvertimeMinutes` **semanal**, não `he_minutes` (`:160`, `reportsForKind`). |

#### R06 — printTimeBalanceReports / Relatório gerência
| Campo | Valor |
|---|---|
| **Nome + path** | `src/lib/printTimeBalanceReports.ts` |
| **Claims** | PDF do calendário semanal; relatório gerência com “Resultado final” |
| **Fonte** | Consome `EmployeeTimeBalanceReport` (R05) |
| **Motor** | Mesma dualidade R05 |
| **Veredito** | **INTENTIONAL_DIVERGENCE** no print de “Horas extras”; **CORRECT** no “Resultado final” (`finalPayableBalanceMinutes`) |
| **Evidência** | `printTimeBalanceReports.ts:65–69`, `:88–109`, `:168`. |

#### R07 — Espelho de ponto (página legal MTE)
| Campo | Valor |
|---|---|
| **Nome + path** | `src/pages/EspelhoPontoPage.tsx` · rota `/rh/espelho-ponto/:employeeId` |
| **Claims** | Espelho Portaria 671: batidas, jornada, saldo dia a dia |
| **Fonte** | Ledger: `computePeriodFolha` → `day_ledger`. Totais do rodapé: soma de `diffMin` (saldo **bruto** por dia) |
| **Motor** | `computePeriodFolha` para status/worked/expected; **não** usa `payable_*` nos totais |
| **Veredito** | **CORRECT** no status/falta/pendência (mesma fonte da folha); **INTENTIONAL_DIVERGENCE** nos totais de saldo (bruto, sem compensação de período) |
| **Evidência** | `EspelhoPontoPage.tsx:117–139`, `:185–189`, totais `:222–230`. Comentário de header ainda cita “Movimentações de banco de horas” (`:13`) — **STALE** (banco dropado). |

#### R08 — printTimeMirror (botão “Imprimir espelho” na Folha)
| Campo | Valor |
|---|---|
| **Nome + path** | `src/lib/printTimeMirror.ts` · chamado por `Payroll.printEspelho` |
| **Claims** | Calendário individual legal; HE e atraso do dia; “Valor HE (1,5×)” |
| **Fonte** | Dias de `comparativo.printData` (batidas/worked/expected). **R$ HE recalculado localmente**: `(Σ excedente/dia / 60) × (salário÷220) × 1,5` — **sem** compensação, **sem** taxas individuais, **sem** piso 10min |
| **Motor** | ❌ **Não** usa `computePeriodFolha` para dinheiro |
| **Veredito** | **BUG/STALE** |
| **Evidência** | Fórmula `printTimeMirror.ts:88–98`, label “Valor HE (1,5×)” `:266`. Comentário contraditório “MESMA conta da folha” + “sem compensação” (`:88–91`). Param `bankHoursBalance` ainda na API (`:80`) — leftover, não renderizado. Caller `Payroll.tsx:696–729` ainda fala “saldo de banco”. |

#### R09 — printPayrollBundle (maço Folha)
| Campo | Valor |
|---|---|
| **Nome + path** | `src/lib/printPayrollBundle.ts` |
| **Claims** | Resumo + calendário de tempo + holerite por funcionário |
| **Fonte** | `payroll_runs` + `day_ledger` (`payable_overtime_minutes` / `payable_delay_minutes`) |
| **Motor** | Snapshot/result da folha |
| **Veredito** | **CORRECT** |
| **Evidência** | Células HE/atraso usam `payable_*` (`printPayrollBundle.ts:231–232`); holerite parte de `overtime_amount` / `deductions_amount` (`:262–299`). |

#### R10 — printRhReport (resumo gerencial PDF)
| Campo | Valor |
|---|---|
| **Nome + path** | `src/lib/printRhReport.ts` · montado em `Payroll` |
| **Claims** | Tabela gerencial: pendências brutas, créditos brutos, saldo final, HE R$, líquido |
| **Fonte** | Números já vindos de `SalaryPayrollResult` (comparativo/folha) |
| **Motor** | Sem recálculo — presenter |
| **Veredito** | **CORRECT** (dados); KPIs rotulam bruto vs “H.E. a pagar” de forma explícita |
| **Evidência** | `Payroll.tsx:647–660` (`Pendências`/`Horas extras` = bruto; `H.E. a pagar`/`Saldo final` = pós-compensação). |

#### R11 — Excel da Folha (`exportFolhaExcel`)
| Campo | Valor |
|---|---|
| **Nome + path** | `src/lib/exportFolhaExcel.ts` |
| **Claims** | Resumo + detalhe dia a dia + “Como ler” (compensação + piso 10min) |
| **Fonte** | `SalaryPayrollResult` / `day_ledger` (sem recálculo financeiro) |
| **Motor** | `computePeriodFolha` via snapshot ou comparativo vivo |
| **Veredito** | **CORRECT** |
| **Evidência** | Docblock `:26–32`; colunas `payable_overtime_minutes` / `payable_delay_minutes` no detalhe. |

#### R12 — payrollComparativo (orquestração impressão/export)
| Campo | Valor |
|---|---|
| **Nome + path** | `src/lib/payrollComparativo.ts` |
| **Claims** | Fonte única Mês/Q1/Q2 para print e Excel |
| **Fonte** | `computePeriodFolha` por intervalo |
| **Motor** | `computePeriodFolha` |
| **Veredito** | **CORRECT** |
| **Evidência** | `:7–9`, chamada `:265+`. |

### 9.2 Ponto (`Timesheet`) — operacional vs pagamento

#### R13 — ExceptionsTab
| Campo | Valor |
|---|---|
| **Nome + path** | `src/components/timesheet/ExceptionsTab.tsx` (aba Corrigir → Exceções) |
| **Claims** | Detecta batida ímpar / sequência inválida / HE excessiva (heurística) |
| **Fonte** | `calculateDaySummary` + tabela `time_exceptions` |
| **Motor** | ❌ Não é motor de pagamento |
| **Veredito** | **INTENTIONAL_DIVERGENCE** (fila de qualidade, não holerite) |
| **Evidência** | Detecção local `:79+`; montado em `Timesheet.tsx:1785`. |

#### R14 — PendingTimeRecordsPanel / TimePendings
| Campo | Valor |
|---|---|
| **Nome + path** | `PendingTimeRecordsPanel` + `src/pages/TimePendings.tsx` |
| **Claims** | Batidas incompletas a corrigir antes de fechar |
| **Fonte** | SQL/RPC de pendências; cutoff via `get_bank_hours_cutoff` |
| **Motor** | Regime C (SQL por dia), não `computePeriodFolha` |
| **Veredito** | **INTENTIONAL_DIVERGENCE**; leftover de nome “banco” no cutoff |
| **Evidência** | `useBankHoursCutoff.ts:4–6` ainda documenta “corte do banco de horas”; UI de pendências filtra a partir dessa data (`TimePendings.tsx:199–200`). |

### 9.3 Orphans / dead code (existem no disco, fora do hub)

| ID | Path | O que pretendia | Motor | Veredito |
|---|---|---|---|---|
| R15 | `OverviewTab.tsx` | Visão geral HE/déficit/faltas/custo HE | Chama `computePeriodFolha` **mas** sem `absenceDates` / `coveredDates` / swaps (`:154–161`); copy “sem compensação” (`:362`) enquanto `he_minutes` já é líquido | **ORPHAN + BUG/STALE** se remontado |
| R16 | `LateArrivalsTab.tsx` | Atraso de **entrada** (1ª batida − horário) com tolerância da escala | Fórmula própria (`:132–145`); ≠ `atraso_minutes` da folha | **ORPHAN**; seria **INTENTIONAL** (métrica operacional) se reativado — não confundir com R04 |
| R17 | `DivergencesTab.tsx` | Batidas ímpares / completar manual | Contagem de punches, sem folha | **ORPHAN** / operacional |
| R18 | `PreFolha.tsx` | Pré-folha + CSV contador a partir de `payroll_runs` | Lê snapshot gravado (`overtime_amount`, `absent_days`) — alinhado **se** a Folha gravou | **ORPHAN**; conteúdo seria **CORRECT** se remontado |
| R19 | `KPIsRH.tsx` | Absenteísmo + % HE do mês | HE de `payroll_runs`; absenteísmo de `employee_absences` (`absenteeism.ts`) — **não** é o mesmo que `falta_days` da folha | **ORPHAN**; HE **CORRECT** vs runs; absenteísmo **INTENTIONAL** (justificadas inclusas) |
| R20 | `AbsenceReport.tsx` | Cadastro/relatório de ausências | `absenteeism.ts`, sem ponto | **ORPHAN** (sem rota em `App.tsx`) |
| R21 | `printTimesheet.ts` / `evaluationDetail` | Avaliação de jornada impressa | Com `payrollResult` → **CORRECT**; fallback local ainda soma crédito/atraso **por dia** (`:702–703`) | Lib viva via Excel/tipos; print HTML quase sem caller. Fallback = **BUG** se usado sem `payrollResult` |

### 9.4 Banco de horas — leftovers em relatórios

| Local | Estado |
|---|---|
| Tabelas / fluxo de pagamento | Dropados (`20260910130000`); HE paga na folha |
| `EspelhoPontoPage` header | Comentário “Movimentações de banco de horas” — **STALE** |
| `printTimeMirror` | Param `bankHoursBalance` — **STALE** API |
| `Payroll.printEspelho` comment | “saldo de banco” — **STALE** |
| `useBankHoursCutoff` / `TimePendings` | RPC `get_bank_hours_cutoff` ainda usada como **data mínima de pendências** — nome legado, função viva (filtro) |
| `pontoEngine.computeWeekly` / `weeklyTimeCalculation` | Comentários ainda citam banco/Overview — **STALE**; UI viva não monta Overview |
| Rotas | `/rh/banco-de-horas` → redirect (`RHHub` / `App.tsx`) |

### 9.5 Matriz rápida

| Relatório | Acessível no hub? | vs Folha |
|---|---|---|
| TimeBalanceReports (payable / quadro) | sim (aba Relatórios) | CORRECT |
| TimeBalanceReports (HE/déficit semanal) | sim | INTENTIONAL_DIVERGENCE |
| printTimeBalance* | sim | mesma dualidade |
| Folha / FolhaConsolidada (resumo, calendário, holerite, PDF gerencial) | sim (aba Folha) | CORRECT |
| printTimeMirror (botão Imprimir espelho na Folha) | sim | **BUG/STALE** |
| EspelhoPontoPage (rota `/rh/espelho-ponto/:id`) | rota existe, **sem link no hub** | status CORRECT; totais INTENTIONAL |
| Documentos / Excel / maço PDF / RelatorioFaltas / RelatorioAtrasos | código vivo, **UI inalcançável** (`reportsOnly` sem caller) | CORRECT se remontados |
| Exceptions / Pendências (Ponto) | sim | INTENTIONAL (operacional) |
| Overview / LateArrivals / Divergences / PreFolha / KPIsRH / AbsenceReport | **não montados** | ORPHAN |

> **Errata vs §9.1 R03/R04/R00/R11:** na navegação atual do hub, Faltas, Atrasos, Excel e o painel Documentos **não aparecem** — ficaram no branch `Payroll({ reportsOnly: true })`, que nenhum caller passa. A análise de cálculo desses módulos continua válida; o gap agora é de **descoberta/remontagem** (ver §10).

### 9.5.1 Como o usuário deve ler cada tela

1. **Quer saber o que vai pagar?** → Folha (resumo / holerite / PDF gerencial).
2. **Quer conferir se a semana fechou?** → Relatórios → “Horas extras” / “Pendências semanais” (saldo da semana ISO; pode divergir do holerite).
3. **Quer o documento legal dia a dia?** → rota `/rh/espelho-ponto/:id` (hoje só por URL). Totais de saldo ali são brutos.
4. **Não use** o “Valor HE (1,5×)” do botão Imprimir espelho da Folha como valor a pagar — fórmula legada (R08).
5. Excel / Faltas / Atrasos / maço de documentos: código pronto, **remontar** (T02/U02 no §10).

### 9.6 Prioridade se for corrigir (sem mexer no motor)

1. **P0** — `printTimeMirror`: parar de inventar `salário÷220×1,5`; usar `he_minutes`/`he_value` do comparativo.
2. **P0** — Remontar Documentos/Excel/Faltas/Atrasos **ou** cortar o branch morto `reportsOnly`.
3. **P0** — Entrada descoberta para o Espelho Portaria 671.
4. **P1** — Labels “HE da semana” vs “HE paga”; banner de confiança na aba Relatórios.
5. **P1** — Perf: lazy Q1/Q2 no comparativo; não montar prévia HTML na Folha; batch de upsert; reusar snapshot.
6. **P2** — Orphans: apagar ou remontar PreFolha (CSV contador).

---

## 10. Melhorias e otimizações — backlog priorizado

Escopo: relatórios/acessos do hub Pessoas. **Não** inclui reescrever `computePeriodFolha`.

### 10.0 Achado estrutural (hub)

Após a fusão Folha+Relatório e a troca da aba hub “Espelho” por `TimeBalanceReports`:

| O que o spec/docs prometiam | O que o hub entrega hoje |
|---|---|
| 4 telas: Equipe · Ponto · Espelho · Folha | Equipe · Ponto · **Relatórios semanais** · Folha |
| Espelho do funcionário (Portaria 671) | Rota `/rh/espelho-ponto/:id` **sem Link** em lugar nenhum |
| Documentos / Excel / Faltas / Atrasos | Branch `reportsOnly` **sem caller** (`FolhaConsolidada` monta `<Payroll />` sem a prop) |

Isso explica por que o RH “perdeu” Excel e relatórios de falta/atraso sem o motor ter sumido.

### 10.1 Correctness / confiança

| ID | P | Esforço | Evidência | Mudança proposta | Risco |
|---|---|---|---|---|---|
| **T01** | P0 | S | `printTimeMirror.ts:88–98`, `:266`; `Payroll.tsx:696–729` | HE/atraso do print = `SalaryPayrollResult` (taxas individuais + compensação + piso 10). Remover “Valor HE (1,5×)” e `bankHoursBalance`. | Baixo |
| **T02** | P0 | M | `Payroll.tsx:168`, `:1116`; `FolhaConsolidada.tsx:18`; grep zero `reportsOnly={true}` | Remontar Documentos/Excel/Faltas/Atrasos na Folha (sub-abas) **ou** deletar o branch. | Médio se remontar sem alinhar período |
| **T03** | P1 | S | `TimeBalanceReports.tsx:159–163`, `:322` | KPI “Total de horas extras” = semanal. Renomear + mostrar “HE paga (folha)” ao lado. | Baixo |
| **T04** | P1 | S | `EspelhoPontoPage.tsx:222–230` | Rotular totais como saldo bruto; opcionalmente mostrar HE/atraso líquidos do período. | Baixo |
| **T05** | P1 | M | `Timesheet.tsx` `folhaForEmployee` sem `absenceDates`/`coveredDates` | Passar os mesmos args que a Folha — evita divergência no resumo do Ponto. | Médio (números na tela mudam) |
| **T06** | P2 | S | `RelatorioFaltas`/`Atrasos` `queryKey` com `.length` | Chave por ids/`updated_at` (quando remontados). | Baixo |
| **T07** | P2 | S | Leftovers “banco de horas” (§9.4) | Limpar copy/API. | Nenhum |

### 10.2 UX / descoberta

| ID | P | Esforço | Evidência | Mudança proposta | Risco |
|---|---|---|---|---|---|
| **U01** | P0 | M | Spec item 12.3; `App.tsx` rota sem Link; hub monta só `TimeBalanceReports` | CTA Equipe/Folha/Relatórios → Espelho legal + AEJ. | Médio (navegação) |
| **U02** | P0 | M | Painel Documentos só em `reportsOnly` | Devolver Excel + maço PDF + Faltas/Atrasos na Folha. | Baixo (UI já escrita) |
| **U03** | P1 | S | Três “espelhos” diferentes (semanal / legal / bruto / printTimeMirror) | Glossário curto na UI. | Baixo |
| **U04** | P1 | S | Copy semanal vs holerite | Banner: “Números desta aba ≠ holerite; pagamento em Folha.” | Nenhum |
| **U05** | P2 | S | LEGACY map `relatorios`/`absenteismo` → `espelho` | Remapear ou avisar. | Baixo |

### 10.3 Performance

| ID | P | Esforço | Evidência | Mudança proposta | Risco |
|---|---|---|---|---|---|
| **P01** | P1 | M | `payrollComparativo.ts:293–295` — **3× `computePeriodFolha` por funcionário** (range+Q1+Q2) | Lazy Q1/Q2 só no Excel; tela só o intervalo. | Médio |
| **P02** | P1 | M | `Payroll.tsx:554–569` `previewHtml`/`buildPayrollHtml` sempre, mesmo com painel Documentos morto | Não montar prévia HTML enquanto `reportsOnly===false`. | Baixo |
| **P03** | P1 | M | `calculateAll` upsert **por funcionário** sequencial | Batch RPC ou pool + um invalidate. | Médio (travas de status) |
| **P04** | P1 | S | TimeBalance / Faltas / Atrasos recalculam vivo e ignoram snapshot aprovado | Preferir `calculation_snapshot` quando run não-rascunho. | Baixo |
| **P05** | P2 | S | `groupPayrollPunchesByEmployee` O(records×emps) | `Map` por id. | Nenhum |
| **P06** | P2 | S | Várias queryKeys de `fetchTimeRecordsInRange` | Key canônica compartilhada. | Baixo |
| **P07** | P2 | M | HTML monolítico nos prints | Paginar / virtualizar prévia. | Médio |
| **P08** | P3 | S | `calculateAll` refetch total mesmo com cache | Reusar React Query + epoch. | Baixo |

**Cheiros concretos:**

1. Folha grava snapshot, mas Relatórios/Faltas/Atrasos (se remontados) **não o leem**.
2. `TimeBalanceReports` chama `computeComparativoRows` completo (inclui Q1/Q2 inúteis para o calendário).
3. Prévia HTML do maço continua no main thread da Folha sem UI Documentos.

### 10.4 Consolidação / código morto

| ID | P | Esforço | Mudança | Risco |
|---|---|---|---|---|
| **D01** | P1 | S | Apagar ou remontar orphans: Overview, LateArrivals, Divergences, KPIsRH, AbsenceReport, PreFolha | Baixo |
| **D02** | P1 | M | Decisão: remontar `reportsOnly` (U02) **ou** deletar branch + dead UI | Médio se deletar Excel |
| **D03** | P2 | S | `printTimesheet` fallback sem `payrollResult` → obrigar result | Baixo |
| **D04** | P2 | S | Enxugar `computeWeekly`/comments de Overview morto | Baixo |
| **D05** | P3 | S | Inline `FolhaConsolidada` | Nenhum |

### 10.5 Gaps de produto

| ID | P | Esforço | Mudança | Risco |
|---|---|---|---|---|
| **G01** | P0 | M | Espelho legal + AEJ descobertos no hub, números alinhados à folha | Médio (compliance) |
| **G02** | P1 | M | Remontar PreFolha / CSV contador a partir do snapshot | Baixo |
| **G03** | P1 | S | Deep-link Folha → Ponto no funcionário com pendência | Baixo |
| **G04** | P2 | M | Dashboard absenteísmo justificado vs falta descontada (labels explícitos) | Médio |
| **G05** | P2 | L | Diff rascunho vivo × snapshot aprovado após reimport | Médio |
| **G06** | P3 | M | Relatório “cadastro incompleto” (jornada/taxas HE) antes do fechamento | Baixo |

### 10.6 Ordem sugerida de ataque

1. **T01** — printTimeMirror para de mentir R$
2. **T02 + U02** — devolver Documentos/Excel/Faltas/Atrasos (ou cortar de vez)
3. **U01 + G01** — espelho legal descobível
4. **T03 + U03 + U04** — labels de confiança
5. **P02 → P01 → P03 → P04** — perf Folha/comparativo/snapshot
6. **D01 / G02** — orphans: apagar vs PreFolha CSV

---

## Veredito final

O setor Pessoas **já calcula** o que o dono descreveu no caminho de **pagamento**: batidas → importação → jornada esperada → balanço entre dias no período → HE só no saldo líquido positivo acima de 10 minutos → folha com taxas R$/h individuais.

Os gaps vivos são de **apresentação e navegação**, não do motor:

1. Relatório semanal ≠ holerite por desenho (ok se rotulado).
2. `printTimeMirror` ainda inventa HE com ÷220×1,5 (**bug**).
3. Excel / Faltas / Atrasos / Documentos estão **prontos no código e inalcançáveis no hub** (`reportsOnly`).
4. Espelho Portaria 671 existe por URL, **sem entrada** na navegação.
5. Há custo de performance evitável (3 folhas/funcionário no comparativo, prévia HTML morta, upsert N×1).

Não é necessário reescrever `computePeriodFolha` — é necessário alinhar prints/labels, remontar o que ficou órfão no hub e reduzir recomputes.
