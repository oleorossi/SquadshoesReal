# Auditoria RH / Pessoas — compatibilidade entre relatórios e cálculos

> **Data:** 2026-07-03 · **Escopo:** setor de Pessoas/RH (ponto, banco de horas,
> folha, ausências, atrasos, relatórios/KPIs). **Pergunta:** os relatórios e
> cálculos são compatíveis uns com os outros?
>
> **Resposta curta:** o **lado servidor está internamente consistente** (as 3 views
> de banco de horas delegam todas à mesma RPC; totais batem — verificado
> `total_balance_min = -42413` idêntico nas 3). As incompatibilidades estão no
> **frontend**, onde vários relatórios **re-derivam** em TS os mesmos conceitos
> que o servidor já calcula, com fórmulas/constantes divergentes. Abaixo, o mapa
> completo, separado por severidade e por "bug real" vs "decisão de design que
> mesmo assim gera divergência entre telas".

## Metodologia

- **Fonte de verdade (servidor):** `calculate_day_summary`, `get_employee_expected_minutes`,
  `calculate_employee_bank_balance` (v10), `resolve_monthly_overtime`,
  `get_payroll_inputs_for_period`, `get_bank_hours_cutoff` (piso `2026-04-15`) e as
  views `bank_hours_balance` / `v_bank_hours_summary` / `v_bank_hours_per_sector`.
- **Dados vivos conferidos:** 15 funcionários ativos (todos `overtime_multiplier=1.5`,
  1 com `hourly_rate`, 15 com `salary`); todas as escalas `tolerance_minutes=0`,
  `minimum_overtime_minutes=10`, sem sábado, jornada 08–18 / 12–13, 44h; 189
  `payroll_runs`; 0 `overtime_resolutions`.

## Regras canônicas do servidor (referência)

| Conceito | Servidor (canônico) |
|---|---|
| Minutos trabalhados / almoço | `calculate_day_summary`: soma de pares de batidas; almoço inferido na janela 12:00–14:00 (720–840), corte 13:00 (780), dia longo >6h (360), almoço mínimo 60min. Ímpar/1 batida → `irregular`. |
| Jornada esperada | `get_employee_expected_minutes`: `(lunch_start−entry)+(exit−lunch_end)`; **sábado usa `saturday_entry/exit` à parte**; dia não-útil = 0. |
| Hora extra (banco) | `calculate_employee_bank_balance`: agregação **SEMANAL** (ISO), com tolerância e mínimo aplicados por semana; excedente normal = 50%, feriado/domingo = 100%; abona ausência justificada; piso na data de corte. |
| HE paga (mensal) | `resolve_monthly_overtime`: `hora = hourly_rate ?? salary/220`; `× overtime_multiplier (1,5)`; 'bank' NÃO insere movimento (saldo do ponto já inclui); 'pay' insere movimento negativo + despesa. |
| Valor-hora / valor-dia folha | `salary/220` (hora) e `salary/30` (dia) — consistente em todos os caminhos vivos de folha. ✅ |

---

## ✅ Correções aplicadas nesta PR (2026-07-03)

- **A1, A2, A3** corrigidos (display — não mudam pagamento).
- **B4 (feriado)** unificado em **1,5×** por decisão do usuário: migration
  `20260703200000_unify-holiday-multiplier-1.5x.sql` zera a divergência (as 17
  escalas passam a `holiday_multiplier = 1.5`, default da coluna = 1.5) + fallbacks
  do frontend `2.0 → 1.5`. A folha já pagava 1,5× flat; o espelho/calendário/Overview
  deixam de exibir 2×. **Nenhum valor de folha muda.**
- Demais itens (A4, A5, B1–B3, B5, C*) permanecem **abertos** — ver abaixo.

## A. Incompatibilidades CONFIRMADAS (bugs — corrigir)

### A1 · PreFolha soma colunas mortas → HE e DSR aparecem R$ 0,00
- **`src/components/hr/PreFolha.tsx:98-104,135-141`** soma `overtime_50_value`,
  `overtime_100_value`, `night_bonus_value`, `dsr_value`.
