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

## Veredito final

O setor Pessoas **já calcula** o que o dono descreveu: batidas do relógio → importação → jornada esperada → balanço entre dias no período → HE só no saldo líquido positivo acima de 10 minutos → pagamento na folha com taxas R$/h individuais.

O trabalho útil daqui pra frente é **clareza de interface e um único rótulo do que é pagamento**, não reescrever o motor `computePeriodFolha`.