- **`src/pages/Payroll.tsx:505-521`** escreve apenas `overtime_amount` (= valor da HE),
  `premium_value`, `overtime_50_minutes`, `absence_discount`, `total_proventos`,
  `total_liquido`. **Nunca** escreve `overtime_50_value`/`overtime_100_*`/`night_*`/`dsr_value`.
- **Efeito:** a Pré-folha mostra os **minutos** de HE mas **R$ 0,00** de valor de HE, e
  DSR zerado, no CSV que vai pro contador. Os totais de baixo (`total_proventos`/
  `total_liquido`) estão certos — só a **coluna** de HE mente.
- **Precedente:** `KPIsRH.tsx:43-48` já foi corrigido pra esse exato problema em
  2026-06-17 (passou a ler `overtime_amount`). **PreFolha ficou de fora.**
- **Correção sugerida:** ler `overtime_amount` como valor da HE (50%) e remover/zerar
  as colunas legadas 100%/noturno/DSR do agregado e do CSV.

### A2 · "Atrasos" na aba de Ponto usa tolerância 10 quando a escala diz 0
- **`src/components/timesheet/LateArrivalsTab.tsx:130`**:
  `const tolerance = empSchedule.tolerance_minutes || 10;`
- Como **todas as escalas têm `tolerance_minutes = 0`**, o `|| 10` (0 é *falsy*)
  troca o 0 configurado por **10 minutos** de tolerância.
- **`RelatorioAtrasos.tsx`** (via `computePeriodFolha`, `salaryPayroll.ts:337`) e a
  **Folha** usam tolerância **0**. Logo, para o **mesmo dia**, a aba de Ponto conta
  **menos atrasos** que o Relatório de Atrasos / Folha.
- **Correção sugerida:** `empSchedule.tolerance_minutes ?? 10` (só muda o caso 0,
  que é o bug), alinhando com `weeklyTimeCalculation.ts:119` que já usa `?? 10`.

### A3 · KPIsRH — rótulo do card "Custo HE" descreve composição errada
- **`src/components/hr/KPIsRH.tsx:133,142`**: título/legenda dizem
  "Soma de HE 50% + HE 100% + adicional noturno", mas
  **`heCusto = Σ overtime_amount`** (só 50%; 100%/noturno são legado não escrito).
- O valor está certo — o rótulo é que sobra. Cosmético; ajustar o texto para "HE (1,5×)".
- Correlato: `funcsComHE` (`KPIsRH.tsx:63-65`) conta só quem tem `overtime_50_minutes>0`.

### A4 · "Absenteísmo" calculado de 3 formas diferentes em 3 telas
| Tela | Fonte | Numerador | Denominador |
|---|---|---|---|
| PainelRH (`PainelRH.tsx:250`, `usePainelData:124-128`) | `employee_absences` | dias **corridos** (`daysBetween`, inclui fds) | — (contagem) |
| KPIsRH (`KPIsRH.tsx:106-109,46-48`) | `payroll_runs` | Σ `absent_days` | Σ `business_days` |
| AbsenceReport (`AbsenceReport.tsx:76-77,199`) | `employee_absences` | dias **corridos** × | dias **úteis** × headcount |

- Três telas, três números de "absenteísmo" que **não batem** entre si (fontes e
  divisores diferentes).
- **Bug metodológico interno** no AbsenceReport: numerador em **dias corridos** sobre
  denominador em **dias úteis** → **infla** a taxa.
- **Decisão necessária:** definir a fórmula canônica de absenteísmo e apontar as 3
  telas pra ela (idealmente a mesma fonte — `employee_absences` com dias úteis no
  numerador **e** denominador, ou `payroll_runs`).

### A5 · `employee_absences` — dois cadastros com vocabulário e regras divergentes
- **AbsenceReport** (via `useRH.ts:227-244`, `ABSENCE_TYPE_LABELS`): **11 tipos**
  (`falta_injustificada`, `falta_justificada`, `folga`, `abono`, `licenca_*`,
  `suspensao`, …). KPIs separam just./injust. por `absence_type !== 'falta_injustificada'`.
- **EmployeeAbsences** (via `useEmployeeAbsences.ts:5,20-27`, `ABSENCE_LABEL`):
  **6 tipos** (`ferias, atestado, licenca, folga_compensatoria, suspensao, outro`).
- **Efeito:** uma linha gravada por uma tela (ex.: `abono`, `folga`, `falta_injustificada`)
  aparece como string crua / `outro` na outra e some dos filtros dela.
- **Regras de escrita divergentes na MESMA tabela:** `useEmployeeAbsences.useCreateAbsence`
  força `justified:true` sempre (`:70`) e **não** chama `assertNoClosedPayroll`;
  `useRH.useUpsertAbsence/useDeleteAbsence` **checam** folha fechada (`:281,:307`).
- **Correção sugerida:** unificar o enum de `absence_type` (fonte única) e o guard de
  folha fechada nos dois hooks.

---

## B. Divergências parcialmente POR DESIGN (mas ainda desalinham telas)

> Estas seguem decisões explícitas do usuário registradas no código. Não são "bug"
> isolado, mas **duas telas de fechamento/HE produzem números diferentes** — vale
> decidir se é aceitável ou se convergem.

### B1 · HE: Folha é **por-dia**, Fechamento é **semanal**, Banco é **semanal ponderado**
- **Folha** (`salaryPayroll.ts:226-242`): saldo **por dia**, sem compensação entre dias
  (decisão 2026-06-19), tolerância **0**, HE `× salary/220 × 1,5`.
- **Fechamento** (`weeklyTimeCalculation.ts:130-137` + `useMonthlyClosing.ts:300-305`):
  agregação **semanal**, tolerância `schedule.tolerance_minutes ?? 10`.
- **Banco (RPC)**: semanal + ponderação 50/100 + piso de corte + abono de ausência.
- Um Ter. curto **não** cancela uma Qua. longa na Folha, mas **cancela** no Fechamento.
  → HE da Folha ≠ HE do Fechamento ≠ saldo do Banco, para o mesmo período.

### B2 · Taxa-hora e desconto de falta divergem entre Folha e Fechamento
- **Folha**: `valorHora = salary/220` (ignora `employees.hourly_rate` e
  `benefits.monthly_hours`); falta = `salary/30` por dia.
- **Fechamento** (`useMonthlyClosing.ts:300-305`): `otHourRate = hourly_rate ?? salary/(monthly_hours||220)`;
  falta entra como **déficit horário** `(min/60)×(salary/220)` — preço diferente do `salary/30`.
- Só relevante hoje pra 1 funcionário com `hourly_rate`, mas o desconto de falta
  (÷30 vs ÷220×horas) diverge para **todos**.

### B3 · Diarista pago de dois jeitos
- **Folha** (`salaryPayroll.ts:359-368`): **qualquer** dia com ≥1 batida = 1 diária cheia.
- **Fechamento + RPC canônica**: `≥360min → 1`; `≥120min → 0,5`; `<120 → 0`.
- Folha **paga a mais** meia-diária como cheia e paga dia <2h que a RPC descarta.

### B4 · Multiplicador de feriado: folha paga 1,5×, espelho/calendário mostram 2×
- **Folha** (`hourlyPayroll.ts` `splitDayMinutes`): feriado/fds = 1,5× fixo.
- **Print/calendário** (`payrollComparativo.ts:48-49`, `useMonthlyClosing.ts:55`
  `FALLBACK_SCHEDULE.holiday_multiplier=2`): feriado = 2×.
- O espelho impresso pode exibir HE de feriado **maior** do que o holerite paga.

### B5 · Fechamento re-deriva o saldo semanal e diverge do Banco (RPC)
- `weeklyTimeCalculation.ts` **não** aplica a ponderação 50/100, o piso de corte nem
  o abono de ausência que a `calculate_employee_bank_balance` aplica. O saldo mostrado
  no Fechamento pode driftar de `balance_min/balance_50_min/balance_100_min`.

---

## C. Divergências LATENTES (código divergente, sem dado vivo que dispare hoje)

- **C1 · Sábado** — `salaryPayroll.expectedDayMinutes` (`:57-60`) ignora
  `saturday_entry/exit` e usa a jornada de dia útil. Nenhuma escala trabalha sábado
  hoje, mas quebra se alguém cadastrar. (`LateArrivalsTab.tsx:126-128` já lê o sábado —
  inconsistência interna.)
- **C2 · Batidas ímpares ≥5** — `hourlyPayroll.splitDayMinutes` (`:110-121`) calcula
  como trabalhado (span 1ª→última, descartando as do meio) em vez de `irregular` como o SQL.
- **C3 · `resolve_weekly_overtime` (SQL)** — ainda insere crédito no 'bank' (dobra o
  saldo derivado) e não aplica multiplicador; **código morto** (a UI só chama
  `resolve_monthly_overtime`), mas incompatível se algum dia for ligado.
- **C4 · Espelho de Ponto** — a grade dia-a-dia usa TS `calculateDaySummary`
  (tolerância 0, HE 0 por dia), enquanto o bloco "Banco de Horas / SALDO FINAL" usa a
  RPC. Dois motores na mesma página; os saldos podem discordar.
- **C5 · Lista de Banco de Horas** — `BankHours.tsx` lista usa a view `bank_hours_balance`
  **sem filtro de período** (acumulado desde o corte), enquanto o drill-down usa a RPC
  **filtrada por período** → o número do drawer difere da linha clicada. Além disso, o
  tipo/coment. do frontend chama a view de "só movements" (`:16,:421`) — **desatualizado**:
  a view inclui `timesheet_min` (número correto, comentário errado).
- **C6 · Data de corte não aplicada nos relatórios** — `get_bank_hours_cutoff`
  (`useBankHoursCutoff.ts`) não é importado por `BankHours` (presets 7/30 dias) nem por
  `RelatorioAtrasos`; o corte só vive dentro da RPC.
- **C7 · Constante 220 duplicada** — `SALARY_HOUR_DIVISOR=220` (`salaryPayroll.ts:37`)
  vs literal `salary/220` em `PayHoursDialog.tsx:78` (risco de drift silencioso).

---

## D. Consistente (sem divergência) ✅

- As 3 views de banco de horas delegam à `calculate_employee_bank_balance` — totais
  batem exatamente.
- Pendências de ponto (`RHHub`, `PunchReconciliationPage`, `CompletePunchesDialog`)
  saem todas das RPCs (`get_pending_count_by_employee`, `get_punch_reconciliation`,
  `complete_punches`).
- Resolução de HE mensal: o preview da UI (`OvertimeResolutionPanel`) usa
  `overtime_multiplier ?? 1.5` e `salary/220`, **iguais** ao servidor.
- Inferência de almoço em TS (`splitDayMinutes`) usa as **mesmas constantes** do SQL
  (720/840/780/360/60).
- Divisores de folha `salary/220` e `salary/30` são consistentes em todos os caminhos
  vivos de pagamento.

---

## Prioridade sugerida

1. **A1, A2, A3** — correções de display seguras (mostram valores já pagos/configurados;
   não mudam política de pagamento). Baixo risco.
2. **A5** — unificar enum + guard de `employee_absences` (integridade de dado).
3. **A4** — definir fórmula canônica de absenteísmo e apontar as 3 telas.
4. **B1–B5** — decisão de política: Folha (por-dia) e Fechamento (semanal) convergem
   ou coexistem? Diarista e feriado envolvem **dinheiro** — confirmar antes de mexer.
5. **C1–C7** — latentes/robustez; corrigir junto quando tocar cada arquivo.
